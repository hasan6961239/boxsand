/* ============================================================
   test-x3.js — شاشات 3.x نفسها فوق الأساس الجديد (قرار 0025)
   ------------------------------------------------------------
   البرنامج الحقيقي تحت mono، وخادم الربط (fake-cloud.js يشغّل
   cloud/worker.js نفسه)، والشاشات في متصفح كما يستعملها البائع:
     A: كمبيوتر المحل — على store.json كما كان، ثم «هذا جهاز المحل»
     B: اللابتوب — فيه بياناته هو، ثم «اربطه جهازاً ثانياً»
   ما يُتأكد منه: الربط لا يغيّر شيئاً في البيانات ولا الشاشات، بيعة
   في كل جهاز في الوقت نفسه تنقص الكمية مرتين وتأخذ رقمين، ما يضيفه
   اللابتوب يصل المحل والعكس، والشاشة تعيد التحميل وحدها، والمرآة
   store.json تطابق القاعدة، وما يُعدَّل من خارج البرنامج يُؤخذ.

     node tools/test-x3.js          الجهازان
     node tools/test-x3.js suites   ثم test.js وtest-money.js كاملين بهذا الوضع
   ============================================================ */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright-core');
const { DatabaseSync } = require('node:sqlite');
const E = require('./engine');
const C = require('./fake-cloud');

const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const KEY = 'test-x3-key';
const SHOTS = process.env.QI_SHOTS || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else {
    fail++;
    const d = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail));
    failures.push(name + d);
    console.log('  FAIL  ' + name + d);
  }
}

function shopStore(url) {
  return {
    meta: { setupDone: true, shopName: 'دار الحكمة', currency: 'د.ل', libraries: ['A', 'B'], shelves: 6, theme: 'green', homeFp: '' },
    branch: { id: 'misrata', name: 'دار الحكمة', city: 'مصراتة', no: 1 },
    sync: { url, key: KEY, auto: false, everyMin: 10 },
    books: [
      { id: 'b1', code: 'K0001', title: 'كتاب الرياضيات', lib: 'A', shelf: '1', barcode: '111', cost: 10, price: 15, qty: 20, min: 3 },
      { id: 'b2', code: 'K0002', title: 'الفيزياء الأساسية', author: 'عبد الله', lib: 'B', shelf: '2', barcode: '9789953305076', cost: 20, price: 30, qty: 5, min: 1 }
    ],
    stationery: [{ id: 's1', code: 'Q0001', name: 'قلم جاف', cat: 'أقلام', unit: 'قطعة', barcode: '222', cost: 0.5, price: 1, qty: 100, min: 10 }],
    customers: [{ id: 'c1', name: 'محمد علي', phone: '091', balance: 12.5 }],
    invoices: [], payments: [], counters: { invoice: 0, book: 2, stat: 1 }
  };
}

function laptopStore(url) {
  return {
    meta: { setupDone: true, shopName: 'لابتوب', currency: 'د.ل', libraries: ['A'], shelves: 4 },
    branch: { id: 'misrata', name: 'دار الحكمة', city: 'مصراتة', no: 1 },
    sync: { url, key: KEY, auto: false, everyMin: 10 },
    books: [{ id: 'x1', code: 'K0001', title: 'كتاب قديم على اللابتوب', price: 5, qty: 1 }],
    stationery: [], customers: [], invoices: [], payments: [], counters: { invoice: 0, book: 1, stat: 0 }
  };
}

