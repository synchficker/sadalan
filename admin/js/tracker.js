/* Tracker — mesin rekam jejak GPS untuk panel admin (versi pribadi, bukan untuk publik).
   Fitur: rekam via Geolocation API, jeda/lanjut (segmen baru), saring titik kurang akurat & lonjakan, hitung jarak/naik/waktu langsung,
   simpan otomatis ke IndexedDB (rekaman tidak hilang bila tab tertutup/ponsel kehabisan baterai), draf hasil rekaman,
   dan MODE LATAR BELAKANG (opsional): Wake Lock + audio senyap + MediaSession agar peramban tidak membekukan halaman saat layar mati/ganti aplikasi.
   Catatan jujur: peramban tidak punya pelacakan latar belakang sejati seperti aplikasi native; mode ini upaya terbaik, bukan jaminan. */
const Tracker = (() => {
  'use strict';
  const PREF_KEY = 'sadalan_rec_prefs', DB = 'sadalan-recorder', STORE = 'kv';
  const MAX_SPEED = 45; // m/s; lebih cepat dianggap lonjakan GPS
  const GAP_SEC = 25, GAP_M = 50; // titik baru >25 dtk setelah titik lama DAN >50 m jauhnya = ada jeda data (aplikasi tertahan di latar belakang)
  const DEFAULTS = { bg: false, wake: true, maxAcc: 50, minDist: 4 };
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  const listeners = new Set();

  /* ---------- preferensi ---------- */
  let prefs = { ...DEFAULTS };
  try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { /* abaikan */ }

  /* ---------- penyimpanan (IndexedDB; cadangan memori bila diblokir) ---------- */
  const mem = new Map(); let persistOk = true;
  const idb = () => new Promise((ok, no) => {
    if (typeof indexedDB === 'undefined') return no(new Error('no idb'));
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onsuccess = () => ok(rq.result); rq.onerror = () => no(rq.error);
  });
  async function kv(mode, fn) {
    try {
      const db = await idb();
      return await new Promise((ok, no) => { const tx = db.transaction(STORE, mode), r = fn(tx.objectStore(STORE)); tx.oncomplete = () => { db.close(); ok(r && r.result); }; tx.onerror = tx.onabort = () => { db.close(); no(tx.error); }; });
    } catch (e) { persistOk = false; return undefined; }
  }
  const kvGet = async (k) => { const v = await kv('readonly', (s) => s.get(k)); return v === undefined ? mem.get(k) : v; };
  const kvSet = async (k, v) => { mem.set(k, v); await kv('readwrite', (s) => s.put(v, k)); };
  const kvDel = async (k) => { mem.delete(k); await kv('readwrite', (s) => s.delete(k)); };
  const kvKeys = async () => { const k = await kv('readonly', (s) => s.getAllKeys()); return k || [...mem.keys()]; };

  /* ---------- keadaan ---------- */
  const fresh = () => ({ status: 'idle', id: null, startedAt: null, elapsedMs: 0, segs: [], dist: 0, gain: 0, loss: 0, moving: 0, gaps: 0, gapSecs: 0, gapDist: 0, signal: 'none', lastFix: null, error: null, note: null, bgActive: false, wakeActive: false, native: false });
  let st = fresh(), acc = Geo.elevAcc(), lastTick = 0, timer = 0, watchId = null, lastCb = 0, rejects = 0, dirty = false, sinceSave = 0;

  const pts = () => st.segs.reduce((n, s) => n + s.length, 0);
  const getState = () => ({ ...st, elapsed: st.elapsedMs / 1000, pts: pts(), prefs: { ...prefs } });
  const emit = () => { const s = getState(); listeners.forEach((f) => { try { f(s); } catch (e) { console.error(e); } }); };
  const on = (f) => { listeners.add(f); return () => listeners.delete(f); };
  const supported = () => ({ geo: typeof navigator !== 'undefined' && 'geolocation' in navigator, secure: typeof isSecureContext === 'undefined' || isSecureContext });

  function rebuild() { // hitung ulang akumulator dari titik (setelah pulih dari penyimpanan)
    const s = Geo.stats(st.segs); acc = Geo.elevAcc();
    st.segs.forEach((sg) => sg.forEach((p) => acc.push(p[2])));
    st.dist = s.km * 1000; st.moving = s.moving; st.gain = acc.gain; st.loss = acc.loss;
  }

  /* ---------- simpan otomatis ---------- */
  const snapshot = () => ({ id: st.id, startedAt: st.startedAt, status: st.status, elapsedMs: st.elapsedMs, segs: st.segs, gaps: st.gaps, gapSecs: st.gapSecs, gapDist: st.gapDist, savedAt: Date.now() });
  function persist(force) { if (st.status === 'idle' || (!dirty && !force)) return Promise.resolve(); dirty = false; return kvSet('active', snapshot()); }

  /* ---------- wake lock ---------- */
  let wl = null;
  async function wakeOn() {
    if (!prefs.wake || !navigator.wakeLock || wl) return;
    try { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; st.wakeActive = false; emit(); }); st.wakeActive = true; }
    catch { wl = null; st.wakeActive = false; }
    emit();
  }
  function wakeOff() { if (wl) { const w = wl; wl = null; w.release().catch(() => {}); } st.wakeActive = false; }

  /* ---------- mode latar belakang: audio senyap + MediaSession ---------- */
  let audio = null, audioWanted = false;
  function silentWav() { // 1 dtk, 8 kHz, 8-bit, gelombang kotak ±1 LSB (≈ −42 dB): tak terdengar, tetapi dianggap "sedang memutar audio"
    const n = 8000, b = new Uint8Array(44 + n), dv = new DataView(b.buffer), w = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); w(36, 'data'); dv.setUint32(40, n, true);
    for (let i = 0; i < n; i++) b[44 + i] = 128 + (Math.floor(i / 40) % 2 ? 1 : -1);
    let bin = ''; b.forEach((x) => { bin += String.fromCharCode(x); });
    return 'data:audio/wav;base64,' + btoa(bin);
  }
  function mediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      const art = new URL('../assets/images/logo.png', location.href).href;
      navigator.mediaSession.metadata = new MediaMetadata({ title: st.status === 'paused' ? 'Rekaman dijeda' : 'Merekam jejak…', artist: 'Sadalan', album: 'Panel Admin', artwork: [{ src: art, sizes: '317x317', type: 'image/png' }] });
      navigator.mediaSession.playbackState = st.status === 'recording' ? 'playing' : 'paused';
      navigator.mediaSession.setActionHandler('play', () => { if (st.status === 'paused') resume(); });
      navigator.mediaSession.setActionHandler('pause', () => { if (st.status === 'recording') pause(); });
      navigator.mediaSession.setActionHandler('stop', () => { if (st.status === 'recording') pause(); }); // jeda saja; menyelesaikan harus disengaja dari layar
    } catch { /* abaikan */ }
  }
  async function bgOn() {
    try {
      if (!audio) { audio = new Audio(silentWav()); audio.loop = true; audio.setAttribute('playsinline', ''); audio.addEventListener('pause', () => { if (audioWanted && st.status === 'recording') audio.play().catch(() => {}); }); } // sistem/pihak lain menjeda → putar lagi
      audioWanted = true;
      await audio.play(); st.bgActive = true; st.note = null;
    } catch { st.bgActive = false; st.note = 'Peramban menolak mode latar belakang (perlu sentuhan langsung). Ketuk sakelarnya lagi.'; }
    mediaSession(); emit();
  }
  function bgOff() {
    audioWanted = false; if (audio) audio.pause();
    st.bgActive = false;
    if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; ['play', 'pause', 'stop'].forEach((a) => navigator.mediaSession.setActionHandler(a, null)); } catch { /* abaikan */ } }
  }

  /* ---------- GPS ---------- */
  /* Di aplikasi Android pembungkus (Capacitor) dipakai pelacak native berlayanan latar depan: tetap merekam saat layar mati / aplikasi ditutup. */
  const nativeBG = () => { try { const C = window.Capacitor; if (C && C.isNativePlatform && C.isNativePlatform()) return C.registerPlugin('BackgroundGeolocation'); } catch { /* bukan native */ } return null; };
  let nid = null, wgen = 0;
  function unwatch() {
    wgen++;
    if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId); watchId = null;
    const bg = nativeBG(); if (bg && nid != null) { const id = nid; nid = null; Promise.resolve(bg.removeWatcher({ id })).catch(() => {}); }
  }
  function denied() { st.error = 'Izin lokasi ditolak. Izinkan lokasi untuk situs/aplikasi ini di pengaturan, lalu lanjutkan rekaman.'; st.signal = 'denied'; pause(); }
  function watch() {
    unwatch(); lastCb = Date.now();
    const bg = nativeBG(), g = wgen;
    if (bg) {
      st.native = true;
      Promise.resolve(bg.addWatcher({ backgroundTitle: 'Sadalan sedang merekam jejak', backgroundMessage: 'Ketuk untuk kembali ke perekam', requestPermissions: true, stale: false, distanceFilter: prefs.minDist }, (loc, err) => {
        lastCb = Date.now();
        if (err) { if (err.code === 'NOT_AUTHORIZED') denied(); else { st.signal = 'lost'; emit(); } return; }
        if (loc) ingest({ latitude: loc.latitude, longitude: loc.longitude, altitude: loc.altitude, accuracy: loc.accuracy, timestamp: loc.time || Date.now() });
      })).then((id) => { if (g === wgen && st.status === 'recording') nid = id; else Promise.resolve(bg.removeWatcher({ id })).catch(() => {}); }).catch(() => { st.signal = 'lost'; emit(); });
      return;
    }
    st.native = false; if (!navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }
  const onPos = (p) => { lastCb = Date.now(); ingest({ latitude: p.coords.latitude, longitude: p.coords.longitude, altitude: p.coords.altitude, accuracy: p.coords.accuracy, timestamp: p.timestamp }); };
  const onErr = (e) => { lastCb = Date.now(); if (e.code === 1) { denied(); return; } st.signal = 'lost'; emit(); };
  /* Pembacaan satu kali sebagai cadangan: dipicu saat watchPosition diam (peramban menahan GPS di latar belakang). Duplikat otomatis ditolak ingest(). */
  function poll() { if (st.native || !navigator.geolocation) return; navigator.geolocation.getCurrentPosition(onPos, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 }); }

  /* Memproses satu fix; true bila titik direkam. (Juga dipakai uji otomatis.) */
  function ingest(c) {
    if (st.status !== 'recording') return false;
    const t = Math.round(c.timestamp / 1000);
    st.lastFix = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, t };
    if (!(c.accuracy <= prefs.maxAcc)) { st.signal = 'weak'; emit(); return false; }
    st.signal = 'good'; st.error = null;
    let seg = st.segs[st.segs.length - 1], prev = seg[seg.length - 1];
    const p = [r5(c.latitude), r5(c.longitude), Number.isFinite(c.altitude) ? Math.round(c.altitude) : null, t];
    if (prev) {
      const d = Geo.dist(prev, p), dt = t - prev[3];
      if (dt <= 0 || d < prefs.minDist) { emit(); return false; }
      if (d / dt > MAX_SPEED && ++rejects < 3) { emit(); return false; } // lonjakan; diterima bila berulang (mis. naik kendaraan)
      if (dt > GAP_SEC && d > GAP_M) { // jeda data: JANGAN tarik garis lurus palsu; mulai segmen baru & catat. Jarak jeda dihitung terpisah.
        st.gaps++; st.gapSecs += dt; st.gapDist += d; st.segs.push([]); seg = st.segs[st.segs.length - 1]; prev = null;
      } else { st.dist += d; if (d / dt >= 0.4 && dt <= 120) st.moving += dt; }
    }
    rejects = 0; seg.push(p); acc.push(p[2]); st.gain = acc.gain; st.loss = acc.loss; dirty = true;
    if (++sinceSave >= 15) { sinceSave = 0; persist(true); } // simpan juga tiap 15 titik, bukan hanya tiap 10 dtk
    emit(); return true;
  }

  /* ---------- siklus rekam ---------- */
  function tick() { const n = Date.now(); if (st.status === 'recording') st.elapsedMs += n - lastTick; lastTick = n; if (st.status === 'recording') emit(); }
  let worker = null, beats = 0;
  function beat() {
    tick(); beats++;
    if (st.status !== 'recording') return;
    const silent = Date.now() - lastCb;
    if (silent > 8000 && beats % 4 === 0) poll();   // GPS diam >8 dtk → baca langsung tiap 4 dtk
    if (silent > 45000 && beats % 15 === 0) { watch(); st.signal = 'lost'; emit(); } // diam >45 dtk → mulai ulang pemantauan
    if (beats % 10 === 0) persist(false);
  }
  function startBeat() {
    stopBeat();
    try { worker = new Worker('js/ticker.js'); worker.onmessage = beat; worker.onerror = () => { stopBeat(); timer = setInterval(beat, 1000); }; worker.postMessage({ ms: 1000 }); }
    catch { timer = setInterval(beat, 1000); } // cadangan bila Worker tidak tersedia
  }
  function stopBeat() { clearInterval(timer); timer = 0; if (worker) { worker.terminate(); worker = null; } }
  function begin() {
    lastTick = Date.now(); beats = 0; startBeat();
    watch(); wakeOn(); if (prefs.bg && !st.native) bgOn();
    mediaSession(); emit();
  }
  function halt() { stopBeat(); unwatch(); wakeOff(); bgOff(); }

  function start() { // dipanggil langsung dari ketukan pengguna (audio butuh sentuhan)
    if (st.status !== 'idle') return;
    st = fresh(); acc = Geo.elevAcc(); rejects = 0;
    st.id = 'rec-' + Date.now().toString(36); st.startedAt = Date.now(); st.segs = [[]]; st.status = 'recording'; dirty = true;
    begin(); persist(true);
  }
  function pause() {
    if (st.status !== 'recording') return;
    tick(); st.status = 'paused'; halt(); persist(true); emit();
  }
  function resume() {
    if (st.status !== 'paused') return;
    if (st.segs[st.segs.length - 1].length) st.segs.push([]); // jeda → segmen baru
    st.status = 'recording'; st.error = null; st.note = null; rejects = 0; dirty = true; begin(); persist(true);
  }
  function finishRecord() {
    tick(); const segs = Geo.clean(st.segs), rec = { id: st.id, startedAt: st.startedAt, endedAt: Date.now(), segs, gaps: st.gaps, gapSecs: st.gapSecs, gapDist: Math.round(st.gapDist) };
    halt(); st = fresh(); acc = Geo.elevAcc(); dirty = false; kvDel('active'); emit();
    return rec;
  }
  const stop = () => (st.status === 'idle' ? null : finishRecord());
  function discard() { if (st.status === 'idle') return; halt(); st = fresh(); acc = Geo.elevAcc(); dirty = false; kvDel('active'); emit(); }

  /* ---------- pemulihan setelah tab tertutup ---------- */
  async function recover() {
    if (st.status !== 'idle') return null;
    const s = await kvGet('active');
    return s && s.segs && s.segs.some((g) => g.length) ? s : null;
  }
  const dropSaved = () => kvDel('active'); // buang rekaman terputus yang tersimpan
  function adopt(s) {
    st = fresh(); st.id = s.id; st.startedAt = s.startedAt; st.elapsedMs = s.elapsedMs || 0; st.segs = s.segs.map((g) => g.slice()); st.gaps = s.gaps || 0; st.gapSecs = s.gapSecs || 0; st.gapDist = s.gapDist || 0;
    st.status = 'paused'; rebuild(); dirty = true; emit();
  }

  /* ---------- draf (hasil rekaman yang belum disimpan ke situs) ---------- */
  async function saveDraft(rec, name) { await kvSet('draft:' + rec.id, { id: rec.id, name: name || '', startedAt: rec.startedAt, endedAt: rec.endedAt, segs: rec.segs, gaps: rec.gaps || 0, gapSecs: rec.gapSecs || 0, gapDist: rec.gapDist || 0 }); }
  const getDraft = (id) => kvGet('draft:' + id);
  const deleteDraft = (id) => kvDel('draft:' + id);
  async function drafts() {
    const keys = (await kvKeys()).filter((k) => typeof k === 'string' && k.startsWith('draft:')), out = [];
    for (const k of keys) { const d = await kvGet(k); if (d) out.push({ id: d.id, name: d.name, startedAt: d.startedAt, endedAt: d.endedAt, stats: Geo.stats(d.segs) }); }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }

  /* ---------- peristiwa halaman ---------- */
  /* Dipanggil saat halaman kembali aktif (visible / resume / pageshow): hidupkan ulang semua pendukung & langsung baca posisi agar jeda sesingkat mungkin. */
  function onWake() {
    if (st.status !== 'recording') return;
    wakeOn();
    if (prefs.bg && !st.native && audio && audio.paused) audio.play().catch(() => {});
    watch(); poll(); emit();
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(true); else onWake(); });
    document.addEventListener('resume', onWake); window.addEventListener('pageshow', onWake);
    document.addEventListener('freeze', () => persist(true));
    window.addEventListener('pagehide', () => persist(true));
  }

  function setPrefs(p) {
    const was = prefs; prefs = { ...prefs, ...p };
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* abaikan */ }
    if (st.status === 'recording') { // dipanggil dari ketukan pengguna
      if (prefs.bg && !was.bg) bgOn(); else if (!prefs.bg && was.bg) { bgOff(); emit(); }
      if (prefs.wake && !was.wake) wakeOn(); else if (!prefs.wake && was.wake) { wakeOff(); emit(); }
    }
    emit();
  }

  return { supported, getState, on, getPrefs: () => ({ ...prefs }), setPrefs, start, pause, resume, stop, discard, recover, adopt, dropSaved, saveDraft, getDraft, deleteDraft, drafts, persistOk: () => persistOk, _ingest: ingest };
})();
if (typeof module === 'object' && module.exports) module.exports = Tracker;
