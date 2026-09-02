document.addEventListener('DOMContentLoaded', () => {
    // Toast logic
    window.showToast = function (message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = 'ph-check-circle';
        if (type === 'error') icon = 'ph-warning-circle';

        toast.innerHTML = `<i class="ph-fill ${icon}"></i> <span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 10);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    };

    // Toggle forms
    window.toggleAuth = function (type) {
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');

        if (loginForm) loginForm.classList.remove('active');
        if (registerForm) registerForm.classList.remove('active');

        if (type === 'login') {
            if (loginForm) loginForm.classList.add('active');
        } else {
            if (registerForm) registerForm.classList.add('active');
        }
    };

    // Check URL parameters to show specific form
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'login') {
        toggleAuth('login');
    }

    // Handle Register
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('registerName').value;
            const email = document.getElementById('registerEmail').value;
            const wa = document.getElementById('registerWa').value;
            const password = registerForm.querySelector('input[type="password"]').value;

            if (!name || !email || !wa || !password) {
                showToast('Mohon isi semua data pendaftaran', 'error');
                return;
            }

            if (password.length < 8) {
                showToast('Kata sandi minimal 8 karakter', 'error');
                return;
            }

            const btn = registerForm.querySelector('button[type="submit"]');
            const originalText = btn.innerText;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Memproses...';
            btn.disabled = true;

            if (!window.supabaseClient) {
                showToast('Sistem database tidak dapat diakses. Mohon matikan adblocker dan refresh.', 'error');
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }

            try {
                const { data, error } = await window.supabaseClient.auth.signUp({
                    email: email,
                    password: password,
                    options: {
                        data: {
                            store_name: name,
                            phone: wa
                        }
                    }
                });

                if (error) throw error;

                // Optional: Initialize local storage values as fallback if needed for UI
                localStorage.setItem('isRegistered', 'true');
                localStorage.setItem('freeChatsLeft', '50');
                localStorage.setItem('storeName', name);
                
                // Karena trigger database sudah mengkonfirmasi email, kita bisa langsung login
                const { data: loginData, error: loginError } = await window.supabaseClient.auth.signInWithPassword({
                    email: email,
                    password: password
                });

                if (loginError) throw loginError;

                showToast('Pendaftaran berhasil! Mengarahkan ke Dashboard...', 'success');
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 1500);
            } catch (error) {
                showToast(error.message, 'error');
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }



    // Handle Login
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('loginEmail').value;
            const password = loginForm.querySelector('input[type="password"]').value;

            if (!email || !password) {
                showToast('Mohon masukkan email dan kata sandi', 'error');
                return;
            }

            const btn = loginForm.querySelector('button[type="submit"]');
            const originalText = btn.innerText;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Memproses...';
            btn.disabled = true;

            if (!window.supabaseClient) {
                showToast('Sistem database tidak dapat diakses. Mohon matikan adblocker dan refresh.', 'error');
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }

            try {
                const { data, error } = await window.supabaseClient.auth.signInWithPassword({
                    email: email,
                    password: password,
                });

                if (error) throw error;

                showToast('Login berhasil! Mengarahkan ke Dashboard...', 'success');
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 1500);

            } catch (error) {
                showToast('Login gagal: ' + error.message, 'error');
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }
});
