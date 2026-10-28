/* ============================================================
   واجهة 4.0 — الإشعارات على الهاتف (ntfy)
   ------------------------------------------------------------
   كما في 3.x: القناة والخادم، وماذا يصلك، وإشعار تجريبي، وآخر ما أُرسل.
   الفرق (قرار 0024): المحرك يرسلها حيث يُنفَّذ البيع، لا الشاشة. فبيعة
   الجهاز الثاني يصل إشعارها مرة واحدة من جهاز المحل. الإعداد نفسه الذي
   كان في 3.x (يُنقل كما هو).
   ============================================================ */
var V4Notify = (function () {
  "use strict";
  var esc = App.esc;
  var cfg = null;

  var KINDS = [
    { k: "low", t: "صنف قارب على النفاد", d: "عند وصول أي صنف إلى حد التنبيه الذي حددته له" },
    { k: "out", t: "صنف نفد تماماً", d: "عند وصول الكمية في المحل إلى صفر" },
    { k: "sale", t: "كل عملية بيع", d: "إشعار بعد كل فاتورة — قد يكون كثيراً في المحل المزدحم" },
    { k: "bigsale", t: "فاتورة كبيرة فقط", d: "عند تجاوز الفاتورة المبلغ الذي تحدده بالأسفل" },
    { k: "debt", t: "بيع بالآجل (دين جديد)", d: "عند تسجيل دين جديد على زبون" },
    { k: "pay", t: "تسديد دين", d: "عند استلام تسديد من زبون" },
    { k: "daily", t: "ملخص آخر اليوم", d: "إجمالي مبيعات اليوم بعد الساعة التي تحددها، مرة في اليوم" }
  ];

  function page() { return '<div id="ntHost"><div class="muted">…</div></div>'; }

  function after() { load(); }

  function load() {
    return V4.call("notify.get").then(function (c) { cfg = c || {}; paint(); }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function on() { return !!(cfg.enabled && cfg.topic); }

  function paint() {
    var host = document.getElementById("ntHost");
    if (!host || !cfg) return;
    var kinds = cfg.kinds || {};
    var h = '<div class="grid g2">' +
      '<div class="card"><div class="card-head"><h3>إعداد الإشعارات</h3><div class="spacer"></div>' +
      (on() ? '<span class="badge ok">مفعّلة</span>' : '<span class="badge">غير مفعّلة</span>') + "</div><div class=\"card-body\">" +
      '<p class="muted small" style="margin-top:0;line-height:1.8">تصلك الإشعارات على هاتفك عبر تطبيق ntfy المجاني. لا يحتاج حساباً ولا اشتراكاً — فقط اسم قناة سرّي تختاره أنت.</p>' +
      '<div class="field" style="margin-bottom:12px"><label for="ntOn">تفعيل الإشعارات</label>' +
      '<select class="inp" id="ntOn" onchange="V4Notify.set(\'enabled\',this.value===\'yes\')">' +
      '<option value="no"' + (!cfg.enabled ? " selected" : "") + ">موقوفة</option>" +
      '<option value="yes"' + (cfg.enabled ? " selected" : "") + ">مفعّلة</option></select></div>" +
      '<div class="field" style="margin-bottom:12px"><label for="ntTopic">اسم القناة (Topic)</label>' +
      '<input class="inp num" id="ntTopic" value="' + esc(cfg.topic || "") + '" placeholder="daralhikma-x7k2m9" onchange="V4Notify.set(\'topic\',this.value)">' +
      '<div class="hint">اختر اسماً طويلاً وغريباً — من يعرفه يستطيع قراءة إشعاراتك. مثال جيد: darhikma-9f3k1z</div></div>' +
      '<div class="field" style="margin-bottom:12px"><label for="ntServer">خادم الإشعارات</label>' +
      '<input class="inp num" id="ntServer" value="' + esc(cfg.server || "https://ntfy.sh") + '" onchange="V4Notify.set(\'server\',this.value)">' +
      '<div class="hint">اتركه كما هو إلا إذا كان لديك خادم خاص</div></div>' +
      '<div class="row"><button class="btn primary" id="ntTest" onclick="V4Notify.test()">إرسال إشعار تجريبي</button>' +
      '<button class="btn" onclick="V4Notify.help()">كيف أستقبلها على هاتفي؟</button></div>' +
      "</div></div>" +
      '<div class="card"><div class="card-head"><h3>ماذا يصلني؟</h3></div><div class="card-body">';
    KINDS.forEach(function (x) {
      var isOn = !!kinds[x.k];
      h += '<label class="notif-row"><input type="checkbox" data-kind="' + x.k + '"' + (isOn ? " checked" : "") +
        ' onchange="V4Notify.kind(\'' + x.k + '\',this.checked)"><span class="nr-text"><b>' + esc(x.t) + "</b><span>" + esc(x.d) + "</span></span></label>";
      if (x.k === "bigsale" && isOn) {
        h += '<div class="field" style="margin:4px 0 12px;margin-inline-start:30px"><label class="small" for="ntBig">المبلغ الأدنى للفاتورة الكبيرة</label>' +
          '<input class="inp num" id="ntBig" style="max-width:160px" inputmode="decimal" value="' + App.num(cfg.bigAmount === undefined ? 100 : cfg.bigAmount) +
          '" onchange="V4Notify.set(\'bigAmount\',V4Notify.n(this.value))"></div>';
      }
      if (x.k === "daily" && isOn) {
        h += '<div class="field" style="margin:4px 0 12px;margin-inline-start:30px"><label class="small" for="ntHour">ساعة إرسال الملخص</label>' +
          '<input class="inp num" id="ntHour" style="max-width:120px" inputmode="numeric" value="' + App.num(cfg.dailyHour === undefined ? 20 : cfg.dailyHour) +
          '" onchange="V4Notify.set(\'dailyHour\',Math.min(23,Math.max(0,Math.round(V4Notify.n(this.value)))))">' +
          '<div class="hint">بنظام 24 ساعة — 20 تعني الثامنة مساءً</div></div>' +
          '<div class="field" style="margin:0 0 12px;margin-inline-start:30px"><label class="chk"><input type="checkbox" id="ntProfit"' + (cfg.dailyProfit ? " checked" : "") +
          ' onchange="V4Notify.set(\'dailyProfit\',this.checked)"> أرسل الربح أيضاً في الملخص اليومي</label>' +
          '<div class="hint">مطفأ افتراضياً. قناة ntfy يقرأها كل من يعرف اسمها — لا تفعّله إلا إن كان اسم قناتك طويلاً وسرياً.</div></div>';
      }
    });
    h += "</div></div></div>" +
      '<div class="card" style="margin-top:18px"><div class="card-head"><h3>آخر الإشعارات المرسلة</h3><div class="spacer"></div>' +
      '<span class="muted small">للتأكد من وصولها</span></div>' +
      App.table([
        { h: "الوقت", c: function (l) { return '<span class="num small">' + esc(l.at) + "</span>"; } },
        { h: "العنوان", c: function (l) { return "<b>" + esc(l.title) + "</b>"; } },
        { h: "التفاصيل", c: function (l) { return '<span class="muted small">' + esc(String(l.message || "").slice(0, 60)) + "</span>"; } },
        { h: "الحالة", c: function (l) {
          return l.ok ? '<span class="badge ok">أُرسل</span>' : '<span class="badge bad" title="' + esc(l.error || "") + '">فشل</span>'; } }
      ], cfg.log || [], {
        emptyIcon: "bell", emptyTitle: "لم يُرسل أي إشعار بعد",
        emptyText: "فعّل الإشعارات واختر أنواعها، ثم جرّب الإشعار التجريبي."
      }) + "</div>";
    host.innerHTML = h;
  }

  function n(v) { return App.num(v); }

  /* كل تغيير أمر واحد. على الجهاز الثاني يُرسل لجهاز المحل (حيث تُرسل الإشعارات أصلاً) */
  function save(body, what) {
    return V4.run("notify.set", body).then(function (r) {
      if (V4.queued(r, what)) return;
      return load();
    }).catch(function () { return load(); });
  }

  function set(k, v) {
    var b = {};
    b[k] = v;
    save(b, "إعداد الإشعارات");
  }

  function kind(k, v) {
    var kinds = {};
    Object.keys(cfg.kinds || {}).forEach(function (x) { kinds[x] = cfg.kinds[x]; });
    kinds[k] = !!v;
    save({ kinds: kinds }, "إعداد الإشعارات");
  }

  function test() {
    var topic = document.getElementById("ntTopic"), server = document.getElementById("ntServer");
    var t = topic ? topic.value.trim() : cfg.topic;
    if (!t) { App.toast("اكتب اسم القناة أولاً.", "warn"); return; }
    var btn = document.getElementById("ntTest");
    if (btn) btn.disabled = true;
    V4.run("notify.test", { topic: t, server: server ? server.value.trim() : cfg.server }).then(function () {
      App.toast("أُرسل الإشعار. تحقّق من هاتفك.", "ok");
    }).catch(function () { }).then(function () {
      if (btn) btn.disabled = false;
      load();
    });
  }

  function help() {
    App.modal({
      title: "استقبال الإشعارات على هاتفك",
      body: '<ol style="line-height:2.1;padding-inline-start:20px;margin:0">' +
        "<li>حمّل تطبيق <b>ntfy</b> من متجر Google Play أو App Store (مجاني).</li>" +
        "<li>افتحه واضغط زر <b>+</b> لإضافة اشتراك.</li>" +
        "<li>اكتب اسم القناة نفسه الذي وضعته هنا بالضبط، ثم اشترك.</li>" +
        "<li>ارجع هنا واضغط «إرسال إشعار تجريبي» — يجب أن يصلك خلال ثوانٍ.</li></ol>" +
        '<p class="muted small" style="line-height:1.8;margin-bottom:0">تنبيه مهم: أي شخص يعرف اسم القناة يستطيع قراءة إشعاراتك، ' +
        "لذلك اختر اسماً طويلاً وغير متوقع ولا تشاركه. الإشعارات لا تحوي أسعار الشراء ولا أرباحك (إلا الربح في الملخص إن اخترته).</p>"
    });
  }

  V4.page({ o: 85, g: "أخرى", k: "notify", t: "الإشعارات", ic: "signal", perm: "settings", render: page, after: after });

  return { set: set, kind: kind, test: test, help: help, n: n, KINDS: KINDS };
})();
