/* ============================================================
   count.js — جرد المخزون الفعلي
   تعدّ ما على الرفوف فعلاً وتقارنه بالمسجّل، فتكتشف الفروق.
   ============================================================ */

var Count = (function () {

  function S() { return App.S; }

  var v = { scope: "all", lib: "", cat: "", q: "" };

  function session() { return S().countSession || null; }

  /* ---------- بدء الجرد وإنهاؤه ---------- */

  function start() {
    var items = inScope();
    if (!items.length) { App.toast("لا توجد أصناف في هذا النطاق.", "warn"); return; }

    S().countSession = {
      id: App.uid(),
      at: App.nowStamp(),
      scope: v.scope, lib: v.lib, cat: v.cat,
      counted: {},        // itemId -> العدد المعدود
      n: items.length
    };
    App.log("جرد فعلي", "بدأ — " + items.length + " صنف");
    App.saveNow();
    App.rerender();
    App.toast("بدأ الجرد. امسح الباركود صنفاً صنفاً.");
    setTimeout(focusScan, 60);
  }

  function cancel() {
    App.confirm("سيُلغى الجرد الحالي وتضيع الأعداد التي أدخلتها. متأكد؟", function () {
      S().countSession = null;
      App.saveNow(); App.rerender();
    }, { danger: true, yes: "إلغاء الجرد" });
  }

  /* الأصناف الداخلة في نطاق الجرد */
  function inScope(sess) {
    var c = sess || session() || v;
    return App.allItems().filter(function (x) {
      if (c.scope === "lib") return x.type === "book" && String(x.it.lib) === String(c.lib);
      if (c.scope === "cat") return String(x.it.cat || "") === String(c.cat);
      if (c.scope === "books") return x.type === "book";
      if (c.scope === "stat") return x.type === "stat";
      return true;
    });
  }

  /* ---------- العدّ ---------- */

  function focusScan() {
    var e = document.getElementById("cntScan");
    if (e) { e.focus(); e.select(); }
  }

  function scanKey(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    var val = String(e.target.value || "").trim();
    if (!val) return;
    var hit = Inv.byBarcode(val);
    if (!hit) {
      var res = Inv.searchItems(val, 1);
      if (res.length) hit = res[0];
    }
    e.target.value = "";
    if (!hit) { App.toast("لا يوجد صنف بهذا الباركود: " + val, "bad"); return; }
    bump(hit.it.id, 1);
  }

  function bump(id, by) {
    var s = session();
    if (!s) return;
    var cur = App.num(s.counted[id]);
    var nv = Math.max(cur + App.num(by), 0);
    s.counted[id] = nv;
    App.save();
    paint();
    var it = App.findItem("book", id) || App.findItem("stat", id);
    if (it) App.toast(App.itemName(it) + " → " + nv, "ok");
  }

  function setCount(id, val) {
    var s = session();
    if (!s) return;
    var n = String(val).trim();
    if (n === "") delete s.counted[id];
    else s.counted[id] = Math.max(App.num(n), 0);
    App.save();
    paint();
  }

  function countAllAsRecorded() {
    var s = session();
    if (!s) return;
    App.confirm("سيُعتبر كل صنف لم تعدّه مطابقاً للمسجّل. استعملها في النهاية لتسريع الجرد.", function () {
      inScope().forEach(function (x) {
        if (s.counted[x.it.id] === undefined) s.counted[x.it.id] = App.num(x.it.qty);
      });
      App.saveNow(); App.rerender();
    }, { yes: "اعتبرها مطابقة" });
  }

  /* ---------- النتائج ---------- */

  function rows() {
    var s = session();
    if (!s) return [];
    return inScope().map(function (x) {
      var rec = App.num(x.it.qty);
      var has = s.counted[x.it.id] !== undefined;
      var got = has ? App.num(s.counted[x.it.id]) : null;
      return {
        type: x.type, it: x.it, rec: rec, got: got, has: has,
        diff: has ? got - rec : 0
      };
    });
  }

  function summary() {
    var r = rows();
    var a = { total: r.length, done: 0, ok: 0, less: 0, more: 0, lossQty: 0, lossVal: 0 };
    r.forEach(function (x) {
      if (!x.has) return;
      a.done++;
      if (x.diff === 0) a.ok++;
      else if (x.diff < 0) { a.less++; a.lossQty += -x.diff; a.lossVal += -x.diff * App.num(x.it.cost); }
      else a.more++;
    });
    return a;
  }

  function apply() {
    var s = session();
    if (!s) return;
    var r = rows().filter(function (x) { return x.has && x.diff !== 0; });
    if (!r.length) { App.toast("لا توجد فروق — المخزون مطابق تماماً.", "ok"); finish(); return; }

    App.confirm("سيُصحَّح المخزون في " + r.length + " صنفاً ليطابق ما عددته فعلاً.\n\n" +
      "الفروق تُسجَّل في سجل الحركات لتعود إليها لاحقاً.", function () {
        // يُحسب قبل التصحيح — بعده تصير كل الفروق صفراً
        var a = summary();
        var lines = r.map(function (x) {
          return { name: App.itemName(x.it), rec: x.rec, got: x.got, diff: x.diff, cost: App.num(x.it.cost) };
        });
        r.forEach(function (x) {
          x.it.qty = x.got;
          x.it.updated = App.nowStamp();
        });
        S().counts = S().counts || [];
        S().counts.unshift({
          id: s.id, at: s.at, doneAt: App.nowStamp(), scope: s.scope,
          total: a.total, done: a.done, ok: a.ok, less: a.less, more: a.more,
          lossQty: a.lossQty, lossVal: a.lossVal,
          lines: lines
        });
        App.log("جرد فعلي", "صُحّح " + r.length + " صنفاً · نقص " + a.lossQty + " قطعة");
        S().countSession = null;
        App.saveNow(); App.rerender();
        App.toast("صُحّح المخزون وحُفظ تقرير الجرد.");
      }, { yes: "صحّح المخزون" });
  }

  function finish() {
    S().countSession = null;
    App.saveNow(); App.rerender();
  }

  /* ---------- الصفحة ---------- */

  function page() {
    return session() ? active() : setup();
  }

  function setup() {
    var libs = S().meta.libraries || [];
    var cats = [];
    App.allItems().forEach(function (x) {
      var c = x.it.cat;
      if (c && cats.indexOf(c) < 0) cats.push(c);
    });
    var n = inScope(v).length;

    var h = '<div class="card" style="max-width:640px;margin:0 auto 20px"><div class="card-body" style="padding:28px">' +
      '<h3 style="font-family:var(--font-head);margin:0 0 6px;font-size:21px">جرد المخزون الفعلي</h3>' +
      '<p class="muted" style="margin:0 0 20px;line-height:1.85">تعدّ ما على الرفوف فعلاً وتقارنه بالمسجّل في البرنامج. ' +
      "تمسح باركود كل نسخة فيزيد العدّاد، وفي النهاية يريك أين النقص وكم يساوي.</p>" +

      '<div class="field"><label>ماذا تجرد؟</label>' +
      '<select class="inp" onchange="Count.setV(\'scope\',this.value)">' +
      '<option value="all"' + (v.scope === "all" ? " selected" : "") + ">كل المخزون</option>" +
      '<option value="books"' + (v.scope === "books" ? " selected" : "") + ">الكتب فقط</option>" +
      '<option value="stat"' + (v.scope === "stat" ? " selected" : "") + ">القرطاسية فقط</option>" +
      '<option value="lib"' + (v.scope === "lib" ? " selected" : "") + ">مكتبة واحدة (خزانة)</option>" +
      '<option value="cat"' + (v.scope === "cat" ? " selected" : "") + ">تصنيف واحد</option>" +
      "</select></div>" +

      (v.scope === "lib"
        ? '<div class="field" style="margin-top:12px"><label>المكتبة</label>' +
          '<select class="inp" onchange="Count.setV(\'lib\',this.value)">' +
          libs.map(function (l) { return '<option' + (v.lib === l ? " selected" : "") + ">" + App.esc(l) + "</option>"; }).join("") +
          "</select></div>"
        : "") +
      (v.scope === "cat"
        ? '<div class="field" style="margin-top:12px"><label>التصنيف</label>' +
          '<select class="inp" onchange="Count.setV(\'cat\',this.value)">' +
          cats.map(function (c) { return '<option' + (v.cat === c ? " selected" : "") + ">" + App.esc(c) + "</option>"; }).join("") +
          "</select></div>"
        : "") +

      '<div class="row" style="margin-top:20px;align-items:center">' +
      '<span class="badge info">' + n + " صنف في هذا النطاق</span>" +
      '<div class="spacer"></div>' +
      '<button class="btn primary lg" onclick="Count.start()">ابدأ الجرد</button></div>' +
      "</div></div>";

    var prev = S().counts || [];
    if (prev.length) {
      h += '<div class="card"><div class="card-head"><h3>عمليات الجرد السابقة</h3></div>' +
        App.table([
          { h: "التاريخ", c: function (c) { return App.esc(String(c.doneAt).slice(0, 16)); } },
          { h: "النطاق", c: function (c) { return scopeName(c.scope); } },
          { h: "عُدّ", cls: "num", c: function (c) { return c.done + " / " + c.total; } },
          { h: "مطابق", cls: "num", c: function (c) { return '<span class="badge ok">' + c.ok + "</span>"; } },
          { h: "ناقص", cls: "num", c: function (c) { return c.less ? '<span class="badge bad">' + c.less + "</span>" : "—"; } },
          { h: "زائد", cls: "num", c: function (c) { return c.more ? '<span class="badge warn">' + c.more + "</span>" : "—"; } },
          {
            h: "قيمة النقص", cls: "num", c: function (c) {
              return App.canProfit() ? App.money0(c.lossVal) : "—";
            }
          },
          {
            h: "", cls: "act", c: function (c) {
              return '<button class="btn sm" onclick="Count.showPast(\'' + c.id + '\')">التفاصيل</button>';
            }
          }
        ], prev.slice(0, 20)) + "</div>";
    }
    return h;
  }

  function scopeName(k) {
    if (k === "books") return "الكتب";
    if (k === "stat") return "القرطاسية";
    if (k === "lib") return "مكتبة";
    if (k === "cat") return "تصنيف";
    return "كل المخزون";
  }

  function active() {
    var s = session();
    var a = summary();
    var pct = a.total ? Math.round((a.done / a.total) * 100) : 0;

    var h = '<div class="card" style="margin-bottom:18px"><div class="card-body">' +
      '<div class="row" style="margin-bottom:14px">' +
      '<span class="badge info">' + scopeName(s.scope) + "</span>" +
      '<span class="muted small">بدأ ' + App.esc(String(s.at).slice(11, 16)) + "</span>" +
      '<div class="spacer"></div>' +
      '<button class="btn ghost" onclick="Count.cancel()">إلغاء الجرد</button>' +
      '<button class="btn" onclick="Count.countAllAsRecorded()">الباقي مطابق</button>' +
      '<button class="btn primary lg" onclick="Count.apply()">إنهاء وتصحيح المخزون</button>' +
      "</div>" +
      '<input class="big-input" id="cntScan" placeholder="امسح باركود النسخة… كل مسحة تزيد العدّاد واحداً" ' +
      'autocomplete="off" onkeydown="Count.scanKey(event)">' +
      '<div class="prog"><div class="prog-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="row small muted" style="margin-top:6px"><span>عُدّ ' + a.done + " من " + a.total + " صنفاً</span>" +
      '<div class="spacer"></div><span>' + pct + "%</span></div>" +
      "</div></div>";

    h += '<div class="grid g4" style="margin-bottom:18px">' +
      stat("accent", "مطابق", String(a.ok), "العدد صحيح") +
      stat(a.less ? "bad" : "accent", "ناقص", String(a.less), a.lossQty ? a.lossQty + " قطعة مفقودة" : "") +
      stat(a.more ? "warn" : "accent", "زائد", String(a.more), "أكثر من المسجّل") +
      stat("blue", "لم يُعدّ بعد", String(a.total - a.done), "") +
      "</div>";

    h += '<div class="card"><div class="card-head"><h3>الأصناف</h3><div class="spacer"></div>' +
      '<div class="search-wrap" style="max-width:280px"><span class="mag">⌕</span>' +
      '<input class="inp" placeholder="ابحث…" value="' + App.esc(v.q) + '" oninput="Count.setV(\'q\',this.value)"></div></div>' +
      '<div id="cntRows"></div></div>';
    return h;
  }

  function stat(kind, lbl, val, foot) {
    return '<div class="card stat ' + kind + '"><div class="lbl">' + App.esc(lbl) + "</div>" +
      '<div class="val">' + val + "</div>" +
      (foot ? '<div class="foot">' + App.esc(foot) + "</div>" : "") + "</div>";
  }

  function paint() {
    var host = document.getElementById("cntRows");
    if (!host) return;
    var nq = App.norm(v.q);
    var r = rows().filter(function (x) {
      if (!nq) return true;
      return App.norm(App.itemName(x.it) + " " + (x.it.barcode || "") + " " + (x.it.author || "")).indexOf(nq) >= 0;
    });
    r.sort(function (a, b) {
      if (a.has !== b.has) return a.has ? 1 : -1;          // غير المعدود أولاً
      return Math.abs(b.diff) - Math.abs(a.diff);
    });

    host.innerHTML = App.table([
      {
        h: "الصنف", c: function (x) {
          return '<div class="name">' + App.esc(App.itemName(x.it)) + "</div>" +
            '<div class="sub">' + (x.type === "book" ? App.locChip(x.it) : App.esc(x.it.loc || "—")) +
            (x.it.barcode ? ' · <span class="num">' + App.esc(x.it.barcode) + "</span>" : "") + "</div>";
        }
      },
      { h: "المسجّل", cls: "num", c: function (x) { return x.rec; } },
      {
        h: "المعدود", cls: "num", c: function (x) {
          return '<input class="inp num cnt-in" type="number" min="0" style="width:88px" ' +
            'value="' + (x.has ? x.got : "") + '" placeholder="—" ' +
            'onchange="Count.setCount(\'' + x.it.id + '\',this.value)">';
        }
      },
      {
        h: "الفرق", cls: "num", c: function (x) {
          if (!x.has) return '<span class="muted">لم يُعدّ</span>';
          if (x.diff === 0) return '<span class="badge ok">مطابق</span>';
          return '<span class="badge ' + (x.diff < 0 ? "bad" : "warn") + '">' +
            (x.diff > 0 ? "+" : "") + x.diff + "</span>";
        }
      },
      {
        h: "", cls: "act", c: function (x) {
          return '<button class="btn sm" onclick="Count.bump(\'' + x.it.id + '\',1)">+1</button> ' +
            '<button class="btn sm ghost" onclick="Count.bump(\'' + x.it.id + '\',-1)">−1</button>';
        }
      }
    ], r, { emptyIcon: "books", emptyTitle: "لا نتيجة", emptyText: "" });
  }

  function setV(k, val) {
    v[k] = val;
    if (k === "q") paint();
    else App.rerender();
  }

  function showPast(id) {
    var c = null;
    (S().counts || []).forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return;
    App.modal({
      title: "تفاصيل جرد " + String(c.doneAt).slice(0, 10),
      size: "wide",
      body: '<div class="row" style="margin-bottom:12px">' +
        '<span class="badge ok">مطابق ' + c.ok + "</span>" +
        '<span class="badge bad">ناقص ' + c.less + "</span>" +
        '<span class="badge warn">زائد ' + c.more + "</span>" +
        (App.canProfit() ? '<span class="badge info">قيمة النقص ' + App.money0(c.lossVal) + "</span>" : "") +
        "</div>" +
        App.table([
          { h: "الصنف", c: function (l) { return App.esc(l.name); } },
          { h: "المسجّل", cls: "num", c: function (l) { return l.rec; } },
          { h: "المعدود", cls: "num", c: function (l) { return l.got; } },
          {
            h: "الفرق", cls: "num", c: function (l) {
              return '<b style="color:' + (l.diff < 0 ? "var(--stamp)" : "var(--amber)") + '">' +
                (l.diff > 0 ? "+" : "") + l.diff + "</b>";
            }
          }
        ], c.lines || []),
      actions: [{
        label: "تصدير Excel", click: function () {
          App.xls("جرد-فعلي-" + String(c.doneAt).slice(0, 10), "تقرير الجرد الفعلي", [
            { h: "الصنف", c: function (l) { return l.name; } },
            { h: "المسجّل", t: "i", sum: true, c: function (l) { return l.rec; } },
            { h: "المعدود", t: "i", sum: true, c: function (l) { return l.got; } },
            { h: "الفرق", t: "i", sum: true, c: function (l) { return l.diff; } }
          ], c.lines || [], S().meta.shopName || "");
        }
      }]
    });
  }

  function afterRender() {
    if (session()) { paint(); focusScan(); }
  }

  return {
    page: page, afterRender: afterRender, start: start, cancel: cancel,
    scanKey: scanKey, bump: bump, setCount: setCount, setV: setV,
    apply: apply, countAllAsRecorded: countAllAsRecorded, showPast: showPast
  };
})();
