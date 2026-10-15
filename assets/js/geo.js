/* Geo — utilitas jejak GPS: baca/tulis GPX, statistik, penyederhanaan, format teks Indonesia.
   Dipakai admin (rekam, edit, impor/ekspor) dan situs publik (rute di peta, grafik elevasi, unduh GPX). Tanpa DOM, jalan di browser dan Node.
   Satu titik = [lat, lng, ele|null, t|null]; t = detik UNIX. Satu jejak = daftar segmen (jeda/rekaman terputus = segmen baru). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Geo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const R = 6371008.8, RAD = Math.PI / 180;
const MAX_FILE = 25e6, MAX_STORE = 4000; // batas ukuran berkas GPX & jumlah titik yang disimpan ke repositori

/* jarak dua titik (meter) */
const dist = (a, b) => {
  const dLat = (b[0] - a[0]) * RAD, dLng = (b[1] - a[1]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

/* Naik/turun kumulatif: rata-rata 3 titik + ambang 5 m agar derau altimeter GPS tidak menggelembungkan angka. */
function elevAcc(th = 5) {
  const win = []; let ref = null, gain = 0, loss = 0;
  return {
    push(e) {
      if (!Number.isFinite(e)) return;
      win.push(e); if (win.length > 3) win.shift();
      const v = win.reduce((a, b) => a + b, 0) / win.length;
      if (ref === null) { ref = v; return; }
      if (v - ref >= th) { gain += v - ref; ref = v; } else if (ref - v >= th) { loss += ref - v; ref = v; }
    },
    get gain() { return gain; }, get loss() { return loss; },
  };
}

const count = (segs) => segs.reduce((n, s) => n + s.length, 0);

function stats(segs) {
  let n = 0, m = 0, moving = 0, secs = 0, min = Infinity, max = -Infinity, hasEle = false, hasTime = false, first = null, last = null;
  const acc = elevAcc();
  for (const s of segs) {
    let prev = null;
    for (const p of s) {
      n++; first = first || p; last = p;
      if (p[2] != null) { hasEle = true; if (p[2] < min) min = p[2]; if (p[2] > max) max = p[2]; acc.push(p[2]); }
      if (prev) {
        const d = dist(prev, p); m += d;
        if (p[3] != null && prev[3] != null) {
          const dt = p[3] - prev[3];
          if (dt > 0) { hasTime = true; secs += dt; if (d / dt >= 0.4 && dt <= 120) moving += dt; }
        }
      }
      prev = p;
    }
  }
  return { pts: n, km: m / 1000, gain: acc.gain, loss: acc.loss, min: hasEle ? min : null, max: hasEle ? max : null, hasEle, hasTime, secs, moving,
    start: first ? [first[0], first[1]] : null, end: last ? [last[0], last[1]] : null };
}

/* estimasi waktu jalan (aturan Naismith sederhana: 4 km/jam + 1 jam per 600 m naik) bila jejak tak punya waktu */
const estimateSecs = (km, gain) => Math.round((km / 4 + (gain || 0) / 600) * 3600);

function bounds(segs) {
  let s = 90, n = -90, w = 180, e = -180;
  for (const sg of segs) for (const p of sg) { if (p[0] < s) s = p[0]; if (p[0] > n) n = p[0]; if (p[1] < w) w = p[1]; if (p[1] > e) e = p[1]; }
  return count(segs) ? [[s, w], [n, e]] : null;
}

/* Celah antar segmen berurutan (jeda pengguna atau data yang hilang): [{ i, from, to, dist (m), dt (dtk|null) }] */
function bridges(segs) {
  const out = [];
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1][segs[i - 1].length - 1], b = segs[i][0]; if (!a || !b) continue;
    out.push({ i, from: a, to: b, dist: dist(a, b), dt: a[3] != null && b[3] != null ? b[3] - a[3] : null });
  }
  return out;
}

/* ---------- penyederhanaan (Douglas–Peucker, iteratif) ---------- */
function simplifySeg(seg, tol) {
  const n = seg.length; if (n < 3 || tol <= 0) return seg.slice();
  const kx = R * Math.cos(seg[0][0] * RAD) * RAD, ky = R * RAD;
  const X = seg.map((p) => p[1] * kx), Y = seg.map((p) => p[0] * ky);
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); const dx = X[b] - X[a], dy = Y[b] - Y[a], L2 = dx * dx + dy * dy;
    let dmax = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (L2 === 0) d = Math.hypot(X[i] - X[a], Y[i] - Y[a]);
      else { const t = Math.max(0, Math.min(1, ((X[i] - X[a]) * dx + (Y[i] - Y[a]) * dy) / L2)); d = Math.hypot(X[i] - (X[a] + t * dx), Y[i] - (Y[a] + t * dy)); }
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return seg.filter((_, i) => keep[i]);
}
const simplify = (segs, tol) => segs.map((s) => simplifySeg(s, tol));

