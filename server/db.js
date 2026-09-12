'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.SAYD_DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'saydaliyati.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier',      -- admin | pharmacist | cashier
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode TEXT,
  name TEXT NOT NULL,                         -- الاسم التجاري
  generic_name TEXT,                          -- المادة الفعالة  (للبدائل)
  form TEXT,                                  -- الشكل الدوائي: أقراص/شراب/حقن...
  strength TEXT,                              -- التركيز
  manufacturer TEXT,                          -- الشركة المصنعة
  category_id INTEGER REFERENCES categories(id),
  unit TEXT NOT NULL DEFAULT 'علبة',
  sale_price REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  requires_prescription INTEGER NOT NULL DEFAULT 0,
  location TEXT,                              -- رقم الرف
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_generic ON products(generic_name);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  notes TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  notes TEXT,
  credit_limit REAL NOT NULL DEFAULT 0,
  opening_balance REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT,
  supplier_id INTEGER REFERENCES suppliers(id),
  date TEXT NOT NULL,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  notes TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_no TEXT,
  expiry_date TEXT,                           -- YYYY-MM-DD
  qty REAL NOT NULL DEFAULT 0,                -- الكمية المتبقية
  cost_price REAL NOT NULL DEFAULT 0,
  purchase_id INTEGER REFERENCES purchases(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_batches_product ON batches(product_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON batches(expiry_date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER REFERENCES batches(id),
  qty REAL NOT NULL,
  cost_price REAL NOT NULL,
  sale_price REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL,
  date TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  user_id INTEGER REFERENCES users(id),
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash', -- cash | credit
  status TEXT NOT NULL DEFAULT 'done',         -- done | returned
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER REFERENCES batches(id),
  qty REAL NOT NULL,
  price REAL NOT NULL,
  cost_price REAL NOT NULL DEFAULT 0,
  returned_qty REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE IF NOT EXISTS sale_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER REFERENCES sales(id),
  date TEXT NOT NULL,
  total REAL NOT NULL DEFAULT 0,
  reason TEXT,
  user_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sale_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id INTEGER REFERENCES sale_items(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER REFERENCES batches(id),
  qty REAL NOT NULL,
  price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type TEXT NOT NULL,                   -- customer | supplier
  party_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  direction TEXT NOT NULL,                    -- in (قبض) | out (دفع)
  date TEXT NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_type, party_id);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'عام',
  amount REAL NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_change REAL NOT NULL,
  reason TEXT,
  date TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  details TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_at TEXT NOT NULL
);
`;

db.exec(SCHEMA);

// ---- helpers -------------------------------------------------------------
function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, String(value));
}
function log(user, action, details) {
  db.prepare('INSERT INTO activity_log(user_id,username,action,details) VALUES(?,?,?,?)').run(
    user ? user.id : null,
    user ? user.username : 'system',
    action,
    typeof details === 'string' ? details : JSON.stringify(details || {})
  );
}

module.exports = { db, DB_PATH, DATA_DIR, getSetting, setSetting, log };
