/* ============================================================
   stock.js — عارض المخزون من التلفون
   ------------------------------------------------------------
   يقرأ نفس اللقطة التي يرفعها جهاز المحل إلى Cloudflare Worker.
   لا خادم جديد ولا قاعدة بيانات: البنية موجودة أصلاً للربط بين
   الفروع، وهذه الصفحة تقرأ منها فقط ولا تكتب شيئاً.

   ويحفظ آخر لقطة على التلفون، فيعمل بلا إنترنت ويقول لك بوضوح
   متى كانت آخر مرة وصلته فيها بيانات — أسوأ ما قد يحدث أن تثق
   برقم قديم وأنت تظنه اليوم.
   ============================================================ */

var Stock = (function () {

  var KEY = "qi_stock_v1";
  var S = null;
  var busy = false;

  function blank() {
    return {
      cfg: { url: "", key: "" },
      snap: null,          // { at, branches: [...] }
      q: "", place: "*"
    };
  }

  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!d || typeof d !== "object") return blank();
      var b = blank();
      d.cfg = d.cfg || b.cfg;
      if (d.cfg.url === undefined) d.cfg.url = "";
      if (d.cfg.key === undefined) d.cfg.key = "";
      d.q = ""; d.place = d.place || "*";
      return d;
    } catch (e) { return blank(); }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { }
  }

  /* ---------- أدوات ---------- */

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function num(v) {
    var n = parseFloat(String(v === null || v === undefined ? "" : v).replace(/[^\d.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  function money(v) { return num(v).toFixed(2); }

  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/[ً-ٰٟ]/g, "")
      .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/\s+/g, " ").trim();
  }

  function toast(msg, kind) {
    var t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.textContent = msg;
    el("toasts").appendChild(t);
    setTimeout(function () { t.remove(); }, 3600);
  }

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
  }

  /* عمر اللقطة بالكلمات — الرقم وحده لا يقول إن كان قديماً */
  function ageOf(at) {
    if (!at) return { txt: "لا توجد بيانات", cls: "bad" };
    var t = new Date(String(at).replace(" ", "T"));
    var mins = Math.round((Date.now() - t.getTime()) / 60000);
    if (isNaN(mins)) return { txt: String(at), cls: "" };
    if (mins < 2) return { txt: "محدَّث الآن", cls: "ok" };
    if (mins < 60) return { txt: "منذ " + mins + " دقيقة", cls: "ok" };
    if (mins < 1440) return { txt: "منذ " + Math.round(mins / 60) + " ساعة", cls: "warn" };
    return { txt: "منذ " + Math.round(mins / 1440) + " يوم", cls: "bad" };
  }

  /* ---------- الجلب ---------- */

  function configured() { return !!String(S.cfg.url || "").trim(); }

  function refresh() {
    if (busy) return;
    if (!configured()) { settings(); return; }
    busy = true;
    var btn = el("refreshBtn");
    if (btn) btn.classList.add("spin");

    var url = String(S.cfg.url).trim().replace(/\/+$/, "") + "/all";
    fetch(url, { headers: { "X-Shop-Key": String(S.cfg.key || "") } })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error("BADKEY");
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        busy = false;
        if (btn) btn.classList.remove("spin");
        if (!d || !d.ok) throw new Error((d && d.error) || "رد غير مفهوم");
        S.snap = { at: new Date().toISOString().slice(0, 16).replace("T", " "), branches: d.branches || [] };
        save();
        render();
        toast("حُدّث المخزون — " + (d.branches || []).length + " فرع.", "ok");
      })
      .catch(function (e) {
        busy = false;
        if (btn) btn.classList.remove("spin");
        var m = e && e.message;
        if (m === "BADKEY") {
          toast("كلمة سر الربط غير صحيحة.", "bad");
          settings();
        } else {
          toast("تعذّر التحديث — تُعرض آخر نسخة وصلت.", "warn");
        }
        render();
      });
  }

  /* ---------- تجميع الصفوف ---------- */

  /* كل مكان فيه بضاعة: فرع عنده منظومة، أو مخزن يدوي تابع له */
  function places() {
    var out = [];
    if (!S.snap || !S.snap.branches) return out;
    S.snap.branches.forEach(function (b) {
      var bn = (b.branch && (b.branch.name || b.branch.id)) || "فرع";
      out.push({
        key: "b:" + ((b.branch && b.branch.id) || bn),
        name: bn, kind: "branch", at: b.at,
        city: (b.branch && b.branch.city) || "",
        phone: (b.branch && b.branch.phone) || "",
        items: (b.items || []).map(function (i) {
          return {
            n: i.n, a: i.a || "", q: num(i.q), p: num(i.p), m: num(i.m),
            b: i.b || "", k: i.k || "", c: i.c || "", t: i.t,
            loc: i.t === "book"
              ? ((i.l || "") + (i.s ? " · رف " + i.s : ""))
              : (i.loc || "")
          };
        })
      });
      (b.whs || []).forEach(function (w) {
        out.push({
          key: "w:" + w.id,
          name: w.name || "مخزن", kind: "wh", at: b.at,
          city: w.place || "", parent: bn, phone: w.phone || "",
          items: (w.items || []).map(function (i) {
            return {
              n: i.n, a: "", q: num(i.q), p: num(i.p), m: 0,
              b: i.b || "", k: "", c: "", t: i.t, loc: w.place || ""
            };
          })
        });
      });
    });
    return out;
  }

  function matches(it, nq) {
    if (!nq) return true;
    return norm(it.n + " " + it.a + " " + it.b + " " + it.k + " " + it.c).indexOf(nq) >= 0;
  }

  function rows() {
    var nq = norm(S.q);
    var out = [];
    places().forEach(function (pl) {
      if (S.place !== "*" && S.place !== pl.key) return;
      pl.items.forEach(function (it) {
        if (!matches(it, nq)) return;
        out.push({ it: it, place: pl });
      });
    });
    out.sort(function (a, b) {
      if (a.it.n !== b.it.n) return a.it.n.localeCompare(b.it.n, "ar");
      return b.it.q - a.it.q;
    });
    return out;
  }

  /* ---------- الشاشات ---------- */

  function render() {
    var v = el("view");

    if (!configured()) { setBars(false); v.innerHTML = welcome(); return; }
    if (!S.snap || !S.snap.branches || !S.snap.branches.length) {
      setBars(false);
      v.innerHTML = '<div class="card"><div class="empty"><div class="big">▦</div>' +
        "<h4>لا توجد بيانات بعد</h4>" +
        "<p>اضغط ↻ لجلب المخزون. إن بقيت فارغة فتأكد أن جهاز المحل يعمل " +
        "وأن الربط مضبوط فيه من «المخزون والفروع ← إعداد الربط».</p>" +
        '<button class="btn primary" style="margin-top:14px" onclick="Stock.refresh()">جلب الآن</button>' +
        "</div></div>";
      paintFresh();
      return;
    }

    setBars(true);
    paintPlaces();
    paintFresh();

    var list = rows();
    var all = places();
    var shown = S.place === "*" ? all : all.filter(function (p) { return p.key === S.place; });
    var pieces = 0, value = 0, low = 0;
    shown.forEach(function (p) {
      p.items.forEach(function (i) {
        pieces += i.q;
        value += i.q * i.p;
        if (i.q <= 0 || (i.m > 0 && i.q <= i.m)) low++;
      });
    });

    var h = "";

    /* عند الوقوف على مكان واحد: من هو، ومتى آخر خبر منه، وكيف تتصل به.
       أن ترى ٤٠ نسخة في مخزن بعيد ثم تبحث عن رقمه في مكان آخر — عناء بلا سبب. */
    if (S.place !== "*" && shown.length === 1) {
      var pl = shown[0], pa = ageOf(pl.at);
      h += '<div class="placebar' + (pa.cls === "bad" ? " stale" : "") + '">' +
        "<div>" + "<b>" + (pl.kind === "wh" ? "▤ " : "") + esc(pl.name) + "</b>" +
        '<span class="pb-sub">' +
        (pl.city ? esc(pl.city) + " · " : "") + esc(pa.txt) +
        (pl.kind === "wh" && pl.parent ? " · يتبع " + esc(pl.parent) : "") +
        "</span></div>" +
        (pl.phone
          ? '<a class="pb-call" href="tel:' + esc(String(pl.phone).replace(/[^\d+]/g, "")) +
            '">☏ اتصال</a>'
          : "") +
        "</div>";
    }

    h += '<div class="stats">' +
      "<div><b>" + (S.q ? list.length : shown.reduce(function (s2, p) { return s2 + p.items.length; }, 0)) +
      "</b><span>" + (S.q ? "نتيجة" : "صنف") + "</span></div>" +
      "<div><b>" + pieces + "</b><span>قطعة</span></div>" +
      '<div class="' + (low ? "r" : "") + '"><b>' + low + "</b><span>نفد أو قارب</span></div>" +
      "</div>";

    if (!list.length) {
      h += '<div class="card"><div class="empty"><div class="big">⌕</div>' +
        "<h4>لا نتائج</h4><p>جرّب اسماً آخر أو امسح البحث.</p></div></div>";
      v.innerHTML = h;
      return;
    }

    /* نجمع الصنف الواحد عبر الأماكن: السؤال الحقيقي «أين يوجد وكم؟» */
    var byName = {};
    list.forEach(function (r) {
      var k = norm(r.it.n);
      if (!byName[k]) byName[k] = { n: r.it.n, a: r.it.a, b: r.it.b, p: r.it.p, total: 0, at: [] };
      byName[k].total += r.it.q;
      byName[k].at.push({ place: r.place, q: r.it.q, loc: r.it.loc, m: r.it.m });
      if (!byName[k].b && r.it.b) byName[k].b = r.it.b;
    });

    var keys = Object.keys(byName).sort(function (a, b) {
      return byName[a].n.localeCompare(byName[b].n, "ar");
    });

    keys.slice(0, 300).forEach(function (k) {
      var g = byName[k];
      var out = g.total <= 0;
      h += '<div class="srow' + (out ? " out" : "") + '">' +
        '<div class="sr-head">' +
        '<b class="sr-name">' + esc(g.n) + "</b>" +
        '<span class="sr-total' + (out ? " bad" : "") + '">' + g.total + "</span>" +
        "</div>" +
        (g.a ? '<div class="sr-sub">' + esc(g.a) + "</div>" : "") +
        '<div class="sr-where">';
      g.at.forEach(function (w) {
        var st = w.q <= 0 ? "bad" : (w.m > 0 && w.q <= w.m ? "warn" : "ok");
        var a = ageOf(w.place.at);
        h += '<div class="wchip ' + st + (a.cls === "bad" ? " stale" : "") + '">' +
          "<b>" + w.q + "</b> " + esc(w.place.name) +
          (w.loc ? ' <span class="wloc">' + esc(w.loc) + "</span>" : "") +
          (a.cls === "bad" ? ' <span class="wold">' + esc(a.txt) + "</span>" : "") +
          "</div>";
      });
      h += "</div>" +
        '<div class="sr-foot">' +
        (g.p > 0 ? "<span>البيع " + money(g.p) + "</span>" : "") +
        (g.b ? '<span class="num">' + esc(g.b) + "</span>" : "") +
        "</div></div>";
    });

    if (keys.length > 300) {
      h += '<p class="muted small center" style="padding:12px">معروض 300 من ' +
        keys.length + " — ضيّق البحث.</p>";
    }

    v.innerHTML = h;
  }

  function setBars(on) {
    el("searchBar").hidden = !on;
    el("places").hidden = !on;
  }

  function paintFresh() {
    var e = el("fresh");
    if (!e) return;
    if (!S.snap) { e.textContent = "لم يُجلب شيء بعد"; e.className = ""; return; }
    var list = (S.snap.branches || []).map(function (b) { return String(b.at || ""); }).sort();
    var oldest = list[0], newest = list[list.length - 1];
    var ao = ageOf(oldest || S.snap.at), an = ageOf(newest || S.snap.at);
    if (list.length > 1 && ao.cls !== an.cls) {
      e.textContent = "أحدثها " + an.txt + " · أقدمها " + ao.txt;
    } else {
      e.textContent = "بيانات المحل: " + ao.txt;
    }
    e.className = ao.cls;
  }

  function paintPlaces() {
    var host = el("places");
    var all = places();
    var h = '<button class="' + (S.place === "*" ? "on" : "") +
      '" onclick="Stock.setPlace(\'*\')">الكل</button>';
    all.forEach(function (p) {
      var a = ageOf(p.at);
      /* علامة على المكان الذي بياناته قديمة: الرقم القديم أخطر من
         لا رقم، لأن صاحبه يظنه اليوم. */
      h += '<button class="' + (S.place === p.key ? "on" : "") +
        (a.cls === "bad" ? " stale" : "") +
        '" onclick="Stock.setPlace(\'' + esc(p.key) + '\')" title="' + esc(a.txt) + '">' +
        (p.kind === "wh" ? "▤ " : "") + esc(p.name) +
        (a.cls === "bad" ? '<span class="age">' + esc(a.txt) + "</span>" : "") +
        "</button>";
    });
    host.innerHTML = h;
  }

  function welcome() {
    return '<div class="card">' +
      "<h2>اربطه بجهاز المحل</h2>" +
      '<p class="sub">هذه الصفحة تقرأ نفس اللقطة التي يرفعها جهاز المحل ' +
      "للربط بين الفروع. تحتاج شيئين من إعدادات الربط في البرنامج: " +
      "<b>عنوان الـWorker</b> و<b>كلمة السر</b>.</p>" +
      '<p class="hint" style="line-height:1.9;margin-bottom:16px">في البرنامج على الكمبيوتر: ' +
      "<b>المخزون والفروع ← إعداد الربط</b>. انسخ العنوان وكلمة السر من هناك. " +
      "إن لم يكن الربط مضبوطاً بعد، اضبطه أولاً حسب التعليمات في ملف " +
      "<span class=\"num\">cloud/worker.js</span>.</p>" +
      '<button class="btn primary" onclick="Stock.settings()">أدخل بيانات الربط</button>' +
      "</div>" +
      '<div class="card"><h2>ماذا سترى؟</h2>' +
      '<p class="sub">كل صنف وأين يوجد وكم بقي منه — في فرعك وفي الفروع ' +
      "الأخرى وفي المخازن. للعرض فقط: لا تبيع ولا تعدّل من هنا.</p>" +
      '<p class="hint">لا تظهر أسعار الجملة ولا أرباحك — اللقطة لا تحملها أصلاً.</p>' +
      "</div>";
  }

  /* ---------- الإعدادات ---------- */

  function settings() {
    sheet("بيانات الربط",
      '<div class="field"><label>عنوان الـWorker</label>' +
      '<input class="inp" id="s_url" value="' + esc(S.cfg.url) +
      '" placeholder="https://maktaba-sync.xxx.workers.dev" autocomplete="off"></div>' +
      '<div class="field"><label>كلمة سر الربط</label>' +
      '<input class="inp" id="s_key" type="password" value="' + esc(S.cfg.key) +
      '" autocomplete="off"></div>' +
      '<p class="hint" style="line-height:1.9">انسخهما من البرنامج: المخزون والفروع ← ' +
      "إعداد الربط. يُحفظان على هذا التلفون وحده.</p>" +
      '<button class="btn primary" onclick="Stock.saveCfg()">حفظ وجلب المخزون</button>' +
      '<a class="btn" href="index.html">الذهاب إلى تسجيل الكتب</a>' +
      (S.snap ? '<button class="btn danger" onclick="Stock.wipe()">مسح البيانات المحفوظة</button>' : "") +
      '<button class="btn" onclick="Stock.closeSheet()">إغلاق</button>',
      function () { var u = el("s_url"); if (u && !u.value) u.focus(); });
  }

  function saveCfg() {
    var u = el("s_url"), k = el("s_key");
    if (!u) return;
    var url = u.value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    S.cfg.url = url;
    S.cfg.key = k ? k.value.trim() : "";
    save();
    closeSheet();
    if (!S.cfg.url) { render(); return; }
    refresh();
  }

  function wipe() {
    S.snap = null;
    save();
    closeSheet();
    render();
    toast("مُسحت البيانات المحفوظة.");
  }

  function setQ(v) { S.q = v; render(); }
  function setPlace(k) { S.place = k; save(); render(); }

  function boot() {
    S = load();
    render();
    if (configured()) refresh();
    // تحديث عند العودة للصفحة — الأرقام القديمة أسوأ من لا شيء
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && configured() && !busy) refresh();
    });
  }

  return {
    boot: boot, refresh: refresh, render: render,
    settings: settings, saveCfg: saveCfg, wipe: wipe, closeSheet: closeSheet,
    setQ: setQ, setPlace: setPlace,
    places: places, rows: rows, ageOf: ageOf, norm: norm,
    get S() { return S; }
  };
})();
