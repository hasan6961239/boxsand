/* ============================================================
   test-activation.js — التفعيل برمز ثابت (قرار 0028 و0030) من البداية للنهاية
   ------------------------------------------------------------
   المحرك الحقيقي تحت mono مبنياً ببصمة رمز تجربة (لا الرمز الحقيقي — ذاك
   يعرفه صاحب المنظومة وحده، وفي ملف التثبيت بصمته فقط):
     - تثبيت جديد مقفول كلياً: لا قراءة ولا كتابة، وشاشة التفعيل وحدها.
     - رمز غلط، كيبورد عربي، رقم أيام صفر، خانة فارغة: مرفوضة برسالة واضحة.
     - الرمز وبعده 1 (بحروف كبيرة ومسافات وأرقام عربية): يوم واحد، يبقى بعد إعادة
       التشغيل وبعد مسح البيانات، والرمز نفسه لا يُكتب في أي ملف.
     - بعد المدة يقفل، وإرجاع الساعة لا يفتحه، و365 سنة، ورمز أقصر لا يقصّر مدة أطول،
       والرمز وحده مدى الحياة.
     - سجل تفعيل مزوّر أو منقول من جهاز آخر لا يفتح.
     - الأجهزة الحالية (إصدار قبل التفعيل اشتغل على الجهاز نفسه) تتفعّل وحدها،
       والبيانات المنقولة من جهاز آخر لا.
     - الشاشة: قفل كامل، تنبيه الكيبورد العربي، «إظهار»، الرمز يفتح المنظومة،
       بطاقة الإعدادات (رمز جديد لمدى الحياة)، والقفل وسط العمل عند انتهاء المدة.
   يحتاج: mono-mcs وxvfb-run وكروم Playwright.
     node tools/test-activation.js
   ============================================================ */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
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

/* رمز التجربة: المحرك يُبنى ببصمته (tools/engine.js) */
const CODE = 'Zq4test9w';

/* سجل «K1» كما يكتبه البرنامج لجهاز ما (لاختبار سجل منقول من جهاز آخر) */
const AB = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function b32(b) { let s = '', buf = 0, bits = 0; for (const x of b) { buf = (buf << 8) | x; bits += 8; while (bits >= 5) { s += AB[(buf >> (bits - 5)) & 31]; bits -= 5; } buf &= (1 << bits) - 1; } if (bits > 0) s += AB[(buf << (5 - bits)) & 31]; return s; }
function codeRecord(fp, exp) {
  const clean = fp.toUpperCase().split('').filter(c => AB.includes(c)).join('');
  const mac = crypto.createHmac('sha256', 'qirtasiya-code-v1|Hn3$Vq8!Zt5#Lp2&').update(clean + '|' + exp).digest();
  return 'K1.' + exp + '.' + b32(mac).slice(0, 26);
}

