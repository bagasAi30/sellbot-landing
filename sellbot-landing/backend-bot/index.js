require('dotenv').config();

// Polyfill WebSocket untuk Supabase di Node.js
if (typeof WebSocket === 'undefined') {
    try {
        global.WebSocket = require('ws');
    } catch (e) {
        console.warn('⚠️ Gagal memuat polyfill ws:', e.message);
    }
}

const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const { generateAIResponse, processImageWithGemini, extractIntentWithGemini } = require('./ai');
const { searchDestination, calculateShipping } = require('./shipping');

const path = require('path');

process.on('uncaughtException', (err) => {
    console.error('🔥 UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 UNHANDLED REJECTION:', reason);
});

const app = express();
app.use(cors());
app.use(express.json());

const fs = require('fs');

// Melayani file-file statis Frontend (cek ./public dulu, lalu .. atau ../..)
let frontendPath = path.join(__dirname, 'public');
if (!fs.existsSync(path.join(frontendPath, 'index.html'))) {
    frontendPath = path.join(__dirname, '..');
}
if (!fs.existsSync(path.join(frontendPath, 'index.html'))) {
    frontendPath = path.join(__dirname, '../..');
}
app.use(express.static(frontendPath));

// Route ramah pengguna (bisa akses tanpa akhiran .html)
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(frontendPath, 'dashboard.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-dashboard.html'));
});
app.get('/login', (req, res) => {
    res.sendFile(path.join(frontendPath, 'login.html'));
});

// Inisialisasi Supabase (gunakan Service Role Key untuk bypass RLS di backend)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn("⚠️ SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diatur di file .env!");
}
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("✅ Menggunakan Supabase Service Role Key (bypass RLS)");
} else {
    console.warn("⚠️ SUPABASE_SERVICE_ROLE_KEY tidak ditemukan, menggunakan ANON_KEY (mungkin diblokir RLS)");
}
const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder');

// Menyimpan sesi aktif WA per User ID
const activeSessions = {};

// In-memory chat history: { [userId_phone]: [{sender, message}] }
// Digunakan sebagai fallback jika Supabase tidak menyimpan dengan benar
const inMemoryHistory = {};

function getMemoryKey(userId, customerPhone) {
    return `${userId}_${customerPhone}`;
}

function addToMemory(userId, customerPhone, sender, message) {
    const key = getMemoryKey(userId, customerPhone);
    if (!inMemoryHistory[key]) inMemoryHistory[key] = [];
    inMemoryHistory[key].push({ sender, message });
    // Batasi 20 pesan terakhir
    if (inMemoryHistory[key].length > 20) {
        inMemoryHistory[key] = inMemoryHistory[key].slice(-20);
    }
}

function getFromMemory(userId, customerPhone) {
    const key = getMemoryKey(userId, customerPhone);
    return inMemoryHistory[key] || [];
}

/**
 * Fungsi utama untuk menjalankan Bot WA untuk user tertentu
 */
