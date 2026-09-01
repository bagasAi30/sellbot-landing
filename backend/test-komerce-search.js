require('dotenv').config();
const axios = require('axios');

async function testSearch(searchQuery) {
    const RAJAONGKIR_API_KEY = process.env.RAJAONGKIR_API_KEY || 'rcrO2L4f3ba7b6dcc82a30c3SEAoyMP2';
    
    try {
        const response = await axios.get('https://rajaongkir.komerce.id/api/v1/destination/domestic-destination', {
            headers: { key: RAJAONGKIR_API_KEY },
            params: { search: searchQuery.trim() },
            timeout: 8000
        });

        if (response.data?.data) {
            console.log(`Results for "${searchQuery}":`);
            response.data.data.forEach((d, i) => {
                console.log(`[${i}] ID: ${d.id}, Label: ${d.label}, City: ${d.city_name}, District: ${d.subdistrict_name}`);
            });
        }
    } catch (err) {
        console.error(err);
    }
}

testSearch("Surabaya");