/* Kurangi titik sampai ≤ max dengan toleransi sekecil mungkin (pencarian biner). */
function limit(segs, max = MAX_STORE) {
  if (count(segs) <= max) return segs;
  let lo = 0.2, hi = 3000, best = simplify(segs, hi);
  for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2, r = simplify(segs, mid); if (count(r) > max) lo = mid; else { hi = mid; best = r; } }
  return best;
}

/* Bersihkan: buang titik tak valid, bulatkan (lat/lng 5 desimal ≈ 1 m, ele meter, t detik), buang segmen < 2 titik. */
function clean(segs) {
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  return (segs || []).map((s) => (s || []).filter((p) => Array.isArray(p) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [r5(p[0]), r5(p[1]), Number.isFinite(p[2]) ? Math.round(p[2]) : null, Number.isFinite(p[3]) ? Math.round(p[3]) : null]))
    .filter((s) => s.length >= 2);
}

/* ---------- berkas simpanan (data/tracks/<id>.json) ---------- */
function pack(segs) {
  const pt = (p) => { const a = p.slice(0, 4); while (a.length > 2 && a[a.length - 1] == null) a.pop(); return '[' + a.map((x) => (x == null ? 'null' : x)).join(',') + ']'; };
  return '{"v":1,"segs":[\n' + segs.map((s) => '[' + s.map(pt).join(',') + ']').join(',\n') + '\n]}\n';
}
function unpack(text) {
  const o = typeof text === 'string' ? JSON.parse(text) : text;
  if (!o || o.v !== 1 || !Array.isArray(o.segs)) throw new Error('Berkas rute tidak dikenali.');
  return o.segs.map((s) => s.map((p) => [p[0], p[1], p[2] == null ? null : p[2], p[3] == null ? null : p[3]]));
}

