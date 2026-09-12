// ===== محرّك العرض التجريبي =====
// ينفّذ نفس واجهة الـ API لكن داخل المتصفح، بدون خادم.
// يُستخدم في نسخة العرض القابلة للمشاركة عبر رابط.

const d2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const dToday = () => new Date().toISOString().slice(0, 10);
const dNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const dAddDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const dDay = (s) => String(s || '').slice(0, 10);

class DemoError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function createDemoEngine(SEED) {
  // نسخة عمل مستقلة حتى لا تتأثر البيانات الأصلية
  const DB = JSON.parse(JSON.stringify(SEED.data));
  const SETTINGS = { ...SEED.settings };
  const USERS = SEED.users;
  const BUILD_DATE = SEED.built_at.slice(0, 10);

  // ---- إزاحة التواريخ: تبقى نسخة العرض "حيّة" مهما مرّ الوقت على بنائها ----
  const shiftDays = Math.round((new Date(dToday()) - new Date(BUILD_DATE)) / 864e5);
  if (shiftDays > 0) {
    const bump = (s) => {
      if (!s) return s;
      const hasTime = String(s).length > 10;
      const d = new Date(String(s).replace(' ', 'T') + (hasTime ? '' : 'T00:00:00'));
      if (isNaN(d)) return s;
      d.setDate(d.getDate() + shiftDays);
      const iso = d.toISOString();
      return hasTime ? iso.slice(0, 19).replace('T', ' ') : iso.slice(0, 10);
    };
    DB.sales.forEach((s) => { s.date = bump(s.date); });
    DB.batches.forEach((b) => { b.expiry_date = bump(b.expiry_date); b.created_at = bump(b.created_at); });
    DB.purchases.forEach((p) => { p.date = bump(p.date); });
    DB.expenses.forEach((e) => { e.date = bump(e.date); });
    DB.payments.forEach((p) => { p.date = bump(p.date); });
  }

  let seq = Math.max(0, ...DB.sales.map((s) => Number(String(s.invoice_no).split('-')[1]) || 0));
  let nextId = 900000;
  const newId = () => ++nextId;

  let session = null;
  let held = [];
  const activity = [];
  const logAct = (action, details) => activity.unshift({
    id: newId(), at: dNow(), username: session ? session.username : 'demo',
    action, details: typeof details === 'string' ? details : JSON.stringify(details || {})
  });

  // ---------- مساعدات ----------
  const byId = (arr, id) => arr.find((x) => x.id === Number(id));
  const catName = (id) => (byId(DB.categories, id) || {}).name || null;

  function productRow(p) {
    const t = dToday();
    const bs = DB.batches.filter((b) => b.product_id === p.id);
    const live = bs.filter((b) => !b.expiry_date || b.expiry_date >= t);
    const sellable = live.reduce((s, b) => s + b.qty, 0);
    const expired = bs.filter((b) => b.expiry_date && b.expiry_date < t).reduce((s, b) => s + b.qty, 0);
    const withStock = live.filter((b) => b.qty > 0 && b.expiry_date)
      .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
    const cheapest = live.filter((b) => b.qty > 0)
      .sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'))[0];
    return {
      ...p,
      category_name: catName(p.category_id),
      stock: d2(bs.reduce((s, b) => s + b.qty, 0)),
      sellable_stock: d2(sellable),
      expired_qty: d2(expired),
      nearest_expiry: withStock.length ? withStock[0].expiry_date : null,
      cost_price: cheapest ? cheapest.cost_price : 0
    };
  }

  function partyBalance(type, id) {
    id = Number(id);
    if (type === 'customer') {
      const c = byId(DB.customers, id); if (!c) return 0;
      const sales = DB.sales.filter((s) => s.customer_id === id && s.status !== 'returned')
        .reduce((a, s) => a + (s.total - s.paid), 0);
      const rets = DB.sale_returns.filter((r) => {
        const s = byId(DB.sales, r.sale_id); return s && s.customer_id === id;
      }).reduce((a, r) => a + r.total, 0);
      const pays = DB.payments.filter((p) => p.party_type === 'customer' && p.party_id === id && p.direction === 'in')
        .reduce((a, p) => a + p.amount, 0);
      return d2(c.opening_balance + sales - rets - pays);
    }
    const sup = byId(DB.suppliers, id); if (!sup) return 0;
    const pur = DB.purchases.filter((p) => p.supplier_id === id).reduce((a, p) => a + (p.total - p.paid), 0);
    const pays = DB.payments.filter((p) => p.party_type === 'supplier' && p.party_id === id && p.direction === 'out')
      .reduce((a, p) => a + p.amount, 0);
    return d2(sup.opening_balance + pur - pays);
  }

  function requireAuth() { if (!session) throw new DemoError('يجب تسجيل الدخول', 401); return session; }

  // ---------- البيع ----------
  function allocateFEFO(productId, qty) {
    const t = dToday();
    const batches = DB.batches
      .filter((b) => b.product_id === Number(productId) && b.qty > 0 && (!b.expiry_date || b.expiry_date >= t))
      .sort((a, b) => (a.expiry_date || '9999-12-31').localeCompare(b.expiry_date || '9999-12-31') || a.id - b.id);
    const avail = batches.reduce((s, b) => s + b.qty, 0);
    if (avail + 1e-9 < qty) {
      const p = byId(DB.products, productId);
      throw new DemoError(`الكمية غير متوفرة للصنف «${p ? p.name : ''}» — المتاح ${d2(avail)}`);
    }
    const out = [];
    let rem = qty;
    for (const b of batches) {
      if (rem <= 1e-9) break;
      const take = Math.min(b.qty, rem);
      out.push({ batch: b, qty: take });
      rem = d2(rem - take);
    }
    return out;
  }

