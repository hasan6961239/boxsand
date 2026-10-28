/* ============================================================
   واجهة 4.0 — المخزون والأماكن
   ------------------------------------------------------------
   كما في «المخزون» في 3.x، على شجرة الأماكن (قرار 0001):
   - بطاقة للمحل، ولكل غرفة خزين، ولكل مخزن: كم صنفاً وكم قطعة وقيمتها.
   - ما في كل مكان صنفاً صنفاً، والنقل بين الأماكن وتعديل الكمية بسببها.
   - النقل بالقارئ: تحمل الكرتونة وتمسح النسخ واحدة واحدة، ثم تؤكّد مرة.
   - شجرة الأماكن: طابق · قسم · خزانة · رف، وغرف الخزين والمخازن.
   ============================================================ */
var V4Stock = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;
  var places = [], byId = {}, sum = {}, view = { place: 0, q: "", offset: 0 }, seq = 0;
  var KIND = { shop: "المحل", floor: "طابق", section: "قسم", cabinet: "خزانة", shelf: "رف", room: "غرفة خزين", store: "مخزن" };
  var CHILD = { shop: ["floor", "section", "cabinet", "room", "store"], floor: ["section", "cabinet", "room"], section: ["cabinet", "shelf"], cabinet: ["shelf"] };

  /* ---------- الأماكن ---------- */

  function loadPlaces() {
    return Promise.all([V4.call("places.list"), V4.call("places.summary")]).then(function (r) {
      places = r[0]; byId = {}; sum = {};
      places.forEach(function (p) { byId[p.id] = p; p.kids = []; });
      places.forEach(function (p) { if (byId[p.parentId]) byId[p.parentId].kids.push(p); });
      r[1].forEach(function (s) { sum[s.id] = s; });
      places.forEach(function (p) {
        var names = [], x = p, guard = 0;
        while (x && x.kind !== "shop" && guard++ < 10) { names.unshift(x.kind === "floor" ? x.code || x.name : x.name); x = byId[x.parentId]; }
        p.path = names.join(" · ") || p.name;
      });
      return places;
    });
  }

  /* مجموع مكان وما تحته. skip: أنواع لا تُجمع (غرف الخزين والمخازن لها بطاقاتها) */
  function total(p, skip) {
    var s = { items: 0, pieces: 0, value: 0 };
    (function walk(x) {
      if (x !== p && skip && skip.indexOf(x.kind) >= 0) return;
      var m = sum[x.id];
      if (m) { s.items += m.items; s.pieces += m.pieces; s.value += m.value || 0; }
      x.kids.forEach(walk);
    })(p);
    return s;
  }

  function path(id) { return byId[id] ? byId[id].path : ""; }

  /* ---------- الصفحة ---------- */

  function page() {
    return '<div id="stHost"><div class="muted">…</div></div>';
  }

  function after() {
    loadPlaces().then(paint).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function paint() {
    var host = document.getElementById("stHost");
    if (!host) return;
    if (view.place && byId[view.place]) { placeView(host); return; }
    view.place = 0;
    var cost = V4.can("view_cost"), shop = byId[1];
    var card = function (p, tag, cls, t, sub) {
      return '<button class="card branch-card ' + cls + '" onclick="V4Stock.open(' + p.id + ')">' +
        '<div class="bc-top"><span class="bc-tag ' + cls + '">' + esc(tag) + "</span></div>" +
        "<h3>" + esc(p.id === 1 ? ((V4.shop() || {}).meta || {}).shopName || "المحل" : p.name) + "</h3>" +
        '<div class="bc-sub">' + esc(sub) + "</div>" +
        '<div class="bc-nums"><div><b class="num">' + t.items + "</b><span>صنف</span></div>" +
        '<div><b class="num">' + t.pieces + "</b><span>قطعة</span></div>" +
        (cost ? '<div><b class="num">' + money(t.value) + "</b><span>بسعر الشراء</span></div>" : "") + "</div></button>";
    };
    var h = '<div class="toolbar"><div class="spacer"></div>' +
      (V4.can("places") ? '<button class="btn" onclick="V4Stock.tree()">شجرة الأماكن</button>' +
        '<button class="btn primary" onclick="V4Stock.addPlace(1,\'store\')">+ إضافة مخزن</button>' : "") + "</div>" +
      '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:14px">';
    if (shop) h += card(shop, "المحل", "mine", total(shop, ["room", "store"]), "الرفوف وأرض البيع");
    places.filter(function (p) { return p.kind === "room"; }).forEach(function (p) {
      h += card(p, "غرفة خزين", "room", total(p), "داخل المحل — ليست على الرفوف، وتُباع منها");
    });
    places.filter(function (p) { return p.kind === "store"; }).forEach(function (p) {
      h += card(p, "مخزن", "wh", total(p), (p.address || p.phone ? [p.address, p.phone].filter(Boolean).join(" · ") : "لا يُباع منه مباشرة"));
    });
    host.innerHTML = h + "</div>";
  }

  function open(id) { view.place = id; view.q = ""; view.offset = 0; paint(); }
  function back() { view.place = 0; after(); }

  /* ---------- ما في مكان ---------- */

  function placeView(host) {
    var p = byId[view.place], t = total(p, p.id === 1 ? ["room", "store"] : null), cost = V4.can("view_cost");
    var scanner = (p.kind === "room" || p.kind === "store") && V4.can("move_stock");
    host.innerHTML = '<div class="toolbar"><button class="btn" onclick="V4Stock.back()">→ كل الأماكن</button>' +
      '<b style="font-family:var(--font-head);font-size:20px">' + esc(p.id === 1 ? "المحل" : p.path) + "</b>" +
      '<span class="badge">' + esc(KIND[p.kind] || p.kind) + "</span>" +
      '<span class="muted small">' + t.items + " صنف · " + t.pieces + " قطعة" + (cost ? " · " + money(t.value) : "") + "</span>" +
      '<div class="spacer"></div>' +
      (scanner ? '<button class="btn primary" onclick="V4Stock.scanMove()">نقل بالقارئ ⇄</button>' : "") + "</div>" +
      '<div class="toolbar"><input class="inp search" id="stQ" placeholder="ابحث في هذا المكان…" autocomplete="off" value="' + esc(view.q) +
      '" oninput="V4Stock.search(this.value)"></div>' +
      '<div class="card"><div id="stItems"><div class="card-body muted">…</div></div></div><div class="pager" id="stPager"></div>';
    loadItems();
  }

  function search(v) { view.q = v; view.offset = 0; loadItems(); }
  function more(n) { view.offset = Math.max(0, view.offset + n); loadItems(); }

  function loadItems() {
    var my = ++seq, req = { placeId: view.place, limit: 50, offset: view.offset };
    if (view.q.trim()) req.q = view.q;
    V4.call("place.items", req).then(function (d) {
      if (my !== seq || d.cancelled) return;
      var host = document.getElementById("stItems");
      if (!host) return;
      host.innerHTML = App.table([
        { h: "الصنف", c: function (it) { return '<b class="name">' + esc(it.title) + "</b>" + (it.barcode ? '<div class="muted small num">' + esc(it.barcode) + "</div>" : ""); } },
        { h: "المؤلف / الماركة", c: function (it) { return esc(it.author || it.brand); } },
        { h: "مكانه", c: function (it) { return '<span class="place-path">' + esc(path(it.homePlaceId)) + "</span>"; } },
        { h: "هنا", cls: "num", c: function (it) { return "<b>" + it.placeQty + "</b>"; } },
        { h: "في المحل كله", cls: "num", c: function (it) { return String(it.qty); } },
        { h: "السعر", cls: "num", c: function (it) { return money(it.price); } },
        { h: "", c: function (it) {
          return (V4.can("move_stock") ? '<button class="btn sm" onclick="V4Stock.move(' + it.id + "," + view.place + ')">نقل</button> ' : "") +
            (V4.can("edit_items") ? '<button class="btn sm ghost" onclick="V4Stock.adjust(' + it.id + "," + view.place + ')">تعديل الكمية</button>' : ""); } }
      ], d.items, { emptyIcon: "boxes", emptyTitle: view.q.trim() ? "لا شيء يطابق «" + view.q.trim() + "» هنا" : "لا بضاعة هنا", emptyText: "" });
      var pg = document.getElementById("stPager");
      if (pg) pg.innerHTML = (view.offset > 0 ? '<button class="btn sm" onclick="V4Stock.more(-50)">→ السابق</button>' : "") +
        (view.offset + 50 < d.total ? '<button class="btn sm" onclick="V4Stock.more(50)">التالي ←</button>' : "");
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function done(r, what, msg) {
    if (V4.queued(r, what)) return;
    App.toast(msg, "ok");
    loadPlaces().then(function () { if (document.getElementById("stItems")) loadItems(); else paint(); });
  }

  /* ---------- النقل وتعديل الكمية ---------- */

  function placeOptions(skip) {
    return places.filter(function (p) { return p.id !== skip; }).map(function (p) {
      return { v: p.id, t: (p.id === 1 ? "المحل (بلا مكان محدد)" : p.path) + (p.kind === "store" ? " — مخزن" : p.kind === "room" ? " — غرفة خزين" : "") };
    });
  }

  function move(itemId, from) {
    (places.length ? Promise.resolve() : loadPlaces()).then(function () { return V4.run("item.get", { id: itemId }); }).then(function (it) {
      var have = (it.stock || []).filter(function (s) { return s.qty > 0; });
      if (!have.length) { App.toast("لا كمية من «" + it.title + "» في أي مكان.", "warn"); return; }
      /* من المكان المطلوب إن كان فيه، وإلا من مخزن فيه (نقل للرفوف)، وإلا أول مكان فيه */
      var store = have.filter(function (s) { return s.kind === "store"; })[0];
      var start = have.some(function (s) { return s.placeId === from; }) ? from : store ? store.placeId : have[0].placeId;
      var to = start === it.homePlaceId ? 1 : it.homePlaceId;
      V4.form({
        title: "نقل: " + it.title, size: "narrow",
        values: { from: start, to: to, qty: 1 },
        fields: [
          { k: "from", label: "من", type: "select", full: true, options: have.map(function (s) { return { v: s.placeId, t: (s.placeId === 1 ? "المحل" : path(s.placeId)) + " — فيه " + s.qty }; }) },
          { k: "to", label: "إلى", type: "select", full: true, options: placeOptions(0) },
          { k: "qty", label: "كم نسخة", type: "number", min: 1, required: true, full: true }
        ],
        saveLabel: "انقل",
        onSave: function (v) {
          if (Number(v.from) === Number(v.to)) { App.toast("المكانان واحد.", "warn"); return false; }
          var q = Math.round(App.num(v.qty));
          if (q <= 0) { App.toast("اكتب كمية صحيحة.", "warn"); return false; }
          return V4.run("stock.move", { itemId: itemId, from: Number(v.from), to: Number(v.to), qty: q }).then(function (r) {
            done(r, "نقل «" + it.title + "»", "نُقل " + q + " من «" + it.title + "».");
          });
        }
      });
    });
  }

  function adjust(itemId, place) {
    V4.run("item.get", { id: itemId }).then(function (it) {
      var here = 0;
      (it.stock || []).forEach(function (s) { if (s.placeId === place) here = s.qty; });
      V4.form({
        title: "تعديل الكمية: " + it.title, size: "narrow",
        values: { qty: here },
        topHtml: '<p class="muted small" style="margin:0 0 12px">في «' + esc(place === 1 ? "المحل" : path(place)) + "» الآن " + here + ". التعديل يُسجَّل بسببه في سجل العمليات.</p>",
        fields: [
          { k: "qty", label: "الكمية الصحيحة هنا", type: "number", min: 0, required: true, full: true },
          { k: "note", label: "السبب", required: true, full: true, placeholder: "مثلاً: تالف، أو عُدّ من جديد" }
        ],
        onSave: function (v) {
          var delta = Math.round(App.num(v.qty)) - here;
          if (!delta) { App.toast("لم تتغيّر الكمية.", "warn"); return false; }
          return V4.run("stock.adjust", { itemId: itemId, placeId: place, delta: delta, note: v.note }).then(function (r) {
            done(r, "كمية «" + it.title + "»", "عُدّلت الكمية: " + (delta > 0 ? "+" : "") + delta);
          });
        }
      });
    });
  }

  /* ---------- النقل بالقارئ ----------
     كل مسحة نسخة واحدة؛ لا يتغيّر شيء حتى «تأكيد النقل». الوجهة: مكان كل صنف (الرف)،
     أو العكس من الرفوف إلى هذا المكان */
  function scanMove() {
    var p = byId[view.place], mv = { dir: "out", lines: [] };
    var box = document.createElement("div");
    box.innerHTML = '<div class="seg" style="margin-bottom:12px"><button data-d="out">من «' + esc(p.name) + '» ⇦ إلى الرفوف</button>' +
      '<button data-d="in">من الرفوف ⇦ إلى «' + esc(p.name) + '»</button></div>' +
      '<input class="big-input" id="mvScan" autocomplete="off" style="width:100%" placeholder="امسح باركود النسخة التي تحملها، أو اكتب اسمها ثم Enter…">' +
      '<div id="mvLines" style="margin-top:12px"></div>';
    function seg() {
      Array.prototype.forEach.call(box.querySelectorAll("[data-d]"), function (b) { b.classList.toggle("on", b.getAttribute("data-d") === mv.dir); });
    }
    function paintLines() {
      var host = box.querySelector("#mvLines");
      host.innerHTML = mv.lines.length ? App.table([
        { h: "الصنف", c: function (l) { return esc(l.title); } },
        { h: "من", c: function (l) { return esc(mv.dir === "out" ? p.name : path(l.home)); } },
        { h: "إلى", c: function (l) { return esc(mv.dir === "out" ? path(l.home) : p.name); } },
        { h: "النسخ", cls: "num", c: function (l) { return "<b>" + l.n + "</b>"; } },
        { h: "", c: function (l, i) { return '<button class="btn sm ghost" data-del="' + l.id + '">✕</button>'; } }
      ], mv.lines) : '<div class="empty" style="padding:18px"><p>امسح النسخ واحدة واحدة.</p></div>';
      Array.prototype.forEach.call(host.querySelectorAll("[data-del]"), function (b) {
        b.onclick = function () { var id = Number(b.getAttribute("data-del")); mv.lines = mv.lines.filter(function (l) { return l.id !== id; }); paintLines(); };
      });
    }
    function addItem(it) {
      var l = null;
      mv.lines.forEach(function (x) { if (x.id === it.id) l = x; });
      if (l) l.n++; else mv.lines.unshift({ id: it.id, title: it.title, home: it.homePlaceId, n: 1 });
      paintLines();
      App.toast(it.title + " → " + (l ? l.n : 1), "ok");
    }
    var m = App.modal({
      title: "نقل بالقارئ — " + p.name, size: "wide", body: box, cancelLabel: "إلغاء",
      actions: [{ label: "تأكيد النقل", kind: "primary", click: function (close) {
        if (!mv.lines.length) { App.toast("لم تمسح شيئاً.", "warn"); return; }
        var jobs = mv.lines.map(function (l) {
          var home = l.home && l.home !== p.id ? l.home : 1;
          return V4.call("stock.move", { itemId: l.id, from: mv.dir === "out" ? p.id : home, to: mv.dir === "out" ? home : p.id, qty: l.n })
            .then(function () { return null; }, function (e) { return l.title + ": " + e.message; });
        });
        Promise.all(jobs).then(function (errs) {
          errs = errs.filter(Boolean);
          close();
          if (errs.length) App.toast("لم يُنقل: " + errs.join(" · "), "bad");
          else App.toast("نُقلت " + mv.lines.reduce(function (s, l) { return s + l.n; }, 0) + " نسخة.", "ok");
          loadPlaces().then(function () { if (document.getElementById("stItems")) loadItems(); });
        });
      } }]
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-d]"), function (b) {
      b.onclick = function () { mv.dir = b.getAttribute("data-d"); seg(); paintLines(); box.querySelector("#mvScan").focus(); };
    });
    seg(); paintLines();
    var scan = box.querySelector("#mvScan");
    setTimeout(function () { scan.focus(); }, 80);
    scan.onkeydown = function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var v = scan.value.trim();
      if (!v) return;
      scan.value = "";
      V4.call("item.find", { barcode: App.digits(v) }).then(function (it) { return it || V4.call("item.find", { code: v }); }).then(function (it) {
        if (it) { addItem(it); return; }
        return V4.call("search", { q: v, limit: 5, channel: "scanmove" }).then(function (d) {
          if (d.items.length && (d.names === 1 || d.exact === 1)) addItem(d.items[0]);
          else App.toast(d.items.length ? "ما لقيناش «" + v + "» بالضبط: امسح الباركود أو اكتب الاسم كاملاً." : "لم يُعثر على «" + v + "».", "warn");
        });
      }).catch(function (er) { App.toast(er.message, "bad"); });
    };
    return m;
  }

  /* ---------- شجرة الأماكن ---------- */

  function tree() {
    loadPlaces().then(function () {
      var h = "";
      (function walk(p, depth) {
        var t = total(p);
        h += '<div class="row" style="gap:8px;padding:7px 0;border-top:1px solid var(--line);padding-inline-start:' + (depth * 22) + 'px">' +
          '<span class="badge">' + esc(KIND[p.kind] || p.kind) + "</span><b>" + esc(p.name) + "</b>" +
          (p.code ? '<span class="muted small num">' + esc(p.code) + "</span>" : "") +
          '<span class="muted small">' + t.items + " صنف · " + t.pieces + " قطعة</span><div class=\"spacer\"></div>" +
          (CHILD[p.kind] ? '<button class="btn sm" data-add="' + p.id + '">+ تحته</button>' : "") +
          (p.id !== 1 ? ' <button class="btn sm ghost" data-edit="' + p.id + '">تعديل</button> <button class="btn sm ghost" data-del="' + p.id + '">حذف</button>' : "") +
          "</div>";
        p.kids.forEach(function (k) { walk(k, depth + 1); });
      })(byId[1], 0);
      var m = App.modal({ title: "شجرة الأماكن", size: "wide", body: '<div id="ptree">' + h + "</div>" });
      var host = m.el.querySelector("#ptree");
      Array.prototype.forEach.call(host.querySelectorAll("[data-add]"), function (b) { b.onclick = function () { m.close(); addPlace(Number(b.getAttribute("data-add"))); }; });
      Array.prototype.forEach.call(host.querySelectorAll("[data-edit]"), function (b) { b.onclick = function () { m.close(); editPlace(Number(b.getAttribute("data-edit"))); }; });
      Array.prototype.forEach.call(host.querySelectorAll("[data-del]"), function (b) { b.onclick = function () { m.close(); delPlace(Number(b.getAttribute("data-del"))); }; });
    });
  }

  function addPlace(parentId, kind) {
    var parent = byId[parentId] || byId[1];
    var kinds = kind ? [kind] : (CHILD[parent.kind] || []);
    V4.form({
      title: kind === "store" ? "مخزن جديد" : "مكان جديد تحت «" + (parent.id === 1 ? "المحل" : parent.path) + "»", size: "narrow",
      values: { kind: kinds[0] },
      fields: [
        kinds.length > 1 ? { k: "kind", label: "النوع", type: "select", full: true, options: kinds.map(function (k) { return { v: k, t: KIND[k] }; }) } : null,
        { k: "name", label: "الاسم", required: true, full: true, placeholder: kind === "store" ? "مثلاً: مخزن الدور الأرضي" : "مثلاً: خزانة A" },
        { k: "code", label: "رمز قصير (يظهر على اللاصقة)", placeholder: "مثلاً: A أو 2" }
      ],
      onSave: function (v) {
        return V4.run("place.add", { parentId: parent.id, kind: kind || v.kind, name: v.name, code: v.code || "" }).then(function (r) {
          done(r, "مكان: " + v.name, "أُضيف: " + v.name);
        });
      }
    });
  }

  function editPlace(id) {
    var p = byId[id];
    if (!p) return;
    V4.form({
      title: "تعديل: " + p.name, size: "narrow",
      values: { name: p.name, code: p.code, phone: p.phone, address: p.address, note: p.note },
      fields: [
        { k: "name", label: "الاسم", required: true, full: true },
        { k: "code", label: "رمز قصير" },
        p.kind === "store" ? { k: "address", label: "العنوان", full: true } : null,
        p.kind === "store" ? { k: "phone", label: "الهاتف" } : null,
        { k: "note", label: "ملاحظة", full: true }
      ],
      onSave: function (v) {
        return V4.run("place.edit", { id: id, name: v.name, code: v.code || "", phone: v.phone || "", address: v.address || "", note: v.note || "" }).then(function (r) {
          done(r, "مكان: " + v.name, "حُفظ: " + v.name);
        });
      }
    });
  }

  function delPlace(id) {
    var p = byId[id];
    if (!p) return;
    App.confirm("يُحذف «" + p.path + "». لا يُحذف مكان فيه بضاعة أو تحته أماكن أو أصناف مسجّل مكانها فيه.", function () {
      V4.run("place.delete", { id: id }).then(function (r) { done(r, "حذف «" + p.name + "»", "حُذف: " + p.name); });
    }, { yes: "احذف", danger: true });
  }

  V4.page({ o: 44, g: "المخزون", k: "stock", t: "المخزون والأماكن", ic: "boxes", perm: "view_stock", render: page, after: after });

  return {
    open: open, back: back, search: search, more: more, move: move, adjust: adjust, scanMove: scanMove,
    tree: tree, addPlace: addPlace, editPlace: editPlace, delPlace: delPlace
  };
})();
