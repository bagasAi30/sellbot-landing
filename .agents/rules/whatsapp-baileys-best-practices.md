---
description: Best practices and strict rules for WhatsApp Web (Baileys) integration.
---
# WhatsApp Web (Baileys) Rules

1. **Dynamic Versioning with Safe Fallback**: When initializing `makeWASocket`, use `fetchLatestBaileysVersion()` from `@whiskeysockets/baileys` and cache the result so it is not queried on every reconnect. Use an up-to-date fallback array (e.g. `[2, 3000, 1043857760]`).
2. **Standard Browser Signature**: Always use standard `Browsers.ubuntu('Chrome')` imported from `@whiskeysockets/baileys`. Custom or mismatched browser tuples trigger anti-bot rejections and timeouts during pairing.
3. **Session Reconnect Invariant (Crucial)**: Whenever `connection === 'close'` occurs, the old socket instance is dead. You MUST:
   - Call `sock.ev.removeAllListeners()` to prevent memory leaks and zombie events.
   - Set `activeSessions[userId].sock = null` so that subsequent calls to `startWhatsAppBot` are not blocked by `if (activeSessions[userId].sock) return`.
   - On `statusCode === DisconnectReason.restartRequired` (515), reconnect quickly (~500ms) so WhatsApp mobile can complete the handshake swap.
4. **Clean Stale Unregistered Sessions**: If a pairing attempt was aborted or failed midway, `creds.registered` remains `false`. When requesting a new QR scan, purge any unpaired auth directory so Baileys generates a fresh keypair and valid QR code.
5. **Pairing Code (Nomor HP)**: Keep Pairing Code supported as an alternative method if users have camera or QR scanning issues.
