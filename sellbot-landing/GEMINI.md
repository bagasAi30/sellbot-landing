# Baileys Bot Message Handling Best Practices

When writing or modifying a `@whiskeysockets/baileys` bot message handler, always apply these three invariants:

1. **History Sync Ignorance (Timestamp Check)**: Do NOT rely on `m.type === 'notify'` as some Baileys versions or multi-device syncs send `append` for new messages. Instead, use a timestamp check to ignore history syncs (messages older than 60 seconds).
   ```javascript
   sock.ev.on('messages.upsert', async (m) => {
       for (const msg of m.messages) {
           const now = Math.floor(Date.now() / 1000);
           if (msg.messageTimestamp && (now - msg.messageTimestamp > 60)) continue;
           // ...
       }
   });
   ```

2. **Iterate All Messages**: Always loop through `m.messages`, never just pick `m.messages[0]`.
   ```javascript
       for (const msg of m.messages) {
           if (!msg.message || msg.key.fromMe) continue;
           // ...
       }
   ```

3. **Use Built-in Unwrapper**: Always import and use `extractMessageContent` from `@whiskeysockets/baileys` to safely unwrap nested messages (like `ephemeralMessage`, `viewOnceMessage`).
   ```javascript
       const { extractMessageContent } = require('@whiskeysockets/baileys');
       // ... inside the loop:
       const msgContent = extractMessageContent(msg.message);
       if (!msgContent) continue;
       const textMessage = msgContent.conversation || msgContent.extendedTextMessage?.text || "";
   ```
