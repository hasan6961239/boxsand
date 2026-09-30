/* ============================================================
   phone.js — شاشات التطبيق
   ------------------------------------------------------------
   تُضاف إلى الموقع (app.js) من غير أن تغيّر ما فيه:
     • اليوم      — مبيعات اليوم والشهر وآخر الفواتير (بلا أرباح)
     • بيع        — داخل تطبيق أندرويد فقط: سلة، كاميرا، دفع
     • الخزين     — ما في غرفة الخزين
     • المزيد     — الرفوف، الزبائن والديون، التنبيهات والراكد…
     • الجرس      — إشعارات داخل التطبيق بحركة
   البيع من التلفون لا يكتب في بيانات المحل: يضع الطلب في ملف هذا
   التلفون على خادم الربط، والكمبيوتر يسجّله فاتورة ويعيد رقمها.
   ============================================================ */
window.PhoneExt = (function () {
  var A = null;                        // واجهة app.js
  var inApp = !!window.AndroidApp;
  var pushing = false, pushAgain = false;

  function S() { return A.S; }
  function el(id) { return document.getElementById(id); }

  /* ---------- البداية ---------- */
  function init(api) {
    A = api;
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
      zzz: "M4 6h6l-6 7h6M14 11h6l-6 8h6"
    });
    var s = S();
    if (!Array.isArray(s.orders)) s.orders = [];
    if (!Array.isArray(s.cart)) s.cart = [];
    if (!s.sell || typeof s.sell !== "object") s.sell = { disc: "", method: "cash", cust: "", paid: "" };
    if (!s.phone || typeof s.phone !== "object") s.phone = { id: "", name: "تلفون" };
    if (!/^phone-[a-z0-9]{6,}$/.test(s.phone.id)) s.phone.id = "phone-" + rand(8);
    if (!s.notif || typeof s.notif !== "object") s.notif = { stock: true, restock: true, daily: true, sync: true };
    if (!s.seen || typeof s.seen !== "object") { s.seen = {}; s.seenInit = false; }
    if (!Array.isArray(s.feed)) s.feed = [];
    if (inApp && main() && main().dash) s.screen = "dash";   // في التطبيق: اللوحة أول ما يُفتح
    window.addEventListener("online", function () { push(); });
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
  function main() {
    var br = (S().snap && S().snap.branches) || [];
    var real = br.filter(function (b) { return !A.isPhone(b); });
    return real.filter(function (b) { return b.dash; })[0] || real[0] || null;
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
    if (inApp) t.push({ k: "sell", t: "بيع", i: "cart", hero: true });
    t.push({ k: "room", t: "الخزين", i: "door" }, { k: "more", t: "المزيد", i: "grid" });
    return t;
  }
  var UNDER_MORE = { browse: 1, stats: 1, settings: 1, debts: 1, alerts: 1, orders: 1 };
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
    var tiles = [
      { a: "browse", i: "shelf", t: "الرفوف", s: "تصفّح المكتبات والرفوف" },
      { a: "debts", i: "users", t: "الزبائن والديون", s: nDebt ? money(debt) + " على " + nDebt + " زبون" : "لا ديون", c: nDebt ? "warn" : "" },
      { a: "alerts", i: "alert", t: "التنبيهات والراكد", s: nAl + " تنبيه · " + al.slow.length + " راكد", c: nAl ? "bad" : "" },
      { a: "stats", i: "grid", t: "ملخّص المخزون", s: "القيمة والتصنيفات" }
    ];
    if (inApp) tiles.push({ a: "orders", i: "phone2", t: "مبيعات هذا التلفون", s: S().orders.length + " فاتورة" });
    tiles.push({ a: "settings", i: "gear", t: "الإعدادات", s: "الربط والإشعارات" });
    el("view").innerHTML = '<div class="more-grid">' + tiles.map(function (x, i) {
      return '<button class="more-tile d' + i + (x.c ? " " + x.c : "") + '" data-act="go" data-arg="' + x.a + '">' +
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
        '<label class="fld inline"><span>الخصم</span><input class="inp ltr" id="sellDisc" inputmode="decimal" value="' + esc(s.sell.disc) + '" placeholder="0"></label>' +
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
        var hit = exact(this.value) || A.search(A.items(), this.value)[0];
        if (hit) { addToCart(hit); this.value = ""; suggest(""); }
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
    var res = A.search(A.items(), qv).slice(0, 8);
    host.innerHTML = res.length ? '<div class="sugs">' + res.map(function (g) {
      return '<button class="sug" data-act="cartAdd" data-arg="' + esc(g.key) + '">' +
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

  function addToCart(g) {
    var s = S(), ex = null;
    s.cart.forEach(function (l) { if (l.key === g.key) ex = l; });
    if (ex) ex.q++;
    else s.cart.unshift({ key: g.key, b: g.b || "", k: g.code || "", n: g.n, p: A.num(g.p), q: 1 });
    A.save();
    if (g.total <= 0) A.toast("تنبيه: «" + g.n + "» غير متوفر حسب آخر تحديث.", "warn");
    paintSell();
    var first = document.querySelector(".cline");
    if (first) first.classList.add("pop");
  }

  function r3(v) { return Math.round(A.num(v) * 1000) / 1000; }
  function subtotal() { return r3(S().cart.reduce(function (a, l) { return a + A.num(l.p) * A.num(l.q); }, 0)); }
  function discNow() { return Math.min(Math.max(A.num(S().sell.disc), 0), subtotal()); }

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
      items: s.cart.map(function (l) { return { b: l.b, k: l.k, n: l.n, q: A.num(l.q), p: A.num(l.p) }; }),
      disc: discNow(), method: method, cust: cust ? cust.id : "", custName: cust ? cust.n : "",
      paid: method === "credit" ? Math.min(Math.max(A.num(s.sell.paid), 0), tot) : tot,
      total: tot, status: "pending"
    };
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
      '<div class="dp-sub">' + money(o.total) + " " + esc(cur()) + '</div><div class="dp-note">تُرسل للمنظومة الآن</div></div>';
    document.body.appendChild(e);
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
    if (!pend.length && s.pushedEmpty) return;
    pushing = true;
    var body = {
      kind: "phone", at: nowStamp(),
      branch: { id: s.phone.id, name: s.phone.name || "تلفون" },
      items: [],
      orders: pend.map(function (o) {
        return { id: o.id, date: o.date, at: o.at, items: o.items, disc: o.disc, method: o.method, cust: o.cust, paid: o.paid };
      })
    };
    var base = String(s.cfg.url).trim().replace(/\/+$/, "");
    fetch(base + "/put", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Shop-Key": String(s.cfg.key || "") },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      pend.forEach(function (o) { o.sent = true; });
      s.pushedEmpty = !pend.length;
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
    if (changed) { s.pushedEmpty = false; push(); }
    return newly;
  }

  /* نسخ بيعت هنا ولم يسجّلها الكمبيوتر بعد: تُطرح من المعروض */
  function adjust(list) {
    var pend = S().orders.filter(function (o) { return o.status === "pending"; });
    if (!pend.length) return;
    var byB = {}, byK = {};
    list.forEach(function (g) { if (g.b) byB[g.b] = g; if (g.code) byK[String(g.code).toUpperCase()] = g; });
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
      d.out.forEach(function (g) { ev.push({ k: "out:" + g.key, lv: "bad", t: "نفد: " + g.n, s: "لم يبقَ منه شيء", key: g.key }); });
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

  /* ---------- الإعدادات ---------- */
  function settingsHtml() {
    var s = S(), n = s.notif;
    function chk(k, t, sub) {
      return '<label class="chk"><input type="checkbox" id="nf_' + k + '"' + (n[k] ? " checked" : "") + "><span><b>" + t + "</b><i>" + sub + "</i></span></label>";
    }
    return '<div class="card"><h2>هذا التلفون</h2>' +
      '<label class="fld"><span>اسمه في المنظومة (يظهر على فواتيره)</span>' +
      '<input class="inp" id="sPhone" maxlength="40" value="' + esc(s.phone.name || "") + '"></label>' +
      "<h2>الإشعارات</h2>" +
      '<p class="sub">' + (inApp ? "تصل حتى والتطبيق مغلق (يفحص كل ربع ساعة تقريباً)، وتظهر في الجرس أعلى الشاشة."
        : "تظهر في الجرس أعلى الصفحة.") + "</p>" +
      chk("stock", "نفد أو قارب على النفاد", "صنف وصل حد التنبيه أو نفد") +
      chk("restock", "املأ الرفوف", "نفد من الرفوف وله نسخ في غرفة الخزين") +
      chk("daily", "ملخّص آخر اليوم", "مبيعات اليوم بعد الساعة 8 مساءً") +
      chk("sync", "المنظومة توقّفت عن التحديث", "لم يصل خبر من الكمبيوتر منذ 3 ساعات") +
      "</div>";
  }
  function saveSettings() {
    var s = S(), p = el("sPhone");
    if (p) s.phone.name = p.value.trim().slice(0, 40) || "تلفون";
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
        url: s.cfg.url || "", key: s.cfg.key || "", notif: s.notif, phone: s.phone.id
      }));
    } catch (e) { }
  }

  /* ---------- الكاميرا والرجوع ---------- */
  function onScan(code) {
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

  var acts = {
    bell: function () { openBell(); },
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
    screens: {
      dash: paintDash, sell: paintSell, room: paintRoom, more: paintMore,
      debts: paintDebts, alerts: paintAlerts, orders: paintOrders
    }
  };
})();
