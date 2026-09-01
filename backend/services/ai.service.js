const { OpenAI } = require('openai');
const Product = require('../models/Product');
const Knowledge = require('../models/Knowledge');
const shippingService = require('./shipping.service');

// Inisialisasi OpenAI Client (Menggunakan Groq)
// Pastikan GROQ_API_KEY sudah ada di .env
const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1"
});

// Definisi Tool untuk Cek Ongkir Real-time
const tools = [
    {
        type: 'function',
        function: {
            name: 'cek_ongkir',
            description: 'Mengecek tarif ongkos kirim real-time ekspedisi (JNE, J&T, SiCepat) ke kota atau kecamatan tujuan di Indonesia via RajaOngkir',
            parameters: {
                type: 'object',
                properties: {
                    tujuan: {
                        type: 'string',
                        description: 'Nama kota atau kecamatan tujuan pengiriman (contoh: "Bandung", "Surabaya", "Medan", "Jakarta Selatan")'
                    },
                    berat_gram: {
                        type: 'number',
                        description: 'Perkiraan berat total paket dalam gram (default 1000 untuk 1 kg)'
                    }
                },
                required: ['tujuan']
            }
        }
    }
];

/**
 * AI Service using Groq with Smart Shipping Integration
 */
async function generateReply(userMessage, userId) {
    console.log(`[AI] Processing message: "${userMessage}" for user ${userId}`);

    let preFetchedShippingText = '';

    // Deteksi jika pengguna menanyakan ongkir / menyebutkan tujuan pengiriman
    const isOngkirQuery = /ongkir|ongkos|kirim|biaya|tujuan|surabaya|bandung|semarang|medan|jakarta|jogja|yogyakarta|bali|makassar|palembang|malang|solo/i.test(userMessage);
    
    if (isOngkirQuery) {
        let targetLocation = '';
        
        // 1. Coba deteksi spesifik Kecamatan / Kota jika formatnya alamat lengkap
        const kecMatch = userMessage.match(/(?:kec\.|kecamatan)\s+([a-zA-Z0-9\s]+?)(?:,|\n|-|$)/i);
        const kotaMatch = userMessage.match(/(?:kota|kab\.|kabupaten)\s+([a-zA-Z0-9\s]+?)(?:,|\n|-|$)/i);
        
        if (kecMatch && kecMatch[1]) {
            targetLocation = kecMatch[1].trim();
        } else if (kotaMatch && kotaMatch[1]) {
            targetLocation = kotaMatch[1].trim();
        } else {
            // 2. Fallback ke deteksi "ke/tujuan"
            const matchKe = userMessage.match(/(?:ke|tujuan|di)\s+([a-zA-Z\s]{3,30})(?:,|\n|$)/i);
            if (matchKe && matchKe[1]) {
                targetLocation = matchKe[1].replace(/\b(?:berapa|kak|min|tolong|ya|mas)\b/gi, '').trim();
            } else if (!/nama lengkap|alamat lengkap/i.test(userMessage)) {
                // Jika bukan form order, asumsi seluruh pesan adalah kota tujuan (maks 30 karakter)
                targetLocation = userMessage.replace(/\b(?:cek|ongkir|berapa|ongkos|kirim|biaya|kak|min|tolong|ya|mas)\b/gi, '').trim().substring(0, 30);
            }
        }

        if (targetLocation && targetLocation.length >= 3) {
            console.log(`[AI] Auto pre-fetching shipping for location: "${targetLocation}"`);
            const shippingRes = await shippingService.calculateShipping(targetLocation, 1000);
            if (shippingRes.success) {
                preFetchedShippingText = shippingService.formatShippingText(shippingRes);
            }
        }
    }

    // Ambil produk dari Database secara Real-time
    const products = await Product.findAll();
    const productListText = products.map(p => 
        `- ${p.name} (Varian: ${p.variant || 'Tidak ada'}) | Harga: Rp ${p.price.toLocaleString('id-ID')} | Stok: ${p.stock}`
    ).join('\n');

    // Ambil Aturan Toko dari Database secara Real-time
    const storeRulesObj = await Knowledge.findOne({ where: { type: 'STORE_RULES' } });
    const storeRules = storeRulesObj ? storeRulesObj.content : '1. Layani dengan sopan.';

    // Ambil System Prompt kustom dari Database
    const customPromptObj = await Knowledge.findOne({ where: { type: 'SYSTEM_PROMPT' } });
    const customPrompt = customPromptObj ? customPromptObj.content : '';

    let systemPrompt = `
Kamu adalah asisten penjual (SellBot AI) yang melayani toko online dengan ramah, natural, menggunakan bahasa Indonesia kasual yang sopan (menggunakan sapaan 'Kak').
Toko berlokasi di ${process.env.STORE_ORIGIN_NAME || 'Jakarta Barat'}.

PENTING: JANGAN PERNAH menampilkan proses berpikir. Berikan teks jawaban langsung yang ramah untuk pelanggan.
ATURAN INVOICE: Jika pelanggan sudah setuju memesan dan detail lengkap (produk, jumlah, alamat tujuan), buatkan INVOICE TAGIHAN. 
Isi Invoice: Rincian pesanan, Total Harga (Harga Barang + Ongkir), dan instruksi pembayaran transfer manual ke BCA: 1234567890 a/n AsistenLapak. Minta pembeli mengirimkan bukti transfer jika sudah membayar.

[INSTRUKSI KHUSUS / SYSTEM PROMPT DARI ADMIN]
${customPrompt}

[DATA PRODUK TOKO]
${productListText}

[KNOWLEDGE BASE TOKO]
${storeRules}
    `;

    if (preFetchedShippingText) {
        systemPrompt += `\n\n[INFO ONGKIR TERKINI (HASIL CEK OTOMATIS)]\nBerikut adalah ongkir ke tujuan pelanggan. Gunakan info ini saat membuat INVOICE atau saat ditanya ongkir oleh pelanggan. JANGAN mengarang harga ongkir:\n${preFetchedShippingText}`;
    }

    try {
        if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY.includes('...')) {
            return "Maaf Kak, saat ini sistem AI sedang disiapkan (API Key Groq belum diatur).";
        }

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
        ];

        let response = await openai.chat.completions.create({
            model: "qwen/qwen3.6-27b",
            messages: messages,
            temperature: 0.7,
        });

        let choice = response.choices[0];
        let content = choice.message.content || '';
        console.log(`[AI RAW] ${content}`);
        
        // Menghapus blok <think>...</think> (termasuk jika tag penutupnya terpotong/hilang)
        content = content.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();
        console.log(`[AI CLEANED] ${content}`);

        if (!content) {
            return "Maaf Kak, aku kurang paham nih. Ada yang bisa dibantu untuk pemesanan?";
        }

        return content;
    } catch (error) {
        console.error('[AI] OpenAI/Groq Error:', error.message);
        return "Maaf Kak, sistem kami sedang mengalami kendala. Bisa dicoba beberapa saat lagi ya.";
    }
}

module.exports = {
    generateReply
};
