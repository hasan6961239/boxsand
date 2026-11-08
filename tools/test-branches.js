/* ============================================================
   test-branches.js — مصراتة ترى فرع طرابلس (61 ألف كتاب)، وطرابلس ترى مصراتة
   ------------------------------------------------------------
   شكوى المستخدم: «في منظومة مصراتة ما ظهرش عندي فرع طرابلس». تطبيقان حقيقيان
   (المحرك تحت mono): طرابلس بكتب المولّد (61 ألفاً) ومصراتة، كلٌّ جهاز محل لفرعه،
   على خادم ربط واحد (fake-cloud: cloud/worker.js نفسه):
   - كل فرع يرى الآخر بكتبه، و«قوائم الفروع» في بطاقة الربط تقول ما وصل ومتى.
   - كتاب جديد في طرابلس يصل مصراتة مع التسليم القادم، لا بعد نصف ساعة.
   - جهاز آخر أخذ مكان جهاز محل مصراتة: النشر يُرفض، لكن قوائم الفروع تبقى تصل،
     والخطأ مكتوب في البطاقة (كان فشل النشر يمنع الجلب، فلا يظهر الفرع ولا يُعرف لماذا).
   - الخادم فقد قائمة طرابلس (قاعدة D1 جديدة): تُنشر من جديد ولو لم تتغيّر.
     node tools/test-branches.js            (BOOKS=20000 لعدد آخر)
   ============================================================ */
'use strict';
process.env.QIRTASIYA_SYNC_MS = '3000';
process.env.QIRTASIYA_SYNC_FAST_MS = '1000';
const fs = require('fs'), path = require('path'), os = require('os');
const E = require('./engine');
const C = require('./fake-cloud');
const { generate } = require('./gen/generate');

const KEY = 'test-branches-key';
/* QI_SHOTS=مجلد: لقطات من شاشة مصراتة الحقيقية («قوائم الفروع» في الإعدادات، وطرابلس في «المخزون والفروع») */
const SHOTS = process.env.QI_SHOTS || '';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BOOKS = parseInt(process.env.BOOKS || '61000', 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)))); }
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
  d.owner = async () => (await d.raw('/api/claim', { force: true })).body.token;
  d.link = async body => (await d.raw('/api/link', body, { 'X-Owner': await d.owner() })).body;
  d.status = async () => { const r = await d.raw('/api/link'); return r.body && r.body.data; };
  d.remotes = async () => (await d.raw('/api/x3/remotes')).body;
  d.load = async () => {
    const r = await fetch(d.url() + 'api/load', { headers: { 'X-Qirtasiya': '1', Origin: 'http://127.0.0.1:' + d.port } });
    return { s: JSON.parse(await r.text()), rev: r.headers.get('X-X3-Rev') || '' };
  };
  d.save = async mut => {
    const a = await d.load();
    mut(a.s);
    return d.raw('/api/save', a.s, { 'X-Owner': await d.owner(), 'X-X3-Rev': a.rev });
  };
  return d;
}

