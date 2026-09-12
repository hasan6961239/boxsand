'use strict';
/**
 * منظومة صيدليتي — الخادم الرئيسي
 * تعمل محلياً على جهاز الصيدلية بدون الحاجة لإنترنت.
 */
const os = require('os');
const path = require('path');
const { Router, createServer, HttpError } = require('./http');
const { db, getSetting } = require('./db');
const auth = require('./auth');
const inventory = require('./routes/inventory');
const sales = require('./routes/sales');
const purchases = require('./routes/purchases');
const parties = require('./routes/parties');
const reports = require('./routes/reports');
const admin = require('./routes/admin');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const router = new Router();
const P = (perm, fn) => (ctx) => { auth.requirePerm(ctx, perm); return fn(ctx); };

// ---- المصادقة ------------------------------------------------------------
router.post('/api/auth/login', (ctx) => auth.login(ctx.body.username, ctx.body.password));
router.post('/api/auth/logout', (ctx) => auth.logout(auth.tokenFromRequest(ctx.req)));
router.get('/api/auth/me', (ctx) => {
  const u = auth.requireAuth(ctx);
  return {
    user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role },
    permissions: auth.PERMISSIONS[u.role] || [],
    settings: admin.getSettings()
  };
});
router.post('/api/auth/password', (ctx) => admin.changeOwnPassword(ctx));

// ---- الأصناف والمخزون ----------------------------------------------------
router.get('/api/products', P('products.view', (ctx) => inventory.listProducts(ctx.query)));
router.get('/api/products/search', P('pos', (ctx) => inventory.posSearch(ctx.query)));
router.get('/api/products/:id', P('products.view', (ctx) => inventory.getProduct(Number(ctx.params.id))));
router.post('/api/products', (ctx) => inventory.saveProduct(ctx));
router.del('/api/products/:id', (ctx) => inventory.deleteProduct(ctx));

router.get('/api/batches', P('products.view', (ctx) => inventory.listBatches(ctx.query)));
router.post('/api/batches', (ctx) => inventory.saveBatch(ctx));
router.del('/api/batches/:id', (ctx) => inventory.deleteBatch(ctx));
router.post('/api/stock/adjust', (ctx) => inventory.adjustStock(ctx));

router.get('/api/categories', P('products.view', () => inventory.listCategories()));
router.post('/api/categories', (ctx) => inventory.saveCategory(ctx));
router.del('/api/categories/:id', (ctx) => inventory.deleteCategory(ctx));

router.get('/api/alerts/expiry', P('products.view', (ctx) => inventory.expiryReport(ctx.query)));
router.get('/api/alerts/low-stock', P('products.view', () => inventory.lowStockReport()));

// ---- المبيعات ------------------------------------------------------------
router.post('/api/sales', (ctx) => { auth.requirePerm(ctx, 'pos'); return sales.createSale(ctx.body, ctx.user); });
router.get('/api/sales', P('sales.view', (ctx) => sales.listSales(ctx.query)));
router.get('/api/sales/:id', P('sales.view', (ctx) => sales.getSale(Number(ctx.params.id))));
router.post('/api/returns', (ctx) => { auth.requirePerm(ctx, 'sales.return'); return sales.createReturn(ctx.body, ctx.user); });
router.get('/api/returns', P('sales.view', (ctx) => sales.listReturns(ctx.query)));
router.post('/api/held', (ctx) => sales.holdSale(ctx));
router.get('/api/held', (ctx) => sales.listHeld(ctx));
router.del('/api/held/:id', (ctx) => sales.dropHeld(ctx));

// ---- المشتريات -----------------------------------------------------------
router.post('/api/purchases', (ctx) => { auth.requirePerm(ctx, 'purchases.edit'); return purchases.createPurchase(ctx.body, ctx.user); });
router.get('/api/purchases', P('purchases.view', (ctx) => purchases.listPurchases(ctx.query)));
router.get('/api/purchases/:id', P('purchases.view', (ctx) => purchases.getPurchase(Number(ctx.params.id))));
router.del('/api/purchases/:id', (ctx) => { auth.requirePerm(ctx, 'purchases.edit'); return purchases.deletePurchase(Number(ctx.params.id), ctx.user); });

