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

  console.log('\n== 15. سلامة التطبيق عموماً ==');
  writeStore(seed());
  await closePage(pg); pg = await open();
  for (const k of ['dash','pos','invoices','stocktake','stock','purchases','alerts','stale','labels','customers','consign','suppliers','profits','notify','settings']) {
    await pg.evaluate(x => { location.hash = '#/' + x; App.route(); }, k); await sleep(300);
  }
  check('15 شاشة بلا خطأ JavaScript', errs.length === 0, errs.slice(0, 4).join(' | '));

  await b.close();
  console.log('\n' + '='.repeat(50));
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('='.repeat(50) + '\n');
  process.exit(fail ? 1 : 0);
})();
