/* ============================================================
   test-activation.js — التفعيل بالرمز (قرار 0028) من البداية للنهاية
   ------------------------------------------------------------
   1) مولّد الرموز (tools/activation) في كروم بسياسة الأمان نفسها التي
      على Netlify: مفتاح جديد برقم سري، نسخة احتياطية، رموز، قفل، استرجاع.
   2) المحرك الحقيقي تحت mono بمفتاح تجربة عام (المفتاح الخاص هنا، للتجربة
      فقط، ولا يقبله ملف التثبيت):
      - تثبيت جديد مقفول كلياً: لا قراءة ولا كتابة، وشاشة التفعيل وحدها.
      - رمز لجهاز آخر، رمز فيه غلط، رمز ناقص، رمز انتهت مدته: مرفوضة برسالة واضحة.
      - رمز يوم من رسالة واتساب كاملة: يفتح، ويبقى بعد إعادة التشغيل، وبعد مسح البيانات.
      - بعد المدة يقفل، وإرجاع الساعة لا يفتحه، ورمز مدى الحياة يفتحه للأبد.
      - الأجهزة الحالية (إصدار قبل التفعيل اشتغل على الجهاز نفسه) تتفعّل وحدها،
        والبيانات المنقولة من جهاز آخر لا.
      - الشاشة: قفل كامل، لصق الرمز، فتح المنظومة، والقفل وسط العمل عند انتهاء المدة.
   يحتاج: mono-mcs وxvfb-run وكروم Playwright.
     node tools/test-activation.js
   ============================================================ */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { webcrypto } = require('crypto');
const E = require('./engine');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('playwright-core')); }
const CHROME = process.env.CHROME || undefined;

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; const d = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)); failures.push(name + d); console.log('  FAIL  ' + name + d); }
}

/* ---------- الرمز كما يصنعه المولّد ---------- */
const subtle = webcrypto.subtle;
const AB = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EPOCH = Date.UTC(2020, 0, 1);
function b32(b) { let s = '', buf = 0, bits = 0; for (const x of b) { buf = (buf << 8) | x; bits += 8; while (bits >= 5) { s += AB[(buf >> (bits - 5)) & 31]; bits -= 5; } buf &= (1 << bits) - 1; } if (bits > 0) s += AB[(buf << (5 - bits)) & 31]; return s; }
function crc16(b) { let c = 0xFFFF; for (const x of b) { c ^= x << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF; } return c; }
const nowH = () => Math.floor((Date.now() - EPOCH) / 3600000);
async function makeCode(priv, fp, expH) {
  const fp12 = fp.replace(/[^A-Z2-9]/g, '').slice(-12);
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode('QIRTASIYA-ACT-1|' + fp12 + '|' + expH)));
  const b = new Uint8Array(70); b[0] = 1; b[1] = (expH >> 16) & 255; b[2] = (expH >> 8) & 255; b[3] = expH & 255; b.set(sig, 4);
  const c = crc16(b.subarray(0, 68)); b[68] = c >> 8; b[69] = c & 255;
  return b32(b).match(/.{4}/g).join('-');
}
const waMsg = code => 'كود تفعيل المنظومة — يوم:\n\n' + code + '\n\nانسخه والصقه في شاشة التفعيل واضغط «تفعيل».';

/* ---------- مولّد الرموز في كروم ---------- */
function serveGenerator() {
  const DIR = path.join(E.ROOT, 'tools', 'activation');
  const csp = /Content-Security-Policy = "([^"]+)"/.exec(fs.readFileSync(path.join(DIR, 'netlify.toml'), 'utf8'))[1];
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((q, r) => {
    let f = q.url.split('?')[0]; if (f === '/') f = '/index.html';
    const p = path.join(DIR, path.normalize(f).replace(/^(\.\.[/\\])+/, ''));
    if (!p.startsWith(DIR) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Content-Security-Policy': csp });
    r.end(fs.readFileSync(p));
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res(srv)));
}