function device(tmp, name) {
  const d = { name, dir: path.join(tmp, name), home: path.join(tmp, name + '-home'), proc: null, port: 0 };
  fs.mkdirSync(path.join(d.dir, 'data'), { recursive: true });
  fs.mkdirSync(d.home, { recursive: true });
  d.data = f => path.join(d.dir, 'data', f || '');
  d.start = async () => { d.proc = E.startEngine(d.dir, d.home); d.port = await E.waitPort(d.dir); return d; };
  d.stop = () => { if (d.proc) E.stopEngine(d.proc); d.proc = null; };
  d.url = () => 'http://127.0.0.1:' + d.port + '/';
  d.raw = (p, body, h) => E.call(d.port, p, body, h);
  d.store = () => JSON.parse(fs.readFileSync(d.data('store.json'), 'utf8'));
  d.write = o => fs.writeFileSync(d.data('store.json'), JSON.stringify(o));
  d.q = (sql, ...a) => {
    const db = new DatabaseSync(d.data('qirtasiya.db'), { readOnly: true });
    try { return db.prepare(sql).all(...a); } finally { db.close(); }
  };
  return d;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qx3-'));
  process.env.QIRTASIYA_SYNC_MS = '3000';
  process.env.QIRTASIYA_X3_CHECK = '1';
  const cloud = await C.start({ secret: KEY });
  const A = device(tmp, 'A'), B = device(tmp, 'B');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const errs = [];
  const open = async (d) => {
    const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    pg.on('pageerror', e => errs.push(d.name + ' PAGEERROR: ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') errs.push(d.name + ' console: ' + m.text()); });
    await pg.goto(d.url(), { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S && App.S.books && window.Rep, null, { timeout: 30000 });
    await sleep(900);
    return pg;
  };
  const S = pg => pg.evaluate(() => JSON.parse(JSON.stringify(App.S)));
  const book = (s, id) => s.books.find(b => b.id === id) || {};
  /* حتى يتحقق الشرط على الشاشة (إعادة التحميل وحدها بعد النبض) */
  const until = async (pg, fn, arg, ms) => {
    try { await pg.waitForFunction(fn, arg, { timeout: ms || 25000, polling: 300 }); return true; }
    catch (e) { return false; }
  };
  const link = (pg, action) => pg.evaluate(a => App.api('/api/link', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: a }) }).then(r => r.json()), action);
  const shot = async (pg, name) => {
    if (!SHOTS) return;
    const el = await pg.$('#lnkBody');
    const card = el ? await el.evaluateHandle(e => e.closest('.card')) : null;
    await (card ? card.asElement() : pg).screenshot({ path: path.join(SHOTS, name + '.png') });
  };
  const sellCash = async (pg, code) => {
    await pg.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(500);
    await pg.fill('#scan', code); await sleep(300); await pg.keyboard.press('Enter'); await sleep(400);
    await pg.click('button:has-text("إتمام البيع")'); await sleep(500);
    await pg.click('button:has-text("نقداً")'); await sleep(1200);
  };

  try {
    console.log('يبني البرنامج...');
    E.buildEngine(A.dir, 'misrata');
    for (const f of ['Qirtasiya.exe', 'Qirtasiya.exe.config']) fs.copyFileSync(path.join(A.dir, f), path.join(B.dir, f));

    console.log('\n== كمبيوتر المحل قبل الربط: store.json كما كان ==');
    A.write(shopStore(cloud.url));
    await A.start();
    let pA = await open(A);
    let info = (await A.raw('/api/info')).body;
    ok(info.db === false && !info.x3 && !fs.existsSync(A.data('qirtasiya.db')), 'بلا قاعدة: البرنامج على store.json', info);
    await sellCash(pA, '111');
    ok(A.store().invoices.length === 1 && book(A.store(), 'b1').qty === 19, 'بيعة قبل الربط تُكتب في store.json كما كانت');
    await pA.evaluate(() => { location.hash = '#/settings'; App.route(); });
    ok(await until(pA, () => /هذا جهاز المحل/.test((document.getElementById('lnkBody') || {}).textContent || '')), 'في الإعدادات: بطاقة «ربط الأجهزة»');
    await shot(pA, '1-shop-before');

    console.log('\n== «هذا جهاز المحل» ==');
    const before = A.store();
    await pA.click('#lnkBody button:has-text("هذا جهاز المحل")'); await sleep(500);
    const pre = await pA.evaluate(() => ({ url: (document.getElementById('f_url') || {}).value, key: (document.getElementById('f_key') || {}).value }));
    ok(pre.url === cloud.url && pre.key === KEY, 'العنوان وكلمة السر من «إعداد الربط» جاهزين', pre);
    await pA.fill('#f_name', 'كمبيوتر المحل');
    await Promise.all([pA.waitForNavigation({ timeout: 30000 }).catch(() => null), pA.click('.modal button:text-is("اربط")')]);
    await pA.waitForFunction(() => window.App && App.S && App.S.books, null, { timeout: 30000 }); await sleep(900);
    info = (await A.raw('/api/info')).body;
    ok(info.db === true && info.x3 === true, 'صار على القاعدة بشاشات 3.x', info);
    const docs = A.q("SELECT COUNT(*) AS n FROM x3_docs WHERE key <> ''")[0].n;
    const recs = Object.values(before).filter(v => Array.isArray(v) && v.length && v.every(x => x && x.id)).reduce((n, v) => n + v.length, 0);
    ok(docs === recs && docs >= 5, 'كل كتاب وصنف وزبون وفاتورة سجل في القاعدة (' + docs + ')', docs + ' / ' + recs);
    let s = await S(pA);
    ok(JSON.stringify(s.books) === JSON.stringify(before.books) && JSON.stringify(s.invoices) === JSON.stringify(before.invoices) &&
      s.customers[0].balance === 12.5, 'الشاشة ترى بياناتها نفسها حرفياً');
    ok(JSON.stringify(A.store()) === JSON.stringify(before), 'وstore.json على حاله');
    ok(fs.readdirSync(A.data('backups')).some(f => /^backup-.*\.json$/.test(f)) &&
      fs.readdirSync(A.data('backups')).some(f => /^qirtasiya-after-adopt-/.test(f)), 'ونسخة من الملف قبل، ومن القاعدة بعد');
    ok(await pA.evaluate(() => !document.querySelector('.modal')), 'بلا أي نافذة أو سؤال إضافي');
    let st = await link(pA, 'now');
    ok(st.ok && st.data.role === 'main' && st.data.lastOk && !st.data.error, 'هذا جهاز المحل، والمزامنة الأولى بلا خطأ', st.data);
    const br = cloud.env.DB.raw.prepare("SELECT * FROM v2_branch WHERE branch = 'misrata'").get();
    ok(br && br.chain && br.snap >= 0, 'نسخته الكاملة على الخادم', br && { chain: br.chain, snap: br.snap });
    const cat = cloud.env.DB.raw.prepare("SELECT * FROM v2_catalog WHERE branch = 'misrata'").get();
    ok(cat && cat.n === 3, 'وقائمة كتبه للفروع الأخرى من بيانات 3.x (3 أصناف)', cat && cat.n);
    ok(!cloud.env.SHOP.map.has('branch:misrata'), 'ولقطة التلفون لا يرفعها المحرك (شاشات 3.x ترفعها كما كانت)');
    await pA.evaluate(() => { location.hash = '#/settings'; App.route(); }); await sleep(900);
    await shot(pA, '2-shop-linked');

    console.log('\n== اللابتوب: «اربطه جهازاً ثانياً» ==');
    B.write(laptopStore(cloud.url));
    await B.start();
    let pB = await open(B);
    await pB.evaluate(() => { location.hash = '#/settings'; App.route(); }); await sleep(900);
    await pB.click('#lnkBody button:has-text("اربطه جهازاً ثانياً")'); await sleep(500);
    await pB.fill('#f_name', 'لابتوب حسن');
    await pB.click('.modal button:text-is("اربط")'); await sleep(1500);
    const ask = await pB.evaluate(() => ([...document.querySelectorAll('.modal')].pop() || {}).textContent || '');
    ok(/تُستبدل/.test(ask), 'بياناته القديمة: يسأل قبل الاستبدال', ask.slice(0, 120));
    await Promise.all([pB.waitForNavigation({ timeout: 60000 }).catch(() => null), pB.click('.modal button:text-is("استبدل واربط")')]);
    await pB.waitForFunction(() => window.App && App.S && App.S.books, null, { timeout: 30000 }); await sleep(1200);
    s = await S(pB);
    const sA = await S(pA);
    ok(JSON.stringify(s.books) === JSON.stringify(sA.books) && s.invoices.length === 1, 'صار نسخة من المحل: الكتب والفواتير نفسها');
    ok((await B.raw('/api/device')).body.second === true, 'ويعرف أنه جهاز ثانٍ');
    ok(await pB.evaluate(() => !document.querySelector('.modal') && App.outboundHeld()),
      'بلا سؤال «بيانات المحل على جهاز آخر»: الربط مع التلفون والإشعارات من المحل وحده');
    ok(fs.readdirSync(B.data('backups')).some(f => {
      if (!/^backup-.*\.json$/.test(f)) return false;
      try { return /كتاب قديم على اللابتوب/.test(fs.readFileSync(B.data('backups/' + f), 'utf8')); } catch (e) { return false; }
    }), 'وبياناته القديمة محفوظة في backups');
    await pB.evaluate(() => { location.hash = '#/settings'; App.route(); }); await sleep(900);
    await shot(pB, '3-laptop-linked');

    console.log('\n== بيعة في الجهازين في الوقت نفسه ==');
    await sellCash(pB, '111');
    s = await S(pB);
    ok(s.invoices.length === 2 && book(s, 'b1').qty === 18, 'اللابتوب: البيعة تظهر فوراً (الكمية 18)', book(s, 'b1').qty);
    st = await pB.evaluate(() => App.apiJson('/api/link'));
    ok(st.data.waiting === 1, 'وتنتظر جهاز المحل', st.data);
    const invA = (await S(pA)).invoices.length;
    await sellCash(pA, '111');
    s = await S(pA);
    /* المزامنة كل 3 ثوانٍ: بيعة اللابتوب قد تكون وصلت قبلها */
    ok(s.invoices.length >= invA + 1 && book(s, 'b1').qty <= 18, 'المحل: بيعته تُسجَّل', { n: s.invoices.length, qty: book(s, 'b1').qty });
    await link(pB, 'now'); await link(pA, 'now'); await link(pB, 'now');
    const both = s => s.invoices.length === 3 && s.books.find(b => b.id === 'b1').qty === 17;
    ok(await until(pA, () => App.S.invoices.length === 3 && App.S.books.find(b => b.id === 'b1').qty === 17),
      'شاشة المحل أعادت التحميل وحدها: 3 فواتير والكمية 17');
    ok(await until(pB, () => App.S.invoices.length === 3 && App.S.books.find(b => b.id === 'b1').qty === 17),
      'وشاشة اللابتوب كذلك');
    s = await S(pA);
    const nos = s.invoices.map(v => v.no).sort();
    ok(both(s) && JSON.stringify(nos) === '[1,2,3]' && s.counters.invoice === 3, 'أرقام الفواتير 1 و2 و3 بلا تكرار', nos);
    ok(JSON.stringify(await S(pB)) === JSON.stringify(s), 'الجهازان متطابقان حرفياً');

    console.log('\n== اللابتوب يضيف كتاباً، والمحل يغيّر سعراً ==');
    await pB.evaluate(() => {
      App.S.books.unshift({ id: App.uid(), code: App.nextCode('book'), title: 'كتاب من اللابتوب', barcode: '555', price: 20, cost: 12, qty: 3, lib: 'A', shelf: '2' });
      App.save();
    });
    await pA.evaluate(() => { App.findItem('book', 'b2').price = 32; App.save(); });
    await sleep(500);
    await link(pB, 'now'); await link(pA, 'now'); await link(pB, 'now');
    ok(await until(pA, () => App.S.books.some(b => b.title === 'كتاب من اللابتوب' && b.code === 'K0003')), 'كتاب اللابتوب وصل المحل برمزه K0003');
    ok(await until(pB, () => App.S.books.find(b => b.id === 'b2').price === 32), 'وسعر المحل الجديد وصل اللابتوب');
    ok(JSON.stringify(await S(pB)) === JSON.stringify(await S(pA)), 'والجهازان متطابقان');

    console.log('\n== حماية بيانات المحل من اللابتوب ==');
    await pB.evaluate(() => Rep.wipeAll()); await sleep(400);
    ok(await pB.evaluate(() => !document.querySelector('.modal')), '«مسح جميع البيانات» على اللابتوب: يُرفض قبل أن يبدأ');
    const nBooks = (await S(pB)).books.length;
    await pB.evaluate(() => { App.S.books = []; App.S.invoices = []; App.save(); }); await sleep(1500);
    ok(await until(pB, n => App.S.books.length === n && App.S.invoices.length === 3, nBooks), 'ولو أُفرغت البيانات في الشاشة: الحفظ يُرفض وترجع كما هي');
    await link(pB, 'now'); await link(pA, 'now');
    ok((await S(pA)).books.length === nBooks, 'والمحل لم يُمس');

    console.log('\n== store.json مرآة القاعدة ==');
    const load = JSON.parse(await pA.evaluate(() => App.api('/api/load').then(r => r.text())));
    ok(JSON.stringify(A.store()) === JSON.stringify(load), 'store.json في المحل = ما في القاعدة');
    ok(JSON.stringify(B.store()) === JSON.stringify(load), 'وفي اللابتوب كذلك');
    const logA = fs.readFileSync(A.data('log.txt'), 'utf8');
    ok(!/X3CHECK/.test(logA), 'وكل حفظ: ما في القاعدة بعده = ما أرسلته الشاشة');

    console.log('\n== المحل يُغلق ويُفتح، وملف عُدّل من خارج البرنامج ==');
    await pA.close({ runBeforeUnload: true }); await sleep(500);
    A.stop(); await sleep(500);
    const edited = A.store();
    edited.books.push({ id: 'out1', code: 'K0099', title: 'أُضيف من خارج البرنامج', price: 9, qty: 2 });
    A.write(edited);
    await A.start();
    pA = await open(A);
    s = await S(pA);
    ok(s.books.some(b => b.id === 'out1') && s.invoices.length === 3, 'بعد الفتح: البيانات كما هي، ومعها ما عُدّل في الملف');
    ok(fs.readdirSync(A.data('backups')).some(f => /^qirtasiya-before-outside-/.test(f)), 'وقبل أخذه نسخة من القاعدة');
    await link(pA, 'now'); await link(pB, 'now');
    ok(await until(pB, () => App.S.books.some(b => b.id === 'out1')), 'ووصل اللابتوب');

    console.log('\n== التلفون والموقع: لقطة 3.x من شاشات المحل ==');
    await pA.evaluate(() => Stock.sync(true)); await sleep(2500);
    const kv = JSON.parse(cloud.env.SHOP.map.get('branch:misrata') || 'null');
    s = await S(pA);
    const nItems = s.books.length + s.stationery.length;
    ok(kv && !kv.v4 && kv.items.length === nItems && kv.items.find(i => i.k === 'K0001').q === 17,
      'شاشات المحل ترفع لقطتها كما كانت (' + nItems + ' أصناف، الكمية 17)', kv && kv.items.length);

    ok(errs.length === 0, 'بلا أخطاء في الصفحات', errs.slice(0, 5));
    if (SHOTS) {
      await pA.evaluate(() => { location.hash = '#/settings'; App.route(); }); await sleep(900);
      await shot(pA, '4-shop-after');
    }
    await pA.close(); await pB.close();
  } catch (e) {
    ok(false, 'خطأ غير متوقع', e.stack);
  } finally {
    A.stop(); B.stop();
    await browser.close();
    await cloud.close();
  }

  if (process.argv[2] === 'suites') await suites();
  console.log('\n' + '='.repeat(50) + '\n  نجح: ' + pass + '    فشل: ' + fail + '\n' + '='.repeat(50));
  if (failures.length) console.log(failures.map(f => '  - ' + f).join('\n'));
  process.exit(fail ? 1 : 0);
})();

