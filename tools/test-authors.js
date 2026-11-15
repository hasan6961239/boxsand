/* ============================================================
   test-authors.js — حصة المؤلفين (طرابلس)، فواتير المشتريات، وطلبات التحويل
   ------------------------------------------------------------
   طلب أصحاب مكتبة طرابلس: كتاب يطبعونه لمؤلف، ولكل نسخة تنباع حصة له (نسبة من
   سعر البيع أو مبلغ ثابت). الحصة مال، والخطأ فيها لا يُسقط البرنامج بل يُفسد
   الحساب بصمت — فكل طريق يمرّ به المال له حالة هنا: البيع، الخصم، الجملة، النسخة
   المجانية، التلفون، الإرجاع الجزئي والكامل، تعديل الفاتورة، حذف الإرجاع ثم الفاتورة،
   تغيير النسبة بعد البيع، التسديد من الدرج، الأرشفة، وحذف المؤلف.
   ومعها: فواتير المشتريات في «الفواتير» (مصراتة) وكشف المورد برقم كل فاتورة،
   و«عمليات التحويل المطلوبة» بالأحمر تحت المخازن.
   شغّل tools/dev-server.js أولاً، ثم: node tools/test-authors.js
   ============================================================ */
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const URL = 'http://127.0.0.1:17845/';
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = process.env.QI_DATA || path.join(__dirname, '..', '.devdata');
const X3 = !!process.env.QI_X3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0015;

const seed = () => ({
  meta: { setupDone: true, shopName: 'دار الحكمة', currency: 'د.ل', libraries: ['A'], shelves: 6, uiSize: 'md', theme: 'blue' },
  branch: { id: 'tripoli', name: 'دار الحكمة', city: 'طرابلس', no: 2 },
  books: [
    { id: 'b1', code: 'K1', title: 'فيزياء أساسية', lib: 'A', shelf: '1', barcode: '1001', cost: 40, price: 100, priceW: 90, qty: 20, min: 1 },
    { id: 'b2', code: 'K2', title: 'كتاب عادي', lib: 'A', shelf: '1', barcode: '1002', cost: 10, price: 20, qty: 20, min: 1 },
    { id: 'b3', code: 'K3', title: 'رياضيات متقدمة', lib: 'A', shelf: '2', barcode: '1003', cost: 30, price: 60, qty: 20, min: 1 }
  ],
  stationery: [], customers: [{ id: 'c1', name: 'زبون', phone: '091', balance: 0 }],
  suppliers: [], invoices: [], payments: [], purchases: [], counters: { invoice: 89, book: 3, stat: 0 }
});

