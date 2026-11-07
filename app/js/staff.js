/* ============================================================
   staff.js — الموظفون وتسجيل الدخول والصلاحيات والسجلات والأجهزة (X4)
   ------------------------------------------------------------
   لطرابلس وحدها (App.isX4)، ولا يعمل إلا بعد أن يفعّله المدير من صفحة
   «الموظفون» بإنشاء حسابه: قبل ذلك المنظومة كما هي تماماً، بلا دخول.
   - الموظفون والأدوار في بيانات المحل (S.staff، S.roles) فتصل كل الأجهزة.
     كلمة السر لا تُحفظ: بصمتها PBKDF2-SHA256 بملح لكل موظف.
   - من يعمل الآن على هذا الجهاز في الذاكرة فقط: إعادة فتح البرنامج تسأل
     عن الدخول من جديد، وكذلك القفل التلقائي بعد مدة غياب يحددها المدير.
   - الصلاحية تُخفي الصفحة من الشريط الجانبي، وتوقف العمل الحساس (الحذف،
     الإرجاع، الخصم، تعديل الفاتورة...) إلا بإذن: موظف عنده الصلاحية يكتب
     كلمة سره فيمرّ ذلك العمل وحده، ويُسجَّل من أذن.
   - كل حركة في السجل وكل فاتورة تحمل اسم الموظف والجهاز.
   ============================================================ */

