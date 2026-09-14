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
    if (L.w === undefined) L.w = 30;          // مم — عرض اللاصقة
    if (L.h === undefined) L.h = 25;          // مم — طولها
    if (L.maxChars === undefined) L.maxChars = 18;
    if (L.showPrice === undefined) L.showPrice = true;
    if (L.showLoc === undefined) L.showLoc = false;   // لا مكان له في لاصقة صغيرة
    if (L.prefix === undefined) L.prefix = "";
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

  /* ---------- توليد باركود تلقائي ----------
     الكتاب يُسجَّل بلا باركود، وعند طباعة لاصقته يُولَّد له رمز فريد
     ويُحفظ عليه — فيصير قابلاً للمسح في نقطة البيع بلا كتابة يدوية. */

  function allBarcodes() {
    var set = {};
    App.allItems().forEach(function (x) {
      var b = String(x.it.barcode || "").trim();
      if (b) set[b] = 1;
      var c = String(x.it.code || "").trim();
      if (c) set[c.toUpperCase()] = 1;
    });
    return set;
  }

  /* الرمز أرقام فقط عمداً: CODE128 يضغط الأرقام رقمين في رمز واحد
     (وضع C)، فيخرج الباركود بنصف عرض الرمز الحرفي تقريباً. هذا هو
     الفرق بين باركود يُقرأ وباركود لا يُقرأ على لاصقة 30 مم.
     وطوله ثمانية أرقام: لا يلتبس بـISBN (عشرة أو ثلاثة عشر رقماً). */
  function newBarcode(taken) {
    var pre = String(cfg().prefix || "").replace(/\D/g, "").slice(0, 3);
    var len = Math.max(6, 8 - pre.length);
    for (var tries = 0; tries < 500; tries++) {
      var n = String(1 + Math.floor(Math.random() * 9));       // لا يبدأ بصفر
      for (var i = 1; i < len; i++) n += Math.floor(Math.random() * 10);
      var code = pre + n;
      if (code.length === 10 || code.length === 13) continue;  // لا يشبه ISBN
      if (!taken[code] && !taken[code.toUpperCase()]) { taken[code] = 1; return code; }
    }
    return String(Date.now()).slice(-8);
  }

  /* ---------- هل يُقرأ هذا الباركود على هذا المقاس؟ ----------
     عرض الوحدة (module) هو ما يحكم: أقل من 0.19 مم تعجز عنه أغلب
     القارئات، والطابعات الحرارية 203dpi لا ترسمه نظيفاً. نحسبه قبل
     الطباعة ونحذّر بدل أن يكتشفه صاحب المحل بعد لصق مئة لاصقة. */

  var MM_PX = 3.7795;          // بكسل CSS لكل مليمتر
  var SAFE_MM = 0.19;          // أقل عرض وحدة موثوق
  var PAD_MM = 1.2;            // هامش داخلي لكل جهة
  var QUIET = 10;              // وحدات المنطقة الهادئة لكل جهة

  function moduleCount(code) {
    var s2 = String(code || "");
    // كل الأرقام: وضع C يضغط رقمين في رمز واحد
    var symbols = /^\d+$/.test(s2) ? Math.ceil(s2.length / 2) : s2.length;
    // بداية + بيانات + تدقيق + إيقاف
    return 11 + symbols * 11 + 11 + 13;
  }

  /* أوسع وحدة تدخل في اللاصقة، وهل هي آمنة */
  function fit(code, widthMm) {
    var usable = Math.max(5, App.num(widthMm) - PAD_MM * 2);
    var mods = moduleCount(code) + QUIET * 2;
    var mm = usable / mods;
    return { mm: mm, px: Math.max(0.5, mm * MM_PX), safe: mm >= SAFE_MM, mods: mods };
  }

  /* أضيق باركود ممكن = أطول رمز يدخل بأمان على هذا العرض */
  function maxDigitsFor(widthMm) {
    var usable = Math.max(5, App.num(widthMm) - PAD_MM * 2);
    var maxMods = usable / SAFE_MM;
    var symbols = Math.floor((maxMods - QUIET * 2 - 35) / 11);
    return Math.max(0, symbols * 2);
  }

  function worstFit() {
    var L = cfg(), worst = null;
    Object.keys(sel).forEach(function (id) {
      var it = App.findItem("book", id) || App.findItem("stat", id);
      if (!it) return;
      var f = fit(codeOf(it) || "12345678", L.w);
      if (!worst || f.mm < worst.mm) worst = f;
    });
    return worst;
  }

  /* تُستدعى قبل الطباعة: تملأ الباركود الناقص وتحفظ */
  function ensureBarcodes(ids) {
    var taken = allBarcodes();
    var made = 0;
    (ids || []).forEach(function (id) {
      var it = App.findItem("book", id) || App.findItem("stat", id);
      if (!it) return;
      if (String(it.barcode || "").trim()) return;
      it.barcode = newBarcode(taken);
      it.updated = App.nowStamp();
      made++;
    });
    if (made) App.save();
    return made;
  }

  /* ---------- «لم تُطبع لاصقته» ----------
     الكتاب الذي عليه باركود الناشر لا يحتاج لاصقة أبداً. ما عداه يحتاج
     واحدة حتى تُطبع فعلاً — فتُعلَّم بعلامة حمراء في المخزون حتى ذلك. */

  function needsLabel(it) {
    if (!it) return false;
    if (hasPrinted(it)) return false;          // باركود الناشر يكفي
    return !it.labelPrinted;
  }

  function pendingCount() {
    var n = 0;
    App.allItems().forEach(function (x) { if (needsLabel(x.it)) n++; });
    return n;
  }

  /* علامة تُعرض بجانب اسم الصنف في قوائم المخزون */
  function mark(it) {
    return needsLabel(it)
      ? '<span class="lbl-dot" title="لم تُطبع لاصقته بعد">●</span>'
      : "";
  }

  function markPrinted(ids) {
    var today = App.today();
    (ids || []).forEach(function (id) {
      var it = App.findItem("book", id) || App.findItem("stat", id);
      if (it) it.labelPrinted = today;
    });
    App.save();
  }

  /* لاصقات مطبوعة من قبل بأداة خارجية: تُعلَّم بلا طباعة.
     بدون هذا تبقى الكتب القديمة في القائمة إلى الأبد. */
  function markDone(ids, quiet) {
    var list = ids && ids.length ? ids : Object.keys(sel);
    if (!list.length) { App.toast("اختر أصنافاً أولاً.", "warn"); return; }
    ensureBarcodes(list);
    markPrinted(list);
    sel = {};
    if (!quiet) App.toast("عُلِّم " + list.length + " صنفاً كمطبوع — خرجت من القائمة.", "ok");
    App.rerender();
  }

  function markOne(id) {
    ensureBarcodes([id]);
    markPrinted([id]);
    delete sel[id];
    App.rerender();
  }

  function markAllShown() {
    var ids = candidates().filter(function (r) { return needsLabel(r.it); })
      .map(function (r) { return r.it.id; });
    if (!ids.length) { App.toast("لا شيء لتعليمه.", "warn"); return; }
    App.confirm("سيُعلَّم " + ids.length + " صنفاً كأن لاصقاته طُبعت، فتخرج من القائمة " +
      "بلا طباعة.\n\nاستعمله للكتب التي لصقت لاصقاتها من قبل بأداة خارجية.",
      function () { markDone(ids); }, { yes: "علّمها كمطبوعة" });
  }

  function unmark(type, id) {
    var it = App.findItem(type, id);
    if (!it) return;
    delete it.labelPrinted;
    App.save();
    App.toast("عادت العلامة — الصنف بانتظار طباعة لاصقته.");
    App.rerender();
  }

  function candidates() {
    var nq = App.norm(view.q);
    var out = [];
    App.allItems().forEach(function (x) {
      var it = x.it;
      var printed = hasPrinted(it);
      if (view.kind === "need" && !needsLabel(it)) return;
      if (view.kind === "printed" && !printed) return;
      if (view.kind === "done" && !it.labelPrinted) return;
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
      '<button class="' + (view.kind === "need" ? "on" : "") + '" onclick="Labels.setV(\'kind\',\'need\')">لم تُطبع</button>' +
      '<button class="' + (view.kind === "done" ? "on" : "") + '" onclick="Labels.setV(\'kind\',\'done\')">طُبعت</button>' +
      '<button class="' + (view.kind === "printed" ? "on" : "") + '" onclick="Labels.setV(\'kind\',\'printed\')">باركود الناشر</button>' +
      '<button class="' + (view.kind === "all" ? "on" : "") + '" onclick="Labels.setV(\'kind\',\'all\')">الكل</button>' +
      "</div>" +
      '<div class="spacer"></div>' +
      '<button class="btn" onclick="Labels.settings()">⚙ مقاس اللاصقة</button>' +
      '<button class="btn" onclick="Labels.selectAll()">اختر المعروض</button>' +
      (chosen ? '<button class="btn ghost" onclick="Labels.clearSel()">إلغاء الاختيار</button>' : "") +
      (chosen ? '<button class="btn" onclick="Labels.markDone()">علّم المحدد كمطبوع</button>' : "") +
      (view.kind === "need" && list.length
        ? '<button class="btn ghost" onclick="Labels.markAllShown()">علّم الكل كمطبوع</button>' : "") +
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
      {
        h: "الكود", c: function (r) {
          var bc = String(r.it.barcode || "").trim();
          if (bc) return '<span class="num small">' + App.esc(bc) + "</span>";
          return '<span class="muted small">يُولَّد عند الطباعة</span>';
        }
      },
      {
        h: "الحالة", c: function (r) {
          if (r.printed) return '<span class="badge ok">باركود الناشر — لا تحتاج</span>';
          if (r.it.labelPrinted) {
            return '<span class="badge ok">طُبعت ' + App.esc(r.it.labelPrinted) + "</span> " +
              '<button class="btn sm ghost" onclick="Labels.unmark(\'' + r.type + "','" + r.it.id +
              '\')" title="أعِد العلامة إن لم تُلصق فعلاً">↺</button>';
          }
          return '<span class="badge bad">لم تُطبع</span> ' +
            '<button class="btn sm ghost" onclick="Labels.markOne(\'' + r.it.id +
            '\')" title="لاصقته ملصوقة من قبل — علّمها كمطبوعة">✓</button>';
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
      values: { w: L.w, h: L.h, maxChars: L.maxChars, showPrice: L.showPrice, showLoc: L.showLoc, prefix: L.prefix },
      fields: [
        {
          k: "w", label: "العرض (مم)", type: "number", min: 15,
          hint: "قِس لاصقتك بالمسطرة — هذا العرض يحدّ طول الباركود"
        },
        { k: "h", label: "الطول (مم)", type: "number", min: 10 },
        {
          k: "maxChars", label: "أقصى حروف للاسم", type: "number", min: 8, full: true,
          hint: "الاسم الأطول يُقطع عند آخر كلمة كاملة تدخل — مثال: «أساسيات الهندسة لتقنيات الورش» ← «أساسيات الهندسة»"
        },
        { k: "showLoc", label: "اطبع المكان (المكتبة والرف)", type: "checkbox", full: true },
        { k: "showPrice", label: "اطبع السعر على اللاصقة", type: "checkbox", full: true },
        {
          k: "prefix", label: "بادئة الباركود المولَّد (أرقام، اختيارية)", full: true,
          hint: "الرمز المولَّد أرقام فقط عمداً — الأرقام تُضغط في CODE128 فيخرج الباركود " +
            "بنصف العرض ويُقرأ على اللاصقات الصغيرة. اتركها فارغة لأقصر رمز."
        }
      ],
      onSave: function (v) {
        L.w = Math.max(15, App.num(v.w));
        L.h = Math.max(10, App.num(v.h));
        L.maxChars = Math.max(8, App.num(v.maxChars));
        L.showLoc = !!v.showLoc;
        L.showPrice = !!v.showPrice;
        L.prefix = String(v.prefix || "LIB").replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "LIB";
        App.save();
        App.toast("حُفظ مقاس اللاصقة.");
        App.rerender();
      }
    });
  }

  /* ---------- الرسم والطباعة ---------- */

  /* ارتفاع الأعمدة: ما يتبقّى من طول اللاصقة بعد الاسم والسعر.
     على لاصقة 25 مم يبقى نحو 11 مم — كافٍ للقراءة، فالقارئ يهمّه
     عرض الوحدة لا الارتفاع. */
  function barHeightPx(L) {
    var used = 2.2;                               // الهوامش العلوية والسفلية
    used += 3.4;                                  // سطر الاسم
    used += 3.0;                                  // رقم الباركود تحته
    if (L.showPrice) used += 3.6;
    if (L.showLoc) used += 2.8;
    var mm = App.num(L.h) - used;
    return Math.max(22, Math.round(mm * MM_PX));  // لا ننزل تحت 22px مهما ضاقت
  }

  function svgFor(code, L) {
    /* JsBarcode يحتاج عنصراً في الصفحة، فنرسم في عنصر مؤقت ونأخذ ناتجه */
    var f = fit(code, L.w);
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
        width: f.px,                    // محسوب ليملأ عرض اللاصقة بالضبط
        height: barHeightPx(L),
        displayValue: true,
        fontSize: Math.max(7, Math.min(11, App.num(L.w) * 0.33)),
        textMargin: 0,
        margin: 0,
        marginLeft: QUIET * f.px,       // المنطقة الهادئة ضرورية للقراءة
        marginRight: QUIET * f.px
      });
      out = holder.innerHTML;
    } catch (e) {
      out = '<div style="font:9px monospace">تعذّر رسم الباركود</div>';
    }
    document.body.removeChild(holder);
    return out;
  }

  function labelHtml(it, L) {
    var name = shortName(App.itemName(it), L.maxChars);
    var loc = it.lib ? (it.lib + " · رف " + (it.shelf || "")) : (it.loc || "");
    return '<div class="lbl-one">' +
      '<div class="lbl-name">' + App.esc(name) + "</div>" +
      '<div class="lbl-bc">' + svgFor(codeOf(it), L) + "</div>" +
      (L.showLoc && loc ? '<div class="lbl-sub">' + App.esc(loc) + "</div>" : "") +
      (L.showPrice
        ? '<div class="lbl-price">' + App.money0(it.price) + " " + App.esc(S().meta.currency || "") + "</div>"
        : "") +
      "</div>";
  }

  function preview() {
    var L = cfg();
    var ids = Object.keys(sel);
    if (!ids.length) { App.toast("اختر أصنافاً أولاً.", "warn"); return; }

    var made = ensureBarcodes(ids);
    if (made) App.toast("وُلِّد باركود لـ" + made + " صنف بلا باركود، وحُفظ عليه.", "ok");

    var body = "";
    var n = 0;
    ids.forEach(function (id) {
      var it = App.findItem("book", id) || App.findItem("stat", id);
      if (!it) return;
      var copies = App.num(sel[id]);
      for (var i = 0; i < copies; i++) { body += labelHtml(it, L); n++; }
    });

    if (!n) { App.toast("لا لاصقات للطباعة.", "warn"); return; }

    var nameMm = Math.max(3, Math.min(4.6, App.num(L.h) * 0.16));
    var css =
      "<style>" +
      "@page { size: " + L.w + "mm " + L.h + "mm; margin: 0; }" +
      ".lbl-sheet{direction:rtl}" +
      ".lbl-one{width:" + L.w + "mm;height:" + L.h + "mm;box-sizing:border-box;" +
      "padding:" + PAD_MM + "mm;display:flex;flex-direction:column;align-items:center;" +
      "justify-content:center;gap:0.3mm;overflow:hidden;" +
      "page-break-after:always;break-after:page;font-family:Tahoma,Arial,sans-serif}" +
      ".lbl-one:last-child{page-break-after:auto;break-after:auto}" +
      ".lbl-name{font-size:" + (App.num(L.w) < 36 ? "6.5pt" : "8pt") + ";font-weight:700;" +
      "line-height:1.1;text-align:center;max-height:" + nameMm + "mm;overflow:hidden;" +
      "width:100%;white-space:nowrap;text-overflow:ellipsis}" +
      ".lbl-bc{width:100%;display:flex;justify-content:center;line-height:0}" +
      ".lbl-bc svg{max-width:100%;height:auto;display:block}" +
      ".lbl-sub{font-size:5.5pt;color:#333}" +
      ".lbl-price{font-size:" + (App.num(L.w) < 36 ? "8pt" : "9.5pt") + ";font-weight:700;line-height:1.1}" +
      "</style>";

    var wf = worstFit();
    var warn = "";
    if (wf && !wf.safe) {
      warn = '<div style="background:var(--warn-bg,#FBF3E2);border:1px solid var(--warn-line,#E8D5A8);' +
        'border-radius:9px;padding:11px 13px;margin-bottom:12px;line-height:1.8;font-size:13.5px">' +
        "<b>تحذير: قد لا يقرأ القارئ هذه اللاصقات.</b><br>" +
        "عرض أنحف عمود فيها " + wf.mm.toFixed(3) + " مم، والقارئات تحتاج " + SAFE_MM + " مم فأكثر.<br>" +
        "الحل: قصّر الباركود إلى <b>" + maxDigitsFor(L.w) + " رقماً أو أقل</b> (امسح خانة البادئة " +
        "من إعدادات اللاصقة)، أو زد عرض اللاصقة." +
        "</div>";
    }

    App.modal({
      title: "معاينة اللاصقات — " + n + " لاصقة",
      size: "wide",
      body: warn +
        '<p class="muted small" style="margin-top:0;line-height:1.8">' +
        "كل لاصقة في صفحة مستقلة بمقاس " + L.w + "×" + L.h + " مم" +
        (wf ? " · عرض العمود " + wf.mm.toFixed(3) + " مم" + (wf.safe ? " ✓" : "") : "") + ". " +
        'قبل الطباعة: اختر طابعة اللاصقات، وأطفئ «رؤوس وتذييلات الصفحات» من إعدادات الطباعة.</p>' +
        css.replace("@page { size: " + L.w + "mm " + L.h + "mm; margin: 0; }", "") +
        '<div class="lbl-sheet" style="display:flex;flex-wrap:wrap;gap:6px;max-height:50vh;overflow:auto;' +
        'background:var(--surface-2);padding:10px;border-radius:8px">' +
        body.replace(/page-break-after:always/g, "") + "</div>",
      actions: [{
        label: "طباعة الآن", kind: "primary", click: function (close) {
          App.printHtml(css + '<div class="lbl-sheet">' + body + "</div>");
          markPrinted(ids);
          close();
          App.toast("طُبعت " + n + " لاصقة — أُزيلت علامتها الحمراء.", "ok");
          sel = {};
          App.rerender();
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
    shortName: shortName, hasPrinted: hasPrinted, codeOf: codeOf,
    fit: fit, moduleCount: moduleCount, maxDigitsFor: maxDigitsFor, barHeightPx: barHeightPx,
    needsLabel: needsLabel, pendingCount: pendingCount, mark: mark,
    markPrinted: markPrinted, unmark: unmark,
    ensureBarcodes: ensureBarcodes, newBarcode: newBarcode,
    markDone: markDone, markOne: markOne, markAllShown: markAllShown
  };
})();
