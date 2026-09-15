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
    await pg.waitForFunction(() => window.App && App.S && window.Stale && window.Labels, null, { timeout: 30000 });
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
  fs.rmSync(path.join(DATA, 'profit.hash'), { force: true });   // ابدأ من الرمز الافتراضي
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

  console.log('\n== 11. أرشفة الفواتير ==');
  {
    fs.rmSync(path.join(DATA, 'archive'), { recursive: true, force: true });
    const mixed = seed();
    for (let i = 1; i <= 500; i++) mixed.invoices.push({ id: 'o' + i, no: i, kind: 'sale', date: '2025-03-14',
      at: '2025-03-14 10:00', items: [], subtotal: 20, discount: 0, total: 20, profit: 5, method: 'cash', paid: 20, due: 0 });
    for (let i = 1; i <= 20; i++) mixed.invoices.push({ id: 'n' + i, no: 500 + i, kind: 'sale', date: '2026-09-01',
      at: '2026-09-01 10:00', items: [], subtotal: 30, discount: 0, total: 30, profit: 9, method: 'cash', paid: 30, due: 0 });
    await closePage(pg); writeStore(mixed); pg = await open();

    const before = await pg.evaluate(() => App.S.invoices.length);
    await pg.evaluate(() => { location.hash = '#/settings'; App.route(); }); await sleep(700);
    const hasBtn = await pg.$$eval('#view button', e => e.some(x => x.textContent.includes('أرشف سنة 2025')));
    check('زر أرشفة السنة الماضية ظاهر', hasBtn);

    await pg.evaluate(() => Rep.doArchive('2025')); await sleep(600);
    await pg.click('#modalHost button:has-text("أرشف سنة 2025")'); await sleep(2500);

    const after = await pg.evaluate(() => App.S.invoices.length);
    const archived = fs.existsSync(path.join(DATA, 'archive', 'invoices-2025.json'))
      ? JSON.parse(fs.readFileSync(path.join(DATA, 'archive', 'invoices-2025.json'), 'utf8')) : null;
    const onDisk = JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'));
    check('فواتير السنة الماضية خرجت من الملف', before === 520 && after === 20, before + ' → ' + after);
    check('وحُفظت كلها في الأرشيف', archived && archived.length === 500, 'archived=' + (archived ? archived.length : 0));
    check('والقرص يوافق الذاكرة', onDisk.invoices.length === 20, 'disk=' + onDisk.invoices.length);
    check('فواتير هذه السنة لم تُمس', onDisk.invoices.every(v => v.date.slice(0, 4) === '2026'));

    const read = await pg.evaluate(() => App.api('/api/archive-read?year=2025').then(r => r.json()));
    check('يمكن قراءة الأرشيف لاحقاً', Array.isArray(read) && read.length === 500, 'read=' + (Array.isArray(read) ? read.length : 'err'));
    const bad = await pg.evaluate(() => App.api('/api/archive-read?year=../../etc').then(r => r.json()));
    check('سنة غير صالحة تُرفض', bad && bad.ok === false);
  }

  console.log('\n== 12. البضاعة الراكدة ==');
  {
    const ago = d => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
    const st = seed();
    st.books = [
      { id: 'h1', code: 'K1', title: 'كتاب يتحرّك', lib: 'A', shelf: '1', barcode: '9781111111111', cost: 10, price: 15, qty: 5, min: 2, created: ago(400), lastSold: ago(3), soldTotal: 40 },
      { id: 'h2', code: 'K2', title: 'أساسيات الهندسة لتقنيات الورش الميكانيكية', lib: 'D', shelf: '1', barcode: 'K2', cost: 40, price: 60, qty: 8, min: 1, created: ago(500), lastSold: ago(200), soldTotal: 2 },
      { id: 'h3', code: 'K3', title: 'لم يُبَع قط', lib: 'D', shelf: '2', barcode: '', cost: 25, price: 35, qty: 10, min: 1, created: ago(300), soldTotal: 0 },
      { id: 'h4', code: 'K4', title: 'نفدت كميته', lib: 'A', shelf: '2', barcode: '', cost: 30, price: 45, qty: 0, min: 1, created: ago(400), soldTotal: 1 }
    ];
    st.stationery = [{ id: 'q1', code: 'Q1', name: 'قلم راكد', cat: 'أقلام', unit: 'قطعة', barcode: 'Q1', cost: 2, price: 4, qty: 50, min: 5, created: ago(400), lastSold: ago(150), soldTotal: 3 }];
    await closePage(pg); writeStore(st); pg = await open();

    const r = await pg.evaluate(() => Stale.rows().map(x => ({ id: x.it.id, idle: x.idle, never: x.never, frozen: x.frozen })));
    const ids = r.map(x => x.id);
    check('الراكد يلتقط الكتاب البطيء', ids.indexOf('h2') >= 0);
    check('ويلتقط ما لم يُبَع قط', ids.indexOf('h3') >= 0 && r.find(x => x.id === 'h3').never === true);
    check('ويستثني ما يتحرّك', ids.indexOf('h1') < 0);
    check('ويستثني ما نفدت كميته', ids.indexOf('h4') < 0, 'ids=' + ids.join(','));
    check('المال المجمّد = كمية × سعر الشراء', r.find(x => x.id === 'h2').frozen === 320);
    check('الإجمالي صحيح', await pg.evaluate(() => Stale.frozenTotal()) === 670);

    // المدة قابلة للضبط لكل نوع
    await pg.evaluate(() => { App.S.meta.stale.bookDays = 250; App.save(); }); await sleep(400);
    const r2 = await pg.evaluate(() => Stale.rows().map(x => x.it.id));
    check('رفع مدة الكتب يُخرج الكتاب الأقل ركوداً', r2.indexOf('h2') < 0 && r2.indexOf('h3') >= 0, 'ids=' + r2.join(','));

    // الاستثناء اليدوي
    await pg.evaluate(() => Stale.ignore('h3')); await sleep(500);
    check('التجاهل يُخرج الصنف', (await pg.evaluate(() => Stale.rows().map(x => x.it.id))).indexOf('h3') < 0);
    await pg.evaluate(() => Stale.clearIgnored()); await sleep(400);
    check('وإلغاء التجاهل يعيده', (await pg.evaluate(() => Stale.rows().map(x => x.it.id))).indexOf('h3') >= 0);

    // آخر بيع يُسجَّل على الصنف عند البيع، فينجو من أرشفة الفواتير
    await pg.evaluate(() => { App.S.meta.stale.bookDays = 120; App.save(); }); await sleep(300);
    await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(500);
    await pg.fill('#scan', 'K2'); await sleep(300); await pg.keyboard.press('Enter'); await sleep(400);
    await pg.click('button:has-text("إتمام البيع")'); await sleep(500);
    await pg.click('button:has-text("نقداً")'); await sleep(1400);
    const sold = await pg.evaluate(() => { const b = App.S.books.find(x => x.id === 'h2'); return { last: b.lastSold, total: b.soldTotal }; });
    check('البيع يحدّث آخر بيع على الصنف', sold.last === new Date().toISOString().slice(0, 10), 'lastSold=' + sold.last);
    check('ويزيد إجمالي المبيع', sold.total === 3, 'soldTotal=' + sold.total);
    check('فيخرج من الراكد فوراً', (await pg.evaluate(() => Stale.rows().map(x => x.it.id))).indexOf('h2') < 0);
    // وبعد أرشفة الفواتير يبقى التاريخ
    await pg.evaluate(() => { App.S.invoices = []; App.save(); }); await sleep(500);
    check('ويبقى بعد أرشفة الفواتير', await pg.evaluate(() => App.S.books.find(x => x.id === 'h2').lastSold) === new Date().toISOString().slice(0, 10));
  }

  console.log('\n== 13. اللصق المتعدد ==');
  {
    await closePage(pg); writeStore(seed()); pg = await open();
    const p1 = await pg.evaluate(() => Inv.parseBulk(
      'أساسيات الهندسة | أحمد علي | دار الفكر | جامعي | 978-123-456-789-0\n' +
      'الرياضيات | وزارة التعليم | | مدرسي |\n' +
      '3. الفيزياء | سالم | دار النور | جامعي | 9789991234567'));
    check('يقرأ ثلاثة كتب من ثلاثة أسطر', p1.length === 3, 'got ' + p1.length);
    check('ويوزّع الحقول صحيحاً', p1[0].title === 'أساسيات الهندسة' && p1[0].author === 'أحمد علي' && p1[0].cat === 'جامعي');
    check('وينظّف ISBN من الشرطات', p1[0].barcode === '9781234567890', 'got ' + p1[0].barcode);
    check('ويزيل الترقيم من أول السطر', p1[2].title === 'الفيزياء', 'got ' + p1[2].title);
    const p2 = await pg.evaluate(() => Inv.parseBulk('اسم الكتاب: كتاب أ\nالمؤلف: فلان\n---\nاسم الكتاب: كتاب ب\nالمؤلف: علان'));
    check('ويفهم الفقرات المعنونة أيضاً', p2.length === 2, 'got ' + p2.length);

    // التدفّق الكامل
    await pg.evaluate(() => { location.hash = '#/purchases'; App.route(); }); await sleep(500);
    await pg.click('button:has-text("لصق دفعة كتب")'); await sleep(600);
    await pg.fill('#bulkBox', 'تاريخ ليبيا | محمد | دار الكتاب | متنوع |\nالجبر | سالم | | مدرسي | 9789991234567');
    await pg.fill('#bulkQty', '٥');                       // أرقام عربية
    await pg.click('#modalHost button:has-text("التالي")'); await sleep(900);
    check('المعاينة تعرض الكتابين', await pg.evaluate(() => document.querySelectorAll('#bulkPrev tbody tr').length) === 2);
    await pg.evaluate(() => { Inv.bulkAll('price', 20); Inv.bulkAll('cost', 12); }); await sleep(400);
    await pg.click('#modalHost button:has-text("حفظ كل الكتب")'); await sleep(1800);
    const saved = await pg.evaluate(() => App.S.books.slice(-2).map(x => ({ t: x.title, q: x.qty, p: x.price, c: x.cost, lib: x.lib })));
    check('حُفظ الكتابان', saved.length === 2 && saved[0].t === 'تاريخ ليبيا');
    check('والكمية بالأرقام العربية قُرئت 5', saved[0].q === 5 && saved[1].q === 5, JSON.stringify(saved.map(x => x.q)));
    check('والسعر الموحّد طُبّق على الكل', saved.every(x => x.p === 20 && x.c === 12));
    const dlg = await pg.$eval('#modalHost', e => e.innerText).catch(() => '');
    check('ويعرض طباعة اللاصقات لمن يحتاجها فقط', dlg.indexOf('1 من الكتب') >= 0, dlg.slice(0, 80).replace(/\n/g, ' '));
    await pg.click('#modalHost button:has-text("إلغاء")').catch(() => { });
    await sleep(400);
  }

  console.log('\n== 13ب. كمية مستقلة لكل كتاب ==');
  {
    const q = await pg.evaluate(() => Inv.parseBulk(
      'أ | مؤلف | دار | جامعي | 9781234567890 | 15\n' +
      'ب | مؤلف | | مدرسي | | 8\n' +
      'ج ×3 | مؤلف | دار | متنوع |\n' +
      'د (12) | مؤلف | | أطفال |\n' +
      'هـ | مؤلف | | متنوع |').map(x => ({ t: x.title, q: x.qty })));
    check('الكمية من العمود السادس', q[0].q === 15 && q[1].q === 8, JSON.stringify(q.slice(0, 2)));
    check('والكمية بصيغة ×3 مع حذفها من الاسم', q[2].q === 3 && q[2].t === 'ج', JSON.stringify(q[2]));
    check('والكمية بصيغة (12)', q[3].q === 12 && q[3].t === 'د', JSON.stringify(q[3]));
    check('وبلا عدد تبقى فارغة', q[4].q === null);

    await pg.evaluate(() => { App.S.books = []; App.saveNow(); }); await sleep(500);
    await pg.evaluate(() => { location.hash = '#/purchases'; App.route(); }); await sleep(500);
    await pg.click('button:has-text("لصق دفعة كتب")'); await sleep(600);
    await pg.fill('#bulkBox', 'أ | م | د | جامعي | 9781234567890 | 15\nب ×8 | م | | مدرسي |\nج | م | | متنوع |');
    await pg.fill('#bulkQty', '2');
    await pg.click('#modalHost button:has-text("التالي")'); await sleep(900);
    const shown = await pg.evaluate(() => [...document.querySelectorAll('.bulk-qty')].map(e => e.value));
    check('كل كتاب بكميته، والافتراضية للباقي فقط', shown.join(',') === '15,8,2', 'got ' + shown.join(','));

    // التنقّل بلوحة المفاتيح
    await pg.evaluate(() => Inv.bulkFocusQty()); await sleep(300);
    const f0 = await pg.evaluate(() => document.activeElement.getAttribute('data-i'));
    await pg.keyboard.type('20'); await pg.keyboard.press('Enter'); await sleep(250);
    const f1 = await pg.evaluate(() => document.activeElement.getAttribute('data-i'));
    await pg.keyboard.type('7'); await pg.keyboard.press('Enter'); await sleep(250);
    await pg.keyboard.type('4'); await pg.keyboard.press('Enter'); await sleep(350);
    check('Enter ينتقل لخانة الكمية التالية', f0 === '0' && f1 === '1', f0 + '→' + f1);
    const typed = await pg.evaluate(() => [...document.querySelectorAll('.bulk-qty')].map(e => e.value));
    check('والكميات المكتوبة تُحفظ كما هي', typed.join(',') === '20,7,4', 'got ' + typed.join(','));

    const bc = await pg.evaluate(() => {
      const el = [...document.querySelectorAll('#bulkPrev input')].find(x => /^\d{5,}$/.test(x.value));
      return el ? { v: el.value, fits: el.scrollWidth <= el.offsetWidth + 1 } : null;
    });
    check('خانة الباركود تسع 13 رقماً كاملة', bc && bc.v === '9781234567890' && bc.fits, JSON.stringify(bc));

    await pg.evaluate(() => { Inv.bulkAll('price', 20); Inv.bulkAll('cost', 12); }); await sleep(300);
    await pg.click('#modalHost button:has-text("حفظ كل الكتب")'); await sleep(1800);
    const saved = await pg.evaluate(() => App.S.books.map(x => x.qty));
    check('وتُحفظ مختلفة لكل كتاب', saved.join(',') === '20,7,4', 'got ' + saved.join(','));
    await pg.click('#modalHost button:has-text("إلغاء")').catch(() => { });
    await sleep(400);
  }

  console.log('\n== 14. لاصقات الباركود ==');
  {
    const shorts = await pg.evaluate(() => [
      Labels.shortName('أساسيات الهندسة لتقنيات الورش الميكانيكية', 22),
      Labels.shortName('الرياضيات', 22),
      Labels.shortName('Introduction to Modern Physics for Engineers', 22)
    ]);
    check('الاسم الطويل يُختصر عند كلمة كاملة', shorts[0] === 'أساسيات الهندسة', 'got "' + shorts[0] + '"');
    check('والقصير يبقى كما هو', shorts[1] === 'الرياضيات');
    check('ولا يقطع وسط كلمة إنجليزية', shorts[2] === 'Introduction to Modern', 'got "' + shorts[2] + '"');

    const printed = await pg.evaluate(() => ({
      isbn13: Labels.hasPrinted({ barcode: '9781111111111' }),
      isbnDash: Labels.hasPrinted({ barcode: '978-1-234-5678-90' }),
      own: Labels.hasPrinted({ barcode: 'K0002' }),
      none: Labels.hasPrinted({ barcode: '' })
    }));
    check('يميّز باركود ISBN المطبوع', printed.isbn13 === true && printed.isbnDash === true);
    check('ولا يخلطه بكود المنظومة', printed.own === false && printed.none === false);

    await pg.evaluate(() => { location.hash = '#/labels'; App.route(); }); await sleep(700);
    await pg.evaluate(() => {
      const ids = App.S.books.filter(x => !Labels.hasPrinted(x)).slice(0, 2).map(x => x.id);
      ids.forEach(id => Labels.toggle(id, 2));
    }); await sleep(500);
    await pg.click('button:has-text("معاينة وطباعة")'); await sleep(1500);
    const lab = await pg.evaluate(() => ({
      n: document.querySelectorAll('#modalHost .lbl-one').length,
      svg: document.querySelectorAll('#modalHost .lbl-one svg rect').length,
      names: [...document.querySelectorAll('#modalHost .lbl-name')].map(e => e.textContent)
    }));
    check('تُرسم 4 لاصقات (صنفان × نسختان)', lab.n === 4, 'got ' + lab.n);
    check('وكل لاصقة فيها باركود مرسوم', lab.svg > 40, 'rects=' + lab.svg);
    check('والاسم مطبوع فوق الباركود', lab.names.length === 4 && lab.names[0].length > 0, JSON.stringify(lab.names[0]));
    await pg.click('#modalHost button:has-text("إغلاق")').catch(() => { });
    await sleep(300);

    // زر اللاصقة من سطر الصنف مباشرة
    await pg.evaluate(() => { location.hash = '#/purchases'; App.route(); }); await sleep(500);
    await pg.click('#view button:has-text("عرض وتعديل")'); await sleep(700);
    const nBtn = await pg.$$eval('#view button', e => e.filter(x => x.textContent.indexOf('لاصقة') >= 0).length);
    check('كل صنف عليه زر «لاصقة» في سطره', nBtn > 0, 'buttons=' + nBtn);
    if (nBtn) {
      await pg.click('#view button:has-text("لاصقة")'); await sleep(700);
      const dlg = await pg.$eval('#modalHost', e => e.innerText).catch(() => '');
      check('ويفتح نافذة عدد اللاصقات', dlg.indexOf('عدد اللاصقات') >= 0, dlg.slice(0, 60).replace(/\n/g, ' '));
      await pg.click('#modalHost button:has-text("إلغاء")').catch(() => { });
      await sleep(300);
    }
  }

  console.log('\n== 14ب. العلامة الحمراء للاصقات ==');
  {
    const st = seed();
    st.books = [
      { id: 'p1', code: 'K1', title: 'عليه باركود الناشر', lib: 'A', shelf: '1', barcode: '9781111111111', cost: 10, price: 15, qty: 5, min: 1 },
      { id: 'p2', code: 'K2', title: 'يحتاج لاصقة', lib: 'A', shelf: '1', barcode: '', cost: 10, price: 15, qty: 5, min: 1 },
      { id: 'p3', code: 'K3', title: 'طُبعت لاصقته', lib: 'A', shelf: '1', barcode: '', cost: 10, price: 15, qty: 5, min: 1, labelPrinted: '2026-09-01' }
    ];
    st.stationery = [];
    await closePage(pg); writeStore(st); pg = await open();

    const need = await pg.evaluate(() => App.S.books.map(b => Labels.needsLabel(b)));
    check('باركود الناشر لا يحتاج لاصقة', need[0] === false);
    check('وبلا باركود يحتاج', need[1] === true);
    check('والمطبوع سابقاً لا يحتاج', need[2] === false, JSON.stringify(need));
    check('العدّاد يحسب المتبقّي فقط', await pg.evaluate(() => Labels.pendingCount()) === 1);

    await pg.evaluate(() => { location.hash = '#/purchases'; App.route(); }); await sleep(500);
    await pg.click('#view button:has-text("عرض وتعديل")'); await sleep(700);
    const dots = await pg.evaluate(() => document.querySelectorAll('#view .lbl-dot').length);
    check('النقطة الحمراء تظهر للمحتاج وحده', dots === 1, 'dots=' + dots);
    const badge = await pg.evaluate(() => {
      const e = document.querySelector('[data-lblcount]');
      return e && !e.hidden ? e.textContent : null;
    });
    check('وشارة حمراء على تبويب اللاصقات', badge === '1', 'badge=' + badge);

    // الطباعة تُزيل العلامة
    await pg.evaluate(() => { location.hash = '#/labels'; App.route(); }); await sleep(700);
    await pg.evaluate(() => Labels.toggle('p2', 1)); await sleep(400);
    await pg.click('button:has-text("معاينة وطباعة")'); await sleep(1400);
    await pg.evaluate(() => {
      window.print = function () { };           // لا نفتح حوار الطباعة في الاختبار
      const b = [...document.querySelectorAll('#modalHost button')].find(x => x.textContent.indexOf('طباعة الآن') >= 0);
      if (b) b.click();
    });
    await sleep(1200);
    check('الطباعة تسجّل التاريخ على الصنف', !!await pg.evaluate(() => App.S.books.find(b => b.id === 'p2').labelPrinted));
    check('وتُزيل العلامة الحمراء', await pg.evaluate(() => Labels.pendingCount()) === 0);

    // والتراجع يعيدها
    await pg.evaluate(() => Labels.unmark('book', 'p2')); await sleep(600);
    check('وزر التراجع يعيد العلامة', await pg.evaluate(() => Labels.pendingCount()) === 1);
  }

  console.log('\n== 14ب2. باركود تلقائي وتعليم المطبوع ==');
  {
    const st = seed();
    st.books = [
      { id: 'n1', code: 'K1', title: 'كتاب بلا باركود', lib: 'A', shelf: '1', barcode: '', cost: 10, price: 15, qty: 5, min: 1 },
      { id: 'n2', code: 'K2', title: 'كتاب ثانٍ بلا باركود', lib: 'A', shelf: '1', barcode: '', cost: 10, price: 15, qty: 5, min: 1 },
      { id: 'n3', code: 'K3', title: 'قديم لُصقت لاصقته', lib: 'A', shelf: '2', barcode: '', cost: 8, price: 12, qty: 3, min: 1 },
      { id: 'n4', code: 'K4', title: 'عليه باركود الناشر', lib: 'A', shelf: '2', barcode: '9781111111111', cost: 10, price: 15, qty: 5, min: 1 }
    ];
    st.stationery = [];
    await closePage(pg); writeStore(st); pg = await open();

    check('الكتاب بلا باركود يظهر في قائمة اللاصقات',
      await pg.evaluate(() => Labels.pendingCount()) === 3, 'pending=' + await pg.evaluate(() => Labels.pendingCount()));

    // توليد الباركود عند الطباعة
    await pg.evaluate(() => { location.hash = '#/labels'; App.route(); }); await sleep(700);
    await pg.evaluate(() => Labels.toggle('n1', 1)); await sleep(400);
    await pg.click('button:has-text("معاينة وطباعة")'); await sleep(1500);
    const bc1 = await pg.evaluate(() => App.S.books.find(b => b.id === 'n1').barcode);
    // الصيغة صارت رقمية بحتة ليضغطها CODE128 وتُقرأ على اللاصقات الصغيرة
    check('وُلِّد باركود وحُفظ على الكتاب', /^\d{8}$/.test(bc1), 'barcode=' + bc1);
    const onLabel = await pg.evaluate(() =>
      [...document.querySelectorAll('#modalHost .lbl-bc svg text')].map(t => t.textContent).join('|'));
    check('ونفس الباركود مطبوع على اللاصقة', onLabel.indexOf(bc1) >= 0, 'label=' + onLabel);

    await pg.evaluate(() => {
      window.print = function () { };
      const b = [...document.querySelectorAll('#modalHost button')].find(x => x.textContent.indexOf('طباعة الآن') >= 0);
      if (b) b.click();
    }); await sleep(1200);
    check('والباركود المولَّد يجده مسح نقطة البيع',
      await pg.evaluate(() => { const h = Inv.byBarcode(App.S.books.find(b => b.id === 'n1').barcode); return h && h.it.id; }) === 'n1');
    check('ولا يتكرر باركود بين صنفين', await pg.evaluate(() => {
      const t = {}; let dup = false;
      App.S.books.forEach(b => { if (b.barcode) { if (t[b.barcode]) dup = true; t[b.barcode] = 1; } });
      return !dup;
    }));

    // تعليم صنف واحد كمطبوع سابقاً
    await pg.evaluate(() => Labels.markOne('n3')); await sleep(700);
    const n3 = await pg.evaluate(() => App.S.books.find(b => b.id === 'n3'));
    check('زر السطر يعلّمه كمطبوع', !!n3.labelPrinted);
    check('ويولّد له باركود أيضاً', /^\d{8}$/.test(n3.barcode), 'barcode=' + n3.barcode);

    // تعليم الكل جماعياً
    check('بقي واحد فقط بلا طباعة', await pg.evaluate(() => Labels.pendingCount()) === 1);
    await pg.evaluate(() => Labels.markAllShown()); await sleep(600);
    await pg.click('#modalHost button:has-text("علّمها كمطبوعة")'); await sleep(900);
    check('الزر الجماعي يفرّغ القائمة', await pg.evaluate(() => Labels.pendingCount()) === 0);
    check('وكل كتاب صار له باركود', await pg.evaluate(() =>
      App.S.books.every(b => String(b.barcode || '').trim().length > 0)));
  }

  console.log('\n== 14ب2ب. لاصقة 30×25 وقابلية القراءة ==');
  {
    await closePage(pg); writeStore(seed()); pg = await open();

    /* عرض الوحدة صار ثابتاً عند أصغر عدد صحيح من نقاط الطابعة يبلغ
       الحدّ العملي (نقطتان = 0.25 مم). فما يتغيّر بطول الرمز هو
       **العرض اللازم** لا عرض العمود — والرمز الذي لا يسعه عرض
       اللاصقة يُمنع بدل أن يُصغَّر حتى لا يُقرأ. */
    const f = await pg.evaluate(() => ({
      num30: Labels.__fit('47392015', 30),
      alpha30: Labels.__fit('LIB-473920', 30),
      num50: Labels.__fit('47392015', 50),
      isbn30: Labels.__fit('9780323672658', 30),
      isbn40: Labels.__fit('9780323672658', 40)
    }));
    check('الرمز الرقمي يدخل على 30 مم', f.num30.safe === true, f.num30.need.toFixed(1) + ' mm');
    check('والحرفي لا يدخل عليها', f.alpha30.safe === false, f.alpha30.need.toFixed(1) + ' mm');
    check('والحرفي يلزمه عرض أكبر من الرقمي', f.alpha30.need > f.num30.need,
      f.alpha30.need.toFixed(1) + ' > ' + f.num30.need.toFixed(1));
    /* القاعدة: أوسع عمود يقع على عدد صحيح من نقاط الطابعة ويسعه
       العرض، ولا ينزل عن نقطتين. فاللاصقة الأوسع تعطي أعمدة أوسع
       وقراءة أسهل. */
    const DOTMM = 25.4 / 203;
    check('كل العروض أعداد صحيحة من نقاط الطابعة',
      [f.num30.mm, f.num50.mm, f.alpha30.mm, f.isbn40.mm]
        .every(m => Math.abs(m / DOTMM - Math.round(m / DOTMM)) < 0.01),
      [f.num30.mm, f.num50.mm, f.alpha30.mm].map(x => (x / DOTMM).toFixed(2) + 'د').join(' '));
    check('واللاصقة الأوسع تعطي عموداً أوسع', f.num50.mm > f.num30.mm,
      f.num50.mm.toFixed(4) + ' > ' + f.num30.mm.toFixed(4));
    check('وISBN لا يدخل على 30 مم', f.isbn30.safe === false, f.isbn30.need.toFixed(1) + ' mm');
    check('ويدخل على 40 مم', f.isbn40.safe === true, f.isbn40.need.toFixed(1) + ' mm');

    const gen = await pg.evaluate(() => { const t = {}; return [0, 1, 2].map(() => Labels.newBarcode(t)); });
    check('الباركود المولَّد أرقام فقط', gen.every(c => /^\d+$/.test(c)), gen.join(','));
    check('وطوله 8 أرقام فلا يلتبس بـISBN', gen.every(c => c.length === 8), gen.join(','));
    check('ولا يتكرر', new Set(gen).size === 3);

    // اللاصقة نفسها
    await pg.evaluate(() => {
      App.S.meta.label = { w: 30, h: 25, maxChars: 18, showPrice: true, showLoc: false, prefix: '' };
      App.S.books = [{ id: 'z1', code: 'K1', title: 'كتاب اختبار اللاصقة الصغيرة', lib: 'A', shelf: '1', barcode: '', cost: 10, price: 25, qty: 3, min: 1 }];
      App.saveNow();
    }); await sleep(700);
    await pg.evaluate(() => { location.hash = '#/labels'; App.route(); }); await sleep(700);
    await pg.evaluate(() => Labels.toggle('z1', 1)); await sleep(400);
    await pg.click('button:has-text("معاينة وطباعة")'); await sleep(1500);
    const lab = await pg.evaluate(() => ({
      n: document.querySelectorAll('#modalHost .lbl-one').length,
      price: (document.querySelector('#modalHost .lbl-price') || {}).textContent || '',
      name: (document.querySelector('#modalHost .lbl-name') || {}).textContent || '',
      bars: document.querySelectorAll('#modalHost .lbl-bc svg rect').length,
      bc: App.S.books[0].barcode
    }));
    check('اللاصقة فيها السعر', lab.price.indexOf('25') >= 0, JSON.stringify(lab.price));
    check('وفيها الاسم فوق الباركود', lab.name.length > 0, JSON.stringify(lab.name));
    // JsBarcode يدمج الوحدات المتجاورة في مستطيل واحد، والرمز الرقمي
    // المضغوط يحتاج أعمدة أقل من الحرفي — 23 مستطيلاً لثمانية أرقام
    check('والباركود مرسوم', lab.bars > 15, 'rects=' + lab.bars);
    check('ووُلِّد رقمياً وحُفظ', /^\d{8}$/.test(lab.bc), 'bc=' + lab.bc);
    await pg.click('#modalHost button:has-text("إغلاق")').catch(() => { });
    await sleep(300);
  }

  console.log('\n== 14ب2ج. تسجيل كتاب بلا باركود ==');
  {
    await pg.evaluate(() => { App.S.books = []; App.saveNow(); }); await sleep(500);
    await pg.evaluate(() => { location.hash = '#/purchases'; App.route(); }); await sleep(600);
    await pg.click('button:has-text("+ كتاب جديد")'); await sleep(600);
    await pg.fill('#f_title', 'كتاب بلا باركود');
    await pg.fill('#f_price', '25');
    await pg.fill('#f_qty', '4');
    await pg.click('#modalHost button:has-text("حفظ")'); await sleep(1300);
    const b = await pg.evaluate(() => App.S.books[0] || null);
    check('يُحفظ الكتاب بخانة باركود فارغة', !!b && b.title === 'كتاب بلا باركود', b ? b.title : 'لم يُحفظ');
    check('والباركود فارغ فعلاً', b && !String(b.barcode || '').trim(), b ? JSON.stringify(b.barcode) : '');
    // العدّاد يشمل القرطاسية أيضاً، فنحصر الفحص على الكتب
    const bookPending = await pg.evaluate(() =>
      App.S.books.filter(x => Labels.needsLabel(x)).length);
    check('ويظهر في قائمة اللاصقات', bookPending === 1, 'pending=' + bookPending);
  }

  console.log('\n== 14ب2د. البطاقات وحقل المسح ==');
  {
    await pg.evaluate(() => {
      App.S.books = [
        { id: 'c1', code: 'K1', title: 'كتاب بلا لاصقة', lib: 'A', shelf: '1', barcode: '', cost: 10, price: 15, qty: 5, min: 1 },
        { id: 'c2', code: 'K2', title: 'كتاب بباركود', lib: 'A', shelf: '2', barcode: '47392015', cost: 10, price: 15, qty: 7, min: 1 }
      ];
      App.saveNow();
    }); await sleep(600);
    await pg.evaluate(() => { location.hash = '#/purchases'; App.route(); }); await sleep(500);
    await pg.click('#view button:has-text("عرض وتعديل")'); await sleep(700);

    await pg.click('#view button:has-text("بطاقات")'); await sleep(800);
    const cards = await pg.evaluate(() => ({
      n: document.querySelectorAll('.item-card').length,
      dots: document.querySelectorAll('.item-card .lbl-dot').length,
      hasPrice: !!document.querySelector('.item-card .ic-nums')
    }));
    check('عرض البطاقات يرسم بطاقة لكل صنف', cards.n === 2, 'cards=' + cards.n);
    /* النقطتان صحيحتان: النقطة تعني «لم تُطبع لاصقته»، وc2 له باركود
       لكن لاصقته لم تُطبع بعد. الذي لا يحمل نقطة هو ما عليه باركود
       الناشر أو ما عُلّم كمطبوع. */
    check('والنقطة الحمراء داخل البطاقة', cards.dots === 2, 'dots=' + cards.dots);
    check('وفيها السعر والكمية', cards.hasPrice === true);

    await pg.click('#view button:has-text("جدول")'); await sleep(700);
    check('والرجوع للجدول يعمل', await pg.evaluate(() => document.querySelectorAll('#invBody tbody tr').length) === 2);

    // مكينة القارئ: الرمز الجديد يمسح القديم
    await pg.click('#bq');
    await pg.keyboard.type('47392015', { delay: 12 });
    await pg.keyboard.press('Enter'); await sleep(450);
    const v1 = await pg.$eval('#bq', e => e.value);
    await pg.keyboard.type('99887766', { delay: 12 }); await sleep(450);
    const v2 = await pg.$eval('#bq', e => e.value);
    check('المسح الأول يبقى في الحقل', v1 === '47392015', JSON.stringify(v1));
    check('والمسح الثاني يمسحه ولا يلتصق به', v2 === '99887766', JSON.stringify(v2));
  }

  console.log('\n== 14ب3. النقطة الحمراء في كل القوائم ==');
  {
    const st = seed();
    st.books = [
      { id: 'd1', code: 'K1', title: 'يحتاج لاصقة', lib: 'A', shelf: '1', barcode: '', cost: 10, price: 15, qty: 5, min: 1 },
      { id: 'd2', code: 'K2', title: 'عليه باركود الناشر', lib: 'A', shelf: '1', barcode: '9781111111111', cost: 10, price: 15, qty: 5, min: 1 }
    ];
    st.stationery = [{ id: 'd3', code: 'Q1', name: 'قلم بلا لاصقة', cat: 'أقلام', unit: 'قطعة', barcode: '', cost: 1, price: 2, qty: 9, min: 1 }];
    await closePage(pg); writeStore(st); pg = await open();

    async function dots(where, after) {
      await pg.evaluate(k => { location.hash = '#/' + k; App.route(); }, where); await sleep(600);
      if (after) { await after(); }
      return pg.evaluate(() => document.querySelectorAll('#view .lbl-dot').length);
    }
    check('في «إدخال بضاعة» (آخر ما أضفته)', await dots('purchases') >= 1, 'dots=' + await dots('purchases'));
    const dEdit = await dots('purchases', async () => {
      await pg.click('#view button:has-text("عرض وتعديل")'); await sleep(700);
    });
    check('في «عرض وتعديل»', dEdit === 1, 'dots=' + dEdit);
    const dStock = await dots('stock', async () => {
      await pg.click('button:has-text("مباشر")').catch(() => { }); await sleep(800);
    });
    check('وفي «المخزون والفروع»', dStock >= 1, 'dots=' + dStock);
  }

  console.log('\n== 14ج. عمود الملاحظة في الاستيراد ==');
  {
    const csv = 'الاسم,المؤلف,الناشر,التصنيف,المكتبة,الرف,الباركود,شراء,بيع,الكمية,الحد,ملاحظة\n' +
      'كتاب من الموقع,أحمد,دار,جامعي,A,2,9789991234567,10,18,4,1,"التخصص: تشريح\nكتاب تشريح لطلبة الطب."\n';
    fs.writeFileSync(path.join(DATA, 'imp-note.csv'), '﻿' + csv);
    await closePage(pg); writeStore(seed()); pg = await open();
    await pg.evaluate(() => { App.S.books = []; App.saveNow(); }); await sleep(400);
    await pg.evaluate(() => { location.hash = '#/purchases'; App.route(); }); await sleep(500);
    await pg.click('button:has-text("استيراد من ملف")'); await sleep(600);
    const [fc] = await Promise.all([
      pg.waitForEvent('filechooser'),
      pg.click('#modalHost button:has-text("اختيار الملف واستيراده")')
    ]);
    await fc.setFiles(path.join(DATA, 'imp-note.csv'));
    await sleep(1800);
    const b = await pg.evaluate(() => App.S.books[0]);
    check('الكتاب استُورد', b && b.title === 'كتاب من الموقع', b ? b.title : 'none');
    check('والملاحظة وصلت معه', b && b.note && b.note.indexOf('تشريح') >= 0, b ? JSON.stringify(b.note) : '');
    check('وباقي الحقول صحيحة', b && b.price === 18 && b.qty === 4 && b.barcode === '9789991234567',
      b ? [b.price, b.qty, b.barcode].join('/') : '');
    const needsLbl = await pg.evaluate(() => Labels.needsLabel(App.S.books[0]));
    check('وله باركود ناشر فلا يحتاج لاصقة', needsLbl === false);
  }

  console.log('\n== 15. سلامة التطبيق عموماً ==');
  writeStore(seed());
  await closePage(pg); pg = await open();
  for (const k of ['dash','pos','invoices','stocktake','stock','purchases','alerts','stale','labels','customers','consign','suppliers','profits','notify','settings']) {
    await pg.evaluate(x => { location.hash = '#/' + x; App.route(); }, k); await sleep(300);
  }
  check('15 شاشة بلا خطأ JavaScript', errs.length === 0, errs.slice(0, 4).join(' | '));

  console.log('\n== 14ج2. ختم النسخة والتبويبات ==');
  {
    /* الخلل الذي وقع: كل النسخ تقول «v2.0» فلا يعرف صاحب المحل أي ملف
       يشغّل. فتح نسخة قديمة وظنّ أن «طباعة اللاصقات» اختفت. */
    await closePage(pg); writeStore(seed()); pg = await open();
    const ver = await pg.evaluate(() => {
      const e = document.getElementById('ver');
      return { txt: (e.textContent || '').trim(), title: e.title || '' };
    });
    check('الشريط يعرض رقم الإصدار', /^v\d+\.\d+/.test(ver.txt), JSON.stringify(ver));
    check('ومعه تاريخ البناء', /\d{4}-\d{2}-\d{2}/.test(ver.txt), ver.txt);
    check('وليس «v2.0» الثابت القديم', ver.txt !== 'v2.0', ver.txt);
    check('والتلميح يذكر مجلد البيانات', /مجلد البيانات/.test(ver.title), ver.title);

    /* التبويبات التي ظنّها مفقودة يجب أن تكون في الشريط دائماً */
    const navTxt = await pg.$$eval('.nav-item', bs => bs.map(b2 => b2.textContent.trim()));
    ['لوحة اليوم','نقطة البيع','الفواتير','الجرد','المخزون والفروع','إدخال بضاعة',
     'التنبيهات','البضاعة الراكدة','طباعة اللاصقات','الزبائن والديون','كتب على المباع',
     'الموردون ودور النشر','الأرباح والتقارير','الإشعارات','الإعدادات'].forEach(function (t) {
      check('تبويب «' + t + '» موجود',
        navTxt.some(function (x) { return x.indexOf(t) >= 0; }), navTxt.join(' | '));
    });
  }

  console.log('\n== 14د. الأيقونات أشكال متجهة لا رموز خطّية ==');
  {
    /* الرموز مثل ▣ و◕ ترتسم شكلاً مختلفاً في كل خط، وبعضها لا يُرسم
       أصلاً. كلها صارت أشكالاً متجهة من مجموعة واحدة. */
    await closePage(pg); writeStore(seed()); pg = await open();
    for (const k of ['dash','pos','invoices','stocktake','stock','purchases',
                     'alerts','stale','labels','customers','consign','suppliers',
                     'profits','notify','settings']) {
      await pg.evaluate(x => { location.hash = '#/' + x; App.route(); }, k); await sleep(260);
    }
    const stray = await pg.evaluate(() => {
      const bad = /[▣◈▤▦▧◫⌂⇦⇨☺⌕▶✔◻▭◕●]/;
      const hits = [];
      document.querySelectorAll('#rail .ic, .empty .big, .nav-item').forEach(function (e) {
        const t = (e.textContent || '').trim();
        if (bad.test(t)) hits.push(t);
      });
      return hits;
    });
    check('لا رمز خطّي في الشريط ولا في الحالات الفارغة', stray.length === 0, stray.join(' '));

    const navSvg = await pg.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.nav-item'));
      return { total: items.length, withSvg: items.filter(i => i.querySelector('svg.ic')).length };
    });
    check('كل عنصر في الشريط له شكل متجه',
      navSvg.total > 0 && navSvg.withSvg === navSvg.total, JSON.stringify(navSvg));

    /* أيقونة الجرد كانت سلة مهملات — تقول «احذف» وهي تعني «اعدُد» */
    const tally = await pg.evaluate(() => {
      const b = Array.from(document.querySelectorAll('.nav-item'))
        .filter(x => x.textContent.indexOf('الجرد') >= 0)[0];
      const p = b && b.querySelector('svg.ic path');
      return p ? p.getAttribute('d') : '';
    });
    check('وأيقونة الجرد ليست سلة مهملات', tally.indexOf('M9 3h6v3H9V3z') === 0, tally.slice(0, 32));
  }

  console.log('\n== 14ج3. الاستعادة تفشل بصوت مسموع ==');
  {
    /* الخلل الذي بلّغ عنه صاحب المحل: ضغط «استعادة من ملف» فلم يحدث شيء.
       السبب: fetch لا يرفض الوعد عند 403، فكان الكود يعلن النجاح ويعيد
       التحميل على لا شيء. والسبب الجذري أن الترخيص كان داخل مجلد
       البيانات، فالتثبيت — وهو يغيّر المجلد — كان يفقده. */
    await closePage(pg); writeStore(seed()); pg = await open();

    const shape = await pg.evaluate(() => typeof App.apiWrite);
    check('توجد دالة كتابة تفحص رد الخادم', shape === 'function', shape);

    /* 403 غير مرخّص: يجب أن يُرفض الوعد برسالة مفهومة */
    const denied = await pg.evaluate(() => {
      const realFetch = window.fetch;
      window.fetch = function () {
        return Promise.resolve(new Response('{"ok":false,"error":"unlicensed"}',
          { status: 403, headers: { 'Content-Type': 'application/json' } }));
      };
      return App.apiWrite('/api/save', { method: 'POST', body: '{}' })
        .then(function () { return 'نجح بالخطأ'; })
        .catch(function (e) { return e.message; })
        .then(function (r) { window.fetch = realFetch; return r; });
    });
    check('403 غير مرخّص يُرفض برسالة مفهومة', /غير مفعَّل/.test(denied), denied);

    /* 409 نافذة أخرى */
    const busy = await pg.evaluate(() => {
      const realFetch = window.fetch;
      window.fetch = function () {
        return Promise.resolve(new Response('{"ok":false,"notOwner":true}',
          { status: 409, headers: { 'Content-Type': 'application/json' } }));
      };
      return App.apiWrite('/api/save', { method: 'POST', body: '{}' })
        .then(function () { return 'نجح بالخطأ'; })
        .catch(function (e) { return e.message; })
        .then(function (r) { window.fetch = realFetch; return r; });
    });
    check('409 نافذة أخرى يُرفض برسالة مفهومة', /نافذة أخرى/.test(busy), busy);

    /* النجاح يمر كما هو */
    const okRes = await pg.evaluate(() => {
      const realFetch = window.fetch;
      window.fetch = function () {
        return Promise.resolve(new Response('{"ok":true}',
          { status: 200, headers: { 'Content-Type': 'application/json' } }));
      };
      return App.apiWrite('/api/save', { method: 'POST', body: '{}' })
        .then(function (d) { return 'ok:' + (d && d.ok); })
        .catch(function (e) { return 'رُفض: ' + e.message; })
        .then(function (r) { window.fetch = realFetch; return r; });
    });
    check('والنجاح يمر كما هو', okRes === 'ok:true', okRes);

    /* شاشة الترخيص تشرح السبب الشائع بعد التثبيت */
    const licTxt = await pg.evaluate(() => {
      App.lic.active = false; App.lic.fp = 'TEST-FP'; App.lic.hasFile = false;
      App.licScreen();
      return document.getElementById('view').textContent;
    });
    check('شاشة الترخيص تدلّ على مجلد data القديم',
      /license\.txt/.test(licTxt) && /data/.test(licTxt), licTxt.slice(0, 90));
  }

  console.log('\n== 14ج7. الباركود يُقرأ فعلاً: أعمدة على نقاط كاملة ==');
  {
    /* شكا صاحب المحل أن القارئ لا يقرأ اللاصقات. السبب ليس صغر
       الباركود: عرض الوحدة كان 0.279 مم = 2.23 نقطة على طابعة 203
       DPI. والطابعة لا تطبع إلا نقاطاً كاملة، فعمود ٣ وحدات يُطبع ٧
       نقاط بدل ٦ وعمود ٤ يُطبع ٩ بدل ٨ — تنكسر النسب التي يقرؤها
       الماسح، والباركود يبدو سليماً للعين. */
    await closePage(pg); writeStore(seed()); pg = await open();

    const DOT = 25.4 / 203;
    const geo = await pg.evaluate(() => {
      const L = { w: 30, h: 25, showPrice: true, showLoc: false, maxChars: 18, prefix: '' };
      const f = Labels.__fit('47392015', L.w);
      return { mm: f.mm, dots: f.dots, need: f.need, safe: f.safe, h: Labels.__barH(L) };
    });
    const dotsExact = geo.mm / DOT;
    check('عرض الوحدة عدد صحيح من نقاط الطابعة',
      Math.abs(dotsExact - Math.round(dotsExact)) < 0.01, dotsExact.toFixed(3) + ' نقطة');
    check('ولا ينزل تحت الحدّ العملي 0.25 مم', geo.mm >= 0.2499, geo.mm.toFixed(4));
    check('وارتفاع الأعمدة 8 مم فأكثر', geo.h / 3.7795 >= 8, (geo.h / 3.7795).toFixed(1) + ' مم');

    /* كل عروض الأعمدة المرسومة مضاعفات صحيحة للوحدة */
    const bars = await pg.evaluate(() => {
      const L = { w: 30, h: 25, showPrice: true, showLoc: false, maxChars: 18, prefix: '' };
      const host = document.createElement('div');
      host.style.position = 'absolute'; host.style.left = '-9999px';
      host.innerHTML = Labels.__svgFor('47392015', L);
      document.body.appendChild(host);
      const ws = Array.from(host.querySelectorAll('rect'))
        .filter(r => r.getAttribute('fill') !== '#ffffff')
        .map(r => parseFloat(r.getAttribute('width'))).filter(x => x > 0);
      document.body.removeChild(host);
      const base = Math.min.apply(null, ws);
      return { n: ws.length, ratios: ws.map(w => w / base) };
    });
    check('رُسمت أعمدة الباركود', bars.n > 10, 'n=' + bars.n);
    check('وكل عرض مضاعف صحيح للوحدة (1× 2× 3× 4×)',
      bars.ratios.every(r => Math.abs(r - Math.round(r)) < 0.02),
      bars.ratios.slice(0, 6).map(x => x.toFixed(2)).join(' '));

    /* الباركود الأطول من اللاصقة لا يُطبع مقصوصاً */
    const fits = await pg.evaluate(() => {
      const mk = w => ({ w: w, h: 25, showPrice: true, showLoc: false, maxChars: 18, prefix: '' });
      const draw = (code, w) => {
        const h = Labels.__svgFor(code, mk(w));
        return h.indexOf('<svg') >= 0 ? 'باركود' : (h.indexOf('lbl-nofit') >= 0 ? 'منع' : 'آخر');
      };
      return {
        short30: draw('47392015', 30),
        isbn30: draw('9789991234567', 30),
        isbn40: draw('9789991234567', 40),
        need: Labels.__fit('9789991234567', 30).need
      };
    });
    check('الرمز القصير يُرسم على 30 مم', fits.short30 === 'باركود', fits.short30);
    check('وISBN لا يُرسم مقصوصاً على 30 مم بل يُمنع', fits.isbn30 === 'منع', fits.isbn30);
    check('ويُرسم على 40 مم', fits.isbn40 === 'باركود', fits.isbn40);
    check('ويُعلن كم يلزمه (نحو 35 مم)', fits.need > 34 && fits.need < 37, fits.need.toFixed(1));
  }

  console.log('\n== 14ج6. المرتجع يُخصم من الأرقام ==');
  {
    /* أسطر فاتورة الإرجاع تحمل كمية موجبة وإجمالياً سالباً. فجمع
       الكميات من كل الفواتير كان يجعل إرجاع تسع نسخ **يزيد**
       «القطع المباعة» تسعاً، ويُبقي الصنف متصدّراً «الأكثر مبيعاً». */
    const T = new Date().toISOString().slice(0, 10);
    const mk = (no, kind, id, name, qty, sign) => ({
      id: 'i' + no, no: no, kind: kind, date: T, at: T + ' 10:00',
      items: [{ type: 'book', id: id, name: name, qty: qty, price: 20, cost: 10 }],
      subtotal: sign * qty * 20, discount: 0, total: sign * qty * 20,
      profit: sign * qty * 10, method: 'cash', mode: 'retail',
      customerId: '', paid: sign * qty * 20, due: 0
    });
    const st = seed();
    st.books = [
      { id:'r1', code:'K1', title:'صنف رائج', lib:'A', shelf:'1', barcode:'901', cost:10, price:20, qty:100, min:2 },
      { id:'r2', code:'K2', title:'صنف مرتجع', lib:'A', shelf:'2', barcode:'902', cost:10, price:20, qty:100, min:2 }
    ];
    st.invoices = [ mk(1,'sale','r1','صنف رائج',5,1),
                    mk(2,'sale','r2','صنف مرتجع',10,1),
                    mk(3,'return','r2','صنف مرتجع',9,-1) ];
    st.counters = { invoice:3, book:2, stat:0 };
    await closePage(pg); writeStore(st); pg = await open();

    await pg.evaluate(() => { location.hash = '#/dash'; App.route(); }); await sleep(600);
    const dash = await pg.evaluate(() => document.getElementById('view').textContent.replace(/\s+/g, ' '));
    const m = dash.match(/عدد القطع المباعة[^\d]*(\d+)/);
    check('القطع المباعة = 5 + 10 − 9 = 6', m && m[1] === '6', m ? m[1] : 'الربح ظاهر بدل القطع');

    const rep = await pg.evaluate(() => {
      document.getElementById('view').innerHTML = Rep.reports();
      return document.getElementById('view').textContent.replace(/\s+/g, ' ');
    });
    const i1 = rep.indexOf('صنف رائج'), i2 = rep.indexOf('صنف مرتجع');
    check('الرائج يسبق المرتجع في «الأكثر مبيعاً»', i1 > 0 && i2 > 0 && i1 < i2, 'i1=' + i1 + ' i2=' + i2);
    /* صف الجدول: الاسم ثم الكمية ثم المبيعات ثم الربح.
       المرتجع صافيه 1 (عشر مباعة ناقص تسع مرتجعة) لا 10. */
    const rowRet = rep.slice(i2, i2 + 40).replace(/\s+/g, '');
    check('المرتجع بصافيه: 1 قطعة بـ20.00 (لا 10 بـ200)',
      rowRet.indexOf('صنفمرتجع120.0010.00') === 0, rowRet);
    const rowTop = rep.slice(i1, i1 + 40).replace(/\s+/g, '');
    check('والرائج بخمس قطع بـ100.00',
      rowTop.indexOf('صنفرائج5100.0050.00') === 0, rowTop);
  }

  console.log('\n== 14ج5. الكتابة ثم الضغط فوراً لا تُضيّع الضغطة ==');
  {
    /* التسلسل الحقيقي عند الضغط بعد الكتابة في حقل:
       ضغط الفأرة ← خروج المؤشّر من الحقل ← change ← إن أعاد المعالج
       بناء الشاشة استُبدل الزر، فوقع رفع الفأرة على عنصر جديد ولم
       تُحسب ضغطة. صاحب المحل يكتب ويضغط فلا يحدث شيء. */
    await closePage(pg); writeStore(seed()); pg = await open();

    const payOpen = () => pg.evaluate(() => !!document.querySelector('.pay-btn'));
    /* شاشة الدفع نافذة خاصة لا تُغلق بـ[data-x]؛ إعادة التحميل أنظف
       وتضمن بداية متطابقة لكل حالة. */
    const freshPos = async () => {
      await pg.reload({ waitUntil: 'domcontentloaded' });
      await pg.waitForFunction(() => window.App && App.S && window.Sales, null, { timeout: 30000 });
      await sleep(700);
      await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(500);
      await pg.evaluate(() => { Sales.clear(); Sales.add('book', 'b1'); }); await sleep(450);
    };
    const dropModal = freshPos;

    /* أ) بلا كتابة — خط الأساس */
    await freshPos();
    await pg.click('button:has-text("إتمام البيع")'); await sleep(700);
    check('بلا كتابة: ضغطة واحدة تفتح شاشة الدفع', await payOpen() === true);

    /* ب) كتابة خصم ثم ضغط */
    await freshPos();
    await pg.click('.totals input[type="number"]');
    await pg.keyboard.type('5'); await sleep(150);
    await pg.click('button:has-text("إتمام البيع")'); await sleep(800);
    const dOpen = await payOpen();
    check('كتابة خصم ثم ضغط: تُفتح من أول ضغطة', dOpen === true);
    const dAmt = await pg.evaluate(() => {
      const e = document.querySelector('.pay-amount'); return e ? e.textContent : '';
    });
    check('والمبلغ المطلوب بعد الخصم صحيح (15−5)', /10/.test(dAmt), dAmt);

    /* ج) كتابة كمية سطر ثم ضغط */
    await freshPos();
    await pg.click('.qty-box input');
    await pg.keyboard.press('Control+A');
    await pg.keyboard.type('3'); await sleep(150);
    await pg.click('button:has-text("إتمام البيع")'); await sleep(800);
    check('كتابة كمية ثم ضغط: تُفتح من أول ضغطة', await payOpen() === true);
    const qAmt = await pg.evaluate(() => {
      const e = document.querySelector('.pay-amount'); return e ? e.textContent : '';
    });
    check('والمبلغ يعكس الكمية الجديدة (3×15)', /45/.test(qAmt), qAmt);

    /* د) الأرقام تُحدَّث في مكانها فعلاً */
    await freshPos();
    await pg.evaluate(() => Sales.setQty(0, 4)); await sleep(300);
    const live = await pg.evaluate(() => ({
      line: (document.querySelector('.cart-line .lp') || {}).textContent,
      sub: (document.getElementById('tSub') || {}).textContent,
      qty: (document.querySelector('.qty-box input') || {}).value
    }));
    check('مجموع السطر يتحدّث (4×15)', /60/.test(live.line || ''), JSON.stringify(live));
    check('ومجموع الفاتورة يتحدّث', /60/.test(live.sub || ''), JSON.stringify(live));
    check('وحقل الكمية يعكس القيمة', live.qty === '4', JSON.stringify(live));

    /* هـ) تصفير الكمية يحذف السطر */
    await pg.evaluate(() => Sales.setQty(0, 0)); await sleep(350);
    const gone = await pg.evaluate(() => document.querySelectorAll('.cart-line').length);
    check('وتصفير الكمية يحذف السطر', gone === 0, 'lines=' + gone);
  }

  console.log('\n== 14ج4. انقطاع المحرك: شريط واحد لا عشرات التنبيهات ==');
  {
    /* ما رآه صاحب المحل: عشرات من «انقطع الاتصال بمحرك البرنامج»
       متكدّسة تغطّي الشاشة. السبب أن إعادة الحفظ تُطلق تنبيهاً كل مرة. */
    await closePage(pg); writeStore(seed()); pg = await open();

    const flood = await pg.evaluate(async () => {
      const host = document.getElementById('toasts');
      host.innerHTML = '';
      for (let i = 0; i < 12; i++) App.toast('رسالة مكرّرة', 'bad');
      await new Promise(r => setTimeout(r, 80));
      return { n: host.children.length, txt: (host.textContent || '').trim() };
    });
    check('١٢ تنبيهاً متطابقاً تصير واحداً', flood.n === 1, JSON.stringify(flood));
    check('ويقول كم تكرّر', /×12/.test(flood.txt), flood.txt);

    const mixed = await pg.evaluate(async () => {
      const host = document.getElementById('toasts');
      host.innerHTML = '';
      App.toast('أولى', 'bad'); App.toast('ثانية', 'bad');
      await new Promise(r => setTimeout(r, 80));
      return host.children.length;
    });
    check('ورسالتان مختلفتان تبقيان اثنتين', mixed === 2, 'n=' + mixed);

    /* الانقطاع الحقيقي: شريط ثابت، ولا يتكرّر مهما تكرّر الفشل */
    const bar = await pg.evaluate(async () => {
      const realFetch = window.fetch;
      window.fetch = function () { return Promise.reject(new Error('down')); };
      document.getElementById('toasts').innerHTML = '';
      App.S.meta.shopName = 'تعديل ١'; await App.saveNow().catch(() => { });
      App.S.meta.shopName = 'تعديل ٢'; await App.saveNow().catch(() => { });
      App.S.meta.shopName = 'تعديل ٣'; await App.saveNow().catch(() => { });
      await new Promise(r => setTimeout(r, 120));
      const b = document.getElementById('discBar');
      const out = {
        barShown: !!b && !b.hidden,
        barText: b ? b.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : '',
        toasts: document.getElementById('toasts').children.length
      };
      window.fetch = realFetch;
      return out;
    });
    check('انقطاع المحرك يعرض شريطاً ثابتاً', bar.barShown, JSON.stringify(bar));
    check('والشريط يقول ماذا يفعل المستخدم',
      /شغّل البرنامج من جديد/.test(bar.barText) || bar.barText.length > 20, bar.barText);
    check('وثلاث محاولات فاشلة تنبّه مرة واحدة', bar.toasts <= 1, 'toasts=' + bar.toasts);
  }

  console.log('\n== 15أ. أحجام الواجهة الخمسة ==');
  {
    await closePage(pg); writeStore(seed()); pg = await open();
    await pg.evaluate(() => { location.hash = '#/settings'; App.route(); }); await sleep(600);
    const labels = await pg.$$eval('.seg button', bs => bs.map(b2 => b2.textContent.trim()));
    ['صغير جداً', 'صغير', 'عادي', 'كبير', 'كبير جداً'].forEach(function (t) {
      check('يوجد مقاس «' + t + '»', labels.indexOf(t) >= 0, labels.join(' | '));
    });
    /* لا يكفي أن يوجد الزر: يجب أن يصغّر الخط فعلاً، وبترتيب صحيح */
    const px = {};
    for (const k of ['xs', 'sm', 'md', 'lg', 'xl']) {
      await pg.evaluate(v => Rep.setSize(v), k); await sleep(250);
      px[k] = await pg.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    }
    check('كل مقاس أكبر مما قبله فعلاً',
      px.xs < px.sm && px.sm < px.md && px.md < px.lg && px.lg < px.xl,
      JSON.stringify(px));
    check('و«صغير جداً» أصغر من «عادي» بوضوح', px.md - px.xs >= 2.5,
      px.xs + ' مقابل ' + px.md);
    /* الصنف القديم يجب أن يزول، وإلا تراكمت الأصناف وتغلّب الأكبر */
    const cls = await pg.evaluate(() => document.body.className);
    check('صنف واحد فقط على body', (cls.match(/ui-/g) || []).length === 1, cls);
    await pg.evaluate(() => Rep.setSize('lg')); await sleep(250);
  }

  console.log('\n== 15ب. خطوات الربط تُرى قبل ضبطه ==');
  {
    /* الخلل الذي وقع فعلاً: أزرار الربط كانت تظهر فقط بعد ضبط الربط،
       فلا يجدها من لم يضبطه بعد — وهو بالضبط من يحتاجها. */
    await closePage(pg); writeStore(seed()); pg = await open();
    await pg.evaluate(() => { location.hash = '#/stock'; App.route(); }); await sleep(700);
    const unconfigured = await pg.evaluate(() => Stock.configured());
    check('الحالة: الربط غير مضبوط', unconfigured === false);
    const startBtn = await pg.$('#view button:has-text("ابدأ — خطوات الربط")');
    check('زر «ابدأ — خطوات الربط» ظاهر قبل الضبط', !!startBtn);

    await startBtn.click(); await sleep(700);
    const body = await pg.evaluate(() => {
      const e = document.querySelector('#modalHost .m-body');
      return e ? e.textContent : '';
    });
    check('الخطوات تذكر Cloudflare وأنه مجاني بلا بطاقة',
      /Cloudflare/.test(body) && /بلا بطاقة/.test(body), body.slice(0, 80));
    check('وتذكر SHOP_DATA وSHOP_SECRET',
      /SHOP_DATA/.test(body) && /SHOP_SECRET/.test(body));
    check('وتقول إن المبيعات والأرباح لا تمر عبره',
      /لا يمر عبره/.test(body) && /أرباحك/.test(body));
    check('وتذكر البديل بلا إنترنت (واتساب)', /واتساب/.test(body));
    check('وتذكر الحل إن كان workers.dev محجوباً', /محجوب/.test(body));

    /* زر النسخ يجب أن يجد كوداً حقيقياً لا 404 */
    const code = await pg.evaluate(() => fetch('worker.js', { cache: 'no-store' })
      .then(r => r.ok ? r.text() : null).catch(() => null));
    check('كود الـWorker يُقرأ من داخل البرنامج', !!code && code.length > 500,
      code ? ('len=' + code.length) : 'null');
    check('وهو الكود الصحيح لا ملف آخر',
      !!code && /SHOP_SECRET/.test(code) && /branch:/.test(code) && /expirationTtl/.test(code));

    /* زر النسخ فعلاً: نمنح إذن الحافظة ثم نقرأ ما وُضع فيها */
    await pg.context().grantPermissions(['clipboard-read', 'clipboard-write'],
      { origin: URL.replace(/\/$/, '') }).catch(() => { });
    await pg.click('#modalHost button:has-text("نسخ كود الـWorker")'); await sleep(700);
    const clip = await pg.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check('زر النسخ يضع الكود في الحافظة فعلاً',
      /SHOP_SECRET/.test(clip) && clip.length > 500, 'len=' + (clip || '').length);
    const note = await pg.evaluate(() => {
      const e = document.getElementById('wkNote'); return e ? e.textContent : '';
    });
    check('ويقول لك ماذا تفعل بعد النسخ', /Edit code/.test(note), note);
    await pg.click('#modalHost .m-head button[data-x]'); await sleep(400);
  }

  console.log('\n== 15ج. نافذة «المشاهدة من التلفون» ==');
  {
    /* بلا ربط: يجب أن يقودك لإعداده لا أن يعطيك عنواناً فارغاً */
    await pg.evaluate(() => Stock.phoneView()); await sleep(600);
    const guided = await pg.$('#modalHost .modal h3');
    const t0 = guided ? (await guided.textContent()).trim() : '';
    check('بلا ربط يفتح إعداد الربط لا نافذة فارغة', t0 === 'إعداد ربط الفروع', t0);
    await pg.click('#modalHost .m-head button[data-x]').catch(() => { }); await sleep(400);

    await pg.evaluate(() => {
      App.S.sync.url = 'https://maktaba.example.workers.dev';
      App.S.sync.key = 'sirr-alrabt';
      App.saveNow();
    }); await sleep(400);
    await pg.evaluate(() => { location.hash = '#/stock'; App.route(); }); await sleep(600);
    const btn = await pg.$('button:has-text("المشاهدة من التلفون")');
    check('الزر يظهر بعد ضبط الربط', !!btn);
    await btn.click(); await sleep(600);
    const vals = await pg.evaluate(() => ['pvSite', 'pvSync', 'pvKey'].map(
      i => { const e = document.getElementById(i); return e ? e.value : null; }));
    check('حقل رابط الموقع فارغ قبل ضبطه', vals[0] === '', vals[0]);
    check('ويسلّمك عنوان الربط', vals[1] === 'https://maktaba.example.workers.dev', vals[1]);
    check('وكلمة السر', vals[2] === 'sirr-alrabt', vals[2]);
    const ro = await pg.evaluate(() => ({
      site: document.getElementById('pvSite').readOnly,
      sync: document.getElementById('pvSync').readOnly,
      key: document.getElementById('pvKey').readOnly
    }));
    check('بيانات الربط للقراءة فقط فلا تُعدَّل بالخطأ', ro.sync && ro.key, JSON.stringify(ro));
    check('ورابط الموقع يُكتب لأنه يختلف من محل لمحل', ro.site === false);

    /* رابط Netlify يُحفظ مع بيانات المحل، فلا يُكتب في كل مرة */
    await pg.fill('#pvSite', 'daralhikma.netlify.app');
    await pg.click('#modalHost .m-foot button:has-text("حفظ وتحديث اللقطة")');
    await sleep(700);
    const saved = await pg.evaluate(() => App.S.sync.site);
    check('ويُحفظ مع https:// مضافة', saved === 'https://daralhikma.netlify.app', saved);
    await pg.evaluate(() => Stock.phoneView()); await sleep(600);
    const back = await pg.evaluate(() => document.getElementById('pvSite').value);
    check('ويعود ظاهراً في المرة القادمة', back === 'https://daralhikma.netlify.app', back);
    const warns = await pg.evaluate(() => document.querySelector('#modalHost .m-body').textContent);
    check('ويحذّر من نشر كلمة السر', /لا ترسلها/.test(warns));
    check('ويقول إن أسعار الشراء لا تظهر', /الشراء/.test(warns));
    check('ويدلّك على Netlify', /netlify/i.test(warns));
    await pg.click('#modalHost .m-head button[data-x]'); await sleep(400);
  }

  await b.close();
  console.log('\n' + '='.repeat(50));
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('='.repeat(50) + '\n');
  process.exit(fail ? 1 : 0);
})();
