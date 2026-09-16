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
    if (L.showLoc === undefined) L.showLoc = true;    // المكتبة والرف على اللاصقة
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
  function newBarcode(taken, maxDigits) {
    var pre = String(cfg().prefix || "").replace(/\D/g, "").slice(0, 3);
    /* الطول يقصر ليدخل على اللاصقة الضيقة، ولا ينزل عن أربعة أرقام */
    var cap = Math.max(4, Math.min(8, App.num(maxDigits) || 8));
    var len = Math.max(1, cap - pre.length);
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
  var PAD_MM = 1.2;            // هامش داخلي لكل جهة
  var QUIET = 10;              // وحدات المنطقة الهادئة لكل جهة

  /* ---------- لماذا لا تُقرأ بعض اللاصقات ----------

     القارئ لا يقيس عرض العمود، بل **نسب** الأعمدة إلى بعضها. وأعمدة
     CODE128 بعروض ١ و٢ و٣ و٤ وحدات.

     الطابعة لا تطبع إلا نقاطاً كاملة. فإن كانت الوحدة ٢٫٢٣ نقطة:
       عمود ١ وحدة  = 2.23 نقطة → يُطبع 2
       عمود ٣ وحدات = 6.69 نقطة → يُطبع 7   (المفروض 6)
       عمود ٤ وحدات = 8.92 نقطة → يُطبع 9   (المفروض 8)
     فتنكسر النسب ويفشل فكّ الترميز — والباركود يبدو سليماً للعين.

     العلاج: نثبّت الوحدة على عدد **صحيح** من نقاط الطابعة. عندها كل
     العروض مضاعفات صحيحة ولا تتشوّه نسبة واحدة.

     و0.19 مم كان حدّاً نظرياً لطابعات وقارئات ممتازة. الحدّ العملي
     لقارئ المحل الرخيص 0.25 مم. */
  var DPI = 203;               // أشيع طابعات اللاصقات الحرارية
  var DOT_MM = 25.4 / DPI;     // ‏0.1251 مم
  var SAFE_MM = 0.25;          // أقل عرض وحدة يُقرأ عملياً (10 mil)
  var MIN_DOTS = Math.ceil(SAFE_MM / DOT_MM);   // نقطتان = 0.2502 مم

  /* ISBN المطبوع على الغلاف هو EAN-13، وترميزه الأصلي أضيق كثيراً من
     CODE128: ‏95 وحدة مقابل 145. بهذا تُطبع لاصقة الكتاب ذي الـISBN
     بعرض يُقرأ بدل أن نضطر لاستبدال رقم الناشر برمز من عندنا. */
  function isEan13(code) {
    var s2 = String(code || "").trim();
    if (!/^\d{13}$/.test(s2)) return false;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+s2[i]) * (i % 2 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === +s2[12];
  }

  function moduleCount(code) {
    var s2 = String(code || "");
    if (isEan13(s2)) return 95;                 // ترميز EAN-13 الكامل
    // كل الأرقام: وضع C يضغط رقمين في رمز واحد
    var symbols = /^\d+$/.test(s2) ? Math.ceil(s2.length / 2) : s2.length;
    // بداية + بيانات + تدقيق + إيقاف
    return 11 + symbols * 11 + 11 + 13;
  }

  /* أوسع وحدة تدخل في اللاصقة، وهل هي آمنة */
  /* عرض الوحدة مثبَّتاً على نقاط كاملة، ولا ينزل تحت الحدّ العملي.
     الباركود يخرج أضيق قليلاً من عرض اللاصقة — وهذا مقصود: يُتوسَّط،
     وتكبر المنطقة الهادئة حوله، وكلاهما في صالح القراءة. */
  function fit(code, widthMm) {
    var usable = Math.max(5, App.num(widthMm) - PAD_MM * 2);
    var mods = moduleCount(code) + QUIET * 2;
    /* عرض الوحدة نقاطٌ كاملة تدخل في اللاصقة دائماً — فالباركود يُطبع
       كاملاً غير مقصوص مهما ضاقت. و«safe» تقول هل بلغ الحدّ المريح
       للقارئ الرخيص: إن لم يبلغه نطبع وننبّه، ولا نمتنع. */
    var dots = Math.max(1, Math.floor(usable / mods / DOT_MM));
    var mm = dots * DOT_MM;
    var need = MIN_DOTS * DOT_MM * mods + PAD_MM * 2;   // عرض اللاصقة المريح
    return {
      mm: mm, px: Math.max(0.5, mm * MM_PX), mods: mods, dots: dots,
      need: need,
      safe: dots >= MIN_DOTS,
      width: mm * mods
    };
  }

  /* أطول رمز رقمي يدخل بأمان على هذا العرض */
  function maxDigitsFor(widthMm) {
    var usable = Math.max(5, App.num(widthMm) - PAD_MM * 2);
    var maxMods = Math.floor(usable / (MIN_DOTS * DOT_MM));
    var symbols = Math.floor((maxMods - QUIET * 2 - 35) / 11);
    return Math.max(0, symbols * 2);
  }

  /* أقل عرض لاصقة يكفي هذا الرمز */
  function widthNeeded(code) {
    return moduleCount(code) + QUIET * 2 > 0
      ? (moduleCount(code) + QUIET * 2) * MIN_DOTS * DOT_MM + PAD_MM * 2
      : 0;
  }

  function worstFit() {
    var L = cfg(), worst = null;
    Object.keys(sel).forEach(function (id) {
      var it = App.findItem("book", id) || App.findItem("stat", id);
      if (!it) return;
      var f = fit(codeOf(it) || "12345678", L.w);
      if (!worst || f.need > worst.need) worst = f;
    });
    return worst;
  }

  /* الأصناف التي لا يدخل باركودها على عرض اللاصقة بحجم يُقرأ.
     تسميتها بالاسم توفّر على صاحب المحل تخمين أيّها المعطِّل. */
  function tooLong() {
    var L = cfg(), out = [];
    Object.keys(sel).forEach(function (id) {
      var it = App.findItem("book", id) || App.findItem("stat", id);
      if (!it) return;
      var code = codeOf(it) || "12345678";
      var f = fit(code, L.w);
      if (!f.safe) out.push({ it: it, id: id, code: code, need: f.need });
    });
    return out;
  }

  /* يستبدل الباركود الطويل برمز قصير من توليد المنظومة.

     الكتاب الذي عليه ISBN مطبوع من الناشر لا يحتاج لاصقة أصلاً —
     امسح باركود الغلاف. وهذا الزر لمن يريد لاصقة موحّدة على كل شيء:
     يولّد رمزاً من ٨ أرقام يدخل على لاصقة ٣٠ مم بعرض مقروء،
     ويحفظه على الصنف فيتطابق ما على اللاصقة مع ما في المنظومة. */
  function shortenCodes() {
    var list = tooLong();
    if (!list.length) { App.toast("كل الباركودات تدخل على هذه اللاصقة.", "ok"); return; }
    var names = list.slice(0, 6).map(function (x) { return App.itemName(x.it); }).join("\n• ");
    App.confirm(
      "سيُستبدل الباركود الطويل بـ" + list.length + " صنفاً برمز قصير من ٨ أرقام يدخل على " +
      "اللاصقة ويُقرأ.\n\n• " + names + (list.length > 6 ? "\n… و" + (list.length - 6) + " غيرها" : "") +
      "\n\nانتبه: الباركود المطبوع على غلاف الكتاب لن يعمل بعدها في نقطة البيع — " +
      "استعمل اللاصقة الجديدة.",
      function () {
        var taken = allBarcodes(), n = 0;
        list.forEach(function (x) {
          var code = newBarcode(taken);
          taken[code] = 1;
          x.it.barcode = code;
          n++;
        });
        App.log("لاصقات", "قُصّر باركود " + n + " صنف");
        App.saveNow();
        App.rerender();
        App.toast("قُصّر باركود " + n + " صنف — أعد الطباعة الآن.", "ok");
      },
      { danger: true, yes: "استبدل الباركود" });
  }

  /* ---------- رمز يدخل على اللاصقة دائماً ----------

     الحروف والرموز (كالشَرطة) تكسر ضغط الأرقام في CODE128: رمز مثل
     «0-200469» يحتاج 38 مم بينما «0200469» يحتاج 27 مم — الشَرطة
     وحدها تكلّف 11 مم.

     فبدل أن نقول «لا يدخل»، نُصلحه: نحذف ما ليس رقماً، وإن بقي
     طويلاً نولّد رمزاً أقصر. ويُحفظ على الصنف فيتطابق ما على اللاصقة
     مع ما في المنظومة، ويعمل المسح في نقطة البيع. */
  function fixCode(it, L, taken) {
    /* بلا باركود: يُولَّد واحد ويُحفظ — فيُمسح في نقطة البيع.
       (كود المنظومة K0001 ليس باركوداً: حروفه تضاعف عرض الأعمدة.) */
    var had = String(it.barcode || "").trim();
    if (!had) return { code: newBarcode(taken, maxDigitsFor(L.w)), why: "رمز جديد" };

    if (fit(had, L.w).safe) return null;                 // يدخل كما هو

    /* باركود الناشر لا يُستبدل تلقائياً أبداً: هو المطبوع على الغلاف،
       وتغييره يُبطل مسح الغلاف في نقطة البيع. يُطبع كما هو — ومن أراد
       استبداله فزرّ «تقصير الباركود» يفعلها بعد تحذير صريح. */
    if (hasPrinted(it)) return null;

    var digits = had.replace(/\D/g, "");
    if (digits && digits.length >= 4 && fit(digits, L.w).safe &&
        (!taken[digits] || digits === had)) {
      return { code: digits, why: "حُذفت الرموز غير الرقمية" };
    }
    return { code: newBarcode(taken, maxDigitsFor(L.w)), why: "رمز أقصر" };
  }

  /* تُستدعى قبل الطباعة: تملأ الباركود الناقص وتحفظ */
  function ensureBarcodes(ids) {
    var taken = allBarcodes();
    var L = cfg();
    var made = 0, fixed = 0;
    (ids || []).forEach(function (id) {
      var it = App.findItem("book", id) || App.findItem("stat", id);
      if (!it) return;
      var had = String(it.barcode || "").trim();
      /* لا يُطبع رمز لا يُقرأ: يُصلَح قبل الطباعة ويُحفظ */
      var f = fixCode(it, L, taken);
      if (!f) return;
      delete taken[had];
      it.barcode = f.code;
      taken[f.code] = 1;
      it.updated = App.nowStamp();
      if (had) fixed++; else made++;
    });
    if (made || fixed) {
      if (fixed) App.log("لاصقات", "صُحّح باركود " + fixed + " صنف ليدخل على اللاصقة");
      App.save();
    }
    return { made: made, fixed: fixed };
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
      emptyIcon: "books", emptyTitle: "لا أصناف",
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
          k: "prefix", label: "بادئة الباركود المولَّد (أرقام فقط، اختيارية)", full: true,
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
        /* الفارغة تبقى فارغة: الحروف تكسر ضغط الأرقام في CODE128
           فيخرج الباركود بضعف العرض. وكانت تُقلب إلى «LIB» رغم أن
           الشرح يقول اتركها فارغة. */
        L.prefix = String(v.prefix || "").replace(/[^0-9]/g, "");
        App.save();
        App.toast("حُفظ مقاس اللاصقة.");
        App.rerender();
      }
    });
  }

  /* ---------- الرسم والطباعة ---------- */

  /* ارتفاع الأعمدة: ما يتبقّى من طول اللاصقة بعد الاسم والسعر.

     العمود الأطول يسامح ميلان القارئ: الشعاع يقطع الباركود مائلاً
     فيمرّ على أعمدة أكثر. لذلك نعطيه كل ما يفيض ولا ننزل عن ٨ مم —
     الحدّ الذي توصي به مواصفات القراءة اليدوية. */
  function barHeightPx(L) {
    /* تُحسب من نفس أرقام الـCSS أدناه، لا بالتقريب: التقريب كان يزيد
       المحتوى على طول اللاصقة فيُقصّ اسم الكتاب من أسفله. */
    var h = App.num(L.h);
    var used = PAD_MM * 2;                        // الهامش الداخلي أعلى وأسفل
    used += 0.6;                                  // الفراغان بين الصفوف الثلاثة
    used += nameLineMm(L);                        // سطر الاسم
    used += numLineMm(L);                         // رقم الباركود (يرسمه JsBarcode داخل الـSVG)
    if (L.showPrice || L.showLoc) used += footLineMm(L);   // المكان والسعر في سطر واحد
    /* ٨ مم أقل ارتفاع يوصى به للقراءة، لكن لا نتجاوز طول اللاصقة أبداً:
       لاصقة تُقصّ أسوأ من لاصقة أعمدتها أقصر. */
    var mm = h - used;
    if (mm > 8) mm = Math.max(8, mm);
    return Math.max(12, Math.round(Math.max(3, mm) * MM_PX));
  }

  /* اللاصقة القصيرة تُصغّر سطورها لا أعمدتها: ارتفاع العمود هو ما
     يسامح ميلان القارئ، والنص يُقرأ بالعين ولو دقّ. */
  function rowScale(L) {
    var h = App.num(L.h);
    return h >= 22 ? 1 : Math.max(0.72, h / 22);
  }
  function namePt(L) { return (App.num(L.w) < 36 ? 6.5 : 8) * rowScale(L); }
  function nameLineMm(L) { return namePt(L) * (96 / 72) * 1.1 / MM_PX; }
  function numPt(L) { return Math.max(5, Math.min(11, App.num(L.w) * 0.33) * rowScale(L)); }
  function numLineMm(L) { return numPt(L) / MM_PX + 0.4; }
  function pricePt(L) { return 8.5 * rowScale(L); }
  function locPt(L) { return 6 * rowScale(L); }
  function footLineMm(L) { return pricePt(L) * (96 / 72) * 1.2 / MM_PX + 0.2; }

  function svgFor(code, L) {
    /* JsBarcode يحتاج عنصراً في الصفحة، فنرسم في عنصر مؤقت ونأخذ ناتجه */
    var f = fit(code, L.w);

    /* يُرسم دائماً: العرض محسوب ليدخل كاملاً غير مقصوص. وإن ضاقت
       اللاصقة عن الحدّ المريح للقارئ، فالتنبيه في أعلى المعاينة —
       لاصقة فيها باركود خيرٌ من لاصقة فيها اعتذار. */

    var holder = document.createElement("div");
    holder.style.position = "absolute";
    holder.style.left = "-9999px";
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    holder.appendChild(svg);
    document.body.appendChild(holder);
    var out = "";
    try {
      JsBarcode(svg, String(code), {
        format: isEan13(code) ? "EAN13" : "CODE128",
        flat: true,                     // العرض يبقى 95 وحدة بالضبط
        width: f.px,                    // محسوب ليملأ عرض اللاصقة بالضبط
        height: barHeightPx(L),
        displayValue: true,
        fontSize: numPt(L),
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

  /* الـCSS من نفس أرقام barHeightPx: فصلهما كان سبب قصّ اسم الكتاب */
  function labelCss(L) {
    var nameMm = nameLineMm(L);          // نفس الرقم المحجوز في barHeightPx
    return "<style>" +
      "@page { size: " + L.w + "mm " + L.h + "mm; margin: 0; }" +
      ".lbl-sheet{direction:rtl}" +
      ".lbl-one{width:" + L.w + "mm;height:" + L.h + "mm;box-sizing:border-box;" +
      "padding:" + PAD_MM + "mm;display:flex;flex-direction:column;align-items:center;" +
      "justify-content:center;gap:0.3mm;overflow:hidden;" +
      "page-break-after:always;break-after:page;font-family:Tahoma,Arial,sans-serif}" +
      ".lbl-one:last-child{page-break-after:auto;break-after:auto}" +
      ".lbl-name{font-size:" + namePt(L).toFixed(2) + "pt;font-weight:700;" +
      "line-height:1.1;text-align:center;max-height:" + nameMm + "mm;overflow:hidden;" +
      "width:100%;white-space:nowrap;text-overflow:ellipsis}" +
      ".lbl-bc{width:100%;display:flex;justify-content:center;line-height:0}" +
      /* بلا max-width: تصغير الباركود ليدخل يُنقص عرض العمود تحت الحدّ
         الذي يقرؤه الماسح، فيخرج باركود يبدو سليماً ولا يُقرأ. الحجم
         محسوب ليدخل أصلاً، وما لا يدخل لا يُرسم. */
      ".lbl-bc svg{display:block}" +
      ".lbl-foot{width:100%;display:flex;align-items:baseline;justify-content:space-between;" +
      "gap:1mm;margin-top:0.2mm}" +
      ".lf-loc{font-size:" + locPt(L).toFixed(2) + "pt;font-weight:700;color:#000;white-space:nowrap}" +
      ".lf-price{font-size:" + pricePt(L).toFixed(2) + "pt;font-weight:700;white-space:nowrap}" +
      "</style>";
  }

  function labelHtml(it, L) {
    var name = shortName(App.itemName(it), L.maxChars);
    var loc = it.lib ? (it.lib + "·" + (it.shelf || "")) : (it.loc || "");
    /* المكان والسعر في سطر واحد: المكان يميناً والسعر يساراً، فيدخلان
       معاً على لاصقة قصيرة بدل أن يأكل كلٌّ سطراً. */
    var foot = "";
    if ((L.showLoc && loc) || L.showPrice) {
      foot = '<div class="lbl-foot">' +
        (L.showLoc && loc ? '<span class="lf-loc">' + App.esc(loc) + "</span>" : "<span></span>") +
        (L.showPrice
          ? '<span class="lf-price">' + App.money0(it.price) + " " +
            App.esc(S().meta.currency || "") + "</span>"
          : "") +
        "</div>";
    }
    return '<div class="lbl-one">' +
      '<div class="lbl-name">' + App.esc(name) + "</div>" +
      '<div class="lbl-bc">' + svgFor(codeOf(it), L) + "</div>" +
      foot + "</div>";
  }

  function preview() {
    var L = cfg();
    var ids = Object.keys(sel);
    if (!ids.length) { App.toast("اختر أصنافاً أولاً.", "warn"); return; }

    var r = ensureBarcodes(ids);
    if (r.made) App.toast("وُلِّد باركود لـ" + r.made + " صنف بلا باركود، وحُفظ عليه.", "ok");
    if (r.fixed) App.toast("صُحّح باركود " + r.fixed + " صنف ليدخل على اللاصقة ويُقرأ.", "ok");

    var body = "";
    var n = 0;
    ids.forEach(function (id) {
      var it = App.findItem("book", id) || App.findItem("stat", id);
      if (!it) return;
      var copies = App.num(sel[id]);
      for (var i = 0; i < copies; i++) { body += labelHtml(it, L); n++; }
    });

    if (!n) { App.toast("لا لاصقات للطباعة.", "warn"); return; }

    var css = labelCss(L);
    /* لا امتناع: كل رمز أُصلح قبل الطباعة ليدخل، وكل باركود يُرسم.
       يبقى تنبيهٌ واحد فوق المعاينة لحالة نادرة — لاصقة أضيق من أن
       يخرج عمودها بالعرض المريح للقارئ الرخيص. تُطبع على أي حال. */
    var bad = tooLong();
    var wf = worstFit();
    var warn = "";
    if (bad.length) {
      warn = '<div style="background:var(--amber-wash);border:1px solid #EDDCB0;' +
        'border-radius:9px;padding:12px 14px;margin-bottom:12px;line-height:1.85;font-size:13.5px">' +
        "<b>ستُطبع كلها،</b> لكن " + bad.length + " لاصقة عمودها أدقّ من المريح للماسح. " +
        "لو تعثّرت القراءة اجعل عرض اللاصقة " + Math.ceil(wf.need) + " مم فأكثر من «مقاس اللاصقة»." +
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
    preview: preview, shortenCodes: shortenCodes, tooLong: tooLong,
    /* للاختبار: قياس الهندسة الفعلية */
    __fit: fit, __svgFor: svgFor, __barH: barHeightPx, __cfg: cfg, __labelHtml: labelHtml, __labelCss: labelCss,
    isEan13: isEan13, forItems: forItems, one: one,
    shortName: shortName, hasPrinted: hasPrinted, codeOf: codeOf,
    fit: fit, moduleCount: moduleCount, maxDigitsFor: maxDigitsFor, barHeightPx: barHeightPx,
    needsLabel: needsLabel, pendingCount: pendingCount, mark: mark,
    markPrinted: markPrinted, unmark: unmark,
    ensureBarcodes: ensureBarcodes, newBarcode: newBarcode,
    markDone: markDone, markOne: markOne, markAllShown: markAllShown
  };
})();
