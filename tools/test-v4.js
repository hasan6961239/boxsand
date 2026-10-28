/* ============================================================
   test-v4.js — واجهة 4.0 على المحرك الحقيقي (المرحلة 4أ، قراران 0021 و0022)
   ------------------------------------------------------------
   تطبيق طرابلس على جهاز جديد: إعداد 4.0 مباشرة ببيانات تجربة ← دخول
   المدير ← لوحة اليوم ← بيعة من نقطة البيع بالبحث الجديد ← الفواتير ←
   إضافة كتاب وتعديله وحذفه ← موظف بكلمة سر ← المجلد الإضافي للنسخ ←
   «ابدأ من جديد بلا بيانات التجربة» ← إعادة تشغيل المحرك. ثم تطبيقا
   مصراتة وطرابلس مثبَّتين على جهاز واحد: كل واحد باسمه ومجلد بياناته.
   صور الشاشات في SHOTS (أو مجلد مؤقت).

   يحتاج: mono-mcs وxvfb-run وlibsqlite3 وplaywright-core.
     node tools/test-v4.js
   ============================================================ */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright-core');
const zlib = require('zlib');
const E = require('./engine');
const C = require('./fake-cloud');
const KEY = 'ui-test-key';

const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; const d = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)); failures.push(name + d); console.log('  FAIL  ' + name + d); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qv4-'));
  const dir = path.join(tmp, 'engine'), home = path.join(tmp, 'home');
  const shots = process.env.SHOTS || path.join(tmp, 'shots');
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  console.log('يبني تطبيق طرابلس...');
  E.buildEngine(dir, 'tripoli');

  let eng = E.startEngine(dir, home), lastPage = null, cloud = null;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  try {
    let port = await E.waitPort(dir);
    const base = 'http://127.0.0.1:' + port;
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, locale: 'ar' });
    const page = await ctx.newPage();
    lastPage = page;
    const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.accept().catch(() => { }); });
    const shot = n => page.screenshot({ path: path.join(shots, n + '.png') });
    const top = '#modalHost .overlay:last-child';
    const text = sel => page.$eval(sel, e => e.textContent.trim()).catch(() => '');
    /* النموذج يركّز خانته الأولى بعد 60 ms: الكتابة قبلها قد تقع في الخانة الأولى */
    const formReady = () => page.waitForFunction(() => {
      const ov = document.querySelector('#modalHost .overlay:last-child');
      const f = ov && ov.querySelector('.m-body input,.m-body select,.m-body textarea');
      return f && document.activeElement === f;
    }, null, { timeout: 3000 }).catch(() => { });
    const toastHas = s => page.waitForFunction(t => Array.prototype.some.call(document.querySelectorAll('#toasts .toast'),
      x => x.textContent.indexOf(t) >= 0), s, { timeout: 8000 }).then(() => true, () => false);

    console.log('\n== تطبيق طرابلس على جهاز جديد: إعداد 4.0 مباشرة ==');
    let info = (await E.call(port, '/api/info')).body;
    ok(info.edition === 'tripoli' && info.app === 'منظومة طرابلس' && info.db === false, 'تطبيق طرابلس، بلا قاعدة بعد', info);
    await page.goto(base + '/');
    await page.waitForSelector('#suShop', { timeout: 15000 });
    ok(await page.$('#modalHost .overlay') === null, 'يفتح إعداد 4.0 مباشرة، بلا شاشة ترحيب 3.x');
    ok(await page.evaluate(() => document.body.classList.contains('th-violet') && !document.body.classList.contains('th-green')), 'بلون طرابلس البنفسجي');
    ok(await page.title() === 'منظومة طرابلس' && await text('.login-wrap h2') === 'منظومة طرابلس', 'واسمه «منظومة طرابلس»', await page.title());
    ok(await page.$eval('#suCity', e => e.value) === 'طرابلس' && await page.$eval('#suDemo', e => e.value) === 'yes', 'المدينة طرابلس، وبيانات التجربة مختارة');
    const icon = await page.evaluate(() => fetch('/icon.png').then(r => r.arrayBuffer()).then(b => b.byteLength));
    ok(icon === fs.statSync(path.join(E.ROOT, 'app', 'icon-tripoli.png')).size, 'وأيقونته البنفسجية', icon);
    await page.click('#suGo');
    ok(await toastHas('اكتب اسم المحل'), 'بلا اسم محل لا يبدأ');
    await page.fill('#suShop', 'مكتبة التجربة');
    await E.sleep(200);
    await shot('01-setup');
    await page.click('#suGo');

    console.log('\n== 4.0: الدخول ولوحة اليوم ==');
    await page.waitForSelector('body.v4:not(.out) #nav .nav-item', { timeout: 20000 });
    ok(true, 'بعد الإنشاء تفتح واجهة 4.0، والمدير بلا كلمة سر يدخل مباشرة');
    ok(dialogs.length === 0, 'بلا نافذة «لم يكتمل الحفظ» عند الانتقال', dialogs);
    ok(await page.$eval('#demoTag', e => !e.hidden), 'علامة «نسخة تجربة» ظاهرة');
    ok(await text('#brandName') === 'مكتبة التجربة', 'اسم المحل في الأعلى', await text('#brandName'));
    ok(await text('#branchTag') === 'فرع طرابلس', 'وشارة الفرع', await text('#branchTag'));
    const ver = (fs.readFileSync(path.join(E.ROOT, 'src', 'Program.cs'), 'utf8').match(/AppVersion = "([^"]+)"/) || [])[1];
    ok(await page.waitForFunction(v => document.getElementById('ver').textContent === 'v' + v, ver, { timeout: 5000 }).then(() => true, () => false),
      'ورقم النسخة في الشريط الجانبي', ver);
    await page.waitForSelector('#dashStats .stat');
    await page.waitForSelector('#dashInv table tbody tr');
    const dashRows = await page.$$eval('#dashInv table tbody tr', r => r.length);
    ok(dashRows >= 5, 'لوحة اليوم: بيعات التجربة اليوم في «آخر الفواتير»', dashRows);
    const stat = await text('#dashStats .stat.hero .val');
    ok(Number(stat) > 0, 'ومبيعات اليوم أكبر من صفر', stat);
    const nav = await page.$$eval('#nav .nav-item', b => b.map(x => x.getAttribute('data-k')));
    ok(['dash', 'pos', 'invoices', 'items', 'settings'].every(k => nav.indexOf(k) >= 0), 'القائمة: اللوحة والبيع والفواتير والكتب والإعدادات', nav);
    await shot('03-dashboard');

    console.log('\n== نقطة البيع بالبحث الجديد ==');
    await page.keyboard.press('F2');
    await page.waitForSelector('#scan');
    ok(await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'scan', null, { timeout: 3000 }).then(() => true, () => false),
      'F2 يفتح البيع والمؤشر في حقل البحث');
    await page.type('#scan', 'الفيزياء الاساسيه', { delay: 15 });
    await page.waitForSelector('#sug .s-item');
    const sug = await page.$$eval('#sug .s-item b', b => b.map(x => x.textContent));
    ok(sug[0] === 'الفيزياء الأساسية', 'بلا همزة ولا تاء مربوطة: «الفيزياء الأساسية» أولاً', sug);
    ok(sug.indexOf('الفيزياء الأساسية الجزء الثاني') > 0, 'وجزؤها الثاني بعده', sug);
    await E.sleep(400);
    ok(await page.$eval('#sug', e => getComputedStyle(e).opacity === '1' && e.getBoundingClientRect().height > 100), 'والقائمة ظاهرة فعلاً تحت الحقل');
    await shot('04-pos-search');
    await page.press('#scan', 'Enter');
    await page.waitForSelector('#cartArea .cart-line');
    ok(await page.$eval('#cartArea .cart-line b', e => e.textContent) === 'الفيزياء الأساسية', 'Enter يضيف المطابق بالضبط');
    ok(await page.$eval('#cartArea .cart-line input', e => e.value) === '1' && await text('#tNet') === '30.00', 'بكمية 1 وسعره القطاعي', await text('#tNet'));
    await page.type('#scan', 'الفزياء', { delay: 15 });
    await page.waitForSelector('#sug .s-head');
    ok((await text('#sug .s-head')).indexOf('هل تقصد') >= 0, 'خطأ إملائي: «هل تقصد؟» فوق النتائج القريبة', await text('#sug .s-head'));
    await page.click('#sug .s-item[data-i="0"]');
    await page.waitForFunction(() => document.querySelector('#cartArea .cart-line input').value === '2' ||
      document.querySelectorAll('#cartArea .cart-line').length === 2);
    ok(true, 'والاختيار باليد من «هل تقصد؟» يضيف');
    await page.type('#scan', 'قلم', { delay: 15 });
    await page.waitForSelector('#sug .s-item');
    await page.click('#sug .s-item[data-i="0"]');
    const lines = await page.$$eval('#cartArea .cart-line', l => l.length);
    ok(lines >= 2, 'كتاب وقرطاسية في فاتورة واحدة', lines);
    const net = await text('#tNet');
    await shot('05-pos-cart');
    await page.press('#scan', 'Enter');
    await page.waitForSelector(top + ' .pay-choices');
    await E.sleep(350);
    await shot('06-pos-pay');
    await page.keyboard.press('1');
    ok(await toastHas('تمت البيعة'), 'Enter على حقل فارغ ← الدفع، و1 = نقداً: تمت البيعة');
    await page.waitForSelector('#cartArea >> text=آخر فاتورة رقم');
    const lastNo = await page.$eval('#cartArea .card .num', e => e.textContent);
    ok(Number(lastNo) >= 10, 'رقم الفاتورة بعد بيعات التجربة', lastNo);
    await shot('07-pos-done');

    console.log('\n== الفواتير ==');
    await page.click('#nav .nav-item[data-k="invoices"]');
    await page.waitForSelector('#invBody table tbody tr');
    const firstNo = await page.$eval('#invBody table tbody tr td b', e => e.textContent);
    ok(firstNo === lastNo, 'الفاتورة الجديدة أول القائمة', [firstNo, lastNo]);
    await page.click('#invBody table tbody tr .btn');
    await page.waitForSelector(top + ' .kv');
    const shown = await page.$$eval(top + ' .m-body table tbody tr', r => r.length);
    ok(shown === lines, 'عرض الفاتورة: أسطرها كما بيعت', [shown, lines]);
    ok((await text(top + ' .m-body')).indexOf(net) >= 0, 'والصافي نفسه', net);
    await E.sleep(350);
    await shot('08-invoice');
    await page.click(top + ' [data-x]');

    console.log('\n== الكتب والقرطاسية ==');
    await page.click('#nav .nav-item[data-k="items"]');
    await page.waitForSelector('#itBody table tbody tr');
    ok(await page.waitForFunction(() => !document.querySelector('.busy-veil'), null, { timeout: 1500 }).then(() => true, () => false),
      'دائرة «يفتح …» تختفي بعد رسم الصفحة');
    const count = await text('#itCount');
    ok(/^\d+\+? صنف/.test(count) && parseInt(count, 10) >= 150, 'الأصناف صفحة صفحة مع العدد', count);
    ok((await page.$$eval('#itBody .place-path', p => p.filter(x => x.textContent.trim()).length)) > 0, 'ومكان كل صنف مساراً', '');
    await shot('09-items');
    await page.fill('#itQ', 'رواية');
    await page.waitForFunction(() => { const c = document.getElementById('itCount'); return c && /يطابق/.test(c.textContent); });
    ok(true, 'البحث في صفحة الأصناف', await text('#itCount'));
    await page.click('.toolbar .btn.primary');
    await page.waitForSelector(top + ' #f_title');
    await formReady();
    await page.fill(top + ' #f_title', 'كتاب الاختبار الآلي');
    await page.fill(top + ' #f_by', 'مؤلف الاختبار');
    await page.fill(top + ' #f_barcode', '9990001112223');
    await page.fill(top + ' #f_price', '12.5');
    await page.fill(top + ' #f_qty', '3');
    await E.sleep(350);
    await shot('10-item-add');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('أُضيف: كتاب الاختبار الآلي'), 'إضافة كتاب');
    await page.fill('#itQ', '9990001112223');
    await page.waitForFunction(() => {
      const b = document.querySelector('#itBody table tbody tr b.name');
      return b && b.textContent === 'كتاب الاختبار الآلي';
    });
    ok((await text('#itBody table tbody tr td.num:nth-of-type(5)')) === '12.50' || (await text('#itBody')).indexOf('12.50') >= 0, 'بالباركود يظهر بسعره 12.50');
    await page.click('#itBody table tbody tr .btn');
    await page.waitForSelector(top + ' #f_price');
    await formReady();
    await page.fill(top + ' #f_price', '15');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('حُفظ: كتاب الاختبار الآلي'), 'تعديل السعر');
    await page.waitForFunction(() => document.getElementById('itBody').textContent.indexOf('15.00') >= 0);
    await page.click('#itBody table tbody tr .btn');
    await page.waitForSelector(top + ' .m-foot .btn.danger');
    await page.click(top + ' .m-foot .btn.danger');
    await page.waitForSelector(top + ' >> text=احذف');
    await page.click(top + ' .m-foot .btn.danger');
    ok(await toastHas('حُذف: كتاب الاختبار الآلي'), 'حذف الصنف');
    await page.waitForFunction(() => !document.querySelector('#itBody table tbody tr b.name'));
    ok(await page.$$eval('#modalHost .overlay', o => o.length) === 0, 'ونافذة التعديل أُغلقت معه');

    console.log('\n== الزبائن والديون، الإرجاع، الجرد وإقفال اليوم ==');
    await page.click('#nav .nav-item[data-k="customers"]');
    await page.waitForSelector('#cuList table');
    ok(/إجمالي الديون على الزبائن/.test(await text('#cuStats')), 'صفحة الزبائن: إجمالي الديون وعدد الزبائن');
    await page.click('#view button:has-text("+ زبون جديد")');
    await page.waitForSelector(top + ' #f_name');
    await formReady();
    await page.fill(top + ' #f_name', 'زبون الاختبار');
    await page.fill(top + ' #f_phone', '0912345678');
    await page.fill(top + ' #f_opening', '40');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('أُضيف: زبون الاختبار'), 'زبون جديد بدين سابق');
    await page.fill('#cuQ', 'زبون الاختبار');
    await page.waitForFunction(() => /زبون الاختبار/.test(document.getElementById('cuList').textContent) &&
      document.querySelectorAll('#cuList tbody tr').length === 1);
    ok((await text('#cuList')).indexOf('40.00') >= 0, 'والبحث يجده بدينه 40');
    await page.click('#cuList button:has-text("تسديد")');
    await page.waitForSelector(top + ' #f_amount');
    await formReady();
    ok(await page.$eval(top + ' #f_amount', e => e.value) === '40.00', 'التسديد يقترح الدين كله');
    await page.fill(top + ' #f_amount', '15');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('المتبقي: 25.00'), 'تسديد 15: المتبقي 25');
    await page.waitForFunction(() => /25\.00/.test(document.getElementById('cuList').textContent));
    await page.click('#cuList button:has-text("كشف حساب")');
    await page.waitForSelector(top + ' table tbody tr');
    const stRows = await page.$$eval(top + ' table tbody tr', r => r.map(x => x.textContent));
    ok(stRows.length === 2 && /تسديد/.test(stRows[0]) && /دين سابق/.test(stRows[1]) && /25\.00/.test(stRows[0]),
      'كشف الحساب: الدين السابق ثم التسديد، والرصيد بعد كل حركة', stRows);
    await shot('11a-statement');
    await page.keyboard.press('Escape');
    await page.click('#cuList button:has-text("حذف")');
    ok(await toastHas('سدّده أولاً'), 'زبون عليه دين لا يُحذف');

    await page.click('#nav .nav-item[data-k="pos"]');
    await page.waitForSelector('#scan');
    await page.fill('#scan', 'الفيزياء الأساسية');
    await page.press('#scan', 'Enter');
    await page.waitForSelector('#cartArea .cart-line');
    await page.click('#doneBtn');
    await page.waitForSelector('#modalHost [data-m="credit"]');
    await page.click('#modalHost [data-m="credit"]');
    await page.waitForSelector('#payNewCust');
    await page.click('#payNewCust');
    await page.waitForSelector(top + ' #f_name');
    await formReady();
    await page.fill(top + ' #f_name', 'زبون من البيع');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await page.waitForFunction(() => { const x = document.getElementById('payCust'); return x && x.selectedOptions[0] && x.selectedOptions[0].textContent === 'زبون من البيع'; },
      null, { timeout: 8000 }).then(() => true, () => false), 'نقطة البيع: «+ زبون جديد» من الآجل يُضاف ويُختار');
    await page.fill('#payNow', '10');
    await page.click('#payCredit');
    ok(await toastHas('تمت البيعة'), 'بيعة آجلة 30 له، دفع منها 10');

    await page.click('#nav .nav-item[data-k="invoices"]');
    await page.waitForSelector('#invBody table');
    await page.click('#invBody tbody tr:first-child button:has-text("إرجاع")');
    await page.waitForSelector(top + ' .ret-q');
    await page.fill(top + ' .ret-q', '1');
    ok(await text(top + ' #retSum') === '30.00', 'نافذة الإرجاع: يُرجَع 30', await text(top + ' #retSum'));
    await shot('11b-return');
    await page.click(top + ' .m-foot .btn.danger');
    ok(await toastHas('أُنقص من دين الزبون 20.00') && await toastHas('يُردّ نقداً 10.00'), 'الإرجاع الآجل: ينقص دينه 20 ويُردّ له 10 نقداً');
    await page.waitForFunction(() => /إرجاع/.test(document.querySelector('#invBody tbody tr:first-child').textContent));
    await page.click('#invBody tbody tr:nth-child(2) button:has-text("عرض")');
    await page.waitForSelector(top + ' >> text=أُرجع منها');
    ok((await text(top + ' table')).indexOf('أُرجع 1') >= 0 && await page.$(top + ' .m-foot button:has-text("إرجاع")') === null,
      'الفاتورة تقول ما أُرجع منها، ولا إرجاع بعد أن أُرجع كلها');
    await page.keyboard.press('Escape');

    await page.click('#nav .nav-item[data-k="stocktake"]');
    await page.waitForSelector('#closeCard');
    const tk = await page.evaluate(() => V4.call('takings', {}));
    ok(tk.cash === tk.salesCash + tk.upfront + tk.debtPaid - tk.refundCredit - tk.consOut && tk.debtPaid >= 15000 && tk.refundCredit >= 10000,
      'الجرد بحساب 3.x: التسديد والمقدّم داخل الصندوق، والمردود نقداً خارج منه', tk);
    const want = await page.evaluate(c => V4.money(c), tk.cash);
    ok(await page.$eval('#closeCard input[disabled]', e => e.value) === want, 'إقفال الصندوق: النقد المفروض ' + want);
    await page.fill('#cashCount', String((tk.cash - 1000) / 1000));
    await page.click('#closeCard button:has-text("إقفال اليوم")');
    ok(await toastHas('عجز 1.00'), 'عُدّ أقل بدينار: «عجز 1.00»');
    await page.waitForSelector('#closeCard >> text=أُقفل');
    ok((await text('#closeCard')).indexOf('عجز 1.00') >= 0, 'والإقفال محفوظ بفرقه');
    await shot('11c-stocktake');
    await page.click('#nav .nav-item[data-k="dash"]');
    await page.waitForSelector('#dashStats .stat');
    ok((await text('#dashStats')).indexOf(want) >= 0, 'ولوحة اليوم تقول نفس النقد', await text('#dashStats'));

    console.log('\n== إدخال بضاعة واللاصقات ==');
    await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await page.click('#nav .nav-item[data-k="receive"]');
    await page.waitForSelector('#rcQ');
    await page.waitForFunction(() => document.querySelectorAll('#rcSup option').length >= 1);
    await page.fill('#rcQ', 'قلم جاف أزرق');
    await page.press('#rcQ', 'Enter');
    await page.waitForSelector('#rcLines tbody tr');
    await page.fill('#rcLines tbody tr input', '5');
    await page.press('#rcLines tbody tr input', 'Tab');
    await page.fill('#rcNote', 'فاتورة المورد 15');
    await page.dispatchEvent('#rcNote', 'input');
    const haveBefore = Number(await page.$eval('#rcLines tbody tr td:nth-child(2)', e => e.textContent));
    ok((await text('#rcLines tbody tr td:nth-child(6)')).indexOf(String(haveBefore + 5)) === 0, 'السطر: الموجود + الواصل = «يصير»', [haveBefore, await text('#rcLines tbody tr td:nth-child(6)')]);
    await shot('12a-receive');
    await page.click('#rcSave');
    ok(await toastHas('أُدخلت البضاعة: 1 صنف · 5 قطعة'), 'إدخال بضاعة: 5 أقلام للرفوف');
    await page.waitForSelector('#rcHist tbody tr');
    ok((await text('#rcHist tbody tr')).indexOf('فاتورة المورد 15') >= 0, 'وفي سجل الإدخالات بملاحظته');
    await page.click(top + ' >> text=اطبع لاصقاتها');
    await page.waitForSelector(top + ' #lblPreview .lbl-one svg', { timeout: 15000 });
    ok(await page.$$eval(top + ' #lblPreview .lbl-one', x => x.length) === 5, 'اطبع لاصقاتها: 5 لاصقات للأقلام الخمسة');
    await shot('12b-labels-preview');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('طُبعت 5 لاصقة') && await page.waitForFunction(() => window.__printed === 1, null, { timeout: 3000 }).then(() => true, () => false),
      'الطباعة، وعلامة «طُبعت»');
    await page.fill('#lblQ', 'قلم جاف أزرق');
    await page.waitForFunction(() => /كل اللاصقات مطبوعة|لا أصناف/.test(document.getElementById('lblBody').textContent));
    ok(true, 'وخرج من «لم تُطبع»');

    /* صنف بلا باركود: يُولَّد له عند الطباعة ويُمسح بعدها */
    await page.click('#nav .nav-item[data-k="items"]');
    await page.click('#view button:has-text("+ صنف جديد")');
    await page.waitForSelector(top + ' #f_title');
    await formReady();
    await page.fill(top + ' #f_title', 'دفتر بلا باركود');
    await page.fill(top + ' #f_price', '3');
    await page.fill(top + ' #f_qty', '2');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('أُضيف: دفتر بلا باركود'), 'صنف جديد بلا باركود');
    await page.click('#nav .nav-item[data-k="labels"]');
    await page.waitForSelector('#lblQ');
    await page.fill('#lblQ', 'دفتر بلا باركود');
    await page.waitForSelector('#lblBody >> text=يُولَّد عند الطباعة');
    await page.click('#lblBody tbody tr input[type=checkbox]');
    await page.click('#lblPrint');
    ok(await toastHas('وُلِّد باركود لـ1 صنف'), 'المعاينة تولّد له باركوداً');
    await page.waitForSelector(top + ' #lblPreview .lbl-one');
    ok(await page.$$eval(top + ' #lblPreview .lbl-one', x => x.length) === 2, 'لاصقتان بعدد كميته');
    await page.keyboard.press('Escape');
    const gen = await page.evaluate(() => V4.call('items.page', { q: 'دفتر بلا باركود', limit: 1 }).then(d => d.items[0].barcode));
    ok(/^[1-9]\d{7}$/.test(gen), 'باركود من 8 أرقام محفوظ على الصنف', gen);
    const found = await page.evaluate(b => V4.call('item.find', { barcode: b }), gen);
    ok(found && found.title === 'دفتر بلا باركود', 'ويُمسح في البيع');

    console.log('\n== المخزون والأماكن، التنبيهات، الراكدة، جرد المخزون ==');
    await page.click('#nav .nav-item[data-k="stock"]');
    await page.waitForSelector('#stHost .branch-card');
    const cards = await page.$$eval('#stHost .branch-card .bc-tag', x => x.map(e => e.textContent));
    ok(cards[0] === 'المحل' && cards.indexOf('مخزن') > 0, 'المخزون: بطاقة المحل وبطاقة لكل مخزن', cards);
    await page.click('#stHost .branch-card:has(.bc-tag.wh)');
    await page.waitForSelector('#stItems tbody tr');
    const firstStore = await text('#stItems tbody tr:first-child b.name');
    ok(firstStore.length > 0, 'ما في المخزن صنفاً صنفاً', firstStore);
    await page.click('#stItems tbody tr:first-child button:has-text("نقل")');
    await page.waitForSelector(top + ' #f_qty');
    await formReady();
    await page.fill(top + ' #f_qty', '1');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('نُقل 1 من «' + firstStore + '»'), 'نقل نسخة من المخزن إلى مكانها');
    await page.click('#stHost button:has-text("نقل بالقارئ")');
    await page.waitForSelector(top + ' #mvScan');
    await page.fill(top + ' #mvScan', firstStore);
    await page.press(top + ' #mvScan', 'Enter');
    await page.waitForSelector(top + ' #mvLines tbody tr');
    await shot('12c-scan-move');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('نُقلت 1 نسخة'), 'النقل بالقارئ: مسحة ثم تأكيد');
    await page.click('#stHost button:has-text("كل الأماكن")');
    await page.waitForSelector('#stHost button:has-text("+ إضافة مخزن")');
    await page.click('#stHost button:has-text("+ إضافة مخزن")');
    await page.waitForSelector(top + ' #f_name');
    await formReady();
    await page.fill(top + ' #f_name', 'مخزن الاختبار');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('أُضيف: مخزن الاختبار'), 'إضافة مخزن');
    await page.waitForSelector('#stHost >> text=مخزن الاختبار');
    await page.click('#stHost button:has-text("شجرة الأماكن")');
    await page.waitForSelector(top + ' #ptree');
    ok((await text(top + ' #ptree')).indexOf('مخزن الاختبار') >= 0, 'وشجرة الأماكن فيها');
    await shot('12d-places-tree');
    await page.keyboard.press('Escape');

    await page.click('#nav .nav-item[data-k="alerts"]');
    await page.waitForSelector('#alStats .stat');
    ok(/نفدت تماماً/.test(await text('#alStats')) && await page.$('#alList table, #alList .empty') !== null, 'التنبيهات: النافد والقارب وقائمة الشراء');
    await page.click('#nav .nav-item[data-k="stale"]');
    await page.waitForSelector('#stStats .stat');
    ok(/حد الركود/.test(await text('#stStats')), 'البضاعة الراكدة: البطاقات وحد الركود');

    await page.click('#nav .nav-item[data-k="count"]');
    await page.waitForSelector('#cnScope');
    await page.selectOption('#cnScope', 'stat');
    await page.waitForFunction(() => /صنف في هذا النطاق/.test(document.getElementById('cnN').textContent));
    await page.click('#cnHost button:has-text("ابدأ الجرد")');
    await page.waitForSelector('#cnScan');
    await page.fill('#cnScan', '621000000000');
    await page.press('#cnScan', 'Enter');
    ok(await toastHas('قلم جاف أزرق → 1'), 'جرد القرطاسية: مسحة القلم → 1');
    await page.fill('#cnScan', '621000000000');
    await page.press('#cnScan', 'Enter');
    ok(await toastHas('قلم جاف أزرق → 2'), 'ومسحة ثانية → 2');
    const bookCode = await page.evaluate(() => V4.call('items.page', { kind: 'book', limit: 200 }).then(d => d.items.filter(x => x.barcode)[0].barcode));
    await page.fill('#cnScan', bookCode);
    await page.press('#cnScan', 'Enter');
    ok(await toastHas('خارج نطاق هذا الجرد'), 'كتاب في جرد القرطاسية: «خارج نطاق هذا الجرد»',
      [bookCode, await page.$$eval('#toasts .toast', t => t.map(x => x.textContent).slice(-4))]);
    await page.waitForFunction(() => /عُدّ 1 من/.test(document.getElementById('cnDone').textContent));
    await shot('12e-count');
    await page.click('#cnHost button:has-text("الباقي مطابق")');
    await page.click(top + ' >> text=اعتبرها مطابقة');
    ok(await toastHas('اعتُبر'), '«الباقي مطابق»');
    await page.click('#cnHost button:has-text("إنهاء وتصحيح المخزون")');
    await page.click(top + ' >> text=صحّح المخزون');
    ok(await toastHas('صُحّح 1 صنفاً'), 'التصحيح: صنف واحد فيه فرق (القلم)');
    await page.waitForSelector('#cnPast tbody tr');
    ok(true, 'والجرد في عمليات الجرد السابقة');

    console.log('\n== كتب على المباع، الموردون ودور النشر ==');
    await page.click('#nav .nav-item[data-k="consign"]');
    await page.waitForSelector('#cnList >> text=لا يوجد كتب على المباع');
    ok(true, 'كتب على المباع: فارغة في البداية');
    await page.click('#cnHost button:has-text("استلام كتب جديدة")');
    await page.waitForSelector(top + ' #cnName');
    /* الخانة تُقرأ مع change (كما عند الخروج منها) */
    const cnLine = async (i, col, v) => {
      const sel = top + ' #cnLines tbody tr:nth-child(' + (i + 1) + ') ' + (col === 3 ? 'td:nth-child(2) input:nth-child(2)' :
        col === 2 ? 'td:nth-child(2) input:nth-child(1)' : 'td:nth-child(' + (col - 1) + ') input');
      await page.fill(sel, v);
      await page.dispatchEvent(sel, 'change');
    };
    await page.fill(top + ' #cnName', 'أحمد صاحب الكتب');
    await page.fill(top + ' #cnPhone', '0911111111');
    await cnLine(0, 2, 'رواية على المباع');
    await cnLine(0, 3, 'كاتب محلي');
    await cnLine(0, 5, '3');
    await cnLine(0, 6, '8');
    await cnLine(0, 7, '10');
    ok((await text(top + ' #cnProf0')) === '6.00', 'ربحك من السطر يُحسب وأنت تكتب (3 × 2)', await text(top + ' #cnProf0'));
    await page.click(top + ' button:has-text("إضافة كتاب")');
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'cnLine1'), 'سطر جديد والمؤشر في اسمه');
    await cnLine(1, 2, 'كتاب بباركود المحل');
    await cnLine(1, 4, bookCode);
    await cnLine(1, 6, '5');
    await cnLine(1, 7, '7');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('مستعمل للصنف'), 'كود مستعمل لكتاب يبيعه المحل يُرفض');
    ok(await page.$(top + ' #cnName') !== null && await page.$eval(top + ' #cnName', e => e.value) === 'أحمد صاحب الكتب', 'والنافذة تبقى بما كُتب فيها');
    await cnLine(1, 4, '');
    await shot('14a-consign-in');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('سُجّلت الكتب ودخلت المخزون'), 'استلام كتابين على المباع من صاحب جديد');
    await page.waitForSelector('#cnList >> text=أحمد صاحب الكتب');
    let cnRow = await page.$$eval('#cnList tbody tr td', t => t.map(x => x.textContent.trim()));
    ok(cnRow[1] === '2' && cnRow[4] === '4' && cnRow[5] === 'خالص', 'في القائمة: عنوانان و4 نسخ عندك، ولا مستحق بعد', cnRow);
    const cnSold = await page.evaluate(async () => {
      const o = (await V4.call('consignors.list'))[0];
      const g = await V4.call('consignor.get', { id: o.id });
      const l = g.lines.filter(x => x.title === 'رواية على المباع')[0];
      const it = await V4.call('item.get', { id: l.itemId });
      await V4.call('sale', { lines: [{ itemId: l.itemId, qty: 2, price: l.price }], discount: 0, method: 'cash', mode: 'retail' });
      return [it.cat, it.qty, it.cost];
    });
    ok(cnSold[0] === 'على المباع' && cnSold[1] === 3 && cnSold[2] === 8000, 'صار صنفاً في المحل: «على المباع»، 3 نسخ، وسعر شرائه ما يأخذه صاحبه', cnSold);
    await page.click('#nav .nav-item[data-k="dash"]');
    await page.click('#nav .nav-item[data-k="consign"]');
    await page.waitForSelector('#cnList >> text=16.00');
    cnRow = await page.$$eval('#cnList tbody tr td', t => t.map(x => x.textContent.trim()));
    ok(cnRow[3] === '2' && cnRow[5] === '16.00' && cnRow[6] === '4.00', 'بعد بيع نسختين: المستحق له 16.00 وربحك 4.00', cnRow);
    await page.click('#cnList button:has-text("كشف الحساب")');
    await page.waitForSelector('#cnHost >> text=سجل التسديدات');
    ok((await text('#cnHost')).indexOf('من أصل 16.00') >= 0, 'كشف حسابه: الكتب والمستحق');
    await page.click('#cnHost tr:has-text("رواية على المباع") button:has-text("إرجاع لصاحبه")');
    await page.waitForSelector(top + ' #f_n');
    await formReady();
    ok(await page.$eval(top + ' #f_n', e => e.value) === '1', 'الإرجاع لصاحبه: الباقي عندك 1');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('سُجّل الإرجاع'), 'أُعيدت النسخة الباقية لصاحبها');
    await page.waitForFunction(() => {
      const r = Array.prototype.filter.call(document.querySelectorAll('#cnHost tr'), x => /رواية على المباع/.test(x.textContent))[0];
      return r && !/إرجاع لصاحبه/.test(r.textContent);
    });
    ok(await page.evaluate(() => V4.call('search', { q: 'رواية على المباع', limit: 5 }).then(d => d.items.length ? d.items[0].qty : -1)) === 0,
      'وخرجت من المخزون');
    await page.click('#cnHost button:has-text("تسديد المستحق")');
    await page.waitForSelector(top + ' #f_amount');
    await formReady();
    ok(await page.$eval(top + ' #f_amount', e => e.value) === '16.00', 'التسديد: المستحق كله مكتوب');
    await page.fill(top + ' #f_amount', '20');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('لا تسدّد أكثر منه'), 'أكثر من المستحق يُرفض');
    await page.fill(top + ' #f_amount', '10');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('المتبقي: 6.00'), 'تسديد 10 من الدرج: المتبقي 6.00');
    await page.waitForSelector('#cnHost >> text=درج المحل');
    ok((await text('#cnHost')).indexOf('سُدّد 10.00') >= 0, 'وفي سجل التسديدات');
    const p0 = await page.evaluate(() => window.__printed || 0);
    await page.click('#cnHost button:has-text("طباعة الكشف")');
    ok(await page.waitForFunction(n => window.__printed === n + 1, p0, { timeout: 3000 }).then(() => true, () => false), 'طباعة كشف حسابه');
    await page.click('#cnHost button:has-text("تعديل البيانات")');
    await page.waitForSelector(top + ' #f_phone');
    await formReady();
    await page.fill(top + ' #f_phone', '0922222222');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('حُفظت البيانات'), 'تعديل بيانات صاحب البضاعة');
    await page.waitForSelector('#cnHost .badge >> text=0922222222');
    await shot('14b-consign-owner');
    await page.click('#cnHost button:has-text("الكل")');
    await page.waitForSelector('#cnList >> text=أحمد صاحب الكتب');
    ok((await text('#cnHost .stat.bad .val')) === '6.00', 'والقائمة: مستحق لأصحابها 6.00', await text('#cnHost .stat.bad .val'));

    await page.click('#nav .nav-item[data-k="suppliers"]');
    await page.waitForSelector('#spSups >> text=دار المعرفة للتوزيع');
    ok((await text('#spSups')).indexOf('شركة الأفق للقرطاسية') >= 0, 'الموردون: موردا بيانات التجربة');
    await page.waitForSelector('#spPubs >> text=لا دور نشر مسجّلة');
    await page.click('#spPubCard button:has-text("دار نشر جديدة")');
    await page.waitForSelector(top + ' #f_rate');
    await formReady();
    await page.fill(top + ' #f_name', 'دار الشروق');
    await page.fill(top + ' #f_rate', '150');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('أقل من 100%'), 'خصم 150 يُرفض');
    await page.fill(top + ' #f_rate', '25');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('على أنها خصم 25%') && await toastHas('قطاعي 100 ← جملة 75.00'), '«25» تُفهم خصم 25%: قطاعي 100 ← جملة 75');
    await page.waitForSelector('#spPubs >> text=دار الشروق');
    ok(/25%/.test(await text('#spPubs tbody tr')) && /75\.00/.test(await text('#spPubs tbody tr')), 'دار النشر في الجدول بنسبتها', await text('#spPubs tbody tr'));
    await page.click('#spPubs button:has-text("تعديل")');
    await page.waitForSelector(top + ' #f_rate');
    await formReady();
    ok(await page.$eval(top + ' #f_rate', e => e.value) === '25', 'التعديل يفتح بنسبتها', await page.$eval(top + ' #f_rate', e => e.value));
    await page.fill(top + ' #f_rate', '0.1');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('قطاعي 100 ← جملة 90.00'), '0.1 تُفهم خصم 10%');
    await page.click('#spPubCard button:has-text("دار نشر جديدة")');
    await page.waitForSelector(top + ' #f_name');
    await formReady();
    await page.fill(top + ' #f_name', 'دار الشروق');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('موجودة'), 'دار نشر مكررة تُرفض');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#modalHost .overlay'));
    await page.click('#view .toolbar button:has-text("مورد جديد")');
    await page.waitForSelector(top + ' #f_city');
    await formReady();
    await page.fill(top + ' #f_name', 'مورد الاختبار');
    await page.fill(top + ' #f_phone', '0933333333');
    await page.fill(top + ' #f_city', 'مصراتة');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('حُفظت بيانات المورد'), 'مورد جديد');
    await page.waitForSelector('#spSups >> text=مورد الاختبار');
    await shot('14c-suppliers');
    await page.click('#spSups tr:has-text("مورد الاختبار") button:has-text("حذف")');
    await page.click(top + ' .m-foot button:has-text("حذف")');
    ok(await toastHas('حُذف: مورد الاختبار'), 'وحذفه');
    await page.waitForFunction(() => !/مورد الاختبار/.test(document.getElementById('spSups').textContent));

    /* كتاب جديد من دار نشر لها خصم: سعر الجملة وحده، كما في 3.x */
    await page.click('#nav .nav-item[data-k="items"]');
    await page.waitForSelector('#itQ');
    await page.evaluate(() => V4Items.edit(0));
    await page.waitForSelector(top + ' #f_publisher');
    await formReady();
    await page.fill(top + ' #f_publisher', 'دار الشروق');
    await page.fill(top + ' #f_price', '20');
    ok(await page.$eval(top + ' #f_priceW', e => e.value) === '18.00', 'صنف جديد من «دار الشروق»: سعر الجملة 18.00 وحده',
      await page.$eval(top + ' #f_priceW', e => e.value));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#modalHost .overlay'));
    await page.click('#nav .nav-item[data-k="suppliers"]');
    await page.waitForSelector('#spPubs >> text=دار الشروق');
    await page.click('#spPubs button:has-text("حذف")');
    await page.click(top + ' .m-foot button:has-text("حذف")');
    await page.waitForSelector('#spPubs >> text=لا دور نشر مسجّلة');
    ok(true, 'حذف دار النشر');

    console.log('\n== موظف بكلمة سر ==');
    await page.click('#nav .nav-item[data-k="settings"]');
    await page.waitForSelector('#setUsers table');
    await page.click('#setUsers .btn.primary');
    await page.waitForSelector(top + ' #f_name');
    await formReady();
    await page.fill(top + ' #f_name', 'سالم');
    await page.fill(top + ' #f_login', 'salem');
    await page.fill(top + ' #f_password', '4321');
    await page.click(top + ' .m-foot .btn.primary');
    await page.waitForSelector('#setUsers >> text=سالم');
    ok(true, 'المدير يضيف موظفاً');
    await shot('11-settings');
    await page.click('#logoutBtn');
    await page.waitForSelector('.login-wrap [data-login="salem"]');
    ok(await page.$$eval('.login-wrap [data-login]', b => b.length) === 2, 'بعد الخروج: شاشة الدخول بالأسماء');
    await page.click('.login-wrap [data-login="salem"]');
    await page.fill('#pw', '1111');
    await page.press('#pw', 'Enter');
    ok(await toastHas('كلمة السر'), 'كلمة سر خاطئة تُرفض');
    await page.fill('#pw', '4321');
    await shot('12-login');
    await page.press('#pw', 'Enter');
    await page.waitForSelector('body.v4:not(.out) #nav .nav-item');
    const staffNav = await page.$$eval('#nav .nav-item', b => b.map(x => x.getAttribute('data-k')));
    ok(staffNav.indexOf('pos') >= 0 && staffNav.indexOf('items') >= 0, 'الموظف: البيع والكتب', staffNav);
    ok((await text('#userChip')) === 'سالم', 'واسمه في الشريط الجانبي', await text('#userChip'));
    await page.click('#nav .nav-item[data-k="settings"]');
    await page.waitForSelector('#view .card');
    ok(await page.$('#setUsers') === null && await page.$('#setShop') === null, 'ولا يرى الموظفين ولا إعدادات المحل');
    await page.click('#logoutBtn');
    await page.waitForSelector('.login-wrap [data-login="admin"]');
    await page.click('.login-wrap [data-login="admin"]');
    await page.waitForSelector('body.v4:not(.out) #nav .nav-item');
    ok(true, 'المدير بلا كلمة سر يدخل بضغطة على اسمه');

    console.log('\n== المجلد الإضافي للنسخ ==');
    const usb = path.join(tmp, 'usb');
    await page.click('#nav .nav-item[data-k="settings"]');
    await page.waitForSelector('#bkOut >> text=غير محدد');
    ok((await text('#bkOut')).indexOf('qirtasiya-') >= 0, 'آخر نسخة يومية ظاهرة', await text('#bkOut'));
    await page.click('#view button:has-text("المجلد الإضافي")');
    await page.waitForSelector(top + ' #f_dir');
    await formReady();
    await page.fill(top + ' #f_dir', 'نسخ');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('اكتب المسار كاملاً'), 'مسار ناقص يُرفض');
    ok(await page.$eval(top + ' #f_dir', e => e.value) === 'نسخ', 'والنموذج يبقى مفتوحاً بما كُتب فيه');
    await page.fill(top + ' #f_dir', usb);
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('تُنسخ إليه نسخة اليوم'), 'المجلد الإضافي من إعدادات 4.0');
    let copied = [];
    for (let i = 0; i < 40 && !copied.length; i++) {
      await E.sleep(250);
      try { copied = fs.readdirSync(usb).filter(f => /^qirtasiya-\d{4}-\d\d-\d\d\.db$/.test(f)); } catch (e) { }
    }
    ok(copied.length === 1, 'ونسخة اليوم وصلته فوراً', copied);
    ok(fs.readFileSync(path.join(dir, 'data', 'backup-dir.txt'), 'utf8') === usb && (await text('#bkOut')).indexOf(usb) >= 0, 'ويبقى بعد إعادة التشغيل (backup-dir.txt)');

    console.log('\n== الربط والفروع من الواجهة (قرار 0023) ==');
    cloud = await C.start({ secret: KEY });
    await page.click('#nav .nav-item[data-k="branches"]');
    await page.waitForSelector('#brList >> text=لا فروع مربوطة بعد');
    ok((await text('#brList')).indexOf('اربط هذا الجهاز أولاً') >= 0, 'صفحة الفروع قبل الربط: «اربط هذا الجهاز أولاً»');
    await page.click('#view button:has-text("إضافة فرع")');
    await page.waitForSelector(top + ' >> text=نفس عنوان خادم الربط');
    ok(true, '«+ إضافة فرع» تشرح الخطوات');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#modalHost .overlay'));
    await page.click('#nav .nav-item[data-k="settings"]');
    await page.waitForSelector('#syncCard button:has-text("هذا جهاز المحل")');
    ok((await text('#syncState')) === 'غير مربوط' && (await text('#syncChip')) === '', 'الإعدادات: «غير مربوط»، وبلا شارة في الأعلى');
    ok((await text('#syncCard')).indexOf('نسخة تجربة: لا تُربط بخادم الربط الحقيقي') >= 0, 'وتنبّه: نسخة التجربة لا تُربط بالخادم الحقيقي');
    await page.click('#syncCard button:has-text("هذا جهاز المحل")');
    await page.waitForSelector(top + ' #f_url');
    await formReady();
    await page.fill(top + ' #f_url', 'https://maktaba-sync.example.workers.dev');
    await page.fill(top + ' #f_key', KEY);
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('هذه نسخة تجربة: لا تُربط بخادم الربط الحقيقي'), 'نسخة التجربة ترفض خادم ربط حقيقياً (قرار 0014)');
    ok(!cloud.log.length, 'ولم تتصل بأي خادم');
    await page.fill(top + ' #f_url', cloud.url);
    await page.fill(top + ' #f_key', 'wrong-key');
    await page.click(top + ' .m-foot .btn.primary');
    ok(await toastHas('كلمة سر الربط غير صحيحة'), 'كلمة سر ربط خاطئة تُرفض');
    ok(await page.$eval(top + ' #f_url', e => e.value) === cloud.url, 'والنموذج يبقى مفتوحاً بما كُتب فيه');
    await page.fill(top + ' #f_key', KEY);
    await page.click(top + ' .m-foot .btn.primary');
    ok(await page.waitForFunction(() => /مربوط/.test(document.getElementById('syncChip').textContent) &&
      document.getElementById('syncState').textContent === 'يعمل', null, { timeout: 60000 }).then(() => true, () => false),
      'رُبط: الشارة «مربوط» والبطاقة «يعمل»', await text('#syncChip'));
    ok(!(await page.$('#modalHost .overlay')), 'ونموذج الربط أُغلق');
    ok(cloud.log.some(l => /^POST \/v2\/snap /.test(l)), 'ورفع نسخته الأولى لخادم الربط');
    await shot('13a-sync-card');

    /* فرع مصراتة مربوط من قبل: قائمته على الخادم كما يرفعها جهاز محله */
    const catJson = JSON.stringify({ v: 1, branch: { id: 'misrata', name: 'مكتبة مصراتة', city: 'مصراتة', phone: '' }, at: '2026-10-28 10:00:00',
      items: [['book', 'B1', 'كتاب في مصراتة وحدها', 'مؤلف بعيد', '9780000000001', '', 3, 2, 15000, 'ط1 · رف 2'],
              ['book', 'B2', 'كتاب نفد في مصراتة', '', '', '', 0, 0, 9000, '']] });
    const H = { 'X-Shop-Key': KEY };
    let hr = await fetch(cloud.url + '/v2/hello?branch=misrata&device=misratamain01&role=main&name=x', { headers: H });
    ok(hr.status === 200, 'جهاز محل مصراتة على الخادم', hr.status);
    hr = await fetch(cloud.url + '/v2/catalog?branch=misrata&device=misratamain01&ver=catver0001&part=0&parts=1&n=2&name=' +
      encodeURIComponent('مكتبة مصراتة') + '&city=' + encodeURIComponent('مصراتة'),
      { method: 'POST', headers: H, body: zlib.gzipSync(Buffer.from(catJson)).toString('base64') });
    ok(hr.status === 200, 'وقائمة كتبه منشورة', hr.status);
    await page.click('#syncCard button:has-text("حدّث الآن")');
    ok(await toastHas('تم التحديث'), '«حدّث الآن» يجلب قوائم الفروع');
    await page.click('#nav .nav-item[data-k="branches"]');
    await page.waitForSelector('#brList .stat');
    const brCard = await text('#brList');
    ok(brCard.indexOf('مكتبة مصراتة') >= 0 && brCard.indexOf('2 صنف') >= 0 && brCard.indexOf('5 قطعة') >= 0, 'صفحة الفروع: مصراتة بأصنافها وقطعها', brCard);
    await page.fill('#brQ', 'مولف بعيد');
    await page.waitForSelector('#brBody table tbody tr');
    const brRow = await text('#brBody table tbody tr');
    ok(brRow.indexOf('كتاب في مصراتة وحدها') >= 0 && brRow.indexOf('15.00') >= 0 && brRow.indexOf('ط1 · رف 2') >= 0,
      'البحث بالمؤلف (بلا همزة): الكتاب بسعره ومكانه في مصراتة', brRow);
    await shot('13b-branches');
    await page.fill('#brQ', 'كتاب لا يوجد ابدا');
    await page.waitForSelector('#brBody >> text=لا شيء في الفروع الأخرى');
    ok(true, 'وما لا يوجد: «لا شيء في الفروع الأخرى»');
    await page.click('#nav .nav-item[data-k="pos"]');
    await page.waitForSelector('#scan');
    await page.fill('#scan', 'في مصراته وحدها');
    await page.waitForSelector('#posBranch .branch-hint');
    const posHint = await text('#posBranch');
    ok(posHint.indexOf('في الفروع الأخرى') >= 0 && posHint.indexOf('مكتبة مصراتة') >= 0 && posHint.indexOf('(5 · 15.00)') >= 0,
      'نقطة البيع: غير موجود هنا ← «في الفروع الأخرى» بالكمية والسعر', posHint);
    await shot('13c-pos-branch-hint');
    await page.fill('#scan', 'نفد في مصراتة');
    await page.waitForSelector('#posResults >> text=لا يوجد صنف بهذا الاسم');
    await E.sleep(600);
    ok((await text('#posBranch')) === '', 'وما نفد هناك أيضاً لا يُقترح', await text('#posBranch'));
    await page.fill('#scan', '');
    await page.click('#nav .nav-item[data-k="items"]');
    await page.fill('#itQ', 'كتاب في مصراتة وحدها');
    await page.waitForSelector('#itBranch .branch-hint');
    ok(true, 'صفحة الكتب: نفس التلميح حين لا يوجد هنا');
    await page.fill('#itQ', '');

    console.log('\n== ابدأ من جديد بلا بيانات التجربة ==');
    await page.click('#nav .nav-item[data-k="settings"]');
    await page.waitForSelector('#view >> text=ابدأ من جديد بلا بيانات التجربة');
    await page.click('#view >> text=ابدأ من جديد بلا بيانات التجربة');
    await page.waitForSelector(top + ' >> text=امسح وابدأ من جديد');
    await E.sleep(350);
    await shot('13-demo-reset');
    await page.click(top + ' >> text=امسح وابدأ من جديد');
    await page.waitForFunction(() => document.getElementById('demoTag').hidden && document.querySelector('#dashStats .stat'), null, { timeout: 20000 });
    ok(true, 'بعد المسح: لا علامة تجربة');
    ok(await text('#brandName') === 'مكتبة التجربة' && await text('#branchTag') === 'فرع طرابلس', 'واسم المحل والفرع كما هما');
    await page.waitForSelector('#dashInv');
    await page.waitForFunction(() => !/…/.test(document.getElementById('dashInv').textContent));
    ok(await page.$('#dashInv table tbody tr') === null, 'ولا فواتير');
    await page.click('#nav .nav-item[data-k="items"]');
    await page.waitForFunction(() => { const c = document.getElementById('itCount'); return c && /^0 صنف/.test(c.textContent); });
    ok(true, 'ولا أصناف');
    await shot('14-after-reset');
    const keep = fs.readdirSync(path.join(dir, 'data', 'backups')).filter(f => /^qirtasiya-demo-.*\.db$/.test(f));
    ok(keep.length === 1, 'نسخة التجربة محفوظة في backups', keep);
    /* نسخة اليوم كانت للتجربة: بعد المسح تُستبدل بالقاعدة الجديدة الفارغة */
    let dailyItems = -1;
    for (let i = 0; i < 40 && dailyItems !== 0; i++) {
      await E.sleep(250);
      try {
        const f = fs.readdirSync(path.join(dir, 'data', 'backups')).find(x => /^qirtasiya-\d{4}-\d\d-\d\d\.db$/.test(x));
        const db = new (require('node:sqlite').DatabaseSync)(path.join(dir, 'data', 'backups', f), { readOnly: true });
        dailyItems = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
        db.close();
      } catch (e) { }
    }
    ok(dailyItems === 0, 'ونسخة اليوم صارت للقاعدة الجديدة الفارغة', dailyItems);
    let r = await E.call(port, '/api/v2/login', { login: 'salem', password: '4321' });
    ok(r.body && r.body.ok === false, 'وموظفو التجربة ذهبوا معها', r.body);
    const st = await page.evaluate(() => V4.call('sync.now'));
    ok(st.linked === true && st.role === 'main' && !st.error && st.lastOk, 'والربط باقٍ: يرفع القاعدة الجديدة بلا خطأ', st);
    const snaps = cloud.log.filter(l => /^POST \/v2\/snap /.test(l)).length;
    ok(snaps >= 2, 'بنسخة كاملة جديدة للأجهزة الثانية', snaps);

    console.log('\n== إعادة تشغيل المحرك ==');
    E.stopEngine(eng);
    await E.sleep(500);
    eng = E.startEngine(dir, home);
    port = await E.waitPort(dir);
    await page.goto('http://127.0.0.1:' + port + '/');
    await page.waitForSelector('body.v4:not(.out) #nav .nav-item', { timeout: 20000 });
    ok(await text('#brandName') === 'مكتبة التجربة', 'بعد إعادة التشغيل: «/» تفتح 4.0 مباشرة');
    r = await E.call(port, '/api/v2/demo.reset', {}, {});
    ok(r.status === 401, 'مسح التجربة بلا جلسة: 401 (ادخل من جديد)', r.status);
    const tok = (await E.call(port, '/api/v2/login', { login: 'admin', password: '' })).body.data.token;
    r = await E.call(port, '/api/v2/demo.reset', {}, { 'X-Session': tok });
    ok(r.body && r.body.ok === false && /ليست نسخة تجربة/.test(r.body.error), 'وقاعدة حقيقية لا تُمسح أبداً', r.body);
    r = await E.call(port, '/api/v2/setting.set', { key: 'demo', value: true }, { 'X-Session': tok });
    ok(r.body && r.body.ok === false, 'ولا تُوضع عليها علامة التجربة من الأوامر', r.body);
    r = await E.call(port, '/api/v2/create', { shopName: 'x' });
    ok(r.status === 409 || (r.body && r.body.ok === false), 'ولا تُنشأ قاعدة ثانية فوقها', r.body);

    ok(errors.length === 0, 'بلا أخطاء JavaScript في الصفحة', errors);

    console.log('\n== تطبيقا مصراتة وطرابلس مثبَّتان على جهاز واحد (قرار 0022) ==');
    E.stopEngine(eng);
    const inst = { tripoli: path.join(tmp, 'inst-tripoli'), misrata: path.join(tmp, 'inst-misrata') };
    fs.mkdirSync(inst.tripoli); fs.mkdirSync(inst.misrata);
    for (const f of ['Qirtasiya.exe', 'Qirtasiya.exe.config']) fs.copyFileSync(path.join(dir, f), path.join(inst.tripoli, f));
    console.log('يبني تطبيق مصراتة...');
    E.buildEngine(inst.misrata, 'misrata');
    /* كما يتركه المثبّت: البيانات في مجلد المستخدم، لا بجانب البرنامج */
    for (const d of Object.values(inst)) fs.writeFileSync(path.join(d, 'installed.flag'), '4.0-test');
    const portOf = async name => {
      for (let i = 0; i < 240; i++) {
        for (const root of [home, path.join(home, '.local', 'share')]) {
          try { const v = fs.readFileSync(path.join(root, name, 'data', 'port.txt'), 'utf8').trim(); if (v) return +v; } catch (e) { }
        }
        await E.sleep(250);
      }
      throw new Error('لم يبدأ: ' + name);
    };
    let engT = E.startEngine(inst.tripoli, home), engM = E.startEngine(inst.misrata, home);
    try {
      const pT = await portOf('Qirtasiya-Tripoli'), pM = await portOf('Qirtasiya');
      const iT = (await E.call(pT, '/api/info')).body, iM = (await E.call(pM, '/api/info')).body;
      ok(pT !== pM, 'الاثنان يعملان معاً، كل واحد بمنفذه', [pT, pM]);
      ok(iT.app === 'منظومة طرابلس' && /Qirtasiya-Tripoli[\\/]data$/.test(iT.dataDir), 'طرابلس: اسمها ومجلد بياناته Qirtasiya-Tripoli', iT);
      ok(iM.app === 'منظومة مصراتة' && /[\\/]Qirtasiya[\\/]data$/.test(iM.dataDir), 'مصراتة: اسمها ومجلدها القديم Qirtasiya كما كان', iM);
      const pm = await ctx.newPage();
      await pm.goto('http://127.0.0.1:' + pM + '/');
      await pm.waitForSelector('#modalHost .overlay >> text=أنقل بياناتي أولاً', { timeout: 20000 });
      ok(await pm.$('#modalHost .overlay >> text=4.0') === null && await pm.$('#modalHost .overlay >> text=ابدأ من جديد') !== null,
        'مصراتة على جهاز جديد: شاشة الترحيب كما كانت، بلا خيار 4.0');
      await pm.close();

      console.log('\n== مصراتة 3.x ببياناتها ← «انقل للنظام الجديد 4.0» (من الإعدادات) ==');
      E.stopEngine(engM);
      await E.sleep(500);
      const store = {
        meta: { setupDone: true, shopName: 'مكتبة النور', currency: 'د.ل', libraries: ['A'], shelves: 4, uiSize: 'lg', theme: 'green' },
        branch: { id: 'misrata', name: 'مكتبة النور', city: 'مصراتة', no: 1 },
        books: [{ id: 'b1', code: 'K0001', title: 'كتاب الرياضيات للنقل', lib: 'A', shelf: '1', barcode: '111', cost: 10, price: 15, priceW: 13, qty: 20, min: 3 }],
        stationery: [{ id: 's1', code: 'Q0001', name: 'قلم جاف', cat: 'أقلام', unit: 'قطعة', barcode: '222', cost: 0.5, price: 1, qty: 100, min: 10 }],
        customers: [{ id: 'c1', name: 'محمد علي', phone: '091', balance: 0 }],
        invoices: [], payments: [], counters: { invoice: 0, book: 1, stat: 1 }
      };
      fs.writeFileSync(path.join(iM.dataDir, 'store.json'), JSON.stringify(store));
      fs.unlinkSync(path.join(iM.dataDir, 'port.txt'));
      engM = E.startEngine(inst.misrata, home);
      const pM2 = await portOf('Qirtasiya');
      const pg3 = await ctx.newPage();
      const err3 = [];
      pg3.on('pageerror', e => err3.push(e.message));
      await pg3.goto('http://127.0.0.1:' + pM2 + '/');
      await pg3.waitForFunction(() => window.App && App.S && App.S.meta && App.S.meta.setupDone, null, { timeout: 20000 });
      await pg3.evaluate(() => { location.hash = '#/settings'; });
      await pg3.waitForSelector('#view button:has-text("انقل للنظام الجديد 4.0")', { timeout: 10000 });
      ok(await pg3.$('#view button:has-text("اربطه جهازاً ثانياً")') !== null, 'إعدادات 3.x: «النظام الجديد 4.0» بزرّي النقل والربط جهازاً ثانياً');
      await pg3.click('#view button:has-text("انقل للنظام الجديد 4.0")');
      await pg3.waitForSelector(top + ' >> text=انقل الآن');
      await pg3.click(top + ' >> text=انقل الآن');
      await pg3.waitForSelector(top + ' >> text=انتقلت البيانات، وكلها مطابقة', { timeout: 30000 });
      ok(true, 'النقل من الزر: «انتقلت البيانات، وكلها مطابقة»');
      await pg3.screenshot({ path: path.join(shots, '15-move-report.png') });
      await pg3.click(top + ' >> text=افتح النظام الجديد');
      await pg3.waitForSelector('body.v4:not(.out) #nav .nav-item', { timeout: 20000 });
      ok(await pg3.$eval('#brandName', e => e.textContent) === 'مكتبة النور' && /مصراتة/.test(await pg3.$eval('#branchTag', e => e.textContent)),
        'ويفتح 4.0 باسم المحل وفرع مصراتة');
      await pg3.evaluate(() => { location.hash = '#/items'; });
      await pg3.fill('#itQ', 'كتاب الرياضيات للنقل');
      await pg3.waitForSelector('#itBody >> text=كتاب الرياضيات للنقل');
      ok((await pg3.$eval('#itBody', e => e.textContent)).indexOf('15.00') >= 0, 'وكتب الملف القديم فيه بأسعارها');
      ok(fs.existsSync(path.join(iM.dataDir, 'store.json')) && fs.existsSync(path.join(iM.dataDir, 'qirtasiya.db')),
        'والملف القديم باقٍ كما هو بجانب القاعدة الجديدة');
      ok(err3.length === 0, 'بلا أخطاء JavaScript في 3.x ولا 4.0', err3);
      await pg3.close();
    } finally { E.stopEngine(engT); E.stopEngine(engM); }
  } catch (e) {
    if (lastPage) await lastPage.screenshot({ path: path.join(shots, 'zz-stopped.png') }).catch(() => { });
    fail++; failures.push('توقف: ' + (e && e.stack || e));
    console.log('  FAIL  توقف: ' + (e && e.stack || e));
  } finally {
    await browser.close().catch(() => { });
    E.stopEngine(eng);
    if (cloud) await cloud.close();
  }

  console.log('\n' + '='.repeat(50));
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('  الصور: ' + shots);
  console.log('='.repeat(50));
  if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
  process.exit(0);
})();
