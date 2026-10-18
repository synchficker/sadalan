# Sadalan — situs + CMS untuk GitHub Pages

Situs pendakian statis dengan **CMS bawaan** di `/admin/`. Tidak ada server dan tidak ada database:
konten disimpan sebagai file JSON di repositori, dan CMS mengeditnya lewat **GitHub API** menggunakan **API Token** Anda.
Setiap simpan = satu *commit*; GitHub Pages menerbitkan ulang situs secara otomatis.

```
index.html, blog-detail.html     situs publik
data/*.json                      konten (site, trails, reviews, blog, profile, logistics)
data/tracks/<id>.json            rute GPS tiap jejak (dibuat CMS: rekam / impor GPX)
assets/js/theme.js               tema Terang/Gelap/Otomatis (dimuat di <head>)
assets/css/theme.css             token warna terang & gelap
assets/js/logistics.js           kalkulator logistik: nilai bawaan, rumus, teks daftar
assets/js/geo.js                 GPX, statistik, penyederhanaan rute (dipakai admin & situs)
assets/uploads/                  gambar yang diunggah lewat CMS
admin/                           CMS (login token, kartu, formulir, media, pengguna)
tests/                           uji otomatis (npm test)
```

## Pasang di GitHub Pages (5 menit)

1. Buat repositori di GitHub, lalu unggah seluruh isi folder ini (file `.nojekyll` sudah ada).
2. **Settings → Pages →** *Deploy from a branch* → pilih branch utama dan folder `/ (root)`.
3. Situs aktif di `https://USERNAME.github.io/REPO/`, CMS di `https://USERNAME.github.io/REPO/admin/`.
4. Buat token (di bawah), buka `/admin/`, tempel token, selesai.

CMS mengenali `USERNAME` dan `REPO` otomatis dari alamat GitHub Pages. Pada domain sendiri (custom domain), isi pemilik/repositori sekali pada layar masuk (tombol *ubah*).

## Membuat API Token

Rekomendasi: **fine-grained token** yang hanya berlaku untuk repositori ini.

1. <https://github.com/settings/personal-access-tokens/new>
2. *Repository access* → **Only select repositories** → pilih repositori situs.
3. *Permissions → Repository permissions* → **Contents: Read and write**. Tambahkan **Administration: Read and write** *hanya jika* Anda ingin mengelola pengguna dari CMS.
4. Atur masa berlaku (mis. 90 hari) → **Generate token** → salin.

Token klasik juga bekerja: scope `repo` (atau `public_repo` untuk repositori publik).

## Akses ke Panel Admin

Di bawah baris copyright footer ada **ikon gembok kecil dan samar** (tanpa teks) yang membuka `admin/`. Ini hanya pintasan agar admin tidak perlu mengetik alamatnya; **bukan lapisan keamanan**. Siapa pun yang menemukannya tetap harus punya token GitHub dengan akses tulis untuk masuk, dan halaman admin diberi `noindex` agar tidak muncul di mesin pencari. Untuk menghapus ikonnya, hapus elemen `a.sf-lock` di `assets/js/footer.js`.

## Tampilan & menu panel admin

Panel admin memakai bahasa visual yang sama dengan Halaman Muka (mobile-first): topbar, kartu, chip filter, *bottom sheet* untuk formulir, dan **bottom-nav** 5 tombol. Di layar lebar kolom aplikasi melebar bertahap (520 → 760 → 960 px).

| Bottom-nav | Isi |
|---|---|
| **Ringkasan** | jumlah konten, konten terbaru, pintasan tambah, tautan riwayat commit |
| **Konten** | tab **Jejak** · **Ulasan** · **Artikel** · **Media** (cari + filter kategori; ketuk kartu untuk mengubah) |
| **＋ Tambah** | menu cepat: jejak, ulasan, artikel, gambar, undang pengguna |
| **Pengguna** | manajemen pengguna (lihat di bawah) |
| **Pengaturan** | menu terkelompok: *Situs* (Pengaturan situs, Profil) · *Akses* (Pengguna) · *Penerbitan* (lihat situs, riwayat commit, status Pages) · *Akun* (muat ulang, keluar) |

