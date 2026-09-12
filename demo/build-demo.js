'use strict';
/**
 * يبني نسخة عرض واحدة قائمة بذاتها (ملف HTML واحد) تعمل بدون خادم.
 * تُستخدم للمشاركة عبر رابط مع الزبائن المحتملين.
 */
const fs = require('fs');
const path = require('path');
const { db } = require('../server/db');
const { getSettings } = require('../server/routes/admin');
const { PERMISSIONS } = require('../server/auth');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT_DIR = process.env.DEMO_OUT || path.join(ROOT, 'demo', 'dist');
const DAYS = Number(process.env.DEMO_DAYS || 45);

// ---------- 1) استخراج البيانات ----------
function extract() {
  const cut = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const data = {
    products: all('SELECT * FROM products WHERE active = 1'),
    batches: all('SELECT * FROM batches WHERE qty > 0'),
    categories: all('SELECT * FROM categories'),
    customers: all('SELECT * FROM customers WHERE active = 1'),
    suppliers: all('SELECT * FROM suppliers WHERE active = 1'),
    sales: all('SELECT * FROM sales WHERE date(date) >= date(?)', cut),
    sale_items: all(
      'SELECT si.* FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE date(s.date) >= date(?)', cut),
    sale_returns: all(
      'SELECT r.* FROM sale_returns r JOIN sales s ON s.id = r.sale_id WHERE date(s.date) >= date(?)', cut),
    purchases: all('SELECT * FROM purchases'),
    purchase_items: all('SELECT * FROM purchase_items'),
    expenses: all('SELECT * FROM expenses'),
    payments: all('SELECT * FROM payments')
  };
  const users = db.prepare('SELECT id, username, full_name, role FROM users WHERE active = 1').all()
    .map((u) => ({ ...u, password: '1234', permissions: PERMISSIONS[u.role] || [] }));
  return { data, users, settings: getSettings(), built_at: new Date().toISOString() };
}

// ---------- 2) دمج وحدات ES في ملف واحد ----------
const IMPORT_RX = /^\s*import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm;
const BARE_IMPORT_RX = /^\s*import\s+['"]([^'"]+)['"];?\s*$/gm;

function resolveSpec(spec, fromFile) {
  if (!spec.startsWith('.')) return null;
  let p = path.resolve(path.dirname(fromFile), spec);
  if (!p.endsWith('.js')) p += '.js';
  return p;
}

function collectDeps(entry) {
  const order = [];
  const seen = new Set();
  const visiting = new Set();

  const visit = (file) => {
    if (seen.has(file)) return;
    if (visiting.has(file)) throw new Error('دورة استيراد: ' + file);
    visiting.add(file);
    const src = fs.readFileSync(file, 'utf8');
    const specs = [];
    for (const m of src.matchAll(IMPORT_RX)) specs.push(m[1]);
    for (const m of src.matchAll(BARE_IMPORT_RX)) specs.push(m[1]);
    for (const s of specs) {
      const dep = resolveSpec(s, file);
      if (dep && fs.existsSync(dep)) visit(dep);
    }
    visiting.delete(file);
    seen.add(file);
    order.push(file);
  };
  visit(entry);
  return order;
}

function stripModuleSyntax(src) {
  return src
    .replace(IMPORT_RX, '')
    .replace(BARE_IMPORT_RX, '')
    .replace(/^\s*export\s+default\s+/gm, 'const __default__ = ')
    .replace(/^\s*export\s+(?=(const|let|var|function|class|async)\b)/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
}

/** يستخرج أسماء التعريفات في المستوى الأعلى للملف */
function topLevelNames(src) {
  const names = new Set();
  const rx = /^(?:export\s+)?(?:const|let|var|function|class)\s+\*?\s*([A-Za-z_$][\w$]*)/gm;
  for (const m of src.matchAll(rx)) names.add(m[1]);
  const asyncRx = /^(?:export\s+)?async\s+function\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of src.matchAll(asyncRx)) names.add(m[1]);
  return names;
}

function assertNoCollisions(files) {
  const owner = new Map();
  const clashes = [];
  for (const f of files) {
    const rel = path.relative(PUB, f);
    for (const n of topLevelNames(fs.readFileSync(f, 'utf8'))) {
      if (owner.has(n)) clashes.push(`${n}  (${owner.get(n)} ↔ ${rel})`);
      else owner.set(n, rel);
    }
  }
  if (clashes.length) {
    throw new Error('تصادم أسماء في المستوى الأعلى بين الوحدات — أعد تسميتها:\n  - ' + clashes.join('\n  - '));
  }
}

function bundle(entry) {
  const files = collectDeps(entry);
  assertNoCollisions(files);
  const parts = files.map((f) => {
    const rel = path.relative(PUB, f);
    return `\n/* ==== ${rel} ==== */\n` + stripModuleSyntax(fs.readFileSync(f, 'utf8'));
  });
  return { code: parts.join('\n'), files };
}

