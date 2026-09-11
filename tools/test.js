/* اختبار تراجع: كل خلل وُجد في المراجعة له حالة هنا.
   شغّل tools/dev-server.js أولاً، ثم: node tools/test.js */
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const URL = 'http://127.0.0.1:17845/';
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = path.join(__dirname, '..', '.devdata');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  (ok ? pass++ : fail++);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '\n          ' + detail : ''));
}

const seed = () => ({
  meta: { setupDone: true, shopName: 'مكتبة النور', currency: 'د.ل', libraries: ['A','B','C'], shelves: 6, uiSize: 'lg', theme: 'green' },
  branch: { id: 'misrata', name: 'مكتبة النور', city: 'مصراتة', no: 1 },
  books: [{ id: 'b1', code: 'K0001', title: 'كتاب الرياضيات', lib: 'A', shelf: '1', barcode: '111', cost: 10, price: 15, priceW: 13, qty: 20, min: 3 }],
  stationery: [{ id: 's1', code: 'Q0001', name: 'قلم جاف', cat: 'أقلام', unit: 'قطعة', barcode: '222', cost: 0.5, price: 1, qty: 100, min: 10 }],
  customers: [{ id: 'c1', name: 'محمد علي', phone: '091', balance: 0 }],
  invoices: [], payments: [], counters: { invoice: 0, book: 1, stat: 1 }
});
const writeStore = o => fs.writeFileSync(path.join(DATA, 'store.json'), JSON.stringify(o));

