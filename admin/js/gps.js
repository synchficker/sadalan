/* GpsUI — antarmuka fitur GPS panel admin: field "Rute GPS" di formulir jejak, perekam, penyunting rute, impor/ekspor GPX, draf rekaman.
   Semua teks dari berkas GPX dimasukkan lewat textContent/properti DOM (bukan innerHTML). */
const GpsUI = (() => {
  'use strict';
  const { h, icon, toast, confirmBox, drawer, overlay } = UI;
  let app = null; // { editTrail(t, opts), trails() } dipasang oleh app.js
  const setup = (a) => { app = a; };

  /* ================= berkas ================= */
  function download(name, text, type = 'application/gpx+xml') {
    const url = URL.createObjectURL(new Blob([text], { type })), a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const gpxName = (n) => (Schema.slugify(n) || 'jejak') + '.gpx';
  const exportGpx = (name, segs, desc) => { download(gpxName(name), Geo.toGpx({ name: name || 'Jejak Sadalan', desc, segs })); toast('Berkas GPX diunduh.'); };
  const pickFile = (accept) => new Promise((ok) => {
    const i = h('input', { type: 'file', accept, hidden: true }); document.body.append(i);
    i.addEventListener('change', () => { ok(i.files[0] || null); i.remove(); }); i.addEventListener('cancel', () => { ok(null); i.remove(); }); i.click();
  });

  /* Membaca berkas GPX → { name, segs (sudah dibersihkan & dibatasi), notes[] } atau melempar Error berpesan Indonesia. */
  async function readGpx(file) {
    if (!file) throw new Error('Tidak ada berkas.');
    if (file.size > 25 * 1024 * 1024) throw new Error('Berkas terlalu besar (maksimal 25 MB).');
    if (!/\.gpx$/i.test(file.name) && !/xml|gpx/i.test(file.type)) throw new Error('Pilih berkas berekstensi .gpx.');
    const g = Geo.parseGpx(await file.text()), notes = [];
    let segs = Geo.clean(g.segs); const before = Geo.count(segs);
    if (!segs.length) throw new Error('Tidak ada titik valid di berkas ini.');
    if (before > Geo.MAX_STORE) { segs = Geo.limit(segs, Geo.MAX_STORE); notes.push(`Titik disederhanakan ${Geo.nf(before)} → ${Geo.nf(Geo.count(segs))} agar ringan disimpan.`); }
    if (g.kind === 'route') notes.push('Berkas berisi rute rencana (tanpa waktu rekam).');
    if (g.skipped) notes.push(`${g.skipped} titik berkoordinat tidak valid dilewati.`);
    if (!segs.flat().some((p) => p[2] != null)) notes.push('Tidak ada data ketinggian di berkas ini.');
    return { name: g.name, segs, notes };
  }

  const statLine = (s) => [`${Geo.nf(s.pts)} titik`, Geo.fmtKm(s.km), s.hasEle ? `naik ${Geo.fmtM(s.gain)} · turun ${Geo.fmtM(s.loss)}` : null, s.hasEle ? `tertinggi ${Geo.fmtElev(s.max)}` : null, s.hasTime ? Geo.fmtDur(s.secs) : null].filter(Boolean).join(' · ');
  const fmtDay = (ms) => new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  /* ================= field "Rute GPS" di formulir jejak ================= */
  function trackField(spec, value, deps, k) {
    value = value || {};
    let cur = value.segs || null, loading = !!(value.path && !cur), loadErr = '', state = value.segs ? { op: 'set', segs: value.segs, draftId: value.draftId } : { op: 'keep' };
    const box = h('div.trk-box'), f = k.wrapField(spec, box);
    const nameNow = () => { const n = deps.field('name'); return (n && n.get().trim()) || 'Jejak Sadalan'; };

    function applyToFields(overwrite) {
      const s = Geo.stats(cur), put = (key, v) => { const fl = deps.field(key); if (fl && fl.set && (overwrite || !String(fl.get()).trim())) fl.set(v); };
      put('dist', Geo.fmtKm(s.km)); if (s.hasEle) put('elev', Geo.fmtElev(s.max));
      put('time', s.hasTime ? Geo.fmtDur(s.secs) : '≈ ' + Geo.fmtDur(Geo.estimateSecs(s.km, s.gain)));
      if (s.start) { put('lat', s.start[0].toFixed(5)); put('lng', s.start[1].toFixed(5)); }
    }
    const changed = () => box.dispatchEvent(new Event('input', { bubbles: true }));
    function setTrack(segs, extra = {}) {
      cur = segs; loading = false; loadErr = ''; state = { op: 'set', segs, draftId: extra.draftId || state.draftId };
      render(); applyToFields(false); changed();
    }
    const btn = (label, ic, fn, cls = 'ghost') => h('button.btn.' + cls + '.sm', { type: 'button', on: { click: fn } }, icon(ic, 15), label);

    async function doImport() {
      const file = await pickFile('.gpx,application/gpx+xml,application/xml,text/xml'); if (!file) return;
      try {
        const r = await readGpx(file);
        if (cur && !(await confirmBox({ title: 'Ganti rute GPS?', text: 'Rute yang ada akan diganti oleh isi berkas GPX ini setelah Anda menyimpan jejak.', ok: 'Ganti' }))) return;
        setTrack(r.segs); const nm = deps.field('name'); if (nm && !nm.get().trim() && r.name) nm.set(r.name.slice(0, 80));
        toast(`GPX dibaca: ${statLine(Geo.stats(r.segs))}.${r.notes.length ? ' ' + r.notes.join(' ') : ''}`, 'ok', 7000);
      } catch (e) { toast(e.message || 'Gagal membaca GPX.', 'err', 7000); }
    }
    async function doRecord() {
      if (cur && !(await confirmBox({ title: 'Rekam ulang?', text: 'Hasil rekaman akan menggantikan rute yang ada setelah Anda menyimpan jejak.', ok: 'Lanjut merekam' }))) return;
      openRecorder({ alive: () => document.contains(box), onFinish: (rec) => { setTrack(rec.segs, { draftId: rec.id }); toast('Rekaman dipasang di formulir. Simpan jejak untuk menerbitkannya.'); } });
    }
    async function doClear() {
      if (!(await confirmBox({ title: 'Hapus rute GPS?', text: 'Rute akan dihapus dari jejak ini setelah Anda menyimpan.', ok: 'Hapus rute', danger: true }))) return;
      cur = null; state = value.path ? { op: 'clear' } : { op: 'keep' }; render(); changed();
    }

    function render() {
      const kids = [];
      if (loading) kids.push(h('p.trk-stats', 'Memuat rute…'));
      else if (cur) {
        const s = Geo.stats(cur);
        kids.push(h('div.trk-prev-wrap', TrackMap.preview(cur)), h('p.trk-stats', statLine(s)));
        if (state.op === 'set') kids.push(h('p.trk-new', icon('info', 14), value.path ? 'Rute baru — akan menggantikan rute lama saat disimpan.' : 'Rute baru — diterbitkan saat Anda menyimpan jejak.'));
      } else kids.push(h('p.trk-stats.muted', loadErr || 'Belum ada rute GPS. Rekam langsung di lapangan atau impor berkas GPX.'));
      const row = [btn('Rekam', 'rec', doRecord, 'primary'), btn('Impor GPX', 'upload', doImport)];
      if (cur) row.push(btn('Edit rute', 'scissors', () => openEditor({ segs: cur, title: nameNow(), onDone: (segs) => setTrack(segs) })), btn('Ekspor GPX', 'download', () => exportGpx(nameNow(), cur)), btn('Isi otomatis', 'refresh', () => { applyToFields(true); toast('Jarak, ketinggian, waktu, dan koordinat diisi dari rute.'); }), btn('Hapus rute', 'trash', doClear, 'danger.ghost'));
      else if (value.path && state.op !== 'clear') row.push(btn('Muat ulang', 'refresh', load));
      kids.push(h('div.trk-btns', row));
      box.replaceChildren(...kids);
    }
    function load() {
      loading = true; loadErr = ''; render();
      deps.loadTrack(value.path).then((segs) => { cur = segs; loading = false; render(); }).catch((e) => { loading = false; loadErr = 'Rute tidak bisa dimuat: ' + (e.message || 'kesalahan'); render(); });
    }
    render(); if (loading) load();
    if (cur && value.segs) applyToFields(false); // rute dipasang dari rekaman/impor saat formulir dibuka → isi kolom yang masih kosong
    f.get = () => state;
    return f;
  }

  /* Rute jalan kaki OSM (FOSSGIS, gratis) untuk mengisi celah data mengikuti jalan/jalur yang ada. */
  async function routeFoot(a, b) {
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`, ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal, referrerPolicy: 'origin' }); if (!r.ok) throw new Error('layanan rute membalas ' + r.status);
      const j = await r.json(), rt = j.routes && j.routes[0]; if (j.code !== 'Ok' || !rt) throw new Error('tidak ada rute jalan kaki');
      return { pts: rt.geometry.coordinates.map((c) => [c[1], c[0]]), dist: rt.distance };
    } finally { clearTimeout(to); }
  }
  const gapText = (g, m, secs) => `${g} jeda data (≈ ${Geo.fmtM(m)} tanpa titik${secs ? ', ' + Geo.fmtDur(secs) : ''})`;

  /* ================= perekam ================= */
  let recUI = null, recCtx = null, pill = null, pillOff = null;
  const SIG = { none: 'Mencari sinyal GPS…', good: 'GPS baik', weak: 'Sinyal lemah', lost: 'Sinyal hilang', denied: 'Izin lokasi ditolak', jump: 'Lonjakan diabaikan' };

  function openRecorder(ctx = {}) {
    if (ctx.onFinish) recCtx = ctx; else if (!recCtx) recCtx = {};
    if (recUI) return;
    const sup = Tracker.supported(); let follow = true, pre = null, preId = null, zoomed = false;
    const stat = (label) => { const v = h('b', '—'); return { v, el: h('div.rec-stat', v, h('span', label)) }; };
    const S = { time: stat('Waktu'), dist: stat('Jarak'), speed: stat('Kec. rata-rata'), gain: stat('Naik'), alt: stat('Ketinggian'), pts: stat('Titik') };
    const chip = h('span.rec-chip', { 'aria-live': 'polite' }), msg = h('div.rec-msg');
    const mapEl = h('div.rec-map'), locate = h('button.tm-btn.tm-locate', { type: 'button', 'aria-label': 'Pusatkan peta ke posisi saya', hidden: true, on: { click: () => { follow = true; locate.hidden = true; update(Tracker.getState()); } } }, icon('target', 18));
    const body = h('div.rec-wrap', mapEl, h('div.rec-panel', chip, h('div.rec-grid', Object.values(S).map((x) => x.el)), msg, settings()));

    const bar = h('div.rec-bar');
    const ov = overlay({
      title: 'Rekam jejak', label: 'Perekam jejak GPS', body, footer: bar,
      left: h('button.btn.ghost.sm', { type: 'button', on: { click: minimize } }, icon('down', 15), 'Minimalkan'), right: null,
    });
    const map = new TrackMap(mapEl, { zoom: 4, label: 'Peta posisi dan rute rekaman', onPan: () => { follow = false; locate.hidden = false; },
      onDraw: (c, m) => {
        const s = Tracker.getState(); s.segs.forEach((sg) => m.line(sg, { color: '#d97745', width: 4 })); Geo.bridges(s.segs.filter((g) => g.length)).forEach((b) => m.dash(b.from, b.to));
        const f = s.lastFix || pre; if (f) { if (f.acc) m.ring(f.lat, f.lng, f.acc); m.dot(f.lat, f.lng, { r: 7, fill: '#1f6feb' }); }
        const first = s.segs[0] && s.segs[0][0]; if (first) m.dot(first[0], first[1], { r: 6, fill: '#3f9b68' });
      } });
    map.setView(-2.5, 118, 4);
    mapEl.append(locate);

    function settings() {
      const P = Tracker.getPrefs();
      const sw = (key, title, desc) => { const i = h('input', { type: 'checkbox', checked: !!P[key], id: 'sw-' + key, on: { change: () => Tracker.setPrefs({ [key]: i.checked }) } }); return h('div.rec-set', h('label.sw', { for: 'sw-' + key }, i, h('span.sw-ui'), h('span.sw-txt', h('b', title), h('small', desc)))); };
      const sel = (key, title, opts, unit) => { const s = h('select', { id: 'sel-' + key, on: { change: () => Tracker.setPrefs({ [key]: Number(s.value) }) } }, opts.map((o) => h('option', { value: o, selected: o === P[key] }, `${o} ${unit}`))); return h('div.rec-set.sel', h('label', { for: 'sel-' + key }, title), s); };
      return h('details.rec-details', h('summary', icon('gear', 15), 'Pengaturan rekam'),
        Tracker.getState().native ? h('div.rec-set', h('b', 'Aplikasi Android: pelacakan latar belakang sungguhan aktif'), h('small.hint', 'Merekam lewat layanan latar depan (notifikasi tetap) — aman saat layar mati atau aplikasi ditutup.')) : sw('bg', 'Mode latar belakang (peramban)', 'Menahan peramban agar tidak membekukan halaman saat layar mati / pindah aplikasi (audio senyap + notifikasi media). Upaya terbaik, bukan jaminan, dan TIDAK jalan bila tab/aplikasi ditutup. Untuk rekaman andal pakai aplikasi Android (lihat README → native).'),
        sw('wake', 'Jaga layar tetap menyala', 'Mencegah layar mati otomatis selama merekam; cara paling andal agar GPS tidak terhenti.'),
        sel('maxAcc', 'Abaikan titik yang akurasinya lebih buruk dari', [20, 30, 50, 100], 'm'),
        sel('minDist', 'Jarak minimal antar titik', [3, 4, 5, 10], 'm'));
    }

    function minimize() { close(); }
    function close() { if (!recUI) return; off(); if (preId != null && navigator.geolocation) navigator.geolocation.clearWatch(preId); map.destroy(); recUI = null; ov.close(); paintPill(Tracker.getState()); }
    recUI = { close };

    const onFinish = async () => {
      const s = Tracker.getState();
      if (s.pts < 2) { if (await confirmBox({ title: 'Buang rekaman?', text: 'Rekaman ini belum punya cukup titik untuk dijadikan rute.', ok: 'Buang', danger: true })) { Tracker.discard(); recCtx = null; close(); } return; }
      if (!(await confirmBox({ title: 'Selesaikan rekaman?', text: `${Geo.fmtKm(s.dist / 1000)} · ${Geo.fmtClock(s.elapsed)}. Rekaman disimpan di perangkat ini sebagai draf sampai Anda menerbitkannya.`, ok: 'Selesai' }))) return;
      const rec = Tracker.stop(); if (!rec) return;
      await Tracker.saveDraft(rec, '');
      const cb = recCtx && recCtx.onFinish && (!recCtx.alive || recCtx.alive()) ? recCtx.onFinish : null; recCtx = null; close();
      if (Geo.count(rec.segs) < 2) { toast('Rekaman terlalu pendek untuk dijadikan rute.', 'err'); Tracker.deleteDraft(rec.id); return; }
      if (cb) cb(rec); else finishFlow(rec);
    };

    function controls(s) {
      const b = (label, ic, fn, cls = 'ghost', dis = false) => h('button.btn.' + cls, { type: 'button', disabled: dis, on: { click: fn } }, icon(ic, 17), label);
      if (s.status === 'idle') return [b('Mulai merekam', 'rec', () => { Tracker.start(); }, 'primary.block', !sup.geo || !sup.secure)];
      if (s.status === 'recording') return [b('Jeda', 'pause', () => Tracker.pause()), b('Selesai', 'stop', onFinish, 'primary')];
      return [b('Lanjut', 'play', () => Tracker.resume(), 'primary'), b('Selesai', 'stop', onFinish)];
    }

    let lastKey = '';
    function update(s) {
      S.time.v.textContent = Geo.fmtClock(s.elapsed); S.dist.v.textContent = Geo.fmtKm(s.dist / 1000);
      S.speed.v.textContent = s.moving > 5 ? Geo.fmtSpeed(s.dist / 1000 / (s.moving / 3600)) : '—';
      S.gain.v.textContent = Geo.fmtM(s.gain); S.pts.v.textContent = Geo.nf(s.pts);
      const lastSeg = s.segs[s.segs.length - 1] || [], lp = lastSeg[lastSeg.length - 1]; S.alt.v.textContent = lp && lp[2] != null ? Geo.fmtElev(lp[2]) : '—';
      const fix = s.lastFix || pre, acc = fix && fix.acc ? ` ±${Math.round(fix.acc)} m` : '';
      const state = s.status === 'idle' ? (pre ? 'Siap' + acc : SIG.none) : s.status === 'paused' ? 'Dijeda' : (SIG[s.signal] || SIG.none) + (s.signal === 'good' || s.signal === 'weak' ? acc : '');
      chip.textContent = (s.status === 'recording' ? '● ' : s.status === 'paused' ? '⏸ ' : '') + state; chip.dataset.s = s.status === 'recording' ? s.signal : s.status;
      const notes = [];
      if (!sup.secure) notes.push(['err', 'Perekaman GPS membutuhkan koneksi aman (HTTPS). Buka panel admin lewat alamat https:// (GitHub Pages) atau localhost.']);
      else if (!sup.geo) notes.push(['err', 'Peramban ini tidak mendukung Geolocation.']);
      if (s.error) notes.push(['err', s.error]); if (s.note) notes.push(['warn', s.note]);
      if (s.status !== 'idle' && s.prefs.bg && !s.bgActive) notes.push(['warn', 'Mode latar belakang belum aktif. Ketuk sakelarnya (Pengaturan rekam) lagi.']);
      if (s.gaps && s.status !== 'idle') notes.push(['warn', `${gapText(s.gaps, s.gapDist, s.gapSecs)}: peramban menahan GPS saat di latar belakang. Garis tidak ditarik lurus (ditandai putus-putus); isi nanti lewat Edit rute → Isi jeda mengikuti jalan.`]);
      if (!Tracker.persistOk()) notes.push(['warn', 'Penyimpanan perangkat diblokir: rekaman tidak bisa dipulihkan bila tab tertutup.']);
      msg.replaceChildren(...notes.map(([t, m]) => h('p.rec-note.' + t, m)));
      const key = s.status + '|' + (sup.geo && sup.secure); if (key !== lastKey) { lastKey = key; bar.replaceChildren(...controls(s)); }
      const f = s.lastFix || pre;
      if (f && follow) { if (!zoomed) { map.setView(f.lat, f.lng, 16); zoomed = true; } else map.setView(f.lat, f.lng); }
      map.redraw();
    }
    const off = Tracker.on(update);
    update(Tracker.getState());
    if (Tracker.getState().status === 'idle' && sup.geo && sup.secure) { // tampilkan posisi & akurasi sebelum mulai
      preId = navigator.geolocation.watchPosition((p) => { pre = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; update(Tracker.getState()); }, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    }
    const st0 = Tracker.getState(); if (st0.segs.some((s) => s.length)) { map.fit(Geo.bounds(st0.segs)); zoomed = true; }
  }

  /* pil kecil “● 00:12:34” di semua halaman admin saat rekaman berjalan */
  function showPill(on) {
    if (!on) { if (pillOff) pillOff(); pillOff = null; if (pill) pill.remove(); pill = null; return; }
    if (pill) return;
    pill = h('button.rec-pill', { type: 'button', hidden: true, 'aria-label': 'Buka perekam jejak', on: { click: () => openRecorder() } });
    document.body.append(pill); pillOff = Tracker.on(paintPill); paintPill(Tracker.getState());
  }
  function paintPill(s) {
    if (!pill) return;
    pill.hidden = s.status === 'idle' || !!recUI;
    pill.textContent = `${s.status === 'recording' ? '●' : '⏸'} ${Geo.fmtClock(s.elapsed)} · ${Geo.fmtKm(s.dist / 1000)}`;
    pill.classList.toggle('paused', s.status === 'paused');
  }

  /* ================= penyunting rute ================= */
  function openEditor({ segs, title, onDone }) {
    const clone = (a) => a.map((s) => s.map((p) => p.slice()));
    let W = clone(segs), hist = [], redo = [], sel = null, A = 0, B = 0, mode = 'move', drag = null, cache = null, dirty = false, busy = false;
    const flat = () => {
      if (cache) return cache; const refs = [], cum = []; let d = 0, offs = [];
      W.forEach((s, si) => { offs.push(refs.length); s.forEach((p, i) => { if (i) d += Geo.dist(s[i - 1], p); refs.push([si, i]); cum.push(d); }); });
      return (cache = { refs, cum, offs, n: refs.length });
    };
    const gIdx = (si, i) => flat().offs[si] + i;
    const at = (g) => { const [si, i] = flat().refs[g]; return W[si][i]; };
    const reset = () => { cache = null; const n = flat().n; if (A > n - 1) A = n - 1; if (B > n - 1 || B < A) B = n - 1; if (A < 0) A = 0; if (sel && !(W[sel.s] && W[sel.s][sel.i])) sel = null; };
    const push = () => { hist.push(clone(W)); if (hist.length > 40) hist.shift(); redo = []; dirty = true; };
    const apply = (fn, full) => { push(); W = fn(W).filter((s) => s.length); cache = null; if (full) { A = 0; B = Math.max(0, flat().n - 1); } reset(); render(); };
    reset(); B = flat().n - 1;

    const infoEl = h('p.ed-info'), selEl = h('p.ed-sel'), chartEl = h('div.ed-chart'), mapEl = h('div.ed-map');
    const rA = h('input', { type: 'range', min: 0, max: 0, step: 1, 'aria-label': 'Titik awal bagian terpilih (A)' }), rB = h('input', { type: 'range', min: 0, max: 0, step: 1, 'aria-label': 'Titik akhir bagian terpilih (B)' });
    const lA = h('span'), lB = h('span');
    rA.addEventListener('input', () => { A = +rA.value; if (B < A) B = A; render(); }); rB.addEventListener('input', () => { B = +rB.value; if (A > B) A = B; render(); });
    const tools = h('div.ed-tools', { role: 'toolbar', 'aria-label': 'Alat penyunting rute' });
    const body = h('div.ed-wrap', mapEl, h('div.ed-panel', infoEl, chartEl, h('div.ed-range', h('label', h('b.ra', 'A'), rA, lA), h('label', h('b.rb', 'B'), rB, lB)), selEl, tools));

    const done = h('button.btn.primary', { type: 'button' }, 'Selesai'), cancel = h('button.btn.ghost', { type: 'button' }, 'Batal');
    const ov = overlay({ title: 'Edit rute', label: 'Penyunting rute', body, footer: [h('span.ed-title', title || ''), h('span.sp'), cancel, done] });

    const map = new TrackMap(mapEl, { zoom: 12, label: 'Peta penyunting rute',
      onDown: (p) => { if (mode !== 'move' || !sel) return false; const [x, y] = map.project(W[sel.s][sel.i][0], W[sel.s][sel.i][1]); if (Math.hypot(x - p.x, y - p.y) > 26) return false; drag = { snap: clone(W), moved: false }; return true; },
      onMove: (p) => { if (!drag || !sel) return; const [lat, lng] = map.unproject(p.x, p.y), q = W[sel.s][sel.i]; q[0] = Math.round(lat * 1e5) / 1e5; q[1] = Math.round(lng * 1e5) / 1e5; drag.moved = true; cache = null; map.redraw(); },
      onUp: () => { if (drag && drag.moved) { hist.push(drag.snap); if (hist.length > 40) hist.shift(); redo = []; dirty = true; render(); } drag = null; },
      onTap: (ll, p) => {
        if (mode === 'add') { addAt(ll, p); return; }
        let best = null, bd = 24; W.forEach((s, si) => s.forEach((q, i) => { const [x, y] = map.project(q[0], q[1]), d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = { s: si, i }; } }));
        sel = best; render();
      },
      onDraw: (c, m) => {
        const { offs } = flat();
        W.forEach((s, si) => { m.line(s, { color: '#8aa59a', width: 4 }); const o = offs[si], a = Math.max(0, A - o), b = Math.min(s.length - 1, B - o); if (b > a) m.line(s, { color: '#d97745', width: 5, from: a, to: b }); });
        if (m.z >= 15) W.forEach((s) => s.forEach((q) => { const [x, y] = m.project(q[0], q[1]); if (x > -8 && y > -8 && x < m.w + 8 && y < m.h + 8) { c.beginPath(); c.arc(x, y, 3, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#23594b'; c.stroke(); } }));
        Geo.bridges(W).forEach((b) => m.dash(b.from, b.to));
        const n = flat().n; if (n) { const a = at(A), b = at(B); m.dot(a[0], a[1], { r: 9, fill: '#3f9b68', label: 'A' }); m.dot(b[0], b[1], { r: 9, fill: '#bd5145', label: 'B' }); }
        if (sel && W[sel.s] && W[sel.s][sel.i]) { const q = W[sel.s][sel.i]; m.dot(q[0], q[1], { r: 8, fill: '#1f6feb' }); }
      } });
    map.fit(Geo.bounds(W));

    function addAt(ll, p) { // sisipkan titik di ruas terdekat dari ketukan
      let best = null, bd = 40;
      W.forEach((s, si) => { for (let i = 1; i < s.length; i++) {
        const [x1, y1] = map.project(s[i - 1][0], s[i - 1][1]), [x2, y2] = map.project(s[i][0], s[i][1]), dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / L2)), d = Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
        if (d < bd) { bd = d; best = { si, i, t }; }
      } });
      if (!best) { toast('Ketuk dekat garis rute untuk menyisipkan titik.', 'err'); return; }
      push(); const s = W[best.si], a = s[best.i - 1], b = s[best.i], lerp = (u, v) => (u == null || v == null ? null : Math.round(u + (v - u) * best.t));
      s.splice(best.i, 0, [Math.round(ll[0] * 1e5) / 1e5, Math.round(ll[1] * 1e5) / 1e5, lerp(a[2], b[2]), lerp(a[3], b[3])]);
      sel = { s: best.si, i: best.i }; reset(); render();
    }

    /* Isi celah antar segmen dengan rute jalan kaki OSM (celah ≤ 2 km; rute tak wajar dilewati). Titik hasil rute diberi waktu/ketinggian hasil interpolasi. */
    async function fillGaps() {
      const br = Geo.bridges(W).filter((b) => b.dist <= 2000); if (!br.length) { toast('Tidak ada celah ≤ 2 km yang bisa diisi.', 'err'); return; }
      busy = true; render();
      const out = [W[0].slice()]; let ok = 0, skip = 0, fail = '';
      for (let i = 1; i < W.length; i++) {
        const a = out[out.length - 1][out[out.length - 1].length - 1], b = W[i][0], d = Geo.dist(a, b); let joined = false;
        if (d > 15 && d <= 2000) {
          toast(`Mengisi jeda ${Geo.nf(ok + skip + 1)} dari ${Geo.nf(br.length)}…`);
          try {
            const r = await routeFoot(a, b);
            if (r.dist > Math.max(250, d * 2.2)) skip++; // rute jalan jauh lebih panjang dari garis lurus → kemungkinan bukan jalur yang Anda tempuh
            else {
              let pts = Geo.simplify([r.pts], 2)[0]; let cum = 0; const tot = r.dist || 1, mids = [];
              for (let k = 1; k < pts.length - 1; k++) { cum += Geo.dist(pts[k - 1], pts[k]); const f = Math.min(1, cum / tot), lerp = (u, v) => (u == null || v == null ? null : Math.round(u + (v - u) * f)); mids.push([Math.round(pts[k][0] * 1e5) / 1e5, Math.round(pts[k][1] * 1e5) / 1e5, lerp(a[2], b[2]), lerp(a[3], b[3])]); }
              out[out.length - 1].push(...mids, ...W[i]); joined = true; ok++;
            }
          } catch (e) { fail = e.name === 'AbortError' ? 'waktu habis' : (e.message || 'gagal'); skip++; }
        } else if (d <= 15) { out[out.length - 1].push(...W[i]); joined = true; }
        if (!joined) out.push(W[i].slice());
      }
      busy = false;
      if (ok || out.length < W.length) { push(); W = out; reset(); }
      render();
      toast(ok ? `${Geo.nf(ok)} jeda diisi mengikuti jalan${skip ? `, ${skip} dilewati` : ''}. Periksa hasilnya di peta; urungkan bila tidak sesuai.` : `Tidak ada jeda yang terisi${fail ? ' (' + fail + ')' : ''}. Cek koneksi internet atau gunakan Gabung segmen / Tambah titik.`, ok ? 'ok' : 'err', 8000);
    }
    const cut = (a, b) => (W0) => { const out = []; let o = 0; for (const s of W0) { const left = s.slice(0, Math.max(0, a - o)), right = s.slice(Math.max(0, b - o + 1)); if (b - o < 0 || a - o > s.length - 1) out.push(s); else { if (left.length) out.push(left); if (right.length) out.push(right); } o += s.length; } return out; };
    const keep = (a, b) => (W0) => { const out = []; let o = 0; for (const s of W0) { const part = s.slice(Math.max(0, a - o), Math.max(0, b - o + 1)); if (part.length) out.push(part); o += s.length; } return out; };
    const tool = (label, ic, fn, { dis = false, on = false } = {}) => h('button.ed-tool' + (on ? '.on' : ''), { type: 'button', disabled: dis, 'aria-pressed': on ? 'true' : null, on: { click: fn } }, icon(ic, 18), h('span', label));

    function undo() { if (!hist.length) return; redo.push(clone(W)); W = hist.pop(); reset(); render(); }
    function redoFn() { if (!redo.length) return; hist.push(clone(W)); W = redo.pop(); reset(); render(); }

    function render() {
      const fl = flat(), s = Geo.stats(W), n = fl.n, inRange = B - A + 1;
      infoEl.textContent = statLine(s) + (W.length > 1 ? ` · ${W.length} segmen (${Geo.bridges(W).length} celah putus-putus)` : '');
      rA.max = rB.max = Math.max(0, n - 1); rA.value = A; rB.value = B;
      lA.textContent = `${Geo.nf(A + 1)} · ${Geo.fmtKm(fl.cum[A] / 1000)}`; lB.textContent = `${Geo.nf(B + 1)} · ${Geo.fmtKm(fl.cum[B] / 1000)}`;
      selEl.textContent = sel && W[sel.s] && W[sel.s][sel.i] ? `Titik ${Geo.nf(gIdx(sel.s, sel.i) + 1)} dipilih — seret untuk menggeser. Bagian terpilih: ${Geo.nf(inRange)} titik (${Geo.fmtKm((fl.cum[B] - fl.cum[A]) / 1000)}).` : `Bagian terpilih A–B: ${Geo.nf(inRange)} titik (${Geo.fmtKm((fl.cum[B] - fl.cum[A]) / 1000)}). Ketuk sebuah titik di peta untuk memilihnya.`;
      const all = inRange === n;
      tools.replaceChildren(
        tool('Urungkan', 'undo', undo, { dis: !hist.length }), tool('Ulangi', 'redo', redoFn, { dis: !redo.length }),
        sel ? tool('Titik → A', 'flag', () => { A = Math.min(gIdx(sel.s, sel.i), B); render(); }) : null, sel ? tool('Titik → B', 'flag', () => { B = Math.max(gIdx(sel.s, sel.i), A); render(); }) : null,
        tool('Pangkas ke A–B', 'scissors', () => apply(keep(A, B), true), { dis: all }),
        tool('Hapus bagian A–B', 'trash', async () => { if (all) { toast('Seluruh rute tidak bisa dihapus; gunakan Batal.', 'err'); return; } apply(cut(A, B), true); }, { dis: all }),
        sel ? tool('Hapus titik', 'x', () => { if (flat().n <= 2) { toast('Rute butuh minimal 2 titik.', 'err'); return; } const q = sel; sel = null; apply((W0) => { W0[q.s].splice(q.i, 1); return W0; }); }) : null,
        tool(mode === 'add' ? 'Mode tambah: aktif' : 'Tambah titik', 'plusc', () => { mode = mode === 'add' ? 'move' : 'add'; if (mode === 'add') toast('Ketuk dekat garis rute untuk menyisipkan titik baru.'); render(); }, { on: mode === 'add' }),
        tool('Balik arah', 'flip', () => { toast('Arah dibalik; data waktu dihapus karena urutannya berubah.'); apply((W0) => W0.map((sg) => sg.map((p) => [p[0], p[1], p[2], null]).reverse()).reverse()); }),
        Geo.bridges(W).length ? tool('Isi jeda (ikuti jalan)', 'route', fillGaps, { dis: busy }) : null,
        W.length > 1 ? tool('Gabung segmen', 'merge', () => apply((W0) => [W0.flat()])) : null,
        (() => { const sl = h('select.ed-simp', { 'aria-label': 'Sederhanakan rute', on: { change: () => { const tol = +sl.value; if (!tol) return; const b4 = flat().n; push(); W = Geo.simplify(W, tol); reset(); render(); toast(`Disederhanakan ${Geo.nf(b4)} → ${Geo.nf(flat().n)} titik.`); } } }, h('option', { value: 0 }, 'Sederhanakan…'), [['2', 'Ringan (2 m)'], ['5', 'Sedang (5 m)'], ['10', 'Kuat (10 m)']].map(([v, l]) => h('option', { value: v }, l))); return sl; })());
      const pr = Geo.profilePath(Geo.profile(W, 100), 320, 64);
      if (pr) { const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 320 64'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Profil ketinggian ${Geo.fmtElev(pr.min)} sampai ${Geo.fmtElev(pr.max)}`);
        const mk = (d, fill, stroke) => { const e = document.createElementNS(NS, 'path'); e.setAttribute('d', d); e.setAttribute('fill', fill); e.setAttribute('stroke', stroke); e.setAttribute('stroke-width', '1.5'); return e; };
        svg.append(mk(pr.area, 'rgba(35,89,75,.14)', 'none'), mk(pr.line, 'none', '#23594b'));
        const total = fl.cum[n - 1] || 1; [[A, '#3f9b68'], [B, '#bd5145']].forEach(([g, col]) => { const x = 6 + (fl.cum[g] / total) * 308, ln = document.createElementNS(NS, 'line'); ln.setAttribute('x1', x); ln.setAttribute('x2', x); ln.setAttribute('y1', 0); ln.setAttribute('y2', 64); ln.setAttribute('stroke', col); ln.setAttribute('stroke-width', '2'); svg.append(ln); });
        chartEl.replaceChildren(svg, h('small', `${Geo.fmtElev(pr.min)} – ${Geo.fmtElev(pr.max)}`)); } else chartEl.replaceChildren(h('small', 'Rute ini tidak memiliki data ketinggian.'));
      map.redraw();
    }
    render();

    const close = () => { map.destroy(); ov.close(); };
    cancel.addEventListener('click', async () => { if (dirty && !(await confirmBox({ title: 'Buang perubahan rute?', text: 'Perubahan pada rute belum diterapkan.', ok: 'Buang', danger: true }))) return; close(); });
    done.addEventListener('click', () => { const out = Geo.clean(W); if (Geo.count(out) < 2) { toast('Rute butuh minimal 2 titik.', 'err'); return; } close(); onDone(out); });
  }

  /* ================= alur setelah rekaman / draf ================= */
  function finishFlow(rec) {
    let name = rec.name || `Rekaman ${new Date(rec.startedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const wrap = h('div.fin'), d = drawer({ title: 'Rekaman selesai', subtitle: 'Pilih apa yang dilakukan dengan rute ini', body: wrap });
    const row = (ic, title, desc, fn, danger) => h('button.menu-row' + (danger ? '.danger' : ''), { type: 'button', on: { click: fn } }, h('span.menu-ic', icon(ic, 20)), h('span.menu-txt', h('b', title), h('small', desc)), h('span.chev', icon('right', 16)));
    function paint() {
      const s = Geo.stats(rec.segs), nameIn = h('input', { value: name, 'aria-label': 'Nama rekaman', maxlength: 80, on: { input: () => { name = nameIn.value; } } });
      const pick = h('select', { 'aria-label': 'Pilih jejak' }, h('option', { value: '' }, 'Pilih jejak…'), [...app.trails()].sort((a, b) => a.name.localeCompare(b.name)).map((t) => h('option', { value: t.id }, t.name + (t.track ? ' (sudah punya rute)' : ''))));
      const pickRow = h('div.fin-pick', { hidden: true }, pick, h('button.btn.primary.sm', { type: 'button', on: { click: () => { const t = app.trails().find((x) => String(x.id) === pick.value); if (!t) { toast('Pilih jejaknya dulu.', 'err'); return; } d.close(); app.editTrail(t, { track: { segs: rec.segs }, draftId: rec.id }); } } }, 'Lanjut'));
      wrap.replaceChildren(h('div.trk-prev-wrap', TrackMap.preview(rec.segs)), h('p.trk-stats', statLine(s)), Geo.bridges(rec.segs).length ? h('p.rec-note.warn', `Rute punya ${Geo.bridges(rec.segs).length} celah data (peramban menahan GPS di latar belakang). Buka Edit rute → Isi jeda (ikuti jalan) untuk melengkapinya mengikuti jalur yang ada.`) : null, h('label.fin-name', 'Nama', nameIn),
        h('div.menu-list',
          row('trail', 'Jadikan jejak baru', 'Buka formulir jejak dengan rute ini', () => { d.close(); app.editTrail(null, { track: { segs: rec.segs, name }, draftId: rec.id }); }),
          row('edit', 'Tambahkan ke jejak yang ada', 'Pasang sebagai rute jejak yang sudah ada', () => { pickRow.hidden = !pickRow.hidden; }), pickRow,
          row('scissors', 'Edit / pangkas rute', 'Buang bagian awal-akhir, geser atau hapus titik', () => openEditor({ segs: rec.segs, title: name, onDone: async (segs) => { rec.segs = segs; await Tracker.saveDraft(rec, name); paint(); toast('Perubahan rute disimpan di draf.'); } })),
          row('download', 'Ekspor GPX', 'Unduh berkas .gpx untuk aplikasi lain', () => exportGpx(name, rec.segs)),
          row('info', 'Simpan di perangkat saja', 'Draf tetap ada di daftar Jejak sampai diterbitkan', async () => { await Tracker.saveDraft(rec, name); d.close(); toast('Draf tersimpan di perangkat ini.'); }),
          row('trash', 'Buang rekaman', 'Hapus draf ini dari perangkat', async () => { if (await confirmBox({ title: 'Buang rekaman?', text: 'Rekaman akan dihapus permanen dari perangkat ini.', ok: 'Buang', danger: true })) { await Tracker.deleteDraft(rec.id); d.close(); toast('Rekaman dibuang.'); } }, true)));
    }
    paint();
  }

  /* panel draf rekaman di halaman Jejak */
  function draftsPanel() {
    const el = h('div.panel.drafts', { hidden: true });
    async function paint() {
      let list = []; try { list = await Tracker.drafts(); } catch { /* abaikan */ }
      el.hidden = !list.length; if (!list.length) return;
      el.replaceChildren(h('h3.panel-title', icon('rec', 18), 'Rekaman di perangkat ini'), h('p.hint', 'Belum diterbitkan ke situs. Tersimpan di peramban ini saja.'),
        h('div.cards', list.map((d) => h('div.item', h('button.item-main', { type: 'button', 'aria-label': 'Buka rekaman ' + (d.name || fmtDay(d.startedAt)), on: { click: async () => { const full = await Tracker.getDraft(d.id); if (full) finishFlow(full); } } },
          h('span.item-thumb', icon('route', 24)), h('span.item-body', h('span.item-title', d.name || 'Rekaman ' + fmtDay(d.startedAt)), h('span.item-sub', fmtDay(d.startedAt)), h('span.item-tags', statLine(d.stats)))),
          h('button.icon-btn.sm.danger', { type: 'button', 'aria-label': 'Buang rekaman', title: 'Buang', on: { click: async () => { if (await confirmBox({ title: 'Buang rekaman?', text: 'Rekaman akan dihapus permanen dari perangkat ini.', ok: 'Buang', danger: true })) { await Tracker.deleteDraft(d.id); paint(); } } } }, icon('trash', 16))))));
    }
    paint(); return el;
  }

  /* impor GPX langsung menjadi jejak baru */
  async function importNew() {
    const file = await pickFile('.gpx,application/gpx+xml,application/xml,text/xml'); if (!file) return;
    try { const r = await readGpx(file); app.editTrail(null, { track: { segs: r.segs, name: r.name } }); toast(`GPX dibaca: ${statLine(Geo.stats(r.segs))}.${r.notes.length ? ' ' + r.notes.join(' ') : ''}`, 'ok', 7000); }
    catch (e) { toast(e.message || 'Gagal membaca GPX.', 'err', 7000); }
  }

  /* pulihkan rekaman yang terputus (tab tertutup / baterai habis) */
  async function recover() {
    const s = await Tracker.recover(); if (!s) return;
    const st = Geo.stats(s.segs), body = h('div', h('p', `Ada rekaman yang belum selesai: ${statLine(st)}, dimulai ${fmtDay(s.startedAt)}.`), h('p.hint', 'Aplikasi sempat tertutup saat merekam. Lanjutkan akan memulai segmen baru; titik di jeda itu dihubungkan garis lurus.'));
    const d = drawer({ title: 'Rekaman belum selesai', subtitle: 'Ditemukan di perangkat ini', body, footer: [
      h('button.btn.danger.ghost', { type: 'button', on: { click: async () => { if (await confirmBox({ title: 'Buang rekaman?', text: 'Rekaman akan dihapus permanen.', ok: 'Buang', danger: true })) { await Tracker.dropSaved(); d.close(); } } } }, 'Buang'),
      h('span.sp'),
      h('button.btn.ghost', { type: 'button', on: { click: async () => { Tracker.adopt(s); const rec = Tracker.stop(); if (rec) { await Tracker.saveDraft(rec, ''); toast('Disimpan sebagai draf di perangkat.'); } d.close(); } } }, 'Jadikan draf'),
      h('button.btn.primary', { type: 'button', on: { click: () => { d.close(); Tracker.adopt(s); openRecorder(); } } }, 'Buka perekam')] });
  }

  const teardown = () => { if (recUI) recUI.close(); showPill(false); };

  return { setup, teardown, trackField, openRecorder, openEditor, finishFlow, draftsPanel, importNew, recover, showPill, exportGpx, readGpx };
})();
