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
                model: "openai/gpt-oss-120b",
                temperature: 0.1,
                max_tokens: 1000,
                messages: messages
            });
            content = response.choices[0]?.message?.content || "";
        } catch (firstErr) {
            console.error("⚠️ Request groq (openai/gpt-oss-120b) gagal:", firstErr.message);
            try {
                console.log("🔄 Mencoba fallback groq (openai/gpt-oss-20b)...");
                const response = await groq.chat.completions.create({
                    model: "openai/gpt-oss-20b",
                    temperature: 0.1,
                    max_tokens: 1000,
                    messages: messages
                });
                content = response.choices[0]?.message?.content || "";
            } catch (secondErr) {
                console.error("⚠️ Request groq fallback gagal:", secondErr.message);
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
        }

        // Hapus blok <think>...</think>
        let finalContent = content.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();
        
        // Jika konten kosong setelah stripping (AI hanya berpikir tanpa menjawab), ambil isi pikirannya saja
        if (!finalContent && content.includes('<think>')) {
            finalContent = content.replace(/<\/?think>/gi, '').trim();
        }

        if (!finalContent) {
            console.warn("⚠️ AI tidak mengembalikan konten (periksa kuota/validitas GROQ_API_KEY atau GEMINI_API_KEY di .env)");
            return "Halo kak! Terima kasih sudah menghubungi kami. Mohon ditunggu sebentar ya kak, tim admin kami akan segera membantu melayani pertanyaan kakak 🙏";
        }

        return finalContent;
    } catch (error) {
        console.error("Error pada generateAIResponse (Groq):", error.message);
        return "Halo kak! Terima kasih sudah menghubungi kami. Mohon ditunggu sebentar ya kak, tim admin kami akan segera membantu melayani pertanyaan kakak 🙏";
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

// Daftar kata-kata umum / stop words yang TIDAK BOLEH dianggap sebagai nama lokasi
const LOCATION_STOP_WORDS = new Set([
    'nya', 'dong', 'sih', 'tuh', 'ya', 'kak', 'kakak', 'mas', 'bang', 'min', 'admin', 'gan', 'bro', 'sis',
    'perkilo', 'per kilo', 'per-kilo', 'kilo', 'kg', 'gram', 'gr', 'ons', 'berapa', 'kah', 'apa', 'apakah',
    'saja', 'aja', 'itu', 'ini', 'situ', 'sini', 'sana', 'kesana', 'kesitu', 'kesini',
    'paket', 'barang', 'kirim', 'ongkir', 'tarif', 'biaya', 'ongkos', 'ekspedisi', 'kurir',
    'jne', 'jnt', 'j&t', 'sicepat', 'anteraja', 'pos', 'tiki', 'wahana', 'lion', 'ninja',
    'ada', 'bisa', 'mau', 'tolong', 'minta', 'cek', 'cekin', 'cekan', 'mohon', 'pilihan',
    'reg', 'oke', 'yes', 'express', 'standard', 'hemat', 'cargo', 'kargo'
]);

function cleanAndValidateLocation(rawLoc) {
    if (!rawLoc || typeof rawLoc !== 'string') return null;
    let loc = rawLoc.trim();
    // Hapus awalan umum
    loc = loc.replace(/^(?:ke|tujuan|daerah|wilayah|di|kota|kecamatan|kabupaten)\s+/i, '').trim();
    // Hapus akhiran partikel & kata tanya (wajib didahului spasi agar tidak memotong nama kota seperti Surabaya)
    while (/\s+(?:berapa|kak|kakak|ya|mas|bang|min|admin|gan|dong|kira-kira|kah|sih|tuh|tahu|tolong|mohon|saja|aja)$/i.test(loc)) {
        loc = loc.replace(/\s+(?:berapa|kak|kakak|ya|mas|bang|min|admin|gan|dong|kira-kira|kah|sih|tuh|tahu|tolong|mohon|saja|aja)$/i, '').trim();
    }
    loc = loc.replace(/[,\.\?!]+$/g, '').trim();

    const lower = loc.toLowerCase().trim();
    if (LOCATION_STOP_WORDS.has(lower)) return null;

    // Pastikan masih tersisa kata bermakna (bukan hanya kumpulan stop words)
    const words = lower.split(/\s+/).filter(w => !LOCATION_STOP_WORDS.has(w) && w.length >= 2);
    if (words.length === 0) return null;

    if (loc.length < 3) return null;
    return loc;
}

function extractIntentRuleBased(userMessage, history = []) {
    const text = (userMessage || '').trim();
    const lower = text.toLowerCase();
    
    // 1. Cek intent CANCEL
    if (/^(batal|cancel|nggak\s+jadi|gak\s+jadi|ga\s+jadi|tidak\s+jadi)\b/i.test(lower)) {
        return { intent: "CANCEL", location: null };
    }

    // 2. Cek intent SELECT_COURIER
    const lastBotMsg = history.filter(h => h.sender === 'ai').slice(-1)[0]?.message || '';
    const botOfferedCourier = /(?:mau\s+)?pilih\s+\*?(?:jne|j&t|jnt)/i.test(lastBotMsg) || /ekspedisi/i.test(lastBotMsg) || /pilihan\s+ongkir/i.test(lastBotMsg) || /kurir/i.test(lastBotMsg);
    if (botOfferedCourier || /(?:pilih|pakai|kirim\s+lewat|lewat|gunakan)?\s*(?:jne|j&t|jnt)/i.test(lower)) {
        if (/\b(?:jne|j&t|jnt)\b/i.test(lower)) {
            // Jika pesan murni pemilihan kurir singkat (contoh: "jne", "pilih jne reg", "jnt aja")
            const isPureCourierChoice = /^(?:pilih\s+|mau\s+|pakai\s+|kirim\s+lewat\s+|lewat\s+|gunakan\s+)?(?:jne(?:\s*reg)?|j&t(?:\s*express)?|jnt)(?:\s*(?:aja|ya|kak|min|gan|dong|saja|deh|oke))?$/i.test(text.trim());
            if (isPureCourierChoice) {
                return { intent: "SELECT_COURIER", location: null };
            }
            // Jika pesan komposit (mengandung nama, alamat, atau lebih dari sekadar pilihan kurir),
            // biarkan extractIntentWithGemini mengekstrak lokasi & intent secara utuh
        }
    }

    // 3. Cek intent ASK_COD
    if (/(?:bisa\s+cod|bayar\s+di\s*tempat|ada\s+cod|bisa\s+bayar\s+di\s*tempat|sistem\s+cod|apakah\s+bisa\s+cod)/i.test(lower)) {
        return { intent: "ASK_COD", location: null };
    }

    // 4. Cek intent CHECK_SHIPPING
    const isShippingQuery = /(?:ongkir|ongkos\s*kirim|tarif|biaya\s*(?:ongkir|kirim)|kirim\s+ke|ongkos\s+ke|per[\s\-]?kilo|per[\s\-]?kg)/i.test(lower);
    if (isShippingQuery) {
        let loc = null;
        const matchKe = lower.match(/(?:ke|tujuan|daerah|wilayah)\s+([a-zA-Z0-9\s]+?)(?:\s+berapa|\s*[\?,\.\!]|$)/i);
        const matchOngkir = lower.match(/(?:ongkir|ongkos\s*kirim|biaya\s*kirim)\s+ke\s+([a-zA-Z0-9\s]+?)(?:\s+berapa|\s*[\?,\.\!]|$)/i);
        
        const rawCandidate = matchKe ? matchKe[1] : (matchOngkir ? matchOngkir[1] : null);
        loc = cleanAndValidateLocation(rawCandidate);

        return { intent: "CHECK_SHIPPING", location: loc };
    }

    // Jika bot sebelumnya bertanya "Mau cek ongkir ke mana kak?" dan user menjawab nama kota/kecamatan
    if (lastBotMsg.includes('Mau cek ongkir ke mana') || lastBotMsg.includes('Sebutkan nama kota')) {
        const cleaned = text.replace(/^[,\.\!\?\s]+|[,\.\!\?\s]+$/g, '').trim();
        const validLoc = cleanAndValidateLocation(cleaned);
        if (validLoc && !/^(halo|hi|p|pagi|siang|sore|malam)$/i.test(validLoc)) {
            return { intent: "CHECK_SHIPPING", location: validLoc };
        }
    }

    return { intent: "GENERAL", location: null };
}

async function extractIntentWithGemini(userMessage, history = []) {
    // Evaluasi awal dengan Rule-based (0ms latency, anti-fail saat API AI offline/limit)
    const ruleBased = extractIntentRuleBased(userMessage, history);
    if (ruleBased && ruleBased.intent !== "GENERAL") {
        console.log(`⚡ Intent terdeteksi via Smart Rule Engine: ${ruleBased.intent}, Location: ${ruleBased.location}`);
        return ruleBased;
    }

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
1. "CHECK_SHIPPING": Jika pengguna MINTA CEK ONGKIR, BERTANYA ONGKIR, BERTANYA ONGKIR PER KILO ("perkilo", "per kg"), atau MEMBERIKAN ALAMAT/KOTA/KECAMATAN setelah ditanya ongkir/alamat.
2. "ASK_COD": Jika pengguna bertanya apakah bisa COD, bayar di tempat, atau sistem pembayarannya bagaimana.
3. "CANCEL": Jika pengguna membatalkan pesanan (contoh: "batal", "cancel", "nggak jadi").
4. "SELECT_COURIER": Jika pengguna memilih kurir (contoh: "JNE", "J&T") baik sendiri maupun bersamaan dengan nama/alamat penerima.
5. "GENERAL": Selain dari yang di atas (contoh: ngobrol biasa, tanya produk, pesan barang HANYA menyebutkan nama produk tanpa alamat pengiriman).

PENTING UNTUK LOKASI:
Kamu WAJIB mengekstrak nama lokasi (kota/kecamatan) dari pesan pengguna jika dia menyebutkan alamat/tujuan pengiriman, untuk INTENT APA PUN (termasuk SELECT_COURIER, CHECK_SHIPPING, maupun GENERAL).
JANGAN PERNAH mengekstrak nama produk (seperti "Kaos Premium", "Sepatu", dll) sebagai nama lokasi!
JANGAN PERNAH mengekstrak kata-kata seperti "nya", "perkilo", "per kilo", "berapa", "kak", "ke", "ke mana", "ongkir" sebagai nama lokasi! Jika pengguna tidak menyebutkan nama daerah/kota/kecamatan yang jelas, kembalikan "location": null.

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
                    model: "openai/gpt-oss-120b",
                    temperature: 0.1,
                    messages: [{ role: "user", content: prompt }]
                });
                text = response.choices[0]?.message?.content || "";
            } catch (err) {
                console.warn("⚠️ Intent extraction Groq (openai/gpt-oss-120b) gagal:", err.message);
                try {
                    const response = await groq.chat.completions.create({
                        model: "openai/gpt-oss-20b",
                        temperature: 0.1,
                        messages: [{ role: "user", content: prompt }]
                    });
                    text = response.choices[0]?.message?.content || "";
                } catch (fallbackErr) {
                    console.warn("⚠️ Intent extraction Groq fallback gagal:", fallbackErr.message);
                }
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

        if (!text) return ruleBased || { intent: "GENERAL", location: null };

        // Bersihkan markdown blok jika ada
        text = text.replace(/```json/gi, '').replace(/```/gi, '').trim();
        const jsonResult = JSON.parse(text);
        jsonResult.location = cleanAndValidateLocation(jsonResult.location);
        return jsonResult;

    } catch (error) {
        console.error("Error pada extractIntentWithGemini:", error.message);
        return ruleBased || { intent: "GENERAL", location: null };
    }
}

