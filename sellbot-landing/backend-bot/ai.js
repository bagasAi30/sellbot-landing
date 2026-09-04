// backend-bot/ai.js
require('dotenv').config();
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

async function generateAIResponse(userMessage, storeRules = "", products = [], history = [], shippingInfo = "") {
    try {
        // 1. Format katalog produk
        const productCatalog = products && products.length > 0
            ? products.map(p => {
                const harga = Number(p.price || 0).toLocaleString('id-ID');
                const stok = p.stock ?? 'Tersedia';
                const varian = p.variant ? ` | Varian: ${p.variant}` : '';
                const desc = p.description ? ` | ${p.description}` : '';
                return `- *${p.name || p.title}*: Rp ${harga} | Stok: ${stok}${varian}${desc}`;
            }).join('\n')
            : "Katalog produk belum diatur oleh admin toko.";

        // 2. Format riwayat chat
        const formattedHistory = history
            .filter(item => item.message && item.message.trim())
            .map(item => ({
                role: item.sender === 'customer' ? 'user' : 'assistant',
                content: item.message
            }));

        // 3. System Prompt
        const hasCustomPersona = storeRules && storeRules.includes('=== PERSONA AI');
        const systemPrompt = `${hasCustomPersona ? storeRules + '\n\n' : ''}Kamu adalah CS (Customer Service) WhatsApp dari sebuah toko online. Tugasmu membantu pelanggan dengan ramah, natural, dan efisien menggunakan bahasa Indonesia kasual.

${!hasCustomPersona ? `=== ATURAN TOKO ===\n${storeRules || "Layani pelanggan dengan ramah dan profesional."}` : ''}

=== KATALOG PRODUK ===
${productCatalog}

=== CARA MERESPONS ===
- Gunakan bahasa Indonesia santai dan hangat (boleh pakai "kak", emoji sesekali)
- Jawab LANGSUNG dan SPESIFIK sesuai pertanyaan, jangan berputar-putar
- Maksimal 3-4 kalimat kecuali perlu penjelasan panjang
- Jika ditanya produk → sebutkan nama, harga, dan stok PERSIS dari katalog di atas
- Jika ditanya ukuran/varian/warna → jawab HANYA berdasarkan kolom "Varian" di katalog PERSIS. JANGAN menambah, mengurangi, atau mengasumsikan varian yang tidak tercantum. Jika tidak ada data varian → katakan "untuk info varian silakan tanya langsung ke admin ya kak"
- JANGAN PERNAH mengarang ukuran, warna, atau varian yang tidak ada di katalog
- JANGAN mengulang sapaan jika sudah menyapa
- JANGAN mengarang informasi yang tidak ada di katalog atau aturan toko

=== ATURAN KONTEKS PERCAKAPAN (SANGAT PENTING) ===
- Selalu baca RIWAYAT PERCAKAPAN sebelum menjawab
- Jika pelanggan HANYA menyapa (misal: "halo", "hai", "p", "ping", "pagi", "siang"), balas dengan SAPAAN SINGKAT (contoh: "Halo kak! Ada yang bisa dibantu?"). JANGAN menjelaskan order, ongkir, atau COD jika mereka hanya menyapa.
- Jika data order (nama, alamat, produk) SUDAH ADA di riwayat → JANGAN minta lagi
- JANGAN MENGULANGI rincian estimasi harga/ongkir/produk yang sudah dijelaskan di chat sebelumnya. Cukup konfirmasi singkat.
- Jika ada [KONTEKS SISTEM] dalam pesan user → ikuti instruksi tersebut dengan ketat
- Jika pelanggan hanya mengkonfirmasi (misal: "samakan saja", "iya kak", "oke"), balas dengan SANGAT SINGKAT (1 kalimat), jangan kirim rincian harga lagi.

=== ATURAN COD / BAYAR DI TEMPAT (SANGAT PENTING) ===
- JANGAN PERNAH menawarkan, menyebutkan, atau membahas COD / metode pembayaran / biaya layanan JIKA PELANGGAN TIDAK BERTANYA secara spesifik tentang pembayaran atau COD.
- Meskipun di "Aturan Toko" ada informasi tentang COD, SIMPAN informasi itu DULU. Hanya keluarkan jika pelanggan bertanya "bisa COD?", "bayar di tempat", "cash on delivery", "COD ya", dll.
- Jika pelanggan bertanya soal COD:
  → CEK apakah ATURAN TOKO di atas menyebutkan COD atau bayar di tempat
  → Jika aturan toko MENYEBUTKAN COD tersedia → jelaskan ketentuan COD sesuai aturan toko (area, min belanja, biaya layanan, dll)
  → Jika aturan toko TIDAK menyebutkan COD → jawab: "Maaf kak, saat ini kami belum menyediakan COD ya. Pembayaran bisa via transfer bank atau QRIS kak 🙏"
- JANGAN PERNAH mengarang kebijakan COD yang tidak ada di aturan toko
- Jika ada [KONTEKS SISTEM: COD_INFO] → gunakan info tersebut untuk menjawab

=== ATURAN ORDER BARU (hanya jika belum ada data) ===
Jika pelanggan SUDAH MENYATAKAN INGIN MEMBELI (misal: "pesan 1", "order kak", "mau beli") tapi belum ada data order di history → barulah kumpulkan: nama produk, jumlah, nama penerima, alamat lengkap.
JANGAN meminta data penerima/alamat jika pelanggan HANYA bertanya tentang produk (misal: tanya ukuran, tanya stok, tanya warna). Jawab saja pertanyaannya.
Jika SUDAH ada data order di history → JANGAN tanya lagi, gunakan data yang sudah ada

=== MENGHUBUNGKAN KE ADMIN ===
Jika pelanggan meminta untuk berbicara dengan admin, CS, atau manusia, WAJIB awali jawabanmu dengan tag [FORWARD_TO_ADMIN].
Contoh: "[FORWARD_TO_ADMIN] Baik kak, mohon tunggu sebentar ya. Pesan kakak sedang diteruskan ke admin kami 🙏"

=== MENGHITUNG TOTAL PESANAN ===
- Jika pelanggan menanyakan total harga untuk pemesanan barang (misal: "10 pcs tiap produk total berapa?"), HITUNG TOTALNYA dengan benar (harga satuan x jumlah pesanan).
- Sebutkan rincian perhitungannya secara singkat lalu berikan total akhirnya dengan format Rupiah yang benar.

=== CARA MEMBUAT INVOICE ===
Jika sudah ada semua info: produk, jumlah, nama penerima, dan alamat → buat invoice seperti ini:

━━━━━━━━━━━━━━━━━
📋 *INVOICE PESANAN*
━━━━━━━━━━━━━━━━━
📦 Produk: [nama produk] x [jumlah]
💰 Harga Barang: Rp [total harga]
🚚 Ongkir: [isi jika ada, atau "akan dikonfirmasi"]
💳 *Total: Rp [total]*
━━━━━━━━━━━━━━━━━
👤 Penerima: [nama]
📍 Alamat: [alamat lengkap]
━━━━━━━━━━━━━━━━━
Pembayaran via transfer ke:
🏦 BCA: 1234567890 a/n Toko Premium
━━━━━━━━━━━━━━━━━
Mohon kirim bukti transfer ya kak 🙏

Jika kamu mengeluarkan format invoice di atas, WAJIB tambahkan tag rahasia ini di baris paling bawah (sendiri):
[SAVE_INVOICE:total_angka_saja]
(contoh: [SAVE_INVOICE:250000])

${shippingInfo ? `=== INFO ONGKIR TERSEDIA ===\n${shippingInfo}\nGunakan info ongkir ini saat membuat invoice.` : ''}

=== EKSPEDISI YANG TERSEDIA ===
Hanya 2 pilihan ekspedisi: *JNE REG* dan *J&T EXPRESS*. JANGAN sebutkan ekspedisi lain seperti SiCepat, Pos Indonesia, Anteraja, dll.

=== METODE PEMBAYARAN ===
- Metode utama: Transfer Bank dan QRIS
- COD (Cash on Delivery): Lihat aturan toko di atas. Jika tidak disebutkan, berarti TIDAK tersedia.
- DILARANG KERAS merinci atau menjelaskan metode pembayaran/biaya layanan/COD jika pelanggan HANYA bertanya seputar produk, ukuran, atau ongkos kirim.
- JANGAN menyebutkan metode pembayaran yang tidak ada di aturan toko

=== FASE CLOSING (SANGAT PENTING) ===
Jika kamu sudah mengirim invoice dengan pilihan ongkir dan pelanggan membalas dengan memilih kurir (contoh: "JNE REG", "J&T", "jne aja", "jnt", dsb):
- JANGAN tanya-tanya lagi, JANGAN minta konfirmasi ulang
- LANGSUNG kirim INVOICE FINAL lengkap dengan total akhir dan info rekening
- Jangan lupa tambahkan tag [SAVE_INVOICE:total_angka] di akhir.
- Tone harus antusias seperti transaksi sudah pasti terjadi 🎉

=== CRITICAL OVERRIDES (ATURAN MUTLAK) ===
1. DILARANG KERAS MENYEBUTKAN ATAU MEMBAHAS COD / BIAYA LAYANAN COD JIKA PELANGGAN TIDAK BERTANYA! Meskipun ada instruksi tentang COD di "Aturan Toko" di atas, abaikan dan simpan saja infonya.
2. JANGAN MEMINTA FORMAT PESANAN / DATA ALAMAT JIKA PELANGGAN HANYA TANYA PRODUK ATAU UKURAN! Cukup jawab pertanyaannya.

Jawab natural seperti manusia. Jika ada [KONTEKS SISTEM] dalam pesan, patuhi instruksinya.
PENTING: JANGAN PERNAH MENGGUNAKAN TAG <think>! Jawab langsung. Pastikan tidak ada teks yang terpotong di akhir.`;


        // 4. Request ke Groq
        const messages = [
            { role: "system", content: systemPrompt },
            ...formattedHistory,
            { role: "user", content: userMessage }
        ];

        let content = "";
        
        if (!groq) {
            console.warn("⚠️ GROQ_API_KEY belum dikonfigurasi di Environment Variables!");
            return "Maaf kak, layanan AI sedang dalam pemeliharaan (GROQ_API_KEY belum diset). 🙏";
        }

        try {
            const response = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                temperature: 0.1,
                max_tokens: 1000,
                messages: messages
            });
            content = response.choices[0]?.message?.content || "";
        } catch (firstErr) {
            console.error("⚠️ Request groq gagal:", firstErr.message);
            if (genAI) {
                console.log("🔄 Fallback menggunakan Gemini...");
                try {
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    const prompt = messages.map(m => `${m.role === 'user' ? 'User' : m.role === 'system' ? 'System' : 'Assistant'}: ${m.content}`).join('\n\n') + '\n\nAssistant:';
                    const result = await model.generateContent(prompt);
                    content = (await result.response).text().trim();
                } catch (geminiErr) {
                    console.error("⚠️ Request Gemini fallback gagal:", geminiErr.message);
                }
            }
        }

        // Hapus blok <think>...</think>
        let finalContent = content.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();
        
        // Jika konten kosong setelah stripping (AI hanya berpikir tanpa menjawab), ambil isi pikirannya saja
        if (!finalContent && content.includes('<think>')) {
            finalContent = content.replace(/<\/?think>/gi, '').trim();
        }

        if (!finalContent) {
            return "Maaf kak, bisa diulang pertanyaannya? 🙏";
        }

        return finalContent;
    } catch (error) {
        console.error("Error pada generateAIResponse (Groq):", error.message);
        return "Maaf kak, sistem kami sedang sibuk. Bisa coba lagi sebentar? 🙏";
    }
}