// ---- الزبائن والموردون ---------------------------------------------------
router.get('/api/customers', P('customers.view', (ctx) => parties.listCustomers(ctx.query)));
router.get('/api/customers/:id', P('customers.view', (ctx) => parties.getCustomer(Number(ctx.params.id))));
router.post('/api/customers', (ctx) => parties.saveCustomer(ctx));

router.get('/api/suppliers', P('suppliers.view', (ctx) => parties.listSuppliers(ctx.query)));
router.get('/api/suppliers/:id', P('suppliers.view', (ctx) => parties.getSupplier(Number(ctx.params.id))));
router.post('/api/suppliers', (ctx) => parties.saveSupplier(ctx));

router.post('/api/payments', (ctx) => parties.addPayment(ctx));
router.del('/api/payments/:id', (ctx) => parties.deletePayment(ctx));

router.get('/api/expenses', P('expenses.view', (ctx) => parties.listExpenses(ctx.query)));
router.post('/api/expenses', (ctx) => parties.saveExpense(ctx));
router.del('/api/expenses/:id', (ctx) => parties.deleteExpense(ctx));

// ---- التقارير ------------------------------------------------------------
router.get('/api/dashboard', (ctx) => { auth.requireAuth(ctx); return reports.dashboard(); });
router.get('/api/reports/sales', P('reports.view', (ctx) => reports.salesReport(ctx.query)));
router.get('/api/reports/products', P('reports.view', (ctx) => reports.productsReport(ctx.query)));
router.get('/api/reports/dead-stock', P('reports.view', (ctx) => reports.deadStockReport(ctx.query)));
router.get('/api/reports/profit-loss', P('reports.view', (ctx) => reports.profitLoss(ctx.query)));
router.get('/api/reports/debtors', P('reports.view', () => reports.debtorsReport()));
router.get('/api/reports/suppliers-due', P('reports.view', () => reports.suppliersDueReport()));
router.get('/api/reports/users', P('reports.view', (ctx) => reports.usersReport(ctx.query)));
router.get('/api/reports/purchase-suggestion', P('reports.view', () => reports.purchaseSuggestion()));
router.post('/api/export/csv', (ctx) => admin.exportCsv(ctx));

// ---- الإدارة -------------------------------------------------------------
router.get('/api/settings', (ctx) => { auth.requireAuth(ctx); return admin.getSettings(); });
router.post('/api/settings', (ctx) => admin.saveSettings(ctx));
router.get('/api/users', (ctx) => admin.listUsers(ctx));
router.post('/api/users', (ctx) => admin.saveUser(ctx));
router.del('/api/users/:id', (ctx) => admin.deleteUser(ctx));
router.get('/api/backups', (ctx) => admin.listBackups(ctx));
router.post('/api/backups', (ctx) => admin.createBackup(ctx));
router.get('/api/backups/:file', (ctx) => admin.downloadBackup(ctx));
router.post('/api/backups/restore', (ctx) => admin.restoreBackup(ctx));
router.get('/api/activity', (ctx) => admin.activityLog(ctx));
router.get('/api/health', () => ({ ok: true, version: require('../package.json').version, time: new Date().toISOString() }));

// ---- إعداد السياق (المستخدم الحالي) --------------------------------------
function attachUser(ctx) {
  ctx.user = auth.userFromToken(auth.tokenFromRequest(ctx.req));
}

const server = createServer({ router, staticDir: PUBLIC_DIR, onRequest: attachUser });

function localIps() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

if (require.main === module) {
  const userCount = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (userCount === 0) {
    console.log('\n  لا يوجد مستخدمون بعد. شغّل الأمر التالي لتجهيز البيانات:');
    console.log('     npm run seed\n');
  }
  server.listen(PORT, HOST, () => {
    const name = getSetting('pharmacy_name', 'صيدليتي');
    console.log('\n==============================================');
    console.log(`  منظومة صيدليتي — ${name}`);
    console.log('==============================================');
    console.log(`  محلياً:   http://localhost:${PORT}`);
    for (const ip of localIps()) console.log(`  الشبكة:   http://${ip}:${PORT}`);
    console.log('\n  لإيقاف المنظومة اضغط Ctrl + C');
    console.log('==============================================\n');
  });
}

module.exports = { server, router };
