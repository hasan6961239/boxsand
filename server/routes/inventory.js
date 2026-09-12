'use strict';
const { db, log, getSetting } = require('../db');
const { HttpError } = require('../http');
const { requirePerm } = require('../auth');

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name,
         COALESCE((SELECT SUM(b.qty) FROM batches b WHERE b.product_id = p.id), 0) AS stock,
         -- الكمية القابلة للبيع فعلياً (تستثني الدفعات المنتهية)
         COALESCE((SELECT SUM(b.qty) FROM batches b WHERE b.product_id = p.id
                   AND (b.expiry_date IS NULL OR b.expiry_date >= date('now','localtime'))), 0) AS sellable_stock,
         -- كمية موجودة على الرف لكنها منتهية الصلاحية
         COALESCE((SELECT SUM(b.qty) FROM batches b WHERE b.product_id = p.id
                   AND b.expiry_date IS NOT NULL AND b.expiry_date < date('now','localtime')), 0) AS expired_qty,
         -- أقرب صلاحية بين الدفعات الصالحة (هي التي ستُباع أولاً بنظام FEFO)
         (SELECT MIN(b.expiry_date) FROM batches b WHERE b.product_id = p.id AND b.qty > 0
          AND b.expiry_date IS NOT NULL AND b.expiry_date >= date('now','localtime')) AS nearest_expiry,
         COALESCE((SELECT b2.cost_price FROM batches b2 WHERE b2.product_id = p.id AND b2.qty > 0
                   AND (b2.expiry_date IS NULL OR b2.expiry_date >= date('now','localtime'))
                   ORDER BY COALESCE(b2.expiry_date,'9999-12-31') ASC LIMIT 1), 0) AS cost_price
  FROM products p LEFT JOIN categories c ON c.id = p.category_id
