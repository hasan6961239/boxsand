'use strict';
// الزبائن والموردون والدفعات والمصروفات
const { db, log } = require('../db');
const { HttpError } = require('../http');
const { requirePerm } = require('../auth');
const { partyBalance, round2, today, nowStamp } = require('./sales');

function listCustomers({ q, with_balance, limit = 200 }) {
  const where = ['active = 1'];
  const args = [];
  if (q) { where.push('(name LIKE ? OR phone LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const rows = db.prepare(`SELECT * FROM customers WHERE ${where.join(' AND ')} ORDER BY name LIMIT ?`)
    .all(...args, Number(limit));
  for (const r of rows) r.balance = partyBalance('customer', r.id);
  return with_balance === 'debt' ? rows.filter((r) => r.balance > 0.009) : rows;
}

function getCustomer(id) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'الزبون غير موجود');
  c.balance = partyBalance('customer', id);
  c.sales = db.prepare('SELECT id,invoice_no,date,total,paid,payment_method,status FROM sales WHERE customer_id = ? ORDER BY id DESC LIMIT 100').all(id);
  c.payments = db.prepare("SELECT * FROM payments WHERE party_type='customer' AND party_id = ? ORDER BY id DESC LIMIT 100").all(id);
  return c;
}

const CUST_FIELDS = ['name','phone','address','notes','credit_limit','opening_balance','active'];
function saveCustomer(ctx) {
  const user = requirePerm(ctx, 'customers.edit');
  const b = ctx.body || {};
  if (!b.name) throw new HttpError(400, 'اسم الزبون مطلوب');
  const d = {};
  for (const f of CUST_FIELDS) {
    let v = b[f];
    if (['credit_limit','opening_balance'].includes(f)) v = Number(v) || 0;
    else if (f === 'active') v = v === undefined ? 1 : (v ? 1 : 0);
    else v = v === undefined ? null : v;
    d[f] = v;
  }
  if (b.id) {
    db.prepare(`UPDATE customers SET ${CUST_FIELDS.map(f=>`${f}=@${f}`).join(',')} WHERE id=@id`).run({ ...d, id: b.id });
    log(user, 'customer.update', { id: b.id });
    return getCustomer(b.id);
  }
  const info = db.prepare(`INSERT INTO customers(${CUST_FIELDS.join(',')}) VALUES(${CUST_FIELDS.map(f=>'@'+f).join(',')})`).run(d);
  log(user, 'customer.create', { id: info.lastInsertRowid, name: d.name });
  return getCustomer(info.lastInsertRowid);
}

