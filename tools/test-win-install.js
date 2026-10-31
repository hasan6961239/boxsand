/* ============================================================
   test-win-install.js — ملف التثبيت نفسه على ويندوز، كما في المحل (قرار 0025)
   ------------------------------------------------------------
   جهاز ويندوز فيه بيانات 3.x (store.json في %LOCALAPPDATA%\Qirtasiya\data)
   وملف قاعدة قديم أُعيدت تسميته (رجوع المحل من 4.0)، ثم:
     1) التثبيت الصامت لملف تثبيت مصراتة: يفتح على store.json كما كان.
     2) «هذا جهاز المحل»: البيانات نفسها على القاعدة، ونسخ قبل وبعد.
     3) بيعة، ثم إطفاء فجائي وتشغيل: لا شيء يضيع.
     4) التثبيت مرة ثانية فوقه وهو يعمل (تحديث): البيانات والربط كما هما.
     5) ملف تثبيت طرابلس على الجهاز نفسه: مجلده وبياناته منفصلة، والاثنان يعملان معاً.

     node tools/test-win-install.js <مجلد ملفات التثبيت>
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');
const E = require('./engine');
const C = require('./fake-cloud');

const KEY = 'win-install-key';
const SETUPS = process.argv[2] || 'setup';
const LOCAL = process.env.LOCALAPPDATA;
const PF = process.env.ProgramW6432 || process.env.ProgramFiles;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else {
    fail++;
    const d = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail));
    failures.push(name + d);
    console.log('  FAIL  ' + name + d);
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function app(short, exe) {
  const a = { inst: path.join(PF, short), data: path.join(LOCAL, short, 'data'), exe, proc: null, port: 0 };
  a.file = f => path.join(a.data, f || '');
  a.start = async () => {
    try { fs.unlinkSync(a.file('port.txt')); } catch (e) { }
    a.proc = spawn(path.join(a.inst, exe), ['/noopen'], { cwd: a.inst, stdio: 'ignore', detached: true });
    for (let i = 0; i < 240; i++) {
      try { const s = fs.readFileSync(a.file('port.txt'), 'utf8').trim(); if (s) { a.port = +s; return a; } } catch (e) { }
      await sleep(250);
    }
    throw new Error(exe + ' لم يبدأ');
  };
  /* إطفاء فجائي (كانقطاع الكهرباء) */
  a.kill = () => { try { execFileSync('taskkill', ['/F', '/T', '/IM', exe], { stdio: 'ignore' }); } catch (e) { } };
  a.raw = (p, body, h) => E.call(a.port, p, body, h);
  a.load = async () => {
    const r = await fetch('http://127.0.0.1:' + a.port + '/api/load', { headers: { 'X-Qirtasiya': '1', Origin: 'http://127.0.0.1:' + a.port } });
    return { text: await r.text(), rev: r.headers.get('X-X3-Rev') || '' };
  };
  a.claim = async () => (await a.raw('/api/claim', { force: true })).body.token;
  return a;
}

function install(file) {
  const r = spawnSync(file, ['/S'], { stdio: 'ignore', timeout: 300000 });
  return r.status === 0;
}

