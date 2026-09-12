/* ============================================================
   reports.js — لوحة اليوم، التقارير، الإعدادات، النسخ الاحتياطي
   ============================================================ */

var Rep = (function () {

  var range = { from: "", to: "" };

  function S() { return App.S; }

  function sales(from, to) {
    return S().invoices.filter(function (v) {
      if (from && v.date < from) return false;
      if (to && v.date > to) return false;
      return true;
    });
  }

  function sum(arr, f) { return arr.reduce(function (s, x) { return s + App.num(f(x)); }, 0); }

  function monthStart() { return App.today().slice(0, 8) + "01"; }

  /* ============================================================
     لوحة اليوم
     ============================================================ */

  function dashboard() {
    var t = App.today();
    var todayInv = sales(t, t);
    var realSales = todayInv.filter(function (v) { return v.kind !== "return"; });
    var monthInv = sales(monthStart(), t);

    var invValue = App.allItems().reduce(function (s, x) { return s + App.num(x.it.qty) * App.num(x.it.cost); }, 0);
    var debts = sum(S().customers, function (c) { return c.balance; });
    var low = App.lowCount();

    var h = '<div class="grid g4" style="margin-bottom:18px">';
    h += card("accent", "مبيعات اليوم", App.money0(sum(todayInv, function (v) { return v.total; })), realSales.length + " فاتورة");
    if (App.canProfit()) h += card("blue", "ربح اليوم", App.money0(sum(todayInv, function (v) { return v.profit; })), "بعد خصم سعر الشراء");
    else h += card("blue", "عدد القطع المباعة", String(todayInv.reduce(function (a, v) {
      return a + v.items.reduce(function (b2, l) { return b2 + App.num(l.qty); }, 0);
    }, 0)), "اليوم");
    h += card("accent", "مبيعات الشهر", App.money0(sum(monthInv, function (v) { return v.total; })), App.dateAr(monthStart()) + " حتى اليوم");
    h += card(low ? "warn" : "accent", "أصناف تحتاج شراء", String(low), low ? "راجع صفحة التنبيهات" : "كل شيء متوفر");
    h += "</div>";

    h += '<div class="grid g4" style="margin-bottom:18px">';
    h += card("blue", "قيمة المخزون", App.money0(invValue), "بسعر الجملة");
    h += card(debts > 0 ? "bad" : "accent", "ديون على الزبائن", App.money0(debts), S().customers.filter(function (c) { return App.num(c.balance) > 0; }).length + " زبون");
    h += card("accent", "عدد الكتب", String(S().books.length), sum(S().books, function (b) { return b.qty; }) + " نسخة في الرفوف");
    h += card("accent", "أصناف القرطاسية", String(S().stationery.length), sum(S().stationery, function (p) { return p.qty; }) + " قطعة");
    h += "</div>";

    h += '<div class="grid g2">';

    // آخر الفواتير
    h += '<div class="card"><div class="card-head"><h3>آخر الفواتير</h3><div class="spacer"></div>' +
      '<button class="btn sm ghost" onclick="location.hash=\'#/invoices\'">الكل</button></div>' +
      App.table([
        { h: "رقم", cls: "num", c: function (v) { return v.no; } },
        { h: "الوقت", c: function (v) { return App.esc(String(v.at).slice(11)); } },
        { h: "الأصناف", c: function (v) { return '<span class="sub">' + App.esc(v.items.map(function (l) { return l.name; }).join("، ").slice(0, 34)) + "</span>"; } },
        { h: "الصافي", cls: "num", c: function (v) { return "<b>" + App.money0(v.total) + "</b>"; } },
        { h: "", cls: "act", c: function (v) { return '<button class="btn sm ghost" onclick="Sales.showInvoice(\'' + v.id + '\')">عرض</button>'; } }
      ], S().invoices.slice(0, 8), { emptyIcon: "▶", emptyTitle: "لم تُسجَّل فواتير بعد", emptyText: "افتح نقطة البيع وابدأ أول عملية." }) +
      "</div>";

    // الأصناف الناقصة
    var lows = App.allItems().filter(function (x) { return App.stockState(x.it) !== "ok"; })
      .sort(function (a, b) { return App.num(a.it.qty) - App.num(b.it.qty); }).slice(0, 8);

    h += '<div class="card"><div class="card-head"><h3>يحتاج انتباهك</h3><div class="spacer"></div>' +
      '<button class="btn sm ghost" onclick="location.hash=\'#/alerts\'">الكل</button></div>' +
      App.table([
        { h: "الصنف", c: function (x) { return '<div class="name">' + App.esc(App.itemName(x.it)) + "</div>"; } },
        { h: "الموقع", c: function (x) { return x.type === "book" ? App.locChip(x.it) : App.esc(x.it.loc || "—"); } },
        { h: "المتبقي", cls: "num", c: function (x) { return "<b>" + App.num(x.it.qty) + "</b>"; } },
        { h: "", cls: "act", c: function (x) { return '<button class="btn sm" onclick="Inv.addStock(\'' + x.type + '\',\'' + x.it.id + '\')">+ كمية</button>'; } }
      ], lows, { emptyIcon: "✔", emptyTitle: "لا يوجد نقص", emptyText: "كل الأصناف فوق حد التنبيه." }) +
      "</div></div>";

    return h;
  }

  function card(kind, lbl, val, foot) {
    return '<div class="card stat ' + kind + '"><div class="lbl">' + App.esc(lbl) + "</div>" +
      '<div class="val">' + val + "</div>" +
      (foot ? '<div class="foot">' + App.esc(foot) + "</div>" : "") + "</div>";
  }

  /* ============================================================
     الأرباح والتقارير — مقفلة برمز
     ============================================================ */

  var pv = { tab: "sum" };

  function profits() {
    if (!App.canProfit()) return lockScreen();

    var h = '<div class="row" style="margin-bottom:16px">' +
      '<div class="seg" style="max-width:520px">' +
      '<button class="' + (pv.tab === "sum" ? "on" : "") + '" onclick="Rep.setPv(\'sum\')">ملخص الأرباح</button>' +
      '<button class="' + (pv.tab === "rep" ? "on" : "") + '" onclick="Rep.setPv(\'rep\')">التقارير</button>' +
      '<button class="' + (pv.tab === "stk" ? "on" : "") + '" onclick="Rep.setPv(\'stk\')">جرد بالأرباح</button>' +
      "</div><div class=\"spacer\"></div>" +
      '<span class="badge ok">مفتوح</span>' +
      '<button class="btn ghost" onclick="Rep.relock()">إقفال</button>' +
      '<button class="btn ghost" onclick="Rep.changeCode()">تغيير الرمز</button>' +
      "</div>";

    if (pv.tab === "rep") return h + reports();
    if (pv.tab === "stk") return h + stocktake();
    return h + profitSummary();
  }

  function setPv(t) { pv.tab = t; App.rerender(); }
  function relock() { App.lockProfit(); App.rerender(); App.toast("أُقفل تبويب الأرباح."); }

  function changeCode() {
    App.form({
      title: "تغيير رمز الأرباح",
      size: "narrow",
      values: { code: "" },
      fields: [{ k: "code", label: "الرمز الجديد", required: true, full: true, hint: "احفظه عندك — بدونه لن تفتح الأرباح. لا يُخزَّن الرمز نفسه، بل بصمته فقط." }],
      onSave: function (v) {
        App.setProfitCode(v.code).then(function (res) {
          App.toast(res && res.ok ? "تغيّر الرمز." : "تعذّر تغيير الرمز.", res && res.ok ? "" : "bad");
        });
      }
    });
  }

  function lockScreen() {
    return '<div class="card" style="max-width:520px;margin:60px auto"><div class="card-body center" style="padding:42px 30px">' +
      '<div style="font-size:44px;opacity:.25;margin-bottom:12px">🔒</div>' +
      '<h2 style="font-family:var(--font-head);margin:0 0 8px;font-size:26px">الأرباح والتقارير</h2>' +
      '<p class="muted" style="margin:0 0 22px;line-height:1.8">هذا القسم يعرض أرباحك وتقاريرك الكاملة.<br>' +
      "أدخل الرمز للدخول.</p>" +
      '<input class="inp" id="pCode" type="password" placeholder="الرمز" autocomplete="off" ' +
      'style="max-width:260px;margin:0 auto;text-align:center;font-size:18px" ' +
      'onkeydown="if(event.key===\'Enter\'){event.preventDefault();Rep.doUnlock();}">' +
      '<div style="margin-top:16px"><button class="btn primary lg" onclick="Rep.doUnlock()">دخول</button></div>' +
      "</div></div>";
  }

  function doUnlock() {
    var el = document.getElementById("pCode");
    if (!el) return;
    var val = el.value;
    el.value = "";
    App.unlockProfit(val).then(function (ok) {
      if (ok) {
        App.rerender();
        App.toast("أهلاً — الأرباح مفتوحة حتى إغلاق البرنامج.");
      } else App.toast("الرمز غير صحيح.", "bad");
    });
  }

  /* ملخص الأرباح: اليوم والشهر والسنة معاً */
  function profitSummary() {
    var t = App.today();
    var mo = monthStart();
    var yr = t.slice(0, 4) + "-01-01";

    function box(lbl, from, to) {
      var inv = sales(from, to);
      var real = inv.filter(function (v) { return v.kind !== "return"; });
      return { lbl: lbl, sales: sum(inv, function (v) { return v.total; }),
        profit: sum(inv, function (v) { return v.profit; }), n: real.length };
    }
    var d = box("اليوم", t, t), m = box("هذا الشهر", mo, t), y = box("هذه السنة", yr, t);

    var invValue = App.allItems().reduce(function (s2, x) { return s2 + App.num(x.it.qty) * App.num(x.it.cost); }, 0);
    var retail = App.allItems().reduce(function (s2, x) { return s2 + App.num(x.it.qty) * App.num(x.it.price); }, 0);
    var debts = sum(S().customers, function (c) { return c.balance; });

    var h = '<div class="grid g3" style="margin-bottom:18px">';
    [d, m, y].forEach(function (b) {
      h += '<div class="card stat accent" style="padding:20px">' +
        '<div class="lbl">' + b.lbl + "</div>" +
        '<div class="val" style="color:var(--accent)">' + App.money0(b.profit) + "</div>" +
        '<div class="foot">من مبيعات ' + App.money0(b.sales) + " · " + b.n + " فاتورة</div></div>";
    });
    h += "</div>";

    h += '<div class="grid g3" style="margin-bottom:18px">' +
      card("blue", "قيمة المخزون شراءً", App.money0(invValue), "") +
      card("blue", "قيمته لو بِيع كله", App.money0(retail), "ربح كامن " + App.money0(retail - invValue)) +
      card(debts > 0 ? "bad" : "accent", "ديون على الزبائن", App.money0(debts), "") +
      "</div>";

    // أرباح آخر 12 شهراً
    var months = [], maxP = 1;
    for (var i = 11; i >= 0; i--) {
      var dd = new Date(); dd.setDate(1); dd.setMonth(dd.getMonth() - i);
      var key = dd.getFullYear() + "-" + ((dd.getMonth() + 1) < 10 ? "0" : "") + (dd.getMonth() + 1);
      var inv = S().invoices.filter(function (v) { return String(v.date).slice(0, 7) === key; });
      var p = sum(inv, function (v) { return v.profit; });
      months.push({ key: key, p: p });
      if (Math.abs(p) > maxP) maxP = Math.abs(p);
    }
    h += '<div class="card"><div class="card-head"><h3>أرباح آخر 12 شهراً</h3></div><div class="card-body">' +
      '<div style="display:flex;align-items:flex-end;gap:6px;height:190px;padding-top:10px">';
    months.forEach(function (mm) {
      var pct = Math.max(3, (Math.abs(mm.p) / maxP) * 100);
      h += '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%" title="' + mm.key + '">' +
        '<div class="num" style="font-size:10px;color:var(--muted);margin-bottom:3px">' + Math.round(mm.p) + "</div>" +
        '<div style="width:100%;max-width:46px;height:' + pct + '%;background:' +
        (mm.p >= 0 ? "var(--accent)" : "var(--stamp)") + ';opacity:.85;border-radius:4px 4px 0 0"></div>' +
        '<div class="num" style="font-size:10px;color:var(--muted);margin-top:5px">' + mm.key.slice(5) + "</div></div>";
    });
    h += "</div></div></div>";
    return h;
  }

  /* ============================================================
     التقارير
     ============================================================ */

  function reports() {
    if (!range.from) { range.from = monthStart(); range.to = App.today(); }
    var inv = sales(range.from, range.to);
    var real = inv.filter(function (v) { return v.kind !== "return"; });
    var rets = inv.filter(function (v) { return v.kind === "return"; });

    var h = '<div class="card" style="margin-bottom:18px"><div class="card-body row">' +
      '<div class="field"><label>من تاريخ</label><input type="date" class="inp" value="' + range.from + '" onchange="Rep.setRange(\'from\',this.value)"></div>' +
      '<div class="field"><label>إلى تاريخ</label><input type="date" class="inp" value="' + range.to + '" onchange="Rep.setRange(\'to\',this.value)"></div>' +
      '<div class="spacer"></div>' +
      '<button class="btn" onclick="Rep.quick(\'today\')">اليوم</button>' +
      '<button class="btn" onclick="Rep.quick(\'week\')">آخر 7 أيام</button>' +
      '<button class="btn" onclick="Rep.quick(\'month\')">هذا الشهر</button>' +
      '<button class="btn" onclick="Rep.quick(\'year\')">هذه السنة</button>' +
      '<button class="btn primary" onclick="Rep.printReport()">طباعة التقرير</button>' +
      "</div></div>";

    h += '<div class="grid g4" style="margin-bottom:18px">';
    h += card("accent", "إجمالي المبيعات", App.money0(sum(inv, function (v) { return v.total; })), real.length + " فاتورة");
    h += card("blue", "صافي الربح", App.money0(sum(inv, function (v) { return v.profit; })), "بعد الخصومات والإرجاعات");
    h += card("accent", "متوسط الفاتورة", App.money0(real.length ? sum(real, function (v) { return v.total; }) / real.length : 0), "");
    h += card(rets.length ? "bad" : "accent", "الإرجاعات", App.money0(Math.abs(sum(rets, function (v) { return v.total; }))), rets.length + " عملية");
    h += "</div>";

    // المبيعات يوماً بيوم
    var byDay = {};
    inv.forEach(function (v) { byDay[v.date] = (byDay[v.date] || 0) + App.num(v.total); });
    var days = Object.keys(byDay).sort();
    var max = 1;
    days.forEach(function (d) { if (byDay[d] > max) max = byDay[d]; });

    h += '<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>المبيعات يوماً بيوم</h3></div><div class="card-body">';
    if (!days.length) h += '<div class="empty"><p>لا مبيعات في هذه الفترة.</p></div>';
    else {
      h += '<div style="display:flex;align-items:flex-end;gap:5px;height:180px;padding-top:10px">';
      days.forEach(function (d) {
        var pct = Math.max(3, (byDay[d] / max) * 100);
        h += '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%" ' +
          'title="' + App.esc(d) + " — " + App.money0(byDay[d]) + '">' +
          '<div class="num" style="font-size:10px;color:var(--muted);margin-bottom:3px">' + Math.round(byDay[d]) + "</div>" +
          '<div style="width:100%;max-width:44px;height:' + pct + '%;background:var(--accent);opacity:.85;border-radius:4px 4px 0 0"></div>' +
          '<div class="num" style="font-size:10px;color:var(--muted);margin-top:5px">' + d.slice(8) + "</div></div>";
      });
      h += "</div>";
    }
    h += "</div></div>";

    // الأكثر مبيعاً + الراكد
    var counts = {};
    real.forEach(function (v) {
      v.items.forEach(function (l) {
        var k = l.type + ":" + l.id;
        if (!counts[k]) counts[k] = { name: l.name, qty: 0, val: 0, prof: 0, type: l.type, id: l.id };
        counts[k].qty += App.num(l.qty);
        counts[k].val += App.num(l.qty) * App.num(l.price);
        counts[k].prof += App.num(l.qty) * (App.num(l.price) - App.num(l.cost));
      });
    });
    var top = Object.keys(counts).map(function (k) { return counts[k]; })
      .sort(function (a, b) { return b.qty - a.qty; }).slice(0, 12);

    var soldIds = {};
    S().invoices.forEach(function (v) {
      if (v.date < daysAgo(60)) return;
      v.items.forEach(function (l) { soldIds[l.type + ":" + l.id] = 1; });
    });
    var dead = App.allItems().filter(function (x) {
      return App.num(x.it.qty) > 0 && !soldIds[x.type + ":" + x.it.id];
    }).sort(function (a, b) {
      return App.num(b.it.qty) * App.num(b.it.cost) - App.num(a.it.qty) * App.num(a.it.cost);
    }).slice(0, 12);

    h += '<div class="grid g2">';
    h += '<div class="card"><div class="card-head"><h3>الأكثر مبيعاً في الفترة</h3></div>' +
      App.table([
        { h: "الصنف", c: function (r) { return App.esc(r.name); } },
        { h: "الكمية", cls: "num", c: function (r) { return "<b>" + r.qty + "</b>"; } },
        { h: "المبيعات", cls: "num", c: function (r) { return App.money0(r.val); } },
        { h: "الربح", cls: "num", c: function (r) { return App.money0(r.prof); } }
      ], top, { emptyIcon: "▧", emptyTitle: "لا بيانات", emptyText: "لا مبيعات في هذه الفترة." }) + "</div>";

    h += '<div class="card"><div class="card-head"><h3>بضاعة راكدة</h3><div class="spacer"></div>' +
      '<span class="muted small">لم تُبع منذ 60 يوماً</span></div>' +
      App.table([
        { h: "الصنف", c: function (x) { return App.esc(App.itemName(x.it)); } },
        { h: "الموقع", c: function (x) { return x.type === "book" ? App.locChip(x.it) : App.esc(x.it.loc || "—"); } },
        { h: "الكمية", cls: "num", c: function (x) { return App.num(x.it.qty); } },
        { h: "المال المجمَّد", cls: "num", c: function (x) { return "<b>" + App.money0(App.num(x.it.qty) * App.num(x.it.cost)) + "</b>"; } }
      ], dead, { emptyIcon: "✔", emptyTitle: "لا بضاعة راكدة", emptyText: "كل أصنافك تتحرك." }) + "</div>";
    h += "</div>";

    return h;
  }

  function daysAgo(n) {
    var d = new Date(); d.setDate(d.getDate() - n);
    var p = function (x) { return (x < 10 ? "0" : "") + x; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function setRange(k, v) { range[k] = v; App.rerender(); }

  function quick(k) {
    var t = App.today();
    if (k === "today") { range.from = t; range.to = t; }
    else if (k === "week") { range.from = daysAgo(6); range.to = t; }
    else if (k === "month") { range.from = monthStart(); range.to = t; }
    else { range.from = t.slice(0, 4) + "-01-01"; range.to = t; }
    App.rerender();
  }

  function printReport() {
    var inv = sales(range.from, range.to);
    var real = inv.filter(function (v) { return v.kind !== "return"; });
    var h = '<div class="receipt a4"><h2>' + App.esc(S().meta.shopName || "المحل") + "</h2>" +
      '<div class="c">تقرير المبيعات</div>' +
      '<div class="c">من ' + App.dateAr(range.from) + " إلى " + App.dateAr(range.to) + "</div><hr>" +
      '<div class="tot"><span>عدد الفواتير</span><span class="num">' + real.length + "</span></div>" +
      '<div class="tot"><span>إجمالي المبيعات</span><span class="num">' + App.money0(sum(inv, function (v) { return v.total; })) + "</span></div>" +
      '<div class="tot"><span>الخصومات</span><span class="num">' + App.money0(sum(inv, function (v) { return v.discount; })) + "</span></div>" +
      (App.canProfit() ? '<div class="tot g"><span>صافي الربح</span><span class="num">' +
        App.money0(sum(inv, function (v) { return v.profit; })) + " " + App.esc(S().meta.currency) + "</span></div>" : "") +
      "<hr><div>الديون القائمة على الزبائن: " + App.money0(sum(S().customers, function (c) { return c.balance; })) + "</div>" +
      "<div>قيمة المخزون الحالية: " + App.money0(App.allItems().reduce(function (s, x) { return s + App.num(x.it.qty) * App.num(x.it.cost); }, 0)) + "</div>" +
      "</div>";
    App.printHtml(h);
  }

  /* ============================================================
     الجرد — يومي / شهري / سنوي
     ============================================================ */

  var stk = { kind: "day", date: "", hub: "sales" };

  /* تبويب الجرد: جرد المبيعات · جرد المخزون الفعلي */
  function stockHub() {
    var h = '<div class="row" style="margin-bottom:16px"><div class="seg" style="max-width:440px">' +
      '<button class="' + (stk.hub === "sales" ? "on" : "") + '" onclick="Rep.setStk(\'hub\',\'sales\')">جرد المبيعات</button>' +
      '<button class="' + (stk.hub === "phys" ? "on" : "") + '" onclick="Rep.setStk(\'hub\',\'phys\')">جرد المخزون الفعلي</button>' +
      "</div></div>";
    if (stk.hub === "phys") return h + (typeof Count !== "undefined" ? Count.page() : "");
    return h + stocktake();
  }

  function stkRange() {
    var d = stk.date || App.today();
    if (stk.kind === "day") return { from: d, to: d, label: App.dateAr(d) };
    if (stk.kind === "month") {
      var m = d.slice(0, 7);
      return { from: m + "-01", to: m + "-31", label: "شهر " + m };
    }
    var y = d.slice(0, 4);
    return { from: y + "-01-01", to: y + "-12-31", label: "سنة " + y };
  }

  function stocktake() {
    if (!stk.date) stk.date = App.today();
    var r = stkRange();
    var inv = sales(r.from, r.to);
    var real = inv.filter(function (v) { return v.kind !== "return"; });
    var rets = inv.filter(function (v) { return v.kind === "return"; });

    function sumBy(m) {
      return inv.filter(function (v) { return v.method === m; })
        .reduce(function (s2, v) { return s2 + App.num(v.total) - App.num(v.due); }, 0);
    }
    function cntBy(m) { return real.filter(function (v) { return v.method === m; }).length; }

    var cash = sumBy("cash");
    var card2 = sumBy("card");
    var creditTotal = inv.filter(function (v) { return v.method === "credit"; })
      .reduce(function (s2, v) { return s2 + App.num(v.total); }, 0);
    var creditDue = inv.reduce(function (s2, v) { return s2 + App.num(v.due); }, 0);
    var total = sum(inv, function (v) { return v.total; });
    var profit = sum(inv, function (v) { return v.profit; });
    var pieces = real.reduce(function (s2, v) {
      return s2 + v.items.reduce(function (a, l) { return a + App.num(l.qty); }, 0);
    }, 0);
    var whole = real.filter(function (v) { return v.mode === "wholesale"; });

    var h = '<div class="card" style="margin-bottom:18px"><div class="card-body row">' +
      '<div class="seg stk-seg" style="max-width:380px">' +
      '<button class="' + (stk.kind === "day" ? "on" : "") + '" onclick="Rep.setStk(\'kind\',\'day\')">يومي</button>' +
      '<button class="' + (stk.kind === "month" ? "on" : "") + '" onclick="Rep.setStk(\'kind\',\'month\')">شهري</button>' +
      '<button class="' + (stk.kind === "year" ? "on" : "") + '" onclick="Rep.setStk(\'kind\',\'year\')">سنوي</button>' +
      "</div>" +
      '<div class="field"><label>التاريخ</label><input type="date" class="inp" value="' + stk.date +
      '" onchange="Rep.setStk(\'date\',this.value)"></div>' +
      '<div class="spacer"></div>' +
      '<div style="font-family:var(--font-head);font-size:20px;font-weight:700">' + App.esc(r.label) + "</div>" +
      '<button class="btn" onclick="Rep.printStocktake()">طباعة الجرد</button>' +
      "</div></div>";

    h += '<div class="grid g4" style="margin-bottom:18px">';
    h += card("accent", "إجمالي المبيعات", App.money0(total), real.length + " فاتورة · " + pieces + " قطعة");
    if (App.canProfit()) h += card("blue", "صافي الربح", App.money0(profit), "");
    else h += card("blue", "عدد القطع", String(pieces), "");
    h += card(rets.length ? "bad" : "accent", "الإرجاعات", App.money0(Math.abs(sum(rets, function (v) { return v.total; }))), rets.length + " عملية");
    h += card("accent", "مبيعات الجملة", App.money0(sum(whole, function (v) { return v.total; })), whole.length + " فاتورة جملة");
    h += "</div>";

    // تقسيم طرق الدفع — قلب الجرد
    h += '<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>تقسيم المقبوضات</h3>' +
      '<div class="spacer"></div><span class="muted small">ما دخل فعلاً في هذه الفترة</span></div>' +
      '<div class="card-body"><div class="grid g3">' +
      '<div class="paybox cash"><div class="pb-t">نقداً في الصندوق</div>' +
      '<div class="pb-v num">' + App.money0(cash) + "</div>" +
      '<div class="pb-s">' + cntBy("cash") + " فاتورة</div></div>" +
      '<div class="paybox card"><div class="pb-t">' + App.esc(S().meta.cardName || "البطاقة المصرفية") + "</div>" +
      '<div class="pb-v num">' + App.money0(card2) + "</div>" +
      '<div class="pb-s">' + cntBy("card") + " فاتورة</div></div>" +
      '<div class="paybox credit"><div class="pb-t">آجل (لم يُقبض)</div>' +
      '<div class="pb-v num">' + App.money0(creditDue) + "</div>" +
      '<div class="pb-s">من ' + App.money0(creditTotal) + " مبيعات آجلة</div></div>" +
      "</div>" +
      '<div class="row" style="margin-top:16px;padding-top:14px;border-top:2px solid var(--ink)">' +
      '<div style="font-size:18px;font-weight:700">المقبوض فعلياً (نقد + بطاقة)</div><div class="spacer"></div>' +
      '<div class="num" style="font-size:24px;font-weight:700">' + App.money0(cash + card2) + "</div></div>" +
      "</div></div>";

    // إقفال الصندوق — لليوم فقط
    if (stk.kind === "day") {
      var closed = null;
      S().closings.forEach(function (c) { if (c.date === stk.date) closed = c; });
      h += '<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>إقفال الصندوق</h3>' +
        '<div class="spacer"></div>' + (closed ? '<span class="badge ok">أُقفل ' + App.esc(String(closed.at).slice(11)) + "</span>" : '<span class="badge warn">لم يُقفل بعد</span>') +
        "</div><div class="+ '"card-body"' + ">" +
        '<p class="muted small" style="margin-top:0">عُدّ النقد في الدرج واكتبه هنا — يقارنه البرنامج بالمفروض ويخبرك بالفرق.</p>' +
        '<div class="row"><div class="field"><label>النقد المفروض</label>' +
        '<input class="inp num" disabled value="' + App.money0(cash) + '"></div>' +
        '<div class="field"><label>النقد الفعلي في الدرج</label>' +
        '<input class="inp num" id="cashCount" type="number" step="0.25" value="' + (closed ? App.num(closed.counted) : "") + '"></div>' +
        '<button class="btn primary lg" onclick="Rep.closeDay(' + cash + ')">' + (closed ? "تحديث الإقفال" : "إقفال اليوم") + "</button></div>" +
        (closed ? '<div class="row" style="margin-top:12px"><span class="badge ' +
          (Math.abs(App.num(closed.diff)) < 0.01 ? "ok" : "bad") + '">الفرق: ' + App.money0(closed.diff) + "</span></div>" : "") +
        "</div></div>";
    }

    var det = soldDetail(inv);
    h += '<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>الأصناف المباعة</h3>' +
      '<div class="spacer"></div><span class="muted small">' + det.length + " صنف · بعد خصم الإرجاعات</span></div>" +
      App.table([
        { h: "الصنف", c: function (r2) { return '<div class="name">' + App.esc(r2.name) + "</div>"; } },
        { h: "الكمية", cls: "num", c: function (r2) { return "<b>" + r2.qty + "</b>"; } },
        { h: "سعر البيع", cls: "num", c: function (r2) { return App.money0(r2.price); } },
        { h: "إجمالي البيع", cls: "num", c: function (r2) { return App.money0(r2.rev); } }
      ].concat(App.canProfit() ? [
        { h: "سعر الشراء", cls: "num", c: function (r2) { return App.money0(r2.cost); } },
        {
          h: "صافي الربح", cls: "num", c: function (r2) {
            return '<b style="color:' + (r2.prof >= 0 ? "var(--accent)" : "var(--stamp)") + '">' + App.money0(r2.prof) + "</b>";
          }
        }
      ] : []), det, { emptyIcon: "▦", emptyTitle: "لم يُبع شيء في هذه الفترة", emptyText: "" }) + "</div>";

    h += '<div class="card"><div class="card-head"><h3>فواتير الفترة</h3></div>' +
      App.table([
        { h: "رقم", cls: "num", c: function (v) { return v.no; } },
        { h: "الوقت", c: function (v) { return '<span class="num small">' + App.esc(String(v.at).slice(11)) + "</span>"; } },
        { h: "النوع", c: function (v) { return v.kind === "return" ? '<span class="badge bad">إرجاع</span>' : (v.mode === "wholesale" ? '<span class="badge info">جملة</span>' : '<span class="badge ok">قطاعي</span>'); } },
        { h: "الدفع", c: function (v) { return Sales.payBadge(v); } },
        { h: "الأصناف", c: function (v) { return '<span class="sub">' + App.esc(v.items.map(function (l) { return l.name; }).join("، ").slice(0, 40)) + "</span>"; } },
        { h: "الصافي", cls: "num", c: function (v) { return "<b>" + App.money0(v.total) + "</b>"; } },
        { h: "", cls: "act", c: function (v) { return '<button class="btn sm" onclick="Sales.showInvoice(\'' + v.id + '\')">عرض</button>'; } }
      ], inv, { emptyIcon: "▤", emptyTitle: "لا مبيعات في هذه الفترة", emptyText: "" }) + "</div>";

    return h;
  }

  /* تفصيل الأصناف المباعة: الكمية وسعر الشراء وسعر البيع وصافي الربح */
  function soldDetail(inv) {
    var m = {};
    inv.forEach(function (v) {
      var sign = (v.kind === "return") ? -1 : 1;
      v.items.forEach(function (l) {
        var k = l.type + ":" + l.id;
        if (!m[k]) m[k] = { name: l.name, qty: 0, cost: App.num(l.cost), price: App.num(l.price), rev: 0, prof: 0 };
        var q = sign * App.num(l.qty);
        m[k].qty += q;
        m[k].rev += q * App.num(l.price);
        m[k].prof += q * (App.num(l.price) - App.num(l.cost));
        m[k].price = App.num(l.price);
        m[k].cost = App.num(l.cost);
      });
    });
    var out = [];
    Object.keys(m).forEach(function (k) { if (Math.abs(m[k].qty) > 0.0001) out.push(m[k]); });
    out.sort(function (a, b) { return b.prof - a.prof; });
    return out;
  }

  function setStk(k, v) { stk[k] = v; App.rerender(); }

  function closeDay(expected) {
    var el = document.getElementById("cashCount");
    var counted = App.num(el ? el.value : 0);
    var diff = counted - App.num(expected);
    var idx = -1;
    S().closings.forEach(function (c, i) { if (c.date === stk.date) idx = i; });
    var rec = {
      id: App.uid(), date: stk.date, kind: "day",
      expected: App.num(expected), counted: counted, diff: diff, at: App.nowStamp()
    };
    if (idx >= 0) S().closings[idx] = rec; else S().closings.unshift(rec);
    App.log("إقفال يوم", stk.date + " فرق " + App.money0(diff));
    App.saveNow(); App.rerender();
    if (Math.abs(diff) < 0.01) App.toast("أُقفل اليوم — الصندوق مضبوط تماماً.");
    else App.toast("أُقفل اليوم — فرق " + App.money(diff), "warn");
  }

  function detailTable(inv) {
    var det = soldDetail(inv);
    if (!det.length) return "";
    var h = "<hr><div><b>تفصيل الأصناف المباعة</b></div>" +
      "<table><thead><tr><th>الصنف</th><th>الكمية</th><th>البيع</th><th>الإجمالي</th>" +
      (App.canProfit() ? "<th>الشراء</th><th>الربح</th>" : "") + "</tr></thead><tbody>";
    var tq = 0, tr = 0, tp = 0;
    det.forEach(function (r2) {
      tq += r2.qty; tr += r2.rev; tp += r2.prof;
      h += "<tr><td>" + App.esc(r2.name) + '</td><td class="num">' + r2.qty +
        '</td><td class="num">' + App.money0(r2.price) + '</td><td class="num">' + App.money0(r2.rev) + "</td>" +
        (App.canProfit() ? '<td class="num">' + App.money0(r2.cost) + '</td><td class="num">' + App.money0(r2.prof) + "</td>" : "") +
        "</tr>";
    });
    h += '<tr><td><b>الإجمالي</b></td><td class="num"><b>' + tq + "</b></td><td></td>" +
      '<td class="num"><b>' + App.money0(tr) + "</b></td>" +
      (App.canProfit() ? '<td></td><td class="num"><b>' + App.money0(tp) + "</b></td>" : "") + "</tr>";
    h += "</tbody></table>";
    return h;
  }

  function exportStocktake() {
    var r = stkRange();
    var det = soldDetail(sales(r.from, r.to));
    if (!det.length) { App.toast("لا مبيعات في هذه الفترة.", "warn"); return; }
    App.xls("الجرد-" + r.from + "-" + r.to, "تفصيل الأصناف المباعة — " + r.label, [
      { h: "الصنف", c: function (x) { return x.name; } },
      { h: "الكمية", t: "i", sum: true, c: function (x) { return x.qty; } },
      { h: "سعر البيع", t: "n", c: function (x) { return x.price; } },
      { h: "إجمالي البيع", t: "n", sum: true, c: function (x) { return x.rev; } }
    ].concat(App.canProfit() ? [
      { h: "سعر الشراء", t: "n", c: function (x) { return x.cost; } },
      { h: "صافي الربح", t: "n", sum: true, c: function (x) { return x.prof; } }
    ] : []), det, S().meta.shopName || "");
    App.toast("نُزّل جدول الجرد.");
  }

  function printStocktake() {
    var r = stkRange();
    var inv = sales(r.from, r.to);
    var real = inv.filter(function (v) { return v.kind !== "return"; });
    function sumBy(m) {
      return inv.filter(function (v) { return v.method === m; })
        .reduce(function (s2, v) { return s2 + App.num(v.total) - App.num(v.due); }, 0);
    }
    var cash = sumBy("cash"), card2 = sumBy("card");
    var h = '<div class="receipt a4"><h2>' + App.esc(S().meta.shopName || "المحل") + "</h2>" +
      '<div class="c">تقرير الجرد — ' + App.esc(r.label) + "</div><hr>" +
      '<div class="tot"><span>عدد الفواتير</span><span class="num">' + real.length + "</span></div>" +
      '<div class="tot"><span>إجمالي المبيعات</span><span class="num">' + App.money0(sum(inv, function (v) { return v.total; })) + "</span></div>" +
      "<hr>" +
      '<div class="tot"><span>نقداً</span><span class="num">' + App.money0(cash) + "</span></div>" +
      '<div class="tot"><span>بطاقة مصرفية</span><span class="num">' + App.money0(card2) + "</span></div>" +
      '<div class="tot"><span>آجل (لم يُقبض)</span><span class="num">' + App.money0(inv.reduce(function (s2, v) { return s2 + App.num(v.due); }, 0)) + "</span></div>" +
      '<div class="tot g"><span>المقبوض فعلياً</span><span class="num">' + App.money0(cash + card2) + " " + App.esc(S().meta.currency) + "</span></div>" +
      "<hr>" +
      (App.canProfit() ? '<div class="tot"><span>صافي الربح</span><span class="num">' +
        App.money0(sum(inv, function (v) { return v.profit; })) + "</span></div>" : "") +
      detailTable(inv) +
      '<br><div style="display:flex;justify-content:space-between"><span>توقيع المسؤول: ..............</span>' +
      "<span>التاريخ: " + App.dateAr(App.today()) + "</span></div></div>";
    App.printHtml(h);
  }

  /* ============================================================
     الإعدادات
     ============================================================ */

  function settings() {
    var m = S().meta;
    var h = '<div class="grid g2">';

    h += '<div class="card"><div class="card-head"><h3>بيانات المحل</h3></div><div class="card-body">' +
      '<div class="form-grid">' +
      inp("shopName", "اسم المحل", m.shopName, true) +
      inp("phone", "رقم الهاتف", m.phone) +
      inp("address", "العنوان", m.address, true) +
      inp("currency", "رمز العملة", m.currency) +
      '<div class="field"><label>مقاس الإيصال</label><select class="inp" onchange="Rep.setMeta(\'receiptWidth\',this.value)">' +
      '<option value="80"' + (m.receiptWidth === "80" ? " selected" : "") + ">طابعة حرارية 80mm</option>" +
      '<option value="58"' + (m.receiptWidth === "58" ? " selected" : "") + ">طابعة حرارية 58mm</option>" +
      '<option value="a4"' + (m.receiptWidth === "a4" ? " selected" : "") + ">ورق A4 عادي</option></select></div>" +
      '<div class="field full"><label>طريقة طباعة الإيصال</label>' +
      '<select class="inp" onchange="Rep.setMeta(\'printMode\',this.value)">' +
      '<option value="image"' + (m.printMode !== "text" ? " selected" : "") + ">صورة — تدعم العربية على كل الطابعات</option>" +
      '<option value="text"' + (m.printMode === "text" ? " selected" : "") + ">نص — أسرع لكن قد يفسد العربي</option></select>" +
      '<div class="hint">إن ظهرت رموز غريبة بدل العربية على الطابعة الحرارية، اترك الخيار على «صورة».</div>' +
      '<button class="btn" style="margin-top:8px" onclick="Rep.testReceipt()">معاينة وطباعة إيصال تجريبي</button></div>' +
      inp("footer", "عبارة أسفل الإيصال", m.footer, true) +
      '<div class="field full"><label>شكل طباعة الإيصال</label>' +
      '<select class="inp" onchange="Rep.setMeta(\'receiptImage\',this.value===\'img\')">' +
      '<option value="img"' + (m.receiptImage !== false ? " selected" : "") + ">صورة — العربية مضمونة (مستحسن)</option>" +
      '<option value="txt"' + (m.receiptImage === false ? " selected" : "") + ">نص عادي</option></select>" +
      '<div class="hint">إن خرجت العربية رموزاً على الطابعة الحرارية، اختر «صورة».</div>' +
      '<button class="btn" style="margin-top:8px" onclick="Sales.previewReceipt()">معاينة وطباعة تجريبية</button></div>' +
      inp("cardName", "اسم البطاقة على التقارير", m.cardName) +
      '<div class="field full"><label>لون المنظومة</label><div class="theme-row">' +
      App.THEMES.map(function (t2) {
        return '<button class="theme-dot' + (m.theme === t2.k ? " on" : "") + '" title="' + App.esc(t2.t) +
          '" style="background:' + t2.c + '" onclick="Rep.setTheme(\'' + t2.k + '\')"></button>';
      }).join("") + '</div><div class="hint">اضغط اللون الذي يعجبك — يُطبَّق فوراً</div></div>' +
      '<div class="field full"><label>حجم الواجهة (لشاشات اللمس)</label>' +
      '<div class="seg" style="max-width:420px">' +
      '<button class="' + (m.uiSize === "md" ? "on" : "") + '" onclick="Rep.setSize(\'md\')">عادي</button>' +
      '<button class="' + (m.uiSize === "lg" ? "on" : "") + '" onclick="Rep.setSize(\'lg\')">كبير</button>' +
      '<button class="' + (m.uiSize === "xl" ? "on" : "") + '" onclick="Rep.setSize(\'xl\')">كبير جداً</button>' +
      '</div><div class="hint">يكبّر الخط والأزرار وصفوف الجداول</div></div>' +
      "</div></div></div>";

    h += '<div class="card"><div class="card-head"><h3>المكتبات والرفوف</h3></div><div class="card-body">' +
      chips("libraries", "حروف المكتبات (الخزانات)", "مثال: A أو D", true) +
      '<div class="field" style="margin:14px 0"><label>عدد الرفوف في كل مكتبة</label>' +
      '<input class="inp num" type="number" min="1" max="40" value="' + App.num(m.shelves) + '" onchange="Rep.setMeta(\'shelves\',this.value)"></div>' +
      chips("bookCats", "تصنيفات الكتب", "مثال: تاريخ") +
      chips("statCats", "تصنيفات القرطاسية", "مثال: مساطر") +
      chips("units", "وحدات البيع", "مثال: كرتونة") +
      "</div></div>";

    h += '<div class="card full" style="grid-column:1/-1"><div class="card-head"><h3>النسخ الاحتياطي وحماية البيانات</h3>' +
      '<div class="spacer"></div><span class="muted small" id="dataPath"></span></div><div class="card-body">' +
      '<p class="muted small" style="margin-top:0;line-height:1.8">بياناتك محفوظة في ملف على هذا الجهاز فقط. يأخذ البرنامج نسخة احتياطية تلقائية أول تشغيل كل يوم، ويحتفظ بنسخة سابقة عند كل حفظ. يُنصح بنسخ مجلد البيانات على فلاشة مرة كل أسبوع.</p>' +
      '<div class="row" style="margin-bottom:14px">' +
      '<button class="btn primary" onclick="Rep.backupNow()">أخذ نسخة احتياطية الآن</button>' +
      '<button class="btn" onclick="Rep.openFolder()">فتح مجلد البيانات</button>' +
      '<button class="btn" onclick="Rep.setBackupDir()">مجلد نسخ إضافي (فلاشة)</button>' +
      '<button class="btn" onclick="Rep.exportAll()">تصدير كل البيانات (ملف واحد)</button>' +
      '<button class="btn" onclick="Rep.importAll()">استعادة من ملف</button>' +
      '</div><div id="bkList"></div></div></div>' +
      archivePage();

    h += '<div class="card" style="grid-column:1/-1;border-inline-start:3px solid var(--stamp)">' +
      '<div class="card-head"><h3 style="color:var(--stamp)">منطقة الخطر</h3><div class="spacer"></div>' +
      '<span class="muted small">لا رجعة بعد التنفيذ</span></div><div class="card-body">' +
      '<div class="grid g2">' +
      '<div><h4 style="margin:0 0 6px">مسح جميع البيانات</h4>' +
      '<p class="muted small" style="line-height:1.7;margin:0 0 10px">يمسح المخزون والفواتير والزبائن والديون وكتب المباع والإشعارات — ' +
      "يعود البرنامج كأنك ثبّته للتو. يُؤخذ نسخة احتياطية تلقائياً قبل المسح.</p>" +
      '<button class="btn danger" onclick="Rep.wipeAll()">مسح جميع البيانات</button></div>' +
      '<div><h4 style="margin:0 0 6px">إلغاء تثبيت البرنامج</h4>' +
      '<p class="muted small" style="line-height:1.7;margin:0 0 10px">يحذف البرنامج من الجهاز مع كل البيانات والنسخ الاحتياطية. ' +
      "لن يبقى شيء.</p>" +
      '<button class="btn danger" onclick="Rep.uninstall()">إلغاء التثبيت ومسح كل شيء</button></div>' +
      "</div></div></div>";

    h += '<div class="card" style="grid-column:1/-1"><div class="card-head"><h3>سجل الحركات</h3><div class="spacer"></div>' +
      '<span class="muted small">آخر 40 عملية</span></div>' +
      App.table([
        { h: "الوقت", c: function (l) { return '<span class="num small">' + App.esc(l.at) + "</span>"; } },
        { h: "العملية", c: function (l) { return App.esc(l.action); } },
        { h: "التفاصيل", c: function (l) { return '<span class="muted">' + App.esc(l.detail) + "</span>"; } }
      ], S().log.slice(0, 40), { emptyIcon: "▤", emptyTitle: "لا حركات بعد", emptyText: "" }) + "</div>";

    h += "</div>";

    setTimeout(function () { loadBackups(); loadInfo(); }, 0);
    return h;
  }

  /* محرر قائمة بأزرار: كل عنصر بطاقة عليها ✕، وحقل إضافة بجانبها */
  function chips(key, label, ph, letters) {
    var arr = S().meta[key] || [];
    var h = '<div class="field full" style="margin-bottom:16px"><label>' + App.esc(label) + "</label>" +
      '<div class="chips">' +
      arr.map(function (v, i) {
        return '<span class="chip">' + App.esc(v) +
          '<button title="حذف" onclick="Rep.chipDel(\'' + key + "'," + i + ')">✕</button></span>';
      }).join("") +
      (arr.length ? "" : '<span class="muted small">لا يوجد شيء بعد</span>') +
      "</div>" +
      '<div class="row" style="margin-top:8px">' +
      '<input class="inp" id="chip_' + key + '" style="max-width:240px" placeholder="' + App.esc(ph || "") +
      '" onkeydown="if(event.key===\'Enter\'){event.preventDefault();Rep.chipAdd(\'' + key + '\');}">' +
      '<button class="btn primary" onclick="Rep.chipAdd(\'' + key + '\')">+ إضافة</button>' +
      (letters ? '<button class="btn" onclick="Rep.allLetters()">A – Z</button>' +
        '<button class="btn ghost" onclick="Rep.letters(6)">A – F</button>' : "") +
      "</div></div>";
    return h;
  }

  function chipAdd(key) {
    var el = document.getElementById("chip_" + key);
    if (!el) return;
    var v = String(el.value || "").trim();
    if (!v) { App.toast("اكتب شيئاً أولاً.", "warn"); return; }
    var arr = S().meta[key] || [];
    var exists = false;
    arr.forEach(function (x) { if (App.norm(x) === App.norm(v)) exists = true; });
    if (exists) { App.toast("موجود مسبقاً.", "warn"); el.value = ""; return; }
    arr.push(v);
    S().meta[key] = arr;
    App.save(); App.rerender();
    App.toast("أُضيف: " + v);
  }

  function chipDel(key, i) {
    var arr = S().meta[key] || [];
    var v = arr[i];
    if (v === undefined) return;
    App.confirm("حذف «" + v + "» من القائمة؟ الأصناف المسجّلة به تبقى كما هي.", function () {
      arr.splice(i, 1);
      S().meta[key] = arr;
      App.save(); App.rerender();
    }, { danger: true, yes: "حذف" });
  }

  function inp(k, label, val, full) {
    return '<div class="field' + (full ? " full" : "") + '"><label>' + App.esc(label) + "</label>" +
      '<input class="inp" value="' + App.esc(val || "") + '" onchange="Rep.setMeta(\'' + k + '\',this.value)"></div>';
  }

  function setMeta(k, v) {
    S().meta[k] = (k === "shelves") ? Math.max(1, App.num(v)) : v;
    App.save(); App.refreshBadges();
    App.toast("حُفظ الإعداد.");
  }

  function letters(n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(String.fromCharCode(65 + i));
    S().meta.libraries = a;
    App.save(); App.rerender();
    App.toast("صارت المكتبات: A حتى " + a[a.length - 1]);
  }

  function allLetters() { letters(26); }

  function testReceipt() {
    try { Sales.previewReceipt(); }
    catch (e) { App.toast("تعذّر تجهيز الإيصال التجريبي.", "bad"); }
  }

  function setTheme(v) {
    S().meta.theme = v;
    App.save(); App.applyTheme(); App.rerender();
  }

  function setSize(v) {
    S().meta.uiSize = v;
    App.save(); App.applyUiSize(); App.rerender();
    App.toast("حُفظ حجم الواجهة.");
  }

  function setList(k, v) {
    S().meta[k] = String(v).split(/[،,]/).map(function (x) { return x.trim(); }).filter(Boolean);
    App.save();
    App.toast("حُدّثت القائمة.");
  }

  /* مسح كل البيانات — يتطلب كتابة كلمة تأكيد */
  function wipeAll() {
    var body = document.createElement("div");
    body.innerHTML =
      '<p style="margin-top:0;line-height:1.8">سيُمسح كل ما أدخلته: الكتب والقرطاسية والفواتير والزبائن والديون ' +
      "وكتب المباع والموردين والمخازن وسجل الحركات.</p>" +
      '<p class="muted small" style="line-height:1.7">تبقى إعدادات المحل والربط والإشعارات كما هي. ' +
      "وتُحفظ نسخة احتياطية كاملة قبل المسح تقدر تعود إليها من الأعلى.</p>" +
      '<div class="field" style="margin-top:14px"><label>اكتب كلمة <b>امسح</b> للتأكيد</label>' +
      '<input class="inp" id="wipeWord" placeholder="امسح" autocomplete="off"></div>';

    App.modal({
      title: "مسح جميع البيانات",
      size: "narrow",
      body: body,
      cancelLabel: "تراجع",
      actions: [{
        label: "امسح كل البيانات", kind: "danger", click: function (close, ov) {
          var w = String(ov.querySelector("#wipeWord").value || "").trim();
          if (w !== "امسح") { App.toast("اكتب كلمة «امسح» بالضبط للتأكيد.", "warn"); return; }
          App.saveNow().then(function () {
            return App.api("/api/backup", { method: "POST" }).then(function (r) { return r.json(); }).catch(function () { return null; });
          }).then(function () {
            var s2 = S();
            ["books", "stationery", "customers", "suppliers", "invoices", "payments", "purchases",
              "log", "consignors", "consignments", "consPayments", "closings", "warehouses"].forEach(function (k) {
                s2[k] = [];
              });
            s2.counters = { invoice: 0, book: 0, stat: 0 };
            s2.notify.log = [];
            App.log("مسح شامل", "أُفرغت كل البيانات");
            App.saveNow();
            close();
            App.rerender();
            App.toast("مُسحت كل البيانات. النسخة الاحتياطية محفوظة.");
          });
        }
      }]
    });
  }

  function uninstall() {
    var body = document.createElement("div");
    body.innerHTML =
      '<p style="margin-top:0;line-height:1.8">سيُغلق البرنامج ويبدأ إلغاء التثبيت، ويُحذف من الجهاز ' +
      "<b>مع كل البيانات والنسخ الاحتياطية</b> — الفواتير والمخزون والزبائن والديون. لا رجعة.</p>" +
      '<p class="muted small" style="line-height:1.7">إن أردت الاحتفاظ ببياناتك، أغلق هذه النافذة أولاً ' +
      "واستعمل «تصدير كل البيانات» في الأعلى.</p>" +
      '<div class="field" style="margin-top:14px"><label>اكتب كلمة <b>إلغاء التثبيت</b> للتأكيد</label>' +
      '<input class="inp" id="uninWord" placeholder="إلغاء التثبيت" autocomplete="off"></div>';

    App.modal({
      title: "إلغاء التثبيت ومسح كل شيء",
      size: "narrow",
      body: body,
      cancelLabel: "تراجع",
      actions: [{
        label: "نعم، احذف كل شيء", kind: "danger", click: function (close, ov) {
          var w = String(ov.querySelector("#uninWord").value || "").trim();
          if (w !== "إلغاء التثبيت") { App.toast("اكتب العبارة بالضبط للتأكيد.", "warn"); return; }
          App.api("/api/uninstall", { method: "POST" })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              if (res && res.ok) {
                close();
                document.body.innerHTML =
                  '<div style="display:grid;place-items:center;height:100vh;font-family:var(--font-body);text-align:center">' +
                  '<div><h2 style="font-family:var(--font-head)">بدأ إلغاء التثبيت</h2>' +
                  '<p class="muted">تابع الخطوات في نافذة ويندوز التي ظهرت. تقدر إغلاق هذه النافذة.</p></div></div>';
              } else {
                App.toast("تعذّر بدء إلغاء التثبيت: " + ((res && res.error) || "") +
                  " — استعمل: الإعدادات ← التطبيقات في ويندوز.", "bad");
              }
            })
            .catch(function () { App.toast("تعذّر بدء إلغاء التثبيت. استعمل الإعدادات ← التطبيقات في ويندوز.", "bad"); });
        }
      }]
    });
  }

  function loadInfo() {
    App.api("/api/info").then(function (r) { return r.json(); }).then(function (d) {
      var e = document.getElementById("dataPath");
      if (e && d && d.dataDir) e.textContent = d.dataDir;
    }).catch(function () { });
  }

  function loadBackups() {
    var host = document.getElementById("bkList");
    if (!host) return;
    App.api("/api/backups").then(function (r) { return r.json(); }).then(function (list) {
      host.innerHTML = App.table([
        { h: "النسخة", c: function (b) { return '<span class="num">' + App.esc(b.name) + "</span>"; } },
        { h: "التاريخ", c: function (b) { return '<span class="num small">' + App.esc(b.date) + "</span>"; } },
        { h: "الحجم", cls: "num", c: function (b) { return (b.size / 1024).toFixed(1) + " KB"; } },
        { h: "", cls: "act", c: function (b) { return '<button class="btn sm" onclick="Rep.restore(\'' + App.esc(b.name) + '\')">استعادة</button>'; } }
      ], list || [], { emptyIcon: "▣", emptyTitle: "لا نسخ بعد", emptyText: "ستُؤخذ أول نسخة تلقائياً غداً، أو خذ واحدة الآن." });
    }).catch(function () { host.innerHTML = '<div class="empty"><p>تعذّر قراءة النسخ.</p></div>'; });
  }

  function backupNow() {
    App.saveNow().then(function () {
      return App.api("/api/backup", { method: "POST" }).then(function (r) { return r.json(); });
    }).then(function (res) {
      if (res && res.ok) { App.toast("حُفظت نسخة احتياطية: " + res.name); loadBackups(); }
      else App.toast("تعذّر أخذ النسخة.", "bad");
    }).catch(function () { App.toast("تعذّر أخذ النسخة.", "bad"); });
  }

  function openFolder() { App.api("/api/open-folder", { method: "POST" }); }

  /* شاشة استرجاع بعد ملف تالف.
     قبلها كانت المنظومة تفتح فارغة وتعرض معالج "أهلاً بك" كأنها جديدة،
     فيظن صاحب المحل أنه فقد كل شيء بينما النسخ موجودة. */
  function recoverScreen() {
    App.modal({
      title: "استعادة نسخة احتياطية",
      body: '<p style="line-height:1.9;margin-top:0">ملف البيانات الحالي غير قابل للقراءة — الغالب أن الكهرباء ' +
        'انقطعت أثناء الحفظ. <b>بياناتك لم تضع:</b> اختر آخر نسخة سليمة من القائمة لتعود المنظومة كما كانت.</p>' +
        '<p class="muted small" style="line-height:1.8">لن يُكتب أي شيء فوق الملف الحالي قبل أن تختار.</p>' +
        '<div id="bkList" style="margin-top:14px"></div>'
    });
    setTimeout(loadBackups, 0);
  }

  function restore(name) {
    App.confirm("سيتم استبدال بياناتك الحالية بمحتوى النسخة «" + name +
      "». تُحفظ نسخة من الوضع الحالي قبل الاستبدال.", function () {
        App.api("/api/restore", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name })
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.ok) { App.toast("استُعيدت النسخة. سيُعاد تحميل البرنامج."); setTimeout(function () { location.reload(); }, 900); }
          else App.toast("تعذّرت الاستعادة.", "bad");
        });
      }, { danger: true, yes: "استعادة" });
  }

  /* النسخ كلها كانت داخل مجلد البرنامج على نفس القرص: عطل قرص واحد
     يأخذ البيانات و150 نسخة معها. هذا يضيف وجهة ثانية خارج الجهاز. */
  function setBackupDir() {
    App.form({
      title: "مجلد نسخ إضافي",
      size: "narrow",
      values: { dir: (S().meta.extraBackupDir || "") },
      fields: [{
        k: "dir", label: "مسار المجلد", full: true,
        hint: "ضع مسار فلاشة أو مجلد Google Drive / OneDrive على الجهاز، مثل: D:\\نسخ-المكتبة — واتركه فارغاً لإيقافه."
      }],
      onSave: function (v) {
        S().meta.extraBackupDir = String(v.dir || "").trim();
        App.save();
        App.toast(S().meta.extraBackupDir ? "ستُنسخ كل نسخة احتياطية إلى هذا المجلد أيضاً." : "أُوقف المجلد الإضافي.");
        App.api("/api/backup-dir", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dir: S().meta.extraBackupDir })
        }).catch(function () { });
      }
    });
  }

  /* ---------- أرشفة الفواتير ----------
     كل فاتورة منذ أول يوم كانت تبقى في store.json: كل حفظ يعيد كتابته
     وكل نسخة احتياطية تنسخه. الأرشفة تنقل سنة كاملة إلى ملف مستقل. */

  function archivableYears() {
    var thisYear = App.today().slice(0, 4);
    var by = {};
    S().invoices.forEach(function (v) {
      var y = String(v.date || "").slice(0, 4);
      if (y.length === 4 && y < thisYear) by[y] = (by[y] || 0) + 1;
    });
    return Object.keys(by).sort().map(function (y) { return { year: y, n: by[y] }; });
  }

  function archivePage() {
    var years = archivableYears();
    var size = JSON.stringify(S()).length;
    var h = '<div class="card"><div class="card-head"><h3>أرشفة الفواتير القديمة</h3></div><div class="card-body">' +
      '<p style="line-height:1.9;margin-top:0">حجم ملف بياناتك الآن: <b class="num">' +
      (size / 1048576).toFixed(2) + ' ميجابايت</b>. ' +
      'الأرشفة تنقل فواتير سنة كاملة إلى ملف مستقل، فيصغر الملف ويسرع الحفظ. ' +
      'الفواتير المؤرشفة تبقى محفوظة ويمكن عرضها متى شئت — لكنها تخرج من التقارير والبحث اليومي.</p>';

    if (!years.length) {
      h += '<div class="empty"><h4>لا شيء للأرشفة</h4><p>لا توجد فواتير من سنوات سابقة. تُؤرشف السنة بعد انتهائها.</p></div>';
    } else {
      h += '<div class="row" style="flex-wrap:wrap;gap:10px">';
      years.forEach(function (y) {
        h += '<button class="btn" onclick="Rep.doArchive(\'' + y.year + '\')">أرشف سنة ' + y.year +
          ' <span class="muted small">(' + y.n + ' فاتورة)</span></button>';
      });
      h += "</div>";
    }
    h += '<div id="archList" style="margin-top:18px"></div></div></div>';
    setTimeout(loadArchives, 0);
    return h;
  }

  function loadArchives() {
    var host = document.getElementById("archList");
    if (!host) return;
    App.api("/api/archives").then(function (r) { return r.json(); }).then(function (list) {
      host.innerHTML = "<h4 style=\"margin:0 0 8px\">الأرشيف المحفوظ</h4>" + App.table([
        { h: "السنة", cls: "num", c: function (a) { return "<b>" + App.esc(a.year) + "</b>"; } },
        { h: "الحجم", cls: "num", c: function (a) { return (a.size / 1024).toFixed(0) + " KB"; } },
        { h: "", cls: "act", c: function (a) { return '<button class="btn sm" onclick="Rep.viewArchive(\'' + App.esc(a.year) + '\')">عرض</button>'; } }
      ], list || [], { emptyIcon: "▤", emptyTitle: "لا أرشيف بعد", emptyText: "" });
    }).catch(function () { });
  }

  function doArchive(year) {
    var rows = S().invoices.filter(function (v) { return String(v.date || "").slice(0, 4) === year; });
    if (!rows.length) { App.toast("لا فواتير في هذه السنة.", "warn"); return; }
    App.confirm("ستُنقل " + rows.length + " فاتورة من سنة " + year + " إلى ملف أرشيف مستقل.\n\n" +
      "تبقى محفوظة ويمكنك عرضها، لكنها تخرج من التقارير والبحث. تُؤخذ نسخة احتياطية أولاً.",
      function () {
        App.api("/api/backup", { method: "POST" }).then(function () {
          return App.api("/api/archive", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ year: year, invoices: rows })
          }).then(function (r) { return r.json(); });
        }).then(function (res) {
          if (!res || !res.ok) { App.toast((res && res.error) || "تعذّرت الأرشفة.", "bad"); return; }
          // لا نحذف من الحالة إلا بعد أن يؤكّد القرص أن الأرشيف كُتب
          S().invoices = S().invoices.filter(function (v) { return String(v.date || "").slice(0, 4) !== year; });
          App.log("أرشفة", "نُقلت " + rows.length + " فاتورة من سنة " + year);
          App.saveNow().then(function () {
            App.toast("أُرشفت " + rows.length + " فاتورة من سنة " + year + ".");
            App.rerender();
          });
        }).catch(function () { App.toast("تعذّرت الأرشفة.", "bad"); });
      }, { yes: "أرشف سنة " + year });
  }

  function viewArchive(year) {
    App.api("/api/archive-read?year=" + encodeURIComponent(year))
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        if (!Array.isArray(rows)) { App.toast("تعذّرت قراءة الأرشيف.", "bad"); return; }
        var total = rows.reduce(function (a, v) { return a + App.num(v.total); }, 0);
        App.modal({
          title: "أرشيف سنة " + year,
          size: "wide",
          body: '<p class="muted" style="margin-top:0">' + rows.length + " فاتورة · إجمالي " +
            App.money0(total) + "</p>" +
            App.table([
              { h: "رقم", cls: "num", c: function (v) { return v.no; } },
              { h: "التاريخ", c: function (v) { return App.esc(v.date); } },
              { h: "الأصناف", c: function (v) { return '<span class="sub">' + App.esc((v.items || []).map(function (l) { return l.name + "×" + l.qty; }).join("، ").slice(0, 60)) + "</span>"; } },
              { h: "الإجمالي", cls: "num", c: function (v) { return App.money0(v.total); } }
            ], rows, { limit: 200, emptyTitle: "الأرشيف فارغ" })
        });
      }).catch(function () { App.toast("تعذّرت قراءة الأرشيف.", "bad"); });
  }

  function exportAll() {
    App.saveNow().then(function () {
      App.download("نسخة-كاملة-" + App.nowStamp().replace(/[: ]/g, "-") + ".json",
        JSON.stringify(S(), null, 1), "application/json");
      App.toast("نُزّل ملف النسخة الكاملة. احفظه على فلاشة.");
    });
  }

  function importAll() {
    App.confirm("سيتم استبدال كل البيانات الحالية بمحتوى الملف. تأكد أنك أخذت نسخة احتياطية أولاً.",
      function () {
        App.pickFile(".json,application/json", function (txt) {
          try {
            var d = JSON.parse(txt);
            if (!d || !d.meta) throw new Error("ملف غير صالح");
            App.api("/api/save", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d)
            }).then(function () { App.toast("استُعيدت البيانات."); setTimeout(function () { location.reload(); }, 800); });
          } catch (e) { App.toast("الملف غير صالح.", "bad"); }
        });
      }, { danger: true, yes: "استبدال البيانات" });
  }

  /* ---------- أول تشغيل ---------- */

  function firstRun() {
    App.form({
      title: "أهلاً بك — إعداد سريع",
      values: { shopName: "", currency: "د.ل", libraries: "A، B، C", shelves: 6 },
      fields: [
        { k: "shopName", label: "اسم المحل", required: true, full: true, placeholder: "مثال: مكتبة النور للقرطاسية" },
        { k: "phone", label: "رقم الهاتف" },
        { k: "currency", label: "رمز العملة" },
        { k: "libraries", label: "حروف المكتبات", full: true, hint: "الخزانات التي ترتّب فيها الكتب — افصل بفاصلة" },
        { k: "shelves", label: "عدد الرفوف في كل مكتبة", type: "number", min: 1, full: true }
      ],
      saveLabel: "ابدأ العمل",
      onSave: function (v) {
        var m = S().meta;
        m.shopName = v.shopName; m.phone = v.phone; m.currency = v.currency || "د.ل";
        m.libraries = String(v.libraries).split(/[،,]/).map(function (x) { return x.trim(); }).filter(Boolean);
        m.shelves = Math.max(1, App.num(v.shelves));
        m.setupDone = true;
        App.log("إعداد", "أول تشغيل");
        App.saveNow();
        App.rerender();
        App.toast("جاهز! ابدأ بإضافة كتبك وأصناف القرطاسية.");
      }
    });
  }

  return {
    dashboard: dashboard, reports: reports, settings: settings, firstRun: firstRun,
    setRange: setRange, quick: quick, printReport: printReport,
    setMeta: setMeta, setList: setList, letters: letters, allLetters: allLetters,
    stocktake: stocktake, stockHub: stockHub, setStk: setStk, closeDay: closeDay, printStocktake: printStocktake,
    exportStocktake: exportStocktake,
    soldDetail: soldDetail,
    setSize: setSize, setTheme: setTheme, chipAdd: chipAdd, chipDel: chipDel, wipeAll: wipeAll, uninstall: uninstall,
    profits: profits, setPv: setPv, doUnlock: doUnlock, relock: relock, changeCode: changeCode,
    testReceipt: testReceipt,
    backupNow: backupNow, openFolder: openFolder, restore: restore,
    recoverScreen: recoverScreen, setBackupDir: setBackupDir,
    archivePage: archivePage, doArchive: doArchive, viewArchive: viewArchive,
    exportAll: exportAll, importAll: importAll
  };
})();
