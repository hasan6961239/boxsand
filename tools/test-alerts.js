/* ============================================================
   test-alerts.js — التنبيهات، كتب على المباع، كتب المؤلف، التصدير، «أهلاً بك» (4.7)
   ------------------------------------------------------------
   المحرك الحقيقي لتطبيق طرابلس (شاشات 3.x) بـ2,501 كتاب، والشاشات في متصفح:
   - «أهلاً بك» لجهاز جديد فقط: البرنامج يقول إن عنده بيانات (hasData) فلا تُعرض
     على جهاز فيه محل مُعدّ، وتبقى تظهر على جهاز جديد فاضي. ومحل فيه كتب تخطّى
     «الإعداد السريع» («لاحقاً») ما تطلعش له كل مرة: يُحفظ أنه مُعدّ.
   - كتب على المباع: نافذة الاستلام كل خاناتها داخلها، وحالة الكتاب قبل البيع
     «لم يُبع شيء بعد» لا «خالص»، وبعد بيعه المستحق لصاحبه، وما يطلعش في التنبيهات.
   - التنبيهات: زر «حذف» يسأل قبل الحذف، والحذف محفوظ في الكتاب نفسه (alertOff)
     فيصل الأجهزة والهواتف، ويرجع التنبيه لما تدخل كمية جديدة وتخلص.
   - المؤلفون: زر «عرض كتبه» يفتح الكتب المربوطة بحصته.
   - اللاصقات: رقم الباركود (13 رقماً على لاصقة 30 مم) والمكان داخل اللاصقة.
   - تصدير الكتب بلا اختيار: PDF لآلاف الكتب رسالة بدل نافذة طباعة تعلق، وExcel يتجهّز.
     node tools/test-alerts.js
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright-core');
const E = require('./engine');

const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(c, name, d) {
  if (c) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (d === undefined ? '' : ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); }
}
const lastModal = p => p.evaluate(() => ([...document.querySelectorAll('#modalHost .modal')].pop() || {}).innerText || '');
/* زر الإغلاق في أسفل آخر نافذة: موجود بنصّه، والضغط عليه يسكّرها */
async function closeByFoot(p, label) {
  const n0 = await p.evaluate(() => document.querySelectorAll('#modalHost .modal').length);
  const has = await p.evaluate(l => { const m = [...document.querySelectorAll('#modalHost .modal')].pop(); const b = m && [...m.querySelectorAll('.m-foot button')].find(x => x.textContent.trim() === l); if (b) b.click(); return !!b; }, label);
  await sleep(300);
  const n1 = await p.evaluate(() => document.querySelectorAll('#modalHost .modal').length);
  return has && n1 === n0 - 1;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qal-'));
  const A = path.join(tmp, 'shop'), N = path.join(tmp, 'new'), K = path.join(tmp, 'skipped');
  for (const d of [A, N, K]) { fs.mkdirSync(path.join(d, 'data'), { recursive: true }); fs.mkdirSync(d + '-home', { recursive: true }); }
  const books = [{ id: 'b1', code: 'K0001', title: 'كتاب عادي', lib: 'B', shelf: '3', barcode: '9789953305076', cost: 10, price: 15, qty: 1, min: 2, royAu: 'au1', royT: 'pct', royV: 10 }];
  for (let i = 0; i < 2500; i++) books.push({ id: 'g' + i, code: 'G' + i, title: 'كتاب تجربة رقم ' + i, lib: 'A', shelf: '1', cost: 5, price: 10, qty: 3, min: 0 });
  fs.writeFileSync(path.join(A, 'data', 'store.json'), JSON.stringify({
    meta: { setupDone: true, shopName: 'تجربة التنبيهات', currency: 'د.ل', libraries: ['A', 'B'], shelves: 6 },
    branch: { id: 'tripoli', name: 'تجربة', city: 'طرابلس', no: 2 },
    books, stationery: [], customers: [], invoices: [], payments: [], counters: { invoice: 0, book: 2501, stat: 0 },
    authors: [{ id: 'au1', name: 'أحمد رحيل', phone: '' }]
  }));
  /* محل تخطّى «الإعداد السريع»: كتب وفواتير بلا setupDone */
  fs.writeFileSync(path.join(K, 'data', 'store.json'), JSON.stringify({
    meta: { shopName: '', currency: 'د.ل', libraries: ['A'], shelves: 4 },
    branch: { id: 'tripoli', name: '', city: 'طرابلس', no: 2 },
    books: books.slice(0, 50), stationery: [], customers: [], invoices: [], payments: [], counters: { invoice: 0, book: 50, stat: 0 }
  }));
  console.log('يبني تطبيق طرابلس…');
  E.buildEngine(A, 'tripoli');
  E.copyEngine(A, N); E.copyEngine(A, K);
  const engA = E.startEngine(A, A + '-home'), engN = E.startEngine(N, N + '-home'), engK = E.startEngine(K, K + '-home');
  let browser = null;
  try {
    const [port, portN, portK] = await Promise.all([E.waitPort(A), E.waitPort(N), E.waitPort(K)]);
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

    console.log('\n== «أهلاً بك» ==');
    const info = (await E.call(port, '/api/info')).body;
    ok(info && info.hasData === true, 'جهاز فيه محل مُعدّ: البرنامج يقول إن عنده بيانات (فلا «أهلاً بك»)', info);
    const infoN = (await E.call(portN, '/api/info')).body;
    ok(infoN && !infoN.hasData, 'جهاز جديد فاضي: بلا بيانات', infoN);
    const pn = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await pn.goto('http://127.0.0.1:' + portN + '/');
    await pn.waitForSelector('#modalHost .modal', { timeout: 60000 }).catch(() => { });
    await sleep(500);
    ok(/ابدأ من جديد/.test(await lastModal(pn)), 'وعلى الجهاز الجديد «أهلاً بك» تظهر عادي', (await lastModal(pn)).slice(0, 120));
    await pn.close();
    const pk = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errK = [];
    pk.on('pageerror', e => errK.push(e.message));
    for (let round = 1; round <= 2; round++) {
      await pk.goto('http://127.0.0.1:' + portK + '/');
      await pk.waitForFunction(() => window.App && App.S && App.S.books && App.S.books.length === 50, null, { timeout: 60000 });
      await sleep(2500);
      const k = await pk.evaluate(() => ({ done: !!App.S.meta.setupDone, welcome: /ابدأ من جديد/.test(([...document.querySelectorAll('#modalHost .modal')].pop() || {}).innerText || ''), ro: App.isReadOnly(), why: App.readOnlyReason() }));
      ok(k.done && !k.welcome && !k.ro, (round === 1 ? 'محل فيه كتب تخطّى «الإعداد السريع»: بلا «أهلاً بك» وبلا قفل' : 'وبعد إعادة الفتح: ما رجعتش'), k);
      if (round === 1) {
        /* محفوظ في البرنامج نفسه (مرآة store.json يكتبها المحرك من القاعدة)، لا في الشاشة فقط */
        let saved = false;
        for (let i = 0; i < 40 && !saved; i++) {
          try { saved = /"setupDone":true/.test(fs.readFileSync(path.join(K, 'data', 'store.json'), 'utf8')); } catch (e) { }
          if (!saved) await sleep(500);
        }
        ok(saved, 'وانحفظ في البرنامج إن المحل مُعدّ');
      }
    }
    ok(errK.length === 0, 'بلا أخطاء في الصفحة', errK.slice(0, 3));
    await pk.close();

    const p = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => d.accept().catch(() => { }));
    await p.goto('http://127.0.0.1:' + port + '/');
    await p.waitForFunction(() => window.App && App.S && App.S.books && App.S.books.length > 2000 && window.Consign && window.People, null, { timeout: 60000 });
    await sleep(800);
    ok(!/ابدأ من جديد/.test(await lastModal(p)), 'جهاز المحل يفتح على بياناته بلا «أهلاً بك»');

    console.log('\n== كتب على المباع ==');
    await p.evaluate(() => { location.hash = '#/consign'; App.route(); }); await sleep(500);
    await p.click('button:has-text("+ استلام كتب جديدة")'); await sleep(500);
    await p.fill('#cnName', 'صاحب كتاب للتجربة'); await p.fill('#cnPhone', '0910000000');
    await p.click('#modalHost button:has-text("إضافة كتاب")'); await sleep(400);
    const lay = await p.evaluate(() => {
      const m = [...document.querySelectorAll('#modalHost .modal')].pop(), mr = m.getBoundingClientRect();
      let out = 0;
      m.querySelectorAll('input, select').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.left < mr.left - 1 || r.right > mr.right + 1)) out++; });
      return { out, w: Math.round(mr.width) };
    });
    ok(lay.out === 0, 'نافذة الاستلام: كل الخانات داخل النافذة (شاشة 1366)', lay);
    const rowIns = p.locator('#modalHost .modal table input');
    const vals = ['كتاب على المباع للتجربة', 'مؤلف', '', '1', '20', '30'];
    for (let i = 0; i < vals.length; i++) { await rowIns.nth(i).fill(vals[i]); await rowIns.nth(i).dispatchEvent('change'); }
    ok(await p.evaluate(() => /10/.test((document.getElementById('cnProf0') || {}).textContent || '')), 'ربح المكتبة يتحسب وانت تكتب (30 − 20 = 10)');
    await p.click('#modalHost button:has-text("حفظ الاستلام")'); await sleep(1000);
    const st = await p.evaluate(() => document.querySelector('.card table').innerText.replace(/\s+/g, ' '));
    ok(/لم يُبع شيء بعد/.test(st) && !/خالص/.test(st), 'بعد الاستلام وقبل البيع: «لم يُبع شيء بعد» لا «خالص»', st.slice(0, 200));
    const code = await p.evaluate(() => App.S.books.find(b => b.consId).code);
    await p.evaluate(() => { location.hash = '#/pos'; App.route(); }); await sleep(400);
    await p.fill('#scan', code); await p.keyboard.press('Enter'); await sleep(400);
    await p.click('button:has-text("إتمام البيع")'); await sleep(400);
    await p.click('button:has-text("نقداً")').catch(() => { }); await sleep(1000);
    const after = await p.evaluate(() => { const it = App.S.books.find(b => b.consId); return { qty: it.qty, low: App.lowCount(), st: App.alertState(it), badge: App.stockState(it) }; });
    ok(after.qty === 0 && after.st === 'ok' && after.low === 1, 'كتاب على المباع انباع كله: ما يطلعش في التنبيهات (الباقي كتاب عادي واحد)', after);
    await p.evaluate(() => { location.hash = '#/consign'; App.route(); }); await sleep(500);
    const st2 = await p.evaluate(() => document.querySelector('.card table').innerText.replace(/\s+/g, ' '));
    ok(/20/.test(st2) && !/لم يُبع شيء بعد/.test(st2), 'بعد البيع: المستحق لصاحبه 20', st2.slice(0, 200));

    console.log('\n== التنبيهات: حذف بتأكيد ==');
    await p.evaluate(() => { location.hash = '#/alerts'; App.route(); }); await sleep(600);
    const a1 = await p.evaluate(() => ({ low: App.lowCount(), txt: document.body.innerText.includes('كتاب عادي'), cons: document.body.innerText.includes('كتاب على المباع للتجربة'), btn: !!document.querySelector('button[onclick^="Inv.dropAlert"]') }));
    ok(a1.low === 1 && a1.txt && !a1.cons && a1.btn, 'صفحة التنبيهات: الكتاب العادي ومعه زر «حذف»، وكتاب المباع مش فيها', a1);
    await p.click('button[onclick^="Inv.dropAlert"]'); await sleep(400);
    const ask = await lastModal(p);
    ok(/تحذف تنبيه «كتاب عادي»/.test(ask), 'يسأل قبل الحذف', ask.slice(0, 120));
    await p.click('#modalHost .modal:last-child button:has-text("حذف التنبيه")'); await sleep(800);
    const a2 = await p.evaluate(() => ({ low: App.lowCount(), off: App.S.books.find(b => b.id === 'b1').alertOff }));
    ok(a2.low === 0 && a2.off === 1, 'بعد التأكيد: اختفى التنبيه، ومحفوظ في الكتاب نفسه فيصل الأجهزة والهواتف', a2);
    /* بعد إعادة الفتح: الحذف محفوظ في البرنامج نفسه، لا في الشاشة */
    await p.reload();
    await p.waitForFunction(() => window.App && App.S && App.S.books && App.S.books.length > 2000, null, { timeout: 60000 }); await sleep(800);
    const a2b = await p.evaluate(() => ({ low: App.lowCount(), off: App.S.books.find(b => b.id === 'b1').alertOff }));
    ok(a2b.low === 0 && a2b.off === 1, 'بعد إعادة فتح البرنامج: التنبيه المحذوف ما يرجعش', a2b);
    await p.evaluate(() => { const b = App.S.books.find(x => x.id === 'b1'); b.qty = 5; App.save(); }); await sleep(800);
    await p.evaluate(() => { const b = App.S.books.find(x => x.id === 'b1'); b.qty = 1; App.save(); }); await sleep(800);
    const a3 = await p.evaluate(() => ({ low: App.lowCount(), off: App.S.books.find(b => b.id === 'b1').alertOff }));
    ok(a3.low === 1 && a3.off === undefined, 'دخلت كمية ثم خلصت من جديد: التنبيه رجع', a3);

    console.log('\n== المؤلفون: «عرض كتبه» ==');
    await p.evaluate(() => { location.hash = '#/suppliers'; App.route(); }); await sleep(600);
    await p.evaluate(() => People.setSpTab && People.setSpTab('auth')); await sleep(500);
    const hasBtn = await p.evaluate(() => !!document.querySelector('button[onclick^="People.authorBooks"]'));
    ok(hasBtn, 'زر «عرض كتبه» جنب «كشف الحساب» و«تسديد»');
    if (hasBtn) { await p.click('button[onclick^="People.authorBooks"]'); await sleep(500); }
    const ab = await lastModal(p);
    ok(/كتب المؤلف — أحمد رحيل/.test(ab) && /كتاب عادي/.test(ab) && !/كتاب تجربة رقم/.test(ab), 'تفتح كتبه المربوطة بحصته فقط', ab.slice(0, 160));
    ok(await closeByFoot(p, 'إغلاق'), 'وتتسكّر بزر «إغلاق» تحت');

    console.log('\n== اللاصقات: رقم الباركود والمكان داخل اللاصقة ==');
    /* رقم 13 خانة أعرض من الأعمدة على لاصقة 30 مم: كان يُرسم خارج اللاصقة (rtl) فيختفي */
    const consId = await p.evaluate(() => App.S.books.find(b => b.consId).id);
    await p.evaluate(() => { location.hash = '#/labels'; App.route(); }); await sleep(600);
    for (const [w, h] of [[30, 25], [30, 20], [40, 30]]) {
      const lb = await p.evaluate(([w, h, ids]) => {
        App.S.meta.label = Object.assign(App.S.meta.label || {}, { w, h });
        document.querySelectorAll('#modalHost .overlay').forEach(o => o.remove());
        Labels.clearSel(); ids.forEach(i => Labels.toggle(i)); Labels.preview();
        return new Promise(r => setTimeout(() => r([...document.querySelectorAll('.lbl-one')].map(l => {
          const L = l.getBoundingClientRect();
          const inside = e => { if (!e) return false; const q = e.getBoundingClientRect(); return q.width > 0 && q.left >= L.left - 0.5 && q.right <= L.right + 0.5 && q.top >= L.top - 0.5 && q.bottom <= L.bottom + 0.5; };
          return { digits: [...l.querySelectorAll('svg text')].map(x => x.textContent).join(''), digitsIn: [...l.querySelectorAll('svg text')].every(inside) && !!l.querySelector('svg text'), locIn: inside(l.querySelector('.lf-loc')) };
        })), 700));
      }, [w, h, ['b1', consId]]);
      ok(lb.length === 2 && lb.every(x => x.digitsIn && x.locIn) && lb.some(x => x.digits === '9789953305076'),
        'لاصقة ' + w + '×' + h + ': رقم الباركود (13 رقم وكتاب المباع) والمكان داخل اللاصقة', lb);
    }
    await p.evaluate(() => document.querySelectorAll('#modalHost .overlay').forEach(o => o.remove()));

    console.log('\n== تصدير الكتب بلا اختيار ==');
    await p.evaluate(() => { location.hash = '#/export'; App.route(); }); await sleep(800);
    let prints = 0;
    await p.exposeFunction('__countPrint', () => { prints++; });
    await p.evaluate(() => { window.print = () => window.__countPrint(); });
    await p.evaluate(() => Exp.pdf()); await sleep(600);
    const pm = await lastModal(p);
    ok(prints === 0 && /كتب كثيرة على PDF/.test(pm) && /تصدير Excel/.test(pm), 'PDF لـ2,501 كتاب بلا اختيار: رسالة بدل نافذة طباعة تعلق', pm.slice(0, 160));
    ok(await closeByFoot(p, 'تمام'), 'والرسالة تتسكّر بزر «تمام» تحت');
    const t0 = Date.now();
    const xl = await p.evaluate(() => Exp.__blob().size);
    ok(xl > 50000, 'Excel للكل (2,501 كتاب) يتجهّز (' + Math.round(xl / 1024) + ' ك.ب في ' + (Date.now() - t0) + ' ms)');
    ok(errs.length === 0, 'بلا أخطاء في الصفحة', errs.slice(0, 3));
  } catch (e) { fail++; console.log('  FAIL  خطأ: ' + String(e.message).split('\n')[0]); }
  finally {
    console.log('\n' + '='.repeat(50) + '\n  نجح: ' + pass + '    فشل: ' + fail + '\n' + '='.repeat(50));
    if (browser) await browser.close();
    E.stopEngine(engA); E.stopEngine(engN); E.stopEngine(engK);
    await sleep(500);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
    process.exit(fail ? 1 : 0);
  }
})();
