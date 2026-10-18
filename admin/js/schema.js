/* Skema & validasi konten Sadalan — dipakai halaman admin (browser) dan uji otomatis (Node).
   Setiap validator mengembalikan objek yang sudah dibersihkan (field tak dikenal dibuang) atau melempar ValidationError. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Schema = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

class ValidationError extends Error {
  constructor(fields) { super('Data tidak valid'); this.status = 422; this.fields = fields; }
}

const DIFFICULTIES = ['Mudah', 'Menengah', 'Menantang'];
const SOCIAL_KEYS = ['facebook', 'x', 'instagram', 'tiktok', 'threads']; // sesuai ikon di assets/js/footer.js
const IMG_RE = /^(https?:\/\/[^\s"'<>]+|assets\/[A-Za-z0-9_\-./]+|data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+)$/;
const URL_RE = /^https?:\/\/[^\s"'<>]+$/i;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const GH_USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/; // aturan username GitHub
const COLLAB_ROLES = ['pull', 'triage', 'push', 'maintain', 'admin']; // Pembaca · Triage · Editor · Maintainer · Admin

const TRACK_RE = /^data\/tracks\/[A-Za-z0-9_-]{1,60}\.json$/;
const TRACK_MAX_PTS = 6000, TRACK_MAX_SEGS = 100;
const trackPath = (id) => `data/tracks/${id}.json`;

const validDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
};

const ctx = () => {
  const errors = {};
  return {
    errors,
    fail(f, m) { if (!errors[f]) errors[f] = m; },
    done() { if (Object.keys(errors).length) throw new ValidationError(errors); },
  };
};
const obj = (c, v, f = '_') => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  c.fail(f, 'Harus berupa objek'); c.done(); return {};
};

function text(c, o, f, { min = 0, max = 200, req = true } = {}) {
  let v = o[f];
  if (v == null) v = '';
  if (typeof v !== 'string') { c.fail(f, 'Harus berupa teks'); return ''; }
  v = v.trim();
  if (!v) { if (req) c.fail(f, 'Wajib diisi'); return ''; }
  if (v.length < min) c.fail(f, `Minimal ${min} karakter`);
  if (v.length > max) c.fail(f, `Maksimal ${max} karakter`);
  return v;
}
function num(c, o, f, min, max, { int = false } = {}) {
  let v = o[f];
  if (typeof v === 'string' && v.trim() !== '') v = Number(v.replace(',', '.'));
  if (typeof v !== 'number' || !Number.isFinite(v)) { c.fail(f, 'Harus berupa angka'); return 0; }
  if (int && !Number.isInteger(v)) c.fail(f, 'Harus bilangan bulat');
  if (v < min || v > max) c.fail(f, `Harus antara ${min} dan ${max}`);
  return v;
}
function oneOf(c, o, f, allowed, msg) {
  const v = typeof o[f] === 'string' ? o[f].trim() : o[f];
  if (!allowed.includes(v)) { c.fail(f, msg || `Pilih salah satu: ${allowed.join(', ')}`); return ''; }
  return v;
}
function image(c, o, f, { req = true } = {}) {
  const v = typeof o[f] === 'string' ? o[f].trim() : '';
  if (!v) { if (req) c.fail(f, 'Wajib diisi'); return ''; }
  if (!IMG_RE.test(v)) { c.fail(f, 'Gambar harus URL http(s), path assets/…, atau data:image base64'); return ''; }
  if (v.length > 4_000_000) c.fail(f, 'Gambar terlalu besar');
  return v;
}
function strList(c, o, f, { min = 0, max = 20, item = 200 } = {}) {
  const v = o[f] == null ? [] : o[f];
  if (!Array.isArray(v)) { c.fail(f, 'Harus berupa daftar'); return []; }
  const out = [];
  v.forEach((x, i) => {
    if (typeof x !== 'string' || !x.trim()) return c.fail(f, `Butir ${i + 1} harus teks tidak kosong`);
    if (x.trim().length > item) return c.fail(f, `Butir ${i + 1} maksimal ${item} karakter`);
    out.push(x.trim());
  });
  if (out.length < min) c.fail(f, `Minimal ${min} butir`);
  if (out.length > max) c.fail(f, `Maksimal ${max} butir`);
  return out;
}
const webUrl = (c, o, f) => {
  const v = typeof o[f] === 'string' ? o[f].trim() : '';
  if (!URL_RE.test(v)) { c.fail(f, 'Harus URL http(s) yang valid'); return ''; }
  return v;
};

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');

/* ---------- koleksi ---------- */
function trail(input, { site }) {
  const c = ctx(), o = obj(c, input);
  const v = {
    name: text(c, o, 'name', { max: 80 }),
    loc: text(c, o, 'loc', { max: 120 }),
    difficulty: oneOf(c, o, 'difficulty', DIFFICULTIES),
    elev: text(c, o, 'elev', { max: 30 }),
    dist: text(c, o, 'dist', { max: 30 }),
    time: text(c, o, 'time', { max: 30 }),
    rating: num(c, o, 'rating', 0, 5),
    cat: oneOf(c, o, 'cat', site.trailCategories, 'Kategori belum ada di pengaturan situs (trailCategories)'),
    lat: num(c, o, 'lat', -90, 90),
    lng: num(c, o, 'lng', -180, 180),
    img: image(c, o, 'img'),
    desc: text(c, o, 'desc', { max: 1000 }),
  };
  const tp = typeof o.track === 'string' ? o.track.trim() : '';
  if (tp) { if (TRACK_RE.test(tp)) v.track = tp; else c.fail('track', 'Path rute GPS tidak valid'); }
  c.done(); return v;
}

