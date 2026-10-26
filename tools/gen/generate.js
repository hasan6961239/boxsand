/* ============================================================
   generate.js — مولّد بيانات التجربة (المرحلة 0 من الخطة)
   ------------------------------------------------------------
   يصنع مكتبة كاملة صناعية: أماكن، كتب وقرطاسية بكمياتها في كل
   مكان، زبائن، وسنين من الفواتير والإرجاع والتسديد. لا شيء فيه
   من بيانات محل حقيقي (قرار 0013).

   الاستعمال:
     node tools/gen/generate.js --profile tripoli --out /tmp/t
     node tools/gen/generate.js --profile tripoli --books 100000 --years 5 --out /tmp/big
     node tools/gen/generate.js --profile misrata --store3 1 --out /tmp/m

   المخرجات (في --out، لا داخل المستودع):
     meta.json        الإعدادات والأعداد وبصمة البيانات
     places.json      شجرة الأماكن والمخازن
     items.jsonl      صنف في كل سطر، والمبالغ أعداد صحيحة بالدرهم (قرار 0006)
     customers.jsonl  الزبائن (هواتف 090 غير المستعملة في ليبيا)
     invoices.jsonl   الفواتير والإرجاع بالترتيب الزمني
     payments.jsonl   تسديد الديون
     store3.json      (مع --store3 N) نفس المكتبة بصيغة 3.x وآخر N سنة من الفواتير،
                      لقياس 3.x عليها

   نفس البذرة ونفس الخيارات = نفس الملفات بايتاً بايتاً.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { rng } = require('./rng');
const W = require('./words');

const PROFILES = {
  /* مصراتة: صغيرة، أغلب الكتب عليها ISBN، خزانة + رف وغرفة خزين */
  misrata: { books: 1500, stationery: 300, customers: 400, salesPerDay: 25, years: 1,
    barcodeRate: 0.8, layout: 'cabinets', warehouses: 0, branch: { id: 'misrata-test', name: 'مصراتة تجربة', city: 'مصراتة' } },
  /* طرابلس: كبيرة، بلا باركود غالباً، طوابق وأقسام ومخزنان */
  tripoli: { books: 20000, stationery: 2000, customers: 3000, salesPerDay: 100, years: 5,
    barcodeRate: 0.1, layout: 'floors', warehouses: 2, branch: { id: 'tripoli-test', name: 'طرابلس تجربة', city: 'طرابلس' } }
};

const DEFAULTS = { seed: 20261026, end: '2026-10-25' };
const DIRHAM = 1000;

/* ---------- أدوات ---------- */
const pad = (n, w) => String(n).padStart(w, '0');
function fill(tpl, map) { return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m)); }
function dayKey(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1, 2) + '-' + pad(d.getUTCDate(), 2); }
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
/* سعر بالدرهم مقرّب لأقرب step دينار */
function priceD(lyd, step) { return Math.max(step * DIRHAM, Math.round(lyd / step) * step * DIRHAM); }

