const axios = require('axios');
require('dotenv').config();

const RAJAONGKIR_API_KEY = process.env.RAJAONGKIR_API_KEY;
const STORE_ORIGIN_ID = process.env.STORE_ORIGIN_ID || 254; // 254 = Surabaya (contoh)

/**
 * Mencari ID Kota/Kecamatan berdasarkan string pencarian
 */
async function searchDestination(query) {
    try {
        const response = await axios.get('https://rajaongkir.komerce.id/api/v1/destination/domestic-destination', {
            headers: { key: RAJAONGKIR_API_KEY },
            params: { search: query.trim() },
            timeout: 8000
        });

        const data = response.data?.data;
        if (data && data.length > 0) {
            return data; // Return array of results
        }
        return null;
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
