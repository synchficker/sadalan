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
  /* Memuat rute GPS (data/tracks/<id>.json) dari repositori → segmen. */
  async function loadTrack(path) {
    if (!Schema.TRACK_RE.test(String(path))) throw new Error('Path rute tidak valid.');
    const text = await Gh.readText(path);
    try { return Geo.unpack(text); } catch { throw new Error('Berkas rute rusak atau formatnya tidak dikenali.'); }
  }
  const deps = () => ({ prepare: prepareImage, preview, trails: S.data.trails, loadTrack });

  /* ================= penulisan ke GitHub ================= */
  /* Membaca data terbaru → menerapkan perubahan (fn) → commit hanya berkas yang berubah.
     Selalu memakai data terbaru dari repositori agar tidak menimpa perubahan orang/perangkat lain. */
  async function mutate(message, fn) {
    const fresh = await Gh.readData();
    const extra = []; // berkas tambahan di luar data/*.json (mis. rute GPS: { path, text } atau { path, remove: true })
    const names = fn(fresh.data, extra) || [];
    const files = [], texts = { ...fresh.texts };
    for (const n of new Set(names)) {
      const t = ser(fresh.data[n]);
      if (t !== fresh.texts[n]) { files.push({ path: `data/${n}.json`, text: t }); texts[n] = t; }
    }
    if (!files.length && !extra.length) { S.data = fresh.data; S.texts = fresh.texts; return false; }
    const blob = files.map((f) => f.text).join('\n');
    const used = [];
    for (const [p, v] of S.pending) if (blob.includes(p)) { files.push({ path: p, base64: v.base64 }); used.push(p); }
    files.push(...extra);
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
    const kids = [...btn.childNodes]; btn.disabled = true; btn.replaceChildren(label); btn.classList.add('loading');
    try { return await fn(); } finally { btn.disabled = false; btn.replaceChildren(...kids); btn.classList.remove('loading'); }
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
      } catch (e) { if (e && e.cancelled) return; if (e && e.fields) { f.showErrors(e.fields); } handleErr(e); }
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
      { k: 'trackData', label: 'Rute GPS', type: 'custom', build: GpsUI.trackField, optional: true },
      textSpec('desc', 'Deskripsi', { type: 'textarea', rows: 4 }),
    ];
  }

  /* opts: { track: { segs, name }, draftId, onSaved } — dipakai alur rekam/impor GPX untuk membuka formulir dengan rute terpasang. */
  function editTrail(t, opts = {}) {
    const isNew = !t, tk = opts.track;
    const base = t || { difficulty: 'Menengah', cat: S.data.site.trailCategories[0], rating: 4.5, name: tk && tk.name ? tk.name.slice(0, 80) : '' };
    openEditor({
      title: isNew ? 'Tambah jejak' : 'Ubah jejak', subtitle: isNew ? null : t.name, specs: trailSpecs(),
      values: { ...base, trackData: { path: t && t.track, segs: tk && tk.segs, draftId: opts.draftId } },
      onDelete: isNew ? null : () => delTrail(t),
      onSave: async (raw) => {
        const td = raw.trackData || { op: 'keep' };
        await mutate(isNew ? `Tambah jejak: ${String(raw.name).trim()}` : `Ubah jejak: ${t.name}`, (d, extra) => {
          const cur = isNew ? null : d.trails.find((x) => x.id === t.id);
          if (!isNew && !cur) throw new Error('Jejak ini sudah dihapus di tempat lain. Muat ulang data.');
          const id = isNew ? nextId(d.trails) : t.id;
          let track = cur && cur.track ? cur.track : '';
          if (td.op === 'set') { // rute baru/ganti: satu berkas data/tracks/<id>.json di commit yang sama
            let clean; try { clean = V.track({ v: 1, segs: Geo.limit(Geo.clean(td.segs), Geo.MAX_STORE) }); } catch (e) { throw e.fields ? new Error('Rute GPS tidak valid: ' + Object.values(e.fields)[0]) : e; }
            track = Schema.trackPath(id); extra.push({ path: track, text: Geo.pack(clean.segs) });
          } else if (td.op === 'clear' && track) { extra.push({ path: track, remove: true }); track = ''; }
          const v = V.trail({ ...raw, track }, { site: d.site });
          if (isNew) d.trails.push({ id, ...v });
          else { const i = d.trails.findIndex((x) => x.id === t.id); d.trails[i] = { id: t.id, ...v }; }
          return ['trails'];
        });
        if (td.op === 'set' && td.draftId) Tracker.deleteDraft(td.draftId).catch(() => {});
        if (opts.onSaved) opts.onSaved();
        published(isNew ? 'Jejak ditambahkan.' : 'Jejak diperbarui.'); route();
      },
    });
  }
  async function delTrail(t) {
    const inHero = S.data.site.hero.slideTrailIds.includes(t.id);
    if (!(await confirmBox({ title: `Hapus “${t.name}”?`, text: 'Jejak akan dihapus permanen dari situs.' + (t.track ? ' Rute GPS-nya ikut dihapus.' : '') + (inHero ? ' Slide hero yang menunjuk jejak ini ikut dibersihkan.' : ''), ok: 'Hapus', danger: true }))) return;
    try {
      await mutate(`Hapus jejak: ${t.name}`, (d, extra) => {
        const cur = d.trails.find((x) => x.id === t.id); if (cur && cur.track) extra.push({ path: cur.track, remove: true });
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

  /* ---------- Logistik Gunung (kalkulator di situs; data/logistics.json) ---------- */
  const LG = Logistics, lgPerLabel = (v) => (LG.PER.find((x) => x[0] === v) || [v, v])[1];
  const lgNum = (n) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });
  const lgSave = (message, fn) => mutate(message, (d) => { d.logistics = V.logistics(fn(d.logistics)); return ['logistics']; });
  const lgId = (name, taken) => { const base = Schema.slugify(name) || 'item'; let id = base, n = 2; while (taken.includes(id)) id = `${base}-${n++}`; return id; };
  const lgStatus = [['true', 'Aktif'], ['false', 'Nonaktif']];

  function lgItemSpecs() {
    return [
      textSpec('name', 'Nama perlengkapan'),
      { k: 'cat', label: 'Kategori', type: 'select', options: LG.CATS, half: true },
      { k: 'per', label: 'Aturan jumlah', type: 'select', options: LG.PER, half: true, hint: 'Per orang, per kelompok, atau dikali jumlah hari.' },
      textSpec('qty', 'Jumlah', { half: true, inputmode: 'decimal', hint: 'Boleh pecahan: 0,5 tenda per orang = 1 tenda per 2 orang (dibulatkan ke atas).' }),
      textSpec('unit', 'Satuan', { half: true, ph: 'buah, set, pasang…' }),
      textSpec('weightG', 'Berat per satuan (gram)', { half: true, inputmode: 'numeric', hint: 'Dipakai untuk estimasi beban bawaan.' }),
      { k: 'on', label: 'Status', type: 'select', options: lgStatus, half: true },
    ];
  }
  function editLgItem(it) {
    const isNew = !it;
    openEditor({
      title: isNew ? 'Tambah perlengkapan' : 'Ubah perlengkapan', subtitle: isNew ? null : it.name, specs: lgItemSpecs(),
      values: it || { cat: LG.CATS[0], per: 'orang', qty: 1, unit: 'buah', weightG: 0, on: 'true' },
      onDelete: isNew ? null : () => delLgItem(it),
      onSave: async (raw) => {
        await lgSave(isNew ? `Tambah perlengkapan logistik: ${String(raw.name).trim()}` : `Ubah perlengkapan logistik: ${it.name}`, (L) => {
          const items = L.items.map((x) => ({ ...x }));
          if (isNew) items.push({ ...raw, id: lgId(String(raw.name), items.map((x) => x.id)) });
          else { const i = items.findIndex((x) => x.id === it.id); if (i < 0) throw new Error('Perlengkapan ini sudah dihapus di tempat lain. Muat ulang data.'); items[i] = { ...raw, id: it.id }; }
          return { ...L, items };
        });
        published(isNew ? 'Perlengkapan ditambahkan.' : 'Perlengkapan diperbarui.'); route();
      },
    });
  }
  async function delLgItem(it) {
    if (!(await confirmBox({ title: `Hapus “${it.name}”?`, text: 'Perlengkapan akan hilang dari daftar kalkulator di situs.', ok: 'Hapus', danger: true }))) return;
    try { await lgSave(`Hapus perlengkapan logistik: ${it.name}`, (L) => ({ ...L, items: L.items.filter((x) => x.id !== it.id) })); published('Perlengkapan dihapus.'); route(); }
    catch (e) { handleErr(e); }
  }

  function editLgCond(cn) {
    const isNew = !cn;
    openEditor({
      title: isNew ? 'Tambah kondisi cuaca' : 'Ubah kondisi cuaca', subtitle: isNew ? null : cn.name,
      specs: [textSpec('name', 'Nama kondisi', { hint: 'Contoh: Hangat / terik, Sejuk, Dingin / berangin.' }),
        textSpec('water', 'Pengali kebutuhan air', { half: true, inputmode: 'decimal', hint: '1 = normal; 1,3 = 30% lebih banyak.' }), textSpec('kcal', 'Pengali kebutuhan kalori', { half: true, inputmode: 'decimal' })],
      values: cn || { water: 1, kcal: 1 }, onDelete: isNew ? null : () => delLgCond(cn),
      onSave: async (raw) => {
        await lgSave(isNew ? `Tambah kondisi cuaca: ${String(raw.name).trim()}` : `Ubah kondisi cuaca: ${cn.name}`, (L) => {
          const conditions = L.conditions.map((x) => ({ ...x }));
          if (isNew) conditions.push({ ...raw, id: lgId(String(raw.name), conditions.map((x) => x.id)) });
          else { const i = conditions.findIndex((x) => x.id === cn.id); if (i < 0) throw new Error('Kondisi ini sudah dihapus di tempat lain. Muat ulang data.'); conditions[i] = { ...raw, id: cn.id }; }
          return { ...L, conditions };
        });
        published(isNew ? 'Kondisi cuaca ditambahkan.' : 'Kondisi cuaca diperbarui.'); route();
      },
    });
  }
  async function delLgCond(cn) {
    if (S.data.logistics.conditions.length <= 1) { toast('Minimal harus ada satu kondisi cuaca.', 'err'); return; }
    if (!(await confirmBox({ title: `Hapus kondisi “${cn.name}”?`, text: 'Kondisi akan hilang dari pilihan kalkulator. Bila ini kondisi bawaan, kondisi pertama menjadi bawaan.', ok: 'Hapus', danger: true }))) return;
    try {
      await lgSave(`Hapus kondisi cuaca: ${cn.name}`, (L) => { const conditions = L.conditions.filter((x) => x.id !== cn.id); return { ...L, conditions, defaults: { ...L.defaults, condition: L.defaults.condition === cn.id ? conditions[0].id : L.defaults.condition } }; });
      published('Kondisi cuaca dihapus.'); route();
    } catch (e) { handleErr(e); }
  }

  function editLgSettings() {
    const L = S.data.logistics, n = (k, label, o = {}) => textSpec(k, label, { half: true, inputmode: 'decimal', ...o });
    openEditor({
      title: 'Pengaturan kalkulator', subtitle: 'Angka dasar, pengali, dan teks modal', values: { ...L, enabled: String(L.enabled) },
      specs: [
        { group: 'Tampilan di situs' },
        { k: 'enabled', label: 'Tombol di halaman utama', type: 'select', options: [['true', 'Tampilkan'], ['false', 'Sembunyikan']] },
        textSpec('button', 'Label tombol', { half: true }), textSpec('eyebrow', 'Label kecil modal', { half: true }), textSpec('title', 'Judul modal'),
        textSpec('intro', 'Teks pengantar', { type: 'textarea', rows: 3 }),
        { group: 'Nilai awal formulir' },
        n('defaults.people', 'Jumlah pendaki', { inputmode: 'numeric' }), n('defaults.days', 'Lama (hari)', { inputmode: 'numeric' }),
        { k: 'defaults.condition', label: 'Kondisi cuaca', type: 'select', options: L.conditions.map((c) => [c.id, c.name]) },
        { group: 'Kebutuhan per orang per hari', note: 'Dikalikan pengali tingkat kesulitan & kondisi cuaca, lalu ditambah cadangan.' },
        n('rates.waterL', 'Air (liter)'), n('rates.kcal', 'Kalori (kkal)', { inputmode: 'numeric' }), n('rates.foodKg', 'Berat makanan (kg)'), n('rates.fuelG', 'Bahan bakar (gram)'),
        n('rates.canisterG', 'Isi satu tabung (gram)', { inputmode: 'numeric' }), n('rates.reservePct', 'Cadangan (%)', { inputmode: 'numeric' }),
        { group: 'Pengali tingkat kesulitan jejak', note: '1 = normal. Dipilih otomatis saat pengunjung memilih jejak.' },
        ...LG.LEVELS.flatMap((lv) => [n(`levels.${lv}.water`, `${lv} — air`), n(`levels.${lv}.kcal`, `${lv} — kalori`)]),
      ],
      onSave: async (raw) => {
        await lgSave('Perbarui pengaturan kalkulator logistik', (cur) => ({ ...raw, conditions: cur.conditions, items: cur.items }));
        published('Pengaturan kalkulator diperbarui.'); route();
      },
    });
  }

  function viewLogistics() {
    const L = S.data.logistics, order = (c) => { const i = LG.CATS.indexOf(c); return i < 0 ? 99 : i; };
    const view = collection({
      key: 'logistics', title: 'Logistik Gunung', sub: 'Kalkulator di halaman utama situs: atur angka dasar, kondisi cuaca, dan daftar perlengkapan.', addLabel: 'Tambah perlengkapan', onAdd: () => editLgItem(),
      headActions: [h('button.btn.ghost', { type: 'button', on: { click: editLgSettings } }, icon('gear', 15), 'Pengaturan')],
      items: L.items, sort: (a, b) => order(a.cat) - order(b.cat) || a.name.localeCompare(b.name), filter: { label: 'Kategori', options: LG.CATS, get: (i) => i.cat }, searchOf: (i) => `${i.name} ${i.cat}`,
      onEdit: editLgItem, onDelete: delLgItem, empty: 'Belum ada perlengkapan. Ketuk “Tambah perlengkapan”.',
      render: (i) => ({ thumb: h('span.item-thumb', icon('trail', 24)), title: i.name, sub: `${lgNum(i.qty)} ${i.unit} ${lgPerLabel(i.per)}${i.weightG ? ' · ' + lgNum(i.weightG) + ' g' : ''}`, tags: [h('span.chip', i.cat), i.on ? null : h('span.chip', 'Nonaktif')] }),
    });
    const R = L.rates, cond = (c) => h('div.item', h('button.item-main', { type: 'button', 'aria-label': 'Ubah kondisi ' + c.name, on: { click: () => editLgCond(c) } }, h('span.item-thumb', icon('gear', 24)),
      h('span.item-body', h('span.item-title', c.name), h('span.item-sub', `Air ×${lgNum(c.water)} · Kalori ×${lgNum(c.kcal)}`), h('span.item-tags', c.id === L.defaults.condition ? h('span.chip', 'Bawaan') : null))),
      h('button.icon-btn.sm.danger', { type: 'button', 'aria-label': 'Hapus kondisi ' + c.name, title: 'Hapus', on: { click: () => delLgCond(c) } }, icon('trash', 16)));
    const summary = h('div.panel', h('h3.panel-title', icon('trail', 18), 'Kalkulator di situs'),
      h('p.hint', `${L.enabled ? 'Tombol “' + L.button + '” tampil di samping “Lihat Peta”.' : 'Tombol disembunyikan dari halaman utama.'} Per orang per hari: ${lgNum(R.waterL)} L air · ${lgNum(R.kcal)} kkal · ${lgNum(R.foodKg)} kg makanan · ${lgNum(R.fuelG)} g bahan bakar, cadangan ${lgNum(R.reservePct)}%.`),
      h('div.trk-btns', h('button.btn.primary.sm', { type: 'button', on: { click: editLgSettings } }, icon('gear', 15), 'Ubah pengaturan'), h('a.btn.ghost.sm', { href: siteUrl(), target: '_blank', rel: 'noopener' }, icon('ext', 15), 'Lihat situs')));
    const conds = h('div.panel', h('h3.panel-title', 'Kondisi cuaca'), h('p.hint', 'Pilihan cuaca di kalkulator beserta pengali air & kalori.'), h('div.cards', L.conditions.map(cond)),
      h('div.trk-btns', h('button.btn.ghost.sm', { type: 'button', on: { click: () => editLgCond() } }, icon('plus', 15), 'Tambah kondisi')));
    const first = view.querySelector('.panel'); view.insertBefore(summary, first); view.insertBefore(conds, first);
    return view;
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
  const thumb = (src, fallback) => {
    const box = h('span.item-thumb');
    const url = preview(src || '');
    if (url) { const i = h('img', { alt: '', loading: 'lazy', src: url }); i.addEventListener('error', () => i.classList.add('broken')); box.append(i); }
    if (fallback) box.append(fallback);
    return box;
  };
  /* avatar GitHub; bila gagal dimuat diganti inisial agar tata letak tidak berlubang */
  const initials = (t) => h('span.avatar.ph', String(t || '?').replace(/^@/, '').slice(0, 2).toUpperCase());
  const avatar = (u, size = 46) => {
    if (!u.avatar) return initials(u.login);
    const i = h('img.avatar', { src: u.avatar, alt: '', width: size, height: size, loading: 'lazy' });
    i.addEventListener('error', () => i.replaceWith(initials(u.login)));
    return i;
  };

  /* pageHead({eyebrow, title, sub, back:[href,label]}, ...tombol) */
  const pageHead = ({ eyebrow, title, sub, back }, ...actions) => h('header.page-head',
    back ? h('a.back-btn', { href: back[0] }, icon('left', 15), back[1]) : null,
    eyebrow ? h('span.eyebrow', eyebrow) : null,
    h('h1', title), sub ? h('p', sub) : null,
    actions.filter(Boolean).length ? h('div.page-actions', actions) : null);

  const CONTENT_TABS = [['trails', 'Jejak'], ['reviews', 'Ulasan'], ['blog', 'Artikel'], ['logistics', 'Logistik'], ['media', 'Media']];
  const subnav = (active) => h('nav.subnav', { 'aria-label': 'Jenis konten' }, CONTENT_TABS.map(([id, label]) => h('a', { href: '#/' + id, 'aria-current': id === active ? 'page' : null }, label)));

  /* deretan chip (filter) — tombol diperbarui di tempat sehingga fokus keyboard tidak hilang */
  function chipRow({ label, options, value, onPick }) {
    let cur = value;
    const sync = () => btns.forEach((b) => { const on = b.dataset.v === cur; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    const btns = options.map(([v, l]) => h('button.filter-btn', { type: 'button', 'data-v': v, on: { click: () => { cur = v; sync(); onPick(v); } } }, l));
    sync();
    return h('div.filter-row', { role: 'group', 'aria-label': label }, btns);
  }

  const searchBox = (value, onInput) => {
    const input = h('input', { type: 'search', placeholder: 'Cari…', value, 'aria-label': 'Cari', autocomplete: 'off', enterkeyhint: 'search' });
    input.addEventListener('input', onInput);
    return { input, el: h('div.search-wrap', icon('search', 17), input) };
  };

  /* daftar kartu dengan pencarian + chip kategori. render(r) → { thumb, title, sub, tags } */
  function collection({ key, title, sub, addLabel, onAdd, headActions = [], items, sort, filter, searchOf, onEdit, onDelete, render, empty }) {
    S.q[key] ||= ''; S.f[key] ||= '';
    if (filter && S.f[key] && !filter.options.includes(S.f[key])) S.f[key] = '';
    const list = h('div.cards'); const count = h('p.count', { 'aria-live': 'polite' });
    const card = (r) => {
      const v = render(r);
      return h('div.item',
        h('button.item-main', { type: 'button', 'aria-label': 'Ubah ' + v.title, on: { click: () => onEdit(r) } }, v.thumb,
          h('span.item-body', h('span.item-title', v.title), v.sub ? h('span.item-sub', v.sub) : null, v.tags ? h('span.item-tags', v.tags) : null)),
        v.actions || null,
        h('button.icon-btn.sm.danger', { type: 'button', 'aria-label': 'Hapus ' + v.title, title: 'Hapus', on: { click: () => onDelete(r) } }, icon('trash', 16)));
    };
    const sb = searchBox(S.q[key], () => paint());
    const paint = () => {
      const qq = sb.input.value.trim().toLowerCase(); S.q[key] = sb.input.value;
      let rows = [...items].sort(sort);
      if (qq) rows = rows.filter((r) => searchOf(r).toLowerCase().includes(qq));
      if (S.f[key]) rows = rows.filter((r) => filter.get(r) === S.f[key]);
      count.textContent = `${rows.length} dari ${items.length}`;
      list.replaceChildren(...(rows.length ? rows.map(card) : [h('div.empty-state', items.length ? 'Tidak ada yang cocok dengan pencarian.' : empty)]));
    };
    const chips = filter ? chipRow({ label: filter.label, options: [['', 'Semua'], ...filter.options.map((o) => [o, o])], value: S.f[key], onPick: (v) => { S.f[key] = v; paint(); } }) : null;
    paint();
    return h('section.view', subnav(key),
      pageHead({ eyebrow: 'Konten', title, sub }, h('button.btn.primary', { type: 'button', on: { click: onAdd } }, icon('plus', 16), addLabel), ...headActions),
      h('div.panel', h('div.toolbar', sb.el, chips, count), list));
  }

  /* baris menu (Pengaturan, menu Tambah) */
  function menuRow({ ic, title, desc, href, ext, onClick, danger }) {
    const kids = [h('span.menu-ic', icon(ic, 20)), h('span.menu-txt', h('b', title), desc ? h('small', desc) : null), h('span.chev', icon(ext ? 'ext' : 'right', 16))];
    if (href) return h('a.menu-row' + (danger ? '.danger' : ''), { href, target: ext ? '_blank' : null, rel: ext ? 'noopener' : null }, kids);
    return h('button.menu-row' + (danger ? '.danger' : ''), { type: 'button', on: { click: onClick } }, kids);
  }

  /* ================= halaman ================= */
  function viewDashboard() {
    const { trails, reviews, blog, site } = S.data;
    const c = Gh.ctx();
    const stat = (n, label, ic, href) => h('a.stat', { href }, h('span.stat-ic', icon(ic, 18)), h('b', String(n)), h('span', label));
    const latest = (arr, sortKey, label, open, fn) => h('div.panel', h('h3.panel-title', label),
      arr.length ? h('ul.mini', [...arr].sort((a, b) => String(b[sortKey]).localeCompare(String(a[sortKey]))).slice(0, 5).map((x) => h('li', h('button.mini-btn', { type: 'button', on: { click: () => open(x) } }, fn(x))))) : h('p.empty-mini', 'Belum ada data.'));
    const catIcon = (r) => site.reviewCategories.find((x) => x.name === r.cat)?.icon || '•';
    return h('section.view',
      pageHead({ eyebrow: 'Ringkasan', title: `Halo, ${S.session.user.name.split(' ')[0]} 👋`, sub: `Mengelola ${site.name} — ${site.tagline}` },
        h('a.btn.ghost', { href: siteUrl(), target: '_blank', rel: 'noopener' }, icon('ext', 15), 'Lihat situs')),
      h('div.stats', stat(trails.length, 'Jejak', 'trail', '#/trails'), stat(reviews.length, 'Ulasan', 'review', '#/reviews'), stat(blog.length, 'Artikel', 'blog', '#/blog')),
      h('div.quick', h('button.btn.primary', { type: 'button', on: { click: () => editTrail() } }, icon('plus', 15), 'Jejak'),
        h('button.btn.primary', { type: 'button', on: { click: () => editReview() } }, icon('plus', 15), 'Ulasan'),
        h('button.btn.primary', { type: 'button', on: { click: () => editPost() } }, icon('plus', 15), 'Artikel'),
        h('button.btn.ghost', { type: 'button', on: { click: () => GpsUI.openRecorder() } }, icon('rec', 15), 'Rekam')),
      latest(reviews, 'iso', 'Ulasan terbaru', editReview, (r) => [h('span.ic', catIcon(r)), h('div', h('b', r.title), h('small', `${stars(r.rating)} · ${fmtDate(r.iso)}`))]),
      latest(blog, 'date', 'Artikel terbaru', editPost, (p) => [h('span.ic', '📝'), h('div', h('b', p.title), h('small', `${p.cat} · ${fmtDate(p.date)}`))]),
      h('div.panel.info', h('h3.panel-title', icon('git', 18), 'Cara kerja penerbitan'),
        h('p', 'Setiap kali Anda menyimpan, CMS membuat satu commit ke ', h('code', `${c.owner}/${c.repo}`), ' pada branch ', h('code', c.branch), '. GitHub Pages lalu membangun ulang situs — biasanya selesai dalam 1–2 menit. Semua riwayat perubahan tersimpan di Git, jadi setiap edit bisa dibatalkan.'),
        h('div.links', h('a', { href: `https://github.com/${c.owner}/${c.repo}/commits/${c.branch}`, target: '_blank', rel: 'noopener' }, 'Riwayat perubahan ↗'),
          h('a', { href: `https://github.com/${c.owner}/${c.repo}/actions`, target: '_blank', rel: 'noopener' }, 'Status penerbitan ↗'))));
  }

  async function downloadTrailGpx(t) {
    try { GpsUI.exportGpx(t.name, await loadTrack(t.track), t.desc); } catch (e) { handleErr(e); }
  }
  function viewTrails() {
    const view = collection({
      key: 'trails', title: 'Jejak Pendakian', sub: 'Rute yang tampil di daftar jejak, peta, dan slide hero. Rekam atau impor rute GPS agar garis jalurnya tampil di peta situs.', addLabel: 'Tambah jejak', onAdd: () => editTrail(),
      headActions: [h('button.btn.ghost', { type: 'button', on: { click: () => GpsUI.openRecorder() } }, icon('rec', 15), 'Rekam'), h('button.btn.ghost', { type: 'button', on: { click: () => GpsUI.importNew() } }, icon('upload', 15), 'Impor GPX')],
      items: S.data.trails, sort: (a, b) => a.name.localeCompare(b.name), searchOf: (t) => `${t.name} ${t.loc} ${t.cat} ${t.difficulty}`,
      filter: { label: 'Kategori jejak', options: S.data.site.trailCategories, get: (t) => t.cat }, onEdit: editTrail, onDelete: delTrail, empty: 'Belum ada jejak. Ketuk “Tambah jejak”.',
      render: (t) => ({ thumb: thumb(t.img), title: t.name, sub: t.loc, tags: [h('span.badge.d-' + t.difficulty, t.difficulty), h('span.chip', t.cat), t.track ? h('span.chip.gps', icon('route', 12), 'GPS') : null, h('span.num', '★ ' + Number(t.rating).toFixed(1))],
        actions: t.track ? h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Unduh GPX ' + t.name, title: 'Unduh GPX', on: { click: () => downloadTrailGpx(t) } }, icon('download', 16)) : null }),
    });
    view.insertBefore(GpsUI.draftsPanel(), view.querySelector('.panel'));
    return view;
  }
  function viewReviews() {
    const icons = Object.fromEntries(S.data.site.reviewCategories.map((c) => [c.name, c.icon]));
    return collection({
      key: 'reviews', title: 'Ulasan', sub: 'Satu-satunya jalur ulasan. Pengunjung mengirim ulasan ke Admin lewat kontak sosial media; setelah diperiksa sesuai aturan, tambahkan di sini.', addLabel: 'Tambah ulasan', onAdd: () => editReview(),
      items: S.data.reviews, sort: (a, b) => b.iso.localeCompare(a.iso), searchOf: (r) => `${r.title} ${r.loc || ''} ${r.author} ${r.cat} ${(r.tags || []).join(' ')}`,
      filter: { label: 'Kategori ulasan', options: S.data.site.reviewCategories.map((c) => c.name), get: (r) => r.cat }, onEdit: editReview, onDelete: delReview, empty: 'Belum ada ulasan.',
      render: (r) => ({ thumb: thumb(r.img, icons[r.cat] || '•'), title: r.title, sub: [r.loc, r.author].filter(Boolean).join(' · '), tags: [h('span.chip', `${icons[r.cat] || ''} ${r.cat}`.trim()), h('span.star', stars(r.rating)), fmtDate(r.iso)] }),
    });
  }
  function viewBlog() {
    return collection({
      key: 'blog', title: 'Artikel', sub: 'Tulisan di modal Blog dan halaman detail artikel.', addLabel: 'Tulis artikel', onAdd: () => editPost(),
      items: S.data.blog, sort: (a, b) => b.date.localeCompare(a.date), searchOf: (p) => `${p.title} ${p.cat} ${p.author} ${p.text}`,
      filter: { label: 'Kategori artikel', options: [...new Set(S.data.blog.map((p) => p.cat))], get: (p) => p.cat }, onEdit: editPost, onDelete: delPost, empty: 'Belum ada artikel.',
      render: (p) => ({ thumb: thumb(p.img), title: p.title, sub: p.author, tags: [h('span.chip', p.cat), fmtDate(p.date)] }),
    });
  }

  /* halaman berisi satu formulir panjang (profil, pengaturan situs) */
  function formPage({ title, sub, specs, values, onSave }) {
    const f = form(specs, values, deps());
    const save = h('button.btn.primary', { type: 'button' }, 'Simpan & terbitkan');
    const reset = h('button.btn.ghost', { type: 'button', on: { click: () => route() } }, 'Kembalikan');
    let dirty = false;
    const mark = () => { dirty = true; bar.classList.add('show'); document.body.classList.add('has-savebar'); };
    f.el.addEventListener('input', mark);
    f.el.addEventListener('change', mark);
    const bar = h('div.savebar', h('span', icon('alert', 16), 'Ada perubahan yang belum diterbitkan'), h('span.sp'), reset, save);
    save.addEventListener('click', async () => {
      try { await busy(save, 'Menyimpan…', () => onSave(f.collect())); dirty = false; } catch (e) { if (e.fields) f.showErrors(e.fields); handleErr(e); }
    });
    window.onbeforeunload = () => (dirty ? 'Ada perubahan yang belum disimpan.' : undefined);
    return h('section.view', pageHead({ eyebrow: 'Pengaturan', title, sub, back: ['#/settings', 'Pengaturan'] }), h('div.panel.formpanel', f.el), bar);
  }

  /* ---------- Pengaturan (hub menu terkelompok) ---------- */
  /* pilihan tema: Otomatis / Terang / Gelap (dibagi dengan situs publik) */
  function themeSeg() {
    const opts = [['auto', 'Otomatis', 'monitor'], ['light', 'Terang', 'sun'], ['dark', 'Gelap', 'moon']];
    const seg = h('div.theme-seg', { role: 'group', 'aria-label': 'Tema tampilan' });
    const paint = () => seg.replaceChildren(...opts.map(([m, l, ic]) => h('button', { type: 'button', 'aria-pressed': String(Theme.mode === m), on: { click: () => Theme.set(m) } }, icon(ic, 18), l)));
    paint(); window.addEventListener('themechange', () => { if (document.contains(seg)) paint(); });
    return seg;
  }
  function viewSettings() {
    const c = Gh.ctx(), u = S.session.user;
    const group = (title, rows) => h('section.menu-group', { 'aria-label': title }, h('h2', title), h('div.menu-list', rows));
    return h('section.view',
      pageHead({ eyebrow: 'Pengaturan', title: 'Pengaturan', sub: 'Atur tampilan situs, akses pengguna, dan akun CMS Anda.' }),
      h('div.account', avatar({ avatar: u.avatar, login: u.login }, 48), h('div', h('b', u.name), h('small', `@${u.login} · ${c.owner}/${c.repo} · ${c.branch}`))),
      h('section.menu-group', { 'aria-label': 'Tampilan' }, h('h2', 'Tampilan'), themeSeg()),
      group('Situs', [
        menuRow({ ic: 'trail', title: 'Kalkulator logistik', desc: 'Perlengkapan, kondisi cuaca, dan angka kebutuhan di modal kalkulator', href: '#/logistics' }),
        menuRow({ ic: 'gear', title: 'Pengaturan situs', desc: 'Nama, hero & slide, judul section, kategori, sosial media, footer', href: '#/site' }),
        menuRow({ ic: 'user', title: 'Profil', desc: 'Isi modal “Profile” di situs', href: '#/profile' }),
      ]),
      group('Akses', [
        menuRow({ ic: 'users', title: 'Pengguna', desc: 'Siapa yang boleh mengedit situs ini lewat CMS', href: '#/users' }),
      ]),
      group('Penerbitan', [
        menuRow({ ic: 'ext', title: 'Lihat situs', desc: 'Buka situs publik di tab baru', href: siteUrl(), ext: true }),
        menuRow({ ic: 'git', title: 'Riwayat perubahan', desc: 'Setiap simpan = satu commit, bisa dibatalkan', href: `https://github.com/${c.owner}/${c.repo}/commits/${c.branch}`, ext: true }),
        menuRow({ ic: 'clock', title: 'Status penerbitan', desc: 'Pantau GitHub Pages membangun ulang situs', href: `https://github.com/${c.owner}/${c.repo}/actions`, ext: true }),
      ]),
      group('Akun', [
        menuRow({ ic: 'refresh', title: 'Muat ulang data', desc: 'Ambil ulang konten terbaru dari GitHub', onClick: reload }),
        menuRow({ ic: 'out', title: 'Keluar', desc: 'Hapus token dari peramban ini', danger: true, onClick: () => logout() }),
      ]));
  }

  /* ---------- Pengguna = kolaborator repositori GitHub ----------
     Pengguna CMS adalah akun GitHub yang punya akses tulis ke repositori. Mengundang/mencabut = API kolaborator GitHub
     (tanpa commit, langsung berlaku). Setiap orang masuk dengan token miliknya sendiri. */
  const ROLE = { admin: ['Admin', 'Bisa mengedit konten dan mengelola pengguna'], maintain: ['Maintainer', 'Bisa mengedit konten'], write: ['Editor', 'Bisa mengedit konten'], triage: ['Triage', 'Hanya melihat — belum bisa mengedit'], read: ['Pembaca', 'Hanya melihat — belum bisa mengedit'] };
  const PERM_ROLE = { admin: 'admin', maintain: 'maintain', push: 'write', triage: 'triage', pull: 'read' };
  const ROLE_PERM = { admin: 'admin', maintain: 'maintain', write: 'push', triage: 'triage', read: 'pull' };
  const roleOptions = (current) => {
    const base = [['push', 'Editor — mengelola konten situs'], ['admin', 'Admin — juga mengelola pengguna'], ['pull', 'Pembaca — hanya melihat']];
    return current && !base.some(([v]) => v === current) ? [...base, [current, `${ROLE[PERM_ROLE[current]][0]} (peran saat ini)`]] : base;
  };
  const isOrgRepo = () => Gh.ctx().ownerType === 'Organization';
  const ADMIN_WARN = { title: 'Jadikan admin?', text: 'Admin bisa mengundang dan mencabut pengguna lain serta mengubah pengaturan repositori. Berikan hanya kepada orang yang Anda percaya.', ok: 'Ya, jadikan admin' };

  function inviteUser() {
    const org = isOrgRepo();
    const specs = [textSpec('username', 'Username GitHub', { ph: 'octocat', hint: 'Boleh menempel tautan profilnya. Akun harus sudah terdaftar di GitHub.' })];
    if (org) specs.push({ k: 'permission', label: 'Peran', type: 'select', options: roleOptions(), hint: 'Editor bisa mengubah konten dan masuk CMS. Pembaca hanya bisa melihat repositori.' });
    const d = openEditor({
      title: 'Undang pengguna', subtitle: 'Beri akses edit CMS ke akun GitHub', specs, values: { permission: 'push' }, saveLabel: 'Kirim undangan',
      onSave: async (raw) => {
        const [cl, iv] = await Promise.all([Gh.listCollaborators(), Gh.listInvitations().catch(() => [])]);
        const v = V.collaborator(raw, { orgRepo: org, existing: [...cl.map((x) => x.login), ...iv.map((x) => x.login)] });
        let who;
        try { who = await Gh.lookupUser(v.username); } catch (e) { if (e.status === 404) throw new Schema.ValidationError({ username: e.message }); throw e; }
        if (v.permission === 'admin' && !(await confirmBox({ ...ADMIN_WARN, title: `Jadikan @${who.login} admin?` }))) throw { cancelled: true };
        const r = await Gh.setCollaborator(who.login, v.permission);
        toast(r.invited ? `Undangan dikirim ke @${who.login}. Ia perlu menerimanya lewat email atau notifikasi GitHub.` : `Peran @${who.login} diperbarui.`);
        route();
      },
    });
    if (!org) d.panel.querySelector('.form').prepend(h('div.field.note', 'Repositori ini milik akun pribadi, jadi semua pengguna berperan Editor (akses tulis).'));
  }

  function editRole(u) {
    const current = ROLE_PERM[u.role];
    openEditor({
      title: 'Ubah peran', subtitle: `@${u.login}`, saveLabel: 'Simpan peran',
      specs: [{ k: 'permission', label: 'Peran', type: 'select', options: roleOptions(current), hint: ROLE[u.role][1] + '.' }],
      values: { permission: current },
      onSave: async (raw) => {
        const v = V.collaborator({ username: u.login, permission: raw.permission }, { orgRepo: true });
        if (v.permission === current) { toast('Peran tidak berubah.'); return; }
        if (v.permission === 'admin' && !(await confirmBox({ ...ADMIN_WARN, title: `Jadikan @${u.login} admin?` }))) throw { cancelled: true };
        await Gh.setCollaborator(u.login, v.permission);
        toast(`Peran @${u.login} diperbarui.`); route();
      },
    });
  }

  async function removeUser(u) {
    if (!(await confirmBox({ title: `Cabut akses @${u.login}?`, text: 'Ia tidak akan bisa lagi mengedit situs ini, dan tokennya berhenti berlaku untuk repositori ini. Konten yang pernah ia buat tetap ada. Anda bisa mengundangnya lagi kapan saja.', ok: 'Cabut akses', danger: true }))) return;
    try { await Gh.removeCollaborator(u.login); toast(`Akses @${u.login} dicabut.`); route(); } catch (e) { handleErr(e); }
  }
  async function cancelInvite(i) {
    if (!(await confirmBox({ title: `Batalkan undangan @${i.login}?`, text: 'Undangan akan dihapus dan tidak bisa diterima lagi.', ok: 'Batalkan undangan', danger: true }))) return;
    try { await Gh.cancelInvitation(i.id); toast(`Undangan @${i.login} dibatalkan.`); route(); } catch (e) { handleErr(e); }
  }

  async function viewUsers() {
    const c = Gh.ctx(), me = S.session.user.login.toLowerCase();
    const canManage = !!S.session.canAdmin, org = isOrgRepo();
    const ownerLogin = String(c.ownerLogin || c.owner).toLowerCase();
    const head = pageHead({ eyebrow: 'Akses', title: 'Pengguna', sub: 'Akun GitHub yang boleh mengedit situs ini lewat CMS.' },
      canManage ? h('button.btn.primary', { type: 'button', on: { click: inviteUser } }, icon('plus', 16), 'Undang pengguna') : null);
    const wrap = h('section.view', head);
    const [a, b] = await Promise.all([Gh.listCollaborators().then((v) => ({ v }), (e) => ({ e })), Gh.listInvitations().then((v) => ({ v }), (e) => ({ e }))]);
    if ((a.e && a.e.status === 401) || (b.e && b.e.status === 401)) throw a.e || b.e;
    if (a.e) { wrap.append(h('div.panel', h('div.notice.err', icon('alert', 18), h('div', a.e.message)))); return wrap; }

    const collabs = a.v, invites = b.e ? [] : b.v;
    S.q.users ||= ''; S.f.users ||= 'all';
    const editors = collabs.filter((x) => x.canPush).length;
    const notices = [];
    if (!canManage) notices.push(h('div.notice', icon('info', 18), h('div', 'Anda hanya bisa melihat daftar ini. Mengundang atau mencabut pengguna membutuhkan akun admin repositori dan token dengan izin “Administration: Read and write”.')));
    else if (b.e) notices.push(h('div.notice', icon('alert', 18), h('div', 'Undangan yang tertunda tidak bisa dimuat. ' + b.e.message)));

    const list = h('div.cards'); const count = h('p.count', { 'aria-live': 'polite' });
    const userCard = (u) => {
      const isOwner = u.login.toLowerCase() === ownerLogin, isMe = u.login.toLowerCase() === me;
      const [rl, rd] = ROLE[u.role] || ROLE.read;
      const editable = canManage && org && !isOwner && !isMe, removable = canManage && !isOwner && !isMe;
      const inner = [avatar(u), h('span.item-body', h('span.item-title', '@' + u.login), h('span.item-sub', rd),
        h('span.item-tags', h('span.role.' + u.role, rl), isOwner ? h('span.role.me', 'Pemilik') : null, isMe ? h('span.role.me', 'Anda') : null))];
      return h('div.item.user', editable ? h('button.item-main', { type: 'button', 'aria-label': `Ubah peran @${u.login}`, on: { click: () => editRole(u) } }, inner) : h('div.item-main', inner),
        removable ? h('button.icon-btn.sm.danger', { type: 'button', 'aria-label': `Cabut akses @${u.login}`, title: 'Cabut akses', on: { click: () => removeUser(u) } }, icon('trash', 16)) : null);
    };
    const inviteCard = (i) => h('div.item.user', h('div.item-main', avatar(i), h('span.item-body', h('span.item-title', '@' + i.login),
      h('span.item-sub', `Diundang ${i.createdAt ? fmtDate(i.createdAt.slice(0, 10)) : ''}${i.inviter ? ' oleh @' + i.inviter : ''}`.trim()),
      h('span.item-tags', h('span.role.pending', 'Menunggu'), h('span.role.' + i.role, ROLE[i.role][0])))),
      canManage ? h('button.icon-btn.sm.danger', { type: 'button', 'aria-label': `Batalkan undangan @${i.login}`, title: 'Batalkan undangan', on: { click: () => cancelInvite(i) } }, icon('x', 16)) : null);

    const rank = { admin: 0, maintain: 1, write: 2, triage: 3, read: 4 };
    const sb = searchBox(S.q.users, () => paint());
    const paint = () => {
      const qq = sb.input.value.trim().toLowerCase().replace(/^@/, ''); S.q.users = sb.input.value;
      const f = S.f.users;
      const us = f === 'pending' ? [] : [...collabs].sort((x, y) => (rank[x.role] - rank[y.role]) || x.login.localeCompare(y.login)).filter((u) => !qq || u.login.toLowerCase().includes(qq));
      const iv = f === 'active' ? [] : invites.filter((i) => !qq || String(i.login).toLowerCase().includes(qq));
      count.textContent = `${us.length} aktif · ${iv.length} menunggu`;
      const cards = [...us.map(userCard), ...iv.map(inviteCard)];
      list.replaceChildren(...(cards.length ? cards : [h('div.empty-state', collabs.length + invites.length ? 'Tidak ada yang cocok dengan pencarian.' : 'Belum ada pengguna.')]));
    };
    const chips = chipRow({ label: 'Tampilkan', options: [['all', 'Semua'], ['active', 'Aktif'], ['pending', 'Menunggu']], value: S.f.users, onPick: (v) => { S.f.users = v; paint(); } });
    paint();

    wrap.append(
      h('div.stats', h('div.stat', h('span.stat-ic', icon('users', 18)), h('b', String(collabs.length)), h('span', 'Pengguna')),
        h('div.stat', h('span.stat-ic', icon('edit', 18)), h('b', String(editors)), h('span', 'Bisa mengedit')),
        h('div.stat', h('span.stat-ic', icon('clock', 18)), h('b', String(invites.length)), h('span', 'Menunggu'))),
      h('div.panel', ...notices, h('div.toolbar', sb.el, chips, count), list),
      h('div.panel.info', h('h3.panel-title', icon('shield', 18), 'Cara kerja akses'),
        h('ol.steps',
          h('li', 'Pengguna CMS adalah akun GitHub dengan akses tulis ke ', h('code', `${c.owner}/${c.repo}`), '. Tidak ada kata sandi di situs ini.'),
          h('li', 'Orang yang diundang harus menerima undangan lewat email atau notifikasi GitHub, lalu masuk ke CMS dengan token miliknya sendiri.'),
          h('li', 'Perubahan di halaman ini langsung berlaku di GitHub dan tidak membuat commit.'),
          h('li', org ? 'Admin bisa mengelola pengguna; Editor hanya mengelola konten.' : 'Pada repositori pribadi semua pengguna berperan Editor.'))));
    return wrap;
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
    const grid = h('div.media-grid', h('p.empty-mini', 'Memuat…'));
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, hidden: true });
    const upBtn = h('button.btn.primary', { type: 'button', on: { click: () => input.click() } }, icon('upload', 15), 'Unggah gambar');
    const wrap = h('section.view', subnav('media'), pageHead({ eyebrow: 'Konten', title: 'Media', sub: 'Gambar yang diunggah ke assets/uploads/ di repositori.' }, upBtn, input), h('div.panel', grid));
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
  /* Bottom-nav (seperti situs): Ringkasan · Konten · [Tambah] · Pengguna · Pengaturan.
     Jejak/Ulasan/Artikel/Media berbagi tab “Konten”; Profil & Pengaturan situs ada di bawah “Pengaturan”. */
  const GROUP = { dashboard: 'dashboard', trails: 'content', reviews: 'content', blog: 'content', logistics: 'content', media: 'content', users: 'users', settings: 'settings', site: 'settings', profile: 'settings' };
  const TITLES = { dashboard: 'Ringkasan', trails: 'Jejak', reviews: 'Ulasan', blog: 'Artikel', logistics: 'Logistik Gunung', media: 'Media', users: 'Pengguna', settings: 'Pengaturan', site: 'Pengaturan situs', profile: 'Profil' };
  const VIEWS = { dashboard: viewDashboard, trails: viewTrails, reviews: viewReviews, blog: viewBlog, logistics: viewLogistics, media: viewMedia, users: viewUsers, settings: viewSettings, site: viewSite, profile: viewProfile };
  let main = null, navEl = null;

  function quickAdd() {
    const rows = [
      menuRow({ ic: 'trail', title: 'Jejak', desc: 'Tambah rute pendakian baru', onClick: () => { d.close(); editTrail(); } }),
      menuRow({ ic: 'rec', title: 'Rekam jejak', desc: 'Rekam rute GPS langsung di lapangan', onClick: () => { d.close(); GpsUI.openRecorder(); } }),
      menuRow({ ic: 'upload', title: 'Impor GPX', desc: 'Buat jejak baru dari berkas .gpx', onClick: () => { d.close(); GpsUI.importNew(); } }),
      menuRow({ ic: 'review', title: 'Ulasan', desc: 'Tulis ulasan spot, tempat, atau gear', onClick: () => { d.close(); editReview(); } }),
      menuRow({ ic: 'blog', title: 'Artikel', desc: 'Tulis artikel untuk blog', onClick: () => { d.close(); editPost(); } }),
      menuRow({ ic: 'image', title: 'Gambar', desc: 'Unggah ke pustaka media', onClick: () => { d.close(); location.hash = '#/media'; } }),
      S.session.canAdmin ? menuRow({ ic: 'users', title: 'Pengguna', desc: 'Undang akun GitHub untuk ikut mengedit', onClick: () => { d.close(); inviteUser(); } }) : null,
    ];
    const d = drawer({ title: 'Tambah baru', subtitle: 'Pilih yang ingin dibuat', body: h('div.menu-list', rows) });
  }

  function shell() {
    const u = S.session.user;
    main = h('main#main', { tabindex: -1 });
    const top = h('header.topbar', h('div.topbar-inner',
      h('a.brand', { href: '#/dashboard', 'aria-label': 'Ringkasan' }, h('span.brand-mark', h('img', { src: '../assets/images/logo.png', alt: '', width: 26, height: 26 })), h('span', h('strong', 'Sadalan'), h('small', 'Panel Admin'))),
      h('span.sp'),
      Theme.button(),
      h('a.icon-btn', { href: siteUrl(), target: '_blank', rel: 'noopener', 'aria-label': 'Lihat situs', title: 'Lihat situs' }, icon('ext', 18)),
      h('a.icon-btn.avatar-btn', { href: '#/settings', 'aria-label': 'Pengaturan dan akun', title: u.name }, u.avatar ? avatar({ avatar: u.avatar, login: u.login }, 40) : icon('user', 18))));
    const item = (group, href, label, ic) => h('a.nav-item', { href, 'data-group': group }, icon(ic, 20), h('span', label));
    navEl = h('nav.bottom-nav', { 'aria-label': 'Menu admin' },
      item('dashboard', '#/dashboard', 'Ringkasan', 'dash'), item('content', '#/trails', 'Konten', 'layers'),
      h('button.nav-item.nav-add', { type: 'button', 'aria-haspopup': 'dialog', on: { click: quickAdd } }, h('span.nav-orb', icon('plus', 22)), h('span', 'Tambah')),
      item('users', '#/users', 'Pengguna', 'users'), item('settings', '#/settings', 'Pengaturan', 'gear'));
    app.replaceChildren(top, main, navEl);
    document.body.classList.add('has-nav');
  }

  async function route() {
    if (!S.session) return;
    window.onbeforeunload = null; document.body.classList.remove('has-savebar');
    const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
    const name = VIEWS[id] ? id : 'dashboard';
    navEl.querySelectorAll('a.nav-item').forEach((a) => (a.dataset.group === GROUP[name] ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    document.title = `${TITLES[name]} — Sadalan CMS`;
    const token = (route.t = (route.t || 0) + 1);
    let el;
    try { el = await VIEWS[name](); } catch (e) { handleErr(e); el = h('section.view', pageHead({ title: 'Gagal memuat' }), h('div.panel', h('div.notice.err', icon('alert', 18), h('div', (e && e.message) || 'Terjadi kesalahan.')))); }
    if (token !== route.t || !S.session) return;
    main.replaceChildren(el); window.scrollTo(0, 0);
  }

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
    S.session = { user: info.user, repo: info.repo, canAdmin: info.canAdmin }; S.data = r.data; S.texts = r.texts;
    shell();
    GpsUI.setup({ editTrail, trails: () => S.data.trails }); GpsUI.showPill(true);
    if (!location.hash) location.hash = '#/dashboard';
    await route();
    GpsUI.recover().catch(() => {}); // tawarkan melanjutkan rekaman yang terputus
  }

  function logout(message) {
    GpsUI.teardown(); if (Tracker.getState().status === 'recording') Tracker.pause(); // rekaman dijeda & tersimpan; bisa dilanjutkan saat masuk lagi
    Gh.disconnect(); clearSession(); S.session = null; S.data = null; S.pending.clear(); S.q = {}; S.f = {}; S.mediaCache = null;
    window.onbeforeunload = null; document.body.classList.remove('has-nav', 'has-savebar', 'noscroll');
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* abaikan */ } // login berikutnya mulai dari Ringkasan
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
