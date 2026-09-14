/* ============================================================
   inventory.js — الكتب، القرطاسية، التنبيهات، إدخال البضاعة
   ============================================================ */

var Inv = (function () {

  var f = { q: "", lib: "", shelf: "", cat: "", st: "", view: "table" };
  var g = { q: "", cat: "", st: "" };
  var draft = null;   // فاتورة شراء قيد الإدخال

  function S() { return App.S; }

  /* ---------- بحث مشترك ---------- */

  function searchItems(q, limit) {
    var nq = App.norm(q);
    if (!nq) return [];
    var out = [];
    App.allItems().forEach(function (x) {
      if (out.length >= (limit || 8)) return;
      var it = x.it;
      var hay = App.norm(App.itemName(it) + " " + (it.author || "") + " " + (it.brand || "") +
        " " + (it.publisher || "") + " " + (it.code || "") + " " + (it.barcode || "") +
        " " + (it.cat || "") + " " + (it.lib || "") + " " + (it.loc || "") + " " + (it.note || ""));
      if (hay.indexOf(nq) >= 0) out.push(x);
    });
    return out;
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
    var nq = App.norm(f.q);
    return S().books.filter(function (b) {
      if (f.lib && b.lib !== f.lib) return false;
      if (f.shelf && String(b.shelf) !== String(f.shelf)) return false;
      if (f.st && App.stockState(b) !== f.st) return false;
      if (nq) {
        var hay = App.norm((b.title || "") + " " + (b.author || "") + " " + (b.publisher || "") +
          " " + (b.code || "") + " " + (b.barcode || "") + " " + (b.cat || ""));
        if (hay.indexOf(nq) < 0) return false;
      }
      return true;
    });
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
    var h = '<div class="item-cards">';
    rows.forEach(function (x) {
      var st = App.stockState(x);
      h += '<div class="item-card ' + (st === "out" ? "out" : (st === "low" ? "low" : "")) + '">' +
        '<div class="ic-top">' + lblMark(x) +
        '<b class="ic-name">' + App.esc(App.itemName(x)) + "</b></div>" +
        '<div class="ic-sub">' + App.esc(x.author || x.brand || "—") +
        (x.publisher ? " · " + App.esc(x.publisher) : "") + "</div>" +
        '<div class="ic-chips">' +
        (isB ? App.locChip(x) : '<span class="badge">' + App.esc(x.loc || "—") + "</span>") +
        (x.cat ? '<span class="badge">' + App.esc(x.cat) + "</span>" : "") +
        App.stockBadge(x) +
        "</div>" +
        '<div class="ic-nums">' +
        '<div><span>البيع</span><b>' + App.money0(x.price) + "</b></div>" +
        '<div><span>الكمية</span><b>' + App.num(x.qty) + "</b></div>" +
        '<div><span>الرمز</span><b class="num sm">' +
        App.esc(x.barcode || x.code || "—") + "</b></div>" +
        "</div>" +
        '<div class="ic-acts">' +
        '<button class="btn sm" onclick="Inv.addStock(\'' + type + "','" + x.id + '\')">+ كمية</button>' +
        '<button class="btn sm" onclick="Inv.' + (isB ? "editBook" : "editStat") + "('" + x.id + '\')">تعديل</button>' +
        '<button class="btn sm ghost" onclick="Labels.one(\'' + type + "','" + x.id + '\')">⌷ لاصقة</button>' +
        '<button class="btn sm ghost" onclick="Inv.del(\'' + type + "','" + x.id + '\')">حذف</button>' +
        "</div></div>";
    });
    return h + "</div>";
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
      { h: "التصنيف", c: function (b) { return b.cat ? '<span class="badge">' + App.esc(b.cat) + "</span>" : '<span class="muted">—</span>'; } },
      { h: "الرمز", c: function (b) { return '<span class="num small">' + App.esc(b.barcode || b.code || "") + "</span>"; } },
      { h: "الجملة", cls: "num", c: function (b) { return App.money0(b.cost); } },
      { h: "البيع", cls: "num", c: function (b) { return "<b>" + App.money0(b.price) + "</b>"; } },
      { h: "الكمية", cls: "num", c: function (b) { return "<b>" + App.num(b.qty) + "</b>" + (App.num(b.min) ? '<span class="muted small"> / ' + App.num(b.min) + "</span>" : ""); } },
      { h: "الحالة", c: function (b) { return App.stockBadge(b); } },
      {
        h: "", cls: "act", c: function (b) {
          return '<button class="btn sm" onclick="Inv.addStock(\'book\',\'' + b.id + '\')">+ كمية</button> ' +
            '<button class="btn sm" onclick="Inv.editBook(\'' + b.id + '\')">تعديل</button> ' +
            '<button class="btn sm ghost" onclick="Labels.one(\'book\',\'' + b.id + '\')" title="طباعة لاصقة باركود">⌷ لاصقة</button> ' +
            '<button class="btn sm ghost" onclick="Inv.del(\'book\',\'' + b.id + '\')">حذف</button>';
        }
      }
    ], rows, {
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
    var fm = App.form({
      title: b ? "تعديل كتاب" : "كتاب جديد",
      size: "wide",
      topHtml: b ? "" : '<button class="btn" style="margin-bottom:12px" onclick="Inv.smartPaste()">📋 لصق البيانات من جيميناي دفعة واحدة</button>',
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
        /* ليس إلزامياً: يُسجَّل الكتاب بلا باركود، ويُولَّد له رمز عند
           طباعة لاصقته من تبويب «طباعة اللاصقات». */
        { k: "barcode", label: "الباركود", hint: "امسحه بالقارئ، أو اتركه فارغاً ليُولَّد عند طباعة اللاصقة" },
        { k: "cost", label: "سعر الشراء من المورّد", type: "money", min: 0 },
        { k: "price", label: "سعر البيع قطاعي", type: "money", min: 0, required: true, hint: "اكتبه واختر دار النشر ليُحسب سعر الجملة" },
        { k: "priceW", label: "سعر البيع جملة", type: "money", min: 0, hint: "يُحسب تلقائياً من نسبة دار النشر — أو اكتبه بيدك" },
        { k: "qty", label: "الكمية الحالية", type: "number", min: 0 },
        { k: "min", label: "حد التنبيه", type: "number", min: 0, hint: "ينبّهك عند الوصول لهذا العدد" },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        // لا أسعار ولا كميات سالبة
        ["cost", "price", "priceW", "qty", "min"].forEach(function (k) {
          if (App.num(v[k]) < 0) v[k] = 0;
        });
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
        v.id = App.uid();
        v.rate = App.num(v.rate);
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
  function bulkAll(k, v) {
    bulkRows.forEach(function (r) {
      if (k === "qty" || k === "min") r[k] = Math.max(0, Math.round(App.num(v)));
      else r[k] = Math.max(0, App.num(v));
    });
    bulkPaintReview();
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

    var h = '<div class="row" style="gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:flex-end">' +
      '<span class="badge ok">' + bulkRows.length + " كتاب</span>" +
      (dupes ? '<span class="badge warn">' + dupes + " موجود مسبقاً (سيُحدَّث)</span>" : "") +
      (noPrice ? '<span class="badge bad">' + noPrice + " بلا سعر بيع</span>" : "") +
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
          return '<input class="inp num" style="width:152px" value="' + App.esc(r.barcode) +
            '" placeholder="امسحه" onchange="Inv.bulkSet(' + i + ',\'barcode\',this.value)">';
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
    var nq = App.norm(g.q);
    var rows = S().stationery.filter(function (p) {
      if (g.cat && p.cat !== g.cat) return false;
      if (g.st && App.stockState(p) !== g.st) return false;
      if (nq) {
        var hay = App.norm((p.name || "") + " " + (p.brand || "") + " " + (p.code || "") + " " + (p.barcode || "") + " " + (p.cat || ""));
        if (hay.indexOf(nq) < 0) return false;
      }
      return true;
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
      { h: "التصنيف", c: function (p) { return p.cat ? '<span class="badge">' + App.esc(p.cat) + "</span>" : '<span class="muted">—</span>'; } },
      { h: "المكان", c: function (p) { return p.loc ? App.esc(p.loc) : '<span class="muted">—</span>'; } },
      { h: "الرمز", c: function (p) { return '<span class="num small">' + App.esc(p.barcode || p.code || "") + "</span>"; } },
      { h: "الجملة", cls: "num", c: function (p) { return App.money0(p.cost); } },
      { h: "البيع", cls: "num", c: function (p) { return "<b>" + App.money0(p.price) + "</b>"; } },
      { h: "الكمية", cls: "num", c: function (p) { return "<b>" + App.num(p.qty) + "</b>" + (App.num(p.min) ? '<span class="muted small"> / ' + App.num(p.min) + "</span>" : ""); } },
      { h: "الحالة", c: function (p) { return App.stockBadge(p); } },
      {
        h: "", cls: "act", c: function (p) {
          return '<button class="btn sm" onclick="Inv.addStock(\'stat\',\'' + p.id + '\')">+ كمية</button> ' +
            '<button class="btn sm" onclick="Inv.editStat(\'' + p.id + '\')">تعديل</button> ' +
            '<button class="btn sm ghost" onclick="Labels.one(\'stat\',\'' + p.id + '\')" title="طباعة لاصقة باركود">⌷ لاصقة</button> ' +
            '<button class="btn sm ghost" onclick="Inv.del(\'stat\',\'' + p.id + '\')">حذف</button>';
        }
      }
    ], rows, {
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
    var fs2 = App.form({
      title: p ? "تعديل صنف" : "صنف قرطاسية جديد",
      size: "wide",
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
        { k: "qty", label: "الكمية الحالية", type: "number", min: 0 },
        { k: "min", label: "حد التنبيه", type: "number", min: 0 },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        ["cost", "price", "priceW", "qty", "min"].forEach(function (k) {
          if (App.num(v[k]) < 0) v[k] = 0;
        });
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

  function addStock(type, id) {
    var it = App.findItem(type, id);
    if (!it) return;
    App.form({
      title: "إضافة كمية — " + App.itemName(it),
      size: "narrow",
      values: { add: 1, cost: it.cost },
      fields: [
        { k: "add", label: "الكمية المضافة", type: "number", min: 1, required: true, full: true },
        { k: "cost", label: "سعر الجملة الجديد", type: "money", min: 0, full: true, hint: "اتركه كما هو إن لم يتغير" }
      ],
      saveLabel: "إضافة للمخزون",
      onSave: function (v) {
        it.qty = App.num(it.qty) + App.num(v.add);
        if (App.num(v.cost) > 0) it.cost = App.num(v.cost);
        it.updated = App.nowStamp();
        App.log("إضافة كمية", App.itemName(it) + " +" + App.num(v.add));
        App.save(); App.rerender();
        App.toast("الكمية الآن: " + App.num(it.qty));
      }
    });
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
      '<div class="field"><label>النوع</label><div class="seg">' +
      '<button class="' + (gd.type === "book" ? "on" : "") + '" onclick="Inv.gset(\'type\',\'book\')">كتب</button>' +
      '<button class="' + (gd.type === "stat" ? "on" : "") + '" onclick="Inv.gset(\'type\',\'stat\')">قرطاسية</button>' +
      "</div></div></div></div>";

    if (gd.mode === "new") return h + newGoods();
    if (gd.mode === "qty") return h + purchases();
    return h + (gd.type === "book" ? books() : stationery());
  }

  function gset(k, v) { gd[k] = v; App.rerender(); }

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
        { h: "الشراء", cls: "num", c: function (x) { return App.money0(x.cost); } },
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
      '<div class="grid g3" style="margin-bottom:14px">' +
      '<div class="field"><label>المورد</label><select class="inp" onchange="Inv.pd(\'supplierId\',this.value)">' +
      '<option value="">— بدون مورد —</option>' +
      S().suppliers.map(function (s) { return '<option value="' + s.id + '"' + (draft.supplierId === s.id ? " selected" : "") + ">" + App.esc(s.name) + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="field"><label>التاريخ</label><input type="date" class="inp" value="' + draft.date + '" onchange="Inv.pd(\'date\',this.value)"></div>' +
      '<div class="field"><label>ملاحظة / رقم فاتورة المورد</label><input class="inp" value="' + App.esc(draft.note) + '" oninput="Inv.pd(\'note\',this.value)"></div>' +
      "</div>" +

      '<div class="field" style="position:relative;margin-bottom:12px">' +
      '<label>ابحث عن الصنف الذي وصلتك منه كمية</label>' +
      '<input class="inp" id="purSearch" placeholder="اكتب اسم الصنف أو امسح الباركود…" autocomplete="off" ' +
      'oninput="Inv.purSuggest(this.value)" onkeydown="Inv.purKey(event)">' +
      '<div id="purSug"></div>' +
      '<div class="hint">أو اختر من القائمة بالأسفل</div></div>' +
      quickPick() +

      '<div id="purLines"></div>' +

      '<div class="row" style="margin-top:14px">' +
      '<div class="spacer"></div>' +
      '<div style="font-size:17px;font-weight:700">الإجمالي: <span class="num" id="purTotal">0.00</span></div>' +
      '<button class="btn" onclick="Inv.purClear()">مسح</button>' +
      '<button class="btn primary lg" onclick="Inv.purSave()">حفظ الإدخال</button>' +
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
    return '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr));margin-bottom:14px">' +
      arr.map(function (x) {
        return '<button class="card" style="padding:10px 12px;text-align:start;border:1px solid var(--line)" ' +
          'onclick="Inv.purAdd(\'' + gd.type + '\',\'' + x.id + '\')">' +
          '<div style="font-weight:600;font-size:13px;margin-bottom:4px">' + App.esc(App.itemName(x)) + "</div>" +
          '<div class="muted small">الموجود: <b class="num">' + App.num(x.qty) + "</b> · شراء " + App.money0(x.cost) + "</div></button>";
      }).join("") + "</div>";
  }

  /* المسوّدة قد تُستدعى قبل رسم الصفحة — ننشئها عند الحاجة */
  function ensureDraft() {
    if (!draft) draft = { supplierId: "", date: App.today(), note: "", lines: [] };
    return draft;
  }

  function pd(k, v) { ensureDraft()[k] = v; }

  function purSuggest(q) {
    ensureDraft();
    var host = document.getElementById("purSug");
    if (!host) return;
    var res = searchItems(q, 8);
    if (!res.length) { host.innerHTML = ""; return; }
    host.innerHTML = '<div class="suggest">' + res.map(function (x, i) {
      return '<button class="s-item" onclick="Inv.purAdd(\'' + x.type + '\',\'' + x.it.id + '\')">' +
        '<span class="t"><b>' + App.esc(App.itemName(x.it)) + "</b><span>" +
        (x.type === "book" ? "كتاب" : "قرطاسية") + " · متوفر: " + App.num(x.it.qty) +
        " · جملة: " + App.money0(x.it.cost) + "</span></span></button>";
    }).join("") + "</div>";
  }

  function purKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var hit = byBarcode(e.target.value);
      if (hit) { purAdd(hit.type, hit.it.id); return; }
      var res = searchItems(e.target.value, 1);
      if (res.length) purAdd(res[0].type, res[0].it.id);
      else App.toast("لم يُعثر على الصنف. أضفه أولاً من صفحة الكتب أو القرطاسية.", "warn");
    }
    if (e.key === "Escape") {
      e.target.value = "";
      var sg = document.getElementById("purSug");
      if (sg) sg.innerHTML = "";
    }
  }

  function purAdd(type, id) {
    var it = App.findItem(type, id);
    if (!it) return;
    ensureDraft();
    var ex = null;
    draft.lines.forEach(function (l) { if (l.type === type && l.id === id) ex = l; });
    if (ex) ex.qty = App.num(ex.qty) + 1;
    else draft.lines.push({ type: type, id: id, name: App.itemName(it), qty: 1, cost: App.num(it.cost) });
    var s = document.getElementById("purSearch");
    if (s) { s.value = ""; s.focus(); }
    var sug = document.getElementById("purSug");
    if (sug) sug.innerHTML = "";
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
      "<th>سعر الشراء الجديد</th><th>الإجمالي</th><th>يصير المخزون</th><th></th></tr></thead><tbody>";
    draft.lines.forEach(function (l, i) {
      var sub = App.num(l.qty) * App.num(l.cost); total += sub;
      var it0 = App.findItem(l.type, l.id);
      var have = it0 ? App.num(it0.qty) : 0;
      h += "<tr><td>" + App.esc(l.name) + "</td>" +
        '<td class="num">' + have + "</td>" +
        '<td><input class="inp num" style="width:88px" type="number" min="1" value="' + App.num(l.qty) + '" onchange="Inv.purSet(' + i + ',\'qty\',this.value)"></td>' +
        '<td><input class="inp num" style="width:110px" type="number" step="0.01" min="0" value="' + App.num(l.cost) + '" onchange="Inv.purSet(' + i + ',\'cost\',this.value)"></td>' +
        '<td class="num"><b>' + App.money0(sub) + "</b></td>" +
        '<td class="num"><b style="color:var(--accent)">' + (have + App.num(l.qty)) + "</b></td>" +
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
      it.qty = App.num(it.qty) + App.num(l.qty);
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
      { h: "حد التنبيه", t: "i", c: function (x) { return App.num(x.min); } },
      { h: "سعر الشراء", t: "n", c: function (x) { return App.num(x.cost); } },
      { h: "سعر البيع قطاعي", t: "n", c: function (x) { return App.num(x.price); } },
      { h: "سعر البيع جملة", t: "n", c: function (x) { return App.num(x.priceW) || App.num(x.price); } },
      { h: "ربح القطعة", t: "n", c: function (x) { return App.num(x.price) - App.num(x.cost); } },
      { h: "قيمة المخزون", t: "n", sum: true, c: function (x) { return App.num(x.qty) * App.num(x.cost); } },
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
      cols, arr, S().meta.shopName || "");
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

  function importItems(type) {
    var cols = type === "book" ? BOOK_COLS : STAT_COLS;
    App.modal({
      title: "استيراد " + (type === "book" ? "كتب" : "أصناف قرطاسية") + " من ملف",
      body: '<p style="line-height:1.8;margin-top:0">اختر ملف CSV بنفس ترتيب الأعمدة التالي (الصف الأول عناوين):</p>' +
        '<div style="background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r);padding:11px;font-size:12.5px" class="num">' +
        App.esc(cols.join(" ، ")) + "</div>" +
        '<p class="muted small" style="line-height:1.7">في Excel: ملف ← حفظ باسم ← اختر النوع <b>CSV UTF-8</b>. الأصناف الموجودة بنفس الاسم تُحدَّث بدل تكرارها.</p>',
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
              rows.shift();
              var added = 0, upd = 0, badCells = 0;
              /* خلية فيها نص لكنها لا تحمل رقماً مفهوماً = قراءة ضائعة.
                 نعدّها وننبّه، بدل إدخال الصنف بسعر صفر بصمت. */
              function money(cell) {
                var raw = String(cell === null || cell === undefined ? "" : cell).trim();
                if (raw && !App.hasNumber(raw)) badCells++;
                return App.num(raw);
              }
              rows.forEach(function (r) {
                var name = String(r[0] || "").trim();
                if (!name) return;
                var list = App.listOf(type);
                var ex = null;
                list.forEach(function (x) { if (App.norm(App.itemName(x)) === App.norm(name)) ex = x; });
                var o = ex || { id: App.uid(), code: App.nextCode(type), created: App.nowStamp() };
                if (type === "book") {
                  o.title = name; o.author = r[1] || ""; o.publisher = r[2] || ""; o.cat = r[3] || "";
                  o.lib = r[4] || ""; o.shelf = r[5] || ""; o.barcode = r[6] || "";
                  o.cost = money(r[7]); o.price = money(r[8]); o.qty = money(r[9]); o.min = money(r[10]);
                  if (r[11] !== undefined && String(r[11]).trim()) o.note = String(r[11]).trim();
                } else {
                  o.name = name; o.cat = r[1] || ""; o.brand = r[2] || ""; o.unit = r[3] || "قطعة";
                  o.loc = r[4] || ""; o.barcode = r[5] || "";
                  o.cost = money(r[6]); o.price = money(r[7]); o.qty = money(r[8]); o.min = money(r[9]);
                  if (r[10] !== undefined && String(r[10]).trim()) o.note = String(r[10]).trim();
                }
                o.updated = App.nowStamp();
                if (ex) upd++; else { list.push(o); added++; }
              });
              App.log("استيراد", "أضيف " + added + " وحُدّث " + upd);
              App.save(); close(); App.rerender();
              App.toast("تم الاستيراد: " + added + " جديد، " + upd + " محدَّث.");
              if (badCells > 0) {
                App.modal({
                  title: "انتبه — خانات لم تُقرأ",
                  body: "<p style=\"line-height:1.9\">" + badCells + " خانة سعر أو كمية في الملف لم يُفهم رقمها، " +
                    "فسُجّلت صفراً. الغالب أن الملف محفوظ بأرقام غير معتادة أو فيه رموز عملة داخل الخانة.</p>" +
                    "<p style=\"line-height:1.9\">راجع الأصناف التي سعرها صفر في «عرض وتعديل» قبل البيع.</p>"
                });
              }
            });
          }
        }
      ]
    });
  }

  return {
    books: books, stationery: stationery, alerts: alerts, purchases: purchases,
    goods: goods, gset: gset,
    editBook: editBook, editStat: editStat, del: del, addStock: addStock,
    setF: setF, setG: setG, showShelf: showShelf, printShoppingList: printShoppingList,
    searchItems: searchItems, byBarcode: byBarcode,
    pd: pd, purSuggest: purSuggest, purKey: purKey, purAdd: purAdd,
    purSet: purSet, purDel: purDel, purClear: purClear, purSave: purSave, showPurchase: showPurchase,
    exportBooks: exportBooks, exportStat: exportStat, exportGoods: exportGoods, importItems: importItems,
    pubList: pubList, pubByName: pubByName, wholesaleFromPub: wholesaleFromPub, pubHint: pubHint,
    newPublisher: newPublisher, newSupplier: newSupplier,
    smartPaste: smartPaste, parsePasted: parsePasted, findDupes: findDupes,
    bulkPaste: bulkPaste, parseBulk: parseBulk, copyBulkPrompt: copyBulkPrompt,
    bulkSet: bulkSet, bulkDel: bulkDel, bulkAll: bulkAll,
    bulkQtyKey: bulkQtyKey, bulkFocusQty: bulkFocusQty
  };
})();
