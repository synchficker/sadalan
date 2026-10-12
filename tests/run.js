'use strict';
/* npm test — uji skema, klien GitHub (dengan emulator), integritas data, dan (bila Puppeteer tersedia) uji browser. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Schema = require('../admin/js/schema.js');
const Gh = require('../admin/js/github.js');
const Gpx = require('../assets/js/gpx.js');
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

  console.log('\nLintasan GPS (GPX)');
  const synth = (n = 3000, o = {}) => Array.from({ length: n }, (_, i) => { const f = i / (n - 1); return { lat: -7.3198 + f * 0.05 + Math.sin(f * 30) * 0.0008, lng: 107.7313 + f * 0.03, ele: o.noEle ? null : 1500 + f * 1165 + Math.sin(f * 200) * 1.2, t: Date.UTC(2026, 9, 1, 6) + i * 10000 }; });
  await t('analisis: jarak, naik/turun (derau GPS diredam), titik tertinggi/terendah', () => {
    const a = Gpx.analyze(synth()); assert.ok(Math.abs(a.gain - 1165) < 60, 'naik ' + a.gain); assert.strictEqual(a.loss, 0); assert.strictEqual(a.min, 1500); assert.ok(a.max >= 2664 && a.max <= 2666);
    assert.ok(a.dist > 6000 && a.dist < 7000, 'jarak ' + a.dist); assert.strictEqual(a.hasEle, true); assert.strictEqual(Gpx.analyze(synth(50, { noEle: true })).hasEle, false);
    const eq = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]; assert.ok(Math.abs(Gpx.analyze(eq).dist - 111195) < 100, 'haversine 1° ekuator ≈ 111,2 km');
  });
  await t('simplify: ≤ batas titik, awal & akhir terjaga, jarak bergeser < 1%, 100 ribu titik cepat', () => {
    const p = synth(); const s = Gpx.simplify(p, 800); assert.ok(s.length <= 800 && s.length > 20); assert.strictEqual(s[0], p[0]); assert.strictEqual(s[s.length - 1], p[p.length - 1]);
    assert.ok(Math.abs(Gpx.analyze(s).dist - Gpx.analyze(p).dist) / Gpx.analyze(p).dist < 0.01);
    const big = Array.from({ length: 100000 }, (_, i) => ({ lat: -7 + i * 1e-5 + Math.sin(i / 50) * 1e-4, lng: 107 + i * 1e-5, ele: 1000 + i * 0.01 + Math.sin(i / 10) })); const t0 = Date.now(); const bs = Gpx.simplify(big, 800); assert.ok(bs.length <= 800); assert.ok(Date.now() - t0 < 6000, 'terlalu lambat');
    assert.strictEqual(Gpx.simplify(p.slice(0, 10), 800).length, 10, 'lintasan pendek tidak diubah');
  });
  await t('GPX: tulis → baca kembali (nama dengan karakter khusus, waypoint, elevasi)', () => {
    const pts = Gpx.simplify(synth(), 300); const x = Gpx.build({ name: 'Uji & <b>"x"</b>', waypoints: [{ lat: -7.3, lng: 107.7, name: 'Basecamp' }], tracks: [{ name: 'Rute "A"', points: pts }] });
    assert.ok(x.startsWith('<?xml') && x.includes('xmlns="http://www.topografix.com/GPX/1/1"') && !x.includes('<b>'), 'XML valid & ter-escape');
    const g = Gpx.parse(x); assert.strictEqual(g.tracks.length, 1); assert.strictEqual(g.tracks[0].points.length, pts.length); assert.strictEqual(g.tracks[0].name, 'Rute "A"'); assert.strictEqual(g.waypoints[0].name, 'Basecamp');
    assert.ok(Math.abs(g.tracks[0].points[10].ele - pts[10].ele) < 0.1); assert.ok(Math.abs(g.tracks[0].points[10].lat - pts[10].lat) < 1e-6);
  });
  await t('parser toleran: namespace, tanda kutip tunggal, urutan atribut, CDATA, titik rusak dilewati, rte sebagai cadangan', () => {
    const odd = '\uFEFF<?xml version="1.0"?><gpx:gpx xmlns:gpx="x"><gpx:trk><gpx:name><![CDATA[Rute <i>x</i> &amp; y]]></gpx:name><gpx:trkseg><gpx:trkpt lon=\'107.1\' lat=\'-7.1\'><gpx:ele>100</gpx:ele></gpx:trkpt><gpx:trkpt lat="-7.2" lon="107.2"/><gpx:trkpt lat="999" lon="1"/><gpx:trkpt lat="abc" lon="1"/></gpx:trkseg></gpx:trk></gpx:gpx>';
    const g = Gpx.parse(odd); assert.strictEqual(g.tracks[0].name, 'Rute x & y'); assert.strictEqual(g.tracks[0].points.length, 2); assert.strictEqual(g.skipped, 2);
    assert.strictEqual(Gpx.parse('<gpx><rte><name>R</name><rtept lat="1" lon="2"/><rtept lat="1.1" lon="2.1"/></rte></gpx>').tracks[0].kind, 'rte');
    assert.strictEqual(Gpx.parse('<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.1" lon="2.1"/></trkseg><trkseg><trkpt lat="1.2" lon="2.2"/></trkseg></trk></gpx>').tracks[0].points.length, 3, 'beberapa segmen digabung');
  });
  await t('parser menolak berkas yang bukan GPX / kosong / tanpa lintasan, dengan pesan berbahasa Indonesia', () => {
    for (const bad of ['', '   ', '<html><body/></html>', '<gpx></gpx>', '<gpx><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>', '<gpx><wpt lat="1" lon="1"/></gpx>']) assert.throws(() => Gpx.parse(bad), (e) => e instanceof Gpx.GpxError && /GPX|kosong|lintasan/i.test(e.message), JSON.stringify(bad));
  });
  await t('keamanan parser: entitas kustom tidak diperluas, tag di nama dibuang, tidak ada ledakan memori', () => {
    const evil = '<!DOCTYPE gpx [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><gpx><trk><name>&b;&lt;script&gt;alert(1)&lt;/script&gt;</name><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.1" lon="1"/></trkseg></trk></gpx>';
    const n = Gpx.parse(evil).tracks[0].name; assert.ok(!/AAAA|<script/i.test(n), n); assert.ok(n.length <= 80);
    /* berkas rusak/jahat: puluhan ribu tag tak tertutup tidak boleh membuat parser kuadratik (hang) */
    const flood = [['<trkpt lat="1" lon="1">', '<gpx><trk><trkseg>', '</trkseg></trk></gpx>'], ['<trk>', '<gpx>', '</gpx>'], ['<name>', '<gpx><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.1" lon="1"/></trkseg>', '</trk></gpx>'], ['<wpt lat="1" lon="1">', '<gpx><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.1" lon="1"/></trkseg></trk>', '</gpx>']];
    for (const [unit, head, tail] of flood) { const t0 = Date.now(); try { Gpx.parse(head + unit.repeat(60000) + tail); } catch (e) { assert.ok(e instanceof Gpx.GpxError, e.message); } assert.ok(Date.now() - t0 < 2500, `lambat (${Date.now() - t0} ms) untuk ${unit}`); }
    assert.throws(() => Gpx.parse('<gpx><trk><trkseg>' + '<trkpt lat="1" lon="1"/>'.repeat(500001) + '</trkseg></trk></gpx>'), /terlalu besar/);
  });
  await t('simpan/muat lintasan (data/tracks/<id>.json): bulat, celah elevasi diisi, berkas rusak ditolak', () => {
    const pts = Gpx.simplify(synth(), 400); const back = Gpx.parseTrack(Gpx.serialize(pts)); assert.strictEqual(back.length, pts.length); assert.ok(Math.abs(back[5].lat - pts[5].lat) < 1e-5 && Math.abs(back[5].ele - pts[5].ele) <= 0.5);
    const gap = pts.map((p, i) => (i === 3 ? { ...p, ele: null } : p)); assert.ok(Gpx.parseTrack(Gpx.serialize(gap))[3].ele != null, 'celah diisi');
    assert.strictEqual(Gpx.parseTrack(Gpx.serialize(synth(40, { noEle: true })))[0].ele, null);
    for (const bad of ['', 'bukan json', '{"v":2,"pts":[]}', '{"v":1,"pts":[[1,2]]}', '{"v":1,"pts":[[1,2],[999,1]]}', '{"v":1,"pts":[[1,2],["a",1]]}']) assert.throws(() => Gpx.parseTrack(bad), Gpx.GpxError, bad);
    const sum = Gpx.summary(pts, false); const re = Gpx.analyze(Gpx.parseTrack(Gpx.serialize(pts))); assert.strictEqual(sum.dist, Math.round(re.dist), 'ringkasan = hitung ulang dari berkas'); assert.strictEqual(sum.gain, re.gain); assert.strictEqual(sum.max, re.max); assert.deepStrictEqual(Object.keys(sum), ['pts', 'dist', 'gain', 'loss', 'min', 'max', 'dl']); assert.strictEqual(sum.dl, false); V.trail({ ...D.trails[0], track: sum }, { site: D.site });
  });
  await t('format tampil sesuai gaya data jejak: “8,4 km”, “2.665 mdpl”, “4–5 jam”', () => {
    assert.strictEqual(Gpx.fmtDist(8412), '8,4 km'); assert.strictEqual(Gpx.fmtElev(2665.4), '2.665 mdpl'); assert.strictEqual(Gpx.fmtM(1240), '1.240 m');
    assert.strictEqual(Gpx.fmtRange(4.2), '4–5 jam'); assert.strictEqual(Gpx.fmtRange(4), '4–5 jam'); assert.strictEqual(Gpx.fmtRange(0.4), '25 menit'); assert.strictEqual(Gpx.fmtClock(18720), '5j 12m'); assert.strictEqual(Gpx.slug('Gunung Prau — Dieng!'), 'gunung-prau-dieng');
  });
  await t('edit lintasan: despike membuang titik lonjakan, smoothEle meredam derau, reverse membalik', () => {
    const sp = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.0001 }, { lat: 0.05, lng: 0.0002 }, { lat: 0, lng: 0.0003 }, { lat: 0, lng: 0.0004 }]; const c = Gpx.despike(sp); assert.strictEqual(c.length, 4); assert.ok(!c.some((p) => p.lat === 0.05));
    const noisy = [100, 130, 100, 130, 100].map((e, i) => ({ lat: 0, lng: i * 1e-4, ele: e })); const sm = Gpx.smoothEle(noisy, 5); assert.ok(Math.max(...sm.map((p) => p.ele)) - Math.min(...sm.map((p) => p.ele)) < 20);
    const r = Gpx.reverse(sp); assert.strictEqual(r[0].lng, 0.0004); assert.strictEqual(sp[0].lng, 0, 'tidak mengubah asli');
  });
  await t('filter perekaman GPS: tolak akurasi buruk, titik terlalu dekat, dan lonjakan kecepatan', () => {
    assert.deepStrictEqual(Gpx.accept(null, { lat: 1, lng: 1, acc: 10 }), { ok: true }); assert.strictEqual(Gpx.accept(null, { lat: 1, lng: 1, acc: 80 }).reason, 'akurasi');
    const last = { lat: 0, lng: 0, t: 0 }; assert.strictEqual(Gpx.accept(last, { lat: 0, lng: 0.00002, acc: 5, t: 5000 }).reason, 'dekat'); assert.strictEqual(Gpx.accept(last, { lat: 0, lng: 0.01, acc: 5, t: 1000 }).reason, 'lonjakan');
    assert.strictEqual(Gpx.accept(last, { lat: 0, lng: 0.0003, acc: 5, t: 30000 }).ok, true); assert.strictEqual(Gpx.accept(last, { lat: 999, lng: 0, acc: 5 }).reason, 'koordinat');
  });
  await t('grafik: rute & profil berisi path valid, sumbu tidak NaN, lintasan 2 titik & tanpa elevasi tetap aman', () => {
    const ch = Gpx.chart(Gpx.simplify(synth(), 300)); assert.ok(/^M[\d.\-]+ [\d.\-]+L/.test(ch.route.d) && !/NaN|Infinity/.test(ch.route.d + ch.profile.d)); assert.ok(ch.profile.area.endsWith('Z'));
    const two = Gpx.chart([{ lat: 1, lng: 1, ele: 5 }, { lat: 1, lng: 1, ele: 5 }]); assert.ok(!/NaN|Infinity/.test(two.route.d + two.profile.d), 'titik identik');
    assert.strictEqual(Gpx.chart(synth(50, { noEle: true })).profile, null);
  });
  await t('ringkasan lintasan di data/trails.json divalidasi', () => {
    const ok = { pts: 500, dist: 8412, gain: 1160, loss: 1100, min: 1500, max: 2665, dl: false }; assert.deepStrictEqual(V.trail({ ...D.trails[0], track: ok }, { site: D.site }).track, ok);
    assert.ok(!('track' in V.trail({ ...D.trails[0], track: null }, { site: D.site })), 'tanpa lintasan → tidak ada kunci track');
    for (const bad of [{ pts: 1 }, { ...ok, dist: -1 }, { ...ok, gain: 1.5 }, 'x', [1]]) assert.ok(throwsFields(() => V.trail({ ...D.trails[0], track: bad }, { site: D.site })).track);
  });
  await t('integritas: setiap jejak ber-track punya data/tracks/<id>.json yang valid dan sesuai ringkasannya; tidak ada berkas yatim', () => {
    const dir = path.join(root, 'data', 'tracks'); const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    for (const tr of D.trails) if (tr.track) { const f = path.join(dir, tr.id + '.json'); assert.ok(fs.existsSync(f), `lintasan jejak ${tr.id} hilang`); const pts = Gpx.parseTrack(fs.readFileSync(f, 'utf8')); assert.strictEqual(pts.length, tr.track.pts); assert.strictEqual(Math.round(Gpx.analyze(pts).dist), tr.track.dist, 'jarak ringkasan tidak sinkron'); assert.strictEqual(Gpx.analyze(pts).gain, tr.track.gain, 'naik tidak sinkron'); }
    for (const f of files) assert.ok(D.trails.some((tr) => tr.track && `${tr.id}.json` === f), `berkas yatim: ${f}`);
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
  await t('commit berkas lintasan bersarang + hapus dalam satu commit (data/tracks/<id>.json)', async () => {
    await Gh.connect(cfg); const pts = Gpx.simplify(synth(), 200);
    const sha = await Gh.commit({ message: 'Tambah jejak: uji', files: [{ path: 'data/tracks/99.json', text: Gpx.serialize(pts) }] }); assert.ok(sha);
    assert.strictEqual(Gpx.parseTrack(await Gh.readText('data/tracks/99.json')).length, pts.length); assert.deepStrictEqual((await Gh.list('data/tracks')).map((f) => f.name), ['99.json']);
    await Gh.commit({ message: 'Hapus', files: [{ path: 'data/tracks/99.json', remove: true }] }); assert.deepStrictEqual(await Gh.list('data/tracks'), [], 'folder kosong setelah hapus');
  });
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
    for (const f of ['app.js', 'ui.js', 'github.js', 'track.js']) {
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