(async () => {
  const files = fs.readdirSync(SETUPS);
  const misrataSetup = files.find(f => /Misrata-Setup.*\.exe$/.test(f));
  const tripoliSetup = files.find(f => /Tripoli-Setup.*\.exe$/.test(f));
  const M = app('Qirtasiya', 'Qirtasiya.exe');
  const T = app('Qirtasiya-Tripoli', 'Qirtasiya-Tripoli.exe');
  const cloud = await C.start({ secret: KEY });
  try {
    console.log('\n== جهاز ويندوز عليه بيانات 3.x، وقاعدة قديمة أُعيدت تسميتها ==');
    fs.mkdirSync(M.data, { recursive: true });
    const store = {
      meta: { setupDone: true, shopName: 'مكتبة التجربة', currency: 'د.ل', libraries: ['A', 'B'], shelves: 6, theme: 'green' },
      branch: { id: 'misrata', name: 'مكتبة التجربة', city: 'مصراتة', no: 1 },
      sync: { url: cloud.url, key: KEY, auto: false, everyMin: 10 },
      books: [
        { id: 'b1', code: 'K0001', title: 'كتاب الرياضيات', lib: 'A', shelf: '1', barcode: '111', cost: 10, price: 15, qty: 20, min: 3 },
        { id: 'b2', code: 'K0002', title: 'الفيزياء الأساسية', lib: 'B', shelf: '2', barcode: '9789953305076', cost: 20, price: 30, qty: 5, min: 1 }
      ],
      stationery: [],
      customers: [{ id: 'c1', name: 'محمد علي', phone: '091', balance: 12.5 }],
      invoices: [], payments: [], counters: { invoice: 0, book: 2, stat: 0 }
    };
    const text0 = JSON.stringify(store);
    fs.writeFileSync(M.file('store.json'), text0);
    fs.writeFileSync(M.file('qirtasiya.db.old-4.0'), 'ملف قاعدة قديم أُعيدت تسميته');

    console.log('\n== 1) التثبيت الصامت لملف تثبيت مصراتة ==');
    ok(!!misrataSetup && install(path.join(SETUPS, misrataSetup)), 'التثبيت: ' + misrataSetup);
    ok(fs.existsSync(path.join(M.inst, 'Qirtasiya.exe')) && fs.existsSync(path.join(M.inst, 'installed.flag')) &&
      fs.existsSync(path.join(M.inst, 'x64', 'sqlite3.dll')), 'الملفات في Program Files\\Qirtasiya');
    await M.start();
    let info = (await M.raw('/api/info')).body;
    ok(info.edition === 'misrata' && info.db === false && !info.x3 && path.resolve(info.dataDir) === path.resolve(M.data),
      'يفتح على مجلد البيانات نفسه، على store.json كما كان', info);
    ok((await M.load()).text === text0, 'والبيانات كما هي حرفاً');

    console.log('\n== 2) «هذا جهاز المحل» ==');
    let ow = await M.claim();
    let r = await M.raw('/api/link', { action: 'main', url: cloud.url, key: KEY, name: 'كمبيوتر المحل' }, { 'X-Owner': ow });
    ok(r.body && r.body.ok && r.body.data.x3 && r.body.data.role === 'main', 'رُبط: هذا جهاز المحل', r.body);
    let ld = await M.load();
    ok(same(JSON.parse(ld.text), store), 'البيانات على القاعدة كما كانت في الملف');
    const bk = fs.readdirSync(M.file('backups'));
    ok(fs.existsSync(M.file('qirtasiya.db')) && bk.some(f => /^backup-.*\.json$/.test(f)) && bk.some(f => /^qirtasiya-after-adopt-/.test(f)),
      'القاعدة في مجلد البيانات، ونسخة من الملف قبل ومن القاعدة بعد', bk);
    ok(fs.existsSync(M.file('qirtasiya.db.old-4.0')), 'والملف القديم الذي أُعيدت تسميته لم يُمس');

    console.log('\n== 3) بيعة، ثم إطفاء فجائي ==');
    const s1 = JSON.parse(ld.text);
    s1.counters.invoice = 1;
    s1.books[0].qty = 19;
    s1.invoices.unshift({ id: 'w1', no: 1, kind: 'sale', date: '2026-10-31', at: '2026-10-31 12:00',
      items: [{ type: 'book', id: 'b1', name: 'كتاب الرياضيات', qty: 1, price: 15, cost: 10 }],
      subtotal: 15, discount: 0, total: 15, profit: 5, method: 'cash', mode: 'retail', customerId: '', paid: 15, due: 0 });
    r = await M.raw('/api/save', s1, { 'X-Owner': ow, 'X-X3-Rev': ld.rev });
    ok(r.body && r.body.ok, 'البيعة حُفظت', r.body);
    M.kill(); await sleep(1000);
    await M.start();
    ld = await M.load();
    ok(same(JSON.parse(ld.text), s1), 'بعد الإطفاء والتشغيل: البيعة والكمية كما هي');
    ok(same(JSON.parse(fs.readFileSync(M.file('store.json'), 'utf8')), s1), 'وstore.json مرآة القاعدة');

    console.log('\n== 4) تحديث: ملف التثبيت نفسه فوقه وهو يعمل ==');
    ok(install(path.join(SETUPS, misrataSetup)), 'التثبيت مرة ثانية (يغلق البرنامج ويستبدله)');
    await sleep(1000);
    await M.start();
    info = (await M.raw('/api/info')).body;
    ld = await M.load();
    ow = await M.claim();
    r = await M.raw('/api/link', { action: 'status' }, { 'X-Owner': ow });
    ok(info.x3 === true && same(JSON.parse(ld.text), s1) && r.body.data.role === 'main', 'بعد التحديث: البيانات والربط كما هما', { info, link: r.body.data });
    r = await M.raw('/api/link', { action: 'now' }, { 'X-Owner': ow });
    ok(r.body && r.body.ok && r.body.data.lastOk && !r.body.data.error, 'والمزامنة مع الخادم تعمل', r.body && r.body.data);

    console.log('\n== 5) طرابلس على الجهاز نفسه ==');
    ok(!!tripoliSetup && install(path.join(SETUPS, tripoliSetup)), 'التثبيت: ' + tripoliSetup);
    await T.start();
    const tinfo = (await T.raw('/api/info')).body;
    ok(tinfo.edition === 'tripoli' && path.resolve(tinfo.dataDir) === path.resolve(T.data), 'طرابلس بمجلد بياناتها Qirtasiya-Tripoli', tinfo);
    ok((await M.raw('/api/info')).body.x3 === true && same(JSON.parse((await M.load()).text), s1), 'ومصراتة تعمل معها، وبياناتها لم تتغيّر');
  } catch (e) {
    ok(false, 'خطأ غير متوقع', e.stack);
  } finally {
    M.kill(); T.kill();
    await cloud.close();
    for (const a of [M, T]) {
      try { console.log('\n--- log.txt (' + a.exe + ')\n' + fs.readFileSync(a.file('log.txt'), 'utf8').split('\n').slice(-25).join('\n')); } catch (e) { }
    }
  }
  console.log('\n' + '='.repeat(50) + '\n  نجح: ' + pass + '    فشل: ' + fail + '\n' + '='.repeat(50));
  if (failures.length) console.log(failures.map(f => '  - ' + f).join('\n'));
  process.exit(fail ? 1 : 0);
})();
