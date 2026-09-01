require('dotenv').config();
const shippingService = require('./services/shipping.service');

async function testSmartExtract(userMessage) {
    console.log(`\nInput: "${userMessage}"`);
    
    // Deteksi apakah pesan mengandung indikasi cek ongkir / lokasi
    const isOngkirQuery = /ongkir|ongkos|kirim|biaya|tujuan/i.test(userMessage);
    
    if (isOngkirQuery) {
        // Ekstrak kata setelah "ke" atau "tujuan" atau nama kota di pesan
        let targetLocation = '';
        const matchKe = userMessage.match(/(?:ke|tujuan|di)\s+([a-zA-Z\s]+)/i);
        if (matchKe && matchKe[1]) {
            targetLocation = matchKe[1].trim();
        } else {
            // Ambil kata selain kata kunci ongkir
            targetLocation = userMessage.replace(/cek|ongkir|berapa|ongkos|kirim|biaya|kak|min|tolong/gi, '').trim();
        }

        console.log(`Extracted Location: "${targetLocation}"`);
        if (targetLocation.length > 2) {
            const shippingRes = await shippingService.calculateShipping(targetLocation, 1000);
            if (shippingRes.success) {
                console.log("SUCCESS! Rates found:", shippingRes.rates.slice(0, 3));
            } else {
                console.log("Location search failed:", shippingRes.message);
            }
        }
    }
}

async function runTests() {
    await testSmartExtract("cek ongkir ke surabaya");
    await testSmartExtract("ongkir ke bandung berapa kak");
    await testSmartExtract("kirim ke medan");
}

runTests();
