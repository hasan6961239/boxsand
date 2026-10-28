/* ============================================================
   test-sync.js — المزامنة على البرنامج الحقيقي (قرار 0023)
   ------------------------------------------------------------
   خادم الربط (fake-cloud.js يشغّل cloud/worker.js نفسه) وثلاث نسخ من
   البرنامج تحت mono:
     A: جهاز محل مصراتة (الأساسي)
     B: جهاز صاحب المحل، جهاز ثانٍ لمصراتة (انضم من جهاز بلا قاعدة)
     T: جهاز محل طرابلس (فرع آخر)
   ما يُتأكد منه: B نسخة من A صفاً صفاً، ما يضيفه B يصل A مرة واحدة ويرجع،
   المرفوض يُقال سببه، قتل A وسط الدورة لا يكرر شيئاً، الفرعان يرى كل
   منهما كتب الآخر بكمياتها وأسعارها، وسلسلة جديدة تُعيد B من نسختها.
     node tools/test-sync.js
   ============================================================ */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const E = require('./engine');
const C = require('./fake-cloud');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; const d = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)); failures.push(name + d); console.log('  FAIL  ' + name + d); }
}

const KEY = 'test-sync-key';

/* جهاز واحد: مجلده، وتشغيله، ونداء أوامره بجلسة المدير */
function device(tmp, name) {
  const d = { name, dir: path.join(tmp, name), home: path.join(tmp, name + '-home'), proc: null, port: 0, token: '' };
  fs.mkdirSync(path.join(d.dir, 'data'), { recursive: true });
  fs.mkdirSync(d.home, { recursive: true });
  d.start = async () => { d.proc = E.startEngine(d.dir, d.home); d.port = await E.waitPort(d.dir); d.token = ''; return d; };
  d.stop = () => { if (d.proc) E.stopEngine(d.proc); d.proc = null; };
  d.raw = (p, body, h) => E.call(d.port, p, body, h);
  d.owner = async () => (await d.raw('/api/claim', { force: true })).body.token;
  d.v2 = async (cmd, body) => {
    if (!d.token) {
      const r = await d.raw('/api/v2/login', { login: 'admin', password: '' });
      if (!r.body || !r.body.ok) throw new Error(name + ' login: ' + JSON.stringify(r.body));
      d.token = r.body.data.token;
    }
    let r = await d.raw('/api/v2/' + cmd, body || {}, { 'X-Session': d.token });
    if (r.status === 401) { d.token = ''; d.sessionLost = (d.sessionLost || 0) + 1; return d.v2(cmd, body); }
    return r.body;
  };
  d.data = async (cmd, body) => {
    const r = await d.v2(cmd, body);
    if (!r || !r.ok) throw new Error(name + ' ' + cmd + ': ' + JSON.stringify(r));
    return r.data;
  };
  d.sync = () => d.data('sync.now');
  d.db = () => new DatabaseSync(path.join(d.dir, 'data', 'qirtasiya.db'), { readOnly: true });
  d.q = (sql, ...a) => { const db = d.db(); try { return db.prepare(sql).all(...a); } finally { db.close(); } };
  return d;
}