/* ---------- GPX ---------- */
const decodeXml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
  if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
});
const escXml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/* Pembaca GPX toleran (namespace, tag menutup sendiri, komentar, CDATA); tidak memakai DOM sehingga bisa diuji di Node. */
function parseGpx(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Berkas kosong.');
  if (text.length > MAX_FILE) throw new Error('Berkas GPX terlalu besar (maksimal 25 MB).');
  const x = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => escXml(c));
  const T = '(?:[\\w-]+:)?';
  if (!new RegExp('<' + T + 'gpx[\\s>]', 'i').test(x)) throw new Error('Berkas ini bukan GPX (tag <gpx> tidak ditemukan).');
  const attr = (a, k) => { const m = new RegExp('(?:^|\\s)' + k + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(a); return m ? (m[1] !== undefined ? m[1] : m[2]) : null; };
  const inner = (b, tag) => { const m = new RegExp('<' + T + tag + '\\b[^>]*>([\\s\\S]*?)</' + T + tag + '>', 'i').exec(b); return m ? m[1].trim() : null; };
  let bad = 0;
  const points = (block, tag) => {
    const re = new RegExp('<' + T + tag + '\\b([^>]*?)(?:/>|>([\\s\\S]*?)</' + T + tag + '>)', 'gi'), out = []; let m;
    while ((m = re.exec(block))) {
      const lat = parseFloat(attr(m[1], 'lat')), lng = parseFloat(attr(m[1], 'lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { bad++; continue; }
      const body = m[2] || '', e = parseFloat(inner(body, 'ele')), ts = inner(body, 'time'), t = ts ? Date.parse(ts) : NaN;
      out.push([lat, lng, Number.isFinite(e) ? e : null, Number.isFinite(t) ? Math.round(t / 1000) : null]);
    }
    return out;
  };
  const segs = []; let name = null, kind = 'track';
  const trk = new RegExp('<' + T + 'trk\\b[^>]*>([\\s\\S]*?)</' + T + 'trk>', 'gi'); let tm;
  while ((tm = trk.exec(x))) {
    if (name === null) name = inner(tm[1].split(new RegExp('<' + T + 'trkseg\\b', 'i'))[0], 'name');
    const sg = new RegExp('<' + T + 'trkseg\\b[^>]*>([\\s\\S]*?)</' + T + 'trkseg>', 'gi'); let sm;
    while ((sm = sg.exec(tm[1]))) segs.push(points(sm[1], 'trkpt'));
  }
  if (!segs.some((s) => s.length >= 2)) {
    const rte = new RegExp('<' + T + 'rte\\b[^>]*>([\\s\\S]*?)</' + T + 'rte>', 'gi'); let rm;
    while ((rm = rte.exec(x))) { if (name === null) name = inner(rm[1].split(new RegExp('<' + T + 'rtept\\b', 'i'))[0], 'name'); segs.push(points(rm[1], 'rtept')); kind = 'route'; }
  }
  if (name === null) name = inner(inner(x, 'metadata') || '', 'name');
  const good = segs.filter((s) => s.length >= 2);
  if (!good.length) throw new Error('GPX ini tidak berisi jalur (trk) atau rute (rte) dengan minimal 2 titik.');
  return { name: name ? decodeXml(name).trim() : '', segs: good, kind, skipped: bad, count: count(good) };
}

function toGpx({ name = 'Jejak Sadalan', desc = '', segs }) {
  const iso = (t) => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const t0 = (segs.flat().find((p) => p[3] != null) || [])[3];
  const L = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Sadalan" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    `<metadata><name>${escXml(name)}</name>${desc ? `<desc>${escXml(desc)}</desc>` : ''}<time>${iso(t0 != null ? t0 : Date.now() / 1000)}</time></metadata>`,
    `<trk><name>${escXml(name)}</name>${desc ? `<desc>${escXml(desc)}</desc>` : ''}`];
  for (const s of segs) {
    L.push('<trkseg>');
    for (const p of s) L.push(`<trkpt lat="${p[0]}" lon="${p[1]}">${p[2] != null ? `<ele>${p[2]}</ele>` : ''}${p[3] != null ? `<time>${iso(p[3])}</time>` : ''}</trkpt>`);
    L.push('</trkseg>');
  }
  L.push('</trk>', '</gpx>', '');
  return L.join('\n');
}

/* profil elevasi: n sampel merata terhadap jarak → [{d: km, e: meter}] (kosong bila tanpa ketinggian) */
function profile(segs, n = 120) {
  const pts = []; let d = 0, prev = null, last = null;
  for (const s of segs) { prev = null; for (const p of s) { if (prev) d += dist(prev, p); prev = p; if (p[2] != null) { last = p[2]; pts.push({ d: d / 1000, e: p[2] }); } } }
  if (pts.length < 2 || !isFinite(last)) return [];
  const total = pts[pts.length - 1].d, out = []; let j = 0;
  for (let i = 0; i < n; i++) {
    const dd = (total * i) / (n - 1); while (j < pts.length - 2 && pts[j + 1].d < dd) j++;
    const a = pts[j], b = pts[j + 1], k = b.d === a.d ? 0 : Math.max(0, Math.min(1, (dd - a.d) / (b.d - a.d)));
    out.push({ d: dd, e: a.e + (b.e - a.e) * k });
  }
  return out;
}

/* path SVG untuk grafik elevasi (hanya string angka; aman dipakai di innerHTML maupun setAttribute) */
function profilePath(prof, w, h, pad = 6) {
  if (!prof.length) return null;
  let lo = Infinity, hi = -Infinity; prof.forEach((p) => { if (p.e < lo) lo = p.e; if (p.e > hi) hi = p.e; });
  const span = Math.max(hi - lo, 20), total = prof[prof.length - 1].d || 1;
  const X = (d) => (pad + (d / total) * (w - 2 * pad)).toFixed(1), Y = (e) => (h - pad - ((e - lo) / span) * (h - 2 * pad)).toFixed(1);
  const line = prof.map((p, i) => (i ? 'L' : 'M') + X(p.d) + ' ' + Y(p.e)).join('');
  return { line, area: line + `L${X(total)} ${h - pad}L${X(0)} ${h - pad}Z`, min: lo, max: hi, km: total };
}

/* ---------- format teks (Indonesia: koma desimal, titik ribuan) ---------- */
const nf = (n, d = 0) => Number(n).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtKm = (km) => nf(km, km < 1 ? 2 : 1) + ' km';
const fmtElev = (m) => nf(Math.round(m)) + ' mdpl';
const fmtM = (m) => nf(Math.round(m)) + ' m';
function fmtDur(secs) {
  let m = Math.round(secs / 60); const h = Math.floor(m / 60); m -= h * 60;
  return h ? `${h} jam${m ? ' ' + m + ' mnt' : ''}` : `${Math.max(1, m)} mnt`;
}
const pad = (n) => String(n).padStart(2, '0');
const fmtClock = (secs) => { secs = Math.max(0, Math.floor(secs)); return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`; };
const fmtSpeed = (kmh) => nf(kmh, 1) + ' km/j';

return { R, MAX_STORE, dist, elevAcc, count, stats, estimateSecs, bridges, bounds, simplify, limit, clean, pack, unpack, parseGpx, toGpx, profile, profilePath,
  nf, fmtKm, fmtElev, fmtM, fmtDur, fmtClock, fmtSpeed, escXml };
});