async function generatorTests(browser) {
  console.log('\n== مولّد الرموز (كروم، سياسة Netlify نفسها) ==');
  const srv = await serveGenerator();
  const url = 'http://localhost:' + srv.address().port + '/';
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(url);
  await p.waitForSelector('#setup:not([hidden])');
  ok(true, 'أول مرة: شاشة صنع المفتاح');
  await p.fill('#pin1', '12345'); await p.fill('#pin2', '12345'); await p.click('#makeKey');
  ok((await p.textContent('#setupMsg')).includes('6 أرقام'), 'رقم سري أقل من 6 أرقام مرفوض');
  await p.fill('#pin1', '246810'); await p.fill('#pin2', '246811'); await p.click('#makeKey');
  ok((await p.textContent('#setupMsg')).includes('مش زي بعض'), 'الرقمان مختلفان: مرفوض');
  await p.fill('#pin2', '246810'); await p.click('#makeKey');
  await p.waitForSelector('#saved:not([hidden])', { timeout: 60000 });
  const pub = (await p.textContent('#pubOut')).trim(), bk = await p.inputValue('#bkOut');
  ok(/^[A-Za-z0-9+/]{87}=$/.test(pub), 'المفتاح العام 65 بايتاً (88 حرف base64)', pub);
  ok(bk.startsWith('QKEY1:') && !bk.includes('246810'), 'النسخة الاحتياطية جاهزة ولا تحمل الرقم السري');
  ok(await p.isDisabled('#savedGo'), '«كمّل» مقفول حتى يؤكد حفظ النسخة الاحتياطية');
  const ls = await p.evaluate(() => JSON.stringify(localStorage));
  ok(!ls.includes('246810') && !/"d"\s*:/.test(ls), 'المفتاح الخاص لا يُخزَّن بلا تشفير، والرقم السري لا يُخزَّن');
  await p.check('#savedOk'); await p.click('#savedGo');
  await p.waitForSelector('#main:not([hidden])');
  await p.fill('#dev', 'رقم جهاز «منظومة طرابلس»: T-ABCD-EFGH-JKLM');
  ok((await p.textContent('#devInfo')).includes('منظومة طرابلس — ABCD-EFGH-JKLM'), 'رقم الجهاز يُلتقط من رسالة الواتساب كاملة');
  await p.click('.chip[data-d="7"]'); await p.fill('#who', 'تجربة'); await p.click('#gen');
  await p.waitForFunction(() => !document.querySelector('#result').hidden);
  const pageCode = (await p.textContent('#resCode')).trim();
  ok(/^([A-Z2-9]{4}-){27}[A-Z2-9]{4}$/.test(pageCode), 'رمز من 112 حرفاً بمجموعات من 4', pageCode);
  ok((await p.textContent('#resTitle')).includes('أسبوع (حتى'), 'العنوان يقول المدة وتاريخ النهاية');
  ok(await p.locator('#hist .h').count() === 1, 'الرمز في «آخر الرموز»');
  await p.click('details summary'); await p.click('#lockNow');
  await p.fill('#pinU', '000000'); await p.click('#unlock');
  await p.waitForFunction(() => document.querySelector('#lockMsg').textContent.includes('غلط'), null, { timeout: 60000 });
  ok(true, 'رقم سري غلط لا يفتح المولّد');
  await p.reload(); await p.waitForSelector('#lock:not([hidden])');
  ok(true, 'بعد إعادة الفتح يطلب الرقم السري (المفتاح لا يبقى مفتوحاً)');

  /* تلفون جديد: استرجاع من النسخة الاحتياطية */
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errs.push(e.message));
  await p2.goto(url); await p2.waitForSelector('#setup:not([hidden])');
  await p2.click('#toRestore');
  await p2.fill('#bkIn', 'نسختي:\n' + bk.replace(/(.{50})/g, '$1\n'));
  await p2.fill('#pinR', '111111'); await p2.click('#doRestore');
  await p2.waitForFunction(() => document.querySelector('#restoreMsg').textContent.includes('غلط'), null, { timeout: 60000 });
  ok(true, 'استرجاع برقم سري غلط: مرفوض');
  await p2.fill('#pinR', '246810'); await p2.click('#doRestore');
  await p2.waitForSelector('#main:not([hidden])', { timeout: 60000 });
  ok((await p2.textContent('#pubOut2')).trim() === pub, 'الاسترجاع يرجع المفتاح نفسه');
  ok(errs.length === 0, 'بلا أخطاء في الصفحة (ولا اتصال بأي خادم)', errs);
  const out = { pub, pageCode, page: p2 };
  out.close = async () => { await ctx.close(); await ctx2.close(); srv.close(); };
  return out;
}

