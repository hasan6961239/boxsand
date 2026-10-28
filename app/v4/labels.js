/* ============================================================
   واجهة 4.0 — طباعة اللاصقات
   ------------------------------------------------------------
   كما في 3.x (js/labels.js): اسم الصنف مختصراً فوق باركوده، والكتاب
   الذي عليه باركود الناشر (ISBN) لا يحتاج لاصقة. هندسة الباركود منقولة
   من 3.x كما هي (عرض العمود نقاطاً كاملة من نقاط الطابعة، EAN-13 لـ
   ISBN، والحدّ العملي 0.25 مم): هي ما يجعل اللاصقة تُقرأ بالقارئ الرخيص.
   الفرق: الأصناف صفحة صفحة من المحرك، والباركود المولَّد للصنف الذي لا
   باركود له يكتبه المحرك (labels.barcodes) فلا يتكرر رمز.
   ============================================================ */
var V4Labels = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;
  var sel = {};                     // id → { n, it }
  var view = { q: "", kind: "need", shown: 60 };
  var places = null, pending = null, seq = 0;

  function cfg() {
    var m = (V4.shop() && V4.shop().meta) || {};
    var L = m.label && typeof m.label === "object" ? m.label : {};
    return {
      w: App.num(L.w) || 30, h: App.num(L.h) || 25, maxChars: App.num(L.maxChars) || 18,
      showPrice: L.showPrice !== false, showLoc: L.showLoc !== false, prefix: L.prefix || "", dpi: App.num(L.dpi) || 203
    };
  }

  /* ---------- اختصار الاسم (3.x) ---------- */
  var TAIL = ["في", "من", "على", "الى", "إلى", "عن", "مع", "لـ", "ل", "و", "for", "of", "in", "the", "and", "to", "a", "an"];

  function shortName(name, maxChars) {
    var s = String(name || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    var max = App.num(maxChars) || 22;
    if (s.length <= max) return s;
    var words = s.split(" "), out = "";
    for (var i = 0; i < words.length; i++) {
      var next = out ? out + " " + words[i] : words[i];
      if (next.length > max) break;
      out = next;
    }
    if (!out) out = s.slice(0, max);
    var parts = out.split(" ");
    while (parts.length > 1 && TAIL.indexOf(parts[parts.length - 1]) >= 0) parts.pop();
    return parts.join(" ");
  }

  function hasPrinted(it) {
    var b = String(it.barcode || "").replace(/[\s-]/g, "");
    return /^(97[89]\d{10}|\d{13}|\d{10})$/.test(b);
  }
  function codeOf(it) { return String(it.barcode || "").trim() || String(it.code || "").trim(); }

  /* ---------- هندسة الباركود (منقولة من 3.x كما هي) ---------- */
  var MM_PX = 3.7795, PAD_MM = 1.2, SIDE_MM = 2.5, SAFE_MM = 0.25;
  function dpi() { return cfg().dpi; }
  function dotMm() { return 25.4 / dpi(); }
  function minDots() { return Math.ceil(SAFE_MM / dotMm()); }

  function isEan13(code) {
    var s2 = String(code || "").trim();
    if (!/^\d{13}$/.test(s2)) return false;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+s2[i]) * (i % 2 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === +s2[12];
  }

  var modCache = {};
  function measureModules(code, format) {
    var key = format + "|" + code;
    if (modCache[key] !== undefined) return modCache[key];
    var n = 0;
    if (typeof JsBarcode === "function") {
      var host = document.createElement("div");
      host.style.position = "absolute"; host.style.left = "-9999px";
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      host.appendChild(svg);
      document.body.appendChild(host);
      try {
        JsBarcode(svg, String(code), { format: format, flat: true, width: 10, height: 20, displayValue: false, margin: 0 });
        n = Math.round(parseFloat(svg.getAttribute("width")) / 10);
      } catch (e) { n = 0; }
      document.body.removeChild(host);
    }
    if (!n || !isFinite(n)) {
      var s2 = String(code || "");
      n = 11 + (/^\d+$/.test(s2) ? Math.ceil(s2.length / 2) : s2.length) * 11 + 11 + 13;
    }
    modCache[key] = n;
    return n;
  }
  function moduleCount(code) { var s2 = String(code || ""); return measureModules(s2, isEan13(s2) ? "EAN13" : "CODE128"); }

  function fit(code, widthMm) {
    var usable = Math.max(5, App.num(widthMm) - SIDE_MM * 2);
    var mods = moduleCount(code), dot = dotMm(), min = minDots();
    var dots = Math.max(1, Math.floor(usable / mods / dot));
    var mm = dots * dot;
    return { mm: mm, px: Math.max(0.5, mm * MM_PX), mods: mods, dots: dots, need: min * dot * mods + SIDE_MM * 2, safe: dots >= min };
  }

  function maxDigitsFor(widthMm) {
    var usable = Math.max(5, App.num(widthMm) - SIDE_MM * 2);
    var maxMods = Math.floor(usable / (minDots() * dotMm()));
    return Math.max(0, Math.floor((maxMods - 35) / 11) * 2);
  }

  function rowScale(L) { return L.h >= 22 ? 1 : Math.max(0.72, L.h / 22); }
  function namePt(L) { return (L.w < 36 ? 6.5 : 8) * rowScale(L); }
  function nameLineMm(L) { return namePt(L) * (96 / 72) * 1.1 / MM_PX; }
  function numPt(L) { return Math.max(5, Math.min(11, L.w * 0.33) * rowScale(L)); }
  function numLineMm(L) { return numPt(L) / MM_PX + 0.4; }
  function pricePt(L) { return 8.5 * rowScale(L); }
  function locPt(L) { return 6 * rowScale(L); }
  function footLineMm(L) { return pricePt(L) * (96 / 72) * 1.2 / MM_PX + 0.2; }

  function barHeightPx(L) {
    var used = PAD_MM * 2 + 0.6 + nameLineMm(L) + numLineMm(L);
    if (L.showPrice || L.showLoc) used += footLineMm(L);
    var mm = L.h - used;
    if (mm > 8) mm = Math.max(8, mm);
    return Math.max(12, Math.round(Math.max(3, mm) * MM_PX));
  }

  function svgFor(code, L) {
    var f = fit(code, L.w);
    var holder = document.createElement("div");
    holder.style.position = "absolute"; holder.style.left = "-9999px";
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    holder.appendChild(svg);
    document.body.appendChild(holder);
    var out = "";
    try {
      JsBarcode(svg, String(code), {
        format: isEan13(code) ? "EAN13" : "CODE128", flat: true, width: f.px, height: barHeightPx(L),
        displayValue: true, fontSize: numPt(L), textMargin: 0, margin: 0, marginLeft: 0, marginRight: 0
      });
      out = holder.innerHTML;
    } catch (e) { out = '<div style="font:9px monospace">تعذّر رسم الباركود</div>'; }
    document.body.removeChild(holder);
    return out;
  }

  function labelCss(L) {
    return "<style>@page { size: " + L.w + "mm " + L.h + "mm; margin: 0; }" +
      ".lbl-sheet{direction:rtl}" +
      ".lbl-one{width:" + L.w + "mm;height:" + L.h + "mm;box-sizing:border-box;padding:" + PAD_MM + "mm;display:flex;flex-direction:column;" +
      "align-items:center;justify-content:center;gap:0.3mm;overflow:hidden;page-break-after:always;break-after:page;font-family:Tahoma,Arial,sans-serif;background:#fff;color:#000}" +
      ".lbl-one:last-child{page-break-after:auto;break-after:auto}" +
      ".lbl-name{font-size:" + namePt(L).toFixed(2) + "pt;font-weight:700;line-height:1.1;text-align:center;max-height:" + nameLineMm(L) + "mm;overflow:hidden;" +
      "width:100%;white-space:nowrap;text-overflow:ellipsis}" +
      ".lbl-bc{width:100%;display:flex;justify-content:center;line-height:0}.lbl-bc svg{display:block}" +
      ".lbl-foot{width:100%;display:flex;align-items:baseline;justify-content:space-between;gap:1mm;margin-top:0.2mm}" +
      ".lf-loc{font-size:" + locPt(L).toFixed(2) + "pt;font-weight:700;white-space:nowrap}" +
      ".lf-price{font-size:" + pricePt(L).toFixed(2) + "pt;font-weight:700;white-space:nowrap}</style>";
  }

  /* المكان على اللاصقة قصير: «A·2» (الخزانة·الرف) كما كانت المكتبة·الرف في 3.x */
  function placeShort(id) {
    if (!places || !id || id === 1) return "";
    var byId = {};
    places.forEach(function (p) { byId[p.id] = p; });
    var p = byId[id];
    if (!p) return "";
    var me = p.code || p.name;
    var parent = byId[p.parentId];
    if (p.kind === "shelf" && parent && parent.kind !== "shop") return (parent.code || parent.name) + "·" + me;
    return me;
  }

  function labelHtml(it, L) {
    var loc = placeShort(it.homePlaceId), foot = "";
    if ((L.showLoc && loc) || L.showPrice) {
      foot = '<div class="lbl-foot">' + (L.showLoc && loc ? '<span class="lf-loc">' + esc(loc) + "</span>" : "<span></span>") +
        (L.showPrice ? '<span class="lf-price">' + money(it.price) + " " + esc(V4.currency()) + "</span>" : "") + "</div>";
    }
    return '<div class="lbl-one"><div class="lbl-name">' + esc(shortName(it.title, L.maxChars)) + "</div>" +
      '<div class="lbl-bc">' + svgFor(codeOf(it), L) + "</div>" + foot + "</div>";
  }

  /* ---------- الصفحة ---------- */

  function page() {
    return '<div class="card" style="margin-bottom:16px"><div class="card-body">' +
      '<p style="margin:0 0 8px;line-height:1.9">اختر الأصناف واطبع لاصقاتها دفعة واحدة. يُطبع <b>اسم الصنف مختصراً فوق الباركود</b> حتى لا تلصقها على كتاب آخر.</p>' +
      '<p class="muted small" style="margin:0;line-height:1.8">الكتب التي عليها باركود الناشر (ISBN) لا تحتاج لاصقة: امسح باركودها الموجود وسجّله في الصنف. ' +
      "والصنف الذي لا باركود له يُولَّد له رمز عند الطباعة ويُحفظ عليه، فيُمسح في البيع.</p></div></div>" +
      '<div class="toolbar">' +
      '<input class="inp search" id="lblQ" autocomplete="off" placeholder="ابحث عن صنف…" value="' + esc(view.q) + '" oninput="V4Labels.search(this.value)">' +
      '<div class="seg" style="max-width:420px">' + [["need", "لم تُطبع"], ["done", "طُبعت"], ["printed", "باركود الناشر"], ["all", "الكل"]].map(function (k) {
        return '<button data-k="' + k[0] + '" onclick="V4Labels.kind(\'' + k[0] + '\')">' + k[1] + "</button>";
      }).join("") + "</div></div>" +
      '<div class="toolbar" id="lblBar"></div>' +
      '<div class="card"><div id="lblBody"><div class="card-body muted">…</div></div></div>' +
      '<div class="pager" id="lblMore"></div>';
  }

  function after() {
    Array.prototype.forEach.call(document.querySelectorAll(".toolbar .seg button"), function (b) { b.classList.toggle("on", b.getAttribute("data-k") === view.kind); });
    (places ? Promise.resolve(places) : (V4.can("view_stock") ? V4.call("places.list") : Promise.resolve([]))).then(function (p) { places = p; }, function () { places = []; })
      .then(function () {
        if (!pending) { load(); return; }
        var want = pending;
        pending = null;
        return Promise.all(want.map(function (w) { return V4.call("item.get", { id: w.id }).catch(function () { return null; }); })).then(function (items) {
          sel = {};
          /* باركود الناشر يكفي: لا لاصقة له */
          items.forEach(function (it, i) { if (it && !hasPrinted(it)) sel[it.id] = { n: Math.max(1, want[i].n || 1), it: it }; });
          load();
          if (Object.keys(sel).length) preview();
          else App.toast("كل هذه الأصناف عليها باركود الناشر — لا تحتاج لاصقات.", "ok");
        });
      });
    var q = document.getElementById("lblQ");
    if (q && !pending) q.focus();
  }

  var list = [], lastD = null;

  function load() {
    var my = ++seq;
    var req = { label: view.kind === "all" ? "" : view.kind, limit: view.shown, offset: 0, sort: "new", channel: "labels" };
    if (view.q.trim()) req.q = view.q;
    V4.call("items.page", req).then(function (d) {
      if (my !== seq || d.cancelled) return;
      list = d.items;
      lastD = d;
      paint();
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function search(v) { view.q = v; view.shown = 60; load(); }
  function kind(k) { view.kind = k; view.shown = 60; V4.refresh(); }
  function more() { view.shown += 60; load(); }

  function total() { var n = 0; for (var k in sel) n += sel[k].n; return n; }

  function paintBar() {
    var bar = document.getElementById("lblBar");
    if (!bar) return;
    var chosen = Object.keys(sel).length;
    bar.innerHTML = (V4.can("settings") ? '<button class="btn" onclick="V4Labels.settings()">⚙ مقاس اللاصقة</button>' : "") +
      '<button class="btn" onclick="V4Labels.selectAll()">اختر المعروض</button>' +
      (chosen ? '<button class="btn ghost" onclick="V4Labels.clearSel()">إلغاء الاختيار</button>' +
        '<button class="btn" onclick="V4Labels.markDone()">علّم المحدد كمطبوع</button>' : "") +
      (view.kind === "need" && list.length ? '<button class="btn ghost" onclick="V4Labels.markAllShown()">علّم المعروض كمطبوع</button>' : "") +
      '<div class="spacer"></div>' +
      '<button class="btn primary" id="lblPrint" onclick="V4Labels.preview()"' + (chosen ? "" : " disabled") + ">معاينة وطباعة" +
      (chosen ? " · " + total() + " لاصقة" : "") + "</button>";
  }

  function paint() {
    var d = lastD;
    paintBar();
    var host = document.getElementById("lblBody");
    if (!host) return;
    var L = cfg();
    host.innerHTML = App.table([
      { h: "", c: function (it) { return '<input type="checkbox"' + (sel[it.id] ? " checked" : "") + ' onchange="V4Labels.toggle(' + it.id + ')">'; } },
      { h: "الصنف", c: function (it) {
        var sh = shortName(it.title, L.maxChars);
        return "<b>" + esc(it.title) + "</b>" + (sh !== it.title ? '<div class="muted small">على اللاصقة: ' + esc(sh) + "</div>" : ""); } },
      { h: "الكود", c: function (it) {
        return it.barcode ? '<span class="num small">' + esc(it.barcode) + "</span>" : '<span class="muted small">يُولَّد عند الطباعة</span>'; } },
      { h: "الحالة", c: function (it) {
        if (hasPrinted(it)) return '<span class="badge ok">باركود الناشر — لا تحتاج</span>';
        if (it.labelPrinted) return '<span class="badge ok">طُبعت ' + esc(it.labelPrinted) + '</span> <button class="btn sm ghost" title="أعِد العلامة إن لم تُلصق فعلاً" onclick="V4Labels.unmark(' + it.id + ')">↺</button>';
        return '<span class="badge bad">لم تُطبع</span> <button class="btn sm ghost" title="لاصقته ملصوقة من قبل — علّمها كمطبوعة" onclick="V4Labels.markOne(' + it.id + ')">✓</button>'; } },
      { h: "بالمحل", cls: "num", c: function (it) { return String(it.qty); } },
      { h: "عدد اللاصقات", c: function (it) {
        return '<input class="inp num" style="width:80px" inputmode="numeric" placeholder="0" value="' + (sel[it.id] ? sel[it.id].n : "") +
          '" onchange="V4Labels.count(' + it.id + ',this.value)">'; } }
    ], list, { emptyIcon: "books", emptyTitle: "لا أصناف", emptyText: view.kind === "need" ? "كل اللاصقات مطبوعة." : "غيّر الفلتر أو البحث." });
    var m = document.getElementById("lblMore");
    if (m) m.innerHTML = d && (d.more || d.total > list.length) ? '<button class="btn sm" onclick="V4Labels.more()">المزيد</button>' : "";
  }

  function byId(id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return sel[id] ? sel[id].it : null;
  }

  function toggle(id) {
    var it = byId(id);
    if (sel[id]) delete sel[id];
    else if (it) sel[id] = { n: Math.max(1, it.qty || 1), it: it };
    paint();
  }
  function count(id, v) {
    var n = Math.max(0, Math.round(App.num(v)));
    var it = byId(id);
    if (n <= 0) delete sel[id]; else if (it) sel[id] = { n: n, it: it };
    paint();
  }
  function selectAll() { list.forEach(function (it) { sel[it.id] = { n: Math.max(1, it.qty || 1), it: it }; }); paint(); }
  function clearSel() { sel = {}; paint(); }

  /* ---------- الباركود والعلامة ---------- */

  /* الصنف الذي خانة باركوده فارغة وحده يُولَّد له رمز؛ المسجَّل لا يُمسّ. false = أُرسل لجهاز المحل */
  function ensureBarcodes(items) {
    var need = items.filter(function (it) { return !String(it.barcode || "").trim(); });
    if (!need.length) return Promise.resolve(true);
    var L = cfg();
    return V4.run("labels.barcodes", { ids: need.map(function (it) { return it.id; }), maxDigits: maxDigitsFor(L.w), prefix: L.prefix }).then(function (r) {
      if (V4.queued(r, "باركود " + need.length + " صنف")) return false;
      r.forEach(function (x) {
        need.forEach(function (it) { if (it.id === x.id) it.barcode = x.barcode; });
        if (sel[x.id]) sel[x.id].it.barcode = x.barcode;
      });
      if (r.length) App.toast("وُلِّد باركود لـ" + r.length + " صنف كانت خانته فارغة.", "ok");
      return true;
    });
  }

  function printed(ids) { return V4.run("labels.printed", { ids: ids }); }

  function markDone(ids) {
    var items = ids ? ids.map(byId).filter(Boolean) : Object.keys(sel).map(function (k) { return sel[k].it; });
    if (!items.length) { App.toast("اختر أصنافاً أولاً.", "warn"); return; }
    ensureBarcodes(items).then(function (ok) {
      if (!ok) return;
      return printed(items.map(function (it) { return it.id; })).then(function (r) {
        if (V4.queued(r, "علامة اللاصقات")) return;
        items.forEach(function (it) { delete sel[it.id]; });
        App.toast("عُلِّم " + items.length + " صنفاً كمطبوع.", "ok");
        load();
      });
    });
  }
  function markOne(id) { markDone([id]); }
  function markAllShown() {
    var ids = list.filter(function (it) { return !hasPrinted(it) && !it.labelPrinted; }).map(function (it) { return it.id; });
    if (!ids.length) { App.toast("لا شيء لتعليمه.", "warn"); return; }
    App.confirm("يُعلَّم " + ids.length + " صنفاً كأن لاصقاته طُبعت، فتخرج من القائمة بلا طباعة. استعمله للكتب التي لصقت لاصقاتها من قبل.",
      function () { markDone(ids); }, { yes: "علّمها كمطبوعة" });
  }
  function unmark(id) {
    V4.run("labels.unprint", { ids: [id] }).then(function (r) {
      if (V4.queued(r, "إرجاع علامة اللاصقة")) return;
      App.toast("عادت العلامة — الصنف بانتظار طباعة لاصقته.", "ok");
      load();
    });
  }

  /* ---------- المعاينة والطباعة ---------- */

  function preview() {
    var ids = Object.keys(sel);
    if (!ids.length) { App.toast("اختر أصنافاً أولاً.", "warn"); return; }
    if (typeof JsBarcode !== "function") { App.toast("أداة رسم الباركود لم تُحمَّل.", "bad"); return; }
    ensureBarcodes(ids.map(function (k) { return sel[k].it; })).then(function (ok) {
      if (!ok) return;
      var L = cfg(), body = "", n = 0, worst = null, bad = 0;
      ids.forEach(function (k) {
        var it = sel[k].it;
        var f = fit(codeOf(it) || "12345678", L.w);
        if (!worst || f.need > worst.need) worst = f;
        if (!f.safe) bad++;
        for (var i = 0; i < sel[k].n; i++) { body += labelHtml(it, L); n++; }
      });
      if (!n) { App.toast("لا لاصقات للطباعة.", "warn"); return; }
      var css = labelCss(L);
      var warn = bad ? '<div style="background:var(--amber-wash);border:1px solid #EDDCB0;border-radius:9px;padding:12px 14px;margin-bottom:12px;line-height:1.85;font-size:13.5px">' +
        "<b>ستُطبع كلها بأرقامها كما هي،</b> لكن " + bad + " صنف عمود باركوده أدقّ من المريح للماسح. لو تعثّرت القراءة: تأكّد أولاً من «دقة طابعة اللاصقات» في " +
        "«مقاس اللاصقة»، ثم جرّب لاصقة عرضها " + Math.ceil(worst.need) + " مم فأكثر.</div>" : "";
      App.modal({
        title: "معاينة اللاصقات — " + n + " لاصقة", size: "wide",
        body: warn + '<p class="muted small" style="margin-top:0;line-height:1.8">كل لاصقة في صفحة مستقلة بمقاس ' + L.w + "×" + L.h + " مم" +
          (worst ? " · عرض العمود " + worst.mm.toFixed(3) + " مم (" + worst.dots + " نقطة على " + L.dpi + " dpi)" + (worst.safe ? " ✓" : "") : "") +
          ". قبل الطباعة: اختر طابعة اللاصقات، وأطفئ «رؤوس وتذييلات الصفحات».</p>" +
          css.replace("@page { size: " + L.w + "mm " + L.h + "mm; margin: 0; }", "") +
          '<div class="lbl-sheet" id="lblPreview" style="display:flex;flex-wrap:wrap;gap:6px;max-height:50vh;overflow:auto;background:var(--surface-2);padding:10px;border-radius:8px">' +
          body.replace(/page-break-after:always/g, "") + "</div>",
        actions: [{ label: "طباعة الآن", kind: "primary", click: function (close) {
          App.printHtml(css + '<div class="lbl-sheet">' + body + "</div>");
          close();
          printed(ids.map(Number)).then(function (r) {
            if (V4.queued(r, "علامة اللاصقات")) return;
            App.toast("طُبعت " + n + " لاصقة.", "ok");
            sel = {};
            if (V4.current() === "labels") load();
          });
        } }]
      });
    });
  }

  function settings() {
    var L = cfg();
    V4.form({
      title: "مقاس اللاصقة", size: "narrow",
      values: { w: L.w, h: L.h, dpi: String(L.dpi), maxChars: L.maxChars, showPrice: L.showPrice ? "1" : "", showLoc: L.showLoc ? "1" : "", prefix: L.prefix },
      fields: [
        { k: "w", label: "العرض (مم)", type: "number", min: 15, hint: "قِس لاصقتك بالمسطرة — هذا العرض يحدّ طول الباركود" },
        { k: "h", label: "الطول (مم)", type: "number", min: 10 },
        { k: "dpi", label: "دقة طابعة اللاصقات", type: "select", full: true,
          options: [{ v: "203", t: "203 نقطة/إنش — الأشيع" }, { v: "300", t: "300 نقطة/إنش" }, { v: "600", t: "600 نقطة/إنش" }],
          hint: "أهمّ إعداد لقراءة الباركود: مكتوب على ملصق الطابعة أو في مواصفاتها (203 dpi = 8 dots/mm، 300 dpi = 12 dots/mm)." },
        { k: "maxChars", label: "أقصى حروف للاسم", type: "number", min: 8, full: true },
        { k: "showLoc", label: "اطبع المكان", type: "select", options: [{ v: "1", t: "نعم" }, { v: "", t: "لا" }] },
        { k: "showPrice", label: "اطبع السعر", type: "select", options: [{ v: "1", t: "نعم" }, { v: "", t: "لا" }] },
        { k: "prefix", label: "بادئة الباركود المولَّد (أرقام فقط، اختيارية)", full: true, hint: "اتركها فارغة لأقصر رمز." }
      ],
      onSave: function (v) {
        return V4.run("settings.get", { key: "meta" }).then(function (m) {
          m = m || {};
          m.label = {
            w: Math.max(15, App.num(v.w)), h: Math.max(10, App.num(v.h)),
            dpi: [203, 300, 600].indexOf(App.num(v.dpi)) >= 0 ? App.num(v.dpi) : 203,
            maxChars: Math.max(8, App.num(v.maxChars)), showLoc: v.showLoc === "1", showPrice: v.showPrice === "1",
            prefix: String(v.prefix || "").replace(/[^0-9]/g, "").slice(0, 3)
          };
          return V4.run("setting.set", { key: "meta", value: m }).then(function (r) {
            if (V4.queued(r, "مقاس اللاصقة")) return;
            if (V4.shop() && V4.shop().meta) V4.shop().meta.label = m.label;
            modCache = {};
            App.toast("حُفظ مقاس اللاصقة.", "ok");
            load();
          });
        });
      }
    });
  }

  /* بعد إدخال بضاعة: لاصقات هذه الأصناف بكمياتها، والمعاينة مباشرة */
  function forItems(items) {
    pending = items;
    if (location.hash === "#/labels") V4.refresh(); else location.hash = "#/labels";
  }

  V4.page({ o: 48, g: "المخزون", k: "labels", t: "طباعة اللاصقات", ic: "tag", perm: "edit_items", render: page, after: after });

  return {
    search: search, kind: kind, more: more, toggle: toggle, count: count, selectAll: selectAll, clearSel: clearSel,
    markDone: markDone, markOne: markOne, markAllShown: markAllShown, unmark: unmark, preview: preview, settings: settings,
    forItems: forItems, shortName: shortName, fit: fit, isEan13: isEan13
  };
})();
