/* ============================================================
   engine.js — نسخة تجربة من المحرك الحقيقي تحت mono
   ------------------------------------------------------------
   يستعملها القياس (bench/bench-3x.js) واختبار المحرك (test-engine.js).
   تُبنى من src/Program.cs كما هو في مجلد مؤقت، ولا تدخل أي ملف تثبيت.
   التفعيل (قرار 0028 و0030): نسخة الاختبار بلا رمز تفعيل فتعمل من أول تشغيل كما كانت،
   إلا إن طُلب رمز تجربة (opts.actCode): عندها تُبنى ببصمته ويعمل التفعيل كملف التثبيت،
   وساعته تُزاح بملف act-test-clock.txt في مجلد البيانات (ساعات).

   يحتاج: mono-mcs وxvfb-run (أيقونة شريط المهام تحتاج شاشة).

   على ويندوز: لا بناء ولا mono. QI_PROGRAM (مصراتة) وQI_PROGRAM_TRIPOLI مجلدا
   البرنامج كما ثبّته ملف التثبيت نفسه؛ يُنسخ لمجلد التجربة بلا installed.flag
   فيعمل محمولاً على مجلد data بجانبه، ويُشغَّل الملف التنفيذي مباشرة.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const WIN = process.platform === 'win32';

/* بصمة رمز تفعيل كما في Program.cs (ActCode): PBKDF2-SHA1 للرمز بحروف صغيرة وأرقام فقط.
   رمز التجربة بدورات أقل من ملف التثبيت حتى لا تبطؤ الاختبارات */
function actSecret(code, iter) {
  const crypto = require('crypto');
  const norm = String(code).replace(/[A-Z]/g, c => c.toLowerCase()).replace(/[^a-z0-9]/g, '');
  const salt = crypto.randomBytes(16);
  iter = iter || 5000;
  return 'P1:' + iter + ':' + salt.toString('base64') + ':' + crypto.pbkdf2Sync(Buffer.from(norm, 'utf8'), salt, iter, 32, 'sha1').toString('base64');
}

/* البرنامج المثبَّت على ويندوز: ملفاته كلها، والملف التنفيذي باسم Qirtasiya.exe */
function copyInstalled(src, dir) {
  for (const f of fs.readdirSync(src)) {
    if (f === 'installed.flag' || f === 'uninstall.exe' || f === 'data') continue;
    const from = path.join(src, f);
    const to = path.join(dir, /^Qirtasiya.*\.exe$/i.test(f) ? 'Qirtasiya.exe' : f);
    if (fs.statSync(from).isDirectory()) fs.cpSync(from, to, { recursive: true });
    else fs.copyFileSync(from, to);
  }
}

/* نسخة ثانية من البرنامج نفسه في مجلد آخر (جهاز آخر في الاختبار) */
function copyEngine(src, dir) {
  for (const f of fs.readdirSync(src)) {
    if (f === 'data' || f.endsWith('.cs')) continue;
    fs.cpSync(path.join(src, f), path.join(dir, f), { recursive: true });
  }
}

/* edition: misrata (الافتراضي) أو tripoli — تطبيقان منفصلان (قرار 0022)
   opts.actCode: رمز تفعيل للتجربة (يُبنى ببصمته)، أو opts.actSecret بصمة جاهزة؛ بدونهما التفعيل معطّل في نسخة الاختبار */
