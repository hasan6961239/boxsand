/* ============================================================
   واجهة 4.0 — لوحة اليوم والفواتير والإيصال
   ============================================================ */
var V4Home = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;

  function stat(kind, lbl, val, foot, href) {
    return '<div class="card stat ' + kind + (href ? ' click" onclick="location.hash=\'' + href + '\'' : "") + '">' +
      '<div class="lbl">' + esc(lbl) + "</div>" +
      '<div class="val">' + val + "</div>" +
      (foot ? '<div class="foot">' + esc(foot) + "</div>" : "") + "</div>";
  }

  var METHOD = { cash: "نقداً", card: "بطاقة", credit: "آجل" };
  function methodName(m) { return METHOD[m] || m || ""; }

  /* ---------- لوحة اليوم ---------- */

  function dash() {
    return '<div id="dashStats" class="grid g4" style="margin-bottom:18px"></div>' +
      '<div class="card"><div class="card-head"><h3>آخر الفواتير</h3><div class="spacer"></div>' +
      '<button class="btn sm" onclick="location.hash=\'#/invoices\'">كل الفواتير</button></div>' +
      '<div class="card-body" id="dashInv"><div class="muted">…</div></div></div>';
  }

  function dashAfter() {
    var t = V4.today(), jobs = [];
    jobs.push(V4.can("reports") ? V4.call("report.range", { from: t, to: t }) : Promise.resolve(null));
    jobs.push(V4.can("view_stock") ? V4.call("alerts", { limit: 500 }) : Promise.resolve(null));
    jobs.push(V4.can("sell") ? V4.call("invoices.page", { from: t, to: t, limit: 8 }) : Promise.resolve(null));
    Promise.all(jobs).then(function (r) {
      var host = document.getElementById("dashStats");
      if (!host) return;
      var day = r[0] && r[0].days && r[0].days[0] ? r[0].days[0] : { sales: 0, net: 0, cash: 0, card: 0, credit: 0, profit: 0 };
      var h = "";
      if (r[0]) {
        h += stat("accent hero", "مبيعات اليوم", money(day.net), (day.sales || 0) + " فاتورة" + (day.returns ? " · " + day.returns + " إرجاع" : ""), "#/invoices");
        h += stat("blue", "نقداً في الصندوق", money(day.cash), "بطاقة " + money(day.card) + " · آجل " + money(day.credit),
          V4.can("closing") ? "#/stocktake" : "");
        if (V4.can("view_cost")) h += stat("accent", "ربح اليوم", money(day.profit || 0), "بعد سعر الشراء");
      } else if (r[2]) {
        h += stat("accent hero", "فواتير اليوم", String(r[2].total), "", "#/invoices");
      }
      if (r[1]) {
        var out = r[1].out.length, low = r[1].low.length;
        h += stat(out ? "bad" : low ? "warn" : "accent", "نفد أو قارب", String(out + low), out + " نفد · " + low + " قارب على النفاد");
      }
      host.innerHTML = h;
      var inv = document.getElementById("dashInv");
      if (inv) inv.innerHTML = r[2] ? invoiceTable(r[2].invoices, true) : '<div class="muted">لا تملك صلاحية الفواتير.</div>';
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  /* ---------- الفواتير ---------- */

  var filt = { from: "", to: "", no: "", offset: 0 };

  function invoiceTable(rows, compact) {
    return App.table([
      { h: "رقم", c: function (v) { return '<b class="num">' + v.no + "</b>"; } },
      { h: "الوقت", c: function (v) { return '<span class="num">' + esc(compact ? String(v.at).slice(11, 16) : v.at) + "</span>"; } },
      { h: "النوع", c: function (v) { return v.kind === "return" ? '<span class="badge warn">إرجاع</span>' : v.deletedAt ? '<span class="badge bad">محذوفة</span>' : "بيع"; } },
      { h: "الدفع", c: function (v) { return esc(methodName(v.method)) + (v.customer ? " · " + esc(v.customer) : ""); } },
      { h: "الأصناف", c: function (v) { return '<span class="num">' + v.lines + "</span>"; } },
      { h: "المبلغ", cls: "num", c: function (v) { return "<b>" + money(v.total) + "</b>"; } },
      { h: "", c: function (v) {
        return '<button class="btn sm" onclick="V4Home.open(' + v.id + ')">عرض</button>' +
          (!compact && v.kind === "sale" && !v.deletedAt && V4.can("returns") ? ' <button class="btn sm ghost" onclick="V4Home.ret(' + v.id + ')">إرجاع</button>' : ""); } }
    ], rows, { emptyIcon: "invoice", emptyTitle: "لا فواتير", emptyText: compact ? "أول بيعة اليوم تظهر هنا." : "لا فواتير في هذه الفترة." });
  }

  function invoices() {
    if (!filt.from) { filt.from = V4.today(); filt.to = V4.today(); }
    return '<div class="toolbar">' +
      '<label class="muted small">من</label><input class="inp" type="date" id="invFrom" value="' + esc(filt.from) + '" style="width:160px">' +
      '<label class="muted small">إلى</label><input class="inp" type="date" id="invTo" value="' + esc(filt.to) + '" style="width:160px">' +
      '<input class="inp" id="invNo" placeholder="رقم الفاتورة" inputmode="numeric" style="width:150px" value="' + esc(filt.no) + '">' +
      '<button class="btn" onclick="V4Home.applyInv()">عرض</button>' +
      '<div class="spacer"></div><span class="muted small" id="invTotal"></span></div>' +
      '<div class="card"><div class="card-body" id="invBody"><div class="muted">…</div></div></div>' +
      '<div class="pager" id="invPager"></div>';
  }

  function applyInv() {
    filt.from = document.getElementById("invFrom").value;
    filt.to = document.getElementById("invTo").value;
    filt.no = App.digits(document.getElementById("invNo").value).replace(/\D/g, "");
    filt.offset = 0;
    loadInv();
  }

  function loadInv() {
    var q = { limit: 50, offset: filt.offset };
    if (filt.no) q.no = Number(filt.no);
    else { q.from = filt.from; q.to = filt.to; }
    V4.run("invoices.page", q).then(function (d) {
      var body = document.getElementById("invBody");
      if (!body) return;
      body.innerHTML = invoiceTable(d.invoices, false);
      document.getElementById("invTotal").textContent = d.total + " فاتورة";
      var pg = document.getElementById("invPager");
      pg.innerHTML = (filt.offset > 0 ? '<button class="btn sm" onclick="V4Home.pageInv(-50)">→ السابق</button>' : "") +
        (filt.offset + 50 < d.total ? '<button class="btn sm" onclick="V4Home.pageInv(50)">التالي ←</button>' : "");
    });
  }

  function pageInv(n) { filt.offset = Math.max(0, filt.offset + n); loadInv(); }

  /* ---------- فاتورة واحدة والإيصال ---------- */

  function open(id) {
    V4.run("invoice.get", { id: id }).then(function (v) {
      var h = '<div class="kv" style="margin-bottom:14px">' +
        '<span class="k">الرقم</span><b class="num">' + v.no + "</b>" +
        '<span class="k">الوقت</span><span class="num">' + esc(v.at) + "</span>" +
        '<span class="k">الدفع</span><span>' + esc(methodName(v.method)) + (v.mode === "wholesale" ? " · جملة" : "") + "</span>" +
        (v.due ? '<span class="k">الدين</span><span class="num">' + money(v.due) + "</span>" : "") +
        (v.deletedAt ? '<span class="k">محذوفة</span><span>' + esc(v.deletedAt + " — " + (v.deleteReason || "")) + "</span>" : "") +
        (v.returnsList && v.returnsList.length ? '<span class="k">أُرجع منها</span><span>' + v.returnsList.map(function (x) {
          return '<a href="#" onclick="V4Home.open(' + x.id + ');return false" class="num">إرجاع ' + x.no + "</a> (" + money(Math.abs(x.total)) + ")";
        }).join("، ") + "</span>" : "") +
        "</div>" +
        App.table([
          { h: "الصنف", c: function (l) { return esc(l.name) + (l.returned ? ' <span class="badge warn">أُرجع ' + l.returned + "</span>" : ""); } },
          { h: "الكمية", cls: "num", c: function (l) { return String(Math.abs(l.qty)); } },
          { h: "السعر", cls: "num", c: function (l) { return money(l.price); } },
          { h: "الإجمالي", cls: "num", c: function (l) { return money(Math.abs(l.qty) * l.price); } }
        ], v.lines) +
        '<div class="kv" style="margin-top:14px;justify-content:end">' +
        (v.discount ? '<span class="k">الخصم</span><span class="num">' + money(Math.abs(v.discount)) + "</span>" : "") +
        '<span class="k">الصافي</span><b class="num">' + money(Math.abs(v.total)) + " " + esc(V4.currency()) + "</b>" +
        (v.profit !== undefined ? '<span class="k">الربح</span><span class="num">' + money(v.profit) + "</span>" : "") +
        "</div>";
      var actions = [{ label: "طباعة الإيصال", kind: "primary", click: function () { print(v); } }];
      if (returnable(v)) actions.push({ label: "إرجاع", click: function (close) { close(); startReturn(v); } });
      App.modal({ title: (v.kind === "return" ? "إرجاع" : "فاتورة") + " " + v.no, size: "wide", body: h, actions: actions });
    });
  }

  /* ---------- الإرجاع ----------
     كما في 3.x: من فاتورة بيع، بكمية من كل سطر لا تتجاوز ما بقي منه، ويُردّ
     ما دفعه الزبون فعلاً بعد خصم الفاتورة. الآجل يُنقص الدين أولاً وما زاد
     يُردّ نقداً — يحسبه المحرك (ShopDb.Return). */
  function left(v) {
    return v.lines.map(function (l) { return Math.max(Math.abs(l.qty) - (l.returned || 0), 0); });
  }

  function returnable(v) {
    return v.kind === "sale" && !v.deletedAt && V4.can("returns") && left(v).some(function (q) { return q > 0; });
  }

  function ret(id) {
    V4.run("invoice.get", { id: id }).then(function (v) {
      if (!returnable(v)) { App.toast(v.kind !== "sale" ? "هذه عملية إرجاع، لا يُرجع منها." : "أُرجع كل ما في هذه الفاتورة سابقاً.", "warn"); return; }
      startReturn(v);
    });
  }

  function startReturn(v) {
    var rest = left(v);
    var ratio = v.subtotal > 0 ? v.total / v.subtotal : 1;
    var box = document.createElement("div");
    box.innerHTML = '<p class="muted" style="margin-top:0">حدّد الكمية المُرجَعة من كل صنف. تُعاد للمخزون تلقائياً.</p>' +
      (ratio < 0.9999 ? '<p class="small" style="margin-top:0;color:#9a5b00">على هذه الفاتورة خصم: يُردّ للزبون ما دفعه فعلاً بعد الخصم.</p>' : "") +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>الصنف</th><th>المُباع</th><th>المتاح للإرجاع</th><th>الإرجاع</th><th>يُردّ للقطعة</th></tr></thead><tbody>' +
      v.lines.map(function (l, i) {
        return "<tr><td>" + esc(l.name) + '</td><td class="num">' + Math.abs(l.qty) + "</td>" +
          '<td class="num">' + rest[i] + (l.returned ? ' <span class="muted small">(أُرجع ' + l.returned + ")</span>" : "") + "</td>" +
          '<td><input class="inp num ret-q" data-i="' + i + '" style="width:82px" inputmode="numeric" value="0"' + (rest[i] ? "" : " disabled") + "></td>" +
          '<td class="num">' + money(Math.round(l.price * ratio)) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="row" style="margin-top:12px"><div class="spacer"></div><b>يُرجَع: <span class="num" id="retSum">0.00</span></b></div>';
    function sum() {
      var t = 0;
      Array.prototype.forEach.call(box.querySelectorAll(".ret-q"), function (inp) {
        var i = Number(inp.getAttribute("data-i"));
        var q = Math.min(Math.max(Math.round(App.num(inp.value)), 0), rest[i]);
        t += q * v.lines[i].price;
      });
      box.querySelector("#retSum").textContent = money(Math.round(t * ratio));
    }
    Array.prototype.forEach.call(box.querySelectorAll(".ret-q"), function (inp) { inp.oninput = sum; });
    var busy = false;
    App.modal({
      title: "إرجاع من الفاتورة رقم " + v.no, size: "wide", body: box, cancelLabel: "إلغاء",
      actions: [{ label: "تسجيل الإرجاع", kind: "danger", click: function (close) {
        if (busy) return;
        var lines = [];
        Array.prototype.forEach.call(box.querySelectorAll(".ret-q"), function (inp) {
          var i = Number(inp.getAttribute("data-i"));
          var q = Math.min(Math.round(App.num(inp.value)), rest[i]);
          if (q > 0) lines.push({ lineId: v.lines[i].id, qty: q });
        });
        if (!lines.length) { App.toast("لم تحدد أي كمية للإرجاع.", "warn"); return; }
        busy = true;
        V4.run("return", { invoiceId: v.id, lines: lines }).then(function (r) {
          close();
          if (V4.queued(r, "إرجاع من فاتورة " + v.no)) return;
          App.toast("سُجّل الإرجاع رقم " + r.no + " وأُعيدت الكميات للمخزون." +
            (r.debtCut ? " أُنقص من دين الزبون " + money(r.debtCut) + "." : "") +
            (r.cashBack ? " يُردّ نقداً " + money(r.cashBack) + "." : ""), "ok");
          V4.refresh();
        }, function () { busy = false; });
      } }]
    });
    var first = box.querySelector(".ret-q:not([disabled])");
    if (first) setTimeout(function () { first.focus(); first.select(); }, 80);
  }

  function receipt(v) {
    var m = (V4.shop() && V4.shop().meta) || {};
    var h = '<div class="receipt">' +
      "<h2>" + esc(m.shopName || "المكتبة والقرطاسية") + "</h2>" +
      (m.phone ? '<div class="c">' + esc(m.phone) + "</div>" : "") +
      "<hr>" +
      '<div style="display:flex;justify-content:space-between">' +
      "<span>" + (v.kind === "return" ? "إرجاع" : "فاتورة") + ' رقم <b class="num">' + v.no + "</b></span>" +
      '<span class="num">' + esc(v.at) + "</span></div>" +
      "<hr><table><thead><tr><th>الصنف</th><th>كمية</th><th>سعر</th><th>إجمالي</th></tr></thead><tbody>";
    v.lines.forEach(function (l) {
      h += "<tr><td>" + esc(l.name) + '</td><td class="num">' + Math.abs(l.qty) + '</td><td class="num">' + money(l.price) +
        '</td><td class="num">' + money(Math.abs(l.qty) * l.price) + "</td></tr>";
    });
    h += "</tbody></table><hr>" +
      '<div class="tot"><span>المجموع</span><span class="num">' + money(Math.abs(v.subtotal)) + "</span></div>" +
      (v.discount ? '<div class="tot"><span>الخصم</span><span class="num">' + money(Math.abs(v.discount)) + "</span></div>" : "") +
      '<div class="tot g"><span>الصافي</span><span class="num">' + money(Math.abs(v.total)) + " " + esc(V4.currency()) + "</span></div>" +
      '<div class="tot"><span>طريقة الدفع</span><span>' + esc(methodName(v.method)) + "</span></div>" +
      (v.due > 0 ? '<div class="tot"><span>المتبقي (دين)</span><span class="num">' + money(v.due) + "</span></div>" : "") +
      '<hr><div class="c">' + esc(m.footer || "شكراً لزيارتكم") + "</div></div>";
    return h;
  }

  function print(v) { App.printHtml(receipt(v)); }

  V4.page({ o: 10, g: "البيع", k: "dash", t: "لوحة اليوم", ic: "dash", render: dash, after: dashAfter });
  V4.page({ o: 30, g: "البيع", k: "invoices", t: "الفواتير", ic: "invoice", perm: "sell", render: invoices, after: loadInv });

  return { open: open, print: print, applyInv: applyInv, pageInv: pageInv, receipt: receipt, ret: ret, table: invoiceTable };
})();
