📋 PRD Revisi — WA Chat Service AI untuk Penjual Online
Fokus dirombak: semua fitur terjadi di dalam chat — bukan web app/site. Dashboard hanya untuk pengaturan & monitoring, bukan untuk operasional harian. Invoice pun dibuat AI langsung di chat sebagai pesan.

1. RINGKASAN PRODUK
Item	Deskripsi
Nama Produk	SellBot AI (usulan)
Kategori	SaaS — WhatsApp AI Chat Service
Target Pengguna	Penjual online UKM/independen
Masalah	Chat pelanggan membludak, tidak terbalas cepat, closing hilang
Solusi	AI balas chat WA otomatis 24/7, paham produk, sampai bantu buat invoice langsung di chat
Prinsip utama: Penjual tetap fokus di WA. Semua transaksi percakapan (tanya produk → nego → order → invoice → konfirmasi bayar) selesai di dalam chat, tanpa pelanggan buka website.

2. LATAR BELAKANG & MASALAH
Volume chat tinggi — 50–500+ chat/hari, pertanyaan repetitif ("Ready?", "Harga?", "Ongkir?", "Bisa COD?")
Tidak bisa 24/7 — chat malam tidak terbalas → pelanggan kabur
Kehilangan closing — slow response = pelanggan pindah ke penjual lain
Pengetahuan produk tersebar — harga/stok/varian tidak terpusat, balasan tidak konsisten
Invoice ribet — penjual masih ketik manual rincian harga, total, rekening, satu per satu
3. TUJUAN PRODUK
Objective	Key Result
Beban chat turun drastis	80% chat umum terbalas otomatis
Closing meningkat	≥ 15% konversi chat → order
Response time	≤ 5 detik, 24/7
Invoice otomatis	100% order dibuatkan invoice AI di chat, tanpa tools tambahan
4. ARSITEKTUR FITUR (MVP)
4.1 AI Chat Service — INTI PRODUK
Semua terjadi di sini. AI membaca chat masuk, balas otomatis secara natural.

Fitur	Detail
Intent Detection	Deteksi niat: tanya stok, harga, ongkir, nego, komplain, siap order
Context Awareness	Paham konteks chat sebelumnya, tidak asal jawab
Tone Personalization	Formal / santai / gaul — sesuai gaya penjual
Bahasa Indonesia Natural	Dukungan slang, campur kode, bahasa sehari-hari
Upsell	Rekomendasi produk terkait saat relevan
Eskalasi ke Manusia	Jika AI ragu / pelanggan marah → serahkan ke penjual dengan ringkasan chat
Human Takeover	Penjual bisa ambil alih kapan saja; AI berhenti balas
4.2 Knowledge Base Produk — SUMBER PENGETAHUAN AI
Tempat penjual mengisi "otak" produk. Diisi sekali, dipakai terus oleh AI.

Fitur	Detail
Input Manual	Tambah produk: nama, harga, varian (warna/ukuran), deskripsi, stok
Import Bulk	CSV/Excel untuk banyak produk
FAQ Builder	Tulis pertanyaan umum + jawaban standar
Kebijakan Toko	Jam operasional, estimasi kirim, metode bayar, rekening/QRIS
AI Enrichment	AI otomatis perbaiki/perkaya deskripsi produk
Catatan: Knowledge base diinput via dashboard (sekali setup). Operasional harian tetap di chat.
4.3 Invoice di Chat — BUKAN WEB/SITE
Invoice dibuat AI langsung sebagai pesan WhatsApp saat pelanggan sudah siap order.

Contoh alur closing + invoice di chat:

👤 "Kak aku jadi ambil 2 hoodie navy"
🤖 "Siap Kak! Ini rinciannya ya:

📄 INVOICE #INV-0042
━━━━━━━━━━━━━━━
📦 2x Hoodie Navy
   Rp 149.000 x 2 = Rp 298.000
🚚 Ongkir J&T Reg (JKT→BDG)
   Rp 18.000
━━━━━━━━━━━━━━━
💰 TOTAL: Rp 316.000

Pembayaran:
• QRIS: [kirim gambar QRIS]
• Transfer BCA: 1234567890 a.n. XXX
• COD : Bayar di tempat