async function startFresh(dir, home) {
  const eng = E.startEngine(dir, home);
  const port = await E.waitPort(dir);
  return { eng, port };
}
function wipeDir(d) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
function setClock(dir, h) { fs.writeFileSync(path.join(dir, 'data', 'act-test-clock.txt'), String(h)); }
/* أماكن الحفظ تحت mono: مجلد المستخدم (~/.local/share) وسجل ويندوز المحاكى (~/.mono/registry) */
function storeFiles(home) {
  const out = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else out.push(p); }
  })(home);
  return out;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qact-'));
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  let cur = null;
  try {
    const dir = path.join(tmp, 'engine'), home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true }); fs.mkdirSync(home, { recursive: true });
    console.log('يبني المحرك برمز تجربة...');
    E.buildEngine(dir, 'misrata', { actCode: CODE });
    const call = (p, b) => E.call(cur.port, p, b);
    const activate = code => call('/api/act/activate', { code });

    console.log('\n== تثبيت جديد: مقفول كلياً ==');
    cur = await startFresh(dir, home);
    let r = await call('/api/act/status');
    const st0 = r.body;
    ok(st0 && st0.required === true && st0.active === false && st0.expired === false, 'جهاز جديد بلا بيانات: غير مفعّل', st0);
    ok(st0 && st0.keyFp === undefined, 'لا «بصمة مفتاح» ولا مولّد بعد اليوم', st0);
    const fp = (st0.device || 'M-').slice(2);
    r = await call('/api/load');
    ok(r.status === 403 && r.body.locked, 'قراءة البيانات مقفولة', r);
    r = await call('/api/save', {});
    ok(r.status === 403 && r.body.locked, 'الحفظ مقفول', r.status);
    r = await call('/api/v2/login', { login: 'admin' });
    ok(r.status === 403 && r.body.locked, 'أوامر القاعدة مقفولة', r.status);
    r = await call('/api/backups');
    ok(r.status === 403, 'قائمة النسخ الاحتياطية مقفولة', r.status);
    r = await call('/api/device');
    ok(r.status === 200, 'بصمة الجهاز تبقى متاحة', r.status);
    const home0 = await fetch('http://127.0.0.1:' + cur.port + '/');
    ok(home0.status === 200 && (await home0.text()).includes('js/core.js'), 'الصفحة الأولى تفتح (واجهة شاشة التفعيل)');

    console.log('\n== رموز مرفوضة ==');
    r = await activate('');
    ok(r.body.ok === false && r.body.error.includes('اكتب رمز التفعيل'), 'خانة فارغة', r.body);
    r = await activate('ظق4فثسف9ص');
    ok(r.body.ok === false && r.body.error.includes('بالحروف الإنجليزية'), 'كيبورد عربي: «الرمز بالحروف الإنجليزية»', r.body);
    r = await activate('abc12345');
    ok(r.body.ok === false && r.body.error.includes('الرمز غلط'), 'رمز غلط: «الرمز غلط»', r.body);
    r = await activate(CODE + 'x');
    ok(r.body.ok === false && r.body.error.includes('الرمز غلط'), 'الرمز وبعده حرف زايد: غلط', r.body);
    r = await activate(CODE.slice(0, -1));
    ok(r.body.ok === false && r.body.error.includes('الرمز غلط'), 'الرمز ناقص حرف: غلط', r.body);
    r = await activate(CODE + '0');
    ok(r.body.ok === false && r.body.error.includes('عدد الأيام'), 'الرمز وبعده 0: «عدد الأيام لازم يكون 1 أو أكثر»', r.body);
    r = await activate(CODE + '100000');
    ok(r.body.ok === false, 'أكثر من 5 أرقام أيام: مرفوض', r.body);
    r = await call('/api/load');
    ok(r.status === 403, 'بعد الرموز المرفوضة: ما زالت مقفولة', r.status);

    console.log('\n== الرمز وبعده 1: يوم واحد ==');
    r = await activate('  ' + CODE.toUpperCase().replace(/(...)/g, '$1-') + ' ١ ');
    ok(r.body.ok === true && r.body.active === true && r.body.forever === false && r.body.until && r.body.days === 1,
      'بحروف كبيرة وشرطات ومسافات ورقم عربي: مفعّل يوم حتى ' + (r.body && r.body.until), r.body);
    ok(r.body.hoursLeft >= 24 && r.body.hoursLeft <= 26, 'المدة لا تنقص عن يوم', r.body.hoursLeft);
    r = await call('/api/load');
    ok(r.status === 200, 'البيانات تفتح بعد التفعيل', r.status);
    E.stopEngine(cur.eng);
    cur = await startFresh(dir, home);
    r = await call('/api/act/status');
    ok(r.body.active === true && r.body.kind === 'code', 'بعد إعادة التشغيل: ما زال مفعّلاً', r.body);
    E.stopEngine(cur.eng); cur = null;
    const leaks = [path.join(dir, 'data', 'log.txt'), ...storeFiles(home)].filter(f => fs.existsSync(f) && /zq4test9w/i.test(fs.readFileSync(f, 'utf8')));
    ok(leaks.length === 0, 'الرمز نفسه لا يُكتب في سجل التشغيل ولا في ملفات التفعيل', leaks);
    ok(storeFiles(home).some(f => /act\.txt$/.test(f) && /^K1\.\d+\.[A-Z2-9]{26}$/m.test(fs.readFileSync(f, 'utf8'))), 'المحفوظ سجل بنهاية المدة مختوم ببصمة الجهاز');

    console.log('\n== مسح البيانات وإعادة التثبيت ==');
    wipeDir(path.join(dir, 'data'));
    cur = await startFresh(dir, home);
    r = await call('/api/act/status');
    ok(r.body.active === true, 'بعد مسح مجلد البيانات كله: ما زال مفعّلاً (التفعيل خارج البيانات)', r.body);
    E.stopEngine(cur.eng); cur = null;
    fs.rmSync(path.join(home, '.local', 'share', 'QirtasiyaAct'), { recursive: true, force: true });
    fs.rmSync(path.join(home, 'QirtasiyaAct'), { recursive: true, force: true });
    cur = await startFresh(dir, home);
    r = await call('/api/act/status');
    ok(r.body.active === true, 'حتى بعد مسح ملف التفعيل: يرجع من سجل ويندوز', r.body);
    E.stopEngine(cur.eng); cur = null;

    console.log('\n== انتهاء المدة والساعة ==');
    setClock(dir, 30);
    cur = await startFresh(dir, home);
    r = await call('/api/act/status');
    ok(r.body.active === false && r.body.expired === true, 'بعد يوم وساعات: انتهى التفعيل', r.body);
    r = await call('/api/load');
    ok(r.status === 403 && r.body.locked, 'بعد انتهاء المدة: البيانات مقفولة', r.status);
    E.stopEngine(cur.eng); cur = null;
    setClock(dir, -48);
    cur = await startFresh(dir, home);
    r = await call('/api/act/status');
    ok(r.body.active === false && r.body.expired === true, 'إرجاع ساعة الجهاز لا يفتحها', r.body);
    r = await activate(CODE + '365');
    ok(r.body.ok === true && r.body.active === true && r.body.days === 365 && r.body.hoursLeft >= 365 * 24 && r.body.hoursLeft <= 365 * 24 + 2,
      'الرمز وبعده 365: سنة كاملة حتى ' + (r.body && r.body.until), r.body);
    const yearUntil = r.body.until;
    r = await activate(CODE + '1');
    ok(r.body.ok === true && r.body.until === yearUntil, 'رمز يوم بعدها لا يقصّر السنة', r.body);
    r = await activate(CODE);
    ok(r.body.ok === true && r.body.forever === true && r.body.days === 0, 'الرمز وحده: مدى الحياة', r.body);
    E.stopEngine(cur.eng); cur = null;
    setClock(dir, 24 * 365 * 30);
    cur = await startFresh(dir, home);
    r = await call('/api/act/status');
    ok(r.body.active === true && r.body.forever === true, 'بعد 30 سنة: ما زال مفعّلاً', r.body);
    r = await activate(CODE + '7');
    ok(r.body.ok === true && r.body.forever === true, 'رمز أسبوع بعده لا يقصّر مدى الحياة', r.body);
    E.stopEngine(cur.eng); cur = null;
    fs.rmSync(path.join(dir, 'data', 'act-test-clock.txt'), { force: true });

    console.log('\n== سجل مزوّر أو منقول من جهاز آخر ==');
    const forged = path.join(tmp, 'home-forged');
    wipeDir(path.join(dir, 'data')); wipeDir(forged);
    for (const d of [path.join(forged, '.local', 'share', 'QirtasiyaAct'), path.join(forged, 'QirtasiyaAct')]) {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'act.txt'), ['U1.AAAAAAAAAAAAAAAAAAAAAAAAAA', 'K1.0.AAAAAAAAAAAAAAAAAAAAAAAAAA', 'K1.0.', 'K1.x.y',
        codeRecord('QQQQ-RRRR-SSSS', 0), CODE].join('\n') + '\n');
    }
    cur = await startFresh(dir, forged);
    r = await call('/api/act/status');
    ok(r.body.active === false, 'سجلات مزوّرة، وسجل مدى الحياة لجهاز آخر، والرمز نفسه مكتوباً في الملف: لا تفتح', r.body);
    E.stopEngine(cur.eng); cur = null;

    console.log('\n== الأجهزة الحالية تتفعّل وحدها ==');
    const fakeLog = (ver, f) => '2026-11-10 09:00:00  ---- بدء التشغيل ----\r\n2026-11-10 09:00:00  الإصدار ' + ver + ' (بناء 2026-11-01) — الواجهة مدمجة داخل الملف التنفيذي\r\n' +
      '2026-11-10 09:00:00  مفتاح هذا التثبيت: 1a2b\r\n2026-11-10 09:00:01  بصمة الجهاز: ' + f + '\r\n';
    const storeWith = meta => JSON.stringify({ meta: Object.assign({ setupDone: true }, meta), books: [{ id: 'b1', name: 'كتاب', qty: 3, price: 10 }], invoices: [] });
    async function scenario(name, setup) {
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
    fs.writeFileSync(path.join(dir, 'data', 'store.json'), storeWith({ shopName: 'مكتبة التجربة' }));
    fs.writeFileSync(path.join(dir, 'data', 'log.txt'), fakeLog('4.3', fp));
    cur = await startFresh(dir, sc.h);
    r = await call('/api/act/status');
    ok(r.body.active === false, 'بعد أن عُرف أنه تثبيت جديد: وضع بيانات قديمة بعدها لا يفعّله', r.body);

    console.log('\n== الشاشة ==');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pErr = []; page.on('pageerror', e => pErr.push(e.message));
    await page.goto('http://127.0.0.1:' + cur.port + '/');
    await page.waitForSelector('.act-screen', { timeout: 20000 });
    ok(await page.isVisible('.act-screen'), 'جهاز غير مفعّل: شاشة التفعيل وحدها');
    const txt0 = await page.textContent('.act-screen');
    ok(!/رقم الجهاز|واتساب/.test(txt0) && /اكتب رمز التفعيل/.test(txt0), 'لا رقم جهاز ولا واتساب: «اكتب رمز التفعيل»', txt0);
    ok(await page.locator('#nav a, .rail a').count() === 0 || !(await page.isVisible('#nav')), 'لا قوائم ولا صفحات خلف الشاشة');
    ok(await page.getAttribute('#actCode', 'type') === 'password', 'الرمز مخفي بنقاط وهو يُكتب');
    await page.click('.act-screen .act-go');
    await page.waitForFunction(() => /اكتب رمز التفعيل/.test(document.querySelector('.act-msg').textContent));
    ok(true, 'بلا رمز: «اكتب رمز التفعيل في الخانة أول»');
    await page.fill('#actCode', 'ظق4');
    ok(await page.isVisible('[data-ar="actCode"]'), 'حروف عربية في الخانة: تنبيه «الكيبورد على العربي» قبل الضغط');
    await page.fill('#actCode', 'abc12345');
    ok(!(await page.isVisible('[data-ar="actCode"]')), 'والتنبيه يختفي بالحروف الإنجليزية');
    await page.press('#actCode', 'Enter');
    await page.waitForFunction(() => /الرمز غلط/.test(document.querySelector('.act-msg').textContent), null, { timeout: 30000 });
    ok(true, 'رمز غلط بزر Enter: «الرمز غلط» في الشاشة');
    await page.click('[data-eye="actCode"]');
    ok(await page.getAttribute('#actCode', 'type') === 'text' && (await page.textContent('[data-eye="actCode"]')).includes('إخفاء'), '«إظهار» يبيّن الرمز للتأكد منه');
    await page.fill('#actCode', CODE + '1');
    await page.click('.act-screen .act-go');
    await page.waitForSelector('.act-screen', { state: 'detached', timeout: 30000 });
    await page.waitForTimeout(1500);
    ok(!(await page.isVisible('.act-screen')), 'بعد الرمز: المنظومة تفتح');
    await page.goto('http://127.0.0.1:' + cur.port + '/#/settings?tab=data');
    await page.waitForSelector('.act-set', { timeout: 20000 });
    ok((await page.textContent('.act-set')).includes('مفعّلة حتى'), 'الإعدادات ← البيانات: «مفعّلة حتى …»');
    await page.fill('#actNew', CODE);
    await page.click('.act-set .btn.primary');
    await page.waitForFunction(() => /مفعّلة مدى الحياة/.test((document.querySelector('.act-set') || {}).textContent || ''), null, { timeout: 30000 });
    ok(!(await page.isVisible('#actNew')), 'رمز مدى الحياة من الإعدادات: «مفعّلة مدى الحياة» وتختفي الخانة');
    await page.screenshot({ path: path.join(tmp, 'act-settings.png') });
    ok(pErr.length === 0, 'بلا أخطاء في الشاشة', pErr);
    await ctx.close();
    E.stopEngine(cur.eng); cur = null;

    /* انتهاء المدة والمنظومة مفتوحة: تثبيت جديد آخر (بلا بيانات سابقة تفعّله وحدها) بيوم واحد */
    const h2 = path.join(tmp, 'home-expire'); wipeDir(h2); wipeDir(path.join(dir, 'data'));
    cur = await startFresh(dir, h2);
    r = await activate(CODE + '1');
    ok(r.body.ok === true && r.body.days === 1 && r.body.forever === false, 'تثبيت جديد بيوم واحد', r.body);
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page2 = await ctx2.newPage();
    page2.on('pageerror', e => pErr.push(e.message));
    await page2.goto('http://127.0.0.1:' + cur.port + '/');
    await page2.waitForFunction(() => window.App && !document.querySelector('.act-screen'), null, { timeout: 20000 });
    setClock(dir, 30);
    await page2.evaluate(() => App.api('/api/load'));
    await page2.waitForSelector('.act-screen', { timeout: 20000 });
    ok((await page2.textContent('.act-screen')).includes('انتهت'), 'انتهت المدة وهي مفتوحة: تقفل وتقول «انتهت مدة التفعيل»');
    await page2.screenshot({ path: path.join(tmp, 'act-expired.png') });
    ok(pErr.length === 0, 'بلا أخطاء', pErr);
    await ctx2.close();
    E.stopEngine(cur.eng); cur = null;
    fs.rmSync(path.join(dir, 'data', 'act-test-clock.txt'), { force: true });
    console.log('  الصور: ' + tmp);
  } catch (e) {
    ok(false, 'استثناء', e && e.stack ? e.stack : String(e));
  } finally {
    if (cur) E.stopEngine(cur.eng);
    await browser.close();
  }
  console.log('\nنجح: ' + pass + '، فشل: ' + fail);
  if (fail) { console.log(failures.map(f => ' - ' + f).join('\n')); process.exit(1); }
})();
