/* ============================================================
   واجهة 4.0 — نقطة البيع
   ------------------------------------------------------------
   - البحث مع كل حرف بأمر search (المرحلة 3): الحرف الجديد يلغي البحث
     السابق في المحرك، والرد القديم يُتجاهل هنا.
   - Enter يضيف المطابق وحده (اسم كامل، أو مطابق واحد، أو باركود/رمز)؛
     «هل تقصد؟» تُختار باليد، كما في 3.2.
   - البيعة أمر sale واحد: كلها أو لا شيء منها (قرار 0007).
   ============================================================ */
var V4Pos = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;

  var cart = [], mode = "retail", discount = 0;
  var res = null, hi = -1, seq = 0, last = null, payModal = null, fresh = 0;

  function pos() {
    return '<div id="pos">' +
      '<div class="left">' +
      '<div class="scanbar">' +
      '<div class="seg mode-seg" style="margin-bottom:11px">' +
      '<button id="modeR" onclick="V4Pos.setMode(\'retail\')">قطاعي</button>' +
      '<button id="modeW" onclick="V4Pos.setMode(\'wholesale\')">جملة</button>' +
      "</div>" +
      '<input class="big-input" id="scan" autocomplete="off" spellcheck="false" ' +
      'placeholder="امسح الباركود أو اكتب اسم الكتاب…" ' +
      'oninput="V4Pos.suggest(this.value)" onkeydown="V4Pos.key(event)">' +
      '<div id="posResults"></div>' +
      "</div>" +
      '<div class="cart-area" id="cartArea"></div>' +
      "</div>" +
      '<div class="right">' +
      '<div class="totals" id="totals"></div>' +
      '<div class="pay-foot" id="payFoot"></div>' +
      "</div></div>";
  }

  function after() {
    paint();
    focusScan();
  }

  function focusScan() {
    setTimeout(function () {
      var s = document.getElementById("scan");
      /* الحقل مركّز أصلاً: لا نحدّد ما بدأ البائع يكتبه، فيمسحه الحرف التالي */
      if (s && document.activeElement !== s) { s.focus(); s.select(); }
    }, 40);
  }

  /* القائمة تُغلق بالضغط خارجها */
  document.addEventListener("mousedown", function (e) {
    var host = document.getElementById("posResults");
    if (!host || !host.firstChild) return;
    if (host.contains(e.target) || e.target.id === "scan") return;
    host.innerHTML = ""; hi = -1;
  });

  /* ---------- البحث ---------- */

  function search(q) {
    var my = ++seq;
    return V4.call("search", { q: q, limit: 9, channel: "pos" }).then(function (d) {
      if (my !== seq || d.cancelled) return null;   // حرف أحدث سبقه
      d.forQ = q;
      return d;
    });
  }

  function suggest(q) {
    hi = -1;
    if (!q.trim()) { res = null; seq++; paintResults(); return; }
    search(q).then(function (d) {
      if (!d) return;
      res = d;
      paintResults();
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function paintResults() {
    var host = document.getElementById("posResults");
    if (!host) return;
    if (!res || !res.items.length) {
      host.innerHTML = res && res.forQ ? '<div class="suggest"><div class="s-head">لا يوجد صنف بهذا الاسم</div><div id="posBranch"></div></div>' : "";
      /* موجود في فرع آخر؟ يُقال للزبون وين يلقاه */
      if (res && res.forQ) V4Sync.hint(res.forQ, document.getElementById("posBranch"));
      return;
    }
    /* القائمة مفتوحة: تتحدث مع كل حرف بلا حركة الظهور، فلا ترمش أثناء الكتابة */
    var open = !!host.querySelector(".suggest");
    host.innerHTML = '<div class="suggest" id="sug"' + (open ? ' style="animation:none"' : "") + ">" + res.items.map(function (it, i) {
      var head = i === res.nearFrom
        ? '<div class="s-head">' + App.icon("search", 14) + " " +
          (i === 0 ? "ما لقيناش «" + esc(res.forQ) + "» بالضبط — هل تقصد؟" : "نتائج قريبة (فيها اختلاف بسيط في الكتابة)") + "</div>"
        : "";
      var st = it.qty <= 0 ? "bad" : it.qty <= it.min ? "warn" : "ok";
      return head + '<button class="s-item rich" data-i="' + i + '" onclick="V4Pos.pick(' + i + ')">' +
        '<span class="t"><b>' + esc(it.title) + "</b>" +
        '<span class="meta2">' + (it.author || it.brand ? esc(it.author || it.brand) + " · " : "") +
        (it.kind === "book" ? "كتاب" : "قرطاسية") +
        (it.barcode ? ' · <span class="num">' + esc(it.barcode) + "</span>" : "") + "</span></span>" +
        '<span class="sp"><span class="badge ' + st + '">المتوفر ' + it.qty + "</span></span>" +
        '<span class="pr"><span class="p1 num">' + money(it.price) + "</span>" +
        '<span class="p2 num">جملة ' + money(it.priceW || it.price) + "</span></span></button>";
    }).join("") + (res.nearFrom === 0 ? '<div id="posBranch"></div>' : "") + "</div>";
    /* لا شيء هنا بالضبط («هل تقصد؟» وحدها): ربما هو في فرع آخر */
    if (res.nearFrom === 0) V4Sync.hint(res.forQ, document.getElementById("posBranch"));
  }

  function markHi(items) {
    Array.prototype.forEach.call(items, function (b, i) { b.classList.toggle("hi", i === hi); });
    if (items[hi]) items[hi].scrollIntoView({ block: "nearest" });
  }

  function key(e) {
    var box = document.getElementById("sug");
    var items = box ? box.querySelectorAll(".s-item") : [];
    if (e.key === "ArrowDown" && items.length) { e.preventDefault(); hi = Math.min(hi + 1, items.length - 1); markHi(items); return; }
    if (e.key === "ArrowUp" && items.length) { e.preventDefault(); hi = Math.max(hi - 1, 0); markHi(items); return; }
    if (e.key === "Escape") { e.target.value = ""; suggest(""); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    var v = e.target.value.trim();
    if (!v) { if (cart.length) complete(); return; }
    if (hi >= 0 && res && res.items[hi]) { add(res.items[hi]); return; }
    enter(v);
  }

  /* Enter: الباركود أو الرمز أولاً، ثم الاسم المطابق وحده */
  function enter(v) {
    var looksCode = /\d/.test(App.digits(v)) && !/\s/.test(v.trim());
    var byCode = looksCode
      ? V4.call("item.find", { barcode: App.digits(v) }).then(function (it) { return it || V4.call("item.find", { code: v }); })
      : Promise.resolve(null);
    byCode.then(function (it) {
      if (it) { add(it); return; }
      var ready = res && res.forQ === v ? Promise.resolve(res) : search(v);
      return ready.then(function (d) {
        if (!d) return;
        res = d;
        if (d.items.length && (d.names === 1 || d.exact === 1)) { add(d.items[0]); return; }
        paintResults();
        if (!d.items.length) App.toast("لا يوجد صنف بهذا الاسم أو الباركود.", "warn");
        else if (!d.exact) App.toast("ما لقيناش «" + v + "» بالضبط — اختر من «هل تقصد؟».", "warn");
        else App.toast("أكثر من صنف يطابق — اختر من القائمة.", "warn");
      });
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function pick(i) { if (res && res.items[i]) add(res.items[i]); }

  /* ---------- الفاتورة ---------- */

  function priceOf(it) { return mode === "wholesale" && it.priceW > 0 ? it.priceW : it.price; }

  function add(it) {
    var ex = null;
    cart.forEach(function (l) { if (l.id === it.id) ex = l; });
    if (ex) ex.qty++;
    else {
      fresh = it.id;
      cart.push({ id: it.id, kind: it.kind, name: it.title, by: it.author || it.brand || "", qty: 1, price: priceOf(it),
        retail: it.price, wholesale: it.priceW, stock: it.qty, min: it.min, barcode: it.barcode });
    }
    var s = document.getElementById("scan");
    if (s) s.value = "";
    res = null; hi = -1; seq++;
    paintResults();
    paint();
    focusScan();
    if (it.qty <= 0) App.toast("تنبيه: «" + it.title + "» كميته صفر في المحل.", "warn");
    if (priceOf(it) <= 0) App.toast("«" + it.title + "» سعره صفر.", "bad");
  }

  function setQty(i, v) {
    if (!cart[i]) return;
    var q = Math.round(App.num(v));
    if (q <= 0) cart.splice(i, 1); else cart[i].qty = q;
    clampDiscount();
    paint();
  }
  function delLine(i) { cart.splice(i, 1); clampDiscount(); paint(); focusScan(); }

  function subtotal() { return cart.reduce(function (s, l) { return s + l.price * l.qty; }, 0); }
  function total() { return Math.max(subtotal() - discount, 0); }
  function clampDiscount() { discount = Math.min(discount, subtotal()); }

  function setDiscount(v) {
    var want = V4.dirhams(v), cap = subtotal();
    discount = Math.min(Math.max(want, 0), cap);
    if (want > cap) App.toast("الخصم لا يتجاوز مجموع الفاتورة.", "warn");
    paintTotals();
  }

  function setMode(m) {
    mode = m;
    cart.forEach(function (l) { l.price = mode === "wholesale" && l.wholesale > 0 ? l.wholesale : l.retail; });
    clampDiscount();
    paint(); focusScan();
  }

  function clear() { cart = []; discount = 0; paint(); focusScan(); }

  function paint() {
    var r = document.getElementById("modeR"), w = document.getElementById("modeW");
    if (r) r.className = mode === "retail" ? "on" : "";
    if (w) w.className = mode === "wholesale" ? "on" : "";
    paintCart(); paintTotals(); paintPay();
  }

  function paintCart() {
    var host = document.getElementById("cartArea");
    if (!host) return;
    if (!cart.length) {
      host.innerHTML = (last ? '<div class="card" style="margin-bottom:14px"><div class="card-body row">' +
        App.icon("check", 18) + " <b>آخر فاتورة رقم <span class=\"num\">" + last.no + "</span></b>" +
        '<span class="muted">' + money(last.total) + " " + esc(V4.currency()) + "</span>" +
        '<div class="spacer"></div><button class="btn sm" onclick="V4Pos.printLast()">طباعة الإيصال</button></div></div>' : "") +
        '<div class="empty"><div class="big">' + App.icon("pos", 44) + "</div><h4>الفاتورة فارغة</h4>" +
        "<p>امسح الباركود بالقارئ، أو اكتب اسم الكتاب في الحقل بالأعلى.<br>" +
        "بعد إضافة الأصناف اضغط <b>Enter</b> على حقل فارغ لإتمام البيع.</p></div>";
      return;
    }
    host.innerHTML = cart.map(function (l, i) {
      var left = l.stock - l.qty;
      /* حركة الظهور للسطر الجديد وحده، لا لكل الأسطر مع كل تغيير */
      return '<div class="cart-line" data-i="' + i + '"' + (l.id === fresh ? "" : ' style="animation:none"') + ">" +
        '<button class="x" title="حذف السطر" onclick="V4Pos.delLine(' + i + ')">✕</button>' +
        '<div class="lp num">' + money(l.price * l.qty) + "</div>" +
        '<div class="qty-box">' +
        '<button onclick="V4Pos.setQty(' + i + ',' + (l.qty + 1) + ')">+</button>' +
        '<input class="num" data-num inputmode="numeric" value="' + l.qty + '" onchange="V4Pos.setQty(' + i + ',this.value)">' +
        '<button onclick="V4Pos.setQty(' + i + ',' + (l.qty - 1) + ')">−</button>' +
        "</div>" +
        '<div class="info"><b>' + esc(l.name) + "</b>" +
        '<div class="ln-meta">' + (l.by ? "<span>" + esc(l.by) + "</span>" : "") +
        '<span class="badge lft ' + (left < 0 ? "bad" : left <= l.min ? "warn" : "ok") + '">يبقى ' + left + "</span></div>" +
        '<div class="ln-price">قطاعي ' + money(l.retail) + " · جملة " + money(l.wholesale || l.retail) +
        (l.barcode ? ' · <span class="num">' + esc(l.barcode) + "</span>" : "") + "</div>" +
        "</div></div>";
    }).join("");
    fresh = 0;
  }

  function paintTotals() {
    var host = document.getElementById("totals");
    if (!host) return;
    var d = document.getElementById("tDisc");
    var typing = d && document.activeElement === d;
    if (typing) {
      /* لا نعيد بناء الحقل والمؤشّر فيه: الأرقام فقط */
      document.getElementById("tSub").textContent = money(subtotal());
      document.getElementById("tNet").textContent = money(total());
      paintPay();
      return;
    }
    host.innerHTML =
      '<div class="t-row"><span>عدد القطع</span><span class="num">' + cart.reduce(function (s, l) { return s + l.qty; }, 0) + "</span></div>" +
      '<div class="t-row"><span>المجموع</span><span class="num" id="tSub">' + money(subtotal()) + "</span></div>" +
      '<div class="t-row"><span>الخصم</span><input class="inp num" id="tDisc" data-num inputmode="decimal" ' +
      'style="width:104px;text-align:center;padding:4px 8px" value="' + (discount ? money(discount) : "0") +
      '" onchange="V4Pos.setDiscount(this.value)"></div>' +
      '<div class="t-row grand"><span>الصافي</span><span class="num" id="tNet">' + money(total()) + "</span></div>";
    paintPay();
  }

  function paintPay() {
    var host = document.getElementById("payFoot");
    if (!host) return;
    host.innerHTML = '<div class="row"><button class="btn danger" onclick="V4Pos.clear()">إلغاء</button>' +
      '<button class="btn primary lg spacer" id="doneBtn" onclick="V4Pos.complete()" ' + (cart.length ? "" : "disabled") + ">" +
      "إتمام البيع · " + money(total()) + "</button></div>" +
      '<div class="muted small center" style="margin-top:8px">Enter على حقل فارغ = إتمام البيع</div>';
  }

  /* ---------- إتمام البيع ---------- */

  function complete() {
    if (payModal) return;
    if (!cart.length) { App.toast("الفاتورة فارغة.", "warn"); return; }
    var free = cart.filter(function (l) { return l.price <= 0; }).map(function (l) { return l.name; });
    var short = cart.filter(function (l) { return l.qty > l.stock; }).map(function (l) { return l.name + " (المتوفر " + l.stock + ")"; });
    var warn = (free.length ? "سعره صفر وسيُباع مجاناً:\n" + free.join("\n") + "\n\n" : "") +
      (short.length ? "الكمية أكبر من الموجود في المحل:\n" + short.join("\n") + "\n\nسيصير رصيده بالسالب." : "");
    if (warn) App.confirm(warn, askPayment, { yes: "أكمل البيع", title: "قبل إتمام البيع" });
    else askPayment();
  }

  function askPayment() {
    if (payModal || !cart.length) return;
    var t = total();
    var box = document.createElement("div");
    box.innerHTML = '<div class="pay-amount">المطلوب <span class="num">' + money(t) + "</span> " + esc(V4.currency()) + "</div>" +
      '<div class="pay-choices">' +
      '<button class="pay-btn cash" data-m="cash">' + App.icon("cash", 26) + '<span class="pb-l">نقداً</span></button>' +
      '<button class="pay-btn card" data-m="card">' + App.icon("card", 26) + '<span class="pb-l">بطاقة</span></button>' +
      '<button class="pay-btn credit" data-m="credit">' + App.icon("clock", 26) + '<span class="pb-l">آجل (دين)</span></button>' +
      "</div>" +
      '<div class="muted small center" style="margin-top:12px">اضغط 1 نقداً · 2 بطاقة · 3 آجل</div>';
    function keys(e) {
      if (e.key === "1") pay("cash");
      else if (e.key === "2") pay("card");
      else if (e.key === "3") credit();
    }
    payModal = App.modal({ title: "طريقة الدفع", size: "narrow", body: box, foot: false,
      onClose: function () { document.removeEventListener("keydown", keys); payModal = null; focusScan(); } });
    document.addEventListener("keydown", keys);
    Array.prototype.forEach.call(box.querySelectorAll("[data-m]"), function (b) {
      b.onclick = function () { var m = b.getAttribute("data-m"); if (m === "credit") credit(); else pay(m); };
    });

    function credit() {
      document.removeEventListener("keydown", keys);
      V4.run("customers.list").then(function (list) {
        box.innerHTML = '<div class="pay-amount">آجل — المطلوب <span class="num">' + money(t) + "</span></div>" +
          '<div class="field" style="margin-bottom:12px"><label>الزبون</label><div class="row" style="gap:8px">' +
          '<select class="inp" id="payCust" style="flex:1">' +
          '<option value="">— اختر الزبون —</option>' +
          list.map(function (c) {
            return '<option value="' + c.id + '">' + esc(c.name) + (c.balance ? " (عليه " + money(c.balance) + ")" : "") + "</option>";
          }).join("") + "</select>" +
          (V4.can("customers") && window.V4People ? '<button class="btn" id="payNewCust" type="button">+ زبون جديد</button>' : "") +
          "</div></div>" +
          '<div class="field"><label>المدفوع الآن (اختياري)</label><input class="inp num" id="payNow" data-num inputmode="decimal" value="0"></div>' +
          '<div class="row" style="margin-top:16px"><div class="spacer"></div>' +
          '<button class="btn primary lg" id="payCredit">تسجيل الدين وإتمام البيع</button></div>';
        var nc = box.querySelector("#payNewCust");
        /* زبون جديد من البيع نفسه: يُضاف ويُختار، ويكمل البائع بلا خروج من البيع */
        if (nc) nc.onclick = function () {
          V4People.edit(0, function (id, name) {
            var sel = box.querySelector("#payCust");
            if (!sel || !id) return;
            var o = document.createElement("option");
            o.value = id; o.textContent = name;
            sel.appendChild(o);
            sel.value = String(id);
          });
        };
        box.querySelector("#payCredit").onclick = function () {
          var cid = Number(box.querySelector("#payCust").value);
          if (!cid) { App.toast("اختر الزبون أولاً.", "warn"); return; }
          pay("credit", cid, V4.dirhams(box.querySelector("#payNow").value));
        };
      });
    }
  }

  var busy = false;
  function pay(method, customerId, paid) {
    if (busy) return;
    busy = true;
    var body = {
      lines: cart.map(function (l) { return { itemId: l.id, qty: l.qty, price: l.price }; }),
      discount: discount, method: method, mode: mode
    };
    if (method === "credit") { body.customerId = customerId; body.paid = paid || 0; }
    V4.run("sale", body).then(function (r) {
      if (payModal) payModal.close();
      cart = []; discount = 0;
      /* جهاز ثانٍ: البيعة تُنفَّذ عند جهاز المحل، ورقم فاتورتها يُعطى هناك */
      if (V4.queued(r, "البيعة")) { last = null; paint(); focusScan(); return; }
      last = { id: r.id, no: r.no, total: r.total };
      paint();
      App.toast("تمت البيعة: فاتورة رقم " + r.no + " · " + money(r.total), "ok");
      if (r.fromRoom && r.fromRoom.length) App.toast("خذ من غرفة الخزين: " + r.fromRoom.join("، "), "warn");
      focusScan();
    }).catch(function () { }).then(function () { busy = false; });
  }

  function printLast() {
    if (!last) return;
    V4.run("invoice.get", { id: last.id }).then(V4Home.print);
  }

  V4.page({ o: 20, g: "البيع", k: "pos", t: "نقطة البيع", ic: "pos", perm: "sell", flush: true, render: pos, after: after });

  return {
    suggest: suggest, key: key, pick: pick, setQty: setQty, delLine: delLine, setDiscount: setDiscount,
    setMode: setMode, clear: clear, complete: complete, printLast: printLast,
    cart: function () { return cart; }
  };
})();
