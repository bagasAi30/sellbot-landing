const express = require('express');
const router = express.Router();

const Product = require('../models/Product');
const Knowledge = require('../models/Knowledge');
const baileysService = require('../services/baileys.service');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/uploads/'))
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, uniqueSuffix + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

// GET /api/stats (Placeholder - bisa dikembangkan)
router.get('/stats', async (req, res) => {
    try {
        const statData = await Knowledge.findOne({ where: { type: 'STORE_STATS' } });
        res.json(statData ? JSON.parse(statData.content) : {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/products
router.get('/products', async (req, res) => {
    try {
        const products = await Product.findAll();
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/products
router.post('/products', upload.single('image'), async (req, res) => {
    try {
        const { name, variant, price, stock } = req.body;
        const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
        const newProduct = await Product.create({ name, variant, price, stock, imageUrl });
        res.status(201).json(newProduct);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/products/:id
router.put('/products/:id', upload.single('image'), async (req, res) => {
    try {
        const { name, variant, price, stock } = req.body;
        const product = await Product.findByPk(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        
        let updateData = { name, variant, price, stock };
        if (req.file) {
            updateData.imageUrl = `/uploads/${req.file.filename}`;
        }
        
        await product.update(updateData);
        res.json(product);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/products/:id
router.delete('/products/:id', async (req, res) => {
    try {
        const product = await Product.findByPk(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        
        await product.destroy();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/knowledge
router.get('/knowledge', async (req, res) => {
    try {
        const systemPrompt = await Knowledge.findOne({ where: { type: 'SYSTEM_PROMPT' } });
        const storeRules = await Knowledge.findOne({ where: { type: 'STORE_RULES' } });
        const blockedNumbers = await Knowledge.findOne({ where: { type: 'BLOCKED_NUMBERS' } });
        const specialNumbers = await Knowledge.findOne({ where: { type: 'SPECIAL_NUMBERS' } });
        res.json({
            systemPrompt: systemPrompt ? systemPrompt.content : '',
            storeRules: storeRules ? storeRules.content : '',
            blockedNumbers: blockedNumbers ? blockedNumbers.content : '',
            specialNumbers: specialNumbers ? specialNumbers.content : ''
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/knowledge
router.put('/knowledge', async (req, res) => {
    try {
        const { systemPrompt, storeRules, blockedNumbers, specialNumbers } = req.body;

        if (systemPrompt !== undefined) {
            const [promptRecord, created] = await Knowledge.findOrCreate({ where: { type: 'SYSTEM_PROMPT' }, defaults: { content: systemPrompt } });
            if (!created) await promptRecord.update({ content: systemPrompt });
        }

        if (storeRules !== undefined) {
            const [rulesRecord, created] = await Knowledge.findOrCreate({ where: { type: 'STORE_RULES' }, defaults: { content: storeRules } });
            if (!created) await rulesRecord.update({ content: storeRules });
        }

        if (blockedNumbers !== undefined) {
            const [blockRecord, created] = await Knowledge.findOrCreate({ where: { type: 'BLOCKED_NUMBERS' }, defaults: { content: blockedNumbers } });
            if (!created) await blockRecord.update({ content: blockedNumbers });
        }

        if (specialNumbers !== undefined) {
            const [specialRecord, created] = await Knowledge.findOrCreate({ where: { type: 'SPECIAL_NUMBERS' }, defaults: { content: specialNumbers } });
            if (!created) await specialRecord.update({ content: specialNumbers });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/bot/status
router.get('/bot/status', (req, res) => {
    res.json(baileysService.getStatus());
});

// POST /api/bot/start
router.post('/bot/start', async (req, res) => {
    baileysService.setBotActive(true);
    await baileysService.connectToWhatsApp();
    res.json({ success: true, message: 'Bot WhatsApp berhasil dimulai / direstart', status: baileysService.getStatus() });
});

// POST /api/bot/stop
router.post('/bot/stop', async (req, res) => {
    await baileysService.stopWhatsApp();
    res.json({ success: true, message: 'Bot WhatsApp berhasil dimatikan', status: baileysService.getStatus() });
});

// POST /api/bot/reset (Hapus sesi & Munculkan QR baru)
router.post('/bot/reset', async (req, res) => {
    await baileysService.resetWhatsApp();
    res.json({ success: true, message: 'Sesi WhatsApp berhasil direset. Silakan scan QR code baru.', status: baileysService.getStatus() });
});

// POST /api/bot/toggle-active
router.post('/bot/toggle-active', (req, res) => {
    const { active } = req.body;
    baileysService.setBotActive(Boolean(active));
    res.json({ success: true, isBotActive: Boolean(active) });
});

// Shipping routes (RajaOngkir)
const shippingService = require('../services/shipping.service');

// GET /api/shipping/calculate?destination=Bandung&weight=1000
router.get('/shipping/calculate', async (req, res) => {
    const destination = req.query.destination;
    const weight = parseInt(req.query.weight) || 1000;
    const courier = req.query.courier || 'jne:jnt:sicepat';

    if (!destination) {
        return res.status(400).json({ success: false, message: 'Parameter destination diperlukan.' });
    }

    const result = await shippingService.calculateShipping(destination, weight, courier);
    res.json(result);
});

// GET /api/shipping/destination?search=Bandung
router.get('/shipping/destination', async (req, res) => {
    const search = req.query.search;
    if (!search) {
        return res.status(400).json({ success: false, message: 'Parameter search diperlukan.' });
    }

    const dest = await shippingService.searchDestination(search);
    res.json({ success: Boolean(dest), data: dest });
});

module.exports = router;
