/* ============================================================
   test-phone-e2e.js — تطبيق الهاتف مع منظومة طرابلس الحقيقية
   ------------------------------------------------------------
   المحرك الحقيقي (تطبيق طرابلس تحت mono) بكتب فوق حدّ «الفرع الكبير»
   (5000)، مربوطاً بخادم ربط (fake-cloud: cloud/worker.js نفسه)، وشاشاته
   3.x في متصفح، وتطبيق الهاتف (site/) في متصفح بمقاس آيفون:
   - كتب طرابلس تصل الهاتف من قائمة الفرع التي ينشرها المحرك.
   - بيع من الهاتف يصل المنظومة فاتورةً، والسؤال الخفيف عن الهاتف لا يرفع
     لقطة، ورقم الفاتورة يعود للهاتف.
   - تعديل اسم كتاب من الهاتف يُطبَّق في المنظومة، ويعود في قائمة الفرع.
     node tools/test-phone-e2e.js            (BOOKS=… لعدد آخر)
   ============================================================ */
'use strict';
process.env.QIRTASIYA_SYNC_MS = '3000';
process.env.QIRTASIYA_SYNC_FAST_MS = '1000';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { chromium, devices } = require('playwright-core');
const E = require('./engine');
const C = require('./fake-cloud');
const { generate } = require('./gen/generate');