var Staff = (function () {

  function S() { return App.S; }

  var PERMS = [
    { g: "البيع", list: [
      ["sell", "البيع وجرد المبيعات وإقفال اليوم"], ["return", "الإرجاع"], ["discount", "الخصم في الفاتورة"],
      ["invoice_edit", "تعديل الفواتير"], ["invoices", "سجل الفواتير"]] },
    { g: "المخزون", list: [
      ["items", "إضافة الكتب والقرطاسية وتعديل بياناتها"], ["price", "تعديل الأسعار وسعر الشراء"],
      ["price_zero", "تسعير الكتاب الصفري عند البيع"], ["goods", "إدخال البضاعة والتنبيهات"], ["count", "جرد المخزون"],
      ["labels", "طباعة اللاصقات"], ["stock", "المخزون والفروع وطلبات التحويل"]] },
    { g: "الحسابات", list: [
      ["debts", "الزبائن والموردون والديون"], ["pay", "تسجيل التسديد"], ["consign", "كتب على المباع"],
      ["profits", "الأرباح والتقارير"], ["stale", "البضاعة الراكدة"]] },
    { g: "الإدارة", list: [
      ["delete", "الحذف"], ["settings", "الإعدادات والإشعارات"], ["staff", "الموظفون والصلاحيات"],
      ["logs", "السجلات"], ["devices", "الأجهزة"]] }
  ];
  var PERM_NAME = {};
  PERMS.forEach(function (g) { g.list.forEach(function (p) { PERM_NAME[p[0]] = p[1]; }); });

  var ROLES0 = [
    { id: "r-admin", name: "مدير", admin: true, perms: [] },
    { id: "r-cashier", name: "كاشير", perms: ["sell", "invoices", "price_zero", "pay"] },
    { id: "r-store", name: "أمين مخزن", perms: ["items", "goods", "count", "labels", "stock", "invoices"] },
    { id: "r-reg", name: "مسجّل كتب", perms: ["items", "count", "labels"] }
  ];

  var me = null;                 // من يعمل الآن على هذا الجهاز
  var lastAct = Date.now();
  var once = {};                 // إذن لمرة واحدة: الصلاحية ← true
  var lockEl = null;

  /* ---------- الحالة ---------- */

  function list() { return (S() && S().staff) || []; }
  function roles() { return (S() && S().roles && S().roles.length) ? S().roles : ROLES0; }
  function role(id) { var r = null; roles().forEach(function (x) { if (x.id === id) r = x; }); return r; }
  function person(id) { var r = null; list().forEach(function (x) { if (x.id === id) r = x; }); return r; }
  function on() { return !!(App.isX4 && App.isX4() && S() && S().meta && S().meta.staffOn && list().length); }
  function current() { return on() ? me : null; }

  function canOf(p, perm) {
    if (!p || p.active === false) return false;
    var r = role(p.role);
    if (!r) return false;
    if (r.admin) return true;
    return (r.perms || []).indexOf(perm) >= 0;
  }

  /* قبل التفعيل كل شيء مسموح كما كان */
  function can(perm) {
    if (!on()) return true;
    if (!me) return false;
    if (Array.isArray(perm)) return perm.some(function (x) { return canOf(me, x); });
    return canOf(me, perm);
  }

  /* عمل حساس: مسموح، أو إذن من موظف عنده الصلاحية ثم retry */
  function allow(perm, retry) {
    if (can(perm)) return true;
    if (once[perm]) { delete once[perm]; return true; }
    approve(perm, function () { once[perm] = true; if (retry) retry(); });
    return false;
  }

  /* ---------- كلمات السر ---------- */

  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function unhex(h) {
    var a = new Uint8Array(h.length / 2);
    for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
    return a;
  }
  function salt() { var a = new Uint8Array(16); crypto.getRandomValues(a); return hex(a); }
  function hashPw(pw, sl) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(String(pw)), "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", salt: unhex(sl), iterations: 60000, hash: "SHA-256" }, k, 256);
    }).then(hex);
  }
  function check(p, pw) {
    if (!p || !p.salt || !p.hash) return Promise.resolve(false);
    return hashPw(pw, p.salt).then(function (h) { return h === p.hash; });
  }
  function setPw(p, pw) {
    var sl = salt();
    return hashPw(pw, sl).then(function (h) { p.salt = sl; p.hash = h; });
  }
  function recoveryCode() {
    var A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", a = new Uint8Array(12), s = "";
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) { s += A[a[i] % A.length]; if (i === 3 || i === 7) s += "-"; }
    return s;
  }

  /* ---------- الجهاز ---------- */

  function devName() {
    var n = "";
    try { n = localStorage.getItem("qi-device-name") || ""; } catch (e) { }
    return n || "هذا الجهاز";
  }
  function setDevName(n) {
    try { localStorage.setItem("qi-device-name", String(n || "").trim()); } catch (e) { }
  }

  /* ما يُضاف لكل حركة وفاتورة */
  function stamp(o) {
    if (!on()) return o;
    if (me) { o.by = me.id; o.byName = me.name; }
    o.dev = devName();
    return o;
  }

  /* ---------- الدخول والقفل ---------- */

  function boot() {
    ["mousedown", "keydown", "touchstart"].forEach(function (ev) {
      document.addEventListener(ev, function () { lastAct = Date.now(); }, true);
    });
    setInterval(function () {
      var m = S() && S().meta && +S().meta.lockMin;
      if (on() && me && m > 0 && Date.now() - lastAct > m * 60000) lock();
    }, 15000);
    if (on()) showLogin();
    paintWho();
  }

  function lock() {
    if (!on()) return;
    /* نافذة كانت مفتوحة لا تبقى فوق القفل يعمل فيها أحد بلا دخول */
    for (var i = 0; i < 20 && document.querySelector("#modalHost .overlay:not(.staff-lock)"); i++) App.closeTop();
    if (me) App.log("خروج", me.name);
    me = null;
    App.save();
    afterChange();
    showLogin();
  }

  function enter(p) {
    me = p;
    once = {};
    lastAct = Date.now();
    p.lastLogin = App.nowStamp();
    App.log("دخول", p.name);
    App.save();
    hideLogin();
    afterChange();
  }

  function afterChange() {
    paintWho();
    if (App.rebuildNav) App.rebuildNav();
    App.rerender();
  }

  function hideLogin() { if (lockEl) { lockEl.remove(); lockEl = null; } }

  function showLogin(pick) {
    hideLogin();
    var people = list().filter(function (p) { return p.active !== false; });
    lockEl = document.createElement("div");
    lockEl.className = "overlay staff-lock";
    var shop = App.esc((S().branch && S().branch.name) || S().meta.shopName || "");
    var h = '<div class="modal staff-box"><div class="m-head"><h3>' + shop + '</h3></div><div class="m-body">';
    if (!pick) {
      h += '<p class="muted" style="margin:0 0 12px">اختر اسمك</p><div class="staff-who">' +
        people.map(function (p) {
          var r = role(p.role);
          return '<button class="btn staff-tile" onclick="Staff.pick(\'' + p.id + '\')"><b>' + App.esc(p.name) + "</b>" +
            '<span class="muted small">' + App.esc(r ? r.name : "") + "</span></button>";
        }).join("") + "</div>";
    } else {
      var p = person(pick);
      h += '<p style="margin:0 0 10px"><b>' + App.esc(p ? p.name : "") + "</b></p>" +
        '<input class="inp" type="password" id="stPw" placeholder="كلمة السر" autocomplete="off">' +
        '<div class="row" style="margin-top:12px;gap:8px">' +
        '<button class="btn primary" id="stGo" onclick="Staff.login(\'' + pick + '\')">دخول</button>' +
        '<button class="btn ghost" onclick="Staff.showLogin()">رجوع</button>' +
        '<div class="spacer"></div>' +
        (p && role(p.role) && role(p.role).admin ? '<button class="btn ghost sm" onclick="Staff.forgot(\'' + pick + '\')">نسيت كلمة السر؟</button>' : "") +
        "</div>";
    }
    h += "</div></div>";
    lockEl.innerHTML = h;
    /* في مكان النوافذ نفسه: نافذة تُفتح منه («نسيت كلمة السر») تظهر فوقه */
    var host = document.getElementById("modalHost");
    if (host) host.insertBefore(lockEl, host.firstChild); else document.body.appendChild(lockEl);
    var pw = lockEl.querySelector("#stPw");
    if (pw) {
      setTimeout(function () { pw.focus(); }, 50);
      pw.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); login(pick); } });
    }
  }

  function pick(id) { showLogin(id); }

  function login(id) {
    var p = person(id), el = document.getElementById("stPw");
    if (!p || !el) return;
    var pw = el.value;
    check(p, pw).then(function (ok) {
      if (!ok) {
        App.toast("كلمة السر غير صحيحة.", "bad");
        App.log("دخول فاشل", p.name);
        el.value = ""; el.focus();
        return;
      }
      enter(p);
    });
  }

  /* المدير نسي كلمة سره: رمز الاسترجاع الذي ظهر له عند التفعيل */
  function forgot(id) {
    var p = person(id);
    App.form({
      title: "استرجاع كلمة سر المدير",
      fields: [
        { k: "code", label: "رمز الاسترجاع", required: true, hint: "الرمز الذي ظهر عند تفعيل الموظفين (مثل ABCD-EFGH-JKLM)" },
        { k: "pw", label: "كلمة السر الجديدة", type: "password", required: true },
        { k: "pw2", label: "أعدها", type: "password", required: true }
      ],
      onSave: function (v) {
        var rec = S().meta.staffRecovery || {};
        if (String(v.pw).length < 4) { App.toast("كلمة السر 4 أحرف على الأقل.", "warn"); return false; }
        if (v.pw !== v.pw2) { App.toast("كلمتا السر مختلفتان.", "warn"); return false; }
        var code = String(v.code || "").toUpperCase().replace(/\s+/g, "");
        hashPw(code, rec.salt || "00").then(function (h) {
          if (!rec.hash || h !== rec.hash) { App.toast("رمز الاسترجاع غير صحيح.", "bad"); App.log("استرجاع فاشل", p.name); return; }
          App.closeTop();
          return setPw(p, v.pw).then(function () {
            App.log("استرجاع كلمة سر", p.name);
            App.toast("تغيّرت كلمة السر. ادخل بها الآن.", "ok");
            App.save();
            showLogin(id);
          });
        });
        return false;
      }
    });
  }

  /* إذن لعمل واحد من موظف عنده الصلاحية */
  function approve(perm, done) {
    if (!on()) { done(); return; }
    var who = list().filter(function (p) { return canOf(p, perm); });
    if (!who.length) { App.toast("لا أحد عنده صلاحية «" + (PERM_NAME[perm] || perm) + "».", "bad"); return; }
    App.form({
      title: "يحتاج إذن",
      topHtml: '<p style="margin:0 0 10px;line-height:1.9">«' + App.esc(PERM_NAME[perm] || perm) + "» ما هي من صلاحياتك" +
        (me ? " يا " + App.esc(me.name) : "") + ". موظف عنده الصلاحية يكتب كلمة سره فيمرّ هذا العمل وحده.</p>",
      fields: [
        { k: "who", label: "الموظف", type: "select", options: who.map(function (p) { return { v: p.id, t: p.name }; }) },
        { k: "pw", label: "كلمة السر", type: "password", required: true }
      ],
      values: { who: who[0].id },
      saveLabel: "أذنت",
      onSave: function (v) {
        var p = person(v.who);
        check(p, v.pw).then(function (ok) {
          if (!ok) { App.toast("كلمة السر غير صحيحة.", "bad"); return; }
          App.closeTop();
          App.log("إذن", (PERM_NAME[perm] || perm) + " — أذن " + p.name + (me ? " لـ" + me.name : ""));
          done();
        });
        return false;
      }
    });
  }

  /* اسم من يعمل الآن في الشريط العلوي، ومنه التبديل والقفل */
  function paintWho() {
    var bar = document.getElementById("topbar");
    if (!bar) return;
    var el = document.getElementById("whoChip");
    if (!on() || !me) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("button");
      el.id = "whoChip";
      el.className = "btn ghost sm who-chip";
      el.onclick = function () { menu(); };
      var clock = document.getElementById("clock");
      bar.insertBefore(el, clock);
    }
    var r = role(me.role);
    el.innerHTML = App.icon("people", 16) + "<span>" + App.esc(me.name) + '</span><span class="muted small">' + App.esc(r ? r.name : "") + "</span>";
  }

  function menu() {
    App.modal({
      title: me ? me.name : "",
      size: "narrow",
      body: '<p class="muted" style="margin:0 0 12px">' + App.esc(devName()) + "</p>" +
        '<div class="row" style="gap:8px;flex-wrap:wrap">' +
        '<button class="btn primary" onclick="App.closeTop(); Staff.lock()">تبديل الموظف</button>' +
        '<button class="btn" onclick="App.closeTop(); Staff.changeMine()">تغيير كلمة سري</button></div>',
      foot: false
    });
  }

  function changeMine() {
    if (!me) return;
    App.form({
      title: "تغيير كلمة سري",
      fields: [
        { k: "old", label: "كلمة السر الحالية", type: "password", required: true },
        { k: "pw", label: "الجديدة", type: "password", required: true },
        { k: "pw2", label: "أعدها", type: "password", required: true }
      ],
      onSave: function (v) {
        if (String(v.pw).length < 4) { App.toast("كلمة السر 4 أحرف على الأقل.", "warn"); return false; }
        if (v.pw !== v.pw2) { App.toast("كلمتا السر مختلفتان.", "warn"); return false; }
        var p = me;
        check(p, v.old).then(function (ok) {
          if (!ok) { App.toast("كلمة السر الحالية غير صحيحة.", "bad"); return; }
          App.closeTop();
          return setPw(p, v.pw).then(function () { App.log("تغيير كلمة السر", p.name); App.save(); App.toast("تغيّرت كلمة سرك.", "ok"); });
        });
        return false;
      }
    });
  }

  /* ============================================================
     صفحة الموظفين
     ============================================================ */

  function page() {
    if (!on()) {
      return '<div class="card" style="max-width:760px"><div class="card-head"><h3>الموظفون والصلاحيات</h3></div>' +
        '<p style="line-height:2;margin:0 0 10px">لكل موظف اسم وكلمة سر، ولكل دور صلاحيات: الكاشير يبيع، وأمين المخزن يُدخل البضاعة ويجرد، ' +
        "والمدير يرى كل شيء. كل فاتورة وكل حركة تُسجَّل باسم من قام بها ومن أي جهاز.</p>" +
        '<p class="muted" style="line-height:1.9;margin:0 0 14px">ابدأ بحساب المدير. بعده تُسأل كلمة السر عند فتح البرنامج على كل الأجهزة.</p>' +
        '<button class="btn primary" onclick="Staff.setup()">فعّل الموظفين — أنشئ حساب المدير</button></div>';
    }
    var people = list();
    var h = '<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>الموظفون</h3><div class="spacer"></div>' +
      '<button class="btn primary sm" onclick="Staff.edit()">+ موظف</button></div>' +
      App.table([
        { h: "الاسم", c: function (p) { return '<div class="name">' + App.esc(p.name) + '</div><div class="sub">' + App.esc(p.user || "") + "</div>"; } },
        { h: "الدور", c: function (p) { var r = role(p.role); return App.esc(r ? r.name : "—"); } },
        { h: "الحالة", c: function (p) { return p.active === false ? '<span class="badge bad">موقوف</span>' : '<span class="badge ok">نشط</span>'; } },
        { h: "آخر دخول", c: function (p) { return '<span class="num">' + App.esc(p.lastLogin || "—") + "</span>"; } },
        {
          h: "", cls: "act", c: function (p) {
            return '<button class="btn sm" onclick="Staff.edit(\'' + p.id + '\')">تعديل</button> ' +
              '<button class="btn sm" onclick="Staff.resetPw(\'' + p.id + '\')">كلمة السر</button> ' +
              (me && p.id === me.id ? "" : '<button class="btn sm ' + (p.active === false ? "" : "ghost") + '" onclick="Staff.toggle(\'' + p.id + '\')">' +
                (p.active === false ? "تفعيل" : "إيقاف") + "</button>");
          }
        }
      ], people, { emptyTitle: "لا موظفين" }) + "</div>";

    h += '<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>الأدوار والصلاحيات</h3><div class="spacer"></div>' +
      '<button class="btn sm" onclick="Staff.editRole()">+ دور جديد</button></div>' +
      App.table([
        { h: "الدور", c: function (r) { return "<b>" + App.esc(r.name) + "</b>"; } },
        { h: "الصلاحيات", c: function (r) {
          return r.admin ? '<span class="muted">كل شيء</span>' :
            '<span class="small">' + ((r.perms || []).map(function (k) { return App.esc(PERM_NAME[k] || k); }).join("، ") || "—") + "</span>";
        } },
        { h: "الموظفون", cls: "num", c: function (r) { return people.filter(function (p) { return p.role === r.id; }).length; } },
        { h: "", cls: "act", c: function (r) { return r.admin ? "" : '<button class="btn sm" onclick="Staff.editRole(\'' + r.id + '\')">تعديل</button>'; } }
      ], roles()) + "</div>";

    var lm = +(S().meta.lockMin || 0);
    h += '<div class="card"><div class="card-head"><h3>القفل التلقائي</h3></div>' +
      '<div class="row" style="align-items:center;gap:10px"><span>اقفل الجهاز بعد غياب</span>' +
      '<select class="inp" style="width:auto" onchange="Staff.setLock(this.value)">' +
      [[0, "لا تقفل"], [5, "5 دقائق"], [10, "10 دقائق"], [15, "15 دقيقة"], [30, "30 دقيقة"], [60, "ساعة"]].map(function (o) {
        return '<option value="' + o[0] + '"' + (lm === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
      }).join("") + "</select>" +
      '<span class="muted small">بعده يُسأل عن كلمة السر من جديد.</span></div></div>';
    return h;
  }

  function roleOptions() { return roles().map(function (r) { return { v: r.id, t: r.name }; }); }

  /* التفعيل: حساب المدير ورمز الاسترجاع */
  function setup() {
    if (on()) return;
    App.form({
      title: "حساب المدير",
      fields: [
        { k: "name", label: "الاسم", required: true },
        { k: "user", label: "اسم الدخول", hint: "اختياري" },
        { k: "pw", label: "كلمة السر", type: "password", required: true, hint: "4 أحرف على الأقل" },
        { k: "pw2", label: "أعدها", type: "password", required: true }
      ],
      saveLabel: "فعّل",
      onSave: function (v) {
        if (String(v.pw).length < 4) { App.toast("كلمة السر 4 أحرف على الأقل.", "warn"); return false; }
        if (v.pw !== v.pw2) { App.toast("كلمتا السر مختلفتان.", "warn"); return false; }
        var p = { id: App.uid(), name: String(v.name).trim(), user: String(v.user || "").trim(), role: "r-admin", active: true, created: App.nowStamp() };
        var code = recoveryCode(), rs = salt();
        Promise.all([setPw(p, v.pw), hashPw(code.replace(/\s+/g, ""), rs)]).then(function (res) {
          var s = S();
          if (!Array.isArray(s.roles) || !s.roles.length) s.roles = JSON.parse(JSON.stringify(ROLES0));
          if (!Array.isArray(s.staff)) s.staff = [];
          s.staff.push(p);
          s.meta.staffRecovery = { salt: rs, hash: res[1] };
          s.meta.staffOn = true;
          me = p;
          App.log("تفعيل الموظفين", "المدير: " + p.name);
          App.saveNow();
          afterChange();
          App.modal({
            title: "رمز الاسترجاع",
            body: '<p style="line-height:2;margin:0 0 10px">اكتب هذا الرمز واحفظه في مكان آمن. به وحده تسترجع كلمة سر المدير إن نسيتها، ولن يظهر مرة ثانية.</p>' +
              '<div class="num" style="font-size:26px;font-weight:700;letter-spacing:2px;text-align:center;padding:14px;border:1px dashed var(--line);border-radius:10px;direction:ltr">' + code + "</div>",
            actions: [{ label: "كتبته", kind: "primary", click: function (close) { close(); } }]
          });
        });
      }
    });
  }

  function edit(id) {
    if (!App.allow("staff", function () { edit(id); })) return;
    var p = id ? person(id) : null;
    App.form({
      title: p ? "تعديل موظف" : "موظف جديد",
      fields: [
        { k: "name", label: "الاسم", required: true },
        { k: "user", label: "اسم الدخول", hint: "اختياري" },
        { k: "role", label: "الدور", type: "select", options: roleOptions() },
        p ? null : { k: "pw", label: "كلمة السر", type: "password", required: true, hint: "4 أحرف على الأقل" }
      ].filter(Boolean),
      values: p || { role: "r-cashier" },
      onSave: function (v) {
        var name = String(v.name || "").trim();
        if (list().some(function (x) { return x.name === name && (!p || x.id !== p.id); })) { App.toast("هذا الاسم موجود.", "warn"); return false; }
        if (p) {
          if (p.role === "r-admin" && v.role !== "r-admin" && list().filter(function (x) { return x.role === "r-admin" && x.active !== false; }).length < 2) {
            App.toast("لا بد من مدير واحد على الأقل.", "warn"); return false;
          }
          var was = role(p.role);
          p.name = name; p.user = String(v.user || "").trim(); p.role = v.role;
          App.log("تعديل موظف", name + (was && was.id !== v.role ? " — الدور: " + was.name + " ← " + role(v.role).name : ""));
          App.save(); afterChange();
          return;
        }
        if (String(v.pw).length < 4) { App.toast("كلمة السر 4 أحرف على الأقل.", "warn"); return false; }
        var np = { id: App.uid(), name: name, user: String(v.user || "").trim(), role: v.role, active: true, created: App.nowStamp() };
        setPw(np, v.pw).then(function () {
          S().staff.push(np);
          App.log("موظف جديد", name + " — " + role(v.role).name);
          App.save(); App.rerender();
        });
      }
    });
  }

  function resetPw(id) {
    if (!App.allow("staff", function () { resetPw(id); })) return;
    var p = person(id);
    App.form({
      title: "كلمة سر " + p.name,
      fields: [{ k: "pw", label: "كلمة السر الجديدة", type: "password", required: true }, { k: "pw2", label: "أعدها", type: "password", required: true }],
      onSave: function (v) {
        if (String(v.pw).length < 4) { App.toast("كلمة السر 4 أحرف على الأقل.", "warn"); return false; }
        if (v.pw !== v.pw2) { App.toast("كلمتا السر مختلفتان.", "warn"); return false; }
        setPw(p, v.pw).then(function () { App.log("تغيير كلمة سر موظف", p.name); App.save(); App.toast("تغيّرت كلمة السر.", "ok"); });
      }
    });
  }

  function toggle(id) {
    if (!App.allow("staff", function () { toggle(id); })) return;
    var p = person(id);
    if (!p || (me && p.id === me.id)) return;
    if (p.active !== false && p.role === "r-admin" && list().filter(function (x) { return x.role === "r-admin" && x.active !== false; }).length < 2) {
      App.toast("لا بد من مدير واحد على الأقل.", "warn"); return;
    }
    p.active = p.active === false;
    App.log(p.active ? "تفعيل موظف" : "إيقاف موظف", p.name);
    App.save(); App.rerender();
  }

  function editRole(id) {
    if (!App.allow("staff", function () { editRole(id); })) return;
    var r = id ? role(id) : null;
    var box = document.createElement("div");
    box.innerHTML = '<label class="fld"><span>اسم الدور</span><input class="inp" id="rlName" value="' + App.esc(r ? r.name : "") + '"></label>' +
      PERMS.map(function (g) {
        return '<h4 style="margin:14px 0 6px">' + App.esc(g.g) + '</h4><div class="grid g2" style="gap:6px 16px">' +
          g.list.map(function (p) {
            var c = r && (r.perms || []).indexOf(p[0]) >= 0;
            return '<label class="chk"><input type="checkbox" data-perm="' + p[0] + '"' + (c ? " checked" : "") + "> " + App.esc(p[1]) + "</label>";
          }).join("") + "</div>";
      }).join("");
    App.modal({
      title: r ? "صلاحيات «" + r.name + "»" : "دور جديد",
      size: "wide",
      body: box,
      actions: [{ label: "حفظ", kind: "primary", click: function (close) {
        var name = String(box.querySelector("#rlName").value || "").trim();
        if (!name) { App.toast("اكتب اسم الدور.", "warn"); return; }
        var perms = [].slice.call(box.querySelectorAll("[data-perm]")).filter(function (x) { return x.checked; }).map(function (x) { return x.getAttribute("data-perm"); });
        var s = S();
        if (!Array.isArray(s.roles) || !s.roles.length) s.roles = JSON.parse(JSON.stringify(ROLES0));
        var t = r ? role(r.id) : null;
        if (t) { t.name = name; t.perms = perms; App.log("تعديل صلاحيات", name + ": " + perms.length + " صلاحية"); }
        else { s.roles.push({ id: App.uid(), name: name, perms: perms }); App.log("دور جديد", name); }
        App.save(); close(); afterChange();
      } }]
    });
  }

  function setLock(v) { S().meta.lockMin = +v || 0; App.log("القفل التلقائي", +v ? v + " دقيقة" : "لا يقفل"); App.save(); }

  /* ============================================================
     السجلات
     ============================================================ */

  var lf = { who: "", dev: "", act: "", from: "", to: "", q: "" };

  function logRows() {
    var q = App.norm(lf.q);
    return (S().log || []).filter(function (l) {
      if (lf.who && (l.byName || "") !== lf.who) return false;
      if (lf.dev && (l.dev || "") !== lf.dev) return false;
      if (lf.act && l.action !== lf.act) return false;
      var d = String(l.at || "").slice(0, 10);
      if (lf.from && d < lf.from) return false;
      if (lf.to && d > lf.to) return false;
      if (q && App.norm(l.action + " " + (l.detail || "") + " " + (l.byName || "")).indexOf(q) < 0) return false;
      return true;
    });
  }

  function distinct(k) {
    var seen = {}, out = [];
    (S().log || []).forEach(function (l) { var v = l[k] || ""; if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out.sort();
  }

  function sel(k, label, opts) {
    return '<select class="inp" style="width:auto" onchange="Staff.setLF(\'' + k + '\',this.value)"><option value="">' + label + "</option>" +
      opts.map(function (o) { return '<option' + (lf[k] === o ? " selected" : "") + ">" + App.esc(o) + "</option>"; }).join("") + "</select>";
  }

  function logsPage() {
    var h = '<div class="row" style="margin-bottom:14px;gap:8px;flex-wrap:wrap">' +
      '<div class="search-wrap"><span class="mag">⌕</span><input class="inp" id="lgq" placeholder="ابحث في السجل…" value="' + App.esc(lf.q) + '" oninput="Staff.setLF(\'q\',this.value)"></div>' +
      sel("who", "كل الموظفين", distinct("byName")) + sel("dev", "كل الأجهزة", distinct("dev")) + sel("act", "كل الحركات", distinct("action")) +
      '<input class="inp" type="date" style="width:auto" value="' + App.esc(lf.from) + '" onchange="Staff.setLF(\'from\',this.value)" title="من">' +
      '<input class="inp" type="date" style="width:auto" value="' + App.esc(lf.to) + '" onchange="Staff.setLF(\'to\',this.value)" title="إلى">' +
      '<div class="spacer"></div><button class="btn" onclick="Staff.exportLogs()">تصدير Excel</button></div>' +
      '<div class="card" id="lgList">' + logTable() + "</div>";
    return h;
  }

  function logTable() {
    var rows = logRows();
    return '<div class="card-head"><h3>السجلات</h3><div class="spacer"></div><span class="muted small">' + rows.length + " حركة</span></div>" +
      App.table([
        { h: "الوقت", c: function (l) { return '<span class="num">' + App.esc(l.at || "") + "</span>"; } },
        { h: "الحركة", c: function (l) { return "<b>" + App.esc(l.action || "") + "</b>"; } },
        { h: "التفاصيل", c: function (l) { return App.esc(l.detail || ""); } },
        { h: "الموظف", c: function (l) { return App.esc(l.byName || "—"); } },
        { h: "الجهاز", c: function (l) { return App.esc(l.dev || "—"); } }
      ], rows, { lazy: 100, emptyTitle: "لا حركات", emptyText: "غيّر التصفية أو الفترة." });
  }

  function setLF(k, v) {
    lf[k] = v;
    var host = document.getElementById("lgList");
    if (host) host.innerHTML = logTable(); else App.rerender();
  }

  function exportLogs() {
    var rows = logRows().map(function (l) { return [l.at, l.action, l.detail || "", l.byName || "", l.dev || ""]; });
    App.download("السجلات-" + App.today() + ".csv", App.toCsv([["الوقت", "الحركة", "التفاصيل", "الموظف", "الجهاز"]].concat(rows)), "text/csv");
  }

  /* ============================================================
     الأجهزة
     ============================================================ */

  var link = null, linkAsked = false;

  function devicesPage() {
    if (!linkAsked) {
      linkAsked = true;
      App.apiJson("/api/link").then(function (r) { link = r && r.ok ? r.data : null; if (location.hash === "#/devices") App.rerender(); }).catch(function () { });
    }
    var today = App.today(), by = {};
    (S().log || []).concat((S().invoices || []).slice(0, 2000)).forEach(function (x) {
      var d = x.dev;
      if (!d) return;
      var b = by[d] || (by[d] = { name: d, last: "", who: "", today: 0, sales: 0 });
      var at = x.at || "";
      if (at > b.last) { b.last = at; b.who = x.byName || b.who; }
      if (at.slice(0, 10) === today) { if (x.no) b.sales++; else b.today++; }
    });
    var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.last < b.last ? 1 : -1; });

    var lk = link && link.linked ? (link.role === "main" ? "جهاز المحل" : "جهاز ثانٍ") : "غير مربوط";
    var h = '<div class="grid g2" style="margin-bottom:16px">' +
      '<div class="card"><div class="card-head"><h3>هذا الجهاز</h3></div>' +
      '<div class="row" style="gap:8px;align-items:center;margin-bottom:10px"><input class="inp" id="dvName" value="' + App.esc(devName() === "هذا الجهاز" ? "" : devName()) + '" placeholder="مثلاً: كاشير الدور الأرضي">' +
      '<button class="btn primary" onclick="Staff.saveDevName()">حفظ الاسم</button></div>' +
      '<p class="muted small" style="margin:0;line-height:1.9">يظهر الاسم في الفواتير والسجلات. ' +
      "الربط: <b>" + App.esc(lk) + "</b>" + (link && link.waiting ? " · ينتظر الإرسال: " + link.waiting : "") +
      (link && link.lastOk ? " · آخر تبادل: " + App.esc(link.lastOk) : "") +
      (me ? " · يعمل الآن: <b>" + App.esc(me.name) + "</b>" : "") + "</p></div>" +
      '<div class="card"><div class="card-head"><h3>ما يعنيه</h3></div><p class="muted small" style="margin:0;line-height:1.9">' +
      "كل جهاز يحمل اسماً تختاره، وكل فاتورة وحركة تُسجَّل باسم الجهاز والموظف. " +
      "الجدول أدناه من السجل نفسه: آخر نشاط لكل جهاز ومن عمل عليه.</p></div></div>";
    h += '<div class="card"><div class="card-head"><h3>الأجهزة</h3></div>' +
      App.table([
        { h: "الجهاز", c: function (r) { return "<b>" + App.esc(r.name) + "</b>" + (r.name === devName() ? ' <span class="badge ok">هذا</span>' : ""); } },
        { h: "آخر نشاط", c: function (r) { return '<span class="num">' + App.esc(r.last || "—") + "</span>"; } },
        { h: "آخر موظف", c: function (r) { return App.esc(r.who || "—"); } },
        { h: "فواتير اليوم", cls: "num", c: function (r) { return r.sales; } },
        { h: "حركات اليوم", cls: "num", c: function (r) { return r.today; } }
      ], rows, { emptyTitle: "لا نشاط مسجّل بعد", emptyText: "يظهر هنا كل جهاز بعد أول حركة عليه." }) + "</div>";
    return h;
  }

  function saveDevName() {
    var el = document.getElementById("dvName");
    var n = String(el && el.value || "").trim();
    if (!n) { App.toast("اكتب اسم الجهاز.", "warn"); return; }
    var old = devName();
    setDevName(n);
    App.log("اسم الجهاز", old + " ← " + n);
    App.save();
    paintWho(); App.rerender();
    App.toast("سُمّي الجهاز: " + n, "ok");
  }

  return {
    boot: boot, on: on, can: can, allow: allow, current: current, stamp: stamp, devName: devName,
    pick: pick, login: login, forgot: forgot, lock: lock, showLogin: showLogin, changeMine: changeMine,
    page: page, setup: setup, edit: edit, resetPw: resetPw, toggle: toggle, editRole: editRole, setLock: setLock,
    logsPage: logsPage, setLF: setLF, exportLogs: exportLogs,
    devicesPage: devicesPage, saveDevName: saveDevName,
    PERMS: PERMS, ROLES0: ROLES0,
    __enter: function (id) { var p = person(id); if (p) enter(p); }, __hash: hashPw
  };
})();
