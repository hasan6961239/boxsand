/* ============================================================
   واجهة 4.0 — الموردون ودور النشر
   ------------------------------------------------------------
   كما في 3.x:
   - دور النشر ونسبها: النسبة خصم لزبون الجملة يُحسب وحده عند تسجيل الكتاب
     (قطاعي 100 ودار نشره خصمها 10% ← جملة 90).
   - الموردون: عدد الإدخالات منهم وإجمالي المشتريات (لمن يرى سعر الشراء).
   النسبة في المحرك بالجزء من عشرة آلاف (rateBp): 10% = 1000.
   ============================================================ */
var V4Suppliers = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;
  var pubs = null, sups = null;

  function page() {
    return '<div class="card" style="margin-bottom:18px;border-inline-start:3px solid var(--blue)" id="spPubCard">' +
      '<div class="card-head"><h3>دور النشر ونسبها</h3><div class="spacer"></div>' +
      '<button class="btn primary" onclick="V4Suppliers.editPub(0)">+ دار نشر جديدة</button></div>' +
      '<div class="card-body" style="padding-bottom:6px"><p class="muted small" style="margin:0 0 12px;line-height:1.8">' +
      "النسبة خصم يُعطى لزبون الجملة، ويُحسب تلقائياً عند تسجيل الكتاب. مثال: كتاب قطاعي 100 ودار نشره خصمها 10% ← سعر بيعه بالجملة 90.</p></div>" +
      '<div id="spPubs"><div class="card-body muted">…</div></div></div>' +
      '<div class="toolbar"><div class="spacer"></div><button class="btn primary" onclick="V4Suppliers.editSup(0)">+ مورد جديد</button></div>' +
      '<div class="card"><div id="spSups"><div class="card-body muted">…</div></div></div>';
  }

  function after() { load(); }

  function load() {
    return Promise.all([
      V4.call("publishers.list").catch(function () { return null; }),
      V4.call("suppliers.page")
    ]).then(function (r) {
      pubs = r[0]; sups = r[1];
      paintPubs();
      paintSups();
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  /* ---------- دور النشر ---------- */

  function pct(bp) { return Math.round(bp) / 100; }

  /* سعر الجملة لكتاب قطاعي 100 */
  function w100(bp) { return bp > 0 && bp < 10000 ? 100 * (10000 - bp) / 10000 : 0; }

  /* كما في 3.x: 0.1 تعني 10%، ومن يكتب 10 يقصد 10%. 100 فما فوق تُرفض. يُرجع null عند الرفض */
  function normRate(raw) {
    var r = App.num(raw);
    if (r < 0) r = 0;
    if (r >= 100) { App.toast("نسبة الخصم يجب أن تكون أقل من 100% — اكتب مثلاً 0.25 أو 25.", "warn"); return null; }
    var bp = r >= 1 ? Math.round(r * 100) : Math.round(r * 10000);
    if (r >= 1) App.toast("فهمنا «" + r + "» على أنها خصم " + pct(bp) + "%.", "ok");
    return bp;
  }

  function paintPubs() {
    var card = document.getElementById("spPubCard");
    if (!card) return;
    /* دور النشر لمن يعدّل الأصناف (منه يُحسب سعر الجملة) */
    card.hidden = pubs === null;
    if (pubs === null) return;
    document.getElementById("spPubs").innerHTML = App.table([
      { h: "دار النشر", c: function (p) {
        return '<b class="name">' + esc(p.name) + "</b>" + (p.phone ? '<div class="muted small num">' + esc(p.phone) + "</div>" : ""); } },
      { h: "خصم الجملة", cls: "num", c: function (p) { return "<b>" + pct(p.rateBp) + "%</b>"; } },
      { h: "قطاعي 100 ← جملة", cls: "num", c: function (p) { var w = w100(p.rateBp); return w ? "<b>" + w.toFixed(2) + "</b>" : '<span class="muted">—</span>'; } },
      { h: "عدد الكتب", cls: "num", c: function (p) { return String(p.books); } },
      { h: "ملاحظة", c: function (p) { return esc(p.note || "—"); } },
      { h: "", c: function (p) {
        return '<button class="btn sm" onclick="V4Suppliers.editPub(' + p.id + ')">تعديل</button> ' +
          '<button class="btn sm ghost" onclick="V4Suppliers.delPub(' + p.id + ')">حذف</button>'; } }
    ], pubs, {
      emptyIcon: "books", emptyTitle: "لا دور نشر مسجّلة",
      emptyText: "سجّل دار النشر ونسبتها ليُحسب سعر الجملة وحده عند إدخال كتبها.",
      emptyAction: '<button class="btn primary" onclick="V4Suppliers.editPub(0)">+ إضافة دار نشر</button>'
    });
  }

  function pubById(id) {
    if (pubs) for (var i = 0; i < pubs.length; i++) if (pubs[i].id === id) return pubs[i];
    return null;
  }

  function editPub(id) {
    var p = id ? pubById(id) : null;
    V4.form({
      title: p ? "تعديل دار نشر" : "دار نشر جديدة",
      /* أقل من 1% يُكتب كسراً (0.005)، فلا يُقرأ «0.5» خصم 50% عند الحفظ */
      values: p ? { name: p.name, rate: p.rateBp >= 100 ? pct(p.rateBp) : p.rateBp / 10000, phone: p.phone, note: p.note } : { rate: 20 },
      fields: [
        { k: "name", label: "اسم دار النشر", required: true, full: true },
        { k: "rate", label: "خصم الجملة", type: "number", min: 0, hint: "10 أو 0.1 تعني خصم 10%" },
        { k: "phone", label: "رقم الهاتف" },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        var bp = normRate(v.rate);
        if (bp === null) return false;
        var body = { id: p ? p.id : 0, name: v.name, rateBp: bp, phone: App.digits(v.phone || "").trim(), note: v.note || "" };
        return V4.run("publisher.save", body).then(function (r) {
          if (V4.queued(r, "دار النشر «" + v.name + "»")) return;
          var w = w100(bp);
          App.toast("حُفظت." + (w ? " قطاعي 100 ← جملة " + w.toFixed(2) : ""), "ok");
          load();
        });
      }
    });
  }

  function delPub(id) {
    var p = pubById(id);
    if (!p) return;
    App.confirm("سيُحذف «" + p.name + "» من دور النشر. الكتب المسجّلة باسمها تبقى كما هي.", function () {
      V4.run("publisher.delete", { id: id }).then(function (r) {
        if (V4.queued(r, "حذف «" + p.name + "»")) return;
        App.toast("حُذفت: " + p.name, "ok");
        load();
      });
    }, { danger: true, yes: "حذف" });
  }

  /* ---------- الموردون ---------- */

  function paintSups() {
    var host = document.getElementById("spSups");
    if (!host || !sups) return;
    var cost = sups.length > 0 && sups[0].total !== undefined;
    host.innerHTML = App.table([
      { h: "المورد", c: function (s) {
        return '<b class="name">' + esc(s.name) + "</b>" + (s.phone ? '<div class="muted small num">' + esc(s.phone) + "</div>" : ""); } },
      { h: "المدينة / العنوان", c: function (s) { return esc(s.city || "—"); } },
      { h: "عدد الإدخالات", cls: "num", c: function (s) { return String(s.purchases); } }
    ].concat(cost ? [{ h: "إجمالي المشتريات", cls: "num", c: function (s) { return "<b>" + money(s.total) + "</b>"; } }] : []).concat([
      { h: "آخر إدخال", c: function (s) { return s.last ? '<span class="num">' + esc(s.last) + "</span>" : '<span class="muted">—</span>'; } },
      { h: "ملاحظة", c: function (s) { return esc(s.note || "—"); } },
      { h: "", c: function (s) {
        return '<button class="btn sm" onclick="V4Suppliers.editSup(' + s.id + ')">تعديل</button> ' +
          '<button class="btn sm ghost" onclick="V4Suppliers.delSup(' + s.id + ')">حذف</button>'; } }
    ]), sups, {
      emptyIcon: "truck", emptyTitle: "لا يوجد موردون",
      emptyText: "سجّل من تشتري منهم البضاعة لتعرف تكاليفك مع كل واحد.",
      emptyAction: '<button class="btn primary" onclick="V4Suppliers.editSup(0)">+ إضافة مورد</button>'
    });
  }

  function supById(id) {
    if (sups) for (var i = 0; i < sups.length; i++) if (sups[i].id === id) return sups[i];
    return null;
  }

  function editSup(id) {
    var s = id ? supById(id) : null;
    V4.form({
      title: s ? "تعديل مورد" : "مورد جديد",
      values: s ? { name: s.name, phone: s.phone, city: s.city, note: s.note } : {},
      fields: [
        { k: "name", label: "اسم المورد", required: true, full: true },
        { k: "phone", label: "رقم الهاتف" },
        { k: "city", label: "المدينة / العنوان" },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        var body = { name: v.name, phone: App.digits(v.phone || "").trim(), city: v.city || "", note: v.note || "" };
        if (s) body.id = s.id;
        return V4.run(s ? "supplier.edit" : "supplier.add", body).then(function (r) {
          if (V4.queued(r, "المورد «" + v.name + "»")) return;
          App.toast("حُفظت بيانات المورد.", "ok");
          load();
        });
      }
    });
  }

  function delSup(id) {
    var s = supById(id);
    if (!s) return;
    App.confirm("سيُحذف المورد «" + s.name + "». سجل المشتريات يبقى محفوظاً.", function () {
      V4.run("supplier.delete", { id: id }).then(function (r) {
        if (V4.queued(r, "حذف «" + s.name + "»")) return;
        App.toast("حُذف: " + s.name, "ok");
        load();
      });
    }, { danger: true, yes: "حذف" });
  }

  V4.page({ o: 64, g: "الحسابات", k: "suppliers", t: "الموردون ودور النشر", ic: "truck", perm: "suppliers", render: page, after: after });

  return { editPub: editPub, delPub: delPub, editSup: editSup, delSup: delSup, normRate: normRate, w100: w100 };
})();
