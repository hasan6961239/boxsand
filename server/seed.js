'use strict';
/** توليد بيانات تجريبية واقعية للمنظومة */
const { db, setSetting, getSetting } = require('./db');
const { hashPassword } = require('./auth');
const { CATEGORIES, PRODUCTS, SUPPLIERS, CUSTOMERS, EXPENSE_CATEGORIES } = require('./seed-data');
const { DEFAULT_SETTINGS } = require('./routes/admin');

const force = process.argv.includes('--force');
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const iso = (d) => d.toISOString().slice(0, 10);
const stamp = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const daysAgo = (n) => new Date(Date.now() - n * 864e5);
const daysAhead = (n) => new Date(Date.now() + n * 864e5);

// مولّد أرقام شبه عشوائي ثابت النتيجة (حتى تكون العروض متطابقة)
let _s = 20260912;
function rnd() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
const pick = (a) => a[Math.floor(rnd() * a.length)];
const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));

function wipe() {
  const tables = ['sale_return_items','sale_returns','sale_items','sales','purchase_items','purchases',
    'batches','stock_adjustments','payments','expenses','products','categories','customers','suppliers',
    'sessions','activity_log','users','settings'];
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare('DELETE FROM sqlite_sequence').run();
}

const run = db.transaction(() => {
  wipe();

  // الإعدادات
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) setSetting(k, v);
  setSetting('pharmacy_name', 'صيدلية النور');
  setSetting('pharmacy_phone', '091-000-0000');
  setSetting('pharmacy_address', 'طرابلس — شارع الجمهورية');
  setSetting('invoice_seq', '0');

  // المستخدمون
  const users = [
    ['admin', '1234', 'مدير المنظومة', 'admin'],
    ['pharmacist', '1234', 'د. أحمد الصيدلي', 'pharmacist'],
    ['cashier', '1234', 'سالم — الكاشير', 'cashier']
  ];
  const userIds = {};
  for (const [u, p, name, role] of users) {
    const info = db.prepare('INSERT INTO users(username,password_hash,full_name,role,active) VALUES(?,?,?,?,1)')
      .run(u, hashPassword(p), name, role);
    userIds[u] = info.lastInsertRowid;
  }

  // التصنيفات
  const catIds = CATEGORIES.map((c) =>
    db.prepare('INSERT INTO categories(name) VALUES(?)').run(c).lastInsertRowid);

  // الموردون
  const supIds = SUPPLIERS.map(([name, phone, address]) =>
    db.prepare('INSERT INTO suppliers(name,phone,address,opening_balance) VALUES(?,?,?,0)')
      .run(name, phone, address).lastInsertRowid);

  // الزبائن
  const custIds = CUSTOMERS.map(([name, phone, address, limit]) =>
    db.prepare('INSERT INTO customers(name,phone,address,credit_limit,opening_balance) VALUES(?,?,?,?,0)')
      .run(name, phone, address, limit).lastInsertRowid);

  // الأصناف
  const prodIds = [];
  const costs = {};
  PRODUCTS.forEach((p, i) => {
    const [name, generic, form, strength, maker, catIdx, salePrice, costPrice, minStock] = p;
    const barcode = '621' + String(1000000 + i * 137).padStart(7, '0');
    const id = db.prepare(
      `INSERT INTO products(barcode,name,generic_name,form,strength,manufacturer,category_id,unit,
                            sale_price,min_stock,requires_prescription,location,active)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)`
    ).run(barcode, name, generic, form, strength, maker, catIds[catIdx], form === 'شراب' ? 'زجاجة' : 'علبة',
          salePrice, minStock, ['مضادات حيوية'].includes(CATEGORIES[catIdx]) ? 1 : 0,
          `رف ${String.fromCharCode(65 + (i % 8))}${randInt(1, 9)}`).lastInsertRowid;
    prodIds.push(id);
    costs[id] = costPrice;
  });

  // ---- فواتير الشراء (تولّد الدفعات مع تواريخ صلاحية متنوعة) -------------
  let purchaseCount = 0;
  for (let week = 26; week >= 0; week--) {
    const date = daysAgo(week * 7 + randInt(0, 3));
    const supplierId = pick(supIds);
    const lines = [];
    const n = randInt(6, 14);
    const used = new Set();
    for (let i = 0; i < n; i++) {
      const pid = pick(prodIds);
      if (used.has(pid)) continue;
      used.add(pid);
      const qty = randInt(15, 70);
      const cost = round2(costs[pid] * (0.95 + rnd() * 0.1));
      // تواريخ صلاحية: معظمها بعيدة، بعضها قريبة، وقليل منها منتهية (للعرض)
      const r = rnd();
      let expDays;
      if (r < 0.06) expDays = randInt(-120, -5);
      else if (r < 0.20) expDays = randInt(5, 85);
      else if (r < 0.40) expDays = randInt(90, 400);
      else expDays = randInt(400, 1000);
      lines.push({ pid, qty, cost, expiry: iso(daysAhead(expDays)), batch: 'B' + randInt(10000, 99999) });
    }
    if (!lines.length) continue;

    const total = round2(lines.reduce((s, l) => s + l.qty * l.cost, 0));
    const paid = rnd() < 0.7 ? total : round2(total * (0.3 + rnd() * 0.5));
    const purchaseId = db.prepare(
      'INSERT INTO purchases(invoice_no,supplier_id,date,total,paid,user_id) VALUES(?,?,?,?,?,?)'
    ).run('ش-' + String(++purchaseCount).padStart(5, '0'), supplierId, stamp(date), total, paid, userIds.admin).lastInsertRowid;

    for (const l of lines) {
      const batchId = db.prepare(
        'INSERT INTO batches(product_id,batch_no,expiry_date,qty,cost_price,purchase_id,created_at) VALUES(?,?,?,?,?,?,?)'
      ).run(l.pid, l.batch, l.expiry, l.qty, l.cost, purchaseId, stamp(date)).lastInsertRowid;
      db.prepare(
        'INSERT INTO purchase_items(purchase_id,product_id,batch_id,qty,cost_price,sale_price) VALUES(?,?,?,?,?,?)'
      ).run(purchaseId, l.pid, batchId, l.qty, l.cost, 0);
    }
  }

  // ---- فواتير البيع على مدار 90 يوماً ------------------------------------
  const saleUsers = [userIds.cashier, userIds.pharmacist, userIds.cashier, userIds.admin];
  let seq = 0;
  const t = iso(new Date());

  function allocate(productId, qty, atDate) {
    const batches = db.prepare(
      `SELECT * FROM batches WHERE product_id=? AND qty>0 AND (expiry_date IS NULL OR expiry_date >= ?)
       ORDER BY COALESCE(expiry_date,'9999-12-31'), id`).all(productId, atDate);
    const avail = batches.reduce((s, b) => s + b.qty, 0);
    if (avail < qty) return null;
    const out = [];
    let rem = qty;
    for (const b of batches) {
      if (rem <= 0) break;
      const take = Math.min(b.qty, rem);
      out.push({ batch_id: b.id, qty: take, cost_price: b.cost_price });
      rem -= take;
    }
    return out;
  }

  for (let d = 89; d >= 0; d--) {
    const day = daysAgo(d);
    const dow = day.getDay(); // 5 = الجمعة
    let invoices = dow === 5 ? randInt(4, 10) : randInt(14, 32);
    // اتجاه تصاعدي بسيط لإظهار النمو
    invoices = Math.round(invoices * (0.8 + (90 - d) / 220));

    for (let k = 0; k < invoices; k++) {
      const hour = randInt(9, 21);
      const date = new Date(day);
      date.setHours(hour, randInt(0, 59), randInt(0, 59), 0);

      const isCredit = rnd() < 0.10;
      const customerId = isCredit ? pick(custIds.slice(1)) : (rnd() < 0.25 ? custIds[0] : null);
      const userId = pick(saleUsers);
      const itemCount = randInt(1, 5);

      const lines = [];
      const seen = new Set();
      for (let i = 0; i < itemCount; i++) {
        const pid = pick(prodIds);
        if (seen.has(pid)) continue;
        seen.add(pid);
        const qty = rnd() < 0.75 ? randInt(1, 2) : randInt(3, 6);
        const alloc = allocate(pid, qty, iso(date));
        if (!alloc) continue;
        const price = db.prepare('SELECT sale_price FROM products WHERE id=?').get(pid).sale_price;
        lines.push({ pid, qty, price, alloc });
      }
      if (!lines.length) continue;

      const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.price, 0));
      const discount = rnd() < 0.12 ? round2(Math.min(subtotal * 0.05, randInt(1, 10))) : 0;
      const total = round2(subtotal - discount);
      const paid = isCredit ? (rnd() < 0.4 ? round2(total * 0.5) : 0) : total;

      const saleId = db.prepare(
        `INSERT INTO sales(invoice_no,date,customer_id,user_id,subtotal,discount,total,paid,payment_method,status)
         VALUES(?,?,?,?,?,?,?,?,?,'done')`
      ).run('ف-' + String(++seq).padStart(6, '0'), stamp(date), customerId, userId,
            subtotal, discount, total, paid, isCredit ? 'credit' : 'cash').lastInsertRowid;

      for (const l of lines) {
        for (const a of l.alloc) {
          db.prepare('UPDATE batches SET qty = qty - ? WHERE id=?').run(a.qty, a.batch_id);
          db.prepare(
            'INSERT INTO sale_items(sale_id,product_id,batch_id,qty,price,cost_price) VALUES(?,?,?,?,?,?)'
          ).run(saleId, l.pid, a.batch_id, a.qty, l.price, a.cost_price);
        }
      }
    }
  }
  setSetting('invoice_seq', String(seq));

  // ---- مرتجعات قليلة ------------------------------------------------------
  const recentSales = db.prepare("SELECT * FROM sales WHERE date(date) >= date(?) ORDER BY RANDOM() LIMIT 6")
    .all(iso(daysAgo(25)));
  for (const s of recentSales) {
    const item = db.prepare('SELECT * FROM sale_items WHERE sale_id=? LIMIT 1').get(s.id);
    if (!item) continue;
    const qty = Math.min(1, item.qty);
    const rid = db.prepare('INSERT INTO sale_returns(sale_id,date,total,reason,user_id) VALUES(?,?,?,?,?)')
      .run(s.id, s.date, round2(qty * item.price), 'رغبة الزبون', userIds.pharmacist).lastInsertRowid;
    db.prepare('INSERT INTO sale_return_items(return_id,sale_item_id,product_id,batch_id,qty,price) VALUES(?,?,?,?,?,?)')
      .run(rid, item.id, item.product_id, item.batch_id, qty, item.price);
    db.prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id=?').run(qty, item.id);
    if (item.batch_id) db.prepare('UPDATE batches SET qty = qty + ? WHERE id=?').run(qty, item.batch_id);
    if (s.payment_method === 'cash') db.prepare('UPDATE sales SET paid = MAX(0, paid - ?) WHERE id=?').run(round2(qty * item.price), s.id);
  }

  // ---- دفعات من الزبائن وللموردين ----------------------------------------
  for (const cid of custIds.slice(1)) {
    const debt = db.prepare("SELECT COALESCE(SUM(total-paid),0) d FROM sales WHERE customer_id=? AND status<>'returned'").get(cid).d;
    if (debt > 50) {
      // دفعتان أو ثلاث على مدار الفترة تغطي معظم الرصيد
      const n = randInt(2, 3);
      let covered = 0;
      for (let i = 0; i < n; i++) {
        const amt = round2(debt * (0.22 + rnd() * 0.16));
        if (covered + amt > debt * 0.93) break;
        covered += amt;
        db.prepare("INSERT INTO payments(party_type,party_id,amount,direction,date,note,user_id) VALUES('customer',?,?,'in',?,?,?)")
          .run(cid, amt, stamp(daysAgo(randInt(1, 45))), 'دفعة على الحساب', userIds.admin);
      }
    }
  }
  for (const sid of supIds) {
    const due = db.prepare('SELECT COALESCE(SUM(total-paid),0) d FROM purchases WHERE supplier_id=?').get(sid).d;
    if (due > 100 && rnd() < 0.6) {
      db.prepare("INSERT INTO payments(party_type,party_id,amount,direction,date,note,user_id) VALUES('supplier',?,?,'out',?,?,?)")
        .run(sid, round2(due * (0.3 + rnd() * 0.5)), stamp(daysAgo(randInt(1, 30))), 'دفعة للمورد', userIds.admin);
    }
  }

  // ---- المصروفات ----------------------------------------------------------
  for (let m = 3; m >= 0; m--) {
    const base = daysAgo(m * 30);
    db.prepare('INSERT INTO expenses(date,category,amount,note,user_id) VALUES(?,?,?,?,?)')
      .run(iso(base), 'إيجار', 1500, 'إيجار المحل', userIds.admin);
    db.prepare('INSERT INTO expenses(date,category,amount,note,user_id) VALUES(?,?,?,?,?)')
      .run(iso(daysAgo(m * 30 - 3)), 'رواتب', 2400, 'رواتب الموظفين', userIds.admin);
    for (let i = 0; i < 4; i++) {
      db.prepare('INSERT INTO expenses(date,category,amount,note,user_id) VALUES(?,?,?,?,?)')
        .run(iso(daysAgo(m * 30 - randInt(1, 25))), pick(EXPENSE_CATEGORIES), randInt(30, 400), null, userIds.admin);
    }
  }

  // ---- إعادة تعبئة ختامية: توريد حديث يغطي النواقص -----------------------
  const shortages = db.prepare(
    `SELECT p.id, p.min_stock, COALESCE((SELECT SUM(b.qty) FROM batches b WHERE b.product_id=p.id),0) stock
     FROM products p WHERE p.active=1`).all()
    .filter((r) => r.stock <= r.min_stock * 1.3);
  // نترك ~10 أصناف ناقصة عمداً حتى يظهر تنبيه النواقص في العرض
  const keepShort = new Set(shortages.slice(0, 10).map((r) => r.id));
  const toRestock = shortages.filter((r) => !keepShort.has(r.id));

  if (toRestock.length) {
    const date = daysAgo(4);
    const supplierId = pick(supIds);
    const restockLines = toRestock.map((r) => ({
      pid: r.id,
      qty: Math.max(10, Math.ceil(r.min_stock * randInt(2, 3) - r.stock)),
      cost: round2(costs[r.id] * (0.95 + rnd() * 0.08)),
      expiry: iso(daysAhead(randInt(420, 900))),
      batch: 'B' + randInt(10000, 99999)
    }));
    const total = round2(restockLines.reduce((s2, l) => s2 + l.qty * l.cost, 0));
    const pid2 = db.prepare(
      'INSERT INTO purchases(invoice_no,supplier_id,date,total,paid,notes,user_id) VALUES(?,?,?,?,?,?,?)'
    ).run('ش-' + String(++purchaseCount).padStart(5, '0'), supplierId, stamp(date), total,
          round2(total * 0.6), 'توريد شهري لتغطية النواقص', userIds.admin).lastInsertRowid;
    for (const l of restockLines) {
      const bId = db.prepare(
        'INSERT INTO batches(product_id,batch_no,expiry_date,qty,cost_price,purchase_id,created_at) VALUES(?,?,?,?,?,?,?)'
      ).run(l.pid, l.batch, l.expiry, l.qty, l.cost, pid2, stamp(date)).lastInsertRowid;
      db.prepare('INSERT INTO purchase_items(purchase_id,product_id,batch_id,qty,cost_price,sale_price) VALUES(?,?,?,?,?,?)')
        .run(pid2, l.pid, bId, l.qty, l.cost, 0);
    }
  }

  // ---- دفعات قاربت على انتهاء الصلاحية (جوهر عرض المنظومة) ---------------
  // نأخذ أصنافاً عليها رصيد ونقسم جزءاً منه إلى دفعة تنتهي خلال 10—85 يوماً
  const stocked = db.prepare(
    `SELECT b.id, b.product_id, b.qty, b.cost_price FROM batches b
     WHERE b.qty >= 12 ORDER BY RANDOM() LIMIT 22`).all();
  for (const b of stocked) {
    const move = Math.floor(b.qty * (0.25 + rnd() * 0.3));
    if (move < 3) continue;
    db.prepare('UPDATE batches SET qty = qty - ? WHERE id=?').run(move, b.id);
    db.prepare('INSERT INTO batches(product_id,batch_no,expiry_date,qty,cost_price,created_at) VALUES(?,?,?,?,?,?)')
      .run(b.product_id, 'B' + randInt(10000, 99999), iso(daysAhead(randInt(8, 85))), move, b.cost_price, stamp(daysAgo(randInt(40, 120))));
  }

  // بضع دفعات منتهية فعلاً (لإظهار قيمة الخسارة المتفاداة)
  const expiredPick = db.prepare(
    'SELECT b.id, b.product_id, b.qty, b.cost_price FROM batches b WHERE b.qty >= 8 ORDER BY RANDOM() LIMIT 6').all();
  for (const b of expiredPick) {
    const move = Math.max(2, Math.floor(b.qty * 0.2));
    db.prepare('UPDATE batches SET qty = qty - ? WHERE id=?').run(move, b.id);
    db.prepare('INSERT INTO batches(product_id,batch_no,expiry_date,qty,cost_price,created_at) VALUES(?,?,?,?,?,?)')
      .run(b.product_id, 'B' + randInt(10000, 99999), iso(daysAgo(randInt(3, 60))), move, b.cost_price, stamp(daysAgo(randInt(150, 300))));
  }

  db.prepare("INSERT INTO activity_log(user_id,username,action,details) VALUES(?,?,?,?)")
    .run(userIds.admin, 'admin', 'seed', 'تم توليد البيانات التجريبية');
});

