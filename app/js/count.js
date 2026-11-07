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

  /* الاسم المكتوب ليس مطابقاً — نعرض الأقرب وأنت تختار، ولا يُعدّ شيء قبلها */
  function nearPick(res, typed) {
    var box = document.createElement("div");
    box.innerHTML = '<p class="muted small" style="margin-top:0">ما لقيناش «' + App.esc(typed) +
      '» بالضبط. اختر الصنف الصحيح ليُعدّ:</p><div class="near-list"></div>';
    var list = box.querySelector(".near-list"), m;
    res.forEach(function (x) {
      var b = document.createElement("button");
      b.className = "near-opt";
      b.innerHTML = "<b>" + App.esc(App.itemName(x.it)) + "</b><span>" +
        App.esc(x.it.author || x.it.brand || "") + (x.it.barcode ? " · " + App.esc(x.it.barcode) : "") + "</span>";
      b.onclick = function () { m.close(); bump(x.it.id, 1); focusScan(); };
      list.appendChild(b);
    });
    m = App.modal({ title: "هل تقصد؟", size: "narrow", body: box, actions: [] });
  }

  function scanKey(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    var val = String(e.target.value || "").trim();
    if (!val) return;
    var hit = Inv.byBarcode(val);
    if (!hit) {
      var res = Inv.searchItems(val, 3);
      if (App.exactCount(res)) hit = res[0];
      else if (res.length) {
        // لا نعدّ صنفاً تقريبياً من غير ما تختاره — «هل تقصد؟»
        nearPick(res, val);
        e.target.value = "";
        return;
      }
    }
    e.target.value = "";
    if (!hit) { App.toast("لا يوجد صنف بهذا الباركود: " + val, "bad"); return; }
    bump(hit.it.id, 1);
  }

  /* المسجَّل لحظة العدّ — لا لحظة التصحيح.

     الجرد يمتد ساعات والمحل يبيع. كان التصحيح يقارن العدد بالمسجَّل
     «الآن»: عددتَ 5 على الرف، بِعتَ 2، ثم صحّحت ⇦ «مسجَّل 3، معدود 5»
     ⇦ يصير المخزون 5 وتعود النسختان المبيعتان من العدم.

     الآن يُحفظ المسجَّل مع كل عدّ، والتصحيح يضيف الفرق فقط على ما
     هو مسجَّل الآن: 3 + (5 − 5) = 3. */
  function mark(s, id) {
    var it = App.findItem("book", id) || App.findItem("stat", id);
    if (!s.base) s.base = {};
    if (it) s.base[id] = App.num(it.qty);
  }

  function bump(id, by) {
    var s = session();
    if (!s) return;
    var cur = App.num(s.counted[id]);
    var nv = Math.max(cur + App.num(by), 0);
    s.counted[id] = nv;
    mark(s, id);
    App.save();
    paint();
    var it = App.findItem("book", id) || App.findItem("stat", id);
    if (it) App.toast(App.itemName(it) + " → " + nv, "ok");
  }

  function setCount(id, val) {
    var s = session();
    if (!s) return;
    var n = String(val).trim();
    if (n === "") { delete s.counted[id]; if (s.base) delete s.base[id]; }
    else { s.counted[id] = Math.max(App.num(n), 0); mark(s, id); }
    App.save();
    paint();
  }

  function countAllAsRecorded() {
    var s = session();
    if (!s) return;
    App.confirm("سيُعتبر كل صنف لم تعدّه مطابقاً للمسجّل. استعملها في النهاية لتسريع الجرد.", function () {
      inScope().forEach(function (x) {
        if (s.counted[x.it.id] === undefined) { s.counted[x.it.id] = App.num(x.it.qty); mark(s, x.it.id); }
      });
      App.saveNow(); App.rerender();
    }, { yes: "اعتبرها مطابقة" });
  }

  /* ---------- النتائج ---------- */

  function rows() {
    var s = session();
    if (!s) return [];
    return inScope().map(function (x) {
      var has = s.counted[x.it.id] !== undefined;
      // جلسة قديمة بلا base: كما كان — المسجَّل الآن
      var rec = has && s.base && s.base[x.it.id] !== undefined ? App.num(s.base[x.it.id]) : App.num(x.it.qty);
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
          x.it.qty = App.num(x.it.qty) + x.diff;     // ما بِيع أو استُلم بعد العدّ يبقى محسوباً
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
    var r = rows().slice();
    r.sort(function (a, b) {
      if (a.has !== b.has) return a.has ? 1 : -1;          // غير المعدود أولاً
      return Math.abs(b.diff) - Math.abs(a.diff);
    });
    r = App.rank(r, v.q, function (x) {
      return [App.itemName(x.it), x.it.barcode, x.it.author];
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

  /* ============================================================
     X4: الجرد الأول رفاً رفاً (طرابلس)
     ------------------------------------------------------------
     كتب المنظومة القديمة دخلت «لم يُجرد» بكمية صفر. يُختار رف، ويُمسح كل كتاب عليه:
     أول مسحة لكتاب لم يُجرد تجعل كميته 1 وتخرجه من «لم يُجرد»، وكل مسحة بعدها نسخة أخرى
     (على هذا الرف أو غيره). الكتاب يأخذ مكان الرف، وتخصص الرف إن لم يكن له تخصص.
     الكتاب غير المسجّل يُضاف من نافذة صغيرة دون مغادرة الجرد. البيع مستمر: ما يُباع بعد
     جرده ينقص من كميته المعدودة كأي بيع
     ============================================================ */
  var fc = { lib: "", shelf: "1", cat: "", lines: {}, order: [] };

  function fcProgress() {
    var tot = 0, unc = 0, byCat = {}, byLib = {};
    S().books.forEach(function (b) {
      if (!b.uncounted && !b.counted) return;           // ما دخل الجرد الأول أصلاً (كتب قبله)
      tot++;
      var c = b.cat || "بلا تخصص", l = b.uncounted ? "—" : (b.lib || "—");
      var x = byCat[c] || (byCat[c] = { t: 0, d: 0 }); x.t++;
      if (b.uncounted) unc++; else { x.d++; byLib[l] = (byLib[l] || 0) + 1; }
    });
    return { tot: tot, done: tot - unc, left: unc, byCat: byCat, byLib: byLib };
  }

  function firstPage() {
    if (!App.can("count")) return '<div class="card"><p style="margin:0">الجرد يحتاج صلاحية «جرد المخزون».</p></div>';
    var libs = S().meta.libraries || [];
    if (!fc.lib) fc.lib = libs[0] || "A";
    var p = fcProgress(), pct = p.tot ? Math.round(100 * p.done / p.tot) : 0;
    var cats = Object.keys(p.byCat).sort(function (a, b) { return p.byCat[b].t - p.byCat[a].t; }).slice(0, 8);
    var shelves = +(S().meta.shelves || 6);
    var h = '<div class="grid g3" style="margin-bottom:16px">' +
      '<div class="card stat accent"><div class="lbl">جُرد</div><div class="val num">' + p.done.toLocaleString("en") + "</div>" +
      '<div class="foot">من ' + p.tot.toLocaleString("en") + " كتاب · " + pct + "%</div></div>" +
      '<div class="card stat warn"><div class="lbl">لم يُجرد بعد</div><div class="val num">' + p.left.toLocaleString("en") + "</div>" +
      '<div class="foot">كميته غير معروفة حتى يُجرد</div></div>' +
      '<div class="card stat"><div class="lbl">على هذا الرف</div><div class="val num">' + fc.order.reduce(function (a, id) { return a + (fc.lines[id] || 0); }, 0) + "</div>" +
      '<div class="foot">' + fc.order.length + " عنوان · خزانة " + App.esc(fc.lib) + " · رف " + App.esc(fc.shelf) + "</div></div></div>";

    h += '<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>الرف الحالي</h3><div class="spacer"></div>' +
      '<button class="btn sm" onclick="Count.fcNextShelf()">انتهى هذا الرف ← الرف التالي</button></div>' +
      '<div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">' +
      '<label class="fld" style="margin:0"><span>الخزانة</span><select class="inp" style="width:auto" onchange="Count.fcSet(\'lib\',this.value)">' +
      libs.map(function (l) { return '<option' + (l === fc.lib ? " selected" : "") + ">" + App.esc(l) + "</option>"; }).join("") + "</select></label>" +
      '<label class="fld" style="margin:0"><span>الرف</span><select class="inp" style="width:auto" onchange="Count.fcSet(\'shelf\',this.value)">' +
      Array.apply(null, Array(Math.max(shelves, +fc.shelf || 1))).map(function (_, i) { var n = String(i + 1); return '<option' + (n === String(fc.shelf) ? " selected" : "") + ">" + n + "</option>"; }).join("") +
      "</select></label>" +
      '<label class="fld" style="margin:0;flex:1;min-width:200px"><span>تخصص هذا الرف (اختياري)</span><input class="inp" list="fcCats" value="' + App.esc(fc.cat) + '" onchange="Count.fcSet(\'cat\',this.value)" placeholder="يأخذه الكتاب الذي بلا تخصص">' +
      '<datalist id="fcCats">' + Object.keys(p.byCat).filter(function (c) { return c !== "بلا تخصص"; }).sort().map(function (c) { return '<option value="' + App.esc(c) + '">'; }).join("") + "</datalist></label></div>" +
      '<div class="search-wrap" style="max-width:none"><span class="mag">⌕</span><input class="inp lg" id="fcScan" placeholder="امسح باركود الكتاب، أو اكتب اسمه…" autocomplete="off" onkeydown="Count.fcKey(event)" oninput="Count.fcSuggest(this.value)"></div>' +
      '<div id="fcSug" style="position:relative"></div></div>';

    var rows = fc.order.map(function (id) { return App.findItem("book", id); }).filter(Boolean);
    h += '<div class="grid g2"><div class="card"><div class="card-head"><h3>ما جُرد على هذا الرف</h3></div>' +
      App.table([
        { h: "الكتاب", c: function (b) { return '<div class="name">' + App.esc(b.title) + '</div><div class="sub">' + App.esc(b.cat || "بلا تخصص") + (b.barcode ? "" : ' · <span class="q-bad">بلا باركود — في «طباعة اللاصقات»</span>') + "</div>"; } },
        { h: "هنا", cls: "num", c: function (b) { return "<b>" + (fc.lines[b.id] || 0) + "</b>"; } },
        { h: "كل نسخه", cls: "num", c: function (b) { return App.num(b.qty); } },
        { h: "", cls: "act", c: function (b) { return '<button class="btn sm" onclick="Count.fcBump(\'' + b.id + '\',-1)">−</button> <button class="btn sm" onclick="Count.fcBump(\'' + b.id + '\',1)">+</button>'; } }
      ], rows.slice().reverse(), { emptyIcon: "books", emptyTitle: "ابدأ بالمسح", emptyText: "كل كتاب تمسحه يظهر هنا بعدده على هذا الرف." }) + "</div>" +
      '<div class="card"><div class="card-head"><h3>التقدم حسب التخصص</h3></div>' +
      App.table([
        { h: "التخصص", c: function (c) { return App.esc(c); } },
        { h: "جُرد", cls: "num", c: function (c) { return p.byCat[c].d.toLocaleString("en") + " / " + p.byCat[c].t.toLocaleString("en"); } },
        { h: "", c: function (c) { var w = p.byCat[c].t ? Math.round(100 * p.byCat[c].d / p.byCat[c].t) : 0; return '<div style="background:var(--line-soft);border-radius:4px;height:8px;min-width:80px"><div style="width:' + w + '%;background:var(--accent);height:8px;border-radius:4px"></div></div>'; } }
      ], cats) + "</div></div>";
    return h;
  }

  function fcSet(k, v) {
    if ((k === "lib" || k === "shelf") && fc.order.length && String(fc[k]) !== String(v)) fcLogShelf();
    fc[k] = String(v || "").trim();
    if (k === "lib" || k === "shelf") { fc.lines = {}; fc.order = []; }
    App.rerender(); fcFocus();
  }

  function fcLogShelf() {
    var n = fc.order.reduce(function (a, id) { return a + (fc.lines[id] || 0); }, 0);
    if (n) App.log("جرد أول", "خزانة " + fc.lib + " · رف " + fc.shelf + ": " + fc.order.length + " عنوان، " + n + " نسخة");
  }

  function fcNextShelf() {
    fcLogShelf();
    fc.shelf = String((+fc.shelf || 0) + 1);
    fc.lines = {}; fc.order = [];
    App.save(); App.rerender(); fcFocus();
    App.toast("الرف " + fc.shelf + " في خزانة " + fc.lib + ".");
  }

  function fcFocus() { setTimeout(function () { var e = document.getElementById("fcScan"); if (e) e.focus(); }, 30); }

  /* مسحة واحدة = نسخة واحدة */
  function fcCount(b, n) {
    n = n || 1;
    if (b.uncounted) { b.qty = 0; delete b.uncounted; b.counted = App.today(); }
    b.qty = Math.max(App.num(b.qty) + n, 0);
    if (n > 0) {
      b.lib = fc.lib; b.shelf = fc.shelf;
      if (fc.cat && !b.cat) b.cat = fc.cat;
    }
    b.updated = App.nowStamp();
    if (!fc.lines[b.id]) fc.order.push(b.id);
    fc.lines[b.id] = Math.max((fc.lines[b.id] || 0) + n, 0);
    App.save();
  }

  function fcHit(b) {
    fcCount(b, 1);
    var e = document.getElementById("fcScan");
    App.rerender();
    App.toast("✓ " + b.title + " — هنا " + fc.lines[b.id], "ok");
    fcFocus();
    if (e) e.value = "";
  }

  function fcKey(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    var v = String(e.target.value || "").trim();
    if (!v) return;
    var hit = Inv.byBarcode(v);
    if (hit && hit.type === "book") { fcHit(hit.it); return; }
    var res = Inv.searchItems(v, 9).filter(function (x) { return x.type === "book"; });
    if (/^\d{4,}$/.test(v) || !res.length) { fcNew(v); return; }
    if (res.length === 1 && App.norm(res[0].it.title) === App.norm(v)) { fcHit(res[0].it); return; }
    fcSuggest(v);
  }

  function fcSuggest(v) {
    var host = document.getElementById("fcSug");
    if (!host) return;
    v = String(v || "").trim();
    if (v.length < 2 || /^\d+$/.test(v)) { host.innerHTML = ""; return; }
    var res = Inv.searchItems(v, 8).filter(function (x) { return x.type === "book"; });
    host.innerHTML = res.length ? '<div class="suggest">' + res.map(function (x) {
      var b = x.it;
      return '<button class="s-item rich" onclick="Count.fcPick(\'' + b.id + '\')"><span class="t"><b>' + App.esc(b.title) + "</b>" +
        '<span class="meta2">' + App.esc(b.author || "") + (b.barcode ? ' · <span class="num">' + App.esc(b.barcode) + "</span>" : " · بلا باركود") + "</span></span>" +
        '<span class="sp">' + (b.uncounted ? '<span class="badge">لم يُجرد</span>' : '<span class="badge ok">جُرد · ' + App.num(b.qty) + "</span>") + "</span></button>";
    }).join("") + '<button class="s-item" onclick="Count.fcNew(document.getElementById(\'fcScan\').value)">+ كتاب غير مسجّل</button></div>' : "";
  }

  function fcPick(id) {
    var b = App.findItem("book", id);
    var host = document.getElementById("fcSug");
    if (host) host.innerHTML = "";
    if (b) fcHit(b);
  }

  function fcBump(id, n) {
    var b = App.findItem("book", id);
    if (!b) return;
    if (n < 0 && !(fc.lines[id] > 0)) return;
    fcCount(b, n);
    App.rerender(); fcFocus();
  }

  /* كتاب غير مسجّل: يُضاف في مكان الرف ويُعدّ نسخة */
  function fcNew(v) {
    v = String(v || "").trim();
    var isCode = /^\d{4,}$/.test(v);
    App.form({
      title: "كتاب غير مسجّل",
      topHtml: '<p class="muted" style="margin:0 0 10px">يُسجَّل في خزانة ' + App.esc(fc.lib) + " · رف " + App.esc(fc.shelf) + "، ويُعدّ نسخة واحدة.</p>",
      fields: [
        { k: "title", label: "العنوان", required: true },
        { k: "author", label: "المؤلف" },
        { k: "barcode", label: "الباركود" },
        { k: "cat", label: "التخصص" },
        { k: "price", label: "سعر البيع", type: "money", min: 0 }
      ],
      values: { title: isCode ? "" : v, barcode: isCode ? v : "", cat: fc.cat },
      saveLabel: "سجّله وعدّه",
      onSave: function (f) {
        var b = { id: App.uid(), code: App.nextCode("book"), title: f.title, author: f.author || "", publisher: "", cat: f.cat || "",
          lib: fc.lib, shelf: fc.shelf, barcode: f.barcode || "", cost: 0, price: App.num(f.price), priceW: 0, qty: 0, min: 0,
          counted: App.today(), created: App.nowStamp() };
        S().books.push(b);
        App.log("كتاب جديد (جرد أول)", b.title);
        fcHit(b);
      }
    });
  }

  return {
    firstPage: firstPage, fcSet: fcSet, fcNextShelf: fcNextShelf, fcKey: fcKey, fcSuggest: fcSuggest, fcPick: fcPick, fcBump: fcBump, fcNew: fcNew,
    page: page, afterRender: afterRender, start: start, cancel: cancel,
    scanKey: scanKey, bump: bump, setCount: setCount, setV: setV,
    apply: apply, countAllAsRecorded: countAllAsRecorded, showPast: showPast
  };
})();
