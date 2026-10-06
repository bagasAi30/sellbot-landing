const axios = require('axios');
require('dotenv').config();

const RAJAONGKIR_API_KEY = process.env.RAJAONGKIR_API_KEY;
const STORE_ORIGIN_ID = process.env.STORE_ORIGIN_ID || 254; // 254 = Surabaya (contoh)

/**
 * Mencari ID Kota/Kecamatan berdasarkan string pencarian
 */
async function searchDestination(query) {
    if (!query || typeof query !== 'string') return null;
    try {
        const cleanQuery = query.trim();
        // Normalize common spaced subdistricts or variants (contoh: "tambak sari" -> "tambaksari")
        const normalizedSpaced = cleanQuery.replace(/tambak\s+sari/gi, 'tambaksari');
        const queryVariants = [
            cleanQuery,
            normalizedSpaced,
            cleanQuery.replace(/[,\.\-]/g, ' ').replace(/\s+/g, ' ').trim()
        ].filter((v, i, arr) => v && arr.indexOf(v) === i);

        let combinedResults = [];
        for (const q of queryVariants) {
            try {
                const response = await axios.get('https://rajaongkir.komerce.id/api/v1/destination/domestic-destination', {
                    headers: { key: RAJAONGKIR_API_KEY },
                    params: { search: q },
                    timeout: 6000
                });
                const list = response.data?.data;
                if (list && list.length > 0) {
                    combinedResults.push(...list);
                    if (combinedResults.length >= 10) break;
                }
            } catch (singleErr) {
                // Lanjut ke varian berikutnya jika ada error
            }
        }

        if (combinedResults.length === 0) return null;

        // Deduplikasi hasil berdasarkan destination id
        const uniqueMap = new Map();
        for (const item of combinedResults) {
            const id = item.id || item.subdistrict_id || item.city_id;
            if (id && !uniqueMap.has(id)) {
                uniqueMap.set(id, item);
            }
        }
        const results = Array.from(uniqueMap.values());

        // Token scoring agar mencocokkan kata kota/kabupaten dan kecamatan secara optimal
        const tokens = cleanQuery.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
        if (tokens.length > 1) {
            results.sort((a, b) => {
                const aText = `${a.label || ''} ${a.subdistrict_name || ''} ${a.district_name || ''} ${a.city_name || ''}`.toLowerCase();
                const bText = `${b.label || ''} ${b.subdistrict_name || ''} ${b.district_name || ''} ${b.city_name || ''}`.toLowerCase();
                const aScore = tokens.filter(t => aText.includes(t)).length;
                const bScore = tokens.filter(t => bText.includes(t)).length;
                return bScore - aScore;
            });
        }

        return results;
    } catch (err) {
        console.error("Error searchDestination:", err.message);
        return null;
    }
}

/**
 * Menghitung ongkos kirim berdasarkan destinationId dan weight (gram)
 */
async function calculateShipping(destinationId, weight) {
    try {
        const payload = new URLSearchParams({
            origin: String(STORE_ORIGIN_ID),
            destination: String(destinationId),
            weight: String(weight > 0 ? weight : 1000),
            courier: 'jne:jnt'  // Hanya JNE dan J&T
        });

        console.log(`📮 Calculate shipping: origin=${STORE_ORIGIN_ID} dest=${destinationId} weight=${weight}`);

        const response = await axios.post('https://rajaongkir.komerce.id/api/v1/calculate/domestic-cost', payload.toString(), {
            headers: {
                key: RAJAONGKIR_API_KEY,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 10000
        });

        console.log(`✅ Shipping response:`, JSON.stringify(response.data).substring(0, 200));

        if (response.data?.data && response.data.data.length > 0) {
            return response.data.data;
        }
        return null;
    } catch (err) {
        // Log detail error response
        if (err.response) {
            console.error(`Error calculateShipping [${err.response.status}]:`, JSON.stringify(err.response.data).substring(0, 300));
        } else {
            console.error("Error calculateShipping:", err.message);
        }
        return null;
    }
}

module.exports = {
    searchDestination,
    calculateShipping
};