  function createSale(body) {
    const user = requireAuth();
    const items = body.items || [];
    if (!items.length) throw new DemoError('الفاتورة فارغة');
    const discount = d2(Number(body.discount) || 0);
    const method = body.payment_method === 'credit' ? 'credit' : 'cash';
    const customerId = body.customer_id ? Number(body.customer_id) : null;
    if (method === 'credit' && !customerId) throw new DemoError('البيع بالآجل يتطلب اختيار زبون');

    if (method === 'credit' && customerId) {
      const c = byId(DB.customers, customerId);
      if (c && c.credit_limit > 0) {
        const invTotal = items.reduce((s, i) => s + i.qty * i.price, 0) - discount;
        const bal = partyBalance('customer', customerId);
        if (bal + invTotal > c.credit_limit) {
          throw new DemoError(`تجاوز حد الائتمان للزبون «${c.name}». الرصيد ${d2(bal)} والحد ${c.credit_limit}`);
        }
      }
    }

    // تحقق من الكميات قبل أي تعديل
    const plan = items.map((it) => ({ it, alloc: allocateFEFO(it.product_id, Number(it.qty)) }));

    const saleId = newId();
    seq += 1;
    const invoiceNo = `${SETTINGS.invoice_prefix || 'ف'}-${String(seq).padStart(6, '0')}`;
    let subtotal = 0;

    for (const { it, alloc } of plan) {
      for (const a of alloc) {
        a.batch.qty = d2(a.batch.qty - a.qty);
        DB.sale_items.push({
          id: newId(), sale_id: saleId, product_id: Number(it.product_id), batch_id: a.batch.id,
          qty: a.qty, price: Number(it.price), cost_price: a.batch.cost_price, returned_qty: 0
        });
      }
      subtotal += Number(it.qty) * Number(it.price);
    }
    subtotal = d2(subtotal);
    const total = d2(Math.max(0, subtotal - discount));
    const paid = method === 'credit' ? d2(Number(body.paid) || 0) : total;

    DB.sales.push({
      id: saleId, invoice_no: invoiceNo, date: dNow(), customer_id: customerId,
      user_id: user.id, subtotal, discount, total, paid, payment_method: method,
      status: 'done', notes: body.notes || null
    });
    logAct('sale.create', { invoice_no: invoiceNo, total });
    return getSale(saleId);
  }

  function getSale(id) {
    const s = byId(DB.sales, id);
    if (!s) throw new DemoError('الفاتورة غير موجودة', 404);
    const rawItems = DB.sale_items.filter((i) => i.sale_id === s.id);
    const grouped = {};
    for (const i of rawItems) {
      const key = i.product_id + '|' + i.price;
      const p = byId(DB.products, i.product_id) || {};
      grouped[key] = grouped[key] || {
        product_id: i.product_id, product_name: p.name, unit: p.unit, form: p.form,
        strength: p.strength, price: i.price, qty: 0, cost_total: 0, returned_qty: 0
      };
      grouped[key].qty = d2(grouped[key].qty + i.qty);
      grouped[key].cost_total += i.qty * i.cost_price;
      grouped[key].returned_qty += i.returned_qty || 0;
    }
    const items = Object.values(grouped);
    const cust = s.customer_id ? byId(DB.customers, s.customer_id) : null;
    const user = USERS.find((u) => u.id === s.user_id);
    return {
      ...s,
      customer_name: cust ? cust.name : null,
      customer_phone: cust ? cust.phone : null,
      user_name: user ? user.full_name : null,
      items,
      profit: d2(items.reduce((a, i) => a + i.qty * i.price - i.cost_total, 0) - s.discount),
      returns: DB.sale_returns.filter((r) => r.sale_id === s.id)
    };
  }

  function createReturn(body) {
    requireAuth();
    const sale = byId(DB.sales, body.sale_id);
    if (!sale) throw new DemoError('الفاتورة غير موجودة', 404);
    const lines = (body.items || []).filter((l) => Number(l.qty) > 0);
    if (!lines.length) throw new DemoError('حدد الأصناف المراد إرجاعها');

    const retId = newId();
    let total = 0;
    for (const line of lines) {
      let rem = Number(line.qty);
      const sis = DB.sale_items.filter((i) =>
        i.sale_id === sale.id && i.product_id === Number(line.product_id) && i.price === Number(line.price));
      const returnable = sis.reduce((s, i) => s + (i.qty - (i.returned_qty || 0)), 0);
      if (rem - 1e-9 > returnable) {
        const p = byId(DB.products, line.product_id);
        throw new DemoError(`الكمية المراد إرجاعها أكبر من المباع للصنف «${p ? p.name : ''}»`);
      }
      for (const si of sis) {
        if (rem <= 1e-9) break;
        const take = Math.min(si.qty - (si.returned_qty || 0), rem);
        if (take <= 0) continue;
        si.returned_qty = d2((si.returned_qty || 0) + take);
        const b = byId(DB.batches, si.batch_id);
        if (b) b.qty = d2(b.qty + take);
        total += take * si.price;
        rem = d2(rem - take);
      }
    }
    total = d2(total);
    DB.sale_returns.push({ id: retId, sale_id: sale.id, date: dNow(), total, reason: body.reason || null, user_id: session.id });
    if (sale.payment_method === 'cash') sale.paid = d2(Math.max(0, sale.paid - total));
    const remain = DB.sale_items.filter((i) => i.sale_id === sale.id)
      .reduce((s, i) => s + (i.qty - (i.returned_qty || 0)), 0);
    if (remain <= 1e-9) sale.status = 'returned';
    logAct('sale.return', { sale_id: sale.id, total });
    return { ok: true, id: retId, total };
  }

