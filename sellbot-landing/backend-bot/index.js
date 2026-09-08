require('dotenv').config({ path: require('path').join(__dirname, '.env') });

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
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, extractMessageContent } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');
const { generateAIResponse, processImageWithGemini, extractIntentWithGemini, extractOrderDetails, cleanAndValidateLocation } = require('./ai');
const { searchDestination, calculateShipping } = require('./shipping');

const fs = require('fs');
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
 * Mendapatkan atau menginisialisasi sesi per-pelanggan terisolasi
 */
function getCustomerSession(userId, customerPhone) {
    if (!activeSessions[userId]) {
        activeSessions[userId] = { sock: null, status: 'UNKNOWN', qr: null, customers: {} };
    }
    if (!activeSessions[userId].customers) {
        activeSessions[userId].customers = {};
    }
    if (!activeSessions[userId].customers[customerPhone]) {
        activeSessions[userId].customers[customerPhone] = {
            pendingOrder: null,
            lastDestination: null
        };
    }
    return activeSessions[userId].customers[customerPhone];
}

// In-memory cache untuk mapping WhatsApp LID ke nomor telepon asli
const lidToPhoneCache = new Map();

/**
 * Mendapatkan nomor HP asli pelanggan dari pesan Baileys (mengatasi LID WhatsApp)
 */
