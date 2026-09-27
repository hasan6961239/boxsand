/* اختبار المال: كل خطأ حسابي وُجد في الاختبار المكثّف له حالة هنا.
   الأخطاء هنا لا تُسقط البرنامج — تُفسد الأرقام بصمت: مردود أكثر مما
   دُفع، مخزون يعود من العدم، دين يضيع، صندوق لا يطابق الدرج.
   شغّل tools/dev-server.js أولاً، ثم: node tools/test-money.js */
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const URL = 'http://127.0.0.1:17845/';
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = path.join(__dirname, '..', '.devdata');
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

  console.log('\nأخطاء JavaScript:', errs.length ? [...new Set(errs)] : 'لا شيء');
  if (errs.length) fail++;
  console.log('\n' + '='.repeat(50) + '\n  نجح: ' + pass + '    فشل: ' + fail + '\n' + '='.repeat(50));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
