'use strict';
const { db, getSetting } = require('../db');
const { requirePerm } = require('../auth');
const { round2 } = require('./sales');
const { PRODUCT_SELECT } = require('./inventory');

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + '01';

function rangeArgs(from, to) {
  return [from || '1900-01-01', to || '2999-12-31'];
}

/** لوحة التحكم */
function dashboard() {
  const t = today();
  const ms = monthStart();
  const alertDays = Number(getSetting('expiry_alert_days', 90));

  const q = (sql, ...a) => db.prepare(sql).get(...a);

  const salesToday = q(
    "SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM sales WHERE date(date)=date(?) AND status<>'returned'", t);
  const salesMonth = q(
    "SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM sales WHERE date(date)>=date(?) AND status<>'returned'", ms);
  const profitToday = q(
    `SELECT COALESCE(SUM(si.qty*si.price - si.qty*si.cost_price),0) p FROM sale_items si
     JOIN sales s ON s.id=si.sale_id WHERE date(s.date)=date(?)`, t).p
    - q('SELECT COALESCE(SUM(discount),0) d FROM sales WHERE date(date)=date(?)', t).d;
  const profitMonth = q(
    `SELECT COALESCE(SUM(si.qty*si.price - si.qty*si.cost_price),0) p FROM sale_items si
     JOIN sales s ON s.id=si.sale_id WHERE date(s.date)>=date(?)`, ms).p
    - q('SELECT COALESCE(SUM(discount),0) d FROM sales WHERE date(date)>=date(?)', ms).d;

  const expensesMonth = q('SELECT COALESCE(SUM(amount),0) a FROM expenses WHERE date(date)>=date(?)', ms).a;

  const stockValue = q('SELECT COALESCE(SUM(qty*cost_price),0) v FROM batches WHERE qty>0').v;
  const stockRetail = q(
    'SELECT COALESCE(SUM(b.qty*p.sale_price),0) v FROM batches b JOIN products p ON p.id=b.product_id WHERE b.qty>0').v;

  const expiredCount = q(
    "SELECT COUNT(*) n, COALESCE(SUM(qty*cost_price),0) v FROM batches WHERE qty>0 AND expiry_date IS NOT NULL AND expiry_date < ?", t);
  const expiringSoon = q(
    "SELECT COUNT(*) n, COALESCE(SUM(qty*cost_price),0) v FROM batches WHERE qty>0 AND expiry_date IS NOT NULL AND expiry_date >= ? AND expiry_date <= ?",
    t, addDays(alertDays));

  const lowStock = db.prepare(
    PRODUCT_SELECT + ' WHERE p.active=1 AND p.min_stock>0 AND stock <= p.min_stock ORDER BY stock ASC LIMIT 10').all();
  const lowStockCount = db.prepare(
    PRODUCT_SELECT + ' WHERE p.active=1 AND p.min_stock>0 AND stock <= p.min_stock').all().length;

  const debtors = q(
    `SELECT COUNT(*) n FROM customers c WHERE c.active=1 AND
       (c.opening_balance
        + COALESCE((SELECT SUM(s.total-s.paid) FROM sales s WHERE s.customer_id=c.id AND s.status<>'returned'),0)
        - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.party_type='customer' AND p.party_id=c.id AND p.direction='in'),0)) > 0.009`);
  const debtTotal = db.prepare(
    `SELECT COALESCE(SUM(s.total-s.paid),0) d FROM sales s WHERE s.status<>'returned' AND s.payment_method='credit'`).get().d;

  // مبيعات آخر 14 يوم
  const trend = db.prepare(
    `SELECT date(date) d, COALESCE(SUM(total),0) total, COUNT(*) n
     FROM sales WHERE date(date) >= date(?) AND status<>'returned'
     GROUP BY date(date) ORDER BY d`).all(addDays(-13));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(-i);
    const found = trend.find((x) => x.d === d);
    days.push({ date: d, total: found ? round2(found.total) : 0, count: found ? found.n : 0 });
  }

  const topProducts = db.prepare(
    `SELECT p.name, p.unit, SUM(si.qty) qty, SUM(si.qty*si.price) revenue
     FROM sale_items si JOIN products p ON p.id=si.product_id JOIN sales s ON s.id=si.sale_id
     WHERE date(s.date) >= date(?) GROUP BY si.product_id ORDER BY revenue DESC LIMIT 8`).all(ms);

  return {
    date: t,
    sales_today: { count: salesToday.n, total: round2(salesToday.total) },
    sales_month: { count: salesMonth.n, total: round2(salesMonth.total) },
    profit_today: round2(profitToday),
    profit_month: round2(profitMonth),
    expenses_month: round2(expensesMonth),
    net_month: round2(profitMonth - expensesMonth),
    stock_value: round2(stockValue),
    stock_retail: round2(stockRetail),
    products_count: q('SELECT COUNT(*) n FROM products WHERE active=1').n,
    expired: { count: expiredCount.n, value: round2(expiredCount.v) },
    expiring_soon: { count: expiringSoon.n, value: round2(expiringSoon.v), days: alertDays },
    low_stock_count: lowStockCount,
    low_stock: lowStock,
    debtors_count: debtors.n,
    debt_total: round2(debtTotal),
    trend: days,
    top_products: topProducts.map((p) => ({ ...p, qty: round2(p.qty), revenue: round2(p.revenue) }))
  };
}