/* test.js وtest-money.js كاملين على البرنامج نفسه بعد «هذا جهاز المحل» */
async function suites() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qx3s-'));
  const cloud = await C.start({ secret: KEY });
  const D = device(tmp, 'D');
  try {
    E.buildEngine(D.dir, 'misrata');
    for (const t of ['test.js', 'test-money.js']) {
      console.log('\n== ' + t + ' بشاشات 3.x فوق القاعدة ==');
      for (const f of fs.readdirSync(D.data())) fs.rmSync(D.data(f), { recursive: true, force: true });
      D.write(shopStore(cloud.url));
      await D.start();
      if (D.port !== 17845) throw new Error('المنفذ 17845 مشغول');
      const ow = (await D.raw('/api/claim', { force: true })).body.token;
      const r = await D.raw('/api/link', { action: 'main', url: cloud.url, key: KEY, name: 'محل' }, { 'X-Owner': ow });
      ok(r.body && r.body.ok && r.body.data.x3, t + ': الربط', r.body);
      await D.raw('/api/release?t=' + ow, {});
      const run = spawnSync('node', [path.join(__dirname, t)], {
        env: Object.assign({}, process.env, { QI_DATA: D.data(), QI_X3: '1' }), encoding: 'utf8', timeout: 1800000
      });
      const out = (run.stdout || '') + (run.stderr || '');
      const fails = out.split('\n').filter(l => /^\s*FAIL\s/.test(l));
      const passes = out.split('\n').filter(l => /^\s*PASS\s/.test(l)).length;
      console.log(fails.join('\n'));
      ok(fails.length === 0 && passes > 0, t + ': ' + passes + ' نجح، ' + fails.length + ' فشل', fails.slice(0, 8).join(' | '));
      fs.writeFileSync(path.join(tmp, t + '.out'), out);
      ok(!/X3CHECK/.test(fs.readFileSync(D.data('log.txt'), 'utf8')), t + ': كل حفظ طابق ما أرسلته الشاشة');
      D.stop(); await sleep(800);
    }
  } catch (e) {
    ok(false, 'خطأ غير متوقع في الاختبارات الكاملة', e.stack);
  } finally {
    D.stop();
    await cloud.close();
  }
}
