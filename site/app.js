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
      q: "", filter: "", shown: PAGE, screen: "home"
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
      if (d.snap && typeof d.snap !== "object") d.snap = null;
      return d;
    } catch (e) { return blank(); }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { /* ذاكرة ممتلئة أو خاصة — نكمل بلا حفظ */ }
  }

  /* ---------- أدوات ---------- */

  function el(id) { return document.getElementById(id); }

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
              d: "", nt: "", u: "", loc: w.place || ""
            };
          })
        });
      });
    });
    return out;
  }

  /* الصنف الواحد مجموعاً عبر كل الأماكن — السؤال الحقيقي «أين وكم؟» */
  function items() {
    var by = {};
    places().forEach(function (pl) {
      pl.items.forEach(function (it) {
        var k = norm(it.n) || ("b:" + it.b);
        if (!by[k]) {
          by[k] = {
            key: k, n: it.n, a: it.a, b: it.b, c: it.c, code: it.k,
            p: it.p, t: it.t, d: it.d, nt: it.nt, u: it.u,
            total: 0, low: false, minTop: 0, at: []
          };
        }
        var g = by[k];
        g.total += it.q;
        g.at.push({ place: pl, q: it.q, loc: it.loc, m: it.m });
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
    if (S.filter.indexOf("c:") === 0) {
      var c = S.filter.slice(2);
      return list.filter(function (g) { return g.c === c; });
    }
    return list;
  }

  function sortItems(list) {
    return list.slice().sort(function (a, b) {
      return String(a.n).localeCompare(String(b.n), "ar");
    });
  }

  /* ---------- الرسم ---------- */

  function render() {
    var gate = el("gate"), app = el("app");
    if (!configured()) {
      gate.hidden = false; app.hidden = true;
      return;
    }
    gate.hidden = true; app.hidden = false;

    paintHead();

    if (S.screen === "settings") { el("searchWrap").hidden = true; paintSettings(); return; }
    el("searchWrap").hidden = false;

    if (!S.snap) { paintLoading(); return; }
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
      '<span class="n">' + list.length + "</span></div>";

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

  function filterName() {
    if (S.filter === "out") return "نفد من المخزون";
    if (S.filter === "low") return "قارب على النفاد";
    if (S.filter === "book") return "الكتب";
    if (S.filter === "stat") return "القرطاسية";
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
    if (g.at.length > 1) tags += '<span class="tag">في ' + g.at.length + " أماكن</span>";
    else if (g.at[0] && g.at[0].loc) tags += '<span class="tag">' + esc(g.at[0].loc) + "</span>";
    if (!g.b) tags += '<span class="tag a">بلا باركود</span>';

    /* تأخير الظهور يتدرّج بالصنف لا بقيمة سطرية: سياسة الأمان تمنع
       style=""، والأصناف العشرة الأولى تكفي للإحساس بالتتابع. */
    return '<button class="row d' + Math.min(i, 9) + (out ? " out" : "") +
      '" data-act="open" data-arg="' + esc(g.key) + '">' +
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
    var svg = icon === "search"
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7l9-4 9 4v10l-9 4-9-4z" stroke-linejoin="round"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>';
    return '<div class="empty">' + svg + "<h3>" + title + "</h3><p>" + text + "</p>" +
      (action || "") + "</div>";
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
      '<div class="' + (out ? "bad" : (g.low ? "warn" : "")) + '"><b>' + g.total +
      "</b><span>" + (g.u || "قطعة") + " في المجموع</span></div>" +
      "<div><b>" + money(g.p) + "</b><span>سعر البيع</span></div>" +
      "</div>";

    h += '<dl class="det-rows">';
    h += detRow("الباركود", g.b ? '<span class="ltr">' + esc(g.b) + "</span>" : "— لم يُصدر بعد —");
    if (g.code) h += detRow("الرمز", '<span class="ltr">' + esc(g.code) + "</span>");
    if (g.total > 0 && g.p > 0) {
      h += detRow("قيمة المتوفّر", '<span class="ltr">' + money(g.total * g.p) + "</span>");
    }
    h += "</dl>";

    if (g.nt) h += '<div class="det-note">' + esc(g.nt) + "</div>";

    h += '<div class="det-where"><h3>أين يوجد</h3>';
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
        esc(String(ph).replace(/[^\d+]/g, "")) + '">اتصل بالفرع</a>' : "") +
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
      h += '<div class="card"><h2>هذه النسخة</h2>' +
        '<dl class="kv"><dt>وصلت</dt><dd>' + esc(ageOf(S.snap.at).txt) + "</dd></dl>" +
        '<dl class="kv"><dt>الأصناف</dt><dd>' + countItems() + "</dd></dl>" +
        '<p class="sub tight">محفوظة على هذا الجهاز وحده، فتعمل الصفحة ' +
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
    wipe: function () { wipe(); }
  };

  function onTap(e) {
    var t = e.target;
    while (t && t !== document.body) {
      if (t.getAttribute) {
        var a = t.getAttribute("data-act");
        if (a) {
          var fn = ACTS[a];
          if (fn) { e.preventDefault(); fn(t.getAttribute("data-arg") || ""); }
          return;
        }
      }
      t = t.parentNode;
    }
  }

  function boot() {
    S = load();

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