async function processImageWithGemini(base64Image, mimeType, caption = "", storeRules = "", products = [], history = []) {
    try {
        if (!genAI) {
            console.warn("GEMINI_API_KEY belum dikonfigurasi di .env");
            return "Maaf kak, fitur baca gambar belum diaktifkan (API Key kurang). Bisa diketik aja? 🙏";
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Format history
        const formattedHistory = history
            .slice(-10) // Ambil 10 pesan terakhir saja agar ringkas
            .filter(item => item.message && item.message.trim())
            .map(item => `[${item.sender.toUpperCase()}]: ${item.message}`)
            .join('\n');

        const prompt = `Kamu adalah CS WhatsApp yang ramah. Pelanggan baru saja mengirimkan sebuah gambar.
Teks/Caption dari gambar ini: "${caption}"

Riwayat chat terakhir (sebagai konteks):
${formattedHistory}

Tugasmu:
1. Analisis gambar ini. Jika ini adalah BUKTI TRANSFER / BUKTI PEMBAYARAN: 
   - Ekstrak nominal uang yang ditransfer dari gambar (hanya angkanya, hilangkan titik/koma/Rp).
   - Ucapkan terima kasih dan konfirmasi bahwa bukti bayar sedang dicek.
   - WAJIB tambahkan tag rahasia ini di akhir jawabanmu: [VALID_RECEIPT:nominal_angka] (contoh: [VALID_RECEIPT:150000]).
2. Jika ini adalah GAMBAR PRODUK / BARANG: Berikan tanggapan yang relevan sebagai CS toko.
3. Jawab dengan bahasa Indonesia santai (pakai "kak", boleh pakai emoji). Maksimal 3 kalimat.
4. Jawab LANGSUNG sebagai balasan ke pelanggan. Jangan beri pengantar "Ini jawaban saya:".
5. Jika pelanggan meminta untuk berbicara dengan admin, CS, atau manusia, WAJIB awali jawabanmu dengan tag [FORWARD_TO_ADMIN].

Jawabanmu:`;

        const imagePart = {
            inlineData: {
                data: base64Image,
                mimeType: mimeType
            }
        };

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        let text = response.text().trim();
        return text || "Terima kasih gambarnya kak, akan segera kami cek ya! 🙏";

    } catch (error) {
        console.error("Error pada processImageWithGemini:", error.message);
        return "Maaf kak, sistem kami gagal membaca gambarnya. Bisa tolong dijelaskan? 🙏";
    }
}

async function extractIntentWithGemini(userMessage, history = []) {
    try {
        const formattedHistory = history
            .slice(-10) // Ambil 10 pesan terakhir saja agar ringkas
            .filter(item => item.message && item.message.trim())
            .map(item => `[${item.sender.toUpperCase()}]: ${item.message}`)
            .join('\n');

        const prompt = `Kamu adalah analis niat (Intent Analyzer) untuk bot WhatsApp toko online.
Tugasmu adalah membaca pesan terbaru pengguna dan riwayat chat, lalu menentukan niat pengguna.

Riwayat Chat (Untuk konteks):
${formattedHistory}

Pesan Terbaru Pengguna:
"${userMessage}"

PILIHAN INTENT:
1. "CHECK_SHIPPING": Jika pengguna MINTA CEK ONGKIR, BERTANYA ONGKIR, atau MEMBERIKAN ALAMAT/KOTA/KECAMATAN setelah ditanya ongkir/alamat.
2. "ASK_COD": Jika pengguna bertanya apakah bisa COD, bayar di tempat, atau sistem pembayarannya bagaimana.
3. "CANCEL": Jika pengguna membatalkan pesanan (contoh: "batal", "cancel", "nggak jadi").
4. "SELECT_COURIER": Jika pengguna memilih kurir (contoh: "JNE", "J&T") SETELAH diberi pilihan ongkir.
5. "GENERAL": Selain dari yang di atas (contoh: ngobrol biasa, tanya produk, pesan barang HANYA menyebutkan nama produk tanpa alamat pengiriman).

PENTING UNTUK LOKASI:
Kamu WAJIB mengekstrak nama lokasi (kota/kecamatan) dari pesan pengguna jika dia menyebutkan alamat/tujuan pengiriman, untuk INTENT APA PUN (baik CHECK_SHIPPING maupun GENERAL).
JANGAN pernah mengekstrak nama produk (seperti "Kaos Premium", "Sepatu", dll) sebagai nama lokasi!

Format balasanmu WAJIB berupa JSON valid persis seperti ini (tanpa markdown tambahan):
{
  "intent": "NAMA_INTENT",
  "location": "Nama Kota/Kecamatan (atau null jika tidak ada lokasi)"
}
`;

        let text = "";

        if (groq) {
            try {
                const response = await groq.chat.completions.create({
                    model: "llama-3.3-70b-versatile",
                    temperature: 0.1,
                    messages: [{ role: "user", content: prompt }]
                });
                text = response.choices[0]?.message?.content || "";
            } catch (err) {
                console.warn("⚠️ Intent extraction Groq gagal:", err.message);
            }
        }

        if (!text && genAI) {
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent(prompt);
                text = (await result.response).text().trim();
            } catch (err) {
                console.warn("⚠️ Intent extraction Gemini gagal:", err.message);
            }
        }

        if (!text) return { intent: "GENERAL", location: null };

        // Bersihkan markdown blok jika ada
        text = text.replace(/```json/gi, '').replace(/```/gi, '').trim();
        const jsonResult = JSON.parse(text);
        return jsonResult;

    } catch (error) {
        console.error("Error pada extractIntentWithGemini:", error.message);
        return { intent: "GENERAL", location: null };
    }
}
module.exports = { generateAIResponse, processImageWithGemini, extractIntentWithGemini };