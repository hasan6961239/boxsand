/* ============================================================
   واجهة 4.0 — جرد المخزون الفعلي
   ------------------------------------------------------------
   كما في 3.x (js/count.js): تعدّ ما على الرفوف فعلاً وتقارنه بالمسجَّل.
   كل مسحة بالقارئ تزيد العدّاد واحداً، والمسجَّل يُحفظ لحظة العدّ (الجرد
   يطول والمحل يبيع)، و«الباقي مطابق» في النهاية، ثم «إنهاء وتصحيح المخزون».
   الأصناف صفحة صفحة من المحرك: النطاق قد يكون 20 ألف صنف.
   ============================================================ */
var V4Count = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;
  var setup = { scope: "all", value: "" }, view = { show: "all", q: "", offset: 0 };
  var sess = null, seq = 0, cats = null, places = null;

  var SCOPE = { all: "كل المخزون", books: "الكتب", stat: "القرطاسية", cat: "تصنيف", place: "مكان" };

  function page() { return '<div id="cnHost"><div class="muted">…</div></div>'; }

  function after() { load(true); }

  function load(focus) {
    var my = ++seq, req = { show: view.show, limit: 50, offset: view.offset };
    if (view.q.trim()) req.q = view.q;
    return V4.call("count.page", req).then(function (d) {
      if (my !== seq || (d && d.cancelled)) return;
      sess = d;
      if (!d) return paintSetup();
      paintActive(focus);
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  /* ---------- البدء ---------- */

  function paintSetup() {
    var host = document.getElementById("cnHost");
    if (!host) return;
    var jobs = [cats ? Promise.resolve(cats) : Promise.all([V4.call("categories.list", { kind: "book" }), V4.call("categories.list", { kind: "stat" })])
      .then(function (r) { cats = r[0].concat(r[1]); return cats; }, function () { cats = []; return cats; }),
      places ? Promise.resolve(places) : V4.call("places.list").then(function (l) { places = l; return l; }, function () { places = []; return []; })];
    Promise.all(jobs).then(function () {
      host.innerHTML = '<div class="card" style="max-width:640px;margin:0 auto 20px"><div class="card-body" style="padding:28px">' +
        '<h3 style="font-family:var(--font-head);margin:0 0 6px;font-size:21px">جرد المخزون الفعلي</h3>' +
        '<p class="muted" style="margin:0 0 20px;line-height:1.85">تعدّ ما على الرفوف فعلاً وتقارنه بالمسجّل في البرنامج. تمسح باركود كل نسخة ' +
        "فيزيد العدّاد، وفي النهاية يريك أين النقص وكم يساوي.</p>" +
        '<div class="field"><label for="cnScope">ماذا تجرد؟</label><select class="inp" id="cnScope" onchange="V4Count.set(\'scope\',this.value)">' +
        Object.keys(SCOPE).map(function (k) {
          return '<option value="' + k + '"' + (setup.scope === k ? " selected" : "") + ">" + (k === "cat" ? "تصنيف واحد" : k === "place" ? "مكان واحد (وما تحته)" : SCOPE[k] + (k === "all" ? "" : " فقط")) + "</option>";
        }).join("") + "</select></div>" +
        (setup.scope === "cat" ? '<div class="field" style="margin-top:12px"><label for="cnVal">التصنيف</label><select class="inp" id="cnVal" onchange="V4Count.set(\'value\',this.value)">' +
          cats.map(function (c) { var n = typeof c === "string" ? c : c.name; return '<option' + (setup.value === n ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("") + "</select></div>" : "") +
        (setup.scope === "place" ? '<div class="field" style="margin-top:12px"><label for="cnVal">المكان</label><select class="inp" id="cnVal" onchange="V4Count.set(\'value\',this.value)">' +
          places.filter(function (p) { return p.id !== 1; }).map(function (p) { return '<option value="' + p.id + '"' + (String(setup.value) === String(p.id) ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("") +
          "</select></div>" : "") +
        '<div class="row" style="margin-top:20px;align-items:center"><span class="badge info" id="cnN">…</span><div class="spacer"></div>' +
        '<button class="btn primary lg" onclick="V4Count.start()">ابدأ الجرد</button></div></div></div>' +
        '<div class="card"><div class="card-head"><h3>عمليات الجرد السابقة</h3></div><div id="cnPast"><div class="card-body muted">…</div></div></div>';
      var v = document.getElementById("cnVal");
      if (v && !setup.value) setup.value = v.value;
      preview();
      past();
    });
  }

  function set(k, v) { setup[k] = v; if (k === "scope") { setup.value = ""; paintSetup(); } else preview(); }

  /* كم صنفاً في النطاق قبل البدء */
  function preview() {
    var q = { limit: 1 };
    if (setup.scope === "books") q.kind = "book";
    if (setup.scope === "stat") q.kind = "stat";
    if (setup.scope === "cat") q.cat = setup.value;
    if (setup.scope === "place") q.placeId = Number(setup.value) || 0;
    V4.call("items.page", q).then(function (d) {
      var e = document.getElementById("cnN");
      if (e) e.textContent = d.total + " صنف في هذا النطاق";
    }).catch(function () { });
  }

  function start() {
    V4.run("count.start", { scope: setup.scope, value: String(setup.value || "") }).then(function (r) {
      if (V4.queued(r, "بدء الجرد")) return;
      App.toast("بدأ الجرد. امسح الباركود صنفاً صنفاً.", "ok");
      view = { show: "all", q: "", offset: 0 };
      load(true);
    });
  }

  function past() {
    V4.call("counts.page", {}).then(function (rows) {
      var host = document.getElementById("cnPast");
      if (!host) return;
      host.innerHTML = App.table([
        { h: "التاريخ", c: function (c) { return '<span class="num">' + esc(String(c.doneAt).slice(0, 16)) + "</span>"; } },
        { h: "النطاق", c: function (c) { return esc(SCOPE[c.scope] || c.scope) + (c.value ? " · " + esc(c.value) : ""); } },
        { h: "عُدّ", cls: "num", c: function (c) { return c.done + " / " + c.total; } },
        { h: "مطابق", cls: "num", c: function (c) { return '<span class="badge ok">' + c.ok + "</span>"; } },
        { h: "ناقص", cls: "num", c: function (c) { return c.less ? '<span class="badge bad">' + c.less + "</span>" : "—"; } },
        { h: "زائد", cls: "num", c: function (c) { return c.more ? '<span class="badge warn">' + c.more + "</span>" : "—"; } },
        { h: "قيمة النقص", cls: "num", c: function (c) { return c.lossVal !== undefined ? money(c.lossVal) : "—"; } },
        { h: "", c: function (c) { return '<button class="btn sm" onclick="V4Count.showPast(' + c.id + ')">التفاصيل</button>'; } }
      ], rows, { emptyIcon: "stocktake", emptyTitle: "لا جرد سابق", emptyText: "" });
    }).catch(function () { });
  }

  function showPast(id) {
    V4.run("count.get", { id: id }).then(function (lines) {
      App.modal({
        title: "فروق الجرد", size: "wide",
        body: App.table([
          { h: "الصنف", c: function (l) { return esc(l.name); } },
          { h: "المسجّل", cls: "num", c: function (l) { return String(l.rec); } },
          { h: "المعدود", cls: "num", c: function (l) { return String(l.got); } },
          { h: "الفرق", cls: "num", c: function (l) { return '<b style="color:' + (l.diff < 0 ? "var(--stamp)" : "#9a5b00") + '">' + (l.diff > 0 ? "+" : "") + l.diff + "</b>"; } }
        ], lines, { emptyIcon: "check", emptyTitle: "لا فروق", emptyText: "كان المخزون مطابقاً." }),
        actions: lines.length ? [{ label: "تصدير Excel", click: function () {
          App.xls("جرد-فعلي-" + V4.today(), "فروق الجرد الفعلي", [
            { h: "الصنف", c: function (l) { return l.name; } },
            { h: "المسجّل", t: "i", sum: true, c: function (l) { return l.rec; } },
            { h: "المعدود", t: "i", sum: true, c: function (l) { return l.got; } },
            { h: "الفرق", t: "i", sum: true, c: function (l) { return l.diff; } }
          ], lines, ((V4.shop() || {}).meta || {}).shopName || "");
        } }] : []
      });
    });
  }

  /* ---------- الجرد المفتوح ---------- */

  function stat(kind, lbl, val, foot) {
    return '<div class="card stat ' + kind + '"><div class="lbl">' + esc(lbl) + '</div><div class="val">' + val + "</div>" +
      (foot ? '<div class="foot">' + esc(foot) + "</div>" : "") + "</div>";
  }

  function paintActive(focus) {
    var host = document.getElementById("cnHost");
    if (!host) return;
    var s = sess, pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    if (!document.getElementById("cnScan")) {
      host.innerHTML = '<div class="card" style="margin-bottom:18px"><div class="card-body">' +
        '<div class="row" style="margin-bottom:14px;gap:8px;flex-wrap:wrap"><span class="badge info" id="cnScopeTag"></span>' +
        '<span class="muted small" id="cnStarted"></span><div class="spacer"></div>' +
        '<button class="btn ghost" onclick="V4Count.cancel()">إلغاء الجرد</button>' +
        '<button class="btn" onclick="V4Count.rest()">الباقي مطابق</button>' +
        '<button class="btn primary lg" onclick="V4Count.apply()">إنهاء وتصحيح المخزون</button></div>' +
        '<div style="position:relative"><input class="big-input" id="cnScan" style="width:100%" autocomplete="off" ' +
        'placeholder="امسح باركود النسخة… كل مسحة تزيد العدّاد واحداً" onkeydown="V4Count.scanKey(event)"><div id="cnNear"></div></div>' +
        '<div class="prog"><div class="prog-fill" id="cnProg"></div></div>' +
        '<div class="row small muted" style="margin-top:6px"><span id="cnDone"></span><div class="spacer"></div><span id="cnPct"></span></div></div></div>' +
        '<div class="grid g4" id="cnStats" style="margin-bottom:18px"></div>' +
        '<div class="card"><div class="card-head"><h3>الأصناف</h3><div class="spacer"></div>' +
        '<div class="seg" style="max-width:330px">' + [["all", "الكل"], ["left", "لم يُعدّ"], ["diff", "الفروق"]].map(function (k) {
          return '<button data-k="' + k[0] + '" onclick="V4Count.show(\'' + k[0] + '\')">' + k[1] + "</button>";
        }).join("") + "</div>" +
        '<input class="inp" style="max-width:260px" placeholder="ابحث…" value="' + esc(view.q) + '" oninput="V4Count.search(this.value)"></div>' +
        '<div id="cnRows"></div></div><div class="pager" id="cnPager"></div>';
    }
    document.getElementById("cnScopeTag").textContent = (SCOPE[s.scope] || s.scope) + (s.value ? " · " + s.value : "");
    document.getElementById("cnStarted").textContent = "بدأ " + String(s.startedAt).slice(11, 16);
    document.getElementById("cnProg").style.width = pct + "%";
    document.getElementById("cnDone").textContent = "عُدّ " + s.done + " من " + s.total + " صنفاً";
    document.getElementById("cnPct").textContent = pct + "%";
    document.getElementById("cnStats").innerHTML = stat("accent", "مطابق", String(s.ok), "العدد صحيح") +
      stat(s.less ? "bad" : "accent", "ناقص", String(s.less), s.lossQty ? s.lossQty + " قطعة مفقودة" + (s.lossVal !== undefined ? " · " + money(s.lossVal) : "") : "") +
      stat(s.more ? "warn" : "accent", "زائد", String(s.more), "أكثر من المسجّل") +
      stat("blue", "لم يُعدّ بعد", String(s.total - s.done), "");
    Array.prototype.forEach.call(document.querySelectorAll("#cnHost .seg button"), function (b) { b.classList.toggle("on", b.getAttribute("data-k") === view.show); });
    document.getElementById("cnRows").innerHTML = App.table([
      { h: "الصنف", c: function (x) { return '<b class="name">' + esc(x.title) + "</b>" + '<div class="muted small">' + esc(x.by || "") + (x.barcode ? ' · <span class="num">' + esc(x.barcode) + "</span>" : "") + "</div>"; } },
      { h: "المسجّل", cls: "num", c: function (x) { return String(x.rec); } },
      { h: "المعدود", c: function (x) {
        return '<input class="inp num" style="width:88px" inputmode="numeric" placeholder="—" value="' + (x.counted === null ? "" : x.counted) +
          '" onchange="V4Count.setCount(' + x.id + ',this.value)">'; } },
      { h: "الفرق", cls: "num", c: function (x) {
        if (x.counted === null) return '<span class="muted">لم يُعدّ</span>';
        if (!x.diff) return '<span class="badge ok">مطابق</span>';
        return '<span class="badge ' + (x.diff < 0 ? "bad" : "warn") + '">' + (x.diff > 0 ? "+" : "") + x.diff + "</span>"; } },
      { h: "", c: function (x) { return '<button class="btn sm" onclick="V4Count.bump(' + x.id + ',1)">+1</button> <button class="btn sm ghost" onclick="V4Count.bump(' + x.id + ',-1)">−1</button>'; } }
    ], s.items, { emptyIcon: "check", emptyTitle: view.show === "left" ? "عُدّ كل شيء" : view.show === "diff" ? "لا فروق" : "لا نتيجة", emptyText: "" });
    document.getElementById("cnPager").innerHTML = (view.offset > 0 ? '<button class="btn sm" onclick="V4Count.more(-50)">→ السابق</button>' : "") +
      (view.offset + 50 < s.shown ? '<button class="btn sm" onclick="V4Count.more(50)">التالي ←</button>' : "");
    if (focus) { var e = document.getElementById("cnScan"); if (e) e.focus(); }
  }

  function show(k) { view.show = k; view.offset = 0; load(false); }
  function search(v) { view.q = v; view.offset = 0; load(false); }
  function more(n) { view.offset = Math.max(0, view.offset + n); load(false); }

  function after2(r, msg) {
    if (V4.queued(r, msg)) return false;
    load(false);
    return true;
  }

  function bump(id, by) {
    V4.run("count.set", { sessionId: sess.id, itemId: id, add: by }).then(function (r) { after2(r, "الجرد"); });
  }

  function setCount(id, v) {
    var body = { sessionId: sess.id, itemId: id };
    if (String(v).trim() !== "") body.counted = Math.max(0, Math.round(App.num(v)));
    V4.run("count.set", body).then(function (r) { after2(r, "الجرد"); });
  }

  /* المسحة: الباركود أو الرمز، ثم الاسم المطابق وحده. القريب يُختار باليد: لا يُعدّ صنف تقريبي */
  function scanKey(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    var v = String(e.target.value || "").trim();
    if (!v) return;
    e.target.value = "";
    var near = document.getElementById("cnNear");
    if (near) near.innerHTML = "";
    V4.call("item.find", { barcode: App.digits(v) }).then(function (it) { return it || V4.call("item.find", { code: v }); }).then(function (it) {
      if (it) return hit(it);
      return V4.call("search", { q: v, limit: 5, channel: "count" }).then(function (d) {
        if (d.items.length && (d.names === 1 || d.exact === 1)) return hit(d.items[0]);
        if (!d.items.length) { App.toast("لا يوجد صنف بهذا الباركود: " + v, "bad"); return; }
        near.innerHTML = '<div class="suggest"><div class="s-head">ما لقيناش «' + esc(v) + "» بالضبط — هل تقصد؟</div>" + d.items.map(function (x) {
          return '<button class="s-item" data-id="' + x.id + '"><span class="t"><b>' + esc(x.title) + "</b></span></button>";
        }).join("") + "</div>";
        Array.prototype.forEach.call(near.querySelectorAll("[data-id]"), function (b) {
          b.onclick = function () {
            near.innerHTML = "";
            d.items.forEach(function (x) { if (String(x.id) === b.getAttribute("data-id")) hit(x); });
          };
        });
      });
    }).catch(function (er) { App.toast(er.message, "bad"); });
  }

  function hit(it) {
    return V4.call("count.set", { sessionId: sess.id, itemId: it.id, add: 1 }).then(function (n) {
      if (V4.queued(n, "الجرد")) return;
      App.toast(it.title + " → " + n, "ok");
      load(true);
    }, function (er) { App.toast(er.message, "bad"); });
  }

  function rest() {
    App.confirm("سيُعتبر كل صنف لم تعدّه مطابقاً للمسجّل. استعملها في النهاية لتسريع الجرد.", function () {
      V4.run("count.rest", { sessionId: sess.id }).then(function (r) {
        if (!after2(r, "الباقي مطابق")) return;
        App.toast("اعتُبر " + r + " صنفاً مطابقاً.", "ok");
      });
    }, { yes: "اعتبرها مطابقة" });
  }

  function cancel() {
    App.confirm("سيُلغى الجرد الحالي وتضيع الأعداد التي أدخلتها. متأكد؟", function () {
      V4.run("count.cancel", { sessionId: sess.id }).then(function (r) { if (!V4.queued(r, "إلغاء الجرد")) { App.toast("أُلغي الجرد.", "ok"); V4.refresh(); } });
    }, { yes: "إلغاء الجرد", danger: true });
  }

  function apply() {
    App.confirm("سيُصحَّح المخزون ليطابق ما عددته فعلاً (" + (sess.less + sess.more) + " صنف فيه فرق). ما بِيع بعد العدّ يبقى محسوباً، " +
      "والفروق تُسجَّل في سجل العمليات.", function () {
      V4.run("count.apply", { sessionId: sess.id }).then(function (r) {
        if (V4.queued(r, "تصحيح المخزون")) return;
        App.toast("صُحّح " + r.fixed + " صنفاً" + (r.lossQty ? " · نقص " + r.lossQty + " قطعة" : "") + ".", "ok");
        V4.refresh();
      });
    }, { yes: "صحّح المخزون" });
  }

  V4.page({ o: 49, g: "المخزون", k: "count", t: "جرد المخزون", ic: "stocktake", perm: "count", render: page, after: after });

  return {
    set: set, start: start, showPast: showPast, show: show, search: search, more: more,
    bump: bump, setCount: setCount, scanKey: scanKey, rest: rest, cancel: cancel, apply: apply
  };
})();
