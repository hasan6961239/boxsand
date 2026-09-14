/* ============================================================
   people.js — الزبائن والديون، الموردون
   ============================================================ */

var People = (function () {

  var q = "", onlyDebt = false;

  function S() { return App.S; }

  function customer(id) {
    if (!id) return null;
    var r = null;
    S().customers.forEach(function (c) { if (c.id === id) r = c; });
    return r;
  }

  function supplier(id) {
    if (!id) return null;
    var r = null;
    S().suppliers.forEach(function (s) { if (s.id === id) r = s; });
    return r;
  }

  /* ============================================================
     الزبائن
     ============================================================ */

  function customers() {
    var totalDebt = S().customers.reduce(function (s, c) { return s + App.num(c.balance); }, 0);
    var withDebt = S().customers.filter(function (c) { return App.num(c.balance) > 0; }).length;

    var h = '<div class="grid g3" style="margin-bottom:16px">' +
      '<div class="card stat bad"><div class="lbl">إجمالي الديون على الزبائن</div><div class="val">' +
      App.money0(totalDebt) + '</div><div class="foot">' + withDebt + " زبون عليه دين</div></div>" +
      '<div class="card stat accent"><div class="lbl">عدد الزبائن</div><div class="val">' + S().customers.length + "</div></div>" +
      '<div class="card stat blue"><div class="lbl">تسديدات هذا الشهر</div><div class="val">' +
      App.money0(S().payments.filter(function (p) { return String(p.date).slice(0, 7) === App.today().slice(0, 7); })
        .reduce(function (s, p) { return s + App.num(p.amount); }, 0)) + "</div></div></div>";

    h += '<div class="row" style="margin-bottom:14px">' +
      '<div class="search-wrap"><span class="mag">⌕</span>' +
      '<input class="inp" placeholder="ابحث باسم الزبون أو رقم هاتفه…" value="' + App.esc(q) + '" oninput="People.setQ(this.value)"></div>' +
      '<label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" ' + (onlyDebt ? "checked" : "") +
      ' onchange="People.setDebtOnly(this.checked)"> أصحاب الديون فقط</label>' +
      '<div class="spacer"></div>' +
      '<button class="btn" onclick="People.exportDebts()">تصدير Excel</button>' +
      '<button class="btn primary" onclick="People.editCustomer()">+ زبون جديد</button></div>' +
      '<div class="card"><div id="cList"></div></div>';

    setTimeout(paintCustomers, 0);
    return h;
  }

  function paintCustomers() {
    var host = document.getElementById("cList");
    if (!host) return;
    var nq = App.norm(q);
    var rows = S().customers.filter(function (c) {
      if (onlyDebt && App.num(c.balance) <= 0) return false;
      if (nq && App.norm(c.name + " " + (c.phone || "")).indexOf(nq) < 0) return false;
      return true;
    }).sort(function (a, b) { return App.num(b.balance) - App.num(a.balance); });

    host.innerHTML = App.table([
      {
        h: "الزبون", c: function (c) {
          return '<div class="name">' + App.esc(c.name) + "</div>" +
            '<div class="sub">' + App.esc(c.phone || "بدون رقم") + "</div>";
        }
      },
      {
        h: "الدين الحالي", cls: "num", c: function (c) {
          var b = App.num(c.balance);
          return b > 0 ? '<b style="color:var(--stamp)">' + App.money0(b) + "</b>"
            : '<span class="badge ok">خالص</span>';
        }
      },
      {
        h: "عدد الفواتير", cls: "num", c: function (c) {
          return S().invoices.filter(function (v) { return v.customerId === c.id; }).length;
        }
      },
      { h: "ملاحظة", c: function (c) { return App.esc(c.note || "—"); } },
      {
        h: "", cls: "act", c: function (c) {
          return (App.num(c.balance) > 0 ? '<button class="btn sm primary" onclick="People.pay(\'' + c.id + '\')">تسديد</button> ' : "") +
            '<button class="btn sm" onclick="People.statement(\'' + c.id + '\')">كشف حساب</button> ' +
            '<button class="btn sm ghost" onclick="People.editCustomer(\'' + c.id + '\')">تعديل</button> ' +
            '<button class="btn sm ghost" onclick="People.delCustomer(\'' + c.id + '\')">حذف</button>';
        }
      }
    ], rows, {
      rowClass: function (c) { return App.num(c.balance) > 0 ? "low" : ""; },
      emptyIcon: "people",
      emptyTitle: S().customers.length ? "لا نتيجة مطابقة" : "لا يوجد زبائن مسجّلون",
      emptyText: "سجّل الزبائن الذين تبيع لهم بالآجل لتتبع ديونهم.",
      emptyAction: S().customers.length ? "" : '<button class="btn primary" onclick="People.editCustomer()">+ إضافة زبون</button>'
    });
  }

  function setQ(v) { q = v; paintCustomers(); }
  function setDebtOnly(v) { onlyDebt = v; paintCustomers(); }

  function editCustomer(id, cb) {
    var c = id ? customer(id) : null;
    App.form({
      title: c ? "تعديل زبون" : "زبون جديد",
      values: c || { balance: 0 },
      fields: [
        { k: "name", label: "اسم الزبون", required: true, full: true },
        { k: "phone", label: "رقم الهاتف" },
        { k: "balance", label: "دين سابق (رصيد افتتاحي)", type: "money", min: 0, hint: c ? "عدّله بحذر" : "اتركه صفراً إن لم يكن عليه شيء" },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        if (c) {
          Object.keys(v).forEach(function (k) { c[k] = v[k]; });
          App.log("تعديل زبون", c.name);
        } else {
          v.id = App.uid(); v.created = App.nowStamp();
          S().customers.push(v);
          App.log("إضافة زبون", v.name);
          if (cb) cb(v.id);
        }
        App.save(); App.rerender();
        App.toast("حُفظت بيانات الزبون.");
      }
    });
  }

  function delCustomer(id) {
    var c = customer(id);
    if (!c) return;
    if (App.num(c.balance) > 0) { App.toast("لا يمكن حذف زبون عليه دين. سدّد الدين أولاً.", "warn"); return; }
    App.confirm("سيُحذف الزبون «" + c.name + "». الفواتير القديمة تبقى محفوظة.", function () {
      S().customers.splice(S().customers.indexOf(c), 1);
      App.log("حذف زبون", c.name);
      App.save(); App.rerender();
    }, { danger: true, yes: "حذف" });
  }

  function pay(id) {
    var c = customer(id);
    if (!c) return;
    App.form({
      title: "تسديد دين — " + c.name,
      size: "narrow",
      values: { amount: App.num(c.balance), date: App.today() },
      fields: [
        { k: "amount", label: "المبلغ المسدَّد", type: "money", min: 0, required: true, full: true, hint: "الدين الحالي: " + App.money(c.balance) },
        { k: "date", label: "التاريخ", type: "date", full: true },
        { k: "note", label: "ملاحظة", full: true }
      ],
      saveLabel: "تسجيل التسديد",
      onSave: function (v) {
        var a = Math.min(App.num(v.amount), App.num(c.balance));
        if (a <= 0) { App.toast("أدخل مبلغاً صحيحاً.", "warn"); return false; }
        c.balance = App.num(c.balance) - a;
        S().payments.unshift({
          id: App.uid(), customerId: c.id, amount: a,
          date: v.date || App.today(), at: App.nowStamp(), note: v.note || ""
        });
        App.log("تسديد دين", c.name + " " + App.money0(a));
        if (typeof Notify !== "undefined") { try { Notify.payment(c, a); } catch (e) { } }
        App.saveNow(); App.rerender();
        App.toast("سُجّل التسديد. المتبقي: " + App.money(c.balance));
      }
    });
  }

  function statementRows(id) {
    var rows = [];
    S().invoices.forEach(function (v) {
      if (v.customerId !== id) return;
      if (v.kind === "return") {
        rows.push({ date: v.date, at: v.at, t: "إرجاع فاتورة " + v.refNo, dr: 0, cr: Math.abs(v.total) });
      } else if (App.num(v.due) > 0 || v.method === "credit") {
        rows.push({ date: v.date, at: v.at, t: "فاتورة رقم " + v.no, dr: App.num(v.due), cr: 0 });
      }
    });
    S().payments.forEach(function (p) {
      if (p.customerId !== id) return;
      rows.push({ date: p.date, at: p.at, t: "تسديد" + (p.note ? " — " + p.note : ""), dr: 0, cr: App.num(p.amount) });
    });
    rows.sort(function (a, b) { return String(a.at) < String(b.at) ? -1 : 1; });
    return rows;
  }

  function statement(id) {
    var c = customer(id);
    if (!c) return;
    var rows = statementRows(id);
    var run = 0;
    App.modal({
      title: "كشف حساب — " + c.name,
      size: "wide",
      body: App.table([
        { h: "التاريخ", c: function (r) { return App.esc(r.date); } },
        { h: "البيان", c: function (r) { return App.esc(r.t); } },
        { h: "عليه", cls: "num", c: function (r) { return r.dr ? App.money0(r.dr) : "—"; } },
        { h: "له", cls: "num", c: function (r) { return r.cr ? App.money0(r.cr) : "—"; } },
        { h: "الرصيد", cls: "num", c: function (r) { run += r.dr - r.cr; return "<b>" + App.money0(Math.max(run, 0)) + "</b>"; } }
      ], rows, { emptyIcon: "books", emptyTitle: "لا توجد حركات", emptyText: "لم تُسجَّل فواتير آجلة لهذا الزبون." }) +
        '<div class="row" style="margin-top:14px;font-size:17px;font-weight:700"><div class="spacer"></div>' +
        "الدين الحالي: " + App.money(c.balance) + "</div>",
      actions: [
        { label: "طباعة الكشف", kind: "primary", click: function () { printStatement(id); } },
        { label: "تسديد", click: function (close) { close(); pay(id); } }
      ]
    });
  }

  function printStatement(id) {
    var c = customer(id);
    var rows = statementRows(id), run = 0;
    var h = '<div class="receipt a4"><h2>' + App.esc(S().meta.shopName || "المحل") + "</h2>" +
      '<div class="c">كشف حساب — ' + App.esc(c.name) + (c.phone ? " · " + App.esc(c.phone) : "") + "</div>" +
      '<div class="c">حتى ' + App.dateAr(App.today()) + "</div><hr>" +
      "<table><thead><tr><th>التاريخ</th><th>البيان</th><th>عليه</th><th>له</th><th>الرصيد</th></tr></thead><tbody>";
    rows.forEach(function (r) {
      run += r.dr - r.cr;
      h += "<tr><td>" + App.esc(r.date) + "</td><td>" + App.esc(r.t) + '</td><td class="num">' +
        (r.dr ? App.money0(r.dr) : "") + '</td><td class="num">' + (r.cr ? App.money0(r.cr) : "") +
        '</td><td class="num">' + App.money0(Math.max(run, 0)) + "</td></tr>";
    });
    h += '</tbody></table><hr><div class="tot g"><span>الدين الحالي</span><span class="num">' +
      App.money0(c.balance) + " " + App.esc(S().meta.currency) + "</span></div>" +
      '<br><div style="display:flex;justify-content:space-between"><span>توقيع الزبون: ..............</span>' +
      "<span>توقيع المحل: ..............</span></div></div>";
    App.printHtml(h);
  }

  function exportDebts() {
    if (!S().customers.length) { App.toast("لا يوجد زبائن.", "warn"); return; }
    App.xls("الزبائن-والديون-" + App.today(), "الزبائن والديون", [
      { h: "الزبون", c: function (c) { return c.name; } },
      { h: "الهاتف", c: function (c) { return c.phone || ""; } },
      { h: "الدين الحالي", t: "n", sum: true, c: function (c) { return App.num(c.balance); } },
      {
        h: "عدد الفواتير", t: "i", sum: true, c: function (c) {
          return S().invoices.filter(function (v) { return v.customerId === c.id; }).length;
        }
      },
      {
        h: "إجمالي مشترياته", t: "n", sum: true, c: function (c) {
          return S().invoices.filter(function (v) { return v.customerId === c.id; })
            .reduce(function (t, v) { return t + App.num(v.total); }, 0);
        }
      },
      {
        h: "إجمالي ما سدّده", t: "n", sum: true, c: function (c) {
          return S().payments.filter(function (p) { return p.customerId === c.id; })
            .reduce(function (t, p) { return t + App.num(p.amount); }, 0);
        }
      },
      { h: "ملاحظة", c: function (c) { return c.note || ""; } }
    ], S().customers, S().meta.shopName || "");
    App.toast("نُزّل جدول الزبائن.");
  }

  /* ============================================================
     الموردون
     ============================================================ */

  function suppliers() {
    var h = '<div class="card" style="margin-bottom:18px;border-inline-start:3px solid var(--blue)">' +
      '<div class="card-head"><h3>دور النشر ونسبها</h3><div class="spacer"></div>' +
      '<button class="btn primary" onclick="People.editPublisher()">+ دار نشر جديدة</button></div>' +
      '<div class="card-body" style="padding-bottom:6px">' +
      '<p class="muted small" style="margin:0 0 12px;line-height:1.8">النسبة خصم يُعطى لزبون الجملة، ويُحسب تلقائياً عند تسجيل الكتاب. ' +
      "مثال: كتاب قطاعي 100 ودار نشره خصمها 0.1 ← سعر بيعه بالجملة 90.</p></div>" +
      App.table([
        { h: "دار النشر", c: function (p2) { return '<div class="name">' + App.esc(p2.name) + "</div>"; } },
        { h: "خصم الجملة", cls: "num", c: function (p2) { return "<b>" + (App.num(p2.rate) * 100) + "%</b>"; } },
        { h: "قطاعي 100 ← جملة", cls: "num", c: function (p2) { return "<b>" + App.money0(Inv.wholesaleFromPub(100, p2)) + "</b>"; } },
        {
          h: "عدد الكتب", cls: "num", c: function (p2) {
            return S().books.filter(function (b) { return App.norm(b.publisher) === App.norm(p2.name); }).length;
          }
        },
        {
          h: "", cls: "act", c: function (p2) {
            return '<button class="btn sm" onclick="People.editPublisher(\'' + p2.id + '\')">تعديل</button> ' +
              '<button class="btn sm ghost" onclick="People.delPublisher(\'' + p2.id + '\')">حذف</button>';
          }
        }
      ], S().publishers, {
        emptyIcon: "books", emptyTitle: "لا دور نشر مسجّلة",
        emptyText: "سجّل دار النشر ونسبتها ليُحسب سعر البيع وحده عند إدخال كتبها.",
        emptyAction: '<button class="btn primary" onclick="People.editPublisher()">+ إضافة دار نشر</button>'
      }) + "</div>";

    h += '<div class="row" style="margin-bottom:14px"><div class="spacer"></div>' +
      '<button class="btn primary" onclick="People.editSupplier()">+ مورد جديد</button></div>' +
      '<div class="card">' +
      App.table([
        { h: "المورد", c: function (s) { return '<div class="name">' + App.esc(s.name) + '</div><div class="sub">' + App.esc(s.phone || "") + "</div>"; } },
        { h: "المدينة / العنوان", c: function (s) { return App.esc(s.city || "—"); } },
        {
          h: "عدد الإدخالات", cls: "num", c: function (s) {
            return S().purchases.filter(function (p) { return p.supplierId === s.id; }).length;
          }
        },
        {
          h: "إجمالي المشتريات", cls: "num", c: function (s) {
            return App.money0(S().purchases.filter(function (p) { return p.supplierId === s.id; })
              .reduce(function (t, p) { return t + App.num(p.total); }, 0));
          }
        },
        { h: "ملاحظة", c: function (s) { return App.esc(s.note || "—"); } },
        {
          h: "", cls: "act", c: function (s) {
            return '<button class="btn sm" onclick="People.editSupplier(\'' + s.id + '\')">تعديل</button> ' +
              '<button class="btn sm ghost" onclick="People.delSupplier(\'' + s.id + '\')">حذف</button>';
          }
        }
      ], S().suppliers, {
        emptyIcon: "home", emptyTitle: "لا يوجد موردون",
        emptyText: "سجّل من تشتري منهم البضاعة لتعرف تكاليفك مع كل واحد.",
        emptyAction: '<button class="btn primary" onclick="People.editSupplier()">+ إضافة مورد</button>'
      }) + "</div>";
    return h;
  }

  function editSupplier(id) {
    var s = id ? supplier(id) : null;
    App.form({
      title: s ? "تعديل مورد" : "مورد جديد",
      values: s || {},
      fields: [
        { k: "name", label: "اسم المورد", required: true, full: true },
        { k: "phone", label: "رقم الهاتف" },
        { k: "city", label: "المدينة / العنوان" },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        if (s) { Object.keys(v).forEach(function (k) { s[k] = v[k]; }); }
        else { v.id = App.uid(); S().suppliers.push(v); }
        App.log("مورد", v.name);
        App.save(); App.rerender();
        App.toast("حُفظت بيانات المورد.");
      }
    });
  }

  function publisher(id) {
    var r = null;
    S().publishers.forEach(function (p2) { if (p2.id === id) r = p2; });
    return r;
  }

  function editPublisher(id) {
    var p2 = id ? publisher(id) : null;
    App.form({
      title: p2 ? "تعديل دار نشر" : "دار نشر جديدة",
      values: p2 || { rate: 0.2, mode: "margin" },
      fields: [
        { k: "name", label: "اسم دار النشر", required: true, full: true },
        { k: "rate", label: "خصم الجملة", type: "number", step: "0.01", min: 0, hint: "0.1 تعني خصم 10%" },
        { k: "phone", label: "رقم الهاتف" },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        v.rate = App.num(v.rate);
        if (p2) { Object.keys(v).forEach(function (k) { p2[k] = v[k]; }); }
        else { v.id = App.uid(); S().publishers.push(v); }
        App.log("دار نشر", v.name);
        App.save(); App.rerender();
        App.toast("حُفظت. قطاعي 100 ← جملة " + App.money(Inv.wholesaleFromPub(100, v)));
      }
    });
  }

  function delPublisher(id) {
    var p2 = publisher(id);
    if (!p2) return;
    App.confirm("سيُحذف «" + p2.name + "» من دور النشر. الكتب المسجّلة باسمها تبقى كما هي.", function () {
      S().publishers.splice(S().publishers.indexOf(p2), 1);
      App.save(); App.rerender();
    }, { danger: true, yes: "حذف" });
  }

  function delSupplier(id) {
    var s = supplier(id);
    if (!s) return;
    App.confirm("سيُحذف المورد «" + s.name + "». سجل المشتريات يبقى محفوظاً.", function () {
      S().suppliers.splice(S().suppliers.indexOf(s), 1);
      App.save(); App.rerender();
    }, { danger: true, yes: "حذف" });
  }

  return {
    customers: customers, customer: customer, editCustomer: editCustomer, delCustomer: delCustomer,
    pay: pay, statement: statement, printStatement: printStatement, exportDebts: exportDebts,
    setQ: setQ, setDebtOnly: setDebtOnly,
    suppliers: suppliers, supplier: supplier, editSupplier: editSupplier, delSupplier: delSupplier,
    publisher: publisher, editPublisher: editPublisher, delPublisher: delPublisher
  };
})();