/* Rute GPS: { v:1, segs:[[[lat,lng,ele|null,t|null],…],…] } — dibulatkan (lat/lng 5 desimal, ele & t bilangan bulat). */
function track(input) {
  const c = ctx(), o = obj(c, input);
  if (o.v !== 1) c.fail('v', 'Versi berkas rute harus 1');
  const raw = Array.isArray(o.segs) ? o.segs : (c.fail('segs', 'Harus berupa daftar segmen'), []);
  if (raw.length < 1 || raw.length > TRACK_MAX_SEGS) c.fail('segs', `Rute harus 1–${TRACK_MAX_SEGS} segmen`);
  const segs = []; let total = 0;
  raw.slice(0, TRACK_MAX_SEGS).forEach((s, i) => {
    if (!Array.isArray(s) || s.length < 2) return c.fail('segs', `Segmen ${i + 1} minimal 2 titik`);
    const out = [];
    for (let j = 0; j < s.length; j++) {
      const p = s[j];
      if (!Array.isArray(p) || p.length < 2 || p.length > 4) return c.fail('segs', `Titik ${j + 1} pada segmen ${i + 1} tidak valid`);
      const [lat, lng, ele, t] = p;
      if (typeof lat !== 'number' || !(lat >= -90 && lat <= 90) || typeof lng !== 'number' || !(lng >= -180 && lng <= 180)) return c.fail('segs', `Koordinat titik ${j + 1} pada segmen ${i + 1} di luar rentang`);
      if (ele != null && (typeof ele !== 'number' || !(ele >= -500 && ele <= 9000))) return c.fail('segs', `Ketinggian titik ${j + 1} pada segmen ${i + 1} di luar rentang (−500…9000 m)`);
      if (t != null && (typeof t !== 'number' || !(t >= 0 && t <= 4102444800))) return c.fail('segs', `Waktu titik ${j + 1} pada segmen ${i + 1} tidak valid`);
      out.push([Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, ele == null ? null : Math.round(ele), t == null ? null : Math.round(t)]);
    }
    total += out.length; segs.push(out);
  });
  if (total > TRACK_MAX_PTS) c.fail('segs', `Terlalu banyak titik (${total}); maksimal ${TRACK_MAX_PTS}`);
  c.done(); return { v: 1, segs };
}

