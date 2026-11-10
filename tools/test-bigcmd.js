/* ============================================================
   test-bigcmd.js — حفظ كبير من الجهاز الثاني لا يوقف المزامنة
   ------------------------------------------------------------
   ما كشفته المحاكاة الكاملة (tools/simulate.js): خادم الربط يرفض أمر الجهاز
   الثاني الأكبر من حدّه (كان 200 ألف حرف)، والجهاز كان يعيد إرساله إلى
   الأبد فيتوقف كل ما بعده — بيع اللابتوب لا يصل المحل. وكان يكفي لذلك أول
   فتح «البضاعة الراكدة» (تثبيت «آخر بيع» على كل الأصناف دفعة واحدة).
   المحرك الحقيقي لجهاز محل وجهاز ثانٍ (مصراتة ببيانات سنة) وخادم الربط:
   - أول بيعة على الجهاز الثاني أمر صغير (لا يحمل كل الأصناف).
   - تعديل كل الكتب دفعة من الجهاز الثاني يُقسم أوامر صغيرة ويُطبَّق كله.
   - أمر ضخم بقي من نسخة قديمة يُقسم عند رفضه، وما بعده يصل بترتيبه.
   - سجل واحد أكبر مما يقبله الخادم يُرفض عند الحفظ برسالة واضحة.
   - خادم قديم (حدّه 200 ألف) يقبل كل ما يُرسل.
     node tools/test-bigcmd.js
   ============================================================ */
'use strict';

/* جهاز ثانٍ يُربط بعد أن يرفع جهاز المحل نسخته الأولى (ثوانٍ بعد ربطه): قبلها يقول البرنامج «انتظر
   دقيقة» (no-snap) كما يقوله للمستخدم. على جهاز سريع (CI) كان الربط يسبقها */
