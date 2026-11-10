/* ============================================================
   test-print.js — كل ما يُطبع، PDF حقيقياً بمقاس ورقته
   ------------------------------------------------------------
   المحرك الحقيقي للتطبيقين (مصراتة وطرابلس) وتطبيق الهاتف. كل زر طباعة
   يُضغط كما هو، وبدل نافذة الطباعة تُؤخذ الورقة PDF من المتصفح نفسه
   بمقاسها (‎@page) كما تذهب للطابعة، ثم تُفحص:
     • المقاس: إيصال 80 و58 مم، لاصقة بمقاسها، A4 للكشوف والتقارير.
     • الإيصال ورقة واحدة طولها لا يقلّ عن عرضها (الأقصر من عرضه كانت
       الطابعة تقلبه على جنبه).
     • لا صفحة فارغة، ولا شيء يلمس حافة الورقة (مقصوص أو خارجها).
     • اللاصقات: صفحة لكل لاصقة بلا صفحات زائدة.
   QI_SHOTS=مجلد يحفظ صور الصفحات كلها للمراجعة بالعين.
     node tools/test-print.js
   يحتاج pdfinfo وpdftoppm (poppler-utils) وconvert (ImageMagick).
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright-core');
const E = require('./engine');
const { generate } = require('./gen/generate');

const ROOT = path.join(__dirname, '..'), SITE = path.join(ROOT, 'site');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.QI_SHOTS || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(c, name, d) {
  if (c) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (d === undefined ? '' : ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); }
  return !!c;
}

/* ---------- PDF: عدد الصفحات ومقاسها، وصور صفحاتها ---------- */
const MM = 25.4 / 72;
function pdfInfo(f) {
  const t = execFileSync('pdfinfo', [f], { encoding: 'utf8' });
  const m = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(t);
  return { pages: +(/Pages:\s+(\d+)/.exec(t) || [])[1] || 0, w: m ? +m[1] * MM : 0, h: m ? +m[2] * MM : 0 };
}
const gray = (png, args) => parseFloat(execFileSync('convert', [png, '-colorspace', 'Gray'].concat(args, ['-format', '%[fx:minima]', 'info:']), { encoding: 'utf8' }));
/* حبر الصفحة: أغمق نقطة فيها كلها، وفي شريط 1 مم عند كل حافة (1 = أبيض) */
function ink(png, dpi) {
  const e = Math.max(2, Math.round(dpi / 25.4));
  return {
    all: gray(png, []),
    left: gray(png, ['-gravity', 'West', '-crop', e + 'x0+0+0', '+repage']),
    right: gray(png, ['-gravity', 'East', '-crop', e + 'x0+0+0', '+repage']),
    bottom: gray(png, ['-gravity', 'South', '-crop', '0x' + e + '+0+0', '+repage'])
  };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(process.env.SIM_TMP || os.tmpdir(), 'qpr-'));
  const out = SHOTS || path.join(tmp, 'shots');
  fs.mkdirSync(out, { recursive: true });
  let browser = null;
  const engines = [], servers = [];
  const made = [];

  /* يضغط، ينتظر طلب الطباعة، ويأخذ الورقة PDF. paper: مقاس ورق الطابعة إن لم تحدده الصفحة نفسها */
  async function print(pg, name, press, o) {
    o = o || {};
    await pg.evaluate(() => { window.__prints = 0; });
    try { await press(); } catch (e) { ok(false, name + ': الزر يعمل', String(e && e.message || e)); return null; }
    const asked = await pg.waitForFunction(() => window.__prints > 0, null, { timeout: 8000 }).then(() => true, () => false);
    if (!ok(asked, name + ': طُلبت الطباعة')) return null;
    /* الصور (الإيصال) مرسومة قبل أخذ الورقة */
    await pg.evaluate(() => Promise.all([...document.querySelectorAll('#printArea img, #printHost img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))));
    if (o.before) await pg.evaluate(o.before);
    /* المقصوص لا يظهر في الصورة (يختفي عند هامش الورقة): يُقاس المحتوى في عرض الورق المطبوع نفسه */
    if (o.fit) {
      await pg.emulateMedia({ media: 'print' });
      const f = await pg.evaluate(([sel, mm]) => {
        const box = document.querySelector(sel);
        if (!box) return null;
        const w = box.style.width, ov = box.style.overflow;
        box.style.width = mm + 'mm'; box.style.overflow = 'hidden';
        const r = { content: box.scrollWidth, paper: box.clientWidth };
        box.style.width = w; box.style.overflow = ov;
        return r;
      }, [o.fitSel || '#printArea', o.fit]);
      await pg.emulateMedia({ media: null });
      ok(f && f.content <= f.paper + 2, name + ': كله داخل عرض الورق المطبوع (' + o.fit + ' مم)', f);
    }
    const opt = { printBackground: true, preferCSSPageSize: true };
    if (o.paper) { opt.width = o.paper[0] + 'mm'; opt.height = o.paper[1] + 'mm'; } else opt.format = 'A4';
    const file = path.join(out, name.replace(/[^\w؀-ۿ-]+/g, '_') + '.pdf');
    fs.writeFileSync(file, await pg.pdf(opt));
    const info = pdfInfo(file);
    const dpi = o.dpi || 110, show = Math.min(info.pages, o.show || 3);
    const base = path.basename(file, '.pdf') + '-';
    fs.readdirSync(out).filter(f => f.startsWith(base) && f.endsWith('.png')).forEach(f => fs.unlinkSync(path.join(out, f)));
    execFileSync('pdftoppm', ['-png', '-r', String(dpi), '-f', '1', '-l', String(show), file, file.replace(/\.pdf$/, '')]);
    const pngs = fs.readdirSync(out).filter(f => f.startsWith(path.basename(file, '.pdf') + '-') && f.endsWith('.png')).sort().map(f => path.join(out, f));
    const inks = pngs.map(p => ink(p, dpi));
    const r = { name, file, info, pngs, inks };
    made.push(r);
    /* الفحوص المشتركة */
    if (o.w) ok(Math.abs(info.w - o.w) < 1.2, name + ': عرض الورقة ' + o.w + ' مم', info);
    if (o.h) ok(Math.abs(info.h - o.h) < 1.2, name + ': طول الورقة ' + o.h + ' مم', info);
    if (o.pages) ok(info.pages === o.pages, name + ': ' + o.pages + ' صفحة', info);
    if (o.maxPages) ok(info.pages >= 1 && info.pages <= o.maxPages, name + ': من صفحة إلى ' + o.maxPages, info);
    if (o.portrait) ok(info.h >= info.w - 0.2, name + ': طول الورقة لا يقلّ عن عرضها (' + info.w.toFixed(0) + '×' + info.h.toFixed(0) + ' مم)', info);
    ok(inks.length > 0 && inks.every(k => k.all < 0.6), name + ': لا صفحة فارغة (' + info.pages + ' صفحة)', inks.map(k => k.all));
    ok(inks.every(k => k.left > 0.75 && k.right > 0.75), name + ': لا شيء يلمس حافتي الورقة', inks.map(k => [k.left, k.right]));
    if (o.bottom) ok(inks.every(k => k.bottom > 0.75), name + ': لا شيء مقصوص من أسفل', inks.map(k => k.bottom));
    return r;
  }
  const closeModals = pg => pg.evaluate(() => { const h = document.getElementById('modalHost'); if (h) h.innerHTML = ''; document.querySelectorAll('.overlay,.done-pop,.celebrate').forEach(e => e.remove()); });

  async function shop(edition, store, body) {
    const dir = path.join(tmp, edition), home = path.join(tmp, edition + '-h');
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true }); fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(dir, 'data', 'store.json'), JSON.stringify(store));
    E.buildEngine(dir, edition);
    const proc = E.startEngine(dir, home);
    engines.push(proc);
    const port = await E.waitPort(dir);
    const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    await pg.addInitScript(() => { window.print = () => { window.__prints = (window.__prints || 0) + 1; }; });
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('dialog', x => x.accept().catch(() => { }));
    await pg.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S && App.S.books && window.Sales && window.Rep && window.Labels && App.S.meta && App.S.meta.setupDone, null, { timeout: 120000 });
    await sleep(1200);
    await body(pg, edition);
    ok(errs.length === 0, (edition === 'tripoli' ? 'طرابلس' : 'مصراتة') + ': بلا أخطاء في الشاشة أثناء الطباعة', errs.slice(0, 3));
    const lg = fs.readFileSync(path.join(dir, 'data', 'log.txt'), 'utf8').split('\n').filter(l => /Exception|   at /.test(l));
    ok(lg.length === 0, (edition === 'tripoli' ? 'طرابلس' : 'مصراتة') + ': سجل البرنامج بلا أخطاء داخلية', lg.slice(0, 3));
    await pg.close();
  }

  /* بيانات فيها كل ما يُطبع: موردون بديون، كتب على المباع، غرفة خزين، وأسماء طويلة */
  function enrich(s) {
    s.meta.phone = '091-2345678 · 051-2620000';
    s.meta.address = 'شارع طرابلس، مقابل مصرف الجمهورية';
    s.meta.footer = 'شكراً لزيارتكم — البضاعة المباعة تُستبدل خلال ثلاثة أيام بالإيصال';
    const day = s.invoices[0].date;
    s.suppliers = [
      { id: 'sup1', name: 'دار الفكر العربي للطباعة والنشر والتوزيع', phone: '0912223344', opening: 1500, created: '2026-01-05 10:00' },
      { id: 'sup2', name: 'مكتبة النور', phone: '', opening: 0, created: '2026-02-01 10:00' }
    ];
    s.purchases = [];
    s.supPayments = [];
    for (let i = 0; i < 46; i++) {
      const d = '2026-' + String(1 + (i % 10)).padStart(2, '0') + '-' + String(1 + (i % 27)).padStart(2, '0');
      s.purchases.push({ id: 'pu' + i, date: d, at: d + ' 11:00', supplierId: i % 9 === 0 ? 'sup2' : 'sup1', note: i % 4 === 0 ? 'فاتورة رقم ' + (300 + i) + ' — كتب الفصل الدراسي الثاني' : '', pay: i % 5 === 4 ? 'cash' : 'credit', total: 120 + i * 37.5, lines: [{ type: 'book', id: s.books[i].id, name: s.books[i].title, qty: 5, cost: 3 }] });
      if (i % 3 === 0) s.supPayments.push({ id: 'sp' + i, supplierId: 'sup1', amount: 200 + i * 10, date: d, at: d + ' 16:30', note: i % 6 === 0 ? 'حوالة مصرفية' : '', fromDrawer: i % 2 === 0 });
    }
    s.consignors = [{ id: 'own1', name: 'د. عبد السلام محمد الفيتوري', phone: '0925556677', note: '', at: '2026-03-01 10:00' }];
    s.consignments = []; s.consPayments = [];
    for (let i = 0; i < 38; i++) {
      const b = s.books[100 + i];
      s.consignments.push({ id: 'cn' + i, ownerId: 'own1', itemId: b.id, type: 'book', title: b.title, author: b.author || '', code: b.code, qty: 20 + i, sold: 3 + (i % 9), returned: i % 4, price: 30 + i, ownerPrice: 22 + i, at: '2026-03-02', note: '' });
    }
    s.consPayments.push({ id: 'cp1', ownerId: 'own1', amount: 350, date: '2026-06-01', at: '2026-06-01 12:00', note: '', fromDrawer: true });
    /* غرفة الخزين: كتب فيها نسخ، وكتب نفدت من الرف وفي الغرفة منها (قائمة السحب) */
    s.books.slice(200, 260).forEach((b, i) => { b.store = 4 + (i % 9); b.min = 3; if (i % 2) b.qty = 0; });
    s.books.slice(300, 330).forEach(b => { b.qty = 1; b.min = 5; });
    s.books[1].title = 'الموسوعة الشاملة في أصول الفقه الإسلامي المقارن وتطبيقاته المعاصرة في المعاملات المالية — المجلد الثالث عشر';
    s.stationery[1].name = 'Faber-Castell Grip 2001 HB Pencil Box of 12 (Graphite)';
    /* زبون له كشف طويل، وفاتورة آجلة عليه */
    const big = s.customers[0];
    big.name = 'مدرسة الأمل الخاصة للتعليم الأساسي والثانوي';
    let no = s.counters.invoice;
    for (let i = 0; i < 70; i++) {
      const b = s.books[400 + i], d = '2026-' + String(1 + (i % 10)).padStart(2, '0') + '-' + String(1 + (i % 27)).padStart(2, '0');
      s.invoices.unshift({ id: 'pr-cr' + i, no: ++no, kind: 'sale', date: d, at: d + ' 10:15', items: [{ type: 'book', id: b.id, name: b.title, qty: 2, price: b.price, cost: b.cost }], subtotal: b.price * 2, discount: 0, total: b.price * 2, profit: (b.price - b.cost) * 2, method: 'credit', mode: 'retail', customerId: big.id, paid: 0, due: b.price * 2 });
      big.balance = (big.balance || 0) + b.price * 2;
      if (i % 4 === 0) { s.payments.unshift({ id: 'pr-py' + i, customerId: big.id, amount: 5, date: d, at: d + ' 18:00', note: '' }); big.balance -= 5; }
    }
    /* فواتير اليوم للإيصالات: صنف واحد، ثمانية، خمسة وأربعون، آجل، جملة بخصم، إرجاع */
    const line = (b, q) => ({ type: b.title ? 'book' : 'stat', id: b.id, name: b.title || b.name, qty: q, price: b.price, cost: b.cost });
    const inv = (id, lines, x) => {
      const sub = lines.reduce((a, l) => a + l.price * l.qty, 0), disc = (x && x.discount) || 0;
      const v = Object.assign({ id, no: ++no, kind: 'sale', date: day, at: day + ' 12:30', items: lines, subtotal: sub, discount: disc, total: sub - disc, profit: 0, method: 'cash', mode: 'retail', customerId: '', paid: sub - disc, due: 0 }, x || {});
      s.invoices.unshift(v);
      return v;
    };
    inv('pr-one', [line(s.books[10], 1)]);
    inv('pr-eight', s.books.slice(20, 26).map(b => line(b, 2)).concat([line(s.books[1], 1), line(s.stationery[1], 3)]));
    inv('pr-long', s.books.slice(500, 545).map((b, i) => line(b, 1 + (i % 3))));
    const cr = inv('pr-credit', [line(s.books[30], 2), line(s.books[31], 1)], { method: 'credit', customerId: big.id });
    cr.paid = 10; cr.due = cr.total - 10; big.balance += cr.due;
    inv('pr-whole', s.books.slice(40, 44).map(b => line(b, 10)), { mode: 'wholesale', discount: 15, method: 'card' });
    const rt = inv('pr-ret', [line(s.books[10], 1)], { kind: 'return', refNo: no - 5 });
    rt.subtotal = -rt.subtotal; rt.total = -rt.total; rt.paid = rt.total; rt.cashBack = -rt.total;
    s.counters.invoice = no;
    return { day, big: big.id };
  }

  try {
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

    /* ================= مصراتة ================= */
    generate({ profile: 'misrata', store3: 1, out: path.join(tmp, 'gm') });
    const mis = JSON.parse(fs.readFileSync(path.join(tmp, 'gm', 'store3.json'), 'utf8'));
    mis.branch = { id: 'misrata', name: 'دار الحكمة — مصراتة', city: 'مصراتة', no: 1 };
    mis.meta.shopName = 'مكتبة دار الحكمة — مصراتة';
    mis.invoices = mis.invoices.slice(0, 1200);
    const ctx = enrich(mis);

    await shop('misrata', mis, async pg => {
      const ev = (f, a) => pg.evaluate(f, a);
      const set = (w, m) => ev(({ w, m }) => { App.S.meta.receiptWidth = w; App.S.meta.printMode = m; }, { w, m });

      console.log('\n== مصراتة: الإيصال صورةً (الافتراضي) — 80 مم ==');
      await set('80', 'image');
      for (const [id, nm] of [['pr-one', 'صنف واحد'], ['pr-eight', 'ثمانية أصناف وأسماء طويلة'], ['pr-long', '45 صنفاً'], ['pr-credit', 'آجل لزبون'], ['pr-whole', 'جملة بخصم وبطاقة'], ['pr-ret', 'إرجاع']])
        await print(pg, 'م-إيصال80-صورة-' + nm, () => ev(i => Sales.printInvoice(i), id), { w: 80, pages: 1, portrait: true, bottom: true, dpi: 150 });

      console.log('\n== مصراتة: الإيصال صورةً — 58 مم ==');
      await set('58', 'image');
      for (const [id, nm] of [['pr-one', 'صنف واحد'], ['pr-eight', 'ثمانية أصناف'], ['pr-long', '45 صنفاً'], ['pr-credit', 'آجل لزبون']])
        await print(pg, 'م-إيصال58-صورة-' + nm, () => ev(i => Sales.printInvoice(i), id), { w: 58, pages: 1, portrait: true, bottom: true, dpi: 150 });

      console.log('\n== مصراتة: الإيصال نصاً — على لفة 80 ولفة 58، وعلى A4 ==');
      await set('80', 'text');
      for (const [id, nm] of [['pr-one', 'صنف واحد'], ['pr-eight', 'ثمانية أصناف'], ['pr-credit', 'آجل لزبون'], ['pr-ret', 'إرجاع']])
        await print(pg, 'م-إيصال80-نص-' + nm, () => ev(i => Sales.printInvoice(i), id), { paper: [80, 297], w: 80, pages: 1, dpi: 150, fit: 72 });
      await print(pg, 'م-إيصال80-نص-45 صنفاً', () => ev(() => Sales.printInvoice('pr-long')), { paper: [80, 297], w: 80, maxPages: 4, dpi: 150, fit: 72 });
      await set('58', 'text');
      for (const [id, nm] of [['pr-one', 'صنف واحد'], ['pr-eight', 'ثمانية أصناف'], ['pr-credit', 'آجل لزبون']])
        await print(pg, 'م-إيصال58-نص-' + nm, () => ev(i => Sales.printInvoice(i), id), { paper: [58, 297], w: 58, pages: 1, dpi: 150, fit: 50 });
      await set('a4', 'image');
      for (const [id, nm] of [['pr-one', 'صنف واحد'], ['pr-eight', 'ثمانية أصناف'], ['pr-credit', 'آجل لزبون'], ['pr-ret', 'إرجاع']])
        await print(pg, 'م-فاتورة-A4-' + nm, () => ev(i => Sales.printInvoice(i), id), { w: 210, pages: 1 });
      await print(pg, 'م-فاتورة-A4-45 صنفاً', () => ev(() => Sales.printInvoice('pr-long')), { w: 210, maxPages: 3 });

      console.log('\n== مصراتة: البيع من الشاشة يطبع وحده، و«طباعة» من سجل الفواتير، والإيصال التجريبي ==');
      await set('80', 'image');
      await ev(() => { App.S.meta.autoPrint = true; location.hash = '#/pos'; App.route(); });
      await sleep(500);
      await print(pg, 'م-بيعة من الشاشة', async () => {
        await ev(() => { const b = App.S.books.filter(x => x.price > 0 && x.qty > 3); Sales.add('book', b[0].id); Sales.add('book', b[1].id); Sales.complete(); });
        await sleep(200);
        await ev(() => Sales.pick('cash'));
      }, { w: 80, pages: 1, portrait: true, bottom: true, dpi: 150 });
      await closeModals(pg);
      await ev(() => { location.hash = '#/invoices'; App.route(); }); await sleep(500);
      await print(pg, 'م-طباعة من سجل الفواتير', () => pg.click('#view tbody button:has-text("طباعة")'), { w: 80, pages: 1, portrait: true, bottom: true, dpi: 150 });
      await print(pg, 'م-إيصال تجريبي من الإعدادات', async () => { await ev(() => Rep.testReceipt()); await sleep(300); await pg.click('#modalHost button:has-text("طباعة تجريبية")'); }, { w: 80, pages: 1, portrait: true, bottom: true, dpi: 150 });
      await closeModals(pg);

      console.log('\n== مصراتة: كشوف الحساب (A4) ==');
      await print(pg, 'م-كشف زبون طويل', async () => { await ev(id => People.statement(id), ctx.big); await sleep(300); await pg.click('#modalHost button:has-text("طباعة الكشف")'); }, { w: 210, maxPages: 6 });
      await closeModals(pg);
      await print(pg, 'م-كشف زبون قصير', () => ev(() => People.printStatement(App.S.customers.filter(c => c.balance > 0)[3].id)), { w: 210, maxPages: 3 });
      await print(pg, 'م-كشف مورد', async () => { await ev(() => People.supStatement('sup1')); await sleep(300); await pg.click('#modalHost button:has-text("طباعة الكشف")'); }, { w: 210, maxPages: 4 });
      await closeModals(pg);
      await print(pg, 'م-كشف كتب على المباع', () => ev(() => Consign.printStatement('own1')), { w: 210, maxPages: 3 });

      console.log('\n== مصراتة: التقارير والجرد (A4) ==');
      await ev(() => { location.hash = '#/profits'; App.route(); Rep.setPv('rep'); }); await sleep(500);
      for (const k of ['today', 'month', 'year']) {
        await ev(k => Rep.quick(k), k); await sleep(200);
        /* الأرباح قد تكون مقفلة برمز: الدالة نفسها التي يناديها الزر */
        const btn = await pg.$('#view button:has-text("طباعة التقرير")');
        await print(pg, 'م-تقرير المبيعات-' + k, () => btn ? btn.click() : ev(() => Rep.printReport()), { w: 210, pages: 1 });
      }
      await ev(d => { location.hash = '#/stocktake'; App.route(); Rep.setStk('date', d); }, ctx.day); await sleep(400);
      for (const k of ['day', 'month', 'year']) {
        await ev(k => Rep.setStk('kind', k), k); await sleep(300);
        await print(pg, 'م-تقرير الجرد-' + k, () => ev(() => Rep.printStocktake()), { w: 210, maxPages: 60, show: 2 });
      }

      console.log('\n== مصراتة: قوائم المخزون (A4) ==');
      await print(pg, 'م-قائمة السحب من الخزين', () => ev(() => Inv.printPickList()), { w: 210, maxPages: 5 });
      await print(pg, 'م-قائمة الشراء', () => ev(() => Inv.printShoppingList()), { w: 210, maxPages: 30, show: 2 });
      await print(pg, 'م-ما في غرفة الخزين', () => ev(() => Stock.printRoom()), { w: 210, maxPages: 15 });
      await ev(() => { location.hash = '#/stale'; App.route(); }); await sleep(600);
      await print(pg, 'م-البضاعة الراكدة', () => ev(() => Stale.print()), { w: 210, maxPages: 80, show: 2 });

      console.log('\n== مصراتة: اللاصقات — صفحة لكل لاصقة ==');
      const withCode = await ev(() => App.S.books.filter(b => b.barcode && b.price > 0).slice(0, 4).map(b => b.id));
      for (const [w, h] of [[30, 25], [40, 30], [50, 25], [58, 40]]) {
        await ev(({ w, h }) => { const L = Labels.cfg(); L.w = w; L.h = h; }, { w, h });
        await ev(() => { location.hash = '#/labels'; App.route(); }); await sleep(400);
        await print(pg, 'م-لاصقات ' + w + '×' + h + ' (3 أصناف، 5 لاصقات)', async () => {
          await ev(ids => { Labels.clearSel(); Labels.toggle(ids[0]); Labels.toggle(ids[1]); Labels.toggle(ids[2]); Labels.setCount(ids[0], 3); Labels.preview(); }, withCode);
          await sleep(400);
          await pg.click('#modalHost button:has-text("طباعة الآن")');
        }, { w, h, pages: 5, dpi: 300, show: 5 });
        await sleep(900); await closeModals(pg);
      }
      await ev(() => { const L = Labels.cfg(); L.w = 40; L.h = 30; });
      await print(pg, 'م-لاصقة واحدة من سطر الكتاب', async () => {
        await ev(id => Labels.one('book', id), withCode[3]); await sleep(300);
        await pg.click('#modalHost .m-foot .btn.primary'); await sleep(400);
        await pg.click('#modalHost button:has-text("طباعة الآن")');
      }, { w: 40, h: 30, pages: 1, dpi: 300 });
      await sleep(900); await closeModals(pg);
    });

    /* ================= طرابلس ================= */
    generate({ profile: 'tripoli', books: 4000, stationery: 300, years: 1, store3: 1, out: path.join(tmp, 'gt') });
    const tri = JSON.parse(fs.readFileSync(path.join(tmp, 'gt', 'store3.json'), 'utf8'));
    tri.branch = { id: 'tripoli', name: 'مكتبة دار الحكمة', city: 'طرابلس', no: 2 };
    tri.meta.shopName = 'مكتبة دار الحكمة — طرابلس';
    tri.invoices = tri.invoices.slice(0, 800);
    const ctxT = enrich(tri);
    /* شعار صغير (مربع أزرق) كما يرفعه المدير من الإعدادات */
    tri.meta.logo = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="18" fill="#1F4E79"/><text x="60" y="76" font-size="56" text-anchor="middle" fill="#fff" font-family="Arial">DH</text></svg>').toString('base64');

    await shop('tripoli', tri, async pg => {
      const ev = (f, a) => pg.evaluate(f, a);
      ok(await ev(() => App.isX4()), 'طرابلس: طبعة طرابلس تعمل');
      console.log('\n== طرابلس: الإيصال والفاتورة ==');
      await ev(() => { App.S.meta.receiptWidth = '80'; App.S.meta.printMode = 'image'; });
      for (const [id, nm] of [['pr-one', 'صنف واحد'], ['pr-eight', 'ثمانية أصناف'], ['pr-long', '45 صنفاً'], ['pr-ret', 'إرجاع']])
        await print(pg, 'ط-إيصال80-صورة-' + nm, () => ev(i => Sales.printInvoice(i), id), { w: 80, pages: 1, portrait: true, bottom: true, dpi: 150 });
      await ev(() => { App.S.meta.receiptWidth = 'a4'; });
      await print(pg, 'ط-فاتورة-A4-ثمانية أصناف', () => ev(() => Sales.printInvoice('pr-eight')), { w: 210, pages: 1 });
      await ev(() => { App.S.meta.receiptWidth = '80'; });

      console.log('\n== طرابلس: تصدير الكتب PDF بالشعار، والراكد بلا مبالغ ==');
      await ev(() => { location.hash = '#/export'; App.route(); }); await sleep(900);
      await print(pg, 'ط-تصدير الكتب-تخصص', async () => {
        await ev(() => { const c = App.S.books.find(b => b.cat).cat; Exp.set('cat', c); });
        await sleep(500);
        await pg.click('#view button:has-text("PDF")');
      }, { w: 210, maxPages: 200, show: 2 });
      await ev(() => { location.hash = '#/stale'; App.route(); }); await sleep(600);
      const st = await print(pg, 'ط-البضاعة الراكدة', () => ev(() => Stale.print()), { w: 210, maxPages: 200, show: 1 });
      ok(st && !/مال مجمّد/.test(await ev(() => document.getElementById('printArea').textContent)), 'طرابلس: قائمة الراكد المطبوعة بلا «مال مجمّد»');
      await print(pg, 'ط-كشف مورد', () => ev(() => People.printSupStatement('sup1')), { w: 210, maxPages: 4 });
      await ev(d => { location.hash = '#/stocktake'; App.route(); Rep.setStk('date', d); Rep.setStk('kind', 'day'); }, ctxT.day); await sleep(400);
      await print(pg, 'ط-تقرير الجرد-اليوم', () => ev(() => Rep.printStocktake()), { w: 210, maxPages: 10, show: 1 });
      console.log('\n== طرابلس: اللاصقات ==');
      const ids = await ev(() => App.S.books.filter(b => b.barcode && b.price > 0).slice(0, 2).map(b => b.id));
      await ev(() => { const L = Labels.cfg(); L.w = 40; L.h = 30; location.hash = '#/labels'; App.route(); }); await sleep(400);
      await print(pg, 'ط-لاصقات 40×30 (صنفان)', async () => {
        await ev(i => { Labels.clearSel(); Labels.toggle(i[0]); Labels.toggle(i[1]); Labels.preview(); }, ids);
        await sleep(400);
        await pg.click('#modalHost button:has-text("طباعة الآن")');
      }, { w: 40, h: 30, pages: 2, dpi: 300 });
      await sleep(900); await closeModals(pg);
    });

    /* ================= تطبيق الهاتف ================= */
    console.log('\n== تطبيق الهاتف: إيصال البيع ==');
    const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
    const srv = http.createServer((q, s) => {
      const u = new URL(q.url, 'http://x');
      if (u.pathname === '/config.js') { s.writeHead(200, { 'content-type': MIME['.js'] }); return s.end('window.MAKTABA_CONFIG = ' + JSON.stringify({ url: '', key: '', branch: 'tripoli', theme: 'blue', name: 'دار الحكمة', city: 'طرابلس' }) + ';'); }
      const f = path.join(SITE, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1)));
      if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
      s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f));
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    servers.push(srv);
    const pctx = await browser.newContext({ ...devices['iPhone 13'] });
    const ph = await pctx.newPage();
    const perr = [];
    ph.on('pageerror', e => perr.push(e.message));
    await ph.addInitScript(() => { window.print = () => { window.__prints = (window.__prints || 0) + 1; }; });
    await ph.goto('http://127.0.0.1:' + srv.address().port + '/');
    await ph.waitForFunction(() => window.Core && Core.printReceipt, null, { timeout: 30000 });
    const order = n => ({ id: 'ph-abc' + n, at: '2026-11-10 12:30:00', byName: 'سالم', inv: 1234, method: n > 5 ? 'credit' : 'cash', custName: n > 5 ? 'مدرسة الأمل الخاصة' : '', disc: n > 5 ? 5 : 0, total: n * 12.5 - (n > 5 ? 5 : 0), items: Array.from({ length: n }, (_, i) => ({ n: i === 1 ? 'الموسوعة الشاملة في أصول الفقه الإسلامي المقارن — المجلد الثالث عشر' : 'كتاب رقم ' + (i + 1) + ' في القانون المدني', q: 1 + (i % 2), p: 12.5 })) });
    for (const [paper, nm] of [[[80, 200], '80 مم'], [[58, 200], '58 مم']]) {
      await print(ph, 'هاتف-إيصال صنف واحد-' + nm, () => ph.evaluate(o => { Core.printReceipt(o); }, order(1)), { paper, w: paper[0], pages: 1, dpi: 150, fit: paper[0] - 6, fitSel: '#printHost', before: () => document.body.classList.add('printing') });
      await print(ph, 'هاتف-إيصال 8 أصناف آجل-' + nm, () => ph.evaluate(o => { Core.printReceipt(o); }, order(8)), { paper, w: paper[0], maxPages: 2, dpi: 150, fit: paper[0] - 6, fitSel: '#printHost', before: () => document.body.classList.add('printing') });
    }
    const phs = made.filter(m => /^هاتف-/.test(m.name));
    const corner = f => parseFloat(execFileSync('convert', [f, '-colorspace', 'Gray', '-crop', '30x30+5+5', '+repage', '-format', '%[fx:mean]', 'info:'], { encoding: 'utf8' }));
    ok(phs.length === 4 && phs.every(m => corner(m.pngs[0]) > 0.99), 'الهاتف: ورقة الإيصال بيضاء (لا خلفية رمادية تُطبع نقاطاً)', phs.map(m => corner(m.pngs[0])));
    /* وإيصالات المنظومة: أسفل الورقة (تحت صورة الإيصال) أبيض */
    const bottom = f => parseFloat(execFileSync('convert', [f, '-colorspace', 'Gray', '-gravity', 'South', '-crop', '0x12+0+2', '+repage', '-format', '%[fx:mean]', 'info:'], { encoding: 'utf8' }));
    const rcs = made.filter(m => /إيصال(80|58)-صورة/.test(m.name));
    ok(rcs.length >= 10 && rcs.every(m => bottom(m.pngs[0]) > 0.99), 'إيصالات المنظومة: الورقة بيضاء حتى آخرها', rcs.map(m => bottom(m.pngs[0]).toFixed(3)));
    ok(perr.length === 0, 'الهاتف: بلا أخطاء', perr.slice(0, 3));
    await pctx.close();

    console.log('\n  أوراق مطبوعة: ' + made.length + ' — صورها في ' + out);
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close().catch(() => { });
    engines.forEach(p => E.stopEngine(p));
    servers.forEach(s => s.close());
    if (!SHOTS) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { } }
    else { for (const f of fs.readdirSync(tmp)) if (f !== 'shots') { try { fs.rmSync(path.join(tmp, f), { recursive: true, force: true }); } catch (e) { } } try { fs.rmdirSync(tmp); } catch (e) { } }
  }
  console.log('\n==================================================');
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})();