async function resolveCustomerPhoneNumber(msg, sock, userId) {
    const senderJid = msg.key?.remoteJid || '';
    
    // 1. Jika sudah nomor WhatsApp biasa (@s.whatsapp.net)
    if (senderJid.endsWith('@s.whatsapp.net')) {
        return senderJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    }

    const lidUser = senderJid.split('@')[0].split(':')[0];

    // Cek cache memori
    if (lidToPhoneCache.has(lidUser)) {
        return lidToPhoneCache.get(lidUser);
    }

    // 2. Cek remoteJidAlt atau participantAlt dari Baileys message key
    const altJid = msg.key?.remoteJidAlt || msg.key?.participantAlt;
    if (altJid && altJid.endsWith('@s.whatsapp.net')) {
        const num = altJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (num) {
            lidToPhoneCache.set(lidUser, num);
            return num;
        }
    }

    // 3. Cek participant jika ada
    const participant = msg.key?.participant;
    if (participant && participant.endsWith('@s.whatsapp.net')) {
        const num = participant.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (num) {
            lidToPhoneCache.set(lidUser, num);
            return num;
        }
    }

    // 4. Jika senderJid adalah LID (@lid), coba query signalRepository Baileys
    if (senderJid.endsWith('@lid') && sock?.signalRepository?.lidMapping?.getPNForLID) {
        try {
            const pn = await sock.signalRepository.lidMapping.getPNForLID(senderJid);
            if (pn) {
                const num = pn.split('@')[0].split(':')[0].replace(/\D/g, '');
                if (num) {
                    console.log(`📱 Berhasil resolve LID ${senderJid} -> PN ${num} (via signalRepository)`);
                    lidToPhoneCache.set(lidUser, num);
                    return num;
                }
            }
        } catch (e) {
            console.warn('⚠️ Gagal getPNForLID:', e.message);
        }
    }

    // 5. Cek file reverse mapping Baileys di semua folder auth yang tersedia
    if (senderJid.endsWith('@lid') || (lidUser && lidUser.length >= 14)) {
        const potentialRoots = [
            __dirname,
            process.cwd(),
            path.join(process.cwd(), 'sellbot-landing', 'backend-bot'),
            path.join(__dirname, '..')
        ];
        for (const root of potentialRoots) {
            try {
                if (fs.existsSync(root)) {
                    const entries = fs.readdirSync(root, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isDirectory() && entry.name.startsWith('auth_info')) {
                            const mappingFile = path.join(root, entry.name, `lid-mapping-${lidUser}_reverse.json`);
                            if (fs.existsSync(mappingFile)) {
                                try {
                                    const raw = fs.readFileSync(mappingFile, 'utf8');
                                    const data = JSON.parse(raw);
                                    if (typeof data === 'string' && data.trim()) {
                                        const cleanPn = data.replace(/\D/g, '');
                                        if (cleanPn && cleanPn.length >= 9) {
                                            console.log(`📱 Berhasil resolve LID ${lidUser} -> PN ${cleanPn} (via ${entry.name})`);
                                            lidToPhoneCache.set(lidUser, cleanPn);
                                            return cleanPn;
                                        }
                                    }
                                } catch (e) {
                                    console.warn('⚠️ Gagal baca file lid-mapping:', e.message);
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                // Ignore read errors
            }
        }
    }

    // 6. Cek apakah ada nomor telepon yang diketik di pesan saat ini
    const rawText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || "";
    const phoneInText = rawText.match(/(?:wa|no|nomor|hp)?\s*[:\s]?\s*(08\d{8,12}|628\d{8,12}|\+628\d{8,12})/i);
    if (phoneInText) {
        let clean = phoneInText[1].replace(/\D/g, '');
        if (clean.startsWith('0')) clean = '62' + clean.substring(1);
        if (clean.length >= 10) {
            console.log(`📱 Berhasil ambil nomor HP dari isi pesan chat: ${clean}`);
            lidToPhoneCache.set(lidUser, clean);
            return clean;
        }
    }

    // Fallback terakhir: user ID
    return lidUser;
}

/**
 * Mengambil dan menormalisasi daftar nomor admin / nomor khusus
 * Mendukung format: 08xxx, 628xxx, +62 8xxx, dipisahkan koma atau newline
 * Sumber: kb.special_numbers, kb.admin_numbers, process.env.ADMIN_PHONE, process.env.SPECIAL_NUMBERS
 */
function getAdminNumberList(kb) {
    const rawList = [
        kb?.special_numbers,
        kb?.admin_numbers,
        process.env.ADMIN_PHONE,
        process.env.SPECIAL_NUMBERS
    ].filter(Boolean).join('\n');

    if (!rawList) return [];

    const numbers = rawList.split(/[\n,]+/).map(n => n.trim()).filter(Boolean);
    const unique = new Set();

    for (const num of numbers) {
        let clean = num.replace(/\D/g, '');
        if (!clean) continue;
        if (clean.startsWith('0')) {
            clean = '62' + clean.substring(1);
        } else if (!clean.startsWith('62') && clean.length >= 9) {
            clean = '62' + clean;
        }
        if (clean.length >= 10) {
            unique.add(clean);
        }
    }
    return Array.from(unique);
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

    activeSessions[userId] = { sock: sock, status: 'CONNECTING', qr: null, customers: {} };

    // Mendengarkan perubahan status koneksi (QR Code, Connected, Disconnected)
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                const qrBase64 = await qrcode.toDataURL(qr);
                activeSessions[userId].status = 'SCAN_QR';
                activeSessions[userId].qr = qrBase64;
                if (onStatus) onStatus({ type: 'qr', data: qrBase64 }); // Kirim QR ke frontend
            } catch (err) {
                console.error('Gagal generate QR:', err);
            }
        }

        if (connection === 'close') {
            const isLoggedOut = (lastDisconnect.error)?.output?.statusCode === DisconnectReason.loggedOut;
            const shouldReconnect = !isLoggedOut && !sock.isManuallyStopped;
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
        // Hapus pengecekan m.type !== 'notify' karena di beberapa versi Baileys tipe event bisa berbeda
        console.log(`\n[DEBUG] Menerima event messages.upsert. Tipe: ${m.type}, Jumlah pesan: ${m.messages.length}`);

        for (const msg of m.messages) {
            if (!msg.message || msg.key.fromMe) continue; // Abaikan pesan sendiri atau status

            // Cara paling aman menghindari History Sync (pesan lama yang di-download ulang)
            // adalah dengan mengecek timestamp pesan. Abaikan jika pesan lebih tua dari 60 detik.
            const msgTimestamp = msg.messageTimestamp;
            const now = Math.floor(Date.now() / 1000);
            if (msgTimestamp && (now - msgTimestamp > 60)) {
                console.log(`[DEBUG] Pesan diabaikan karena timestamp kadaluarsa (History Sync). Delay: ${now - msgTimestamp}s`);
                continue;
            }

            // Unwrap pesan dengan aman menggunakan helper bawaan Baileys
            const msgContent = extractMessageContent(msg.message);
            if (!msgContent) {
                console.log(`[DEBUG] Pesan diabaikan karena msgContent kosong (tidak bisa di-unwrap).`);
                continue;
            }

            const senderJid = msg.key.remoteJid;
            const rawSenderNum = senderJid.split('@')[0].split(':')[0];
            const customerPhone = await resolveCustomerPhoneNumber(msg, sock, userId);
            const customerName = msg.pushName || customerPhone;
            
            const imageMessage = msgContent.imageMessage || msgContent.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
            const textMessage = msgContent.conversation || msgContent.extendedTextMessage?.text || msgContent.imageMessage?.caption || "";

            if (!textMessage && !imageMessage) {
                console.log(`⚠️ Pesan dari ${customerPhone} diabaikan (bukan teks/gambar). Tipe:`, Object.keys(msgContent));
                continue; // Hanya memproses pesan teks atau gambar
            }

            // Cek Knowledge Base untuk Aturan, Prompt, Blocked Numbers, dan Special Numbers
        let kb = null;
        try {
            const { data } = await supabase
                .from('knowledge_base')
                .select('store_rules, system_prompt, blocked_numbers, special_numbers, admin_numbers')
                .eq('user_id', userId)
                .single();
            kb = data;
        } catch (err) {
            console.warn('⚠️ Gagal ambil knowledge_base:', err.message);
        }

        // Cek apakah nomor diblokir atau merupakan nomor khusus/admin
        if (kb && (kb.blocked_numbers || kb.special_numbers || kb.admin_numbers)) {
            let ignoreList = [];
            if (kb.blocked_numbers) {
                ignoreList = ignoreList.concat(kb.blocked_numbers.split(/[\n,]+/).map(n => n.trim()).filter(Boolean));
            }
            if (kb.special_numbers) {
                ignoreList = ignoreList.concat(kb.special_numbers.split(/[\n,]+/).map(n => n.trim()).filter(Boolean));
            }
            if (kb.admin_numbers) {
                ignoreList = ignoreList.concat(kb.admin_numbers.split(/[\n,]+/).map(n => n.trim()).filter(Boolean));
            }
            
            const isIgnored = ignoreList.some(ignoredNum => {
                if (ignoredNum === customerPhone || ignoredNum === rawSenderNum) return true;
                // Jika UI menambahkan '62' di depan secara paksa, kita hapus 62 nya dan cocokkan
                if (ignoredNum.replace(/^62/, '') === customerPhone || ignoredNum.replace(/^62/, '') === rawSenderNum) return true;
                // Atau jika customerPhone yang ada 62 nya tapi di database nggak ada
                if (customerPhone.replace(/^62/, '') === ignoredNum.replace(/^62/, '')) return true;
                // Atau jika format di database pakai '0' di depan
                if (ignoredNum.replace(/^0/, '62') === customerPhone || ignoredNum.replace(/^0/, '62') === rawSenderNum) return true;
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

        // Ambil sesi terisolasi untuk pelanggan ini
        const custSession = getCustomerSession(userId, customerPhone);

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
                    .order('created_at', { ascending: false })
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
                    if (isForwardToAdmin) {
                        const adminList = getAdminNumberList(kb);
                        let formattedCustPhone = customerPhone;
                        if (formattedCustPhone.startsWith('0')) formattedCustPhone = '62' + formattedCustPhone.substring(1);
                        formattedCustPhone = formattedCustPhone.replace(/\D/g, '');

                        const isLid = formattedCustPhone.length >= 14 && !formattedCustPhone.startsWith('628');
                        const phoneDisplay = isLid ? `${formattedCustPhone} (ID WhatsApp)` : `+${formattedCustPhone}`;
                        const actionLink = isLid
                            ? `_Pelanggan menggunakan WhatsApp Multi-Device (LID). Balas langsung via room chat WhatsApp bot._`
                            : `Balas ke: https://wa.me/${formattedCustPhone}`;

                        const forwardMsg = `🚨 *PANGGILAN ADMIN* 🚨\n\nPelanggan butuh bantuan admin.\n\n👤 Nama: ${customerName}\n📱 No: ${phoneDisplay}\n💬 Pesan: "${textMessage}"\n\n${actionLink}`;

                        for (const adminNum of adminList) {
                            const adminJid = adminNum + '@s.whatsapp.net';
                            try {
                                await sock.sendMessage(adminJid, { text: forwardMsg });
                                console.log(`✅ Forwarded to admin ${adminNum} (Image Block)`);
                            } catch (err) {
                                console.error(`Gagal forward ke admin ${adminNum}:`, err.message);
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
                    return cleanAndValidateLocation(`${kecMatch[1].trim()} ${kotaMatch[1].trim()}`);
                }
                if (kecMatch) return cleanAndValidateLocation(kecMatch[1].trim());
                if (kotaMatch) return cleanAndValidateLocation(kotaMatch[1].trim());
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

                let pendingOrder = custSession.pendingOrder;
                const queryLokasiBaru = intentData.location || cleanAndValidateLocation(textMessage);

                // Jika pendingOrder belum ada ATAU pesan mengandung lokasi/alamat baru yang belum ada rate-nya
                const needOrderExtraction = !pendingOrder || !pendingOrder.produk || (queryLokasiBaru && (!pendingOrder.destLabel || !pendingOrder.destLabel.toLowerCase().includes(queryLokasiBaru.toLowerCase())));

                if (needOrderExtraction) {
                    console.log(`🔍 Mengekstrak detail pesanan terkini menggunakan AI Order Extractor...`);
                    try {
                        const orderExtract = await extractOrderDetails(textMessage, history, storeRules, products);
                        console.log(`📦 Hasil ekstraksi order:`, orderExtract);

                        if (orderExtract) {
                            const targetLokasi = orderExtract.lokasi_ongkir || queryLokasiBaru || custSession.lastDestination?.destLabel;
                            let shippingRates = null;
                            let destLabel = targetLokasi || custSession.lastDestination?.destLabel || '-';
                            let destId = custSession.lastDestination?.destId || null;

                            if (targetLokasi && targetLokasi.length >= 3) {
                                try {
                                    const destinations = await searchDestination(targetLokasi);
                                    if (destinations && destinations.length > 0) {
                                        const target = destinations[0];
                                        destId = target.id || target.subdistrict_id || target.city_id;
                                        destLabel = target.label || targetLokasi;
                                        const beratGram = Math.max(1000, (orderExtract.qty || 1) * 1000);
                                        shippingRates = await calculateShipping(destId, beratGram);
                                    }
                                } catch (sErr) {
                                    console.warn('⚠️ Gagal hitung tarif ongkir:', sErr.message);
                                }
                            }

                            if (!shippingRates && destId) {
                                try {
                                    const beratGram = Math.max(1000, (orderExtract.qty || 1) * 1000);
                                    shippingRates = await calculateShipping(destId, beratGram);
                                } catch (e) {}
                            }

                            if (orderExtract.kurir) {
                                const k = orderExtract.kurir.toLowerCase();
                                if (k.includes('jnt') || k.includes('j&t')) kurirDipilih = 'J&T EXPRESS';
                                else if (k.includes('jne')) kurirDipilih = 'JNE REG';
                            }

                            const qtyParsed = Number(orderExtract.qty) || 1;
                            const unitName = orderExtract.unit || (qtyParsed > 1 ? 'paket' : 'pcs');
                            const namaProd = orderExtract.produk || 'Produk';
                            const totalB = Number(orderExtract.total_harga_barang) || 0;

                            custSession.pendingOrder = {
                                produk: `${namaProd} x ${qtyParsed} ${unitName}`,
                                qty: qtyParsed,
                                totalBarang: totalB,
                                namaPenerima: orderExtract.nama_penerima || customerName,
                                alamat: orderExtract.alamat || destLabel,
                                destLabel: destLabel,
                                orderBeratKg: Math.ceil(Math.max(1000, qtyParsed * 1000) / 1000),
                                shippingRates: shippingRates || []
                            };
                            pendingOrder = custSession.pendingOrder;
                        }
                    } catch (extErr) {
                        console.warn('⚠️ Gagal extractOrderDetails:', extErr.message);
                    }
                }

                let produk, namaPenerima, alamat, hargaBarangDisplay, ongkirFinal, grandTotalFinal;

                if (pendingOrder && pendingOrder.produk) {
                    produk = pendingOrder.produk;
                    namaPenerima = pendingOrder.namaPenerima || customerName;
                    alamat = pendingOrder.alamat || custSession.lastDestination?.destLabel || '-';

                    // Pilih ongkir sesuai kurir yang dipilih user
                    let selectedRate = null;
                    if (pendingOrder.shippingRates && pendingOrder.shippingRates.length > 0) {
                        if (kurirDipilih.includes('J&T')) {
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

                    const ratePerKg = Number(selectedRate ? (selectedRate.cost || selectedRate.price || 0) : 0);
                    ongkirFinal = ratePerKg;
                    grandTotalFinal = (pendingOrder.totalBarang || 0) + ongkirFinal;
                    hargaBarangDisplay = (pendingOrder.totalBarang || 0).toLocaleString('id-ID');

                    // Bersihkan cache setelah dipakai
                    custSession.pendingOrder = null;
                    console.log(`✅ Invoice dari pendingOrder: ${produk}, harga: ${pendingOrder.totalBarang}, ongkir: ${ongkirFinal}`);

                } else {
                    // Fallback cerdas HANYA dari pesan AI terakhir dalam obrolan saat ini
                    console.warn('⚠️ pendingOrder tidak ditemukan, parsing pesan AI terakhir saja');
                    const lastAIMsg = history.filter(h => h.sender === 'ai').slice(-1)[0]?.message || '';
                    const hargaMatch = lastAIMsg.match(/Rp\s*([\d\.]+)/);
                    const hargaBarangInt = hargaMatch ? parseInt(hargaMatch[1].replace(/\./g, '')) || 0 : 0;
                    
                    produk = 'Pesanan Promo';
                    namaPenerima = customerName;
                    alamat = intentData.location || '-';
                    ongkirFinal = 0;
                    grandTotalFinal = hargaBarangInt;
                    hargaBarangDisplay = hargaBarangInt.toLocaleString('id-ID');
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

                // Fallback jika AI offline / kuota habis
                if (!aiReply || aiReply.includes('Admin') || aiReply.includes('diulang')) {
                    if (hasCODPolicy) {
                        aiReply = "Bisa banget kak! Untuk pembayaran COD (Bayar di Tempat) ada biaya layanan COD sebesar 3% ya kak. Mau pesan produk yang mana kak? 😊";
                    } else {
                        aiReply = "Maaf kak, saat ini toko kami belum menyediakan pembayaran COD (Bayar di Tempat). Pembayaran kami melayani Transfer Bank dan QRIS ya kak 🙏";
                    }
                }
                console.log(`✅ Jawaban COD untuk ${customerName}`);

            } else if (intent === 'CANCEL') {
                aiReply = "Baik kak, pesanannya sudah kami batalkan ya. Jika ada yang ingin ditanyakan lagi, jangan ragu untuk menghubungi kami kembali! 🙏";
                console.log(`✅ Batal dari ${customerName}`);
            } else if (intent === 'CHECK_SHIPPING') {
                let queryLokasi = cleanAndValidateLocation(intentData.location);

                // 1. Coba ambil dari Quoted Message jika pelanggan mengutip pesan bot sebelumnya (misal info ongkir lama)
                const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || quotedMsg?.imageMessage?.caption || "";
                if (!queryLokasi && quotedText) {
                    const quotedLocMatch = quotedText.match(/Ongkir ke \*?([^\*\(\n\r]+?)(?:\s*\(|\*|\n|$)/i);
                    if (quotedLocMatch) {
                        const cand = cleanAndValidateLocation(quotedLocMatch[1]);
                        if (cand) {
                            queryLokasi = cand;
                            console.log(`📍 Lokasi diambil dari quoted message: "${queryLokasi}"`);
                        }
                    }
                }

                // 2. Coba dari session lastDestination jika ada
                if (!queryLokasi && custSession?.lastDestination) {
                    queryLokasi = custSession.lastDestination.destLabel || custSession.lastDestination.query;
                    console.log(`📍 Lokasi diambil dari session lastDestination: "${queryLokasi}"`);
                }

                // 3. Coba dari riwayat chat
                if (!queryLokasi && history && history.length > 0) {
                    const aiShipMsg = history.filter(h => h.sender === 'ai' && /ongkir ke/i.test(h.message || '')).slice(-1)[0];
                    if (aiShipMsg) {
                        const histLocMatch = aiShipMsg.message.match(/Ongkir ke \*?([^\*\(\n\r]+?)(?:\s*\(|\*|\n|$)/i);
                        if (histLocMatch) {
                            const cand = cleanAndValidateLocation(histLocMatch[1]);
                            if (cand) {
                                queryLokasi = cand;
                                console.log(`📍 Lokasi diambil dari history ongkir AI: "${queryLokasi}"`);
                            }
                        }
                    }
                    if (!queryLokasi) {
                        queryLokasi = cleanAndValidateLocation(extractLokasiFromHistory(history));
                    }
                }

                console.log(`🔍 Final query ongkir: "${queryLokasi}"`);

                if (queryLokasi && queryLokasi.length >= 3) {
                    const destinations = await searchDestination(queryLokasi);

                    if (destinations && destinations.length > 0) {
                        const target = destinations[0];
                        const destId = target.id || target.subdistrict_id || target.city_id;
                        const destLabel = target.label || target.subdistrict_name || target.city_name || queryLokasi;

                        console.log(`📍 Destinasi ditemukan: ${destLabel} (ID: ${destId})`);
                        
                        // Simpan ke session untuk pertanyaan lanjutan (misal user tanya "kalau perkilo berapa")
                        custSession.lastDestination = {
                            destId: destId,
                            destLabel: destLabel,
                            query: queryLokasi
                        };

                        // STANDAR CEK ONGKIR ADALAH PER KILO (1 kg / 1.000 gram)
                        // Kecuali jika pelanggan secara eksplisit menyebut berat tertentu di chat saat ini (misal: "ongkir 3 kg berapa")
                        const explicitKgMatch = textMessage.match(/(\d+)\s*(?:kg|kilo)\b/i);
                        const isExplicitPerKilo = /per[\s\-]?kilo|per[\s\-]?kg|\b1\s*(?:kg|kilo)\b/i.test(textMessage);

                        let beratKg = 1;
                        if (explicitKgMatch && !isExplicitPerKilo) {
                            beratKg = parseInt(explicitKgMatch[1]) || 1;
                        } else {
                            beratKg = 1; // Default selalu 1 kg (per kilo)
                        }
                        const totalWeight = beratKg * 1000;
                        console.log(`⚖️ Hitung ongkir dengan berat: ${beratKg} kg (${totalWeight} gram)`);

                        const shippingRates = await calculateShipping(destId, totalWeight);

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
                                return `• *${kurir}*: Rp ${harga} (est. ${etd || '1-3'} hari)`;
                            }).join('\n');

                            const beratLabel = beratKg === 1 ? 'per kg' : `berat ${beratKg} kg`;
                            aiReply = `Ongkir ke *${destLabel}* (${beratLabel}):\n\n${listOngkir}\n\nMau pilih *JNE REG* atau *J&T* kak? 😊`;

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

                                    const unitWeight = foundProduct?.weight || 1000;
                                    const orderTotalWeight = foundQty * unitWeight;
                                    const orderBeratKg = Math.ceil(orderTotalWeight / 1000);

                                    custSession.pendingOrder = {
                                        produk: `${foundProduct.name || foundProduct.title} x ${foundQty} pcs`,
                                        qty: foundQty,
                                        hargaProduk: Number(foundProduct.price || 0),
                                        totalBarang: Number(foundProduct.price || 0) * foundQty,
                                        namaPenerima: foundNama,
                                        alamat: foundAlamat,
                                        destId: destId,
                                        destLabel: destLabel,
                                        orderBeratKg: orderBeratKg,
                                        shippingRates: displayRates
                                    };
                                    console.log(`📦 pendingOrder cached (CHECK_SHIPPING): ${foundProduct.name} x${foundQty}, total: ${custSession.pendingOrder.totalBarang}`);
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

                const allMessages = history.map(h => h.message || '').join(' ').toLowerCase();
                const hasProductInHistory = allMessages.includes('kaos') || allMessages.includes('produk') || allMessages.includes('order') || allMessages.includes('pesan');
                const hasAddressInMsg = /kec(?:amatan)?|jalan|jl\.|alamat/i.test(textMessage);
                const hasNameInMsg = /nama\s+\w+/i.test(textMessage);

                // Cek produk & kuantitas terlebih dahulu agar berat bisa dihitung
                let produkOrdered = "Produk";
                let hargaProduk = 0;
                let unitWeight = 1000;
                let foundProductObj = null;
                if (products && products.length > 0) {
                    foundProductObj = products.find(p => allMessages.includes((p.name || p.title || '').toLowerCase()));
                    if (foundProductObj) {
                        produkOrdered = foundProductObj.name || foundProductObj.title;
                        hargaProduk = Number(foundProductObj.price || 0);
                        unitWeight = foundProductObj.weight || 1000;
                    } else {
                        produkOrdered = products[0].name || products[0].title;
                        hargaProduk = Number(products[0].price || 0);
                        unitWeight = products[0].weight || 1000;
                    }
                }
                const qtyMatch = allMessages.match(/(\d+)\s*pcs/i) || allMessages.match(/(\d+)\s*buah/i) || allMessages.match(/(\d+)\s*kg/i);
                const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                const totalBarang = hargaProduk * qty;
                const totalWeight = qty * unitWeight;
                const beratKg = Math.ceil(totalWeight / 1000);

                try {
                    const queryLokasi = intentData.location; 
                    if (queryLokasi && queryLokasi.length >= 3) {
                        console.log(`🚀 Auto-hitung ongkir: "${queryLokasi}"`);
                        const destinations = await searchDestination(queryLokasi);
                        if (destinations && destinations.length > 0) {
                            const target = destinations[0];
                            const destId = target.id || target.subdistrict_id || target.city_id;
                            autoDestLabel = target.label || target.subdistrict_name || target.city_name || queryLokasi;
                            const rates = await calculateShipping(destId, totalWeight);
                            if (rates && rates.length > 0) {
                                autoShippingRates = rates;
                                autoShippingInfo = `Tujuan: ${autoDestLabel} (Berat ${beratKg} kg)\n` + rates.slice(0, 3).map(r =>
                                    `${(r.name || r.courier || 'Kurir').toUpperCase()} ${r.service || ''}: Rp ${Number(r.cost || r.price || 0).toLocaleString('id-ID')} (${r.etd || '1-3'} hari)`
                                ).join('\n');
                                console.log(`📦 Ongkir siap untuk invoice: ${autoDestLabel}`);
                            }
                        }
                    }
                } catch (shippingErr) {
                    console.warn("⚠️ Auto-shipping gagal:", shippingErr.message);
                }

                if (hasAddressInMsg && hasNameInMsg && hasProductInHistory && autoShippingRates) {
                    const namaMatch = textMessage.match(/nama\s+([a-zA-Z\s]+?)(?:\s+alamat|\s+jl|\s+kec|$)/i);
                    const namaPenerima = namaMatch ? namaMatch[1].trim() : customerName;

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
                    custSession.pendingOrder = {
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

            // Cek apakah ada invoice yang harus disimpan
            let isInvoiceFinal = false;
            let finalInvoiceText = "";
            const saveInvoiceMatch = aiReply.match(/\[SAVE_INVOICE:(\d+)\]/i);
            if (saveInvoiceMatch) {
                isInvoiceFinal = true;
                const totalAmount = parseInt(saveInvoiceMatch[1]);
                aiReply = aiReply.replace(/\[SAVE_INVOICE:\d+\]/gi, '').trim();
                finalInvoiceText = aiReply;
                
                // Cari nama pelanggan dari aiReply jika ada (misal dari "Penerima: Budi")
                const namaMatch = aiReply.match(/Penerima:\s*([^\n]+)/i);
                const namaPenerima = namaMatch ? namaMatch[1].trim() : customerName;
                
                const invoiceIdStr = 'INV-' + Date.now();
                supabase.from('invoices').insert([{
                    user_id: userId,
                    customer_phone: customerPhone,
                    customer_name: namaPenerima,
                    total_amount: totalAmount,
                    payment_method: 'Transfer',
                    status: 'PENDING',
                    invoice_id: invoiceIdStr
                }]).then(({error}) => {
                    if (error) console.warn('⚠️ Gagal simpan invoice dari AI tag:', error.message);
                    else console.log(`✅ Invoice dari AI Tag tersimpan! Total: ${totalAmount}`);
                });
            } else if (intent === 'SELECT_COURIER') {
                isInvoiceFinal = true;
                finalInvoiceText = aiReply;
            } else if (
                /(?:INVOICE\s*(?:FINAL|PESANAN|TAGIHAN)|📋\s*\*?INVOICE)/i.test(aiReply) &&
                /(?:TOTAL|Total\s*Tagihan|Total\s*Harga|Total\s*Transfer|Silakan\s+transfer)/i.test(aiReply) &&
                /(?:Penerima|Alamat|Rekening|Transfer|BCA|Mandiri|BRI|BNI|Bank)/i.test(aiReply)
            ) {
                isInvoiceFinal = true;
                finalInvoiceText = aiReply;
                console.log(`📋 Deteksi format invoice otomatis dari teks AI`);
            }

            // Kirim balasan ke WhatsApp pelanggan
            await sock.sendMessage(senderJid, { text: aiReply });
            console.log(`✅ Balas ke ${customerName}: ${aiReply.substring(0, 100)}`);

            // Logika forward ke Admin (Bantuan/Handover)
            if (isForwardToAdmin) {
                const adminList = getAdminNumberList(kb);
                let formattedCustPhone = customerPhone;
                if (formattedCustPhone.startsWith('0')) formattedCustPhone = '62' + formattedCustPhone.substring(1);
                formattedCustPhone = formattedCustPhone.replace(/\D/g, '');

                const isLid = formattedCustPhone.length >= 14 && !formattedCustPhone.startsWith('628');
                const phoneDisplay = isLid ? `${formattedCustPhone} (ID WhatsApp)` : `+${formattedCustPhone}`;
                const actionLink = isLid
                    ? `_Pelanggan menggunakan WhatsApp Multi-Device (LID). Balas langsung via room chat WhatsApp bot._`
                    : `Balas ke: https://wa.me/${formattedCustPhone}`;

                const forwardMsg = `🚨 *PANGGILAN ADMIN* 🚨\n\nPelanggan butuh bantuan admin.\n\n👤 Nama: ${customerName}\n📱 No: ${phoneDisplay}\n💬 Pesan: "${textMessage}"\n\n${actionLink}`;

                for (const adminNum of adminList) {
                    const adminJid = adminNum + '@s.whatsapp.net';
                    try {
                        await sock.sendMessage(adminJid, { text: forwardMsg });
                        console.log(`✅ Forwarded bantuan ke admin ${adminNum}`);
                    } catch (err) {
                        console.error(`Gagal forward bantuan ke admin ${adminNum}:`, err.message);
                    }
                }
            }

            // Logika forward Invoice ke Admin (Nomor Khusus)
            if (isInvoiceFinal) {
                const adminList = getAdminNumberList(kb);
                console.log(`📤 Mengecek nomor admin untuk forward invoice. Ditemukan: ${adminList.length} nomor (${adminList.join(', ')})`);
                if (adminList.length > 0) {
                    let formattedCustPhone = customerPhone;
                    if (formattedCustPhone.startsWith('0')) formattedCustPhone = '62' + formattedCustPhone.substring(1);
                    formattedCustPhone = formattedCustPhone.replace(/\D/g, '');

                    const isLid = formattedCustPhone.length >= 14 && !formattedCustPhone.startsWith('628');
                    const phoneDisplay = isLid ? `${formattedCustPhone} (ID WhatsApp)` : `+${formattedCustPhone}`;
                    const chatLink = isLid ? '' : `🔗 *Chat Pelanggan:* https://wa.me/${formattedCustPhone}\n\n`;

                    // Ambil nama penerima dari invoice jika ada
                    const namaMatch = finalInvoiceText.match(/Penerima:\s*([^\n]+)/i);
                    const displayName = namaMatch ? namaMatch[1].replace(/[\*\_]/g, '').trim() : customerName;

                    // Bersihkan tag rahasia jika ada
                    const cleanInvoice = finalInvoiceText
                        .replace(/\[SAVE_INVOICE:\d+\]/gi, '')
                        .replace(/\[FORWARD_TO_ADMIN\]/gi, '')
                        .trim();

                    const forwardInvoiceMsg = `📋 *INVOICE PESANAN BARU* 📋\n\n` +
                        `Pelanggan telah mencapai tahap invoice:\n` +
                        `👤 *Nama:* ${displayName}\n` +
                        `📱 *WhatsApp:* ${phoneDisplay}\n` +
                        chatLink +
                        `━━━━━━━━━━━━━━━━━\n` +
                        `*RINCIAN INVOICE:*\n` +
                        `${cleanInvoice}\n` +
                        `━━━━━━━━━━━━━━━━━\n\n` +
                        `💡 _Segera follow up atau siapkan pesanan jika pembayaran telah dikonfirmasi._`;

                    for (const adminNum of adminList) {
                        const adminJid = adminNum + '@s.whatsapp.net';
                        try {
                            await sock.sendMessage(adminJid, { text: forwardInvoiceMsg });
                            console.log(`✅ Invoice berhasil diteruskan ke admin/nomor khusus: ${adminNum}`);
                        } catch (err) {
                            console.error(`❌ Gagal meneruskan invoice ke admin ${adminNum}:`, err.message);
                        }
                    }
                } else {
                    console.warn(`⚠️ Invoice terdeteksi tapi belum ada nomor admin / nomor khusus yang disetel di dashboard (knowledge_base)!`);
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
        } // End of for loop
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
                activeSessions[userId].sock.isManuallyStopped = true;
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

        // Auto-resume existing sessions
        try {
            const entries = fs.readdirSync(__dirname, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith('auth_info_')) {
                    const userId = entry.name.replace('auth_info_', '');
                    console.log(`🔄 Auto-resuming bot for user: ${userId}`);
                    startWhatsAppBot(userId).catch(err => console.error(`Gagal resume bot ${userId}:`, err));
                }
            }
        } catch (err) {
            console.error('Gagal membaca direktori untuk auto-resume:', err);
        }

        // Menjalankan Server API (bind ke 0.0.0.0 agar bisa diakses di dalam Docker)
        const PORT = process.env.PORT || 3001;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server Backend Bot berjalan di port ${PORT}`);
        });
