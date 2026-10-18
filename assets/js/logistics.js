/* Logistics — Kalkulator Logistik Gunung: nilai bawaan, perhitungan, dan teks daftar.
   Dipakai situs publik (modal kalkulator) dan CMS (nilai bawaan saat data/logistics.json belum ada). UMD, tanpa DOM.
   Seluruh angka & daftar perlengkapan berasal dari data/logistics.json yang dikelola di CMS (Konten → Logistik). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logistics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const CATS = ['Tidur & Tenda', 'Masak & Makan', 'Pakaian', 'Navigasi & Keselamatan', 'Kesehatan', 'Lainnya'];
const PER = [['orang', 'per orang'], ['kelompok', 'per kelompok'], ['orang-hari', 'per orang per hari'], ['kelompok-hari', 'per kelompok per hari']];
const LEVELS = ['Mudah', 'Menengah', 'Menantang']; // sama dengan tingkat kesulitan jejak

const defaults = () => ({
  enabled: true,
  button: 'Kalkulator Logistik',
  eyebrow: 'Alat bantu pendaki',
  title: 'Kalkulator Logistik Gunung',
  intro: 'Hitung kebutuhan air, makanan, bahan bakar, dan perlengkapan sesuai jumlah pendaki, lama perjalanan, dan kondisi cuaca.',
  defaults: { people: 2, days: 2, condition: 'sejuk' },
  rates: { waterL: 3, kcal: 2500, foodKg: 0.6, fuelG: 60, canisterG: 230, reservePct: 10 },
  levels: { Mudah: { water: 0.9, kcal: 0.9 }, Menengah: { water: 1, kcal: 1 }, Menantang: { water: 1.15, kcal: 1.2 } },
  conditions: [
    { id: 'hangat', name: 'Hangat / terik', water: 1.3, kcal: 1 },
    { id: 'sejuk', name: 'Sejuk', water: 1, kcal: 1.05 },
    { id: 'dingin', name: 'Dingin / berangin', water: 0.9, kcal: 1.25 },
  ],
  items: [
    { id: 'tenda', name: 'Tenda (kapasitas 2 orang)', cat: 'Tidur & Tenda', per: 'orang', qty: 0.5, unit: 'unit', weightG: 2500, on: true },
    { id: 'sleeping-bag', name: 'Sleeping bag', cat: 'Tidur & Tenda', per: 'orang', qty: 1, unit: 'buah', weightG: 900, on: true },
    { id: 'matras', name: 'Matras', cat: 'Tidur & Tenda', per: 'orang', qty: 1, unit: 'buah', weightG: 400, on: true },
    { id: 'kompor', name: 'Kompor portable', cat: 'Masak & Makan', per: 'kelompok', qty: 1, unit: 'unit', weightG: 350, on: true },
    { id: 'nesting', name: 'Nesting / panci', cat: 'Masak & Makan', per: 'kelompok', qty: 1, unit: 'set', weightG: 500, on: true },
    { id: 'korek', name: 'Korek api / lighter', cat: 'Masak & Makan', per: 'kelompok', qty: 2, unit: 'buah', weightG: 30, on: true },
    { id: 'alat-makan', name: 'Piring, sendok & gelas', cat: 'Masak & Makan', per: 'orang', qty: 1, unit: 'set', weightG: 150, on: true },
    { id: 'jas-hujan', name: 'Jas hujan / ponco', cat: 'Pakaian', per: 'orang', qty: 1, unit: 'buah', weightG: 250, on: true },
    { id: 'jaket', name: 'Jaket hangat', cat: 'Pakaian', per: 'orang', qty: 1, unit: 'buah', weightG: 500, on: true },
    { id: 'kaos-ganti', name: 'Kaos ganti', cat: 'Pakaian', per: 'orang-hari', qty: 0.5, unit: 'buah', weightG: 200, on: true },
    { id: 'kaos-kaki', name: 'Kaus kaki', cat: 'Pakaian', per: 'orang-hari', qty: 0.5, unit: 'pasang', weightG: 80, on: true },
    { id: 'headlamp', name: 'Headlamp + baterai cadangan', cat: 'Navigasi & Keselamatan', per: 'orang', qty: 1, unit: 'buah', weightG: 120, on: true },
    { id: 'powerbank', name: 'Powerbank', cat: 'Navigasi & Keselamatan', per: 'kelompok', qty: 1, unit: 'buah', weightG: 300, on: true },
    { id: 'p3k', name: 'Kotak P3K', cat: 'Kesehatan', per: 'kelompok', qty: 1, unit: 'set', weightG: 400, on: true },
    { id: 'obat-pribadi', name: 'Obat pribadi', cat: 'Kesehatan', per: 'orang', qty: 1, unit: 'set', weightG: 50, on: true },
    { id: 'kantong-sampah', name: 'Kantong sampah (bawa turun)', cat: 'Lainnya', per: 'kelompok-hari', qty: 1, unit: 'buah', weightG: 20, on: true },
  ],
});

const clampInt = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const r1 = (n) => Math.round(n * 10) / 10;

/* Perhitungan murni. input: { people, days, level, condition } → hasil terstruktur (angka mentah; pembulatan tampilan di UI). */
function calc(cfg, input = {}) {
  const people = clampInt(input.people, 1, 50, 1), days = clampInt(input.days, 1, 30, 1);
  const lv = (cfg.levels && cfg.levels[input.level]) || { water: 1, kcal: 1 };
  const cond = (cfg.conditions || []).find((c) => c.id === input.condition) || { water: 1, kcal: 1, name: '' };
  const R = cfg.rates, reserve = 1 + R.reservePct / 100, pd = people * days;
  const waterPD = R.waterL * lv.water * cond.water, kcalPD = R.kcal * lv.kcal * cond.kcal;
  const waterL = waterPD * pd * reserve, kcal = kcalPD * pd * reserve;
  const foodKg = R.foodKg * (kcalPD / R.kcal) * pd * reserve, fuelG = R.fuelG * pd * reserve;
  const canisters = R.canisterG > 0 && fuelG > 0 ? Math.ceil(fuelG / R.canisterG - 1e-9) : 0;
  const factor = { orang: people, kelompok: 1, 'orang-hari': pd, 'kelompok-hari': days };
  const byCat = new Map(); let itemsG = 0;
  for (const it of cfg.items || []) {
    if (!it.on) continue;
    const qty = Math.max(1, Math.ceil(it.qty * factor[it.per] - 1e-9)); itemsG += qty * (it.weightG || 0);
    if (!byCat.has(it.cat)) byCat.set(it.cat, []);
    byCat.get(it.cat).push({ id: it.id, name: it.name, qty, unit: it.unit, weightG: qty * (it.weightG || 0) });
  }
  const groups = CATS.filter((c) => byCat.has(c)).concat([...byCat.keys()].filter((c) => !CATS.includes(c))).map((cat) => ({ cat, rows: byCat.get(cat) }));
  const canisterWeight = canisters * (R.canisterG || 0) * 1.0; // tabung penuh dibawa utuh
  const totalKg = waterL + foodKg + canisterWeight / 1000 + itemsG / 1000, perPersonKg = totalKg / people;
  const warnings = [];
  if (perPersonKg > 18) warnings.push(`Estimasi beban ±${r1(perPersonKg)} kg per orang tergolong berat. Pertimbangkan membagi beban, mengisi ulang air di sumber air, atau mengurangi hari.`);
  if (waterL / people / days > 4.5) warnings.push('Kebutuhan air per orang per hari tinggi (cuaca panas/jalur berat). Pastikan titik sumber air di jalur dan bawa penjernih.');
  if (days >= 4) warnings.push('Perjalanan panjang: pertimbangkan titik resupply, porter, atau penitipan logistik.');
  return { people, days, level: input.level || '', condition: cond.name || '', waterL, waterPerPersonDay: waterPD, waterPerPerson: waterL / people, kcal, kcalPerPersonDay: kcalPD, foodKg, fuelG, canisters, groups, itemsKg: itemsG / 1000, totalKg, perPersonKg, warnings };
}

