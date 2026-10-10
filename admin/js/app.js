/* Sadalan CMS — aplikasi admin (statis, berjalan penuh di browser).
   Alur: login token GitHub → baca data/*.json dari repositori → edit lewat formulir → validasi (Schema) → commit lewat GitHub API. */
(() => {
  'use strict';
  const { h, icon, toast, confirmBox, drawer, form } = UI;
  const V = Schema.validators;
  const KEY = 'sadalan_cms_session';
  const S = { session: null, data: null, texts: null, pending: new Map(), previews: new Map(), q: {}, f: {}, mediaCache: null };
  const app = document.getElementById('app');
  const ser = (x) => JSON.stringify(x, null, 2) + '\n';
  const today = () => new Date().toLocaleDateString('sv-SE');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const fmtDate = (iso) => { const [y, m, d] = String(iso).split('-'); return `${+d} ${MON[+m - 1] || ''} ${y}`; };
  const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
  const siteUrl = () => new URL('../', location.href).href;

  /* ================= penyimpanan sesi ================= */
  const saveSession = (cfg, remember) => {
    clearSession();
    (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(cfg));
  };
  const loadSession = () => {
    try { return JSON.parse(sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || 'null'); } catch { return null; }
  };
  const clearSession = () => { try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch { /* abaikan */ } };

  /* ================= gambar ================= */
  const readB64 = (blob) => new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => no(new Error('Gagal membaca berkas.'));
    r.readAsDataURL(blob);
  });
  const canvasBlob = (cv, type, q) => new Promise((ok) => cv.toBlob(ok, type, q));

  /* Mengecilkan gambar (maks 1600px) dan menyimpannya sebagai WebP/JPEG; di-commit bersama formulir. */
  async function prepareImage(file) {
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new Error('Format harus PNG, JPG, WebP, atau GIF.');
    if (file.size > 15 * 1024 * 1024) throw new Error('Berkas terlalu besar (maksimal 15 MB).');
    let blob = file, ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
    if (file.type === 'image/gif') {
      if (file.size > 3 * 1024 * 1024) throw new Error('GIF maksimal 3 MB.');
    } else {
      const bmp = await createImageBitmap(file).catch(() => { throw new Error('Gambar tidak bisa dibaca.'); });
      const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(bmp.width * sc)); cv.height = Math.max(1, Math.round(bmp.height * sc));
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      blob = await canvasBlob(cv, 'image/webp', 0.85);
      if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(cv, 'image/jpeg', 0.85);
      ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    }
    const base = Schema.slugify(file.name.replace(/\.[^.]+$/, '')) || 'gambar';
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6);
    const path = `assets/uploads/${stamp}-${base}.${ext}`;
    const url = URL.createObjectURL(blob);
    S.pending.set(path, { base64: await readB64(blob), url });
    S.previews.set(path, url);
    return { path, kb: Math.max(1, Math.round(blob.size / 1024)) };
  }
  const preview = (v) => {
    if (S.previews.has(v)) return S.previews.get(v);
    if (/^(https?:|data:image)/i.test(v)) return v;
    if (/^assets\//.test(v)) return '../' + v;
    return '';
  };
  const deps = () => ({ prepare: prepareImage, preview, trails: S.data.trails });

  /* ================= penulisan ke GitHub ================= */
  /* Membaca data terbaru → menerapkan perubahan (fn) → commit hanya berkas yang berubah.
     Selalu memakai data terbaru dari repositori agar tidak menimpa perubahan orang/perangkat lain. */
  async function mutate(message, fn) {
    const fresh = await Gh.readData();
    const names = fn(fresh.data) || [];
    const files = [], texts = { ...fresh.texts };
    for (const n of new Set(names)) {
      const t = ser(fresh.data[n]);
      if (t !== fresh.texts[n]) { files.push({ path: `data/${n}.json`, text: t }); texts[n] = t; }
    }
    if (!files.length) { S.data = fresh.data; S.texts = fresh.texts; return false; }
    const blob = files.map((f) => f.text).join('\n');
    const used = [];
    for (const [p, v] of S.pending) if (blob.includes(p)) { files.push({ path: p, base64: v.base64 }); used.push(p); }
    await Gh.commit({ message, files });
    used.forEach((p) => S.pending.delete(p));
    S.data = fresh.data; S.texts = texts; S.mediaCache = null;
    return true;
  }
  const published = (msg) => toast(`${msg} Tersimpan ke GitHub — situs publik diperbarui dalam ±1 menit.`);

  function handleErr(e) {
    if (e && e.fields) return toast('Periksa isian yang bertanda merah.', 'err');
    if (e && e.status === 401) { logout('Sesi berakhir: ' + e.message); return; }
    toast((e && e.message) || 'Terjadi kesalahan.', 'err', 7000);
  }

  async function busy(btn, label, fn) {
    const orig = btn.textContent; btn.disabled = true; btn.textContent = label; btn.classList.add('loading');
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = orig; btn.classList.remove('loading'); }
  }

  /* ================= editor (drawer) ================= */
  function openEditor({ title, subtitle, specs, values, saveLabel = 'Simpan & terbitkan', onSave, onDelete }) {
    const f = form(specs, values, deps());
    let dirty = false;
    f.el.addEventListener('input', () => { dirty = true; });
    f.el.addEventListener('change', () => { dirty = true; });
    const save = h('button.btn.primary', { type: 'button' }, saveLabel);
    const cancel = h('button.btn.ghost', { type: 'button' }, 'Batal');
    const del = onDelete ? h('button.btn.danger.ghost', { type: 'button', on: { click: () => { d.close(); onDelete(); } } }, icon('trash', 15), 'Hapus') : h('span.sp');
    const d = drawer({ title, subtitle, body: f.el, footer: [del, h('span.sp'), cancel, save], isDirty: () => dirty, onClose: () => { for (const [p, v] of S.pending) { if (!S.previews.has(p)) URL.revokeObjectURL(v.url); } S.pending.clear(); } });
    cancel.addEventListener('click', d.tryClose);
    const go = async () => {
      try {
        const ok = await busy(save, 'Menyimpan…', () => onSave(f.collect()));
        dirty = false; d.close(); return ok;
      } catch (e) { if (e && e.fields) { f.showErrors(e.fields); } handleErr(e); }
    };
    save.addEventListener('click', go);
    return d;
  }

  const textSpec = (k, label, o = {}) => ({ k, label, ...o });

  /* ---------- Jejak ---------- */
  const nextId = (arr) => arr.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;

  function trailSpecs() {
    const site = S.data.site;
    return [
      textSpec('name', 'Nama jejak', { ph: 'Gunung …' }),
      textSpec('loc', 'Lokasi', { ph: 'Kabupaten, Provinsi', half: true }),
      { k: 'cat', label: 'Kategori', type: 'select', options: site.trailCategories, half: true },
      { k: 'difficulty', label: 'Kesulitan', type: 'select', options: Schema.DIFFICULTIES, half: true },
      textSpec('rating', 'Rating (0–5)', { inputmode: 'decimal', half: true, ph: '4,5' }),
      textSpec('elev', 'Ketinggian', { ph: '2.665 mdpl', half: true }),
      textSpec('dist', 'Jarak', { ph: '8,4 km', half: true }),
      textSpec('time', 'Waktu tempuh', { ph: '4–5 jam', half: true }),
      textSpec('lat', 'Latitude', { inputmode: 'decimal', ph: '-7.3198', half: true }),
      textSpec('lng', 'Longitude', { inputmode: 'decimal', ph: '107.7313', half: true, hint: 'Di Google Maps: klik kanan pada lokasi → salin koordinat.' }),
      { k: 'img', label: 'Foto', type: 'image' },
      textSpec('desc', 'Deskripsi', { type: 'textarea', rows: 4 }),
    ];
  }

  function editTrail(t) {
    const isNew = !t;
    openEditor({
      title: isNew ? 'Tambah jejak' : 'Ubah jejak', subtitle: isNew ? null : t.name, specs: trailSpecs(),
      values: t || { difficulty: 'Menengah', cat: S.data.site.trailCategories[0], rating: 4.5 },
      onDelete: isNew ? null : () => delTrail(t),
      onSave: async (raw) => {
        await mutate(isNew ? `Tambah jejak: ${String(raw.name).trim()}` : `Ubah jejak: ${t.name}`, (d) => {
          const v = V.trail(raw, { site: d.site });
          if (isNew) d.trails.push({ id: nextId(d.trails), ...v });
          else { const i = d.trails.findIndex((x) => x.id === t.id); if (i < 0) throw new Error('Jejak ini sudah dihapus di tempat lain. Muat ulang data.'); d.trails[i] = { id: t.id, ...v }; }
          return ['trails'];
        });
        published(isNew ? 'Jejak ditambahkan.' : 'Jejak diperbarui.'); route();
      },
    });
  }
  async function delTrail(t) {
    const inHero = S.data.site.hero.slideTrailIds.includes(t.id);
    if (!(await confirmBox({ title: `Hapus “${t.name}”?`, text: 'Jejak akan dihapus permanen dari situs.' + (inHero ? ' Slide hero yang menunjuk jejak ini ikut dibersihkan.' : ''), ok: 'Hapus', danger: true }))) return;
    try {
      await mutate(`Hapus jejak: ${t.name}`, (d) => {
        d.trails = d.trails.filter((x) => x.id !== t.id);
        d.site.hero.slideTrailIds = d.site.hero.slideTrailIds.filter((id) => id !== t.id);
        return ['trails', 'site'];
      });
      published('Jejak dihapus.'); route();
    } catch (e) { handleErr(e); }
  }

  /* ---------- Ulasan ---------- */
  function reviewSpecs() {
    const cats = S.data.site.reviewCategories.map((c) => [c.name, `${c.icon} ${c.name}`]);
    return [
      textSpec('title', 'Judul ulasan'),
      { k: 'cat', label: 'Kategori', type: 'select', options: cats, half: true },
      { k: 'rating', label: 'Rating', type: 'select', options: [[5, '★★★★★ (5)'], [4, '★★★★ (4)'], [3, '★★★ (3)'], [2, '★★ (2)'], [1, '★ (1)']], half: true },
      textSpec('loc', 'Lokasi', { optional: true, half: true }),
      textSpec('author', 'Penulis', { optional: true, half: true, ph: 'Pendaki Sadalan' }),
      textSpec('iso', 'Tanggal', { type: 'date', half: true }),
      { k: 'img', label: 'Foto', type: 'image', optional: true },
      textSpec('text', 'Ringkasan', { type: 'textarea', rows: 3, hint: 'Tampil di daftar ulasan (10–600 karakter).' }),
      { k: 'body', label: 'Isi lengkap', type: 'paras', rows: 6, optional: true, hint: 'Pisahkan paragraf dengan satu baris kosong.' },
      { k: 'pros', label: 'Kelebihan', type: 'lines', rows: 3, optional: true, hint: 'Satu butir per baris.' },
      { k: 'cons', label: 'Kekurangan', type: 'lines', rows: 3, optional: true, hint: 'Satu butir per baris.' },
      { k: 'tags', label: 'Tag', type: 'csv', optional: true, hint: 'Pisahkan dengan koma.', ph: 'sunrise, camping' },
    ];
  }
  function editReview(r) {
    const isNew = !r;
    openEditor({
      title: isNew ? 'Tambah ulasan' : 'Ubah ulasan', subtitle: isNew ? null : r.title, specs: reviewSpecs(),
      values: r || { cat: S.data.site.reviewCategories[0].name, rating: 5, iso: today(), author: 'Pendaki Sadalan' },
      onDelete: isNew ? null : () => delReview(r),
      onSave: async (raw) => {
        await mutate(isNew ? `Tambah ulasan: ${String(raw.title).trim()}` : `Ubah ulasan: ${r.title}`, (d) => {
          const v = V.review(raw, { site: d.site });
          if (isNew) d.reviews.push({ id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...v });
          else { const i = d.reviews.findIndex((x) => x.id === r.id); if (i < 0) throw new Error('Ulasan ini sudah dihapus di tempat lain. Muat ulang data.'); d.reviews[i] = { id: r.id, ...v }; }
          return ['reviews'];
        });
        published(isNew ? 'Ulasan ditambahkan.' : 'Ulasan diperbarui.'); route();
      },
    });
  }
  async function delReview(r) {
    if (!(await confirmBox({ title: `Hapus ulasan “${r.title}”?`, text: 'Ulasan akan dihapus permanen dari situs.', ok: 'Hapus', danger: true }))) return;
    try { await mutate(`Hapus ulasan: ${r.title}`, (d) => { d.reviews = d.reviews.filter((x) => x.id !== r.id); return ['reviews']; }); published('Ulasan dihapus.'); route(); }
    catch (e) { handleErr(e); }
  }

  /* ---------- Artikel ---------- */
  function blogSpecs() {
    return [
      textSpec('title', 'Judul artikel'),
      textSpec('cat', 'Kategori', { half: true, list: 'blog-cats', hint: 'Ketik baru atau pilih yang sudah ada.' }),
      textSpec('date', 'Tanggal terbit', { type: 'date', half: true }),
      textSpec('author', 'Penulis', { half: true }),
      { k: 'img', label: 'Gambar sampul', type: 'image' },
      textSpec('text', 'Ringkasan', { type: 'textarea', rows: 3, hint: 'Tampil di daftar artikel dan deskripsi SEO (maks 400 karakter).' }),
      { k: 'body', label: 'Isi artikel', type: 'blocks' },
    ];
  }
  function editPost(p) {
    const isNew = !p;
    const d = openEditor({
      title: isNew ? 'Tulis artikel' : 'Ubah artikel', subtitle: isNew ? null : p.title, specs: blogSpecs(),
      values: p || { date: today(), author: 'Tim Sadalan', body: [''] },
      onDelete: isNew ? null : () => delPost(p),
      onSave: async (raw) => {
        await mutate(isNew ? `Tambah artikel: ${String(raw.title).trim()}` : `Ubah artikel: ${p.title}`, (db) => {
          const v = V.blog(raw, { existingId: isNew ? undefined : p.id });
          if (isNew) {
            const base = Schema.slugify(v.title) || 'artikel'; let id = base, n = 2;
            while (db.blog.some((x) => x.id === id)) id = `${base}-${n++}`;
            db.blog.push({ id, ...v });
          } else { const i = db.blog.findIndex((x) => x.id === p.id); if (i < 0) throw new Error('Artikel ini sudah dihapus di tempat lain. Muat ulang data.'); db.blog[i] = { id: p.id, ...v }; }
          return ['blog'];
        });
        published(isNew ? 'Artikel diterbitkan.' : 'Artikel diperbarui.'); route();
      },
    });
    const dl = h('datalist', { id: 'blog-cats' }, [...new Set(S.data.blog.map((x) => x.cat))].map((c) => h('option', { value: c })));
    d.panel.append(dl);
  }
  async function delPost(p) {
    if (!(await confirmBox({ title: `Hapus “${p.title}”?`, text: 'Artikel akan dihapus permanen. Tautan lama ke artikel ini akan menampilkan halaman “tidak ditemukan”.', ok: 'Hapus', danger: true }))) return;
    try { await mutate(`Hapus artikel: ${p.title}`, (d) => { d.blog = d.blog.filter((x) => x.id !== p.id); return ['blog']; }); published('Artikel dihapus.'); route(); }
    catch (e) { handleErr(e); }
  }

  /* ================= komponen tampilan ================= */
  const thumb = (src) => { const i = h('img.tbl-thumb', { alt: '', loading: 'lazy', src: preview(src || '') || null }); i.addEventListener('error', () => i.classList.add('broken')); if (!src) i.classList.add('broken'); return i; };

  function pageHead(title, sub, ...actions) {
    return h('div.page-head', h('div', h('h1', title), sub ? h('p', sub) : null), h('div.page-actions', actions));
  }

  function collection({ key, title, sub, addLabel, onAdd, items, columns, sort, filter, searchOf, onEdit, empty }) {
    const q = (S.q[key] ||= ''); const fv = (S.f[key] ||= '');
    const body = h('tbody'); const count = h('span.count');
    const search = h('input', { type: 'search', placeholder: 'Cari…', value: q, 'aria-label': 'Cari', autocomplete: 'off' });
    const sel = filter ? h('select', { 'aria-label': filter.label }, h('option', { value: '' }, filter.label), filter.options.map((o) => h('option', { value: o, selected: o === fv }, o))) : null;
    const paint = () => {
      const qq = search.value.trim().toLowerCase(); S.q[key] = search.value; if (sel) S.f[key] = sel.value;
      let rows = [...items].sort(sort);
      if (qq) rows = rows.filter((r) => searchOf(r).toLowerCase().includes(qq));
      if (sel && sel.value) rows = rows.filter((r) => filter.get(r) === sel.value);
      count.textContent = `${rows.length} dari ${items.length}`;
      body.replaceChildren(...(rows.length ? rows.map((r) => h('tr', { tabindex: 0, on: { click: () => onEdit(r), keydown: (e) => { if (e.key === 'Enter') onEdit(r); } } }, columns.map((c) => h('td' + (c.cls ? '.' + c.cls : ''), { 'data-label': c.h }, c.cell(r))))) : [h('tr.none', h('td', { colspan: columns.length }, items.length ? 'Tidak ada yang cocok dengan pencarian.' : empty))]));
    };
    search.addEventListener('input', paint); if (sel) sel.addEventListener('change', paint);
    paint();
    return h('section', pageHead(title, sub, h('button.btn.primary', { type: 'button', on: { click: onAdd } }, icon('plus', 16), addLabel)),
      h('div.toolbar', h('div.search', icon('search', 16), search), sel, h('span.sp'), count),
      h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', columns.map((c) => h('th' + (c.cls ? '.' + c.cls : ''), c.h)))), body)));
  }

  const rowBtns = (edit, del) => h('div.row-btns', h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Ubah', title: 'Ubah', on: { click: (e) => { e.stopPropagation(); edit(); } } }, icon('edit', 16)),
    h('button.icon-btn.sm.danger', { type: 'button', 'aria-label': 'Hapus', title: 'Hapus', on: { click: (e) => { e.stopPropagation(); del(); } } }, icon('trash', 16)));
  const titleCell = (a, b) => h('div.tcell', h('b', a), b ? h('small', b) : null);

  /* ================= halaman ================= */
  function viewDashboard() {
    const { trails, reviews, blog, site } = S.data;
    const c = Gh.ctx();
    const stat = (n, label, ic, href) => h('a.stat', { href }, h('span.stat-ic', icon(ic, 22)), h('div', h('b', String(n)), h('span', label)));
    const latest = (arr, sortKey, label, fn) => h('div.panel', h('h3', label),
      arr.length ? h('ul.mini', [...arr].sort((a, b) => String(b[sortKey]).localeCompare(String(a[sortKey]))).slice(0, 5).map(fn)) : h('p.empty-mini', 'Belum ada data.'));
    return h('section', pageHead(`Halo, ${S.session.user.name.split(' ')[0]} 👋`, `Mengelola ${site.name} — ${site.tagline}`,
      h('a.btn.ghost', { href: siteUrl(), target: '_blank', rel: 'noopener' }, icon('ext', 15), 'Lihat situs')),
      h('div.stats', stat(trails.length, 'Jejak', 'trail', '#/trails'), stat(reviews.length, 'Ulasan', 'review', '#/reviews'), stat(blog.length, 'Artikel', 'blog', '#/blog')),
      h('div.quick', h('button.btn.primary', { type: 'button', on: { click: () => editTrail() } }, icon('plus', 15), 'Jejak'),
        h('button.btn.primary', { type: 'button', on: { click: () => editReview() } }, icon('plus', 15), 'Ulasan'),
        h('button.btn.primary', { type: 'button', on: { click: () => editPost() } }, icon('plus', 15), 'Artikel')),
      h('div.grid2',
        latest(reviews, 'iso', 'Ulasan terbaru', (r) => h('li', { on: { click: () => editReview(r) } }, h('span.ic', S.data.site.reviewCategories.find((x) => x.name === r.cat)?.icon || '•'), h('div', h('b', r.title), h('small', `${stars(r.rating)} · ${fmtDate(r.iso)}`)))),
        latest(blog, 'date', 'Artikel terbaru', (p) => h('li', { on: { click: () => editPost(p) } }, h('span.ic', '📝'), h('div', h('b', p.title), h('small', `${p.cat} · ${fmtDate(p.date)}`))))),
      h('div.panel.info', h('h3', icon('git', 18), 'Cara kerja penerbitan'),
        h('p', 'Setiap kali Anda menyimpan, CMS membuat satu commit ke ', h('code', `${c.owner}/${c.repo}`), ' pada branch ', h('code', c.branch), '. GitHub Pages lalu membangun ulang situs — biasanya selesai dalam 1–2 menit. Semua riwayat perubahan tersimpan di Git, jadi setiap edit bisa dibatalkan.'),
        h('div.links', h('a', { href: `https://github.com/${c.owner}/${c.repo}/commits/${c.branch}`, target: '_blank', rel: 'noopener' }, 'Riwayat perubahan ↗'),
          h('a', { href: `https://github.com/${c.owner}/${c.repo}/actions`, target: '_blank', rel: 'noopener' }, 'Status penerbitan ↗'))));
  }

  function viewTrails() {
    return collection({
      key: 'trails', title: 'Jejak Pendakian', sub: 'Rute yang tampil di daftar jejak, peta, dan slide hero.', addLabel: 'Tambah jejak', onAdd: () => editTrail(),
      items: S.data.trails, sort: (a, b) => a.name.localeCompare(b.name), searchOf: (t) => `${t.name} ${t.loc} ${t.cat} ${t.difficulty}`,
      filter: { label: 'Semua kategori', options: S.data.site.trailCategories, get: (t) => t.cat }, onEdit: editTrail, empty: 'Belum ada jejak. Klik “Tambah jejak”.',
      columns: [
        { h: '', cls: 'th-img', cell: (t) => thumb(t.img) },
        { h: 'Jejak', cell: (t) => titleCell(t.name, t.loc) },
        { h: 'Kategori', cls: 'hide-sm', cell: (t) => h('span.chip', t.cat) },
        { h: 'Kesulitan', cell: (t) => h('span.badge.d-' + t.difficulty, t.difficulty) },
        { h: 'Rating', cls: 'hide-sm', cell: (t) => h('span.num', '★ ' + Number(t.rating).toFixed(1)) },
        { h: '', cls: 'th-act', cell: (t) => rowBtns(() => editTrail(t), () => delTrail(t)) },
      ],
    });
  }
  function viewReviews() {
    const icons = Object.fromEntries(S.data.site.reviewCategories.map((c) => [c.name, c.icon]));
    return collection({
      key: 'reviews', title: 'Ulasan', sub: 'Ulasan yang tampil di modal Reviews. Ulasan yang ditulis pengunjung di perangkatnya sendiri tidak tercatat di sini.', addLabel: 'Tambah ulasan', onAdd: () => editReview(),
      items: S.data.reviews, sort: (a, b) => b.iso.localeCompare(a.iso), searchOf: (r) => `${r.title} ${r.loc || ''} ${r.author} ${r.cat} ${(r.tags || []).join(' ')}`,
      filter: { label: 'Semua kategori', options: S.data.site.reviewCategories.map((c) => c.name), get: (r) => r.cat }, onEdit: editReview, empty: 'Belum ada ulasan.',
      columns: [
        { h: '', cls: 'th-img', cell: (r) => thumb(r.img) },
        { h: 'Ulasan', cell: (r) => titleCell(r.title, [r.loc, r.author].filter(Boolean).join(' · ')) },
        { h: 'Kategori', cls: 'hide-sm', cell: (r) => h('span.chip', `${icons[r.cat] || ''} ${r.cat}`) },
        { h: 'Rating', cell: (r) => h('span.num.star', stars(r.rating)) },
        { h: 'Tanggal', cls: 'hide-sm', cell: (r) => fmtDate(r.iso) },
        { h: '', cls: 'th-act', cell: (r) => rowBtns(() => editReview(r), () => delReview(r)) },
      ],
    });
  }
  function viewBlog() {
    return collection({
      key: 'blog', title: 'Artikel', sub: 'Tulisan di modal Blog dan halaman detail artikel.', addLabel: 'Tulis artikel', onAdd: () => editPost(),
      items: S.data.blog, sort: (a, b) => b.date.localeCompare(a.date), searchOf: (p) => `${p.title} ${p.cat} ${p.author} ${p.text}`,
      filter: { label: 'Semua kategori', options: [...new Set(S.data.blog.map((p) => p.cat))], get: (p) => p.cat }, onEdit: editPost, empty: 'Belum ada artikel.',
      columns: [
        { h: '', cls: 'th-img', cell: (p) => thumb(p.img) },
        { h: 'Judul', cell: (p) => titleCell(p.title, p.author) },
        { h: 'Kategori', cls: 'hide-sm', cell: (p) => h('span.chip', p.cat) },
        { h: 'Terbit', cell: (p) => fmtDate(p.date) },
        { h: '', cls: 'th-act', cell: (p) => rowBtns(() => editPost(p), () => delPost(p)) },
      ],
    });
  }

  /* halaman berisi satu formulir panjang (profil, pengaturan situs) */
  function formPage({ title, sub, specs, values, onSave, extra }) {
    const f = form(specs, values, deps());
    const save = h('button.btn.primary', { type: 'button' }, 'Simpan & terbitkan');
    const reset = h('button.btn.ghost', { type: 'button', on: { click: () => route() } }, 'Kembalikan');
    let dirty = false;
    f.el.addEventListener('input', () => { dirty = true; bar.classList.add('show'); });
    f.el.addEventListener('change', () => { dirty = true; bar.classList.add('show'); });
    const bar = h('div.savebar', h('span', icon('alert', 16), 'Ada perubahan yang belum diterbitkan'), h('span.sp'), reset, save);
    save.addEventListener('click', async () => {
      try { await busy(save, 'Menyimpan…', () => onSave(f.collect())); dirty = false; } catch (e) { if (e.fields) f.showErrors(e.fields); handleErr(e); }
    });
    window.onbeforeunload = () => (dirty ? 'Ada perubahan yang belum disimpan.' : undefined);
    const sec = h('section', pageHead(title, sub), extra || null, h('div.panel.formpanel', f.el), bar);
    return sec;
  }

  function viewProfile() {
    return formPage({
      title: 'Profil', sub: 'Isi modal “Profile” di situs.', values: S.data.profile,
      specs: [
        textSpec('title', 'Judul modal'), textSpec('heading', 'Judul kartu', { half: true }),
        textSpec('head', 'Pengantar', { type: 'textarea', rows: 3 }),
        { k: 'image', label: 'Foto profil', type: 'image' },
        textSpec('imageAlt', 'Teks alternatif foto', { half: true }), textSpec('caption', 'Keterangan foto', { half: true }),
        { k: 'body', label: 'Isi', type: 'paras', rows: 12, hint: 'Pisahkan paragraf dengan satu baris kosong.' },
      ],
      onSave: async (raw) => { await mutate('Perbarui profil', (d) => { d.profile = V.profile(raw); return ['profile']; }); published('Profil diperbarui.'); route(); },
    });
  }

  function viewSite() {
    const site = S.data.site;
    const values = {
      ...site,
      trailCategories: site.trailCategories.map((n) => ({ name: n, _orig: n })),
      reviewCategories: site.reviewCategories.map((c) => ({ ...c, _orig: c.name })),
    };
    return formPage({
      title: 'Pengaturan situs', sub: 'Nama, hero, judul section, kategori, tautan sosial, dan footer.', values,
      specs: [
        { group: 'Identitas' },
        textSpec('name', 'Nama situs', { half: true }), textSpec('tagline', 'Tagline', { half: true }),
        textSpec('description', 'Deskripsi situs (meta SEO)', { type: 'textarea', rows: 2 }),
        { group: 'Hero — halaman utama' },
        textSpec('hero.eyebrow', 'Label kecil'), textSpec('hero.title1', 'Judul baris 1', { half: true }), textSpec('hero.title2', 'Judul baris 2 (miring)', { half: true }),
        textSpec('hero.text', 'Teks pengantar', { type: 'textarea', rows: 3 }),
        textSpec('hero.primaryCta', 'Tombol utama', { half: true }), textSpec('hero.secondaryCta', 'Tombol kedua', { half: true }),
        { k: 'hero.slideTrailIds', label: 'Slide hero (maks. 8)', type: 'trailpick', hint: 'Jejak yang tampil sebagai slide, sesuai urutan.' },
        { group: 'Judul section' },
        textSpec('sections.jejak.eyebrow', 'Jejak — label', { half: true }), textSpec('sections.jejak.title', 'Jejak — judul', { half: true }), textSpec('sections.jejak.text', 'Jejak — teks'),
        textSpec('sections.peta.eyebrow', 'Peta — label', { half: true }), textSpec('sections.peta.title', 'Peta — judul', { half: true }), textSpec('sections.peta.text', 'Peta — teks'),
        { group: 'Kategori', note: 'Mengubah nama kategori ikut memperbarui jejak/ulasan yang memakainya. Kategori yang masih dipakai tidak bisa dihapus.' },
        { k: 'trailCategories', label: 'Kategori jejak', type: 'repeat', cols: [{ k: 'name', label: 'Nama kategori' }], blank: { name: '' }, addLabel: 'Tambah kategori' },
        { k: 'reviewCategories', label: 'Kategori ulasan', type: 'repeat', cols: [{ k: 'icon', label: 'Ikon', w: 'xs' }, { k: 'name', label: 'Nama kategori' }], blank: { icon: '✨', name: '' }, addLabel: 'Tambah kategori' },
        { group: 'Sosial media & footer' },
        { k: 'social', label: 'Tautan sosial', type: 'repeat', cols: [{ k: 'key', label: 'Platform', options: Schema.SOCIAL_KEYS, w: 'sm' }, { k: 'label', label: 'Label', w: 'sm' }, { k: 'url', label: 'https://…' }], blank: { key: 'instagram', label: '', url: '' }, addLabel: 'Tambah tautan' },
        textSpec('footer.heading', 'Judul footer', { half: true }), textSpec('footer.rights', 'Teks hak cipta', { half: true }),
      ],
      onSave: async (raw) => {
        const renT = {}, renR = {};
        const tc = raw.trailCategories.map((r) => { const n = String(r.name || '').trim(); if (r._orig && n && r._orig !== n) renT[r._orig] = n; return n; });
        const rc = raw.reviewCategories.map((r) => { const n = String(r.name || '').trim(); if (r._orig && n && r._orig !== n) renR[r._orig] = n; return { name: n, icon: String(r.icon || '').trim() }; });
        await mutate('Perbarui pengaturan situs', (d) => {
          d.trails.forEach((t) => { if (renT[t.cat]) t.cat = renT[t.cat]; });
          d.reviews.forEach((r) => { if (renR[r.cat]) r.cat = renR[r.cat]; });
          d.site = V.site({ ...raw, trailCategories: tc, reviewCategories: rc }, { trails: d.trails, reviews: d.reviews });
          return ['site', 'trails', 'reviews'];
        });
        published('Pengaturan situs diperbarui.'); route();
      },
    });
  }

  /* ---------- Media ---------- */
  async function viewMedia() {
    const wrap = h('section', pageHead('Media', 'Gambar yang diunggah ke assets/uploads/ di repositori.'));
    const grid = h('div.media-grid', h('p.empty-mini', 'Memuat…'));
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, hidden: true });
    const upBtn = h('button.btn.primary', { type: 'button', on: { click: () => input.click() } }, icon('upload', 15), 'Unggah gambar');
    wrap.querySelector('.page-actions').append(upBtn, input);
    wrap.append(grid);
    const usedIn = (path) => Object.entries(S.texts).filter(([, t]) => t.includes(path)).map(([n]) => n);
    const paint = (files) => {
      grid.replaceChildren(...(files.length ? files.map((f) => {
        const path = `assets/uploads/${f.name}`; const used = usedIn(path);
        const img = h('img', { alt: '', loading: 'lazy', src: S.previews.get(path) || f.download_url });
        return h('figure.media', h('div.media-img', img), h('figcaption', h('b', f.name), h('small', `${Math.max(1, Math.round(f.size / 1024))} KB · ${used.length ? 'dipakai di ' + used.join(', ') : 'belum dipakai'}`)),
          h('div.row-btns', h('button.btn.ghost.sm', { type: 'button', on: { click: async () => { try { await navigator.clipboard.writeText(path); toast('Path disalin: ' + path); } catch { toast(path); } } } }, icon('copy', 14), 'Salin path'),
            h('button.icon-btn.sm.danger', { type: 'button', 'aria-label': 'Hapus', on: { click: async () => {
              if (used.length) return toast(`Gambar masih dipakai di ${used.join(', ')}. Ganti gambarnya dulu sebelum menghapus.`, 'err', 6000);
              if (!(await confirmBox({ title: 'Hapus gambar?', text: f.name, ok: 'Hapus', danger: true }))) return;
              try { await Gh.commit({ message: `Hapus gambar: ${f.name}`, files: [{ path, remove: true }] }); S.mediaCache = null; toast('Gambar dihapus.'); route(); } catch (e) { handleErr(e); }
            } } }, icon('trash', 16))));
      }) : [h('p.empty-mini', 'Belum ada gambar yang diunggah. Gambar juga bisa diunggah langsung dari formulir jejak, ulasan, artikel, dan profil.')]));
    };
    input.addEventListener('change', async () => {
      const list = [...input.files]; if (!list.length) return;
      try {
        await busy(upBtn, 'Mengunggah…', async () => {
          const files = [];
          for (const f of list) { const r = await prepareImage(f); files.push({ path: r.path, base64: S.pending.get(r.path).base64 }); }
          await Gh.commit({ message: `Unggah ${files.length} gambar`, files });
          files.forEach((f) => S.pending.delete(f.path)); S.mediaCache = null;
          toast(`${files.length} gambar diunggah. Tampil di situs dalam ±1 menit.`); route();
        });
      } catch (e) { handleErr(e); }
      input.value = '';
    });
    try { S.mediaCache ||= await Gh.list('assets/uploads'); paint(S.mediaCache.filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f.name))); }
    catch (e) { grid.replaceChildren(h('p.empty-mini', e.message)); }
    return wrap;
  }

  /* ================= kerangka & router ================= */
  const NAV = [['dashboard', 'Ringkasan', 'dash'], ['trails', 'Jejak', 'trail'], ['reviews', 'Ulasan', 'review'], ['blog', 'Artikel', 'blog'], ['profile', 'Profil', 'user'], ['site', 'Pengaturan situs', 'gear'], ['media', 'Media', 'image']];
  const VIEWS = { dashboard: viewDashboard, trails: viewTrails, reviews: viewReviews, blog: viewBlog, profile: viewProfile, site: viewSite, media: viewMedia };
  let main = null, navEl = null;

  function shell() {
    const c = Gh.ctx(), u = S.session.user;
    main = h('main#main', { tabindex: -1 });
    navEl = h('nav.nav', { 'aria-label': 'Menu admin' }, NAV.map(([id, label, ic]) => h('a', { href: '#/' + id, 'data-id': id }, icon(ic, 18), label)));
    const side = h('aside.side', h('div.brand', h('img', { src: '../assets/images/logo.png', alt: '', width: 28, height: 28 }), h('div', h('b', 'Sadalan'), h('small', 'CMS'))),
      navEl,
      h('div.side-foot', h('div.who', u.avatar ? h('img', { src: u.avatar, alt: '' }) : null, h('div', h('b', u.name), h('small', `${c.owner}/${c.repo} · ${c.branch}`))),
        h('div.side-btns', h('button.btn.ghost.sm', { type: 'button', title: 'Ambil ulang data dari GitHub', on: { click: reload } }, 'Muat ulang'),
          h('button.btn.ghost.sm', { type: 'button', on: { click: () => logout() } }, icon('out', 14), 'Keluar'))));
    const top = h('header.topbar', h('button.icon-btn', { type: 'button', 'aria-label': 'Menu', on: { click: () => document.body.classList.toggle('nav-open') } }, icon('menu')), h('b', 'Sadalan CMS'));
    app.replaceChildren(h('div.layout', side, h('div.content', top, main)), h('div.nav-scrim', { on: { click: () => document.body.classList.remove('nav-open') } }));
  }

  async function route() {
    if (!S.session) return;
    window.onbeforeunload = null;
    const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
    const name = VIEWS[id] ? id : 'dashboard';
    document.body.classList.remove('nav-open');
    navEl.querySelectorAll('a').forEach((a) => (a.dataset.id === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (a11yTitle(name)) document.title = `${a11yTitle(name)} — Sadalan CMS`;
    const token = (route.t = (route.t || 0) + 1);
    const el = await VIEWS[name]();
    if (token !== route.t) return;
    main.replaceChildren(el); window.scrollTo(0, 0);
  }
  const a11yTitle = (n) => (NAV.find((x) => x[0] === n) || [])[1];

  async function reload() {
    try { const r = await Gh.readData(); S.data = r.data; S.texts = r.texts; S.mediaCache = null; toast('Data dimuat ulang dari GitHub.'); route(); } catch (e) { handleErr(e); }
  }

  /* ================= login ================= */
  function loginView(message) {
    const det = Gh.detect(); const saved = loadSession() || {};
    const owner = h('input', { value: saved.owner || (det && det.owner) || '', placeholder: 'pemilik', autocomplete: 'off', 'aria-label': 'Pemilik repositori' });
    const repo = h('input', { value: saved.repo || (det && det.repo) || '', placeholder: 'nama-repositori', autocomplete: 'off', 'aria-label': 'Nama repositori' });
    const branch = h('input', { value: saved.branch || '', placeholder: 'otomatis (branch utama)', autocomplete: 'off', 'aria-label': 'Branch' });
    const token = h('input', { type: 'password', placeholder: 'github_pat_…  atau  ghp_…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Token API GitHub', required: true });
    const remember = h('input', { type: 'checkbox', id: 'remember' });
    const err = h('p.login-err', { role: 'alert' }, message || '');
    const eye = h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Tampilkan token', on: { click: () => { token.type = token.type === 'password' ? 'text' : 'password'; } } }, icon('eye', 16));
    const btn = h('button.btn.primary.block', { type: 'submit' }, 'Masuk');
    const repoLine = h('p.repo-line');
    const adv = h('div.adv', { hidden: !!(owner.value && repo.value) }, h('div.two', h('label', 'Pemilik', owner), h('label', 'Repositori', repo)), h('label', 'Branch (opsional)', branch));
    const syncLine = () => { repoLine.replaceChildren('Repositori: ', h('b', owner.value && repo.value ? `${owner.value}/${repo.value}` : 'belum diisi'), ' ', h('button.link', { type: 'button', on: { click: () => { adv.hidden = !adv.hidden; } } }, 'ubah')); };
    syncLine(); owner.addEventListener('input', syncLine); repo.addEventListener('input', syncLine);
    const fm = h('form.login-card', { novalidate: true, on: { submit: async (e) => {
      e.preventDefault(); err.textContent = '';
      if (!token.value.trim()) { err.textContent = 'Tempel token API GitHub Anda.'; token.focus(); return; }
      if (!owner.value.trim() || !repo.value.trim()) { adv.hidden = false; err.textContent = 'Isi pemilik dan nama repositori.'; return; }
      btn.disabled = true; btn.textContent = 'Memeriksa token…';
      try {
        const cfg = { owner: owner.value.trim(), repo: repo.value.trim(), branch: branch.value.trim(), token: token.value.trim() };
        const info = await Gh.connect(cfg);
        saveSession({ ...cfg, branch: info.branch }, remember.checked);
        await start(info);
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Masuk'; }
    } } },
      h('div.login-brand', h('img', { src: '../assets/images/logo.png', alt: '', width: 44, height: 44 }), h('h1', 'Sadalan CMS'), h('p', 'Masuk dengan token API GitHub untuk mengelola konten situs.')),
      repoLine, adv,
      h('label.tok', 'Token API GitHub', h('div.tok-row', token, eye)),
      h('label.chk', remember, 'Ingat di perangkat ini', h('small', 'Jangan dicentang di komputer bersama.')),
      err, btn,
      h('details.help', h('summary', 'Belum punya token? Cara membuatnya'),
        h('ol', h('li', 'Buka ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'GitHub → Settings → Fine-grained tokens'), '.'),
          h('li', 'Pada “Repository access”, pilih ', h('b', 'Only select repositories'), ' lalu pilih repositori situs ini.'),
          h('li', 'Pada “Permissions → Repository”, atur ', h('b', 'Contents'), ' ke ', h('b', 'Read and write'), '.'),
          h('li', 'Klik Generate, lalu tempel token di atas. Token hanya disimpan di browser ini dan hanya dikirim ke api.github.com.'),
          h('li', 'Token klasik juga bisa dipakai dengan scope ', h('code', 'repo'), ' (atau ', h('code', 'public_repo'), ' untuk repositori publik).'))));
    app.replaceChildren(h('div.login', fm));
    token.focus();
  }

  async function start(info) {
    const r = await Gh.readData();
    S.session = { user: info.user, repo: info.repo }; S.data = r.data; S.texts = r.texts;
    shell();
    if (!location.hash) location.hash = '#/dashboard';
    await route();
  }

  function logout(message) {
    Gh.disconnect(); clearSession(); S.session = null; S.data = null; S.pending.clear(); S.q = {}; S.f = {}; S.mediaCache = null;
    window.onbeforeunload = null; document.body.classList.remove('nav-open');
    loginView(message);
  }

  window.addEventListener('hashchange', route);
  document.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG') e.target.classList.add('broken'); }, true);

  /* ================= mulai ================= */
  (async () => {
    const saved = loadSession();
    if (saved && saved.token) {
      app.replaceChildren(h('div.boot', 'Memulihkan sesi…'));
      try { const info = await Gh.connect(saved); await start(info); return; }
      catch (e) { clearSession(); loginView(e.status === 401 ? 'Sesi sebelumnya berakhir: ' + e.message : e.message); return; }
    }
    loginView();
  })();
})();
