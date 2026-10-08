/* ============================================================
   inventory.js — الكتب، القرطاسية، التنبيهات، إدخال البضاعة
   ============================================================ */

var Inv = (function () {

  var f = { q: "", lib: "", shelf: "", cat: "", st: "", view: "table" };
  var g = { q: "", cat: "", st: "" };
  var draft = null;   // فاتورة شراء قيد الإدخال

  function S() { return App.S; }

  /* ---------- بحث مشترك ---------- */

  /* المطابق أولاً، وإن لم يكفِ فالأقرب إليه (res.fz يحدّد أين يبدأ القريب) */
  function itemHay(x) {
    var it = x.it;
    return [App.itemName(it), it.code, it.barcode, it.author, it.brand, it.publisher,
      it.cat, it.catFull, it.lib, it.loc, it.note];
  }

  function searchItems(q, limit) {
    if (!App.norm(q)) return [];
    return App.rank(App.allItems(), q, itemHay, limit || 8);
  }

  function byBarcode(code) {
    var c = String(code).trim();
    if (!c) return null;
    var hit = null;
    App.allItems().forEach(function (x) {
      if (hit) return;
      if (String(x.it.barcode || "").trim() === c || String(x.it.code || "").trim().toUpperCase() === c.toUpperCase()) hit = x;
    });
    return hit;
  }

  /* ============================================================
     الكتب
     ============================================================ */

  function books() {
    f.view = f.view || "table";
    var libs = S().meta.libraries;
    var h = '<div class="row" style="margin-bottom:14px">' +
      '<div class="search-wrap"><span class="mag">⌕</span>' +
      '<input class="inp" id="bq" placeholder="ابحث أو امسح الباركود…" value="' + App.esc(f.q) + '" oninput="Inv.setF(\'q\',this.value)"></div>' +

      '<select class="inp" style="width:auto" onchange="Inv.setF(\'lib\',this.value)"><option value="">كل المكتبات</option>' +
      libs.map(function (l) { return '<option value="' + App.esc(l) + '"' + (f.lib === l ? " selected" : "") + ">مكتبة " + App.esc(l) + "</option>"; }).join("") + "</select>" +

      '<select class="inp" style="width:auto" onchange="Inv.setF(\'shelf\',this.value)"><option value="">كل الرفوف</option>' +
      shelfOptions().map(function (n) { return '<option value="' + n + '"' + (String(f.shelf) === String(n) ? " selected" : "") + ">رف " + n + "</option>"; }).join("") + "</select>" +

      '<select class="inp" style="width:auto" onchange="Inv.setF(\'st\',this.value)">' +
      '<option value="">كل الحالات</option>' +
      '<option value="low"' + (f.st === "low" ? " selected" : "") + ">قاربت على النفاد</option>" +
      '<option value="out"' + (f.st === "out" ? " selected" : "") + ">نفدت</option>" +
      "</select>" +

      '<div class="spacer"></div>' +
      '<div class="seg" style="width:290px">' +
      '<button class="' + (f.view === "table" ? "on" : "") + '" onclick="Inv.setF(\'view\',\'table\')">جدول</button>' +
      '<button class="' + (f.view === "cards" ? "on" : "") + '" onclick="Inv.setF(\'view\',\'cards\')">بطاقات</button>' +
      '<button class="' + (f.view === "map" ? "on" : "") + '" onclick="Inv.setF(\'view\',\'map\')">خريطة الرفوف</button>' +
      "</div>" +
      '<button class="btn" onclick="Inv.exportGoods(\'book\')">تصدير Excel</button>' +
      '<button class="btn" onclick="Inv.importItems(\'book\')">استيراد</button>' +
      '<button class="btn primary" onclick="Inv.editBook()">+ كتاب جديد</button>' +
      "</div>" +
      '<div class="card"><div id="invBody"></div></div>';

    setTimeout(function () { paintBooks(); bindScan("bq"); }, 0);
    return h;
  }

  /* حقل البحث يتعامل مع مكينة قارئ الباركود: الرمز الجديد يمسح القديم */
  function bindScan(id) {
    var el = document.getElementById(id);
    if (el && App.scanField) App.scanField(el, function (v) {
      if (id === "bq") setF("q", v); else setG("q", v);
    });
  }

  /* شارة التصنيف في الجداول: تُقصّ بنقاط والنص كاملاً عند وقوف الفأرة.

     كانت الشارة لا تنكسر لسطر ثانٍ، فيتّسع العمود كله ليساوي أطول
     تصنيف في القائمة. بتخصص من 193 حرفاً صار عمود التصنيف 1136 بكسل،
     وخرجت الكمية والحالة والأزرار عن الشاشة يساراً، وانضغط اسم الكتاب
     في 162 بكسل. */
  function catBadge(it) {
    if (!it.cat) return '<span class="muted">—</span>';
    var tip = it.cat + (it.catFull && it.catFull !== it.cat ? "\n" + it.catFull : "");
    return '<span class="badge cat" title="' + App.esc(tip) + '">' + App.esc(it.cat) + "</span>";
  }

  /* نقطة حمراء بجانب اسم الصنف الذي لم تُطبع لاصقته بعد */
  function lblMark(it) {
    return (typeof Labels !== "undefined" && Labels.mark) ? Labels.mark(it) : "";
  }

  function shelfOptions() {
    var n = App.num(S().meta.shelves) || 6, a = [];
    for (var i = 1; i <= n; i++) a.push(i);
    return a;
  }

  function filteredBooks() {
    var rows = S().books.filter(function (b) {
      if (f.lib && b.lib !== f.lib) return false;
      if (f.shelf && String(b.shelf) !== String(f.shelf)) return false;
      if (f.st && App.stockState(b) !== f.st) return false;
      return true;
    });
    return App.rank(rows, f.q, function (b) {
      return [b.title, b.code, b.barcode, b.author, b.publisher, b.cat, b.catFull];
    });
  }

  /* ---------- الرفوف والمخزن في الجداول ----------
     عمود الكمية صار عمودين: على الرفوف، وفي غرفة الخزين (وتحته المجموع،
     وهو الرقم القديم نفسه). حدّ التنبيه يُقارن بالمجموع كما كان. */
  function qtyCols() {
    return [
      {
        h: "الرفوف", cls: "num", c: function (x) {
          return '<b class="q-sh">' + App.shelfQty(x) + "</b>" +
            (App.num(x.min) ? '<span class="muted small"> / ' + App.num(x.min) + "</span>" : "");
        }
      },
      {
        h: "المخزن", cls: "num", c: function (x) {
          var st = App.storeQty(x);
          return st ? '<b class="q-st">' + st + '</b><div class="muted small q-tot">المجموع ' + App.num(x.qty) + "</div>"
            : '<span class="muted">—</span>';
        }
      }
    ];
  }
  /* «نفد من الرفوف» حين لا نسخة معروضة وفي المخزن نسخ */
  function shelfBadge(x) {
    if (App.storeQty(x) > 0 && App.shelfQty(x) <= 0) return '<span class="badge warn">نفد من الرفوف</span>';
    return App.stockBadge(x);
  }

  /* ---------- عرض البطاقات ----------
     الجدول أكثف، والبطاقات أوضح للعين على شاشة كبيرة أو عند المرور
     السريع على الرف. الاختيار محفوظ فلا يُعاد كل مرة. */
  function cardsHtml(rows, type) {
    if (!rows.length) {
      return '<div class="empty"><div class="big">▣</div><h4>لا نتائج</h4>' +
        "<p>غيّر البحث أو الفلتر.</p></div>";
    }
    var isB = type === "book";
    var first = rows.length > 80 ? rows.slice(0, 60) : rows, rest = rows.slice(first.length);
    var n = 0, nearAt = rows.fz && rows.fz.first >= 0 ? rows.fz.first : -1;
    function card(x) {
      var st = App.stockState(x);
      var sep = n++ === nearAt
        ? '<div class="near-sep cards">' + App.icon("search", 15) + " " + App.esc(App.nearLabel(rows)) + "</div>" : "";
      return sep + '<div class="item-card ' + (st === "out" ? "out" : (st === "low" ? "low" : "")) + '">' +
        '<div class="ic-top">' + lblMark(x) +
        '<b class="ic-name">' + App.esc(App.itemName(x)) + "</b></div>" +
        '<div class="ic-sub">' + App.esc(x.author || x.brand || "—") +
        (x.publisher ? " · " + App.esc(x.publisher) : "") + "</div>" +
        '<div class="ic-chips">' +
        (isB ? App.locChip(x) : '<span class="badge">' + App.esc(x.loc || "—") + "</span>") +
        (x.cat ? '<span class="badge">' + App.esc(x.cat) + "</span>" : "") +
        shelfBadge(x) +
        "</div>" +
        '<div class="ic-nums">' +
        '<div><span>البيع</span><b>' + App.money0(x.price) + "</b></div>" +
        '<div><span>الرفوف · المخزن</span><b>' + App.shelfQty(x) +
        (App.storeQty(x) ? ' <small class="muted">· ' + App.storeQty(x) + "</small>" : "") + "</b></div>" +
        '<div><span>الرمز</span><b class="num sm">' +
        App.esc(x.barcode || x.code || "—") + "</b></div>" +
        "</div>" +
        '<div class="ic-acts">' +
        '<button class="btn sm" onclick="Inv.addStock(\'' + type + "','" + x.id + '\')">+ كمية</button>' +
        '<button class="btn sm" onclick="Inv.move(\'' + type + "','" + x.id + '\')">⇄ نقل</button>' +
        '<button class="btn sm" onclick="Inv.' + (isB ? "editBook" : "editStat") + "('" + x.id + '\')">تعديل</button>' +
        '<button class="btn sm ghost" onclick="Labels.one(\'' + type + "','" + x.id + '\')">⌷ لاصقة</button>' +
        '<button class="btn sm ghost" onclick="Inv.del(\'' + type + "','" + x.id + '\')">حذف</button>' +
        "</div></div>";
    }
    var h = '<div class="item-cards">' + first.map(card).join("") + "</div>";
    if (rest.length) {
      h += App.lazyMore(function (n) {
        var part = rest.splice(0, n);
        return { html: part.map(card).join(""), left: rest.length };
      }, "self", rest.length);
    }
    return h;
  }

  function paintBooks() {
    var host = document.getElementById("invBody");
    if (!host) return;
    if (f.view === "map") { host.innerHTML = '<div class="card-body">' + shelfMap() + "</div>"; return; }
    if (f.view === "cards") {
      host.innerHTML = '<div class="card-body">' + cardsHtml(filteredBooks(), "book") + "</div>";
      return;
    }

    var rows = filteredBooks();
    host.innerHTML = App.table([
      {
        h: "الكتاب", c: function (b) {
          return '<div class="name">' + lblMark(b) + App.esc(b.title) + "</div>" +
            '<div class="sub">' + App.esc(b.author || "بدون مؤلف") + (b.publisher ? " · " + App.esc(b.publisher) : "") + "</div>";
        }
      },
      { h: "الموقع", c: function (b) { return App.locChip(b); } },
      { h: "التصنيف", c: catBadge },
      { h: "الرمز", c: function (b) { return '<span class="num small">' + App.esc(b.barcode || b.code || "") + "</span>"; } },
      App.canProfit() ? { h: "الجملة", cls: "num", c: function (b) { return App.money0(b.cost); } } : null,   // سعر الشراء يُخفى والأرباح مقفلة
      { h: "البيع", cls: "num", c: function (b) { return "<b>" + App.money0(b.price) + "</b>"; } },
    ].concat(qtyCols(), [
      { h: "الحالة", c: shelfBadge },
      {
        h: "", cls: "act", c: function (b) {
          return '<button class="btn sm" onclick="Inv.addStock(\'book\',\'' + b.id + '\')">+ كمية</button> ' +
            '<button class="btn sm" onclick="Inv.move(\'book\',\'' + b.id + '\')" title="نقل بين المخزن والرفوف">⇄ نقل</button> ' +
            '<button class="btn sm" onclick="Inv.editBook(\'' + b.id + '\')">تعديل</button> ' +
            '<button class="btn sm ghost" onclick="Labels.one(\'book\',\'' + b.id + '\')" title="طباعة لاصقة باركود">⌷ لاصقة</button> ' +
            '<button class="btn sm ghost" onclick="Inv.del(\'book\',\'' + b.id + '\')">حذف</button>';
        }
      }
    ]), rows, {
      lazy: 60,
      rowClass: function (b) { var s = App.stockState(b); return s === "out" ? "out" : (s === "low" ? "low" : ""); },
      emptyIcon: "box",
      emptyTitle: S().books.length ? "لا نتيجة مطابقة" : "لم تُضف أي كتب بعد",
      emptyText: S().books.length ? "جرّب تغيير البحث أو الفلاتر." : "ابدأ بإضافة أول كتاب، أو استورد قائمة جاهزة من ملف Excel.",
      emptyAction: S().books.length ? "" : '<button class="btn primary" onclick="Inv.editBook()">+ إضافة كتاب</button>'
    });
  }

  /* ---------- خريطة الرفوف ---------- */

  function shelfMap() {
    var libs = S().meta.libraries;
    if (!libs.length) return '<div class="empty"><h4>لم تُعرَّف أي مكتبة</h4><p>أضف المكتبات من الإعدادات.</p></div>';

    var noLoc = S().books.filter(function (b) { return !b.lib || !b.shelf; }).length;

    var h = '<div class="shelfmap">';
    libs.forEach(function (L) {
      var inLib = S().books.filter(function (b) { return b.lib === L; });
      h += '<div class="bookcase"><div class="cap">' +
        '<span class="letter">' + App.esc(L) + "</span>" +
        "<span>مكتبة " + App.esc(L) + "</span>" +
        '<span class="n num">' + inLib.length + " عنوان</span></div>";

      shelfOptions().forEach(function (n) {
        var on = inLib.filter(function (b) { return String(b.shelf) === String(n); });
        var bars = on.slice(0, 18).map(function (b) {
          var st = App.stockState(b);
          var hgt = Math.max(6, Math.min(24, 6 + App.num(b.qty) * 2));
          return '<i class="' + (st === "out" ? "b" : st === "low" ? "w" : "") + '" style="height:' + hgt + 'px"></i>';
        }).join("");
        h += '<button class="shelf-row" onclick="Inv.showShelf(\'' + App.esc(L) + "'," + n + ')">' +
          '<span class="sn">رف ' + n + "</span>" +
          '<span class="bars">' + bars + "</span>" +
          '<span class="cnt">' + on.length + "</span></button>";
      });
      h += "</div>";
    });
    h += "</div>";

    if (noLoc) {
      h += '<div class="row" style="margin-top:16px;padding:12px 14px;background:var(--amber-wash);border-radius:var(--r)">' +
        "<span>" + noLoc + ' كتاب بدون موقع محدد.</span><div class="spacer"></div>' +
        '<button class="btn sm" onclick="Inv.setF(\'view\',\'table\');Inv.setF(\'q\',\'\')">عرضها في الجدول</button></div>';
    }
    return h;
  }

  function showShelf(lib, n) {
    var on = S().books.filter(function (b) { return b.lib === lib && String(b.shelf) === String(n); });
    App.modal({
      title: "مكتبة " + lib + " — رف " + n,
      size: "wide",
      body: App.table([
        { h: "الكتاب", c: function (b) { return '<div class="name">' + lblMark(b) + App.esc(b.title) + '</div><div class="sub">' + App.esc(b.author || "") + "</div>"; } },
        { h: "الكمية", cls: "num", c: function (b) { return App.num(b.qty); } },
        { h: "البيع", cls: "num", c: function (b) { return App.money0(b.price); } },
        { h: "الحالة", c: function (b) { return App.stockBadge(b); } },
        { h: "", cls: "act", c: function (b) { return '<button class="btn sm" onclick="Inv.editBook(\'' + b.id + '\')">تعديل</button>'; } }
      ], on, { emptyIcon: "box", emptyTitle: "هذا الرف فارغ", emptyText: "لا يوجد كتاب مسجّل على هذا الموقع." })
    });
  }

  /* ---------- إضافة / تعديل كتاب ---------- */

  /* دار النشر: سعر البيع يُحسب من سعر الشراء حسب نسبتها.
     مثال: شراء 80 ونسبة 0.2 → البيع 100 (النسبة من سعر البيع). */
  function pubList() { return S().publishers || []; }

  function pubByName(name) {
    var r = null;
    pubList().forEach(function (p) { if (App.norm(p.name) === App.norm(name)) r = p; });
    return r;
  }

  /* نسبة دار النشر = خصم الجملة على سعر القطاعي.
     مثال: قطاعي 100 ونسبة 0.1 ← سعر الجملة للزبون 90 */
  function wholesaleFromPub(retail, pub) {
    retail = App.num(retail);
    if (!pub || retail <= 0) return 0;
    var rate = App.num(pub.rate);
    if (rate <= 0 || rate >= 1) return 0;
    return Math.round(retail * (1 - rate) * 100) / 100;
  }

  /* نسبة الخصم تُكتب كسراً (0.25). من يكتب «25» يقصد 25% — كانت تُحفظ 25
     (تظهر 2500%) فيصير سعر الجملة صفراً لكل كتب الدار ويُباع بسعر القطاعي.
     الآن: 1–99 تُفهم نسبةً مئوية، و100 فما فوق تُرفض. يُرجع null عند الرفض. */
  function normRate(raw) {
    var r = App.num(raw);
    if (r >= 100) { App.toast("نسبة الخصم يجب أن تكون أقل من 100% — اكتب مثلاً 0.25 أو 25.", "warn"); return null; }
    if (r >= 1) { App.toast("فهمنا «" + r + "» على أنها خصم " + r + "% (أي " + (r / 100) + ").", "ok"); r = Math.round(r) === r ? r / 100 : Math.round(r * 100) / 10000; }
    return Math.max(r, 0);
  }

  function pubHint(p) {
    if (!p) return "";
    return "خصم " + (App.num(p.rate) * 100) + "% · قطاعي 100 ← جملة " + wholesaleFromPub(100, p);
  }

  /* يبحث عن كتب مشابهة بالاسم أو الباركود قبل تسجيل كتاب جديد */
  function findDupes(type, name, code, skipId) {
    var n = App.norm(name);
    if (n.length < 3) return [];
    var out = [];
    App.listOf(type).forEach(function (x) {
      if (x.id === skipId) return;
      var xn = App.norm(App.itemName(x));
      var same = false;
      if (code && String(code).trim()) {
        if (String(x.barcode || "").trim() === String(code).trim()) same = true;
        if (String(x.code || "").trim() === String(code).trim()) same = true;
      }
      if (!same && xn) {
        if (xn === n) same = true;
        else if (xn.length > 8 && n.length > 8 && (xn.indexOf(n) >= 0 || n.indexOf(xn) >= 0)) same = true;
      }
      if (same) out.push(x);
    });
    return out;
  }

  function showDupes(type, dupes, formModal) {
    App.modal({
      title: "انتبه — يوجد ما يشبهه",
      body: '<p style="margin-top:0;line-height:1.8">وجدت ' + dupes.length +
        " صنفاً مسجّلاً بنفس الاسم أو الباركود. تأكد أنك لا تسجّله مرتين.</p>" +
        App.table([
          {
            h: "الصنف", c: function (x) {
              return '<div class="name">' + lblMark(x) + App.esc(App.itemName(x)) + "</div>" +
                '<div class="sub">' + App.esc(x.author || x.brand || "") + "</div>";
            }
          },
          { h: "الرمز", c: function (x) { return '<span class="num small">' + App.esc(x.barcode || x.code || "") + "</span>"; } },
          { h: "الموقع", c: function (x) { return type === "book" ? App.locChip(x) : App.esc(x.loc || "—"); } },
          { h: "الكمية", cls: "num", c: function (x) { return App.num(x.qty); } },
          { h: "السعر", cls: "num", c: function (x) { return App.money0(x.price); } },
          {
            h: "", cls: "act", c: function (x) {
              return '<button class="btn sm primary" onclick="Inv.addStock(\'' + type + '\',\'' + x.id + '\')">+ كمية له</button>';
            }
          }
        ], dupes),
      cancelLabel: "أرجع وأصلح",
      actions: [{
        label: "لا، هذا كتاب مختلف — أكمل التسجيل", click: function (close) {
          dupOK = true;
          close();
          var btn = formModal.el.querySelector(".m-foot .btn.primary");
          if (btn) btn.click();
        }
      }]
    });
  }

  var dupOK = false;

  function editBook(id) {
    var b = id ? App.findItem("book", id) : null;
    var lb = S().meta.lastBook || {};
    dupOK = false;
    newDest = "shelf";
    var fm = App.form({
      title: b ? "تعديل كتاب" : "كتاب جديد",
      size: "wide",
      topHtml: b ? "" : '<div style="margin-bottom:14px">' + destTabs("shelf", "Inv.setNewDest") + "</div>" +
        '<button class="btn" style="margin-bottom:12px" onclick="Inv.smartPaste()">📋 لصق البيانات من جيميناي دفعة واحدة</button>',
      values: b || {
        lib: lb.lib || S().meta.libraries[0] || "",
        shelf: lb.shelf || 1,
        cat: lb.cat || "",
        publisher: lb.publisher || "",
        qty: App.num(lb.qty) || 2,
        min: 0
      },
      onChange: function (key, val, scope, vals) {
        if (key === "publisher" && val === "__new__") { App.setField(scope, "publisher", ""); newPublisher(scope); return; }
        if (key === "supplierId" && val === "__new__") { App.setField(scope, "supplierId", ""); newSupplier(scope); return; }
        if (key !== "publisher" && key !== "price") return;
        var pub = pubByName(vals.publisher);
        if (!pub) return;
        var pw = wholesaleFromPub(vals.price, pub);
        if (pw > 0) {
          App.setField(scope, "priceW", pw);
          App.toast("سعر الجملة بخصم " + (App.num(pub.rate) * 100) + "%: " + App.money(pw));
        }
      },
      fields: [
        { k: "title", label: "اسم الكتاب", required: true, full: true },
        { k: "author", label: "المؤلف", list: authorList() },
        {
          k: "publisher", label: "دار النشر", type: "select",
          options: [{ v: "", t: "— بدون —" }].concat(pubList().map(function (p) {
            return { v: p.name, t: p.name + " (خصم " + (App.num(p.rate) * 100) + "%)" };
          })).concat([{ v: "__new__", t: "➕ إضافة دار نشر جديدة…" }]),
          hint: "نسبتها تحسب سعر الجملة من سعر القطاعي"
        },
        {
          k: "supplierId", label: "المورّد", type: "select",
          options: [{ v: "", t: "— بدون —" }].concat(S().suppliers.map(function (x) {
            return { v: x.id, t: x.name + (x.phone ? " · " + x.phone : "") };
          })).concat([{ v: "__new__", t: "➕ إضافة مورّد جديد…" }])
        },
        { k: "lib", label: "المكتبة (الخزانة)", type: "select", options: S().meta.libraries },
        { k: "shelf", label: "رقم الرف", type: "select", options: shelfOptions() },
        { k: "cat", label: "التصنيف", type: "select", options: catOptions("book", lb.cat) },
        /* التصنيف قائمة قصيرة يُتصفَّح بها، والتخصص الدقيق نصٌّ حرّ
           يشرح الكتاب. فصلهما يجعل القائمة قابلة للاستعمال ولا يضيع
           التفصيل الذي كُتب أصلاً. */
        {
          k: "catFull", label: "التخصص الدقيق", full: true,
          hint: "وصف تفصيلي للتخصص — لا يدخل في قائمة التصنيف، ويُبحث فيه"
        },
        /* ليس إلزامياً: يُسجَّل الكتاب بلا باركود، ويُولَّد له رمز عند
           طباعة لاصقته من تبويب «طباعة اللاصقات». */
        { k: "barcode", label: "الباركود", hint: "امسحه بالقارئ، أو اتركه فارغاً ليُولَّد عند طباعة اللاصقة" },
        { k: "cost", label: "سعر الشراء من المورّد", type: "money", min: 0 },
        { k: "price", label: "سعر البيع قطاعي", type: "money", min: 0, required: true, hint: "اكتبه واختر دار النشر ليُحسب سعر الجملة" },
        { k: "priceW", label: "سعر البيع جملة", type: "money", min: 0, hint: "يُحسب تلقائياً من نسبة دار النشر — أو اكتبه بيدك" },
        { k: "qty", label: b ? "الكمية الحالية (كلها)" : "الكمية", type: "number", min: 0, hint: b ? "على الرفوف + في غرفة الخزين" : "تذهب إلى المكان المختار بالأعلى" },
        b ? { k: "store", label: "منها في غرفة الخزين", type: "number", min: 0, hint: "الباقي يُحسب على الرفوف" } : null,
        { k: "min", label: "حد التنبيه", type: "number", min: 0, hint: "ينبّهك عند الوصول لهذا العدد" },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        // لا أسعار ولا كميات سالبة
        ["cost", "price", "priceW", "qty", "min"].forEach(function (k) {
          if (App.num(v[k]) < 0) v[k] = 0;
        });
        // المخزن جزء من الكمية: لا يزيد عليها ولا يقلّ عن صفر
        v.store = Math.min(Math.max(Math.floor(App.num(v.store)), 0), Math.max(App.num(v.qty), 0));
        if (!b) v.store = newDest === "store" ? Math.max(App.num(v.qty), 0) : 0;
        var bc = String(v.barcode || "").trim();
        if (bc) {
          var clash = null;
          App.allItems().forEach(function (x) {
            if (clash || (b && x.it.id === b.id)) return;
            if (String(x.it.barcode || "").trim() === bc) clash = x;
          });
          if (clash) {
            App.toast("هذا الباركود مستعمل في: " + App.itemName(clash.it), "bad");
            return false;
          }
        }
        if (!b && !dupOK) {
          var dd = findDupes("book", v.title, v.barcode, null);
          if (dd.length) { showDupes("book", dd, fm); return false; }
        }
        if (App.num(v.priceW) <= 0 && v.publisher) {
          var pb2 = pubByName(v.publisher);
          var auto = wholesaleFromPub(v.price, pb2);
          if (auto > 0) v.priceW = auto;
        }
        S().meta.lastBook = {
          lib: v.lib, shelf: v.shelf, cat: v.cat, publisher: v.publisher,
          qty: App.num(v.qty) || 2, min: 0
        };
        if (b) {
          Object.keys(v).forEach(function (k) { b[k] = v[k]; });
          b.updated = App.nowStamp();
          App.log("تعديل كتاب", b.title);
          App.toast("حُفظت تعديلات: " + b.title);
        } else {
          v.id = App.uid();
          v.code = App.nextCode("book");
          v.created = v.updated = App.nowStamp();
          S().books.unshift(v);
          App.log("إضافة كتاب", v.title);
          App.toast("أُضيف الكتاب: " + v.title);
        }
        App.save(); App.rerender();
      }
    });
  }

  /* إضافة سريعة من داخل نموذج الصنف — بلا مغادرة الشاشة */
  function newSupplier(scope) {
    App.form({
      title: "مورّد جديد",
      size: "narrow",
      fields: [
        { k: "name", label: "اسم المورّد", required: true, full: true },
        { k: "phone", label: "رقم الهاتف", full: true },
        { k: "city", label: "المدينة", full: true }
      ],
      onSave: function (v) {
        v.id = App.uid();
        S().suppliers.push(v);
        App.save();
        var sel = scope.querySelector("#f_supplierId");
        if (sel) {
          var o = document.createElement("option");
          o.value = v.id; o.textContent = v.name + (v.phone ? " · " + v.phone : "");
          sel.insertBefore(o, sel.options[sel.options.length - 1]);
          sel.value = v.id;
        }
        App.toast("أُضيف المورّد: " + v.name);
      }
    });
  }

  function newPublisher(scope) {
    App.form({
      title: "دار نشر جديدة",
      size: "narrow",
      values: { rate: 0.2, mode: "margin" },
      fields: [
        { k: "name", label: "اسم دار النشر", required: true, full: true },
        { k: "rate", label: "خصم الجملة", type: "number", step: "0.01", min: 0, full: true, hint: "0.1 تعني خصم 10% — قطاعي 100 ← جملة 90" }
      ],
      onSave: function (v) {
        var rt = normRate(v.rate);
        if (rt === null) return false;
        v.id = App.uid();
        v.rate = rt;
        S().publishers.push(v);
        App.save();
        var sel = scope.querySelector("#f_publisher");
        if (sel) {
          var o = document.createElement("option");
          o.value = v.name; o.textContent = v.name + " (خصم " + (v.rate * 100) + "%)";
          sel.insertBefore(o, sel.options[sel.options.length - 1]);
          sel.value = v.name;
          var pEl = scope.querySelector("#f_price");
          var pw = wholesaleFromPub(pEl ? pEl.value : 0, v);
          if (pw > 0) App.setField(scope, "priceW", pw);
        }
        App.toast("أُضيفت دار النشر: " + v.name);
      }
    });
  }

  /* لصق ذكي: يفهم مخرجات جيميناي ويوزّعها على الحقول دفعة واحدة */
  var PASTE_MAP = [
    { k: "title", pats: ["اسم الكتاب", "عنوان الكتاب", "العنوان", "الاسم", "book name", "title"] },
    { k: "author", pats: ["أسماء المؤلفين", "اسماء المؤلفين", "المؤلفين", "المؤلف", "الكاتب", "author", "authors"] },
    { k: "publisher", pats: ["دار النشر", "الناشر", "publisher"] },
    { k: "cat", pats: ["تصنيف الكتاب", "التصنيف", "الفئة", "category"] },
    { k: "barcode", pats: ["الباركود", "الرقم الدولي", "isbn", "barcode"] },
    { k: "note", pats: ["ملاحظة", "ملاحظات", "الوصف", "note", "notes", "description"] },
    { k: "qty", pats: ["عدد النسخ", "الكمية", "العدد", "quantity", "qty", "copies"] }
  ];

  function parsePasted(text) {
    var lines = String(text).split(/\r?\n/);
    var out = {}, curKey = null, buf = [];

    function flush() {
      if (curKey && buf.length) {
        var val = buf.join(" ").replace(/\s+/g, " ").trim();
        if (val && !out[curKey]) out[curKey] = val;
      }
      buf = [];
    }

    function matchLabel(line) {
      var t = App.norm(line).replace(/[:：]/g, " ").trim();
      for (var i = 0; i < PASTE_MAP.length; i++) {
        for (var j = 0; j < PASTE_MAP[i].pats.length; j++) {
          var pat = App.norm(PASTE_MAP[i].pats[j]);
          if (t === pat || t.indexOf(pat) === 0) {
            return { k: PASTE_MAP[i].k, rest: line.replace(/^[^:：]*[:：]/, "").trim() };
          }
        }
      }
      return null;
    }

    lines.forEach(function (ln) {
      if (!ln.trim()) return;
      var m = matchLabel(ln);
      if (m) {
        flush();
        curKey = m.k;
        if (m.rest) buf.push(m.rest);
      } else if (curKey) buf.push(ln.trim());
      else if (!out.title) { out.title = ln.trim(); curKey = "title"; }
    });
    flush();
    return out;
  }


  /* ============================================================
     لصق دفعة كتب — عدة كتب من ردّ واحد
     ------------------------------------------------------------
     تصوير كتاب واحد وإرساله ونسخ الرد ولصقه، مضروبة في 300 كتاب،
     هي العمل كله. هنا تصوّر رفّاً كاملاً وتلصق الرد مرة واحدة.
     يفهم ثلاث صيغ: أسطر مفصولة بـ | ، وجدول CSV، وفقرات معنونة
     مفصولة بسطر فارغ أو --- .
     ============================================================ */

  var BULK_PROMPT =
    "هذه صور كتب من رف واحد في مكتبة. لكل كتاب في الصور، أعطني سطراً واحداً بهذا الترتيب " +
    "مفصولاً بعلامة | وبلا أي كلام إضافي وبلا ترقيم:\n\n" +
    "اسم الكتاب | المؤلف | دار النشر | التصنيف | الرقم الدولي ISBN إن ظهر | عدد النسخ\n\n" +
    "قواعد:\n" +
    "- سطر واحد لكل كتاب، ولا تكتب عناوين أعمدة.\n" +
    "- إن لم تجد معلومة اتركها فارغة بين علامتي | متتاليتين.\n" +
    "- اكتب ISBN أرقاماً فقط بلا شرطات.\n" +
    "- عدد النسخ: اعدد كم نسخة من الكتاب نفسه ظاهرة في الصور، واترك الخانة " +
    "فارغة إن لم تستطع العدّ بثقة.\n" +
    "- لا تكرر الكتاب الواحد في أكثر من سطر ولو ظهر في عدة صور — اجمع نسخه في سطر واحد.";

  function bulkSplitFields(line) {
    if (line.indexOf("|") >= 0) return line.split("|");
    if (line.indexOf("\t") >= 0) return line.split("\t");
    if ((line.match(/,/g) || []).length >= 2) return line.split(",");
    return [line];
  }

  /* فقرة معنونة (نفس صيغة اللصق المفرد) — نعيد استعمال parsePasted */
  function bulkParseBlock(block) {
    var got = parsePasted(block);
    if (got && got.title) return got;
    return null;
  }

  function parseBulk(text) {
    var raw = String(text || "").replace(/\r/g, "").trim();
    if (!raw) return [];

    // فقرات مفصولة بـ --- أو سطر فارغ، وفيها عناوين حقول
    if (/(^|\n)\s*(-{3,}|={3,})\s*(\n|$)/.test(raw) ||
      (/\n\s*\n/.test(raw) && /[:：]/.test(raw))) {
      var blocks = raw.split(/\n\s*(?:-{3,}|={3,})\s*\n|\n\s*\n/);
      var outB = [];
      blocks.forEach(function (b) {
        var g = bulkParseBlock(b);
        if (g) outB.push(g);
      });
      if (outB.length) return outB;
    }

    // سطر لكل كتاب
    var out = [];
    raw.split("\n").forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      t = t.replace(/^\s*\d+\s*[-.)،]\s*/, "");          // ترقيم في أول السطر
      if (/^(اسم الكتاب|العنوان|title)\s*\|/i.test(t)) return;   // صف عناوين
      var f = bulkSplitFields(t).map(function (x) { return String(x).trim(); });
      if (!f[0]) return;

      /* الكمية من العمود السادس، أو من لاحقة في آخر الاسم مثل
         "الرياضيات ×5" أو "الرياضيات (5)" — كلاهما طبيعي عند العدّ على الرف. */
      var title = f[0], qty = null;
      var m = title.match(/[\s]*[x×*]\s*(\d+)\s*$/i) || title.match(/[\s]*\((\d+)\)\s*$/);
      if (m) { qty = App.num(m[1]); title = title.slice(0, m.index).trim(); }
      if (f[5] !== undefined && App.hasNumber(f[5])) qty = App.num(f[5]);

      out.push({
        title: title, author: f[1] || "", publisher: f[2] || "",
        cat: f[3] || "", barcode: (f[4] || "").replace(/[^0-9Xx]/g, ""),
        qty: qty
      });
    });
    return out;
  }

  var bulkRows = [];

  function bulkPaste() {
    bulkRows = [];
    var lb = S().meta.lastBook || {};
    var box = document.createElement("div");
    box.innerHTML =
      '<div class="row" style="gap:10px;margin-bottom:12px;flex-wrap:wrap">' +
      '<button class="btn" onclick="Inv.copyBulkPrompt()">نسخ سؤال جيميناي</button>' +
      '<span class="muted small" style="align-self:center">صوّر الرف كله، الصق هذا السؤال مع الصور، ثم الصق الرد هنا.</span>' +
      "</div>" +
      '<textarea class="inp" id="bulkBox" style="min-height:190px;font-size:13px" ' +
      'placeholder="أساسيات الهندسة لتقنيات الورش | أحمد علي | دار الفكر | جامعي | 9781234567890&#10;' +
      'الرياضيات للصف التاسع | وزارة التعليم | | مدرسي |"></textarea>' +
      '<div class="row" style="gap:10px;margin-top:10px;flex-wrap:wrap">' +
      '<div class="field"><label class="small">المكتبة</label>' +
      '<select class="inp" id="bulkLib">' +
      S().meta.libraries.map(function (L) {
        return '<option' + (L === lb.lib ? " selected" : "") + ">" + App.esc(L) + "</option>";
      }).join("") + "</select></div>" +
      '<div class="field"><label class="small">الرف</label>' +
      '<select class="inp" id="bulkShelf">' + shelfOptions().map(function (o) {
        var v = (typeof o === "object") ? o.v : o, t = (typeof o === "object") ? o.t : o;
        return '<option value="' + App.esc(v) + '"' + (String(v) === String(lb.shelf) ? " selected" : "") +
          ">" + App.esc(t) + "</option>";
      }).join("") + "</select></div>" +
      '<div class="field"><label class="small">كمية افتراضية</label>' +
      '<input class="inp num" id="bulkQty" type="text" inputmode="numeric" value="' + (App.num(lb.qty) || 1) + '"></div>' +
      "</div>" +
      '<p class="muted small" style="margin:10px 0 0;line-height:1.9">' +
      '<b>كل كتاب وكميته:</b> اكتب العدد في آخر السطر بعد علامة | الأخيرة، ' +
      'أو ألصقه بالاسم هكذا: <span class="num">الرياضيات ×5</span>. ' +
      'ما لا تكتب له عدداً يأخذ الكمية الافتراضية، وتعدّلها كلها في الخطوة التالية.</p>';

    App.modal({
      title: "لصق دفعة كتب",
      size: "wide",
      body: box,
      cancelLabel: "إلغاء",
      actions: [{
        label: "التالي — معاينة", kind: "primary", click: function (close, ov) {
          var txt = ov.querySelector("#bulkBox").value;
          var got = parseBulk(txt);
          if (!got.length) { App.toast("لم أتعرّف على أي كتاب في النص.", "warn"); return; }
          var lib = ov.querySelector("#bulkLib").value;
          var shelf = ov.querySelector("#bulkShelf").value;
          var qty = Math.max(0, Math.round(App.num(ov.querySelector("#bulkQty").value)));
          bulkRows = got.map(function (g) {
            // كمية مكتوبة مع الكتاب تغلب الافتراضية دائماً
            var q = (g.qty !== null && g.qty !== undefined && App.num(g.qty) > 0)
              ? App.num(g.qty) : qty;
            return {
              title: g.title, author: g.author || "", publisher: g.publisher || "",
              cat: g.cat || "", barcode: g.barcode || "", note: g.note || "",
              lib: lib, shelf: shelf, qty: q, cost: 0, price: 0, min: 0,
              fromText: (g.qty !== null && g.qty !== undefined && App.num(g.qty) > 0),
              dupe: !!findByTitle(g.title)
            };
          });
          close();
          bulkReview();
        }
      }]
    });
  }

  function copyBulkPrompt() {
    var ta = document.createElement("textarea");
    ta.value = BULK_PROMPT;
    ta.style.position = "fixed"; ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); App.toast("نُسخ السؤال — الصقه في جيميناي مع الصور."); }
    catch (e) { App.toast("انسخه يدوياً من المربع.", "warn"); }
    document.body.removeChild(ta);
  }

  function findByTitle(t) {
    var n = App.norm(t), hit = null;
    S().books.forEach(function (b) { if (App.norm(b.title) === n) hit = b; });
    return hit;
  }

  /* باركود السطر مستعمل لصنف آخر، أو مكرر داخل اللصق نفسه. شاشة «كتاب
     جديد» ترفضه، واللصق كان يحفظه صنفاً ثانياً بنفس الباركود — والمسح
     يأخذ الأول دائماً فلا يُباع الثاني أبداً. */
  function bulkBcClash(i) {
    var r = bulkRows[i], bc = String((r && r.barcode) || "").trim();
    if (!bc) return "";
    var hit = byBarcode(bc), mine = findByTitle(r.title);
    if (hit && !(mine && hit.it.id === mine.id)) return "مستعمل لـ«" + App.itemName(hit.it) + "»";
    for (var j = 0; j < i; j++) if (String(bulkRows[j].barcode || "").trim() === bc) return "مكرر مع السطر " + (j + 1);
    return "";
  }

  function bulkSet(i, k, v) {
    if (!bulkRows[i]) return;
    if (k === "qty" || k === "min") bulkRows[i][k] = Math.max(0, Math.round(App.num(v)));
    else if (k === "cost" || k === "price") bulkRows[i][k] = Math.max(0, App.num(v));
    else bulkRows[i][k] = v;
    if (k === "title") bulkRows[i].dupe = !!findByTitle(v);
    bulkPaintReview();
  }
  function bulkDel(i) { bulkRows.splice(i, 1); bulkPaintReview(); }

  /* Enter / الأسهم تتنقّل بين خانات الكمية بلا فأرة */
  function bulkQtyKey(e, i) {
    var step = 0;
    if (e.key === "Enter" || e.key === "ArrowDown") step = 1;
    else if (e.key === "ArrowUp") step = -1;
    else return;
    e.preventDefault();
    bulkSet(i, "qty", e.target.value);
    setTimeout(function () {
      var next = document.querySelector('.bulk-qty[data-i="' + (i + step) + '"]');
      if (next) { next.focus(); next.select(); }
    }, 0);
  }

  function bulkFocusQty() {
    var first = document.querySelector('.bulk-qty[data-i="0"]');
    if (first) { first.focus(); first.select(); }
  }

  /* تطبيق سعر أو كمية على كل الصفوف دفعة واحدة */
  /* «سعر للكل» كان يغيّر سعر الكتب المسجّلة مسبقاً أيضاً (المعاينة تقول عنها
     «ستُضاف الكمية» فقط). الأسعار للكل تخص الكتب الجديدة؛ سعر الموجود
     يُغيَّر من سطره إن أُريد. الكمية للكل تشمل الجميع (هي ما وصل فعلاً). */
  function bulkAll(k, v) {
    var skipped = 0;
    bulkRows.forEach(function (r) {
      if (k === "qty" || k === "min") r[k] = Math.max(0, Math.round(App.num(v)));
      else if (r.dupe) skipped++;
      else r[k] = Math.max(0, App.num(v));
    });
    bulkPaintReview();
    if (skipped) App.toast("طُبّق على الكتب الجديدة فقط — " + skipped + " كتاب مسجّل مسبقاً بقي بسعره (غيّره من سطره إن أردت).", "warn");
  }

  function bulkReview() {
    App.modal({
      title: "مراجعة قبل الحفظ",
      size: "wide",
      body: '<div id="bulkPrev"></div>',
      cancelLabel: "رجوع",
      actions: [{
        label: "حفظ كل الكتب", kind: "primary", click: function (close) { bulkSave(close); }
      }]
    });
    setTimeout(bulkPaintReview, 0);
  }

  function bulkPaintReview() {
    var host = document.getElementById("bulkPrev");
    if (!host) return;
    var dupes = bulkRows.filter(function (r) { return r.dupe; }).length;
    var noPrice = bulkRows.filter(function (r) { return App.num(r.price) <= 0; }).length;
    var bcBad = bulkRows.filter(function (r, i) { return !!bulkBcClash(i); }).length;

    var h = '<div class="row" style="gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:flex-end">' +
      '<span class="badge ok">' + bulkRows.length + " كتاب</span>" +
      (dupes ? '<span class="badge warn">' + dupes + " موجود مسبقاً (سيُحدَّث)</span>" : "") +
      (noPrice ? '<span class="badge bad">' + noPrice + " بلا سعر بيع</span>" : "") +
      (bcBad ? '<span class="badge bad">' + bcBad + " باركود مستعمل — صحّحه أو امسحه</span>" : "") +
      '<div class="spacer"></div>' +
      '<div class="field"><label class="small">سعر بيع للكل</label>' +
      '<input class="inp num" style="width:110px" type="text" inputmode="decimal" placeholder="—" ' +
      'onchange="Inv.bulkAll(\'price\',this.value)"></div>' +
      '<div class="field"><label class="small">سعر شراء للكل</label>' +
      '<input class="inp num" style="width:110px" type="text" inputmode="decimal" placeholder="—" ' +
      'onchange="Inv.bulkAll(\'cost\',this.value)"></div>' +
      '<div class="field"><label class="small">كمية للكل</label>' +
      '<input class="inp num" style="width:90px" type="text" inputmode="numeric" placeholder="—" ' +
      'onchange="Inv.bulkAll(\'qty\',this.value)"></div>' +
      '<button class="btn" onclick="Inv.bulkFocusQty()">اكتب الكميات</button>' +
      "</div>" +
      '<p class="muted small" style="margin:-4px 0 12px;line-height:1.8">' +
      'اضغط «اكتب الكميات» ثم اكتب عدد كل كتاب واضغط Enter للانتقال للتالي. ' +
      'الخانات الخضراء جاء عددها مع النص الملصوق.</p>';

    h += '<div style="max-height:46vh;overflow:auto">' + App.table([
      { h: "#", cls: "num", c: function (r, i) { return i + 1; } },
      {
        h: "اسم الكتاب", c: function (r, i) {
          return '<input class="inp" style="min-width:200px" value="' + App.esc(r.title) +
            '" onchange="Inv.bulkSet(' + i + ',\'title\',this.value)">' +
            (r.dupe ? '<div class="sub" style="color:var(--warn,#9C5A0E)">موجود — ستُضاف الكمية للموجود</div>' : "");
        }
      },
      {
        h: "المؤلف", c: function (r, i) {
          return '<input class="inp" style="min-width:130px" value="' + App.esc(r.author) +
            '" onchange="Inv.bulkSet(' + i + ',\'author\',this.value)">';
        }
      },
      {
        h: "الباركود", c: function (r, i) {
          // 13 رقم ISBN يحتاج هذا العرض كاملاً وإلا بدا مقصوصاً
          var cl = bulkBcClash(i);
          return '<input class="inp num" style="width:152px' + (cl ? ';border-color:var(--stamp)' : '') + '" value="' + App.esc(r.barcode) +
            '" placeholder="امسحه" onchange="Inv.bulkSet(' + i + ',\'barcode\',this.value)">' +
            (cl ? '<div class="sub" style="color:var(--stamp)">' + App.esc(cl) + "</div>" : "");
        }
      },
      {
        h: "شراء", cls: "num", c: function (r, i) {
          return '<input class="inp num" style="width:80px" type="text" inputmode="decimal" value="' + r.cost +
            '" onchange="Inv.bulkSet(' + i + ',\'cost\',this.value)">';
        }
      },
      {
        h: "بيع", cls: "num", c: function (r, i) {
          return '<input class="inp num" style="width:80px" type="text" inputmode="decimal" value="' + r.price +
            '" onchange="Inv.bulkSet(' + i + ',\'price\',this.value)">';
        }
      },
      {
        /* عمود الكمية هو ما يُملأ يدوياً غالباً، فـEnter ينتقل للصف التالي
           ويحدّد محتواه — تكتب 15 ثم Enter ثم 8 ثم Enter بلا لمس الفأرة. */
        h: "كمية", cls: "num", c: function (r, i) {
          return '<input class="inp num bulk-qty" data-i="' + i + '" style="width:74px' +
            (r.fromText ? ';border-color:var(--ok,#1F6F4A)' : '') + '" type="text" inputmode="numeric" value="' + r.qty +
            '" title="' + (r.fromText ? 'العدد جاء مع النص' : 'الكمية الافتراضية') +
            '" onchange="Inv.bulkSet(' + i + ',\'qty\',this.value)"' +
            ' onkeydown="Inv.bulkQtyKey(event,' + i + ')">';
        }
      },
      {
        h: "", cls: "act", c: function (r, i) {
          return '<button class="btn sm ghost" onclick="Inv.bulkDel(' + i + ')">حذف</button>';
        }
      }
    ], bulkRows, { emptyTitle: "لا كتب", emptyText: "ارجع والصق النص من جديد." }) + "</div>";

    host.innerHTML = h;
  }

  function bulkSave(close) {
    if (!bulkRows.length) { App.toast("لا كتب للحفظ.", "warn"); return; }
    for (var bi = 0; bi < bulkRows.length; bi++) {
      var cl = bulkBcClash(bi);
      if (cl) { App.toast("السطر " + (bi + 1) + ": الباركود " + cl + ". صحّحه أو امسحه ثم احفظ.", "warn"); return; }
    }
    var added = 0, upd = 0, ids = [];

    bulkRows.forEach(function (r) {
      if (!String(r.title).trim()) return;
      var ex = findByTitle(r.title);
      if (ex) {
        // كتاب موجود: نضيف الكمية ولا ندهس أسعاره إلا إن كتبت جديدة
        ex.qty = App.num(ex.qty) + App.num(r.qty);
        if (App.num(r.cost) > 0) ex.cost = App.num(r.cost);
        if (App.num(r.price) > 0) ex.price = App.num(r.price);
        if (r.barcode && !ex.barcode) ex.barcode = r.barcode;
        ex.updated = App.nowStamp();
        ids.push(ex.id);
        upd++;
        return;
      }
      var o = {
        id: App.uid(), code: App.nextCode("book"),
        title: String(r.title).trim(), author: r.author || "", publisher: r.publisher || "",
        supplierId: "", lib: r.lib || "", shelf: r.shelf || "", cat: r.cat || "",
        barcode: r.barcode || "", cost: App.num(r.cost), price: App.num(r.price),
        priceW: 0, qty: App.num(r.qty), min: App.num(r.min), note: r.note || "",
        created: App.nowStamp(), updated: App.nowStamp()
      };
      if (r.cat) addCatIfNew("bookCats", r.cat);
      S().books.push(o);
      ids.push(o.id);
      added++;
    });

    App.log("لصق دفعة", "أضيف " + added + " وحُدّث " + upd + " كتاباً");
    App.save();
    if (close) close();
    App.rerender();
    App.toast("حُفظ: " + added + " جديد، " + upd + " محدَّث.");

    // الخطوة التالية طبيعياً: اللاصقات لمن يحتاجها
    if (ids.length && typeof Labels !== "undefined") {
      var need = ids.filter(function (id) {
        var it = App.findItem("book", id);
        return it && !Labels.hasPrinted(it);
      });
      if (need.length) {
        App.confirm(need.length + " من الكتب ليس عليها باركود مطبوع وتحتاج لاصقات.\n\n" +
          "هل نطبعها الآن؟", function () { Labels.forItems(need); }, { yes: "اطبع اللاصقات" });
      } else {
        App.toast("كل الكتب لها باركود مطبوع — لا تحتاج لاصقات.");
      }
    }
    bulkRows = [];
  }

  function addCatIfNew(listKey, val) {
    var arr = S().meta[listKey];
    if (Array.isArray(arr) && val && arr.indexOf(val) < 0) arr.push(val);
  }

  function smartPaste() {
    var box = document.createElement("div");
    box.innerHTML =
      '<p class="muted small" style="margin-top:0;line-height:1.8">انسخ رد جيميناي كاملاً والصقه هنا — سيوزّعه البرنامج على الحقول وحده. ' +
      "يفهم: اسم الكتاب · المؤلف · دار النشر · التصنيف · الباركود · ملاحظة.</p>" +
      '<textarea class="inp" id="pasteBox" style="min-height:220px;font-size:14px" ' +
      'placeholder="اسم الكتاب:&#10;Drugs for Dentistry&#10;أسماء المؤلفين:&#10;Dr. Abdullah Nasr Yosef&#10;تصنيف الكتاب:&#10;طب الأسنان"></textarea>' +
      '<div id="pastePrev" style="margin-top:12px"></div>';

    App.modal({
      title: "لصق بيانات الكتاب دفعة واحدة",
      body: box,
      cancelLabel: "إلغاء",
      actions: [{
        label: "املأ الحقول", kind: "primary", click: function (close, ov) {
          var txt = ov.querySelector("#pasteBox").value;
          if (!String(txt).trim()) { App.toast("الصق النص أولاً.", "warn"); return; }
          var got = parsePasted(txt);
          if (!got.title) { App.toast("لم أتعرّف على اسم الكتاب.", "warn"); return; }

          var scope = fmScope();
          if (!scope) { App.toast("افتح نموذج الكتاب أولاً.", "warn"); return; }
          var filled = [];
          ["title", "author", "barcode", "note"].forEach(function (k) {
            if (got[k]) { App.setField(scope, k, got[k]); filled.push(k); }
          });
          // التصنيف ودار النشر قائمتان: نضيف الجديد إن لم يكن موجوداً
          if (got.cat) {
            addOption(scope, "cat", got.cat, "bookCats");
            App.setField(scope, "cat", got.cat);
            filled.push("cat");
          }
          if (got.publisher) {
            var sel = scope.querySelector("#f_publisher");
            var found = null;
            pubList().forEach(function (p2) { if (App.norm(p2.name) === App.norm(got.publisher)) found = p2; });
            if (found && sel) { sel.value = found.name; filled.push("publisher"); }
            else App.toast("دار النشر «" + got.publisher + "» غير مسجّلة — أضفها من القائمة.", "warn");
          }
          close();
          App.toast("مُلئ " + filled.length + " حقلاً. راجعها وأكمل الأسعار.");
        }
      }]
    });
  }

  var _fm = null;
  function fmScope() {
    var all = document.querySelectorAll(".overlay");
    for (var i = 0; i < all.length; i++) {
      if (all[i].querySelector("#f_title") || all[i].querySelector("#f_name")) return all[i];
    }
    return null;
  }

  function addOption(scope, field, value, metaKey) {
    var sel = scope.querySelector("#f_" + field);
    if (!sel || sel.tagName !== "SELECT") return;
    var exists = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (App.norm(sel.options[i].value) === App.norm(value)) { exists = true; break; }
    }
    if (!exists) {
      var o = document.createElement("option");
      o.value = value; o.textContent = value;
      sel.appendChild(o);
      var arr = S().meta[metaKey] || [];
      var inMeta = false;
      arr.forEach(function (x) { if (App.norm(x) === App.norm(value)) inMeta = true; });
      if (!inMeta && metaKey === "bookCats") { arr.push(value); S().meta[metaKey] = arr; App.save(); }
    }
  }

  /* التصنيفات: المسجّلة في الإعدادات + المستعملة فعلاً + آخر قيمة */
  function catOptions(type, sticky) {
    var base = (type === "book") ? S().meta.bookCats : S().meta.statCats;
    var out = [""], seen = { "": 1 };
    (base || []).concat(uniq(App.listOf(type), "cat")).concat(sticky ? [sticky] : []).forEach(function (c) {
      var v = String(c || "").trim();
      if (v && !seen[App.norm(v)]) { seen[App.norm(v)] = 1; out.push(v); }
    });
    return out;
  }

  function authorList() { return uniq(S().books, "author"); }

  function uniq(arr, key) {
    var seen = {}, out = [];
    arr.forEach(function (x) {
      var v = String(x[key] || "").trim();
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out.sort();
  }

  /* ============================================================
     القرطاسية
     ============================================================ */

  function stationery() {
    var h = '<div class="row" style="margin-bottom:14px">' +
      '<div class="search-wrap"><span class="mag">⌕</span>' +
      '<input class="inp" id="sq" placeholder="ابحث أو امسح الباركود…" value="' + App.esc(g.q) + '" oninput="Inv.setG(\'q\',this.value)"></div>' +

      '<select class="inp" style="width:auto" onchange="Inv.setG(\'cat\',this.value)"><option value="">كل التصنيفات</option>' +
      S().meta.statCats.map(function (c) { return '<option value="' + App.esc(c) + '"' + (g.cat === c ? " selected" : "") + ">" + App.esc(c) + "</option>"; }).join("") + "</select>" +

      '<select class="inp" style="width:auto" onchange="Inv.setG(\'st\',this.value)">' +
      '<option value="">كل الحالات</option>' +
      '<option value="low"' + (g.st === "low" ? " selected" : "") + ">قاربت على النفاد</option>" +
      '<option value="out"' + (g.st === "out" ? " selected" : "") + ">نفدت</option></select>" +

      '<div class="spacer"></div>' +
      '<div class="seg" style="width:190px">' +
      '<button class="' + (g.view !== "cards" ? "on" : "") + '" onclick="Inv.setG(\'view\',\'table\')">جدول</button>' +
      '<button class="' + (g.view === "cards" ? "on" : "") + '" onclick="Inv.setG(\'view\',\'cards\')">بطاقات</button>' +
      "</div>" +
      '<button class="btn" onclick="Inv.exportGoods(\'stat\')">تصدير Excel</button>' +
      '<button class="btn" onclick="Inv.importItems(\'stat\')">استيراد</button>' +
      '<button class="btn primary" onclick="Inv.editStat()">+ صنف جديد</button>' +
      "</div>" +
      '<div class="card"><div id="invBody"></div></div>';
    setTimeout(function () { paintStat(); bindScan("sq"); }, 0);
    return h;
  }

  function paintStat() {
    var host = document.getElementById("invBody");
    if (!host) return;
    var rows = App.rank(S().stationery.filter(function (p) {
      if (g.cat && p.cat !== g.cat) return false;
      if (g.st && App.stockState(p) !== g.st) return false;
      return true;
    }), g.q, function (p) {
      return [p.name, p.code, p.barcode, p.brand, p.cat];
    });

    if (g.view === "cards") {
      host.innerHTML = '<div class="card-body">' + cardsHtml(rows, "stat") + "</div>";
      return;
    }

    host.innerHTML = App.table([
      {
        h: "الصنف", c: function (p) {
          return '<div class="name">' + lblMark(p) + App.esc(p.name) + "</div>" +
            '<div class="sub">' + App.esc(p.brand || "") + (p.unit ? " · " + App.esc(p.unit) : "") + "</div>";
        }
      },
      { h: "التصنيف", c: catBadge },
      { h: "المكان", c: function (p) { return p.loc ? App.esc(p.loc) : '<span class="muted">—</span>'; } },
      { h: "الرمز", c: function (p) { return '<span class="num small">' + App.esc(p.barcode || p.code || "") + "</span>"; } },
      App.canProfit() ? { h: "الجملة", cls: "num", c: function (p) { return App.money0(p.cost); } } : null,
      { h: "البيع", cls: "num", c: function (p) { return "<b>" + App.money0(p.price) + "</b>"; } },
    ].concat(qtyCols(), [
      { h: "الحالة", c: shelfBadge },
      {
        h: "", cls: "act", c: function (p) {
          return '<button class="btn sm" onclick="Inv.addStock(\'stat\',\'' + p.id + '\')">+ كمية</button> ' +
            '<button class="btn sm" onclick="Inv.move(\'stat\',\'' + p.id + '\')" title="نقل بين المخزن والرفوف">⇄ نقل</button> ' +
            '<button class="btn sm" onclick="Inv.editStat(\'' + p.id + '\')">تعديل</button> ' +
            '<button class="btn sm ghost" onclick="Labels.one(\'stat\',\'' + p.id + '\')" title="طباعة لاصقة باركود">⌷ لاصقة</button> ' +
            '<button class="btn sm ghost" onclick="Inv.del(\'stat\',\'' + p.id + '\')">حذف</button>';
        }
      }
    ]), rows, {
      lazy: 60,
      rowClass: function (p) { var s = App.stockState(p); return s === "out" ? "out" : (s === "low" ? "low" : ""); },
      emptyIcon: "box",
      emptyTitle: S().stationery.length ? "لا نتيجة مطابقة" : "لم تُضف أي أصناف قرطاسية بعد",
      emptyText: S().stationery.length ? "جرّب تغيير البحث." : "أضف أول صنف — قلم، دفتر، رزمة ورق…",
      emptyAction: S().stationery.length ? "" : '<button class="btn primary" onclick="Inv.editStat()">+ إضافة صنف</button>'
    });
  }

  function editStat(id) {
    var p = id ? App.findItem("stat", id) : null;
    var ls = S().meta.lastStat || {};
    dupOK = false;
    newDest = "shelf";
    var fs2 = App.form({
      title: p ? "تعديل صنف" : "صنف قرطاسية جديد",
      size: "wide",
      topHtml: p ? "" : '<div style="margin-bottom:14px">' + destTabs("shelf", "Inv.setNewDest") + "</div>",
      values: p || {
        unit: ls.unit || "قطعة", cat: ls.cat || "", loc: ls.loc || "",
        qty: App.num(ls.qty) || 2, min: 0
      },
      onChange: function (key, val, scope) {
        if (key === "supplierId" && val === "__new__") { App.setField(scope, "supplierId", ""); newSupplier(scope); }
      },
      fields: [
        { k: "name", label: "اسم الصنف", required: true, full: true },
        { k: "cat", label: "التصنيف", type: "select", options: catOptions("stat", ls.cat) },
        { k: "brand", label: "الماركة", list: uniq(S().stationery, "brand") },
        {
          k: "supplierId", label: "المورّد", type: "select",
          options: [{ v: "", t: "— بدون —" }].concat(S().suppliers.map(function (x) {
            return { v: x.id, t: x.name + (x.phone ? " · " + x.phone : "") };
          })).concat([{ v: "__new__", t: "➕ إضافة مورّد جديد…" }])
        },
        { k: "unit", label: "وحدة البيع", type: "select", options: S().meta.units },
        { k: "loc", label: "المكان في المحل", list: uniq(S().stationery, "loc"), hint: "مثال: الرف الزجاجي / الدرج 2" },
        /* ليس إلزامياً: يُسجَّل الكتاب بلا باركود، ويُولَّد له رمز عند
           طباعة لاصقته من تبويب «طباعة اللاصقات». */
        { k: "barcode", label: "الباركود", hint: "امسحه بالقارئ، أو اتركه فارغاً ليُولَّد عند طباعة اللاصقة" },
        { k: "cost", label: "سعر الشراء من المورّد", type: "money", min: 0 },
        { k: "price", label: "سعر البيع قطاعي", type: "money", min: 0, required: true, hint: "اكتبه واختر دار النشر ليُحسب سعر الجملة" },
        { k: "priceW", label: "سعر البيع جملة", type: "money", min: 0, hint: "يُحسب تلقائياً من نسبة دار النشر — أو اكتبه بيدك" },
        { k: "qty", label: p ? "الكمية الحالية (كلها)" : "الكمية", type: "number", min: 0, hint: p ? "على الرفوف + في غرفة الخزين" : "تذهب إلى المكان المختار بالأعلى" },
        p ? { k: "store", label: "منها في غرفة الخزين", type: "number", min: 0, hint: "الباقي يُحسب على الرفوف" } : null,
        { k: "min", label: "حد التنبيه", type: "number", min: 0 },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        ["cost", "price", "priceW", "qty", "min"].forEach(function (k) {
          if (App.num(v[k]) < 0) v[k] = 0;
        });
        // المخزن جزء من الكمية: لا يزيد عليها ولا يقلّ عن صفر
        v.store = Math.min(Math.max(Math.floor(App.num(v.store)), 0), Math.max(App.num(v.qty), 0));
        if (!p) v.store = newDest === "store" ? Math.max(App.num(v.qty), 0) : 0;
        var bc2 = String(v.barcode || "").trim();
        if (bc2) {
          var clash2 = null;
          App.allItems().forEach(function (x) {
            if (clash2 || (p && x.it.id === p.id)) return;
            if (String(x.it.barcode || "").trim() === bc2) clash2 = x;
          });
          if (clash2) {
            App.toast("هذا الباركود مستعمل في: " + App.itemName(clash2.it), "bad");
            return false;
          }
        }
        if (!p && !dupOK) {
          var dd = findDupes("stat", v.name, v.barcode, null);
          if (dd.length) { showDupes("stat", dd, fs2); return false; }
        }
        S().meta.lastStat = { cat: v.cat, loc: v.loc, unit: v.unit, qty: App.num(v.qty) || 2, min: 0 };
        if (p) {
          Object.keys(v).forEach(function (k) { p[k] = v[k]; });
          p.updated = App.nowStamp();
          App.log("تعديل صنف", p.name);
          App.toast("حُفظت تعديلات: " + p.name);
        } else {
          v.id = App.uid();
          v.code = App.nextCode("stat");
          v.created = v.updated = App.nowStamp();
          S().stationery.unshift(v);
          App.log("إضافة صنف", v.name);
          App.toast("أُضيف الصنف: " + v.name);
        }
        App.save(); App.rerender();
      }
    });
  }

  /* ---------- عام ---------- */

  function del(type, id) {
    var it = App.findItem(type, id);
    if (!it) return;
    App.confirm("سيُحذف «" + App.itemName(it) + "» نهائياً من المخزون. الفواتير القديمة تبقى كما هي.",
      function () {
        var a = App.listOf(type);
        a.splice(a.indexOf(it), 1);
        App.log("حذف صنف", App.itemName(it));
        App.save(); App.rerender();
        App.toast("حُذف: " + App.itemName(it));
      }, { danger: true, yes: "حذف" });
  }

  /* ---------- تبويبا «إضافة للرفوف» و«إضافة للمخزن» ----------
     أعلى كل نافذة تُدخل كمية: كمية جديدة، إدخال بضاعة، كتاب أو صنف
     جديد. «للرفوف» هو المختار دائماً عند الفتح — لا يتذكّر «المخزن». */
  function destTabs(cur, click) {
    return '<div class="seg dest-tabs">' +
      [["shelf", "إضافة للرفوف"], ["store", "إضافة للمخزن"]].map(function (d) {
        return '<button type="button" data-to="' + d[0] + '" class="' + (cur === d[0] ? "on" : "") + '"' +
          (click ? ' onclick="' + click + "('" + d[0] + "',this)\"" : "") + ">" + d[1] + "</button>";
      }).join("") + "</div>";
  }
  function markTab(btn) {
    Array.prototype.forEach.call(btn.parentNode.children, function (b) { b.classList.toggle("on", b === btn); });
  }
  var newDest = "shelf";           // وجهة كمية الكتاب/الصنف الجديد
  function setNewDest(k, btn) { newDest = k; if (btn) markTab(btn); }

  function addStock(type, id) {
    var it = App.findItem(type, id);
    if (!it) return;
    var to = "shelf";
    var body = destTabs(to) +
      '<div class="field" style="margin-top:14px"><label>الكمية الواصلة</label>' +
      '<input class="inp num big-num" id="asAdd" type="number" min="1" value="1"></div>' +
      '<div class="field"><label>سعر الجملة الجديد</label>' +
      '<input class="inp num" id="asCost" type="number" min="0" step="0.01" value="' + App.num(it.cost) + '">' +
      '<div class="hint">اتركه كما هو إن لم يتغير</div></div>' +
      '<div class="rs-after" id="asNow"></div>';

    var m = App.modal({
      title: "إضافة كمية — " + App.itemName(it), size: "narrow", body: body,
      actions: [{ label: "إضافة للرفوف", kind: "primary", click: function (close) { if (save()) close(); } }],
      cancelLabel: "إلغاء"
    });
    var el = function (i) { return m.el.querySelector("#" + i); };
    function add() { return Math.max(0, Math.floor(App.num(el("asAdd").value))); }
    function paint() {
      var a = add(), ts = to === "store" ? a : 0;
      el("asNow").innerHTML = afterBoxes(App.shelfQty(it) + a - ts, App.storeQty(it) + ts, App.shelfQty(it), App.storeQty(it));
      var btn = m.el.querySelector(".m-foot .btn.primary");
      if (btn) btn.textContent = to === "store" ? "إضافة للمخزن" : "إضافة للرفوف";
    }
    m.el.querySelector(".dest-tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      to = b.getAttribute("data-to"); markTab(b); paint();
      el("asAdd").focus();
    });
    el("asAdd").addEventListener("input", paint);
    m.el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); if (save()) m.close(); }
    });
    function save() {
      var a = add();
      if (a <= 0) { App.toast("اكتب الكمية الواصلة.", "warn"); return false; }
      var ts = to === "store" ? a : 0;
      App.receiveStock(it, a, ts);
      var c = App.num(el("asCost").value);
      if (c > 0) it.cost = c;
      it.updated = App.nowStamp();
      App.log("إضافة كمية", App.itemName(it) + " +" + a + (ts ? " (للمخزن)" : ""));
      App.save(); App.rerender();
      App.toast("أُضيفت " + a + (ts ? " للمخزن" : " للرفوف") + " — على الرفوف " + App.shelfQty(it) + " · في المخزن " + App.storeQty(it));
      return true;
    }
    paint();
  }

  /* مربّعا «قبل ⇦ بعد» للرفوف والمخزن */
  function afterBoxes(sh, st, sh0, st0) {
    function box(lbl, v, v0, cls) {
      return '<div class="mv-box ' + cls + '"><div class="t">' + lbl + "</div>" +
        '<div class="n">' + (v !== v0 ? "<s>" + v0 + "</s>" : "") + '<span class="v">' + v + "</span></div></div>";
    }
    return '<div class="mv-row">' + box("على الرفوف", sh, sh0, "acc") + box("في المخزن", st, st0, "") + "</div>";
  }

  /* ---------- نقل بين غرفة الخزين والرفوف ---------- */
  function move(type, id, dir, n) {
    var it = App.findItem(type, id);
    if (!it) return;
    var st0 = App.storeQty(it), sh0 = App.shelfQty(it);
    dir = dir || (st0 > 0 ? "in" : "out");
    var body =
      '<div class="mv-title">' + App.esc(App.itemName(it)) + "</div>" +
      '<div class="field"><div class="seg" id="mvDir">' +
      '<button type="button" data-d="in">من المخزن ⇦ إلى الرفوف</button>' +
      '<button type="button" data-d="out">من الرفوف ⇦ إلى المخزن</button></div></div>' +
      '<div class="field"><label>كم نسخة تنقل؟</label>' +
      '<input class="inp num big-num" id="mvN" type="number" min="1" value="' + (n || 1) + '"></div>' +
      '<div id="mvBoxes"></div><div class="hint center" id="mvHint"></div>';
    var m = App.modal({
      title: "نقل بين المخزن والرفوف", size: "narrow", body: body,
      actions: [{ label: "نقل", kind: "primary", click: function (close) { if (go()) close(); } }],
      cancelLabel: "إلغاء"
    });
    var q = function (i) { return m.el.querySelector("#" + i); };
    function avail() { return dir === "in" ? st0 : Math.max(sh0, 0); }
    function cnt() { return Math.max(0, Math.floor(App.num(q("mvN").value))); }
    function paint() {
      Array.prototype.forEach.call(q("mvDir").children, function (b) { b.classList.toggle("on", b.getAttribute("data-d") === dir); });
      var k = Math.min(cnt(), avail());
      var sh = dir === "in" ? sh0 + k : sh0 - k, st = dir === "in" ? st0 - k : st0 + k;
      q("mvBoxes").innerHTML = afterBoxes(sh, st, sh0, st0);
      var over = cnt() > avail();
      q("mvHint").className = "hint center" + (over ? " bad" : "");
      q("mvHint").textContent = !avail()
        ? (dir === "in" ? "لا توجد نسخ في المخزن." : "لا توجد نسخ على الرفوف.")
        : over ? "المتاح للنقل " + avail() + " فقط — سيُنقل " + avail() + "."
        : "المجموع يبقى " + App.num(it.qty) + " — يتغيّر المكان فقط، ويُسجَّل النقل في سجل العمليات.";
      var btn = m.el.querySelector(".m-foot .btn.primary");
      if (btn) btn.textContent = !k ? "نقل" : k === 1 ? "نقل نسخة واحدة" : k === 2 ? "نقل نسختين" : "نقل " + k + " نسخ";
    }
    q("mvDir").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (b) { dir = b.getAttribute("data-d"); paint(); }
    });
    q("mvN").addEventListener("input", paint);
    m.el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); if (go()) m.close(); }
    });
    function go() {
      var done = App.moveStock(it, cnt(), dir);
      if (!done) { App.toast(avail() ? "اكتب عدد النسخ." : "لا يوجد ما يُنقل.", "warn"); return false; }
      App.save(); App.rerender();
      App.toast("نُقلت " + done + (dir === "in" ? " إلى الرفوف" : " إلى المخزن") +
        " — الرفوف " + App.shelfQty(it) + " · المخزن " + App.storeQty(it));
      return true;
    }
    paint();
  }

  function setF(k, v) { f[k] = v; if (k === "view") App.rerender(); else paintBooks(); }
  function setG(k, v) { g[k] = v; paintStat(); }

  /* ============================================================
     التنبيهات
     ============================================================ */

  function alerts() {
    var rows = App.allItems().filter(function (x) { return App.stockState(x.it) !== "ok"; });
    rows.sort(function (a, b) { return App.num(a.it.qty) - App.num(b.it.qty); });

    var out = rows.filter(function (x) { return App.stockState(x.it) === "out"; }).length;
    var low = rows.length - out;

    var h = '<div class="grid g3" style="margin-bottom:16px">' +
      '<div class="card stat bad"><div class="lbl">أصناف نفدت تماماً</div><div class="val">' + out + "</div>" +
      '<div class="foot">لا يمكن بيعها الآن</div></div>' +
      '<div class="card stat warn"><div class="lbl">قاربت على النفاد</div><div class="val">' + low + "</div>" +
      '<div class="foot">وصلت لحد التنبيه أو أقل</div></div>' +
      '<div class="card stat accent"><div class="lbl">قيمة النقص المطلوب شراؤه</div><div class="val">' +
      App.money0(rows.reduce(function (s, x) {
        var need = Math.max(App.num(x.it.min) - App.num(x.it.qty), 1);
        return s + need * App.num(x.it.cost);
      }, 0)) + '</div><div class="foot">تقدير بسعر الجملة</div></div></div>';

    h += restockCard();

    h += '<div class="card"><div class="card-head"><h3>قائمة الشراء المقترحة</h3><div class="spacer"></div>' +
      '<button class="btn sm" onclick="Inv.printShoppingList()">طباعة القائمة</button></div>';

    h += App.table([
      {
        h: "الصنف", c: function (x) {
          return '<div class="name">' + App.esc(App.itemName(x.it)) + "</div>" +
            '<div class="sub">' + (x.type === "book" ? "كتاب" : "قرطاسية") +
            (x.it.author ? " · " + App.esc(x.it.author) : "") + "</div>";
        }
      },
      { h: "الموقع", c: function (x) { return x.type === "book" ? App.locChip(x.it) : App.esc(x.it.loc || "—"); } },
      { h: "المتبقي", cls: "num", c: function (x) { return "<b>" + App.num(x.it.qty) + "</b>"; } },
      { h: "حد التنبيه", cls: "num", c: function (x) { return App.num(x.it.min); } },
      {
        h: "المقترح شراؤه", cls: "num", c: function (x) {
          return "<b>" + Math.max(App.num(x.it.min) * 2 - App.num(x.it.qty), 1) + "</b>";
        }
      },
      { h: "الحالة", c: function (x) { return App.stockBadge(x.it); } },
      {
        h: "", cls: "act", c: function (x) {
          return '<button class="btn sm primary" onclick="Inv.addStock(\'' + x.type + '\',\'' + x.it.id + '\')">+ كمية</button>';
        }
      }
    ], rows, {
      rowClass: function (x) { return App.stockState(x.it) === "out" ? "out" : "low"; },
      emptyIcon: "check",
      emptyTitle: "كل شيء متوفر",
      emptyText: "لا يوجد صنف وصل حد التنبيه. تُحدَّث هذه الصفحة تلقائياً بعد كل عملية بيع."
    });
    return h + "</div>";
  }

  /* ---------- «املأ الرفوف» ----------
     أصناف نفدت أو قلّت على الرفوف ولها نسخ في غرفة الخزين: ليست
     نقصاً يُشترى، بل شيء يُجلب من الغرفة. */
  function restockCard() {
    var list = App.restockList();
    if (!list.length) return "";
    return '<div class="card restock" style="margin-bottom:16px"><div class="card-head">' +
      "<h3>املأ الرفوف — " + list.length + " صنف في المخزن وليس على الرفوف</h3><div class=\"spacer\"></div>" +
      '<button class="btn sm" onclick="Inv.printPickList()">اطبع قائمة السحب</button>' +
      '<button class="btn sm primary" onclick="Inv.restockAll()">انقل المقترح كله</button></div>' +
      App.table([
        {
          h: "الصنف", c: function (x) {
            return '<div class="name">' + App.esc(App.itemName(x.it)) + "</div>" +
              '<div class="sub">' + (x.type === "book" ? "كتاب" : "قرطاسية") + (x.it.author ? " · " + App.esc(x.it.author) : "") + "</div>";
          }
        },
        { h: "الموقع", c: function (x) { return x.type === "book" ? App.locChip(x.it) : App.esc(x.it.loc || "—"); } },
        { h: "على الرفوف", cls: "num", c: function (x) { return '<b class="' + (x.shelf <= 0 ? "q-bad" : "") + '">' + x.shelf + "</b>"; } },
        { h: "في المخزن", cls: "num", c: function (x) { return "<b>" + x.store + "</b>"; } },
        {
          h: "", cls: "act", c: function (x) {
            return '<button class="btn sm primary" onclick="Inv.move(\'' + x.type + "','" + x.it.id + "','in'," + x.suggest + ')">⇦ نقل ' + x.suggest + "</button>";
          }
        }
      ], list, { lazy: 60 }) + "</div>";
  }

  function restockAll() {
    var list = App.restockList();
    if (!list.length) return;
    var n = list.reduce(function (a, x) { return a + x.suggest; }, 0);
    App.confirm("سيُنقل " + n + " نسخة من غرفة الخزين إلى الرفوف (" + list.length + " صنف)، حسب العدد المقترح لكل صنف.", function () {
      var moved = 0;
      list.forEach(function (x) { moved += App.moveStock(x.it, x.suggest, "in"); });
      App.save(); App.rerender();
      if (App.celebrate) App.celebrate("نُقلت إلى الرفوف", moved + " نسخة");
    }, { yes: "نقل " + n + " نسخة" });
  }

  function printPickList() {
    var list = App.restockList();
    if (!list.length) { App.toast("لا يوجد ما يُجلب من المخزن."); return; }
    var h = '<div class="receipt a4"><h2>' + App.esc(S().meta.shopName || "المحل") + "</h2>" +
      '<div class="c">قائمة السحب من غرفة الخزين — ' + App.dateAr(App.today()) + "</div><hr>" +
      "<table><thead><tr><th>✓</th><th>الصنف</th><th>يوضع في</th><th>في المخزن</th><th>اجلب</th></tr></thead><tbody>";
    list.forEach(function (x) {
      h += "<tr><td>☐</td><td>" + App.esc(App.itemName(x.it)) + "</td><td>" +
        (x.type === "book" ? App.esc((x.it.lib || "") + " / رف " + (x.it.shelf || "")) : App.esc(x.it.loc || "")) +
        '</td><td class="num">' + x.store + '</td><td class="num"><b>' + x.suggest + "</b></td></tr>";
    });
    h += "</tbody></table></div>";
    App.printHtml(h);
  }

  function printShoppingList() {
    var rows = App.allItems().filter(function (x) { return App.stockState(x.it) !== "ok"; });
    if (!rows.length) { App.toast("لا يوجد نقص للطباعة."); return; }
    var h = '<div class="receipt a4"><h2>' + App.esc(S().meta.shopName || "المحل") + "</h2>" +
      '<div class="c">قائمة الشراء — ' + App.dateAr(App.today()) + "</div><hr>" +
      "<table><thead><tr><th>الصنف</th><th>الموقع</th><th>المتبقي</th><th>المطلوب</th></tr></thead><tbody>";
    rows.forEach(function (x) {
      h += "<tr><td>" + App.esc(App.itemName(x.it)) + "</td><td>" +
        (x.type === "book" ? App.esc((x.it.lib || "") + " / رف " + (x.it.shelf || "")) : App.esc(x.it.loc || "")) +
        '</td><td class="num">' + App.num(x.it.qty) + '</td><td class="num">' +
        Math.max(App.num(x.it.min) * 2 - App.num(x.it.qty), 1) + "</td></tr>";
    });
    h += "</tbody></table></div>";
    App.printHtml(h);
  }

  /* ============================================================
     إدخال بضاعة (المشتريات)
     ============================================================ */

  /* ============================================================
     إدخال البضاعة — تبويب واحد يجمع: بضاعة جديدة · إضافة كمية · عرض
     ============================================================ */

  var gd = { mode: "new", type: "book" };

  function goods() {
    var h = '<div class="card" style="margin-bottom:18px"><div class="card-body">' +
      '<div class="grid g2">' +
      '<div class="field"><label>ماذا تريد؟</label><div class="seg">' +
      '<button class="' + (gd.mode === "new" ? "on" : "") + '" onclick="Inv.gset(\'mode\',\'new\')">بضاعة جديدة</button>' +
      '<button class="' + (gd.mode === "qty" ? "on" : "") + '" onclick="Inv.gset(\'mode\',\'qty\')">إضافة كمية</button>' +
      '<button class="' + (gd.mode === "view" ? "on" : "") + '" onclick="Inv.gset(\'mode\',\'view\')">عرض وتعديل</button>' +
      "</div></div>" +
      ('<div class="field"><label>النوع</label><div class="seg">' +
      '<button class="' + (gd.type === "book" ? "on" : "") + '" onclick="Inv.gset(\'type\',\'book\')">كتب</button>' +
      '<button class="' + (gd.type === "stat" ? "on" : "") + '" onclick="Inv.gset(\'type\',\'stat\')">قرطاسية</button>' +
      "</div></div>") + "</div></div></div>";

    if (gd.mode === "new") return h + newGoods();
    if (gd.mode === "qty") return h + purchases();
    return h + (gd.type === "book" ? books() : stationery());
  }

  function gset(k, v) { gd[k] = v; App.rerender(); }

  /* ============================================================
     نقل بالقارئ بين غرفة الخزين والرفوف — مثل الجرد: تحمل الكرتونة
     وتمسح النسخ واحدة واحدة، ثم تؤكّد مرة واحدة.
     ============================================================ */
  var mv = { dir: "in", lines: [] };

  function moveScreen() {
    var h = '<div class="card mv-screen" style="margin-bottom:18px"><div class="card-head">' +
      "<h3>نقل بين غرفة الخزين والرفوف</h3><div class=\"spacer\"></div>" +
      '<span class="muted small">كل مسحة = نسخة واحدة. لا يتغيّر شيء حتى تضغط «تأكيد النقل».</span></div>' +
      '<div class="card-body">' +
      '<div class="seg" style="margin-bottom:14px">' +
      '<button class="' + (mv.dir === "in" ? "on" : "") + '" onclick="Inv.mvSet(\'in\')">من المخزن ⇦ إلى الرفوف</button>' +
      '<button class="' + (mv.dir === "out" ? "on" : "") + '" onclick="Inv.mvSet(\'out\')">من الرفوف ⇦ إلى المخزن</button></div>' +
      '<div style="position:relative"><input class="big-input" id="mvScan" autocomplete="off" style="width:100%" ' +
      'placeholder="امسح باركود النسخة التي تحملها، أو اكتب اسمها ثم Enter…" oninput="Inv.mvSuggest(this.value)">' +
      '<div id="mvSug"></div></div>' +
      '<div id="mvLines"></div></div></div>';
    setTimeout(function () {
      var el = document.getElementById("mvScan");
      if (el) { App.scanField(el, mvEnter); el.focus(); }
      paintMv();
    }, 0);
    return h;
  }

  function mvSet(d) { mv.dir = d; App.rerender(); }

  function mvAvail(x) { return mv.dir === "in" ? App.storeQty(x) : Math.max(App.shelfQty(x), 0); }

  function mvEnter(v, el) {
    if (!v) return;
    var res = byBarcode(v) ? null : searchItems(v, 1);
    var hit = byBarcode(v) || (App.exactCount(res) ? res[0] : null);
    if (!hit && res && res.length) { mvSuggest(v); App.toast("ما لقيناش «" + v + "» بالضبط — اختر من «هل تقصد؟».", "warn"); return; }
    if (!hit) { App.toast("لم يُعثر على «" + v + "».", "warn"); return; }
    mvPick(hit.type, hit.it.id);
    if (el) el.value = "";
  }

  function mvPick(type, id) {
    var it = App.findItem(type, id);
    if (!it) return;
    var ln = null, idx = -1;
    mv.lines.forEach(function (l, i) { if (l.type === type && l.id === id) { ln = l; idx = i; } });
    var have = ln ? ln.n : 0;
    if (have + 1 > mvAvail(it)) {
      App.toast((mv.dir === "in" ? "لا نسخة أخرى في المخزن من: " : "لا نسخة أخرى على الرفوف من: ") + App.itemName(it), "warn");
    } else if (ln) ln.n++;
    else { mv.lines.unshift({ type: type, id: id, n: 1 }); idx = 0; }
    var sug = document.getElementById("mvSug"); if (sug) sug.innerHTML = "";
    var s2 = document.getElementById("mvScan"); if (s2) { s2.value = ""; s2.focus(); }
    paintMv(idx < 0 ? 0 : idx);
  }

  function mvSuggest(q) {
    var host = document.getElementById("mvSug");
    if (!host) return;
    var res = searchItems(q, 8);
    if (!res.length || q.length < 2) { host.innerHTML = ""; return; }
    host.innerHTML = '<div class="suggest">' + res.map(function (x, i) {
      return App.sugHead(res, i) + '<button class="s-item" onclick="Inv.mvPick(\'' + x.type + '\',\'' + x.it.id + '\')">' +
        '<span class="t"><b>' + App.esc(App.itemName(x.it)) + "</b><span>" +
        "على الرفوف " + App.shelfQty(x.it) + " · في المخزن " + App.storeQty(x.it) + "</span></span></button>";
    }).join("") + "</div>";
  }

  function mvQty(i, d, v) {
    var l = mv.lines[i];
    if (!l) return;
    var it = App.findItem(l.type, l.id);
    var n = v !== undefined ? Math.floor(App.num(v)) : l.n + d;
    if (it && n > mvAvail(it)) { n = mvAvail(it); App.toast("المتاح للنقل " + n + " فقط.", "warn"); }
    if (n <= 0) mv.lines.splice(i, 1); else l.n = n;
    paintMv();
  }
  function mvDel(i) { mv.lines.splice(i, 1); paintMv(); }
  function mvClear() { mv.lines = []; paintMv(); }

  function paintMv(flash) {
    var host = document.getElementById("mvLines");
    if (!host) return;
    mv.lines = mv.lines.filter(function (l) { return App.findItem(l.type, l.id); });
    if (!mv.lines.length) {
      host.innerHTML = '<div class="empty" style="padding:28px"><div class="big">' + App.icon("boxes", 40) + "</div>" +
        "<h4>لم تمسح شيئاً بعد</h4><p>" + (mv.dir === "in"
          ? "احمل الكتب من غرفة الخزين وامسحها هنا واحداً واحداً."
          : "امسح الكتب التي ترجعها من الرفوف إلى غرفة الخزين.") + "</p></div>";
      return;
    }
    var total = 0;
    var h = '<div class="mv-list">' + mv.lines.map(function (l, i) {
      var it = App.findItem(l.type, l.id);
      total += l.n;
      var st = App.storeQty(it), sh = App.shelfQty(it);
      var st2 = mv.dir === "in" ? st - l.n : st + l.n, sh2 = mv.dir === "in" ? sh + l.n : sh - l.n;
      return '<div class="mv-line' + (i === flash ? " bump" : "") + '">' +
        '<button class="mv-x" title="إزالة من القائمة" onclick="Inv.mvDel(' + i + ')">✕</button>' +
        '<div class="qty-box"><button onclick="Inv.mvQty(' + i + ',1)">+</button>' +
        '<input class="num" type="number" min="0" value="' + l.n + '" onchange="Inv.mvQty(' + i + ',0,this.value)">' +
        '<button onclick="Inv.mvQty(' + i + ',-1)">−</button></div>' +
        '<div class="mv-info"><b>' + App.esc(App.itemName(it)) + "</b>" +
        '<div class="ln-meta">' + (l.type === "book" ? App.locChip(it) : "") +
        '<span class="badge">المخزن ' + st + " ⇦ " + st2 + "</span>" +
        '<span class="badge ok">الرفوف ' + sh + " ⇦ " + sh2 + "</span></div></div></div>";
    }).join("") + "</div>";
    h += '<div class="row" style="margin-top:14px"><button class="btn ghost" onclick="Inv.mvClear()">مسح القائمة</button>' +
      '<div class="spacer"></div><button class="btn primary lg" onclick="Inv.mvConfirm()">تأكيد نقل ' + total +
      (total === 1 ? " نسخة" : total === 2 ? " نسختين" : " نسخ") + (mv.dir === "in" ? " إلى الرفوف" : " إلى المخزن") + "</button></div>";
    host.innerHTML = h;
  }

  function mvConfirm() {
    if (!mv.lines.length) return;
    var moved = 0, kinds = 0;
    mv.lines.forEach(function (l) {
      var it = App.findItem(l.type, l.id);
      if (!it) return;
      var k = App.moveStock(it, l.n, mv.dir);
      if (k) { moved += k; kinds++; }
    });
    mv.lines = [];
    App.save(); App.rerender();
    if (App.celebrate) App.celebrate(mv.dir === "in" ? "نُقلت إلى الرفوف" : "نُقلت إلى المخزن", moved + " نسخة · " + kinds + " صنف");
  }

  function newGoods() {
    var isB = gd.type === "book";
    var all = (isB ? S().books : S().stationery).slice();
    all.sort(function (a, b2) { return String(a.created || "") < String(b2.created || "") ? -1 : 1; });
    var list = all.slice(-15);   // آخر 15 مسجّلاً، الأحدث في الأسفل

    var h = '<div class="card" style="margin-bottom:18px"><div class="card-body center" style="padding:30px">' +
      '<div style="opacity:.32;margin-bottom:10px">' + App.icon(isB ? "books" : "box", 44) + "</div>" +
      '<h3 style="margin:0 0 6px;font-family:var(--font-head);font-size:21px">' +
      (isB ? "تسجيل كتاب جديد في المخزون" : "تسجيل صنف قرطاسية جديد") + "</h3>" +
      '<p class="muted small" style="margin:0 0 16px">' +
      (isB ? "اختر دار النشر ليُحسب سعر البيع تلقائياً من سعر الشراء." : "سجّل الصنف وسعره ومكانه في المحل.") + "</p>" +
      '<button class="btn primary lg" onclick="' + (isB ? "Inv.editBook()" : "Inv.editStat()") + '">+ ' +
      (isB ? "كتاب جديد" : "صنف جديد") + "</button> " +
      (isB ? '<button class="btn" onclick="Inv.bulkPaste()">لصق دفعة كتب</button> ' : "") +
      '<button class="btn" onclick="Inv.importItems(\'' + (isB ? "book" : "stat") + '\')">استيراد من ملف</button> ' +
      '<button class="btn" onclick="Inv.exportGoods()">تصدير جدول Excel</button>' +
      "</div></div>";

    h += '<div class="card"><div class="card-head"><h3>آخر ما أضفته</h3><div class="spacer"></div>' +
      '<span class="muted small">مرتّبة من الأقدم للأحدث · ' +
      (isB ? S().books.length : S().stationery.length) + " صنف في المجموع</span></div>" +
      App.table([
        { h: "#", cls: "num", c: function (x, i) { return all.length - list.length + i + 1; } },
        {
          h: "الصنف", c: function (x, i) {
            return '<div class="name">' + lblMark(x) + App.esc(App.itemName(x)) +
              (i === list.length - 1 ? ' <span class="badge ok">الأخير</span>' : "") +
              (x.consId ? ' <span class="badge warn">على المباع</span>' : "") + "</div>" +
              '<div class="sub">' + App.esc(x.author || x.brand || "") +
              (x.publisher ? " · " + App.esc(x.publisher) : "") + "</div>";
          }
        },
        { h: "الموقع", c: function (x) { return isB ? App.locChip(x) : App.esc(x.loc || "—"); } },
        App.canProfit() ? { h: "الشراء", cls: "num", c: function (x) { return App.money0(x.cost); } } : null,
        { h: "البيع", cls: "num", c: function (x) { return "<b>" + App.money0(x.price) + "</b>"; } },
        { h: "الكمية", cls: "num", c: function (x) { return App.num(x.qty); } },
        {
          h: "", cls: "act", c: function (x) {
            return '<button class="btn sm" onclick="Inv.' + (isB ? "editBook" : "editStat") +
              '(\'' + x.id + '\')">تعديل</button>';
          }
        }
      ], list, {
        emptyIcon: isB ? "▣" : "◈",
        emptyTitle: "لم تُسجّل شيئاً بعد",
        emptyText: "اضغط الزر بالأعلى لتسجيل أول صنف."
      }) + "</div>";
    return h;
  }

  function purchases() {
    if (!draft) draft = { supplierId: "", date: App.today(), note: "", lines: [] };

    var h = '<div class="card" style="margin-bottom:18px">' +
      '<div class="card-head"><h3>إدخال بضاعة جديدة</h3><div class="spacer"></div>' +
      '<span class="muted small">تُضاف الكميات للمخزون وتُحدَّث أسعار الجملة</span></div>' +
      '<div class="card-body">' +
      '<div style="margin-bottom:16px">' + destTabs(purTo(), "Inv.purSetTo") + "</div>" +
      '<div class="grid g3 pur-meta">' +
      '<div class="field"><label>المورد</label><select class="inp" onchange="Inv.pd(\'supplierId\',this.value)">' +
      '<option value="">— بدون مورد —</option>' +
      S().suppliers.map(function (s) { return '<option value="' + s.id + '"' + (draft.supplierId === s.id ? " selected" : "") + ">" + App.esc(s.name) + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="field"><label>التاريخ</label><input type="date" class="inp" value="' + draft.date + '" onchange="Inv.pd(\'date\',this.value)"></div>' +
      '<div class="field"><label>ملاحظة / رقم فاتورة المورد</label><input class="inp" value="' + App.esc(draft.note) + '" oninput="Inv.pd(\'note\',this.value)"></div>' +
      "</div>" +
      '<div class="field pur-find">' +
      '<label>ابحث عن الصنف الذي وصلتك منه كمية</label>' +
      '<div class="pur-search"><span class="mag">' + App.icon("search", 20) + "</span>" +
      '<input class="inp" id="purSearch" placeholder="اكتب اسم الصنف أو امسح الباركود…" autocomplete="off" ' +
      'oninput="Inv.purSuggest(this.value)" onfocus="Inv.purSuggest(this.value)" onblur="Inv.purBlur()" onkeydown="Inv.purKey(event)">' +
      '<button class="clr" type="button" title="مسح البحث" onclick="Inv.purClearQ()">✕</button></div>' +
      '<div id="purSug"></div>' +
      '<div class="hint">أو اختر من القائمة بالأسفل</div></div>' +
      quickPick() +

      '<div id="purLines"></div>' +

      '<div class="row" style="margin-top:14px">' +
      '<div class="spacer"></div>' +
      '<div style="font-size:17px;font-weight:700">الإجمالي: <span class="num" id="purTotal">0.00</span></div>' +
      '<button class="btn" onclick="Inv.purClear()">مسح</button>' +
      '<button class="btn primary lg" onclick="Inv.purSave()">' + (purTo() === "store" ? "حفظ — للمخزن" : "حفظ — للرفوف") + "</button>" +
      "</div></div></div>";

    h += '<div class="card"><div class="card-head"><h3>سجل الإدخالات السابقة</h3></div>' +
      App.table([
        { h: "التاريخ", c: function (p) { return App.esc(p.date); } },
        { h: "المورد", c: function (p) { var s = People.supplier(p.supplierId); return s ? App.esc(s.name) : '<span class="muted">—</span>'; } },
        { h: "عدد الأصناف", cls: "num", c: function (p) { return p.lines.length; } },
        { h: "إجمالي القطع", cls: "num", c: function (p) { return p.lines.reduce(function (s, l) { return s + App.num(l.qty); }, 0); } },
        { h: "التكلفة", cls: "num", c: function (p) { return "<b>" + App.money0(p.total) + "</b>"; } },
        { h: "ملاحظة", c: function (p) { return App.esc(p.note || "—"); } },
        { h: "", cls: "act", c: function (p) { return '<button class="btn sm" onclick="Inv.showPurchase(\'' + p.id + '\')">تفاصيل</button>'; } }
      ], S().purchases, { emptyIcon: "goods", emptyTitle: "لا توجد إدخالات بعد", emptyText: "كل بضاعة تدخل المحل سجّلها هنا لتتبع التكاليف والموردين." }) +
      "</div>";

    setTimeout(paintPurLines, 0);
    return h;
  }

  /* قائمة البضاعة الموجودة للاختيار السريع */
  function quickPick() {
    var arr = (gd.type === "book" ? S().books : S().stationery).slice(0, 40);
    if (!arr.length) return '<p class="muted small">لا توجد أصناف مسجّلة من هذا النوع بعد.</p>';
    return '<div class="grid pur-picks">' +
      arr.map(function (x) {
        return '<button class="pur-pick" ' +
          'onclick="Inv.purAdd(\'' + gd.type + '\',\'' + x.id + '\')">' +
          '<div class="pp-n">' + App.esc(App.itemName(x)) + "</div>" +
          '<div class="pp-m">الموجود: <b class="num">' + App.num(x.qty) + "</b> · شراء " + App.money0(x.cost) + "</div></button>";
      }).join("") + "</div>";
  }

  /* المسوّدة قد تُستدعى قبل رسم الصفحة — ننشئها عند الحاجة */
  function ensureDraft() {
    if (!draft) draft = { supplierId: "", date: App.today(), note: "", lines: [] };
    return draft;
  }

  function pd(k, v) { ensureDraft()[k] = v; }

  /* الكمية المضافة من الصنف في هذه الإدخالية — تظهر علامةً في نتائج البحث */
  function purHave(type, id) {
    var n = 0;
    ensureDraft().lines.forEach(function (l) { if (l.type === type && l.id === id) n = App.num(l.qty); });
    return n;
  }

  function purSuggest(q) {
    ensureDraft();
    var host = document.getElementById("purSug");
    var box = document.querySelector(".pur-search");
    if (box) box.classList.toggle("has", !!q);
    if (!host) return;
    var res = searchItems(q, 8);
    if (!res.length) { host.innerHTML = ""; return; }
    host.innerHTML = '<div class="suggest">' + res.map(function (x, i) {
      var got = purHave(x.type, x.it.id);
      return App.sugHead(res, i) + '<button class="s-item' + (got ? " got" : "") + '" onmousedown="event.preventDefault()" ' +
        'onclick="Inv.purAdd(\'' + x.type + '\',\'' + x.it.id + '\')">' +
        '<span class="t"><b>' + App.esc(App.itemName(x.it)) + "</b><span>" +
        (x.type === "book" ? "كتاب" : "قرطاسية") + " · متوفر: " + App.num(x.it.qty) +
        " · جملة: " + App.money0(x.it.cost) + "</span></span>" +
        (got ? '<span class="badge ok">✓ مُضاف: ' + got + "</span>" : "") + "</button>";
    }).join("") + "</div>";
  }

  /* الضغط خارج الخانة يطوي القائمة (ويبقى النص) — والرجوع إليها يفتحها */
  function purBlur() {
    setTimeout(function () {
      var s = document.getElementById("purSearch"), host = document.getElementById("purSug");
      if (host && s && document.activeElement !== s) host.innerHTML = "";
    }, 150);
  }

  function purClearQ() {
    var s = document.getElementById("purSearch");
    if (s) { s.value = ""; s.focus(); }
    purSuggest("");
  }

  function purKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var hit = byBarcode(e.target.value);
      if (hit) { purAdd(hit.type, hit.it.id, true); return; }
      var res = searchItems(e.target.value, 1);
      if (App.exactCount(res)) purAdd(res[0].type, res[0].it.id, true);
      else if (res.length) { purSuggest(e.target.value); App.toast("ما لقيناش الاسم بالضبط — اختر من «هل تقصد؟».", "warn"); }
      else App.toast("لم يُعثر على الصنف. أضفه أولاً من صفحة الكتب أو القرطاسية.", "warn");
    }
    if (e.key === "Escape") purClearQ();
  }

  /* الاختيار من النتائج يُبقي ما كتبته والقائمة مفتوحة لتختار غيره.
     المسح بالقارئ أو Enter يفرّغ الخانة لتستقبل المسحة التالية. */
  function purAdd(type, id, clear) {
    var it = App.findItem(type, id);
    if (!it) return;
    ensureDraft();
    var ex = null;
    draft.lines.forEach(function (l) { if (l.type === type && l.id === id) ex = l; });
    if (ex) ex.qty = App.num(ex.qty) + 1;
    else draft.lines.push({ type: type, id: id, name: App.itemName(it), qty: 1, cost: App.num(it.cost) });
    var s = document.getElementById("purSearch");
    if (s && clear) s.value = "";
    if (s) purSuggest(s.value);
    if (s && document.getElementById("purSug").innerHTML) s.focus();
    paintPurLines();
  }

  function paintPurLines() {
    var host = document.getElementById("purLines");
    if (!host || !draft) return;
    if (!draft.lines.length) {
      host.innerHTML = '<div class="empty" style="padding:26px"><p>لم تُضف أصناف بعد. ابحث بالأعلى أو امسح الباركود.</p></div>';
      var t0 = document.getElementById("purTotal"); if (t0) t0.textContent = "0.00";
      return;
    }
    var total = 0;
    var h = '<table class="tbl"><thead><tr><th>الصنف</th><th>الموجود حالياً</th><th>الكمية المضافة</th>' +
      "<th>سعر الشراء الجديد</th><th>الإجمالي</th><th>يصير</th><th></th></tr></thead><tbody>";
    draft.lines.forEach(function (l, i) {
      var sub = App.num(l.qty) * App.num(l.cost); total += sub;
      var it0 = App.findItem(l.type, l.id);
      var have = it0 ? App.num(it0.qty) : 0;
      var ts = lineToStore(l);
      var sh1 = (it0 ? App.shelfQty(it0) : 0) + App.num(l.qty) - ts, st1 = (it0 ? App.storeQty(it0) : 0) + ts;
      h += "<tr><td>" + App.esc(l.name) + "</td>" +
        '<td class="num">' + have + (it0 && App.storeQty(it0) ? '<div class="muted small">مخزن ' + App.storeQty(it0) + "</div>" : "") + "</td>" +
        '<td><input class="inp num" style="width:88px" type="number" min="1" value="' + App.num(l.qty) + '" onchange="Inv.purSet(' + i + ',\'qty\',this.value)"></td>' +
        '<td><input class="inp num" style="width:110px" type="number" step="0.01" min="0" value="' + App.num(l.cost) + '" onchange="Inv.purSet(' + i + ',\'cost\',this.value)"></td>' +
        '<td class="num"><b>' + App.money0(sub) + "</b></td>" +
        '<td class="num"><b style="color:var(--accent)">' + (have + App.num(l.qty)) + "</b>" +
        '<div class="muted small">رفوف ' + sh1 + " · مخزن " + st1 + "</div></td>" +
        '<td class="act"><button class="btn sm ghost" onclick="Inv.purDel(' + i + ')">✕</button></td></tr>';
    });
    h += "</tbody></table>";
    host.innerHTML = h;
    document.getElementById("purTotal").textContent = App.money0(total);
  }

  function purSet(i, k, v) {
    ensureDraft();
    if (!draft.lines[i]) return;
    var n = App.num(v);
    if (n < 0) n = 0;                       // لا كميات ولا أسعار سالبة
    draft.lines[i][k] = n;
    paintPurLines();
  }

  /* وجهة البضاعة الواصلة: «للرفوف» عند كل فتح */
  function purTo() { return (draft && draft.to) || "shelf"; }
  function purSetTo(k) { ensureDraft().to = k; App.rerender(); }
  function lineToStore(l) { return purTo() === "store" ? App.num(l.qty) : 0; }

  function purDel(i) { ensureDraft(); draft.lines.splice(i, 1); paintPurLines(); }
  function purClear() { draft = { supplierId: "", date: App.today(), note: "", lines: [] }; App.rerender(); }

  function purSave() {
    ensureDraft();
    draft.lines = draft.lines.filter(function (l) { return App.num(l.qty) > 0; });
    if (!draft.lines.length) { App.toast("أضف صنفاً واحداً على الأقل.", "warn"); return; }
    var total = draft.lines.reduce(function (s, l) { return s + App.num(l.qty) * App.num(l.cost); }, 0);
    draft.lines.forEach(function (l) {
      var it = App.findItem(l.type, l.id);
      if (!it) return;
      l.st = lineToStore(l);
      App.receiveStock(it, App.num(l.qty), l.st);
      if (App.num(l.cost) > 0) it.cost = App.num(l.cost);
      it.updated = App.nowStamp();
    });
    S().purchases.unshift({
      id: App.uid(), date: draft.date, supplierId: draft.supplierId,
      note: draft.note, lines: draft.lines.slice(), total: total, at: App.nowStamp()
    });
    App.log("إدخال بضاعة", draft.lines.length + " صنف بقيمة " + App.money0(total));
    App.toast("أُدخلت البضاعة وحُدِّث المخزون.");
    draft = null;
    App.saveNow(); App.rerender();
  }

  function showPurchase(id) {
    var p = null;
    S().purchases.forEach(function (x) { if (x.id === id) p = x; });
    if (!p) return;
    var s = People.supplier(p.supplierId);
    App.modal({
      title: "إدخال بضاعة — " + p.date,
      body: '<div class="row small muted" style="margin-bottom:12px">المورد: ' + App.esc(s ? s.name : "—") +
        (p.note ? " · " + App.esc(p.note) : "") + "</div>" +
        App.table([
          { h: "الصنف", c: function (l) { return App.esc(l.name); } },
          { h: "الكمية", cls: "num", c: function (l) { return App.num(l.qty); } },
          { h: "الجملة", cls: "num", c: function (l) { return App.money0(l.cost); } },
          { h: "الإجمالي", cls: "num", c: function (l) { return App.money0(App.num(l.qty) * App.num(l.cost)); } }
        ], p.lines) +
        '<div class="row" style="margin-top:12px;font-size:16px;font-weight:700"><div class="spacer"></div>الإجمالي: ' +
        App.money(p.total) + "</div>"
    });
  }

  /* ============================================================
     التصدير والاستيراد
     ============================================================ */

  /* عمود الملاحظة أخيراً: يحمل وصف الكتاب القادم من موقع التسجيل.
     الملفات القديمة بلا هذا العمود تُستورد كما هي. */
  var BOOK_COLS = ["اسم الكتاب", "المؤلف", "دار النشر", "التصنيف", "المكتبة", "الرف", "الباركود", "سعر الجملة", "سعر البيع", "الكمية", "حد التنبيه", "ملاحظة"];
  var STAT_COLS = ["اسم الصنف", "التصنيف", "الماركة", "الوحدة", "المكان", "الباركود", "سعر الجملة", "سعر البيع", "الكمية", "حد التنبيه", "ملاحظة"];

  /* تصدير البضاعة كجدول Excel منسّق */
  function exportGoods(type) {
    var isB = (type || gd.type) === "book";
    var arr = isB ? S().books : S().stationery;
    if (!arr.length) { App.toast("لا توجد أصناف للتصدير.", "warn"); return; }

    var cols = [
      { h: isB ? "اسم الكتاب" : "اسم الصنف", c: function (x) { return App.itemName(x); } },
      { h: isB ? "المؤلف" : "الماركة", c: function (x) { return x.author || x.brand || ""; } }
    ];
    if (isB) cols.push({ h: "دار النشر", c: function (x) { return x.publisher || ""; } });
    cols.push(
      { h: "المورّد", c: function (x) { var sp = People.supplier(x.supplierId); return sp ? sp.name : ""; } },
      { h: "التصنيف", c: function (x) { return x.cat || ""; } },
      {
        h: "الموقع", c: function (x) {
          return isB ? ((x.lib || "") + (x.shelf ? " / رف " + x.shelf : "")) : (x.loc || "");
        }
      },
      { h: "الرمز أو الباركود", c: function (x) { return x.barcode || x.code || ""; } },
      { h: "الكمية", t: "i", sum: true, c: function (x) { return App.num(x.qty); } },
      { h: "على الرفوف", t: "i", sum: true, c: function (x) { return App.shelfQty(x); } },
      { h: "في المخزن", t: "i", sum: true, c: function (x) { return App.storeQty(x); } },
      { h: "حد التنبيه", t: "i", c: function (x) { return App.num(x.min); } },
      /* والأرباح مقفلة: لا سعر شراء ولا ربح في الملف — كان أي موظف يعرف ربح
         كل كتاب بضغطة «تصدير Excel» بلا رمز. */
      App.canProfit() ? { h: "سعر الشراء", t: "n", c: function (x) { return App.num(x.cost); } } : null,
      { h: "سعر البيع قطاعي", t: "n", c: function (x) { return App.num(x.price); } },
      { h: "سعر البيع جملة", t: "n", c: function (x) { return App.num(x.priceW) || App.num(x.price); } },
      App.canProfit() ? { h: "ربح القطعة", t: "n", c: function (x) { return App.num(x.price) - App.num(x.cost); } } : null,
      App.canProfit() ? { h: "قيمة المخزون", t: "n", sum: true, c: function (x) { return App.num(x.qty) * App.num(x.cost); } } : null,
      { h: "قيمته بيعاً", t: "n", sum: true, c: function (x) { return App.num(x.qty) * App.num(x.price); } },
      {
        h: "الحالة", c: function (x) {
          var st = App.stockState(x);
          return st === "out" ? "نفدت" : (st === "low" ? "قاربت على النفاد" : "متوفرة");
        }
      },
      { h: "على المباع", c: function (x) { return x.consId ? "نعم" : ""; } }
    );

    App.xls("البضاعة-" + (isB ? "الكتب" : "القرطاسية") + "-" + App.today(),
      isB ? "جرد الكتب" : "جرد القرطاسية",
      cols.filter(function (c) { return c; }), arr, S().meta.shopName || "");
    App.toast("نُزّل جدول Excel — افتحه مباشرة ببرنامج Excel.");
  }

  function exportBooks() {
    var rows = [BOOK_COLS];
    S().books.forEach(function (b) {
      rows.push([b.title, b.author, b.publisher, b.cat, b.lib, b.shelf, b.barcode, b.cost, b.price, b.qty, b.min]);
    });
    App.download("الكتب-" + App.today() + ".csv", App.toCsv(rows));
    App.toast("نُزّل ملف الكتب. افتحه ببرنامج Excel.");
  }

  function exportStat() {
    var rows = [STAT_COLS];
    S().stationery.forEach(function (p) {
      rows.push([p.name, p.cat, p.brand, p.unit, p.loc, p.barcode, p.cost, p.price, p.qty, p.min]);
    });
    App.download("القرطاسية-" + App.today() + ".csv", App.toCsv(rows));
    App.toast("نُزّل ملف القرطاسية. افتحه ببرنامج Excel.");
  }

  /* ---------- الاستيراد ----------
     الأعمدة تُقرأ بأسمائها لا بترتيبها: ملف «تصدير Excel» (18 عموداً) كان
     يُقرأ بترتيب النموذج (12) فيصير سعر البيع = عدد النسخ على الرف، والكمية
     = عدد المخزن، وسطور العنوان والإجمالي كتباً وهمية — لكل الكتب بضغطة.
     والخانة الفارغة لا تمسح ما هو مسجّل: ملف فيه «الاسم والسعر» فقط كان
     يمسح الباركود والكمية والمؤلف والمكان. الملف بلا عناوين مفهومة يُقرأ
     بترتيب النموذج كما كان. */
  var IMP_HEAD = {
    title: ["اسم الكتاب", "الاسم", "العنوان", "اسم الصنف", "الصنف", "title", "name"],
    author: ["المؤلف", "author"],
    brand: ["الماركة"],
    publisher: ["دار النشر", "الناشر"],
    cat: ["التصنيف", "الفئة"],
    lib: ["المكتبة", "الخزانة"],
    shelf: ["الرف"],
    loc: ["الموقع", "المكان"],
    unit: ["الوحدة"],
    barcode: ["الباركود", "الرمز أو الباركود", "باركود", "الرمز", "barcode", "isbn"],
    cost: ["سعر الجملة", "سعر الشراء", "شراء", "التكلفة", "cost"],
    price: ["سعر البيع", "سعر البيع قطاعي", "بيع", "السعر", "price"],
    priceW: ["سعر البيع جملة"],
    qty: ["الكمية", "العدد", "qty"],
    store: ["في المخزن"],
    min: ["حد التنبيه", "الحد"],
    note: ["ملاحظة", "ملاحظات", "الوصف"]
  };
  function impHeadKey(h) {
    var n = App.norm(String(h || "").replace(/^﻿/, ""));
    var hit = "";
    Object.keys(IMP_HEAD).forEach(function (k) {
      IMP_HEAD[k].forEach(function (x) { if (!hit && App.norm(x) === n) hit = k; });
    });
    return hit;
  }
  /* يبحث عن سطر العناوين في أول الملف (ملف التصدير يبدأ بعنوان واسم المحل) */
  function impLayout(rows, type) {
    for (var r = 0; r < Math.min(rows.length, 8); r++) {
      var map = {}, n = 0;
      rows[r].forEach(function (h, i) { var k = impHeadKey(h); if (k && map[k] === undefined) { map[k] = i; n++; } });
      if (map.title !== undefined && n >= 3) return { start: r + 1, map: map, byName: true };
    }
    var pos = type === "book"
      ? ["title", "author", "publisher", "cat", "lib", "shelf", "barcode", "cost", "price", "qty", "min", "note"]
      : ["title", "cat", "brand", "unit", "loc", "barcode", "cost", "price", "qty", "min", "note"];
    var m2 = {}; pos.forEach(function (k, i) { m2[k] = i; });
    return { start: 1, map: m2, byName: false };
  }

  function importItems(type) {
    var cols = type === "book" ? BOOK_COLS : STAT_COLS;
    App.modal({
      title: "استيراد " + (type === "book" ? "كتب" : "أصناف قرطاسية") + " من ملف",
      body: '<p style="line-height:1.8;margin-top:0">اختر ملف CSV فيه سطر عناوين. الأعمدة تُعرف بأسمائها، مثل:</p>' +
        '<div style="background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r);padding:11px;font-size:12.5px" class="num">' +
        App.esc(cols.join(" ، ")) + "</div>" +
        '<p class="muted small" style="line-height:1.7">في Excel: ملف ← حفظ باسم ← اختر النوع <b>CSV UTF-8</b>. ملف «تصدير Excel» نفسه يصلح بعد تعديله. ' +
        "الصنف الموجود (بالباركود أو بالاسم) يُحدَّث، والخانة الفارغة لا تغيّر ما هو مسجّل.</p>",
      actions: [
        {
          label: "تحميل ملف نموذج", click: function () {
            App.download("نموذج-" + (type === "book" ? "الكتب" : "القرطاسية") + ".csv", App.toCsv([cols]));
          }
        },
        {
          label: "اختيار الملف واستيراده", kind: "primary", click: function (close) {
            App.pickFile(".csv,text/csv", function (txt) {
              var rows = App.parseCsv(txt);
              if (rows.length < 2) { App.toast("الملف فارغ أو غير صالح.", "bad"); return; }
              var plan = importPlan(type, rows);
              if (!plan.ops.length) { App.toast("لم أجد في الملف أي صنف للاستيراد.", "warn"); return; }
              if (!plan.upd) { importApply(type, plan); close(); return; }
              importConfirm(type, plan, close);
            });
          }
        }
      ]
    });
  }

  /* يقرأ الملف ويحسب ما سيتغيّر — قبل أن يُلمس أي شيء */
  function importPlan(type, rows) {
    var lay = impLayout(rows, type), M = lay.map, isB = type === "book";
    var plan = { ops: [], add: 0, upd: 0, badCells: 0, changed: { price: 0, qty: 0, cost: 0, barcode: 0 }, skipped: 0 };
    function cell(r, k) {
      if (M[k] === undefined) return null;
      var v = r[M[k]];
      v = String(v === null || v === undefined ? "" : v).trim();
      return v === "" ? null : v;                       // null = لا تغيّر
    }
    function money(v) {
      if (v === null) return null;
      if (!App.hasNumber(v)) { plan.badCells++; return 0; }
      return App.num(v);
    }
    var list = App.listOf(type), seenNew = {};
    rows.slice(lay.start).forEach(function (r) {
      var name = cell(r, "title");
      if (!name) return;
      if (App.norm(name) === App.norm("الإجمالي")) { plan.skipped++; return; }
      var bc = cell(r, "barcode");
      var ex = null;
      if (bc) list.forEach(function (x) {
        if (!ex && (String(x.barcode || "").trim() === bc || String(x.code || "").trim().toUpperCase() === bc.toUpperCase())) ex = x;
      });
      if (!ex) list.forEach(function (x) { if (App.norm(App.itemName(x)) === App.norm(name)) ex = x; });
      if (!ex && seenNew[App.norm(name) + "|" + (bc || "")]) { plan.skipped++; return; }
      var f = {};
      f[isB ? "title" : "name"] = name;
      ["author", "publisher", "cat", "lib", "shelf", "note"].forEach(function (k) { var v = cell(r, k); if (v !== null) f[k] = v; });
      if (!isB) {
        var br = cell(r, "brand"); if (br === null) br = cell(r, "author"); if (br !== null) f.brand = br;
        var un = cell(r, "unit"); if (un !== null) f.unit = un;
        delete f.author; delete f.publisher; delete f.lib; delete f.shelf;
      }
      var loc = cell(r, "loc");
      if (loc !== null) {
        if (isB) {
          var mm = loc.match(/^\s*([^\/]+?)\s*(?:\/\s*رف\s*(\S+))?\s*$/);
          if (mm) { if (f.lib === undefined) f.lib = mm[1].trim(); if (mm[2] && f.shelf === undefined) f.shelf = mm[2]; }
        } else f.loc = loc;
      }
      if (bc !== null && !(ex && String(ex.code || "").trim().toUpperCase() === bc.toUpperCase())) f.barcode = bc;
      ["cost", "price", "priceW", "qty", "min"].forEach(function (k) { var v = money(cell(r, k)); if (v !== null) f[k] = v; });
      var st = money(cell(r, "store")); if (st !== null) f.store = st;
      if (ex) {
        ["price", "qty", "cost", "barcode"].forEach(function (k) {
          if (f[k] !== undefined && String(f[k]) !== String(k === "barcode" ? (ex.barcode || "") : App.num(ex[k]))) plan.changed[k]++;
        });
        plan.upd++;
      } else {
        seenNew[App.norm(name) + "|" + (bc || "")] = 1;
        plan.add++;
      }
      plan.ops.push({ ex: ex, f: f });
    });
    return plan;
  }

  function importConfirm(type, plan, closeFirst) {
    var c = plan.changed, ch = [];
    if (c.price) ch.push("سعر البيع في <b>" + c.price + "</b>");
    if (c.qty) ch.push("الكمية في <b>" + c.qty + "</b>");
    if (c.cost) ch.push("سعر الشراء في <b>" + c.cost + "</b>");
    if (c.barcode) ch.push("الباركود في <b>" + c.barcode + "</b>");
    App.modal({
      title: "قبل الاستيراد — راجع ما سيتغيّر",
      size: "narrow",
      body: '<p style="line-height:1.9;margin-top:0">سيُضاف <b class="num">' + plan.add + "</b> صنفاً جديداً، ويُحدَّث <b class=\"num\">" +
        plan.upd + "</b> صنفاً موجوداً.</p>" +
        (ch.length ? '<p style="line-height:1.9">يتغيّر ' + ch.join("، ") + " صنفاً.</p>" : '<p class="muted">لا تتغيّر أسعار ولا كميات.</p>') +
        (plan.badCells ? '<p style="line-height:1.8;color:var(--stamp)">' + plan.badCells + " خانة سعر أو كمية لم يُفهم رقمها وستُسجَّل صفراً.</p>" : "") +
        '<p class="muted small" style="line-height:1.8;margin-bottom:0">الخانات الفارغة في الملف لا تغيّر شيئاً. إن كانت الأرقام غير متوقعة فالغالب أن الملف ليس ملف كتب — اضغط «إلغاء».</p>',
      cancelLabel: "إلغاء",
      actions: [{
        label: "استيراد", kind: "primary", click: function (close) {
          close(); if (closeFirst) closeFirst();
          importApply(type, plan);
        }
      }]
    });
  }

  function importApply(type, plan) {
    var list = App.listOf(type), isB = type === "book";
    plan.ops.forEach(function (op) {
      var o = op.ex;
      if (!o) {
        o = { id: App.uid(), code: App.nextCode(type), created: App.nowStamp() };
        if (isB) { o.title = ""; o.author = ""; o.publisher = ""; o.cat = ""; o.lib = ""; o.shelf = ""; }
        else { o.name = ""; o.cat = ""; o.brand = ""; o.unit = "قطعة"; o.loc = ""; }
        o.barcode = ""; o.cost = 0; o.price = 0; o.qty = 0; o.min = 0;
        list.push(o);
      }
      Object.keys(op.f).forEach(function (k) { o[k] = op.f[k]; });
      if (o.store !== undefined) {
        var s2 = Math.min(Math.max(App.num(o.store), 0), Math.max(App.num(o.qty), 0));
        if (s2 > 0) o.store = s2; else delete o.store;
      }
      o.updated = App.nowStamp();
    });
    App.log("استيراد", "أضيف " + plan.add + " وحُدّث " + plan.upd);
    App.save(); App.rerender();
    App.toast("تم الاستيراد: " + plan.add + " جديد، " + plan.upd + " محدَّث.");
    if (plan.badCells > 0) {
      App.modal({
        title: "انتبه — خانات لم تُقرأ",
        body: "<p style=\"line-height:1.9\">" + plan.badCells + " خانة سعر أو كمية في الملف لم يُفهم رقمها، " +
          "فسُجّلت صفراً. الغالب أن الملف محفوظ بأرقام غير معتادة أو فيه رموز عملة داخل الخانة.</p>" +
          "<p style=\"line-height:1.9\">راجع الأصناف التي سعرها صفر في «عرض وتعديل» قبل البيع.</p>"
      });
    }
  }

  return {
    books: books, stationery: stationery, alerts: alerts, purchases: purchases,
    goods: goods, gset: gset,
    moveScreen: moveScreen, setNewDest: setNewDest, mvSet: mvSet, mvPick: mvPick, mvSuggest: mvSuggest, mvQty: mvQty, mvDel: mvDel, mvClear: mvClear, mvConfirm: mvConfirm,
    editBook: editBook, editStat: editStat, del: del, addStock: addStock, move: move,
    setF: setF, setG: setG, showShelf: showShelf, printShoppingList: printShoppingList,
    restockAll: restockAll, printPickList: printPickList,
    searchItems: searchItems, byBarcode: byBarcode,
    pd: pd, purSuggest: purSuggest, purKey: purKey, purAdd: purAdd, purClearQ: purClearQ, purBlur: purBlur,
    purSet: purSet, purDel: purDel, purClear: purClear, purSave: purSave, showPurchase: showPurchase, purSetTo: purSetTo,
    exportBooks: exportBooks, exportStat: exportStat, exportGoods: exportGoods, importItems: importItems,
    pubList: pubList, pubByName: pubByName, wholesaleFromPub: wholesaleFromPub, pubHint: pubHint, normRate: normRate,
    newPublisher: newPublisher, newSupplier: newSupplier,
    smartPaste: smartPaste, parsePasted: parsePasted, findDupes: findDupes,
    bulkPaste: bulkPaste, parseBulk: parseBulk, copyBulkPrompt: copyBulkPrompt,
    bulkSet: bulkSet, bulkDel: bulkDel, bulkAll: bulkAll,
    bulkQtyKey: bulkQtyKey, bulkFocusQty: bulkFocusQty
  };
})();
