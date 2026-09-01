const sequelize = require('./config/database');
const Product = require('./models/Product');
const Knowledge = require('./models/Knowledge');
const oldData = require('./data.js'); // Baca data lama

async function initDb() {
    try {
        console.log('🔄 Menghubungkan ke Database SQLite...');
        await sequelize.authenticate();
        
        // Sinkronisasi model (buat tabel jika belum ada)
        await sequelize.sync({ force: true }); // force: true akan mereset tabel setiap kali dijalankan
        console.log('✅ Tabel berhasil dibuat!');

        // Migrasi Data Produk
        console.log('📦 Memigrasi Data Produk...');
        for (const p of oldData.products) {
            await Product.create({
                name: p.name,
                variant: p.variant,
                price: p.price,
                stock: p.stock
            });
        }
        console.log('✅ Produk berhasil dimigrasi!');

        // Migrasi Data Stats/Aturan Toko sebagai Knowledge
        console.log('📚 Menyimpan pengaturan toko ke Knowledge Base...');
        await Knowledge.create({
            type: 'STORE_STATS',
            content: JSON.stringify(oldData.stats)
        });

        await Knowledge.create({
            type: 'STORE_RULES',
            content: `Aturan Penjualan & Layanan:
1. Jika pengguna bertanya tentang produk, periksa daftar stok di atas. Jika stok habis atau di bawah 10, informasikan dengan sopan.
2. Jika produk tidak ada dalam daftar, katakan bahwa saat ini produk tersebut tidak tersedia.
3. Jangan pernah memberikan diskon tanpa izin.
4. Jika pelanggan mengisyaratkan ingin memesan/membeli, arahkan mereka untuk menyebutkan rincian pesanan (produk, varian, jumlah) dan kota tujuan pengiriman.
5. Jika rincian pesanan dan ongkir sudah lengkap, buatkan struk INVOICE.`
        });

        console.log('✅ Database siap digunakan!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Gagal inisialisasi database:', err);
        process.exit(1);
    }
}

initDb();
