/* ============================================================
   test-win-act.js — التفعيل على ويندوز حقيقي (قرار 0028 و0030)
   ------------------------------------------------------------
   ما لا يجرّبه mono في test-activation.js: سجل ويندوز للمستخدم (HKCU)، ومجلد
   الجهاز كله (ProgramData)، ومجلد المستخدم، على البرنامج كما يبنيه build.bat
   بمترجم ويندوز نفسه.
   رمز تجربة (لا رمز ملف التثبيت): بصمته توضع في Program.cs وقت البناء فقط، ثم
   يرجع الملف كما كان.
     - جهاز جديد مقفول، ورمز غلط مرفوض، والرمز وبعده 1 يفتح يوماً
     - التفعيل محفوظ في الأماكن الثلاثة (لا الرمز نفسه)، ويبقى بعد إعادة التشغيل وبعد مسح البيانات كلها
     - مكان واحد يكفي، والمحذوف يُكتب من جديد
     - بلا الأماكن الثلاثة وبلا بيانات: مقفول من جديد
     - بيانات 3.x على جهاز بلا تفعيل (تحديث): تتفعّل وحدها، ونسخة بلا بيانات بعدها أيضاً
   ويندوز وحده (في CI بعد خطوات build.bat):
     node tools/test-win-act.js
   ============================================================ */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const E = require('./engine');

if (process.platform !== 'win32') { console.log('test-win-act.js لويندوز وحده'); process.exit(0); }

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; const d = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)); failures.push(name + d); console.log('  FAIL  ' + name + d); }
}

const CODE = 'Wn7test3k';