/* ISBN-13 صحيح الخانة الأخيرة (978/979) — أو EAN-13 للقرطاسية */
function ean13(r, prefix) {
  let s = prefix;
  while (s.length < 12) s += r.int(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (+s[i]) * (i % 2 ? 3 : 1);
  return s + ((10 - (sum % 10)) % 10);
}

/* ---------- الأماكن ---------- */
const SECTIONS = ['علوم', 'هندسة', 'حاسوب', 'طب', 'قانون', 'اقتصاد', 'إنسانيات', 'لغات',
  'روايات', 'أطفال', 'ديني', 'مدرسي'];

function buildPlaces(r, p) {
  const out = [];
  let n = 0;
  const add = (parent, kind, name, code) => { const pl = { id: 'p' + (++n), parent, kind, name, code }; out.push(pl); return pl; };
  if (p.layout === 'floors') {
    const floors = ['الطابق الأرضي', 'الطابق الأول', 'الطابق الثاني'];
    let si = 0;
    floors.forEach((fname, fi) => {
      const f = add(null, 'floor', fname, 'ط' + fi);
      /* كل الأقسام موزّعة على الطوابق، ولكل طابق 4 أقسام */
      for (let k = 0; k < 4; k++) {
        const sec = add(f.id, 'section', SECTIONS[si % SECTIONS.length], SECTIONS[si % SECTIONS.length]);
        si++;
        const cabs = r.int(4, 7);
        for (let c = 0; c < cabs; c++) {
          const cab = add(sec.id, 'cabinet', 'خزانة ' + String.fromCharCode(65 + c), String.fromCharCode(65 + c));
          for (let s = 1; s <= 6; s++) add(cab.id, 'shelf', 'رف ' + s, String(s));
        }
      }
    });
    for (let w = 1; w <= p.warehouses; w++) add(null, 'store', w === 1 ? 'المخزن الأول' : w === 2 ? 'المخزن الثاني' : 'مخزن ' + w, 'م' + w);
  } else {
    for (let c = 0; c < 6; c++) {
      const cab = add(null, 'cabinet', 'خزانة ' + String.fromCharCode(65 + c), String.fromCharCode(65 + c));
      for (let s = 1; s <= 6; s++) add(cab.id, 'shelf', 'رف ' + s, String(s));
    }
    add(null, 'room', 'غرفة الخزين', 'خزين');
    for (let w = 1; w <= p.warehouses; w++) add(null, 'store', 'مخزن ' + w, 'م' + w);
  }
  return out;
}

/* الرفوف تحت قسم بعينه (طرابلس)، أو كل الرفوف (مصراتة) */
function shelvesBySection(places) {
  const byId = new Map(places.map(p => [p.id, p]));
  const map = new Map(), all = [];
  for (const p of places) {
    if (p.kind !== 'shelf') continue;
    all.push(p);
    let q = p, sec = null;
    while (q) { if (q.kind === 'section') { sec = q.name; break; } q = byId.get(q.parent); }
    if (sec) { if (!map.has(sec)) map.set(sec, []); map.get(sec).push(p); }
  }
  return { map, all };
}

/* المسار المختصر: ط1 · قانون · C · 4 */
function placePath(places, id) {
  const byId = new Map(places.map(p => [p.id, p]));
  const parts = [];
  let q = byId.get(id);
  while (q) { parts.unshift(q); q = byId.get(q.parent); }
  return parts;
}

/* ---------- الأسماء ---------- */
function makeNames(r) {
  const authors = [];
  for (let i = 0; i < 2600; i++) {
    const fem = r.chance(0.18);
    const first = r.pick(fem ? W.FIRST_F : W.FIRST_M);
    const father = r.chance(0.6) ? ' ' + r.pick(W.FIRST_M) : '';
    authors.push({ honor: r.weighted(W.HONOR), name: first + father + ' ' + r.pick(W.FAMILY) });
  }
  const pubs = [];
  const seen = new Set();
  while (pubs.length < 140) {
    const n = (r.pick(W.PUB_A) + ' ' + r.pick(W.PUB_B) + ' ' + r.pick(W.PUB_C)).trim();
    if (!seen.has(n)) { seen.add(n); pubs.push(n); }
  }
  return { authors, pubs };
}

function academicTitle(r) {
  const [s, g, sec] = r.pick(W.SUBJECTS);
  const adj = r.pick(W.ADJ)[g === 'f' ? 1 : 0];
  let t = fill(r.pick(W.ACADEMIC), { s, a: adj });
  if (r.chance(0.18)) {
    const part = r.int(1, 6);
    t += r.weighted([[' — الجزء ' + W.ORDINALS[part - 1], 3], [' ' + part, 2], [' ج' + part, 1]]);
  }
  if (r.chance(0.22)) t += ' ' + r.pick(W.AUDIENCE);
  return { t, sec, subj: s, cat: sec, catFull: sec + ' / ' + s };
}

function bookTitle(r) {
  const kind = r.weighted([['academic', 62], ['novel', 12], ['kids', 8], ['relig', 10], ['school', 8]]);
  if (kind === 'academic') return Object.assign({ kind }, academicTitle(r));
  if (kind === 'novel') {
    const t = (r.pick(W.NOVEL_A) + ' ' + r.pick(W.NOVEL_B) + ' ' + r.pick(W.NOVEL_C)).trim();
    return { kind, t, sec: 'روايات', subj: 'الرواية', cat: 'روايات', catFull: 'أدب / روايات' };
  }
  if (kind === 'kids') {
    const t = fill(r.pick(W.KIDS), { n: r.pick(W.KIDS_N), x: r.pick(W.KIDS_X), k: r.pick(W.KIDS_K) }) +
      (r.chance(0.4) ? ' ' + r.int(1, 12) : '');
    return { kind, t, sec: 'أطفال', subj: 'قصص الأطفال', cat: 'أطفال', catFull: 'أطفال / قصص' };
  }
  if (kind === 'relig') {
    const t = fill(r.pick(W.RELIG), { j: r.pick(W.RELIG_J), f: r.pick(W.RELIG_F), m: r.pick(W.RELIG_M), a2: r.pick(W.RELIG_A) });
    return { kind, t, sec: 'ديني', subj: 'العلوم الشرعية', cat: 'ديني', catFull: 'ديني / فقه وسيرة' };
  }
  const s = r.pick(W.SCHOOL_SUBJ);
  return { kind, t: s + ' للصف ' + r.pick(W.GRADES), sec: 'مدرسي', subj: s, cat: 'مدرسي', catFull: 'مدرسي / ' + s };
}

const PRICE = { academic: [15, 150, 2.2], novel: [10, 60, 1.6], kids: [3, 25, 1.5], relig: [5, 80, 2], school: [5, 30, 1.4] };

/* ---------- الأصناف ---------- */
function buildItems(r, p, places, names, opt) {
  const { map: bySec, all: shelves } = shelvesBySection(places);
  const stores = places.filter(x => x.kind === 'store');
  const room = places.find(x => x.kind === 'room');
  const items = [];
  const titles = new Set(), barcodes = new Set();
  const start = new Date(opt.end + 'T00:00:00Z');

  for (let i = 1; i <= p.books; i++) {
    let info, tries = 0;
    do { info = bookTitle(r); tries++; } while (titles.has(info.t) && tries < 6);
    if (titles.has(info.t)) info.t += ' (الطبعة ' + r.pick(['الثانية', 'الثالثة', 'الرابعة', 'الخامسة']) + ')';
    titles.add(info.t);
    const a = r.pick(names.authors);
    const [lo, hi, pw] = PRICE[info.kind];
    const price = priceD(lo + Math.pow(r.next(), pw) * (hi - lo), r.chance(0.8) ? 0.5 : 0.25);
    let barcode = '';
    if (r.chance(p.barcodeRate)) { do { barcode = ean13(r, r.chance(0.9) ? '978' : '979'); } while (barcodes.has(barcode)); barcodes.add(barcode); }
    const secShelves = bySec.get(info.sec);
    const shelf = (secShelves && secShelves.length ? r.pick(secShelves) : r.pick(shelves));
    const stock = [];
    const onShelf = r.chance(0.06) ? 0 : r.skewed(1, 40, 2.4);
    stock.push({ place: shelf.id, qty: onShelf });
    if (stores[0] && r.chance(0.35)) stock.push({ place: stores[0].id, qty: r.skewed(5, 60, 2) });
    if (stores[1] && r.chance(0.15)) stock.push({ place: stores[1].id, qty: r.skewed(3, 40, 2) });
    if (room && r.chance(0.2)) stock.push({ place: room.id, qty: r.int(1, 10) });
    items.push({
      id: 'b' + i, type: 'book', code: 'K' + pad(i, 5), title: info.t,
      author: (a.honor ? a.honor + ' ' : '') + a.name, publisher: r.pick(names.pubs),
      barcode, cat: info.cat, catFull: info.catFull,
      price, priceW: priceD(price / DIRHAM * 0.9, 0.5),
      cost: r.chance(0.08) ? 0 : priceD(price / DIRHAM * (0.55 + r.next() * 0.2), 0.25),
      min: r.weighted([[0, 40], [1, 20], [2, 20], [3, 10], [5, 10]]),
      note: r.chance(0.35) ? fill(r.pick(W.NOTE), { s: info.subj }) : '',
      created: dayKey(addDays(start, -r.int(opt.years * 365, opt.years * 365 + 400))),
      stock
    });
  }

  const statNames = new Set();
  for (let i = 1; i <= p.stationery; i++) {
    const [base, cat, unit, [lo, hi]] = r.pick(W.STAT);
    let name, tries = 0;
    do { name = base + ' ' + r.pick(W.STAT_VAR) + ' — ' + r.pick(W.BRANDS); tries++; } while (statNames.has(name) && tries < 6);
    if (statNames.has(name)) name += ' ' + i;
    statNames.add(name);
    let barcode = '';
    if (r.chance(0.7)) { do { barcode = ean13(r, '6' + r.int(0, 9) + r.int(0, 9)); } while (barcodes.has(barcode)); barcodes.add(barcode); }
    const price = priceD(lo + Math.pow(r.next(), 1.8) * (hi - lo), 0.25);
    const stock = [{ place: r.pick(shelves).id, qty: r.chance(0.05) ? 0 : r.skewed(1, 500, 2.6) }];
    if (stores[0] && r.chance(0.3)) stock.push({ place: stores[0].id, qty: r.skewed(10, 800, 2) });
    items.push({
      id: 's' + i, type: 'stat', code: 'Q' + pad(i, 5), title: name, author: '', brand: name.split(' — ')[1],
      publisher: '', barcode, cat, catFull: cat, unit,
      price, priceW: priceD(price / DIRHAM * 0.9, 0.25),
      cost: priceD(price / DIRHAM * (0.5 + r.next() * 0.2), 0.25),
      min: r.weighted([[0, 30], [5, 30], [10, 25], [20, 15]]), note: '',
      created: dayKey(addDays(start, -r.int(opt.years * 365, opt.years * 365 + 400))), stock
    });
  }
  return items;
}

/* ---------- الزبائن ---------- */
function buildCustomers(r, p) {
  const out = [];
  for (let i = 1; i <= p.customers; i++) {
    const shop = r.chance(0.08);
    const name = shop ? 'مكتبة ' + r.pick(W.PUB_B) + ' ' + r.pick(['', '2', 'الجديدة', 'للطلبة']).trim()
      : r.pick(r.chance(0.25) ? W.FIRST_F : W.FIRST_M) + ' ' + r.pick(W.FIRST_M) + ' ' + r.pick(W.FAMILY);
    out.push({ id: 'c' + i, name: name.trim(), phone: r.chance(0.85) ? '090' + pad(r.int(0, 9999999), 7) : '', wholesale: shop });
  }
  return out;
}

/* ---------- الفواتير ---------- */
/* موسم الدراسة في سبتمبر وأكتوبر، والامتحانات في يناير ومايو ويونيو، والصيف أهدأ.
   الجمعة شبه مغلقة. */
const MONTH_F = [1.2, 1.0, 0.9, 0.9, 1.15, 1.15, 0.65, 0.7, 1.6, 1.6, 1.0, 0.95];
const DAY_F = [1.0, 1.0, 1.0, 1.0, 1.0, 0.35, 0.9];   // الأحد..السبت (getUTCDay)

function writeSales(r, p, items, customers, opt, sink) {
  const n = items.length;
  /* شهرة الأصناف: ذيل طويل — قليل منها يباع كثيراً */
  const order = items.map((_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = r.int(0, i); const t = order[i]; order[i] = order[j]; order[j] = t; }
  const popular = () => items[order[r.skewed(0, n - 1, 2.6)]];

  const end = new Date(opt.end + 'T00:00:00Z');
  const days = Math.round(opt.years * 365);
  const start = addDays(end, -days + 1);
  const balance = new Map();
  const pending = [];               // [يوم الاستحقاق، زبون، مبلغ]
  const recent = [];                // فواتير قريبة يمكن الإرجاع منها
  let no = 0, payNo = 0, invCount = 0, retCount = 0;

  for (let d = 0; d < days; d++) {
    const date = addDays(start, d), dk = dayKey(date);
    const mean = p.salesPerDay * MONTH_F[date.getUTCMonth()] * DAY_F[date.getUTCDay()];
    const count = r.poisson(mean);
    const mins = [];
    for (let k = 0; k < count; k++) mins.push(r.int(9 * 60, 21 * 60));
    mins.sort((a, b) => a - b);

    for (let k = 0; k < count; k++) {
      const at = dk + ' ' + pad(Math.floor(mins[k] / 60), 2) + ':' + pad(mins[k] % 60, 2);
      const wholesale = r.chance(0.04);
      const method = r.weighted([['cash', 82], ['card', 8], ['credit', 10]]);
      const cust = (method === 'credit' || wholesale) ? r.pick(customers) : (r.chance(0.05) ? r.pick(customers) : null);
      const lines = [], used = new Set();
      const nl = wholesale ? r.int(2, 8) : r.weighted([[1, 55], [2, 25], [3, 10], [4, 5], [5, 3], [6, 2]]);
      for (let l = 0; l < nl; l++) {
        const it = popular();
        if (used.has(it.id)) continue;
        used.add(it.id);
        const qty = wholesale ? r.int(5, 30) : r.weighted([[1, 80], [2, 12], [3, 4], [5, 2], [10, 2]]);
        lines.push({ type: it.type, id: it.id, name: it.title, qty, price: wholesale ? it.priceW : it.price, cost: it.cost });
      }
      const sub = lines.reduce((s, l) => s + l.qty * l.price, 0);
      const disc = r.chance(0.06) ? Math.floor(sub * (0.05 + r.next() * 0.05) / 500) * 500 : 0;
      const total = sub - disc;
      const profit = total - lines.reduce((s, l) => s + l.qty * l.cost, 0);
      let paid = total;
      if (method === 'credit') paid = r.chance(0.5) ? 0 : Math.floor(total * r.next() / 500) * 500;
      const inv = { id: 'i' + (++no), no, kind: 'sale', date: dk, at, items: lines, subtotal: sub, discount: disc,
        total, profit, method, mode: wholesale ? 'wholesale' : 'retail', customerId: cust ? cust.id : '', paid, due: total - paid };
      invCount++;
      sink.invoice(inv);
      if (inv.due > 0) {
        balance.set(cust.id, (balance.get(cust.id) || 0) + inv.due);
        if (r.chance(0.75)) pending.push([d + r.int(3, 60), cust.id, r.chance(0.7) ? inv.due : Math.floor(inv.due / 2 / 500) * 500 || inv.due]);
      }
      recent.push(inv);
      if (recent.length > 300) recent.shift();
    }

    /* الإرجاع: حوالي 2% من الفواتير، من فواتير قريبة. البيع ينتهي 21:00،
       فالإرجاع بعده بالترتيب: الزمن يبقى متزايداً في السجل */
    const rets = Math.min(r.poisson(count * 0.02), 58);
    for (let k = 0; k < rets && recent.length; k++) {
      const src = r.pick(recent);
      if (src.kind !== 'sale' || src.returned) continue;
      src.returned = true;
      const l = r.pick(src.items);
      const q = r.int(1, l.qty);
      const gross = q * l.price;
      const ratio = src.subtotal ? (src.total / src.subtotal) : 1;
      const tot = Math.round(gross * ratio);
      let debtCut = 0;
      if (src.customerId) {
        const b = balance.get(src.customerId) || 0;
        debtCut = Math.min(tot, Math.max(b, 0));
        balance.set(src.customerId, b - debtCut);
      }
      const ret = { id: 'i' + (++no), no, kind: 'return', refNo: src.no, date: dk, at: dk + ' 21:' + pad(k + 1, 2),
        items: [{ type: l.type, id: l.id, name: l.name, qty: q, price: l.price, cost: l.cost }],
        subtotal: -gross, discount: -(gross - tot), total: -tot, profit: -(tot - q * l.cost),
        method: src.method, customerId: src.customerId, paid: -(tot - debtCut), due: -debtCut,
        cashBack: tot - debtCut, debtCut };
      retCount++;
      sink.invoice(ret);
    }

    /* تسديد الديون المستحقة اليوم */
    for (let k = pending.length - 1; k >= 0; k--) {
      const [due, cid, amt] = pending[k];
      if (due !== d) continue;
      pending.splice(k, 1);
      const b = balance.get(cid) || 0;
      const a = Math.min(amt, b);
      if (a <= 0) continue;
      balance.set(cid, b - a);
      sink.payment({ id: 'y' + (++payNo), customerId: cid, amount: a, date: dk, at: dk + ' 12:00', note: '' });
    }
  }
  return { balance, invCount, retCount, payCount: payNo, lastNo: no };
}

/* ---------- الكتابة ---------- */
function generate(options) {
  const prof = PROFILES[options.profile || 'tripoli'];
  if (!prof) throw new Error('profile غير معروف: ' + options.profile);
  const p = Object.assign({}, prof, pick(options, ['books', 'stationery', 'customers', 'salesPerDay', 'years', 'barcodeRate']));
  const opt = { seed: options.seed || DEFAULTS.seed, end: options.end || DEFAULTS.end, years: p.years };
  const out = options.out;
  if (!out) throw new Error('حدّد --out');
  fs.mkdirSync(out, { recursive: true });
  const root = rng(opt.seed);
  /* مولّدات مستقلة لكل جزء: زيادة الكتب لا تغيّر الفواتير إلا بقدر ما يلزم */
  const rPlaces = root.fork('places'), rNames = root.fork('names'), rItems = root.fork('items'),
    rCust = root.fork('customers'), rSales = root.fork('sales');

  const places = buildPlaces(rPlaces, p);
  const names = makeNames(rNames);
  const items = buildItems(rItems, p, places, names, opt);
  const customers = buildCustomers(rCust, p);

  const digest = crypto.createHash('sha256');
  const files = {};
  function open(name) {
    const fd = fs.openSync(path.join(out, name), 'w');
    let buf = [], size = 0, lines = 0;
    const flush = () => { if (buf.length) { const s = buf.join(''); fs.writeSync(fd, s); digest.update(s); buf = []; size = 0; } };
    return {
      line(o) { const s = JSON.stringify(o) + '\n'; buf.push(s); size += s.length; lines++; if (size > 1 << 20) flush(); },
      close() { flush(); fs.closeSync(fd); files[name] = lines; }
    };
  }
  function writeJson(name, o) { const s = JSON.stringify(o, null, 1); fs.writeFileSync(path.join(out, name), s); digest.update(s); }

  writeJson('places.json', places);
  const fi = open('items.jsonl'); items.forEach(x => fi.line(x)); fi.close();
  const fInv = open('invoices.jsonl'), fPay = open('payments.jsonl');
  const keepFrom = options.store3 ? dayKey(addDays(new Date(opt.end + 'T00:00:00Z'), -Math.round(options.store3 * 365) + 1)) : null;
  const inv3 = [], pay3 = [];
  const res = writeSales(rSales, p, items, customers, opt, {
    invoice(v) { fInv.line(v); if (keepFrom && v.date >= keepFrom) inv3.push(v); },
    payment(v) { fPay.line(v); if (keepFrom && v.date >= keepFrom) pay3.push(v); }
  });
  fInv.close(); fPay.close();
  customers.forEach(c => { c.balance = res.balance.get(c.id) || 0; });
  const fc = open('customers.jsonl'); customers.forEach(c => fc.line(c)); fc.close();

  const meta = {
    profile: options.profile || 'tripoli', seed: opt.seed, end: opt.end, branch: p.branch,
    counts: { places: places.length, books: p.books, stationery: p.stationery, customers: customers.length,
      sales: res.invCount, returns: res.retCount, payments: res.payCount },
    sha256: digest.digest('hex')
  };
  if (keepFrom) {
    const s3 = toStore3(p, places, items, customers, inv3, pay3, res.lastNo);
    fs.writeFileSync(path.join(out, 'store3.json'), JSON.stringify(s3));
    meta.store3 = { from: keepFrom, invoices: inv3.length };
  }
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta, null, 1));
  return meta;
}

