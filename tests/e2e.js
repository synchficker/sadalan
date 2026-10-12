'use strict';
/* Uji end-to-end di browser nyata (Puppeteer). GitHub API diganti emulator lewat intersepsi permintaan. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { FakeGithub } = require('./fake-github');
const Gpx = require('../assets/js/gpx.js');

function loadPuppeteer() {
  const tries = ['puppeteer', 'puppeteer-core', path.join(process.env.NPM_GLOBAL || os.homedir() + '/.npm-global', 'lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer')];
  for (const t of tries) { try { return require(t); } catch { /* lanjut */ } }
  throw new Error('Puppeteer tidak terpasang (npm i -D puppeteer untuk menjalankan uji browser)');
}
const puppeteer = loadPuppeteer();
const root = path.join(__dirname, '..');
const zlib = require('zlib');
function makePng(w, h) { /* PNG RGB valid, dibuat tanpa dependensi */
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 80 + (x % 100); raw[o + 2] = 60; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = makePng(40, 30);
/* lintasan sintetis (mendaki ±1,1 km, berderau) untuk uji GPX */
const walk = (n) => Array.from({ length: n }, (_, i) => { const f = i / (n - 1); return { lat: -7.3198 + f * 0.05 + Math.sin(f * 12) * 0.002, lng: 107.7313 + f * 0.03, ele: 1500 + f * 1165 + Math.sin(f * 40) * 3, t: Date.UTC(2026, 9, 1, 6) + i * 8000 }; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(t) {
  const files = Object.fromEntries(['site', 'trails', 'reviews', 'blog', 'profile'].map((n) => [`data/${n}.json`, fs.readFileSync(path.join(root, 'data', n + '.json'), 'utf8')]));
  const fake = new FakeGithub(files);
  const server = require('../dev-server.js');
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const exe = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => p && fs.existsSync(p));
  const browser = await puppeteer.launch({ headless: true, executablePath: exe, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const errors = [];
  const newPage = async (w = 1280, h = 900) => {
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h });
    await page.setRequestInterception(true);
    const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    page.on('request', (rq) => {
      const u = rq.url();
      if (u.startsWith('https://api.github.com')) {
        if (rq.method() === 'OPTIONS') return rq.respond({ status: 204, headers: CORS });
        const out = fake.handle({ method: rq.method(), url: u, headers: rq.headers(), body: rq.postData() });
        return rq.respond({ status: out.status, headers: { ...out.headers, ...CORS }, body: out.body || '' });
      }
      const ov = page.overrides && page.overrides[new URL(u).pathname]; if (ov) return rq.respond(ov);
      if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return rq.continue();
      return rq.abort(); // CDN/font eksternal tidak dibutuhkan untuk uji
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    return page;
  };
  const $ = (p, s) => p.$(s);
  const text = (p, s) => p.$eval(s, (e) => e.textContent.trim());
  const rows = (p) => p.$$eval('.cards .item', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  const clickBtn = async (p, label, scope = 'body') => {
    if (/^(Simpan|Hapus)/.test(label)) await p.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove()));
    const ok = await p.evaluate((l, sc) => { const b = [...document.querySelector(sc).querySelectorAll('button,a.btn')].find((x) => x.textContent.trim() === l && !x.disabled); if (b) { b.click(); return true; } return false; }, label, scope);
    assert.ok(ok, `tombol “${label}” tidak ditemukan`);
  };
  const setVal = async (p, sel, v) => { await p.$eval(sel, (e, val) => { e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v); };
  const fieldByLabel = (label) => `xpath/.//div[contains(@class,"field")][./label[starts-with(normalize-space(.),"${label}")]]`;
  const fieldInput = async (p, label) => { const h = await p.$(fieldByLabel(label)); assert.ok(h, 'field ' + label); return h.$('input,textarea,select'); };
  const fill = async (p, label, v) => { const el = await fieldInput(p, label); await el.evaluate((e, val) => { e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, String(v)); };
  const waitToast = (p, re) => p.waitForFunction((s) => [...document.querySelectorAll('.toast')].some((x) => new RegExp(s).test(x.textContent)), { timeout: 8000 }, re.source);
  const nav = async (p, hash) => { await p.evaluate(() => { location.hash = '#/dashboard'; }); await p.waitForSelector('.stats'); await p.evaluate((h) => { location.hash = h; }, hash); await sleep(50); };
  const ghData = (n) => JSON.parse(fake.text(`data/${n}.json`));

  const page = await newPage();
  await page.goto(base + '/admin/', { waitUntil: 'load' });

  await t('login: halaman masuk tampil, memuat tanpa error', async () => {
    await page.waitForSelector('.login-card'); assert.match(await text(page, '.login-brand h1'), /Sadalan CMS/);
  });
  const login = async (p, token, { remember = false } = {}) => {
    await p.waitForSelector('.login-card');
    await p.evaluate(() => { document.querySelector('.adv').hidden = false; });
    await setVal(p, 'input[aria-label="Pemilik repositori"]', 'acme'); await setVal(p, 'input[aria-label="Nama repositori"]', 'sadalan');
    await setVal(p, 'input[aria-label="Token API GitHub"]', token);
    if (remember) await p.click('#remember');
    await p.click('button[type=submit]');
  };
  await t('login: token salah ditolak dengan pesan jelas', async () => {
    await login(page, 'token-salah'); await page.waitForFunction(() => /Token ditolak/.test(document.querySelector('.login-err').textContent));
  });
  await t('login: token benar → dashboard dengan jumlah data akurat', async () => {
    await setVal(page, 'input[aria-label="Token API GitHub"]', 'good-token'); await page.click('button[type=submit]');
    await page.waitForSelector('.stats'); const n = await page.$$eval('.stat b', (b) => b.map((x) => +x.textContent));
    assert.deepStrictEqual(n, [ghData('trails').length, ghData('reviews').length, ghData('blog').length]);
    assert.match(await text(page, '.page-head h1'), /Halo, Budi/);
  });
  await t('token tersimpan di sessionStorage (bukan localStorage) secara default', async () => {
    const [s, l] = await page.evaluate(() => [!!sessionStorage.getItem('sadalan_cms_session'), !!localStorage.getItem('sadalan_cms_session')]); assert.ok(s && !l);
  });

  await nav(page, '#/trails'); await page.waitForSelector('.cards .item');
  await t('jejak: tabel menampilkan semua jejak dan pencarian bekerja', async () => {
    assert.strictEqual((await rows(page)).length, ghData('trails').length);
    await page.type('.toolbar input[type=search]', 'prau'); const r = await rows(page); assert.strictEqual(r.length, 1); assert.match(r[0], /Gunung Prau/);
    await page.$eval('.toolbar input[type=search]', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
  });
  await t('jejak: formulir kosong menampilkan galat per-field dan tidak membuat commit', async () => {
    const before = fake.log.length; await clickBtn(page, 'Tambah jejak'); await page.waitForSelector('.drawer');
    await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await page.waitForSelector('.field.bad');
    assert.match(await page.$eval('.field.bad .err', (e) => e.textContent), /Wajib diisi/); assert.strictEqual(fake.log.length, before);
  });
  const trailsBefore = ghData('trails').length;
  await t('jejak: tambah jejak baru + unggah foto → 1 commit berisi JSON dan gambar WebP', async () => {
    const before = fake.log.length;
    await fill(page, 'Nama jejak', 'Gunung Sumbing'); await fill(page, 'Lokasi', 'Temanggung, Jawa Tengah'); await fill(page, 'Rating', '4.7');
    await fill(page, 'Ketinggian', '3.371 mdpl'); await fill(page, 'Jarak', '9 km'); await fill(page, 'Waktu tempuh', '6–8 jam');
    await fill(page, 'Latitude', '-7,3842'); await fill(page, 'Longitude', '110.0716'); await fill(page, 'Deskripsi', 'Gunung kembar Sindoro dengan jalur panjang dan pemandangan luas.');
    const f = await page.$('.drawer input[type=file]'); const tmp = path.join(os.tmpdir(), 'tes foto.png'); fs.writeFileSync(tmp, PNG); await f.uploadFile(tmp);
    await page.waitForFunction(() => /diunggah saat disimpan/.test(document.querySelector('.up-note').textContent));
    await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Jejak ditambahkan/);
    assert.strictEqual(fake.log.length, before + 1); const tr = ghData('trails'); assert.strictEqual(tr.length, trailsBefore + 1);
    const n = tr[tr.length - 1]; assert.strictEqual(n.id, Math.max(...tr.slice(0, -1).map((x) => x.id)) + 1); assert.strictEqual(n.lat, -7.3842);
    assert.match(n.img, /^assets\/uploads\/\d{8}-\w{4}-tes-foto\.webp$/); assert.ok(fake.files.has(n.img), 'gambar ikut di-commit');
  });
  await t('jejak: baris baru muncul di tabel & drawer tertutup', async () => {
    await page.waitForFunction((n) => document.querySelectorAll('.cards .item').length === n, {}, trailsBefore + 1); assert.ok(!(await $(page, '.drawer')));
  });
  await t('jejak: hapus jejak yang jadi slide hero ikut membersihkan hero dalam SATU commit', async () => {
    const before = fake.log.length; assert.ok(ghData('site').hero.slideTrailIds.includes(2));
    await page.evaluate(() => { [...document.querySelectorAll('.cards .item')].find((r) => /Gunung Prau/.test(r.textContent)).querySelector('.icon-btn.danger').click(); });
    await page.waitForSelector('.dlg'); assert.match(await text(page, '.dlg p'), /slide hero/i); await clickBtn(page, 'Hapus', '.dlg'); await waitToast(page, /Jejak dihapus/);
    assert.strictEqual(fake.log.length, before + 1); assert.ok(!ghData('trails').some((x) => x.id === 2)); assert.ok(!ghData('site').hero.slideTrailIds.includes(2));
  });

  await t('ulasan: judul berisi HTML ditampilkan sebagai teks (anti-XSS) dan tersimpan', async () => {
    await nav(page, '#/reviews'); await page.waitForSelector('.cards .item'); await clickBtn(page, 'Tambah ulasan'); await page.waitForSelector('.drawer');
    await fill(page, 'Judul ulasan', '<img src=x onerror="window.__xss=1">Warung Mbah'); await fill(page, 'Ringkasan', 'Makanan enak, porsi besar, harga bersahabat untuk pendaki.');
    await fill(page, 'Isi lengkap', 'Paragraf satu.\n\nParagraf dua.'); await fill(page, 'Tag', 'makanan, murah , ');
    await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Ulasan ditambahkan/);
    const rv = ghData('reviews'); const n = rv[rv.length - 1]; assert.deepStrictEqual(n.body, ['Paragraf satu.', 'Paragraf dua.']); assert.deepStrictEqual(n.tags, ['makanan', 'murah']);
    await sleep(150); assert.ok(!(await page.evaluate(() => window.__xss))); assert.ok((await rows(page)).some((r) => r.includes('<img src=x')));
    assert.strictEqual(await page.$$eval('.cards img[src="x"]', (e) => e.length), 0);
  });

  await t('artikel: editor blok → ID slug otomatis, struktur body benar', async () => {
    await nav(page, '#/blog'); await page.waitForSelector('.cards .item'); await clickBtn(page, 'Tulis artikel'); await page.waitForSelector('.drawer');
    await fill(page, 'Judul artikel', 'Checklist Pendakian untuk Pemula'); await fill(page, 'Kategori', 'Persiapan'); await fill(page, 'Gambar sampul', 'https://example.com/a.jpg');
    await fill(page, 'Ringkasan', 'Ringkasan singkat artikel uji.');
    await page.$eval('.block textarea', (e) => { e.value = 'Paragraf pembuka.'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickBtn(page, 'Subjudul', '.drawer'); await page.$$eval('.block textarea', (a) => { const e = a[a.length - 1]; e.value = 'Bagian inti'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickBtn(page, 'Daftar', '.drawer'); await page.$$eval('.block textarea', (a) => { const e = a[a.length - 1]; e.value = 'Carrier\nHeadlamp'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Artikel diterbitkan/);
    const b = ghData('blog'); const n = b[b.length - 1];
    assert.strictEqual(n.id, 'checklist-pendakian-untuk-pemula'); assert.deepStrictEqual(n.body, ['Paragraf pembuka.', { h: 'Bagian inti' }, { ul: ['Carrier', 'Headlamp'] }]);
  });
  await t('artikel: ID bentrok diberi akhiran -2', async () => {
    await page.waitForSelector('.cards .item'); await clickBtn(page, 'Tulis artikel'); await page.waitForSelector('.drawer');
    await fill(page, 'Judul artikel', 'Checklist Pendakian untuk Pemula'); await fill(page, 'Kategori', 'Persiapan'); await fill(page, 'Gambar sampul', 'https://example.com/a.jpg'); await fill(page, 'Ringkasan', 'Salinan.');
    await page.$eval('.block textarea', (e) => { e.value = 'Isi.'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Artikel diterbitkan/); assert.ok(ghData('blog').some((x) => x.id === 'checklist-pendakian-untuk-pemula-2'));
  });

  await t('pengaturan: ganti nama kategori ikut memperbarui jejak & ulasan dalam satu commit', async () => {
    await nav(page, '#/site'); await page.waitForSelector('.formpanel');
    const before = fake.log.length; const used = ghData('trails').filter((x) => x.cat === 'Santai').length; assert.ok(used > 0);
    await page.evaluate(() => { const g = [...document.querySelectorAll('.field')].find((f) => /Kategori jejak/.test(f.querySelector('label').textContent)); const i = g.querySelector('.rrow input'); i.value = 'Santai Banget'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForSelector('.savebar.show'); await clickBtn(page, 'Simpan & terbitkan', '.savebar'); await waitToast(page, /Pengaturan situs diperbarui/);
    assert.strictEqual(fake.log.length, before + 1); assert.ok(ghData('site').trailCategories.includes('Santai Banget'));
    assert.strictEqual(ghData('trails').filter((x) => x.cat === 'Santai Banget').length, used); assert.ok(!ghData('trails').some((x) => x.cat === 'Santai'));
  });
  await t('pengaturan: menghapus kategori yang masih dipakai ditolak, tanpa commit', async () => {
    await nav(page, '#/site'); await page.waitForSelector('.formpanel'); const before = fake.log.length;
    await page.evaluate(() => { const g = [...document.querySelectorAll('.field')].find((f) => /Kategori jejak/.test(f.querySelector('label').textContent)); g.querySelector('.rrow .icon-btn.danger').click(); });
    await clickBtn(page, 'Simpan & terbitkan', '.savebar'); await page.waitForFunction(() => /Masih dipakai oleh jejak/.test(document.body.textContent));
    assert.strictEqual(fake.log.length, before);
  });
  await t('pengaturan: judul hero berubah → situs mengikuti (data JSON)', async () => {
    await nav(page, '#/site'); await page.waitForSelector('.formpanel'); await fill(page, 'Judul baris 1', 'Jelajahi jejak,');
    await clickBtn(page, 'Simpan & terbitkan', '.savebar'); await waitToast(page, /Pengaturan situs diperbarui/); assert.strictEqual(ghData('site').hero.title1, 'Jelajahi jejak,');
  });

  await t('konflik: push dari perangkat lain saat menyimpan → pesan jelas, lalu coba lagi berhasil tanpa menimpa', async () => {
    await nav(page, '#/profile'); await page.waitForSelector('.formpanel'); await fill(page, 'Judul modal', 'Tentang Kami');
    fake.beforePatch = (f) => { const t2 = f._tree(new Map([...f.files, ['catatan.txt', Buffer.from('dari orang lain')]])); f.head = f._commit(t2, [f.head], 'push lain'); };
    await clickBtn(page, 'Simpan & terbitkan', '.savebar'); await waitToast(page, /Coba simpan sekali lagi/); assert.strictEqual(ghData('profile').title, 'Tentang Sadalan');
    await clickBtn(page, 'Simpan & terbitkan', '.savebar'); await waitToast(page, /Profil diperbarui/); assert.strictEqual(ghData('profile').title, 'Tentang Kami'); assert.strictEqual(fake.text('catatan.txt'), 'dari orang lain');
  });

  await t('media: daftar unggahan, hapus gambar yang dipakai diblokir', async () => {
    await nav(page, '#/media'); await page.waitForSelector('.media');
    assert.match(await text(page, '.media figcaption small'), /dipakai di trails/);
    await page.click('.media .icon-btn.danger'); await waitToast(page, /masih dipakai/i);
  });

  /* ---------- Pengaturan & Pengguna ---------- */
  const rowOf = (p, re) => p.evaluateHandle((src) => [...document.querySelectorAll('.cards .item')].find((r) => new RegExp(src).test(r.textContent)), re.source);
  const clickIn = async (p, re, sel) => { const h = await rowOf(p, re); const b = await h.asElement().$(sel); assert.ok(b, `tombol ${sel} tidak ada pada baris ${re}`); await b.evaluate((x) => x.click()); /* toast sementara bisa menutupi baris; klik lewat DOM */ };
  const hasIn = async (p, re, sel) => { const h = await rowOf(p, re); return !!(await h.asElement().$(sel)); };
  const dlgBtn = (p, label) => p.evaluate((l) => { const b = [...document.querySelectorAll('.dlg .btn')].find((x) => x.textContent.trim() === l); if (b) b.click(); return !!b; }, label);

  await t('pengaturan: menu terkelompok (Situs, Akses, Penerbitan, Akun) dan tautan ke halaman terkait', async () => {
    await nav(page, '#/settings'); await page.waitForSelector('.menu-group');
    const groups = await page.$$eval('.menu-group h2', (h) => h.map((x) => x.textContent.trim())); assert.deepStrictEqual(groups, ['Situs', 'Akses', 'Penerbitan', 'Akun']);
    const links = await page.$$eval('.menu-row[href^="#/"]', (a) => a.map((x) => x.getAttribute('href'))); assert.deepStrictEqual(links, ['#/site', '#/profile', '#/users']);
    assert.match(await text(page, '.account'), /Budi Santoso/); assert.strictEqual(await page.$eval('.bottom-nav a[data-group="settings"]', (a) => a.getAttribute('aria-current')), 'page');
  });
  await t('pengguna: daftar kolaborator + undangan tertunda, tanda Anda/peran, tanpa aksi pada diri sendiri', async () => {
    await nav(page, '#/users'); await page.waitForSelector('.cards .item');
    const r = await rows(page); assert.strictEqual(r.length, 4);
    assert.ok(r.some((x) => /@budi.*Admin.*Anda/.test(x))); assert.ok(r.some((x) => /@siti.*Editor/.test(x))); assert.ok(r.some((x) => /@andi.*Pembaca/.test(x))); assert.ok(r.some((x) => /@rina.*Menunggu/.test(x)));
    assert.deepStrictEqual(await page.$$eval('.stats .stat b', (b) => b.map((x) => +x.textContent)), [3, 2, 1]);
    assert.ok(!(await hasIn(page, /@budi/, '.icon-btn.danger')), 'tidak boleh mencabut diri sendiri'); assert.ok(!(await hasIn(page, /@budi/, 'button.item-main')), 'tidak boleh mengubah peran sendiri');
    assert.ok(await hasIn(page, /@siti/, '.icon-btn.danger'));
    assert.strictEqual(await page.$eval('.bottom-nav a[data-group="users"]', (a) => a.getAttribute('aria-current')), 'page');
  });
  await t('pengguna: pencarian dan filter Aktif/Menunggu', async () => {
    await page.type('.toolbar input[type=search]', '@siti'); assert.strictEqual((await rows(page)).length, 1);
    await page.$eval('.toolbar input[type=search]', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
    await clickBtn(page, 'Menunggu', '.toolbar'); let r = await rows(page); assert.strictEqual(r.length, 1); assert.match(r[0], /@rina/);
    await clickBtn(page, 'Aktif', '.toolbar'); assert.strictEqual((await rows(page)).length, 3); await clickBtn(page, 'Semua', '.toolbar');
  });
  await t('pengguna: undang — username tidak ada / format salah / sudah terdaftar ditolak tanpa memanggil GitHub', async () => {
    const before = fake.userLog.length; await clickBtn(page, 'Undang pengguna'); await page.waitForSelector('.drawer');
    for (const [v, re] of [['hantu', /tidak ditemukan/], ['-salah', /tidak valid/], ['Siti', /sudah menjadi pengguna/], ['rina', /sudah menjadi pengguna atau sudah diundang/], ['', /Wajib diisi/]]) {
      await fill(page, 'Username GitHub', v); await clickBtn(page, 'Kirim undangan', '.drawer'); await page.waitForFunction((s) => new RegExp(s).test(document.querySelector('.field.bad .err')?.textContent || ''), { timeout: 5000 }, re.source); await page.waitForFunction(() => !document.querySelector('.drawer .btn.loading')); /* tunggu simpan selesai agar galat lama tidak terbaca sebagai hasil baru */
    }
    assert.strictEqual(fake.userLog.length, before); assert.ok(await $(page, '.drawer'), 'formulir tetap terbuka');
  });
  await t('pengguna: undang sebagai Admin butuh konfirmasi; batal → tidak terkirim, formulir tetap terbuka', async () => {
    const before = fake.userLog.length; await fill(page, 'Username GitHub', 'https://github.com/dewi'); await fill(page, 'Peran', 'admin');
    await clickBtn(page, 'Kirim undangan', '.drawer'); await page.waitForSelector('.dlg'); assert.match(await text(page, '.dlg h3'), /Jadikan @dewi admin/);
    assert.ok(await dlgBtn(page, 'Batal')); await sleep(150); assert.strictEqual(fake.userLog.length, before); assert.ok(await $(page, '.drawer'));
  });
  await t('pengguna: konfirmasi Admin → undangan terkirim dengan peran admin, daftar diperbarui, tanpa commit', async () => {
    const commits = fake.log.length; await clickBtn(page, 'Kirim undangan', '.drawer'); await page.waitForSelector('.dlg'); assert.ok(await dlgBtn(page, 'Ya, jadikan admin'));
    await waitToast(page, /Undangan dikirim ke @dewi/); assert.ok(fake.invites.some((i) => i.login === 'dewi' && i.role === 'admin')); assert.strictEqual(fake.log.length, commits);
    await page.waitForFunction(() => !document.querySelector('.drawer') && [...document.querySelectorAll('.cards .item')].some((r) => /@dewi/.test(r.textContent) && /Menunggu/.test(r.textContent)));
  });
  await t('pengguna: ubah peran Editor → Pembaca', async () => {
    await clickIn(page, /@siti/, 'button.item-main'); await page.waitForSelector('.drawer'); assert.match(await text(page, '.drawer-head h2'), /Ubah peran/);
    await fill(page, 'Peran', 'pull'); await clickBtn(page, 'Simpan peran', '.drawer'); await waitToast(page, /Peran @siti diperbarui/);
    assert.strictEqual(fake.collabs.find((c) => c.login === 'siti').role, 'read'); await page.waitForFunction(() => [...document.querySelectorAll('.cards .item')].some((r) => /@siti/.test(r.textContent) && /Pembaca/.test(r.textContent)));
  });
  await t('pengguna: cabut akses butuh konfirmasi', async () => {
    await clickIn(page, /@andi/, '.icon-btn.danger'); await page.waitForSelector('.dlg'); assert.ok(await dlgBtn(page, 'Batal')); await sleep(100); assert.ok(fake.collabs.some((c) => c.login === 'andi'));
    await clickIn(page, /@andi/, '.icon-btn.danger'); await page.waitForSelector('.dlg'); assert.ok(await dlgBtn(page, 'Cabut akses')); await waitToast(page, /Akses @andi dicabut/);
    assert.ok(!fake.collabs.some((c) => c.login === 'andi')); await page.waitForFunction(() => ![...document.querySelectorAll('.cards .item')].some((r) => /@andi/.test(r.textContent)));
  });
  await t('pengguna: batalkan undangan tertunda', async () => {
    await clickIn(page, /@rina/, '.icon-btn.danger'); await page.waitForSelector('.dlg'); assert.ok(await dlgBtn(page, 'Batalkan undangan')); await waitToast(page, /Undangan @rina dibatalkan/);
    assert.ok(!fake.invites.some((i) => i.login === 'rina'));
  });
  await t('pengguna: token non-admin hanya bisa melihat (tanpa tombol undang), dengan penjelasan', async () => {
    const q = await newPage(390, 800); await q.goto(base + '/admin/'); await login(q, 'push-token'); await q.waitForSelector('.stats');
    await q.evaluate(() => { location.hash = '#/users'; }); await q.waitForSelector('.cards .item');
    assert.match(await text(q, '.notice'), /hanya bisa melihat daftar ini/); assert.strictEqual(await q.$$eval('.page-actions .btn', (b) => b.length), 0); assert.strictEqual(await q.$$eval('.cards .icon-btn.danger', (b) => b.length), 0);
    await q.click('.nav-add'); await q.waitForSelector('.drawer'); const items = await q.$$eval('.drawer .menu-row b', (b) => b.map((x) => x.textContent)); assert.ok(!items.includes('Pengguna'), 'menu Tambah tidak menawarkan undangan');
    await q.close();
  });
  await t('pengguna: menu Tambah (orb) menawarkan Jejak/Rekam GPS/Ulasan/Artikel/Gambar/Pengguna dan membuka formulir', async () => {
    await page.click('.nav-add'); await page.waitForSelector('.drawer'); const items = await page.$$eval('.drawer .menu-row b', (b) => b.map((x) => x.textContent)); assert.deepStrictEqual(items, ['Jejak', 'Rekam jejak GPS', 'Ulasan', 'Artikel', 'Gambar', 'Pengguna']);
    await page.evaluate(() => [...document.querySelectorAll('.drawer .menu-row')].find((b) => /Ulasan/.test(b.textContent)).click()); await page.waitForFunction(() => /Tambah ulasan/.test(document.querySelector('.drawer-head h2')?.textContent || ''));
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.drawer'));
  });

  /* ---------- Lintasan GPS: impor, ekspor, edit titik, rekam ---------- */
  await page.evaluate(() => {
    window.__dl = []; window.__dlNames = [];
    const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__dl.push(b); return o(b); };
    const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dlNames.push(this.download); return this.download ? undefined : c.call(this); };
  });
  const lastDownload = () => page.evaluate(async () => { const b = window.__dl[window.__dl.length - 1]; return b ? { type: b.type, name: window.__dlNames[window.__dlNames.length - 1], text: await b.text() } : null; });
  const val = async (label) => (await fieldInput(page, label)).evaluate((e) => e.value);
  const statOf = (label) => page.evaluate((l, ) => { const d = [...document.querySelectorAll('.trk-stats dt')].filter((x) => x.textContent === l).pop(); return d ? d.nextElementSibling.textContent : null; }, label);
  const chooseFile = async (p, openFn, file) => { const [ch] = await Promise.all([p.waitForFileChooser(), openFn()]); await ch.accept([file]); };
  const fillBasics = async (loc = 'Garut, Jawa Barat') => {
    await fill(page, 'Lokasi', loc); await fill(page, 'Rating', '4.5'); await fill(page, 'Deskripsi', 'Jalur uji dengan lintasan GPS lengkap dan pemandangan kawah.');
    const f = await page.$('.drawer input[type=file]'); const tmp = path.join(os.tmpdir(), 'foto-lintasan.png'); fs.writeFileSync(tmp, PNG); await f.uploadFile(tmp);
    await page.waitForFunction(() => /diunggah saat disimpan/.test(document.querySelector('.up-note').textContent));
  };
  const openTrailEditor = async (re) => { await nav(page, '#/trails'); await page.waitForSelector('.cards .item'); await clickIn(page, re, 'button.item-main'); await page.waitForSelector('.drawer'); };
  const closeEditors = async () => { for (let i = 0; i < 3 && (await $(page, '.drawer')); i++) { await page.keyboard.press('Escape'); await sleep(120); if (await $(page, '.dlg')) await dlgBtn(page, 'Buang'); await sleep(120); } };
  const gpxFile = path.join(os.tmpdir(), 'rute-uji.gpx'); fs.writeFileSync(gpxFile, Gpx.build({ name: 'Rute Uji Papandayan', tracks: [{ name: 'Rute Uji Papandayan', points: walk(1500) }] }));
  let newTrail = null;
  const trackFile = (id) => `data/tracks/${id}.json`;

  await t('lintasan: impor GPX di jejak baru → pratinjau (rute + profil), isian terisi otomatis, 1 commit berisi trails.json + data/tracks/<id>.json', async () => {
    await nav(page, '#/trails'); await page.waitForSelector('.cards .item'); await clickBtn(page, 'Tambah jejak'); await page.waitForSelector('.drawer');
    assert.match(await text(page, '.trk-empty'), /Belum ada lintasan/);
    await chooseFile(page, () => clickBtn(page, 'Impor GPX', '.drawer'), gpxFile);
    await page.waitForSelector('.trk-draw .trk-route'); await waitToast(page, /GPX diimpor: 1\.500 titik/);
    assert.ok(await $(page, '.trk-draw .trk-profile'), 'profil elevasi'); const pts = +(await statOf('Titik')); assert.ok(pts > 20 && pts <= 800, 'titik tersimpan ' + pts);
    assert.strictEqual(await val('Nama jejak'), 'Rute Uji Papandayan'); assert.match(await val('Jarak'), /^\d+,\d km$/); assert.match(await val('Ketinggian'), /^[\d.]+ mdpl$/); assert.match(await val('Waktu tempuh'), /jam|menit/);
    assert.ok(Math.abs(parseFloat(await val('Latitude')) - -7.3198) < 0.01 && Math.abs(parseFloat(await val('Longitude')) - 107.7313) < 0.01);
    assert.match(await text(page, '.trk-staged'), /belum tersimpan/); await fillBasics();
    const before = fake.log.length, nBefore = ghData('trails').length;
    await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Jejak ditambahkan/);
    assert.strictEqual(fake.log.length, before + 1, 'satu commit'); const tr = ghData('trails'); newTrail = tr[tr.length - 1]; assert.strictEqual(tr.length, nBefore + 1);
    assert.ok(fake.files.has(trackFile(newTrail.id)), 'berkas lintasan ikut di-commit'); const saved = Gpx.parseTrack(fake.text(trackFile(newTrail.id)));
    assert.strictEqual(newTrail.track.pts, saved.length); assert.strictEqual(newTrail.track.pts, pts); assert.strictEqual(newTrail.track.dl, true); assert.ok(newTrail.track.dist > 5000 && newTrail.track.gain > 1000);
    assert.strictEqual(Math.round(Gpx.analyze(saved).dist), newTrail.track.dist, 'ringkasan sinkron dengan berkas'); assert.strictEqual(Gpx.analyze(saved).gain, newTrail.track.gain); assert.ok(!fake.text('data/trails.json').includes('"pts":[['), 'titik lengkap tidak ada di trails.json');
    await page.waitForFunction(() => [...document.querySelectorAll('.cards .item')].some((r) => /Rute Uji Papandayan/.test(r.textContent) && r.querySelector('.chip.gpx')));
  });
  await t('lintasan: ekspor GPX dari editor → GPX valid (lintasan + titik jejak) sama dengan yang tersimpan', async () => {
    await openTrailEditor(/Rute Uji Papandayan/); await page.waitForSelector('.trk-draw .trk-route', { timeout: 8000 });
    await clickBtn(page, 'Ekspor GPX', '.drawer'); await page.waitForFunction(() => window.__dl.length > 0); const d = await lastDownload();
    assert.strictEqual(d.name, 'sadalan-rute-uji-papandayan.gpx'); assert.match(d.type, /gpx/); const g = Gpx.parse(d.text);
    assert.strictEqual(g.tracks[0].points.length, newTrail.track.pts); assert.strictEqual(g.waypoints[0].name, 'Rute Uji Papandayan'); assert.ok(g.tracks[0].points.every((p) => p.ele != null), 'elevasi ikut terekspor');
  });
  await t('lintasan: edit titik — pilih titik, potong, hapus, koordinat, balik arah, urungkan, rapikan', async () => {
    const total0 = +(await statOf('Titik')); await clickBtn(page, 'Edit lintasan', '.drawer'); await page.waitForFunction(() => document.querySelectorAll('.drawer').length === 2); await sleep(150);
    const dr = '.drawer-wrap ~ .drawer-wrap .drawer'; const info = () => text(page, dr + ' .trk-info'); const setIdx = (i) => page.$eval(dr + ' input[type=range]', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, i);
    assert.match(await info(), new RegExp(`Titik 1 dari ${total0}`)); await setIdx(100); assert.match(await info(), /Titik 101 dari/);
    assert.ok(await $(page, dr + ' .trk-cursor') && await $(page, dr + ' .trk-cursor-line'), 'penanda titik di peta & profil');
    await clickBtn(page, 'Potong sebelum titik ini', dr); assert.match(await info(), new RegExp(`Titik 1 dari ${total0 - 100}`));
    await clickBtn(page, 'Urungkan', dr); assert.match(await info(), new RegExp(`dari ${total0}`)); await clickBtn(page, 'Potong sebelum titik ini', dr);
    const first = await page.$eval(dr + ' .trk-coords input', (e) => e.value); await clickBtn(page, 'Balik arah', dr); assert.match(await info(), new RegExp(`Titik ${total0 - 100} dari ${total0 - 100}`), 'penanda mengikuti titik yang sama (kini di ujung)'); assert.strictEqual(await page.$eval(dr + ' .trk-coords input', (e) => e.value), first, 'titik yang sama'); await setIdx(0); assert.notStrictEqual(await page.$eval(dr + ' .trk-coords input', (e) => e.value), first, 'titik awal kini titik lain = arah terbalik'); await clickBtn(page, 'Balik arah', dr);
    await setIdx(3); await clickBtn(page, 'Hapus titik ini', dr); assert.match(await info(), new RegExp(`dari ${total0 - 101}`));
    await page.$eval(dr + ' .trk-coords input', (e) => { e.value = 'abc'; }); await clickBtn(page, 'Terapkan koordinat titik', dr); assert.match(await text(page, dr + ' .err'), /Latitude.*valid/); assert.match(await info(), new RegExp(`dari ${total0 - 101}`), 'koordinat salah tidak mengubah apa pun');
    await setIdx(3); await page.$eval(dr + ' .trk-coords input', (e) => { e.value = '-7.30001'; }); await clickBtn(page, 'Terapkan koordinat titik', dr); assert.strictEqual(await page.$eval(dr + ' .trk-coords input', (e) => e.value), '-7.30001');
    await clickBtn(page, 'Terapkan perubahan', dr); await page.waitForFunction(() => document.querySelectorAll('.drawer').length === 1); assert.match(await text(page, '.trk-staged'), /belum tersimpan/); assert.strictEqual(+(await statOf('Titik')), total0 - 101);
    await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Jejak diperbarui/);
    const saved = Gpx.parseTrack(fake.text(trackFile(newTrail.id))); assert.strictEqual(saved.length, total0 - 101); newTrail = ghData('trails').find((x) => x.id === newTrail.id); assert.strictEqual(newTrail.track.pts, total0 - 101);
  });
  await t('lintasan: “Rapikan otomatis” membuang lonjakan GPS; “Terapkan ke isian” menimpa jarak/ketinggian/waktu dari lintasan', async () => {
    await openTrailEditor(/Rute Uji Papandayan/); await page.waitForSelector('.trk-draw .trk-route'); await fill(page, 'Jarak', '1 km'); await fill(page, 'Waktu tempuh', '99 jam');
    await clickBtn(page, 'Terapkan ke isian', '.drawer'); await waitToast(page, /diperbarui dari lintasan/); assert.notStrictEqual(await val('Jarak'), '1 km'); assert.match(await val('Waktu tempuh'), /^\d+–\d+ jam$/);
    await clickBtn(page, 'Edit lintasan', '.drawer'); await page.waitForFunction(() => document.querySelectorAll('.drawer').length === 2); await sleep(120); const dr = '.drawer-wrap ~ .drawer-wrap .drawer';
    await clickBtn(page, 'Rapikan otomatis', dr); await waitToast(page, /Dirapikan: \d+ titik lonjakan GPS dibuang/); await clickBtn(page, 'Batal', dr);
    if (await $(page, '.dlg')) await dlgBtn(page, 'Buang'); await page.waitForFunction(() => document.querySelectorAll('.drawer').length === 1); await closeEditors();
  });
  await t('lintasan: file tidak valid ditolak dengan pesan jelas (bukan GPX, ekstensi salah, tanpa lintasan, terlalu besar) dan tidak mengubah isian', async () => {
    await nav(page, '#/trails'); await page.waitForSelector('.cards .item'); await clickBtn(page, 'Tambah jejak'); await page.waitForSelector('.drawer');
    const mk = (name, body) => { const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, body); return f; };
    const cases = [['palsu.gpx', '<html><body>bukan gpx</body></html>', /bukan berkas GPX/], ['catatan.txt', 'halo', /berekstensi \.gpx/], ['kosong.gpx', '<gpx version="1.1"><wpt lat="1" lon="1"/></gpx>', /tidak berisi lintasan/], ['raksasa.gpx', '<gpx>' + ' '.repeat(9 * 1024 * 1024) + '</gpx>', /terlalu besar/]];
    for (const [name, body, re] of cases) { await page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove())); await chooseFile(page, () => clickBtn(page, 'Impor GPX', '.drawer'), mk(name, body)); await waitToast(page, re); assert.ok(!(await $(page, '.trk-draw')), name + ' tidak boleh memasang lintasan'); }
    assert.strictEqual(await val('Nama jejak'), ''); await closeEditors();
  });
  await t('lintasan: hapus lintasan → berkas lintasan terhapus di commit yang sama dan kunci track hilang; jejak tetap ada', async () => {
    await openTrailEditor(/Rute Uji Papandayan/); await page.waitForSelector('.trk-draw .trk-route'); await clickBtn(page, 'Hapus', '.trk-actions'); await page.waitForSelector('.dlg'); assert.ok(await dlgBtn(page, 'Hapus lintasan'));
    await page.waitForSelector('.trk-empty'); const before = fake.log.length; await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Jejak diperbarui/);
    assert.strictEqual(fake.log.length, before + 1); assert.ok(!fake.files.has(trackFile(newTrail.id)), 'berkas lintasan terhapus'); const n = ghData('trails').find((x) => x.id === newTrail.id); assert.ok(n && !('track' in n));
  });
  await t('lintasan: “Isi Latitude/Longitude dari posisi saya” memakai GPS peramban', async () => {
    await page.evaluate(() => { const w = new Map(); let id = 0; window.__geo = { emit(c) { w.forEach((x) => x.ok({ coords: { latitude: c.lat, longitude: c.lng, altitude: c.ele == null ? null : c.ele, accuracy: c.acc == null ? 5 : c.acc }, timestamp: c.t })); }, error(code) { w.forEach((x) => x.err && x.err({ code })); }, count: () => w.size };
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition(ok, err) { w.set(++id, { ok, err }); return id; }, clearWatch(i) { w.delete(i); }, getCurrentPosition(ok) { ok({ coords: { latitude: -7.51234, longitude: 110.56789, altitude: 1200, accuracy: 12 }, timestamp: Date.now() }); } } }); });
    await openTrailEditor(/Rute Uji Papandayan/); await clickBtn(page, 'Isi Latitude/Longitude dari posisi saya', '.drawer'); await waitToast(page, /dari posisi Anda \(±12 m\)/);
    assert.strictEqual(await val('Latitude'), '-7.51234'); assert.strictEqual(await val('Longitude'), '110.56789'); await closeEditors();
  });

  /* rekam GPS dengan geolokasi tiruan yang dikendalikan tes */
  const T0 = Date.UTC(2026, 9, 11, 7, 0, 0);
  const emitWalk = async (from, n, o = {}) => { for (let i = from; i < from + n; i++) await page.evaluate((c) => window.__geo.emit(c), { lat: -7.3 + i * 0.00009, lng: 107.7 + i * 0.00003, ele: 1500 + i * 2, acc: 5, t: T0 + i * 5000, ...o }); };
  const recStat = (label) => page.evaluate((l) => { const d = [...document.querySelectorAll('.rec-stats dt')].find((x) => x.textContent === l); return d ? d.nextElementSibling.textContent : null; }, label);
  await t('rekam GPS: mulai → titik valid direkam, akurasi buruk/terlalu dekat/lonjakan ditolak, jeda & lanjutkan memakai pengawas GPS', async () => {
    await nav(page, '#/trails'); await page.waitForSelector('.cards .item'); await page.evaluate(() => localStorage.removeItem('sadalan-rec-v1'));
    await page.click('.nav-add'); await page.waitForSelector('.drawer'); await page.evaluate(() => [...document.querySelectorAll('.drawer .menu-row')].find((b) => /Rekam jejak GPS/.test(b.textContent)).click());
    await page.waitForFunction(() => /Rekam jejak GPS/.test(document.querySelector('.drawer-head h2')?.textContent || '')); assert.match(await text(page, '.rec-status'), /Siap merekam/);
    await clickBtn(page, 'Mulai merekam', '.drawer'); assert.strictEqual(await page.evaluate(() => window.__geo.count()), 1); assert.match(await text(page, '.rec-status'), /Menunggu sinyal/);
    await emitWalk(0, 20); assert.strictEqual(await recStat('Titik'), '20'); assert.match(await recStat('Jarak'), /^0,2 km$/); assert.match(await text(page, '.rec-acc'), /akurasi ±5 m/); assert.ok(await $(page, '.drawer .trk-route'), 'pratinjau langsung');
    await page.evaluate((t0) => { window.__geo.emit({ lat: -7.3, lng: 107.7005, acc: 90, t: t0 + 200000 }); window.__geo.emit({ lat: -7.3 + 19 * 0.00009, lng: 107.7 + 19 * 0.00003, acc: 5, t: t0 + 200500 }); window.__geo.emit({ lat: -7.2, lng: 107.9, acc: 5, t: t0 + 100000 + 1000 }); }, T0);
    assert.strictEqual(await recStat('Titik'), '20', 'akurasi 90 m, titik kembar, dan lompatan 20 km ditolak');
    await clickBtn(page, 'Jeda', '.drawer'); assert.strictEqual(await page.evaluate(() => window.__geo.count()), 0, 'GPS dilepas saat jeda'); assert.match(await text(page, '.rec-status'), /Dijeda/);
    assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem('sadalan-rec-v1')).pts.length)) === 20, 'tersimpan sementara di perangkat');
    await clickBtn(page, 'Lanjutkan', '.drawer'); assert.strictEqual(await page.evaluate(() => window.__geo.count()), 1); await emitWalk(20, 20); assert.strictEqual(await recStat('Titik'), '40');
  });
  await t('rekam GPS: izin lokasi ditolak → pesan jelas dan perekam dijeda; rekaman yang ada aman', async () => {
    await page.evaluate(() => window.__geo.error(1)); await page.waitForFunction(() => /Izin lokasi ditolak/.test(document.querySelector('.rec-status')?.textContent || '')); assert.strictEqual(await page.evaluate(() => window.__geo.count()), 0); assert.strictEqual(await recStat('Titik'), '40');
    await clickBtn(page, 'Lanjutkan', '.drawer'); await emitWalk(40, 5); assert.strictEqual(await recStat('Titik'), '45');
  });
  await t('rekam GPS: tutup perekam di tengah jalan → rekaman tetap ada; muncul pemberitahuan dan bisa dilanjutkan', async () => {
    await page.keyboard.press('Escape'); await page.waitForSelector('.dlg'); assert.match(await text(page, '.dlg h3'), /Tutup perekam/); assert.ok(await dlgBtn(page, 'Tutup')); await page.waitForFunction(() => !document.querySelector('.drawer'));
    assert.strictEqual(await page.evaluate(() => window.__geo.count()), 0, 'GPS dilepas saat ditutup'); assert.ok(await page.evaluate(() => !!localStorage.getItem('sadalan-rec-v1')));
    await nav(page, '#/trails'); await page.waitForSelector('.cards .item .item-main'); assert.match(await text(page, '.notice'), /rekaman GPS yang belum disimpan \(45 titik/);
    await nav(page, '#/dashboard'); assert.match(await text(page, '.notice'), /45 titik/, 'juga muncul di Ringkasan'); await nav(page, '#/trails'); await page.waitForSelector('.notice');
    await page.evaluate(() => [...document.querySelectorAll('.notice .btn')].find((b) => b.textContent === 'Lanjutkan').click()); await page.waitForSelector('.rec-stats'); assert.strictEqual(await recStat('Titik'), '45'); assert.match(await text(page, '.rec-status'), /Dijeda/);
  });
  await t('rekam GPS: selesai → “Gunakan lintasan” → pilih Jejak baru → formulir berisi isian dari rekaman → simpan → lintasan tersimpan & rekaman sementara dihapus', async () => {
    await clickBtn(page, 'Selesai', '.drawer'); assert.match(await text(page, '.rec-status'), /Rekaman selesai/); await clickBtn(page, 'Gunakan lintasan', '.drawer');
    await page.waitForFunction(() => /Rekaman selesai/.test(document.querySelector('.drawer-head h2')?.textContent || '')); assert.ok(await $(page, '.drawer .trk-route'));
    assert.strictEqual(await page.$$eval('.drawer select option', (o) => o.length), ghData('trails').length + 1); await clickBtn(page, 'Lanjut ke formulir', '.drawer'); await page.waitForFunction(() => /Tambah jejak/.test(document.querySelector('.drawer-head h2')?.textContent || ''));
    assert.match(await text(page, '.trk-staged'), /belum tersimpan/); assert.strictEqual(await val('Latitude'), '-7.3'); assert.match(await val('Jarak'), /^0,\d km$/); assert.match(await val('Ketinggian'), /mdpl/);
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('sadalan-rec-v1')), null, 'rekaman sementara dibersihkan setelah dipakai');
    await fill(page, 'Nama jejak', 'Jalur Rekaman Uji'); await fillBasics('Bandung, Jawa Barat'); await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Jejak ditambahkan/);
    const rec = ghData('trails').find((x) => x.name === 'Jalur Rekaman Uji'); assert.ok(rec && rec.track && rec.track.pts === 45 - 0 || rec.track.pts <= 45); assert.ok(fake.files.has(trackFile(rec.id)));
    newTrail = rec;
  });
  await t('rekam GPS: rekaman terlalu pendek ditolak; “Buang” meminta konfirmasi dan membersihkan penyimpanan', async () => {
    await clickBtn(page, 'Rekam GPS'); await page.waitForSelector('.rec-stats'); await clickBtn(page, 'Mulai merekam', '.drawer'); await emitWalk(0, 1, { t: T0 }); await emitWalk(1, 1, { lat: -7.30003, t: T0 + 9000 });
    await page.evaluate(() => { window.__geo.emit({ lat: -7.29999, lng: 107.7, acc: 5, t: Date.now() }); }); await clickBtn(page, 'Selesai', '.drawer'); await clickBtn(page, 'Gunakan lintasan', '.drawer');
    await page.waitForFunction(() => /terlalu pendek/.test(document.querySelector('.rec-status')?.textContent || '')); await clickBtn(page, 'Buang', '.drawer'); await page.waitForSelector('.dlg'); assert.ok(await dlgBtn(page, 'Buang rekaman'));
    await page.waitForFunction(() => !document.querySelector('.drawer')); assert.strictEqual(await page.evaluate(() => localStorage.getItem('sadalan-rec-v1')), null);
  });
  await t('lintasan: rekaman bisa dipasang ke jejak yang sudah ada (perbarui lintasan) dan “Simpan salinan GPX” tersedia', async () => {
    await nav(page, '#/trails'); await page.waitForSelector('.cards .item'); await clickBtn(page, 'Rekam GPS'); await page.waitForSelector('.rec-stats'); await clickBtn(page, 'Mulai merekam', '.drawer'); await emitWalk(0, 12); await clickBtn(page, 'Selesai', '.drawer'); await clickBtn(page, 'Gunakan lintasan', '.drawer');
    await page.waitForFunction(() => /Rekaman selesai/.test(document.querySelector('.drawer-head h2')?.textContent || '')); await clickBtn(page, 'Simpan salinan GPX', '.drawer'); const d = await lastDownload(); assert.match(d.name, /^sadalan-rekaman-\d{4}-\d{2}-\d{2}\.gpx$/); assert.strictEqual(Gpx.parse(d.text).tracks[0].points.length, 12);
    await page.$eval('.drawer select', (s, id) => { s.value = String(id); }, newTrail.id); await clickBtn(page, 'Lanjut ke formulir', '.drawer'); await page.waitForFunction(() => /Ubah jejak/.test(document.querySelector('.drawer-head h2')?.textContent || ''));
    assert.strictEqual(await val('Nama jejak'), newTrail.name, 'isian jejak yang ada tidak ditimpa'); await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Jejak diperbarui/);
    assert.strictEqual(Gpx.parseTrack(fake.text(trackFile(newTrail.id))).length, 12); assert.strictEqual(ghData('trails').find((x) => x.id === newTrail.id).track.pts, 12);
  });
  await t('lintasan: “Impor GPX” dari halaman Jejak membuka formulir jejak baru dengan isian awal dari file', async () => {
    await nav(page, '#/trails'); await page.waitForSelector('.cards .item'); await chooseFile(page, () => clickBtn(page, 'Impor GPX', '.page-actions'), gpxFile);
    await page.waitForFunction(() => /Tambah jejak/.test(document.querySelector('.drawer-head h2')?.textContent || '')); await page.waitForSelector('.trk-draw .trk-route');
    assert.strictEqual(await val('Nama jejak'), 'Rute Uji Papandayan'); assert.match(await val('Jarak'), /km$/); assert.match(await val('Ketinggian'), /mdpl$/); assert.strictEqual(await val('Kesulitan'), 'Menengah'); await closeEditors();
  });
  await t('lintasan: “Ekspor GPX” dari halaman Jejak → satu berkas berisi titik semua jejak + semua lintasan yang ada', async () => {
    await nav(page, '#/trails'); await page.waitForSelector('.cards .item'); const n0 = await page.evaluate(() => window.__dl.length); await clickBtn(page, 'Ekspor GPX', '.page-actions'); await page.waitForFunction((n) => window.__dl.length > n, {}, n0);
    const d = await lastDownload(); const g = Gpx.parse(d.text); const tr = ghData('trails'); assert.strictEqual(d.name, 'sadalan-jejak.gpx'); assert.strictEqual(g.waypoints.length, tr.length); assert.strictEqual(g.tracks.length, tr.filter((x) => x.track).length); assert.ok(g.tracks.length >= 1 && g.tracks[0].name === newTrail.name, 'lintasan jejak yang punya GPX ikut');
  });
  await t('lintasan: menghapus jejak ikut menghapus berkas lintasannya dalam commit yang sama', async () => {
    await nav(page, '#/trails'); await page.waitForSelector('.cards .item'); const id = newTrail.id; assert.ok(fake.files.has(trackFile(id))); const before = fake.log.length;
    await clickIn(page, new RegExp(newTrail.name), '.icon-btn.danger'); await page.waitForSelector('.dlg'); assert.match(await text(page, '.dlg p'), /Lintasan GPS-nya ikut dihapus/); assert.ok(await dlgBtn(page, 'Hapus')); await waitToast(page, /Jejak dihapus/);
    assert.strictEqual(fake.log.length, before + 1); assert.ok(!fake.files.has(trackFile(id)), 'berkas yatim tidak boleh tersisa'); assert.ok(!ghData('trails').some((x) => x.id === id));
  });
  await t('lintasan: berkas lintasan yatim tidak tersisa di repositori setelah seluruh skenario', async () => {
    const left = [...fake.files.keys()].filter((p) => p.startsWith('data/tracks/')).map((p) => +p.match(/(\d+)\.json$/)[1]); const withTrack = ghData('trails').filter((x) => x.track).map((x) => x.id);
    assert.deepStrictEqual(left.sort(), withTrack.sort());
  });
  await t('lintasan: tampilan mobile (390px) — editor, pratinjau, dan perekam tidak meluap ke samping', async () => {
    const m = await newPage(390, 820); await m.goto(base + '/admin/'); await login(m, 'good-token'); await m.waitForSelector('.stats'); await m.evaluate(() => { location.hash = '#/trails'; }); await m.waitForSelector('.cards .item');
    const [ch] = await Promise.all([m.waitForFileChooser(), m.evaluate(() => [...document.querySelectorAll('.page-actions .btn')].find((b) => b.textContent.trim() === 'Impor GPX').click())]); await ch.accept([gpxFile]);
    await m.waitForSelector('.drawer .trk-draw .trk-route'); await sleep(300); const ov = await m.evaluate(() => { const b = document.querySelector('.drawer-body'); return [b.scrollWidth - b.clientWidth, document.documentElement.scrollWidth - innerWidth]; }); assert.ok(ov[0] <= 1 && ov[1] <= 1, 'overflow ' + ov);
    await m.evaluate(() => document.querySelector('.trk-box').scrollIntoView()); await m.screenshot({ path: '/tmp/admin-mobile-track.png' });
    await m.evaluate(() => [...document.querySelectorAll('.trk-actions .btn')].find((b) => /Edit lintasan/.test(b.textContent)).click()); await m.waitForFunction(() => document.querySelectorAll('.drawer').length === 2); await sleep(300);
    const ov2 = await m.evaluate(() => { const b = document.querySelector('.drawer-wrap ~ .drawer-wrap .drawer-body'); return b.scrollWidth - b.clientWidth; }); assert.ok(ov2 <= 1, 'editor overflow ' + ov2); await m.screenshot({ path: '/tmp/admin-mobile-trackedit.png' });
    await m.keyboard.press('Escape'); await sleep(150); if (await m.$('.dlg')) await m.evaluate(() => [...document.querySelectorAll('.dlg .btn')].find((b) => b.textContent.trim() === 'Buang')?.click()); await sleep(150); await m.keyboard.press('Escape'); await sleep(150); if (await m.$('.dlg')) await m.evaluate(() => [...document.querySelectorAll('.dlg .btn')].find((b) => b.textContent.trim() === 'Buang')?.click());
    await m.waitForFunction(() => !document.querySelector('.drawer')); await m.evaluate(() => localStorage.removeItem('sadalan-rec-v1'));
    await m.evaluate(() => { const w = new Map(); let id = 0; window.__geo = { emit(c) { w.forEach((x) => x.ok({ coords: { latitude: c.lat, longitude: c.lng, altitude: c.ele, accuracy: 6 }, timestamp: c.t })); } }; Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition(ok, err) { w.set(++id, { ok, err }); return id; }, clearWatch(i) { w.delete(i); } } }); });
    await m.click('.nav-add'); await m.waitForSelector('.drawer'); await m.evaluate(() => [...document.querySelectorAll('.drawer .menu-row')].find((b) => /Rekam jejak GPS/.test(b.textContent)).click()); await m.waitForSelector('.rec-stats'); await m.evaluate(() => [...document.querySelectorAll('.drawer .btn')].find((b) => b.textContent.trim() === 'Mulai merekam').click());
    for (let i = 0; i < 25; i++) await m.evaluate((c) => window.__geo.emit(c), { lat: -7.3 + i * 0.00009, lng: 107.7 + Math.sin(i / 4) * 0.0003 + i * 0.00002, ele: 1500 + i * 3, t: Date.UTC(2026, 9, 11, 7) + i * 5000 });
    await sleep(300); const ov3 = await m.evaluate(() => { const b = document.querySelector('.drawer-body'); return b.scrollWidth - b.clientWidth; }); assert.ok(ov3 <= 1, 'perekam overflow ' + ov3); await m.screenshot({ path: '/tmp/admin-mobile-rec.png' });
    await m.evaluate(() => [...document.querySelectorAll('.drawer .btn')].find((b) => b.textContent.trim() === 'Jeda').click()); await m.keyboard.press('Escape'); await m.waitForSelector('.dlg'); await m.evaluate(() => [...document.querySelectorAll('.dlg .btn')].find((b) => b.textContent.trim() === 'Tutup').click()); await m.evaluate(() => localStorage.removeItem('sadalan-rec-v1'));
    await m.close();
  });

  await t('tanpa error JavaScript selama seluruh alur admin', async () => { assert.deepStrictEqual(errors, []); });

  await t('tampilan mobile (390px): bottom-nav, menu Tambah, halaman utama tidak meluap ke samping', async () => {
    const m = await newPage(390, 800); await m.goto(base + '/admin/'); await login(m, 'good-token'); await m.waitForSelector('.stats');
    for (const h of ['dashboard', 'trails', 'reviews', 'blog', 'media', 'users', 'settings', 'site', 'profile']) {
      await m.evaluate((x) => { location.hash = '#/' + x; }, h); await m.waitForFunction((x) => document.title.length > 0 && document.querySelector('main .view'), {}, h); await sleep(250);
      const ov = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(ov <= 1, `${h}: overflow horizontal ${ov}`);
    }
    const nav = await m.$eval('.bottom-nav', (n) => { const r = n.getBoundingClientRect(); return { bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight, cols: getComputedStyle(n).gridTemplateColumns.split(' ').length }; });
    assert.strictEqual(nav.bottom, nav.vh); assert.strictEqual(nav.cols, 5);
    await m.evaluate(() => { location.hash = '#/reviews'; }); await m.waitForSelector('.cards .item'); await m.click('.nav-add'); await m.waitForSelector('.drawer'); await sleep(400); await m.screenshot({ path: '/tmp/admin-mobile-add.png' });
    await m.mouse.click(200, 60); await m.waitForFunction(() => !document.querySelector('.drawer'));
    await clickBtn(m, 'Tambah ulasan'); await m.waitForSelector('.drawer'); const ov2 = await m.evaluate(() => document.querySelector('.drawer-body').scrollWidth - document.querySelector('.drawer-body').clientWidth); assert.ok(ov2 <= 1, 'drawer overflow ' + ov2);
    await sleep(400); await m.screenshot({ path: '/tmp/admin-mobile-form.png' }); await m.keyboard.press('Escape'); await m.waitForFunction(() => !document.querySelector('.drawer'));
    for (const [h, f] of [['dashboard', 'dashboard'], ['trails', 'trails'], ['users', 'users'], ['settings', 'settings'], ['site', 'site']]) {
      await m.evaluate((x) => { location.hash = '#/' + x; }, h); await sleep(500); await m.screenshot({ path: `/tmp/admin-mobile-${f}.png`, fullPage: h === 'site' });
    }
    await m.close();
  });
  await t('tampilan desktop (1280px): kolom aplikasi melebar bertahap, bottom-nav sejajar kolom', async () => {
    const w = await page.evaluate(() => Math.round(document.body.getBoundingClientRect().width)); assert.ok(w >= 900 && w <= 960, 'lebar ' + w);
    const nb = await page.$eval('.bottom-nav', (n) => { const r = n.getBoundingClientRect(); const b = document.body.getBoundingClientRect(); return Math.abs(r.left - b.left) <= 1 && Math.abs(r.right - b.right) <= 1; }); assert.ok(nb, 'bottom-nav selebar kolom');
  });

  await page.screenshot({ path: '/tmp/admin-desktop-media.png' });
  await nav(page, '#/trails'); await page.waitForSelector('.cards .item'); await page.screenshot({ path: '/tmp/admin-desktop-trails.png' });
  await nav(page, '#/dashboard'); await page.waitForSelector('.stats'); await page.screenshot({ path: '/tmp/admin-desktop-dashboard.png' });
  await nav(page, '#/site'); await page.waitForSelector('.formpanel'); await page.screenshot({ path: '/tmp/admin-desktop-site.png', fullPage: true });
  await nav(page, '#/users'); await page.waitForSelector('.cards .item'); await page.screenshot({ path: '/tmp/admin-desktop-users.png' });

  await t('keluar: sesi dihapus dan kembali ke halaman masuk', async () => {
    await nav(page, '#/settings'); await page.waitForSelector('.menu-group');
    await page.evaluate(() => [...document.querySelectorAll('.menu-row')].find((b) => b.querySelector('b').textContent === 'Keluar').click()); await page.waitForSelector('.login-card');
    assert.ok(!(await page.evaluate(() => document.body.classList.contains('has-nav'))), 'kelas has-nav dibersihkan');
    assert.ok(!(await page.evaluate(() => sessionStorage.getItem('sadalan_cms_session') || localStorage.getItem('sadalan_cms_session'))));
  });
  await t('"Ingat di perangkat ini": sesi pulih setelah muat ulang halaman', async () => {
    await login(page, 'good-token', { remember: true }); await page.waitForSelector('.stats'); await page.reload(); await page.waitForSelector('.stats');
    assert.match(await text(page, '.page-head h1'), /Halo, Budi/); await page.evaluate(() => localStorage.clear());
  });
  await t('token dicabut di tengah sesi → otomatis keluar dengan pesan', async () => {
    await page.reload(); await page.waitForSelector('.login-card'); await login(page, 'good-token'); await page.waitForSelector('.stats');
    fake.tokens['good-token'] = null; await nav(page, '#/trails'); await page.waitForSelector('.cards .item'); await clickBtn(page, 'Tambah jejak');
    await fill(page, 'Nama jejak', 'X'); await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await page.waitForSelector('.login-card'); assert.match(await text(page, '.login-err'), /Sesi berakhir/);
    fake.tokens['good-token'] = 'rw';
  });

  await t('situs publik: render normal tanpa error JS (data dari JSON, slide hero, filter, modal)', async () => {
    const pub = await newPage(420, 900); const errs = []; pub.on('pageerror', (e) => errs.push(e.message));
    await pub.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await pub.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#trailList') && document.querySelector('#trailList').children.length > 0, { timeout: 8000 }).catch(() => {});
    const info = await pub.evaluate(() => ({ title: document.title, h1: document.querySelector('.hero-copy h1') && document.querySelector('.hero-copy h1').textContent, cards: document.querySelectorAll('#trailList > *').length, footer: !!document.querySelector('.site-footer') }));
    assert.match(info.title, /Sadalan/); assert.ok(info.cards > 0, 'kartu jejak'); assert.ok(info.footer); await pub.close();
  });

  await t('situs publik: Reviews tanpa tombol/form tulis ulasan; keterangan, aturan, dan kontak Admin tersedia', async () => {
    const pub = await newPage(420, 900); const errs = []; pub.on('pageerror', (e) => errs.push(e.message));
    await pub.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; try { localStorage.setItem('sadalan_reviews', JSON.stringify([{ id: 'u1', cat: 'Spot', title: 'Ulasan lama pengunjung', rating: 5, author: 'X', iso: '2026-01-01', text: 'tersimpan lokal' }])); } catch (e) { /* abaikan */ } });
    await pub.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await pub.waitForFunction(() => typeof Store !== 'undefined' && typeof allReviews === 'function', { timeout: 8000 });
    const seedN = JSON.parse(fs.readFileSync(path.join(root, 'data', 'reviews.json'), 'utf8')).length; /* situs publik membaca file di disk, bukan repositori emulator */
    assert.strictEqual(await pub.evaluate(() => allReviews().length), seedN, 'hanya ulasan dari data/reviews.json (ulasan lokal pengunjung tidak ikut tampil)');
    assert.strictEqual(await pub.evaluate(() => localStorage.getItem('sadalan_reviews')), null, 'data ulasan lokal lama dibersihkan');
    await pub.click('.nav-item[data-modal="reviews"]'); await pub.waitForSelector('#rvResults .blog-card, #rvResults [data-review]');
    const html = await pub.evaluate(() => document.querySelector('.modal-content').innerText);
    assert.ok(!/Tulis ulasan/i.test(html), 'tombol Tulis ulasan harus hilang'); assert.match(html, /hanya ditayangkan oleh Admin/);
    assert.strictEqual(await pub.$$eval('[data-modal="add-review"], form, textarea, input[type=file]', (e) => e.length), 0, 'tidak ada form penulisan');
    assert.match(await text(pub, '.rv-foot button'), /Kirim ulasan lewat Admin/);
    await pub.click('.rv-foot button'); await pub.waitForSelector('.rv-info');
    assert.match(await text(pub, '.modal-content h3'), /Ulasan lewat Admin/);
    assert.strictEqual(await pub.$$eval('.rv-info ul li', (l) => l.length), 6, 'aturan ulasan'); assert.strictEqual(await pub.$$eval('.rv-info ol li', (l) => l.length), 3, 'langkah mengirim');
    const links = await pub.$$eval('.rv-contact-link', (a) => a.map((x) => [x.getAttribute('href'), x.rel])); assert.ok(links.length >= 1); links.forEach(([h, r]) => { assert.match(h, /^https:\/\//); assert.match(r, /noopener/); });
    assert.strictEqual(await pub.$$eval('.modal-content form, .modal-content textarea, .modal-content input', (e) => e.length), 0);
    await pub.click('[data-rv-back]'); await pub.waitForSelector('#rvResults');
    await pub.click('#rvResults [data-review]'); await pub.waitForSelector('.rv-detail');
    const det = await text(pub, '.rv-detail'); assert.ok(!/Tulis ulasanmu/.test(det)); assert.match(det, /Punya ulasan\? Hubungi Admin/);
    assert.deepStrictEqual(errs, [], 'tanpa error JS: ' + errs.join(' | ')); await pub.close();
  });

  await t('situs publik: gembok kecil samar di bawah copyright (rata tengah) menuju login Admin, tanpa teks', async () => {
    const pub = await newPage(420, 900); await pub.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; });
    await pub.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await pub.waitForSelector('.sf-lock');
    const g = await pub.evaluate(() => { const a = document.querySelector('.sf-lock'), c = document.querySelector('.sf-copy'), f = document.querySelector('.site-footer'); const r = a.getBoundingClientRect(), cr = c.getBoundingClientRect(), fr = f.getBoundingClientRect(); const sv = a.querySelector('svg').getBoundingClientRect();
      return { text: a.textContent.trim(), label: a.getAttribute('aria-label'), href: a.getAttribute('href'), below: r.top >= cr.bottom - 1, centerDx: Math.abs((r.left + r.width / 2) - (fr.left + fr.width / 2)), icon: Math.round(sv.width), opacity: +getComputedStyle(a).opacity, tap: [Math.round(r.width), Math.round(r.height)] }; });
    assert.strictEqual(g.text, '', 'tanpa teks'); assert.strictEqual(g.label, 'Admin'); assert.strictEqual(g.href, 'admin/'); assert.ok(g.below, 'di bawah copyright'); assert.ok(g.centerDx <= 1, 'rata tengah ' + g.centerDx);
    assert.ok(g.icon <= 12 && g.opacity <= 0.25, 'kecil & samar'); assert.ok(g.tap[0] >= 28 && g.tap[1] >= 24, 'tetap bisa diketuk ' + g.tap);
    await Promise.all([pub.waitForNavigation({ waitUntil: 'domcontentloaded' }), pub.click('.sf-lock')]); assert.match(pub.url(), /\/admin\/$/); await pub.waitForSelector('.login-card');
    await pub.close();
  });

  await t('situs publik: jejak ber-GPX menampilkan tanda GPX, grafik rute + profil, statistik, unduh GPX, dan garis lintasan di peta', async () => {
    const trails = JSON.parse(fs.readFileSync(path.join(root, 'data', 'trails.json'), 'utf8'));
    const pts = Gpx.simplify(walk(1200), 800); const sum = Gpx.summary(pts, true);
    trails[0].name = 'Gunung "Uji" <b>X</b>'; trails[0].track = sum; trails[1].track = { ...sum, dl: false }; trails[2].track = sum; // trails[2]: berkas lintasan sengaja tidak ada (404)
    const json = (b) => ({ status: 200, contentType: 'application/json', body: typeof b === 'string' ? b : JSON.stringify(b) });
    const pub = await newPage(420, 900); pub.overrides = { '/data/trails.json': json(trails), [`/data/tracks/${trails[0].id}.json`]: json(Gpx.serialize(pts)), [`/data/tracks/${trails[1].id}.json`]: json(Gpx.serialize(pts)) };
    const errs = []; pub.on('pageerror', (e) => errs.push(e.message));
    await pub.evaluateOnNewDocument(() => {
      window.lucide = { createIcons() {} }; window.__L = { polylines: [], fit: 0 }; window.__dl = []; window.__names = [];
      const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__dl.push(b); return o(b); }; const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__names.push(this.download); return; } return c.call(this); };
      const layer = () => ({ addTo() { return this; }, bindPopup() { return this; }, on(ev, fn) { (this.h = this.h || {})[ev] = fn; return this; }, openPopup() { if (this.h && this.h.popupopen) this.h.popupopen(); return this; }, getBounds() { return {}; } });
      window.L = { map() { return { setView() { return this; }, fitBounds() { window.__L.fit++; } }; }, tileLayer: layer, circleMarker: () => layer(), polyline(p, o) { const l = layer(); window.__L.polylines.push({ n: p.length, color: o.color }); return l; } };
    });
    await pub.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await pub.waitForSelector('#trailList .trail-card');
    assert.strictEqual(await pub.$$eval('.trk-tag', (e) => e.length), 3, 'tanda GPX hanya pada jejak ber-lintasan'); assert.ok(!(await pub.$eval('#trailList .trail-card:nth-child(4)', (e) => !!e.querySelector('.trk-tag'))), 'jejak tanpa lintasan tidak bertanda');
    await pub.evaluate((id) => document.querySelector(`#trailList [data-trail="${id}"]`).click(), trails[0].id); await pub.waitForSelector('.trk-pub .trk-pub-route'); await pub.waitForSelector('.trk-pub .trk-pub-prof');
    await pub.evaluate(() => document.querySelector('.trk-pub').scrollIntoView({ block: 'center' })); await sleep(300); await pub.screenshot({ path: '/tmp/pub-track-detail.png' });
    assert.strictEqual(await pub.$$eval('.trk-pub-stats b', (b) => b.length), 3); assert.match(await text(pub, '.trk-pub-stats'), /Naik[\s\S]*Turun[\s\S]*Titik tertinggi/); assert.match(await pub.$eval('.trk-pub-stats b', (b) => b.textContent), /^\+[\d.]+ m$/);
    assert.strictEqual(await pub.$$eval('.trk-pub-route path.trk-line', (p) => p.length), 1); assert.strictEqual(await pub.$$eval('.trk-pub-route circle', (c) => c.length), 2);
    assert.ok((await pub.$eval('.trk-pub-route', (e) => e.getAttribute('aria-label'))).includes('<b>X</b>'), 'nama dengan HTML diperlakukan sebagai teks'); assert.strictEqual(await pub.$$eval('.modal-content h3 b, .trk-pub b b', (e) => e.length), 0, 'tidak ada elemen yang tersuntik');
    const btns = await pub.$$eval('.trk-pub-actions button', (b) => b.map((x) => x.textContent.trim())); assert.deepStrictEqual(btns, ['Lihat di peta', 'Unduh GPX']);
    await pub.click('[data-trk-dl]'); await pub.waitForFunction(() => window.__dl.length > 0); const dl = await pub.evaluate(async () => ({ name: window.__names[0], text: await window.__dl[0].text() })); const g = Gpx.parse(dl.text);
    assert.match(dl.name, /^sadalan-gunung-uji-b-x-b\.gpx$/); assert.strictEqual(g.tracks[0].points.length, pts.length); assert.strictEqual(g.waypoints.length, 1);
    await pub.click('[data-trk-map]'); await pub.waitForFunction(() => !document.querySelector('#modalWrap') || document.querySelector('#modalWrap').hidden); await pub.waitForFunction(() => window.__L.polylines.length === 1, { timeout: 4000 });
    const pl = await pub.evaluate(() => window.__L); assert.strictEqual(pl.polylines[0].n, pts.length); assert.ok(pl.fit >= 1, 'peta memperbesar ke lintasan'); assert.match(pl.polylines[0].color, /^#/);
    await pub.evaluate((id) => mapApi.markers[id].openPopup(), trails[0].id); await sleep(200); assert.strictEqual(await pub.evaluate(() => window.__L.polylines.length), 1, 'lintasan yang sama tidak digambar dua kali');
    await pub.evaluate((id) => mapApi.markers[id].openPopup(), trails[1].id); await pub.waitForFunction(() => window.__L.polylines.length === 2, { timeout: 4000 });
    await pub.evaluate((id) => { closeModal(); document.querySelector(`#trailList [data-trail="${id}"]`).click(); }, trails[1].id); await pub.waitForSelector('.trk-pub .trk-pub-route'); assert.deepStrictEqual(await pub.$$eval('.trk-pub-actions button', (b) => b.map((x) => x.textContent.trim())), ['Lihat di peta'], 'dl:false → tanpa tombol unduh');
    await pub.evaluate((id) => { closeModal(); document.querySelector(`#trailList [data-trail="${id}"]`).click(); }, trails[2].id); await pub.waitForFunction(() => /belum bisa dimuat/.test(document.querySelector('.trk-pub-draw')?.textContent || '')); assert.ok(!(await $(pub, '[data-trk-dl]')), 'unduh disembunyikan bila lintasan gagal dimuat');
    await pub.evaluate((id) => { closeModal(); document.querySelector(`#trailList [data-trail="${id}"]`).click(); }, trails[3].id); await pub.waitForSelector('.detail-meta'); assert.ok(!(await $(pub, '.trk-pub')), 'jejak tanpa lintasan: tidak ada bagian lintasan');
    assert.deepStrictEqual(errs, [], errs.join(' | ')); await pub.close();
  });
  await t('situs publik: tanpa Leaflet (CDN gagal) detail jejak tetap berfungsi — grafik tampil, tombol “Lihat di peta” disembunyikan', async () => {
    const trails = JSON.parse(fs.readFileSync(path.join(root, 'data', 'trails.json'), 'utf8')); const pts = Gpx.simplify(walk(600), 800); trails[0].track = Gpx.summary(pts, true);
    const pub = await newPage(420, 900); pub.overrides = { '/data/trails.json': { status: 200, contentType: 'application/json', body: JSON.stringify(trails) }, [`/data/tracks/${trails[0].id}.json`]: { status: 200, contentType: 'application/json', body: Gpx.serialize(pts) } };
    const errs = []; pub.on('pageerror', (e) => errs.push(e.message)); await pub.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; });
    await pub.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await pub.waitForSelector('#trailList .trail-card'); await pub.evaluate((id) => document.querySelector(`#trailList [data-trail="${id}"]`).click(), trails[0].id); await pub.waitForSelector('.trk-pub-route');
    assert.deepStrictEqual(await pub.$$eval('.trk-pub-actions button', (b) => b.map((x) => x.textContent.trim())), ['Unduh GPX']); assert.deepStrictEqual(errs, [], errs.join(' | ')); await pub.close();
  });

  await browser.close(); server.close();
  return true;
}
module.exports = { run };
