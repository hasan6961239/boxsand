/* ============================================================
   ui.js — شاشات تطبيق المكتبة (التصميم المعتمد 2026-11-08)
   ------------------------------------------------------------
   الدخول، الرئيسية، البيع، الكتب، صفحة الكتاب، تسجيل الأماكن والجرد،
   المزيد (مبيعات الهاتف، الزبائن، التنبيهات، الإعدادات).
   تطبيق أندرويد ينادي: UI.onScan(رمز)، UI.back()، UI.go(شاشة)،
   UI.refresh(true)، وPhoneExt.bioDone(id, ok).
   ============================================================ */
var UI = (function () {
  "use strict";
  var C = Core, esc = C.esc, num = C.num, money = C.money, fmtN = C.fmtN;
  function S() { return C.S; }
  var v = { screen: "home", key: "", back: [], q: "", filt: "", shown: 40, sq: "", lq: "", setup: "", pinNew: "", pick: "", err: "", progress: null };
  var awayAt = 0, timer = null, lastLoc = 0;
  var ANDROID = !!window.AndroidApp;

  /* ---------- الأيقونات (أشكال متجهة) ---------- */
  var IC = {
    home: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9z",
    search: "M11 4a7 7 0 100 14 7 7 0 000-14zm9 16l-4.2-4.2",
    scan: "M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M8 9v6M11 9v6M14 9v6M17 9v6",
    pin: "M12 21s-6-5.6-6-11a6 6 0 1112 0c0 5.4-6 11-6 11zm0-8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
    menu: "M4 7h16M4 12h16M4 17h16",
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
    copy: "M9 9h10v10H9V9zM5 15H3V3h12v2",
    phone: "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z",
    link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
    lock: "M6 11h12v10H6V11zm2 0V8a4 4 0 118 0v3m-4 4v2",
    chev: "M15 6l-6 6 6 6",
    doc: "M6 3h9l4 4v14H6V3zm9 0v4h4M9 12h7M9 16h7"
  };
  function ic(n, cls) {
    return '<svg class="i' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (IC[n] || IC.box) + '"/></svg>';
  }
  function el(id) { return document.getElementById(id); }
  function toast(msg, kind) {
    var t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.textContent = msg;
    el("toasts").appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3400);
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
  function locTxt(g) {
    if (g.t !== "book") return g.loc || "";
    if (!g.lib && !g.shelf) return "";
    return (g.lib || "؟") + (g.shelf ? " · رف " + g.shelf : "");
  }

  /* ---------- الرسم ---------- */
  function render() {
    var app = el("app");
    if (!C.configured()) { app.innerHTML = pSetup(); afterSetup(); return; }
    var m = C.mine();
    if (!m) { app.innerHTML = pWaiting(); return; }
    if (C.locked()) { app.innerHTML = pLock(); afterLock(); return; }
    var f = { home: pHome, books: pBooks, book: pBook, sell: pSell, loc: pLoc, more: pMore, orders: pOrders, debts: pDebts, alerts: pAlerts, settings: pSettings }[v.screen] || pHome;
    var h = f();
    app.innerHTML = h + nav();
    after();
  }
  function nav() {
    var on = function (k) { return v.screen === k || (k === "more" && /^(orders|debts|alerts|settings)$/.test(v.screen)) || (k === "books" && v.screen === "book") ? " on" : ""; };
    return '<nav class="nav">' +
      '<button class="n' + on("home") + '" data-a="go" data-v="home">' + ic("home") + "الرئيسية</button>" +
      '<button class="n' + on("books") + '" data-a="go" data-v="books">' + ic("search") + "الكتب</button>" +
      '<button class="fab" data-a="fab" aria-label="امسح وبع">' + ic("scan") + "</button>" +
      '<button class="n' + on("loc") + '" data-a="go" data-v="loc">' + ic("pin") + "الأماكن</button>" +
      '<button class="n' + on("more") + '" data-a="go" data-v="more">' + ic("menu") + "المزيد</button></nav>";
  }
  function go(k, keepBack) {
    var map = { dash: "home", stock: "books", room: "books" };
    k = map[k] || k;
    if (!keepBack) v.back = [];
    v.screen = k;
    if (k === "books") v.shown = 40;
    window.scrollTo(0, 0);
    render();
  }

  /* ---------- الربط (أول مرة) ----------
     خانتان ظاهرتان دائماً: عنوان الربط وكلمة السر منفصلتين (كانتا داخل «تفاصيل» مطويّة لا يُعرف أنها تُفتح،
     فكان المستخدم يركّب الرابط يدوياً ويدوخ). والرابط الجاهز اختياري: إن لُصق ملأ الخانتين وحده.
     والخطأ لا يمسح ما كُتب: الخانات تبقى كما هي */
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
    /* رابط جاهز (لصق أو كتابة): الخانتان تُملآن منه */
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
    l.url = String(l.url).replace(/\/+$/, "");
    C.setLink(l);
    v.setup = "";
    el("app").innerHTML = '<div class="boot"><div><span class="spin"></span><p class="note">يتصل بالمنظومة…</p></div></div>';
    C.refresh().then(function (ok) {
      if (!ok) { v.setup = "تعذّر الاتصال: تأكد من الإنترنت ومن العنوان وكلمة السر (ما كتبتَه بقي في الخانات لتصحّحه)."; C.unlink(); }
      else v.sf = null;
      tellAndroid();
      render();
    });
  }
  function tellAndroid() {
    try {
      if (window.AndroidApp && AndroidApp.setConfig) AndroidApp.setConfig(JSON.stringify({ url: S().cfg.url, key: S().cfg.key, notif: { stock: true, restock: true, daily: true, sync: true } }));
      if (window.AndroidApp && AndroidApp.setBar) AndroidApp.setBar(getComputedStyle(document.body).getPropertyValue("--c").trim() || "#1f4597");
    } catch (e) { }
  }
  /* فرع التطبيق لم يصل من خادم الربط بعد */
  function pWaiting() {
    var b = C.branchId(), nm = b === "tripoli" ? "طرابلس" : b === "misrata" ? "مصراتة" : b;
    var busy = C.isBusy() || !S().at;
    return '<div class="login"><div class="brand">' + logo("logo") + "<h2>" + esc(C.shop().name) + "</h2></div>" +
      '<div class="lcard">' + (busy
        ? '<div class="empty"><span class="spin"></span><h3 class="mt">يحمّل بيانات الفرع…</h3><p>أول مرة فقط؛ بعدها يعمل بلا إنترنت.</p></div>'
        : emptyBox("alert", "فرع " + nm + " لم يصل بعد", "منظومة الفرع لم تُربط بخادم الربط، أو لم ترفع لقطتها بعد. في المنظومة: «المخزون والفروع» ← «تحديث الآن»، ثم حدّث هنا.") +
          '<button class="btn p" data-a="refresh">' + ic("refresh") + " تحديث</button>" +
          '<button class="btn o mt" data-a="unlink">فك الربط وإدخال رابط آخر</button>') + "</div></div>";
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
    v.err = ""; v.screen = v.screen === "book" ? "home" : v.screen;
    var id = C.staffInfo() ? (C.who().id) : "";
    render();
    C.bioAvail().then(function (ok) {
      if (!ok || C.bioRec(id)) return;
      if ((S().bioAsked || {})[id || "_"]) return;
      S().bioAsked = S().bioAsked || {}; S().bioAsked[id || "_"] = 1; C.save();
      sheet('<h2>' + ic(C.IOS ? "face" : "finger") + " الدخول ب" + C.bioWord() + "؟</h2>" +
        '<p class="by">بدل ' + (id ? "كلمة السر" : "الرمز") + " كل مرة. تقدر توقفه من «المزيد».</p>" +
        '<button class="btn p" data-a="bioOn">' + ic("check") + " فعّل</button>" +
        '<button class="btn o mt" data-a="close">لاحقاً</button>');
    });
  }

  /* ---------- الرئيسية ---------- */
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
  function alertsList() {
    var all = C.items(), month = new Date(Date.now() - 30 * 864e5), m0 = month.toISOString().slice(0, 10);
    return all.filter(function (g) {
      if (g.q <= 0) return g.m > 0 || (g.ls && String(g.ls).slice(0, 10) >= m0) || g.pend;
      return g.m > 0 && g.q <= g.m;
    });
  }
  function pHome() {
    var sh = C.shop(), w = C.who(), money_ = C.canP(["invoices", "profits"]);
    var h = '<div class="page"><div class="hd"><div class="top">' + logo("") +
      '<div class="sp"><b>' + esc(sh.name) + (sh.city ? " — " + esc(sh.city) : "") + "</b><small>" + esc(w.n) + (w.role ? " · " + esc(w.role) : "") + "</small></div>" +
      '<button class="ic" data-a="go" data-v="alerts" aria-label="التنبيهات">' + ic("bell") + (alertsList().length ? '<span class="dot">' + Math.min(99, alertsList().length) + "</span>" : "") + "</button></div>";
    if (money_ && C.mine().dash) {
      var d = dashToday();
      h += '<div class="hi">مبيعات اليوم</div><div class="big num">' + money(d.v) + " <small>" + esc(C.cur()) + "</small></div>" +
        '<div class="sub2">' + fmtN(d.n) + " فاتورة" + (d.last ? " · آخر بيعة " + esc(C.ago(d.last)) : "") + "</div>";
    } else {
      var inf = C.info();
      h += '<div class="hi">كتب الفرع</div><div class="big num">' + fmtN(inf.n) + " <small>صنف</small></div>" +
        '<div class="sub2">' + (S().at ? "آخر تحديث " + esc(C.ago(S().at)) : "") + "</div>";
    }
    if (v.progress) h += '<div class="bar"><i></i></div>';
    h += '<div class="srch"><span>' + ic("search") + '</span><input id="hq" type="search" placeholder="ابحث عن كتاب أو امسح الباركود" autocomplete="off" enterkeyhint="search">' +
      '<button class="cam" data-a="scan" aria-label="امسح">' + ic("scan") + "</button></div></div>";
    h += '<div class="tiles">';
    if (C.canP("sell")) h += '<button class="tile hero" data-a="go" data-v="sell"><span class="ti">' + ic("cart") + "</span><b>بيع جديد</b><span>امسح وأكمل البيع</span></button>";
    if (C.canP(["items", "count"])) {
      h += '<button class="tile" data-a="locMode" data-v="0"><span class="ti">' + ic("pin") + "</span><b>تسجيل الأماكن</b><span>مكتبة ورف ثم امسح</span></button>" +
        '<button class="tile" data-a="locMode" data-v="1"><span class="ti">' + ic("box") + "</span><b>الجرد</b><span>عدّ ما على الرف</span></button>";
    }
    var al = alertsList().length;
    h += '<button class="tile" data-a="go" data-v="alerts"><span class="ti">' + ic("alert") + "</span><b>التنبيهات</b><span>" + (al ? fmtN(al) + " صنف نفد أو قارب" : "لا نواقص") + "</span></button></div>";
    var m = C.mine();
    if (money_ && m.dash && m.dash.recent && m.dash.recent.length) {
      h += '<div class="sec"><b>آخر الفواتير</b></div><div class="list">' + m.dash.recent.slice(0, 6).map(function (r) {
        return '<div class="li"><span class="lic">' + ic("doc") + '</span><div class="m"><b class="one">فاتورة ' + r.no + " · " + esc(C.METHOD[r.m] || (r.k === "return" ? "إرجاع" : "")) + (r.ph ? " · من الهاتف" : "") + "</b><span>" + esc(r.n || "") + " · " + esc(r.at || "") + '</span></div><span class="v num">' + money(r.t) + "</span></div>";
      }).join("") + "</div>";
    } else if (S().orders.length) {
      h += '<div class="sec"><b>آخر ما بعته من هذا الهاتف</b><button data-a="go" data-v="orders">الكل</button></div>' + ordersList(S().orders.slice(0, 4));
    }
    h += syncNote() + "</div>";
    return h;
  }
  function syncNote() {
    var p = C.pending(), inf = C.info();
    return '<p class="note">' + (S().at ? "آخر تحديث " + esc(C.ago(S().at)) : "لم يُحدَّث بعد") + " · " + fmtN(inf.n) + " صنف" +
      (inf.src === "cat" && inf.at ? " (قائمة الفرع من " + esc(String(inf.at).slice(11, 16)) + ")" : "") +
      (p ? " · " + fmtN(p) + " تنتظر الإرسال للمنظومة" : "") + "</p>";
  }

  /* ---------- الكتب ---------- */
  function catChips() {
    var by = {};
    C.items().forEach(function (g) { if (g.c) by[g.c] = (by[g.c] || 0) + 1; });
    return Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).slice(0, 12);
  }
  function filtered() {
    var all = C.items(), f = v.filt;
    var list = !f ? all : f === "have" ? all.filter(function (g) { return g.q > 0; }) : f === "out" ? all.filter(function (g) { return g.q <= 0; })
      : all.filter(function (g) { return g.c === f.slice(2); });
    return C.search(list, v.q, 40);
  }
  function pBooks() {
    var h = '<div class="page"><div class="hd"><h1>الكتب</h1>' +
      '<div class="srch"><span>' + ic("search") + '</span><input id="bq" type="search" value="' + esc(v.q) + '" placeholder="العنوان أو المؤلف أو الباركود" autocomplete="off" enterkeyhint="search">' +
      (v.q ? '<button class="clr" data-a="clrQ" aria-label="مسح">' + ic("x") + "</button>" : "") +
      '<button class="cam" data-a="scan" aria-label="امسح">' + ic("scan") + "</button></div></div>" +
      '<div class="filters"><button class="' + (!v.filt ? "on" : "") + '" data-a="filt" data-v="">الكل</button>' +
      '<button class="' + (v.filt === "have" ? "on" : "") + '" data-a="filt" data-v="have">المتوفر فقط</button>' +
      catChips().map(function (c) { return '<button class="' + (v.filt === "c:" + c ? "on" : "") + '" data-a="filt" data-v="c:' + esc(c) + '">' + esc(c) + "</button>"; }).join("") +
      '<button class="' + (v.filt === "out" ? "on" : "") + '" data-a="filt" data-v="out">نفد</button></div>' +
      '<div id="bres">' + resultsHtml() + "</div></div>";
    return h;
  }
  function resultsHtml() {
    var res = filtered();
    if (!C.items().length) return emptyBox("book", "لا كتب بعد", C.info().src === "none" ? "لم تصل قائمة كتب الفرع بعد — حدّث من «المزيد»." : "");
    if (!res.length) return emptyBox("search", "لا نتيجة", "جرّب كلمة أخرى، أو امسح الباركود.");
    var shown = res.slice(0, v.shown);
    return '<p class="cnt">' + fmtN(res.length) + (v.q || v.filt ? " نتيجة" : " صنف") + "</p>" +
      (res.fz && res.fz.first === 0 && v.q ? '<div class="near">ما لقيناش «' + esc(v.q) + '» بالضبط — هل تقصد؟</div>' : "") +
      shown.map(resHtml).join("") +
      (res.length > shown.length ? '<button class="more-btn" id="moreBtn" data-a="more">عرض ' + Math.min(40, res.length - shown.length) + " أخرى من " + fmtN(res.length - shown.length) + "</button>" : "");
  }
  function resHtml(g) {
    var lt = locTxt(g);
    return '<button class="res' + (g.q <= 0 ? " out" : "") + '" data-a="open" data-v="' + esc(g.key) + '"><span class="cv">' + ic(g.t === "book" ? "book" : "box") + "</span>" +
      '<span class="m"><b>' + esc(g.n) + "</b><span>" + esc([g.a, g.c].filter(Boolean).join(" · ")) + "</span>" +
      '<span class="tags">' + (lt ? '<span class="chip g">' + esc(lt) + "</span>" : "") +
      (g.q > 0 ? '<span class="chip ok">' + fmtQ(g.q) + "</span>" : '<span class="chip b">نفد</span>') +
      g.others.filter(function (o) { return o.q > 0; }).slice(0, 2).map(function (o) { return '<span class="chip w">' + esc(o.name) + ": " + o.q + "</span>"; }).join("") +
      (g.editing ? '<span class="chip">' + ic("clock") + " تعديل</span>" : "") + "</span></span>" +
      '<span class="pr"><b class="num">' + (g.p > 0 ? money(g.p) : "—") + "</b><span>" + (g.p > 0 ? esc(C.cur()) : "بلا سعر") + "</span></span></button>";
  }

  /* ---------- صفحة الكتاب ---------- */
  function open(key) {
    if (!C.byKey(key)) return;
    if (v.screen !== "book") v.back.push(v.screen);
    v.key = key; v.screen = "book";
    window.scrollTo(0, 0);
    render();
  }
  function canEdit() { return C.canP(["items", "price", "goods", "count"]); }
  function pBook() {
    var g = C.byKey(v.key);
    if (!g) { v.screen = "books"; return pBooks(); }
    var lt = locTxt(g);
    var h = '<div class="page"><div class="hd bkh"><div class="top"><button class="ic" data-a="back" aria-label="رجوع">' + ic("back") + '</button><span class="sp"></span>' +
      (canEdit() ? '<button class="ic" data-a="edit" aria-label="تعديل">' + ic("edit") + "</button>" : "") + "</div>" +
      '<div class="t">' + esc(g.n) + '</div><div class="a">' + esc([g.a || (g.t === "book" ? "بدون مؤلف" : ""), g.d].filter(Boolean).join(" · ")) +
      (g.c ? ' <span class="chip">' + esc(g.c) + "</span>" : "") + "</div></div>" +
      '<div class="bk"><div class="nums"><div><b class="num">' + (g.p > 0 ? money(g.p) : "—") + "</b><span>" + (g.p > 0 ? "السعر" : "بلا سعر") + "</span></div>" +
      '<div><b class="num">' + fmtN(Math.max(g.q, 0)) + "</b><span>في الفرع</span></div>" +
      '<div><b class="num">' + esc(lt || "—") + "</b><span>المكان</span></div></div><div class=\"where\">" +
      (g.t === "book" ? '<div class="w"><span>الرفوف' + (lt ? " · " + esc(lt) : "") + "</span><b class=\"num\">" + fmtN(Math.max(g.shelfQ, 0)) + "</b></div>" : "") +
      (g.room > 0 ? '<div class="w"><span>غرفة الخزين</span><b class="num">' + fmtN(g.room) + "</b></div>" : "") +
      (g.wh > 0 ? '<div class="w"><span>المخازن</span><b class="num">' + fmtN(g.wh) + "</b></div>" : "") +
      g.others.map(function (o) { return '<div class="w"><span>' + esc(o.name) + '</span><b class="num">' + fmtN(o.q) + "</b></div>"; }).join("") +
      "</div>" +
      (g.pend ? '<div class="tags"><span class="chip w">' + ic("clock") + " بعت منه " + g.pend + " — تنتظر المنظومة</span></div>" : "") +
      (g.editing ? '<div class="tags"><span class="chip">' + ic("clock") + " تعديل بانتظار المنظومة</span></div>" : "") +
      '<div class="acts">' + (C.canP("sell") ? '<button class="btn p" data-a="sellOne">' + ic("cart") + " بيع</button>" : "") +
      (canEdit() ? '<button class="btn g" data-a="edit">' + ic("edit") + " تعديل</button>" : "") + "</div></div>" +
      '<div class="sec"><b>الباركود</b>' + (g.b || g.code ? '<button data-a="copy" data-v="' + esc(g.b || g.code) + '">نسخ</button>' : "") + "</div>" +
      '<div class="list"><div class="li"><span class="lic">' + ic("scan") + '</span><div class="m"><b class="bc num">' + esc(g.b || g.code || "بلا باركود") + "</b>" +
      "<span>" + (g.code && g.b ? "الرمز " + esc(g.code) : "") + (g.ls ? (g.code && g.b ? " · " : "") + "آخر بيعة: " + esc(C.ago(g.ls)) : "") + "</span></div></div></div>" +
      (g.nt ? '<p class="note">' + esc(g.nt) + "</p>" : "") + "</div>";
    return h;
  }
  function editSheet() {
    var g = C.byKey(v.key);
    if (!g) return;
    if (!g.b && !g.code) { toast("هذا الصنف بلا باركود ولا رمز — عدّله من الكمبيوتر.", "warn"); return; }
    var can = { n: C.canP("items"), p: C.canP("price"), m: C.canP(["goods", "items"]), q: C.canP(["count", "goods"]), l: C.canP(["items", "count"]) };
    function fld(id, lbl, val, attrs, ok) {
      return '<label class="fld"><span>' + lbl + '</span><input class="inp" id="' + id + '" value="' + esc(val == null ? "" : val) + '"' + (attrs || "") + (ok ? "" : " disabled") + "></label>";
    }
    var book = g.t === "book";
    sheet("<h2>" + ic("edit") + " تعديل " + (book ? "الكتاب" : "الصنف") + "</h2>" +
      '<p class="by">يُرسل للمنظومة على الكمبيوتر فتطبّقه وتراجعه.</p>' +
      fld("eN", book ? "اسم الكتاب" : "اسم الصنف", g.n, "", can.n) +
      fld("eA", book ? "المؤلف" : "الماركة", g.a, "", can.n) +
      '<div class="row2">' + fld("eP", "سعر البيع", g.p, ' inputmode="decimal" dir="ltr"', can.p) + fld("eM", "حد التنبيه", g.m || 0, ' inputmode="numeric" dir="ltr"', can.m) + "</div>" +
      '<label class="fld"><span>الكمية في الفرع (الآن ' + Math.max(g.q, 0) + ")</span>" +
      '<div class="shrow"><div class="step"><button type="button" data-a="eStep" data-v="-1">' + ic("minus") + "</button>" +
      '<input id="eQ" inputmode="numeric" dir="ltr" value="' + Math.max(g.q, 0) + '" data-was="' + Math.max(g.q, 0) + '"' + (can.q ? "" : " disabled") + ">" +
      '<button type="button" data-a="eStep" data-v="1">' + ic("plus") + '</button></div></div><small class="hint" id="eQd"></small></label>' +
      (book ? '<div class="row2">' + fld("eL", "المكتبة (الخزانة)", g.lib, "", can.l) + fld("eS", "الرف", g.shelf, ' inputmode="numeric" dir="ltr"', can.l) + "</div>"
            : fld("eLoc", "المكان", g.loc, "", can.l)) +
      '<button class="btn p" data-a="editSave">' + ic("check") + " حفظ وإرسال</button>" +
      '<button class="btn o mt" data-a="close">إلغاء</button>');
    var q = el("eQ");
    if (q) q.addEventListener("input", qdHint);
  }
  function qdHint() {
    var q = el("eQ"), h = el("eQd");
    if (!q || !h) return;
    var d = num(q.value) - num(q.getAttribute("data-was"));
    h.textContent = d ? (d > 0 ? "سيُضاف " + d + " في المنظومة" : "سيُنقص " + (-d) + " في المنظومة") : "";
    h.className = "hint" + (d ? (d > 0 ? " up" : " down") : "");
  }
  function editSave() {
    var g = C.byKey(v.key);
    if (!g) return;
    function val(id) { var e = el(id); return e && !e.disabled ? e.value.trim() : undefined; }
    var set = {}, book = g.t === "book";
    if (val("eN") && val("eN") !== g.n) set.n = val("eN");
    if (val("eA") !== undefined && val("eA") !== (g.a || "")) set.a = val("eA");
    if (val("eP") !== undefined && num(val("eP")) !== num(g.p)) set.p = num(val("eP"));
    if (val("eM") !== undefined && num(val("eM")) !== num(g.m)) set.m = num(val("eM"));
    var qd = val("eQ") === undefined ? 0 : num(val("eQ")) - num(el("eQ").getAttribute("data-was"));
    if (qd) set.qd = qd;
    if (book) {
      if (val("eL") !== undefined && val("eL") !== (g.lib || "")) set.l = val("eL").toUpperCase();
      if (val("eS") !== undefined && val("eS") !== String(g.shelf || "")) set.s = val("eS");
    } else if (val("eLoc") !== undefined && val("eLoc") !== (g.loc || "")) set.loc = val("eLoc");
    if (!Object.keys(set).length) { closeSheet(); toast("لم يتغيّر شيء."); return; }
    C.editItem(g, set);
    closeSheet();
    render();
    toast("أُرسل التعديل — يظهر في المنظومة عند وصوله.", "ok");
  }

  /* ---------- البيع ---------- */
  function pSell() {
    if (!C.canP("sell")) return '<div class="page"><div class="ptitle"><h1>بيع جديد</h1></div>' + emptyBox("lock", "ليست من صلاحياتك", "البيع للكاشير أو المدير.") + "</div>";
    var cart = S().cart, m = C.mine(), cust = (m && m.cust) || [];
    var h = '<div class="page sell"><div class="ptitle"><h1>بيع جديد</h1></div>' +
      '<button class="scanbig" data-a="scan"><span class="fr"></span>وجّه الكاميرا على الباركود</button>' +
      '<div class="srch"><span>' + ic("search") + '</span><input id="sq" type="search" value="' + esc(v.sq) + '" placeholder="كتاب بلا باركود؟ ابحث باسمه…" autocomplete="off"></div>' +
      '<div id="ssug">' + sugHtml() + "</div>";
    if (!cart.length) h += emptyBox("cart", "السلة فارغة", "امسح باركود الكتاب أو ابحث باسمه.");
    else h += '<div class="list cartwrap">' + cart.map(function (l, i) {
      var g = C.byKey(l.key), lt = g ? locTxt(g) : "";
      return '<div class="cl"><button class="x" data-a="rm" data-v="' + i + '" aria-label="حذف">' + ic("x") + '</button><div class="m"><b>' + esc(l.n) + "</b><span>" +
        money(l.p) + (lt ? " · " + esc(lt) : "") + (l.zp ? " · سعر جديد" : "") + '</span></div><div class="step"><button data-a="qty" data-v="' + i + '|-1">' + ic("minus") + "</button><b class=\"num\">" + l.q +
        '</b><button data-a="qty" data-v="' + i + '|1">' + ic("plus") + "</button></div></div>";
    }).join("") + "</div>";
    h += "</div>";
    var sub = C.cartTotal(), disc = C.discNow(), n = cart.reduce(function (a, l) { return a + l.q; }, 0), meth = S().sell.method;
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
        esc([g.a, locTxt(g)].filter(Boolean).join(" · ")) + (g.q <= 0 ? " · نفد" : " · " + fmtQ(g.q)) + '</span></span><span class="v num">' + (g.p > 0 ? money(g.p) : "—") + "</span></button>";
    }).join("") + "</div>";
  }
  function addToCart(g) {
    if (!(g.p > 0)) { askPrice(g); return; }
    C.addToCart(g);
    if (g.q <= 0) toast("تنبيه: «" + g.n + "» غير متوفر حسب آخر تحديث.", "warn");
    v.sq = "";
    if (v.screen !== "sell") go("sell"); else render();
  }
  function askPrice(g) {
    if (!C.canP(["price_zero", "price"])) { toast("«" + g.n + "» بلا سعر — تسعيره من صلاحية المدير.", "warn"); return; }
    sheet("<h2>كتاب بلا سعر</h2><p class=\"by\">" + esc(g.n) + "</p>" +
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
      '<button class="btn o" data-a="rcSkip">بدون طباعة</button></div>';
    document.body.appendChild(d);
  }

  /* ---------- الأماكن والجرد ---------- */
  function libsAll() {
    var seen = {}, out = [];
    (C.shop().libs || []).forEach(function (l) { if (l && !seen[l]) { seen[l] = 1; out.push(l); } });
    C.items().forEach(function (g) { if (g.t === "book" && g.lib && !seen[g.lib] && /^[A-Za-z]{1,2}$/.test(g.lib)) { seen[g.lib] = 1; out.push(g.lib); } });
    if (!out.length) out = "ABCDEFGH".split("");
    return out.sort();
  }
  function pLoc() {
    var L = S().loc;
    if (!C.canP(["items", "count"])) return '<div class="page"><div class="ptitle"><h1>تسجيل الأماكن</h1></div>' + emptyBox("lock", "ليست من صلاحياتك", "تسجيل الأماكن والجرد لأمين المخزن أو المدير.") + "</div>";
    var libs = libsAll();
    if (!L.lib) L.lib = libs[0];
    var copies = L.list.reduce(function (a, x) { return a + x.c; }, 0);
    var h = '<div class="page"><div class="ptitle"><h1>' + (L.count ? "الجرد" : "تسجيل الأماكن") + "</h1></div>" +
      '<div class="card"><span class="hint">المكتبة (الخزانة)</span><div class="letters">' + libs.map(function (l) {
        return '<button class="' + (L.lib === l ? "on" : "") + '" data-a="lib" data-v="' + esc(l) + '">' + esc(l) + "</button>";
      }).join("") + '</div><div class="shrow"><b>الرف</b><div class="step"><button data-a="shelf" data-v="-1">' + ic("minus") +
      '</button><input id="shIn" inputmode="numeric" dir="ltr" value="' + esc(L.shelf) + '"><button data-a="shelf" data-v="1">' + ic("plus") + "</button></div>" +
      '<label class="tog"><input type="checkbox" id="cnt"' + (L.count ? " checked" : "") + "> عدّ النسخ (جرد)</label></div></div>" +
      '<button class="scanbig" data-a="scan"><span class="fr"></span>امسح كتب الرف واحداً وراء الآخر</button>' +
      '<div class="srch"><span>' + ic("search") + '</span><input id="lq" type="search" value="' + esc(v.lq) + '" placeholder="كتاب بلا باركود؟ ابحث باسمه…" autocomplete="off"></div>' +
      '<div id="lsug">' + locSug() + "</div>";
    if (!L.list.length) h += emptyBox("pin", "مكتبة " + L.lib + " · رف " + L.shelf, L.count ? "امسح كل نسخة على هذا الرف: كل مسحة نسخة." : "امسح الكتب التي على هذا الرف: كل كتاب يأخذ مكانه هنا.");
    else {
      h += '<div class="sec"><b>مكتبة ' + esc(L.lib) + " · رف " + esc(L.shelf) + "</b><span class=\"mut\">" + fmtN(L.list.length) + " كتاب" + (L.count ? " · " + fmtQ(copies) : "") + "</span></div>" +
        '<div class="list">' + L.list.map(function (x) {
          return '<div class="li"><span class="count num">' + x.c + '</span><div class="m"><b>' + esc(x.n) + "</b><span>" + (x.moved ? "صار مكانه: " + esc(L.lib) + " · رف " + esc(L.shelf) : "مكانه كما هو") + "</span></div>" +
            (L.count ? '<div class="step"><button data-a="locMinus" data-v="' + esc(x.key) + '">' + ic("minus") + "</button></div>" : "") + "</div>";
        }).join("") + "</div>" +
        '<button class="btn g mt" data-a="locNext">' + ic("check") + " انتهى هذا الرف — الرف التالي</button>";
    }
    h += '<p class="note">يُرسل كل كتاب للمنظومة فتسجّل مكانه' + (L.count ? " وعدد نسخه" : "") + ". بلا إنترنت يُحفظ هنا ويُرسل وحده لاحقاً.</p></div>";
    return h;
  }
  function locSug() {
    if (!String(v.lq).trim()) return "";
    var res = C.search(C.items(), v.lq, 8).slice(0, 8);
    if (!res.length) return '<p class="note">لا نتيجة.</p>';
    return '<div class="sugs">' + res.map(function (g) {
      return '<button class="li" data-a="locAdd" data-v="' + esc(g.key) + '"><span class="lic">' + ic("book") + '</span><span class="m"><b class="one">' + esc(g.n) + "</b><span>" +
        esc(locTxt(g) || "بلا مكان") + "</span></span></button>";
    }).join("") + "</div>";
  }
  function locAdd(g) {
    var L = S().loc;
    if (!L.lib) { toast("اختر المكتبة أولاً.", "warn"); return false; }
    if (!g.b && !g.code) { toast("هذا الصنف بلا باركود ولا رمز — سجّل مكانه من الكمبيوتر.", "warn"); return false; }
    var ent = L.list.filter(function (x) { return x.key === g.key; })[0], set = {};
    if (!ent) {
      ent = { key: g.key, n: g.n, b: g.b || "", k: g.code || "", c: 0, moved: false };
      L.list.unshift(ent);
      if (g.t === "book") {
        if ((g.lib || "") !== L.lib) set.l = L.lib;
        if (String(g.shelf || "") !== String(L.shelf)) set.s = String(L.shelf);
      } else if ((g.loc || "") !== L.lib + " رف " + L.shelf) set.loc = L.lib + " رف " + L.shelf;
      ent.moved = Object.keys(set).length > 0;
      /* الجرد: ما على الرف الآن يصير 1 (والمسحات التالية +1) */
      if (L.count) { set.qd = 1 - Math.max(g.shelfQ, 0); set.cnt = 1; }
    } else if (L.count) set.qd = 1;
    else { toast("«" + g.n + "» مسجّل على هذا الرف.", "ok"); return true; }
    ent.c++;
    if (Object.keys(set).length) C.queueLoc(g, set);
    C.save();
    if (v.screen === "loc") render();
    toast(L.count ? "«" + g.n + "» — " + fmtQ(ent.c) : "«" + g.n + "» ← " + L.lib + " · رف " + L.shelf, "ok");
    return true;
  }

  /* ---------- المزيد ---------- */
  function pMore() {
    var w = C.who(), sh = C.shop(), m = C.mine();
    var today = S().orders.filter(function (o) { return o.date === C.localToday() && o.status !== "fail"; });
    var cust = (m && m.cust) || [];
    var h = '<div class="page"><div class="ptitle"><h1>المزيد</h1></div>' +
      '<div class="prof"><span class="av">' + esc(initial(w.n)) + '</span><div class="m"><b>' + esc(w.n) + "</b><span>" + esc([w.role, S().phone.name].filter(Boolean).join(" · ")) + "</span></div>" +
      '<button class="chip" data-a="logout">' + ic("out") + " خروج</button></div>" +
      '<div class="list menu mt">' +
      item("orders", "doc", "مبيعات هذا الهاتف", fmtN(today.length) + " فاتورة اليوم · " + (C.pending() ? fmtN(C.pending()) + " تنتظر الإرسال" : "كلها وصلت المنظومة")) +
      (cust.length && C.canP(["debts", "pay", "sell"]) ? item("debts", "users", "الزبائن والديون", fmtN(cust.filter(function (c) { return num(c.b) > 0; }).length) + " زبون عليه دين") : "") +
      item("alerts", "alert", "التنبيهات والنواقص", fmtN(alertsList().length) + " صنف نفد أو قارب") +
      '<button class="li" data-a="bioToggle"><span class="lic">' + ic(C.IOS ? "face" : "finger") + '</span><span class="m"><b>الدخول ب' + C.bioWord() + "</b><span>" +
      (C.bioRec(C.staffInfo() ? w.id : "") ? "مفعّل على هذا الهاتف — اضغط لإيقافه" : "غير مفعّل — اضغط لتفعيله") + "</span></span></button>" +
      '<button class="li" data-a="refresh"><span class="lic">' + ic("refresh") + '</span><span class="m"><b>آخر تحديث</b><span>' + (S().at ? esc(C.ago(S().at)) : "لم يُحدَّث") + " · " + fmtN(C.info().n) + " صنف</span></span></button>" +
      item("settings", "gear", "الإعدادات", "اسم الهاتف، الربط، تجربة الطباعة") + "</div>" +
      '<p class="note">' + esc(sh.name) + (sh.city ? " — فرع " + esc(sh.city) : "") + " · الإصدار 2.2" + (ANDROID && AndroidApp.version ? " (" + esc(AndroidApp.version()) + ")" : "") + "</p></div>";
    return h;
  }
  function item(k, icon, t, sub) {
    return '<button class="li" data-a="go2" data-v="' + k + '"><span class="lic">' + ic(icon) + '</span><span class="m"><b>' + esc(t) + "</b><span>" + esc(sub) + '</span></span><span class="chev">' + ic("chev") + "</span></button>";
  }
  function sub(title) {
    return '<div class="ptitle"><button class="back" data-a="back" aria-label="رجوع">' + ic("back") + "</button><h1>" + esc(title) + "</h1></div>";
  }
  function ordersList(list) {
    return '<div class="list">' + list.map(function (o) {
      var st = o.status === "done" ? '<span class="chip ok">' + ic("check") + " فاتورة " + o.inv + "</span>"
        : o.status === "fail" ? '<span class="chip b">لم تُسجَّل — أصناف غير موجودة في المنظومة</span>'
        : '<span class="chip w">' + ic("clock") + (o.sent ? " أُرسلت — تنتظر الكمبيوتر" : " لم تُرسل بعد") + "</span>";
      return '<button class="li" data-a="order" data-v="' + esc(o.id) + '"><span class="lic">' + ic("cart") + '</span><span class="m"><b class="one">' + esc(o.items.map(function (l) { return l.n; }).join("، ")) + "</b>" +
        "<span>" + esc(String(o.at).slice(0, 16)) + " · " + esc(C.METHOD[o.method] || "") + (o.byName ? " · " + esc(o.byName) : "") + '</span><span class="tags">' + st + '</span></span><span class="v num">' + money(o.total) + "</span></button>";
    }).join("") + "</div>";
  }
  function pOrders() {
    var list = S().orders;
    return '<div class="page">' + sub("مبيعات هذا الهاتف") +
      (list.length ? ordersList(list) : emptyBox("cart", "لم تبع من هذا الهاتف بعد", "اضغط زر المسح في الأسفل.")) +
      '<p class="note">المنظومة تسجّل الفاتورة حين تصلها (خلال دقائق)، وترجع رقمها هنا.</p></div>';
  }
  function pDebts() {
    var cust = ((C.mine() || {}).cust || []).slice().sort(function (a, b) { return num(b.b) - num(a.b); });
    return '<div class="page">' + sub("الزبائن والديون") +
      (cust.length ? '<div class="list">' + cust.map(function (c) {
        return '<div class="li"><span class="lic">' + esc(initial(c.n)) + '</span><div class="m"><b>' + esc(c.n) + "</b><span>" + esc(c.ph || "بدون رقم") + "</span></div>" +
          (num(c.b) > 0 ? '<span class="v num">' + money(c.b) + "</span>" : '<span class="chip ok">خالص</span>') +
          (c.ph ? '<a class="chip" href="tel:' + esc(c.ph) + '">' + ic("phone") + "</a>" : "") + "</div>";
      }).join("") + "</div>" : emptyBox("users", "لا زبائن", "")) + "</div>";
  }
  function pAlerts() {
    var list = alertsList().slice(0, 300);
    return '<div class="page">' + sub("التنبيهات والنواقص") +
      (list.length ? list.map(resHtml).join("") : emptyBox("check", "لا نواقص", "كل الأصناف فوق حد التنبيه.")) + "</div>";
  }
  function pSettings() {
    var b = C.branchId(), url = String(S().cfg.url || "");
    return '<div class="page">' + sub("الإعدادات") +
      '<div class="card"><label class="fld"><span>اسم هذا الهاتف (يظهر في المنظومة مع كل بيع)</span><input class="inp" id="phName" value="' + esc(S().phone.name) + '"></label>' +
      '<div class="where"><div class="w"><span>الفرع</span><b>' + esc(b === "tripoli" ? "طرابلس" : b === "misrata" ? "مصراتة" : b || "—") + "</b></div>" +
      '<div class="w"><span>خادم الربط</span><b class="num">' + esc(url.replace(/^https?:\/\//, "").slice(0, 28)) + "</b></div>" +
      '<div class="w"><span>الكتب</span><b>' + fmtN(C.info().n) + (C.info().src === "cat" ? " (قائمة الفرع)" : "") + "</b></div></div></div>" +
      '<button class="btn o mt" data-a="rcTest">' + ic("print") + " تجربة طباعة إيصال</button>" +
      '<button class="btn o mt" data-a="refresh">' + ic("refresh") + " تحديث الآن</button>" +
      '<button class="btn d mt" data-a="unlink">فك الربط</button>' +
      '<p class="note">الطباعة: أندرويد عبر خدمة الطباعة في الهاتف (طابعات الإيصالات بالبلوتوث لها تطبيق خدمة)، والآيفون عبر AirPrint.</p></div>';
  }

  /* ---------- بعد الرسم: الحقول ---------- */
  var tQ = null;
  function after() {
    var bq = el("bq");
    if (bq) bq.addEventListener("input", function () {
      var val = this.value; clearTimeout(tQ);
      tQ = setTimeout(function () { v.q = val; v.shown = 40; var r = el("bres"); if (r) r.innerHTML = resultsHtml(); watchMore(); }, 160);
    });
    var hq = el("hq");
    if (hq) hq.addEventListener("input", function () { v.q = this.value; v.shown = 40; go("books"); var b = el("bq"); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } });
    var sq = el("sq");
    if (sq) sq.addEventListener("input", function () { var val = this.value; clearTimeout(tQ); tQ = setTimeout(function () { v.sq = val; var s = el("ssug"); if (s) s.innerHTML = sugHtml(); }, 140); });
    var lq = el("lq");
    if (lq) lq.addEventListener("input", function () { var val = this.value; clearTimeout(tQ); tQ = setTimeout(function () { v.lq = val; var s = el("lsug"); if (s) s.innerHTML = locSug(); }, 140); });
    var disc = el("disc");
    if (disc) disc.addEventListener("change", function () { S().sell.disc = this.value; C.save(); render(); });
    var cust = el("cust");
    if (cust) cust.addEventListener("change", function () { S().sell.cust = this.value; C.save(); });
    var paid = el("paid");
    if (paid) paid.addEventListener("change", function () { S().sell.paid = this.value; C.save(); });
    var sh = el("shIn");
    if (sh) sh.addEventListener("change", function () { S().loc.shelf = String(Math.max(1, num(this.value) || 1)); S().loc.list = []; C.save(); render(); });
    var cnt = el("cnt");
    if (cnt) cnt.addEventListener("change", function () { S().loc.count = this.checked; S().loc.list = []; C.save(); render(); });
    var pn = el("phName");
    if (pn) pn.addEventListener("change", function () { S().phone.name = this.value.trim() || "هاتف"; S().pushedEmpty = false; C.save(); toast("حُفظ."); });
    watchMore();
  }
  /* «عرض المزيد» وحده حين تصله بالتمرير */
  var moreObs = null;
  function watchMore() {
    var b = el("moreBtn");
    if (!b || typeof IntersectionObserver === "undefined") return;
    if (moreObs) moreObs.disconnect();
    moreObs = new IntersectionObserver(function (ents) { if (ents[0] && ents[0].isIntersecting) act("more"); }, { rootMargin: "300px" });
    moreObs.observe(b);
  }

  /* ---------- النافذة السفلية ---------- */
  function sheet(h) {
    var s = el("sheet");
    s.innerHTML = '<div class="in"><div class="grab"></div>' + h + "</div>";
    s.hidden = false;
  }
  function closeSheet() { var s = el("sheet"); s.hidden = true; s.innerHTML = ""; }

  /* ---------- المسح ---------- */
  /* camAsked: المسح القادم من الكاميرا التي فتحناها (في الجرد تُفتح التالية وحدها) */
  var camAsked = false;
  function scan() {
    camAsked = true;
    if (ANDROID && AndroidApp.scan) { try { AndroidApp.scan(); return; } catch (e) { } }
    if (window.WebScan) window.WebScan.open(function (code) { onScan(code); });
    else toast("المسح بالكاميرا غير متاح هنا — اكتب الاسم أو الباركود.", "warn");
  }
  function onScan(code) {
    code = String(code || "").trim();
    var fromCam = camAsked;
    camAsked = false;
    if (!code || C.locked()) return;
    var g = C.byCode(code);
    if (v.screen === "loc") {
      if (!g) { toast("لم يُعثر على الباركود " + code + ".", "warn"); return; }
      if (locAdd(g) && fromCam && Date.now() - lastLoc > 600) {
        lastLoc = Date.now();
        setTimeout(scan, 700);                       // الرف كله: المسح التالي وحده
      }
      return;
    }
    if (v.screen === "sell") {
      if (!g) { toast("لم يُعثر على الباركود " + code + ".", "warn"); return; }
      addToCart(g);
      return;
    }
    if (!g) { v.q = code; go("books"); toast("لا كتاب بهذا الباركود — ابحث بالاسم.", "warn"); return; }
    open(g.key);
  }
  function back() {
    var s = el("sheet");
    if (s && !s.hidden) { closeSheet(); return true; }
    var d = el("donePop");
    if (d) { d.parentNode.removeChild(d); return true; }
    if (!C.configured() || C.locked()) return false;
    if (v.screen === "book") { v.screen = v.back.pop() || "books"; render(); return true; }
    if (/^(orders|debts|alerts|settings)$/.test(v.screen)) { go("more"); return true; }
    if (v.screen !== "home") { go("home"); return true; }
    return false;
  }

  /* ---------- الأفعال ---------- */
  function act(a, val, t) {
    switch (a) {
      case "go": go(val); break;
      case "go2": v.back = [v.screen]; v.screen = val; window.scrollTo(0, 0); render(); break;
      case "back": back(); break;
      case "fab": if (C.canP("sell")) { go("sell"); setTimeout(scan, 250); } else scan(); break;
      case "scan": scan(); break;
      case "link": doLink(); break;
      case "eye": { var kk = el("stKey"); if (kk) { var show = kk.type === "password"; kk.type = show ? "text" : "password"; t.textContent = show ? "إخفاء" : "إظهار"; } break; }
      case "unlink":
        sheet("<h2>فك ربط هذا الهاتف؟</h2><p class=\"by\">تُحذف بيانات الفرع من الهاتف، ويُطلب رابط الربط من جديد. ما بعته ولم يصل المنظومة يبقى ويُرسل بعد الربط.</p>" +
          '<button class="btn d" data-a="unlinkYes">فك الربط</button><button class="btn o mt" data-a="close">إلغاء</button>');
        break;
      case "unlinkYes": closeSheet(); C.unlink(); C.lock(); render(); break;
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
      case "bioOn": C.bioEnroll(C.staffInfo() ? C.who().id : "").then(function (ok) { closeSheet(); toast(ok ? "تم: الدخول ب" + C.bioWord() + " مفعّل." : "لم يتم التفعيل — تقدر تفعّله من «المزيد».", ok ? "ok" : "warn"); render(); }); break;
      case "bioToggle": {
        var id = C.staffInfo() ? C.who().id : "";
        if (C.bioRec(id)) { C.bioOff(id); toast("أُوقف الدخول ب" + C.bioWord() + "."); render(); }
        else C.bioAvail().then(function (ok) {
          if (!ok) { toast("هذا الهاتف بلا " + C.bioWord() + " مسجّل.", "warn"); return; }
          act("bioOn");
        });
        break;
      }
      case "logout": C.lock(); v.screen = "home"; render(); break;
      case "close": closeSheet(); break;
      case "filt": v.filt = val; v.shown = 40; render(); break;
      case "clrQ": v.q = ""; v.shown = 40; render(); break;
      case "more": v.shown += 40; var r = el("bres"); if (r) r.innerHTML = resultsHtml(); watchMore(); break;
      case "open": open(val); break;
      case "edit": editSheet(); break;
      case "eStep": { var q = el("eQ"); if (q && !q.disabled) { q.value = Math.max(0, num(q.value) + num(val)); qdHint(); } break; }
      case "editSave": editSave(); break;
      case "sellOne": { var g = C.byKey(v.key); if (g) addToCart(g); break; }
      case "copy": copy(val); break;
      case "add": { var g2 = C.byKey(val); if (g2) addToCart(g2); break; }
      case "rm": S().cart.splice(num(val), 1); C.save(); render(); break;
      case "qty": {
        var pr = String(val).split("|"), ln = S().cart[num(pr[0])];
        if (ln) { ln.q = Math.max(0, ln.q + num(pr[1])); if (!ln.q) S().cart.splice(num(pr[0]), 1); C.save(); render(); }
        break;
      }
      case "meth": S().sell.method = val; C.save(); render(); break;
      case "zpOk": {
        var g3 = C.byKey(val), pz = num((el("zpP") || {}).value);
        if (!g3 || !(pz > 0)) { toast("اكتب السعر.", "warn"); return; }
        closeSheet(); C.addToCart(g3, pz); v.sq = ""; if (v.screen !== "sell") go("sell"); else render();
        break;
      }
      case "checkout": checkout(); break;
      case "rcPrint": { var o = S().orders.filter(function (x) { return x.id === val; })[0]; if (o) C.printReceipt(o); var d = el("donePop"); if (d) d.parentNode.removeChild(d); break; }
      case "rcSkip": { var d2 = el("donePop"); if (d2) d2.parentNode.removeChild(d2); break; }
      case "order": {
        var o2 = S().orders.filter(function (x) { return x.id === val; })[0];
        if (o2) sheet(C.receiptHtml(o2) + '<button class="btn p mt" data-a="rcPrint" data-v="' + esc(o2.id) + '">' + ic("print") + " طباعة الإيصال</button>" + '<button class="btn o mt" data-a="close">إغلاق</button>');
        break;
      }
      case "rcTest": C.printReceipt({ id: "test00", at: C.nowStamp(), items: [{ n: "إيصال تجريبي", q: 1, p: 0 }], disc: 0, total: 0, method: "cash" }); break;
      case "locMode": S().loc.count = val === "1"; S().loc.list = []; C.save(); go("loc"); break;
      case "lib": S().loc.lib = val; S().loc.list = []; C.save(); render(); break;
      case "shelf": S().loc.shelf = String(Math.max(1, num(S().loc.shelf) + num(val))); S().loc.list = []; C.save(); render(); break;
      case "locAdd": { var g4 = C.byKey(val); if (g4) { v.lq = ""; locAdd(g4); } break; }
      case "locMinus": {
        var L = S().loc, ent = L.list.filter(function (x) { return x.key === val; })[0], g5 = C.byKey(val);
        if (ent && g5 && ent.c > 0) { ent.c--; C.queueLoc(g5, { qd: -1 }); C.save(); render(); }
        break;
      }
      case "locNext": S().loc.shelf = String(num(S().loc.shelf) + 1); S().loc.list = []; C.save(); render(); toast("الرف " + S().loc.shelf + " — امسح كتبه.", "ok"); break;
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
    C.refresh().then(function (ok) {
      if (!quiet) toast(ok ? "حُدّث — " + fmtN(C.info().n) + " صنف." : "تعذّر الاتصال — تُعرض آخر نسخة وصلت.", ok ? "ok" : "warn");
    });
  }
  C.on(function (type, arg) {
    if (type === "catalog") { if (!v.progress) { v.progress = arg; if (v.screen === "home" && !C.locked()) render(); } v.progress = arg; }
    else if (type === "busy" && !arg) { v.progress = null; }
    else if (type === "data") {
      (arg.acks || []).forEach(function (o) { toast("سُجّلت فاتورة الهاتف: رقم " + o.inv, "ok"); });
      /* لا يُعاد الرسم والمستخدم يكتب */
      var a = document.activeElement;
      if (!(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) && el("sheet").hidden) render();
    }
    else if (type === "error" && arg === "BADKEY") toast("كلمة سر الربط غير صحيحة — راجع الربط.", "bad");
    else if (type === "relock") { toast(arg, "warn"); render(); }
    else if (type === "oldphone") toast("حدّث نظام الهاتف لتصل قائمة كتب الفرع كاملة.", "warn");
  });

  /* ---------- البداية ---------- */
  function boot() {
    var th = C.CFG.theme || (String(C.CFG.branch || "").toLowerCase() === "misrata" ? "green" : "blue");
    if (th === "green") document.body.classList.add("green");
    document.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-a]");
      if (!t) {
        if (e.target === el("sheet")) closeSheet();
        return;
      }
      if (t.tagName === "A") return;
      e.preventDefault();
      act(t.getAttribute("data-a"), t.getAttribute("data-v"), t);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { awayAt = Date.now(); return; }
      if (awayAt && Date.now() - awayAt > 2 * 60000 && !C.locked()) { C.lock(); render(); }
      if (C.configured()) refresh(true);
    });
    C.start().then(function () {
      render();
      if (C.configured()) { refresh(true); tellAndroid(); }
      /* خادم الربط بالفهرس (v 3): كل دقيقة ونصف؛ القديم يعدّ كل تحديث من حدّ list اليومي: كل خمس دقائق */
      (function tick() {
        timer = setTimeout(function () { if (!document.hidden && C.configured()) refresh(true); tick(); }, num(S().kvv) >= 3 ? 90000 : 300000);
      })();
    });
    if ("serviceWorker" in navigator && location.protocol === "https:" && !ANDROID) {
      navigator.serviceWorker.register("sw.js").catch(function () { });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  return {
    get S() { return { snap: C.configured() }; },
    go: go, back: back, refresh: refresh, onScan: onScan, render: render, act: act,
    __v: v
  };
})();
window.PhoneExt = { bioDone: function (id, ok) { Core.bioDone(id, ok); }, paintNotifState: function () { } };
