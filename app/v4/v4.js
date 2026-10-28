/* ============================================================
   واجهة 4.0 — النواة (المرحلة 4، قرار 0021)
   ------------------------------------------------------------
   صفحات على أوامر المحرك (/api/v2) صفحةً صفحة: لا تُحمَّل البيانات كلها
   ولا تُحفظ كلها، كل زر أمر واحد في معاملة واحدة.
   - الدخول بموظف (قرار 0011). المدير بلا كلمة سر يدخل مباشرة.
   - كل صفحة تعلن صلاحيتها، فلا يظهر للموظف ما لا يملكه.
   - المبالغ من المحرك بالدرهم، وتُعرض بالدينار (قرار 0006).
   أدوات الشكل (الأيقونات، النوافذ، التنبيهات، الجداول) من js/core.js.
   ============================================================ */
var V4 = (function () {
  "use strict";

  var token = "", me = null, shop = null, pages = [], current = "";
  try { token = sessionStorage.getItem("v4token") || ""; } catch (e) { }

  /* ---------- الأوامر ---------- */

  function call(cmd, body) {
    var used = token;
    return fetch("/api/v2/" + cmd, {
      method: "POST",
      headers: { "X-Qirtasiya": "1", "Content-Type": "application/json", "X-Session": used },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        /* 401 لجلسة انتهت فعلاً. ردّ متأخر لجلسة قديمة (طلب أُرسل قبل الخروج) لا يعيد
           رسم شاشة الدخول فوق ما يُكتب فيها */
        if (r.status === 401) {
          if (used === token) signedOut();
          throw new Error((d && d.error) || "انتهت الجلسة. ادخل من جديد.");
        }
        if (!d) throw new Error("رد غير مفهوم من البرنامج (" + r.status + ").");
        if (d.ok === false) {
          var e = new Error(d.error || "تعذّرت العملية.");
          e.code = d.code || "";
          throw e;
        }
        return d.data;
      });
    }, function () {
      throw new Error("تعذّر الوصول للبرنامج. هل ما زال يعمل؟");
    });
  }

  /* أمر يُظهر خطأه للمستخدم. الخطأ المعروض لا يُعاد في سجل المتصفح */
  function run(cmd, body) {
    return call(cmd, body).catch(function (e) { App.toast(e.message, "bad"); e.shown = true; throw e; });
  }
  window.addEventListener("unhandledrejection", function (e) { if (e.reason && e.reason.shown) e.preventDefault(); });

  /* نموذج يبقى مفتوحاً حتى يقبل المحرك الحفظ: رفضه (اسم دخول مستعمل، مسار لا يُكتب
     فيه) لا يضيّع ما كُتب. onSave يُرجع وعداً، أو false ليبقى مفتوحاً */
  function form(opts) {
    var m, busy = false, save = opts.onSave;
    opts.onSave = function (v) {
      if (busy) return false;
      busy = true;
      Promise.resolve(save(v)).then(function (r) {
        busy = false;
        if (r !== false) m.close();
      }, function () { busy = false; });
      return false;
    };
    m = App.form(opts);
    return m;
  }

  /* جهاز ثانٍ (قرار 0023): الأمر لم يُنفَّذ هنا، أُرسل لجهاز المحل وينفَّذ هناك */
  function queued(r, what) {
    if (!r || r.queued !== true) return false;
    App.toast((what ? what + " — " : "") + "أُرسل لجهاز المحل، ويظهر هنا بعد أن ينفّذه (خلال دقيقة إن كان يعمل).", "ok");
    if (window.V4Sync) V4Sync.poll();
    return true;
  }

  /* ---------- المال ---------- */

  function money(d) {
    d = Number(d) || 0;
    return (d % 10 === 0 ? (d / 1000).toFixed(2) : (d / 1000).toFixed(3));
  }
  function dirhams(v) { return Math.round(App.num(v) * 1000); }
  function currency() { return (shop && shop.meta && shop.meta.currency) || "د.ل"; }

  /* perms من المحرك: كل ما تملكه الجلسة الآن (المدير كلها)، وبلا سعر الشراء والأرباح
     ما دام رمز الأرباح لم يُكتب (قرار 0024) */
  function can(p) { return !!me && me.perms.indexOf(p) >= 0; }

  function today() {
    var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /* ---------- الصفحات ---------- */

  /* {o (الترتيب)، k، t، ic، g (اسم المجموعة)، perm، flush، render() → html، after()} */
  function page(def) {
    pages.push(def);
    pages.sort(function (a, b) { return (a.o || 0) - (b.o || 0); });
  }

  function buildNav() {
    var h = "", group = null;
    pages.forEach(function (p) {
      if (p.perm && !can(p.perm)) return;
      if (p.g !== group) { group = p.g; h += '<div class="group-label">' + App.esc(group) + "</div>"; }
      h += '<button class="nav-item" data-k="' + p.k + '" title="' + App.esc(p.t) + '" onclick="location.hash=\'#/' + p.k + '\'">' +
        App.icon(p.ic, 19) + "<span>" + App.esc(p.t) + "</span></button>";
    });
    document.getElementById("nav").innerHTML = h;
  }

  function route() {
    if (!me) return;
    var k = (location.hash || "#/dash").replace("#/", "").split("?")[0];
    var p = null;
    pages.forEach(function (x) { if (x.k === k && (!x.perm || can(x.perm))) p = x; });
    if (!p) {
      var first = null;
      pages.forEach(function (x) { if (!first && (!x.perm || can(x.perm))) first = x; });
      if (first && k !== first.k) { location.hash = "#/" + first.k; return; }
      document.getElementById("view").innerHTML = "";
      return;
    }
    current = p.k;
    var view = document.getElementById("view");
    view.className = p.flush ? "flush" : "";
    document.getElementById("pageTitle").textContent = p.t;
    Array.prototype.forEach.call(document.querySelectorAll("#nav .nav-item"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-k") === p.k);
    });
    view.innerHTML = p.render() || "";
    if (p.after) p.after();
    hideVeil();
  }

  /* دائرة «يفتح …» من js/core.js تظهر مع ضغط القائمة، وتُخفى بعد رسم الصفحة */
  function hideVeil() {
    requestAnimationFrame(function () {
      setTimeout(function () {
        var v = document.querySelector(".busy-veil");
        if (v) { v.classList.remove("on"); v.parentNode.removeChild(v); }
      }, 0);
    });
  }

  function refresh() { route(); }

  /* بعد تغيير اسم المحل أو كلمة السر: يُعاد ما يُعرض من الرأس والصفحة */
  function restart() {
    return call("me").then(function (m) { me = m; return start(); });
  }

  /* ---------- الدخول ---------- */

  function signedOut() {
    me = null;
    token = "";
    try { sessionStorage.removeItem("v4token"); } catch (e) { }
    loginScreen();
  }

  function enter(data) {
    token = data.token;
    try { sessionStorage.setItem("v4token", token); } catch (e) { }
    me = data;
    return start();
  }

  function login(loginName, password) {
    return call("login", { login: loginName, password: password || "" }).then(enter);
  }

  function loginScreen() {
    document.body.classList.add("out");
    var view = document.getElementById("view");
    view.className = "";
    call("login.users").then(function (users) {
      /* المدير وحده بلا كلمة سر: يدخل مباشرة كما في 3.x */
      if (users.length === 1 && !users[0].hasPassword) {
        login(users[0].login, "").catch(function (e) { App.toast(e.message, "bad"); });
        return;
      }
      view.innerHTML = '<div class="login-wrap"><div class="card"><div class="card-body" style="padding:30px">' +
        "<h2>الدخول</h2>" +
        '<p class="muted center" style="margin:0 0 18px">اختر اسمك</p>' +
        '<div class="grid" style="gap:8px;margin-bottom:16px">' +
        users.map(function (u) {
          return '<button class="btn" data-login="' + App.esc(u.login) + '" data-pw="' + (u.hasPassword ? 1 : 0) + '">' +
            App.esc(u.name) + (u.role === "admin" ? ' <span class="muted small">(المدير)</span>' : "") + "</button>";
        }).join("") + "</div>" +
        '<div id="pwBox" hidden><div class="field"><label for="pw">كلمة السر</label>' +
        '<input class="inp" id="pw" type="password" autocomplete="current-password"></div>' +
        '<button class="btn primary lg" id="goBtn">دخول</button></div>' +
        "</div></div></div>";
      var chosen = null;
      Array.prototype.forEach.call(view.querySelectorAll("[data-login]"), function (b) {
        b.onclick = function () {
          chosen = b.getAttribute("data-login");
          if (b.getAttribute("data-pw") !== "1") { login(chosen, "").catch(function (e) { App.toast(e.message, "bad"); }); return; }
          Array.prototype.forEach.call(view.querySelectorAll("[data-login]"), function (x) { x.classList.toggle("primary", x === b); });
          document.getElementById("pwBox").hidden = false;
          document.getElementById("pw").focus();
        };
      });
      function go() {
        login(chosen, document.getElementById("pw").value).catch(function (e) {
          App.toast(e.message, "bad");
          document.getElementById("pw").select();
        });
      }
      view.querySelector("#goBtn").onclick = go;
      view.querySelector("#pw").onkeydown = function (e) { if (e.key === "Enter") go(); };
    }).catch(function (e) {
      if (e.code === "no-db") { setupScreen(); return; }
      view.innerHTML = '<div class="login-wrap"><div class="card"><div class="card-body">' + App.esc(e.message) + "</div></div></div>";
    });
  }

  /* أول تشغيل لتطبيق طرابلس: لا قاعدة بعد (قرار 0022). اسم المحل والمدينة،
     وبيانات تجربة أو لا، ثم ينشئها البرنامج وتفتح 4.0 */
  function setupScreen() {
    var view = document.getElementById("view");
    App.apiJson("/api/info").catch(function () { return {}; }).then(function (info) {
      var app = (info && info.app) || "المنظومة";
      document.title = app;
      view.innerHTML = '<div class="login-wrap"><div class="card"><div class="card-body" style="padding:30px">' +
        "<h2>" + App.esc(app) + "</h2>" +
        '<p class="muted center" style="margin:0 0 18px">أول تشغيل على هذا الجهاز</p>' +
        '<div class="field"><label for="suShop">اسم المحل</label>' +
        '<input class="inp" id="suShop" placeholder="مثال: مكتبة النور للقرطاسية"></div>' +
        '<div class="field"><label for="suCity">المدينة</label><input class="inp" id="suCity" value="طرابلس"></div>' +
        '<div class="field"><label for="suDemo">البداية</label><select class="inp" id="suDemo">' +
        '<option value="yes">ببيانات تجربة (تُمسح بزر من الإعدادات حين تجهز)</option>' +
        '<option value="no">فارغ، للعمل الحقيقي مباشرة</option></select></div>' +
        '<button class="btn primary lg" id="suGo">ابدأ</button>' +
        '<p class="center small" style="margin:16px 0 0"><a href="#" id="suJoin">أو: اربطه جهازاً ثانياً لفرع مربوط</a></p>' +
        "</div></div></div>";
      var go = view.querySelector("#suGo");
      view.querySelector("#suShop").focus();
      view.querySelector("#suJoin").onclick = function (e) { e.preventDefault(); joinForm(info); };
      go.onclick = function () {
        var shop = view.querySelector("#suShop").value.trim();
        if (!shop) { App.toast("اكتب اسم المحل.", "warn"); view.querySelector("#suShop").focus(); return; }
        go.disabled = true;
        /* الإنشاء من النافذة المالكة للكتابة، كالنقل (قرار 0019) */
        App.apiJson("/api/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) }).then(function (c) {
          if (!c || !c.ok) throw new Error("تعذّر تجهيز البرنامج للكتابة.");
          return fetch("/api/v2/create", {
            method: "POST",
            headers: { "X-Qirtasiya": "1", "X-Owner": c.token, "Content-Type": "application/json" },
            body: JSON.stringify({ shopName: shop, city: view.querySelector("#suCity").value.trim(), demo: view.querySelector("#suDemo").value === "yes" })
          }).then(function (r) { return r.json(); });
        }).then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || "تعذّر إنشاء القاعدة.");
          location.reload();
        }).catch(function (e) { go.disabled = false; App.toast(e.message, "bad"); });
      };
    });
  }

  /* جهاز ثانٍ لفرع مربوط (قرار 0023): قاعدته تصير نسخة من جهاز المحل */
  function joinForm(info) {
    form({
      title: "اربطه جهازاً ثانياً لفرع",
      values: { branch: info && info.edition === "tripoli" ? "tripoli" : "misrata" },
      topHtml: '<p class="muted small" style="line-height:1.8;margin:0 0 12px">جهاز المحل يكون مربوطاً قبله (الإعدادات ← الربط ← «هذا جهاز المحل»). ' +
        "هذا الجهاز يصير نسخة منه يتزامن معه كل دقيقة، وما تضيفه هنا يصل المحل.</p>",
      fields: [
        { k: "url", label: "عنوان خادم الربط", required: true, full: true, placeholder: "https://maktaba-sync.اسمك.workers.dev" },
        { k: "key", label: "كلمة سر الربط", required: true },
        { k: "branch", label: "رمز الفرع", required: true, hint: "كما في جهاز المحل: misrata أو tripoli" },
        { k: "name", label: "اسم هذا الجهاز", placeholder: "مثلاً: لابتوب حسن" }
      ],
      saveLabel: "اربط",
      onSave: function (v) { return join(v, false); }
    });
  }

  function join(v, replace) {
    App.toast("يحمّل نسخة جهاز المحل…");
    return App.apiJson("/api/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) }).then(function (c) {
      if (!c || !c.ok) throw new Error("تعذّر تجهيز البرنامج للكتابة.");
      return fetch("/api/v2/join", {
        method: "POST",
        headers: { "X-Qirtasiya": "1", "X-Owner": c.token, "Content-Type": "application/json" },
        body: JSON.stringify({ url: v.url, key: v.key, branch: v.branch, name: v.name, replace: replace })
      }).then(function (r) { return r.json(); });
    }).then(function (d) {
      if (d && d.ok) { location.reload(); return; }
      if (d && d.code === "has-data") {
        App.confirm(d.error + " متأكد؟", function () { join(v, true); }, { yes: "استبدل واربط", danger: true });
        return false;
      }
      App.toast((d && d.error) || "تعذّر الربط.", "bad");
      return false;
    }, function (e) { App.toast(e.message, "bad"); return false; });
  }

  function logout() {
    /* ردّ 401 لطلب آخر قد أخرجه قبل هذا: لا تُرسم شاشة الدخول مرتين */
    call("logout").catch(function () { }).then(function () { if (token) signedOut(); });
  }

  function start() {
    return call("shop.info").then(function (s) {
      shop = s || {};
      document.body.classList.remove("out");
      var name = (shop.meta && shop.meta.shopName) || "المكتبة والقرطاسية";
      document.getElementById("brandName").textContent = name;
      document.title = name;
      var b = shop.branch || {};
      var tag = document.getElementById("branchTag");
      tag.textContent = b.city ? "فرع " + b.city : "";
      tag.className = "branch-tag " + (Number(b.no) === 1 ? "one" : "two");
      document.getElementById("demoTag").hidden = !(shop.demo === true || shop.demo === "true");
      document.getElementById("userChip").innerHTML = '<span class="user-chip">' + App.icon("people", 14) + App.esc(me.name) + "</span>";
      document.getElementById("logoutBtn").hidden = false;
      App.apiJson("/api/info").then(function (d) {
        if (d && d.version) document.getElementById("ver").textContent = "v" + d.version;
      }).catch(function () { });
      buildNav();
      route();
      if (window.V4Sync) V4Sync.start();
    });
  }

  function tick() {
    var c = document.getElementById("clock");
    if (!c) return;
    var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; };
    c.textContent = p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function boot() {
    window.addEventListener("hashchange", route);
    document.addEventListener("keydown", function (e) {
      if (e.key === "F2") { e.preventDefault(); location.hash = "#/pos"; }
      /* Esc يغلق النافذة العليا كما في 3.x */
      if (e.key === "Escape") {
        var x = document.querySelector("#modalHost .overlay:last-child [data-x]");
        if (x) { e.preventDefault(); x.click(); }
      }
    });
    tick(); setInterval(tick, 20000);
    if (token) call("me").then(function (m) { me = m; return start(); }).catch(function () { });
    else loginScreen();
  }

  return {
    boot: boot, call: call, run: run, form: form, queued: queued, page: page, refresh: refresh, restart: restart, logout: logout,
    money: money, dirhams: dirhams, currency: currency, can: can, today: today,
    me: function () { return me; }, shop: function () { return shop; }, current: function () { return current; }
  };
})();
