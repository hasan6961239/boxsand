/* ============================================================
   واجهة 4.0 — الزبائن والديون
   ------------------------------------------------------------
   كما في 3.x: إجمالي الديون، البحث بالاسم أو الهاتف، «أصحاب الديون فقط»،
   التسديد، كشف الحساب وطباعته، التعديل والحذف، والتصدير لـ Excel.
   الكشف من حركات الدين نفسها (قرار 0018): رصيده الجاري هو الدين.
   ============================================================ */
var V4People = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;
  var q = "", onlyDebt = false, data = null;

  function page() {
    return '<div id="cuStats" class="grid g3" style="margin-bottom:16px"></div>' +
      '<div class="toolbar">' +
      '<input class="inp search" id="cuQ" placeholder="ابحث باسم الزبون أو رقم هاتفه…" autocomplete="off" value="' + esc(q) +
      '" oninput="V4People.search(this.value)">' +
      '<label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" id="cuDebt"' + (onlyDebt ? " checked" : "") +
      ' onchange="V4People.debtOnly(this.checked)"> أصحاب الديون فقط</label>' +
      '<button class="btn" onclick="V4People.exportXls()">تصدير Excel</button>' +
      '<button class="btn primary" onclick="V4People.edit(0)">+ زبون جديد</button></div>' +
      '<div class="card"><div id="cuList"><div class="card-body muted">…</div></div></div>';
  }

  function after() {
    load();
    var i = document.getElementById("cuQ");
    if (i) i.focus();
  }

  function load() {
    return V4.call("customers.page").then(function (d) {
      data = d;
      var st = document.getElementById("cuStats");
      if (st) {
        st.innerHTML =
          '<div class="card stat bad"><div class="lbl">إجمالي الديون على الزبائن</div><div class="val">' + money(d.totalDebt) +
          '</div><div class="foot">' + d.withDebt + " زبون عليه دين</div></div>" +
          '<div class="card stat accent"><div class="lbl">عدد الزبائن</div><div class="val">' + d.customers.length + "</div></div>" +
          '<div class="card stat blue"><div class="lbl">تسديدات هذا الشهر</div><div class="val">' + money(d.paidMonth) + "</div></div>";
      }
      paint();
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function byId(id) {
    if (!data) return null;
    for (var i = 0; i < data.customers.length; i++) if (data.customers[i].id === id) return data.customers[i];
    return null;
  }

  function paint() {
    var host = document.getElementById("cuList");
    if (!host || !data) return;
    var list = data.customers.filter(function (c) { return !onlyDebt || c.balance > 0; });
    list = App.rank(list, q, function (c) { return [c.name, c.phone]; });
    var debts = V4.can("debts");
    host.innerHTML = App.table([
      { h: "الزبون", c: function (c) {
        return '<b class="name">' + esc(c.name) + "</b>" + (c.wholesale ? ' <span class="badge info">جملة</span>' : "") +
          '<div class="muted small num">' + esc(c.phone || "بدون رقم") + "</div>"; } },
      { h: "الدين الحالي", cls: "num", c: function (c) {
        return c.balance > 0 ? '<b style="color:var(--stamp)">' + money(c.balance) + "</b>" : '<span class="badge ok">خالص</span>'; } },
      { h: "عدد الفواتير", cls: "num", c: function (c) { return String(c.invoices); } },
      { h: "ملاحظة", c: function (c) { return esc(c.note || "—"); } },
      { h: "", c: function (c) {
        return (debts && c.balance > 0 ? '<button class="btn sm primary" onclick="V4People.pay(' + c.id + ')">تسديد</button> ' : "") +
          '<button class="btn sm" onclick="V4People.statement(' + c.id + ')">كشف حساب</button> ' +
          '<button class="btn sm ghost" onclick="V4People.edit(' + c.id + ')">تعديل</button> ' +
          '<button class="btn sm ghost" onclick="V4People.remove(' + c.id + ')">حذف</button>'; } }
    ], list, {
      rowClass: function (c) { return c.balance > 0 ? "low" : ""; },
      emptyIcon: "people",
      emptyTitle: data.customers.length ? "لا نتيجة مطابقة" : "لا يوجد زبائن مسجّلون",
      emptyText: "سجّل الزبائن الذين تبيع لهم بالآجل لتتبع ديونهم."
    });
  }

  function search(v) { q = v; paint(); }
  function debtOnly(v) { onlyDebt = v; paint(); }

  /* ما أُرسل لجهاز المحل من جهاز ثانٍ لا يتغيّر هنا قبل أن يرجع */
  function done(r, what, msg) {
    if (V4.queued(r, what)) return;
    if (msg) App.toast(msg, "ok");
    load();
  }

  /* ---------- الإضافة والتعديل ---------- */

  function edit(id, then) {
    var c = id ? byId(id) : null;
    var debts = V4.can("debts");
    return V4.form({
      title: c ? "تعديل: " + c.name : "زبون جديد",
      values: c ? { name: c.name, phone: c.phone, note: c.note, wholesale: c.wholesale ? "1" : "" } : {},
      fields: [
        { k: "name", label: "الاسم", required: true, full: true, placeholder: "مثلاً: محمد علي" },
        { k: "phone", label: "الهاتف", placeholder: "09xxxxxxxx" },
        { k: "wholesale", label: "نوع البيع", type: "select", options: [{ v: "", t: "قطاعي" }, { v: "1", t: "جملة (يُباع له بسعر الجملة)" }] },
        !c && debts ? { k: "opening", label: "دين سابق عليه (اختياري)", type: "money", min: 0, hint: "دين من قبل تسجيله هنا" } : null,
        { k: "note", label: "ملاحظة", full: true }
      ],
      onSave: function (v) {
        var body = { name: v.name, phone: App.digits(v.phone || "").trim(), note: v.note || "", wholesale: v.wholesale === "1" };
        if (c) {
          body.id = c.id;
          return V4.run("customer.edit", body).then(function (r) { done(r, "تعديل «" + v.name + "»", "حُفظ: " + v.name); });
        }
        if (debts && v.opening) body.opening = V4.dirhams(v.opening);
        return V4.run("customer.add", body).then(function (r) {
          done(r, "زبون جديد: " + v.name, "أُضيف: " + v.name);
          if (then && !(r && r.queued)) then(r, v.name);
        });
      }
    });
  }

  function remove(id) {
    var c = byId(id);
    if (!c) return;
    if (c.balance > 0) { App.toast("على «" + c.name + "» دين " + money(c.balance) + ": سدّده أولاً ثم احذفه.", "warn"); return; }
    App.confirm("يُحذف الزبون «" + c.name + "». فواتيره القديمة تبقى محفوظة.", function () {
      V4.run("customer.delete", { id: id }).then(function (r) { done(r, "حذف «" + c.name + "»", "حُذف: " + c.name); });
    }, { yes: "احذف", danger: true });
  }

  /* ---------- التسديد ---------- */

  function pay(id, after2) {
    var c = byId(id);
    if (!c) return;
    V4.form({
      title: "تسديد دين — " + c.name,
      size: "narrow",
      values: { amount: money(c.balance), date: V4.today() },
      fields: [
        { k: "amount", label: "المبلغ المسدَّد", type: "money", min: 0, required: true, full: true, hint: "الدين الحالي: " + money(c.balance) },
        { k: "date", label: "التاريخ", type: "date", full: true },
        { k: "note", label: "ملاحظة", full: true }
      ],
      saveLabel: "تسجيل التسديد",
      onSave: function (v) {
        var a = V4.dirhams(v.amount);
        if (a <= 0) { App.toast("أدخل مبلغاً صحيحاً.", "warn"); return false; }
        return V4.run("payment.add", { customerId: id, amount: a, date: v.date || V4.today(), note: v.note || "" }).then(function (r) {
          if (V4.queued(r, "تسديد " + c.name)) return;
          App.toast("سُجّل التسديد: " + money(r) + ". المتبقي: " + money(Math.max(c.balance - r, 0)), "ok");
          load().then(function () { if (after2) after2(); });
        });
      }
    });
  }

  /* تصحيح الرصيد باليد (دين قديم أو خطأ): بسببه، ويظهر في الكشف */
  function setBalance(id) {
    var c = byId(id);
    if (!c) return;
    V4.form({
      title: "تعديل رصيد " + c.name,
      size: "narrow",
      values: { balance: money(c.balance) },
      fields: [
        { k: "balance", label: "الدين الصحيح عليه الآن", type: "money", min: 0, required: true, full: true },
        { k: "why", label: "السبب", required: true, full: true, placeholder: "مثلاً: دين قديم من الدفتر" }
      ],
      onSave: function (v) {
        return V4.run("customer.balance", { id: id, balance: V4.dirhams(v.balance), why: v.why }).then(function (r) {
          done(r, "رصيد " + c.name, "حُفظ الرصيد الجديد.");
        });
      }
    });
  }

  /* ---------- كشف الحساب ---------- */

  var REASON = {
    sale: "فاتورة آجلة", payment: "تسديد", "return": "إرجاع", opening: "دين سابق عند التسجيل", adjust: "تعديل الرصيد",
    "invoice-edit": "تعديل فاتورة", "invoice-delete": "حذف فاتورة", "import": "الرصيد عند النقل من النظام القديم"
  };

  function moveText(m) {
    var t = REASON[m.reason] || m.reason;
    if (m.reason === "sale" || m.reason === "invoice-edit" || m.reason === "invoice-delete") t += m.invoiceNo ? " رقم " + m.invoiceNo : "";
    if (m.reason === "return") t += m.refNo ? " من فاتورة " + m.refNo : "";
    if (m.reason === "payment" && m.note) t += " — " + m.note;
    if (m.reason === "adjust" && m.detail) t = m.detail;
    return t;
  }

  function statement(id) {
    V4.run("customer.statement", { id: id }).then(function (s) {
      var rows = s.moves.slice().reverse();
      var body = '<div class="kv" style="margin-bottom:14px"><span class="k">الهاتف</span><span class="num">' + esc(s.phone || "—") + "</span>" +
        '<span class="k">الدين الحالي</span><b class="num" style="color:' + (s.balance > 0 ? "var(--stamp)" : "inherit") + '">' +
        money(s.balance) + " " + esc(V4.currency()) + "</b></div>" +
        App.table([
          { h: "التاريخ", c: function (m) { return '<span class="num">' + esc(String(m.at).slice(0, 16)) + "</span>"; } },
          { h: "البيان", c: function (m) { return esc(moveText(m)); } },
          { h: "عليه", cls: "num", c: function (m) { return m.delta > 0 ? money(m.delta) : "—"; } },
          { h: "له", cls: "num", c: function (m) { return m.delta < 0 ? money(-m.delta) : "—"; } },
          { h: "الرصيد", cls: "num", c: function (m) { return "<b>" + money(m.balance) + "</b>"; } }
        ], rows, { emptyIcon: "people", emptyTitle: "لا حركات على دينه", emptyText: "" });
      var actions = [{ label: "طباعة الكشف", kind: "primary", click: function () { printStatement(s); } }];
      if (V4.can("debts")) {
        if (s.balance > 0) actions.push({ label: "تسديد", click: function (close) { close(); pay(id, function () { statement(id); }); } });
        actions.push({ label: "تعديل الرصيد", click: function (close) { close(); setBalance(id); } });
      }
      App.modal({ title: "كشف حساب — " + s.name, size: "wide", body: body, actions: actions });
    });
  }

  function printStatement(s) {
    var m = (V4.shop() && V4.shop().meta) || {};
    var h = '<div class="receipt a4"><h2>' + esc(m.shopName || "المحل") + "</h2>" +
      '<div class="c">كشف حساب — ' + esc(s.name) + (s.phone ? " · " + esc(s.phone) : "") + "</div>" +
      '<div class="c">حتى ' + esc(App.dateAr(V4.today())) + "</div><hr>" +
      "<table><thead><tr><th>التاريخ</th><th>البيان</th><th>عليه</th><th>له</th><th>الرصيد</th></tr></thead><tbody>";
    s.moves.forEach(function (x) {
      h += "<tr><td>" + esc(String(x.at).slice(0, 10)) + "</td><td>" + esc(moveText(x)) + '</td><td class="num">' +
        (x.delta > 0 ? money(x.delta) : "") + '</td><td class="num">' + (x.delta < 0 ? money(-x.delta) : "") +
        '</td><td class="num">' + money(x.balance) + "</td></tr>";
    });
    h += '</tbody></table><hr><div class="tot g"><span>الدين الحالي</span><span class="num">' + money(s.balance) + " " + esc(V4.currency()) +
      "</span></div><br>" +
      '<div style="display:flex;justify-content:space-between"><span>توقيع الزبون: ..............</span><span>توقيع المحل: ..............</span></div></div>';
    App.printHtml(h);
  }

  function exportXls() {
    if (!data || !data.customers.length) { App.toast("لا يوجد زبائن.", "warn"); return; }
    App.xls("الزبائن-والديون-" + V4.today(), "الزبائن والديون", [
      { h: "الزبون", c: function (c) { return c.name; } },
      { h: "الهاتف", c: function (c) { return c.phone || ""; } },
      { h: "الدين الحالي", t: "n", sum: true, c: function (c) { return c.balance / 1000; } },
      { h: "عدد الفواتير", t: "i", sum: true, c: function (c) { return c.invoices; } },
      { h: "ملاحظة", c: function (c) { return c.note || ""; } }
    ], data.customers, ((V4.shop() || {}).meta || {}).shopName || "");
    App.toast("نُزّل جدول الزبائن.", "ok");
  }

  V4.page({ o: 60, g: "الحسابات", k: "customers", t: "الزبائن والديون", ic: "people", perm: "customers", render: page, after: after });

  return {
    search: search, debtOnly: debtOnly, edit: edit, remove: remove, pay: pay, statement: statement,
    setBalance: setBalance, exportXls: exportXls, reload: load
  };
})();
