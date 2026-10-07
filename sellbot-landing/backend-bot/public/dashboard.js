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
        window.currentUserCreatedAt = activeUser.created_at;

        // --- Profile Display Logic ---
        const userMeta = activeUser.user_metadata || {};
        const storeName = userMeta.store_name || localStorage.getItem('storeName') || 'Toko Anda';
        const profilePhoto = localStorage.getItem('profilePhoto');
        const plan = userMeta.plan || 'Trial';

        const planBadge = document.getElementById('currentPlanBadge');
        if (planBadge) {
            const planText = plan.toLowerCase() === 'trial' ? 'Trial (1 Hari / 100 Kredit)' : (plan.charAt(0).toUpperCase() + plan.slice(1));
            planBadge.innerHTML = `<i class="ph-fill ph-check-circle"></i> Current Plan: ${planText}`;
        }

        // Tampilkan pop up selamat datang trial 1 hari (100 kredit) jika user pada paket trial
        if (localStorage.getItem('showTrialWelcomeModal') === 'true' || (plan.toLowerCase() === 'trial' && !sessionStorage.getItem('trialWelcomeShown'))) {
            setTimeout(() => {
                if (typeof openModal === 'function') {
                    openModal('trialWelcomeModal');
                    sessionStorage.setItem('trialWelcomeShown', 'true');
                    localStorage.removeItem('showTrialWelcomeModal');
                }
            }, 700);
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
            const btnOrigin = document.getElementById('btnSaveOriginSetting');

            if (btnSysPrompt) await btnSysPrompt.click();
            if (btnKnowledge) await btnKnowledge.click();
            if (btnOrigin) await btnOrigin.click();

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
        const weight = parseInt(weightStr.replace(/[^0-9]/g, ''), 10) || 250;
        const stock = parseInt(stockStr.replace(/[^0-9]/g, ''), 10) || 0;

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
                    // Reset cache AI di backend agar produk yang dihapus tidak diingat kembali
                    if (window.currentUserId) {
                        fetch('/api/chat/clear-cache', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: window.currentUserId })
                        }).catch(() => {});
                    }
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

                    const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
                    let nameIdx = header.findIndex(h => h.includes('nama') || h.includes('produk') || h.includes('title') || h === 'name');
                    let varIdx = header.findIndex(h => h.includes('varian') || h.includes('variant'));
                    let priceIdx = header.findIndex(h => h.includes('harga') || h.includes('price'));
                    let weightIdx = header.findIndex(h => h.includes('berat') || h.includes('weight') || h.includes('gram'));
                    let stockIdx = header.findIndex(h => h.includes('stok') || h.includes('stock') || h.includes('qty'));

                    const rows = lines.slice(1);
                    const newProducts = [];
                    for (const row of rows) {
                        const cols = row.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
                        if (cols.length >= 2) {
                            let name = '';
                            let variant = '';
                            let price = 100000;
                            let weight = 250;
                            let stock = 50;

                            if (nameIdx !== -1) {
                                name = cols[nameIdx] || '';
                                variant = varIdx !== -1 ? (cols[varIdx] || '') : '';
                                if (priceIdx !== -1 && cols[priceIdx]) price = parseInt(cols[priceIdx].replace(/[^0-9]/g, ''), 10) || 100000;
                                if (weightIdx !== -1 && cols[weightIdx]) {
                                    const wm = cols[weightIdx].match(/\d+/);
                                    weight = wm ? parseInt(wm[0], 10) : 250;
                                }
                                if (stockIdx !== -1 && cols[stockIdx]) stock = parseInt(cols[stockIdx].replace(/[^0-9]/g, ''), 10) || 50;
                            } else {
                                // Jika tidak ada header terdeteksi, periksa apakah kolom 0 adalah nomor urut (1, 2, 3...)
                                const col0IsNum = /^\d+$/.test(cols[0]);
                                if (col0IsNum && cols[1]) {
                                    name = cols[1];
                                    variant = cols[2] && isNaN(cols[2].replace(/[^0-9]/g, '')) ? cols[2] : '';
                                    const nextIdx = variant ? 3 : 2;
                                    price = parseInt(cols[nextIdx]?.replace(/[^0-9]/g, ''), 10) || 100000;
                                    const wm = cols[nextIdx + 1]?.match(/\d+/);
                                    weight = wm ? parseInt(wm[0], 10) : 250;
                                    stock = parseInt(cols[nextIdx + 2]?.replace(/[^0-9]/g, ''), 10) || 50;
                                } else {
                                    name = cols[0];
                                    variant = cols[1] || '';
                                    price = parseInt(cols[2]?.replace(/[^0-9]/g, ''), 10) || 100000;
                                    const wm = cols[3]?.match(/\d+/);
                                    weight = wm ? parseInt(wm[0], 10) : 250;
                                    stock = parseInt(cols[4]?.replace(/[^0-9]/g, ''), 10) || 50;
                                }
                            }

                            if (name) {
                                newProducts.push({
                                    user_id: window.currentUserId,
                                    name,
                                    variant,
                                    price,
                                    weight,
                                    stock
                                });
                            }
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

                // Ambil store_rules yang ada agar tidak terhapus (termasuk tag asal pengiriman)
                const { data: existingKb } = await window.supabaseClient
                    .from('knowledge_base')
                    .select('store_rules')
                    .eq('user_id', user_id)
                    .single();

                const { error } = await window.supabaseClient
                    .from('knowledge_base')
                    .upsert({
                        user_id: user_id,
                        system_prompt: content,
                        store_rules: existingKb?.store_rules || ''
                    }, { onConflict: 'user_id' });

                if (!error) {
                    showToast('System Prompt berhasil disimpan! AI akan otomatis mengikuti instruksi ini.', 'success');
                    // Reset cache percakapan di server agar sistem prompt baru langsung aktif
                    if (user_id || window.currentUserId) {
                        fetch('/api/chat/clear-cache', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: user_id || window.currentUserId })
                        }).catch(() => {});
                    }
                } else {
                    showToast('Gagal menyimpan System Prompt: ' + error.message, 'error');
                }
            } catch (err) {
                showToast('Terjadi kesalahan: ' + err.message, 'error');
            }
            btnSaveSystemPrompt.innerHTML = originalText;
            btnSaveSystemPrompt.disabled = false;
        });
    }

    // =============================================
    // 1B. PENGATURAN ASAL PENGIRIMAN TOKO (ORIGIN)
    // =============================================
    function initOriginSettings() {
        const inputSearch = document.getElementById('inputOriginSearch');
        const btnSearch = document.getElementById('btnSearchOriginAction');
        const dropdown = document.getElementById('originSearchDropdown');
        const idInput = document.getElementById('selectedOriginId');
        const nameInput = document.getElementById('selectedOriginName');
        const activeDisplay = document.getElementById('activeOriginNameDisplay');
        const btnSave = document.getElementById('btnSaveOriginSetting');
        const btnReset = document.getElementById('btnResetOrigin');

        let debounceTimer = null;

        async function performOriginSearch(query) {
            if (!query || query.trim().length < 2) {
                if (dropdown) dropdown.style.display = 'none';
                return;
            }

            if (dropdown) {
                dropdown.style.display = 'block';
                dropdown.innerHTML = '<div class="origin-dropdown-empty"><i class="ph ph-spinner ph-spin"></i> Mencari kota / kecamatan...</div>';
            }

            try {
                const res = await fetch(`/api/shipping/destination?search=${encodeURIComponent(query.trim())}`);
                const json = await res.json();
                const list = json?.data || [];

                if (!dropdown) return;

                if (list.length === 0) {
                    dropdown.innerHTML = '<div class="origin-dropdown-empty">Kota/kecamatan tidak ditemukan. Coba kata kunci lain.</div>';
                    return;
                }

                dropdown.innerHTML = '';
                list.slice(0, 10).forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'origin-dropdown-item';
                    const labelText = item.label || `${item.subdistrict_name || ''}, ${item.city_name || ''}`;
                    div.innerHTML = `<i class="ph-fill ph-map-pin"></i> <span>${labelText}</span>`;
                    div.addEventListener('click', () => {
                        const destId = item.id || item.subdistrict_id || item.city_id;
                        if (idInput) idInput.value = destId;
                        if (nameInput) nameInput.value = labelText;
                        if (inputSearch) inputSearch.value = labelText;
                        dropdown.style.display = 'none';
                        showToast(`Dipilih: ${labelText}. Klik "Simpan Asal Pengiriman" untuk menerapkan.`, 'info');
                    });
                    dropdown.appendChild(div);
                });
            } catch (err) {
                if (dropdown) dropdown.innerHTML = '<div class="origin-dropdown-empty">Gagal memuat destinasi.</div>';
            }
        }

        if (inputSearch) {
            inputSearch.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                const val = e.target.value.trim();
                if (val.length < 2) {
                    if (dropdown) dropdown.style.display = 'none';
                    return;
                }
                debounceTimer = setTimeout(() => {
                    performOriginSearch(val);
                }, 350);
            });

            inputSearch.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    performOriginSearch(inputSearch.value.trim());
                }
            });
        }

        if (btnSearch) {
            btnSearch.addEventListener('click', () => {
                if (inputSearch) performOriginSearch(inputSearch.value.trim());
            });
        }

        // Tutup dropdown jika klik di luar
        document.addEventListener('click', (e) => {
            if (dropdown && !dropdown.contains(e.target) && e.target !== inputSearch && e.target !== btnSearch) {
                dropdown.style.display = 'none';
            }
        });

        // Reset ke Default Surabaya
        if (btnReset) {
            btnReset.addEventListener('click', async () => {
                if (idInput) idInput.value = '254';
                if (nameInput) nameInput.value = 'Surabaya (Default)';
                if (inputSearch) inputSearch.value = '';
                if (activeDisplay) activeDisplay.textContent = 'Surabaya (Default)';

                if (window.currentUserId) {
                    try {
                        await fetch('/api/shipping/origin', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                userId: window.currentUserId,
                                originId: 254,
                                originName: 'Surabaya (Default)'
                            })
                        });
                    } catch (e) {}
                }
                showToast('Asal pengiriman dikembalikan ke default (Surabaya)', 'success');
            });
        }

        // Simpan Asal Pengiriman
        if (btnSave) {
            btnSave.addEventListener('click', async () => {
                const originId = idInput?.value || 254;
                const originName = nameInput?.value || 'Surabaya (Default)';

                const origText = btnSave.innerHTML;
                btnSave.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Menyimpan...';
                btnSave.disabled = true;

                try {
                    if (!window.currentUserId) {
                        const { data: { session } } = await window.supabaseClient.auth.getSession();
                        if (session?.user?.id) window.currentUserId = session.user.id;
                    }

                    if (!window.currentUserId) throw new Error("Silakan login terlebih dahulu.");

                    const res = await fetch('/api/shipping/origin', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: window.currentUserId,
                            originId: Number(originId),
                            originName: originName
                        })
                    });

                    const json = await res.json();
                    if (!json.success) throw new Error(json.message || "Gagal menyimpan");

                    if (activeDisplay) activeDisplay.textContent = originName;
                    localStorage.setItem('user_shipping_origin_id', originId);
                    localStorage.setItem('user_shipping_origin_name', originName);

                    showToast(`Asal pengiriman berhasil disimpan! AI akan menghitung ongkir dari ${originName}.`, 'success');
                } catch (err) {
                    showToast('Gagal menyimpan: ' + err.message, 'error');
                }

                btnSave.innerHTML = origText;
                btnSave.disabled = false;
            });
        }
    }

    initOriginSettings();


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
    const PLAN_INFO = {
        'Starter': { name: 'Starter', price: 'Rp 99.000', priceNum: 99000, credits: '3.000 AI Credit / bulan' },
        'Pro': { name: 'Pro', price: 'Rp 199.000', priceNum: 199000, credits: '8.000 AI Credit / bulan' },
        'Business': { name: 'Business', price: 'Rp 399.000', priceNum: 399000, credits: '20.000 AI Credit / bulan' },
        'Agency': { name: 'Agency', price: 'Rp 999.000', priceNum: 999000, credits: '50.000 AI Credit / bulan' }
    };

    let selectedPlan = 'Pro'; // Default fallback

    window.selectPlan = function(planName) {
        selectedPlan = planName || 'Pro';
        const plan = PLAN_INFO[selectedPlan] || PLAN_INFO['Pro'];
        
        const nameEl = document.getElementById('checkoutPlanName');
        const priceEl = document.getElementById('checkoutPlanPrice');
        const creditsEl = document.getElementById('checkoutPlanCredits');
        
        if (nameEl) nameEl.innerText = `Paket ${plan.name}`;
        if (priceEl) priceEl.innerText = plan.price;
        if (creditsEl) creditsEl.innerText = plan.credits;

        openModal('checkoutModal');
    };

    window.openUpgradePlanModal = function() {
        const currentPlan = (localStorage.getItem('user_plan') || 'Starter').toLowerCase();
        let nextPlan = 'Pro';
        if (currentPlan === 'trial' || currentPlan === 'starter') nextPlan = 'Pro';
        else if (currentPlan === 'pro') nextPlan = 'Business';
        else if (currentPlan === 'business') nextPlan = 'Agency';
        else nextPlan = 'Agency';
        window.selectPlan(nextPlan);
    };

    window.updateBillingPlanButtons = function(currentPlan) {
        const activePlan = (currentPlan || localStorage.getItem('user_plan') || 'Starter').trim();
        const activePlanLower = activePlan.toLowerCase();

        const cards = document.querySelectorAll('#billing .pricing-card');
        cards.forEach(card => {
            const cardPlan = card.getAttribute('data-plan') || '';
            const isCurrent = cardPlan.toLowerCase() === activePlanLower;
            const btn = card.querySelector('.plan-action-btn') || card.querySelector('button');

            // Hapus badge aktif lama jika ada
            const existingBadge = card.querySelector('.current-plan-badge');
            if (existingBadge) existingBadge.remove();

            if (isCurrent) {
                card.classList.add('current-plan');
                const activeBadge = document.createElement('div');
                activeBadge.className = 'current-plan-badge';
                activeBadge.innerHTML = '<i class="ph-fill ph-check-circle"></i> Sedang Digunakan';
                card.appendChild(activeBadge);

                if (btn) {
                    btn.className = 'btn btn-current-plan full-width';
                    btn.innerHTML = '<i class="ph-fill ph-check-circle"></i> Sedang Digunakan';
                    btn.disabled = true;
                    btn.removeAttribute('onclick');
                    btn.style.cursor = 'default';
                }
            } else {
                card.classList.remove('current-plan');
                if (btn) {
                    const isFeatured = card.classList.contains('featured');
                    btn.className = `btn ${isFeatured ? 'btn-primary' : 'btn-outline'} full-width plan-action-btn`;
                    btn.innerHTML = 'Pilih Paket';
                    btn.disabled = false;
                    btn.setAttribute('onclick', `selectPlan('${cardPlan}')`);
                    btn.style.cursor = 'pointer';
                }
            }
        });
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

            const selectedRadio = document.querySelector('input[name="paymentMethod"]:checked');
            const chosenMethod = selectedRadio ? selectedRadio.value : 'qris';

            // Call Backend API to create Midtrans transaction
            const response = await fetch('/api/payment/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan: selectedPlan,
                    userId: user.id,
                    email: user.email,
                    name: localStorage.getItem('storeName') || 'User',
                    phone: user.user_metadata?.phone || '',
                    paymentMethod: chosenMethod
                })
            });

            let result = null;
            try {
                result = await response.json();
            } catch (jsonErr) {
                const rawText = await response.text().catch(() => '');
                console.error('Non-JSON response dari server payment:', rawText);
                result = {
                    success: false,
                    message: response.status === 401 
                        ? 'Autentikasi Midtrans Gagal (HTTP 401): Server Key tidak valid atau mode Sandbox/Production tidak sesuai.'
                        : `Gagal memproses transaksi pembayaran (Server status: ${response.status}).`
                };
            }

            if (result && result.success && result.token) {
                // Pastikan Midtrans Snap SDK ter-load
                if (typeof window.snap === 'undefined' || typeof window.snap.pay !== 'function') {
                    try {
                        const cfgRes = await fetch('/api/payment/config');
                        const cfg = await cfgRes.json();
                        if (cfg && cfg.clientKey) {
                            await new Promise((resolve) => {
                                const script = document.createElement('script');
                                script.src = cfg.isProduction
                                    ? 'https://app.midtrans.com/snap/snap.js'
                                    : 'https://app.sandbox.midtrans.com/snap/snap.js';
                                script.setAttribute('data-client-key', cfg.clientKey);
                                script.onload = () => resolve(true);
                                script.onerror = () => resolve(false);
                                document.head.appendChild(script);
                            });
                        }
                    } catch (e) {
                        console.warn('Gagal memuat snap.js otomatis:', e);
                    }
                }

                // Close checkout modal
                closeModal('checkoutModal');
                
                if (window.snap && typeof window.snap.pay === 'function') {
                    // Open Midtrans Snap Popup
                    window.snap.pay(result.token, {
                        onSuccess: function(payResult){
                            showToast('Pembayaran berhasil! Kredit Anda akan segera ditambahkan.', 'success');
                            setTimeout(() => window.location.reload(), 2000);
                        },
                        onPending: function(payResult){
                            showToast('Menunggu penyelesaian pembayaran Anda.', 'warning');
                        },
                        onError: function(payResult){
                            showToast('Pembayaran gagal atau dibatalkan.', 'error');
                        },
                        onClose: function(){
                            showToast('Anda menutup pembayaran sebelum selesai.', 'warning');
                        }
                    });
                } else if (result.redirect_url) {
                    // Fallback jika Snap Popup tidak terbuka di browser
                    window.location.href = result.redirect_url;
                } else {
                    showToast('Snap Midtrans belum siap. Periksa konfigurasi kredensial.', 'error');
                }
            } else {
                let errMsg = (result && result.message) || 'Gagal membuat transaksi pembayaran.';
                if ((result && result.rawError && result.rawError.includes('401')) || (result && result.is401)) {
                    errMsg = 'Autentikasi Midtrans Gagal (HTTP 401): Server Key tidak valid atau mode Sandbox/Production tidak sesuai. Mohon periksa kembali kredensial di Environment Variables.';
                }
                showToast(errMsg, 'error');
            }
        } catch (error) {
            console.error('Payment Error:', error);
            showToast(error.message || 'Terjadi kesalahan pada sistem pembayaran.', 'error');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    };

    // =============================================
    // 6. CHAT HISTORY DETAIL MODAL
    // =============================================
    window.openChatDetail = async function (phone, name) {
        window.currentViewingCustomerPhone = phone;
        window.currentViewingCustomerName = name;

        // Remove active class from all items
        document.querySelectorAll('.chat-customer-item').forEach(el => el.classList.remove('active'));
        // Add active class to the selected item if it exists in the list
        const listItem = document.querySelector(`.chat-customer-item[data-phone="${phone}"]`);
        if (listItem) listItem.classList.add('active');

        const custTitleEl = document.getElementById('chatViewerTitle');
        const custPhoneEl = document.getElementById('chatViewerPhone');
        const avatarEl = document.getElementById('chatViewerAvatar');
        const btnDeleteCurrent = document.getElementById('btnDeleteCurrentChat');
        const container = document.getElementById('chatMessagesContainer2');

        if (!container) return;

        if (custTitleEl) custTitleEl.innerText = name || phone || 'Pelanggan';
        if (custPhoneEl) custPhoneEl.innerText = phone || '-';
        if (avatarEl) {
            avatarEl.style.display = 'flex';
            avatarEl.innerText = (name || phone || 'CS').substring(0, 2).toUpperCase();
        }
        if (btnDeleteCurrent) {
            btnDeleteCurrent.style.display = 'inline-flex';
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

        initChatActions();
    }

    // Helper untuk reset tampilan chat viewer
    window.resetChatViewer = function () {
        window.currentViewingCustomerPhone = null;
        window.currentViewingCustomerName = null;
        const custTitleEl = document.getElementById('chatViewerTitle');
        const custPhoneEl = document.getElementById('chatViewerPhone');
        const avatarEl = document.getElementById('chatViewerAvatar');
        const container = document.getElementById('chatMessagesContainer2');
        const btnDeleteCurrent = document.getElementById('btnDeleteCurrentChat');

        if (custTitleEl) custTitleEl.innerText = 'Pilih pelanggan untuk melihat chat';
        if (custPhoneEl) custPhoneEl.innerText = '';
        if (avatarEl) avatarEl.style.display = 'none';
        if (btnDeleteCurrent) btnDeleteCurrent.style.display = 'none';
        if (container) {
            container.innerHTML = `
                <div class="empty-chat-state" style="text-align: center; margin: auto; color: var(--text-secondary);">
                    <i class="ph ph-chats" style="font-size: 48px; opacity: 0.2; margin-bottom: 8px; display: block;"></i>
                    <p>Riwayat chat akan muncul di sini</p>
                </div>
            `;
        }
    };

    // Inisialisasi tombol hapus riwayat chat pelanggan & reset semua chat
    function initChatActions() {
        const btnDeleteCurrentChat = document.getElementById('btnDeleteCurrentChat');
        if (btnDeleteCurrentChat && !btnDeleteCurrentChat.dataset.initialized) {
            btnDeleteCurrentChat.dataset.initialized = 'true';
            btnDeleteCurrentChat.addEventListener('click', async () => {
                const phone = window.currentViewingCustomerPhone;
                if (!phone) return;

                if (!confirm(`Hapus riwayat chat pelanggan (${phone})?\n\nKonteks riwayat di database dan memori percakapan bot AI untuk nomor ini akan dihapus bersih.`)) {
                    return;
                }

                const origHtml = btnDeleteCurrentChat.innerHTML;
                btnDeleteCurrentChat.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Menghapus...';
                btnDeleteCurrentChat.disabled = true;

                try {
                    const resp = await fetch('/api/chat/clear', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: window.currentUserId,
                            customerPhone: phone
                        })
                    });

                    if (!resp.ok) {
                        await window.supabaseClient
                            .from('chats')
                            .delete()
                            .eq('user_id', window.currentUserId)
                            .eq('customer_phone', phone);
                    }

                    showToast(`Riwayat chat ${phone} berhasil dihapus & memori AI direset!`, 'success');
                    window.resetChatViewer();
                    await loadChatHistoryCustomers();
                } catch (err) {
                    console.error('Error clearing chat:', err);
                    try {
                        await window.supabaseClient
                            .from('chats')
                            .delete()
                            .eq('user_id', window.currentUserId)
                            .eq('customer_phone', phone);
                        showToast(`Riwayat chat ${phone} berhasil dihapus dari database!`, 'success');
                        window.resetChatViewer();
                        await loadChatHistoryCustomers();
                    } catch (supaErr) {
                        showToast('Gagal menghapus riwayat chat: ' + err.message, 'error');
                    }
                } finally {
                    btnDeleteCurrentChat.innerHTML = origHtml;
                    btnDeleteCurrentChat.disabled = false;
                }
            });
        }

        const btnResetAllChats = document.getElementById('btnResetAllChats');
        if (btnResetAllChats && !btnResetAllChats.dataset.initialized) {
            btnResetAllChats.dataset.initialized = 'true';
            btnResetAllChats.addEventListener('click', async () => {
                if (!confirm('Peringatan: Hapus SEMUA riwayat chat pelanggan dan reset seluruh ingatan AI?\n\nTindakan ini akan mengosongkan seluruh log pesan dan riwayat AI.')) {
                    return;
                }

                const origHtml = btnResetAllChats.innerHTML;
                btnResetAllChats.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
                btnResetAllChats.disabled = true;

                try {
                    const resp = await fetch('/api/chat/clear', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: window.currentUserId,
                            clearAll: true
                        })
                    });

                    if (!resp.ok) {
                        await window.supabaseClient
                            .from('chats')
                            .delete()
                            .eq('user_id', window.currentUserId);
                    }

                    showToast('Semua riwayat chat berhasil dibersihkan & ingatan bot direset!', 'success');
                    window.resetChatViewer();
                    await loadChatHistoryCustomers();
                } catch (err) {
                    console.error('Error resetting all chats:', err);
                    try {
                        await window.supabaseClient
                            .from('chats')
                            .delete()
                            .eq('user_id', window.currentUserId);
                        showToast('Semua riwayat chat di database berhasil dihapus!', 'success');
                        window.resetChatViewer();
                        await loadChatHistoryCustomers();
                    } catch (supaErr) {
                        showToast('Gagal mereset chat: ' + err.message, 'error');
                    }
                } finally {
                    btnResetAllChats.innerHTML = origHtml;
                    btnResetAllChats.disabled = false;
                }
            });
        }
    }

    // =============================================
    // 6.5 RENDER GRAFIK INTERAKSI PESAN (RIIL DARI DATABASE)
    // =============================================
    window.renderInteractionChart = function (days = 7) {
        const container = document.getElementById('chartContainer');
        if (!container) return;

        const chats = window.userChatsHistory || [];
        const buckets = [];
        const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const dateKey = `${yyyy}-${mm}-${dd}`;
            const label = days <= 7 ? dayNames[d.getDay()] : `${d.getDate()}/${d.getMonth() + 1}`;
            const fullDate = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });

            buckets.push({
                dateKey,
                label,
                fullDate,
                count: 0
            });
        }

        // Agregasi pesan per hari dari tabel chats
        chats.forEach(c => {
            if (!c.created_at) return;
            const cDate = c.created_at.split('T')[0];
            const b = buckets.find(item => item.dateKey === cDate);
            if (b) b.count++;
        });

        const maxCount = Math.max(...buckets.map(b => b.count), 1);

        container.innerHTML = '';
        buckets.forEach(b => {
            const barWrapper = document.createElement('div');
            barWrapper.style.cssText = 'flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; position: relative;';

            // Hitung tinggi persen (minimal 6% agar bar selalu rapi dan terlihat)
            const heightPercent = b.count === 0 ? 5 : Math.max(12, Math.round((b.count / maxCount) * 88));
            const isHighest = b.count > 0 && b.count === maxCount;
            const bgGradient = isHighest
                ? 'linear-gradient(180deg, var(--primary) 0%, rgba(99, 102, 241, 0.4) 100%)'
                : 'linear-gradient(180deg, rgba(99, 102, 241, 0.8) 0%, rgba(99, 102, 241, 0.15) 100%)';
            const shadow = isHighest ? 'box-shadow: 0 -4px 12px rgba(99, 102, 241, 0.3);' : '';

            barWrapper.innerHTML = `
                <div style="width: 100%; max-width: 48px; height: ${heightPercent}%; background: ${bgGradient}; border-radius: 6px 6px 0 0; transition: all 0.3s ease; cursor: pointer; ${shadow}"
                     title="${b.count} Pesan (${b.fullDate})">
                </div>
                <span style="margin-top: 8px; font-size: ${days > 7 ? '10px' : '12px'}; color: ${isHighest ? 'var(--primary)' : 'var(--text-secondary)'}; font-weight: ${isHighest ? '700' : '500'}; white-space: nowrap;">
                    ${b.label}
                </span>
            `;

            container.appendChild(barWrapper);
        });
    };

    // =============================================
    // 7. FETCH ALL DASHBOARD DATA
    // =============================================
    async function fetchDashboardData() {
        try {
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (!session) return;
            const user_id = session.user.id;

            // 1. Stats Metrics Element
            const statTotalChats = document.getElementById('statTotalChats');
            const statAutoReply = document.getElementById('statAutoReply');
            const statOrdersClosed = document.getElementById('statOrdersClosed');
            const perfAiRate = document.getElementById('perfAiRate');
            const perfAdminRate = document.getElementById('perfAdminRate');
            const perfFailedRate = document.getElementById('perfFailedRate');

            // Ambil seluruh percakapan user untuk menghitung statistik riil
            const { data: userChats, error: chatsError } = await window.supabaseClient
                .from('chats')
                .select('sender, status, message, created_at')
                .eq('user_id', user_id);

            const allChats = userChats || [];
            window.userChatsHistory = allChats;

            // A. Total Chat (Bulan Ini)
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const chatsThisMonth = allChats.filter(c => c.created_at && new Date(c.created_at) >= startOfMonth);
            const displayChatCount = chatsThisMonth.length > 0 ? chatsThisMonth.length : allChats.length;
            if (statTotalChats) statTotalChats.innerText = displayChatCount.toLocaleString('id-ID');

            // B. Auto-reply Rate Riil (Rasio balasan AI terhadap pesan pelanggan)
            const totalCustMsgs = allChats.filter(c => c.sender === 'customer').length;
            const totalAiReplies = allChats.filter(c => c.sender === 'ai').length;
            let autoReplyPercent = 100;
            if (totalCustMsgs > 0) {
                autoReplyPercent = Math.min(100, Math.round((totalAiReplies / totalCustMsgs) * 100));
            } else if (allChats.length === 0) {
                autoReplyPercent = 100;
            }
            if (statAutoReply) statAutoReply.innerText = `${autoReplyPercent}%`;

            // C. Performa AI Breakdown Riil
            const totalAiHandled = allChats.filter(c => c.sender === 'ai' && (c.status === 'handled_by_ai' || c.status === 'sent' || !c.status)).length;
            const totalAdminEscalated = allChats.filter(c => c.status === 'escalated_to_admin' || (c.message && c.message.includes('PANGGILAN ADMIN'))).length;
            const totalFailed = allChats.filter(c => c.status === 'failed').length;
            const totalEvents = totalAiHandled + totalAdminEscalated + totalFailed;

            let pctAi = 100;
            let pctAdmin = 0;
            let pctFailed = 0;
            if (totalEvents > 0) {
                pctAi = Math.round((totalAiHandled / totalEvents) * 100);
                pctAdmin = Math.round((totalAdminEscalated / totalEvents) * 100);
                pctFailed = Math.max(0, 100 - pctAi - pctAdmin);
            }
            if (perfAiRate) perfAiRate.innerText = `${pctAi}%`;
            if (perfAdminRate) perfAdminRate.innerText = `${pctAdmin}%`;
            if (perfFailedRate) perfFailedRate.innerText = `${pctFailed}%`;

            // D. Render Grafik Interaksi Pesan Riil
            const rangeSelect = document.getElementById('chartTimeRange');
            const selectedDays = rangeSelect ? parseInt(rangeSelect.value) || 7 : 7;
            renderInteractionChart(selectedDays);

            // E. Order Closed Riil dari tabel invoices
            try {
                const { count: orderCount, error: orderErr } = await window.supabaseClient
                    .from('invoices')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', user_id);

                if (!orderErr && statOrdersClosed) {
                    statOrdersClosed.innerText = (orderCount || 0).toLocaleString('id-ID');
                } else if (statOrdersClosed) {
                    statOrdersClosed.innerText = '0';
                }
            } catch (invErr) {
                if (statOrdersClosed) statOrdersClosed.innerText = '0';
            }

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
                                <td class="price-cell" style="white-space: nowrap;">Rp&nbsp;${p.price.toLocaleString('id-ID')}</td>
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
                if (systemPromptInput) {
                    let combined = knowledge.system_prompt || '';
                    if (combined.includes('===CONFIG===\n')) {
                        combined = combined.split('===CONFIG===\n')[0].trim();
                    }
                    if (knowledge.store_rules) {
                        // Bersihkan tag teknis ASAL_PENGIRIMAN dari textarea prompt jika ada
                        const cleanRules = knowledge.store_rules.replace(/===ASAL_PENGIRIMAN===[\s\S]*?===END_ASAL_PENGIRIMAN===\n?/g, '').trim();
                        if (cleanRules) combined += (combined ? '\n\n' : '') + cleanRules;
                    }
                    systemPromptInput.value = combined;
                }

                // Load Asal Pengiriman Toko
                try {
                    let savedOriginId = 254;
                    let savedOriginName = 'Surabaya (Default)';
                    const res = await fetch(`/api/shipping/origin/${user_id}`);
                    const origJson = await res.json();
                    if (origJson?.success && origJson.data?.originName) {
                        savedOriginId = origJson.data.originId;
                        savedOriginName = origJson.data.originName;
                    } else if (knowledge.store_rules) {
                        const matchId = knowledge.store_rules.match(/ORIGIN_ID:\s*(\d+)/i);
                        const matchName = knowledge.store_rules.match(/ORIGIN_NAME:\s*([^\n\r]+)/i);
                        if (matchId) savedOriginId = Number(matchId[1]);
                        if (matchName) savedOriginName = matchName[1].trim();
                    }

                    const disp = document.getElementById('activeOriginNameDisplay');
                    if (disp) disp.textContent = savedOriginName;
                    const idEl = document.getElementById('selectedOriginId');
                    if (idEl) idEl.value = savedOriginId;
                    const nameEl = document.getElementById('selectedOriginName');
                    if (nameEl) nameEl.value = savedOriginName;
                } catch (origErr) {
                    console.warn('Gagal memuat asal pengiriman:', origErr);
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

            // Ambil paket aktif dari invoice sukses terakhir di Supabase jika ada
            try {
                const { data: latestInvoice } = await window.supabaseClient
                    .from('invoices')
                    .select('plan_name, credits_added')
                    .eq('user_id', user_id)
                    .eq('status', 'success')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (latestInvoice && latestInvoice.plan_name) {
                    localStorage.setItem('user_plan', latestInvoice.plan_name);
                }
            } catch (invErr) {}

            // Ambil paket aktif dari metadata user atau localStorage
            const userPlan = localStorage.getItem('user_plan') || 'Starter';
            let totalQuota = 3000;
            const planLower = userPlan.toLowerCase();
            if (planLower === 'trial') totalQuota = 100;
            else if (planLower === 'starter') totalQuota = 3000;
            else if (planLower === 'pro') totalQuota = 8000;
            else if (planLower === 'business') totalQuota = 20000;
            else if (planLower === 'agency') totalQuota = 50000;

            const remainingCredits = Math.max(0, totalQuota - usedCredits);
            const percentLeft = Math.min(100, Math.max(0, Math.round((remainingCredits / totalQuota) * 100)));

            // Kalkulasi masa aktif trial 1 hari (24 jam)
            const createdAtStr = window.currentUserCreatedAt;
            const regTime = createdAtStr ? new Date(createdAtStr).getTime() : Date.now();
            const now = Date.now();
            const elapsedMs = now - regTime;
            const trialDurationMs = 24 * 60 * 60 * 1000; // 24 jam
            const isTimeExpired = (planLower === 'trial') && (elapsedMs >= trialDurationMs);
            const isQuotaExpired = remainingCredits <= 0;
            const isTrialExpired = (planLower === 'trial') && (isTimeExpired || isQuotaExpired);

            const msLeft = Math.max(0, trialDurationMs - elapsedMs);
            const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
            const minsLeft = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));

            // Jika masa trial telah berakhir atau kuota trial habis
            if (isTrialExpired) {
                const btnRunBot = document.getElementById('btnRunBot');
                const toggleBotActive = document.getElementById('toggleBotActive');
                if (btnRunBot) {
                    btnRunBot.disabled = true;
                    btnRunBot.classList.add('disabled');
                    btnRunBot.style.opacity = '0.5';
                    btnRunBot.style.cursor = 'not-allowed';
                    btnRunBot.title = 'Masa trial telah berakhir. Silakan pilih paket langganan.';
                }
                if (toggleBotActive) {
                    toggleBotActive.checked = false;
                    toggleBotActive.disabled = true;
                }

                // Tampilkan popup Trial Expired jika belum di-dismiss pada sesi ini
                if (typeof openModal === 'function' && !sessionStorage.getItem('trialExpiredModalDismissed')) {
                    const descEl = document.querySelector('#trialExpiredModal p');
                    if (descEl) {
                        if (isTimeExpired) {
                            descEl.innerHTML = `Batas masa uji coba gratis <strong>1 hari (24 jam)</strong> Anda telah selesai.<br>Silakan pilih paket langganan untuk terus menikmati auto-reply AI toko Anda 24/7.`;
                        } else {
                            descEl.innerHTML = `Batas kuota <strong>100 kredit chat WhatsApp</strong> trial Anda telah habis terpakai.<br>Silakan pilih paket langganan untuk terus menikmati auto-reply AI toko Anda 24/7.`;
                        }
                    }
                    setTimeout(() => openModal('trialExpiredModal'), 600);
                }
            }

            let progressColor = 'linear-gradient(90deg, #6366F1, #10B981)';
            let badgeBg = '#D1FAE5';
            let badgeColor = '#059669';
            if (isTrialExpired || percentLeft < 20) {
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
            if (statPlanName) {
                if (isTrialExpired) {
                    statPlanName.innerHTML = `<span style="color:#EF4444; font-weight:700;">Trial Berakhir</span>`;
                } else if (planLower === 'trial') {
                    statPlanName.innerHTML = `Trial (${hoursLeft}j ${minsLeft}m)`;
                } else {
                    statPlanName.innerText = userPlan;
                }
            }
            if (statPercentBadge) {
                statPercentBadge.innerText = isTrialExpired ? '0% (Habis)' : `${percentLeft}%`;
                statPercentBadge.style.color = badgeColor;
                statPercentBadge.style.background = badgeBg;
            }
            if (statProgressBar) {
                statProgressBar.style.width = isTrialExpired ? '0%' : `${percentLeft}%`;
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
                if (isTrialExpired) {
                    billingPercentLabel.innerText = isTimeExpired ? 'Masa Trial 1 Hari Berakhir' : 'Kuota Trial 100 Kredit Habis';
                } else {
                    billingPercentLabel.innerText = `${percentLeft}% Tersisa (${remainingCredits.toLocaleString('id-ID')} Kredit)`;
                }
                billingPercentLabel.style.color = badgeColor;
            }
            if (billingProgressBar) {
                billingProgressBar.style.width = isTrialExpired ? '0%' : `${percentLeft}%`;
                billingProgressBar.style.background = progressColor;
            }
            if (billingPlanBadge) {
                if (isTrialExpired) {
                    billingPlanBadge.innerHTML = `<i class="ph-fill ph-x-circle" style="color:#EF4444;"></i> Paket Trial (Berakhir)`;
                } else if (planLower === 'trial') {
                    billingPlanBadge.innerHTML = `<i class="ph-fill ph-sparkle"></i> Paket Trial (${hoursLeft}j ${minsLeft}m)`;
                } else {
                    billingPlanBadge.innerHTML = `<i class="ph-fill ph-sparkle"></i> Paket ${userPlan}`;
                }
            }
            if (currentPlanBadge) {
                if (isTrialExpired) {
                    currentPlanBadge.innerHTML = `<i class="ph-fill ph-x-circle" style="color:#EF4444;"></i> Current Plan: <span style="color:#EF4444; font-weight:700;">Trial Berakhir</span>`;
                } else if (planLower === 'trial') {
                    currentPlanBadge.innerHTML = `<i class="ph-fill ph-check-circle"></i> Current Plan: Trial (${hoursLeft}j ${minsLeft}m • 100 Kredit)`;
                } else {
                    currentPlanBadge.innerHTML = `<i class="ph-fill ph-check-circle"></i> Current Plan: ${userPlan}`;
                }
            }

            // 3. Update status tombol paket billing
            if (typeof window.updateBillingPlanButtons === 'function') {
                window.updateBillingPlanButtons(userPlan);
            }
        } catch (err) {
            console.warn('⚠️ Gagal memuat data kuota kredit AI:', err.message);
        }
    }

    // Inisialisasi awal tombol billing dengan paket saat ini
    if (typeof window.updateBillingPlanButtons === 'function') {
        window.updateBillingPlanButtons();
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

        if (data.isTrialExpired || data.status === 'EXPIRED') {
            setBadge('disconnected', 'Trial Berakhir');
            const btnRunBot = document.getElementById('btnRunBot');
            const toggleBotActive = document.getElementById('toggleBotActive');
            if (btnRunBot) {
                btnRunBot.disabled = true;
                btnRunBot.classList.add('disabled');
                btnRunBot.style.opacity = '0.5';
                btnRunBot.style.cursor = 'not-allowed';
            }
            if (toggleBotActive) {
                toggleBotActive.checked = false;
                toggleBotActive.disabled = true;
            }
            if (botStatusMsg) {
                botStatusMsg.innerHTML = `<i class="ph-fill ph-warning-circle" style="color:#EF4444;"></i><span style="color:#EF4444; font-weight:600;">Masa trial 1 hari atau batas kuota 100 kredit Anda telah berakhir. Bot dinonaktifkan otomatis.</span>`;
            }
            return;
        }

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
        } else if (data.status === 'CONNECTING') {
            setBadge('disconnected', 'Menghubungkan...');
            if (waDisconnectedState) waDisconnectedState.style.display = 'none';
            if (waConnectedState) waConnectedState.style.display = 'none';
            if (waQrImage) waQrImage.style.display = 'none';
            if (waPairingBox) waPairingBox.style.display = 'none';
            if (waQrLoading) {
                waQrLoading.style.display = 'flex';
                if (waQrLoadingText) waQrLoadingText.textContent = 'Memuat QR Code / Menghubungkan...';
            }
            if (botStatusMsg) {
                botStatusMsg.innerHTML = `<i class="ph ph-spinner ph-spin"></i><span>Sedang menghubungi WhatsApp...</span>`;
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
                    if (data.status === 'qr' && data.qr) {
                        updateBotUI(data);
                    } else if (data.status === 'CONNECTED') {
                        updateBotUI(data);
                    } else {
                        checkBotStatus();
                    }
                } else {
                    showToast(data.error || 'Gagal memulai bot', 'error');
                    if (data.status === 'EXPIRED' || data.isTrialExpired) {
                        if (typeof openModal === 'function') openModal('trialExpiredModal');
                    }
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
                    body: JSON.stringify({ active, userId: window.currentUserId })
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