/** تقرير المبيعات المفصّل */
function salesReport({ from, to, group_by = 'day' }) {
  const [f, t] = rangeArgs(from, to);
  const fmt = group_by === 'month' ? '%Y-%m' : group_by === 'hour' ? '%Y-%m-%d %H' : '%Y-%m-%d';
  const rows = db.prepare(
    `SELECT strftime('${fmt}', s.date) period, COUNT(DISTINCT s.id) invoices,
            COALESCE(SUM(si.qty*si.price),0) revenue,
            COALESCE(SUM(si.qty*si.cost_price),0) cost
     FROM sales s JOIN sale_items si ON si.sale_id=s.id
     WHERE date(s.date) BETWEEN date(?) AND date(?)
     GROUP BY period ORDER BY period`).all(f, t);
  const discounts = db.prepare(
    `SELECT strftime('${fmt}', date) period, COALESCE(SUM(discount),0) discount
     FROM sales WHERE date(date) BETWEEN date(?) AND date(?) GROUP BY period`).all(f, t);
  const dmap = Object.fromEntries(discounts.map((d) => [d.period, d.discount]));
  const out = rows.map((r) => {
    const disc = dmap[r.period] || 0;
    return {
      period: r.period, invoices: r.invoices,
      revenue: round2(r.revenue - disc), cost: round2(r.cost), discount: round2(disc),
      profit: round2(r.revenue - r.cost - disc)
    };
  });
  const totals = out.reduce((a, r) => ({
    invoices: a.invoices + r.invoices, revenue: round2(a.revenue + r.revenue),
    cost: round2(a.cost + r.cost), discount: round2(a.discount + r.discount),
    profit: round2(a.profit + r.profit)
  }), { invoices: 0, revenue: 0, cost: 0, discount: 0, profit: 0 });
  return { rows: out, totals };
}

/** الأصناف الأكثر مبيعاً / الأبطأ حركة */
function productsReport({ from, to, sort = 'revenue', limit = 100 }) {
  const [f, t] = rangeArgs(from, to);
  const rows = db.prepare(
    `SELECT p.id, p.name, p.unit, p.generic_name, p.sale_price,
            COALESCE(SUM(si.qty),0) qty,
            COALESCE(SUM(si.qty*si.price),0) revenue,
            COALESCE(SUM(si.qty*si.price - si.qty*si.cost_price),0) profit,
            COALESCE((SELECT SUM(b.qty) FROM batches b WHERE b.product_id=p.id),0) stock
     FROM products p
     LEFT JOIN sale_items si ON si.product_id = p.id
     LEFT JOIN sales s ON s.id = si.sale_id AND date(s.date) BETWEEN date(?) AND date(?)
     WHERE p.active = 1 AND (si.id IS NULL OR s.id IS NOT NULL)
     GROUP BY p.id ORDER BY ${sort === 'qty' ? 'qty' : sort === 'profit' ? 'profit' : 'revenue'} DESC
     LIMIT ?`).all(f, t, Number(limit));
  return rows.map((r) => ({ ...r, qty: round2(r.qty), revenue: round2(r.revenue), profit: round2(r.profit), stock: round2(r.stock) }));
}

function deadStockReport({ days = 90 }) {
  const since = addDays(-Number(days));
  return db.prepare(
    PRODUCT_SELECT +
    ` WHERE p.active=1 AND stock > 0 AND p.id NOT IN (
        SELECT DISTINCT si.product_id FROM sale_items si JOIN sales s ON s.id=si.sale_id
        WHERE date(s.date) >= date(?))
      ORDER BY (stock * cost_price) DESC LIMIT 200`).all(since);
}

