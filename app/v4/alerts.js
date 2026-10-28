/* ============================================================
   واجهة 4.0 — التنبيهات والبضاعة الراكدة
   ------------------------------------------------------------
   التنبيهات (كما في 3.x): ما نفد وما قارب، وما يحتاج نقلاً من المخزن
   إلى الرفوف قبل أن يُشترى من جديد، وقائمة الشراء المقترحة وطباعتها.
   الراكدة (كما في 3.x): الصنف الراكد رأس مال واقف، فالترتيب بالمال
   المجمّد. حدّ الركود للكتب والقرطاسية من إعدادات المحل (meta.stale).
   ============================================================ */
var V4Alerts = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;
  var data = null, places = {};

  function stat(kind, lbl, val, foot) {
    return '<div class="card stat ' + kind + '"><div class="lbl">' + esc(lbl) + '</div><div class="val">' + val + "</div>" +
      (foot ? '<div class="foot">' + esc(foot) + "</div>" : "") + "</div>";
  }

  function loadPlaces() {
    return V4.call("places.list").then(function (l) {
      var byId = {};
      l.forEach(function (p) { byId[p.id] = p; });
      places = {};
      l.forEach(function (p) {
        var names = [], x = p, g = 0;
        while (x && x.kind !== "shop" && g++ < 10) { names.unshift(x.kind === "floor" ? x.code || x.name : x.name); x = byId[x.parentId]; }
        places[p.id] = names.join(" · ");
      });
    }, function () { places = {}; });
  }

  /* ---------- التنبيهات ---------- */

  function alertsPage() {
    return '<div id="alStats" class="grid g3" style="margin-bottom:16px"></div><div id="alRestock"></div>' +
      '<div class="card"><div class="card-head"><h3>قائمة الشراء المقترحة</h3><div class="spacer"></div>' +
      '<button class="btn sm" onclick="V4Alerts.printList()">طباعة القائمة</button></div><div id="alList"><div class="card-body muted">…</div></div></div>';
  }

  function need(x) { return Math.max(x.min * 2 - x.qty, 1); }

  function alertsAfter() {
    Promise.all([V4.call("alerts", { limit: 2000 }), loadPlaces()]).then(function (r) {
      var d = r[0];
      data = d.out.map(function (x) { x.out = true; return x; }).concat(d.low);
      var cost = data.length && data[0].cost !== undefined;
      var st = document.getElementById("alStats");
      if (!st) return;
      st.innerHTML = stat("bad", "أصناف نفدت تماماً", String(d.out.length), "لا يمكن بيعها الآن") +
        stat("warn", "قاربت على النفاد", String(d.low.length), "وصلت لحد التنبيه أو أقل") +
        (cost ? stat("accent", "قيمة النقص المطلوب شراؤه", money(data.reduce(function (s, x) { return s + Math.max(x.min - x.qty, 1) * x.cost; }, 0)), "تقدير بسعر الشراء")
          : stat("accent", "في المخازن منها", String(data.filter(function (x) { return x.inStores > 0; }).length), "تُنقل للرفوف بدل الشراء"));
      /* في المخزن نسخ منه: يُنقل للرفوف ولا يُشترى */
      var rs = data.filter(function (x) { return x.inStores > 0; });
      var host = document.getElementById("alRestock");
      host.innerHTML = rs.length ? '<div class="card" style="margin-bottom:16px;border-inline-start:3px solid var(--amber)"><div class="card-head">' +
        "<h3>تحتاج نقلاً من المخزن إلى الرفوف</h3><div class=\"spacer\"></div><span class=\"muted small\">" + rs.length + " صنف — موجودة، لا تشترِها</span></div>" +
        App.table([
          { h: "الصنف", c: function (x) { return '<b class="name">' + esc(x.title) + "</b>"; } },
          { h: "مكانه", c: function (x) { return '<span class="place-path">' + esc(places[x.homePlaceId] || "") + "</span>"; } },
          { h: "في المحل", cls: "num", c: function (x) { return '<span class="badge ' + (x.out ? "bad" : "warn") + '">' + x.qty + "</span>"; } },
          { h: "في المخازن", cls: "num", c: function (x) { return "<b>" + x.inStores + "</b>"; } },
          { h: "", c: function (x) { return V4.can("move_stock") && window.V4Stock ? '<button class="btn sm primary" onclick="V4Stock.move(' + x.id + ',0)">انقل للرفوف</button>' : ""; } }
        ], rs) + "</div>" : "";
      var list = document.getElementById("alList");
      list.innerHTML = App.table([
        { h: "الصنف", c: function (x) {
          return '<b class="name">' + esc(x.title) + '</b><div class="muted small">' + (x.kind === "book" ? "كتاب" : "قرطاسية") + (x.by ? " · " + esc(x.by) : "") + "</div>"; } },
        { h: "مكانه", c: function (x) { return '<span class="place-path">' + esc(places[x.homePlaceId] || "") + "</span>"; } },
        { h: "المتبقي", cls: "num", c: function (x) { return "<b>" + x.qty + "</b>"; } },
        { h: "حد التنبيه", cls: "num", c: function (x) { return String(x.min); } },
        { h: "المقترح شراؤه", cls: "num", c: function (x) { return "<b>" + need(x) + "</b>"; } },
        { h: "الحالة", c: function (x) { return x.out ? '<span class="badge bad">نفد</span>' : '<span class="badge warn">قارب على النفاد</span>'; } },
        { h: "", c: function () { return V4.can("receive") ? '<button class="btn sm" onclick="location.hash=\'#/receive\'">إدخال بضاعة</button>' : ""; } }
      ], data, { rowClass: function (x) { return x.out ? "out" : "low"; }, emptyIcon: "check", emptyTitle: "كل شيء متوفر",
        emptyText: "لا صنف وصل حد التنبيه. تتحدث هذه الصفحة بعد كل بيعة." });
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function printList() {
    if (!data || !data.length) { App.toast("لا شيء ناقص.", "ok"); return; }
    var m = (V4.shop() && V4.shop().meta) || {};
    var h = '<div class="receipt a4"><h2>' + esc(m.shopName || "المحل") + '</h2><div class="c">قائمة الشراء — ' + esc(App.dateAr(V4.today())) + "</div><hr>" +
      "<table><thead><tr><th>الصنف</th><th>المتبقي</th><th>المقترح</th><th>في المخازن</th></tr></thead><tbody>" +
      data.map(function (x) {
        return "<tr><td>" + esc(x.title) + (x.by ? " — " + esc(x.by) : "") + '</td><td class="num">' + x.qty + '</td><td class="num">' + need(x) +
          '</td><td class="num">' + (x.inStores || "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    App.printHtml(h);
  }

  /* ---------- الراكدة ---------- */

  var sv = { q: "", kind: "all", sort: "frozen", shown: 100 }, stale = [];

  function cfg() {
    var m = (V4.shop() && V4.shop().meta) || {};
    var c = m.stale && typeof m.stale === "object" ? m.stale : {};
    return { bookDays: App.num(c.bookDays) || 120, statDays: App.num(c.statDays) || 90 };
  }

  function idle(x) {
    var d = String(x.lastSold || x.createdAt || "").slice(0, 10);
    if (!d) return null;
    var t = new Date(d + "T00:00:00"), now = new Date(V4.today() + "T00:00:00");
    return isNaN(t.getTime()) ? null : Math.round((now - t) / 86400000);
  }

  function stalePage() {
    var c = cfg();
    return '<div id="stStats" class="grid g4" style="margin-bottom:18px"></div>' +
      '<div class="toolbar"><input class="inp search" id="staleQ" autocomplete="off" placeholder="ابحث في الراكد…" value="' + esc(sv.q) +
      '" oninput="V4Alerts.staleSet(\'q\',this.value)">' +
      '<div class="seg" style="max-width:420px">' + [["all", "الكل"], ["book", "كتب"], ["stat", "قرطاسية"], ["never", "لم يُبَع قط"]].map(function (k) {
        return '<button class="' + (sv.kind === k[0] ? "on" : "") + '" onclick="V4Alerts.staleSet(\'kind\',\'' + k[0] + '\')">' + k[1] + "</button>";
      }).join("") + "</div>" +
      '<select class="inp" style="width:170px" onchange="V4Alerts.staleSet(\'sort\',this.value)">' +
      [["frozen", "المال المجمّد"], ["idle", "الأطول ركوداً"], ["qty", "الأكثر كمية"], ["name", "الاسم"]].map(function (k) {
        return '<option value="' + k[0] + '"' + (sv.sort === k[0] ? " selected" : "") + ">" + k[1] + "</option>";
      }).join("") + "</select>" +
      (V4.can("settings") ? '<button class="btn" onclick="V4Alerts.staleSettings()">⚙ ضبط المدة</button>' : "") +
      '<button class="btn" onclick="V4Alerts.staleXls()">تصدير Excel</button></div>' +
      '<p class="muted small" style="margin:-4px 2px 12px">الراكد: كتاب لم يُبع منذ ' + c.bookDays + " يوماً، وقرطاسية منذ " + c.statDays + " يوماً.</p>" +
      '<div class="card"><div id="stList"><div class="card-body muted">…</div></div></div><div class="pager" id="stMore"></div>';
  }

  function staleAfter() {
    var c = cfg();
    Promise.all([V4.call("stale", { days: Math.min(c.bookDays, c.statDays), limit: 5000 }), loadPlaces()]).then(function (r) {
      stale = r[0].map(function (x) {
        x.idle = idle(x);
        x.never = !x.lastSold;
        x.frozen = x.cost !== undefined ? x.qty * x.cost : 0;
        x.retail = x.qty * x.price;
        return x;
      }).filter(function (x) { return x.idle !== null && x.idle >= (x.kind === "book" ? c.bookDays : c.statDays); });
      var cost = stale.length && stale[0].cost !== undefined;
      var st = document.getElementById("stStats");
      if (!st) return;
      var pieces = stale.reduce(function (s, x) { return s + x.qty; }, 0), never = stale.filter(function (x) { return x.never; });
      st.innerHTML = (cost ? stat("bad", "رأس مال مجمّد", money(stale.reduce(function (s, x) { return s + x.frozen; }, 0)), "لو بِيع كله: " + money(stale.reduce(function (s, x) { return s + x.retail; }, 0)))
          : stat("bad", "قيمته بسعر البيع", money(stale.reduce(function (s, x) { return s + x.retail; }, 0)), "")) +
        stat("", "أصناف راكدة", String(stale.length), pieces + " قطعة على الرفوف") +
        stat("warn", "لم يُبَع منها شيء قط", String(never.length), cost ? money(never.reduce(function (s, x) { return s + x.frozen; }, 0)) + " مجمّدة" : "") +
        stat("", "حد الركود", c.bookDays + " / " + c.statDays, "يوماً — كتب / قرطاسية");
      paintStale();
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function staleList() {
    var list = stale.filter(function (x) {
      if (sv.kind === "book" || sv.kind === "stat") return x.kind === sv.kind;
      if (sv.kind === "never") return x.never;
      return true;
    });
    list.sort(function (a, b) {
      if (sv.sort === "idle") return b.idle - a.idle;
      if (sv.sort === "qty") return b.qty - a.qty;
      if (sv.sort === "name") return a.title.localeCompare(b.title, "ar");
      return (b.frozen - a.frozen) || (b.retail - a.retail);
    });
    return App.rank(list, sv.q, function (x) { return [x.title, x.code, x.by, x.cat]; });
  }

  function paintStale() {
    var host = document.getElementById("stList");
    if (!host) return;
    var cost = stale.length && stale[0].cost !== undefined;
    var list = staleList();
    host.innerHTML = App.table([
      { h: "الصنف", c: function (x) { return '<b class="name">' + esc(x.title) + '</b><div class="muted small">' + (x.kind === "book" ? "كتاب" : "قرطاسية") + (x.by ? " · " + esc(x.by) : "") + "</div>"; } },
      { h: "مكانه", c: function (x) { return '<span class="place-path">' + esc(places[x.homePlaceId] || "") + "</span>"; } },
      { h: "آخر بيع", c: function (x) { return x.never ? '<span class="badge warn">لم يُبَع قط</span>' : '<span class="num">' + esc(x.lastSold) + "</span>"; } },
      { h: "راكد منذ", cls: "num", c: function (x) { return "<b>" + x.idle + "</b> يوماً"; } },
      { h: "الكمية", cls: "num", c: function (x) { return String(x.qty); } },
      { h: "السعر", cls: "num", c: function (x) { return money(x.price); } }
    ].concat(cost ? [{ h: "المال المجمّد", cls: "num", c: function (x) { return "<b>" + money(x.frozen) + "</b>"; } }] : []),
      list.slice(0, sv.shown), { emptyIcon: "check", emptyTitle: stale.length ? "لا نتيجة" : "لا يوجد ركود", emptyText: stale.length ? "" : "كل أصنافك تحرّكت خلال المدة المحددة." });
    var m = document.getElementById("stMore");
    if (m) m.innerHTML = list.length > sv.shown ? '<button class="btn sm" onclick="V4Alerts.staleMore()">المزيد (' + (list.length - sv.shown) + ")</button>" : "";
  }

  function staleSet(k, v) {
    sv[k] = v; sv.shown = 100;
    if (k === "q") paintStale(); else V4.refresh();
  }
  function staleMore() { sv.shown += 100; paintStale(); }

  function staleSettings() {
    var c = cfg();
    V4.form({
      title: "حد الركود", size: "narrow", values: { bookDays: c.bookDays, statDays: c.statDays },
      fields: [
        { k: "bookDays", label: "الكتاب راكد بعد (يوم)", type: "number", min: 7, full: true },
        { k: "statDays", label: "القرطاسية راكدة بعد (يوم)", type: "number", min: 7, full: true }
      ],
      onSave: function (v) {
        return V4.run("settings.get", { key: "meta" }).then(function (m) {
          m = m || {};
          var old = m.stale && typeof m.stale === "object" ? m.stale : {};
          old.bookDays = Math.max(7, Math.round(App.num(v.bookDays)));
          old.statDays = Math.max(7, Math.round(App.num(v.statDays)));
          m.stale = old;
          return V4.run("setting.set", { key: "meta", value: m }).then(function (r) {
            if (V4.queued(r, "حد الركود")) return;
            if (V4.shop() && V4.shop().meta) V4.shop().meta.stale = old;
            App.toast("حُفظ.", "ok");
            V4.refresh();
          });
        });
      }
    });
  }

  function staleXls() {
    var list = staleList();
    if (!list.length) { App.toast("لا يوجد ركود.", "ok"); return; }
    var cost = list[0].cost !== undefined;
    App.xls("البضاعة-الراكدة-" + V4.today(), "البضاعة الراكدة", [
      { h: "الصنف", c: function (x) { return x.title; } },
      { h: "المؤلف / الماركة", c: function (x) { return x.by || ""; } },
      { h: "آخر بيع", c: function (x) { return x.never ? "لم يُبَع قط" : x.lastSold; } },
      { h: "راكد منذ (يوم)", t: "i", c: function (x) { return x.idle; } },
      { h: "الكمية", t: "i", sum: true, c: function (x) { return x.qty; } },
      { h: "السعر", t: "n", c: function (x) { return x.price / 1000; } },
      cost ? { h: "المال المجمّد", t: "n", sum: true, c: function (x) { return x.frozen / 1000; } } : null
    ].filter(Boolean), list, ((V4.shop() || {}).meta || {}).shopName || "");
  }

  V4.page({ o: 46, g: "المخزون", k: "alerts", t: "التنبيهات", ic: "bell", perm: "view_stock", render: alertsPage, after: alertsAfter });
  V4.page({ o: 47, g: "المخزون", k: "stale", t: "البضاعة الراكدة", ic: "stale", perm: "reports", render: stalePage, after: staleAfter });

  return {
    printList: printList, staleSet: staleSet, staleMore: staleMore, staleSettings: staleSettings, staleXls: staleXls
  };
})();
