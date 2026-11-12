/* ============================================================
   test-big.js — طرابلس بـ61 ألف كتاب: قائمة الإصلاحات من أول تجربة للمستخدم
   ------------------------------------------------------------
   شاشات 3.x على dev-server ببيانات المولّد (61 ألف كتاب ومخزنان بـ30 ألف سطر):
   1. الجداول: 100 كتاب، ثم 100 كلما نزلت لآخر الجدول — لا تحميل في الخلفية
      (كانت علامة «المزيد» تحت صندوق التمرير فتبقى ظاهرة وتُرسم الـ61 ألف كلها).
   2. حقل البحث الكبير في «عرض وتعديل».
   3. حقل التخصص يُكتب ويُقترح، والاسم بشكل آخر يأخذ كتابة الموجود؛ واقتراح دمج
      التخصصات المتشابهة («زراعة» و«زرعة» و«زراعة_done»).
   4. الفرع المربوط جدول كتب ببحث وتخصص وحالة، بلا «قيمته بيعاً».
   5. «تحديث الآن» لا يجمّد: لقطة المخزون كانت 14 ثانية (بحث عن كل سطر مخزن في
      63 ألف صنف)، وفرع كبير لا يبني أصنافه في اللقطة أصلاً.
     شغّل tools/dev-server.js أولاً، ثم: node tools/test-big.js   (BOOKS=… لعدد آخر)
   ============================================================ */
'use strict';
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), os = require('os');
const { generate } = require('./gen/generate');
const URL = 'http://127.0.0.1:17845/';
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = process.env.QI_DATA || path.join(__dirname, '..', '.devdata');
const BOOKS = parseInt(process.env.BOOKS || '61000', 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, got) => {
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          ' + (typeof got === 'string' ? got : JSON.stringify(got))));
};

