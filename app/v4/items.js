/* ============================================================
   واجهة 4.0 — الكتب والقرطاسية
   ------------------------------------------------------------
   صفحة صفحة من المحرك (items.page)، والبحث نفسه في نقطة البيع
   (ترتيب البحث، والقريب تحت «هل تقصد؟»). الإضافة والتعديل والحذف كل
   منها أمر واحد. المكان شجرة: «ط1 · قسم الجامعي · خزانة A · رف 2».
   ============================================================ */
var V4Items = (function () {
  "use strict";
  var esc = App.esc, money = V4.money;
  var f = { q: "", kind: "", offset: 0 };
  var PAGE = 50, places = null, seq = 0;

  /* ---------- الأماكن ---------- */

  function loadPlaces() {
    if (places) return Promise.resolve(places);
    if (!V4.can("view_stock")) return Promise.resolve([]);
    return V4.call("places.list").then(function (l) {
      var byId = {};
      l.forEach(function (p) { byId[p.id] = p; });
      l.forEach(function (p) {
        var names = [], x = p, guard = 0;
        /* الطابق برمزه القصير، والباقي باسمه: «ط1 · قسم الجامعي · خزانة A · رف 2» */
        while (x && x.kind !== "shop" && guard++ < 10) { names.unshift(x.kind === "floor" ? x.code || x.name : x.name); x = byId[x.parentId]; }
        p.path = names.join(" · ") || p.name;
      });
      places = l;
      return l;
    });
  }

  function placePath(id) {
    if (!places) return "";
    for (var i = 0; i < places.length; i++) if (places[i].id === id) return places[i].path;
    return "";
  }

  /* ---------- القائمة ---------- */

  function list() {
    return '<div class="toolbar">' +
      '<input class="inp search" id="itQ" placeholder="ابحث بالاسم أو المؤلف أو الباركود…" autocomplete="off" value="' + esc(f.q) +
      '" oninput="V4Items.search(this.value)">' +
      '<div class="seg"><button data-k="" onclick="V4Items.kind(\'\')">الكل</button>' +
      '<button data-k="book" onclick="V4Items.kind(\'book\')">كتب</button>' +
      '<button data-k="stat" onclick="V4Items.kind(\'stat\')">قرطاسية</button></div>' +
      (V4.can("edit_items") ? '<button class="btn primary" onclick="V4Items.edit(0)">+ صنف جديد</button>' : "") +
      '</div><div class="muted small" id="itCount" style="margin:-4px 2px 10px"></div>' +
      '<div id="itWait"></div>' +
      '<div class="card"><div id="itBody"><div class="card-body muted">…</div></div></div>' +
      '<div id="itBranch"></div>' +
      '<div class="pager" id="itPager"></div>';
  }

  /* جهاز ثانٍ: الأصناف التي أُرسلت لجهاز المحل ولم تصل بعد، وما رُفض منها */
  var ITEM_CMDS = ["item.add", "item.edit", "item.delete"];
  function waiting() {
    if (V4Sync.isSecond()) V4Sync.loadOutbox(document.getElementById("itWait"), ITEM_CMDS);
  }

  function after() {
    paintKind();
    loadPlaces().then(load, load);
    waiting();
    var q = document.getElementById("itQ");
    if (q) q.focus();
  }

  function paintKind() {
    Array.prototype.forEach.call(document.querySelectorAll(".toolbar .seg button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-k") === f.kind);
    });
  }

  function search(q) { f.q = q; f.offset = 0; load(); }
  function kind(k) { f.kind = k; f.offset = 0; paintKind(); load(); }
  function more(n) { f.offset = Math.max(0, f.offset + n); load(); }

  function load() {
    var my = ++seq;
    var req = { limit: PAGE, offset: f.offset, sort: "new", channel: "items" };
    if (f.q.trim()) req.q = f.q;
    if (f.kind) req.kind = f.kind;
    V4.call("items.page", req).then(function (d) {
      if (my !== seq || d.cancelled) return;
      var body = document.getElementById("itBody");
      if (!body) return;
      var near = d.nearFrom === undefined ? -1 : d.nearFrom - f.offset;
      body.innerHTML = table(d.items, near);
      V4Sync.hint(!d.items.length || d.nearFrom === 0 ? f.q : "", document.getElementById("itBranch"));
      document.getElementById("itCount").textContent = d.total + (d.more ? "+" : "") + " صنف" +
        (f.q.trim() ? " يطابق «" + f.q.trim() + "»" : "");
      document.getElementById("itPager").innerHTML =
        (f.offset > 0 ? '<button class="btn sm" onclick="V4Items.more(-' + PAGE + ')">→ السابق</button>' : "") +
        (f.offset + PAGE < d.total ? '<button class="btn sm" onclick="V4Items.more(' + PAGE + ')">التالي ←</button>' : "");
    }).catch(function (e) { App.toast(e.message, "bad"); });
  }

  function table(rows, near) {
    if (!rows.length) {
      return App.table([], [], { emptyIcon: "books", emptyTitle: f.q.trim() ? "لا شيء يطابق «" + f.q.trim() + "»" : "لا أصناف بعد",
        emptyText: f.q.trim() ? "جرّب كلمة أقصر، أو اكتب جزءاً من الاسم." : "أضف أول كتاب بزر «+ صنف جديد»." });
    }
    var h = '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      "<th>الرمز</th><th>الاسم</th><th>المؤلف / الماركة</th><th>المكان</th><th>السعر</th><th>الكمية</th><th></th>" +
      "</tr></thead><tbody>";
    rows.forEach(function (it, i) {
      if (i === near) {
        h += '<tr class="near-head"><td colspan="7">' + App.icon("search", 14) + " " +
          (i === 0 ? "ما لقيناش «" + esc(f.q.trim()) + "» بالضبط — هل تقصد؟" : "نتائج قريبة (فيها اختلاف بسيط في الكتابة)") + "</td></tr>";
      }
      var st = it.qty <= 0 ? "bad" : it.qty <= it.min ? "warn" : "ok";
      h += '<tr class="' + (near >= 0 && i >= near ? "near-row" : "") + '">' +
        '<td class="num">' + esc(it.code) + "</td>" +
        '<td><b class="name">' + esc(it.title) + "</b>" + (it.barcode ? '<div class="muted small num">' + esc(it.barcode) + "</div>" : "") + "</td>" +
        "<td>" + esc(it.author || it.brand) + "</td>" +
        '<td><span class="place-path">' + esc(placePath(it.homePlaceId)) + "</span></td>" +
        '<td class="num">' + money(it.price) + "</td>" +
        '<td><span class="badge ' + st + '">' + it.qty + "</span></td>" +
        "<td>" + (V4.can("edit_items") ? '<button class="btn sm" onclick="V4Items.edit(' + it.id + ')">تعديل</button>' : "") + "</td>" +
        "</tr>";
    });
    return h + "</tbody></table></div>";
  }

  /* ---------- الإضافة والتعديل ---------- */

  function edit(id) {
    var get = id ? V4.run("item.get", { id: id }) : Promise.resolve(null);
    Promise.all([get, loadPlaces(), V4.call("categories.list", { kind: "book" }).catch(function () { return []; }),
      V4.call("categories.list", { kind: "stat" }).catch(function () { return []; }),
      V4.call("publishers.list").catch(function () { return []; })]).then(function (r) {
      var it = r[0], pl = r[1], cats = r[2].concat(r[3]), pubs = r[4];
      /* سعر الجملة من خصم دار النشر، كما في 3.x: قطاعي 100 وخصمها 10% ← جملة 90 */
      var pubOf = function (name) {
        var n = App.norm(name).trim();
        for (var i = 0; n && i < pubs.length; i++) if (App.norm(pubs[i].name).trim() === n) return pubs[i];
        return null;
      };
      var fromPub = function (price, pub) {
        return pub && pub.rateBp > 0 && pub.rateBp < 10000 ? Math.round(V4.dirhams(price) * (10000 - pub.rateBp) / 10000) : 0;
      };
      var cost = V4.can("view_cost");
      var spots = pl.filter(function (p) { return p.kind !== "store"; }).map(function (p) { return { v: p.id, t: p.path }; });
      spots.unshift({ v: 1, t: "المحل (بلا مكان محدد)" });
      var m = V4.form({
        title: it ? "تعديل: " + it.title : "صنف جديد",
        size: "wide",
        values: it ? {
          kind: it.kind, title: it.title, by: it.author || it.brand, publisher: it.publisher, barcode: it.barcode, code: it.code,
          cat: it.cat, price: money(it.price), priceW: money(it.priceW), cost: it.cost !== undefined ? money(it.cost) : "",
          min: it.min, place: it.homePlaceId, note: it.note
        } : { kind: "book", place: 1, min: 1 },
        fields: [
          it ? null : { k: "kind", label: "النوع", type: "select", options: [{ v: "book", t: "كتاب" }, { v: "stat", t: "قرطاسية" }] },
          { k: "title", label: "الاسم", required: true, full: true, placeholder: "مثلاً: الفيزياء الأساسية الجزء الثاني" },
          { k: "by", label: "المؤلف (أو الماركة للقرطاسية)", placeholder: "مثلاً: د. أشرف محمود" },
          { k: "publisher", label: "دار النشر", list: pubs.map(function (p) { return p.name; }) },
          { k: "barcode", label: "الباركود", placeholder: "امسحه بالقارئ هنا" },
          { k: "code", label: "الرمز", placeholder: "فارغ = يُعطى تلقائياً" },
          { k: "cat", label: "التصنيف", list: cats },
          { k: "place", label: "المكان", type: "select", options: spots },
          { k: "price", label: "سعر البيع (قطاعي)", type: "money", required: true, min: 0 },
          { k: "priceW", label: "سعر الجملة", type: "money", min: 0, hint: "فارغ أو صفر = نفس سعر القطاعي" },
          cost ? { k: "cost", label: "سعر الشراء", type: "money", min: 0 } : null,
          { k: "min", label: "حدّ التنبيه", type: "number", min: 0, hint: "ينبّه حين تقل الكمية في المحل عنه" },
          it ? null : { k: "qty", label: "الكمية الموجودة الآن", type: "number", min: 0, def: 0 },
          { k: "note", label: "ملاحظة", type: "textarea", full: true }
        ],
        onChange: function (key, val, scope, vals) {
          if (key !== "publisher" && key !== "price") return;
          var pub = pubOf(vals.publisher), pw = fromPub(vals.price, pub);
          if (pw <= 0) return;
          App.setField(scope, "priceW", money(pw));
          if (key === "publisher") App.toast("سعر الجملة بخصم " + Math.round(pub.rateBp) / 100 + "%: " + money(pw), "ok");
        },
        onSave: function (v) {
          var k = it ? it.kind : v.kind;
          if (App.num(v.priceW) <= 0 && v.publisher) {
            var auto = fromPub(v.price, pubOf(v.publisher));
            if (auto > 0) v.priceW = money(auto);
          }
          var body = {
            title: v.title, publisher: v.publisher, barcode: App.digits(v.barcode).trim(), code: v.code, cat: v.cat,
            price: V4.dirhams(v.price), priceW: V4.dirhams(v.priceW), min: Math.round(App.num(v.min)),
            homePlaceId: Number(v.place) || 1, note: v.note
          };
          if (k === "book") body.author = v.by; else body.brand = v.by;
          if (cost) body.cost = V4.dirhams(v.cost);
          if (it) {
            body.id = it.id;
            return V4.run("item.edit", body).then(function (r) {
              if (V4.queued(r, "تعديل «" + v.title + "»")) { waiting(); return; }
              App.toast("حُفظ: " + v.title, "ok");
              load();
            });
          } else {
            body.kind = k;
            body.qty = Math.round(App.num(v.qty));
            body.placeId = body.homePlaceId;
            return V4.run("item.add", body).then(function (r) {
              if (V4.queued(r, "«" + v.title + "»")) { waiting(); return; }
              App.toast("أُضيف: " + v.title, "ok");
              load();
            });
          }
        }
      });
      if (it) {
        var foot = m.el.querySelector(".m-foot");
        if (foot) {
          var del = document.createElement("button");
          del.className = "btn danger";
          del.textContent = "حذف الصنف";
          del.onclick = function () { remove(it, m); };
          foot.insertBefore(del, foot.firstChild);
        }
      }
    });
  }

  function remove(it, m) {
    App.confirm("حذف «" + it.title + "»؟ فواتيره القديمة تبقى كما هي.", function () {
      V4.run("item.delete", { id: it.id }).then(function (r) {
        m.close();
        if (V4.queued(r, "حذف «" + it.title + "»")) { waiting(); return; }
        App.toast("حُذف: " + it.title, "ok");
        load();
      });
    }, { yes: "احذف", danger: true });
  }

  V4.page({ o: 40, g: "المخزون", k: "items", t: "الكتب والقرطاسية", ic: "books", perm: "search", render: list, after: after });

  return { search: search, kind: kind, more: more, edit: edit, refreshWaiting: function () { waiting(); load(); } };
})();
