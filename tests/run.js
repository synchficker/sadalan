'use strict';
/* npm test — uji skema, klien GitHub (dengan emulator), integritas data, dan (bila Puppeteer tersedia) uji browser. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Schema = require('../admin/js/schema.js');
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
  await t('CSP admin membatasi koneksi hanya ke api.github.com dan skrip ke self', () => {
    const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
    assert.match(html, /connect-src https:\/\/api\.github\.com;/); assert.match(html, /script-src 'self';/); assert.match(html, /noindex/);
  });
  await t('kode admin tidak memakai innerHTML dengan data pengguna / eval', () => {
    for (const f of ['app.js', 'ui.js', 'github.js']) {
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
