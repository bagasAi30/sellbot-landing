# WhatsApp Bot Order State & AI Accuracy

When building or modifying the WhatsApp bot invoice flow in `index.js` and `ai.js`:

## 1. Order State Cache (pendingOrder) — WAJIB

**JANGAN** andalkan regex-parsing pesan AI sebelumnya untuk mendapatkan data invoice (produk, harga, nama, alamat). Pendekatan ini rapuh karena pesan AI terakhir bisa berupa ongkir message, bukan invoice.

**GUNAKAN** `pendingOrder` cache di `activeSessions[userId]` dengan struktur:
```js
activeSessions[userId].pendingOrder = {
    produk,       // string: "Nama Produk x N pcs"
    qty,          // number
    hargaProduk,  // number: harga satuan
    totalBarang,  // number: hargaProduk * qty
    namaPenerima, // string
    alamat,       // string
    destLabel,    // string: nama kota/kecamatan tujuan
    shippingRates // array: rate objects dari API ongkir
};
```

**Isi cache di DUA tempat:**
- `CHECK_SHIPPING` handler: setelah ongkir ditampilkan, scan katalog vs riwayat chat untuk cari produk & qty, cache ke pendingOrder
- `GENERAL` invoice draft handler: cache langsung dari variabel yang sudah dihitung

**Di `SELECT_COURIER` handler:**
- PRIMARY: Gunakan `pendingOrder` (ambil rate sesuai kurir pilihan user dari `shippingRates`)
- Setelah dipakai: set `activeSessions[userId].pendingOrder = null`
- FALLBACK jika cache kosong: scan SEMUA pesan AI (bukan cuma yang terakhir) + seluruh riwayat chat

## 2. AI System Prompt — Akurasi Varian Produk

System prompt di `ai.js` HARUS mengandung instruksi eksplisit ini:

- Jika ditanya ukuran/varian/warna: jawab HANYA berdasarkan kolom "Varian" di katalog PERSIS.
  JANGAN menambah, mengurangi, atau mengasumsikan varian yang tidak tercantum.
  Jika tidak ada data varian: katakan "untuk info varian silakan tanya langsung ke admin ya kak"
- JANGAN PERNAH mengarang ukuran, warna, atau varian yang tidak ada di katalog


## 3. Override Aturan Toko (COD / Agresif Minta Data)

Jika aturan toko pelanggan (dari database) memaksa bot untuk selalu menyebutkan COD atau meminta format pesanan di setiap respon, AI HARUS mengabaikannya KECUALI pelanggan benar-benar bertanya soal COD/pembayaran, atau pelanggan benar-benar ingin order. Gunakan **CRITICAL OVERRIDES** di akhir prompt untuk membantah instruksi di store_rules.
