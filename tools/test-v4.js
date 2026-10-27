/* ============================================================
   test-v4.js — واجهة 4.0 على المحرك الحقيقي (المرحلة 4أ، قرار 0021)
   ------------------------------------------------------------
   جهاز جديد بلا بيانات: شاشة الترحيب ← «فرع جديد على النظام الجديد»
   ببيانات تجربة ← دخول المدير ← لوحة اليوم ← بيعة من نقطة البيع بالبحث
   الجديد ← الفواتير ← إضافة كتاب وتعديله وحذفه ← موظف بكلمة سر ←
   «ابدأ من جديد بلا بيانات التجربة» ← إعادة تشغيل المحرك.
   صور الشاشات في SHOTS (أو مجلد مؤقت).

   يحتاج: mono-mcs وxvfb-run وlibsqlite3 وplaywright-core.
     node tools/test-v4.js
   ============================================================ */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright-core');
const E = require('./engine');

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
  console.log('يبني المحرك...');
  E.buildEngine(dir);

  let eng = E.startEngine(dir, home), lastPage = null;
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
    const toastHas = s => page.waitForFunction(t => Array.prototype.some.call(document.querySelectorAll('#toasts .toast'),
      x => x.textContent.indexOf(t) >= 0), s, { timeout: 8000 }).then(() => true, () => false);

    console.log('\n== جهاز جديد: شاشة الترحيب ==');
    await page.goto(base + '/');
    await page.waitForSelector(top + ' >> text=فرع جديد على النظام الجديد (4.0)', { timeout: 15000 });
    ok(true, 'بلا بيانات: شاشة الترحيب فيها «فرع جديد على النظام الجديد (4.0)»');
    ok(await page.$(top + ' >> text=أنقل بياناتي أولاً') !== null && await page.$(top + ' >> text=ابدأ من جديد') !== null,
      'وخيارا النظام الحالي ونقل البيانات باقيان كما كانا');
    await shot('01-welcome');
    await page.click(top + ' >> text=فرع جديد على النظام الجديد (4.0)');
    await page.waitForSelector(top + ' #f_shopName');
    ok(await page.$eval(top + ' #f_city', e => e.value) === 'طرابلس', 'المدينة طرابلس افتراضياً');
    ok(await page.$eval(top + ' #f_demo', e => e.value) === 'yes', 'وبيانات التجربة مختارة افتراضياً');
    await page.fill(top + ' #f_shopName', 'مكتبة التجربة');
    await E.sleep(350);
    await shot('02-new-branch');
    await page.click(top + ' .m-foot .btn.primary');

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

    console.log('\n== موظف بكلمة سر ==');
    await page.click('#nav .nav-item[data-k="settings"]');
    await page.waitForSelector('#setUsers table');
    await page.click('#setUsers .btn.primary');
    await page.waitForSelector(top + ' #f_name');
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

    console.log('\n== إعادة تشغيل المحرك ==');
    E.stopEngine(eng);
    await E.sleep(500);
    eng = E.startEngine(dir, home);
    port = await E.waitPort(dir);
    await page.goto('http://127.0.0.1:' + port + '/');
    await page.waitForSelector('body.v4:not(.out) #nav .nav-item', { timeout: 20000 });
    ok(await text('#brandName') === 'مكتبة التجربة', 'بعد إعادة التشغيل: «/» تفتح 4.0 مباشرة');
    r = await E.call(port, '/api/v2/demo.reset', {}, {});
    ok(r.status === 403, 'مسح التجربة بلا جلسة: 403', r.status);
    const tok = (await E.call(port, '/api/v2/login', { login: 'admin', password: '' })).body.data.token;
    r = await E.call(port, '/api/v2/demo.reset', {}, { 'X-Session': tok });
    ok(r.body && r.body.ok === false && /ليست نسخة تجربة/.test(r.body.error), 'وقاعدة حقيقية لا تُمسح أبداً', r.body);
    r = await E.call(port, '/api/v2/setting.set', { key: 'demo', value: true }, { 'X-Session': tok });
    ok(r.body && r.body.ok === false, 'ولا تُوضع عليها علامة التجربة من الأوامر', r.body);
    r = await E.call(port, '/api/v2/create', { shopName: 'x' });
    ok(r.status === 409 || (r.body && r.body.ok === false), 'ولا تُنشأ قاعدة ثانية فوقها', r.body);

    ok(errors.length === 0, 'بلا أخطاء JavaScript في الصفحة', errors);
  } catch (e) {
    if (lastPage) await lastPage.screenshot({ path: path.join(shots, 'zz-stopped.png') }).catch(() => { });
    fail++; failures.push('توقف: ' + (e && e.stack || e));
    console.log('  FAIL  توقف: ' + (e && e.stack || e));
  } finally {
    await browser.close().catch(() => { });
    E.stopEngine(eng);
  }

  console.log('\n' + '='.repeat(50));
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('  الصور: ' + shots);
  console.log('='.repeat(50));
  if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
  process.exit(0);
})();