Setelah transfer, kirim bukti bayar ya Kak.
Nanti langsung aku proses 😊"
Fitur	Detail
Generate Invoice Otomatis	AI hitung subtotal + ongkir + total, langsung diketik di chat
Nomor Invoice	Format otomatis (INV-XXXX)
Kirim QRIS/Payment Info	AI kirim gambar QRIS atau info rekening dari kebijakan toko
Deteksi Bukti Bayar	AI baca gambar bukti transfer, konfirmasi "sudah diterima"
Status Order	AI update status: PENDING → PAID → DIPROSES — semua via chat
4.4 Dashboard Monitoring — HANYA UNTUK PENJUAL
Bukan untuk pelanggan. Fungsinya memantau, bukan mengoperasikan.

Fitur	Detail
Unified Inbox	Lihat semua chat + status (AI / human / closed)
Label Otomatis	#order #stok #komplain #nego #closed
Ringkasan Harian	Total chat, % auto-reply, % escalated, order closed
Pertanyaan Terpopuler	Top 10 pertanyaan → saran optimasi FAQ
Riwayat Invoice	Log invoice yang dibuat AI di chat (untuk rekonsiliasi penjual)
5. USER FLOW UTAMA
Pelanggan chat WA
      ↓
AI deteksi intent + cari di Knowledge Base
      ↓
AI balas otomatis (tanya stok/harga/ongkir)
      ↓
Pelanggan siap order
      ↓
AI buat INVOICE langsung di chat
      ↓
AI kirim QRIS/rekening
      ↓
Pelanggan kirim bukti bayar
      ↓
AI konfirmasi + update status → CLOSED ✅
Semua selesai di chat. Pelanggan tidak pernah keluar dari WA.

6. SPESIFIKASI TEKNIS (High-Level)
Komponen	Rekomendasi
Backend	Node.js / Python (FastAPI)
AI/LLM	GPT-4o / Claude + fine-tuning Bahasa Indonesia retail
RAG	Vector DB (Pinecone/Qdrant) untuk search knowledge base
WA Gateway	WhatsApp Cloud API via webhook
OCR Bukti Bayar	Vision AI untuk baca bukti transfer
Database	PostgreSQL + MongoDB (log chat)
Realtime	WebSocket untuk dashboard
7. MONETISASI
Plan	Harga/Bulan	Fitur
Trial	Rp 0 (3 hari)	1 nomor, 500 chat AI, 10 produk
Starter	Rp 99.000	1 nomor, 3.000 chat AI, 50 produk, invoice chat
Pro	Rp 249.000	2 nomor, 10.000 chat AI, unlimited produk, deteksi bukti bayar, upsell
Business	Rp 599.000	5 nomor, 30.000 chat AI, multi-CS, API access, premium support
Pricing berbasis jumlah chat AI — sejalan dengan model "chat service".
8. METRIK KEBERHASILAN
Metrik	Target
Auto-reply Rate	≥ 75%
Accuracy Score	≥ 90% relevan
Escalation Rate	≤ 25%
Time to First Response	≤ 5 detik
Invoice Conversion	≥ 60% chat order → invoice terkirim
Churn	≤ 5%
9. ROADMAP
Fase	Timeline	Deliverables
MVP	8–10 minggu	AI chat service + knowledge base + WA Cloud API + invoice chat manual sederhana + dashboard monitoring
V1	+6 minggu	Intent detection lebih dalam, FAQ builder, label otomatis, invoice otomatis dengan nomor + QRIS
V2	+8 minggu	Integrasi ongkir real-time, deteksi bukti bayar (OCR), bulk import CSV
V3	+10 minggu	Scraping marketplace, upsell otomatis, multi-channel (IG DM)
10. RISIKO & MITIGASI
Risiko	Mitigasi
AI salah balas	Confidence threshold + eskalasi otomatis
WA banned	Gunakan WABA resmi, patuhi kebijakan Meta
Bahasa Indonesia AI kaku	Fine-tuning dataset percakapan retail Indo
Salah hitung invoice	Validasi wajib: semua angka invoice dihitung dari data produk + ongkir yang sudah tersimpan, bukan "dikarang" AI
