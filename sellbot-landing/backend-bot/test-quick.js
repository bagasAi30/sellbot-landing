require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { generateAIResponse, extractIntentWithGemini } = require('./ai');

async function test() {
    console.log("=== Test AI sellbot-landing/backend-bot ===\n");
    const messages = ["Halo kak mau tanya", "Halo kak jualan apa aja", "Berapa harga kaosnya"];
    
    for (const msg of messages) {
        console.log(`User: ${msg}`);
        try {
            const intent = await extractIntentWithGemini(msg, []);
            console.log(`Intent: ${JSON.stringify(intent)}`);
            const reply = await generateAIResponse(msg, "Layani pelanggan dengan ramah", [], []);
            console.log(`AI: ${reply}`);
        } catch(e) {
            console.error(`Error: ${e.message}`);
        }
        console.log("-".repeat(40));
    }
}
test();