function pick(o, keys) { const r = {}; keys.forEach(k => { if (o[k] !== undefined) r[k] = o[k]; }); return r; }

/* ---------- صيغة 3.x ----------
   المبالغ كسور بالدينار، الخزانة والرف حقلان، وغرفة الخزين في store،
   والمخازن مصفوفة بأصنافها، والفواتير الأحدث أولاً (كما تكتبها 3.x). */
function toStore3(p, places, items, customers, invoices, payments, lastNo) {
  const lyd = d => Math.round(d) / DIRHAM;
  const byId = new Map(places.map(x => [x.id, x]));
  const roomId = (places.find(x => x.kind === 'room') || {}).id;
  const stores = places.filter(x => x.kind === 'store');
  const books = [], stationery = [];
  const whStock = new Map(stores.map(w => [w.id, []]));
  for (const it of items) {
    let shelfQty = 0, roomQty = 0, lib = '', shelf = '', loc = '';
    for (const s of it.stock) {
      const pl = byId.get(s.place);
      if (pl.kind === 'shelf') {
        shelfQty += s.qty;
        const parts = placePath(places, pl.id);
        const cab = parts.find(x => x.kind === 'cabinet');
        lib = cab ? cab.code : ''; shelf = pl.code;
        loc = parts.map(x => x.code).join(' · ');
      } else if (s.place === roomId) roomQty += s.qty;
      else if (whStock.has(s.place)) whStock.get(s.place).push({ type: it.type, itemId: it.id, qty: s.qty });
    }
    const common = { id: it.id, code: it.code, barcode: it.barcode, cost: lyd(it.cost), price: lyd(it.price),
      priceW: lyd(it.priceW), qty: shelfQty + roomQty, store: roomQty, min: it.min, note: it.note,
      created: it.created + ' 10:00' };
    if (it.type === 'book') books.push(Object.assign(common, { title: it.title, author: it.author, publisher: it.publisher, cat: it.cat, catFull: it.catFull, lib, shelf }));
    else stationery.push(Object.assign(common, { name: it.title, brand: it.brand, cat: it.cat, unit: it.unit, loc }));
  }
  const inv = invoices.slice().reverse().map(v => {
    const o = Object.assign({}, v, {
      items: v.items.map(l => Object.assign({}, l, { price: lyd(l.price), cost: lyd(l.cost) })),
      subtotal: lyd(v.subtotal), discount: lyd(v.discount), total: lyd(v.total), profit: lyd(v.profit),
      paid: lyd(v.paid), due: lyd(v.due)
    });
    if ('cashBack' in v) { o.cashBack = lyd(v.cashBack); o.debtCut = lyd(v.debtCut); }
    delete o.returned;
    return o;
  });
  const cabs = [...new Set(places.filter(x => x.kind === 'cabinet').map(x => x.code))].sort();
  return {
    meta: { setupDone: true, shopName: p.branch.name, currency: 'د.ل', libraries: cabs, shelves: 6,
      bookCats: [...new Set(books.map(b => b.cat))], statCats: [...new Set(stationery.map(s => s.cat))] },
    branch: { id: p.branch.id, name: p.branch.name, city: p.branch.city, phone: '', label: '', no: 1 },
    books, stationery,
    customers: customers.map(c => ({ id: c.id, name: c.name, phone: c.phone, balance: lyd(c.balance) })),
    warehouses: stores.map(w => ({ id: w.id, name: w.name, place: '', phone: '', note: '', stock: whStock.get(w.id) })),
    invoices: inv,
    payments: payments.slice().reverse().map(y => Object.assign({}, y, { amount: lyd(y.amount) })),
    counters: { invoice: lastNo, book: books.length, stat: stationery.length }
  };
}

module.exports = { generate, PROFILES, ean13, placePath };

/* ---------- سطر الأوامر ---------- */
if (require.main === module) {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) {
    const k = a[i].replace(/^--/, ''), v = a[i + 1];
    if (['books', 'stationery', 'customers', 'salesPerDay', 'years', 'seed', 'store3', 'barcodeRate'].includes(k)) { o[k] = +v; i++; }
    else if (['profile', 'out', 'end'].includes(k)) { o[k] = v; i++; }
    else { console.error('خيار غير معروف: ' + a[i]); process.exit(2); }
  }
  const t0 = Date.now();
  const m = generate(o);
  console.log(JSON.stringify(m.counts) + '  sha256=' + m.sha256.slice(0, 16) + '  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
