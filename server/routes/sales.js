'use strict';
const { db, log, getSetting, setSetting } = require('../db');
const { HttpError } = require('../http');
const { requirePerm, can } = require('../auth');

const today = () => new Date().toISOString().slice(0, 10);
const nowStamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function nextInvoiceNo() {
  const seq = Number(getSetting('invoice_seq', '0')) + 1;
  setSetting('invoice_seq', seq);
  const prefix = getSetting('invoice_prefix', 'ف');
  return `${prefix}-${String(seq).padStart(6, '0')}`;
}

/**
 * خصم الكمية من الدفعات بنظام "الأقرب انتهاءً أولاً" (FEFO)
 * ويتجاهل الدفعات المنتهية الصلاحية تماماً.
 */
function allocateFEFO(productId, qty, { allowExpired = false } = {}) {
  const t = today();
  const batches = db
    .prepare(
      `SELECT * FROM batches WHERE product_id = ? AND qty > 0
        ${allowExpired ? '' : "AND (expiry_date IS NULL OR expiry_date >= ?)"}
       ORDER BY COALESCE(expiry_date,'9999-12-31') ASC, id ASC`
    )
    .all(...(allowExpired ? [productId] : [productId, t]));

  const available = batches.reduce((s, b) => s + b.qty, 0);
  if (available + 1e-9 < qty) {
    const p = db.prepare('SELECT name FROM products WHERE id = ?').get(productId);
    throw new HttpError(400, `الكمية غير متوفرة للصنف «${p ? p.name : productId}» — المتاح ${round2(available)}`);
  }

  const allocations = [];
  let remaining = qty;
  for (const b of batches) {
    if (remaining <= 1e-9) break;
    const take = Math.min(b.qty, remaining);
    allocations.push({ batch_id: b.id, qty: take, cost_price: b.cost_price });
    remaining = round2(remaining - take);
  }
  return allocations;
}

function partyBalance(type, id) {
  if (!id) return 0;
  const table = type === 'customer' ? 'customers' : 'suppliers';
  const opening = db.prepare(`SELECT opening_balance FROM ${table} WHERE id = ?`).get(id);
  let bal = opening ? opening.opening_balance : 0;
  if (type === 'customer') {
    const s = db.prepare("SELECT COALESCE(SUM(total - paid),0) d FROM sales WHERE customer_id = ? AND status <> 'returned'").get(id).d;
    const r = db.prepare('SELECT COALESCE(SUM(sr.total),0) d FROM sale_returns sr JOIN sales s ON s.id=sr.sale_id WHERE s.customer_id = ?').get(id).d;
    const p = db.prepare("SELECT COALESCE(SUM(amount),0) d FROM payments WHERE party_type='customer' AND party_id = ? AND direction='in'").get(id).d;
    bal = bal + s - r - p;
  } else {
    const pu = db.prepare('SELECT COALESCE(SUM(total - paid),0) d FROM purchases WHERE supplier_id = ?').get(id).d;
    const p = db.prepare("SELECT COALESCE(SUM(amount),0) d FROM payments WHERE party_type='supplier' AND party_id = ? AND direction='out'").get(id).d;
    bal = bal + pu - p;
  }
  return round2(bal);
}

