# 🚀 Panduan Lengkap Deployment ke VPS / Public Server (SellBot AI)

Panduan ini berisi langkah-langkah praktis dan teruji untuk mendeploy aplikasi **SellBot AI Platform** ke VPS (Virtual Private Server) seperti **DigitalOcean, Contabo, AWS EC2, Linode/Akamai, IDCloudHost, DomaiNesia**, dll.

---

## 📋 Daftar Isi
1. [Spesifikasi Minimal VPS](#1-spesifikasi-minimal-vps)
2. [Persiapan Awal Server (Ubuntu)](#2-persiapan-awal-server-ubuntu)
3. [Clone Proyek & Setup Environment](#3-clone-proyek--setup-environment)
4. [Menjalankan Aplikasi dengan PM2 (Direkomendasikan)](#4-menjalankan-aplikasi-dengan-pm2-direkomendasikan)
5. [Alternatif: Menjalankan dengan Docker Compose](#5-alternatif-menjalankan-dengan-docker-compose)
6. [Konfigurasi Nginx Reverse Proxy](#6-konfigurasi-nginx-reverse-proxy)
7. [Memasang SSL HTTPS Gratis (Let's Encrypt / Certbot)](#7-memasang-ssl-https-gratis-lets-encrypt--certbot)
8. [Pengaturan Midtrans Webhook](#8-pengaturan-midtrans-webhook)
9. [Persistensi Sesi Login WhatsApp (Baileys)](#9-persistensi-sesi-login-whatsapp-baileys)
10. [Akses Dashboard Admin di Server Publik](#10-akses-dashboard-admin-di-server-publik)

---

## 1. Spesifikasi Minimal VPS
- **OS**: Ubuntu 22.04 LTS atau 24.04 LTS (64-bit)
- **CPU**: 1 vCPU (2 vCPU direkomendasikan jika banyak tenant bot aktif)
- **RAM**: 1 GB minimal (2 GB atau 4 GB lebih disarankan untuk multi-akun WhatsApp)
- **Penyimpanan**: 20 GB SSD
- **Port Terbuka**: Port 80 (HTTP), 443 (HTTPS), 22 (SSH)

---

## 2. Persiapan Awal Server (Ubuntu)

Hubungkan ke VPS via SSH melalui terminal atau PowerShell di komputer Anda:
```bash
ssh root@IP_VPS_ANDA
```

Update sistem operasi dan install paket dasar:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git ufw software-properties-common
```

Install **Node.js 20 LTS** & **npm**:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verifikasi versi
node -v # Harapannya v20.x.x
npm -v  # Harapannya v10.x.x
```

Install **PM2** (Process Manager) secara global:
```bash
sudo npm install -g pm2
```

Konfigurasi Firewall (UFW):
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 3. Clone Proyek & Setup Environment

Pindah ke direktori web dan clone repository:
```bash
cd /var/www
git clone https://github.com/bagasAi30/sellbot-landing.git
cd sellbot-landing
```

Install dependensi:
```bash
# Install dependensi utama
npm install --omit=dev

# Install dependensi backend-bot
cd sellbot-landing/backend-bot
npm install --omit=dev
cd ../..
```

Buat file environment `.env`:
```bash
nano sellbot-landing/backend-bot/.env
```
Isi dengan konfigurasi Anda (lihat contoh di `.env.example`):
```ini
PORT=3001
NODE_ENV=production
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
GEMINI_API_KEY=your_gemini_api_key
GROQ_API_KEY=your_groq_api_key
STORE_ORIGIN_ID=254
MIDTRANS_SERVER_KEY=Mid-server-xxxx
MIDTRANS_CLIENT_KEY=Mid-client-xxxx
MIDTRANS_MERCHANT_ID=Mxxxx
MIDTRANS_IS_PRODUCTION=true
```
Simpan dengan menekan `Ctrl + O`, lalu `Enter`, kemudian keluar dengan `Ctrl + X`.

---

## 4. Menjalankan Aplikasi dengan PM2 (Direkomendasikan)

File `ecosystem.config.js` sudah disiapkan di root proyek.

Jalankan aplikasi di background dengan PM2:
```bash
# Dari root direktori /var/www/sellbot-landing
pm2 start ecosystem.config.js
```

Periksa status aplikasi:
```bash
pm2 status
pm2 logs sellbot-backend
```

Aktifkan agar aplikasi otomatis menyala saat VPS di-restart:
```bash
pm2 startup
# Jalankan perintah yang ditampilkan oleh terminal (biasanya diawali `sudo env PATH=...`)
pm2 save
```

Perintah berguna PM2:
- `pm2 restart sellbot-backend` : Restart aplikasi
- `pm2 stop sellbot-backend`    : Menghentikan aplikasi
- `pm2 logs sellbot-backend`    : Melihat log real-time
- `pm2 monit`                   : Melihat penggunaan CPU/RAM secara grafis

---

## 5. Alternatif: Menjalankan dengan Docker Compose

Jika Anda lebih memilih Docker:

1. Install Docker & Docker Compose di VPS:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
sudo apt install -y docker-compose-plugin
```

2. Jalankan container:
```bash
docker compose up -d --build
```

3. Cek status & logs:
```bash
docker compose ps
docker compose logs -f
```

---

## 6. Konfigurasi Nginx Reverse Proxy

Install Nginx:
```bash
sudo apt install -y nginx
```

Buat file konfigurasi server block Nginx:
```bash
sudo nano /etc/nginx/sites-available/sellbot
```

Tempelkan konfigurasi berikut (ganti `domainanda.com` dengan domain Anda):
```nginx
server {
    listen 80;
    server_name domainanda.com www.domainanda.com;

    client_max_body_size 30M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Forward header
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
    }
}
```

Aktifkan konfigurasi dan restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/sellbot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 7. Memasang SSL HTTPS Gratis (Let's Encrypt / Certbot)

Pastikan DNS domain Anda (A Record) sudah mengarah ke IP publik VPS Anda.

Install Certbot:
```bash
sudo apt install -y certbot python3-certbot-nginx
```

Generate dan pasang sertifikat SSL secara otomatis:
```bash
sudo certbot --nginx -d domainanda.com -d www.domainanda.com
```
Certbot akan otomatis memperbarui file Nginx untuk mengaktifkan HTTPS dan redirect otomatis dari HTTP ke HTTPS.

Uji auto-renewal sertifikat:
```bash
sudo certbot renew --dry-run
```

---

## 8. Pengaturan Midtrans Webhook

Setelah website Anda memiliki HTTPS:
1. Masuk ke **Midtrans Dashboard** (https://dashboard.midtrans.com)
2. Buka menu **Settings** -> **Configuration**
3. Masukkan **Payment Notification URL**:
   ```
   https://domainanda.com/api/payment/webhook
   ```
4. Masukkan **Finish Redirect URL**:
   ```
   https://domainanda.com/dashboard.html
   ```
5. Simpan pengaturan. Kini pembayaran QRIS / transfer bank akan otomatis terverifikasi secara instan!

---

## 9. Persistensi Sesi Login WhatsApp (Baileys)

Setiap user tenant yang memindai QR code WhatsApp akan memiliki folder autentikasi di dalam:
```
sellbot-landing/backend-bot/auth_info_<userId>/
```
- Folder ini **sangat penting** karena menyimpan token login WhatsApp.
- Backend sudah dilengkapi fungsi **auto-resume** saat server dinyalakan ulang.
- Untuk backup rutin, Anda dapat mengarsipkan folder `auth_info_*`:
```bash
# Backup sesi login WhatsApp
tar -czvf wa_sessions_backup_$(date +%F).tar.gz /var/www/sellbot-landing/sellbot-landing/backend-bot/auth_info_*
```

---

## 10. Akses Dashboard Admin di Server Publik

Setelah server aktif, Anda dapat mengakses:
- **Landing Page Publik**: `https://domainanda.com/`
- **Dashboard Tenant / Toko**: `https://domainanda.com/dashboard`
- **Super Admin Dashboard (Data Riil)**: `https://domainanda.com/admin`

Fitur Dashboard Admin yang sudah aktif dengan **Data Nyata**:
1. **Overview**: Total tenant aktif, omset pendapatan MTD, total chat yang dilayani bot, dan uptime server.
2. **User Management**: Rincian nama toko nyata, kontak nomor WhatsApp, email, status akun, tombol kelola paket, dan hapus tenant.
3. **Revenue & Billing**: Rincian transaksi Midtrans riil, status pembayaran, dan tombol **Export CSV** riil.
4. **System Health**: Pantauan penggunaan CPU & RAM VPS Anda, status socket bot WhatsApp, latensi database Supabase, dan ketersediaan API AI.
5. **Live Server Logs**: Klik tombol **View Server Logs** untuk melihat log aktivitas server langsung dari browser tanpa perlu SSH ke terminal VPS!
