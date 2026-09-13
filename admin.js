// admin.js — Logic untuk Admin Dashboard (Super Admin) dengan Data Riil

document.addEventListener('DOMContentLoaded', () => {

    // Format mata uang Rupiah
    function formatRupiah(amount) {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount || 0);
    }

    // State transaksi terbaru untuk ekspor CSV
    let cachedTransactions = [];

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
            if (targetSection) {
                targetSection.classList.add('active');
                // Auto refresh data saat membuka tab tertentu
                if (targetId === 'revenue') fetchRevenueData();
                if (targetId === 'health') fetchSystemHealth();
                if (targetId === 'settings') loadPlatformSettings();
            }
        });
    });

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
    // 4. OVERVIEW STATS (DATA RIIL)
    // ============================================
    async function fetchOverviewStats() {
        try {
            const res = await fetch('/api/admin/stats');
            if (!res.ok) throw new Error('Gagal mengambil statistik server');
            const data = await res.json();

            const statCustomers = document.getElementById('statActiveCustomers');
            const statRevenue = document.getElementById('statMonthlyRev');
            const statChats = document.getElementById('statTotalMessages');
            const statUptime = document.getElementById('statSystemUptime');

            if (statCustomers) statCustomers.textContent = `${data.totalUsers || 0} Tenant`;
            if (statRevenue) statRevenue.textContent = formatRupiah(data.totalRevenue || 0);
            if (statChats) statChats.textContent = (data.totalChats || 0).toLocaleString('id-ID');
            if (statUptime) statUptime.textContent = data.uptimeStr || 'Online';
        } catch (err) {
            console.error('Error overview stats:', err);
        }
    }

    // ============================================
    // 5. FETCH USERS (DATA RIIL)
    // ============================================
    async function fetchUsers() {
        const recentBody = document.getElementById('recentUsersBody');
        const allBody = document.getElementById('allUsersBody');

        try {
            const res = await fetch('/api/admin/users');
            if (!res.ok) throw new Error('Failed to fetch users');
            const users = await res.json();

            if (recentBody) recentBody.innerHTML = '';
            if (allBody) allBody.innerHTML = '';

            if (!users || users.length === 0) {
                const emptyHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:24px;">Belum ada pengguna terdaftar</td></tr>`;
                if (recentBody) recentBody.innerHTML = emptyHTML;
                if (allBody) allBody.innerHTML = emptyHTML;
                return;
            }

            // Urutkan berdasarkan created_at descending (terbaru)
            users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            users.forEach((u, i) => {
                const meta = u.user_metadata || {};
                const storeName = meta.store_name || meta.name || ('Toko ' + u.email.split('@')[0]);
                const customerName = meta.name || u.email.split('@')[0];
                const phone = meta.phone || '-';
                const plan = (meta.plan || 'trial').toLowerCase();
                const status = (meta.status || 'active').toLowerCase();
                const date = u.created_at ? new Date(u.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

                const statusClass = status === 'active' ? 'closed' : (status === 'suspended' ? 'error' : 'human');

                // Baris ringkas untuk tab Overview (Recent Registrations)
                if (recentBody && i < 5) {
                    const rowRecent = document.createElement('tr');
                    rowRecent.innerHTML = `
                        <td><strong>${storeName}</strong><br><span style="font-size:12px;color:var(--text-secondary);">${u.email}</span></td>
                        <td><span class="tag tag-${plan}">${plan.toUpperCase()}</span></td>
                        <td><span class="status-badge ${statusClass}">${status.toUpperCase()}</span></td>
                        <td>${date}</td>
                        <td><button class="btn btn-outline btn-small" onclick="handleEditUser('${u.id}', '${encodeURIComponent(storeName)}', '${plan}', '${status}')">Manage</button></td>
                    `;
                    recentBody.appendChild(rowRecent);
                }

                // Baris lengkap untuk tab User Management
                if (allBody) {
                    const rowAll = document.createElement('tr');
                    rowAll.innerHTML = `
                        <td><strong>${customerName}</strong><br><span style="font-size:12px;color:var(--text-secondary);">${u.email}</span></td>
                        <td>${phone}</td>
                        <td>${storeName}</td>
                        <td><span class="tag tag-${plan}">${plan.toUpperCase()}</span></td>
                        <td><span class="status-badge ${statusClass}">${status.toUpperCase()}</span></td>
                        <td>
                            <div style="display:flex;gap:6px;">
                                <button class="btn btn-outline btn-small" onclick="handleEditUser('${u.id}', '${encodeURIComponent(storeName)}', '${plan}', '${status}')">Edit</button>
                                <button class="btn btn-outline btn-small" style="color:#ef4444;border-color:rgba(239,68,68,0.3);" onclick="handleDeleteUser('${u.id}', '${encodeURIComponent(storeName)}')">Hapus</button>
                            </div>
                        </td>
                    `;
                    allBody.appendChild(rowAll);
                }
            });
        } catch (err) {
            console.error('Error fetching users:', err);
            const errorHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:20px;">Gagal memuat pengguna: ${err.message}</td></tr>`;
            if (recentBody) recentBody.innerHTML = errorHTML;
            if (allBody) allBody.innerHTML = errorHTML;
        }
    }

    // ============================================
    // 6. REVENUE & BILLING (DATA RIIL)
    // ============================================
    async function fetchRevenueData() {
        const tableBody = document.getElementById('revenueTableBody');
        const statRev = document.getElementById('statRevTotal');
        const statSubs = document.getElementById('statRevSubs');
        const statPending = document.getElementById('statRevPending');

        try {
            const res = await fetch('/api/admin/revenue');
            if (!res.ok) throw new Error('Gagal memuat data transaksi');
            const data = await res.json();

            cachedTransactions = data.transactions || [];

            if (statRev) statRev.textContent = formatRupiah(data.totalRevenue || 0);
            if (statSubs) statSubs.textContent = `${data.activeSubs || 0}`;
            if (statPending) statPending.textContent = `${data.pendingInvoices || 0} (${formatRupiah(data.pendingAmount || 0)})`;

            if (tableBody) {
                tableBody.innerHTML = '';
                if (cachedTransactions.length === 0) {
                    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:24px;">Belum ada catatan transaksi</td></tr>`;
                    return;
                }

                cachedTransactions.forEach(t => {
                    const st = (t.status || 'pending').toLowerCase();
                    const statusClass = (st === 'paid' || st === 'settlement' || st === 'success') ? 'closed' : (st === 'pending' ? 'human' : 'error');
                    const dateStr = t.date ? new Date(t.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td><strong>${t.id}</strong><br><span style="font-size:11px;color:var(--text-secondary);">${dateStr}</span></td>
                        <td>${t.storeName}<br><span style="font-size:12px;color:var(--text-secondary);">${t.email || '-'}</span></td>
                        <td><strong>${formatRupiah(t.amount)}</strong></td>
                        <td><span class="tag">${t.method}</span></td>
                        <td><span class="status-badge ${statusClass}">${st.toUpperCase()}</span></td>
                    `;
                    tableBody.appendChild(row);
                });
            }
        } catch (err) {
            console.error('Error loading revenue:', err);
            if (tableBody) tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;padding:20px;">Gagal memuat transaksi: ${err.message}</td></tr>`;
        }
    }

    // ============================================
    // 7. EXPORT CSV RIIL
    // ============================================
    const btnExportCsv = document.getElementById('btnExportCsv');
    if (btnExportCsv) {
        btnExportCsv.addEventListener('click', () => {
            if (!cachedTransactions || cachedTransactions.length === 0) {
                showToast('Tidak ada data transaksi untuk diekspor', 'info');
                return;
            }

            const headers = ['Invoice ID', 'Store / Customer', 'Email', 'Amount (IDR)', 'Method', 'Status', 'Date'];
            const rows = cachedTransactions.map(t => [
                `"${t.id}"`,
                `"${(t.storeName || '').replace(/"/g, '""')}"`,
                `"${t.email || '-'}"`,
                t.amount || 0,
                `"${t.method || 'QRIS'}"`,
                `"${(t.status || 'pending').toUpperCase()}"`,
                `"${t.date || '-'}"`
            ]);

            const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `laporan_transaksi_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Laporan CSV berhasil diunduh!', 'success');
        });
    }

    // ============================================
    // 8. SYSTEM HEALTH & MONITORING (DATA RIIL)
    // ============================================
    async function fetchSystemHealth() {
        const badge = document.getElementById('healthOverallBadge');
        const cpuEl = document.getElementById('statHealthCpu');
        const ramEl = document.getElementById('statHealthRam');
        const botEl = document.getElementById('statHealthBots');
        const listEl = document.getElementById('microservicesList');

        try {
            const res = await fetch('/api/admin/health');
            if (!res.ok) throw new Error('Gagal memeriksa kesehatan server');
            const data = await res.json();

            if (cpuEl) cpuEl.textContent = `${data.os.cpuPercent}%`;
            if (ramEl) ramEl.textContent = `${data.os.ramPercent}% (${data.os.usedMemMB}MB / ${data.os.totalMemMB}MB)`;
            if (botEl) botEl.textContent = `${data.services.whatsapp.connectedSessions} Aktif (${data.services.whatsapp.totalSessions} Total)`;

            const isDbOk = data.services.database.status === 'Operational';
            if (badge) {
                badge.className = isDbOk ? 'status-badge closed' : 'status-badge error';
                badge.innerHTML = isDbOk ? '<i class="ph-fill ph-check-circle"></i> Seluruh Sistem Berjalan Normal' : '<i class="ph-fill ph-warning-circle"></i> Sistem Mengalami Penurunan Performa';
            }

            if (listEl) {
                listEl.innerHTML = `
                    <div class="setting-item">
                        <span class="setting-label">WhatsApp Baileys Gateway</span>
                        <span class="setting-value" style="color: ${data.services.whatsapp.connectedSessions > 0 ? 'var(--success)' : '#FBBF24'};">
                            <i class="ph-fill ${data.services.whatsapp.connectedSessions > 0 ? 'ph-check-circle' : 'ph-clock'}"></i>
                            ${data.services.whatsapp.status} (${data.services.whatsapp.connectedSessions} sesi terhubung)
                        </span>
                    </div>
                    <div class="setting-item">
                        <span class="setting-label">AI Engine (Gemini & Groq)</span>
                        <span class="setting-value" style="color: var(--success);">
                            <i class="ph-fill ph-check-circle"></i>
                            ${data.services.ai.status} (${(data.services.ai.models || []).join(', ') || 'Ready'})
                        </span>
                    </div>
                    <div class="setting-item">
                        <span class="setting-label">Supabase Database Cluster</span>
                        <span class="setting-value" style="color: ${isDbOk ? 'var(--success)' : '#ef4444'};">
                            <i class="ph-fill ${isDbOk ? 'ph-check-circle' : 'ph-warning-circle'}"></i>
                            ${data.services.database.status} (${data.services.database.latencyMs}ms latency)
                        </span>
                    </div>
                    <div class="setting-item">
                        <span class="setting-label">Payment Gateway (Midtrans)</span>
                        <span class="setting-value" style="color: var(--success);">
                            <i class="ph-fill ph-check-circle"></i>
                            ${data.services.payment.status} (${data.services.payment.mode} Mode)
                        </span>
                    </div>
                    <div class="setting-item">
                        <span class="setting-label">Node.js Heap & Host OS</span>
                        <span class="setting-value" style="color: var(--text-secondary);">
                            Heap: ${data.os.nodeHeapUsedMB}MB | OS: ${data.os.platform} (${data.os.arch}, ${data.os.cpuCount} Core)
                        </span>
                    </div>
                `;
            }
        } catch (err) {
            console.error('Error fetching health:', err);
            if (badge) {
                badge.className = 'status-badge error';
                badge.innerHTML = `<i class="ph-fill ph-warning-circle"></i> Gagal terhubung ke server backend`;
            }
        }
    }

    // ============================================
    // 9. SERVER LOGS RIIL
    // ============================================
    async function fetchServerLogs() {
        const logArea = document.getElementById('serverLogsContent');
        if (!logArea) return;

        try {
            const res = await fetch('/api/admin/logs');
            if (!res.ok) throw new Error('Gagal memuat log');
            const data = await res.json();

            if (!data.logs || data.logs.length === 0) {
                logArea.textContent = '[INFO] Belum ada rekaman log baru.';
                return;
            }

            const formatted = data.logs.map(l => {
                const time = l.timestamp ? new Date(l.timestamp).toLocaleTimeString('id-ID') : '';
                return `[${time}] [${l.level}] ${l.message}`;
            }).join('\n');

            logArea.textContent = formatted;
            logArea.scrollTop = logArea.scrollHeight;
        } catch (err) {
            logArea.textContent = `[ERROR] Gagal memuat log: ${err.message}`;
        }
    }

    const btnViewLogs = document.getElementById('btnViewLogs');
    if (btnViewLogs) {
        btnViewLogs.addEventListener('click', () => {
            openModal('serverLogsModal');
            fetchServerLogs();
        });
    }

    const btnRefreshLogs = document.getElementById('btnRefreshServerLogs');
    if (btnRefreshLogs) {
        btnRefreshLogs.addEventListener('click', () => {
            fetchServerLogs();
            showToast('Log server disegarkan', 'info');
        });
    }

    // ============================================
    // 10. GLOBAL SETTINGS (PERSISTEN KE FILE)
    // ============================================
    async function loadPlatformSettings() {
        try {
            const res = await fetch('/api/admin/settings');
            if (!res.ok) throw new Error('Gagal memuat konfigurasi');
            const cfg = await res.json();

            const keyInput = document.getElementById('settingMasterAiKey');
            const wabaInput = document.getElementById('settingWabaId');
            const trialInput = document.getElementById('settingTrialDays');
            const maintInput = document.getElementById('settingMaintenanceMode');

            if (keyInput && cfg.masterAiKey) keyInput.value = cfg.masterAiKey;
            if (wabaInput && cfg.wabaId) wabaInput.value = cfg.wabaId;
            if (trialInput && cfg.defaultTrialDays !== undefined) trialInput.value = cfg.defaultTrialDays;
            if (maintInput && cfg.maintenanceMode !== undefined) maintInput.checked = !!cfg.maintenanceMode;
        } catch (err) {
            console.error('Error loading settings:', err);
        }
    }

    const btnSaveConfig = document.getElementById('btnSaveConfig');
    if (btnSaveConfig) {
        btnSaveConfig.addEventListener('click', async () => {
            const origText = btnSaveConfig.innerHTML;
            btnSaveConfig.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Menyimpan...';
            btnSaveConfig.disabled = true;

            const masterAiKey = document.getElementById('settingMasterAiKey')?.value?.trim();
            const wabaId = document.getElementById('settingWabaId')?.value?.trim();
            const defaultTrialDays = Number(document.getElementById('settingTrialDays')?.value || 14);
            const maintenanceMode = document.getElementById('settingMaintenanceMode')?.checked || false;

            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ masterAiKey, wabaId, defaultTrialDays, maintenanceMode })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Gagal menyimpan pengaturan');
                showToast(data.message || 'Konfigurasi platform berhasil disimpan!', 'success');
            } catch (err) {
                showToast(err.message, 'error');
            } finally {
                btnSaveConfig.innerHTML = origText;
                btnSaveConfig.disabled = false;
            }
        });
    }

    // ============================================
    // 11. MANAGE / EDIT / DELETE USER
    // ============================================
    window.handleEditUser = function (userId, storeNameEncoded, plan, status) {
        const storeName = decodeURIComponent(storeNameEncoded || '');
        const nameEl = document.getElementById('editUserStoreName');
        const planEl = document.getElementById('editUserPlan');
        const statusEl = document.getElementById('editUserStatus');
        const idEl = document.getElementById('editUserId');

        if (nameEl) nameEl.value = storeName;
        if (planEl) planEl.value = plan || 'trial';
        if (statusEl) statusEl.value = status || 'active';
        if (idEl) idEl.value = userId;

        openModal('editUserModal');
    };

    const btnSaveEditUser = document.getElementById('btnSaveEditUser');
    if (btnSaveEditUser) {
        btnSaveEditUser.addEventListener('click', async () => {
            const userId = document.getElementById('editUserId')?.value;
            const plan = document.getElementById('editUserPlan')?.value;
            const status = document.getElementById('editUserStatus')?.value;

            if (!userId) {
                showToast('User ID tidak ditemukan', 'error');
                return;
            }

            const origText = btnSaveEditUser.innerHTML;
            btnSaveEditUser.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Menyimpan...';
            btnSaveEditUser.disabled = true;

            try {
                const res = await fetch('/api/admin/edit-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, plan, status })
                });
                const data = await res.json();
                if (!res.ok || data.error) throw new Error(data.error || 'Gagal memperbarui user');

                showToast('Data pengguna berhasil diperbarui!', 'success');
                closeModal('editUserModal');
                fetchUsers();
                fetchOverviewStats();
            } catch (err) {
                showToast('Gagal: ' + err.message, 'error');
            } finally {
                btnSaveEditUser.innerHTML = origText;
                btnSaveEditUser.disabled = false;
            }
        });
    }

    window.handleDeleteUser = async function (userId, storeNameEncoded) {
        const storeName = decodeURIComponent(storeNameEncoded || 'pengguna');
        if (!confirm(`Apakah Anda yakin ingin menghapus akun tenant "${storeName}" secara permanen?`)) {
            return;
        }

        try {
            const res = await fetch('/api/admin/delete-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Gagal menghapus user');

            showToast(`Tenant "${storeName}" berhasil dihapus!`, 'success');
            fetchUsers();
            fetchOverviewStats();
        } catch (err) {
            showToast('Gagal: ' + err.message, 'error');
        }
    };

    // ============================================
    // 12. ADD CUSTOMER
    // ============================================
    const btnAddCustomer = document.getElementById('btnAddCustomer');
    if (btnAddCustomer) {
        btnAddCustomer.addEventListener('click', () => openModal('addCustomerModal'));
    }

    const btnSaveCustomer = document.getElementById('btnSaveCustomer');
    if (btnSaveCustomer) {
        btnSaveCustomer.addEventListener('click', async () => {
            const name = document.getElementById('newCustomerName')?.value?.trim();
            const store = document.getElementById('newStoreName')?.value?.trim();
            const email = document.getElementById('newCustomerEmail')?.value?.trim();
            const plan = document.getElementById('newCustomerPlan')?.value || 'trial';

            if (!name || !store || !email) {
                showToast('Harap lengkapi semua field wajib', 'error');
                return;
            }

            const origText = btnSaveCustomer.innerHTML;
            btnSaveCustomer.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Menyimpan...';
            btnSaveCustomer.disabled = true;

            try {
                const res = await fetch('/api/admin/add-customer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password: 'password123' })
                });
                const data = await res.json();
                if (!res.ok || data.error) throw new Error(data.error || 'Gagal menambahkan user');

                // Update metadata nama toko & plan
                if (data.user?.id) {
                    await fetch('/api/admin/edit-user', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: data.user.id,
                            plan,
                            status: 'active'
                        })
                    });
                }

                showToast(`Customer "${name}" berhasil ditambahkan! Password default: password123`, 'success');
                closeModal('addCustomerModal');
                document.getElementById('newCustomerName').value = '';
                document.getElementById('newStoreName').value = '';
                document.getElementById('newCustomerEmail').value = '';
                fetchUsers();
                fetchOverviewStats();
            } catch (err) {
                showToast('Gagal: ' + err.message, 'error');
            } finally {
                btnSaveCustomer.innerHTML = origText;
                btnSaveCustomer.disabled = false;
            }
        });
    }

    // ============================================
    // 13. SEND BROADCAST
    // ============================================
    const btnBroadcast = document.getElementById('btnSendBroadcast');
    if (btnBroadcast) {
        btnBroadcast.addEventListener('click', () => openModal('broadcastModal'));
    }

    const btnConfirmBroadcast = document.getElementById('btnConfirmBroadcast');
    if (btnConfirmBroadcast) {
        btnConfirmBroadcast.addEventListener('click', async () => {
            const message = document.getElementById('broadcastMessage')?.value?.trim();
            if (!message) { showToast('Pesan broadcast tidak boleh kosong', 'error'); return; }

            const origText = btnConfirmBroadcast.innerHTML;
            btnConfirmBroadcast.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Mengirim...';
            btnConfirmBroadcast.disabled = true;

            try {
                const res = await fetch('/api/admin/broadcast', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message })
                });
                const data = await res.json();
                showToast(data.message || 'Broadcast berhasil dikirim!', 'success');
                closeModal('broadcastModal');
                document.getElementById('broadcastMessage').value = '';
            } catch (err) {
                showToast('Gagal mengirim broadcast', 'error');
            } finally {
                btnConfirmBroadcast.innerHTML = origText;
                btnConfirmBroadcast.disabled = false;
            }
        });
    }

    // ============================================
    // 14. SEARCH FILTER
    // ============================================
    const userSearch = document.querySelector('#users input[type="text"]');
    if (userSearch) {
        userSearch.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('#allUsersBody tr').forEach(row => {
                row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none';
            });
        });
    }

    // ============================================
    // 15. REFRESH BUTTONS
    // ============================================
    const btnRefreshUsers = document.getElementById('btnRefreshUsers');
    if (btnRefreshUsers) {
        btnRefreshUsers.addEventListener('click', () => {
            fetchUsers();
            showToast('Daftar pengguna diperbarui', 'info');
        });
    }

    const btnRefreshRevenue = document.getElementById('btnRefreshRevenue');
    if (btnRefreshRevenue) {
        btnRefreshRevenue.addEventListener('click', () => {
            fetchRevenueData();
            showToast('Data revenue diperbarui', 'info');
        });
    }

    const btnRefreshHealth = document.getElementById('btnRefreshHealth');
    if (btnRefreshHealth) {
        btnRefreshHealth.addEventListener('click', () => {
            fetchSystemHealth();
            showToast('Status kesehatan server diperbarui', 'info');
        });
    }

    // Inisialisasi awal seluruh data
    fetchOverviewStats();
    fetchUsers();
    fetchRevenueData();
    fetchSystemHealth();
    loadPlatformSettings();

    // Auto-polling ringan setiap 30 detik untuk overview & health
    setInterval(() => {
        fetchOverviewStats();
        if (document.getElementById('health')?.classList.contains('active')) {
            fetchSystemHealth();
        }
    }, 30000);
});
