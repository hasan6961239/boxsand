/* ============================================================
   test-gen.js — اختبار مولّد بيانات التجربة
   ------------------------------------------------------------
   البيانات المولّدة أساس كل قياس واختبار في المراحل القادمة، فلو
   كانت غير متّسقة (فاتورة لصنف غير موجود، دين لا يساوي فواتيره)
   لكذبت كل الاختبارات التي فوقها. شغّله: node tools/gen/test-gen.js
   ============================================================ */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { generate, ean13 } = require('./generate');
const { rng } = require('./rng');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  (ok ? pass++ : fail++);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (!ok && detail ? '\n          ' + detail : ''));
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-'));
const lines = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
function load(dir) {
  return {
    meta: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')),
    places: JSON.parse(fs.readFileSync(path.join(dir, 'places.json'), 'utf8')),
    items: lines(path.join(dir, 'items.jsonl')),
    customers: lines(path.join(dir, 'customers.jsonl')),
    invoices: lines(path.join(dir, 'invoices.jsonl')),
    payments: lines(path.join(dir, 'payments.jsonl'))
  };
}
function validEan(s) {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (+s[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === +s[12];
}

try {
  console.log('\n— الثبات —');
  const a = generate({ profile: 'misrata', books: 400, stationery: 80, years: 1, out: path.join(tmp, 'a') });
  const b = generate({ profile: 'misrata', books: 400, stationery: 80, years: 1, out: path.join(tmp, 'b') });
  const c = generate({ profile: 'misrata', books: 400, stationery: 80, years: 1, seed: 7, out: path.join(tmp, 'c') });
  check('نفس البذرة = نفس البيانات بايتاً بايتاً', a.sha256 === b.sha256, a.sha256 + ' / ' + b.sha256);
  check('بذرة أخرى = بيانات أخرى', a.sha256 !== c.sha256);
  const r1 = rng(5), r2 = rng(5);
  check('المولّد العشوائي ثابت البذرة', [1, 2, 3].every(() => r1.next() === r2.next()));
  const e = ean13(rng(1), '978');
  check('الباركود المولّد صحيح الخانة الأخيرة', validEan(e), e);

  for (const prof of ['misrata', 'tripoli']) {
    console.log('\n— ' + prof + ' —');
    const dir = path.join(tmp, prof);
    const opt = prof === 'tripoli' ? { profile: prof, books: 3000, stationery: 400, customers: 500, years: 2, store3: 1, out: dir }
      : { profile: prof, store3: 1, out: dir };
    generate(opt);
    const d = load(dir);
    const byPlace = new Map(d.places.map(p => [p.id, p]));
    const byItem = new Map(d.items.map(x => [x.id, x]));

    // الأماكن
    const kinds = new Set(d.places.map(p => p.kind));
    check('كل مكان أبوه موجود', d.places.every(p => p.parent === null || byPlace.has(p.parent)));
    check('الرف تحت خزانة دائماً', d.places.filter(p => p.kind === 'shelf').every(p => byPlace.get(p.parent).kind === 'cabinet'));
    if (prof === 'tripoli') {
      check('طرابلس: 3 طوابق تحتها أقسام', d.places.filter(p => p.kind === 'floor').length === 3 && kinds.has('section'));
      check('طرابلس: مخزنان', d.places.filter(p => p.kind === 'store').length === 2);
    } else {
      check('مصراتة: خزانة + رف وغرفة خزين، بلا طوابق', !kinds.has('floor') && kinds.has('room'));
    }

    // الأصناف
    const ids = new Set(d.items.map(x => x.id));
    check('الأعداد كما طُلبت', d.items.filter(x => x.type === 'book').length === d.meta.counts.books &&
      d.items.filter(x => x.type === 'stat').length === d.meta.counts.stationery);
    check('المعرّفات والرموز فريدة', ids.size === d.items.length && new Set(d.items.map(x => x.code)).size === d.items.length);
    const bcs = d.items.map(x => x.barcode).filter(Boolean);
    check('الباركودات فريدة وصحيحة الخانة الأخيرة', new Set(bcs).size === bcs.length && bcs.every(validEan), bcs.find(x => !validEan(x)));
    const rate = d.items.filter(x => x.type === 'book' && x.barcode).length / d.meta.counts.books;
    check(prof === 'tripoli' ? 'طرابلس: أغلب الكتب بلا باركود' : 'مصراتة: أغلب الكتب عليها ISBN',
      prof === 'tripoli' ? rate < 0.2 : rate > 0.7, rate.toFixed(2));
    check('المبالغ أعداد صحيحة بالدرهم، مضاعفات ربع دينار',
      d.items.every(x => [x.price, x.priceW, x.cost].every(v => Number.isInteger(v) && v >= 0 && v % 250 === 0)) &&
      d.items.every(x => x.price > 0));
    check('لكل صنف رف واحد، وكل مكان في مخزونه موجود',
      d.items.every(x => x.stock.filter(s => byPlace.get(s.place).kind === 'shelf').length === 1 &&
        x.stock.every(s => byPlace.has(s.place) && Number.isInteger(s.qty) && s.qty >= 0)));
    const titles = d.items.filter(x => x.type === 'book').map(x => x.title);
    check('العناوين شبه فريدة (أقل من 1% مكرر)', new Set(titles).size / titles.length > 0.99);

    // الفواتير
    let bad = null, lastAt = '', saleNos = new Set();
    const bal = new Map();
    for (const v of d.invoices) {
      if (v.at < lastAt) { bad = bad || 'ترتيب زمني: ' + v.no; }
      lastAt = v.at;
      if (!v.items.length) bad = bad || 'فاتورة بلا أسطر: ' + v.no;
      for (const l of v.items) if (!byItem.has(l.id)) bad = bad || 'صنف غير موجود: ' + l.id;
      const sub = v.items.reduce((s, l) => s + l.qty * l.price, 0);
      if (v.kind === 'sale') {
        saleNos.add(v.no);
        if (v.subtotal !== sub || v.total !== v.subtotal - v.discount || v.due !== v.total - v.paid || v.due < 0 || v.discount < 0)
          bad = bad || 'مجاميع بيع: ' + v.no;
        if (v.method === 'credit' && !v.customerId) bad = bad || 'آجل بلا زبون: ' + v.no;
        if (v.due > 0) bal.set(v.customerId, (bal.get(v.customerId) || 0) + v.due);
      } else {
        if (!saleNos.has(v.refNo) || v.subtotal !== -sub || v.total > 0) bad = bad || 'إرجاع: ' + v.no;
        if (v.debtCut) bal.set(v.customerId, (bal.get(v.customerId) || 0) - v.debtCut);
      }
    }
    check('كل فاتورة: أصنافها موجودة، مجاميعها صحيحة، بترتيب الزمن', !bad, bad);
    check('الأرقام تسلسلية بلا فجوات', d.invoices.every((v, i) => v.no === i + 1));
    for (const y of d.payments) bal.set(y.customerId, (bal.get(y.customerId) || 0) - y.amount);
    check('دين كل زبون = فواتيره الآجلة − الإرجاع − التسديد، ولا دين سالب',
      d.customers.every(c => (bal.get(c.id) || 0) === c.balance && c.balance >= 0),
      JSON.stringify(d.customers.find(c => (bal.get(c.id) || 0) !== c.balance)));
    const phones = d.customers.map(c => c.phone).filter(Boolean);
    check('هواتف الزبائن بالبادئة 090 غير المستعملة', phones.every(p => /^090\d{7}$/.test(p)));
    const fri = d.invoices.filter(v => new Date(v.date + 'T00:00:00Z').getUTCDay() === 5).length / d.invoices.length;
    check('الجمعة أهدأ أيام الأسبوع', fri < 0.1, fri.toFixed(3));

    // صيغة 3.x
    const s3 = JSON.parse(fs.readFileSync(path.join(dir, 'store3.json'), 'utf8'));
    check('3.x: الأقسام الأساسية موجودة', ['meta', 'branch', 'books', 'stationery', 'customers', 'invoices', 'payments', 'counters', 'warehouses']
      .every(k => k in s3));
    check('3.x: الفواتير الأحدث أولاً وآخر سنة فقط', s3.invoices.length === d.meta.store3.invoices &&
      s3.invoices.every((v, i, a) => i === 0 || a[i - 1].at >= v.at) && s3.invoices.every(v => v.date >= d.meta.store3.from));
    const b0 = d.items.find(x => x.type === 'book'), b3 = s3.books.find(x => x.id === b0.id);
    const shelfQ = b0.stock.filter(s => byPlace.get(s.place).kind === 'shelf').reduce((t, s) => t + s.qty, 0);
    check('3.x: المبالغ بالدينار والكمية = الرف + غرفة الخزين', b3.price === b0.price / 1000 && b3.qty === shelfQ + b3.store);
    const whQ = s3.warehouses.reduce((t, w) => t + w.stock.reduce((u, s) => u + s.qty, 0), 0);
    const storeIds = new Set(d.places.filter(p => p.kind === 'store').map(p => p.id));
    const genWhQ = d.items.reduce((t, x) => t + x.stock.filter(s => storeIds.has(s.place)).reduce((u, s) => u + s.qty, 0), 0);
    check('3.x: كميات المخازن كاملة', whQ === genWhQ, whQ + ' / ' + genWhQ);
    check('3.x: ديون الزبائن بالدينار', s3.customers.every((c, i) => c.balance === d.customers[i].balance / 1000));
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(50) + '\n  نجح: ' + pass + '    فشل: ' + fail + '\n' + '='.repeat(50));
process.exit(fail ? 1 : 0);
