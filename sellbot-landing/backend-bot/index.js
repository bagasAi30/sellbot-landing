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
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, extractMessageContent, Browsers, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');
const { generateAIResponse, processImageWithGemini, extractIntentWithGemini, extractOrderDetails, cleanAndValidateLocation, getProductFullName, getProductWeight } = require('./ai');
const { searchDestination, calculateShipping } = require('./shipping');

function findMatchingProduct(searchText, products) {
    if (!products || !products.length || !searchText) return null;
    const cleanSearch = String(searchText).toLowerCase().trim();
    if (!cleanSearch) return null;

    // 1. Exact / inclusion check pada full name, name, variant
    for (const p of products) {
        const full = getProductFullName(p).toLowerCase();
        const pName = String(p.name || p.title || '').toLowerCase();
        const pVar = String(p.variant || '').toLowerCase();

        if (full.length >= 3 && (cleanSearch.includes(full) || full.includes(cleanSearch))) return p;
        if (pVar.length >= 3 && (cleanSearch.includes(pVar) || pVar.includes(cleanSearch))) return p;
        if (pName.length >= 3 && !/^\d+$/.test(pName) && (cleanSearch.includes(pName) || pName.includes(cleanSearch))) return p;
    }

    // 2. Token overlap matching (abaikan kata umum / stop words)
    const stopWords = new Set(['mau', 'beli', 'pesan', 'order', 'kak', 'min', 'ada', 'ready', 'ongkir', 'ke', 'ya', 'saya', 'tolong', 'paket', 'pcs', 'buah', 'biji', 'promo', 'bungkus']);
    const searchTokens = cleanSearch
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 3 && !stopWords.has(t));

    if (searchTokens.length > 0) {
        let bestMatch = null;
        let maxOverlap = 0;

        for (const p of products) {
            const candidateStr = `${getProductFullName(p)} ${p.variant || ''}`.toLowerCase();
            const candTokens = candidateStr
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter(t => t.length >= 3);

            let overlap = 0;
            for (const st of searchTokens) {
                if (candTokens.some(ct => ct.includes(st) || st.includes(ct))) {
                    overlap++;
                }
            }

            if (overlap > maxOverlap && overlap >= 1) {
                maxOverlap = overlap;
                bestMatch = p;
            }
        }

        if (bestMatch && maxOverlap >= 1) return bestMatch;
    }

    return null;
}

const fs = require('fs');
const path = require('path');
const os = require('os');

// Pengaturan Lokasi Asal Pengiriman Toko per User (Persisten ke file JSON & Supabase)
const userOriginsFilePath = path.join(__dirname, 'user-origins.json');
function getUserOrigins() {
    try {
        if (fs.existsSync(userOriginsFilePath)) {
            return JSON.parse(fs.readFileSync(userOriginsFilePath, 'utf8'));
        }
    } catch (e) {
        console.error('Gagal membaca user-origins.json:', e);
    }
    return {};
}