Pengaturan situs mencakup: nama, hero + urutan slide, judul section, kategori (ganti nama ikut memperbarui data), sosial media, footer. Media: unggah/hapus gambar (dikecilkan maks. 1600 px, WebP, di browser).

## Rute GPS: rekam, edit, impor & ekspor GPX

Dibuka dari **Konten → Jejak** (tombol *Rekam* dan *Impor GPX*), menu **＋ Tambah**, atau kolom **Rute GPS** di formulir jejak.

- **Rekam** — perekam layar penuh ala Strava: peta langsung, waktu, jarak, kecepatan rata-rata, ketinggian, total naik, jeda/lanjut (jeda = segmen baru). Titik dengan akurasi buruk atau lonjakan tak wajar diabaikan; ambang akurasi dan jarak minimal bisa diatur. Selesai → pilih *Jadikan jejak baru*, *Tambahkan ke jejak yang ada*, *Edit/pangkas*, *Ekspor GPX*, atau simpan sebagai **draf di perangkat**.
- **Mode latar belakang (opsional, sakelar di Pengaturan rekam)** — rekaman tetap berjalan saat layar mati atau pindah aplikasi: Wake Lock + audio senyap + notifikasi media (bisa jeda/lanjut dari notifikasi). Rekaman disimpan otomatis ke IndexedDB, sehingga bila tab tertutup atau baterai habis, saat masuk lagi muncul tawaran melanjutkan. Pil merah “● 00:12:34” tampil di semua halaman admin selama merekam.
- **Edit rute** — seret titik, ketuk garis (mode *Tambah titik*) untuk menyisipkan titik, hapus titik, **pangkas** ke bagian A–B atau **hapus** bagian A–B, balik arah, gabung segmen, **sederhanakan** (2/5/10 m), urungkan/ulangi, plus profil ketinggian.
- **Impor GPX** — jalur (`trk`) dan rute (`rte`), banyak segmen, waktu & ketinggian dibaca; maksimum 25 MB, titik >4.000 disederhanakan otomatis. Nama, jarak, ketinggian tertinggi, waktu, dan koordinat awal mengisi kolom yang masih kosong (tombol *Isi otomatis* menimpa semuanya).
- **Ekspor GPX** — dari formulir jejak, kartu jejak (ikon unduh), dan alur rekaman selesai. Pengunjung situs juga bisa mengunduh GPX di detail jejak.
- **Di situs publik**: garis rute tampil di Peta Jejak (warna sesuai kesulitan), detail jejak menampilkan peta rute, jarak, total naik/turun, grafik ketinggian, dan tombol *Unduh GPX*; kartu jejak ber-rute bertanda **GPS**.

Penyimpanan: rute = satu berkas `data/tracks/<id>.json` (maks. 6.000 titik) yang ikut **commit yang sama** dengan perubahan jejak; menghapus jejak atau rutenya menghapus berkas itu juga.

**Batasan jujur pelacakan latar belakang**: peramban tidak punya pelacakan lokasi latar belakang sejati seperti aplikasi native. Mode latar belakang adalah upaya terbaik dan tidak dijamin di semua perangkat/versi. Tips: aktifkan *Jaga layar tetap menyala*, matikan penghemat baterai untuk peramban, dan di iPhone pasang panel admin ke **Layar Utama** (Bagikan → Tambah ke Layar Utama; manifest PWA sudah disediakan). Perekaman butuh HTTPS (GitHub Pages sudah HTTPS) dan izin lokasi. Peta memakai ubin OpenStreetMap (butuh internet); tanpa sinyal, rekaman tetap berjalan dan tersimpan sebagai draf sampai bisa diterbitkan.

