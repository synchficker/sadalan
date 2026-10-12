/* Gpx — baca/tulis berkas GPX, analisis lintasan, penyederhanaan, dan data grafik.
   Satu modul untuk admin (impor, rekam, ekspor, edit), situs publik (grafik & unduh), dan uji Node. Tanpa dependensi.
   Parser sengaja berbasis teks (bukan DOMParser) agar perilakunya sama di peramban dan Node, dan tidak pernah
   memperluas entitas XML kustom (aman dari XXE / "billion laughs"): hanya 5 entitas standar + angka yang didekode. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Gpx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const R = 6371008.8, RAD = Math.PI / 180;
  const MAX_FILE = 8 * 1024 * 1024;    // batas ukuran berkas GPX yang diterima
  const MAX_RAW = 500000;              // batas titik mentah dalam satu berkas
  const MAX_POINTS = 800;              // titik yang disimpan per jejak (cukup halus, ±26 KB)
  const GAIN_STEP = 3;                 // meter: ambang peredam derau GPS untuk hitung naik/turun

  class GpxError extends Error {}

  /* ---------- geometri ---------- */
  function dist(a, b) {
    const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  const cumulative = (pts) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i])); return c; };
  const validLL = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const round = (v, n) => { const k = 10 ** n; return Math.round(v * k) / k; };

  /* ---------- baca GPX ---------- */
  const NS = '(?:[\\w.-]+:)?';
  const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
    const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return n > 31 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : ' ';
  });
  const clean = (s, max) => decode(String(s || '')).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const attr = (s, n) => { const m = new RegExp('(?:^|\\s)' + n + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(s); return m ? (m[1] != null ? m[1] : m[2]) : null; };
  const inner = (block, tag) => { const m = new RegExp('<' + NS + tag + '\\b[^>]*>([\\s\\S]*?)</' + NS + tag + '>', 'i').exec(block); return m ? m[1] : null; };

  /* Pemindaian linear: tag pembuka dicari satu per satu, penutupnya hanya dicari dalam jendela kecil (BODY_WIN).
     Berkas rusak dengan ribuan tag tak tertutup tidak bisa memicu pemindaian berulang (kompleksitas kuadratik). */
  const BODY_WIN = 4096, HEAD_WIN = 4096, MAX_BLOCKS = 200;
  function readPoints(block, tag, counter) {
    const open = new RegExp('<' + NS + tag + '\\b([^>]*)>', 'gi'), close = new RegExp('</' + NS + tag + '\\s*>', 'i');
    const out = []; let m;
    while ((m = open.exec(block))) {
      if (++counter.n > MAX_RAW) throw new GpxError(`Berkas terlalu besar (maksimal ${MAX_RAW.toLocaleString('id-ID')} titik).`);
      let attrs = m[1], body = '';
      if (attrs.endsWith('/')) attrs = attrs.slice(0, -1);
      else { const win = block.slice(open.lastIndex, open.lastIndex + BODY_WIN), c = close.exec(win); body = c ? win.slice(0, c.index) : ''; }
      const lat = parseFloat(attr(attrs, 'lat')), lng = parseFloat(attr(attrs, 'lon'));
      if (!validLL(lat, lng)) { counter.skipped++; continue; }
      const e = inner(body, 'ele'), t = inner(body, 'time');
      const ele = e == null ? NaN : parseFloat(e); const ts = t == null ? NaN : Date.parse(decode(t).trim());
      out.push({ lat, lng, ele: Number.isFinite(ele) && ele > -500 && ele < 9000 ? ele : null, t: Number.isFinite(ts) ? ts : null });
    }
    return out;
  }

  /* parse(teks) → { tracks:[{name, points}], waypoints:[{name,lat,lng}], skipped } */
  function parse(text) {
    if (typeof text !== 'string' || !text.trim()) throw new GpxError('Berkas kosong.');
    text = text.replace(/^\uFEFF/, '');
    if (!new RegExp('<' + NS + 'gpx\\b', 'i').test(text)) throw new GpxError('Ini bukan berkas GPX yang valid (tag <gpx> tidak ditemukan).');
    const counter = { n: 0, skipped: 0 };
    const tracks = [];
    const grab = (blockTag, ptTag, segTag) => {
      const open = new RegExp('<' + NS + blockTag + '\\b[^>]*>', 'gi'), close = new RegExp('</' + NS + blockTag + '\\s*>', 'gi');
      let m, blocks = 0;
      while ((m = open.exec(text)) && blocks++ < MAX_BLOCKS) {
        if (m[0].endsWith('/>')) continue;
        close.lastIndex = open.lastIndex; const c = close.exec(text);
        if (!c) break;                                   // tidak ditutup: hentikan (tidak memindai ulang sisa berkas)
        const block = text.slice(open.lastIndex, c.index); open.lastIndex = close.lastIndex;
        const first = block.search(new RegExp('<' + NS + (segTag || ptTag) + '\\b', 'i'));
        const head = (first < 0 ? block : block.slice(0, first)).slice(0, HEAD_WIN);
        const points = readPoints(block, ptTag, counter);
        if (points.length >= 2) tracks.push({ name: clean(inner(head, 'name'), 80), points, kind: blockTag });
      }
    };
    grab('trk', 'trkpt', 'trkseg');
    if (!tracks.length) grab('rte', 'rtept', null);
    const waypoints = [];
    const wopen = new RegExp('<' + NS + 'wpt\\b([^>]*)>', 'gi'), wclose = new RegExp('</' + NS + 'wpt\\s*>', 'i'); let w;
    while ((w = wopen.exec(text)) && waypoints.length < 500) {
      let attrs = w[1], body = '';
      if (attrs.endsWith('/')) attrs = attrs.slice(0, -1); else { const win = text.slice(wopen.lastIndex, wopen.lastIndex + HEAD_WIN), c = wclose.exec(win); body = c ? win.slice(0, c.index) : ''; }
      const lat = parseFloat(attr(attrs, 'lat')), lng = parseFloat(attr(attrs, 'lon'));
      if (validLL(lat, lng)) waypoints.push({ lat, lng, name: clean(inner(body, 'name'), 80) });
    }
    if (!tracks.length) throw new GpxError('Berkas GPX ini tidak berisi lintasan (trk atau rte) dengan minimal 2 titik yang valid.');
    return { tracks, waypoints, skipped: counter.skipped };
  }

  /* ---------- analisis ---------- */
  function analyze(points) {
    const n = points.length; let d = 0;
    for (let i = 1; i < n; i++) d += dist(points[i - 1], points[i]);
    const eles = points.map((p) => p.ele).filter((e) => e != null);
    const hasEle = eles.length >= n * 0.8 && n > 1;
    let gain = 0, loss = 0, min = null, max = null;
    if (hasEle) {
      let ref = null;
      for (const p of points) {
        if (p.ele == null) continue;
        min = min == null ? p.ele : Math.min(min, p.ele); max = max == null ? p.ele : Math.max(max, p.ele);
        if (ref == null) { ref = p.ele; continue; }
        if (p.ele - ref >= GAIN_STEP) { gain += p.ele - ref; ref = p.ele; } else if (ref - p.ele >= GAIN_STEP) { loss += ref - p.ele; ref = p.ele; }
      }
    }
    let elapsed = null, moving = null;
    if (n > 1 && points[0].t != null && points[n - 1].t != null && points[n - 1].t > points[0].t) {
      elapsed = (points[n - 1].t - points[0].t) / 1000; moving = 0;
      for (let i = 1; i < n; i++) {
        const dt = (points[i].t - points[i - 1].t) / 1000;
        if (dt > 0 && dt <= 600 && dist(points[i - 1], points[i]) / dt >= 0.3) moving += dt;
      }
    }
    return { count: n, dist: d, gain: Math.round(gain), loss: Math.round(loss), min: min == null ? null : Math.round(min), max: max == null ? null : Math.round(max), hasEle, elapsed, moving };
  }

  /* ---------- penyederhanaan (Douglas–Peucker 3D, iteratif) ---------- */
  function simplify(pts, max = MAX_POINTS) {
    if (pts.length <= max) return pts.slice();
    let work = pts;
    if (work.length > 20000) { const k = Math.ceil(work.length / 20000); work = work.filter((_, i) => i % k === 0 || i === work.length - 1); }
    const lat0 = work[0].lat, lng0 = work[0].lng, kx = Math.cos(lat0 * RAD) * 111320;
    const X = work.map((p) => (p.lng - lng0) * kx), Y = work.map((p) => (p.lat - lat0) * 110540), Z = work.map((p) => (p.ele == null ? 0 : p.ele));
    const n = work.length;
    const run = (eps) => {
      const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1; const stack = [[0, n - 1]]; let count = 2;
      while (stack.length) {
        const [a, b] = stack.pop(); if (b <= a + 1) continue;
        const dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a], len2 = dx * dx + dy * dy + dz * dz;
        let best = -1, bd = -1;
        for (let i = a + 1; i < b; i++) {
          const px = X[i] - X[a], py = Y[i] - Y[a], pz = Z[i] - Z[a];
          const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / len2)) : 0;
          const ex = px - t * dx, ey = py - t * dy, ez = pz - t * dz, d = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (d > bd) { bd = d; best = i; }
        }
        if (bd > eps) { keep[best] = 1; count++; stack.push([a, best], [best, b]); }
      }
      return { keep, count };
    };
    let lo = 0.05, hi = 5000, res = run(hi);
    for (let i = 0; i < 22; i++) { const mid = Math.sqrt(lo * hi); const r = run(mid); if (r.count <= max) { hi = mid; res = r; } else lo = mid; }
    if (res.count > max) res = run(hi);
    return work.filter((_, i) => res.keep[i]);
  }

  /* ---------- pembersihan & penyuntingan ---------- */
  /* Menghapus titik "lonjakan" GPS: titik yang membuat jalur menyimpang jauh dari tetangganya. */
  function despike(points) {
    if (points.length < 3) return points.slice();
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const a = out[out.length - 1], b = points[i], c = points[i + 1];
      const detour = dist(a, b) + dist(b, c) - dist(a, c);
      if (detour > Math.max(60, 2 * dist(a, c))) continue;
      out.push(b);
    }
    out.push(points[points.length - 1]);
    return out;
  }
  /* Menghaluskan elevasi dengan rata-rata bergerak (derau altimeter GPS). */
  function smoothEle(points, win = 5) {
    const h = Math.floor(win / 2);
    return points.map((p, i) => {
      if (p.ele == null) return p;
      let s = 0, c = 0;
      for (let j = Math.max(0, i - h); j <= Math.min(points.length - 1, i + h); j++) if (points[j].ele != null) { s += points[j].ele; c++; }
      return { ...p, ele: s / c };
    });
  }
  const reverse = (points) => points.slice().reverse();

  /* ---------- simpan/muat (data/tracks/<id>.json) ---------- */
  function compact(points) {
    const have = points.filter((p) => p.ele != null).length;
    const withEle = points.length > 1 && have >= points.length * 0.8;
    let last = null;
    const rows = points.map((p, i) => {
      const lat = round(p.lat, 5), lng = round(p.lng, 5);
      if (!withEle) return [lat, lng];
      let e = p.ele;
      if (e == null) { // isi celah dengan elevasi terdekat sebelumnya, atau berikutnya
        e = last; if (e == null) { for (let j = i + 1; j < points.length; j++) if (points[j].ele != null) { e = points[j].ele; break; } }
      }
      last = e == null ? last : e;
      return [lat, lng, Math.round(e)];
    });
    return rows;
  }
  const serialize = (points) => `{"v":1,"pts":[\n${compact(points).map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;
  function parseTrack(text) {
    let j; try { j = JSON.parse(text); } catch { throw new GpxError('Berkas lintasan rusak (bukan JSON).'); }
    if (!j || j.v !== 1 || !Array.isArray(j.pts) || j.pts.length < 2 || j.pts.length > 5000) throw new GpxError('Berkas lintasan tidak valid.');
    return j.pts.map((r) => {
      if (!Array.isArray(r) || !validLL(r[0], r[1]) || (r[2] != null && !Number.isFinite(r[2]))) throw new GpxError('Berkas lintasan memuat titik yang tidak valid.');
      return { lat: r[0], lng: r[1], ele: r.length > 2 ? r[2] : null, t: null };
    });
  }
  /* ringkasan yang disimpan di data/trails.json (field "track") */
  function summary(points, dl = true) {
    /* dihitung dari data yang benar-benar tersimpan (koordinat 5 desimal, elevasi bulat) agar sama persis dengan hitungan ulang dari berkas */
    const a = analyze(compact(points).map((r) => ({ lat: r[0], lng: r[1], ele: r.length > 2 ? r[2] : null, t: null })));
    const s = { pts: points.length, dist: Math.round(a.dist), gain: a.gain, loss: a.loss, min: a.min, max: a.max, dl: !!dl };
    return s;
  }

  /* ---------- format tampilan (gaya yang sama dengan data jejak: "8,4 km", "2.665 mdpl", "4–5 jam") ---------- */
  const thousands = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fmtDist = (m) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  const fmtElev = (m) => `${thousands(m)} mdpl`;
  const fmtM = (m) => `${thousands(m)} m`;
  /* Perkiraan waktu tempuh: 4 km/jam + 1 jam per 400 m pendakian (dibulatkan menjadi rentang jam). */
  const estimateHours = (distM, gainM) => distM / 4000 + (gainM || 0) / 400;
  function fmtRange(h) {
    if (h < 1) return `${Math.max(10, Math.round((h * 60) / 5) * 5)} menit`;
    const lo = Math.floor(h), hi = Math.ceil(h);
    return `${lo}–${hi === lo ? lo + 1 : hi} jam`;
  }
  const fmtClock = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}j ${String(m).padStart(2, '0')}m` : `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}d`; };
  const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'jejak';

  /* ---------- tulis GPX 1.1 ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function build({ name, desc, waypoints = [], tracks = [], time = new Date() }) {
    const out = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Sadalan CMS" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
      `  <metadata><name>${esc(name)}</name>${desc ? `<desc>${esc(desc)}</desc>` : ''}<time>${time.toISOString()}</time></metadata>`];
    for (const w of waypoints) out.push(`  <wpt lat="${round(w.lat, 6)}" lon="${round(w.lng, 6)}">${w.ele != null ? `<ele>${round(w.ele, 1)}</ele>` : ''}<name>${esc(w.name)}</name>${w.desc ? `<desc>${esc(w.desc)}</desc>` : ''}</wpt>`);
    for (const t of tracks) {
      out.push(`  <trk><name>${esc(t.name)}</name>${t.desc ? `<desc>${esc(t.desc)}</desc>` : ''}<trkseg>`);
      for (const p of t.points) out.push(`    <trkpt lat="${round(p.lat, 6)}" lon="${round(p.lng, 6)}">${p.ele != null ? `<ele>${round(p.ele, 1)}</ele>` : ''}${p.t != null ? `<time>${new Date(p.t).toISOString()}</time>` : ''}</trkpt>`);
      out.push('  </trkseg></trk>');
    }
    out.push('</gpx>', '');
    return out.join('\n');
  }

  /* ---------- data grafik: rute (peta mini) & profil elevasi, tanpa menggambar ---------- */
  function chart(points, { w = 320, h = 180, pad = 10, ph = 90 } = {}) {
    const n = points.length;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const p of points) { minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat); minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng); }
    const kx = Math.cos(((minLat + maxLat) / 2) * RAD);
    const dx = (maxLng - minLng) * kx, dy = maxLat - minLat;
    const scale = dx === 0 && dy === 0 ? 1 : Math.min((w - 2 * pad) / (dx || 1e-9), (h - 2 * pad) / (dy || 1e-9));
    const ox = (w - dx * scale) / 2, oy = (h - dy * scale) / 2;
    const xy = points.map((p) => [round(ox + (p.lng - minLng) * kx * scale, 1), round(h - (oy + (p.lat - minLat) * scale), 1)]);
    const route = { w, h, xy, d: xy.map((q, i) => (i ? 'L' : 'M') + q[0] + ' ' + q[1]).join('') };
    let profile = null;
    const a = analyze(points);
    if (a.hasEle) {
      const cum = cumulative(points), total = cum[n - 1] || 1;
      const lo = a.min, span = Math.max(1, a.max - a.min);
      let last = points.find((p) => p.ele != null).ele;
      const pxy = points.map((p, i) => { if (p.ele != null) last = p.ele; return [round(pad + (cum[i] / total) * (w - 2 * pad), 1), round(ph - pad - ((last - lo) / span) * (ph - 2 * pad), 1)]; });
      const d = pxy.map((q, i) => (i ? 'L' : 'M') + q[0] + ' ' + q[1]).join('');
      profile = { w, h: ph, xy: pxy, d, area: `${d}L${pxy[n - 1][0]} ${ph - pad}L${pxy[0][0]} ${ph - pad}Z`, min: a.min, max: a.max, total, cum };
    }
    return { route, profile, stats: a };
  }

  /* ---------- filter perekaman GPS ---------- */
  /* Mengembalikan { ok, reason } untuk satu bacaan posisi: menolak akurasi buruk, titik yang terlalu dekat, dan lonjakan. */
  function accept(last, fix, { maxAcc = 40, minDist = 5, maxSpeed = 12 } = {}) {
    if (!validLL(fix.lat, fix.lng)) return { ok: false, reason: 'koordinat' };
    if (fix.acc != null && fix.acc > maxAcc) return { ok: false, reason: 'akurasi' };
    if (!last) return { ok: true };
    const d = dist(last, fix);
    if (d < Math.max(minDist, (fix.acc || 0) * 0.5)) return { ok: false, reason: 'dekat' };
    const dt = last.t != null && fix.t != null ? (fix.t - last.t) / 1000 : 0;
    if (dt > 0 && d / dt > maxSpeed) return { ok: false, reason: 'lonjakan' };
    return { ok: true };
  }

  return { MAX_FILE, MAX_POINTS, GpxError, dist, cumulative, parse, analyze, simplify, despike, smoothEle, reverse, compact, serialize, parseTrack, summary, build, chart, accept, fmtDist, fmtElev, fmtM, fmtRange, fmtClock, estimateHours, slug, validLL };
});