/** تقرير الأرباح والخسائر */
function profitLoss({ from, to }) {
  const [f, t] = rangeArgs(from, to);
  const rev = db.prepare(
    `SELECT COALESCE(SUM(si.qty*si.price),0) revenue, COALESCE(SUM(si.qty*si.cost_price),0) cost
     FROM sale_items si JOIN sales s ON s.id=si.sale_id
     WHERE date(s.date) BETWEEN date(?) AND date(?)`).get(f, t);
  const disc = db.prepare(
    'SELECT COALESCE(SUM(discount),0) d FROM sales WHERE date(date) BETWEEN date(?) AND date(?)').get(f, t).d;
  const rets = db.prepare(
    'SELECT COALESCE(SUM(total),0) t FROM sale_returns WHERE date(date) BETWEEN date(?) AND date(?)').get(f, t).t;
  const exp = db.prepare(
    'SELECT COALESCE(SUM(amount),0) a FROM expenses WHERE date(date) BETWEEN date(?) AND date(?)').get(f, t).a;
  const expByCat = db.prepare(
    `SELECT category, COALESCE(SUM(amount),0) amount FROM expenses
     WHERE date(date) BETWEEN date(?) AND date(?) GROUP BY category ORDER BY amount DESC`).all(f, t);
  const revenue = round2(rev.revenue - disc - rets);
  const cogs = round2(rev.cost);
  const gross = round2(revenue - cogs);
  return {
    from: f, to: t,
    revenue, discounts: round2(disc), returns: round2(rets),
    cogs, gross_profit: gross,
    expenses: round2(exp), expenses_by_category: expByCat.map(e => ({ ...e, amount: round2(e.amount) })),
    net_profit: round2(gross - exp),
    margin: revenue > 0 ? round2((gross / revenue) * 100) : 0
  };
}

/** تقرير الذمم (المدينون) */
function debtorsReport() {
  const rows = db.prepare(
    `SELECT c.id, c.name, c.phone, c.credit_limit,
       (c.opening_balance
        + COALESCE((SELECT SUM(s.total-s.paid) FROM sales s WHERE s.customer_id=c.id AND s.status<>'returned'),0)
        - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.party_type='customer' AND p.party_id=c.id AND p.direction='in'),0)
       ) AS balance,
       (SELECT MAX(date) FROM sales s WHERE s.customer_id=c.id) AS last_sale
     FROM customers c WHERE c.active=1
     ORDER BY balance DESC`).all();
  const debtors = rows.filter((r) => r.balance > 0.009).map((r) => ({ ...r, balance: round2(r.balance) }));
  return { rows: debtors, total: round2(debtors.reduce((s, r) => s + r.balance, 0)) };
}

function suppliersDueReport() {
  const rows = db.prepare(
    `SELECT s.id, s.name, s.phone,
       (s.opening_balance
        + COALESCE((SELECT SUM(pu.total-pu.paid) FROM purchases pu WHERE pu.supplier_id=s.id),0)
        - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.party_type='supplier' AND p.party_id=s.id AND p.direction='out'),0)
       ) AS balance
     FROM suppliers s WHERE s.active=1 ORDER BY balance DESC`).all();
  const due = rows.filter((r) => Math.abs(r.balance) > 0.009).map((r) => ({ ...r, balance: round2(r.balance) }));
  return { rows: due, total: round2(due.reduce((s, r) => s + r.balance, 0)) };
}

/** تقرير أداء المستخدمين (الورديات) */
function usersReport({ from, to }) {
  const [f, t] = rangeArgs(from, to);
  return db.prepare(
    `SELECT u.id, u.full_name, u.role,
            COUNT(s.id) invoices, COALESCE(SUM(s.total),0) total,
            COALESCE(SUM(s.discount),0) discount
     FROM users u LEFT JOIN sales s ON s.user_id=u.id AND date(s.date) BETWEEN date(?) AND date(?)
     GROUP BY u.id ORDER BY total DESC`).all(f, t)
    .map((r) => ({ ...r, total: round2(r.total), discount: round2(r.discount) }));
}

/** قائمة الشراء المقترحة تلقائياً */
function purchaseSuggestion() {
  const rows = db.prepare(
    PRODUCT_SELECT +
    ` WHERE p.active=1 AND (stock <= p.min_stock OR stock <= 0)
      ORDER BY p.name LIMIT 300`).all();
  const sold30 = db.prepare(
    `SELECT si.product_id, SUM(si.qty) q FROM sale_items si JOIN sales s ON s.id=si.sale_id
     WHERE date(s.date) >= date(?) GROUP BY si.product_id`).all(addDays(-30));
  const smap = Object.fromEntries(sold30.map((r) => [r.product_id, r.q]));
  return rows.map((r) => {
    const monthly = smap[r.id] || 0;
    const target = Math.max(r.min_stock * 2, Math.ceil(monthly * 1.2));
    return {
      ...r,
      sold_last_30d: round2(monthly),
      suggested_qty: Math.max(1, Math.ceil(target - r.stock)),
      estimated_cost: round2(Math.max(1, Math.ceil(target - r.stock)) * (r.cost_price || 0))
    };
  });
}

module.exports = {
  dashboard, salesReport, productsReport, deadStockReport,
  profitLoss, debtorsReport, suppliersDueReport, usersReport, purchaseSuggestion
};
