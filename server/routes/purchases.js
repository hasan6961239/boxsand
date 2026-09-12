'use strict';
const { db, log } = require('../db');
const { HttpError } = require('../http');
const { requirePerm } = require('../auth');
const { round2, nowStamp } = require('./sales');

/** فاتورة شراء: تنشئ دفعات جديدة (batches) وتحدّث أسعار البيع اختيارياً */
const createPurchase = db.transaction((payload, user) => {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new HttpError(400, 'فاتورة الشراء فارغة');

  const info = db
    .prepare('INSERT INTO purchases(invoice_no,supplier_id,date,total,paid,notes,user_id) VALUES(?,?,?,0,?,?,?)')
    .run(
      payload.invoice_no || null,
      payload.supplier_id || null,
      payload.date || nowStamp(),
      round2(Number(payload.paid) || 0),
      payload.notes || null,
      user.id
    );
  const purchaseId = info.lastInsertRowid;

  let total = 0;
  for (const it of items) {
    const qty = Number(it.qty);
    const cost = Number(it.cost_price) || 0;
    if (!(qty > 0)) throw new HttpError(400, 'الكمية يجب أن تكون أكبر من صفر');
    if (!it.product_id) throw new HttpError(400, 'حدد الصنف لكل بند');

    const batchInfo = db
      .prepare('INSERT INTO batches(product_id,batch_no,expiry_date,qty,cost_price,purchase_id) VALUES(?,?,?,?,?,?)')
      .run(it.product_id, it.batch_no || null, it.expiry_date || null, qty, cost, purchaseId);

    db.prepare(
      'INSERT INTO purchase_items(purchase_id,product_id,batch_id,qty,cost_price,sale_price) VALUES(?,?,?,?,?,?)'
    ).run(purchaseId, it.product_id, batchInfo.lastInsertRowid, qty, cost, Number(it.sale_price) || 0);

    if (Number(it.sale_price) > 0) {
      db.prepare('UPDATE products SET sale_price = ? WHERE id = ?').run(Number(it.sale_price), it.product_id);
    }
    total += qty * cost;
  }

  total = round2(total - (Number(payload.discount) || 0));
  db.prepare('UPDATE purchases SET total = ? WHERE id = ?').run(total, purchaseId);
  log(user, 'purchase.create', { id: purchaseId, total });
  return getPurchase(purchaseId);
});

function getPurchase(id) {
  const p = db
    .prepare(
      `SELECT pu.*, s.name AS supplier_name, s.phone AS supplier_phone, u.full_name AS user_name
       FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id
       LEFT JOIN users u ON u.id = pu.user_id WHERE pu.id = ?`
    )
    .get(id);
  if (!p) throw new HttpError(404, 'فاتورة الشراء غير موجودة');
  p.items = db
    .prepare(
      `SELECT pi.*, pr.name AS product_name, pr.unit, b.batch_no, b.expiry_date, b.qty AS remaining_qty
       FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id
       LEFT JOIN batches b ON b.id = pi.batch_id WHERE pi.purchase_id = ? ORDER BY pi.id`
    )
    .all(id);
  return p;
}

function listPurchases({ from, to, supplier_id, q, limit = 100, offset = 0 }) {
  const where = ['1=1'];
  const args = [];
  if (from) { where.push('date(pu.date) >= date(?)'); args.push(from); }
  if (to) { where.push('date(pu.date) <= date(?)'); args.push(to); }
  if (supplier_id) { where.push('pu.supplier_id = ?'); args.push(supplier_id); }
  if (q) { where.push('(pu.invoice_no LIKE ? OR s.name LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const rows = db
    .prepare(
      `SELECT pu.*, s.name AS supplier_name, u.full_name AS user_name,
              (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = pu.id) AS lines
       FROM purchases pu LEFT JOIN suppliers s ON s.id=pu.supplier_id LEFT JOIN users u ON u.id=pu.user_id
       WHERE ${where.join(' AND ')} ORDER BY pu.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, Number(limit), Number(offset));
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(pu.total),0) AS total, COALESCE(SUM(pu.paid),0) AS paid
       FROM purchases pu LEFT JOIN suppliers s ON s.id=pu.supplier_id WHERE ${where.join(' AND ')}`
    )
    .get(...args);
  return { rows, summary: agg };
}

const deletePurchase = db.transaction((id, user) => {
  const batches = db.prepare('SELECT * FROM batches WHERE purchase_id = ?').all(id);
  for (const b of batches) {
    const sold = db.prepare('SELECT COALESCE(SUM(qty),0) s FROM sale_items WHERE batch_id = ?').get(b.id).s;
    if (sold > 0) throw new HttpError(400, 'لا يمكن حذف فاتورة شراء بيعت أصنافها — قم بعمل مرتجع مشتريات');
  }
  db.prepare('DELETE FROM batches WHERE purchase_id = ?').run(id);
  db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(id);
  db.prepare('DELETE FROM purchases WHERE id = ?').run(id);
  log(user, 'purchase.delete', { id });
  return { ok: true };
});

module.exports = { createPurchase, getPurchase, listPurchases, deletePurchase };
