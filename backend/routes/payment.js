const express = require('express');
const router = express.Router();
const midtransClient = require('midtrans-client');
const { createClient } = require('@supabase/supabase-js');

// Setup Midtrans
const snap = new midtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY
});

// Setup Supabase (menggunakan Service Key untuk bypass RLS jika diperlukan)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Map paket ke harga dan kredit
const PLAN_DETAILS = {
    'Starter': { price: 49000, credits: 3000 },
    'Basic': { price: 99000, credits: 8000 },
    'Pro': { price: 199000, credits: 20000 }
};

// POST /api/payment/create
// Endpoint untuk dipanggil dari Frontend saat user klik "Beli"
router.post('/create', async (req, res) => {
    try {
        const { plan, userId, email, name, phone } = req.body;

        if (!PLAN_DETAILS[plan]) {
            return res.status(400).json({ success: false, message: 'Paket tidak valid' });
        }

        const planDetail = PLAN_DETAILS[plan];
        const orderId = `ORDER-${userId}-${Date.now()}`;

        // 1. Simpan history transaksi status PENDING di Supabase invoices
        const { error: dbError } = await supabase
            .from('invoices')
            .insert({
                id: orderId,
                user_id: userId,
                plan_name: plan,
                amount: planDetail.price,
                credits_added: planDetail.credits,
                status: 'pending',
                created_at: new Date()
            });

        if (dbError) throw dbError;

        // 2. Minta Token Snap ke Midtrans
        const parameter = {
            transaction_details: {
                order_id: orderId,
                gross_amount: planDetail.price
            },
            credit_card: {
                secure: true
            },
            customer_details: {
                first_name: name || 'User',
                email: email,
                phone: phone || ''
            }
        };

        const transaction = await snap.createTransaction(parameter);

        // 3. Kembalikan token ke Frontend
        res.json({
            success: true,
            token: transaction.token,
            redirect_url: transaction.redirect_url
        });

    } catch (error) {
        console.error('Midtrans Create Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/payment/webhook
// Endpoint ini dipanggil otomatis oleh Midtrans saat pembayaran berhasil/gagal
router.post('/webhook', async (req, res) => {
    try {
        const notificationJson = req.body;

        // Proses notifikasi (verifikasi signature dilakukan oleh SDK Midtrans secara internal jika dipanggil lewat snap.transaction.notification)
        const statusResponse = await snap.transaction.notification(notificationJson);

        const orderId = statusResponse.order_id;
        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;

        console.log(`Transaction notification received. Order ID: ${orderId}. Transaction status: ${transactionStatus}. Fraud status: ${fraudStatus}`);

        // Ambil data invoice dari database
        const { data: invoice, error: fetchError } = await supabase
            .from('invoices')
            .select('*')
            .eq('id', orderId)
            .single();

        if (fetchError || !invoice) {
            console.error('Invoice not found:', orderId);
            return res.status(404).json({ message: 'Invoice not found' });
        }

        // Jika invoice sudah success, jangan proses ulang
        if (invoice.status === 'success') {
            return res.status(200).json({ message: 'Already processed' });
        }

        let newStatus = invoice.status;

        if (transactionStatus == 'capture') {
            if (fraudStatus == 'challenge') {
                newStatus = 'challenge';
            } else if (fraudStatus == 'accept') {
                newStatus = 'success';
            }
        } else if (transactionStatus == 'settlement') {
            newStatus = 'success';
        } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire') {
            newStatus = 'failed';
        } else if (transactionStatus == 'pending') {
            newStatus = 'pending';
        }

        // Update status invoice
        const { error: updateError } = await supabase
            .from('invoices')
            .update({ status: newStatus, updated_at: new Date() })
            .eq('id', orderId);

        if (updateError) throw updateError;

        // Jika berhasil, tambahkan kredit ke user
        if (newStatus === 'success') {
            // Ambil profil user saat ini untuk melihat jumlah free_chats
            const { data: userProfile } = await supabase
                .from('profiles')
                .select('free_chats')
                .eq('id', invoice.user_id)
                .single();

            const currentChats = userProfile ? (userProfile.free_chats || 0) : 0;
            const newChatsBalance = currentChats + invoice.credits_added;

            // Update kredit dan paket di profile
            await supabase
                .from('profiles')
                .update({ 
                    free_chats: newChatsBalance,
                    plan: invoice.plan_name
                })
                .eq('id', invoice.user_id);
                
            console.log(`User ${invoice.user_id} credits updated to ${newChatsBalance}`);
        }

        res.status(200).json({ message: 'OK' });
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

module.exports = router;
