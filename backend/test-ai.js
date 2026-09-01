require('dotenv').config();
const aiService = require('./services/ai.service');

async function runTest() {
    console.log("=== Testing SellBot AI ===");
    console.log("Pastikan OPENAI_API_KEY di .env sudah diisi dengan benar.\n");

    const testMessages = [
        "Halo, jualan apa saja kak?",
        "Harga kaos polosnya berapa ya?",
        "Boleh pesan hoodie nya 1 yang black XL kak?"
    ];

    for (let msg of testMessages) {
        console.log(`\nUser: ${msg}`);
        const reply = await aiService.generateReply(msg, "6281234567890");
        console.log(`SellBot AI: \n${reply}`);
        console.log("-".repeat(40));
    }
}

runTest();
