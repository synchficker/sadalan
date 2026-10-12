/* Track — lintasan GPS jejak di Panel Admin: pratinjau, impor/ekspor GPX, edit titik, dan perekam GPS.
   Memakai Gpx (assets/js/gpx.js) untuk semua perhitungan. Semua teks dari file/pengguna masuk lewat DOM (tanpa innerHTML). */
const Track = (() => {
  const { h, svg, icon, toast, confirmBox, drawer } = UI;
  const REC_KEY = 'sadalan-rec-v1';

  /* ---------- util ---------- */
  function download(name, text, type = 'application/gpx+xml') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  const summaryStats = (s) => ({ count: s.pts, dist: s.dist, gain: s.gain, loss: s.loss, max: s.max, hasEle: s.max != null });
  const statGrid = (a) => h('dl.trk-stats', [['Jarak', Gpx.fmtDist(a.dist)], ['Naik', a.hasEle ? '+' + Gpx.fmtM(a.gain) : '–'], ['Turun', a.hasEle ? '−' + Gpx.fmtM(a.loss) : '–'], ['Tertinggi', a.max != null ? Gpx.fmtElev(a.max) : '–'], ['Titik', String(a.count)]]
    .map(([k, v]) => h('div', h('dt', k), h('dd', v))));

  /* Gambar rute (peta mini) + profil elevasi. cursor = indeks titik yang ditandai (opsional). */
  function drawing(points, cursor = null) {
    const ch = Gpx.chart(points, { w: 320, h: 190, ph: 96 });
    const dot = (xy, cls, r) => svg('circle', { cx: xy[0], cy: xy[1], r, class: cls });
    const rs = ch.route.xy, last = rs.length - 1;
    const route = svg('svg', { viewBox: `0 0 ${ch.route.w} ${ch.route.h}`, class: 'trk-route', role: 'img', 'aria-label': 'Peta mini lintasan' },
      svg('title', {}, 'Peta mini lintasan'), svg('path', { d: ch.route.d, class: 'trk-line' }), dot(rs[0], 'trk-start', 5), dot(rs[last], 'trk-end', 5), cursor != null ? dot(rs[cursor], 'trk-cursor', 6) : null);
    let profile = null;
    if (ch.profile) {
      const p = ch.profile;
      profile = svg('svg', { viewBox: `0 0 ${p.w} ${p.h}`, class: 'trk-profile', role: 'img', 'aria-label': `Profil elevasi ${p.min} sampai ${p.max} meter` },
        svg('title', {}, 'Profil elevasi'), svg('path', { d: p.area, class: 'trk-area' }), svg('path', { d: p.d, class: 'trk-pline' }),
        cursor != null ? svg('line', { x1: p.xy[cursor][0], x2: p.xy[cursor][0], y1: 4, y2: p.h - 4, class: 'trk-cursor-line' }) : null);
    }
    return { el: h('div.trk-draw', route, profile, profile ? h('div.trk-scale', h('span', Gpx.fmtElev(ch.profile.min)), h('span', Gpx.fmtElev(ch.profile.max))) : null), chart: ch };
  }

  /* ---------- impor GPX ---------- */
  /* → { points (sudah disederhanakan), name, note } ; melempar GpxError berpesan Indonesia */
  async function importFile(file) {
    if (!file) throw new Gpx.GpxError('Tidak ada berkas dipilih.');
    if (file.size > Gpx.MAX_FILE) throw new Gpx.GpxError(`Berkas terlalu besar (${(file.size / 1048576).toFixed(1)} MB). Maksimal ${Gpx.MAX_FILE / 1048576} MB.`);
    if (!/\.gpx$/i.test(file.name) && !/xml|gpx/i.test(file.type || '')) throw new Gpx.GpxError('Pilih berkas berekstensi .gpx.');
    const g = Gpx.parse(await file.text());
    let best = g.tracks[0], bd = -1;
    for (const t of g.tracks) { const d = Gpx.analyze(t.points).dist; if (d > bd) { bd = d; best = t; } }
    const points = Gpx.simplify(best.points, Gpx.MAX_POINTS);
    const notes = [];
    if (g.tracks.length > 1) notes.push(`File berisi ${g.tracks.length} lintasan; yang dipakai: yang terpanjang${best.name ? ` (“${best.name}”)` : ''}`);
    if (g.skipped) notes.push(`${g.skipped} titik tidak valid dilewati`);
    return { points, name: best.name || (g.waypoints[0] && g.waypoints[0].name) || '', raw: best.points.length, note: notes.join('. ') };
  }
  function pickGpx() {
    return new Promise((done) => {
      const input = h('input', { type: 'file', accept: '.gpx,application/gpx+xml,application/xml,text/xml', hidden: true });
      input.addEventListener('change', () => { const f = input.files[0]; input.remove(); done(f || null); });
      input.addEventListener('cancel', () => { input.remove(); done(null); });
      document.body.append(input); input.click();
    });
  }

  function buildGpx(name, desc, points, wpt) {
    return Gpx.build({ name, desc, waypoints: wpt ? [{ lat: wpt.lat, lng: wpt.lng, name }] : [], tracks: [{ name, desc, points }] });
  }
  const exportFile = (name, text) => download(`sadalan-${Gpx.slug(name)}.gpx`, text);

  /* ---------- field "Lintasan GPS" di editor jejak ---------- */
  function field(spec, value, form, opts = {}) {
    const state = { summary: value || null, points: opts.init ? opts.init.points : null, staged: !!opts.init, removed: false, dl: value ? value.dl !== false : true, error: null, loading: null };
    if (opts.init) state.summary = Gpx.summary(opts.init.points, true);
    const hadTrack = !!value;
    const box = h('div.trk-box');
    const dlChk = h('input', { type: 'checkbox', checked: state.dl ? '' : null, id: 'trk-dl' });
    dlChk.checked = state.dl;
    const dlRow = h('label.trk-dl', { for: 'trk-dl' }, dlChk, h('span', 'Tampilkan tombol “Unduh GPX” di situs untuk pengunjung'));
    const actions = h('div.trk-actions');
    const err = h('p.err', { role: 'alert' });
    const changed = () => box.dispatchEvent(new Event('input', { bubbles: true }));
    const guard = (fn) => async () => { try { await fn(); } catch (e) { toast((e && e.message) || 'Terjadi kesalahan.', 'err', 7000); } };

    const ensure = async () => {
      if (state.points || !state.summary) return state.points;
      if (!state.loading) state.loading = opts.load().then((p) => { state.points = p; state.error = null; }).catch((e) => { state.error = e.message || 'Lintasan tidak bisa dimuat.'; throw e; }).finally(() => { state.loading = null; });
      await state.loading; return state.points;
    };

    /* Mengisi Latitude/Longitude/Jarak/Ketinggian/Waktu dari lintasan. onlyEmpty=true → hanya isian yang masih kosong. */
    const fill = (points, onlyEmpty, name) => {
      const a = Gpx.analyze(points), filled = [];
      const put = (k, v) => { if (v == null) return; const cur = String(form.value(k) ?? '').trim(); if (onlyEmpty && cur) return; if (form.set(k, v)) filled.push(k); };
      if (name) put('name', name);
      put('lat', Gpx.compact([points[0]])[0][0]); put('lng', Gpx.compact([points[0]])[0][1]);
      put('dist', Gpx.fmtDist(a.dist));
      if (a.hasEle) { put('elev', Gpx.fmtElev(a.max)); put('time', Gpx.fmtRange(Gpx.estimateHours(a.dist, a.gain))); } else put('time', Gpx.fmtRange(Gpx.estimateHours(a.dist, 0)));
      return filled;
    };

    const adopt = (points) => {
      state.points = points; state.summary = Gpx.summary(points, state.dl); state.staged = true; state.removed = false; state.error = null;
      render(); changed();
    };

    const doImport = guard(async () => {
      const f = await pickGpx(); if (!f) return;
      const r = await importFile(f); adopt(r.points);
      const filled = fill(r.points, true, r.name);
      toast(`GPX diimpor: ${r.raw.toLocaleString('id-ID')} titik → ${r.points.length} titik tersimpan.${filled.length ? ' Isian kosong diisi otomatis.' : ''}${r.note ? ' ' + r.note + '.' : ''}`, 'ok', 7000);
    });
    const doRecord = guard(async () => { recorder({ onDone: ({ points }) => { adopt(points); const filled = fill(points, true); toast(`Rekaman dipasang (${points.length} titik).${filled.length ? ' Isian kosong diisi otomatis.' : ''}`); } }); });
    const doExport = guard(async () => {
      const pts = await ensure(); if (!pts) return;
      const name = String(form.value('name') || '').trim() || 'Jejak';
      const lat = parseFloat(form.value('lat')), lng = parseFloat(form.value('lng'));
      exportFile(name, buildGpx(name, String(form.value('desc') || '').trim().slice(0, 300), pts, Gpx.validLL(lat, lng) ? { lat, lng } : { lat: pts[0].lat, lng: pts[0].lng }));
    });
    const doEdit = guard(async () => {
      const pts = await ensure(); if (!pts) return;
      editor(pts, { name: String(form.value('name') || '').trim(), onApply: (np) => { adopt(np); toast('Perubahan lintasan diterapkan. Simpan jejak untuk menerbitkannya.'); } });
    });
    const doApply = guard(async () => {
      const pts = await ensure(); if (!pts) return;
      const filled = fill(pts, false);
      toast(filled.length ? 'Latitude, longitude, jarak, ketinggian, dan waktu tempuh diperbarui dari lintasan.' : 'Tidak ada isian yang bisa diperbarui.');
    });
    const doRemove = guard(async () => {
      if (!(await confirmBox({ title: 'Hapus lintasan?', text: 'Garis jalur dan profil elevasi jejak ini akan dihapus saat Anda menyimpan jejak. Titik di peta tetap ada.', ok: 'Hapus lintasan', danger: true }))) return;
      state.summary = null; state.points = null; state.staged = false; state.removed = hadTrack; state.error = null; render(); changed();
    });
    const doHere = guard(async () => {
      if (!navigator.geolocation) throw new Error('Peramban ini tidak mendukung GPS.');
      const pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, (e) => no(new Error(geoMessage(e))), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }));
      form.set('lat', Number(pos.coords.latitude.toFixed(5))); form.set('lng', Number(pos.coords.longitude.toFixed(5)));
      toast(`Latitude & longitude diisi dari posisi Anda (±${Math.round(pos.coords.accuracy)} m).`);
    });
    dlChk.addEventListener('change', () => { state.dl = dlChk.checked; if (state.summary) state.summary.dl = state.dl; changed(); });

    const btn = (label, ic, fn, cls = '') => h('button.btn.ghost.sm' + cls, { type: 'button', on: { click: fn } }, icon(ic, 15), label);
    function render() {
      const s = state.summary;
      if (!s) {
        box.replaceChildren(h('p.trk-empty', icon('route', 20), h('span', 'Belum ada lintasan. Impor file GPX atau rekam langsung di lapangan — lintasan tampil sebagai garis jalur dan profil elevasi di situs.')));
        actions.replaceChildren(btn('Impor GPX', 'upload', doImport), btn('Rekam GPS', 'record', doRecord));
        dlRow.hidden = true;
      } else {
        const kids = [statGrid(summaryStats(s))];
        if (state.points) kids.push(drawing(state.points).el);
        else if (state.error) kids.push(h('div.notice.err', icon('alert', 18), h('div', state.error + ' Impor ulang file GPX untuk menggantinya.')));
        else kids.push(h('p.trk-empty', 'Memuat lintasan…'));
        if (state.staged) kids.push(h('p.trk-staged', icon('alert', 15), 'Lintasan baru — belum tersimpan. Simpan jejak untuk menerbitkannya.'));
        box.replaceChildren(...kids);
        actions.replaceChildren(btn('Ekspor GPX', 'download', doExport), btn('Edit lintasan', 'edit', doEdit), btn('Terapkan ke isian', 'sparkle', doApply), btn('Ganti (impor)', 'upload', doImport), btn('Rekam ulang', 'record', doRecord), btn('Hapus', 'trash', doRemove, '.danger'));
        dlRow.hidden = false;
      }
    }
    render();
    if (state.summary && !state.points) ensure().then(render, render); // muat titik di latar agar pratinjau & ekspor siap

    const lab = h('label', {}, spec.label);
    const hereRow = h('div.trk-here', btn('Isi Latitude/Longitude dari posisi saya', 'locate', doHere));
    const el = h('div.field.full.trk', lab, box, actions, dlRow, hereRow, spec.hint ? h('p.hint', spec.hint) : null, err);
    return { el, key: spec.k, state, get: () => (state.summary ? { ...state.summary, dl: state.dl } : null), error(m) { err.textContent = m || ''; el.classList.toggle('bad', !!m); } };
  }

  /* ---------- editor titik lintasan ---------- */
  function editor(points, { name, onApply }) {
    let pts = points.map((p) => ({ ...p })), idx = 0; const hist = [];
    const drawHost = h('div.trk-host'), info = h('p.trk-info'), slider = h('input', { type: 'range', min: 0, max: pts.length - 1, value: 0, 'aria-label': 'Pilih titik' });
    const inLat = h('input', { inputmode: 'decimal', 'aria-label': 'Latitude titik' }), inLng = h('input', { inputmode: 'decimal', 'aria-label': 'Longitude titik' }), inEle = h('input', { inputmode: 'decimal', placeholder: '–', 'aria-label': 'Elevasi titik (m)' });
    const msg = h('p.err', { role: 'alert' });
    let dirty = false;

    const push = () => { hist.push({ pts: pts.map((p) => ({ ...p })), idx }); dirty = true; };
    const paint = () => {
      idx = Math.max(0, Math.min(idx, pts.length - 1));
      slider.max = pts.length - 1; slider.value = idx;
      const cum = Gpx.cumulative(pts), p = pts[idx];
      drawHost.replaceChildren(statGrid({ ...Gpx.analyze(pts) }), drawing(pts, idx).el);
      info.textContent = `Titik ${idx + 1} dari ${pts.length} · km ${(cum[idx] / 1000).toFixed(2).replace('.', ',')}${p.ele != null ? ' · ' + Math.round(p.ele) + ' m' : ''}`;
      inLat.value = String(Number(p.lat.toFixed(6))); inLng.value = String(Number(p.lng.toFixed(6))); inEle.value = p.ele == null ? '' : String(Math.round(p.ele));
      undo.disabled = !hist.length; rmBtn.disabled = pts.length <= 2; cutB.disabled = idx <= 0 || pts.length - idx < 2; cutA.disabled = idx >= pts.length - 1 || idx < 1; msg.textContent = '';
    };
    const act = (fn) => () => { const before = pts.length; push(); try { fn(); } catch (e) { hist.pop(); msg.textContent = e.message; return; } paint(); };

    const applyPoint = act(() => {
      const lat = parseFloat(String(inLat.value).replace(',', '.')), lng = parseFloat(String(inLng.value).replace(',', '.')), ele = String(inEle.value).trim() === '' ? null : parseFloat(String(inEle.value).replace(',', '.'));
      if (!Gpx.validLL(lat, lng)) throw new Error('Latitude (−90…90) dan longitude (−180…180) harus berupa angka yang valid.');
      if (ele != null && !(ele > -500 && ele < 9000)) throw new Error('Elevasi harus antara −500 dan 9000 meter.');
      pts[idx] = { ...pts[idx], lat, lng, ele };
    });
    const remove = act(() => { if (pts.length <= 2) throw new Error('Lintasan minimal punya 2 titik.'); pts.splice(idx, 1); });
    const cutBefore = act(() => { if (pts.length - idx < 2) throw new Error('Sisakan minimal 2 titik.'); pts = pts.slice(idx); idx = 0; });
    const cutAfter = act(() => { if (idx < 1) throw new Error('Sisakan minimal 2 titik.'); pts = pts.slice(0, idx + 1); });
    const flip = act(() => { pts = Gpx.reverse(pts); idx = pts.length - 1 - idx; });
    const tidy = () => {
      const before = pts.length; push();
      let np = Gpx.despike(pts); const spikes = before - np.length; np = Gpx.smoothEle(np, 5); np = Gpx.simplify(np, Gpx.MAX_POINTS);
      if (np.length < 2) { hist.pop(); msg.textContent = 'Hasil rapikan terlalu sedikit titik.'; return; }
      pts = np; idx = 0; paint(); toast(`Dirapikan: ${spikes} titik lonjakan GPS dibuang, elevasi dihaluskan (${before} → ${pts.length} titik).`);
    };
    const doUndo = () => { const s = hist.pop(); if (!s) return; pts = s.pts; idx = s.idx; paint(); };

    const b = (label, ic, fn, cls = '') => h('button.btn.ghost.sm' + cls, { type: 'button', on: { click: fn } }, icon(ic, 15), label);
    const cutB = b('Potong sebelum titik ini', 'cut', cutBefore), cutA = b('Potong setelah titik ini', 'cut', cutAfter), rmBtn = b('Hapus titik ini', 'trash', remove, '.danger');
    const undo = b('Urungkan', 'undo', doUndo);
    slider.addEventListener('input', () => { idx = Number(slider.value); paint(); });
    const body = h('div.trk-editor', drawHost,
      h('div.trk-pick', info, slider),
      h('div.trk-coords', h('label', 'Latitude', inLat), h('label', 'Longitude', inLng), h('label', 'Elevasi (m)', inEle)),
      h('div.trk-actions', b('Terapkan koordinat titik', 'check', applyPoint), rmBtn, cutB, cutA, b('Balik arah', 'flip', flip), b('Rapikan otomatis', 'sparkle', tidy), undo), msg,
      h('p.hint', 'Geser penggeser untuk memilih titik (ditandai pada peta mini dan profil). “Rapikan otomatis” membuang titik lonjakan GPS, menghaluskan elevasi, dan menyederhanakan lintasan.'));
    const save = h('button.btn.primary', { type: 'button' }, 'Terapkan perubahan'), cancel = h('button.btn.ghost', { type: 'button' }, 'Batal');
    const d = drawer({ title: 'Edit lintasan', subtitle: name || null, body, footer: [h('span.sp'), cancel, save], isDirty: () => dirty });
    cancel.addEventListener('click', d.tryClose);
    save.addEventListener('click', () => { const out = pts; dirty = false; d.close(); onApply(out); });
    paint();
    return d;
  }

  /* ---------- perekam GPS ---------- */
  const clock = (sec) => { const t = Math.floor(sec), h2 = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60, p2 = (n) => String(n).padStart(2, '0'); return h2 ? `${h2}:${p2(m)}:${p2(x)}` : `${p2(m)}:${p2(x)}`; };
  const geoMessage = (e) => (e && e.code === 1 ? 'Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini di pengaturan peramban.' : e && e.code === 2 ? 'Posisi tidak tersedia. Pastikan GPS aktif dan Anda berada di tempat terbuka.' : e && e.code === 3 ? 'Menunggu sinyal GPS terlalu lama.' : 'Tidak bisa membaca posisi.');
  const store = {
    save(rec) { try { localStorage.setItem(REC_KEY, JSON.stringify({ pts: rec.pts.map((p) => [p.lat, p.lng, p.ele, p.t]), active: rec.active, at: Date.now() })); } catch { /* penyimpanan penuh/dimatikan: abaikan */ } },
    load() {
      try {
        const j = JSON.parse(localStorage.getItem(REC_KEY) || 'null');
        if (!j || !Array.isArray(j.pts)) return null;
        const pts = j.pts.filter((r) => Array.isArray(r) && Gpx.validLL(r[0], r[1])).map((r) => ({ lat: r[0], lng: r[1], ele: Number.isFinite(r[2]) ? r[2] : null, t: Number.isFinite(r[3]) ? r[3] : null }));
        return pts.length ? { pts, active: Number(j.active) || 0, at: j.at } : null;
      } catch { return null; }
    },
    clear() { try { localStorage.removeItem(REC_KEY); } catch { /* abaikan */ } },
  };
  /* rekaman yang belum selesai (mis. halaman tertutup) → ringkasan untuk pemberitahuan */
  const pending = () => { const s = store.load(); if (!s) return null; return { count: s.pts.length, dist: Gpx.analyze(s.pts).dist, at: s.at }; };
  const discardPending = () => store.clear();

  function recorder({ onDone }) {
    const saved = store.load();
    const rec = { pts: saved ? saved.pts : [], active: saved ? saved.active : 0, state: saved ? 'paused' : 'idle', watch: null, lastFix: null, lastTick: 0, acc: null, rej: 0, msg: '', wl: null, unsaved: 0 };
    const supported = !!navigator.geolocation, secure = window.isSecureContext !== false;

    const timeEl = h('b.rec-time', '00:00'), distEl = h('b', '0,0 km'), countEl = h('b', '0'), gainEl = h('b', '–'), accEl = h('span.rec-acc', 'GPS: –');
    const statusEl = h('p.rec-status', { role: 'status', 'aria-live': 'polite' }), host = h('div.trk-host'), controls = h('footer.drawer-foot.rec-foot');
    let tick = null, d = null, ended = false;

    const cell = (label, el) => h('div', h('dt', label), h('dd', el));
    const live = h('div.rec-live', h('div.rec-main', timeEl, h('span', 'waktu merekam')), h('dl.trk-stats.rec-stats', cell('Jarak', distEl), cell('Naik', gainEl), cell('Titik', countEl)), accEl);
    const tips = h('p.hint', 'Biarkan layar tetap menyala dan halaman ini terbuka — banyak ponsel menghentikan GPS saat layar mati atau tab di latar belakang. Rekaman tersimpan sementara di perangkat ini sehingga tidak hilang bila halaman tertutup.');
    const body = h('div.trk-editor.rec', live, statusEl, host, tips);

    const sample = (pts) => { if (pts.length <= 300) return pts; const k = Math.ceil(pts.length / 300); return pts.filter((_, i) => i % k === 0 || i === pts.length - 1); };
    const persist = (force) => { if (force || rec.unsaved >= 5) { store.save(rec); rec.unsaved = 0; } };

    const paint = () => {
      const a = rec.pts.length > 1 ? Gpx.analyze(rec.pts) : { dist: 0, gain: 0, hasEle: false };
      timeEl.textContent = clock(rec.active / 1000); distEl.textContent = Gpx.fmtDist(a.dist); countEl.textContent = String(rec.pts.length); gainEl.textContent = a.hasEle ? '+' + Gpx.fmtM(a.gain) : '–';
      const q = rec.acc == null ? '' : rec.acc <= 15 ? 'good' : rec.acc <= 40 ? 'mid' : 'bad';
      accEl.textContent = rec.acc == null ? 'GPS: menunggu sinyal…' : `GPS: akurasi ±${Math.round(rec.acc)} m`; accEl.className = 'rec-acc ' + q;
      statusEl.textContent = rec.msg || (rec.state === 'recording' ? (rec.pts.length ? 'Merekam…' : 'Menunggu sinyal GPS pertama…') : rec.state === 'paused' ? 'Dijeda.' : rec.state === 'review' ? 'Rekaman selesai. Periksa hasilnya di bawah.' : 'Siap merekam.');
      statusEl.classList.toggle('bad', !!rec.msg);
      host.replaceChildren(...(rec.pts.length > 1 ? [drawing(sample(rec.pts)).el] : []));
    };

    const onFix = (pos) => {
      if (rec.state !== 'recording') return;
      const c = pos.coords; rec.msg = '';
      const fix = { lat: c.latitude, lng: c.longitude, ele: c.altitude != null && Number.isFinite(c.altitude) ? c.altitude : null, acc: c.accuracy, t: pos.timestamp };
      rec.acc = c.accuracy; rec.lastFix = Date.now();
      const r = Gpx.accept(rec.pts[rec.pts.length - 1], fix);
      if (!r.ok) { rec.rej++; paint(); return; }
      rec.pts.push({ lat: fix.lat, lng: fix.lng, ele: fix.ele, t: fix.t }); rec.unsaved++; persist(false); paint();
    };
    const onErr = (e) => { rec.msg = geoMessage(e); if (e && e.code === 1) { stop(false); } paint(); };

    const lock = async () => { try { if ('wakeLock' in navigator && !rec.wl) { rec.wl = await navigator.wakeLock.request('screen'); rec.wl.addEventListener('release', () => { rec.wl = null; }); } } catch { /* tidak didukung: abaikan */ } };
    const onVis = () => { if (document.visibilityState === 'visible' && rec.state === 'recording') lock(); };
    const release = () => { try { rec.wl && rec.wl.release(); } catch { /* abaikan */ } rec.wl = null; };

    function start() {
      if (!supported) { rec.msg = 'Peramban ini tidak mendukung GPS.'; return paint(); }
      if (!secure) { rec.msg = 'Perekam GPS hanya berjalan di halaman HTTPS.'; return paint(); }
      rec.state = 'recording'; rec.msg = ''; rec.lastTick = Date.now(); rec.lastFix = null;
      rec.watch = navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
      lock(); controlsFor(); paint();
    }
    function stop(toReview) {
      if (rec.watch != null) { navigator.geolocation.clearWatch(rec.watch); rec.watch = null; }
      release(); rec.state = toReview ? 'review' : 'paused'; persist(true); controlsFor(); paint();
    }
    const doDiscard = async () => {
      if (rec.pts.length && !(await confirmBox({ title: 'Buang rekaman?', text: `${rec.pts.length} titik yang sudah direkam akan dihapus dan tidak bisa dikembalikan.`, ok: 'Buang rekaman', danger: true }))) return;
      store.clear(); rec.pts = []; end(); d.close();
    };
    const use = () => {
      const a = Gpx.analyze(rec.pts);
      if (rec.pts.length < 2 || a.dist < 20) { rec.msg = 'Rekaman terlalu pendek (minimal 2 titik dan 20 m).'; return paint(); }
      const points = Gpx.simplify(rec.pts, Gpx.MAX_POINTS);
      store.clear(); end(); d.close(); onDone({ points, raw: rec.pts.length });
    };
    const resume = () => { rec.msg = ''; start(); };

    const btn = (label, ic, fn, cls = '') => h('button.btn' + (cls || '.ghost'), { type: 'button', on: { click: fn } }, icon(ic, 16), label);
    function controlsFor() {
      const s = rec.state;
      const set = s === 'idle' ? [btn('Mulai merekam', 'record', start, '.primary')]
        : s === 'recording' ? [btn('Jeda', 'pause', () => stop(false)), h('span.sp'), btn('Selesai', 'stop', () => stop(true), '.primary')]
          : s === 'paused' ? [btn('Buang', 'trash', doDiscard, '.danger.ghost'), h('span.sp'), btn('Lanjutkan', 'play', resume), btn('Selesai', 'stop', () => stop(true), '.primary')]
            : [btn('Buang', 'trash', doDiscard, '.danger.ghost'), h('span.sp'), btn('Lanjut merekam', 'play', resume), btn('Gunakan lintasan', 'check', use, '.primary')];
      controls.replaceChildren(...set);
    }
    function end() { if (ended) return; ended = true; clearInterval(tick); document.removeEventListener('visibilitychange', onVis); if (rec.watch != null) { navigator.geolocation.clearWatch(rec.watch); rec.watch = null; } release(); }

    d = drawer({
      title: 'Rekam jejak GPS', subtitle: 'Berjalan di jalur sambil membawa ponsel', body, footer: null,
      onRequestClose: async () => {
        if (rec.pts.length && !(await confirmBox({ title: 'Tutup perekam?', text: 'Rekaman disimpan sementara di perangkat ini. Anda bisa melanjutkannya dari halaman Jejak.', ok: 'Tutup' }))) return;
        persist(true); end(); d.close();
      },
    });
    d.panel.append(controls);
    tick = setInterval(() => {
      const now = Date.now();
      if (rec.state === 'recording') { rec.active += now - rec.lastTick; if (rec.lastFix && now - rec.lastFix > 30000 && !rec.msg) { rec.msg = 'Sinyal GPS hilang sementara…'; } else if (rec.msg === 'Sinyal GPS hilang sementara…' && rec.lastFix && now - rec.lastFix <= 30000) rec.msg = ''; paint(); }
      rec.lastTick = now;
    }, 1000);
    document.addEventListener('visibilitychange', onVis);
    if (!supported) rec.msg = 'Peramban ini tidak mendukung GPS.'; else if (!secure) rec.msg = 'Perekam GPS hanya berjalan di halaman HTTPS.';
    controlsFor(); paint();
    return d;
  }

  return { field, editor, recorder, importFile, pickGpx, buildGpx, exportFile, download, drawing, pending, discardPending };
})();
