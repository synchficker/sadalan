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
      if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return rq.continue();
      return rq.abort(); // CDN/font eksternal tidak dibutuhkan untuk uji
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    return page;
  };
  const $ = (p, s) => p.$(s);
  const text = (p, s) => p.$eval(s, (e) => e.textContent.trim());
  const rows = (p) => p.$$eval('.tbl tbody tr:not(.none)', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
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

  await nav(page, '#/trails'); await page.waitForSelector('.tbl');
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
    await page.waitForFunction((n) => document.querySelectorAll('.tbl tbody tr').length === n, {}, trailsBefore + 1); assert.ok(!(await $(page, '.drawer')));
  });
  await t('jejak: hapus jejak yang jadi slide hero ikut membersihkan hero dalam SATU commit', async () => {
    const before = fake.log.length; assert.ok(ghData('site').hero.slideTrailIds.includes(2));
    await page.evaluate(() => { [...document.querySelectorAll('.tbl tbody tr')].find((r) => /Gunung Prau/.test(r.textContent)).querySelector('.icon-btn.danger').click(); });
    await page.waitForSelector('.dlg'); assert.match(await text(page, '.dlg p'), /slide hero/i); await clickBtn(page, 'Hapus', '.dlg'); await waitToast(page, /Jejak dihapus/);
    assert.strictEqual(fake.log.length, before + 1); assert.ok(!ghData('trails').some((x) => x.id === 2)); assert.ok(!ghData('site').hero.slideTrailIds.includes(2));
  });

  await t('ulasan: judul berisi HTML ditampilkan sebagai teks (anti-XSS) dan tersimpan', async () => {
    await nav(page, '#/reviews'); await page.waitForSelector('.tbl'); await clickBtn(page, 'Tambah ulasan'); await page.waitForSelector('.drawer');
    await fill(page, 'Judul ulasan', '<img src=x onerror="window.__xss=1">Warung Mbah'); await fill(page, 'Ringkasan', 'Makanan enak, porsi besar, harga bersahabat untuk pendaki.');
    await fill(page, 'Isi lengkap', 'Paragraf satu.\n\nParagraf dua.'); await fill(page, 'Tag', 'makanan, murah , ');
    await clickBtn(page, 'Simpan & terbitkan', '.drawer'); await waitToast(page, /Ulasan ditambahkan/);
    const rv = ghData('reviews'); const n = rv[rv.length - 1]; assert.deepStrictEqual(n.body, ['Paragraf satu.', 'Paragraf dua.']); assert.deepStrictEqual(n.tags, ['makanan', 'murah']);
    await sleep(150); assert.ok(!(await page.evaluate(() => window.__xss))); assert.ok((await rows(page)).some((r) => r.includes('<img src=x')));
    assert.strictEqual(await page.$$eval('.tbl img[src="x"]', (e) => e.length), 0);
  });

  await t('artikel: editor blok → ID slug otomatis, struktur body benar', async () => {
    await nav(page, '#/blog'); await page.waitForSelector('.tbl'); await clickBtn(page, 'Tulis artikel'); await page.waitForSelector('.drawer');
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
    await page.waitForSelector('.tbl'); await clickBtn(page, 'Tulis artikel'); await page.waitForSelector('.drawer');
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

  await t('tanpa error JavaScript selama seluruh alur admin', async () => { assert.deepStrictEqual(errors, []); });

  await t('tampilan mobile (390px): menu geser, tabel & formulir tidak meluap', async () => {
    const m = await newPage(390, 800); await m.goto(base + '/admin/'); await login(m, 'good-token'); await m.waitForSelector('.stats');
    await m.goto(base + '/admin/#/reviews'); await m.waitForSelector('.tbl');
    const ov = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(ov <= 1, 'overflow horizontal ' + ov);
    await m.click('.topbar .icon-btn'); await m.waitForFunction(() => document.body.classList.contains('nav-open')); await m.screenshot({ path: '/tmp/admin-mobile-nav.png' });
    await m.mouse.click(360, 400); await m.waitForFunction(() => !document.body.classList.contains('nav-open')); await clickBtn(m, 'Tambah ulasan'); await m.waitForSelector('.drawer'); const ov2 = await m.evaluate(() => document.querySelector('.drawer-body').scrollWidth - document.querySelector('.drawer-body').clientWidth); assert.ok(ov2 <= 1, 'drawer overflow ' + ov2);
    await sleep(500); await m.screenshot({ path: '/tmp/admin-mobile-form.png' }); await m.close();
  });

  await page.screenshot({ path: '/tmp/admin-desktop-media.png' });
  await nav(page, '#/trails'); await page.waitForSelector('.tbl'); await page.screenshot({ path: '/tmp/admin-desktop-trails.png' });
  await nav(page, '#/dashboard'); await page.waitForSelector('.stats'); await page.screenshot({ path: '/tmp/admin-desktop-dashboard.png' });
  await nav(page, '#/site'); await page.waitForSelector('.formpanel'); await page.screenshot({ path: '/tmp/admin-desktop-site.png', fullPage: true });

  await t('keluar: sesi dihapus dan kembali ke halaman masuk', async () => {
    await page.evaluate(() => { location.hash = '#/dashboard'; }); await page.waitForSelector('.stats');
    await clickBtn(page, 'Keluar'); await page.waitForSelector('.login-card');
    assert.ok(!(await page.evaluate(() => sessionStorage.getItem('sadalan_cms_session') || localStorage.getItem('sadalan_cms_session'))));
  });
  await t('"Ingat di perangkat ini": sesi pulih setelah muat ulang halaman', async () => {
    await login(page, 'good-token', { remember: true }); await page.waitForSelector('.stats'); await page.reload(); await page.waitForSelector('.stats');
    assert.match(await text(page, '.page-head h1'), /Halo, Budi/); await page.evaluate(() => localStorage.clear());
  });
  await t('token dicabut di tengah sesi → otomatis keluar dengan pesan', async () => {
    await page.reload(); await page.waitForSelector('.login-card'); await login(page, 'good-token'); await page.waitForSelector('.stats');
    fake.tokens['good-token'] = null; await nav(page, '#/trails'); await page.waitForSelector('.tbl'); await clickBtn(page, 'Tambah jejak');
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

  await browser.close(); server.close();
  return true;
}
module.exports = { run };