async function startWhatsAppBot(userId, onStatus) {
    if (activeSessions[userId]) {
        console.log(`Sesi untuk user ${userId} sudah berjalan.`);
        return;
    }

    const { state, saveCreds } = await useMultiFileAuthState(`auth_info_${userId}`);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['AsistenLapak AI', 'Chrome', '1.0.0']
    });

    activeSessions[userId] = { sock: sock, status: 'CONNECTING', qr: null, pendingOrder: null };

    // Mendengarkan perubahan status koneksi (QR Code, Connected, Disconnected)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            activeSessions[userId].status = 'SCAN_QR';
            activeSessions[userId].qr = qr;
            if (onStatus) onStatus({ type: 'qr', data: qr }); // Kirim QR ke frontend
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Koneksi tertutup untuk ${userId}. Reconnect: ${shouldReconnect}`);
            delete activeSessions[userId];
            if (shouldReconnect) {
                startWhatsAppBot(userId);
            }
        } else if (connection === 'open') {
            activeSessions[userId].status = 'CONNECTED';
            activeSessions[userId].qr = null;
            console.log(`✅ WhatsApp terhubung untuk user: ${userId}`);
            if (onStatus) onStatus({ type: 'connected' });
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Mendengarkan pesan masuk
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return; // Abaikan pesan sendiri atau status

        const senderJid = msg.key.remoteJid;
        const customerPhone = senderJid.split('@')[0];
        const customerName = msg.pushName || customerPhone;
        const imageMessage = msg.message.imageMessage || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "";

        if (!textMessage && !imageMessage) return; // Hanya memproses pesan teks atau gambar

        // Cek Knowledge Base untuk Aturan, Prompt, Blocked Numbers, dan Special Numbers
        let kb = null;
        try {
            const { data } = await supabase
                .from('knowledge_base')
                .select('store_rules, system_prompt, blocked_numbers, special_numbers')
                .eq('user_id', userId)
                .single();
            kb = data;
        } catch (err) {
            console.warn('⚠️ Gagal ambil knowledge_base:', err.message);
        }

        // Cek apakah nomor diblokir atau merupakan nomor khusus/admin
        if (kb && (kb.blocked_numbers || kb.special_numbers)) {
            let ignoreList = [];
            if (kb.blocked_numbers) {
                ignoreList = ignoreList.concat(kb.blocked_numbers.split(/[\n,]+/).map(n => n.trim()).filter(Boolean));
            }
            if (kb.special_numbers) {
                ignoreList = ignoreList.concat(kb.special_numbers.split(/[\n,]+/).map(n => n.trim()).filter(Boolean));
            }
            
            const isIgnored = ignoreList.some(ignoredNum => {
                if (ignoredNum === customerPhone) return true;
                // Jika UI menambahkan '62' di depan secara paksa, kita hapus 62 nya dan cocokkan
                if (ignoredNum.replace(/^62/, '') === customerPhone) return true;
                // Atau jika customerPhone yang ada 62 nya tapi di database nggak ada
                if (customerPhone.replace(/^62/, '') === ignoredNum.replace(/^62/, '')) return true;
                // Atau jika format di database pakai '0' di depan
                if (ignoredNum.replace(/^0/, '62') === customerPhone) return true;
                return false;
            });

            if (isIgnored) {
                console.log(`🚫 Pesan dari ${customerPhone} diabaikan (masuk daftar blokir atau nomor khusus)`);
                return; // Abaikan pesan dari nomor ini
            }
        }

        console.log(`📩 Pesan dari ${customerName} (${customerPhone}): ${textMessage}`);

        // Simpan ke in-memory history SEGERA
        addToMemory(userId, customerPhone, 'customer', textMessage);

        // 1. Simpan pesan pelanggan ke Supabase (best-effort, tidak block proses)
        supabase.from('chats').insert([{
            user_id: userId,
            customer_phone: customerPhone,
            customer_name: customerName,
            message: textMessage,
            sender: 'customer',
            status: 'handled_by_ai'
        }]).then(({error}) => {
            if (error) console.warn('⚠️ Gagal simpan pesan ke Supabase:', error.message);
        });

        try {
            // Gabungkan system_prompt (AI Persona) + store_rules menjadi satu konteks
            const storeRules = [
                kb?.system_prompt ? `=== PERSONA AI (PRIORITAS UTAMA) ===\n${kb.system_prompt}` : '',
                kb?.store_rules ? `=== ATURAN & INFO TOKO ===\n${kb.store_rules}` : ''
            ].filter(Boolean).join('\n\n') || 'Layani pelanggan dengan ramah dan profesional.';


            // 3. Ambil Katalog Produk
            const { data: products } = await supabase
                .from('products')
                .select('*')
                .eq('user_id', userId);

            // 4. Gunakan in-memory history sebagai primary source
            const memHistory = getFromMemory(userId, customerPhone);
            
            // Fallback ke Supabase jika memory kosong
            let history = memHistory;
            if (memHistory.length <= 1) {
                const { data: chatHistory, error: historyError } = await supabase
                    .from('chats')
                    .select('sender, message')
                    .eq('user_id', userId)
                    .eq('customer_phone', customerPhone)
                    .order('id', { ascending: false })
                    .limit(15);
                if (historyError) console.warn("⚠️ Gagal ambil histori Supabase:", historyError.message);
                if (chatHistory && chatHistory.length > 0) {
                    history = chatHistory.reverse();
                    // Sinkronkan ke memori
                    inMemoryHistory[getMemoryKey(userId, customerPhone)] = [...history];
                }
            }
            console.log(`📚 Histori chat ${customerPhone}: ${history.length} pesan (memory: ${memHistory.length})`);

            let aiReply = "";

            // --- SKENARIO 2: JIKA PESAN BERUPA GAMBAR, GUNAKAN GEMINI ---
            if (imageMessage) {
                console.log(`🖼️ Menerima gambar dari ${customerName}, memproses dengan Gemini...`);
                try {
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { reuploadRequest: sock.updateMediaMessage }
                    );
                    const base64Image = buffer.toString('base64');
                    const mimeType = imageMessage.mimetype || 'image/jpeg';
                    const caption = imageMessage.caption || textMessage || "";
                    
                    aiReply = await processImageWithGemini(base64Image, mimeType, caption, storeRules, products, history);
                    
                    // Cek tag validasi struk
                    const validReceiptMatch = aiReply.match(/\[VALID_RECEIPT:(\d+)\]/i);
                    if (validReceiptMatch) {
                        const transferNominal = parseInt(validReceiptMatch[1]);
                        aiReply = aiReply.replace(/\[VALID_RECEIPT:\d+\]/gi, '').trim();
                        console.log(`✅ Deteksi bukti bayar dengan nominal: ${transferNominal}`);
                        
                        // Update Supabase invoice yang PENDING untuk user ini
                        supabase.from('invoices')
                            .update({ status: 'PAID' })
                            .eq('user_id', userId)
                            .eq('customer_phone', customerPhone)
                            .eq('status', 'PENDING')
                            .then(({error}) => {
                                if (error) console.error("Gagal update invoice PAID:", error.message);
                                else console.log(`✅ Invoice untuk ${customerPhone} diupdate menjadi PAID`);
                            });
                    }
                    
                    // Cek apakah perlu forward ke admin
                    let isForwardToAdmin = false;
                    if (aiReply.includes('[FORWARD_TO_ADMIN]')) {
                        isForwardToAdmin = true;
                        aiReply = aiReply.replace(/\[FORWARD_TO_ADMIN\]/gi, '').trim();
                    }

                    // Kirim balasan AI
                    await sock.sendMessage(senderJid, { text: aiReply });
                    console.log(`✅ Balas (Gemini) ke ${customerName}: ${aiReply}`);
                    
                    // Logika forward ke Admin
                    if (isForwardToAdmin && kb && kb.special_numbers) {
                        const adminNumbers = kb.special_numbers.split(/[\n,]+/).map(n => n.trim()).filter(Boolean);
                        for (const adminNum of adminNumbers) {
                            let formattedAdmin = adminNum;
                            if (formattedAdmin.startsWith('0')) formattedAdmin = '62' + formattedAdmin.substring(1);
                            formattedAdmin = formattedAdmin.replace(/\D/g, '');
                            const adminJid = formattedAdmin + '@s.whatsapp.net';
                            
                            const forwardMsg = `🚨 *PANGGILAN ADMIN* 🚨\n\nPelanggan butuh bantuan admin.\n\n👤 Nama: ${customerName}\n📱 No: ${customerPhone}\n💬 Pesan: "${textMessage}"\n\nBalas ke: wa.me/${customerPhone}`;
                            
                            try {
                                await sock.sendMessage(adminJid, { text: forwardMsg });
                                console.log(`✅ Forwarded to admin ${formattedAdmin} (Image Block)`);
                            } catch (err) {
                                console.error(`Gagal forward ke admin ${formattedAdmin}:`, err.message);
                            }
                        }
                    }
                    
                    // Simpan balasan ke in-memory & Supabase
                    addToMemory(userId, customerPhone, 'ai', aiReply);
                    supabase.from('chats').insert([{
                        user_id: userId,
                        customer_phone: customerPhone,
                        customer_name: customerName,
                        message: aiReply,
                        sender: 'ai',
                        status: 'sent'
                    }]).then();
                    
                    return; // Stop eksekusi agar tidak lanjut ke Groq / Regex
                } catch (err) {
                    console.error("Gagal memproses gambar:", err);
                    aiReply = "Maaf kak, sistem kami gagal membaca gambarnya. Bisa diketik saja? 🙏";
                    await sock.sendMessage(senderJid, { text: aiReply });
                    return;
                }
            }
            // -----------------------------------------------------------

            // =============================================
            // HELPER: Ekstrak lokasi dari teks atau histori
            // =============================================
            function extractLokasiFromText(text) {
                if (!text) return null;
                // Gabungkan kecamatan + kota jika keduanya ada (lebih spesifik untuk RajaOngkir)
                const kecMatch = text.match(/kec(?:amatan)?\.?\s+([a-zA-Z\s]+?)(?:,|\s+kota|\s+kab|\s+kel|$)/i);
                const kotaMatch = text.match(/kota\s+([a-zA-Z\s]+?)(?:,|\n|$)/i) || text.match(/kab(?:upaten)?\.?\s+([a-zA-Z\s]+?)(?:,|\n|$)/i);
                
                if (kecMatch && kotaMatch) {
                    return `${kecMatch[1].trim()} ${kotaMatch[1].trim()}`;
                }
                if (kecMatch) return kecMatch[1].trim();
                if (kotaMatch) return kotaMatch[1].trim();
                return null;
            }

            function extractLokasiFromHistory(hist) {
                const customerMsgs = hist.filter(h => h.sender === 'customer').reverse();
                for (const msg of customerMsgs) {
                    const lokasi = extractLokasiFromText(msg.message || '');
                    if (lokasi && lokasi.length >= 3) return lokasi;
                }
                return null;
            }

            // =============================================
            // DETEKSI JENIS PESAN
            // =============================================
            const lowerText = textMessage.toLowerCase().trim();
            
            // 1. Intercept sapaan singkat agar AI tidak nge-gas bahas order/COD
            const isGreeting = /^(halo|hai|hallo|helo|p|ping|pagi|siang|sore|malam|assalamualaikum|assalamu'alaikum)( kak| gan| min| bos| min)?$/i.test(lowerText);
            if (isGreeting) {
                const sapaanReply = "Halo kak! 👋 Ada yang bisa kami bantu?";
                await sock.sendMessage(senderJid, { text: sapaanReply });
                addToMemory(userId, customerPhone, 'ai', sapaanReply);
                supabase.from('chats').insert([{
                    user_id: userId, customer_phone: customerPhone, customer_name: customerName,
                    message: sapaanReply, sender: 'ai', status: 'sent'
                }]).then();
                console.log(`✅ Balas sapaan otomatis ke ${customerName}`);
                return;
            }
            
            // 2. Ekstrak intent dan lokasi menggunakan Gemini (AI Intent Analyzer)
            const intentData = await extractIntentWithGemini(textMessage, history);
            console.log(`🧠 Gemini Intent: ${intentData.intent}, Location: ${intentData.location}`);

            const intent = intentData.intent;
            
            if (intent === 'SELECT_COURIER') {
                // =============================================
                // USER SUDAH PILIH KURIR → BUAT INVOICE FINAL
                // =============================================
                let kurirDipilih = 'JNE REG';
                const isJNE = lowerText.includes('jne');
                const isJNT = lowerText.includes('jnt') || lowerText.includes('j&t');
                if (isJNT) kurirDipilih = 'J&T EXPRESS';
                else if (isJNE) kurirDipilih = 'JNE REG';

                // === PRIMARY: Gunakan pendingOrder cache (paling akurat) ===
                const pendingOrder = activeSessions[userId]?.pendingOrder;
                let produk, namaPenerima, alamat, hargaBarangDisplay, ongkirFinal, grandTotalFinal;

                if (pendingOrder) {
                    produk = pendingOrder.produk || '-';
                    namaPenerima = pendingOrder.namaPenerima || customerName;
                    alamat = pendingOrder.alamat || '-';

                    // Pilih ongkir sesuai kurir yang dipilih user
                    let selectedRate = null;
                    if (pendingOrder.shippingRates && pendingOrder.shippingRates.length > 0) {
                        if (isJNT) {
                            selectedRate = pendingOrder.shippingRates.find(r => {
                                const n = (r.name || r.courier || '').toLowerCase();
                                return n.includes('jnt') || n.includes('j&t');
                            });
                        } else {
                            selectedRate = pendingOrder.shippingRates.find(r => {
                                const n = (r.name || r.courier || '').toLowerCase();
                                return n.includes('jne');
                            });
                        }
                        if (!selectedRate) selectedRate = pendingOrder.shippingRates[0];
                    }

                    ongkirFinal = selectedRate ? Number(selectedRate.cost || selectedRate.price || 0) : 0;
                    grandTotalFinal = (pendingOrder.totalBarang || 0) + ongkirFinal;
                    hargaBarangDisplay = (pendingOrder.totalBarang || 0).toLocaleString('id-ID');

                    // Bersihkan cache setelah dipakai
                    activeSessions[userId].pendingOrder = null;
                    console.log(`✅ Invoice dari pendingOrder: ${produk}, harga: ${pendingOrder.totalBarang}, ongkir: ${ongkirFinal}`);

                } else {
                    // === FALLBACK: Cari dari seluruh riwayat chat ===
                    console.warn('⚠️ pendingOrder tidak ada, fallback ke parsing riwayat chat');
                    const aiMsgs = history.filter(h => h.sender === 'ai');
                    const custMsgsText = history.filter(h => h.sender === 'customer').map(h => h.message || '').join('\n');
                    const allHistText = history.map(h => h.message || '').join(' ').toLowerCase();

                    // Cari harga barang dari SEMUA pesan AI (bukan hanya yang terakhir)
                    let hargaBarangInt = 0;
                    for (const msg of aiMsgs.slice().reverse()) {
                        const m = (msg.message || '').match(/💰 Harga Barang: Rp ([\d.]+)/i);
                        if (m) { hargaBarangInt = parseInt(m[1].replace(/\./g, '')) || 0; break; }
                    }

                    // Cari ongkir berdasarkan kurir yang dipilih dari semua pesan AI
                    let ongkirFromMsg = 0;
                    const kurirKey = isJNT ? 'J&T' : 'JNE';
                    for (const msg of aiMsgs.slice().reverse()) {
                        const m = (msg.message || '').match(new RegExp(`\\*${kurirKey}[^*]*\\*[:\\s]*Rp ([\\d.]+)`, 'i'))
                            || (msg.message || '').match(new RegExp(`${kurirKey}[^:]*:\\s*Rp ([\\d.]+)`, 'i'));
                        if (m) { ongkirFromMsg = parseInt(m[1].replace(/\./g, '')) || 0; break; }
                    }

                    // Cari nama produk dari semua pesan AI
                    let produkFromHistory = '-';
                    for (const msg of aiMsgs.slice().reverse()) {
                        const m = (msg.message || '').match(/📦 Produk: (.+?)(?:\n|$)/i);
                        if (m) { produkFromHistory = m[1].trim(); break; }
                    }
                    // Fallback: cocokkan nama produk dari katalog dengan riwayat chat
                    if (produkFromHistory === '-' && products && products.length > 0) {
                        const found = products.find(p => {
                            const n = (p.name || p.title || '').toLowerCase();
                            return n.length > 2 && allHistText.includes(n);
                        });
                        if (found) {
                            const qtyM = allHistText.match(/(\d+)\s*pcs/i);
                            const qty = qtyM ? parseInt(qtyM[1]) : 1;
                            produkFromHistory = `${found.name || found.title} x ${qty} pcs`;
                            if (hargaBarangInt === 0) hargaBarangInt = Number(found.price || 0) * qty;
                        }
                    }

                    // Cari nama penerima & alamat dari pesan pelanggan
                    const allCustAndCurrent = custMsgsText + '\n' + textMessage;
                    const namaM = allCustAndCurrent.match(/nama\s+([a-zA-Z\s]+?)(?:\s*,|\s+alamat|\s+jl|\s+kec|\n|$)/i);
                    const namaFromHist = namaM ? namaM[1].trim() : customerName;
                    const jlM = allCustAndCurrent.match(/(?:jl\.|jalan)\s+.+?(?=,\s*kec|,\s*kel|\n|$)/i);
                    const kecM = allCustAndCurrent.match(/kec(?:amatan)?\s*[\w\s]+/i);
                    const alamatFromHist = [jlM?.[0], kecM?.[0]].filter(Boolean).join(', ') || '-';

                    produk = produkFromHistory;
                    namaPenerima = namaFromHist;
                    alamat = alamatFromHist;
                    ongkirFinal = ongkirFromMsg;
                    grandTotalFinal = hargaBarangInt + ongkirFinal;
                    hargaBarangDisplay = hargaBarangInt.toLocaleString('id-ID');
                    console.log(`⚠️ Invoice fallback: produk=${produk}, harga=${hargaBarangInt}, ongkir=${ongkirFinal}`);
                }

                const rekeningLine = kb?.store_rules?.match(/(?:rekening|transfer|BCA|Mandiri|BRI|bank)[^\n]*/i)?.[0] 
                    || (storeRules && storeRules.match(/(?:rekening|transfer|BCA|Mandiri|BRI|bank)[^\n]*/i)?.[0])
                    || 'Transfer Bank / E-Wallet: Tersedia';

                aiReply =
                    `Oke kak, pesanan dikonfirmasi dengan *${kurirDipilih}*! 🎉\n\n` +
                    `━━━━━━━━━━━━━━━━━\n` +
                    `📋 *INVOICE FINAL*\n` +
                    `━━━━━━━━━━━━━━━━━\n` +
                    `📦 ${produk}\n` +
                    `💰 Harga Barang: Rp ${hargaBarangDisplay}\n` +
                    `🚚 Ongkir (${kurirDipilih}): Rp ${ongkirFinal.toLocaleString('id-ID')}\n` +
                    `💳 *TOTAL: Rp ${grandTotalFinal.toLocaleString('id-ID')}*\n` +
                    `━━━━━━━━━━━━━━━━━\n` +
                    `👤 Penerima: ${namaPenerima}\n` +
                    `📍 Alamat: ${alamat}\n` +
                    `━━━━━━━━━━━━━━━━━\n` +
                    `💳 Silakan transfer ke:\n${rekeningLine}\n\n` +
                    `Setelah transfer, kirim bukti pembayaran ke sini ya kak 🙏\nPaket akan kami proses segera setelah pembayaran dikonfirmasi! 📦✨`;

                console.log(`✅ Invoice final dengan ${kurirDipilih} untuk ${namaPenerima}`);
                
                const invoiceIdStr = 'INV-' + Date.now();
                supabase.from('invoices').insert([{
                    user_id: userId,
                    customer_phone: customerPhone,
                    customer_name: namaPenerima,
                    total_amount: grandTotalFinal,
                    payment_method: 'Transfer',
                    status: 'PENDING',
                    invoice_id: invoiceIdStr
                }]).then(({error}) => {
                    if (error) console.warn('⚠️ Gagal simpan invoice ke Supabase:', error.message);
                });

            } else if (intent === 'ASK_COD') {
                console.log(`💳 Deteksi pertanyaan COD dari ${customerName}`);
                const codRules = (kb?.store_rules || '').toLowerCase();
                const systemPromptRules = (kb?.system_prompt || '').toLowerCase();
                const allRulesText = `${kb?.store_rules || ''}\n${kb?.system_prompt || ''}`;
                
                const hasCODPolicy = codRules.includes('cod') || codRules.includes('bayar di tempat') 
                    || codRules.includes('bayar ditempat') || codRules.includes('cash on delivery')
                    || systemPromptRules.includes('cod') || systemPromptRules.includes('bayar di tempat')
                    || systemPromptRules.includes('bayar ditempat');

                let codContext = '';
                if (hasCODPolicy) {
                    const codLines = allRulesText.split('\n')
                        .filter(line => {
                            const l = line.toLowerCase();
                            return l.includes('cod') || l.includes('bayar di tempat') 
                                || l.includes('bayar ditempat') || l.includes('cash on delivery');
                        })
                        .join('\n');
                    codContext = `\n\n[KONTEKS SISTEM: COD_INFO]\nATURAN COD DARI TOKO (gunakan info ini untuk menjawab):\n${codLines || allRulesText.substring(0, 500)}\nJawab pertanyaan COD pelanggan berdasarkan aturan di atas. Jawab singkat dan langsung.`;
                } else {
                    codContext = `\n\n[KONTEKS SISTEM: COD_INFO]\nToko ini TIDAK menyediakan COD / bayar di tempat. Jawab dengan sopan bahwa pembayaran hanya melalui transfer bank atau QRIS. JANGAN mengarang bahwa COD tersedia.`;
                }

                aiReply = await generateAIResponse(
                    textMessage + codContext,
                    storeRules,
                    products,
                    history,
                    ""
                );
                console.log(`✅ Jawaban COD untuk ${customerName}`);

            } else if (intent === 'CANCEL') {
                aiReply = "Baik kak, pesanannya sudah kami batalkan ya. Jika ada yang ingin ditanyakan lagi, jangan ragu untuk menghubungi kami kembali! 🙏";
                console.log(`✅ Batal dari ${customerName}`);
            } else if (intent === 'CHECK_SHIPPING') {
                const queryLokasi = intentData.location;
                console.log(`🔍 Query ongkir dari pesan: "${queryLokasi}"`);

                if (queryLokasi && queryLokasi.length >= 3) {
                    const destinations = await searchDestination(queryLokasi);

                    if (destinations && destinations.length > 0) {
                        const target = destinations[0];
                        const destId = target.id || target.subdistrict_id || target.city_id;
                        const destLabel = target.label || target.subdistrict_name || target.city_name || queryLokasi;

                        console.log(`📍 Destinasi ditemukan: ${destLabel} (ID: ${destId})`);
                        const shippingRates = await calculateShipping(destId, 1000);

                        if (shippingRates && shippingRates.length > 0) {
                            const filteredRates = shippingRates.filter(r => {
                                const n = (r.name || r.courier || '').toLowerCase();
                                const s = (r.service || '').toLowerCase();
                                return (n.includes('jne') && (s.includes('reg') || !s)) ||
                                       (n.includes('jnt') || n.includes('j&t'));
                            });
                            const displayRates = filteredRates.length > 0 ? filteredRates : shippingRates.slice(0, 2);
                            const listOngkir = displayRates.map(r => {
                                const harga = Number(r.cost || r.price || 0).toLocaleString('id-ID');
                                const etd = (r.etd || '1-3').replace(/day/gi,'').replace(/hari/gi,'').trim();
                                const n = (r.name || r.courier || '').toLowerCase();
                                const kurir = (n.includes('jnt') || n.includes('j&t')) ? 'J&T EXPRESS' : 'JNE REG';
                                return `• *${kurir}*: Rp ${harga} (est. ${etd} hari)`;
                            }).join('\n');
                            aiReply = `Ongkir ke *${destLabel}* (berat 1 kg):\n\n${listOngkir}\n\nMau pilih *JNE REG* atau *J&T* kak? 😊`;

                            // =============================================
                            // Cache order context untuk SELECT_COURIER nanti
                            // =============================================
                            try {
                                const allHistTextShip = history.map(h => h.message || '').join(' ').toLowerCase();
                                const allHistRawShip = history.map(h => h.message || '').join('\n');
                                let foundProduct = null, foundQty = 1;
                                if (products && products.length > 0) {
                                    foundProduct = products.find(p => {
                                        const pName = (p.name || p.title || '').toLowerCase();
                                        return pName.length > 2 && allHistTextShip.includes(pName);
                                    });
                                }
                                if (foundProduct) {
                                    const qtyM2 = allHistTextShip.match(/(\d+)\s*pcs/i) || allHistTextShip.match(/(\d+)\s*buah/i);
                                    if (qtyM2) foundQty = parseInt(qtyM2[1]);
                                    const namaM2 = (textMessage + '\n' + allHistRawShip).match(/nama\s+([a-zA-Z\s]+?)(?:\s*,|\s+alamat|\s+jl|\s+kec|\n|$)/i);
                                    const foundNama = namaM2 ? namaM2[1].trim() : customerName;
                                    const alamatSrc2 = textMessage + '\n' + allHistRawShip;
                                    const jlM2 = alamatSrc2.match(/(?:jl\.|jalan)\s+.+?(?=,\s*kec|,\s*kel|\n|$)/i);
                                    const kecM2 = alamatSrc2.match(/kec(?:amatan)?\s*[\w\s]+/i);
                                    const foundAlamat = [jlM2?.[0], kecM2?.[0]].filter(Boolean).join(', ') || destLabel;
                                    activeSessions[userId].pendingOrder = {
                                        produk: `${foundProduct.name || foundProduct.title} x ${foundQty} pcs`,
                                        qty: foundQty,
                                        hargaProduk: Number(foundProduct.price || 0),
                                        totalBarang: Number(foundProduct.price || 0) * foundQty,
                                        namaPenerima: foundNama,
                                        alamat: foundAlamat,
                                        destLabel: destLabel,
                                        shippingRates: displayRates
                                    };
                                    console.log(`📦 pendingOrder cached (CHECK_SHIPPING): ${foundProduct.name} x${foundQty}, total: ${activeSessions[userId].pendingOrder.totalBarang}`);
                                }
                            } catch (cacheErr) {
                                console.warn('⚠️ Gagal cache pendingOrder di CHECK_SHIPPING:', cacheErr.message);
                            }
                        } else {
                            aiReply = `Maaf kak, belum dapat data ongkir ke *${destLabel}* saat ini. Coba lagi sebentar ya 🙏`;
                        }
                    } else {
                        aiReply = "Maaf kak, lokasi tidak ditemukan. Bisa sebutkan lebih lengkap?\nContoh: *Tambaksari, Surabaya* atau *Kecamatan Bekasi Timur, Kota Bekasi*";
                    }
                } else {
                    aiReply = "Mau cek ongkir ke mana kak? Sebutkan nama kota atau kecamatan tujuannya ya 😊";
                }
            } else {
                // intent === 'GENERAL'
                let autoShippingInfo = "";
                let autoShippingRates = null;
                let autoDestLabel = "";

                try {
                    const queryLokasi = intentData.location; 
                    if (queryLokasi && queryLokasi.length >= 3) {
                        console.log(`🚀 Auto-hitung ongkir: "${queryLokasi}"`);
                        const destinations = await searchDestination(queryLokasi);
                        if (destinations && destinations.length > 0) {
                            const target = destinations[0];
                            const destId = target.id || target.subdistrict_id || target.city_id;
                            autoDestLabel = target.label || target.subdistrict_name || target.city_name || queryLokasi;
                            const rates = await calculateShipping(destId, 1000);
                            if (rates && rates.length > 0) {
                                autoShippingRates = rates;
                                autoShippingInfo = `Tujuan: ${autoDestLabel}\n` + rates.slice(0, 3).map(r =>
                                    `${(r.name || r.courier || 'Kurir').toUpperCase()} ${r.service || ''}: Rp ${Number(r.cost || r.price || 0).toLocaleString('id-ID')} (${r.etd || '1-3'} hari)`
                                ).join('\n');
                                console.log(`📦 Ongkir siap untuk invoice: ${autoDestLabel}`);
                            }
                        }
                    }
                } catch (shippingErr) {
                    console.warn("⚠️ Auto-shipping gagal:", shippingErr.message);
                }

                const allMessages = history.map(h => h.message || '').join(' ').toLowerCase();
                const hasProductInHistory = allMessages.includes('kaos') || allMessages.includes('produk') || allMessages.includes('order') || allMessages.includes('pesan');
                const hasAddressInMsg = /kec(?:amatan)?|jalan|jl\.|alamat/i.test(textMessage);
                const hasNameInMsg = /nama\s+\w+/i.test(textMessage);

                if (hasAddressInMsg && hasNameInMsg && hasProductInHistory && autoShippingRates) {
                    const namaMatch = textMessage.match(/nama\s+([a-zA-Z\s]+?)(?:\s+alamat|\s+jl|\s+kec|$)/i);
                    const namaPenerima = namaMatch ? namaMatch[1].trim() : customerName;

                    let produkOrdered = "Produk";
                    let hargaProduk = 0;
                    if (products && products.length > 0) {
                        const mentionedProduct = products.find(p => allMessages.includes((p.name || p.title || '').toLowerCase()));
                        if (mentionedProduct) {
                            produkOrdered = mentionedProduct.name || mentionedProduct.title;
                            hargaProduk = Number(mentionedProduct.price || 0);
                        } else {
                            produkOrdered = products[0].name || products[0].title;
                            hargaProduk = Number(products[0].price || 0);
                        }
                    }

                    const qtyMatch = allMessages.match(/(\d+)\s*pcs/i);
                    const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                    const totalBarang = hargaProduk * qty;

                    function singkatKurir(name, service) {
                        const n = (name || '').toLowerCase();
                        if (n.includes('jnt') || n.includes('j&t')) return 'J&T EXPRESS';
                        if (n.includes('jne')) return 'JNE REG';
                        return `${(name || 'Kurir').toUpperCase()} ${service || ''}`.trim();
                    }

                    function formatEtd(etd) {
                        if (!etd) return '1-3 hari';
                        const cleaned = etd.replace(/day/gi, '').replace(/hari/gi, '').trim();
                        return cleaned ? `${cleaned} hari` : '1-3 hari';
                    }

                    const filteredRates = autoShippingRates
                        .filter(r => {
                            const n = (r.name || r.courier || '').toLowerCase();
                            const s = (r.service || '').toLowerCase();
                            return (n.includes('jne') && (s.includes('reg') || !s)) ||
                                   (n.includes('jnt') || n.includes('j&t'));
                        })
                        .sort((a, b) => Number(a.cost || a.price || 0) - Number(b.cost || b.price || 0));

                    if (filteredRates.length === 0) {
                        filteredRates.push(...autoShippingRates.slice(0, 2));
                    }

                    const jneRate = filteredRates.find(r => (r.name || r.courier || '').toLowerCase().includes('jne'));
                    const bestRate = jneRate || filteredRates[0] || autoShippingRates[0];
                    const ongkirHarga = Number(bestRate.cost || bestRate.price || 0);
                    const kurirTerpilih = singkatKurir(bestRate.name || bestRate.courier, bestRate.service);
                    const grandTotal = totalBarang + ongkirHarga;

                    const opsiOngkir = filteredRates.map(r => {
                        const harga = Number(r.cost || r.price || 0).toLocaleString('id-ID');
                        const kurir = singkatKurir(r.name || r.courier, r.service);
                        const etd = formatEtd(r.etd);
                        return `  • *${kurir}*: Rp ${harga} (${etd})`;
                    }).join('\n');

                    const alamatBersih = textMessage
                        .replace(/^nama\s+\w[\w\s]*?(?=alamat|jl|kec|kab|jalan)/i, '')
                        .replace(/^\s*alamat\s*/i, '')
                        .trim();

                    aiReply = `Siap kak! Ini invoice pesanannya:\n\n` +
                        `━━━━━━━━━━━━━━━━━\n` +
                        `📋 *INVOICE PESANAN*\n` +
                        `━━━━━━━━━━━━━━━━━\n` +
                        `📦 Produk: ${produkOrdered} x ${qty} pcs\n` +
                        `💰 Harga Barang: Rp ${totalBarang.toLocaleString('id-ID')}\n` +
                        `\n🚚 *Pilihan Ongkir ke ${autoDestLabel}:*\n${opsiOngkir}\n` +
                        `\n💳 *Total dengan kurir termurah (${kurirTerpilih}):*\n` +
                        `   Rp ${totalBarang.toLocaleString('id-ID')} + Rp ${ongkirHarga.toLocaleString('id-ID')} = *Rp ${grandTotal.toLocaleString('id-ID')}*\n` +
                        `━━━━━━━━━━━━━━━━━\n` +
                        `👤 Penerima: ${namaPenerima}\n` +
                        `📍 Alamat: ${alamatBersih}\n` +
                        `━━━━━━━━━━━━━━━━━\n` +
                        `Kakak mau pilih kurir yang mana? (Bisa pilih **JNE REG** atau **J&T EXPRESS**) 😊`;
                        
                    console.log(`✅ Custom Invoice Pesanan untuk ${namaPenerima}`);

                    // Cache order data untuk SELECT_COURIER
                    activeSessions[userId].pendingOrder = {
                        produk: `${produkOrdered} x ${qty} pcs`,
                        qty: qty,
                        hargaProduk: hargaProduk,
                        totalBarang: totalBarang,
                        namaPenerima: namaPenerima,
                        alamat: alamatBersih,
                        destLabel: autoDestLabel,
                        shippingRates: filteredRates
                    };
                    console.log(`📦 pendingOrder cached (GENERAL): ${produkOrdered} x${qty}, total: ${totalBarang}`);
                } else {
                    aiReply = await generateAIResponse(
                        textMessage,
                        storeRules,
                        products,
                        history,
                        autoShippingInfo
                    );
                }
            }


            // Cek apakah perlu forward ke admin
            let isForwardToAdmin = false;
            if (aiReply.includes('[FORWARD_TO_ADMIN]')) {
                isForwardToAdmin = true;
                aiReply = aiReply.replace(/\[FORWARD_TO_ADMIN\]/gi, '').trim();
            }

            // Kirim balasan ke WhatsApp pelanggan
            await sock.sendMessage(senderJid, { text: aiReply });
            console.log(`✅ Balas ke ${customerName}: ${aiReply.substring(0, 100)}`);

            // Logika forward ke Admin
            if (isForwardToAdmin && kb && kb.special_numbers) {
                const adminNumbers = kb.special_numbers.split(/[\n,]+/).map(n => n.trim()).filter(Boolean);
                for (const adminNum of adminNumbers) {
                    let formattedAdmin = adminNum;
                    if (formattedAdmin.startsWith('0')) formattedAdmin = '62' + formattedAdmin.substring(1);
                    // Hapus jika masih ada '62' dobel atau bukan angka
                    formattedAdmin = formattedAdmin.replace(/\D/g, '');
                    const adminJid = formattedAdmin + '@s.whatsapp.net';
                    
                    const forwardMsg = `🚨 *PANGGILAN ADMIN* 🚨\n\nPelanggan butuh bantuan admin.\n\n👤 Nama: ${customerName}\n📱 No: ${customerPhone}\n💬 Pesan: "${textMessage}"\n\nBalas ke: wa.me/${customerPhone}`;
                    
                    try {
                        await sock.sendMessage(adminJid, { text: forwardMsg });
                        console.log(`✅ Forwarded to admin ${formattedAdmin}`);
                    } catch (err) {
                        console.error(`Gagal forward ke admin ${formattedAdmin}:`, err.message);
                    }
                }
            }

            // Simpan balasan AI ke in-memory history
            addToMemory(userId, customerPhone, 'ai', aiReply);

            // Simpan balasan AI ke Supabase (best-effort)
            supabase.from('chats').insert([{
                user_id: userId,
                customer_phone: customerPhone,
                customer_name: customerName,
                message: aiReply,
                sender: 'ai',
                status: 'handled_by_ai'
            }]).then(({error}) => {
                if (error) console.warn('⚠️ Gagal simpan balasan AI ke Supabase:', error.message);
            });

        } catch (err) {
            console.error("Gagal memproses pesan:", err);
        }
    });
}
// ==========================================
// REST API ENDPOINTS UNTUK DASHBOARD
// ==========================================

        // Endpoint untuk meminta QR Code
        app.post('/api/bot/start', async (req, res) => {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'userId diperlukan' });

            if (activeSessions[userId]) {
                return res.json({ status: activeSessions[userId].status, message: 'Bot sudah dipanggil' });
            }

            try {
                const eventPromise = new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error("Timeout menunggu status WhatsApp (mungkin backend lambat)"));
                    }, 15000); // 15 detik timeout

                    startWhatsAppBot(userId, (event) => {
                        clearTimeout(timeout);
                        resolve(event);
                    }).catch(reject);
                });

                const event = await eventPromise;
                if (event.type === 'qr') {
                    res.json({ status: 'qr', qr: event.data });
                } else {
                    res.json({ status: 'CONNECTED', message: 'WhatsApp langsung terhubung' });
                }
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: 'Gagal menjalankan bot: ' + error.message });
            }
        });

        // Endpoint untuk mengecek status bot
        app.get('/api/bot/status/:userId', (req, res) => {
            const { userId } = req.params;
            const session = activeSessions[userId];
            if (session) {
                if (session.status === 'CONNECTED') {
                    res.json({ status: 'CONNECTED', isBotActive: true });
                } else if (session.status === 'SCAN_QR') {
                    // Jika masih menunggu scan QR, kembalikan qr nya jika ada
                    res.json({ status: 'qr', qr: session.qr });
                } else {
                    res.json({ status: 'CONNECTING' });
                }
            } else {
                res.json({ status: 'DISCONNECTED' });
            }
        });

        // Endpoint untuk mematikan bot
        app.post('/api/bot/stop', (req, res) => {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'userId diperlukan' });

            if (activeSessions[userId]) {
                activeSessions[userId].sock.ws.close();
                delete activeSessions[userId];
                res.json({ message: 'Bot berhasil dimatikan' });
            } else {
                res.json({ message: 'Bot sudah dalam keadaan mati' });
            }
        });

        // Endpoint untuk logout / tautkan ulang (hapus sesi)
        app.post('/api/bot/logout', async (req, res) => {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'userId diperlukan' });

            try {
                if (activeSessions[userId] && activeSessions[userId].sock) {
                    try {
                        await activeSessions[userId].sock.logout();
                    } catch (e) {
                        console.warn('Socket logout failed:', e.message);
                    }
                    delete activeSessions[userId];
                }
                const fs = require('fs');
                const path = require('path');
                const sessionPath = path.join(__dirname, `auth_info_${userId}`);
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                }
                res.json({ message: 'Sesi WhatsApp berhasil dihapus. Silakan klik Jalankan Bot untuk tautkan ulang.' });
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: 'Gagal menghapus sesi' });
            }
        });
        // ==========================================
        // ADMIN API ENDPOINTS (SUPER ADMIN)
        // ==========================================
        
        // Ambil semua pengguna (tenant)
        app.get('/api/admin/users', async (req, res) => {
            try {
                const { data, error } = await supabase.auth.admin.listUsers();
                if (error) throw error;
                res.json(data.users || []);
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Tambah pengguna (tenant) baru
        app.post('/api/admin/add-customer', async (req, res) => {
            const { email, password } = req.body;
            try {
                const { data, error } = await supabase.auth.admin.createUser({
                    email,
                    password,
                    email_confirm: true
                });
                if (error) throw error;
                res.json({ message: 'Customer created successfully', user: data.user });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Edit pengguna (tenant)
        app.post('/api/admin/edit-user', async (req, res) => {
            const { userId, plan, status } = req.body;
            if (!userId) return res.status(400).json({ error: 'User ID required' });
            try {
                const { data, error } = await supabase.auth.admin.updateUserById(userId, {
                    user_metadata: { plan, status }
                });
                if (error) throw error;
                res.json({ message: 'User updated successfully', user: data.user });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Broadcast pesan ke semua tenant aktif
        app.post('/api/admin/broadcast', async (req, res) => {
            const { message } = req.body;
            if (!message) return res.status(400).json({ error: 'Message required' });
            
            let sentCount = 0;
            for (const userId in activeSessions) {
                const session = activeSessions[userId];
                if (session.status === 'CONNECTED' && session.sock && session.sock.user) {
                    try {
                        const myJid = session.sock.user.id.split(':')[0] + '@s.whatsapp.net';
                        await session.sock.sendMessage(myJid, { text: `📢 *PENGUMUMAN SISTEM (ADMIN)*\n\n${message}` });
                        sentCount++;
                    } catch (err) {
                        console.error(`Failed to send broadcast to ${userId}:`, err.message);
                    }
                }
            }
            res.json({ message: `Broadcast sent to ${sentCount} active tenants` });
        });

        // Update resi dan kirim notifikasi ke pelanggan
        app.post('/api/admin/update-resi', async (req, res) => {
            const { userId, invoiceId, customerPhone, courier, resiNumber } = req.body;
            if (!userId || !customerPhone || !resiNumber) {
                return res.status(400).json({ error: 'Data tidak lengkap' });
            }

            try {
                const session = activeSessions[userId];
                if (session && session.status === 'CONNECTED' && session.sock) {
                    let formattedPhone = customerPhone;
                    if (formattedPhone.startsWith('0')) formattedPhone = '62' + formattedPhone.substring(1);
                    formattedPhone = formattedPhone.replace(/\D/g, '');
                    const jid = formattedPhone + '@s.whatsapp.net';
                    
                    const kurir = courier || 'Ekspedisi';
                    const msg = `Halo kak! 👋\n\nPesanan kakak (Invoice: ${invoiceId || '-'}) sudah kami kirim melalui *${kurir}*.\n📦 *Nomor Resi: ${resiNumber}*\n\nSilakan dilacak pengirimannya ya kak. Terima kasih sudah berbelanja! 🙏`;
                    
                    await session.sock.sendMessage(jid, { text: msg });
                    
                    addToMemory(userId, customerPhone, 'ai', msg);
                    await supabase.from('chats').insert([{
                        user_id: userId,
                        customer_phone: customerPhone,
                        customer_name: 'Pelanggan',
                        message: msg,
                        sender: 'ai',
                        status: 'sent'
                    }]);
                    
                    res.json({ message: 'Resi berhasil dikirim ke pelanggan' });
                } else {
                    res.status(400).json({ error: 'Bot WhatsApp belum terhubung. Silakan scan QR terlebih dahulu.' });
                }
            } catch (err) {
                console.error("Gagal update resi:", err);
                res.status(500).json({ error: err.message });
            }
        });

        // Health check endpoint
        app.get('/health', (req, res) => {
            res.status(200).send('OK');
        });

        // Menjalankan Server API (bind ke 0.0.0.0 agar bisa diakses di dalam Docker)
        const PORT = process.env.PORT || 3001;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server Backend Bot berjalan di port ${PORT}`);
        });