let pass = 0, fail = 0;
const check = (name, ok, got) => {
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          ' + (typeof got === 'string' ? got : JSON.stringify(got))));
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errs = [];
  async function fresh(mod, tripoli) {
    const d = seed(); if (mod) mod(d);
    fs.writeFileSync(path.join(DATA, 'store.json'), JSON.stringify(d));
    const pg = await b.newPage({ viewport: { width: 1500, height: 950 } });
    if (X3) {
      const close = pg.close.bind(pg);
      pg.close = async o => {
        if (!o) await pg.evaluate(() => App.flushSave().catch(() => { })).catch(() => { });
        return close(o);
      };
    }
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('dialog', dd => dd.accept().catch(() => {}));
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S && App.S.books && window.Sales && window.Inv && window.People, null, { timeout: 30000 });
    await sleep(600);
    await pg.evaluate(t => { window.print = () => {}; if (t !== false) { document.body.setAttribute('data-edition', 'tripoli'); App.rebuildNav(); } }, tripoli);
    return pg;
  }
  const clear = pg => pg.evaluate(() => { const h = document.getElementById('modalHost'); if (h) h.innerHTML = ''; });
  const clickModal = async (pg, txt) => { await pg.click('#modalHost button:has-text("' + txt + '")'); await sleep(350); };
  async function sell(pg, lines, disc, how) {
    await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(350);
    for (const [id, q] of lines) await pg.evaluate(([id, q]) => { Sales.add('book', id); Sales.setQty(Sales.__cartLen() - 1, q); }, [id, q]);
    if (disc) await pg.evaluate(d => Sales.setDiscount(d), disc);
    await pg.evaluate(() => Sales.complete()); await sleep(300);
    if (how === 'credit') {
      await pg.evaluate(() => Sales.pick('credit')); await sleep(200);
      await pg.selectOption('#payCust', 'c1');
      await pg.evaluate(() => Sales.confirmCredit());
    } else await pg.evaluate(h => Sales.pick(h || 'cash'), how);
    await sleep(400);
    return pg.evaluate(() => App.S.invoices[0]);
  }
  async function doReturn(pg, invId, qtys) {
    await pg.evaluate(id => Sales.startReturn(id), invId); await sleep(300);
    const ins = await pg.$$('#modalHost .ret-q');
    for (let i = 0; i < qtys.length; i++) { await ins[i].fill(''); if (qtys[i]) await ins[i].type(String(qtys[i])); }
    await pg.click('#modalHost button:has-text("تسجيل الإرجاع")'); await sleep(400);
    await clear(pg);
    return pg.evaluate(() => App.S.invoices[0]);
  }
  /* مؤلف + كتاب مربوط به، مباشرة في البيانات (الواجهة نفسها تُختبر في [م1]) */
  const AU = { id: 'a1', name: 'أحمد رحيل', phone: '0911', defT: 'pct', defV: 10, opening: 0, created: '2026-01-01 10:00' };
  const withAuthor = (extra) => d => {
    d.authors = [Object.assign({}, AU)];
    Object.assign(d.books[0], { royAu: 'a1', royT: 'pct', royV: 10, author: 'أحمد رحيل' });
    if (extra) extra(d);
  };
  const due = (pg, id) => pg.evaluate(i => People.authorDue(People.author(i || 'a1')), id);

  /* ============================================================ */
  console.log('\n[م1] المؤلف وخانة «مؤلف مدفوع» في بيانات الكتاب');
  {
    const pg = await fresh();
    await pg.evaluate(() => { location.hash = '#/suppliers'; App.route(); }); await sleep(400);
    const tabs = await pg.evaluate(() => [...document.querySelectorAll('#view .seg button')].map(x => x.textContent));
    check('طرابلس: صفحة «المؤلفون ودور النشر» فيها تبويب المؤلفين', tabs.join('|') === 'المؤلفون|دور النشر|الموردون', tabs);
    check('اسم التبويب الجانبي «المؤلفون ودور النشر»', await pg.evaluate(() => document.querySelector('.nav-item[data-k="suppliers"] span').textContent) === 'المؤلفون ودور النشر');
    await pg.click('button:has-text("+ مؤلف جديد")'); await sleep(300);
    await pg.fill('#f_name', 'أحمد رحيل'); await pg.fill('#f_phone', '0911'); await pg.fill('#f_defV', '10');
    await pg.click('#modalHost .m-foot .btn.primary'); await sleep(400);
    const a = await pg.evaluate(() => App.S.authors[0]);
    check('المؤلف تسجّل (حصته عادةً 10%)', a && a.name === 'أحمد رحيل' && a.defT === 'pct' && a.defV === 10, a);
    await pg.click('button:has-text("+ مؤلف جديد")'); await sleep(300);
    await pg.fill('#f_name', 'احمد رحيل'); await pg.click('#modalHost .m-foot .btn.primary'); await sleep(300);
    check('نفس الاسم (بلا همزة) ما يتسجّلش مرتين', await pg.evaluate(() => App.S.authors.length) === 1);
    await clear(pg);

    await pg.evaluate(() => Inv.editBook('b1')); await sleep(400);
    const hid = await pg.evaluate(() => ['royT', 'royV'].map(k => getComputedStyle(document.querySelector('#f_' + k).closest('.field')).display));
    check('قبل الاختيار: خانتا الحصة مخفيتان', hid.every(x => x === 'none'), hid);
    const opts = await pg.evaluate(() => [...document.querySelectorAll('#f_royAu option')].map(o => o.textContent));
    check('«مؤلف مدفوع» قائمة: لا يوجد، المؤلفون، إضافة مؤلف', opts[0].indexOf('لا يوجد') >= 0 && opts.some(o => o.indexOf('أحمد رحيل') === 0) && opts[opts.length - 1].indexOf('إضافة مؤلف') >= 0, opts);
    await pg.selectOption('#f_royAu', a.id); await sleep(300);
    const shown = await pg.evaluate(() => ({
      vis: ['royT', 'royV'].map(k => getComputedStyle(document.querySelector('#f_' + k).closest('.field')).display),
      t: document.querySelector('#f_royT').value, v: document.querySelector('#f_royV').value, au: document.querySelector('#f_author').value,
      hint: document.querySelector('#f_royV').closest('.field').querySelector('.hint').textContent
    }));
    check('بعد الاختيار: الخانتان تظهران بحصته المعتادة (10%)', shown.vis.every(x => x !== 'none') && shown.t === 'pct' && shown.v === '10', shown);
    check('المثال بسعر الكتاب: 100 ← للمؤلف 10 · للمكتبة 90', /100\.00 ← للمؤلف 10\.00 · للمكتبة 90\.00/.test(shown.hint), shown.hint);
    check('خانة «المؤلف» العادية تنكتب باسمه لو فاضية', shown.au === 'أحمد رحيل', shown.au);
    await pg.click('#modalHost .m-foot .btn.primary'); await sleep(400);
    const bk = await pg.evaluate(() => { const x = App.S.books.find(y => y.id === 'b1'); return { a: x.royAu, t: x.royT, v: x.royV }; });
    check('الكتاب انحفظ بمؤلفه وحصته', bk.a === a.id && bk.t === 'pct' && bk.v === 10, bk);

    // التحقق من القيم
    await pg.evaluate(() => Inv.editBook('b1')); await sleep(350);
    await pg.fill('#f_royV', '100'); await pg.click('#modalHost .m-foot .btn.primary'); await sleep(300);
    check('نسبة 100% فما فوق مرفوضة', await pg.evaluate(() => App.S.books.find(y => y.id === 'b1').royV) === 10);
    await pg.selectOption('#f_royT', 'fix'); await pg.fill('#f_royV', '150'); await pg.click('#modalHost .m-foot .btn.primary'); await sleep(300);
    check('مبلغ ثابت أكبر من سعر الكتاب مرفوض', await pg.evaluate(() => App.S.books.find(y => y.id === 'b1').royT) === 'pct');
    await pg.fill('#f_royV', '0'); await pg.click('#modalHost .m-foot .btn.primary'); await sleep(300);
    check('قيمة صفر مع مؤلف مختار مرفوضة', await pg.evaluate(() => App.S.books.find(y => y.id === 'b1').royV) === 10);
    await pg.fill('#f_royV', '12.5'); await pg.click('#modalHost .m-foot .btn.primary'); await sleep(400);
    check('مبلغ ثابت 12.5 للنسخة ينحفظ', await pg.evaluate(() => { const x = App.S.books.find(y => y.id === 'b1'); return x.royT === 'fix' && x.royV === 12.5; }));
    await clear(pg);

    // «➕ إضافة مؤلف جديد…» من داخل بيانات الكتاب
    await pg.evaluate(() => Inv.editBook('b3')); await sleep(350);
    await pg.selectOption('#f_royAu', '__new__'); await sleep(350);
    const nForms = await pg.evaluate(() => document.querySelectorAll('#modalHost .modal').length);
    await pg.fill('#modalHost .modal:last-child #f_name', 'سالم الكاتب');
    await pg.selectOption('#modalHost .modal:last-child #f_defT', 'fix');
    await pg.fill('#modalHost .modal:last-child #f_defV', '7');
    await pg.click('#modalHost .overlay:last-child .m-foot .btn.primary'); await sleep(400);
    const nb = await pg.evaluate(() => {
      const sel = document.querySelector('#f_royAu'), a = App.S.authors.find(x => x.name === 'سالم الكاتب');
      return { forms: document.querySelectorAll('#modalHost .modal').length, sel: sel.value, a: a && a.id, t: document.querySelector('#f_royT').value, v: document.querySelector('#f_royV').value };
    });
    check('مؤلف جديد من نموذج الكتاب: يتسجّل ويختاره الكتاب بحصته (7 دينار)', nForms === 2 && nb.forms === 1 && nb.sel === nb.a && nb.t === 'fix' && nb.v === '7', nb);
    await pg.click('#modalHost .m-foot .btn.primary'); await sleep(400);
    check('رياضيات متقدمة: حصة ثابتة 7 لسالم', await pg.evaluate(() => { const x = App.S.books.find(y => y.id === 'b3'); return x.royT === 'fix' && x.royV === 7 && App.S.authors.some(a => a.id === x.royAu && a.name === 'سالم الكاتب'); }));

    // «لا يوجد» يشيل الحصة من الكتاب
    await pg.evaluate(() => Inv.editBook('b3')); await sleep(350);
    await pg.selectOption('#f_royAu', ''); await sleep(200);
    await pg.click('#modalHost .m-foot .btn.primary'); await sleep(400);
    check('اختيار «لا يوجد» يشيل المؤلف وحصته من الكتاب', await pg.evaluate(() => { const x = App.S.books.find(y => y.id === 'b3'); return !('royAu' in x) && !('royT' in x) && !('royV' in x); }));
    await pg.close();
  }

  console.log('\n[م2] مصراتة: لا شيء من هذا يظهر');
  {
    const pg = await fresh(d => { d.branch = { id: 'misrata', name: 'مصراتة', city: 'مصراتة', no: 1 }; }, false);
    await pg.evaluate(() => Inv.editBook('b1')); await sleep(350);
    check('مصراتة: نموذج الكتاب بلا «مؤلف مدفوع»', await pg.evaluate(() => !document.querySelector('#f_royAu')));
    await clear(pg);
    await pg.evaluate(() => { location.hash = '#/suppliers'; App.route(); }); await sleep(400);
    check('مصراتة: صفحة الموردين كما كانت (دور النشر ثم الموردون، بلا تبويبات)', await pg.evaluate(() =>
      !document.querySelector('#view .seg') && document.querySelector('.nav-item[data-k="suppliers"] span').textContent === 'الموردون ودور النشر' &&
      /دور النشر ونسبها/.test(document.getElementById('view').textContent)));
    await pg.close();
  }

  console.log('\n[م3] البيع: الحصة على السطر والربح بعدها');
  {
    const pg = await fresh(withAuthor());
    await pg.evaluate(() => App.unlockProfit('Rtv8ss3i')).catch(() => false);
    await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(350);
    await pg.evaluate(() => { Sales.add('book', 'b1'); Sales.setQty(0, 5); Sales.add('book', 'b2'); });
    await pg.evaluate(() => Sales.setDiscount(10));
    const live = await pg.evaluate(() => App.canProfit() ? document.getElementById('tProfit').textContent : 'locked');
    const inv = await sell(pg, [], 0, 'cash');
    const l = inv.items.find(x => x.id === 'b1'), l2 = inv.items.find(x => x.id === 'b2');
    check('سطر الكتاب مختوم بالمؤلف والحصة وقتها (10% من 100 = 10 للنسخة)', l.au === 'a1' && l.rt === 'pct' && l.rv === 10 && l.ru === 10, l);
    check('الكتاب العادي بلا حصة', !('au' in l2) && !('ru' in l2), l2);
    check('حصة المؤلفين في الفاتورة 50', inv.roy === 50, inv.roy);
    // 5×100 + 20 = 520، خصم 10 ⇦ 510. التكلفة 5×40 + 10 = 210. الربح 520 − 210 − 10 − 50 = 250
    check('الربح بعد حصة المؤلف: 520 − 210 − 10 − 50 = 250', inv.total === 510 && near(inv.profit, 250), [inv.total, inv.profit]);
    check('«ربح هذه الفاتورة» في نقطة البيع كان بعد حصة المؤلف', live === 'locked' || live === '250.00', live);
    check('المؤلف له علينا 50', near(await due(pg), 50));
    await pg.evaluate(id => Sales.showInvoice(id), inv.id); await sleep(350);
    const txt = await pg.evaluate(() => document.querySelector('#modalHost .modal').textContent);
    check('الفاتورة تبيّن: للمؤلف 50.00 · للمكتبة 450.00', /للمؤلف 50\.00 · للمكتبة 450\.00/.test(txt), txt.slice(0, 300));
    check('وتحت: منها حصة المؤلفين 50 وللمكتبة 460', /منها حصة المؤلفين50\.00/.test(txt) && /للمكتبة بعد حصة المؤلفين460\.00/.test(txt), txt.slice(-200));
    await clear(pg);
    const rc = await pg.evaluate(id => Sales.__receiptHtml ? Sales.__receiptHtml(id) : (function () { const v = App.S.invoices.find(x => x.id === id); return Sales.receiptHtml ? Sales.receiptHtml(v) : ''; })(), inv.id);
    check('إيصال الزبون ما فيهش حصة المؤلف', rc === '' || !/للمؤلف|مؤلف/.test(rc), rc.slice(0, 200));

    // الجملة: النسبة من سعر الجملة
    await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(300);
    await pg.evaluate(() => { Sales.setMode('wholesale'); Sales.add('book', 'b1'); Sales.setQty(0, 2); });
    const w = await sell(pg, [], 0, 'cash');
    await pg.evaluate(() => Sales.setMode('retail'));
    check('بيع جملة (90): الحصة 10% من 90 = 9 للنسخة', w.items[0].price === 90 && w.items[0].ru === 9 && w.roy === 18, w.items[0]);
    check('المؤلف له 50 + 18 = 68', near(await due(pg), 68));
    await pg.close();
  }

  console.log('\n[م4] مبلغ ثابت، ونسخة مجانية، والتلفون');
  {
    const pg = await fresh(withAuthor(d => { Object.assign(d.books[2], { royAu: 'a1', royT: 'fix', royV: 7 }); }));
    const inv = await sell(pg, [['b3', 3]], 0, 'cash');
    check('مبلغ ثابت 7 للنسخة: 3 نسخ = 21', inv.items[0].ru === 7 && inv.roy === 21, inv.items[0]);
    check('الربح 3×(60−30) − 21 = 69', near(inv.profit, 69), inv.profit);
    // نسخة مجانية: سعر الكتاب صفر ⇦ «بيعه مجاناً» ⇦ لا حصة
    await pg.evaluate(() => { const x = App.S.books.find(y => y.id === 'b3'); x.price = 0; });
    await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(300);
    await pg.evaluate(() => { Sales.add('book', 'b3'); Sales.complete(); }); await sleep(400);
    await clickModal(pg, 'بيعه مجاناً'); await sleep(200);
    await pg.evaluate(() => Sales.pick('cash')); await sleep(400);
    const fr = await pg.evaluate(() => App.S.invoices[0]);
    check('نسخة مجانية (سعرها صفر) ما فيهاش حصة للمؤلف', fr.total === 0 && !fr.items[0].au && !fr.roy, fr.items[0]);
    await pg.evaluate(() => { App.S.books.find(y => y.id === 'b3').price = 60; });
    // التلفون
    const ph = await pg.evaluate(() => {
      const inv = Sales.applyPhoneOrder({ id: 'ph1', items: [{ b: '1001', q: 4, p: 100, n: 'فيزياء أساسية' }, { k: 'K3', q: 1, p: 60 }], disc: 0, method: 'cash' }, 'تلفون الاختبار');
      return inv && { roy: inv.roy, profit: inv.profit, l: inv.items.map(x => [x.id, x.ru || 0]) };
    });
    // 4×10 + 7 = 47؛ الربح 4×60 + 30 − 47 = 223
    check('بيع من التلفون: الحصة تنحسب هنا (4×10 + 7 = 47)', ph && ph.roy === 47 && JSON.stringify(ph.l) === JSON.stringify([['b1', 10], ['b3', 7]]), ph);
    check('وربح فاتورة التلفون بعدها: 223', ph && near(ph.profit, 223), ph);
    check('المؤلف له 21 + 47 = 68', near(await due(pg), 68));
    await pg.close();
  }

  console.log('\n[م5] الإرجاع: حصة النسخ الراجعة تنخصم من المؤلف');
  {
    const pg = await fresh(withAuthor());
    const inv = await sell(pg, [['b1', 5], ['b2', 1]], 10, 'cash');
    await pg.evaluate(id => Sales.startReturn(id), inv.id); await sleep(300);
    const dlg = await pg.evaluate(() => document.querySelector('#modalHost .modal').textContent);
    check('نافذة الإرجاع تبيّن حصة المؤلف للنسخة (10 لأحمد رحيل)', /يُخصم من المؤلف للنسخة/.test(dlg) && /10\.00أحمد رحيل/.test(dlg), dlg.slice(0, 400));
    await clear(pg);
    const r1 = await doReturn(pg, inv.id, [2, 0]);
    check('إرجاع نسختين: سطر الإرجاع بنفس الحصة، وحصة الإرجاع −20', r1.kind === 'return' && r1.items[0].ru === 10 && r1.items[0].au === 'a1' && r1.roy === -20, r1);
    // ما رُدّ 200×510/520 = 196.154؛ الربح الراجع 196.154 − 80 − 20 = 96.154
    check('ربح الإرجاع بعد حصة المؤلف: −(196.154 − 80 − 20)', near(r1.total, -196.154) && near(r1.profit, -96.154), [r1.total, r1.profit]);
    check('المؤلف له 50 − 20 = 30', near(await due(pg), 30));
    const r2 = await doReturn(pg, inv.id, [3, 1]);
    check('إرجاع الباقي (3 نسخ + الكتاب العادي): حصة −30', r2.roy === -30, r2.roy);
    check('بعد إرجاع كامل: حساب المؤلف من هذه الفاتورة صفر', near(await due(pg), 0));
    const sumP = await pg.evaluate(() => App.S.invoices.reduce((s, v) => s + v.profit, 0));
    check('بعد إرجاع كامل: ربح الفاتورة وإرجاعاتها صفر بالضبط', near(sumP, 0), sumP);
    const rows = await pg.evaluate(() => People.authorRows('a1').map(r => [r.t, r.cr, r.dr]));
    check('كشف الحساب: الفاتورة +50، وإرجاعان −20 و−30', rows.length === 3 && rows[0][1] === 50 && rows[1][2] === 20 && rows[2][2] === 30, rows);
    const showR = await (async () => { await pg.evaluate(id => Sales.showInvoice(id), r1.id); await sleep(300); const t = await pg.evaluate(() => document.querySelector('#modalHost .modal').textContent); await clear(pg); return t; })();
    check('فاتورة الإرجاع تبيّن ما انخصم من المؤلف', /انخصم من حصة المؤلفين20\.00/.test(showR) && /من المؤلف 20\.00/.test(showR), showR.slice(0, 300));

    // حذف إرجاع ثم الفاتورة
    await pg.evaluate(id => Sales.deleteInvoice(id), r2.id); await sleep(300);
    const delTxt = await pg.evaluate(() => document.querySelector('#modalHost .modal').textContent);
    check('حذف الإرجاع يقول إن حصة المؤلف ترجع لحسابه', /ترجع لحسابه/.test(delTxt), delTxt.slice(0, 300));
    await clickModal(pg, 'تأكيد الحذف');
    check('بعد حذف الإرجاع الثاني: المؤلف له 30 من جديد', near(await due(pg), 30));
    await pg.evaluate(id => Sales.deleteInvoice(id), r1.id); await sleep(300); await clickModal(pg, 'تأكيد الحذف');
    check('بعد حذف الإرجاع الأول: له 50', near(await due(pg), 50));
    await pg.evaluate(id => Sales.deleteInvoice(id), inv.id); await sleep(300);
    const delS = await pg.evaluate(() => document.querySelector('#modalHost .modal').textContent);
    check('حذف الفاتورة يقول إن حصة المؤلف تنشال من حسابه', /تنشال من حسابه/.test(delS), delS.slice(0, 300));
    await clickModal(pg, 'تأكيد الحذف');
    check('بعد حذف الفاتورة: حساب المؤلف صفر', near(await due(pg), 0));
    await pg.close();
  }

  console.log('\n[م6] تعديل الفاتورة، وتغيير النسبة بعد البيع');
  {
    const pg = await fresh(withAuthor(d => { Object.assign(d.books[2], { royAu: 'a1', royT: 'fix', royV: 7 }); }));
    const inv = await sell(pg, [['b1', 5]], 0, 'cash');
    // النسبة تتغيّر بعد البيع: الفاتورة القديمة كما هي
    await pg.evaluate(() => { const x = App.S.books.find(y => y.id === 'b1'); x.royV = 20; });
    check('تغيير نسبة الكتاب بعد البيع ما يغيّرش الفاتورة القديمة (له 50)', near(await due(pg), 50));
    await pg.evaluate(id => Sales.editInvoice(id), inv.id); await sleep(350);
    await pg.evaluate(() => { Sales.edSet(0, 'qty', 3); Sales.edSet(0, 'price', 80); Sales.edAdd('book', 'b3'); }); await sleep(250);
    const foot = await pg.evaluate(() => document.getElementById('edFoot').textContent);
    // سطر قديم: 10% (نسبة وقت البيع) من 80 = 8 × 3 = 24؛ والمضاف: 7 ثابتة ⇦ 31
    check('نافذة التعديل تبيّن حصة المؤلفين بعد التعديل (24 + 7 = 31)', /منها للمؤلفين 31\.00/.test(foot), foot);
    await clickModal(pg, 'حفظ التعديل'); await sleep(300);
    const v = await pg.evaluate(id => App.S.invoices.find(x => x.id === id), inv.id);
    const l1 = v.items.find(x => x.id === 'b1'), l3 = v.items.find(x => x.id === 'b3');
    check('السطر القديم بنسبته وقت البيع (10%) على السعر الجديد: 8 للنسخة', l1.rv === 10 && l1.ru === 8 && l1.qty === 3, l1);
    check('الكتاب المضاف في التعديل بحصة كتابه الآن (7)', l3.ru === 7 && l3.rt === 'fix', l3);
    // الربح 3×(80−40) + (60−30) − 31 = 120 + 30 − 31 = 119
    check('حصة الفاتورة 31 والربح 119', v.roy === 31 && near(v.profit, 119), [v.roy, v.profit]);
    check('المؤلف له 31', near(await due(pg), 31));
    // تعديل يشيل السطر كله
    await pg.evaluate(id => Sales.editInvoice(id), inv.id); await sleep(300);
    await pg.evaluate(() => { const i = Sales.__ed ? -1 : 0; Sales.edDel(0); }); await sleep(200);
    await clickModal(pg, 'حفظ التعديل'); await sleep(300);
    const v2 = await pg.evaluate(id => App.S.invoices.find(x => x.id === id), inv.id);
    check('حذف سطر الكتاب في التعديل يشيل حصته (يبقى 7)', v2.roy === 7 && near(await due(pg), 7), [v2.roy, v2.items.length]);
    await pg.close();
  }

  console.log('\n[م7] التسديد للمؤلف، والدرج، وكشف الحساب');
  {
    const pg = await fresh(withAuthor(d => { d.authors[0].opening = 15; }));
    const inv = await sell(pg, [['b1', 5]], 0, 'cash');
    check('رصيد سابق 15 + حصته 50 = 65', near(await due(pg), 65));
    await pg.evaluate(() => { location.hash = '#/suppliers'; App.route(); }); await sleep(400);
    const row = await pg.evaluate(() => document.querySelector('#aList tbody tr').textContent);
    check('قائمة المؤلفين: 5 نسخ، حصته 50، له علينا 65', /5/.test(row) && /50\.00/.test(row) && /65\.00/.test(row), row);
    await pg.click('#aList button:has-text("تسديد")'); await sleep(300);
    await pg.fill('#f_amount', '100'); await pg.click('#modalHost .m-foot .btn.primary'); await sleep(300);
    check('ما ينفعش ندفع له أكثر من حسابه', await pg.evaluate(() => App.S.authorPays.length) === 0);
    await pg.fill('#f_amount', '40'); await pg.click('#modalHost .m-foot .btn.primary'); await sleep(400);
    check('تسديد 40: الباقي له 25', near(await due(pg), 25));
    const tk = await pg.evaluate(() => { const t = App.today(); return Rep.__takings ? Rep.__takings(App.S.invoices.filter(v => v.date === t), t, t) : null; });
    if (tk) check('التسديد من الدرج يُطرح من النقد المفروض (500 − 40 = 460)', near(tk.cash, 460) && near(tk.authOut, 40), tk);
    await pg.evaluate(() => { location.hash = '#/stocktake'; App.route(); Rep.setStk('hub', 'sales'); }); await sleep(400);
    const cashBox = await pg.evaluate(() => document.querySelector('.paybox.cash').textContent);
    check('الجرد اليومي: «نقداً في الصندوق» 460 ومكتوب «دُفع لمؤلفين 40»', /460\.00/.test(cashBox) && /دُفع لمؤلفين 40\.00/.test(cashBox), cashBox);
    await pg.evaluate(() => People.authorStatement('a1')); await sleep(400);
    const st = await pg.evaluate(() => ({ t: document.querySelector('#modalHost .modal').textContent, btn: !!document.querySelector('#modalHost button[onclick*="Sales.showInvoice"]') }));
    check('كشف الحساب: رصيد سابق، فاتورة 90 بخمس نسخ، والتسديد، والرصيد 25', /رصيد سابق له علينا/.test(st.t) && /فاتورة رقم 90/.test(st.t) && /دفعنا له من الدرج/.test(st.t) && /له علينا حالياً: 25\.00/.test(st.t), st.t.slice(0, 500));
    await pg.click('#modalHost button[onclick*="Sales.showInvoice"]'); await sleep(400);
    const opened = await pg.evaluate(() => [...document.querySelectorAll('#modalHost .modal h3')].map(h => h.textContent));
    check('الضغط على الفاتورة في الكشف يفتحها', opened.indexOf('فاتورة رقم 90') >= 0, opened);
    await clear(pg);
    // حذف المؤلف: ممنوع وحسابه مش صفر، ومسموح بعد التسديد (ويتشال من كتبه)
    await pg.evaluate(() => People.delAuthor('a1')); await sleep(300);
    check('حذف مؤلف له علينا: ممنوع', await pg.evaluate(() => App.S.authors.length) === 1 && !(await pg.evaluate(() => !!document.querySelector('#modalHost .modal'))));
    await pg.evaluate(() => { App.S.authorPays.unshift({ id: 'px', authorId: 'a1', amount: 25, date: App.today(), at: App.nowStamp(), note: '', fromDrawer: false }); });
    await pg.evaluate(() => People.delAuthor('a1')); await sleep(300);
    await clickModal(pg, 'حذف');
    check('بعد التسديد كله: المؤلف ينحذف ويتشال من كتابه', await pg.evaluate(() => App.S.authors.length === 0 && !App.S.books.find(y => y.id === 'b1').royAu));
    const after = await sell(pg, [['b1', 1]], 0, 'cash');
    check('وبعدها النسخ اللي تنباع ما فيهاش حصة', !after.items[0].au && !after.roy, after.items[0]);
    await pg.close();
  }

  console.log('\n[م8] التقارير والأرشفة');
  {
    const lastYear = String(new Date().getFullYear() - 1);
    const pg = await fresh(withAuthor(d => {
      const old = { id: 'old1', no: 5, kind: 'sale', date: lastYear + '-06-01', at: lastYear + '-06-01 10:00', subtotal: 300, discount: 0, total: 300, profit: 150, roy: 30,
        method: 'cash', mode: 'retail', customerId: '', paid: 300, due: 0,
        items: [{ type: 'book', id: 'b1', name: 'فيزياء أساسية', qty: 3, price: 100, cost: 40, au: 'a1', rt: 'pct', rv: 10, ru: 10 }] };
      const oldR = { id: 'old2', no: 6, kind: 'return', refNo: 5, date: lastYear + '-06-02', at: lastYear + '-06-02 10:00', subtotal: -100, discount: 0, total: -100, profit: -50, roy: -10,
        method: 'cash', customerId: '', paid: -100, due: 0, cashBack: 100, debtCut: 0,
        items: [{ type: 'book', id: 'b1', name: 'فيزياء أساسية', qty: 1, price: 100, cost: 40, au: 'a1', rt: 'pct', rv: 10, ru: 10 }] };
      d.invoices = [oldR, old];
    }));
    await sell(pg, [['b1', 2], ['b2', 1]], 0, 'cash');
    check('قبل الأرشفة: له 20 (السنة الماضية) + 20 = 40', near(await due(pg), 40));
    const det = await pg.evaluate(() => { const t = App.today(); return Rep.soldDetail(App.S.invoices.filter(v => v.date === t)); });
    check('ربح الكتاب في تفصيل المبيعات بعد الحصة: 2×(100−40−10) = 100', near(det.find(x => x.name === 'فيزياء أساسية').prof, 100), det);
    await pg.evaluate(() => { location.hash = '#/settings'; App.route(); }); await sleep(300);
    await pg.evaluate(y => Rep.doArchive(y), lastYear); await sleep(300);
    await clickModal(pg, 'أرشف سنة ' + lastYear); await sleep(1200);
    const ar = await pg.evaluate(() => ({ n: App.S.invoices.length, arch: App.S.authors[0].arch }));
    check('الأرشفة نقلت فواتير السنة الماضية', ar.n === 1, ar);
    check('حصة المؤلف من الفواتير المؤرشفة محفوظة عليه (20)', ar.arch && near(ar.arch[lastYear], 20), ar.arch);
    check('بعد الأرشفة: حسابه نفسه 40 (ما ضاعش شي)', near(await due(pg), 40));
    const rows = await pg.evaluate(() => People.authorRows('a1').map(r => r.t));
    check('كشف الحساب فيه سطر «حصته من فواتير سنة … (مؤرشفة)»', rows.some(t => t.indexOf('مؤرشفة') > 0), rows);
    await pg.close();
  }

  /* ============================================================ */
  console.log('\n[ن] فواتير المشتريات وكشف المورد (مصراتة)');
  {
    const pg = await fresh(d => {
      d.branch = { id: 'misrata', name: 'مصراتة', city: 'مصراتة', no: 1 };
      d.suppliers = [{ id: 's1', name: 'قرطاسية الشهيد', phone: '0912', opening: 100, created: '2026-01-01 10:00' }, { id: 's2', name: 'قرطاسية زليطن', opening: 0 }];
      d.purchases = [
        { id: 'p1', date: '2026-10-01', at: '2026-10-01 10:00', supplierId: 's1', note: 'فاتورة 90', ref: '90', pay: 'credit', past: true, lines: [{ type: 'book', id: 'b1', name: 'فيزياء أساسية', qty: 5, cost: 30, st: 0 }], total: 150 },
        { id: 'p2', date: '2026-10-10', at: '2026-10-10 10:00', supplierId: 's1', note: 'فاتورة 95', ref: '95', pay: 'later', past: true, lines: [{ type: 'book', id: 'b2', name: 'كتاب عادي', qty: 10, cost: 10, st: 0 }], total: 100 },
        { id: 'p3', date: '2026-10-12', at: '2026-10-12 11:00', supplierId: 's1', note: '', pay: 'cash', lines: [{ type: 'book', id: 'b2', name: 'كتاب عادي', qty: 2, cost: 10, st: 0 }], total: 20 }];
      d.supPayments = [{ id: 'sp1', supplierId: 's1', amount: 50, date: '2026-10-05', at: '2026-10-05 12:00', note: '', fromDrawer: true }];
    }, false);
    await pg.evaluate(() => { location.hash = '#/invoices'; App.route(); }); await sleep(400);
    check('الفواتير: تبويبا «فواتير البيع» و«فواتير المشتريات»', await pg.evaluate(() => [...document.querySelectorAll('.inv-tabs button')].map(x => x.textContent).join('|')) === 'فواتير البيع|فواتير المشتريات');
    await pg.click('.inv-tabs button:has-text("فواتير المشتريات")'); await sleep(400);
    const list = await pg.evaluate(() => [...document.querySelectorAll('#purInvList tbody tr')].map(r => r.querySelector('.pur-no').textContent));
    check('قائمة فواتير المشتريات بأرقامها', list.join('|') === 'فاتورة 90|فاتورة 95|بدون رقم', list);
    await pg.click('button:has-text("+ إضافة فاتورة مشتريات")'); await sleep(400);
    check('زر «إضافة فاتورة مشتريات» يفتح بطاقة الفاتورة فوق القائمة', await pg.evaluate(() => !!document.querySelector('.pur-entry') && /فاتورة مشتريات جديدة/.test(document.querySelector('.pur-entry h3').textContent)));
    await pg.selectOption('#purSup', 's2'); await pg.fill('#purRef', '311');
    await pg.fill('#purSearch', 'فيزياء أساسية'); await pg.press('#purSearch', 'Enter'); await sleep(250);
    await pg.evaluate(() => { Inv.purSet(0, 'qty', 4); Inv.purSet(0, 'cost', 28); Inv.purPay('credit'); }); await sleep(350);
    await pg.click('button:has-text("حفظ — للرفوف")'); await sleep(500);
    const sv = await pg.evaluate(() => ({ top: App.S.purchases[0], q: App.S.books[0].qty, cost: App.S.books[0].cost, debt: People.supDebt(People.supplier('s2')), open: !!document.querySelector('.pur-entry') }));
    check('الفاتورة انحفظت برقم المورد (311)، والكمية زادت 4، والدين 112', sv.top.ref === '311' && sv.top.supplierId === 's2' && sv.q === 24 && sv.cost === 28 && near(sv.debt, 112), sv);
    check('بعد الحفظ البطاقة تتقفل وترجع القائمة', !sv.open);
    await pg.click('button:has-text("+ إضافة فاتورة مشتريات")'); await sleep(350);
    await pg.selectOption('#purSup', 's2'); await pg.fill('#purRef', '311');
    await pg.fill('#purSearch', 'كتاب عادي'); await pg.press('#purSearch', 'Enter'); await sleep(250);
    await pg.click('button:has-text("حفظ — للرفوف")'); await sleep(350);
    const dup = await pg.evaluate(() => (document.querySelector('#modalHost .modal') || {}).textContent || '');
    check('نفس الرقم من نفس المورد: تسأل قبل التسجيل', /متسجلة من قبل/.test(dup), dup);
    await pg.click('#modalHost .m-foot .btn.ghost'); await sleep(300);
    check('إلغاء السؤال: ما تسجلتش', await pg.evaluate(() => App.S.purchases.length) === 4);
    await pg.evaluate(() => Inv.purCancel()); await sleep(300);
    // مورد جديد من داخل الفاتورة
    await pg.click('button:has-text("+ إضافة فاتورة مشتريات")'); await sleep(350);
    await pg.selectOption('#purSup', '__new__'); await sleep(300);
    await pg.fill('#modalHost #f_name', 'مكتبة الشهيد'); await pg.click('#modalHost .m-foot .btn.primary'); await sleep(450);
    const ns = await pg.evaluate(() => { const s = App.S.suppliers.find(x => x.name === 'مكتبة الشهيد'); return s && document.getElementById('purSup').value === s.id; });
    check('«➕ إضافة مورد جديد» من الفاتورة: يتسجّل ويتختار', ns);
    await pg.evaluate(() => Inv.purCancel()); await sleep(300);
    // البحث والتصفية
    await pg.evaluate(() => Inv.pfSet('q', '95')); await sleep(200);
    check('البحث برقم الفاتورة', await pg.evaluate(() => [...document.querySelectorAll('#purInvList tbody tr')].length) === 1);
    await pg.evaluate(() => { Inv.pfSet('q', ''); Inv.pfSet('sup', 's2'); }); await sleep(200);
    check('تصفية بالمورد', await pg.evaluate(() => [...document.querySelectorAll('#purInvList .pur-no')].map(x => x.textContent).join('|')) === 'فاتورة 311');
    await pg.evaluate(() => Inv.pfSet('sup', '')); await sleep(200);

    // كشف المورد بالتفصيل
    await pg.evaluate(() => People.supStatement('s1')); await sleep(400);
    const rows = await pg.evaluate(() => [...document.querySelectorAll('#modalHost tbody tr')].map(r => [...r.children].map(c => c.textContent.trim())));
    check('كشف المورد: كل فاتورة برقمها وتاريخها (90 آجل، 95 مؤجّلة، النقدي)', rows.length === 5 && rows[1][1] === '90' && rows[3][1] === '95' && rows[4][1] === 'عرض', rows.map(r => r.slice(0, 2)));
    check('الرصيد بعد كل حركة: 100، 250، 200، 200، 200', rows.map(r => r[5]).join('|') === '100.00|250.00|200.00|200.00|200.00', rows.map(r => r[5]));
    check('الفاتورة النقدية: عليه وله نفس المبلغ (ما تغيّرش الرصيد)', rows[4][3] === '20.00' && rows[4][4] === '20.00', rows[4]);
    await pg.click('#modalHost .pur-no:has-text("90")'); await sleep(400);
    const show = await pg.evaluate(() => { const ms = document.querySelectorAll('#modalHost .modal'); const m = ms[ms.length - 1]; return { h: m.querySelector('h3').textContent, t: m.textContent }; });
    check('الضغط على رقم الفاتورة يفتح ما فيها', show.h === 'فاتورة مشتريات رقم 90 — قرطاسية الشهيد' && /فيزياء أساسية/.test(show.t) && /150\.00/.test(show.t), show.h);
    await clear(pg);
    // حذف فاتورة: الكمية ترجع، والدين ينقص
    const pid = await pg.evaluate(() => App.S.purchases.find(p => p.ref === '311').id);
    await pg.evaluate(id => Inv.delPurchase(id), pid); await sleep(300);
    await clickModal(pg, 'تأكيد الحذف');
    const dl = await pg.evaluate(() => ({ n: App.S.purchases.length, q: App.S.books[0].qty, debt: People.supDebt(People.supplier('s2')) }));
    check('حذف فاتورة مشتريات: الكمية ترجع (20) ودين المورد صفر', dl.n === 3 && dl.q === 20 && near(dl.debt, 0), dl);
    const q2 = await pg.evaluate(() => App.S.books[1].qty);
    await pg.evaluate(() => Inv.delPurchase('p2')); await sleep(300);
    check('حذف فاتورة سابقة: ما فيهاش خيار المخزون', await pg.evaluate(() => !document.querySelector('#purDelStock')));
    await clickModal(pg, 'تأكيد الحذف');
    check('والمخزون ما تغيّرش', await pg.evaluate(() => App.S.books[1].qty) === q2);
    // المخزن: ما دخل للمخزن يرجع من المخزن
    await pg.evaluate(() => { location.hash = '#/purchases'; App.route(); Inv.gset('mode', 'qty'); }); await sleep(400);
    check('«إدخال بضاعة» فيها خانة «رقم فاتورة المورد» وعمود الرقم في السجل', await pg.evaluate(() => !!document.getElementById('purRef') && /رقم الفاتورة/.test(document.querySelector('#view').textContent)));
    await pg.evaluate(() => { Inv.purSetTo('store'); }); await sleep(300);
    await pg.fill('#purRef', '77'); await pg.evaluate(() => Inv.purAdd('book', 'b3')); await pg.evaluate(() => Inv.purSet(0, 'qty', 5)); await sleep(200);
    await pg.click('button:has-text("حفظ — للمخزن")'); await sleep(500);
    const inStore = await pg.evaluate(() => { const x = App.S.books[2]; return [x.qty, App.storeQty(x), App.S.purchases[0].ref]; });
    check('إدخال للمخزن برقم 77: 25 منها 5 في المخزن', inStore.join('|') === '25|5|77', inStore);
    await pg.evaluate(id => Inv.delPurchase(id), await pg.evaluate(() => App.S.purchases[0].id)); await sleep(300);
    await clickModal(pg, 'تأكيد الحذف');
    const back = await pg.evaluate(() => { const x = App.S.books[2]; return [x.qty, App.storeQty(x)]; });
    check('حذفها يخصم من المخزن نفسه: 20 و0 في المخزن', back.join('|') === '20|0', back);
    await pg.close();
  }

  /* ============================================================ */
  console.log('\n[ت] «عمليات التحويل المطلوبة» بالأحمر تحت المخازن');
  {
    const pg = await fresh(d => {
      d.branch = { id: 'misrata', name: 'دار الحكمة — مصراتة', city: 'مصراتة', no: 1 };
      d.remotes = [{ id: 'tripoli', name: 'دار الحكمة — طرابلس', city: 'طرابلس', at: '2026-11-15 10:00',
        items: [{ k: 'K9', t: 'book', n: 'كيمياء عامة', a: 'سالم', b: '9001', c: 'علوم', d: 'دار المعارف', q: 12, p: 75 }],
        msgs: [{ kind: 'req', id: 'r1', from: 'tripoli', to: 'misrata', at: '2026-11-15 10:30', note: 'زبون ينتظر', lines: [{ n: 'فيزياء أساسية', b: '1001', t: 'book', qty: 3 }] }] }];
    }, false);
    await pg.evaluate(() => { location.hash = '#/stock'; App.route(); App.refreshBadges(); }); await sleep(500);
    const st = await pg.evaluate(() => {
      const bd = document.querySelector('.nav-item[data-k="stock"] [data-reqcount]');
      const card = document.getElementById('xferCard');
      const grid = document.querySelector('#view .grid');
      return { badge: bd && !bd.hidden && bd.textContent, red: bd && bd.classList.contains('bad'), card: !!card, hot: card && card.classList.contains('hot'),
        below: card && grid && (grid.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) > 0,
        alert: (document.querySelector('.xfer-alert') || {}).textContent || '', txt: card ? card.textContent : '' };
    });
    check('علامة حمراء على «المخزون والفروع» بعدد الطلبات (1)', st.badge === '1' && st.red, st);
    check('قسم «عمليات التحويل المطلوبة» بالأحمر تحت المخازن', st.card && st.hot && st.below && /عمليات التحويل المطلوبة/.test(st.txt), st);
    check('فيه: من طلب، شنو، قداش، والملاحظة، وقداش عندك', /دار الحكمة — طرابلس يطلب تحويل/.test(st.txt) && /«فيزياء أساسية» × 3/.test(st.txt) && /عندك 20/.test(st.txt) && /زبون ينتظر/.test(st.txt), st.txt);
    check('وشريط أحمر فوق ينزل للقسم', /يطلب تحويل كتاب/.test(st.alert), st.alert);
    await pg.click('#xferCard button:has-text("موافقة وتحويل")'); await sleep(300);
    await clickModal(pg, 'موافقة وشحن'); await sleep(400);
    const ok1 = await pg.evaluate(() => ({ q: App.S.books[0].qty, rep: App.S.outbox.find(m => m.kind === 'rep' && m.ref === 'r1'), card: !!document.getElementById('xferCard') }));
    check('الموافقة: تنقص الكمية 3 وترسل الرد «شُحن»، والقسم يختفي', ok1.q === 17 && ok1.rep && ok1.rep.status === 'shipped' && ok1.rep.to === 'tripoli' && !ok1.card, ok1);

    // طلب من كتب الفرع الثاني، ثم ردّهم بالشحن، ثم الاستلام (الكتاب مش مسجّل هنا ⇦ يتسجّل)
    await pg.evaluate(() => Stock.open('branch', 'tripoli')); await sleep(400);
    await pg.click('#rbBody button:has-text("طلب تحويل")'); await sleep(300);
    await pg.fill('#f_qty', '4'); await clickModal(pg, 'إرسال الطلب'); await sleep(400);
    const rq = await pg.evaluate(() => App.S.outbox.find(m => m.kind === 'req'));
    check('طلب التحويل يحمل السعر والمؤلف والتخصص والناشر', rq && rq.to === 'tripoli' && rq.lines[0].qty === 4 && rq.lines[0].p === 75 && rq.lines[0].a === 'سالم' && rq.lines[0].c === 'علوم' && rq.lines[0].d === 'دار المعارف', rq);
    await pg.evaluate(() => Stock.back()); await sleep(400);
    check('القسم يبيّن «طلبت من … — بانتظار الرد»', await pg.evaluate(() => { const c = document.getElementById('xferCard'); return !!c && !c.classList.contains('hot') && /طلبت من/.test(c.textContent) && /بانتظار الرد/.test(c.textContent); }));
    await pg.evaluate(id => { App.S.remotes[0].msgs.push({ kind: 'rep', id: 'rp1', from: 'tripoli', to: 'misrata', ref: id, status: 'shipped', at: App.nowStamp() }); App.rerender(); }, rq.id); await sleep(400);
    check('ردّهم بالشحن: «وافق وأرسل لك» وزر تأكيد الاستلام', await pg.evaluate(() => /وافق وأرسل لك/.test(document.getElementById('xferCard').textContent) && !!document.querySelector('#xferCard button[onclick*="confirmReceipt"]')));
    await pg.click('#xferCard button:has-text("وصلت — تأكيد الاستلام")'); await sleep(300);
    await clickModal(pg, 'تأكيد الاستلام'); await sleep(400);
    const nb = await pg.evaluate(() => { const x = App.S.books.find(y => y.title === 'كيمياء عامة'); return x && { q: x.qty, st: App.storeQty(x), p: x.price, c: x.cost, a: x.author, b: x.barcode, code: x.code }; });
    check('كتاب وصل وما كانش مسجّل: يتسجّل في غرفة الخزين بسعره (75) وسعر شراء صفر', nb && nb.q === 4 && nb.st === 4 && nb.p === 75 && nb.c === 0 && nb.a === 'سالم' && nb.b === '9001' && /^K/.test(nb.code), nb);
    check('والرسالة «استلمت» راحت لهم', await pg.evaluate(id => !!App.S.outbox.find(m => m.kind === 'rcv' && m.ref === id), rq.id));
    // الرفض
    await pg.evaluate(() => { App.S.remotes[0].msgs.push({ kind: 'req', id: 'r2', from: 'tripoli', to: 'misrata', at: App.nowStamp(), lines: [{ n: 'كتاب عادي', b: '1002', t: 'book', qty: 1 }] }); App.rerender(); }); await sleep(400);
    await pg.click('#xferCard button:has-text("رفض")'); await sleep(300);
    await clickModal(pg, 'رفض الطلب'); await sleep(400);
    check('الرفض: يرسل «مرفوض» والكمية ما تتغيّرش', await pg.evaluate(() => { const r = App.S.outbox.find(m => m.kind === 'rep' && m.ref === 'r2'); return r && r.status === 'rejected' && App.S.books.find(y => y.id === 'b2').qty === 20; }));
    await pg.close();
  }

  await b.close();
  const real = errs.filter(e => !/ResizeObserver/.test(e));
  check('بلا أخطاء في الصفحة', real.length === 0, real.slice(0, 5));
  console.log('\n' + '='.repeat(50) + '\n  نجح: ' + pass + '    فشل: ' + fail + '\n' + '='.repeat(50));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
