// admin.js — Logic untuk Admin Dashboard (Super Admin)

document.addEventListener('DOMContentLoaded', () => {

    // ============================================
    // 1. NAVIGASI SIDEBAR
    // ============================================
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item[data-target]');
    const sections = document.querySelectorAll('.dashboard-section');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            sections.forEach(s => s.classList.remove('active'));
            const targetId = item.getAttribute('data-target');
            const targetSection = document.getElementById(targetId);
            if (targetSection) targetSection.classList.add('active');
        });
    });

    // ============================================
    // 0. FETCH USERS FROM BACKEND
    // ============================================
    async function fetchUsers() {
        try {
            const res = await fetch('http://localhost:3001/api/admin/users');
            if (!res.ok) throw new Error('Failed to fetch users');
            const users = await res.json();

            const recentBody = document.getElementById('recentUsersBody');
            const allBody = document.getElementById('allUsersBody');

            if (recentBody) recentBody.innerHTML = '';
            if (allBody) allBody.innerHTML = '';

            users.forEach((u, i) => {
                const date = new Date(u.created_at).toLocaleDateString('id-ID');
                const rowHTML = `
                    <tr>
                        <td><strong>Tenant ${i + 1}</strong><br><span style="font-size:12px;color:var(--text-secondary);">${u.email}</span></td>
                        <td><span class="tag tag-${u.user_metadata?.plan || 'pro'}">${(u.user_metadata?.plan || 'pro').toUpperCase()} Plan</span></td>
                        <td><span class="status-badge closed">${u.user_metadata?.status || 'Active'}</span></td>
                        <td>${date}</td>
                        <td><button class="btn btn-outline btn-small" onclick="handleEditUser(this, '${u.id}', '${u.user_metadata?.plan || 'pro'}', '${u.user_metadata?.status || 'active'}')">Manage</button></td>
                    </tr>
                `;
                const allRowHTML = `
                    <tr>
                        <td><strong>Tenant ${i + 1}</strong></td>
                        <td>-</td>
                        <td>${u.email}</td>
                        <td><span class="tag tag-${u.user_metadata?.plan || 'pro'}">${(u.user_metadata?.plan || 'pro').toUpperCase()} Plan</span></td>
                        <td><span class="status-badge closed">${u.user_metadata?.status || 'Active'}</span></td>
                        <td><button class="btn btn-outline btn-small" onclick="handleEditUser(this, '${u.id}', '${u.user_metadata?.plan || 'pro'}', '${u.user_metadata?.status || 'active'}')">Edit</button></td>
                    </tr>
                `;
                if (recentBody && i < 5) recentBody.innerHTML += rowHTML;
                if (allBody) allBody.innerHTML += allRowHTML;
            });
        } catch (err) {
            console.error('Error fetching users:', err);
        }
    }

    fetchUsers();

    // ============================================
    // 2. TOAST NOTIFICATION
    // ============================================
    window.showToast = function (message, type = 'success') {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        let icon = 'ph-check-circle';
        if (type === 'error') icon = 'ph-warning-circle';
        if (type === 'info') icon = 'ph-info';
        toast.innerHTML = `<i class="ph-fill ${icon}"></i> <span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3500);
    };

    // ============================================
    // 3. MODAL SYSTEM
    // ============================================
    window.openModal = function (id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('active');
    };
    window.closeModal = function (id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('active');
    };

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });

    // ============================================
    // 4. SEND BROADCAST
    // ============================================
    const btnBroadcast = document.getElementById('btnSendBroadcast');
    if (btnBroadcast) {
        btnBroadcast.addEventListener('click', () => openModal('broadcastModal'));
    }

    const btnConfirmBroadcast = document.getElementById('btnConfirmBroadcast');
    if (btnConfirmBroadcast) {
        btnConfirmBroadcast.addEventListener('click', () => {
            const message = document.getElementById('broadcastMessage')?.value?.trim();
            if (!message) { showToast('Pesan broadcast tidak boleh kosong', 'error'); return; }
            const origText = btnConfirmBroadcast.innerHTML;
            btnConfirmBroadcast.innerHTML = '<i class="ph ph-circle-notch"></i> Mengirim...';
            btnConfirmBroadcast.disabled = true;
            btnConfirmBroadcast.disabled = true;
            fetch('http://localhost:3001/api/admin/broadcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            })
                .then(r => r.json())
                .then(data => {
                    showToast(data.message || 'Broadcast berhasil dikirim ke semua tenant aktif!', 'success');
                    closeModal('broadcastModal');
                    document.getElementById('broadcastMessage').value = '';
                })
                .catch(err => {
                    showToast('Gagal mengirim broadcast', 'error');
                })
                .finally(() => {
                    btnConfirmBroadcast.innerHTML = origText;
                    btnConfirmBroadcast.disabled = false;
                });
        });
    }

    // ============================================
    // 5. ADD CUSTOMER
    // ============================================
    const btnAddCustomer = document.getElementById('btnAddCustomer');
    if (btnAddCustomer) {
        btnAddCustomer.addEventListener('click', () => openModal('addCustomerModal'));
    }

    const btnSaveCustomer = document.getElementById('btnSaveCustomer');
    if (btnSaveCustomer) {
        btnSaveCustomer.addEventListener('click', () => {
            const name = document.getElementById('newCustomerName')?.value?.trim();
            const store = document.getElementById('newStoreName')?.value?.trim();
            const email = document.getElementById('newCustomerEmail')?.value?.trim();
            if (!name || !store || !email) { showToast('Harap isi semua field wajib', 'error'); return; }
            const origText = btnSaveCustomer.innerHTML;
            btnSaveCustomer.innerHTML = '<i class="ph ph-circle-notch"></i> Menyimpan...';
            btnSaveCustomer.disabled = true;
            btnSaveCustomer.disabled = true;

            fetch('http://localhost:3001/api/admin/add-customer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password: 'password123' }) // Default password
            })
                .then(r => r.json())
                .then(data => {
                    if (data.error) throw new Error(data.error);
                    showToast(`Customer "${name}" berhasil ditambahkan!`, 'success');
                    closeModal('addCustomerModal');
                    fetchUsers(); // Refresh tabel
                })
                .catch(err => {
                    showToast('Gagal: ' + err.message, 'error');
                })
                .finally(() => {
                    btnSaveCustomer.innerHTML = origText;
                    btnSaveCustomer.disabled = false;
                });
        });
    }

    // ============================================
    // 6. VIEW SERVER LOGS
    // ============================================
    const btnViewLogs = document.getElementById('btnViewLogs');
    if (btnViewLogs) {
        btnViewLogs.addEventListener('click', () => {
            const logArea = document.getElementById('serverLogsContent');
            if (logArea) {
                const now = new Date().toISOString();
                logArea.textContent = [
                    `[${now}] INFO  Server started on port 3000`,
                    `[${now}] INFO  WhatsApp Bot connected`,
                    `[${now}] INFO  DB connection established`,
                    `[${now}] INFO  GET /api/health → 200 OK (2ms)`,
                    `[${now}] INFO  POST /api/bot/start → 200 OK (145ms)`,
                    `[${now}] WARN  Supabase RLS blocked insert for user 55089ac5`,
                    `[${now}] INFO  AI response generated in 842ms`,
                    `[${now}] INFO  Shipping: Tambaksari → JNE REG Rp 21.000`,
                    `[${now}] INFO  GET /api/bot/status → 200 CONNECTED`,
                ].join('\n');
            }
            openModal('serverLogsModal');
        });
    }

    // ============================================
    // 7. MANAGE / EDIT USER
    // ============================================
    window.handleManageUser = function (btn) {
        const row = btn.closest('tr');
        const storeName = row?.querySelector('td:first-child strong')?.innerText || '';
        const planEl = document.getElementById('editUserPlan');
        const nameEl = document.getElementById('editUserStoreName');
        if (nameEl) nameEl.value = storeName;
        if (planEl) planEl.value = 'pro';
        openModal('editUserModal');
    };

    window.handleEditUser = function (btn, userId, plan, status) {
        const row = btn.closest('tr');
        const name = row?.querySelector('td:nth-child(3)')?.innerText || row?.querySelector('td:first-child strong')?.innerText || '';
        const nameEl = document.getElementById('editUserStoreName');
        const planEl = document.getElementById('editUserPlan');
        const statusEl = document.getElementById('editUserStatus');
        const idEl = document.getElementById('editUserId');

        if (nameEl) nameEl.value = name;
        if (planEl) planEl.value = plan || 'pro';
        if (statusEl) statusEl.value = status || 'active';
        if (idEl) idEl.value = userId;

        openModal('editUserModal');
    };

    const btnSaveEditUser = document.getElementById('btnSaveEditUser');
    if (btnSaveEditUser) {
        btnSaveEditUser.addEventListener('click', () => {
            const userId = document.getElementById('editUserId')?.value;
            const plan = document.getElementById('editUserPlan')?.value;
            const status = document.getElementById('editUserStatus')?.value;

            if (!userId) {
                showToast('User ID tidak ditemukan', 'error');
                return;
            }

            const origText = btnSaveEditUser.innerHTML;
            btnSaveEditUser.innerHTML = '<i class="ph ph-circle-notch"></i> Menyimpan...';
            btnSaveEditUser.disabled = true;

            fetch('http://localhost:3001/api/admin/edit-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, plan, status })
            })
                .then(r => r.json())
                .then(data => {
                    if (data.error) throw new Error(data.error);
                    showToast('Data user berhasil diperbarui!', 'success');
                    closeModal('editUserModal');
                    fetchUsers(); // Refresh tabel
                })
                .catch(err => {
                    showToast('Gagal: ' + err.message, 'error');
                })
                .finally(() => {
                    btnSaveEditUser.innerHTML = origText;
                    btnSaveEditUser.disabled = false;
                });
        });
    }

    // ============================================
    // 8. ACTIVATE SUSPENDED USER
    // ============================================
    window.handleActivateUser = function (btn) {
        const row = btn.closest('tr');
        const statusEl = row?.querySelector('.status-badge');
        btn.innerHTML = '<i class="ph ph-circle-notch"></i>';
        btn.disabled = true;
        setTimeout(() => {
            if (statusEl) { statusEl.textContent = 'Active'; statusEl.className = 'status-badge closed'; }
            btn.innerHTML = 'Edit';
            btn.disabled = false;
            btn.onclick = null;
            btn.addEventListener('click', () => handleEditUser(btn));
            showToast('User berhasil diaktifkan kembali!', 'success');
        }, 800);
    };

    // ============================================
    // 9. EXPORT CSV
    // ============================================
    const btnExportCsv = document.getElementById('btnExportCsv');
    if (btnExportCsv) {
        btnExportCsv.addEventListener('click', () => {
            const headers = ['Invoice ID', 'Store Name', 'Amount', 'Method', 'Status'];
            const rows = [
                ['INV-2023-089', 'Toko Baju Kekinian', 'Rp 350000', 'Bank Transfer', 'Paid'],
                ['INV-2023-088', 'Gadget Store Jkt', 'Rp 150000', 'QRIS', 'Paid'],
                ['INV-2023-087', 'Aksesoris Cantik', 'Rp 150000', 'Credit Card', 'Pending'],
            ];
            const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `revenue_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('CSV berhasil didownload!', 'success');
        });
    }

    // ============================================
    // 10. SAVE CONFIGURATION
    // ============================================
    const btnSaveConfig = document.getElementById('btnSaveConfig');
    if (btnSaveConfig) {
        btnSaveConfig.addEventListener('click', () => {
            const origText = btnSaveConfig.innerHTML;
            btnSaveConfig.innerHTML = '<i class="ph ph-circle-notch"></i> Menyimpan...';
            btnSaveConfig.disabled = true;
            const apiKey = document.querySelector('#settings input[type="password"]')?.value;
            const wabaId = document.querySelector('#settings input[type="text"]')?.value;
            const trialDays = document.querySelector('#settings input[type="number"]')?.value;
            const maintenance = document.querySelector('#settings input[type="checkbox"]')?.checked;
            if (apiKey) localStorage.setItem('admin_openai_key', apiKey);
            if (wabaId) localStorage.setItem('admin_waba_id', wabaId);
            if (trialDays) localStorage.setItem('admin_trial_days', trialDays);
            if (maintenance !== undefined) localStorage.setItem('admin_maintenance', maintenance);
            setTimeout(() => {
                showToast('Konfigurasi global berhasil disimpan!', 'success');
                btnSaveConfig.innerHTML = origText;
                btnSaveConfig.disabled = false;
            }, 800);
        });
    }

    // ============================================
    // 11. SEARCH FILTER — User Management
    // ============================================
    const userSearch = document.querySelector('#users input[type="text"]');
    if (userSearch) {
        userSearch.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('#users tbody tr').forEach(row => {
                row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none';
            });
        });
    }

    // ============================================
    // 12. ATTACH EVENTS KE TOMBOL EXISTING DI HTML
    // ============================================
    document.querySelectorAll('#overview tbody .btn-small').forEach(btn => {
        btn.addEventListener('click', () => handleManageUser(btn));
    });

    document.querySelectorAll('#users tbody .btn-small').forEach(btn => {
        const text = btn.textContent.trim();
        if (text === 'Edit') btn.addEventListener('click', () => handleEditUser(btn));
        else if (text === 'Activate') btn.addEventListener('click', () => handleActivateUser(btn));
    });

});
