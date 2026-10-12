/* TrackMap — peta ubin OpenStreetMap ringan berbasis <canvas> untuk perekam & penyunting rute.
   Tanpa pustaka luar (CSP admin hanya mengizinkan skrip dari domain sendiri). Mendukung geser, cubit-zoom, roda mouse, ketuk, dan seret titik.
   Lapisan digambar lewat callback onDraw(ctx, map) memakai map.project(lat,lng) → [x,y] piksel layar. */
class TrackMap {
  constructor(host, opts = {}) {
    this.host = host; this.opts = opts;
    this.z = opts.zoom == null ? 5 : opts.zoom; this.c = [0.5, 0.5]; this.w = 300; this.h = 300;
    this.tiles = new Map(); this.ptr = new Map(); this.ok = 0; this.bad = 0; this.raf = 0; this.dead = false;
    this.onDraw = opts.onDraw || null;
    const mk = (tag, cls, attrs = {}) => { const e = document.createElement(tag); e.className = cls; Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
    this.cv = mk('canvas', 'tm-canvas', { role: 'img', 'aria-label': opts.label || 'Peta rute' });
    this.ctx = this.cv.getContext('2d');
    this.note = mk('div', 'tm-note'); this.note.hidden = true;
    this.attr = mk('a', 'tm-attr', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }); this.attr.textContent = '© OpenStreetMap';
    const zb = (t, l, d) => { const b = mk('button', 'tm-btn', { type: 'button', 'aria-label': l }); b.textContent = t; b.addEventListener('click', () => this.zoomAt(this.z + d, this.w / 2, this.h / 2)); return b; };
    this.zoomBox = mk('div', 'tm-zoom'); this.zoomBox.append(zb('+', 'Perbesar', 1), zb('−', 'Perkecil', -1));
    host.classList.add('tm'); host.replaceChildren(this.cv, this.zoomBox, this.note, this.attr);
    if (opts.interactive !== false) this.bind();
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    if (this.ro) this.ro.observe(host);
    this.resize();
  }

