/* ============================================================
   واجهة 4.0 — الربط بين الأجهزة والفروع (قرار 0023)
   ------------------------------------------------------------
   - بطاقة في الإعدادات: «هذا جهاز المحل» أو «جهاز ثانٍ لفرع»، والحالة،
     وما ينتظر جهاز المحل وما رُفض بسببه.
   - شارة في الشريط العلوي: مربوط · آخر تحديث، أو كم ينتظر، أو الخطأ.
   - صفحة «الفروع»: كتب الفروع الأخرى بالبحث (الكمية والسعر والمكان)،
     وزر «إضافة فرع».
   - تلميح «موجود في فرع آخر» حين لا يوجد الكتاب هنا.
   ============================================================ */
var V4Sync = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;
  var status = null, timer = null;

  /* ---------- الحالة ---------- */

  function start() {
    if (timer) clearInterval(timer);
    poll();
    timer = setInterval(poll, 20000);
  }

  /* بعد الخروج لا يُسأل المحرك: ردّه 401 يعيد رسم شاشة الدخول فوق ما يُكتب فيها */
  function poll() {
    if (!V4.me()) {
      var host = document.getElementById("syncChip");
      if (host) host.innerHTML = "";
      return Promise.resolve(status);
    }
    return V4.call("sync.status").then(function (s) {
      status = s;
      paintChip();
      if (document.getElementById("syncCard")) paintCard();
      return s;
    }, function () { return status; });
  }

  function isSecond() { return !!status && status.role === "second"; }

  function time(stamp) { return stamp ? String(stamp).slice(11, 16) : ""; }

  function paintChip() {
    var host = document.getElementById("syncChip");
    if (!host) return;
    var s = status;
    if (!s || (!s.linked && s.role !== "second")) { host.innerHTML = ""; return; }
    var cls = "ok", txt;
    if (s.held || s.code === "held") { cls = "bad"; txt = "الربط موقوف"; }
    else if (s.error) { cls = "warn"; txt = "الربط: لم يكتمل"; }
    else if (!s.linked) { cls = "warn"; txt = "جهاز ثانٍ · بلا ربط"; }
    else if (s.role === "second" && s.waiting > 0) { cls = "warn"; txt = "ينتظر المحل: " + s.waiting; }
    else txt = (s.role === "second" ? "جهاز ثانٍ" : "مربوط") + (s.lastOk ? " · " + time(s.lastOk) : "");
    if (s.failed > 0) { cls = "bad"; txt += " · رُفض " + s.failed; }
    host.innerHTML = '<button class="sync-chip ' + cls + '" title="' + esc(s.error || "") + '" onclick="V4Sync.open()">' +
      App.icon("signal", 13) + esc(txt) + "</button>";
  }

  function open() {
    if (location.hash !== "#/settings") location.hash = "#/settings";
    setTimeout(function () {
      var c = document.getElementById("syncCard");
      if (c) c.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }

  /* ---------- بطاقة الإعدادات ---------- */

  function card() {
    return '<div class="card" id="syncCard" style="margin-bottom:16px"><div class="card-head"><h3>الربط بين الأجهزة والفروع</h3>' +
      '<div class="spacer"></div><span id="syncState"></span></div><div class="card-body"><div class="muted">…</div></div></div>';
  }

  function after() {
    poll();
  }

  function paintCard() {
    var c = document.getElementById("syncCard");
    if (!c || !status) return;
    var s = status, admin = V4.can("settings"), h = "";
    var state = document.getElementById("syncState");
    if (!s.linked && s.role !== "second") {
      if (state) state.innerHTML = '<span class="badge">غير مربوط</span>';
      h += '<p style="margin:0 0 12px;line-height:1.9">اربط أجهزة الفرع ببعض (جهاز المحل وجهازك) والفروع ببعض (مصراتة وطرابلس) ' +
        "عن طريق خادم الربط على Cloudflare (مجاناً):</p>" +
        '<ul class="muted" style="margin:0 0 14px;line-height:1.9;padding-inline-start:20px">' +
        "<li><b>جهاز المحل:</b> يبيع ويبقى الأساسي، ويعمل ولو انقطع الإنترنت.</li>" +
        "<li><b>جهاز ثانٍ:</b> نسخة من جهاز المحل يتزامن معه كل دقيقة، وما تضيفه فيه (كتاب، بيعة) يصل المحل وينفَّذ هناك.</li>" +
        "<li><b>الفروع:</b> كل فرع يرى كتب الآخر بالكمية والسعر من صفحة «الفروع».</li></ul>";
      var shop = V4.shop() || {};
      if (shop.demo === true || shop.demo === "true")
        h += '<p class="badge warn" style="display:block;padding:10px;line-height:1.8;margin:0 0 12px">نسخة تجربة: لا تُربط بخادم الربط ' +
          "الحقيقي، حتى لا تظهر كتب التجربة عند الفرع الآخر. امسح بيانات التجربة أولاً (آخر هذه الصفحة)، ثم اربط.</p>";
      if (admin) {
        h += '<div class="row" style="gap:8px;flex-wrap:wrap">' +
          '<button class="btn primary" onclick="V4Sync.setupMain()">هذا جهاز المحل</button>' +
          '<button class="btn" onclick="V4Sync.setupSecond()">جهاز ثانٍ لفرع مربوط</button>' +
          '<button class="btn ghost" onclick="V4Sync.guide()">تجهيز خادم الربط (مرة واحدة)</button></div>';
      } else h += '<p class="muted">يربطه المدير من هنا.</p>';
      c.querySelector(".card-body").innerHTML = h;
      return;
    }
    var stateTxt = s.held ? '<span class="badge bad">موقوف</span>' : s.error ? '<span class="badge warn">لم يكتمل</span>' :
      !s.linked ? '<span class="badge warn">بلا ربط</span>' : '<span class="badge ok">يعمل</span>';
    if (state) state.innerHTML = stateTxt;
    h += '<div class="kv" style="margin-bottom:14px">' +
      '<span class="k">هذا الجهاز</span><b>' + (s.role === "second" ? "جهاز ثانٍ" : "جهاز المحل (الأساسي)") +
      (s.name ? " · " + esc(s.name) : "") + "</b>" +
      '<span class="k">الفرع</span><span class="num">' + esc(s.branch) + "</span>" +
      (s.role === "second" ? '<span class="k">جهاز المحل</span><span>' + esc(s.main || "—") +
        (s.mainSeen ? ' <span class="muted small">آخر ظهور ' + esc(new Date(s.mainSeen).toLocaleString("ar-LY")) + "</span>" : "") + "</span>" : "") +
      '<span class="k">آخر تحديث</span><span class="num">' + esc(s.lastOk || "لم يتم بعد") + "</span>" +
      (s.phase ? '<span class="k">الآن</span><span>' + esc(s.phase) + "…</span>" : "") +
      (s.behind > 0 ? '<span class="k">يلحق المحل</span><span class="num">' + s.behind + " تغيير</span>" : "") +
      "</div>";
    if (s.held) h += '<p class="badge bad" style="display:block;padding:10px;line-height:1.8">' + esc(s.error) + "</p>";
    else if (s.error) h += '<p class="muted small" style="color:#9a5b00;line-height:1.8;margin:0 0 12px">' + esc(s.error) + "</p>";
    if (!s.linked && s.role === "second")
      h += '<p class="muted small" style="line-height:1.8">الربط موقوف على هذا الجهاز: بياناته للعرض، وما تضيفه ينتظر حتى تربطه من جديد.</p>';
    if (s.role === "second") h += '<div id="syncOutbox" style="margin-bottom:14px"></div>';
    h += '<div class="row" style="gap:8px;flex-wrap:wrap">' +
      (s.linked ? '<button class="btn primary" onclick="V4Sync.now()">حدّث الآن</button>' : "") +
      (admin && s.held ? '<button class="btn" onclick="V4Sync.setupMain()">هذا هو جهاز المحل الصحيح</button>' : "") +
      (admin && !s.linked && s.role === "second" ? '<button class="btn" onclick="V4Sync.setupSecond()">اربطه من جديد</button>' : "") +
      (admin && s.linked ? '<button class="btn ghost" onclick="V4Sync.stop()">أوقف الربط على هذا الجهاز</button>' : "") +
      (admin ? '<button class="btn ghost" onclick="V4Sync.guide()">خادم الربط</button>' : "") +
      "</div>";
    c.querySelector(".card-body").innerHTML = h;
    if (s.role === "second") loadOutbox(document.getElementById("syncOutbox"), null);
  }

  var STATE = { waiting: ["warn", "ينتظر الإرسال"], sent: ["warn", "وصل الخادم، ينتظر المحل"], done: ["ok", "نُفّذ"], failed: ["bad", "رُفض"] };

  /* ما ينتظر جهاز المحل وما رُفض. filter: أوامر بعينها (صفحة الكتب: الأصناف وحدها) */
  function loadOutbox(host, filter) {
    if (!host) return Promise.resolve([]);
    return V4.call("outbox.list").then(function (list) {
      if (filter) list = list.filter(function (o) { return filter.indexOf(o.cmd) >= 0; });
      list = list.filter(function (o) { return o.state !== "done" || !filter; });
      if (!list.length) { host.innerHTML = ""; return list; }
      host.innerHTML = '<div class="card" style="box-shadow:none;border:1px dashed var(--line)"><div class="card-body">' +
        '<b style="display:block;margin-bottom:8px">' + App.icon("send", 15) + " ما أُرسل لجهاز المحل</b>" +
        list.map(function (o) {
          var st = STATE[o.state] || ["", o.state];
          return '<div class="row" style="gap:8px;padding:5px 0;border-top:1px solid var(--line)">' +
            '<span class="badge ' + st[0] + '">' + st[1] + "</span><span>" + esc(o.label) + "</span>" +
            '<span class="muted small num">' + esc(time(o.at)) + "</span>" +
            (o.error ? '<span class="small" style="color:var(--stamp)">' + esc(o.error) + "</span>" : "") +
            '<div class="spacer"></div>' +
            (o.state === "failed" || o.state === "done" ? '<button class="btn sm ghost" onclick="V4Sync.dismiss(' + o.n + ')">إزالة</button>' : "") +
            "</div>";
        }).join("") + "</div></div>";
      return list;
    }, function () { return []; });
  }

  function dismiss(n) {
    V4.run("outbox.dismiss", { n: n }).then(function () { poll(); V4.refresh(); });
  }

  function now() {
    App.toast("يحدّث…");
    V4.run("sync.now").then(function (s) {
      status = s;
      paintChip(); paintCard();
      App.toast(s.error ? s.error : "تم التحديث.", s.error ? "warn" : "ok");
    });
  }

  function stop() {
    App.confirm(isSecond()
      ? "يتوقف التزامن على هذا الجهاز، ويبقى نسخة للعرض: ما تضيفه ينتظر حتى تربطه من جديد."
      : "يتوقف رفع تغييرات المحل، والأجهزة الثانية لا تلحقه حتى تربطه من جديد. بيانات هذا الجهاز لا تتغيّر.",
      function () { V4.run("sync.stop").then(function (s) { status = s; paintChip(); paintCard(); }); },
      { yes: "أوقف الربط", danger: true });
  }

  /* ما نُقل من إعدادات ربط 3.x (عنوان الخادم وكلمة سره) يُعرض جاهزاً */
  function oldLink() {
    return V4.can("settings") ? V4.call("settings.get", { key: "sync" }).catch(function () { return null; }) : Promise.resolve(null);
  }

  function setupMain() {
    oldLink().then(function (old) {
      old = old || {};
      V4.form({
        title: "هذا جهاز المحل",
        values: { url: (status && status.url) || old.url || "", key: old.key || "", name: (status && status.name) || "جهاز المحل" },
        topHtml: '<p class="muted small" style="line-height:1.8;margin:0 0 12px">جهاز المحل واحد لكل فرع: يبيع، ومنه تأخذ الأجهزة الثانية نسختها. ' +
          "خادم الربط يُجهَّز مرة واحدة («تجهيز خادم الربط»)، ونفس العنوان وكلمة السر لكل الأجهزة والفروع.</p>",
        fields: [
          { k: "url", label: "عنوان خادم الربط", required: true, full: true, placeholder: "https://maktaba-sync.اسمك.workers.dev" },
          { k: "key", label: "كلمة سر الربط", required: true },
          { k: "name", label: "اسم هذا الجهاز", placeholder: "مثلاً: كمبيوتر المحل" }
        ],
        saveLabel: "اربط",
        onSave: function (v) { return setup({ role: "main", url: v.url, key: v.key, name: v.name }); }
      });
    });
  }

  function setupSecond() {
    oldLink().then(function (old) {
      old = old || {};
      V4.form({
        title: "جهاز ثانٍ لفرع مربوط",
        values: { url: (status && status.url) || old.url || "", key: old.key || "", branch: (status && status.branch) || (status && status.shopBranch) || "", name: "" },
        topHtml: '<p class="muted small" style="line-height:1.8;margin:0 0 12px">جهاز المحل يكون مربوطاً قبله. قاعدة هذا الجهاز تصير ' +
          "نسخة منه (وما عليها الآن يبقى في مجلد backups)، ثم يتزامن معه كل دقيقة.</p>",
        fields: [
          { k: "url", label: "عنوان خادم الربط", required: true, full: true, placeholder: "https://maktaba-sync.اسمك.workers.dev" },
          { k: "key", label: "كلمة سر الربط", required: true },
          { k: "branch", label: "رمز الفرع", required: true, hint: "كما في جهاز المحل: misrata أو tripoli" },
          { k: "name", label: "اسم هذا الجهاز", placeholder: "مثلاً: لابتوب حسن" }
        ],
        saveLabel: "اربط",
        onSave: function (v) { return setup({ role: "second", url: v.url, key: v.key, branch: v.branch, name: v.name }); }
      });
    });
  }

  /* الخطأ يُعرض ويبقى النموذج. جهاز محل آخر مسجّل، أو بيانات تُستبدل: يُسأل صاحبها */
  function setup(body) {
    App.toast(body.role === "second" ? "يحمّل نسخة جهاز المحل…" : "يتصل بخادم الربط…");
    return V4.call("sync.setup", body).then(function () {
      if (body.role === "second") {
        App.toast("رُبط. يُعاد فتح البرنامج على نسخة جهاز المحل…", "ok");
        setTimeout(function () { location.reload(); }, 700);
        return;
      }
      App.toast("رُبط. يرفع نسخته الأولى…", "ok");
      return V4.call("sync.now").then(function (s) {
        status = s; paintChip(); paintCard();
        if (s.error) App.toast(s.error, "warn");
      });
    }, function (e) {
      if (e.code === "main-taken") {
        App.confirm(e.message + " هل هذا الجهاز بديله فعلاً؟", function () {
          body.force = true;
          setup(body);
        }, { yes: "نعم، هذا جهاز المحل الآن", danger: true });
      } else if (e.code === "has-data") {
        App.confirm(e.message + " متأكد؟", function () {
          body.replace = true;
          setup(body);
        }, { yes: "استبدل واربط", danger: true });
      } else App.toast(e.message, "bad");
      return false;
    });
  }

  function guide() {
    V4.call("sync.worker").then(function (w) {
      var steps = (w.code.match(/خطوات الرفع[\s\S]*?={10,}/) || [""])[0].replace(/={10,}$/, "");
      App.modal({
        title: "تجهيز خادم الربط (مرة واحدة)",
        size: "wide",
        body: '<pre style="white-space:pre-wrap;line-height:1.8;font-family:inherit;margin:0 0 12px">' + esc(steps) + "</pre>" +
          '<p class="muted small" style="margin:0">في الخطوة 4 الصق «كود الخادم». إن كان الخادم مجهَّزاً من قبل لـ 3.x فحدّث كوده بهذا ' +
          "وأضف قاعدة D1 (الخطوة 5): الربط القديم للتلفون وموقع المكتبة يبقى يعمل.</p>",
        actions: [{ label: "انسخ كود الخادم", kind: "primary", click: function () { copy(w.code, "نُسخ كود الخادم."); } }]
      });
    });
  }

  function copy(text, done) {
    var t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    try { document.execCommand("copy"); App.toast(done, "ok"); }
    catch (e) { App.toast("انسخه بيدك.", "warn"); }
    t.remove();
  }

  /* ---------- صفحة الفروع ---------- */

  var q = "", seq = 0, wait = null;

  function branchesPage() {
    return '<div class="toolbar">' +
      '<input class="inp search" id="brQ" placeholder="ابحث في كتب الفروع الأخرى بالاسم أو المؤلف أو الباركود…" autocomplete="off" value="' + esc(q) +
      '" oninput="V4Sync.search(this.value)">' +
      '<button class="btn" onclick="V4Sync.addBranch()">+ إضافة فرع</button></div>' +
      '<div id="brList" class="grid g3" style="margin-bottom:16px"></div>' +
      '<div class="card"><div id="brBody"><div class="card-body muted">اكتب اسم كتاب أو مؤلفه للبحث في كل الفروع.</div></div></div>';
  }

  function branchesAfter() {
    var input = document.getElementById("brQ");
    if (input) input.focus();
    V4.call("branches.list").then(function (list) {
      var host = document.getElementById("brList");
      if (!host) return;
      if (!list.length) {
        host.className = "";
        host.innerHTML = '<div class="card"><div class="card-body" style="line-height:1.9">' +
          "<b>لا فروع مربوطة بعد.</b> " + (status && status.linked ? "حين يربط فرع آخر جهاز محله بنفس خادم الربط يظهر هنا خلال دقائق."
            : "اربط هذا الجهاز أولاً من الإعدادات ← الربط بين الأجهزة والفروع.") + "</div></div>";
        return;
      }
      host.innerHTML = list.map(function (b) {
        return '<div class="card stat"><div class="lbl">' + esc(b.city || "") + "</div>" +
          '<div class="val" style="font-size:22px">' + esc(b.name || b.id) + "</div>" +
          '<div class="foot">' + b.items + " صنف · " + b.pieces + " قطعة · آخر تحديث " + esc(b.at || "—") + "</div></div>";
      }).join("");
    }).catch(function (e) { App.toast(e.message, "bad"); });
    if (q.trim()) load();
  }

  function search(v) {
    q = v;
    if (wait) clearTimeout(wait);
    wait = setTimeout(load, 180);
  }

  function load() {
    var my = ++seq;
    var body = document.getElementById("brBody");
    if (!q.trim()) { if (body) body.innerHTML = '<div class="card-body muted">اكتب اسم كتاب أو مؤلفه للبحث في كل الفروع.</div>'; return; }
    V4.call("branch.search", { q: App.digits(q), limit: 100 }).then(function (rows) {
      if (my !== seq) return;
      body = document.getElementById("brBody");
      if (!body) return;
      body.innerHTML = rows.length ? App.table([
        { h: "الفرع", c: function (r) { return "<b>" + esc(r.branchName) + "</b>"; } },
        { h: "الاسم", c: function (r) { return '<b class="name">' + esc(r.title) + "</b>" + (r.barcode ? '<div class="muted small num">' + esc(r.barcode) + "</div>" : ""); } },
        { h: "المؤلف / الماركة", c: function (r) { return esc(r.author); } },
        { h: "في المحل", c: function (r) { return '<span class="badge ' + (r.qty > 0 ? "ok" : "bad") + '">' + r.qty + "</span>"; } },
        { h: "في المخازن", cls: "num", c: function (r) { return r.store ? String(r.store) : "—"; } },
        { h: "السعر", cls: "num", c: function (r) { return money(r.price); } },
        { h: "المكان", c: function (r) { return '<span class="place-path">' + esc(r.place) + "</span>"; } }
      ], rows) : App.table([], [], { emptyIcon: "search", emptyTitle: "لا شيء في الفروع الأخرى يطابق «" + q.trim() + "»", emptyText: "" });
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function addBranch() {
    var admin = V4.can("settings");
    var link = status && status.url ? status.url : "";
    App.modal({
      title: "إضافة فرع",
      body: '<ol style="line-height:2;margin:0 0 12px;padding-inline-start:20px">' +
        "<li>ثبّت على جهاز محل الفرع الآخر تطبيقه (منظومة طرابلس أو منظومة مصراتة).</li>" +
        "<li>فيه: الإعدادات ← الربط بين الأجهزة والفروع ← <b>هذا جهاز المحل</b>.</li>" +
        "<li>اكتب <b>نفس عنوان خادم الربط ونفس كلمة السر</b> اللذين هنا.</li>" +
        "<li>يظهر الفرع هنا وحده خلال دقائق، بكتبه وكمياتها وأسعارها، ويتحدّث كل 10 دقائق.</li></ol>" +
        (link ? '<div class="kv"><span class="k">عنوان خادم الربط</span><span class="num" dir="ltr" style="text-align:right">' + esc(link) + "</span></div>"
          : '<p class="muted">اربط هذا الجهاز أولاً من الإعدادات.</p>'),
      actions: link && admin ? [{ label: "انسخ العنوان", kind: "primary", click: function () { copy(link, "نُسخ العنوان."); } }] : []
    });
  }

  /* «موجود في فرع آخر»: حين لا يوجد الكتاب هنا */
  function hint(text, host) {
    if (!host) return;
    text = (text || "").trim();
    host.innerHTML = "";
    host.setAttribute("data-q", text);
    if (text.length < 2 || !V4.can("search")) return;
    V4.call("branch.search", { q: App.digits(text), limit: 4 }).then(function (rows) {
      /* رد بحث أقدم وصل بعد الأحدث: يُتجاهل */
      if (!host.isConnected || host.getAttribute("data-q") !== text) return;
      rows = rows.filter(function (r) { return r.qty + r.store > 0; });
      if (!rows.length) return;
      host.innerHTML = '<div class="branch-hint">' + App.icon("store", 14) +
        " في الفروع الأخرى: " + rows.map(function (r) {
          return "<b>" + esc(r.title) + "</b> — " + esc(r.branchName) + " (" + (r.qty + r.store) + " · " + money(r.price) + ")";
        }).join(" · ") + "</div>";
    }, function () { });
  }

  V4.page({ o: 45, g: "المخزون", k: "branches", t: "الفروع", ic: "store", perm: "search", render: branchesPage, after: branchesAfter });

  return {
    start: start, poll: poll, isSecond: isSecond, open: open, card: card, after: after, loadOutbox: loadOutbox,
    dismiss: dismiss, now: now, stop: stop, setupMain: setupMain, setupSecond: setupSecond, guide: guide,
    search: search, addBranch: addBranch, hint: hint, status: function () { return status; }
  };
})();
