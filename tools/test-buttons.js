/* ============================================================
   test-buttons.js — كل زر في المنظومتين وتطبيق الهاتف
   ------------------------------------------------------------
   المحرك الحقيقي لمصراتة ولطرابلس (بيانات المولّد)، وتطبيق الهاتف على
   خادم ربط حقيقي (fake-cloud). كل صفحة وكل تبويب في الإعدادات، وكل زر
   فيها يُضغط كما يضغطه المستخدم، ثم كل زر في النافذة التي يفتحها:
     • ما حدث: نافذة، تنبيه، انتقال، طباعة، تنزيل ملف، اختيار ملف، نداء
       للبرنامج، أو تغيّر المعروض. لا شيء من ذلك = زر لا يعمل.
     • أي خطأ في الشاشة، ونداء للبرنامج ردّ بخطأ، وأخطاء سجل البرنامج.
   المسح الكامل وإلغاء التثبيت والاستعادة وتبديل جهاز المحل لا تُؤكَّد هنا
   (لها اختباراتها: test.js وtest-x3.js)، ويُكتفى بأنها تسأل قبل التنفيذ.
     node tools/test-buttons.js        QI_REPORT=ملف.txt يكتب الجدول كاملاً
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { chromium, devices } = require('playwright-core');
const E = require('./engine');
const C = require('./fake-cloud');
const { generate } = require('./gen/generate');

const ROOT = path.join(__dirname, '..'), SITE = path.join(ROOT, 'site');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const REPORT = process.env.QI_REPORT || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(c, name, d) {
  if (c) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (d === undefined ? '' : ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 900))); }
  return !!c;
}
const lines = [];
const out = s => { lines.push(s); };

/* ما يُرصد في الصفحة: الطباعة، النوافذ الخارجية، التنزيل، اختيار ملف، نداءات البرنامج، وتغيّر المعروض */
const INSTRUMENT = () => {
  window.__ev = { prints: 0, opens: 0, downloads: 0, files: 0, api: [], bad: [], mut: 0 };
  window.print = () => { window.__ev.prints++; };
  window.open = () => { window.__ev.opens++; return null; };
  const of = window.fetch;
  window.fetch = function (u) {
    let s = '';
    try { s = String(u && u.url || u); } catch (e) { }
    const p = of.apply(this, arguments);
    if (/\/api\//.test(s)) {
      const k = s.replace(/^.*\/api/, '/api').split('?')[0];
      window.__ev.api.push(k);
      p.then(r => { if (r.status >= 400 && r.status !== 409) window.__ev.bad.push(k + ' ' + r.status); }, () => { });
    }
    return p;
  };
  const ic = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () { if (this.type === 'file') { window.__ev.files++; return; } return ic.apply(this, arguments); };
  const ac = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download || /^(blob|data):/.test(this.href)) { window.__ev.downloads++; return; } return ac.apply(this, arguments); };
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(l => { window.__ev.mut += l.length; }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'style', 'value', 'disabled'] });
  });
  /* أزرار الهاتف التي تشترك في فعل واحد وتختلف بقيمتها (تبويبات، أوضاع، اختيارات): كل قيمة زر */
  window.__byV = /^(go|meth|filt|lib|imode|itype|iview|open2|pPick|pSet|alTab|invTab|debtTab|outTab|fSet|fPick|rDst|aqDst|aqStep|fStep|shelf)$/;
  /* العناصر القابلة للضغط في مكان، وكل نوع مرة (أزرار الصفوف المتشابهة زر واحد) */
  window.__vis = e => {
    if (e.disabled || e.closest('[hidden]')) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  };
  window.__collect = (sel) => {
    const root = document.querySelector(sel);
    if (!root) return [];
    const els = [...root.querySelectorAll('button, [onclick], a[href^="#"], [data-a]')].filter(window.__vis);
    const seen = new Set(), list = [];
    els.forEach(e => {
      const oc = e.getAttribute('onclick') || '', da = e.getAttribute('data-a') || '';
      const txt = (e.textContent || e.title || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 48);
      const norm = oc.replace(/'[^']*'|"[^"]*"/g, "'…'").replace(/\d+/g, 'N');
      const key = e.tagName + '|' + norm + '|' + da + (oc || da ? '' : '|' + txt) + (window.__byV.test(da) ? '|' + (e.getAttribute('data-v') || '') : '');
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ key, oc, da, txt: txt || oc.slice(0, 40) || da, on: /(^|\s)(on|active|sel)(\s|$)/.test(e.className || '') || e.getAttribute('aria-selected') === 'true' });
    });
    return list;
  };
  window.__mark = (sel, key) => {
    document.querySelectorAll('[data-crawl]').forEach(e => e.removeAttribute('data-crawl'));
    const root = document.querySelector(sel);
    if (!root) return false;
    const want = window.__collect(sel).find(x => x.key === key);
    if (!want) return false;
    const els = [...root.querySelectorAll('button, [onclick], a[href^="#"], [data-a]')].filter(window.__vis);
    for (const e of els) {
      const oc = e.getAttribute('onclick') || '', da = e.getAttribute('data-a') || '';
      const txt = (e.textContent || e.title || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 48);
      const norm = oc.replace(/'[^']*'|"[^"]*"/g, "'…'").replace(/\d+/g, 'N');
      const k = e.tagName + '|' + norm + '|' + da + (oc || da ? '' : '|' + txt) + (window.__byV.test(da) ? '|' + (e.getAttribute('data-v') || '') : '');
      if (k === key && !e.disabled) { e.setAttribute('data-crawl', '1'); return true; }
    }
    return false;
  };
};

