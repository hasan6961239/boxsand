/* ============================================================
   واجهة 4.0 — الجرد وإقفال اليوم
   ------------------------------------------------------------
   كما في 3.x: جرد المبيعات يومي/شهري/سنوي، تقسيم المقبوضات (ما دخل
   الصندوق فعلاً)، إقفال الصندوق لليوم، الأصناف المباعة، فواتير الفترة،
   والطباعة. الحساب كله في المحرك (أمر takings) بحساب 3.x نفسه، والنقد
   المفروض عند الإقفال يحسبه المحرك لحظتها.
   ============================================================ */
var V4Closing = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;
  var stk = { kind: "day", date: "" }, last = null;

  function range() {
    var d = stk.date || V4.today();
    if (stk.kind === "day") return { from: d, to: d, label: App.dateAr(d) };
    if (stk.kind === "month") { var m = d.slice(0, 7); return { from: m + "-01", to: m + "-31", label: "شهر " + m }; }
    var y = d.slice(0, 4);
    return { from: y + "-01-01", to: y + "-12-31", label: "سنة " + y };
  }

  function page() {
    if (!stk.date) stk.date = V4.today();
    var r = range();
    return '<div class="card" style="margin-bottom:18px"><div class="card-body row" style="flex-wrap:wrap;gap:12px">' +
      '<div class="seg" style="max-width:380px">' +
      ["day:يومي", "month:شهري", "year:سنوي"].map(function (x) {
        var k = x.split(":");
        return '<button class="' + (stk.kind === k[0] ? "on" : "") + '" onclick="V4Closing.set(\'kind\',\'' + k[0] + '\')">' + k[1] + "</button>";
      }).join("") + "</div>" +
      '<input type="date" class="inp" id="stkDate" style="width:170px" value="' + esc(stk.date) + '" onchange="V4Closing.set(\'date\',this.value)">' +
      '<div class="spacer"></div>' +
      '<b style="font-family:var(--font-head);font-size:20px">' + esc(r.label) + "</b>" +
      '<button class="btn" onclick="V4Closing.print()">طباعة الجرد</button></div></div>' +
      '<div id="stkBody"><div class="muted">…</div></div>';
  }

  function set(k, v) {
    stk[k] = v || stk[k];
    V4.refresh();
  }

  function stat(kind, lbl, val, foot) {
    return '<div class="card stat ' + kind + '"><div class="lbl">' + esc(lbl) + '</div><div class="val">' + val + "</div>" +
      (foot ? '<div class="foot">' + esc(foot) + "</div>" : "") + "</div>";
  }

  function after() {
    var r = range();
    Promise.all([
      V4.call("takings", { from: r.from, to: r.to }),
      V4.can("sell") ? V4.call("invoices.page", { from: r.from, to: r.to, limit: 100 }) : Promise.resolve(null)
    ]).then(function (res) {
      var t = res[0], inv = res[1];
      last = { t: t, r: r };
      var host = document.getElementById("stkBody");
      if (!host) return;
      var cost = t.profit !== undefined;
      var h = '<div class="grid g4" style="margin-bottom:18px">' +
        stat("accent", "إجمالي المبيعات", money(t.total), t.sales + " فاتورة · " + t.pieces + " قطعة") +
        (cost ? stat("blue", "صافي الربح", money(t.profit), "") : stat("blue", "عدد القطع", String(t.pieces), "")) +
        stat(t.returns ? "bad" : "accent", "الإرجاعات", money(Math.abs(t.returnsTotal)), t.returns + " عملية") +
        stat("accent", "مبيعات الجملة", money(t.wholesaleTotal), t.wholesale + " فاتورة جملة") + "</div>";

      /* تقسيم المقبوضات — قلب الجرد */
      var parts = [];
      if (t.debtPaid) parts.push("تسديد ديون " + money(t.debtPaid));
      if (t.upfront) parts.push("مقدّم آجل " + money(t.upfront));
      if (t.refundCredit) parts.push("رُدّ " + money(t.refundCredit));
      if (t.consOut) parts.push("دُفع لأصحاب المباع " + money(t.consOut));
      h += '<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>تقسيم المقبوضات</h3><div class="spacer"></div>' +
        '<span class="muted small">ما دخل فعلاً في هذه الفترة</span></div><div class="card-body"><div class="grid g3">' +
        '<div class="paybox cash"><div class="pb-t">نقداً في الصندوق</div><div class="pb-v num">' + money(t.cash) + "</div>" +
        '<div class="pb-s">' + t.cntCash + " فاتورة" + (parts.length ? " · " + esc(parts.join(" · ")) : "") + "</div></div>" +
        '<div class="paybox card"><div class="pb-t">البطاقة المصرفية</div><div class="pb-v num">' + money(t.card) + "</div>" +
        '<div class="pb-s">' + t.cntCard + " فاتورة</div></div>" +
        '<div class="paybox credit"><div class="pb-t">آجل (لم يُقبض)</div><div class="pb-v num">' + money(t.due) + "</div>" +
        '<div class="pb-s">من ' + money(t.creditTotal) + " مبيعات آجلة</div></div></div>" +
        '<div class="row" style="margin-top:16px;padding-top:14px;border-top:2px solid var(--ink)">' +
        '<div style="font-size:18px;font-weight:700">المقبوض فعلياً (نقد + بطاقة)</div><div class="spacer"></div>' +
        '<div class="num" style="font-size:24px;font-weight:700">' + money(t.cash + t.card) + "</div></div></div></div>";

      /* إقفال الصندوق — لليوم فقط */
      if (stk.kind === "day") {
        var c = t.closing;
        h += '<div class="card" id="closeCard" style="margin-bottom:18px"><div class="card-head"><h3>إقفال الصندوق</h3><div class="spacer"></div>' +
          (c ? '<span class="badge ok">أُقفل ' + esc(String(c.at).slice(11, 16)) + "</span>" : '<span class="badge warn">لم يُقفل بعد</span>') +
          '</div><div class="card-body"><p class="muted small" style="margin-top:0">عُدّ النقد في الدرج واكتبه هنا: يقارنه البرنامج بالمفروض ويقولك الفرق.</p>' +
          '<div class="row" style="gap:12px;flex-wrap:wrap;align-items:end">' +
          '<div class="field"><label>النقد المفروض</label><input class="inp num" disabled value="' + money(t.cash) + '"></div>' +
          '<div class="field"><label for="cashCount">النقد الفعلي في الدرج</label><input class="inp num" id="cashCount" data-num inputmode="decimal" value="' +
            (c ? money(c.counted) : "") + '"></div>' +
          '<div class="field" style="flex:1;min-width:200px"><label for="cashNote">ملاحظة</label><input class="inp" id="cashNote" value="' + esc(c ? c.note : "") + '"></div>' +
          (V4.can("closing") ? '<button class="btn primary lg" onclick="V4Closing.close()">' + (c ? "تحديث الإقفال" : "إقفال اليوم") + "</button>" : "") +
          "</div>" +
          (c ? '<div class="row" style="margin-top:12px"><span class="badge ' + (c.diff === 0 ? "ok" : "bad") + '">' +
            (c.diff === 0 ? "الصندوق مضبوط تماماً" : (c.diff < 0 ? "عجز " : "زيادة ") + money(Math.abs(c.diff))) + "</span>" +
            (c.expected !== t.cash ? '<span class="muted small">المفروض وقت الإقفال كان ' + money(c.expected) + "، وتغيّر بعده: حدّث الإقفال.</span>" : "") +
            "</div>" : "") + "</div></div>";
      }

      h += '<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>الأصناف المباعة</h3><div class="spacer"></div>' +
        '<span class="muted small">' + t.sold.length + " صنف · بعد خصم الإرجاعات</span></div>" +
        App.table([
          { h: "الصنف", c: function (x) { return '<b class="name">' + esc(x.name) + "</b>"; } },
          { h: "الكمية", cls: "num", c: function (x) { return "<b>" + x.qty + "</b>"; } },
          { h: "سعر البيع", cls: "num", c: function (x) { return money(x.price); } },
          { h: "إجمالي البيع", cls: "num", c: function (x) { return money(x.rev); } }
        ].concat(cost ? [{ h: "صافي الربح", cls: "num", c: function (x) {
          return '<b style="color:' + (x.profit >= 0 ? "var(--accent)" : "var(--stamp)") + '">' + money(x.profit) + "</b>"; } }] : []),
        t.sold, { emptyIcon: "box", emptyTitle: "لم يُبع شيء في هذه الفترة", emptyText: "" }) + "</div>";

      if (inv) {
        h += '<div class="card"><div class="card-head"><h3>فواتير الفترة</h3><div class="spacer"></div>' +
          '<span class="muted small">' + inv.total + " فاتورة" + (inv.total > inv.invoices.length ? " (آخر " + inv.invoices.length + ")" : "") + "</span></div>" +
          V4Home.table(inv.invoices, stk.kind === "day") + "</div>";
      }
      host.innerHTML = h;
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function close() {
    var el = document.getElementById("cashCount");
    if (!el || !String(el.value).trim()) { App.toast("اكتب النقد الموجود في الدرج.", "warn"); if (el) el.focus(); return; }
    var counted = V4.dirhams(el.value);
    var note = (document.getElementById("cashNote") || {}).value || "";
    V4.run("day.close", { date: stk.date, counted: counted, note: note }).then(function (r) {
      if (V4.queued(r, "إقفال اليوم")) return;
      if (r.diff === 0) App.toast("أُقفل اليوم — الصندوق مضبوط تماماً.", "ok");
      else App.toast("أُقفل اليوم — " + (r.diff < 0 ? "عجز " : "زيادة ") + money(Math.abs(r.diff)), "warn");
      after();
    });
  }

  function print() {
    if (!last) return;
    var t = last.t, m = (V4.shop() && V4.shop().meta) || {};
    var row = function (k, v) { return '<div class="tot"><span>' + esc(k) + '</span><span class="num">' + v + "</span></div>"; };
    var h = '<div class="receipt"><h2>' + esc(m.shopName || "المحل") + "</h2>" +
      '<div class="c">جرد ' + esc(last.r.label) + "</div><hr>" +
      row("فواتير البيع", String(t.sales)) + row("القطع", String(t.pieces)) + row("الإرجاعات", t.returns + " · " + money(Math.abs(t.returnsTotal))) +
      row("إجمالي المبيعات", money(t.total)) + (t.profit !== undefined ? row("صافي الربح", money(t.profit)) : "") + "<hr>" +
      row("نقداً في الصندوق", money(t.cash)) + row("البطاقة", money(t.card)) + row("آجل لم يُقبض", money(t.due)) +
      (t.debtPaid ? row("منه تسديد ديون", money(t.debtPaid)) : "") +
      '<div class="tot g"><span>المقبوض فعلياً</span><span class="num">' + money(t.cash + t.card) + "</span></div>" +
      (t.closing ? "<hr>" + row("النقد في الدرج", money(t.closing.counted)) + row("الفرق", money(t.closing.diff)) : "");
    if (t.sold.length) {
      h += '<hr><table><thead><tr><th>الصنف</th><th>كمية</th><th>إجمالي</th></tr></thead><tbody>' +
        t.sold.map(function (x) { return "<tr><td>" + esc(x.name) + '</td><td class="num">' + x.qty + '</td><td class="num">' + money(x.rev) + "</td></tr>"; }).join("") +
        "</tbody></table>";
    }
    App.printHtml(h + "</div>");
  }

  V4.page({ o: 35, g: "البيع", k: "stocktake", t: "الجرد وإقفال اليوم", ic: "stocktake", perm: "closing", render: page, after: after });

  return { set: set, close: close, print: print };
})();