(async () => {
  console.log('يولّد ' + BOOKS + ' كتاباً...');
  const g = fs.mkdtempSync(path.join(os.tmpdir(), 'qbig-'));
  generate({ profile: 'tripoli', books: BOOKS, stationery: 2000, years: 1, store3: 1, out: g });
  const store = JSON.parse(fs.readFileSync(path.join(g, 'store3.json'), 'utf8'));
  fs.rmSync(g, { recursive: true, force: true });
  store.invoices = store.invoices.slice(-2000);
  store.branch = { id: 'tripoli', name: 'دار الحكمة — طرابلس', city: 'طرابلس', no: 2 };
  /* تخصصات الاستيراد المكتوبة بأكثر من شكل */
  const cats = ['زراعة', 'زرعة', 'زراعة_done', 'سياسية', 'ساسية', 'القانون'];
  store.books.forEach((b, i) => { b.cat = cats[i % 97 === 0 ? 1 : i % 89 === 0 ? 2 : i % 83 === 0 ? 4 : i % 3 === 0 ? 0 : i % 3 === 1 ? 3 : 5]; });
  fs.writeFileSync(path.join(DATA, 'store.json'), JSON.stringify(store));
  const whLines = (store.warehouses || []).reduce((a, w) => a + (w.stock || []).length, 0);

  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errs = [];
  const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept().catch(() => { }));
  const S = f => pg.evaluate(f);
  try {
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(n => window.App && App.S && App.S.books && App.S.books.length >= n, BOOKS, { timeout: 120000 });
    await S(() => { document.body.setAttribute('data-edition', 'tripoli'); App.rebuildNav(); });
    await sleep(800);
    const rows = sel => pg.$$eval(sel + ' tbody tr:not(.lazy-row)', r => r.length);

    console.log('\n== 1. الجداول: 100 كتاب، ثم 100 كلما نزلت ==');
    await S(() => { location.hash = '#/purchases'; App.route(); Inv.gset('type', 'book'); Inv.gset('mode', 'view'); });
    await pg.waitForSelector('#invBody tbody tr');
    await sleep(2500);
    let n = await rows('#invBody');
    check('«عرض وتعديل»: 100 كتاب، وبعد ثانيتين ونصف بلا تمرير ما زالت 100 (لا تحميل في الخلفية)', n === 100, n);
    let note = await S(() => (document.querySelector('#invBody .lazy-row') || {}).textContent || '');
    check('علامة «المزيد» صف داخل الجدول: «معروض 100 من …»', /معروض 100 من [\d,]+ — انزل لعرض 100 أخرى/.test(note), note);
    await S(() => { const w = document.querySelector('#invBody .table-wrap'); w.scrollTop = w.scrollHeight; });
    await sleep(900);
    n = await rows('#invBody');
    check('النزول لآخر الجدول يضيف 100 بالضبط', n === 200, n);
    await sleep(1500);
    check('ثم يقف حتى تنزل ثانية', await rows('#invBody') === 200, await rows('#invBody'));

    await S(() => { location.hash = '#/export'; App.route(); });
    await pg.waitForSelector('#exList tbody tr');
    await sleep(2500);
    n = await rows('#exList');
    check('«تصدير الكتب»: 100 ولا يحمّل الباقي وحده (كان 7400 في 4 ثوانٍ)', n === 100, n);

    console.log('\n== 2. البحث الكبير ==');
    await S(() => { location.hash = '#/purchases'; App.route(); Inv.gset('mode', 'view'); });
    await pg.waitForSelector('#bq');
    const box = await pg.$eval('#bq', e => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), pad: parseFloat(getComputedStyle(e).paddingInlineStart) }; });
    check('حقل البحث سطر كامل وكبير (' + box.w + '×' + box.h + ')، والعدسة لا تغطي الكلام', box.w > 900 && box.h >= 48 && box.pad >= 40, box);
    const t0 = Date.now();
    await pg.fill('#bq', 'كتاب');
    await pg.waitForFunction(() => document.querySelectorAll('#invBody tbody tr').length > 0);
    check('البحث يعمل على 61 ألف كتاب (' + (Date.now() - t0) + ' ms)', await rows('#invBody') > 0);
    await pg.fill('#bq', ''); await S(() => Inv.setF('q', '')); await sleep(300);

    console.log('\n== 3. التخصص يُكتب ويُقترح، والمتشابه يُدمج ==');
    await S(() => Inv.editBook(App.S.books[5].id));
    await pg.waitForSelector('#modalHost input[list]');
    const fld = await S(() => {
      const ins = [...document.querySelectorAll('#modalHost input[list]')];
      const c = ins.find(i => /cat$/.test(i.id));
      return c ? { tag: c.tagName, n: document.getElementById(c.getAttribute('list')).options.length, v: c.value, ph: c.placeholder } : null;
    });
    check('حقل التخصص نصّ يُكتب فيه، ومعه قائمة اقتراحات من التخصصات', fld && fld.tag === 'INPUT' && fld.n >= 5 && /اكتب/.test(fld.ph), fld);
    await S(() => { const c = [...document.querySelectorAll('#modalHost input[list]')].find(i => /cat$/.test(i.id)); c.value = 'القانون '; c.dispatchEvent(new Event('input')); });
    await pg.click('#modalHost .m-foot .btn.primary'); await sleep(500);
    check('«القانون » بمسافة يُحفظ «القانون» كما في القائمة', await S(() => App.S.books[5].cat) === 'القانون', await S(() => App.S.books[5].cat));
    check('واسم بهمزة أو تاء مختلفة يأخذ الكتابة الموجودة', await S(() => Inv.canonCat('book', 'زراعه')) === 'زراعة');
    const sim = await S(() => Inv.similarCats(Inv.subjectStats()).map(p => p.from + '←' + p.to));
    check('اقتراحات الدمج: «زرعة» و«زراعة_done» ← «زراعة»، و«ساسية» ← «سياسية»',
      sim.includes('زرعة←زراعة') && sim.includes('زراعة_done←زراعة') && sim.includes('ساسية←سياسية') && !sim.some(s => /القانون/.test(s)), sim);
    await S(() => { location.hash = '#/subjects'; App.route(); });
    await pg.waitForSelector('#sjGrid');
    check('صفحة التخصصات: بطاقة «تخصصات متشابهة»', /تخصصات متشابهة/.test(await S(() => document.getElementById('view').textContent)));
    const before = await S(() => App.S.books.filter(x => x.cat === 'زراعة').length);
    const moved = await S(() => App.S.books.filter(x => x.cat === 'زرعة').length);
    const at = sim.indexOf('زرعة←زراعة');
    await pg.evaluate(i => Inv.sjMerge(i), at); await sleep(300);
    await pg.click('#modalHost button:has-text("ادمج")'); await sleep(600);
    check('«ادمج» ينقل كتب «زرعة» إلى «زراعة» (' + moved + ' كتاب)', await S(() => App.S.books.filter(x => x.cat === 'زرعة').length) === 0 &&
      await S(() => App.S.books.filter(x => x.cat === 'زراعة').length) === before + moved);
    const sim2 = await S(() => Inv.similarCats(Inv.subjectStats()).map(p => p.from + '←' + p.to));
    await pg.evaluate(i => Inv.sjNotSame(i), sim2.indexOf('ساسية←سياسية')); await sleep(300);
    check('«ليست نفسها» لا يُقترح ثانية', !(await S(() => Inv.similarCats(Inv.subjectStats()).map(p => p.from + '←' + p.to))).includes('ساسية←سياسية'));

    console.log('\n== 4. الفرع المربوط: جدول كتب بلا مبالغ ==');
    await S(() => {
      const items = App.S.books.map((x, i) => ({ k: x.code, t: 'book', n: x.title, a: x.author, b: x.barcode, c: x.cat, q: i % 7 === 0 ? 0 : (i % 5) + 1, p: x.price, l: x.lib, s: x.shelf }));
      App.S.remotes = [{ id: 'misrata', name: 'دار الحكمة — مصراتة', city: 'مصراتة', at: App.nowStamp(), items, msgs: [] }];
      location.hash = '#/stock'; App.route();
    });
    await sleep(500);
    let t1 = Date.now();
    await S(() => Stock.open('branch', 'misrata'));
    await pg.waitForSelector('#rbBody tbody tr');
    const openMs = Date.now() - t1;
    const vtx = await S(() => document.getElementById('view').textContent);
    check('يفتح جدول كتب الفرع (' + openMs + ' ms)، 100 كتاب أولاً، بحث كبير وتخصص وحالة', await rows('#rbBody') === 100 && !!(await pg.$('#rbq')) &&
      /كل التخصصات/.test(vtx) && /المتوفر عندهم/.test(vtx), { openMs, rows: await rows('#rbBody') });
    check('بلا «قيمته بيعاً» ولا «قيمة المخزون»', !/قيمته بيعاً|قيمة المخزون/.test(vtx));
    const word = await S(() => App.S.books[100].title.split(' ').filter(w => w.length > 3)[0] || App.S.books[100].title);
    await pg.fill('#rbq', word); await sleep(400);
    const cnt = await S(() => document.getElementById('rbCount').textContent);
    check('البحث «' + word + '» يرسم الجدول وحده ويقول كم من كم (' + cnt + ')', /^[1-9][\d,]* من [\d,]+$/.test(cnt) && await rows('#rbBody') > 0 && !!(await pg.$('#rbq')), cnt);
    await S(() => Stock.rSet('st', 'out')); await sleep(300);
    check('«نفد عندهم» يعرض النافد فقط', await S(() => [...document.querySelectorAll('#rbBody tbody tr:not(.lazy-row)')].every(r => /نفد/.test(r.textContent))));

    console.log('\n== 5. «تحديث الآن» لا يجمّد ==');
    const snap = await S(() => {
      const a = performance.now(); const full = Stock.snapshot(); const t = performance.now() - a;
      const c = performance.now(); const lite = Stock.snapshot(true); const tl = performance.now() - c;
      return { t: Math.round(t), n: full.items.length, tl: Math.round(tl), ln: lite.items.length, wh: (lite.whs || []).every(w => !w.items.length), cust: Array.isArray(lite.cust) && lite.cust.length <= 400 && lite.cust.length === Math.min(400, App.S.customers.length), nc: (lite.cust || []).length, staff: 'staff' in lite };
    });
    check('لقطة المخزون الكاملة (' + whLines + ' سطر مخازن): ' + snap.t + ' ms (كانت 14 ثانية)', snap.t < 2000 && snap.n >= BOOKS, snap);
    /* الزبائن يُرفعون للفرع الكبير أيضاً (الآجل والديون في الهاتف 3.0)، بحدّ 400 لتبقى اللقطة صغيرة */
    check('ولقطة الفرع الكبير بلا أصناف ولا أصناف مخازن، وزبائنها بحدّ 400 (' + snap.nc + ' زبون، ' + snap.tl + ' ms)', snap.ln === 0 && snap.wh && snap.cust && snap.tl < 300, snap);
    const ids = await S(() => {
      const bk = App.S.books, last = bk[bk.length - 1];
      const a = App.findItem('book', last.id) === last;
      const nb = { id: 'zz-new', title: 'جديد' }; bk.unshift(nb);
      const c = App.findItem('book', 'zz-new') === nb && App.findItem('book', last.id) === last;
      bk.splice(0, 1);
      const d = App.findItem('book', 'zz-new') === null;
      const rep = Object.assign({}, bk[10]); bk[10] = rep;
      const e = App.findItem('book', rep.id) === rep;
      return [a, c, d, e];
    });
    check('البحث عن صنف برقمه بالفهرس يبقى صحيحاً بعد إضافة وحذف واستبدال', ids.every(Boolean), ids);

    check('بلا أخطاء في الصفحة', errs.length === 0, errs.slice(0, 5));
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
  } finally {
    await b.close();
  }
  console.log('\n==================================================');
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})();
