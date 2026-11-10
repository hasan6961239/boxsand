/* ============================================================
   test-race.js — تعديل أثناء حفظ جارٍ لا يضيع
   ------------------------------------------------------------
   ما كشفته المحاكاة الكاملة (tools/simulate.js بـ61 ألف كتاب): «تأكيد استلام»
   تحويل في مصراتة أضاف الكمية في الشاشة، ثم اختفت: الفرع الآخر رأى «استُلم»
   والكمية لم تزد. السبب في الشاشة: حفظ في الطريق، والمستخدم غيّر شيئاً آخر
   (فتأجّل حفظه 300 م.ث)، ثم رجع ردّ الحفظ الأول «جهاز آخر غيّر شيئاً: حدّث»
   فأُعيد تحميل ما في القاعدة فوق التعديل الذي لم يُحفظ بعد.
   المحرك الحقيقي لجهاز محل وجهاز ثانٍ وخادم الربط، وشاشة جهاز المحل:
   - جهاز ثانٍ يغيّر شيئاً (فيصير ردّ أي حفظ من الشاشة «حدّث»).
   - الشاشة تحفظ تعديلاً، وقبل أن يرجع ردّه تسجّل تعديلاً ثانياً (كمية + رسالة).
   - يرجع الردّ: التعديل الثاني يجب أن يبقى في الشاشة ويصل القاعدة والجهاز الثاني.
   - والشيء نفسه مع «حفظ مؤكَّد» (flushSave)، ومع بيعة تُسجَّل والحفظ في الطريق.
     node tools/test-race.js
   ============================================================ */
