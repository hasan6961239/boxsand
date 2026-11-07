/* اختبار المال: كل خطأ حسابي وُجد في الاختبار المكثّف له حالة هنا.
   الأخطاء هنا لا تُسقط البرنامج — تُفسد الأرقام بصمت: مردود أكثر مما
   دُفع، مخزون يعود من العدم، دين يضيع، صندوق لا يطابق الدرج.
   شغّل tools/dev-server.js أولاً، ثم: node tools/test-money.js */
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const URL = 'http://127.0.0.1:17845/';
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = process.env.QI_DATA || path.join(__dirname, '..', '.devdata');
/* QI_X3: البرنامج الحقيقي بشاشات 3.x فوق القاعدة (tools/test-x3.js suites) */
const X3 = !!process.env.QI_X3;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const seed = () => ({
  meta: { setupDone: true, shopName: 'اختبار', currency: 'د.ل', libraries: ['A'], shelves: 6, uiSize: 'md', theme: 'green' },
  branch: { id: 'misrata', name: 'اختبار', city: 'مصراتة', no: 1 },
  books: [
    { id: 'b1', code: 'K1', title: 'كتاب أ', lib: 'A', shelf: '1', barcode: '1001', cost: 30, price: 50, priceW: 45, qty: 10, min: 1 },
    { id: 'b2', code: 'K2', title: 'كتاب ب', lib: 'A', shelf: '1', barcode: '1002', cost: 10, price: 20, priceW: 18, qty: 10, min: 1 }
  ],
  stationery: [], customers: [{ id: 'c1', name: 'زبون', phone: '091', balance: 0 }],
  suppliers: [], invoices: [], payments: [], purchases: [], counters: { invoice: 0, book: 2, stat: 0 }
});

