document.addEventListener('DOMContentLoaded', async () => {
    // --- Global State ---
    let productsData = [];
    let blockedNumbers = [];
    let specialNumbers = [];
    let invoicesData = [];
    let chatsData = [];

    // --- Navigation & Mobile Drawer Logic ---
    const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
    const bottomNavItems = document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item');
    const sections = document.querySelectorAll('.dashboard-section');
    const dashboardSidebar = document.getElementById('dashboardSidebar');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');
    const btnMobileMenu = document.getElementById('btnMobileMenu');
    const btnCloseSidebar = document.getElementById('btnCloseSidebar');

    function closeMobileSidebar() {
        if (dashboardSidebar) dashboardSidebar.classList.remove('open');
        if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
        document.body.style.overflow = '';
    }

    function openMobileSidebar() {
        if (dashboardSidebar) dashboardSidebar.classList.add('open');
        if (sidebarBackdrop) sidebarBackdrop.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    if (btnMobileMenu) btnMobileMenu.addEventListener('click', openMobileSidebar);
    if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', closeMobileSidebar);
    if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeMobileSidebar);

    window.switchDashboardTab = function(targetId) {
        navItems.forEach(nav => nav.classList.remove('active'));
        bottomNavItems.forEach(bNav => bNav.classList.remove('active'));

        const targetNav = document.querySelector(`.sidebar-nav .nav-item[data-target="${targetId}"]`);
        if (targetNav) targetNav.classList.add('active');

        const targetBottomNav = document.querySelector(`.mobile-bottom-nav .mobile-nav-item[data-target="${targetId}"]`);
        if (targetBottomNav) targetBottomNav.classList.add('active');

        sections.forEach(section => section.classList.remove('active'));
        const targetSection = document.getElementById(targetId);
        if (targetSection) {
            targetSection.classList.add('active');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        closeMobileSidebar();
    };

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-target');
            if (targetId) window.switchDashboardTab(targetId);
        });
    });

    bottomNavItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-target');
            if (targetId) window.switchDashboardTab(targetId);
        });
    });

    // Handle "Lihat Semua Chat" link from overview
    const viewInboxLink = document.getElementById('btnViewInbox');
    if (viewInboxLink) {
        viewInboxLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.switchDashboardTab('chat-history');
        });
    }

    // --- Supabase Session Check ---
    try {
        if (!window.supabaseClient) {
            console.error('Supabase client not loaded!');
            window.location.href = 'login.html';
            return;
        }

        const { data: { session }, error } = await window.supabaseClient.auth.getSession();
        if (error || !session) {
            window.location.href = 'login.html';
            return;
        }

        // Fetch latest user data from DB (in case admin updated metadata)
        const { data: { user } } = await window.supabaseClient.auth.getUser();
        const activeUser = user || session.user;

        const user_id = activeUser.id;
        window.currentUserId = user_id;

        // --- Profile Display Logic ---
        const userMeta = activeUser.user_metadata || {};
        const storeName = userMeta.store_name || localStorage.getItem('storeName') || 'Toko Anda';
        const profilePhoto = localStorage.getItem('profilePhoto');
        const plan = userMeta.plan || 'Trial';

        const planBadge = document.getElementById('currentPlanBadge');
        if (planBadge) {
            planBadge.innerHTML = `<i class="ph-fill ph-check-circle"></i> Current Plan: ${plan.charAt(0).toUpperCase() + plan.slice(1)}`;
        }

        if (storeName) {
            const nameEls = document.querySelectorAll('.user-profile span');
            const avatarEls = document.querySelectorAll('.user-profile .avatar-small');

            nameEls.forEach(el => el.innerText = storeName);

            avatarEls.forEach(el => {
                if (profilePhoto) {
                    el.style.backgroundImage = `url(${profilePhoto})`;
                    el.style.backgroundSize = 'cover';
                    el.style.backgroundPosition = 'center';
                    el.innerText = '';
                } else {
                    const initials = storeName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                    el.innerText = initials;
                }
            });
        }

        // --- Logout Logic ---
        const logoutBtn = document.querySelector('.sidebar-footer .nav-item');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                await window.supabaseClient.auth.signOut();
                window.location.href = 'login.html';
            });
            logoutBtn.innerHTML = '<i class="ph ph-sign-out"></i> Keluar';
        }

    } catch (err) {
        console.error('Auth check failed:', err);
        window.location.href = 'login.html';
    }

    // --- Toast Notification System ---
    window.showToast = function (message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = 'ph-check-circle';
        if (type === 'error') icon = 'ph-warning-circle';
        if (type === 'info') icon = 'ph-info';

        toast.innerHTML = `<i class="ph-fill ${icon}"></i> <span>${message}</span>`;
        container.appendChild(toast);

        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 10);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    };

    // --- Modal System ---
    window.openModal = function (id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('active');
    };

    window.closeModal = function (id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('active');
            // Clear inputs if any
            modal.querySelectorAll('input:not([type="radio"]):not([type="hidden"])').forEach(input => input.value = '');
        }
    };

    // Close modal on outside click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
            }
        });
    });

    // =============================================
    // 1. KNOWLEDGE BASE & PRODUK
    // =============================================
    window.openAddProductModal = function () {
        document.getElementById('productModalTitle').innerText = 'Tambah Produk';
        document.getElementById('prodId').value = '';
        document.getElementById('prodName').value = '';
        document.getElementById('prodVariant').value = '';
        document.getElementById('prodPrice').value = '';
        document.getElementById('prodWeight').value = '';
        document.getElementById('prodStock').value = '';
        document.getElementById('prodImage').value = '';
        openModal('productModal');
    };

    const btnSaveAll = document.getElementById('btnSaveAll');
    if (btnSaveAll) {
        btnSaveAll.addEventListener('click', async () => {
            const originalText = btnSaveAll.innerHTML;
            btnSaveAll.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Menyimpan...';
            btnSaveAll.disabled = true;

            const btnSysPrompt = document.getElementById('btnSaveSystemPrompt');
            const btnKnowledge = document.getElementById('btnSaveKnowledge');

            if (btnSysPrompt) await btnSysPrompt.click();
            if (btnKnowledge) await btnKnowledge.click();

            setTimeout(() => {
                showToast('Semua data pengetahuan toko berhasil disimpan!', 'success');
                btnSaveAll.innerHTML = originalText;
                btnSaveAll.disabled = false;
            }, 600);
        });
    }

    const prodPriceInput = document.getElementById('prodPrice');
    if (prodPriceInput) {
        prodPriceInput.addEventListener('input', function () {
            let val = this.value.replace(/[^,\d]/g, '');
            if (!val) {
                this.value = '';
                return;
            }
            let split = val.split(',');
            let sisa = split[0].length % 3;
            let rupiah = split[0].substr(0, sisa);
            let ribuan = split[0].substr(sisa).match(/\d{3}/gi);

            if (ribuan) {
                let separator = sisa ? '.' : '';
                rupiah += separator + ribuan.join('.');
            }
            rupiah = split[1] !== undefined ? rupiah + ',' + split[1] : rupiah;
            this.value = 'Rp ' + rupiah;
        });
    }

    window.saveProduct = async function () {
        const id = document.getElementById('prodId').value;
        const name = document.getElementById('prodName').value.trim();
        const variant = document.getElementById('prodVariant').value.trim();
        let priceStr = document.getElementById('prodPrice').value;
        const weightStr = document.getElementById('prodWeight').value;
        const stockStr = document.getElementById('prodStock').value;
        const imageFile = document.getElementById('prodImage').files[0];

        if (!name || !priceStr || !stockStr || !weightStr) {
            showToast('Mohon lengkapi data produk termasuk berat', 'error');
            return;
        }

        const price = parseInt(priceStr.replace(/[^0-9]/g, ''), 10) || 0;
        const weight = parseInt(weightStr, 10) || 0;
        const stock = parseInt(stockStr, 10) || 0;

        try {
            const btn = document.querySelector('#productModal .btn-primary');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Menyimpan...';
            btn.disabled = true;

            const { data: { session } } = await window.supabaseClient.auth.getSession();
            const user_id = session.user.id;

            let updateData = { name, variant, price, weight, stock };

            if (imageFile) {
                const base64Promise = new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = error => reject(error);
                    reader.readAsDataURL(imageFile);
                });
                updateData.image_url = await base64Promise;
            }

            let error = null;
            if (id) {
                const { error: err } = await window.supabaseClient
                    .from('products')
                    .update(updateData)
                    .eq('id', id)
                    .eq('user_id', user_id);
                error = err;
            } else {
                updateData.user_id = user_id;
                const { error: err } = await window.supabaseClient
                    .from('products')
                    .insert([updateData]);
                error = err;
            }

            if (!error) {
                showToast(id ? 'Produk berhasil diubah!' : 'Produk berhasil ditambahkan!', 'success');
                closeModal('productModal');
                fetchDashboardData();
            } else {
                showToast('Gagal menyimpan produk: ' + error.message, 'error');
            }

            btn.innerHTML = originalText;
            btn.disabled = false;
        } catch (err) {
            console.error(err);
            showToast('Terjadi kesalahan saat menyimpan produk', 'error');
        }
    };

    window.deleteRow = async function (id) {
        if (confirm('Hapus produk ini secara permanen dari Database?')) {
            try {
                const { error } = await window.supabaseClient
                    .from('products')
                    .delete()
                    .eq('id', id);

                if (!error) {
                    showToast('Produk berhasil dihapus', 'success');
                    fetchDashboardData();
                } else {
                    showToast('Gagal menghapus produk: ' + error.message, 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Terjadi kesalahan', 'error');
            }
        }
    };

    window.editProduct = function (id) {
        const p = productsData.find(prod => prod.id === id);
        if (!p) return;

        document.getElementById('productModalTitle').innerText = 'Edit Produk';
        document.getElementById('prodId').value = p.id;
        document.getElementById('prodName').value = p.name;
        document.getElementById('prodVariant').value = p.variant || '';
        document.getElementById('prodPrice').value = 'Rp ' + p.price.toLocaleString('id-ID');
        document.getElementById('prodWeight').value = p.weight || '';
        document.getElementById('prodStock').value = p.stock;
        document.getElementById('prodImage').value = '';

        openModal('productModal');
    };

    // CSV Import handling
    const importBtn = document.querySelector('#knowledge .header-actions .btn-outline');
    const csvInput = document.getElementById('csvInput');
    if (importBtn && csvInput) {
        importBtn.addEventListener('click', () => csvInput.click());
        csvInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            showToast(`Membaca file ${file.name}...`, 'info');
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const text = event.target.result;
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    if (lines.length <= 1) {
                        showToast('Format CSV kosong atau tidak valid', 'error');
                        return;
                    }

                    const rows = lines.slice(1);
                    const newProducts = [];
                    for (const row of rows) {
                        const cols = row.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
                        if (cols.length >= 2) {
                            newProducts.push({
                                user_id: window.currentUserId,
                                name: cols[0],
                                variant: cols[1] || '',
                                price: parseInt(cols[2]?.replace(/[^0-9]/g, ''), 10) || 100000,
                                weight: parseInt(cols[3]?.replace(/[^0-9]/g, ''), 10) || 500,
                                stock: parseInt(cols[4]?.replace(/[^0-9]/g, ''), 10) || 50
                            });
                        }
                    }

                    if (newProducts.length > 0) {
                        const { error } = await window.supabaseClient.from('products').insert(newProducts);
                        if (!error) {
                            showToast(`Berhasil import ${newProducts.length} produk dari CSV!`, 'success');
                            fetchDashboardData();
                        } else {
                            showToast('Gagal import: ' + error.message, 'error');
                        }
                    }
                } catch (err) {
                    showToast('Gagal membaca file CSV', 'error');
                }
            };
            reader.readAsText(file);
        });
    }

    // Document Upload handling
    const docInput = document.getElementById('docInput');
    if (docInput) {
        docInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target.result;
                const knowledgeInput = document.getElementById('knowledgeInput');
                if (knowledgeInput) {
                    knowledgeInput.value = (knowledgeInput.value ? knowledgeInput.value + '\n\n' : '') + `=== DOKUMEN: ${file.name} ===\n` + text;
                    showToast(`Dokumen ${file.name} berhasil dimuat ke Detailed Context!`, 'success');
                }
            };
            reader.readAsText(file);
        });
    }

    // Save System Prompt
    const btnSaveSystemPrompt = document.getElementById('btnSaveSystemPrompt');
    if (btnSaveSystemPrompt) {
        btnSaveSystemPrompt.addEventListener('click', async () => {
            const content = document.getElementById('systemPromptInput').value;
            const originalText = btnSaveSystemPrompt.innerHTML;
            btnSaveSystemPrompt.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Menyimpan...';
            btnSaveSystemPrompt.disabled = true;

            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const user_id = session.user.id;

                const { data: existing } = await window.supabaseClient
                    .from('knowledge_base').select('store_rules').eq('user_id', user_id).single();

                const { error } = await window.supabaseClient
                    .from('knowledge_base')
                    .upsert({
                        user_id: user_id,
                        system_prompt: content,
                        store_rules: existing?.store_rules || ''
                    }, { onConflict: 'user_id' });

                if (!error) showToast('System Prompt berhasil disimpan! AI akan otomatis mengikuti instruksi ini.', 'success');
                else showToast('Gagal menyimpan System Prompt: ' + error.message, 'error');
            } catch (err) {
                showToast('Terjadi kesalahan: ' + err.message, 'error');
            }
            btnSaveSystemPrompt.innerHTML = originalText;
            btnSaveSystemPrompt.disabled = false;
        });
    }

    // Save Knowledge Base Detailed Context
    const btnSaveKnowledge = document.getElementById('btnSaveKnowledge');
    if (btnSaveKnowledge) {
        btnSaveKnowledge.addEventListener('click', async () => {
            const content = document.getElementById('knowledgeInput').value;
            const originalText = btnSaveKnowledge.innerHTML;
            btnSaveKnowledge.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Menyimpan...';
            btnSaveKnowledge.disabled = true;

            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                const user_id = session.user.id;

                const { data: existing } = await window.supabaseClient
                    .from('knowledge_base').select('system_prompt').eq('user_id', user_id).single();

                const { error } = await window.supabaseClient
                    .from('knowledge_base')
                    .upsert({
                        user_id: user_id,
                        store_rules: content,
                        system_prompt: existing?.system_prompt || ''
                    }, { onConflict: 'user_id' });

                if (!error) showToast('Knowledge Context berhasil disimpan!', 'success');
                else showToast('Gagal menyimpan Knowledge: ' + error.message, 'error');
            } catch (err) {
                showToast('Terjadi kesalahan: ' + err.message, 'error');
            }
            btnSaveKnowledge.innerHTML = originalText;
            btnSaveKnowledge.disabled = false;
        });
    }

    // =============================================
    // 2. ATURAN NOMOR (BLOCKED & SPECIAL NUMBERS)
    // =============================================
    function renderBlockedNumbers() {
        const container = document.getElementById('blockedNumbersList');
        const badge = document.getElementById('blockedCountBadge');
        if (badge) badge.innerText = `Total: ${blockedNumbers.length} nomor`;

        if (!container) return;
        if (blockedNumbers.length === 0) {
            container.innerHTML = `
                <div class="empty-number-state" style="text-align: center; padding: 20px; color: var(--text-secondary); font-size: 13px;">
                    <i class="ph ph-shield-check" style="font-size: 24px; display: block; margin-bottom: 4px; opacity: 0.5;"></i>
                    Belum ada nomor yang diblokir
                </div>`;
            return;
        }

        container.innerHTML = '';
        blockedNumbers.forEach((num, index) => {
            const div = document.createElement('div');
            div.className = 'number-list-item';
            div.innerHTML = `
                <div class="number-item-info">
                    <i class="ph-fill ph-prohibit" style="color: #ef4444;"></i>
                    <span>${num}</span>
                </div>
                <button class="number-delete-btn" onclick="deleteBlockedNumber(${index})" title="Hapus nomor">
                    <i class="ph ph-trash"></i>
                </button>
            `;
            container.appendChild(div);
        });
    }

    function renderSpecialNumbers() {
        const container = document.getElementById('specialNumbersList');
        const badge = document.getElementById('specialCountBadge');
        if (badge) badge.innerText = `Total: ${specialNumbers.length} nomor`;

        if (!container) return;
        if (specialNumbers.length === 0) {
            container.innerHTML = `
                <div class="empty-number-state" style="text-align: center; padding: 20px; color: var(--text-secondary); font-size: 13px;">
                    <i class="ph ph-user-gear" style="font-size: 24px; display: block; margin-bottom: 4px; opacity: 0.5;"></i>
                    Belum ada nomor admin / khusus
                </div>`;
            return;
        }

        container.innerHTML = '';
        specialNumbers.forEach((num, index) => {
            const div = document.createElement('div');
            div.className = 'number-list-item';
            div.innerHTML = `
                <div class="number-item-info">
                    <i class="ph-fill ph-user-gear" style="color: #f59e0b;"></i>
                    <span>${num}</span>
                </div>
                <button class="number-delete-btn" onclick="deleteSpecialNumber(${index})" title="Hapus nomor">
                    <i class="ph ph-trash"></i>
                </button>
            `;
            container.appendChild(div);
        });
    }

    window.addBlockedNumber = function () {
        const input = document.getElementById('inputNewBlockedNumber');
        let val = input?.value.trim().replace(/[^0-9]/g, '');
        if (!val) {
            showToast('Masukkan nomor WhatsApp yang valid', 'error');
            return;
        }
        if (val.startsWith('0')) val = '62' + val.slice(1);
        if (!val.startsWith('62')) val = '62' + val;

        if (blockedNumbers.includes(val)) {
            showToast('Nomor tersebut sudah ada di daftar blokir', 'info');
            return;
        }

        blockedNumbers.push(val);
        renderBlockedNumbers();
        input.value = '';
        saveBlockedNumbersToDB();
    };

    window.deleteBlockedNumber = function (index) {
        const removed = blockedNumbers.splice(index, 1);
        renderBlockedNumbers();
        saveBlockedNumbersToDB();
    };

    window.saveBlockedNumbersToDB = async function () {
        const btn = document.getElementById('btnSaveBlocked');
        const origText = btn ? btn.innerHTML : '';
        if (btn) { btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Menyimpan...'; btn.disabled = true; }

        try {
            if (!window.currentUserId) throw new Error("User belum login");
            const strVal = blockedNumbers.join('\n');
            const { data: existing } = await window.supabaseClient.from('knowledge_base').select('id').eq('user_id', window.currentUserId).single();
            if (existing) {
                const { error } = await window.supabaseClient.from('knowledge_base').update({ blocked_numbers: strVal }).eq('user_id', window.currentUserId);
                if (error) throw error;
            } else {
                const { error } = await window.supabaseClient.from('knowledge_base').insert({ user_id: window.currentUserId, blocked_numbers: strVal });
                if (error) throw error;
            }

            showToast('Daftar nomor blokir berhasil disimpan ke server!', 'success');
        } catch (err) {
            showToast('Gagal menyimpan: ' + err.message, 'error');
        }

        if (btn) { btn.innerHTML = origText; btn.disabled = false; }
    };

    window.addSpecialNumber = function () {
        const input = document.getElementById('inputNewSpecialNumber');
        let val = input?.value.trim().replace(/[^0-9]/g, '');
        if (!val) {
            showToast('Masukkan nomor WhatsApp yang valid', 'error');
            return;
        }
        if (val.startsWith('0')) val = '62' + val.slice(1);
        if (!val.startsWith('62')) val = '62' + val;

        if (specialNumbers.includes(val)) {
            showToast('Nomor tersebut sudah ada di daftar admin', 'info');
            return;
        }

        specialNumbers.push(val);
        renderSpecialNumbers();
        input.value = '';
        showToast(`Nomor ${val} ditambahkan ke daftar khusus`, 'success');
    };

    window.deleteSpecialNumber = function (index) {
        const removed = specialNumbers.splice(index, 1);
        renderSpecialNumbers();
        showToast(`Nomor ${removed[0]} dihapus dari daftar khusus`, 'info');
    };

    window.saveSpecialNumbersToDB = async function () {
        const btn = document.getElementById('btnSaveSpecial');
        const origText = btn ? btn.innerHTML : '';
        if (btn) { btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Menyimpan...'; btn.disabled = true; }

        try {
            if (!window.currentUserId) throw new Error("User belum login");
            const strVal = specialNumbers.join('\n');
            const { data: existing } = await window.supabaseClient.from('knowledge_base').select('id').eq('user_id', window.currentUserId).single();
            if (existing) {
                const { error } = await window.supabaseClient.from('knowledge_base').update({ special_numbers: strVal }).eq('user_id', window.currentUserId);
                if (error) throw error;
            } else {
                const { error } = await window.supabaseClient.from('knowledge_base').insert({ user_id: window.currentUserId, special_numbers: strVal });
                if (error) throw error;
            }

            showToast('Daftar nomor admin berhasil disimpan ke server!', 'success');
        } catch (err) {
            showToast('Gagal menyimpan: ' + err.message, 'error');
        }

        if (btn) { btn.innerHTML = origText; btn.disabled = false; }
    };

    // =============================================
    // 3. FOLLOW UP OTOMATIS
    // =============================================
    window.saveFollowUpConfig = function () {
        const day1 = document.getElementById('followUpDay1')?.value;
        const day2 = document.getElementById('followUpDay2')?.value;
        const day3 = document.getElementById('followUpDay3')?.value;
        const toggle = document.getElementById('toggleAutoFollowUp')?.checked;

        localStorage.setItem('followup_day1', day1 || '');
        localStorage.setItem('followup_day2', day2 || '');
        localStorage.setItem('followup_day3', day3 || '');
        localStorage.setItem('followup_active', toggle ? 'true' : 'false');

        showToast('Pengaturan follow up otomatis berhasil disimpan!', 'success');
    };

    window.renderFollowUps = function () {
        const tbody = document.getElementById('followUpTableBody');
        if (!tbody) return;
        const queue = JSON.parse(localStorage.getItem('manualFollowUpQueue') || '[]');
        if (queue.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary); padding:24px;">Belum ada antrean follow up.</td></tr>';
            return;
        }
        tbody.innerHTML = '';
        queue.forEach((item, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${item.number}</strong></td>
                <td>Day ${item.day} (H+${item.day})</td>
                <td>${item.timeStr}</td>
                <td><span class="status-badge warning" style="font-size:12px;">Menunggu</span></td>
                <td>
                    <button class="btn btn-outline" style="padding: 4px 10px; font-size: 12px; border-color: var(--danger); color: var(--danger);" onclick="deleteManualFollowUp(${idx})">Batal</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    };

    window.addManualFollowUp = function () {
        const numberInput = document.getElementById('manualFollowUpNumber');
        const daySelect = document.getElementById('manualFollowUpDay');
        let number = numberInput?.value.trim().replace(/[^0-9]/g, '');
        const day = daySelect?.value || '1';

        if (!number) {
            showToast('Nomor WhatsApp tidak boleh kosong', 'error');
            return;
        }
        if (number.startsWith('0')) number = '62' + number.slice(1);
        if (!number.startsWith('62')) number = '62' + number;

        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + parseInt(day));
        const timeStr = nextDate.toLocaleDateString('id-ID') + ' 09:00';

        const queue = JSON.parse(localStorage.getItem('manualFollowUpQueue') || '[]');
        queue.unshift({ number, day, timeStr });
        localStorage.setItem('manualFollowUpQueue', JSON.stringify(queue));

        window.renderFollowUps();

        showToast(`Nomor ${number} berhasil ditambahkan ke antrean!`, 'success');
        closeModal('addFollowUpModal');
        numberInput.value = '';
    };

    window.deleteManualFollowUp = function (idx) {
        const queue = JSON.parse(localStorage.getItem('manualFollowUpQueue') || '[]');
        queue.splice(idx, 1);
        localStorage.setItem('manualFollowUpQueue', JSON.stringify(queue));
        window.renderFollowUps();
        showToast('Dihapus dari antrean', 'info');
    };

    // Search Follow Up Filter
    const searchFollowUp = document.getElementById('inputSearchFollowUp');
    if (searchFollowUp) {
        searchFollowUp.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('#followUpTableBody tr').forEach(row => {
                row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none';
            });
        });
    }

    // =============================================
    // 4. INVOICES & SEARCH FILTER
    // =============================================
    const searchInvoice = document.getElementById('inputSearchInvoice');
    if (searchInvoice) {
        searchInvoice.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('#invoicesTableBody tr').forEach(row => {
                row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none';
            });
        });
    }

    // =============================================
    // 5. BILLING & PAYMENT
    // =============================================
    let selectedPlan = 'Pro'; // Default fallback

    window.selectPlan = function(planName) {
        selectedPlan = planName;
        openModal('checkoutModal');
    };

    window.processPayment = async function () {
        const btn = document.querySelector('#checkoutModal .btn-primary');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Memproses...';
        btn.disabled = true;

        try {
            // Get user info from Supabase session
            const { data: sessionData } = await window.supabaseClient.auth.getSession();
            const user = sessionData?.session?.user;
            
            if (!user) {
                showToast('Anda harus login terlebih dahulu.', 'error');
                return;
            }

            // Call Backend API to create Midtrans transaction
            const response = await fetch('/api/payment/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan: selectedPlan,
                    userId: user.id,
                    email: user.email,
                    name: localStorage.getItem('storeName') || 'User',
                    phone: user.user_metadata?.phone || ''
                })
            });

            const result = await response.json();

            if (result.success && result.token) {
                // Close checkout modal
                closeModal('checkoutModal');
                
                // Open Midtrans Snap Popup
                window.snap.pay(result.token, {
                    onSuccess: function(result){
                        showToast('Pembayaran berhasil! Kredit Anda akan segera ditambahkan.', 'success');
                        // Backend webhook will handle Supabase update. User can refresh.
                        setTimeout(() => window.location.reload(), 2000);
                    },
                    onPending: function(result){
                        showToast('Menunggu pembayaran Anda.', 'warning');
                    },
                    onError: function(result){
                        showToast('Pembayaran gagal.', 'error');
                    },
                    onClose: function(){
                        showToast('Anda menutup popup tanpa menyelesaikan pembayaran.', 'warning');
                    }
                });
            } else {
                showToast(result.message || 'Gagal membuat transaksi', 'error');
            }
        } catch (error) {
            console.error('Payment Error:', error);
            showToast('Terjadi kesalahan pada sistem pembayaran.', 'error');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    };

    // =============================================
    // 6. CHAT HISTORY DETAIL MODAL
    // =============================================
    window.openChatDetail = async function (phone, name) {
        // Remove active class from all items
        document.querySelectorAll('.chat-customer-item').forEach(el => el.classList.remove('active'));
        // Add active class to the selected item if it exists in the list
        const listItem = document.querySelector(`.chat-customer-item[data-phone="${phone}"]`);
        if (listItem) listItem.classList.add('active');

        const custTitleEl = document.getElementById('chatViewerTitle');
        const custPhoneEl = document.getElementById('chatViewerPhone');
        const avatarEl = document.getElementById('chatViewerAvatar');
        const container = document.getElementById('chatMessagesContainer2');

        if (!container) return;

        if (custTitleEl) custTitleEl.innerText = name || phone || 'Pelanggan';
        if (custPhoneEl) custPhoneEl.innerText = phone || '-';
        if (avatarEl) {
            avatarEl.style.display = 'flex';
            avatarEl.innerText = (name || phone || 'CS').substring(0, 2).toUpperCase();
        }

        container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px; margin: auto;"><i class="ph ph-circle-notch ph-spin" style="font-size: 24px;"></i><br>Memuat percakapan...</div>';

        // Switch to chat history tab if not already there
        window.switchDashboardTab('chat-history');

        // Toggle mobile view to show chat pane
        const chatLayoutWrapper = document.querySelector('.chat-layout-wrapper');
        if (chatLayoutWrapper) chatLayoutWrapper.classList.add('mobile-show-chat');

        try {
            const { data: messages, error } = await window.supabaseClient
                .from('chats')
                .select('*')
                .eq('user_id', window.currentUserId)
                .eq('customer_phone', phone)
                .order('created_at', { ascending: true }); // Make sure we get chronological order

            if (error || !messages || messages.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px; margin: auto;">Belum ada riwayat pesan tersimpan.</div>';
                return;
            }

            container.innerHTML = '';
            messages.forEach(msg => {
                const isBot = msg.sender === 'bot' || msg.sender === 'ai';
                const bubble = document.createElement('div');
                bubble.style.display = 'flex';
                bubble.style.flexDirection = 'column';
                bubble.style.alignItems = isBot ? 'flex-end' : 'flex-start';
                bubble.style.width = '100%';

                const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';

                bubble.innerHTML = `
                    <div style="max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.4; ${isBot ? 'background: linear-gradient(135deg, #2563EB, #3B82F6); color: white; border-bottom-right-radius: 2px;' : 'background: #FFFFFF; color: #172033; border: 1px solid #E5EAF2; border-bottom-left-radius: 2px; box-shadow: 0 1px 2px rgba(23,32,51,0.04);'}">
                        <div style="font-size: 11px; opacity: ${isBot ? '0.9' : '0.65'}; margin-bottom: 3px; font-weight: 600;">${isBot ? '✨ Asisten AI' : '👤 ' + (msg.customer_name || 'Pelanggan')}</div>
                        <div>${msg.message.replace(/\n/g, '<br>')}</div>
                        <div style="font-size: 10px; opacity: ${isBot ? '0.8' : '0.5'}; text-align: right; margin-top: 4px;">${time}</div>
                    </div>
                `;
                container.appendChild(bubble);
            });
            container.scrollTop = container.scrollHeight;
        } catch (err) {
            container.innerHTML = '<div style="text-align: center; color: var(--danger); padding: 20px; margin: auto;">Gagal memuat pesan.</div>';
        }
    };

    // Load Chat History Customers List
    async function loadChatHistoryCustomers() {
        if (!window.currentUserId) return;
        const listContainer = document.getElementById('chatCustomerList');
        if (!listContainer) return;
        
        try {
            // Fetch all chats ordered by created_at desc to get the latest messages
            const { data: allChats, error } = await window.supabaseClient
                .from('chats')
                .select('*')
                .eq('user_id', window.currentUserId)
                .order('created_at', { ascending: false });
                
            if (error) throw error;
            
            if (!allChats || allChats.length === 0) {
                listContainer.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">Belum ada pelanggan.</div>';
                return;
            }
            
            // Group by phone number
            const customersMap = new Map();
            allChats.forEach(chat => {
                if (!chat.customer_phone) return;
                if (!customersMap.has(chat.customer_phone)) {
                    customersMap.set(chat.customer_phone, {
                        phone: chat.customer_phone,
                        name: chat.customer_name || 'Pelanggan',
                        lastMessage: chat.message,
                        time: chat.created_at
                    });
                }
            });
            
            const customers = Array.from(customersMap.values());
            
            listContainer.innerHTML = '';
            customers.forEach(cust => {
                const time = cust.time ? new Date(cust.time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
                const item = document.createElement('div');
                item.className = 'chat-customer-item';
                item.setAttribute('data-phone', cust.phone);
                item.innerHTML = `
                    <div class="chat-customer-info">
                        <div class="chat-customer-name">${cust.name}</div>
                        <div class="chat-customer-phone">${cust.phone}</div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;">${cust.lastMessage}</div>
                    </div>
                    <div style="font-size: 10px; color: var(--text-secondary); align-self: flex-start;">${time}</div>
                `;
                
                item.addEventListener('click', () => {
                    openChatDetail(cust.phone, cust.name);
                });
                listContainer.appendChild(item);
            });
            
            // Handle Search
            const searchInput = document.getElementById('chatSearchInput');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    const q = e.target.value.toLowerCase();
                    document.querySelectorAll('.chat-customer-item').forEach(el => {
                        const text = el.innerText.toLowerCase();
                        el.style.display = text.includes(q) ? 'flex' : 'none';
                    });
                });
            }
            
        } catch (err) {
            console.error('Failed to load customers:', err);
            listContainer.innerHTML = '<div style="text-align: center; color: var(--danger); padding: 20px;">Gagal memuat daftar pelanggan.</div>';
        }

        const btnChatBackToList = document.getElementById('btnChatBackToList');
        if (btnChatBackToList) {
            btnChatBackToList.addEventListener('click', () => {
                const chatLayoutWrapper = document.querySelector('.chat-layout-wrapper');
                if (chatLayoutWrapper) chatLayoutWrapper.classList.remove('mobile-show-chat');
            });
        }
    }

    // =============================================
    // 7. FETCH ALL DASHBOARD DATA
    // =============================================
    async function fetchDashboardData() {
        try {
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (!session) return;
            const user_id = session.user.id;

            // 1. Stats Metrics
            const statTotalChats = document.getElementById('statTotalChats');
            const statOrdersClosed = document.getElementById('statOrdersClosed');

            const { count: chatCount } = await window.supabaseClient
                .from('chats')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user_id);

            if (statTotalChats) statTotalChats.innerText = (chatCount || 0).toLocaleString();

            const { count: orderCount } = await window.supabaseClient
                .from('invoices')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user_id);

            if (statOrdersClosed) statOrdersClosed.innerText = (orderCount || 0).toLocaleString();

            // AI Credits & Usage Tracking
            await loadCreditsAndUsage(user_id);
            
            // Load Chat History Customers
            await loadChatHistoryCustomers();


            // 4. Products Table
            const { data: products, error: prodError } = await window.supabaseClient
                .from('products')
                .select('*')
                .eq('user_id', user_id)
                .order('created_at', { ascending: false });

            if (!prodError && products) {
                productsData = products;
                const tbody = document.getElementById('productsTableBody');
                if (tbody) {
                    tbody.innerHTML = '';
                    if (products.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-secondary); padding:24px;">Belum ada produk di database. Klik "Tambah Produk" untuk mulai.</td></tr>';
                    } else {
                        productsData.forEach(p => {
                            const tr = document.createElement('tr');
                            let stockClass = 'success';
                            if (p.stock < 10) stockClass = 'warning';

                            let imgContent = '<div class="img-ph"></div>';
                            if (p.image_url) {
                                imgContent = `<img src="${p.image_url}" style="width: 40px; height: 40px; border-radius: 8px; object-fit: cover;">`;
                            }

                            tr.innerHTML = `
                                <td>${imgContent}</td>
                                <td><strong>${p.name}</strong></td>
                                <td>${p.variant || '-'}</td>
                                <td>Rp ${p.price.toLocaleString('id-ID')}</td>
                                <td>${p.weight || 0}g</td>
                                <td><span class="stock-badge ${stockClass}">${p.stock}</span></td>
                                <td>
                                    <button class="btn btn-outline btn-small" style="padding: 4px 8px; margin-right: 4px;" onclick="editProduct(${p.id})"><i class="ph ph-pencil-simple"></i></button>
                                    <button class="btn btn-outline btn-small" style="padding: 4px 8px; color: var(--danger); border-color: rgba(239,68,68,0.3);" onclick="deleteRow(${p.id})"><i class="ph ph-trash"></i></button>
                                </td>
                            `;
                            tbody.appendChild(tr);
                        });
                    }
                }
            }

            // 5. Knowledge Base & Number Rules from Supabase
            const { data: knowledge, error: knowError } = await window.supabaseClient
                .from('knowledge_base')
                .select('*')
                .eq('user_id', user_id)
                .single();

            if (!knowError && knowledge) {
                const systemPromptInput = document.getElementById('systemPromptInput');
                if (systemPromptInput && knowledge.system_prompt) {
                    systemPromptInput.value = knowledge.system_prompt;
                }
                const knowledgeInput = document.getElementById('knowledgeInput');
                if (knowledgeInput && knowledge.store_rules) {
                    knowledgeInput.value = knowledge.store_rules;
                }
                if (knowledge.blocked_numbers) {
                    blockedNumbers = knowledge.blocked_numbers.split(/[\n,]+/).map(n => n.trim()).filter(Boolean);
                }
                if (knowledge.special_numbers) {
                    specialNumbers = knowledge.special_numbers.split(/[\n,]+/).map(n => n.trim()).filter(Boolean);
                }
                renderBlockedNumbers();
                renderSpecialNumbers();
            } else {
                renderBlockedNumbers();
                renderSpecialNumbers();
            }

            // 6. Follow-up Templates from LocalStorage fallback
            const f1 = localStorage.getItem('followup_day1');
            const f2 = localStorage.getItem('followup_day2');
            const f3 = localStorage.getItem('followup_day3');
            const ft = localStorage.getItem('followup_active');
            if (f1) document.getElementById('followUpDay1').value = f1;
            if (f2) document.getElementById('followUpDay2').value = f2;
            if (f3) document.getElementById('followUpDay3').value = f3;
            if (ft !== null) document.getElementById('toggleAutoFollowUp').checked = (ft === 'true');

            if (window.renderFollowUps) window.renderFollowUps();
        } catch (err) {
            console.error('Failed to fetch data from Supabase:', err);
        }
    }

    // =============================================
    // 7. AI CREDITS & USAGE TRACKING
    // =============================================
    async function loadCreditsAndUsage(user_id) {
        try {
            // Ambil total pesan balasan AI dari tabel chats
            const { count: aiReplyCount } = await window.supabaseClient
                .from('chats')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user_id)
                .eq('sender', 'ai');

            const usedCredits = aiReplyCount || 0;

            // Ambil paket aktif dari metadata user atau localStorage
            const userPlan = localStorage.getItem('user_plan') || 'Starter';
            let totalQuota = 3000;
            const planLower = userPlan.toLowerCase();
            if (planLower === 'trial') totalQuota = 1000;
            else if (planLower === 'starter') totalQuota = 3000;
            else if (planLower === 'pro') totalQuota = 8000;
            else if (planLower === 'business') totalQuota = 20000;
            else if (planLower === 'agency') totalQuota = 50000;

            const remainingCredits = Math.max(0, totalQuota - usedCredits);
            const percentLeft = Math.min(100, Math.max(0, Math.round((remainingCredits / totalQuota) * 100)));

            let progressColor = 'linear-gradient(90deg, #6366F1, #10B981)';
            let badgeBg = '#D1FAE5';
            let badgeColor = '#059669';
            if (percentLeft < 20) {
                progressColor = 'linear-gradient(90deg, #EF4444, #F87171)';
                badgeBg = '#FEE2E2';
                badgeColor = '#DC2626';
            } else if (percentLeft < 50) {
                progressColor = 'linear-gradient(90deg, #F59E0B, #FBBF24)';
                badgeBg = '#FEF3C7';
                badgeColor = '#D97706';
            }

            // 1. Update Overview Metric Card
            const statRemaining = document.getElementById('statRemainingCredits');
            const statPercentBadge = document.getElementById('statCreditPercentBadge');
            const statPlanName = document.getElementById('statCreditPlanName');
            const statProgressBar = document.getElementById('statCreditProgressBar');

            if (statRemaining) statRemaining.innerText = remainingCredits.toLocaleString('id-ID');
            if (statPlanName) statPlanName.innerText = userPlan;
            if (statPercentBadge) {
                statPercentBadge.innerText = `${percentLeft}%`;
                statPercentBadge.style.color = badgeColor;
                statPercentBadge.style.background = badgeBg;
            }
            if (statProgressBar) {
                statProgressBar.style.width = `${percentLeft}%`;
                statProgressBar.style.background = progressColor;
            }

            // 2. Update Billing Tab Widgets
            const billingRemaining = document.getElementById('billingRemainingCredits');
            const billingUsed = document.getElementById('billingUsedCredits');
            const billingTotalInfo = document.getElementById('billingTotalQuotaInfo');
            const billingPercentLabel = document.getElementById('billingPercentageLabel');
            const billingProgressBar = document.getElementById('billingProgressBar');
            const billingPlanBadge = document.getElementById('billingPlanBadge');
            const currentPlanBadge = document.getElementById('currentPlanBadge');

            if (billingRemaining) billingRemaining.innerText = remainingCredits.toLocaleString('id-ID');
            if (billingUsed) billingUsed.innerText = usedCredits.toLocaleString('id-ID');
            if (billingTotalInfo) billingTotalInfo.innerText = `dari kuota ${totalQuota.toLocaleString('id-ID')} kredit`;
            if (billingPercentLabel) {
                billingPercentLabel.innerText = `${percentLeft}% Tersisa (${remainingCredits.toLocaleString('id-ID')} Kredit)`;
                billingPercentLabel.style.color = badgeColor;
            }
            if (billingProgressBar) {
                billingProgressBar.style.width = `${percentLeft}%`;
                billingProgressBar.style.background = progressColor;
            }
            if (billingPlanBadge) {
                billingPlanBadge.innerHTML = `<i class="ph-fill ph-sparkle"></i> Paket ${userPlan}`;
            }
            if (currentPlanBadge) {
                currentPlanBadge.innerHTML = `<i class="ph-fill ph-check-circle"></i> Current Plan: ${userPlan}`;
            }
        } catch (err) {
            console.warn('⚠️ Gagal memuat data kuota kredit AI:', err.message);
        }
    }

    fetchDashboardData();

    // =============================================
    // 8. WHATSAPP BAILEYS & BOT CONTROL LOGIC
    // =============================================
    const waBadge = document.getElementById('waConnectionBadge');
    const waConnectedState = document.getElementById('waConnectedState');
    const waDisconnectedState = document.getElementById('waDisconnectedState');
    const waDisconnectedMsg = document.getElementById('waDisconnectedMsg');
    const waQrLoading = document.getElementById('waQrLoading');
    const waQrLoadingText = document.getElementById('waQrLoadingText');
    const waQrImage = document.getElementById('waQrImage');
    const waPairingBox = document.getElementById('waPairingBox');
    const waPairingCodeText = document.getElementById('waPairingCodeText');
    const btnCopyPairingCode = document.getElementById('btnCopyPairingCode');
    const copyBtnText = document.getElementById('copyBtnText');

    const tabMethodQR = document.getElementById('tabMethodQR');
    const tabMethodPhone = document.getElementById('tabMethodPhone');
    const guideQR = document.getElementById('guideQR');
    const guidePhone = document.getElementById('guidePhone');
    const waPhoneInputSection = document.getElementById('waPhoneInputSection');
    const inputWaPairPhone = document.getElementById('inputWaPairPhone');
    const btnGetPairingCode = document.getElementById('btnGetPairingCode');

    const btnRunBot = document.getElementById('btnRunBot');
    const btnStopBot = document.getElementById('btnStopBot');
    const btnRefreshQR = document.getElementById('btnRefreshQR');
    const toggleBotActive = document.getElementById('toggleBotActive');
    const botStatusMsg = document.getElementById('botStatusMessage');

    let currentPairMethod = 'qr'; // 'qr' | 'phone'

    function setPairingMethod(method) {
        currentPairMethod = method;
        if (method === 'qr') {
            if (tabMethodQR) tabMethodQR.classList.add('active');
            if (tabMethodPhone) tabMethodPhone.classList.remove('active');
            if (guideQR) guideQR.style.display = 'block';
            if (guidePhone) guidePhone.style.display = 'none';
            if (btnRunBot) btnRunBot.style.display = 'inline-flex';
            if (btnGetPairingCode) btnGetPairingCode.style.display = 'none';
            if (waPhoneInputSection) waPhoneInputSection.style.display = 'none';
            if (waPairingBox) waPairingBox.style.display = 'none';
            if (waDisconnectedMsg) waDisconnectedMsg.innerText = 'Klik "Jalankan Bot (QR)" untuk generate QR';
        } else {
            if (tabMethodPhone) tabMethodPhone.classList.add('active');
            if (tabMethodQR) tabMethodQR.classList.remove('active');
            if (guidePhone) guidePhone.style.display = 'block';
            if (guideQR) guideQR.style.display = 'none';
            if (btnGetPairingCode) btnGetPairingCode.style.display = 'inline-flex';
            if (btnRunBot) btnRunBot.style.display = 'none';
            if (waPhoneInputSection) waPhoneInputSection.style.display = 'block';
            if (waQrImage) waQrImage.style.display = 'none';
            if (waDisconnectedMsg) waDisconnectedMsg.innerText = 'Masukkan nomor HP & klik "Dapatkan Kode Pairing"';
        }
    }

    if (tabMethodQR) tabMethodQR.addEventListener('click', () => setPairingMethod('qr'));
    if (tabMethodPhone) tabMethodPhone.addEventListener('click', () => setPairingMethod('phone'));

    async function checkBotStatus() {
        if (!window.currentUserId) return;
        try {
            const res = await fetch(`/api/bot/status/${window.currentUserId}`);
            if (!res.ok) throw new Error('Network response was not ok');
            const data = await res.json();
            updateBotUI(data);
        } catch (error) {
            if (waBadge) {
                setBadge('disconnected', 'Backend Offline');
            }
        }
    }

    function setBadge(cls, text) {
        if (!waBadge) return;
        waBadge.className = `wa-status-badge ${cls}`;
        const dot = waBadge.querySelector('.wa-status-text');
        if (dot) dot.textContent = text;
        else waBadge.innerHTML = `<span class="wa-status-dot"></span><span class="wa-status-text">${text}</span>`;
    }

    function updateBotUI(data) {
        if (!data) return;

        if (toggleBotActive) {
            toggleBotActive.checked = data.isBotActive;
        }

        if (data.status === 'CONNECTED') {
            setBadge('connected', 'WhatsApp Terhubung');
            if (waDisconnectedState) waDisconnectedState.style.display = 'none';
            if (waConnectedState) waConnectedState.style.display = 'flex';
            if (waQrImage) waQrImage.style.display = 'none';
            if (waPairingBox) waPairingBox.style.display = 'none';
            if (waQrLoading) waQrLoading.style.display = 'none';
            if (botStatusMsg) {
                botStatusMsg.innerHTML = `<i class="ph-fill ph-check-circle" style="color:#22c55e;"></i><span>WhatsApp aktif terhubung — auto-reply siap melayani pelanggan!</span>`;
            }
        } else if (data.status === 'WAITING_PAIRING_CODE' || (data.pairingCode && data.status !== 'CONNECTED')) {
            setBadge('disconnected', 'Menunggu Pairing di HP');
            if (waDisconnectedState) waDisconnectedState.style.display = 'none';
            if (waConnectedState) waConnectedState.style.display = 'none';
            if (waQrImage) waQrImage.style.display = 'none';
            if (waQrLoading) waQrLoading.style.display = 'none';
            if (waPairingBox) {
                waPairingBox.style.display = 'flex';
                if (waPairingCodeText) waPairingCodeText.textContent = data.pairingCode;
            }
            if (botStatusMsg) {
                botStatusMsg.innerHTML = `<i class="ph-fill ph-key"></i><span>Masukkan kode <strong>${data.pairingCode}</strong> di WhatsApp ponsel Anda.</span>`;
            }
        } else if ((data.status === 'SCAN_QR' || data.status === 'qr') && data.qr) {
            setBadge('disconnected', 'Menunggu Scan QR');
            if (waDisconnectedState) waDisconnectedState.style.display = 'none';
            if (waConnectedState) waConnectedState.style.display = 'none';
            if (waQrLoading) waQrLoading.style.display = 'none';
            if (currentPairMethod === 'qr') {
                if (waPairingBox) waPairingBox.style.display = 'none';
                if (waQrImage) {
                    waQrImage.src = data.qr;
                    waQrImage.style.display = 'block';
                }
                if (botStatusMsg) {
                    botStatusMsg.innerHTML = `<i class="ph-fill ph-qr-code"></i><span>Silakan scan QR Code untuk menghubungkan WhatsApp.</span>`;
                }
            }
        } else {
            setBadge('disconnected', 'Bot Nonaktif');
            if (waConnectedState) waConnectedState.style.display = 'none';
            if (waDisconnectedState) waDisconnectedState.style.display = 'flex';
            if (waQrImage) waQrImage.style.display = 'none';
            if (waPairingBox) waPairingBox.style.display = 'none';
            if (waQrLoading) waQrLoading.style.display = 'none';
            if (botStatusMsg) {
                botStatusMsg.innerHTML = `<i class="ph ph-info"></i><span>Pilih metode dan jalankan bot untuk mulai menghubungkan WhatsApp.</span>`;
            }
        }
    }

    if (btnRunBot) {
        btnRunBot.addEventListener('click', async () => {
            showToast('Memulai bot WhatsApp...', 'info');
            if (waQrLoading) {
                if (waQrLoadingText) waQrLoadingText.textContent = 'Memuat QR Code...';
                waQrLoading.style.display = 'flex';
            }
            if (waDisconnectedState) waDisconnectedState.style.display = 'none';
            if (waPairingBox) waPairingBox.style.display = 'none';

            try {
                const res = await fetch('/api/bot/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: window.currentUserId })
                });
                const data = await res.json();

                if (res.ok) {
                    showToast('Bot WhatsApp berhasil dimulai!', 'success');
                    checkBotStatus();
                } else {
                    showToast(data.error || 'Gagal memulai bot', 'error');
                    if (waQrLoading) waQrLoading.style.display = 'none';
                    if (waDisconnectedState) waDisconnectedState.style.display = 'flex';
                }
            } catch (e) {
                if (waQrLoading) waQrLoading.style.display = 'none';
                if (waDisconnectedState) waDisconnectedState.style.display = 'flex';
                if (e.message === 'Failed to fetch' || e.name === 'TypeError') {
                    showToast('Server Backend offline, pastikan server aktif', 'error');
                } else {
                    showToast('Gagal memulai bot', 'error');
                }
            }
        });
    }

    if (btnGetPairingCode) {
        btnGetPairingCode.addEventListener('click', async () => {
            const rawPhone = inputWaPairPhone ? inputWaPairPhone.value.trim() : '';
            if (!rawPhone || rawPhone.replace(/\D/g, '').length < 9) {
                showToast('Masukkan nomor WhatsApp toko yang valid (contoh: 081234567890)', 'warning');
                if (inputWaPairPhone) inputWaPairPhone.focus();
                return;
            }

            const originalHtml = btnGetPairingCode.innerHTML;
            btnGetPairingCode.disabled = true;
            btnGetPairingCode.innerHTML = `<i class="ph ph-circle-notch" style="animation:spin 1s linear infinite;"></i> Menghubungkan...`;

            if (waQrLoading) {
                if (waQrLoadingText) waQrLoadingText.textContent = 'Menghubungi server WhatsApp...';
                waQrLoading.style.display = 'flex';
            }
            if (waDisconnectedState) waDisconnectedState.style.display = 'none';
            if (waPairingBox) waPairingBox.style.display = 'none';
            if (waQrImage) waQrImage.style.display = 'none';

            try {
                showToast('Meminta kode pairing WhatsApp...', 'info');
                const res = await fetch('/api/bot/pair-phone', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: window.currentUserId,
                        phoneNumber: rawPhone
                    })
                });

                const data = await res.json();
                if (waQrLoading) waQrLoading.style.display = 'none';

                if (res.ok && data.pairingCode) {
                    showToast('Kode pairing berhasil dibuat!', 'success');
                    if (waPairingBox) {
                        waPairingBox.style.display = 'flex';
                        if (waPairingCodeText) waPairingCodeText.textContent = data.pairingCode;
                    }
                    if (botStatusMsg) {
                        botStatusMsg.innerHTML = `<i class="ph-fill ph-key"></i><span>Masukkan kode <strong>${data.pairingCode}</strong> di WhatsApp ponsel Anda.</span>`;
                    }
                    checkBotStatus();
                } else if (res.ok && data.status === 'CONNECTED') {
                    showToast('WhatsApp sudah terhubung!', 'success');
                    checkBotStatus();
                } else {
                    showToast(data.error || 'Gagal mendapatkan kode pairing', 'error');
                    if (waDisconnectedState) waDisconnectedState.style.display = 'flex';
                }
            } catch (err) {
                if (waQrLoading) waQrLoading.style.display = 'none';
                if (waDisconnectedState) waDisconnectedState.style.display = 'flex';
                if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
                    showToast('Server backend offline', 'error');
                } else {
                    showToast(err.message || 'Gagal membuat kode pairing', 'error');
                }
            } finally {
                btnGetPairingCode.disabled = false;
                btnGetPairingCode.innerHTML = originalHtml;
            }
        });
    }

    if (btnCopyPairingCode) {
        btnCopyPairingCode.addEventListener('click', () => {
            const code = waPairingCodeText ? waPairingCodeText.textContent.trim() : '';
            if (!code || code.includes('-') && code.length < 8) return;

            const textToCopy = code.replace(/\s+/g, '');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textToCopy).then(() => {
                    handleCopySuccess();
                }).catch(() => fallbackCopy(textToCopy));
            } else {
                fallbackCopy(textToCopy);
            }
        });
    }

    function handleCopySuccess() {
        showToast('Kode pairing disalin ke clipboard!', 'success');
        if (copyBtnText) copyBtnText.textContent = 'Tersalin!';
        if (btnCopyPairingCode) {
            btnCopyPairingCode.innerHTML = `<i class="ph-fill ph-check"></i> <span id="copyBtnText">Tersalin!</span>`;
            setTimeout(() => {
                btnCopyPairingCode.innerHTML = `<i class="ph ph-copy"></i> <span id="copyBtnText">Salin Kode</span>`;
            }, 2500);
        }
    }

    function fallbackCopy(text) {
        const temp = document.createElement('input');
        temp.value = text;
        document.body.appendChild(temp);
        temp.select();
        try {
            document.execCommand('copy');
            handleCopySuccess();
        } catch (e) {
            showToast('Gagal menyalin kode secara otomatis', 'error');
        }
        document.body.removeChild(temp);
    }

    if (btnStopBot) {
        btnStopBot.addEventListener('click', async () => {
            if (!window.currentUserId) return;
            try {
                const res = await fetch('/api/bot/stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: window.currentUserId })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Gagal mematikan bot');
                showToast(data.message || 'Bot WhatsApp dimatikan', 'info');
                checkBotStatus();
            } catch (err) {
                if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
                    showToast('Server Backend offline', 'error');
                } else {
                    showToast(err.message || 'Gagal mematikan bot', 'error');
                }
            }
        });
    }

    const btnRelinkBot = document.getElementById('btnRelinkBot');
    if (btnRelinkBot) {
        btnRelinkBot.addEventListener('click', async () => {
            if (!window.currentUserId) return;
            if (!confirm('Anda yakin ingin keluar (logout) dari sesi WhatsApp ini? Anda harus menautkan ulang (scan QR atau kode pairing baru).')) return;
            try {
                showToast('Sedang menghapus sesi WhatsApp...', 'info');
                const res = await fetch('/api/bot/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: window.currentUserId })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Gagal menghapus sesi');
                showToast(data.message || 'Sesi dihapus', 'info');
                checkBotStatus();
            } catch (err) {
                if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
                    showToast('Server Backend offline', 'error');
                } else {
                    showToast(err.message || 'Gagal menghapus sesi bot', 'error');
                }
            }
        });
    }

    if (btnRefreshQR) {
        btnRefreshQR.addEventListener('click', () => {
            checkBotStatus();
            showToast('Status WhatsApp diperbarui', 'info');
        });
    }

    if (toggleBotActive) {
        toggleBotActive.addEventListener('change', async (e) => {
            const active = e.target.checked;
            try {
                await fetch('/api/bot/toggle-active', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ active })
                });
                showToast(active ? 'Auto-reply AI Diaktifkan' : 'Auto-reply AI Dimatikan', 'info');
            } catch (err) {
                showToast('Gagal mengubah mode bot', 'error');
            }
        });
    }

    // Auto poll bot status setiap 3 detik
    checkBotStatus();
    setInterval(checkBotStatus, 3000);

    // --- Resi Functions ---
    window.openResiModal = function (invoiceId, customerPhone) {
        document.getElementById('resiInvoiceId').value = invoiceId;
        document.getElementById('resiCustomerPhone').value = customerPhone;
        document.getElementById('resiCourier').value = '';
        document.getElementById('resiNumber').value = '';
        openModal('inputResiModal');
    };

    window.submitResi = async function () {
        const invoiceId = document.getElementById('resiInvoiceId').value;
        const customerPhone = document.getElementById('resiCustomerPhone').value;
        const courier = document.getElementById('resiCourier').value.trim();
        const resiNumber = document.getElementById('resiNumber').value.trim();
        const btn = document.getElementById('btnSubmitResi');

        if (!courier || !resiNumber) {
            showToast('Ekspedisi dan Nomor Resi wajib diisi', 'error');
            return;
        }

        if (btn) {
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Mengirim...';
            btn.disabled = true;
        }

        try {
            const response = await fetch('/api/admin/update-resi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: window.currentUserId,
                    invoiceId: invoiceId,
                    customerPhone: customerPhone,
                    courier: courier,
                    resiNumber: resiNumber
                })
            });

            const data = await response.json();
            if (response.ok) {
                showToast('Resi berhasil dikirim ke pelanggan!', 'success');
                closeModal('inputResiModal');
            } else {
                throw new Error(data.error || 'Terjadi kesalahan');
            }
        } catch (err) {
            showToast(err.message, 'error');
        }

        if (btn) {
            btn.innerHTML = 'Kirim Resi ke Pelanggan';
            btn.disabled = false;
        }
    };
});
