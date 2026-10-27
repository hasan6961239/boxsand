/* ============================================================
   واجهة 4.0 — الإعدادات (4أ: الأساسي فقط)
   ------------------------------------------------------------
   اسم المحل وبيانات الإيصال، كلمة سر الموظف نفسه، الموظفون
   وصلاحياتهم، فحص البيانات، و«ابدأ من جديد بلا بيانات التجربة».
   ============================================================ */
var V4Settings = (function () {
  "use strict";
  var esc = App.esc;

  function card(title, body, id) {
    return '<div class="card" style="margin-bottom:16px"' + (id ? ' id="' + id + '"' : "") + '>' +
      '<div class="card-head"><h3>' + esc(title) + "</h3></div>" +
      '<div class="card-body">' + body + "</div></div>";
  }

  function render() {
    var h = "";
    if (V4.can("settings")) h += card("المحل والإيصال", '<div class="muted">…</div>', "setShop");
    h += card("كلمة سري", '<p class="muted" style="margin:0 0 12px">' +
      (V4.me().hasPassword === false ? "لا كلمة سر لك الآن: أي أحد يفتح البرنامج يدخل باسمك." : "تُطلب عند الدخول.") +
      '</p><button class="btn" onclick="V4Settings.myPassword()">' +
      (V4.me().hasPassword === false ? "ضع كلمة سر" : "غيّر كلمة السر") + "</button>");
    if (V4.can("users")) h += card("الموظفون", '<div class="muted">…</div>', "setUsers");
    if (V4.can("settings")) {
      h += card("النسخ الاحتياطية وسلامة البيانات", '<p class="muted" style="margin:0 0 12px;line-height:1.8">نسخة من القاعدة كل يوم ' +
        "عند فتح البرنامج وعند إغلاقه، تبقى 30 يوماً ومعها نسخة من كل شهر. ضع مجلداً إضافياً على فلاشة أو قرص آخر " +
        "(أو مجلد Google Drive على الجهاز) فتُنسخ إليه كل نسخة: عطل القرص لا يأخذ البيانات ونسخها معاً.</p>" +
        '<div id="bkOut" class="kv" style="margin-bottom:14px"></div>' +
        '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" onclick="V4Settings.backupDir()">المجلد الإضافي</button>' +
        '<button class="btn" onclick="V4Settings.check()">افحص البيانات الآن</button></div>' +
        '<div id="healthOut" class="muted small" style="margin-top:12px"></div>');
      var s = V4.shop() || {};
      if (s.demo === true || s.demo === "true") {
        h += card("نسخة تجربة", '<p style="margin:0 0 12px;line-height:1.8">البيانات هنا للتجربة: كتب وزبائن وبيعات غير حقيقية. ' +
          "حين تجهز للعمل الحقيقي امسحها وابدأ بقاعدة فارغة باسم المحل نفسه. " +
          "نسخة التجربة تبقى محفوظة في مجلد backups.</p>" +
          '<button class="btn danger" onclick="V4Settings.resetDemo()">ابدأ من جديد بلا بيانات التجربة</button>');
      }
    }
    return h;
  }

  function after() {
    if (V4.can("settings")) { loadShop(); loadBackups(); }
    if (V4.can("users")) loadUsers();
  }

  /* ---------- المحل ---------- */

  function loadShop() {
    V4.call("settings.get", { key: "meta" }).then(function (m) {
      m = m || {};
      var host = document.querySelector("#setShop .card-body");
      if (!host) return;
      host.innerHTML = '<div class="kv" style="margin-bottom:14px">' +
        '<span class="k">اسم المحل</span><b>' + esc(m.shopName || "") + "</b>" +
        '<span class="k">الهاتف</span><span class="num">' + esc(m.phone || "—") + "</span>" +
        '<span class="k">آخر الإيصال</span><span>' + esc(m.footer || "شكراً لزيارتكم") + "</span></div>" +
        '<button class="btn" onclick="V4Settings.editShop()">تعديل</button>';
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function editShop() {
    V4.run("settings.get", { key: "meta" }).then(function (m) {
      m = m || {};
      V4.form({
        title: "المحل والإيصال",
        values: { shopName: m.shopName, phone: m.phone, footer: m.footer },
        fields: [
          { k: "shopName", label: "اسم المحل", required: true, full: true },
          { k: "phone", label: "الهاتف (يظهر على الإيصال)" },
          { k: "footer", label: "آخر سطر في الإيصال", placeholder: "شكراً لزيارتكم" }
        ],
        onSave: function (v) {
          m.shopName = v.shopName; m.phone = v.phone; m.footer = v.footer;
          return V4.run("setting.set", { key: "meta", value: m }).then(function () {
            App.toast("حُفظ", "ok");
            V4.restart();
          });
        }
      });
    });
  }

  /* ---------- كلمة السر ---------- */

  function myPassword() {
    var none = V4.me().hasPassword === false;
    V4.form({
      title: none ? "ضع كلمة سر" : "غيّر كلمة السر",
      size: "narrow",
      fields: [
        none ? null : { k: "current", label: "كلمة السر الحالية", type: "password", required: true },
        { k: "next", label: "كلمة السر الجديدة", type: "password", required: true, hint: "4 أحرف على الأقل" },
        { k: "again", label: "أعدها مرة ثانية", type: "password", required: true }
      ],
      onSave: function (v) {
        if (v.next !== v.again) { App.toast("الكلمتان غير متطابقتين.", "warn"); return false; }
        return V4.run("me.password", { current: v.current || "", next: v.next }).then(function () {
          App.toast("حُفظت كلمة السر.", "ok");
          V4.restart();
        });
      }
    });
  }

  /* ---------- الموظفون ---------- */

  var perms = null, users = [];

  function loadUsers() {
    Promise.all([V4.call("users.list"), perms ? Promise.resolve(perms) : V4.call("perms.list")]).then(function (r) {
      perms = r[1];
      var host = document.querySelector("#setUsers .card-body");
      if (!host) return;
      host.innerHTML = App.table([
        { h: "الاسم", c: function (u) { return "<b>" + esc(u.name) + "</b>" + (u.role === "admin" ? ' <span class="badge">المدير</span>' : ""); } },
        { h: "اسم الدخول", c: function (u) { return '<span class="num">' + esc(u.login) + "</span>"; } },
        { h: "كلمة السر", c: function (u) { return u.hasPassword ? "موجودة" : '<span class="badge warn">بلا كلمة سر</span>'; } },
        { h: "الحالة", c: function (u) { return u.active ? "يعمل" : '<span class="badge bad">موقوف</span>'; } },
        { h: "", c: function (u) {
          var pw = '<button class="btn sm" onclick="V4Settings.userPassword(' + u.id + ')">كلمة السر</button>';
          if (u.role === "admin") return pw;
          return '<button class="btn sm" onclick="V4Settings.userPerms(' + u.id + ')">الصلاحيات</button> ' + pw + " " +
            '<button class="btn sm ghost" onclick="V4Settings.userActive(' + u.id + "," + (u.active ? "false" : "true") + ')">' +
            (u.active ? "إيقاف" : "إرجاع") + "</button>";
        } }
      ], r[0]) + '<div style="margin-top:12px"><button class="btn primary" onclick="V4Settings.addUser()">+ موظف جديد</button></div>';
      users = r[0];
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function addUser() {
    V4.form({
      title: "موظف جديد",
      fields: [
        { k: "name", label: "الاسم", required: true, placeholder: "مثلاً: أحمد" },
        { k: "login", label: "اسم الدخول", required: true, placeholder: "مثلاً: ahmed" },
        { k: "password", label: "كلمة السر", type: "password", hint: "فارغ = يدخل بلا كلمة سر" }
      ],
      onSave: function (v) {
        return V4.run("user.add", { name: v.name, login: v.login, password: v.password }).then(function () {
          App.toast("أُضيف: " + v.name + " — يبدأ بالبيع والبحث ومشاهدة المخزون.", "ok");
          loadUsers();
        });
      }
    });
  }

  function userOf(id) {
    for (var i = 0; i < users.length; i++) if (users[i].id === id) return users[i];
    return null;
  }

  function userPassword(id) {
    var u = userOf(id);
    if (!u) return;
    V4.form({
      title: "كلمة سر " + u.name,
      size: "narrow",
      fields: [{ k: "password", label: "كلمة السر الجديدة", type: "password", hint: "فارغ = يدخل بلا كلمة سر" }],
      onSave: function (v) {
        return V4.run("user.password", { id: id, password: v.password }).then(function () {
          App.toast("حُفظت.", "ok");
          if (id === V4.me().userId) V4.restart(); else loadUsers();
        });
      }
    });
  }

  function userPerms(id) {
    var u = userOf(id);
    if (!u) return;
    var have = String(u.perms || "").split(",");
    var body = '<div class="grid g2" style="gap:6px 18px">' + perms.map(function (p) {
      return '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" value="' + esc(p.key) + '"' +
        (have.indexOf(p.key) >= 0 ? " checked" : "") + "> " + esc(p.label) + "</label>";
    }).join("") + "</div>";
    App.modal({
      title: "صلاحيات " + u.name, size: "wide", body: body,
      actions: [{ label: "حفظ", kind: "primary", click: function (close, ov) {
        var l = [];
        Array.prototype.forEach.call(ov.querySelectorAll("input[type=checkbox]:checked"), function (c) { l.push(c.value); });
        V4.run("user.perms", { id: id, perms: l }).then(function () { App.toast("حُفظت الصلاحيات.", "ok"); close(); loadUsers(); });
      } }],
      cancelLabel: "إلغاء"
    });
  }

  function userActive(id, active) {
    V4.run("user.active", { id: id, active: active }).then(function () { loadUsers(); });
  }

  /* ---------- النسخ الاحتياطية ---------- */

  function paintBackups(d) {
    var host = document.getElementById("bkOut");
    if (!host) return;
    host.innerHTML = '<span class="k">آخر نسخة</span><span class="num">' + esc(d.last || "لا نسخ بعد") + "</span>" +
      '<span class="k">مجلد النسخ</span><span class="num" dir="ltr" style="text-align:right">' + esc(d.folder) + "</span>" +
      '<span class="k">المجلد الإضافي</span>' + (d.dir
        ? '<span class="num" dir="ltr" style="text-align:right">' + esc(d.dir) + "</span>"
        : '<span><span class="badge warn">غير محدد</span></span>');
  }

  function loadBackups() {
    V4.call("backup.dir").then(paintBackups).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function backupDir() {
    V4.run("backup.dir").then(function (d) {
      V4.form({
        title: "المجلد الإضافي للنسخ",
        values: { dir: d.dir },
        fields: [{ k: "dir", label: "مسار المجلد", full: true, placeholder: "D:\\نسخ-المكتبة",
          hint: "فلاشة أو قرص آخر أو مجلد Google Drive على الجهاز. فارغ = بلا مجلد إضافي." }],
        onSave: function (v) {
          return V4.run("backup.dir", { dir: v.dir }).then(function (r) {
            paintBackups(r);
            App.toast(r.dir ? "تُنسخ إليه نسخة اليوم الآن، ثم كل نسخة بعدها." : "أُوقف المجلد الإضافي.", "ok");
          });
        }
      });
    });
  }

  /* ---------- الفحص والتجربة ---------- */

  function check() {
    var out = document.getElementById("healthOut");
    out.textContent = "يفحص…";
    V4.run("health", { full: true }).then(function (h) {
      var bad = (h.problems || []).length;
      out.innerHTML = (h.check === "ok" && !bad
        ? '<span class="badge ok">سليمة</span> '
        : '<span class="badge bad">فيها مشكلة</span> ' + esc((h.problems || []).join(" · ")) + " ") +
        "SQLite " + esc(h.sqlite) + " · الترقية " + h.version + " · " + esc(h.file);
    }, function () { out.textContent = ""; });
  }

  function resetDemo() {
    App.confirm("تُمسح كل بيانات التجربة (الكتب والزبائن والبيعات) ويبدأ المحل فارغاً. " +
      "نسخة منها تبقى في مجلد backups. متأكد؟", function () {
      V4.run("demo.reset").then(function () {
        App.toast("بدأ المحل من جديد بلا بيانات التجربة.", "ok");
        setTimeout(function () { location.hash = "#/dash"; location.reload(); }, 600);
      });
    }, { yes: "امسح وابدأ من جديد", danger: true, title: "بيانات التجربة" });
  }

  V4.page({ o: 90, g: "أخرى", k: "settings", t: "الإعدادات", ic: "gear", render: render, after: after });

  return {
    editShop: editShop, myPassword: myPassword, backupDir: backupDir, addUser: addUser, userPassword: userPassword,
    userPerms: userPerms, userActive: userActive, check: check, resetDemo: resetDemo
  };
})();