'use strict';
process.env.QIRTASIYA_SYNC_MS = '1500';
process.env.QIRTASIYA_SYNC_FAST_MS = '700';
const fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright-core');
const E = require('./engine');
const C = require('./fake-cloud');
const { generate } = require('./gen/generate');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const KEY = 'race-key';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(c, name, d) {
  if (c) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (d === undefined ? '' : ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(process.env.SIM_TMP || os.tmpdir(), 'qrc-'));
  const cloud = await C.start({ secret: KEY });
  const devs = [];
  let browser = null;
  const device = name => {
    const d = { name, dir: path.join(tmp, name), home: path.join(tmp, name + '-h'), proc: null, port: 0 };
    fs.mkdirSync(path.join(d.dir, 'data'), { recursive: true }); fs.mkdirSync(d.home, { recursive: true });
    d.start = async () => { d.proc = E.startEngine(d.dir, d.home); d.port = await E.waitPort(d.dir); };
    d.raw = (p, body, h) => E.call(d.port, p, body, h);
    d.link = async body => { const ow = (await d.raw('/api/claim', { force: true })).body.token; const r = await d.raw('/api/link', body, { 'X-Owner': ow }); await d.raw('/api/release?t=' + ow, {}); return r.body; };
    d.load = async () => {
      const r = await fetch('http://127.0.0.1:' + d.port + '/api/load', { headers: { 'X-Qirtasiya': '1', Origin: 'http://127.0.0.1:' + d.port } });
      return { s: JSON.parse(await r.text()), rev: r.headers.get('X-X3-Rev') || '' };
    };
    /* حفظ كما تحفظ شاشة (للجهاز الثاني: بلا شاشة مفتوحة) */
    d.save = async mut => { const a = await d.load(); mut(a.s); const ow = (await d.raw('/api/claim', { force: true })).body.token; const r = await d.raw('/api/save', a.s, { 'X-Owner': ow, 'X-X3-Rev': a.rev }); await d.raw('/api/release?t=' + ow, {}); return r.body; };
    devs.push(d);
    return d;
  };
  /* البرنامج يتذكّر آخر 5 نسخ رأتها النوافذ، وتحميل الاختبار نسخة منها: لا يُكثر منه (كل ثانية ونصف) */
  const until = async (fn, ms, step) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Date.now() - t0; } catch (e) { } await sleep(step || 1500); } return -1; };
  try {
    generate({ profile: 'misrata', store3: 1, out: path.join(tmp, 'g') });
    const s = JSON.parse(fs.readFileSync(path.join(tmp, 'g', 'store3.json'), 'utf8'));
    s.branch = { id: 'misrata', name: 'دار الحكمة', city: 'مصراتة', no: 1 };
    s.invoices = s.invoices.slice(0, 1500); s.counters.invoice = Math.max.apply(null, s.invoices.map(v => v.no));
    const A = device('A'), B = device('B');
    fs.writeFileSync(path.join(A.dir, 'data', 'store.json'), JSON.stringify(s));
    fs.writeFileSync(path.join(B.dir, 'data', 'store.json'), JSON.stringify({ meta: { setupDone: true, shopName: 'م', currency: 'د.ل', libraries: ['A'], shelves: 6 }, branch: s.branch, books: [], stationery: [], customers: [], invoices: [], payments: [], counters: { invoice: 0, book: 0, stat: 0 } }));
    E.buildEngine(A.dir, 'misrata'); E.copyEngine(A.dir, B.dir);
    await A.start();
    let r = await A.link({ action: 'main', url: cloud.url, key: KEY, name: 'المحل' });
    ok(r && r.ok, 'جهاز المحل رُبط', r);
    await B.start();
    r = await B.link({ action: 'second', url: cloud.url, key: KEY, branch: 'misrata', name: 'اللابتوب', replace: true });
    ok(r && r.ok && r.data.role === 'second', 'الجهاز الثاني أخذ نسخته', r);

    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    const errs = [];
    const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pg.addInitScript(() => { window.print = () => { }; });
    pg.on('pageerror', e => errs.push(e.message));
    if (process.env.QI_TRACE) pg.on('response', async rs => { const u = rs.url(); if (!/\/api\/(x3|save|load|heartbeat)/.test(u)) return; let t = ''; try { t = /load/.test(u) ? '(load)' : (await rs.text()).slice(0, 160); } catch (e) { t = '(aborted)'; } console.log('    [' + (Date.now() % 100000) + '] ' + u.replace(/^.*\/api/, '/api') + ' rev=' + (rs.request().headers()['x-x3-rev'] || '').slice(0, 8) + ' → ' + (rs.headers()['x-x3-rev'] || '').slice(0, 8) + ' ' + t); });
    pg.on('dialog', x => x.accept().catch(() => { }));
    await pg.goto('http://127.0.0.1:' + A.port + '/', { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S && App.S.books && App.S.books.length > 100 && window.Sales && App.isX3 && App.isX3(), null, { timeout: 120000 });
    await sleep(1500);
    const ev = (f, a) => pg.evaluate(f, a);

    /* حالة السباق: الشاشة لا تعرف بعد أن جهازاً آخر غيّر (نبضها موقوف)، وردّ حفظها محجوز حتى نطلقه */
    let hold = null, held = 0;
    const gate = () => { let go; const p = new Promise(r => { go = r; }); p.go = go; return p; };
    /* النبض يصل البرنامج (فلا ينسى نسخة هذه النافذة)، وردّه بلا رقم التغيير: الشاشة لا تدري أن شيئاً تغيّر */
    await pg.route('**/api/heartbeat', async route => {
      if (!hold) return route.continue();
      await route.fetch().catch(() => null);
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    /* QI_LEGACY=1: كما كانت الشاشة قبل الإصلاح (بلا X-X3-Base) — للتأكد أن الاختبار يكشف المسح فعلاً */
    const legacy = h => { if (!process.env.QI_LEGACY) return h; const o = Object.assign({}, h); delete o['x-x3-base']; return o; };
    const holdSaves = async route => {
      const g = hold;
      if (!g) return route.continue({ headers: legacy(route.request().headers()) });
      const resp = await route.fetch();          // البرنامج حفظ وردّ؛ الردّ لا يصل الشاشة بعد
      held++;
      await g;
      await route.fulfill({ response: resp });
    };
    await pg.route('**/api/x3/patch', holdSaves);
    await pg.route('**/api/save', holdSaves);

    /* first: تعديل وحفظه. second: تعديل ثانٍ والأول في الطريق. seen: ما في الشاشة (قيم صغيرة). want: الحالة المطلوبة */
    async function race(title, first, second, seen, wantSeen, wantState) {
      console.log('\n== ' + title + ' ==');
      hold = gate(); held = 0;
      /* جهاز ثانٍ يغيّر شيئاً: يصل قاعدة جهاز المحل، والشاشة لا تدري */
      const tag = 'من الجهاز الثاني ' + Date.now();
      r = await B.save(x => { x.books[40].note = tag; });
      let ms = await until(async () => (await A.load()).s.books[40].note === tag, 20000);
      ok(r && r.ok && ms >= 0, 'تغيير الجهاز الثاني وصل قاعدة جهاز المحل', { r, ms });
      await ev(first);
      ms = await until(async () => held > 0, 10000, 100);
      ok(ms >= 0, 'الحفظ الأول خرج من الشاشة وردّه في الطريق');
      await ev(second);
      const before = await ev(seen);
      hold.go(); hold = null;                     // يرجع الردّ: «جهاز آخر غيّر شيئاً: حدّث»
      await sleep(3000);
      const after = await ev(seen);
      ok(wantSeen(before) && wantSeen(after), 'التعديل الثاني باقٍ في الشاشة بعد أن رجع ردّ الحفظ الأول وتحدّثت', { before, after });
      ms = await until(async () => wantState((await A.load()).s), 15000);
      ok(ms >= 0, 'ووصل قاعدة جهاز المحل');
      ms = await until(async () => wantState((await B.load()).s), 20000);
      ok(ms >= 0, 'ووصل الجهاز الثاني');
      ms = await until(async () => ev(t => App.S.books[40].note === t, tag), 15000, 300);
      ok(ms >= 0, 'والشاشة أخذت تغيير الجهاز الثاني أيضاً');
    }

    const q0 = s.books[7].qty;
    await race('استلام تحويل والحفظ في الطريق (كمية + رسالة للفرع الآخر)',
      () => { App.S.books[5].note = 'تعديل أول'; App.saveNow(); },
      () => { App.S.books[7].qty += 5; App.S.outbox.unshift({ id: 'race-msg-1', kind: 'rcv', ref: 'x', to: 'tripoli', at: App.nowStamp(), from: App.S.branch.id }); App.saveNow(); },
      () => ({ q: App.S.books[7].qty, m: (App.S.outbox || []).some(m => m.id === 'race-msg-1') }),
      v => v.q === q0 + 5 && v.m,
      x => x.books[7].qty === q0 + 5 && (x.outbox || []).some(m => m.id === 'race-msg-1'));

    const p0 = s.books[9].price;
    await race('تعديل سعر وزبون جديد بـsave() العادي والحفظ في الطريق',
      () => { App.S.books[6].note = 'تعديل أول ٢'; App.saveNow(); },
      () => { App.S.books[9].price += 3; App.S.customers.unshift({ id: 'race-cust-1', name: 'زبون السباق', phone: '', balance: 0 }); App.save(); },
      () => ({ p: App.S.books[9].price, c: App.S.customers.some(c => c.id === 'race-cust-1') }),
      v => v.p === p0 + 3 && v.c,
      x => x.books[9].price === p0 + 3 && x.customers.some(c => c.id === 'race-cust-1'));

    const n0 = s.books[11].qty;
    await race('حفظ مؤكَّد (flushSave) في الطريق وبيعة تُسجَّل',
      () => { App.S.books[8].note = 'تعديل أول ٣'; App.flushSave(); },
      () => { const b = App.S.books[11]; b.qty -= 1; App.S.counters.invoice++; App.S.invoices.unshift({ id: 'race-inv-1', no: App.S.counters.invoice, kind: 'sale', date: App.today(), at: App.nowStamp(), items: [{ type: 'book', id: b.id, name: b.title, qty: 1, price: 5, cost: 3 }], subtotal: 5, discount: 0, total: 5, profit: 2, method: 'cash', mode: 'retail', customerId: '', paid: 5, due: 0 }); App.saveNow(); },
      () => ({ q: App.S.books[11].qty, i: App.S.invoices.some(v => v.id === 'race-inv-1') }),
      v => v.q === n0 - 1 && v.i,
      x => x.books[11].qty === n0 - 1 && x.invoices.some(v => v.id === 'race-inv-1'));

    console.log('\n== البرنامج نسي ما رأته الشاشة، وجهاز ثانٍ غيّر في الأثناء ==');
    /* البرنامج يتذكّر آخر 5 نسخ رأتها النوافذ (أو لا شيء بعد إعادة تشغيله والنافذة مفتوحة). كان حفظ
       الشاشة بعدها يُقارن بالقاعدة كلها: تغيير الجهاز الثاني يُحسب «تراجعاً» منها فيُمسح */
    hold = gate(); held = 0;
    const tag2 = 'تغيير لا يُمسح ' + Date.now();
    r = await B.save(x => { x.books[41].note = tag2; x.customers.unshift({ id: 'race-cust-b', name: 'زبون من الجهاز الثاني', phone: '', balance: 0 }); });
    let ms2 = await until(async () => { const a = (await A.load()).s; return a.books[41].note === tag2 && a.customers.some(c => c.id === 'race-cust-b'); }, 20000);
    ok(r && r.ok && ms2 >= 0, 'تغيير الجهاز الثاني (ملاحظة وزبون جديد) وصل قاعدة جهاز المحل');
    for (let i = 0; i < 12; i++) await A.load();          // نسخ كثيرة من غير هذه النافذة: نسختها تُنسى
    const seenForgot = [];
    pg.on('response', async rs => { if (/\/api\/(x3\/patch|x3\/base|save)/.test(rs.url())) { try { seenForgot.push(rs.url().replace(/^.*\/api/, '') + ' ' + (await rs.text()).slice(0, 60)); } catch (e) { } } });
    hold.go(); hold = null;
    await ev(() => { App.S.books[12].note = 'بعد النسيان'; App.saveNow(); });
    ms2 = await until(async () => (await A.load()).s.books[12].note === 'بعد النسيان', 15000);
    ok(ms2 >= 0, 'تعديل الشاشة حُفظ', seenForgot);
    ok(seenForgot.some(x => /forgot/.test(x)) && seenForgot.some(x => /^\/x3\/base .*"ok":true/.test(x)), 'البرنامج طلب من الشاشة أن تذكّره بما رأته، ففعلت', seenForgot);
    const a4 = (await A.load()).s;
    ok(a4.books[41].note === tag2 && a4.customers.some(c => c.id === 'race-cust-b'), 'وتغيير الجهاز الثاني باقٍ في القاعدة (كان يُمسح وزبونه يُحذف)', { note: a4.books[41].note, cust: a4.customers.some(c => c.id === 'race-cust-b') });
    ms2 = await until(async () => { const b = (await B.load()).s; return b.books[12].note === 'بعد النسيان' && b.books[41].note === tag2 && b.customers.some(c => c.id === 'race-cust-b'); }, 20000);
    ok(ms2 >= 0, 'والجهاز الثاني عنده الاثنان');
    ms2 = await until(async () => ev(t => App.S.books[41].note === t && App.S.customers.some(c => c.id === 'race-cust-b'), tag2), 15000, 300);
    ok(ms2 >= 0, 'والشاشة أخذت تغيير الجهاز الثاني');

    ok(errs.length === 0, 'بلا أخطاء في الشاشة', errs.slice(0, 3));
    for (const d of devs) {
      const lg = fs.readFileSync(path.join(d.dir, 'data', 'log.txt'), 'utf8').split('\n').filter(l => /Exception|   at /.test(l));
      ok(lg.length === 0, d.name + ': سجل البرنامج بلا أخطاء داخلية', lg.slice(0, 3));
    }
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close().catch(() => { });
    devs.forEach(d => E.stopEngine(d.proc));
    await cloud.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n==================================================');
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})();
