/* ============================================================
   stale.js — البضاعة الراكدة
   ------------------------------------------------------------
   الصنف الراكد ليس "قليل البيع" بل **رأس مال واقف**. لذلك الترتيب
   الافتراضي هنا بالمال المجمّد لا بعدد الأيام: صنف واحد بـ400 دينار
   راكد منذ 100 يوم أهم من عشرين صنفاً بـ2 دينار راكدة منذ سنة.
   ============================================================ */

var Stale = (function () {

  function S() { return App.S; }

  /* ---------- الإعدادات ---------- */

  function cfg() {
    var m = S().meta;
    if (!m.stale || typeof m.stale !== "object") {
      m.stale = { bookDays: 120, statDays: 90, minValue: 0, ignore: [] };
    }
    if (!Array.isArray(m.stale.ignore)) m.stale.ignore = [];
    if (m.stale.bookDays === undefined) m.stale.bookDays = 120;
    if (m.stale.statDays === undefined) m.stale.statDays = 90;
    if (m.stale.minValue === undefined) m.stale.minValue = 0;
    return m.stale;
  }

  function daysFor(type) {
    var c = cfg();
    return App.num(type === "book" ? c.bookDays : c.statDays) || 90;
  }

  /* ---------- الحساب ---------- */

  function dayDiff(iso) {
    if (!iso) return null;
    var d = new Date(String(iso).slice(0, 10) + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    var now = new Date(App.today() + "T00:00:00");
    return Math.round((now - d) / 86400000);
  }

  /* تاريخ آخر بيع: محفوظ على الصنف. للبيانات القديمة التي سُجّلت قبل
     هذه الميزة نستنتجه من الفواتير مرة واحدة ونثبّته. */
  var backfilled = false;
  function backfill() {
    if (backfilled) return;
    backfilled = true;
    var seen = {}, sold = {};
    S().invoices.forEach(function (v) {
      if (v.kind === "return") return;
      (v.items || []).forEach(function (l) {
        var k = l.type + ":" + l.id;
        if (!seen[k] || String(v.date) > seen[k]) seen[k] = String(v.date);
        sold[k] = App.num(sold[k]) + App.num(l.qty);
      });
    });
    var touched = false;
    App.allItems().forEach(function (x) {
      var k = x.type + ":" + x.it.id;
      if (x.it.lastSold === undefined && seen[k]) { x.it.lastSold = seen[k]; touched = true; }
      if (x.it.soldTotal === undefined && sold[k]) { x.it.soldTotal = sold[k]; touched = true; }
    });
    if (touched) App.save();
  }

  /* كل صنف مع حالته. neverSold = دخل المخزون ولم يُبَع منه شيء قط. */
  function rows() {
    backfill();
    var c = cfg();
    var out = [];
    App.allItems().forEach(function (x) {
      var it = x.it;
      var qty = App.num(it.qty);
      if (qty <= 0) return;                       // ما نفد ليس راكداً
      if (c.ignore.indexOf(it.id) >= 0) return;   // استثناه صاحب المحل

      var sinceSale = dayDiff(it.lastSold);
      var sinceAdd = dayDiff(it.created || it.updated);
      var never = !it.lastSold;
      var idle = never ? sinceAdd : sinceSale;
      if (idle === null) return;                  // بلا تاريخ يُعتمد عليه

      var limit = daysFor(x.type);
      if (idle < limit) return;

      var frozen = qty * App.num(it.cost);
      if (App.num(c.minValue) > 0 && frozen < App.num(c.minValue)) return;

      out.push({
        type: x.type, it: it, name: App.itemName(it),
        qty: qty, idle: idle, never: never,
        frozen: frozen, retail: qty * App.num(it.price),
        soldTotal: App.num(it.soldTotal),
        limit: limit
      });
    });
    return out;
  }

  /* ---------- الحالة المعروضة ---------- */

  var view = { q: "", kind: "all", sort: "frozen", shown: 100 };

  function setV(k, v) { view[k] = v; view.shown = 100; App.rerender(); }
  function more() { view.shown += 100; App.rerender(); }

  function filtered() {
    var all = rows();
    var nq = App.norm(view.q);
    var list = all.filter(function (r) {
      if (view.kind === "book" && r.type !== "book") return false;
      if (view.kind === "stat" && r.type !== "stat") return false;
      if (view.kind === "never" && !r.never) return false;
      if (nq) {
        var hay = App.norm(r.name + " " + (r.it.author || "") + " " + (r.it.cat || "") + " " + (r.it.barcode || ""));
        if (hay.indexOf(nq) < 0) return false;
      }
      return true;
    });
    var by = view.sort;
    list.sort(function (a, b) {
      if (by === "idle") return b.idle - a.idle;
      if (by === "qty") return b.qty - a.qty;
      if (by === "name") return a.name.localeCompare(b.name, "ar");
      return b.frozen - a.frozen;      // الافتراضي: المال المجمّد
    });
    return list;
  }

  function count() { return rows().length; }
  function frozenTotal() {
    return rows().reduce(function (s, r) { return s + r.frozen; }, 0);
  }

  /* ---------- الصفحة ---------- */

  function page() {
    var c = cfg();
    var list = filtered();
    var all = rows();
    var frozen = all.reduce(function (s, r) { return s + r.frozen; }, 0);
    var retail = all.reduce(function (s, r) { return s + r.retail; }, 0);
    var never = all.filter(function (r) { return r.never; });
    var pieces = all.reduce(function (s, r) { return s + r.qty; }, 0);

    var h = "";

    /* البطاقات: المال المجمّد أولاً — هو سبب وجود هذه الصفحة */
    h += '<div class="grid g4" style="margin-bottom:18px">' +
      '<div class="card stat bad" style="padding:20px"><div class="lbl">رأس مال مجمّد</div>' +
      '<div class="val num">' + App.money0(frozen) + '</div>' +
      '<div class="foot">لو بِيع كله: ' + App.money0(retail) + "</div></div>" +

      '<div class="card stat" style="padding:20px"><div class="lbl">أصناف راكدة</div>' +
      '<div class="val num">' + all.length + '</div>' +
      '<div class="foot">' + pieces + " قطعة على الرفوف</div></div>" +

      '<div class="card stat warn" style="padding:20px"><div class="lbl">لم يُبَع منها شيء قط</div>' +
      '<div class="val num">' + never.length + '</div>' +
      '<div class="foot">' + App.money0(never.reduce(function (s, r) { return s + r.frozen; }, 0)) + " مجمّدة</div></div>" +

      '<div class="card stat" style="padding:20px"><div class="lbl">حد الركود</div>' +
      '<div class="val num" style="font-size:22px">' + App.num(c.bookDays) + " / " + App.num(c.statDays) + '</div>' +
      '<div class="foot">يوماً — كتب / قرطاسية</div></div>' +
      "</div>";

    /* شريط الأدوات */
    h += '<div class="row" style="margin-bottom:14px;flex-wrap:wrap;gap:10px">' +
      '<div class="search-wrap"><span class="mag">⌕</span>' +
      '<input class="inp" placeholder="ابحث في الراكد…" value="' + App.esc(view.q) +
      '" oninput="Stale.setV(\'q\',this.value)"></div>' +
      '<div class="seg" style="max-width:420px">' +
      '<button class="' + (view.kind === "all" ? "on" : "") + '" onclick="Stale.setV(\'kind\',\'all\')">الكل</button>' +
      '<button class="' + (view.kind === "book" ? "on" : "") + '" onclick="Stale.setV(\'kind\',\'book\')">كتب</button>' +
      '<button class="' + (view.kind === "stat" ? "on" : "") + '" onclick="Stale.setV(\'kind\',\'stat\')">قرطاسية</button>' +
      '<button class="' + (view.kind === "never" ? "on" : "") + '" onclick="Stale.setV(\'kind\',\'never\')">لم يُبَع قط</button>' +
      "</div>" +
      '<div class="spacer"></div>' +
      '<div class="field"><label class="small">الترتيب</label>' +
      '<select class="inp" onchange="Stale.setV(\'sort\',this.value)">' +
      '<option value="frozen"' + (view.sort === "frozen" ? " selected" : "") + '>المال المجمّد</option>' +
      '<option value="idle"' + (view.sort === "idle" ? " selected" : "") + '>الأطول ركوداً</option>' +
      '<option value="qty"' + (view.sort === "qty" ? " selected" : "") + '>الأكثر كمية</option>' +
      '<option value="name"' + (view.sort === "name" ? " selected" : "") + '>الاسم</option>' +
      "</select></div>" +
      '<button class="btn" onclick="Stale.settings()">⚙ ضبط المدة</button>' +
      '<button class="btn" onclick="Stale.exportXls()">تصدير Excel</button>' +
      '<button class="btn" onclick="Stale.print()">طباعة القائمة</button>' +
      "</div>";

    if (!all.length) {
      h += '<div class="card"><div class="empty"><div class="big">✔</div>' +
        "<h4>لا يوجد ركود</h4><p>كل أصنافك تحرّكت خلال المدة المحددة. " +
        'إن أردت تشديد المعيار اضغط «ضبط المدة».</p></div></div>';
      return h;
    }

    h += '<div class="card">' + App.table([
      {
        h: "الصنف", c: function (r) {
          return "<b>" + App.esc(r.name) + "</b>" +
            (r.it.author ? '<div class="sub">' + App.esc(r.it.author) + "</div>" : "") +
            (r.never ? ' <span class="badge bad">لم يُبَع قط</span>' : "");
        }
      },
      { h: "النوع", c: function (r) { return r.type === "book" ? "كتاب" : "قرطاسية"; } },
      { h: "المكان", c: function (r) { return App.locChip ? App.locChip(r.it) : App.esc(r.it.lib || r.it.loc || ""); } },
      { h: "الكمية", cls: "num", c: function (r) { return r.qty; } },
      {
        h: "راكد منذ", cls: "num", c: function (r) {
          var cls = r.idle >= r.limit * 2 ? "bad" : "warn";
          return '<span class="badge ' + cls + '">' + r.idle + " يوم</span>";
        }
      },
      {
        h: "مال مجمّد", cls: "num", c: function (r) {
          return "<b>" + App.money0(r.frozen) + "</b>";
        }
      },
      {
        h: "", cls: "act", c: function (r) {
          return '<button class="btn sm" onclick="Stale.act(\'' + r.type + "','" + r.it.id + '\')">ماذا أفعل؟</button>' +
            ' <button class="btn sm ghost" onclick="Stale.ignore(\'' + r.it.id + '\')">تجاهل</button>';
        }
      }
    ], list, {
      limit: view.shown,
      moreAction: "Stale.more()",
      rowClass: function (r) { return r.never ? "out" : ""; },
      emptyIcon: "empty", emptyTitle: "لا نتائج", emptyText: "غيّر البحث أو الفلتر."
    }) + "</div>";

    if (c.ignore.length) {
      h += '<div class="card" style="margin-top:16px"><div class="card-body row" style="align-items:center">' +
        '<span class="muted small">' + c.ignore.length + ' صنف مستثنى من هذا التقرير.</span>' +
        '<div class="spacer"></div>' +
        '<button class="btn sm ghost" onclick="Stale.clearIgnored()">إلغاء الاستثناءات</button>' +
        "</div></div>";
    }

    return h;
  }

  /* ---------- الإجراءات ---------- */

  function settings() {
    var c = cfg();
    App.form({
      title: "ضبط معيار الركود",
      size: "narrow",
      values: { bookDays: c.bookDays, statDays: c.statDays, minValue: c.minValue },
      fields: [
        {
          k: "bookDays", label: "الكتاب يُعتبر راكداً بعد (يوم)", type: "number", min: 7, full: true,
          hint: "الكتب تدور أبطأ من القرطاسية — 120 يوماً نقطة بداية معقولة"
        },
        {
          k: "statDays", label: "صنف القرطاسية يُعتبر راكداً بعد (يوم)", type: "number", min: 7, full: true,
          hint: "الأقلام والدفاتر تدور أسرع — 90 يوماً"
        },
        {
          k: "minValue", label: "تجاهل ما قيمته أقل من", type: "money", min: 0, full: true,
          hint: "لإخفاء الأصناف الصغيرة التي لا تستحق القرار. صفر = أظهر كل شيء"
        }
      ],
      onSave: function (v) {
        c.bookDays = Math.max(7, App.num(v.bookDays));
        c.statDays = Math.max(7, App.num(v.statDays));
        c.minValue = Math.max(0, App.num(v.minValue));
        App.save();
        App.toast("حُدّث معيار الركود.");
        App.rerender();
      }
    });
  }

  function ignore(id) {
    var c = cfg();
    if (c.ignore.indexOf(id) < 0) c.ignore.push(id);
    App.save();
    App.toast("استُثني الصنف من تقرير الركود.");
    App.rerender();
  }

  function clearIgnored() {
    cfg().ignore = [];
    App.save();
    App.toast("عادت كل الأصناف للتقرير.");
    App.rerender();
  }

  /* نصيحة عملية بدل رقم مجرّد — هذا ما يحوّل التقرير إلى قرار */
  function act(type, id) {
    var it = App.findItem(type, id);
    if (!it) return;
    var r = null;
    rows().forEach(function (x) { if (x.it.id === id) r = x; });
    if (!r) return;

    var cost = App.num(it.cost), price = App.num(it.price);
    var margin = price - cost;
    var suggest = [];

    if (r.never && r.idle > r.limit * 2) {
      suggest.push("مضى " + r.idle + " يوماً على دخوله ولم يُبَع منه ولا قطعة — الأرجح أنه لا يناسب زبائنك. " +
        "أعِده للمورّد إن أمكن، أو انزل بسعره إلى " + App.money0(cost) + " (سعر الشراء) لتسترد رأس مالك.");
    } else if (r.never) {
      suggest.push("لم يُبَع منه شيء بعد. جرّب نقله إلى رف أوضح أو قرب الصندوق قبل التفكير في التخفيض.");
    } else {
      suggest.push("آخر بيعة كانت قبل " + r.idle + " يوماً، وبِيع منه " + r.soldTotal + " قطعة إجمالاً.");
    }

    if (margin > 0) {
      var d10 = price * 0.9, d20 = price * 0.8;
      suggest.push("هامشك الحالي " + App.money0(margin) + " للقطعة. تستطيع النزول إلى " +
        App.money0(d10) + " (خصم 10%) أو " + App.money0(d20) + " (خصم 20%) وتبقى رابحاً.");
      if (d20 < cost) suggest.push("تنبيه: خصم 20% ينزل بك تحت سعر الشراء.");
    } else {
      suggest.push("سعر بيعه لا يزيد عن شرائه — راجع السعر أولاً.");
    }

    if (r.qty > 5) {
      suggest.push("عندك " + r.qty + " قطعة. فكّر في عرض «اشترِ 2 واحصل على خصم» بدل تصريفها واحدة واحدة.");
    }

    App.modal({
      title: App.itemName(it),
      body: '<div class="grid g3" style="margin-bottom:16px">' +
        '<div class="card stat bad"><div class="lbl">مال مجمّد</div><div class="val num">' + App.money0(r.frozen) + "</div></div>" +
        '<div class="card stat"><div class="lbl">الكمية</div><div class="val num">' + r.qty + "</div></div>" +
        '<div class="card stat warn"><div class="lbl">راكد منذ</div><div class="val num">' + r.idle + "</div></div>" +
        "</div>" +
        '<ul style="line-height:2;padding-inline-start:20px;margin:0">' +
        suggest.map(function (s) { return "<li>" + App.esc(s) + "</li>"; }).join("") +
        "</ul>",
      actions: [
        {
          label: "تعديل السعر", click: function (close) {
            close();
            if (type === "book") Inv.editBook(id); else Inv.editStat(id);
          }
        },
        {
          label: "استثنِ من التقرير", click: function (close) { close(); ignore(id); }
        }
      ]
    });
  }

  /* ---------- تصدير وطباعة ---------- */

  function exportXls() {
    var list = filtered();
    if (!list.length) { App.toast("لا شيء للتصدير.", "warn"); return; }
    App.xls("البضاعة-الراكدة-" + App.today(), "البضاعة الراكدة", [
      ["الصنف", "النوع", "المؤلف", "التصنيف", "المكان", "الباركود",
        "الكمية", "سعر الشراء", "سعر البيع", "مال مجمّد", "راكد منذ (يوم)", "بِيع إجمالاً", "آخر بيع"]
    ].concat(list.map(function (r) {
      return [
        r.name, r.type === "book" ? "كتاب" : "قرطاسية", r.it.author || "", r.it.cat || "",
        (r.it.lib ? r.it.lib + " رف " + (r.it.shelf || "") : (r.it.loc || "")),
        r.it.barcode || "", r.qty, App.num(r.it.cost), App.num(r.it.price),
        r.frozen, r.idle, r.soldTotal, r.never ? "لم يُبَع قط" : (r.it.lastSold || "")
      ];
    })));
  }

  function print() {
    var list = filtered();
    if (!list.length) { App.toast("لا شيء للطباعة.", "warn"); return; }
    var frozen = list.reduce(function (s, r) { return s + r.frozen; }, 0);
    var h = '<div style="font-family:Tahoma,sans-serif;direction:rtl;padding:14px">' +
      '<h2 style="margin:0 0 4px">البضاعة الراكدة</h2>' +
      '<div style="color:#666;font-size:12px;margin-bottom:12px">' +
      App.esc(S().meta.shopName || "") + " · " + App.dateAr(App.today()) +
      " · " + list.length + " صنف · مال مجمّد " + App.money0(frozen) + "</div>" +
      '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr style="background:#eee">' +
      ["#", "الصنف", "المكان", "الكمية", "راكد منذ", "مال مجمّد"].map(function (x) {
        return '<th style="border:1px solid #ccc;padding:5px;text-align:right">' + x + "</th>";
      }).join("") + "</tr></thead><tbody>";
    list.forEach(function (r, i) {
      h += "<tr>" + [
        i + 1, App.esc(r.name),
        App.esc(r.it.lib ? r.it.lib + "/" + (r.it.shelf || "") : (r.it.loc || "")),
        r.qty, r.idle + " يوم", App.money0(r.frozen)
      ].map(function (x) {
        return '<td style="border:1px solid #ccc;padding:5px">' + x + "</td>";
      }).join("") + "</tr>";
    });
    h += "</tbody></table></div>";
    App.printHtml(h);
  }

  return {
    page: page, setV: setV, more: more, settings: settings,
    ignore: ignore, clearIgnored: clearIgnored, act: act,
    exportXls: exportXls, print: print,
    count: count, frozenTotal: frozenTotal, rows: rows
  };
})();
