const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function testGenerate() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Coba model deep research
        const model = genAI.getGenerativeModel({ model: "deep-research-preview-04-2026" });
        const result = await model.generateContent("Halo ini test singkat");
        console.log("Response:", result.response.text());
    } catch (error) {
        console.error("Error generateContent:", error.message);
    }
}

testGenerate();