function review(input, { site }) {
  const c = ctx(), o = obj(c, input);
  const v = {
    cat: oneOf(c, o, 'cat', site.reviewCategories.map((x) => x.name), 'Kategori belum ada di pengaturan situs (reviewCategories)'),
    title: text(c, o, 'title', { max: 120 }),
    loc: text(c, o, 'loc', { max: 120, req: false }),
    rating: num(c, o, 'rating', 1, 5, { int: true }),
    author: text(c, o, 'author', { max: 60, req: false }) || 'Pendaki Sadalan',
    iso: validDate(o.iso) ? o.iso : (c.fail('iso', 'Format tanggal YYYY-MM-DD yang valid'), ''),
    img: image(c, o, 'img', { req: false }),
    text: text(c, o, 'text', { min: 10, max: 600 }),
    body: strList(c, o, 'body', { max: 10, item: 1500 }),
    pros: strList(c, o, 'pros', { max: 10, item: 80 }),
    cons: strList(c, o, 'cons', { max: 10, item: 80 }),
    tags: strList(c, o, 'tags', { max: 10, item: 40 }),
  };
  c.done(); return v;
}

function blogBody(c, f, body) {
  if (!Array.isArray(body) || body.length < 1 || body.length > 60) { c.fail(f, 'Isi artikel harus 1–60 blok'); return []; }
  const out = [];
  body.forEach((b, i) => {
    const at = `${f}[${i}]`;
    if (typeof b === 'string') {
      const s = b.trim(); if (!s || s.length > 5000) return c.fail(at, 'Paragraf wajib diisi, maksimal 5000 karakter');
      return out.push(s);
    }
    const keys = b && typeof b === 'object' && !Array.isArray(b) ? Object.keys(b) : [];
    if (keys.length !== 1 || !['h', 'q', 'ul'].includes(keys[0])) return c.fail(at, 'Blok harus teks, {h}, {q}, atau {ul}');
    const k = keys[0];
    if (k === 'ul') {
      const sub = ctx(); const items = strList(sub, b, 'ul', { min: 1, max: 30, item: 300 });
      if (Object.keys(sub.errors).length) return c.fail(at, sub.errors.ul);
      return out.push({ ul: items });
    }
    const s = typeof b[k] === 'string' ? b[k].trim() : '';
    if (!s || s.length > 500) return c.fail(at, 'Wajib diisi, maksimal 500 karakter');
    out.push({ [k]: s });
  });
  return out;
}

function blog(input, { existingId } = {}) {
  const c = ctx(), o = obj(c, input);
  const v = {
    title: text(c, o, 'title', { max: 150 }),
    cat: text(c, o, 'cat', { max: 40 }),
    date: validDate(o.date) ? o.date : (c.fail('date', 'Format tanggal YYYY-MM-DD yang valid'), ''),
    author: text(c, o, 'author', { max: 60 }),
    img: image(c, o, 'img'),
    text: text(c, o, 'text', { max: 400 }),
    body: blogBody(c, 'body', o.body),
  };
  if (!existingId && o.id != null && o.id !== '') {
    if (typeof o.id !== 'string' || !SLUG_RE.test(o.id) || o.id.length > 80) c.fail('id', 'ID hanya huruf kecil, angka, dan tanda hubung');
    else v.id = o.id;
  }
  c.done(); return v;
}

/* ---------- singleton ---------- */
function profile(input) {
  const c = ctx(), o = obj(c, input);
  const v = {
    title: text(c, o, 'title', { max: 80 }),
    heading: text(c, o, 'heading', { max: 80 }),
    head: text(c, o, 'head', { max: 1000 }),
    image: image(c, o, 'image'),
    imageAlt: text(c, o, 'imageAlt', { max: 160 }),
    caption: text(c, o, 'caption', { max: 160 }),
    body: strList(c, o, 'body', { min: 1, max: 12, item: 3000 }),
  };
  c.done(); return v;
}

