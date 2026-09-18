# Safe Logging & Resilient Payment Gateway Error Handling

## 1. Safe Global Logging & Error Serialization
- Saat meng-override atau membungkus `console.log` / `console.error` untuk in-memory log buffer atau log aggregator, **JANGAN PERNAH** memanggil `JSON.stringify` secara naif tanpa `try-catch` atau circular-reference handler.
- Objek `Error` atau response object dari pustaka HTTP (Axios, Fetch, Midtrans, Baileys) sering kali memiliki circular reference (`req` -> `res` -> `req`) yang akan melempar `TypeError: Converting circular structure to JSON` jika di-stringify secara langsung.
- Selalu prioritaskan `err.stack` atau `err.message` saat memproses `instanceof Error`, dan gunakan weak set atau fallback circular detection saat memproses object.

## 2. Resilient Payment & Third-Party API Handling
- Handler endpoint pembayaran harus selalu mengembalikan format JSON yang konsisten, bahkan saat terjadi kesalahan fatal (status 400/500), jangan biarkan server Express mengembalikan default error HTML.
- Frontend `fetch` handler harus memeriksa status respons dan mem-parse secara defensif (memiliki fallback jika respons bukan JSON) agar pesan kesalahan informatif dan dapat ditindaklanjuti oleh pengguna (misalnya deteksi error 401 autentikasi Midtrans).