const existing = db.prepare('SELECT COUNT(*) n FROM users').get().n;
if (existing > 0 && !force) {
  console.log('\n  المنظومة تحتوي على بيانات بالفعل.');
  console.log('  لإعادة التوليد من الصفر (سيتم حذف كل البيانات):  npm run reset\n');
  process.exit(0);
}

db.pragma('foreign_keys = OFF');
try {
  run();
} finally {
  db.pragma('foreign_keys = ON');
}

const stats = {
  'الأصناف': db.prepare('SELECT COUNT(*) n FROM products').get().n,
  'الدفعات': db.prepare('SELECT COUNT(*) n FROM batches').get().n,
  'فواتير البيع': db.prepare('SELECT COUNT(*) n FROM sales').get().n,
  'بنود البيع': db.prepare('SELECT COUNT(*) n FROM sale_items').get().n,
  'فواتير الشراء': db.prepare('SELECT COUNT(*) n FROM purchases').get().n,
  'الزبائن': db.prepare('SELECT COUNT(*) n FROM customers').get().n,
  'الموردون': db.prepare('SELECT COUNT(*) n FROM suppliers').get().n,
  'المصروفات': db.prepare('SELECT COUNT(*) n FROM expenses').get().n
};

console.log('\n  ✔ تم تجهيز البيانات التجريبية بنجاح\n');
for (const [k, v] of Object.entries(stats)) console.log(`     ${k}: ${v}`);
console.log('\n  حسابات الدخول:');
console.log('     admin / 1234        (مدير — كل الصلاحيات)');
console.log('     pharmacist / 1234   (صيدلي)');
console.log('     cashier / 1234      (كاشير)');
console.log('\n  شغّل المنظومة بالأمر:  npm start\n');
