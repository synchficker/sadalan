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
  c.done(); return v;
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


return { ValidationError, validators: { trail, review, blog, profile, site }, slugify, SLUG_RE, DIFFICULTIES, SOCIAL_KEYS, validDate };
});