### Rekaman terputus-putus / garis lurus (penting)
Di peramban, GPS **ditahan** saat halaman di latar belakang dan **berhenti total** bila tab/aplikasi ditutup. Itu batasan platform web, bukan bug yang bisa dihilangkan dengan kode web. Yang dilakukan panel ini:
- **Tidak ada garis lurus palsu**: bila titik baru datang >25 dtk dan >50 m setelah titik sebelumnya, perekam memulai segmen baru dan mencatatnya sebagai *jeda data* (jarak jeda dihitung terpisah, tampil putus-putus di peta).
- **Lebih sedikit jeda**: ticker Web Worker, pembacaan GPS cadangan saat `watchPosition` diam >8 dtk, mulai-ulang pemantauan, pemulihan otomatis saat halaman kembali aktif (visible/resume/pageshow), audio senyap yang diputar ulang bila dijeda sistem.
- **Memperbaiki hasilnya**: Edit rute → **Isi jeda (ikuti jalan)** mengisi tiap celah (≤ 2 km) dengan rute jalan kaki OpenStreetMap (layanan `routing.openstreetmap.de`; CSP admin mengizinkan host ini). Rute yang jauh lebih panjang dari garis lurus dilewati; semua bisa diurungkan. Ini perkiraan jalur, bukan rekaman asli.
- **Perekaman andal sungguhan**: pasang **aplikasi Android** (folder `native/`, dibangun otomatis lewat GitHub Actions `Bangun APK Android`). Panel admin mendeteksinya dan memakai pelacak native berlayanan latar depan — tetap merekam saat layar mati atau aplikasi ditutup. Lihat `native/README.md`.

## Mode Gelap & Terang

Situs publik dan panel admin punya tiga pilihan tema: **Otomatis** (ikut pengaturan perangkat, berubah langsung bila perangkat berganti), **Terang**, dan **Gelap**.

- **Mengganti**: tombol matahari/bulan/monitor di bilah atas (situs & admin) bergilir Otomatis → Terang → Gelap; di admin juga ada pilihan di **Pengaturan → Tampilan**.
- **Tersimpan** di peramban (`localStorage`, kunci `sadalan_theme`) dan **dibagi** antara situs dan admin; antar-tab ikut tersinkron. Bila penyimpanan diblokir, tema berlaku untuk sesi itu saja.
- **Tanpa kilatan putih**: `assets/js/theme.js` dimuat sinkron di `<head>` semua halaman (berkas lokal, jadi CSP admin tetap tanpa skrip inline) dan memasang `data-theme` sebelum halaman tergambar; `meta theme-color` dan `color-scheme` ikut menyesuaikan.
- **Cara kerja CSS**: semua warna lewat token di `assets/css/theme.css` (nilai terang = tampilan asli, `:root[data-theme=dark]` = palet gelap). Menambah komponen baru? Pakai token (`var(--surface)`, `var(--ink)`, `var(--fg-accent)`, `var(--line)`, …) — jangan `#fff`/hex mentah. Peta Leaflet, peta canvas admin, grafik ketinggian, dan kontrol formulir ikut tema.
- **Diuji**: setiap token terang wajib punya padanan gelap, semua `var(--x)` terdefinisi, kontras teks mode gelap ≥ 4,5:1 (WCAG AA) untuk pasangan utama, mode terang identik dengan sebelumnya, dan alur tombol/penyimpanan/muat ulang di browser sungguhan.

## Kalkulator Logistik Gunung

Tombol **Kalkulator Logistik** di samping *Lihat Peta* pada halaman utama membuka modal untuk menghitung kebutuhan air, makanan, bahan bakar, estimasi beban, dan daftar perlengkapan (bisa dicentang & **disalin** sebagai teks).

