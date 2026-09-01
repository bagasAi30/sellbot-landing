const axios = require('axios');

const RAJAONGKIR_API_KEY = process.env.RAJAONGKIR_API_KEY || 'rcrO2L4f3ba7b6dcc82a30c3SEAoyMP2';
const STORE_ORIGIN_ID = process.env.STORE_ORIGIN_ID || 17523; // Jakarta Barat default

const MAJOR_CITIES = {
    'surabaya': 'gubeng surabaya',
    'jakarta': 'menteng jakarta',
    'bandung': 'sumur bandung',
    'medan': 'medan petisah',
    'semarang': 'semarang tengah',
    'jogja': 'danurejan yogyakarta',
    'yogyakarta': 'danurejan yogyakarta',
    'makassar': 'ujung pandang',
    'palembang': 'ilir timur i',
    'malang': 'klojen malang',
    'solo': 'banjarsari surakarta',
    'surakarta': 'banjarsari surakarta',
    'bali': 'denpasar selatan',
    'denpasar': 'denpasar selatan'
};

/**
 * Cari ID Kota / Kecamatan Tujuan berdasarkan nama kota/kecamatan
 */
async function searchDestination(searchQuery) {
    if (!searchQuery || !searchQuery.trim()) return null;

    let finalQuery = searchQuery.trim().toLowerCase();
    
    // Konversi kota besar ke kecamatan pusatnya (karena RajaOngkir butuh kecamatan)
    if (MAJOR_CITIES[finalQuery]) {
        finalQuery = MAJOR_CITIES[finalQuery];
    }

    try {
        const response = await axios.get('https://rajaongkir.komerce.id/api/v1/destination/domestic-destination', {
            headers: { key: RAJAONGKIR_API_KEY },
            params: { search: finalQuery },
            timeout: 8000
        });

        if (response.data?.data && response.data.data.length > 0) {
            const list = response.data.data;
            
            // Prioritaskan yang mengandung nama kota aslinya jika ada
            const originalQueryUpper = searchQuery.trim().toUpperCase();
            const matchingCity = list.find(item => item.city_name?.toUpperCase().includes(originalQueryUpper));
            
            return matchingCity || list[0];
        }
        return null;
    } catch (err) {
        console.error('[Shipping] Error searching destination:', err.response?.data || err.message);
        return null;
    }
}

/**
 * Hitung Ongkos Kirim Real-Time
 * @param {string} destinationSearch - Nama kota / kecamatan tujuan (contoh: "Bandung", "Surabaya", "Medan")
 * @param {number} weightInGrams - Berat paket dalam gram (default: 1000g = 1kg)
 * @param {string} courier - Kurir yang dicek (default: 'jnt:jne:sicepat')
 */
async function calculateShipping(destinationSearch, weightInGrams = 1000, courier = 'jnt:jne:sicepat') {
    try {
        console.log(`[Shipping] Mencari ongkir ke: "${destinationSearch}" (Berat: ${weightInGrams}g)`);
        
        // 1. Dapatkan info destinasi
        const dest = await searchDestination(destinationSearch);
        if (!dest) {
            return {
                success: false,
                message: `Lokasi "${destinationSearch}" tidak ditemukan. Mohon sertakan nama kota atau kecamatan yang jelas.`
            };
        }

        // 2. Hitung ongkir
        const costRes = await axios.post(
            'https://rajaongkir.komerce.id/api/v1/calculate/domestic-cost',
            new URLSearchParams({
                origin: STORE_ORIGIN_ID,
                destination: dest.id,
                weight: weightInGrams,
                courier: courier
            }).toString(),
            {
                headers: {
                    key: RAJAONGKIR_API_KEY,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 10000
            }
        );

        const rates = costRes.data?.data || [];

        // Filter dan rapikan hasil layanan reguler & populer (misal REG, EZ, dll)
        const formattedRates = rates
            .filter(r => r.cost > 0 && !r.service.includes('>') && !r.service.includes('<') && !r.service.includes('JTR') && !r.service.includes('GOKIL') && !r.service.includes('SPS')) // Hanya layanan reguler biasa
            .map(r => ({
                courier: r.name,
                service: r.service,
                description: r.description,
                cost: r.cost,
                etd: r.etd ? `${r.etd}` : '1-3 hari'
            }));

        return {
            success: true,
            destination: {
                label: dest.label,
                city: dest.city_name,
                province: dest.province_name
            },
            weight: weightInGrams,
            rates: formattedRates
        };
    } catch (err) {
        console.error('[Shipping] Error calculating shipping cost:', err.response?.data || err.message);
        return {
            success: false,
            message: 'Gagal menghubungkan ke server ekspedisi RajaOngkir.'
        };
    }
}

/**
 * Mendapatkan nama pendek kurir yang lebih enak dibaca (JNE, J&T, SPX)
 */
function getShortCourierName(fullName) {
    const name = fullName.toUpperCase();
    if (name.includes('JALUR NUGRAHA')) return 'JNE';
    if (name.includes('J&T')) return 'J&T';
    if (name.includes('SHOPEE')) return 'SPX';
    if (name.includes('SICEPAT')) return 'SiCepat';
    return fullName.split(' ')[0];
}

/**
 * Format ringkasan ongkir menjadi teks rapi untuk WhatsApp Bot
 */
function formatShippingText(shippingResult) {
    if (!shippingResult.success) {
        return shippingResult.message;
    }

    const { destination, weight, rates } = shippingResult;
    let text = `📦 *CEK ONGKIR TUJUAN: ${destination.city || destination.label}*\n`;
    text += `⚖️ Berat Paket: ${(weight / 1000).toFixed(1)} kg\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;

    if (rates.length === 0) {
        text += `Maaf, tarif reguler tidak ditemukan untuk lokasi ini.\n`;
    } else {
        // Ambil maksimal 5 opsi terpopuler
        rates.slice(0, 5).forEach(r => {
            const courierName = getShortCourierName(r.courier);
            text += `• *${courierName} ${r.service}*: Rp ${r.cost.toLocaleString('id-ID')} (Est: ${r.etd})\n`;
        });
    }

    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `*Dari pengiriman*: ${process.env.STORE_ORIGIN_NAME || 'Jakarta Barat'}`;

    return text;
}

module.exports = {
    searchDestination,
    calculateShipping,
    formatShippingText
};
