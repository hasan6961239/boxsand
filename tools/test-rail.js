/* ============================================================
   test-rail.js — الشريط الجانبي يتّسع لكل تبويباته
   ------------------------------------------------------------
   طرابلس 17 تبويباً ومصراتة 14: على شاشة قصيرة كان باقيها تحت الحافة ويُنزل له بالماوس.
   - 1366×768 (لابتوب المحل) و1280×720: كل التبويبات ظاهرة بلا تمرير، والزر لا ينزل عن 30 بكسل.
   - 1920×1080: التصميم الأصلي كما هو (لا ضغط).
   - شاشة قصيرة جداً (768 بتكبير ويندوز 125٪): يبقى التمرير ومعه سهم «باقي التبويبات» يعمل.
   - كل أحجام الواجهة (صغير … كبير جداً)، والتلميح والضغط يعملان بعد الضغط.
   شغّل tools/dev-server.js أولاً، ثم: node tools/test-rail.js      (QI_SHOTS=مجلد للصور)
   ============================================================ */
'use strict';
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const URL = 'http://127.0.0.1:17845/';
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DATA = process.env.QI_DATA || path.join(__dirname, '..', '.devdata');
const SHOTS = process.env.QI_SHOTS || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, got) => { ok ? pass++ : fail++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          ' + (typeof got === 'string' ? got : JSON.stringify(got)))); };
const seed = () => ({
  meta: { setupDone: true, shopName: 'اختبار', currency: 'د.ل', libraries: ['A'], shelves: 6, uiSize: 'lg', theme: 'green' },
  branch: { id: 'misrata', name: 'اختبار', city: 'مصراتة', no: 1 },
  books: [{ id: 'b1', code: 'K1', title: 'كتاب أ', lib: 'A', shelf: '1', barcode: '1001', cost: 30, price: 50, qty: 10, min: 1 }],
  stationery: [], customers: [], suppliers: [], invoices: [], payments: [], purchases: [], counters: { invoice: 0, book: 1, stat: 0 }
});
/* حالة الشريط: هل كل تبويب داخل المساحة الظاهرة؟ */
const rail = pg => pg.evaluate(() => {
  const nav = document.getElementById('nav'), r = nav.getBoundingClientRect(), its = [].slice.call(nav.querySelectorAll('.nav-item'));
  const rc = its.map(b => b.getBoundingClientRect()), more = document.getElementById('navMore');
  const last = its[its.length - 1];
  return { n: its.length, h: Math.round(rc[0].height), w: Math.round(rc[0].width), inside: rc.every(x => x.top >= r.top - 1 && x.bottom <= r.bottom + 1),
    over: Math.round(last.offsetTop + last.offsetHeight + parseFloat(getComputedStyle(nav).paddingBottom) - nav.clientHeight),
    fit: document.getElementById('rail').classList.contains('fit'), small: document.getElementById('rail').classList.contains('fit-s'), more: !!more && !more.hidden,
    ic: Math.round(its[0].querySelector('.ic').getBoundingClientRect().width), foot: document.querySelector('.rail-foot').getBoundingClientRect().bottom <= window.innerHeight };
});

(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errs = [];
  async function fresh(w, h, edition, ui) {
    const d = seed(); if (ui) d.meta.uiSize = ui;
    fs.writeFileSync(path.join(DATA, 'store.json'), JSON.stringify(d));
    const pg = await b.newPage({ viewport: { width: w, height: h } });
    pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S && App.S.books && window.Sales && window.Inv, null, { timeout: 30000 });
    if (edition === 'tripoli') await pg.evaluate(() => { document.body.setAttribute('data-edition', 'tripoli'); App.rebuildNav(); });
    await sleep(500);
    return pg;
  }
  const shot = async (pg, n) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, n + '.png') }); };

  console.log('\n[1] طرابلس على لابتوب 1366×768');
  let pg = await fresh(1366, 768, 'tripoli');
  /* كما كان قبل الإصلاح: يُرفع الضغط لحظة للمقارنة */
  const before = await pg.evaluate(() => {
    const r = document.getElementById('rail'); r.classList.remove('fit', 'fit-s'); ['--nav-h', '--nav-gap', '--nav-sep'].forEach(k => r.style.removeProperty(k));
    const nav = document.getElementById('nav'), box = nav.getBoundingClientRect();
    const its = nav.querySelectorAll('.nav-item'), last = its[its.length - 1];
    return { over: Math.round(last.offsetTop + last.offsetHeight - nav.clientHeight), h: Math.round(its[0].getBoundingClientRect().height), hidden: [].filter.call(its, x => x.getBoundingClientRect().bottom > box.bottom + 1).length };
  });
  await shot(pg, 'rail-tripoli-768-before');
  check('قبل الإصلاح (للمقارنة): ' + before.hidden + ' تبويبات من 17 تحت الحافة', before.hidden >= 2 && before.over > 40, before);
  await pg.evaluate(() => App.fitRail()); await sleep(200);
  let s = await rail(pg);
  await shot(pg, 'rail-tripoli-768-after');
  check('طرابلس 1366×768: التبويبات السبعة عشر كلها ظاهرة بلا تمرير', s.n === 17 && s.inside && s.over <= 0 && !s.more, s);
  check('والزر مريح للضغط (' + s.h + ' بكسل ارتفاعاً، لا ينزل عن 30) والذيل (محفوظ والإصدار) ظاهر', s.h >= 30 && s.w >= 40 && s.foot && s.ic >= 18, s);
  await pg.hover('#nav .nav-item:last-child'); await sleep(250);
  check('تلميح اسم الصفحة ما زال يظهر عند المرور', await pg.evaluate(() => { const t = document.querySelector('.nav-tip'); return !!t && t.classList.contains('on') && t.textContent.length > 2; }));
  await pg.click('#nav .nav-item:last-child'); await sleep(300);
  check('والضغط على آخر تبويب يفتح صفحته', await pg.evaluate(() => location.hash === '#/logs' && document.querySelector('#nav .nav-item:last-child').classList.contains('on')), await pg.evaluate(() => location.hash));
  await pg.setViewportSize({ width: 1920, height: 1080 }); await sleep(400);
  s = await rail(pg);
  check('تكبير النافذة إلى 1920×1080: يرجع التصميم الأصلي وحده (لا ضغط إضافي، الزر ' + s.h + ' بكسل)', !s.fit && s.h >= 44 && s.inside && s.over <= 1, s);
  await shot(pg, 'rail-tripoli-1080');
  await pg.setViewportSize({ width: 1280, height: 720 }); await sleep(400);
  s = await rail(pg);
  check('1280×720: كلها ظاهرة كذلك (' + s.h + ' بكسل)', s.inside && s.over <= 0 && s.h >= 30, s);
  await pg.close();

  console.log('\n[2] شاشة قصيرة جداً (768 بتكبير ويندوز 125٪ = 1093×614)');
  pg = await fresh(1093, 614, 'tripoli');
  s = await rail(pg);
  check('لا تكفي حتى بعد الضغط: الزر عند أصغره (30) ويبقى التمرير', s.fit && s.h === 30 && s.over > 0, s);
  check('ومعه سهم «باقي التبويبات» ظاهر', s.more && await pg.evaluate(() => { const m = document.getElementById('navMore').getBoundingClientRect(), f = document.querySelector('.rail-foot').getBoundingClientRect(); return m.bottom <= f.top + 1 && m.width > 20; }), s);
  await shot(pg, 'rail-tripoli-614');
  await pg.evaluate(() => document.getElementById('navMore').click()); await sleep(900);
  check('الضغط على السهم ينزل بالتبويبات', await pg.evaluate(() => document.getElementById('nav').scrollTop > 40));
  await pg.evaluate(() => { const n = document.getElementById('nav'); n.scrollTop = n.scrollHeight; }); await sleep(300);
  s = await rail(pg);
  check('الضغط على السهم ينزل، وعند آخر تبويب يختفي السهم', !s.more && await pg.evaluate(() => { const n = document.getElementById('nav'), l = n.querySelector('.nav-item:last-child').getBoundingClientRect(); return l.bottom <= n.getBoundingClientRect().bottom + 1; }), s);
  await pg.close();

  console.log('\n[3] أحجام الواجهة كلها على 1366×768');
  for (const ui of ['xs', 'sm', 'md', 'lg', 'xl']) {
    pg = await fresh(1366, 768, 'tripoli', ui);
    s = await rail(pg);
    check('حجم الواجهة «' + ui + '»: ' + (s.inside ? 'كل التبويبات ظاهرة (' + s.h + ' بكسل)' : 'التمرير مع السهم'), (s.inside && s.over <= 0) || (s.h === 30 && s.more), s);
    await pg.close();
  }

  console.log('\n[4] مصراتة');
  pg = await fresh(1366, 768, 'misrata');
  s = await rail(pg);
  await shot(pg, 'rail-misrata-768');
  check('مصراتة 1366×768: تبويباتها الأربعة عشر كلها ظاهرة (' + s.h + ' بكسل)', s.n === 14 && s.inside && s.over <= 0 && !s.more, s);
  await pg.setViewportSize({ width: 1920, height: 1080 }); await sleep(400);
  s = await rail(pg);
  check('ومصراتة 1920×1080: التصميم الأصلي بلا أي تغيير (' + s.h + ' بكسل)', !s.fit && s.h >= 48 && s.inside, s);
  await pg.close();

  console.log('\nأخطاء JavaScript:', errs.length ? [...new Set(errs)] : 'لا شيء');
  if (errs.length) fail++;
  console.log('\n' + '='.repeat(50) + '\n  نجح: ' + pass + '    فشل: ' + fail + '\n' + '='.repeat(50));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