  /* ---------- proyeksi (Web Mercator, koordinat dunia 0…1) ---------- */
  static wx(lng) { return (lng + 180) / 360; }
  static wy(lat) { const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); }
  get scale() { return 256 * Math.pow(2, this.z); }
  project(lat, lng) { const s = this.scale; return [(TrackMap.wx(lng) - this.c[0]) * s + this.w / 2, (TrackMap.wy(lat) - this.c[1]) * s + this.h / 2]; }
  unproject(x, y) {
    const s = this.scale, wx = (x - this.w / 2) / s + this.c[0], wy = (y - this.h / 2) / s + this.c[1];
    return [Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180 / Math.PI, wx * 360 - 180];
  }

  setView(lat, lng, z) { this.c = [TrackMap.wx(lng), TrackMap.wy(lat)]; if (z != null) this.z = Math.max(2, Math.min(19, z)); this.redraw(); }
  fit(b, pad = 36) {
    if (!b) return;
    const [[s, w], [n, e]] = b, dx = Math.abs(TrackMap.wx(e) - TrackMap.wx(w)), dy = Math.abs(TrackMap.wy(s) - TrackMap.wy(n));
    const zx = dx > 0 ? Math.log2((this.w - 2 * pad) / (dx * 256)) : 17, zy = dy > 0 ? Math.log2((this.h - 2 * pad) / (dy * 256)) : 17;
    this.z = Math.max(2, Math.min(17, Math.min(zx, zy)));
    this.c = [(TrackMap.wx(w) + TrackMap.wx(e)) / 2, (TrackMap.wy(s) + TrackMap.wy(n)) / 2]; this.redraw();
  }
  zoomAt(z, sx, sy) { // zoom dengan titik di bawah jari/kursor tetap di tempat
    z = Math.max(2, Math.min(19, z)); const p = this.unproject(sx, sy); this.z = z;
    const q = this.project(p[0], p[1]), s = this.scale; this.c[0] += (q[0] - sx) / s; this.c[1] += (q[1] - sy) / s; this.redraw();
  }

  resize() {
    const r = this.host.getBoundingClientRect(); if (!r.width || !r.height) return;
    const d = Math.min(2, window.devicePixelRatio || 1); this.w = r.width; this.h = r.height;
    this.cv.width = Math.round(r.width * d); this.cv.height = Math.round(r.height * d); this.d = d; this.redraw();
  }

  /* ---------- ubin ---------- */
  tile(z, x, y) {
    const k = z + '/' + x + '/' + y; let t = this.tiles.get(k);
    if (t) return t;
    t = new Image(); t.referrerPolicy = 'origin'; // meta no-referrer di admin akan ditolak server OSM; kirim origin saja
    t.onload = () => { t.ready = true; this.ok++; this.note.hidden = true; this.redraw(); };
    t.onerror = () => { t.fail = true; if (++this.bad >= 4 && !this.ok) { this.note.textContent = 'Peta tidak bisa dimuat (offline?). Rute tetap tampil sebagai garis.'; this.note.hidden = false; } };
    t.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    this.tiles.set(k, t);
    if (this.tiles.size > 400) this.tiles.delete(this.tiles.keys().next().value);
    return t;
  }

  redraw() { if (this.raf || this.dead) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); }); }
  paint() {
    const { ctx, w, h } = this; ctx.setTransform(this.d, 0, 0, this.d, 0, 0);
    ctx.fillStyle = '#dce9df'; ctx.fillRect(0, 0, w, h);
    const tz = Math.max(0, Math.min(19, Math.floor(this.z + 0.35))), n = Math.pow(2, tz), ts = 256 * Math.pow(2, this.z - tz), s = this.scale;
    const x0 = Math.floor((this.c[0] - w / 2 / s) * n), x1 = Math.floor((this.c[0] + w / 2 / s) * n), y0 = Math.floor((this.c[1] - h / 2 / s) * n), y1 = Math.floor((this.c[1] + h / 2 / s) * n);
    for (let x = x0; x <= x1; x++) for (let y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) {
      const t = this.tile(tz, ((x % n) + n) % n, y); if (!t.ready) continue;
      ctx.drawImage(t, (x / n - this.c[0]) * s + w / 2, (y / n - this.c[1]) * s + h / 2, ts + 0.5, ts + 0.5);
    }
    if (this.onDraw) this.onDraw(ctx, this);
  }

  /* ---------- gambar bantu ---------- */
  line(seg, { color = '#d97745', width = 4, alpha = 1, from = 0, to = seg.length - 1 } = {}) {
    const c = this.ctx; if (to - from < 1) return;
    c.save(); c.globalAlpha = alpha; c.lineJoin = 'round'; c.lineCap = 'round';
    for (const [lw, col] of [[width + 3, 'rgba(255,255,255,.9)'], [width, color]]) {
      c.beginPath(); c.lineWidth = lw; c.strokeStyle = col;
      for (let i = from; i <= to; i++) { const [x, y] = this.project(seg[i][0], seg[i][1]); if (i === from) c.moveTo(x, y); else c.lineTo(x, y); }
      c.stroke();
    }
    c.restore();
  }
  dot(lat, lng, { r = 6, fill = '#d97745', stroke = '#fff', label = '' } = {}) {
    const c = this.ctx, [x, y] = this.project(lat, lng);
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = fill; c.fill(); c.lineWidth = 2.5; c.strokeStyle = stroke; c.stroke();
    if (label) { c.fillStyle = '#fff'; c.font = '700 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, x, y + 0.5); }
    return [x, y];
  }
  ring(lat, lng, meters, fill = 'rgba(35,89,75,.15)') { // lingkaran akurasi
    const c = this.ctx, [x, y] = this.project(lat, lng), r = meters / (156543.03 * Math.cos(lat * Math.PI / 180) / Math.pow(2, this.z));
    if (r < 3) return; c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = fill; c.fill();
  }

  /* ---------- interaksi ---------- */
  bind() {
    const cv = this.cv; cv.style.touchAction = 'none';
    const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', (e) => {
      const p = pt(e); cv.setPointerCapture(e.pointerId);
      if (this.ptr.size === 0 && this.opts.onDown && this.opts.onDown(p, e)) { this.custom = e.pointerId; return; }
      this.ptr.set(e.pointerId, p);
      if (this.ptr.size === 1) this.pan = { x: p.x, y: p.y, c: [...this.c], moved: false, t: Date.now() };
      else if (this.ptr.size === 2) { const [a, b] = [...this.ptr.values()]; this.pan = null; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: this.z }; }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pt(e);
      if (this.custom === e.pointerId) { if (this.opts.onMove) this.opts.onMove(p, e); return; }
      if (!this.ptr.has(e.pointerId)) { if (this.opts.onHover) this.opts.onHover(p); return; }
      this.ptr.set(e.pointerId, p);
      if (this.ptr.size === 2 && this.pinch) {
        const [a, b] = [...this.ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.zoomAt(this.pinch.z + Math.log2(d / this.pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else if (this.pan) {
        const dx = p.x - this.pan.x, dy = p.y - this.pan.y;
        if (!this.pan.moved && Math.hypot(dx, dy) > 6) { this.pan.moved = true; if (this.opts.onPan) this.opts.onPan(); }
        if (this.pan.moved) { const s = this.scale; this.c = [this.pan.c[0] - dx / s, this.pan.c[1] - dy / s]; this.redraw(); }
      }
    });
    const up = (e) => {
      if (this.custom === e.pointerId) { this.custom = null; if (this.opts.onUp) this.opts.onUp(pt(e), e); return; }
      const p = pt(e), was = this.pan;
      this.ptr.delete(e.pointerId); if (this.ptr.size < 2) this.pinch = null;
      if (e.type === 'pointerup' && was && !was.moved && Date.now() - was.t < 600 && this.opts.onTap) this.opts.onTap(this.unproject(p.x, p.y), p);
      if (!this.ptr.size) this.pan = null;
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const p = pt(e); this.zoomAt(this.z - e.deltaY * 0.0015, p.x, p.y); }, { passive: false });
    cv.addEventListener('dblclick', (e) => { const p = pt(e); this.zoomAt(this.z + 1, p.x, p.y); });
  }

  destroy() { this.dead = true; if (this.ro) this.ro.disconnect(); cancelAnimationFrame(this.raf); this.tiles.clear(); }

  /* Pratinjau SVG kecil (tanpa ubin peta) untuk kartu/formulir. */
  static preview(segs, w = 320, h = 110) {
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('class', 'trk-prev'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Pratinjau bentuk rute');
    const b = Geo.bounds(segs); if (!b) return svg;
    const [[s, wst], [n, e]] = b, k = Math.cos(((s + n) / 2) * Math.PI / 180), dx = Math.max((e - wst) * k, 1e-9), dy = Math.max(n - s, 1e-9), pad = 10;
    const sc = Math.min((w - 2 * pad) / dx, (h - 2 * pad) / dy), ox = (w - dx * sc) / 2, oy = (h - dy * sc) / 2;
    const P = (p) => `${(ox + (p[1] - wst) * k * sc).toFixed(1)},${(oy + (n - p[0]) * sc).toFixed(1)}`;
    const step = Math.max(1, Math.ceil(Geo.count(segs) / 400));
    for (const sg of segs) {
      const pl = document.createElementNS(NS, 'polyline'); pl.setAttribute('points', sg.filter((_, i) => i % step === 0 || i === sg.length - 1).map(P).join(' '));
      pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', '#d97745'); pl.setAttribute('stroke-width', '3'); pl.setAttribute('stroke-linecap', 'round'); pl.setAttribute('stroke-linejoin', 'round'); svg.append(pl);
    }
    const f = segs[0][0], l = segs[segs.length - 1][segs[segs.length - 1].length - 1];
    [[f, '#3f9b68'], [l, '#bd5145']].forEach(([p, col]) => { const [x, y] = P(p).split(','); const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', '5'); c.setAttribute('fill', col); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '2'); svg.append(c); });
    return svg;
  }
}