- **Input**: jumlah pendaki (1–50), lama (1–30 hari), jejak (opsional — otomatis mengatur tingkat kesulitan dan saran hari dari estimasi jejak), tingkat kesulitan, dan kondisi cuaca.
- **Rumus** (`assets/js/logistics.js`, diuji di `npm test`): kebutuhan per orang per hari × pengali kesulitan × pengali cuaca × jumlah orang × hari × (1 + cadangan%). Perlengkapan dihitung per orang / per kelompok / per orang-hari / per kelompok-hari dan dibulatkan ke atas. Peringatan muncul bila beban per orang tinggi, air per hari tinggi, atau perjalanan ≥ 4 hari. Hasilnya estimasi perencanaan, bukan jaminan.
- **CMS & CRUD** — **Konten → Logistik** (juga di Pengaturan): tambah / ubah / hapus **perlengkapan** (kategori, aturan jumlah, jumlah pecahan, satuan, berat, aktif/nonaktif; cari & filter kategori), tambah / ubah / hapus **kondisi cuaca** (pengali air & kalori; kondisi bawaan otomatis berpindah bila dihapus, minimal satu), serta **Pengaturan**: tampil/sembunyikan tombol, label tombol, teks modal, nilai awal formulir, angka dasar per orang per hari, pengali tiap tingkat kesulitan. Setiap aksi = satu commit ke `data/logistics.json`, divalidasi ketat (rentang angka, kategori, nama unik).
- **Repositori lama aman**: bila `data/logistics.json` belum ada, situs dan CMS memakai nilai bawaan (`Logistics.defaults()`); berkas dibuat saat pertama kali disimpan dari CMS.
- **Tampilan = situs yang ada**: tombol memakai kelas `ghost-btn` yang sama dengan *Lihat Peta*; modal memakai `modal-content`, `rv-filters`, `detail-meta`, `rv-note`, `rel-title`; baris checklist meniru `modal-list button`. CSS tambahan hanya memakai `var(--token)` (tanpa warna statis), sehingga otomatis ikut Mode Gelap. Tes membandingkan **computed style** tombol, kartu, kolom isian, dan lembar modal terhadap komponen yang sudah ada — di terang/gelap, desktop/ponsel — dan memastikan blok CSS-nya bebas warna statis. Di layar ≤ 460 px, tombol utama satu baris penuh agar *Lihat Peta* dan *Kalkulator* berdampingan.

## Manajemen pengguna

Situs ini statis (tanpa server dan tanpa kata sandi), jadi **pengguna CMS = akun GitHub yang punya akses tulis ke repositori**. Halaman *Pengguna* mengelola mereka lewat API kolaborator GitHub:

