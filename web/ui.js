/* ============================================================
   ui.js — الشاشات والكاميرا
   ============================================================ */

var UI = (function () {

  var tab = "add";
  var busy = false;

  function S() { return App.S; }
  function el(id) { return document.getElementById(id); }
  function esc(s) { return App.esc(s); }

  /* ---------- تنبيهات ---------- */

  function toast(msg, kind) {
    var t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.textContent = msg;
    el("toasts").appendChild(t);
    setTimeout(function () { t.remove(); }, 3600);
  }

  /* ---------- شريط سفلي ---------- */

  function sheet(title, html, onOpen) {
    var s = el("sheet");
    s.innerHTML = '<div class="inner"><div class="grab"></div>' +
      (title ? "<h2>" + esc(title) + "</h2>" : "") + html + "</div>";
    s.hidden = false;
    s.onclick = function (e) { if (e.target === s) closeSheet(); };
    if (onOpen) setTimeout(onOpen, 0);
  }

  function closeSheet() {
    var s = el("sheet");
    s.hidden = true;
    s.innerHTML = "";
    stopCam();
  }

  /* ---------- التنقل ---------- */

  function go(t) {
    tab = t;
    stopCam();
    closeSheet();
    document.querySelectorAll("#tabs button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.tab === t);
    });
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    var v = el("view");
    if (tab === "add") v.innerHTML = addPage();
    else if (tab === "list") v.innerHTML = listPage();
    else v.innerHTML = settingsPage();
    paintCount();
    el("shopName").textContent = S().cfg.shopName || "";
  }

  function paintCount() {
    var n = S().books.length;
    var c = el("listCount");
    if (n > 0) { c.hidden = false; c.textContent = n; } else c.hidden = true;
  }

  /* ---------- شاشة الإضافة ---------- */

  function addPage() {
    var hasKey = !!String(S().cfg.geminiKey || "").trim();
    return '' +
      '<div class="card">' +
      "<h2>امسح باركود الكتاب</h2>" +
      '<p class="sub">أسرع وأدق طريق، ومجاني تماماً. أغلب الكتب الإنجليزية ' +
      "والطبية عليها باركود ISBN على الغلاف الخلفي.</p>" +
      '<button class="btn primary" onclick="UI.scan()"><span class="big">▥</span> افتح الكاميرا وامسح</button>' +
      '<button class="btn" onclick="UI.typeIsbn()">اكتب رقم ISBN بيدك</button>' +
      "</div>" +

      '<div class="card">' +
      "<h2>أو صوّر الغلاف</h2>" +
      '<p class="sub">للكتب العربية التي بلا باركود. يستخرج الاسم والمؤلف ' +
      "والتخصص، ويكتب ملاحظة عن محتوى الكتاب ولمن هو موجّه.</p>" +
      (hasKey
        ? '<button class="btn primary" onclick="UI.pickCover()"><span class="big">◲</span> صوّر الغلاف</button>'
        : '<div class="empty" style="padding:18px 6px">' +
        "<h4>يحتاج مفتاحاً مجانياً</h4>" +
        '<p>خذ مفتاح Gemini المجاني من Google AI Studio (بلا بطاقة) وضعه في الإعدادات مرة واحدة.</p>' +
        '<button class="btn" style="margin-top:12px" onclick="UI.go(\'settings\')">افتح الإعدادات</button></div>') +
      "</div>" +

      '<div class="card">' +
      "<h2>أو أدخله يدوياً</h2>" +
      '<p class="sub">حين لا تعمل الكاميرا أو تريد كتابة كل شيء بنفسك.</p>' +
      '<button class="btn" onclick="UI.edit()">إضافة كتاب فارغ</button>' +
      "</div>";
  }

  /* ---------- الكاميرا ---------- */

  var stream = null, scanning = false, detector = null, rafId = 0;

  function stopCam() {
    scanning = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (stream) {
      stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { } });
      stream = null;
    }
  }

  function scan() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("متصفحك لا يدعم الكاميرا — اكتب الرقم بيدك.", "warn");
      typeIsbn();
      return;
    }
    if (!("BarcodeDetector" in window)) {
      sheet("المسح غير مدعوم", '<p class="sub">متصفحك لا يدعم قراءة الباركود مباشرة. ' +
        "استعمل Chrome على أندرويد، أو اكتب رقم ISBN بيدك — وهو مكتوب بالأرقام " +
        "تحت الباركود على الغلاف.</p>" +
        '<button class="btn primary" onclick="UI.typeIsbn()">اكتب الرقم بيدي</button>' +
        '<button class="btn" onclick="UI.closeSheet()">إغلاق</button>');
      return;
    }

    sheet("امسح الباركود",
      '<div id="camWrap"><video id="cam" playsinline muted></video>' +
      '<div class="aim"></div><div class="say">وجّه المربع على الباركود</div></div>' +
      '<button class="btn" onclick="UI.typeIsbn()">اكتب الرقم بيدي بدلاً من ذلك</button>' +
      '<button class="btn" onclick="UI.closeSheet()">إلغاء</button>',
      startCam);
  }

  function startCam() {
    var video = el("cam");
    if (!video) return;
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false
    }).then(function (st) {
      stream = st;
      video.srcObject = st;
      return video.play();
    }).then(function () {
      try {
        detector = new window.BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"]
        });
      } catch (e) {
        detector = new window.BarcodeDetector();
      }
      scanning = true;
      tick(video);
    }).catch(function (e) {
      var msg = (e && e.name === "NotAllowedError")
        ? "لم تُسمح الكاميرا. اسمح بها من إعدادات المتصفح، أو اكتب الرقم بيدك."
        : "تعذّر فتح الكاميرا: " + (e && e.message ? e.message : "");
      sheet("تعذّر فتح الكاميرا", '<p class="sub">' + esc(msg) + "</p>" +
        '<button class="btn primary" onclick="UI.typeIsbn()">اكتب الرقم بيدي</button>' +
        '<button class="btn" onclick="UI.closeSheet()">إغلاق</button>');
    });
  }

  function tick(video) {
    if (!scanning) return;
    detector.detect(video).then(function (codes) {
      if (!scanning) return;
      for (var i = 0; i < codes.length; i++) {
        var raw = App.cleanIsbn(codes[i].rawValue);
        if (App.validIsbn(raw)) {
          scanning = false;
          try { navigator.vibrate && navigator.vibrate(60); } catch (e) { }
          stopCam();
          onIsbn(raw);
          return;
        }
      }
      rafId = requestAnimationFrame(function () { tick(video); });
    }).catch(function () {
      rafId = requestAnimationFrame(function () { tick(video); });
    });
  }

  function typeIsbn() {
    sheet("اكتب رقم ISBN",
      '<p class="sub">الرقم مكتوب بالأرقام تحت الباركود على الغلاف الخلفي، ' +
      "ويبدأ غالباً بـ978.</p>" +
      '<div class="field"><input class="inp num" id="isbnBox" type="text" ' +
      'inputmode="numeric" placeholder="9781234567890" autocomplete="off"></div>' +
      '<div id="isbnMsg"></div>' +
      '<button class="btn primary" onclick="UI.submitIsbn()">ابحث عن الكتاب</button>' +
      '<button class="btn" onclick="UI.closeSheet()">إلغاء</button>',
      function () { var b = el("isbnBox"); if (b) b.focus(); });
  }

  function submitIsbn() {
    var v = el("isbnBox");
    if (!v) return;
    var raw = App.cleanIsbn(v.value);
    if (!raw) { toast("اكتب الرقم أولاً.", "warn"); return; }
    if (!App.validIsbn(raw)) {
      el("isbnMsg").innerHTML =
        '<p class="hint" style="color:var(--warn)">هذا الرقم لا يبدو ISBN صحيحاً ' +
        "(خانة التدقيق لا تطابق). سنبحث عنه على أي حال.</p>";
    }
    onIsbn(raw);
  }

  /* ---------- بعد الحصول على ISBN ---------- */

  function onIsbn(isbn) {
    if (busy) return;
    busy = true;
    sheet("جارٍ البحث…",
      '<p class="sub">رقم الكتاب: <b class="num">' + esc(isbn) + "</b></p>" +
      '<div class="busy"><i></i></div>' +
      '<p class="hint">نبحث في Open Library وGoogle Books — بلا رسوم.</p>');

    App.lookupIsbn(isbn).then(function (found) {
      busy = false;
      if (found) {
        var b = App.addBook(found);
        closeSheet();
        toast("وُجد: " + (found.title || "").slice(0, 40), "ok");
        edit(b.id, true);
        return;
      }
      notFound(isbn);
    }).catch(function (e) {
      busy = false;
      sheet("تعذّر البحث",
        '<p class="sub">لم نصل إلى خدمات البحث. تأكد من الإنترنت وحاول مرة أخرى، ' +
        "أو أدخل الكتاب يدوياً.</p>" +
        '<p class="hint">' + esc(e && e.message ? e.message : "") + "</p>" +
        '<button class="btn primary" onclick="UI.onIsbn(\'' + esc(isbn) + '\')">حاول مرة أخرى</button>' +
        '<button class="btn" onclick="UI.editWithIsbn(\'' + esc(isbn) + '\')">أدخله يدوياً</button>' +
        '<button class="btn" onclick="UI.closeSheet()">إغلاق</button>');
    });
  }

  function notFound(isbn) {
    var hasKey = !!String(S().cfg.geminiKey || "").trim();
    sheet("لم نجد هذا الكتاب",
      '<p class="sub">الرقم <b class="num">' + esc(isbn) + "</b> غير موجود في قواعد " +
      "البيانات المجانية. هذا طبيعي في الكتب العربية والمحلية.</p>" +
      (hasKey
        ? '<button class="btn primary" onclick="UI.pickCover(\'' + esc(isbn) + '\')">صوّر الغلاف بدلاً من ذلك</button>'
        : "") +
      '<button class="btn" onclick="UI.editWithIsbn(\'' + esc(isbn) + '\')">أدخله يدوياً</button>' +
      '<button class="btn" onclick="UI.closeSheet()">إلغاء</button>');
  }

  function editWithIsbn(isbn) {
    var b = App.addBook({ barcode: isbn, source: "يدوي" });
    closeSheet();
    edit(b.id, true);
  }

  /* ---------- تصوير الغلاف ---------- */

  function pickCover(isbn) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.capture = "environment";
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      document.body.removeChild(inp);
      if (f) readCover(f, isbn);
    };
    inp.click();
  }

  function readCover(file, isbn) {
    if (busy) return;
    busy = true;
    sheet("جارٍ قراءة الغلاف…",
      '<div class="busy"><i></i></div>' +
      '<p class="hint">تُرسل الصورة إلى Gemini لقراءتها. قد تأخذ بضع ثوانٍ ' +
      "على شبكة بطيئة.</p>");

    App.readCover(file).then(function (got) {
      busy = false;
      if (isbn && !got.barcode) got.barcode = isbn;
      var b = App.addBook(got);
      closeSheet();
      if (got.confidence && got.confidence < 60) {
        toast("القراءة غير واثقة — راجع الاسم.", "warn");
      } else {
        toast("قُرئ الغلاف.", "ok");
      }
      edit(b.id, true);
    }).catch(function (e) {
      busy = false;
      var m = e && e.message;
      var body, title = "تعذّرت قراءة الغلاف";
      if (m === "NOKEY") {
        title = "يحتاج مفتاحاً";
        body = '<p class="sub">ضع مفتاح Gemini المجاني في الإعدادات أولاً.</p>' +
          '<button class="btn primary" onclick="UI.go(\'settings\')">افتح الإعدادات</button>';
      } else if (m === "BADKEY") {
        title = "المفتاح غير مقبول";
        body = '<p class="sub">تأكد أنك نسخت المفتاح كاملاً من Google AI Studio، ' +
          "وأن خدمة Generative Language مفعّلة له.</p>" +
          '<button class="btn primary" onclick="UI.go(\'settings\')">راجع المفتاح</button>';
      } else if (m === "QUOTA") {
        title = "انتهت حصة اليوم";
        body = '<p class="sub">بلغت حد الاستعمال المجاني لهذا اليوم. جرّب غداً، ' +
          "أو سجّل الكتب بالباركود فهو بلا حد.</p>";
      } else {
        body = '<p class="sub">' + esc(m || "خطأ غير معروف") + "</p>";
      }
      sheet(title, body +
        '<button class="btn" onclick="UI.edit()">أدخله يدوياً</button>' +
        '<button class="btn" onclick="UI.closeSheet()">إغلاق</button>');
    });
  }

  /* ---------- تحرير كتاب ---------- */

  function edit(id, isNew) {
    var b = id ? App.get(id) : App.addBook({ source: "يدوي" });
    if (!b) return;
    var cats = S().cfg.cats;
    var cur = b.cat || "";
    var known = cats.indexOf(cur) >= 0;

    sheet(isNew ? "راجع وأكمل" : "تعديل الكتاب",
      '<div class="field"><label>اسم الكتاب *</label>' +
      '<input class="inp" id="e_title" value="' + esc(b.title) + '"></div>' +

      '<div class="field"><label>المؤلف</label>' +
      '<input class="inp" id="e_author" value="' + esc(b.author) + '"></div>' +

      '<div class="two">' +
      '<div class="field"><label>سعر البيع *</label>' +
      '<input class="inp num" id="e_price" type="text" inputmode="decimal" value="' +
      (b.price || "") + '" placeholder="0"></div>' +
      '<div class="field"><label>الكمية *</label>' +
      '<input class="inp num" id="e_qty" type="text" inputmode="numeric" value="' +
      (b.qty || "") + '"></div>' +
      "</div>" +

      '<div class="two">' +
      '<div class="field"><label>سعر الشراء</label>' +
      '<input class="inp num" id="e_cost" type="text" inputmode="decimal" value="' +
      (b.cost || "") + '" placeholder="0" oninput="UI.suggestPrice()"></div>' +
      '<div class="field"><label>حد التنبيه</label>' +
      '<input class="inp num" id="e_min" type="text" inputmode="numeric" value="' +
      (b.min || "") + '"></div>' +
      "</div>" +
      '<p class="hint" id="priceHint"></p>' +

      '<div class="field"><label>التصنيف</label>' +
      '<select class="inp" id="e_cat">' +
      '<option value="">— بلا تصنيف —</option>' +
      cats.map(function (c) {
        return '<option value="' + esc(c) + '"' + (c === cur ? " selected" : "") + ">" + esc(c) + "</option>";
      }).join("") +
      (cur && !known ? '<option value="' + esc(cur) + '" selected>' + esc(cur) + " (جديد)</option>" : "") +
      "</select></div>" +

      (b.specialty
        ? '<div class="field"><label>التخصص</label>' +
        '<input class="inp" id="e_specialty" value="' + esc(b.specialty) + '"></div>'
        : '<div class="field"><label>التخصص (اختياري)</label>' +
        '<input class="inp" id="e_specialty" value="" placeholder="مثال: جراحة عامة"></div>') +

      '<div class="two">' +
      '<div class="field"><label>المكتبة</label>' +
      '<input class="inp" id="e_lib" value="' + esc(b.lib) + '"></div>' +
      '<div class="field"><label>الرف</label>' +
      '<input class="inp" id="e_shelf" value="' + esc(b.shelf) + '"></div>' +
      "</div>" +

      '<div class="field"><label>الباركود / ISBN</label>' +
      '<input class="inp num" id="e_barcode" value="' + esc(b.barcode) + '" placeholder="اتركه فارغاً لطباعة لاصقة"></div>' +

      '<div class="field"><label>دار النشر</label>' +
      '<input class="inp" id="e_publisher" value="' + esc(b.publisher) + '"></div>' +

      '<div class="field"><label>ملاحظة — محتوى الكتاب ولمن هو موجّه</label>' +
      '<textarea class="inp" id="e_note">' + esc(b.note) + "</textarea></div>" +

      (b.source ? '<p class="hint">المصدر: ' + esc(b.source) +
        (b.confidence && b.confidence < 100 ? " · ثقة القراءة " + Math.round(b.confidence) + "%" : "") +
        "</p>" : "") +

      '<button class="btn primary" onclick="UI.saveEdit(\'' + b.id + '\')">حفظ</button>' +
      '<button class="btn danger" onclick="UI.askDel(\'' + b.id + '\')">حذف الكتاب</button>',
      function () {
        suggestPrice();
        var t = el("e_title");
        if (t && !t.value) t.focus();
        else { var p = el("e_price"); if (p && !p.value) p.focus(); }
      });
  }

  /* اقتراح سعر البيع من سعر الشراء بهامش الإعدادات */
  function suggestPrice() {
    var c = el("e_cost"), p = el("e_price"), h = el("priceHint");
    if (!c || !p || !h) return;
    var cost = App.num(c.value);
    if (cost <= 0) { h.textContent = ""; return; }
    var m = App.num(S().cfg.margin) || 30;
    var sug = Math.round(cost * (1 + m / 100) * 100) / 100;
    h.innerHTML = "بهامش " + m + "% يكون سعر البيع نحو <b>" + sug + "</b> " +
      esc(S().cfg.currency) +
      ' · <a href="#" onclick="UI.useSuggested(' + sug + ');return false">استعمله</a>';
  }

  function useSuggested(v) {
    var p = el("e_price");
    if (p) { p.value = v; p.focus(); }
  }

  function saveEdit(id) {
    var f = ["title", "author", "publisher", "cat", "specialty", "lib", "shelf", "barcode", "note"];
    f.forEach(function (k) {
      var e = el("e_" + k);
      if (e) App.set(id, k, k === "barcode" ? App.cleanIsbn(e.value) : e.value.trim());
    });
    ["price", "cost", "qty", "min"].forEach(function (k) {
      var e = el("e_" + k);
      if (e) App.set(id, k, e.value);
    });
    var b = App.get(id);
    // المكتبة والرف والتصنيف الأخير يصيران الافتراضي للكتاب التالي
    S().cfg.lib = b.lib; S().cfg.shelf = b.shelf;
    if (b.cat && S().cfg.cats.indexOf(b.cat) < 0) S().cfg.cats.push(b.cat);
    App.save();
    closeSheet();
    var probs = App.problems(b);
    if (probs.length) toast("حُفظ — لكن ينقصه: " + probs.join("، "), "warn");
    else toast("حُفظ وجاهز للتصدير.", "ok");
    go("add");
  }

  function askDel(id) {
    var b = App.get(id);
    if (!b) return;
    sheet("حذف الكتاب",
      '<p class="sub">سيُحذف «' + esc(b.title || "بلا اسم") + "» من هذه القائمة. " +
      "لن يؤثر على ما صدّرته سابقاً.</p>" +
      '<button class="btn danger" onclick="UI.doDel(\'' + id + '\')">نعم احذفه</button>' +
      '<button class="btn" onclick="UI.closeSheet()">تراجع</button>');
  }

  function doDel(id) {
    App.del(id);
    closeSheet();
    toast("حُذف.");
    render();
  }

  /* ---------- القائمة ---------- */

  function listPage() {
    var all = S().books;
    if (!all.length) {
      return '<div class="card"><div class="empty"><div class="big">▤</div>' +
        "<h4>القائمة فارغة</h4><p>امسح باركود كتاب أو صوّر غلافه لتبدأ.</p>" +
        '<button class="btn primary" style="margin-top:14px" onclick="UI.go(\'add\')">إضافة كتاب</button>' +
        "</div></div>";
    }

    var ready = App.readyCount();
    var bad = all.length - ready;
    var pieces = all.reduce(function (s, b) { return s + App.num(b.qty); }, 0);

    var h = '<div class="stats">' +
      "<div><b>" + all.length + "</b><span>كتاب</span></div>" +
      "<div><b>" + pieces + "</b><span>قطعة</span></div>" +
      '<div class="' + (bad ? "r" : "") + '"><b>' + bad + "</b><span>ينقصها شيء</span></div>" +
      "</div>";

    h += '<div class="row" style="margin-bottom:14px">' +
      '<button class="btn primary" onclick="UI.exportReady()">تصدير الجاهز (' + ready + ")</button>" +
      '<button class="btn" onclick="UI.exportAll()">تصدير الكل</button>' +
      "</div>";

    all.forEach(function (b) {
      var probs = App.problems(b);
      h += '<div class="book' + (probs.length ? " bad" : "") + '">' +
        '<div class="corner">' +
        (probs.length ? '<span class="tag bad">ينقصه</span>' : '<span class="tag ok">جاهز</span>') +
        "</div>" +
        "<h3>" + esc(b.title || "(بلا اسم)") + "</h3>" +
        '<p class="meta">' +
        (b.author ? esc(b.author) : "بلا مؤلف") +
        (b.barcode ? ' · <span class="num">' + esc(b.barcode) + "</span>" : " · بلا باركود") +
        "</p>" +
        '<div class="tags">' +
        '<span class="tag green">' + App.num(b.qty) + " نسخة</span>" +
        (App.num(b.price) > 0
          ? '<span class="tag">' + App.num(b.price) + " " + esc(S().cfg.currency) + "</span>"
          : '<span class="tag bad">بلا سعر</span>') +
        (b.cat ? '<span class="tag">' + esc(b.cat) + "</span>" : "") +
        (b.specialty ? '<span class="tag">' + esc(b.specialty) + "</span>" : "") +
        '<span class="tag">' + esc(b.lib) + " · رف " + esc(b.shelf) + "</span>" +
        "</div>" +
        (probs.length
          ? '<p class="meta" style="color:var(--bad)">' + esc(probs.join(" · ")) + "</p>"
          : "") +
        '<div class="acts">' +
        '<button class="btn sm" style="flex:1" onclick="UI.edit(\'' + b.id + '\')">تعديل</button>' +
        '<button class="btn sm" onclick="UI.askDel(\'' + b.id + '\')">حذف</button>' +
        "</div></div>";
    });
    return h;
  }

  function exportReady() { doExport("ready"); }
  function exportAll() { doExport("all"); }

  function doExport(only) {
    var n = App.download(only);
    if (!n) return;
    sheet("نُزّل الملف",
      '<p class="sub">صُدّر <b>' + n + "</b> كتاباً إلى ملف CSV في تنزيلات تلفونك.</p>" +
      '<p class="hint" style="line-height:1.9">انقله إلى الكمبيوتر (واتساب، أو كابل، أو أي وسيلة)، ' +
      "ثم في المنظومة: <b>إدخال بضاعة ← كتب ← استيراد من ملف</b>.<br>" +
      "بعد الاستيراد ستجد الكتب التي بلا باركود معلَّمة بعلامة حمراء في المخزون، " +
      "فتطبع لاصقاتها من تبويب <b>طباعة اللاصقات</b>.</p>" +
      (only === "ready"
        ? '<button class="btn" onclick="UI.clearDone()">امسح المصدَّر من القائمة</button>'
        : "") +
      '<button class="btn primary" onclick="UI.closeSheet()">تمام</button>');
  }

  function clearDone() {
    App.clearExported();
    closeSheet();
    toast("مُسح المصدَّر. بقي ما ينقصه شيء.");
    render();
  }

  /* ---------- الإعدادات ---------- */

  function settingsPage() {
    var c = S().cfg;
    return '' +
      '<div class="card">' +
      "<h2>مفتاح قراءة الأغلفة</h2>" +
      '<p class="sub">مطلوب فقط لتصوير الأغلفة. المسح بالباركود يعمل بدونه.</p>' +
      '<div class="field"><label>مفتاح Gemini</label>' +
      '<input class="inp" id="s_key" type="password" value="' + esc(c.geminiKey) +
      '" placeholder="AIza…" autocomplete="off"></div>' +
      '<p class="hint" style="line-height:1.9">خذه مجاناً من <b>aistudio.google.com</b> ← ' +
      "Get API key. بلا بطاقة ائتمان. يُحفظ على تلفونك وحده ولا يُرسل لأي جهة أخرى.</p>" +
      '<button class="btn" onclick="UI.saveKey()">حفظ المفتاح</button>' +
      "</div>" +

      '<div class="card">' +
      "<h2>الافتراضيات</h2>" +
      '<p class="sub">تُملأ تلقائياً في كل كتاب جديد لتوفّر عليك الكتابة.</p>' +
      '<div class="field"><label>اسم المحل</label>' +
      '<input class="inp" id="s_shop" value="' + esc(c.shopName) + '"></div>' +
      '<div class="two">' +
      '<div class="field"><label>المكتبة</label>' +
      '<input class="inp" id="s_lib" value="' + esc(c.lib) + '"></div>' +
      '<div class="field"><label>الرف</label>' +
      '<input class="inp" id="s_shelf" value="' + esc(c.shelf) + '"></div>' +
      "</div>" +
      '<div class="two">' +
      '<div class="field"><label>الكمية الافتراضية</label>' +
      '<input class="inp num" id="s_qty" type="text" inputmode="numeric" value="' + c.defQty + '"></div>' +
      '<div class="field"><label>حد التنبيه</label>' +
      '<input class="inp num" id="s_min" type="text" inputmode="numeric" value="' + c.defMin + '"></div>' +
      "</div>" +
      '<div class="two">' +
      '<div class="field"><label>رمز العملة</label>' +
      '<input class="inp" id="s_cur" value="' + esc(c.currency) + '"></div>' +
      '<div class="field"><label>هامش الربح %</label>' +
      '<input class="inp num" id="s_margin" type="text" inputmode="numeric" value="' + c.margin + '"></div>' +
      "</div>" +
      '<button class="btn primary" onclick="UI.saveCfg()">حفظ</button>' +
      "</div>" +

      '<div class="card">' +
      "<h2>التصنيفات</h2>" +
      '<p class="sub">تظهر في قائمة التصنيف، ويُطلب من الذكاء الاصطناعي الاختيار منها.</p>' +
      '<div class="field"><textarea class="inp" id="s_cats" placeholder="تصنيف في كل سطر">' +
      esc(c.cats.join("\n")) + "</textarea></div>" +
      '<button class="btn" onclick="UI.saveCats()">حفظ التصنيفات</button>' +
      "</div>" +

      '<div class="card">' +
      "<h2>بياناتك</h2>" +
      '<p class="sub">كل شيء محفوظ على هذا التلفون وحده. مسح بيانات المتصفح يمسحها.</p>' +
      '<button class="btn" onclick="UI.exportAll()">تصدير كل القائمة</button>' +
      '<button class="btn danger" onclick="UI.askWipe()">مسح القائمة كاملة</button>' +
      "</div>" +

      '<div class="card">' +
      "<h2>عارض المخزون</h2>" +
      '<p class="sub">صفحة أخرى في نفس الموقع: ترى فيها بضاعتك وأين هي ' +
      "في الفروع والمخازن. للعرض فقط.</p>" +
      '<a class="btn" href="stock.html">افتح عارض المخزون</a>' +
      "</div>";
  }

  function saveKey() {
    var e = el("s_key");
    if (!e) return;
    S().cfg.geminiKey = e.value.trim();
    App.save();
    toast(S().cfg.geminiKey ? "حُفظ المفتاح." : "أُزيل المفتاح.", "ok");
    render();
  }

  function saveCfg() {
    var c = S().cfg;
    var m = {
      shopName: "s_shop", lib: "s_lib", shelf: "s_shelf", currency: "s_cur"
    };
    for (var k in m) { var e = el(m[k]); if (e) c[k] = e.value.trim(); }
    var q = el("s_qty"), mi = el("s_min"), mg = el("s_margin");
    if (q) c.defQty = Math.max(0, Math.round(App.num(q.value)));
    if (mi) c.defMin = Math.max(0, Math.round(App.num(mi.value)));
    if (mg) c.margin = Math.max(0, App.num(mg.value));
    App.save();
    toast("حُفظت الإعدادات.", "ok");
    render();
  }

  function saveCats() {
    var e = el("s_cats");
    if (!e) return;
    var list = e.value.split("\n").map(function (x) { return x.trim(); })
      .filter(function (x) { return x; });
    if (!list.length) { toast("اترك تصنيفاً واحداً على الأقل.", "warn"); return; }
    S().cfg.cats = list;
    App.save();
    toast("حُفظت التصنيفات.", "ok");
  }

  function askWipe() {
    sheet("مسح القائمة",
      '<p class="sub">ستُحذف كل الكتب التي في القائمة على هذا التلفون. ' +
      "ما صدّرته واستوردته في المنظومة لا يتأثر.</p>" +
      '<button class="btn danger" onclick="UI.doWipe()">نعم امسح الكل</button>' +
      '<button class="btn" onclick="UI.closeSheet()">تراجع</button>');
  }

  function doWipe() {
    S().books = [];
    App.save();
    closeSheet();
    toast("مُسحت القائمة.");
    go("list");
  }

  function init() {
    render();
    window.addEventListener("pagehide", stopCam);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopCam();
    });
  }

  return {
    init: init, go: go, render: render, toast: toast,
    sheet: sheet, closeSheet: closeSheet,
    scan: scan, typeIsbn: typeIsbn, submitIsbn: submitIsbn, onIsbn: onIsbn,
    pickCover: pickCover, editWithIsbn: editWithIsbn,
    edit: edit, saveEdit: saveEdit, askDel: askDel, doDel: doDel,
    suggestPrice: suggestPrice, useSuggested: useSuggested,
    exportReady: exportReady, exportAll: exportAll, clearDone: clearDone,
    saveKey: saveKey, saveCfg: saveCfg, saveCats: saveCats,
    askWipe: askWipe, doWipe: doWipe
  };
})();
