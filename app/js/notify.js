/* ============================================================
   notify.js — إشعارات ntfy على الهاتف
   ============================================================ */

var Notify = (function () {

  function S() { return App.S; }

  var KINDS = [
    { k: "low", t: "صنف قارب على النفاد", d: "عند وصول أي صنف إلى حد التنبيه الذي حددته له", tag: "warning" },
    { k: "out", t: "صنف نفد تماماً", d: "عند وصول الكمية إلى صفر", tag: "rotating_light" },
    { k: "sale", t: "كل عملية بيع", d: "إشعار بعد كل فاتورة — قد يكون كثيراً في المحل المزدحم", tag: "shopping_cart" },
    { k: "bigsale", t: "فاتورة كبيرة فقط", d: "عند تجاوز الفاتورة المبلغ الذي تحدده بالأسفل", tag: "moneybag" },
    { k: "debt", t: "بيع بالآجل (دين جديد)", d: "عند تسجيل دين جديد على زبون", tag: "memo" },
    { k: "pay", t: "تسديد دين", d: "عند استلام تسديد من زبون", tag: "white_check_mark" },
    { k: "transfer", t: "طلب تحويل وارد", d: "عندما يطلب فرع آخر بضاعة منك", tag: "arrows_counterclockwise" },
    { k: "daily", t: "ملخص آخر اليوم", d: "إجمالي مبيعات وأرباح اليوم عند أول إغلاق بعد الوقت المحدد", tag: "bar_chart" }
  ];

  function cfg() { return S().notify; }

  function on(kind) {
    var c = cfg();
    return c && c.enabled && c.topic && c.kinds && c.kinds[kind];
  }

  /* ---------- الإرسال ---------- */

  function send(kind, title, message, priority) {
    if (!on(kind)) return;

    var c = cfg();
    var meta = null;
    KINDS.forEach(function (x) { if (x.k === kind) meta = x; });

    var payload = {
      topic: String(c.topic).trim(),
      title: (S().branch.city ? "[" + S().branch.city + "] " : "") + title,
      message: message,
      priority: priority || 3
    };
    if (meta && meta.tag) payload.tags = [meta.tag];

    App.api("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: String(c.server || "https://ntfy.sh").trim(), payload: payload })
    }).then(function (r) { return r.json(); }).then(function (res) {
      log(kind, title, message, res && res.ok);
    }).catch(function () { log(kind, title, message, false); });
  }

  function log(kind, title, message, ok) {
    var c = cfg();
    c.log = c.log || [];
    c.log.unshift({ at: App.nowStamp(), kind: kind, title: title, message: message, ok: !!ok });
    if (c.log.length > 60) c.log.length = 60;
    App.save();
  }

  /* ---------- الأحداث ---------- */

  /* يُستدعى بعد كل بيع: يقارن حالة المخزون قبل وبعد */
  function afterSale(inv, before) {
    if (App.num(inv.total) > 0) {
      var names = inv.items.map(function (l) { return l.name + " ×" + App.num(l.qty); }).join("، ");
      if (on("sale")) {
        send("sale", "فاتورة " + inv.no + " — " + App.money(inv.total), names);
      } else if (on("bigsale") && App.num(inv.total) >= bigThreshold()) {
        send("bigsale", "فاتورة كبيرة: " + App.money(inv.total), "فاتورة رقم " + inv.no + "\n" + names, 4);
      }
    }

    if (App.num(inv.due) > 0) {
      var cust = People.customer(inv.customerId);
      send("debt", "دين جديد: " + App.money(inv.due),
        (cust ? cust.name : "زبون") + " — إجمالي دينه الآن " + App.money(cust ? cust.balance : 0));
    }

    // تنبيهات المخزون: فقط عند عبور الحد، لا في كل بيع
    inv.items.forEach(function (l) {
      var it = App.findItem(l.type, l.id);
      if (!it) return;
      var prev = before[l.type + ":" + l.id];
      if (prev === undefined) return;
      var q = App.num(it.qty), m = App.num(it.min);

      if (prev > 0 && q <= 0) {
        send("out", "نفد: " + App.itemName(it),
          locLine(it, l.type) + "\nبِيعت آخر نسخة للتو", 4);
      } else if (m > 0 && prev > m && q <= m) {
        send("low", "قارب على النفاد: " + App.itemName(it),
          "المتبقي " + q + " فقط (حد التنبيه " + m + ")\n" + locLine(it, l.type));
      }
    });
  }

  function bigThreshold() {
    var b = cfg().bigAmount;
    return (b === undefined || b === null || b === "") ? 100 : App.num(b);
  }

  function locLine(it, type) {
    if (type === "book") return "الموقع: مكتبة " + (it.lib || "?") + " · رف " + (it.shelf || "?");
    return it.loc ? "المكان: " + it.loc : "";
  }

  function snapshotQty() {
    var m = {};
    App.allItems().forEach(function (x) { m[x.type + ":" + x.it.id] = App.num(x.it.qty); });
    return m;
  }

  function payment(cust, amount) {
    send("pay", "تسديد: " + App.money(amount),
      cust.name + " — المتبقي عليه " + App.money(cust.balance));
  }

  function transferRequest(fromName, lines) {
    send("transfer", "طلب تحويل من " + fromName,
      lines.map(function (l) { return l.n + " ×" + App.num(l.qty); }).join("، "), 4);
  }

  /* ملخص اليوم — يُفحص عند الإقلاع وكل ساعة */
  function maybeDaily() {
    var c = cfg();
    if (!on("daily")) return;
    var today = App.today();
    if (c.lastDaily === today) return;
    var dh = (c.dailyHour === undefined || c.dailyHour === null || c.dailyHour === "") ? 20 : App.num(c.dailyHour);
    var h = new Date().getHours();
    if (h < dh) return;

    var inv = S().invoices.filter(function (v) { return v.date === today; });
    if (!inv.length) { c.lastDaily = today; return; }
    var total = inv.reduce(function (s, v) { return s + App.num(v.total); }, 0);
    var profit = inv.reduce(function (s, v) { return s + App.num(v.profit); }, 0);
    var lowN = App.lowCount();

    c.lastDaily = today;
    /* الربح لا يُرسل: قنوات ntfy العامة يقرأها كل من يعرف اسم القناة،
       والدليل يَعِد الزبون صراحةً بأن الإشعارات لا تحمل أرباحه.
       من يريده يفعّل "أرسل الربح في الملخص" بنفسه من صفحة الإشعارات. */
    var body = "عدد الفواتير: " + inv.filter(function (v) { return v.kind !== "return"; }).length +
      "\nأصناف تحتاج شراء: " + lowN;
    if (c.dailyProfit) body += "\nالربح: " + App.money(profit);
    send("daily", "ملخص اليوم — " + App.money(total), body);
  }

  function test() {
    var c = cfg();
    if (!c.topic) { App.toast("اكتب اسم القناة أولاً.", "warn"); return; }
    App.api("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: String(c.server || "https://ntfy.sh").trim(),
        payload: {
          topic: String(c.topic).trim(),
          title: "تجربة من " + (S().meta.shopName || "المنظومة"),
          message: "إذا وصلك هذا الإشعار فالإعداد صحيح ✅",
          tags: ["bell"], priority: 3
        }
      })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res && res.ok) { App.toast("أُرسل الإشعار. تحقّق من هاتفك."); log("test", "تجربة", "", true); }
      else { App.toast("تعذّر الإرسال: " + ((res && res.error) || "خطأ"), "bad"); log("test", "تجربة", "", false); }
      App.rerender();
    }).catch(function () { App.toast("تعذّر الاتصال بخادم الإشعارات.", "bad"); });
  }

  /* ============================================================
     الصفحة
     ============================================================ */

  function page() {
    var c = cfg();
    var h = '<div class="grid g2">';

    // الإعداد
    h += '<div class="card"><div class="card-head"><h3>إعداد الإشعارات</h3><div class="spacer"></div>' +
      (c.enabled && c.topic ? '<span class="badge ok">مفعّلة</span>' : '<span class="badge">غير مفعّلة</span>') +
      "</div><div class=\"card-body\">" +
      '<p class="muted small" style="margin-top:0;line-height:1.8">تصلك الإشعارات على هاتفك عبر تطبيق ntfy المجاني. لا يحتاج حساباً ولا اشتراكاً — فقط اسم قناة سرّي تختاره أنت.</p>' +

      '<div class="field" style="margin-bottom:12px"><label>تفعيل الإشعارات</label>' +
      '<select class="inp" onchange="Notify.set(\'enabled\',this.value===\'yes\')">' +
      '<option value="no"' + (!c.enabled ? " selected" : "") + ">موقوفة</option>" +
      '<option value="yes"' + (c.enabled ? " selected" : "") + ">مفعّلة</option></select></div>" +

      '<div class="field" style="margin-bottom:12px"><label>اسم القناة (Topic)</label>' +
      '<input class="inp num" value="' + App.esc(c.topic || "") + '" placeholder="daralhikma-x7k2m9" ' +
      'onchange="Notify.set(\'topic\',this.value)">' +
      '<div class="hint">اختر اسماً طويلاً وغريباً — من يعرفه يستطيع قراءة إشعاراتك. مثال جيد: darhikma-9f3k1z</div></div>' +

      '<div class="field" style="margin-bottom:12px"><label>خادم الإشعارات</label>' +
      '<input class="inp num" value="' + App.esc(c.server || "https://ntfy.sh") + '" onchange="Notify.set(\'server\',this.value)">' +
      '<div class="hint">اتركه كما هو إلا إذا كان لديك خادم خاص</div></div>' +

      '<div class="row"><button class="btn primary" onclick="Notify.test()">إرسال إشعار تجريبي</button>' +
      '<button class="btn" onclick="Notify.help()">كيف أستقبلها على هاتفي؟</button></div>' +
      "</div></div>";

    // الأنواع
    h += '<div class="card"><div class="card-head"><h3>ماذا يصلني؟</h3></div><div class="card-body">';
    KINDS.forEach(function (x) {
      var isOn = c.kinds && c.kinds[x.k];
      h += '<label class="notif-row">' +
        '<input type="checkbox" ' + (isOn ? "checked" : "") + ' onchange="Notify.setKind(\'' + x.k + '\',this.checked)">' +
        '<span class="nr-text"><b>' + App.esc(x.t) + "</b><span>" + App.esc(x.d) + "</span></span></label>";
      if (x.k === "bigsale" && isOn) {
        h += '<div class="field" style="margin:4px 0 12px 30px"><label class="small">المبلغ الأدنى للفاتورة الكبيرة</label>' +
          '<input class="inp num" style="max-width:160px" type="number" min="0" value="' + App.num(c.bigAmount || 100) +
          '" onchange="Notify.set(\'bigAmount\',this.value)"></div>';
      }
      if (x.k === "daily" && isOn) {
        h += '<div class="field" style="margin:4px 0 12px 30px"><label class="small">ساعة إرسال الملخص</label>' +
          '<input class="inp num" style="max-width:120px" type="number" min="12" max="23" value="' + App.num(c.dailyHour || 20) +
          '" onchange="Notify.set(\'dailyHour\',this.value)"><div class="hint">بنظام 24 ساعة — 20 تعني الثامنة مساءً</div></div>' +
        '<div class="field full"><label class="chk"><input type="checkbox" ' +
          (c.dailyProfit ? "checked" : "") + ' onchange="Notify.set(\'dailyProfit\',this.checked)"> ' +
          'أرسل الربح أيضاً في الملخص اليومي</label>' +
          '<div class="hint">مطفأ افتراضياً. قناة ntfy يقرأها كل من يعرف اسمها — لا تفعّله إلا إن كان اسم قناتك طويلاً وسرياً.</div></div>';
      }
    });
    h += "</div></div></div>";

    // السجل
    h += '<div class="card" style="margin-top:18px"><div class="card-head"><h3>آخر الإشعارات المرسلة</h3>' +
      '<div class="spacer"></div><span class="muted small">للتأكد من وصولها</span></div>' +
      App.table([
        { h: "الوقت", c: function (l) { return '<span class="num small">' + App.esc(l.at) + "</span>"; } },
        { h: "العنوان", c: function (l) { return '<div class="name">' + App.esc(l.title) + "</div>"; } },
        { h: "التفاصيل", c: function (l) { return '<span class="muted small">' + App.esc(String(l.message || "").slice(0, 60)) + "</span>"; } },
        { h: "الحالة", c: function (l) { return l.ok ? '<span class="badge ok">أُرسل</span>' : '<span class="badge bad">فشل</span>'; } }
      ], (c.log || []).slice(0, 25), {
        emptyIcon: "bell", emptyTitle: "لم يُرسل أي إشعار بعد",
        emptyText: "فعّل الإشعارات واختر أنواعها، ثم جرّب الإشعار التجريبي."
      }) + "</div>";

    return h;
  }

  function help() {
    App.modal({
      title: "استقبال الإشعارات على هاتفك",
      body: '<ol style="line-height:2.1;padding-inline-start:20px;margin:0">' +
        "<li>حمّل تطبيق <b>ntfy</b> من متجر Google Play أو App Store (مجاني).</li>" +
        "<li>افتحه واضغط زر <b>+</b> لإضافة اشتراك.</li>" +
        "<li>اكتب اسم القناة نفسه الذي وضعته هنا بالضبط، ثم اشترك.</li>" +
        "<li>ارجع هنا واضغط «إرسال إشعار تجريبي» — يجب أن يصلك خلال ثوانٍ.</li>" +
        "</ol>" +
        '<p class="muted small" style="line-height:1.8;margin-bottom:0">تنبيه مهم: أي شخص يعرف اسم القناة يستطيع قراءة إشعاراتك، ' +
        "لذلك اختر اسماً طويلاً وغير متوقع ولا تشاركه. الإشعارات لا تحوي أسعار الجملة ولا أرباحك.</p>"
    });
  }

  function set(k, v) {
    var c = cfg();
    if (k === "bigAmount" || k === "dailyHour") v = App.num(v);
    if (k === "topic" || k === "server") v = String(v).trim();
    c[k] = v;
    App.save();
    App.rerender();
  }

  function setKind(k, v) {
    var c = cfg();
    c.kinds = c.kinds || {};
    c.kinds[k] = !!v;
    App.save();
    App.rerender();
  }

  return {
    page: page, test: test, help: help, set: set, setKind: setKind,
    send: send, afterSale: afterSale, snapshotQty: snapshotQty,
    payment: payment, transferRequest: transferRequest, maybeDaily: maybeDaily,
    KINDS: KINDS
  };
})();
