/* ============================================================
   test-phone.js — تطبيق الهاتف الجديد (site/) لطرابلس ولمصراتة
   ------------------------------------------------------------
   خادم ربط حقيقي (fake-cloud: cloud/worker.js نفسه) فيه:
   - طرابلس: لقطة بلا كتب (فرع كبير) وقائمة كتب 61 ألفاً في v2/catalog،
     وموظفون بكلمات سر (PBKDF2 كما في المنظومة).
   - مصراتة: لقطة بكتبها وزبائنها، بلا موظفين.
   التطبيق في متصفح بمقاس آيفون 13:
   - الدخول بالموظف وكلمة السر (طرابلس)، ورمز الهاتف (مصراتة)، ومع كل فتح.
   - كتب طرابلس كلها من قائمة الفرع، والبحث والفتح والتعديل يصل خادم الربط.
   - البيع بالمسح، والكتاب بلا سعر يُسعَّر، والفاتورة تُرسل وتعود برقمها.
   - تسجيل الأماكن والجرد: مكتبة ورف ثم المسح.
   - بلا إنترنت: يفتح على آخر ما وصل.
     node tools/test-phone.js            (QI_SHOTS=مجلد للصور، BOOKS=عدد)
   ============================================================ */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto'), os = require('os');
const { chromium, devices } = require('playwright-core');
const C = require('./fake-cloud');
const { generate } = require('./gen/generate');

const ROOT = path.join(__dirname, '..'), SITE = path.join(ROOT, 'site');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.QI_SHOTS || '';
const KEY = 'test-phone-key';
const BOOKS = parseInt(process.env.BOOKS || '61000', 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(c, name, d) {
  if (c) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (d === undefined ? '' : ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); }
}
function staff(id, n, role, pw) {
  const s = crypto.randomBytes(16).toString('hex');
  const h = crypto.pbkdf2Sync(Buffer.from(pw, 'utf8'), Buffer.from(s, 'hex'), 60000, 32, 'sha256').toString('hex');
  return { id, n, u: id, r: role, s, h };
}
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
function site(cfg) {
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/config.js') {
      s.writeHead(200, { 'content-type': MIME['.js'] });
      return s.end('window.MAKTABA_CONFIG = ' + JSON.stringify(cfg) + ';');
    }
    const f = path.join(SITE, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1)));
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    s.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' })));
}

