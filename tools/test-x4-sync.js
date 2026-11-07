/* ============================================================
   test-x4-sync.js — طرابلس: ما يُحفظ على جهاز يصل الآخر خلال ثوانٍ
   ------------------------------------------------------------
   طلب المستخدم: «ما نبيش يحمل كل دقيقة… نبي على طول يتحدث بين الأجهزة».
   تطبيق طرابلس الحقيقي (المحرك تحت mono) على جهازين: جهاز المحل وجهاز ثانٍ، وخادم الربط
   (fake-cloud: cloud/worker.js نفسه). الدورة السريعة كل ثانية هنا (4 ثوانٍ في البرنامج)،
   والتسليم كل دقيقة كما في البرنامج:
   - بيعة على جهاز المحل تصل الجهاز الثاني خلال ثوانٍ، وتعديل على الثاني يصل المحل.
   - بين التسليمين قراءة فقط: لا كتابة في D1 والأجهزة ساكنة (الخطة المجانية: 100 ألف كتابة في اليوم).
   - «الأجهزة المربوطة»: الجهازان باسميهما وآخر تسليم، و«هذا الجهاز».
   - جهاز ثانٍ كان مغلقاً يلحق كل ما فاته، والنبض يقول «ما بقي» (behind) للشاشة.
   - الشاشة: «الأجهزة المربوطة» في الإعدادات ← الأجهزة والفروع.
     node tools/test-x4-sync.js
   ============================================================ */
'use strict';
process.env.QIRTASIYA_SYNC_MS = '60000';
process.env.QIRTASIYA_SYNC_FAST_MS = '1000';
process.env.QIRTASIYA_X3_CHECK = '1';
const fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright-core');
const E = require('./engine');
const C = require('./fake-cloud');

const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const KEY = 'test-x4-key';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)))); }
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
  d.write = o => fs.writeFileSync(d.data('store.json'), JSON.stringify(o));
  return d;
}

