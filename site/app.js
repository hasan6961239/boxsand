/* ============================================================
   app.js — مخزون المكتبة
   ------------------------------------------------------------
   يقرأ اللقطة التي يرفعها جهاز المحل إلى الـWorker نفسه المستعمل
   للربط بين الفروع. لا خادم جديد، ولا قاعدة بيانات، ولا حساب.

   للقراءة فقط: لا يكتب في الـWorker شيئاً أبداً.

   ويحفظ آخر لقطة على هذا الجهاز فيعمل بلا إنترنت، ويقول بوضوح
   متى وصلته — الرقم القديم أخطر من لا رقم لأن صاحبه يظنه اليوم.
   ============================================================ */

var UI = (function () {

  var KEY = "maktaba_stock_v2";
  var S = null;
  var busy = false;
  var PAGE = 40;

  /* ---------- الحالة ---------- */

  function blank() {
    return {
      cfg: { url: "", key: "" },
      snap: null,                 // { at, branches: [] }
      q: "", filter: "", shown: PAGE, screen: "home",
      theme: "auto",              // auto | light | dark
      sort: "name",               // name | qty | value | price
      lib: "", shelf: ""          // تصفّح مكتبة ورفّاً بعينه
    };
  }

  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!d || typeof d !== "object") return blank();
      var b = blank();
      d.cfg = (d.cfg && typeof d.cfg === "object") ? d.cfg : b.cfg;
      if (typeof d.cfg.url !== "string") d.cfg.url = "";
      if (typeof d.cfg.key !== "string") d.cfg.key = "";
      d.q = ""; d.filter = ""; d.shown = PAGE; d.screen = "home";
      if (["auto", "light", "dark"].indexOf(d.theme) < 0) d.theme = "auto";
      if (["name", "qty", "value", "price"].indexOf(d.sort) < 0) d.sort = "name";
      if (typeof d.lib !== "string") d.lib = "";
      if (typeof d.shelf !== "string") d.shelf = "";
      if (d.snap && typeof d.snap !== "object") d.snap = null;
      return d;
    } catch (e) { return blank(); }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { /* ذاكرة ممتلئة أو خاصة — نكمل بلا حفظ */ }
  }

  /* ---------- الأيقونات ----------
     أشكال متجهة من مجموعة واحدة: ترتسم كما هي في كل جهاز، بخلاف
     الرموز والإيموجي التي يرسمها كل نظام على هواه. */
  var ICONS = {
    search: "M11 4a7 7 0 100 14 7 7 0 000-14zm9 16l-4.2-4.2",
    book: "M4 4h6a3 3 0 013 3v13a2.5 2.5 0 00-2.5-2.5H4V4zm16 0h-6a3 3 0 00-3 3v13a2.5 2.5 0 012.5-2.5H20V4z",
    pen: "M4 20h4L19 9a2.8 2.8 0 10-4-4L4 16v4zm10.5-13.5l4 4",
    box: "M3 7l9-4 9 4v10l-9 4-9-4V7zm0 0l9 4 9-4M12 11v10",
    shelf: "M4 5h16M4 5v14M20 5v14M4 12h16M7 7v4M10 7v4M13 14v4M16 14v4",
    tag: "M20 12l-8 8-9-9V3h8l9 9zM7.5 7.5h.01",
    alert: "M12 3l9 16H3l9-16zm0 6v4m0 3v.01",
    empty: "M5 5h14v14H5V5z",
    sun: "M12 17a5 5 0 100-10 5 5 0 000 10zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    moon: "M20 14.5A8.5 8.5 0 1110 3.5a7 7 0 0010 11z",
    auto: "M12 3a9 9 0 000 18V3z M12 21a9 9 0 000-18",
    sort: "M7 4v16m0 0l-3-3m3 3l3-3M17 20V4m0 0l-3 3m3-3l3 3",
    grid: "M3 4h7v7H3V4zm11 0h7v7h-7V4zM3 13h7v7H3v-7zm11 0h7v7h-7v-7z",
    back: "M15 5l-7 7 7 7",
    money: "M12 3v18M16.5 7.5c0-1.7-2-2.5-4.5-2.5S7.5 5.8 7.5 7.5 9.5 10 12 10s4.5 1 4.5 2.8-2 2.7-4.5 2.7-4.5-1-4.5-2.5",
    x: "M6 6l12 12M18 6L6 18",
    gear: "M12 15a3 3 0 100-6 3 3 0 000 6zm8.4-3l1.6-1-2-3.5-1.8.6a7 7 0 00-1.8-1L15.9 5h-4l-.5 2.1a7 7 0 00-1.8 1L7.8 7.5l-2 3.5 1.6 1a7 7 0 000 2l-1.6 1 2 3.5 1.8-.6a7 7 0 001.8 1l.5 2.1h4l.5-2.1a7 7 0 001.8-1l1.8.6 2-3.5-1.6-1a7 7 0 000-2z",
    refresh: "M20 12a8 8 0 11-2.3-5.7M20 4v5h-5",
    phone: "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z",
    copy: "M9 9h10v10H9V9zM5 15H3V3h12v2"
  };

  function ico(name, size) {
    var d = ICONS[name];
    if (!d) return "";
    var z = size || 18;
    return '<svg class="ic" width="' + z + '" height="' + z + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  /* ---------- أدوات ---------- */

  function el(id) { return document.getElementById(id); }

  /* النمط: تلقائي يتبع الجهاز، أو فاتح أو ليلي بالاختيار */
  function applyTheme() {
    var t = (S && S.theme) || "auto";
    var r = document.documentElement;
    r.setAttribute("data-theme", t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) {
      var dark = t === "dark" ||
        (t === "auto" && window.matchMedia &&
         window.matchMedia("(prefers-color-scheme: dark)").matches);
      m.setAttribute("content", dark ? "#10181D" : "#0E6E62");
    }
  }

  function cycleTheme() {
    S.theme = S.theme === "auto" ? "light" : (S.theme === "light" ? "dark" : "auto");
    save();
    applyTheme();
    paintThemeBtn();
    toast(S.theme === "auto" ? "النمط يتبع جهازك."
        : (S.theme === "light" ? "النمط الفاتح." : "النمط الليلي."));
  }

  function paintThemeBtn() {
    var b = el("btnTheme");
    if (!b) return;
    var name = S.theme === "light" ? "sun" : (S.theme === "dark" ? "moon" : "auto");
    b.innerHTML = ico(name, 20);
    b.setAttribute("aria-label",
      S.theme === "auto" ? "النمط: تلقائي" : (S.theme === "light" ? "النمط: فاتح" : "النمط: ليلي"));
  }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var n = parseFloat(String(v === null || v === undefined ? "" : v)
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 1632); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 1776); })
      .replace(/[٫,]/g, ".").replace(/[^\d.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  function money(v) {
    var n = num(v);
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  /* تطبيع عربي: الهمزات والتاء المربوطة والتشكيل — حتى يجد
     «اساسيات» من كتب «أساسيات»، ولا يضيع الكتاب لهمزة. */
  function norm(s) {
    return String(s === null || s === undefined ? "" : s).toLowerCase()
      .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, "")
      .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/[ؤ]/g, "و").replace(/[ئ]/g, "ي").replace(/ـ/g, "")
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 1632); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 1776); })
      .replace(/\s+/g, " ").trim();
  }

  function toast(msg, kind) {
    var t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.textContent = msg;
    el("toasts").appendChild(t);
    setTimeout(function () { t.remove(); }, 3400);
  }

  /* عمر اللقطة بالكلمات، لا بالتاريخ وحده */
  function ageOf(at) {
    if (!at) return { txt: "بلا تاريخ", cls: "bad", mins: 1e9 };
    var t = new Date(String(at).replace(" ", "T"));
    var mins = Math.round((Date.now() - t.getTime()) / 60000);
    if (isNaN(mins)) return { txt: String(at), cls: "", mins: 0 };
    if (mins < 0) mins = 0;
    if (mins < 2) return { txt: "محدَّث الآن", cls: "ok", mins: mins };
    if (mins < 60) return { txt: "منذ " + mins + " دقيقة", cls: "ok", mins: mins };
    if (mins < 1440) return { txt: "منذ " + Math.round(mins / 60) + " ساعة", cls: "warn", mins: mins };
    return { txt: "منذ " + Math.round(mins / 1440) + " يوم", cls: "bad", mins: mins };
  }

  function configured() { return !!String(S.cfg.url || "").trim(); }

  /* ---------- الجلب ---------- */

  function fetchAll() {
    var base = String(S.cfg.url).trim().replace(/\/+$/, "");
    return fetch(base + "/all", {
      headers: { "X-Shop-Key": String(S.cfg.key || "") },
      cache: "no-store"
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error("BADKEY");
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || "رد غير مفهوم من الخادم");
      return d.branches || [];
    });
  }

  function refresh(quiet) {
    if (busy || !configured()) return;
    busy = true;
    var b = el("btnRefresh");
    if (b) b.classList.add("spin");
    fetchAll().then(function (branches) {
      busy = false;
      if (b) b.classList.remove("spin");
      S.snap = { at: new Date().toISOString(), branches: branches };
      save();
      render();
      if (!quiet) {
        var n = countItems();
        toast("حُدّث المخزون — " + n + " صنف.", "ok");
      }
    }).catch(function (e) {
      busy = false;
      if (b) b.classList.remove("spin");
      if (e && e.message === "BADKEY") {
        toast("كلمة سر الربط غير صحيحة.", "bad");
        go("settings");
      } else if (!quiet) {
        toast("تعذّر الاتصال — تُعرض آخر نسخة وصلت.", "warn");
      }
      render();
    });
  }

  /* ---------- البيانات ---------- */

  /* كل مكان فيه بضاعة: فرع عنده منظومة، أو مخزن يدوي تابع له */
  function places() {
    var out = [];
    if (!S.snap || !S.snap.branches) return out;
    S.snap.branches.forEach(function (br) {
      var nm = (br.branch && (br.branch.name || br.branch.id)) || "فرع";
      out.push({
        key: "b:" + ((br.branch && br.branch.id) || nm),
        name: nm, kind: "branch", at: br.at,
        city: (br.branch && br.branch.city) || "",
        phone: (br.branch && br.branch.phone) || "",
        items: (br.items || []).map(function (i) {
          return {
            n: i.n || "", a: i.a || "", b: i.b || "", c: i.c || "", k: i.k || "",
            q: num(i.q), p: num(i.p), m: num(i.m), t: i.t || "",
            d: i.d || "", nt: i.nt || "", u: i.u || "",
            /* المكتبة والرف حقلان مستقلان كما في اللقطة. تحليلهما من
               نصّ العرض كان يخلط موقع القرطاسية ومكان المخزن بأسماء
               المكتبات، فتظهر «الطابق السفلي» مكتبةً. */
            lib: i.t === "book" ? String(i.l || "") : "",
            shelf: i.t === "book" ? String(i.s || "") : "",
            loc: i.t === "book"
              ? [(i.l || ""), (i.s ? "رف " + i.s : "")].filter(Boolean).join(" · ")
              : (i.loc || "")
          };
        })
      });
      (br.whs || []).forEach(function (w) {
        out.push({
          key: "w:" + w.id, name: w.name || "مخزن", kind: "wh", at: br.at,
          city: w.place || "", phone: w.phone || "", parent: nm,
          items: (w.items || []).map(function (i) {
            return {
              n: i.n || "", a: "", b: i.b || "", c: "", k: "",
              q: num(i.q), p: num(i.p), m: 0, t: i.t || "",
              d: "", nt: "", u: "", lib: "", shelf: "", loc: w.place || ""
            };
          })
        });
      });
    });
    return out;
  }

  /* مفتاح الصنف عبر الأماكن.

     كان الاسم وحده، فكان كتابان مختلفان لهما نفس العنوان يندمجان
     وتُجمع كميتاهما — وهذا خطأ يُنقص العدد ويعطي رقماً كاذباً.

     الباركود هو المعرّف الحقيقي: نفس الكتاب في فرعين له نفس الباركود،
     وكتابان مختلفان لهما باركودان مختلفان. وما لا باركود له يُجمع
     بالاسم والنوع كما كان. */
  function itemKey(it) {
    var b = String(it.b || "").trim();
    if (b) return "b:" + b;
    return "n:" + (it.t || "") + "|" + norm(it.n);
  }

  /* الصنف الواحد مجموعاً عبر كل الأماكن — السؤال الحقيقي «أين وكم؟» */
  function items() {
    var by = {};
    places().forEach(function (pl) {
      pl.items.forEach(function (it) {
        var k = itemKey(it);
        if (!by[k]) {
          by[k] = {
            key: k, n: it.n, a: it.a, b: it.b, c: it.c, code: it.k,
            p: it.p, t: it.t, d: it.d, nt: it.nt, u: it.u,
            total: 0, low: false, minTop: 0, at: []
          };
        }
        var g = by[k];
        g.total += it.q;
        g.at.push({ place: pl, q: it.q, loc: it.loc, m: it.m,
                    lib: it.lib, shelf: it.shelf });
        /* أعلى حدّ تنبيه ضُبط للصنف في أي مكان. الحكم بعدها يكون على
           المجموع: كتاب مجموعه ٥٧ نسخة ليس «قارب على النفاد» لأن
           فرعاً واحداً عنده ٥ منه. */
        if (it.m > g.minTop) g.minTop = it.m;
        if (!g.a && it.a) g.a = it.a;
        if (!g.b && it.b) g.b = it.b;
        if (!g.c && it.c) g.c = it.c;
        if (!g.d && it.d) g.d = it.d;
        if (!g.nt && it.nt) g.nt = it.nt;
        if (!g.p && it.p) g.p = it.p;
      });
    });
    return Object.keys(by).map(function (k) {
      var g = by[k];
      g.low = g.minTop > 0 && g.total > 0 && g.total <= g.minTop;
      return g;
    });
  }

  function countItems() { return items().length; }

  /* عدد السجلات كما هي في اللقطة، قبل الجمع عبر الأماكن.
     الفرق بينه وبين عدد الأصناف يُشرح في الإعدادات بدل أن يُحيّر. */
  function countRecords() {
    var n = 0;
    places().forEach(function (p) { n += p.items.length; });
    return n;
  }

  /* أصناف اجتمعت تحت مفتاح واحد داخل المكان نفسه: غالباً تكرار في
     الإدخال، أو صنفان بلا باركود لهما الاسم نفسه. */
  function merged() {
    var out = [];
    items().forEach(function (g) {
      var seen = {};
      var dup = false;
      g.at.forEach(function (w) {
        var k = w.place.key;
        if (seen[k]) dup = true;
        seen[k] = 1;
      });
      if (dup) out.push(g);
    });
    return out;
  }

  /* البحث: الاسم أو المؤلف أو الباركود أو الرمز أو التصنيف أو الناشر.
     كل كلمة يجب أن توجد — فـ«نحو ثانوي» تجد ما فيه الاثنان. */
  function search(list, q) {
    var words = norm(q).split(" ").filter(Boolean);
    if (!words.length) return list;
    return list.filter(function (g) {
      var hay = norm([g.n, g.a, g.b, g.code, g.c, g.d].join(" "));
      for (var i = 0; i < words.length; i++) {
        if (hay.indexOf(words[i]) < 0) return false;
      }
      return true;
    });
  }

  function applyFilter(list) {
    if (S.filter === "out") return list.filter(function (g) { return g.total <= 0; });
    if (S.filter === "low") return list.filter(function (g) { return g.total > 0 && g.low; });
    if (S.filter === "book") return list.filter(function (g) { return g.t === "book"; });
    if (S.filter === "stat") return list.filter(function (g) { return g.t === "stat"; });
    if (S.filter === "nobc") return list.filter(function (g) { return !g.b; });
    /* «بلا تصنيف» دلوٌ نعرضه في الملخّص، وليس تصنيفاً مكتوباً على صنف.
       بلا هذا السطر كانت التصفية عليه تعطي قائمة فارغة. */
    if (S.filter === "c:") return list.filter(function (g) { return !g.c; });
    if (S.filter.indexOf("c:") === 0) {
      var c = S.filter.slice(2);
      return list.filter(function (g) { return g.c === c; });
    }
    return list;
  }

  var SORTS = {
    name:  { t: "الاسم",    f: function (a, b) { return String(a.n).localeCompare(String(b.n), "ar"); } },
    qty:   { t: "الأكثر عدداً", f: function (a, b) { return b.total - a.total; } },
    value: { t: "الأعلى قيمة", f: function (a, b) { return (b.total * b.p) - (a.total * a.p); } },
    price: { t: "الأغلى سعراً", f: function (a, b) { return b.p - a.p; } }
  };

  function sortItems(list) {
    var f = (SORTS[S.sort] || SORTS.name).f;
    return list.slice().sort(function (a, b) {
      var r = f(a, b);
      /* عند التساوي يُرتَّب بالاسم، فلا يتقافز الترتيب بين رسمتين */
      return r !== 0 ? r : String(a.n).localeCompare(String(b.n), "ar");
    });
  }

  /* ---------- المكتبات والرفوف ----------
     الكتب وحدها لها مكتبة ورف. القرطاسية لها موقع حرّ، والمخازن
     لها مكانها — وتُعرض في قسم مستقل بدل أن تُحسب مكتبات. */
  function shelves() {
    var libs = {};
    items().forEach(function (g) {
      g.at.forEach(function (w) {
        if (!w.lib) return;
        if (!libs[w.lib]) libs[w.lib] = { name: w.lib, items: 0, qty: 0, shelves: {} };
        var lb = libs[w.lib];
        var sh = w.shelf || "—";
        if (!lb.shelves[sh]) lb.shelves[sh] = { name: sh, items: 0, qty: 0 };
        lb.shelves[sh].items++; lb.shelves[sh].qty += w.q;
        lb.items++; lb.qty += w.q;
      });
    });
    return Object.keys(libs).sort(function (a, b) {
      return a.localeCompare(b, "ar", { numeric: true });
    }).map(function (k) {
      var lb = libs[k];
      lb.list = Object.keys(lb.shelves).sort(function (a, b) {
        return a.localeCompare(b, "ar", { numeric: true });
      }).map(function (x) { return lb.shelves[x]; });
      return lb;
    });
  }

  /* المواقع الحرّة: القرطاسية والمخازن */
  function spots() {
    var by = {};
    items().forEach(function (g) {
      g.at.forEach(function (w) {
        if (w.lib) return;
        var nm = w.loc || "بلا موقع";
        if (!by[nm]) by[nm] = { name: nm, items: 0, qty: 0 };
        by[nm].items++; by[nm].qty += w.q;
      });
    });
    return Object.keys(by).sort(function (a, b) { return by[b].qty - by[a].qty; })
      .map(function (k) { return by[k]; });
  }

  /* الأصناف الموجودة في مكتبة/رف بعينه، أو في موقع حرّ */
  function onShelf(lib, shelf) {
    return items().filter(function (g) {
      return g.at.some(function (w) {
        if (lib === "\u0001spot") return !w.lib && (w.loc || "بلا موقع") === shelf;
        if (w.lib !== lib) return false;
        if (!shelf) return true;
        return (w.shelf || "—") === shelf;
      });
    });
  }

  /* ---------- الرسم ---------- */

  var TABS = [
    { k: "home",     t: "المخزون",   i: "box" },
    { k: "browse",   t: "الرفوف",    i: "shelf" },
    { k: "stats",    t: "ملخّص",     i: "grid" },
    { k: "settings", t: "الإعدادات", i: "gear" }
  ];

  function paintChrome() {
    var r = el("btnRefresh"); if (r && !r.innerHTML) r.innerHTML = ico("refresh", 20);
    var g = el("btnSettings"); if (g && !g.innerHTML) g.innerHTML = ico("gear", 20);
    var x = el("qx"); if (x && !x.innerHTML) x.innerHTML = ico("x", 15);
    paintThemeBtn();

    var nav = el("tabs");
    if (!nav) return;
    Array.prototype.forEach.call(nav.children, function (b) {
      var k = b.getAttribute("data-tab");
      var def = TABS.filter(function (t) { return t.k === k; })[0];
      if (!def) return;
      if (!b.innerHTML) b.innerHTML = ico(def.i, 21) + "<span>" + def.t + "</span>";
      b.className = (S.screen === k) ? "on" : "";
    });
  }

  function render() {
    var gate = el("gate"), app = el("app");
    applyTheme();
    if (!configured()) {
      gate.hidden = false; app.hidden = true;
      return;
    }
    gate.hidden = true; app.hidden = false;

    paintHead();
    paintChrome();

    var searchOn = (S.screen === "home");
    el("searchWrap").hidden = !searchOn;

    if (S.screen === "settings") { paintSettings(); return; }
    if (!S.snap) { paintLoading(); return; }
    if (S.screen === "browse") { paintBrowse(); return; }
    if (S.screen === "stats") { paintStats(); return; }

    paintChips();
    paintList();
  }

  function paintHead() {
    var pls = places();
    var nameEl = el("shopName"), fresh = el("freshLine");
    var main = pls.filter(function (p) { return p.kind === "branch"; })[0];
    if (nameEl) nameEl.textContent = (main && main.name) || "مخزون المكتبة";

    if (!fresh) return;
    if (!S.snap) { fresh.textContent = "جارٍ الاتصال…"; fresh.className = ""; return; }
    var ages = pls.filter(function (p) { return p.kind === "branch"; })
      .map(function (p) { return ageOf(p.at); });
    if (!ages.length) { fresh.textContent = "لا توجد بيانات"; fresh.className = "stale"; return; }
    ages.sort(function (a, b) { return a.mins - b.mins; });
    var newest = ages[0], oldest = ages[ages.length - 1];
    fresh.textContent = (ages.length > 1 && newest.cls !== oldest.cls)
      ? "أحدثها " + newest.txt + " · أقدمها " + oldest.txt
      : oldest.txt;
    fresh.className = oldest.cls === "bad" ? "stale" : "";
  }

  function paintLoading() {
    var h = "";
    for (var i = 0; i < 5; i++) {
      h += '<div class="skel"><div class="s1"><i></i><i></i></div><div class="s2"></div></div>';
    }
    el("view").innerHTML = h;
    el("chips").innerHTML = "";
  }

  function paintChips() {
    var all = items();
    var nOut = 0, nLow = 0, nBook = 0, nStat = 0;
    var cats = {};
    all.forEach(function (g) {
      if (g.total <= 0) nOut++; else if (g.low) nLow++;
      if (g.t === "book") nBook++; else if (g.t === "stat") nStat++;
      if (g.c) cats[g.c] = (cats[g.c] || 0) + 1;
    });

    var defs = [
      { k: "", t: "الكل", n: all.length },
      { k: "out", t: "نفد", n: nOut },
      { k: "low", t: "قارب على النفاد", n: nLow },
      { k: "book", t: "كتب", n: nBook },
      { k: "stat", t: "قرطاسية", n: nStat }
    ];
    var nNoBc = all.filter(function (g) { return !g.b; }).length;
    defs.push({ k: "nobc", t: "بلا باركود", n: nNoBc });

    var catKeys = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; });
    catKeys.slice(0, 14).forEach(function (c) {
      defs.push({ k: "c:" + c, t: c, n: cats[c] });
    });

    el("chips").innerHTML = defs.filter(function (d) { return d.n > 0 || d.k === ""; })
      .map(function (d) {
        return '<button class="chip' + (S.filter === d.k ? " on" : "") +
          '" data-act="filter" data-arg="' + esc(d.k) + '">' +
          esc(d.t) + '<span class="c-n">' + d.n + "</span></button>";
      }).join("");
  }

  function paintList() {
    var v = el("view");
    var all = items();

    if (!all.length) {
      v.innerHTML = emptyBox("box",
        "لا توجد بيانات بعد",
        "جهاز المحل لم يرفع لقطة المخزون بعد. افتح البرنامج على الكمبيوتر واضغط «تحديث الآن» في المخزون والفروع.",
        '<button class="btn primary" data-act="refresh">حاول مرة أخرى</button>');
      el("foot").innerHTML = "";
      return;
    }

    var list = sortItems(applyFilter(search(all, S.q)));
    var h = "";

    /* لوحة الأرقام تظهر عند العرض الكامل — لا وسط نتائج البحث */
    if (!S.q && !S.filter) {
      var pieces = 0, value = 0, out = 0, low = 0;
      all.forEach(function (g) {
        pieces += g.total;
        value += g.total * g.p;
        if (g.total <= 0) out++; else if (g.low) low++;
      });
      h += '<div class="tiles">' +
        "<div class=\"tile\"><b>" + all.length + "</b><span>صنف</span></div>" +
        "<div class=\"tile\"><b>" + pieces + "</b><span>قطعة</span></div>" +
        '<button class="tile tap' + (low ? " warn" : "") + '" data-act="filter" data-arg="low">' +
        "<b>" + low + "</b><span>قارب على النفاد</span></button>" +
        '<button class="tile tap' + (out ? " bad" : "") + '" data-act="filter" data-arg="out">' +
        "<b>" + out + "</b><span>نفد</span></button>" +
        "</div>";
    }

    if (!list.length) {
      h += emptyBox("search", "لا نتائج",
        S.q ? "لا يوجد صنف يطابق «" + esc(S.q) + "». جرّب كلمة واحدة، أو الباركود، أو اسم المؤلف."
            : "لا يوجد صنف في هذا التصنيف.",
        '<button class="btn" data-act="reset">اعرض الكل</button>');
      v.innerHTML = h;
      el("foot").innerHTML = "";
      return;
    }

    var label = S.q ? "نتائج البحث" : (S.filter ? filterName() : "كل الأصناف");
    h += '<div class="sec-head"><h2>' + esc(label) + '</h2>' +
      '<span class="n">' + list.length + "</span></div>" + sortBar();

    var page = list.slice(0, S.shown);
    h += '<div class="rows">' + page.map(rowHtml).join("") + "</div>";

    if (list.length > S.shown) {
      h += '<button class="btn wide mt" data-act="more">' +
        "اعرض " + Math.min(PAGE, list.length - S.shown) + " أكثر " +
        '<span class="num">(' + S.shown + " من " + list.length + ")</span></button>";
    }

    v.innerHTML = h;
    el("foot").innerHTML = "للعرض فقط — لا بيع ولا تعديل من هنا.<br>" +
      "أسعار الشراء والأرباح لا تظهر لأنها لا تُرفع أصلاً.";
  }

  /* ---------- شاشة الرفوف ---------- */

  function paintBrowse() {
    var v = el("view");
    var libs = shelves();

    if (!libs.length) {
      v.innerHTML = emptyBox("shelf", "لا توجد مواقع مسجّلة",
        "لم تُسجَّل المكتبة والرف للأصناف بعد. اضبطها في البرنامج على " +
        "الكمبيوتر فتظهر هنا مرتّبة.");
      el("foot").innerHTML = "";
      return;
    }

    /* داخل رف بعينه */
    if (S.lib && S.shelf) {
      var isSpot = S.lib === "\u0001spot";
      var list = sortItems(onShelf(S.lib, S.shelf));
      var qty = list.reduce(function (n, g) { return n + g.total; }, 0);
      var title = isSpot ? esc(S.shelf)
        : (S.shelf === "—" ? "مكتبة " + esc(S.lib) + " · بلا رف"
                           : "مكتبة " + esc(S.lib) + " · رف " + esc(S.shelf));
      v.innerHTML =
        crumb(isSpot
          ? [{ t: "الرفوف", a: "browse" }, { t: S.shelf }]
          : [{ t: "الرفوف", a: "browse" },
             { t: "مكتبة " + S.lib, a: "lib", arg: S.lib },
             { t: S.shelf === "—" ? "بلا رف" : "رف " + S.shelf }]) +
        '<div class="sec-head"><h2>' + ico(isSpot ? "box" : "shelf", 16) + " " + title +
        '</h2><span class="n">' + list.length + " صنف · " + qty + " قطعة</span></div>" +
        (list.length ? '<div class="rows">' + list.map(rowHtml).join("") + "</div>"
                     : emptyBox("box", "لا شيء هنا", "هذا الموقع فارغ حالياً."));
      el("foot").innerHTML = "";
      return;
    }

    /* رفوف مكتبة واحدة */
    if (S.lib) {
      var lb = libs.filter(function (x) { return x.name === S.lib; })[0];
      if (!lb) { S.lib = ""; paintBrowse(); return; }
      v.innerHTML =
        crumb([{ t: "الرفوف", a: "browse" }, { t: "مكتبة " + S.lib }]) +
        '<div class="sec-head"><h2>' + ico("shelf", 16) + " مكتبة " + esc(S.lib) +
        '</h2><span class="n">' + lb.list.length + " رف · " + lb.qty + " قطعة</span></div>" +
        '<div class="tiles tiles-3">' + lb.list.map(function (sh) {
          return '<button class="tile tap shelf-tile" data-act="shelf" data-arg="' +
            esc(S.lib) + '" data-arg2="' + esc(sh.name) + '">' +
            '<span class="sh-n">' + (sh.name === "—" ? "بلا رف" : "رف " + esc(sh.name)) + "</span>" +
            "<b>" + sh.items + "</b><span>صنف · " + sh.qty + " قطعة</span></button>";
        }).join("") + "</div>";
      el("foot").innerHTML = "";
      return;
    }

    /* كل المكتبات */
    var totQ = libs.reduce(function (n, l) { return n + l.qty; }, 0);
    var sp = spots();
    var h2 = '<div class="sec-head"><h2>' + ico("shelf", 16) + " المكتبات والرفوف</h2>" +
      '<span class="n">' + libs.length + " مكتبة · " + totQ + " قطعة</span></div>" +
      '<p class="lead">اختر مكتبة ثم رفّاً لترى ما فيه وحده — بدل أن يظهر ' +
      "المخزون كله دفعة واحدة.</p>";

    h2 += '<div class="libs">' + libs.map(function (lb) {
      /* رفوف المكتبة تُعرض شارات تُضغط مباشرة: أسرع من فتح المكتبة
         ثم الرف، والرقم على كل شارة يقول أين البضاعة قبل أن تدخل. */
      var chips = lb.list.slice(0, 12).map(function (sh) {
        return '<span class="sh-chip" data-act="shelf" data-arg="' + esc(lb.name) +
          '" data-arg2="' + esc(sh.name) + '">' +
          (sh.name === "—" ? "بلا رف" : "رف " + esc(sh.name)) +
          '<i>' + sh.items + "</i></span>";
      }).join("");
      return '<div class="lib-card">' +
        '<button class="lib-head" data-act="lib" data-arg="' + esc(lb.name) + '">' +
        '<span class="lib-badge">' + esc(lb.name) + "</span>" +
        '<span class="lib-meta"><b>مكتبة ' + esc(lb.name) + "</b><span>" +
        lb.items + " صنف · " + lb.qty + " قطعة · " + lb.list.length + " رف</span></span>" +
        '<span class="lib-go">' + ico("back", 18) + "</span></button>" +
        '<div class="sh-chips">' + chips +
        (lb.list.length > 12 ? '<span class="sh-more">+' + (lb.list.length - 12) + "</span>" : "") +
        "</div></div>";
    }).join("") + "</div>";

    if (sp.length) {
      h2 += '<div class="sec-head"><h2>' + ico("box", 16) + " مواقع أخرى</h2>" +
        '<span class="n">' + sp.length + "</span></div>" +
        '<p class="lead">القرطاسية والمخازن: موقعها نصّ حرّ لا مكتبة ورف.</p>' +
        '<div class="rows">' + sp.map(function (x) {
          return '<button class="row spot" data-act="shelf" data-arg="\u0001spot" data-arg2="' +
            esc(x.name) + '">' +
            '<span class="row-ic st">' + ico("box", 17) + "</span>" +
            '<div class="row-main"><div class="row-name">' + esc(x.name) + "</div>" +
            '<div class="row-sub">' + x.items + " صنف</div></div>" +
            '<div class="row-side"><span class="pill">' + x.qty + "</span></div></button>";
        }).join("") + "</div>";
    }

    v.innerHTML = h2;
    el("foot").innerHTML = "";
  }

  function crumb(parts) {
    return '<div class="crumb">' + parts.map(function (p, i) {
      var last = i === parts.length - 1;
      if (last) return '<span class="cur">' + esc(p.t) + "</span>";
      return '<button data-act="' + (p.a || "browse") + '"' +
        (p.arg ? ' data-arg="' + esc(p.arg) + '"' : "") + ">" + esc(p.t) + "</button>" +
        '<span class="sep">/</span>';
    }).join("") + "</div>";
  }

  /* ---------- شاشة الملخّص ---------- */

  function paintStats() {
    var all = items();
    var v = el("view");
    if (!all.length) {
      v.innerHTML = emptyBox("box", "لا توجد بيانات بعد", "اضغط زر التحديث في الأعلى.");
      el("foot").innerHTML = "";
      return;
    }

    var pieces = 0, value = 0, out = 0, low = 0, noBc = 0, books = 0, stat = 0;
    var cats = {};
    all.forEach(function (g) {
      pieces += g.total; value += g.total * g.p;
      if (g.total <= 0) out++; else if (g.low) low++;
      if (!g.b) noBc++;
      if (g.t === "book") books++; else if (g.t === "stat") stat++;
      var c = g.c || "";
      if (!cats[c]) cats[c] = { n: 0, q: 0, v: 0 };
      cats[c].n++; cats[c].q += g.total; cats[c].v += g.total * g.p;
    });

    var h = '<div class="hero">' +
      '<div class="hero-v"><span>قيمة المخزون بسعر البيع</span><b>' + money(value) + "</b></div>" +
      '<div class="hero-sub">' + all.length + " صنف · " + pieces + " قطعة</div>" +
      "</div>";

    h += '<div class="tiles">' +
      tile("book", books, "كتاب", "") +
      tile("pen", stat, "قرطاسية", "") +
      tileBtn("alert", low, "قارب على النفاد", low ? "warn" : "", "low") +
      tileBtn("box", out, "نفد", out ? "bad" : "", "out") +
      "</div>";

    if (noBc) {
      h += '<button class="note-card" data-act="filter" data-arg="nobc">' +
        ico("tag", 20) + "<div><b>" + noBc + " صنف بلا باركود</b>" +
        "<span>لم تُطبع لاصقاتها بعد — اضغط لتراها.</span></div>" +
        ico("back", 18) + "</button>";
    }

    var keys = Object.keys(cats).sort(function (a, b) { return cats[b].q - cats[a].q; });
    var maxQ = keys.length ? cats[keys[0]].q : 1;
    h += '<div class="sec-head"><h2>' + ico("grid", 16) + " التصنيفات</h2>" +
      '<span class="n">' + keys.length + "</span></div>";
    h += '<div class="cats">' + keys.slice(0, 20).map(function (c) {
      var w = Math.max(3, Math.round(cats[c].q / Math.max(1, maxQ) * 100));
      return '<button class="cat-row" data-act="filter" data-arg="c:' + esc(c) + '">' +
        '<span class="cat-n' + (c ? "" : " none") + '">' + esc(c || "بلا تصنيف") + "</span>" +
        '<span class="cat-bar"><i class="w' + Math.round(w / 10) * 10 + '"></i></span>' +
        '<span class="cat-q">' + cats[c].q + "</span></button>";
    }).join("") + "</div>";

    v.innerHTML = h;
    el("foot").innerHTML = "";
  }

  function tile(icon, n, label, cls) {
    return '<div class="tile ' + cls + '">' + ico(icon, 18) +
      "<b>" + n + "</b><span>" + label + "</span></div>";
  }
  function tileBtn(icon, n, label, cls, act) {
    return '<button class="tile tap ' + cls + '" data-act="filter" data-arg="' + act + '">' +
      ico(icon, 18) + "<b>" + n + "</b><span>" + label + "</span></button>";
  }

  function sortBar() {
    return '<div class="sortbar">' + ico("sort", 14) +
      Object.keys(SORTS).map(function (k) {
        return '<button class="' + (S.sort === k ? "on" : "") +
          '" data-act="sort" data-arg="' + k + '">' + SORTS[k].t + "</button>";
      }).join("") + "</div>";
  }

  function filterName() {
    if (S.filter === "out") return "نفد من المخزون";
    if (S.filter === "low") return "قارب على النفاد";
    if (S.filter === "book") return "الكتب";
    if (S.filter === "stat") return "القرطاسية";
    if (S.filter === "nobc") return "بلا باركود";
    if (S.filter === "c:") return "بلا تصنيف";
    if (S.filter.indexOf("c:") === 0) return S.filter.slice(2);
    return "كل الأصناف";
  }

  function rowHtml(g, i) {
    var out = g.total <= 0;
    var cls = out ? "bad" : (g.low ? "warn" : "");
    var sub = [g.a, g.d].filter(Boolean).join(" · ");
    if (!sub && g.at.length) sub = g.at[0].loc || "";

    var tags = "";
    if (g.c) tags += '<span class="tag g">' + esc(g.c) + "</span>";
    if (g.at.length > 1) tags += '<span class="tag">' + ico("box", 11) + " في " + g.at.length + " أماكن</span>";
    else if (g.at[0] && g.at[0].loc) tags += '<span class="tag">' + ico("shelf", 11) + " " + esc(g.at[0].loc) + "</span>";
    if (!g.b) tags += '<span class="tag a">' + ico("tag", 11) + ' بلا باركود</span>';

    /* تأخير الظهور يتدرّج بالصنف لا بقيمة سطرية: سياسة الأمان تمنع
       style=""، والأصناف العشرة الأولى تكفي للإحساس بالتتابع. */
    return '<button class="row d' + Math.min(i, 9) + (out ? " out" : "") +
      '" data-act="open" data-arg="' + esc(g.key) + '">' +
      '<span class="row-ic ' + (g.t === "book" ? "bk" : "st") + '">' +
      ico(g.t === "book" ? "book" : "pen", 17) + "</span>" +
      '<div class="row-main">' +
      '<div class="row-name">' + esc(g.n) + "</div>" +
      (sub ? '<div class="row-sub">' + esc(sub) + "</div>" : "") +
      (tags ? '<div class="row-tags">' + tags + "</div>" : "") +
      "</div>" +
      '<div class="row-side">' +
      '<span class="pill ' + cls + '">' + g.total + "</span>" +
      (g.p > 0 ? '<span class="row-price">' + money(g.p) + "</span>" : "") +
      "</div></button>";
  }

  function emptyBox(icon, title, text, action) {
    return '<div class="empty">' + ico(ICONS[icon] ? icon : "empty", 52) +
      "<h3>" + title + "</h3><p>" + text + "</p>" + (action || "") + "</div>";
  }

  /* ---------- صفحة الصنف ---------- */

  function open(key) {
    var g = null;
    items().forEach(function (x) { if (x.key === key) g = x; });
    if (!g) return;

    var out = g.total <= 0;
    var h = '<div class="inner"><div class="grab"></div>' +
      '<div class="det-head"><h2>' + esc(g.n) + "</h2>" +
      (g.a ? '<p class="by">' + esc(g.a) + "</p>" : "") +
      '<div class="det-tags">' +
      (g.c ? '<span class="tag g">' + esc(g.c) + "</span>" : "") +
      (g.d ? '<span class="tag">' + esc(g.d) + "</span>" : "") +
      '<span class="tag">' + (g.t === "book" ? "كتاب" : "قرطاسية") + "</span>" +
      (out ? '<span class="tag r">نفد</span>' : (g.low ? '<span class="tag a">قارب على النفاد</span>' : "")) +
      "</div></div>";

    h += '<div class="det-big">' +
      '<div class="' + (out ? "bad" : (g.low ? "warn" : "")) + '">' + ico("box", 16) +
      "<b>" + g.total + "</b><span>" + (g.u || "قطعة") + " في المجموع</span></div>" +
      "<div>" + ico("money", 16) + "<b>" + money(g.p) + "</b><span>سعر البيع</span></div>" +
      "</div>";

    h += '<dl class="det-rows">';
    h += detRow("الباركود", g.b
      ? '<span class="ltr">' + esc(g.b) + "</span>" +
        '<button class="mini" data-act="copy" data-arg="' + esc(g.b) + '" ' +
        'aria-label="نسخ الباركود">' + ico("copy", 14) + "</button>"
      : '<span class="muted">— لم يُصدر بعد —</span>');
    if (g.code) h += detRow("الرمز", '<span class="ltr">' + esc(g.code) + "</span>");
    if (g.total > 0 && g.p > 0) {
      h += detRow("قيمة المتوفّر", '<span class="ltr">' + money(g.total * g.p) + "</span>");
    }
    h += "</dl>";

    if (g.nt) h += '<div class="det-note">' + esc(g.nt) + "</div>";

    h += '<div class="det-where"><h3>' + ico("shelf", 14) + " أين يوجد</h3>";
    g.at.slice().sort(function (a, b) { return b.q - a.q; }).forEach(function (w) {
      var a = ageOf(w.place.at);
      h += '<div class="wrow' + (a.cls === "bad" ? " stale" : "") + '">' +
        "<b>" + w.q + "</b>" +
        '<span class="wn">' + (w.place.kind === "wh" ? "▤ " : "") + esc(w.place.name) +
        (w.loc ? " — " + esc(w.loc) : "") + "</span>" +
        (a.cls === "bad" ? '<span class="wa">' + esc(a.txt) + "</span>"
                         : '<span class="wl">' + esc(a.txt) + "</span>") +
        "</div>";
    });
    h += "</div>";

    var ph = null;
    g.at.forEach(function (w) { if (!ph && w.place.phone) ph = w.place.phone; });
    h += '<div class="det-acts">' +
      (ph ? '<a class="btn" href="tel:' +
        esc(String(ph).replace(/[^\d+]/g, "")) + '">' + ico("phone", 16) + " اتصل بالفرع</a>" : "") +
      '<button class="btn primary" data-act="closeSheet">إغلاق</button>' +
      "</div></div>";

    var s = el("sheet");
    s.innerHTML = h;
    s.hidden = false;
    s.onclick = function (e) { if (e.target === s) closeSheet(); };
    document.body.style.overflow = "hidden";
  }

  function detRow(k, v) {
    return '<div class="det-row"><dt>' + k + "</dt><dd>" + v + "</dd></div>";
  }

  function closeSheet() {
    var s = el("sheet");
    s.hidden = true; s.innerHTML = "";
    document.body.style.overflow = "";
  }

  /* ---------- الإعدادات ---------- */

  function paintSettings() {
    var pls = places();
    var h = '<div class="card"><h2>بيانات الربط</h2>' +
      '<p class="sub">نفس العنوان وكلمة السر الموجودين في البرنامج على الكمبيوتر: ' +
      "المخزون والفروع ← إعدادات الربط.</p>" +
      '<label class="fld"><span>عنوان الربط</span>' +
      '<input class="inp ltr" id="sUrl" type="url" spellcheck="false" value="' +
      esc(S.cfg.url) + '"></label>' +
      '<label class="fld"><span>كلمة سر الربط</span>' +
      '<input class="inp ltr" id="sKey" type="password" spellcheck="false" value="' +
      esc(S.cfg.key) + '"></label>' +
      '<button class="btn primary" data-act="saveCfg">حفظ وتحديث</button>' +
      "</div>";

    if (pls.length) {
      h += '<div class="card"><h2>الأماكن</h2>' +
        '<p class="sub">كل فرع ومخزن في اللقطة، ومتى آخر خبر منه.</p>';
      pls.forEach(function (p) {
        var a = ageOf(p.at);
        var n = p.items.reduce(function (s2, i) { return s2 + i.q; }, 0);
        h += '<div class="wrow' + (a.cls === "bad" ? " stale" : "") + '">' +
          "<b>" + n + "</b>" +
          '<span class="wn">' + (p.kind === "wh" ? "▤ " : "") + esc(p.name) +
          (p.city ? " — " + esc(p.city) : "") + "</span>" +
          '<span class="' + (a.cls === "bad" ? "wa" : "wl") + '">' + esc(a.txt) + "</span>" +
          "</div>";
      });
      h += "</div>";
    }

    if (S.snap) {
      var recs = countRecords(), uniq = countItems(), dups = merged();
      h += '<div class="card"><h2>هذه النسخة</h2>' +
        '<dl class="kv"><dt>وصلت</dt><dd>' + esc(ageOf(S.snap.at).txt) + "</dd></dl>" +
        '<dl class="kv"><dt>السجلات</dt><dd>' + recs + "</dd></dl>" +
        '<dl class="kv"><dt>الأصناف</dt><dd>' + uniq + "</dd></dl>";
      /* الرقمان يختلفان حين يوجد الصنف في أكثر من مكان — وهذا طبيعي.
         أما اجتماع سجلّين في المكان نفسه فتكرار يستحق النظر. */
      if (recs !== uniq) {
        h += '<p class="sub tight">الفرق طبيعي: الصنف الموجود في فرع ومخزن ' +
          "يُحسب سجلَّين ويُعرض صنفاً واحداً بمجموع كميته.</p>";
      }
      if (dups.length) {
        h += '<div class="warnbox">' + ico("alert", 18) +
          "<div><b>" + dups.length + " صنف مكرّر في المكان نفسه</b>" +
          "<span>أسماء متطابقة بلا باركود يميّزها. راجعها في البرنامج:</span>" +
          '<span class="dups">' + dups.slice(0, 8).map(function (g) {
            return esc(g.n);
          }).join(" · ") + "</span></div></div>";
      }
      h += '<p class="sub tight">محفوظة على هذا الجهاز وحده، فتعمل الصفحة ' +
        "بلا إنترنت. لا تُرسل لأي جهة.</p></div>";
    }

    h += '<div class="card"><h2>إزالة الربط</h2>' +
      '<p class="sub">يمسح العنوان وكلمة السر والنسخة المحفوظة من هذا الجهاز. ' +
      "لا يمس بيانات البرنامج على الكمبيوتر إطلاقاً.</p>" +
      '<button class="btn danger" data-act="wipe">امسح من هذا الجهاز</button></div>';

    h += '<button class="btn wide" data-act="go" data-arg="home">رجوع للمخزون</button>';
    el("view").innerHTML = h;
    el("foot").innerHTML = "";
  }

  /* ---------- الأحداث ---------- */

  function go(screen) {
    S.screen = screen;
    if (screen === "home") { S.shown = PAGE; }
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function setQ(v) {
    S.q = v; S.shown = PAGE;
    var x = el("qx"); if (x) x.hidden = !v;
    paintList();
  }

  function clearQ() {
    var i = el("q");
    if (i) { i.value = ""; i.focus(); }
    setQ("");
  }

  function setFilter(k) {
    S.filter = (S.filter === k) ? "" : k;
    S.shown = PAGE;
    S.screen = "home";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    S.q = ""; S.filter = ""; S.shown = PAGE;
    var i = el("q"); if (i) i.value = "";
    var x = el("qx"); if (x) x.hidden = true;
    render();
  }

  function more() { S.shown += PAGE; paintList(); }

  function saveCfg() {
    var u = el("sUrl"), k = el("sKey");
    if (!u) return;
    var url = u.value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    S.cfg.url = url;
    S.cfg.key = k ? k.value.trim() : "";
    save();
    if (!S.cfg.url) { render(); return; }
    go("home");
    refresh();
  }

  function wipe() {
    if (!window.confirm("سيُمسح العنوان وكلمة السر والنسخة المحفوظة من هذا الجهاز. متأكد؟")) return;
    S = blank();
    try { localStorage.removeItem(KEY); } catch (e) { }
    render();
    toast("مُسح كل شيء من هذا الجهاز.");
  }

  /* شاشة الربط الأولى */
  function gateSubmit(e) {
    if (e) e.preventDefault();
    var u = el("gUrl"), k = el("gKey"), btn = el("gateBtn"), err = el("gateErr");
    var url = u.value.trim();
    if (!url) { showGateErr("اكتب عنوان الربط أولاً."); u.focus(); return; }
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    if (!k.value.trim()) { showGateErr("اكتب كلمة سر الربط."); k.focus(); return; }

    err.hidden = true;
    btn.classList.add("busy");
    btn.querySelector(".btn-label").textContent = "جارٍ الاتصال…";

    var old = { url: S.cfg.url, key: S.cfg.key };
    S.cfg.url = url; S.cfg.key = k.value.trim();

    fetchAll().then(function (branches) {
      S.snap = { at: new Date().toISOString(), branches: branches };
      save();
      btn.classList.remove("busy");
      btn.querySelector(".btn-label").textContent = "اتصل واعرض المخزون";
      render();
      toast("تم الربط — " + countItems() + " صنف.", "ok");
    }).catch(function (e2) {
      S.cfg = old;
      btn.classList.remove("busy");
      btn.querySelector(".btn-label").textContent = "اتصل واعرض المخزون";
      var m = e2 && e2.message;
      if (m === "BADKEY") showGateErr("كلمة سر الربط غير صحيحة. انسخها من البرنامج كما هي.");
      else if (/^HTTP 404/.test(m || "")) showGateErr("العنوان لا يستجيب. تأكد أنه عنوان الـWorker نفسه.");
      else showGateErr("تعذّر الاتصال. تأكد من الإنترنت ومن صحة العنوان.");
    });
  }

  function showGateErr(msg) {
    var e = el("gateErr");
    e.textContent = msg;
    e.hidden = false;
    e.style.animation = "none";
    void e.offsetWidth;
    e.style.animation = "";
  }

  /* ---------- الإقلاع ---------- */

  /* كل زر يقول ما يفعله في data-act، ومستمع واحد يوزّع.
     سياسة أمان الصفحة تمنع السكربت السطري وonclick، وهي حماية
     مقصودة: لو تسلّل نص خبيث إلى اسم صنف لما نُفِّذ. */
  var ACTS = {
    go: function (a) { go(a); },
    refresh: function () { refresh(); },
    filter: function (a) { setFilter(a); },
    open: function (a) { open(a); },
    reset: function () { reset(); },
    more: function () { more(); },
    clearQ: function () { clearQ(); },
    closeSheet: function () { closeSheet(); },
    saveCfg: function () { saveCfg(); },
    wipe: function () { wipe(); },
    theme: function () { cycleTheme(); },
    sort: function (a) { setSort(a); },
    browse: function () { S.lib = ""; S.shelf = ""; go("browse"); },
    lib: function (a) { S.lib = a; S.shelf = ""; go("browse"); },
    /* المكتبة والرف في سمتين منفصلتين: الحرف الفاصل داخل سمة واحدة
       لا ينجو من تحليل HTML (المحلّل يُسقط المحارف الصفرية). */
    shelf: function (a, b2) { S.lib = a; S.shelf = b2; go("browse"); },
    copy: function (a) { copyText(a); }
  };

  function setSort(k) {
    if (!SORTS[k]) return;
    S.sort = k; S.shown = PAGE;
    save();
    render();
  }

  function copyText(t) {
    var done = function () { toast("نُسخ: " + t, "ok"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done).catch(function () { fallback(); });
    } else fallback();
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = t; ta.className = "offscreen";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      } catch (e) { toast("تعذّر النسخ.", "warn"); }
    }
  }

  function onTap(e) {
    var t = e.target;
    while (t && t !== document.body) {
      if (t.getAttribute) {
        var a = t.getAttribute("data-act");
        if (a) {
          var fn = ACTS[a];
          if (fn) {
            e.preventDefault();
            fn(t.getAttribute("data-arg") || "", t.getAttribute("data-arg2") || "");
          }
          return;
        }
      }
      t = t.parentNode;
    }
  }

  /* رابط تهيئة يُفتح مرة واحدة:
       https://mawqi3ak.netlify.app/#u=العنوان&k=كلمة-السر
     يُحفظ ما فيه ثم يُمسح من شريط العنوان فوراً، فلا يبقى معروضاً
     ولا يدخل سجلّ التصفّح. أأمن من كتابة كلمة السر في ملف منشور،
     لأن من لا يملك الرابط لا يرى شيئاً. */
  function fromHash() {
    var h = String(location.hash || "").replace(/^#/, "");
    if (!h) return false;
    var got = {}, any = false;
    h.split("&").forEach(function (part) {
      var i = part.indexOf("=");
      if (i < 0) return;
      var k = part.slice(0, i), v = part.slice(i + 1);
      try { v = decodeURIComponent(v.replace(/\+/g, " ")); } catch (e) { }
      if (k === "u" || k === "url") { got.url = v; any = true; }
      if (k === "k" || k === "key") { got.key = v; any = true; }
    });
    if (!any) return false;
    if (got.url) {
      var u = got.url.trim();
      if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
      S.cfg.url = u;
    }
    if (got.key !== undefined) S.cfg.key = got.key.trim();
    save();
    /* امسح الجزء الحسّاس من شريط العنوان بلا إعادة تحميل */
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) { location.hash = ""; }
    return true;
  }

  /* بيانات مدمجة في config.js — تُستعمل فقط إن لم يكن الجهاز مربوطاً */
  function fromConfig() {
    var c = window.MAKTABA_CONFIG;
    if (!c || typeof c !== "object") return false;
    var u = String(c.url || "").trim();
    if (!u) return false;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    S.cfg.url = u;
    S.cfg.key = String(c.key || "").trim();
    return true;
  }

  function boot() {
    S = load();

    /* الترتيب مقصود: الرابط يغلب المحفوظ (فبه تُصلح بياناتٍ خاطئة)،
       والمحفوظ يغلب المدمج (فلا يُلغى ما ضبطه صاحب الجهاز بيده). */
    var viaHash = fromHash();
    if (!viaHash && !configured()) { if (fromConfig()) save(); }

    document.addEventListener("click", onTap);

    var f = el("gateForm");
    if (f) f.addEventListener("submit", gateSubmit);

    var q = el("q");
    if (q) {
      var t = null;
      q.addEventListener("input", function () {
        var v = this.value;
        clearTimeout(t);
        t = setTimeout(function () { setQ(v); }, 110);
      });
      /* قارئ الباركود يرسل Enter — نبحث فوراً بلا انتظار */
      q.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); clearTimeout(t); setQ(this.value); this.blur(); }
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !el("sheet").hidden) closeSheet();
    });

    var url = el("gUrl");
    if (url && S.cfg.url) url.value = S.cfg.url;

    render();
    if (configured()) refresh(!!S.snap);

    /* عند العودة للصفحة: الأرقام القديمة أسوأ من الانتظار لحظة */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && configured() && !busy) refresh(true);
    });

    /* فتح رابط تهيئة والصفحة مفتوحة أصلاً لا يعيد تحميلها، فلا يمرّ
       على boot. هذا يلتقطه. */
    window.addEventListener("hashchange", function () {
      if (fromHash()) { render(); refresh(); }
    });
  }

  /* يبدأ وحده: الوسم <script> في آخر <body> فالمستند جاهز، ومع ذلك
     ننتظر DOMContentLoaded احتياطاً إن نُقل الوسم يوماً إلى <head>. */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  return {
    boot: boot, refresh: refresh, render: render,
    go: go, open: open, closeSheet: closeSheet,
    setQ: setQ, clearQ: clearQ, setFilter: setFilter, reset: reset, more: more,
    saveCfg: saveCfg, wipe: wipe, gateSubmit: gateSubmit,
    items: items, places: places, search: search, norm: norm, num: num, ageOf: ageOf,
    get S() { return S; }
  };
})();
