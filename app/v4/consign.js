/* ============================================================
   واجهة 4.0 — كتب على المباع
   ------------------------------------------------------------
   كما في 3.x: زبون أو مورّد يترك كتبه عندك لتبيعها، ويأتي لاحقاً للحساب.
   - أصحاب البضاعة بما استلمت وبِعت وبقي، والمستحق لكل واحد (وربحك لمن يراه).
   - استلام كتب جديدة: كل سطر يصير صنفاً في المحل (consign.in، أمر واحد).
   - كشف حساب صاحبها: الكتب، الإرجاع لصاحبه، التسديد (من الدرج أو من خارجه)،
     سجل التسديدات، الطباعة، وتعديل بياناته.
   ============================================================ */
var V4Consign = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;
  var view = { id: 0, q: "" }, owners = null, cur = null, spots = null, draft = null;

  function canProfit() { return V4.can("view_cost"); }

  function page() {
    return '<div id="cnHost"><div class="muted">…</div></div>';
  }

  function after() {
    if (view.id) openOwner(view.id);
    else load();
  }

  function stat(kind, lbl, val, foot) {
    return '<div class="card stat ' + kind + '"><div class="lbl">' + esc(lbl) + '</div><div class="val">' + val + "</div>" +
      (foot ? '<div class="foot">' + esc(foot) + "</div>" : "") + "</div>";
  }

  function done(r, what, msg) {
    if (V4.queued(r, what)) return true;
    if (msg) App.toast(msg, "ok");
    return false;
  }

  /* ---------- القائمة ---------- */

  function load() {
    return V4.call("consignors.list").then(function (l) {
      owners = l;
      if (!view.id) paintList();
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function paintList() {
    var host = document.getElementById("cnHost");
    if (!host || !owners) return;
    var left = 0, sold = 0, due = 0;
    owners.forEach(function (o) { left += o.left; sold += o.sold; if (o.due > 0) due += o.due; });
    host.innerHTML = '<div class="grid g4" style="margin-bottom:18px">' +
      stat("accent", "أصحاب البضاعة", String(owners.length), "") +
      stat("blue", "نسخ عندك الآن", String(left), "لم تُبع بعد") +
      stat("accent", "نسخ بِعتها", String(sold), "") +
      stat(due > 0 ? "bad" : "accent", "مستحق لأصحابها", money(due), "بعد خصم ما سدّدته") + "</div>" +
      '<div class="toolbar">' +
      '<input class="inp search" id="cnQ" autocomplete="off" placeholder="ابحث باسم صاحب البضاعة أو رقم هاتفه…" value="' + esc(view.q) +
      '" oninput="V4Consign.search(this.value)">' +
      '<div class="spacer"></div>' +
      '<button class="btn" onclick="V4Consign.exportXls()">تصدير Excel</button>' +
      '<button class="btn primary lg" onclick="V4Consign.receive()">+ استلام كتب جديدة</button></div>' +
      '<div class="card"><div id="cnList"></div></div>';
    paintRows();
    var q = document.getElementById("cnQ");
    if (q) q.focus();
  }

  function paintRows() {
    var host = document.getElementById("cnList");
    if (!host) return;
    var rows = owners.slice().sort(function (a, b) { return b.due - a.due; });
    rows = App.rank(rows, view.q, function (o) { return [o.name, o.phone]; });
    var profit = canProfit();
    host.innerHTML = App.table([
      { h: "صاحب البضاعة", c: function (o) {
        return '<b class="name">' + esc(o.name) + '</b><div class="muted small num">' + esc(o.phone || "بدون رقم") + "</div>"; } },
      { h: "عناوين", cls: "num", c: function (o) { return String(o.titles); } },
      { h: "استلمت", cls: "num", c: function (o) { return String(o.qty); } },
      { h: "بِعت", cls: "num", c: function (o) { return "<b>" + o.sold + "</b>"; } },
      { h: "باقٍ عندك", cls: "num", c: function (o) { return String(o.left); } },
      { h: "المستحق له", cls: "num", c: function (o) {
        return o.due > 0 ? '<b style="color:var(--stamp)">' + money(o.due) + "</b>" : '<span class="badge ok">خالص</span>'; } }
    ].concat(profit ? [{ h: "ربحك منه", cls: "num", c: function (o) { return money(o.myProfit); } }] : []).concat([
      { h: "", c: function (o) {
        return '<button class="btn sm primary" onclick="V4Consign.open(' + o.id + ')">كشف الحساب</button> ' +
          (o.due > 0 ? '<button class="btn sm" onclick="V4Consign.pay(' + o.id + ')">تسديد</button>' : ""); } }
    ]), rows, {
      rowClass: function (o) { return o.due > 0 ? "low" : ""; },
      emptyIcon: "consign",
      emptyTitle: owners.length ? "لا نتيجة مطابقة" : "لا يوجد كتب على المباع",
      emptyText: "عندما يترك عندك أحدهم كتباً لتبيعها، سجّلها هنا لتعرف كم بِعت وكم تستحق له.",
      emptyAction: owners.length ? "" : '<button class="btn primary" onclick="V4Consign.receive()">+ استلام كتب</button>'
    });
  }

  function search(v) { view.q = v; paintRows(); }

  function find(id) {
    if (cur && cur.id === id) return cur;
    if (owners) for (var i = 0; i < owners.length; i++) if (owners[i].id === id) return owners[i];
    return null;
  }

  /* ---------- كشف حساب صاحب البضاعة ---------- */

  function open(id) { view.id = id; openOwner(id); }
  function back() { view.id = 0; cur = null; V4.refresh(); }

  function openOwner(id) {
    return V4.call("consignor.get", { id: id }).then(function (o) {
      cur = o;
      var a = { qty: 0, sold: 0, left: 0, due: 0, paid: 0, myProfit: 0 };
      o.lines.forEach(function (l) {
        a.qty += l.qty; a.sold += l.sold; a.left += l.left;
        a.due += l.sold * l.ownerPrice;
        a.myProfit += l.sold * (l.price - l.ownerPrice);
      });
      o.payments.forEach(function (p) { a.paid += p.amount; });
      a.rest = a.due - a.paid;
      o.acct = a;
      if (view.id === id) paintOwner(o);
    }).catch(function (e) {
      App.toast(e.message, "bad");
      view.id = 0;
      load();
    });
  }

  function paintOwner(o) {
    var host = document.getElementById("cnHost");
    if (!host) return;
    var a = o.acct;
    host.innerHTML = '<div class="toolbar">' +
      '<button class="btn ghost" onclick="V4Consign.back()">→ الكل</button>' +
      '<b style="font-size:21px">' + esc(o.name) + "</b>" +
      (o.phone ? ' <span class="badge info num">' + esc(o.phone) + "</span>" : "") +
      '<div class="spacer"></div>' +
      '<button class="btn" onclick="V4Consign.print()">طباعة الكشف</button>' +
      '<button class="btn" onclick="V4Consign.editOwner()">تعديل البيانات</button>' +
      '<button class="btn" onclick="V4Consign.receive(' + o.id + ')">+ استلام كتب منه</button>' +
      (a.rest > 0 ? '<button class="btn primary lg" onclick="V4Consign.pay(' + o.id + ')">تسديد المستحق</button>' : "") + "</div>" +
      (o.note ? '<p class="muted small" style="margin:0 0 12px">' + esc(o.note) + "</p>" : "") +
      '<div class="grid g4" style="margin-bottom:18px">' +
      stat("blue", "استلمت منه", String(a.qty), o.lines.length + " عنوان") +
      stat("accent", "بِعت", String(a.sold), "") +
      stat("blue", "باقٍ عندك", String(a.left), "لم يُبع بعد") +
      stat(a.rest > 0 ? "bad" : "accent", "المستحق له", money(a.rest), "من أصل " + money(a.due) + " · سُدّد " + money(a.paid)) + "</div>" +
      '<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>الكتب</h3><div class="spacer"></div>' +
      (canProfit() ? '<span class="muted small">ربحك من هذا الحساب: ' + money(a.myProfit) + "</span>" : "") + "</div>" +
      App.table([
        { h: "الكتاب", c: function (l) {
          return '<b class="name">' + esc(l.title) + '</b><div class="muted small">' + (l.author ? esc(l.author) + " · " : "") +
            "استُلم " + '<span class="num">' + esc(l.date) + "</span>" + (l.code ? ' · <span class="num">' + esc(l.code) + "</span>" : "") + "</div>"; } },
        { h: "النوع", c: function (l) { return l.kind === "stat" ? '<span class="badge">قرطاسية</span>' : '<span class="badge info">كتاب</span>'; } },
        { h: "استلمت", cls: "num", c: function (l) { return String(l.qty); } },
        { h: "بِعت", cls: "num", c: function (l) { return "<b>" + l.sold + "</b>"; } },
        { h: "أُعيد له", cls: "num", c: function (l) { return l.returned ? String(l.returned) : "—"; } },
        { h: "باقٍ", cls: "num", c: function (l) { return String(l.left); } },
        { h: "سعر صاحبه", cls: "num", c: function (l) { return money(l.ownerPrice); } },
        { h: "سعر البيع", cls: "num", c: function (l) { return money(l.price); } },
        { h: "مستحق عنه", cls: "num", c: function (l) { return "<b>" + money(l.sold * l.ownerPrice) + "</b>"; } },
        { h: "", c: function (l) {
          return l.left > 0 ? '<button class="btn sm ghost" onclick="V4Consign.giveBack(' + l.id + ')">إرجاع لصاحبه</button>' : ""; } }
      ], o.lines, { emptyIcon: "consign", emptyTitle: "لا كتب", emptyText: "" }) + "</div>" +
      '<div class="card"><div class="card-head"><h3>سجل التسديدات</h3></div>' +
      App.table([
        { h: "التاريخ", c: function (p) { return '<span class="num">' + esc(p.date) + "</span>"; } },
        { h: "المبلغ", cls: "num", c: function (p) { return "<b>" + money(p.amount) + "</b>"; } },
        { h: "من", c: function (p) { return p.fromDrawer ? "درج المحل" : '<span class="muted">خارج الدرج</span>'; } },
        { h: "ملاحظة", c: function (p) { return esc(p.note || "—"); } }
      ], o.payments, { emptyIcon: "consign", emptyTitle: "لم تسدّد له شيئاً بعد", emptyText: "" }) + "</div>";
  }

  /* بعد أي تغيير: الصفحة المفتوحة (القائمة أو الكشف) من المحرك من جديد */
  function reload() {
    if (view.id) return openOwner(view.id);
    return load();
  }

  function editOwner() {
    var o = cur;
    if (!o) return;
    V4.form({
      title: "تعديل بيانات صاحب البضاعة",
      values: { name: o.name, phone: o.phone, note: o.note },
      fields: [
        { k: "name", label: "الاسم", required: true, full: true },
        { k: "phone", label: "رقم الهاتف" },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        return V4.run("consignor.edit", { id: o.id, name: v.name, phone: App.digits(v.phone || "").trim(), note: v.note || "" }).then(function (r) {
          if (!done(r, "بيانات «" + v.name + "»", "حُفظت البيانات.")) reload();
        });
      }
    });
  }

  /* ---------- التسديد ---------- */

  function pay(id) {
    var o = find(id);
    if (!o) return;
    var rest = o.acct ? o.acct.rest : o.due;
    V4.form({
      title: "تسديد لـ " + o.name,
      size: "narrow",
      values: { amount: money(rest), date: V4.today(), drawer: "yes" },
      fields: [
        { k: "amount", label: "المبلغ المسدَّد", type: "money", min: 0, required: true, full: true, hint: "المستحق حالياً: " + money(rest) },
        { k: "drawer", label: "من أين دُفع؟", type: "select", full: true,
          options: [{ v: "yes", t: "من درج المحل (يُخصم من النقد المفروض)" }, { v: "no", t: "من خارج الدرج" }],
          hint: "ما يُدفع من الدرج يُطرح من «النقد المفروض» عند إقفال اليوم، فلا يظهر عجز غير حقيقي." },
        { k: "date", label: "التاريخ", type: "date", full: true },
        { k: "note", label: "ملاحظة", full: true }
      ],
      saveLabel: "تسجيل التسديد",
      onSave: function (v) {
        var amt = V4.dirhams(v.amount);
        if (amt <= 0) { App.toast("أدخل مبلغاً صحيحاً.", "warn"); return false; }
        if (amt > rest) { App.toast("المستحق له " + money(rest) + " فقط — لا تسدّد أكثر منه.", "warn"); return false; }
        return V4.run("consign.pay", { consignorId: id, amount: amt, date: v.date || V4.today(), note: v.note || "", fromDrawer: v.drawer !== "no" })
          .then(function (r) {
            if (!done(r, "تسديد " + o.name, "سُجّل التسديد. المتبقي: " + money(rest - amt))) reload();
          });
      }
    });
  }

  /* ---------- الإرجاع لصاحبه ---------- */

  function giveBack(lineId) {
    if (!cur) return;
    var l = null;
    cur.lines.forEach(function (x) { if (x.id === lineId) l = x; });
    if (!l) return;
    if (l.left <= 0) { App.toast("لا توجد نسخ باقية لإرجاعها.", "warn"); return; }
    V4.form({
      title: "إرجاع لصاحبه — " + l.title,
      size: "narrow",
      values: { n: l.left },
      fields: [{ k: "n", label: "عدد النسخ المُعادة", type: "number", min: 1, required: true, full: true, hint: "الباقي عندك: " + l.left }],
      saveLabel: "تأكيد الإرجاع",
      onSave: function (v) {
        var n = Math.min(Math.round(App.num(v.n)), l.left);
        if (n <= 0) return false;
        return V4.run("consign.back", { id: l.id, qty: n }).then(function (r) {
          if (!done(r, "إرجاع «" + l.title + "»", "سُجّل الإرجاع وخُصم من المخزون.")) reload();
        });
      }
    });
  }

  /* ---------- استلام كتب ---------- */

  /* أماكن المحل لكل سطر (المخازن لا: الكتاب على المباع يُعرض للبيع) */
  function loadSpots() {
    if (spots) return Promise.resolve(spots);
    var get = V4.can("view_stock") ? V4.call("places.list").catch(function () { return []; }) : Promise.resolve([]);
    return get.then(function (l) {
      var byId = {};
      l.forEach(function (p) { byId[p.id] = p; });
      spots = [{ v: 1, t: "المحل (بلا مكان محدد)" }];
      l.forEach(function (p) {
        if (p.kind === "store" || p.kind === "shop") return;
        var names = [], x = p, guard = 0;
        while (x && x.kind !== "shop" && guard++ < 10) { names.unshift(x.kind === "floor" ? x.code || x.name : x.name); x = byId[x.parentId]; }
        spots.push({ v: p.id, t: names.join(" · ") || p.name });
      });
      return spots;
    });
  }

  function receive(ownerId) {
    Promise.all([owners ? Promise.resolve(owners) : V4.call("consignors.list"), loadSpots()]).then(function (r) {
      owners = r[0];
      draft = { ownerId: ownerId || 0, name: "", phone: "", date: V4.today(), note: "", lines: [] };
      addLine(true);
      var body = document.createElement("div");
      body.innerHTML = '<div class="form-grid" style="margin-bottom:14px">' +
        '<div class="field full"><label for="cnOwner">صاحب البضاعة</label>' +
        '<select class="inp" id="cnOwner" onchange="V4Consign.pickOwner(this.value)"><option value="0">— صاحب جديد —</option>' +
        owners.map(function (o) {
          return '<option value="' + o.id + '"' + (o.id === draft.ownerId ? " selected" : "") + ">" + esc(o.name + (o.phone ? " · " + o.phone : "")) + "</option>";
        }).join("") + "</select></div>" +
        '<div class="field" id="cnNewName"><label for="cnName">الاسم <span style="color:var(--stamp)">*</span></label>' +
        '<input class="inp" id="cnName" oninput="V4Consign.d(\'name\',this.value)"></div>' +
        '<div class="field" id="cnNewPhone"><label for="cnPhone">رقم الهاتف</label>' +
        '<input class="inp" id="cnPhone" oninput="V4Consign.d(\'phone\',this.value)"></div>' +
        '<div class="field"><label for="cnDate">تاريخ الاستلام</label><input type="date" class="inp" id="cnDate" value="' + esc(draft.date) +
        '" onchange="V4Consign.d(\'date\',this.value)"></div>' +
        '<div class="field"><label for="cnNote">ملاحظة</label><input class="inp" id="cnNote" oninput="V4Consign.d(\'note\',this.value)"></div></div>' +
        '<div id="cnLines"></div>' +
        '<button class="btn" style="margin-top:10px" onclick="V4Consign.addLine()">+ إضافة كتاب</button>' +
        '<p class="muted small" style="margin:10px 0 0;line-height:1.8">اترك الكود فارغاً ليأخذ الكتاب كوداً خاصاً بالمباع. ' +
        "كتاب بنفس باركود كتاب يبيعه المحل يُرفض، حتى لا يُحسب بيع نسخ المحل لصاحب البضاعة.</p>";
      App.modal({
        title: "استلام كتب على المباع",
        size: "xwide",
        body: body,
        cancelLabel: "إلغاء",
        actions: [{ label: "حفظ الاستلام", kind: "primary", click: function (close) { save(close); } }]
      });
      syncOwner();
      paintLines();
      var first = document.getElementById(draft.ownerId ? "cnLine0" : "cnName");
      if (first) setTimeout(function () { first.focus(); }, 60);
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function d(k, v) { if (draft) draft[k] = v; }

  function pickOwner(id) {
    if (!draft) return;
    draft.ownerId = Number(id) || 0;
    syncOwner();
  }

  function syncOwner() {
    var n = document.getElementById("cnNewName"), p = document.getElementById("cnNewPhone");
    if (n) n.hidden = !!draft.ownerId;
    if (p) p.hidden = !!draft.ownerId;
  }

  function addLine(quiet) {
    if (!draft) return;
    var last = draft.lines[draft.lines.length - 1];
    draft.lines.push({ kind: last ? last.kind : "book", title: "", author: "", code: "", qty: 1, ownerPrice: 0, price: 0, placeId: last ? last.placeId : 1 });
    if (quiet === true) return;
    paintLines();
    var t = document.getElementById("cnLine" + (draft.lines.length - 1));
    if (t) t.focus();
  }

  function paintLines() {
    var host = document.getElementById("cnLines");
    if (!host || !draft) return;
    if (!draft.lines.length) {
      host.innerHTML = '<div class="empty" style="padding:22px"><p>لم تُضف كتباً بعد. اضغط «إضافة كتاب».</p></div>';
      return;
    }
    host.innerHTML = '<div class="table-wrap"><table class="tbl"><thead><tr><th>النوع</th><th>الاسم والمؤلف (أو الماركة)</th><th>الكود أو الباركود</th>' +
      "<th>العدد</th><th>سعر صاحبه</th><th>سعر البيع</th><th>ربحك</th><th>المكان</th><th></th></tr></thead><tbody>" +
      draft.lines.map(function (l, i) {
        var set = function (k) { return ' onchange="V4Consign.line(' + i + ",'" + k + "',this.value)\""; };
        return "<tr>" +
          '<td><select class="inp" style="width:96px"' + set("kind") + '><option value="book"' + (l.kind !== "stat" ? " selected" : "") +
          '>كتاب</option><option value="stat"' + (l.kind === "stat" ? " selected" : "") + ">قرطاسية</option></select></td>" +
          '<td><div class="line-stack"><input class="inp" id="cnLine' + i + '" style="min-width:170px" placeholder="الاسم" value="' + esc(l.title) + '"' + set("title") + ">" +
          '<input class="inp" style="min-width:170px" placeholder="المؤلف أو الماركة" value="' + esc(l.author) + '"' + set("author") + "></div></td>" +
          '<td><input class="inp num" style="width:120px" value="' + esc(l.code) + '" placeholder="يُولَّد تلقائياً"' + set("code") + "></td>" +
          '<td><input class="inp num" style="width:70px" inputmode="numeric" value="' + l.qty + '"' + set("qty") + "></td>" +
          '<td><input class="inp num" style="width:96px" inputmode="decimal" value="' + money(l.ownerPrice) + '"' + set("ownerPrice") + "></td>" +
          '<td><input class="inp num" style="width:96px" inputmode="decimal" value="' + money(l.price) + '"' + set("price") + "></td>" +
          '<td class="num" id="cnProf' + i + '">' + profit(l) + "</td>" +
          '<td><select class="inp" style="width:170px"' + set("placeId") + ">" + spots.map(function (s) {
            return '<option value="' + s.v + '"' + (s.v === l.placeId ? " selected" : "") + ">" + esc(s.t) + "</option>";
          }).join("") + "</select></td>" +
          '<td><button class="btn sm ghost" title="حذف السطر" onclick="V4Consign.dropLine(' + i + ')">✕</button></td></tr>';
      }).join("") + "</tbody></table></div>";
  }

  function profit(l) {
    var p = (l.price - l.ownerPrice) * l.qty;
    return '<b style="color:' + (p >= 0 ? "var(--accent)" : "var(--stamp)") + '">' + money(p) + "</b>";
  }

  /* لا يُعاد رسم الجدول مع كل خانة: Tab للخانة التالية يبقى فيها */
  function line(i, k, v) {
    var l = draft && draft.lines[i];
    if (!l) return;
    if (k === "qty") l.qty = Math.max(0, Math.round(App.num(v)));
    else if (k === "ownerPrice" || k === "price") l[k] = Math.max(0, V4.dirhams(v));
    else if (k === "placeId") l.placeId = Number(v) || 1;
    else l[k] = k === "code" ? App.digits(v).trim() : v;
    var c = document.getElementById("cnProf" + i);
    if (c) c.innerHTML = profit(l);
  }

  function dropLine(i) { if (!draft) return; draft.lines.splice(i, 1); paintLines(); }

  function save(close) {
    if (!draft) return;
    var lines = draft.lines.filter(function (l) { return String(l.title).trim() || l.code; });
    if (!lines.length) { App.toast("أضف كتاباً واحداً على الأقل.", "warn"); return; }
    var bad = false;
    lines.forEach(function (l) { if (!String(l.title).trim() || l.qty <= 0) bad = true; });
    if (bad) { App.toast("تأكد أن لكل كتاب اسماً وعدداً صحيحاً.", "warn"); return; }
    if (!draft.ownerId && !String(draft.name).trim()) {
      App.toast("اكتب اسم صاحب البضاعة.", "warn");
      var n = document.getElementById("cnName");
      if (n) n.focus();
      return;
    }
    var body = {
      consignorId: draft.ownerId, name: String(draft.name).trim(), phone: App.digits(draft.phone || "").trim(),
      date: draft.date || V4.today(), note: draft.note || "",
      lines: lines.map(function (l) {
        return { kind: l.kind, title: String(l.title).trim(), author: l.author || "", code: l.code || "", qty: l.qty,
          ownerPrice: l.ownerPrice, price: l.price, placeId: l.placeId || 1 };
      })
    };
    var n2 = lines.length;
    V4.run("consign.in", body).then(function (r) {
      close();
      draft = null;
      if (done(r, "استلام " + n2 + " عنوان على المباع")) return;
      App.toast("سُجّلت الكتب ودخلت المخزون — جاهزة للبيع.", "ok");
      reload();
    }).catch(function () { });
  }

  /* ---------- الطباعة والتصدير ---------- */

  function print() {
    var o = cur;
    if (!o) return;
    var a = o.acct, m = (V4.shop() && V4.shop().meta) || {};
    var h = '<div class="receipt a4"><h2>' + esc(m.shopName || "المحل") + "</h2>" +
      '<div class="c">كشف حساب كتب على المباع</div>' +
      '<div class="c">' + esc(o.name) + (o.phone ? " · " + esc(o.phone) : "") + "</div>" +
      '<div class="c">حتى ' + esc(App.dateAr(V4.today())) + "</div><hr>" +
      "<table><thead><tr><th>الكتاب</th><th>استُلم</th><th>بِيع</th><th>أُعيد</th><th>باقٍ</th><th>السعر</th><th>المستحق</th></tr></thead><tbody>";
    o.lines.forEach(function (l) {
      h += "<tr><td>" + esc(l.title) + '</td><td class="num">' + l.qty + '</td><td class="num">' + l.sold +
        '</td><td class="num">' + (l.returned || "-") + '</td><td class="num">' + l.left +
        '</td><td class="num">' + money(l.ownerPrice) + '</td><td class="num">' + money(l.sold * l.ownerPrice) + "</td></tr>";
    });
    h += "</tbody></table><hr>" +
      '<div class="tot"><span>إجمالي المستحق</span><span class="num">' + money(a.due) + "</span></div>" +
      '<div class="tot"><span>المسدَّد</span><span class="num">' + money(a.paid) + "</span></div>" +
      '<div class="tot g"><span>المتبقي</span><span class="num">' + money(a.rest) + " " + esc(V4.currency()) + "</span></div>" +
      '<br><div style="display:flex;justify-content:space-between"><span>توقيع صاحب البضاعة: ..............</span>' +
      "<span>توقيع المحل: ..............</span></div></div>";
    App.printHtml(h);
  }

  /* سطراً سطراً لكل أصحاب البضاعة، كما في 3.x */
  function exportXls() {
    var list = owners || [];
    if (!list.length) { App.toast("لا توجد كتب على المباع.", "warn"); return; }
    Promise.all(list.map(function (o) { return V4.call("consignor.get", { id: o.id }); })).then(function (all) {
      var rows = [];
      all.forEach(function (o) { o.lines.forEach(function (l) { l.owner = o; rows.push(l); }); });
      if (!rows.length) { App.toast("لا توجد كتب على المباع.", "warn"); return; }
      var cols = [
        { h: "صاحب البضاعة", c: function (l) { return l.owner.name; } },
        { h: "الهاتف", c: function (l) { return l.owner.phone || ""; } },
        { h: "النوع", c: function (l) { return l.kind === "stat" ? "قرطاسية" : "كتاب"; } },
        { h: "الصنف", c: function (l) { return l.title; } },
        { h: "المؤلف", c: function (l) { return l.author || ""; } },
        { h: "تاريخ الاستلام", c: function (l) { return l.date; } },
        { h: "استُلم", t: "i", sum: true, c: function (l) { return l.qty; } },
        { h: "بِيع", t: "i", sum: true, c: function (l) { return l.sold; } },
        { h: "أُعيد", t: "i", sum: true, c: function (l) { return l.returned; } },
        { h: "باقٍ عندك", t: "i", sum: true, c: function (l) { return l.left; } },
        { h: "سعر صاحبه", t: "n", c: function (l) { return l.ownerPrice / 1000; } },
        { h: "سعر البيع", t: "n", c: function (l) { return l.price / 1000; } },
        { h: "المستحق عنه", t: "n", sum: true, c: function (l) { return l.sold * l.ownerPrice / 1000; } }
      ];
      if (canProfit()) cols.push({ h: "ربحك", t: "n", sum: true, c: function (l) { return l.sold * (l.price - l.ownerPrice) / 1000; } });
      App.xls("كتب-على-المباع-" + V4.today(), "كتب على المباع", cols, rows, ((V4.shop() || {}).meta || {}).shopName || "");
      App.toast("نُزّل الجدول.", "ok");
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  V4.page({ o: 62, g: "الحسابات", k: "consign", t: "كتب على المباع", ic: "consign", perm: "consign", render: page, after: after });

  return {
    search: search, open: open, back: back, editOwner: editOwner, pay: pay, giveBack: giveBack,
    receive: receive, d: d, pickOwner: pickOwner, addLine: addLine, line: line, dropLine: dropLine,
    print: print, exportXls: exportXls
  };
})();
