/* ============================================================
   people.js — الزبائن والديون، الموردون
   ============================================================ */

var People = (function () {

  var q = "", onlyDebt = false;
  /* الصفحة فيها الديون كلها: «لنا» على الزبائن، و«علينا» للموردين */
  var tab = "cust", sq = "", sOnlyDebt = false;

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

  function debtTabs() {
    /* طرابلس: بلغة الحسابات — الزبون مدين للمكتبة، والمورد دائن لها */
    var x4 = App.isX4 && App.isX4();
    return '<div class="seg" style="margin-bottom:16px">' +
      '<button class="' + (tab === "cust" ? "on" : "") + '" onclick="People.setTab(\'cust\')">' + (x4 ? "الزبائن — مدين" : "ديون الزبائن — لنا") + "</button>" +
      '<button class="' + (tab === "sup" ? "on" : "") + '" onclick="People.setTab(\'sup\')">' + (x4 ? "الموردون — دائن" : "ديون الموردين — علينا") + "</button></div>";
  }

  function setTab(t) { tab = t; App.rerender(); }

  function customers() {
    if (tab === "sup") return debtTabs() + supDebts();
    var totalDebt = S().customers.reduce(function (s, c) { return s + App.num(c.balance); }, 0);
    var withDebt = S().customers.filter(function (c) { return App.num(c.balance) > 0; }).length;

    var h = debtTabs() + '<div class="grid g3" style="margin-bottom:16px">' +
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
    var rows = App.rank(S().customers.filter(function (c) {
      if (onlyDebt && App.num(c.balance) <= 0) return false;
      return true;
    }).sort(function (a, b) { return App.num(b.balance) - App.num(a.balance); }), q, function (c) {
      return [c.name, c.phone];
    });

    /* عدد فواتير كل زبون مرة واحدة: كان كل صف يمرّ على الفواتير كلها (3000 زبون × 3000 فاتورة
       = ثانيتان لفتح الصفحة)، والجدول يرسم 100 ثم 100 كلما نزلت */
    var nInv = {};
    S().invoices.forEach(function (v) { if (v.customerId) nInv[v.customerId] = (nInv[v.customerId] || 0) + 1; });
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
        h: "عدد الفواتير", cls: "num", c: function (c) { return nInv[c.id] || 0; }
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
      lazy: 100,
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
    if (!App.allow("delete", function () { delCustomer(id); })) return;
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
        c.balance = App.r3(App.num(c.balance) - a);
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
        /* ما أُنقص من الدين فقط يُحسب «له». ما رُدّ له نقداً استلمه بيده، فلا
           يظهر رصيداً له في الكشف (كان الكشف يقول «له 30» وهو أخذها نقداً). */
        var cut = v.debtCut !== undefined ? App.num(v.debtCut) : Math.abs(App.num(v.total));
        var cash = v.debtCut !== undefined ? App.num(v.cashBack) : 0;
        rows.push({ date: v.date, at: v.at, id: v.id, t: "إرجاع فاتورة " + v.refNo + (cash > 0.009 ? " (رُدّ له نقداً " + App.money0(cash) + ")" : ""), dr: 0, cr: cut });
      } else if (App.num(v.due) > 0 || v.method === "credit") {
        rows.push({ date: v.date, at: v.at, id: v.id, t: "فاتورة رقم " + v.no, dr: App.num(v.due), cr: 0 });
      }
    });
    S().payments.forEach(function (p) {
      if (p.customerId !== id) return;
      rows.push({ date: p.date, at: p.at, id: p.id, t: "تسديد" + (p.note ? " — " + p.note : ""), dr: 0, cr: App.num(p.amount) });
    });
    /* الوقت محفوظ بالدقيقة؛ حركتان في نفس الدقيقة تُرتّبان بالمعرّف (يبدأ
       بختم الوقت بالملّي ثانية) بدل ترتيب عشوائي يقلب الرصيد الجاري. */
    rows.sort(function (a, b) {
      var x = String(a.at || ""), y = String(b.at || "");
      if (x !== y) return x < y ? -1 : 1;
      return String(a.id || "") < String(b.id || "") ? -1 : 1;
    });
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
     ديون الموردين — ما علينا
     ------------------------------------------------------------
     الدين لا يُخزَّن رقماً يتعدّل، بل يُحسب كل مرة من سجلات لا تتغيّر:
       الدين السابق (opening) + فواتير الشراء الآجلة − التسديدات.
     هكذا لا يضيع تسديد سُجّل في جهاز وفاتورة سُجّلت في جهاز آخر.
     ============================================================ */

  function supCredits(id) {
    return S().purchases.filter(function (p) { return p.supplierId === id && p.pay === "credit"; });
  }

  function supPays(id) {
    return (S().supPayments || []).filter(function (p) { return p.supplierId === id; });
  }

  /* فواتير آجلة سُجّلت ودينها مؤجّل (من «تحميل فواتير سابقة») — لا تُحسب حتى يُختار ذلك */
  function supLater(id) {
    return S().purchases.filter(function (p) { return p.supplierId === id && p.pay === "later"; });
  }

  function sumTotal(list) {
    return App.r3(list.reduce(function (t, p) { return t + App.num(p.total); }, 0));
  }

  function supCountLater(id) {
    var s = supplier(id), list = supLater(id);
    if (!s || !list.length) return;
    App.confirm("الفواتير المؤجّلة لـ«" + s.name + "» (" + list.length + " فاتورة بـ " + App.money(sumTotal(list)) +
      ") تنضاف لدينه توا، وتصير «آجل» عادي.", function () {
        list.forEach(function (p) { p.pay = "credit"; });
        App.log("دين مؤجّل انحسب", s.name + " " + list.length + " فاتورة بـ " + App.money0(sumTotal(list)));
        App.saveNow(); App.rerender();
        App.toast("انضافت. علينا لـ" + s.name + " الآن: " + App.money(supDebt(s)), "ok");
      }, { yes: "احسبها في الدين" });
  }

  function supDebt(s) {
    if (!s) return 0;
    var d = App.num(s.opening);
    supCredits(s.id).forEach(function (p) { d += App.num(p.total); });
    supPays(s.id).forEach(function (p) { d -= App.num(p.amount); });
    return App.r3(d);
  }

  function supDebts() {
    var list = S().suppliers;
    var total = 0, withDebt = 0;
    list.forEach(function (s) { var d = supDebt(s); if (d > 0) { total += d; withDebt++; } });
    var month = App.today().slice(0, 7);
    var paidMonth = (S().supPayments || []).filter(function (p) { return String(p.date).slice(0, 7) === month; })
      .reduce(function (t, p) { return t + App.num(p.amount); }, 0);
    var later = S().purchases.filter(function (p) { return p.pay === "later"; });

    var h = '<div class="grid g3" style="margin-bottom:16px">' +
      '<div class="card stat bad"><div class="lbl">إجمالي ما علينا للموردين</div><div class="val">' +
      App.money0(total) + '</div><div class="foot">' + withDebt + " مورد علينا ليه" +
      (later.length ? " · وفيه " + later.length + " فاتورة دينها مؤجّل بـ " + App.money0(sumTotal(later)) : "") + "</div></div>" +
      '<div class="card stat accent"><div class="lbl">عدد الموردين</div><div class="val">' + list.length + "</div></div>" +
      '<div class="card stat blue"><div class="lbl">سدّدنا هذا الشهر</div><div class="val">' + App.money0(paidMonth) + "</div></div></div>";

    h += '<div class="row" style="margin-bottom:14px">' +
      '<div class="search-wrap"><span class="mag">⌕</span>' +
      '<input class="inp" placeholder="ابحث باسم المورد أو رقم هاتفه…" value="' + App.esc(sq) + '" oninput="People.setSQ(this.value)"></div>' +
      '<label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" ' + (sOnlyDebt ? "checked" : "") +
      ' onchange="People.setSDebtOnly(this.checked)"> اللي علينا ليهم فقط</label>' +
      '<div class="spacer"></div>' +
      '<button class="btn primary" onclick="People.editSupplier()">+ مورد جديد</button></div>' +
      '<div class="card"><div id="sList"></div></div>' +
      '<p class="muted small" style="line-height:1.8;margin-top:12px">فاتورة الشراء الآجلة تُسجَّل من «إدخال بضاعة ← إضافة كمية» ' +
      "باختيار «آجل»، فتنضاف لدين المورد وحدها.</p>";

    setTimeout(paintSupDebts, 0);
    return h;
  }

  function paintSupDebts() {
    var host = document.getElementById("sList");
    if (!host) return;
    var rows = App.rank(S().suppliers.filter(function (s) {
      return !(sOnlyDebt && supDebt(s) <= 0);
    }).sort(function (a, b) { return supDebt(b) - supDebt(a); }), sq, function (s) { return [s.name, s.phone]; });

    host.innerHTML = App.table([
      {
        h: "المورد", c: function (s) {
          return '<div class="name">' + App.esc(s.name) + "</div>" +
            '<div class="sub">' + App.esc(s.phone || s.city || "بدون رقم") + "</div>";
        }
      },
      {
        h: "علينا", cls: "num", c: function (s) {
          var d = supDebt(s);
          if (d < -0.0005) return '<span class="badge warn">دفعنا زيادة ' + App.money0(-d) + "</span>";
          return d > 0 ? '<b style="color:var(--stamp)">' + App.money0(d) + "</b>" : '<span class="badge ok">خالص</span>';
        }
      },
      {
        h: "فواتير آجلة", cls: "num", c: function (s) {
          var l = supLater(s.id);
          return supCredits(s.id).length + (l.length ? '<div class="sub" style="color:var(--stamp)">+ ' + l.length +
            " مؤجّلة (" + App.money0(sumTotal(l)) + ")</div>" : "");
        }
      },
      {
        h: "آخر فاتورة", c: function (s) {
          var last = "";
          supCredits(s.id).concat(supLater(s.id)).forEach(function (p) { if (String(p.date) > last) last = String(p.date); });
          return last ? App.esc(last) : '<span class="muted">—</span>';
        }
      },
      { h: "ملاحظة", c: function (s) { return App.esc(s.note || "—"); } },
      {
        h: "", cls: "act", c: function (s) {
          return (supDebt(s) > 0 ? '<button class="btn sm primary" onclick="People.supPay(\'' + s.id + '\')">تسديد</button> ' : "") +
            (supLater(s.id).length ? '<button class="btn sm" onclick="People.supCountLater(\'' + s.id + '\')">احسب المؤجّلة</button> ' : "") +
            '<button class="btn sm" onclick="People.supStatement(\'' + s.id + '\')">كشف حساب</button> ' +
            '<button class="btn sm ghost" onclick="People.editSupplier(\'' + s.id + '\')">تعديل</button>';
        }
      }
    ], rows, {
      rowClass: function (s) { return supDebt(s) > 0 ? "low" : ""; },
      emptyIcon: "home",
      emptyTitle: S().suppliers.length ? "لا نتيجة مطابقة" : "لا يوجد موردون",
      emptyText: "سجّل الموردين الذين تشتري منهم بالآجل لتعرف قداش عليك لكل واحد.",
      emptyAction: S().suppliers.length ? "" : '<button class="btn primary" onclick="People.editSupplier()">+ إضافة مورد</button>'
    });
  }

  function setSQ(v) { sq = v; paintSupDebts(); }
  function setSDebtOnly(v) { sOnlyDebt = v; paintSupDebts(); }

  function supPay(id) {
    var s = supplier(id);
    if (!s) return;
    var debt = supDebt(s);
    App.form({
      title: "تسديد للمورد — " + s.name,
      size: "narrow",
      values: { amount: Math.round(debt * 100) / 100, date: App.today(), drawer: "yes" },
      fields: [
        { k: "amount", label: "المبلغ المسدَّد", type: "money", min: 0, required: true, full: true, hint: "علينا حالياً: " + App.money(debt) },
        {
          k: "drawer", label: "من أين دُفع؟", type: "select", full: true,
          options: [{ v: "yes", t: "من درج المحل (يُخصم من النقد المفروض)" }, { v: "no", t: "من خارج الدرج" }],
          hint: "ما يُدفع من الدرج يُطرح من «النقد المفروض» عند إقفال اليوم، فلا يظهر عجز غير حقيقي."
        },
        { k: "date", label: "التاريخ", type: "date", full: true },
        { k: "note", label: "ملاحظة", full: true }
      ],
      saveLabel: "تسجيل التسديد",
      onSave: function (v) {
        var amt = App.num(v.amount);
        if (amt <= 0) { App.toast("أدخل مبلغاً صحيحاً.", "warn"); return false; }
        if (amt > supDebt(s) + 0.009) { App.toast("علينا للمورد " + App.money(supDebt(s)) + " فقط — لا تسدّد أكثر منه.", "warn"); return false; }
        S().supPayments.unshift({
          id: App.uid(), supplierId: s.id, amount: amt,
          date: v.date || App.today(), at: App.nowStamp(), note: v.note || "",
          fromDrawer: v.drawer !== "no"
        });
        App.log("تسديد لمورد", s.name + " " + App.money0(amt));
        App.saveNow(); App.rerender();
        App.toast("سُجّل التسديد. الباقي علينا: " + App.money(supDebt(s)));
      }
    });
  }

  /* كشف المورد بالتفصيل: كل فاتورة منه برقمها وتاريخها (الآجل تنضاف للدين، والنقدي
     مدفوعة وقتها فتظهر عليه وله معاً)، والتسديدات، والرصيد بعد كل حركة */
  function supStatementRows(id) {
    var s = supplier(id), rows = [];
    if (s && App.num(s.opening) > 0) {
      rows.push({ date: String(s.created || "").slice(0, 10) || "—", at: "", id: "", t: "دين سابق (رصيد افتتاحي)", dr: App.num(s.opening), cr: 0 });
    }
    function inv(p) {
      var pieces = (p.lines || []).reduce(function (t, l) { return t + App.num(l.qty); }, 0);
      return { date: p.date, at: p.at || (p.date + " 00:00"), id: p.id, pid: p.id, ref: p.ref ? String(p.ref) : "",
        items: (p.lines || []).length + " صنف · " + pieces + " قطعة" + (p.note && p.note !== "فاتورة " + p.ref ? " — " + p.note : "") };
    }
    S().purchases.forEach(function (p) {
      if (p.supplierId !== id) return;
      var r = inv(p);
      if (p.pay === "credit") { r.dr = App.num(p.total); r.cr = 0; r.t = "فاتورة شراء آجل" + (p.past ? " (سابقة)" : ""); }
      else if (p.pay === "later") {
        r.dr = 0; r.cr = 0; r.later = App.num(p.total);
        r.t = "فاتورة آجل — دينها مؤجّل، مش محسوب (" + App.money0(p.total) + ")";
      } else {
        /* نقداً (أو إدخال قديم بلا طريقة دفع): دُفعت وقتها، ما تغيّرش الرصيد */
        r.dr = App.num(p.total); r.cr = App.num(p.total);
        r.t = p.pay === "cash" ? "فاتورة شراء نقداً — دُفعت وقتها" : "إدخال بضاعة (قبل خانة الدفع)";
        r.cash = true;
      }
      rows.push(r);
    });
    supPays(id).forEach(function (p) {
      rows.push({ date: p.date, at: p.at, id: p.id, dr: 0, cr: App.num(p.amount),
        t: "تسديد" + (p.fromDrawer ? " من الدرج" : "") + (p.note ? " — " + p.note : "") });
    });
    rows.sort(function (a, b) {
      var x = String(a.at || ""), y = String(b.at || "");
      if (x !== y) return x < y ? -1 : 1;
      return String(a.id || "") < String(b.id || "") ? -1 : 1;
    });
    return rows;
  }

  function supStatement(id) {
    var s = supplier(id);
    if (!s) return;
    var run = 0, rows = supStatementRows(id);
    var nInv = rows.filter(function (r) { return r.pid; }).length;
    var bought = S().purchases.filter(function (p) { return p.supplierId === id; }).reduce(function (t, p) { return t + App.num(p.total); }, 0);
    var paid = supPays(id).reduce(function (t, p) { return t + App.num(p.amount); }, 0);
    App.modal({
      title: "كشف حساب المورد — " + s.name,
      size: "wide",
      body: '<div class="row small" style="margin-bottom:12px;gap:8px;flex-wrap:wrap">' +
        '<span class="badge">' + nInv + " فاتورة بـ " + App.money0(bought) + "</span>" +
        '<span class="badge">سدّدنا ' + App.money0(paid) + "</span>" +
        (s.phone ? '<span class="badge">' + App.esc(s.phone) + "</span>" : "") +
        '<span class="muted">اضغط رقم الفاتورة تشوف أصنافها</span></div>' +
        App.table([
          { h: "التاريخ", cls: "nowrap", c: function (r) { return App.esc(r.date); } },
          {
            h: "رقم الفاتورة", c: function (r) {
              if (!r.pid) return '<span class="muted">—</span>';
              return '<button class="btn sm pur-no" onclick="Inv.showPurchase(\'' + r.pid + '\')">' + (r.ref ? App.esc(r.ref) : "عرض") + "</button>";
            }
          },
          {
            h: "البيان", c: function (r) {
              return App.esc(r.t) + (r.items ? '<div class="sub">' + App.esc(r.items) + "</div>" : "");
            }
          },
          { h: "علينا", cls: "num", c: function (r) { return r.dr ? App.money0(r.dr) : "—"; } },
          { h: "دفعنا", cls: "num", c: function (r) { return r.cr ? App.money0(r.cr) : "—"; } },
          { h: "الرصيد", cls: "num", c: function (r) { run = App.r3(run + r.dr - r.cr); return '<b><bdi dir="ltr">' + App.money0(run) + "</bdi></b>"; } }
        ], rows, { emptyIcon: "books", emptyTitle: "لا توجد حركات", emptyText: "لم تُسجَّل فواتير لهذا المورد." }) +
        '<div class="row" style="margin-top:14px;font-size:17px;font-weight:700"><div class="spacer"></div>' +
        (supDebt(s) < -0.0005 ? "دفعنا له زيادة: " + App.money(-supDebt(s)) : "علينا حالياً: " + App.money(supDebt(s))) + "</div>",
      actions: [
        { label: "طباعة الكشف", kind: "primary", click: function () { printSupStatement(id); } },
        { label: "تسديد", click: function (close) { close(); supPay(id); } }
      ]
    });
  }

  function printSupStatement(id) {
    var s = supplier(id);
    var run = 0;
    var h = '<div class="receipt a4"><h2>' + App.esc(S().meta.shopName || "المحل") + "</h2>" +
      '<div class="c">كشف حساب المورد — ' + App.esc(s.name) + (s.phone ? " · " + App.esc(s.phone) : "") + "</div>" +
      '<div class="c">حتى ' + App.dateAr(App.today()) + "</div><hr>" +
      "<table><thead><tr><th>التاريخ</th><th>رقم الفاتورة</th><th>البيان</th><th>علينا</th><th>دفعنا</th><th>الرصيد</th></tr></thead><tbody>";
    supStatementRows(id).forEach(function (r) {
      run = App.r3(run + r.dr - r.cr);
      h += "<tr><td>" + App.esc(r.date) + '</td><td class="num">' + App.esc(r.ref || "") + "</td><td>" + App.esc(r.t) +
        (r.items ? '<div style="font-size:.85em;opacity:.75">' + App.esc(r.items) + "</div>" : "") + '</td><td class="num">' +
        (r.dr ? App.money0(r.dr) : "") + '</td><td class="num">' + (r.cr ? App.money0(r.cr) : "") +
        '</td><td class="num"><bdi dir="ltr">' + App.money0(run) + "</bdi></td></tr>";
    });
    var debtP = supDebt(s);
    h += '</tbody></table><hr><div class="tot g"><span>' + (debtP < -0.0005 ? "دفعنا له زيادة" : "علينا حالياً") + '</span><span class="num">' +
      App.money0(Math.abs(debtP)) + " " + App.esc(S().meta.currency) + "</span></div>" +
      '<br><div style="display:flex;justify-content:space-between"><span>توقيع المورد: ..............</span>' +
      "<span>توقيع المحل: ..............</span></div></div>";
    App.printHtml(h);
  }

  /* ============================================================
     المؤلفون (طرابلس) — حصة المؤلف من كل نسخة تُباع
     ------------------------------------------------------------
     المكتبة تطبع كتب مؤلفين، ولكل نسخة تُباع حصة للمؤلف: نسبة من سعر
     البيع (10% من 100 = 10، فللمكتبة 90) أو مبلغ ثابت للنسخة (10 دينار).
     - الحصة تُحسب وقت البيع وتُحفظ على سطر الفاتورة (au المؤلف، rt/rv
       النوع والقيمة وقتها، ru حصة النسخة الواحدة): تغيير نسبة الكتاب بعدين
       لا يغيّر فاتورة قديمة.
     - ربح الفاتورة بعد طرح حصة المؤلف: الربح مش كله للمكتبة.
     - الإرجاع يطرح حصة ما رجع (بنفس ru)، والتعديل يعيد حسابها، وحذف
       الفاتورة يشيلها معها.
     - ما علينا للمؤلف لا يُخزَّن رقماً يتعدّل، بل يُحسب كل مرة من سجلات لا
       تتغيّر: رصيد سابق + حصته من الفواتير (البيع ناقص الإرجاع) + حصته من
       الفواتير المؤرشفة − ما دفعناه له. فلا يضيع شيء بين جهازين ولا بعد
       حذف فاتورة أو إرجاع.
     ============================================================ */

  var ROY_TYPES = [{ v: "pct", t: "نسبة مئوية من سعر البيع" }, { v: "fix", t: "مبلغ ثابت لكل نسخة" }];

  function authorsOn() { return !!(App.isX4 && App.isX4()); }

  function author(id) {
    if (!id) return null;
    var r = null;
    (S().authors || []).forEach(function (a) { if (a.id === id) r = a; });
    return r;
  }

  /* حصة النسخة الواحدة على سعر بيعها: نسبة (pct) أو مبلغ ثابت (fix). النسخة المجانية ما فيها حصة */
  function royUnit(t, v, price) {
    price = App.num(price); v = App.num(v);
    if (price <= 0 || v <= 0) return 0;
    if (t === "fix") return App.r3(v);
    return App.r3(price * v / 100);
  }

  /* حصة نسخة من هذا الكتاب لو انباعت بهذا السعر (0 لو ما عندوش مؤلف مدفوع) */
  function royFor(it, price) {
    if (!it || !it.royAu || !author(it.royAu)) return 0;
    return royUnit(it.royT === "fix" ? "fix" : "pct", it.royV, price);
  }

  function royText(t, v) {
    return t === "fix" ? App.money0(v) + " " + (S().meta.currency || "") + " للنسخة" : App.num(v) + "%";
  }

  /* سطر فاتورة جديد: يُختم بحصة المؤلف من كتابه الآن */
  function stampRoy(line, it) {
    if (!line) return line;
    delete line.au; delete line.rt; delete line.rv; delete line.ru;
    if (line.type !== "book") return line;
    it = it || App.findItem("book", line.id);
    var ru = royFor(it, line.price);
    if (ru <= 0) return line;
    line.au = it.royAu; line.rt = it.royT === "fix" ? "fix" : "pct"; line.rv = App.num(it.royV); line.ru = ru;
    return line;
  }

  /* سطر كان في الفاتورة (التعديل): نفس المؤلف ونفس الحصة وقت البيع، على السعر الجديد */
  function keepRoy(line, old) {
    delete line.au; delete line.rt; delete line.rv; delete line.ru;
    if (!old || !old.au) return line;
    var t = old.rt === "fix" ? "fix" : "pct";
    var ru = royUnit(t, old.rv, line.price);
    if (ru <= 0) return line;
    line.au = old.au; line.rt = t; line.rv = App.num(old.rv); line.ru = ru;
    return line;
  }

  function lineRoy(l) { return l && l.au ? App.r3(App.num(l.ru) * App.num(l.qty)) : 0; }
  function invRoy(items) {
    return App.r3((items || []).reduce(function (s, l) { return s + lineRoy(l); }, 0));
  }

  /* حصة كل مؤلف من الفواتير وما دفعناه له — مرة واحدة على كل الفواتير */
  function authorTotals() {
    var t = {};
    function T(id) { return t[id] || (t[id] = { roy: 0, sold: 0, back: 0, paid: 0, inv: 0 }); }
    S().invoices.forEach(function (v) {
      var ret = v.kind === "return", seen = {};
      (v.items || []).forEach(function (l) {
        if (!l.au) return;
        var x = T(l.au), r = lineRoy(l), q = App.num(l.qty);
        if (ret) { x.roy -= r; x.back += q; } else { x.roy += r; x.sold += q; }
        if (!ret && !seen[l.au]) { seen[l.au] = 1; x.inv++; }
      });
    });
    (S().authorPays || []).forEach(function (p) { T(p.authorId).paid += App.num(p.amount); });
    Object.keys(t).forEach(function (k) { t[k].roy = App.r3(t[k].roy); t[k].paid = App.r3(t[k].paid); });
    return t;
  }

  /* حصته من الفواتير المؤرشفة (تنتقل لملف الأرشيف، وحسابه يبقى) */
  function archSum(a) {
    var s = 0, m = a && a.arch;
    if (m && typeof m === "object") Object.keys(m).forEach(function (y) { s += App.num(m[y]); });
    return App.r3(s);
  }

  /* ما علينا له الآن */
  function authorDue(a, tot) {
    if (!a) return 0;
    var x = (tot || authorTotals())[a.id] || { roy: 0, paid: 0 };
    return App.r3(App.num(a.opening) + archSum(a) + x.roy - x.paid);
  }

  /* الأرشفة تنقل فواتير سنة: حصة المؤلفين فيها تُحفظ على المؤلف قبل أن تخرج الفواتير */
  function archRoy(rows, year) {
    var by = {};
    (rows || []).forEach(function (v) {
      var sign = v.kind === "return" ? -1 : 1;
      (v.items || []).forEach(function (l) { if (l.au) by[l.au] = App.r3(App.num(by[l.au]) + sign * lineRoy(l)); });
    });
    Object.keys(by).forEach(function (id) {
      var a = author(id);
      if (!a || !by[id]) return;
      if (!a.arch || typeof a.arch !== "object") a.arch = {};
      a.arch[year] = App.r3(App.num(a.arch[year]) + by[id]);
    });
  }

  /* خيارات «مؤلف مدفوع» في بيانات الكتاب */
  function royAuthorOptions() {
    return [{ v: "", t: "— لا يوجد (الربح كله للمكتبة) —" }].concat((S().authors || []).slice()
      .sort(function (a, b) { return String(a.name) < String(b.name) ? -1 : 1; })
      .map(function (a) { return { v: a.id, t: a.name + (App.num(a.defV) > 0 ? " (" + royText(a.defT, a.defV) + ")" : "") }; }))
      .concat([{ v: "__new__", t: "➕ إضافة مؤلف جديد…" }]);
  }

  /* ---------- الصفحة ---------- */

  var aq = "";

  function authorsTab() {
    var list = S().authors || [], tot = authorTotals();
    var owe = 0, nOwe = 0;
    list.forEach(function (a) { var d = authorDue(a, tot); if (d > 0.0005) { owe += d; nOwe++; } });
    var month = App.today().slice(0, 7);
    var paidMonth = (S().authorPays || []).filter(function (p) { return String(p.date).slice(0, 7) === month; })
      .reduce(function (t, p) { return t + App.num(p.amount); }, 0);
    var nBooks = S().books.filter(function (b) { return b.royAu && author(b.royAu); }).length;

    var h = '<div class="grid g3" style="margin-bottom:16px">' +
      '<div class="card stat bad"><div class="lbl">إجمالي ما علينا للمؤلفين</div><div class="val">' + App.money0(owe) +
      '</div><div class="foot">' + nOwe + " مؤلف له علينا</div></div>" +
      '<div class="card stat accent"><div class="lbl">عدد المؤلفين</div><div class="val">' + list.length +
      '</div><div class="foot">' + nBooks + " كتاب فيه حصة لمؤلف</div></div>" +
      '<div class="card stat blue"><div class="lbl">دفعنا لهم هذا الشهر</div><div class="val">' + App.money0(paidMonth) + "</div></div></div>";

    h += '<div class="row" style="margin-bottom:14px">' +
      '<div class="search-wrap"><span class="mag">⌕</span>' +
      '<input class="inp" placeholder="ابحث باسم المؤلف أو رقم هاتفه…" value="' + App.esc(aq) + '" oninput="People.setAQ(this.value)"></div>' +
      '<div class="spacer"></div>' +
      '<button class="btn primary" onclick="People.editAuthor()">+ مؤلف جديد</button></div>' +
      '<div class="card"><div id="aList"></div></div>' +
      '<p class="muted small" style="line-height:1.9;margin-top:12px">المؤلف يتربط بكتابه من بيانات الكتاب ← «مؤلف مدفوع». ' +
      "كل نسخة تنباع تنضاف حصته هنا وحدها (نسبة من سعر البيع أو مبلغ ثابت للنسخة)، والإرجاع ينقصها، وحذف الفاتورة يشيلها. " +
      "والربح في التقارير بعد طرح حصته.</p>";
    setTimeout(paintAuthors, 0);
    return h;
  }

  function paintAuthors() {
    var host = document.getElementById("aList");
    if (!host) return;
    var tot = authorTotals(), nb = {};
    S().books.forEach(function (b) { if (b.royAu) nb[b.royAu] = (nb[b.royAu] || 0) + 1; });
    var list = (S().authors || []).slice().sort(function (a, b) { return authorDue(b, tot) - authorDue(a, tot); });
    var rows = App.rank(list, aq, function (a) { return [a.name, a.phone]; });
    host.innerHTML = App.table([
      {
        h: "المؤلف", c: function (a) {
          return '<div class="name">' + App.esc(a.name) + "</div>" +
            '<div class="sub">' + App.esc(a.phone || "بدون رقم") + (App.num(a.defV) > 0 ? " · حصته عادةً " + App.esc(royText(a.defT, a.defV)) : "") + "</div>";
        }
      },
      { h: "كتبه", cls: "num", c: function (a) { return nb[a.id] || 0; } },
      {
        h: "النسخ المباعة", cls: "num", c: function (a) {
          var x = tot[a.id];
          return x ? (x.sold - x.back) + (x.back ? '<div class="sub">رجع ' + x.back + "</div>" : "") : 0;
        }
      },
      { h: "حصته من المبيعات", cls: "num", c: function (a) { var x = tot[a.id]; return App.money0(x ? x.roy : 0); } },
      { h: "دفعنا له", cls: "num", c: function (a) { var x = tot[a.id]; return App.money0(x ? x.paid : 0); } },
      {
        h: "له علينا", cls: "num", c: function (a) {
          var d = authorDue(a, tot);
          if (d > 0.0005) return '<b style="color:var(--stamp)">' + App.money0(d) + "</b>";
          if (d < -0.0005) return '<span class="badge warn">دفعنا زيادة ' + App.money0(-d) + "</span>";
          return '<span class="badge ok">خالص</span>';
        }
      },
      {
        h: "", cls: "act", c: function (a) {
          return (authorDue(a, tot) > 0.0005 ? '<button class="btn sm primary" onclick="People.authorPay(\'' + a.id + '\')">تسديد</button> ' : "") +
            '<button class="btn sm" onclick="People.authorStatement(\'' + a.id + '\')">كشف حساب</button> ' +
            '<button class="btn sm" onclick="People.authorBooks(\'' + a.id + '\')">عرض كتبه</button> ' +
            '<button class="btn sm ghost" onclick="People.editAuthor(\'' + a.id + '\')">تعديل</button> ' +
            '<button class="btn sm ghost" onclick="People.delAuthor(\'' + a.id + '\')">حذف</button>';
        }
      }
    ], rows, {
      rowClass: function (a) { return authorDue(a, tot) > 0.0005 ? "low" : ""; },
      emptyIcon: "people",
      emptyTitle: (S().authors || []).length ? "لا نتيجة مطابقة" : "لا يوجد مؤلفون",
      emptyText: "سجّل المؤلفين اللي لهم حصة من كل نسخة تنباع من كتبهم.",
      emptyAction: (S().authors || []).length ? "" : '<button class="btn primary" onclick="People.editAuthor()">+ إضافة مؤلف</button>'
    });
  }

  function setAQ(v) { aq = v; paintAuthors(); }

  /* cb: من بيانات الكتاب («➕ إضافة مؤلف جديد…»): يرجع المؤلف الجديد ولا تُعاد الصفحة */
  function editAuthor(id, cb) {
    var a = id ? author(id) : null;
    App.form({
      title: a ? "تعديل مؤلف" : "مؤلف جديد",
      values: a || { defT: "pct", defV: 10, opening: 0 },
      fields: [
        { k: "name", label: "اسم المؤلف", required: true, full: true },
        { k: "phone", label: "رقم الهاتف" },
        {
          k: "opening", label: "رصيد سابق له علينا", type: "money", min: 0,
          hint: a ? "عدّله بحذر — حصته من الفواتير والتسديدات تنحسب وحدها" : "اتركه صفراً إن ما عندوش علينا شي من قبل"
        },
        { k: "defT", label: "حصته عادةً", type: "select", options: ROY_TYPES, hint: "تنكتب وحدها لما تختاره لكتاب، وتقدر تغيّرها لكل كتاب" },
        { k: "defV", label: "قيمة حصته", type: "number", min: 0, hint: "مثال: 10 = 10% من سعر البيع، أو 10 دينار للنسخة حسب النوع" },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        v.name = String(v.name || "").trim();
        var dup = null;
        (S().authors || []).forEach(function (x) { if (x !== a && App.norm(x.name) === App.norm(v.name)) dup = x; });
        if (dup) { App.toast("المؤلف «" + dup.name + "» مسجّل من قبل.", "warn"); return false; }
        v.opening = App.r3(Math.max(App.num(v.opening), 0));
        v.defT = v.defT === "fix" ? "fix" : "pct";
        v.defV = App.r3(Math.max(App.num(v.defV), 0));
        if (v.defT === "pct" && v.defV >= 100) { App.toast("نسبة المؤلف لازم أقل من 100%.", "warn"); return false; }
        var saved;
        if (a) {
          Object.keys(v).forEach(function (k) { a[k] = v[k]; });
          App.log("تعديل مؤلف", a.name);
          saved = a;
        } else {
          v.id = App.uid(); v.created = App.nowStamp();
          S().authors.push(v);
          App.log("إضافة مؤلف", v.name);
          saved = v;
        }
        App.save();
        if (cb) cb(saved); else App.rerender();
        App.toast("حُفظ المؤلف: " + saved.name);
      }
    });
  }

  function delAuthor(id) {
    var a = author(id);
    if (!a) return;
    if (!App.allow("delete", function () { delAuthor(id); })) return;
    var due = authorDue(a);
    if (Math.abs(due) > 0.009) {
      App.toast(due > 0 ? "ما ينحذفش: للمؤلف علينا " + App.money(due) + ". سدّد له أولاً."
        : "ما ينحذفش: دفعنا له زيادة " + App.money(-due) + " — صحّح حسابه أولاً.", "warn");
      return;
    }
    var books = S().books.filter(function (b) { return b.royAu === id; });
    App.confirm("سيُحذف المؤلف «" + a.name + "»" +
      (books.length ? "، ويتشال من " + books.length + " كتاب: الكتب تبقى، والنسخ اللي تنباع بعدها ما فيهاش حصة له" : "") +
      ". الفواتير القديمة تبقى كما هي، لكن كشف حسابه يروح معاه.", function () {
        books.forEach(function (b) { delete b.royAu; delete b.royT; delete b.royV; b.updated = App.nowStamp(); });
        S().authors.splice(S().authors.indexOf(a), 1);
        App.log("حذف مؤلف", a.name);
        App.save(); App.rerender();
      }, { danger: true, yes: "حذف" });
  }

  function authorPay(id) {
    var a = author(id);
    if (!a) return;
    var due = authorDue(a);
    App.form({
      title: "تسديد للمؤلف — " + a.name,
      size: "narrow",
      values: { amount: Math.max(Math.round(due * 100) / 100, 0), date: App.today(), drawer: "yes" },
      fields: [
        { k: "amount", label: "المبلغ المدفوع له", type: "money", min: 0, required: true, full: true, hint: "له علينا حالياً: " + App.money(due) },
        {
          k: "drawer", label: "من أين دُفع؟", type: "select", full: true,
          options: [{ v: "yes", t: "من درج المحل (يُخصم من النقد المفروض)" }, { v: "no", t: "من خارج الدرج" }],
          hint: "ما يُدفع من الدرج يُطرح من «النقد المفروض» عند إقفال اليوم، فلا يظهر عجز غير حقيقي."
        },
        { k: "date", label: "التاريخ", type: "date", full: true },
        { k: "note", label: "ملاحظة", full: true }
      ],
      saveLabel: "تسجيل التسديد",
      onSave: function (v) {
        var amt = App.r3(App.num(v.amount)), now = authorDue(a);
        if (amt <= 0) { App.toast("أدخل مبلغاً صحيحاً.", "warn"); return false; }
        if (amt > now + 0.009) { App.toast("للمؤلف علينا " + App.money(now) + " بس — ما تدفعش أكثر منه.", "warn"); return false; }
        S().authorPays.unshift({
          id: App.uid(), authorId: a.id, amount: amt,
          date: v.date || App.today(), at: App.nowStamp(), note: v.note || "",
          fromDrawer: v.drawer !== "no"
        });
        App.log("تسديد لمؤلف", a.name + " " + App.money0(amt));
        App.saveNow(); App.rerender();
        App.toast("سُجّل التسديد. الباقي له علينا: " + App.money(authorDue(a)));
      }
    });
  }

  /* كشف الحساب: كل فاتورة انباع فيها كتابه (سطر لكل كتاب)، والإرجاعات، والتسديدات */
  function authorRows(id) {
    var a = author(id), rows = [];
    if (!a) return rows;
    if (App.num(a.opening) > 0) {
      rows.push({ date: String(a.created || "").slice(0, 10) || "—", at: "", id: "", t: "رصيد سابق له علينا", cr: App.num(a.opening), dr: 0 });
    }
    var arch = a.arch && typeof a.arch === "object" ? a.arch : {};
    Object.keys(arch).sort().forEach(function (y) {
      var v = App.num(arch[y]);
      if (!v) return;
      rows.push({ date: y + "-12-31", at: y + "-12-31 23:59", id: "", t: "حصته من فواتير سنة " + y + " (مؤرشفة)", cr: Math.max(v, 0), dr: Math.max(-v, 0) });
    });
    S().invoices.forEach(function (v) {
      var ret = v.kind === "return";
      (v.items || []).forEach(function (l, i) {
        if (l.au !== id) return;
        var r = lineRoy(l);
        rows.push({
          date: v.date, at: v.at, id: v.id + ":" + i, inv: v.id, no: v.no, ret: ret,
          t: ret ? "إرجاع من فاتورة " + v.refNo : "فاتورة رقم " + v.no,
          book: l.name, qty: App.num(l.qty), price: App.num(l.price), share: royText(l.rt, l.rv), unit: App.num(l.ru),
          cr: ret ? 0 : r, dr: ret ? r : 0
        });
      });
    });
    (S().authorPays || []).forEach(function (p) {
      if (p.authorId !== id) return;
      rows.push({ date: p.date, at: p.at, id: p.id, pay: true, cr: 0, dr: App.num(p.amount),
        t: "دفعنا له" + (p.fromDrawer ? " من الدرج" : "") + (p.note ? " — " + p.note : "") });
    });
    rows.sort(function (x, y) {
      var p = String(x.at || ""), q = String(y.at || "");
      if (p !== q) return p < q ? -1 : 1;
      return String(x.id || "") < String(y.id || "") ? -1 : 1;
    });
    return rows;
  }

  function authorStatement(id) {
    var a = author(id);
    if (!a) return;
    var rows = authorRows(id), run = 0;
    var books = S().books.filter(function (b) { return b.royAu === id; });
    App.modal({
      title: "كشف حساب المؤلف — " + a.name,
      size: "wide",
      body: (books.length ? '<div class="small" style="margin-bottom:12px;line-height:2">كتبه: ' + books.map(function (b) {
        return '<span class="badge">' + App.esc(b.title) + " · " + App.esc(royText(b.royT, b.royV)) + "</span>";
      }).join(" ") + "</div>" : "") +
        App.table([
          { h: "التاريخ", cls: "nowrap", c: function (r) { return App.esc(r.date); } },
          {
            h: "البيان", c: function (r) {
              if (r.inv) return '<button class="btn sm ' + (r.ret ? "ghost" : "") + '" onclick="Sales.showInvoice(\'' + r.inv + '\')">' +
                App.esc(r.t) + "</button>" + (r.ret ? ' <span class="badge bad">إرجاع</span>' : "");
              return App.esc(r.t);
            }
          },
          { h: "الكتاب", c: function (r) { return r.book ? App.esc(r.book) : '<span class="muted">—</span>'; } },
          { h: "النسخ", cls: "num", c: function (r) { return r.inv ? '<bdi dir="ltr">' + (r.ret ? "−" : "") + r.qty + "</bdi>" : "—"; } },
          {
            h: "حصته", cls: "num", c: function (r) {
              return r.inv ? App.esc(r.share) + '<div class="sub">' + App.money0(r.unit) + " للنسخة من " + App.money0(r.price) + "</div>" : "—";
            }
          },
          { h: "له", cls: "num", c: function (r) { return r.cr ? App.money0(r.cr) : "—"; } },
          { h: "خُصم / دفعنا", cls: "num", c: function (r) { return r.dr ? App.money0(r.dr) : "—"; } },
          { h: "الرصيد", cls: "num", c: function (r) { run = App.r3(run + r.cr - r.dr); return '<b><bdi dir="ltr">' + App.money0(run) + "</bdi></b>"; } }
        ], rows, { emptyIcon: "books", emptyTitle: "لا توجد حركات", emptyText: "ما انباعتش نسخ من كتبه بعد." }) +
        '<div class="row" style="margin-top:14px;font-size:17px;font-weight:700"><div class="spacer"></div>' +
        (authorDue(a) < -0.0005 ? "دفعنا له زيادة: " + App.money(-authorDue(a)) : "له علينا حالياً: " + App.money(authorDue(a))) + "</div>",
      actions: [
        { label: "طباعة الكشف", kind: "primary", click: function () { printAuthorStatement(id); } },
        { label: "تسديد", click: function (close) { close(); authorPay(id); } }
      ]
    });
  }

  /* كتب المؤلف المربوطة بحصته (royAu): العنوان، الحصة، الكمية، السعر */
  function authorBooks(id) {
    var a = author(id);
    if (!a) return;
    var books = S().books.filter(function (b) { return b.royAu === id; });
    App.modal({
      title: "كتب المؤلف — " + a.name,
      size: "wide",
      body: '<p class="muted small" style="margin:0 0 10px">' + books.length + " كتاب مربوط بحصته. تُربط الكتب من «تعديل» الكتاب ← المؤلف وحصته.</p>" +
        App.table([
          { h: "الكتاب", c: function (b) { return '<div class="name">' + App.esc(b.title) + '</div><div class="sub">' + App.esc([b.code, b.barcode].filter(Boolean).join(" · ")) + "</div>"; } },
          { h: "حصته", c: function (b) { return App.esc(royText(b.royT, b.royV)); } },
          { h: "الكمية", cls: "num", c: function (b) { return b.uncounted ? '<span class="badge">لم يُجرد</span>' : App.num(b.qty); } },
          { h: "السعر", cls: "num", c: function (b) { return App.num(b.price) > 0 ? App.money0(b.price) : '<span class="muted">—</span>'; } },
          { h: "", cls: "act", c: function (b) { return '<button class="btn sm ghost" onclick="Inv.editBook(\'' + b.id + '\')">تعديل</button>'; } }
        ], books, { lazy: 100, emptyIcon: "books", emptyTitle: "لا كتب مربوطة", emptyText: "اربط كتبه من «تعديل» الكتاب." }),
      cancelLabel: "إغلاق"
    });
  }

  function printAuthorStatement(id) {
    var a = author(id);
    if (!a) return;
    var run = 0;
    var h = '<div class="receipt a4"><h2>' + App.esc(S().meta.shopName || "المحل") + "</h2>" +
      '<div class="c">كشف حساب المؤلف — ' + App.esc(a.name) + (a.phone ? " · " + App.esc(a.phone) : "") + "</div>" +
      '<div class="c">حتى ' + App.dateAr(App.today()) + "</div><hr>" +
      "<table><thead><tr><th>التاريخ</th><th>البيان</th><th>الكتاب</th><th>النسخ</th><th>حصته</th><th>له</th><th>خُصم / دفعنا</th><th>الرصيد</th></tr></thead><tbody>";
    authorRows(id).forEach(function (r) {
      run = App.r3(run + r.cr - r.dr);
      h += "<tr><td>" + App.esc(r.date) + "</td><td>" + App.esc(r.t) + "</td><td>" + App.esc(r.book || "") + '</td><td class="num">' +
        (r.inv ? '<bdi dir="ltr">' + (r.ret ? "−" : "") + r.qty + "</bdi>" : "") + '</td><td class="num">' + (r.inv ? App.esc(r.share) : "") + '</td><td class="num">' +
        (r.cr ? App.money0(r.cr) : "") + '</td><td class="num">' + (r.dr ? App.money0(r.dr) : "") +
        '</td><td class="num"><bdi dir="ltr">' + App.money0(run) + "</bdi></td></tr>";
    });
    var dueP = authorDue(a);
    h += '</tbody></table><hr><div class="tot g"><span>' + (dueP < -0.0005 ? "دفعنا له زيادة" : "له علينا حالياً") + '</span><span class="num">' +
      App.money0(Math.abs(dueP)) + " " + App.esc(S().meta.currency) + "</span></div>" +
      '<br><div style="display:flex;justify-content:space-between"><span>توقيع المؤلف: ..............</span>' +
      "<span>توقيع المكتبة: ..............</span></div></div>";
    App.printHtml(h);
  }

  /* ============================================================
     الموردون
     ============================================================ */

  /* طرابلس: المؤلفون ودور النشر والموردون في تبويبات (مصراتة كما كانت: دور النشر ثم الموردون) */
  var spTab = "auth";
  function setSpTab(t) { spTab = t; App.rerender(); }

  function suppliers() {
    if (!authorsOn()) return publishersCard() + suppliersList();
    var h = '<div class="seg" style="margin-bottom:16px;max-width:560px">' +
      '<button class="' + (spTab === "auth" ? "on" : "") + '" onclick="People.setSpTab(\'auth\')">المؤلفون</button>' +
      '<button class="' + (spTab === "pub" ? "on" : "") + '" onclick="People.setSpTab(\'pub\')">دور النشر</button>' +
      '<button class="' + (spTab === "sup" ? "on" : "") + '" onclick="People.setSpTab(\'sup\')">الموردون</button></div>';
    if (spTab === "pub") return h + publishersCard();
    if (spTab === "sup") return h + suppliersList();
    return h + authorsTab();
  }

  function publishersCard() {
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
    return h;
  }

  function suppliersList() {
    var h = '<div class="row" style="margin-bottom:14px"><div class="spacer"></div>' +
      '<button class="btn primary" onclick="People.editSupplier()">+ مورد جديد</button></div>' +
      '<div class="card">' +
      App.table([
        { h: "المورد", c: function (s) { return '<div class="name">' + App.esc(s.name) + '</div><div class="sub">' + App.esc(s.phone || "") + "</div>"; } },
        { h: "المدينة / العنوان", c: function (s) { return App.esc(s.city || "—"); } },
        {
          h: "عدد الفواتير", cls: "num", c: function (s) {
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
            return '<button class="btn sm" onclick="People.supStatement(\'' + s.id + '\')">كشف حساب</button> ' +
              '<button class="btn sm ghost" onclick="People.editSupplier(\'' + s.id + '\')">تعديل</button> ' +
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
        {
          k: "opening", label: "دين سابق علينا (رصيد افتتاحي)", type: "money", min: 0,
          hint: s ? "عدّله بحذر — الفواتير الآجلة والتسديدات تُحسب وحدها" : "اتركه صفراً إن لم يكن علينا له شيء"
        },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        v.opening = App.num(v.opening);
        if (s) { Object.keys(v).forEach(function (k) { s[k] = v[k]; }); }
        else { v.id = App.uid(); v.created = App.nowStamp(); S().suppliers.push(v); }
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
        var rt = Inv.normRate(v.rate);
        if (rt === null) return false;
        v.rate = rt;
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
    if (!App.allow("delete", function () { delPublisher(id); })) return;
    App.confirm("سيُحذف «" + p2.name + "» من دور النشر. الكتب المسجّلة باسمها تبقى كما هي.", function () {
      S().publishers.splice(S().publishers.indexOf(p2), 1);
      App.save(); App.rerender();
    }, { danger: true, yes: "حذف" });
  }

  function delSupplier(id) {
    var s = supplier(id);
    if (!s) return;
    if (!App.allow("delete", function () { delSupplier(id); })) return;
    if (supDebt(s) > 0 || supLater(id).length) { App.toast("لا يمكن حذف مورد علينا له دين (أو فواتير دينها مؤجّل). سدّد الدين أولاً.", "warn"); return; }
    App.confirm("سيُحذف المورد «" + s.name + "». سجل المشتريات يبقى محفوظاً.", function () {
      S().suppliers.splice(S().suppliers.indexOf(s), 1);
      App.save(); App.rerender();
    }, { danger: true, yes: "حذف" });
  }

  return {
    customers: customers, customer: customer, editCustomer: editCustomer, delCustomer: delCustomer,
    pay: pay, statement: statement, printStatement: printStatement, exportDebts: exportDebts,
    setQ: setQ, setDebtOnly: setDebtOnly, setTab: setTab,
    supDebt: supDebt, supPay: supPay, supStatement: supStatement, printSupStatement: printSupStatement,
    supCountLater: supCountLater,
    setSQ: setSQ, setSDebtOnly: setSDebtOnly,
    suppliers: suppliers, supplier: supplier, editSupplier: editSupplier, delSupplier: delSupplier,
    publisher: publisher, editPublisher: editPublisher, delPublisher: delPublisher,
    setSpTab: setSpTab,
    /* المؤلفون (طرابلس) */
    ROY_TYPES: ROY_TYPES, authorsOn: authorsOn, author: author, royUnit: royUnit, royFor: royFor, royText: royText,
    stampRoy: stampRoy, keepRoy: keepRoy, lineRoy: lineRoy, invRoy: invRoy, authorTotals: authorTotals,
    authorDue: authorDue, archRoy: archRoy, royAuthorOptions: royAuthorOptions,
    setAQ: setAQ, editAuthor: editAuthor, delAuthor: delAuthor, authorPay: authorPay,
    authorRows: authorRows, authorStatement: authorStatement, printAuthorStatement: printAuthorStatement, authorBooks: authorBooks
  };
})();
