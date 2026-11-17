/* ============================================================
   المصروفات — إيجار، رواتب، كهرباء، نقل، ضيافة...
   ------------------------------------------------------------
   - «من الدرج»: ينطرح من النقد المفروض في إقفال اليوم (Rep.takings).
   - كل المصروفات تنطرح من الربح: «صافي الربح بعد المصروفات» في
     «الأرباح والتقارير»، و«صافي ربح الشهر» هنا.
   - «يتكرر كل شهر»: يُسجَّل وحده كل شهر في يومه (نفس البند والمبلغ
     والملاحظة). معرّف التكرار ثابت (الأصل + الشهر)، فجهازان مربوطان
     لا يسجّلانه مرتين.
   - الحذف علامة (del) لا مسح: تكرار حُذف في شهر لا يرجع وحده.
   S().expenses: [{ id, date, cat, amount, from: "drawer"|"out", note,
                    monthly, rec (أصل التكرار), at, by, del }]
   ============================================================ */
var Expenses = (function () {
  "use strict";

  function S() { return App.S; }
  var CATS0 = ["إيجار", "رواتب", "كهرباء", "ماء", "إنترنت وهاتف", "صيانة", "نقل", "ضيافة", "نظافة", "أخرى"];
  var MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  var view = { month: "", q: "", cat: "" };

  function list() {
    if (!Array.isArray(S().expenses)) S().expenses = [];
    return S().expenses;
  }
  function live() { return list().filter(function (e) { return e && !e.del; }); }
  function between(from, to) {
    return live().filter(function (e) { return (!from || e.date >= from) && (!to || e.date <= to); });
  }
  /* المجموع في فترة؛ drawer: «من الدرج» وحده (ما ينطرح من النقد المفروض) */
  function total(from, to, drawer) {
    return App.r3(between(from, to).reduce(function (s, e) {
      return drawer && e.from !== "drawer" ? s : s + App.num(e.amount);
    }, 0));
  }
  function cats() {
    var seen = {}, out = [];
    CATS0.concat(live().map(function (e) { return e.cat; })).forEach(function (c) {
      c = String(c || "").trim();
      if (c && !seen[c]) { seen[c] = 1; out.push(c); }
    });
    return out;
  }
  function monthOf(d) { return String(d || "").slice(0, 7); }
  function monthLabel(m) { var p = String(m).split("-"); return (MONTHS[+p[1] - 1] || p[1]) + " " + p[0]; }
  function monthLast(m) {
    var p = m.split("-"), y = +p[0], mo = +p[1];
    return new Date(y, mo, 0).getDate();
  }
  function addMonth(m, k) {
    var p = m.split("-"), d = new Date(+p[0], +p[1] - 1 + k, 1);
    return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1);
  }
  function curMonth() { return view.month || App.today().slice(0, 7); }

  /* ---------- التكرار الشهري ----------
     لكل مصروف «يتكرر كل شهر»: نسخة في كل شهر بعده حتى اليوم، في يومه من الشهر
     (أو آخر يوم إن كان الشهر أقصر). المعرّف ثابت، فلا نسختان لشهر واحد */
  function recur() {
    if (!S() || App.isSecond && App.isSecond()) return 0;
    var today = App.today(), made = 0, all = list();
    var have = {};
    all.forEach(function (e) { if (e && e.id) have[e.id] = 1; });
    all.slice().forEach(function (o) {
      if (!o || o.del || !o.monthly || o.rec) return;
      var day = +String(o.date).slice(8, 10) || 1, m = addMonth(monthOf(o.date), 1), guard = 0;
      while (m <= today.slice(0, 7) && guard++ < 36) {
        var d = m + "-" + (Math.min(day, monthLast(m)) < 10 ? "0" : "") + Math.min(day, monthLast(m));
        var id = o.id + "-" + m;
        if (d <= today && !have[id]) {
          all.push({ id: id, date: d, cat: o.cat, amount: App.num(o.amount), from: o.from, note: o.note || "", monthly: false, rec: o.id, at: App.nowStamp(), by: "تكرار شهري" });
          have[id] = 1; made++;
        }
        m = addMonth(m, 1);
      }
    });
    if (made) { App.log("المصروفات", "سُجّل " + made + " مصروف متكرر لهذا الشهر"); App.save(); }
    return made;
  }

  /* ---------- الصفحة ---------- */
  function page() {
    recur();
    var m = curMonth(), from = m + "-01", to = m + "-" + monthLast(m), today = App.today();
    var rowsM = between(from, to);
    var shown = rowsM.filter(function (e) {
      if (view.cat && e.cat !== view.cat) return false;
      if (view.q && !App.match(view.q, [e.cat, e.note, App.money0(e.amount)].join(" "))) return false;
      return true;
    }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.at) < String(a.at) ? -1 : 1; });
    var dayRows = between(today, today), dayTot = total(today, today), dayDr = total(today, today, true);
    var monTot = total(from, to), monDr = total(from, to, true);

    var h = '<div class="row exp-bar">' +
      '<div class="exp-month"><button class="btn sm ghost" onclick="Expenses.step(1)" title="الشهر القادم">‹</button>' +
      '<b>' + App.esc(monthLabel(m)) + '</b><button class="btn sm ghost" onclick="Expenses.step(-1)" title="الشهر السابق">›</button></div>' +
      '<div class="search-wrap" style="max-width:360px"><span class="mag">⌕</span><input class="inp" id="expQ" placeholder="ابحث في المصروفات…" value="' + App.esc(view.q) + '" oninput="Expenses.setQ(this.value)"></div>' +
      '<select class="inp" style="max-width:180px" onchange="Expenses.setCat(this.value)"><option value="">كل البنود</option>' +
      cats().map(function (c) { return '<option' + (c === view.cat ? " selected" : "") + ">" + App.esc(c) + "</option>"; }).join("") + "</select>" +
      '<div class="spacer"></div>' +
      (App.can("expenses") ? '<button class="btn primary" onclick="Expenses.edit()">+ مصروف جديد</button>' : "") + "</div>";

    h += '<div class="grid g4" style="margin-bottom:18px">' +
      stat("bad", "مصروفات اليوم", App.money0(dayTot), dayRows.length + " " + (dayRows.length === 1 ? "مصروف" : "مصروفات") +
        (dayRows.length ? (dayDr === dayTot ? " · كلها من الدرج" : dayDr ? " · منها " + App.money0(dayDr) + " من الدرج" : " · من خارج الدرج") : "")) +
      stat("accent", "مصروفات " + (m === today.slice(0, 7) ? "الشهر" : monthLabel(m)), App.money0(monTot), rowsM.length + " " + (rowsM.length === 1 ? "مصروف" : "مصروفات")) +
      stat("blue", "منها من الدرج", App.money0(monDr), "تنطرح من النقد المفروض في الإقفال");
    if (App.canProfit()) {
      var pr = Rep.profitBetween(from, to);
      h += stat("accent", "صافي ربح الشهر", App.money0(pr.profit - monTot), "ربح المبيعات " + App.money0(pr.profit) + " − المصروفات " + App.money0(monTot));
    } else h += stat("", "صافي ربح الشهر", "🔒", "افتح «الأرباح والتقارير» برمزها لتراه هنا");
    h += "</div>";

    var byCat = {};
    rowsM.forEach(function (e) { byCat[e.cat] = App.r3((byCat[e.cat] || 0) + App.num(e.amount)); });
    var catList = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    var maxC = catList.length ? byCat[catList[0]] : 1;

    h += '<div class="exp-grid"><div class="card"><div class="card-head"><h3>مصروفات ' + App.esc(monthLabel(m).split(" ")[0]) + "</h3>" +
      '<div class="spacer"></div>' + (shown.length ? '<button class="btn sm primary" onclick="Expenses.exportXls()">تصدير Excel</button>' : "") + "</div>" +
      App.table([
        { h: "التاريخ", c: function (e) { return '<span class="num nowrap">' + App.esc(e.date) + "</span>"; } },
        { h: "البند", c: function (e) { return "<b>" + App.esc(e.cat) + "</b>" + (e.monthly || e.rec ? ' <span class="badge info">كل شهر</span>' : ""); } },
        { h: "المبلغ", c: function (e) { return '<b class="num">' + App.money0(e.amount) + "</b>"; } },
        { h: "الدفع", c: function (e) { return e.from === "drawer" ? '<span class="badge warn">من الدرج</span>' : '<span class="badge">من خارج الدرج</span>'; } },
        { h: "ملاحظة", c: function (e) { return e.note ? App.esc(e.note) : '<span class="muted">—</span>'; } },
        { h: "", c: function (e) {
          if (!App.can("expenses")) return "";
          return '<button class="btn sm ghost" onclick="Expenses.edit(\'' + App.esc(e.id) + '\')">تعديل</button>' +
            (App.can("delete") ? '<button class="btn sm ghost" onclick="Expenses.del(\'' + App.esc(e.id) + '\')">🗑 حذف</button>' : "");
        } }
      ], shown, { emptyIcon: "cash", emptyTitle: view.q || view.cat ? "لا نتيجة" : "لا مصروفات هذا الشهر", emptyText: view.q || view.cat ? "جرّب بحثاً آخر." : "سجّل الإيجار والرواتب والكهرباء وغيرها من «+ مصروف جديد»." }) +
      "</div>" +
      '<div class="card"><div class="card-head"><h3>حسب البند</h3></div><div class="card-body">' +
      (catList.length ? catList.map(function (c) {
        return '<div class="exp-cat"><span>' + App.esc(c) + '</span><div class="exp-track"><i style="width:' + Math.max(3, Math.round(byCat[c] / maxC * 100)) + '%"></i></div><b class="num">' + App.money0(byCat[c]) + "</b></div>";
      }).join("") : '<p class="muted small" style="margin:0">لا مصروفات بعد.</p>') +
      "</div></div></div>" +
      '<p class="muted small" style="margin:12px 0 0;line-height:1.8">المصروف «من الدرج» ينطرح من النقد المفروض في إقفال اليوم، وكل المصروفات تنطرح من الربح في «الأرباح والتقارير».</p>';
    return h;
  }

  function stat(kind, lbl, val, foot) {
    return '<div class="card stat ' + kind + '"><div class="lbl">' + App.esc(lbl) + '</div><div class="val">' + val + "</div>" +
      (foot ? '<div class="foot">' + App.esc(foot) + "</div>" : "") + "</div>";
  }

  function step(k) { view.month = addMonth(curMonth(), k); App.rerender(); }
  function setQ(v) { view.q = v; App.rerenderKeep ? App.rerenderKeep("expQ") : App.rerender(); }
  function setCat(v) { view.cat = v; App.rerender(); }

  function byId(id) { return list().filter(function (e) { return e.id === id; })[0] || null; }

  function edit(id) {
    if (!App.can("expenses")) { App.toast("ما عندكش صلاحية المصروفات.", "warn"); return; }
    var e = id ? byId(id) : null;
    App.form({
      title: e ? "تعديل مصروف" : "مصروف جديد",
      size: "narrow",
      values: e ? { cat: e.cat, amount: e.amount, date: e.date, from: e.from, note: e.note, monthly: e.monthly ? "1" : "0" }
        : { cat: "", amount: "", date: App.today(), from: "drawer", note: "", monthly: "0" },
      fields: [
        { k: "cat", label: "البند", required: true, full: true, list: cats(), placeholder: "كهرباء، إيجار، رواتب…" },
        { k: "amount", label: "المبلغ", type: "money", required: true, full: true },
        { k: "date", label: "التاريخ", type: "date", required: true, full: true },
        { k: "from", label: "من أين دُفع؟", type: "select", full: true, options: [
          { v: "drawer", t: "من درج المحل (ينطرح من النقد المفروض)" }, { v: "out", t: "من خارج الدرج" }] },
        { k: "note", label: "ملاحظة", full: true },
        e && e.rec ? null : { k: "monthly", label: "يتكرر كل شهر؟", type: "select", full: true, options: [{ v: "0", t: "لا" }, { v: "1", t: "نعم — يتسجّل وحده كل شهر" }] }
      ],
      onSave: function (v) {
        var amt = App.r3(App.num(v.amount));
        if (!(amt > 0)) { App.toast("اكتب المبلغ.", "warn"); return false; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) { App.toast("اختار التاريخ.", "warn"); return false; }
        var cat = String(v.cat).trim().slice(0, 40);
        var who = typeof Staff !== "undefined" && Staff.current && Staff.current() ? Staff.current().name || "" : "";
        var rec = e || { id: App.uid(), at: App.nowStamp(), by: who };
        rec.cat = cat; rec.amount = amt; rec.date = v.date; rec.from = v.from === "out" ? "out" : "drawer"; rec.note = String(v.note || "").trim().slice(0, 200);
        if (!rec.rec) rec.monthly = v.monthly === "1";
        if (!e) list().push(rec);
        App.log("المصروفات", (e ? "تعديل مصروف: " : "مصروف جديد: ") + cat + " " + App.money0(amt) + (rec.from === "drawer" ? " (من الدرج)" : ""));
        App.save();
        recur();
        App.rerender();
        App.toast(e ? "تعدّل المصروف." : "تسجّل المصروف.", "ok");
      }
    });
  }

  function del(id) {
    var e = byId(id);
    if (!e) return;
    if (!App.can("delete")) { App.toast("ما عندكش صلاحية الحذف.", "warn"); return; }
    App.modal({
      title: "حذف مصروف",
      size: "narrow",
      body: '<p style="margin-top:0;line-height:1.9">نحذفو «' + App.esc(e.cat) + "» بمبلغ <b>" + App.money0(e.amount) + "</b> يوم " + App.esc(e.date) + "؟" +
        (e.monthly ? "<br>هذا مصروف «كل شهر»: الشهور الجاية ما يتسجّلش فيها." : "") + "</p>",
      actions: [{ label: "حذف", kind: "danger", click: function (close) {
        e.del = true; e.delAt = App.nowStamp();
        if (e.monthly) e.monthly = false;
        App.log("المصروفات", "حذف مصروف: " + e.cat + " " + App.money0(e.amount) + " (" + e.date + ")");
        App.save(); close(); App.rerender(); App.toast("انحذف المصروف.", "ok");
      } }]
    });
  }

  function exportXls() {
    var m = curMonth(), rows = between(m + "-01", m + "-" + monthLast(m)).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    App.xls("المصروفات-" + m, "المصروفات — " + monthLabel(m), [
      { h: "التاريخ", c: function (e) { return e.date; } },
      { h: "البند", c: function (e) { return e.cat; } },
      { h: "المبلغ", t: "n", sum: true, c: function (e) { return App.num(e.amount); } },
      { h: "الدفع", c: function (e) { return e.from === "drawer" ? "من الدرج" : "من خارج الدرج"; } },
      { h: "ملاحظة", c: function (e) { return e.note || ""; } }
    ], rows, S().meta.shopName || "");
    App.toast("نُزّل جدول المصروفات.");
  }

  return { page: page, edit: edit, del: del, step: step, setQ: setQ, setCat: setCat, exportXls: exportXls, recur: recur, total: total, between: between };
})();
