/* ============================================================
   core.js — الحالة، الحفظ، الأدوات المشتركة، التنقل
   ============================================================ */

var App = (function () {

  var S = null;              // الحالة الكاملة
  var pendingProfitCode = "";   // رمز أرباح من نسخة قديمة، يُنقل إلى النواة عند الإقلاع
  var saveTimer = null;
  var saving = false;
  var dirty = false;

  /* ---------- النموذج الافتراضي ---------- */

  function blank() {
    return {
      meta: {
        version: 1,
        shopName: "",
        phone: "",
        address: "",
        currency: "د.ل",
        receiptWidth: "80",
        printMode: "image",
        autoPrint: true,
        uiSize: "lg",
        cardName: "البطاقة المصرفية",
        theme: "green",
        lastBook: { lib: "", shelf: "", cat: "", publisher: "", qty: 2, min: 0 },
        lastStat: { cat: "", loc: "", unit: "", qty: 2, min: 0 },
        quickPicks: [],
        footer: "شكراً لزيارتكم",
        libraries: ["A", "B", "C"],
        shelves: 6,
        bookCats: ["مدرسي", "ديني", "روايات", "أطفال", "جامعي", "تنمية بشرية", "متنوع"],
        statCats: ["أقلام", "دفاتر", "ورق", "أدوات مكتبية", "حقائب", "رسم وألوان", "متنوع"],
        units: ["قطعة", "علبة", "دزينة", "رزمة", "طقم", "متر", "كيلو"],
        setupDone: false
      },
      branch: { id: "", name: "", city: "", phone: "", label: "", no: 0 },
      sync: { url: "", key: "", site: "", auto: true, everyMin: 10, lastAt: "", lastOk: false, lastError: "", lastHash: "" },
      notify: {
        enabled: false, server: "https://ntfy.sh", topic: "",
        kinds: { low: true, out: true, sale: false, bigsale: false, debt: true, pay: false, transfer: true, daily: true },
        bigAmount: 100, dailyHour: 20, lastDaily: "", log: []
      },
      consignors: [], consignments: [], consPayments: [], closings: [], publishers: [],
      counts: [], countSession: null,
      remotes: [],
      warehouses: [],
      outbox: [],
      books: [], stationery: [], customers: [], suppliers: [],
      invoices: [], payments: [], purchases: [], log: [],
      counters: { invoice: 0, book: 0, stat: 0 }
    };
  }

  function heal(s) {
    var b = blank();
    if (!s || typeof s !== "object") return b;
    for (var k in b) { if (!(k in s) || s[k] === null) s[k] = b[k]; }
    for (var m in b.meta) { if (!(m in s.meta) || s.meta[m] === null) s.meta[m] = b.meta[m]; }
    if (!s.meta.lastBook || typeof s.meta.lastBook !== "object") s.meta.lastBook = b.meta.lastBook;
    if (!s.meta.lastStat || typeof s.meta.lastStat !== "object") s.meta.lastStat = b.meta.lastStat;
    if (!Array.isArray(s.meta.quickPicks)) s.meta.quickPicks = [];
    /* الرمز صار مجزّأً في النواة. من غيّر رمزه في نسخة قديمة كان رمزه
       مخزّناً هنا — ننقله أولاً ثم نمسحه، وإلا عاد الرمز الافتراضي بصمت
       وفقد صاحب المحل رمزه الذي اختاره. */
    if (s.meta.profitCode) { pendingProfitCode = String(s.meta.profitCode); delete s.meta.profitCode; }
    for (var br in b.branch) { if (!(br in s.branch) || s.branch[br] === null) s.branch[br] = b.branch[br]; }
    repairBranch(s);
    for (var sy in b.sync) { if (!(sy in s.sync) || s.sync[sy] === null) s.sync[sy] = b.sync[sy]; }
    if (!s.notify || typeof s.notify !== "object") s.notify = b.notify;
    for (var nk in b.notify) { if (!(nk in s.notify) || s.notify[nk] === null) s.notify[nk] = b.notify[nk]; }
    for (var kk in b.notify.kinds) { if (!(kk in s.notify.kinds)) s.notify.kinds[kk] = b.notify.kinds[kk]; }
    for (var c in b.counters) { if (typeof s.counters[c] !== "number") s.counters[c] = b.counters[c]; }
    ["books", "stationery", "customers", "suppliers", "invoices", "payments", "purchases", "log",
      "remotes", "warehouses", "outbox",
      "consignors", "consignments", "consPayments", "closings", "publishers", "counts"]
      .forEach(function (k) { if (!Array.isArray(s[k])) s[k] = []; });
    return s;
  }

  /* ---------- الاتصال بالنواة ----------
     كل نداء يحمل ترويسة X-Qirtasiya. الترويسة المخصّصة تُجبر المتصفح على
     طلب preflight قبل أي نداء من أصل آخر، والنواة لا ترسل ترويسات CORS —
     فلا تستطيع صفحة ويب خارجية أن تكتب في بياناتك ولو كانت المنظومة تعمل. */

  var ownerToken = "";          // رمز النافذة المالكة — بدونه لا يُقبل الحفظ
  var readOnly = false;         // نافذة ثانية، أو ملف بيانات تالف
  var blockReason = "";

  function api(path, opts) {
    opts = opts || {};
    var h = { "X-Qirtasiya": "1" };
    for (var k in (opts.headers || {})) h[k] = opts.headers[k];
    if (ownerToken) h["X-Owner"] = ownerToken;
    return fetch(path, {
      method: opts.method || "GET",
      headers: h,
      body: opts.body,
      keepalive: !!opts.keepalive
    });
  }

  function apiJson(path, opts) {
    return api(path, opts).then(function (r) { return r.json(); });
  }

  /* ---------- التحميل والحفظ ---------- */

  /* الملف التالف لا يُبتلع بصمت: نتوقف ونعرض شاشة استرجاع.
     البدء بحالة فارغة ثم الحفظ فوقها كان يمحو ما تبقّى من البيانات. */
  function load() {
    return api("/api/load").then(function (r) { return r.text(); })
      .then(function (txt) {
        var t = String(txt == null ? "" : txt).trim();
        if (t === "" || t === "null") { S = heal(null); return S; }   // أول تشغيل
        var parsed;
        try { parsed = JSON.parse(t); }
        catch (e) {
          S = heal(null);
          block("ملف البيانات تالف — لم تُفتح أي بيانات، ولن يُحفظ شيء فوقه.");
          return S;
        }
        S = heal(parsed);
        return S;
      })
      .catch(function () {
        S = heal(null);
        block("تعذّر الاتصال بمحرك البرنامج.");
        return S;
      });
  }

  function block(reason) {
    readOnly = true;
    blockReason = reason;
    setState("blocked");
  }
  function isReadOnly() { return readOnly; }
  function readOnlyReason() { return blockReason; }

  function setState(txt) {
    var el = document.getElementById("saveState");
    if (!el) return;
    if (txt === "saving") el.innerHTML = '<span class="dot-live saving"></span> جارٍ الحفظ…';
    else if (txt === "error") el.innerHTML = '<span class="dot-live bad"></span> لم يُحفظ!';
    else if (txt === "blocked") el.innerHTML = '<span class="dot-live bad"></span> للعرض فقط';
    else el.innerHTML = '<span class="dot-live"></span> محفوظ';
  }

  var firstDirtyAt = 0;

  function save() {
    if (readOnly) return;
    dirty = true;
    if (!firstDirtyAt) firstDirtyAt = Date.now();
    if (saveTimer) clearTimeout(saveTimer);
    // لا يتأخر الحفظ أكثر من ثانيتين مهما تتابعت التعديلات
    if (!saving && Date.now() - firstDirtyAt > 2000) { saveNow(); return; }
    saveTimer = setTimeout(saveNow, 500);
  }

  function saveNow() {
    if (readOnly) return Promise.resolve();
    if (saving) {
      dirty = true;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNow, 300);
      return Promise.resolve();
    }
    saving = true;
    setState("saving");
    return api("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(S)
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        saving = false;
        if (res && res.ok) { dirty = false; firstDirtyAt = 0; setState("ok"); return; }
        // نافذة أخرى أخذت الملكية — نتوقف فوراً بدل الكتابة فوق عملها
        if (res && res.notOwner) { lostOwnership(); return; }
        setState("error");
        toast("تعذّر حفظ البيانات على القرص.", "bad");
      })
      .catch(function () {
        saving = false; setState("error");
        toast("انقطع الاتصال بمحرك البرنامج. لا تغلق النافذة.", "bad");
      });
  }

  window.addEventListener("beforeunload", function () {
    if (readOnly) return;
    // fetch مع keepalive بدل sendBeacon — لأن sendBeacon لا يحمل ترويسات مخصّصة
    if (dirty) {
      try {
        api("/api/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(S),
          keepalive: true
        });
      } catch (e) { }
    }
    releaseOwnership();
  });
  window.addEventListener("pagehide", releaseOwnership);

  /* sendBeacon هو الوحيد الذي يصل دائماً أثناء الإغلاق، لكنه لا يحمل
     ترويسات مخصّصة — فنمرّر الرمز في العنوان. النواة تقبله لهذا المسار
     وحده، ولا يفعل شيئاً سوى تحرير القفل. */
  function releaseOwnership() {
    if (!ownerToken) return;
    var url = "/api/release?t=" + encodeURIComponent(ownerToken);
    var sent = false;
    try { sent = !!(navigator.sendBeacon && navigator.sendBeacon(url, "")); } catch (e) { }
    if (!sent) { try { api(url, { method: "POST", body: "{}", keepalive: true }); } catch (e) { } }
    ownerToken = "";
  }

  /* ---------- ملكية النافذة ----------
     نافذتان مفتوحتان كانتا تدهسان عمل بعضهما: كل واحدة تحمل نسخة كاملة
     في ذاكرتها، وآخر من يحفظ يمسح ما قبله. الآن نافذة واحدة فقط تملك
     حق الكتابة، والباقي للعرض. */

  function claim(force) {
    return apiJson("/api/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: !!force })
    }).then(function (res) {
      if (res && res.ok && res.token) {
        ownerToken = res.token;
        readOnly = false; blockReason = "";
        setState("ok");
        startHeartbeat();
        return true;
      }
      return false;
    }).catch(function () { return false; });
  }

  var hbTimer = null;
  function startHeartbeat() {
    if (hbTimer) clearInterval(hbTimer);
    hbTimer = setInterval(function () {
      if (readOnly || !ownerToken) return;
      apiJson("/api/heartbeat", { method: "POST", body: "{}" })
        .then(function (res) { if (res && res.notOwner) lostOwnership(); })
        .catch(function () { });
    }, 5000);
  }

  function lostOwnership() {
    saving = false;
    ownerToken = "";
    block("نافذة أخرى من المنظومة أخذت التحكّم. هذه النافذة للعرض فقط.");
    rerender();
  }

  function takeOver() {
    claim(true).then(function (ok) {
      if (ok) location.reload();
      else toast("تعذّر أخذ التحكّم.", "bad");
    });
  }

  /* ---------- أدوات عامة ---------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* أيقونات SVG — أوضح من الرموز النصية وتتلوّن مع الثيم */
  var ICONS = {
    dash: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
    pos: "M3 3h2l.4 2M7 13h10l3-8H5.4M7 13L5.4 5M7 13l-2 4h13M9 21a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z",
    invoice: "M6 2h9l5 5v15H6V2zm9 0v5h5M9 12h8M9 16h8M9 8h3",
    stocktake: "M9 3h6v3H9V3zM7 5H5v16h14V5h-2M8.5 11.5l1.5 1.5 3-3M8.5 16.5l1.5 1.5 3-3",
    store: "M3 9l2-5h14l2 5M3 9v11h18V9M3 9h18M9 20v-6h6v6",
    goods: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3",
    bell: "M12 3a5 5 0 00-5 5v4l-2 3h14l-2-3V8a5 5 0 00-5-5zm-2 15a2 2 0 004 0",
    people: "M9 11a3 3 0 100-6 3 3 0 000 6zm7 8v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1m14-9a3 3 0 100-6m5 15v-1a4 4 0 00-3-3.8",
    consign: "M4 4h7v16H4V4zm9 0h7v16h-7V4zM7 8h1m8 0h1",
    truck: "M3 6h10v9H3V6zm10 3h4l3 3v3h-7V9zM7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm10 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
    chart: "M4 20V10m5 10V4m5 16v-7m5 7V8",
    send: "M4 4l16 8-16 8 3-8-3-8z",
    gear: "M12 15a3 3 0 100-6 3 3 0 000 6zm8-3l2-1-2-4-2 .6a8 8 0 00-2-1.2L15.5 4h-4L11 6.4a8 8 0 00-2 1.2L7 7l-2 4 2 1a8 8 0 000 2l-2 1 2 4 2-.6a8 8 0 002 1.2l.5 2.4h4l.5-2.4a8 8 0 002-1.2l2 .6 2-4-2-1a8 8 0 000-2z",
    cash: "M2 7h20v10H2V7zm10 5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM5 10v.01M19 14v.01",
    card: "M2 6h20v12H2V6zm0 4h20M6 15h4",
    clock: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-14v5l3 2",
    stale: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-14v5l3 2M3 3l18 18",
    tag: "M20 12l-8 8-9-9V3h8l9 9zM7.5 7.5h.01",
    /* المخزون: صناديق على رفّين — لا مربع زخرفي */
    boxes: "M3 4h7v7H3V4zm11 0h7v7h-7V4zM3 13h7v7H3v-7zm11 0h7v7h-7v-7z",
    /* الإشعارات: جرس بموجتَي إرسال */
    signal: "M12 4a4 4 0 00-4 4v3l-1.5 2.5h11L16 11V8a4 4 0 00-4-4zm-1.5 13a1.5 1.5 0 003 0M4.2 5.2a9 9 0 000 12.6M19.8 5.2a9 9 0 010 12.6",
    /* الجرد: لوح عدّ لا سلة مهملات */
    clipboard: "M9 3h6v3H9V3zM7 5H5v16h14V5h-2M9 11h6M9 15h6",
    check: "M4 12.5l5.5 5.5L20 7",
    search: "M11 4a7 7 0 100 14 7 7 0 000-14zm9 16l-4-4",
    inbox: "M3 13h5l1.5 3h5L16 13h5M3 13l3-8h12l3 8v6H3v-6z",
    box: "M3 7l9-4 9 4v10l-9 4-9-4V7zm0 0l9 4 9-4M12 11v10",
    books: "M4 5h4v15H4V5zm6 0h4v15h-4V5zm7.5.6l3.4 1-3.6 14.3-3.4-1L17.5 5.6z",
    home: "M4 11l8-7 8 7v9H4v-9zm6 9v-6h4v6",
    inward: "M12 4v10m0 0l-4-4m4 4l4-4M5 20h14",
    outward: "M12 20V10m0 0l-4 4m4-4l4 4M5 4h14",
    empty: "M5 5h14v14H5V5z"
  };

  function icon(name, size) {
    var d = ICONS[name];
    if (!d) return "";
    var sz = size || 18;
    return '<svg class="ic" width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* تطبيع الأرقام قبل قراءتها.
     "١٥" كانت تصير 0 و "1,5" كانت تصير 15 — والاثنتان تصلان من استيراد
     ملفات Excel العربية ومن اللصق، حيث لا يفلتر المتصفح شيئاً. */
  function digits(s) {
    return String(s)
      .replace(/[٠-٩]/g, function (d) {              // ٠١٢٣٤٥٦٧٨٩
        return String.fromCharCode(d.charCodeAt(0) - 0x0630);
      })
      .replace(/[۰-۹]/g, function (d) {              // ۰۱۲۳۴۵۶۷۸۹
        return String.fromCharCode(d.charCodeAt(0) - 0x06C0);
      })
      .replace(/٫/g, ".")                                  // الفاصلة العشرية العربية ٫
      .replace(/[٬  ]/g, "");                    // فاصل الآلاف العربي والمسافات غير المرئية
  }

  function num(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var s = digits(v)
      .replace(/,(?=\d{1,2}(?:\D|$))/, ".")   // 1,5 → 1.5  (فاصلة عشرية)
      .replace(/,/g, "")                      // 1,500 → 1500 (فاصل آلاف)
      .replace(/[^\d.\-]/g, "");
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  /* هل النص يحمل رقماً فعلاً؟ نميّز بين خانة فارغة وخانة لم نفهمها،
     حتى ينبّه الاستيراد على الصفوف التي لم تُقرأ بدل ابتلاعها. */
  function hasNumber(v) {
    return /\d/.test(digits(v == null ? "" : v));
  }

  function money(v) {
    return num(v).toFixed(2) + " " + (S && S.meta ? S.meta.currency : "د.ل");
  }

  function money0(v) {
    return num(v).toFixed(2);
  }

  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/ؤ/g, "و").replace(/ئ/g, "ي")
      .replace(/\s+/g, " ").trim();
  }

  function today() {
    var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function nowStamp() {
    var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; };
    return today() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function dateAr(iso) {
    if (!iso) return "";
    var d = new Date(String(iso).slice(0, 10) + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    try {
      return d.toLocaleDateString("ar-LY-u-nu-latn", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) { return iso; }
  }

  function log(action, detail) {
    S.log.unshift({ id: uid(), at: nowStamp(), action: action, detail: detail || "" });
    if (S.log.length > 3000) S.log.length = 3000;
  }

  /* ---------- الأصناف ---------- */

  function listOf(type) { return type === "book" ? S.books : S.stationery; }

  function itemName(it) { return it ? (it.title || it.name || "") : ""; }

  function findItem(type, id) {
    var a = listOf(type);
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }

  function allItems() {
    var out = [];
    S.books.forEach(function (b) { out.push({ it: b, type: "book" }); });
    S.stationery.forEach(function (p) { out.push({ it: p, type: "stat" }); });
    return out;
  }

  /* سعر البيع حسب نوع المعاملة: قطاعي أو جملة */
  function sellPrice(it, mode) {
    if (mode === "wholesale" && num(it.priceW) > 0) return num(it.priceW);
    return num(it.price);
  }

  function stockState(it) {
    var q = num(it.qty), m = num(it.min);
    if (q <= 0) return "out";
    if (m > 0 && q <= m) return "low";
    return "ok";
  }

  function stockBadge(it) {
    var st = stockState(it);
    if (st === "out") return '<span class="badge bad">نفدت</span>';
    if (st === "low") return '<span class="badge warn">قاربت على النفاد</span>';
    return '<span class="badge ok">متوفرة</span>';
  }

  function lowCount() {
    var n = 0;
    allItems().forEach(function (x) { if (stockState(x.it) !== "ok") n++; });
    return n;
  }

  function nextCode(type) {
    if (type === "book") { S.counters.book++; return "K" + String(S.counters.book).padStart(4, "0"); }
    S.counters.stat++; return "Q" + String(S.counters.stat).padStart(4, "0");
  }

  function locPin() { return '<span class="bc-pin">◉</span>'; }

  function locChip(it) {
    if (!it.lib && !it.shelf) return '<span class="loc none"><span class="lib">?</span><span class="shelf">بلا موقع</span></span>';
    return '<span class="loc"><span class="lib">' + esc(it.lib || "?") + '</span>' +
      '<span class="shelf">رف ' + esc(it.shelf || "?") + '</span></span>';
  }

  /* ---------- التنبيهات المنبثقة ---------- */

  function toast(msg, kind) {
    var host = document.getElementById("toasts");
    var t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () {
      t.style.transition = "opacity .25s"; t.style.opacity = "0";
      setTimeout(function () { t.remove(); }, 260);
    }, kind === "bad" ? 5200 : 2800);
  }

  /* ---------- النوافذ ---------- */

  var modalStack = [];

  function modal(opts) {
    var host = document.getElementById("modalHost");
    var ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML =
      '<div class="modal ' + (opts.size || "") + '">' +
      '<div class="m-head"><h3>' + esc(opts.title || "") + '</h3><div class="spacer"></div>' +
      '<button class="btn ghost sm" data-x>✕</button></div>' +
      '<div class="m-body"></div>' +
      (opts.foot === false ? "" : '<div class="m-foot"></div>') +
      '</div>';
    var body = ov.querySelector(".m-body");
    if (typeof opts.body === "string") body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);

    var foot = ov.querySelector(".m-foot");
    if (foot && opts.actions) {
      opts.actions.forEach(function (a) {
        var b = document.createElement("button");
        b.className = "btn " + (a.kind || "");
        b.textContent = a.label;
        b.onclick = function () { a.click(close, ov); };
        foot.appendChild(b);
      });
      var sp = document.createElement("div"); sp.className = "spacer"; foot.appendChild(sp);
      var cx = document.createElement("button");
      cx.className = "btn ghost"; cx.textContent = opts.cancelLabel || "إغلاق";
      cx.onclick = function () { close(); };
      foot.appendChild(cx);
    }

    function close() {
      ov.remove();
      modalStack = modalStack.filter(function (x) { return x !== ov; });
      if (opts.onClose) opts.onClose();
    }
    ov.querySelector("[data-x]").onclick = close;
    ov.onclick = function (e) { if (e.target === ov) close(); };

    host.appendChild(ov);
    modalStack.push(ov);
    var first = ov.querySelector(".m-body input,.m-body select,.m-body textarea") || ov.querySelector("button.primary");
    if (first) setTimeout(function () { first.focus(); }, 60);
    return { el: ov, close: close, body: body };
  }

  function confirm(msg, onYes, opts) {
    opts = opts || {};
    modal({
      title: opts.title || "تأكيد",
      size: "narrow",
      body: '<p style="margin:0;line-height:1.7">' + esc(msg) + "</p>",
      actions: [{
        label: opts.yes || "تأكيد",
        kind: opts.danger ? "danger" : "primary",
        click: function (close) { close(); onYes(); }
      }],
      cancelLabel: "إلغاء"
    });
  }

  /* ---------- بناء النماذج ---------- */

  /* يقرأ قيم النموذج الحالية — يستعمله خطاف التغيير */
  function readForm(fields, scope) {
    var out = {};
    fields.forEach(function (fl) {
      var e = scope.querySelector("#f_" + fl.k);
      if (!e) return;
      out[fl.k] = (fl.type === "number" || fl.type === "money") ? num(e.value) : e.value;
    });
    return out;
  }

  function setField(scope, key, value) {
    var e = scope.querySelector("#f_" + key);
    if (e) e.value = value;
  }

  function form(opts) {
    var vals = {};
    var f = opts.fields;
    var host = document.createElement("div");
    if (opts.topHtml) {
      var top = document.createElement("div");
      top.innerHTML = opts.topHtml;
      host.appendChild(top);
    }
    var wrap = document.createElement("div");
    wrap.className = "form-grid";
    host.appendChild(wrap);

    f.forEach(function (fl) {
      var d = document.createElement("div");
      d.className = "field" + (fl.full ? " full" : "");
      var id = "f_" + fl.k;
      var v = (opts.values && opts.values[fl.k] !== undefined && opts.values[fl.k] !== null)
        ? opts.values[fl.k] : (fl.def !== undefined ? fl.def : "");

      var ctrl;
      if (fl.type === "select") {
        ctrl = document.createElement("select");
        (fl.options || []).forEach(function (o) {
          var op = document.createElement("option");
          op.value = (typeof o === "object") ? o.v : o;
          op.textContent = (typeof o === "object") ? o.t : o;
          if (String(op.value) === String(v)) op.selected = true;
          ctrl.appendChild(op);
        });
      } else if (fl.type === "textarea") {
        ctrl = document.createElement("textarea");
        ctrl.value = v;
      } else {
        ctrl = document.createElement("input");
        /* خانات المال والكميات نصّية بلوحة أرقام، لا type=number:
           حقل number يرفض الأرقام العربية بصمت فتبقى الخانة فارغة.
           هنا نقبلها ونحوّلها أمام المستخدم. */
        if (fl.type === "number" || fl.type === "money") {
          ctrl.type = "text";
          ctrl.setAttribute("inputmode", "decimal");
          ctrl.setAttribute("data-numeric", fl.type);
          if (fl.min !== undefined) ctrl.setAttribute("data-min", fl.min);
          ctrl.addEventListener("input", function () {
            var norm = digits(ctrl.value).replace(/[^\d.,\-]/g, "");
            if (norm !== ctrl.value) {
              var at = ctrl.selectionStart;
              ctrl.value = norm;
              try { ctrl.setSelectionRange(at, at); } catch (e) { }
            }
          });
          ctrl.addEventListener("blur", function () {
            if (!ctrl.value.trim()) return;
            var n = num(ctrl.value);
            if (fl.min !== undefined && n < num(fl.min)) n = num(fl.min);
            ctrl.value = String(n);
          });
        } else {
          ctrl.type = fl.type || "text";
        }
        if (fl.type === "money") ctrl.step = "0.01";
        if (fl.step) ctrl.step = fl.step;
        if (fl.min !== undefined && ctrl.type !== "text") ctrl.min = fl.min;
        ctrl.value = v;
        if (fl.list) {
          var dl = document.createElement("datalist");
          dl.id = id + "_dl";
          (fl.list || []).forEach(function (o) {
            var op = document.createElement("option"); op.value = o; dl.appendChild(op);
          });
          d.appendChild(dl);
          ctrl.setAttribute("list", dl.id);
        }
      }
      ctrl.className = "inp";
      ctrl.id = id;
      if (fl.placeholder) ctrl.placeholder = fl.placeholder;
      if (opts.onChange) {
        var ev = (fl.type === "select") ? "change" : "input";
        ctrl.addEventListener(ev, function () {
          try { opts.onChange(fl.k, ctrl.value, wrap, readForm(f, wrap)); }
          catch (e) { }
        });
      }

      var lb = document.createElement("label");
      lb.htmlFor = id;
      lb.innerHTML = esc(fl.label) + (fl.required ? ' <span style="color:var(--stamp)">*</span>' : "");
      d.appendChild(lb);
      d.appendChild(ctrl);
      if (fl.hint) {
        var h = document.createElement("div"); h.className = "hint"; h.textContent = fl.hint; d.appendChild(h);
      }
      wrap.appendChild(d);
    });

    var m = modal({
      title: opts.title,
      size: opts.size,
      body: host,
      cancelLabel: "إلغاء",
      actions: [{
        label: opts.saveLabel || "حفظ",
        kind: "primary",
        click: function (close, ov) {
          var missing = null;
          var scope = ov || document;
          f.forEach(function (fl) {
            var e = scope.querySelector("#f_" + fl.k) || document.getElementById("f_" + fl.k);
            var val = e.value;
            if (fl.type === "number" || fl.type === "money") val = num(val);
            else val = String(val).trim();
            if (fl.required && (val === "" || val === null)) missing = missing || fl.label;
            vals[fl.k] = val;
          });
          if (missing) { toast("الحقل مطلوب: " + missing, "warn"); return; }
          if (opts.onSave(vals) !== false) close();
        }
      }]
    });
    return m;
  }

  /* ---------- جدول ---------- */

  function table(cols, rows, opts) {
    opts = opts || {};
    if (!rows.length) {
      /* اسم من مجموعة الأيقونات يُرسم شكلاً متجهاً؛ وأي شيء آخر يُطبع
         كما هو، فلا ينكسر نداء قديم. */
      var ei = opts.emptyIcon || "empty";
      var big = ICONS[ei]
        ? '<div class="big">' + icon(ei, 44) + "</div>"
        : '<div class="big">' + ei + "</div>";
      return '<div class="empty">' + big +
        "<h4>" + esc(opts.emptyTitle || "لا توجد بيانات بعد") + "</h4>" +
        "<p>" + esc(opts.emptyText || "") + "</p>" +
        (opts.emptyAction || "") + "</div>";
    }
    /* حدّ للصفوف المرسومة: بلا هذا كانت صفحة الفواتير ترسم كل فاتورة
       في التاريخ — 21,900 صفاً و481 ألف عنصر جمّدت النافذة دقيقتين. */
    var shown = rows, hidden = 0;
    if (opts.limit && rows.length > opts.limit) {
      shown = rows.slice(0, opts.limit);
      hidden = rows.length - opts.limit;
    }

    var h = '<div class="table-wrap"><table class="tbl"><thead><tr>';
    cols.forEach(function (c) { h += "<th>" + esc(c.h) + "</th>"; });
    h += "</tr></thead><tbody>";
    shown.forEach(function (r, i) {
      var cls = opts.rowClass ? opts.rowClass(r) : "";
      h += '<tr class="' + cls + '">';
      cols.forEach(function (c) {
        h += '<td class="' + (c.cls || "") + '">' + c.c(r, i) + "</td>";
      });
      h += "</tr>";
    });
    h += "</tbody></table></div>";
    if (hidden > 0) {
      h += '<div class="row" style="padding:14px 16px;align-items:center;gap:12px">' +
        '<span class="muted small">معروض ' + shown.length + " من " + rows.length + " — " +
        hidden + ' غير معروضة</span><div class="spacer"></div>' +
        (opts.moreAction ? '<button class="btn" onclick="' + opts.moreAction + '">عرض المزيد</button>' : "") +
        "</div>";
    }
    return h;
  }

  /* ---------- ملفات ---------- */

  function download(name, content, mime) {
    var blob = new Blob(["\ufeff" + content], { type: (mime || "text/csv") + ";charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* جدول Excel حقيقي — يفتح بأعمدة منسّقة وعربية سليمة بلا إعدادات */
  function xls(filename, title, cols, rows, meta2) {
    var h = '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">' +
      "<style>" +
      "body{font-family:Calibri,Arial,sans-serif;direction:rtl}" +
      "h2{color:#17222E;margin:0 0 4px}" +
      "p.sub{color:#6B7A87;margin:0 0 12px;font-size:12px}" +
      "table{border-collapse:collapse}" +
      "th{background:#0E6E62;color:#fff;font-weight:bold;padding:8px 10px;border:1px solid #0B564C;text-align:right;white-space:nowrap}" +
      "td{padding:6px 10px;border:1px solid #C9D3DA;text-align:right;mso-number-format:'\\@'}" +
      "td.n{mso-number-format:'0\\.00';text-align:left}" +
      "td.i{mso-number-format:'0';text-align:left}" +
      "tr.alt td{background:#F3F7F6}" +
      "tr.tot td{background:#E4F1EE;font-weight:bold;border-top:2px solid #0E6E62}" +
      "</style></head><body>" +
      "<h2>" + esc(title) + "</h2>" +
      '<p class="sub">' + esc(meta2 || "") + " — " + esc(dateAr(today())) + "</p>" +
      "<table><thead><tr>";
    cols.forEach(function (c) { h += "<th>" + esc(c.h) + "</th>"; });
    h += "</tr></thead><tbody>";

    rows.forEach(function (r, i) {
      h += '<tr class="' + (i % 2 ? "alt" : "") + '">';
      cols.forEach(function (c) {
        var v = c.c(r);
        var cls = c.t === "n" ? "n" : (c.t === "i" ? "i" : "");
        h += '<td class="' + cls + '">' + (v === null || v === undefined ? "" : esc(v)) + "</td>";
      });
      h += "</tr>";
    });

    // سطر الإجماليات للأعمدة الرقمية
    var hasTot = false;
    cols.forEach(function (c) { if (c.sum) hasTot = true; });
    if (hasTot && rows.length) {
      h += '<tr class="tot">';
      cols.forEach(function (c, ci) {
        if (ci === 0) { h += "<td>الإجمالي</td>"; return; }
        if (!c.sum) { h += "<td></td>"; return; }
        var t = 0;
        rows.forEach(function (r) { t += num(c.c(r)); });
        h += '<td class="' + (c.t === "i" ? "i" : "n") + '">' + (c.t === "i" ? t : t.toFixed(2)) + "</td>";
      });
      h += "</tr>";
    }

    h += "</tbody></table></body></html>";
    download(filename + ".xls", h, "application/vnd.ms-excel");
  }

  function csvCell(v) {
    var s = String(v === null || v === undefined ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
  }

  function parseCsv(text) {
    text = text.replace(/^\ufeff/, "");
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ",") { row.push(cur); cur = ""; }
        else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else if (ch !== "\r") cur += ch;
      }
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.join("").trim() !== ""; });
  }

  function pickFile(accept, cb) {
    var i = document.createElement("input");
    i.type = "file"; i.accept = accept;
    i.onchange = function () {
      if (!i.files.length) return;
      var fr = new FileReader();
      fr.onload = function () { cb(fr.result, i.files[0].name); };
      fr.readAsText(i.files[0], "utf-8");
    };
    i.click();
  }

  /* طباعة صورة — الطابعات الحرارية تطبعها رسماً فلا تفسد العربية */
  function printImage(dataUrl, widthMm) {
    var area = document.getElementById("printArea");
    area.innerHTML = "";
    var img = document.createElement("img");
    img.style.width = (widthMm || 72) + "mm";
    img.style.display = "block";
    img.style.margin = "0 auto";
    img.onload = function () { setTimeout(function () { window.print(); }, 120); };
    img.onerror = function () { toast("تعذّر تجهيز الإيصال للطباعة.", "bad"); };
    img.src = dataUrl;
    area.appendChild(img);
  }

  function printHtml(html) {
    document.getElementById("printArea").innerHTML = html;
    setTimeout(function () { window.print(); }, 120);
  }

  /* ---------- التنقل ---------- */

  var PAGES = [
    { g: "البيع" },
    { k: "dash", t: "لوحة اليوم", ic: "dash", f: function () { return Rep.dashboard(); } },
    { k: "pos", t: "نقطة البيع", ic: "pos", f: function () { return Sales.pos(); } },
    { k: "invoices", t: "الفواتير", ic: "invoice", f: function () { return Sales.invoices(); } },
    { k: "stocktake", t: "الجرد", ic: "stocktake", f: function () { return Rep.stockHub(); } },
    { g: "المخزون" },
    { k: "stock", t: "المخزون والفروع", ic: "boxes", f: function () { return Stock.page(); }, badge2: true },
    { k: "purchases", t: "إدخال بضاعة", ic: "goods", f: function () { return Inv.goods(); } },
    { k: "alerts", t: "التنبيهات", ic: "bell", f: function () { return Inv.alerts(); }, badge: true },
    { k: "stale", t: "البضاعة الراكدة", ic: "stale", f: function () { return Stale.page(); }, badge4: true },
    { k: "labels", t: "طباعة اللاصقات", ic: "tag", f: function () { return Labels.page(); }, badge5: true },
    { g: "الحسابات" },
    { k: "customers", t: "الزبائن والديون", ic: "people", f: function () { return People.customers(); } },
    { k: "consign", t: "كتب على المباع", ic: "consign", f: function () { return Consign.page(); }, badge3: true },
    { k: "suppliers", t: "الموردون ودور النشر", ic: "truck", f: function () { return People.suppliers(); } },
    { g: "أخرى" },
    { k: "profits", t: "الأرباح والتقارير", ic: "chart", f: function () { return Rep.profits(); } },
    { k: "notify", t: "الإشعارات", ic: "signal", f: function () { return Notify.page(); } },
    { k: "settings", t: "الإعدادات", ic: "gear", f: function () { return Rep.settings(); } }
  ];

  function buildNav() {
    var nav = document.getElementById("nav");
    var h = "";
    PAGES.forEach(function (p) {
      if (p.g) { h += '<div class="group-label">' + esc(p.g) + "</div>"; return; }
      h += '<button class="nav-item" data-k="' + p.k + '" onclick="location.hash=\'#/' + p.k + '\'">' +
        icon(p.ic, 19) + "<span>" + esc(p.t) + "</span>" +
        (p.badge ? '<span class="count" data-lowcount hidden></span>' : "") +
        (p.badge2 ? '<span class="count" data-reqcount hidden></span>' : "") +
        (p.badge3 ? '<span class="count" data-conscount hidden></span>' : "") +
        (p.badge4 ? '<span class="count" data-stalecount hidden></span>' : "") +
        (p.badge5 ? '<span class="count bad" data-lblcount hidden></span>' : "") +
        "</button>";
    });
    nav.innerHTML = h;
  }

  function branchLabel() {
    var b = S.branch;
    var city = hasBadChars(b.city) ? "" : (b.city || "");
    if (num(b.no) > 0) return "منظومة رقم " + num(b.no) + (city ? " (" + city + ")" : "");
    if (b.label && !hasBadChars(b.label)) return b.label;
    return city ? "فرع " + city : "";
  }

  /* شارة كبيرة تميّز المنظومة عن الأخرى — تظهر في كل الصفحات */
  function paintBranchTag() {
    var host = document.getElementById("branchTag");
    if (!host) return;
    var lbl = branchLabel();
    if (!lbl) { host.innerHTML = ""; host.className = "branch-tag"; document.body.classList.remove("br-two"); return; }
    var which = (num(S.branch.no) === 2 || /tripoli/i.test(S.branch.id)) ? "two" : "one";
    host.className = "branch-tag " + which;
    host.textContent = lbl;
    document.body.classList.toggle("br-two", which === "two");
  }

  var THEMES = [
    { k: "green", t: "أخضر", c: "#0E6E62" },
    { k: "blue", t: "أزرق", c: "#1D5F8A" },
    { k: "violet", t: "بنفسجي", c: "#6B4593" },
    { k: "wine", t: "نبيذي", c: "#8C2F39" },
    { k: "amber", t: "برتقالي", c: "#B26B10" },
    { k: "teal", t: "فيروزي", c: "#0F6B75" },
    { k: "slate", t: "رمادي", c: "#3D4A57" }
  ];

  function applyTheme() {
    var th = (S && S.meta && S.meta.theme) ? S.meta.theme : "green";
    var b = document.body;
    THEMES.forEach(function (t2) { b.classList.remove("th-" + t2.k); });
    b.classList.add("th-" + th);
  }

  function applyUiSize() {
    var sz = (S && S.meta && S.meta.uiSize) ? S.meta.uiSize : "lg";
    var b = document.body;
    b.classList.remove("ui-xs", "ui-sm", "ui-md", "ui-lg", "ui-xl");
    b.classList.add("ui-" + sz);
  }

  /* ختم النسخة في أسفل الشريط: الإصدار وتاريخ البناء.
     كانت كل النسخ تقول «v2.0» فلا يُعرف أي ملف يعمل. */
  function paintVersion() {
    var e = document.getElementById("ver");
    if (!e) return;
    apiJson("/api/info").then(function (d) {
      if (!d || !d.ok) return;
      var v = "v" + (d.version || "?");
      e.textContent = d.build ? (v + " · " + d.build) : v;
      e.title = "الإصدار " + (d.version || "?") +
        (d.build ? "\nتاريخ البناء: " + d.build : "") +
        "\nمجلد البيانات: " + (d.dataDir || "");
    }).catch(function () { });
  }

  function refreshBadges() {
    var n = lowCount();
    document.querySelectorAll("[data-lowcount]").forEach(function (e) {
      if (n > 0) { e.hidden = false; e.textContent = n; } else e.hidden = true;
    });
    document.getElementById("brandName").textContent = S.meta.shopName || "المكتبة والقرطاسية";
    var sub = document.querySelector(".brand .sub");
    if (sub) sub.textContent = branchLabel() || "نظام بيع ومخزون — يعمل بدون إنترنت";
    paintBranchTag();
    try {
      var bl = branchLabel();
      document.title = (bl ? bl + " — " : "") + "منظومة المكتبة والقرطاسية";
    } catch (e) { }
    var consN = (typeof Consign !== "undefined") ? Consign.activeCount() : 0;
    document.querySelectorAll("[data-conscount]").forEach(function (e) {
      if (consN > 0) { e.hidden = false; e.textContent = consN; } else e.hidden = true;
    });
    var pend = (typeof Stock !== "undefined") ? Stock.pendingCount() : 0;
    document.querySelectorAll("[data-reqcount]").forEach(function (e) {
      if (pend > 0) { e.hidden = false; e.textContent = pend; } else e.hidden = true;
    });
    var staleN = 0;
    try { staleN = (typeof Stale !== "undefined") ? Stale.count() : 0; } catch (e) { }
    document.querySelectorAll("[data-stalecount]").forEach(function (e) {
      if (staleN > 0) { e.hidden = false; e.textContent = staleN; } else e.hidden = true;
    });
    var lblN = 0;
    try { lblN = (typeof Labels !== "undefined") ? Labels.pendingCount() : 0; } catch (e) { }
    document.querySelectorAll("[data-lblcount]").forEach(function (e) {
      if (lblN > 0) { e.hidden = false; e.textContent = lblN; } else e.hidden = true;
    });
  }

  /* رمز الأرباح: كان مخزّناً بالنص الصريح في store.json ويُقدَّم على
     /api/load — أي موظف يفتحه في تبويب يقرأه. صار مجزّأً في النواة،
     والواجهة لا تعرفه إطلاقاً. */
  var profitOK = false;
  function canProfit() { return profitOK; }
  function unlockProfit(code) {
    return apiJson("/api/profit-unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: String(code).trim() })
    }).then(function (res) {
      profitOK = !!(res && res.ok);
      return profitOK;
    }).catch(function () { return false; });
  }
  function setProfitCode(code) {
    return apiJson("/api/profit-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: String(code).trim() })
    }).catch(function () { return { ok: false }; });
  }
  function lockProfit() { profitOK = false; }

  var current = "";

  function route() {
    if (!lic.active) { licScreen(); return; }
    var k = (location.hash || "#/dash").replace("#/", "").split("?")[0];
    var page = null;
    PAGES.forEach(function (p) { if (p.k === k) page = p; });
    if (!page) { location.hash = "#/dash"; return; }
    current = k;

    document.querySelectorAll(".nav-item").forEach(function (b) {
      b.classList.toggle("on", b.dataset.k === k);
    });
    document.getElementById("pageTitle").textContent = page.t;
    paintBranchTag();
    applyUiSize();
    applyTheme();

    var view = document.getElementById("view");
    view.classList.toggle("flush", k === "pos");
    view.scrollTop = 0;
    view.innerHTML = page.f() || "";
    if (page.after) page.after();
    if (k === "pos" && Sales.afterRender) Sales.afterRender();
    if (k === "stock" && typeof Stock !== "undefined" && Stock.afterRender) Stock.afterRender();
    refreshBadges();
  }

  function rerender() { route(); paintBlockBar(); }

  /* ---------- حقل بحث يفهم قارئ الباركود ----------
     القارئ يكتب الرمز دفعة سريعة ثم Enter. بلا هذا يبقى الرمز السابق
     في الحقل فيلتصق به الجديد ولا يطابق شيئاً. هنا: بعد Enter — أو بعد
     سكون يعقبه إدخال جديد — يُمسح القديم وحده. */
  function scanField(el, onEnter) {
    if (!el || el.__scan) return;
    el.__scan = true;
    var lastAt = 0, done = false;

    el.addEventListener("keydown", function (e) {
      var now = Date.now();
      var typing = e.key && e.key.length === 1;

      if (typing && el.value) {
        // إدخال مكتمل سابقاً، أو بداية دفعة جديدة بعد سكون
        if (done || now - lastAt > 700) { el.value = ""; done = false; }
      }
      if (typing) lastAt = now;

      if (e.key === "Enter") {
        e.preventDefault();
        done = true;
        if (onEnter) onEnter(el.value.trim(), el);
      }
    });
    el.addEventListener("focus", function () { try { el.select(); } catch (x) { } });
  }

  /* ---------- الساعة ---------- */

  function tickClock() {
    var d = new Date();
    var p = function (x) { return (x < 10 ? "0" : "") + x; };
    var el = document.getElementById("clock");
    if (el) el.textContent = dateAr(today()) + " — " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* ---------- الإقلاع ---------- */

  var CITY_AR = { misrata: "مصراتة", tripoli: "طرابلس", benghazi: "بنغازي", zawiya: "الزاوية", sabha: "سبها" };

  /* النص الذي أفسده ترميز المثبّت يظهر كعلامات استفهام — نصلحه تلقائياً */
  function hasBadChars(v) {
    return /\?\?/.test(String(v || ""));
  }

  function repairBranch(s2) {
    if (!s2 || !s2.branch) return;
    var b = s2.branch;
    if (hasBadChars(b.label)) b.label = "";
    if (hasBadChars(b.city)) b.city = CITY_AR[b.id] || "";
    if (hasBadChars(b.name)) b.name = "";
    if (!b.no) {
      if (b.id === "misrata") b.no = 1;
      else if (b.id === "tripoli") b.no = 2;
    }
  }

  /* فحص الترخيص مستقل تماماً — يجري في كل تشغيل مهما كانت حالة الإعداد */
  function checkLicense() {
    return api("/api/license")
      .then(function (r) { return r.json(); })
      .then(function (l) {
        // لا نقفل إلا عند رفض صريح — أي خلل في الرد يبقي البرنامج يعمل
        if (l && l.ok === true && l.active === false) {
          lic.active = false;
          lic.fp = l.fp || "";
          lic.until = l.until || "";
        } else lic.active = true;
      })
      .catch(function () { lic.active = true; });   // نواة قديمة بلا ترخيص: لا نمنع العمل
  }

  function applyPreset() {
    if (S.branch && S.branch.id) return Promise.resolve();
    return api("/api/preset").then(function (r) { return r.json(); }).then(function (p) {
      if (!p || !p.ok || !p.branchId) return;
      S.branch.id = p.branchId;
      if (p.branchName && !S.branch.name) S.branch.name = p.branchName;
      if (p.city && !S.branch.city && !hasBadChars(p.city)) S.branch.city = p.city;
      if (p.no && !S.branch.no) S.branch.no = num(p.no);
      if (!S.branch.city && CITY_AR[S.branch.id]) S.branch.city = CITY_AR[S.branch.id];
      repairBranch(S);   // يستنتج الرقم من رمز الفرع إن لم يصل
      save();
    }).catch(function () { });
  }

  var lic = { active: true, fp: "", until: "" };

  function licScreen() {
    document.getElementById("view").innerHTML =
      '<div class="lic-wrap"><div class="card"><div class="card-body" style="padding:34px">' +
      '<h2 style="font-family:var(--font-head);margin:0 0 6px;font-size:26px;text-align:center">تفعيل المنظومة</h2>' +
      '<p class="muted" style="text-align:center;margin:0 0 18px;line-height:1.8">' +
      "هذه النسخة غير مفعّلة على هذا الجهاز.<br>أرسل الرمز التالي لمن باعك المنظومة ليعطيك رمز التفعيل.</p>" +
      '<label style="font-size:13px;color:var(--muted)">بصمة هذا الجهاز</label>' +
      '<div class="lic-fp" id="licFp">' + esc(lic.fp) + "</div>" +
      '<button class="btn" style="width:100%;margin-bottom:18px" onclick="App.copyFp()">نسخ البصمة</button>' +
      '<label style="font-size:13px;color:var(--muted)">رمز التفعيل</label>' +
      '<textarea class="inp" id="licCode" style="min-height:110px;font-family:var(--font-num);font-size:12px" ' +
      'placeholder="الصق رمز التفعيل هنا"></textarea>' +
      '<button class="btn primary lg" style="width:100%;margin-top:14px" onclick="App.activate()">تفعيل</button>' +
      (lic.until === "expired" ? '<p style="color:var(--stamp);text-align:center;margin-top:12px">انتهت صلاحية الترخيص السابق.</p>' : "") +
      "</div></div></div>";
  }

  function copyFp() {
    var el = document.getElementById("licFp");
    if (!el) return;
    try {
      var r = document.createRange();
      r.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      document.execCommand("copy");
      toast("نُسخت البصمة.");
    } catch (e) { toast("حدّدها بالفأرة وانسخها.", "warn"); }
  }

  function activate() {
    var el = document.getElementById("licCode");
    if (!el || !el.value.trim()) { toast("الصق رمز التفعيل.", "warn"); return; }
    api("/api/activate", { method: "POST", body: JSON.stringify({ code: el.value.trim() }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          lic.active = true;
          toast("فُعّلت المنظومة — " + (res.until === "دائم" ? "ترخيص دائم" : "حتى " + res.until));
          setTimeout(function () { location.reload(); }, 900);
        } else toast((res && res.error) || "تعذّر التفعيل", "bad");
      })
      .catch(function () { toast("تعذّر الاتصال بالنواة.", "bad"); });
  }

  /* شريط ثابت أعلى الصفحة عندما تكون النافذة للعرض فقط.
     الصمت هنا كان هو المشكلة: المستخدم يعمل ولا يُحفظ شيء. */
  function paintBlockBar() {
    var host = document.getElementById("blockBar");
    if (!host) {
      host = document.createElement("div");
      host.id = "blockBar";
      document.body.insertBefore(host, document.body.firstChild);
    }
    if (!readOnly) { host.className = ""; host.innerHTML = ""; return; }
    host.className = "block-bar";
    var isCorrupt = blockReason.indexOf("تالف") >= 0;
    host.innerHTML =
      '<b>' + esc(blockReason) + "</b>" +
      '<span>' + (isCorrupt
        ? "بياناتك على الأرجح سليمة في النسخ الاحتياطية — استعد آخر نسخة."
        : "أي تعديل هنا لن يُحفظ.") + "</span>" +
      '<div class="spacer"></div>' +
      (isCorrupt
        ? '<button class="btn primary" onclick="Rep.recoverScreen()">استعادة نسخة احتياطية</button>'
        : '<button class="btn primary" onclick="App.takeOver()">تحكّم من هذه النافذة</button>');
  }

  function boot() {
    load().then(function () {
      buildNav();
      paintVersion();
      window.addEventListener("hashchange", route);
      tickClock(); setInterval(tickClock, 20000);

      document.addEventListener("keydown", function (e) {
        if (e.key === "F2") { e.preventDefault(); location.hash = "#/pos"; }
        if (e.key === "Escape" && modalStack.length) {
          var top = modalStack[modalStack.length - 1];
          var x = top.querySelector("[data-x]"); if (x) x.click();
        }
      });

      // ملف تالف: لا نطلب الملكية ولا نكتب شيئاً
      var claimed = readOnly ? Promise.resolve(false) : claim(false);

      claimed.then(function (ok) {
        if (!ok && !readOnly) {
          block("المنظومة مفتوحة في نافذة أخرى. هذه النافذة للعرض فقط.");
        }
        paintBlockBar();

        // ترحيل رمز الأرباح من نسخة قديمة — مرة واحدة، ومن النافذة المالكة وحدها
        if (ok && pendingProfitCode) {
          var oldCode = pendingProfitCode; pendingProfitCode = "";
          setProfitCode(oldCode).then(function (res) {
            if (res && res.ok) { save(); log("ترحيل", "نُقل رمز الأرباح إلى التخزين المجزّأ"); }
            else pendingProfitCode = oldCode;   // نعيد المحاولة في الإقلاع القادم
          });
        }

        return checkLicense().then(applyPreset).then(function () {
          if (!lic.active) { route(); return; }
          if (!S.meta.setupDone && !readOnly) { route(); Rep.firstRun(); }
          else {
            route();
            if (readOnly) return;               // نافذة عرض: بلا مزامنة ولا إشعارات
            if (typeof Stock !== "undefined") Stock.startAuto();
            if (typeof Notify !== "undefined") {
              Notify.maybeDaily();
              setInterval(function () { Notify.maybeDaily(); }, 3600000);
            }
          }
        });
      });
    });
  }

  return {
    boot: boot, rerender: rerender, route: route,
    get S() { return S; },
    save: save, saveNow: saveNow,
    uid: uid, esc: esc, num: num, hasNumber: hasNumber, digits: digits,
    money: money, money0: money0, norm: norm,
    api: api, apiJson: apiJson,
    isReadOnly: isReadOnly, readOnlyReason: readOnlyReason, takeOver: takeOver,
    paintBlockBar: paintBlockBar, setProfitCode: setProfitCode, scanField: scanField,
    today: today, nowStamp: nowStamp, dateAr: dateAr, log: log,
    listOf: listOf, itemName: itemName, findItem: findItem, allItems: allItems,
    stockState: stockState, stockBadge: stockBadge, lowCount: lowCount, sellPrice: sellPrice,
    nextCode: nextCode, locChip: locChip, locPin: locPin,
    toast: toast, modal: modal, confirm: confirm, form: form, table: table, setField: setField,
    canProfit: canProfit, unlockProfit: unlockProfit, lockProfit: lockProfit,
    copyFp: copyFp, activate: activate, lic: lic, checkLicense: checkLicense,
    paintBranchTag: paintBranchTag, branchLabel: branchLabel, applyUiSize: applyUiSize,
    icon: icon, applyTheme: applyTheme, THEMES: THEMES,
    download: download, toCsv: toCsv, parseCsv: parseCsv, pickFile: pickFile, xls: xls,
    printHtml: printHtml, printImage: printImage, refreshBadges: refreshBadges
  };
})();