/** إنشاء فاتورة بيع */
const createSale = db.transaction((payload, user) => {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new HttpError(400, 'الفاتورة فارغة');

  const discount = round2(Number(payload.discount) || 0);
  const paymentMethod = payload.payment_method === 'credit' ? 'credit' : 'cash';
  const customerId = payload.customer_id ? Number(payload.customer_id) : null;

  if (paymentMethod === 'credit' && !customerId) {
    throw new HttpError(400, 'البيع بالآجل يتطلب اختيار زبون');
  }

  // التحقق من حد الائتمان
  if (paymentMethod === 'credit' && customerId) {
    const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!cust) throw new HttpError(404, 'الزبون غير موجود');
    if (cust.credit_limit > 0) {
      const bal = partyBalance('customer', customerId);
      const invoiceTotal = items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0) - discount;
      if (bal + invoiceTotal > cust.credit_limit) {
        throw new HttpError(400,
          `تجاوز حد الائتمان للزبون «${cust.name}». الرصيد الحالي ${round2(bal)} والحد ${cust.credit_limit}`);
      }
    }
  }

  const invoiceNo = nextInvoiceNo();
  const date = payload.date || nowStamp();

  const saleInfo = db
    .prepare(
      `INSERT INTO sales(invoice_no,date,customer_id,user_id,subtotal,discount,total,paid,payment_method,status,notes)
       VALUES(?,?,?,?,0,?,0,0,?,'done',?)`
    )
    .run(invoiceNo, date, customerId, user.id, discount, paymentMethod, payload.notes || null);
  const saleId = saleInfo.lastInsertRowid;

  let subtotal = 0;
  for (const it of items) {
    const qty = Number(it.qty);
    const price = Number(it.price);
    if (!(qty > 0)) throw new HttpError(400, 'الكمية يجب أن تكون أكبر من صفر');
    if (price < 0) throw new HttpError(400, 'السعر غير صحيح');

    const allocations = allocateFEFO(Number(it.product_id), qty);
    for (const a of allocations) {
      db.prepare('UPDATE batches SET qty = qty - ? WHERE id = ?').run(a.qty, a.batch_id);
      db.prepare(
        'INSERT INTO sale_items(sale_id,product_id,batch_id,qty,price,cost_price) VALUES(?,?,?,?,?,?)'
      ).run(saleId, it.product_id, a.batch_id, a.qty, price, a.cost_price);
    }
    subtotal += qty * price;
  }

  subtotal = round2(subtotal);
  const total = round2(Math.max(0, subtotal - discount));
  const paid = paymentMethod === 'credit' ? round2(Number(payload.paid) || 0) : total;

  db.prepare('UPDATE sales SET subtotal=?, total=?, paid=? WHERE id=?').run(subtotal, total, paid, saleId);
  log(user, 'sale.create', { id: saleId, invoice_no: invoiceNo, total });
  return getSale(saleId);
});

function getSale(id) {
  const sale = db
    .prepare(
      `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, u.full_name AS user_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`
    )
    .get(id);
  if (!sale) throw new HttpError(404, 'الفاتورة غير موجودة');
  // تجميع البنود حسب الصنف والسعر (لأن الصنف قد يُقسّم على عدة دفعات)
  sale.items = db
    .prepare(
      `SELECT si.product_id, p.name AS product_name, p.unit, p.form, p.strength,
              si.price, SUM(si.qty) AS qty, SUM(si.qty*si.cost_price) AS cost_total,
              SUM(si.returned_qty) AS returned_qty,
              GROUP_CONCAT(si.id) AS item_ids
       FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ? GROUP BY si.product_id, si.price ORDER BY MIN(si.id)`
    )
    .all(id);
  sale.profit = round2(
    sale.items.reduce((s, i) => s + i.qty * i.price - i.cost_total, 0) - sale.discount
  );
  sale.returns = db.prepare('SELECT * FROM sale_returns WHERE sale_id = ?').all(id);
  return sale;
}

