const supabaseUrl = 'https://aspvenhasvoqpnlgahyy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzcHZlbmhhc3ZvcXBubGdhaHl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODU1NTcsImV4cCI6MjEwMzE2MTU1N30.YsJBLVhFG_0B01ozFzRsd-oJ7ior_gBOWAPHYxGCiT8';

if (typeof window.supabase === 'undefined') {
    console.error('Supabase SDK gagal dimuat. Pastikan koneksi internet stabil dan matikan adblocker.');
    alert('Sistem Gagal Dimuat: Mohon matikan Adblocker atau gunakan mode Incognito, lalu refresh halaman.');
} else {
    const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
    window.supabaseClient = supabase;
}