// ---------- 3) البناء ----------
function build() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const seed = extract();
  const css = fs.readFileSync(path.join(PUB, 'css', 'app.css'), 'utf8');

  const demoMain = path.join(PUB, 'js', '__demo_main.js');
  fs.writeFileSync(demoMain, `
import { useDemoEngine, api, setToken, state } from './api.js';
import { createDemoEngine } from './demo-engine.js';
import { app, registerView } from './app.js';
import { dashboardView } from './views/dashboard.js';
import { posView } from './views/pos.js';
import { productsView } from './views/products.js';
import { expiryView } from './views/expiry.js';
import { salesView } from './views/sales.js';
import { purchasesView } from './views/purchases.js';
import { customersView, suppliersView, expensesView } from './views/parties.js';
import { reportsView } from './views/reports.js';
import { usersView, settingsView } from './views/admin.js';

registerView('dashboard', dashboardView);
registerView('pos', posView);
registerView('products', productsView);
registerView('expiry', expiryView);
registerView('sales', salesView);
registerView('purchases', purchasesView);
registerView('customers', customersView);
registerView('suppliers', suppliersView);
registerView('expenses', expensesView);
registerView('reports', reportsView);
registerView('users', usersView);
registerView('settings', settingsView);

useDemoEngine(createDemoEngine(window.__DEMO_SEED__));
setToken(null);
window.__app = app;

function __start() {
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'ar';
  app.boot();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __start);
else __start();
`, 'utf8');

  const { code, files } = bundle(demoMain);
  fs.unlinkSync(demoMain);

  const seedJson = JSON.stringify(seed)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');

  // رقم واتساب التواصل — يُمرَّر عند البناء:  DEMO_WHATSAPP=2189xxxxxxx npm run demo
  const WHATSAPP = String(process.env.DEMO_WHATSAPP || '').replace(/[^0-9]/g, '');

  const html = `<title>منظومة صيدليتي</title>
<style>
${css}

/* ===== شريط نسخة العرض ===== */
.demo-bar{
  position:fixed; bottom:0; inset-inline:0; z-index:150;
  background:linear-gradient(90deg,#0f766e,#115e59);
  color:#fff; padding:9px 16px; display:flex; align-items:center; gap:14px;
  font-size:13px; box-shadow:0 -3px 14px rgba(0,0,0,.18); flex-wrap:wrap
}
.demo-bar b{font-weight:700}
.demo-bar .sp{flex:1}
.demo-bar a{
  background:#fff; color:#0f766e; padding:6px 15px; border-radius:8px;
  font-weight:700; white-space:nowrap; font-size:13px
}
.demo-bar a.ghost{background:rgba(255,255,255,.14); color:#fff}
.demo-bar .x{background:none;border:0;color:rgba(255,255,255,.7);cursor:pointer;font-size:19px;line-height:1;padding:0 4px}
body.has-demo-bar .content{padding-bottom:78px}
body.has-demo-bar .sidebar{padding-bottom:52px}
@media print{ .demo-bar{display:none!important} }
@media(max-width:700px){ .demo-bar{font-size:12px;padding:8px 12px;gap:8px} .demo-bar .hide-sm{display:none} }
</style>

<script id="demo-seed" type="application/json">${seedJson}</script>
<script>window.__DEMO_SEED__ = JSON.parse(document.getElementById('demo-seed').textContent);</script>
<script>
${code}
</script>
<script>
(function () {
  var bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.innerHTML =
    '<b>🔎 نسخة تجريبية</b>' +
    '<span class="hide-sm">البيانات وهمية للعرض فقط · أي تعديل هنا لا يُحفظ ويرجع كما كان عند تحديث الصفحة</span>' +
    '<span class="sp"></span>' +
    ${WHATSAPP
      ? `'<a href="https://wa.me/${WHATSAPP}" target="_blank" rel="noopener">💬 اطلب نسختك الآن</a>' +`
      : `'<span class="hide-sm" style="opacity:.75">للطلب: ضع رقم واتساب عند البناء</span>' +`}
    '<button class="x" title="إخفاء">&times;</button>';
  bar.querySelector('.x').onclick = function () {
    bar.remove(); document.body.classList.remove('has-demo-bar');
  };
  function mount() {
    if (!document.body) return setTimeout(mount, 50);
    document.body.append(bar);
    document.body.classList.add('has-demo-bar');
  }
  mount();
  // إعادة تثبيت الشريط بعد إعادة رسم الهيكل (تسجيل الدخول/الخروج)
  new MutationObserver(function () {
    if (!document.body.contains(bar) && document.querySelector('.layout, .login-wrap')) {
      document.body.append(bar); document.body.classList.add('has-demo-bar');
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
</script>`;

  // نسخة للنشر عبر رابط (بدون وسوم html/head/body — يضيفها النظام)
  const artifactFile = path.join(OUT_DIR, 'saydaliyati-demo.html');
  fs.writeFileSync(artifactFile, html, 'utf8');

  // نسخة مستقلة تماماً: تُفتح بالنقر المزدوج أو من فلاش بدون إنترنت
  const standalone = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💊</text></svg>">
</head>
<body>
${html}
</body>
</html>`;
  const outFile = path.join(OUT_DIR, 'saydaliyati-demo-standalone.html');
  fs.writeFileSync(outFile, standalone, 'utf8');

  const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(0);
  console.log('\n  ✔ تم بناء نسخة العرض\n');
  console.log('     للنشر برابط:  ' + path.relative(ROOT, artifactFile));
  console.log('     مستقلة:       ' + path.relative(ROOT, outFile));
  console.log('     الحجم:   ' + sizeKb + ' كيلوبايت');
  console.log('     الوحدات: ' + files.length);
  console.log('     واتساب:  ' + (WHATSAPP ? '+' + WHATSAPP : '(لم يُحدَّد — استخدم DEMO_WHATSAPP)'));
  console.log('     البيانات: ' + seed.data.products.length + ' صنف، '
    + seed.data.sales.length + ' فاتورة، ' + seed.data.batches.length + ' دفعة');
  console.log('');
  return outFile;
}

if (require.main === module) build();
module.exports = { build, bundle, extract };