const store = url => ({
  meta: { setupDone: true, shopName: 'مكتبة طرابلس', currency: 'د.ل', libraries: ['A', 'B'], shelves: 6, theme: 'violet' },
  branch: { id: 'tripoli', name: 'مكتبة طرابلس', city: 'طرابلس', no: 2 },
  sync: { url, key: KEY, auto: false, everyMin: 10 },
  books: [
    { id: 'b1', code: 'K0001', title: 'كتاب الرياضيات', lib: 'A', shelf: '1', barcode: '111', cost: 10, price: 15, qty: 20, min: 3 },
    { id: 'b2', code: 'K0002', title: 'الفيزياء الأساسية', lib: 'B', shelf: '2', barcode: '222', cost: 20, price: 30, qty: 5, min: 1 }
  ],
  stationery: [], customers: [], invoices: [], payments: [], counters: { invoice: 0, book: 2, stat: 0 }
});

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qx4s-'));
  const cloud = await C.start({ secret: KEY });
  const T = device(tmp, 'T'), U = device(tmp, 'U');
  const claim = async d => (await d.raw('/api/claim', { force: true })).body.token;
  const link = (d, ow, body) => d.raw('/api/link', body, { 'X-Owner': ow });
  const load = async d => {
    const r = await fetch(d.url() + 'api/load', { headers: { 'X-Qirtasiya': '1', Origin: 'http://127.0.0.1:' + d.port } });
    return { s: JSON.parse(await r.text()), rev: r.headers.get('X-X3-Rev') || '' };
  };
  const save = async (d, ow, mut) => {
    const a = await load(d);
    const n = JSON.parse(JSON.stringify(a.s));
    mut(n);
    return d.raw('/api/save', n, { 'X-Owner': ow, 'X-X3-Rev': a.rev });
  };
  /* حتى يتحقق الشرط على بيانات الجهاز؛ الزمن بالملّي ثانية أو -1 */
  const within = async (d, fn, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (fn((await load(d)).s)) return Date.now() - t0; } catch (e) { }
      await sleep(200);
    }
    return -1;
  };
  const W = () => cloud.env.DB.stats.writes;
  let browser = null;
  try {
    console.log('يبني تطبيق طرابلس...');
    E.buildEngine(T.dir, 'tripoli');
    E.copyEngine(T.dir, U.dir);

    console.log('\n== جهاز المحل وجهاز ثانٍ ==');
    T.write(store(cloud.url));
    await T.start();
    let owT = await claim(T);
    let r = await link(T, owT, { action: 'main', url: cloud.url, key: KEY, name: 'كاشير الأرضي' });
    ok(r.body && r.body.ok && r.body.data.role === 'main', 'كاشير الأرضي: جهاز المحل', r.body);
    U.write(store(cloud.url));
    await U.start();
    let owU = await claim(U);
    r = await link(U, owU, { action: 'second', url: cloud.url, key: KEY, branch: 'tripoli', name: 'جهاز الدور الأول', replace: true });
    ok(r.body && r.body.ok && r.body.data.role === 'second', 'جهاز الدور الأول: جهاز ثانٍ', r.body);
    owU = await claim(U);
    await sleep(2500);

    console.log('\n== بيعة على جهاز المحل تصل الجهاز الثاني خلال ثوانٍ ==');
    const w0 = W();
    await sleep(6000);
    ok(W() - w0 === 0, 'ست ثوانٍ والجهازان ساكنان: لا كتابة في D1 (القراءة وحدها بين التسليمين)', W() - w0);
    r = await save(T, owT, n => { n.books.find(b => b.id === 'b1').qty = 19; n.books.push({ id: 'nb1', code: 'K0003', title: 'كتاب جديد من الكاشير', price: 9, qty: 2 }); });
    ok(r.body && r.body.ok, 'الحفظ على جهاز المحل', r.body);
    const tA = await within(U, s => s.books.some(b => b.id === 'nb1') && s.books.find(b => b.id === 'b1').qty === 19, 10000);
    ok(tA >= 0 && tA < 4500, 'وصل الجهاز الثاني خلال ' + (tA / 1000).toFixed(1) + ' ثانية (كان حتى دقيقة)', tA);

    console.log('\n== تعديل على الجهاز الثاني يصل جهاز المحل ==');
    r = await save(U, owU, n => { n.books.find(b => b.id === 'b2').price = 33; });
    ok(r.body && r.body.ok, 'الحفظ على الجهاز الثاني', r.body);
    const tB = await within(T, s => s.books.find(b => b.id === 'b2').price === 33, 10000);
    ok(tB >= 0 && tB < 4500, 'وصل جهاز المحل خلال ' + (tB / 1000).toFixed(1) + ' ثانية', tB);
    const tB2 = await within(U, s => s.books.find(b => b.id === 'b2').price === 33 && !s.__pending, 10000);
    ok(tB2 >= 0, 'ورجع للجهاز الثاني من جهاز المحل (القاعدة واحدة)', tB2);

    console.log('\n== «الأجهزة المربوطة» ==');
    r = await T.raw('/api/link/devices');
    const dv = r.body && r.body.data;
    const names = dv ? dv.devices.map(x => x.name).sort() : [];
    ok(r.body && r.body.ok && names.join('|') === 'جهاز الدور الأول|كاشير الأرضي' && dv.devices.every(x => dv.now - x.seen < 120000) &&
      dv.devices.some(x => x.device === dv.main && x.name === 'كاشير الأرضي') && dv.devices.some(x => x.device === dv.me),
      'جهازان باسميهما وآخر تسليم، وجهاز المحل معلَّم، و«هذا الجهاز»', r.body);

    console.log('\n== جهاز ثانٍ كان مغلقاً يلحق ما فاته ==');
    U.stop();
    for (let i = 0; i < 6; i++) {
      r = await save(T, owT, n => { n.books.push({ id: 'off' + i, code: 'K1' + i, title: 'كتاب وهو مغلق ' + i, price: 5 + i, qty: 1 }); });
      await sleep(1300);
    }
    await U.start();
    owU = await claim(U);
    const hb = (await U.raw('/api/heartbeat', {}, { 'X-Owner': owU })).body;
    ok(hb && typeof hb.behind === 'number', 'النبض يقول للشاشة ما بقي (behind)', hb);
    const tC = await within(U, s => [0, 1, 2, 3, 4, 5].every(i => s.books.some(b => b.id === 'off' + i)), 20000);
    ok(tC >= 0, 'لحق الكتب الستة كلها بعد الفتح', tC);
    const hb2 = (await U.raw('/api/heartbeat', {}, { 'X-Owner': owU })).body;
    ok(hb2 && hb2.behind === 0, 'وبعدها لا شيء باقٍ', hb2);

    console.log('\n== الشاشة: الإعدادات ← الأجهزة والفروع ==');
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(T.url(), { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S && App.S.books && window.Rep, null, { timeout: 30000 });
    await sleep(800);
    await pg.evaluate(() => { location.hash = '#/settings?tab=devices'; App.route(); });
    await pg.waitForFunction(() => document.querySelectorAll('#devList tbody tr').length >= 2, null, { timeout: 15000 }).catch(() => { });
    const rows = await pg.evaluate(() => [...document.querySelectorAll('#devList tbody tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim()));
    ok(rows.length === 2 && rows.some(t => /كاشير الأرضي/.test(t) && /جهاز المحل/.test(t) && /هذا الجهاز/.test(t)) &&
      rows.some(t => /جهاز الدور الأول/.test(t) && /جهاز ثانٍ/.test(t)), 'جدول «الأجهزة المربوطة»: الجهازان ونوعهما وآخر تحديث', rows);
    if (process.env.SHOT_DIR) {
      const el = await pg.$('#devList');
      const card = el ? await el.evaluateHandle(e => e.closest('.card')) : null;
      if (card) await card.asElement().screenshot({ path: path.join(process.env.SHOT_DIR, 'x4-devices.png') });
    }
    ok(errs.length === 0, 'بلا أخطاء في الصفحة', errs);
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    T.stop(); U.stop();
    await cloud.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n' + '='.repeat(50) + '\n  نجح: ' + pass + '    فشل: ' + fail + '\n' + '='.repeat(50));
  process.exit(fail ? 1 : 0);
})();