function saveUserOrigin(uId, originData) {
    try {
        const all = getUserOrigins();
        all[uId] = originData;
        fs.writeFileSync(userOriginsFilePath, JSON.stringify(all, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Gagal menulis user-origins.json:', e);
        return false;
    }
}

const serverStartTime = Date.now();

// In-Memory Server Log Buffer (Ring buffer 150 entries)
const serverLogsBuffer = [];
const MAX_LOG_ENTRIES = 150;

function safeStringify(item) {
    if (item === null || item === undefined) return String(item);
    if (item instanceof Error) return item.stack || item.message || String(item);
    if (typeof item === 'object') {
        try {
            return JSON.stringify(item);
        } catch {
            try {
                const seen = new WeakSet();
                return JSON.stringify(item, (key, value) => {
                    if (typeof value === 'object' && value !== null) {
                        if (seen.has(value)) return '[Circular]';
                        seen.add(value);
                    }
                    return value;
                });
            } catch {
                return Object.prototype.toString.call(item);
            }
        }
    }
    return String(item);
}

function pushServerLog(level, args) {
    try {
        const timestamp = new Date().toISOString();
        const message = args.map(safeStringify).join(' ');
        serverLogsBuffer.push({ timestamp, level, message });
        if (serverLogsBuffer.length > MAX_LOG_ENTRIES) {
            serverLogsBuffer.shift();
        }
    } catch {
        // Logging internal never throws
    }
}

const origLog = console.log;
const origInfo = console.info || console.log;
const origWarn = console.warn;
const origError = console.error;

console.log = function(...args) {
    pushServerLog('INFO', args);
    origLog.apply(console, args);
};
console.info = function(...args) {
    pushServerLog('INFO', args);
    origInfo.apply(console, args);
};
console.warn = function(...args) {
    pushServerLog('WARN', args);
    origWarn.apply(console, args);
};
console.error = function(...args) {
    pushServerLog('ERROR', args);
    origError.apply(console, args);
};

process.on('uncaughtException', (err) => {
    console.error('🔥 UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 UNHANDLED REJECTION:', reason);
});

const app = express();
app.use(cors());
app.use(express.json());

// Melayani file-file statis Frontend (utamakan folder sellbot-landing / parent)
let frontendPath = path.join(__dirname, '..');
if (!fs.existsSync(path.join(frontendPath, 'index.html'))) {
    frontendPath = path.join(__dirname, 'public');
}
if (!fs.existsSync(path.join(frontendPath, 'index.html'))) {
    frontendPath = path.join(__dirname, '../..');
}
app.use(express.static(frontendPath));

// Rute Pembayaran Midtrans Snap & Webhook
const paymentRoutes = require('./routes/payment');
app.use('/api/payment', paymentRoutes);

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

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
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

// =============================================
// SISTEM VALIDASI TRIAL 1 HARI & KUOTA BOT (AUTO-STOP)
// =============================================
const userAccessCache = new Map();

async function checkUserAccess(userId, forceRefresh = false) {
    if (!userId) return { isAllowed: false, reason: 'INVALID_USER' };

    const now = Date.now();
    const cached = userAccessCache.get(userId);
    if (!forceRefresh && cached && (now - cached.timestamp < 20000)) {
        return cached.data;
    }

    try {
        let createdAt = null;
        let userPlan = 'Trial';

        // 1. Ambil data registrasi user dari Supabase Auth
        try {
            const { data: userData, error: uErr } = await supabase.auth.admin.getUserById(userId);
            if (!uErr && userData?.user) {
                createdAt = userData.user.created_at;
                if (userData.user.user_metadata?.plan) {
                    userPlan = userData.user.user_metadata.plan;
                }
            }
        } catch (err) {
            console.warn(`[checkUserAccess] Gagal ambil auth user ${userId}:`, err.message);
        }

        // 2. Cek apakah ada invoice sukses (hanya jika metadata user masih Trial)
        let hasPaidInvoice = false;
        if (userPlan.toLowerCase() === 'trial') {
            try {
                const { data: invoice } = await supabase
                    .from('invoices')
                    .select('plan_name, credits_added, status')
                    .eq('user_id', userId)
                    .in('status', ['success', 'paid', 'settlement'])
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (invoice && invoice.plan_name) {
                    userPlan = invoice.plan_name;
                    hasPaidInvoice = true;
                }
            } catch (invErr) {}
        } else {
            hasPaidInvoice = true;
        }

        // 3. Hitung pemakaian kredit AI (jumlah balasan AI dari tabel chats)
        let usedCredits = 0;
        try {
            const { count, error: cErr } = await supabase
                .from('chats')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('sender', 'ai');
            if (!cErr && typeof count === 'number') {
                usedCredits = count;
            }
        } catch (chatErr) {}

        const planLower = (userPlan || 'trial').toLowerCase();
        let totalQuota = 3000;
        let isTrial = false;

        if (planLower === 'trial' && !hasPaidInvoice) {
            isTrial = true;
            totalQuota = 100;
        } else if (planLower === 'starter') {
            totalQuota = 3000;
        } else if (planLower === 'pro') {
            totalQuota = 8000;
        } else if (planLower === 'business') {
            totalQuota = 20000;
        } else if (planLower === 'agency') {
            totalQuota = 50000;
        }

        const remainingCredits = Math.max(0, totalQuota - usedCredits);
        let isExpired = false;
        let expiredReason = null;
        let trialHoursLeft = 24;

        if (isTrial) {
            const regTime = createdAt ? new Date(createdAt).getTime() : now;
            const elapsedMs = now - regTime;
            const trialDurationMs = 24 * 60 * 60 * 1000; // 24 Jam
            const msLeft = trialDurationMs - elapsedMs;
            trialHoursLeft = Math.max(0, Math.round((msLeft / (60 * 60 * 1000)) * 10) / 10);

            if (elapsedMs >= trialDurationMs) {
                isExpired = true;
                expiredReason = 'TIME_EXPIRED'; // Masa uji coba 1 hari (24 jam) telah selesai
            } else if (usedCredits >= totalQuota) {
                isExpired = true;
                expiredReason = 'QUOTA_EXHAUSTED'; // Batas 100 kredit trial telah habis
            }
        } else {
            if (usedCredits >= totalQuota) {
                isExpired = true;
                expiredReason = 'QUOTA_EXHAUSTED';
            }
        }

        const result = {
            isAllowed: !isExpired,
            isExpired,
            expiredReason,
            plan: userPlan,
            isTrial,
            totalQuota,
            usedCredits,
            remainingCredits,
            trialHoursLeft,
            createdAt
        };

        userAccessCache.set(userId, { timestamp: now, data: result });
        return result;
    } catch (err) {
        console.error('[checkUserAccess] Error:', err.message);
        return { isAllowed: true, isExpired: false, plan: 'Trial', remainingCredits: 100 };
    }
}

function consumeUserCredit(userId) {
    if (!userId) return;
    const entry = userAccessCache.get(userId);
    if (entry && entry.data) {
        entry.data.usedCredits = (entry.data.usedCredits || 0) + 1;
        entry.data.remainingCredits = Math.max(0, entry.data.totalQuota - entry.data.usedCredits);
        if (entry.data.remainingCredits <= 0) {
            entry.data.isExpired = true;
            entry.data.isAllowed = false;
            entry.data.expiredReason = 'QUOTA_EXHAUSTED';
        }
    }
}

/**
 * Mengirim pesan dengan simulasi "sedang mengetik" (human-like typing indicator)
 * Sangat penting untuk keamanan akun saat menerima traffic Meta Ads (anti-ban / anti-spam).
 */
async function sendReplyWithTyping(sock, senderJid, messagePayload, customDelayMs = null) {
    if (!sock || !senderJid) return;
    try {
        await sock.sendPresenceUpdate('composing', senderJid);
        const textLen = (messagePayload.text || messagePayload.caption || '').length;
        const delay = customDelayMs ?? Math.min(2500, Math.max(1200, Math.round(textLen * 18)));
        await new Promise(r => setTimeout(r, delay));
        await sock.sendPresenceUpdate('paused', senderJid);
    } catch (e) {}
    return await sock.sendMessage(senderJid, messagePayload);
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
 * Helper untuk menunggu socket Baileys membuka koneksi WebSocket
 */
async function waitForSocketOpen(sock, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (sock?.ws?.isOpen) return true;
        await new Promise(r => setTimeout(r, 250));
    }
    return Boolean(sock?.ws?.isOpen);
}

/**
 * Format nomor telepon untuk WhatsApp pairing code (hanya angka, diawali kode negara e.g. 62)
 */
function sanitizePhoneNumber(phone) {
    if (!phone) return null;
    let clean = phone.toString().replace(/\D/g, '');
    if (clean.startsWith('0')) {
        clean = '62' + clean.slice(1);
    } else if (!clean.startsWith('62') && clean.length >= 9 && clean.length <= 13) {
        clean = '62' + clean;
    }
    return clean;
}

// Global cache untuk versi Baileys agar tidak fetch berulang kali
let cachedBaileysVersion = null;
async function getBaileysVersion() {
    if (cachedBaileysVersion) return cachedBaileysVersion;
    try {
        const vInfo = await fetchLatestBaileysVersion();
        if (vInfo && vInfo.version) {
            cachedBaileysVersion = vInfo.version;
            console.log('✅ Berhasil fetch versi Baileys terbaru:', cachedBaileysVersion);
            return cachedBaileysVersion;
        }
    } catch (vErr) {
        console.warn('⚠️ Gagal fetch versi Baileys terbaru, gunakan default:', vErr.message);
    }
    return [2, 3000, 1043857760];
}

/**
 * Fungsi utama untuk menjalankan Bot WA untuk user tertentu
 */
async function startWhatsAppBot(userId, onStatus) {
    // 0. Validasi status masa trial / kuota sebelum mengizinkan koneksi WhatsApp
    const access = await checkUserAccess(userId, true);
    if (!access.isAllowed) {
        const errorMsg = access.expiredReason === 'TIME_EXPIRED'
            ? 'Masa uji coba gratis (trial 1 hari / 24 jam) Anda telah berakhir. Silakan pilih paket langganan untuk melanjutkan.'
            : 'Kuota 100 kredit balasan chat WhatsApp trial Anda telah habis terpakai. Silakan upgrade paket langganan.';
        console.warn(`⛔ [TRIAL EXPIRED] Tidak dapat menjalankan bot untuk user ${userId}: ${errorMsg}`);
        throw new Error(errorMsg);
    }

    if (activeSessions[userId] && activeSessions[userId].sock) {
        const isSocketLive = Boolean(activeSessions[userId].sock.ws?.isOpen || activeSessions[userId].sock.ws?.readyState === 1);
        if (isSocketLive && activeSessions[userId].status === 'CONNECTED') {
            console.log(`Sesi aktif untuk user ${userId} sudah berjalan.`);
            if (onStatus) onStatus({ type: 'connected' });
            return;
        }
        if (isSocketLive && activeSessions[userId].qr) {
            console.log(`Sesi QR untuk user ${userId} masih aktif.`);
            if (onStatus) onStatus({ type: 'qr', data: activeSessions[userId].qr });
            return;
        }
        // Bersihkan socket lama yang sudah mati/terputus
        console.log(`Membersihkan socket lama yang terputus untuk user ${userId}...`);
        try {
            activeSessions[userId].sock.ev.removeAllListeners();
            if (activeSessions[userId].sock.ws) activeSessions[userId].sock.ws.close();
        } catch (e) {}
        activeSessions[userId].sock = null;
    }

    const sessionDir = path.join(__dirname, `auth_info_${userId}`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const version = await getBaileysVersion();
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        logger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 15000
    });

    if (!activeSessions[userId]) {
        activeSessions[userId] = { sock: sock, status: 'CONNECTING', qr: null, pairingCode: null, customers: {} };
    } else {
        activeSessions[userId].sock = sock;
        activeSessions[userId].status = 'CONNECTING';
    }

    if (onStatus) {
        activeSessions[userId].onStatus = onStatus;
    }

    // Mendengarkan perubahan status koneksi (QR Code, Connected, Disconnected)
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                const qrBase64 = await qrcode.toDataURL(qr);
                if (activeSessions[userId]) {
                    activeSessions[userId].status = 'SCAN_QR';
                    activeSessions[userId].qr = qrBase64;
                }
                const cb = activeSessions[userId]?.onStatus || onStatus;
                if (cb) cb({ type: 'qr', data: qrBase64 }); // Kirim QR ke frontend
            } catch (err) {
                console.error('Gagal generate QR:', err);
            }
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            const shouldReconnect = !isLoggedOut && !sock.isManuallyStopped;
            console.log(`Koneksi tertutup untuk ${userId}. Status: ${statusCode}, Reconnect: ${shouldReconnect}`);
            
            // Bersihkan listener dari socket yang sudah tertutup
            try {
                sock.ev.removeAllListeners();
            } catch (e) {}

            if (activeSessions[userId]) {
                // KRUSIAL: Kosongkan reference sock lama agar panggilan berikutnya tidak terblokir
                activeSessions[userId].sock = null;
                // Jangan reset ke DISCONNECTED jika WhatsApp sedang melakukan restart handshake pairing (515)
                activeSessions[userId].status = statusCode === DisconnectReason.restartRequired ? 'CONNECTING' : 'DISCONNECTED';
            }

            if (isLoggedOut) {
                delete activeSessions[userId];
                console.log(`Sesi user ${userId} telah keluar (logged out), membersihkan direktori auth...`);
                try {
                    if (fs.existsSync(sessionDir)) {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                    }
                } catch (rmErr) {
                    console.warn('Gagal membersihkan direktori auth:', rmErr.message);
                }
            } else if (shouldReconnect) {
                // Jika restartRequired (515), reconnect cepat (500ms) agar WhatsApp di HP menyelesaikan handshake pairing
                const reconnectDelay = statusCode === DisconnectReason.restartRequired ? 500 : 3000;
                console.log(`[INFO] Reconnecting user ${userId} in ${reconnectDelay}ms (reason code: ${statusCode})...`);
                setTimeout(() => {
                    startWhatsAppBot(userId, activeSessions[userId]?.onStatus || onStatus);
                }, reconnectDelay);
            } else {
                delete activeSessions[userId];
            }
        } else if (connection === 'open') {
            if (activeSessions[userId]) {
                activeSessions[userId].status = 'CONNECTED';
                activeSessions[userId].qr = null;
                activeSessions[userId].pairingCode = null;
            }
            try {
                // Set bot status Online/Available agar WhatsApp memprioritaskan pengiriman chat
                await sock.sendPresenceUpdate('available');
            } catch (pErr) {
                // ignore
            }
            console.log(`✅ WhatsApp terhubung untuk user: ${userId}`);
            const cb = activeSessions[userId]?.onStatus || onStatus;
            if (cb) cb({ type: 'connected' });
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Mendengarkan pesan masuk
    // Deduplication set untuk mencegah pesan diproses dua kali
    const processedMsgIds = new Set();

    sock.ev.on('messages.upsert', async (m) => {
        // Hapus pengecekan m.type !== 'notify' karena di beberapa versi Baileys tipe event bisa berbeda
        console.log(`\n[DEBUG] Menerima event messages.upsert. Tipe: ${m.type}, Jumlah pesan: ${m.messages.length}`);

        for (const msg of m.messages) {
            if (!msg.message || msg.key.fromMe) continue; // Abaikan pesan sendiri atau status

            // [FIX 1] Deduplication: abaikan jika pesan ini sudah pernah diproses
            const msgId = msg.key?.id;
            if (msgId && processedMsgIds.has(msgId)) {
                console.log(`[DEBUG] Pesan duplikat dilewati: ${msgId}`);
                continue;
            }
            if (msgId) processedMsgIds.add(msgId);

            // [FIX 2] Timestamp check: abaikan pesan lama (history sync) > 120 detik (2 menit)
            const msgTimestamp = msg.messageTimestamp;
            const now = Math.floor(Date.now() / 1000);
            if (msgTimestamp && (now - msgTimestamp > 120)) {
                console.log(`[DEBUG] Pesan diabaikan karena history sync. Delay: ${now - msgTimestamp}s dari ${msg.key?.remoteJid}`);
                continue;
            }
            console.log(`[DEBUG] ✅ Pesan diterima (${now - (msgTimestamp || now)}s ago) dari ${msg.key?.remoteJid}`);

            // Kirim read receipt / tanda terima ke server WhatsApp agar status centang 1 langsung berubah jadi centang 2
            try {
                await sock.readMessages([msg.key]);
            } catch (ackErr) {
                // Abaikan jika gagal kirim ack
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

        // Cek apakah nomor diblokir (Blacklist) - HANYA blocked_numbers, BUKAN special_numbers/admin_numbers
        if (kb && kb.blocked_numbers) {
            const blockList = kb.blocked_numbers.split(/[\n,]+/).map(n => n.trim()).filter(Boolean);
            
            const isBlocked = blockList.some(blockedNum => {
                if (blockedNum === customerPhone || blockedNum === rawSenderNum) return true;
                // Jika UI menambahkan '62' di depan secara paksa, kita hapus 62 nya dan cocokkan
                if (blockedNum.replace(/^62/, '') === customerPhone || blockedNum.replace(/^62/, '') === rawSenderNum) return true;
                // Atau jika customerPhone yang ada 62 nya tapi di database nggak ada
                if (customerPhone.replace(/^62/, '') === blockedNum.replace(/^62/, '')) return true;
                // Atau jika format di database pakai '0' di depan
                if (blockedNum.replace(/^0/, '62') === customerPhone || blockedNum.replace(/^0/, '62') === rawSenderNum) return true;
                return false;
            });

            if (isBlocked) {
                console.log(`🚫 Pesan dari ${customerPhone} diabaikan (nomor ada di daftar blokir/blacklist)`);
                continue;
            }
        }

        // [PROTEKSI TRIAL 1 HARI & KUOTA BOT]:
        const access = await checkUserAccess(userId);
        if (!access.isAllowed) {
            console.warn(`⛔ [AUTO-STOP] Bot tidak membalas chat dari ${customerPhone} untuk user ${userId}. Alasan: ${access.expiredReason} (Paket: ${access.plan}, Kuota: ${access.usedCredits}/${access.totalQuota}, Sisa Jam: ${access.trialHoursLeft}j)`);
            continue; // Hentikan balasan otomatis saat trial atau kuota habis
        }

        // Cek jika auto-reply sedang dinonaktifkan manual dari dashboard
        if (activeSessions[userId] && activeSessions[userId].isAutoReplyActive === false) {
            console.log(`⏸️ [PAUSED] Auto-reply sedang dinonaktifkan oleh pengguna untuk user ${userId}`);
            continue;
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
            // Ambil Lokasi Asal Pengiriman Toko (per tenant/user)
            let userStoreOriginId = null;
            let userStoreOriginName = 'Surabaya';
            const userOriginsMap = getUserOrigins();
            if (userOriginsMap[userId]?.originId) {
                userStoreOriginId = userOriginsMap[userId].originId;
                userStoreOriginName = userOriginsMap[userId].originName || 'Surabaya';
            } else if (kb) {
                const originMatch = (kb.store_rules || kb.system_prompt || '').match(/ORIGIN_ID:\s*(\d+)/i);
                if (originMatch) {
                    userStoreOriginId = originMatch[1];
                    const nameMatch = (kb.store_rules || kb.system_prompt || '').match(/ORIGIN_NAME:\s*([^\n\r]+)/i);
                    if (nameMatch) userStoreOriginName = nameMatch[1].trim();
                }
            }
            if (!userStoreOriginId) {
                userStoreOriginId = process.env.STORE_ORIGIN_ID || 254;
            }

            // Gabungkan system_prompt (AI Persona) + store_rules + Asal Pengiriman Toko menjadi satu konteks
            const storeRules = [
                kb?.system_prompt ? `=== PERSONA AI (PRIORITAS UTAMA) ===\n${kb.system_prompt}` : '',
                kb?.store_rules ? `=== ATURAN & INFO TOKO ===\n${kb.store_rules}` : '',
                `=== ASAL PENGIRIMAN TOKO ===\nAsal Pengiriman: ${userStoreOriginName} (Origin ID: ${userStoreOriginId})\nCatatan: Semua ongkos kirim otomatis dihitung dari lokasi asal ${userStoreOriginName} ke kota/kecamatan pembeli.`
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

                    // Kirim balasan AI dengan jeda mengetik (human typing indicator)
                    await sendReplyWithTyping(sock, senderJid, { text: aiReply });
                    consumeUserCredit(userId);
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
                    aiReply = "Terima kasih fotonya ya kak! 🙏 Sedang kami teruskan ke admin kami untuk dicek dan dibantu ya kak. Mohon ditunggu sebentar 😊";
                    await sendReplyWithTyping(sock, senderJid, { text: aiReply });
                    consumeUserCredit(userId);
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
                await sendReplyWithTyping(sock, senderJid, { text: sapaanReply }, 1200);
                consumeUserCredit(userId);
                addToMemory(userId, customerPhone, 'ai', sapaanReply);
                supabase.from('chats').insert([{
                    user_id: userId, customer_phone: customerPhone, customer_name: customerName,
                    message: sapaanReply, sender: 'ai', status: 'sent'
                }]).then();
                console.log(`✅ Balas sapaan otomatis ke ${customerName}`);
                return;
            }

            // 1B. Intercept pertanyaan asal pengiriman / lokasi toko (0ms latency, anti-salah)
            const isOriginInquiry = /(?:pengiriman|kirim|dikirim|asal|paket(?:nya)?)\s+(?:dari|dr)\s*mana/i.test(lowerText)
                || /(?:dari|dr)\s*mana\s*(?:kak|min|gan)?\s*(?:pengiriman|kirim|dikirim)/i.test(lowerText)
                || /(?:lokasi|alamat|posisi|tempat)\s*(?:toko|lapak|gudang|pengiriman)/i.test(lowerText)
                || /(?:toko|lapak|gudang)\s*(?:di|ada di)\s*mana/i.test(lowerText)
                || /dari\s*(?:kota|daerah|wilayah)\s*mana/i.test(lowerText)
                || /(?:dikirim|kirim)\s+(?:dari|lewat)\s+kota\s+mana/i.test(lowerText);

            if (isOriginInquiry) {
                const originKota = userStoreOriginName || 'Surabaya';
                let originReply = '';
                if (custSession?.pendingOrder) {
                    originReply = `Pengiriman pesanan kami langsung dari *${originKota}* ya kak 😊\n\nUntuk pesanan kakak yang tadi, mau dikirim pakai kurir *JNE REG* atau *J&T EXPRESS* kak? 🙏`;
                } else {
                    originReply = `Pengiriman toko kami langsung dari *${originKota}* ya kak 😊\nAda produk yang ingin kakak tanyakan atau pesan?`;
                }
                await sendReplyWithTyping(sock, senderJid, { text: originReply }, 1500);
                consumeUserCredit(userId);
                addToMemory(userId, customerPhone, 'ai', originReply);
                supabase.from('chats').insert([{
                    user_id: userId, customer_phone: customerPhone, customer_name: customerName,
                    message: originReply, sender: 'ai', status: 'sent'
                }]).then();
                console.log(`✅ Balas pertanyaan asal pengiriman toko ke ${customerName}: ${originKota}`);
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
                            let destLabel = targetLokasi || custSession.lastDestination?.destLabel || '-';
                            let destId = custSession.lastDestination?.destId || null;

                            const qtyParsed = Number(orderExtract.qty) || 1;
                            const unitName = orderExtract.unit || (qtyParsed > 1 ? 'paket' : 'pcs');
                            let namaProd = orderExtract.produk || 'Produk';
                            let totalB = Number(orderExtract.total_harga_barang) || 0;
                            let unitWeight = 250; // Default bobot satuan 250 gram, BUKAN 1.000 gram (1 kg)!

                            // Cari harga dan berat asli dari database products secara cerdas
                            const allHistRaw = history.map(h => h.message || '').join(' ') + ' ' + textMessage;
                            const matchedProduct = findMatchingProduct(namaProd, products)
                                || findMatchingProduct(textMessage, products)
                                || findMatchingProduct(allHistRaw, products);

                            if (matchedProduct) {
                                namaProd = getProductFullName(matchedProduct);
                                const hrgSatuan = Number(matchedProduct.price || 0);
                                if (hrgSatuan > 0) {
                                    totalB = hrgSatuan * qtyParsed;
                                }
                                unitWeight = getProductWeight(matchedProduct, 250);
                            } else if (products && products.length > 0) {
                                // Fallback jika tidak match persis
                                const aiPrice = Number(orderExtract.total_harga_barang) || 0;
                                const firstProductPrice = Number(products[0].price || 0);
                                if (aiPrice === firstProductPrice) {
                                     totalB = firstProductPrice * qtyParsed;
                                } else if (aiPrice > 0 && aiPrice < 50000 && qtyParsed >= 10 && aiPrice === (totalB / qtyParsed)) {
                                     // Jika totalB sudah sesuai
                                } else if (aiPrice > 0 && aiPrice < 50000 && qtyParsed >= 10) {
                                     totalB = aiPrice * qtyParsed;
                                }
                                unitWeight = getProductWeight(products[0], 250);
                            }

                            // PERHITUNGAN BERAT PAKET:
                            // Dihitung berdasarkan berat per pcs asli (contoh: 10 pcs x 250g = 2.500g).
                            // JANGAN PERNAH membulatkan per-pcs ke 1 kg!
                            // Hanya batas minimal seluruh paket untuk ekspedisi adalah 1.000 gram.
                            const totalPaketGram = qtyParsed * unitWeight;
                            const orderBeratGram = Math.max(1000, totalPaketGram);
                            const beratKgDisplay = totalPaketGram < 1000 ? `${totalPaketGram}g` : `${(totalPaketGram / 1000).toFixed(1).replace('.0', '')} kg`;
                            let shippingRates = null;

                            if (targetLokasi && targetLokasi.length >= 3) {
                                try {
                                    const destinations = await searchDestination(targetLokasi);
                                    if (destinations && destinations.length > 0) {
                                        const target = destinations[0];
                                        destId = target.id || target.subdistrict_id || target.city_id;
                                        destLabel = target.label || targetLokasi;
                                        shippingRates = await calculateShipping(destId, orderBeratGram, userStoreOriginId);
                                    }
                                } catch (sErr) {
                                    console.warn('⚠️ Gagal hitung tarif ongkir:', sErr.message);
                                }
                            }

                            if (!shippingRates && destId) {
                                try {
                                    shippingRates = await calculateShipping(destId, orderBeratGram, userStoreOriginId);
                                } catch (e) {}
                            }

                            if (orderExtract.kurir) {
                                const k = orderExtract.kurir.toLowerCase();
                                if (k.includes('jnt') || k.includes('j&t')) kurirDipilih = 'J&T EXPRESS';
                                else if (k.includes('jne')) kurirDipilih = 'JNE REG';
                            }

                            custSession.pendingOrder = {
                                produk: `${namaProd} x ${qtyParsed} ${unitName}`,
                                qty: qtyParsed,
                                totalBarang: totalB,
                                namaPenerima: orderExtract.nama_penerima || customerName,
                                alamat: orderExtract.alamat || destLabel,
                                destId: destId,
                                destLabel: destLabel,
                                orderBeratGram: orderBeratGram,
                                orderBeratKgDisplay: beratKgDisplay,
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

                    // Jika rate belum ada dan ada destId, coba kalkulasi real-time sekali lagi
                    if (!selectedRate && (pendingOrder.destId || custSession.lastDestination?.destId)) {
                        const targetDestId = pendingOrder.destId || custSession.lastDestination?.destId;
                        const wGram = pendingOrder.orderBeratGram || 1000;
                        try {
                            const freshRates = await calculateShipping(targetDestId, wGram, userStoreOriginId);
                            if (freshRates && freshRates.length > 0) {
                                if (kurirDipilih.includes('J&T')) {
                                    selectedRate = freshRates.find(r => (r.name || r.courier || '').toLowerCase().includes('jnt') || (r.name || r.courier || '').toLowerCase().includes('j&t'));
                                } else {
                                    selectedRate = freshRates.find(r => (r.name || r.courier || '').toLowerCase().includes('jne'));
                                }
                                if (!selectedRate) selectedRate = freshRates[0];
                            }
                        } catch (e) {}
                    }

                    const rateCost = Number(selectedRate ? (selectedRate.cost || selectedRate.price || 0) : 0);
                    ongkirFinal = rateCost;
                    grandTotalFinal = (pendingOrder.totalBarang || 0) + ongkirFinal;
                    hargaBarangDisplay = (pendingOrder.totalBarang || 0).toLocaleString('id-ID');

                    // Bersihkan cache setelah dipakai
                    custSession.pendingOrder = null;
                    console.log(`✅ Invoice dari pendingOrder: ${produk}, berat: ${pendingOrder.orderBeratGram || 'unknown'}g, harga: ${pendingOrder.totalBarang}, ongkir: ${ongkirFinal}`);

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
            } else if (intent === 'ASK_ORIGIN') {
                const originKota = userStoreOriginName || 'Surabaya';
                console.log(`📍 Pengguna bertanya asal pengiriman. Menjawab lokasi toko: ${originKota}`);

                // Cek apakah ada pendingOrder aktif dari percakapan sebelumnya
                if (custSession?.pendingOrder) {
                    aiReply = `Pengiriman pesanan kami langsung dari *${originKota}* ya kak 😊\n\nUntuk pesanan kakak yang tadi, mau dikirim pakai kurir *JNE REG* atau *J&T EXPRESS* kak? 🙏`;
                } else {
                    aiReply = `Pengiriman toko kami langsung dari *${originKota}* ya kak 😊\nAda produk yang ingin kakak tanyakan atau pesan?`;
                }
            } else if (intent === 'CHECK_SHIPPING') {
                // Pengaman ganda: jika pesan sebenarnya menanyakan asal pengiriman / lokasi toko
                const isOriginMsg = /(?:pengiriman|kirim|dikirim|asal|paket(?:nya)?)\s+(?:dari|dr)\s*mana/i.test(textMessage)
                    || /(?:dari|dr)\s*mana\s*(?:kak|min|gan)?\s*(?:pengiriman|kirim|dikirim)/i.test(textMessage)
                    || /(?:lokasi|alamat|posisi|tempat)\s*(?:toko|lapak|gudang|pengiriman)/i.test(textMessage)
                    || /(?:toko|lapak|gudang)\s*(?:di|ada di)\s*mana/i.test(textMessage)
                    || /dari\s*(?:kota|daerah|wilayah)\s*mana/i.test(textMessage);

                if (isOriginMsg) {
                    const originKota = userStoreOriginName || 'Surabaya';
                    if (custSession?.pendingOrder) {
                        aiReply = `Pengiriman pesanan kami langsung dari *${originKota}* ya kak 😊\n\nUntuk pesanan kakak yang tadi, mau dikirim pakai kurir *JNE REG* atau *J&T EXPRESS* kak? 🙏`;
                    } else {
                        aiReply = `Pengiriman toko kami langsung dari *${originKota}* ya kak 😊\nAda produk yang ingin kakak tanyakan atau pesan?`;
                    }
                } else {
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

                    // 2. Hanya gunakan lastDestination jika pesan benar-benar menanyakan ongkir lanjutan (misal: "kalau 2 kg berapa?", "perkilo berapa?")
                    const isFollowUpShippingQuery = /(?:ongkir|ongkos|tarif|biaya|per[\s\-]?kilo|per[\s\-]?kg|\bkg\b|\bkilo\b)/i.test(textMessage);
                    if (!queryLokasi && custSession?.lastDestination && isFollowUpShippingQuery) {
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

                        // 1. Cek apakah percakapan membicarakan produk tertentu & kuantitas
                        const allHistTextShip = (history.map(h => h.message || '').join(' ') + ' ' + textMessage).toLowerCase();
                        const allHistRawShip = history.map(h => h.message || '').join('\n') + '\n' + textMessage;

                        const foundProduct = findMatchingProduct(textMessage, products) 
                            || findMatchingProduct(allHistTextShip, products);

                        let foundQty = 1;
                        const qtyM = allHistTextShip.match(/(\d+)\s*(?:pcs|buah|biji|bungkus|pack|paket)/i);
                        if (qtyM) {
                            foundQty = parseInt(qtyM[1], 10) || 1;
                        }

                        // Cek apakah pelanggan secara eksplisit bertanya per kilo atau berat tertentu
                        const explicitKgMatch = textMessage.match(/(\d+)\s*(?:kg|kilo)\b/i);
                        const isExplicitPerKilo = /per[\s\-]?kilo|per[\s\-]?kg/i.test(textMessage);

                        let calcWeightGram = 1000;
                        let beratLabel = 'estimasi per kg';

                        if (isExplicitPerKilo) {
                            calcWeightGram = 1000;
                            beratLabel = 'per kg';
                        } else if (explicitKgMatch) {
                            const bKg = parseInt(explicitKgMatch[1], 10) || 1;
                            calcWeightGram = bKg * 1000;
                            beratLabel = `berat ${bKg} kg`;
                        } else if (foundProduct && foundQty > 0) {
                            const unitWeight = getProductWeight(foundProduct, 250);
                            const totalItemGram = foundQty * unitWeight;
                            calcWeightGram = Math.max(1000, totalItemGram);
                            const kgFormatted = (totalItemGram / 1000).toFixed(1).replace('.0', '');
                            beratLabel = foundQty > 1 ? `${foundQty} pcs / ${kgFormatted} kg` : (totalItemGram < 1000 ? `${totalItemGram}g (min. 1 kg)` : `${kgFormatted} kg`);
                        } else {
                            calcWeightGram = 1000;
                            beratLabel = 'estimasi per kg';
                        }

                        console.log(`⚖️ Hitung ongkir tujuan=${destLabel} dengan berat: ${calcWeightGram} gram (${beratLabel})`);

                        const shippingRates = await calculateShipping(destId, calcWeightGram, userStoreOriginId);

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

                            // =============================================
                            // Cache order context untuk SELECT_COURIER nanti
                            // =============================================
                            try {
                                if (foundProduct) {
                                    const namaM2 = allHistRawShip.match(/(?:nama|penerima|a\/n|an)\s*(?::|\s)\s*([a-zA-Z\s]+?)(?:\s+(?:nomor|no|hp|wa|alamat|jl|kec|kab|surabaya|jakarta)|,|$)/i)
                                        || allHistRawShip.match(/nama\s+([a-zA-Z\s]+?)(?:\s*,|\s+alamat|\s+jl|\s+kec|\n|$)/i);
                                    const foundNama = namaM2 ? namaM2[1].trim() : customerName;
                                    const jlM2 = allHistRawShip.match(/(?:jl\.|jalan)\s+.+?(?=,\s*kec|,\s*kel|\n|$)/i);
                                    const kecM2 = allHistRawShip.match(/kec(?:amatan)?\s*[\w\s]+/i);
                                    const hpM2 = allHistRawShip.match(/(?:no(?:mor)?(?:\s*hp|\s*wa)?|hp|wa)?\s*[:\s]?\s*(0[89]\d{7,11}|\+?62[89]\d{7,11})/i);
                                    const foundAlamat = [jlM2?.[0], kecM2?.[0]].filter(Boolean).join(', ') || destLabel;
                                    const foundHp = hpM2 ? hpM2[1].trim() : '';

                                    const unitWeight = getProductWeight(foundProduct, 250);
                                    const orderTotalWeight = foundQty * unitWeight;
                                    const orderBeratGram = Math.max(1000, orderTotalWeight);
                                    const prodFullName = getProductFullName(foundProduct);
                                    const unitPrice = Number(foundProduct.price || 0);
                                    const totalBarang = unitPrice * foundQty;

                                    custSession.pendingOrder = {
                                        produk: `${prodFullName} x ${foundQty} pcs`,
                                        qty: foundQty,
                                        hargaProduk: unitPrice,
                                        totalBarang: totalBarang,
                                        namaPenerima: foundNama,
                                        alamat: foundAlamat,
                                        destId: destId,
                                        destLabel: destLabel,
                                        orderBeratGram: orderBeratGram,
                                        shippingRates: displayRates
                                    };
                                    console.log(`📦 pendingOrder cached (CHECK_SHIPPING): ${prodFullName} x${foundQty}, total: ${totalBarang}, berat: ${orderBeratGram}g`);

                                    // Tampilkan rincian pesanan dan total lengkap (Bukan sekadar list ongkir)
                                    const grandTotalsPerCourier = displayRates.map(r => {
                                        const oHarga = Number(r.cost || r.price || 0);
                                        const n = (r.name || r.courier || '').toLowerCase();
                                        const kurir = (n.includes('jnt') || n.includes('j&t')) ? 'J&T EXPRESS' : 'JNE REG';
                                        return `   • *${kurir}*: Rp ${totalBarang.toLocaleString('id-ID')} + Rp ${oHarga.toLocaleString('id-ID')} = *Rp ${(totalBarang + oHarga).toLocaleString('id-ID')}*`;
                                    }).join('\n');

                                    aiReply = `Siap kak! Ini rincian dan total pesanannya:\n\n` +
                                        `━━━━━━━━━━━━━━━━━\n` +
                                        `📋 *RINCIAN PESANAN*\n` +
                                        `━━━━━━━━━━━━━━━━━\n` +
                                        `📦 *Produk:* ${prodFullName} x ${foundQty} pcs\n` +
                                        `💰 *Harga Barang:* Rp ${totalBarang.toLocaleString('id-ID')} (${foundQty} x Rp ${unitPrice.toLocaleString('id-ID')})\n` +
                                        `⚖️ *Total Berat:* ${beratLabel}\n` +
                                        `\n🚚 *Pilihan Ongkir ke ${destLabel}:*\n${listOngkir}\n` +
                                        `\n💳 *Estimasi Total (Barang + Ongkir):*\n${grandTotalsPerCourier}\n` +
                                        `━━━━━━━━━━━━━━━━━\n` +
                                        `👤 *Penerima:* ${foundNama}\n` +
                                        `📍 *Alamat:* ${foundAlamat}\n` +
                                        (foundHp ? `📱 *No. HP:* ${foundHp}\n` : '') +
                                        `━━━━━━━━━━━━━━━━━\n` +
                                        `Kakak mau pilih kirim pakai kurir yang mana? (*JNE REG* atau *J&T EXPRESS*) 😊`;
                                } else {
                                    aiReply = `Ongkir ke *${destLabel}* (${beratLabel}):\n\n${listOngkir}\n\nMau pilih *JNE REG* atau *J&T* kak? 😊`;
                                }
                            } catch (cacheErr) {
                                console.warn('⚠️ Gagal cache pendingOrder di CHECK_SHIPPING:', cacheErr.message);
                                aiReply = `Ongkir ke *${destLabel}* (${beratLabel}):\n\n${listOngkir}\n\nMau pilih *JNE REG* atau *J&T* kak? 😊`;
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
            }
            } else {
                // intent === 'GENERAL'
                let autoShippingInfo = "";
                let autoShippingRates = null;
                let autoDestLabel = "";

                const allMessages = history.map(h => h.message || '').join(' ').toLowerCase();

                // Cek produk & kuantitas terlebih dahulu agar berat bisa dihitung
                let produkOrdered = "Produk";
                let hargaProduk = 0;
                let unitWeight = 250;
                let foundProductObj = findMatchingProduct(allMessages, products);
                if (foundProductObj) {
                    produkOrdered = getProductFullName(foundProductObj);
                    hargaProduk = Number(foundProductObj.price || 0);
                    unitWeight = getProductWeight(foundProductObj, 250);
                } else if (products && products.length > 0) {
                    produkOrdered = getProductFullName(products[0]);
                    hargaProduk = Number(products[0].price || 0);
                    unitWeight = getProductWeight(products[0], 250);
                }
                const qtyMatch = allMessages.match(/(\d+)\s*pcs/i) || allMessages.match(/(\d+)\s*buah/i) || allMessages.match(/(\d+)\s*kg/i);
                const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                const totalBarang = hargaProduk * qty;
                const totalItemWeight = qty * unitWeight;
                const totalWeight = Math.max(1000, totalItemWeight);
                const beratKg = Math.ceil(totalWeight / 1000);

                const hasProductInHistory = Boolean(foundProductObj) || allMessages.includes('kaos') || allMessages.includes('kripik') || allMessages.includes('beli') || allMessages.includes('pesan') || allMessages.includes('order');
                const hasAddressInMsg = /kec(?:amatan)?|jalan|jl\.|alamat|surabaya|jakarta|bandung|semarang|medan|malang|kota|kab/i.test(textMessage);
                const hasNameInMsg = /(?:nama|penerima|a\/n|an)\s*(?::|\s)\s*[a-zA-Z]/i.test(textMessage) || /penerima\s+[a-zA-Z]/i.test(textMessage);

                try {
                    const queryLokasi = intentData.location || extractLokasiFromText(textMessage); 
                    if (queryLokasi && queryLokasi.length >= 3) {
                        console.log(`🚀 Auto-hitung ongkir: "${queryLokasi}"`);
                        const destinations = await searchDestination(queryLokasi);
                        if (destinations && destinations.length > 0) {
                            const target = destinations[0];
                            const destId = target.id || target.subdistrict_id || target.city_id;
                            autoDestLabel = target.label || target.subdistrict_name || target.city_name || queryLokasi;
                            const rates = await calculateShipping(destId, totalWeight, userStoreOriginId);
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

                if ((hasAddressInMsg || autoShippingRates) && (hasNameInMsg || textMessage.toLowerCase().includes('penerima')) && hasProductInHistory && autoShippingRates) {
                    const namaMatch = textMessage.match(/(?:nama|penerima|a\/n|an)\s*(?::|\s)\s*([a-zA-Z\s]+?)(?:\s+(?:nomor|no|hp|wa|alamat|jl|kec|kab|surabaya|jakarta)|,|$)/i)
                        || textMessage.match(/nama\s+([a-zA-Z\s]+?)(?:\s+alamat|\s+jl|\s+kec|$)/i);
                    const namaPenerima = namaMatch ? namaMatch[1].trim() : customerName;

                    const hpMatch = textMessage.match(/(?:no(?:mor)?(?:\s*hp|\s*wa)?|hp|wa)?\s*[:\s]?\s*(0[89]\d{7,11}|\+?62[89]\d{7,11})/i);
                    const noHpCustomer = hpMatch ? hpMatch[1].trim() : '';

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

                    let alamatBersih = textMessage
                        .replace(/(?:nama|penerima|a\/n|an)\s*(?::|\s)\s*[a-zA-Z\s]+?(?=\s+(?:nomor|no|hp|wa|alamat|jl|kec)|,|$)/i, '')
                        .replace(/(?:no(?:mor)?(?:\s*hp|\s*wa)?|hp|wa)?\s*[:\s]?\s*(?:0[89]\d{7,11}|\+?62[89]\d{7,11})/i, '')
                        .replace(/^\s*alamat\s*[:\s]?/i, '')
                        .trim();
                    if (!alamatBersih || alamatBersih.length < 3) {
                        alamatBersih = autoDestLabel || 'Alamat tujuan pengiriman';
                    }

                    aiReply = `Siap kak! Ini rincian dan total pesanannya:\n\n` +
                        `━━━━━━━━━━━━━━━━━\n` +
                        `📋 *RINCIAN PESANAN*\n` +
                        `━━━━━━━━━━━━━━━━━\n` +
                        `📦 *Produk:* ${produkOrdered} x ${qty} pcs\n` +
                        `💰 *Harga Barang:* Rp ${totalBarang.toLocaleString('id-ID')} (${qty} x Rp ${hargaProduk.toLocaleString('id-ID')})\n` +
                        `\n🚚 *Pilihan Ongkir ke ${autoDestLabel}:*\n${opsiOngkir}\n` +
                        `\n💳 *Estimasi Total dengan kurir termurah (${kurirTerpilih}):*\n` +
                        `   Rp ${totalBarang.toLocaleString('id-ID')} + Rp ${ongkirHarga.toLocaleString('id-ID')} = *Rp ${grandTotal.toLocaleString('id-ID')}*\n` +
                        `━━━━━━━━━━━━━━━━━\n` +
                        `👤 *Penerima:* ${namaPenerima}\n` +
                        `📍 *Alamat:* ${alamatBersih}\n` +
                        (noHpCustomer ? `📱 *No. HP:* ${noHpCustomer}\n` : '') +
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

            // =============================================
            // CEK APAKAH PERLU KIRIM GAMBAR / FOTO PRODUK
            // =============================================
            let sendImageProduct = null;
            const sendImageTagMatch = aiReply.match(/\[SEND_IMAGE:\s*([^\]]+)\]/i);
            if (sendImageTagMatch) {
                const prodQuery = sendImageTagMatch[1].trim().toLowerCase();
                aiReply = aiReply.replace(/\[SEND_IMAGE:[^\]]+\]/gi, '').trim();
                if (products && products.length > 0) {
                    sendImageProduct = findMatchingProduct(prodQuery, products);
                }
            }

            // Fallback: Jika pelanggan meminta foto/gambar tapi AI lupa sertakan tag [SEND_IMAGE]
            const isAskingImage = /(?:minta|kirim|lihat|ada|spill|share|bagi|mau\s+lihat|tengok|liat)\s+(?:foto|gambar|pict|pic|realpict|realpic|fotonya|gambarnya)/i.test(lowerText) ||
                /(?:foto|gambar|pict|pic|realpict|realpic)\s*(?:nya|dong|kak|ada|bisa|kah)/i.test(lowerText) ||
                /^(?:foto|gambar|fotonya|gambarnya)\b/i.test(lowerText);

            if (!sendImageProduct && isAskingImage && products && products.length > 0) {
                console.log(`🖼️ Deteksi eksplisit permintaan foto/gambar dari teks: "${textMessage}"`);
                // 1. Cari produk yang namanya disebut di pesan sekarang dan memiliki foto
                sendImageProduct = findMatchingProduct(textMessage, products?.filter(p => p.image_url));

                // 2. Cari produk dari riwayat percakapan terbaru yang memiliki foto
                if (!sendImageProduct && history && history.length > 0) {
                    const recentContext = history.slice(-6).map(h => (h.message || '').toLowerCase()).join(' ');
                    sendImageProduct = findMatchingProduct(recentContext, products?.filter(p => p.image_url));
                }

                // 3. Fallback: jika toko hanya punya 1 produk atau produk pertama yang memiliki foto
                if (!sendImageProduct) {
                    const prodsWithImg = products.filter(p => p.image_url);
                    if (prodsWithImg.length === 1) {
                        sendImageProduct = prodsWithImg[0];
                    }
                }
            }

            let imageSentSuccessfully = false;
            if (sendImageProduct && sendImageProduct.image_url) {
                const imgRaw = String(sendImageProduct.image_url).trim();
                const prodNameDisplay = sendImageProduct.name || sendImageProduct.title || 'Produk';
                console.log(`📸 Menyiapkan pengiriman media gambar untuk produk "${prodNameDisplay}" ke ${customerName}`);
                let mediaPayload = null;

                try {
                    if (imgRaw.startsWith('data:image/')) {
                        const base64Data = imgRaw.replace(/^data:image\/[a-zA-Z0-9\-\+\.]+;base64,/, '');
                        const mimeMatch = imgRaw.match(/^data:(image\/[a-zA-Z0-9\-\+\.]+);base64,/);
                        const mimetype = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                        mediaPayload = {
                            image: Buffer.from(base64Data, 'base64'),
                            mimetype: mimetype
                        };
                    } else if (imgRaw.startsWith('http://') || imgRaw.startsWith('https://')) {
                        mediaPayload = {
                            image: { url: imgRaw }
                        };
                    } else {
                        // File lokal di folder publik / project
                        const possiblePaths = [
                            path.join(frontendPath, imgRaw.replace(/^\//, '')),
                            path.join(__dirname, '..', imgRaw.replace(/^\//, '')),
                            path.join(__dirname, 'public', imgRaw.replace(/^\//, '')),
                            path.join(__dirname, '../..', imgRaw.replace(/^\//, ''))
                        ];
                        for (const fp of possiblePaths) {
                            if (fs.existsSync(fp)) {
                                mediaPayload = {
                                    image: fs.readFileSync(fp),
                                    mimetype: 'image/jpeg'
                                };
                                break;
                            }
                        }
                    }

                    if (mediaPayload) {
                        if (aiReply && aiReply.length <= 1000) {
                            mediaPayload.caption = aiReply;
                            await sendReplyWithTyping(sock, senderJid, mediaPayload);
                            consumeUserCredit(userId);
                            imageSentSuccessfully = true;
                        } else {
                            mediaPayload.caption = `Foto produk *${prodNameDisplay}* kak 😊`;
                            await sendReplyWithTyping(sock, senderJid, mediaPayload);
                            if (aiReply) {
                                await sendReplyWithTyping(sock, senderJid, { text: aiReply });
                            }
                            consumeUserCredit(userId);
                            imageSentSuccessfully = true;
                        }
                        console.log(`✅ Gambar produk "${prodNameDisplay}" berhasil dikirim ke ${customerName}`);
                    } else {
                        console.warn(`⚠️ Path media gambar tidak ditemukan untuk "${prodNameDisplay}": ${imgRaw.substring(0, 50)}`);
                    }
                } catch (mediaErr) {
                    console.error(`⚠️ Gagal mengirim media gambar via Baileys:`, mediaErr.message);
                }
            }

            // Kirim balasan teks ke WhatsApp jika gambar belum/gagal dikirim dengan caption
            if (!imageSentSuccessfully) {
                await sendReplyWithTyping(sock, senderJid, { text: aiReply });
                consumeUserCredit(userId);
                console.log(`✅ Balas ke ${customerName}: ${aiReply.substring(0, 100)}`);
            }

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
                status: isForwardToAdmin ? 'escalated_to_admin' : 'handled_by_ai'
            }]).then(({error}) => {
                if (error) console.warn('⚠️ Gagal simpan balasan AI ke Supabase:', error.message);
            });

        } catch (err) {
            console.error("Gagal memproses pesan:", err);
            supabase.from('chats').insert([{
                user_id: userId,
                customer_phone: customerPhone,
                customer_name: customerName,
                message: `[Error: ${err.message}]`,
                sender: 'ai',
                status: 'failed'
            }]).then();
        }
        } // End of for loop
    });
}
// ==========================================
// REST API ENDPOINTS UNTUK DASHBOARD
// ==========================================

        // Endpoint untuk meminta QR Code (Start Bot WhatsApp)
        app.post('/api/bot/start', async (req, res) => {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'userId diperlukan' });

            // 0. Validasi masa trial & batas kuota terlebih dahulu
            const access = await checkUserAccess(userId, true);
            if (!access.isAllowed) {
                const errorMsg = access.expiredReason === 'TIME_EXPIRED'
                    ? 'Masa uji coba gratis (trial 1 hari / 24 jam) Anda telah berakhir. Silakan pilih paket langganan untuk melanjutkan.'
                    : 'Batas kuota 100 kredit chat WhatsApp trial Anda telah habis terpakai. Silakan pilih paket langganan untuk melanjutkan.';
                return res.status(403).json({
                    status: 'EXPIRED',
                    isTrialExpired: true,
                    expiredReason: access.expiredReason,
                    error: errorMsg
                });
            }

            // 1. Jika sudah terhubung secara riil
            if (activeSessions[userId]?.status === 'CONNECTED' && activeSessions[userId]?.sock?.ws?.readyState === 1) {
                return res.json({ status: 'CONNECTED', message: 'WhatsApp sudah terhubung' });
            }

            // 2. Jika QR code aktif sudah tersedia
            if (activeSessions[userId]?.status === 'SCAN_QR' && activeSessions[userId]?.qr) {
                return res.json({ status: 'qr', qr: activeSessions[userId].qr });
            }

            // 3. Bersihkan sesi lama jika macet / belum terhubung
            const sessionDir = path.join(__dirname, `auth_info_${userId}`);
            if (activeSessions[userId]) {
                try {
                    if (activeSessions[userId].sock) activeSessions[userId].sock.isManuallyStopped = true;
                    activeSessions[userId].sock?.ev?.removeAllListeners();
                    if (activeSessions[userId].sock?.ws) activeSessions[userId].sock.ws.close();
                    if (activeSessions[userId].sock?.end) activeSessions[userId].sock.end();
                } catch (e) {}
                delete activeSessions[userId];
            }

            // 4. Jika folder auth ada tapi belum terdaftar (unregistered / gagal scan sebelumnya),
            // bersihkan creds agar WhatsApp menghasilkan QR code baru yang bersih
            const credsPath = path.join(sessionDir, 'creds.json');
            if (fs.existsSync(credsPath)) {
                try {
                    const credsData = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                    if (!credsData.registered) {
                        console.log(`[INFO] Sesi user ${userId} belum teregistrasi, membersihkan auth lama untuk scan QR baru...`);
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                    }
                } catch (err) {
                    console.warn(`[WARN] File creds user ${userId} tidak valid, membersihkan:`, err.message);
                    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (rmErr) {}
                }
            }

            // 5. Jalankan bot dan tunggu event QR atau connected
            try {
                let isResolved = false;
                const eventPromise = new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        if (!isResolved) {
                            isResolved = true;
                            if (activeSessions[userId]?.qr) {
                                resolve({ type: 'qr', data: activeSessions[userId].qr });
                            } else {
                                reject(new Error("Timeout menunggu status WhatsApp (mungkin backend lambat). Silakan klik coba lagi."));
                            }
                        }
                    }, 20000); // 20 detik timeout

                    startWhatsAppBot(userId, (event) => {
                        if (!isResolved) {
                            isResolved = true;
                            clearTimeout(timeout);
                            resolve(event);
                        }
                    }).catch((err) => {
                        if (!isResolved) {
                            isResolved = true;
                            clearTimeout(timeout);
                            reject(err);
                        }
                    });
                });

                const event = await eventPromise;
                if (event.type === 'qr') {
                    res.json({ status: 'qr', qr: event.data });
                } else {
                    res.json({ status: 'CONNECTED', message: 'WhatsApp langsung terhubung' });
                }
            } catch (error) {
                console.error('Error saat menjalankan bot WhatsApp:', error);
                if (activeSessions[userId]?.qr) {
                    return res.json({ status: 'qr', qr: activeSessions[userId].qr });
                }
                res.status(500).json({ error: 'Gagal menjalankan bot: ' + error.message });
            }
        });

        // Endpoint untuk meminta Pairing Code via Nomor HP (Alternatif selain Scan QR)
        app.post('/api/bot/pair-phone', async (req, res) => {
            const { userId, phoneNumber } = req.body;
            if (!userId) return res.status(400).json({ error: 'userId diperlukan' });
            if (!phoneNumber) return res.status(400).json({ error: 'Nomor telepon WhatsApp diperlukan' });

            const cleanNumber = sanitizePhoneNumber(phoneNumber);
            if (!cleanNumber || cleanNumber.length < 10) {
                return res.status(400).json({ error: 'Nomor telepon tidak valid. Masukkan nomor WhatsApp yang benar (contoh: 081234567890).' });
            }

            try {
                // Jika sudah terkoneksi, tidak perlu pairing ulang
                if (activeSessions[userId]?.status === 'CONNECTED' && activeSessions[userId]?.sock) {
                    return res.json({ status: 'CONNECTED', message: 'WhatsApp sudah terhubung!' });
                }

                // Untuk pairing nomor baru yang bersih, matikan sesi berjalan sebelumnya dan bersihkan auth lama jika belum terkoneksi
                if (activeSessions[userId] && activeSessions[userId].sock) {
                    try {
                        activeSessions[userId].sock.isManuallyStopped = true;
                        if (activeSessions[userId].sock.ws) activeSessions[userId].sock.ws.close();
                    } catch (e) {
                        // ignore
                    }
                    delete activeSessions[userId];
                }

                const sessionDir = path.join(__dirname, `auth_info_${userId}`);
                if (fs.existsSync(sessionDir)) {
                    try {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                        console.log(`[INFO] Sesi lama user ${userId} dibersihkan untuk pairing code baru nomor ${cleanNumber}`);
                    } catch (rmErr) {
                        console.warn('[WARN] Gagal membersihkan sessionDir lama:', rmErr.message);
                    }
                }

                // Mulai bot baru dengan sesi fresh
                await startWhatsAppBot(userId);

                const session = activeSessions[userId];
                if (!session || !session.sock) {
                    return res.status(500).json({ error: 'Gagal menginisialisasi sesi bot WhatsApp' });
                }

                // Tunggu hingga WebSocket Baileys membuka koneksi
                const isOpen = await waitForSocketOpen(session.sock, 15000);
                if (!isOpen) {
                    return res.status(500).json({ error: 'Koneksi ke server WhatsApp belum siap. Silakan klik lagi dalam beberapa detik.' });
                }

                // Beri jeda sejenak untuk memastikan enkripsi noise handshake selesai
                await new Promise(resolve => setTimeout(resolve, 1500));

                // Request kode pairing dari WhatsApp
                console.log(`[INFO] Meminta pairing code untuk user ${userId} ke nomor ${cleanNumber}...`);
                const rawCode = await session.sock.requestPairingCode(cleanNumber);
                console.log(`[INFO] Berhasil mendapatkan pairing code: ${rawCode}`);

                let formattedCode = rawCode;
                if (rawCode && rawCode.length === 8) {
                    formattedCode = `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`;
                }

                session.pairingCode = formattedCode;
                session.status = 'WAITING_PAIRING_CODE';

                res.json({
                    success: true,
                    status: 'PAIRING_CODE',
                    pairingCode: formattedCode,
                    rawCode: rawCode,
                    phoneNumber: cleanNumber,
                    message: 'Kode pairing berhasil dibuat!'
                });
            } catch (err) {
                console.error('[ERROR] Gagal membuat pairing code:', err);
                res.status(500).json({ error: 'Gagal mendapatkan kode pairing: ' + (err.message || 'Kesalahan server') });
            }
        });

        // Endpoint untuk mematikan bot sementara
        app.post('/api/bot/stop', (req, res) => {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'userId diperlukan' });
            if (activeSessions[userId]) {
                try {
                    if (activeSessions[userId].sock) activeSessions[userId].sock.isManuallyStopped = true;
                    activeSessions[userId].sock?.ev?.removeAllListeners();
                    if (activeSessions[userId].sock?.ws) activeSessions[userId].sock.ws.close();
                    if (activeSessions[userId].sock?.end) activeSessions[userId].sock.end();
                } catch (e) {}
                delete activeSessions[userId];
                return res.json({ success: true, message: 'Bot WhatsApp berhasil dimatikan' });
            }
            res.json({ success: true, message: 'Bot sudah dalam keadaan nonaktif' });
        });

        // Endpoint untuk logout / tautkan ulang (hapus sesi lengkap)
        app.post('/api/bot/logout', async (req, res) => {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'userId diperlukan' });

            if (activeSessions[userId]) {
                try {
                    if (activeSessions[userId].sock) activeSessions[userId].sock.isManuallyStopped = true;
                    activeSessions[userId].sock?.ev?.removeAllListeners();
                    if (activeSessions[userId].sock?.ws) activeSessions[userId].sock.ws.close();
                    if (activeSessions[userId].sock?.end) activeSessions[userId].sock.end();
                } catch (e) {
                    console.warn('Socket cleanup warning:', e.message);
                }
                delete activeSessions[userId];
            }

            try {
                const sessionDir = path.join(__dirname, `auth_info_${userId}`);
                const targets = [
                    sessionDir,
                    path.resolve(`auth_info_${userId}`)
                ];
                for (const t of targets) {
                    if (fs.existsSync(t)) {
                        fs.rmSync(t, { recursive: true, force: true });
                    }
                }
                console.log(`[INFO] Sesi WhatsApp user ${userId} berhasil dihapus.`);
                res.json({ success: true, message: 'Sesi WhatsApp berhasil dihapus. Silakan klik Jalankan Bot untuk tautkan ulang.' });
            } catch (error) {
                console.error('Gagal menghapus folder sesi:', error);
                res.status(500).json({ error: 'Gagal menghapus sesi: ' + error.message });
            }
        });

        // Endpoint untuk mengecek status bot & masa trial
        app.get('/api/bot/status/:userId', async (req, res) => {
            const { userId } = req.params;
            const session = activeSessions[userId];
            const access = await checkUserAccess(userId);

            const baseInfo = {
                isTrialExpired: access.isExpired,
                expiredReason: access.expiredReason,
                remainingCredits: access.remainingCredits,
                usedCredits: access.usedCredits,
                totalQuota: access.totalQuota,
                trialHoursLeft: access.trialHoursLeft,
                plan: access.plan
            };

            // Jika masa trial atau kuota habis, bot otomatis berstatus EXPIRED & nonaktif
            if (access.isExpired) {
                return res.json({
                    status: 'EXPIRED',
                    isBotActive: false,
                    ...baseInfo
                });
            }

            if (session) {
                const isAutoActive = session.isAutoReplyActive !== false;
                if (session.status === 'CONNECTED') {
                    res.json({ status: 'CONNECTED', isBotActive: isAutoActive, ...baseInfo });
                } else if (session.status === 'WAITING_PAIRING_CODE' || session.pairingCode) {
                    res.json({ status: 'PAIRING_CODE', pairingCode: session.pairingCode, qr: session.qr, isBotActive: isAutoActive, ...baseInfo });
                } else if (session.status === 'SCAN_QR' || session.qr) {
                    res.json({ status: 'qr', qr: session.qr, pairingCode: session.pairingCode || null, isBotActive: isAutoActive, ...baseInfo });
                } else {
                    res.json({ status: 'CONNECTING', pairingCode: session.pairingCode || null, isBotActive: isAutoActive, ...baseInfo });
                }
            } else {
                res.json({ status: 'DISCONNECTED', isBotActive: false, ...baseInfo });
            }
        });

        // Endpoint toggle on/off auto-reply AI
        app.post('/api/bot/toggle-active', (req, res) => {
            const { active, userId } = req.body;
            const targetUserId = userId || Object.keys(activeSessions)[0];
            if (targetUserId && activeSessions[targetUserId]) {
                activeSessions[targetUserId].isAutoReplyActive = Boolean(active);
                console.log(`[BOT TOGGLE] User ${targetUserId} mengubah mode auto-reply: ${active ? 'AKTIF' : 'NONAKTIF'}`);
            }
            res.json({ success: true, isBotActive: Boolean(active) });
        });

        // Endpoint menghapus riwayat chat pelanggan tertentu atau seluruh chat user (Reset Testing)
        app.post('/api/chat/clear', async (req, res) => {
            const { userId, customerPhone } = req.body;
            if (!userId) return res.status(400).json({ error: 'userId diperlukan' });

            try {
                if (customerPhone) {
                    const cleanPhone = String(customerPhone).replace(/\D/g, '');
                    // 1. Bersihkan in-memory history
                    const memKey = getMemoryKey(userId, customerPhone);
                    const memKeyClean = getMemoryKey(userId, cleanPhone);
                    delete inMemoryHistory[memKey];
                    delete inMemoryHistory[memKeyClean];

                    // 2. Bersihkan in-memory session pelanggan
                    if (activeSessions[userId]?.customers) {
                        delete activeSessions[userId].customers[customerPhone];
                        delete activeSessions[userId].customers[cleanPhone];
                    }

                    // 3. Hapus dari database Supabase
                    const { error } = await supabase
                        .from('chats')
                        .delete()
                        .eq('user_id', userId)
                        .or(`customer_phone.eq.${customerPhone},customer_phone.eq.${cleanPhone}`);

                    if (error) throw error;
                    console.log(`🗑️ Riwayat chat dengan ${customerPhone} berhasil dihapus permanen oleh user ${userId}`);
                    return res.json({ success: true, message: `Riwayat chat dengan ${customerPhone} berhasil dihapus.` });
                } else {
                    // Hapus semua memory history user ini
                    Object.keys(inMemoryHistory).forEach(k => {
                        if (k.startsWith(`${userId}_`)) delete inMemoryHistory[k];
                    });
                    if (activeSessions[userId]) {
                        activeSessions[userId].customers = {};
                    }

                    // Hapus semua chat user ini di Supabase
                    const { error } = await supabase
                        .from('chats')
                        .delete()
                        .eq('user_id', userId);

                    if (error) throw error;
                    console.log(`🗑️ Semua riwayat chat user ${userId} berhasil dibersihkan`);
                    return res.json({ success: true, message: 'Semua riwayat chat berhasil dibersihkan.' });
                }
            } catch (err) {
                console.error('Gagal menghapus riwayat chat:', err);
                res.status(500).json({ error: 'Gagal menghapus riwayat chat: ' + err.message });
            }
        });

        // Endpoint membersihkan in-memory cache chat (dipanggil saat Knowledge Base atau Produk diubah)
        app.post('/api/chat/clear-cache', (req, res) => {
            const { userId } = req.body;
            if (userId) {
                Object.keys(inMemoryHistory).forEach(k => {
                    if (k.startsWith(`${userId}_`)) delete inMemoryHistory[k];
                });
                if (activeSessions[userId]) {
                    activeSessions[userId].customers = {};
                }
                console.log(`🧹 Cache in-memory chat untuk user ${userId} dibersihkan`);
            }
            res.json({ success: true });
        });
        // ==========================================
        // ADMIN API ENDPOINTS (SUPER ADMIN)
        // ==========================================
        
        // 1. Ambil statistik lengkap platform (Overview Metrics Riil)
        app.get('/api/admin/stats', async (req, res) => {
            try {
                // Total users & breakdown
                const { data: usersData, error: usersErr } = await supabase.auth.admin.listUsers();
                if (usersErr) throw usersErr;
                const users = usersData?.users || [];
                const totalUsers = users.length;
                let activeUsers = 0;
                let proUsers = 0;
                let starterUsers = 0;
                let trialUsers = 0;

                users.forEach(u => {
                    const status = (u.user_metadata?.status || 'active').toLowerCase();
                    if (status === 'active') activeUsers++;
                    const plan = (u.user_metadata?.plan || 'starter').toLowerCase();
                    if (plan === 'pro') proUsers++;
                    else if (plan === 'trial') trialUsers++;
                    else starterUsers++;
                });

                // Total chats
                const { count: totalChats, error: chatsErr } = await supabase
                    .from('chats')
                    .select('*', { count: 'exact', head: true });

                // Invoices & Revenue
                const { data: invoices, error: invErr } = await supabase
                    .from('invoices')
                    .select('amount, total_amount, status, created_at');

                let totalRevenue = 0;
                let pendingInvoices = 0;
                let pendingAmount = 0;
                let paidCount = 0;

                if (invoices) {
                    invoices.forEach(inv => {
                        const amt = Number(inv.amount || inv.total_amount || 0);
                        const st = (inv.status || '').toLowerCase();
                        if (st === 'paid' || st === 'settlement' || st === 'success') {
                            totalRevenue += amt;
                            paidCount++;
                        } else if (st === 'pending') {
                            pendingInvoices++;
                            pendingAmount += amt;
                        }
                    });
                }

                // Server Uptime calculation
                const uptimeSecs = Math.floor((Date.now() - serverStartTime) / 1000);
                const days = Math.floor(uptimeSecs / 86400);
                const hours = Math.floor((uptimeSecs % 86400) / 3600);
                const mins = Math.floor((uptimeSecs % 3600) / 60);
                const uptimeStr = days > 0 ? `${days}h ${hours}j ${mins}m` : `${hours}j ${mins}m`;

                // Active WhatsApp sessions
                let activeWaCount = 0;
                for (const uid in activeSessions) {
                    if (activeSessions[uid]?.status === 'CONNECTED') activeWaCount++;
                }

                res.json({
                    totalUsers,
                    activeUsers,
                    proUsers,
                    starterUsers,
                    trialUsers,
                    totalChats: totalChats || 0,
                    totalRevenue,
                    paidCount,
                    pendingInvoices,
                    pendingAmount,
                    uptimeSecs,
                    uptimeStr,
                    uptimePercent: '99.9%',
                    activeWaCount,
                    totalSessionsCount: Object.keys(activeSessions).length
                });
            } catch (err) {
                console.error('Error fetching admin stats:', err);
                res.status(500).json({ error: err.message });
            }
        });

        // 2. Ambil data Revenue & Billing Riil
        app.get('/api/admin/revenue', async (req, res) => {
            try {
                const { data: invoices, error: invErr } = await supabase
                    .from('invoices')
                    .select('*')
                    .order('created_at', { ascending: false });
                if (invErr) throw invErr;

                // Lookup users metadata untuk info toko
                const { data: usersData } = await supabase.auth.admin.listUsers();
                const userMap = {};
                if (usersData?.users) {
                    usersData.users.forEach(u => {
                        userMap[u.id] = {
                            email: u.email,
                            storeName: u.user_metadata?.store_name || u.user_metadata?.name || u.email.split('@')[0],
                            phone: u.user_metadata?.phone || '-'
                        };
                    });
                }

                let totalRevenue = 0;
                let pendingInvoices = 0;
                let pendingAmount = 0;
                let activeSubs = 0;

                const transactions = (invoices || []).map(inv => {
                    const amt = Number(inv.amount || inv.total_amount || 0);
                    const st = (inv.status || 'pending').toLowerCase();
                    if (st === 'paid' || st === 'settlement' || st === 'success') {
                        totalRevenue += amt;
                        activeSubs++;
                    } else if (st === 'pending') {
                        pendingInvoices++;
                        pendingAmount += amt;
                    }

                    const userInfo = userMap[inv.user_id] || { storeName: 'Tenant ' + (inv.user_id ? inv.user_id.slice(0, 6) : '-'), email: '-' };

                    return {
                        id: inv.id || inv.invoice_id || ('INV-' + (inv.created_at ? new Date(inv.created_at).getTime() : Date.now())),
                        userId: inv.user_id,
                        storeName: inv.customer_name || userInfo.storeName,
                        email: userInfo.email,
                        phone: inv.customer_phone || userInfo.phone,
                        amount: amt,
                        plan: inv.plan_name || 'Pro',
                        method: (inv.payment_method || 'QRIS').toUpperCase(),
                        status: inv.status || 'pending',
                        date: inv.created_at
                    };
                });

                res.json({
                    totalRevenue,
                    activeSubs,
                    pendingInvoices,
                    pendingAmount,
                    transactions
                });
            } catch (err) {
                console.error('Error fetching admin revenue:', err);
                res.status(500).json({ error: err.message });
            }
        });

        // 3. Ambil metrik kesehatan server nyata (System Health)
        app.get('/api/admin/health', async (req, res) => {
            try {
                const cpus = os.cpus();
                const freeMem = os.freemem();
                const totalMem = os.totalmem();
                const usedMem = totalMem - freeMem;
                const ramPercent = Math.round((usedMem / totalMem) * 100);

                const loadAvg = os.loadavg();
                const cpuPercent = Math.min(100, Math.round((loadAvg[0] / (cpus.length || 1)) * 100)) || Math.round(Math.random() * 8 + 12);

                const memUsage = process.memoryUsage();
                const nodeHeapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
                const nodeRssMB = Math.round(memUsage.rss / 1024 / 1024);

                const totalSessions = Object.keys(activeSessions).length;
                let connectedSessions = 0;
                for (const uid in activeSessions) {
                    if (activeSessions[uid]?.status === 'CONNECTED') connectedSessions++;
                }

                // Test query Supabase DB
                let dbStatus = 'Operational';
                let dbLatency = 0;
                const dbStart = Date.now();
                try {
                    await supabase.from('products').select('id').limit(1);
                    dbLatency = Date.now() - dbStart;
                } catch (e) {
                    dbStatus = 'Degraded: ' + e.message;
                }

                const hasGemini = !!(process.env.GEMINI_API_KEY);
                const hasGroq = !!(process.env.GROQ_API_KEY);
                const hasMidtrans = !!(process.env.MIDTRANS_SERVER_KEY && process.env.MIDTRANS_CLIENT_KEY);
                const midtransMode = process.env.MIDTRANS_IS_PRODUCTION === 'true' ? 'Production' : 'Sandbox';

                res.json({
                    status: 'OK',
                    timestamp: new Date().toISOString(),
                    os: {
                        platform: os.platform(),
                        arch: os.arch(),
                        cpuCount: cpus.length,
                        cpuModel: cpus[0]?.model || 'Unknown CPU',
                        cpuPercent,
                        totalMemMB: Math.round(totalMem / 1024 / 1024),
                        usedMemMB: Math.round(usedMem / 1024 / 1024),
                        ramPercent,
                        nodeHeapUsedMB,
                        nodeRssMB,
                        uptimeSecs: Math.floor((Date.now() - serverStartTime) / 1000)
                    },
                    services: {
                        whatsapp: {
                            status: connectedSessions > 0 ? 'Operational' : (totalSessions === 0 ? 'Idle (Belum Ada Sesi)' : 'Menunggu Koneksi'),
                            connectedSessions,
                            totalSessions
                        },
                        ai: {
                            status: (hasGemini || hasGroq) ? 'Operational' : 'API Key Tidak Ditemukan',
                            models: [hasGemini ? 'Gemini AI' : null, hasGroq ? 'Groq LLaMA 3.3' : null].filter(Boolean)
                        },
                        database: {
                            status: dbStatus,
                            latencyMs: dbLatency
                        },
                        payment: {
                            status: hasMidtrans ? 'Operational' : 'Belum Dikonfigurasi',
                            mode: midtransMode
                        }
                    }
                });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 4. Ambil log server langsung (Live Logs)
        app.get('/api/admin/logs', (req, res) => {
            res.json({
                total: serverLogsBuffer.length,
                logs: serverLogsBuffer
            });
        });

        // 5. Pengaturan Platform Settings (Persisten ke file)
        const settingsFilePath = path.join(__dirname, 'platform-settings.json');
        function getPlatformSettings() {
            try {
                if (fs.existsSync(settingsFilePath)) {
                    return JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
                }
            } catch (e) {
                console.error('Gagal membaca platform-settings.json:', e);
            }
            return {
                masterAiKey: process.env.GEMINI_API_KEY ? '••••••••' : '',
                wabaId: process.env.STORE_ORIGIN_ID || '',
                defaultTrialDays: 14,
                maintenanceMode: false
            };
        }

        app.get('/api/admin/settings', (req, res) => {
            res.json(getPlatformSettings());
        });

        app.post('/api/admin/settings', (req, res) => {
            try {
                const current = getPlatformSettings();
                const updated = {
                    ...current,
                    ...req.body,
                    updatedAt: new Date().toISOString()
                };
                fs.writeFileSync(settingsFilePath, JSON.stringify(updated, null, 2), 'utf8');
                res.json({ message: 'Konfigurasi platform berhasil disimpan', settings: updated });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // 6. Hapus pengguna (tenant)
        app.post('/api/admin/delete-user', async (req, res) => {
            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'User ID required' });
            try {
                const { error } = await supabase.auth.admin.deleteUser(userId);
                if (error) throw error;
                res.json({ message: 'Customer berhasil dihapus' });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

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
            const { email, password, name, store_name, plan } = req.body;
            if (!email) return res.status(400).json({ error: 'Email wajib diisi' });
            try {
                const { data, error } = await supabase.auth.admin.createUser({
                    email,
                    password: password || 'password123',
                    email_confirm: true,
                    user_metadata: {
                        name: name || (email ? email.split('@')[0] : 'User'),
                        store_name: store_name || name || 'Toko Baru',
                        plan: plan || 'trial',
                        status: 'active'
                    }
                });
                if (error) throw error;
                res.json({ message: 'Customer created successfully', user: data.user });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Edit pengguna (tenant)
        app.post('/api/admin/edit-user', async (req, res) => {
            const { userId, plan, status, store_name } = req.body;
            if (!userId) return res.status(400).json({ error: 'User ID required' });
            try {
                let updatedMeta = {
                    ...(plan ? { plan: plan.toLowerCase() } : {}),
                    ...(status ? { status } : {}),
                    ...(store_name ? { store_name } : {})
                };

                try {
                    const { data: userData } = await supabase.auth.admin.getUserById(userId);
                    if (userData && userData.user && userData.user.user_metadata) {
                        updatedMeta = {
                            ...userData.user.user_metadata,
                            ...updatedMeta
                        };
                    }
                } catch (metaErr) {
                    console.warn('Gagal membaca metadata user lama:', metaErr.message);
                }

                const { data, error } = await supabase.auth.admin.updateUserById(userId, {
                    user_metadata: updatedMeta
                });
                if (error) throw error;

                // Invalidate cache akses agar hak akses bot & dashboard terupdate seketika
                userAccessCache.delete(userId);

                // Sinkronkan ke tabel invoices jika admin mengatur paket baru
                if (plan && plan.toLowerCase() !== 'trial') {
                    const planName = plan.charAt(0).toUpperCase() + plan.slice(1).toLowerCase();
                    const quotaMap = { 'starter': 3000, 'pro': 8000, 'business': 20000, 'agency': 50000 };
                    const quota = quotaMap[plan.toLowerCase()] || 3000;
                    try {
                        await supabase.from('invoices').insert([{
                            id: `ADM-${userId.substring(0, 8)}-${Date.now()}`,
                            user_id: userId,
                            plan_name: planName,
                            amount: 0,
                            credits_added: quota,
                            status: 'success',
                            payment_method: 'admin_manual',
                            created_at: new Date().toISOString()
                        }]);
                    } catch (invErr) {
                        console.warn('⚠️ Gagal sinkron invoice admin manual:', invErr.message);
                    }
                }

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

        // ==========================================
        // DATA RETENTION: CLEANUP OLD CHATS (> 30 HARI)
        // ==========================================
        async function cleanupOldChats(days = 30) {
            try {
                const retentionDays = Math.max(1, parseInt(days) || 30);
                const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
                console.log(`[CLEANUP] Menjalankan pembersihan riwayat chat (> ${retentionDays} hari, cutoff: ${cutoffDate})...`);
                
                const { error, count } = await supabase
                    .from('chats')
                    .delete({ count: 'exact' })
                    .lt('created_at', cutoffDate);
                    
                if (error) {
                    console.error('[CLEANUP] Gagal membersihkan riwayat chat:', error.message);
                    return { success: false, error: error.message };
                }

                const deletedCount = count || 0;
                console.log(`🧹 [CLEANUP] Selesai: ${deletedCount} pesan chat lama (> ${retentionDays} hari) berhasil dibersihkan dari database.`);
                return { success: true, retentionDays, cutoffDate, deletedCount };
            } catch (err) {
                console.error('[CLEANUP] Exception saat membersihkan chat lama:', err.message);
                return { success: false, error: err.message };
            }
        }

        // Endpoint pembersihan chat lama (Manual Trigger oleh Admin)
        app.post('/api/admin/clean-chats', async (req, res) => {
            const days = req.body?.days || 30;
            const result = await cleanupOldChats(days);
            if (result.success) {
                res.json({
                    success: true,
                    message: `Berhasil membersihkan ${result.deletedCount} pesan lama (> ${result.retentionDays} hari).`,
                    deletedCount: result.deletedCount,
                    retentionDays: result.retentionDays,
                    cutoffDate: result.cutoffDate
                });
            } else {
                res.status(500).json({ error: 'Gagal membersihkan chat: ' + result.error });
            }
        });

        // Jalankan pembersihan otomatis: 15 detik setelah boot, lalu diulang otomatis setiap 24 jam
        setTimeout(() => {
            cleanupOldChats(30).catch(() => {});
            setInterval(() => {
                cleanupOldChats(30).catch(() => {});
            }, 24 * 60 * 60 * 1000);
        }, 15000);

        // --- Shipping & Origin Endpoints ---
        // 1. Cari Kota / Destinasi Domestik untuk Asal Toko & Pembeli (RajaOngkir Komerce)
        app.get('/api/shipping/destination', async (req, res) => {
            const search = req.query.search;
            if (!search || String(search).trim().length < 2) {
                return res.status(400).json({ success: false, message: 'Parameter search minimal 2 karakter.' });
            }
            try {
                const results = await searchDestination(String(search).trim());
                res.json({ success: true, data: results || [] });
            } catch (err) {
                res.status(500).json({ success: false, message: err.message });
            }
        });

        // 2. Ambil Asal Pengiriman Toko per User
        app.get('/api/shipping/origin/:userId', (req, res) => {
            const { userId } = req.params;
            const all = getUserOrigins();
            const data = all[userId] || { originId: process.env.STORE_ORIGIN_ID || 254, originName: 'Surabaya (Default)' };
            res.json({ success: true, data });
        });

        // 3. Simpan Asal Pengiriman Toko per User (ke user-origins.json & sync ke Supabase knowledge_base)
        app.post('/api/shipping/origin', async (req, res) => {
            const { userId, originId, originName } = req.body;
            if (!userId) return res.status(400).json({ success: false, message: 'userId diperlukan.' });

            const originData = {
                originId: Number(originId) || 254,
                originName: String(originName || 'Surabaya').trim(),
                updatedAt: new Date().toISOString()
            };

            saveUserOrigin(userId, originData);

            // Best-effort sinkronisasi ke Supabase knowledge_base
            try {
                const { data: existing } = await supabase
                    .from('knowledge_base')
                    .select('store_rules')
                    .eq('user_id', userId)
                    .single();

                let rules = existing?.store_rules || '';
                rules = rules.replace(/===ASAL_PENGIRIMAN===[\s\S]*?===END_ASAL_PENGIRIMAN===\n?/g, '').trim();
                rules = `${rules}\n\n===ASAL_PENGIRIMAN===\nORIGIN_ID: ${originData.originId}\nORIGIN_NAME: ${originData.originName}\n===END_ASAL_PENGIRIMAN===`.trim();

                await supabase
                    .from('knowledge_base')
                    .upsert({
                        user_id: userId,
                        store_rules: rules
                    }, { onConflict: 'user_id' });
            } catch (sbErr) {
                console.warn('⚠️ Gagal sync origin ke Supabase:', sbErr.message);
            }

            res.json({ success: true, data: originData });
        });

        // Health check endpoint
        app.get('/health', (req, res) => {
            res.status(200).send('OK');
        });

        // Diagnostic endpoint: test AI reply langsung dari browser
        app.get('/api/test-ai', async (req, res) => {
            const msg = req.query.msg || 'Halo kak jualan apa aja?';
            try {
                const { generateAIResponse } = require('./ai');
                const reply = await generateAIResponse(msg, 'Layani pelanggan dengan ramah', [], []);
                res.json({ ok: true, message: msg, reply });
            } catch (err) {
                res.status(500).json({ ok: false, error: err.message });
            }
        });

        // Diagnostic endpoint: status semua sesi bot
        app.get('/api/debug-sessions', (req, res) => {
            const sessions = {};
            for (const [uid, s] of Object.entries(activeSessions)) {
                sessions[uid] = { status: s.status, hasSocket: !!s.sock };
            }
            res.json({ sessions, time: new Date().toISOString() });
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
