// ===== طبقة الاتصال =====
// تعمل مع الخادم المحلي، أو مع محرّك العرض التجريبي داخل المتصفح (وضع DEMO)

const TOKEN_KEY = 'sayd_token';
export const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null,
  permissions: [],
  settings: {},
  demo: false
};

export function setToken(t) {
  state.token = t;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export function can(perm) {
  return state.permissions.includes('*') || state.permissions.includes(perm);
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/** محرّك العرض التجريبي يُسجَّل هنا عند بناء نسخة العرض */
let demoEngine = null;
export function useDemoEngine(engine) { demoEngine = engine; state.demo = true; }

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

async function request(method, path, { query, body } = {}) {
  if (demoEngine) return demoEngine.handle(method, path, query || {}, body || {});

  const res = await fetch('/api' + path + qs(query), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new ApiError('تعذّر الاتصال بالخادم', res.status);
    return res;
  }
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) { setToken(null); state.user = null; }
    throw new ApiError(data.error || 'حدث خطأ غير متوقع', res.status);
  }
  return data;
}

const get = (p, query) => request('GET', p, { query });
const post = (p, body) => request('POST', p, { body });
const del = (p, body) => request('DELETE', p, { body });

export const api = {
  // المصادقة
  login: (username, password) => post('/auth/login', { username, password }),
  logout: () => post('/auth/logout'),
  me: () => get('/auth/me'),
  changePassword: (old_password, new_password) => post('/auth/password', { old_password, new_password }),

  // الأصناف
  products: (q) => get('/products', q),
  product: (id) => get('/products/' + id),
  saveProduct: (p) => post('/products', p),
  deleteProduct: (id) => del('/products/' + id),
  searchProducts: (q) => get('/products/search', { q }),

  // الدفعات والمخزون
  batches: (product_id) => get('/batches', { product_id }),
  saveBatch: (b) => post('/batches', b),
  deleteBatch: (id) => del('/batches/' + id),
  adjustStock: (b) => post('/stock/adjust', b),

  categories: () => get('/categories'),
  saveCategory: (c) => post('/categories', c),
  deleteCategory: (id) => del('/categories/' + id),

  // التنبيهات
  expiryAlerts: (days) => get('/alerts/expiry', { days }),
  lowStock: () => get('/alerts/low-stock'),

  // المبيعات
  createSale: (s) => post('/sales', s),
  sales: (q) => get('/sales', q),
  sale: (id) => get('/sales/' + id),
  createReturn: (r) => post('/returns', r),
  returns: (q) => get('/returns', q),
  holdSale: (s) => post('/held', s),
  heldSales: () => get('/held'),
  dropHeld: (id) => del('/held/' + id),

  // المشتريات
  createPurchase: (p) => post('/purchases', p),
  purchases: (q) => get('/purchases', q),
  purchase: (id) => get('/purchases/' + id),
  deletePurchase: (id) => del('/purchases/' + id),

  // الأطراف
  customers: (q) => get('/customers', q),
  customer: (id) => get('/customers/' + id),
  saveCustomer: (c) => post('/customers', c),
  suppliers: (q) => get('/suppliers', q),
  supplier: (id) => get('/suppliers/' + id),
  saveSupplier: (s) => post('/suppliers', s),
  addPayment: (p) => post('/payments', p),
  deletePayment: (id) => del('/payments/' + id),

  expenses: (q) => get('/expenses', q),
  saveExpense: (e) => post('/expenses', e),
  deleteExpense: (id) => del('/expenses/' + id),

  // التقارير
  dashboard: () => get('/dashboard'),
  reportSales: (q) => get('/reports/sales', q),
  reportProducts: (q) => get('/reports/products', q),
  reportDeadStock: (q) => get('/reports/dead-stock', q),
  reportProfitLoss: (q) => get('/reports/profit-loss', q),
  reportDebtors: () => get('/reports/debtors'),
  reportSuppliersDue: () => get('/reports/suppliers-due'),
  reportUsers: (q) => get('/reports/users', q),
  purchaseSuggestion: () => get('/reports/purchase-suggestion'),

  // الإدارة
  settings: () => get('/settings'),
  saveSettings: (s) => post('/settings', s),
  users: () => get('/users'),
  saveUser: (u) => post('/users', u),
  deleteUser: (id) => del('/users/' + id),
  backups: () => get('/backups'),
  createBackup: () => post('/backups'),
  restoreBackup: (file) => post('/backups/restore', { file }),
  activity: (limit) => get('/activity', { limit })
};