/* Saran jumlah hari dari teks estimasi jejak ("2–3 hari" → 3; "5–6 jam" → 1). */
function daysFromTime(text) {
  const m = /(\d+)(?:\s*[–-]\s*(\d+))?\s*hari/i.exec(String(text || ''));
  return m ? Math.max(1, Math.min(30, Number(m[2] || m[1]))) : 1;
}

/* Teks daftar untuk disalin/dibagikan. */
function toText(res, { title = 'Daftar Logistik Pendakian', trail = '' } = {}) {
  const nf = (n, d = 1) => Number(n).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: d });
  const L = [title, trail ? `Jejak: ${trail}` : null, `${res.people} pendaki · ${res.days} hari${res.level ? ' · ' + res.level : ''}${res.condition ? ' · ' + res.condition : ''}`, '',
    'KEBUTUHAN', `• Air: ${nf(res.waterL)} L (±${nf(res.waterPerPerson)} L/orang)`, `• Makanan: ${nf(res.foodKg)} kg (±${nf(res.kcal, 0)} kkal total)`,
    `• Bahan bakar: ${nf(res.fuelG, 0)} g${res.canisters ? ` (±${res.canisters} tabung)` : ''}`, `• Estimasi beban: ±${nf(res.perPersonKg)} kg/orang`];
  for (const g of res.groups) { L.push('', g.cat.toUpperCase()); g.rows.forEach((r) => L.push(`☐ ${r.name} — ${r.qty} ${r.unit}`)); }
  L.push('', 'Estimasi untuk perencanaan; sesuaikan dengan kondisi lapangan.');
  return L.filter((x) => x !== null).join('\n');
}

return { CATS, PER, LEVELS, defaults, calc, daysFromTime, toText };
});
