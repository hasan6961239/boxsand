/* ============================================================
   consign.js — كتب على المباع
   زبون أو مورّد يترك كتبه عندك لتبيعها، ويأتي لاحقاً للجرد.
   ============================================================ */

var Consign = (function () {

  var view = { where: "list", id: "", q: "" };

  function S() { return App.S; }

  /* ---------- أدوات ---------- */

  function owner(id) {
    var r = null;
    S().consignors.forEach(function (c) { if (c.id === id) r = c; });
    return r;
  }

  function linesOf(ownerId) {
    return S().consignments.filter(function (l) { return l.ownerId === ownerId; });
  }

  function byItem(itemId) {
    var r = null;
    S().consignments.forEach(function (l) { if (l.itemId === itemId) r = l; });
    return r;
  }

  /* حساب صاحب البضاعة */
  function account(ownerId) {
    var lines = linesOf(ownerId);
    var a = { qty: 0, sold: 0, left: 0, due: 0, paid: 0, rest: 0, myProfit: 0, titles: lines.length };
    lines.forEach(function (l) {
      var q = App.num(l.qty), sd = App.num(l.sold), rt = App.num(l.returned);
      a.qty += q;
      a.sold += sd;
      a.left += Math.max(q - sd - rt, 0);
      a.due += sd * App.num(l.ownerPrice);
      a.myProfit += sd * (App.num(l.price) - App.num(l.ownerPrice));
    });
    S().consPayments.forEach(function (p) { if (p.ownerId === ownerId) a.paid += App.num(p.amount); });
    a.rest = a.due - a.paid;
    return a;
  }

  /* عدد أصحاب البضاعة الذين لهم مستحقات */
  function activeCount() {
    var n = 0;
    S().consignors.forEach(function (c) {
      var a = account(c.id);
      if (a.rest > 0.009 || a.left > 0) n++;
    });
    return n;
  }

  /* ---------- تسجيل البيع والإرجاع (يستدعيها نظام البيع) ---------- */

  function recordSale(itemId, qty) {
    var l = byItem(itemId);
    if (!l) return;
    l.sold = App.num(l.sold) + App.num(qty);
  }

  function recordReturn(itemId, qty) {
    var l = byItem(itemId);
    if (!l) return;
    l.sold = Math.max(App.num(l.sold) - App.num(qty), 0);
  }

  /* ============================================================
     الصفحة
     ============================================================ */

  function page() {
    if (view.where === "owner") return ownerPage(view.id);
    return list();
  }

  function list() {
    var rows = S().consignors.map(function (c) {
      return { c: c, a: account(c.id) };
    });
    var nq = App.norm(view.q);
    if (nq) rows = rows.filter(function (r) { return App.norm(r.c.name + " " + (r.c.phone || "")).indexOf(nq) >= 0; });
    rows.sort(function (x, y) { return y.a.rest - x.a.rest; });

    var totDue = rows.reduce(function (s, r) { return s + r.a.rest; }, 0);
    var totLeft = rows.reduce(function (s, r) { return s + r.a.left; }, 0);
    var totSold = rows.reduce(function (s, r) { return s + r.a.sold; }, 0);

    var h = '<div class="grid g4" style="margin-bottom:18px">' +
      card("accent", "أصحاب البضاعة", String(S().consignors.length), "") +
      card("blue", "نسخ عندك الآن", String(totLeft), "لم تُبع بعد") +
      card("accent", "نسخ بِعتها", String(totSold), "") +
      card(totDue > 0 ? "bad" : "accent", "مستحق لأصحابها", App.money0(totDue), "بعد خصم ما سدّدته") +
      "</div>";

    h += '<div class="row" style="margin-bottom:14px">' +
      '<div class="search-wrap"><span class="mag">⌕</span>' +
      '<input class="inp" placeholder="ابحث باسم صاحب البضاعة أو رقم هاتفه…" value="' + App.esc(view.q) +
      '" oninput="Consign.setQ(this.value)"></div>' +
      '<div class="spacer"></div>' +
      '<button class="btn" onclick="Consign.exportAll()">تصدير Excel</button>' +
      '<button class="btn primary lg" onclick="Consign.addBooks()">+ استلام كتب جديدة</button>' +
      "</div>";

    h += '<div class="card">' + App.table([
      {
        h: "صاحب البضاعة", c: function (r) {
          return '<div class="name">' + App.esc(r.c.name) + "</div>" +
            '<div class="sub">' + App.esc(r.c.phone || "بدون رقم") + "</div>";
        }
      },
      { h: "عناوين", cls: "num", c: function (r) { return r.a.titles; } },
      { h: "استلمت", cls: "num", c: function (r) { return r.a.qty; } },
      { h: "بِعت", cls: "num", c: function (r) { return "<b>" + r.a.sold + "</b>"; } },
      { h: "باقٍ عندك", cls: "num", c: function (r) { return r.a.left; } },
      {
        h: "المستحق له", cls: "num", c: function (r) {
          return r.a.rest > 0.009
            ? '<b style="color:var(--stamp)">' + App.money0(r.a.rest) + "</b>"
            : '<span class="badge ok">خالص</span>';
        }
      },
      { h: "ربحك منه", cls: "num", c: function (r) { return App.canProfit() ? App.money0(r.a.myProfit) : "—"; } },
      {
        h: "", cls: "act", c: function (r) {
          return '<button class="btn sm primary" onclick="Consign.open(\'' + r.c.id + '\')">كشف الحساب</button> ' +
            (r.a.rest > 0.009 ? '<button class="btn sm" onclick="Consign.pay(\'' + r.c.id + '\')">تسديد</button>' : "");
        }
      }
    ], rows, {
      rowClass: function (r) { return r.a.rest > 0.009 ? "low" : ""; },
      emptyIcon: "books",
      emptyTitle: S().consignors.length ? "لا نتيجة" : "لا يوجد كتب على المباع",
      emptyText: "عندما يترك عندك أحدهم كتباً لتبيعها، سجّلها هنا لتعرف كم بِعت وكم تستحق له.",
      emptyAction: '<button class="btn primary" onclick="Consign.addBooks()">+ استلام كتب</button>'
    }) + "</div>";

    return h;
  }

  function card(kind, lbl, val, foot) {
    return '<div class="card stat ' + kind + '"><div class="lbl">' + App.esc(lbl) + "</div>" +
      '<div class="val">' + val + "</div>" +
      (foot ? '<div class="foot">' + App.esc(foot) + "</div>" : "") + "</div>";
  }

  /* ---------- استلام كتب ---------- */

  var draft = null;

  function addBooks() {
    draft = { ownerId: "", name: "", phone: "", date: App.today(), note: "", lines: [] };
    showDraft();
  }

  function showDraft() {
    var owners = S().consignors.map(function (c) { return { v: c.id, t: c.name + (c.phone ? " · " + c.phone : "") }; });

    var body = document.createElement("div");
    body.innerHTML =
      '<div class="form-grid" style="margin-bottom:14px">' +
      '<div class="field full"><label>صاحب البضاعة</label>' +
      '<select class="inp" id="cnOwner" onchange="Consign.pickOwner(this.value)">' +
      '<option value="">— صاحب جديد —</option>' +
      owners.map(function (o) { return '<option value="' + o.v + '"' + (draft.ownerId === o.v ? " selected" : "") + ">" + App.esc(o.t) + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="field" id="cnNameWrap"><label>الاسم <span style="color:var(--stamp)">*</span></label>' +
      '<input class="inp" id="cnName" value="' + App.esc(draft.name) + '" oninput="Consign.d(\'name\',this.value)"></div>' +
      '<div class="field" id="cnPhoneWrap"><label>رقم الهاتف</label>' +
      '<input class="inp" id="cnPhone" value="' + App.esc(draft.phone) + '" oninput="Consign.d(\'phone\',this.value)"></div>' +
      '<div class="field"><label>تاريخ الاستلام</label>' +
      '<input type="date" class="inp" value="' + draft.date + '" onchange="Consign.d(\'date\',this.value)"></div>' +
      '<div class="field"><label>ملاحظة</label>' +
      '<input class="inp" value="' + App.esc(draft.note) + '" oninput="Consign.d(\'note\',this.value)"></div>' +
      "</div>" +
      '<div id="cnLines"></div>' +
      '<button class="btn" style="margin-top:10px" onclick="Consign.addLine()">+ إضافة كتاب</button>';

    App.modal({
      title: "استلام كتب على المباع",
      size: "wide",
      body: body,
      cancelLabel: "إلغاء",
      actions: [{
        label: "حفظ الاستلام", kind: "primary", click: function (close) {
          if (save()) close();
        }
      }]
    });
    setTimeout(function () { paintLines(); syncOwnerFields(); }, 0);
  }

  function d(k, v) { if (draft) draft[k] = v; }

  function pickOwner(id) {
    if (!draft) return;
    draft.ownerId = id;
    var o = owner(id);
    if (o) { draft.name = o.name; draft.phone = o.phone || ""; }
    syncOwnerFields();
  }

  function syncOwnerFields() {
    if (!draft) return;
    var isNew = !draft.ownerId;
    var n = document.getElementById("cnName"), p = document.getElementById("cnPhone");
    if (n) { n.value = draft.name || ""; n.disabled = !isNew; }
    if (p) { p.value = draft.phone || ""; p.disabled = !isNew; }
  }

  function addLine() {
    if (!draft) return;
    draft.lines.push({
      kind: "book", title: "", author: "", code: "", qty: 1, ownerPrice: 0, price: 0,
      lib: S().meta.libraries[0] || "", shelf: 1, loc: "", unit: "قطعة"
    });
    paintLines();
  }

  function paintLines() {
    var host = document.getElementById("cnLines");
    if (!host || !draft) return;
    if (!draft.lines.length) {
      host.innerHTML = '<div class="empty" style="padding:22px"><p>لم تُضف كتباً بعد. اضغط «إضافة كتاب».</p></div>';
      return;
    }
    var libs = S().meta.libraries;
    var shelves = [];
    for (var i = 1; i <= (App.num(S().meta.shelves) || 6); i++) shelves.push(i);

    var h = '<table class="tbl"><thead><tr>' +
      "<th>النوع</th><th>الاسم</th><th>المؤلف / الماركة</th><th>الكود أو الباركود</th><th>العدد</th>" +
      "<th>سعر صاحبه</th><th>سعر البيع</th><th>ربحك</th><th>الموقع</th><th></th></tr></thead><tbody>";
    draft.lines.forEach(function (l, i) {
      var prof = (App.num(l.price) - App.num(l.ownerPrice)) * App.num(l.qty);
      var isBook = (l.kind !== "stat");
      h += "<tr>" +
        '<td><select class="inp" style="width:104px" onchange="Consign.setLine(' + i + ',\'kind\',this.value)">' +
        '<option value="book"' + (isBook ? " selected" : "") + ">كتاب</option>" +
        '<option value="stat"' + (!isBook ? " selected" : "") + ">قرطاسية</option></select></td>" +
        '<td><input class="inp" style="min-width:160px" value="' + App.esc(l.title) + '" onchange="Consign.setLine(' + i + ',\'title\',this.value)"></td>' +
        '<td><input class="inp" style="min-width:110px" value="' + App.esc(l.author) + '" onchange="Consign.setLine(' + i + ',\'author\',this.value)"></td>' +
        '<td><input class="inp num" style="width:130px" value="' + App.esc(l.code || "") + '" placeholder="يُولَّد تلقائياً" onchange="Consign.setLine(' + i + ',\'code\',this.value)"></td>' +
        '<td><input class="inp num" style="width:74px" type="number" min="1" value="' + App.num(l.qty) + '" onchange="Consign.setLine(' + i + ',\'qty\',this.value)"></td>' +
        '<td><input class="inp num" style="width:96px" type="number" step="0.25" min="0" value="' + App.num(l.ownerPrice) + '" onchange="Consign.setLine(' + i + ',\'ownerPrice\',this.value)"></td>' +
        '<td><input class="inp num" style="width:96px" type="number" step="0.25" min="0" value="' + App.num(l.price) + '" onchange="Consign.setLine(' + i + ',\'price\',this.value)"></td>' +
        '<td class="num"><b style="color:' + (prof >= 0 ? "var(--accent)" : "var(--stamp)") + '">' + App.money0(prof) + "</b></td>" +
        "<td>" + (isBook
          ? '<select class="inp" style="width:70px" onchange="Consign.setLine(' + i + ',\'lib\',this.value)">' +
            libs.map(function (x) { return '<option' + (l.lib === x ? " selected" : "") + ">" + App.esc(x) + "</option>"; }).join("") +
            '</select> <select class="inp" style="width:74px" onchange="Consign.setLine(' + i + ',\'shelf\',this.value)">' +
            shelves.map(function (n) { return '<option value="' + n + '"' + (String(l.shelf) === String(n) ? " selected" : "") + ">رف " + n + "</option>"; }).join("") + "</select>"
          : '<input class="inp" style="width:140px" placeholder="مكانه في المحل" value="' + App.esc(l.loc || "") + '" onchange="Consign.setLine(' + i + ',\'loc\',this.value)">') +
        "</td>" +
        '<td class="act"><button class="btn sm ghost" onclick="Consign.delLine(' + i + ')">✕</button></td></tr>';
    });
    h += "</tbody></table>";
    host.innerHTML = h;
  }

  function setLine(i, k, v) {
    if (!draft || !draft.lines[i]) return;
    if (k === "qty" || k === "ownerPrice" || k === "price") v = App.num(v);
    draft.lines[i][k] = v;
    paintLines();
  }

  function delLine(i) { if (!draft) return; draft.lines.splice(i, 1); paintLines(); }

  function save() {
    if (!draft) return false;
    if (!draft.lines.length) { App.toast("أضف كتاباً واحداً على الأقل.", "warn"); return false; }

    var oid = draft.ownerId;
    if (!oid) {
      if (!String(draft.name).trim()) { App.toast("اكتب اسم صاحب البضاعة.", "warn"); return false; }
      oid = App.uid();
      S().consignors.push({ id: oid, name: draft.name.trim(), phone: draft.phone || "", note: "", at: App.nowStamp() });
    }

    var bad = false;
    draft.lines.forEach(function (l) {
      if (!String(l.title).trim()) bad = true;
      if (App.num(l.qty) <= 0) bad = true;
    });
    if (bad) { App.toast("تأكد أن لكل كتاب اسماً وعدداً صحيحاً.", "warn"); return false; }

    draft.lines.forEach(function (l) {
      var cid = App.uid();
      var itemId = App.uid();
      var isBook = (l.kind !== "stat");
      var ownerName = (owner(oid) ? owner(oid).name : draft.name);
      var code = String(l.code || "").trim();
      var common = {
        id: itemId,
        code: code || App.nextCode(isBook ? "book" : "stat"),
        barcode: code,
        cat: "على المباع",
        cost: App.num(l.ownerPrice), price: App.num(l.price), priceW: 0,
        qty: App.num(l.qty), min: 0,
        note: "على المباع — صاحبه: " + ownerName,
        consId: cid,
        created: App.nowStamp(), updated: App.nowStamp()
      };
      if (isBook) {
        S().books.unshift(Object.assign({}, common, {
          title: l.title.trim(), author: l.author || "", lib: l.lib, shelf: l.shelf
        }));
      } else {
        S().stationery.unshift(Object.assign({}, common, {
          name: l.title.trim(), brand: l.author || "", unit: l.unit || "قطعة", loc: l.loc || ""
        }));
      }
      S().consignments.push({
        id: cid, ownerId: oid, itemId: itemId, type: isBook ? "book" : "stat",
        title: l.title.trim(), author: l.author || "", code: common.code,
        qty: App.num(l.qty), sold: 0, returned: 0,
        price: App.num(l.price), ownerPrice: App.num(l.ownerPrice),
        at: draft.date || App.today(), note: draft.note || ""
      });
    });

    App.log("كتب على المباع", "استُلمت " + draft.lines.length + " عنوان");
    App.saveNow();
    draft = null;
    App.rerender();
    App.toast("سُجّلت الكتب ودخلت المخزون — جاهزة للبيع.");
    return true;
  }

  /* ---------- كشف حساب صاحب البضاعة ---------- */

  function open(id) { view.where = "owner"; view.id = id; App.rerender(); }
  function back() { view.where = "list"; App.rerender(); }
  function setQ(v) { view.q = v; App.rerender(); }

  function ownerPage(id) {
    var o = owner(id);
    if (!o) return '<div class="empty"><h4>غير موجود</h4><button class="btn" onclick="Consign.back()">رجوع</button></div>';
    var a = account(id);
    var lines = linesOf(id);

    var h = '<div class="row" style="margin-bottom:16px">' +
      '<button class="btn ghost" onclick="Consign.back()">→ الكل</button>' +
      '<div style="font-family:var(--font-head);font-size:23px;font-weight:700">' + App.esc(o.name) + "</div>" +
      (o.phone ? '<span class="badge info">' + App.esc(o.phone) + "</span>" : "") +
      '<div class="spacer"></div>' +
      '<button class="btn" onclick="Consign.printStatement(\'' + id + '\')">طباعة الكشف</button>' +
      '<button class="btn" onclick="Consign.editOwner(\'' + id + '\')">تعديل البيانات</button>' +
      (a.rest > 0.009 ? '<button class="btn primary lg" onclick="Consign.pay(\'' + id + '\')">تسديد المستحق</button>' : "") +
      "</div>";

    h += '<div class="grid g4" style="margin-bottom:18px">' +
      card("blue", "استلمت منه", String(a.qty), a.titles + " عنوان") +
      card("accent", "بِعت", String(a.sold), "") +
      card("blue", "باقٍ عندك", String(a.left), "لم يُبع بعد") +
      card(a.rest > 0.009 ? "bad" : "accent", "المستحق له", App.money0(a.rest),
        "من أصل " + App.money0(a.due) + " · سُدّد " + App.money0(a.paid)) +
      "</div>";

    h += '<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>الكتب</h3>' +
      '<div class="spacer"></div><span class="muted small">' +
      (App.canProfit() ? "ربحك من هذا الحساب: " + App.money(a.myProfit) : "") + "</span></div>" +
      App.table([
        {
          h: "الكتاب", c: function (l) {
            return '<div class="name">' + App.esc(l.title) + "</div>" +
              '<div class="sub">' + App.esc(l.author || "") + " · استُلم " + App.esc(l.at) + "</div>";
          }
        },
        {
          h: "النوع", c: function (l) {
            return (l.type === "stat") ? '<span class="badge">قرطاسية</span>' : '<span class="badge info">كتاب</span>';
          }
        },
        {
          h: "الموقع", c: function (l) {
            var it = App.findItem(l.type || "book", l.itemId);
            if (!it) return '<span class="muted">—</span>';
            return (l.type === "stat") ? App.esc(it.loc || "—") : App.locChip(it);
          }
        },
        { h: "استلمت", cls: "num", c: function (l) { return App.num(l.qty); } },
        { h: "بِعت", cls: "num", c: function (l) { return "<b>" + App.num(l.sold) + "</b>"; } },
        { h: "أُعيد له", cls: "num", c: function (l) { return App.num(l.returned) || "—"; } },
        {
          h: "باقٍ", cls: "num", c: function (l) {
            return Math.max(App.num(l.qty) - App.num(l.sold) - App.num(l.returned), 0);
          }
        },
        { h: "سعر صاحبه", cls: "num", c: function (l) { return App.money0(l.ownerPrice); } },
        { h: "سعر البيع", cls: "num", c: function (l) { return App.money0(l.price); } },
        { h: "مستحق عنه", cls: "num", c: function (l) { return "<b>" + App.money0(App.num(l.sold) * App.num(l.ownerPrice)) + "</b>"; } },
        {
          h: "", cls: "act", c: function (l) {
            return '<button class="btn sm ghost" onclick="Consign.giveBack(\'' + l.id + '\')">إرجاع لصاحبه</button>';
          }
        }
      ], lines, { emptyIcon: "books", emptyTitle: "لا كتب", emptyText: "" }) + "</div>";

    var pays = S().consPayments.filter(function (p) { return p.ownerId === id; });
    h += '<div class="card"><div class="card-head"><h3>سجل التسديدات</h3></div>' +
      App.table([
        { h: "التاريخ", c: function (p) { return App.esc(p.date); } },
        { h: "المبلغ", cls: "num", c: function (p) { return "<b>" + App.money0(p.amount) + "</b>"; } },
        { h: "ملاحظة", c: function (p) { return App.esc(p.note || "—"); } }
      ], pays, { emptyIcon: "books", emptyTitle: "لم تسدّد له شيئاً بعد", emptyText: "" }) + "</div>";

    return h;
  }

  function editOwner(id) {
    var o = owner(id);
    if (!o) return;
    App.form({
      title: "تعديل بيانات صاحب البضاعة",
      values: o,
      fields: [
        { k: "name", label: "الاسم", required: true, full: true },
        { k: "phone", label: "رقم الهاتف" },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        Object.keys(v).forEach(function (k) { o[k] = v[k]; });
        App.save(); App.rerender();
        App.toast("حُفظت البيانات.");
      }
    });
  }

  function pay(id) {
    var o = owner(id);
    if (!o) return;
    var a = account(id);
    App.form({
      title: "تسديد لـ " + o.name,
      size: "narrow",
      values: { amount: a.rest, date: App.today() },
      fields: [
        { k: "amount", label: "المبلغ المسدَّد", type: "money", min: 0, required: true, full: true, hint: "المستحق حالياً: " + App.money(a.rest) },
        { k: "date", label: "التاريخ", type: "date", full: true },
        { k: "note", label: "ملاحظة", full: true }
      ],
      saveLabel: "تسجيل التسديد",
      onSave: function (v) {
        var amt = App.num(v.amount);
        if (amt <= 0) { App.toast("أدخل مبلغاً صحيحاً.", "warn"); return false; }
        var rest = account(id).rest;
        if (amt > rest + 0.009) {
          App.toast("المستحق له " + App.money(rest) + " فقط — لا تسدّد أكثر منه.", "warn");
          return false;
        }
        S().consPayments.unshift({
          id: App.uid(), ownerId: id, amount: amt,
          date: v.date || App.today(), at: App.nowStamp(), note: v.note || ""
        });
        App.log("تسديد على المباع", o.name + " " + App.money0(amt));
        App.saveNow(); App.rerender();
        App.toast("سُجّل التسديد. المتبقي: " + App.money(account(id).rest));
      }
    });
  }

  function giveBack(lineId) {
    var l = null;
    S().consignments.forEach(function (x) { if (x.id === lineId) l = x; });
    if (!l) return;
    var left = Math.max(App.num(l.qty) - App.num(l.sold) - App.num(l.returned), 0);
    if (left <= 0) { App.toast("لا توجد نسخ باقية لإرجاعها.", "warn"); return; }

    App.form({
      title: "إرجاع لصاحبه — " + l.title,
      size: "narrow",
      values: { n: left },
      fields: [{ k: "n", label: "عدد النسخ المُعادة", type: "number", min: 1, required: true, full: true, hint: "الباقي عندك: " + left }],
      saveLabel: "تأكيد الإرجاع",
      onSave: function (v) {
        var n = Math.min(App.num(v.n), left);
        if (n <= 0) return false;
        l.returned = App.num(l.returned) + n;
        var it = App.findItem(l.type || "book", l.itemId);
        if (it) { it.qty = Math.max(App.num(it.qty) - n, 0); it.updated = App.nowStamp(); }
        App.log("إرجاع على المباع", l.title + " ×" + n);
        App.saveNow(); App.rerender();
        App.toast("سُجّل الإرجاع وخُصم من المخزون.");
      }
    });
  }

  /* ---------- الطباعة والتصدير ---------- */

  function printStatement(id) {
    var o = owner(id);
    var a = account(id);
    var lines = linesOf(id);
    var m = S().meta;

    var h = '<div class="receipt a4"><h2>' + App.esc(m.shopName || "المحل") + "</h2>" +
      '<div class="c">كشف حساب كتب على المباع</div>' +
      '<div class="c">' + App.esc(o.name) + (o.phone ? " · " + App.esc(o.phone) : "") + "</div>" +
      '<div class="c">حتى ' + App.dateAr(App.today()) + "</div><hr>" +
      "<table><thead><tr><th>الكتاب</th><th>استُلم</th><th>بِيع</th><th>أُعيد</th><th>باقٍ</th><th>السعر</th><th>المستحق</th></tr></thead><tbody>";
    lines.forEach(function (l) {
      h += "<tr><td>" + App.esc(l.title) + '</td><td class="num">' + App.num(l.qty) +
        '</td><td class="num">' + App.num(l.sold) + '</td><td class="num">' + (App.num(l.returned) || "-") +
        '</td><td class="num">' + Math.max(App.num(l.qty) - App.num(l.sold) - App.num(l.returned), 0) +
        '</td><td class="num">' + App.money0(l.ownerPrice) +
        '</td><td class="num">' + App.money0(App.num(l.sold) * App.num(l.ownerPrice)) + "</td></tr>";
    });
    h += "</tbody></table><hr>" +
      '<div class="tot"><span>إجمالي المستحق</span><span class="num">' + App.money0(a.due) + "</span></div>" +
      '<div class="tot"><span>المسدَّد</span><span class="num">' + App.money0(a.paid) + "</span></div>" +
      '<div class="tot g"><span>المتبقي</span><span class="num">' + App.money0(a.rest) + " " + App.esc(m.currency) + "</span></div>" +
      '<br><div style="display:flex;justify-content:space-between"><span>توقيع صاحب البضاعة: ..............</span>' +
      "<span>توقيع المحل: ..............</span></div></div>";
    App.printHtml(h);
  }

  function exportAll() {
    if (!S().consignments.length) { App.toast("لا توجد كتب على المباع.", "warn"); return; }
    App.xls("كتب-على-المباع-" + App.today(), "كتب على المباع", [
      { h: "صاحب البضاعة", c: function (l) { var o = owner(l.ownerId); return o ? o.name : ""; } },
      { h: "الهاتف", c: function (l) { var o = owner(l.ownerId); return o ? (o.phone || "") : ""; } },
      { h: "النوع", c: function (l) { return l.type === "stat" ? "قرطاسية" : "كتاب"; } },
      { h: "الصنف", c: function (l) { return l.title; } },
      { h: "المؤلف", c: function (l) { return l.author || ""; } },
      { h: "تاريخ الاستلام", c: function (l) { return l.at; } },
      { h: "استُلم", t: "i", sum: true, c: function (l) { return App.num(l.qty); } },
      { h: "بِيع", t: "i", sum: true, c: function (l) { return App.num(l.sold); } },
      { h: "أُعيد", t: "i", sum: true, c: function (l) { return App.num(l.returned); } },
      {
        h: "باقٍ عندك", t: "i", sum: true, c: function (l) {
          return Math.max(App.num(l.qty) - App.num(l.sold) - App.num(l.returned), 0);
        }
      },
      { h: "سعر صاحبه", t: "n", c: function (l) { return App.num(l.ownerPrice); } },
      { h: "سعر البيع", t: "n", c: function (l) { return App.num(l.price); } },
      { h: "المستحق عنه", t: "n", sum: true, c: function (l) { return App.num(l.sold) * App.num(l.ownerPrice); } },
      { h: "ربحك", t: "n", sum: true, c: function (l) { return App.num(l.sold) * (App.num(l.price) - App.num(l.ownerPrice)); } }
    ], S().consignments, S().meta.shopName || "");
    App.toast("نُزّل الجدول.");
  }

  return {
    page: page, activeCount: activeCount, account: account, owner: owner,
    byItem: byItem, recordSale: recordSale, recordReturn: recordReturn,
    addBooks: addBooks, d: d, pickOwner: pickOwner, addLine: addLine,
    setLine: setLine, delLine: delLine,
    open: open, back: back, setQ: setQ, editOwner: editOwner,
    pay: pay, giveBack: giveBack, printStatement: printStatement, exportAll: exportAll
  };
})();
