/* ============================================================
   test-phone.js — تطبيق الهاتف 3.0 (site/) لطرابلس ولمصراتة
   ------------------------------------------------------------
   خادم ربط حقيقي (fake-cloud: cloud/worker.js نفسه) فيه:
   - طرابلس: لقطة بلا كتب (فرع كبير) وقائمة كتب 61 ألفاً في v2/catalog بأعمدتها
     كلها، وموظفون بكلمات سر (PBKDF2 كما في المنظومة).
   - مصراتة: لقطة بكتبها وقرطاسيتها وزبائنها ومورديها، بلا موظفين.
   - فرع «قديم»: لقطة منظومة 4.1 (بلا ph): الميزات الجديدة تقول «حدّث المنظومة».
   التطبيق في متصفح بمقاس آيفون 13:
   - الدخول بالموظف وكلمة السر (طرابلس)، ورمز الهاتف (مصراتة)، ومع كل فتح.
   - الرئيسية قائمة (الجرد، الفواتير، الآجل، الديون، التنبيهات) بلا «تسجيل الأماكن»،
     وأعلى كل شاشة آخر تحديث وزر التحديث.
   - «إضافة وتعديل»: كتب وقرطاسية منفصلتان، قائمة وبطاقات ورفوف، وتعديل كل حقول
     الصنف، وإضافة كمية، وصنف جديد — وكله يصل خادم الربط كما تنتظره المنظومة.
   - البيع بالمسح، والكتاب بلا سعر يُسعَّر، والفاتورة تُرسل وتعود برقمها.
   - الجرد، والفواتير، والآجل، والديون، والتنبيهات، والإعدادات، وسجل الإرسال.
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
    /* بسياسة أمان الموقع كما في netlify.toml: أي style سطري أو سكربت ممنوع يظهر خطأً هنا */
    s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream',
      'content-security-policy': "default-src 'self'; connect-src *; img-src 'self' data:; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
    s.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' })));
}