/* ---------- أماكن الحفظ الثلاثة ---------- */
const STORES = [path.join(process.env.LOCALAPPDATA, 'QirtasiyaAct'), path.join(process.env.ProgramData || 'C:\\ProgramData', 'QirtasiyaAct')];
const REG = 'HKCU\\Software\\QirtasiyaAct';
function regValue(name) {
  const r = spawnSync('reg', ['query', REG, '/v', name], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}
function wipeReg() { spawnSync('reg', ['delete', REG, '/f'], { stdio: 'ignore' }); }
function wipeStores() { wipeReg(); for (const d of STORES) fs.rmSync(d, { recursive: true, force: true }); }
function actFile(i) { const f = path.join(STORES[i], 'act.txt'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; }

(async () => {
  const progFile = path.join(E.ROOT, 'src', 'Program.cs');
  const prog0 = fs.readFileSync(progFile, 'utf8');
  const codeRe = /const string ActCode = "[^"]*";/;
  if (!codeRe.test(prog0)) throw new Error('Program.cs: سطر ActCode تغيّر');
  console.log('يبني build.bat ببصمة رمز تجربة...');
  try {
    fs.writeFileSync(progFile, prog0.replace(codeRe, 'const string ActCode = "' + E.actSecret(CODE, 20000) + '";'));
    execFileSync('cmd.exe', ['/d', '/c', 'build.bat'], { cwd: E.ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
  } finally { fs.writeFileSync(progFile, prog0); }

  /* البرنامج في مجلد مستقل (مجلد بياناته data بجانبه) */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qwact-'));
  const dir = path.join(tmp, 'app'), dataDir = path.join(dir, 'data'), B = path.join(E.ROOT, 'build');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(path.join(B, 'Qirtasiya-1.exe'), path.join(dir, 'Qirtasiya.exe'));
  for (const f of fs.readdirSync(B)) {
    if (/\.dll$/i.test(f)) fs.copyFileSync(path.join(B, f), path.join(dir, f));
    else if (f === 'x64' || f === 'x86') fs.cpSync(path.join(B, f), path.join(dir, f), { recursive: true });
  }
  function wipeData() { fs.rmSync(dataDir, { recursive: true, force: true }); fs.mkdirSync(dataDir, { recursive: true }); }

  let eng = null;
  async function start() { eng = E.startEngine(dir); return E.waitPort(dir); }
  async function stop() { E.stopEngine(eng); eng = null; await E.sleep(1500); }
  async function status(port) { return (await E.call(port, '/api/act/status')).body || {}; }

  /* سجل «K1» (نهاية المدة + ختم بصمة الجهاز) في المكان، والرمز نفسه لا */
  const has = t => !!t && /K1\.\d+\.[A-Z2-9]{26}/.test(t) && !/wn7test3k/i.test(t);
  try {
    wipeStores();

    console.log('\n== جهاز ويندوز جديد: مقفول ==');
    let port = await start();
    let st = await status(port);
    ok(st.required === true && st.active === false, 'بلا بيانات وبلا تفعيل سابق: غير مفعّل', st);

    let r = await E.call(port, '/api/load');
    ok(r.status === 403 && r.body && r.body.locked, 'البيانات مقفولة', r.status);
    const home = await fetch('http://127.0.0.1:' + port + '/');
    ok(home.status === 200 && (await home.text()).includes('js/core.js'), 'الصفحة الأولى تفتح (شاشة التفعيل)');
    r = await E.call(port, '/api/act/activate', { code: 'Wn7test3x' });
    ok(r.body && r.body.ok === false && /الرمز غلط/.test(r.body.error || ''), 'رمز غلط: مرفوض', r.body);
    r = await E.call(port, '/api/act/activate', { code: CODE.toUpperCase() + '1' });
    ok(r.body && r.body.ok === true && r.body.active === true && r.body.days === 1, 'الرمز وبعده 1: يوم واحد', r.body);
    r = await E.call(port, '/api/load');
    ok(r.status === 200, 'والبيانات تُقرأ', r.status);
    ok(has(actFile(0)), 'التفعيل محفوظ في مجلد المستخدم (LocalAppData\\QirtasiyaAct)، والرمز نفسه لا');
    ok(has(actFile(1)), 'وفي مجلد الجهاز كله (ProgramData\\QirtasiyaAct)');
    ok(has(regValue('act')), 'وفي سجل ويندوز (HKCU\\Software\\QirtasiyaAct)', regValue('act'));
    await stop();

    console.log('\n== إعادة التشغيل، ومسح البيانات كلها ==');
    port = await start();
    st = await status(port);
    ok(st.active === true && st.kind === 'code', 'بعد إعادة التشغيل: مفعّل', st);
    await stop();
    wipeData();
    port = await start();
    st = await status(port);
    ok(st.active === true && st.kind === 'code', 'بعد مسح مجلد البيانات كله (كإلغاء التثبيت مع «امسح بياناتي»): مفعّل بلا رمز', st);
    await stop();

    console.log('\n== مكان واحد يكفي، والمحذوف يُكتب من جديد ==');
    for (const [name, keep] of [['سجل ويندوز وحده', 'reg'], ['مجلد الجهاز وحده', 1], ['مجلد المستخدم وحده', 0]]) {
      if (keep !== 'reg') wipeReg();
      for (let i = 0; i < STORES.length; i++) if (keep !== i) fs.rmSync(STORES[i], { recursive: true, force: true });
      port = await start();
      st = await status(port);
      ok(st.active === true, name + ': مفعّل', st);
      ok(has(actFile(0)) && has(actFile(1)) && has(regValue('act')), '  والمحذوف رجع في الأماكن الثلاثة');
      await stop();
    }

    console.log('\n== بلا الأماكن الثلاثة وبلا بيانات ==');
    wipeStores(); wipeData();
    port = await start();
    st = await status(port);
    ok(st.required === true && st.active === false, 'جهاز جديد من جديد: مقفول ويطلب رمزاً', st);
    await stop();

    console.log('\n== بيانات 3.x على جهاز بلا تفعيل (تحديث فوق نسخة قديمة) ==');
    wipeStores(); wipeData();
    fs.writeFileSync(path.join(dataDir, 'store.json'), JSON.stringify({
      meta: { setupDone: true, shopName: 'مكتبة التجربة' }, books: [{ id: 'b1', title: 'كتاب', price: 5, qty: 1 }], invoices: [], customers: []
    }));
    port = await start();
    st = await status(port);
    ok(st.active === true && st.kind === 'upgrade', 'تتفعّل وحدها للأبد', st);
    ok(/U1\./.test(actFile(0) || '') && /U1\./.test(actFile(1) || '') && /U1\./.test(regValue('act') || ''), '  وسجل «تثبيت سابق» في الأماكن الثلاثة');
    await stop();
    wipeData();
    port = await start();
    st = await status(port);
    ok(st.active === true && st.kind === 'upgrade', 'ونسخة بلا بيانات على الجهاز نفسه بعدها (مثل طرابلس بجانب مصراتة): مفعّلة', st);
    await stop();
  } finally {
    if (eng) E.stopEngine(eng);
    await E.sleep(1000);
    wipeStores();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  }

  console.log('\n' + pass + ' نجح، ' + fail + ' فشل');
  if (fail) { console.log(failures.map(f => '  - ' + f).join('\n')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