/* ---------- المحرك ---------- */
async function startFresh(dir, home) {
  const eng = E.startEngine(dir, home);
  const port = await E.waitPort(dir);
  return { eng, port };
}
function wipeDir(d) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
function setClock(dir, h) { fs.writeFileSync(path.join(dir, 'data', 'act-test-clock.txt'), String(h)); }

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qact-'));
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  let gen = null, cur = null;
  try {
    gen = await generatorTests(browser);

    /* مفتاح التجربة للمحرك: من المولّد نفسه، فالرموز من الصفحة تُقبل في البرنامج */
    const otherKp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const dir = path.join(tmp, 'engine'), home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true }); fs.mkdirSync(home, { recursive: true });
    console.log('\nيبني المحرك بمفتاح المولّد...');
    E.buildEngine(dir, 'misrata', { actPub: gen.pub });

    /* الرموز من مفتاح المولّد الحقيقي: نوقّع بالصفحة نفسها (المفتاح الخاص لا يخرج منها) */
    async function pageCode(device, days) {
      const p = gen.page;
      await p.fill('#dev', device); await p.click('.chip[data-d="' + days + '"]'); await p.fill('#who', 'اختبار ' + days);
      const before = await p.textContent('#resCode').catch(() => '');
      await p.click('#gen');
      await p.waitForFunction(b => { const e = document.querySelector('#resCode'); return e && e.textContent && e.textContent !== b; }, before);
      return (await p.textContent('#resCode')).trim();
    }

    console.log('\n== تثبيت جديد: مقفول كلياً ==');
    cur = await startFresh(dir, home);
    let r = await E.call(cur.port, '/api/act/status');
    const st0 = r.body;
    ok(st0 && st0.required === true && st0.active === false && st0.expired === false, 'جهاز جديد بلا بيانات: غير مفعّل', st0);
    ok(/^M-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(st0.device), 'رقم الجهاز بحرف النسخة (M مصراتة)', st0.device);
    const fp = st0.device.slice(2);
    r = await E.call(cur.port, '/api/load');
    ok(r.status === 403 && r.body.locked, 'قراءة البيانات مقفولة', r);
    r = await E.call(cur.port, '/api/save', {});
    ok(r.status === 403 && r.body.locked, 'الحفظ مقفول', r.status);
    r = await E.call(cur.port, '/api/v2/login', { login: 'admin' });
    ok(r.status === 403 && r.body.locked, 'أوامر القاعدة مقفولة', r.status);
    r = await E.call(cur.port, '/api/backups');
    ok(r.status === 403, 'قائمة النسخ الاحتياطية مقفولة', r.status);
    r = await E.call(cur.port, '/api/device');
    ok(r.status === 200, 'بصمة الجهاز تبقى متاحة لشاشة التفعيل', r.status);
    const home0 = await fetch('http://127.0.0.1:' + cur.port + '/');
    ok(home0.status === 200 && (await home0.text()).includes('js/core.js'), 'الصفحة الأولى تفتح (واجهة شاشة التفعيل)');

    console.log('\n== رموز مرفوضة ==');
    r = await E.call(cur.port, '/api/act/activate', { code: await makeCode(otherKp.privateKey, fp, 0) });
    ok(r.body.ok === false && r.body.error.includes('مش لهذا الجهاز'), 'رمز من مولّد آخر (مفتاح غير مفتاحك): مرفوض', r.body);
    r = await E.call(cur.port, '/api/act/activate', { code: await pageCode('M-ZZZZ-ZZZZ-ZZZZ', 0) });
    ok(r.body.ok === false && r.body.error.includes('مش لهذا الجهاز') && r.body.error.includes(st0.device), 'رمز لجهاز آخر: مرفوض ويذكر رقم هذا الجهاز', r.body);
    const typo = gen.pageCode.replace(/^(.{20})(.)/, (m, a, c) => a + (c === 'A' ? 'B' : 'A'));
    r = await E.call(cur.port, '/api/act/activate', { code: typo });
    ok(r.body.ok === false && r.body.error.includes('فيه غلط'), 'حرف غلط: «فيه غلط في الرمز»', r.body);
    r = await E.call(cur.port, '/api/act/activate', { code: gen.pageCode.slice(0, 60) });
    ok(r.body.ok === false && r.body.error.includes('ناقص'), 'رمز ناقص: «الرمز ناقص»', r.body);
    r = await E.call(cur.port, '/api/act/activate', { code: '' });
    ok(r.body.ok === false && r.body.error.includes('الصق'), 'خانة فارغة', r.body);
    r = await E.call(cur.port, '/api/load');
    ok(r.status === 403, 'بعد الرموز المرفوضة: ما زالت مقفولة', r.status);
    E.stopEngine(cur.eng); cur = null;
    /* رمز يوم يصل بعد يومين */
    const late = await pageCode(st0.device, 1);
    setClock(dir, 50);
    cur = await startFresh(dir, path.join(tmp, 'home-late'));
    r = await E.call(cur.port, '/api/act/activate', { code: late });
    ok(r.body.ok === false && r.body.error.includes('انتهت مدته'), 'رمز انتهت مدته قبل إدخاله: مرفوض', r.body);
    E.stopEngine(cur.eng); cur = null;
    fs.rmSync(path.join(dir, 'data', 'act-test-clock.txt'), { force: true });

    console.log('\n== رمز يوم من رسالة واتساب ==');
    cur = await startFresh(dir, home);
    const dayCode = await pageCode(st0.device, 1);
    r = await E.call(cur.port, '/api/act/activate', { code: waMsg(dayCode) });
    ok(r.body.ok === true && r.body.active === true && r.body.forever === false && r.body.until, 'رمز يوم من الرسالة كاملة: مفعّل حتى ' + (r.body && r.body.until), r.body);
    ok(r.body.hoursLeft >= 24 && r.body.hoursLeft <= 26, 'المدة لا تنقص عن يوم', r.body.hoursLeft);
    r = await E.call(cur.port, '/api/load');
    ok(r.status === 200, 'البيانات تفتح بعد التفعيل', r.status);
    E.stopEngine(cur.eng);
    cur = await startFresh(dir, home);
    r = await E.call(cur.port, '/api/act/status');
    ok(r.body.active === true && r.body.kind === 'code', 'بعد إعادة التشغيل: ما زال مفعّلاً', r.body);
    E.stopEngine(cur.eng); cur = null;

    console.log('\n== مسح البيانات وإعادة التثبيت ==');
    wipeDir(path.join(dir, 'data'));
    cur = await startFresh(dir, home);
    r = await E.call(cur.port, '/api/act/status');
    ok(r.body.active === true, 'بعد مسح مجلد البيانات كله: ما زال مفعّلاً (الرمز خارج البيانات)', r.body);
    E.stopEngine(cur.eng); cur = null;
    fs.rmSync(path.join(home, '.local', 'share', 'QirtasiyaAct'), { recursive: true, force: true });
    fs.rmSync(path.join(home, 'QirtasiyaAct'), { recursive: true, force: true });
    cur = await startFresh(dir, home);
    r = await E.call(cur.port, '/api/act/status');
    ok(r.body.active === true, 'حتى بعد مسح ملف التفعيل: يرجع من سجل ويندوز', r.body);
    E.stopEngine(cur.eng); cur = null;

    console.log('\n== انتهاء المدة والساعة ==');
    setClock(dir, 30);
    cur = await startFresh(dir, home);
    r = await E.call(cur.port, '/api/act/status');
    ok(r.body.active === false && r.body.expired === true, 'بعد يوم وساعات: انتهى التفعيل', r.body);
    r = await E.call(cur.port, '/api/load');
    ok(r.status === 403 && r.body.locked, 'بعد انتهاء المدة: البيانات مقفولة', r.status);
    E.stopEngine(cur.eng); cur = null;
    setClock(dir, -48);
    cur = await startFresh(dir, home);
    r = await E.call(cur.port, '/api/act/status');
    ok(r.body.active === false && r.body.expired === true, 'إرجاع ساعة الجهاز لا يفتحها', r.body);
    const life = await pageCode(st0.device, 0);
    r = await E.call(cur.port, '/api/act/activate', { code: life });
    ok(r.body.ok === true && r.body.forever === true, 'رمز مدى الحياة يفتحها', r.body);
    E.stopEngine(cur.eng); cur = null;
    setClock(dir, 24 * 365 * 30);
    cur = await startFresh(dir, home);
    r = await E.call(cur.port, '/api/act/status');
    ok(r.body.active === true && r.body.forever === true, 'بعد 30 سنة: ما زال مفعّلاً', r.body);
    r = await E.call(cur.port, '/api/act/activate', { code: dayCode });
    ok(r.body.ok === false || r.body.forever === true, 'رمز أقصر بعده لا يقصّر مدى الحياة', r.body);
    E.stopEngine(cur.eng); cur = null;
    fs.rmSync(path.join(dir, 'data', 'act-test-clock.txt'), { force: true });

    console.log('\n== الأجهزة الحالية تتفعّل وحدها ==');
    const fakeLog = (ver, f) => '2026-11-10 09:00:00  ---- بدء التشغيل ----\r\n2026-11-10 09:00:00  الإصدار ' + ver + ' (بناء 2026-11-01) — الواجهة مدمجة داخل الملف التنفيذي\r\n' +
      '2026-11-10 09:00:00  مفتاح هذا التثبيت: 1a2b\r\n2026-11-10 09:00:01  بصمة الجهاز: ' + f + '\r\n';
    const storeWith = meta => JSON.stringify({ meta: Object.assign({ setupDone: true }, meta), books: [{ id: 'b1', name: 'كتاب', qty: 3, price: 10 }], invoices: [] });
    async function scenario(name, setup, want) {
      const h = path.join(tmp, 'home-' + name.replace(/[^a-z0-9]/gi, ''));
      wipeDir(path.join(dir, 'data')); wipeDir(h);
      setup(path.join(dir, 'data'));
      const c = await startFresh(dir, h);
      const s = (await E.call(c.port, '/api/act/status')).body;
      E.stopEngine(c.eng);
      return { s, h };
    }
    let sc = await scenario('log43', d => { fs.writeFileSync(path.join(d, 'log.txt'), fakeLog('4.3', fp)); fs.writeFileSync(path.join(d, 'store.json'), storeWith({})); });
    ok(sc.s.active === true && sc.s.forever === true && sc.s.kind === 'upgrade', 'إصدار 4.3 اشتغل على هذا الجهاز (سجل التشغيل): مفعّل للأبد بلا رمز', sc.s);
    sc = await scenario('hometest', d => { fs.writeFileSync(path.join(d, 'store.json'), storeWith({ homeFp: fp })); });
    ok(sc.s.active === true && sc.s.kind === 'upgrade', 'بيانات جهاز المحل هذا (homeFp): مفعّل وحده', sc.s);
    sc = await scenario('nothome', d => { fs.writeFileSync(path.join(d, 'store.json'), storeWith({ homeFp: 'QQQQ-RRRR-SSSS', notHome: fp })); });
    ok(sc.s.active === true && sc.s.kind === 'upgrade', 'جهاز ثانٍ سُئل عنه في نسخة قديمة (notHome): مفعّل وحده', sc.s);
    sc = await scenario('plain', d => { fs.writeFileSync(path.join(d, 'store.json'), storeWith({})); });
    ok(sc.s.active === true && sc.s.kind === 'upgrade', 'بيانات قديمة بلا ربط ولا بصمة: مفعّل وحده', sc.s);
    sc = await scenario('copied', d => {
      fs.writeFileSync(path.join(d, 'store.json'), storeWith({ homeFp: 'QQQQ-RRRR-SSSS' }));
      fs.writeFileSync(path.join(d, 'log.txt'), fakeLog('4.3', 'QQQQ-RRRR-SSSS'));
    });
    ok(sc.s.active === false, 'بيانات منقولة من جهاز آخر (بصمته وحدها): تحتاج رمزاً', sc.s);
    sc = await scenario('newver', d => { fs.writeFileSync(path.join(d, 'log.txt'), fakeLog('4.4', 'QQQQ-RRRR-SSSS') + fakeLog('4.4', fp)); fs.writeFileSync(path.join(d, 'store.json'), storeWith({ homeFp: 'QQQQ-RRRR-SSSS' })); });
    ok(sc.s.active === false, 'سجل إصدار 4.4 نفسه لا يُحسب (فقط ما قبل التفعيل)', sc.s);
    sc = await scenario('fresh', () => { });
    ok(sc.s.active === false, 'بلا بيانات أصلاً: تحتاج رمزاً', sc.s);
    /* نفس الجهاز بعد أن قيل «جديد»: نقل بيانات قديمة بعدها لا يفتحها */
    fs.writeFileSync(path.join(dir, 'data', 'store.json'), storeWith({}));
    fs.writeFileSync(path.join(dir, 'data', 'log.txt'), fakeLog('4.3', fp));
    cur = await startFresh(dir, sc.h);
    r = await E.call(cur.port, '/api/act/status');
    ok(r.body.active === false, 'بعد أن عُرف أنه تثبيت جديد: وضع بيانات قديمة بعدها لا يفعّله', r.body);
    E.stopEngine(cur.eng); cur = null;
    /* سجل «تثبيت سابق» مكتوب باليد لا ينفع: مختوم ببصمة الجهاز */
    const forged = path.join(tmp, 'home-forged');
    wipeDir(path.join(dir, 'data')); wipeDir(forged);
    for (const d of [path.join(forged, '.local', 'share', 'QirtasiyaAct'), path.join(forged, 'QirtasiyaAct')]) {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'act.txt'), 'U1.AAAAAAAAAAAAAAAAAAAAAAAAAA\nU1.\nAEAA-BBBB\n');
    }
    cur = await startFresh(dir, forged);
    r = await E.call(cur.port, '/api/act/status');
    ok(r.body.active === false, 'سجل تفعيل مزوّر في الملف: لا يفتح', r.body);
    E.stopEngine(cur.eng); cur = null;

    console.log('\n== الشاشة ==');
    wipeDir(path.join(dir, 'data'));
    const uiHome = path.join(tmp, 'home-ui'); wipeDir(uiHome);
    cur = await startFresh(dir, uiHome);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pErr = []; page.on('pageerror', e => pErr.push(e.message));
    await page.goto('http://127.0.0.1:' + cur.port + '/');
    await page.waitForSelector('.act-screen', { timeout: 20000 });
    ok(await page.isVisible('.act-screen'), 'تثبيت جديد: شاشة التفعيل وحدها');
    ok((await page.textContent('.act-screen')).includes(st0.device), 'رقم الجهاز ظاهر في الشاشة');
    ok(await page.locator('#nav a, .rail a').count() === 0 || !(await page.isVisible('#nav')), 'لا قوائم ولا صفحات خلف الشاشة');
    await page.click('.act-screen .btn.primary');
    await page.waitForFunction(() => /الصق/.test(document.querySelector('.act-msg').textContent));
    ok(true, 'بلا رمز: «الصق رمز التفعيل»');
    await page.fill('.act-screen textarea', 'الرمز: ABCD-EFGH-JKLM');
    await page.click('.act-screen .btn.primary');
    await page.waitForFunction(() => /ناقص/.test(document.querySelector('.act-msg').textContent));
    ok(true, 'رمز ناقص: رسالة واضحة في الشاشة');
    const shortCode = await pageCode(st0.device, 1);
    await page.fill('.act-screen textarea', waMsg(shortCode));
    await page.click('.act-screen .btn.primary');
    await page.waitForSelector('.act-screen', { state: 'detached', timeout: 20000 });
    await page.waitForTimeout(1500);
    ok(!(await page.isVisible('.act-screen')), 'بعد الرمز: المنظومة تفتح');
    /* انتهاء المدة والمنظومة مفتوحة */
    setClock(dir, 30);
    await page.evaluate(() => App.api('/api/load'));
    await page.waitForSelector('.act-screen', { timeout: 20000 });
    ok((await page.textContent('.act-screen')).includes('انتهت'), 'انتهت المدة وهي مفتوحة: تقفل وتقول «انتهت مدة التفعيل»');
    await page.screenshot({ path: path.join(tmp, 'act-expired.png') });
    ok(pErr.length === 0, 'بلا أخطاء في الشاشة', pErr);
    await ctx.close();
    E.stopEngine(cur.eng); cur = null;
    fs.rmSync(path.join(dir, 'data', 'act-test-clock.txt'), { force: true });
  } catch (e) {
    ok(false, 'استثناء', e && e.stack ? e.stack : String(e));
  } finally {
    if (cur) E.stopEngine(cur.eng);
    if (gen) await gen.close();
    await browser.close();
  }
  console.log('\nنجح: ' + pass + '، فشل: ' + fail);
  if (fail) { console.log(failures.map(f => ' - ' + f).join('\n')); process.exit(1); }
})();