/* حتى يتحقق الشرط على حالة الربط؛ الزمن بالملّي ثانية أو -1 */
async function until(d, fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (fn(await d.status())) return Date.now() - t0; } catch (e) { }
    await sleep(500);
  }
  return -1;
}
const remote = (st, id) => ((st && st.remotes) || []).find(r => r.id === id);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qbr-'));
  const cloud = await C.start({ secret: KEY });
  const T = device(tmp, 'tripoli'), M = device(tmp, 'misrata');
  try {
    console.log('يولّد ' + BOOKS + ' كتاباً لطرابلس ويبني التطبيقين...');
    const gt = path.join(tmp, 'gen-t'), gm = path.join(tmp, 'gen-m');
    generate({ profile: 'tripoli', books: BOOKS, stationery: 2000, years: 1, store3: 1, out: gt });
    generate({ profile: 'misrata', store3: 1, out: gm });
    const tri = JSON.parse(fs.readFileSync(path.join(gt, 'store3.json'), 'utf8'));
    tri.invoices = []; tri.payments = []; tri.counters.invoice = 0;
    tri.branch = { id: 'tripoli', name: 'دار الحكمة — طرابلس', city: 'طرابلس', phone: '', label: '', no: 2 };
    tri.sync = { url: cloud.url, key: KEY, auto: false, everyMin: 10 };
    const mis = JSON.parse(fs.readFileSync(path.join(gm, 'store3.json'), 'utf8'));
    mis.branch = { id: 'misrata', name: 'دار الحكمة', city: 'مصراتة', phone: '', label: '', no: 1 };
    mis.sync = { url: cloud.url, key: KEY, auto: true, everyMin: 10 };
    const nT = tri.books.length + tri.stationery.length, nM = mis.books.length + mis.stationery.length;
    E.buildEngine(T.dir, 'tripoli');
    E.buildEngine(M.dir, 'misrata');

    console.log('\n== كل فرع جهاز محل على خادم واحد ==');
    T.write(tri); await T.start();
    let t0 = Date.now();
    let r = await T.link({ action: 'main', url: cloud.url, key: KEY, name: 'كاشير طرابلس' });
    ok(r && r.ok && r.data.role === 'main', 'طرابلس: جهاز المحل (' + ((Date.now() - t0) / 1000).toFixed(1) + ' ث)', r);
    M.write(mis); await M.start();
    r = await M.link({ action: 'main', url: cloud.url, key: KEY, name: 'لابتوب مصراتة' });
    ok(r && r.ok && r.data.role === 'main', 'مصراتة: جهاز المحل', r);

    console.log('\n== مصراتة ترى طرابلس، وطرابلس ترى مصراتة ==');
    let ms = await until(M, st => { const x = remote(st, 'tripoli'); return x && x.items >= nT - 5; }, 120000);
    let st = await M.status();
    ok(ms >= 0, 'فرع طرابلس في «قوائم الفروع» بمصراتة: ' + ((remote(st, 'tripoli') || {}).items || 0) + ' صنف بعد ' + (ms / 1000).toFixed(1) + ' ث', st && st.remotes);
    ok(st && st.catPub && st.catN === nM && !st.catPubError && !st.catError, 'مصراتة: قائمتها نُشرت (' + (st && st.catN) + ' صنف) بلا خطأ', st);
    t0 = Date.now();
    const rm = await M.remotes();
    const rmMs = Date.now() - t0;
    const tb = rm && rm.ok && rm.branches.find(b => b.branch && b.branch.id === 'tripoli');
    ok(tb && tb.items.length >= nT - 5, 'شاشة «المخزون والفروع» في مصراتة: طرابلس بكتبها (' + (tb ? tb.items.length : 0) + ') في ' + rmMs + ' ms', rm && rm.error);
    ms = await until(T, st => { const x = remote(st, 'misrata'); return x && x.items >= nM - 5; }, 60000);
    ok(ms >= 0, 'وفرع مصراتة في طرابلس', (await T.status()).remotes);

    console.log('\n== كتاب جديد في طرابلس يصل مصراتة مع التسليم ==');
    const before = (remote(await M.status(), 'tripoli') || {}).items || 0;
    r = await T.save(s => { s.books.push({ id: 'nb-a', code: 'NB-A', title: 'كتاب وصل للتو من طرابلس', price: 12, qty: 3 }); });
    ok(r.body && r.body.ok, 'الحفظ في طرابلس', r.body);
    r = await T.link({ action: 'now' });
    ok(r && r.ok && !r.data.catPubError, '«حدّث الآن» في طرابلس ينشر قائمتها', r && r.data);
    ms = await until(M, st => { const x = remote(st, 'tripoli'); return x && x.items > before; }, 30000);
    ok(ms >= 0 && ms < 15000, 'وصل مصراتة خلال ' + (ms / 1000).toFixed(1) + ' ث بلا «حدّث الآن» فيها (كان حتى نصف ساعة)', ms);

    console.log('\n== جهاز آخر أخذ مكان جهاز محل مصراتة ==');
    const h = await fetch(cloud.url + '/v2/hello?branch=misrata&device=thief0000000000000000000000&role=main&name=' + encodeURIComponent('جهاز قديم') + '&force=1',
      { headers: { 'X-Shop-Key': KEY } });
    ok(h.status === 200, 'جهاز قديم سجّل نفسه جهاز محل مصراتة', h.status);
    r = await T.save(s => { s.books.push({ id: 'nb-b', code: 'NB-B', title: 'كتاب ثانٍ من طرابلس', price: 14, qty: 2 }); });
    r = await T.link({ action: 'now' });
    r = await M.link({ action: 'now' });
    st = r && r.data;
    ok(st && /جهاز آخر|ليس جهاز المحل/.test((st.error || '') + ' ' + (st.catPubError || '')), 'مصراتة: الخطأ مكتوب في بطاقة الربط', st && { error: st.error, pub: st.catPubError });
    const x = remote(st, 'tripoli');
    ok(x && x.items > before + 1 && !st.catError, 'ومع ذلك وصلت قائمة طرابلس الجديدة (' + (x && x.items) + ' صنف) — الجلب لا يتوقف على النشر', st && { remotes: st.remotes, catError: st.catError });
    r = await M.link({ action: 'main', url: cloud.url, key: KEY, name: 'لابتوب مصراتة', force: true });
    ok(r && r.ok && r.data.role === 'main', 'مصراتة ترجع جهاز المحل («هذا جهاز المحل» ووافق)', r);

    console.log('\n== شاشة مصراتة: «قوائم الفروع» وكتب طرابلس ==');
    {
      const { chromium } = require('playwright-core');
      const br = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
      try {
        const pg = await br.newPage({ viewport: { width: 1440, height: 900 } });
        const perr = [];
        pg.on('pageerror', e => perr.push(e.message));
        await pg.goto(M.url(), { waitUntil: 'domcontentloaded' });
        await pg.waitForFunction(() => window.App && App.S && App.S.books && window.Rep, null, { timeout: 30000 });
        await sleep(900);
        await pg.evaluate(() => { location.hash = '#/settings?tab=devices'; App.route(); });
        await pg.waitForFunction(() => /قوائم الفروع/.test((document.getElementById('lnkBody') || {}).textContent || ''), null, { timeout: 15000 });
        const card = await pg.evaluate(() => document.getElementById('lnkBody').textContent);
        ok(/فرع دار الحكمة — طرابلس: [\d,]+ صنف/.test(card) && /قائمة كتبنا: نُشرت/.test(card), 'بطاقة الربط في مصراتة: «قوائم الفروع» فيها طرابلس بعدد كتبها، وقائمتنا نُشرت', card.slice(0, 300));
        if (SHOTS) {
          const el = await pg.$('#lnkBody');
          await (await el.evaluateHandle(e => e.closest('.card'))).asElement().screenshot({ path: path.join(SHOTS, 'misrata-branch-lists.png') });
        }
        await pg.evaluate(() => { location.hash = '#/stock'; App.route(); });
        await sleep(1500);
        await pg.evaluate(() => Stock.open('branch', 'tripoli'));
        await pg.waitForSelector('#rbBody tbody tr', { timeout: 20000 });
        const n = await pg.$$eval('#rbBody tbody tr:not(.lazy-row)', r => r.length);
        const vt = await pg.evaluate(() => document.getElementById('view').textContent);
        ok(n === 100 && !/قيمته بيعاً/.test(vt), 'مصراتة ← طرابلس: جدول كتب، 100 أولاً، بلا مبالغ', { n });
        if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'misrata-sees-tripoli.png') });
        ok(perr.length === 0, 'بلا أخطاء في شاشة مصراتة', perr.slice(0, 3));
      } finally { await br.close(); }
    }

    console.log('\n== الخادم فقد قائمة طرابلس ==');
    await cloud.env.DB.prepare("DELETE FROM v2_catalog WHERE branch = 'tripoli'").run();
    await cloud.env.DB.prepare("DELETE FROM v2_part WHERE branch = 'tripoli' AND kind = 'cat'").run();
    r = await T.link({ action: 'now' });
    const cats = await cloud.env.DB.prepare("SELECT branch, n FROM v2_catalog ORDER BY branch").all();
    const tc = (cats.results || []).find(c => c.branch === 'tripoli');
    ok(tc && tc.n >= nT - 5, 'طرابلس نشرت قائمتها من جديد ولو لم تتغيّر (' + (tc && tc.n) + ' صنف)', cats.results);

    console.log('\n== خادم الربط: وقت الحساب لكل طلب ==');
    const big = cloud.log.filter(l => / \/v2\/catalog /.test(l)).map(l => +l.split(' ').pop());
    ok(big.length > 0 && Math.max.apply(null, big) <= 1400000, 'قطع القائمة تحت حدّ صف D1 (أكبرها ' + Math.round(Math.max.apply(null, big) / 1024) + ' ك.ب)', big);
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
  } finally {
    T.stop(); M.stop();
    await cloud.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