let pass = 0, fail = 0;
const check = (name, ok, got) => {
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          ' + got));
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errs = [];
  async function fresh(mod) {
    const d = seed(); if (mod) mod(d);
    fs.writeFileSync(path.join(DATA, 'store.json'), JSON.stringify(d));
    const pg = await b.newPage({ viewport: { width: 1500, height: 950 } });
    /* على الأساس الجديد حفظ نافذة أُغلقت فجأة يُطبَّق ولو وصل بعد ملف الحالة التالية
       (على جهاز أبطأ). بين الحالات: الحفظ يكتمل قبل الإغلاق. الإغلاق الفوري بعد البيع
       يُختبر وحده في [ثبات] (runBeforeUnload) */
    if (X3) {
      const close = pg.close.bind(pg);
      pg.close = async o => {
        if (!o) await pg.evaluate(() => App.flushSave().catch(() => { })).catch(() => { });
        return close(o);
      };
    }
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('dialog', d => d.accept().catch(() => {}));
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S && App.S.books && window.Sales && window.Inv, null, { timeout: 30000 });
    await sleep(600);
    await pg.evaluate(() => { window.print = () => {}; });
    return pg;
  }
  const S = (pg, f) => pg.evaluate(f);
  async function sell(pg, lines, disc, how, paidTxt) {
    await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(400);
    for (const [id, q] of lines) await pg.evaluate(([id, q]) => { Sales.add('book', id); Sales.setQty(Sales.__cartLen() - 1, q); }, [id, q]);
    if (disc) await pg.evaluate(d => Sales.setDiscount(d), disc);
    await pg.evaluate(() => Sales.complete()); await sleep(300);
    if (how === 'credit') {
      await pg.evaluate(() => Sales.pick('credit')); await sleep(200);
      await pg.selectOption('#payCust', 'c1');
      if (paidTxt !== undefined) { await pg.fill('#payNow', ''); await pg.type('#payNow', paidTxt); }
      await pg.evaluate(() => Sales.confirmCredit());
    } else await pg.evaluate(h => Sales.pick(h), how);
    await sleep(400);
    return pg.evaluate(() => App.S.invoices[0]);
  }
  async function doReturn(pg, invId, qtys, typed) {
    await pg.evaluate(id => Sales.startReturn(id), invId); await sleep(300);
    const ins = await pg.$$('#modalHost .ret-q');
    if (!ins.length) return false;                     // النافذة لم تُفتح: لا شيء متاح للإرجاع
    for (let i = 0; i < qtys.length; i++) { await ins[i].fill(''); if (qtys[i] !== null) await ins[i].type(String(typed ? typed[i] : qtys[i])); }
    await pg.click('#modalHost button:has-text("تسجيل الإرجاع")'); await sleep(400);
    await pg.evaluate(() => { const h = document.getElementById('modalHost'); if (h) h.innerHTML = ''; });
  }

  const clickModal = async (pg, txt) => { await pg.click('#modalHost button:has-text("' + txt + '")'); await sleep(350); };
  async function sellCash(pg, id, q, wholesale) {
    await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(300);
    if (wholesale) await pg.evaluate(() => Sales.setMode('wholesale'));
    await pg.evaluate(([id, q]) => { Sales.add('book', id); Sales.setQty(Sales.__cartLen() - 1, q); Sales.complete(); }, [id, q]);
    await sleep(250); await pg.evaluate(() => Sales.pick('cash')); await sleep(300);
    return pg.evaluate(() => App.S.invoices[0]);
  }

  async function importCsv(pg, file) {
    await pg.evaluate(() => Inv.importItems('book')); await sleep(300);
    const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#modalHost button:has-text("اختيار الملف")')]);
    await fc.setFiles(file); await sleep(900);
    return pg.evaluate(() => App.S.books.map(x => ({ t: x.title, a: x.author, p: x.price, q: x.qty, bc: x.barcode })));
  }

  console.log('\n[١] إرجاع فاتورة فيها خصم');
  let pg = await fresh();
  let v = await sell(pg, [['b1', 2]], '20', 'cash');
  check('بيع 2×50 بخصم 20 = 80', v.total === 80, v.total);
  await doReturn(pg, v.id, [2]);
  let r = await S(pg, () => App.S.invoices[0]);
  check('إرجاع الكل يردّ 80 (ما دفعه الزبون) لا 100', Math.abs(r.total) === 80, Math.abs(r.total));
  let net = await S(pg, () => App.S.invoices.reduce((s, x) => s + x.total, 0));
  check('صافي المبيعات بعد إرجاع كامل = 0', Math.abs(net) < 0.001, net);
  await pg.close();

  console.log('\n[٢] إرجاع الفاتورة نفسها مرتين');
  pg = await fresh();
  v = await sell(pg, [['b2', 2]], 0, 'cash');
  await doReturn(pg, v.id, [2]);
  await doReturn(pg, v.id, [2]);
  const q2 = await S(pg, () => App.findItem('book', 'b2').qty);
  const rets = await S(pg, () => App.S.invoices.filter(x => x.kind === 'return').reduce((s, x) => s + x.total, 0));
  check('المخزون لا يتجاوز ما كان (10)', q2 === 10, q2);
  check('المردود لا يتجاوز المبيع (40)', Math.abs(rets) <= 40, Math.abs(rets));
  await pg.close();

  console.log('\n[٣] بيع آجل بمدفوع مكتوب بأرقام عربية');
  pg = await fresh();
  v = await sell(pg, [['b1', 2]], 0, 'credit', '٣٠');
  check('المدفوع «٣٠» يُسجَّل 30', v.paid === 30, v.paid);
  const bal = await S(pg, () => App.S.customers[0].balance);
  check('والدين على الزبون 70', bal === 70, bal);
  await pg.close();

  console.log('\n[٤] إرجاع بكمية مكتوبة بأرقام عربية');
  pg = await fresh();
  v = await sell(pg, [['b2', 3]], 0, 'cash');
  await doReturn(pg, v.id, [1], ['١']);
  const q4 = await S(pg, () => App.findItem('book', 'b2').qty);
  check('إرجاع «١» يعيد قطعة (7 ⇦ 8)', q4 === 8, q4);
  await pg.close();

  console.log('\n[٥] تسديد دين نقداً يظهر في نقد الصندوق');
  pg = await fresh();
  v = await sell(pg, [['b1', 2]], 0, 'credit', '0');
  await pg.evaluate(() => { location.hash = '#/customers'; App.route(); }); await sleep(300);
  await pg.evaluate(() => People.pay('c1')); await sleep(300);
  await pg.fill('#f_amount', '40');
  await pg.click('#modalHost button:has-text("تسجيل التسديد")'); await sleep(400);
  await pg.evaluate(() => { location.hash = '#/stocktake'; App.route(); }); await sleep(500);
  const cashTxt = await pg.evaluate(() => { const e = document.querySelector('.paybox.cash .pb-v'); return e ? e.textContent : '(لا يوجد)'; });
  check('نقد الصندوق = 40 (تسديد اليوم)', /^40(\.00)?$/.test(cashTxt.trim()), cashTxt);
  await pg.close();

  console.log('\n[٦] إرجاع من فاتورة آجلة');
  pg = await fresh();
  v = await sell(pg, [['b1', 2]], 0, 'credit', '0');
  await doReturn(pg, v.id, [1]);
  const bal6 = await S(pg, () => App.S.customers[0].balance);
  check('إرجاع قطعة من دين 100 يترك 50', bal6 === 50, bal6);
  await pg.evaluate(() => { location.hash = '#/stocktake'; App.route(); }); await sleep(500);
  const cash6 = await pg.evaluate(() => { const e = document.querySelector('.paybox.cash .pb-v'); return e ? e.textContent.trim() : ''; });
  check('ولا يخرج نقد من الصندوق (0)', /^0(\.00)?$/.test(cash6), cash6);
  const due6 = await pg.evaluate(() => { const e = document.querySelector('.paybox.credit .pb-v'); return e ? e.textContent.trim() : ''; });
  check('و«آجل لم يُقبض» = 50 لا 100', /^50(\.00)?$/.test(due6), due6);
  await pg.close();

  console.log('\n[٧] كسور عشرية');
  pg = await fresh();
  await pg.evaluate(() => { App.findItem('book', 'b2').price = 0.1; App.findItem('book', 'b2').cost = 0.05; });
  v = await sell(pg, [['b2', 3]], 0, 'cash');
  check('3 × 0.1 = 0.3 بلا 0.30000000000000004', v.total === 0.3, v.total);
  await pg.close();

  console.log('\n[٨] مدفوع مقدّم على البيع الآجل يدخل الصندوق');
  pg = await fresh();
  v = await sell(pg, [['b1', 2]], 0, 'credit', '30');
  console.log('    الفاتورة:', JSON.stringify({ m: v.method, t: v.total, p: v.paid, d: v.due }));
  await pg.evaluate(() => { location.hash = '#/stocktake'; App.route(); }); await sleep(500);
  console.log('    الصندوق:', await pg.evaluate(() => document.querySelector('.paybox.cash').textContent));
  const c8 = await pg.evaluate(() => document.querySelector('.paybox.cash .pb-v').textContent.trim());
  check('نقد الصندوق = 30', /^30(\.00)?$/.test(c8), c8);
  await pg.close();

  console.log('\n[٩] إرجاع من آجل مدفوع جزئياً بعد تسديد الدين كله');
  pg = await fresh();
  v = await sell(pg, [['b1', 2]], 0, 'credit', '0');            // دين 100
  await pg.evaluate(() => { const c = App.S.customers[0]; c.balance = 0; App.S.payments.unshift({ id: 'p', customerId: 'c1', amount: 100, date: new Date().toISOString().slice(0,10), at: '' }); });
  await doReturn(pg, v.id, [1]);                                  // يُرجع قطعة بـ50 ولا دين عليه
  const r9 = await S(pg, () => App.S.invoices[0]);
  check('لا دين ليُنقص ⇦ يُردّ نقداً 50', r9.cashBack === 50 && r9.debtCut === 0, JSON.stringify({ c: r9.cashBack, d: r9.debtCut }));
  await pg.evaluate(() => { location.hash = '#/stocktake'; App.route(); }); await sleep(500);
  const c9 = await pg.evaluate(() => document.querySelector('.paybox.cash .pb-v').textContent.trim());
  check('الصندوق: 100 تسديد − 50 مردود = 50', /^50(\.00)?$/.test(c9), c9);
  await pg.close();

  console.log('\n[أ] الجرد والبيع أثناءه');
  pg = await fresh();
  await pg.evaluate(() => { location.hash = '#/stocktake'; App.route(); }); await sleep(400);
  const startFn = await pg.evaluate(() => typeof Count !== 'undefined' ? 'Count' : '');
  if (startFn) {
    await pg.evaluate(() => { Count.start(); }); await sleep(400);
    await pg.evaluate(() => Count.setCount('b1', 5)); await sleep(200);    // عددتُ 5 على الرف
    await sellCash(pg, 'b1', 2);                                            // بِعتُ 2 قبل التصحيح
    await pg.evaluate(() => { location.hash = '#/stocktake'; App.route(); }); await sleep(400);
    await pg.evaluate(() => Count.apply()); await sleep(300);
    const ok = await pg.$('#modalHost button:has-text("صحّح المخزون")');
    if (ok) await clickModal(pg, 'صحّح المخزون');
    const q = await pg.evaluate(() => App.findItem('book', 'b1').qty);
    check('عُدّ 5 ثم بيع 2 ⇦ المخزون 3 لا 5', q === 3, q);
  } else check('وحدة الجرد موجودة', false, 'لا Count');
  await pg.close();

  console.log('\n[ب] حذف فاتورة آجلة سُدِّد جزء من دينها');
  pg = await fresh();
  await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(300);
  await pg.evaluate(() => { Sales.add('book', 'b1'); Sales.setQty(0, 2); Sales.complete(); }); await sleep(250);
  await pg.evaluate(() => Sales.pick('credit')); await sleep(200);
  await pg.selectOption('#payCust', 'c1'); await pg.evaluate(() => Sales.confirmCredit()); await sleep(300);
  // سدّد 40 من 100
  await pg.evaluate(() => People.pay('c1')); await sleep(250); await pg.fill('#f_amount', '40'); await clickModal(pg, 'تسجيل التسديد');
  let inv = await pg.evaluate(() => App.S.invoices[0]);
  await pg.evaluate(id => Sales.deleteInvoice(id), inv.id); await sleep(300); await clickModal(pg, 'تأكيد الحذف');
  let st = await pg.evaluate(() => ({ bal: App.S.customers[0].balance, q: App.findItem('book', 'b1').qty, pays: App.S.payments.length }));
  check('بعد حذف الفاتورة المخزون يعود كما كان (10)', st.q === 10, st.q);
  check('ورصيد الزبون لا يصير سالباً ولا يبقى ديناً وهمياً', st.bal === 0, st.bal);
  console.log('    (التسديد 40 باقٍ في السجل: ' + st.pays + ' — الزبون دفع 40 عن فاتورة حُذفت)');
  await pg.close();

  console.log('\n[ج] تعديل فاتورة بخصم أكبر من المجموع');
  pg = await fresh();
  inv = await sellCash(pg, 'b2', 1);                                        // 20
  await pg.evaluate(id => Sales.editInvoice(id), inv.id); await sleep(400);
  const discInput = await pg.$('#modalHost input[onchange*="discount"], #modalHost .field input.num');
  const hasEdit = await pg.evaluate(() => typeof Sales.saveEdit === 'function' || !!document.querySelector('#modalHost'));
  if (discInput) {
    await pg.evaluate(() => { const i = Array.from(document.querySelectorAll('#modalHost input')).find(x => /discount|Disc/.test(x.getAttribute('onchange') || '')); if (i) { i.value = '500'; i.dispatchEvent(new Event('change', { bubbles: true })); } });
    await sleep(200);
    const saveBtn = await pg.$('#modalHost button:has-text("حفظ")');
    if (saveBtn) { await saveBtn.click(); await sleep(400); }
    inv = await pg.evaluate(() => App.S.invoices[0]);
    check('الصافي 0 والربح ليس سالباً بأكثر من التكلفة', inv.total === 0 && inv.profit >= -10, JSON.stringify({ t: inv.total, p: inv.profit, d: inv.discount }));
  } else console.log('    (لم أجد خانة الخصم في نافذة التعديل — hasEdit=' + hasEdit + ')');
  await pg.close();

  console.log('\n[د] البيع بالجملة');
  pg = await fresh();
  inv = await sellCash(pg, 'b1', 2, true);
  check('الجملة تستعمل سعر الجملة 45', inv.total === 90, inv.total);
  check('وربحها (45−30)×2 = 30', inv.profit === 30, inv.profit);
  await pg.close();

  console.log('\n[هـ] اسم خبيث لا يُنفَّذ في أي صفحة');
  pg = await fresh(d => {
    d.books[0].title = '<img src=x onerror="window.__xss=1">كتاب';
    d.books[0].author = '"><script>window.__xss=2</script>';
    d.customers[0].name = '<b onmouseover=alert(1)>زبون</b><img src=x onerror="window.__xss=3">';
    d.books[0].cat = '<svg onload="window.__xss=4">';
  });
  await sellCash(pg, 'b1', 1);
  for (const k of ['dash', 'pos', 'invoices', 'stocktake', 'stock', 'purchases', 'alerts', 'stale', 'labels', 'customers', 'consign', 'suppliers', 'profits', 'settings']) {
    await pg.evaluate(k => { location.hash = '#/' + k; App.route(); }, k); await sleep(300);
  }
  await pg.evaluate(() => { location.hash = '#/purchases'; App.route(); }); await sleep(200);
  await pg.evaluate(() => { Inv.gset('mode', 'view'); Inv.gset('type', 'book'); }); await sleep(400);
  await pg.evaluate(() => Sales.showInvoice(App.S.invoices[0].id)); await sleep(400);
  const xss = await pg.evaluate(() => window.__xss || 0);
  check('لم يُنفَّذ أي كود من الأسماء', xss === 0, 'نُفّذ #' + xss);
  await pg.close();

  console.log('\n[و] استلام بضاعة');
  pg = await fresh();
  await pg.evaluate(() => { location.hash = '#/purchases'; App.route(); }); await sleep(300);
  await pg.evaluate(() => Inv.gset('mode', 'qty')); await sleep(400);
  const hasPur = await pg.evaluate(() => typeof Inv.purAdd === 'function');
  if (hasPur) {
    await pg.evaluate(() => { Inv.purAdd('book', 'b2'); }); await sleep(300);
    const cells = await pg.$$('input[onchange*="purSet"]');
    if (cells.length >= 2) {
      const typeIn = async (i, txt) => {
        const loc = pg.locator('input[onchange*="purSet"]').nth(i);
        await loc.fill(''); await loc.type(txt); await loc.press('Tab'); await sleep(250);
      };
      await typeIn(0, '١٢'); await typeIn(1, '٨٫٥');
      await sleep(200);
      await pg.evaluate(() => Inv.purSave()); await sleep(400);
      const r = await pg.evaluate(() => ({ q: App.findItem('book', 'b2').qty, c: App.findItem('book', 'b2').cost, p: App.S.purchases[0] && App.S.purchases[0].total }));
      check('استلام «١٢» يرفع المخزون إلى 22', r.q === 22, r.q);
      check('وتكلفة «٨٫٥» تُسجَّل 8.5', r.c === 8.5, r.c);
      check('وإجمالي الاستلام 102', r.p === 102, r.p);
    } else console.log('    (لم أجد خانات الاستلام: ' + cells.length + ')');
  }
  await pg.close();

  console.log('\n[ز] حذف زبون عليه دين');
  pg = await fresh(d => { d.customers[0].balance = 75; });
  await pg.evaluate(() => { location.hash = '#/customers'; App.route(); }); await sleep(300);
  await pg.evaluate(() => People.delCustomer('c1')); await sleep(300);
  const modalTxt = await pg.evaluate(() => (document.getElementById('modalHost') || {}).textContent || '');
  const still = await pg.evaluate(() => App.S.customers.length);
  check('يُحذّر أو يمنع حذف زبون عليه 75', still === 1 || /دين|75/.test(modalTxt), 'حُذف بلا تحذير');
  await pg.close();

  for (const [label, f] of [['CSV UTF-8', 'books-utf8.csv'], ['CSV عادي (ANSI عربي)', 'books-ansi-1256.csv'], ['CSV بفاصلة منقوطة', 'books-semicolon.csv']]) {
    console.log('\n[استيراد] ' + label);
    const pg = await fresh(d => { d.books = []; });
    const books = await importCsv(pg, path.join(__dirname, 'fixtures', f));
    const a = books.find(x => /خلدون/.test(x.t)), c = books.find(x => /بفاصلة/.test(x.t));
    check('استُورد كتابان', books.length === 2, books.length + ' ' + JSON.stringify(books.map(x => x.t)));
    check('والاسم العربي سليم', !!a && a.t === 'مقدمة ابن خلدون' && a.a === 'ابن خلدون', JSON.stringify(a && a.t));
    check('والسعر والكمية صحيحان', !!a && a.p === 35 && a.q === 4, JSON.stringify(a));
    check('والاسم الذي فيه فاصلة لا ينكسر', !!c && c.t === 'كتاب, بفاصلة' && c.p === 15.5, JSON.stringify(c));
    await pg.close();
  }

  console.log('\n[ثبات] ما يُسجَّل يبقى بعد إعادة التحميل');
  {
    const pg = await fresh(d => { d.books = [{ id: 'b1', code: 'K1', title: 'كتاب', lib: 'A', shelf: '1', barcode: '1', cost: 30, price: 50, qty: 10, min: 1 }]; });
    await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(300);
    await pg.evaluate(() => { Sales.add('book', 'b1'); Sales.setQty(0, 3); Sales.complete(); }); await sleep(250);
    await pg.evaluate(() => Sales.pick('credit')); await sleep(200);
    await pg.selectOption('#payCust', 'c1'); await pg.evaluate(() => Sales.confirmCredit());
    await sleep(80);                                      // يغلق النافذة فوراً بعد البيع
    await pg.close({ runBeforeUnload: true }); await sleep(700);
    const disk = JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'));
    const it = disk.books.find(x => x.id === 'b1');
    check('البيع حُفظ على القرص رغم الإغلاق الفوري', disk.invoices.length === 1 && it.qty === 7, JSON.stringify({ n: disk.invoices.length, q: it.qty }));
    check('ودين الزبون 150 محفوظ', disk.customers[0].balance === 150, disk.customers[0].balance);
    const pg2 = await b.newPage();
    await pg2.goto('http://127.0.0.1:17845/'); await pg2.waitForFunction(() => window.App && App.S && App.S.books); await sleep(600);
    const re = await pg2.evaluate(() => ({ n: App.S.invoices.length, q: App.findItem('book', 'b1').qty }));
    check('وبعد إعادة الفتح كل شيء كما هو', re.n === 1 && re.q === 7, JSON.stringify(re));
    await pg2.close();
  }


  /* ------ تعديل عملية إرجاع ------ */
  console.log('\n[ح] عملية الإرجاع لا تُعدَّل');
  {
    const pg = await fresh();
    await sell(pg, [['b1', 2]], 0, 'cash');
    const sale = await pg.evaluate(() => App.S.invoices[0].id);
    await doReturn(pg, sale, [2]);
    const ret = await pg.evaluate(() => App.S.invoices[0].id);
    await pg.evaluate(id => Sales.editInvoice(id), ret); await sleep(300);
    const opened = await pg.evaluate(() => !!document.querySelector('#modalHost tbody input'));
    check('نافذة التعديل لا تُفتح على الإرجاع', !opened, 'فُتحت');
    await pg.evaluate(id => Sales.editInvoice(id), sale); await sleep(300);
    const opened2 = await pg.evaluate(() => !!document.querySelector('#modalHost tbody input'));
    check('ولا على بيعٍ عليه إرجاع', !opened2, 'فُتحت');
    const st = await pg.evaluate(() => ({ q: App.findItem('book', 'b1').qty, t: App.S.invoices.map(v => v.total) }));
    check('والمخزون والفواتير كما هي', st.q === 10 && st.t[0] === -100 && st.t[1] === 100, JSON.stringify(st));
    await pg.close();
  }

  /* ------ اختصارات الدفع لا تعمل داخل خانة المبلغ ------ */
  console.log('\n[ط] كتابة «15» في المدفوع لا تُتمّ البيع نقداً');
  {
    const pg = await fresh();
    await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(300);
    await pg.evaluate(() => { Sales.add('book', 'b1'); Sales.setQty(0, 2); Sales.complete(); }); await sleep(300);
    await pg.keyboard.press('3'); await sleep(300);
    await pg.selectOption('#payCust', 'c1');
    await pg.click('#payNow'); await sleep(50);
    await pg.keyboard.type('15'); await sleep(300);
    const n = await pg.evaluate(() => App.S.invoices.length);
    check('لم تُسجَّل فاتورة وأنت تكتب', n === 0, n + ' فاتورة');
    await pg.evaluate(() => Sales.confirmCredit()); await sleep(300);
    const v = await pg.evaluate(() => ({ inv: App.S.invoices[0], bal: App.S.customers[0].balance }));
    check('وبعد التأكيد: آجل مدفوع 15 ودين 85', v.inv.method === 'credit' && v.inv.paid === 15 && v.bal === 85,
      JSON.stringify({ m: v.inv.method, p: v.inv.paid, b: v.bal }));
    await pg.close();
  }

  /* ------ ديون الموردين: دين سابق + فواتير آجلة − تسديدات ------ */
  console.log('\n[ي] ديون الموردين');
  {
    const pg = await fresh(d => { d.suppliers = [{ id: 'sp1', name: 'مورد تجربة', city: 'مصراتة', opening: 50 }]; });
    const debt = () => pg.evaluate(() => People.supDebt(People.supplier('sp1')));
    const buy = (lines, opt) => pg.evaluate(([lines, opt]) => {
      location.hash = '#/purchases'; App.route();
      Inv.gset('mode', 'qty'); Inv.purClear();
      if (opt.sup) Inv.pd('supplierId', opt.sup);
      Inv.purPay(opt.pay); Inv.purPast(!!opt.past);
      lines.forEach(([id, q, c], i) => { Inv.purAdd('book', id); Inv.purSet(i, 'qty', q); Inv.purSet(i, 'cost', c); });
      Inv.purSave();
    }, [lines, opt]);
    const bk = id => pg.evaluate(id => { const x = App.findItem('book', id); return { qty: x.qty, cost: x.cost }; }, id);

    await buy([['b1', 3, 25]], { pay: 'credit' }); await sleep(300);
    let n = await pg.evaluate(() => App.S.purchases.length);
    check('الآجل بدون مورد يُرفض: لا فاتورة ولا كمية', n === 0 && (await bk('b1')).qty === 10, n + ' فاتورة');

    await buy([['b1', 3, 25]], { pay: 'credit', sup: 'sp1' }); await sleep(300);
    let p = await pg.evaluate(() => App.S.purchases[0]);
    check('شراء آجل 3×25: الدين 50+75 = 125، والكمية 13، والجملة 25',
      p.pay === 'credit' && p.total === 75 && await debt() === 125 && JSON.stringify(await bk('b1')) === '{"qty":13,"cost":25}',
      JSON.stringify({ p: p.pay, t: p.total, d: await debt(), b: await bk('b1') }));

    await buy([['b1', 1, 25]], { pay: 'cash', sup: 'sp1' }); await sleep(300);
    check('شراء نقداً من نفس المورد لا يزيد الدين', await debt() === 125 && (await bk('b1')).qty === 14, await debt());

    await buy([['b2', 5, 8]], { pay: 'credit', sup: 'sp1', past: true }); await sleep(300);
    p = await pg.evaluate(() => App.S.purchases[0]);
    check('فاتورة سابقة آجلة 5×8: الدين 165، والكمية والجملة ما تغيّروش',
      p.past === true && p.total === 40 && await debt() === 165 && JSON.stringify(await bk('b2')) === '{"qty":10,"cost":10}',
      JSON.stringify({ past: p.past, d: await debt(), b: await bk('b2') }));

    const pay = async (amount, drawer) => {
      await pg.evaluate(() => People.supPay('sp1')); await sleep(300);
      await pg.fill('#modalHost #f_amount', String(amount));
      await pg.selectOption('#modalHost #f_drawer', drawer);
      await pg.click('#modalHost button:has-text("تسجيل التسديد")'); await sleep(300);
      await pg.evaluate(() => document.querySelectorAll('#modalHost .overlay').forEach(o => o.remove()));
    };
    await pay(1000, 'yes');
    check('تسديد أكثر من الدين يُرفض', (await pg.evaluate(() => App.S.supPayments.length)) === 0 && await debt() === 165, await debt());
    await pay(65, 'yes');
    let tk = await pg.evaluate(() => Rep.__takings([], App.today(), App.today()));
    check('تسديد 65 من الدرج: الدين 100، ويُطرح من نقد اليوم', await debt() === 100 && tk.supOut === 65 && tk.cash === -65,
      JSON.stringify({ d: await debt(), tk }));
    await pay(20, 'no');
    tk = await pg.evaluate(() => Rep.__takings([], App.today(), App.today()));
    check('تسديد 20 من خارج الدرج: الدين 80، والنقد ما تغيّرش', await debt() === 80 && tk.cash === -65, JSON.stringify({ d: await debt(), c: tk.cash }));

    await pg.evaluate(() => People.delSupplier('sp1')); await sleep(300);
    check('مورد علينا له دين ما ينحذفش', (await pg.evaluate(() => App.S.suppliers.length)) === 1 &&
      !(await pg.evaluate(() => document.querySelector('#modalHost .overlay'))), 'انحذف أو طلع تأكيد');

    await pg.evaluate(() => People.supStatement('sp1')); await sleep(300);
    const st = await pg.evaluate(() => {
      const rows = [...document.querySelectorAll('#modalHost .overlay:last-child tbody tr')];
      return { n: rows.length, last: rows.length ? rows[rows.length - 1].lastElementChild.textContent.trim() : '' };
    });
    check('كشف الحساب: دين سابق + فاتورتين آجلة + تسديدين، والرصيد الأخير 80', st.n === 5 && /^80(\.00)?$/.test(st.last), JSON.stringify(st));
    await pg.evaluate(() => document.querySelectorAll('#modalHost .overlay').forEach(o => o.remove()));

    await pg.evaluate(() => App.saveNow()); await sleep(500);
    await pg.reload({ waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S && App.S.books && window.People, null, { timeout: 30000 }); await sleep(600);
    check('بعد إعادة الفتح: الدين 80 والتسديدان محفوظين', await debt() === 80 &&
      (await pg.evaluate(() => App.S.supPayments.length)) === 2, await debt());

    await pg.evaluate(() => { location.hash = '#/customers'; App.route(); }); await sleep(300);
    await pg.click('#view button:has-text("ديون الموردين")'); await sleep(400);
    const row = await pg.evaluate(() => (document.querySelector('#sList') || {}).textContent || '');
    check('خانة «ديون الموردين» في الزبائن والديون تعرض المورد ودينه', row.indexOf('مورد تجربة') >= 0 && row.indexOf('80') >= 0, row.slice(0, 120));
    await pg.click('#view button:has-text("ديون الزبائن")'); await sleep(300);
    check('والرجوع لـ«ديون الزبائن» يعرض الزبائن كما كانوا', !!(await pg.$('#cList')), 'ما رجعتش');
    await pg.close();
  }

  /* ------ تحميل فواتير شراء سابقة من ملف: بلا كمية، والدين الآن أو بعدين ------ */
  console.log('\n[ك] تحميل فواتير سابقة من ملف');
  {
    const pg = await fresh(d => { d.suppliers = [{ id: 'sp1', name: 'الدار الليبية', opening: 0 }]; });
    const csv = '﻿رقم الفاتورة,التاريخ,المورد,الباركود,الصنف,الكمية,سعر الشراء\n' +
      'م-1,2026-09-02 18:01,الدار الليبية,1001,كتاب أ,2,30\n' +
      'م-1,2026-09-02 18:01,الدار الليبية,,كتاب ب,3,10\n' +
      'م-2,2026-08-28 16:11,قرطاسية زليتن,999999,صنف مش موجود,4,2.5\n';
    const f = path.join(DATA, 'past-invoices.csv');
    fs.writeFileSync(f, csv);
    const debt = name => pg.evaluate(n => { const s = App.S.suppliers.find(x => x.name === n); return s ? People.supDebt(s) : null; }, name);
    await pg.evaluate(() => { location.hash = '#/purchases'; App.route(); Inv.gset('mode', 'qty'); }); await sleep(400);
    await pg.click('#view button:has-text("تحميل فواتير سابقة من ملف")'); await sleep(400);
    const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#modalHost button:has-text("اختيار الملف")')]);
    await fc.setFiles(f); await sleep(800);
    const review = await pg.evaluate(() => (document.querySelector('#modalHost .overlay:last-child') || {}).textContent || '');
    check('المراجعة قبل التحميل: فاتورتين، 3 بنود، المجموع 100، وزليتن مورد جديد، وصنف مش موجود',
      /\b2\b/.test(review) && review.indexOf('100') >= 0 && review.indexOf('جديد') >= 0 && review.indexOf('صنف مش موجود') >= 0, review.slice(0, 220));
    await pg.click('#modalHost button:has-text("تحميل الفواتير")'); await sleep(600);   // الافتراضي: الدين بعدين
    let s = await pg.evaluate(() => ({ p: App.S.purchases.map(p => [p.ref, p.pay, p.past, p.total, p.lines.length]),
      q: App.S.books.map(b => b.qty), c: App.S.books.map(b => b.cost), sups: App.S.suppliers.map(x => x.name) }));
    check('تسجلت الفاتورتين «سابقة» ودينهم مؤجّل، والأحدث فوق', JSON.stringify(s.p) === JSON.stringify([['م-1', 'later', true, 90, 2], ['م-2', 'later', true, 10, 1]]), JSON.stringify(s.p));
    check('والكميات وأسعار الشراء ما تغيّروش', JSON.stringify(s.q) === '[10,10]' && JSON.stringify(s.c) === '[30,10]', JSON.stringify(s));
    check('ومورد جديد «قرطاسية زليتن» تسجّل وحده', s.sups.indexOf('قرطاسية زليتن') >= 0, JSON.stringify(s.sups));
    check('والدين مؤجّل: ما انحسبش', await debt('الدار الليبية') === 0 && await debt('قرطاسية زليتن') === 0);
    const line = await pg.evaluate(() => App.S.purchases[0].lines.map(l => [l.name, l.id]));
    check('البند بلا باركود انعرف بالاسم', JSON.stringify(line) === JSON.stringify([['كتاب أ', 'b1'], ['كتاب ب', 'b2']]), JSON.stringify(line));

    const again = await pg.evaluate(t => Inv.__pastPlan(App.parseCsv(t)), csv);
    check('نفس الملف مرة ثانية: ما فيه حتى فاتورة جديدة', again.invoices.length === 0 && again.dupes === 2, JSON.stringify({ n: again.invoices.length, d: again.dupes }));

    await pg.evaluate(() => { location.hash = '#/customers'; App.route(); People.setTab('sup'); }); await sleep(400);
    const row = await pg.evaluate(() => (document.querySelector('#sList') || {}).textContent || '');
    check('ديون الموردين تبيّن «مؤجّلة» وزر «احسب المؤجّلة»', row.indexOf('مؤجّلة') >= 0 && row.indexOf('احسب المؤجّلة') >= 0, row.slice(0, 160));
    await pg.evaluate(() => People.supCountLater('sp1')); await sleep(300);
    await pg.click('#modalHost button:has-text("احسبها في الدين")'); await sleep(500);
    check('«احسب المؤجّلة» تضيفهم للدين: الدار الليبية 90، وزليتن مازال مؤجّل', await debt('الدار الليبية') === 90 && await debt('قرطاسية زليتن') === 0,
      JSON.stringify([await debt('الدار الليبية'), await debt('قرطاسية زليتن')]));

    const csv2 = '﻿رقم الفاتورة,التاريخ,المورد,الباركود,الصنف,الكمية,سعر الشراء\nم-3,2026-10-15 07:56,الدار الليبية,1002,كتاب ب,1,12.5\n';
    await pg.evaluate(t => Inv.__pastApply(Inv.__pastPlan(App.parseCsv(t)), 'credit'), csv2); await sleep(400);
    check('تحميل «آجل — ينضاف للدين توا»: الدين يزيد 12.5', await debt('الدار الليبية') === 102.5, await debt('الدار الليبية'));
    check('والفاتورة في مكانها بالتاريخ (الأحدث فوق)', JSON.stringify(await pg.evaluate(() => App.S.purchases.map(p => p.ref))) === '["م-3","م-1","م-2"]',
      JSON.stringify(await pg.evaluate(() => App.S.purchases.map(p => p.ref))));
    await pg.evaluate(() => App.saveNow()); await sleep(500);
    await pg.reload({ waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S && App.S.books && window.People, null, { timeout: 30000 }); await sleep(600);
    check('بعد إعادة الفتح: الفواتير والدين محفوظين', await debt('الدار الليبية') === 102.5 && (await pg.evaluate(() => App.S.purchases.length)) === 3);
    await pg.close();
  }

  /* ------ X4 (طرابلس): الكتاب بلا سعر يُسعَّر وقت البيع ------ */
  console.log('\n[ل] X4: كتاب سعره صفر وقت البيع');
  {
    const pg = await fresh(d => {
      d.books.push({ id: 'z1', code: 'K91', title: 'كتاب بلا سعر', lib: 'A', shelf: '2', cost: 0, price: 0, qty: 5, min: 0 });
      d.books.push({ id: 'z2', code: 'K92', title: 'كتاب هدية', lib: 'A', shelf: '2', cost: 0, price: 0, qty: 5, min: 0 });
    });
    await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(300);
    await pg.evaluate(() => { Sales.add('book', 'z1'); Sales.complete(); }); await sleep(400);
    const old = await pg.evaluate(() => (document.getElementById('modalHost') || {}).textContent || '');
    check('مصراتة كما كانت: تنبيه «سيُباع مجاناً» بلا خانة سعر', old.indexOf('سيُباع مجاناً') >= 0 && !(await pg.$('#zp0')), old.slice(0, 80));
    await pg.evaluate(() => { document.getElementById('modalHost').innerHTML = ''; Sales.clear && Sales.clear(); });
    await pg.close();

    const p2 = await fresh(d => {
      d.books.push({ id: 'z1', code: 'K91', title: 'كتاب بلا سعر', lib: 'A', shelf: '2', cost: 0, price: 0, qty: 5, min: 0 });
      d.books.push({ id: 'z2', code: 'K92', title: 'كتاب هدية', lib: 'A', shelf: '2', cost: 0, price: 0, qty: 5, min: 0 });
    });
    await p2.evaluate(() => document.body.setAttribute('data-edition', 'tripoli'));
    await p2.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(300);
    await p2.evaluate(() => { Sales.add('book', 'z1'); Sales.setQty(0, 2); Sales.add('book', 'b1'); Sales.complete(); }); await sleep(400);
    check('X4: «إتمام البيع» يفتح خانة سعر للكتاب', !!(await p2.$('#zp0')) && !(await p2.$('#zp1')));
    await clickModal(p2, 'احفظ السعر وكمّل البيع');
    check('بلا سعر مكتوب: ما يكمل', !!(await p2.$('#zp0')) && !(await p2.$('.pay-btn')));
    await p2.fill('#zp0', '١٢٫٥'); await p2.keyboard.press('Enter'); await sleep(500);
    check('السعر (بأرقام عربية) يُحفظ للكتاب، وتظهر نافذة الدفع', !!(await p2.$('.pay-btn')) && (await S(p2, () => App.S.books.find(b => b.id === 'z1').price)) === 12.5,
      await S(p2, () => App.S.books.find(b => b.id === 'z1').price));
    await p2.evaluate(() => Sales.pick('cash')); await sleep(500);
    const inv = await S(p2, () => App.S.invoices[0]);
    check('الفاتورة بالسعر الجديد: 2 × 12.5 + 50 = 75', inv && inv.total === 75 && inv.items.find(i => i.id === 'z1').price === 12.5, JSON.stringify(inv && { t: inv.total, it: inv.items }));
    check('والتسعير في سجل الحركات', await S(p2, () => App.S.log.some(l => l.action === 'تسعير عند البيع' && l.detail.indexOf('كتاب بلا سعر') >= 0)));

    await p2.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(300);
    await p2.evaluate(() => { Sales.add('book', 'z1'); Sales.add('book', 'z2'); Sales.complete(); }); await sleep(400);
    check('كتاب سُعِّر قبل لا يُسأل عنه مرة ثانية', !!(await p2.$('#zp0')) && !(await p2.$('#zp1')));
    await clickModal(p2, 'بيعه مجاناً'); await sleep(200);
    await p2.evaluate(() => Sales.pick('cash')); await sleep(500);
    const inv2 = await S(p2, () => App.S.invoices[0]);
    check('«بيعه مجاناً»: يُباع بصفر ويبقى سعره صفراً', inv2.items.find(i => i.id === 'z2').price === 0 && inv2.total === 12.5 &&
      (await S(p2, () => App.S.books.find(b => b.id === 'z2').price)) === 0, JSON.stringify(inv2.items));
    await p2.close();
  }

  /* ------ X4 (طرابلس): الموظفون والصلاحيات والسجلات ------ */
  console.log('\n[م] X4: الموظفون والدخول والصلاحيات والسجلات');
  {
    const pg = await fresh();
    const navKeys = () => pg.evaluate(() => [...document.querySelectorAll('#nav .nav-item')].map(b => b.dataset.k));
    check('مصراتة: لا صفحات موظفين في الشريط', !(await navKeys()).includes('staff'));
    await pg.evaluate(() => { document.body.setAttribute('data-edition', 'tripoli'); App.rebuildNav(); });
    const nk0 = await navKeys();
    check('طرابلس: «الموظفون» و«السجلات» و«الأجهزة» في الشريط، وقبل التفعيل كل شيء كما كان',
      ['staff', 'logs', 'devices', 'settings', 'profits'].every(k => nk0.includes(k)), nk0.join(','));
    await pg.evaluate(() => { location.hash = '#/staff'; App.route(); }); await sleep(300);
    await pg.evaluate(() => Staff.setup()); await sleep(300);
    await pg.fill('#f_name', 'المدير حسن'); await pg.fill('#f_pw', '9876'); await pg.fill('#f_pw2', '9876');
    await clickModal(pg, 'فعّل'); await sleep(900);
    const code = await pg.evaluate(() => { const el = [...document.querySelectorAll('#modalHost .num')].pop(); return el ? el.textContent.trim() : ''; });
    const st = await S(pg, () => ({ on: App.S.meta.staffOn, n: App.S.staff.length, roles: App.S.roles.length, plain: JSON.stringify(App.S.staff).indexOf('9876') >= 0, hash: (App.S.staff[0].hash || '').length }));
    check('التفعيل: حساب المدير بلا كلمة سر مكتوبة (بصمتها فقط)، و4 أدوار، ورمز استرجاع', st.on && st.n === 1 && st.roles === 4 && !st.plain && st.hash === 64 && /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), JSON.stringify(st) + ' ' + code);
    await clickModal(pg, 'كتبته');

    await pg.evaluate(() => Staff.edit()); await sleep(300);
    await pg.fill('#f_name', 'سالم الكاشير'); await pg.selectOption('#f_role', 'r-cashier'); await pg.fill('#f_pw', '1111');
    await clickModal(pg, 'حفظ'); await sleep(700);
    check('موظف جديد بدور كاشير', await S(pg, () => App.S.staff.some(p => p.name === 'سالم الكاشير' && p.role === 'r-cashier' && p.hash)));

    await pg.evaluate(() => Staff.lock()); await sleep(400);
    check('القفل: شاشة الدخول بأسماء الموظفين', await S(pg, () => document.querySelectorAll('.staff-lock .staff-tile').length) === 2);
    const cashier = await S(pg, () => App.S.staff.find(p => p.role === 'r-cashier').id);
    await pg.evaluate(id => Staff.pick(id), cashier); await sleep(200);
    await pg.fill('#stPw', '0000'); await pg.keyboard.press('Enter'); await sleep(700);
    check('كلمة سر غلط: لا دخول، ويُسجَّل «دخول فاشل»', !!(await pg.$('.staff-lock')) && await S(pg, () => App.S.log.some(l => l.action === 'دخول فاشل')));
    await pg.fill('#stPw', '1111'); await pg.keyboard.press('Enter'); await sleep(800);
    const nk = await navKeys();
    check('الكاشير دخل: يرى البيع، ولا يرى الإعدادات ولا الأرباح ولا الموظفين', !(await pg.$('.staff-lock')) && nk.includes('pos') && !nk.includes('settings') && !nk.includes('profits') && !nk.includes('staff'), nk.join(','));
    check('واسمه في الشريط العلوي', (await S(pg, () => (document.getElementById('whoChip') || {}).textContent || '')).indexOf('سالم الكاشير') >= 0);
    await pg.evaluate(() => { location.hash = '#/settings'; App.route(); }); await sleep(300);
    check('فتح الإعدادات بالرابط يرجعه لصفحة مسموحة', await S(pg, () => location.hash) !== '#/settings', await S(pg, () => location.hash));

    let v = await sell(pg, [['b1', 1]], 0, 'cash');
    check('الفاتورة باسم الكاشير والجهاز', v && v.byName === 'سالم الكاشير' && !!v.dev, JSON.stringify(v && { b: v.byName, d: v.dev }));
    await pg.evaluate(id => Sales.deleteInvoice(id), v.id); await sleep(400);
    check('الحذف ليس من صلاحياته: يُطلب إذن', (await S(pg, () => document.getElementById('modalHost').textContent)).indexOf('يحتاج إذن') >= 0);
    await pg.fill('#f_pw', '1234'); await clickModal(pg, 'أذنت'); await sleep(600);
    check('إذن بكلمة سر غلط: النافذة باقية والفاتورة باقية', (await S(pg, () => document.getElementById('modalHost').textContent)).indexOf('يحتاج إذن') >= 0 && await S(pg, () => App.S.invoices.length) === 1);
    await pg.fill('#f_pw', '9876'); await clickModal(pg, 'أذنت'); await sleep(600);
    const hostTxt = await S(pg, () => document.getElementById('modalHost').textContent);
    check('بإذن المدير يكمل الحذف (نافذة تأكيد الحذف)، ويُسجَّل الإذن', hostTxt.indexOf('يحتاج إذن') < 0 && await S(pg, () => App.S.log.some(l => l.action === 'إذن' && l.detail.indexOf('المدير حسن') >= 0 && l.detail.indexOf('سالم الكاشير') >= 0)), hostTxt.slice(0, 120));
    await pg.evaluate(() => { document.getElementById('modalHost').innerHTML = ''; });
    await pg.evaluate(id => Sales.deleteInvoice(id), v.id); await sleep(400);
    check('والإذن لمرة واحدة: المرة الثانية تسأل من جديد', (await S(pg, () => document.getElementById('modalHost').textContent)).indexOf('يحتاج إذن') >= 0);
    await pg.evaluate(() => { document.getElementById('modalHost').innerHTML = ''; });

    await pg.evaluate(() => Inv.editBook('b1')); await sleep(400);
    await pg.fill('#f_price', '99'); await pg.fill('#f_title', 'كتاب أ — معدّل');
    await clickModal(pg, 'حفظ'); await sleep(500);
    const b1 = await S(pg, () => App.S.books.find(b => b.id === 'b1'));
    check('تعديل السعر ليس من صلاحيات الكاشير: السعر كما هو والعنوان تغيّر', b1.price === 50 && b1.title === 'كتاب أ — معدّل', JSON.stringify({ p: b1.price, t: b1.title }));

    const lg = await S(pg, () => App.S.log.slice(0, 30));
    check('كل حركة في السجل باسم الموظف والجهاز', lg.filter(l => l.action !== 'دخول فاشل').slice(0, 5).every(l => l.byName && l.dev), JSON.stringify(lg.slice(0, 3)));

    await pg.evaluate(() => Staff.lock()); await sleep(300);
    const admin = await S(pg, () => App.S.staff.find(p => p.role === 'r-admin').id);
    await pg.evaluate(id => Staff.pick(id), admin); await sleep(200);
    await pg.fill('#stPw', '9876'); await pg.keyboard.press('Enter'); await sleep(800);
    const nk2 = await navKeys();
    check('المدير يرى كل الصفحات', ['settings', 'profits', 'staff', 'logs', 'devices'].every(k => nk2.includes(k)), nk2.join(','));
    await pg.evaluate(() => { location.hash = '#/logs'; App.route(); }); await sleep(400);
    await pg.evaluate(() => Staff.setLF('who', 'سالم الكاشير')); await sleep(300);
    const who = await S(pg, () => [...document.querySelectorAll('#lgList tbody tr')].map(tr => tr.children[3].textContent.trim()));
    check('السجلات: تصفية بالموظف', who.length >= 3 && who.every(w => w === 'سالم الكاشير'), JSON.stringify(who));
    await pg.evaluate(() => Staff.setLF('who', ''));
    await pg.evaluate(() => { location.hash = '#/devices'; App.route(); }); await sleep(400);
    await pg.fill('#dvName', 'كاشير الدور الأرضي'); await pg.evaluate(() => Staff.saveDevName()); await sleep(300);
    v = await sell(pg, [['b1', 1]], 0, 'cash');
    check('اسم الجهاز يظهر في الفواتير', v.dev === 'كاشير الدور الأرضي' && v.byName === 'المدير حسن', JSON.stringify({ d: v.dev, b: v.byName }));
    await pg.evaluate(() => { location.hash = '#/devices'; App.route(); }); await sleep(400);
    check('صفحة الأجهزة: الجهاز وآخر نشاطه', (await S(pg, () => document.getElementById('view').textContent)).indexOf('كاشير الدور الأرضي') >= 0);

    await pg.evaluate(() => App.saveNow()); await sleep(600);
    await pg.reload({ waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S && App.S.books && window.Staff, null, { timeout: 30000 });
    await pg.evaluate(() => { document.body.setAttribute('data-edition', 'tripoli'); Staff.boot(); }); await sleep(500);
    check('بعد إعادة الفتح: يسأل عن الدخول من جديد', !!(await pg.$('.staff-lock')));
    await pg.evaluate(() => Staff.pick(App.S.staff.find(p => p.role === 'r-admin').id)); await sleep(200);
    await pg.evaluate(() => Staff.forgot(App.S.staff.find(p => p.role === 'r-admin').id)); await sleep(300);
    await pg.fill('#f_code', 'AAAA-BBBB-CCCC'); await pg.fill('#f_pw', '5555'); await pg.fill('#f_pw2', '5555');
    await clickModal(pg, 'حفظ'); await sleep(700);
    check('رمز استرجاع غلط: لا تتغيّر', await S(pg, () => App.S.log.some(l => l.action === 'استرجاع فاشل')));
    await pg.fill('#f_code', code.toLowerCase()); await clickModal(pg, 'حفظ'); await sleep(900);
    await pg.fill('#stPw', '5555'); await pg.keyboard.press('Enter'); await sleep(800);
    check('برمز الاسترجاع: كلمة سر جديدة للمدير ويدخل بها', !(await pg.$('.staff-lock')) && await S(pg, () => App.S.log.some(l => l.action === 'استرجاع كلمة سر')));
    await pg.close();
  }

  /* ------ X4: الاستيراد من المنظومة القديمة (ملفات صغيرة مصنوعة هنا، لا بيانات المكتبة) ------ */
  console.log('\n[ن] X4: الاستيراد من المنظومة القديمة');
  {
    const pg = await fresh();
    await pg.evaluate(() => document.body.setAttribute('data-edition', 'tripoli'));
    const csv = '﻿رقم الصنف,اسم الصنف,الرقم التجاري,الوحدة,المكان,العدد الموجود,العدد الصادر,التكلفة,اجمالي التكلفة,سعر البيع جملة,سعر البيع قطاعي,الاسم الانجليزي,التصنيف\n' +
      '1001,كتاب أ — من الملف,دار الثقافه,قطعة,0,-5,5,0,0,0,0,لا,عام\n' +
      '2001,كتاب س,دار الثقافة,لغة عربية,1,-3,3,0,0,20,25,لا,مؤلف س\n' +
      '2002,كتاب ص,دار الثقافة,لغة عربيه,0,0,0,0,0,0,0,لا,0\n' +
      '2002,كتاب ص مكرر,0,0,0,0,0,0,0,0,30,لا,.\n' +
      '9.78995993E+12,كتاب بباركود طويل,,,0,7,0,0,0,0,15,لا,مؤلف\n' +
      ',,,,,,,,,,,,\n';
    const p = await pg.evaluate(t => { const pl = Inv.__oldPlan(App.parseCsv(t)); window.__pl = pl;
      return { rows: pl.rows, add: pl.add, upd: pl.upd, zero: pl.zero, pub: pl.pub.map(g => g.canon + ':' + g.forms.length), cat: pl.cat.length, dups: pl.dups.map(d => d.code + ':' + d.titles.length), pc: pl.pubCount }; }, csv);
    check('المراجعة: 5 كتب، 4 جديدة و1 موجود، 2 بلا سعر', p.rows === 5 && p.add === 4 && p.upd === 1 && p.zero === 2, JSON.stringify(p));
    check('«دار الثقافه» و«دار الثقافة» دار واحدة (الأكثر وروداً)، و«لغة عربيه» مع «لغة عربية»', JSON.stringify(p.pub) === '["دار الثقافة:2"]' && p.cat === 1 && p.pc === 1, JSON.stringify(p));
    check('الرمز المكرر في قائمة المراجعة', JSON.stringify(p.dups) === '["2002:2"]', JSON.stringify(p.dups));
    const n0 = await S(pg, () => App.S.books.length);
    await pg.evaluate(() => Inv.__oldApply(window.__pl)); await sleep(500);
    const r = await S(pg, () => {
      const by = t => App.S.books.find(b => b.title === t);
      return { n: App.S.books.length, b1: App.S.books.find(b => b.id === 'b1'), s: by('كتاب س'), d: by('كتاب ص مكرر'), l: by('كتاب بباركود طويل'), badge: App.stockBadge(by('كتاب س')), low: App.lowCount() };
    });
    check('4 كتب جديدة بكمية صفر و«لم يُجرد»', r.n === n0 + 4 && r.s.qty === 0 && r.s.uncounted === true && r.badge.indexOf('لم يُجرد') >= 0, JSON.stringify(r.s));
    check('الحقول: دار النشر الموحّدة، التخصص، المؤلف، والسعرين', r.s.publisher === 'دار الثقافة' && r.s.cat === 'لغة عربية' && r.s.author === 'مؤلف س' && r.s.price === 25 && r.s.priceW === 20 && r.s.barcode === '2001', JSON.stringify(r.s));
    check('الموجود يُحدَّث اسمه، وسعره لا يُمسح بصفر، وكميته كما هي', r.b1.title === 'كتاب أ — من الملف' && r.b1.price === 50 && r.b1.qty === 10 && !r.b1.uncounted, JSON.stringify(r.b1));
    check('المكرر بلا باركود ومعه ملاحظة', r.d.barcode === '' && /مكرر/.test(r.d.note || ''), JSON.stringify(r.d));
    check('رقم Excel العلمي يرجع باركود كاملاً', r.l.barcode === '9789959930000', r.l.barcode);
    check('«لم يُجرد» لا يملأ التنبيهات', r.low === 0, r.low);

    /* ملف xlsx حقيقي: zip بملف مضغوط (deflate) وآخر مخزّن، ونصوص مشتركة، ورموز XML */
    const zlib = require('zlib');
    const shared = '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="x"><si><t>رقم الصنف</t></si><si><t>اسم الصنف</t></si><si><t>سعر البيع قطاعي</t></si>' +
      '<si><r><t>كتاب </t></r><r><t>&amp; قلم</t></r></si><si><t>كتاب &lt;ب&gt;</t></si></sst>';
    const sheet = '<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2"><v>3001</v></c><c r="B2" t="s"><v>3</v></c><c r="D2"><v>12.5</v></c></row>' +
      '<row r="3"><c r="A3"><v>9.789959930996E+12</v></c><c r="B3" t="s"><v>4</v></c><c r="C3" t="inlineStr"><is><t>نص</t></is></c><c r="D3"><v>7</v></c></row>' +
      '</sheetData></worksheet>';
    const zip = (files) => {
      const loc = [], cen = []; let off = 0;
      for (const [name, data, deflate] of files) {
        const nb = Buffer.from(name, 'utf8'), raw = Buffer.from(data, 'utf8'), body = deflate ? zlib.deflateRawSync(raw) : raw;
        const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(deflate ? 8 : 0, 8);
        h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nb.length, 26);
        const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(deflate ? 8 : 0, 10);
        c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
        loc.push(h, nb, body); cen.push(c, nb); off += 30 + nb.length + body.length;
      }
      const cd = Buffer.concat(cen), e = Buffer.alloc(22);
      e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
      return Buffer.concat(loc.concat([cd, e])).toString('base64');
    };
    const b64 = zip([['[Content_Types].xml', '<Types/>', false], ['xl/sharedStrings.xml', shared, true], ['xl/worksheets/sheet1.xml', sheet, false]]);
    const rows = await pg.evaluate(async b => { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return App.readXlsx(u.buffer); }, b64);
    check('قراءة xlsx: العناوين، النصوص المشتركة والمضغوطة، الخانة الفارغة، والرموز', JSON.stringify(rows) ===
      JSON.stringify([['رقم الصنف', 'اسم الصنف', '', 'سعر البيع قطاعي'], ['3001', 'كتاب & قلم', '', '12.5'], ['9.789959930996E+12', 'كتاب <ب>', 'نص', '7']]), JSON.stringify(rows));
    const p2 = await pg.evaluate(rs => { const pl = Inv.__oldPlan(rs); return { n: pl.rows, bc: pl.ops.map(o => o.f.barcode), pr: pl.ops.map(o => o.f.price) }; }, rows);
    check('ومنها خطة الاستيراد', p2.n === 2 && JSON.stringify(p2.bc) === '["3001","9789959930996"]' && JSON.stringify(p2.pr) === '[12.5,7]', JSON.stringify(p2));
    await pg.close();
  }

  /* ------ X4: الجرد الأول رفاً رفاً ------ */
  console.log('\n[س] X4: الجرد الأول رفاً رفاً');
  {
    const pg = await fresh(d => {
      d.books.push({ id: 'u1', code: 'K71', title: 'كتاب لم يُجرد أ', barcode: '5001', cat: 'أدب', price: 10, qty: 0, uncounted: true });
      d.books.push({ id: 'u2', code: 'K72', title: 'كتاب بلا باركود للجرد', barcode: '', cat: 'أدب', price: 10, qty: -2, uncounted: true });
      d.books.push({ id: 'u3', code: 'K73', title: 'كتاب لم يُجرد ج', barcode: '5003', cat: '', price: 10, qty: 0, uncounted: true });
    });
    await pg.evaluate(() => { location.hash = '#/stocktake'; App.route(); }); await sleep(300);
    check('مصراتة: لا «الجرد الأول»', (await S(pg, () => document.getElementById('view').textContent)).indexOf('الجرد الأول') < 0);
    await pg.evaluate(() => { document.body.setAttribute('data-edition', 'tripoli'); Rep.setStk('hub', 'first'); }); await sleep(400);
    check('طرابلس: «الجرد الأول» و3 لم تُجرد', (await S(pg, () => document.getElementById('view').textContent)).indexOf('لم يُجرد بعد') >= 0 && !!(await pg.$('#fcScan')));
    await pg.evaluate(() => { Count.fcSet('lib', 'A'); Count.fcSet('shelf', '2'); Count.fcSet('cat', 'تاريخ'); }); await sleep(300);
    const scan = async v => { await pg.fill('#fcScan', v); await pg.press('#fcScan', 'Enter'); await sleep(350); };
    await scan('5001'); await scan('5001'); await scan('5003');
    let u = await S(pg, () => ({ u1: App.S.books.find(b => b.id === 'u1'), u3: App.S.books.find(b => b.id === 'u3') }));
    check('مسحتان = نسختان، ويخرج من «لم يُجرد» ويأخذ مكان الرف', u.u1.qty === 2 && !u.u1.uncounted && u.u1.lib === 'A' && u.u1.shelf === '2', JSON.stringify(u.u1));
    check('الكتاب الذي بلا تخصص يأخذ تخصص الرف، وصاحب التخصص يبقى عليه', u.u3.cat === 'تاريخ' && u.u1.cat === 'أدب', JSON.stringify([u.u1.cat, u.u3.cat]));
    await pg.fill('#fcScan', 'بلا باركود'); await pg.press('#fcScan', 'Enter'); await sleep(400);
    check('بالاسم: قائمة اقتراحات', await S(pg, () => document.querySelectorAll('#fcSug .s-item').length) >= 2);
    await pg.evaluate(() => Count.fcPick('u2')); await sleep(300);
    check('كتاب كميته سالبة من بيع قبل الجرد: يصير بعدد ما على الرف', await S(pg, () => App.S.books.find(b => b.id === 'u2').qty) === 1);
    await pg.evaluate(() => Count.fcBump('u1', -1)); await sleep(300);
    check('«−» ينقص نسخة', await S(pg, () => App.S.books.find(b => b.id === 'u1').qty) === 1);
    await scan('7777777'); await sleep(200);
    check('باركود غير مسجّل: نافذة «كتاب غير مسجّل» والباركود فيها', (await S(pg, () => (document.getElementById('f_barcode') || {}).value)) === '7777777');
    await pg.fill('#f_title', 'كتاب جديد من الرف'); await clickModal(pg, 'سجّله وعدّه'); await sleep(400);
    const nb = await S(pg, () => App.S.books.find(b => b.title === 'كتاب جديد من الرف'));
    check('يُسجَّل في مكان الرف ويُعدّ نسخة', nb && nb.qty === 1 && nb.lib === 'A' && nb.shelf === '2' && nb.barcode === '7777777' && nb.cat === 'تاريخ', JSON.stringify(nb));
    const txt = await S(pg, () => document.getElementById('view').textContent);
    check('التقدم: جُرد 4 من 4', /جُرد\s*4\s*من 4/.test(txt.replace(/\s+/g, ' ')) || txt.indexOf('من 4 كتاب') >= 0, txt.slice(0, 200));
    await pg.evaluate(() => Count.fcNextShelf()); await sleep(300);
    check('«انتهى هذا الرف»: الرف التالي، وملخص الرف في السجل', await S(pg, () => App.S.log.some(l => l.action === 'جرد أول' && l.detail.indexOf('رف 2') >= 0)) &&
      (await S(pg, () => document.getElementById('view').textContent)).indexOf('رف 3') >= 0);
    await pg.close();
  }

  console.log('\nأخطاء JavaScript:', errs.length ? [...new Set(errs)] : 'لا شيء');
  if (errs.length) fail++;
  console.log('\n' + '='.repeat(50) + '\n  نجح: ' + pass + '    فشل: ' + fail + '\n' + '='.repeat(50));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