function listSuppliers({ q, limit = 200 }) {
  const where = ['active = 1'];
  const args = [];
  if (q) { where.push('(name LIKE ? OR phone LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const rows = db.prepare(`SELECT * FROM suppliers WHERE ${where.join(' AND ')} ORDER BY name LIMIT ?`)
    .all(...args, Number(limit));
  for (const r of rows) r.balance = partyBalance('supplier', r.id);
  return rows;
}

function getSupplier(id) {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!s) throw new HttpError(404, 'المورد غير موجود');
  s.balance = partyBalance('supplier', id);
  s.purchases = db.prepare('SELECT id,invoice_no,date,total,paid FROM purchases WHERE supplier_id = ? ORDER BY id DESC LIMIT 100').all(id);
  s.payments = db.prepare("SELECT * FROM payments WHERE party_type='supplier' AND party_id = ? ORDER BY id DESC LIMIT 100").all(id);
  return s;
}

const SUP_FIELDS = ['name','phone','address','notes','opening_balance','active'];
function saveSupplier(ctx) {
  const user = requirePerm(ctx, 'suppliers.edit');
  const b = ctx.body || {};
  if (!b.name) throw new HttpError(400, 'اسم المورد مطلوب');
  const d = {};
  for (const f of SUP_FIELDS) {
    let v = b[f];
    if (f === 'opening_balance') v = Number(v) || 0;
    else if (f === 'active') v = v === undefined ? 1 : (v ? 1 : 0);
    else v = v === undefined ? null : v;
    d[f] = v;
  }
  if (b.id) {
    db.prepare(`UPDATE suppliers SET ${SUP_FIELDS.map(f=>`${f}=@${f}`).join(',')} WHERE id=@id`).run({ ...d, id: b.id });
    log(user, 'supplier.update', { id: b.id });
    return getSupplier(b.id);
  }
  const info = db.prepare(`INSERT INTO suppliers(${SUP_FIELDS.join(',')}) VALUES(${SUP_FIELDS.map(f=>'@'+f).join(',')})`).run(d);
  log(user, 'supplier.create', { id: info.lastInsertRowid, name: d.name });
  return getSupplier(info.lastInsertRowid);
}

function addPayment(ctx) {
  const b = ctx.body || {};
  const type = b.party_type === 'supplier' ? 'supplier' : 'customer';
  requirePerm(ctx, type === 'supplier' ? 'suppliers.edit' : 'customers.edit');
  const amount = round2(Number(b.amount));
  if (!(amount > 0)) throw new HttpError(400, 'أدخل مبلغاً صحيحاً');
  if (!b.party_id) throw new HttpError(400, 'حدد الطرف');
  const direction = type === 'customer' ? 'in' : 'out';
  const info = db
    .prepare('INSERT INTO payments(party_type,party_id,amount,direction,date,note,user_id) VALUES(?,?,?,?,?,?,?)')
    .run(type, b.party_id, amount, direction, b.date || nowStamp(), b.note || null, ctx.user.id);
  log(ctx.user, 'payment.create', { type, party_id: b.party_id, amount });
  return { ok: true, id: info.lastInsertRowid, balance: partyBalance(type, b.party_id) };
}

function deletePayment(ctx) {
  requirePerm(ctx, 'customers.edit');
  db.prepare('DELETE FROM payments WHERE id = ?').run(Number(ctx.params.id));
  return { ok: true };
}

function listExpenses({ from, to, limit = 200 }) {
  const where = ['1=1'];
  const args = [];
  if (from) { where.push('date(date) >= date(?)'); args.push(from); }
  if (to) { where.push('date(date) <= date(?)'); args.push(to); }
  const rows = db.prepare(
    `SELECT e.*, u.full_name AS user_name FROM expenses e LEFT JOIN users u ON u.id=e.user_id
     WHERE ${where.join(' AND ')} ORDER BY e.id DESC LIMIT ?`).all(...args, Number(limit));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return { rows, total: round2(total) };
}

function saveExpense(ctx) {
  requirePerm(ctx, 'expenses.view');
  const b = ctx.body || {};
  const amount = round2(Number(b.amount));
  if (!(amount > 0)) throw new HttpError(400, 'أدخل مبلغاً صحيحاً');
  if (b.id) {
    db.prepare('UPDATE expenses SET date=?,category=?,amount=?,note=? WHERE id=?')
      .run(b.date || today(), b.category || 'عام', amount, b.note || null, b.id);
    return { ok: true, id: b.id };
  }
  const info = db.prepare('INSERT INTO expenses(date,category,amount,note,user_id) VALUES(?,?,?,?,?)')
    .run(b.date || today(), b.category || 'عام', amount, b.note || null, ctx.user.id);
  log(ctx.user, 'expense.create', { id: info.lastInsertRowid, amount });
  return { ok: true, id: info.lastInsertRowid };
}

function deleteExpense(ctx) {
  requirePerm(ctx, 'expenses.view');
  db.prepare('DELETE FROM expenses WHERE id = ?').run(Number(ctx.params.id));
  return { ok: true };
}

module.exports = {
  listCustomers, getCustomer, saveCustomer,
  listSuppliers, getSupplier, saveSupplier,
  addPayment, deletePayment,
  listExpenses, saveExpense, deleteExpense
};
