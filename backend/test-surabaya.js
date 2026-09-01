require('dotenv').config();
const aiService = require('./services/ai.service');

async function testSurabaya() {
    console.log("Testing message: 'cek ongkir ke surabaya'");
    const res = await aiService.generateReply("cek ongkir ke surabaya", "12345");
    console.log("\n--- RESULT ---");
    console.log(res);
}

testSurabaya();
