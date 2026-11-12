/* ============================================================
   test-scan.js — قارئ الباركود في تطبيق الهاتف، بكاميرا تعرض باركوداً حقيقياً
   ------------------------------------------------------------
   باركودات حقيقية تُرسم (EAN-13 كما على الكتب، وCODE128 كما على لاصقات المنظومة،
   وEAN-8) ثم تصير فيديو يقدّمه المتصفح على أنه الكاميرا
   (--use-file-for-fake-video-capture). التطبيق يفتح الكاميرا كما يفتحها في الآيفون
   (scan.js: zxing مبنيّ WebAssembly داخل الموقع، وبسياسة أمان الموقع نفسها)، ويُنتظر
   أن يقرأ الرمز وحده ويذهب به حيث أنت:
     البيع ← السلة · عرض وتعديل ← بطاقة الصنف · الجرد ← العدّ (والكاميرا تفتح وحدها
     للنسخة التالية) · إضافة كمية ← سطر · النموذج ← خانة الباركود · زر المسح الأوسط.
   ثم «صوّر الباركود بدل ذلك» (صورة تُقرأ)، وصورة بلا باركود، وجهاز بلا كاميرا،
   وقارئ بلوتوث يكتب الرمز في خانة البحث ثم Enter.
     node tools/test-scan.js            (يحتاج ffmpeg؛ QI_SHOTS=مجلد للصور)
   ============================================================ */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { chromium, devices } = require('playwright-core');
const C = require('./fake-cloud');

