/* ============================================================
   test-cloud.js — خادم الربط (cloud/worker.js) نفسه، مسارات مزامنة 4.0
   ------------------------------------------------------------
   على fake-cloud.js (D1 على node:sqlite). يجرّب العقد الذي يعتمد عليه
   البرنامج: التسليم، جهاز المحل الواحد، النسخة قطعة قطعة، السجل بلا
   فجوة ولا تكرار، الأوامر مرة واحدة، قوائم الفروع، وتغيّر السلسلة.
     node tools/test-cloud.js
   ============================================================ */
'use strict';
const C = require('./fake-cloud');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; const d = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)); failures.push(name + d); console.log('  FAIL  ' + name + d); }
}

(async () => {
  const cloud = await C.start({ secret: 's3cret' });
  const base = cloud.url + '/v2/';
  const call = async (method, op, q, body, key) => {
    const r = await fetch(base + op + '?' + new URLSearchParams(q), {
      method, headers: { 'X-Shop-Key': key === undefined ? 's3cret' : key }, body
    });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { }
    return { status: r.status, j, text, h: r.headers };
  };
  const B = 'misrata', MAIN = 'mainaaaa1111', SEC = 'secbbbb22222', OTHER = 'othercccc333';
  const chain1 = 'chainone1111', chain2 = 'chaintwo2222';
  try {
    console.log('\n== الحارس ==');
    let r = await call('GET', 'hello', { branch: B, device: MAIN, role: 'main' }, undefined, 'wrong');
    ok(r.status === 401, 'كلمة سر خاطئة: 401', r.status);
    r = await call('GET', 'hello', { branch: 'bad branch!', device: MAIN, role: 'main' });
    ok(r.status === 400 && /branch/.test(r.j.error), 'رمز فرع غير صالح يُرفض', r.j);
    const noD1 = await C.start({ secret: 'x', noD1: true });
    const r0 = await fetch(noD1.url + '/v2/hello?branch=a&device=abcdefgh', { headers: { 'X-Shop-Key': 'x' } });
    const j0 = await r0.json();
    ok(r0.status === 501 && j0.code === 'no-d1', 'بلا D1 مربوطة: رسالة واضحة بخطوة الربط', j0);
    const old = await fetch(noD1.url + '/all', { headers: { 'X-Shop-Key': 'x' } });
    ok(old.status === 200, 'والمسارات القديمة (3.x والتلفون) تعمل كما كانت', old.status);
    await noD1.close();

    console.log('\n== جهاز المحل ==');
    r = await call('GET', 'hello', { branch: B, device: MAIN, role: 'main', name: 'جهاز المحل' });
    ok(r.j.ok && r.j.main.device === MAIN && r.j.snap === null && r.j.logTo === -1, 'أول جهاز محل يُسجَّل، بلا نسخة بعد', r.j);
    r = await call('GET', 'hello', { branch: B, device: OTHER, role: 'main' });
    ok(r.status === 409 && r.j.code === 'main-taken' && r.j.main.name === 'جهاز المحل', 'جهاز محل ثانٍ للفرع نفسه يُرفض ويُقال من هو الأول', r.j);
    r = await call('GET', 'hello', { branch: B, device: SEC, role: 'second', name: 'جهازي' });
    ok(r.j.ok && r.j.main.device === MAIN, 'الجهاز الثاني يُسجَّل ويعرف جهاز المحل', r.j);

    console.log('\n== النسخة الكاملة ==');
    r = await call('POST', 'snap', { branch: B, device: SEC, chain: chain1, id: 10, ver: 4, part: 0, parts: 2 }, 'AAA');
    ok(r.status === 409 && r.j.code === 'not-main', 'الجهاز الثاني لا يرفع نسخة', r.j);
    r = await call('POST', 'snap', { branch: B, device: MAIN, chain: chain1, id: 10, ver: 4, part: 1, parts: 2 }, 'PART1');
    ok(r.j.ok && r.j.complete === false, 'قطعة من اثنتين: لم تكتمل', r.j);
    r = await call('GET', 'hello', { branch: B, device: SEC, role: 'second' });
    ok(r.j.snap === null, 'ولا تظهر قبل اكتمالها', r.j.snap);
    r = await call('POST', 'snap', { branch: B, device: MAIN, chain: chain1, id: 10, ver: 4, part: 0, parts: 2 }, 'PART0');
    ok(r.j.complete === true, 'اكتملت', r.j);
    r = await call('GET', 'hello', { branch: B, device: SEC, role: 'second' });
    ok(r.j.chain === chain1 && r.j.snap.id === 10 && r.j.snap.parts === 2 && r.j.snap.ver === 4 && r.j.logTo === 10, 'النسخة بداية السلسلة', r.j);
    r = await call('GET', 'snap-part', { branch: B, chain: chain1, id: 10, part: 0 });
    const r1 = await call('GET', 'snap-part', { branch: B, chain: chain1, id: 10, part: 1 });
    ok(r.text === 'PART0' && r1.text === 'PART1', 'القطع تعود كما رُفعت', [r.text, r1.text]);

    console.log('\n== السجل ==');
    r = await call('POST', 'log', { branch: B, device: MAIN, chain: chain1, from: 11, to: 20, ver: 4 }, 'LOG11');
    ok(r.j.ok && r.j.last === 20, 'قطعة 11–20 بعد النسخة', r.j);
    r = await call('POST', 'log', { branch: B, device: MAIN, chain: chain1, from: 11, to: 20, ver: 4 }, 'LOG11');
    ok(r.j.ok && r.j.dup, 'إعادة رفعها (بعد انقطاع) لا تكرّرها', r.j);
    r = await call('POST', 'log', { branch: B, device: MAIN, chain: chain1, from: 25, to: 30, ver: 4 }, 'X');
    ok(r.status === 409 && r.j.code === 'gap' && r.j.last === 20, 'فجوة تُرفض ويُقال آخر رقم', r.j);
    r = await call('POST', 'log', { branch: B, device: SEC, chain: chain1, from: 21, to: 22, ver: 4 }, 'X');
    ok(r.status === 409 && r.j.code === 'not-main', 'الجهاز الثاني لا يرفع سجلاً', r.j);
    r = await call('POST', 'log', { branch: B, device: MAIN, chain: chain1, from: 21, to: 35, ver: 4 }, 'LOG21');
    ok(r.j.last === 35, 'قطعة 21–35', r.j);
    r = await call('GET', 'log', { branch: B, chain: chain1, after: 10 });
    ok(r.text === 'LOG11' && r.h.get('x-from') === '11' && r.h.get('x-to') === '20' && r.h.get('x-ver') === '4', 'بعد 10: القطعة 11–20 بأرقامها', [r.text, r.h.get('x-to')]);
    r = await call('GET', 'log', { branch: B, chain: chain1, after: 25 });
    ok(r.text === 'LOG21', 'بعد 25: القطعة التي فيها 26 (21–35)، والجهاز يتجاوز ما طبّقه', r.text);
    r = await call('GET', 'log', { branch: B, chain: chain1, after: 35 });
    ok(r.status === 204, 'بعد آخر رقم: لا جديد (204)', r.status);
    r = await call('GET', 'log', { branch: B, chain: chain2, after: 10 });
    ok(r.status === 409 && r.j.code === 'chain', 'سلسلة قديمة: يُعاد من النسخة', r.j);
    r = await call('GET', 'hello', { branch: B, device: SEC, role: 'second' });
    ok(r.j.logTo === 35, 'التسليم يقول آخر رقم', r.j.logTo);

    console.log('\n== النسخة اليومية والسجل لم يلحقها ==');
    r = await call('POST', 'snap', { branch: B, device: MAIN, chain: chain1, id: 40, ver: 4, part: 0, parts: 1 }, 'DAILY');
    ok(r.j.complete, 'نسخة يومية برقم 40 والسجل عند 35', r.j);
    r = await call('GET', 'hello', { branch: B, device: SEC, role: 'second' });
    ok(r.j.snap.id === 40 && r.j.logTo === 35, 'السجل لا يقفز لرقم النسخة', r.j);
    r = await call('POST', 'log', { branch: B, device: MAIN, chain: chain1, from: 36, to: 45, ver: 4 }, 'LOG36');
    ok(r.j.ok && r.j.last === 45, 'جهاز المحل يكمل من حيث وقف (36–45)', r.j);
    r = await call('GET', 'log', { branch: B, chain: chain1, after: 40 });
    ok(r.text === 'LOG36', 'وجهاز يبدأ من النسخة اليومية يجد ما بعد 40', r.text);
    r = await call('GET', 'log', { branch: B, chain: chain1, after: 20 });
    ok(r.text === 'LOG21', 'والمتأخر قبلها يكمل من السجل بلا إعادة تحميل', r.text);

    console.log('\n== أوامر الجهاز الثاني ==');
    r = await call('POST', 'cmd', { branch: B, device: 'nobodyxx99', n: 1 }, '{}');
    ok(r.status === 409 && r.j.code === 'unknown-device', 'جهاز غير مسجّل لا يرسل أوامر', r.j);
    const cmd = JSON.stringify({ user: 1, cmd: 'item.add', body: { title: 'كتاب' } });
    r = await call('POST', 'cmd', { branch: B, device: SEC, n: 1 }, cmd);
    const id1 = r.j.id;
    r = await call('POST', 'cmd', { branch: B, device: SEC, n: 1 }, cmd);
    ok(r.j.id === id1, 'الأمر نفسه مرتين: رقم واحد', [id1, r.j.id]);
    r = await call('POST', 'cmd', { branch: B, device: SEC, n: 2 }, JSON.stringify({ user: 1, cmd: 'sale', body: {} }));
    r = await call('GET', 'cmds', { branch: B, after: 0 });
    ok(r.j.cmds.length === 2 && r.j.cmds[0].n === 1 && JSON.parse(r.j.cmds[0].data).cmd === 'item.add', 'جهاز المحل يقرأ الأوامر بالترتيب', r.j);
    r = await call('GET', 'cmds', { branch: B, after: id1 });
    ok(r.j.cmds.length === 1 && r.j.cmds[0].n === 2, 'وبعد آخر ما نفّذه فقط', r.j);
    r = await call('GET', 'hello', { branch: B, device: MAIN, role: 'main' });
    ok(r.j.cmdMax === r.j.cmdMax && r.j.cmdMax >= 2, 'التسليم يقول آخر رقم أمر', r.j.cmdMax);
    r = await call('POST', 'cmd', { branch: B, device: SEC, n: 3 }, 'x'.repeat(200001));
    ok(r.status === 413, 'أمر ضخم يُرفض', r.status);

    console.log('\n== قوائم الفروع ==');
    await call('GET', 'hello', { branch: 'tripoli', device: OTHER, role: 'main', name: 'محل طرابلس' });
    r = await call('POST', 'catalog', { branch: 'tripoli', device: OTHER, ver: 'catver000001', part: 0, parts: 1, n: 3, name: 'مكتبة طرابلس', city: 'طرابلس' }, 'CAT-T');
    ok(r.j.complete, 'طرابلس ترفع قائمتها', r.j);
    r = await call('GET', 'hello', { branch: B, device: SEC, role: 'second' });
    ok(r.j.catalogsAt > 0, 'مصراتة تعرف أن قائمة فرع آخر تغيّرت', r.j.catalogsAt);
    r = await call('GET', 'catalogs', { branch: B });
    const t = r.j.catalogs.find(c => c.branch === 'tripoli');
    ok(t && t.name === 'مكتبة طرابلس' && t.n === 3 && t.ver === 'catver000001', 'قائمة الفروع بأسمائها وعدد أصنافها', r.j);
    r = await call('GET', 'catalog-part', { branch: 'tripoli', ver: 'catver000001', part: 0 });
    ok(r.text === 'CAT-T', 'وتُقرأ', r.text);
    r = await call('POST', 'catalog', { branch: 'tripoli', device: SEC, ver: 'catver000002', part: 0, parts: 1 }, 'X');
    ok(r.status === 409, 'غير جهاز المحل لا يرفع قائمة الفرع', r.status);
    r = await call('POST', 'catalog', { branch: 'tripoli', device: OTHER, ver: 'catver000002', part: 0, parts: 2 }, 'A');
    r = await call('GET', 'catalogs', { branch: B });
    ok(r.j.catalogs.find(c => c.branch === 'tripoli').ver === 'catver000001', 'قائمة لم تكتمل لا تحلّ محل القديمة', r.j);

    console.log('\n== جهاز محل جديد (تغيّر السلسلة) ==');
    r = await call('GET', 'hello', { branch: B, device: OTHER, role: 'main', force: '1', name: 'الجهاز الجديد' });
    ok(r.j.ok && r.j.main.device === OTHER, 'بموافقة صريحة يحلّ جهاز جديد محل القديم', r.j);
    r = await call('POST', 'log', { branch: B, device: MAIN, chain: chain1, from: 36, to: 40, ver: 4 }, 'OLD');
    ok(r.status === 409 && r.j.code === 'not-main', 'والقديم لم يعد يرفع', r.j);
    r = await call('POST', 'snap', { branch: B, device: OTHER, chain: chain2, id: 3, ver: 4, part: 0, parts: 1 }, 'SNAP2');
    r = await call('GET', 'hello', { branch: B, device: SEC, role: 'second' });
    ok(r.j.chain === chain2 && r.j.snap.id === 3 && r.j.logTo === 3, 'نسخته تبدأ سلسلة جديدة', r.j);
    r = await call('GET', 'log', { branch: B, chain: chain1, after: 20 });
    ok(r.status === 409 && r.j.code === 'chain', 'والجهاز الثاني على القديمة يُعاد من النسخة الجديدة', r.j);
    const left = cloud.env.DB.raw.prepare("SELECT COUNT(*) AS n FROM v2_log WHERE chain = ?").get(chain1).n;
    ok(left === 0, 'وسجل السلسلة القديمة حُذف من الخادم', left);
    const parts = cloud.env.DB.raw.prepare("SELECT COUNT(*) AS n FROM v2_part WHERE kind = 'snap'").get().n;
    ok(parts === 1, 'ونسختها القديمة كذلك', parts);
  } catch (e) {
    fail++; failures.push('توقف: ' + (e && e.stack || e));
    console.log('  FAIL  توقف: ' + (e && e.stack || e));
  } finally {
    await cloud.close();
  }
  console.log('\n' + '='.repeat(50));
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('='.repeat(50));
  if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
  process.exit(0);
})();