const ROOT = path.join(__dirname, '..'), SITE = path.join(ROOT, 'site');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const KEY = 'test-phone-e2e';
const BOOKS = parseInt(process.env.BOOKS || '6000', 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(c, name, d) {
  if (c) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (d === undefined ? '' : ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); }
}
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
function site(cfg) {
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/config.js') { s.writeHead(200, { 'content-type': MIME['.js'] }); return s.end('window.MAKTABA_CONFIG = ' + JSON.stringify(cfg) + ';'); }
    const f = path.join(SITE, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1)));
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' })));
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qpe-'));
  const cloud = await C.start({ secret: KEY });
  const dir = path.join(tmp, 'T'), home = path.join(tmp, 'T-home');
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true }); fs.mkdirSync(home, { recursive: true });
  let proc = null, port = 0, browser = null, st = null;
  const raw = (p, body, h) => E.call(port, p, body, h);
  try {
    console.log('يولّد ' + BOOKS + ' كتاباً ويبني تطبيق طرابلس…');
    generate({ profile: 'tripoli', books: BOOKS, stationery: 200, years: 1, store3: 1, out: path.join(tmp, 'g') });
    const store = JSON.parse(fs.readFileSync(path.join(tmp, 'g', 'store3.json'), 'utf8'));
    store.invoices = []; store.payments = []; store.counters.invoice = 0;
    store.branch = { id: 'tripoli', name: 'دار الحكمة — طرابلس', city: 'طرابلس', no: 2 };
    store.sync = { url: cloud.url, key: KEY, auto: true, everyMin: 10 };
    const seen = {};
    store.books.forEach(b => { if (b.barcode) seen[b.barcode] = (seen[b.barcode] || 0) + 1; });
    const good = store.books.filter(b => b.barcode && seen[b.barcode] === 1 && b.price > 0 && b.qty > 2);
    const b1 = good[3], b2 = good[4], b3 = good[5];
    fs.writeFileSync(path.join(dir, 'data', 'store.json'), JSON.stringify(store));
    E.buildEngine(dir, 'tripoli');
    proc = E.startEngine(dir, home); port = await E.waitPort(dir);
    const ow = (await raw('/api/claim', { force: true })).body.token;
    let r = await raw('/api/link', { action: 'main', url: cloud.url, key: KEY, name: 'كاشير طرابلس' }, { 'X-Owner': ow });
    ok(r.body && r.body.ok && r.body.data.role === 'main', 'منظومة طرابلس: جهاز المحل على خادم الربط', r.body);
    await raw('/api/release?t=' + ow, {});

    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    const errs = [];
    /* شاشة المنظومة 3.x: ترفع لقطة الفرع (بلا كتب، فرع كبير) وتأخذ بيع الهاتف */
    const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    pc.on('pageerror', e => errs.push('pc: ' + e.message));
    await pc.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await pc.waitForFunction(() => window.App && App.S && App.S.books && App.S.books.length > 1000 && window.Stock, null, { timeout: 60000 });
    await sleep(2500);
    await pc.evaluate(() => Stock.sync(true)); await sleep(2500);
    const kvT = JSON.parse(cloud.env.SHOP.map.get('branch:tripoli') || 'null');
    ok(kvT && kvT.items.length === 0 && kvT.dash, 'لقطة طرابلس على خادم الربط بلا كتب (فرع كبير)، ومعها لوحة اليوم', kvT && kvT.items.length);
    ok(await pc.evaluate(() => Stock.kvFast()), 'المنظومة عرفت أن خادم الربط بالفهرس: تسأل عن الهاتف كل دقيقة');
    let cat = null;
    for (let i = 0; i < 40 && !cat; i++) {
      const c = await (await fetch(cloud.url + '/v2/catalogs?branch=tripoli', { headers: { 'X-Shop-Key': KEY } })).json();
      cat = (c.catalogs || []).find(x => x.branch === 'tripoli');
      if (!cat) await sleep(500);
    }
    ok(cat && cat.n >= BOOKS, 'المحرك نشر قائمة كتب طرابلس (' + (cat && cat.n) + ')', cat);

    /* ---------- الهاتف ---------- */
    st = await site({ url: '', key: '', branch: 'tripoli', theme: 'blue', name: 'دار الحكمة', city: 'طرابلس' });
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('phone: ' + e.message));
    await p.goto(st.url + '#u=' + encodeURIComponent(cloud.url) + '&k=' + encodeURIComponent(KEY));
    await p.waitForSelector('#pw2', { timeout: 60000 });
    await p.fill('#pw', '1357'); await p.fill('#pw2', '1357'); await p.click('[data-a="pinSet"]');
    await p.waitForSelector('.hd .big');
    await p.evaluate(() => { const s = document.getElementById('sheet'); s.hidden = true; s.innerHTML = ''; });
    const inf = await p.evaluate(() => Core.info());
    ok(inf.src === 'cat' && inf.n === cat.n, 'الهاتف: كتب طرابلس كلها من قائمة الفرع (' + inf.n + ')', inf);
    const g1 = await p.evaluate(b => { const g = Core.byCode(b); return g && { n: g.n, q: g.q, p: g.p, lib: g.lib, shelf: g.shelf }; }, b1.barcode);
    ok(g1 && g1.n === b1.title && g1.q === b1.qty && Math.abs(g1.p - b1.price) < 0.001, 'كتاب بالباركود: الاسم والكمية والسعر كما في المنظومة', { g1, b: { n: b1.title, q: b1.qty, p: b1.price } });

    console.log('\n== بيع من الهاتف يصل المنظومة ==');
    await p.evaluate(([x, y]) => { UI.go('sell'); UI.onScan(x); UI.onScan(x); UI.onScan(y); }, [b1.barcode, b2.barcode]);
    await sleep(300);
    await p.click('[data-a="checkout"]'); await p.waitForSelector('#donePop'); await p.click('[data-a="rcSkip"]');
    await sleep(1500);
    const oid = await p.evaluate(() => Core.S.orders[0].id);
    const nInv0 = await pc.evaluate(() => App.S.invoices.length);
    const putsBefore = cloud.env.SHOP.stats.put;
    const t0 = Date.now();
    await pc.evaluate(() => Stock.sync(false, true));          // سؤال الدقيقة (بلا رفع)
    let inv = null;
    for (let i = 0; i < 30 && !inv; i++) {
      inv = await pc.evaluate(() => App.S.invoices.find(v => v.source === 'phone') || null);
      if (!inv) await sleep(300);
    }
    ok(inv && inv.items.length === 2 && inv.items.some(l => l.qty === 2), 'الفاتورة سُجّلت في المنظومة (' + (inv && inv.no) + ') خلال ' + ((Date.now() - t0) / 1000).toFixed(1) + ' ث', inv && inv.items);
    const after = await pc.evaluate(([x, y]) => ({ a: App.S.books.find(b => b.barcode === x).qty, b: App.S.books.find(b => b.barcode === y).qty }), [b1.barcode, b2.barcode]);
    ok(after.a === b1.qty - 2 && after.b === b2.qty - 1, 'والمخزون نقص في المنظومة', after);
    await sleep(2500);                                          // التأكيد يُرفع بعدها وحده
    ok(cloud.env.SHOP.stats.put - putsBefore <= 2, 'السؤال الخفيف لم يرفع لقطة، والتأكيد رفعة واحدة', cloud.env.SHOP.stats.put - putsBefore);
    await p.evaluate(() => UI.refresh(true)); await sleep(2000);
    const o = await p.evaluate(id => Core.S.orders.find(x => x.id === id), oid);
    ok(o && o.status === 'done' && o.inv === inv.no, 'رقم الفاتورة رجع للهاتف (' + (o && o.inv) + ')', o);
    const gq = await p.evaluate(b => Core.byCode(b).q, b1.barcode);
    ok(gq === b1.qty - 2, 'الهاتف يطرح ما باعه حتى تصل قائمة الفرع الجديدة', gq);

    console.log('\n== تعديل من الهاتف ==');
    await p.evaluate(b => { const g = Core.byCode(b); Core.editItem(g, { n: 'عنوان معدّل من الهاتف', p: 33.5 }); }, b3.barcode);
    await sleep(1500);
    await pc.evaluate(() => Stock.sync(false, true));
    let ed = null;
    for (let i = 0; i < 30 && !ed; i++) {
      ed = await pc.evaluate(b => { const x = App.S.books.find(y => y.barcode === b); return x && x.title === 'عنوان معدّل من الهاتف' ? x : null; }, b3.barcode);
      if (!ed) await sleep(300);
    }
    ok(ed && ed.price === 33.5, 'تعديل الاسم والسعر طُبّق في المنظومة', ed && { t: ed.title, p: ed.price });
    /* قائمة الفرع الجديدة: «حدّث الآن» في المنظومة */
    const ow2 = (await raw('/api/claim', { force: true })).body.token;
    await raw('/api/link', { action: 'now' }, { 'X-Owner': ow2 });
    await raw('/api/release?t=' + ow2, {});
    await p.evaluate(() => UI.refresh(true)); await sleep(3000);
    const g3 = await p.evaluate(b => { const g = Core.byCode(b); return g && { n: g.n, p: g.p, editing: !!g.editing }; }, b3.barcode);
    const g1b = await p.evaluate(b => Core.byCode(b).q, b1.barcode);
    ok(g3 && g3.n === 'عنوان معدّل من الهاتف' && g3.p === 33.5, 'والقائمة الجديدة على الهاتف فيها الاسم والسعر الجديدان', g3);
    ok(g1b === b1.qty - 2, 'والكمية بعد البيع من القائمة نفسها (لا تُطرح مرتين)', g1b);

    ok(errs.length === 0, 'بلا أخطاء في الصفحات', errs.slice(0, 5));
    await ctx.close();
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    if (st) st.srv.close();
    if (proc) E.stopEngine(proc);
    await cloud.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n==================================================');
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})();
