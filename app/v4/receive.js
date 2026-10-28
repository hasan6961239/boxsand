/* ============================================================
   واجهة 4.0 — إدخال بضاعة
   ------------------------------------------------------------
   كما في 3.x: بضاعة وصلت لأصناف موجودة، للرفوف (مكان كل صنف) أو
   للمخزن، من مورد بتاريخ وملاحظة، بالمسح أو البحث. سعر الشراء الجديد
   يحلّ محل القديم (لمن يراه)، والإدخال أمر واحد (receive). وسجل
   الإدخالات السابقة بتفاصيلها، و«اطبع لاصقاتها» بعد الحفظ.
   الصنف الجديد كلياً يُضاف من «+ صنف جديد» (نموذج الكتب نفسه).
   ============================================================ */
var V4Receive = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;
  var draft = null, places = [], stores = [], suppliers = [], res = null, seq = 0, hi = -1;

  function fresh() { return { to: "shelf", storeId: 0, supplierId: "", date: V4.today(), note: "", lines: [] }; }
  function canCost() { return V4.can("view_cost"); }

  function page() {
    if (!draft) draft = fresh();
    return '<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>إدخال بضاعة وصلت</h3><div class="spacer"></div>' +
      '<span class="muted small">تُضاف الكميات للمخزون' + (canCost() ? " ويُحدَّث سعر الشراء" : "") + "</span>" +
      (V4.can("edit_items") ? '<button class="btn sm" style="margin-inline-start:10px" onclick="V4Receive.newItem()">+ صنف جديد</button>' : "") +
      '</div><div class="card-body">' +
      '<div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
      '<div class="seg" style="max-width:420px"><button id="rcToShelf" title="كل صنف إلى مكانه" onclick="V4Receive.to(\'shelf\')">للرفوف</button>' +
      '<button id="rcToStore" onclick="V4Receive.to(\'store\')">للمخزن</button></div>' +
      '<select class="inp" id="rcStore" style="width:200px" hidden onchange="V4Receive.store(this.value)"></select></div>' +
      '<div class="grid g3" style="margin-bottom:14px">' +
      '<div class="field"><label for="rcSup">المورد</label><select class="inp" id="rcSup" onchange="V4Receive.set(\'supplierId\',this.value)">' +
      '<option value="">— بدون مورد —</option></select></div>' +
      '<div class="field"><label for="rcDate">التاريخ</label><input type="date" class="inp" id="rcDate" value="' + esc(draft.date) +
      '" onchange="V4Receive.set(\'date\',this.value)"></div>' +
      '<div class="field"><label for="rcNote">ملاحظة / رقم فاتورة المورد</label><input class="inp" id="rcNote" value="' + esc(draft.note) +
      '" oninput="V4Receive.set(\'note\',this.value)"></div></div>' +
      '<div class="field" style="position:relative"><label for="rcQ">الصنف الذي وصلت منه كمية</label>' +
      '<input class="inp" id="rcQ" autocomplete="off" placeholder="امسح الباركود أو اكتب اسم الصنف…" ' +
      'oninput="V4Receive.suggest(this.value)" onkeydown="V4Receive.key(event)">' +
      '<div id="rcSug"></div></div>' +
      '<div id="rcLines" style="margin-top:14px"></div>' +
      '<div class="row" style="margin-top:14px;gap:10px"><div class="spacer"></div>' +
      (canCost() ? '<b style="font-size:17px">الإجمالي: <span class="num" id="rcTotal">0.00</span></b>' : "") +
      '<button class="btn" onclick="V4Receive.clear()">مسح</button>' +
      '<button class="btn primary lg" id="rcSave" onclick="V4Receive.save()">حفظ</button></div>' +
      "</div></div>" +
      '<div class="card"><div class="card-head"><h3>سجل الإدخالات السابقة</h3></div><div id="rcHist"><div class="card-body muted">…</div></div></div>';
  }

  function after() {
    var jobs = [
      V4.can("view_stock") ? V4.call("places.list").catch(function () { return []; }) : Promise.resolve([]),
      V4.call("suppliers.list").catch(function () { return []; })
    ];
    Promise.all(jobs).then(function (r) {
      places = r[0]; suppliers = r[1];
      stores = places.filter(function (p) { return p.kind === "store"; });
      if (!draft.storeId && stores.length) draft.storeId = stores[0].id;
      var sup = document.getElementById("rcSup");
      if (sup) sup.innerHTML = '<option value="">— بدون مورد —</option>' + suppliers.map(function (s) {
        return '<option value="' + s.id + '"' + (String(draft.supplierId) === String(s.id) ? " selected" : "") + ">" + esc(s.name) + "</option>";
      }).join("");
      paintTo();
      paint();
    });
    history();
    var q = document.getElementById("rcQ");
    if (q) q.focus();
  }

  function set(k, v) { draft[k] = v; }

  function to(k) {
    if (k === "store" && !stores.length) { App.toast("لا مخزن معرّف بعد. أضفه من صفحة المخزون والأماكن.", "warn"); return; }
    draft.to = k;
    paintTo();
    paint();
  }
  function store(id) { draft.storeId = Number(id); paint(); }

  function paintTo() {
    var a = document.getElementById("rcToShelf"), b = document.getElementById("rcToStore"), s = document.getElementById("rcStore");
    if (!a) return;
    a.classList.toggle("on", draft.to === "shelf");
    b.classList.toggle("on", draft.to === "store");
    s.hidden = draft.to !== "store" || stores.length < 2;
    s.innerHTML = stores.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === draft.storeId ? " selected" : "") + ">" + esc(p.name) + "</option>";
    }).join("");
    var save = document.getElementById("rcSave");
    if (save) save.textContent = draft.to === "store" ? "حفظ — للمخزن" : "حفظ — للرفوف";
  }

  /* ---------- البحث والإضافة ---------- */

  function suggest(q) {
    hi = -1;
    var my = ++seq;
    if (!q.trim()) { res = null; paintSug(); return; }
    V4.call("search", { q: q, limit: 8, channel: "receive" }).then(function (d) {
      if (my !== seq || d.cancelled) return;
      res = d; res.forQ = q;
      paintSug();
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function have(id) {
    for (var i = 0; i < draft.lines.length; i++) if (draft.lines[i].id === id) return draft.lines[i].qty;
    return 0;
  }

  function paintSug() {
    var host = document.getElementById("rcSug");
    if (!host) return;
    if (!res) { host.innerHTML = ""; return; }
    if (!res.items.length) { host.innerHTML = '<div class="suggest"><div class="s-head">لا يوجد صنف بهذا الاسم — أضفه من «+ صنف جديد»</div></div>'; return; }
    host.innerHTML = '<div class="suggest" id="rcSugBox">' + res.items.map(function (it, i) {
      var head = i === res.nearFrom ? '<div class="s-head">' + App.icon("search", 14) + " " +
        (i === 0 ? "ما لقيناش «" + esc(res.forQ) + "» بالضبط — هل تقصد؟" : "نتائج قريبة") + "</div>" : "";
      var got = have(it.id);
      return head + '<button class="s-item rich" onmousedown="event.preventDefault()" onclick="V4Receive.pick(' + i + ')">' +
        '<span class="t"><b>' + esc(it.title) + '</b><span class="meta2">' + (it.author || it.brand ? esc(it.author || it.brand) + " · " : "") +
        "الموجود " + it.qty + (canCost() && it.cost !== undefined ? " · شراء " + money(it.cost) : "") + "</span></span>" +
        (got ? '<span class="sp"><span class="badge ok">✓ مُضاف: ' + got + "</span></span>" : "") + "</button>";
    }).join("") + "</div>";
  }

  function key(e) {
    var box = document.getElementById("rcSugBox");
    var items = box ? box.querySelectorAll(".s-item") : [];
    if (e.key === "ArrowDown" && items.length) { e.preventDefault(); hi = Math.min(hi + 1, items.length - 1); mark(items); return; }
    if (e.key === "ArrowUp" && items.length) { e.preventDefault(); hi = Math.max(hi - 1, 0); mark(items); return; }
    if (e.key === "Escape") { e.target.value = ""; suggest(""); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    var v = e.target.value.trim();
    if (!v) return;
    if (hi >= 0 && res && res.items[hi]) { add(res.items[hi], true); return; }
    /* المسح بالقارئ: الباركود أو الرمز أولاً، ثم الاسم المطابق وحده */
    var looksCode = /\d/.test(App.digits(v)) && !/\s/.test(v);
    (looksCode ? V4.call("item.find", { barcode: App.digits(v) }).then(function (it) { return it || V4.call("item.find", { code: v }); }) : Promise.resolve(null))
      .then(function (it) {
        if (it) { add(it, true); return; }
        var ready = res && res.forQ === v ? Promise.resolve(res) : V4.call("search", { q: v, limit: 8, channel: "receive" });
        return ready.then(function (d) {
          res = d; res.forQ = v;
          if (d.items.length && (d.names === 1 || d.exact === 1)) { add(d.items[0], true); return; }
          paintSug();
          App.toast(d.items.length ? "اختر الصنف من القائمة." : "لم يُعثر على الصنف. أضفه من «+ صنف جديد».", "warn");
        });
      }).catch(function (er) { App.toast(er.message, "bad"); });
  }

  function mark(items) {
    Array.prototype.forEach.call(items, function (b, i) { b.classList.toggle("hi", i === hi); });
    if (items[hi]) items[hi].scrollIntoView({ block: "nearest" });
  }

  function pick(i) { if (res && res.items[i]) add(res.items[i], false); }

  /* الاختيار من القائمة يُبقي ما كُتب لتختار غيره، والمسح يفرّغ الخانة للمسحة التالية */
  function add(it, clear) {
    var ex = null;
    draft.lines.forEach(function (l) { if (l.id === it.id) ex = l; });
    if (ex) ex.qty++;
    else draft.lines.push({ id: it.id, name: it.title, qty: 1, cost: it.cost !== undefined ? it.cost : 0, have: it.qty, homePlaceId: it.homePlaceId });
    var q = document.getElementById("rcQ");
    if (q && clear) { q.value = ""; res = null; }
    paintSug();
    paint();
    if (q) q.focus();
  }

  function placeName(id) {
    for (var i = 0; i < places.length; i++) if (places[i].id === id) return places[i].name;
    return "";
  }

  function paint() {
    var host = document.getElementById("rcLines");
    if (!host || !draft) return;
    var total = 0;
    if (!draft.lines.length) {
      host.innerHTML = '<div class="empty" style="padding:22px"><p>لم تُضف أصناف بعد. امسح الباركود أو ابحث بالأعلى.</p></div>';
    } else {
      var cost = canCost();
      host.innerHTML = '<div class="table-wrap"><table class="tbl"><thead><tr><th>الصنف</th><th>الموجود</th><th>الكمية الواصلة</th>' +
        (cost ? "<th>سعر الشراء</th><th>الإجمالي</th>" : "") + "<th>يصير</th><th>إلى</th><th></th></tr></thead><tbody>" +
        draft.lines.map(function (l, i) {
          var sub = l.qty * l.cost;
          total += sub;
          return "<tr><td><b>" + esc(l.name) + '</b></td><td class="num">' + l.have + "</td>" +
            '<td><input class="inp num" style="width:88px" inputmode="numeric" value="' + l.qty + '" onchange="V4Receive.line(' + i + ',\'qty\',this.value)"></td>' +
            (cost ? '<td><input class="inp num" style="width:110px" data-num inputmode="decimal" value="' + money(l.cost) +
              '" onchange="V4Receive.line(' + i + ',\'cost\',this.value)"></td><td class="num"><b>' + money(sub) + "</b></td>" : "") +
            '<td class="num"><b style="color:var(--accent)">' + (draft.to === "store" ? l.have : l.have + l.qty) + "</b>" +
            (draft.to === "store" ? '<div class="muted small">في المحل، و' + l.qty + " للمخزن</div>" : "") + "</td>" +
            '<td class="small">' + esc(draft.to === "store" ? placeName(draft.storeId) : (placeName(l.homePlaceId) || "مكانه")) + "</td>" +
            '<td><button class="btn sm ghost" onclick="V4Receive.drop(' + i + ')">✕</button></td></tr>';
        }).join("") + "</tbody></table></div>";
    }
    var t = document.getElementById("rcTotal");
    if (t) t.textContent = money(total);
  }

  function line(i, k, v) {
    var l = draft.lines[i];
    if (!l) return;
    if (k === "qty") l.qty = Math.max(0, Math.round(App.num(v)));
    else l.cost = Math.max(0, V4.dirhams(v));
    paint();
  }
  function drop(i) { draft.lines.splice(i, 1); paint(); }
  function clear() { draft = fresh(); V4.refresh(); }

  function save() {
    var lines = draft.lines.filter(function (l) { return l.qty > 0; });
    if (!lines.length) { App.toast("أضف صنفاً واحداً على الأقل.", "warn"); return; }
    if (draft.to === "store" && !draft.storeId) { App.toast("اختر المخزن.", "warn"); return; }
    var body = {
      supplierId: Number(draft.supplierId) || 0, date: draft.date, note: draft.note,
      lines: lines.map(function (l) {
        return { itemId: l.id, qty: l.qty, cost: canCost() ? l.cost : 0, placeId: draft.to === "store" ? draft.storeId : 0 };
      })
    };
    var btn = document.getElementById("rcSave");
    if (btn) btn.disabled = true;
    V4.run("receive", body).then(function (r) {
      var done = lines.slice();
      draft = fresh();
      if (V4.queued(r, "إدخال بضاعة")) { V4.refresh(); return; }
      var pieces = done.reduce(function (s, l) { return s + l.qty; }, 0);
      App.toast("أُدخلت البضاعة: " + done.length + " صنف · " + pieces + " قطعة.", "ok");
      V4.refresh();
      if (V4.can("edit_items") && window.V4Labels) {
        App.modal({
          title: "أُدخلت البضاعة", size: "narrow",
          body: '<p style="margin:0;line-height:1.9">' + done.length + " صنف، " + pieces + " قطعة. تطبع لاصقاتها الآن؟</p>",
          actions: [{ label: "اطبع لاصقاتها", kind: "primary", click: function (close) {
            close();
            V4Labels.forItems(done.map(function (l) { return { id: l.id, n: l.qty }; }));
          } }],
          cancelLabel: "لا"
        });
      }
    }).catch(function () { }).then(function () {
      var b = document.getElementById("rcSave");
      if (b) b.disabled = false;
    });
  }

  /* صنف جديد كلياً: نموذج الكتب نفسه (بكميته ومكانه) */
  function newItem() { V4Items.edit(0); }

  /* ---------- السجل ---------- */

  function history() {
    V4.call("purchases.page", { limit: 30 }).then(function (rows) {
      var host = document.getElementById("rcHist");
      if (!host) return;
      var cost = rows.length && rows[0].total !== undefined;
      host.innerHTML = App.table([
        { h: "التاريخ", c: function (p) { return '<span class="num">' + esc(p.date) + "</span>"; } },
        { h: "المورد", c: function (p) { return p.supplier ? esc(p.supplier) : '<span class="muted">—</span>'; } },
        { h: "الأصناف", cls: "num", c: function (p) { return String(p.lines); } },
        { h: "القطع", cls: "num", c: function (p) { return String(p.pieces); } }
      ].concat(cost ? [{ h: "التكلفة", cls: "num", c: function (p) { return "<b>" + money(p.total) + "</b>"; } }] : []).concat([
        { h: "ملاحظة", c: function (p) { return esc(p.note || "—"); } },
        { h: "", c: function (p) { return '<button class="btn sm" onclick="V4Receive.show(' + p.id + ')">تفاصيل</button>'; } }
      ]), rows, { emptyIcon: "goods", emptyTitle: "لا إدخالات بعد", emptyText: "كل بضاعة تدخل المحل سجّلها هنا لتتبع التكاليف والموردين." });
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function show(id) {
    V4.run("purchase.get", { id: id }).then(function (p) {
      var cost = p.total !== undefined;
      App.modal({
        title: "إدخال بضاعة — " + p.date, size: "wide",
        body: '<div class="muted small" style="margin-bottom:12px">المورد: ' + esc(p.supplier || "—") + (p.note ? " · " + esc(p.note) : "") + "</div>" +
          App.table([
            { h: "الصنف", c: function (l) { return esc(l.name); } },
            { h: "الكمية", cls: "num", c: function (l) { return String(l.qty); } },
            { h: "إلى", c: function (l) { return esc(placeName(l.placeId)); } }
          ].concat(cost ? [
            { h: "سعر الشراء", cls: "num", c: function (l) { return money(l.cost); } },
            { h: "الإجمالي", cls: "num", c: function (l) { return money(l.qty * l.cost); } }
          ] : []), p.lines) +
          (cost ? '<div class="row" style="margin-top:12px;font-size:16px;font-weight:700"><div class="spacer"></div>الإجمالي: ' + money(p.total) + "</div>" : "")
      });
    });
  }

  V4.page({ o: 42, g: "المخزون", k: "receive", t: "إدخال بضاعة", ic: "goods", perm: "receive", render: page, after: after });

  return {
    set: set, to: to, store: store, suggest: suggest, key: key, pick: pick, line: line, drop: drop,
    clear: clear, save: save, newItem: newItem, show: show
  };
})();
