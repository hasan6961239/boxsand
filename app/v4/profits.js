/* ============================================================
   واجهة 4.0 — الأرباح والتقارير
   ------------------------------------------------------------
   كما في 3.x:
   - مقفلة برمز الأرباح نفسه لمن يدخل بلا كلمة سر (قرار 0024)، ومفتوحة حتى
     يخرج أو يضغط «إقفال». الإقفال يخفي سعر الشراء والأرباح من كل الشاشات.
   - ملخص الأرباح: اليوم والشهر والسنة، وقيمة المخزون، والديون، وآخر 12 شهراً.
   - التقارير لفترة: المبيعات يوماً بيوم، والأكثر مبيعاً، والراكد، والطباعة.
   ============================================================ */
var V4Profits = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;
  var tab = "sum", range = { from: "", to: "" }, last = null;

  function page() {
    var me = V4.me() || {};
    if (me.locked) return lockScreen();
    var cost = V4.can("view_cost");
    if (!cost) tab = "rep";
    return '<div class="toolbar">' +
      (cost ? '<div class="seg" style="max-width:360px"><button id="pfTabSum" onclick="V4Profits.tab(\'sum\')">ملخص الأرباح</button>' +
        '<button id="pfTabRep" onclick="V4Profits.tab(\'rep\')">التقارير</button></div>' : "") +
      '<div class="spacer"></div>' +
      (me.lockable ? '<span class="badge ok">مفتوح</span><button class="btn ghost" onclick="V4Profits.lock()">إقفال</button>' : "") +
      (cost ? '<button class="btn ghost" onclick="V4Profits.changeCode()">تغيير الرمز</button>' : "") + "</div>" +
      '<div id="pfHost"><div class="muted">…</div></div>';
  }

  function after() {
    var pin = document.getElementById("pfCode");
    if (pin) { pin.focus(); return; }
    paintTabs();
    if (tab === "sum") summary(); else report();
  }

  function paintTabs() {
    var a = document.getElementById("pfTabSum"), b = document.getElementById("pfTabRep");
    if (a) a.classList.toggle("on", tab === "sum");
    if (b) b.classList.toggle("on", tab === "rep");
  }

  function setTab(t) { tab = t; paintTabs(); if (t === "sum") summary(); else report(); }

  function stat(kind, lbl, val, foot) {
    return '<div class="card stat ' + kind + '"><div class="lbl">' + esc(lbl) + '</div><div class="val">' + val + "</div>" +
      (foot ? '<div class="foot">' + esc(foot) + "</div>" : "") + "</div>";
  }

  /* أعمدة بسيطة كما في 3.x: [{label, v, title}] */
  function bars(pts, h) {
    if (!pts.length) return '<div class="empty" style="padding:22px"><p>لا مبيعات في هذه الفترة.</p></div>';
    var max = 1;
    pts.forEach(function (p) { if (Math.abs(p.v) > max) max = Math.abs(p.v); });
    return '<div class="pf-bars" style="height:' + (h || 180) + 'px">' + pts.map(function (p) {
      var pct = Math.max(3, Math.abs(p.v) / max * 100);
      return '<div class="pf-bar" title="' + esc(p.title || p.label) + '"><span class="num v">' + Math.round(p.v / 1000) + "</span>" +
        '<i style="height:' + pct.toFixed(1) + "%" + (p.v < 0 ? ";background:var(--stamp)" : "") + '"></i>' +
        '<span class="num k">' + esc(p.label) + "</span></div>";
    }).join("") + "</div>";
  }

  /* ---------- القفل ---------- */

  function lockScreen() {
    return '<div class="card" style="max-width:520px;margin:60px auto"><div class="card-body center" style="padding:42px 30px">' +
      '<div style="font-size:44px;opacity:.25;margin-bottom:12px">🔒</div>' +
      '<h2 style="margin:0 0 8px;font-size:26px">الأرباح والتقارير</h2>' +
      '<p class="muted" style="margin:0 0 22px;line-height:1.8">هذا القسم يعرض أرباحك وتقاريرك الكاملة.<br>أدخل الرمز للدخول.</p>' +
      '<input class="inp" id="pfCode" type="password" placeholder="الرمز" autocomplete="off" ' +
      'style="max-width:260px;margin:0 auto;text-align:center;font-size:18px" ' +
      'onkeydown="if(event.key===\'Enter\'){event.preventDefault();V4Profits.unlock();}">' +
      '<div style="margin-top:16px"><button class="btn primary lg" onclick="V4Profits.unlock()">دخول</button></div>' +
      "</div></div>";
  }

  function unlock() {
    var el = document.getElementById("pfCode");
    if (!el) return;
    var v = el.value;
    el.value = "";
    V4.run("profit.unlock", { code: v }).then(function () {
      App.toast("أهلاً — الأرباح مفتوحة حتى تخرج أو تضغط «إقفال».", "ok");
      tab = "sum";
      return V4.restart();
    }).catch(function () {
      var e = document.getElementById("pfCode");
      if (e) e.focus();
    });
  }

  function lock() {
    V4.run("profit.lock").then(function () {
      App.toast("أُقفلت الأرباح.", "ok");
      return V4.restart();
    });
  }

  function changeCode() {
    V4.form({
      title: "تغيير رمز الأرباح",
      size: "narrow",
      fields: [{ k: "code", label: "الرمز الجديد", type: "password", required: true, full: true,
        hint: "احفظه عندك — بدونه لن تفتح الأرباح. لا يُخزَّن الرمز نفسه، بل بصمته فقط." }],
      onSave: function (v) {
        return V4.run("profit.code", { code: v.code }).then(function () { App.toast("تغيّر الرمز.", "ok"); });
      }
    });
  }

  /* ---------- ملخص الأرباح ---------- */

  function summary() {
    V4.call("profits.summary").then(function (d) {
      var host = document.getElementById("pfHost");
      if (!host || tab !== "sum") return;
      var box = function (lbl, b) {
        return '<div class="card stat accent" style="padding:20px"><div class="lbl">' + esc(lbl) + "</div>" +
          '<div class="val" style="color:var(--accent)">' + money(b.profit || 0) + "</div>" +
          '<div class="foot">من مبيعات ' + money(b.sales) + " · " + b.n + " فاتورة</div></div>";
      };
      var latent = d.stockRetail - (d.stockCost || 0);
      host.innerHTML = '<div class="grid g3" style="margin-bottom:18px">' + box("اليوم", d.today) + box("هذا الشهر", d.month) + box("هذه السنة", d.year) + "</div>" +
        '<div class="grid g3" style="margin-bottom:18px">' +
        stat("blue", "قيمة المخزون شراءً", money(d.stockCost || 0), "المحل والمخازن") +
        stat("blue", "قيمته لو بِيع كله", money(d.stockRetail), "ربح كامن " + money(latent)) +
        stat(d.debts > 0 ? "bad" : "accent", "ديون على الزبائن", money(d.debts), "") + "</div>" +
        '<div class="card"><div class="card-head"><h3>أرباح آخر 12 شهراً</h3></div><div class="card-body">' +
        bars(d.months.map(function (m) {
          return { label: m.key.slice(5), v: m.profit || 0, title: m.key + " — ربح " + money(m.profit || 0) + " من مبيعات " + money(m.sales) };
        }), 190) + "</div></div>";
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  /* ---------- التقارير ---------- */

  function daysAgo(n) {
    var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; };
    d.setDate(d.getDate() - n);
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function quick(k) {
    var t = V4.today();
    if (k === "today") { range.from = t; range.to = t; }
    else if (k === "week") { range.from = daysAgo(6); range.to = t; }
    else if (k === "month") { range.from = t.slice(0, 8) + "01"; range.to = t; }
    else { range.from = t.slice(0, 5) + "01-01"; range.to = t; }
    report();
  }

  function setRange(k, v) { range[k] = v; report(); }

  function report() {
    if (!range.from) { range.from = V4.today().slice(0, 8) + "01"; range.to = V4.today(); }
    var host = document.getElementById("pfHost");
    if (!host) return;
    if (!document.getElementById("pfFrom")) {
      host.innerHTML = '<div class="card" style="margin-bottom:18px"><div class="card-body row" style="flex-wrap:wrap;gap:10px">' +
        '<div class="field"><label for="pfFrom">من تاريخ</label><input type="date" class="inp" id="pfFrom" onchange="V4Profits.range(\'from\',this.value)"></div>' +
        '<div class="field"><label for="pfTo">إلى تاريخ</label><input type="date" class="inp" id="pfTo" onchange="V4Profits.range(\'to\',this.value)"></div>' +
        '<div class="spacer"></div>' +
        '<button class="btn" onclick="V4Profits.quick(\'today\')">اليوم</button>' +
        '<button class="btn" onclick="V4Profits.quick(\'week\')">آخر 7 أيام</button>' +
        '<button class="btn" onclick="V4Profits.quick(\'month\')">هذا الشهر</button>' +
        '<button class="btn" onclick="V4Profits.quick(\'year\')">هذه السنة</button>' +
        '<button class="btn primary" onclick="V4Profits.print()">طباعة التقرير</button></div></div>' +
        '<div id="pfRep"><div class="muted">…</div></div>';
    }
    document.getElementById("pfFrom").value = range.from;
    document.getElementById("pfTo").value = range.to;
    var want = range.from + "|" + range.to;
    V4.call("report.period", { from: range.from, to: range.to }).then(function (d) {
      var rep = document.getElementById("pfRep");
      if (!rep || tab !== "rep" || want !== range.from + "|" + range.to) return;
      last = d;
      var cost = d.profit !== undefined;
      rep.innerHTML = '<div class="grid g4" style="margin-bottom:18px">' +
        stat("accent", "إجمالي المبيعات", money(d.total), d.n + " فاتورة") +
        (cost ? stat("blue", "صافي الربح", money(d.profit), "بعد الخصومات والإرجاعات") : "") +
        stat("accent", "متوسط الفاتورة", money(d.avg), "") +
        stat(d.returns ? "bad" : "accent", "الإرجاعات", money(d.returnsTotal), d.returns + " عملية") + "</div>" +
        '<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>المبيعات يوماً بيوم</h3></div><div class="card-body">' +
        bars(d.days.map(function (x) { return { label: x.date.slice(8), v: x.total, title: x.date + " — " + money(x.total) }; })) + "</div></div>" +
        '<div class="grid g2">' +
        '<div class="card"><div class="card-head"><h3>الأكثر مبيعاً في الفترة</h3></div>' +
        App.table([
          { h: "الصنف", c: function (r) { return esc(r.name); } },
          { h: "الكمية", cls: "num", c: function (r) { return "<b>" + r.qty + "</b>"; } },
          { h: "المبيعات", cls: "num", c: function (r) { return money(r.val); } }
        ].concat(cost ? [{ h: "الربح", cls: "num", c: function (r) { return money(r.profit); } }] : []), d.top,
          { emptyIcon: "clipboard", emptyTitle: "لا بيانات", emptyText: "لا مبيعات في هذه الفترة." }) + "</div>" +
        '<div class="card"><div class="card-head"><h3>بضاعة راكدة</h3><div class="spacer"></div><span class="muted small">لم تُبع منذ 60 يوماً</span></div>' +
        App.table([
          { h: "الصنف", c: function (x) { return esc(x.title); } },
          { h: "الكمية", cls: "num", c: function (x) { return String(x.qty); } }
        ].concat(cost ? [{ h: "المال المجمَّد", cls: "num", c: function (x) { return "<b>" + money(x.value) + "</b>"; } }] : []), d.dead,
          { emptyIcon: "check", emptyTitle: "لا بضاعة راكدة", emptyText: "كل أصنافك تتحرك." }) + "</div></div>";
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function print() {
    var d = last;
    if (!d) return;
    var m = (V4.shop() && V4.shop().meta) || {}, cur = " " + esc(V4.currency());
    App.printHtml('<div class="receipt a4"><h2>' + esc(m.shopName || "المحل") + "</h2>" +
      '<div class="c">تقرير المبيعات</div>' +
      '<div class="c">من ' + esc(App.dateAr(d.from)) + " إلى " + esc(App.dateAr(d.to)) + "</div><hr>" +
      '<div class="tot"><span>عدد الفواتير</span><span class="num">' + d.n + "</span></div>" +
      '<div class="tot"><span>إجمالي المبيعات</span><span class="num">' + money(d.total) + "</span></div>" +
      '<div class="tot"><span>الخصومات</span><span class="num">' + money(d.discount) + "</span></div>" +
      (d.profit !== undefined ? '<div class="tot g"><span>صافي الربح</span><span class="num">' + money(d.profit) + cur + "</span></div>" : "") +
      "<hr><div>الديون القائمة على الزبائن: " + money(d.debts) + "</div>" +
      (d.stockCost !== undefined ? "<div>قيمة المخزون الحالية: " + money(d.stockCost) + "</div>" : "") + "</div>");
  }

  V4.page({ o: 80, g: "أخرى", k: "profits", t: "الأرباح والتقارير", ic: "chart", perm: "reports", render: page, after: after });

  return { tab: setTab, unlock: unlock, lock: lock, changeCode: changeCode, quick: quick, range: setRange, print: print };
})();
