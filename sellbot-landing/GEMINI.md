# Baileys Bot Message Handling Best Practices

When writing or modifying a `@whiskeysockets/baileys` bot message handler, always apply these three invariants:

1. **Type Check**: Always verify the message is a new notification, not a history sync.
   ```javascript
   sock.ev.on('messages.upsert', async (m) => {
       if (m.type !== 'notify') return;
       // ...
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
