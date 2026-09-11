/* ============================================================
   sales.js — نقطة البيع، الفواتير، الإرجاعات، الإيصال
   ============================================================ */

var Sales = (function () {

  var cart = [];
  var discount = 0;
  var method = "cash";      // cash | card | credit
  var mode = "retail";      // retail | wholesale
  var customerId = "";
  var paid = 0;
  var hi = -1;              // مؤشر الاقتراحات
  /* المرشّح الافتراضي كان فارغاً — أي "كل الفواتير منذ البداية".
     بعد سنة صار ذلك 21,900 صفاً و481 ألف عنصر DOM جمّدت النافذة
     أكثر من دقيقة. الآن آخر 30 يوماً، وبترقيم صفحات. */
  var INV_PAGE = 200;
  var invF = { q: "", from: "", to: "", shown: INV_PAGE };

  function defaultInvFrom() {
    var d = new Date(); d.setDate(d.getDate() - 30);
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function S() { return App.S; }

  /* ============================================================
     نقطة البيع
     ============================================================ */

  function pos() {
    return '<div id="pos">' +
      '<div class="left">' +
      '<div class="scanbar">' +
      '<div class="seg mode-seg" style="margin-bottom:11px">' +
      '<button id="modeR" onclick="Sales.setMode(\'retail\')">قطاعي</button>' +
      '<button id="modeW" onclick="Sales.setMode(\'wholesale\')">جملة</button>' +
      "</div>" +
      '<input class="big-input" id="scan" autocomplete="off" spellcheck="false" ' +
      'placeholder="امسح الباركود أو اكتب اسم الصنف ثم Enter…" ' +
      'oninput="Sales.suggest(this.value)" onkeydown="Sales.scanKey(event)">' +
      '<div id="posResults"></div>' +
      "</div>" +
      '<div class="cart-area" id="cartArea"></div>' +
      "</div>" +

      '<div class="right">' +
      '<div class="totals" id="totals"></div>' +
      '<div class="pay-foot" id="payFoot"></div>' +
      "</div></div>";
  }

  function afterRender() {
    paint();
    focusScan();
  }

  function focusScan() {
    var s = document.getElementById("scan");
    if (s) setTimeout(function () { s.focus(); s.select(); }, 40);
  }

  /* ---------- البحث والإضافة ---------- */

  function suggest(q) {
    var host = document.getElementById("posResults");
    if (!host) return;
    hi = -1;
    var res = Inv.searchItems(q, 9);
    if (!res.length) { host.innerHTML = ""; return; }
    host.innerHTML = '<div class="suggest" id="sug">' + res.map(function (x, i) {
      var it = x.it, st = App.stockState(it);
      var pw = App.num(it.priceW) || App.num(it.price);
      return '<button class="s-item rich" data-i="' + i + '" onclick="Sales.add(\'' + x.type + '\',\'' + it.id + '\')">' +
        '<span class="t">' +
        "<b>" + App.esc(App.itemName(it)) + "</b>" +
        '<span class="meta2">' +
        (it.author || it.brand ? App.esc(it.author || it.brand) + " · " : "") +
        (x.type === "book" ? "كتاب" : "قرطاسية") +
        (it.barcode ? ' · <span class="num">' + App.esc(it.barcode) + "</span>" : "") +
        "</span>" +
        (it.note ? '<span class="note2">' + App.esc(String(it.note).slice(0, 70)) + "</span>" : "") +
        "</span>" +
        '<span class="sp">' +
        (x.type === "book" ? App.locChip(it) : '<span class="badge">' + App.esc(it.loc || "—") + "</span>") +
        '<span class="badge ' + (st === "out" ? "bad" : st === "low" ? "warn" : "ok") + '">المتوفر ' + App.num(it.qty) + "</span>" +
        "</span>" +
        '<span class="pr">' +
        '<span class="p1 num">' + App.money0(it.price) + "</span>" +
        '<span class="p2 num">جملة ' + App.money0(pw) + "</span>" +
        "</span></button>";
    }).join("") + "</div>";
  }

  function scanKey(e) {
    var box = document.getElementById("sug");
    var items = box ? box.querySelectorAll(".s-item") : [];

    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault(); hi = Math.min(hi + 1, items.length - 1); markHi(items); return;
    }
    if (e.key === "ArrowUp" && items.length) {
      e.preventDefault(); hi = Math.max(hi - 1, 0); markHi(items); return;
    }
    if (e.key === "Escape") { e.target.value = ""; suggest(""); return; }
    if (e.key !== "Enter") return;

    e.preventDefault();
    var v = e.target.value.trim();
    if (!v) { if (cart.length) complete(); return; }

    if (hi >= 0 && items[hi]) { items[hi].click(); return; }

    var hit = Inv.byBarcode(v);
    if (hit) { add(hit.type, hit.it.id); return; }

    var res = Inv.searchItems(v, 2);
    if (res.length === 1) { add(res[0].type, res[0].it.id); return; }
    if (!res.length) App.toast("لا يوجد صنف بهذا الاسم أو الباركود.", "warn");
  }

  function markHi(items) {
    items.forEach(function (b, i) { b.classList.toggle("hi", i === hi); });
    if (items[hi]) items[hi].scrollIntoView({ block: "nearest" });
  }

  function add(type, id) {
    var it = App.findItem(type, id);
    if (!it) return;
    var ex = null;
    cart.forEach(function (l) { if (l.type === type && l.id === id) ex = l; });
    if (ex) ex.qty++;
    else cart.push({
      type: type, id: id, name: App.itemName(it),
      price: App.sellPrice(it, mode), cost: App.num(it.cost), qty: 1
    });
    var s = document.getElementById("scan");
    if (s) { s.value = ""; }
    suggest("");
    paint();
    focusScan();
    if (App.num(it.qty) <= 0) App.toast("تنبيه: «" + App.itemName(it) + "» كميته صفر في المخزون.", "warn");
  }

  /* الوحدات التي تُباع بالكسور فعلاً — ما عداها كميات صحيحة.
     كان يمكن بيع "2.5 قلم" بلا أي اعتراض. */
  var FRACTIONAL = { "متر": 1, "كيلو": 1, "لتر": 1, "جرام": 1 };

  function allowsFraction(line) {
    var it = App.findItem(line.type, line.id);
    return !!(it && it.unit && FRACTIONAL[String(it.unit).trim()]);
  }

  function setQty(i, v) {
    if (!cart[i]) return;
    var q = App.num(v);
    if (!allowsFraction(cart[i])) q = Math.round(q);
    if (q <= 0) { cart.splice(i, 1); } else cart[i].qty = q;
    clampDiscount();
    paint();
  }
  function bump(i, d) { setQty(i, App.num(cart[i].qty) + d); }
  function delLine(i) { cart.splice(i, 1); paint(); }

  function clear() {
    if (!cart.length) return;
    App.confirm("سيتم إلغاء الفاتورة الحالية وكل أصنافها.", function () {
      cart = []; discount = 0; paid = 0; method = "cash"; customerId = "";
      paint(); focusScan();
    }, { danger: true, yes: "إلغاء الفاتورة" });
  }

  /* ---------- الحساب والرسم ---------- */

  function subtotal() { return cart.reduce(function (s, l) { return s + App.num(l.price) * App.num(l.qty); }, 0); }

  /* الخصم لا يتجاوز المجموع أبداً. سابقاً كان الصافي يُقصّ عند الصفر
     بينما الربح يطرح الخصم كاملاً — فخصم 500 على فاتورة 30 كان يسجّل
     ربحاً بـ‎−490‎ ويفسد تقارير اليوم والشهر والسنة. */
  function discountNow() { return Math.min(Math.max(App.num(discount), 0), subtotal()); }
  function clampDiscount() { discount = discountNow(); }
  function total() { return subtotal() - discountNow(); }
  function profit() {
    var gross = cart.reduce(function (s, l) {
      return s + (App.num(l.price) - App.num(l.cost)) * App.num(l.qty);
    }, 0);
    return gross - discountNow();
  }

  function paint() {
    var r = document.getElementById("modeR"), w = document.getElementById("modeW");
    if (r) r.className = (mode === "retail" ? "on" : "");
    if (w) w.className = (mode === "wholesale" ? "on" : "");
    paintCart();
    paintTotals();
    paintPay();
  }

  function paintCart() {
    var host = document.getElementById("cartArea");
    if (!host) return;
    if (!cart.length) { host.innerHTML = quickPicks(); return; }

    host.innerHTML = cart.map(function (l, i) {
      var it = App.findItem(l.type, l.id) || {};
      var left = App.num(it.qty) - App.num(l.qty);
      var pw = App.num(it.priceW) || App.num(it.price);
      return '<div class="cart-line">' +
        '<button class="x" title="حذف" onclick="Sales.del(' + i + ')">✕</button>' +
        '<div class="lp num">' + App.money0(App.num(l.price) * App.num(l.qty)) + "</div>" +
        '<div class="qty-box">' +
        '<button onclick="Sales.setQty(' + i + ',' + (App.num(l.qty) + 1) + ')">+</button>' +
        '<input class="num" type="number" min="1" value="' + App.num(l.qty) +
        '" onchange="Sales.setQty(' + i + ',this.value)">' +
        '<button onclick="Sales.setQty(' + i + ',' + (App.num(l.qty) - 1) + ')">−</button>' +
        "</div>" +
        '<div class="info">' +
        "<b>" + App.esc(l.name) + "</b>" +
        '<div class="ln-meta">' +
        (it.author || it.brand ? '<span>' + App.esc(it.author || it.brand) + "</span>" : "") +
        (l.type === "book" ? App.locChip(it) : (it.loc ? '<span class="badge">' + App.esc(it.loc) + "</span>" : "")) +
        (it.cat ? '<span class="badge">' + App.esc(it.cat) + "</span>" : "") +
        '<span class="badge ' + (left <= 0 ? "bad" : left <= App.num(it.min) ? "warn" : "ok") +
        '">يبقى ' + left + "</span>" +
        "</div>" +
        '<div class="ln-price">' +
        "قطاعي " + App.money0(it.price) + " · جملة " + App.money0(pw) +
        (it.barcode ? ' · <span class="num">' + App.esc(it.barcode) + "</span>" : "") +
        "</div>" +
        (it.note ? '<div class="ln-note">' + App.esc(String(it.note).slice(0, 90)) + "</div>" : "") +
        "</div></div>";
    }).join("");
  }

  function quickPicks() {
    var picked = (S().meta.quickPicks || []).map(function (k) {
      var p = String(k).split(":");
      var it = App.findItem(p[0], p[1]);
      return it ? { type: p[0], it: it } : null;
    }).filter(function (x) { return x; });

    var auto = false;
    if (!picked.length) {
      auto = true;
      var counts = {};
      S().invoices.forEach(function (inv) {
        if (inv.kind === "return") return;
        inv.items.forEach(function (l) {
          var k = l.type + ":" + l.id;
          counts[k] = (counts[k] || 0) + App.num(l.qty);
        });
      });
      picked = App.allItems().map(function (x) { return { x: x, n: counts[x.type + ":" + x.it.id] || 0 }; })
        .filter(function (r) { return r.n > 0; })
        .sort(function (a, b) { return b.n - a.n; })
        .slice(0, 12)
        .map(function (r) { return r.x; });
    }

    var head = '<div class="row" style="margin:2px 2px 12px">' +
      '<span class="muted small">' + (auto ? "الأكثر مبيعاً — اضغط للإضافة السريعة" : "الإضافة السريعة") + "</span>" +
      '<div class="spacer"></div>' +
      '<button class="btn sm" onclick="Sales.editQuick()">⚙ تخصيص</button></div>';

    if (!picked.length) {
      return '<div class="empty"><div class="big">▶</div><h4>الفاتورة فارغة</h4>' +
        "<p>امسح الباركود بالقارئ، أو اكتب اسم الصنف في الحقل بالأعلى.<br>" +
        "بعد إضافة الأصناف اضغط <b>Enter</b> على حقل فارغ لإتمام البيع.</p>" +
        '<button class="btn" onclick="Sales.editQuick()">⚙ تخصيص الإضافة السريعة</button></div>';
    }

    return head + '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">' +
      picked.map(function (r) {
        var it = r.it;
        return '<button class="card qp" onclick="Sales.add(\'' + r.type + '\',\'' + it.id + '\')">' +
          '<div class="qp-n">' + App.esc(App.itemName(it)) + "</div>" +
          '<div class="qp-p num">' + App.money0(it.price) + "</div>" +
          '<div class="muted small">المتوفر: ' + App.num(it.qty) +
          (r.type === "book" && it.lib ? " · " + App.esc(it.lib) + (it.shelf ? "/" + App.esc(it.shelf) : "") : "") +
          "</div></button>";
      }).join("") + "</div>";
  }

  /* اختيار أصناف الإضافة السريعة */
  var qSearch = "";

  function editQuick() {
    var box = document.createElement("div");
    box.innerHTML =
      '<p class="muted small" style="margin-top:0">اختر الأصناف التي تبيعها كثيراً لتظهر كأزرار في شاشة البيع. ' +
      "اتركها فارغة ليعرض البرنامج الأكثر مبيعاً تلقائياً.</p>" +
      '<input class="inp" id="qpSearch" placeholder="ابحث عن صنف…" oninput="Sales.qFilter(this.value)" style="margin-bottom:10px">' +
      '<div id="qpList" style="max-height:340px;overflow:auto"></div>';
    App.modal({
      title: "تخصيص الإضافة السريعة",
      size: "wide",
      body: box,
      cancelLabel: "إغلاق",
      actions: [{
        label: "حفظ", kind: "primary", click: function (close) {
          App.save(); close(); App.rerender();
          App.toast("حُفظت الإضافة السريعة (" + (S().meta.quickPicks || []).length + " صنف).");
        }
      }]
    });
    qSearch = "";
    setTimeout(paintQuick, 0);
  }

  function qFilter(v) { qSearch = v; paintQuick(); }

  function paintQuick() {
    var host = document.getElementById("qpList");
    if (!host) return;
    var nq = App.norm(qSearch);
    var picks = S().meta.quickPicks || [];
    var arr = App.allItems().filter(function (x) {
      if (!nq) return true;
      return App.norm(App.itemName(x.it) + " " + (x.it.barcode || "")).indexOf(nq) >= 0;
    }).slice(0, 120);

    host.innerHTML = '<div class="row" style="margin-bottom:8px">' +
      '<span class="badge ok">المختار: ' + picks.length + "</span>" +
      '<button class="btn sm ghost" onclick="Sales.qClear()">مسح الكل</button></div>' +
      arr.map(function (x) {
        var key = x.type + ":" + x.it.id;
        var on = picks.indexOf(key) >= 0;
        return '<label class="notif-row" style="cursor:pointer">' +
          '<input type="checkbox" ' + (on ? "checked" : "") + ' onchange="Sales.qToggle(\'' + key + '\',this.checked)">' +
          '<span class="nr-text"><b>' + App.esc(App.itemName(x.it)) + "</b>" +
          "<span>" + (x.type === "book" ? "كتاب" : "قرطاسية") + " · " + App.money0(x.it.price) +
          " · المتوفر " + App.num(x.it.qty) + "</span></span></label>";
      }).join("") || '<div class="empty"><p>لا نتيجة</p></div>';
  }

  function qToggle(key, on) {
    var picks = S().meta.quickPicks || [];
    var i = picks.indexOf(key);
    if (on && i < 0) picks.push(key);
    if (!on && i >= 0) picks.splice(i, 1);
    S().meta.quickPicks = picks;
    paintQuick();
  }

  function qClear() {
    S().meta.quickPicks = [];
    paintQuick();
  }

  function paintTotals() {
    var host = document.getElementById("totals");
    if (!host) return;
    var count = cart.reduce(function (s, l) { return s + App.num(l.qty); }, 0);
    host.innerHTML =
      '<div class="t-row"><span>عدد القطع</span><span class="num">' + count + "</span></div>" +
      '<div class="t-row"><span>المجموع</span><span class="num">' + App.money0(subtotal()) + "</span></div>" +
      '<div class="t-row"><span>الخصم</span>' +
      '<input class="inp num" style="width:104px;text-align:center;padding:4px 8px" type="number" min="0" step="0.25" value="' +
      App.num(discount) + '" onchange="Sales.setDiscount(this.value)"></div>' +
      '<div class="t-row grand"><span>الصافي</span><span class="num">' + App.money0(total()) + "</span></div>" +
      (App.canProfit() ? '<div class="t-row small muted"><span>ربح هذه الفاتورة</span><span class="num">' +
        App.money0(profit()) + "</span></div>" : "");
  }

  function paintPay() {
    var host = document.getElementById("payFoot");
    if (!host) return;
    var h = "";

    h += '<label class="row small" style="gap:6px;cursor:pointer;margin-bottom:10px">' +
      '<input type="checkbox" ' + (S().meta.autoPrint ? "checked" : "") +
      ' onchange="Sales.setAutoPrint(this.checked)"> طباعة الإيصال بعد إتمام البيع</label>';

    h += '<div class="row"><button class="btn danger" onclick="Sales.clear()">إلغاء</button>' +
      '<button class="btn primary lg spacer" onclick="Sales.complete()" ' + (cart.length ? "" : "disabled") + ">" +
      "إتمام البيع · " + App.money0(total()) + "</button></div>" +
      '<div class="muted small center" style="margin-top:8px">Enter على حقل فارغ = إتمام البيع</div>';
    host.innerHTML = h;
  }

  function setDiscount(v) {
    var want = App.num(v), cap = subtotal();
    discount = Math.min(Math.max(want, 0), cap);
    if (want > cap) App.toast("الخصم لا يتجاوز مجموع الفاتورة (" + App.money0(cap) + ").", "warn");
    paint();
  }
  function setMethod(m) { method = m; paint(); focusScan(); }

  function setMode(m) {
    mode = m;
    cart.forEach(function (l) {
      var it = App.findItem(l.type, l.id);
      if (it) l.price = App.sellPrice(it, mode);
    });
    paint(); focusScan();
    App.toast(mode === "wholesale" ? "أسعار الجملة" : "أسعار القطاعي");
  }
  function setCustomer(id) { customerId = id; paint(); }
  function setPaid(v) { paid = App.num(v); paintPay(); }
  function setAutoPrint(v) { S().meta.autoPrint = !!v; App.save(); }

  /* ---------- إتمام البيع ---------- */

  function complete() {
    if (!cart.length) { App.toast("الفاتورة فارغة.", "warn"); return; }
    if (method === "credit" && !customerId) { App.toast("اختر الزبون أولاً لتسجيل الدين.", "warn"); return; }

    var short = [];
    cart.forEach(function (l) {
      var it = App.findItem(l.type, l.id);
      if (it && App.num(l.qty) > App.num(it.qty)) short.push(l.name + " (المتوفر " + App.num(it.qty) + ")");
    });

    if (short.length) {
      App.confirm("الكمية المطلوبة أكبر من المخزون في:\n\n" + short.join("\n") +
        "\n\nهل تكمل البيع؟ سيصبح رصيد المخزون بالسالب.", askPayment, { yes: "أكمل البيع" });
    } else askPayment();
  }

  /* شاشة اختيار طريقة الدفع — تظهر بعد الضغط على إتمام البيع */
  function askPayment() {
    var t = total();
    var box = document.createElement("div");

    function payScreen() {
      box.innerHTML =
        '<div class="pay-amount">المطلوب <span class="num">' + App.money0(t) + "</span> " + App.esc(S().meta.currency || "") + "</div>" +
        '<div class="pay-choices">' +
        '<button class="pay-btn cash" onclick="Sales.pick(\'cash\')">' +
        App.icon("cash", 26) + '<span class="pb-l">نقداً</span></button>' +
        '<button class="pay-btn card" onclick="Sales.pick(\'card\')">' +
        App.icon("card", 26) + '<span class="pb-l">بطاقة</span></button>' +
        '<button class="pay-btn credit" onclick="Sales.pick(\'credit\')">' +
        App.icon("clock", 26) + '<span class="pb-l">آجل (دين)</span></button>' +
        "</div>" +
        '<div class="muted small center" style="margin-top:12px">اضغط 1 نقداً · 2 بطاقة · 3 آجل</div>';
    }

    function creditScreen() {
      box.innerHTML =
        '<div class="pay-amount">آجل — المطلوب <span class="num">' + App.money0(t) + "</span></div>" +
        '<div class="field" style="margin-bottom:12px"><label>الزبون</label>' +
        '<select class="inp" id="payCust"><option value="">— اختر الزبون —</option>' +
        S().customers.map(function (c) {
          return '<option value="' + c.id + '">' + App.esc(c.name) +
            (App.num(c.balance) ? " (عليه " + App.money0(c.balance) + ")" : "") + "</option>";
        }).join("") + "</select>" +
        '<button class="btn sm ghost" style="margin-top:6px" onclick="People.editCustomer(null,Sales.pickCust)">+ زبون جديد</button></div>' +
        '<div class="field"><label>المدفوع الآن (اختياري)</label>' +
        '<input class="inp num" id="payNow" type="number" min="0" step="0.25" value="0"></div>' +
        '<div class="row" style="margin-top:16px">' +
        '<button class="btn" onclick="Sales.backPay()">→ رجوع</button><div class="spacer"></div>' +
        '<button class="btn primary lg" onclick="Sales.confirmCredit()">تسجيل الدين وإتمام البيع</button></div>';
    }

    payModal = App.modal({
      title: "طريقة الدفع",
      size: "narrow",
      body: box,
      foot: false
    });
    payScreens = { pay: payScreen, credit: creditScreen };
    payScreen();

    payKeys = function (e) {
      if (!payModal) return;
      if (e.key === "1") { e.preventDefault(); pick("cash"); }
      else if (e.key === "2") { e.preventDefault(); pick("card"); }
      else if (e.key === "3") { e.preventDefault(); pick("credit"); }
    };
    document.addEventListener("keydown", payKeys);
  }

  var payModal = null, payScreens = null, payKeys = null;

  function closePay() {
    if (payKeys) { document.removeEventListener("keydown", payKeys); payKeys = null; }
    if (payModal) { payModal.close(); payModal = null; }
  }

  function pick(m) {
    if (m === "credit") {
      if (!S().customers.length) {
        App.toast("لا يوجد زبائن مسجّلون — أضف زبوناً أولاً.", "warn");
      }
      payScreens.credit();
      return;
    }
    method = m;
    customerId = "";
    paid = 0;
    closePay();
    finish();
  }

  function backPay() { payScreens.pay(); }

  function pickCust(id) {
    var sel = document.getElementById("payCust");
    if (sel) sel.value = id;
  }

  function confirmCredit() {
    var sel = document.getElementById("payCust");
    var amt = document.getElementById("payNow");
    if (!sel || !sel.value) { App.toast("اختر الزبون أولاً.", "warn"); return; }
    method = "credit";
    customerId = sel.value;
    paid = Math.max(App.num(amt ? amt.value : 0), 0);       // لا مدفوع سالب
    if (paid > total()) paid = total();                      // ولا أكثر من المطلوب
    closePay();
    finish();
  }

  function finish() {
    var t = total();
    var beforeQty = (typeof Notify !== "undefined") ? Notify.snapshotQty() : {};
    S().counters.invoice++;
    var inv = {
      id: App.uid(),
      no: S().counters.invoice,
      kind: "sale",
      date: App.today(),
      at: App.nowStamp(),
      items: cart.map(function (l) {
        return { type: l.type, id: l.id, name: l.name, qty: App.num(l.qty), price: App.num(l.price), cost: App.num(l.cost) };
      }),
      subtotal: subtotal(),
      discount: discountNow(),
      total: t,
      profit: profit(),
      method: method,
      mode: mode,
      customerId: method === "credit" ? customerId : "",
      paid: method === "credit" ? Math.min(App.num(paid), t) : t
    };
    inv.due = Math.max(t - inv.paid, 0);

    // خصم المخزون + تسجيل ما بِيع من الكتب على المباع
    inv.items.forEach(function (l) {
      var it = App.findItem(l.type, l.id);
      if (it) {
        it.qty = App.num(it.qty) - App.num(l.qty);
        it.updated = App.nowStamp();
        if (it.consId && typeof Consign !== "undefined") {
          try { Consign.recordSale(it.id, App.num(l.qty)); } catch (e) { }
        }
      }
    });

    if (inv.due > 0 && inv.customerId) {
      var c = People.customer(inv.customerId);
      if (c) c.balance = App.num(c.balance) + inv.due;
    }

    S().invoices.unshift(inv);
    App.log("بيع", "فاتورة " + inv.no + " بقيمة " + App.money0(t));
    if (typeof Notify !== "undefined") { try { Notify.afterSale(inv, beforeQty); } catch (e) { } }

    var doPrint = !!S().meta.autoPrint;
    cart = []; discount = 0; paid = 0; method = "cash"; customerId = "";
    App.saveNow();
    App.rerender();
    App.toast("تمت الفاتورة رقم " + inv.no + " — " + App.money0(t));

    if (doPrint) printInvoice(inv.id, true);
    focusScan();
  }

  /* ============================================================
     الفواتير
     ============================================================ */

  function invoices() {
    if (!invF.from && !invF.to && !invF.q) invF.from = defaultInvFrom();
    invF.shown = INV_PAGE;
    var h = '<div class="row" style="margin-bottom:14px">' +
      '<div class="search-wrap"><span class="mag">⌕</span>' +
      '<input class="inp" placeholder="ابحث برقم الفاتورة أو اسم الزبون أو الصنف…" value="' + App.esc(invF.q) + '" oninput="Sales.setInvF(\'q\',this.value)"></div>' +
      '<div class="field"><label class="small">من</label><input type="date" class="inp" value="' + invF.from + '" onchange="Sales.setInvF(\'from\',this.value)"></div>' +
      '<div class="field"><label class="small">إلى</label><input type="date" class="inp" value="' + invF.to + '" onchange="Sales.setInvF(\'to\',this.value)"></div>' +
      '<button class="btn ghost" onclick="Sales.allInvoices()">كل التواريخ</button>' +
      '<div class="spacer"></div>' +
      '<button class="btn" onclick="Sales.exportInvoices()">تصدير Excel</button></div>' +
      '<div class="card"><div id="invList"></div></div>';
    setTimeout(paintInvoices, 0);
    return h;
  }

  function filteredInvoices() {
    var nq = App.norm(invF.q);
    return S().invoices.filter(function (v) {
      if (invF.from && v.date < invF.from) return false;
      if (invF.to && v.date > invF.to) return false;
      if (nq) {
        var c = People.customer(v.customerId);
        var hay = App.norm(String(v.no) + " " + (c ? c.name : "") + " " +
          v.items.map(function (l) { return l.name; }).join(" "));
        if (hay.indexOf(nq) < 0) return false;
      }
      return true;
    });
  }

  function paintInvoices() {
    var host = document.getElementById("invList");
    if (!host) return;
    var rows = filteredInvoices();
    host.innerHTML = App.table([
      { h: "رقم", cls: "num", c: function (v) { return "<b>" + v.no + "</b>"; } },
      { h: "التاريخ", c: function (v) { return '<div>' + App.esc(v.date) + '</div><div class="sub">' + App.esc(String(v.at).slice(11)) + "</div>"; } },
      { h: "النوع", c: function (v) { return v.kind === "return" ? '<span class="badge bad">إرجاع</span>' : '<span class="badge ok">بيع</span>'; } },
      { h: "الأصناف", c: function (v) { return '<div class="sub">' + App.esc(v.items.map(function (l) { return l.name + "×" + l.qty; }).join("، ").slice(0, 70)) + "</div>"; } },
      {
        h: "الزبون", c: function (v) {
          var c = People.customer(v.customerId);
          return c ? App.esc(c.name) : '<span class="muted">نقدي</span>';
        }
      },
      { h: "الإجمالي", cls: "num", c: function (v) { return "<b>" + App.money0(v.total) + "</b>"; } },
      { h: "الدفع", c: function (v) { return payBadge(v); } },
      {
        h: "", cls: "act", c: function (v) {
          return '<button class="btn sm" onclick="Sales.showInvoice(\'' + v.id + '\')">عرض</button> ' +
            '<button class="btn sm ghost" onclick="Sales.printInvoice(\'' + v.id + '\')">طباعة</button>' +
            (v.kind === "sale" ? ' <button class="btn sm ghost" onclick="Sales.startReturn(\'' + v.id + '\')">إرجاع</button>' : "") +
            ' <button class="btn sm ghost" onclick="Sales.editInvoice(\'' + v.id + '\')">تعديل</button>' +
            ' <button class="btn sm ghost" onclick="Sales.deleteInvoice(\'' + v.id + '\')">حذف</button>';
        }
      }
    ].filter(function (c) { return c.h !== "الربح" || App.canProfit(); }), rows, {
      limit: invF.shown,
      moreAction: "Sales.moreInvoices()",
      emptyIcon: "▦", emptyTitle: "لا توجد فواتير", emptyText: "ستظهر هنا كل عمليات البيع تلقائياً."
    });
  }

  function payBadge(v) {
    if (v.kind === "return") return '<span class="badge">إرجاع</span>';
    if (App.num(v.due) > 0) return '<span class="badge warn">آجل · باقي ' + App.money0(v.due) + "</span>";
    if (v.method === "card") return '<span class="badge info">بطاقة</span>';
    return '<span class="badge ok">نقداً</span>';
  }

  function payName(m) {
    if (m === "card") return "بطاقة مصرفية";
    if (m === "credit") return "آجل";
    return "نقداً";
  }

  function setInvF(k, v) { invF[k] = v; invF.shown = INV_PAGE; paintInvoices(); }
  function allInvoices() { invF.from = ""; invF.to = ""; invF.shown = INV_PAGE; App.rerender(); }
  function moreInvoices() { invF.shown += INV_PAGE; paintInvoices(); }

  function getInvoice(id) {
    var r = null;
    S().invoices.forEach(function (v) { if (v.id === id) r = v; });
    return r;
  }

  function showInvoice(id) {
    var v = getInvoice(id);
    if (!v) return;
    var c = People.customer(v.customerId);
    App.modal({
      title: (v.kind === "return" ? "إرجاع رقم " : "فاتورة رقم ") + v.no,
      size: "wide",
      body: '<div class="row small muted" style="margin-bottom:12px">' +
        App.esc(v.at) + " · " + (c ? "الزبون: " + App.esc(c.name) : "بيع نقدي") + "</div>" +
        App.table([
          { h: "الصنف", c: function (l) { return App.esc(l.name); } },
          { h: "الكمية", cls: "num", c: function (l) { return App.num(l.qty); } },
          { h: "السعر", cls: "num", c: function (l) { return App.money0(l.price); } },
          { h: "الإجمالي", cls: "num", c: function (l) { return App.money0(App.num(l.price) * App.num(l.qty)); } }
        ], v.items) +
        '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">' +
        '<div class="t-row" style="display:flex;justify-content:space-between"><span>المجموع</span><span class="num">' + App.money0(v.subtotal) + "</span></div>" +
        (App.num(v.discount) ? '<div style="display:flex;justify-content:space-between"><span>الخصم</span><span class="num">' + App.money0(v.discount) + "</span></div>" : "") +
        '<div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;margin-top:6px"><span>الصافي</span><span class="num">' + App.money0(v.total) + "</span></div>" +
        (App.num(v.due) > 0 ? '<div style="display:flex;justify-content:space-between;color:var(--stamp)"><span>المتبقي ديناً</span><span class="num">' + App.money0(v.due) + "</span></div>" : "") +
        "</div>",
      actions: [
        { label: "طباعة", kind: "primary", click: function () { printInvoice(id); } },
        { label: "تعديل", click: function (close) { close(); editInvoice(id); } },
        (v.kind === "sale" ? { label: "إرجاع", click: function (close) { close(); startReturn(id); } } : null),
        { label: "حذف الفاتورة", kind: "danger", click: function (close) { close(); deleteInvoice(id); } }
      ].filter(function (x) { return x; })
    });
  }

  /* ---------- حذف الفاتورة ---------- */

  /* يعيد أثر الفاتورة على المخزون والديون. sign=-1 للتراجع */
  function unapply(v, restock) {
    if (restock) {
      var dir = (v.kind === "return") ? -1 : 1;   // البيع يُعاد للمخزون، الإرجاع يُخصم
      v.items.forEach(function (l) {
        var it = App.findItem(l.type, l.id);
        if (!it) return;
        it.qty = App.num(it.qty) + dir * App.num(l.qty);
        it.updated = App.nowStamp();
        if (it.consId && typeof Consign !== "undefined") {
          try {
            if (dir > 0) Consign.recordReturn(it.id, App.num(l.qty));
            else Consign.recordSale(it.id, App.num(l.qty));
          } catch (e) { }
        }
      });
    }
    if (v.customerId) {
      var c = People.customer(v.customerId);
      if (c) {
        if (v.kind === "return") c.balance = App.num(c.balance) + Math.abs(App.num(v.total));
        else if (App.num(v.due) > 0) c.balance = Math.max(App.num(c.balance) - App.num(v.due), 0);
      }
    }
  }

  function deleteInvoice(id) {
    var v = getInvoice(id);
    if (!v) return;

    var linked = S().invoices.filter(function (x) { return x.kind === "return" && x.refNo === v.no; });
    var warn = linked.length
      ? '<div class="row" style="margin-bottom:12px;padding:10px 12px;background:var(--amber-wash);border-radius:var(--r)">' +
        "على هذه الفاتورة " + linked.length + " إرجاع مسجّل. احذفه أولاً إن أردت إلغاء كل شيء.</div>"
      : "";

    var body = document.createElement("div");
    body.innerHTML = warn +
      '<p style="margin-top:0;line-height:1.8">ستُحذف ' + (v.kind === "return" ? "عملية الإرجاع" : "الفاتورة") +
      " رقم <b>" + v.no + "</b> بقيمة <b>" + App.money(Math.abs(v.total)) + "</b> نهائياً.</p>" +
      '<div class="field"><label>ماذا نفعل بالأصناف؟</label>' +
      '<select class="inp" id="delRestock">' +
      '<option value="yes">' + (v.kind === "return" ? "أخصمها من المخزون (لم تعد فعلاً)" : "أرجعها للمخزون (الزبون أعادها)") + "</option>" +
      '<option value="no">' + (v.kind === "return" ? "اترك المخزون كما هو" : "اترك المخزون كما هو (لم تعد)") + "</option>" +
      "</select>" +
      '<div class="hint">مثال: بِعت 5 نسخ وبقي 4 — «أرجعها» تعيدها إلى 5، و«اترك» تُبقيها 4.</div></div>' +
      '<div class="field" style="margin-top:12px"><label>سبب الحذف (اختياري)</label>' +
      '<input class="inp" id="delWhy" placeholder="مثال: أعطيت الزبون كتاباً خطأ"></div>';

    App.modal({
      title: "حذف فاتورة رقم " + v.no,
      body: body,
      cancelLabel: "تراجع",
      actions: [{
        label: "تأكيد الحذف", kind: "danger", click: function (close, ov) {
          var restock = ov.querySelector("#delRestock").value === "yes";
          var why = ov.querySelector("#delWhy").value || "";
          unapply(v, restock);
          var i = S().invoices.indexOf(v);
          if (i >= 0) S().invoices.splice(i, 1);
          App.log("حذف فاتورة", "رقم " + v.no + " بقيمة " + App.money0(v.total) +
            (restock ? " — أُعيدت الأصناف" : " — بلا إرجاع") + (why ? " — " + why : ""));
          App.saveNow(); close(); App.rerender();
          App.toast("حُذفت الفاتورة رقم " + v.no + (restock ? " وأُعيدت الأصناف للمخزون." : "."));
        }
      }]
    });
  }

  /* ---------- تعديل الفاتورة ---------- */

  var ed = null;

  function editInvoice(id) {
    var v = getInvoice(id);
    if (!v) return;
    ed = {
      id: id,
      lines: v.items.map(function (l) {
        return {
          type: l.type, id: l.id, name: l.name,
          qty: App.num(l.qty), orig: App.num(l.qty),
          price: App.num(l.price), cost: App.num(l.cost), added: false
        };
      }),
      discount: App.num(v.discount),
      method: v.method,
      customerId: v.customerId || "",
      paid: App.num(v.paid),
      restock: "yes"
    };

    var body = document.createElement("div");
    body.innerHTML =
      '<div class="field" style="position:relative;margin-bottom:12px">' +
      '<label>إضافة صنف للفاتورة</label>' +
      '<input class="inp" id="edSearch" placeholder="اكتب اسم الصنف أو امسح الباركود…" autocomplete="off" ' +
      'oninput="Sales.edSuggest(this.value)" onkeydown="Sales.edKey(event)">' +
      '<div id="edSug"></div></div>' +
      '<div id="edLines"></div>' +
      '<div id="edFoot" style="margin-top:14px"></div>';

    App.modal({
      title: "تعديل فاتورة رقم " + v.no,
      size: "wide",
      body: body,
      cancelLabel: "إلغاء",
      actions: [{
        label: "حفظ التعديل", kind: "primary", click: function (close, ov) {
          if (saveEdit(ov)) close();
        }
      }]
    });
    setTimeout(paintEdit, 0);
  }

  function paintEdit() {
    var host = document.getElementById("edLines");
    if (!host || !ed) return;

    var sub = 0;
    var h = '<table class="tbl"><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th>المخزون الآن</th><th></th></tr></thead><tbody>';
    ed.lines.forEach(function (l, i) {
      var t = App.num(l.qty) * App.num(l.price);
      sub += t;
      var it = App.findItem(l.type, l.id);
      h += "<tr><td>" + App.esc(l.name) + (l.added ? ' <span class="badge info">جديد</span>' : "") + "</td>" +
        '<td><input class="inp num" style="width:86px" type="number" min="0" value="' + App.num(l.qty) +
        '" onchange="Sales.edSet(' + i + ',\'qty\',this.value)"></td>' +
        '<td><input class="inp num" style="width:104px" type="number" step="0.25" min="0" value="' + App.num(l.price) +
        '" onchange="Sales.edSet(' + i + ',\'price\',this.value)"></td>' +
        '<td class="num"><b>' + App.money0(t) + "</b></td>" +
        '<td class="num">' + (it ? App.num(it.qty) : '<span class="muted">—</span>') + "</td>" +
        '<td class="act"><button class="btn sm ghost" onclick="Sales.edDel(' + i + ')">✕</button></td></tr>';
    });
    h += "</tbody></table>";
    host.innerHTML = h;

    var total = Math.max(sub - App.num(ed.discount), 0);
    var foot = document.getElementById("edFoot");
    if (!foot) return;
    foot.innerHTML =
      '<div class="grid g3">' +
      '<div class="field"><label>الخصم</label><input class="inp num" type="number" min="0" step="0.25" value="' +
      App.num(ed.discount) + '" onchange="Sales.edSet(-1,\'discount\',this.value)"></div>' +
      '<div class="field"><label>طريقة الدفع</label><select class="inp" onchange="Sales.edSet(-1,\'method\',this.value)">' +
      '<option value="cash"' + (ed.method === "cash" ? " selected" : "") + ">نقداً</option>" +
      '<option value="card"' + (ed.method === "card" ? " selected" : "") + ">بطاقة</option>" +
      '<option value="credit"' + (ed.method === "credit" ? " selected" : "") + ">آجل</option></select></div>" +
      (ed.method === "credit"
        ? '<div class="field"><label>الزبون</label><select class="inp" onchange="Sales.edSet(-1,\'customerId\',this.value)">' +
          '<option value="">— اختر —</option>' +
          S().customers.map(function (c) {
            return '<option value="' + c.id + '"' + (ed.customerId === c.id ? " selected" : "") + ">" + App.esc(c.name) + "</option>";
          }).join("") + "</select></div>"
        : '<div class="field"><label>&nbsp;</label><div class="muted small">لا يحتاج زبوناً</div></div>') +
      "</div>" +
      (ed.method === "credit"
        ? '<div class="field" style="margin-top:10px;max-width:220px"><label>المدفوع الآن</label>' +
          '<input class="inp num" type="number" min="0" step="0.25" value="' + App.num(ed.paid) +
          '" onchange="Sales.edSet(-1,\'paid\',this.value)"></div>'
        : "") +
      '<div class="field" style="margin-top:12px"><label>تعديل المخزون تبعاً للتغيير؟</label>' +
      '<select class="inp" onchange="Sales.edSet(-1,\'restock\',this.value)">' +
      '<option value="yes"' + (ed.restock === "yes" ? " selected" : "") + ">نعم — عدّل الكميات في المخزون</option>" +
      '<option value="no"' + (ed.restock === "no" ? " selected" : "") + ">لا — اترك المخزون كما هو</option></select>" +
      '<div class="hint">إن أنقصت كمية بِعتها، «نعم» تعيدها للمخزون.</div></div>' +
      '<div class="row" style="margin-top:14px;padding-top:12px;border-top:2px solid var(--ink)">' +
      '<div class="spacer"></div><div style="font-size:19px;font-weight:700">الصافي: <span class="num">' +
      App.money0(total) + "</span></div></div>";
  }

  function edSet(i, k, v) {
    if (!ed) return;
    if (i < 0) {
      if (k === "discount" || k === "paid") ed[k] = App.num(v);
      else ed[k] = v;
    } else {
      if (!ed.lines[i]) return;
      ed.lines[i][k] = App.num(v);
    }
    paintEdit();
  }

  function edDel(i) { if (ed) { ed.lines.splice(i, 1); paintEdit(); } }

  function edSuggest(q) {
    var host = document.getElementById("edSug");
    if (!host) return;
    var res = Inv.searchItems(q, 7);
    if (!res.length) { host.innerHTML = ""; return; }
    host.innerHTML = '<div class="suggest">' + res.map(function (x) {
      return '<button class="s-item" onclick="Sales.edAdd(\'' + x.type + '\',\'' + x.it.id + '\')">' +
        '<span class="t"><b>' + App.esc(App.itemName(x.it)) + "</b><span>المتوفر: " + App.num(x.it.qty) +
        " · " + App.money0(x.it.price) + "</span></span></button>";
    }).join("") + "</div>";
  }

  function edKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var hit = Inv.byBarcode(e.target.value);
      if (hit) { edAdd(hit.type, hit.it.id); return; }
      var res = Inv.searchItems(e.target.value, 1);
      if (res.length) edAdd(res[0].type, res[0].it.id);
    }
  }

  function edAdd(type, id) {
    if (!ed) return;
    var it = App.findItem(type, id);
    if (!it) return;
    var ex = null;
    ed.lines.forEach(function (l) { if (l.type === type && l.id === id) ex = l; });
    if (ex) ex.qty = App.num(ex.qty) + 1;
    else ed.lines.push({
      type: type, id: id, name: App.itemName(it),
      qty: 1, orig: 0, price: App.num(it.price), cost: App.num(it.cost), added: true
    });
    var sInp = document.getElementById("edSearch");
    if (sInp) sInp.value = "";
    var sug = document.getElementById("edSug");
    if (sug) sug.innerHTML = "";
    paintEdit();
  }

  function saveEdit(ov) {
    if (!ed) return false;
    var v = getInvoice(ed.id);
    if (!v) return false;
    var keep = ed.lines.filter(function (l) { return App.num(l.qty) > 0; });
    if (!keep.length) { App.toast("لا يمكن ترك الفاتورة فارغة — احذفها بدل ذلك.", "warn"); return false; }
    if (ed.method === "credit" && !ed.customerId) { App.toast("اختر الزبون للبيع الآجل.", "warn"); return false; }

    // فرق الكميات على المخزون
    if (ed.restock === "yes") {
      var seen = {};
      ed.lines.forEach(function (l) {
        var delta = App.num(l.orig) - App.num(l.qty);   // موجب = يعود للمخزون
        seen[l.type + ":" + l.id] = true;
        if (delta === 0) return;
        var it = App.findItem(l.type, l.id);
        if (!it) return;
        it.qty = App.num(it.qty) + delta;
        it.updated = App.nowStamp();
        if (it.consId && typeof Consign !== "undefined") {
          try {
            if (delta > 0) Consign.recordReturn(it.id, delta);
            else Consign.recordSale(it.id, -delta);
          } catch (e) { }
        }
      });
      // أسطر حُذفت كلياً
      v.items.forEach(function (o) {
        if (seen[o.type + ":" + o.id]) return;
        var it = App.findItem(o.type, o.id);
        if (!it) return;
        it.qty = App.num(it.qty) + App.num(o.qty);
        it.updated = App.nowStamp();
        if (it.consId && typeof Consign !== "undefined") {
          try { Consign.recordReturn(it.id, App.num(o.qty)); } catch (e) { }
        }
      });
    }

    // إلغاء أثر الدين القديم
    if (v.customerId) {
      var oc = People.customer(v.customerId);
      if (oc && App.num(v.due) > 0) oc.balance = Math.max(App.num(oc.balance) - App.num(v.due), 0);
    }

    var subtotal2 = keep.reduce(function (a, l) { return a + App.num(l.qty) * App.num(l.price); }, 0);
    var total2 = Math.max(subtotal2 - App.num(ed.discount), 0);
    var profit2 = keep.reduce(function (a, l) {
      return a + App.num(l.qty) * (App.num(l.price) - App.num(l.cost));
    }, 0) - App.num(ed.discount);

    v.items = keep.map(function (l) {
      return { type: l.type, id: l.id, name: l.name, qty: App.num(l.qty), price: App.num(l.price), cost: App.num(l.cost) };
    });
    v.subtotal = subtotal2;
    v.discount = App.num(ed.discount);
    v.total = total2;
    v.profit = profit2;
    v.method = ed.method;
    v.customerId = ed.method === "credit" ? ed.customerId : "";
    v.paid = ed.method === "credit" ? Math.min(App.num(ed.paid), total2) : total2;
    v.due = Math.max(total2 - v.paid, 0);
    v.editedAt = App.nowStamp();

    if (v.due > 0 && v.customerId) {
      var nc = People.customer(v.customerId);
      if (nc) nc.balance = App.num(nc.balance) + v.due;
    }

    App.log("تعديل فاتورة", "رقم " + v.no + " صارت " + App.money0(total2));
    App.saveNow();
    ed = null;
    App.rerender();
    App.toast("حُفظ تعديل الفاتورة رقم " + v.no + ".");
    return true;
  }

  /* ---------- الإرجاع ---------- */

  function startReturn(id) {
    var v = getInvoice(id);
    if (!v) return;
    var box = document.createElement("div");
    box.innerHTML = '<p class="muted" style="margin-top:0">حدّد الكمية الإرجاعة من كل صنف. تُعاد للمخزون تلقائياً.</p>' +
      '<table class="tbl"><thead><tr><th>الصنف</th><th>المُباع</th><th>الإرجاع</th><th>القيمة</th></tr></thead><tbody>' +
      v.items.map(function (l, i) {
        return "<tr><td>" + App.esc(l.name) + '</td><td class="num">' + App.num(l.qty) + "</td>" +
          '<td><input class="inp num ret-q" data-i="' + i + '" style="width:82px" type="number" min="0" max="' + App.num(l.qty) + '" value="0"></td>' +
          '<td class="num">' + App.money0(l.price) + " للقطعة</td></tr>";
      }).join("") + "</tbody></table>";

    App.modal({
      title: "إرجاع من الفاتورة رقم " + v.no,
      size: "wide",
      body: box,
      actions: [{
        label: "تسجيل الإرجاع", kind: "danger", click: function (close, ov) {
          var lines = [], tot = 0, prof = 0;
          ov.querySelectorAll(".ret-q").forEach(function (inp) {
            var q = App.num(inp.value);
            if (q <= 0) return;
            var src = v.items[App.num(inp.dataset.i)];
            q = Math.min(q, App.num(src.qty));
            lines.push({ type: src.type, id: src.id, name: src.name, qty: q, price: src.price, cost: src.cost });
            tot += q * App.num(src.price);
            prof += q * (App.num(src.price) - App.num(src.cost));
          });
          if (!lines.length) { App.toast("لم تحدد أي كمية للإرجاع.", "warn"); return; }

          S().counters.invoice++;
          var r = {
            id: App.uid(), no: S().counters.invoice, kind: "return", refNo: v.no,
            date: App.today(), at: App.nowStamp(), items: lines,
            subtotal: -tot, discount: 0, total: -tot, profit: -prof,
            method: v.method, customerId: v.customerId, paid: -tot, due: 0
          };
          lines.forEach(function (l) {
            var it = App.findItem(l.type, l.id);
            if (it) {
              it.qty = App.num(it.qty) + App.num(l.qty);
              it.updated = App.nowStamp();
              if (it.consId && typeof Consign !== "undefined") {
                try { Consign.recordReturn(it.id, App.num(l.qty)); } catch (e) { }
              }
            }
          });
          if (v.customerId) {
            var c = People.customer(v.customerId);
            if (c) c.balance = Math.max(App.num(c.balance) - tot, 0);
          }
          S().invoices.unshift(r);
          App.log("إرجاع", "من فاتورة " + v.no + " بقيمة " + App.money0(tot));
          App.saveNow(); close(); App.rerender();
          App.toast("سُجّل الإرجاع وأُعيدت الكميات للمخزون.");
        }
      }]
    });
  }

  /* ---------- الإيصال ---------- */

  function receiptHtml(v) {
    var m = S().meta;
    var c = People.customer(v.customerId);
    var wide = m.receiptWidth === "a4";
    var h = '<div class="receipt' + (wide ? " a4" : "") + '">' +
      "<h2>" + App.esc(m.shopName || "المكتبة والقرطاسية") + "</h2>" +
      (m.phone ? '<div class="c">' + App.esc(m.phone) + "</div>" : "") +
      (m.address ? '<div class="c">' + App.esc(m.address) + "</div>" : "") +
      "<hr>" +
      '<div style="display:flex;justify-content:space-between">' +
      "<span>" + (v.kind === "return" ? "إرجاع" : "فاتورة") + ' رقم <b class="num">' + v.no + "</b></span>" +
      '<span class="num">' + App.esc(v.at) + "</span></div>" +
      (c ? "<div>الزبون: " + App.esc(c.name) + "</div>" : "") +
      "<hr>" +
      "<table><thead><tr><th>الصنف</th><th>كمية</th><th>سعر</th><th>إجمالي</th></tr></thead><tbody>";

    v.items.forEach(function (l) {
      h += "<tr><td>" + App.esc(l.name) + '</td><td class="num">' + App.num(l.qty) +
        '</td><td class="num">' + App.money0(l.price) +
        '</td><td class="num">' + App.money0(App.num(l.price) * App.num(l.qty)) + "</td></tr>";
    });
    h += "</tbody></table><hr>";

    h += '<div class="tot"><span>المجموع</span><span class="num">' + App.money0(Math.abs(v.subtotal)) + "</span></div>";
    if (App.num(v.discount)) h += '<div class="tot"><span>الخصم</span><span class="num">' + App.money0(v.discount) + "</span></div>";
    h += '<div class="tot g"><span>الصافي</span><span class="num">' + App.money0(Math.abs(v.total)) + " " + App.esc(m.currency) + "</span></div>";
    h += '<div class="tot"><span>طريقة الدفع</span><span>' + payName(v.method) +
      (v.mode === "wholesale" ? " · جملة" : "") + "</span></div>";
    if (App.num(v.due) > 0) {
      h += '<div class="tot"><span>المدفوع</span><span class="num">' + App.money0(v.paid) + "</span></div>";
      h += '<div class="tot"><span>المتبقي (دين)</span><span class="num">' + App.money0(v.due) + "</span></div>";
      if (c) h += '<div class="tot"><span>إجمالي دين الزبون</span><span class="num">' + App.money0(c.balance) + "</span></div>";
    }
    h += "<hr><div class=\"c\">" + App.esc(m.footer || "") + "</div></div>";
    return h;
  }

  /* ============================================================
     رسم الإيصال كصورة — يضمن العربية على الطابعات الحرارية
     لأن الطابعة تستقبل نقاطاً لا نصاً، فلا دخل لخطها الداخلي.
     ============================================================ */

  function receiptCanvas(v) {
    var m = S().meta;
    var W = (m.receiptWidth === "58") ? 384 : 576;   // نقاط عند 203dpi
    var PAD = 18;
    var RIGHT = W - PAD;
    var LEFT = PAD;

    var c = document.createElement("canvas");
    c.width = W;
    c.height = 4000;
    var g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, W, 4000);
    g.fillStyle = "#000";
    g.direction = "rtl";
    g.textBaseline = "alphabetic";

    var y = 30;
    var F = "'Segoe UI', Tahoma, Arial, sans-serif";

    function font(size, bold) { g.font = (bold ? "bold " : "") + size + "px " + F; }

    function line(str, size, opts) {
      opts = opts || {};
      font(size, opts.bold);
      g.textAlign = opts.align || "center";
      var xp = opts.align === "right" ? RIGHT : (opts.align === "left" ? LEFT : W / 2);
      g.fillText(str, xp, y);
      y += Math.round(size * 1.45);
    }

    function sep(dashed) {
      g.beginPath();
      if (dashed && g.setLineDash) g.setLineDash([6, 5]);
      g.lineWidth = 2;
      g.moveTo(LEFT, y - 6);
      g.lineTo(RIGHT, y - 6);
      g.stroke();
      if (g.setLineDash) g.setLineDash([]);
      y += 14;
    }

    /* يلفّ الاسم الطويل على أكثر من سطر */
    function wrap(str, maxW, size) {
      font(size);
      var words = String(str).split(" ");
      var out = [], cur = "";
      words.forEach(function (wd) {
        var tryS = cur ? cur + " " + wd : wd;
        if (g.measureText(tryS).width > maxW && cur) { out.push(cur); cur = wd; }
        else cur = tryS;
      });
      if (cur) out.push(cur);
      return out;
    }

    function cell(str, xp, align, size, bold) {
      font(size, bold);
      g.textAlign = align;
      g.fillText(str, xp, y);
    }

    var S1 = W === 384 ? 17 : 22;    // حجم النص الأساسي
    var S2 = W === 384 ? 15 : 19;    // الصغير
    var SB = W === 384 ? 24 : 32;    // العنوان

    // الترويسة
    line(m.shopName || "المكتبة والقرطاسية", SB, { bold: true });
    if (m.phone) line(m.phone, S2);
    if (m.address) line(m.address, S2);
    y += 4;
    sep(true);

    var c2 = People.customer(v.customerId);
    line((v.kind === "return" ? "إرجاع رقم " : "فاتورة رقم ") + v.no, S1, { align: "right", bold: true });
    line(String(v.at), S2, { align: "left" });
    if (c2) line("الزبون: " + c2.name, S2, { align: "right" });
    sep(true);

    // رؤوس الأعمدة
    var colTotal = LEFT + (W === 384 ? 78 : 104);
    var colPrice = LEFT + (W === 384 ? 158 : 216);
    var colQty = LEFT + (W === 384 ? 208 : 286);
    var nameMax = RIGHT - colQty - 12;

    cell("الصنف", RIGHT, "right", S2, true);
    cell("كمية", colQty, "right", S2, true);
    cell("سعر", colPrice, "right", S2, true);
    cell("إجمالي", colTotal, "right", S2, true);
    y += Math.round(S2 * 1.4);
    sep(false);

    v.items.forEach(function (l) {
      var parts = wrap(l.name, nameMax, S1);
      cell(parts[0], RIGHT, "right", S1);
      cell(String(App.num(l.qty)), colQty, "right", S1);
      cell(App.money0(l.price), colPrice, "right", S1);
      cell(App.money0(App.num(l.price) * App.num(l.qty)), colTotal, "right", S1, true);
      y += Math.round(S1 * 1.4);
      for (var i = 1; i < parts.length; i++) {
        cell(parts[i], RIGHT, "right", S2);
        y += Math.round(S2 * 1.35);
      }
      y += 4;
    });

    sep(true);

    function tot(lbl, val, big) {
      var sz = big ? Math.round(S1 * 1.25) : S1;
      cell(lbl, RIGHT, "right", sz, big);
      cell(val, LEFT, "left", sz, true);
      y += Math.round(sz * 1.5);
    }

    tot("المجموع", App.money0(Math.abs(v.subtotal)));
    if (App.num(v.discount)) tot("الخصم", App.money0(v.discount));
    y += 4;
    sep(false);
    tot("الصافي", App.money0(Math.abs(v.total)) + " " + (m.currency || ""), true);
    tot("طريقة الدفع", payName(v.method) + (v.mode === "wholesale" ? " · جملة" : ""));
    if (App.num(v.due) > 0) {
      tot("المدفوع", App.money0(v.paid));
      tot("المتبقي ديناً", App.money0(v.due));
      if (c2) tot("إجمالي دينه", App.money0(c2.balance));
    }

    sep(true);
    if (m.footer) line(m.footer, S1);
    y += 20;

    var out = document.createElement("canvas");
    out.width = W;
    out.height = y;
    var og = out.getContext("2d");
    og.fillStyle = "#fff";
    og.fillRect(0, 0, W, y);
    og.drawImage(c, 0, 0);
    return out;
  }

  function printInvoice(id, auto) {
    var v = getInvoice(id);
    if (!v) return;
    var m = S().meta;
    var asImage = (m.receiptWidth !== "a4") && (m.printMode !== "text");
    if (!asImage) { App.printHtml(receiptHtml(v)); return; }
    try {
      var cv = receiptCanvas(v);
      var mm = (m.receiptWidth === "58") ? 48 : 72;
      App.printHtml('<img class="receipt-img" src="' + cv.toDataURL("image/png") +
        '" style="width:' + mm + 'mm;display:block;margin:0 auto">');
    } catch (e) {
      App.printHtml(receiptHtml(v));   // لو تعذّر الرسم نعود للنص
    }
  }

  /* معاينة الإيصال كصورة — للتجربة من الإعدادات */
  function previewReceipt() {
    var v = S().invoices[0];
    if (!v) {
      v = {
        no: 0, kind: "sale", at: App.nowStamp(), items: [
          { name: "كتاب تجريبي للطباعة", qty: 2, price: 15, cost: 10 },
          { name: "قلم جاف أزرق", qty: 3, price: 1, cost: 0.5 }
        ], subtotal: 33, discount: 0, total: 33, profit: 0, method: "cash", customerId: "", paid: 33, due: 0
      };
    }
    var cv = receiptCanvas(v);
    App.modal({
      title: "معاينة الإيصال كصورة",
      body: '<p class="muted small" style="margin-top:0">هذا ما سيصل الطابعة — صورة، فالعربية مضمونة.</p>' +
        '<div style="text-align:center;background:#fff;padding:12px;border:1px solid var(--line);border-radius:var(--r)">' +
        '<img src="' + cv.toDataURL("image/png") + '" style="max-width:100%;border:1px solid #eee"></div>',
      actions: [{
        label: "طباعة تجريبية", kind: "primary", click: function () {
          var mm = (S().meta.receiptWidth === "58") ? 48 : 72;
          App.printHtml('<img class="receipt-img" src="' + cv.toDataURL("image/png") +
            '" style="width:' + mm + 'mm;display:block;margin:0 auto">');
        }
      }]
    });
  }

  function exportInvoices() {
    var rows = filteredInvoices();
    if (!rows.length) { App.toast("لا فواتير في هذه الفترة.", "warn"); return; }
    App.xls("الفواتير-" + App.today(), "سجل الفواتير", [
      { h: "رقم", t: "i", c: function (v) { return v.no; } },
      { h: "التاريخ", c: function (v) { return v.date; } },
      { h: "الوقت", c: function (v) { return String(v.at).slice(11); } },
      { h: "النوع", c: function (v) { return v.kind === "return" ? "إرجاع" : "بيع"; } },
      { h: "النمط", c: function (v) { return v.mode === "wholesale" ? "جملة" : "قطاعي"; } },
      { h: "طريقة الدفع", c: function (v) { return payName(v.method); } },
      { h: "الزبون", c: function (v) { var c = People.customer(v.customerId); return c ? c.name : "-"; } },
      { h: "الأصناف", c: function (v) { return v.items.map(function (l) { return l.name + " ×" + App.num(l.qty); }).join(" | "); } },
      { h: "المجموع", t: "n", sum: true, c: function (v) { return App.num(v.subtotal); } },
      { h: "الخصم", t: "n", sum: true, c: function (v) { return App.num(v.discount); } },
      { h: "الصافي", t: "n", sum: true, c: function (v) { return App.num(v.total); } },
      { h: "المدفوع", t: "n", sum: true, c: function (v) { return App.num(v.paid); } },
      { h: "المتبقي", t: "n", sum: true, c: function (v) { return App.num(v.due); } },
      { h: "الربح", t: "n", sum: true, c: function (v) { return App.num(v.profit); } }
    ].filter(function (c) { return c.h !== "الربح" || App.canProfit(); }), rows, S().meta.shopName || "");
    App.toast("نُزّل جدول الفواتير.");
  }

  return {
    pos: pos, afterRender: afterRender, suggest: suggest, scanKey: scanKey,
    add: add, setQty: setQty, bump: bump, delLine: delLine, clear: clear,
    editQuick: editQuick, qFilter: qFilter, qToggle: qToggle, qClear: qClear,
    pick: pick, backPay: backPay, pickCust: pickCust, confirmCredit: confirmCredit,
    setDiscount: setDiscount, setMethod: setMethod, setMode: setMode, setCustomer: setCustomer,
    setPaid: setPaid, setAutoPrint: setAutoPrint, payName: payName, payBadge: payBadge,
    complete: complete,
    invoices: invoices, setInvF: setInvF, showInvoice: showInvoice,
    allInvoices: allInvoices, moreInvoices: moreInvoices,
    printInvoice: printInvoice, startReturn: startReturn, exportInvoices: exportInvoices,
    deleteInvoice: deleteInvoice, editInvoice: editInvoice,
    edSet: edSet, edDel: edDel, edAdd: edAdd, edSuggest: edSuggest, edKey: edKey,
    getInvoice: getInvoice, receiptHtml: receiptHtml,
    receiptCanvas: receiptCanvas, previewReceipt: previewReceipt
  };
})();