function buildEngine(dir, edition, opts) {
  edition = edition || 'misrata';
  opts = opts || {};
  if (WIN) {
    const src = edition === 'tripoli' ? process.env.QI_PROGRAM_TRIPOLI : process.env.QI_PROGRAM;
    if (!src) throw new Error('على ويندوز: QI_PROGRAM' + (edition === 'tripoli' ? '_TRIPOLI' : '') + ' = مجلد البرنامج المثبَّت');
    copyInstalled(src, dir);
    return;
  }
  let prog = fs.readFileSync(path.join(ROOT, 'src', 'Program.cs'), 'utf8');
  const codeRe = /const string ActCode = "[^"]*";/, clockRe = /const bool ActTestClock = false;/;
  if (!codeRe.test(prog) || !clockRe.test(prog)) throw new Error('Program.cs: سطر ActCode أو ActTestClock تغيّر');
  prog = prog.replace(codeRe, 'const string ActCode = "' + (opts.actSecret || (opts.actCode ? actSecret(opts.actCode) : '')) + '";');
  if (opts.actCode || opts.actSecret) prog = prog.replace(clockRe, 'const bool ActTestClock = true;');
  fs.writeFileSync(path.join(dir, 'Program.cs'), prog);
  fs.writeFileSync(path.join(dir, 'BuildInfo.cs'),
    'namespace Qirtasiya { static class BuildInfo { public const string Stamp = "test"; public const string Edition = "' + edition + '"; } }');
  const res = [];
  const png = edition === 'tripoli' ? 'app/icon-tripoli.png' : 'app/icon.png';
  for (const [f, n] of [['app/index.html', 'index.html'], ['app/styles.css', 'styles.css'], [png, 'icon.png'], ['cloud/worker.js', 'worker.js']]) {
    res.push('-resource:' + path.join(ROOT, f) + ',' + n);
  }
  for (const m of ['jsbarcode', 'core', 'inventory', 'branches', 'notify', 'consign', 'count', 'sales', 'people', 'expenses', 'stale', 'labels', 'staff', 'reports']) {
    res.push('-resource:' + path.join(ROOT, 'app', 'js', m + '.js') + ',js/' + m + '.js');
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'app', 'v4'))) {
    res.push('-resource:' + path.join(ROOT, 'app', 'v4', f) + ',v4/' + f);
  }
  const cs = d => fs.readdirSync(path.join(ROOT, 'src', d)).filter(f => f.endsWith('.cs')).map(f => path.join(ROOT, 'src', d, f));
  const wv = f => path.join(ROOT, 'vendor', 'webview2', f);
  /* على مكتبات .NET Framework 4.8 نفسها كملف التثبيت (tools/build-linux.sh) */
  execFileSync('mcs', ['-nologo', '-sdk:4.8-api', '-target:winexe', '-optimize+', '-out:' + path.join(dir, 'Qirtasiya.exe'),
    '-r:System.dll', '-r:System.Drawing.dll', '-r:System.Windows.Forms.dll', '-r:System.Core.dll', '-r:System.Numerics.dll',
    '-r:' + wv('Microsoft.Web.WebView2.Core.dll'), '-r:' + wv('Microsoft.Web.WebView2.WinForms.dll'),
    ...res, path.join(dir, 'Program.cs'), path.join(ROOT, 'src', 'AppWindow.cs'), path.join(ROOT, 'src', 'Activation.cs'), path.join(dir, 'BuildInfo.cs'),
    ...cs('Data'), ...cs('Engine')],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  /* mono يبحث عن libsqlite3.so، وهي موجودة فقط مع حزمة التطوير */
  fs.writeFileSync(path.join(dir, 'Qirtasiya.exe.config'),
    '<configuration><dllmap dll="sqlite3" target="libsqlite3.so.0" os="linux"/></configuration>');
}

function startEngine(dir, home) {
  try { fs.unlinkSync(path.join(dir, 'data', 'port.txt')); } catch (e) { }
  if (WIN) return spawn(path.join(dir, 'Qirtasiya.exe'), ['/noopen'], { cwd: dir, stdio: 'ignore', detached: true });
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

/* قتل فوري للمجموعة كلها (xvfb-run وmono): كانقطاع الكهرباء. على ويندوز TerminateProcess */
function stopEngine(p) {
  if (!p) return;
  if (WIN) {
    try { execFileSync('taskkill', ['/F', '/T', '/PID', String(p.pid)], { stdio: 'ignore' }); } catch (e) { }
    return;
  }
  try { process.kill(-p.pid, 'SIGKILL'); } catch (e) { }
}

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

module.exports = { ROOT, WIN, sleep, actSecret, buildEngine, copyEngine, startEngine, waitPort, stopEngine, call };
