const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function checkModels() {
    try {
        console.log("Menggunakan API Key:", process.env.GEMINI_API_KEY.substring(0, 10) + '...');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // Sayangnya SDK node js tidak punya genAI.listModels() public di versi ini?
        // Kita gunakan fetch manual
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error:", error);
    }
}

checkModels();