`;

function listProducts({ q, category_id, only_active = '1', stock_filter, limit = 200, offset = 0 }) {
  const where = ['1=1'];
  const args = [];
  if (only_active === '1') where.push('p.active = 1');
  if (q) {
    where.push('(p.name LIKE ? OR p.generic_name LIKE ? OR p.barcode = ? OR p.manufacturer LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, q, `%${q}%`);
  }
  if (category_id) { where.push('p.category_id = ?'); args.push(category_id); }
  let sql = PRODUCT_SELECT + ' WHERE ' + where.join(' AND ');
  if (stock_filter === 'low') sql += ' AND stock <= p.min_stock';
  if (stock_filter === 'out') sql += ' AND stock <= 0';
  sql += ' ORDER BY p.name LIMIT ? OFFSET ?';
  args.push(Number(limit), Number(offset));
  return db.prepare(sql).all(...args);
}

function getProduct(id) {
  const p = db.prepare(PRODUCT_SELECT + ' WHERE p.id = ?').get(id);
  if (!p) throw new HttpError(404, 'الصنف غير موجود');
  p.batches = db
    .prepare('SELECT * FROM batches WHERE product_id = ? ORDER BY COALESCE(expiry_date,\'9999-12-31\') ASC')
    .all(id);
  p.alternatives = p.generic_name
    ? db.prepare(
        PRODUCT_SELECT + ' WHERE p.generic_name = ? AND p.id <> ? AND p.active = 1 ORDER BY p.name LIMIT 20'
      ).all(p.generic_name, id)
    : [];
  return p;
}

const PRODUCT_FIELDS = [
  'barcode','name','generic_name','form','strength','manufacturer','category_id',
  'unit','sale_price','min_stock','requires_prescription','location','notes','active'
];

function saveProduct(ctx) {
  const user = requirePerm(ctx, 'products.edit');
  const b = ctx.body || {};
  if (!b.name || !String(b.name).trim()) throw new HttpError(400, 'اسم الصنف مطلوب');
  const data = {};
  for (const f of PRODUCT_FIELDS) {
    let v = b[f];
    if (v === undefined) v = f === 'active' ? 1 : f === 'unit' ? 'علبة' : (['sale_price','min_stock','requires_prescription'].includes(f) ? 0 : null);
    if (['sale_price','min_stock'].includes(f)) v = Number(v) || 0;
    if (f === 'requires_prescription' || f === 'active') v = v ? 1 : 0;
    if (f === 'category_id') v = v ? Number(v) : null;
    if (f === 'barcode' && v) v = String(v).trim();
    data[f] = v;
  }
  if (data.barcode) {
    const dup = db.prepare('SELECT id FROM products WHERE barcode = ? AND id <> ?').get(data.barcode, b.id || 0);
    if (dup) throw new HttpError(400, 'الباركود مستخدم مع صنف آخر');
  }
  if (b.id) {
    db.prepare(
      `UPDATE products SET ${PRODUCT_FIELDS.map((f) => `${f}=@${f}`).join(',')} WHERE id=@id`
    ).run({ ...data, id: b.id });
    log(user, 'product.update', { id: b.id, name: data.name });
    return getProduct(b.id);
  }
  const info = db
    .prepare(
      `INSERT INTO products (${PRODUCT_FIELDS.join(',')}) VALUES (${PRODUCT_FIELDS.map((f) => '@' + f).join(',')})`
    )
    .run(data);
  log(user, 'product.create', { id: info.lastInsertRowid, name: data.name });
  // دفعة افتتاحية اختيارية
  if (Number(b.opening_qty) > 0) {
    db.prepare(
      'INSERT INTO batches(product_id,batch_no,expiry_date,qty,cost_price) VALUES(?,?,?,?,?)'
    ).run(info.lastInsertRowid, b.opening_batch_no || null, b.opening_expiry || null,
          Number(b.opening_qty), Number(b.opening_cost) || 0);
  }
  return getProduct(info.lastInsertRowid);
}

function deleteProduct(ctx) {
  const user = requirePerm(ctx, 'products.edit');
  const id = Number(ctx.params.id);
  const used = db.prepare('SELECT COUNT(*) n FROM sale_items WHERE product_id = ?').get(id).n;
  if (used > 0) {
    db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
    log(user, 'product.archive', { id });
    return { ok: true, archived: true, message: 'الصنف مرتبط بفواتير، تم أرشفته بدل حذفه' };
  }
  db.prepare('DELETE FROM batches WHERE product_id = ?').run(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  log(user, 'product.delete', { id });
  return { ok: true };
}

// ---- البحث السريع لنقطة البيع -------------------------------------------
function posSearch({ q = '', limit = 25 }) {
  const term = String(q).trim();
  if (!term) return [];
  const rows = db
    .prepare(
      PRODUCT_SELECT +
        ` WHERE p.active = 1 AND (p.barcode = ? OR p.name LIKE ? OR p.generic_name LIKE ?)
          ORDER BY (p.barcode = ?) DESC,          -- تطابق الباركود أولاً
                   (sellable_stock > 0) DESC,     -- ثم المتوفر فعلياً للبيع
                   (p.name LIKE ?) DESC,          -- ثم ما يبدأ بنص البحث
                   p.name LIMIT ?`
    )
    .all(term, `%${term}%`, `%${term}%`, term, `${term}%`, Number(limit));
  return rows;
}

// ---- الدفعات -------------------------------------------------------------
function listBatches({ product_id }) {
  return db
    .prepare("SELECT b.*, p.name AS product_name FROM batches b JOIN products p ON p.id=b.product_id WHERE b.product_id = ? ORDER BY COALESCE(b.expiry_date,'9999-12-31')")
    .all(product_id);
}

function adjustStock(ctx) {
  const user = requirePerm(ctx, 'stock.adjust');
  const { batch_id, new_qty, reason } = ctx.body || {};
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batch_id);
  if (!batch) throw new HttpError(404, 'الدفعة غير موجودة');
  const change = Number(new_qty) - batch.qty;
  db.prepare('UPDATE batches SET qty = ? WHERE id = ?').run(Number(new_qty), batch_id);
  db.prepare(
    'INSERT INTO stock_adjustments(batch_id,product_id,qty_change,reason,date,user_id) VALUES(?,?,?,?,?,?)'
  ).run(batch_id, batch.product_id, change, reason || 'جرد', today(), user.id);
  log(user, 'stock.adjust', { batch_id, change, reason });
  return { ok: true };
}

function saveBatch(ctx) {
  const user = requirePerm(ctx, 'products.edit');
  const b = ctx.body || {};
  if (!b.product_id) throw new HttpError(400, 'الصنف مطلوب');
  if (b.id) {
    db.prepare('UPDATE batches SET batch_no=?, expiry_date=?, qty=?, cost_price=? WHERE id=?')
      .run(b.batch_no || null, b.expiry_date || null, Number(b.qty) || 0, Number(b.cost_price) || 0, b.id);
    log(user, 'batch.update', { id: b.id });
    return { ok: true, id: b.id };
  }
  const info = db
    .prepare('INSERT INTO batches(product_id,batch_no,expiry_date,qty,cost_price) VALUES(?,?,?,?,?)')
    .run(b.product_id, b.batch_no || null, b.expiry_date || null, Number(b.qty) || 0, Number(b.cost_price) || 0);
  log(user, 'batch.create', { id: info.lastInsertRowid, product_id: b.product_id });
  return { ok: true, id: info.lastInsertRowid };
}

function deleteBatch(ctx) {
  requirePerm(ctx, 'products.edit');
  const id = Number(ctx.params.id);
  const used = db.prepare('SELECT COUNT(*) n FROM sale_items WHERE batch_id = ?').get(id).n;
  if (used > 0) throw new HttpError(400, 'لا يمكن حذف دفعة مرتبطة بفواتير بيع — عدّل الكمية بدل الحذف');
  db.prepare('DELETE FROM batches WHERE id = ?').run(id);
  return { ok: true };
}

// ---- تنبيهات الصلاحية والنواقص -------------------------------------------
function expiryReport({ days }) {
  const n = Number(days || getSetting('expiry_alert_days', 90));
  const limit = addDays(new Date(), n);
  const t = today();
  const rows = db
    .prepare(
      `SELECT b.*, p.name AS product_name, p.unit, p.sale_price, p.location,
              (b.qty * b.cost_price) AS value,
              CAST(julianday(b.expiry_date) - julianday(?) AS INTEGER) AS days_left
       FROM batches b JOIN products p ON p.id = b.product_id
       WHERE b.qty > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= ?
       ORDER BY b.expiry_date ASC`
    )
    .all(t, limit);
  return {
    alert_days: n,
    expired: rows.filter((r) => r.expiry_date < t),
    expiring_soon: rows.filter((r) => r.expiry_date >= t),
    total_value_at_risk: rows.reduce((s, r) => s + r.value, 0)
  };
}

function lowStockReport() {
  return db
    .prepare(
      PRODUCT_SELECT + ' WHERE p.active = 1 AND p.min_stock > 0 AND stock <= p.min_stock ORDER BY (stock - p.min_stock) ASC'
    )
    .all();
}

// ---- الأصناف: التصنيفات ---------------------------------------------------
function listCategories() {
  return db
    .prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id) AS products_count FROM categories c ORDER BY c.name')
    .all();
}
function saveCategory(ctx) {
  requirePerm(ctx, 'products.edit');
  const { id, name } = ctx.body || {};
  if (!name) throw new HttpError(400, 'اسم التصنيف مطلوب');
  if (id) { db.prepare('UPDATE categories SET name=? WHERE id=?').run(name, id); return { ok: true, id }; }
  const info = db.prepare('INSERT INTO categories(name) VALUES(?) ON CONFLICT(name) DO NOTHING').run(name);
  return { ok: true, id: info.lastInsertRowid };
}
function deleteCategory(ctx) {
  requirePerm(ctx, 'products.edit');
  const id = Number(ctx.params.id);
  db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return { ok: true };
}

module.exports = {
  listProducts, getProduct, saveProduct, deleteProduct, posSearch,
  listBatches, saveBatch, deleteBatch, adjustStock,
  expiryReport, lowStockReport,
  listCategories, saveCategory, deleteCategory,
  PRODUCT_SELECT, today, addDays
};
