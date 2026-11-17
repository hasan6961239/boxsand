/* ============================================================
   test-features.js — المصروفات، تغيير الأسعار الجماعي، بيانات الكتاب من الباركود
   ------------------------------------------------------------
   - المصروفات: الصفحة، «من الدرج» ينطرح من النقد المفروض في الإقفال،
     كل المصروفات تنطرح من الربح، التكرار الشهري مرة واحدة لكل شهر،
     الحذف علامة لا يرجع بعدها التكرار، والتصدير.
   - تغيير الأسعار: دار نشر بنسبة وتقريب، المعاينة، الصفر يبقى صفراً،
     الجملة من خصم الدار، سعر الشراء لا يظهر والأرباح مقفولة، والتراجع.
   - الباركود: «جيب بياناته من الإنترنت» يعبّي العنوان والمؤلف ودار النشر،
     كتاب موجود عندك، رقم ناقص، ولا نتيجة.
   شغّل tools/dev-server.js أولاً، ثم: node tools/test-features.js
   ============================================================ */
'use strict';
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const URL = 'http://127.0.0.1:17845/';
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = process.env.QI_DATA || path.join(__dirname, '..', '.devdata');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const today = ymd(new Date());
const m2 = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 2); return ymd(d).slice(0, 8) + '05'; })();

const seed = () => ({
  meta: { setupDone: true, shopName: 'اختبار', currency: 'د.ل', libraries: ['A'], shelves: 6, uiSize: 'md', theme: 'green' },
  branch: { id: 'misrata', name: 'اختبار', city: 'مصراتة', no: 1 },
  publishers: [{ id: 'p1', name: 'دار الفكر', rate: 0.2 }, { id: 'p2', name: 'دار المعارف', rate: 0.1 }],
  books: [
    { id: 'b1', code: 'K1', title: 'رياض الصالحين', publisher: 'دار الفكر', lib: 'A', shelf: '1', barcode: '1001', cost: 30, price: 45, priceW: 36, qty: 10, min: 1 },
    { id: 'b2', code: 'K2', title: 'الفيزياء للصف الثالث', publisher: 'دار الفكر', lib: 'A', shelf: '1', barcode: '1002', cost: 10, price: 20, priceW: 16, qty: 10, min: 1 },
    { id: 'b3', code: 'K3', title: 'كتاب بلا سعر', publisher: 'دار الفكر', lib: 'A', shelf: '2', barcode: '1003', cost: 0, price: 0, priceW: 0, qty: 3, min: 0 },
    { id: 'b4', code: 'K4', title: 'الأيام', publisher: 'دار المعارف', lib: 'A', shelf: '2', barcode: '1004', cost: 20, price: 60, priceW: 54, qty: 5, min: 0 }
  ],
  stationery: [], customers: [], suppliers: [], invoices: [], payments: [], purchases: [], counters: { invoice: 0, book: 4, stat: 0 }
});