function site(input, { trails, reviews }) {
  const c = ctx(), o = obj(c, input);
  const sub = (f) => {
    const s = ctx(); const r = { errors: s.errors, o: o[f] && typeof o[f] === 'object' && !Array.isArray(o[f]) ? o[f] : (c.fail(f, 'Harus berupa objek'), {}) };
    return { s, o: r.o, merge() { Object.entries(s.errors).forEach(([k, m]) => c.fail(`${f}.${k}`, m)); } };
  };
  const v = { name: text(c, o, 'name', { max: 60 }), tagline: text(c, o, 'tagline', { max: 80 }), description: text(c, o, 'description', { max: 300 }) };

  const h = sub('hero');
  v.hero = {
    eyebrow: text(h.s, h.o, 'eyebrow', { max: 80 }), title1: text(h.s, h.o, 'title1', { max: 80 }), title2: text(h.s, h.o, 'title2', { max: 80 }),
    text: text(h.s, h.o, 'text', { max: 300 }), primaryCta: text(h.s, h.o, 'primaryCta', { max: 40 }), secondaryCta: text(h.s, h.o, 'secondaryCta', { max: 40 }),
    slideTrailIds: [],
  };
  const ids = Array.isArray(h.o.slideTrailIds) ? h.o.slideTrailIds : (h.s.fail('slideTrailIds', 'Harus berupa daftar id jejak'), []);
  ids.forEach((id) => { if (!trails.some((t) => t.id === id)) h.s.fail('slideTrailIds', `Jejak dengan id ${id} tidak ada`); });
  if (new Set(ids).size !== ids.length) h.s.fail('slideTrailIds', 'Id jejak tidak boleh ganda');
  if (ids.length > 8) h.s.fail('slideTrailIds', 'Maksimal 8 slide');
  v.hero.slideTrailIds = ids; h.merge();

  v.sections = {};
  const secs = sub('sections');
  for (const k of ['jejak', 'peta']) {
    const inner = ctx(); const so = secs.o[k] && typeof secs.o[k] === 'object' ? secs.o[k] : (secs.s.fail(k, 'Harus berupa objek'), {});
    v.sections[k] = { eyebrow: text(inner, so, 'eyebrow', { max: 80 }), title: text(inner, so, 'title', { max: 80 }), text: text(inner, so, 'text', { max: 200 }) };
    Object.entries(inner.errors).forEach(([e, m]) => c.fail(`sections.${k}.${e}`, m));
  }
  secs.merge();

  const cats = strList(c, o, 'trailCategories', { min: 1, max: 12, item: 30 });
  if (new Set(cats).size !== cats.length) c.fail('trailCategories', 'Kategori tidak boleh ganda');
  const usedT = [...new Set(trails.map((t) => t.cat))].filter((x) => !cats.includes(x));
  if (usedT.length) c.fail('trailCategories', `Masih dipakai oleh jejak: ${usedT.join(', ')}`);
  v.trailCategories = cats;

  const rc = Array.isArray(o.reviewCategories) ? o.reviewCategories : (c.fail('reviewCategories', 'Harus berupa daftar'), []);
  v.reviewCategories = [];
  rc.forEach((x, i) => {
    const inner = ctx(); const xo = x && typeof x === 'object' ? x : {};
    v.reviewCategories.push({ name: text(inner, xo, 'name', { max: 30 }), icon: text(inner, xo, 'icon', { max: 8 }) });
    Object.entries(inner.errors).forEach(([e, m]) => c.fail(`reviewCategories[${i}].${e}`, m));
  });
  if (!v.reviewCategories.length) c.fail('reviewCategories', 'Minimal 1 kategori');
  const names = v.reviewCategories.map((x) => x.name);
  if (new Set(names).size !== names.length) c.fail('reviewCategories', 'Nama kategori tidak boleh ganda');
  const usedR = [...new Set(reviews.map((r) => r.cat))].filter((x) => !names.includes(x));
  if (usedR.length) c.fail('reviewCategories', `Masih dipakai oleh ulasan: ${usedR.join(', ')}`);

  const soc = Array.isArray(o.social) ? o.social : (c.fail('social', 'Harus berupa daftar'), []);
  if (soc.length > 10) c.fail('social', 'Maksimal 10 tautan');
  v.social = [];
  soc.forEach((x, i) => {
    const inner = ctx(); const xo = x && typeof x === 'object' ? x : {};
    v.social.push({ key: oneOf(inner, xo, 'key', SOCIAL_KEYS), label: text(inner, xo, 'label', { max: 30 }), url: webUrl(inner, xo, 'url') });
    Object.entries(inner.errors).forEach(([e, m]) => c.fail(`social[${i}].${e}`, m));
  });

  const f = sub('footer');
  v.footer = { heading: text(f.s, f.o, 'heading', { max: 60 }), rights: text(f.s, f.o, 'rights', { max: 100 }) };
  f.merge();

  c.done(); return v;
}

