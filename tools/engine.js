/* ============================================================
   engine.js — نسخة تجربة من المحرك الحقيقي تحت mono
   ------------------------------------------------------------
   يستعملها القياس (bench/bench-3x.js) واختبار المحرك (test-engine.js).

   الترخيص: المحرك يرفض العمل بلا ترخيص. نبني نسخة مؤقتة فيها مفتاح
   عام إضافي يُولَّد لحظتها ويُنسى بعدها، ونفعّلها برمز موقّع به. النسخة
   في مجلد مؤقت ولا تدخل أي ملف تثبيت، و src/Program.cs لا يُلمس.

   يحتاج: mono-mcs وxvfb-run (أيقونة شريط المهام تحتاج شاشة).
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function testKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 });
  return { privateKey, modulus: Buffer.from(publicKey.export({ format: 'jwk' }).n, 'base64url').toString('base64') };
}

function buildEngine(dir, modulusB64) {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'Program.cs'), 'utf8');
  const anchor = 'List<string> keys = new List<string>();';
  if (src.indexOf(anchor) < 0) throw new Error('تغيّر شكل PublicKeys في Program.cs — حدّث tools/engine.js');
  const patched = src.replace(anchor, anchor + ' keys.Add("' + modulusB64 + '"); /* تجربة فقط */');
  fs.writeFileSync(path.join(dir, 'Program.cs'), patched);
  fs.writeFileSync(path.join(dir, 'BuildInfo.cs'),
    'namespace Qirtasiya { static class BuildInfo { public const string Stamp = "test"; } }');
  const res = [];
  for (const [f, n] of [['app/index.html', 'index.html'], ['app/styles.css', 'styles.css'], ['app/icon.png', 'icon.png'], ['cloud/worker.js', 'worker.js']]) {
    res.push('-resource:' + path.join(ROOT, f) + ',' + n);
  }
  for (const m of ['jsbarcode', 'core', 'inventory', 'branches', 'notify', 'consign', 'count', 'sales', 'people', 'stale', 'labels', 'reports']) {
    res.push('-resource:' + path.join(ROOT, 'app', 'js', m + '.js') + ',js/' + m + '.js');
  }
  const cs = d => fs.readdirSync(path.join(ROOT, 'src', d)).filter(f => f.endsWith('.cs')).map(f => path.join(ROOT, 'src', d, f));
  execFileSync('mcs', ['-nologo', '-target:winexe', '-optimize+', '-out:' + path.join(dir, 'Qirtasiya.exe'),
    '-r:System.dll', '-r:System.Drawing.dll', '-r:System.Windows.Forms.dll', '-r:System.Core.dll',
    ...res, path.join(dir, 'Program.cs'), path.join(dir, 'BuildInfo.cs'), ...cs('Data'), ...cs('Engine')],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  /* mono يبحث عن libsqlite3.so، وهي موجودة فقط مع حزمة التطوير */
  fs.writeFileSync(path.join(dir, 'Qirtasiya.exe.config'),
    '<configuration><dllmap dll="sqlite3" target="libsqlite3.so.0" os="linux"/></configuration>');
}

function startEngine(dir, home) {
  try { fs.unlinkSync(path.join(dir, 'data', 'port.txt')); } catch (e) { }
  return spawn('xvfb-run', ['-a', 'mono', 'Qirtasiya.exe', '/noopen'], {
    cwd: dir, env: Object.assign({}, process.env, { XDG_DATA_HOME: home, HOME: home }), stdio: 'ignore', detached: true
  });
}

async function waitPort(dir) {
  for (let i = 0; i < 240; i++) {
    try { const s = fs.readFileSync(path.join(dir, 'data', 'port.txt'), 'utf8').trim(); if (s) return +s; } catch (e) { }
    await sleep(250);
  }
  throw new Error('المحرك لم يبدأ');
}

/* قتل فوري للمجموعة كلها (xvfb-run وmono): كانقطاع الكهرباء */
function stopEngine(p) { try { process.kill(-p.pid, 'SIGKILL'); } catch (e) { } }

/* نداء كما تنادي الواجهة: الترويسة المخصّصة والأصل نفسه */
async function call(port, p, body, headers) {
  const h = Object.assign({ 'X-Qirtasiya': '1', 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:' + port }, headers || {});
  for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
  const r = await fetch('http://127.0.0.1:' + port + p, {
    method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body)
  });
  let j = null;
  try { j = await r.json(); } catch (e) { }
  return { status: r.status, body: j };
}

async function activate(port, privateKey) {
  const lic = (await call(port, '/api/license')).body;
  const sig = crypto.sign('sha256', Buffer.from(lic.fp + '|0', 'utf8'), { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING });
  const act = (await call(port, '/api/activate', { code: '0.' + sig.toString('base64').replace(/\+/g, ',').replace(/\//g, '_') })).body;
  if (!act || !act.ok) throw new Error('تفعيل نسخة التجربة فشل: ' + JSON.stringify(act));
}

module.exports = { ROOT, sleep, testKey, buildEngine, startEngine, waitPort, stopEngine, call, activate };