async function linkSecond(d, body) {
  let r = null;
  for (let i = 0; i < 60; i++) {
    r = await d.link(body);
    if (!(r && r.code === 'no-snap')) return r;
    await new Promise(z => setTimeout(z, 500));
  }
  return r;
}
process.env.QIRTASIYA_SYNC_MS = '1500';
const fs = require('fs'), path = require('path'), os = require('os');
const E = require('./engine');
const C = require('./fake-cloud');
const { generate } = require('./gen/generate');
const KEY = 'bigcmd-key';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(c, name, d) {
  if (c) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (d === undefined ? '' : ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(process.env.SIM_TMP || os.tmpdir(), 'qbc-'));
  let oldLimit = false, down = false;
  const cmds = [];
  const net_down = v => { down = !!v; };
  /* خادم قديم: حدّه 200 ألف حرف (الجديد 900 ألف)؛ و«down» = الإنترنت مقطوع */
  const cloud = await C.start({ secret: KEY, fail: (req, body) => {
    if (down) return -1;
    if (!/\/v2\/cmd\?/.test(req.url) || req.method !== 'POST') return 0;
    const chars = body.toString('utf8').length;                  // الخادم يقيس بالحروف لا بالبايتات
    cmds.push(chars);
    return oldLimit && chars > 200000 ? 413 : 0;
  } });
  const devs = [];
  const device = name => {
    const d = { name, dir: path.join(tmp, name), home: path.join(tmp, name + '-h'), proc: null, port: 0 };
    fs.mkdirSync(path.join(d.dir, 'data'), { recursive: true }); fs.mkdirSync(d.home, { recursive: true });
    d.start = async env => {
      Object.assign(process.env, env || {});
      d.proc = E.startEngine(d.dir, d.home); d.port = await E.waitPort(d.dir);
      for (const k of Object.keys(env || {})) delete process.env[k];
    };
    d.stop = async () => { E.stopEngine(d.proc); d.proc = null; await sleep(600); };
    d.raw = (p, body, h) => E.call(d.port, p, body, h);
    d.owner = async () => (await d.raw('/api/claim', { force: true })).body.token;
    d.link = async body => (await d.raw('/api/link', body, { 'X-Owner': await d.owner() })).body;
    d.load = async () => {
      const r = await fetch('http://127.0.0.1:' + d.port + '/api/load', { headers: { 'X-Qirtasiya': '1', Origin: 'http://127.0.0.1:' + d.port } });
      return { s: JSON.parse(await r.text()), rev: r.headers.get('X-X3-Rev') || '' };
    };
    /* حفظ كما تحفظ الشاشة: الملف كله بعد تعديله (والمحرك يحسب الفرق) */
    d.save = async mut => { const a = await d.load(); mut(a.s); return (await d.raw('/api/save', a.s, { 'X-Owner': await d.owner(), 'X-X3-Rev': a.rev })).body; };
    d.status = async () => (await d.raw('/api/link')).body.data;
    devs.push(d);
    return d;
  };
  const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Date.now() - t0; } catch (e) { } await sleep(400); } return -1; };
  try {
    generate({ profile: 'misrata', store3: 1, out: path.join(tmp, 'g') });
    const s = JSON.parse(fs.readFileSync(path.join(tmp, 'g', 'store3.json'), 'utf8'));
    s.branch = { id: 'misrata', name: 'دار الحكمة', city: 'مصراتة', no: 1 };
    const A = device('A'), B = device('B');
    fs.writeFileSync(path.join(A.dir, 'data', 'store.json'), JSON.stringify(s));
    fs.writeFileSync(path.join(B.dir, 'data', 'store.json'), JSON.stringify({ meta: { setupDone: true, shopName: 'م', currency: 'د.ل', libraries: ['A'], shelves: 6 }, branch: s.branch, books: [], stationery: [], customers: [], invoices: [], payments: [], counters: { invoice: 0, book: 0, stat: 0 } }));
    E.buildEngine(A.dir, 'misrata'); E.copyEngine(A.dir, B.dir);
    await A.start();
    let r = await A.link({ action: 'main', url: cloud.url, key: KEY, name: 'المحل' });
    ok(r && r.ok, 'جهاز المحل رُبط (' + s.books.length + ' كتاباً و' + s.invoices.length + ' فاتورة)', r);
    await B.start();
    r = await linkSecond(B, { action: 'second', url: cloud.url, key: KEY, branch: 'misrata', name: 'اللابتوب', replace: true });
    ok(r && r.ok && r.data.role === 'second', 'الجهاز الثاني أخذ نسخته', r);
    const same = async f => { const a = (await A.load()).s, b = (await B.load()).s; return f(a) && f(b); };

    console.log('\n== بيعة عادية من الجهاز الثاني: أمر صغير ==');
    cmds.length = 0;
    r = await B.save(x => { x.books[3].qty -= 1; x.counters.invoice++; x.invoices.unshift({ id: 'inv-b1', no: x.counters.invoice, kind: 'sale', date: '2026-11-09', at: '2026-11-09 10:00:00', items: [{ type: 'book', id: x.books[3].id, name: x.books[3].title, qty: 1, price: 5, cost: 3 }], subtotal: 5, discount: 0, total: 5, profit: 2, method: 'cash', mode: 'retail', customerId: '', paid: 5, due: 0 }); });
    ok(r && r.ok, 'الحفظ على الجهاز الثاني', r);
    let ms = await until(async () => (await A.load()).s.invoices.some(v => v.id === 'inv-b1'), 20000);
    ok(ms >= 0 && cmds.length === 1 && cmds[0] < 5000, 'وصلت جهاز المحل في أمر واحد صغير (' + cmds[0] + ' حرف)', { ms, cmds });

    console.log('\n== تعديل كل الكتب دفعة من الجهاز الثاني ==');
    cmds.length = 0;
    r = await B.save(x => { x.books.forEach(b => { b.note = 'جرد نوفمبر 2026 — رُوجع على الرف'; }); });
    ok(r && r.ok, 'حفظ تعديل ' + s.books.length + ' كتاباً من الجهاز الثاني', r);
    ms = await until(async () => (await A.load()).s.books.every(b => /جرد نوفمبر/.test(b.note || '')), 60000);
    ok(ms >= 0, 'وصل جهاز المحل كله خلال ' + (ms / 1000).toFixed(1) + ' ث', ms);
    ok(cmds.length > 1 && Math.max.apply(null, cmds) <= 160000, 'مقسوماً ' + cmds.length + ' أوامر، أكبرها ' + Math.max.apply(null, cmds) + ' حرفاً (كان أمراً واحداً يُرفض)', cmds);
    /* «ينتظر» يشمل ما أُرسل ولم يرجع تأكيد تطبيقه بعد: ننتظر دورة المزامنة */
    const settled = async () => { await until(async () => { const x = await B.status(); return x && !x.error && !(x.waiting > 0); }, 20000); return B.status(); };
    let st = await settled();
    ok(st && !st.error && !(st.waiting > 0) && !(st.failed > 0), 'ولا شيء ينتظر ولا مرفوض على الجهاز الثاني', st && { e: st.error, w: st.waiting, f: st.failed });

    console.log('\n== خادم قديم (حدّه 200 ألف): يقبل كل ما يُرسل ==');
    oldLimit = true; cmds.length = 0;
    r = await B.save(x => { x.books.forEach(b => { b.note = 'مراجعة ثانية للرفوف كلها'; }); });
    ms = await until(async () => (await A.load()).s.books.every(b => /مراجعة ثانية/.test(b.note || '')), 60000);
    st = await settled();
    ok(r && r.ok && ms >= 0 && !st.error && !(st.waiting > 0), 'تعديل كل الكتب وصل عبر الخادم القديم (' + cmds.length + ' أوامر)', { ms, e: st.error, w: st.waiting });
    oldLimit = false;

    console.log('\n== أمر ضخم بقي من نسخة قديمة: يُقسم عند رفضه، وما بعده يصل بترتيبه ==');
    await B.stop();
    await B.start({ QIRTASIYA_CMD_CHUNK: '50000000' });          // كما كانت النسخة القديمة: بلا تقسيم
    net_down(true);
    r = await B.save(x => { x.books.forEach(b => { b.note = 'أمر ضخم قديم'; }); });
    const r2 = await B.save(x => { x.books[5].note = 'تعديل بعد الأمر الضخم'; });
    ok(r && r.ok && r2 && r2.ok, 'حُفظ أمران على الجهاز الثاني والإنترنت مقطوع (الأول ضخم بلا تقسيم)');
    await B.stop();
    await B.start();                                             // النسخة الجديدة
    cmds.length = 0; net_down(false);
    ms = await until(async () => { const a = (await A.load()).s; return a.books[5].note === 'تعديل بعد الأمر الضخم' && a.books.filter(b => b.note === 'أمر ضخم قديم').length === a.books.length - 1; }, 90000);
    st = await settled();
    ok(ms >= 0, 'وصل جهاز المحل: الأمر الضخم مقسوماً ثم التعديل الذي بعده، بالترتيب', { ms, e: st && st.error, w: st && st.waiting });
    ok(cmds.some(n => n > 900000) && cmds.filter(n => n <= 160000).length > 3 && st && !st.error && !(st.waiting > 0), 'رُفض مرة لحجمه (' + Math.max.apply(null, cmds) + ' حرفاً) ثم أُرسل قطعاً، ولا شيء ينتظر', { n: cmds.length, w: st && st.waiting });

    console.log('\n== سجل واحد أكبر مما يقبله الخادم: يُرفض عند الحفظ برسالة ==');
    r = await B.save(x => { x.countSession = { id: 'cs1', at: '2026-11-09 11:00:00', scope: 'all', counted: {}, n: 70000 }; for (let i = 0; i < 70000; i++) x.countSession.counted['item-' + i] = i % 7; });
    ok(r && !r.ok && r.reload && /جهاز ثانٍ/.test(r.error || '') && /الجرد/.test(r.error || ''), 'جلسة جرد من 70 ألف صنف على الجهاز الثاني: رسالة واضحة، ولا تدخل الطابور', r);
    r = await B.save(x => { x.books[7].note = 'بعد الرفض يعمل كل شيء'; });
    ms = await until(async () => (await A.load()).s.books[7].note === 'بعد الرفض يعمل كل شيء', 20000);
    ok(r && r.ok && ms >= 0, 'والحفظ بعدها يصل جهاز المحل كالعادة', { r, ms });
    ok(await same(x => x.books.length === s.books.length && x.invoices.length === s.invoices.length + 1), 'والجهازان متطابقان في العدد');
    for (const d of devs) {
      const lg = fs.readFileSync(path.join(d.dir, 'data', 'log.txt'), 'utf8').split('\n').filter(l => /Exception|   at /.test(l));
      ok(lg.length === 0, d.name + ': سجل البرنامج بلا أخطاء داخلية', lg.slice(0, 3));
    }
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
  } finally {
    devs.forEach(d => E.stopEngine(d.proc));
    await cloud.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n==================================================');
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})();