/* لا تُؤكَّد هنا: تمسح كل شيء، أو تعيد تشغيل البرنامج، أو تغيّر دور الجهاز */
const SKIP1 = /Rep\.wipeAll|Rep\.uninstall|Rep\.restore\(|App\.takeOver|location\.reload|App\.retryConnect|Staff\.logout|Staff\.lock\(/;
const SKIP2 = /مسح جميع|مسح كل|إلغاء التثبيت|استعادة|هذا جهاز المحل|جهاز ثان|فك الربط|تحكّم من|نعم، امسح/;
const CANCEL = /^(✕|إلغاء|إغلاق|لا|لا، .*|رجوع|تراجع)$/;

(async () => {
  const tmp = fs.mkdtempSync(path.join(process.env.SIM_TMP || os.tmpdir(), 'qbt-'));
  let browser = null;
  const engines = [], servers = [];
  let cloud = null;
  const dead = [], broken = [], skipped = [];
  let clicks = 0;

  async function desktop(edition, store, title) {
    const dir = path.join(tmp, edition), home = path.join(tmp, edition + '-h');
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true }); fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(dir, 'data', 'store.json'), JSON.stringify(store));
    E.buildEngine(dir, edition);
    const proc = E.startEngine(dir, home);
    engines.push(proc);
    const port = await E.waitPort(dir);
    const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    await pg.addInitScript(INSTRUMENT);
    pg.on('pageerror', e => errs.push('خطأ: ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|net::ERR/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
    pg.on('dialog', x => x.accept().catch(() => { }));
    await pg.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.App && App.S && App.S.books && window.Sales && window.Rep && App.S.meta && App.S.meta.setupDone, null, { timeout: 120000 });
    await sleep(1500);
    const ev = (f, a) => pg.evaluate(f, a);
    const views = [];
    const nav = await ev(() => [...document.querySelectorAll('#nav .nav-item')].map(b => ({ k: b.dataset.k, t: b.textContent.trim().replace(/\s+/g, ' ') })));
    for (const n of nav) {
      if (n.k === 'settings') {
        await ev(() => { location.hash = '#/settings'; App.route(); }); await sleep(300);
        const tabs = await ev(() => [...document.querySelectorAll('[data-tab]')].map(b => ({ k: b.dataset.tab, t: b.textContent.trim() })));
        for (const t of tabs) views.push({ name: 'الإعدادات ← ' + t.t, go: { hash: '#/settings', tab: t.k } });
      } else views.push({ name: n.t, go: { hash: '#/' + n.k } });
    }
    /* صفحات داخلية: غرفة الخزين وطلبات التحويل، وأوضاع إدخال البضاعة، وفاتورة مفتوحة */
    views.push({ name: 'المخزون ← غرفة الخزين', go: { hash: '#/stock', js: "Stock.open('room')" } });
    views.push({ name: 'المخزون ← طلبات التحويل', go: { hash: '#/stock', js: 'Stock.openRequests()' } });
    for (const [t, m, nm] of [['book', 'view', 'كتب ← عرض وتعديل'], ['stat', 'view', 'قرطاسية ← عرض وتعديل'], ['book', 'add', 'كتب ← إضافة'], ['book', 'new', 'كتب ← جديد']])
      views.push({ name: 'إدخال بضاعة ← ' + nm, go: { hash: '#/purchases', js: "Inv.gset('type','" + t + "');Inv.gset('mode','" + m + "')" } });
    /* الأرباح مفتوحة بالرمز (الافتراضي في Program.cs حتى يغيّره صاحب المحل) */
    for (const [k, nm] of [['sum', 'ملخص الأرباح'], ['rep', 'التقارير'], ['stk', 'جرد بالأرباح']])
      views.push({ name: 'الأرباح (مفتوحة) ← ' + nm, go: { hash: '#/profits', js: "Rep.setPv('" + k + "')", profit: true } });
    if (process.env.QI_VIEWS) { const re = new RegExp(process.env.QI_VIEWS); for (let i = views.length - 1; i >= 0; i--) if (!re.test(views[i].name)) views.splice(i, 1); }

    const goto = async v => {
      if (v.go.profit) await ev(() => App.unlockProfit('Rtv8ss3i'));
      await ev(g => {
        const h = document.getElementById('modalHost'); if (h) h.innerHTML = '';
        document.querySelectorAll('.overlay,.done-pop,.celebrate').forEach(e => e.remove());
        document.getElementById('toasts').innerHTML = '';
        location.hash = g.hash; App.route();
        if (g.tab) Rep.setTab(g.tab);
        if (g.js) { try { (0, eval)(g.js); } catch (e) { } }
      }, v.go);
      await sleep(250);
      /* قفل الموظفين (لو فُعّل من زر): لا يُختبر هنا */
      if (await pg.$('.staff-lock')) await ev(() => { App.S.staff = []; App.save(); location.reload(); }).catch(() => { });
    };
    const state = () => ev(() => ({
      modals: document.querySelectorAll('#modalHost .overlay').length,
      title: ((document.querySelector('#modalHost .overlay:last-child .m-head h3') || {}).textContent || '').trim(),
      toasts: [...document.querySelectorAll('#toasts > *')].map(t => (t.className.replace(/toast|\s/g, '') ? '[' + t.className.replace('toast', '').trim() + '] ' : '') + t.textContent.trim()),
      hash: location.hash, ev: JSON.parse(JSON.stringify(window.__ev))
    }));
    const reset = () => ev(() => { const e = window.__ev; e.prints = e.opens = e.downloads = e.files = e.mut = 0; e.api = []; e.bad = []; document.getElementById('toasts').innerHTML = ''; });
    const describe = (b, a) => {
      const r = [];
      if (a.modals > b.modals) r.push('نافذة «' + a.title + '»');
      if (a.hash !== b.hash) r.push('ينقل إلى ' + a.hash);
      if (a.ev.prints) r.push('طباعة');
      if (a.ev.downloads) r.push('تنزيل ملف');
      if (a.ev.files) r.push('اختيار ملف');
      if (a.ev.opens) r.push('يفتح رابطاً');
      if (a.toasts.length) r.push('تنبيه: ' + a.toasts.join(' / ').slice(0, 120));
      if (!r.length && a.ev.api.length) r.push('نداء: ' + [...new Set(a.ev.api)].join(' '));
      if (!r.length && a.ev.mut > 0) r.push('يتغيّر المعروض');
      return r.join('، ');
    };
    async function press(v, x, scope, path0) {
      if (!(await ev(([s, k]) => window.__mark(s, k), [scope, x.key]))) return { lost: true };
      await reset();
      const b = await state();
      const e0 = errs.length;
      try { await pg.click('[data-crawl="1"]', { timeout: 2500 }); }
      catch (e) {
        /* مغطّى أو خارج الشاشة: يُضغط برمجياً، ويُسجَّل */
        await ev(() => { const el = document.querySelector('[data-crawl="1"]'); if (el) el.click(); });
        x.note = 'لم يُضغط باليد (مغطّى أو خارج الشاشة)';
      }
      clicks++;
      await sleep(450);
      const a = await state();
      const what = describe(b, a);
      const er = errs.slice(e0).concat(a.ev.bad.map(z => 'ردّ ' + z));
      const line = (path0 ? path0 + ' ← ' : '') + x.txt;
      out(title + ' | ' + v.name + ' | ' + line + ' | ' + (what || (x.on ? 'مختار أصلاً' : 'لا شيء')) + (x.note ? ' | ' + x.note : '') + (er.length ? ' | أخطاء: ' + er.join(' ؛ ') : ''));
      if (er.length) broken.push(title + ' — ' + v.name + ' — ' + line + ': ' + er.join(' ؛ '));
      else if (!what && !x.on) dead.push(title + ' — ' + v.name + ' — ' + line);
      return { a, b, what };
    }
    for (const v of views) {
      await goto(v);
      const list = await ev(() => window.__collect('#view'));
      const t0 = Date.now(), c0 = clicks;
      process.stdout.write('  ' + v.name + ': ' + list.length + ' زر… ');
      for (const x of list) {
        if (SKIP1.test(x.oc)) { skipped.push(title + ' — ' + v.name + ' — ' + x.txt); out(title + ' | ' + v.name + ' | ' + x.txt + ' | تخطّي (يمسح أو يعيد التشغيل)'); continue; }
        await goto(v);
        const r = await press(v, x, '#view', '');
        if (!r || r.lost) continue;
        /* النافذة التي فتحها: كل زر فيها (إلا الإغلاق) */
        if (r.a.modals > r.b.modals) {
          const inner = (await ev(() => window.__collect('#modalHost .overlay:last-child'))).filter(y => !CANCEL.test(y.txt) && !/\[data-x\]/.test(y.key));
          const title2 = r.a.title;
          for (const y of inner.slice(0, 6)) {
            if (SKIP2.test(y.txt) || SKIP2.test(title2) && /primary|danger/.test(y.key + y.oc) ) { skipped.push(title + ' — ' + v.name + ' — ' + x.txt + ' ← ' + y.txt); out(title + ' | ' + v.name + ' | ' + x.txt + ' ← ' + y.txt + ' | تخطّي (لا يُؤكَّد هنا)'); continue; }
            await goto(v);
            if (!(await ev(([s, k]) => window.__mark(s, k), ['#view', x.key]))) continue;
            await pg.click('[data-crawl="1"]', { timeout: 2500 }).catch(() => ev(() => { const el = document.querySelector('[data-crawl="1"]'); if (el) el.click(); }));
            await sleep(350);
            if (!(await ev(() => document.querySelectorAll('#modalHost .overlay').length))) continue;
            await press(v, y, '#modalHost .overlay:last-child', x.txt);
          }
        }
      }
      console.log((clicks - c0) + ' ضغطة في ' + ((Date.now() - t0) / 1000).toFixed(0) + ' ث');
    }
    await goto({ go: { hash: '#/dash' } });
    ok(true, title + ': ' + views.length + ' صفحة وتبويباً');
    const lg = fs.readFileSync(path.join(dir, 'data', 'log.txt'), 'utf8').split('\n').filter(l => /Exception|   at /.test(l));
    ok(lg.length === 0, title + ': سجل البرنامج بلا أخطاء داخلية بعد ضغط كل الأزرار', lg.slice(0, 4));
    await pg.close();
  }

  try {
    /* كاميرا وهمية: أزرار المسح في الهاتف تفتح الكاميرا فعلاً */
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

    console.log('\n== مصراتة ==');
    generate({ profile: 'misrata', store3: 1, out: path.join(tmp, 'gm') });
    const mis = JSON.parse(fs.readFileSync(path.join(tmp, 'gm', 'store3.json'), 'utf8'));
    mis.branch = { id: 'misrata', name: 'دار الحكمة — مصراتة', city: 'مصراتة', no: 1 };
    mis.invoices = mis.invoices.slice(0, 1500);
    mis.books.slice(200, 230).forEach((b, i) => { b.store = 3 + i % 5; b.min = 2; });
    mis.suppliers = [{ id: 'sup1', name: 'دار الفكر', phone: '0912223344', opening: 500, created: '2026-01-05 10:00' }];
    mis.purchases = [{ id: 'pu1', date: '2026-03-01', at: '2026-03-01 11:00', supplierId: 'sup1', note: '', pay: 'credit', total: 300, lines: [{ type: 'book', id: mis.books[3].id, name: mis.books[3].title, qty: 5, cost: 3 }] }];
    mis.consignors = [{ id: 'own1', name: 'د. عبد السلام', phone: '', note: '', at: '2026-03-01 10:00' }];
    mis.consignments = [{ id: 'cn1', ownerId: 'own1', itemId: mis.books[100].id, type: 'book', title: mis.books[100].title, author: '', code: mis.books[100].code, qty: 10, sold: 2, returned: 0, price: 30, ownerPrice: 22, at: '2026-03-02', note: '' }];
    mis.consPayments = [];
    const ONLY = process.env.QI_ONLY || '';          // misrata | tripoli | phone: جزء واحد
    if (!ONLY || ONLY === 'misrata') await desktop('misrata', mis, 'مصراتة');

    if (!ONLY || ONLY === 'tripoli') {
    console.log('\n== طرابلس ==');
    generate({ profile: 'tripoli', books: 3000, stationery: 300, years: 1, store3: 1, out: path.join(tmp, 'gt') });
    const tri = JSON.parse(fs.readFileSync(path.join(tmp, 'gt', 'store3.json'), 'utf8'));
    tri.branch = { id: 'tripoli', name: 'دار الحكمة — طرابلس', city: 'طرابلس', no: 2 };
    tri.invoices = tri.invoices.slice(0, 800);
    await desktop('tripoli', tri, 'طرابلس');
    }

    if (!ONLY || ONLY === 'phone') {
    console.log('\n== تطبيق الهاتف (مصراتة) ==');
    const KEY = 'btn-key';
    cloud = await C.start({ secret: KEY });
    const td = new Date().toISOString().slice(0, 10);
    const snap = {
      branch: { id: 'misrata', name: 'دار الحكمة', city: 'مصراتة' }, at: td + ' 00:00', whs: [], msgs: [], acks: {}, phoneSell: true,
      items: mis.books.slice(0, 600).map(b => ({ k: b.code, t: 'book', n: b.title, a: b.author || '', b: b.barcode || '', c: b.cat || '', q: b.qty || 0, p: b.price || 0, m: b.min || 0, l: b.lib || '', s: String(b.shelf || ''), d: b.publisher || '' }))
        .concat(mis.stationery.slice(0, 80).map(x => ({ k: x.code, t: 'stat', n: x.name, a: x.brand || '', b: x.barcode || '', c: x.cat || '', q: x.qty || 0, p: x.price || 0, m: x.min || 0, loc: x.loc || '', u: x.unit || 'قطعة' }))),
      cust: [{ id: 'c1', n: 'مكتبة النور', ph: '0912345678', b: 120 }, { id: 'c2', n: 'أحمد علي', ph: '', b: 0 }],
      sup: [{ id: 'sp1', n: 'دار الفكر', ph: '0913334444', b: 800 }],
      ph: { v: 3, libs: mis.meta.libraries || ['A', 'B', 'C'], shelves: mis.meta.shelves || 6, units: ['قطعة', 'علبة'], bcats: mis.meta.bookCats || [], scats: mis.meta.statCats || [], pubs: ['دار الفكر'] },
      dash: { today: td, days: { [td]: { v: 450, n: 9, q: 14 } }, cur: 'د.ل',
        recent: [{ no: 77, d: td, at: '10:10', t: 35, m: 'cash', k: 'sale', n: 'كتاب', q: 1, li: [['كتاب', 1, 35]] }, { no: 76, d: td, at: '09:30', t: 120, m: 'credit', k: 'sale', c: 'مكتبة النور', n: 'كتب', q: 4, li: [['كتب', 4, 30]], due: 120 }],
        credit: [{ no: 76, d: td, at: '09:30', c: 'مكتبة النور', cid: 'c1', t: 120, pd: 0, due: 120 }] }
    };
    await fetch(cloud.url + '/put', { method: 'POST', headers: { 'X-Shop-Key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(snap) });
    const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
    const srv = http.createServer((q, s) => {
      const u = new URL(q.url, 'http://x');
      if (u.pathname === '/config.js') { s.writeHead(200, { 'content-type': MIME['.js'] }); return s.end('window.MAKTABA_CONFIG = ' + JSON.stringify({ url: '', key: '', branch: 'misrata', theme: 'green', name: 'دار الحكمة', city: 'مصراتة' }) + ';'); }
      const f = path.join(SITE, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1)));
      if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
      s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f));
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    servers.push(srv);
    const pctx = await browser.newContext({ ...devices['iPhone 13'], permissions: ['camera'] });
    const ph = await pctx.newPage();
    const perr = [];
    await ph.addInitScript(INSTRUMENT);
    ph.on('pageerror', e => perr.push('خطأ: ' + e.message));
    ph.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|net::ERR/.test(m.text())) perr.push('console: ' + m.text().slice(0, 200)); });
    ph.on('dialog', x => x.accept().catch(() => { }));
    await ph.goto('http://127.0.0.1:' + srv.address().port + '/#u=' + encodeURIComponent(cloud.url) + '&k=' + encodeURIComponent(KEY));
    await ph.waitForSelector('#pw2', { timeout: 30000 });
    await ph.fill('#pw', '2468'); await ph.fill('#pw2', '2468'); await ph.click('[data-a="pinSet"]');
    await ph.waitForSelector('.nav', { timeout: 30000 });
    await sleep(900);
    const pev = (f, a) => ph.evaluate(f, a);
    await pev(() => { Core.setPref('anim', false); });          // الحركات تؤخّر الضغط الآلي فقط؛ تُختبر في test-phone
    const bcA = snap.items.find(i => i.t === 'book' && i.b && i.q > 2).b, bcB = snap.items.filter(i => i.t === 'book' && i.b && i.q > 2)[1].b;
    /* كل شاشة وكل وضع فيها: كما يصل إليها المستخدم، وبما يُظهر أزرارها كلها (سلة فيها كتاب، قائمة فيها سطر…) */
    const base = () => { Core.S.cart = []; Core.S.recv = { dst: 'shelf', sp: '', nt: '', lines: [] }; Core.S.loc.list = []; Core.S.sell.method = 'cash'; Core.S.draft = {}; UI.__v.q = ''; UI.__v.filt = ''; UI.__v.cat = ''; UI.__v.place = null; UI.__v.mode = 'view'; Core.setPref('type', 'book'); Core.setPref('view', 'list'); };
    const views = [
      ['الرئيسية', () => UI.go('home')],
      ['إضافة وتعديل: قائمة', () => UI.go('items')],
      ['إضافة وتعديل: بطاقات', () => { Core.setPref('view', 'cards'); UI.go('items'); }],
      ['إضافة وتعديل: الرفوف', () => { Core.setPref('view', 'map'); UI.go('items'); }],
      ['إضافة وتعديل: كتب رف', () => { Core.setPref('view', 'map'); UI.go('items'); UI.act('place', '0:0'); }],
      ['إضافة وتعديل: قرطاسية', () => { Core.setPref('type', 'stat'); UI.go('items'); }],
      ['إضافة كمية', b => { UI.__v.mode = 'qty'; UI.go('items'); UI.onScan(b[0]); if (window.WebScan) WebScan.close(); }],
      ['صنف جديد: كتاب', () => { UI.__v.mode = 'new'; UI.go('items'); }],
      ['صنف جديد: قرطاسية', () => { UI.__v.mode = 'new'; Core.setPref('type', 'stat'); UI.go('items'); }],
      ['بطاقة الكتاب', b => { UI.go('items'); UI.onScan(b[0]); }],
      ['تعديل الكتاب', b => { UI.go('items'); UI.onScan(b[0]); UI.act('edit'); }],
      ['البيع', b => { UI.go('sell'); UI.onScan(b[0]); if (window.WebScan) WebScan.close(); }],
      ['البيع الآجل', b => { UI.go('sell'); UI.onScan(b[0]); UI.act('meth', 'credit'); }],
      ['الجرد', b => { UI.go('home'); UI.act('open2', 'count'); UI.onScan(b[1]); if (window.WebScan) WebScan.close(); }],
      ['الفواتير', () => { UI.__v.invTab = 'shop'; UI.go('invoices'); }],
      ['الآجل', () => UI.go('credit')],
      ['الديون', () => { UI.__v.debtTab = 'cust'; UI.go('debts'); }],
      ['التنبيهات', () => UI.go('alerts')],
      ['الإعدادات', () => UI.go('settings')],
      ['سجل الإرسال', () => { UI.go('settings'); UI.act('open2', 'outbox'); }]
    ];
    const pgo = async v => {
      /* الماسح والنافذة التي فتحها زر سابق تُغلق كما يغلقها المستخدم */
      await pev(() => { if (window.WebScan && document.querySelector('.scanner')) WebScan.close(); const s = document.getElementById('sheet'); if (s) { s.hidden = true; s.innerHTML = ''; s.classList.remove('out'); } const d = document.getElementById('donePop'); if (d) d.remove(); document.getElementById('toasts').innerHTML = ''; });
      await pev(base); await pev(v[1], [bcA, bcB]);
      await sleep(180);
      await pev(() => { if (window.WebScan && document.querySelector('.scanner')) WebScan.close(); document.getElementById('toasts').innerHTML = ''; });
    };
    const pstate = () => pev(() => ({
      scan: !!document.querySelector('.scanner'), sheet: !document.getElementById('sheet').hidden, sheetTxt: (document.getElementById('sheet').textContent || '').trim().slice(0, 50),
      done: !!document.getElementById('donePop'),
      toasts: [...document.querySelectorAll('#toasts > *')].map(t => t.textContent.trim()), scr: (window.UI && UI.__v && UI.__v.screen) || '',
      /* ما يتغيّر بلا أثر في الصفحة (قيمة خانة، إعداد، تمرير) */
      st: JSON.stringify([Core.S.cart, Core.S.recv, Core.S.loc, Core.S.pref, Core.S.sell, Core.S.edits.length, Core.S.orders.length, UI.__v.form && UI.__v.form.f, UI.__v.screen, UI.__v.mode, UI.__v.back.length, Math.round(window.pageYOffset),
        [].map.call(document.querySelectorAll('#app input, #sheet input'), i => i.type + ':' + i.value)]),
      ev: JSON.parse(JSON.stringify(window.__ev))
    }));
    const effect = (b, a) => {
      const r = [];
      if (a.sheet && (!b.sheet || a.sheetTxt !== b.sheetTxt)) r.push('نافذة «' + a.sheetTxt + '»');
      if (!a.sheet && b.sheet) r.push('تُغلق النافذة');
      if (a.done && !b.done) r.push('تم البيع ✓');
      if (a.scan && !b.scan) r.push('يفتح الكاميرا');
      if (a.ev.prints) r.push('طباعة');
      if (a.ev.opens) r.push('يفتح رابطاً');
      if (a.toasts.length) r.push('تنبيه: ' + a.toasts.join(' / ').slice(0, 100));
      if (!r.length && a.scr !== b.scr) r.push('يفتح شاشة ' + a.scr);
      if (!r.length && (a.ev.mut > 0 || a.st !== b.st)) r.push('يتغيّر المعروض');
      return r;
    };
    const SKIPP = /unlinkYes|logout|recatYes/;
    const seenNav = new Set();
    const tap = async () => {
      try { await ph.click('[data-crawl="1"]', { timeout: 2500 }); return ''; }
      catch (e) { await pev(() => { const el = document.querySelector('[data-crawl="1"]'); if (el) el.click(); }); return 'لم يُضغط باليد' + (process.env.QI_DEBUG ? ': ' + e.message.split('\n').filter(l => /intercept|not stable|detached|visible|waiting for/.test(l)).slice(-2).join(' / ') : ''); }
    };
    for (const v of views) {
      await pgo(v);
      const list = (await pev(() => window.__collect('#app'))).filter(x => !SKIPP.test(x.da)).filter(x => {
        /* الشريط السفلي وزر التحديث والرجوع يتكرّر في كل شاشة: يكفي مرة */
        if (!/^(go|fab|refresh|back)$/.test(x.da)) return true;
        if (seenNav.has(x.key)) return false;
        seenNav.add(x.key); return true;
      });
      for (const x of list) {
        await pgo(v);
        if (!(await pev(key => window.__mark('#app', key), x.key))) continue;
        await pev(() => { const e = window.__ev; e.prints = e.opens = e.downloads = e.files = e.mut = 0; e.api = []; e.bad = []; });
        const b = await pstate();
        const e0 = perr.length;
        x.note = await tap();
        clicks++;
        await sleep(420);
        const a = await pstate();
        const r = effect(b, a);
        const er = perr.slice(e0);
        const nm = 'الهاتف | ' + v[0] + ' | ' + x.txt + (x.da ? ' [' + x.da + ']' : '');
        out(nm + ' | ' + (r.join('، ') || 'لا شيء') + (x.note ? ' | ' + x.note : '') + (er.length ? ' | أخطاء: ' + er.join(' ؛ ') : ''));
        if (er.length) broken.push(nm + ': ' + er.join(' ؛ ')); else if (!r.length && !x.on) dead.push(nm);
        /* النافذة السفلية التي فتحها الزر: أزرارها كذلك، كل واحد بعد فتحها من جديد */
        if (a.sheet && !b.sheet) {
          const inner = (await pev(() => window.__collect('#sheet'))).filter(y => !SKIPP.test(y.da));
          for (const y of inner) {
            await pgo(v);
            if (!(await pev(key => window.__mark('#app', key), x.key))) break;
            await tap(); await sleep(350);
            if (!(await pev(key => window.__mark('#sheet', key), y.key))) continue;
            await pev(() => { const e = window.__ev; e.prints = e.opens = e.downloads = e.files = e.mut = 0; e.api = []; e.bad = []; });
            const b2 = await pstate(), e1 = perr.length;
            const note = await tap();
            clicks++;
            await sleep(420);
            const a2 = await pstate(), r2 = effect(b2, a2), er2 = perr.slice(e1);
            const nm2 = nm + ' ← ' + y.txt + (y.da ? ' [' + y.da + ']' : '');
            out(nm2 + ' | ' + (r2.join('، ') || 'لا شيء') + (note ? ' | ' + note : '') + (er2.length ? ' | أخطاء: ' + er2.join(' ؛ ') : ''));
            if (er2.length) broken.push(nm2 + ': ' + er2.join(' ؛ ')); else if (!r2.length && !y.on) dead.push(nm2);
          }
        }
      }
    }
    /* الخروج ثم الدخول برمز الهاتف */
    await pgo(['الإعدادات', () => UI.go('settings')]);
    if (await ph.$('[data-a="logout"]:visible')) {
      await ph.click('[data-a="logout"]:visible', { timeout: 5000 }); await sleep(500);
      const back = await ph.waitForSelector('#pw', { timeout: 5000 }).then(() => true, () => false);
      if (back) { await ph.fill('#pw', '2468'); await ph.click('[data-a="pinIn"]:visible', { timeout: 5000 }).catch(() => { }); }
      ok(back && await ph.waitForSelector('.nav', { timeout: 8000 }).then(() => true, () => false), 'الهاتف: «خروج» ثم الدخول برمز الهاتف');
    }
    ok(perr.length === 0, 'الهاتف: بلا أخطاء في الشاشة', perr.slice(0, 4));
    await pctx.close();
    }

    console.log('\n  ضُغط ' + clicks + ' زراً');
    ok(broken.length === 0, 'كل الأزرار بلا أخطاء (' + broken.length + ')', broken.slice(0, 12));
    ok(dead.length === 0, 'لا زر لا يفعل شيئاً (' + dead.length + ')', dead.slice(0, 25));
    console.log('  لم تُؤكَّد هنا (' + skipped.length + '): ' + skipped.slice(0, 12).join(' | '));
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + (e && e.stack || e));
  } finally {
    if (REPORT) fs.writeFileSync(REPORT, lines.join('\n') + '\n');
    if (browser) await browser.close().catch(() => { });
    engines.forEach(p => E.stopEngine(p));
    servers.forEach(s => s.close());
    if (cloud) await cloud.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n==================================================');
  console.log('  نجح: ' + pass + '    فشل: ' + fail);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})();
