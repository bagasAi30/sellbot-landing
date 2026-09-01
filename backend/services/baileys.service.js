const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const aiService = require('./ai.service');

let sock = null;
let qrCodeDataURL = null;
let connectionStatus = 'DISCONNECTED'; // 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTED' | 'CONNECTING'
let isBotActive = true;
let isStopping = false;

async function connectToWhatsApp() {
    isStopping = false;
    connectionStatus = 'CONNECTING';

    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['SellBot AI', 'Chrome', '1.0.0']
        });

        // Handle update koneksi (QR Code & Status Koneksi)
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                connectionStatus = 'SCAN_QR';
                try {
                    qrCodeDataURL = await QRCode.toDataURL(qr);
                } catch (err) {
                    console.error('Gagal generate QR image:', err);
                }
                console.log('\n==================================================');
                console.log('📌 SCAN QR CODE INI MENGGUNAKAN WHATSAPP DI HP ANDA:');
                console.log('   (Buka WA > Titik Tiga / Pengaturan > Perangkat Tertaut > Tautkan Perangkat)');
                console.log('==================================================\n');
                qrcodeTerminal.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error)?.output?.statusCode;
                
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('Koneksi terputus (Logged Out/401). Mereset sesi untuk generate QR baru...');
                    resetWhatsApp();
                } else {
                    const shouldReconnect = !isStopping;
                    connectionStatus = 'DISCONNECTED';
                    qrCodeDataURL = null;
                    console.log('Koneksi terputus. Status code:', statusCode, ', Mencoba ulang:', shouldReconnect);
                    
                    if (shouldReconnect) {
                        setTimeout(() => {
                            connectToWhatsApp();
                        }, 3000);
                    }
                }
            } else if (connection === 'open') {
                connectionStatus = 'CONNECTED';
                qrCodeDataURL = null;
                console.log('\n✅ BERHASIL TERHUBUNG KE WHATSAPP!');
                console.log('Bot AI siap merespons chat masuk secara otomatis.\n');
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Handle Pesan Masuk
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify' || !isBotActive) return;

            // Ambil aturan nomor (Blocked & Special)
            const Knowledge = require('../models/Knowledge');
            let blockedNumbersStr = '';
            let specialNumbersStr = '';
            try {
                const blockedObj = await Knowledge.findOne({ where: { type: 'BLOCKED_NUMBERS' } });
                const specialObj = await Knowledge.findOne({ where: { type: 'SPECIAL_NUMBERS' } });
                if (blockedObj) blockedNumbersStr = blockedObj.content || '';
                if (specialObj) specialNumbersStr = specialObj.content || '';
            } catch (err) {
                console.error('[WA] Gagal fetch aturan nomor:', err);
            }

            const blockedArray = blockedNumbersStr.split(',').map(n => n.trim()).filter(Boolean);
            const specialArray = specialNumbersStr.split(',').map(n => n.trim()).filter(Boolean);

            for (const msg of messages) {
                if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@broadcast') || msg.key.remoteJid.includes('@g.us')) {
                    continue;
                }

                const sender = msg.key.remoteJid;
                const senderNumber = sender.split('@')[0];

                // Abaikan jika masuk daftar blokir atau daftar khusus
                if (blockedArray.includes(senderNumber) || specialArray.includes(senderNumber)) {
                    console.log(`[WA] Mengabaikan pesan dari ${senderNumber} (Masuk aturan nomor)`);
                    continue;
                }

                const messageContent = msg.message.conversation || 
                                       msg.message.extendedTextMessage?.text || 
                                       msg.message.imageMessage?.caption || '';

                if (!messageContent) continue;

                console.log(`[WA] Pesan masuk dari ${sender}: "${messageContent}"`);

                try {
                    const reply = await aiService.generateReply(messageContent, sender);
                    if (sock && connectionStatus === 'CONNECTED') {
                        await sock.sendMessage(sender, { text: reply });
                        console.log(`[WA] Balasan terkirim ke ${sender}`);
                    }
                } catch (err) {
                    console.error('[WA] Gagal membalas pesan:', err.message);
                }
            }
        });
    } catch (error) {
        console.error('Error saat inisialisasi Baileys:', error);
        connectionStatus = 'DISCONNECTED';
    }
}

const fs = require('fs');
const path = require('path');

async function stopWhatsApp() {
    isStopping = true;
    isBotActive = false;
    connectionStatus = 'DISCONNECTED';
    qrCodeDataURL = null;
    if (sock) {
        try {
            sock.end(undefined);
        } catch (e) {
            console.error('Error stopping socket:', e);
        }
    }
}

async function resetWhatsApp() {
    console.log('\n🔄 Mereset sesi WhatsApp...');
    await stopWhatsApp();
    
    // Hapus folder session auth_info_baileys
    const authPath = path.join(__dirname, '..', 'auth_info_baileys');
    if (fs.existsSync(authPath)) {
        try {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log('🗑️ Sesi lama berhasil dihapus.');
        } catch (err) {
            console.error('Gagal menghapus folder session:', err.message);
        }
    }

    // Hubungkan kembali untuk memunculkan QR Code baru
    setTimeout(() => {
        connectToWhatsApp();
    }, 1500);
}

function setBotActive(status) {
    isBotActive = status;
}

function getStatus() {
    return {
        status: connectionStatus,
        qr: qrCodeDataURL,
        isBotActive: isBotActive
    };
}

module.exports = {
    connectToWhatsApp,
    stopWhatsApp,
    resetWhatsApp,
    setBotActive,
    getStatus
};
