/* ============================================================
   test-engine.js — المحرك الحقيقي من البداية للنهاية (المرحلة 2)
   ------------------------------------------------------------
   Qirtasiya.exe نفسه تحت mono، بمكتبة صناعية بصيغة 3.x (store.json):
   الترخيص والحارس، نقل البيانات للقاعدة الجديدة عبر النافذة المالكة،
   أوامر /api/v2 بالجلسة، ثم قتل المحرك فجأة وإعادة تشغيله والتأكد أن
   ما قيل عنه «تم» باقٍ.

   يحتاج: mono-mcs وxvfb-run ومكتبة libsqlite3.
     node tools/test-engine.js
   ============================================================ */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const E = require('./engine');
const { generate } = require('./gen/generate');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; const d = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)); failures.push(name + d); console.log('  FAIL  ' + name + d); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qengine-'));
  const key = E.testKey();
  const dir = path.join(tmp, 'engine'), home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  console.log('يبني المحرك...');
  E.buildEngine(dir, key.modulus);
  const meta = generate({ profile: 'misrata', books: 300, stationery: 40, customers: 30, years: 1, store3: 1, out: path.join(tmp, 'gen') });
  fs.copyFileSync(path.join(tmp, 'gen', 'store3.json'), path.join(dir, 'data', 'store.json'));
  const store = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'store.json'), 'utf8'));

  let eng = E.startEngine(dir, home);
  try {
    let port = await E.waitPort(dir);
    console.log('\n== الحارس والترخيص ==');
    let r = await E.call(port, '/api/v2/login', { login: 'admin', password: '' });
    ok(r.status === 403 && r.body.error === 'unlicensed', 'بلا ترخيص: أوامر v2 مرفوضة كبقية الواجهة', r);
    await E.activate(port, key.privateKey);
    r = await E.call(port, '/api/v2/login', { login: 'admin' }, { 'X-Qirtasiya': null });
    ok(r.status === 403 && r.body.error === 'forbidden', 'بلا ترويسة X-Qirtasiya: 403 (صفحة ويب غريبة لا تنادي المحرك)', r);
    r = await E.call(port, '/api/v2/login', { login: 'admin' }, { Origin: 'http://evil.example' });
    ok(r.status === 403, 'من أصل آخر: 403', r.status);
    r = await E.call(port, '/api/v2/me');
    ok(r.status === 405, 'GET على أمر: 405', r.status);

    console.log('\n== قبل النقل ==');
    r = await E.call(port, '/api/info');
    ok(r.body.db === false, 'المحرك يعمل على store.json كما كان', r.body);
    r = await E.call(port, '/api/v2/login', { login: 'admin', password: '' });
    ok(r.status === 409 && r.body.code === 'no-db', 'أوامر v2 تقول إن البيانات ما زالت على النظام القديم', r.body);
    r = await E.call(port, '/api/v2/import', {});
    ok(r.status === 409 && r.body.notOwner, 'النقل يحتاج النافذة المالكة', r.body);

    console.log('\n== النقل ==');
    const claim = (await E.call(port, '/api/claim', {})).body;
    ok(claim.ok && claim.token, 'النافذة تأخذ الملكية');
    const owner = { 'X-Owner': claim.token };
    r = await E.call(port, '/api/v2/import', {}, owner);
    const rep = r.body.data || {};
    ok(r.body.ok && rep.ok === true, 'النقل: تقرير المطابقة كله مطابق', rep.rows ? rep.rows.filter(x => !x.ok) : r.body);
    const books = (rep.rows || []).find(x => x.name === 'الكتب');
    ok(books && books.db === String(meta.counts.books), 'الكتب في القاعدة = في الملف (' + meta.counts.books + ')', books);
    r = await E.call(port, '/api/v2/import', {}, owner);
    ok(!r.body.ok && /من قبل/.test(r.body.error), 'النقل مرة واحدة فقط', r.body);
    const backups = fs.readdirSync(path.join(dir, 'data', 'backups'));
    ok(backups.some(f => /^qirtasiya-after-import-.*\.db$/.test(f)) && backups.some(f => /^backup-.*\.json$/.test(f)),
      'نسخة من store.json قبل النقل، ونسخة كاملة من القاعدة بعده', backups);
    r = await E.call(port, '/api/info');
    ok(r.body.db === true, 'المحرك يعمل على القاعدة الجديدة');
    r = await E.call(port, '/api/save', store, owner);
    ok(!r.body.ok && /انتقلت/.test(r.body.error), 'الواجهة القديمة لا تكتب store.json بعد النقل', r.body);

    console.log('\n== الأوامر ==');
    r = await E.call(port, '/api/v2/login', { login: 'admin', password: '' });
    const tok = r.body.data && r.body.data.token;
    ok(r.body.ok && tok, 'الدخول بالمدير الافتراضي');
    const S = { 'X-Session': tok };
    r = await E.call(port, '/api/v2/items.page', { limit: 5 });
    ok(r.status === 401, 'بلا ترويسة الجلسة: 401', r.status);
    r = await E.call(port, '/api/v2/items.page', { limit: 5, sort: 'title' }, S);
    ok(r.body.ok && r.body.data.total === meta.counts.books + meta.counts.stationery && r.body.data.items.length === 5, 'صفحة أصناف', r.body.data && r.body.data.total);
    const it = r.body.data.items.find(x => x.qty > 2) || r.body.data.items[0];
    const before = it.qty;
    r = await E.call(port, '/api/v2/sale', { lines: [{ itemId: it.id, qty: 2 }] }, S);
    ok(r.body.ok && r.body.data.no > store.counters.invoice, 'بيعة جديدة برقم بعد آخر فاتورة في 3.x', r.body);
    const saleNo = r.body.data.no;
    r = await E.call(port, '/api/v2/invoice.get', { no: saleNo }, S);
    ok(r.body.ok && r.body.data.total === it.price * 2 && r.body.data.lines[0].name === it.title, 'الفاتورة بسعر الصنف واسمه', r.body.data);
    r = await E.call(port, '/api/v2/item.get', { id: it.id }, S);
    ok(r.body.data.qty === before - 2, 'الكمية نقصت 2', [before, r.body.data.qty]);
    r = await E.call(port, '/api/v2/sale', { lines: [{ itemId: it.id, qty: 1, price: 12.5 }] }, S);
    ok(!r.body.ok && /بالدرهم/.test(r.body.error), 'سعر بكسر يُرفض', r.body);
    r = await E.call(port, '/api/v2/health', { full: true }, S);
    ok(r.body.ok && r.body.data.check === 'ok' && r.body.data.problems.length === 0, 'الفحص الكامل سليم', r.body.data);

    console.log('\n== البحث بالاسم (المرحلة 3) ==');
    r = await E.call(port, '/api/v2/search', { q: it.title }, S);
    let d = r.body.data || {};
    ok(r.body.ok && d.items[0].title === it.title && d.names >= 1 && d.nearFrom === -1, 'الاسم كاملاً: الصنف نفسه أول نتيجة', d.items && d.items[0]);
    /* غلط إملائي في وسط أطول كلمة */
    const words = it.title.split(' ');
    let k = 0;
    words.forEach((w, i) => { if (w.length > words[k].length) k = i; });
    const mid = Math.floor(words[k].length / 2);
    words[k] = words[k].slice(0, mid) + (words[k][mid] === 'ر' ? 'ز' : 'ر') + words[k].slice(mid + 1);
    r = await E.call(port, '/api/v2/search', { q: words.join(' ') }, S);
    d = r.body.data || {};
    ok(r.body.ok && d.items.some(x => x.title === it.title), 'بغلط إملائي («' + words[k] + '»): الصنف في النتائج', d.items && d.items.map(x => x.title));
    r = await E.call(port, '/api/v2/items.page', { q: it.title.split(' ')[0], limit: 5 }, S);
    ok(r.body.ok && r.body.data.total > 0 && r.body.data.items.length > 0, 'صفحة الأصناف بالبحث', r.body.data && r.body.data.total);

    console.log('\n== قتل المحرك فجأة ثم تشغيله ==');
    E.stopEngine(eng);
    await E.sleep(800);
    eng = E.startEngine(dir, home);
    port = await E.waitPort(dir);
    r = await E.call(port, '/api/info');
    ok(r.body.db === true, 'بعد إعادة التشغيل: القاعدة الجديدة تُفتح وحدها');
    r = await E.call(port, '/api/v2/login', { login: 'admin', password: '' });
    const S2 = { 'X-Session': r.body.data.token };
    r = await E.call(port, '/api/v2/invoice.get', { no: saleNo }, S2);
    ok(r.body.ok && r.body.data.no === saleNo, 'البيعة التي قيل عنها «تم» قبل القتل موجودة');
    r = await E.call(port, '/api/v2/me', {}, S);
    ok(r.status === 401, 'والجلسة القديمة انتهت مع المحرك', r.status);
    const log = fs.readFileSync(path.join(dir, 'data', 'log.txt'), 'utf8');
    ok(/القاعدة الجديدة: SQLite [0-9.]+، الترقية \d+، الفحص: ok/.test(log), 'سجل المحرك يذكر فتح القاعدة وفحصها');
  } catch (e) {
    fail++; failures.push('استثناء: ' + e.message); console.log('  FAIL  ' + e.stack);
  } finally {
    E.stopEngine(eng);
    await E.sleep(300);
  }
  console.log('\n==================================================');
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('==================================================');
  failures.forEach(f => console.log('  ✗ ' + f));
  if (fail === 0) fs.rmSync(tmp, { recursive: true, force: true });
  else console.log('  الملفات باقية: ' + tmp);
  process.exit(fail ? 1 : 0);
})();