/* الجداول التي تهمّ البائع، صفاً صفاً */
function dump(d) {
  const db = d.db();
  try {
    const out = [];
    for (const t of ['items', 'item_stock', 'stock_moves', 'invoices', 'invoice_lines', 'customers', 'customer_moves', 'users', 'settings', 'places', 'remote_cmds']) {
      out.push('#' + t);
      for (const r of db.prepare('SELECT * FROM "' + t + '" ORDER BY id').all()) out.push(JSON.stringify(r));
    }
    return out.join('\n');
  } finally { db.close(); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qsync-'));
  process.env.QIRTASIYA_SYNC_MS = '4000';
  const cloud = await C.start({ secret: KEY });
  const A = device(tmp, 'A'), B = device(tmp, 'B'), T = device(tmp, 'T');
  try {
    console.log('يبني تطبيقي مصراتة وطرابلس...');
    E.buildEngine(A.dir, 'misrata');
    for (const f of ['Qirtasiya.exe', 'Qirtasiya.exe.config']) fs.copyFileSync(path.join(A.dir, f), path.join(B.dir, f));
    E.buildEngine(T.dir, 'tripoli');
    await Promise.all([A.start(), B.start(), T.start()]);

    console.log('\n== جهاز محل مصراتة ==');
    let ow = await A.owner();
    let r = await A.raw('/api/v2/create', { shopName: 'دار الحكمة', city: 'مصراتة', demo: true }, { 'X-Owner': ow });
    ok(r.body && r.body.ok, 'قاعدة مصراتة ببيانات تجربة', r.body);
    let st = await A.v2('sync.setup', { role: 'main', url: cloud.url, key: 'wrong', name: 'جهاز المحل' });
    ok(st.ok === false && st.code === 'key', 'كلمة سر خاطئة تُقال قبل أي شيء', st);
    st = await A.data('sync.setup', { role: 'main', url: cloud.url, key: KEY, name: 'جهاز المحل' });
    ok(st.role === 'main' && st.branch === 'misrata', 'هذا جهاز المحل لفرع misrata', st);
    st = await A.sync();
    ok(st.lastOk && !st.error, 'الدورة الأولى: بلا خطأ', st);
    const br = cloud.env.DB.raw.prepare("SELECT * FROM v2_branch WHERE branch = 'misrata'").get();
    ok(br && br.chain && br.snap >= 0 && br.snap_parts >= 1, 'نسخته الكاملة على الخادم وسلسلتها', br && { chain: br.chain, snap: br.snap, parts: br.snap_parts });
    const old = JSON.parse(cloud.env.SHOP.map.get('branch:misrata') || 'null');
    const nItems = A.q('SELECT COUNT(*) AS n FROM items WHERE active = 1')[0].n;
    ok(old && old.v4 && old.items.length === nItems && old.branch.name === 'دار الحكمة' && old.items.every(i => typeof i.p === 'number' && i.n),
      'ولقطة 3.x للتلفون وموقع المكتبة في المخزن القديم (' + (old ? old.items.length : 0) + ' صنف)', old && old.items[0]);
    const cat = await (await fetch(cloud.url + '/catalog?branch=misrata')).json();
    ok(cat.ok && cat.books.length > 100, 'وموقع المكتبة يقرأ منها قائمة الكتب', cat.books && cat.books.length);

    console.log('\n== جهازي ينضم جهازاً ثانياً ==');
    ow = await B.owner();
    r = await B.raw('/api/v2/join', { url: cloud.url, key: KEY, branch: 'misrata', name: 'جهازي' }, { 'X-Owner': ow });
    ok(r.body && r.body.ok, 'انضم من جهاز بلا قاعدة', r.body);
    const info = (await B.raw('/api/info')).body;
    ok(info.db === true, 'وصار عنده قاعدة 4.0 (الواجهة الجديدة)', info);
    st = await B.data('sync.status');
    ok(st.role === 'second' && st.branch === 'misrata' && st.main === 'جهاز المحل', 'يعرف أنه ثانٍ ومن جهاز المحل', st);
    ok(dump(A) === dump(B), 'قاعدته نسخة من جهاز المحل صفاً صفاً');
    const s1 = await B.data('search', { q: 'الفيزياء الاساسيه', limit: 3 });
    ok(s1.items.length > 0 && s1.items[0].title === 'الفيزياء الأساسية', 'والبحث فيه يعمل', s1.items.map(i => i.title));

    console.log('\n== المحل يبيع ويضيف ← جهازي يرى ==');
    const phys = s1.items[0];
    const sale = await A.data('sale', { lines: [{ itemId: phys.id, qty: 2 }] });
    const added = await A.data('item.add', { title: 'كتاب جديد من المحل', price: 12000, qty: 4 });
    await A.sync();
    st = await B.sync();
    ok(!st.error && st.behind === 0, 'جهازي لحق المحل', st);
    ok(dump(A) === dump(B), 'البيعة والكتاب الجديد عنده كما عند المحل');
    const inv = await B.data('invoices.page', { no: sale.no });
    ok(inv.invoices.length === 1 && inv.invoices[0].total === sale.total, 'فاتورة المحل رقم ' + sale.no + ' تظهر عنده', inv);

    console.log('\n== جهازي يضيف ← المحل ينفّذ ← يرجع لي ==');
    const q1 = await B.data('item.add', { title: 'كتاب من جهازي', author: 'مؤلف', price: 15000, qty: 3, barcode: '7770001' });
    ok(q1.queued === true && q1.n >= 1, 'إضافة كتاب على جهازي: تنتظر المحل', q1);
    let ob = await B.data('outbox.list');
    ok(ob.length === 1 && (ob[0].state === 'waiting' || ob[0].state === 'sent'), 'وتظهر في «ينتظر المحل»', ob);
    await B.sync(); await A.sync(); st = await B.sync();
    ok(A.q("SELECT COUNT(*) AS n FROM items WHERE title = 'كتاب من جهازي'")[0].n === 1, 'صار عند المحل مرة واحدة');
    ok(B.q("SELECT COUNT(*) AS n FROM items WHERE title = 'كتاب من جهازي'")[0].n === 1, 'ورجع لجهازي');
    ob = await B.data('outbox.list');
    ok(ob.length === 1 && ob[0].state === 'done', 'وحالته «نُفّذ»', ob);
    const dev = A.q("SELECT device FROM ops WHERE kind = 'item-add' ORDER BY id DESC LIMIT 1")[0].device;
    ok(/جهازي/.test(dev), 'سجل العمليات عند المحل يقول إنها من جهازي', dev);

    const q2 = await B.data('sale', { lines: [{ itemId: phys.id, qty: 1 }] });
    const q3 = await B.data('item.add', { title: 'مكرر', price: 1000, barcode: '7770001' });
    ok(q2.queued && q3.queued, 'بيعة وكتاب بباركود مكرر من جهازي: ينتظران');
    await B.sync(); await A.sync(); await B.sync();
    ob = await B.data('outbox.list');
    const failed = ob.find(o => o.state === 'failed');
    ok(failed && /الباركود/.test(failed.error), 'المكرر رُفض عند المحل وجهازي يعرف السبب', ob);
    ok(dump(A) === dump(B), 'والبيعة صارت عند الاثنين، والجهازان سواء');
    const sold = A.q("SELECT at, device FROM invoices ORDER BY id DESC LIMIT 1")[0];
    ok(sold.at.length === 19, 'البيعة سُجّلت بوقتها', sold);
    r = await B.v2('outbox.dismiss', { n: failed.n });
    ok(r.ok && (await B.data('outbox.list')).length === 2, 'المرفوض يُزال بعد قراءته', r);

    console.log('\n== قتل جهاز المحل وسط الدورة ==');
    for (const ms of [30, 120, 400]) {
      await B.data('item.add', { title: 'قتل ' + ms, price: 1000, qty: 1 });
      await B.sync();
      const pending = A.sync().catch(() => null);
      await E.sleep(ms);
      A.stop();
      await pending;
      await E.sleep(300);
      await A.start();
      await A.sync(); await B.sync();
      const n = A.q('SELECT COUNT(*) AS n FROM items WHERE title = ?', 'قتل ' + ms)[0].n;
      ok(n === 1, 'قُتل بعد ' + ms + ' ms: الكتاب عند المحل مرة واحدة', n);
    }
    await A.sync(); await B.sync();
    ok(dump(A) === dump(B), 'وبعدها الجهازان سواء');
    const full = await A.data('health', { full: true });
    ok(full.problems.length === 0, 'وفحص جهاز المحل الكامل سليم', full.problems);

    console.log('\n== طرابلس: فرع آخر ==');
    ow = await T.owner();
    r = await T.raw('/api/v2/create', { shopName: 'مكتبة طرابلس', city: 'طرابلس', demo: true }, { 'X-Owner': ow });
    ok(r.body && r.body.ok, 'قاعدة طرابلس ببيانات تجربة', r.body);
    await T.data('sync.setup', { role: 'main', url: cloud.url, key: KEY, name: 'محل طرابلس' });
    st = await T.sync();
    ok(!st.error && st.branch === 'tripoli', 'طرابلس جهاز محل فرعها', st);
    await A.sync();
    const branches = await A.data('branches.list');
    const t = branches.find(b => b.id === 'tripoli');
    ok(t && t.name === 'مكتبة طرابلس' && t.items >= 150, 'مصراتة ترى فرع طرابلس وعدد كتبه', branches);
    const found = await A.data('branch.search', { q: 'الفيزياء الاساسيه' });
    ok(found.length > 0 && found[0].branch === 'tripoli' && found[0].price > 0 && typeof found[0].qty === 'number' && found[0].branchName === 'مكتبة طرابلس',
      'وتبحث في كتبه بالاسم: الكمية والسعر والفرع', found[0]);
    const byAuthor = await A.data('branch.search', { q: found[0].author });
    ok(byAuthor.length > 0, 'وبالمؤلف', found[0].author);
    await T.sync();
    const tb = await T.data('branches.list');
    ok(tb.some(b => b.id === 'misrata' && b.name === 'دار الحكمة'), 'وطرابلس ترى مصراتة كذلك', tb);
    await B.sync();
    ok((await B.data('branches.list')).some(b => b.id === 'tripoli'), 'وجهازي (الثاني) يرى طرابلس أيضاً');
    const tSale = await T.data('search', { q: 'الفيزياء الاساسيه', limit: 1 });
    const before = (await A.data('branch.search', { q: 'الفيزياء الاساسيه' }))[0].qty;
    await T.data('sale', { lines: [{ itemId: tSale.items[0].id, qty: 1 }] });
    await T.sync();
    await A.data('sync.now');
    const after = (await A.data('branch.search', { q: 'الفيزياء الاساسيه' }))[0].qty;
    ok(after === before - 1, 'بيعة في طرابلس تنقص الكمية التي تراها مصراتة', before + ' → ' + after);

    console.log('\n== جهاز محل آخر لمصراتة ==');
    st = await T.v2('sync.setup', { role: 'main', url: cloud.url, key: KEY, name: 'x' });
    ok(st.ok && true, 'طرابلس تبقى محل فرعها');
    const C2 = device(tmp, 'C');
    for (const f of ['Qirtasiya.exe', 'Qirtasiya.exe.config']) fs.copyFileSync(path.join(A.dir, f), path.join(C2.dir, f));
    await C2.start();
    ow = await C2.owner();
    await C2.raw('/api/v2/create', { shopName: 'دار الحكمة', city: 'مصراتة' }, { 'X-Owner': ow });
    st = await C2.v2('sync.setup', { role: 'main', url: cloud.url, key: KEY, name: 'جهاز غريب' });
    ok(st.ok === false && st.code === 'main-taken' && /جهاز المحل/.test(st.error), 'جهاز محل ثانٍ لمصراتة يُرفض ويُقال من هو الأول', st);
    C2.stop();

    console.log('\n== سلسلة جديدة: جهازي يُعاد من النسخة ==');
    await A.data('sync.setup', { role: 'main', url: cloud.url, key: KEY, name: 'جهاز المحل' });
    await A.sync();
    await A.data('item.add', { title: 'بعد السلسلة الجديدة', price: 5000, qty: 1 });
    await A.sync();
    st = await B.sync();
    if (st.rejoin || st.error) st = await B.sync();
    st = await B.sync();
    ok(!st.error, 'جهازي أعاد التحميل وحده', st);
    ok(!B.sessionLost, 'ولم يُخرج البائع من شاشته (الجلسة باقية)', B.sessionLost);
    ok(B.q("SELECT COUNT(*) AS n FROM items WHERE title = 'بعد السلسلة الجديدة'")[0].n === 1, 'وفيه ما أُضيف بعد السلسلة الجديدة');
    ok(dump(A).replace(/#remote_cmds[\s\S]*/, '') === dump(B).replace(/#remote_cmds[\s\S]*/, ''), 'والجهازان سواء');
    ok(fs.readdirSync(path.join(B.dir, 'data', 'backups')).some(f => /^qirtasiya-before-join-/.test(f)), 'وقاعدته قبلها محفوظة في backups');

    console.log('\n== إيقاف الربط على جهازي ==');
    await B.data('sync.stop');
    st = await B.data('sync.status');
    ok(st.linked === false && st.role === 'second', 'بلا ربط، ويبقى نسخة للعرض', st);
    const q4 = await B.data('item.add', { title: 'بلا ربط', price: 1000 });
    ok(q4.queued, 'ولا يكتب في قاعدته (لا يصير محلاً ثانياً بالخطأ)', q4);

    console.log('\n== حدود الخادم المجاني ==');
    const w = cloud.env.DB.stats;
    ok(w.writes < 2000, 'كتابات D1 في هذا الاختبار كله ' + w.writes + ' (الحد اليومي 100 ألف)', w);
  } catch (e) {
    fail++; failures.push('توقف: ' + (e && e.stack || e));
    console.log('  FAIL  توقف: ' + (e && e.stack || e));
  } finally {
    for (const d of [A, B, T]) d.stop();
    await cloud.close();
  }
  console.log('\n' + '='.repeat(50));
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('='.repeat(50));
  if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
  process.exit(0);
})();
