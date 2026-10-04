const { fetchLatestBaileysVersion, Browsers, makeWASocket } = require('@whiskeysockets/baileys');

async function test() {
    try {
        const vInfo = await fetchLatestBaileysVersion();
        console.log('fetchLatestBaileysVersion:', vInfo);
    } catch (e) {
        console.error(e);
    }
}
test();
