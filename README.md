# Sadalan — situs + CMS untuk GitHub Pages

Situs pendakian statis dengan **CMS bawaan** di `/admin/`. Tidak ada server dan tidak ada database:
konten disimpan sebagai file JSON di repositori, dan CMS mengeditnya lewat **GitHub API** menggunakan **API Token** Anda.
Setiap simpan = satu *commit*; GitHub Pages menerbitkan ulang situs secara otomatis.

```
index.html, blog-detail.html     situs publik
data/*.json                      konten (site, trails, reviews, blog, profile)
assets/uploads/                  gambar yang diunggah lewat CMS
admin/                           CMS (login token, tabel, formulir, media)
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
3. *Permissions → Repository permissions* → **Contents: Read and write** (hanya itu).
4. Atur masa berlaku (mis. 90 hari) → **Generate token** → salin.

Token klasik juga bekerja: scope `repo` (atau `public_repo` untuk repositori publik).

## Yang bisa dikelola

| Menu | Isi |
|---|---|
| Ringkasan | jumlah konten, konten terbaru, pintasan tambah, tautan riwayat commit |
| Jejak | tambah/ubah/hapus jejak (+ koordinat, foto); hapus jejak otomatis membersihkan slide hero |
| Ulasan | tambah/ubah/hapus ulasan, kelebihan/kekurangan, tag |
| Artikel | editor blok (paragraf, subjudul, kutipan, daftar); ID otomatis dari judul |
| Profil | isi modal Profile |
| Pengaturan situs | nama, hero + urutan slide, judul section, kategori (ganti nama ikut memperbarui data), sosial media, footer |
| Media | unggah/hapus gambar; gambar dikecilkan (maks. 1600 px, WebP) di browser sebelum diunggah |

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

- **Ulasan dari pengunjung** lewat form "Tulis ulasan" masih tersimpan di `localStorage` peramban pengunjung sendiri; situs statis tidak punya tempat menampung kiriman publik. Ulasan yang tampil untuk semua orang adalah yang ditambahkan admin di CMS.
- **Jeda penerbitan**: setelah simpan, situs publik berubah dalam ±1–2 menit (waktu build Pages). Isi CMS selalu langsung terbaru karena dibaca dari repositori, bukan dari Pages.
- Repositori publik berarti seluruh konten dan riwayat commit juga publik. Pages untuk repositori privat membutuhkan paket GitHub berbayar.
- Batas API GitHub: 5.000 permintaan/jam per token — jauh di atas pemakaian CMS.
- Teks antarmuka tetap (label tombol di modal, placeholder pencarian) belum bisa diedit di CMS; hero, judul section, jejak, ulasan, artikel, profil, kategori, sosial, dan footer bisa.

## Pengembangan lokal

```bash
npm start      # http://localhost:3000  (situs)  ·  /admin/  (CMS)
npm test       # skema, klien GitHub (emulator), keamanan; + uji browser bila Puppeteer terpasang
```

`npm start` hanya server berkas statis (situs harus dibuka lewat server karena membaca `data/*.json`). Login CMS tetap memakai token GitHub sungguhan dan menulis ke repositori sungguhan.
Untuk uji browser: `npm i -D puppeteer` (atau set `NPM_GLOBAL`/`CHROME_PATH`).

## Menambah field baru

1. Tambah field di `data/*.json` dan validatornya di `admin/js/schema.js`.
2. Tambah entri spesifikasi di `admin/js/app.js` (mis. `trailSpecs()`).
3. Untuk teks tetap di halaman, beri atribut `data-cms="site.jalur.field"` pada elemennya.