/* Undangan pengguna (kolaborator repositori GitHub).
   orgRepo=false → repositori pribadi: semua kolaborator berperan Editor (GitHub tidak mengenal peran lain di sana). */
/* Kalkulator Logistik Gunung (data/logistics.json) — angka, kondisi cuaca, dan daftar perlengkapan yang dikelola di CMS. */
const LG_CATS = ['Tidur & Tenda', 'Masak & Makan', 'Pakaian', 'Navigasi & Keselamatan', 'Kesehatan', 'Lainnya'];
const LG_PER = ['orang', 'kelompok', 'orang-hari', 'kelompok-hari'];
const LG_LEVELS = ['Mudah', 'Menengah', 'Menantang'];
function flag(c, o, f) {
  const v = o[f]; if (v === true || v === 'true') return true; if (v === false || v === 'false') return false;
  c.fail(f, 'Harus Ya atau Tidak'); return false;
}
function logistics(input) {
  const c = ctx(), o = obj(c, input);
  const sub = (f) => { const r = o[f]; if (r && typeof r === 'object' && !Array.isArray(r)) return r; c.fail(f, 'Harus berupa objek'); return {}; };
  const nested = (f, fn) => { const s = ctx(); const out = fn(s, sub(f)); Object.entries(s.errors).forEach(([k, m]) => c.fail(`${f}.${k}`, m)); return out; };
  const v = { enabled: flag(c, o, 'enabled'), button: text(c, o, 'button', { max: 40 }), eyebrow: text(c, o, 'eyebrow', { max: 40 }), title: text(c, o, 'title', { max: 60 }), intro: text(c, o, 'intro', { max: 300 }) };
  v.rates = nested('rates', (s, r) => ({ waterL: num(s, r, 'waterL', 0.5, 10), kcal: num(s, r, 'kcal', 1000, 6000, { int: true }), foodKg: num(s, r, 'foodKg', 0.2, 2), fuelG: num(s, r, 'fuelG', 0, 300), canisterG: num(s, r, 'canisterG', 50, 1000, { int: true }), reservePct: num(s, r, 'reservePct', 0, 50, { int: true }) }));
  v.levels = nested('levels', (s, r) => { const out = {}; LG_LEVELS.forEach((k) => { const q = r[k] && typeof r[k] === 'object' ? r[k] : (s.fail(k, 'Wajib diisi'), {}); const t = ctx(); out[k] = { water: num(t, q, 'water', 0.5, 2), kcal: num(t, q, 'kcal', 0.5, 2) }; Object.entries(t.errors).forEach(([f, m]) => s.fail(`${k}.${f}`, m)); }); return out; });

  const conds = Array.isArray(o.conditions) ? o.conditions : (c.fail('conditions', 'Harus berupa daftar'), []);
  if (conds.length < 1 || conds.length > 8) c.fail('conditions', 'Harus 1–8 kondisi cuaca');
  v.conditions = []; const ids = new Set(), names = new Set();
  conds.slice(0, 8).forEach((x, i) => {
    const t = ctx(), q = x && typeof x === 'object' ? x : (t.fail('_', 'Tidak valid'), {});
    const name = text(t, q, 'name', { max: 30 }), id = (typeof q.id === 'string' && /^[a-z0-9-]{1,40}$/.test(q.id) ? q.id : slugify(name)) || `kondisi-${i + 1}`;
    const item = { id, name, water: num(t, q, 'water', 0.5, 2), kcal: num(t, q, 'kcal', 0.5, 2) };
    if (ids.has(id)) t.fail('name', 'Nama kondisi sudah dipakai'); if (names.has(name.toLowerCase())) t.fail('name', 'Nama kondisi sudah dipakai'); ids.add(id); names.add(name.toLowerCase());
    Object.entries(t.errors).forEach(([f, m]) => c.fail(`conditions.${i}.${f}`, m)); v.conditions.push(item);
  });

  v.defaults = nested('defaults', (s, r) => { const cond = typeof r.condition === 'string' ? r.condition : ''; if (!ids.has(cond)) s.fail('condition', 'Pilih salah satu kondisi cuaca yang ada'); return { people: num(s, r, 'people', 1, 50, { int: true }), days: num(s, r, 'days', 1, 30, { int: true }), condition: cond }; });

  const items = Array.isArray(o.items) ? o.items : (c.fail('items', 'Harus berupa daftar'), []);
  if (items.length > 80) c.fail('items', 'Maksimal 80 perlengkapan');
  v.items = []; const iid = new Set(), inames = new Set();
  items.slice(0, 80).forEach((x, i) => {
    const t = ctx(), q = x && typeof x === 'object' ? x : (t.fail('_', 'Tidak valid'), {});
    const name = text(t, q, 'name', { max: 60 });
    const item = { id: (typeof q.id === 'string' && /^[a-z0-9-]{1,60}$/.test(q.id) ? q.id : slugify(name)) || `item-${i + 1}`, name, cat: oneOf(t, q, 'cat', LG_CATS, 'Pilih kategori yang tersedia'), per: oneOf(t, q, 'per', LG_PER, 'Pilih aturan jumlah'),
      qty: num(t, q, 'qty', 0.05, 100), unit: text(t, q, 'unit', { max: 16 }), weightG: num(t, q, 'weightG', 0, 20000), on: flag(t, q, 'on') };
    if (iid.has(item.id) || inames.has(name.toLowerCase())) t.fail('name', 'Nama perlengkapan sudah ada'); iid.add(item.id); inames.add(name.toLowerCase());
    Object.entries(t.errors).forEach(([f, m]) => c.fail(`items.${i}.${f}`, m)); v.items.push(item);
  });
  c.done(); return v;
}

function collaborator(input, { orgRepo = true, existing = [] } = {}) {
  const c = ctx(); const o = obj(c, input);
  const raw = typeof o.username === 'string' ? o.username.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/^@/, '').replace(/\/+$/, '') : o.username;
  const username = text(c, { username: raw }, 'username', { max: 39 });
  if (username && !GH_USER_RE.test(username)) c.fail('username', 'Username GitHub tidak valid (huruf, angka, dan tanda hubung).');
  if (username && existing.some((x) => String(x).toLowerCase() === username.toLowerCase())) c.fail('username', 'Akun ini sudah menjadi pengguna atau sudah diundang.');
  const permission = orgRepo ? oneOf(c, o, 'permission', COLLAB_ROLES, 'Pilih peran pengguna') : 'push';
  c.done(); return { username, permission };
}

return { ValidationError, validators: { trail, track, review, blog, profile, site, logistics, collaborator }, slugify, trackPath, TRACK_RE, TRACK_MAX_PTS, SLUG_RE, DIFFICULTIES, SOCIAL_KEYS, validDate, GH_USER_RE, COLLAB_ROLES };
});