const ROOT = path.join(__dirname, '..'), SITE = path.join(ROOT, 'site');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.QI_SHOTS || '';
const KEY = 'test-scan-key';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(c, name, d) {
  if (c) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (d === undefined ? '' : ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500))); }
}
const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
/* سياسة أمان الموقع كما في netlify.toml: القارئ يعمل بها، لا بدونها */
const CSP = "default-src 'self'; connect-src *; img-src 'self' data:; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function site(cfg) {
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/config.js') { s.writeHead(200, { 'content-type': MIME['.js'] }); return s.end('window.MAKTABA_CONFIG = ' + JSON.stringify(cfg) + ';'); }
    const f = path.join(SITE, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1)));
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'content-security-policy': CSP });
    s.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' })));
}
function ean13(d12) { let s = 0; for (let i = 0; i < 12; i++) s += (+d12[i]) * (i % 2 ? 3 : 1); return d12 + ((10 - s % 10) % 10); }
function ean8(d7) { let s = 0; for (let i = 0; i < 7; i++) s += (+d7[i]) * (i % 2 ? 1 : 3); return d7 + ((10 - s % 10) % 10); }

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qsc-'));
  const cloud = await C.start({ secret: KEY });
  let st = null;
  const browsers = [];
  try {
    const BOOK = ean13('978995912345'), LABEL = 'K0042', PEN = ean8('5012345');
    const td = new Date().toISOString().slice(0, 10);
    const snap = { branch: { id: 'misrata', name: 'دار الحكمة', city: 'مصراتة' }, at: td + ' 00:00', whs: [], msgs: [], acks: {}, phoneSell: true, cust: [], sup: [],
      dash: { today: td, days: {}, recent: [], credit: [], cur: 'د.ل' }, ph: { v: 3, libs: ['A', 'B'], shelves: 6, units: ['قطعة'], bcats: [], scats: [], pubs: [] },
      items: [
        { k: 'K0001', t: 'book', n: 'مقدمة ابن خلدون', a: 'ابن خلدون', b: BOOK, c: 'تاريخ', q: 6, p: 45, m: 1, l: 'A', s: '2' },
        { k: LABEL, t: 'book', n: 'كتاب بلاصقة المنظومة', a: '', b: '', c: 'متنوع', q: 3, p: 12, m: 0, l: 'B', s: '1' },
        { k: 'Q0001', t: 'stat', n: 'قلم حبر أزرق', a: 'بايلوت', b: PEN, c: 'أقلام', q: 40, p: 2.5, m: 5, loc: 'الدرج 1', u: 'قطعة' },
        { k: 'K0002', t: 'book', n: 'كتاب آخر', a: '', b: '9780000000002', c: 'متنوع', q: 2, p: 10, m: 0, l: 'A', s: '1' }
      ] };
    await fetch(cloud.url + '/put', { method: 'POST', headers: { 'X-Shop-Key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(snap) });
    st = await site({ url: '', key: '', branch: 'misrata', theme: 'green', name: 'دار الحكمة', city: 'مصراتة' });

    /* ---------- الباركودات: تُرسم بمكتبة اللاصقات نفسها، ثم فيديو للكاميرا ---------- */
    console.log('يرسم الباركودات ويجهّز فيديو الكاميرا…');
    const drawB = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    browsers.push(drawB);
    const dp = await drawB.newPage({ viewport: { width: 1280, height: 720 } });
    await dp.setContent('<html><body style="margin:0;background:#fff"><canvas id="c"></canvas></body></html>');
    await dp.addScriptTag({ path: path.join(ROOT, 'app', 'js', 'jsbarcode.js') });
    /* إطار 1280×720 أبيض والباركود في وسطه بعرض ما يظهر في شاشة الهاتف الطولية (الفيديو يُقصّ ليملأها) */
    const frame = async (code, format, file, blank) => {
      const b64 = await dp.evaluate(([code, format, blank]) => {
        const bc = document.createElement('canvas');
        if (!blank) JsBarcode(bc, code, { format: format, width: format === 'CODE128' ? 3 : 3, height: 150, margin: 24, displayValue: true, fontSize: 22 });
        const c = document.getElementById('c'); c.width = 1280; c.height = 720;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1280, 720);
        if (!blank) g.drawImage(bc, Math.round((1280 - bc.width) / 2), Math.round((720 - bc.height) / 2));
        else { g.fillStyle = '#333'; g.font = '40px sans-serif'; g.fillText('no barcode here', 480, 360); }
        return c.toDataURL('image/png').split(',')[1];
      }, [code, format, !!blank]);
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      return file;
    };
    const png = { book: await frame(BOOK, 'EAN13', path.join(tmp, 'book.png')), label: await frame(LABEL, 'CODE128', path.join(tmp, 'label.png')),
      pen: await frame(PEN, 'EAN8', path.join(tmp, 'pen.png')), blank: await frame('', '', path.join(tmp, 'blank.png'), true) };
    await drawB.close();
    const video = (img, out) => { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', img, '-t', '1', '-r', '10', '-pix_fmt', 'yuv420p', '-s', '1280x720', out]); return out; };
    const vid = { book: video(png.book, path.join(tmp, 'book.y4m')), label: video(png.label, path.join(tmp, 'label.y4m')) };
    ok(fs.statSync(vid.book).size > 1e6 && fs.statSync(vid.label).size > 1e6, 'باركود EAN-13 (' + BOOK + ') وCODE128 (' + LABEL + ') صارا فيديو للكاميرا');

    const errs = [];
    const open = async (cam) => {
      const args = ['--no-sandbox'];
      if (cam) args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + cam);
      const b = await chromium.launch({ executablePath: CHROME, args });
      browsers.push(b);
      const ctx = await b.newContext({ ...devices['iPhone 13'], permissions: cam ? ['camera'] : [] });
      const p = await ctx.newPage();
      p.on('pageerror', e => errs.push(e.message));
      p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|net::|status of 401/.test(m.text())) errs.push('console: ' + m.text()); });
      await p.goto(st.url + '#u=' + encodeURIComponent(cloud.url) + '&k=' + encodeURIComponent(KEY));
      await p.waitForSelector('#pw2', { timeout: 30000 });
      await p.fill('#pw', '1357'); await p.fill('#pw2', '1357'); await p.click('[data-a="pinSet"]');
      await p.waitForSelector('.menu'); await sleep(700);
      await p.evaluate(() => { const s = document.getElementById('sheet'); s.hidden = true; s.innerHTML = ''; });
      return p;
    };
    const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
    const tab = async (p, k) => { await p.click('.nav [data-tab="' + k + '"]'); await sleep(200); };
    const closed = p => p.waitForFunction(() => !document.querySelector('.scanner'), null, { timeout: 20000 }).then(() => true, () => false);

    console.log('\n== الكاميرا ترى باركود كتاب (EAN-13) ==');
    let p = await open(vid.book);
    await tab(p, 'sell');
    let t0 = Date.now();
    await p.click('.scanbig');
    await p.waitForSelector('.scanner .sc-video');
    const live = await p.waitForFunction(() => { const v = document.querySelector('.sc-video'); return v && v.videoWidth > 0; }, null, { timeout: 15000 }).then(() => true, () => false);
    ok(live, 'زر المسح يفتح الكاميرا داخل الصفحة والصورة تعمل');
    await shot(p, 's1-camera');
    await p.waitForFunction(() => Core.S.cart.length === 1, null, { timeout: 30000 }).catch(() => { });
    const c1 = await p.evaluate(() => Core.S.cart.map(l => l.n + '×' + l.q));
    ok(c1.join() === 'مقدمة ابن خلدون×1', 'البيع: الكاميرا قرأت الباركود وحدها وأضافت الكتاب للسلة (' + ((Date.now() - t0) / 1000).toFixed(1) + ' ث مع تحميل القارئ)', c1);
    ok(await closed(p), 'والكاميرا تُغلق بعد القراءة');
    await shot(p, 's2-cart');
    t0 = Date.now();
    await p.click('.scanbig');
    await p.waitForFunction(() => Core.S.cart[0] && Core.S.cart[0].q === 2, null, { timeout: 20000 }).catch(() => { });
    ok(await p.evaluate(() => Core.S.cart[0].q) === 2, 'المسحة الثانية تزيد الكمية (' + ((Date.now() - t0) / 1000).toFixed(1) + ' ث والقارئ محمّل)');
    await closed(p);

    await tab(p, 'items'); await p.waitForSelector('#iq');
    await p.click('.srch .cam');
    await p.waitForSelector('.ihead', { timeout: 20000 }).catch(() => { });
    ok(/مقدمة ابن خلدون/.test(await p.evaluate(() => (document.querySelector('.ihead h2') || {}).textContent || '')), 'عرض وتعديل: المسح يفتح بطاقة الكتاب');
    await closed(p);
    await p.click('.bar [data-a="back"]'); await p.waitForSelector('#iq');

    await p.click('[data-a="imode"][data-v="qty"]'); await sleep(200);
    await p.click('.scanbig');
    await p.waitForFunction(() => Core.S.recv.lines.length === 1 && Core.S.recv.lines[0].q >= 2, null, { timeout: 30000 }).catch(() => { });
    const rv = await p.evaluate(() => Core.S.recv.lines.map(l => l.n + '×' + l.q));
    ok(rv.length === 1 && /مقدمة ابن خلدون×[2-9]/.test(rv[0]), 'إضافة كمية: المسح يضيف سطراً، والكاميرا تفتح وحدها للقطعة التالية فتزيده', rv);
    await p.evaluate(() => WebScan.close()); await sleep(900);
    await p.evaluate(() => WebScan.close());
    await p.click('[data-a="rClear"]');

    await p.click('[data-a="imode"][data-v="new"]'); await sleep(200);
    await p.click('[data-a="fScan"]');
    await p.waitForFunction(() => (document.querySelector('[data-f="bc"]') || {}).value, null, { timeout: 20000 }).catch(() => { });
    ok(await p.inputValue('[data-f="bc"]') === BOOK && /مستعمل في: مقدمة ابن خلدون/.test(await p.textContent('#fe_bc')), 'صنف جديد: زر «امسح» يملأ خانة الباركود من الكاميرا، ويقول إن الباركود مستعمل في كتاب موجود');
    await closed(p);
    await p.fill('[data-f="bc"]', '');
    await p.click('[data-a="imode"][data-v="view"]');

    await tab(p, 'home');
    await p.click('.menu [data-v="count"]'); await p.waitForSelector('#shIn');
    await p.click('.scanbig');
    await p.waitForFunction(() => Core.S.loc.list.length === 1 && Core.S.loc.list[0].c >= 3, null, { timeout: 40000 }).catch(() => { });
    const cn = await p.evaluate(() => Core.S.loc.list.map(x => x.n + '×' + x.c));
    ok(cn.length === 1 && /مقدمة ابن خلدون×[3-9]/.test(cn[0]), 'الجرد: كل قراءة نسخة، والكاميرا تفتح وحدها للنسخة التالية (ثلاث نسخ بلا لمس)', cn);
    await shot(p, 's3-count');
    await p.evaluate(() => WebScan.close()); await sleep(900);
    await p.evaluate(() => WebScan.close());

    await tab(p, 'home');
    const q0 = await p.evaluate(() => Core.S.cart[0].q);
    await p.click('.nav .fab');
    await p.waitForFunction(q => Core.S.cart[0] && Core.S.cart[0].q === q + 1, q0, { timeout: 20000 }).catch(() => { });
    ok(await p.evaluate(() => UI.__v.screen === 'sell' && Core.S.cart[0].q) === q0 + 1, 'زر المسح الأوسط من الرئيسية: يفتح البيع ويمسح ويضيف');
    await closed(p);
    /* المسح المتواصل في البيع (من الإعدادات) */
    await p.evaluate(() => Core.setPref('cont', true));
    await p.click('.scanbig');
    await p.waitForFunction(q => Core.S.cart[0] && Core.S.cart[0].q >= q + 3, q0, { timeout: 30000 }).catch(() => { });
    ok(await p.evaluate(() => Core.S.cart[0].q) >= q0 + 3, '«المسح المتواصل في البيع»: الكاميرا تفتح وحدها بعد كل كتاب');
    await p.evaluate(() => WebScan.close()); await sleep(900);
    await p.evaluate(() => { WebScan.close(); Core.setPref('cont', false); });
    await browsers.pop().close();

    console.log('\n== الكاميرا ترى لاصقة المنظومة (CODE128 برمز الصنف) ==');
    p = await open(vid.label);
    await tab(p, 'items'); await p.waitForSelector('#iq');
    await p.click('.srch .cam');
    await p.waitForSelector('.ihead', { timeout: 30000 }).catch(() => { });
    ok(/كتاب بلاصقة المنظومة/.test(await p.evaluate(() => (document.querySelector('.ihead h2') || {}).textContent || '')), 'لاصقة CODE128 برمز الصنف (' + LABEL + '): تُقرأ ويُفتح الكتاب برمزه');
    await closed(p);

    console.log('\n== «صوّر الباركود بدل ذلك»: صورة تُقرأ ==');
    await p.click('.bar [data-a="back"]'); await p.waitForSelector('#iq');
    await p.click('[data-a="itype"][data-v="stat"]');
    /* الكاميرا الحيّة ترى اللاصقة: نوقف القراءة الحيّة بإخفاء الصفحة عن القارئ؟ لا — نختبر الصورة في جهاز بلا كاميرا */
    await browsers.pop().close();

    p = await open(null);
    await tab(p, 'items'); await p.waitForSelector('#iq');
    await p.click('.srch .cam');
    await p.waitForFunction(() => { const s = document.querySelector('.scanner'); return s && s.classList.contains('sc-nocam'); }, null, { timeout: 15000 }).catch(() => { });
    const nocam = await p.evaluate(() => (document.querySelector('.sc-msg') || {}).textContent || '');
    ok(/صوّر الباركود/.test(nocam) && !!(await p.$('.sc-file')), 'جهاز بلا كاميرا (أو مُنعت): لا يتعطّل — يقول «صوّر الباركود بالزر تحت»', nocam);
    await shot(p, 's4-nocam');
    await p.setInputFiles('.sc-file', png.blank);
    await p.waitForFunction(() => /ما قريناش باركود/.test((document.querySelector('.sc-msg') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => { });
    ok(/ما قريناش باركود/.test(await p.evaluate(() => (document.querySelector('.sc-msg') || {}).textContent || '')) && !!(await p.$('.scanner')), 'صورة بلا باركود: «ما قريناش باركود في الصورة» وتبقى الشاشة للمحاولة');
    await p.setInputFiles('.sc-file', png.pen);
    await p.waitForSelector('.ihead', { timeout: 20000 }).catch(() => { });
    ok(/قلم حبر أزرق/.test(await p.evaluate(() => (document.querySelector('.ihead h2') || {}).textContent || '')), 'صورة باركود EAN-8 (' + PEN + '): تُقرأ ويُفتح صنف القرطاسية');
    await p.click('.bar [data-a="back"]'); await p.waitForSelector('#iq');
    await p.click('.srch .cam'); await p.waitForSelector('.sc-file');
    await p.setInputFiles('.sc-file', png.book);
    await p.waitForSelector('.ihead', { timeout: 20000 }).catch(() => { });
    ok(/مقدمة ابن خلدون/.test(await p.evaluate(() => (document.querySelector('.ihead h2') || {}).textContent || '')), 'وصورة باركود الكتاب EAN-13 تُقرأ كذلك');
    await p.click('.bar [data-a="back"]'); await p.waitForSelector('#iq');
    /* باركود غير مسجّل: يُعرض «صنف جديد بهذا الباركود» */
    await p.evaluate(() => UI.onScan('9781234567897')); await sleep(300);
    ok(/لا صنف بهذا الباركود/.test(await p.textContent('#sheet')) && !!(await p.$('[data-a="newWith"]')), 'باركود غير مسجّل: «لا صنف بهذا الباركود» مع «كتاب جديد بهذا الباركود»');
    await p.click('[data-a="newWith"][data-v^="book"]'); await sleep(400);
    ok(await p.inputValue('[data-f="bc"]') === '9781234567897' && await p.evaluate(() => UI.__v.mode) === 'new', 'والضغط عليه يفتح «صنف جديد» والباركود مكتوب');
    await p.fill('[data-f="bc"]', '');

    console.log('\n== قارئ بلوتوث: يكتب الرمز في خانة البحث ثم Enter ==');
    await tab(p, 'sell');
    await p.evaluate(() => { Core.S.cart = []; Core.save(); UI.render(); });
    await p.fill('#sq', PEN); await p.press('#sq', 'Enter'); await sleep(300);
    ok((await p.evaluate(() => Core.S.cart.map(l => l.n))).join() === 'قلم حبر أزرق', 'البيع: الرمز + Enter يضيف الصنف للسلة');
    await p.fill('#sq', 'K0042'); await p.press('#sq', 'Enter'); await sleep(300);
    ok(await p.evaluate(() => Core.S.cart.length) === 2, 'ورمز الصنف (لاصقة المنظومة) كذلك');
    await p.fill('#sq', '١٢٣'); await p.press('#sq', 'Enter'); await sleep(300);
    ok(await p.evaluate(() => Core.S.cart.length) === 2, 'ورمز غير موجود لا يضيف شيئاً');

    ok(errs.length === 0, 'بلا أخطاء في الصفحات (ولا مخالفة لسياسة أمان الموقع)', errs.slice(0, 5));
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
  } finally {
    for (const b of browsers) { try { await b.close(); } catch (e) { } }
    if (st) st.srv.close();
    await cloud.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n==================================================');
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})();
