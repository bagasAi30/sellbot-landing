# Baileys WhatsApp Bot Invariants

1. **Admin / Special Numbers Must Never Be Ignored**:
   - `special_numbers` or `admin_numbers` are destination numbers for administrative forwarding (e.g., invoices, handover alerts).
   - Only `blocked_numbers` (explicit blacklist) should cause incoming messages to be dropped.
   - Never combine `special_numbers` or `admin_numbers` into the `ignoreList`.

2. **History Sync Threshold**:
   - For `messages.upsert`, ignore messages older than 120 seconds (`now - msgTimestamp > 120`) to skip history sync without dropping live messages subject to clock drift or network latency.
