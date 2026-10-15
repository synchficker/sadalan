# Sadalan untuk Android — perekaman GPS latar belakang sungguhan

**Mengapa perlu?** Peramban (Chrome/Safari) menahan GPS saat halaman di latar belakang dan menghentikannya sepenuhnya bila tab/aplikasi ditutup. Itulah penyebab rute "menarik garis lurus". Aplikasi pembungkus ini memuat panel admin yang sama, tetapi merekam lewat **layanan latar depan Android** (notifikasi tetap "Sadalan sedang merekam jejak"), sehingga titik terus tercatat saat layar mati, pindah aplikasi, atau bahkan aplikasi ditutup dari daftar terbaru (pada sebagian ponsel).

Panel admin otomatis mendeteksi aplikasi ini (`window.Capacitor`) dan memakai pelacak native; di peramban biasa semuanya tetap berjalan seperti sebelumnya.

## Cara membangun (tanpa Android Studio)
1. Push repositori ini ke GitHub (berkas `.github/workflows/android-apk.yml` ikut).
2. Buka tab **Actions → Bangun APK Android → Run workflow**. Isi alamat situs bila memakai domain sendiri (tanpa `/admin`).
3. Setelah selesai, unduh artifact **sadalan-debug-apk** → ekstrak → pasang `app-debug.apk` di ponsel (izinkan "pasang dari sumber tidak dikenal").
4. Buka aplikasi → masuk dengan token seperti biasa → Rekam. Izinkan **Lokasi** dan **Notifikasi**.

## Agar tidak dimatikan sistem
- Pengaturan → Aplikasi → Sadalan → Baterai → **Tidak dibatasi**.
- Beberapa merek (Xiaomi, Oppo, Vivo, Samsung) punya "penghemat baterai agresif": izinkan *autostart / jalan di latar belakang* untuk Sadalan.

## Catatan
- APK ini *debug* untuk pemakaian pribadi (bukan Play Store). iOS memerlukan Mac + Xcode dan tidak disediakan di sini; di iPhone pakai mode peramban (pasang ke Layar Utama).
- Alur build ini ditulis tanpa bisa dijalankan di lingkungan pengembang saya; bila build pertama gagal, salin log Actions dan kirimkan agar disesuaikan (versi Capacitor/plugin bisa berubah).
