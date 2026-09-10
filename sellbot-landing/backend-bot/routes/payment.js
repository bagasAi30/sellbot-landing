const express = require('express');
const router = express.Router();
const midtransClient = require('midtrans-client');
const { createClient } = require('@supabase/supabase-js');

// Inisialisasi Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
}

// Inisialisasi Midtrans Snap Helper
function getSnapClient() {
    const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
    const clientKey = process.env.MIDTRANS_CLIENT_KEY || '';
    const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';

    return new midtransClient.Snap({
        isProduction,
        serverKey,
        clientKey
    });
}

// Map paket ke harga dan kredit
const PLAN_DETAILS = {
    'Starter': { price: 49000, credits: 3000 },
    'Pro': { price: 99000, credits: 8000 },
    'Basic': { price: 99000, credits: 8000 },
    'Business': { price: 199000, credits: 20000 }
};

// GET /api/payment/config
// Mengambil client key & environment mode untuk frontend
router.get('/config', (req, res) => {
    res.json({
        success: true,
        clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
        isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
        isConfigured: Boolean(process.env.MIDTRANS_SERVER_KEY && process.env.MIDTRANS_CLIENT_KEY)
    });
});

// POST /api/payment/create
// Membuat transaksi Snap dan mengembalikan Snap Token ke Frontend
router.post('/create', async (req, res) => {
    try {
        const serverKey = process.env.MIDTRANS_SERVER_KEY;
        const clientKey = process.env.MIDTRANS_CLIENT_KEY;

        if (!serverKey || !clientKey) {
            return res.status(400).json({
                success: false,
                message: 'Kredensial Midtrans belum dikonfigurasi. Mohon isi MIDTRANS_SERVER_KEY dan MIDTRANS_CLIENT_KEY di Environment Variables Coolify.'
            });
        }

        const { plan, userId, email, name, phone, paymentMethod } = req.body;

        if (!plan || !PLAN_DETAILS[plan]) {
            return res.status(400).json({
                success: false,
                message: `Paket tidak valid. Pilihan yang tersedia: ${Object.keys(PLAN_DETAILS).join(', ')}`
            });
        }

        const planDetail = PLAN_DETAILS[plan];
        const orderId = `ORDER-${userId ? userId.substring(0, 8) : 'GUEST'}-${Date.now()}`;

        // 1. Simpan history transaksi status PENDING di Supabase invoices jika supabase tersedia
        if (supabase && userId) {
            try {
                await supabase
                    .from('invoices')
                    .insert([{
                        id: orderId,
                        user_id: userId,
                        plan_name: plan,
                        amount: planDetail.price,
                        credits_added: planDetail.credits,
                        status: 'pending',
                        payment_method: paymentMethod || 'midtrans',
                        created_at: new Date().toISOString()
                    }]);
            } catch (dbErr) {
                console.warn('⚠️ Gagal menyimpan pending invoice ke Supabase (tabel mungkin belum dibuat):', dbErr.message);
            }
        }

        // 2. Minta Token Snap ke Midtrans
        const snap = getSnapClient();
        const parameter = {
            transaction_details: {
                order_id: orderId,
                gross_amount: planDetail.price
            },
            credit_card: {
                secure: true
            },
            customer_details: {
                first_name: name || 'Pengguna AsistenLapak',
                email: email || 'user@asistenlapakai.my.id',
                phone: phone || ''
            },
            item_details: [
                {
                    id: plan.toLowerCase(),
                    price: planDetail.price,
                    quantity: 1,
                    name: `Paket AI ${plan} (${planDetail.credits.toLocaleString('id-ID')} Kredit)`
                }
            ]
        };

        const transaction = await snap.createTransaction(parameter);

        res.json({
            success: true,
            token: transaction.token,
            redirect_url: transaction.redirect_url,
            orderId
        });

    } catch (error) {
        console.error('🔥 Midtrans Create Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Terjadi kesalahan saat memproses transaksi pembayaran.'
        });
    }
});

// POST /api/payment/webhook
// Dipanggil oleh server Midtrans untuk update status transaksi secara real-time
router.post('/webhook', async (req, res) => {
    try {
        const notificationJson = req.body;
        const snap = getSnapClient();

        // Verifikasi dan baca notifikasi dari Midtrans
        const statusResponse = await snap.transaction.notification(notificationJson);

        const orderId = statusResponse.order_id;
        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;

        console.log(`🔔 Notifikasi Midtrans: Order ${orderId} | Status: ${transactionStatus} | Fraud: ${fraudStatus}`);

        let newStatus = 'pending';
        if (transactionStatus === 'capture') {
            if (fraudStatus === 'challenge') {
                newStatus = 'challenge';
            } else if (fraudStatus === 'accept') {
                newStatus = 'success';
            }
        } else if (transactionStatus === 'settlement') {
            newStatus = 'success';
        } else if (['cancel', 'deny', 'expire'].includes(transactionStatus)) {
            newStatus = 'failed';
        } else if (transactionStatus === 'pending') {
            newStatus = 'pending';
        }

        if (supabase) {
            // Update status invoice
            try {
                const { data: invoice } = await supabase
                    .from('invoices')
                    .select('*')
                    .eq('id', orderId)
                    .maybeSingle();

                if (invoice) {
                    await supabase
                        .from('invoices')
                        .update({
                            status: newStatus,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', orderId);

                    // Jika sukses dan belum diproses sebelumnya, update profile atau info paket user
                    if (newStatus === 'success' && invoice.status !== 'success') {
                        console.log(`✅ Pembayaran Order ${orderId} SUKSES! User ${invoice.user_id} mendapat kredit ${invoice.credits_added}.`);
                    }
                }
            } catch (dbErr) {
                console.warn('⚠️ Gagal update status invoice di Supabase:', dbErr.message);
            }
        }

        res.status(200).json({ status: 'OK', newStatus });
    } catch (error) {
        console.error('🔥 Midtrans Webhook Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

module.exports = router;