(async () => {
  const cloud = await C.start({ secret: KEY });
  const call = (p, opt) => fetch(cloud.url + p, Object.assign({ headers: { 'X-Shop-Key': KEY, 'Content-Type': 'application/json' } }, opt || {}));
  const kv = id => JSON.parse(cloud.env.SHOP.map.get('branch:' + id) || 'null');
  let browser = null, sT = null, sM = null, sO = null;
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
    const good = tri.books.filter(b => b.barcode && seenBc[b.barcode] === 1 && b.price > 0 && b.qty > 0 && b.lib && b.shelf);
    const B = i => good[i];
    good[7].price = 0;
    good[11].title = 'حقوق الأقليات القومية في القانون الدولي العام';
    good[11].author = 'مؤلف الكتاب'; good[11].cat = 'قانون'; good[11].publisher = 'دار الأصل'; good[11].priceW = 0; good[11].note = '';
    good[11].qty = 5; good[11].store = 0; good[11].min = 1;
    const newLib = good[11].lib === 'B' ? 'D' : 'B';

    const today = new Date(), p2 = x => String(x).padStart(2, '0');
    const td = today.getFullYear() + '-' + p2(today.getMonth() + 1) + '-' + p2(today.getDate());
    const forms = st => ({ v: 3, libs: st.meta.libraries || ['A', 'B', 'C'], shelves: st.meta.shelves || 6, units: ['قطعة', 'علبة', 'دزينة'], bcats: st.meta.bookCats || [], scats: st.meta.statCats || [], pubs: ['دار الفكر', 'منشورات الاختبار الجديدة'] });
    const sup = [{ id: 'sp1', n: 'دار الفكر للتوزيع', ph: '0913334444', b: 3450.5 }, { id: 'sp2', n: 'مكتبة لبنان ناشرون', ph: '', b: 0 }];
    const cust = [{ id: 'c1', n: 'مكتبة النور', ph: '0912345678', b: 120 }, { id: 'c2', n: 'أحمد علي', ph: '', b: 0 }, { id: 'c3', n: 'مدرسة الفاتح', ph: '0914567890', b: 1260.75 }];
    const dash = () => ({ today: td, days: { [td]: { v: 1284.5, n: 23, q: 40 } }, cur: 'د.ل',
      recent: [
        { no: 35582, d: td, at: '10:42', t: 35.25, m: 'cash', k: 'sale', n: 'كتابان', q: 2, li: [['كتاب أول', 1, 20], ['كتاب ثانٍ', 1, 15.25]] },
        { no: 35581, d: td, at: '09:15', t: 420, m: 'credit', k: 'sale', c: 'مكتبة النور', n: 'رياض الصالحين', q: 12, li: [['رياض الصالحين', 12, 35]], due: 320 }
      ],
      credit: [{ no: 35581, d: td, at: '09:15', c: 'مكتبة النور', cid: 'c1', t: 420, pd: 100, due: 320 }, { no: 35570, d: '2026-11-09', at: '16:05', c: 'مدرسة الفاتح', cid: 'c3', t: 1260.75, pd: 0, due: 1260.75 }] });

    /* ---------- خادم الربط: طرابلس ---------- */
    const SALEM = staff('s-salem', 'سالم', 'r-cashier', '1111'), BOSS = staff('s-boss', 'المدير', 'r-admin', '9876');
    const triSnap = {
      branch: { id: 'tripoli', name: 'دار الحكمة — طرابلس', city: 'طرابلس' }, at: td + ' 10:00', items: [], whs: [], msgs: [],
      dash: dash(), acks: {}, phoneSell: true, cust, sup, ph: forms(tri),
      staff: { staff: [SALEM, BOSS, staff('s-amin', 'أمين المخزن', 'r-store', '2222')],
        roles: [{ id: 'r-admin', n: 'مدير', admin: 1 }, { id: 'r-cashier', n: 'كاشير', perms: ['sell', 'invoices', 'price_zero', 'pay'] }, { id: 'r-store', n: 'أمين مخزن', perms: ['items', 'goods', 'count'] }] },
      shop: { name: 'دار الحكمة', libs: ['A', 'B', 'C', 'D', 'E', 'F'] }
    };
    let r = await call('/put', { method: 'POST', body: JSON.stringify(triSnap) });
    ok(r.ok, 'لقطة طرابلس (بلا كتب) على خادم الربط');
    /* قائمة الكتب: كما يرفعها جهاز المحل (ShopDb.Pack: gzip ثم base64، قطعاً)، بأعمدتها بعد العاشر
       (دار النشر، حد التنبيه، غرفة الخزين، سعر الجملة، التخصص الدقيق، الملاحظة، الوحدة، المورّد، لم يُجرد)
       والفارغ في آخر السطر لا يُكتب */
    r = await call('/v2/hello?branch=tripoli&device=tripolimain01&role=main&name=x');
    const trim = a => { while (a.length > 10 && (a[a.length - 1] === '' || a[a.length - 1] === 0)) a.pop(); return a; };
    const items = tri.books.map(b => trim(['book', b.code, b.title, b.author || '', b.barcode || '', b.cat || '', b.qty || 0, 0, Math.round((b.price || 0) * 1000), b.lib || b.shelf ? 'خزانة ' + (b.lib || '') + ' · رف ' + (b.shelf || '') : '',
      b.publisher || '', b.min || 0, b.store || 0, Math.round((b.priceW || 0) * 1000), b.catFull || '', b.note || '', '', b.supplierId || '', b.uncounted ? 1 : 0]))
      .concat(tri.stationery.map(s => trim(['stat', s.code, s.name, s.brand || '', s.barcode || '', s.cat || '', s.qty || 0, 0, Math.round((s.price || 0) * 1000), s.loc || '', '', s.min || 0, 0, 0, '', '', s.unit || 'قطعة', '', 0])));
    const packed = zlib.gzipSync(Buffer.from(JSON.stringify({ v: 1, branch: { id: 'tripoli', name: 'دار الحكمة — طرابلس', city: 'طرابلس' }, at: td + ' 00:00:00', items }), 'utf8')).toString('base64');
    const MAX = 1400000, parts = Math.ceil(packed.length / MAX);
    for (let i = 0; i < parts; i++) {
      r = await call('/v2/catalog?branch=tripoli&device=tripolimain01&ver=cat000000000000000000001&part=' + i + '&parts=' + parts + '&n=' + items.length + '&name=' + encodeURIComponent('دار الحكمة — طرابلس') + '&city=' + encodeURIComponent('طرابلس'),
        { method: 'POST', body: packed.slice(i * MAX, (i + 1) * MAX), headers: { 'X-Shop-Key': KEY, 'Content-Type': 'text/plain' } });
    }
    ok(r.ok, 'قائمة كتب طرابلس (' + items.length + ' صنف، ' + parts + ' قطع) على خادم الربط', await r.text());

    /* ---------- مصراتة: لقطة بكتبها وقرطاسيتها وزبائنها ومورديها، بلا موظفين ---------- */
    const misSnap = {
      branch: { id: 'misrata', name: 'دار الحكمة', city: 'مصراتة' }, at: td + ' 10:00', whs: [], msgs: [], acks: {}, phoneSell: true, cust, sup, dash: dash(), ph: forms(mis),
      items: mis.books.slice(0, 1500).map(b => ({ k: b.code, t: 'book', n: b.title, a: b.author || '', b: b.barcode || '', c: b.cat || '', q: b.qty || 0, p: b.price || 0, m: b.min || 0, l: b.lib || '', s: String(b.shelf || ''), d: b.publisher || '', pw: b.priceW || undefined }))
        .concat(mis.stationery.slice(0, 200).map(s => ({ k: s.code, t: 'stat', n: s.name, a: s.brand || '', b: s.barcode || '', c: s.cat || '', q: s.qty || 0, p: s.price || 0, m: s.min || 0, loc: s.loc || '', u: s.unit || 'قطعة' })))
    };
    misSnap.items[3].b = '9780000000031';
    r = await call('/put', { method: 'POST', body: JSON.stringify(misSnap) });
    ok(r.ok, 'لقطة مصراتة بكتبها وقرطاسيتها (' + misSnap.items.length + ') وزبائنها');
    /* فرع منظومته 4.1 (قبل 3.0): بلا ph ولا موردين ولا سجل آجل */
    const oldSnap = { branch: { id: 'old', name: 'فرع قديم', city: 'سبها' }, at: td + ' 10:00', whs: [], msgs: [], acks: {}, phoneSell: true, cust: [],
      dash: { today: td, days: {}, recent: [], cur: 'د.ل' }, items: misSnap.items.slice(0, 60).map(i => ({ k: i.k, t: i.t, n: i.n, a: i.a, b: i.b, c: i.c, q: i.q, p: i.p, m: i.m, l: i.l, s: i.s })) };
    await call('/put', { method: 'POST', body: JSON.stringify(oldSnap) });

    sT = await site({ url: '', key: '', branch: 'tripoli', theme: 'blue', name: 'دار الحكمة', city: 'طرابلس' });
    sM = await site({ url: '', key: '', branch: 'misrata', theme: 'green', name: 'دار الحكمة', city: 'مصراتة' });
    sO = await site({ url: '', key: '', branch: 'old', theme: 'blue', name: 'فرع قديم', city: 'سبها' });
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
    const noSheet = p => p.evaluate(() => { const s = document.getElementById('sheet'); s.hidden = true; s.innerHTML = ''; s.classList.remove('out'); });
    const tab = async (p, k) => { await p.click('.nav [data-tab="' + k + '"]'); await sleep(150); };
    const txt = (p, sel) => p.evaluate(q => { const e = document.querySelector(q); return e ? e.innerText : ''; }, sel);
    const phoneOf = async p => kv(await p.evaluate(() => Core.S.phone.id));
    /* ما أرسله الهاتف يصل خادم الربط بعد لحظة: ينتظر حتى يظهر */
    const sent = async (p, pick, ms) => {
      const end = Date.now() + (ms || 8000);
      for (;;) {
        const f = await phoneOf(p), hit = f && pick(f);
        if (hit || Date.now() > end) return hit || null;
        await sleep(150);
      }
    };
    const enter = async (p, who, pw) => {
      await p.click('.who [data-v="' + who + '"]'); await p.fill('#pw', pw); await p.click('[data-a="login"]');
      await p.waitForSelector('.menu', { timeout: 20000 });
      await sleep(700); await noSheet(p);
    };

    console.log('\n== تطبيق طرابلس (أزرق): الربط والدخول ==');
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const p = await page(sT, ctx);
    await p.goto(sT.url);
    await p.waitForSelector('#stLink');
    ok(await p.evaluate(() => !document.body.classList.contains('green')), 'تطبيق طرابلس بلونه الأزرق، وأول مرة يطلب رابط الربط');
    await shot(p, 't00-setup');
    await p.fill('#stLink', 'https://dar-alhekma-tripoli.netlify.app/' + link + '&b=misrata');
    await p.click('[data-a="link"]');
    await p.waitForSelector('.who .p', { timeout: 90000 });
    ok(await p.evaluate(() => Core.branchId()) === 'tripoli', 'رابط فيه فرع آخر لا يغيّر فرع التطبيق (طرابلس)');
    const names = await p.$$eval('.who .p span', e => e.map(x => x.textContent));
    ok(names.join('|') === 'سالم|المدير|أمين المخزن', 'شاشة الدخول: موظفو طرابلس من المنظومة', names);
    await shot(p, 't01-login');
    await p.fill('#pw', '0000'); await p.click('[data-a="login"]'); await sleep(900);
    ok(/غير صحيحة/.test(await p.textContent('#lkErr')), 'كلمة سر خاطئة تُرفض');
    await enter(p, 's-salem', '1111');

    console.log('\n== الرئيسية: قائمة، وآخر تحديث وزر التحديث فوق ==');
    const home = await p.evaluate(() => ({ big: document.getElementById('heroNum').textContent, who: document.querySelector('.hero .hw').textContent, n: Core.info(),
      rows: [].map.call(document.querySelectorAll('.menu .mi'), b => b.getAttribute('data-v')), names: [].map.call(document.querySelectorAll('.menu .mi .m b'), b => b.textContent),
      nav: [].map.call(document.querySelectorAll('.nav .n'), b => b.textContent.trim()), all: document.getElementById('app').innerText }));
    ok(/1,284\.50/.test(home.big) && /سالم/.test(home.who), 'الرئيسية: مبيعات اليوم من المنظومة، واسم الموظف', home);
    ok(home.n.n === items.length && home.n.src === 'cat', 'أصناف طرابلس كلها من قائمة الفرع (' + home.n.n + ')', home.n);
    ok(home.rows.join() === 'invoices,credit,debts,alerts' && home.names.join('|') === 'الفواتير|الآجل|الديون|التنبيهات', 'القائمة للكاشير: الفواتير، الآجل، الديون، التنبيهات (بلا الجرد: ليس من صلاحياته)', home.rows);
    ok(!/تسجيل الأماكن/.test(home.all) && !/الأماكن|المزيد/.test(home.nav.join('|')), 'لا «تسجيل الأماكن» في الرئيسية، ولا تبويب «الأماكن» ولا «المزيد»', home.nav);
    ok(home.nav.join('|') === 'الرئيسية|إضافة وتعديل|البيع|الإعدادات' && !!(await p.$('.nav .fab')), 'الشريط السفلي: الرئيسية، إضافة وتعديل، زر المسح، البيع، الإعدادات (بلا تبويب بحث)', home.nav);
    const syncOk = async name => {
      const s = await p.evaluate(() => ({ line: (document.getElementById('syncLine') || {}).innerText || '', btn: !!document.getElementById('rfBtn'), top: document.querySelector('.bar') ? document.querySelector('.bar').getBoundingClientRect().top : 99 }));
      ok(/آخر تحديث/.test(s.line) && s.btn && s.top <= 1, name + ': أعلاها «آخر تحديث» وزر التحديث', s);
    };
    await syncOk('الرئيسية');
    await shot(p, 't02-home');
    const gets0 = cloud.log ? cloud.log.length : 0;
    let allHits = 0;
    await p.route(cloud.url + '/all', rt => { allHits++; rt.continue(); });
    await p.click('#rfBtn');
    await p.waitForFunction(() => /حُدّث/.test(document.getElementById('toasts').innerText), null, { timeout: 20000 });
    ok(allHits >= 1 && /آخر تحديث: الآن/.test(await txt(p, '#syncLine')), 'زر التحديث فوق يحدّث فعلاً من خادم الربط، والسطر يصير «الآن»', { allHits, gets0 });
    await p.unroute(cloud.url + '/all');

    console.log('\n== إضافة وتعديل: الكتب والقرطاسية منفصلة، وثلاثة عروض ==');
    await tab(p, 'items');
    await p.waitForSelector('#iq');
    await syncOk('إضافة وتعديل');
    const it0 = await p.evaluate(() => ({ modes: [].map.call(document.querySelectorAll('.mseg button'), b => b.textContent), types: [].map.call(document.querySelectorAll('[data-a="itype"]'), b => b.textContent.replace(/\s+/g, ' ').trim()),
      views: [].map.call(document.querySelectorAll('[data-a="iview"]'), b => b.getAttribute('aria-label')), cnt: document.querySelector('.cnt').textContent, rows: document.querySelectorAll('#ires .res').length }));
    ok(it0.modes.join('|') === 'عرض وتعديل|إضافة كمية|صنف جديد', 'أوضاع التبويب: عرض وتعديل، إضافة كمية، صنف جديد', it0.modes);
    ok(/كتب/.test(it0.types[0]) && /قرطاسية/.test(it0.types[1]) && it0.types[0].replace(/\D/g, '') === String(tri.books.length) && it0.types[1].replace(/\D/g, '') === String(tri.stationery.length), 'الكتب منفصلة عن القرطاسية، وكل قسم بعدده', it0.types);
    ok(it0.views.join('|') === 'قائمة|بطاقات|الرفوف' && it0.rows === 40, 'ثلاثة عروض: قائمة، بطاقات، الرفوف — والقائمة تعرض 40 ثم تكمل بالتمرير', it0);
    await p.fill('#iq', 'الأقليات القومية'); await sleep(700);
    const res = await p.$$eval('#ires .res .m > b', e => e.slice(0, 3).map(x => x.textContent));
    ok(/حقوق الأقليات/.test(res[0] || ''), 'البحث في ' + tri.books.length + ' كتاباً يجد الكتاب أولاً', res);
    await shot(p, 't03-search');
    await p.fill('#iq', 'الاقليات القوميه'); await sleep(700);
    ok(/حقوق الأقليات/.test(await p.textContent('#ires')), 'بلا همزة ولا تاء مربوطة يجده');
    await p.click('[data-a="clrQ"]'); await sleep(300);
    await p.click('[data-a="iview"][data-v="cards"]'); await sleep(300);
    ok(await p.$$eval('#ires .cards .cardi', e => e.length) === 40 && !(await p.$('#ires .res')), 'عرض البطاقات: شبكة بطاقات بالسعر والكمية والمكان');
    await shot(p, 't04-cards');
    await p.click('[data-a="iview"][data-v="map"]'); await sleep(300);
    const mp = await p.evaluate(() => ({ libs: [].map.call(document.querySelectorAll('#ires .letters button'), b => b.textContent), shelves: document.querySelectorAll('#ires .case .shelf').length,
      w: [].map.call(document.querySelectorAll('#ires .sbar i'), i => i.style.width), first: document.querySelector('#ires .case .shelf').innerText.replace(/\s+/g, ' ') }));
    const libA = tri.books.filter(b => b.lib === mp.libs[0]), sh1 = libA.filter(b => String(b.shelf) === '1');
    ok(mp.libs.length >= 3 && mp.shelves >= 3 && mp.w.every(w => /%$/.test(w)) && new RegExp('رف 1 ' + sh1.length.toLocaleString('en') + ' كتاب').test(mp.first), 'خريطة الرفوف: الخزائن حروفاً، وكل رف بعدد كتبه (' + sh1.length + ' على رف 1) وشريط بحجمه', mp);
    await shot(p, 't05-map');
    await p.click('#ires .case .shelf'); await sleep(300);
    const pl = await p.evaluate(() => ({ crumb: document.querySelector('.crumb').innerText.replace(/\s+/g, ' '), rows: document.querySelectorAll('#ires .res').length }));
    ok(new RegExp('خزانة ' + mp.libs[0] + ' · رف 1').test(pl.crumb) && pl.rows === Math.min(40, sh1.length), 'الضغط على رف يعرض كتبه، ومنه رجوع للرفوف', pl);
    await p.click('[data-a="placeBack"]'); await sleep(200);
    ok(!!(await p.$('#ires .case .shelf')), 'الرجوع يعيد خريطة الرفوف');
    await p.click('[data-a="itype"][data-v="stat"]'); await sleep(300);
    ok(/أماكن القرطاسية/.test(await p.textContent('#ires')) && (await p.getAttribute('[data-a="iview"][data-v="map"]', 'aria-label')) === 'الأماكن', 'القرطاسية: العرض الثالث «الأماكن» (مكانها في المحل)');
    await p.click('[data-a="iview"][data-v="list"]'); await sleep(300);
    const stRows = await p.evaluate(() => ({ cnt: document.querySelector('.cnt').textContent, n: document.querySelectorAll('#ires .res').length }));
    ok(new RegExp(String(tri.stationery.length)).test(stRows.cnt.replace(/,/g, '')) && stRows.n === 40, 'قسم القرطاسية يعرض القرطاسية وحدها (' + tri.stationery.length + ')', stRows);
    await p.click('[data-a="itype"][data-v="book"]'); await sleep(200);
    await p.click('[data-a="filt"][data-v="nop"]'); await sleep(400);
    ok(/نتيجة/.test(await txt(p, '.cnt')) && (await p.$$eval('#ires .res .pr span', e => e.every(x => x.textContent === 'بلا سعر'))), 'التصفية «بلا سعر» تعرض الكتب الصفرية وحدها');
    await p.click('[data-a="filt"][data-v=""]'); await sleep(200);
    await p.click('[data-a="catPick"]'); await p.waitForSelector('#chQ');
    await p.fill('#chQ', 'قانون'); await sleep(200);
    await p.click('#chRes [data-a="chPick"]'); await sleep(500);
    const catN = tri.books.filter(b => b.cat === 'قانون').length;
    ok(new RegExp('^' + catN.toLocaleString('en') + ' نتيجة').test((await txt(p, '.cnt')).trim()), 'تصفية بالتخصص من قائمة فيها بحث (قانون: ' + catN + ')', await txt(p, '.cnt'));
    await p.click('[data-a="catClr"]'); await sleep(300);

    console.log('\n== الكاشير: يرى ولا يعدّل ==');
    await p.fill('#iq', B(11).barcode); await p.press('#iq', 'Enter');
    await p.waitForSelector('.ihead');
    ok(/حقوق الأقليات/.test(await txt(p, '.ihead h2')), 'رقم الباركود في خانة البحث ثم Enter (قارئ بلوتوث) يفتح بطاقة الكتاب');
    await syncOk('بطاقة الكتاب');
    ok(!(await p.$('[data-a="edit"]')) && !(await p.$('[data-a="addQty"]')) && !!(await p.$('[data-a="sellOne"]')), 'الكاشير يبيع الكتاب ولا يعدّله ولا يضيف كميته');
    await shot(p, 't06-item-cashier');
    await p.click('.bar [data-a="back"]'); await p.waitForSelector('#iq');
    await p.click('[data-a="imode"][data-v="new"]'); await sleep(200);
    ok(/ليست من صلاحياتك/.test(await p.textContent('.page')) && !(await p.$('[data-a="newSave"]')), '«صنف جديد» للكاشير: ليست من صلاحياتك');
    await p.click('[data-a="imode"][data-v="qty"]'); await sleep(200);
    ok(/ليست من صلاحياتك/.test(await p.textContent('.page')) && !(await p.$('[data-a="rSave"]')), '«إضافة كمية» للكاشير: ليست من صلاحياتك');
    await p.click('[data-a="imode"][data-v="view"]');

    console.log('\n== البيع ==');
    await tab(p, 'sell');
    await syncOk('البيع');
    await p.evaluate(b => { UI.onScan(b); UI.onScan(b); }, B(20).barcode);
    await p.evaluate(b => UI.onScan(b), B(21).barcode);
    await sleep(300);
    const qs = await p.$$eval('.cl .step b', e => e.map(x => x.textContent.trim()));
    ok(qs.length === 2 && qs.join(',') === '1,2', 'المسح يضيف للسلة (آخر ممسوح أولاً)، والمسح الثاني يزيد الكمية', qs);
    ok((await p.getAttribute('.nav [data-tab="sell"]', 'data-badge')) === '3', 'عدد ما في السلة يظهر على تبويب البيع');
    await p.evaluate(b => UI.onScan(b), B(7).barcode);
    await p.waitForSelector('#zpP');
    await p.fill('#zpP', '15'); await p.click('[data-a="zpOk"]'); await sleep(300);
    ok(await p.$$eval('.cl', e => e.length) === 3, 'كتاب بلا سعر: يُسأل عن سعره ثم يُضاف');
    await shot(p, 't07-sell');
    await p.click('[data-a="checkout"]');
    await p.waitForSelector('#donePop');
    await shot(p, 't08-sold');
    await p.click('[data-a="rcSkip"]');
    const o = await sent(p, f => f.orders && f.orders[0]);
    ok(o && o.to === 'tripoli' && o.by === 's-salem' && o.items.length === 3 && o.items.some(l => l.zp === 1 && l.p === 15), 'الفاتورة وصلت خادم الربط: لفرع طرابلس، باسم سالم، والسعر الجديد معها', o);
    /* المنظومة تسجّلها وترجع رقمها في لقطتها */
    triSnap.acks[o.id] = 35583;
    await call('/put', { method: 'POST', body: JSON.stringify(triSnap) });
    await p.evaluate(() => UI.refresh(true)); await sleep(1500);
    ok(await p.evaluate(() => Core.S.orders[0].status === 'done' && Core.S.orders[0].inv === 35583), 'رقم الفاتورة رجع للهاتف (35583)');

    console.log('\n== الفواتير، الآجل، الديون، التنبيهات (من الرئيسية) ==');
    await tab(p, 'home');
    await p.click('.menu [data-v="invoices"]'); await p.waitForSelector('[data-a="invTab"]');
    await syncOk('الفواتير');
    const iv = await p.evaluate(() => ({ rows: [].map.call(document.querySelectorAll('.list .li .m b'), b => b.textContent), stats: document.querySelector('.stats').innerText.replace(/\s+/g, ' ') }));
    ok(iv.rows.length === 2 && /35582/.test(iv.rows[0]) && /1,284\.50/.test(iv.stats) && /23/.test(iv.stats), 'الفواتير: آخر فواتير المحل ومبيعات اليوم', iv);
    await p.click('.list [data-a="inv"]'); await p.waitForSelector('.sheet .inv');
    const ivs = (await txt(p, '#sheet')).replace(/\s+/g, ' ');
    ok(/فاتورة رقم 35582/.test(ivs) && /كتاب أول/.test(ivs) && /15\.25/.test(ivs) && /35\.25/.test(ivs), 'الضغط على فاتورة يعرض سطورها وإجماليها', ivs.slice(0, 200));
    await shot(p, 't09-invoice');
    await noSheet(p);
    await p.click('[data-a="invTab"][data-v="phone"]'); await sleep(200);
    ok(/فاتورة 35583/.test(await p.textContent('.page')), '«من هذا الهاتف»: ما بعته برقم فاتورته بعد أن سجّلته المنظومة');
    await p.click('.bar [data-a="back"]'); await p.waitForSelector('.menu');
    await p.click('.menu [data-v="credit"]'); await p.waitForSelector('.stats');
    await syncOk('الآجل');
    const crd = (await txt(p, '.page')).replace(/\s+/g, ' ');
    ok(/320\.00/.test(crd) && /مكتبة النور/.test(crd) && /مدرسة الفاتح/.test(crd) && /1260\.75/.test(crd) && /بيع آجل جديد/.test(crd), 'الآجل: آجل اليوم الذي لم يُقبض، وسجل البيع بالآجل (الزبون، المبلغ، الباقي)', crd.slice(0, 260));
    ok(/2026-11-09/.test(await p.evaluate(() => [].map.call(document.querySelectorAll('.list .li bdi'), b => b.textContent).join(' '))), 'التاريخ يُعرض بترتيبه الصحيح (معزول عن اتجاه النص)');
    await shot(p, 't10-credit');
    await p.click('.list [data-a="crd"]'); await p.waitForSelector('#sheet .where');
    ok(/عليه الآن/.test(await txt(p, '#sheet')) && /120\.00/.test(await txt(p, '#sheet')) && !!(await p.$('#sheet a[href^="tel:"]')), 'فاتورة آجلة ← بطاقة الزبون: رصيده الآن وزر الاتصال');
    await noSheet(p);
    await p.click('.bar [data-a="back"]'); await p.waitForSelector('.menu');
    await p.click('.menu [data-v="debts"]'); await p.waitForSelector('#dres');
    await syncOk('الديون');
    const db = (await txt(p, '.page')).replace(/\s+/g, ' ');
    ok(/1,380\.75/.test(db) && /مدرسة الفاتح/.test(db) && /خالص/.test(db) && !(await p.$('[data-a="debtTab"]')), 'الديون للكاشير: ما لنا عند الزبائن (المجموع والأسماء)، وبلا ديون الموردين (ليست من صلاحياته)', db.slice(0, 200));
    await p.click('.bar [data-a="back"]'); await p.waitForSelector('.menu');
    await p.click('.menu [data-v="alerts"]'); await p.waitForSelector('[data-a="alTab"]');
    await syncOk('التنبيهات');
    const alN = tri.books.concat(tri.stationery).filter(b => !b.uncounted && (b.min || 0) > 0 && (b.qty || 0) <= (b.min || 0)).length;
    const al = await p.evaluate(() => ({ tabs: [].map.call(document.querySelectorAll('[data-a="alTab"]'), b => b.textContent.replace(/\s+/g, ' ').trim()) }));
    ok(al.tabs.length === 3 && al.tabs[0].replace(/\D/g, '') === String(alN), 'التنبيهات: الكل والنافد والمقارب (' + alN + ' صنف وصل حد تنبيهه)', al);
    await shot(p, 't11-alerts');

    console.log('\n== المدير: تعديل كل حقول الكتاب ==');
    await tab(p, 'settings'); await p.click('[data-a="logout"]'); await p.waitForSelector('.who .p');
    await enter(p, 's-boss', '9876');
    ok((await p.$$eval('.menu .mi', e => e.map(b => b.getAttribute('data-v')))).join() === 'count,invoices,credit,debts,alerts', 'القائمة للمدير: الجرد، الفواتير، الآجل، الديون، التنبيهات');
    await tab(p, 'items'); await p.waitForSelector('#iq');
    await p.fill('#iq', 'حقوق الأقليات'); await sleep(600);
    await p.click('#ires .res'); await p.waitForSelector('.acts [data-a="edit"]');
    ok((await p.$$eval('.acts .btn', e => e.map(b => b.textContent.trim()))).join('|') === 'بيع|تعديل|إضافة كمية', 'بطاقة الكتاب للمدير: بيع، تعديل، إضافة كمية');
    await p.click('.acts [data-a="edit"]'); await p.waitForSelector('[data-f="n"]');
    await syncOk('تعديل الكتاب');
    const flds = await p.evaluate(() => ({ keys: [].map.call(document.querySelectorAll('[data-f]'), e => e.getAttribute('data-f')), dis: [].filter.call(document.querySelectorAll('[data-f]'), e => e.disabled).length,
      labels: [].map.call(document.querySelectorAll('.form-page .fld > span, .form-page .fld > label > span'), e => e.textContent.trim()), txt: document.querySelector('.form-page').innerText }));
    ok(['n', 'a', 'd', 'c', 'cf', 'sp', 'l', 's', 'bc', 'p', 'pw', 'q', 'st', 'm', 'nt'].every(k => flds.keys.includes(k)) && flds.dis === 0, 'نموذج التعديل فيه كل خانات الكمبيوتر: الاسم، المؤلف، دار النشر، التخصص، التخصص الدقيق، المورّد، المكتبة، الرف، الباركود، السعران، الكمية، غرفة الخزين، حد التنبيه، الملاحظة', flds.keys);
    ok(!/سعر الشراء من/.test(flds.labels.join('|')) && /سعر الشراء لا يظهر/.test(flds.txt), 'إلا سعر الشراء: لا خانة له في الهاتف (ومكتوب ذلك تحت النموذج)');
    await shot(p, 't12-edit');
    await p.fill('[data-f="bc"]', B(20).barcode);
    await p.click('[data-a="editSave"]'); await sleep(400);
    ok(/مستعمل في/.test(await txt(p, '#fe_bc')) && !!(await p.$('[data-f="n"]')), 'باركود كتاب آخر يُرفض في الهاتف قبل الإرسال («مستعمل في…»)', await txt(p, '#fe_bc'));
    await p.fill('[data-f="n"]', 'حقوق الأقليات القومية في القانون الدولي (طبعة 2)');
    await p.fill('[data-f="d"]', 'دار الفكر');
    await p.fill('[data-f="cf"]', 'قانون دولي / حقوق الإنسان');
    await p.selectOption('[data-f="sp"]', 'sp1');
    await p.selectOption('[data-f="l"]', newLib); await p.selectOption('[data-f="s"]', '4');
    await p.evaluate(() => UI.act('fScan', 'bc')); await sleep(200);
    await p.evaluate(() => { if (window.WebScan) WebScan.close(); UI.onScan('9990001112223'); }); await sleep(300);
    ok(await p.inputValue('[data-f="bc"]') === '9990001112223' && await p.inputValue('[data-f="n"]') === 'حقوق الأقليات القومية في القانون الدولي (طبعة 2)', 'زر «امسح» بجانب خانة الباركود يملؤها من الكاميرا، وما كُتب في باقي الخانات يبقى');
    await p.fill('[data-f="p"]', '14.5'); await p.fill('[data-f="pw"]', '12');
    await p.click('[data-a="fStep"][data-v="1"]'); await p.click('[data-a="fStep"][data-v="1"]');
    ok(await p.inputValue('[data-f="q"]') === '7' && /سيُضاف 2/.test(await txt(p, '#fQd')), 'زر + على الكمية: 5 ← 7، ومكتوب «سيُضاف 2 في المنظومة»');
    await p.fill('[data-f="st"]', '3'); await p.fill('[data-f="m"]', '2'); await p.fill('[data-f="nt"]', 'طبعة جديدة منقّحة');
    await p.click('[data-a="editSave"]');
    await p.waitForSelector('.ihead');
    ok(/طبعة 2/.test(await txt(p, '.ihead h2')) && /تعديل ينتظر المنظومة/.test(await txt(p, '.ihead')), 'بعد الحفظ: البطاقة تعرض الاسم الجديد فوراً مع «تعديل ينتظر المنظومة»');
    const card = (await txt(p, '.page')).replace(/\s+/g, ' ');
    ok(/14\.50/.test(card) && new RegExp(newLib + ' · رف 4').test(card) && /9990001112223/.test(card) && /دار الفكر للتوزيع/.test(card) && /12\.00/.test(card) && /طبعة جديدة منقّحة/.test(card) && /غرفة الخزين 3/.test(card), 'وكل ما عُدّل ظاهر فيها: السعر، المكان، الباركود، المورّد، سعر الجملة، الملاحظة، غرفة الخزين', card.slice(0, 400));
    await shot(p, 't13-item-edited');
    const e = await sent(p, f => f.edits && f.edits.find(x => x.set && x.set.n));
    ok(e && e.b === B(11).barcode && e.k === B(11).code && e.to === 'tripoli' && e.by === 's-boss', 'التعديل وصل خادم الربط باسم المدير، ومعه باركود الكتاب الأصلي ورمزه (المنظومة تعرفه بهما)', e && { b: e.b, k: e.k, by: e.by });
    const es = e ? e.set : {};
    ok(es.n === 'حقوق الأقليات القومية في القانون الدولي (طبعة 2)' && es.d === 'دار الفكر' && es.cf === 'قانون دولي / حقوق الإنسان' && es.sp === 'sp1' && es.l === newLib && es.s === '4' && es.bc === '9990001112223' &&
      es.p === 14.5 && es.pw === 12 && es.qd === 2 && es.cnt === 1 && es.st === 3 && es.m === 2 && es.nt === 'طبعة جديدة منقّحة', 'وفيه كل ما تغيّر بمفاتيحه: n d cf sp l s bc p pw qd cnt st m nt (الكمية فرقاً +2)', es);
    ok(es.a === undefined && es.c === undefined, 'وما لم يُلمس (المؤلف، التخصص) لا يُرسل', Object.keys(es));

    console.log('\n== إضافة كمية ==');
    await p.click('.acts [data-a="addQty"]'); await p.waitForSelector('#aqN');
    await p.click('[data-a="aqStep"][data-v="1"]'); await p.click('[data-a="aqStep"][data-v="1"]');
    await p.click('[data-a="aqDst"][data-v="store"]');
    await shot(p, 't14-addqty');
    await p.click('[data-a="aqSave"]'); await sleep(400);
    const r1 = await sent(p, f => f.edits && f.edits.find(x => x.kind === 'recv'));
    ok(r1 && r1.lines.length === 1 && r1.lines[0].q === 3 && r1.lines[0].b === B(11).barcode && r1.lines[0].k === B(11).code && r1.dst === 'store' && r1.by === 's-boss', '«إضافة كمية» من بطاقة الكتاب وصلت خادم الربط: 3 لغرفة الخزين، باسم المدير', r1);
    ok(/10/.test(await txt(p, '.nums div:nth-child(2) b')) && /غرفة الخزين 6/.test((await txt(p, '.page')).replace(/\s+/g, ' ')), 'والبطاقة تعرض الكمية الجديدة فوراً (7 + 3 = 10، وفي الخزين 6)', await txt(p, '.nums'));
    await p.click('.bar [data-a="back"]'); await p.waitForSelector('#iq');
    await p.click('[data-a="imode"][data-v="qty"]'); await sleep(250);
    ok(!(await p.$('[data-a="itype"]')) && !!(await p.$('[data-a="rDst"]')) && !!(await p.$('[data-r="sp"]')) && !!(await p.$('[data-r="nt"]')), 'وضع «إضافة كمية»: الوجهة، المورّد، وملاحظة الفاتورة');
    await p.evaluate(bs => { UI.onScan(bs[0]); if (window.WebScan) WebScan.close(); UI.onScan(bs[1]); if (window.WebScan) WebScan.close(); UI.onScan(bs[0]); if (window.WebScan) WebScan.close(); }, [B(40).barcode, B(41).barcode]);
    await sleep(300);
    await p.fill('#rq', B(42).title.slice(0, 12)); await sleep(500);
    await p.click('#rsug [data-a="rAdd"]'); await sleep(300);
    await p.fill('[data-ri="0"]', '12'); await p.dispatchEvent('[data-ri="0"]', 'change'); await sleep(200);
    await p.selectOption('[data-r="sp"]', 'sp1'); await p.fill('[data-r="nt"]', 'فاتورة 771');
    const rv = await p.evaluate(() => ({ lines: Core.S.recv.lines.map(l => l.q), btn: document.querySelector('[data-a="rSave"]').innerText.replace(/\s+/g, ' ') }));
    ok(rv.lines.join() === '12,1,2' && /إضافة 15 قطعة للرفوف/.test(rv.btn), 'المسح يضيف سطراً والمسحة الثانية تزيده، والبحث بالاسم يضيف، والعدد يُكتب: 15 قطعة', rv);
    await shot(p, 't15-recv');
    await p.reload(); await p.waitForSelector('.who .p'); await enter(p, 's-boss', '9876');
    await tab(p, 'items'); await p.click('[data-a="imode"][data-v="qty"]'); await sleep(250);
    ok(await p.evaluate(() => Core.S.recv.lines.length === 3 && Core.S.recv.nt === 'فاتورة 771'), 'القائمة تبقى لو أُغلق التطبيق قبل الحفظ');
    await p.click('[data-a="rSave"]'); await sleep(400);
    const r2 = await sent(p, f => f.edits && f.edits.find(x => x.kind === 'recv' && x.lines.length === 3));
    ok(r2 && r2.dst === 'shelf' && r2.sp === 'sp1' && r2.nt === 'فاتورة 771' && r2.lines.map(l => l.q).join() === '12,1,2' && r2.lines.every(l => l.k) && r2.lines[1].b === B(41).barcode, 'حفظ إضافة الكمية وصل خادم الربط: ثلاثة سطور بكمياتها، والمورّد والملاحظة', r2);
    ok(await p.evaluate(() => Core.S.recv.lines.length === 0) && /لم تُضف أصناف/.test(await p.textContent('.page')), 'وبعد الحفظ تفرغ القائمة');

    console.log('\n== صنف جديد ==');
    await p.click('[data-a="imode"][data-v="new"]'); await sleep(250);
    ok(!!(await p.$('[data-a="itype"]')) && !!(await p.$('[data-f="n"]')) && !!(await p.$('[data-a="fSet"][data-v="dst|store"]')) && !(await p.$('[data-f="st"]')), 'وضع «صنف جديد»: نموذج الكتاب كاملاً، ومعه «وين تروح؟»');
    await p.click('[data-a="newSave"]'); await sleep(300);
    ok(/اكتب اسم الكتاب/.test(await txt(p, '#fe_n')), 'بلا اسم لا يُضاف');
    await p.fill('[data-f="n"]', 'مدخل إلى علم المكتبات');
    await p.fill('[data-f="a"]', 'د. فاطمة الورفلي');
    await p.click('[data-a="fPick"][data-v="d"]'); await p.waitForSelector('#chQ');
    await p.fill('#chQ', 'منشورات الاخ'); await sleep(200);
    await p.click('#chRes [data-a="chPick"]'); await sleep(300);
    ok(await p.inputValue('[data-f="d"]') === 'منشورات الاختبار الجديدة' && await p.inputValue('[data-f="n"]') === 'مدخل إلى علم المكتبات', 'زر «اختر» لدار النشر: قائمة فيها بحث (بلا همزات)، والموجود قبل «اسم جديد»، والاختيار يملأ الخانة');
    await p.click('[data-a="fPick"][data-v="c"]'); await p.waitForSelector('#chQ');
    await p.fill('#chQ', 'علم المكتبات والمعلومات'); await sleep(200);
    ok(/استعمل «علم المكتبات والمعلومات»/.test(await txt(p, '#chRes')), 'تخصص غير موجود: يُعرض «استعمل…» ليصير تخصصاً جديداً');
    await p.click('#chRes .li.new'); await sleep(300);
    await p.selectOption('[data-f="l"]', 'C'); await p.selectOption('[data-f="s"]', '2');
    await p.fill('[data-f="bc"]', B(21).barcode);
    await p.fill('[data-f="p"]', '22.5'); await p.fill('[data-f="q"]', '8'); await p.fill('[data-f="m"]', '2');
    await p.click('[data-a="newSave"]'); await sleep(300);
    ok(/مستعمل في/.test(await txt(p, '#fe_bc')), 'باركود مستعمل يُرفض قبل الإرسال');
    await p.evaluate(() => UI.act('fab')); await sleep(200);
    await p.evaluate(() => { if (window.WebScan) WebScan.close(); UI.onScan('9990009998887'); }); await sleep(300);
    ok(await p.inputValue('[data-f="bc"]') === '9990009998887', 'زر المسح الأوسط في «صنف جديد» يملأ خانة الباركود');
    await shot(p, 't16-new');
    await p.click('[data-a="newSave"]'); await sleep(500);
    const n1 = await sent(p, f => f.edits && f.edits.find(x => x.kind === 'new'));
    ok(n1 && n1.t === 'book' && n1.by === 's-boss' && n1.to === 'tripoli' && n1.set.n === 'مدخل إلى علم المكتبات' && n1.set.a === 'د. فاطمة الورفلي' && n1.set.d === 'منشورات الاختبار الجديدة' && n1.set.c === 'علم المكتبات والمعلومات' &&
      n1.set.l === 'C' && n1.set.s === '2' && n1.set.bc === '9990009998887' && n1.set.p === 22.5 && n1.set.q === 8 && n1.set.m === 2 && n1.set.dst === 'shelf', 'الكتاب الجديد وصل خادم الربط بكل بياناته (kind: new)', n1);
    const dr = await p.evaluate(() => ({ d: Core.S.draft.book, first: Core.items()[0], list: document.querySelector('.form-page .list') ? document.querySelector('.form-page .list').innerText : '' }));
    ok(dr.d.n === '' && dr.d.bc === '' && dr.d.c === 'علم المكتبات والمعلومات' && dr.d.l === 'C' && dr.d.d === 'منشورات الاختبار الجديدة', 'بعد الإضافة: النموذج يفرغ، وما يتكرّر يبقى (المكان، التخصص، دار النشر)', dr.d);
    ok(dr.first.isNew && dr.first.n === 'مدخل إلى علم المكتبات' && /مدخل إلى علم المكتبات/.test(dr.list) && /ينتظر المنظومة|لم يُرسل بعد/.test(dr.list), 'والكتاب الجديد يظهر أول القائمة «ينتظر المنظومة»، وتحت النموذج «آخر ما أضفته»');
    await p.fill('[data-f="n"]', 'مدخل الى علم المكتبات'); await p.fill('[data-f="p"]', '5');
    await p.click('[data-a="newSave"]'); await p.waitForSelector('#sheet [data-a="newForce"]');
    ok(/يوجد كتاب بنفس الاسم/.test(await txt(p, '#sheet')), 'اسم موجود (ولو بهمزة مختلفة): يُسأل قبل الإضافة');
    await noSheet(p);
    await p.fill('[data-f="n"]', '');
    await p.click('[data-a="imode"][data-v="view"]'); await sleep(250);
    await p.fill('#iq', 'علم المكتبات'); await sleep(600);
    ok(/جديد — ينتظر المنظومة/.test(await txt(p, '#ires .res')), 'وفي «عرض وتعديل» يظهر بعلامة «جديد — ينتظر المنظومة»');
    await p.click('#ires .res'); await p.waitForSelector('.ihead');
    ok(!(await p.$('.acts')) && /ينتظر تسجيله/.test(await txt(p, '.page')), 'لا يُباع ولا يُعدَّل حتى تسجّله المنظومة');
    await p.click('.bar [data-a="back"]'); await p.waitForSelector('#iq'); await p.click('[data-a="clrQ"]');
    await p.click('[data-a="imode"][data-v="new"]'); await sleep(200);
    await p.click('[data-a="itype"][data-v="stat"]'); await sleep(250);
    const sf = await p.$$eval('[data-f]', e => e.map(x => x.getAttribute('data-f')));
    ok(sf.includes('u') && sf.includes('loc') && !sf.includes('d') && !sf.includes('cf') && !sf.includes('l'), 'صنف قرطاسية جديد: وحدة البيع والمكان في المحل (بلا دار نشر ولا رف)', sf);
    await p.fill('[data-f="n"]', 'قلم تحديد أصفر'); await p.fill('[data-f="a"]', 'ستابيلو'); await p.selectOption('[data-f="u"]', 'علبة');
    await p.fill('[data-f="loc"]', 'الدرج 3'); await p.fill('[data-f="p"]', '4'); await p.fill('[data-f="q"]', '24');
    await p.click('[data-a="fSet"][data-v="dst|store"]'); await sleep(200);
    await p.click('[data-a="newSave"]'); await sleep(400);
    const n2 = await sent(p, f => f.edits && f.edits.find(x => x.kind === 'new' && x.t === 'stat'));
    ok(n2 && n2.set.n === 'قلم تحديد أصفر' && n2.set.a === 'ستابيلو' && n2.set.u === 'علبة' && n2.set.loc === 'الدرج 3' && n2.set.p === 4 && n2.set.q === 24 && n2.set.dst === 'store', 'القرطاسية الجديدة وصلت خادم الربط (لغرفة الخزين)', n2);
    await p.click('[data-a="itype"][data-v="book"]');

    console.log('\n== الجرد ==');
    await tab(p, 'home');
    await p.click('.menu [data-v="count"]'); await p.waitForSelector('#shIn');
    await syncOk('الجرد');
    ok(!(await p.$('#cnt')) && !/تسجيل الأماكن/.test(await p.textContent('.page')), 'الجرد وحده: لا خيار «تسجيل الأماكن»');
    await p.click('.letters button:nth-child(3)');
    await p.click('[data-a="shelf"][data-v="1"]'); await p.click('[data-a="shelf"][data-v="1"]');
    await p.evaluate(bs => { bs.forEach(b => { UI.onScan(b); if (window.WebScan) WebScan.close(); }); }, [B(30).barcode, B(31).barcode, B(30).barcode]);
    await sleep(300);
    const L = await p.evaluate(() => Core.S.loc);
    ok(L.lib === 'C' && L.shelf === '3' && L.list.length === 2 && L.list.find(x => x.c === 2), 'الجرد: خزانة C رف 3، كتابان، والكتاب الممسوح مرتين نسختان', L);
    /* القائمة: آخر ما مُسح أولاً — السطر الأول B(31) بنسخة، والثاني B(30) بنسختين */
    await p.click('.list .li:nth-child(1) [data-a="cntSet"]'); await p.waitForSelector('#cntN');
    await p.fill('#cntN', '9'); await p.click('[data-a="cntSave"]'); await sleep(300);
    ok(await p.evaluate(() => Core.S.loc.list[0].c === 9 && Core.S.loc.list[1].c === 2), 'الضغط على العدد يكتبه مباشرة (9) بدل تسع مسحات');
    await shot(p, 't17-count');
    const le = await sent(p, f => f.edits && f.edits.find(x => x.b === B(30).barcode && !x.kind), 9000);
    ok(le && le.set.l === 'C' && le.set.s === '3' && le.set.cnt === 1 && le.set.qd === 2 - Math.max((B(30).qty || 0) - (B(30).store || 0), 0), 'الجرد وصل خادم الربط: المكان C · رف 3، والكمية فرقاً عمّا على الرف', le && le.set);
    const le2 = await sent(p, f => f.edits && f.edits.find(x => x.b === B(31).barcode && !x.kind), 4000);
    ok(le2 && le2.set.qd === 9 - Math.max((B(31).qty || 0) - (B(31).store || 0), 0), 'والعدد المكتوب بيد يصل فرقاً صحيحاً (المطلوب 9)', le2 && le2.set);

    console.log('\n== تأكيدات المنظومة، وسجل الإرسال ==');
    const pf = await phoneOf(p);
    ok(pf.edits.map(x => x.id).join() === pf.edits.map(x => x.id).slice().sort().join(), 'التعديلات تُرسل بترتيب حدوثها (الأقدم أولاً): تعديلان لحقل واحد، الأخير هو الباقي', pf.edits.map(x => x.id));
    triSnap.acks[e.id] = 2; triSnap.acks[r1.id] = 1; triSnap.acks[r2.id] = 2; triSnap.acks[n1.id] = 1; triSnap.acks[n2.id] = 0;
    await call('/put', { method: 'POST', body: JSON.stringify(triSnap) });
    await p.evaluate(() => UI.refresh(true));
    await p.waitForFunction(() => Core.S.edits.some(x => x.status === 'fail'), null, { timeout: 15000 });
    await sleep(300);
    const stt = await p.evaluate(ids => ids.map(id => (Core.S.edits.find(x => x.id === id) || {}).status), [e.id, r1.id, r2.id, n1.id, n2.id]);
    ok(stt.join() === 'part,done,part,done,fail', 'التأكيدات: 1 سُجّل، 2 سُجّل بعضه، 0 لم يُسجَّل', stt);
    ok(/لم تسجّل المنظومة الصنف الجديد «قلم تحديد أصفر»/.test(await txt(p, '#toasts')), 'ما رفضته المنظومة يُقال فوراً');
    ok((await p.getAttribute('.nav [data-tab="settings"]', 'data-badge')) === '!', 'وعلامة على تبويب الإعدادات');
    await tab(p, 'home');
    ok(/عملية لم تسجّلها المنظومة/.test(await txt(p, '.strip')), 'وفي الرئيسية شريط «لم تسجّلها المنظومة»');
    await p.click('.strip'); await p.waitForSelector('[data-a="outTab"]');
    await syncOk('سجل الإرسال');
    const ob = (await txt(p, '.page')).replace(/\s+/g, ' ');
    ok(/جديد: قلم تحديد أصفر/.test(ob) && /لم يُسجَّل/.test(ob) && /إضافة كمية:/.test(ob) && /سُجّل بعضه/.test(ob) && /تعديل: حقوق الأقليات/.test(ob) && /جرد:/.test(ob) && /بيع:/.test(ob), 'سجل الإرسال: كل بيع وتعديل وإضافة وجرد بحالته', ob.slice(0, 300));
    await shot(p, 't18-outbox');
    await p.click('[data-a="outTab"][data-v="bad"]'); await sleep(200);
    ok(await p.$$eval('.list .li', x => x.length) === 3, 'تبويب «لم يُسجَّل» يعرض المرفوض وما سُجّل بعضه (3)');

    console.log('\n== الإعدادات ==');
    await tab(p, 'settings');
    await syncOk('الإعدادات');
    const secs = await p.$$eval('.ssec', x => x.map(e => e.textContent));
    ok(secs.join('|') === 'الحساب والأمان|المظهر|البيع والمسح|إضافة وتعديل|التحديث والإرسال|هذا الهاتف والربط|حول التطبيق', 'الإعدادات مرتّبة في أقسام', secs);
    ok(/3\.0/.test(await txt(p, '.page')) && /محدّثة/.test(await txt(p, '.page')), 'فيها الإصدار 3.0، وأن منظومة الكمبيوتر تقبل ميزات الهاتف');
    await shot(p, 't19-settings');
    await p.click('[data-a="pPick"][data-v="dark"]'); await p.click('[data-a="pSet"][data-v="dark|dark"]'); await sleep(300);
    const dk = await p.evaluate(() => ({ dark: document.body.classList.contains('dark'), bg: getComputedStyle(document.body).backgroundColor, card: getComputedStyle(document.querySelector('.list')).backgroundColor, ink: getComputedStyle(document.body).color }));
    ok(dk.dark && dk.bg === 'rgb(13, 18, 28)' && dk.card === 'rgb(23, 30, 45)' && dk.ink === 'rgb(237, 240, 247)', 'المظهر الداكن: الخلفية والبطاقات والحبر تتبدّل', dk);
    await shot(p, 't20-dark');
    await p.click('[data-a="pPick"][data-v="font"]'); await p.click('[data-a="pSet"][data-v="font|l"]'); await sleep(300);
    const fz = await p.evaluate(() => ({ l: document.body.classList.contains('fs-l'), b: parseFloat(getComputedStyle(document.querySelector('.srow .m b')).fontSize), nav: parseFloat(getComputedStyle(document.querySelector('.nav .n')).fontSize) }));
    ok(fz.l && Math.abs(fz.b - 14 * 1.12) < 0.1 && fz.nav === 10.5, 'حجم الخط «كبير»: النص يكبر 12٪ (والشريط السفلي يبقى بحجمه)', fz);
    await p.click('[data-p="anim"]'); await sleep(200);
    ok(await p.evaluate(() => document.body.classList.contains('noanim') && Core.pref('anim') === false), 'إيقاف الحركات يطفئ الأنميشن كله');
    await p.click('[data-a="pPick"][data-v="lockMin"]'); await p.click('[data-a="pSet"][data-v="lockMin|15"]'); await sleep(200);
    await p.click('[data-a="pPick"][data-v="every"]'); await p.click('[data-a="pSet"][data-v="every|300"]'); await sleep(200);
    await p.click('[data-p="cont"]'); await p.click('[data-p="autoPrint"]'); await sleep(150);
    ok(await p.evaluate(() => Core.pref('lockMin') === 15 && Core.pref('every') === 300 && Core.pref('cont') === true && Core.pref('autoPrint') === true), 'القفل بعد ربع ساعة، التحديث كل 5 دقائق، المسح المتواصل، والطباعة التلقائية: تُحفظ');
    await p.click('[data-a="whatsNew"]'); await sleep(200);
    ok(/إضافة وتعديل/.test(await txt(p, '#sheet')), '«ما الجديد» يشرح الإصدار');
    await noSheet(p);
    await p.fill('#phName', 'هاتف المخزن'); await p.dispatchEvent('#phName', 'change'); await sleep(600);
    ok((await phoneOf(p)).branch.name === 'هاتف المخزن', 'اسم الهاتف يُحفظ ويصل خادم الربط');

    console.log('\n== يفتح بلا إنترنت، والدخول مع كل فتح، والإعدادات تبقى ==');
    await ctx.route(cloud.url + '/**', rt => rt.abort());
    await p.reload(); await p.waitForSelector('.who .p', { timeout: 20000 });
    ok(await p.evaluate(() => document.body.classList.contains('dark') && document.body.classList.contains('fs-l') && document.body.classList.contains('noanim')), 'بعد إعادة الفتح يطلب الدخول من جديد، والمظهر والخط كما اختيرا');
    await enter(p, 's-boss', '9876');
    const off = await p.evaluate(() => ({ n: Core.info().n, all: Core.items().length, first: Core.items()[0].n }));
    ok(off.n === items.length && off.all === items.length + 1 && off.first === 'مدخل إلى علم المكتبات', 'بلا إنترنت: الأصناف كلها من الهاتف نفسه، ومعها الكتاب الجديد الذي سجّلته المنظومة ولم يصل في قائمتها بعد (والمرفوض لا يُعرض)', off);
    await p.evaluate(() => UI.refresh(true)); await sleep(1500);
    ok(/تعذّر التحديث|بلا إنترنت/.test(await txt(p, '#syncLine')) && await p.evaluate(() => document.getElementById('syncLine').classList.contains('bad')), 'وسطر التحديث يقول إن التحديث تعذّر (بلون التنبيه)', await txt(p, '#syncLine'));
    await ctx.close();

    console.log('\n== منظومة كمبيوتر قديمة (4.1): الميزات الجديدة تقول «حدّث المنظومة» ==');
    {
      const cx = await browser.newContext({ ...devices['iPhone 13'] });
      const z = await page(sO, cx);
      await z.goto(sO.url + link);
      await z.waitForSelector('#pw2', { timeout: 30000 });
      await z.fill('#pw', '1357'); await z.fill('#pw2', '1357'); await z.click('[data-a="pinSet"]');
      await z.waitForSelector('.menu'); await sleep(600); await noSheet(z);
      ok(await z.evaluate(() => Core.proto()) === 0, 'لقطة بلا ph: المنظومة قديمة');
      await tab(z, 'items');
      await z.click('[data-a="imode"][data-v="new"]'); await sleep(200);
      ok(/تحتاج تحديث منظومة الكمبيوتر/.test(await z.textContent('.page')) && !(await z.$('[data-a="newSave"]')), '«صنف جديد»: تحتاج تحديث المنظومة إلى 4.2');
      await z.click('[data-a="imode"][data-v="qty"]'); await sleep(200);
      ok(/تحتاج تحديث منظومة الكمبيوتر/.test(await z.textContent('.page')), '«إضافة كمية»: كذلك');
      await z.click('[data-a="imode"][data-v="view"]'); await sleep(200);
      await z.click('#ires .res'); await z.waitForSelector('.acts');
      ok(!(await z.$('[data-a="addQty"]')) && !!(await z.$('[data-a="edit"]')), 'بطاقة الصنف: تعديل بلا «إضافة كمية»');
      await z.click('.acts [data-a="edit"]'); await z.waitForSelector('[data-f="n"]');
      const od = await z.evaluate(() => { const o = {}; [].forEach.call(document.querySelectorAll('[data-f]'), e => { o[e.getAttribute('data-f')] = !e.disabled; }); return o; });
      ok(od.n && od.a && od.p && od.m && od.l && od.s && od.q && !od.d && !od.c && !od.bc && !od.pw && !od.st && !od.nt, 'التعديل: خانات 4.1 مفتوحة (الاسم، المؤلف، السعر، حد التنبيه، المكان، الكمية) والجديدة مقفلة', od);
      await z.fill('[data-f="p"]', '77'); await z.click('[data-a="editSave"]'); await sleep(500);
      const oe = await sent(z, f => f.edits && f.edits[0]);
      ok(oe && oe.set.p === 77 && Object.keys(oe.set).join() === 'p', 'والتعديل يُرسل بالمفاتيح التي تفهمها 4.1', oe && oe.set);
      await tab(z, 'home');
      await z.click('.menu [data-v="credit"]'); await sleep(200);
      ok(/تحتاج تحديث منظومة الكمبيوتر/.test(await z.textContent('.page')), '«الآجل»: سجله يصل من 4.2');
      await tab(z, 'settings');
      ok(/تحتاج تحديثاً/.test(await z.textContent('.page')), 'والإعدادات تقول إن المنظومة تحتاج تحديثاً');
      await cx.close();
    }

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
    await q.waitForSelector('.menu'); await sleep(700); await noSheet(q);
    ok(await q.evaluate(() => Core.info().src === 'snap' && Core.info().n === 1700 && Core.byType('book').length === 1500 && Core.byType('stat').length === 200), 'أصناف مصراتة من لقطتها: 1500 كتاب و200 قرطاسية');
    ok((await q.$$eval('.menu .mi', x => x.map(b => b.getAttribute('data-v')))).join() === 'count,invoices,credit,debts,alerts', 'الرئيسية (بلا موظفين): الجرد، الفواتير، الآجل، الديون، التنبيهات');
    ok(await q.evaluate(() => { const r = document.querySelector('.menu .mi:last-child').getBoundingClientRect(), n = document.querySelector('.nav').getBoundingClientRect(); return r.bottom <= n.top + 1; }), 'والقائمة كلها ظاهرة على الشاشة بلا تمرير (آيفون 13)');
    await shot(q, 'm01-home');
    await q.click('.menu [data-v="debts"]'); await q.waitForSelector('[data-a="debtTab"]');
    await q.click('[data-a="debtTab"][data-v="sup"]'); await sleep(200);
    const sd = (await txt(q, '.page')).replace(/\s+/g, ' ');
    ok(/3,450\.50/.test(sd) && /دار الفكر للتوزيع/.test(sd) && /إجمالي ما علينا/.test(sd), 'الديون: «علينا للموردين» بمجموعها وأسمائهم', sd.slice(0, 200));
    await shot(q, 'm02-debts-sup');
    await tab(q, 'items'); await q.waitForSelector('#iq');
    await q.click('[data-a="itype"][data-v="stat"]'); await q.click('[data-a="iview"][data-v="cards"]'); await sleep(300);
    ok(await q.$$eval('#ires .cardi', x => x.length) === 40, 'القرطاسية بطاقات');
    await shot(q, 'm03-stat-cards');
    await q.click('[data-a="itype"][data-v="book"]'); await q.click('[data-a="iview"][data-v="list"]');
    await tab(q, 'sell');
    await q.evaluate(() => { UI.onScan('9780000000031'); }); await sleep(300);
    await q.click('[data-a="meth"][data-v="credit"]');
    await q.selectOption('#cust', 'c1');
    await q.fill('#paid', '0'); await q.dispatchEvent('#paid', 'change');
    await shot(q, 'm04-sell-credit');
    await q.click('[data-a="checkout"]'); await q.waitForSelector('#donePop'); await q.click('[data-a="rcSkip"]');
    const mo = await sent(q, f => f.orders && f.orders.find(x => x.to === 'misrata'));
    ok(mo && mo.method === 'credit' && mo.cust === 'c1' && !mo.by, 'بيع آجل من مصراتة وصل خادم الربط للزبون', mo);
    await tab(q, 'settings');
    await q.click('[data-a="pinChange"]'); await q.waitForSelector('#pinOld');
    await q.fill('#pinOld', '0000'); await q.fill('#pinA', '9753'); await q.fill('#pinB', '9753'); await q.click('[data-a="pinSave"]'); await sleep(700);
    ok(/الحالي غير صحيح/.test(await txt(q, '#pinErr')), 'تغيير رمز الهاتف: الرمز الحالي الخطأ يُرفض');
    await q.fill('#pinOld', '2468'); await q.click('[data-a="pinSave"]'); await sleep(900);
    await q.reload(); await q.waitForSelector('#pw');
    ok(!(await q.$('#pw2')), 'إعادة الفتح تطلب الرمز');
    await q.fill('#pw', '2468'); await q.click('[data-a="pinIn"]'); await sleep(700);
    ok(/غير صحيح/.test(await q.textContent('#lkErr')), 'الرمز القديم لم يعد يدخل');
    await q.fill('#pw', '9753'); await q.click('[data-a="pinIn"]'); await q.waitForSelector('.menu');
    ok(true, 'والرمز الجديد يدخل');
    await ctx2.close();

    ok(errs.length === 0, 'بلا أخطاء في الصفحات', errs.slice(0, 5));
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    if (sT) sT.srv.close();
    if (sM) sM.srv.close();
    if (sO) sO.srv.close();
    await cloud.close();
  }
  console.log('\n==================================================');
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})();
