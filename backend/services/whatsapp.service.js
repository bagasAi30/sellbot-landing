const axios = require('axios');

/**
 * WhatsApp Service Stub
 * Connects to WhatsApp Cloud API
 */

async function sendMessage(to, text) {
    const token = process.env.WA_TOKEN;
    const phoneId = process.env.WA_PHONE_NUMBER_ID;

    if (!token || !phoneId || token === 'your_whatsapp_token_here') {
        console.warn('[WA Service] Mock sending (No Token): to', to, '- msg:', text);
        return;
    }

    try {
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
            data: {
                messaging_product: 'whatsapp',
                to: to,
                text: { body: text },
            },
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log(`[WA Service] Message sent to ${to}`);
    } catch (error) {
        console.error('[WA Service] Error sending message:', error.response ? error.response.data : error.message);
    }
}

module.exports = {
    sendMessage
};