  // ---------- التقارير ----------
  function inRange(d, from, to) {
    const x = dDay(d);
    return (!from || x >= from) && (!to || x <= to);
  }

  function dashboard() {
    const t = dToday();
    const ms = t.slice(0, 8) + '01';
    const alertDays = Number(SETTINGS.expiry_alert_days || 90);
    const live = DB.sales.filter((s) => s.status !== 'returned');

    const sumRange = (from) => {
      const rows = live.filter((s) => dDay(s.date) >= from);
      return { count: rows.length, total: d2(rows.reduce((a, s) => a + s.total, 0)) };
    };
    const todaySales = live.filter((s) => dDay(s.date) === t);
    const profitFor = (from) => {
      const ids = new Set(DB.sales.filter((s) => dDay(s.date) >= from).map((s) => s.id));
      const gross = DB.sale_items.filter((i) => ids.has(i.sale_id))
        .reduce((a, i) => a + i.qty * i.price - i.qty * i.cost_price, 0);
      const disc = DB.sales.filter((s) => ids.has(s.id)).reduce((a, s) => a + s.discount, 0);
      return d2(gross - disc);
    };

    const expiredB = DB.batches.filter((b) => b.qty > 0 && b.expiry_date && b.expiry_date < t);
    const soonB = DB.batches.filter((b) => b.qty > 0 && b.expiry_date && b.expiry_date >= t && b.expiry_date <= dAddDays(alertDays));
    const rows = DB.products.filter((p) => p.active).map(productRow);
    const lowStock = rows.filter((p) => p.min_stock > 0 && p.sellable_stock <= p.min_stock)
      .sort((a, b) => a.sellable_stock - b.sellable_stock);

    const trend = [];
    for (let i = 13; i >= 0; i--) {
      const d = dAddDays(-i);
      const day = live.filter((s) => dDay(s.date) === d);
      trend.push({ date: d, total: d2(day.reduce((a, s) => a + s.total, 0)), count: day.length });
    }

    const monthIds = new Set(DB.sales.filter((s) => dDay(s.date) >= ms).map((s) => s.id));
    const agg = {};
    DB.sale_items.filter((i) => monthIds.has(i.sale_id)).forEach((i) => {
      const p = byId(DB.products, i.product_id) || {};
      agg[i.product_id] = agg[i.product_id] || { name: p.name, unit: p.unit, qty: 0, revenue: 0 };
      agg[i.product_id].qty = d2(agg[i.product_id].qty + i.qty);
      agg[i.product_id].revenue = d2(agg[i.product_id].revenue + i.qty * i.price);
    });

    const expensesMonth = DB.expenses.filter((e) => dDay(e.date) >= ms).reduce((a, e) => a + e.amount, 0);
    const debt = live.filter((s) => s.payment_method === 'credit').reduce((a, s) => a + (s.total - s.paid), 0);
    const debtors = DB.customers.filter((c) => c.active && partyBalance('customer', c.id) > 0.009);
    const profitMonth = profitFor(ms);

    return {
      date: t,
      sales_today: { count: todaySales.length, total: d2(todaySales.reduce((a, s) => a + s.total, 0)) },
      sales_month: sumRange(ms),
      profit_today: profitFor(t),
      profit_month: profitMonth,
      expenses_month: d2(expensesMonth),
      net_month: d2(profitMonth - expensesMonth),
      stock_value: d2(DB.batches.reduce((a, b) => a + b.qty * b.cost_price, 0)),
      stock_retail: d2(DB.batches.reduce((a, b) => {
        const p = byId(DB.products, b.product_id); return a + b.qty * (p ? p.sale_price : 0); }, 0)),
      products_count: rows.length,
      expired: { count: expiredB.length, value: d2(expiredB.reduce((a, b) => a + b.qty * b.cost_price, 0)) },
      expiring_soon: { count: soonB.length, value: d2(soonB.reduce((a, b) => a + b.qty * b.cost_price, 0)), days: alertDays },
      low_stock_count: lowStock.length,
      low_stock: lowStock.slice(0, 10),
      debtors_count: debtors.length,
      debt_total: d2(debt),
      trend,
      top_products: Object.values(agg).sort((a, b) => b.revenue - a.revenue).slice(0, 8)
    };
  }

  function expiryReport(days) {
    const n = Number(days || SETTINGS.expiry_alert_days || 90);
    const t = dToday();
    const limit = dAddDays(n);
    const rows = DB.batches
      .filter((b) => b.qty > 0 && b.expiry_date && b.expiry_date <= limit)
      .map((b) => {
        const p = byId(DB.products, b.product_id) || {};
        return {
          ...b, product_name: p.name, unit: p.unit, sale_price: p.sale_price, location: p.location,
          value: d2(b.qty * b.cost_price),
          days_left: Math.round((new Date(b.expiry_date) - new Date(t)) / 864e5)
        };
      })
      .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
    return {
      alert_days: n,
      expired: rows.filter((r) => r.expiry_date < t),
      expiring_soon: rows.filter((r) => r.expiry_date >= t),
      total_value_at_risk: d2(rows.reduce((a, r) => a + r.value, 0))
    };
  }

