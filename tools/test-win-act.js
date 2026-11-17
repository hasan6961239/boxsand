/* ============================================================
   test-win-act.js — التفعيل على ويندوز حقيقي (قرار 0028)
   ------------------------------------------------------------
   ما لا يجرّبه mono في test-activation.js: سجل ويندوز للمستخدم (HKCU)، ومجلد
   الجهاز كله (ProgramData)، ومجلد المستخدم، على البرنامج كما يبنيه build.bat
   بمترجم ويندوز نفسه.
   مفتاح تجربة يُولَّد هنا ويُنسى بعد التجربة (لا يقبله ملف التثبيت): يُوضع في
   Program.cs وقت البناء فقط، ثم يرجع الملف كما كان.
     - جهاز جديد مقفول، ورمز لجهاز آخر مرفوض، ورمز يوم من رسالة واتساب يفتح
     - الرمز محفوظ في الأماكن الثلاثة، ويبقى بعد إعادة التشغيل وبعد مسح البيانات كلها
     - مكان واحد يكفي، والمحذوف يُكتب من جديد
     - بلا الأماكن الثلاثة وبلا بيانات: مقفول من جديد
     - بيانات 3.x على جهاز بلا تفعيل (تحديث): تتفعّل وحدها، ونسخة بلا بيانات بعدها أيضاً
   ويندوز وحده (في CI بعد خطوات build.bat):
     node tools/test-win-act.js
   ============================================================ */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { webcrypto, createHash } = require('crypto');
const E = require('./engine');

if (process.platform !== 'win32') { console.log('test-win-act.js لويندوز وحده'); process.exit(0); }

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; const d = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)); failures.push(name + d); console.log('  FAIL  ' + name + d); }
}

/* ---------- الرمز كما يصنعه المولّد (مثل test-activation.js) ---------- */
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
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pubRaw = Buffer.from(await subtle.exportKey('raw', kp.publicKey));
  const pub = pubRaw.toString('base64');
  const s8 = b32(createHash('sha256').update(pubRaw).digest()).slice(0, 8);
  const kfp = s8.slice(0, 4) + '-' + s8.slice(4);

  const progFile = path.join(E.ROOT, 'src', 'Program.cs');
  const prog0 = fs.readFileSync(progFile, 'utf8');
  const keyRe = /const string ActPubKey = "[^"]*";/;
  if (!keyRe.test(prog0)) throw new Error('Program.cs: سطر ActPubKey تغيّر');
  console.log('يبني build.bat بمفتاح تجربة (بصمته ' + kfp + ')...');
  try {
    fs.writeFileSync(progFile, prog0.replace(keyRe, 'const string ActPubKey = "' + pub + '";'));
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

  let code = '';
  const has = t => !!t && !!code && t.replace(/[^A-Z2-9]/g, '').includes(code.replace(/[^A-Z2-9]/g, '').slice(0, 40));
  try {
    wipeStores();

    console.log('\n== جهاز ويندوز جديد: مقفول ==');
    let port = await start();
    let st = await status(port);
    ok(st.required === true && st.active === false, 'بلا بيانات وبلا تفعيل سابق: غير مفعّل', st);
    ok(st.keyFp === kfp, 'بصمة المفتاح في البرنامج كما في المولّد', (st.keyFp || '') + ' / ' + kfp);
    ok(/^M-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(st.device || ''), 'رقم الجهاز M-…', st.device);
    let r = await E.call(port, '/api/load');
    ok(r.status === 403 && r.body && r.body.locked, 'البيانات مقفولة', r.status);
    const home = await fetch('http://127.0.0.1:' + port + '/');
    ok(home.status === 200 && (await home.text()).includes('js/core.js'), 'الصفحة الأولى تفتح (شاشة التفعيل)');
    const fp = (st.device || 'M-').slice(2);
    r = await E.call(port, '/api/act/activate', { code: await makeCode(kp.privateKey, 'ZZZZ-ZZZZ-ZZZZ', 0) });
    ok(r.body && r.body.ok === false && /مش لهذا الجهاز/.test(r.body.error || ''), 'رمز لجهاز آخر: مرفوض', r.body);
    code = await makeCode(kp.privateKey, fp, nowH() + 24);
    r = await E.call(port, '/api/act/activate', { code: 'كود تفعيل المنظومة — يوم:\n\n' + code + '\n\nانسخه والصقه في شاشة التفعيل واضغط «تفعيل».' });
    ok(r.body && r.body.ok === true && r.body.active === true, 'رمز يوم من رسالة واتساب كاملة: يفتح', r.body);
    r = await E.call(port, '/api/load');
    ok(r.status === 200, 'والبيانات تُقرأ', r.status);
    ok(has(actFile(0)), 'الرمز محفوظ في مجلد المستخدم (LocalAppData\\QirtasiyaAct)');
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
