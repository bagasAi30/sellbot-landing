require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');
const { connectToWhatsApp } = require('./services/baileys.service');

app.use('/webhook', webhookRoutes);
app.use('/api', apiRoutes);

const path = require('path');

// Static files (Frontend SellBot)
app.use(express.static(path.join(__dirname, '../sellbot-landing')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Health check API
app.get('/api/health', (req, res) => {
    res.json({ status: 'SellBot AI Backend is running' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // Hubungkan ke WhatsApp menggunakan Baileys (Scan QR)
    // connectToWhatsApp(); // DINONAKTIFKAN KARENA DASHBOARD MENGGUNAKAN backend-bot
});