(async () => {
  const cloud = await C.start({ secret: KEY });
  const call = (p, opt) => fetch(cloud.url + p, Object.assign({ headers: { 'X-Shop-Key': KEY, 'Content-Type': 'application/json' } }, opt || {}));
  const kv = async id => JSON.parse(cloud.env.SHOP.map.get('branch:' + id) || 'null');
  let browser = null, sT = null, sM = null;
  try {
    console.log('يولّد ' + BOOKS + ' كتاباً لطرابلس…');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qph-'));
    generate({ profile: 'tripoli', books: BOOKS, stationery: 300, years: 1, store3: 1, out: path.join(tmp, 't') });
    generate({ profile: 'misrata', store3: 1, out: path.join(tmp, 'm') });
    const tri = JSON.parse(fs.readFileSync(path.join(tmp, 't', 'store3.json'), 'utf8'));
    const mis = JSON.parse(fs.readFileSync(path.join(tmp, 'm', 'store3.json'), 'utf8'));
    fs.rmSync(tmp, { recursive: true, force: true });
    /* كتب بباركود فريد (المولّد يترك بعضها بلا باركود)، وكتاب بلا سعر، وكتاب باسم معروف للبحث */
    const seenBc = {};
    tri.books.forEach(b => { if (b.barcode) seenBc[b.barcode] = (seenBc[b.barcode] || 0) + 1; });
    const good = tri.books.filter(b => b.barcode && seenBc[b.barcode] === 1 && b.price > 0 && b.qty > 0);
    const B = i => good[i];
    good[7].price = 0;
    good[11].title = 'حقوق الأقليات القومية في القانون الدولي العام';

    /* ---------- خادم الربط: طرابلس ---------- */
    const SALEM = staff('s-salem', 'سالم', 'r-cashier', '1111'), BOSS = staff('s-boss', 'المدير', 'r-admin', '9876');
    const triSnap = {
      branch: { id: 'tripoli', name: 'دار الحكمة — طرابلس', city: 'طرابلس' }, at: '2026-11-08 10:00', items: [], whs: [], msgs: [],
      dash: { today: new Date().toISOString().slice(0, 10), days: {}, recent: [], cur: 'د.ل' }, acks: {}, phoneSell: true,
      staff: { staff: [SALEM, BOSS, staff('s-amin', 'أمين المخزن', 'r-store', '2222')],
        roles: [{ id: 'r-admin', n: 'مدير', admin: 1 }, { id: 'r-cashier', n: 'كاشير', perms: ['sell', 'invoices', 'price_zero', 'pay'] }, { id: 'r-store', n: 'أمين مخزن', perms: ['items', 'goods', 'count'] }] },
      shop: { name: 'دار الحكمة', libs: ['A', 'B', 'C', 'D', 'E', 'F'] }
    };
    const today = new Date(), p2 = x => String(x).padStart(2, '0');
    const td = today.getFullYear() + '-' + p2(today.getMonth() + 1) + '-' + p2(today.getDate());
    triSnap.dash.days[td] = { v: 1284.5, n: 23, q: 40 };
    triSnap.dash.recent = [{ no: 35582, d: td, at: '10:42', t: 35.25, m: 'cash', k: 'sale', n: 'كتابان', q: 2 }];
    let r = await call('/put', { method: 'POST', body: JSON.stringify(triSnap) });
    ok(r.ok, 'لقطة طرابلس (بلا كتب) على خادم الربط');
    /* قائمة الكتب: كما يرفعها جهاز المحل (ShopDb.Pack: gzip ثم base64، قطعاً) */
    r = await call('/v2/hello?branch=tripoli&device=tripolimain01&role=main&name=x');
    const items = tri.books.map(b => ['book', b.code, b.title, b.author || '', b.barcode || '', b.cat || '', b.qty || 0, 0, Math.round((b.price || 0) * 1000), b.lib || b.shelf ? 'خزانة ' + (b.lib || '') + ' · رف ' + (b.shelf || '') : ''])
      .concat(tri.stationery.map(s => ['stat', s.code, s.name, s.brand || '', s.barcode || '', s.cat || '', s.qty || 0, 0, Math.round((s.price || 0) * 1000), s.loc || '']));
    const packed = zlib.gzipSync(Buffer.from(JSON.stringify({ v: 1, branch: { id: 'tripoli', name: 'دار الحكمة — طرابلس', city: 'طرابلس' }, at: '2026-11-08 10:00:00', items }), 'utf8')).toString('base64');
    const MAX = 1400000, parts = Math.ceil(packed.length / MAX);
    for (let i = 0; i < parts; i++) {
      r = await call('/v2/catalog?branch=tripoli&device=tripolimain01&ver=cat000000000000000000001&part=' + i + '&parts=' + parts + '&n=' + items.length + '&name=' + encodeURIComponent('دار الحكمة — طرابلس') + '&city=' + encodeURIComponent('طرابلس'),
        { method: 'POST', body: packed.slice(i * MAX, (i + 1) * MAX), headers: { 'X-Shop-Key': KEY, 'Content-Type': 'text/plain' } });
    }
    ok(r.ok, 'قائمة كتب طرابلس (' + items.length + ' صنف، ' + parts + ' قطع) على خادم الربط', await r.text());

    /* ---------- مصراتة: لقطة بكتبها وزبائنها، بلا موظفين ---------- */
    const misSnap = {
      branch: { id: 'misrata', name: 'دار الحكمة', city: 'مصراتة' }, at: '2026-11-08 10:00', whs: [], msgs: [], acks: {}, phoneSell: true,
      items: mis.books.slice(0, 1500).map(b => ({ k: b.code, t: 'book', n: b.title, a: b.author || '', b: b.barcode || '', c: b.cat || '', q: b.qty || 0, p: b.price || 0, m: b.min || 0, l: b.lib || '', s: String(b.shelf || '') })),
      cust: [{ id: 'c1', n: 'مكتبة النور', ph: '0912345678', b: 120 }, { id: 'c2', n: 'أحمد علي', ph: '', b: 0 }],
      dash: { today: td, days: { [td]: { v: 450, n: 9, q: 14 } }, recent: [], cur: 'د.ل' }
    };
    misSnap.items[3].b = '9780000000031';
    r = await call('/put', { method: 'POST', body: JSON.stringify(misSnap) });
    ok(r.ok, 'لقطة مصراتة بكتبها (' + misSnap.items.length + ') وزبائنها');

    sT = await site({ url: '', key: '', branch: 'tripoli', theme: 'blue', name: 'دار الحكمة', city: 'طرابلس' });
    sM = await site({ url: '', key: '', branch: 'misrata', theme: 'green', name: 'دار الحكمة', city: 'مصراتة' });
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    const errs = [];
    const page = async (s, ctx) => {
      const p = await ctx.newPage();
      p.on('pageerror', e => errs.push(e.message));
      p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|net::|status of 401/.test(m.text())) errs.push('console: ' + m.text()); });
      return p;
    };
    const shot = async (p, n) => { if (!SHOTS) return; await sleep(450); await p.evaluate(() => { document.getElementById('toasts').innerHTML = ''; }); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
    const link = '#u=' + encodeURIComponent(cloud.url) + '&k=' + encodeURIComponent(KEY);

    console.log('\n== تطبيق طرابلس (أزرق) ==');
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const p = await page(sT, ctx);
    await p.goto(sT.url);
    await p.waitForSelector('#stLink');
    ok(await p.evaluate(() => !document.body.classList.contains('green')), 'تطبيق طرابلس بلونه الأزرق، وأول مرة يطلب رابط الربط');
    await shot(p, 't0-setup');
    await p.fill('#stLink', 'https://dar-alhekma-tripoli.netlify.app/' + link + '&b=misrata');
    await p.click('[data-a="link"]');
    await p.waitForSelector('.who .p', { timeout: 60000 });
    ok(await p.evaluate(() => Core.branchId()) === 'tripoli', 'رابط فيه فرع آخر لا يغيّر فرع التطبيق (طرابلس)');
    const names = await p.$$eval('.who .p span', e => e.map(x => x.textContent));
    ok(names.join('|') === 'سالم|المدير|أمين المخزن', 'شاشة الدخول: موظفو طرابلس من المنظومة', names);
    await shot(p, 't1-login');
    await p.fill('#pw', '0000'); await p.click('[data-a="login"]'); await sleep(900);
    ok(/غير صحيحة/.test(await p.textContent('#lkErr')), 'كلمة سر خاطئة تُرفض');
    await p.fill('#pw', '1111'); await p.click('[data-a="login"]');
    await p.waitForSelector('.hd .big', { timeout: 20000 });
    await p.evaluate(() => { const s = document.getElementById('sheet'); s.hidden = true; s.innerHTML = ''; });
    const home = await p.evaluate(() => ({ big: document.querySelector('.hd .big').textContent, who: document.querySelector('.hd .top small').textContent, n: Core.info() }));
    ok(/1,?284\.50/.test(home.big) && /سالم/.test(home.who), 'الرئيسية: مبيعات اليوم من المنظومة، واسم الموظف', home);
    ok(home.n.n === items.length && home.n.src === 'cat', 'كتب طرابلس كلها من قائمة الفرع (' + home.n.n + ')', home.n);
    ok(!(await p.$('[data-a="locMode"]')), 'الكاشير لا يرى تسجيل الأماكن والجرد (ليست من صلاحياته)');
    await shot(p, 't2-home');

    console.log('\n== البحث وصفحة الكتاب ==');
    await p.click('.nav [data-v="books"]');
    await p.fill('#bq', 'الأقليات القومية'); await sleep(700);
    const res = await p.$$eval('#bres .res .m > b', e => e.slice(0, 3).map(x => x.textContent));
    ok(/حقوق الأقليات/.test(res[0] || ''), 'البحث في 61 ألف كتاب يجد الكتاب أولاً', res);
    await shot(p, 't3-search');
    const tq = Date.now();
    await p.fill('#bq', 'الاقليات القوميه'); await sleep(600);
    ok(/حقوق الأقليات/.test(await p.textContent('#bres')), 'بلا همزة ولا تاء مربوطة يجده (' + (Date.now() - tq - 600) + ' ms زيادة)');
    await p.click('#bres .res');
    await p.waitForSelector('.bk .nums');
    ok(/حقوق الأقليات/.test(await p.textContent('.bkh .t')), 'صفحة الكتاب: العنوان والسعر والكمية والمكان');
    ok(!(await p.$('[data-a="edit"]')), 'الكاشير لا يعدّل الكتاب');
    await shot(p, 't4-book');

    console.log('\n== البيع ==');
    await p.click('.nav [data-v="home"]');
    await p.evaluate(b => { UI.go('sell'); UI.onScan(b); UI.onScan(b); }, B(20).barcode);
    await p.evaluate(b => UI.onScan(b), B(21).barcode);
    await sleep(300);
    const qs = await p.$$eval('.cl .step b', e => e.map(x => x.textContent.trim()));
    ok(qs.length === 2 && qs.join(',') === '1,2', 'المسح يضيف للسلة (آخر ممسوح أولاً)، والمسح الثاني يزيد الكمية', qs);
    await p.evaluate(b => UI.onScan(b), B(7).barcode);
    await p.waitForSelector('#zpP');
    await p.fill('#zpP', '15'); await p.click('[data-a="zpOk"]'); await sleep(300);
    ok(await p.$$eval('.cl', e => e.length) === 3, 'كتاب بلا سعر: يُسأل عن سعره ثم يُضاف');
    await shot(p, 't5-sell');
    await p.click('[data-a="checkout"]');
    await p.waitForSelector('#donePop');
    await shot(p, 't6-sold');
    await p.click('[data-a="rcSkip"]');
    await sleep(1200);
    let ph = null;
    for (const [k, v] of cloud.env.SHOP.map) if (/^branch:phone-/.test(k)) ph = JSON.parse(v);
    const o = ph && ph.orders && ph.orders[0];
    ok(o && o.to === 'tripoli' && o.by === 's-salem' && o.items.length === 3 && o.items.some(l => l.zp === 1 && l.p === 15), 'الفاتورة وصلت خادم الربط: لفرع طرابلس، باسم سالم، والسعر الجديد معها', o);
    /* المنظومة تسجّلها وترجع رقمها في لقطتها */
    triSnap.acks[o.id] = 35583;
    await call('/put', { method: 'POST', body: JSON.stringify(triSnap) });
    await p.evaluate(() => UI.refresh(true)); await sleep(1500);
    ok(await p.evaluate(() => Core.S.orders[0].status === 'done' && Core.S.orders[0].inv === 35583), 'رقم الفاتورة رجع للهاتف (35583)');

    console.log('\n== المدير: التعديل، والأماكن والجرد ==');
    await p.evaluate(() => UI.act('logout')); await sleep(300);
    await p.click('.who [data-v="s-boss"]'); await p.fill('#pw', '9876'); await p.click('[data-a="login"]');
    await p.waitForSelector('.hd .big');
    await p.evaluate(() => { const s = document.getElementById('sheet'); s.hidden = true; s.innerHTML = ''; });
    await p.evaluate(b => { UI.go('books'); }, null);
    await p.fill('#bq', 'حقوق الأقليات'); await sleep(500);
    await p.click('#bres .res'); await p.waitForSelector('[data-a="edit"]');
    await p.click('.acts [data-a="edit"]'); await p.waitForSelector('#eN');
    await shot(p, 't7-edit');
    await p.fill('#eN', 'حقوق الأقليات القومية في القانون الدولي (طبعة 2)');
    await p.fill('#eP', '14.5');
    await p.click('[data-a="editSave"]'); await sleep(1300);
    ok(/طبعة 2/.test(await p.textContent('.bkh .t')), 'تعديل اسم الكتاب يظهر فوراً مع «بانتظار المنظومة»');
    for (const [k, v] of cloud.env.SHOP.map) if (/^branch:phone-/.test(k)) ph = JSON.parse(v);
    const e = ph.edits && ph.edits[0];
    ok(e && e.set.n && e.set.p === 14.5 && e.to === 'tripoli' && e.by === 's-boss', 'التعديل وصل خادم الربط (الاسم والسعر، باسم المدير)', e);
    await p.evaluate(() => UI.act('locMode', '1')); await sleep(300);
    await p.click('.letters button:nth-child(3)');
    await p.click('[data-a="shelf"][data-v="1"]'); await p.click('[data-a="shelf"][data-v="1"]');
    await p.evaluate(bs => { bs.forEach(b => UI.onScan(b)); }, [B(30).barcode, B(31).barcode, B(30).barcode]);
    await sleep(2200);
    const L = await p.evaluate(() => Core.S.loc);
    ok(L.lib === 'C' && L.shelf === '3' && L.count && L.list.length === 2 && L.list.find(x => x.c === 2), 'الجرد: مكتبة C رف 3، كتابان، والكتاب الممسوح مرتين نسختان', L);
    await shot(p, 't8-count');
    for (const [k, v] of cloud.env.SHOP.map) if (/^branch:phone-/.test(k)) ph = JSON.parse(v);
    const le = ph.edits.find(x => x.b === B(30).barcode);
    ok(le && le.set.l === 'C' && le.set.s === '3' && le.set.cnt === 1 && le.set.qd === 2 - Math.max(B(30).qty || 0, 0), 'الجرد وصل خادم الربط: المكان C · رف 3، والكمية فرقاً', le && le.set);
    await p.evaluate(() => UI.go('more')); await sleep(300);
    await shot(p, 't9-more');

    console.log('\n== يفتح بلا إنترنت، والدخول مع كل فتح ==');
    await ctx.route(cloud.url + '/**', rt => rt.abort());
    await p.reload(); await p.waitForSelector('.who .p', { timeout: 20000 });
    ok(true, 'بعد إعادة الفتح يطلب الدخول من جديد');
    await p.click('.who [data-v="s-boss"]'); await p.fill('#pw', '9876'); await p.click('[data-a="login"]');
    await p.waitForSelector('.hd .big');
    ok(await p.evaluate(() => Core.info().n) === items.length, 'بلا إنترنت: الكتب كلها من الهاتف نفسه');
    await ctx.close();

    console.log('\n== شاشة الربط: خانتان ظاهرتان (عنوان وكلمة سر منفصلتان) ==');
    {
      const cx = await browser.newContext({ ...devices['iPhone 13'] });
      const z = await page(sM, cx);
      await z.goto(sM.url);
      await z.waitForSelector('#stUrl');
      const vis = await z.evaluate(() => ['stUrl', 'stKey', 'stLink'].map(i => { const e = document.getElementById(i); const r = e.getBoundingClientRect(); return r.width > 100 && r.height > 20 && !e.closest('details'); }));
      ok(vis.every(Boolean), 'خانة العنوان وخانة كلمة السر وخانة الرابط الجاهز كلها ظاهرة (لا شيء مطوي)', vis);
      ok(await z.getAttribute('#stKey', 'type') === 'password', 'كلمة السر مخفية');
      await z.click('[data-a="eye"]');
      ok(await z.getAttribute('#stKey', 'type') === 'text' && /إخفاء/.test(await z.textContent('[data-a="eye"]')), 'زر «إظهار» يكشفها ثم يصير «إخفاء»');
      await z.click('[data-a="eye"]');
      await z.click('[data-a="link"]');
      ok(/اكتب عنوان الربط/.test(await z.textContent('#stErr')), 'اضغط «اربط» بلا شيء: «اكتب عنوان الربط أولاً»');
      await z.fill('#stUrl', cloud.url);
      await z.click('[data-a="link"]');
      ok(/اكتب كلمة السر/.test(await z.textContent('#stErr')), 'العنوان بلا كلمة سر: «اكتب كلمة السر»');
      await z.fill('#stKey', 'كلمة-غلط');
      await z.click('[data-a="link"]');
      ok(/حرف غير إنجليزي/.test(await z.textContent('#stErr')), 'كلمة سر بحروف عربية: يقول «فيها حرف غير إنجليزي» قبل أي اتصال');
      await z.fill('#stKey', 'wrong-key');
      await z.click('[data-a="link"]');
      await z.waitForFunction(() => /تعذّر الاتصال/.test((document.getElementById('stErr') || {}).textContent || ''), null, { timeout: 30000 });
      ok(await z.inputValue('#stUrl') === cloud.url && await z.inputValue('#stKey') === 'wrong-key', 'كلمة السر الخطأ: يقول «تعذّر الاتصال» وما كتبتَه يبقى في الخانتين لتصحّحه');
      await z.fill('#stKey', KEY);
      await z.click('[data-a="link"]');
      await z.waitForSelector('#pw2', { timeout: 30000 });
      ok(true, 'وبكلمة السر الصحيحة (مكتوبة يدوياً في خانتها) يرتبط ويطلب رمز الهاتف');
      await cx.close();
      /* رابط جاهز يُلصق: يملأ الخانتين ويحفظ فرعه */
      const cy = await browser.newContext({ ...devices['iPhone 13'] });
      const y = await page(sM, cy);
      await y.goto(sM.url);
      await y.waitForSelector('#stLink');
      await y.fill('#stLink', sM.url + link + '&b=misrata');
      ok(await y.inputValue('#stUrl') === cloud.url && await y.inputValue('#stKey') === KEY, 'لصق الرابط الجاهز يملأ خانتي العنوان وكلمة السر وحده');
      ok(/ملأتُ الخانتين/.test(await y.textContent('#stErr')), 'ويقول «ملأتُ الخانتين»');
      await shot(y, 't0b-setup-filled');
      await y.click('[data-a="link"]');
      await y.waitForSelector('#pw2', { timeout: 30000 });
      ok(await y.evaluate(() => Core.branchId()) === 'misrata', 'والربط به يعمل ومعه فرع الرابط');
      await cy.close();
    }

    console.log('\n== فتح من رابط جاهز وفيه خطأ: الشاشة تقول السبب ولا تدور للأبد ==');
    {
      const open = async (hash, expect, name) => {
        const cx = await browser.newContext({ ...devices['iPhone 13'] });
        const z = await page(sM, cx);
        await z.goto(sM.url + hash);
        const hit = await z.waitForFunction(re => new RegExp(re).test(document.body.innerText), expect, { timeout: 20000 }).then(() => true, () => false);
        ok(hit, name, hit ? '' : (await z.evaluate(() => document.body.innerText)).slice(0, 200));
        if (hit) {
          ok(!(await z.$('.spin')) && !!(await z.$('[data-a="refresh"]')) && !!(await z.$('[data-a="unlink"]')), '   وفيها «إعادة المحاولة» و«فك الربط» (لا دوّارة)');
        }
        await shot(z, 't0c-' + (expect.indexOf('كلمة') >= 0 ? 'badkey' : expect.indexOf('الاتصال') >= 0 ? 'net' : 'nobranch'));
        await cx.close();
      };
      await open('#u=' + encodeURIComponent(cloud.url) + '&k=' + encodeURIComponent('wrong-key') + '&b=misrata', 'كلمة سر الربط غير صحيحة', 'كلمة سر خطأ (إنجليزية) في الرابط الجاهز: تُعرض «كلمة سر الربط غير صحيحة»');
      await open('#u=' + encodeURIComponent(cloud.url) + '&k=' + encodeURIComponent('كلمة-غلط') + '&b=misrata', 'فيها حرف غير مقبول', 'كلمة سر فيها حروف عربية: تُعرض «فيها حرف غير مقبول» بدل دوّارة أو رسالة تقنية');
      await open('#u=' + encodeURIComponent(cloud.url) + '&k=' + encodeURIComponent('abc–def') + '&b=misrata', 'فيها حرف غير مقبول', 'وكذلك علامة الآيفون الذكية (– بدل -)');
      await open('#u=' + encodeURIComponent('http://127.0.0.1:1') + '&k=' + KEY + '&b=misrata', 'تعذّر الاتصال بخادم الربط', 'عنوان لا يردّ: تُعرض «تعذّر الاتصال بخادم الربط» مع السبب');
      /* تطبيق فرعه ghost (مثبّت في إعداد الموقع) على خادم ليس فيه هذا الفرع */
      const sG = await site({ url: '', key: '', branch: 'ghost', theme: 'green', name: 'دار الحكمة', city: '' });
      {
        const cx = await browser.newContext({ ...devices['iPhone 13'] });
        const z = await page(sG, cx);
        await z.goto(sG.url + link);
        const hit = await z.waitForFunction(() => /لم يصل بعد/.test(document.body.innerText), null, { timeout: 20000 }).then(() => true, () => false);
        ok(hit && !(await z.$('.spin')) && !!(await z.$('[data-a="refresh"]')), 'خادم سليم لكن فرع التطبيق غير مرفوع فيه: «فرع ghost لم يصل بعد» مع زر «إعادة المحاولة» لا دوّارة');
        await cx.close();
      }
      sG.srv.close();
    }

    console.log('\n== تطبيق مصراتة (أخضر، بلا موظفين) ==');
    const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
    const q = await page(sM, ctx2);
    await q.goto(sM.url + link);
    await q.waitForSelector('#pw2', { timeout: 30000 });
    ok(await q.evaluate(() => document.body.classList.contains('green')), 'تطبيق مصراتة أخضر، وأول مرة يطلب اختيار رمز للهاتف');
    await q.fill('#pw', '12'); await q.fill('#pw2', '12'); await q.click('[data-a="pinSet"]'); await sleep(300);
    ok(/4 أرقام/.test(await q.textContent('#lkErr')), 'رمز قصير يُرفض');
    await q.fill('#pw', '2468'); await q.fill('#pw2', '2468'); await q.click('[data-a="pinSet"]');
    await q.waitForSelector('.hd .big');
    await q.evaluate(() => { const s = document.getElementById('sheet'); s.hidden = true; s.innerHTML = ''; });
    ok(await q.evaluate(() => Core.info().src === 'snap' && Core.info().n === 1500), 'كتب مصراتة من لقطتها (1500)');
    await shot(q, 'm1-home');
    await q.evaluate(() => { UI.go('sell'); UI.onScan('9780000000031'); }); await sleep(300);
    await q.click('[data-a="meth"][data-v="credit"]');
    await q.selectOption('#cust', 'c1');
    await q.fill('#paid', '0'); await q.dispatchEvent('#paid', 'change');
    await shot(q, 'm2-sell-credit');
    await q.click('[data-a="checkout"]'); await q.waitForSelector('#donePop'); await q.click('[data-a="rcSkip"]'); await sleep(1200);
    for (const [k, v] of cloud.env.SHOP.map) if (/^branch:phone-/.test(k)) { const j = JSON.parse(v); if (j.orders && j.orders.some(x => x.to === 'misrata')) ph = j; }
    const mo = ph.orders.find(x => x.to === 'misrata');
    ok(mo && mo.method === 'credit' && mo.cust === 'c1' && !mo.by, 'بيع آجل من مصراتة وصل خادم الربط للزبون', mo);
    await q.reload(); await q.waitForSelector('#pw');
    ok(!(await q.$('#pw2')), 'إعادة الفتح تطلب الرمز');
    await q.fill('#pw', '2468'); await q.click('[data-a="pinIn"]'); await q.waitForSelector('.hd .big');
    ok(true, 'الرمز الصحيح يدخل');
    await ctx2.close();

    ok(errs.length === 0, 'بلا أخطاء في الصفحات', errs.slice(0, 5));
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    if (sT) sT.srv.close();
    if (sM) sM.srv.close();
    await cloud.close();
  }
  console.log('\n==================================================');
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})();
