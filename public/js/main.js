// نقطة الدخول للواجهة
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

app.boot();
