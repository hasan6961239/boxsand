/* ============================================================
   labels.js — طباعة لاصقات الباركود
   ------------------------------------------------------------
   كانت اللاصقات تُطبع من أداة منفصلة تولّد كوداً عشوائياً، ثم يُكتب
   الكود يدوياً في المنظومة. هنا المنظومة تعرف الصنف، فتطبع كوده هو
   واسمه فوق الباركود — فلا كتابة ولا لصق على الكتاب الخطأ.

   وكتاب عليه باركود ISBN مطبوع أصلاً لا يحتاج لاصقة إطلاقاً: يُمسح
   الموجود ويُسجَّل. هذه الصفحة تفصل النوعين.
   ============================================================ */

var Labels = (function () {

  function S() { return App.S; }

  function cfg() {
    var m = S().meta;
    if (!m.label || typeof m.label !== "object") m.label = {};
    var L = m.label;
    if (L.w === undefined) L.w = 50;          // مم — مقاس لاصقة Xprinter الشائع
    if (L.h === undefined) L.h = 30;
    if (L.maxChars === undefined) L.maxChars = 22;
    if (L.showPrice === undefined) L.showPrice = false;
    if (L.showLoc === undefined) L.showLoc = true;
    return L;
  }

  /* ---------- اختصار الاسم ----------
     الهدف عملي: أن يميّز صاحب المحل الكتاب من اللاصقة قبل أن يلصقها.
     نقطع عند حدّ كلمة لا وسط كلمة، ونسقط الكلمات الرابطة من الطرف. */

  var TAIL = ["في", "من", "على", "الى", "إلى", "عن", "مع", "لـ", "ل", "و",
    "for", "of", "in", "the", "and", "to", "a", "an"];

  function shortName(name, maxChars) {
    var s = String(name || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    var max = App.num(maxChars) || 22;
    if (s.length <= max) return s;

    var words = s.split(" ");
    var out = "";
    for (var i = 0; i < words.length; i++) {
      var next = out ? out + " " + words[i] : words[i];
      if (next.length > max) break;
      out = next;
    }
    if (!out) out = s.slice(0, max);                    // كلمة واحدة أطول من الحد

    // لا تنتهِ بكلمة رابطة معلّقة
    var parts = out.split(" ");
    while (parts.length > 1 && TAIL.indexOf(parts[parts.length - 1]) >= 0) parts.pop();
    return parts.join(" ");
  }

  /* ---------- الاختيار ---------- */

  var sel = {};            // id -> عدد اللاصقات
  var view = { q: "", kind: "need", shown: 60 };

  function hasPrinted(it) {
    /* باركود ISBN مطبوع على الغلاف: 13 رقماً يبدأ بـ978/979، أو 10 أرقام.
       أكواد المنظومة نفسها (K0001) ليست كذلك. */
    var b = String(it.barcode || "").replace(/[\s-]/g, "");
    return /^(97[89]\d{10}|\d{13}|\d{10})$/.test(b);
  }

  function codeOf(it) {
    return String(it.barcode || "").trim() || String(it.code || "").trim();
  }

  function candidates() {
    var nq = App.norm(view.q);
    var out = [];
    App.allItems().forEach(function (x) {
      var it = x.it;
      if (!codeOf(it)) return;                       // بلا كود لا لاصقة
      var printed = hasPrinted(it);
      if (view.kind === "need" && printed) return;
      if (view.kind === "printed" && !printed) return;
      if (nq) {
        var hay = App.norm(App.itemName(it) + " " + (it.author || "") + " " + codeOf(it));
        if (hay.indexOf(nq) < 0) return;
      }
      out.push({ type: x.type, it: it, name: App.itemName(it), printed: printed });
    });
    out.sort(function (a, b) {
      return String(b.it.created || "").localeCompare(String(a.it.created || ""));
    });
    return out;
  }

  function setV(k, v) { view[k] = v; view.shown = 60; App.rerender(); }
  function more() { view.shown += 60; App.rerender(); }

  function toggle(id, qty) {
    if (sel[id]) delete sel[id];
    else sel[id] = Math.max(1, App.num(qty) || 1);
    App.rerender();
  }
  function setCount(id, n) {
    var v = Math.max(0, Math.round(App.num(n)));
    if (v <= 0) delete sel[id]; else sel[id] = v;
    App.rerender();
  }
  function selectAll() {
    candidates().slice(0, view.shown).forEach(function (r) {
      sel[r.it.id] = Math.max(1, App.num(r.it.qty) || 1);
    });
    App.rerender();
  }
  function clearSel() { sel = {}; App.rerender(); }

  function totalLabels() {
    var n = 0;
    for (var k in sel) n += App.num(sel[k]);
    return n;
  }

  /* ---------- الصفحة ---------- */

  function page() {
    var L = cfg();
    var list = candidates();
    var chosen = Object.keys(sel).length;

    var h = '<div class="card" style="margin-bottom:16px"><div class="card-body">' +
      '<p style="margin:0 0 10px;line-height:1.9">اختر الأصناف واطبع لاصقاتها دفعة واحدة. ' +
      'يُطبع <b>اسم الصنف مختصراً فوق الباركود</b> حتى لا تلصقها على كتاب آخر.</p>' +
      '<p class="muted small" style="margin:0;line-height:1.8">الكتب التي عليها باركود ' +
      'مطبوع من الناشر (ISBN) لا تحتاج لاصقة — امسح باركودها الموجود وسجّله في الصنف، ' +
      'ووفّر الطباعة واللصق.</p></div></div>';

    /* شريط الأدوات */
    h += '<div class="row" style="margin-bottom:14px;flex-wrap:wrap;gap:10px">' +
      '<div class="search-wrap"><span class="mag">⌕</span>' +
      '<input class="inp" placeholder="ابحث عن صنف…" value="' + App.esc(view.q) +
      '" oninput="Labels.setV(\'q\',this.value)"></div>' +
      '<div class="seg" style="max-width:400px">' +
      '<button class="' + (view.kind === "need" ? "on" : "") + '" onclick="Labels.setV(\'kind\',\'need\')">تحتاج لاصقة</button>' +
      '<button class="' + (view.kind === "printed" ? "on" : "") + '" onclick="Labels.setV(\'kind\',\'printed\')">لها باركود مطبوع</button>' +
      '<button class="' + (view.kind === "all" ? "on" : "") + '" onclick="Labels.setV(\'kind\',\'all\')">الكل</button>' +
      "</div>" +
      '<div class="spacer"></div>' +
      '<button class="btn" onclick="Labels.settings()">⚙ مقاس اللاصقة</button>' +
      '<button class="btn" onclick="Labels.selectAll()">اختر المعروض</button>' +
      (chosen ? '<button class="btn ghost" onclick="Labels.clearSel()">إلغاء الاختيار</button>' : "") +
      '<button class="btn primary" onclick="Labels.preview()"' + (chosen ? "" : " disabled") + '>' +
      "معاينة وطباعة" + (chosen ? " · " + totalLabels() + " لاصقة" : "") + "</button>" +
      "</div>";

    h += '<div class="card">' + App.table([
      {
        h: "", cls: "act", c: function (r) {
          return '<input type="checkbox"' + (sel[r.it.id] ? " checked" : "") +
            ' onchange="Labels.toggle(\'' + r.it.id + "'," + App.num(r.it.qty) + ')">';
        }
      },
      {
        h: "الصنف", c: function (r) {
          var sh = shortName(r.name, cfg().maxChars);
          return "<b>" + App.esc(r.name) + "</b>" +
            (sh !== r.name ? '<div class="sub">على اللاصقة: ' + App.esc(sh) + "</div>" : "");
        }
      },
      { h: "الكود", c: function (r) { return '<span class="num small">' + App.esc(codeOf(r.it)) + "</span>"; } },
      {
        h: "الحالة", c: function (r) {
          return r.printed
            ? '<span class="badge ok">باركود مطبوع — لا تحتاج</span>'
            : '<span class="badge warn">تحتاج لاصقة</span>';
        }
      },
      { h: "بالمخزون", cls: "num", c: function (r) { return App.num(r.it.qty); } },
      {
        h: "عدد اللاصقات", cls: "num", c: function (r) {
          return '<input class="inp num" style="width:80px" type="text" inputmode="numeric" value="' +
            (sel[r.it.id] || "") + '" placeholder="0" onchange="Labels.setCount(\'' + r.it.id + '\',this.value)">';
        }
      }
    ], list, {
      limit: view.shown,
      moreAction: "Labels.more()",
      emptyIcon: "▤", emptyTitle: "لا أصناف",
      emptyText: "سجّل أصنافاً أولاً، أو غيّر الفلتر."
    }) + "</div>";

    return h;
  }

  function settings() {
    var L = cfg();
    App.form({
      title: "مقاس اللاصقة",
      size: "narrow",
      values: { w: L.w, h: L.h, maxChars: L.maxChars, showPrice: L.showPrice, showLoc: L.showLoc },
      fields: [
        { k: "w", label: "العرض (مم)", type: "number", min: 15, hint: "قِس لاصقتك بالمسطرة" },
        { k: "h", label: "الطول (مم)", type: "number", min: 10 },
        {
          k: "maxChars", label: "أقصى حروف للاسم", type: "number", min: 8, full: true,
          hint: "الاسم الأطول يُقطع عند آخر كلمة كاملة تدخل — مثال: «أساسيات الهندسة لتقنيات الورش» ← «أساسيات الهندسة»"
        },
        { k: "showLoc", label: "اطبع المكان (المكتبة والرف)", type: "checkbox", full: true },
        { k: "showPrice", label: "اطبع السعر على اللاصقة", type: "checkbox", full: true }
      ],
      onSave: function (v) {
        L.w = Math.max(15, App.num(v.w));
        L.h = Math.max(10, App.num(v.h));
        L.maxChars = Math.max(8, App.num(v.maxChars));
        L.showLoc = !!v.showLoc;
        L.showPrice = !!v.showPrice;
        App.save();
        App.toast("حُفظ مقاس اللاصقة.");
        App.rerender();
      }
    });
  }

  /* ---------- الرسم والطباعة ---------- */

  function svgFor(code) {
    /* JsBarcode يحتاج عنصراً في الصفحة، فنرسم في عنصر مؤقت ونأخذ ناتجه */
    var holder = document.createElement("div");
    holder.style.position = "absolute";
    holder.style.left = "-9999px";
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    holder.appendChild(svg);
    document.body.appendChild(holder);
    var out = "";
    try {
      JsBarcode(svg, String(code), {
        format: "CODE128",
        width: 2,
        height: 44,
        displayValue: true,
        fontSize: 13,
        textMargin: 1,
        margin: 2
      });
      out = holder.innerHTML;
    } catch (e) {
      out = '<div style="font:11px monospace">تعذّر رسم الباركود: ' + App.esc(e.message) + "</div>";
    }
    document.body.removeChild(holder);
    return out;
  }

  function labelHtml(it, L) {
    var name = shortName(App.itemName(it), L.maxChars);
    var loc = it.lib ? (it.lib + " · رف " + (it.shelf || "")) : (it.loc || "");
    return '<div class="lbl-one">' +
      '<div class="lbl-name">' + App.esc(name) + "</div>" +
      '<div class="lbl-bc">' + svgFor(codeOf(it)) + "</div>" +
      (L.showLoc && loc ? '<div class="lbl-sub">' + App.esc(loc) + "</div>" : "") +
      (L.showPrice ? '<div class="lbl-price">' + App.money0(it.price) + " " + App.esc(S().meta.currency || "") + "</div>" : "") +
      "</div>";
  }

  function preview() {
    var L = cfg();
    var ids = Object.keys(sel);
    if (!ids.length) { App.toast("اختر أصنافاً أولاً.", "warn"); return; }

    var body = "";
    var n = 0;
    ids.forEach(function (id) {
      var it = App.findItem("book", id) || App.findItem("stat", id);
      if (!it) return;
      var copies = App.num(sel[id]);
      for (var i = 0; i < copies; i++) { body += labelHtml(it, L); n++; }
    });

    if (!n) { App.toast("لا لاصقات للطباعة.", "warn"); return; }

    var css =
      "<style>" +
      "@page { size: " + L.w + "mm " + L.h + "mm; margin: 0; }" +
      ".lbl-sheet{direction:rtl}" +
      ".lbl-one{width:" + L.w + "mm;height:" + L.h + "mm;box-sizing:border-box;" +
      "padding:1.5mm;display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "gap:0.5mm;overflow:hidden;page-break-after:always;break-after:page;font-family:Tahoma,Arial,sans-serif}" +
      ".lbl-one:last-child{page-break-after:auto;break-after:auto}" +
      ".lbl-name{font-size:8pt;font-weight:700;line-height:1.15;text-align:center;" +
      "max-height:7mm;overflow:hidden;width:100%}" +
      ".lbl-bc{width:100%;display:flex;justify-content:center}" +
      ".lbl-bc svg{max-width:100%;height:auto}" +
      ".lbl-sub{font-size:6.5pt;color:#333}" +
      ".lbl-price{font-size:8pt;font-weight:700}" +
      "</style>";

    App.modal({
      title: "معاينة اللاصقات — " + n + " لاصقة",
      size: "wide",
      body: '<p class="muted small" style="margin-top:0;line-height:1.8">' +
        "كل لاصقة في صفحة مستقلة بمقاس " + L.w + "×" + L.h + " مم. " +
        'قبل الطباعة: اختر طابعة اللاصقات، وأطفئ «رؤوس وتذييلات الصفحات» من إعدادات الطباعة.</p>' +
        css.replace("@page { size: " + L.w + "mm " + L.h + "mm; margin: 0; }", "") +
        '<div class="lbl-sheet" style="display:flex;flex-wrap:wrap;gap:6px;max-height:50vh;overflow:auto;' +
        'background:var(--surface-2);padding:10px;border-radius:8px">' +
        body.replace(/page-break-after:always/g, "") + "</div>",
      actions: [{
        label: "طباعة الآن", kind: "primary", click: function (close) {
          App.printHtml(css + '<div class="lbl-sheet">' + body + "</div>");
          close();
        }
      }]
    });
  }

  /* لاصقة صنف واحد من سطره في المخزون — بلا مرور بصفحة اللاصقات */
  function one(type, id) {
    var it = App.findItem(type, id);
    if (!it) return;
    if (!codeOf(it)) { App.toast("هذا الصنف بلا باركود ولا كود — عدّله أولاً.", "warn"); return; }
    var L = cfg();
    App.form({
      title: "طباعة لاصقة — " + App.itemName(it),
      size: "narrow",
      values: { n: 1 },
      fields: [{
        k: "n", label: "عدد اللاصقات", type: "number", min: 1, full: true,
        hint: hasPrinted(it)
          ? "هذا الصنف عليه باركود مطبوع من الناشر — الغالب أنه لا يحتاج لاصقة."
          : "سيُطبع «" + shortName(App.itemName(it), L.maxChars) + "» فوق الباركود."
      }],
      saveLabel: "معاينة وطباعة",
      onSave: function (v) {
        sel = {};
        sel[id] = Math.max(1, Math.round(App.num(v.n)));
        preview();
      }
    });
  }

  /* يُستدعى بعد إضافة دفعة كتب: يختار الجدد ويفتح المعاينة مباشرة */
  function forItems(ids) {
    sel = {};
    (ids || []).forEach(function (id) {
      var it = App.findItem("book", id) || App.findItem("stat", id);
      if (it && !hasPrinted(it) && codeOf(it)) sel[id] = 1;
    });
    if (!Object.keys(sel).length) {
      App.toast("كل الأصناف الجديدة لها باركود مطبوع — لا تحتاج لاصقات.", "");
      return;
    }
    location.hash = "#/labels";
    setTimeout(preview, 300);
  }

  return {
    page: page, setV: setV, more: more, settings: settings,
    toggle: toggle, setCount: setCount, selectAll: selectAll, clearSel: clearSel,
    preview: preview, forItems: forItems, one: one,
    shortName: shortName, hasPrinted: hasPrinted, codeOf: codeOf
  };
})();
