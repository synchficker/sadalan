'use strict';
/* npm test — uji skema, klien GitHub (dengan emulator), integritas data, dan (bila Puppeteer tersedia) uji browser. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Schema = require('../admin/js/schema.js');
const Geo = require('../assets/js/geo.js');
const Gh = require('../admin/js/github.js');
const { FakeGithub, installFetch } = require('./fake-github');

const root = path.join(__dirname, '..');
const V = Schema.validators;
let pass = 0; const fails = [];
async function t(name, fn) { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fails.push(name); console.log('  GAGAL ' + name + '\n        ' + e.message); } }
const readData = () => Object.fromEntries(['site', 'trails', 'reviews', 'blog', 'profile'].map((n) => [n, JSON.parse(fs.readFileSync(path.join(root, 'data', n + '.json'), 'utf8'))]));
const throwsFields = (fn) => { try { fn(); } catch (e) { if (e.fields) return e.fields; throw e; } assert.fail('seharusnya ditolak'); };
const repoFiles = () => Object.fromEntries(['site', 'trails', 'reviews', 'blog', 'profile'].map((n) => [`data/${n}.json`, fs.readFileSync(path.join(root, 'data', n + '.json'), 'utf8')]));

(async () => {
  const D = readData();
  console.log('\nSkema & data');
  await t('semua data bawaan lolos validasi', () => {
    D.trails.forEach((x) => V.trail(x, { site: D.site })); D.reviews.forEach((x) => V.review(x, { site: D.site }));
    D.blog.forEach((x) => V.blog(x, { existingId: x.id })); V.profile(D.profile); V.site(D.site, { trails: D.trails, reviews: D.reviews });
  });
  await t('URL gambar javascript: ditolak', () => { assert.ok(throwsFields(() => V.trail({ ...D.trails[0], img: 'javascript:alert(1)' }, { site: D.site })).img); });
  await t('kategori jejak yang tidak ada ditolak', () => { assert.ok(throwsFields(() => V.trail({ ...D.trails[0], cat: 'Palsu' }, { site: D.site })).cat); });
  await t('rating & koordinat di luar rentang ditolak', () => { const f = throwsFields(() => V.trail({ ...D.trails[0], rating: 9, lat: 200 }, { site: D.site })); assert.ok(f.rating && f.lat); });
  await t('tanggal ulasan tidak valid ditolak', () => { assert.ok(throwsFields(() => V.review({ ...D.reviews[0], iso: '2026-02-31' }, { site: D.site })).iso); });
  await t('field tak dikenal dibuang', () => { assert.ok(!('hack' in V.trail({ ...D.trails[0], hack: 1 }, { site: D.site }))); });
  await t('kategori yang masih dipakai tidak bisa dihapus', () => { const s = { ...D.site, trailCategories: D.site.trailCategories.slice(1) }; assert.ok(throwsFields(() => V.site(s, { trails: D.trails, reviews: D.reviews })).trailCategories); });
  await t('slide hero ke jejak yang tidak ada ditolak', () => { const s = { ...D.site, hero: { ...D.site.hero, slideTrailIds: [999] } }; assert.ok(throwsFields(() => V.site(s, { trails: D.trails, reviews: D.reviews }))['hero.slideTrailIds']); });
  await t('blok artikel tidak valid ditolak', () => { assert.ok(Object.keys(throwsFields(() => V.blog({ ...D.blog[0], body: [{ x: 'y' }] }))).some((k) => k.startsWith('body'))); });
  await t('slugify judul berbahasa Indonesia', () => { assert.strictEqual(Schema.slugify('Tips Mendaki: Gunung Prau & Sindoro!'), 'tips-mendaki-gunung-prau-sindoro'); });
  await t('undangan pengguna: username dirapikan (@, tautan profil) dan divalidasi', () => {
    assert.deepStrictEqual(V.collaborator({ username: ' @Budi-1 ', permission: 'push' }), { username: 'Budi-1', permission: 'push' });
    assert.strictEqual(V.collaborator({ username: 'https://github.com/siti/', permission: 'admin' }).username, 'siti');
    assert.ok(throwsFields(() => V.collaborator({ username: '', permission: 'push' })).username);
    assert.ok(throwsFields(() => V.collaborator({ username: '-x', permission: 'push' })).username);
    assert.ok(throwsFields(() => V.collaborator({ username: 'a--b', permission: 'push' })).username);
    assert.ok(throwsFields(() => V.collaborator({ username: 'x'.repeat(40), permission: 'push' })).username);
    assert.ok(throwsFields(() => V.collaborator({ username: 'Siti', permission: 'push' }, { existing: ['siti'] })).username, 'ganda tanpa membedakan huruf besar');
    assert.ok(throwsFields(() => V.collaborator({ username: 'ok', permission: 'root' })).permission);
    assert.strictEqual(V.collaborator({ username: 'ok', permission: 'admin' }, { orgRepo: false }).permission, 'push', 'repositori pribadi selalu Editor');
  });
  await t('referensi data konsisten (slide hero, kategori ulasan)', () => {
    D.site.hero.slideTrailIds.forEach((id) => assert.ok(D.trails.some((x) => x.id === id)));
    const names = D.site.reviewCategories.map((c) => c.name); D.reviews.forEach((r) => assert.ok(names.includes(r.cat)));
  });

  console.log('\nRute GPS (GPX, statistik, skema)');
  const GPX = `<?xml version="1.0"?><!-- c --><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Meta &amp; Co</name></metadata>
<trk><name>Prau &lt;Via&gt; Patak</name><trkseg>
<trkpt lat="-7.1852" lon="109.9244"><ele>2000.4</ele><time>2026-05-01T06:00:00Z</time></trkpt>
<trkpt lat='-7.1900' lon='109.9250'><ele>2100</ele><time>2026-05-01T06:10:00Z</time></trkpt>
<trkpt lat="-7.1950" lon="109.9260"/>
<trkpt lat="999" lon="1"><ele>1</ele></trkpt>
</trkseg><trkseg><trkpt lat="-7.2" lon="109.93"><ele>2200</ele></trkpt><trkpt lat="-7.21" lon="109.94"><ele>2300</ele></trkpt></trkseg></trk></gpx>`;
  await t('GPX: segmen, nama (entitas XML), tag menutup sendiri, kutip tunggal, komentar, titik tak valid dilewati', () => {
    const r = Geo.parseGpx(GPX); assert.strictEqual(r.name, 'Prau <Via> Patak'); assert.strictEqual(r.segs.length, 2); assert.strictEqual(r.count, 5); assert.strictEqual(r.skipped, 1);
    assert.deepStrictEqual(r.segs[0][2], [-7.195, 109.926, null, null]); assert.strictEqual(r.segs[0][1][3] - r.segs[0][0][3], 600);
  });
  await t('GPX: rute (rte) dibaca; berkas bukan GPX / tanpa jalur ditolak dengan pesan jelas', () => {
    const r = Geo.parseGpx('<gpx><rte><name>R1</name><rtept lat="1" lon="1"/><rtept lat="1.1" lon="1.1"/></rte></gpx>'); assert.strictEqual(r.kind, 'route'); assert.strictEqual(r.name, 'R1');
    assert.throws(() => Geo.parseGpx('<html/>'), /bukan GPX/); assert.throws(() => Geo.parseGpx('<gpx><wpt lat="1" lon="1"/></gpx>'), /minimal 2 titik/); assert.throws(() => Geo.parseGpx(''), /kosong/);
  });
  await t('GPX: ekspor lalu impor kembali menghasilkan titik yang sama (termasuk karakter khusus pada nama)', () => {
    const r = Geo.parseGpx(GPX), out = Geo.toGpx({ name: 'Tes & <x>', segs: r.segs }), r2 = Geo.parseGpx(out);
    assert.strictEqual(r2.name, 'Tes & <x>'); assert.deepStrictEqual(r2.segs, r.segs); assert.match(out, /<trkseg>/);
  });
  await t('statistik: jarak haversine, naik/turun berambang, durasi, waktu bergerak', () => {
    assert.ok(Math.abs(Geo.dist([0, 0], [0.01, 0]) - 1111.95) < 1);
    const line = Array.from({ length: 101 }, (_, i) => [-7 + i * 0.0001, 110, 1000 + i * 2, 1e9 + i * 10]); const s = Geo.stats([line]);
    assert.ok(Math.abs(s.km - 1.1119) < 0.01, 'km ' + s.km); assert.ok(s.gain > 180 && s.gain <= 200, 'gain ' + s.gain); assert.strictEqual(s.loss, 0); assert.strictEqual(s.secs, 1000); assert.strictEqual(s.moving, 1000); assert.strictEqual(s.max, 1200);
    const noisy = Array.from({ length: 200 }, (_, i) => [-7 + i * 0.0001, 110, 1000 + (i % 2 ? 3 : -3), null]); assert.ok(Geo.stats([noisy]).gain < 10, 'derau altimeter tidak menggelembungkan naik');
  });
  await t('penyederhanaan: titik segaris dibuang, ujung dipertahankan, limit() menghormati batas', () => {
    const line = Array.from({ length: 500 }, (_, i) => [-7 + i * 1e-4, 110, null, null]); const s = Geo.simplify([line], 2)[0]; assert.strictEqual(s.length, 2);
    const wave = Array.from({ length: 3000 }, (_, i) => [-7 + i * 1e-4, 110 + Math.sin(i / 20) * 1e-3, null, null]); const l = Geo.limit([wave], 400); assert.ok(Geo.count(l) <= 400 && Geo.count(l) > 50);
    assert.deepStrictEqual(l[0][0], wave[0]); assert.deepStrictEqual(l[0][l[0].length - 1], wave[wave.length - 1]);
  });
  await t('berkas rute: pack → unpack bolak-balik & ukuran ringkas; format teks Indonesia', () => {
    const segs = Geo.clean(Geo.parseGpx(GPX).segs); assert.deepStrictEqual(Geo.unpack(Geo.pack(segs)), segs);
    assert.strictEqual(Geo.fmtKm(8.41), '8,4 km'); assert.strictEqual(Geo.fmtElev(2665.4), '2.665 mdpl'); assert.strictEqual(Geo.fmtDur(15120), '4 jam 12 mnt'); assert.strictEqual(Geo.fmtClock(3725), '01:02:05');
  });
  await t('skema: rute valid dibulatkan; koordinat/ketinggian/jumlah titik di luar batas ditolak; path rute pada jejak divalidasi', () => {
    assert.deepStrictEqual(V.track({ v: 1, segs: [[[1.234567, 2.1, 100.6, 5.2], [1.3, 2.2]]] }).segs[0][0], [1.23457, 2.1, 101, 5]);
    assert.ok(throwsFields(() => V.track({ v: 1, segs: [[[100, 2], [1, 2]]] })).segs); assert.ok(throwsFields(() => V.track({ v: 1, segs: [[[1, 2]]] })).segs);
    assert.ok(throwsFields(() => V.track({ v: 1, segs: [[[1, 2, 99999], [1, 2]]] })).segs); assert.ok(throwsFields(() => V.track({ v: 2, segs: [] })).v);
    assert.ok(throwsFields(() => V.track({ v: 1, segs: [Array.from({ length: 6001 }, (_, i) => [1 + i * 1e-5, 2])] })).segs);
    assert.strictEqual(V.trail({ ...D.trails[0], track: 'data/tracks/1.json' }, { site: D.site }).track, 'data/tracks/1.json');
    assert.ok(throwsFields(() => V.trail({ ...D.trails[0], track: '../../x.json' }, { site: D.site })).track); assert.ok(!('track' in V.trail(D.trails[0], { site: D.site })));
  });
  await t('celah antar segmen terdeteksi (jarak & selisih waktu) untuk diisi/ditandai putus-putus', () => {
    const segs = [[[-7, 110, 10, 100], [-7.001, 110, 12, 130]], [[-7.003, 110, 14, 200], [-7.004, 110, null, 230]], [[-7.004, 110.0001]]];
    const b = Geo.bridges(segs); assert.strictEqual(b.length, 2); assert.ok(Math.abs(b[0].dist - 222.4) < 1); assert.strictEqual(b[0].dt, 70); assert.strictEqual(b[1].dt, null); assert.strictEqual(Geo.bridges([segs[0]]).length, 0);
  });
  await t('data: setiap jejak ber-rute menunjuk berkas yang ada & valid', () => {
    D.trails.filter((x) => x.track).forEach((x) => { const f = path.join(root, x.track); assert.ok(fs.existsSync(f), x.track); V.track(JSON.parse(fs.readFileSync(f, 'utf8'))); });
  });

  console.log('\nMode Gelap & Terang (token, kontras, kelengkapan)');
  const themeCss = fs.readFileSync(path.join(root, 'assets/css/theme.css'), 'utf8');
  const tokens = (re) => { const o = {}; for (const m of themeCss.match(re)[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) o[m[1]] = m[2].trim(); return o; };
  const LT = tokens(/:root\{([\s\S]*?)\n\}/), DK = tokens(/:root\[data-theme=dark\]\{([\s\S]*?)\n\}/);
  const mainVars = {}; for (const f of ['assets/css/style.css', 'admin/css/admin.css']) for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) mainVars[m[1]] = m[2].trim();
  const val = (dark, k) => (dark && DK[k]) || LT[k] || mainVars[k];
  const hex = (h) => { h = h.trim(); if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + [...h.slice(1)].map((c) => c + c).join(''); return /^#[0-9a-f]{6}$/i.test(h) ? h : null; };
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  await t('tema: setiap token terang punya padanan gelap; semua var(--x) di CSS terdefinisi', () => {
    const miss = Object.keys(LT).filter((k) => k !== 'color-scheme' && !(k in DK)); assert.deepStrictEqual(miss, [], 'token tanpa nilai gelap: ' + miss);
    for (const f of ['assets/css/style.css', 'admin/css/admin.css', 'assets/css/theme.css']) { const css = fs.readFileSync(path.join(root, f), 'utf8'); const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1])); const undef = [...used].filter((k) => !(k in LT) && !(k in mainVars) && !/^--(swiper|leaflet)/.test(k)); assert.deepStrictEqual(undef, [], f + ' memakai variabel tak terdefinisi: ' + undef); }
  });
  await t('tema: kontras teks pada palet GELAP memenuhi WCAG AA (≥ 4,5:1) untuk pasangan utama', () => {
    const pairs = [['--ink', '--cream'], ['--ink', '--surface'], ['--muted', '--cream'], ['--muted', '--surface'], ['--fg-accent', '--surface'], ['--fg-accent', '--sage'], ['--fg-accent-2', '--surface'], ['--ink-2', '--surface'], ['--muted-2', '--surface'], ['--nav-muted', '--surface'],
      ['--red-fg', '--red-bg'], ['--green-fg', '--green-bg'], ['--amber-fg', '--amber-bg'], ['--on-amber', '--amber-bg'], ['--on-red', '--red-bg'], ['--on-red-2', '--red-bg'], ['--warm', '--warm-bg'], ['--warm', '--surface'], ['--red-fg', '--surface']];
    const bad = pairs.map(([a, b]) => [a, b, ratio(hex(val(true, a)), hex(val(true, b)))]).filter(([, , r]) => r < 4.5).map(([a, b, r]) => `${a} di ${b} = ${r.toFixed(2)}`); assert.deepStrictEqual(bad, [], bad.join('; '));
    for (const [fg, bg] of [['#ffffff', '--forest'], ['#ffffff', '--forest-2'], ['#d3e0d9', '--deep'], ['#a9c0b3', '--deep']]) assert.ok(ratio(hex(fg), hex(val(true, bg))) >= 4.5, `${fg} di ${bg} (gelap)`);
  });
  await t('tema: palet TERANG tetap seperti tampilan asli (token baru = warna lama)', () => {
    assert.strictEqual(hex(LT['--surface']), '#ffffff'); assert.strictEqual(LT['--page-bg'], '#dfe5e0'); assert.strictEqual(LT['--fg-accent'], '#173f35'); assert.strictEqual(LT['--line-2'], '#d7dfd9'); assert.strictEqual(LT['--deep'], '#173f35');
  });
  await t('tema: theme.js dimuat di <head> semua halaman (tanpa kilatan) & CSP admin tetap tanpa inline', () => {
    for (const f of ['index.html', 'blog-detail.html', 'admin/index.html']) { const h = fs.readFileSync(path.join(root, f), 'utf8'), head = h.slice(h.indexOf('<head>'), h.indexOf('</head>')); assert.match(head, /theme\.js/, f); assert.match(head, /theme\.css/, f); assert.match(head, /color-scheme/, f); assert.ok(head.indexOf('theme.js') < head.indexOf('.css"'), 'theme.js sebelum stylesheet: ' + f); }
    const adm = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8'); assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(adm), 'tak ada skrip inline di admin');
  });

  console.log('\nKlien GitHub (emulator)');
  const fake = new FakeGithub(repoFiles());
  const restore = installFetch(fake);
  const cfg = { owner: 'acme', repo: 'sadalan', branch: '', token: 'good-token' };
  await t('login berhasil, branch default terdeteksi', async () => { const i = await Gh.connect(cfg); assert.strictEqual(i.branch, 'main'); assert.strictEqual(i.user.login, 'budi'); });
  await t('token salah → pesan 401 yang jelas', async () => { await assert.rejects(Gh.connect({ ...cfg, token: 'salah' }), (e) => e.status === 401 && /Token ditolak/.test(e.message)); });
  await t('repositori tidak ada → pesan 404', async () => { await assert.rejects(Gh.connect({ ...cfg, repo: 'lain' }), (e) => e.status === 404); });
  await t('repositori tanpa data/site.json ditolak', async () => {
    const f2 = new FakeGithub({ 'README.md': 'x' }); const r = installFetch(f2);
    await assert.rejects(Gh.connect(cfg), /data\/site\.json/); r(); installFetch(fake);
  });
  await t('deteksi owner/repo dari alamat GitHub Pages', () => {
    assert.deepStrictEqual(Gh.detect({ hostname: 'budi.github.io', pathname: '/sadalan/admin/' }), { owner: 'budi', repo: 'sadalan' });
    assert.deepStrictEqual(Gh.detect({ hostname: 'budi.github.io', pathname: '/admin/index.html' }), { owner: 'budi', repo: 'budi.github.io' });
    assert.strictEqual(Gh.detect({ hostname: 'sadalan.id', pathname: '/admin/' }), null);
  });
  await Gh.connect(cfg);
  await t('readData membaca 5 berkas JSON', async () => { const r = await Gh.readData(); assert.strictEqual(r.data.trails.length, D.trails.length); });
  await t('commit beberapa berkas = satu commit atomik (teks + gambar + hapus)', async () => {
    const before = fake.log.length;
    await Gh.commit({ message: 'uji', files: [{ path: 'data/profile.json', text: '{"x":1}\n' }, { path: 'assets/uploads/a.webp', base64: Buffer.from('IMG').toString('base64') }, { path: 'data/blog.json', remove: true }] });
    assert.strictEqual(fake.log.length, before + 1);
    assert.strictEqual(fake.text('data/profile.json'), '{"x":1}\n'); assert.strictEqual(fake.text('assets/uploads/a.webp'), 'IMG'); assert.strictEqual(fake.text('data/blog.json'), null);
    assert.strictEqual((await Gh.list('assets/uploads')).length, 1); assert.deepStrictEqual(await Gh.list('tidak/ada'), []);
  });
  await t('push bersamaan → konflik dilaporkan, tidak menimpa', async () => {
    fake.beforePatch = (f) => { const t2 = f._tree(new Map([...f.files, ['x.txt', Buffer.from('orang lain')]])); f.head = f._commit(t2, [f.head], 'push lain'); };
    await assert.rejects(Gh.commit({ message: 'saya', files: [{ path: 'y.txt', text: 'y' }] }), (e) => e.status === 409 && /Coba simpan sekali lagi/.test(e.message));
    assert.strictEqual(fake.text('x.txt'), 'orang lain'); assert.strictEqual(fake.text('y.txt'), null);
  });
  console.log('\nManajemen pengguna (kolaborator GitHub)');
  await t('login: tipe pemilik & hak admin terdeteksi', async () => {
    const i = await Gh.connect(cfg); assert.strictEqual(i.ownerType, 'Organization'); assert.strictEqual(i.canAdmin, true);
    assert.strictEqual((await Gh.connect({ ...cfg, token: 'push-token' })).canAdmin, false); await Gh.connect(cfg);
  });
  await t('daftar kolaborator & undangan dinormalisasi (peran, hak edit)', async () => {
    const u = await Gh.listCollaborators(); assert.deepStrictEqual(u.map((x) => [x.login, x.role, x.canPush]), [['budi', 'admin', true], ['siti', 'write', true], ['andi', 'read', false]]);
    const iv = await Gh.listInvitations(); assert.deepStrictEqual(iv.map((x) => [x.id, x.login, x.role]), [[501, 'rina', 'write']]);
  });
  await t('periksa akun: ada → profil, tidak ada → pesan 404 yang jelas', async () => {
    assert.strictEqual((await Gh.lookupUser('DEWI')).login, 'dewi');
    await assert.rejects(Gh.lookupUser('hantu'), (e) => e.status === 404 && /tidak ditemukan/.test(e.message));
    await assert.rejects(Gh.lookupUser('bad name!'), /tidak valid/);
  });
  await t('undang pengguna baru → undangan terkirim (201), tanpa commit', async () => {
    const before = fake.log.length; const r = await Gh.setCollaborator('dewi', 'admin');
    assert.strictEqual(r.invited, true); assert.ok(fake.invites.some((i) => i.login === 'dewi' && i.role === 'admin')); assert.strictEqual(fake.log.length, before);
  });
  await t('ubah peran kolaborator yang ada (204) → peran berubah, bukan undangan baru', async () => {
    const r = await Gh.setCollaborator('andi', 'push'); assert.strictEqual(r.invited, false); assert.strictEqual(fake.collabs.find((c) => c.login === 'andi').role, 'write');
  });
  await t('undangan ganda / pemilik repositori ditolak dengan pesan jelas', async () => {
    await assert.rejects(Gh.setCollaborator('rina', 'push'), (e) => e.status === 422 && /menolak undangan/.test(e.message));
    await assert.rejects(Gh.setCollaborator('acme', 'push'), (e) => e.status === 422);
  });
  await t('cabut akses & batalkan undangan', async () => {
    await Gh.removeCollaborator('siti'); assert.ok(!fake.collabs.some((c) => c.login === 'siti'));
    await Gh.cancelInvitation(501); assert.ok(!fake.invites.some((i) => i.id === 501));
    await assert.rejects(Gh.removeCollaborator('siti'), (e) => e.status === 404 && /Muat ulang/.test(e.message));
    await assert.rejects(Gh.cancelInvitation(501), (e) => e.status === 404);
  });
  await t('token tanpa izin Administration → pesan izin yang menunjuk perbaikannya', async () => {
    await Gh.connect({ ...cfg, token: 'push-token' });
    await assert.rejects(Gh.listInvitations(), (e) => e.status === 403 && /Administration: Read and write/.test(e.message));
    await assert.rejects(Gh.setCollaborator('dewi', 'push'), (e) => e.status === 403 && /Administration/.test(e.message));
    assert.ok((await Gh.listCollaborators()).length > 0, 'daftar kolaborator tetap bisa dibaca');
    await Gh.connect(cfg);
  });
  await t('repositori pribadi: peran tidak dikirim, semua kolaborator = Editor', async () => {
    const f2 = new FakeGithub(repoFiles(), { owner: 'acme', repo: 'sadalan', ownerType: 'User' }); const r2 = installFetch(f2);
    const i = await Gh.connect(cfg); assert.strictEqual(i.ownerType, 'User'); assert.strictEqual(Gh.ctx().ownerType, 'User');
    await Gh.setCollaborator('dewi', 'admin'); assert.strictEqual(f2.invites[0].role, 'write');
    r2(); installFetch(fake); await Gh.connect(cfg);
  });

  await t('token read-only → pesan izin menulis', async () => {
    await Gh.connect({ ...cfg, token: 'ro-token' });
    await assert.rejects(Gh.commit({ message: 'm', files: [{ path: 'z.txt', text: 'z' }] }), (e) => e.status === 403 && /Contents: Read and write/.test(e.message));
  });
  restore();

  console.log('\nKeamanan halaman admin');
  await t('CSP admin membatasi koneksi hanya ke api.github.com (+ layanan rute OSM) dan skrip ke self', () => {
    const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
    assert.match(html, /connect-src https:\/\/api\.github\.com https:\/\/routing\.openstreetmap\.de;/); assert.match(html, /media-src data:;/); assert.ok(!/unpkg|jsdelivr|cdnjs/.test(html.match(/Content-Security-Policy[^>]*/)[0]), 'CSP tidak membuka CDN'); assert.match(html, /script-src 'self';/); assert.match(html, /noindex/);
  });
  await t('kode admin tidak memakai innerHTML dengan data pengguna / eval', () => {
    for (const f of ['app.js', 'ui.js', 'github.js', 'gps.js', 'tracker.js', 'map.js']) {
      const s = fs.readFileSync(path.join(root, 'admin/js', f), 'utf8');
      assert.ok(!/eval\(|new Function|document\.write/.test(s), f);
      const inner = (s.match(/innerHTML\s*=/g) || []).length; assert.ok(f === 'ui.js' ? inner === 1 : inner === 0, `${f}: innerHTML=${inner}`);
    }
  });
  await t('tidak ada rahasia/server tersisa di repositori publik', () => {
    for (const p of ['server.js', 'private', 'cms']) assert.ok(!fs.existsSync(path.join(root, p)), p + ' masih ada');
  });

  let e2e = null;
  try { e2e = require('./e2e.js'); } catch (e) { console.log('\nUji browser dilewati: ' + e.message.split('\n')[0]); }
  if (e2e) { console.log('\nUji browser (Puppeteer)'); const r = await e2e.run(t); }

  console.log(`\n${pass} lulus, ${fails.length} gagal`);
  process.exit(fails.length ? 1 : 0);
})();