(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errs = [];
  /* إغلاق كإغلاق المستخدم: يشغّل beforeunload فيحرّر قفل النافذة */
  const closePage = async (p) => { await p.close({ runBeforeUnload: true }); await sleep(400); };

  const open = async () => {
    const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
    pg.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S, null, { timeout: 30000 });
    await sleep(600);
    return pg;
  };

  console.log('\n== 1. الأرقام العربية والفاصلة العشرية ==');
  writeStore(seed());
  let pg = await open();
  const n = await pg.evaluate(() => ({
    ar: App.num('١٢٣'), fa: App.num('۱۲۳'), arDec: App.num('٠٫٥'),
    comma: App.num('1,5'), thousands: App.num('1,500'), plain: App.num('1.5'),
    hasNum: App.hasNumber('١٥'), noNum: App.hasNumber('غير معروف')
  }));
  check('١٢٣ → 123', n.ar === 123, 'got ' + n.ar);
  check('۱۲۳ (فارسية) → 123', n.fa === 123, 'got ' + n.fa);
  check('٠٫٥ → 0.5', n.arDec === 0.5, 'got ' + n.arDec);
  check('1,5 → 1.5', n.comma === 1.5, 'got ' + n.comma);
  check('1,500 → 1500', n.thousands === 1500, 'got ' + n.thousands);
  check('1.5 يبقى 1.5', n.plain === 1.5, 'got ' + n.plain);
  check('hasNumber يميّز النص بلا رقم', n.hasNum === true && n.noNum === false);

  console.log('\n== 2. خانة السعر تقبل الأرقام العربية ==');
  await pg.evaluate(() => { location.hash = '#/purchases'; App.route(); }); await sleep(500);
  await pg.click('button:has-text("+ كتاب جديد")'); await sleep(500);
  await pg.click('#f_price'); await pg.keyboard.type('١٥');
  const typed = await pg.$eval('#f_price', e => e.value);
  await pg.evaluate(() => document.getElementById('f_price').blur()); await sleep(200);
  const after = await pg.$eval('#f_price', e => e.value);
  check('كتابة ١٥ في خانة السعر تُقبل', typed.length > 0, 'field value: "' + typed + '"');
  check('وتتحوّل إلى 15 عند الخروج', after === '15', 'got "' + after + '"');
  await pg.keyboard.press('Escape'); await sleep(300);

  console.log('\n== 3. الخصم الأكبر من المجموع ==');
  await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(500);
  await pg.fill('#scan', '111'); await sleep(300); await pg.keyboard.press('Enter'); await sleep(400);
  await pg.evaluate(() => { Sales.setQty(0, 2); Sales.setDiscount(500); }); await sleep(300);
  await pg.click('button:has-text("إتمام البيع")'); await sleep(500);
  await pg.click('button:has-text("نقداً")'); await sleep(1500);
  const inv = await pg.evaluate(() => App.S.invoices[0]);
  check('الخصم مقصوص عند المجموع', inv.discount === 30, 'discount=' + inv.discount);
  check('الصافي صفر لا سالب', inv.total === 0, 'total=' + inv.total);
  /* خصم 500 كان يسجّل ربحاً بـ‎−490‎ — رقم وهمي لأن الخصم لم يُطبَّق أصلاً.
     الآن الخصم 30 (كامل المجموع) والربح ‎−20‎ = ثمن ما خرج من المخزون.
     خسارة حقيقية لبضاعة أُعطيت مجاناً، لا رقم مخترع. */
  check('الربح = خسارة التكلفة الفعلية فقط (‎−20‎ لا ‎−490‎)', inv.profit === -20, 'profit=' + inv.profit);

  console.log('\n== 4. الكميات الكسرية ==');
  await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(500);
  await pg.fill('#scan', '222'); await sleep(300); await pg.keyboard.press('Enter'); await sleep(400);
  const q = await pg.evaluate(() => { Sales.setQty(0, 2.5); return App.S ? document.querySelector('.qty-box input').value : null; });
  check('2.5 قلم تُقرّب إلى 3', q === '3', 'got ' + q);
  await pg.evaluate(() => Sales.clear ? Sales.clear() : null); await sleep(300);

  console.log('\n== 5. صفحة الفواتير مع بيانات سنة ==');
  const big = seed();
  let k = 0;
  for (let d = 0; d < 365; d++) {
    const dt = new Date(2025, 8, 1 + d).toISOString().slice(0, 10);
    for (let i = 0; i < 60; i++) {
      k++;
      big.invoices.push({ id: 'i' + k, no: k, kind: 'sale', date: dt, at: dt + ' 12:00',
        items: [{ type: 'book', id: 'b1', name: 'كتاب الرياضيات', qty: 2, price: 15, cost: 10 }],
        subtotal: 30, discount: 0, total: 30, profit: 10, method: 'cash', mode: 'retail', customerId: '', paid: 30, due: 0 });
    }
  }
  big.counters.invoice = k;
  await closePage(pg); writeStore(big); pg = await open();
  const perf = await pg.evaluate(async () => {
    const t0 = performance.now();
    location.hash = '#/invoices'; App.route();
    await new Promise(r => setTimeout(r, 0));
    const build = performance.now() - t0;
    return { buildMs: Math.round(build), rows: document.querySelectorAll('#invList tbody tr').length,
      nodes: document.getElementById('invList').getElementsByTagName('*').length, total: App.S.invoices.length };
  });
  check('كل الفواتير ما زالت في البيانات', perf.total === 21900, 'invoices=' + perf.total);
  check('الصفحة ترسم 200 صفاً لا 21,900', perf.rows <= 200, 'rows=' + perf.rows);
  check('البناء أقل من ثانيتين (كان 73 ثانية)', perf.buildMs < 2000, perf.buildMs + 'ms, ' + perf.nodes + ' nodes');

  console.log('\n== 6. نافذتان مفتوحتان ==');
  writeStore(seed());
  await closePage(pg);
  const A = await open(); const B = await open();
  const roA = await A.evaluate(() => App.isReadOnly());
  const roB = await B.evaluate(() => App.isReadOnly());
  check('النافذة الأولى تملك حق الكتابة', roA === false);
  check('النافذة الثانية للعرض فقط', roB === true, 'reason: ' + await B.evaluate(() => App.readOnlyReason()));
  check('شريط التحذير ظاهر في الثانية', await B.$eval('#blockBar', e => e.className === 'block-bar').catch(() => false));
  // A sells, B tries to save its stale state
  await A.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(500);
  await A.fill('#scan', '111'); await sleep(300); await A.keyboard.press('Enter'); await sleep(400);
  await A.click('button:has-text("إتمام البيع")'); await sleep(500);
  await A.click('button:has-text("نقداً")'); await sleep(1500);
  await B.evaluate(() => { App.S.customers.push({ id: 'x1', name: 'زبون من النافذة الثانية', balance: 0 }); App.saveNow(); });
  await sleep(1500);
  const disk = await A.evaluate(() => App.api('/api/load').then(r => r.json()));
  check('بيع النافذة الأولى محفوظ', disk.invoices.length === 1, 'invoices=' + disk.invoices.length);
  check('النافذة الثانية لم تدهسه', disk.books[0].qty === 19, 'book qty=' + disk.books[0].qty);
  await closePage(B);

  console.log('\n== 7. ملف بيانات تالف ==');
  await closePage(A);
  const good = fs.readFileSync(path.join(DATA, 'store.json'));
  fs.writeFileSync(path.join(DATA, 'store.json'), good.slice(0, Math.floor(good.length / 2)));
  pg = await open();
  const corrupt = await pg.evaluate(() => ({ ro: App.isReadOnly(), why: App.readOnlyReason(), wizard: !!document.querySelector('#modalHost .modal') }));
  check('المنظومة تعلن أن الملف تالف', corrupt.ro === true && corrupt.why.indexOf('تالف') >= 0, corrupt.why);
  check('لا تعرض معالج "أهلاً بك" كأنها جديدة', corrupt.wizard === false);
  await pg.evaluate(() => { App.S.books.push({ id: 'zz', title: 'محاولة كتابة' }); App.saveNow(); }); await sleep(1200);
  const sizeAfter = fs.statSync(path.join(DATA, 'store.json')).size;
  check('لم يُكتب فوق الملف التالف', sizeAfter === Math.floor(good.length / 2), 'size=' + sizeAfter);

  console.log('\n== 8. حارس الـAPI (CSRF) ==');
  const evil = require('http').createServer((q, s) => {
    s.writeHead(200, { 'Content-Type': 'text/html' });
    s.end(`<!doctype html><meta charset=utf-8><script>
      fetch('http://127.0.0.1:17845/api/save',{method:'POST',mode:'no-cors',
        headers:{'Content-Type':'text/plain'},body:JSON.stringify({meta:{shopName:"HACKED"},books:[],invoices:[]})});
      fetch('http://127.0.0.1:17845/api/uninstall',{method:'POST',mode:'no-cors',body:'{}'});
    </script>`);
  }).listen(8099);
  writeStore(seed());
  await closePage(pg);
  const victim = await b.newPage();
  await victim.goto('http://localhost:8099/', { waitUntil: 'networkidle' });
  await sleep(2000);
  const stillOk = JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'));
  check('صفحة خارجية لا تستطيع مسح البيانات', stillOk.meta.shopName === 'مكتبة النور', 'shopName=' + stillOk.meta.shopName);
  check('والأصناف باقية', stillOk.books.length === 1, 'books=' + stillOk.books.length);
  await victim.close(); evil.close();

  console.log('\n== 9. رمز الأرباح ==');
  writeStore(seed());
  pg = await open();
  const leak = await pg.evaluate(() => App.api('/api/load').then(r => r.json()).then(d => d.meta.profitCode));
  check('الرمز لا يظهر في /api/load', !leak, 'got: ' + leak);
  const unlock = await pg.evaluate(() => App.unlockProfit('Rtv8ss3i'));
  const wrong = await pg.evaluate(() => App.unlockProfit('غلط'));
  check('الرمز الصحيح يفتح الأرباح', unlock === true);
  check('الرمز الخاطئ يُرفض', wrong === false);

  console.log('\n== 9ب. ترحيل رمز أرباح من نسخة قديمة ==');
  {
    fs.rmSync(path.join(DATA, 'profit.hash'), { force: true });
    const old = seed(); old.meta.profitCode = 'رمزي-القديم-99';   // كما كان يُخزَّن في 2.1
    await closePage(pg); writeStore(old); pg = await open();
    await sleep(1500);
    const migrated = await pg.evaluate(() => App.unlockProfit('رمزي-القديم-99'));
    const defaultGone = await pg.evaluate(() => App.unlockProfit('Rtv8ss3i'));
    const cleaned = await pg.evaluate(() => App.api('/api/load').then(r => r.json()).then(d => d.meta.profitCode));
    check('الرمز القديم ما زال يعمل بعد الترقية', migrated === true);
    check('والرمز الافتراضي لم يعد يفتح', defaultGone === false);
    check('ولم يعد مخزّناً في store.json', !cleaned, 'got: ' + cleaned);
  }

  console.log('\n== 10. الإشعار اليومي لا يحمل الربح ==');
  const notif = await pg.evaluate(() => {
    const c = App.S.notify; c.enabled = true; c.topic = 'test-topic'; c.dailyHour = 0;
    c.lastDaily = ''; c.kinds.daily = true; c.dailyProfit = false;
    App.S.invoices = [{ id: 'i1', no: 1, kind: 'sale', date: App.today(), at: App.today() + ' 10:00',
      items: [], subtotal: 100, discount: 0, total: 100, profit: 40, method: 'cash', paid: 100, due: 0 }];
    let sent = null;
    const real = window.fetch;
    window.fetch = function (u, o) { if (String(u).indexOf('/api/notify') >= 0) sent = o.body; return real.apply(this, arguments); };
    Notify.maybeDaily();
    return new Promise(r => setTimeout(() => { window.fetch = real; r(sent); }, 600));
  });
  check('الملخص اليومي يُرسل', !!notif);
  check('ولا يحتوي كلمة "الربح"', notif && notif.indexOf('الربح') < 0, notif ? notif.slice(0, 160) : '');

  console.log('\n== 11. سلامة التطبيق عموماً ==');
  writeStore(seed());
  await closePage(pg); pg = await open();
  for (const k of ['dash','pos','invoices','stocktake','stock','purchases','alerts','customers','consign','suppliers','profits','notify','settings']) {
    await pg.evaluate(x => { location.hash = '#/' + x; App.route(); }, k); await sleep(300);
  }
  check('13 شاشة بلا خطأ JavaScript', errs.length === 0, errs.slice(0, 4).join(' | '));

  await b.close();
  console.log('\n' + '='.repeat(50));
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('='.repeat(50) + '\n');
  process.exit(fail ? 1 : 0);
})();
