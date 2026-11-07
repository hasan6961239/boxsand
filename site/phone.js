/* ============================================================
   phone.js — شاشات التطبيق
   ------------------------------------------------------------
   تُضاف إلى الموقع (app.js) من غير أن تغيّر ما فيه:
     • اليوم      — مبيعات اليوم والشهر وآخر الفواتير (بلا أرباح)
     • بيع        — في التطبيق فقط (أندرويد، أو الآيفون من الشاشة
                    الرئيسية): سلة، كاميرا، دفع
     • الخزين     — ما في غرفة الخزين
     • المزيد     — الرفوف، الزبائن والديون، التنبيهات والراكد…
     • الجرس      — إشعارات داخل التطبيق بحركة
   البيع من التلفون لا يكتب في بيانات المحل: يضع الطلب في ملف هذا
   التلفون على خادم الربط، والكمبيوتر يسجّله فاتورة ويعيد رقمها.
   ============================================================ */
window.PhoneExt = (function () {
  var A = null;                        // واجهة app.js
  var inApp = false;                   // تطبيق: أندرويد أو الشاشة الرئيسية — يُضبط في init
  var android = false;                 // تطبيق أندرويد نفسه: إشعاراته من الخلفية
  var pushing = false, pushAgain = false;

  function S() { return A.S; }
  function el(id) { return document.getElementById(id); }

  /* ---------- البداية ---------- */
  function init(api) {
    A = api;
    inApp = !!api.app;
    android = !!api.android;
    Object.assign(A.icons, {
      chart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
      cart: "M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z",
      door: "M5 21V4a1 1 0 011-1h12a1 1 0 011 1v17M3 21h18M14 12h.01",
      users: "M9 11a4 4 0 100-8 4 4 0 000 8zm-7 10a7 7 0 0114 0M17 11a3 3 0 100-6M22 21a6 6 0 00-5-5.9",
      bell: "M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zm4 4a2 2 0 004 0",
      plus: "M12 5v14M5 12h14",
      minus: "M5 12h14",
      check: "M5 12.5l4.5 4.5L19 7.5",
      clock: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-14v5l3 2",
      chat: "M4 20l1.4-4A8 8 0 1112 20a8 8 0 01-3.6-.9L4 20z",
      phone2: "M8 3h8a1 1 0 011 1v16a1 1 0 01-1 1H8a1 1 0 01-1-1V4a1 1 0 011-1zm3 15h2",
      zzz: "M4 6h6l-6 7h6M14 11h6l-6 8h6",
      edit: "M4 20h4L19 9a2.8 2.8 0 10-4-4L4 16v4z",
      palette: "M12 21a9 9 0 110-18c5 0 9 3.6 9 8 0 2.5-2 4-4.5 4H15a2 2 0 00-1.4 3.4A1.9 1.9 0 0112 21zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01",
      lock: "M6 11h12v10H6V11zm2 0V8a4 4 0 118 0v3m-4 4v2",
      pin: "M12 21s-6-5.6-6-11a6 6 0 1112 0c0 5.4-6 11-6 11zm0-8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
      print: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7v-7z"
    });
    var s = S();
    if (!Array.isArray(s.orders)) s.orders = [];
    if (!Array.isArray(s.edits)) s.edits = [];
    if (typeof s.accent !== "string") s.accent = "green";
    if (!Array.isArray(s.cart)) s.cart = [];
    if (!s.sell || typeof s.sell !== "object") s.sell = { disc: "", method: "cash", cust: "", paid: "" };
    if (!s.phone || typeof s.phone !== "object") s.phone = { id: "", name: "تلفون" };
    if (!/^phone-[a-z0-9]{6,}$/.test(s.phone.id)) s.phone.id = "phone-" + rand(8);
    if (!s.notif || typeof s.notif !== "object") s.notif = { stock: true, restock: true, daily: true, sync: true };
    if (!s.seen || typeof s.seen !== "object") { s.seen = {}; s.seenInit = false; }
    if (!Array.isArray(s.feed)) s.feed = [];
    if (inApp && main() && main().dash) s.screen = "dash";   // في التطبيق: اللوحة أول ما يُفتح
    window.addEventListener("online", function () { push(); });
    /* خيارات الإشعار واسم التلفون تُحفظ لحظة تغييرها، بلا زر حفظ */
    document.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.id || !/^(nf_|sPhone$|sBranch$)/.test(t.id)) return;
      saveSettings(); A.save(); onConfig();
      if (t.id === "sBranch") A.render();
    });
    /* عند العودة من إعدادات التلفون تتحدّث حالة الإذن */
    document.addEventListener("visibilitychange", function () { if (!document.hidden) paintNotifState(); onVisible(); });
    setTimeout(function () { onConfig(); if (hasPending()) push(); }, 300);
  }

  function rand(n) {
    var a = "abcdefghijklmnopqrstuvwxyz0123456789", out = "";
    try {
      var r = new Uint8Array(n); crypto.getRandomValues(r);
      for (var i = 0; i < n; i++) out += a[r[i] % a.length];
    } catch (e) { for (var j = 0; j < n; j++) out += a[Math.floor(Math.random() * a.length)]; }
    return out;
  }

  /* الفرع الرئيسي: أول لقطة فيها لوحة اليوم (منظومة 2.6 فما فوق) */
  /* فرع هذا التلفون: المختار في الإعدادات (أو المبنيّ في التطبيق: config.js)، وإلا أول فرع
     فيه لوحة اليوم. مهم حين يربط خادمُ الربط مصراتة وطرابلس معاً: البيع والدخول لفرعه */
  function realBranches() {
    var br = (S().snap && S().snap.branches) || [];
    return br.filter(function (b) { return !A.isPhone(b); });
  }
  function main() {
    var real = realBranches(), want = S().cfg && S().cfg.branch;
    var mine = want ? real.filter(function (b) { return b.branch && String(b.branch.id).toLowerCase() === want; })[0] : null;
    return mine || real.filter(function (b) { return b.dash; })[0] || real[0] || null;
  }
  function cur() { var m = main(); return (m && m.dash && m.dash.cur) || "د.ل"; }
  function localToday() {
    var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function nowStamp() {
    var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; };
    return localToday() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function esc(v) { return A.esc(v); }
  function ico(n, s) { return A.ico(n, s); }
  function money(v) { return A.money(v); }

  /* ---------- الشريط السفلي ---------- */
  function tabs() {
    var t = [{ k: "dash", t: "اليوم", i: "chart" }, { k: "home", t: "المخزون", i: "box" }];
    if (inApp && canP("sell")) t.push({ k: "sell", t: "بيع", i: "cart", hero: true });
    t.push({ k: "room", t: "الخزين", i: "door" }, { k: "more", t: "المزيد", i: "grid" });
    return t;
  }
  var UNDER_MORE = { browse: 1, stats: 1, settings: 1, debts: 1, alerts: 1, orders: 1, loc: 1 };
  function tabOf(k) { return UNDER_MORE[k] ? "more" : k; }

  /* ============================================================
     اليوم
     ============================================================ */
  function paintDash() {
    var v = el("view"), m = main();
    if (!m || !m.dash) {
      v.innerHTML = A.emptyBox("chart", "لوحة اليوم تنتظر المنظومة",
        "ثبّت آخر نسخة من المنظومة على الكمبيوتر (2.6 أو أحدث) واضغط «↻ تحديث الآن» في المخزون والفروع، فتظهر هنا مبيعات اليوم والشهر وآخر الفواتير.",
        '<button class="btn" data-act="go" data-arg="home">اعرض المخزون</button>');
      el("foot").innerHTML = "";
      return;
    }
    var d = m.dash, day = d.today, t = d.days[day] || { v: 0, n: 0, q: 0 };
    var isToday = day === localToday();
    var week = lastDays(day, 7).map(function (k) { return { d: k, v: (d.days[k] || {}).v || 0 }; });
    var monthStart = day.slice(0, 8) + "01";
    var mv = 0, mn = 0;
    Object.keys(d.days).forEach(function (k) { if (k >= monthStart && k <= day) { mv += d.days[k].v; mn += d.days[k].n; } });

    var h = '<div class="hero dash-hero">' +
      '<div class="hero-v"><span>' + (isToday ? "مبيعات اليوم" : "مبيعات آخر يوم وصل · " + esc(day)) + "</span>" +
      '<b class="cu">' + money(t.v) + '</b><i class="cur">' + esc(cur()) + "</i></div>" +
      '<div class="hero-sub">' + t.n + " فاتورة · " + t.q + " قطعة</div>" +
      miniBars(week) + "</div>";

    h += '<div class="tiles">' +
      '<div class="tile"><b>' + money(mv) + "</b><span>مبيعات الشهر</span></div>" +
      '<div class="tile"><b>' + mn + "</b><span>فاتورة هذا الشهر</span></div></div>";

    h += '<div class="card month-dots"><h2>أيام الشهر</h2><p class="sub">الممتلئة أيام فيها بيع.</p>' +
      monthDots(d, day) + "</div>";

    var pend = S().orders.filter(function (o) { return o.status === "pending"; });
    if (pend.length) {
      h += '<button class="note-card pend" data-act="go" data-arg="orders">' + ico("clock", 20) +
        "<div><b>" + pend.length + " فاتورة من هذا التلفون تنتظر الكمبيوتر</b>" +
        "<span>تُسجَّل عند التحديث القادم في المنظومة.</span></div>" + ico("back", 18) + "</button>";
    }

    h += '<div class="sec-head"><h2>' + ico("clock", 16) + ' آخر الفواتير</h2><span class="n">' + d.recent.length + "</span></div>";
    h += d.recent.length ? '<div class="rows">' + d.recent.map(invRow).join("") + "</div>"
      : A.emptyBox("chart", "لا فواتير بعد", "أول بيع يظهر هنا.");
    v.innerHTML = h;
    var a = A.ageOf(m.at);
    el("foot").innerHTML = "آخر خبر من المنظومة: " + esc(a.txt) + "<br>لا أرباح ولا أسعار شراء هنا — لا تُرفع أصلاً.";
  }

  function lastDays(end, n) {
    var d0 = new Date(end + "T00:00:00"), out = [], p = function (x) { return (x < 10 ? "0" : "") + x; };
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - i);
      out.push(d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()));
    }
    return out;
  }

  /* أعمدة آخر 7 أيام — SVG بصفات لا style (سياسة الأمان) */
  function miniBars(pts) {
    var max = Math.max.apply(null, pts.map(function (p) { return p.v; }).concat([1]));
    var w = 11, gap = 4.5;
    var bars = pts.map(function (p, i) {
      var hh = Math.max(p.v / max * 30, 2);
      return '<rect class="b' + i + (i === pts.length - 1 ? " now" : "") + '" x="' + (i * (w + gap)).toFixed(1) +
        '" y="' + (32 - hh).toFixed(1) + '" width="' + w + '" height="' + hh.toFixed(1) + '" rx="2"/>';
    }).join("");
    return '<svg class="dash-bars" viewBox="0 0 104 32" preserveAspectRatio="none" aria-hidden="true">' + bars + "</svg>";
  }

  function monthDots(d, day) {
    var y = +day.slice(0, 4), mo = +day.slice(5, 7), days = new Date(y, mo, 0).getDate(), out = "";
    for (var i = 1; i <= days; i++) {
      var k = day.slice(0, 8) + (i < 10 ? "0" : "") + i, g = d.days[k];
      var cls = k > day ? "fut" : (g && g.v > 0 ? "on" : "off");
      if (k === day) cls += " now";
      out += '<i class="' + cls + " d" + Math.min(i - 1, 30) + '"></i>';
    }
    return '<div class="mdots">' + out + "</div>";
  }

  var METHOD = { cash: "نقداً", card: "بطاقة", credit: "آجل" };
  function invRow(r, i) {
    return '<div class="row inv d' + Math.min(i, 9) + '">' +
      '<span class="row-ic ' + (r.k === "return" ? "st" : "bk") + '">' + ico(r.ph ? "phone2" : "cart", 17) + "</span>" +
      '<div class="row-main"><div class="row-name">' + (r.k === "return" ? "إرجاع " : "فاتورة ") + r.no +
      ' <span class="muted-t">' + esc(r.at) + "</span></div>" +
      '<div class="row-sub">' + esc(r.n || "") + "</div>" +
      '<div class="row-tags"><span class="tag">' + esc(METHOD[r.m] || r.m || "") + "</span>" +
      (r.c ? '<span class="tag">' + ico("users", 11) + " " + esc(r.c) + "</span>" : "") +
      (r.ph ? '<span class="tag g">' + ico("phone2", 11) + " من التلفون</span>" : "") + "</div></div>" +
      '<div class="row-side"><span class="pill' + (r.t < 0 ? " bad" : "") + '">' + money(r.t) + "</span>" +
      '<span class="row-price">' + r.q + " قطعة</span></div></div>";
  }

  /* ============================================================
     غرفة الخزين
     ============================================================ */
  var roomF = "";
  function paintRoom() {
    var all = A.items().filter(function (g) { return g.room > 0; });
    var dry = all.filter(function (g) { return g.shelfQ <= 0; });
    var list = A.sortItems(roomF === "dry" ? dry : all);
    var q = all.reduce(function (n, g) { return n + g.room; }, 0);
    var h = '<div class="hero room-hero"><div class="hero-v"><span>غرفة الخزين</span><b class="cu">' + q + "</b>" +
      '<i class="cur">نسخة</i></div><div class="hero-sub">' + all.length + " صنف ليست على الرفوف" +
      (dry.length ? " · " + dry.length + " نفد من الرفوف" : "") + "</div></div>";
    if (all.length) {
      h += '<div class="seg2">' +
        '<button class="' + (roomF ? "" : "on") + '" data-act="roomF" data-arg="">الكل <i>' + all.length + "</i></button>" +
        '<button class="' + (roomF === "dry" ? "on" : "") + '" data-act="roomF" data-arg="dry">نفد من الرفوف <i>' + dry.length + "</i></button></div>";
      h += list.length ? '<div class="rows">' + list.map(A.rowHtml).join("") + "</div>"
        : A.emptyBox("check", "لا شيء هنا", "كل ما في الغرفة له نسخ على الرفوف أيضاً.");
    } else {
      h += A.emptyBox("door", "الغرفة فارغة", "كل البضاعة على الرفوف. ما تنقله إلى غرفة الخزين في المنظومة يظهر هنا.");
    }
    el("view").innerHTML = h;
    el("foot").innerHTML = "النقل بين الغرفة والرفوف من المنظومة على الكمبيوتر: المخزون والفروع ← غرفة الخزين.";
  }

  /* ============================================================
     المزيد
     ============================================================ */
  function paintMore() {
    var m = main(), debt = 0, nDebt = 0;
    ((m && m.cust) || []).forEach(function (c) { if (c.b > 0) { debt += c.b; nDebt++; } });
    var al = alertsData();
    var nAl = al.out.length + al.low.length + al.dry.length;
    var tiles = [{ a: "browse", i: "shelf", t: "الرفوف", s: "تصفّح المكتبات والرفوف" }];
    /* الموظفون مفعّلون: الديون لمن عنده صلاحيتها، وملخّص القيمة للمدير */
    if (canP(["debts", "pay"])) tiles.push({ a: "debts", i: "users", t: "الزبائن والديون", s: nDebt ? money(debt) + " على " + nDebt + " زبون" : "لا ديون", c: nDebt ? "warn" : "" });
    tiles.push({ a: "alerts", i: "alert", t: "التنبيهات والراكد", s: nAl + " تنبيه · " + al.slow.length + " راكد", c: nAl ? "bad" : "" });
    if (!staffInfo() || canP("profits")) tiles.push({ a: "stats", i: "grid", t: "ملخّص المخزون", s: "القيمة والتصنيفات" });
    if (inApp && shop() && canP(["items", "count"])) tiles.push({ a: "loc", i: "pin", t: "تسجيل الأماكن", s: "مكتبة ورف، ثم امسح الكتب" });
    if (inApp) tiles.push({ a: "orders", i: "phone2", t: "مبيعات هذا التلفون", s: S().orders.length + " فاتورة" });
    tiles.push({ a: "settings", i: "gear", t: "الإعدادات", s: "الربط والإشعارات" });
    if (me && staffInfo()) tiles.push({ a: "phLogout", i: "lock", t: "خروج", s: me.n, act: 1 });
    el("view").innerHTML = '<div class="more-grid">' + tiles.map(function (x, i) {
      return '<button class="more-tile d' + i + (x.c ? " " + x.c : "") + '" data-act="' + (x.act ? x.a : "go") + '" data-arg="' + (x.act ? "" : x.a) + '">' +
        '<span class="mt-ic">' + ico(x.i, 22) + "</span><b>" + x.t + "</b><span>" + esc(x.s) + "</span></button>";
    }).join("") + "</div>";
    el("foot").innerHTML = "";
  }

  /* ============================================================
     الزبائن والديون
     ============================================================ */
  function paintDebts() {
    var m = main();
    if (!m || !m.cust) {
      el("view").innerHTML = crumb("الزبائن والديون") + A.emptyBox("users", "الزبائن تنتظر المنظومة",
        "تظهر بعد تحديث المنظومة على الكمبيوتر إلى 2.6 أو أحدث.");
      el("foot").innerHTML = "";
      return;
    }
    var list = m.cust.filter(function (c) { return c.b > 0; }).sort(function (a, b) { return b.b - a.b; });
    var tot = list.reduce(function (n, c) { return n + c.b; }, 0);
    var shop = m.branch && m.branch.name ? m.branch.name : "المكتبة";
    var h = crumb("الزبائن والديون") +
      '<div class="hero debt-hero"><div class="hero-v"><span>الديون على الزبائن</span><b class="cu">' + money(tot) +
      '</b><i class="cur">' + esc(cur()) + '</i></div><div class="hero-sub">' + list.length + " زبون عليه دين · " +
      m.cust.length + " زبون مسجّل</div></div>";
    if (!list.length) h += A.emptyBox("check", "لا ديون", "كل الزبائن سدّدوا ما عليهم.");
    else {
      h += '<div class="rows">' + list.map(function (c, i) {
        var wa = waLink(c.ph, "السلام عليكم " + c.n + "، نذكّركم بمبلغ " + money(c.b) + " " + cur() +
          " متبقٍّ لدى " + shop + ". شكراً لكم.");
        return '<div class="row debt d' + Math.min(i, 9) + '">' +
          '<span class="row-ic bk">' + ico("users", 17) + "</span>" +
          '<div class="row-main"><div class="row-name">' + esc(c.n) + "</div>" +
          '<div class="row-sub ltr">' + esc(c.ph || "بلا رقم") + "</div>" +
          '<div class="row-acts">' +
          (c.ph ? '<a class="mini-btn" href="tel:' + esc(String(c.ph).replace(/[^\d+]/g, "")) + '">' + ico("phone", 14) + " اتصال</a>" : "") +
          (wa ? '<a class="mini-btn wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + ico("chat", 14) + " تذكير واتساب</a>" : "") +
          "</div></div>" +
          '<div class="row-side"><span class="pill bad">' + money(c.b) + "</span></div></div>";
      }).join("") + "</div>";
    }
    el("view").innerHTML = h;
    el("foot").innerHTML = "للعرض فقط: التسديد يُسجَّل في المنظومة على الكمبيوتر.";
  }

  /* رقم ليبي 09x… ⇦ 2189x… لرابط واتساب */
  function waLink(ph, text) {
    var d = String(ph || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.indexOf("00") === 0) d = d.slice(2);
    if (d.indexOf("0") === 0) d = "218" + d.slice(1);
    else if (d.length === 9 && d[0] === "9") d = "218" + d;
    if (d.length < 10) return "";
    return "https://wa.me/" + d + "?text=" + encodeURIComponent(text);
  }

  function crumb(t) {
    return '<div class="crumb"><button data-act="go" data-arg="more">المزيد</button><span class="sep">/</span>' +
      '<span class="cur">' + esc(t) + "</span></div>";
  }

  /* ============================================================
     التنبيهات والراكد
     ============================================================ */
  function alertsData() {
    var all = A.items();
    return {
      out: all.filter(function (g) { return g.total <= 0; }),
      low: all.filter(function (g) { return g.total > 0 && g.low; }),
      dry: all.filter(function (g) { return g.room > 0 && g.shelfQ <= 0; }),
      slow: all.filter(function (g) { return g.sl > 0 && g.total > 0; }).sort(function (a, b) { return b.sl - a.sl; })
    };
  }
  var alertF = "out";
  function paintAlerts() {
    var d = alertsData();
    var segs = [["out", "نفد", d.out], ["low", "قارب", d.low], ["dry", "املأ الرفوف", d.dry], ["slow", "راكد", d.slow]];
    if (!d[alertF].length) { for (var i = 0; i < segs.length; i++) if (segs[i][2].length) { alertF = segs[i][0]; break; } }
    var list = d[alertF];
    var h = crumb("التنبيهات والراكد") + '<div class="seg2 four">' + segs.map(function (x) {
      return '<button class="' + (alertF === x[0] ? "on" : "") + (x[2].length && x[0] !== "slow" ? " hot" : "") +
        '" data-act="alertF" data-arg="' + x[0] + '">' + x[1] + " <i>" + x[2].length + "</i></button>";
    }).join("") + "</div>";
    var lead = {
      out: "لم يبقَ منها شيء في أي مكان.",
      low: "وصلت لحد التنبيه الذي ضبطته في المنظومة.",
      dry: "نفدت من الرفوف ولها نسخ في غرفة الخزين — اجلبها.",
      slow: "لم يُبع منها شيء منذ مدة (حسب إعداد «الراكد» في المنظومة)."
    }[alertF];
    h += '<p class="lead">' + lead + "</p>";
    if (!list.length) h += A.emptyBox("check", "لا شيء هنا", "ممتاز — لا يوجد ما يستحق الانتباه في هذا القسم.");
    else {
      h += '<div class="rows">' + A.sortItems(list).slice(0, 200).map(function (g, i) {
        var r = A.rowHtml(g, i);
        if (alertF === "slow") r = r.replace('<div class="row-tags">', '<div class="row-tags"><span class="tag a">' + ico("zzz", 11) + " راكد " + g.sl + " يوم</span>");
        return r;
      }).join("") + "</div>";
      if (list.length > 200) h += '<p class="sub">وأكثر: ' + (list.length - 200) + " صنف.</p>";
    }
    el("view").innerHTML = h;
    el("foot").innerHTML = "";
  }

  /* ============================================================
     البيع من التلفون
     ============================================================ */
  function paintSell() {
    var v = el("view"), s = S(), m = main();
    if (!canP("sell")) { v.innerHTML = A.emptyBox("lock", "البيع ليس من صلاحياتك", "اطلب من المدير صلاحية البيع."); el("foot").innerHTML = ""; return; }
    var cart = s.cart, sub = subtotal(), disc = discNow(), tot = r3(sub - disc);
    var stopped = m && m.phoneSell === false;
    var h = "";
    if (stopped) {
      h += '<div class="warnbox">' + ico("alert", 18) + "<div><b>البيع من التلفون موقوف في المنظومة</b>" +
        "<span>الفواتير تُحفظ هنا وتنتظر حتى يُسمح به على الكمبيوتر (المخزون والفروع).</span></div></div>";
    }
    h += '<div class="search sell-search"><input id="sellQ" class="search-inp" type="search" autocomplete="off" ' +
      'enterkeyhint="search" placeholder="اسم الكتاب أو الباركود…" aria-label="بحث للبيع">' +
      (inApp ? '<button class="search-cam" data-act="scan" aria-label="مسح بالكاميرا">' + ico("camera", 20) + "</button>" : "") +
      '</div><div id="sellSug"></div>';

    if (!cart.length) {
      h += '<div class="empty sell-empty">' + ico("cart", 52) + "<h3>السلة فارغة</h3>" +
        "<p>امسح باركود الكتاب بالكاميرا، أو ابحث باسمه وأضفه.</p></div>";
    } else {
      h += '<div class="cart">' + cart.map(function (l, i) {
        var g = findGroup(l);
        var left = g ? g.total : null;
        return '<div class="cline" data-i="' + i + '">' +
          '<button class="cx" data-act="cartDel" data-arg="' + i + '" aria-label="حذف">' + ico("x", 14) + "</button>" +
          '<div class="cl-main"><b>' + esc(l.n) + "</b><span>" + money(l.p) + " × " + l.q + " = <b>" + money(l.p * l.q) + "</b></span>" +
          (left !== null && left < 0 ? '<span class="tag r">أكثر من المتوفر</span>' : "") + "</div>" +
          '<div class="qty"><button data-act="cartQty" data-arg="' + i + '" data-arg2="1">' + ico("plus", 16) + "</button>" +
          "<b>" + l.q + "</b>" +
          '<button data-act="cartQty" data-arg="' + i + '" data-arg2="-1">' + ico("minus", 16) + "</button></div></div>";
      }).join("") + "</div>";

      var custs = ((m && m.cust) || []).slice().sort(function (a, b) { return String(a.n).localeCompare(String(b.n), "ar"); });
      h += '<div class="card pay">' +
        '<div class="kv"><dt>المجموع</dt><dd class="ltr">' + money(sub) + "</dd></div>" +
        (canP("discount") ? '<label class="fld inline"><span>الخصم</span><input class="inp ltr" id="sellDisc" inputmode="decimal" value="' + esc(s.sell.disc) + '" placeholder="0"></label>' : "") +
        '<div class="grand"><span>الصافي</span><b class="ltr">' + money(tot) + " " + esc(cur()) + "</b></div>" +
        '<div class="seg2 pay-m">' + ["cash", "card", "credit"].map(function (k) {
          return '<button class="' + (s.sell.method === k ? "on" : "") + '" data-act="payM" data-arg="' + k + '">' + METHOD[k] + "</button>";
        }).join("") + "</div>" +
        (s.sell.method === "credit"
          ? '<label class="fld"><span>الزبون</span><select class="inp" id="sellCust"><option value="">— اختر الزبون —</option>' +
            custs.map(function (c) {
              return '<option value="' + esc(c.id) + '"' + (s.sell.cust === c.id ? " selected" : "") + ">" + esc(c.n) +
                (c.b > 0 ? " (عليه " + money(c.b) + ")" : "") + "</option>";
            }).join("") + "</select></label>" +
            '<label class="fld"><span>المدفوع الآن</span><input class="inp ltr" id="sellPaid" inputmode="decimal" value="' + esc(s.sell.paid) + '" placeholder="0"></label>'
          : "") +
        '<button class="btn primary wide big" data-act="checkout">' + ico("check", 18) + " إتمام البيع · " + money(tot) + "</button>" +
        '<button class="btn wide mt" data-act="cartClear">إفراغ السلة</button></div>';
    }
    v.innerHTML = h;
    el("foot").innerHTML = "تُرسل الفاتورة للمنظومة على الكمبيوتر فتسجّلها بخصم المخزون والدين. " +
      "إن لم يكن إنترنت تُحفظ هنا وتُرسل وحدها لاحقاً.";
    wireSell();
  }

  function wireSell() {
    var q = el("sellQ"), t = null;
    if (q) {
      q.addEventListener("input", function () { var val = this.value; clearTimeout(t); t = setTimeout(function () { suggest(val); }, 110); });
      q.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        var res = exact(this.value) ? null : A.search(A.items(), this.value);
        var hit = exact(this.value) || (A.exactCount(res) ? res[0] : null);
        if (hit) { addToCart(hit); this.value = ""; suggest(""); }
        else if (res && res.length) { suggest(this.value); A.toast("ما لقيناش الاسم بالضبط — اختر من «هل تقصد؟».", "warn"); }
        else A.toast("لا يوجد صنف بهذا الاسم أو الباركود.", "warn");
      });
    }
    var d = el("sellDisc");
    if (d) d.addEventListener("change", function () { S().sell.disc = this.value; A.save(); paintSell(); });
    var c = el("sellCust");
    if (c) c.addEventListener("change", function () { S().sell.cust = this.value; A.save(); });
    var p = el("sellPaid");
    if (p) p.addEventListener("change", function () { S().sell.paid = this.value; A.save(); });
  }

  function suggest(qv) {
    var host = el("sellSug");
    if (!host) return;
    if (!String(qv || "").trim()) { host.innerHTML = ""; return; }
    var all = A.search(A.items(), qv), res = all.slice(0, 8);
    host.innerHTML = res.length ? '<div class="sugs">' + res.map(function (g, i) {
      return A.nearHead(all, i) + '<button class="sug" data-act="cartAdd" data-arg="' + esc(g.key) + '">' +
        '<span class="sg-main"><b>' + esc(g.n) + "</b><span>" + esc(g.a || g.d || "") + "</span></span>" +
        '<span class="sg-side"><b>' + money(g.p) + '</b><span class="' + (g.total <= 0 ? "out" : "") + '">متوفر ' + g.total + "</span></span></button>";
    }).join("") + "</div>" : '<p class="sub">لا نتائج.</p>';
  }

  function exact(code) {
    code = String(code || "").trim();
    if (!code) return null;
    return A.items().filter(function (g) {
      return String(g.b || "").trim() === code || String(g.code || "").toUpperCase() === code.toUpperCase();
    })[0] || null;
  }

  function findGroup(l) {
    return A.items().filter(function (g) {
      return (l.b && g.b === l.b) || (!l.b && l.k && g.code === l.k) || g.key === l.key;
    })[0] || null;
  }

  function addToCart(g, price) {
    var s = S(), ex = null;
    /* طرابلس: الكتاب الذي بلا سعر لا يُباع حتى يُسعَّر، والسعر يُحفظ في المنظومة */
    if (shop() && A.num(g.p) <= 0 && !(price > 0)) {
      var had = s.cart.filter(function (l) { return l.key === g.key && l.p > 0; })[0];
      if (!had) { askPrice(g); return; }
    }
    s.cart.forEach(function (l) { if (l.key === g.key) ex = l; });
    if (ex) ex.q++;
    else s.cart.unshift({ key: g.key, b: g.b || "", k: g.code || "", n: g.n, p: price > 0 ? price : A.num(g.p), q: 1, zp: price > 0 ? 1 : undefined });
    A.save();
    if (g.total <= 0) A.toast("تنبيه: «" + g.n + "» غير متوفر حسب آخر تحديث.", "warn");
    paintSell();
    var first = document.querySelector(".cline");
    if (first) first.classList.add("pop");
  }

  function r3(v) { return Math.round(A.num(v) * 1000) / 1000; }
  function subtotal() { return r3(S().cart.reduce(function (a, l) { return a + A.num(l.p) * A.num(l.q); }, 0)); }
  function discNow() { return canP("discount") ? Math.min(Math.max(A.num(S().sell.disc), 0), subtotal()) : 0; }

  function checkout() {
    var s = S(), m = main();
    if (!s.cart.length) return;
    var method = s.sell.method;
    var cust = null;
    if (method === "credit") {
      cust = ((m && m.cust) || []).filter(function (c) { return c.id === s.sell.cust; })[0];
      if (!cust) { A.toast("اختر الزبون للبيع الآجل.", "warn"); return; }
    }
    var tot = r3(subtotal() - discNow());
    var o = {
      id: "o" + Date.now().toString(36) + rand(4), date: localToday(), at: nowStamp(),
      items: s.cart.map(function (l) { return { b: l.b, k: l.k, n: l.n, q: A.num(l.q), p: A.num(l.p), zp: l.zp ? 1 : undefined }; }),
      disc: discNow(), method: method, cust: cust ? cust.id : "", custName: cust ? cust.n : "",
      paid: method === "credit" ? Math.min(Math.max(A.num(s.sell.paid), 0), tot) : tot,
      total: tot, status: "pending", to: m && m.branch ? m.branch.id : ""
    };
    stamp(o);
    s.orders.unshift(o);
    if (s.orders.length > 80) s.orders.length = 80;
    s.cart = [];
    s.sell = { disc: "", method: "cash", cust: "", paid: "" };
    A.save();
    done(o);
    paintSell();
    push();
  }

  /* علامة ✓ تُرسم وسط الشاشة — كما في المنظومة بعد إتمام البيع */
  function done(o) {
    var old = document.querySelector(".done-pop");
    if (old) old.parentNode.removeChild(old);
    var e = document.createElement("div");
    e.className = "done-pop";
    e.innerHTML = '<div class="dp-card"><svg class="dp-check" viewBox="0 0 52 52"><circle class="dp-c" cx="26" cy="26" r="23"/>' +
      '<path class="dp-t" d="M15 27l7.5 7.5L37.5 19"/></svg><div class="dp-title">تم البيع</div>' +
      '<div class="dp-sub">' + money(o.total) + " " + esc(cur()) + '</div><div class="dp-note">تُرسل للمنظومة الآن</div>' +
      /* طرابلس: كما في المنظومة — اطبع الإيصال أو اتركه */
      (shop() ? '<div class="dp-acts"><button class="btn primary" data-act="rcPrint" data-arg="' + esc(o.id) + '">' + ico("print", 16) + " طباعة الإيصال</button>" +
        '<button class="btn" data-act="rcSkip">بدون طباعة</button></div>' : "") + "</div>";
    document.body.appendChild(e);
    if (shop()) { e.classList.add("ask"); return; }
    setTimeout(function () { e.classList.add("out"); }, 1300);
    setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 1700);
  }

  /* ---------- الإرسال إلى خادم الربط ----------
     ملف هذا التلفون: الفواتير التي لم يؤكّدها الكمبيوتر بعد. لا أصناف
     ولا كميات — التلفون لا يكتب في المخزون أبداً. */
  function hasPending() { return S().orders.some(function (o) { return o.status === "pending"; }); }
  function push() {
    if (!A.configured()) return;
    if (pushing) { pushAgain = true; return; }
    var s = S();
    var pend = s.orders.filter(function (o) { return o.status === "pending"; });
    var pendE = s.edits.filter(function (e) { return e.status === "pending"; });
    if (!pend.length && !pendE.length && s.pushedEmpty) return;
    pushing = true;
    var body = {
      kind: "phone", at: nowStamp(),
      branch: { id: s.phone.id, name: s.phone.name || "تلفون" },
      items: [],
      orders: pend.map(function (o) {
        return { id: o.id, date: o.date, at: o.at, items: o.items, disc: o.disc, method: o.method, cust: o.cust, paid: o.paid, to: o.to || "", by: o.by, byName: o.byName };
      }),
      edits: pendE.map(function (e) { return { id: e.id, b: e.b, k: e.k, set: e.set, to: e.to || "", by: e.by }; })
    };
    var base = String(s.cfg.url).trim().replace(/\/+$/, "");
    fetch(base + "/put", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Shop-Key": String(s.cfg.key || "") },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      pend.forEach(function (o) { o.sent = true; });
      pendE.forEach(function (e) { e.sent = true; });
      s.pushedEmpty = !pend.length && !pendE.length;
      A.save();
      if (pend.length && (S().screen === "orders" || S().screen === "dash")) A.render();
    }).catch(function () {
      /* بلا إنترنت: تبقى هنا وتُرسل عند عودة الاتصال أو التحديث القادم */
    }).then(function () {
      pushing = false;
      if (pushAgain) { pushAgain = false; push(); }
    });
  }

  /* تأكيدات الكمبيوتر: رقم الفاتورة لكل طلب سُجّل */
  function takeAcks() {
    var s = S(), acks = {}, changed = false, newly = [];
    ((s.snap && s.snap.branches) || []).forEach(function (b) {
      if (A.isPhone(b) || !b.acks) return;
      Object.keys(b.acks).forEach(function (k) { acks[k] = b.acks[k]; });
    });
    s.orders.forEach(function (o) {
      if (o.status !== "pending" || !(o.id in acks)) return;
      o.status = acks[o.id] ? "done" : "fail";
      o.inv = acks[o.id] || 0;
      changed = true;
      if (o.status === "done") newly.push(o);
    });
    s.edits.forEach(function (e) {
      if (e.status !== "pending" || !(e.id in acks)) return;
      e.status = acks[e.id] ? "done" : "fail";
      changed = true;
    });
    if (s.edits.length > 60) s.edits = s.edits.slice(0, 60);
    if (changed) { s.pushedEmpty = false; push(); }
    return newly;
  }

  /* نسخ بيعت هنا ولم يسجّلها الكمبيوتر بعد: تُطرح من المعروض */
  function adjust(list) {
    var pend = S().orders.filter(function (o) { return o.status === "pending"; });
    var pendE = S().edits.filter(function (e) { return e.status === "pending"; });
    if (!pend.length && !pendE.length) return;
    var byB = {}, byK = {};
    list.forEach(function (g) { if (g.b) byB[g.b] = g; if (g.code) byK[String(g.code).toUpperCase()] = g; });
    /* تعديل أُرسل ولم يُطبَّق بعد: يظهر فوراً مع شارة «بانتظار الكمبيوتر» */
    pendE.forEach(function (e) {
      var g = (e.b && byB[e.b]) || (e.k && byK[String(e.k).toUpperCase()]);
      if (!g) return;
      var f = e.set || {};
      if (f.n) g.n = f.n;
      if (f.a !== undefined) g.a = f.a;
      if (f.p !== undefined) g.p = A.num(f.p);
      if (f.m !== undefined) g.minTop = A.num(f.m);
      if (f.qd) { g.total += A.num(f.qd); g.shelfQ += A.num(f.qd); }
      g.low = g.minTop > 0 && g.total > 0 && g.total <= g.minTop;
      g.editing = true;
    });
    pend.forEach(function (o) {
      o.items.forEach(function (l) {
        var g = (l.b && byB[l.b]) || (l.k && byK[String(l.k).toUpperCase()]);
        if (!g) return;
        g.total -= l.q; g.shelfQ -= l.q; g.pend = (g.pend || 0) + l.q;
        g.low = g.minTop > 0 && g.total > 0 && g.total <= g.minTop;
      });
    });
  }

  function paintOrders() {
    var s = S(), list = s.orders;
    var tday = list.filter(function (o) { return o.date === localToday() && o.status !== "fail"; });
    var h = crumb("مبيعات هذا التلفون") +
      '<div class="hero"><div class="hero-v"><span>بيع هذا التلفون اليوم</span><b class="cu">' +
      money(tday.reduce(function (a, o) { return a + o.total; }, 0)) + '</b><i class="cur">' + esc(cur()) + "</i></div>" +
      '<div class="hero-sub">' + tday.length + " فاتورة · اسم التلفون في المنظومة: " + esc(s.phone.name || "تلفون") + "</div></div>";
    if (!list.length) h += A.emptyBox("cart", "لم تبع من هذا التلفون بعد", "افتح تبويب «بيع» في الأسفل.");
    else {
      h += '<div class="rows">' + list.map(function (o, i) {
        var st = o.status === "done" ? '<span class="tag g">' + ico("check", 11) + " فاتورة رقم " + o.inv + "</span>"
          : o.status === "fail" ? '<span class="tag r">لم تُسجَّل — أصناف غير موجودة في المنظومة</span>'
          : '<span class="tag a">' + ico("clock", 11) + (o.sent ? " أُرسلت — تنتظر الكمبيوتر" : " لم تُرسل بعد") + "</span>";
        return '<div class="row d' + Math.min(i, 9) + '"><span class="row-ic bk">' + ico("cart", 17) + "</span>" +
          '<div class="row-main"><div class="row-name">' + esc(o.items.map(function (l) { return l.n; }).join("، ")) + "</div>" +
          '<div class="row-sub">' + esc(o.at) + " · " + esc(METHOD[o.method] || "") + (o.custName ? " · " + esc(o.custName) : "") + "</div>" +
          '<div class="row-tags">' + st + "</div></div>" +
          '<div class="row-side"><span class="pill">' + money(o.total) + "</span></div></div>";
      }).join("") + "</div>";
    }
    el("view").innerHTML = h;
    el("foot").innerHTML = "الكمبيوتر يسجّل الفواتير عند تحديثه (كل بضع دقائق). اجعل التحديث التلقائي كل دقيقتين ليصل البيع أسرع.";
  }

  /* ============================================================
     الإشعارات داخل التطبيق — الجرس
     ============================================================ */
  function events() {
    var s = S(), n = s.notif, ev = [];
    var d = alertsData();
    if (n.stock) {
      /* «نفد» لما يهمّ: صنف له حد تنبيه، أو بِيع منه في آخر 30 يوماً. مكتبة فيها عشرات
         الآلاف من الكتب (طرابلس، ومنها ما لم يُجرد بعد) لا يصير جرسها آلاف السطور */
      var since = new Date(Date.now() - 30 * 864e5), p2 = function (x) { return (x < 10 ? "0" : "") + x; };
      var recent = since.getFullYear() + "-" + p2(since.getMonth() + 1) + "-" + p2(since.getDate());
      d.out.forEach(function (g) {
        if (!(g.minTop > 0) && !(g.ls && String(g.ls) >= recent)) return;
        ev.push({ k: "out:" + g.key, lv: "bad", t: "نفد: " + g.n, s: "لم يبقَ منه شيء", key: g.key });
      });
      d.low.forEach(function (g) { ev.push({ k: "low:" + g.key, lv: "warn", t: "قارب على النفاد: " + g.n, s: "بقي " + g.total, key: g.key }); });
    }
    if (n.restock) d.dry.forEach(function (g) { ev.push({ k: "dry:" + g.key, lv: "info", t: "املأ الرفوف: " + g.n, s: "في غرفة الخزين " + g.room, key: g.key }); });
    var m = main();
    if (n.daily && m && m.dash && m.dash.today === localToday() && new Date().getHours() >= 20) {
      var t = m.dash.days[m.dash.today] || { v: 0, n: 0 };
      ev.push({ k: "daily:" + m.dash.today, lv: "ok", t: "ملخّص اليوم", s: money(t.v) + " " + cur() + " من " + t.n + " فاتورة", go: "dash" });
    }
    if (n.sync && m && m.at) {
      var a = A.ageOf(m.at);
      if (a.mins >= 180) ev.push({ k: "sync:" + localToday() + ":" + Math.floor(new Date().getHours() / 6), lv: "bad",
        t: "المنظومة لم تُحدَّث منذ " + a.txt.replace(/^منذ /, ""), s: "الكمبيوتر مغلق أو بلا إنترنت؟", go: "settings" });
    }
    s.orders.forEach(function (o) {
      if (o.status === "done") ev.push({ k: "ack:" + o.id, lv: "ok", t: "سُجّلت فاتورة رقم " + o.inv, s: money(o.total) + " " + cur(), go: "orders" });
    });
    return ev;
  }

  function unread(ev) { return ev.filter(function (e) { return !S().seen[e.k]; }); }

  function chrome() {
    var top = el("top");
    if (!top) return;
    brand();
    paintLock();
    var b = el("btnBell");
    if (!b) {
      b = document.createElement("button");
      b.id = "btnBell"; b.className = "icon-btn bell";
      b.setAttribute("data-act", "bell"); b.setAttribute("aria-label", "الإشعارات");
      var ref = el("btnRefresh");
      top.insertBefore(b, ref || null);
    }
    var nU = S().snap ? unread(events()).length : 0;
    b.innerHTML = ico("bell", 20) + (nU ? '<i class="bdg">' + (nU > 99 ? "99+" : nU) + "</i>" : "");
    b.classList.toggle("has", nU > 0);
  }

  function ring() {
    var b = el("btnBell");
    if (!b || A.reduced()) return;
    b.classList.remove("ring"); void b.offsetWidth; b.classList.add("ring");
  }

  function openBell() {
    var ev = events(), s = S();
    var order = { bad: 0, warn: 1, info: 2, ok: 3 };
    ev.sort(function (a, b) {
      var ua = s.seen[a.k] ? 1 : 0, ub = s.seen[b.k] ? 1 : 0;
      return ua - ub || order[a.lv] - order[b.lv];
    });
    var h = '<div class="inner bell-inner"><div class="grab"></div><div class="bell-head"><h2>' + ico("bell", 18) + " الإشعارات</h2>" +
      (unread(ev).length ? '<button class="btn sm" data-act="bellRead">تحديد الكل كمقروء</button>' : "") + "</div>";
    if (!ev.length) h += A.emptyBox("check", "لا إشعارات", "كل شيء على ما يرام.");
    else h += '<div class="bell-list">' + ev.slice(0, 60).map(function (e, i) {
      return '<button class="bell-item ' + e.lv + (s.seen[e.k] ? "" : " new") + " d" + Math.min(i, 9) + '" data-act="bellGo" data-arg="' + esc(e.k) + '">' +
        '<span class="bi-dot"></span><span class="bi-main"><b>' + esc(e.t) + "</b><span>" + esc(e.s || "") + "</span></span></button>";
    }).join("") + "</div>" + (ev.length > 60 ? '<p class="sub">و' + (ev.length - 60) + " غيرها.</p>" : "");
    h += '<div class="det-acts"><button class="btn primary" data-act="closeSheet">إغلاق</button></div></div>';
    var sh = el("sheet");
    sh.classList.remove("closing");
    sh.innerHTML = h;
    sh.hidden = false;
    var inner = sh.querySelector(".inner");
    if (inner) inner.classList.add("morph", "otr");
    sh.onclick = function (e) { if (e.target === sh) A.closeSheet(); };
    document.body.style.overflow = "hidden";
    sh.setAttribute("data-bell", "1");
  }

  function bellGo(k) {
    var e = events().filter(function (x) { return x.k === k; })[0];
    S().seen[k] = 1; A.save();
    A.closeSheet();
    if (!e) return;
    setTimeout(function () {
      if (e.key) A.open(e.key);
      else if (e.go) A.go(e.go);
      chrome();
    }, 220);
  }

  function bellRead() {
    events().forEach(function (e) { S().seen[e.k] = 1; });
    A.save(); chrome(); openBell();
  }

  /* بعد كل تحديث: التأكيدات، ثم هل ظهر جديد يستحق رنّة الجرس؟ */
  function afterRefresh(first) {
    var s = S();
    refreshMe();
    takeAcks();
    var ev = events();
    if (!s.seenInit) {                   // أول مرة: ما كان قائماً لا يُعدّ جديداً
      ev.forEach(function (e) { if (e.k.indexOf("ack:") !== 0) s.seen[e.k] = 1; });
      s.seenInit = true;
    }
    // تنظيف: مفاتيح لم تعد قائمة تُنسى، فيعود التنبيه إن تكرّر لاحقاً
    var live = {};
    ev.forEach(function (e) { live[e.k] = 1; });
    Object.keys(s.seen).forEach(function (k) { if (!live[k]) delete s.seen[k]; });
    var nU = unread(ev).length;
    if (!first && nU > (s.lastUnread || 0)) setTimeout(ring, 350);
    s.lastUnread = nU;
    if (!first && main() && main().dash && S().screen === "home" && !S().q && !S().filter && S().openedOnce !== true) {
      S().openedOnce = true;
    }
  }

  /* ============================================================
     تعديل صنف من التلفون (داخل التطبيق)
     ============================================================ */
  function detailActs(g) {
    if (!inApp || !canP(["items", "price", "goods", "count"])) return "";
    var pe = S().edits.filter(function (e) { return e.status === "pending" && ((e.b && e.b === g.b) || (!e.b && e.k === g.code)); }).length;
    return '<div class="det-edit">' +
      (pe ? '<span class="tag a">' + ico("clock", 11) + " تعديل بانتظار الكمبيوتر</span>" : "") +
      '<button class="btn wide" data-act="editItem" data-arg="' + esc(g.key) + '">' + ico("edit", 16) + " تعديل الصنف</button></div>";
  }

  function editItem(key) {
    var g = A.items().filter(function (x) { return x.key === key; })[0];
    if (!g) return;
    if (!g.b && !g.code) { A.toast("هذا الصنف بلا باركود ولا رمز — عدّله من الكمبيوتر.", "warn"); return; }
    var w = g.at.filter(function (x) { return x.place.kind === "branch"; })[0] || g.at[0] || {};
    var isB = g.t === "book";
    /* الموظفون مفعّلون: كل حقل بصلاحيته (والكمبيوتر يراجعها من جديد) */
    var can = { n: canP("items"), p: canP("price"), m: canP(["goods", "items"]), q: canP(["count", "goods"]), l: canP(["items", "count"]) };
    var key2 = { eN: "n", eA: "n", eP: "p", eM: "m", eL: "l", eS: "l", eLoc: "l" };
    function fld(id, lbl, val, attrs) {
      var off = key2[id] && !can[key2[id]];
      return '<label class="fld"><span>' + lbl + '</span><input class="inp" id="' + id + '" value="' + esc(val == null ? "" : val) + '"' + (attrs || "") + (off ? " disabled" : "") + "></label>";
    }
    var h = '<div class="inner"><div class="grab"></div><div class="det-head"><h2>' + ico("edit", 18) + " تعديل الصنف</h2>" +
      '<p class="by">يُرسل للمنظومة على الكمبيوتر فتطبّقه في أول تحديث.</p></div>' +
      fld("eN", isB ? "اسم الكتاب" : "اسم الصنف", g.n) +
      fld("eA", isB ? "المؤلف" : "الماركة", g.a) +
      '<div class="two">' + fld("eP", "سعر البيع", g.p, ' inputmode="decimal" dir="ltr"') +
      fld("eM", "حد التنبيه", g.minTop || 0, ' inputmode="numeric" dir="ltr"') + "</div>" +
      '<label class="fld"><span>الكمية الكلية (الآن ' + g.total + ')</span><div class="stepper">' +
      '<button type="button" data-act="eStep" data-arg="-1">' + ico("minus", 18) + "</button>" +
      '<input class="inp" id="eQ" inputmode="numeric" dir="ltr" value="' + g.total + '" data-was="' + g.total + '"' + (can.q ? "" : " disabled") + ">" +
      '<button type="button" data-act="eStep" data-arg="1">' + ico("plus", 18) + "</button></div>" +
      '<small class="fld-hint" id="eQd"></small></label>' +
      (isB ? '<div class="two">' + fld("eL", "المكتبة", w.lib || "") + fld("eS", "الرف", w.shelf || "", ' inputmode="numeric" dir="ltr"') + "</div>"
           : fld("eLoc", "المكان", w.loc || "")) +
      '<div class="det-acts"><button class="btn primary" data-act="editSave" data-arg="' + esc(key) + '">' + ico("check", 16) + " حفظ وإرسال</button>" +
      '<button class="btn" data-act="closeSheet">إلغاء</button></div></div>';
    var sh = el("sheet");
    sh.classList.remove("closing");
    sh.innerHTML = h;
    sh.hidden = false;
    var inner = sh.querySelector(".inner");
    if (inner) inner.classList.add("morph", "omc");
    document.body.style.overflow = "hidden";
    var q = el("eQ");
    if (q) q.addEventListener("input", qdHint);
    qdHint();
  }

  function qdHint() {
    var q = el("eQ"), hint = el("eQd");
    if (!q || !hint) return;
    var d = A.num(q.value) - A.num(q.getAttribute("data-was"));
    hint.textContent = d ? (d > 0 ? "سيُضاف " + d + " إلى الكمية في المنظومة" : "سيُنقص " + (-d) + " من الكمية في المنظومة") : "";
    hint.className = "fld-hint" + (d ? (d > 0 ? " up" : " down") : "");
  }

  function editSave(key) {
    var g = A.items().filter(function (x) { return x.key === key; })[0];
    if (!g) return;
    function v(id) { var e = el(id); return e && !e.disabled ? e.value.trim() : undefined; }
    var set = {}, isB = g.t === "book";
    var w = g.at.filter(function (x) { return x.place.kind === "branch"; })[0] || g.at[0] || {};
    if (v("eN") && v("eN") !== g.n) set.n = v("eN");
    if (v("eA") !== undefined && v("eA") !== (g.a || "")) set.a = v("eA");
    if (v("eP") !== undefined && A.num(v("eP")) !== A.num(g.p)) set.p = A.num(v("eP"));
    if (v("eM") !== undefined && A.num(v("eM")) !== A.num(g.minTop)) set.m = A.num(v("eM"));
    var qd = v("eQ") === undefined ? 0 : A.num(v("eQ")) - A.num(el("eQ").getAttribute("data-was"));
    if (qd) set.qd = qd;
    if (isB) {
      if (v("eL") !== undefined && v("eL") !== (w.lib || "")) set.l = v("eL");
      if (v("eS") !== undefined && v("eS") !== (w.shelf || "")) set.s = v("eS");
    } else if (v("eLoc") !== undefined && v("eLoc") !== (w.loc || "")) set.loc = v("eLoc");
    if (!Object.keys(set).length) { A.closeSheet(); A.toast("لم يتغيّر شيء."); return; }
    var m = main();
    S().edits.unshift(stamp({ id: "e" + Date.now().toString(36) + rand(4), b: g.b || "", k: g.code || "", n: g.n, set: set,
      at: nowStamp(), status: "pending", to: m && m.branch ? m.branch.id : "" }));
    S().pushedEmpty = false;
    A.save();
    A.closeSheet();
    A.render();
    A.toast("أُرسل التعديل — يُطبَّق في المنظومة عند تحديثها.", "ok");
    push();
  }

  /* ---------- الإشعارات: الحالة والاختبار ---------- */
  function notifStatus() {
    if (!window.AndroidApp || !window.AndroidApp.notifyStatus) return "";
    try { return window.AndroidApp.notifyStatus(); } catch (e) { return ""; }
  }
  function paintNotifState() {
    var host = el("nfState");
    if (!host) return;
    var st = notifStatus();
    host.className = "nf-state " + st;
    host.innerHTML = st === "on" ? ico("check", 16) + " الإشعارات مسموحة على هذا التلفون"
      : st === "ask" ? ico("bell", 16) + " لم تسمح بالإشعارات بعد — اضغط «السماح بالإشعارات»"
      : st === "off" ? ico("alert", 16) + " الإشعارات ممنوعة لهذا التطبيق — اسمح بها من إعدادات التلفون"
      : "";
  }

  /* ---------- الإعدادات ---------- */
  function settingsHtml() {
    var s = S(), n = s.notif;
    function chk(k, t, sub) {
      return '<label class="chk"><input type="checkbox" id="nf_' + k + '"' + (n[k] ? " checked" : "") + "><span><b>" + t + "</b><i>" + sub + "</i></span></label>";
    }
    var sw = Object.keys(A.accents).map(function (k) {
      return '<button class="sw sw-' + k + (s.accent === k ? " on" : "") + '" data-act="accent" data-arg="' + k + '" aria-label="' + k + '"></button>';
    }).join("");
    var nfBtns = android ? '<div id="nfState" class="nf-state"></div><div class="nf-btns">' +
      '<button class="btn" data-act="nfAsk">' + ico("bell", 16) + " السماح بالإشعارات</button>" +
      '<button class="btn" data-act="nfTest">' + ico("check", 16) + " إشعار تجريبي</button>" +
      '<button class="btn" data-act="nfCheck">' + ico("refresh", 16) + " افحص الآن</button>" +
      '<button class="btn" data-act="nfBattery">' + ico("clock", 16) + " السماح بالعمل في الخلفية</button></div>" +
      '<p class="sub">بعض التلفونات (شاومي، سامسونج، أوبو…) توقف التطبيقات في الخلفية لتوفير البطارية فتتأخّر الإشعارات. «السماح بالعمل في الخلفية» يمنع ذلك.</p>' : ntfyHtml();
    return '<div class="card"><h2>' + ico("palette", 18) + ' لون التطبيق</h2><p class="sub">نفس ألوان المنظومة على الكمبيوتر. الوضع الليلي من الزر أعلى الشاشة.</p>' +
      '<div class="swatches">' + sw + "</div></div>" +
      '<div class="card"><h2>هذا التلفون</h2>' + branchPick() +
      '<label class="fld"><span>اسمه في المنظومة (يظهر على فواتيره)</span>' +
      '<input class="inp" id="sPhone" maxlength="40" value="' + esc(s.phone.name || "") + '"></label>' +
      "<h2>الإشعارات</h2>" +
      '<p class="sub">' + (android ? "تصل حتى والتطبيق مغلق (يفحص كل ربع ساعة تقريباً)، وتظهر في الجرس أعلى الشاشة."
        : "تظهر في الجرس أعلى الشاشة كلما فتحت التطبيق.") + "</p>" +
      chk("stock", "نفد أو قارب على النفاد", "صنف وصل حد التنبيه أو نفد") +
      chk("restock", "املأ الرفوف", "نفد من الرفوف وله نسخ في غرفة الخزين") +
      chk("daily", "ملخّص آخر اليوم", "مبيعات اليوم بعد الساعة 8 مساءً") +
      chk("sync", "المنظومة توقّفت عن التحديث", "لم يصل خبر من الكمبيوتر منذ 3 ساعات") +
      nfBtns + "</div>";
  }
  /* فرع التلفون: يظهر حين يكون في خادم الربط أكثر من فرع بمنظومة */
  function branchPick() {
    var real = realBranches().filter(function (b) { return b.dash && b.branch; });
    if (real.length < 2) return "";
    var cur = main(), id = cur && cur.branch ? String(cur.branch.id).toLowerCase() : "";
    return '<label class="fld"><span>فرع هذا التلفون (بيعه وتعديلاته ودخول موظفيه)</span><select class="inp" id="sBranch">' +
      real.map(function (b) {
        var v = String(b.branch.id).toLowerCase();
        return '<option value="' + esc(v) + '"' + (v === id ? " selected" : "") + ">" + esc(b.branch.name || v) + "</option>";
      }).join("") + "</select></label>";
  }

  /* الآيفون لا يسمح لتطبيق من المتصفح أن يفحص وهو مغلق. إشعارات
     المنظومة نفسها (ntfy) تصله من تطبيق ntfy المجاني — بلا أي تغيير. */
  function ntfyHtml() {
    return '<div class="nf-ios">' + ico("bell", 18) + "<div><b>لتصلك الإشعارات والتطبيق مسكّر</b>" +
      "<ol><li>ثبّت تطبيق <b>ntfy</b> المجاني من " + (A.ios ? "App Store" : "متجر التطبيقات") + ".</li>" +
      "<li>اضغط <b>+</b> واكتب <b>اسم القناة</b> نفسه الموجود في المنظومة على الكمبيوتر (صفحة «الإشعارات»).</li>" +
      "<li>اسمح له بالإشعارات.</li></ol>" +
      "<span>تصلك منه إشعارات المنظومة: البيع والديون والتسديد ونفاد الأصناف.</span></div></div>";
  }

  function saveSettings() {
    var s = S(), p = el("sPhone");
    if (p) s.phone.name = p.value.trim().slice(0, 40) || "تلفون";
    var bsel = el("sBranch");
    if (bsel && bsel.value !== s.cfg.branch) { s.cfg.branch = bsel.value; me = null; lockPick = ""; }
    ["stock", "restock", "daily", "sync"].forEach(function (k) {
      var c = el("nf_" + k);
      if (c) s.notif[k] = !!c.checked;
    });
    s.pushedEmpty = false;
  }

  /* يسلّم بيانات الربط وخيارات الإشعار لتطبيق أندرويد ليفحص في الخلفية */
  function onConfig() {
    if (!window.AndroidApp || !window.AndroidApp.setConfig) return;
    var s = S();
    try {
      window.AndroidApp.setConfig(JSON.stringify({
        url: s.cfg.url || "", key: s.cfg.key || "", notif: s.notif, phone: s.phone.id, branch: s.cfg.branch || ""
      }));
    } catch (e) { }
  }

  /* ---------- الكاميرا والرجوع ---------- */
  function onScan(code) {
    if (S().screen === "loc") {
      var g2 = exact(code);
      if (!g2) { A.toast("الباركود " + code + " غير مسجّل في المنظومة.", "warn"); return true; }
      /* مسح متتابع: الكاميرا تفتح للكتاب التالي، والرجوع يوقفها */
      if (locAdd(g2)) setTimeout(function () {
        if (S().screen !== "loc") return;
        if (window.AndroidApp && window.AndroidApp.scan) window.AndroidApp.scan();
        else if (window.WebScan) window.WebScan.open(function (c) { if (window.UI && UI.onScan) UI.onScan(c); });
      }, 700);
      return true;
    }
    if (S().screen !== "sell") return false;
    var g = exact(code);
    if (g) addToCart(g);
    else A.toast("لا يوجد صنف بالباركود " + code, "warn");
    return true;
  }
  function back() {
    var k = S().screen;
    if (UNDER_MORE[k] && k !== "browse") { A.go("more"); return true; }
    return false;
  }

  /* ============================================================
     طرابلس (X4): الدخول بالموظف، البصمة أو الوجه، الصلاحيات،
     تسعير الكتاب الصفري، تسجيل الأماكن رفاً رفاً، وطباعة الإيصال
     ------------------------------------------------------------
     الموظفون يأتون في لقطة جهاز المحل (main().staff): الاسم والدور وبصمة كلمة
     السر وملحها فقط — التلفون يتحقق منها بنفسه بلا إنترنت (PBKDF2 كما في
     المنظومة). من يعمل الآن في الذاكرة فقط: كل فتح للتطبيق يسأل من جديد
     (وبالبصمة يكون في ثانية). وكل فاتورة وتعديل يحمل صاحبه، والكمبيوتر يراجع
     صلاحيته من جديد قبل أن يسجّله.
     ============================================================ */
  var me = null, hiddenAt = 0, lockPick = "", lockBusy = false, bioAuto = true, lockList = false;
  var LOCK_AWAY = 2 * 60000;

  function staffInfo() {
    var m = main();
    return (m && m.staff && m.staff.staff && m.staff.staff.length) ? m.staff : null;
  }
  function shop() { var m = main(); return (m && m.shop) || null; }
  function roleOf(p) {
    var inf = staffInfo();
    return inf && p ? (inf.roles || []).filter(function (r) { return r.id === p.r; })[0] || null : null;
  }
  /* قبل تفعيل الموظفين (ومصراتة): كل شيء كما كان */
  function canP(perm) {
    if (!staffInfo()) return true;
    if (!me) return false;
    var r = roleOf(me);
    if (!r) return false;
    if (r.admin) return true;
    return (Array.isArray(perm) ? perm : [perm]).some(function (x) { return (r.perms || []).indexOf(x) >= 0; });
  }
  function locked() { return !!staffInfo() && !me; }
  function people() { var inf = staffInfo(); return inf ? inf.staff.filter(function (p) { return !p.off; }) : []; }
  function personOf(id) { return people().filter(function (p) { return p.id === id; })[0] || null; }

  /* بعد كل تحديث: موظف أُوقف أو تغيّرت كلمة سره في المنظومة يخرج */
  function refreshMe() {
    if (!me) return;
    var p = personOf(me.id);
    if (!staffInfo()) { me = null; return; }
    if (!p || p.h !== me.h) { me = null; lockPick = ""; A.toast("تغيّرت بيانات دخولك في المنظومة — ادخل من جديد.", "warn"); }
    else me = p;
  }

  /* ---------- كلمات السر: نفس طريقة المنظومة ---------- */
  function unhex(h) {
    var a = new Uint8Array(h.length / 2);
    for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
    return a;
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function pwOk(p, pw) {
    if (!p || !p.s || !p.h || !window.crypto || !crypto.subtle) return Promise.resolve(false);
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(String(pw)), "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", salt: unhex(p.s), iterations: 60000, hash: "SHA-256" }, k, 256);
    }).then(function (b) { return hex(b) === p.h; }, function () { return false; });
  }

  /* ---------- البصمة أو الوجه ----------
     أندرويد: نافذة البصمة من التلفون نفسه (AndroidApp.bioAuth).
     الآيفون: Face ID أو البصمة عبر WebAuthn (مفتاح على هذا التلفون وحده).
     تُربط بالموظف وبصمة كلمة سره: إن غيّرها في المنظومة تُطلب كلمة السر من جديد */
  var bioWait = {};
  function bioWord() { return A.ios ? "الوجه أو البصمة" : "البصمة"; }
  function b64(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function unb64(t) { var s = atob(t), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function rnd(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function bioAvail() {
    if (window.AndroidApp) {
      try { return Promise.resolve(!!window.AndroidApp.bioAvailable && window.AndroidApp.bioAvailable() === "yes"); }
      catch (e) { return Promise.resolve(false); }
    }
    try {
      if (window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
        return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(function () { return false; });
      }
    } catch (e) { }
    return Promise.resolve(false);
  }
  function androidBio(title) {
    return new Promise(function (res) {
      var id = "b" + Date.now().toString(36) + rand(3);
      bioWait[id] = res;
      try { window.AndroidApp.bioAuth(id, title); } catch (e) { delete bioWait[id]; res(false); }
    });
  }
  function bioDone(id, ok) { var f = bioWait[id]; delete bioWait[id]; if (f) f(!!ok); }
  function bioRec(p) {
    var r = p && S().bio && S().bio[p.id];
    return r && r.tag === String(p.h || "").slice(0, 16) ? r : null;
  }
  function bioEnroll(p) {
    var tag = String(p.h || "").slice(0, 16), title = (shop() && shop().name) || "المكتبة";
    var keep = function (rec) { S().bio = S().bio || {}; rec.tag = tag; S().bio[p.id] = rec; A.save(); return true; };
    if (window.AndroidApp) return androidBio("تفعيل الدخول بالبصمة — " + p.n).then(function (ok) { return ok ? keep({ k: "a" }) : false; });
    return navigator.credentials.create({ publicKey: {
      challenge: rnd(32), rp: { name: title },
      user: { id: rnd(16), name: p.u || p.n, displayName: p.n },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60000, attestation: "none"
    } }).then(function (c) { return c ? keep({ k: "w", c: b64(c.rawId) }) : false; }, function () { return false; });
  }
  function bioCheck(p) {
    var r = bioRec(p);
    if (!r) return Promise.resolve(false);
    if (r.k === "a") return window.AndroidApp ? androidBio("الدخول — " + p.n) : Promise.resolve(false);
    return navigator.credentials.get({ publicKey: {
      challenge: rnd(32), allowCredentials: [{ type: "public-key", id: unb64(r.c) }],
      userVerification: "required", timeout: 60000
    } }).then(function (a) { return !!a; }, function () { return false; });
  }

  /* ---------- شاشة الدخول ---------- */
  function paintLock() {
    var ov = el("phLock");
    if (!locked()) { if (ov) ov.parentNode.removeChild(ov); return; }
    if (!ov) {
      ov = document.createElement("section");
      ov.id = "phLock"; ov.className = "ph-lock";
      document.body.appendChild(ov);
    }
    var sh = shop() || {}, list = people();
    if (lockPick && !personOf(lockPick)) lockPick = "";
    if (!lockPick && list.length === 1) lockPick = list[0].id;
    /* آخر من دخل بالبصمة يظهر جاهزاً — إلا إن ضغط أحد «موظف آخر» */
    if (!lockPick && !lockList && S().lastWho && personOf(S().lastWho) && bioRec(personOf(S().lastWho))) lockPick = S().lastWho;
    var p = lockPick ? personOf(lockPick) : null;
    var h = '<div class="pl-box"><div class="pl-brand">' +
      (sh.logo ? '<img class="pl-logo" src="' + esc(sh.logo) + '" alt="">' : '<span class="pl-logo none">' + ico("book", 34) + "</span>") +
      "<b>" + esc(sh.name || ((main() && main().branch && main().branch.name) || "المكتبة")) + "</b>" +
      "<span>" + (p ? "أهلاً " + esc(p.n) : "من يعمل الآن؟") + "</span></div>";
    if (!p) {
      h += '<div class="pl-tiles">' + list.map(function (x) {
        var r = roleOf(x);
        return '<button class="pl-tile" data-act="phPick" data-arg="' + esc(x.id) + '"><i>' + esc(String(x.n || "؟").charAt(0)) + "</i>" +
          "<b>" + esc(x.n) + "</b><span>" + esc((r && r.n) || "") + "</span></button>";
      }).join("") + "</div>";
    } else {
      var rec = bioRec(p);
      h += '<form class="pl-form" id="phLockForm" novalidate>' +
        '<label class="fld"><span>كلمة السر</span><input class="inp ltr" id="phPw" type="password" autocomplete="current-password" enterkeyhint="go"></label>' +
        '<p class="fld-note" id="phErr" role="alert" hidden></p>' +
        '<button class="btn primary lg wide" type="submit" data-act="phLogin">' + ico("check", 18) + " دخول</button>" +
        (rec ? '<button class="btn wide mt" type="button" data-act="phBio">' + ico("lock", 18) + " الدخول ب" + bioWord() + "</button>" : "") +
        (list.length > 1 ? '<button class="btn ghost wide mt" type="button" data-act="phPick" data-arg="">موظف آخر</button>' : "") +
        "</form>";
    }
    h += '<p class="pl-foot">كلمة السر نفسها التي في المنظومة على الكمبيوتر.</p></div>';
    ov.innerHTML = h;
    var f = el("phLockForm");
    if (f) f.addEventListener("submit", function (e) { e.preventDefault(); login(); });
    var pw = el("phPw");
    if (p && bioRec(p) && bioAuto) { bioAuto = false; setTimeout(function () { bioLogin(); }, 250); }
    else if (pw) setTimeout(function () { try { pw.focus(); } catch (e) { } }, 60);
  }

  function enter(p, how) {
    me = p; lockPick = ""; lockList = false; S().lastWho = p.id; A.save();
    A.toast("أهلاً " + p.n + (how ? " — " + how : ""), "ok");
    A.render();
    if (!bioRec(p) && !(S().bioNo || {})[p.id]) {
      bioAvail().then(function (ok) { if (ok && me && me.id === p.id) offerBio(p); });
    }
  }

  function login() {
    if (lockBusy) return;
    var p = personOf(lockPick), pw = el("phPw"), err = el("phErr");
    if (!p || !pw) return;
    if (!pw.value) { pw.focus(); return; }
    lockBusy = true;
    pwOk(p, pw.value).then(function (ok) {
      lockBusy = false;
      if (ok) { enter(p); return; }
      if (err) { err.textContent = "كلمة السر غير صحيحة."; err.hidden = false; }
      pw.value = ""; pw.focus();
    });
  }

  function bioLogin() {
    var p = personOf(lockPick);
    if (!p || lockBusy) return;
    lockBusy = true;
    bioCheck(p).then(function (ok) {
      lockBusy = false;
      if (ok && locked()) enter(p, bioWord());
      else if (!ok) { var pw = el("phPw"); if (pw) pw.focus(); }
    });
  }

  function offerBio(p) {
    var h = '<div class="inner"><div class="grab"></div><div class="det-head"><h2>' + ico("lock", 18) + " الدخول ب" + bioWord() + "</h2>" +
      '<p class="by">بدل كتابة كلمة السر كل مرة، تدخل ب' + bioWord() + " في ثانية — على هذا التلفون وحده.</p></div>" +
      '<div class="det-acts"><button class="btn primary" data-act="phBioOn">' + ico("check", 16) + " فعّلها</button>" +
      '<button class="btn" data-act="phBioNo">ليس الآن</button></div></div>';
    openSheet(h);
  }

  function openSheet(h) {
    var sh = el("sheet");
    sh.classList.remove("closing");
    sh.innerHTML = h;
    sh.hidden = false;
    var inner = sh.querySelector(".inner");
    if (inner) inner.classList.add("morph", "omc");
    document.body.style.overflow = "hidden";
  }

  function logout() {
    me = null; lockPick = ""; bioAuto = false;
    A.closeSheet(); A.go("dash");
  }

  /* الخروج من التطبيق والعودة بعد دقيقتين أو أكثر = فتح جديد: يسأل من جديد */
  function onVisible() {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (me && staffInfo() && hiddenAt && Date.now() - hiddenAt > LOCK_AWAY) { me = null; bioAuto = true; A.render(); }
  }

  /* الاسم والشعار في رأس التطبيق (طرابلس) */
  function brand() {
    var sh = shop(), top = el("top");
    if (!top || !sh) return;
    var mark = top.querySelector(".brand-mark"), img = top.querySelector(".brand-logo");
    if (sh.logo) {
      if (!img) { img = document.createElement("img"); img.className = "brand-logo"; img.alt = ""; if (mark) mark.parentNode.insertBefore(img, mark); }
      if (img.getAttribute("src") !== sh.logo) img.setAttribute("src", sh.logo);
      if (mark) mark.classList.add("gone");
    }
    if (sh.name && document.title !== sh.name) document.title = sh.name;
    var who = el("phWho");
    if (me && staffInfo()) {
      if (!who) {
        who = document.createElement("button");
        who.id = "phWho"; who.className = "ph-who"; who.setAttribute("data-act", "phLogout");
        var ref = el("btnTheme");
        top.insertBefore(who, ref || null);
      }
      who.innerHTML = "<i>" + esc(String(me.n || "").charAt(0)) + "</i>";
      who.setAttribute("aria-label", "خروج " + me.n);
    } else if (who) who.parentNode.removeChild(who);
  }

  /* ---------- الكتاب الذي بلا سعر (طرابلس): يُسعَّر وقت البيع ويُحفظ ---------- */
  function askPrice(g) {
    if (!canP(["price_zero", "price"])) { A.toast("«" + g.n + "» بلا سعر — تسعيره من صلاحية المدير.", "warn"); return; }
    openSheet('<div class="inner"><div class="grab"></div><div class="det-head"><h2>' + ico("money", 18) + " كتاب بلا سعر</h2>" +
      '<p class="by">' + esc(g.n) + "</p></div>" +
      '<label class="fld"><span>سعر البيع</span><input class="inp ltr" id="zpP" inputmode="decimal" placeholder="0"></label>' +
      '<p class="sub">يُحفظ السعر في المنظومة مع الفاتورة، فلا يُسأل عنه مرة ثانية.</p>' +
      '<div class="det-acts"><button class="btn primary" data-act="zpOk" data-arg="' + esc(g.key) + '">' + ico("check", 16) + " أضفه للسلة</button>" +
      '<button class="btn" data-act="closeSheet">إلغاء</button></div></div>');
    setTimeout(function () { var i = el("zpP"); if (i) i.focus(); }, 80);
  }

  /* ---------- تسجيل الأماكن رفاً رفاً ----------
     تختار المكتبة والرف مرة، وتمسح الكتب واحداً وراء الآخر: كل كتاب يأخذ
     مكان هذا الرف. «عدّ النسخ» يجعلها جرداً: كل مسحة نسخة على الرف.
     يُرسل تعديلات عادية (الكمية فرقاً) فيبقى بيع الكمبيوتر بينها محسوباً */
  function locState() {
    var L = S().loc;
    if (!L || typeof L !== "object") L = S().loc = { lib: "", shelf: "1", count: false, list: [] };
    if (!Array.isArray(L.list)) L.list = [];
    return L;
  }
  function libsAll() {
    var sh = shop(), seen = {}, out = [];
    ((sh && sh.libs) || []).forEach(function (l) { if (l && !seen[l]) { seen[l] = 1; out.push(l); } });
    A.items().forEach(function (g) {
      (g.at || []).forEach(function (w) { var l = w.place && w.place.kind === "branch" ? w.lib : ""; if (l && !seen[l]) { seen[l] = 1; out.push(l); } });
    });
    if (!out.length) out = "ABCDEFGH".split("");
    return out.sort();
  }
  /* مكان الكتاب في فرع هذا التلفون (الفرع الذي يسجّل تعديلاته)، لا في كل الفروع */
  function branchAt(g) {
    var m = main(), key = m && m.branch ? "b:" + m.branch.id : "";
    var br = (g.at || []).filter(function (x) { return x.place && x.place.kind === "branch"; });
    return br.filter(function (x) { return x.place.key === key; })[0] || br[0] || {};
  }
  /* ما على رفوف هذا الفرع الآن، مع تعديلات من هذا التلفون لم تُطبَّق بعد */
  function shelfHere(g) {
    var q = A.num(branchAt(g).q);
    S().edits.forEach(function (e) {
      if (e.status === "pending" && ((e.b && e.b === g.b) || (!e.b && e.k === g.code)) && e.set && e.set.qd) q += A.num(e.set.qd);
    });
    return q;
  }

  function paintLoc() {
    var L = locState(), v = el("view");
    if (!canP(["items", "count"])) { v.innerHTML = A.emptyBox("lock", "ليست من صلاحياتك", "تسجيل الأماكن والجرد لأمين المخزن أو المدير."); return; }
    var libs = libsAll();
    var h = crumb("تسجيل الأماكن") +
      '<div class="card loc-pick"><div class="two">' +
      '<label class="fld"><span>المكتبة (الخزانة)</span><select class="inp" id="locLib"><option value="">— اختر —</option>' +
      libs.map(function (l) { return '<option value="' + esc(l) + '"' + (L.lib === l ? " selected" : "") + ">" + esc(l) + "</option>"; }).join("") + "</select></label>" +
      '<label class="fld"><span>الرف</span><div class="stepper">' +
      '<button type="button" data-act="locShelf" data-arg="-1">' + ico("minus", 18) + "</button>" +
      '<input class="inp" id="locShelfIn" inputmode="numeric" dir="ltr" value="' + esc(L.shelf) + '">' +
      '<button type="button" data-act="locShelf" data-arg="1">' + ico("plus", 18) + "</button></div></label></div>" +
      '<label class="chk"><input type="checkbox" id="locCount"' + (L.count ? " checked" : "") + "><span><b>عدّ النسخ أيضاً (جرد)</b>" +
      "<i>كل مسحة نسخة على هذا الرف — امسح كل نسخة</i></span></label>" +
      '<button class="btn primary wide big" data-act="scan">' + ico("camera", 20) + " امسح الكتب</button>" +
      '<div class="search sell-search"><input id="locQ" class="search-inp" type="search" autocomplete="off" placeholder="كتاب بلا باركود؟ ابحث باسمه…"></div>' +
      '<div id="locSug"></div></div>';
    if (!L.list.length) h += A.emptyBox("shelf", L.lib ? "مكتبة " + L.lib + " · رف " + L.shelf : "اختر المكتبة والرف", "ثم امسح الكتب التي على هذا الرف واحداً وراء الآخر.");
    else {
      h += '<div class="loc-head"><b>مكتبة ' + esc(L.lib) + " · رف " + esc(L.shelf) + "</b><span>" + L.list.length + " كتاب" +
        (L.count ? " · " + L.list.reduce(function (a, x) { return a + x.c; }, 0) + " نسخة" : "") + "</span></div>" +
        '<div class="rows">' + L.list.map(function (x, i) {
          return '<div class="row d' + Math.min(i, 9) + '"><span class="row-ic bk">' + ico("book", 17) + "</span>" +
            '<div class="row-main"><div class="row-name">' + esc(x.n) + "</div>" +
            '<div class="row-sub">' + (x.moved ? "صار مكانه: " + esc(L.lib) + " · رف " + esc(L.shelf) : "مكانه كما هو") + "</div></div>" +
            (L.count ? '<div class="qty"><button data-act="locMinus" data-arg="' + esc(x.key) + '">' + ico("minus", 16) + "</button><b>" + x.c + "</b></div>" : "") + "</div>";
        }).join("") + "</div>" +
        '<button class="btn wide mt" data-act="locNext">' + ico("check", 16) + " انتهى هذا الرف — الرف التالي</button>";
    }
    v.innerHTML = h;
    el("foot").innerHTML = "يُرسل كل كتاب للمنظومة على الكمبيوتر فتسجّل مكانه" + (L.count ? " وعدد نسخه" : "") + ". بلا إنترنت يُحفظ هنا ويُرسل وحده لاحقاً.";
    var lib = el("locLib");
    if (lib) lib.addEventListener("change", function () { L.lib = this.value; L.list = []; A.save(); paintLoc(); });
    var si = el("locShelfIn");
    if (si) si.addEventListener("change", function () { L.shelf = String(Math.max(1, A.num(this.value) || 1)); L.list = []; A.save(); paintLoc(); });
    var cc = el("locCount");
    if (cc) cc.addEventListener("change", function () { L.count = this.checked; A.save(); });
    var q = el("locQ"), t = null;
    if (q) q.addEventListener("input", function () {
      var val = this.value; clearTimeout(t);
      t = setTimeout(function () {
        var host = el("locSug"); if (!host) return;
        if (!String(val).trim()) { host.innerHTML = ""; return; }
        var res = A.search(A.items(), val).slice(0, 8);
        host.innerHTML = res.length ? '<div class="sugs">' + res.map(function (g) {
          var w = branchAt(g);
          return '<button class="sug" data-act="locAdd" data-arg="' + esc(g.key) + '"><span class="sg-main"><b>' + esc(g.n) + "</b><span>" + esc(g.a || "") + "</span></span>" +
            '<span class="sg-side"><span>' + esc(w.lib ? w.lib + " · رف " + (w.shelf || "") : "بلا مكان") + "</span></span></button>";
        }).join("") + "</div>" : '<p class="sub">لا نتائج.</p>';
      }, 120);
    });
  }

  function locAdd(g) {
    var L = locState();
    if (!L.lib) { A.toast("اختر المكتبة أولاً.", "warn"); return false; }
    if (!g.b && !g.code) { A.toast("هذا الصنف بلا باركود ولا رمز — سجّل مكانه من الكمبيوتر.", "warn"); return false; }
    var ent = L.list.filter(function (x) { return x.key === g.key; })[0], set = {};
    if (!ent) {
      var w = branchAt(g);
      ent = { key: g.key, n: g.n, b: g.b || "", k: g.code || "", c: 0, moved: false };
      L.list.unshift(ent);
      if (g.t === "book") {
        if ((w.lib || "") !== L.lib) set.l = L.lib;
        if (String(w.shelf || "") !== String(L.shelf)) set.s = String(L.shelf);
      } else if ((w.loc || "") !== L.lib + " رف " + L.shelf) set.loc = L.lib + " رف " + L.shelf;
      ent.moved = Object.keys(set).length > 0;
      if (L.count) { set.qd = 1 - shelfHere(g); set.cnt = 1; }
    } else if (L.count) set.qd = 1;
    else { A.toast("«" + g.n + "» مسجّل على هذا الرف.", "ok"); return true; }
    ent.c++;
    if (Object.keys(set).length) queueEdit(g, set);
    A.save();
    if (S().screen === "loc") paintLoc();
    A.toast(L.count ? "«" + g.n + "» — " + ent.c + (ent.c === 1 ? " نسخة" : " نسخ") : "«" + g.n + "» ← " + L.lib + " · رف " + L.shelf, "ok");
    return true;
  }

  /* تعديل الرف نفسه للكتاب نفسه يُدمج في واحد ما دام لم يُرسل */
  var locPushT = null;
  function queueEdit(g, set) {
    var m = main(), e = S().edits.filter(function (x) {
      return x.status === "pending" && !x.sent && x.loc && ((x.b && x.b === g.b) || (!x.b && x.k === g.code));
    })[0];
    if (e) {
      Object.keys(set).forEach(function (k) { if (k === "qd") e.set.qd = A.num(e.set.qd) + A.num(set.qd); else e.set[k] = set[k]; });
    } else {
      S().edits.unshift(stamp({ id: "e" + Date.now().toString(36) + rand(4), b: g.b || "", k: g.code || "", n: g.n, set: set, loc: 1,
        at: nowStamp(), status: "pending", to: m && m.branch ? m.branch.id : "" }));
    }
    S().pushedEmpty = false;
    clearTimeout(locPushT);
    locPushT = setTimeout(push, 1500);
  }

  /* الموظف على كل ما يُرسل */
  function stamp(o) { if (me && staffInfo()) { o.by = me.id; o.byName = me.n; } return o; }

  /* ---------- إيصال البيع من التلفون ---------- */
  function receiptHtml(o) {
    var sh = shop() || {}, m = main() || {}, c = esc(cur());
    var lines = o.items.map(function (l) {
      return "<tr><td>" + esc(l.n) + '</td><td class="n">' + l.q + '</td><td class="n">' + money(l.p * l.q) + "</td></tr>";
    }).join("");
    return '<div class="rc">' + (sh.logo ? '<img class="rc-logo" src="' + esc(sh.logo) + '" alt="">' : "") +
      '<div class="rc-shop">' + esc(sh.name || (m.branch && m.branch.name) || "") + "</div>" +
      '<div class="rc-meta">' + esc(o.at) + (o.byName ? " · " + esc(o.byName) : "") + "<br>بيع من التلفون · " + esc(o.id.slice(-6).toUpperCase()) + "</div>" +
      "<table><thead><tr><th>الصنف</th><th>ك</th><th>المبلغ</th></tr></thead><tbody>" + lines + "</tbody></table>" +
      (o.disc ? '<div class="rc-row"><span>الخصم</span><b>' + money(o.disc) + "</b></div>" : "") +
      '<div class="rc-row big"><span>الصافي</span><b>' + money(o.total) + " " + c + "</b></div>" +
      '<div class="rc-row"><span>' + esc(METHOD[o.method] || "") + "</span>" + (o.custName ? "<b>" + esc(o.custName) + "</b>" : "") + "</div>" +
      '<div class="rc-foot">شكراً لزيارتكم</div></div>';
  }
  function printReceipt(id) {
    var o = S().orders.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    var html = receiptHtml(o);
    if (window.AndroidApp && window.AndroidApp.printHtml) {
      try {
        var css = Array.prototype.map.call(document.querySelectorAll('link[rel="stylesheet"]'), function (l) { return l.href; })[0] || "";
        window.AndroidApp.printHtml('<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
          (css ? '<link rel="stylesheet" href="' + css + '">' : "") + '</head><body class="rc-print">' + html + "</body></html>", "إيصال " + o.id.slice(-6));
        return;
      } catch (e) { }
    }
    var host = el("phPrint");
    if (!host) { host = document.createElement("div"); host.id = "phPrint"; document.body.appendChild(host); }
    host.innerHTML = html;
    document.body.classList.add("printing-rc");
    setTimeout(function () {
      try { window.print(); } catch (e) { A.toast("الطباعة غير متاحة على هذا الجهاز.", "warn"); }
      setTimeout(function () { document.body.classList.remove("printing-rc"); }, 800);
    }, 60);
  }

  var acts = {
    phPick: function (id) { lockPick = id; lockList = !id; bioAuto = !!id; paintLock(); },
    phLogin: function () { login(); },
    phBio: function () { bioLogin(); },
    phBioOn: function () {
      if (!me) return;
      var p = me;
      bioEnroll(p).then(function (ok) {
        A.closeSheet();
        A.toast(ok ? "تم: الدخول ب" + bioWord() + " مفعّل على هذا التلفون." : "لم يتم التفعيل — تقدر تفعّلها لاحقاً من الإعدادات.", ok ? "ok" : "warn");
      });
    },
    phBioNo: function () { if (me) { S().bioNo = S().bioNo || {}; S().bioNo[me.id] = 1; A.save(); } A.closeSheet(); },
    phLogout: function () { logout(); },
    zpOk: function (key) {
      var g = A.items().filter(function (x) { return x.key === key; })[0], i = el("zpP"), pr = i ? A.num(i.value) : 0;
      if (!g) return;
      if (!(pr > 0)) { A.toast("اكتب سعراً أكبر من صفر.", "warn"); if (i) i.focus(); return; }
      A.closeSheet(); addToCart(g, Math.round(pr * 1000) / 1000);
    },
    locShelf: function (d) { var L = locState(); L.shelf = String(Math.max(1, A.num(L.shelf) + (+d))); L.list = []; A.save(); paintLoc(); },
    locAdd: function (key) {
      var g = A.items().filter(function (x) { return x.key === key; })[0];
      if (g && locAdd(g)) { var q = el("locQ"); if (q) q.value = ""; var h = el("locSug"); if (h) h.innerHTML = ""; }
    },
    locMinus: function (key) {
      var L = locState(), ent = L.list.filter(function (x) { return x.key === key; })[0];
      var g = A.items().filter(function (x) { return x.key === key; })[0];
      if (!ent || !g || ent.c <= 0) return;
      ent.c--; queueEdit(g, { qd: -1 }); A.save(); paintLoc();
    },
    locNext: function () {
      var L = locState();
      L.shelf = String(A.num(L.shelf) + 1); L.list = []; A.save(); push(); paintLoc();
      A.toast("الرف " + L.shelf + " — امسح كتبه.", "ok");
    },
    rcPrint: function (id) { var e = document.querySelector(".done-pop"); if (e) e.parentNode.removeChild(e); printReceipt(id); },
    rcSkip: function () { var e = document.querySelector(".done-pop"); if (e) e.parentNode.removeChild(e); },
    bell: function () { openBell(); },
    editItem: function (k) { editItem(k); },
    editSave: function (k) { editSave(k); },
    eStep: function (d) { var q = el("eQ"); if (q) { q.value = Math.max(0, A.num(q.value) + (+d)); qdHint(); } },
    accent: function (k) {
      S().accent = k; A.save(); A.applyTheme();
      Array.prototype.forEach.call(document.querySelectorAll(".sw"), function (b) { b.classList.toggle("on", b.getAttribute("data-arg") === k); });
    },
    nfAsk: function () {
      if (window.AndroidApp && window.AndroidApp.askNotify) window.AndroidApp.askNotify();
      setTimeout(paintNotifState, 1500);
    },
    nfTest: function () {
      saveSettings(); A.save(); onConfig();
      var ok = window.AndroidApp && window.AndroidApp.testNotify ? window.AndroidApp.testNotify() : false;
      A.toast(ok ? "أُرسل إشعار تجريبي — انظر أعلى الشاشة." : "الإشعارات ممنوعة — اضغط «السماح بالإشعارات».", ok ? "ok" : "warn");
      paintNotifState();
    },
    nfCheck: function () {
      saveSettings(); A.save(); onConfig();
      if (window.AndroidApp && window.AndroidApp.checkNow) window.AndroidApp.checkNow();
      A.toast("يفحص المخزون الآن… يصلك ملخّص خلال ثوانٍ.", "ok");
    },
    nfBattery: function () { if (window.AndroidApp && window.AndroidApp.openBattery) window.AndroidApp.openBattery(); },
    bellGo: function (k) { bellGo(k); },
    bellRead: function () { bellRead(); },
    roomF: function (a) { roomF = a; paintRoom(); },
    alertF: function (a) { alertF = a; paintAlerts(); },
    cartAdd: function (key) {
      var g = A.items().filter(function (x) { return x.key === key; })[0];
      if (g) { addToCart(g); var q = el("sellQ"); if (q) q.value = ""; }
    },
    cartQty: function (i, d) {
      var l = S().cart[+i];
      if (!l) return;
      l.q = Math.max(1, l.q + (+d));
      A.save(); paintSell();
    },
    cartDel: function (i) {
      var line = document.querySelector('.cline[data-i="' + i + '"]');
      var go2 = function () { S().cart.splice(+i, 1); A.save(); paintSell(); };
      if (line && !A.reduced()) { line.classList.add("leaving"); setTimeout(go2, 200); } else go2();
    },
    cartClear: function () { if (window.confirm("إفراغ السلة؟")) { S().cart = []; A.save(); paintSell(); } },
    payM: function (k) { S().sell.method = k; A.save(); paintSell(); },
    checkout: function () {
      var d = el("sellDisc"), c = el("sellCust"), p = el("sellPaid");
      if (d) S().sell.disc = d.value;
      if (c) S().sell.cust = c.value;
      if (p) S().sell.paid = p.value;
      checkout();
    }
  };

  return {
    init: init, tabs: tabs, tabOf: tabOf, chrome: chrome, adjust: adjust,
    afterRefresh: afterRefresh, settingsHtml: settingsHtml, saveSettings: saveSettings,
    onConfig: onConfig, onScan: onScan, back: back, acts: acts, events: events, push: push,
    detailActs: detailActs, paintNotifState: paintNotifState, bioDone: bioDone,
    /* للاختبار */
    __me: function () { return me; }, __can: canP, __receipt: receiptHtml,
    screens: {
      dash: paintDash, sell: paintSell, room: paintRoom, more: paintMore,
      debts: paintDebts, alerts: paintAlerts, orders: paintOrders, loc: paintLoc
    }
  };
})();