let pass = 0, fail = 0;
const check = (name, ok, got) => {
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          ' + (typeof got === 'string' ? got : JSON.stringify(got))));
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errs = [];
  async function fresh(mod) {
    const d = seed(); if (mod) mod(d);
    fs.writeFileSync(path.join(DATA, 'store.json'), JSON.stringify(d));
    const pg = await b.newPage({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('dialog', x => x.accept().catch(() => { }));
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S && App.S.books && window.Expenses && window.Inv, null, { timeout: 30000 });
    await sleep(500);
    return pg;
  }
  const go = async (pg, hash) => { await pg.evaluate(h => { location.hash = h; App.route(); }, hash); await sleep(350); };
  const fill = async (pg, vals) => {
    for (const [k, v] of Object.entries(vals)) {
      const sel = '#f_' + k;
      if (await pg.$eval(sel, e => e.tagName) === 'SELECT') await pg.selectOption(sel, String(v));
      else await pg.fill(sel, String(v));
    }
  };
  const save = async pg => { await pg.click('.modal .m-foot .btn.primary'); await sleep(300); };

  try {
    console.log('\n== المصروفات: الصفحة والإضافة ==');
    let pg = await fresh();
    await go(pg, '#/expenses');
    check('صفحة «المصروفات» في القائمة الجانبية وتفتح', await pg.evaluate(() => !!document.querySelector('a[href="#/expenses"], [data-k="expenses"]') || /المصروفات/.test(document.getElementById('nav') ? document.getElementById('nav').textContent : document.body.textContent)));
    check('بلا مصروفات: «لا مصروفات هذا الشهر»', /لا مصروفات هذا الشهر/.test(await pg.textContent('#view')));
    await pg.evaluate(() => Expenses.edit()); await sleep(300);
    check('نافذة «مصروف جديد» فيها البند والمبلغ والتاريخ ومن أين دُفع والتكرار',
      await pg.evaluate(() => ['cat', 'amount', 'date', 'from', 'note', 'monthly'].every(k => document.getElementById('f_' + k))));
    await fill(pg, { cat: 'كهرباء', amount: '45', note: 'فاتورة الكهرباء' });
    await save(pg);
    await pg.evaluate(() => Expenses.edit()); await sleep(300);
    await fill(pg, { cat: 'رواتب', amount: '600', from: 'out', note: 'راتب البائع' });
    await save(pg);
    let ex = await pg.evaluate(() => App.S.expenses.map(e => ({ c: e.cat, a: e.amount, f: e.from, d: e.date })));
    check('مصروفان محفوظان (من الدرج ومن خارجه) بتاريخ اليوم', ex.length === 2 && ex[0].f === 'drawer' && ex[1].f === 'out' && ex.every(e => e.d === today), ex);
    const kpi = await pg.$$eval('#view .stat .val', e => e.map(x => x.textContent.trim()));
    check('أرقام الصفحة: اليوم 645، الشهر 645، منها من الدرج 45', kpi[0].replace(/,/g, '') === '645.00' && kpi[1].replace(/,/g, '') === '645.00' && kpi[2] === '45.00', kpi);
    check('صافي ربح الشهر مقفول والأرباح مقفولة', /🔒/.test(kpi[3] || ''), kpi[3]);
    check('الجدول: «من الدرج» و«من خارج الدرج»', await pg.evaluate(() => /من الدرج/.test(document.getElementById('view').textContent) && /من خارج الدرج/.test(document.getElementById('view').textContent)));
    check('«حسب البند»: رواتب أولاً ثم كهرباء', await pg.evaluate(() => [...document.querySelectorAll('.exp-cat span')].map(s => s.textContent).join('|')) === 'رواتب|كهرباء');

    console.log('\n== المصروفات في الإقفال والأرباح ==');
    await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(400);
    await pg.evaluate(() => { Sales.add('book', 'b1'); Sales.setQty(Sales.__cartLen() - 1, 1); });
    await pg.evaluate(() => Sales.complete()); await sleep(300);
    await pg.evaluate(() => Sales.pick('cash')); await sleep(400);
    const nInv = await pg.evaluate(() => App.S.invoices.length);
    check('بيعة نقدية واحدة (45)', nInv === 1, nInv);
    await go(pg, '#/stocktake');
    await pg.evaluate(() => { const b2 = [...document.querySelectorAll('button')].find(x => /جرد المبيعات/.test(x.textContent)); if (b2) b2.click(); }); await sleep(300);
    const exp = await pg.evaluate(() => { const l = [...document.querySelectorAll('label')].find(x => x.textContent === 'النقد المفروض'); return l ? l.parentNode.querySelector('input').value : null; });
    check('إقفال اليوم: النقد المفروض = 45 بيع − 45 كهرباء من الدرج = 0 (الرواتب من خارج الدرج لا تنطرح)', exp !== null && Number(String(exp).replace(/,/g, '')) === 0, exp);
    check('وبطاقة «نقداً في الصندوق» تقول «مصروفات من الدرج 45»', /مصروفات من الدرج 45/.test(await pg.textContent('#view')));
    await pg.evaluate(() => App.unlockProfit('Rtv8ss3i')); await sleep(300);
    await go(pg, '#/profits');
    const net = await pg.evaluate(() => { const h = [...document.querySelectorAll('.card-head h3')].find(x => x.textContent === 'صافي الربح بعد المصروفات'); if (!h) return null; return [...h.closest('.card').querySelectorAll('.stat .val')].map(v => v.textContent.trim()); });
    const prof = await pg.evaluate(() => App.S.invoices[0].profit);
    check('«صافي الربح بعد المصروفات»: ربح اليوم ' + prof + ' − 645', net && Number(net[0].replace(/,/g, '')) === prof - 645, { net, prof });
    await go(pg, '#/expenses');
    const k4 = await pg.$$eval('#view .stat .val', e => e.map(x => x.textContent.trim()));
    check('صافي ربح الشهر في صفحة المصروفات (الأرباح مفتوحة) = الربح − 645', Number(k4[3].replace(/,/g, '')) === prof - 645, k4[3]);

    console.log('\n== التكرار الشهري والحذف ==');
    await pg.evaluate(d => { App.S.expenses.push({ id: 'rent1', date: d, cat: 'إيجار', amount: 1500, from: 'out', note: 'إيجار المحل', monthly: true, at: d + ' 09:00:00' }); App.save(); }, m2);
    await go(pg, '#/dash'); await go(pg, '#/expenses');
    let rent = await pg.evaluate(() => App.S.expenses.filter(e => e.id === 'rent1' || e.rec === 'rent1').map(e => e.id + ':' + e.date));
    const wantN = new Date().getDate() >= 5 ? 3 : 2;
    check('إيجار «كل شهر» من شهرين: نسخة في كل شهر بعده حتى اليوم (' + wantN + ')', rent.length === wantN, rent);
    await pg.evaluate(() => Expenses.recur()); await go(pg, '#/dash'); await go(pg, '#/expenses');
    const rent2 = await pg.evaluate(() => App.S.expenses.filter(e => e.id === 'rent1' || e.rec === 'rent1').length);
    check('فتح الصفحة مرة ثانية لا يكرّرها', rent2 === wantN, rent2);
    check('«كل شهر» ظاهرة على الإيجار', await pg.evaluate(() => /كل شهر/.test(document.getElementById('view').textContent)) || wantN === 2);
    const copyId = await pg.evaluate(() => (App.S.expenses.filter(e => e.rec === 'rent1')[0] || {}).id);
    await pg.evaluate(id => Expenses.del(id), copyId); await sleep(250);
    await pg.click('.modal .m-foot .btn.danger'); await sleep(300);
    await pg.evaluate(() => Expenses.recur());
    const after = await pg.evaluate(id => ({ del: (App.S.expenses.find(e => e.id === id) || {}).del, n: App.S.expenses.filter(e => e.rec === 'rent1' && !e.del).length }), copyId);
    check('حذف نسخة شهر: علامة حذف، ولا ترجع وحدها بعد التكرار', after.del === true && after.n === wantN - 2, after);
    const dl = pg.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await pg.evaluate(() => Expenses.exportXls());
    const file = await dl;
    const xtxt = file ? fs.readFileSync(await file.path(), 'utf8') : '';
    check('«تصدير Excel» ينزّل جدول المصروفات (البنود والمبالغ)', /المصروفات/.test(xtxt) && /كهرباء/.test(xtxt) && /رواتب/.test(xtxt) && /إيجار/.test(xtxt), xtxt.slice(0, 200));
    await pg.close();

    console.log('\n== تغيير أسعار جماعي ==');
    pg = await fresh();
    await go(pg, '#/purchases');
    await pg.evaluate(() => { if (Inv.gset) { try { Inv.gset('mode', 'view'); } catch (e) { } } });
    await sleep(300);
    check('زر «٪ تغيير أسعار جماعي» في عرض الكتب', await pg.evaluate(() => !!Inv.bulkPrice));
    await pg.evaluate(() => { Inv.bpSet('type', 'book'); Inv.bulkPrice(); }); await sleep(300);
    await pg.selectOption('#bpBody select', 'pub'); await sleep(200);
    const pubOpts = await pg.$$eval('#bpBody select:nth-of-type(2) option', o => o.map(x => x.textContent));
    check('اختيار دار النشر بعدد كتبها', pubOpts.some(t => /دار الفكر \(3/.test(t)), pubOpts);
    await pg.evaluate(() => Inv.bpSet('val', 'دار الفكر')); await sleep(200);
    const sum1 = await pg.textContent('.bp-sum');
    check('المعاينة: «سيتغيّر سعر 2 كتاب» والصفري (1) لا يتغيّر', /سيتغيّر سعر 2 كتاب/.test(sum1) && /\(1\)/.test(sum1), sum1);
    const prev = await pg.$$eval('.bp-tbl tbody tr', r => r.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
    check('الجدول: 45 ← 49.50 (+4.50)، 20 ← 22.00، وكتاب بلا سعر «يبقى صفر»', prev.some(t => /45\.00/.test(t) && /49\.50/.test(t) && /\+4\.50/.test(t)) && prev.some(t => /20\.00/.test(t) && /22\.00/.test(t)) && prev.some(t => /يبقى صفر/.test(t)), prev);
    check('سعر الشراء لا يظهر والأرباح مقفولة', !(await pg.evaluate(() => /سعر الشراء/.test(document.getElementById('bpBody').textContent))));
    check('زر التطبيق يقول العدد: «طبّق على 2 كتاب»', await pg.evaluate(() => [...document.querySelectorAll('.modal .m-foot .btn.primary')].some(x => /طبّق على 2 كتاب/.test(x.textContent))));
    await pg.click('.modal .m-foot .btn.primary'); await sleep(400);
    let bk = await pg.evaluate(() => App.S.books.map(x => [x.id, x.price, x.priceW]));
    check('طُبّق: 49.5 و22، والصفري بقي 0، ودار المعارف لم تتغيّر', bk[0][1] === 49.5 && bk[1][1] === 22 && bk[2][1] === 0 && bk[3][1] === 60, bk);
    check('والجملة من خصم دار الفكر (20%): 39.6 و17.6', bk[0][2] === 39.6 && bk[1][2] === 17.6, bk);
    check('سُجّل في السجلات', await pg.evaluate(() => (App.S.log || []).some(l => l.action === 'تغيير أسعار جماعي')));
    await go(pg, '#/purchases');
    check('زر «↶ تراجع عن آخر تغيير أسعار» ظاهر', await pg.evaluate(() => /تراجع عن آخر تغيير أسعار/.test(document.getElementById('view').textContent)));
    await pg.evaluate(() => Inv.bpUndoLast()); await sleep(250);
    await pg.click('.modal .m-foot .btn.primary'); await sleep(300);
    bk = await pg.evaluate(() => App.S.books.map(x => [x.id, x.price, x.priceW]));
    check('التراجع رجّع الأسعار والجملة كما كانت', bk[0][1] === 45 && bk[1][1] === 20 && bk[0][2] === 36 && bk[1][2] === 16, bk);
    await pg.evaluate(() => { App.unlockProfit('Rtv8ss3i'); }); await sleep(200);
    await pg.evaluate(() => { Inv.bpSet('scope', 'all'); Inv.bpSet('price', false); Inv.bpSet('cost', true); Inv.bpSet('mode', 'amt+'); Inv.bpSet('amount', '5'); Inv.bpSet('round', '0'); Inv.bulkPrice(); }); await sleep(300);
    check('والأرباح مفتوحة: «سعر الشراء» يظهر', await pg.evaluate(() => /سعر الشراء/.test(document.getElementById('bpBody').textContent)));
    const sumC = await pg.textContent('.bp-sum');
    check('سعر الشراء +5 لكل الكتب ما عدا اللي شراءه صفر: 3 كتب', /سيتغيّر سعر 3 كتاب/.test(sumC), sumC);
    await pg.evaluate(() => App.closeTop());
    await pg.close();

    console.log('\n== بيانات الكتاب من الباركود ==');
    if (process.env.QI_X3) {
      /* على البرنامج الحقيقي يسأل الإنترنت نفسه: الردود الثابتة في خادم التطوير وحده */
      console.log('  SKIP  بيانات الكتاب من الباركود (على خادم التطوير بردود ثابتة)');
      check('بلا أخطاء JavaScript', errs.length === 0, errs.slice(0, 5));
      throw 'done';
    }
    pg = await fresh();
    await pg.evaluate(() => Inv.editBook()); await sleep(400);
    check('نافذة «كتاب جديد» فيها «امسح باركود الكتاب أولاً» و«جيب بياناته من الإنترنت»', await pg.evaluate(() => !!document.getElementById('isbnQ') && /جيب بياناته من الإنترنت/.test(document.getElementById('isbnGo').textContent)));
    await pg.fill('#isbnQ', '12345'); await pg.click('#isbnGo'); await sleep(200);
    check('رقم ناقص: «لازم يكون 13 رقم»', /13 رقم/.test(await pg.textContent('#isbnRes')));
    await pg.fill('#isbnQ', '1001'); await pg.click('#isbnGo'); await sleep(200);
    check('رقم قصير لا يُبحث ولو كان باركود كتاب عندك', /13 رقم/.test(await pg.textContent('#isbnRes')));
    await pg.evaluate(() => { App.S.books[0].barcode = '9789953000555'; });
    await pg.fill('#isbnQ', '9789953000555'); await pg.click('#isbnGo'); await sleep(200);
    check('باركود كتاب عندك: «الكتاب هذا موجود عندك» وزر «افتحه»', /موجود عندك/.test(await pg.textContent('#isbnRes')) && /افتحه/.test(await pg.textContent('#isbnRes')));
    await pg.fill('#isbnQ', '9780000000000'); await pg.press('#isbnQ', 'Enter'); await sleep(500);
    check('لا نتيجة: «ما لقيناش الكتاب»، والباركود تعبّى', /ما لقيناش/.test(await pg.textContent('#isbnRes')) && await pg.inputValue('#f_barcode') === '9780000000000');
    await pg.fill('#isbnQ', '9789953000999'); await pg.click('#isbnGo');
    await pg.waitForFunction(() => /الإنترنت/.test(document.getElementById('isbnRes').textContent), null, { timeout: 5000 }).catch(() => { });
    check('بلا إنترنت: رسالة واضحة', /الإنترنت/.test(await pg.textContent('#isbnRes')), await pg.textContent('#isbnRes'));
    await pg.fill('#isbnQ', '٩٧٨٩٩٥٣٠٠٠١٢٣'); await pg.press('#isbnQ', 'Enter');
    await pg.waitForFunction(() => /لقينا الكتاب/.test(document.getElementById('isbnRes').textContent), null, { timeout: 5000 });
    const card = await pg.textContent('#isbnRes');
    check('لقيناه (حتى بأرقام عربية): العنوان والمؤلف ودار النشر «موجودة عندك» والمصدر', /الرياضيات المتقدمة/.test(card) && /سالم الهادي/.test(card) && /موجودة عندك/.test(card) && /Google Books/.test(card) && /248 صفحة/.test(card), card);
    await pg.click('#isbnRes .btn.primary'); await sleep(250);
    const filled = await pg.evaluate(() => ({ t: document.getElementById('f_title').value, a: document.getElementById('f_author').value, p: document.getElementById('f_publisher').value, b: document.getElementById('f_barcode').value }));
    check('«استعمل البيانات»: العنوان والمؤلف ودار النشر والباركود في خاناتها', filled.t === 'الرياضيات المتقدمة للمرحلة الثانوية' && filled.a === 'د. سالم الهادي' && filled.p === 'دار الفكر' && filled.b === '9789953000123', filled);
    check('والتنبيه «راجعها واكتب السعر»', /اكتب السعر/.test(await pg.textContent('#isbnRes')));
    await pg.fill('#f_price', '25'); await save(pg); await sleep(400);
    const nb = await pg.evaluate(() => App.S.books.find(x => x.barcode === '9789953000123'));
    check('الكتاب تسجّل ببياناته والسعر اللي كتبته، والجملة من خصم الدار', nb && nb.title === 'الرياضيات المتقدمة للمرحلة الثانوية' && nb.publisher === 'دار الفكر' && nb.price === 25 && nb.priceW === 20, nb);
    await pg.close();

    check('بلا أخطاء JavaScript', errs.length === 0, errs.slice(0, 5));
  } catch (e) {
    if (e !== 'done') {
      fail++;
      console.log('  FAIL  توقف: ' + (e && e.stack || e));
    }
  } finally {
    await b.close();
  }
  console.log('\n' + '='.repeat(50) + '\n  نجح: ' + pass + '    فشل: ' + fail + '\n' + '='.repeat(50));
  process.exit(fail ? 1 : 0);
})();