- melihat pengguna aktif (peran, tanda *Anda*/*Pemilik*) dan undangan yang menunggu;
- **mengundang** akun lewat username (atau tempel tautan profilnya); akun diperiksa dulu ke GitHub;
- **mengubah peran** — Editor, Admin, Pembaca (khusus repositori milik organisasi; di repositori pribadi semua kolaborator = Editor);
- **mencabut akses** dan **membatalkan undangan**, dengan konfirmasi.

Catatan: perubahan di sini langsung berlaku di GitHub dan **tidak membuat commit**. Orang yang diundang harus menerima undangan, lalu masuk dengan token miliknya sendiri. Anda tidak bisa mengubah atau mencabut diri sendiri maupun pemilik repositori. Membuka halaman ini boleh untuk semua yang punya token tulis, tetapi mengelola pengguna hanya untuk **admin repositori** dengan token berizin **Administration: Read and write** (izin tambahan, hanya perlu bila fitur ini dipakai).

## Cara kerja & jaminan data

- **Satu aksi = satu commit atomik** (Git Data API). Mis. hapus jejak + bersihkan hero + gambar → 1 commit, tidak pernah setengah jalan.
- **Tidak menimpa perubahan lain**: sebelum menyimpan, CMS mengambil data terbaru dari repositori lalu menerapkan perubahan Anda di atasnya. Bila ada push bersamaan, muncul pesan "coba simpan sekali lagi" — tidak ada data yang tertimpa.
- **Validasi** penuh di browser (`admin/js/schema.js`): panjang, tipe, rentang rating/koordinat, tanggal, kategori harus ada, URL gambar hanya `http(s)`/`assets/`. Kategori yang masih dipakai tidak bisa dihapus.
- **Riwayat & pembatalan**: semua perubahan ada di Git — kembalikan lewat tombol *Revert* di GitHub.
- **Gambar** baru hanya di-commit saat formulir disimpan (tidak ada berkas yatim dari formulir yang dibatalkan).

## Keamanan

- Token disimpan di `sessionStorage` (hilang saat tab ditutup). Hanya bila Anda mencentang *Ingat di perangkat ini* token disimpan di `localStorage`. Jangan dicentang di komputer bersama. Tombol **Keluar** menghapusnya.
- Token hanya dikirim ke `https://api.github.com`. Halaman admin memakai *Content-Security-Policy* yang mengunci koneksi ke host itu dan skrip hanya dari domain sendiri; semua teks pengguna dirender dengan `textContent` (anti-XSS) dan situs publik meng-escape seluruh konten.
- `/admin/` bisa dibuka siapa saja, tetapi tanpa token yang punya izin tulis, tidak bisa mengubah apa pun. Halaman ditandai `noindex`.
- Beri token izin sesempit mungkin (satu repositori, hanya *Contents*) dan masa berlaku terbatas. Bila token bocor, cabut di GitHub Settings.
- Bila branch utama dilindungi (wajib pull request), push langsung ditolak. Izinkan token melewati aturan itu atau gunakan branch khusus konten.

## Batasan yang perlu diketahui

- **Ulasan hanya lewat Panel Admin.** Situs publik tidak punya tombol/form "Tulis ulasan". Modal Reviews menampilkan keterangan dan tombol **Kirim ulasan lewat Admin** yang membuka halaman cara mengirim, aturan ulasan, dan tautan kontak Admin (diambil dari sosial media di *Pengaturan situs*, jadi mengubahnya di CMS ikut mengubah kontak). Teks aturan ada di `assets/js/app.js` (`RV_STEPS`, `RV_RULES`). Ulasan lokal lama di peramban pengunjung (`localStorage`) dibersihkan otomatis dan tidak lagi tampil.
- **Jeda penerbitan**: setelah simpan, situs publik berubah dalam ±1–2 menit (waktu build Pages). Isi CMS selalu langsung terbaru karena dibaca dari repositori, bukan dari Pages.
- Repositori publik berarti seluruh konten dan riwayat commit juga publik. Pages untuk repositori privat membutuhkan paket GitHub berbayar.
- Batas API GitHub: 5.000 permintaan/jam per token — jauh di atas pemakaian CMS.
- Teks antarmuka tetap (label tombol di modal, placeholder pencarian) belum bisa diedit di CMS; hero, judul section, jejak, ulasan, artikel, profil, kategori, sosial, dan footer bisa.

## Pengembangan lokal

```bash
npm start      # http://localhost:3000  (situs)  ·  /admin/  (CMS)
npm test       # skema, klien GitHub (emulator, termasuk kolaborator), keamanan; + uji browser bila Puppeteer terpasang
```

`npm start` hanya server berkas statis (situs harus dibuka lewat server karena membaca `data/*.json`). Login CMS tetap memakai token GitHub sungguhan dan menulis ke repositori sungguhan.
Untuk uji browser: `npm i -D puppeteer` (atau set `NPM_GLOBAL`/`CHROME_PATH`).

## Menambah field baru

1. Tambah field di `data/*.json` dan validatornya di `admin/js/schema.js`.
2. Tambah entri spesifikasi di `admin/js/app.js` (mis. `trailSpecs()`).
3. Untuk teks tetap di halaman, beri atribut `data-cms="site.jalur.field"` pada elemennya.