async function extractOrderDetails(userMessage, history = [], storeRules = "", products = []) {
    try {
        const recentHistory = history
            .slice(-8)
            .filter(item => item.message && item.message.trim())
            .map(item => `[${item.sender.toUpperCase()}]: ${item.message}`)
            .join('\n');

        const productCatalogSnippet = products && products.length > 0
            ? products.map(p => `- ${p.name || p.title}: Rp ${Number(p.price || 0).toLocaleString('id-ID')}`).join('\n')
            : '';

        const prompt = `Kamu adalah sistem AI Order Extractor untuk toko online WhatsApp.
Tugasmu: Mengekstrak data pesanan yang SEDANG aktif dibahas dari percakapan WhatsApp terkini.
PERATURAN PENTING:
1. Fokus HANYA pada produk yang SEDANG dibicarakan atau dipesan saat ini di chat terkini (misal: "Paket Umbul-Umbul Promo", "Umbul-Umbul", dll).
2. DILARANG KERAS mengambil nama produk lama (seperti kaos, sepatu, dll) yang pernah ada di riwayat lampau jika percakapan terkini membicarakan produk baru!
3. Jika di pesan terakhir AI menyebutkan total harga (contoh: "10 paket Umbul-Umbul = Rp 1.100.000"), maka produk = "Paket Umbul-Umbul Promo", qty = 10, unit = "paket", total_harga_barang = 1100000.
4. Ekstrak nama penerima, alamat lengkap, dan perbaiki typo nama lokasi (kecamatan/kota tujuan pengiriman, misal: "tambakasari surabaya" -> "Tambaksari, Surabaya").
5. Deteksi kurir pilihan pelanggan jika disebutkan di pesan (misal: "JNE REG" atau "J&T EXPRESS").

Riwayat Chat Terkini:
${recentHistory}

Pesan Pengguna:
"${userMessage}"

${productCatalogSnippet ? `Katalog Toko:\n${productCatalogSnippet}\n` : ''}
${storeRules ? `Aturan/Info Toko:\n${storeRules.substring(0, 600)}\n` : ''}

Format balasanmu WAJIB berupa JSON valid persis seperti ini (tanpa markdown tambahan):
{
  "produk": "Nama produk yang sedang dibeli",
  "qty": 1,
  "unit": "pcs",
  "total_harga_barang": 100000,
  "nama_penerima": "nama pelanggan atau null",
  "alamat": "alamat yang diberikan pengguna (jika hanya menyebutkan kota/kecamatan, isi dengan kota/kecamatan tersebut)",
  "lokasi_ongkir": "Kecamatan dan Kota (contoh: Tambaksari, Surabaya) atau null",
  "kurir": "JNE REG" atau "J&T EXPRESS" atau null
}`;

        let text = "";
        if (groq) {
            try {
                const response = await groq.chat.completions.create({
                    model: "openai/gpt-oss-120b",
                    temperature: 0.1,
                    messages: [{ role: "user", content: prompt }]
                });
                text = response.choices[0]?.message?.content || "";
            } catch (err) {
                console.warn("⚠️ extractOrderDetails Groq 120b gagal:", err.message);
                try {
                    const response = await groq.chat.completions.create({
                        model: "openai/gpt-oss-20b",
                        temperature: 0.1,
                        messages: [{ role: "user", content: prompt }]
                    });
                    text = response.choices[0]?.message?.content || "";
                } catch (fallbackErr) {
                    console.warn("⚠️ extractOrderDetails Groq fallback gagal:", fallbackErr.message);
                }
            }
        }

        if (!text && genAI) {
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent(prompt);
                text = (await result.response).text().trim();
            } catch (err) {
                console.warn("⚠️ extractOrderDetails Gemini gagal:", err.message);
            }
        }

        if (!text) return null;

        text = text.replace(/```json/gi, '').replace(/```/gi, '').trim();
        const jsonResult = JSON.parse(text);
        if (jsonResult.lokasi_ongkir) {
            jsonResult.lokasi_ongkir = cleanAndValidateLocation(jsonResult.lokasi_ongkir);
        }
        return jsonResult;
    } catch (error) {
        console.error("Error pada extractOrderDetails:", error.message);
        return null;
    }
}

module.exports = { generateAIResponse, processImageWithGemini, extractIntentWithGemini, extractIntentRuleBased, extractOrderDetails, cleanAndValidateLocation };