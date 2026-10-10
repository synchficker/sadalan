/* UI — pembangun DOM, notifikasi, dialog, drawer, dan field formulir untuk admin.
   Semua teks dari pengguna dimasukkan lewat textContent / properti DOM (bukan innerHTML) sehingga aman dari XSS. */
const UI = (() => {
  const SVG = {
    dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    trail: '<path d="m3 20 6-11 4 7 3-4 5 8z"/><circle cx="17" cy="6" r="2"/>',
    review: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    blog: '<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', out: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    check: '<path d="m5 12 5 5 9-10"/>', alert: '<path d="M12 3 2 20h20zM12 10v5M12 18v.5"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', git: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 8v8M18 11c0 4-6 3-12 5"/>',
  };
  const icon = (n, size = 18) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = SVG[n] || ''; // sumber statis internal, bukan input pengguna
    return s;
  };

  /* h('div.kelas#id', {atribut, on:{click}}, ...anak) */
  function h(sel, attrs, ...kids) {
    if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
    const m = /^([a-z0-9]+)?(#[\w-]+)?((?:\.[\w-]+)*)$/i.exec(sel);
    const el = document.createElement(m[1] || 'div');
    if (m[2]) el.id = m[2].slice(1);
    if (m[3]) el.className = m[3].slice(1).replace(/\./g, ' ');
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (k) => {
      if (k == null || k === false) return;
      if (Array.isArray(k)) return k.forEach(add);
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    };
    kids.forEach(add);
    return el;
  }

  /* ---------- notifikasi ---------- */
  function toast(msg, type = 'ok', ms = 4200) {
    let box = document.getElementById('toasts');
    if (!box) { box = h('div#toasts', { 'aria-live': 'polite' }); document.body.append(box); }
    const t = h('div.toast.' + type, icon(type === 'err' ? 'alert' : 'check', 18), h('span', msg));
    box.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms);
  }

  /* ---------- dialog konfirmasi ---------- */
  function confirmBox({ title, text, ok = 'Ya', danger = false }) {
    return new Promise((done) => {
      const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey, true); done(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } };
      const wrap = h('div.dlg-wrap', { on: { click: (e) => { if (e.target === wrap) close(false); } } },
        h('div.dlg', { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
          h('h3', title), h('p', text),
          h('div.dlg-actions', h('button.btn.ghost', { type: 'button', on: { click: () => close(false) } }, 'Batal'),
            h('button.btn' + (danger ? '.danger' : '.primary'), { type: 'button', on: { click: () => close(true) } }, ok))));
      document.body.append(wrap); document.addEventListener('keydown', onKey, true);
      wrap.querySelector('.dlg-actions .btn:last-child').focus();
    });
  }

  /* ---------- drawer (panel samping) ---------- */
  function drawer({ title, subtitle, body, footer, isDirty = () => false, onClose }) {
    const prevFocus = document.activeElement;
    let closed = false;
    const tryClose = async () => {
      if (closed) return;
      if (isDirty() && !(await confirmBox({ title: 'Buang perubahan?', text: 'Ada isian yang belum disimpan. Jika ditutup, perubahan itu hilang.', ok: 'Buang', danger: true }))) return;
      close();
    };
    const close = () => {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey); wrap.remove(); document.body.classList.remove('noscroll');
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      if (onClose) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.dlg-wrap')) tryClose(); };
    const panel = h('aside.drawer', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header.drawer-head', h('div', h('h2', title), subtitle ? h('p', subtitle) : null),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Tutup', on: { click: tryClose } }, icon('x'))),
      h('div.drawer-body', body), footer ? h('footer.drawer-foot', footer) : null);
    const wrap = h('div.drawer-wrap', h('div.drawer-back', { on: { click: tryClose } }), panel);
    document.body.append(wrap); document.body.classList.add('noscroll'); document.addEventListener('keydown', onKey);
    const first = panel.querySelector('input:not([type=hidden]),textarea,select'); if (first) first.focus();
    return { close, tryClose, panel };
  }

  /* ---------- field formulir ----------
     Setiap fungsi mengembalikan { el, get(), error(msg), key } — get() memberi nilai mentah untuk divalidasi skema. */
  let uid = 0;
  function wrapField(spec, control, extra) {
    const id = 'f' + ++uid;
    const err = h('p.err', { id: id + '-e', role: 'alert' });
    const lab = h('label', { for: id }, spec.label, spec.optional ? h('em', ' (opsional)') : null);
    const el = h('div.field' + (spec.full === false ? '' : '.full') + (spec.half ? '.half' : ''), lab, control, extra || null,
      spec.hint ? h('p.hint', spec.hint) : null, err);
    return {
      el, key: spec.k,
      error(m) { err.textContent = m || ''; el.classList.toggle('bad', !!m); const t = control.matches && control.matches('input,textarea,select') ? control : control.querySelector && control.querySelector('input,textarea,select'); if (t) t.setAttribute('aria-invalid', m ? 'true' : 'false'); },
      id,
    };
  }

  function text(spec, value) {
    const inp = h(spec.type === 'textarea' ? 'textarea' : 'input', {
      type: spec.type === 'textarea' ? null : (spec.type || 'text'), rows: spec.rows || 3, value: value == null ? '' : String(value),
      placeholder: spec.ph, inputmode: spec.inputmode, list: spec.list, autocomplete: 'off', readonly: spec.readonly ? '' : null,
    });
    const f = wrapField(spec, inp); inp.id = f.id;
    f.get = () => inp.value;
    f.input = inp;
    return f;
  }

  function select(spec, value) {
    const s = h('select', spec.options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
    const f = wrapField(spec, s); s.id = f.id; f.get = () => s.value; f.input = s;
    return f;
  }

  /* satu butir per baris ('lines') atau paragraf dipisah baris kosong ('paras') */
  function multi(spec, value) {
    const sep = spec.type === 'paras' ? '\n\n' : '\n';
    const ta = h('textarea', { rows: spec.rows || 4, value: (value || []).join(sep), placeholder: spec.ph });
    const f = wrapField(spec, ta); ta.id = f.id; f.input = ta;
    f.get = () => (spec.type === 'paras' ? ta.value.split(/\n\s*\n/) : ta.value.split('\n')).map((x) => x.trim()).filter(Boolean);
    return f;
  }

  function csv(spec, value) {
    const f = text({ ...spec, type: 'text' }, (value || []).join(', '));
    f.get = () => f.input.value.split(',').map((x) => x.trim()).filter(Boolean);
    return f;
  }

  /* gambar: URL atau unggah (diantrikan, baru di-commit saat formulir disimpan) */
  function image(spec, value, { prepare, preview }) {
    const inp = h('input', { type: 'text', value: value || '', placeholder: 'https://… atau assets/uploads/…', autocomplete: 'off' });
    const img = h('img.thumb-prev', { alt: '' });
    const note = h('span.up-note');
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
    const show = () => { const v = inp.value.trim(); const src = v && preview(v); img.hidden = !src; if (src) img.src = src; };
    img.addEventListener('error', () => { img.hidden = true; });
    inp.addEventListener('input', show);
    const pick = h('button.btn.ghost.sm', { type: 'button', on: { click: () => file.click() } }, icon('upload', 15), 'Unggah');
    file.addEventListener('change', async () => {
      const fl = file.files[0]; if (!fl) return;
      note.textContent = 'Memproses…';
      try { const r = await prepare(fl); inp.value = r.path; inp.dispatchEvent(new Event('input', { bubbles: true })); note.textContent = `${r.kb} KB — diunggah saat disimpan`; }
      catch (e) { note.textContent = ''; toast(e.message, 'err'); }
      file.value = '';
    });
    const row = h('div.img-row', h('div.img-input', inp, pick, file), h('div.img-prev', img, note));
    const f = wrapField(spec, row); inp.id = f.id; f.input = inp; show();
    f.get = () => inp.value;
    return f;
  }

  /* editor blok artikel: paragraf, subjudul, kutipan, daftar */
  const BLOCK_TYPES = [['p', 'Paragraf'], ['h', 'Subjudul'], ['q', 'Kutipan'], ['ul', 'Daftar']];
  function blocks(spec, value) {
    const items = (value || []).map((b) => typeof b === 'string' ? { t: 'p', v: b } : b.h != null ? { t: 'h', v: b.h } : b.q != null ? { t: 'q', v: b.q } : { t: 'ul', v: (b.ul || []).join('\n') });
    const list = h('div.blocks');
    const f = wrapField(spec, list);
    const change = () => list.dispatchEvent(new Event('input', { bubbles: true }));
    const render = () => {
      list.replaceChildren();
      if (!items.length) list.append(h('p.empty-mini', 'Belum ada blok. Tambahkan paragraf pertama.'));
      items.forEach((b, i) => {
        const ta = h('textarea', { rows: b.t === 'h' ? 1 : b.t === 'ul' ? 4 : 3, value: b.v, placeholder: b.t === 'ul' ? 'Satu butir per baris' : b.t === 'h' ? 'Subjudul' : 'Tulis di sini…', 'aria-label': 'Isi blok ' + (i + 1), on: { input: () => { b.v = ta.value; } } });
        const sel = h('select', { 'aria-label': 'Jenis blok', on: { change: () => { b.t = sel.value; render(); change(); } } }, BLOCK_TYPES.map(([v, l]) => h('option', { value: v, selected: v === b.t }, l)));
        const mv = (d) => () => { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; render(); change(); };
        list.append(h('div.block', h('div.block-bar', sel, h('span.sp'),
          h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Naikkan', disabled: i === 0, on: { click: mv(-1) } }, icon('up', 16)),
          h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Turunkan', disabled: i === items.length - 1, on: { click: mv(1) } }, icon('down', 16)),
          h('button.icon-btn.sm.danger', { type: 'button', 'aria-label': 'Hapus blok', on: { click: () => { items.splice(i, 1); render(); change(); } } }, icon('trash', 16))), ta));
      });
      list.append(h('div.block-add', BLOCK_TYPES.map(([t, l]) => h('button.btn.ghost.sm', { type: 'button', on: { click: () => { items.push({ t, v: '' }); render(); change(); const tas = list.querySelectorAll('.block textarea'); if (tas.length) tas[tas.length - 1].focus(); } } }, icon('plus', 14), l))));
    };
    render();
    f.get = () => items.filter((b) => b.v.trim() || b.t === 'p').map((b) => {
      const v = b.v.trim();
      if (b.t === 'p') return v;
      if (b.t === 'ul') return { ul: v.split('\n').map((x) => x.trim()).filter(Boolean) };
      return { [b.t]: v };
    }).filter((b) => b !== '');
    return f;
  }

  /* daftar baris berulang (kategori, tautan sosial) */
  function repeat(spec, value) {
    const rows = (value || []).map((x) => ({ ...x }));
    const list = h('div.repeat');
    const f = wrapField(spec, list);
    const errs = {};
    const change = () => list.dispatchEvent(new Event('input', { bubbles: true }));
    const render = () => {
      list.replaceChildren();
      rows.forEach((r, i) => {
        const cells = spec.cols.map((col) => {
          const ctl = col.options
            ? h('select', { 'aria-label': col.label, on: { change: () => { r[col.k] = ctl.value; } } }, col.options.map((o) => h('option', { value: o, selected: o === r[col.k] }, o)))
            : h('input', { type: col.type || 'text', value: r[col.k] || '', placeholder: col.label, 'aria-label': col.label, autocomplete: 'off', on: { input: () => { r[col.k] = ctl.value; } } });
          const e = h('small.cell-err'); errs[`${spec.k}[${i}].${col.k}`] = e;
          return h('div.cell' + (col.w ? '.' + col.w : ''), ctl, e);
        });
        const mv = (d) => () => { const j = i + d; if (j < 0 || j >= rows.length) return; [rows[i], rows[j]] = [rows[j], rows[i]]; render(); change(); };
        list.append(h('div.rrow', cells,
          h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Naikkan', disabled: i === 0, on: { click: mv(-1) } }, icon('up', 16)),
          h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Turunkan', disabled: i === rows.length - 1, on: { click: mv(1) } }, icon('down', 16)),
          h('button.icon-btn.sm.danger', { type: 'button', 'aria-label': 'Hapus baris', on: { click: () => { rows.splice(i, 1); render(); change(); } } }, icon('trash', 16))));
      });
      list.append(h('button.btn.ghost.sm', { type: 'button', on: { click: () => { rows.push({ ...(spec.blank || {}) }); render(); change(); } } }, icon('plus', 14), spec.addLabel || 'Tambah'));
    };
    render();
    f.get = () => rows;
    const base = f.error;
    f.error = (m) => { base(m); if (!m) Object.values(errs).forEach((e) => { e.textContent = ''; }); };
    f.rowError = (path, m) => { if (errs[path]) { errs[path].textContent = m; return true; } return false; };
    return f;
  }

  /* pemilih slide hero: urutan id jejak */
  function trailPick(spec, value, trails) {
    const ids = [...(value || [])];
    const list = h('div.repeat');
    const f = wrapField(spec, list);
    const name = (id) => { const t = trails.find((x) => x.id === id); return t ? t.name : `(jejak #${id} tidak ada)`; };
    const change = () => list.dispatchEvent(new Event('input', { bubbles: true }));
    const render = () => {
      list.replaceChildren();
      ids.forEach((id, i) => {
        const mv = (d) => () => { const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; render(); change(); };
        list.append(h('div.rrow.pick', h('span.pill', String(i + 1)), h('b', name(id)),
          h('span.sp'),
          h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Naikkan', disabled: i === 0, on: { click: mv(-1) } }, icon('up', 16)),
          h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Turunkan', disabled: i === ids.length - 1, on: { click: mv(1) } }, icon('down', 16)),
          h('button.icon-btn.sm.danger', { type: 'button', 'aria-label': 'Keluarkan', on: { click: () => { ids.splice(i, 1); render(); change(); } } }, icon('x', 16))));
      });
      const avail = trails.filter((t) => !ids.includes(t.id));
      if (avail.length && ids.length < 8) {
        const sel = h('select', { 'aria-label': 'Tambah slide' }, h('option', { value: '' }, '+ Tambah jejak ke slide…'), avail.map((t) => h('option', { value: t.id }, t.name)));
        sel.addEventListener('change', () => { if (sel.value) { ids.push(Number(sel.value)); render(); change(); } });
        list.append(sel);
      }
    };
    render();
    f.get = () => ids;
    return f;
  }

  /* Merakit formulir dari daftar spesifikasi. Kunci 'a.b' diubah menjadi objek bersarang. */
  function form(specs, values, deps = {}) {
    const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
    const fields = [];
    const root = h('div.form');
    let group = null;
    for (const s of specs) {
      if (s.group) { group = h('section.grp', { 'aria-label': s.group }, h('h3.grp-title', s.group), s.note ? h('p.grp-note', s.note) : null); root.append(group); continue; }
      const v = getPath(values || {}, s.k);
      let f;
      switch (s.type) {
        case 'select': f = select(s, v); break;
        case 'lines': case 'paras': f = multi(s, v); break;
        case 'csv': f = csv(s, v); break;
        case 'image': f = image(s, v, deps); break;
        case 'blocks': f = blocks(s, v); break;
        case 'repeat': f = repeat(s, v); break;
        case 'trailpick': f = trailPick(s, v, deps.trails || []); break;
        default: f = text(s, v);
      }
      (group || root).append(f.el); fields.push(f);
    }
    const collect = () => {
      const out = {};
      for (const f of fields) {
        const parts = f.key.split('.'); let o = out;
        parts.slice(0, -1).forEach((k) => { o = o[k] ||= {}; });
        o[parts[parts.length - 1]] = f.get();
      }
      return out;
    };
    const showErrors = (map) => {
      fields.forEach((f) => f.error(''));
      let firstEl = null;
      for (const [path, msg] of Object.entries(map || {})) {
        let hit = fields.find((f) => f.key === path) || fields.find((f) => path.startsWith(f.key + '[') || path.startsWith(f.key + '.'));
        if (!hit) continue;
        if (hit.rowError && hit.rowError(path, msg)) hit.error('Periksa baris yang bertanda.');
        else hit.error(msg);
        firstEl ||= hit.el;
      }
      if (firstEl) firstEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return !!firstEl;
    };
    return { el: root, collect, showErrors, fields };
  }

  return { h, icon, toast, confirmBox, drawer, form };
})();