  function profitLoss(from, to) {
    const ids = new Set(DB.sales.filter((s) => inRange(s.date, from, to)).map((s) => s.id));
    const its = DB.sale_items.filter((i) => ids.has(i.sale_id));
    const gross = its.reduce((a, i) => a + i.qty * i.price, 0);
    const cost = its.reduce((a, i) => a + i.qty * i.cost_price, 0);
    const disc = DB.sales.filter((s) => ids.has(s.id)).reduce((a, s) => a + s.discount, 0);
    const rets = DB.sale_returns.filter((r) => inRange(r.date, from, to)).reduce((a, r) => a + r.total, 0);
    const exps = DB.expenses.filter((e) => inRange(e.date, from, to));
    const expTotal = exps.reduce((a, e) => a + e.amount, 0);
    const byCat = {};
    exps.forEach((e) => { byCat[e.category] = d2((byCat[e.category] || 0) + e.amount); });
    const revenue = d2(gross - disc - rets);
    const cogs = d2(cost);
    const grossProfit = d2(revenue - cogs);
    return {
      from: from || '1900-01-01', to: to || '2999-12-31',
      revenue, discounts: d2(disc), returns: d2(rets), cogs,
      gross_profit: grossProfit, expenses: d2(expTotal),
      expenses_by_category: Object.entries(byCat).map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount),
      net_profit: d2(grossProfit - expTotal),
      margin: revenue > 0 ? d2((grossProfit / revenue) * 100) : 0
    };
  }

  function salesReport(from, to, groupBy) {
    const fmt = (d) => groupBy === 'month' ? dDay(d).slice(0, 7) : dDay(d);
    const buckets = {};
    DB.sales.filter((s) => inRange(s.date, from, to)).forEach((s) => {
      const k = fmt(s.date);
      buckets[k] = buckets[k] || { period: k, invoices: 0, revenue: 0, cost: 0, discount: 0 };
      buckets[k].invoices += 1;
      buckets[k].discount += s.discount;
      DB.sale_items.filter((i) => i.sale_id === s.id).forEach((i) => {
        buckets[k].revenue += i.qty * i.price;
        buckets[k].cost += i.qty * i.cost_price;
      });
    });
    const rows = Object.values(buckets).sort((a, b) => a.period.localeCompare(b.period)).map((b) => ({
      period: b.period, invoices: b.invoices,
      revenue: d2(b.revenue - b.discount), cost: d2(b.cost), discount: d2(b.discount),
      profit: d2(b.revenue - b.cost - b.discount)
    }));
    const totals = rows.reduce((a, r) => ({
      invoices: a.invoices + r.invoices, revenue: d2(a.revenue + r.revenue),
      cost: d2(a.cost + r.cost), discount: d2(a.discount + r.discount),
      profit: d2(a.profit + r.profit)
    }), { invoices: 0, revenue: 0, cost: 0, discount: 0, profit: 0 });
    return { rows, totals };
  }

  function productsReport(from, to) {
    const ids = new Set(DB.sales.filter((s) => inRange(s.date, from, to)).map((s) => s.id));
    return DB.products.filter((p) => p.active).map((p) => {
      const its = DB.sale_items.filter((i) => i.product_id === p.id && ids.has(i.sale_id));
      const row = productRow(p);
      return {
        id: p.id, name: p.name, unit: p.unit, generic_name: p.generic_name, sale_price: p.sale_price,
        qty: d2(its.reduce((a, i) => a + i.qty, 0)),
        revenue: d2(its.reduce((a, i) => a + i.qty * i.price, 0)),
        profit: d2(its.reduce((a, i) => a + i.qty * i.price - i.qty * i.cost_price, 0)),
        stock: row.stock
      };
    }).sort((a, b) => b.revenue - a.revenue);
  }

  function deadStock(days) {
    const since = dAddDays(-Number(days || 90));
    const active = new Set(DB.sale_items
      .filter((i) => { const s = byId(DB.sales, i.sale_id); return s && dDay(s.date) >= since; })
      .map((i) => i.product_id));
    return DB.products.filter((p) => p.active).map(productRow)
      .filter((p) => p.stock > 0 && !active.has(p.id))
      .sort((a, b) => b.stock * b.cost_price - a.stock * a.cost_price);
  }

  function purchaseSuggestion() {
    const since = dAddDays(-30);
    const sold = {};
    DB.sale_items.forEach((i) => {
      const s = byId(DB.sales, i.sale_id);
      if (s && dDay(s.date) >= since) sold[i.product_id] = d2((sold[i.product_id] || 0) + i.qty);
    });
    return DB.products.filter((p) => p.active).map(productRow)
      .filter((p) => p.sellable_stock <= p.min_stock || p.sellable_stock <= 0)
      .map((p) => {
        const monthly = sold[p.id] || 0;
        const target = Math.max(p.min_stock * 2, Math.ceil(monthly * 1.2));
        const qty = Math.max(1, Math.ceil(target - p.sellable_stock));
        return { ...p, sold_last_30d: monthly, suggested_qty: qty, estimated_cost: d2(qty * (p.cost_price || 0)) };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }

  function usersReport(from, to) {
    return USERS.map((u) => {
      const rows = DB.sales.filter((s) => s.user_id === u.id && inRange(s.date, from, to));
      return {
        id: u.id, full_name: u.full_name, role: u.role, invoices: rows.length,
        total: d2(rows.reduce((a, s) => a + s.total, 0)),
        discount: d2(rows.reduce((a, s) => a + s.discount, 0))
      };
    }).sort((a, b) => b.total - a.total);
  }

  // ---------- الموجّه ----------
  const ROUTES = [
    ['POST', /^\/auth\/login$/, (m, q, b) => {
      const u = USERS.find((x) => x.username === String(b.username || '').trim());
      if (!u || String(b.password) !== u.password) throw new DemoError('اسم المستخدم أو كلمة المرور غير صحيحة', 401);
      session = u;
      logAct('login', { username: u.username });
      return { token: 'demo-' + u.username, user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role }, permissions: u.permissions };
    }],
    ['POST', /^\/auth\/logout$/, () => { session = null; return { ok: true }; }],
    ['GET', /^\/auth\/me$/, () => {
      const u = requireAuth();
      return { user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role }, permissions: u.permissions, settings: SETTINGS };
    }],
    ['POST', /^\/auth\/password$/, () => { throw new DemoError('تغيير كلمة المرور غير متاح في نسخة العرض'); }],

    ['GET', /^\/products\/search$/, (m, q) => {
      const term = String(q.q || '').trim();
      if (!term) return [];
      const rows = DB.products.filter((p) => p.active).map(productRow).filter((p) =>
        p.barcode === term || (p.name || '').includes(term) || (p.generic_name || '').includes(term));
      rows.sort((a, b) =>
        (b.barcode === term) - (a.barcode === term) ||
        (b.sellable_stock > 0) - (a.sellable_stock > 0) ||
        (b.name.startsWith(term)) - (a.name.startsWith(term)) ||
        a.name.localeCompare(b.name, 'ar'));
      return rows.slice(0, Number(q.limit) || 25);
    }],
    ['GET', /^\/products$/, (m, q) => {
      let rows = DB.products.filter((p) => (q.only_active === '0' ? true : p.active)).map(productRow);
      if (q.q) {
        const t = q.q;
        rows = rows.filter((p) => (p.name || '').includes(t) || (p.generic_name || '').includes(t)
          || p.barcode === t || (p.manufacturer || '').includes(t));
      }
      if (q.category_id) rows = rows.filter((p) => p.category_id === Number(q.category_id));
      if (q.stock_filter === 'low') rows = rows.filter((p) => p.sellable_stock <= p.min_stock);
      if (q.stock_filter === 'out') rows = rows.filter((p) => p.sellable_stock <= 0);
      return rows.sort((a, b) => a.name.localeCompare(b.name, 'ar')).slice(0, Number(q.limit) || 200);
    }],
    ['GET', /^\/products\/(\d+)$/, (m) => {
      const p = byId(DB.products, m[1]);
      if (!p) throw new DemoError('الصنف غير موجود', 404);
      const row = productRow(p);
      row.batches = DB.batches.filter((b) => b.product_id === p.id)
        .sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'));
      row.alternatives = p.generic_name
        ? DB.products.filter((x) => x.active && x.generic_name === p.generic_name && x.id !== p.id).map(productRow)
        : [];
      return row;
    }],
    ['POST', /^\/products$/, (m, q, b) => {
      requireAuth();
      if (!b.name) throw new DemoError('اسم الصنف مطلوب');
      if (b.id) {
        const p = byId(DB.products, b.id);
        Object.assign(p, b, { category_id: b.category_id ? Number(b.category_id) : null,
          sale_price: Number(b.sale_price) || 0, min_stock: Number(b.min_stock) || 0 });
        logAct('product.update', { id: p.id });
        return productRow(p);
      }
      const p = { ...b, id: newId(), active: 1, category_id: b.category_id ? Number(b.category_id) : null,
        sale_price: Number(b.sale_price) || 0, min_stock: Number(b.min_stock) || 0 };
      DB.products.push(p);
      if (Number(b.opening_qty) > 0) {
        DB.batches.push({ id: newId(), product_id: p.id, batch_no: b.opening_batch_no || null,
          expiry_date: b.opening_expiry || null, qty: Number(b.opening_qty), cost_price: Number(b.opening_cost) || 0 });
      }
      logAct('product.create', { name: p.name });
      return productRow(p);
    }],
    ['DELETE', /^\/products\/(\d+)$/, (m) => {
      requireAuth();
      const id = Number(m[1]);
      if (DB.sale_items.some((i) => i.product_id === id)) {
        const p = byId(DB.products, id); if (p) p.active = 0;
        return { ok: true, archived: true, message: 'الصنف مرتبط بفواتير، تم أرشفته بدل حذفه' };
      }
      DB.batches = DB.batches.filter((b) => b.product_id !== id);
      DB.products = DB.products.filter((p) => p.id !== id);
      return { ok: true };
    }],

    ['GET', /^\/batches$/, (m, q) => DB.batches.filter((b) => b.product_id === Number(q.product_id))],
    ['POST', /^\/batches$/, (m, q, b) => {
      requireAuth();
      if (b.id) { Object.assign(byId(DB.batches, b.id), b, { qty: Number(b.qty) || 0, cost_price: Number(b.cost_price) || 0 }); return { ok: true, id: b.id }; }
      const nb = { id: newId(), product_id: Number(b.product_id), batch_no: b.batch_no || null,
        expiry_date: b.expiry_date || null, qty: Number(b.qty) || 0, cost_price: Number(b.cost_price) || 0 };
      DB.batches.push(nb);
      return { ok: true, id: nb.id };
    }],
    ['DELETE', /^\/batches\/(\d+)$/, (m) => { DB.batches = DB.batches.filter((b) => b.id !== Number(m[1])); return { ok: true }; }],
    ['POST', /^\/stock\/adjust$/, (m, q, b) => {
      requireAuth();
      const batch = byId(DB.batches, b.batch_id);
      if (!batch) throw new DemoError('الدفعة غير موجودة', 404);
      batch.qty = Number(b.new_qty) || 0;
      logAct('stock.adjust', { batch_id: batch.id, reason: b.reason });
      return { ok: true };
    }],

    ['GET', /^\/categories$/, () => DB.categories.map((c) => ({
      ...c, products_count: DB.products.filter((p) => p.category_id === c.id).length })).sort((a, b) => a.name.localeCompare(b.name, 'ar'))],
    ['POST', /^\/categories$/, (m, q, b) => {
      requireAuth();
      if (b.id) { byId(DB.categories, b.id).name = b.name; return { ok: true, id: b.id }; }
      const c = { id: newId(), name: b.name }; DB.categories.push(c); return { ok: true, id: c.id };
    }],
    ['DELETE', /^\/categories\/(\d+)$/, (m) => {
      const id = Number(m[1]);
      DB.products.forEach((p) => { if (p.category_id === id) p.category_id = null; });
      DB.categories = DB.categories.filter((c) => c.id !== id);
      return { ok: true };
    }],

    ['GET', /^\/alerts\/expiry$/, (m, q) => expiryReport(q.days)],
    ['GET', /^\/alerts\/low-stock$/, () => DB.products.filter((p) => p.active).map(productRow)
      .filter((p) => p.min_stock > 0 && p.sellable_stock <= p.min_stock)],

    ['POST', /^\/sales$/, (m, q, b) => createSale(b)],
    ['GET', /^\/sales$/, (m, q) => {
      let rows = DB.sales.filter((s) => inRange(s.date, q.from, q.to));
      if (q.customer_id) rows = rows.filter((s) => s.customer_id === Number(q.customer_id));
      if (q.payment_method) rows = rows.filter((s) => s.payment_method === q.payment_method);
      if (q.q) {
        const t = q.q;
        rows = rows.filter((s) => {
          const c = s.customer_id ? byId(DB.customers, s.customer_id) : null;
          return String(s.invoice_no).includes(t) || (c && c.name.includes(t));
        });
      }
      const summary = { count: rows.length, total: d2(rows.reduce((a, s) => a + s.total, 0)),
        paid: d2(rows.reduce((a, s) => a + s.paid, 0)) };
      const out = rows.sort((a, b2) => b2.id - a.id).slice(0, Number(q.limit) || 100).map((s) => {
        const c = s.customer_id ? byId(DB.customers, s.customer_id) : null;
        const u = USERS.find((x) => x.id === s.user_id);
        const its = DB.sale_items.filter((i) => i.sale_id === s.id);
        return { ...s, customer_name: c ? c.name : null, user_name: u ? u.full_name : null,
          profit: d2(its.reduce((a, i) => a + i.qty * i.price - i.qty * i.cost_price, 0) - s.discount) };
      });
      return { rows: out, summary };
    }],
    ['GET', /^\/sales\/(\d+)$/, (m) => getSale(Number(m[1]))],
    ['POST', /^\/returns$/, (m, q, b) => createReturn(b)],
    ['GET', /^\/returns$/, (m, q) => DB.sale_returns.filter((r) => inRange(r.date, q.from, q.to))
      .sort((a, b2) => b2.id - a.id).slice(0, 100)],

    ['POST', /^\/held$/, (m, q, b) => {
      held.push({ id: Date.now(), at: dNow(), user: session ? session.full_name : 'عرض', ...b });
      held = held.slice(-30); return { ok: true };
    }],
    ['GET', /^\/held$/, () => held],
    ['DELETE', /^\/held\/(\d+)$/, (m) => { held = held.filter((h) => h.id !== Number(m[1])); return { ok: true }; }],

    ['POST', /^\/purchases$/, (m, q, b) => {
      requireAuth();
      const items = b.items || [];
      if (!items.length) throw new DemoError('فاتورة الشراء فارغة');
      const id = newId();
      let total = 0;
      for (const it of items) {
        const batch = { id: newId(), product_id: Number(it.product_id), batch_no: it.batch_no || null,
          expiry_date: it.expiry_date || null, qty: Number(it.qty), cost_price: Number(it.cost_price) || 0, purchase_id: id };
        DB.batches.push(batch);
        DB.purchase_items.push({ id: newId(), purchase_id: id, product_id: batch.product_id,
          batch_id: batch.id, qty: batch.qty, cost_price: batch.cost_price, sale_price: Number(it.sale_price) || 0 });
        if (Number(it.sale_price) > 0) { const p = byId(DB.products, it.product_id); if (p) p.sale_price = Number(it.sale_price); }
        total += batch.qty * batch.cost_price;
      }
      total = d2(total);
      DB.purchases.push({ id, invoice_no: b.invoice_no || null, supplier_id: b.supplier_id ? Number(b.supplier_id) : null,
        date: b.date || dNow(), total, paid: d2(Number(b.paid) || 0), notes: b.notes || null, user_id: session.id });
      logAct('purchase.create', { total });
      return { ok: true, id };
    }],
    ['GET', /^\/purchases$/, (m, q) => {
      let rows = DB.purchases.filter((p) => inRange(p.date, q.from, q.to));
      if (q.supplier_id) rows = rows.filter((p) => p.supplier_id === Number(q.supplier_id));
      if (q.q) rows = rows.filter((p) => {
        const s = p.supplier_id ? byId(DB.suppliers, p.supplier_id) : null;
        return String(p.invoice_no || '').includes(q.q) || (s && s.name.includes(q.q));
      });
      const summary = { count: rows.length, total: d2(rows.reduce((a, p) => a + p.total, 0)),
        paid: d2(rows.reduce((a, p) => a + p.paid, 0)) };
      const out = rows.sort((a, b2) => b2.id - a.id).slice(0, Number(q.limit) || 100).map((p) => {
        const s = p.supplier_id ? byId(DB.suppliers, p.supplier_id) : null;
        const u = USERS.find((x) => x.id === p.user_id);
        return { ...p, supplier_name: s ? s.name : null, user_name: u ? u.full_name : null,
          lines: DB.purchase_items.filter((i) => i.purchase_id === p.id).length };
      });
      return { rows: out, summary };
    }],
    ['GET', /^\/purchases\/(\d+)$/, (m) => {
      const p = byId(DB.purchases, m[1]);
      if (!p) throw new DemoError('فاتورة الشراء غير موجودة', 404);
      const s = p.supplier_id ? byId(DB.suppliers, p.supplier_id) : null;
      const u = USERS.find((x) => x.id === p.user_id);
      return { ...p, supplier_name: s ? s.name : null, supplier_phone: s ? s.phone : null,
        user_name: u ? u.full_name : null,
        items: DB.purchase_items.filter((i) => i.purchase_id === p.id).map((i) => {
          const pr = byId(DB.products, i.product_id) || {};
          const b = byId(DB.batches, i.batch_id) || {};
          return { ...i, product_name: pr.name, unit: pr.unit, batch_no: b.batch_no,
            expiry_date: b.expiry_date, remaining_qty: b.qty };
        }) };
    }],
    ['DELETE', /^\/purchases\/(\d+)$/, (m) => {
      const id = Number(m[1]);
      const batchIds = DB.batches.filter((b) => b.purchase_id === id).map((b) => b.id);
      if (DB.sale_items.some((i) => batchIds.includes(i.batch_id)))
        throw new DemoError('لا يمكن حذف فاتورة شراء بيعت أصنافها — قم بعمل مرتجع مشتريات');
      DB.batches = DB.batches.filter((b) => b.purchase_id !== id);
      DB.purchase_items = DB.purchase_items.filter((i) => i.purchase_id !== id);
      DB.purchases = DB.purchases.filter((p) => p.id !== id);
      return { ok: true };
    }],

    ['GET', /^\/customers$/, (m, q) => {
      let rows = DB.customers.filter((c) => c.active).map((c) => ({ ...c, balance: partyBalance('customer', c.id) }));
      if (q.q) rows = rows.filter((c) => c.name.includes(q.q) || String(c.phone || '').includes(q.q));
      if (q.with_balance === 'debt') rows = rows.filter((c) => c.balance > 0.009);
      return rows.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }],
    ['GET', /^\/customers\/(\d+)$/, (m) => {
      const c = byId(DB.customers, m[1]);
      if (!c) throw new DemoError('الزبون غير موجود', 404);
      return { ...c, balance: partyBalance('customer', c.id),
        sales: DB.sales.filter((s) => s.customer_id === c.id).sort((a, b) => b.id - a.id).slice(0, 100),
        payments: DB.payments.filter((p) => p.party_type === 'customer' && p.party_id === c.id).sort((a, b) => b.id - a.id).slice(0, 100) };
    }],
    ['POST', /^\/customers$/, (m, q, b) => {
      requireAuth();
      if (!b.name) throw new DemoError('اسم الزبون مطلوب');
      if (b.id) { Object.assign(byId(DB.customers, b.id), b, { credit_limit: Number(b.credit_limit) || 0, opening_balance: Number(b.opening_balance) || 0 }); return { ok: true, id: b.id }; }
      const c = { ...b, id: newId(), active: 1, credit_limit: Number(b.credit_limit) || 0, opening_balance: Number(b.opening_balance) || 0 };
      DB.customers.push(c); return { ...c, balance: partyBalance('customer', c.id) };
    }],

    ['GET', /^\/suppliers$/, (m, q) => {
      let rows = DB.suppliers.filter((s) => s.active).map((s) => ({ ...s, balance: partyBalance('supplier', s.id) }));
      if (q.q) rows = rows.filter((s) => s.name.includes(q.q) || String(s.phone || '').includes(q.q));
      return rows.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }],
    ['GET', /^\/suppliers\/(\d+)$/, (m) => {
      const s = byId(DB.suppliers, m[1]);
      if (!s) throw new DemoError('المورد غير موجود', 404);
      return { ...s, balance: partyBalance('supplier', s.id),
        purchases: DB.purchases.filter((p) => p.supplier_id === s.id).sort((a, b) => b.id - a.id).slice(0, 100),
        payments: DB.payments.filter((p) => p.party_type === 'supplier' && p.party_id === s.id).sort((a, b) => b.id - a.id).slice(0, 100) };
    }],
    ['POST', /^\/suppliers$/, (m, q, b) => {
      requireAuth();
      if (!b.name) throw new DemoError('اسم المورد مطلوب');
      if (b.id) { Object.assign(byId(DB.suppliers, b.id), b, { opening_balance: Number(b.opening_balance) || 0 }); return { ok: true, id: b.id }; }
      const s = { ...b, id: newId(), active: 1, opening_balance: Number(b.opening_balance) || 0 };
      DB.suppliers.push(s); return { ...s, balance: 0 };
    }],

    ['POST', /^\/payments$/, (m, q, b) => {
      requireAuth();
      const amount = d2(Number(b.amount));
      if (!(amount > 0)) throw new DemoError('أدخل مبلغاً صحيحاً');
      const type = b.party_type === 'supplier' ? 'supplier' : 'customer';
      DB.payments.push({ id: newId(), party_type: type, party_id: Number(b.party_id), amount,
        direction: type === 'customer' ? 'in' : 'out', date: b.date || dNow(), note: b.note || null, user_id: session.id });
      logAct('payment.create', { type, amount });
      return { ok: true, balance: partyBalance(type, b.party_id) };
    }],
    ['DELETE', /^\/payments\/(\d+)$/, (m) => { DB.payments = DB.payments.filter((p) => p.id !== Number(m[1])); return { ok: true }; }],

    ['GET', /^\/expenses$/, (m, q) => {
      const rows = DB.expenses.filter((e) => inRange(e.date, q.from, q.to))
        .map((e) => { const u = USERS.find((x) => x.id === e.user_id); return { ...e, user_name: u ? u.full_name : null }; })
        .sort((a, b) => b.id - a.id);
      return { rows, total: d2(rows.reduce((a, e) => a + e.amount, 0)) };
    }],
    ['POST', /^\/expenses$/, (m, q, b) => {
      requireAuth();
      const amount = d2(Number(b.amount));
      if (!(amount > 0)) throw new DemoError('أدخل مبلغاً صحيحاً');
      if (b.id) { Object.assign(byId(DB.expenses, b.id), b, { amount }); return { ok: true, id: b.id }; }
      const e = { id: newId(), date: b.date || dToday(), category: b.category || 'عام', amount, note: b.note || null, user_id: session.id };
      DB.expenses.push(e); return { ok: true, id: e.id };
    }],
    ['DELETE', /^\/expenses\/(\d+)$/, (m) => { DB.expenses = DB.expenses.filter((e) => e.id !== Number(m[1])); return { ok: true }; }],

    ['GET', /^\/dashboard$/, () => dashboard()],
    ['GET', /^\/reports\/sales$/, (m, q) => salesReport(q.from, q.to, q.group_by)],
    ['GET', /^\/reports\/products$/, (m, q) => productsReport(q.from, q.to).slice(0, Number(q.limit) || 200)],
    ['GET', /^\/reports\/dead-stock$/, (m, q) => deadStock(q.days)],
    ['GET', /^\/reports\/profit-loss$/, (m, q) => profitLoss(q.from, q.to)],
    ['GET', /^\/reports\/debtors$/, () => {
      const rows = DB.customers.filter((c) => c.active)
        .map((c) => ({ id: c.id, name: c.name, phone: c.phone, credit_limit: c.credit_limit,
          balance: partyBalance('customer', c.id),
          last_sale: DB.sales.filter((s) => s.customer_id === c.id).map((s) => s.date).sort().pop() || null }))
        .filter((c) => c.balance > 0.009).sort((a, b) => b.balance - a.balance);
      return { rows, total: d2(rows.reduce((a, r) => a + r.balance, 0)) };
    }],
    ['GET', /^\/reports\/suppliers-due$/, () => {
      const rows = DB.suppliers.filter((s) => s.active)
        .map((s) => ({ id: s.id, name: s.name, phone: s.phone, balance: partyBalance('supplier', s.id) }))
        .filter((s) => Math.abs(s.balance) > 0.009).sort((a, b) => b.balance - a.balance);
      return { rows, total: d2(rows.reduce((a, r) => a + r.balance, 0)) };
    }],
    ['GET', /^\/reports\/users$/, (m, q) => usersReport(q.from, q.to)],
    ['GET', /^\/reports\/purchase-suggestion$/, () => purchaseSuggestion()],

    ['GET', /^\/settings$/, () => ({ ...SETTINGS })],
    ['POST', /^\/settings$/, (m, q, b) => { Object.assign(SETTINGS, b); return { ...SETTINGS }; }],
    ['GET', /^\/users$/, () => USERS.map((u) => ({ id: u.id, username: u.username, full_name: u.full_name,
      role: u.role, active: 1, created_at: SEED.built_at }))],
    ['POST', /^\/users$/, () => { throw new DemoError('إدارة المستخدمين معطّلة في نسخة العرض — متاحة في النسخة الكاملة'); }],
    ['DELETE', /^\/users\/(\d+)$/, () => { throw new DemoError('إدارة المستخدمين معطّلة في نسخة العرض'); }],
    ['GET', /^\/backups$/, () => []],
    ['POST', /^\/backups$/, () => { throw new DemoError('النسخ الاحتياطي متاح في النسخة الكاملة المثبّتة على جهازك'); }],
    ['POST', /^\/backups\/restore$/, () => { throw new DemoError('غير متاح في نسخة العرض'); }],
    ['GET', /^\/activity$/, (m, q) => activity.slice(0, Number(q.limit) || 200)],
    ['GET', /^\/health$/, () => ({ ok: true, demo: true })]
  ];

  return {
    async handle(method, path, query, body) {
      await new Promise((r) => setTimeout(r, 40)); // إحساس واقعي بالتحميل
      for (const [verb, rx, fn] of ROUTES) {
        if (verb !== method) continue;
        const m = path.match(rx);
        if (m) {
          try {
            return fn(m, query || {}, body || {});
          } catch (e) {
            const err = new Error(e.message);
            err.status = e.status || 400;
            throw err;
          }
        }
      }
      const err = new Error('المسار غير موجود في نسخة العرض: ' + path);
      err.status = 404;
      throw err;
    }
  };
}
