'use strict';
/* Uji end-to-end di browser nyata (Puppeteer). GitHub API diganti emulator lewat intersepsi permintaan. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { FakeGithub } = require('./fake-github');

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
const Lg = require('../assets/js/logistics.js'); const V_ok = (f) => require('../admin/js/schema.js').validators.logistics(f); const Geo_pack = require('../assets/js/geo.js').pack, Geo_dist = require('../assets/js/geo.js').dist; const window_routeCalls = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(t) {
  const files = Object.fromEntries(['site', 'trails', 'reviews', 'blog', 'profile'].map((n) => [`data/${n}.json`, fs.readFileSync(path.join(root, 'data', n + '.json'), 'utf8')]));
  const fake = new FakeGithub(files);
  const server = require('../dev-server.js');
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const exe = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => p && fs.existsSync(p));
  const browser = await puppeteer.launch({ headless: true, executablePath: exe, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const errors = []; const OV = new Map(); // path -> isi JSON pengganti (untuk menguji situs publik)
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
      if (u.startsWith(base)) { const o = OV.get(new URL(u).pathname); if (o === 404) return rq.respond({ status: 404, body: 'tidak ada' }); if (o) return rq.respond({ status: 200, headers: { 'content-type': 'application/json' }, body: o }); return rq.continue(); }
      if (u.startsWith('https://routing.openstreetmap.de/')) { // layanan rute palsu: jalur melengkung ringan antara dua titik
        if (rq.method() === 'OPTIONS') return rq.respond({ status: 204, headers: CORS });
        const [lo1, la1, lo2, la2] = u.match(/foot\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/).slice(1).map(Number), mid = [(lo1 + lo2) / 2 + 0.00015, (la1 + la2) / 2];
        const dd = Geo_dist([la1, lo1], [mid[1], mid[0]]) + Geo_dist([mid[1], mid[0]], [la2, lo2]); window_routeCalls.push(u);
        return rq.respond({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ code: 'Ok', routes: [{ distance: process.env.ROUTE_TOO_LONG ? dd * 5 : dd, geometry: { coordinates: [[lo1, la1], mid, [lo2, la2]] } }] }) });
      }
      if (u.startsWith('data:') || u.startsWith('blob:')) return rq.continue();
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

  await browser.defaultBrowserContext().overridePermissions(base, ['geolocation']);
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

  await t('pengaturan: menu terkelompok (Tampilan, Situs, Akses, Penerbitan, Akun) dan tautan ke halaman terkait', async () => {
    await nav(page, '#/settings'); await page.waitForSelector('.menu-group');
    const groups = await page.$$eval('.menu-group h2', (h) => h.map((x) => x.textContent.trim())); assert.deepStrictEqual(groups, ['Tampilan', 'Situs', 'Akses', 'Penerbitan', 'Akun']);
    const links = await page.$$eval('.menu-row[href^="#/"]', (a) => a.map((x) => x.getAttribute('href'))); assert.deepStrictEqual(links, ['#/logistics', '#/site', '#/profile', '#/users']);
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
  await t('pengguna: menu Tambah (orb) menawarkan Jejak/Rekam/Impor GPX/Ulasan/Artikel/Gambar/Pengguna dan membuka formulir', async () => {
    await page.click('.nav-add'); await page.waitForSelector('.drawer'); const items = await page.$$eval('.drawer .menu-row b', (b) => b.map((x) => x.textContent)); assert.deepStrictEqual(items, ['Jejak', 'Rekam jejak', 'Impor GPX', 'Ulasan', 'Artikel', 'Gambar', 'Pengguna']);
    await page.evaluate(() => [...document.querySelectorAll('.drawer .menu-row')].find((b) => /Ulasan/.test(b.textContent)).click()); await page.waitForFunction(() => /Tambah ulasan/.test(document.querySelector('.drawer-head h2')?.textContent || ''));
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.drawer'));
  });

  /* ---------- Rute GPS: impor, edit, ekspor, rekam, pulihkan, hapus ---------- */
  const mkGpx = (n, name) => `<?xml version="1.0"?><gpx version="1.1" creator="uji" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>${Array.from({ length: n }, (_, i) => `<trkpt lat="${(-7.19 + i * 0.0004).toFixed(5)}" lon="109.9244"><ele>${2000 + i * 5}</ele><time>${new Date(Date.UTC(2026, 4, 1, 6, 0, 30 * i)).toISOString().replace('.000', '')}</time></trkpt>`).join('')}</trkseg></trk></gpx>`;
  const hookBlobs = (p) => p.evaluate(() => { window.__blobs = []; if (!window.__hooked) { window.__hooked = true; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__blobs.push(b); return o(b); }; } });
  const lastBlobText = (p) => p.evaluate(() => window.__blobs[window.__blobs.length - 1].text());
  const pickGpx = async (p, trigger, content) => { const tmp = path.join(os.tmpdir(), 'uji-rute.gpx'); fs.writeFileSync(tmp, content); const [fc] = await Promise.all([p.waitForFileChooser(), trigger()]); await fc.accept([tmp]); };
  const gtrack = (id) => JSON.parse(fake.text(`data/tracks/${id}.json`));
  const menuRowClick = (p, re, scope = '.drawer') => p.evaluate((src, sc) => { const b = [...document.querySelector(sc).querySelectorAll('.menu-row')].find((x) => new RegExp(src).test(x.textContent)); b.click(); return !!b; }, re.source, scope);
  const fillTrailBasics = async (p) => { await fill(p, 'Lokasi', 'Wonosobo, Jawa Tengah'); await fill(p, 'Foto', 'https://example.com/r.jpg'); await fill(p, 'Deskripsi', 'Rute GPS uji untuk memastikan penyimpanan berjalan.'); };
  let gpsId = null;
  const noStray = async (p, scope, what) => { const m = await p.evaluate((sc) => (document.querySelector(sc)?.innerText || '').match(/\b(null|undefined|NaN|\[object)\b/g), scope); assert.ok(!m, `teks nyasar “${m}” di ${what}`); };

  await t('GPS: impor GPX dari halaman Jejak → formulir terisi otomatis (nama, jarak, ketinggian, waktu, koordinat)', async () => {
    await nav(page, '#/trails'); await page.waitForSelector('.cards .item');
    await pickGpx(page, () => clickBtn(page, 'Impor GPX'), mkGpx(40, 'Rute Uji Impor')); await page.waitForSelector('.drawer .trk-box .trk-stats');
    await page.waitForFunction(() => /40 titik/.test(document.querySelector('.trk-stats').textContent));
    const v = async (l) => (await fieldInput(page, l)).evaluate((e) => e.value);
    assert.strictEqual(await v('Nama jejak'), 'Rute Uji Impor'); assert.match(await v('Jarak'), /^1,\d km$/); assert.strictEqual(await v('Ketinggian'), '2.195 mdpl'); assert.match(await v('Waktu tempuh'), /^19 mnt$|^20 mnt$/); assert.strictEqual(await v('Latitude'), '-7.19000'); assert.strictEqual(await v('Longitude'), '109.92440');
    assert.ok(await page.$('.drawer .trk-prev'), 'pratinjau bentuk rute');
  });
  await t('GPS: simpan jejak ber-rute → SATU commit berisi trails.json + data/tracks/<id>.json', async () => {
    await fillTrailBasics(page); const before = fake.log.length; await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Jejak ditambahkan/);
    assert.strictEqual(fake.log.length, before + 1); const tr = ghData('trails'), n = tr[tr.length - 1]; gpsId = n.id;
    assert.strictEqual(n.track, `data/tracks/${n.id}.json`); const tk = gtrack(n.id); assert.strictEqual(tk.v, 1); assert.strictEqual(tk.segs[0].length, 40); assert.strictEqual(tk.segs[0][0][2], 2000);
    await page.waitForFunction(() => [...document.querySelectorAll('.cards .item')].some((r) => /Rute Uji Impor/.test(r.textContent) && /GPS/.test(r.textContent)), { timeout: 5000 });
  });
  await t('GPS: GPX bukan GPX / tanpa jalur ditolak dengan pesan jelas, tidak membuka formulir', async () => {
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove()));
    await pickGpx(page, () => clickBtn(page, 'Impor GPX'), '<html>bukan gpx</html>'); await waitToast(page, /bukan GPX/); assert.ok(!(await $(page, '.drawer')));
  });
  await t('GPS: ubah jejak → rute dimuat; Edit rute: pangkas A–B, urungkan, hapus titik; ekspor GPX', async () => {
    await page.evaluate(() => { [...document.querySelectorAll('.cards .item')].find((r) => /Rute Uji Impor/.test(r.textContent)).querySelector('.item-main').click(); });
    await page.waitForSelector('.drawer'); await page.waitForFunction(() => /40 titik/.test(document.querySelector('.drawer .trk-stats')?.textContent || ''));
    await clickBtn(page, 'Edit rute', '.drawer'); await page.waitForSelector('.ov-wrap canvas'); await page.waitForFunction(() => /40 titik/.test(document.querySelector('.ed-info').textContent));
    await noStray(page, '.ov-wrap', 'toolbar penyunting rute (tanpa titik terpilih)');
    await setVal(page, '.ov-wrap input[aria-label^="Titik akhir"]', '29'); await setVal(page, '.ov-wrap input[aria-label^="Titik awal"]', '5');
    await clickBtn(page, 'Pangkas ke A–B', '.ov-wrap'); await page.waitForFunction(() => /25 titik/.test(document.querySelector('.ed-info').textContent));
    await clickBtn(page, 'Urungkan', '.ov-wrap'); await page.waitForFunction(() => /40 titik/.test(document.querySelector('.ed-info').textContent));
    await clickBtn(page, 'Ulangi', '.ov-wrap'); await page.waitForFunction(() => /25 titik/.test(document.querySelector('.ed-info').textContent));
    await clickBtn(page, 'Selesai', '.ov-wrap'); await page.waitForFunction(() => !document.querySelector('.ov-wrap'));
    assert.match(await text(page, '.drawer .trk-stats'), /25 titik/); assert.match(await text(page, '.drawer .trk-new'), /menggantikan rute lama/);
    await hookBlobs(page); await clickBtn(page, 'Ekspor GPX', '.drawer'); await waitToast(page, /GPX diunduh/);
    const gx = await lastBlobText(page); assert.match(gx, /<gpx[^>]*version="1.1"/); assert.strictEqual((gx.match(/<trkpt /g) || []).length, 25);
    await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Jejak diperbarui/); assert.strictEqual(gtrack(gpsId).segs[0].length, 25); assert.strictEqual(gtrack(gpsId).segs[0][0][2], 2025);
  });
  await t('GPS: editor titik — geser, tambah, hapus titik lewat peta; selesai menolak bila < 2 titik', async () => {
    await page.evaluate(() => { [...document.querySelectorAll('.cards .item')].find((r) => /Rute Uji Impor/.test(r.textContent)).querySelector('.item-main').click(); });
    await page.waitForFunction(() => /25 titik/.test(document.querySelector('.drawer .trk-stats')?.textContent || '')); await clickBtn(page, 'Edit rute', '.drawer'); await page.waitForSelector('.ov-wrap canvas');
    const box = await page.$eval('.ed-map canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    /* ketuk di sekitar titik pertama (A): posisi layar dihitung dari peta yang sudah di-fit */
    const pos = await page.evaluate(() => { const m = [...document.querySelectorAll('.ed-map')][0]; return null; });
    await page.evaluate(() => { window.__tm = null; });
    await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2); await sleep(120);
    await clickBtn(page, 'Tambah titik', '.ov-wrap'); await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2); await sleep(150);
    const n1 = await text(page, '.ed-info'); assert.ok(/(25|26) titik/.test(n1), n1);
    await clickBtn(page, 'Batal', '.ov-wrap'); await page.waitForSelector('.dlg').catch(() => {}); if (await $(page, '.dlg')) await dlgBtn(page, 'Buang'); await page.waitForFunction(() => !document.querySelector('.ov-wrap'));
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.drawer') || !!document.querySelector('.dlg')); if (await $(page, '.dlg')) await dlgBtn(page, 'Buang'); await page.waitForFunction(() => !document.querySelector('.drawer'));
  });

  await t('GPS: perekam — filter akurasi/lonjakan, jeda→segmen baru, mode latar belakang, selesai → jejak baru (satu commit)', async () => {
    await nav(page, '#/dashboard'); await page.click('.nav-add'); await page.waitForSelector('.drawer'); await menuRowClick(page, /Rekam jejak/);
    await page.waitForSelector('.ov-wrap .rec-chip'); assert.match(await text(page, '.rec-chip'), /Mencari|Siap/);
    const base0 = Date.now(), pt = (i, extra = {}) => ({ latitude: -7.2 + i * 0.0001, longitude: 109.9, altitude: 1500 + i * 2, accuracy: 6, timestamp: base0 + i * 1000, ...extra });
    await clickBtn(page, 'Mulai merekam', '.ov-wrap'); await page.waitForFunction(() => Tracker.getState().status === 'recording'); await page.waitForFunction(() => document.querySelector('.rec-bar') && [...document.querySelectorAll('.rec-bar button')].some((b) => b.textContent.trim() === 'Jeda'));
    const feed = (arr) => page.evaluate((a) => a.map((p) => Tracker._ingest(p)), arr);
    const r1 = await feed([...Array.from({ length: 12 }, (_, i) => pt(i)), pt(12, { accuracy: 200 }), pt(13, { latitude: -6.5 })]); assert.deepStrictEqual(r1.slice(12), [false, false], 'akurasi buruk & lonjakan 80 km/dtk ditolak');
    assert.strictEqual(r1.filter(Boolean).length, 12);
    const r2 = await feed([pt(13)]); assert.deepStrictEqual(r2, [true], 'titik normal setelahnya diterima');
    let st1 = await page.evaluate(() => Tracker.getState()); assert.strictEqual(st1.pts, 13); assert.ok(st1.dist > 130 && st1.dist < 150, 'jarak ' + st1.dist); assert.ok(st1.gain >= 0);
    await page.waitForFunction(() => /0,1\d km/.test(document.querySelector('.rec-grid').textContent));
    await page.evaluate(() => { document.querySelector('.rec-details').open = true; }); await page.click('label[for="sw-bg"]'); const pr = await page.evaluate(() => Tracker.getState().prefs); assert.strictEqual(pr.bg, true, 'preferensi latar belakang tersimpan'); assert.ok(await page.evaluate(() => localStorage.getItem('sadalan_rec_prefs').includes('"bg":true')));
    await clickBtn(page, 'Jeda', '.ov-wrap'); await page.waitForFunction(() => Tracker.getState().status === 'paused'); assert.deepStrictEqual(await feed([pt(20)]), [false], 'saat dijeda tidak merekam');
    await clickBtn(page, 'Lanjut', '.ov-wrap'); await page.waitForFunction(() => Tracker.getState().status === 'recording'); await feed([pt(30), pt(31), pt(32)]);
    st1 = await page.evaluate(() => Tracker.getState()); assert.strictEqual(st1.segs.length, 2, 'jeda membuat segmen baru');
    await page.evaluate(() => document.querySelector('.ov-wrap .btn.ghost.sm').click()); await page.waitForFunction(() => !document.querySelector('.ov-wrap')); await page.waitForSelector('.rec-pill:not([hidden])'); assert.match(await text(page, '.rec-pill'), /●/);
    await page.click('.rec-pill'); await page.waitForSelector('.ov-wrap'); await clickBtn(page, 'Selesai', '.ov-wrap'); await page.waitForSelector('.dlg'); assert.ok(await dlgBtn(page, 'Selesai'));
    await page.waitForFunction(() => /Rekaman selesai/.test(document.querySelector('.drawer-head h2')?.textContent || '')); assert.match(await text(page, '.fin .trk-stats'), /16 titik/);
    assert.strictEqual(await page.evaluate(() => Tracker.getState().status), 'idle'); assert.strictEqual((await page.evaluate(() => Tracker.drafts())).length, 1, 'draf tersimpan di perangkat');
    await menuRowClick(page, /Jadikan jejak baru/); await page.waitForFunction(() => /Tambah jejak/.test(document.querySelector('.drawer-head h2')?.textContent || ''));
    assert.match(await (await fieldInput(page, 'Jarak')).evaluate((e) => e.value), /^0,\d+ km$/); await fill(page, 'Nama jejak', 'Rekaman Uji Lapangan'); await fillTrailBasics(page);
    const before = fake.log.length; await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Jejak ditambahkan/); assert.strictEqual(fake.log.length, before + 1);
    const tr = ghData('trails'), n = tr[tr.length - 1]; assert.strictEqual(n.name, 'Rekaman Uji Lapangan'); const tk = gtrack(n.id); assert.strictEqual(tk.segs.length, 2); assert.strictEqual(tk.segs[0].length + tk.segs[1].length, 16);
    await sleep(200); assert.strictEqual((await page.evaluate(() => Tracker.drafts())).length, 0, 'draf dihapus setelah diterbitkan'); assert.strictEqual(await page.evaluate(() => Tracker.getState().bgActive), false);
  });
  await t('GPS: GPS sungguhan (emulasi geolokasi peramban) terhubung ke perekam & menampilkan posisi', async () => {
    await page.evaluate(() => GpsUI.openRecorder()); await page.waitForSelector('.ov-wrap .rec-chip');
    await page.setGeolocation({ latitude: -7.3, longitude: 110.1, accuracy: 8 }); await clickBtn(page, 'Mulai merekam', '.ov-wrap');
    for (let i = 0; i < 12; i++) { // emulasi geolokasi headless kadang terlambat mengirim fix pertama: kirim ulang sampai diterima
      if (await page.evaluate(() => { const f = Tracker.getState().lastFix; return !!f && Math.abs(f.lat + 7.3) < 1e-6; })) break;
      await page.setGeolocation({ latitude: -7.3, longitude: 110.1, accuracy: 8 }); await sleep(700);
    }
    await page.waitForFunction(() => Tracker.getState().lastFix && Math.abs(Tracker.getState().lastFix.lat + 7.3) < 1e-6, { timeout: 4000 });
    assert.match(await text(page, '.rec-chip'), /GPS baik ±8 m/); assert.strictEqual(await page.evaluate(() => Tracker.getState().pts), 1);
  });
  await t('GPS: tab ditutup saat merekam → saat masuk lagi rekaman dapat dipulihkan (titik tidak hilang)', async () => {
    await page.evaluate(() => { const b = Date.now(); [0, 1, 2, 3].forEach((i) => Tracker._ingest({ latitude: -7.3 + i * 0.0002, longitude: 110.1, altitude: null, accuracy: 5, timestamp: b + 2000 + i * 1000 })); Tracker.pause(); }); await sleep(400);
    await page.reload(); await page.waitForSelector('.stats'); await page.waitForFunction(() => /Rekaman belum selesai/.test(document.querySelector('.drawer-head h2')?.textContent || ''), { timeout: 8000 });
    assert.match(await text(page, '.drawer-body'), /4 titik/); await clickBtn(page, 'Buka perekam', '.drawer'); await page.waitForSelector('.ov-wrap .rec-chip');
    assert.match(await text(page, '.rec-chip'), /Dijeda/); assert.strictEqual(await page.evaluate(() => Tracker.getState().pts), 4);
    await page.evaluate(() => { Tracker.discard(); }); await page.evaluate(() => document.querySelector('.ov-wrap .btn.ghost.sm').click()); await page.waitForFunction(() => !document.querySelector('.ov-wrap'));
    await sleep(200); await page.reload(); await page.waitForSelector('.stats'); await sleep(600); assert.ok(!(await $(page, '.drawer')), 'rekaman yang dibuang tidak ditawarkan lagi');
  });
  await t('GPS: jeda data (titik datang jarang) TIDAK disambung garis lurus — segmen baru + dicatat sebagai jeda', async () => {
    await page.evaluate(() => GpsUI.openRecorder()); await page.waitForSelector('.ov-wrap .rec-chip'); await clickBtn(page, 'Mulai merekam', '.ov-wrap'); await page.waitForFunction(() => Tracker.getState().status === 'recording');
    const b0 = Date.now(), res = await page.evaluate((b) => [0, 1, 2, 3, 4, 5].map((i) => Tracker._ingest({ latitude: -7.4 + i * 0.0001, longitude: 110, altitude: 100, accuracy: 5, timestamp: b + i * 2000 }))
      .concat([Tracker._ingest({ latitude: -7.4 + 0.0005 + 0.0014, longitude: 110.0004, altitude: 104, accuracy: 5, timestamp: b + 10000 + 70000 })], [Tracker._ingest({ latitude: -7.4 + 0.0005 + 0.0015, longitude: 110.0004, altitude: 105, accuracy: 5, timestamp: b + 10000 + 72000 })]), b0);
    assert.ok(res.every(Boolean), res.join()); const st = await page.evaluate(() => Tracker.getState());
    assert.strictEqual(st.segs.length, 2, 'celah 70 dtk / ±150 m → segmen baru'); assert.strictEqual(st.gaps, 1); assert.ok(st.gapDist > 120 && st.gapDist < 180, 'gapDist ' + st.gapDist); assert.ok(st.dist < 80, 'jarak celah tidak ikut dihitung: ' + st.dist);
    await page.waitForFunction(() => /1 jeda data/.test(document.querySelector('.rec-msg')?.textContent || '')); await page.evaluate(() => { document.querySelector('.ov-wrap .btn.ghost.sm').click(); }); await page.waitForFunction(() => !document.querySelector('.ov-wrap'));
  });
  await t('GPS: Edit rute → Isi jeda (ikuti jalan) mengisi celah lewat layanan rute; rute tak wajar dilewati; urungkan', async () => {
    window_routeCalls.length = 0;
    await page.evaluate(() => { Tracker.pause(); const rec = Tracker.stop(); window.__rec = rec; }); const rec = await page.evaluate(() => window.__rec); assert.strictEqual(rec.segs.length, 2); assert.strictEqual(rec.gaps, 1);
    await page.evaluate((r) => GpsUI.finishFlow(r), rec); await page.waitForSelector('.fin .rec-note.warn'); await noStray(page, '.fin', 'ringkasan rekaman selesai'); assert.match(await text(page, '.fin .rec-note'), /1 celah data/);
    await menuRowClick(page, /Edit \/ pangkas rute/); await page.waitForSelector('.ov-wrap .ed-tools'); assert.match(await text(page, '.ed-info'), /2 segmen \(1 celah/);
    await clickBtn(page, 'Isi jeda (ikuti jalan)', '.ov-wrap'); await waitToast(page, /1 jeda diisi mengikuti jalan/); assert.strictEqual(window_routeCalls.length, 1); assert.match(window_routeCalls[0], /routed-foot\/route\/v1\/foot\//);
    await page.waitForFunction(() => /\b9 titik\b|\b8 titik\b|\b7 titik\b/.test(document.querySelector('.ed-info').textContent) && !/segmen/.test(document.querySelector('.ed-info').textContent), { timeout: 5000 });
    await clickBtn(page, 'Urungkan', '.ov-wrap'); await page.waitForFunction(() => /2 segmen/.test(document.querySelector('.ed-info').textContent));
    await clickBtn(page, 'Batal', '.ov-wrap'); await sleep(200); if (await $(page, '.dlg')) await dlgBtn(page, 'Buang'); await page.waitForFunction(() => !document.querySelector('.ov-wrap'));
    await page.evaluate(() => { document.querySelectorAll('.drawer-wrap, .toast').forEach((x) => x.remove()); document.body.classList.remove('noscroll'); });
    /* rute jauh lebih panjang dari garis lurus → dilewati, tidak mengubah rute */
    process.env.ROUTE_TOO_LONG = '1'; await page.evaluate((r) => GpsUI.finishFlow(r), rec); await menuRowClick(page, /Edit \/ pangkas rute/); await page.waitForSelector('.ov-wrap .ed-tools');
    await clickBtn(page, 'Isi jeda (ikuti jalan)', '.ov-wrap'); await waitToast(page, /Tidak ada jeda yang terisi/); assert.match(await text(page, '.ed-info'), /2 segmen/); delete process.env.ROUTE_TOO_LONG;
    await clickBtn(page, 'Batal', '.ov-wrap'); await sleep(200); if (await $(page, '.dlg')) await dlgBtn(page, 'Buang'); await page.waitForFunction(() => !document.querySelector('.ov-wrap'));
    await page.evaluate(async (id) => { await Tracker.deleteDraft(id); document.querySelectorAll('.drawer-wrap').forEach((x) => x.remove()); document.body.classList.remove('noscroll'); }, rec.id);
  });
  await t('GPS: di aplikasi Android (Capacitor) perekam memakai pelacak native latar depan, bukan geolocation peramban', async () => {
    await page.evaluate(() => {
      window.__bg = { opts: null, cb: null, removed: [] };
      window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({ addWatcher: (o, cb) => { window.__bg.opts = o; window.__bg.cb = cb; return Promise.resolve('w1'); }, removeWatcher: ({ id }) => { window.__bg.removed.push(id); return Promise.resolve(); } }) };
    });
    await page.evaluate(() => GpsUI.openRecorder()); await page.waitForSelector('.ov-wrap .rec-chip'); await clickBtn(page, 'Mulai merekam', '.ov-wrap'); await page.waitForFunction(() => window.__bg.cb);
    const o = await page.evaluate(() => window.__bg.opts); assert.strictEqual(o.requestPermissions, true); assert.strictEqual(o.stale, false); assert.ok(o.backgroundTitle && o.backgroundMessage);
    const t0 = Date.now(); await page.evaluate((t) => { [0, 1, 2, 3].forEach((i) => window.__bg.cb({ latitude: -7.5 + i * 0.0002, longitude: 110, accuracy: 6, altitude: 50 + i, time: t + i * 3000 })); window.__bg.cb(null, { code: 'NOT_AUTHORIZED' }); }, t0);
    await page.waitForFunction(() => Tracker.getState().status === 'paused'); const st = await page.evaluate(() => Tracker.getState());
    assert.strictEqual(st.native, true); assert.strictEqual(st.pts, 4); assert.match(st.error, /Izin lokasi ditolak/); assert.deepStrictEqual(await page.evaluate(() => window.__bg.removed), ['w1'], 'pelacak native dihentikan saat dijeda');
    await page.evaluate(() => { Tracker.discard(); delete window.Capacitor; document.querySelector('.ov-wrap .btn.ghost.sm')?.click(); }); await page.waitForFunction(() => !document.querySelector('.ov-wrap'));
  });

  await t('GPS: hapus jejak ber-rute → berkas rute ikut terhapus dalam satu commit', async () => {
    await nav(page, '#/trails'); await page.waitForSelector('.cards .item'); const before = fake.log.length; assert.ok(fake.files.has(`data/tracks/${gpsId}.json`));
    await page.evaluate(() => { [...document.querySelectorAll('.cards .item')].find((r) => /Rute Uji Impor/.test(r.textContent)).querySelector('.icon-btn.danger').click(); });
    await page.waitForSelector('.dlg'); assert.match(await text(page, '.dlg p'), /Rute GPS-nya ikut dihapus/); await clickBtn(page, 'Hapus', '.dlg'); await waitToast(page, /Jejak dihapus/);
    assert.strictEqual(fake.log.length, before + 1); assert.ok(!fake.files.has(`data/tracks/${gpsId}.json`)); assert.ok(!ghData('trails').some((x) => x.id === gpsId));
  });
  await t('GPS: unduh GPX dari kartu jejak & tombol Rekam/Impor GPX tersedia di halaman Jejak', async () => {
    const heads = await page.$$eval('.page-actions .btn', (b) => b.map((x) => x.textContent.trim())); assert.ok(['Tambah jejak', 'Rekam', 'Impor GPX'].every((x) => heads.includes(x)), heads.join());
    await hookBlobs(page); await page.evaluate(() => { [...document.querySelectorAll('.cards .item')].find((r) => /Rekaman Uji Lapangan/.test(r.textContent)).querySelector('.icon-btn[title="Unduh GPX"]').click(); });
    await page.waitForFunction(() => window.__blobs.length > 0, { timeout: 6000 }); assert.strictEqual(((await lastBlobText(page)).match(/<trkseg>/g) || []).length, 2);
  });

  /* ---------- Mode Gelap & Terang ---------- */
  const bodyBg = async (p, want) => { if (want) await p.waitForFunction((c) => getComputedStyle(document.body).backgroundColor === c, { timeout: 3000 }, want).catch(() => {}); return p.evaluate(() => getComputedStyle(document.body).backgroundColor); }; // menunggu transisi warna 0,2 dtk selesai
  const themeState = (p) => p.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), m: document.documentElement.getAttribute('data-theme-mode'), s: localStorage.getItem('sadalan_theme') }));
  await t('tema (situs publik): otomatis mengikuti perangkat, tombol bergilir Otomatis → Terang → Gelap, tersimpan & tanpa kilatan saat dimuat ulang', async () => {
    const pub = await newPage(420, 900); await pub.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; }); const errs = []; pub.on('pageerror', (e) => errs.push(e.message));
    await pub.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await pub.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    assert.deepStrictEqual(await themeState(pub), { t: 'dark', m: 'auto', s: null }, 'perangkat gelap + pilihan otomatis → gelap sejak DOMContentLoaded');
    await pub.waitForSelector('.topbar .theme-btn'); assert.strictEqual(await bodyBg(pub, 'rgb(15, 26, 22)'), 'rgb(15, 26, 22)');
    assert.match(await pub.$eval('.theme-btn', (b) => b.getAttribute('aria-label')), /Tema: Otomatis.*Terang/);
    await pub.click('.theme-btn'); assert.deepStrictEqual(await themeState(pub), { t: 'light', m: 'light', s: 'light' }); assert.strictEqual(await bodyBg(pub, 'rgb(247, 245, 239)'), 'rgb(247, 245, 239)');
    await pub.click('.theme-btn'); assert.deepStrictEqual(await themeState(pub), { t: 'dark', m: 'dark', s: 'dark' });
    await pub.reload({ waitUntil: 'domcontentloaded' }); assert.strictEqual((await themeState(pub)).t, 'dark', 'pilihan Gelap bertahan setelah muat ulang');
    await pub.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]); await sleep(100); assert.strictEqual((await themeState(pub)).t, 'dark', 'pilihan eksplisit tidak ikut berubah saat tema perangkat berubah');
    await pub.click('.theme-btn'); assert.deepStrictEqual(await themeState(pub), { t: 'light', m: 'auto', s: null }, 'kembali ke Otomatis menghapus pilihan & mengikuti perangkat (terang)');
    await pub.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await sleep(100); assert.strictEqual((await themeState(pub)).t, 'dark', 'mode Otomatis berubah langsung saat perangkat berganti tema');
    assert.strictEqual(await pub.$eval('meta[name="theme-color"]', (m) => m.content), '#0f1a16');
    await pub.evaluate(() => Theme.set('dark')); await pub.evaluate(() => openTrail(1)); await sleep(300); assert.ok(await $(pub, '.modal-sheet'), 'modal tampil di mode gelap'); assert.notStrictEqual(await pub.$eval('.modal-sheet', (e) => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)');
    assert.deepStrictEqual(errs, [], errs.join(' | ')); await pub.close();
  });
  await t('tema (admin): tombol bilah atas + pilihan di Pengaturan, bersama dengan situs publik, peta canvas mengikuti tema', async () => {
    await page.evaluate(() => Theme.set('light')); await nav(page, '#/settings'); await page.waitForSelector('.theme-seg');
    assert.deepStrictEqual(await page.$$eval('.theme-seg button', (b) => b.map((x) => [x.textContent.trim(), x.getAttribute('aria-pressed')])), [['Otomatis', 'false'], ['Terang', 'true'], ['Gelap', 'false']]);
    await page.evaluate(() => [...document.querySelectorAll('.theme-seg button')].find((b) => b.textContent.trim() === 'Gelap').click());
    assert.deepStrictEqual(await themeState(page), { t: 'dark', m: 'dark', s: 'dark' }); assert.strictEqual(await bodyBg(page, 'rgb(15, 26, 22)'), 'rgb(15, 26, 22)');
    assert.strictEqual(await page.$eval('.theme-seg button[aria-pressed=true]', (b) => b.textContent.trim()), 'Gelap', 'pilihan di Pengaturan ikut menyala');
    await page.click('.topbar .theme-btn'); assert.strictEqual((await themeState(page)).m, 'auto', 'tombol bilah atas melanjutkan siklus dan menyinkronkan Pengaturan');
    await page.waitForFunction(() => document.querySelector('.theme-seg button[aria-pressed=true]').textContent.trim() === 'Otomatis');
    await page.evaluate(() => Theme.set('dark')); await page.evaluate(() => GpsUI.openRecorder()); await page.waitForSelector('.ov-wrap canvas'); await sleep(300);
    const px = await page.evaluate(() => { const c = document.querySelector('.rec-map canvas'), x = c.getContext('2d'); const d = x.getImageData(5, 5, 1, 1).data; return [d[0], d[1], d[2]]; });
    assert.ok(px[0] < 60 && px[1] < 70 && px[2] < 70, 'latar peta gelap: ' + px); await page.evaluate(() => document.querySelector('.ov-wrap .btn.ghost.sm').click());
    await page.waitForFunction(() => !document.querySelector('.ov-wrap')); await page.evaluate(() => Theme.set('light')); assert.strictEqual(await bodyBg(page, 'rgb(247, 245, 239)'), 'rgb(247, 245, 239)', 'kembali ke tampilan asli (terang)');
  });

  /* ---------- Kalkulator Logistik: CMS & CRUD ---------- */
  const lgFile = () => JSON.parse(fake.text('data/logistics.json'));
  const lgRow = (p, name) => p.evaluate((n) => { const r = [...document.querySelectorAll('.cards .item')].find((x) => x.querySelector('.item-title')?.textContent.trim() === n); return r ? { sub: r.querySelector('.item-sub')?.textContent, tags: r.querySelector('.item-tags')?.textContent } : null; }, name);
  const lgOpen = (p, name) => p.evaluate((n) => { [...document.querySelectorAll('.cards .item')].find((x) => x.querySelector('.item-title')?.textContent.trim() === n).querySelector('.item-main').click(); }, name);
  await t('CMS logistik: halaman Konten → Logistik tampil (tab, ringkasan, kondisi cuaca, 16 perlengkapan) walau logistics.json belum ada di repositori', async () => {
    assert.strictEqual(fake.text('data/logistics.json'), null, 'awalnya berkas belum ada'); await nav(page, '#/logistics'); await page.waitForSelector('.cards .item');
    assert.strictEqual(await page.$eval('.subnav a[aria-current=page]', (a) => a.textContent.trim()), 'Logistik'); assert.deepStrictEqual(await page.$$eval('.subnav a', (a) => a.map((x) => x.textContent.trim())), ['Jejak', 'Ulasan', 'Artikel', 'Logistik', 'Media']);
    assert.match(await text(page, '.panel .hint'), /Tombol “Kalkulator Logistik” tampil di samping “Lihat Peta”.*3 L air.*2\.500 kkal/); assert.strictEqual(await page.$$eval('.panel .cards', (c) => c[0].children.length), 3, '3 kondisi cuaca bawaan');
    assert.strictEqual(await page.$$eval('.panel .cards', (c) => c[1].children.length), 16); assert.deepStrictEqual(await lgRow(page, 'Tenda (kapasitas 2 orang)'), { sub: '0,5 unit per orang · 2.500 g', tags: 'Tidur & Tenda' });
    await setVal(page, '.toolbar input', 'sleeping'); await page.waitForFunction(() => document.querySelectorAll('.panel:last-of-type .cards .item').length === 1); await setVal(page, '.toolbar input', '');
    await page.evaluate(() => [...document.querySelectorAll('.filter-btn')].find((b) => b.textContent.trim() === 'Kesehatan').click()); await page.waitForFunction(() => document.querySelectorAll('.panel:last-of-type .cards .item').length === 2); assert.match(await text(page, '.count'), /2 dari 16/);
    await page.evaluate(() => [...document.querySelectorAll('.filter-btn')].find((b) => b.textContent.trim() === 'Semua').click());
  });
  await t('CMS logistik: tambah perlengkapan → satu commit, logistics.json dibuat dengan data bawaan + item baru; validasi menolak isian salah', async () => {
    await clickBtn(page, 'Tambah perlengkapan'); await page.waitForSelector('.drawer'); const before = fake.log.length;
    await fill(page, 'Nama perlengkapan', 'Trekking Pole'); await fill(page, 'Kategori', 'Lainnya'); await fill(page, 'Jumlah', 'abc'); await fill(page, 'Satuan', 'pasang'); await fill(page, 'Berat per satuan (gram)', '480');
    await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await page.waitForFunction(() => document.querySelector('.drawer .field.bad, .drawer [aria-invalid=true], .drawer .err'), { timeout: 4000 }).catch(() => {}); assert.strictEqual(fake.log.length, before, 'isian salah tidak dikomit'); assert.ok(await $(page, '.drawer'), 'drawer tetap terbuka');
    await fill(page, 'Jumlah', '1'); await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Perlengkapan ditambahkan/);
    assert.strictEqual(fake.log.length, before + 1); const f = lgFile(); assert.strictEqual(f.items.length, 17); assert.deepStrictEqual(f.items[16], { id: 'trekking-pole', name: 'Trekking Pole', cat: 'Lainnya', per: 'orang', qty: 1, unit: 'pasang', weightG: 480, on: true }); assert.deepStrictEqual(f.rates, Lg.defaults().rates);
    V_ok(f); assert.deepStrictEqual(await lgRow(page, 'Trekking Pole'), { sub: '1 pasang per orang · 480 g', tags: 'Lainnya' });
  });
  await t('CMS logistik: ubah (jumlah, aturan, nonaktif) dan hapus perlengkapan', async () => {
    await page.waitForSelector('.cards .item'); await lgOpen(page, 'Trekking Pole'); await page.waitForSelector('.drawer'); await fill(page, 'Jumlah', '0,5'); await fill(page, 'Aturan jumlah', 'orang-hari'); await fill(page, 'Status', 'false');
    let before = fake.log.length; await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Perlengkapan diperbarui/); assert.strictEqual(fake.log.length, before + 1);
    let it = lgFile().items.find((x) => x.id === 'trekking-pole'); assert.strictEqual(it.qty, 0.5); assert.strictEqual(it.per, 'orang-hari'); assert.strictEqual(it.on, false); assert.match((await lgRow(page, 'Trekking Pole')).tags, /Nonaktif/);
    await page.evaluate(() => [...document.querySelectorAll('.cards .item')].find((x) => x.querySelector('.item-title')?.textContent.trim() === 'Trekking Pole').querySelector('.icon-btn.danger').click()); await page.waitForSelector('.dlg'); before = fake.log.length; await clickBtn(page, 'Hapus', '.dlg'); await waitToast(page, /Perlengkapan dihapus/);
    assert.strictEqual(fake.log.length, before + 1); assert.ok(!lgFile().items.some((x) => x.id === 'trekking-pole')); assert.strictEqual(lgFile().items.length, 16);
  });
  await t('CMS logistik: kondisi cuaca — tambah, hapus kondisi bawaan memindahkan bawaan, kondisi terakhir tidak bisa dihapus', async () => {
    await page.evaluate(() => [...document.querySelectorAll('.trk-btns .btn')].find((b) => /Tambah kondisi/.test(b.textContent)).click()); await page.waitForSelector('.drawer'); await fill(page, 'Nama kondisi', 'Hujan deras'); await fill(page, 'Pengali kebutuhan air', '1,2'); await fill(page, 'Pengali kebutuhan kalori', '1,1');
    await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Kondisi cuaca ditambahkan/); let f = lgFile(); assert.deepStrictEqual(f.conditions[3], { id: 'hujan-deras', name: 'Hujan deras', water: 1.2, kcal: 1.1 });
    await page.waitForSelector('.cards .item'); await page.evaluate(() => { const r = [...document.querySelectorAll('.panel .cards .item')].find((x) => x.querySelector('.item-title')?.textContent.trim() === 'Sejuk'); r.querySelector('.icon-btn.danger').click(); }); await page.waitForSelector('.dlg'); await clickBtn(page, 'Hapus', '.dlg'); await waitToast(page, /Kondisi cuaca dihapus/);
    f = lgFile(); assert.ok(!f.conditions.some((c) => c.id === 'sejuk')); assert.strictEqual(f.defaults.condition, 'hangat', 'bawaan pindah ke kondisi pertama'); V_ok(f);
    for (const id of ['dingin', 'hujan-deras']) { await page.waitForSelector('.cards .item'); await page.evaluate((n) => { const r = [...document.querySelectorAll('.panel .cards .item')].find((x) => x.querySelector('.item-title')?.textContent.trim() === n); r.querySelector('.icon-btn.danger').click(); }, id === 'dingin' ? 'Dingin / berangin' : 'Hujan deras'); await page.waitForSelector('.dlg'); await clickBtn(page, 'Hapus', '.dlg'); await waitToast(page, /Kondisi cuaca dihapus/); await page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove())); }
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove())); await page.evaluate(() => { document.querySelector('.panel .cards .item .icon-btn.danger').click(); }); await waitToast(page, /Minimal harus ada satu kondisi cuaca/); assert.strictEqual(lgFile().conditions.length, 1);
  });
  await t('CMS logistik: pengaturan — ubah label tombol/angka/sembunyikan; angka di luar rentang ditolak; hasilnya dipakai kalkulator situs', async () => {
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove())); await clickBtn(page, 'Ubah pengaturan'); await page.waitForSelector('.drawer');
    await fill(page, 'Label tombol', 'Hitung Logistik'); await fill(page, 'Air (liter)', '99'); let before = fake.log.length; await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await sleep(500); assert.strictEqual(fake.log.length, before, 'angka di luar rentang tidak dikomit'); assert.ok(await $(page, '.drawer'));
    await fill(page, 'Air (liter)', '3,5'); await fill(page, 'Tombol di halaman utama', 'false'); await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Pengaturan kalkulator diperbarui/); assert.strictEqual(fake.log.length, before + 1);
    const f = lgFile(); assert.strictEqual(f.button, 'Hitung Logistik'); assert.strictEqual(f.rates.waterL, 3.5); assert.strictEqual(f.enabled, false); assert.strictEqual(f.conditions.length, 1); assert.strictEqual(f.items.length, 16); V_ok(f);
    assert.match(await text(page, '.panel .hint'), /Tombol disembunyikan.*3,5 L air/); assert.ok(Math.abs(Lg.calc(f, { people: 1, days: 1, level: 'Menengah', condition: f.conditions[0].id }).waterL - 3.5 * 1.1 * f.conditions[0].water) < 1e-9);
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

  await t('situs publik: jejak ber-rute menampilkan Rute GPS (jarak, naik/turun, profil elevasi) dan Unduh GPX', async () => {
    const tr = JSON.parse(fs.readFileSync(path.join(root, 'data', 'trails.json'), 'utf8')); tr[0].track = 'data/tracks/1.json'; OV.set('/data/trails.json', JSON.stringify(tr));
    const segs = [Array.from({ length: 30 }, (_, i) => [-7.3198 + i * 0.0005, 107.7313, 2000 + i * 8, 1.7e9 + i * 60])]; OV.set('/data/tracks/1.json', Geo_pack(segs));
    const pub = await newPage(420, 900); await pub.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; }); const errs = []; pub.on('pageerror', (e) => errs.push(e.message));
    await pub.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await pub.waitForFunction(() => typeof openTrail === 'function' && document.querySelector('#trailList').children.length > 0, { timeout: 8000 });
    assert.strictEqual(await pub.$$eval('#trailList .gps-tag', (e) => e.length), tr.filter((x) => x.track).length, 'tag GPS hanya pada jejak ber-rute');
    await pub.evaluate(() => openTrail(1)); await pub.waitForSelector('#trkBox .trk-prof', { timeout: 6000 });
    const txt = await text(pub, '#trkBox'); assert.match(txt, /Jarak rute/); assert.match(txt, /1[,.]6 km|1[,.]5 km|1[,.]7 km/); assert.match(txt, /Total naik/); assert.match(txt, /Unduh GPX/);
    await hookBlobs(pub); await pub.click('[data-gpx]'); await pub.waitForFunction(() => window.__blobs.length > 0); const gx = await lastBlobText(pub); assert.strictEqual((gx.match(/<trkpt /g) || []).length, 30); assert.match(gx, /<name>Gunung Papandayan<\/name>/);
    await pub.evaluate(() => openTrail(3)); await sleep(100); assert.ok(!(await $(pub, '#trkBox')), 'jejak tanpa rute tidak menampilkan bagian Rute GPS');
    assert.deepStrictEqual(errs, [], errs.join(' | ')); OV.clear(); await pub.close();
  });

  /* ---------- Kalkulator Logistik: situs publik ---------- */
  const sty = (p, sel, props) => p.$eval(sel, (e, pr) => { const c = getComputedStyle(e); const o = {}; pr.forEach((k) => { o[k] = c[k]; }); return o; }, props);
  const BTN_PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopStyle', 'borderTopLeftRadius', 'paddingTop', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight', 'height', 'display', 'justifyContent', 'columnGap'];
  const lgPage = async (w, h, theme = 'light') => { const p = await newPage(w, h); await p.evaluateOnNewDocument((t) => { window.lucide = { createIcons() {} }; localStorage.setItem('sadalan_theme', t); }, theme); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); await p.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => typeof openTrail === 'function' && document.querySelector('#trailList').children.length > 0, { timeout: 8000 }); await sleep(250); p.errs = errs; return p; };

  await t('kalkulator logistik: tombol berada di samping “Lihat Peta” dan gayanya IDENTIK dengan tombol yang ada (computed style) di terang/gelap, desktop/ponsel', async () => {
    for (const [w, h] of [[1280, 900], [390, 860]]) for (const theme of ['light', 'dark']) {
      const p = await lgPage(w, h, theme);
      const a = await sty(p, '[data-go="peta"]', BTN_PROPS), b = await sty(p, '[data-open-logistics]', BTN_PROPS); assert.deepStrictEqual(b, a, `${w}px ${theme}: gaya tombol kalkulator ≠ tombol Lihat Peta`);
      const geo = await p.evaluate(() => { const peta = document.querySelector('[data-go="peta"]'), lg = document.querySelector('[data-open-logistics]'), pr = peta.getBoundingClientRect(), lr = lg.getBoundingClientRect(); return { next: peta.nextElementSibling === lg, sameRow: Math.abs(pr.top - lr.top) < 2, right: lr.left >= pr.right - 1, fits: lr.right <= innerWidth + 1, cls: lg.className, label: lg.textContent.trim() }; });
      assert.ok(geo.next && geo.sameRow && geo.right && geo.fits, `${w}px ${theme}: posisi tombol ${JSON.stringify(geo)}`); assert.strictEqual(geo.cls, 'ghost-btn'); assert.strictEqual(geo.label, 'Kalkulator Logistik');
      assert.deepStrictEqual(p.errs, []); await p.close();
    }
  });
  await t('kalkulator logistik: kartu, kolom isian, dan lembar modal memakai gaya komponen yang ada (bukan warna statis) dan ikut berganti tema', async () => {
    const p = await lgPage(420, 900, 'light'); const CARD = ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'paddingTop', 'paddingLeft', 'fontSize'];
    const grab = async () => {
      await p.evaluate(() => closeModal && closeModal()); await p.evaluate(() => openTrail(1)); await sleep(150); const trailTile = await sty(p, '.detail-meta div', CARD), sheet1 = await sty(p, '.modal-sheet', ['backgroundColor', 'borderTopLeftRadius', 'paddingTop']);
      await p.evaluate(() => allTrails()); await sleep(150); const listBtn = await sty(p, '.modal-list button', ['borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'paddingTop', 'paddingLeft']);
      await p.click('.modal-close').catch(() => p.evaluate(() => closeModal())); await p.evaluate(() => closeModal()); await p.click('[data-open-logistics]'); await sleep(200);
      const tile = await sty(p, '.lg-modal .detail-meta div', CARD), sheet2 = await sty(p, '.modal-sheet', ['backgroundColor', 'borderTopLeftRadius', 'paddingTop']), row = await sty(p, '.lg-list label', ['borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'paddingTop', 'paddingLeft', 'backgroundColor', 'color']);
      const inp = await sty(p, '#lgPeople', ['borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'paddingLeft', 'paddingTop']), sel = await sty(p, '#lgLevel', ['borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'paddingTop']);
      const h3 = await sty(p, '.lg-modal h3', ['fontSize', 'color', 'fontFamily']), cardRef = await p.evaluate(() => { const d = document.createElement('div'); d.className = 'modal-content'; return null; });
      return { trailTile, sheet1, listBtn, tile, sheet2, row, inp, sel, h3 };
    };
    for (const theme of ['light', 'dark']) {
      await p.evaluate((t) => Theme.set(t), theme); await sleep(350); const g = await grab();
      assert.deepStrictEqual(g.tile, g.trailTile, theme + ': kartu angka = kartu angka detail jejak'); assert.deepStrictEqual(g.sheet2, g.sheet1, theme + ': lembar modal sama');
      for (const k of ['borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'paddingTop', 'paddingLeft']) assert.strictEqual(g.row[k], g.listBtn[k], `${theme}: baris checklist ${k} = tombol daftar modal`);
      for (const k of ['borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'paddingTop']) assert.strictEqual(g.inp[k], g.sel[k], `${theme}: kolom angka ${k} = kolom pilih yang ada`);
      assert.strictEqual(g.row.backgroundColor, g.sheet2.backgroundColor, theme + ': baris checklist memakai warna permukaan tema');
      g['theme'] = theme; (p.snap ||= {})[theme] = g;
    }
    assert.notStrictEqual(p.snap.light.row.backgroundColor, p.snap.dark.row.backgroundColor, 'warna berganti saat tema berganti (tidak statis)'); assert.notStrictEqual(p.snap.light.inp.color, p.snap.dark.inp.color);
    assert.deepStrictEqual(p.errs, []); await p.close();
  });
  await t('kalkulator logistik: hitung otomatis saat input berubah, pilih jejak mengatur kesulitan & hari, salin daftar, tutup mengembalikan fokus', async () => {
    const p = await lgPage(420, 900); await p.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (x) => { window.__copied = x; return Promise.resolve(); } }, configurable: true }); });
    await p.click('[data-open-logistics]'); await p.waitForSelector('#lgOut .detail-meta'); assert.match(await text(p, '.lg-modal h3'), /Kalkulator Logistik Gunung/);
    assert.strictEqual(await p.$eval('#lgPeople', (e) => e.value), '2'); assert.strictEqual(await p.$eval('#lgCond', (e) => e.value), 'sejuk');
    await setVal(p, '#lgPeople', '4'); await setVal(p, '#lgDays', '3'); await p.waitForFunction(() => /39,6 L/.test(document.querySelector('#lgOut').textContent)); assert.match(await text(p, '#lgOut'), /Air · ±9,9 L\/orang/); assert.match(await text(p, '#lgOut'), /Sleeping bag4 buah/);
    await setVal(p, '#lgCond', 'hangat'); await p.waitForFunction(() => /51,5 L/.test(document.querySelector('#lgOut').textContent));
    const rin = await p.evaluate(() => trails.find((x) => /hari/.test(x.time) && x.difficulty === 'Menantang')); assert.ok(rin, 'ada jejak Menantang berdurasi hari di data');
    await setVal(p, '#lgTrail', String(rin.id)); assert.strictEqual(await p.$eval('#lgLevel', (e) => e.value), 'Menantang'); assert.strictEqual(await p.$eval('#lgDays', (e) => e.value), String(await p.evaluate((x) => Logistics.daysFromTime(x), rin.time)));
    assert.strictEqual(await p.$$eval('.lg-list input', (e) => e.length) > 8, true); await p.click('.lg-list input'); assert.ok(await p.$eval('.lg-list input', (e) => e.checked));
    await p.click('[data-lg-copy]'); await p.waitForFunction(() => window.__copied); const copied = await p.evaluate(() => window.__copied); assert.match(copied, new RegExp('Jejak: ' + rin.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); assert.match(copied, /☐ Sleeping bag — 4 buah/); assert.match(await text(p, '[data-lg-copy]'), /Tersalin/);
    await p.keyboard.press('Escape'); await p.waitForFunction(() => document.querySelector('#modalWrap').hidden); assert.ok(await p.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-open-logistics')), 'fokus kembali ke tombol');
    assert.deepStrictEqual(p.errs, []); await p.close();
  });
  await t('kalkulator logistik: isi mengikuti data CMS (label, teks, kondisi, nonaktif) dan aman bila berkas belum ada / berisi HTML', async () => {
    const cfg = JSON.parse(JSON.stringify(Lg.defaults())); cfg.button = 'Hitung Logistik <b>x</b>'; cfg.title = 'Hitung <img src=x onerror=window.__pwn=1>'; cfg.conditions = [{ id: 'hujan', name: 'Hujan deras', water: 1.2, kcal: 1.1 }]; cfg.defaults.condition = 'hujan'; cfg.items = [{ id: 'a', name: '<i>Tali</i>', cat: 'Lainnya', per: 'kelompok', qty: 1, unit: 'roll', weightG: 100, on: true }];
    OV.set('/data/logistics.json', JSON.stringify(cfg)); let p = await lgPage(420, 900);
    assert.strictEqual(await text(p, '[data-open-logistics] span'), 'Hitung Logistik <b>x</b>'); await p.click('[data-open-logistics]'); await p.waitForSelector('#lgOut');
    assert.deepStrictEqual(await p.$$eval('#lgCond option', (o) => o.map((x) => x.textContent)), ['Hujan deras']); assert.strictEqual(await p.evaluate(() => window.__pwn), undefined, 'judul dari CMS tidak mengeksekusi HTML'); assert.match(await text(p, '.lg-list'), /<i>Tali<\/i>/); assert.strictEqual(await p.$$eval('.lg-list li', (e) => e.length), 1); await p.close();
    OV.set('/data/logistics.json', JSON.stringify({ ...cfg, enabled: false })); p = await lgPage(420, 900); assert.ok(await p.$eval('[data-open-logistics]', (e) => e.hidden), 'enabled=false menyembunyikan tombol'); assert.ok(await p.$eval('[data-open-logistics]', (e) => getComputedStyle(e).display === 'none')); await p.close();
    OV.set('/data/logistics.json', 404); p = await lgPage(420, 900); assert.strictEqual(await text(p, '[data-open-logistics] span'), 'Kalkulator Logistik'); await p.click('[data-open-logistics]'); await p.waitForSelector('#lgOut .lg-list'); assert.ok(await p.$$eval('.lg-list li', (e) => e.length) >= 10, 'berkas tak ada → nilai bawaan'); assert.deepStrictEqual(p.errs, []); await p.close(); OV.clear();
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
    await pub.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await pub.waitForSelector('.sf-lock', { visible: true }); await sleep(300);
    const g = await pub.evaluate(() => { const a = document.querySelector('.sf-lock'), c = document.querySelector('.sf-copy'), f = document.querySelector('.site-footer'); const r = a.getBoundingClientRect(), cr = c.getBoundingClientRect(), fr = f.getBoundingClientRect(); const sv = a.querySelector('svg').getBoundingClientRect();
      return { text: a.textContent.trim(), label: a.getAttribute('aria-label'), href: a.getAttribute('href'), below: r.top >= cr.bottom - 1, centerDx: Math.abs((r.left + r.width / 2) - (fr.left + fr.width / 2)), icon: Math.round(sv.width), opacity: +getComputedStyle(a).opacity, tap: [Math.round(r.width), Math.round(r.height)] }; });
    assert.strictEqual(g.text, '', 'tanpa teks'); assert.strictEqual(g.label, 'Admin'); assert.strictEqual(g.href, 'admin/'); assert.ok(g.below, 'di bawah copyright'); assert.ok(g.centerDx <= 1, 'rata tengah ' + g.centerDx);
    assert.ok(g.icon <= 12 && g.opacity <= 0.25, 'kecil & samar'); assert.ok(g.tap[0] >= 28 && g.tap[1] >= 24, 'tetap bisa diketuk ' + g.tap);
    await Promise.all([pub.waitForNavigation({ waitUntil: 'domcontentloaded' }), pub.click('.sf-lock')]); assert.match(pub.url(), /\/admin\/$/); await pub.waitForSelector('.login-card');
    await pub.close();
  });

  await browser.close(); server.close();
  return true;
}
module.exports = { run };
