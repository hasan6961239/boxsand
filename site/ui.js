/* ============================================================
   ui.js — شاشات تطبيق المكتبة (الإصدار 3.0)
   ------------------------------------------------------------
   أربعة تبويبات وزر المسح في الوسط:
     الرئيسية      قائمة: الجرد، الفواتير، الآجل، الديون، التنبيهات
     إضافة وتعديل  عرض وتعديل | إضافة كمية | صنف جديد — كتب | قرطاسية — قائمة | بطاقات | الرفوف
     البيع         السلة والدفع
     الإعدادات     الحساب، المظهر، البيع والمسح، التحديث، الإشعارات، الربط
   أعلى كل شاشة: متى كان آخر تحديث، وزر التحديث.
   تطبيق أندرويد ينادي: UI.onScan(رمز)، UI.back()، UI.go(شاشة)، UI.refresh(true)،
   وPhoneExt.bioDone(id, ok).
   بلا أي style سطري (سياسة أمان الموقع تمنعه): الأشكال كلها في app.css، وما يتغيّر
   عرضه (أشرطة الرفوف) يُضبط من هنا بعد الرسم.
   ============================================================ */
var UI = (function () {
  "use strict";
  var C = Core, esc = C.esc, num = C.num, money = C.money, fmtN = C.fmtN;
  function S() { return C.S; }
  var VERSION = "3.0";
  var v = {
    screen: "home", back: [], key: "", code: "", fresh: true,
    mode: "", q: "", filt: "", cat: "", shown: 40, place: null, mapLib: "",
    sq: "", lq: "", rq: "", dq: "",
    form: null, scanField: "", invTab: "", debtTab: "cust", alTab: "all", outTab: "all",
    setup: "", pick: "", err: "", progress: null, sf: null
  };
  var awayAt = 0, timer = null, lastLoc = 0, shell = "", scr = {};
  var ANDROID = !!window.AndroidApp;

  /* ---------- الأيقونات (أشكال متجهة) ---------- */
  var IC = {
    home: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9z",
    search: "M11 4a7 7 0 100 14 7 7 0 000-14zm9 16l-4.2-4.2",
    scan: "M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M8 9v6M11 9v6M14 9v6M17 9v6",
    pin: "M12 21s-6-5.6-6-11a6 6 0 1112 0c0 5.4-6 11-6 11zm0-8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
    bell: "M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zm4 4a2 2 0 004 0",
    cart: "M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z",
    box: "M3 7l9-4 9 4v10l-9 4-9-4V7zm0 0l9 4 9-4M12 11v10",
    alert: "M12 3l9 16H3l9-16zm0 6v4m0 3v.01",
    book: "M4 4h6a3 3 0 013 3v13a2.5 2.5 0 00-2.5-2.5H4V4zm16 0h-6a3 3 0 00-3 3v13a2.5 2.5 0 012.5-2.5H20V4z",
    back: "M9 5l7 7-7 7",
    edit: "M4 20h4L19 9a2.8 2.8 0 10-4-4L4 16v4z",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    x: "M6 6l12 12M18 6L6 18",
    check: "M5 12.5l4.5 4.5L19 7.5",
    clock: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-14v5l3 2",
    users: "M9 11a4 4 0 100-8 4 4 0 000 8zm-7 10a7 7 0 0114 0M17 11a3 3 0 100-6M22 21a6 6 0 00-5-5.9",
    print: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7v-7z",
    face: "M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M8 21H5a2 2 0 01-2-2v-3M16 21h3a2 2 0 002-2v-3M9 9v1M15 9v1M12 9v4h-1M9 16c1.6 1.3 4.4 1.3 6 0",
    finger: "M12 11v3a8 8 0 01-1.5 4.7M8 13v1a4 4 0 01-.8 2.4M16 12v2a12 12 0 01-.6 3.8M6.3 8A7 7 0 0119 12M4.5 12a7.5 7.5 0 01.6-3M12 7a4 4 0 014 4",
    refresh: "M20 12a8 8 0 11-2.3-5.7M20 4v5h-5",
    gear: "M12 15a3 3 0 100-6 3 3 0 000 6zm8.4-3l1.6-1-2-3.5-1.8.6a7 7 0 00-1.8-1L15.9 5h-4l-.5 2.1a7 7 0 00-1.8 1L7.8 7.5l-2 3.5 1.6 1a7 7 0 000 2l-1.6 1 2 3.5 1.8-.6a7 7 0 001.8 1l.5 2.1h4l.5-2.1a7 7 0 001.8-1l1.8.6 2-3.5-1.6-1a7 7 0 000-2z",
    out: "M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 8l-4 4 4 4M6 12h10",
    phone: "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z",
    link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
    lock: "M6 11h12v10H6V11zm2 0V8a4 4 0 118 0v3m-4 4v2",
    chev: "M15 6l-6 6 6 6",
    down: "M6 9l6 6 6-6",
    doc: "M6 3h9l4 4v14H6V3zm9 0v4h4M9 12h7M9 16h7",
    list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
    grid: "M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z",
    shelves: "M4 3v18M20 3v18M4 9h16M4 15h16M4 21h16M8 9V5M11 9V6M14 9V5M9 15v-3M13 15v-3.5M16 15v-3",
    moon: "M20 14.5A8 8 0 019.5 4 7 7 0 1020 14.5z",
    text: "M4 7V5h11v2M9.5 5v14M7.5 19h4M15 13v-1.5h6V13M18 11.5V19M16.8 19h2.4",
    send: "M4 12l16-8-6 16-3-7-7-1z",
    trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
    info: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-10v6m0-9v.01",
    wallet: "M3 7h15a3 3 0 013 3v7a3 3 0 01-3 3H3V7zm0 0V5a1 1 0 011-1h12M17 13.5h.01",
    truck: "M3 6h11v10H3V6zm11 4h4l3 3v3h-7v-6zM7 19a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z",
    key: "M14 10a4 4 0 11-3.9 5H8v2H6v2H3v-3l6.1-6.1A4 4 0 0114 10zm1.6 2.4v.01",
    sound: "M4 10v4h3l5 4V6l-5 4H4zm12-1a4 4 0 010 6M18.5 6.5a8 8 0 010 11",
    camera: "M4 8h3l2-3h6l2 3h3v11H4V8zm8 9a4 4 0 100-8 4 4 0 000 8z",
    battery: "M3 8h15v8H3V8zm15 3h3v2h-3M6 11v2M9 11v2",
    tag: "M3 12V4h8l10 10-8 8L3 12zm5-4.5v.01",
    spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18",
    filter: "M4 5h16l-6 8v6l-4-2v-4L4 5z",
    copy: "M9 9h10v10H9V9zM5 15H3V3h12v2",
    store: "M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6",
    stack: "M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5M3 16l9 5 9-5",
    user: "M12 12a4.5 4.5 0 100-9 4.5 4.5 0 000 9zm-8 9a8 8 0 0116 0",
    vibrate: "M9 4h6v16H9V4zM5 8v8M2 10v4M19 8v8M22 10v4"
  };
  function ic(n, cls) {
    return '<svg class="i' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (IC[n] || IC.box) + '"/></svg>';
  }
  function el(id) { return document.getElementById(id); }
  function toast(msg, kind) {
    var host = el("toasts"), t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.textContent = msg;
    host.appendChild(t);
    while (host.children.length > 3) host.removeChild(host.firstChild);
    setTimeout(function () { t.classList.add("out"); }, 3200);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3500);
  }
  function initial(n) { var s = String(n || "").replace(/^(ال)/, "").trim(); return s ? s.charAt(0) : "؟"; }
  function logo(cls) {
    var sh = C.shop();
    return sh.logo ? '<img class="' + cls + '" src="' + esc(sh.logo) + '" alt="">' : '<span class="' + cls + ' mk">' + esc(initial(sh.name)) + "</span>";
  }
  function emptyBox(icon, title, text, act) {
    return '<div class="empty"><div class="ei">' + ic(icon) + "</div><h3>" + esc(title) + "</h3><p>" + esc(text || "") + "</p>" + (act || "") + "</div>";
  }
  function fmtQ(n) { return n === 1 ? "نسخة" : n === 2 ? "نسختان" : n > 2 && n <= 10 ? n + " نسخ" : fmtN(n) + " نسخة"; }
  function fmtU(n, g) { return g && g.t !== "book" ? fmtN(n) + " " + (g.u || "قطعة") : fmtQ(n); }
  /* تاريخ أو وقت داخل جملة عربية: معزول، وإلا قلب المتصفح ترتيب أجزائه (09-11-2026) */
  function D(x) { return '<bdi class="num">' + esc(x) + "</bdi>"; }
  function moneyBig(x) { return (Math.round(num(x) * 100) / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function locTxt(g) {
    if (g.t !== "book") return g.loc || "";
    if (!g.lib && !g.shelf) return "";
    return (g.lib || "؟") + (g.shelf ? " · رف " + g.shelf : "");
  }
  function isX4() { var m = C.mine(); return !!(m && (m.shop || (m.staff && m.staff.staff))); }
  function catWord() { return isX4() ? "التخصص" : "التصنيف"; }
  /* منظومة الكمبيوتر تفهم تعديلات 3.0 (كل الحقول، إضافة كمية، صنف جديد)؟ 4.2 فما فوق */
  function full() { return C.proto() >= 3; }
  var OLD_PC = "حدّث منظومة الكمبيوتر إلى 4.2 لتعمل هذه الميزة من الهاتف.";

  /* ---------- الرسم ----------
     الهيكل (الشاشة + الشريط السفلي) يُبنى مرة ويبقى: الشريط لا يُعاد رسمه فتتحرّك علامة التبويب
     بسلاسة. وكل شاشة تدخل بحركة حين تتغيّر فقط (fresh)، لا مع كل ضغطة داخلها */
  var SCREENS = null;
  function gate() { return !C.configured() ? "setup" : !C.mine() ? "wait" : C.locked() ? "lock" : ""; }
  function render() {
    var app = el("app"), g = gate();
    if (g) {
      shell = g;
      closeSheet(true);
      if (g === "setup") { app.innerHTML = pSetup(); afterSetup(); }
      else if (g === "wait") app.innerHTML = pWaiting();
      else { app.innerHTML = pLock(); afterLock(); }
      return;
    }
    if (shell !== "main") {
      app.innerHTML = '<div id="view" class="view"></div>' + navHtml();
      shell = "main";
      v.fresh = true;
    }
    if (!SCREENS[v.screen]) v.screen = "home";
    var view = el("view");
    view.className = "view s-" + v.screen + (v.fresh ? " enter" : "");
    view.innerHTML = SCREENS[v.screen]();
    v.fresh = false;
    paintNav();
    after();
  }
  var TAB_OF = { count: "home", invoices: "home", credit: "home", debts: "home", alerts: "home", item: "items", edit: "items", outbox: "settings" };
  function tabNow() {
    var root = v.back.length ? v.back[0] : v.screen;
    return TAB_OF[root] || root;
  }
  function navHtml() {
    function tab(k, icon, t) { return '<button class="n" data-a="go" data-v="' + k + '" data-tab="' + k + '"><span class="nic">' + ic(icon) + "</span>" + t + "</button>"; }
    return '<nav class="nav" id="nav">' + tab("home", "home", "الرئيسية") + tab("items", "edit", "إضافة وتعديل") +
      '<button class="fab" data-a="fab" aria-label="امسح الباركود">' + ic("scan") + "</button>" +
      tab("sell", "cart", "البيع") + tab("settings", "gear", "الإعدادات") + "</nav>";
  }
  function paintNav() {
    var n = el("nav");
    if (!n) return;
    var now = tabNow(), cart = S().cart.reduce(function (a, l) { return a + l.q; }, 0);
    Array.prototype.forEach.call(n.querySelectorAll(".n"), function (b) {
      var k = b.getAttribute("data-tab");
      b.classList.toggle("on", k === now);
      if (k === "sell") b.setAttribute("data-badge", cart ? String(Math.min(cart, 99)) : "");
      if (k === "settings") b.setAttribute("data-badge", C.failed() ? "!" : "");
    });
  }
  var ALIAS = { dash: "home", stock: "items", room: "items", books: "items", book: "items", loc: "count", more: "settings", orders: "invoices" };
  var ROOT = { home: 1, items: 1, sell: 1, settings: 1 };
  function saveScroll() { scr[v.screen] = window.pageYOffset || 0; }
  /* تبويب، أو شاشة فرعية تُفتح من الرئيسية (إشعار أندرويد يفتح «التنبيهات» مثلاً) */
  function go(k) {
    k = ALIAS[k] || k;
    if (!SCREENS[k]) k = "home";
    saveScroll();
    v.back = ROOT[k] ? [] : [TAB_OF[k] || "home"];
    v.screen = k;
    v.fresh = true;
    if (k === "items") v.shown = 40;
    closeSheet(true);
    render();
    window.scrollTo(0, 0);
  }
  function open2(k) {
    if (v.screen === k) { render(); return; }
    saveScroll();
    v.back.push(v.screen);
    v.screen = k;
    v.fresh = true;
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- الشريط العلوي: العنوان، آخر تحديث، وزر التحديث ---------- */
  function syncText(st) {
    var p = st.pending ? " · " + fmtN(st.pending) + " تنتظر الإرسال" : "";
    if (st.busy) return "يحدّث الآن…";
    if (!st.at) return (st.online ? "لم يُحدَّث بعد" : "بلا إنترنت") + p;
    var ago = C.ago(st.at);
    if (!st.online) return "بلا إنترنت · آخر تحديث " + ago + p;
    if (st.err) return "تعذّر التحديث · آخر نسخة " + ago + p;
    return "آخر تحديث: " + ago + p;
  }
  function bar(title, opt) {
    opt = opt || {};
    var st = C.syncState();
    return '<header class="bar' + (opt.cls ? " " + opt.cls : "") + '"><div class="brow">' +
      (opt.back ? '<button class="bb" data-a="back" aria-label="رجوع">' + ic("back") + "</button>" : opt.logo ? logo("blogo") : "") +
      '<div class="bt"><b>' + esc(title) + '</b><small class="sl ' + st.level + '" id="syncLine"><i></i><span>' + esc(syncText(st)) + "</span></small></div>" +
      (opt.extra || "") +
      '<button class="bb rf' + (st.busy ? " busy" : "") + '" id="rfBtn" data-a="refresh" aria-label="تحديث الآن">' + ic("refresh") + "</button></div>" +
      (opt.below || "") + "</header>";
  }
  function paintSync() {
    var l = el("syncLine"), b = el("rfBtn");
    if (!l) return;
    var st = C.syncState();
    l.className = "sl " + st.level;
    l.lastChild.textContent = syncText(st);
    if (b) b.classList.toggle("busy", !!st.busy);
  }

  /* ---------- الربط (أول مرة) ----------
     خانتان ظاهرتان دائماً: عنوان الربط وكلمة السر منفصلتين. والرابط الجاهز اختياري: إن لُصق ملأ
     الخانتين وحده. والخطأ لا يمسح ما كُتب: الخانات تبقى كما هي */
  function pSetup() {
    var sh = C.shop(), f = v.sf || {};
    return '<div class="login"><div class="brand">' + logo("logo") +
      "<h2>" + esc(sh.name) + "</h2>" + (sh.city ? '<div class="br">فرع ' + esc(sh.city) + "</div>" : "") + "</div>" +
      '<div class="lcard"><div class="t">' + ic("link") + " اربط التطبيق بمنظومة المكتبة</div>" +
      '<p class="hint">في المنظومة على كمبيوتر المحل: الإعدادات ← الأجهزة والفروع ← «المشاهدة من التلفون». منها تأخذ العنوان وكلمة السر.</p>' +
      '<label class="fld mt"><span>١) عنوان الربط</span><input class="inp ltr" id="stUrl" inputmode="url" placeholder="https://….workers.dev" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="' + esc(f.u || "") + '"></label>' +
      '<label class="fld"><span>٢) كلمة السر</span><div class="pwrow"><input class="inp ltr" id="stKey" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="' + esc(f.k || "") + '">' +
      '<button type="button" class="eye" data-a="eye">إظهار</button></div></label>' +
      '<label class="fld"><span>أو الصق الرابط الجاهز كاملاً (يملأ الخانتين وحده)</span><input class="inp ltr" id="stLink" placeholder="https://…#u=…&amp;k=…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="' + esc(f.l || "") + '"></label>' +
      '<div class="err" id="stErr">' + esc(v.setup) + "</div>" +
      '<button class="btn p" data-a="link">' + ic("check") + " اربط</button></div>" +
      '<p class="lfoot">التطبيق لا يغيّر شيئاً في المنظومة إلا ما تبيعه وتعدّله أنت، وكل شيء يمرّ عليها أولاً.</p></div>';
  }
  function afterSetup() {
    var lk = el("stLink"), u = el("stUrl"), k = el("stKey");
    function fill() {
      var l = C.parseLink(lk.value);
      if (!l) return;
      u.value = l.url; k.value = l.key;
      setupMsg("ملأتُ الخانتين من الرابط ✓ اضغط «اربط».", true);
    }
    if (lk) { lk.addEventListener("input", fill); lk.addEventListener("change", fill); }
    /* الرابط كله لُصق في خانة العنوان: يُفهم أيضاً */
    if (u) u.addEventListener("input", function () {
      if (/#/.test(u.value) && /\bu=/.test(u.value)) { var l = C.parseLink(u.value); if (l) { u.value = l.url; k.value = l.key; setupMsg("ملأتُ الخانتين من الرابط ✓ اضغط «اربط».", true); } }
    });
    if (k) k.addEventListener("keydown", function (e) { if (e.key === "Enter") doLink(); });
  }
  function setupMsg(msg, good) {
    var e = el("stErr");
    if (!e) return;
    e.textContent = msg;
    e.classList.toggle("good", !!good);
  }
  function doLink() {
    var f = { l: ((el("stLink") || {}).value || "").trim(), u: ((el("stUrl") || {}).value || "").trim(), k: ((el("stKey") || {}).value || "").trim() };
    v.sf = f;
    var l = null;
    if (/#/.test(f.u) && /\bu=/.test(f.u)) l = C.parseLink(f.u);
    if (!l && f.u && f.k) {
      l = { url: /^https?:\/\//i.test(f.u) ? f.u : "https://" + f.u, key: f.k };
      /* الخانتان مملوءتان من رابط جاهز: فرعه (&b=) يبقى معهما */
      var pl = f.l ? C.parseLink(f.l) : null;
      if (pl && pl.url === f.u && pl.key === f.k) l.branch = pl.branch;
    }
    if (!l && f.l) { l = C.parseLink(f.l); if (!l) { setupMsg("الرابط غير صحيح: لازم فيه #u=… و&k=… — أو املأ الخانتين فوق."); return; } }
    if (!l) { setupMsg(!f.u ? "اكتب عنوان الربط أولاً (الخانة ١)." : "اكتب كلمة السر (الخانة ٢)."); return; }
    if (C.badKeyChars(l.key)) { setupMsg("كلمة السر فيها حرف غير إنجليزي (عربي أو علامة ذكية مثل – بدل -). اكتبها بلوحة المفاتيح الإنجليزية."); return; }
    l.url = String(l.url).replace(/\/+$/, "");
    C.setLink(l);
    v.setup = "";
    el("app").innerHTML = '<div class="boot"><div class="bootin"><span class="spin"></span><p class="note">يتصل بالمنظومة…</p></div></div>';
    C.refresh().then(function (ok) {
      if (!ok) { v.setup = "تعذّر الاتصال: تأكد من الإنترنت ومن العنوان وكلمة السر (ما كتبتَه بقي في الخانات لتصحّحه)."; C.unlink(); }
      else v.sf = null;
      tellAndroid();
      render();
    });
  }
  /* تطبيق أندرويد يفحص المخزون في الخلفية للإشعارات: يأخذ الربط وما اختاره صاحب الهاتف منها */
  function tellAndroid() {
    try {
      if (window.AndroidApp && AndroidApp.setConfig) AndroidApp.setConfig(JSON.stringify({ url: S().cfg.url, key: S().cfg.key,
        notif: { stock: !!C.pref("nStock"), restock: !!C.pref("nRestock"), daily: !!C.pref("nDaily"), sync: !!C.pref("nSync") } }));
      if (window.AndroidApp && AndroidApp.setBar) AndroidApp.setBar(getComputedStyle(document.body).getPropertyValue("--c").trim() || "#1f4597");
    } catch (e) { }
  }
  /* ما وصلت بعد بيانات الفرع: دوّارة فقط ما دام التحديث جارياً. إن فشل (كلمة سر خطأ، عنوان خطأ، لا إنترنت،
     الخادم لا يردّ) يُقال السبب وفيه زر إعادة المحاولة وزر تعديل الربط */
  function pWaiting() {
    var b = C.branchId(), nm = b === "tripoli" ? "طرابلس" : b === "misrata" ? "مصراتة" : b;
    var err = C.lastError(), busy = C.isBusy() || (!S().at && !err);
    var body;
    if (busy) body = '<div class="empty"><span class="spin"></span><h3 class="mt">يحمّل بيانات الفرع…</h3><p>أول مرة فقط؛ بعدها يعمل بلا إنترنت.</p></div>';
    else {
      var again = '<button class="btn p" data-a="refresh">' + ic("refresh") + " إعادة المحاولة</button>" +
        '<button class="btn o mt" data-a="unlink">فك الربط وإدخال العنوان وكلمة السر من جديد</button>';
      var badChars = "كلمة السر فيها حرف غير إنجليزي — غالباً من لوحة المفاتيح العربية أو من علامة «ذكية» يضعها الآيفون (مثل – بدل -). افتح «فك الربط» واكتبها بلوحة المفاتيح الإنجليزية، أو انسخها من المنظومة كما هي.";
      if (err === "BADCHARS") body = emptyBox("alert", "كلمة السر فيها حرف غير مقبول", badChars) + again;
      else if (err === "BADKEY") body = emptyBox("alert", "كلمة سر الربط غير صحيحة", "الكلمة اللي أدخلتها ليست كلمة سر هذا الخادم. افتح «فك الربط» وأعد كتابتها كما في المنظومة (الإعدادات ← الأجهزة والفروع ← «المشاهدة من التلفون»).") + again;
      else if (err) body = emptyBox("alert", "تعذّر الاتصال بخادم الربط", "تأكد من الإنترنت ومن عنوان الربط، ثم أعد المحاولة. السبب: " + (err === "NET" ? "لا اتصال أو العنوان خطأ" : err === "TIMEOUT" ? "الخادم لا يردّ" : err)) + again;
      else body = emptyBox("alert", "فرع " + nm + " لم يصل بعد", "منظومة الفرع لم تُربط بخادم الربط، أو لم ترفع لقطتها بعد. في المنظومة: «المخزون والفروع» ← «تحديث الآن»، ثم حدّث هنا.") + again;
    }
    return '<div class="login"><div class="brand">' + logo("logo") + "<h2>" + esc(C.shop().name) + "</h2></div>" +
      '<div class="lcard">' + body + "</div></div>";
  }

  /* ---------- الدخول ---------- */
  function pLock() {
    var sh = C.shop(), inf = C.staffInfo();
    var h = '<div class="login"><div class="brand">' + logo("logo") + "<h2>" + esc(sh.name) + "</h2>" +
      (sh.city ? '<div class="br">فرع ' + esc(sh.city) + "</div>" : "") + '</div><div class="lcard" id="lcard">';
    if (inf) {
      var ps = C.people();
      if (!v.pick || !C.personOf(v.pick)) v.pick = C.personOf(S().last) ? S().last : (ps[0] && ps[0].id) || "";
      h += '<div class="t">من يعمل الآن؟</div><div class="who">' + ps.map(function (p) {
        return '<button class="p' + (p.id === v.pick ? " on" : "") + '" data-a="pick" data-v="' + esc(p.id) + '"><div class="av">' + esc(initial(p.n)) + "</div><span>" + esc(p.n) + "</span></button>";
      }).join("") + "</div>" +
        '<input class="inp pw" id="pw" type="password" inputmode="text" autocomplete="current-password" placeholder="كلمة السر">' +
        '<div class="err" id="lkErr">' + esc(v.err) + "</div>" +
        '<button class="btn p" data-a="login">دخول</button>' +
        (C.bioRec(v.pick) ? '<button class="face" data-a="bio"><i>' + ic(C.IOS ? "face" : "finger") + "</i>الدخول ب" + C.bioWord() + "</button>" : "") +
        "</div>" + '<p class="lfoot">كلمة السر نفسها التي في المنظومة على الكمبيوتر.</p>';
    } else if (C.needsPin()) {
      h += '<div class="t">' + ic("lock") + " اختر رمز دخول لهذا الهاتف</div>" +
        '<p class="hint">يُطلب كل ما تفتح التطبيق (أو ' + C.bioWord() + ' بعدها). 4 أرقام أو أكثر.</p>' +
        '<input class="inp pw mt" id="pw" type="password" inputmode="numeric" autocomplete="new-password" placeholder="••••">' +
        '<input class="inp pw mt" id="pw2" type="password" inputmode="numeric" autocomplete="new-password" placeholder="أعده للتأكيد">' +
        '<div class="err mt" id="lkErr">' + esc(v.err) + "</div>" +
        '<button class="btn p" data-a="pinSet">حفظ الرمز والدخول</button></div>' +
        '<p class="lfoot">الرمز خاص بهذا الهاتف وحده، لا يُرسل لأي مكان.</p>';
    } else {
      h += '<div class="t">ادخل رمز هذا الهاتف</div>' +
        '<input class="inp pw" id="pw" type="password" inputmode="numeric" autocomplete="current-password" placeholder="••••">' +
        '<div class="err" id="lkErr">' + esc(v.err) + "</div>" +
        '<button class="btn p" data-a="pinIn">دخول</button>' +
        (C.bioRec("") ? '<button class="face" data-a="bio"><i>' + ic(C.IOS ? "face" : "finger") + "</i>الدخول ب" + C.bioWord() + "</button>" : "") +
        "</div>" + '<p class="lfoot">نسيت الرمز؟ «فك الربط» من الإعدادات بعد الدخول، أو امسح بيانات التطبيق.</p>';
    }
    return h + "</div>";
  }
  var bioTried = "";
  function afterLock() {
    var pw = el("pw");
    if (pw) pw.addEventListener("keydown", function (e) { if (e.key === "Enter") act(C.staffInfo() ? "login" : C.needsPin() ? "pinSet" : "pinIn"); });
    /* الوجه أو البصمة يُطلب وحده مرة عند الفتح */
    var id = C.staffInfo() ? v.pick : "";
    if (C.bioRec(id) && bioTried !== id + "|" + awayAt) { bioTried = id + "|" + awayAt; setTimeout(function () { act("bio"); }, 350); }
    else if (pw && !ANDROID) setTimeout(function () { try { pw.focus(); } catch (e) { } }, 200);
  }
  function lockErr(msg) {
    v.err = msg;
    var e = el("lkErr"); if (e) e.textContent = msg;
    var c = el("lcard"); if (c) { c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake"); }
    var p = el("pw"); if (p) { p.value = ""; }
  }
  function entered() {
    v.err = "";
    if (v.screen === "item" || v.screen === "edit") { v.screen = "items"; v.back = []; }
    v.form = null;
    var id = C.staffInfo() ? (C.who().id) : "";
    v.fresh = true;
    render();
    C.bioAvail().then(function (ok) {
      if (!ok || C.bioRec(id)) return;
      if ((S().bioAsked || {})[id || "_"]) return;
      S().bioAsked = S().bioAsked || {}; S().bioAsked[id || "_"] = 1; C.save();
      sheet('<h2>' + ic(C.IOS ? "face" : "finger") + " الدخول ب" + C.bioWord() + "؟</h2>" +
        '<p class="by">بدل ' + (id ? "كلمة السر" : "الرمز") + " كل مرة. تقدر توقفه من «الإعدادات».</p>" +
        '<button class="btn p" data-a="bioOn">' + ic("check") + " فعّل</button>" +
        '<button class="btn o mt" data-a="close">لاحقاً</button>');
    });
  }

  /* ---------- الرئيسية: ملخّص اليوم، ثم القائمة ---------- */
  function dashToday() {
    var m = C.mine(), d = m && m.dash, t = C.localToday();
    var day = d && d.days && d.days[t] ? d.days[t] : { v: 0, n: 0 };
    var phone = S().orders.filter(function (o) { return o.status === "pending" && o.date === t; });
    return {
      v: C.r3(num(day.v) + phone.reduce(function (a, o) { return a + num(o.total); }, 0)),
      n: num(day.n) + phone.length,
      last: (phone[0] && phone[0].at) || (d && d.recent && d.recent[0] && d.recent[0].d === t ? d.recent[0].d + " " + d.recent[0].at : "")
    };
  }
  /* ما نفد أو قارب: يُحسب مرة لكل تغيّر في البيانات (الرئيسية تسأل عنه مع كل رسم) */
  var alOf = null, alCache = null;
  function alertsList() {
    var all = C.items();
    if (alOf === all && alCache) return alCache;
    var m0 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    alOf = all;
    alCache = all.filter(function (g) {
      if (g.un || g.isNew) return false;                    // لم يُجرد بعد: كميته غير معروفة، لا «نفد»
      if (g.q <= 0) return g.m > 0 || (g.ls && String(g.ls).slice(0, 10) >= m0) || g.pend;
      return g.m > 0 && g.q <= g.m;
    });
    return alCache;
  }
  function custOf() { return ((C.mine() || {}).cust || []); }
  function supOf() { return ((C.mine() || {}).sup || null); }
  function creditOf() { var d = (C.mine() || {}).dash; return d && Array.isArray(d.credit) ? d.credit : null; }
  function pHome() {
    var sh = C.shop(), w = C.who(), m = C.mine(), seeMoney = C.canP(["invoices", "profits"]) && m.dash;
    var who = '<span class="hw">' + ic("user") + " " + esc(w.n) + (w.role ? " · " + esc(w.role) : "") + "</span>";
    var hero = '<div class="hero">';
    if (seeMoney) {
      var d = dashToday();
      hero += '<div class="hrow"><span class="hl">مبيعات اليوم</span>' + who + '</div><div class="hbig"><b class="num" id="heroNum" data-n="' + d.v + '">' + moneyBig(d.v) + "</b> <small>" + esc(C.cur()) + "</small></div>" +
        '<div class="hs">' + fmtN(d.n) + " فاتورة" + (d.last ? " · آخر بيعة " + esc(C.ago(d.last)) : "") + "</div>";
    } else {
      var inf = C.info();
      hero += '<div class="hrow"><span class="hl">أصناف الفرع</span>' + who + '</div><div class="hbig"><b class="num" id="heroNum" data-n="' + inf.n + '" data-int="1">' + fmtN(inf.n) + "</b> <small>صنف</small></div>" +
        '<div class="hs">' + fmtN(C.byType("book").length) + " كتاب · " + fmtN(C.byType("stat").length) + " قرطاسية</div>";
    }
    if (v.progress) hero += '<div class="pbar"><i></i></div><div class="hs">ينزّل قائمة كتب الفرع…</div>';
    hero += "</div>";
    var h = bar(sh.name + (sh.city ? " — " + sh.city : ""), { logo: true, cls: "big", below: hero });

    var al = alertsList().length, t = C.localToday(), cust = custOf(), sup = supOf(), cr = creditOf();
    var mine = S().orders.filter(function (o) { return o.date === t && o.status !== "fail"; }).length;
    var rows = [];
    if (C.canP(["count", "items"])) rows.push(["count", "stack", "t1", "الجرد", "عدّ ما على الرف وصحّح الكميات", ""]);
    rows.push(["invoices", "doc", "t2", "الفواتير",
      seeMoney ? fmtN(dashToday().n) + " فاتورة اليوم" + (mine ? " · " + fmtN(mine) + " من هذا الهاتف" : "") : fmtN(mine) + " فاتورة من هذا الهاتف اليوم", ""]);
    if (C.canP(["debts", "pay", "invoices"])) {
      var crT = (cr || []).filter(function (x) { return x.d === t; });
      rows.push(["credit", "clock", "t3", "الآجل",
        !cr ? "البيع بالآجل وما لم يُقبض" : crT.length ? fmtN(crT.length) + " بيع آجل اليوم · لم يُقبض " + money(crT.reduce(function (a, x) { return a + num(x.due); }, 0)) : "لا بيع آجل اليوم", ""]);
    }
    if (C.canP(["debts", "pay"])) {
      var owe = cust.filter(function (c) { return num(c.b) > 0; }), ours = (sup || []).filter(function (s) { return num(s.b) > 0; });
      rows.push(["debts", "wallet", "t4", "الديون",
        (owe.length ? "لنا عند " + fmtN(owe.length) + " زبون: " + money(owe.reduce(function (a, c) { return a + num(c.b); }, 0)) : "لا ديون على الزبائن") +
        (ours.length ? " · علينا " + money(ours.reduce(function (a, s) { return a + num(s.b); }, 0)) : ""), ""]);
    }
    rows.push(["alerts", "bell", "t5", "التنبيهات", al ? fmtN(al) + " صنف نفد أو قارب على النفاد" : "لا نواقص — كل شيء فوق حد التنبيه", al ? String(Math.min(al, 999)) : ""]);
    h += '<div class="page"><div class="menu stagger">' + rows.map(function (r) {
      return '<button class="mi" data-a="open2" data-v="' + r[0] + '"><span class="mic ' + r[2] + '">' + ic(r[1]) + '</span><span class="m"><b>' + r[3] + "</b><span>" + esc(r[4]) + "</span></span>" +
        (r[5] ? '<span class="badge">' + r[5] + "</span>" : "") + '<span class="chev">' + ic("chev") + "</span></button>";
    }).join("") + "</div>";
    var pend = C.pending(), bad = C.failed();
    if (pend || bad) {
      h += '<button class="strip' + (bad ? " bad" : "") + '" data-a="open2" data-v="outbox">' + ic(bad ? "alert" : "send") + "<span>" +
        (bad ? fmtN(bad) + " عملية لم تسجّلها المنظومة" + (pend ? " · " + fmtN(pend) + " تنتظر" : "") : fmtN(pend) + " عملية تنتظر الوصول للمنظومة") +
        "</span>" + ic("chev") + "</button>";
    }
    h += '<p class="note">' + fmtN(C.info().n) + " صنف على هذا الهاتف — يعمل بلا إنترنت، ويُرسل ما تعمله عند رجوعه.</p></div>";
    return h;
  }

  /* ---------- إضافة وتعديل ----------
     ثلاثة أوضاع كما في «إدخال بضاعة» على الكمبيوتر: عرض وتعديل، إضافة كمية، صنف جديد.
     والكتب منفصلة عن القرطاسية، والعرض قائمة أو بطاقات أو خريطة الرفوف */
  function canAdd() { return C.canP(["items", "goods"]); }
  function canEdit() { return C.canP(["items", "price", "goods", "count"]); }
  function iType() { return C.pref("type") === "stat" ? "stat" : "book"; }
  function iView() { var x = C.pref("view"); return x === "cards" || x === "map" ? x : "list"; }
  function iMode() { return v.mode === "qty" || v.mode === "new" ? v.mode : "view"; }
  function pItems() {
    var mode = iMode(), type = iType();
    function mb(k, t) { return '<button class="' + (mode === k ? "on" : "") + '" data-a="imode" data-v="' + k + '">' + t + "</button>"; }
    function vb(k, icon, t) { return '<button class="' + (iView() === k ? "on" : "") + '" data-a="iview" data-v="' + k + '" aria-label="' + t + '" title="' + t + '">' + ic(icon) + "</button>"; }
    var h = bar("إضافة وتعديل", { below: '<div class="mseg" role="tablist">' + mb("view", "عرض وتعديل") + mb("qty", "إضافة كمية") + mb("new", "صنف جديد") + "</div>" });
    h += '<div class="page">';
    if (mode !== "qty") {
      h += '<div class="trow"><div class="seg grow">' +
        '<button class="' + (type === "book" ? "on" : "") + '" data-a="itype" data-v="book">' + ic("book") + ' كتب <i class="num">' + fmtN(C.byType("book").length) + "</i></button>" +
        '<button class="' + (type === "stat" ? "on" : "") + '" data-a="itype" data-v="stat">' + ic("box") + ' قرطاسية <i class="num">' + fmtN(C.byType("stat").length) + "</i></button></div>" +
        (mode === "view" ? '<div class="vseg" role="group" aria-label="طريقة العرض">' + vb("list", "list", "قائمة") + vb("cards", "grid", "بطاقات") + vb("map", "shelves", type === "book" ? "الرفوف" : "الأماكن") + "</div>" : "") + "</div>";
    }
    h += mode === "qty" ? recvHtml() : mode === "new" ? newHtml(type) : viewHtml(type);
    return h + "</div>";
  }

  /* --- عرض وتعديل --- */
  function viewHtml(type) {
    return '<div class="srch"><span>' + ic("search") + '</span><input id="iq" type="search" value="' + esc(v.q) + '" placeholder="' +
      (type === "book" ? "العنوان أو المؤلف أو الباركود" : "اسم الصنف أو الماركة أو الباركود") + '" autocomplete="off" enterkeyhint="search">' +
      '<button class="clr' + (v.q ? "" : " hidden") + '" id="iqClr" data-a="clrQ" aria-label="مسح البحث">' + ic("x") + "</button>" +
      '<button class="cam" data-a="scan" aria-label="امسح الباركود">' + ic("scan") + "</button></div>" +
      '<div id="ires">' + viewBody(type) + "</div>";
  }
  function viewBody(type) {
    if (iView() === "map" && !String(v.q).trim()) return v.place ? placeHtml(type) : mapHtml(type);
    return chipsHtml(type) + resultsHtml(type);
  }
  function chipsHtml(type) {
    function chip(k, t) { return '<button class="' + (v.filt === k ? "on" : "") + '" data-a="filt" data-v="' + k + '">' + t + "</button>"; }
    return '<div class="filters"><button class="pickc' + (v.cat ? " on" : "") + '" data-a="catPick">' + ic("filter") + " " + esc(v.cat || (type === "book" ? catWord() : "التصنيف")) +
      (v.cat ? ' <span class="xx" data-a="catClr" aria-label="إلغاء">' + ic("x") + "</span>" : "") + "</button>" +
      chip("", "الكل") + chip("have", "المتوفر") + chip("out", "نفد") + chip("nop", "بلا سعر") +
      (type === "book" ? chip("noloc", "بلا مكان") : "") + (isX4() && type === "book" ? chip("unc", "لم يُجرد") : "") + "</div>";
  }
  function filtered(type) {
    var list = C.byType(type), f = v.filt;
    if (v.cat) list = list.filter(function (g) { return g.c === v.cat; });
    if (f === "have") list = list.filter(function (g) { return g.q > 0; });
    else if (f === "out") list = list.filter(function (g) { return g.q <= 0 && !g.un; });
    else if (f === "nop") list = list.filter(function (g) { return !(g.p > 0); });
    else if (f === "noloc") list = list.filter(function (g) { return !locTxt(g); });
    else if (f === "unc") list = list.filter(function (g) { return g.un; });
    return C.search(list, v.q, 40);
  }
  function moreHtml(total, shown) {
    return total > shown ? '<button class="more-btn" id="moreBtn" data-a="more">عرض ' + Math.min(40, total - shown) + " أخرى من " + fmtN(total - shown) + "</button>" : "";
  }
  function resultsHtml(type) {
    var all = C.byType(type), book = type === "book";
    if (!all.length) return emptyBox(book ? "book" : "box", book ? "لا كتب بعد" : "لا قرطاسية بعد",
      C.info().src === "none" ? "لم تصل قائمة الفرع بعد — اضغط زر التحديث أعلى الشاشة." : "أضف أول صنف من «صنف جديد».");
    var res = filtered(type), cards = iView() === "cards";
    if (!res.length) return emptyBox("search", "لا نتيجة", "جرّب كلمة أخرى، أو امسح الباركود.",
      v.filt || v.cat ? '<button class="btn g sm mt" data-a="filtClr">إلغاء التصفية</button>' : "");
    var shown = res.slice(0, v.shown);
    return '<p class="cnt">' + fmtN(res.length) + (v.q || v.filt || v.cat ? " نتيجة" : book ? " كتاب" : " صنف") + "</p>" +
      (res.fz && res.fz.first === 0 && v.q ? '<div class="near">ما لقيناش «' + esc(v.q) + '» بالضبط — هل تقصد؟</div>' : "") +
      '<div class="' + (cards ? "cards" : "rows") + '">' + shown.map(cards ? cardHtml : resHtml).join("") + "</div>" + moreHtml(res.length, shown.length);
  }
  function qtyChip(g) {
    if (g.isNew) return '<span class="chip w">' + ic("clock") + " جديد — ينتظر المنظومة</span>";
    if (g.un) return '<span class="chip g">لم يُجرد</span>';
    return g.q > 0 ? '<span class="chip ok">' + fmtU(g.q, g) + "</span>" : '<span class="chip b">نفد</span>';
  }
  function resHtml(g) {
    var lt = locTxt(g);
    return '<button class="res' + (g.q <= 0 && !g.un && !g.isNew ? " out" : "") + '" data-a="open" data-v="' + esc(g.key) + '"><span class="cv">' + ic(g.t === "book" ? "book" : "box") + "</span>" +
      '<span class="m"><b>' + esc(g.n) + "</b><span>" + esc([g.a, g.c].filter(Boolean).join(" · ")) + "</span>" +
      '<span class="tags">' + (lt ? '<span class="chip g">' + ic("pin") + " " + esc(lt) + "</span>" : "") + qtyChip(g) +
      g.others.filter(function (o) { return o.q > 0; }).slice(0, 2).map(function (o) { return '<span class="chip w">' + esc(o.name) + ": " + o.q + "</span>"; }).join("") +
      (g.editing && !g.isNew ? '<span class="chip">' + ic("clock") + " تعديل</span>" : "") + "</span></span>" +
      '<span class="pr"><b class="num">' + (g.p > 0 ? money(g.p) : "—") + "</b><span>" + (g.p > 0 ? esc(C.cur()) : "بلا سعر") + "</span></span></button>";
  }
  function cardHtml(g) {
    var lt = locTxt(g);
    return '<button class="cardi' + (g.q <= 0 && !g.un && !g.isNew ? " out" : "") + '" data-a="open" data-v="' + esc(g.key) + '">' +
      '<span class="cv">' + ic(g.t === "book" ? "book" : "box") + '<i class="num">' + (g.p > 0 ? money(g.p) : "—") + "</i></span>" +
      "<b>" + esc(g.n) + '</b><span class="au">' + esc(g.a || g.c || "") + "</span>" +
      '<span class="tags">' + qtyChip(g) + (lt ? '<span class="chip g">' + esc(lt) + "</span>" : "") + "</span></button>";
  }
  /* خريطة الرفوف: الخزائن حروفاً، ورفوف الخزانة المختارة بعدد كتبها */
  function mapHtml(type) {
    var mp = C.shelfMap(type), book = type === "book", h = "";
    if (!mp.total) return resultsHtml(type);
    if (!mp.libs.length) h = emptyBox("shelves", book ? "لا كتاب له مكان بعد" : "لا صنف له مكان بعد", "سجّل الأماكن من «الجرد»، أو من تعديل الصنف.");
    else if (book) {
      var at = 0;
      mp.libs.forEach(function (x, i) { if (x.lib === v.mapLib) at = i; });
      var L = mp.libs[at];
      v.mapLib = L.lib;
      h = '<div class="letters">' + mp.libs.map(function (x, i) {
        return '<button class="' + (i === at ? "on" : "") + '" data-a="mapLib" data-v="' + i + '">' + esc(x.lib) + "</button>";
      }).join("") + "</div>" +
        '<div class="sec"><b>خزانة ' + esc(L.lib) + '</b><span class="mut">' + fmtN(L.n) + " كتاب · " + fmtQ(L.q) + "</span></div>" +
        '<div class="case stagger">' + L.shelves.map(function (sh, j) {
          return '<button class="shelf" data-a="place" data-v="' + at + ":" + j + '"><span class="sn">' + (sh.s ? "رف " + esc(sh.s) : "بلا رف") + "</span>" +
            '<span class="sbar"><i data-w="' + Math.max(5, Math.round(sh.n / L.max * 100)) + '"></i></span>' +
            '<span class="sc"><b class="num">' + fmtN(sh.n) + "</b> كتاب<small>" + fmtQ(sh.q) + "</small></span>" + ic("chev") + "</button>";
        }).join("") + "</div>";
    } else {
      h = '<div class="sec"><b>أماكن القرطاسية</b><span class="mut">' + fmtN(mp.libs.length) + " مكان</span></div>" +
        '<div class="case stagger">' + mp.libs.map(function (L2, i) {
          return '<button class="shelf" data-a="place" data-v="' + i + ':0"><span class="sn wide">' + esc(L2.lib) + '</span><span class="sc"><b class="num">' + fmtN(L2.n) + "</b> صنف</span>" + ic("chev") + "</button>";
        }).join("") + "</div>";
    }
    if (mp.none.n) h += '<button class="shelf none" data-a="place" data-v="none"><span class="sn wide">بلا مكان</span><span class="sc"><b class="num">' + fmtN(mp.none.n) + "</b> " + (book ? "كتاب" : "صنف") + "</span>" + ic("chev") + "</button>";
    return h;
  }
  function placeItems(type) {
    var p = v.place, book = type === "book";
    return C.byType(type).filter(function (g) {
      if (p.none) return book ? (!g.lib && !g.shelf) : !g.loc;
      return book ? ((g.lib || "؟") === p.lib && String(g.shelf || "") === p.shelf && (g.lib || g.shelf)) : (g.loc === p.lib);
    });
  }
  function placeHtml(type) {
    var res = placeItems(type), shown = res.slice(0, v.shown), p = v.place, book = type === "book";
    var title = p.none ? "بلا مكان" : book ? "خزانة " + p.lib + (p.shelf ? " · رف " + p.shelf : " · بلا رف") : p.lib;
    return '<button class="crumb" data-a="placeBack">' + ic("back") + '<span class="m"><b>' + esc(title) + "</b><span>" + fmtN(res.length) + (book ? " كتاب" : " صنف") +
      " — رجوع " + (book ? "للرفوف" : "للأماكن") + "</span></span></button>" +
      (res.length ? '<div class="rows">' + shown.map(resHtml).join("") + "</div>" + moreHtml(res.length, shown.length)
        : emptyBox("shelves", "لا شيء هنا الآن", "تغيّر مكان ما كان هنا."));
  }

  /* --- صفحة الصنف --- */
  function openItem(key) {
    var g = C.byKey(key);
    if (!g) return;
    v.key = key; v.code = g.code || "";
    if (v.screen === "item") { v.fresh = true; render(); window.scrollTo(0, 0); }
    else open2("item");
  }
  /* باركود الصنف عُدّل ووصل: مفتاحه تغيّر، فيُعثر عليه برمزه */
  function curItem() { return C.byKey(v.key) || (v.code ? C.byCode(v.code) : null); }
  function pItem() {
    var g = curItem();
    if (!g) return bar("الصنف", { back: true }) + '<div class="page">' + emptyBox("search", "الصنف غير موجود الآن", "قد يكون حُذف أو تغيّر في المنظومة.") + "</div>";
    var lt = locTxt(g), book = g.t === "book", L = C.lists();
    var sup = g.sp ? L.sups.filter(function (s) { return s.id === g.sp; })[0] : null;
    function row(k, val, extra) { return val ? '<div class="w"><span>' + k + "</span><b>" + val + "</b>" + (extra || "") + "</div>" : ""; }
    var h = bar(book ? "بطاقة الكتاب" : "بطاقة الصنف", { back: true });
    h += '<div class="page"><div class="ihead"><span class="cv big">' + ic(book ? "book" : "box") + '</span><div class="m"><h2>' + esc(g.n) + "</h2>" +
      "<p>" + esc([g.a || (book ? "بدون مؤلف" : ""), g.d].filter(Boolean).join(" · ")) + "</p>" +
      '<div class="tags">' + (g.c ? '<span class="chip">' + esc(g.c) + "</span>" : "") + qtyChip(g) +
      (g.pend ? '<span class="chip w">' + ic("clock") + " بعت منه " + g.pend + "</span>" : "") +
      (g.editing && !g.isNew ? '<span class="chip">' + ic("clock") + " تعديل ينتظر المنظومة</span>" : "") + "</div></div></div>" +
      '<div class="nums"><div><b class="num">' + (g.p > 0 ? money(g.p) : "—") + "</b><span>" + (g.p > 0 ? "السعر" : "بلا سعر") + "</span></div>" +
      '<div><b class="num">' + (g.un ? "؟" : fmtN(Math.max(g.q, 0))) + "</b><span>في الفرع</span></div>" +
      '<div><b class="num">' + esc(lt || "—") + "</b><span>المكان</span></div></div>";
    var acts = "";
    if (!g.isNew) {
      if (C.canP("sell")) acts += '<button class="btn p" data-a="sellOne">' + ic("cart") + " بيع</button>";
      if (canEdit()) acts += '<button class="btn g" data-a="edit">' + ic("edit") + " تعديل</button>";
      if (canAdd() && full()) acts += '<button class="btn g" data-a="addQty">' + ic("plus") + " إضافة كمية</button>";
    }
    h += acts ? '<div class="acts n' + acts.split("<button").length + '">' + acts + "</div>"
      : g.isNew ? '<p class="note">ينتظر تسجيله في المنظومة — بعدها تقدر تبيعه وتعدّله.</p>' : "";
    var where = (book ? row("على الرفوف" + (lt ? " · " + esc(lt) : ""), '<span class="num">' + fmtN(Math.max(g.shelfQ, 0)) + "</span>") : "") +
      (g.room > 0 ? row("غرفة الخزين", '<span class="num">' + fmtN(g.room) + "</span>") : "") +
      (g.wh > 0 ? row("المخازن", '<span class="num">' + fmtN(g.wh) + "</span>") : "") +
      g.others.map(function (o) { return row(esc(o.name), '<span class="num">' + fmtN(o.q) + "</span>"); }).join("");
    if (where) h += '<div class="sec"><b>أين هو؟</b></div><div class="card where">' + where + "</div>";
    var bc = g.b || "";
    h += '<div class="sec"><b>التفاصيل</b></div><div class="card where">' +
      '<div class="w"><span>الباركود</span><b class="bc num">' + esc(bc || "بلا باركود") + "</b>" + (bc ? '<button class="chip" data-a="copy" data-v="' + esc(bc) + '">' + ic("copy") + " نسخ</button>" : "") + "</div>" +
      row("الرمز في المنظومة", g.code ? '<span class="num">' + esc(g.code) + "</span>" : "") +
      row("دار النشر", esc(g.d)) + row(book ? catWord() : "التصنيف", esc(g.c)) + row("التخصص الدقيق", esc(g.cf)) +
      row("المورّد", sup ? esc(sup.n) : "") + row("وحدة البيع", !book ? esc(g.u) : "") +
      row("سعر الجملة", g.pw > 0 ? '<span class="num">' + money(g.pw) + "</span>" : "") +
      row("حد التنبيه", g.m > 0 ? '<span class="num">' + fmtN(g.m) + "</span>" : "") +
      row("آخر بيعة", g.ls ? esc(C.ago(g.ls)) : "") + "</div>" +
      (g.nt ? '<div class="sec"><b>ملاحظة</b></div><div class="card"><p class="ntx">' + esc(g.nt) + "</p></div>" : "") + "</div>";
    return h;
  }

  /* --- نموذج الصنف: للتعديل وللصنف الجديد، بنفس خانات الكمبيوتر (إلا سعر الشراء) --- */
  function tr(x) { return String(x === null || x === undefined ? "" : x).replace(/\s+/g, " ").trim(); }
  function formDefs(t, isNew) {
    var L = C.lists(), book = t === "book", fl = full(), x = [];
    function can(p) { return isNew ? true : C.canP(p); }
    x.push({ sec: book ? "بيانات الكتاب" : "بيانات الصنف", icon: book ? "book" : "box" });
    x.push({ k: "n", label: book ? "اسم الكتاب" : "اسم الصنف", req: 1, ok: can("items") });
    x.push({ k: "a", label: book ? "المؤلف" : "الماركة", ok: can("items") });
    if (book) x.push({ k: "d", label: "دار النشر", pick: "pubs", ok: can("items") && fl });
    x.push({ k: "c", label: book ? catWord() : "التصنيف", pick: book ? "bcats" : "scats", ok: can("items") && fl });
    if (book) x.push({ k: "cf", label: "التخصص الدقيق", ok: can("items") && fl, hint: "وصف تفصيلي يُبحث فيه" });
    if (!book) x.push({ k: "u", label: "وحدة البيع", sel: L.units.map(function (u) { return [u, u]; }), ok: can("items") && fl });
    if (L.sups.length) x.push({ k: "sp", label: "المورّد", sel: [["", "— بدون —"]].concat(L.sups.map(function (s) { return [s.id, s.n]; })), ok: can(["items", "goods"]) && fl });
    x.push({ sec: "المكان", icon: "pin" });
    if (book) {
      var sh = [["", "—"]];
      for (var i = 1; i <= L.shelves; i++) sh.push([String(i), String(i)]);
      x.push({ k: "l", label: "المكتبة (الخزانة)", sel: [["", "بلا مكتبة"]].concat(L.libs.map(function (l) { return [l, l]; })), half: 1, ok: can(["items", "count"]) });
      x.push({ k: "s", label: "رقم الرف", sel: sh, half: 1, ok: can(["items", "count"]) });
    } else x.push({ k: "loc", label: "المكان في المحل", ok: can(["items", "count"]), ph: "مثال: الرف الزجاجي / الدرج 2" });
    x.push({ sec: "الباركود", icon: "scan" });
    x.push({ k: "bc", label: "الباركود", scan: 1, ltr: 1, ok: can("items") && fl, hint: "امسحه بالكاميرا، أو اتركه فارغاً ليُولَّد عند طباعة اللاصقة" });
    x.push({ sec: "الأسعار", icon: "tag" });
    x.push({ k: "p", label: "سعر البيع قطاعي", dec: 1, half: 1, ok: can("price") });
    x.push({ k: "pw", label: "سعر البيع جملة", dec: 1, half: 1, ok: can("price") && fl });
    x.push({ sec: "الكمية", icon: "stack" });
    x.push({ k: "q", qty: 1, label: isNew ? "الكمية" : "الكمية الحالية (كلها)", ok: can(["count", "goods"]) });
    if (isNew) x.push({ k: "dst", dst: 1, ok: true });
    else x.push({ k: "st", label: "منها في غرفة الخزين", int: 1, half: 1, ok: can(["count", "goods"]) && fl, hint: "الباقي يُحسب على الرفوف" });
    x.push({ k: "m", label: "حد التنبيه", int: 1, half: 1, ok: can(["goods", "items"]), hint: "ينبّهك عند الوصول له" });
    x.push({ sec: "ملاحظة", icon: "doc" });
    x.push({ k: "nt", label: "ملاحظة", area: 1, ok: can("items") && fl });
    return x;
  }
  function fieldHtml(d, f) {
    var val = f[d.k] === undefined || f[d.k] === null ? "" : String(f[d.k]), dis = d.ok ? "" : " disabled";
    var lab = "<span>" + esc(d.label || "") + (d.req ? " <em>*</em>" : "") + (d.ok ? "" : ' <i class="lk">' + ic("lock") + "</i>") + "</span>";
    var tail = (d.hint ? '<small class="hint">' + esc(d.hint) + "</small>" : "") + '<small class="hint bad" id="fe_' + d.k + '"></small>';
    if (d.dst) {
      return '<div class="fld"><span>وين تروح؟</span><div class="seg"><button type="button" class="' + (val !== "store" ? "on" : "") + '" data-a="fSet" data-v="dst|shelf">' + ic("shelves") + " للرفوف</button>" +
        '<button type="button" class="' + (val === "store" ? "on" : "") + '" data-a="fSet" data-v="dst|store">' + ic("box") + " لغرفة الخزين</button></div></div>";
    }
    if (d.qty) {
      return '<div class="fld">' + lab + '<div class="qrow"><div class="step lg"><button type="button" data-a="fStep" data-v="-1"' + dis + ' aria-label="أنقص">' + ic("minus") + "</button>" +
        '<input data-f="q" inputmode="numeric" dir="ltr" value="' + esc(val) + '"' + dis + ' aria-label="الكمية"><button type="button" data-a="fStep" data-v="1"' + dis + ' aria-label="زد">' + ic("plus") + "</button></div>" +
        '<small class="hint" id="fQd"></small></div></div>';
    }
    if (d.sel) {
      var has = d.sel.some(function (o) { return o[0] === val; });
      return '<label class="fld">' + lab + '<select class="inp" data-f="' + d.k + '"' + dis + ">" + (has ? "" : '<option value="' + esc(val) + '" selected>' + esc(val) + "</option>") +
        d.sel.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>" + tail + "</label>";
    }
    if (d.area) return '<label class="fld">' + lab + '<textarea class="inp area" rows="3" data-f="' + d.k + '"' + dis + ">" + esc(val) + "</textarea>" + tail + "</label>";
    var inp = '<input class="inp' + (d.ltr || d.dec || d.int ? " ltr" : "") + '" data-f="' + d.k + '" value="' + esc(val) + '"' +
      (d.dec ? ' inputmode="decimal"' : d.int ? ' inputmode="numeric"' : "") + (d.ph ? ' placeholder="' + esc(d.ph) + '"' : "") + ' autocomplete="off"' + dis + ">";
    if (d.pick) inp = '<div class="pwrow">' + inp + '<button type="button" class="eye" data-a="fPick" data-v="' + d.k + '"' + dis + ">" + ic("down") + " اختر</button></div>";
    if (d.scan) inp = '<div class="pwrow">' + inp + '<button type="button" class="eye" data-a="fScan" data-v="' + d.k + '"' + dis + ">" + ic("scan") + " امسح</button></div>";
    return '<div class="fld"><label>' + lab + inp + "</label>" + tail + "</div>";
  }
  function formHtml() {
    var fm = v.form, defs = formDefs(fm.t, fm.isNew), h = "", open = false, i = 0;
    while (i < defs.length) {
      var d = defs[i];
      if (d.sec) {
        if (open) h += "</div>";
        h += '<div class="fsec">' + ic(d.icon) + "<b>" + esc(d.sec) + '</b></div><div class="card form">';
        open = true; i++;
        continue;
      }
      if (d.half && defs[i + 1] && defs[i + 1].half) { h += '<div class="row2">' + fieldHtml(d, fm.f) + fieldHtml(defs[i + 1], fm.f) + "</div>"; i += 2; }
      else { h += fieldHtml(d, fm.f); i++; }
    }
    return h + (open ? "</div>" : "");
  }
  function fieldErr(k, msg) {
    var e = el("fe_" + k);
    if (e) { e.textContent = msg; var box = e.closest(".fld"); if (box && box.scrollIntoView) box.scrollIntoView({ block: "center", behavior: "smooth" }); }
    toast(msg, "warn");
  }
  function qdHint() {
    var fm = v.form, h = el("fQd");
    if (!fm || fm.isNew || !h) return;
    var d = Math.max(Math.floor(num(fm.f.q)), 0) - Math.max(num(fm.q0), 0);
    h.textContent = fm.f.q === fm.o.q || !d ? "" : d > 0 ? "سيُضاف " + d + " في المنظومة" : "سيُنقص " + (-d) + " في المنظومة";
    h.className = "hint" + (d > 0 ? " up" : d < 0 ? " down" : "");
  }
  /* باركود مستعمل في صنف آخر؟ (القائمة كلها على الهاتف) */
  function barcodeOwner(bc, exceptKey) {
    var all = C.items();
    for (var i = 0; i < all.length; i++) if (all[i].b === bc && all[i].key !== exceptKey) return all[i];
    return null;
  }
  function startEdit() {
    var g = curItem();
    if (!g) return;
    if (g.isNew) { toast("الصنف الجديد ينتظر تسجيله في المنظومة — عدّله بعدها.", "warn"); return; }
    if (!g.ob && !g.code) { toast("هذا الصنف بلا باركود ولا رمز — عدّله من الكمبيوتر.", "warn"); return; }
    var f = {
      n: g.n || "", a: g.a || "", d: g.d || "", sp: g.sp || "", c: g.c || "", cf: g.cf || "", bc: g.b || "",
      p: String(num(g.p)), pw: g.pw > 0 ? String(g.pw) : "", q: String(Math.max(g.q, 0)), st: String(Math.max(g.room, 0)), m: String(num(g.m)),
      l: g.lib || "", s: String(g.shelf || ""), loc: g.loc || "", u: g.u || "", nt: g.nt || ""
    };
    v.form = { isNew: false, t: g.t, key: g.key, code: g.code || "", f: f, o: Object.assign({}, f), q0: g.q };
    open2("edit");
  }
  function pEdit() {
    var fm = v.form, g = fm && !fm.isNew ? (C.byKey(fm.key) || (fm.code ? C.byCode(fm.code) : null)) : null;
    if (!g) return bar("تعديل", { back: true }) + '<div class="page">' + emptyBox("search", "الصنف غير موجود الآن", "ارجع واختره من جديد.") + "</div>";
    return bar(g.t === "book" ? "تعديل الكتاب" : "تعديل الصنف", { back: true }) + '<div class="page form-page"><div class="ftitle"><b>' + esc(g.n) + "</b><span>" +
      (full() ? "عدّل ما تريد ثم احفظ: يُرسل للمنظومة فتطبّقه." : "منظومة الكمبيوتر قديمة: تُعدَّل الخانات المفتوحة فقط — حدّثها إلى 4.2 للباقي.") + "</span></div>" +
      formHtml() + '<p class="note">سعر الشراء لا يظهر ولا يُعدَّل من الهاتف — من الكمبيوتر فقط.</p></div>' +
      '<div class="savebar two"><button class="btn o" data-a="back">إلغاء</button><button class="btn p" data-a="editSave">' + ic("check") + " حفظ وإرسال</button></div>";
  }
  function saveEdit() {
    var fm = v.form;
    if (!fm || fm.isNew) return;
    var g = C.byKey(fm.key) || (fm.code ? C.byCode(fm.code) : null);
    if (!g) { toast("الصنف لم يعد موجوداً.", "warn"); back(); return; }
    var f = fm.f, o = fm.o, book = g.t === "book", set = {}, okK = {};
    formDefs(g.t, false).forEach(function (d) { if (d.k && d.ok) okK[d.k] = 1; });
    /* ما لمسه المستخدم فقط: خانة لم تُلمس لا تُرسل، فلا ترجع قيمة تغيّرت في المنظومة أثناء التعديل */
    function touched(k) { return okK[k] && String(f[k]) !== String(o[k]); }
    if (touched("n")) { if (!tr(f.n)) { fieldErr("n", "الاسم لا يُترك فارغاً."); return; } if (tr(f.n) !== g.n) set.n = tr(f.n); }
    ["a", "c", "nt"].concat(book ? ["d", "cf"] : ["u", "loc"]).forEach(function (k) {
      if (touched(k)) set[k] = k === "nt" ? String(f.nt).trim() : tr(f[k]);
    });
    if (touched("sp")) set.sp = f.sp || "";
    if (book && touched("l")) set.l = tr(f.l).toUpperCase();
    if (book && touched("s")) set.s = tr(f.s);
    if (touched("bc")) {
      var bc = C.digits(tr(f.bc));
      var own = bc ? barcodeOwner(bc, g.key) : null;
      if (own) { fieldErr("bc", "هذا الباركود مستعمل في: " + own.n); return; }
      set.bc = bc;
    }
    if (touched("p")) set.p = Math.max(num(f.p), 0);
    if (touched("pw")) set.pw = Math.max(num(f.pw), 0);
    if (touched("m")) set.m = Math.max(Math.floor(num(f.m)), 0);
    var nq = Math.max(g.q, 0);
    if (touched("q")) {
      nq = Math.max(Math.floor(num(f.q)), 0);
      /* الفرق عن الكمية كما هي الآن (بما فيها ما بيع من هذا الهاتف ولم يصل)، والكمية المكتوبة بيد = جُرد */
      if (nq - g.q !== 0 || g.un) { set.qd = nq - g.q; set.cnt = 1; }
    }
    if (touched("st")) set.st = Math.min(Math.max(Math.floor(num(f.st)), 0), nq);
    if (!Object.keys(set).length) { toast("لم يتغيّر شيء."); back(); return; }
    C.editItem(g, set);
    v.form = null;
    back();
    toast("أُرسل التعديل — يظهر في المنظومة عند وصوله.", "ok");
  }

  /* --- صنف جديد --- */
  function newDraft(t) {
    var d = S().draft[t];
    if (!d || typeof d !== "object") {
      d = S().draft[t] = { n: "", a: "", d: "", sp: "", c: "", cf: "", bc: "", p: "", pw: "", q: "1", m: "0", l: "", s: "", loc: "", u: "قطعة", nt: "", dst: "shelf" };
    }
    return d;
  }
  var ESTATE = { pending: ["w", "clock", "ينتظر المنظومة"], done: ["ok", "check", "سُجّل في المنظومة"], part: ["w", "alert", "سُجّل بعضه"], fail: ["b", "x", "لم يُسجَّل"] };
  function stChip(e) {
    var s = ESTATE[e.status] || ESTATE.pending;
    return '<span class="chip ' + s[0] + '">' + ic(s[1]) + " " + (e.status === "pending" && !e.sent ? "لم يُرسل بعد" : s[2]) + "</span>";
  }
  function newHtml(type) {
    if (!canAdd()) return emptyBox("lock", "ليست من صلاحياتك", "إضافة الأصناف لأمين المخزن أو المدير.");
    if (!full()) return emptyBox("info", "تحتاج تحديث منظومة الكمبيوتر", OLD_PC);
    v.form = { isNew: true, t: type, f: newDraft(type) };
    var mineNew = S().edits.filter(function (e) { return e.kind === "new" && (e.t === "stat" ? "stat" : "book") === type; }).slice(0, 5);
    return '<div class="form-page">' + formHtml() +
      (mineNew.length ? '<div class="sec"><b>آخر ما أضفته من هذا الهاتف</b></div><div class="list">' + mineNew.map(function (e) {
        return '<div class="li"><span class="lic">' + ic(type === "book" ? "book" : "box") + '</span><div class="m"><b class="one">' + esc(e.n) + "</b><span>" + D(String(e.at).slice(0, 16)) + '</span><span class="tags">' + stChip(e) + "</span></div></div>";
      }).join("") + "</div>" : "") +
      '<p class="note">سعر الشراء يُكتب من الكمبيوتر. الصنف يأخذ رمزه من المنظومة عند وصوله.</p></div>' +
      '<div class="savebar"><button class="btn p" data-a="newSave">' + ic("plus") + (type === "book" ? " أضف الكتاب" : " أضف الصنف") + "</button></div>";
  }
  function saveNew(force) {
    var fm = v.form;
    if (!fm || !fm.isNew) return;
    var f = fm.f, t = fm.t, book = t === "book", name = tr(f.n);
    if (!name) { fieldErr("n", book ? "اكتب اسم الكتاب." : "اكتب اسم الصنف."); return; }
    var bc = C.digits(tr(f.bc));
    var own = bc ? barcodeOwner(bc, "") : null;
    if (own) { fieldErr("bc", "هذا الباركود مستعمل في: " + own.n); return; }
    if (!force) {
      var nn = C.norm(name), dup = C.byType(t).filter(function (g) { return C.norm(g.n) === nn; })[0];
      if (dup) {
        sheet("<h2>" + ic("alert") + " يوجد " + (book ? "كتاب" : "صنف") + " بنفس الاسم</h2><p class=\"by\">«" + esc(dup.n) + "»" + (locTxt(dup) ? " · " + esc(locTxt(dup)) : "") + " — " + (dup.isNew ? "أضفته قبل قليل" : "الكمية " + Math.max(dup.q, 0)) + "</p>" +
          (dup.isNew ? "" : '<button class="btn p" data-a="open" data-v="' + esc(dup.key) + '">' + ic("edit") + " افتح الموجود</button>") +
          '<button class="btn o mt" data-a="newForce">أضفه على أي حال</button><button class="btn o mt" data-a="close">إلغاء</button>');
        return;
      }
    }
    var set = { n: name, a: tr(f.a), c: tr(f.c), bc: bc, p: Math.max(num(f.p), 0), pw: Math.max(num(f.pw), 0),
      q: Math.max(Math.floor(num(f.q)), 0), m: Math.max(Math.floor(num(f.m)), 0), nt: String(f.nt || "").trim(), sp: f.sp || "",
      dst: f.dst === "store" ? "store" : "shelf" };
    if (book) { set.d = tr(f.d); set.cf = tr(f.cf); set.l = tr(f.l).toUpperCase(); set.s = tr(f.s); }
    else { set.u = f.u || "قطعة"; set.loc = tr(f.loc); }
    C.newItem(t, set);
    /* ما يتكرّر بين صنف وآخر يبقى (المكان، التصنيف، دار النشر، المورّد)، والباقي يُفرَّغ */
    S().draft[t] = { n: "", a: "", d: f.d || "", sp: f.sp || "", c: f.c || "", cf: "", bc: "", p: "", pw: "", q: "1", m: "0",
      l: f.l || "", s: f.s || "", loc: f.loc || "", u: f.u || "قطعة", nt: "", dst: f.dst || "shelf" };
    C.save();
    closeSheet(true);
    render();
    window.scrollTo(0, 0);
    toast("أُضيف «" + name + "» — يُسجَّل في المنظومة عند وصوله.", "ok");
  }

  /* --- إضافة كمية: بضاعة وصلت لأصناف موجودة --- */
  function recvHtml() {
    if (!canAdd()) return emptyBox("lock", "ليست من صلاحياتك", "إدخال البضاعة لأمين المخزن أو المدير.");
    if (!full()) return emptyBox("info", "تحتاج تحديث منظومة الكمبيوتر", OLD_PC);
    var R = S().recv, L = C.lists();
    var pieces = R.lines.reduce(function (a, l) { return a + num(l.q); }, 0);
    var h = '<div class="card"><span class="hint">وين تروح البضاعة الواصلة؟</span><div class="seg mt6">' +
      '<button class="' + (R.dst !== "store" ? "on" : "") + '" data-a="rDst" data-v="shelf">' + ic("shelves") + " للرفوف</button>" +
      '<button class="' + (R.dst === "store" ? "on" : "") + '" data-a="rDst" data-v="store">' + ic("box") + " لغرفة الخزين</button></div>" +
      (L.sups.length ? '<label class="fld mt"><span>المورّد (اختياري)</span><select class="inp" data-r="sp"><option value="">— بدون مورّد —</option>' + L.sups.map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (R.sp === s.id ? " selected" : "") + ">" + esc(s.n) + "</option>";
      }).join("") + "</select></label>" : "") +
      '<label class="fld' + (L.sups.length ? "" : " mt") + ' last"><span>ملاحظة / رقم فاتورة المورّد (اختياري)</span><input class="inp" data-r="nt" value="' + esc(R.nt || "") + '" autocomplete="off"></label></div>' +
      (R.lines.length ? '<button class="scanbig sm" data-a="scan">' + ic("scan") + " امسح صنفاً آخر</button>"
        : '<button class="scanbig" data-a="scan"><span class="fr"></span>امسح الأصناف الواصلة واحداً وراء الآخر</button>') +
      '<div class="srch"><span>' + ic("search") + '</span><input id="rq" type="search" value="' + esc(v.rq) + '" placeholder="أو ابحث باسم الصنف…" autocomplete="off"></div>' +
      '<div id="rsug">' + recvSug() + "</div>";
    if (!R.lines.length) h += emptyBox("box", "لم تُضف أصناف بعد", "امسح باركود الصنف الواصل أو ابحث باسمه، ثم اكتب الكمية.");
    else {
      h += '<div class="sec"><b>الأصناف الواصلة</b><span class="mut">' + fmtN(R.lines.length) + " صنف · " + fmtN(pieces) + " قطعة</span></div>" +
        '<div class="list">' + R.lines.map(function (l, i) {
          var g = C.byKey(l.key), have = g ? Math.max(g.q, 0) : null;
          return '<div class="cl"><button class="x" data-a="rDel" data-v="' + i + '" aria-label="حذف">' + ic("x") + '</button><div class="m"><b>' + esc(l.n) + "</b><span>" +
            (have === null ? "" : "الموجود " + fmtN(have) + " ← يصير " + fmtN(have + num(l.q))) + "</span></div>" +
            '<div class="step"><button data-a="rQty" data-v="' + i + '|-1" aria-label="أنقص">' + ic("minus") + '</button><input data-ri="' + i + '" inputmode="numeric" dir="ltr" value="' + num(l.q) + '" aria-label="الكمية">' +
            '<button data-a="rQty" data-v="' + i + '|1" aria-label="زد">' + ic("plus") + "</button></div></div>";
        }).join("") + "</div>" +
        '<button class="btn o sm mt" data-a="rClear">' + ic("trash") + " مسح القائمة</button>";
    }
    h += '<p class="note">تُسجَّل في المنظومة «إدخال بضاعة» بسعر الشراء المسجّل فيها. الشراء بالآجل من المورّد يُسجَّل من الكمبيوتر.</p>' +
      '<div class="savebar"><button class="btn p" data-a="rSave"' + (R.lines.length ? "" : " disabled") + ">" + ic("check") + " حفظ — إضافة " + fmtN(pieces) + " قطعة " + (R.dst === "store" ? "للمخزن" : "للرفوف") + "</button></div>";
    return h;
  }
  function recvSug() {
    if (!String(v.rq).trim()) return "";
    var res = C.search(C.items(), v.rq, 8).slice(0, 8);
    if (!res.length) return '<p class="note">لا نتيجة — صنف غير مسجّل؟ أضفه من «صنف جديد».</p>';
    return '<div class="sugs">' + res.map(function (g) {
      return '<button class="li" data-a="rAdd" data-v="' + esc(g.key) + '"><span class="lic">' + ic(g.t === "book" ? "book" : "box") + '</span><span class="m"><b class="one">' + esc(g.n) + "</b><span>" +
        esc([g.a, locTxt(g)].filter(Boolean).join(" · ")) + " · الموجود " + fmtN(Math.max(g.q, 0)) + '</span></span><span class="add">' + ic("plus") + "</span></button>";
    }).join("") + "</div>";
  }
  function recvAdd(g) {
    if (g.isNew) { toast("«" + g.n + "» ينتظر تسجيله في المنظومة — أضف كميته بعدها.", "warn"); return false; }
    if (!g.ob && !g.code) { toast("هذا الصنف بلا باركود ولا رمز — أدخل كميته من الكمبيوتر.", "warn"); return false; }
    var R = S().recv, ln = R.lines.filter(function (l) { return l.key === g.key; })[0];
    if (ln) ln.q = num(ln.q) + 1;
    else { ln = { key: g.key, b: g.ob || "", k: g.code || "", n: g.n, q: 1 }; R.lines.unshift(ln); }
    C.save();
    v.rq = "";
    if (v.screen === "items" && iMode() === "qty") render();
    toast("«" + g.n + "» — " + fmtN(ln.q), "ok");
    return true;
  }
  function recvSave() {
    var R = S().recv;
    var e = C.receive(R.lines, { dst: R.dst, sp: R.sp, nt: R.nt });
    if (!e) { toast("أضف صنفاً واحداً على الأقل.", "warn"); return; }
    var n = e.lines.reduce(function (a, l) { return a + l.q; }, 0);
    S().recv = { dst: R.dst, sp: "", nt: "", lines: [] };
    C.save();
    render();
    window.scrollTo(0, 0);
    toast("أُرسلت " + fmtN(n) + " قطعة — تُضاف في المنظومة عند وصولها.", "ok");
  }
  /* إضافة كمية لصنف واحد من بطاقته */
  function addQtySheet() {
    var g = curItem();
    if (!g || g.isNew) return;
    if (!g.ob && !g.code) { toast("هذا الصنف بلا باركود ولا رمز — أدخل كميته من الكمبيوتر.", "warn"); return; }
    sheet("<h2>" + ic("plus") + " إضافة كمية</h2><p class=\"by\">" + esc(g.n) + " — الموجود الآن " + fmtN(Math.max(g.q, 0)) + "</p>" +
      '<div class="fld"><span>كم وصل؟</span><div class="qrow"><div class="step lg"><button type="button" id="aqMinus" data-a="aqStep" data-v="-1" aria-label="أنقص" disabled>' + ic("minus") + "</button>" +
      '<input id="aqN" inputmode="numeric" dir="ltr" value="1" aria-label="الكمية"><button type="button" data-a="aqStep" data-v="1" aria-label="زد">' + ic("plus") + "</button></div></div></div>" +
      '<div class="fld"><span>وين تروح؟</span><div class="seg" id="aqDst" data-dst="shelf"><button type="button" class="on" data-a="aqDst" data-v="shelf">' + ic("shelves") + " للرفوف</button>" +
      '<button type="button" data-a="aqDst" data-v="store">' + ic("box") + " لغرفة الخزين</button></div></div>" +
      '<button class="btn p" data-a="aqSave">' + ic("check") + ' أضف الكمية</button><button class="btn o mt" data-a="close">إلغاء</button>');
    var aq = el("aqN");
    if (aq) aq.addEventListener("input", function () { var m = el("aqMinus"); if (m) m.disabled = num(aq.value) <= 1; });
  }

  /* ---------- البيع ---------- */
  function pSell() {
    var h = bar("البيع");
    if (!C.canP("sell")) return h + '<div class="page">' + emptyBox("lock", "ليست من صلاحياتك", "البيع للكاشير أو المدير.") + "</div>";
    var cart = S().cart, cust = custOf();
    h += '<div class="page sell">' +
      (cart.length ? '<button class="scanbig sm" data-a="scan">' + ic("scan") + " امسح كتاباً آخر</button>"
        : '<button class="scanbig" data-a="scan"><span class="fr"></span>وجّه الكاميرا على الباركود</button>') +
      '<div class="srch"><span>' + ic("search") + '</span><input id="sq" type="search" value="' + esc(v.sq) + '" placeholder="بلا باركود؟ ابحث بالاسم…" autocomplete="off" enterkeyhint="search"></div>' +
      '<div id="ssug">' + sugHtml() + "</div>";
    if (!cart.length) h += emptyBox("cart", "السلة فارغة", "امسح باركود الكتاب أو ابحث باسمه.");
    else h += '<div class="list cartwrap">' + cart.map(function (l, i) {
      var g = C.byKey(l.key), lt = g ? locTxt(g) : "";
      return '<div class="cl' + (v.lastAdd === l.key ? " flash" : "") + '"><button class="x" data-a="rm" data-v="' + i + '" aria-label="حذف">' + ic("x") + '</button><div class="m"><b>' + esc(l.n) + "</b><span>" +
        money(l.p) + (lt ? " · " + esc(lt) : "") + (l.zp ? " · سعر جديد" : "") + '</span></div><div class="step"><button data-a="qty" data-v="' + i + '|-1" aria-label="أنقص">' + ic("minus") + '</button><b class="num">' + l.q +
        '</b><button data-a="qty" data-v="' + i + '|1" aria-label="زد">' + ic("plus") + "</button></div></div>";
    }).join("") + "</div>";
    v.lastAdd = "";
    h += "</div>";
    var sub = C.cartTotal(), disc = C.discNow(), n = cart.reduce(function (a, l) { return a + l.q; }, 0), meth = S().sell.method;
    if (meth === "credit" && !cust.length) meth = S().sell.method = "cash";
    h += '<div class="paybar"><div class="r"><span>' + fmtN(n) + " قطعة</span>" +
      (C.canP("discount") ? '<span>الخصم <input id="disc" inputmode="decimal" dir="ltr" value="' + esc(S().sell.disc) + '" placeholder="0"></span>' : "") + "</div>" +
      '<div class="tot"><span>الصافي</span><b class="num">' + money(sub - disc) + " " + esc(C.cur()) + "</b></div>" +
      '<div class="seg"><button class="' + (meth === "cash" ? "on" : "") + '" data-a="meth" data-v="cash">نقداً</button><button class="' + (meth === "card" ? "on" : "") + '" data-a="meth" data-v="card">بطاقة</button>' +
      (cust.length ? '<button class="' + (meth === "credit" ? "on" : "") + '" data-a="meth" data-v="credit">آجل</button>' : "") + "</div>" +
      (meth === "credit" ? '<select class="inp" id="cust"><option value="">— اختر الزبون —</option>' + cust.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (S().sell.cust === c.id ? " selected" : "") + ">" + esc(c.n) + (num(c.b) > 0 ? " (عليه " + money(c.b) + ")" : "") + "</option>";
      }).join("") + '</select><div class="r"><span>المدفوع الآن</span><input id="paid" inputmode="decimal" dir="ltr" value="' + esc(S().sell.paid) + '" placeholder="0"></div>' : "") +
      '<button class="btn p" data-a="checkout"' + (cart.length ? "" : " disabled") + ">" + ic("check") + " إتمام البيع</button></div>";
    return h;
  }
  function sugHtml() {
    if (!String(v.sq).trim()) return "";
    var res = C.search(C.items(), v.sq, 8).slice(0, 8);
    if (!res.length) return '<p class="note">لا نتيجة.</p>';
    return '<div class="sugs">' + res.map(function (g) {
      return '<button class="li" data-a="add" data-v="' + esc(g.key) + '"><span class="lic">' + ic(g.t === "book" ? "book" : "box") + '</span><span class="m"><b class="one">' + esc(g.n) + "</b><span>" +
        esc([g.a, locTxt(g)].filter(Boolean).join(" · ")) + (g.un ? "" : g.q <= 0 ? " · نفد" : " · " + fmtU(g.q, g)) + '</span></span><span class="v num">' + (g.p > 0 ? money(g.p) : "—") + "</span></button>";
    }).join("") + "</div>";
  }
  function addToCart(g) {
    if (g.isNew) { toast("«" + g.n + "» ينتظر تسجيله في المنظومة — يُباع بعدها.", "warn"); return; }
    if (!(g.p > 0)) { askPrice(g); return; }
    C.addToCart(g);
    if (g.q <= 0 && !g.un) toast("تنبيه: «" + g.n + "» غير متوفر حسب آخر تحديث.", "warn");
    v.sq = ""; v.lastAdd = g.key;
    buzz();
    if (v.screen !== "sell") go("sell"); else render();
  }
  function buzz() { try { if (C.pref("vib") && navigator.vibrate) navigator.vibrate(25); } catch (e) { } }
  function askPrice(g) {
    if (!C.canP(["price_zero", "price"])) { toast("«" + g.n + "» بلا سعر — تسعيره من صلاحية المدير.", "warn"); return; }
    sheet("<h2>" + ic("tag") + " كتاب بلا سعر</h2><p class=\"by\">" + esc(g.n) + "</p>" +
      '<label class="fld"><span>سعر البيع</span><input class="inp ltr" id="zpP" inputmode="decimal" placeholder="0"></label>' +
      '<p class="hint">يُحفظ السعر في المنظومة مع الفاتورة، فلا يُسأل عنه مرة ثانية.</p>' +
      '<button class="btn p mt" data-a="zpOk" data-v="' + esc(g.key) + '">' + ic("check") + " أضفه للسلة</button>" +
      '<button class="btn o mt" data-a="close">إلغاء</button>');
    setTimeout(function () { var i = el("zpP"); if (i) i.focus(); }, 120);
  }
  function checkout() {
    var r = C.checkout();
    if (r.err) { toast(r.err, "warn"); return; }
    var o = r.order;
    render();
    var d = document.createElement("div");
    d.className = "done";
    d.id = "donePop";
    d.innerHTML = '<div class="dc"><svg class="ck" viewBox="0 0 52 52"><circle cx="26" cy="26" r="23"/><path d="M15 27l7.5 7.5L37.5 19"/></svg>' +
      '<h3>تم البيع</h3><div class="amt num">' + money(o.total) + " " + esc(C.cur()) + "</div>" +
      '<p class="nt">تُرسل للمنظومة الآن، وتصلها فاتورة برقمها.</p>' +
      '<button class="btn p" data-a="rcPrint" data-v="' + esc(o.id) + '">' + ic("print") + " طباعة الإيصال</button>" +
      '<button class="btn o" data-a="rcSkip">' + (C.pref("autoPrint") ? "تم" : "بدون طباعة") + "</button></div>";
    document.body.appendChild(d);
    paintNav();
    if (C.pref("autoPrint")) setTimeout(function () { C.printReceipt(o); }, 500);
  }

  /* ---------- الجرد: خزانة ورف، ثم امسح كل نسخة ---------- */
  function pCount() {
    var h = bar("الجرد", { back: true });
    if (!C.canP(["items", "count"])) return h + '<div class="page">' + emptyBox("lock", "ليست من صلاحياتك", "الجرد لأمين المخزن أو المدير.") + "</div>";
    var L = S().loc, libs = C.lists().libs;
    if (!L.lib) L.lib = libs[0];
    var copies = L.list.reduce(function (a, x) { return a + x.c; }, 0);
    h += '<div class="page"><div class="card"><span class="hint">المكتبة (الخزانة)</span><div class="letters">' + libs.map(function (l) {
      return '<button class="' + (L.lib === l ? "on" : "") + '" data-a="lib" data-v="' + esc(l) + '">' + esc(l) + "</button>";
    }).join("") + '</div><div class="shrow"><b>الرف</b><div class="step"><button data-a="shelf" data-v="-1" aria-label="الرف السابق">' + ic("minus") +
      '</button><input id="shIn" inputmode="numeric" dir="ltr" value="' + esc(L.shelf) + '" aria-label="رقم الرف"><button data-a="shelf" data-v="1" aria-label="الرف التالي">' + ic("plus") + "</button></div></div></div>" +
      '<button class="scanbig" data-a="scan"><span class="fr"></span>امسح كل نسخة على هذا الرف</button>' +
      '<div class="srch"><span>' + ic("search") + '</span><input id="lq" type="search" value="' + esc(v.lq) + '" placeholder="بلا باركود؟ ابحث بالاسم…" autocomplete="off" enterkeyhint="search"></div>' +
      '<div id="lsug">' + countSug() + "</div>";
    if (!L.list.length) h += emptyBox("stack", "خزانة " + L.lib + " · رف " + L.shelf, "امسح كل نسخة على هذا الرف: كل مسحة نسخة. أو اضغط العدد لتكتبه.");
    else {
      h += '<div class="sec"><b>خزانة ' + esc(L.lib) + " · رف " + esc(L.shelf) + '</b><span class="mut">' + fmtN(L.list.length) + " صنف · " + fmtQ(copies) + "</span></div>" +
        '<div class="list">' + L.list.map(function (x) {
          return '<div class="li"><button class="count num' + (v.lastAdd === x.key ? " pop" : "") + '" data-a="cntSet" data-v="' + esc(x.key) + '" aria-label="اكتب العدد">' + x.c + '</button><div class="m"><b>' + esc(x.n) + "</b><span>" +
            (x.moved ? "صار مكانه: " + esc(L.lib) + " · رف " + esc(L.shelf) : "مكانه كما هو") + "</span></div>" +
            '<div class="step"><button data-a="locMinus" data-v="' + esc(x.key) + '" aria-label="أنقص">' + ic("minus") + '</button><button data-a="locPlus" data-v="' + esc(x.key) + '" aria-label="زد">' + ic("plus") + "</button></div></div>";
        }).join("") + "</div>" +
        '<button class="btn g mt" data-a="locNext">' + ic("check") + " انتهى هذا الرف — الرف التالي</button>";
    }
    v.lastAdd = "";
    h += '<p class="note">كل صنف يُرسل للمنظومة بعدده ومكانه. بلا إنترنت يُحفظ هنا ويُرسل وحده لاحقاً.</p></div>';
    return h;
  }
  function countSug() {
    if (!String(v.lq).trim()) return "";
    var res = C.search(C.items(), v.lq, 8).slice(0, 8);
    if (!res.length) return '<p class="note">لا نتيجة.</p>';
    return '<div class="sugs">' + res.map(function (g) {
      return '<button class="li" data-a="locAdd" data-v="' + esc(g.key) + '"><span class="lic">' + ic(g.t === "book" ? "book" : "box") + '</span><span class="m"><b class="one">' + esc(g.n) + "</b><span>" +
        esc(locTxt(g) || "بلا مكان") + '</span></span><span class="add">' + ic("plus") + "</span></button>";
    }).join("") + "</div>";
  }
  /* by: عدد النسخ المضافة (المسحة = 1). أول مرة: ما على الرف يصير هذا العدد، وما بعدها يزيد */
  function countAdd(g, by) {
    var L = S().loc;
    by = by || 1;
    if (!L.lib) { toast("اختر المكتبة أولاً.", "warn"); return false; }
    if (g.isNew) { toast("«" + g.n + "» ينتظر تسجيله في المنظومة — اجرده بعدها.", "warn"); return false; }
    if (!g.ob && !g.code) { toast("هذا الصنف بلا باركود ولا رمز — اجرده من الكمبيوتر.", "warn"); return false; }
    var ent = L.list.filter(function (x) { return x.key === g.key; })[0], set = {};
    if (!ent) {
      ent = { key: g.key, n: g.n, c: 0, moved: false };
      L.list.unshift(ent);
      if (g.t === "book") {
        if ((g.lib || "") !== L.lib) set.l = L.lib;
        if (String(g.shelf || "") !== String(L.shelf)) set.s = String(L.shelf);
      } else if ((g.loc || "") !== L.lib + " رف " + L.shelf) set.loc = L.lib + " رف " + L.shelf;
      ent.moved = Object.keys(set).length > 0;
      set.qd = by - Math.max(g.shelfQ, 0); set.cnt = 1;
    } else set.qd = by;
    ent.c += by;
    C.queueLoc(g, set);
    C.save();
    v.lastAdd = g.key;
    buzz();
    if (v.screen === "count") render();
    toast("«" + g.n + "» — " + fmtQ(ent.c), "ok");
    return true;
  }

  /* ---------- الفواتير: فواتير المحل (بصلاحيتها)، وما بيع من هذا الهاتف ---------- */
  function ordersList(list) {
    return '<div class="list">' + list.map(function (o) {
      var st = o.status === "done" ? '<span class="chip ok">' + ic("check") + " فاتورة " + o.inv + "</span>"
        : o.status === "fail" ? '<span class="chip b">لم تُسجَّل — أصناف غير موجودة في المنظومة</span>'
        : '<span class="chip w">' + ic("clock") + (o.sent ? " أُرسلت — تنتظر الكمبيوتر" : " لم تُرسل بعد") + "</span>";
      return '<button class="li" data-a="order" data-v="' + esc(o.id) + '"><span class="lic">' + ic("cart") + '</span><span class="m"><b class="one">' + esc(o.items.map(function (l) { return l.n; }).join("، ")) + "</b>" +
        "<span>" + D(String(o.at).slice(0, 16)) + " · " + esc(C.METHOD[o.method] || "") + (o.byName ? " · " + esc(o.byName) : "") + '</span><span class="tags">' + st + '</span></span><span class="v num">' + money(o.total) + "</span></button>";
    }).join("") + "</div>";
  }
  function pInvoices() {
    var m = C.mine(), d = m && m.dash, canShop = C.canP("invoices") && d && Array.isArray(d.recent);
    var tab = !canShop ? "phone" : v.invTab === "phone" ? "phone" : "shop", t = C.localToday();
    var h = bar("الفواتير", { back: true }) + '<div class="page">';
    if (canShop) h += '<div class="seg"><button class="' + (tab === "shop" ? "on" : "") + '" data-a="invTab" data-v="shop">فواتير المحل</button>' +
      '<button class="' + (tab === "phone" ? "on" : "") + '" data-a="invTab" data-v="phone">من هذا الهاتف <i class="num">' + fmtN(S().orders.length) + "</i></button></div>";
    if (tab === "shop") {
      var dt = dashToday();
      h += '<div class="stats"><div><b class="num">' + moneyBig(dt.v) + "</b><span>مبيعات اليوم (" + esc(C.cur()) + ')</span></div><div><b class="num">' + fmtN(dt.n) + "</b><span>فاتورة اليوم</span></div></div>";
      h += d.recent.length ? '<div class="sec"><b>آخر الفواتير</b><span class="mut">' + fmtN(d.recent.length) + '</span></div><div class="list stagger">' + d.recent.map(function (r) {
        var ret = r.k === "return";
        return '<button class="li" data-a="inv" data-v="' + esc(r.no) + '"><span class="lic' + (ret ? " bad" : "") + '">' + ic("doc") + '</span><span class="m"><b class="one">فاتورة ' + esc(r.no) + (ret ? " · إرجاع" : "") + "</b>" +
          "<span>" + esc(r.n || "") + '</span><span class="tags"><span class="chip g">' + (r.d === t ? "اليوم" : D(r.d || "")) + " " + D(r.at || "") + "</span>" +
          (C.METHOD[r.m] ? '<span class="chip' + (r.m === "credit" ? " w" : "") + '">' + esc(C.METHOD[r.m]) + "</span>" : "") +
          (r.ph ? '<span class="chip">' + ic("phone") + " من الهاتف</span>" : "") + '</span></span><span class="v num">' + money(r.t) + "</span></button>";
      }).join("") + "</div>" : emptyBox("doc", "لا فواتير بعد", "أول بيعة تظهر هنا.");
      h += '<p class="note">آخر الفواتير كما في المنظومة. السجل كله والتعديل والإرجاع من الكمبيوتر.</p>';
    } else {
      h += S().orders.length ? '<div class="sec"><b>ما بعته من هذا الهاتف</b></div>' + ordersList(S().orders) : emptyBox("cart", "لم تبع من هذا الهاتف بعد", "اضغط زر المسح في الأسفل، أو تبويب «البيع».");
      h += '<p class="note">المنظومة تسجّل الفاتورة حين تصلها (خلال دقيقة تقريباً)، وترجع رقمها هنا.</p>';
    }
    return h + "</div>";
  }
  function invSheet(no) {
    var d = (C.mine() || {}).dash, r = ((d && d.recent) || []).filter(function (x) { return String(x.no) === String(no); })[0];
    if (!r) return;
    var li = Array.isArray(r.li) ? r.li : null, c = esc(C.cur());
    sheet("<h2>" + ic("doc") + " فاتورة رقم " + esc(r.no) + (r.k === "return" ? " — إرجاع" : "") + "</h2>" +
      '<p class="by">' + D((r.d || "") + " " + (r.at || "")) + (C.METHOD[r.m] ? " · " + esc(C.METHOD[r.m]) : "") + (r.c ? " · " + esc(r.c) : "") + (r.by ? " · " + esc(r.by) : "") + (r.ph ? " · من الهاتف" : "") + "</p>" +
      (li ? '<div class="card inv"><table><thead><tr><th>الصنف</th><th>ك</th><th>المبلغ</th></tr></thead><tbody>' + li.map(function (l) {
        return "<tr><td>" + esc(l[0]) + '</td><td class="num">' + esc(l[1]) + '</td><td class="num">' + money(num(l[1]) * num(l[2])) + "</td></tr>";
      }).join("") + "</tbody></table>" + (num(r.q) > li.reduce(function (a, l) { return a + num(l[1]); }, 0) ? '<p class="hint">وأصناف أخرى — الفاتورة كاملة في المنظومة.</p>' : "") + "</div>"
        : '<div class="card"><p class="ntx">' + esc(r.n || "") + "</p></div>") +
      '<div class="card where mt">' + (r.ds ? '<div class="w"><span>الخصم</span><b class="num">' + money(r.ds) + "</b></div>" : "") +
      '<div class="w"><span>الإجمالي</span><b class="num big">' + money(r.t) + " " + c + "</b></div>" +
      (r.due ? '<div class="w"><span>الباقي (آجل)</span><b class="num bad">' + money(r.due) + " " + c + "</b></div>" : "") + "</div>" +
      '<button class="btn o mt" data-a="close">إغلاق</button>');
  }

  /* ---------- الآجل: سجل البيع بالآجل ---------- */
  function pCredit() {
    var cr = creditOf(), t = C.localToday(), h = bar("الآجل", { back: true }) + '<div class="page">';
    if (!cr) return h + emptyBox("info", "تحتاج تحديث منظومة الكمبيوتر", "سجل البيع بالآجل يصل من منظومة 4.2 فما فوق. ديون الزبائن تجدها في «الديون».") + "</div>";
    var td = cr.filter(function (x) { return x.d === t; });
    h += '<div class="stats"><div><b class="num">' + moneyBig(td.reduce(function (a, x) { return a + num(x.due); }, 0)) + "</b><span>آجل اليوم لم يُقبض</span></div>" +
      '<div><b class="num">' + fmtN(td.length) + "</b><span>بيع آجل اليوم</span></div></div>";
    if (C.canP("sell") && custOf().length) h += '<button class="btn g" data-a="sellCredit">' + ic("plus") + " بيع آجل جديد</button>";
    h += cr.length ? '<div class="sec"><b>آخر البيع بالآجل</b><span class="mut">' + fmtN(cr.length) + '</span></div><div class="list stagger">' + cr.map(function (x) {
      return '<button class="li" data-a="crd" data-v="' + esc(x.no) + '"><span class="lic warn">' + ic("clock") + '</span><span class="m"><b class="one">' + esc(x.c || "زبون") + "</b>" +
        "<span>فاتورة " + esc(x.no) + " · " + (x.d === t ? "اليوم" : D(x.d || "")) + " " + D(x.at || "") + '</span><span class="tags"><span class="chip g">المبلغ ' + money(x.t) + "</span>" +
        (num(x.pd) > 0 ? '<span class="chip ok">دفع ' + money(x.pd) + "</span>" : "") + '</span></span><span class="v"><b class="num' + (num(x.due) > 0 ? " bad" : "") + '">' + money(x.due) + "</b><small>الباقي</small></span></button>";
    }).join("") + "</div>" : emptyBox("clock", "لا بيع بالآجل", "أول فاتورة آجلة تظهر هنا.");
    h += '<p class="note">«الباقي» هو ما بقي وقت البيع. ما سدّده الزبون بعدها يظهر في رصيده في «الديون».</p></div>';
    return h;
  }
  function custSheet(id, title) {
    var c = custOf().filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var cr = (creditOf() || []).filter(function (x) { return x.cid === id; }).slice(0, 8), cu = esc(C.cur());
    sheet("<h2>" + ic("user") + " " + esc(c.n) + "</h2>" + (title ? '<p class="by">' + title + "</p>" : "") +
      '<div class="card where"><div class="w"><span>عليه الآن</span><b class="num big' + (num(c.b) > 0 ? " bad" : "") + '">' + money(c.b) + " " + cu + "</b></div>" +
      '<div class="w"><span>الهاتف</span><b class="num">' + esc(c.ph || "—") + "</b>" + (c.ph ? '<a class="chip" href="tel:' + esc(c.ph) + '">' + ic("phone") + " اتصل</a>" : "") + "</div></div>" +
      (cr.length ? '<div class="sec"><b>آخر فواتيره الآجلة</b></div><div class="list">' + cr.map(function (x) {
        return '<div class="li"><span class="lic warn">' + ic("doc") + '</span><div class="m"><b>فاتورة ' + esc(x.no) + "</b><span>" + D(x.d || "") + " · المبلغ " + money(x.t) + (num(x.pd) > 0 ? " · دفع " + money(x.pd) : "") + '</span></div><span class="v num">' + money(x.due) + "</span></div>";
      }).join("") + "</div>" : "") +
      (C.canP("sell") ? '<button class="btn g mt" data-a="sellTo" data-v="' + esc(c.id) + '">' + ic("cart") + " بيع آجل لهذا الزبون</button>" : "") +
      '<button class="btn o mt" data-a="close">إغلاق</button>');
  }

  /* ---------- الديون: ما لنا عند الزبائن، وما علينا للموردين ---------- */
  function debtRows(tab) {
    var list = (tab === "sup" ? (supOf() || []) : custOf()).slice().sort(function (a, b) { return num(b.b) - num(a.b); });
    var q = C.norm(v.dq);
    if (q) list = list.filter(function (c) { return C.norm(c.n).indexOf(q) >= 0 || String(c.ph || "").indexOf(q) >= 0; });
    if (!list.length) return emptyBox(tab === "sup" ? "truck" : "users", q ? "لا نتيجة" : tab === "sup" ? "لا موردين" : "لا زبائن", q ? "جرّب اسماً آخر." : "يُضافون من المنظومة على الكمبيوتر.");
    return '<div class="list">' + list.map(function (c) {
      var owe = num(c.b) > 0;
      return '<div class="li"><button class="lmain" data-a="' + (tab === "sup" ? "sup" : "cust") + '" data-v="' + esc(c.id) + '"><span class="lic av">' + esc(initial(c.n)) + '</span><span class="m"><b class="one">' + esc(c.n) + "</b><span>" + esc(c.ph || "بدون رقم") + "</span></span>" +
        (owe ? '<span class="v num' + (tab === "sup" ? " bad" : "") + '">' + money(c.b) + "</span>" : '<span class="chip ok">خالص</span>') + "</button>" +
        (c.ph ? '<a class="call" href="tel:' + esc(c.ph) + '" aria-label="اتصل">' + ic("phone") + "</a>" : "") + "</div>";
    }).join("") + "</div>";
  }
  function pDebts() {
    var cust = custOf(), sup = C.canP("debts") ? supOf() : null, tab = v.debtTab === "sup" && sup ? "sup" : "cust";
    var list = tab === "sup" ? sup : cust, owing = list.filter(function (c) { return num(c.b) > 0; });
    var h = bar("الديون", { back: true }) + '<div class="page">';
    if (sup) h += '<div class="seg"><button class="' + (tab === "cust" ? "on" : "") + '" data-a="debtTab" data-v="cust">لنا عند الزبائن</button>' +
      '<button class="' + (tab === "sup" ? "on" : "") + '" data-a="debtTab" data-v="sup">علينا للموردين</button></div>';
    h += '<div class="stats"><div><b class="num' + (tab === "sup" ? " bad" : "") + '">' + moneyBig(owing.reduce(function (a, c) { return a + num(c.b); }, 0)) + "</b><span>" +
      (tab === "sup" ? "إجمالي ما علينا" : "إجمالي ما لنا") + " (" + esc(C.cur()) + ')</span></div><div><b class="num">' + fmtN(owing.length) + "</b><span>" + (tab === "sup" ? "مورّد علينا له" : "زبون عليه دين") + "</span></div></div>";
    if (list.length > 6) h += '<div class="srch"><span>' + ic("search") + '</span><input id="dq" type="search" value="' + esc(v.dq) + '" placeholder="ابحث بالاسم أو الرقم…" autocomplete="off"></div>';
    h += '<div id="dres" class="mt">' + debtRows(tab) + "</div>" +
      '<p class="note">' + (tab === "sup" ? "ما علينا للموردين كما في المنظومة. التسديد يُسجَّل من الكمبيوتر." : "أرصدة الزبائن كما في المنظومة. تسجيل التسديد من الكمبيوتر.") + "</p></div>";
    return h;
  }
  function supSheet(id) {
    var s = (supOf() || []).filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    sheet("<h2>" + ic("truck") + " " + esc(s.n) + '</h2><div class="card where"><div class="w"><span>علينا له الآن</span><b class="num big' + (num(s.b) > 0 ? " bad" : "") + '">' + money(s.b) + " " + esc(C.cur()) + "</b></div>" +
      '<div class="w"><span>الهاتف</span><b class="num">' + esc(s.ph || "—") + "</b>" + (s.ph ? '<a class="chip" href="tel:' + esc(s.ph) + '">' + ic("phone") + " اتصل</a>" : "") + "</div></div>" +
      '<p class="hint mt">كشف حسابه وتسديده من «الموردون ودور النشر» في المنظومة.</p><button class="btn o mt" data-a="close">إغلاق</button>');
  }

  /* ---------- التنبيهات ---------- */
  function pAlerts() {
    var all = alertsList(), out = all.filter(function (g) { return g.q <= 0; }), low = all.filter(function (g) { return g.q > 0; });
    var tab = v.alTab === "out" || v.alTab === "low" ? v.alTab : "all", list = tab === "out" ? out : tab === "low" ? low : all;
    function sb(k, t, n) { return '<button class="' + (tab === k ? "on" : "") + '" data-a="alTab" data-v="' + k + '">' + t + ' <i class="num">' + fmtN(n) + "</i></button>"; }
    var shown = list.slice(0, v.shown);
    return bar("التنبيهات", { back: true }) + '<div class="page"><div class="seg">' + sb("all", "الكل", all.length) + sb("out", "نفد", out.length) + sb("low", "قارب", low.length) + "</div>" +
      (list.length ? '<div class="rows">' + shown.map(resHtml).join("") + "</div>" + moreHtml(list.length, shown.length)
        : emptyBox("check", "لا نواقص", "كل الأصناف فوق حد التنبيه.")) +
      '<p class="note">«قارب» = وصل حد التنبيه المكتوب في بطاقته. «نفد» = انتهى وله حد تنبيه، أو بيع خلال آخر شهر.</p></div>';
  }

  /* ---------- الإعدادات ---------- */
  var PICKS = {
    font: { t: "حجم الخط", o: [["s", "صغير"], ["m", "عادي"], ["l", "كبير"], ["xl", "أكبر"]] },
    dark: { t: "المظهر", o: [["light", "فاتح"], ["dark", "داكن"], ["auto", "حسب الهاتف"]] },
    payDef: { t: "طريقة الدفع الأولى", o: [["cash", "نقداً"], ["card", "بطاقة"]] },
    lockMin: { t: "القفل بعد الغياب عن التطبيق", o: [[1, "دقيقة"], [2, "دقيقتان"], [5, "5 دقائق"], [15, "ربع ساعة"], [30, "نصف ساعة"]] },
    every: { t: "التحديث التلقائي", o: [[0, "الأسرع — كل دقيقة ونصف تقريباً"], [300, "كل 5 دقائق"], [900, "كل ربع ساعة"], [-1, "يدوي فقط — بزر التحديث"]] },
    view: { t: "العرض في «إضافة وتعديل»", o: [["list", "قائمة"], ["cards", "بطاقات"], ["map", "الرفوف"]] }
  };
  function pickLabel(k) {
    var cur = C.pref(k), o = PICKS[k].o.filter(function (x) { return x[0] === cur; })[0];
    return o ? o[1].split(" — ")[0] : "";
  }
  function sRow(inner, a, val, cls) {
    return '<button class="srow' + (cls ? " " + cls : "") + '" data-a="' + a + '"' + (val !== undefined ? ' data-v="' + esc(val) + '"' : "") + ">" + inner + "</button>";
  }
  function sBody(icon, t, sub) { return '<span class="sic">' + ic(icon) + '</span><span class="m"><b>' + t + "</b>" + (sub ? "<span>" + sub + "</span>" : "") + "</span>"; }
  function sPick(k, icon, sub) { return sRow(sBody(icon, PICKS[k].t, sub) + '<span class="val">' + esc(pickLabel(k)) + "</span>" + ic("chev", "chv"), "pPick", k); }
  function sAct(a, icon, t, sub, cls) { return sRow(sBody(icon, t, sub) + ic("chev", "chv"), a, undefined, cls); }
  function sTog(k, icon, t, sub) {
    return '<label class="srow">' + sBody(icon, t, sub) + '<input type="checkbox" class="sw" data-p="' + k + '"' + (C.pref(k) ? " checked" : "") + "></label>";
  }
  function sSec(t) { return '<div class="ssec">' + t + "</div>"; }
  function pSettings() {
    var w = C.who(), sh = C.shop(), b = C.branchId(), url = String(S().cfg.url || ""), inf = C.info(), staff = !!C.staffInfo();
    var bioId = staff ? w.id : "", pend = C.pending(), bad = C.failed();
    var h = bar("الإعدادات") + '<div class="page">' +
      '<div class="prof"><span class="av">' + esc(initial(w.n)) + '</span><div class="m"><b>' + esc(w.n) + "</b><span>" + esc([w.role, S().phone.name].filter(Boolean).join(" · ")) + "</span></div>" +
      '<button class="chip lg" data-a="logout">' + ic("out") + " خروج</button></div>";

    h += sSec("الحساب والأمان") + '<div class="list set">' +
      sRow(sBody(C.IOS ? "face" : "finger", "الدخول ب" + C.bioWord(), C.bioRec(bioId) ? "مفعّل على هذا الهاتف" : "بدل " + (staff ? "كلمة السر" : "الرمز") + " كل مرة") +
        '<span class="sw fake' + (C.bioRec(bioId) ? " on" : "") + '"></span>', "bioToggle") +
      sPick("lockMin", "lock", "يُطلب الدخول من جديد بعدها") +
      (staff ? "" : sAct("pinChange", "key", "تغيير رمز الهاتف", "الرمز الذي تدخل به")) + "</div>";

    h += sSec("المظهر") + '<div class="list set">' + sPick("dark", "moon") + sPick("font", "text") +
      sTog("anim", "spark", "الحركات", "انتقالات الشاشات وحركة الأزرار") + "</div>";

    h += sSec("البيع والمسح") + '<div class="list set">' + sPick("payDef", "wallet", "تُختار مع كل فاتورة جديدة") +
      sTog("cont", "scan", "المسح المتواصل في البيع", "الكاميرا تفتح وحدها بعد كل كتاب") +
      sTog("autoPrint", "print", "اطبع الإيصال بعد كل بيع", "تفتح نافذة الطباعة وحدها") +
      (ANDROID ? "" : sTog("beep", "sound", "صوت عند المسح")) +
      sTog("vib", "vibrate", "اهتزاز عند المسح والإضافة") +
      sAct("rcTest", "print", "تجربة طباعة إيصال", "تأكد من الطابعة قبل أول بيع") + "</div>";

    h += sSec("إضافة وتعديل") + '<div class="list set">' + sPick("view", "list", "يُتذكّر آخر عرض اخترته") + "</div>";

    h += sSec("التحديث والإرسال") + '<div class="list set">' +
      sAct("refresh", "refresh", "تحديث الآن", (S().at ? "آخر تحديث " + esc(C.ago(S().at)) : "لم يُحدَّث بعد") + " · " + fmtN(inf.n) + " صنف") +
      sPick("every", "clock", "والتطبيق مفتوح") +
      sRow(sBody("send", "سجل ما أرسله هذا الهاتف", bad ? fmtN(bad) + " لم تُسجَّل" + (pend ? " · " + fmtN(pend) + " تنتظر" : "") : pend ? fmtN(pend) + " تنتظر الوصول للمنظومة" : "كل شيء وصل المنظومة") +
        (bad ? '<span class="badge bad">' + fmtN(bad) + "</span>" : pend ? '<span class="badge">' + fmtN(pend) + "</span>" : "") + ic("chev", "chv"), "open2", "outbox") +
      (inf.src === "cat" ? sAct("recat", "book", "تنزيل قائمة الكتب من جديد", "إن شككت أن شيئاً ناقص · قائمة " + D(String(inf.at).slice(0, 16))) : "") + "</div>";

    if (ANDROID) {
      var ns = "on";
      try { ns = AndroidApp.notifyStatus ? AndroidApp.notifyStatus() : "on"; } catch (e) { }
      h += sSec("الإشعارات") + '<div class="list set">' +
        sAct("nAsk", "bell", ns === "on" ? "الإشعارات مسموحة" : "اسمح بالإشعارات", ns === "on" ? "اضغط لتجربة إشعار" : ns === "ask" ? "اضغط ليسألك الهاتف" : "ممنوعة من إعدادات الهاتف — اضغط لفتحها", ns === "on" ? "" : "warn") +
        sTog("nStock", "alert", "نفاد الأصناف", "صنف نفد أو قارب حد التنبيه") +
        sTog("nRestock", "box", "املأ الرفوف", "صنف خلص من الرف وله نسخ في الخزين") +
        sTog("nDaily", "doc", "ملخّص اليوم", "مبيعات اليوم بعد الثامنة مساءً") +
        sTog("nSync", "refresh", "تأخّر التحديث", "المنظومة لم ترفع بياناتها منذ ساعات") +
        sAct("nBattery", "battery", "العمل في الخلفية", "استثنِ التطبيق من توفير البطارية لتصل الإشعارات") + "</div>";
    }

    h += sSec("هذا الهاتف والربط") + '<div class="list set"><label class="srow in">' + sBody("phone", "اسم هذا الهاتف", "يظهر في المنظومة مع كل بيع وتعديل") +
      '<input class="inp sm" id="phName" value="' + esc(S().phone.name) + '" autocomplete="off"></label>' +
      '<div class="srow info">' + sBody("store", "الفرع", esc(sh.name)) + '<span class="val">' + esc(b === "tripoli" ? "طرابلس" : b === "misrata" ? "مصراتة" : b || "—") + "</span></div>" +
      '<div class="srow info">' + sBody("link", "خادم الربط", '<span class="num">' + esc(url.replace(/^https?:\/\//, "").slice(0, 34)) + "</span>") + "</div>" +
      '<div class="srow info">' + sBody("gear", "منظومة الكمبيوتر", full() ? "تقبل كل ميزات الهاتف" : "قديمة — حدّثها إلى 4.2 للتعديل الكامل وإضافة الكمية والصنف الجديد") +
      '<span class="chip ' + (full() ? "ok" : "w") + '">' + (full() ? "محدّثة" : "تحتاج تحديثاً") + "</span></div>" +
      sAct("unlink", "x", "فك الربط", "يُطلب العنوان وكلمة السر من جديد", "danger") + "</div>";

    h += sSec("حول التطبيق") + '<div class="list set">' + sAct("whatsNew", "spark", "ما الجديد في الإصدار " + VERSION) +
      '<div class="srow info">' + sBody("info", "الإصدار", esc(sh.name) + (sh.city ? " — فرع " + esc(sh.city) : "")) + '<span class="val num">' + VERSION + (ANDROID && AndroidApp.version ? " (" + esc(AndroidApp.version()) + ")" : "") + "</span></div></div>" +
      '<p class="note">الطباعة: أندرويد عبر خدمة الطباعة في الهاتف (طابعات الإيصالات بالبلوتوث لها تطبيق خدمة)، والآيفون عبر AirPrint.</p></div>';
    return h;
  }
  function pickSheet(k) {
    var p = PICKS[k], cur = C.pref(k);
    if (!p) return;
    sheet("<h2>" + esc(p.t) + '</h2><div class="list opts">' + p.o.map(function (o) {
      return '<button class="li' + (o[0] === cur ? " on" : "") + '" data-a="pSet" data-v="' + k + "|" + esc(o[0]) + '"><span class="m"><b>' + esc(o[1]) + '</b></span><span class="tick">' + ic("check") + "</span></button>";
    }).join("") + '</div><button class="btn o mt" data-a="close">إغلاق</button>');
  }
  var NEWS = [
    ["edit", "تبويب «إضافة وتعديل»", "اختر أي كتاب أو صنف وعدّل كل بياناته كما في الكمبيوتر، أو أضف كمية، أو أضف صنفاً جديداً."],
    ["shelves", "ثلاثة عروض", "قائمة، بطاقات، وخريطة الرفوف — والكتب منفصلة عن القرطاسية."],
    ["home", "الرئيسية قائمة", "الجرد، الفواتير، الآجل، الديون، والتنبيهات."],
    ["refresh", "آخر تحديث أعلى كل شاشة", "ومعه زر التحديث."],
    ["gear", "إعدادات أكثر", "المظهر الداكن، حجم الخط، القفل، المسح المتواصل، الطباعة التلقائية، والإشعارات."]
  ];

  /* ---------- سجل ما أرسله هذا الهاتف ---------- */
  var FNAME = { n: "الاسم", a: "المؤلف/الماركة", d: "دار النشر", sp: "المورّد", c: "التصنيف", cf: "التخصص الدقيق", bc: "الباركود", p: "السعر", pw: "سعر الجملة",
    m: "حد التنبيه", l: "المكتبة", s: "الرف", loc: "المكان", u: "الوحدة", nt: "الملاحظة", st: "غرفة الخزين" };
  function editWhat(e) {
    if (e.kind === "new") return (e.t === "stat" ? "صنف قرطاسية جديد" : "كتاب جديد") + " · الكمية " + num((e.set || {}).q);
    if (e.kind === "recv") return fmtN((e.lines || []).reduce(function (a, l) { return a + num(l.q); }, 0)) + " قطعة " + (e.dst === "store" ? "لغرفة الخزين" : "للرفوف");
    var f = e.set || {}, w = Object.keys(f).filter(function (k) { return FNAME[k]; }).map(function (k) { return FNAME[k]; });
    if (f.qd) w.push("الكمية " + (num(f.qd) > 0 ? "+" : "") + num(f.qd));
    return w.join("، ") || "جرد";
  }
  function pOutbox() {
    var rows = S().orders.map(function (o) { return { o: o, at: o.at, st: o.status }; }).concat(S().edits.map(function (e) { return { e: e, at: e.at, st: e.status }; }));
    rows.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
    var tab = v.outTab === "wait" || v.outTab === "bad" ? v.outTab : "all";
    var wait = rows.filter(function (r) { return r.st === "pending"; }), bad = rows.filter(function (r) { return r.st === "fail" || r.st === "part"; });
    var list = tab === "wait" ? wait : tab === "bad" ? bad : rows;
    function sb(k, t, n) { return '<button class="' + (tab === k ? "on" : "") + '" data-a="outTab" data-v="' + k + '">' + t + ' <i class="num">' + fmtN(n) + "</i></button>"; }
    var h = bar("سجل الإرسال", { back: true }) + '<div class="page"><div class="seg">' + sb("all", "الكل", rows.length) + sb("wait", "ينتظر", wait.length) + sb("bad", "لم يُسجَّل", bad.length) + "</div>";
    if (wait.length) h += '<button class="btn g mt" data-a="resend">' + ic("send") + " أعد الإرسال الآن</button>";
    h += list.length ? '<div class="list mt">' + list.slice(0, 150).map(function (r) {
      if (r.o) {
        var o = r.o, st = o.status === "done" ? '<span class="chip ok">' + ic("check") + " فاتورة " + o.inv + "</span>"
          : o.status === "fail" ? '<span class="chip b">' + ic("x") + " لم تُسجَّل — أصناف غير موجودة</span>"
          : '<span class="chip w">' + ic("clock") + (o.sent ? " تنتظر الكمبيوتر" : " لم تُرسل بعد") + "</span>";
        return '<button class="li" data-a="order" data-v="' + esc(o.id) + '"><span class="lic">' + ic("cart") + '</span><span class="m"><b class="one">بيع: ' + esc(o.items.map(function (l) { return l.n; }).join("، ")) + "</b><span>" +
          D(String(o.at).slice(0, 16)) + " · " + money(o.total) + " " + esc(C.cur()) + '</span><span class="tags">' + st + "</span></span></button>";
      }
      var e = r.e, icn = e.kind === "new" ? "plus" : e.kind === "recv" ? "box" : e.loc ? "stack" : "edit";
      return '<div class="li"><span class="lic">' + ic(icn) + '</span><div class="m"><b class="one">' + (e.kind === "new" ? "جديد: " : e.kind === "recv" ? "إضافة كمية: " : e.loc ? "جرد: " : "تعديل: ") + esc(e.n || "") + "</b><span>" +
        D(String(e.at).slice(0, 16)) + " · " + esc(editWhat(e)) + '</span><span class="tags">' + stChip(e) + "</span></div>" +
        (e.status === "pending" && !e.sent ? '<button class="chip b" data-a="eDrop" data-v="' + esc(e.id) + '">إلغاء</button>' : "") + "</div>";
    }).join("") + "</div>" : emptyBox("send", tab === "all" ? "لم ترسل شيئاً بعد" : "لا شيء هنا", tab === "all" ? "كل بيع وتعديل من هذا الهاتف يظهر هنا بحالته." : "");
    h += '<p class="note">«لم يُسجَّل»: رفضته المنظومة (صنف غير موجود، باركود مستعمل، أو ليست من صلاحياتك). «سُجّل بعضه»: طُبّق ما أمكن — راجعه في المنظومة.</p></div>';
    return h;
  }

  /* ---------- بعد الرسم: الحقول ---------- */
  var tQ = null, tSave = null;
  function saveSoon() { clearTimeout(tSave); tSave = setTimeout(function () { C.save(); }, 400); }
  function typing(id, ms, fn) {
    var e = el(id);
    if (e) e.addEventListener("input", function () { var val = this.value; clearTimeout(tQ); tQ = setTimeout(function () { fn(val); }, ms); });
    return e;
  }
  /* Enter في خانة البحث: قارئ باركود بالبلوتوث يكتب الرمز ثم Enter — يُعامل كمسحة */
  function onEnter(id, fn) {
    var e = el(id);
    if (e) e.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); clearTimeout(tQ); fn(this.value, this); } });
  }
  function exactCode(val) {
    var c = C.digits(String(val || "")).trim();
    return c.length >= 3 && !/\s/.test(c) ? C.byCode(c) : null;
  }
  function widths() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-w]"), function (e) { e.style.width = e.getAttribute("data-w") + "%"; });
  }
  function paintItems() {
    var r = el("ires");
    if (!r) { render(); return; }
    r.innerHTML = viewBody(iType());
    widths(); watchMore();
  }
  function reduced() { try { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function countUp() {
    var e = el("heroNum");
    if (!e || !C.pref("anim") || reduced() || !window.requestAnimationFrame) return;
    var to = num(e.getAttribute("data-n")), int = e.hasAttribute("data-int"), t0 = 0;
    if (!(to > 0)) return;
    requestAnimationFrame(function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / 520), k = 1 - Math.pow(1 - p, 3);
      if (el("heroNum") !== e) return;
      e.textContent = int ? fmtN(Math.round(to * k)) : moneyBig(to * k);
      if (p < 1) requestAnimationFrame(step);
    });
  }
  function after() {
    var view = el("view"), fresh = view && view.classList.contains("enter");
    typing("iq", 160, function (val) { v.q = val; v.shown = 40; paintItems(); var c = el("iqClr"); if (c) c.classList.toggle("hidden", !val); });
    onEnter("iq", function (val, inp) { var g = exactCode(val); if (g) { v.q = ""; inp.value = ""; openItem(g.key); } else { v.q = val; v.shown = 40; paintItems(); } });
    typing("sq", 140, function (val) { v.sq = val; var s = el("ssug"); if (s) s.innerHTML = sugHtml(); });
    onEnter("sq", function (val) {
      var g = exactCode(val) || (function () { var r = C.search(C.items(), val, 2); return r.length === 1 ? r[0] : null; })();
      if (g) addToCart(g); else { v.sq = val; var s = el("ssug"); if (s) s.innerHTML = sugHtml(); }
    });
    typing("lq", 140, function (val) { v.lq = val; var s = el("lsug"); if (s) s.innerHTML = countSug(); });
    onEnter("lq", function (val) { var g = exactCode(val); if (g) { v.lq = ""; countAdd(g); } });
    typing("rq", 140, function (val) { v.rq = val; var s = el("rsug"); if (s) s.innerHTML = recvSug(); });
    onEnter("rq", function (val) { var g = exactCode(val); if (g) recvAdd(g); });
    typing("dq", 140, function (val) { v.dq = val; var s = el("dres"); if (s) s.innerHTML = debtRows(v.debtTab === "sup" && supOf() ? "sup" : "cust"); });
    var disc = el("disc");
    if (disc) disc.addEventListener("change", function () { S().sell.disc = this.value; C.save(); render(); });
    var cust = el("cust");
    if (cust) cust.addEventListener("change", function () { S().sell.cust = this.value; C.save(); });
    var paid = el("paid");
    if (paid) paid.addEventListener("change", function () { S().sell.paid = this.value; C.save(); });
    var sh = el("shIn");
    if (sh) sh.addEventListener("change", function () { S().loc.shelf = String(Math.max(1, Math.floor(num(this.value)) || 1)); S().loc.list = []; C.save(); render(); });
    var pn = el("phName");
    if (pn) pn.addEventListener("change", function () { S().phone.name = this.value.trim() || "هاتف"; S().pushedEmpty = false; C.save(); C.push(); toast("حُفظ الاسم."); });
    widths();
    watchMore();
    qdHint();
    if (fresh && v.screen === "home") countUp();
  }
  /* «عرض المزيد» وحده حين تصله بالتمرير */
  var moreObs = null;
  function watchMore() {
    var b = el("moreBtn");
    if (moreObs) { moreObs.disconnect(); moreObs = null; }
    if (!b || typeof IntersectionObserver === "undefined") return;
    moreObs = new IntersectionObserver(function (ents) { if (ents[0] && ents[0].isIntersecting) act("more"); }, { rootMargin: "300px" });
    moreObs.observe(b);
  }
  /* خانات النماذج: ما يُكتب يُحفظ في النموذج فلا يضيع مع إعادة الرسم */
  function onField(e) {
    var t = e.target, k;
    if (!t || !t.getAttribute) return;
    if ((k = t.getAttribute("data-f")) && v.form) {
      v.form.f[k] = t.value;
      if (k === "q") qdHint();
      var fe = el("fe_" + k);
      if (fe && fe.textContent) fe.textContent = "";
      if (v.form.isNew) saveSoon();
      return;
    }
    if ((k = t.getAttribute("data-r"))) { S().recv[k] = t.value; saveSoon(); return; }
    if (t.hasAttribute("data-ri") && e.type === "change") {
      var ln = S().recv.lines[num(t.getAttribute("data-ri"))];
      if (ln) { ln.q = Math.max(1, Math.floor(num(t.value)) || 1); C.save(); render(); }
      return;
    }
    if ((k = t.getAttribute("data-p")) && e.type === "change") {
      C.setPref(k, !!t.checked);
      if (/^n[A-Z]/.test(k)) tellAndroid();
    }
  }

  /* ---------- النافذة السفلية ---------- */
  function sheet(h) {
    var s = el("sheet");
    s.classList.remove("out");
    s.innerHTML = '<div class="in"><div class="grab"></div>' + h + "</div>";
    s.hidden = false;
  }
  function closeSheet(now) {
    var s = el("sheet");
    if (!s || s.hidden) return;
    function gone() { s.hidden = true; s.innerHTML = ""; s.classList.remove("out"); }
    if (now || !C.S || !C.pref("anim") || reduced()) { gone(); return; }
    s.classList.add("out");
    setTimeout(function () { if (s.classList.contains("out")) gone(); }, 170);
  }
  /* قائمة اختيار فيها بحث: التصنيفات ودور النشر (مئات في طرابلس)، واسم جديد يُكتب */
  var ch = null;
  function chooser(title, opts, counts, target, free) {
    ch = { opts: opts, counts: counts || {}, target: target, free: !!free };
    sheet("<h2>" + esc(title) + '</h2><div class="srch flat"><span>' + ic("search") + '</span><input id="chQ" type="search" placeholder="' + (free ? "اكتب للبحث، أو اكتب اسماً جديداً…" : "اكتب للبحث…") + '" autocomplete="off"></div>' +
      '<div id="chRes" class="list opts mt">' + chooserRows("") + '</div><button class="btn o mt" data-a="close">إغلاق</button>');
    var q = el("chQ");
    if (q) q.addEventListener("input", function () { var r = el("chRes"); if (r) r.innerHTML = chooserRows(this.value); });
  }
  function chooserRows(q) {
    var nq = C.norm(q), list = ch.opts.filter(function (o) { return !nq || C.norm(o).indexOf(nq) >= 0; });
    /* الاسم الجديد بعد الموجود: من يكتب «دار المع» يقصد غالباً «دار المعرفة»، لا اسماً جديداً ناقصاً */
    var fresh = ch.free && tr(q) && !list.some(function (o) { return C.norm(o) === nq; }), max = fresh ? 30 : 80;
    var h = list.slice(0, max).map(function (o) {
      return '<button class="li" data-a="chPick" data-v="' + esc(o) + '"><span class="m"><b>' + esc(o) + "</b></span>" + (ch.counts[o] ? '<span class="mut num">' + fmtN(ch.counts[o]) + "</span>" : "") + "</button>";
    }).join("");
    if (fresh) h += '<button class="li new" data-a="chPick" data-v="' + esc(tr(q)) + '"><span class="lic">' + ic("plus") + '</span><span class="m"><b>استعمل «' + esc(tr(q)) + "»</b><span>" + (list.length ? "ليس في القائمة — اسم جديد" : "اسم جديد") + "</span></span></button>";
    if (!h) h = '<p class="note">لا نتيجة.</p>';
    if (list.length > max) h += '<p class="note">' + fmtN(list.length - max) + " أخرى — اكتب للبحث.</p>";
    return h;
  }

  /* ---------- المسح ----------
     الكاميرا (تطبيق أندرويد بكاميرته، والآيفون داخل الصفحة) أو قارئ بلوتوث يكتب في خانة البحث.
     الرمز يذهب لما أنت فيه: البيع ← السلة، الجرد ← العدّ، إضافة كمية ← سطر، النموذج ← خانة
     الباركود، وغيرها ← بطاقة الصنف */
  var camAsked = false;
  function scan(field) {
    camAsked = true;
    v.scanField = field || "";
    if (ANDROID && AndroidApp.scan) { try { AndroidApp.scan(); return; } catch (e) { } }
    if (window.WebScan) {
      if (WebScan.set) WebScan.set({ beep: !!C.pref("beep"), vib: !!C.pref("vib") });
      /* أُغلقت بلا قراءة: الرمز القادم (قارئ بلوتوث مثلاً) ليس من الكاميرا، فلا تُفتح وحدها بعده */
      window.WebScan.open(function (code) { onScan(code); }, function () { camAsked = false; v.scanField = ""; });
    } else toast("المسح بالكاميرا غير متاح هنا — اكتب الاسم أو الباركود.", "warn");
  }
  function again() { if (Date.now() - lastLoc > 600) { lastLoc = Date.now(); setTimeout(function () { scan(); }, 700); } }
  function onScan(code) {
    code = C.digits(String(code || "")).trim();
    var fromCam = camAsked, field = v.scanField;
    camAsked = false; v.scanField = "";
    if (!code || gate()) return;
    var newMode = v.screen === "items" && iMode() === "new", fm = v.form;
    /* في النموذج (تعديل، أو صنف جديد): الرمز يملأ خانة الباركود */
    if (fm && ((v.screen === "edit" && !fm.isNew) || (newMode && fm.isNew && canAdd() && full()))) {
      var own = barcodeOwner(code, fm.isNew ? "" : fm.key);
      fm.f.bc = code;
      if (fm.isNew) C.save();
      render();
      if (own) fieldErr("bc", "هذا الباركود مستعمل في: " + own.n);
      else toast("الباركود: " + code, "ok");
      return;
    }
    var g = C.byCode(code);
    if (v.screen === "count") {
      if (!g) { toast("لم يُعثر على الباركود " + code + ".", "warn"); return; }
      if (countAdd(g) && fromCam) again();                 // الرف كله: المسح التالي وحده
      return;
    }
    if (v.screen === "sell") {
      if (!g) { toast("لم يُعثر على الباركود " + code + ".", "warn"); return; }
      addToCart(g);
      if (fromCam && C.pref("cont") && g.p > 0) again();
      return;
    }
    if (v.screen === "items" && iMode() === "qty") {
      if (!g) { toast("لا صنف بالباركود " + code + " — أضفه أولاً من «صنف جديد».", "warn"); return; }
      if (recvAdd(g) && fromCam) again();
      return;
    }
    if (g) { openItem(g.key); return; }
    if (canAdd() && full()) {
      sheet("<h2>" + ic("search") + ' لا صنف بهذا الباركود</h2><p class="by num">' + esc(code) + "</p>" +
        '<button class="btn p" data-a="newWith" data-v="book|' + esc(code) + '">' + ic("book") + " كتاب جديد بهذا الباركود</button>" +
        '<button class="btn g mt" data-a="newWith" data-v="stat|' + esc(code) + '">' + ic("box") + " صنف قرطاسية جديد بهذا الباركود</button>" +
        '<button class="btn o mt" data-a="close">إغلاق</button>');
    } else { v.q = code; v.mode = "view"; go("items"); toast("لا صنف بهذا الباركود — ابحث بالاسم.", "warn"); }
  }
  function back() {
    if (window.WebScan && WebScan.isOpen && WebScan.isOpen()) { WebScan.close(); return true; }
    var s = el("sheet");
    if (s && !s.hidden) { closeSheet(); return true; }
    var d = el("donePop");
    if (d) { d.parentNode.removeChild(d); return true; }
    if (gate()) return false;
    if (v.screen === "items" && v.place && iMode() === "view") { v.place = null; v.shown = 40; render(); window.scrollTo(0, 0); return true; }
    if (v.back.length) {
      v.screen = v.back.pop(); v.fresh = true;
      render();
      window.scrollTo(0, scr[v.screen] || 0);
      return true;
    }
    if (v.screen !== "home") { go("home"); return true; }
    return false;
  }

  /* ---------- الأفعال ---------- */
  function act(a, val, t) {
    var g, L, ent, pr, o, i;
    switch (a) {
      case "go": go(val); break;
      case "open2": open2(val); break;
      case "back": back(); break;
      case "fab":
        if (v.screen === "edit" || (v.screen === "items" && iMode() === "new")) scan("bc");
        else if (v.screen === "count" || v.screen === "sell" || tabNow() === "items") scan();
        else if (C.canP("sell")) { go("sell"); setTimeout(function () { scan(); }, 250); }
        else { v.mode = "view"; go("items"); setTimeout(function () { scan(); }, 250); }
        break;
      case "scan": scan(); break;
      case "link": doLink(); break;
      case "eye": { var kk = el("stKey"); if (kk) { var show = kk.type === "password"; kk.type = show ? "text" : "password"; t.textContent = show ? "إخفاء" : "إظهار"; } break; }
      case "unlink":
        sheet("<h2>فك ربط هذا الهاتف؟</h2><p class=\"by\">تُحذف بيانات الفرع من الهاتف، ويُطلب رابط الربط من جديد. ما بعته ولم يصل المنظومة يبقى ويُرسل بعد الربط.</p>" +
          '<button class="btn d" data-a="unlinkYes">فك الربط</button><button class="btn o mt" data-a="close">إلغاء</button>');
        break;
      case "unlinkYes": closeSheet(true); C.unlink(); C.lock(); v.screen = "home"; v.back = []; render(); break;
      case "refresh": refresh(false); break;
      case "pick": v.pick = val; v.err = ""; render(); break;
      case "login": {
        var pw = (el("pw") || {}).value || "";
        if (!pw) { lockErr("اكتب كلمة السر."); return; }
        var b = t; if (b) b.disabled = true;
        C.login(v.pick, pw).then(function (ok) { if (b) b.disabled = false; if (ok) entered(); else lockErr("كلمة السر غير صحيحة."); });
        break;
      }
      case "pinSet": {
        var p1 = C.digits((el("pw") || {}).value || "").trim(), p2 = C.digits((el("pw2") || {}).value || "").trim();
        if (!/^\d{4,}$/.test(p1)) { lockErr("الرمز 4 أرقام أو أكثر."); return; }
        if (p1 !== p2) { lockErr("الرمزان غير متطابقين."); return; }
        C.setPin(p1).then(entered);
        break;
      }
      case "pinIn": {
        var p = C.digits((el("pw") || {}).value || "").trim();
        if (!p) { lockErr("اكتب الرمز."); return; }
        C.pinOk(p).then(function (ok) { if (ok) entered(); else lockErr("الرمز غير صحيح."); });
        break;
      }
      case "bio": C.bioCheck(C.staffInfo() ? v.pick : "").then(function (ok) { if (ok) entered(); }); break;
      case "bioOn": C.bioEnroll(C.staffInfo() ? C.who().id : "").then(function (ok) { closeSheet(true); toast(ok ? "تم: الدخول ب" + C.bioWord() + " مفعّل." : "لم يتم التفعيل — تقدر تفعّله من «الإعدادات».", ok ? "ok" : "warn"); render(); }); break;
      case "bioToggle": {
        var id = C.staffInfo() ? C.who().id : "";
        if (C.bioRec(id)) { C.bioOff(id); toast("أُوقف الدخول ب" + C.bioWord() + "."); render(); }
        else C.bioAvail().then(function (ok) {
          if (!ok) { toast("هذا الهاتف بلا " + C.bioWord() + " مسجّل.", "warn"); return; }
          act("bioOn");
        });
        break;
      }
      case "logout": C.lock(); closeSheet(true); v.screen = "home"; v.back = []; v.form = null; render(); break;
      case "close": closeSheet(); break;

      /* إضافة وتعديل */
      case "imode": v.mode = val; v.place = null; v.shown = 40; render(); window.scrollTo(0, 0); break;
      case "itype": C.setPref("type", val === "stat" ? "stat" : "book"); v.place = null; v.cat = ""; v.filt = ""; v.shown = 40; render(); break;
      case "iview": C.setPref("view", val); v.place = null; v.shown = 40; render(); break;
      case "filt": v.filt = val; v.shown = 40; paintItems(); break;
      case "filtClr": v.filt = ""; v.cat = ""; v.shown = 40; paintItems(); break;
      case "clrQ": { v.q = ""; v.shown = 40; var iq = el("iq"); if (iq) { iq.value = ""; try { iq.focus(); } catch (e) { } } var cl = el("iqClr"); if (cl) cl.classList.add("hidden"); paintItems(); break; }
      case "catPick": L = C.lists(); chooser(iType() === "book" ? catWord() : "التصنيف", iType() === "book" ? L.bcats : L.scats, iType() === "book" ? L.bcount : L.scount, "cat", false); break;
      case "catClr": v.cat = ""; v.shown = 40; paintItems(); break;
      case "chPick":
        if (!ch) break;
        if (ch.target === "cat") { v.cat = val; v.shown = 40; closeSheet(true); paintItems(); }
        else if (v.form) { v.form.f[ch.target] = val; if (v.form.isNew) C.save(); closeSheet(true); render(); }
        break;
      case "more":
        v.shown += 40;
        if (v.screen === "items") paintItems(); else render();
        break;
      case "open": closeSheet(true); openItem(val); break;
      case "mapLib": { var mp = C.shelfMap(iType()), Lb = mp.libs[num(val)]; if (Lb) { v.mapLib = Lb.lib; paintItems(); } break; }
      case "place": {
        if (val === "none") v.place = { none: true };
        else {
          pr = String(val).split(":");
          var mp2 = C.shelfMap(iType()), Lx = mp2.libs[num(pr[0])], sx = Lx && Lx.shelves[num(pr[1])];
          if (!Lx) break;
          v.place = { lib: Lx.lib, shelf: iType() === "book" && sx ? sx.s : "" };
        }
        v.shown = 40; paintItems(); window.scrollTo(0, 0);
        break;
      }
      case "placeBack": v.place = null; v.shown = 40; paintItems(); break;
      case "edit": startEdit(); break;
      case "editSave": saveEdit(); break;
      case "fStep": {
        if (!v.form) break;
        var qi = document.querySelector('[data-f="q"]');
        v.form.f.q = String(Math.max(0, Math.floor(num(v.form.f.q)) + num(val)));
        if (qi) qi.value = v.form.f.q;
        qdHint();
        if (v.form.isNew) saveSoon();
        break;
      }
      case "fSet": pr = String(val).split("|"); if (v.form) { v.form.f[pr[0]] = pr[1]; if (v.form.isNew) C.save(); render(); } break;
      case "fPick": {
        L = C.lists();
        var book = v.form && v.form.t === "book";
        if (val === "d") chooser("دار النشر", L.pubs, null, "d", true);
        else chooser(book ? catWord() : "التصنيف", book ? L.bcats : L.scats, book ? L.bcount : L.scount, "c", true);
        break;
      }
      case "fScan": scan(val || "bc"); break;
      case "newSave": saveNew(false); break;
      case "newForce": saveNew(true); break;
      case "newWith": {
        pr = String(val).split("|");
        closeSheet(true);
        C.setPref("type", pr[0] === "stat" ? "stat" : "book");
        newDraft(pr[0] === "stat" ? "stat" : "book").bc = pr[1] || "";
        C.save();
        v.mode = "new";
        go("items");
        break;
      }
      case "addQty": addQtySheet(); break;
      case "aqStep": {
        var aq = el("aqN"), am = el("aqMinus");
        if (aq) { aq.value = Math.max(1, Math.floor(num(aq.value)) + num(val)); if (am) am.disabled = num(aq.value) <= 1; }
        break;
      }
      case "aqDst": {
        var seg = el("aqDst");
        if (seg) { seg.setAttribute("data-dst", val); Array.prototype.forEach.call(seg.children, function (bn) { bn.classList.toggle("on", bn.getAttribute("data-v") === val); }); }
        break;
      }
      case "aqSave": {
        g = curItem();
        var n = Math.floor(num((el("aqN") || {}).value)), dst = (el("aqDst") || { getAttribute: function () { return "shelf"; } }).getAttribute("data-dst");
        if (!g || !(n > 0)) { toast("اكتب الكمية.", "warn"); return; }
        C.receive([{ b: g.ob || "", k: g.code || "", n: g.n, q: n }], { dst: dst });
        closeSheet(true); render();
        toast("أُرسلت " + fmtN(n) + " — تُضاف في المنظومة عند وصولها.", "ok");
        break;
      }
      case "rDst": S().recv.dst = val === "store" ? "store" : "shelf"; C.save(); render(); break;
      case "rAdd": g = C.byKey(val); if (g) recvAdd(g); break;
      case "rDel": S().recv.lines.splice(num(val), 1); C.save(); render(); break;
      case "rQty": {
        pr = String(val).split("|");
        var rl = S().recv.lines[num(pr[0])];
        /* كما في السلة: الناقص عند الواحد يحذف السطر */
        if (rl) { rl.q = num(rl.q) + num(pr[1]); if (rl.q <= 0) S().recv.lines.splice(num(pr[0]), 1); C.save(); render(); }
        break;
      }
      case "rClear": S().recv.lines = []; C.save(); render(); break;
      case "rSave": recvSave(); break;

      /* البيع */
      case "sellOne": g = curItem(); if (g) addToCart(g); break;
      case "copy": copy(val); break;
      case "add": g = C.byKey(val); if (g) addToCart(g); break;
      case "rm": S().cart.splice(num(val), 1); C.save(); render(); break;
      case "qty": {
        pr = String(val).split("|");
        var ln = S().cart[num(pr[0])];
        if (ln) { ln.q = Math.max(0, ln.q + num(pr[1])); if (!ln.q) S().cart.splice(num(pr[0]), 1); C.save(); render(); }
        break;
      }
      case "meth": S().sell.method = val; C.save(); render(); break;
      case "zpOk": {
        g = C.byKey(val);
        var pz = num((el("zpP") || {}).value);
        if (!g || !(pz > 0)) { toast("اكتب السعر.", "warn"); return; }
        closeSheet(true); C.addToCart(g, pz); v.sq = ""; v.lastAdd = g.key;
        if (v.screen !== "sell") go("sell"); else render();
        break;
      }
      case "checkout": checkout(); break;
      case "rcPrint": { o = S().orders.filter(function (x) { return x.id === val; })[0]; if (o) C.printReceipt(o); var d = el("donePop"); if (d) d.parentNode.removeChild(d); break; }
      case "rcSkip": { var d2 = el("donePop"); if (d2) d2.parentNode.removeChild(d2); break; }
      case "order": {
        o = S().orders.filter(function (x) { return x.id === val; })[0];
        if (o) sheet(C.receiptHtml(o) + '<button class="btn p mt" data-a="rcPrint" data-v="' + esc(o.id) + '">' + ic("print") + " طباعة الإيصال</button>" + '<button class="btn o mt" data-a="close">إغلاق</button>');
        break;
      }
      case "rcTest": C.printReceipt({ id: "test00", at: C.nowStamp(), items: [{ n: "إيصال تجريبي", q: 1, p: 0 }], disc: 0, total: 0, method: "cash" }); break;
      case "sellCredit": S().sell.method = "credit"; C.save(); go("sell"); break;
      case "sellTo": S().sell.method = "credit"; S().sell.cust = val; C.save(); closeSheet(true); go("sell"); break;

      /* الجرد */
      case "lib": S().loc.lib = val; S().loc.list = []; C.save(); render(); break;
      case "shelf": S().loc.shelf = String(Math.max(1, num(S().loc.shelf) + num(val))); S().loc.list = []; C.save(); render(); break;
      case "locAdd": g = C.byKey(val); if (g) { v.lq = ""; countAdd(g); } break;
      case "locPlus": g = C.byKey(val); if (g) countAdd(g); break;
      case "locMinus":
        L = S().loc; ent = L.list.filter(function (x) { return x.key === val; })[0]; g = C.byKey(val);
        if (ent && g && ent.c > 0) { ent.c--; C.queueLoc(g, { qd: -1 }); C.save(); render(); }
        break;
      case "locNext": S().loc.shelf = String(num(S().loc.shelf) + 1); S().loc.list = []; C.save(); render(); window.scrollTo(0, 0); toast("الرف " + S().loc.shelf + " — امسح كتبه.", "ok"); break;
      case "cntSet":
        ent = S().loc.list.filter(function (x) { return x.key === val; })[0];
        if (ent) {
          sheet("<h2>" + ic("stack") + ' كم نسخة على الرف؟</h2><p class="by">' + esc(ent.n) + "</p>" +
            '<label class="fld"><span>العدد</span><input class="inp ltr" id="cntN" inputmode="numeric" value="' + ent.c + '"></label>' +
            '<button class="btn p" data-a="cntSave" data-v="' + esc(val) + '">' + ic("check") + ' حفظ العدد</button><button class="btn o mt" data-a="close">إلغاء</button>');
          setTimeout(function () { var c = el("cntN"); if (c) { c.focus(); c.select(); } }, 120);
        }
        break;
      case "cntSave": {
        ent = S().loc.list.filter(function (x) { return x.key === val; })[0]; g = C.byKey(val);
        var want = Math.max(0, Math.floor(num((el("cntN") || {}).value)));
        if (ent && g && want !== ent.c) { C.queueLoc(g, { qd: want - ent.c }); ent.c = want; C.save(); }
        closeSheet(true); render();
        break;
      }

      /* الفواتير والآجل والديون والتنبيهات */
      case "invTab": v.invTab = val; render(); break;
      case "inv": invSheet(val); break;
      case "crd": {
        var x = (creditOf() || []).filter(function (r) { return String(r.no) === String(val); })[0];
        if (!x) break;
        var line = "فاتورة " + esc(x.no) + " · " + D(x.d || "") + " · المبلغ " + money(x.t) + (num(x.pd) > 0 ? " · دفع " + money(x.pd) : "") + " · الباقي " + money(x.due);
        if (x.cid && custOf().some(function (c) { return c.id === x.cid; })) custSheet(x.cid, line);
        else sheet("<h2>" + ic("clock") + " " + esc(x.c || "بيع آجل") + '</h2><p class="by">' + line + '</p><button class="btn o" data-a="close">إغلاق</button>');
        break;
      }
      case "cust": custSheet(val); break;
      case "sup": supSheet(val); break;
      case "debtTab": v.debtTab = val; v.dq = ""; render(); break;
      case "alTab": v.alTab = val; v.shown = 40; render(); break;
      case "outTab": v.outTab = val; render(); break;
      case "resend": C.resend(); paintSync(); toast("أُعيد الإرسال — تأكيده يظهر بعد قليل.", "ok"); break;
      case "eDrop": C.dropEdit(val); render(); toast("أُلغي قبل إرساله."); break;

      /* الإعدادات */
      case "pPick": pickSheet(val); break;
      case "pSet": {
        i = String(val).indexOf("|");
        var pk = String(val).slice(0, i), pv = String(val).slice(i + 1), po = PICKS[pk] && PICKS[pk].o.filter(function (z) { return String(z[0]) === pv; })[0];
        if (po) C.setPref(pk, po[0]);
        closeSheet(true); render();
        break;
      }
      case "pinChange":
        sheet("<h2>" + ic("key") + ' تغيير رمز الهاتف</h2><label class="fld"><span>الرمز الحالي</span><input class="inp pw" id="pinOld" type="password" inputmode="numeric" autocomplete="off"></label>' +
          '<label class="fld"><span>الرمز الجديد (4 أرقام أو أكثر)</span><input class="inp pw" id="pinA" type="password" inputmode="numeric" autocomplete="off"></label>' +
          '<label class="fld"><span>أعد الرمز الجديد</span><input class="inp pw" id="pinB" type="password" inputmode="numeric" autocomplete="off"></label>' +
          '<div class="err" id="pinErr"></div><button class="btn p" data-a="pinSave">' + ic("check") + ' حفظ الرمز</button><button class="btn o mt" data-a="close">إلغاء</button>');
        break;
      case "pinSave": {
        var po2 = C.digits((el("pinOld") || {}).value || "").trim(), pa = C.digits((el("pinA") || {}).value || "").trim(), pb = C.digits((el("pinB") || {}).value || "").trim();
        var perr = function (m) { var e = el("pinErr"); if (e) e.textContent = m; };
        if (!/^\d{4,}$/.test(pa)) { perr("الرمز الجديد 4 أرقام أو أكثر."); return; }
        if (pa !== pb) { perr("الرمزان الجديدان غير متطابقين."); return; }
        C.pinOk(po2).then(function (ok) {
          if (!ok) { perr("الرمز الحالي غير صحيح."); return; }
          C.setPin(pa).then(function () { closeSheet(true); toast("تغيّر رمز الهاتف.", "ok"); });
        });
        break;
      }
      case "recat":
        sheet("<h2>" + ic("book") + ' تنزيل قائمة الكتب من جديد؟</h2><p class="by">تُمسح القائمة المحفوظة على الهاتف وتُنزَّل كاملة من خادم الربط. يحتاج إنترنت، ويأخذ دقيقة تقريباً.</p>' +
          '<button class="btn p" data-a="recatYes">' + ic("refresh") + ' نزّلها الآن</button><button class="btn o mt" data-a="close">إلغاء</button>');
        break;
      case "recatYes": closeSheet(true); C.resetCatalog(); refresh(false); render(); break;
      case "nAsk": try { if (AndroidApp.askNotify) AndroidApp.askNotify(); } catch (e) { } setTimeout(render, 1200); break;
      case "nBattery": try { if (AndroidApp.openBattery) AndroidApp.openBattery(); } catch (e2) { } break;
      case "whatsNew":
        sheet("<h2>" + ic("spark") + " الجديد في الإصدار " + VERSION + '</h2><div class="list">' + NEWS.map(function (nw) {
          return '<div class="li"><span class="lic">' + ic(nw[0]) + '</span><div class="m"><b>' + nw[1] + "</b><span>" + nw[2] + "</span></div></div>";
        }).join("") + '</div><button class="btn p mt" data-a="close">تمام</button>');
        break;
    }
  }
  function copy(t) {
    var done = function () { toast("نُسخ: " + t); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { toast(t); });
    else toast(t);
  }

  /* ---------- التحديث ---------- */
  function refresh(quiet) {
    if (!C.configured()) return;
    if (C.isBusy()) { if (!quiet) toast("يحدّث الآن…"); return; }
    C.refresh().then(function (ok) {
      paintSync();
      if (!quiet) toast(ok ? "حُدّث — " + fmtN(C.info().n) + " صنف." : "تعذّر الاتصال — تُعرض آخر نسخة وصلت.", ok ? "ok" : "warn");
    });
    paintSync();
  }
  function applyPrefs() {
    var b = document.body, f = C.pref("font"), d = C.pref("dark"), dark = false;
    try { dark = d === "dark" || (d === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches); } catch (e) { }
    ["fs-s", "fs-l", "fs-xl"].forEach(function (c) { b.classList.remove(c); });
    if (f === "s" || f === "l" || f === "xl") b.classList.add("fs-" + f);
    b.classList.toggle("dark", !!dark);
    b.classList.toggle("noanim", !C.pref("anim"));
    var mt = document.querySelector('meta[name="theme-color"]');
    if (mt) mt.setAttribute("content", getComputedStyle(b).getPropertyValue("--c").trim() || "#1f4597");
    try { if (window.AndroidApp && AndroidApp.setBar) AndroidApp.setBar(getComputedStyle(b).getPropertyValue("--c").trim() || "#1f4597"); } catch (e2) { }
  }
  /* التحديث التلقائي: خادم الربط بالفهرس (v 3) كل دقيقة ونصف؛ القديم يعدّ كل تحديث من حدّ يومي: كل خمس دقائق.
     وصاحب الهاتف يختار أبطأ من ذلك من الإعدادات */
  function tick() {
    clearTimeout(timer);
    var min = num(S().kvv) >= 3 ? 90 : 300, sec = Math.max(num(C.pref("every")) || min, min);
    timer = setTimeout(function () { if (!document.hidden && C.configured()) refresh(true); tick(); }, sec * 1000);
  }
  C.on(function (type, arg) {
    if (type === "catalog") { if (!v.progress) { v.progress = arg; if (v.screen === "home" && !gate()) render(); } v.progress = arg; }
    else if (type === "busy") { if (!arg) v.progress = null; paintSync(); }
    else if (type === "sent" || type === "sendfail") paintSync();
    else if (type === "pref") { applyPrefs(); if (arg === "every") tick(); }
    else if (type === "data") {
      (arg.acks || []).forEach(function (o) { toast("سُجّلت فاتورة الهاتف: رقم " + o.inv, "ok"); });
      /* المرفوض آخراً: الإشعارات ثلاثة على الأكثر، والأهم هو الباقي أمام العين */
      var rank = { done: 0, part: 1, fail: 2 };
      (arg.eds || []).slice().sort(function (a, b) { return (rank[a.status] || 0) - (rank[b.status] || 0); }).forEach(function (e) {
        var what = e.kind === "new" ? "الصنف الجديد" : e.kind === "recv" ? "إضافة الكمية" : "تعديل";
        if (e.status === "fail") toast("لم تسجّل المنظومة " + what + " «" + (e.n || "") + "» — راجع سجل الإرسال.", "bad");
        else if (e.status === "part") toast("سُجّل بعض " + what + " «" + (e.n || "") + "» فقط — راجع سجل الإرسال.", "warn");
        else if (e.kind === "new") toast("سُجّل «" + (e.n || "") + "» في المنظومة.", "ok");
      });
      /* لا يُعاد الرسم والمستخدم يكتب، ولا ونافذة مفتوحة فوق الشاشة */
      var a = document.activeElement, busyUi = (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) || !el("sheet").hidden || el("donePop") || (window.WebScan && WebScan.isOpen && WebScan.isOpen());
      if (!busyUi || shell === "wait") render(); else { paintSync(); paintNav(); }
    }
    else if (type === "error") {
      if (arg === "BADKEY" || arg === "BADCHARS") toast("كلمة سر الربط غير صحيحة — راجع الربط.", "bad");
      /* لا فرع بعد: الشاشة تعرض السبب بدل الدوّارة */
      if (C.configured() && !C.mine()) render(); else paintSync();
    }
    else if (type === "relock") { toast(arg, "warn"); closeSheet(true); render(); }
    else if (type === "oldphone") toast("حدّث نظام الهاتف لتصل قائمة كتب الفرع كاملة.", "warn");
  });

  /* ---------- البداية ---------- */
  SCREENS = { home: pHome, items: pItems, item: pItem, edit: pEdit, sell: pSell, count: pCount, invoices: pInvoices, credit: pCredit,
    debts: pDebts, alerts: pAlerts, settings: pSettings, outbox: pOutbox };
  function boot() {
    var th = C.CFG.theme || (String(C.CFG.branch || "").toLowerCase() === "misrata" ? "green" : "blue");
    if (th === "green") document.body.classList.add("green");
    document.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-a]");
      if (!t) {
        if (e.target === el("sheet")) closeSheet();
        return;
      }
      if (t.disabled) return;
      e.preventDefault();
      act(t.getAttribute("data-a"), t.getAttribute("data-v"), t);
    });
    document.addEventListener("input", onField);
    document.addEventListener("change", onField);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { awayAt = Date.now(); C.save(); return; }
      if (awayAt && Date.now() - awayAt > Math.max(1, num(C.pref("lockMin"))) * 60000 && !C.locked()) { C.lock(); closeSheet(true); v.form = null; render(); }
      if (C.configured()) refresh(true);
    });
    window.addEventListener("online", paintSync);
    window.addEventListener("offline", paintSync);
    /* لوحة المفاتيح مفتوحة: الشريط السفلي وأشرطة الحفظ لا تأكل ما بقي من الشاشة */
    var baseH = window.innerHeight;
    function kb() {
      var hNow = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      if (window.innerHeight > baseH) baseH = window.innerHeight;
      var a = document.activeElement, typingNow = !!a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && !/^(checkbox|radio|button|file)$/.test(a.type || "");
      document.body.classList.toggle("kb", typingNow && hNow < baseH - 140);
    }
    if (window.visualViewport) window.visualViewport.addEventListener("resize", kb);
    window.addEventListener("resize", kb);
    window.addEventListener("orientationchange", function () { baseH = 0; setTimeout(function () { baseH = window.innerHeight; kb(); }, 500); });
    document.addEventListener("focusin", kb);
    document.addEventListener("focusout", function () { setTimeout(kb, 80); });
    try { if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (C.S) applyPrefs(); }); } catch (e) { }
    var started = C.start();
    applyPrefs();
    started.then(function () {
      render();
      if (C.configured()) { refresh(true); tellAndroid(); }
      tick();
      setInterval(paintSync, 20000);
    });
    if ("serviceWorker" in navigator && location.protocol === "https:" && !ANDROID) {
      navigator.serviceWorker.register("sw.js").catch(function () { });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  return {
    get S() { return { snap: C.configured() }; },
    go: go, back: back, refresh: refresh, onScan: onScan, render: render, act: act, VERSION: VERSION,
    __v: v
  };
})();
window.PhoneExt = { bioDone: function (id, ok) { Core.bioDone(id, ok); }, paintNotifState: function () { try { if (UI.__v.screen === "settings") UI.render(); } catch (e) { } } };