function listSales({ from, to, customer_id, user_id, payment_method, q, limit = 100, offset = 0 }) {
  const where = ['1=1'];
  const args = [];
  if (from) { where.push('date(s.date) >= date(?)'); args.push(from); }
  if (to) { where.push('date(s.date) <= date(?)'); args.push(to); }
  if (customer_id) { where.push('s.customer_id = ?'); args.push(customer_id); }
  if (user_id) { where.push('s.user_id = ?'); args.push(user_id); }
  if (payment_method) { where.push('s.payment_method = ?'); args.push(payment_method); }
  if (q) { where.push('(s.invoice_no LIKE ? OR c.name LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const rows = db
    .prepare(
      `SELECT s.*, c.name AS customer_name, u.full_name AS user_name,
              (SELECT COALESCE(SUM(si.qty*si.price - si.qty*si.cost_price),0) FROM sale_items si WHERE si.sale_id=s.id) - s.discount AS profit
       FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.user_id
       WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, Number(limit), Number(offset));
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(s.total),0) AS total, COALESCE(SUM(s.paid),0) AS paid
       FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE ${where.join(' AND ')}`
    )
    .get(...args);
  return { rows, summary: agg };
}

/** إرجاع بنود من فاتورة (مرتجع مبيعات) */
const createReturn = db.transaction((payload, user) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(payload.sale_id);
  if (!sale) throw new HttpError(404, 'الفاتورة غير موجودة');
  const lines = Array.isArray(payload.items) ? payload.items.filter((l) => Number(l.qty) > 0) : [];
  if (!lines.length) throw new HttpError(400, 'حدد الأصناف المراد إرجاعها');

  const retInfo = db
    .prepare('INSERT INTO sale_returns(sale_id,date,total,reason,user_id) VALUES(?,?,0,?,?)')
    .run(sale.id, payload.date || nowStamp(), payload.reason || null, user.id);
  const returnId = retInfo.lastInsertRowid;

  let total = 0;
  for (const line of lines) {
    let remaining = Number(line.qty);
    // بنود البيع الخاصة بهذا الصنف بنفس السعر
    const saleItems = db
      .prepare('SELECT * FROM sale_items WHERE sale_id = ? AND product_id = ? AND price = ? ORDER BY id')
      .all(sale.id, line.product_id, Number(line.price));
    const returnable = saleItems.reduce((s, si) => s + (si.qty - si.returned_qty), 0);
    if (remaining - 1e-9 > returnable) {
      const p = db.prepare('SELECT name FROM products WHERE id=?').get(line.product_id);
      throw new HttpError(400, `الكمية المراد إرجاعها أكبر من المباع للصنف «${p ? p.name : ''}»`);
    }
    for (const si of saleItems) {
      if (remaining <= 1e-9) break;
      const take = Math.min(si.qty - si.returned_qty, remaining);
      if (take <= 0) continue;
      db.prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?').run(take, si.id);
      if (si.batch_id) db.prepare('UPDATE batches SET qty = qty + ? WHERE id = ?').run(take, si.batch_id);
      db.prepare(
        'INSERT INTO sale_return_items(return_id,sale_item_id,product_id,batch_id,qty,price) VALUES(?,?,?,?,?,?)'
      ).run(returnId, si.id, si.product_id, si.batch_id, take, si.price);
      total += take * si.price;
      remaining = round2(remaining - take);
    }
  }
  total = round2(total);
  db.prepare('UPDATE sale_returns SET total = ? WHERE id = ?').run(total, returnId);

  // إن كانت الفاتورة نقدية، نخفض المدفوع بقيمة المرتجع (المبلغ يُعاد للزبون)
  if (sale.payment_method === 'cash') {
    db.prepare('UPDATE sales SET paid = MAX(0, paid - ?) WHERE id = ?').run(total, sale.id);
  }
  const fullyReturned = db
    .prepare('SELECT COALESCE(SUM(qty - returned_qty),0) rem FROM sale_items WHERE sale_id = ?')
    .get(sale.id).rem;
  if (fullyReturned <= 1e-9) db.prepare("UPDATE sales SET status='returned' WHERE id=?").run(sale.id);

  log(user, 'sale.return', { sale_id: sale.id, return_id: returnId, total });
  return { ok: true, id: returnId, total };
});

function listReturns({ from, to, limit = 100 }) {
  const where = ['1=1'];
  const args = [];
  if (from) { where.push('date(r.date) >= date(?)'); args.push(from); }
  if (to) { where.push('date(r.date) <= date(?)'); args.push(to); }
  return db
    .prepare(
      `SELECT r.*, s.invoice_no, u.full_name AS user_name,
              (SELECT COUNT(*) FROM sale_return_items ri WHERE ri.return_id=r.id) AS lines
       FROM sale_returns r LEFT JOIN sales s ON s.id=r.sale_id LEFT JOIN users u ON u.id=r.user_id
       WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT ?`
    )
    .all(...args, Number(limit));
}

function holdSale(ctx) {
  requirePerm(ctx, 'pos');
  const key = 'held_sales';
  const held = JSON.parse(getSetting(key, '[]'));
  const entry = { id: Date.now(), at: nowStamp(), user: ctx.user.full_name, ...ctx.body };
  held.push(entry);
  setSetting(key, JSON.stringify(held.slice(-30)));
  return { ok: true, id: entry.id };
}
function listHeld(ctx) {
  requirePerm(ctx, 'pos');
  return JSON.parse(getSetting('held_sales', '[]'));
}
function dropHeld(ctx) {
  requirePerm(ctx, 'pos');
  const id = Number(ctx.params.id);
  const held = JSON.parse(getSetting('held_sales', '[]')).filter((h) => h.id !== id);
  setSetting('held_sales', JSON.stringify(held));
  return { ok: true };
}

module.exports = {
  createSale, getSale, listSales, createReturn, listReturns,
  allocateFEFO, partyBalance, nextInvoiceNo, round2, today, nowStamp,
  holdSale, listHeld, dropHeld
};
