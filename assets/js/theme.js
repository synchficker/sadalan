/* Theme — Mode Terang / Gelap / Otomatis (ikut perangkat), dipakai situs publik dan panel admin.
   Dimuat di <head> secara sinkron agar tema terpasang sebelum halaman tergambar (tanpa kilatan putih).
   Pilihan disimpan di localStorage ("sadalan_theme": light | dark; kosong = otomatis) dan dibagi antara situs & admin (satu origin).
   Selalu menulis data-theme="light|dark" (hasil akhir) dan data-theme-mode="auto|light|dark" (pilihan) pada <html>. */
(function () {
  'use strict';
  var KEY = 'sadalan_theme', root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var ORDER = ['auto', 'light', 'dark'];
  var LABEL = { auto: 'Otomatis (ikut perangkat)', light: 'Terang', dark: 'Gelap' };
  var BAR = { light: '#173f35', dark: '#0f1a16' };

  function mode() { try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; } }
  function resolve(m) { return m === 'auto' ? (mq && mq.matches ? 'dark' : 'light') : m; }

  function apply() {
    var m = mode(), r = resolve(m);
    root.setAttribute('data-theme', r); root.setAttribute('data-theme-mode', m); root.style.colorScheme = r;
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', BAR[r]);
    try { window.dispatchEvent(new CustomEvent('themechange', { detail: { mode: m, theme: r } })); } catch (e) { /* abaikan */ }
  }
  function set(m) {
    if (ORDER.indexOf(m) < 0) m = 'auto';
    try { if (m === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, m); } catch (e) { /* penyimpanan diblokir: tema berlaku untuk sesi ini saja */ }
    apply();
  }
  function cycle() { set(ORDER[(ORDER.indexOf(mode()) + 1) % ORDER.length]); }

  /* ikon SVG (dibuat lewat DOM, bukan innerHTML) */
  var NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    auto: ['M3 5h18v11H3z', 'M8 20h8M12 16v4'],
    light: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
    dark: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
  };
  function svg(m) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    ICONS[m].forEach(function (d) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p); });
    return s;
  }

  /* tombol pengganti tema: Otomatis → Terang → Gelap → Otomatis */
  function button(extraClass) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'theme-btn' + (extraClass ? ' ' + extraClass : '');
    function paint() {
      var m = mode(); b.replaceChildren(svg(m)); b.dataset.mode = m;
      var next = ORDER[(ORDER.indexOf(m) + 1) % ORDER.length];
      b.setAttribute('aria-label', 'Tema: ' + LABEL[m] + '. Ketuk untuk beralih ke ' + LABEL[next] + '.'); b.title = 'Tema: ' + LABEL[m];
    }
    b.addEventListener('click', cycle); window.addEventListener('themechange', paint); paint();
    return b;
  }

  apply();
  if (mq) { var onSys = function () { if (mode() === 'auto') apply(); }; if (mq.addEventListener) mq.addEventListener('change', onSys); else if (mq.addListener) mq.addListener(onSys); }
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) apply(); }); // sinkron antar tab

  /* situs publik: sisipkan tombol di bilah atas (admin memasangnya sendiri lewat Theme.button()) */
  document.addEventListener('DOMContentLoaded', function () {
    apply();
    var inner = document.querySelector('.topbar-inner');
    if (inner && !document.querySelector('.theme-btn') && !document.getElementById('app')) {
      var b = button(); var first = inner.querySelector('.icon-btn'); inner.insertBefore(b, first || null);
    }
  });

  window.Theme = { get mode() { return mode(); }, get theme() { return resolve(mode()); }, set: set, cycle: cycle, button: button, labels: LABEL };
})();
