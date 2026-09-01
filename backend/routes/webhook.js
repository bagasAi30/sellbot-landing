const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsapp.service');
const aiService = require('../services/ai.service');

// Verify Webhook for WhatsApp API
router.get('/', (req, res) => {
    const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN;
    
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];
    
    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.status(400).send('Bad Request');
    }
});

// Receive messages from WhatsApp
router.post('/', async (req, res) => {
    let body = req.body;

    if (body.object) {
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
            let phone_number_id = body.entry[0].changes[0].value.metadata.phone_number_id;
            let from = body.entry[0].changes[0].value.messages[0].from;
            let msg_body = body.entry[0].changes[0].value.messages[0].text.body;

            console.log(`Received message from ${from}: ${msg_body}`);

            // 1. Process via AI Service
            const aiResponse = await aiService.generateReply(msg_body, from);

            // 2. Send back to user via WhatsApp
            await whatsappService.sendMessage(from, aiResponse);
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

module.exports = router;
