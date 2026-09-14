/* ============================================================
   تسجيل الكتب — يُفتح من التلفون عند الرف
   ------------------------------------------------------------
   طريقان لتسجيل الكتاب:

   1) مسح باركود ISBN بالكاميرا ثم بحث مجاني في Open Library
      وGoogle Books. بلا مفتاح وبلا تسجيل وبلا حد، وأدق من قراءة
      صورة — وأغلب الكتب الإنجليزية والطبية عليها ISBN.

   2) تصوير الغلاف وقراءته بالذكاء الاصطناعي (Gemini بمفتاح مجاني).
      للكتب العربية التي بلا ISBN، ولاستخراج التخصص وكتابة الملاحظة.

   كل شيء يبقى على تلفونك: القائمة والمفتاح في localStorage، ولا
   يُرفع شيء إلى أي خادم إلا صورة الغلاف حين تختار الطريق الثاني.
   ============================================================ */

var App = (function () {

  var KEY = "qi_web_v1";
  var S = null;

  /* ---------- الحالة ---------- */

  function blank() {
    return {
      books: [],
      cfg: {
        shopName: "",
        geminiKey: "",
        lib: "A",
        shelf: "1",
        currency: "د.ل",
        defQty: 1,
        defMin: 0,
        margin: 30,            // نسبة الربح المقترحة على سعر الشراء
        cats: ["مدرسي", "جامعي", "طب بشري", "صيدلة", "هندسة", "ديني", "روايات", "أطفال", "متنوع"]
      }
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var d = JSON.parse(raw);
      var b = blank();
      if (!d || typeof d !== "object") return b;
      if (!Array.isArray(d.books)) d.books = [];
      d.cfg = d.cfg || {};
      for (var k in b.cfg) if (d.cfg[k] === undefined) d.cfg[k] = b.cfg[k];
      if (!Array.isArray(d.cfg.cats) || !d.cfg.cats.length) d.cfg.cats = b.cfg.cats;
      return d;
    } catch (e) { return blank(); }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { UI.toast("تعذّر الحفظ على التلفون — قد تكون الذاكرة ممتلئة.", "bad"); }
  }

  /* ---------- أدوات ---------- */

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* الأرقام العربية تصل من لوحة المفاتيح العربية ومن اللصق */
  function num(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var s = String(v)
      .replace(/[٠-٩]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0x0630); })
      .replace(/[۰-۹]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0x06C0); })
      .replace(/٫/g, ".").replace(/[٬  ]/g, "")
      .replace(/,(?=\d{1,2}(?:\D|$))/, ".").replace(/,/g, "")
      .replace(/[^\d.\-]/g, "");
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ISBN: 10 أو 13 رقماً بعد إزالة الشرطات، مع التحقق من خانة التدقيق
     حتى لا نبحث عن رقم التقطته الكاميرا خطأً. */
  function cleanIsbn(v) {
    return String(v || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  }

  function validIsbn(v) {
    var s = cleanIsbn(v), i, sum = 0;
    if (s.length === 13) {
      if (!/^\d{13}$/.test(s)) return false;
      for (i = 0; i < 12; i++) sum += (+s[i]) * (i % 2 ? 3 : 1);
      return (10 - (sum % 10)) % 10 === +s[12];
    }
    if (s.length === 10) {
      if (!/^\d{9}[\dX]$/.test(s)) return false;
      for (i = 0; i < 9; i++) sum += (+s[i]) * (10 - i);
      sum += (s[9] === "X" ? 10 : +s[9]);
      return sum % 11 === 0;
    }
    return false;
  }

  /* ---------- البحث المجاني بالـISBN ---------- */

  function fromGoogle(isbn) {
    return fetch("https://www.googleapis.com/books/v1/volumes?q=isbn:" + encodeURIComponent(isbn))
      .then(function (r) {
        if (!r.ok) throw new Error("google " + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.totalItems || !d.items || !d.items.length) return null;
        var v = d.items[0].volumeInfo || {};
        var title = v.title || "";
        if (v.subtitle) title += " — " + v.subtitle;
        return {
          title: title,
          author: (v.authors || []).join("، "),
          publisher: v.publisher || "",
          cat: (v.categories || [])[0] || "",
          note: v.description || "",
          source: "Google Books"
        };
      });
  }

  function fromOpenLibrary(isbn) {
    return fetch("https://openlibrary.org/api/books?bibkeys=ISBN:" + encodeURIComponent(isbn) +
      "&format=json&jscmd=data")
      .then(function (r) {
        if (!r.ok) throw new Error("openlibrary " + r.status);
        return r.json();
      })
      .then(function (d) {
        var k = "ISBN:" + isbn;
        var v = d && d[k];
        if (!v) return null;
        return {
          title: v.title || "",
          author: (v.authors || []).map(function (a) { return a.name; }).join("، "),
          publisher: (v.publishers || []).map(function (p) { return p.name; }).join("، "),
          cat: (v.subjects || []).map(function (s) { return s.name; })[0] || "",
          note: (v.excerpts || []).map(function (e) { return e.text; })[0] || "",
          source: "Open Library"
        };
      });
  }

  /* نجرّب الاثنين ونأخذ أول نتيجة صالحة — لا نفشل لفشل واحد */
  function lookupIsbn(isbn) {
    var clean = cleanIsbn(isbn);
    return fromGoogle(clean)
      .catch(function () { return null; })
      .then(function (g) {
        if (g && g.title) return g;
        return fromOpenLibrary(clean).catch(function () { return null; });
      })
      .then(function (r) {
        if (r && r.title) { r.barcode = clean; return r; }
        return null;
      });
  }

  /* ---------- قراءة الغلاف بالذكاء الاصطناعي ---------- */

  var AI_PROMPT =
    "هذه صورة غلاف كتاب في مكتبة ليبية. أعطني JSON فقط بلا أي نص قبله أو بعده، " +
    "بهذه المفاتيح بالضبط:\n" +
    '{"title":"","author":"","publisher":"","cat":"","specialty":"","isbn":"","note":"","confidence":0}\n\n' +
    "القواعد:\n" +
    "- title: اسم الكتاب كما هو مكتوب على الغلاف بلغته.\n" +
    "- author: المؤلف أو المؤلفون مفصولين بفاصلة عربية.\n" +
    "- cat: التصنيف العام، اختر من: __CATS__ — وإن لم يناسب أيٌّ منها اكتب الأنسب.\n" +
    "- specialty: التخصص الدقيق إن كان الكتاب علمياً أو طبياً " +
    "(مثل: جراحة عامة، طب أسنان، تشريح، صيدلة سريرية، هندسة مدنية). " +
    "اتركه فارغاً لغير المتخصص.\n" +
    "- isbn: الرقم الدولي إن ظهر على الغلاف، أرقاماً فقط بلا شرطات، وإلا فارغ.\n" +
    "- note: فقرة عربية من ثلاثة إلى خمسة أسطر تشرح محتوى الكتاب وموضوعاته " +
    "الرئيسية، وتنتهي بجملة تحدد لمن هو موجّه (طلبة كلية الطب، معلمو المرحلة " +
    "الابتدائية، القارئ العام…). اكتبها من معرفتك بالكتاب إن عرفته، وإلا فمن " +
    "عنوانه وما يظهر على غلافه.\n" +
    "- confidence: رقم من 0 إلى 100 يعبّر عن ثقتك في قراءة الاسم والمؤلف.";

  function fileToBase64(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(",")[1]); };
      fr.onerror = function () { rej(new Error("تعذّرت قراءة الصورة")); };
      fr.readAsDataURL(file);
    });
  }

  /* تصغير الصورة قبل الإرسال: أسرع على شبكة بطيئة وأقل استهلاكاً للحصة */
  function shrink(file, maxSide) {
    return new Promise(function (res) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.width, h = img.height;
        var sc = Math.min(1, (maxSide || 1280) / Math.max(w, h));
        if (sc >= 1) { URL.revokeObjectURL(url); res(file); return; }
        var c = document.createElement("canvas");
        c.width = Math.round(w * sc); c.height = Math.round(h * sc);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { res(b || file); }, "image/jpeg", 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }

  function readCover(file) {
    var key = String(S.cfg.geminiKey || "").trim();
    if (!key) return Promise.reject(new Error("NOKEY"));

    return shrink(file, 1280)
      .then(fileToBase64)
      .then(function (b64) {
        var prompt = AI_PROMPT.replace("__CATS__", S.cfg.cats.join("، "));
        return fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
          encodeURIComponent(key),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: prompt },
                  { inline_data: { mime_type: "image/jpeg", data: b64 } }
                ]
              }],
              generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
            })
          }
        );
      })
      .then(function (r) {
        if (r.status === 400 || r.status === 403) throw new Error("BADKEY");
        if (r.status === 429) throw new Error("QUOTA");
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        var txt = "";
        try { txt = d.candidates[0].content.parts[0].text; }
        catch (e) { throw new Error("رد غير مفهوم من الخدمة"); }
        var o = parseJsonLoose(txt);
        if (!o) throw new Error("رد غير مفهوم من الخدمة");
        return {
          title: o.title || "",
          author: o.author || "",
          publisher: o.publisher || "",
          cat: o.cat || "",
          specialty: o.specialty || "",
          barcode: cleanIsbn(o.isbn || ""),
          note: o.note || "",
          confidence: num(o.confidence),
          source: "صورة الغلاف"
        };
      });
  }

  /* الردود تأتي أحياناً داخل ```json — ننتزع أول كائن سليم */
  function parseJsonLoose(txt) {
    var s = String(txt || "").trim();
    try { return JSON.parse(s); } catch (e) { }
    var a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) { }
    }
    return null;
  }

  /* ---------- الكتب ---------- */

  function addBook(data) {
    var b = {
      id: uid(),
      title: data.title || "",
      author: data.author || "",
      publisher: data.publisher || "",
      cat: data.cat || "",
      specialty: data.specialty || "",
      barcode: cleanIsbn(data.barcode || ""),
      note: data.note || "",
      cost: 0,
      price: 0,
      qty: num(S.cfg.defQty) || 1,
      min: num(S.cfg.defMin),
      lib: S.cfg.lib,
      shelf: S.cfg.shelf,
      source: data.source || "",
      confidence: data.confidence === undefined ? 100 : num(data.confidence),
      at: new Date().toISOString().slice(0, 16).replace("T", " ")
    };
    S.books.unshift(b);
    save();
    return b;
  }

  function get(id) {
    var r = null;
    S.books.forEach(function (b) { if (b.id === id) r = b; });
    return r;
  }

  function set(id, k, v) {
    var b = get(id);
    if (!b) return;
    if (k === "qty" || k === "min") b[k] = Math.max(0, Math.round(num(v)));
    else if (k === "cost" || k === "price") b[k] = Math.max(0, num(v));
    else b[k] = v;
    save();
  }

  function del(id) {
    S.books = S.books.filter(function (b) { return b.id !== id; });
    save();
  }

  function dupeOf(b) {
    var t = norm(b.title);
    var hit = null;
    S.books.forEach(function (x) {
      if (x.id !== b.id && (norm(x.title) === t ||
        (x.barcode && b.barcode && x.barcode === b.barcode))) hit = x;
    });
    return hit;
  }

  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/[ً-ٰٟ]/g, "")
      .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/\s+/g, " ").trim();
  }

  /* ما الذي ينقص هذا الكتاب قبل أن يصلح للاستيراد؟ */
  function problems(b) {
    var out = [];
    if (!String(b.title).trim()) out.push("بلا اسم");
    if (num(b.price) <= 0) out.push("بلا سعر بيع");
    if (num(b.qty) <= 0) out.push("الكمية صفر");
    if (num(b.cost) > 0 && num(b.price) > 0 && num(b.price) < num(b.cost)) out.push("البيع أقل من الشراء");
    if (b.confidence && b.confidence < 60) out.push("قراءة غير واثقة — راجع الاسم");
    if (dupeOf(b)) out.push("مكرر في القائمة");
    return out;
  }

  function readyCount() {
    return S.books.filter(function (b) { return !problems(b).length; }).length;
  }

  /* ---------- التصدير ----------
     نفس ترتيب أعمدة الاستيراد في البرنامج، مع عمود ملاحظة في آخره. */

  var COLS = ["اسم الكتاب", "المؤلف", "دار النشر", "التصنيف", "المكتبة", "الرف",
    "الباركود", "سعر الجملة", "سعر البيع", "الكمية", "حد التنبيه", "ملاحظة"];

  function toCsv(rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c === null || c === undefined ? "" : c);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\r\n");
  }

  function exportRows(only) {
    var list = S.books.filter(function (b) {
      if (only === "ready") return !problems(b).length;
      return String(b.title).trim();
    });
    return [COLS].concat(list.map(function (b) {
      var note = b.note || "";
      if (b.specialty) note = "التخصص: " + b.specialty + (note ? "\n" + note : "");
      return [b.title, b.author, b.publisher, b.cat, b.lib, b.shelf,
        b.barcode, b.cost, b.price, b.qty, b.min, note];
    }));
  }

  function download(only) {
    var rows = exportRows(only);
    if (rows.length < 2) { UI.toast("لا كتب جاهزة للتصدير.", "warn"); return 0; }
    var csv = "﻿" + toCsv(rows);
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "كتب-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }, 1200);
    return rows.length - 1;
  }

  function clearExported() {
    S.books = S.books.filter(function (b) { return problems(b).length; });
    save();
  }

  function boot() {
    S = load();
    UI.init();
  }

  return {
    boot: boot, save: save,
    get S() { return S; },
    num: num, esc: esc, uid: uid, norm: norm,
    cleanIsbn: cleanIsbn, validIsbn: validIsbn,
    lookupIsbn: lookupIsbn, fromGoogle: fromGoogle, fromOpenLibrary: fromOpenLibrary,
    readCover: readCover, parseJsonLoose: parseJsonLoose, shrink: shrink,
    addBook: addBook, get: get, set: set, del: del,
    problems: problems, dupeOf: dupeOf, readyCount: readyCount,
    exportRows: exportRows, toCsv: toCsv, download: download, clearExported: clearExported,
    COLS: COLS
  };
})();
