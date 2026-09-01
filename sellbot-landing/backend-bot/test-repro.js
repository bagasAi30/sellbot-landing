require('dotenv').config();
const { generateAIResponse } = require('./ai.js');
const storeRules = `[INFORMASI PRODUK & TOKO]
4. METODE PEMBAYARAN & KETENTUAN COD
- Transfer Bank / E-Wallet: Tersedia (Bebas biaya tambahan).
- COD (Cash on Delivery / Bayar di Tempat): Tersedia ke seluruh Indonesia, dengan ketentuan ada **biaya potongan/layanan COD sebesar 3%** dari total harga produk.
5. FORMAT PEMESANAN
Jika pelanggan ingin memesan, minta data berikut:
- Nama Lengkap:
- Alamat Lengkap:
- No. WhatsApp:
- Detail Pesanan:
- Metode Pembayaran (Transfer / COD):`;
const products = [{name: 'Celana Chino Panjang Slimfit', price: 150000, variants: '28, 30, 32'}];
generateAIResponse('Celana Chino Panjang Slimfit ukuran apa aja kak', storeRules, products, [], '').then(console.log);
