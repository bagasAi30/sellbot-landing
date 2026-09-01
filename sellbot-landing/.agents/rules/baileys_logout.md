---
name: Baileys WhatsApp Session Reset
description: Rule for explicitly deleting the auth_info directory when logging out of a Baileys session.
---

# Rule: Baileys WhatsApp Session Reset
When implementing a logout, disconnect, or "relink" feature for a WhatsApp bot using the `@whiskeysockets/baileys` library, you MUST explicitly delete the local `auth_info` directory (or wherever credentials are saved) from the file system. 

Calling `sock.logout()` is NOT sufficient because it leaves the credential files behind. Always execute an `fs.rmSync(sessionPath, { recursive: true, force: true })` after logout to ensure a clean state for the next QR scan.
