/* ============================================================
   branches.js — المخزون، الفروع المرتبطة، طلبات التحويل، المزامنة
   ============================================================ */

var Stock = (function () {

  var view = { where: "hub", id: "", q: "", cat: "", sort: "qty" };
  var find = "";            // البحث الموحّد في كل الفروع
  var autoTimer = null;
  var syncing = false;

  function S() { return App.S; }

  /* ============================================================
     اللقطة المنشورة للفروع الأخرى
     ============================================================ */

  function snapshot() {
    return {
      branch: {
        id: S().branch.id, name: S().branch.name || S().meta.shopName,
        city: S().branch.city, phone: S().branch.phone
      },
      at: App.nowStamp(),
      items: App.allItems().map(function (x) {
        var it = x.it;
        return {
          k: it.code || "", t: x.type, n: App.itemName(it), a: it.author || "",
          b: it.barcode || "", c: it.cat || "",
          q: App.num(it.qty), p: App.num(it.price), m: App.num(it.min),
          l: it.lib || "", s: it.shelf || "", loc: it.loc || ""
        };
      }),
      /* المخازن اليدوية ترافق اللقطة بأسماء أصنافها محلولة، ليعرضها
         عارض التلفون بلا حاجة للرجوع إلى جهاز المحل. */
      whs: (S().warehouses || []).map(function (w) {
        return {
          id: w.id, name: w.name || "", place: w.place || "", phone: w.phone || "",
          items: (w.stock || []).map(function (st) {
            var it = App.findItem(st.type, st.itemId);
            return {
              n: it ? App.itemName(it) : "(صنف محذوف)",
              t: st.type, q: App.num(st.qty),
              p: it ? App.num(it.price) : 0,
              b: it ? (it.barcode || it.code || "") : ""
            };
          })
        };
      }),
      msgs: S().outbox.slice(0, 400)
    };
  }

  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h);
  }

  /* ============================================================
     المزامنة
     ============================================================ */

  function configured() {
    return !!(S().sync.url && S().branch.id);
  }

  function sync(manual) {
    if (syncing) return Promise.resolve();
    if (!configured()) {
      if (manual) App.toast("اضبط الاتصال أولاً من زر «إعداد الربط».", "warn");
      return Promise.resolve();
    }
    syncing = true;
    paintSyncState("جارٍ التحديث…");

    var snap = snapshot();
    var body = JSON.stringify(snap);
    var h = hash(body);
    // لا نرفع إن لم يتغير شيء — يوفّر الحصة والباقة
    var skipUp = (h === S().sync.lastHash && !manual);

    return App.api("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: S().sync.url, key: S().sync.key,
        upload: skipUp ? null : snap
      })
    }).then(function (r) { return r.json(); }).then(function (res) {
      syncing = false;
      if (!res || !res.ok) {
        S().sync.lastOk = false;
        S().sync.lastError = (res && res.error) ? res.error : "تعذّر الاتصال";
        App.save(); paintSyncState();
        if (manual) App.toast("تعذّر التحديث: " + S().sync.lastError, "bad");
        return;
      }
      if (!skipUp) S().sync.lastHash = h;
      var seenBefore = {};
      requests().forEach(function (r) { seenBefore[r.id] = 1; });
      mergeRemotes(res.branches || []);
      if (typeof Notify !== "undefined") {
        try {
          requests().forEach(function (r) {
            if (!seenBefore[r.id] && r.to === S().branch.id && r._status === "pending") {
              Notify.transferRequest(branchName(r.from), r.lines);
            }
          });
        } catch (e) { }
      }
      S().sync.lastOk = true;
      S().sync.lastError = "";
      S().sync.lastAt = App.nowStamp();
      App.save();
      paintSyncState();
      App.refreshBadges();
      if (manual) {
        App.toast("حُدّث المخزون من " + S().remotes.length + " فرع.");
        App.rerender();
      }
    }).catch(function () {
      syncing = false;
      S().sync.lastOk = false;
      S().sync.lastError = "انقطع الاتصال";
      paintSyncState();
      if (manual) App.toast("تعذّر التحديث. تحقّق من الإنترنت.", "bad");
    });
  }

  function mergeRemotes(list) {
    var mine = S().branch.id;
    var keep = [];
    list.forEach(function (snap) {
      if (!snap || !snap.branch || !snap.branch.id) return;
      if (snap.branch.id === mine) return;
      keep.push({
        id: snap.branch.id, name: snap.branch.name || snap.branch.id,
        city: snap.branch.city || "", phone: snap.branch.phone || "",
        at: snap.at || "", items: snap.items || [], msgs: snap.msgs || []
      });
    });
    S().remotes = keep;
  }

  function startAuto() {
    if (autoTimer) clearInterval(autoTimer);
    if (!configured() || !S().sync.auto) return;
    var every = Math.max(2, App.num(S().sync.everyMin) || 10);
    sync(false);
    autoTimer = setInterval(function () { sync(false); }, every * 60000);
  }

  function paintSyncState(txt) {
    var e = document.getElementById("syncState");
    if (!e) return;
    if (txt) { e.innerHTML = '<span class="muted small">' + txt + "</span>"; return; }
    if (!configured()) { e.innerHTML = '<span class="badge">الربط غير مفعّل</span>'; return; }
    if (!S().sync.lastAt) { e.innerHTML = '<span class="badge warn">لم تتم أي مزامنة بعد</span>'; return; }
    var cls = S().sync.lastOk ? "ok" : "warn";
    e.innerHTML = '<span class="badge ' + cls + '">آخر تحديث: ' + App.esc(S().sync.lastAt) + "</span>" +
      (S().sync.lastOk ? "" : '<span class="muted small" style="margin-inline-start:8px">' + App.esc(S().sync.lastError) + "</span>");
  }

  function freshness(at) {
    if (!at) return '<span class="badge bad">لا توجد بيانات</span>';
    var then = new Date(String(at).replace(" ", "T"));
    var mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (isNaN(mins)) return '<span class="badge">' + App.esc(at) + "</span>";
    if (mins < 20) return '<span class="badge ok">محدَّث الآن</span>';
    if (mins < 180) return '<span class="badge ok">منذ ' + mins + " دقيقة</span>";
    if (mins < 1440) return '<span class="badge warn">منذ ' + Math.round(mins / 60) + " ساعة</span>";
    return '<span class="badge bad">منذ ' + Math.round(mins / 1440) + " يوم</span>";
  }

  /* ============================================================
     الرسائل وطلبات التحويل
     ============================================================ */

  function allMsgs() {
    var out = S().outbox.slice();
    S().remotes.forEach(function (r) { out = out.concat(r.msgs || []); });
    return out;
  }

  function requests() {
    var reqs = allMsgs().filter(function (m) { return m.kind === "req"; });
    var reps = {}, rcvs = {};
    allMsgs().forEach(function (m) {
      if (m.kind === "rep") reps[m.ref] = m;
      if (m.kind === "rcv") rcvs[m.ref] = m;
    });
    reqs.forEach(function (r) {
      r._rep = reps[r.id] || null;
      r._rcv = rcvs[r.id] || null;
      r._status = r._rcv ? "done" : (r._rep ? r._rep.status : "pending");
      r._mine = (r.from === S().branch.id);
    });
    reqs.sort(function (a, b) { return String(b.at) < String(a.at) ? -1 : 1; });
    return reqs;
  }

  function pendingCount() {
    if (!S().branch || !S().branch.id) return 0;
    var n = 0;
    requests().forEach(function (r) {
      if (r.to === S().branch.id && r._status === "pending") n++;
      if (r.from === S().branch.id && r._status === "shipped") n++;
    });
    return n;
  }

  function statusBadge(st) {
    if (st === "pending") return '<span class="badge warn">بانتظار الرد</span>';
    if (st === "shipped") return '<span class="badge info">في الطريق</span>';
    if (st === "rejected") return '<span class="badge bad">مرفوض</span>';
    if (st === "done") return '<span class="badge ok">تم الاستلام</span>';
    return '<span class="badge">—</span>';
  }

  function branchName(id) {
    if (id === S().branch.id) return S().branch.name || S().branch.city || "فرعي";
    var n = id;
    S().remotes.forEach(function (r) { if (r.id === id) n = r.name || r.city || r.id; });
    return n;
  }

  function pushMsg(m) {
    m.id = m.id || App.uid();
    m.at = App.nowStamp();
    m.from = S().branch.id;
    S().outbox.unshift(m);
    if (S().outbox.length > 400) S().outbox.length = 400;
    S().sync.lastHash = "";      // يجبر الرفع في المزامنة القادمة
  }

  /* يطابق صنفاً من فرع آخر مع الكتالوج المحلي */
  function resolveLocal(ri) {
    var hit = null;
    App.allItems().forEach(function (x) {
      if (hit) return;
      if (ri.b && String(x.it.barcode || "") === String(ri.b)) hit = x;
    });
    if (hit) return hit;
    App.allItems().forEach(function (x) {
      if (hit) return;
      if (App.norm(App.itemName(x.it)) === App.norm(ri.n)) hit = x;
    });
    return hit;
  }

  function askTransfer(branchId, ri) {
    App.form({
      title: "طلب تحويل من " + branchName(branchId),
      size: "narrow",
      values: { qty: 1 },
      fields: [
        { k: "qty", label: "الكمية المطلوبة", type: "number", min: 1, required: true, full: true, hint: "المتوفر عندهم: " + App.num(ri.q) },
        { k: "note", label: "ملاحظة (اختياري)", type: "textarea", full: true, placeholder: "مثال: زبون ينتظر، أرسلها مع سائق اليوم" }
      ],
      saveLabel: "إرسال الطلب",
      onSave: function (v) {
        if (App.num(v.qty) <= 0) { App.toast("أدخل كمية صحيحة.", "warn"); return false; }
        pushMsg({
          kind: "req", to: branchId, note: v.note || "",
          lines: [{ n: ri.n, b: ri.b || "", k: ri.k || "", t: ri.t, qty: App.num(v.qty) }]
        });
        App.log("طلب تحويل", ri.n + " × " + App.num(v.qty) + " من " + branchName(branchId));
        App.saveNow();
        App.toast("أُرسل الطلب. سيصلهم عند أول اتصال بالإنترنت.");
        sync(true);
      }
    });
  }

  function respond(reqId, status) {
    var r = null;
    requests().forEach(function (x) { if (x.id === reqId) r = x; });
    if (!r) return;

    if (status === "rejected") {
      App.confirm("سيُرفض طلب " + branchName(r.from) + ".", function () {
        pushMsg({ kind: "rep", ref: reqId, to: r.from, status: "rejected" });
        App.saveNow(); App.rerender(); sync(true);
        App.toast("أُرسل الرفض.");
      }, { danger: true, yes: "رفض الطلب" });
      return;
    }

    // موافقة وشحن — نخصم من مخزوني
    var short = [];
    r.lines.forEach(function (l) {
      var x = resolveLocal(l);
      if (!x) short.push(l.n + " (غير موجود عندك)");
      else if (App.num(x.it.qty) < App.num(l.qty)) short.push(l.n + " (المتوفر " + App.num(x.it.qty) + ")");
    });

    var go = function () {
      r.lines.forEach(function (l) {
        var x = resolveLocal(l);
        if (x) { x.it.qty = App.num(x.it.qty) - App.num(l.qty); x.it.updated = App.nowStamp(); }
      });
      pushMsg({ kind: "rep", ref: reqId, to: r.from, status: "shipped" });
      App.log("تحويل بضاعة", "أُرسلت إلى " + branchName(r.from));
      App.saveNow(); App.rerender(); sync(true);
      App.toast("سُجّل الشحن وخُصمت الكمية من مخزونك.");
    };

    if (short.length) {
      App.confirm("مشكلة في الكمية:\n\n" + short.join("\n") + "\n\nهل تكمل الشحن؟", go, { yes: "أكمل" });
    } else {
      App.confirm("سيتم خصم الكمية من مخزونك وتسجيلها «في الطريق» إلى " + branchName(r.from) + ".",
        go, { yes: "موافقة وشحن" });
    }
  }

  function confirmReceipt(reqId) {
    var r = null;
    requests().forEach(function (x) { if (x.id === reqId) r = x; });
    if (!r) return;
    App.confirm("سيتم إضافة الكمية إلى مخزونك. تأكد أن البضاعة وصلت فعلاً.", function () {
      var missing = [];
      r.lines.forEach(function (l) {
        var x = resolveLocal(l);
        if (x) { x.it.qty = App.num(x.it.qty) + App.num(l.qty); x.it.updated = App.nowStamp(); }
        else missing.push(l);
      });
      pushMsg({ kind: "rcv", ref: reqId, to: r.to });
      App.log("استلام تحويل", "من " + branchName(r.to));
      App.saveNow(); App.rerender(); sync(true);
      if (missing.length) {
        App.toast("وصلت. لكن " + missing.length + " صنف غير مسجّل عندك — أضفه من صفحة الكتب أو القرطاسية.", "warn");
      } else App.toast("أُضيفت الكمية إلى مخزونك.");
    }, { yes: "تأكيد الاستلام" });
  }

  /* ============================================================
     الصفحة
     ============================================================ */

  function page() {
    if (view.where === "branch") return branchPage(view.id);
    if (view.where === "warehouse") return warehousePage(view.id);
    if (view.where === "requests") return requestsPage();
    return hub();
  }

  function afterRender() { paintSyncState(); }

  function hub() {
    var mineItems = App.allItems();
    var minePieces = mineItems.reduce(function (s, x) { return s + App.num(x.it.qty); }, 0);
    var mineValue = mineItems.reduce(function (s, x) { return s + App.num(x.it.qty) * App.num(x.it.cost); }, 0);
    var pend = pendingCount();

    var h = '<div class="row" style="margin-bottom:16px">' +
      '<div class="search-wrap" style="max-width:520px"><span class="mag">⌕</span>' +
      '<input class="inp" id="findAll" placeholder="ابحث عن صنف في كل الفروع والمخازن…" value="' + App.esc(find) + '" ' +
      'oninput="Stock.setFind(this.value)"></div>' +
      '<div class="spacer"></div>' +
      '<span id="syncState"></span>' +
      '<button class="btn" onclick="Stock.setupLink()">⚙ بيانات الفرع والربط</button>' +
      '<button class="btn" onclick="Stock.openRequests()">طلبات التحويل' +
      (pend ? ' <span class="badge bad">' + pend + "</span>" : "") + "</button>" +
      '<button class="btn primary" onclick="Stock.sync(true)">↻ تحديث الآن</button>' +
      "</div>";

    h += '<div id="findResults"></div>';

    h += '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(272px,1fr))">';

    // فرعي
    h += '<button class="card branch-card mine" onclick="Stock.open(\'branch\',\'' + App.esc(S().branch.id) + '\')">' +
      '<div class="bc-top"><span class="bc-tag">فرعي</span>' + App.locPin() + "</div>" +
      "<h3>" + App.esc(S().branch.name || S().meta.shopName || "مخزني") + "</h3>" +
      '<div class="bc-sub">' + App.esc(S().branch.city || "—") + (S().branch.phone ? " · " + App.esc(S().branch.phone) : "") + "</div>" +
      '<div class="bc-nums"><div><b class="num">' + mineItems.length + "</b><span>صنف</span></div>" +
      '<div><b class="num">' + minePieces + "</b><span>قطعة</span></div>" +
      '<div><b class="num">' + App.money0(mineValue) + "</b><span>قيمة الجملة</span></div></div>" +
      '<div class="bc-foot"><span class="badge ok">مباشر</span>' +
      '<span class="bc-edit" onclick="event.stopPropagation();Stock.setupLink()">تعديل البيانات</span>' +
      "</div></button>";

    // الفروع المرتبطة
    S().remotes.forEach(function (r) {
      var pieces = (r.items || []).reduce(function (s, i) { return s + App.num(i.q); }, 0);
      h += '<button class="card branch-card" onclick="Stock.open(\'branch\',\'' + App.esc(r.id) + '\')">' +
        '<div class="bc-top"><span class="bc-tag link">فرع مرتبط</span>' + App.locPin() + "</div>" +
        "<h3>" + App.esc(r.name) + "</h3>" +
        '<div class="bc-sub">' + App.esc(r.city || "—") + (r.phone ? " · " + App.esc(r.phone) : "") + "</div>" +
        '<div class="bc-nums"><div><b class="num">' + (r.items || []).length + "</b><span>صنف</span></div>" +
        '<div><b class="num">' + pieces + "</b><span>قطعة</span></div></div>" +
        '<div class="bc-foot">' + freshness(r.at) + "</div></button>";
    });

    // المخازن اليدوية
    S().warehouses.forEach(function (w) {
      var pieces = (w.stock || []).reduce(function (s, i) { return s + App.num(i.qty); }, 0);
      h += '<button class="card branch-card" onclick="Stock.open(\'warehouse\',\'' + w.id + '\')">' +
        '<div class="bc-top"><span class="bc-tag wh">مخزن</span>' + App.locPin() + "</div>" +
        "<h3>" + App.esc(w.name) + "</h3>" +
        '<div class="bc-sub">' + App.esc(w.place || "—") + (w.phone ? " · " + App.esc(w.phone) : "") + "</div>" +
        '<div class="bc-nums"><div><b class="num">' + (w.stock || []).length + "</b><span>صنف</span></div>" +
        '<div><b class="num">' + pieces + "</b><span>قطعة</span></div></div>" +
        '<div class="bc-foot"><span class="badge">يدوي</span></div></button>';
    });

    // إضافة
    h += '<button class="card branch-card add" onclick="Stock.addWarehouse()">' +
      '<div class="plus">+</div><h3>إضافة مخزن</h3>' +
      '<div class="bc-sub">مكان تخزين بلا منظومة — تسجّل بضاعته بيدك.<br>' +
      "الفروع التي عندها منظومة تظهر وحدها بعد الربط.</div></button>";

    h += "</div>";

    if (!configured()) {
      h += '<div class="card" style="margin-top:18px;border-inline-start:3px solid var(--amber)"><div class="card-body">' +
        '<h3 style="margin:0 0 6px">اربط فرعك — ترى مخزونك من التلفون، وتربط فروعك</h3>' +
        '<p class="muted small" style="line-height:1.8;margin:0 0 12px">البيع والمخزون يعملان بدون هذا. الربط يضيف شيئين: ' +
        '<b>مشاهدة مخزونك من تلفونك</b> ولو كان محلك فرعاً واحداً، ورؤية مخزون الفروع الأخرى وطلب تحويل البضاعة. ' +
        "يعمل على شكل تحديث كل بضع دقائق، وإذا انقطع الإنترنت لا يتوقف شيء.</p>" +
        '<button class="btn primary" onclick="Stock.workerSetup()">ابدأ — خطوات الربط</button> ' +
        '<button class="btn" onclick="Stock.setupLink()">عندي العنوان وكلمة السر</button> ' +
        '<button class="btn" onclick="Stock.manualExport()">تصدير لقطة مخزون</button> ' +
        '<button class="btn" onclick="Stock.manualImport()">استيراد لقطة فرع</button>' +
        "</div></div>";
    } else {
      h += '<div class="row" style="margin-top:16px">' +
        '<button class="btn sm ghost" onclick="Stock.setupLink()">إعدادات الربط</button>' +
        '<button class="btn sm ghost" onclick="Stock.phoneView()">المشاهدة من التلفون</button>' +
        '<button class="btn sm ghost" onclick="Stock.workerSetup()">خطوات الربط</button>' +
        '<button class="btn sm ghost" onclick="Stock.manualExport()">تصدير لقطة (واتساب)</button>' +
        '<button class="btn sm ghost" onclick="Stock.manualImport()">استيراد لقطة</button></div>';
    }

    setTimeout(function () { paintSyncState(); paintFind(); }, 0);
    return h;
  }

  /* ---------- البحث الموحّد ---------- */

  function setFind(v) { find = v; paintFind(); }

  function paintFind() {
    var host = document.getElementById("findResults");
    if (!host) return;
    var nq = App.norm(find);
    if (!nq) { host.innerHTML = ""; return; }

    var rows = [];
    App.allItems().forEach(function (x) {
      var hay = App.norm(App.itemName(x.it) + " " + (x.it.author || "") + " " + (x.it.barcode || "") + " " + (x.it.code || ""));
      if (hay.indexOf(nq) < 0) return;
      rows.push({
        where: S().branch.name || "فرعي", mine: true, bid: S().branch.id,
        n: App.itemName(x.it), a: x.it.author || "", q: App.num(x.it.qty), p: App.num(x.it.price),
        loc: x.type === "book" ? App.locChip(x.it) : App.esc(x.it.loc || "—"), ri: null
      });
    });
    S().remotes.forEach(function (r) {
      (r.items || []).forEach(function (i) {
        var hay = App.norm(i.n + " " + (i.a || "") + " " + (i.b || "") + " " + (i.k || ""));
        if (hay.indexOf(nq) < 0) return;
        rows.push({
          where: r.name, mine: false, bid: r.id, at: r.at,
          n: i.n, a: i.a || "", q: App.num(i.q), p: App.num(i.p),
          loc: i.t === "book" ? locOf(i) : App.esc(i.loc || "—"), ri: i
        });
      });
    });
    S().warehouses.forEach(function (w) {
      (w.stock || []).forEach(function (st) {
        var it = App.findItem(st.type, st.itemId);
        if (!it) return;
        if (App.norm(App.itemName(it)).indexOf(nq) < 0) return;
        rows.push({
          where: w.name, mine: false, bid: "", n: App.itemName(it), a: it.author || "",
          q: App.num(st.qty), p: App.num(it.price), loc: App.esc(w.place || "—"), ri: null
        });
      });
    });

    rows.sort(function (a, b) { return (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || b.q - a.q; });

    host.innerHTML = '<div class="card" style="margin-bottom:16px"><div class="card-head">' +
      "<h3>نتائج البحث في كل الفروع</h3><div class=\"spacer\"></div>" +
      '<span class="muted small">' + rows.length + " نتيجة</span></div>" +
      App.table([
        {
          h: "الصنف", c: function (r) {
            return '<div class="name">' + App.esc(r.n) + "</div>" +
              (r.a ? '<div class="sub">' + App.esc(r.a) + "</div>" : "");
          }
        },
        {
          h: "المكان", c: function (r) {
            return (r.mine ? '<span class="badge ok">' : '<span class="badge info">') + App.esc(r.where) + "</span>" +
              (r.at ? ' <span class="muted small">' + App.esc(String(r.at).slice(5, 16)) + "</span>" : "");
          }
        },
        { h: "الموقع", c: function (r) { return r.loc; } },
        {
          h: "المتوفر", cls: "num", c: function (r) {
            return r.q > 0 ? "<b>" + r.q + "</b>" : '<span class="badge bad">0</span>';
          }
        },
        { h: "السعر", cls: "num", c: function (r) { return App.money0(r.p); } },
        {
          h: "", cls: "act", c: function (r, i) {
            if (r.mine || !r.ri || r.q <= 0) return "";
            return '<button class="btn sm primary" onclick="Stock.askFromFind(' + i + ')">طلب تحويل</button>';
          }
        }
      ], rows, { emptyIcon: "⌕", emptyTitle: "لا نتيجة", emptyText: "لم يُعثر على الصنف في أي فرع." }) + "</div>";

    lastFind = rows;
  }

  var lastFind = [];
  function askFromFind(i) {
    var r = lastFind[i];
    if (r && r.ri) askTransfer(r.bid, r.ri);
  }

  function locOf(i) {
    if (!i.l && !i.s) return '<span class="loc none"><span class="lib">?</span><span class="shelf">—</span></span>';
    return '<span class="loc"><span class="lib">' + App.esc(i.l || "?") + '</span><span class="shelf">رف ' + App.esc(i.s || "?") + "</span></span>";
  }

  /* ---------- صفحة فرع ---------- */

  function open(where, id) { view.where = where; view.id = id; view.q = ""; App.rerender(); }
  function back() { view.where = "hub"; App.rerender(); }
  function openRequests() { view.where = "requests"; App.rerender(); }
  function setV(k, v) { view[k] = v; App.rerender(); }

  function branchPage(id) {
    var isMine = (id === S().branch.id) || !id;
    var name = isMine ? (S().branch.name || S().meta.shopName || "مخزني") : branchName(id);
    var rows, at = "";

    if (isMine) {
      rows = App.allItems().map(function (x) {
        return {
          n: App.itemName(x.it), a: x.it.author || x.it.brand || "", t: x.type, c: x.it.cat || "",
          q: App.num(x.it.qty), p: App.num(x.it.price), cost: App.num(x.it.cost),
          loc: x.type === "book" ? App.locChip(x.it) : App.esc(x.it.loc || "—"),
          min: App.num(x.it.min), ri: null, id: x.it.id, type: x.type,
          cons: !!x.it.consId, code: x.it.barcode || x.it.code || ""
        };
      });
    } else {
      var r = null;
      S().remotes.forEach(function (x) { if (x.id === id) r = x; });
      if (!r) return '<div class="empty"><h4>الفرع غير موجود</h4><button class="btn" onclick="Stock.back()">رجوع</button></div>';
      at = r.at;
      rows = (r.items || []).map(function (i) {
        return {
          n: i.n, a: i.a || "", t: i.t, c: i.c || "",
          q: App.num(i.q), p: App.num(i.p), cost: 0,
          loc: i.t === "book" ? locOf(i) : App.esc(i.loc || "—"),
          min: 0, ri: i
        };
      });
    }

    var nq = App.norm(view.q);
    var shown = rows.filter(function (x) {
      if (view.cat === "__none__") { if (x.c) return false; }
      else if (view.cat && x.c !== view.cat) return false;
      if (nq && App.norm(x.n + " " + x.a).indexOf(nq) < 0) return false;
      return true;
    });
    if (view.sort === "qty") shown.sort(function (a, b) { return b.q - a.q; });
    else if (view.sort === "low") shown.sort(function (a, b) { return a.q - b.q; });
    else shown.sort(function (a, b) { return a.n > b.n ? 1 : -1; });

    var pieces = rows.reduce(function (s, x) { return s + x.q; }, 0);
    var value = rows.reduce(function (s, x) { return s + x.q * x.cost; }, 0);
    var retail = rows.reduce(function (s, x) { return s + x.q * x.p; }, 0);

    var h = '<div class="row" style="margin-bottom:16px">' +
      '<button class="btn ghost" onclick="Stock.back()">→ كل المخازن</button>' +
      '<div style="font-family:var(--font-head);font-size:22px;font-weight:700">' + App.esc(name) + "</div>" +
      (isMine ? '<span class="badge ok">فرعي</span>' : freshness(at)) +
      '<div class="spacer"></div>' +
      (isMine ? '<button class="btn" onclick="Stock.exportStock()">تصدير Excel</button>' : '<button class="btn primary" onclick="Stock.sync(true)">↻ تحديث</button>') +
      "</div>";

    h += '<div class="grid g4" style="margin-bottom:16px">';
    h += st("accent", "عدد الأصناف", String(rows.length), "");
    h += st("blue", "إجمالي القطع", String(pieces), "");
    if (isMine) {
      if (App.canProfit()) {
        h += st("accent", "قيمة المخزون", App.money0(value), "بسعر الشراء");
        h += st("blue", "قيمته بيعاً", App.money0(retail), "ربح متوقع " + App.money0(retail - value));
      } else {
        h += st("accent", "أصناف نفدت", String(rows.filter(function (x) { return x.q <= 0; }).length), "");
        h += st("blue", "قيمته بيعاً", App.money0(retail), "");
      }
    } else {
      h += st("blue", "قيمته بيعاً", App.money0(retail), "");
      h += st("accent", "أصناف نفدت عندهم", String(rows.filter(function (x) { return x.q <= 0; }).length), "");
    }
    h += "</div>";

    // توزيع حسب التصنيف
    var byCat = {};
    rows.forEach(function (x) {
      var k = x.c || "__none__";
      byCat[k] = (byCat[k] || 0) + x.q;
    });
    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    var maxc = 1;
    cats.forEach(function (c) { if (byCat[c] > maxc) maxc = byCat[c]; });

    if (cats.length > 1) {
      h += '<div class="card" style="margin-bottom:16px"><div class="card-head"><h3>التوزيع حسب التصنيف</h3></div>' +
        '<div class="card-body"><div class="catbars">';
      cats.slice(0, 10).forEach(function (c) {
        h += '<button class="catbar' + (view.cat === c ? " on" : "") + '" onclick="Stock.setV(\'cat\',\'' +
          (view.cat === c ? "" : App.esc(c)) + '\')">' +
          '<span class="cb-name">' + App.esc(c === "__none__" ? "بدون تصنيف" : c) + "</span>" +
          '<span class="cb-track"><i style="width:' + Math.max(3, (byCat[c] / maxc) * 100) + '%"></i></span>' +
          '<span class="cb-n num">' + byCat[c] + "</span></button>";
      });
      h += "</div></div></div>";
    }

    h += '<div class="card"><div class="card-head">' +
      '<div class="search-wrap" style="max-width:320px"><span class="mag">⌕</span>' +
      '<input class="inp" placeholder="ابحث داخل هذا المخزن…" value="' + App.esc(view.q) + '" oninput="Stock.setQ(this.value)"></div>' +
      '<select class="inp" style="width:auto" onchange="Stock.setV(\'sort\',this.value)">' +
      '<option value="qty"' + (view.sort === "qty" ? " selected" : "") + ">الأكثر كمية</option>" +
      '<option value="low"' + (view.sort === "low" ? " selected" : "") + ">الأقل كمية</option>" +
      '<option value="name"' + (view.sort === "name" ? " selected" : "") + ">حسب الاسم</option></select>" +
      (view.cat ? '<button class="btn sm ghost" onclick="Stock.setV(\'cat\',\'\')">✕ ' +
        App.esc(view.cat === "__none__" ? "بدون تصنيف" : view.cat) + "</button>" : "") +
      '<div class="spacer"></div><span class="muted small">' + shown.length + " من " + rows.length + "</span></div>";

    var cols = [
      {
        h: "الصنف", c: function (x) {
          /* النقطة الحمراء لمخزوني أنا فقط — صفوف الفروع الأخرى لا تحمل id
             لأنها لقطة قادمة من جهاز آخر. */
          var it = x.id ? App.findItem(x.type || x.t, x.id) : null;
          var dot = (it && typeof Labels !== "undefined" && Labels.mark) ? Labels.mark(it) : "";
          return '<div class="name">' + dot + App.esc(x.n) +
            (x.cons ? ' <span class="badge warn">على المباع</span>' : "") + "</div>" +
            '<div class="sub">' + (x.t === "book" ? "كتاب" : "قرطاسية") + (x.a ? " · " + App.esc(x.a) : "") +
            (x.code ? ' · <span class="num">' + App.esc(x.code) + "</span>" : "") + "</div>";
        }
      },
      { h: "التصنيف", c: function (x) { return x.c ? '<span class="badge">' + App.esc(x.c) + "</span>" : '<span class="muted">—</span>'; } },
      { h: "الموقع", c: function (x) { return x.loc; } },
      {
        h: "الكمية", cls: "num", c: function (x) {
          if (x.q <= 0) return '<span class="badge bad">نفدت</span>';
          if (x.min && x.q <= x.min) return '<b style="color:var(--amber)">' + x.q + "</b>";
          return "<b>" + x.q + "</b>";
        }
      },
      { h: "السعر", cls: "num", c: function (x) { return App.money0(x.p); } }
    ];
    if (isMine) {
      if (App.canProfit()) cols.push({ h: "القيمة", cls: "num", c: function (x) { return App.money0(x.q * x.cost); } });
      cols.push({
        h: "", cls: "act", c: function (x) {
          return '<button class="btn sm" onclick="Stock.showItem(\'' + x.type + '\',\'' + x.id + '\')">عرض</button> ' +
            '<button class="btn sm" onclick="Stock.editItem(\'' + x.type + '\',\'' + x.id + '\')">تعديل</button> ' +
            '<button class="btn sm primary" onclick="Inv.addStock(\'' + x.type + '\',\'' + x.id + '\')">+ كمية</button>';
        }
      });
    } else {
      cols.push({
        h: "", cls: "act", c: function (x, i) {
          if (x.q <= 0) return "";
          return '<button class="btn sm primary" onclick="Stock.askRow(\'' + App.esc(id) + '\',' + i + ')">طلب تحويل</button>';
        }
      });
    }

    lastRows = shown;
    h += App.table(cols, shown, {
      rowClass: function (x) { return x.q <= 0 ? "out" : (x.min && x.q <= x.min ? "low" : ""); },
      emptyIcon: "▦", emptyTitle: "لا أصناف",
      emptyText: isMine ? "ابدأ بتسجيل أول صنف." : "لم يصل مخزون هذا الفرع بعد. اضغط تحديث.",
      /* الحالة الفارغة كانت تطلب فعلاً بلا زر يؤديه — والمستخدم
         عليه أن يعرف وحده أن الإضافة في صفحة "إدخال بضاعة". */
      emptyAction: isMine
        ? '<div class="row" style="justify-content:center;gap:10px;margin-top:14px">' +
          '<button class="btn primary" onclick="Inv.editBook()">+ كتاب جديد</button>' +
          '<button class="btn" onclick="Inv.editStat()">+ صنف قرطاسية</button></div>'
        : ""
    }) + "</div>";

    return h;
  }

  /* بطاقة تفصيلية للصنف */
  function showItem(type, id) {
    var it = App.findItem(type, id);
    if (!it) return;
    var cons = it.consId && typeof Consign !== "undefined" ? Consign.byItem(it.id) : null;
    var ownerName = "";
    if (cons) { var o = Consign.owner(cons.ownerId); ownerName = o ? o.name + (o.phone ? " · " + o.phone : "") : ""; }

    function row(l, v) {
      return '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line-soft)">' +
        '<span class="muted">' + App.esc(l) + "</span><span><b>" + v + "</b></span></div>";
    }
    var prof = App.num(it.price) - App.num(it.cost);

    App.modal({
      title: App.itemName(it),
      body: '<div class="row" style="margin-bottom:12px">' +
        (type === "book" ? '<span class="badge info">كتاب</span>' : '<span class="badge">قرطاسية</span>') +
        (it.consId ? '<span class="badge warn">على المباع</span>' : "") +
        App.stockBadge(it) + "</div>" +
        row("الباركود", '<span class="num">' + App.esc(it.barcode || "— لا يوجد") + "</span>") +
        row("الرمز الداخلي", '<span class="num small">' + App.esc(it.code || "—") + "</span>") +
        (type === "book" ? row("المؤلف", App.esc(it.author || "—")) : row("الماركة", App.esc(it.brand || "—"))) +
        (type === "book" ? row("دار النشر", App.esc(it.publisher || "—")) : row("الوحدة", App.esc(it.unit || "—"))) +
        row("التصنيف", App.esc(it.cat || "—")) +
        row("الموقع", type === "book" ? App.locChip(it) : App.esc(it.loc || "—")) +
        row("الكمية الحالية", App.num(it.qty)) +
        row("حد التنبيه", App.num(it.min) || "—") +
        (App.canProfit() ? row(it.consId ? "سعر صاحبه" : "سعر الشراء", App.money(it.cost)) : "") +
        row("سعر البيع قطاعي", App.money(it.price)) +
        row("سعر البيع جملة", App.num(it.priceW) ? App.money(it.priceW) : "— نفس القطاعي") +
        (App.canProfit()
          ? row("ربح القطعة", '<span style="color:' + (prof >= 0 ? "var(--accent)" : "var(--stamp)") + '">' + App.money(prof) + "</span>") +
            row("قيمة المخزون منه", App.money(App.num(it.qty) * App.num(it.cost)))
          : "") +
        (cons ? row("صاحب البضاعة", App.esc(ownerName)) +
          row("استُلم / بِيع", App.num(cons.qty) + " / " + App.num(cons.sold)) : "") +
        (it.note ? '<div style="margin-top:12px;padding:10px 12px;background:var(--surface-2);border-radius:var(--r)">' + App.esc(it.note) + "</div>" : ""),
      actions: [
        { label: "تعديل", kind: "primary", click: function (close) { close(); editItem(type, id); } },
        { label: "+ كمية", click: function (close) { close(); Inv.addStock(type, id); } }
      ]
    });
  }

  function editItem(type, id) {
    if (type === "book") Inv.editBook(id); else Inv.editStat(id);
  }

  var lastRows = [];
  function askRow(bid, i) {
    var x = lastRows[i];
    if (x && x.ri) askTransfer(bid, x.ri);
  }
  function setQ(v) { view.q = v; App.rerender(); }

  function st(kind, lbl, val, foot) {
    return '<div class="card stat ' + kind + '"><div class="lbl">' + App.esc(lbl) + "</div>" +
      '<div class="val">' + val + "</div>" +
      (foot ? '<div class="foot">' + App.esc(foot) + "</div>" : "") + "</div>";
  }

  /* ---------- صفحة طلبات التحويل ---------- */

  function requestsPage() {
    var all = requests();
    var incoming = all.filter(function (r) { return r.to === S().branch.id; });
    var outgoing = all.filter(function (r) { return r.from === S().branch.id; });

    var h = '<div class="row" style="margin-bottom:16px">' +
      '<button class="btn ghost" onclick="Stock.back()">→ كل المخازن</button>' +
      '<div style="font-family:var(--font-head);font-size:22px;font-weight:700">طلبات التحويل</div>' +
      '<div class="spacer"></div><button class="btn primary" onclick="Stock.sync(true)">↻ تحديث</button></div>';

    h += '<div class="card" style="margin-bottom:18px"><div class="card-head"><h3>طلبات واردة إليك</h3>' +
      '<div class="spacer"></div><span class="muted small">فروع تطلب منك بضاعة</span></div>' +
      App.table([
        { h: "من", c: function (r) { return '<div class="name">' + App.esc(branchName(r.from)) + "</div>"; } },
        { h: "التاريخ", c: function (r) { return '<span class="num small">' + App.esc(r.at) + "</span>"; } },
        {
          h: "المطلوب", c: function (r) {
            return r.lines.map(function (l) { return App.esc(l.n) + " × <b>" + App.num(l.qty) + "</b>"; }).join("<br>");
          }
        },
        {
          h: "عندك", cls: "num", c: function (r) {
            return r.lines.map(function (l) {
              var x = resolveLocal(l);
              return x ? App.num(x.it.qty) : '<span class="muted">غير مسجّل</span>';
            }).join("<br>");
          }
        },
        { h: "ملاحظة", c: function (r) { return App.esc(r.note || "—"); } },
        { h: "الحالة", c: function (r) { return statusBadge(r._status); } },
        {
          h: "", cls: "act", c: function (r) {
            if (r._status !== "pending") return "";
            return '<button class="btn sm primary" onclick="Stock.respond(\'' + r.id + '\',\'shipped\')">موافقة وشحن</button> ' +
              '<button class="btn sm ghost" onclick="Stock.respond(\'' + r.id + '\',\'rejected\')">رفض</button>';
          }
        }
      ], incoming, { emptyIcon: "⇦", emptyTitle: "لا طلبات واردة", emptyText: "عندما يطلب فرع آخر بضاعة منك ستظهر هنا." }) +
      "</div>";

    h += '<div class="card"><div class="card-head"><h3>طلبات أرسلتها</h3></div>' +
      App.table([
        { h: "إلى", c: function (r) { return '<div class="name">' + App.esc(branchName(r.to)) + "</div>"; } },
        { h: "التاريخ", c: function (r) { return '<span class="num small">' + App.esc(r.at) + "</span>"; } },
        {
          h: "المطلوب", c: function (r) {
            return r.lines.map(function (l) { return App.esc(l.n) + " × <b>" + App.num(l.qty) + "</b>"; }).join("<br>");
          }
        },
        { h: "الحالة", c: function (r) { return statusBadge(r._status); } },
        {
          h: "", cls: "act", c: function (r) {
            if (r._status === "shipped") return '<button class="btn sm primary" onclick="Stock.confirmReceipt(\'' + r.id + '\')">تأكيد الاستلام</button>';
            return "";
          }
        }
      ], outgoing, { emptyIcon: "⇨", emptyTitle: "لم ترسل طلبات", emptyText: "ابحث عن صنف في المخزون واطلب تحويله من فرع آخر." }) +
      "</div>";

    return h;
  }

  /* ---------- المخازن اليدوية ---------- */

  function addWarehouse(id) {
    var w = null;
    if (id) S().warehouses.forEach(function (x) { if (x.id === id) w = x; });
    App.form({
      title: w ? "تعديل مخزن" : "مخزن جديد",
      values: w || {},
      fields: [
        {
          k: "name", label: "اسم المخزن", required: true, full: true, placeholder: "مثال: مخزن سوق الثلاثاء",
          hint: "هذا لمكان تخزين لا توجد فيه منظومة. إن كان فرعاً عنده منظومة فلا تضفه هنا — اضبط الربط في الجهازين وسيظهر تلقائياً."
        },
        { k: "place", label: "المكان" },
        { k: "phone", label: "رقم الهاتف" },
        { k: "note", label: "ملاحظة", type: "textarea", full: true }
      ],
      onSave: function (v) {
        if (w) { Object.keys(v).forEach(function (k) { w[k] = v[k]; }); }
        else {
          v.id = App.uid(); v.stock = [];
          S().warehouses.push(v);
        }
        App.log("مخزن", v.name);
        App.save(); App.rerender();
        App.toast("حُفظ المخزن.");
      }
    });
  }

  function warehousePage(id) {
    var w = null;
    S().warehouses.forEach(function (x) { if (x.id === id) w = x; });
    if (!w) return '<div class="empty"><h4>المخزن غير موجود</h4><button class="btn" onclick="Stock.back()">رجوع</button></div>';

    var rows = (w.stock || []).map(function (s2, i) {
      var it = App.findItem(s2.type, s2.itemId);
      return { i: i, it: it, type: s2.type, qty: App.num(s2.qty), name: it ? App.itemName(it) : "(صنف محذوف)" };
    });

    var h = '<div class="row" style="margin-bottom:16px">' +
      '<button class="btn ghost" onclick="Stock.back()">→ كل المخازن</button>' +
      '<div style="font-family:var(--font-head);font-size:22px;font-weight:700">' + App.esc(w.name) + "</div>" +
      '<span class="badge">مخزن يدوي</span><div class="spacer"></div>' +
      '<button class="btn ghost" onclick="Stock.addWarehouse(\'' + w.id + '\')">تعديل البيانات</button>' +
      '<button class="btn ghost" onclick="Stock.delWarehouse(\'' + w.id + '\')">حذف</button>' +
      '<button class="btn primary" onclick="Stock.addToWarehouse(\'' + w.id + '\')">+ إضافة بضاعة</button></div>';

    h += '<div class="card"><div class="card-head"><h3>البضاعة الموجودة هناك</h3><div class="spacer"></div>' +
      '<span class="muted small">' + App.esc(w.place || "") + (w.phone ? " · " + App.esc(w.phone) : "") + "</span></div>" +
      App.table([
        { h: "الصنف", c: function (r) { return '<div class="name">' + App.esc(r.name) + "</div>"; } },
        { h: "النوع", c: function (r) { return r.type === "book" ? "كتاب" : "قرطاسية"; } },
        { h: "الكمية هناك", cls: "num", c: function (r) { return "<b>" + r.qty + "</b>"; } },
        { h: "عندي هنا", cls: "num", c: function (r) { return r.it ? App.num(r.it.qty) : "—"; } },
        {
          h: "", cls: "act", c: function (r) {
            return '<button class="btn sm" onclick="Stock.editWhQty(\'' + w.id + "'," + r.i + ')">تعديل</button> ' +
              '<button class="btn sm ghost" onclick="Stock.delWhLine(\'' + w.id + "'," + r.i + ')">✕</button>';
          }
        }
      ], rows, { emptyIcon: "⌂", emptyTitle: "لا بضاعة مسجّلة", emptyText: "سجّل ما أرسلته إلى هذا المخزن." }) + "</div>";
    return h;
  }

  function addToWarehouse(id) {
    var w = null;
    S().warehouses.forEach(function (x) { if (x.id === id) w = x; });
    if (!w) return;
    var opts = App.allItems().map(function (x) {
      return { v: x.type + ":" + x.it.id, t: App.itemName(x.it) + " — متوفر عندي " + App.num(x.it.qty) };
    });
    if (!opts.length) { App.toast("أضف أصنافاً إلى الكتالوج أولاً.", "warn"); return; }
    App.form({
      title: "إضافة بضاعة إلى " + w.name,
      values: { qty: 1 },
      fields: [
        { k: "pick", label: "الصنف", type: "select", options: opts, full: true },
        { k: "qty", label: "الكمية الموجودة هناك", type: "number", min: 0, required: true, full: true },
        { k: "move", label: "أخصمها من مخزوني هنا؟", type: "select", options: [{ v: "no", t: "لا — تسجيل فقط" }, { v: "yes", t: "نعم — أرسلتها فعلاً" }], full: true }
      ],
      onSave: function (v) {
        var parts = String(v.pick).split(":");
        var type = parts[0], itemId = parts[1];
        var ex = null;
        w.stock = w.stock || [];
        w.stock.forEach(function (s2) { if (s2.type === type && s2.itemId === itemId) ex = s2; });
        if (ex) ex.qty = App.num(ex.qty) + App.num(v.qty);
        else w.stock.push({ type: type, itemId: itemId, qty: App.num(v.qty) });
        if (v.move === "yes") {
          var it = App.findItem(type, itemId);
          if (it) { it.qty = App.num(it.qty) - App.num(v.qty); it.updated = App.nowStamp(); }
        }
        App.log("مخزن", "أضيفت بضاعة إلى " + w.name);
        App.save(); App.rerender();
        App.toast("سُجّلت البضاعة في المخزن.");
      }
    });
  }

  function editWhQty(id, i) {
    var w = null;
    S().warehouses.forEach(function (x) { if (x.id === id) w = x; });
    if (!w || !w.stock[i]) return;
    App.form({
      title: "تعديل الكمية", size: "narrow",
      values: { qty: w.stock[i].qty },
      fields: [{ k: "qty", label: "الكمية هناك", type: "number", min: 0, required: true, full: true }],
      onSave: function (v) {
        w.stock[i].qty = App.num(v.qty);
        App.save(); App.rerender();
      }
    });
  }

  function delWhLine(id, i) {
    var w = null;
    S().warehouses.forEach(function (x) { if (x.id === id) w = x; });
    if (!w) return;
    w.stock.splice(i, 1);
    App.save(); App.rerender();
  }

  function delWarehouse(id) {
    var w = null;
    S().warehouses.forEach(function (x) { if (x.id === id) w = x; });
    if (!w) return;
    App.confirm("سيُحذف المخزن «" + w.name + "» وكل ما سُجّل فيه.", function () {
      S().warehouses.splice(S().warehouses.indexOf(w), 1);
      App.save(); back();
    }, { danger: true, yes: "حذف" });
  }

  /* ---------- إعداد الربط ---------- */

  function setupLink() {
    App.form({
      title: "إعداد ربط الفروع",
      size: "wide",
      values: {
        id: S().branch.id, name: S().branch.name || S().meta.shopName,
        city: S().branch.city, phone: S().branch.phone,
        url: S().sync.url, key: S().sync.key,
        everyMin: App.num(S().sync.everyMin) || 10,
        auto: S().sync.auto ? "yes" : "no"
      },
      fields: [
        { k: "id", label: "رمز هذا الفرع", required: true, hint: "بالإنجليزي وبلا مسافات: misrata / tripoli — يجب أن يختلف عن رمز الفروع الأخرى" },
        { k: "name", label: "اسم الفرع", required: true },
        { k: "city", label: "المدينة" },
        { k: "phone", label: "هاتف الفرع", hint: "يظهر للفروع الأخرى ليتصلوا بك" },
        { k: "url", label: "عنوان الربط", full: true, placeholder: "https://xxxx.workers.dev", hint: "نفس العنوان في كل الفروع" },
        { k: "key", label: "كلمة سر الربط", full: true, hint: "نفس الكلمة في كل الفروع" },
        { k: "everyMin", label: "التحديث التلقائي كل (دقيقة)", type: "number", min: 2 },
        { k: "auto", label: "تحديث تلقائي", type: "select", options: [{ v: "yes", t: "مفعّل" }, { v: "no", t: "يدوي فقط" }] }
      ],
      saveLabel: "حفظ واختبار",
      onSave: function (v) {
        S().branch.id = String(v.id).trim().toLowerCase().replace(/\s+/g, "-");
        S().branch.name = v.name; S().branch.city = v.city; S().branch.phone = v.phone;
        S().sync.url = String(v.url).trim().replace(/\/+$/, "");
        S().sync.key = v.key;
        S().sync.everyMin = Math.max(2, App.num(v.everyMin));
        S().sync.auto = (v.auto === "yes");
        S().sync.lastHash = "";
        App.saveNow();
        App.rerender();
        startAuto();
        if (S().sync.url) sync(true);
        else App.toast("حُفظت بيانات الفرع. أضف عنوان الربط لتفعيل المزامنة.");
      }
    });
  }

  /* ---------- خطوات الربط (الـWorker) ---------- */

  /* الكود نفسه مدمج في الملف التنفيذي باسم worker.js، فيُقرأ من هنا
     ولا تُكتب منه نسخة ثانية تتخلّف عن الأصل. */
  function workerSetup() {
    var steps =
      '<p class="muted small" style="line-height:1.9;margin:0 0 14px">' +
      "لتشاهد مخزونك من التلفون تحتاج «صندوق بريد» على الإنترنت يرفع إليه " +
      "جهازك لقطة المخزون كل بضع دقائق. أرخص وأبسط ما وجدته: " +
      "<b>Cloudflare Workers</b> — مجاني تماماً في حدودك، بلا بطاقة ائتمان. " +
      "تضبطه <b>مرة واحدة</b> في نحو عشر دقائق.</p>" +

      '<p class="muted small" style="line-height:1.9;margin:0 0 14px;padding:10px 12px;' +
      'background:var(--accent-wash);border-radius:8px;border-inline-start:3px solid var(--accent)">' +
      "<b>لا يمر عبره شيء عن مبيعاتك أو زبائنك أو أرباحك.</b> فقط أسماء " +
      "الأصناف وكمياتها وأسعار بيعها ومواقعها. سعر الشراء وأرباحك لا تغادر هذا الجهاز.</p>" +

      '<ol style="line-height:2;padding-inline-start:20px;margin:0 0 16px">' +
      "<li>سجّل في <b>dash.cloudflare.com</b> — مجاناً وبلا بطاقة.</li>" +
      "<li><b>Storage &amp; Databases ← KV ← Create a namespace</b><br>" +
      '<span class="muted small">سمّه بالضبط: <code>SHOP_DATA</code></span></li>' +
      "<li><b>Compute (Workers) ← Create ← Start from Hello World</b><br>" +
      '<span class="muted small">سمّه مثلاً <code>maktaba-sync</code> ثم Deploy</span></li>' +
      "<li>افتح الـWorker ← <b>Edit code</b> ← امسح كل الموجود ← " +
      "الصق الكود من الزر تحت ← <b>Deploy</b></li>" +
      "<li><b>Settings ← Bindings ← Add ← KV Namespace</b><br>" +
      '<span class="muted small">Variable name: <code>SHOP</code> · ' +
      "KV namespace: <code>SHOP_DATA</code></span><br>" +
      "ثم <b>Add ← Secret</b><br>" +
      '<span class="muted small">Variable name: <code>SHOP_SECRET</code> · ' +
      "Value: كلمة سر طويلة تختارها أنت</span><br>ثم Deploy مرة أخرى.</li>" +
      "<li>انسخ عنوان الـWorker (شكله <code>https://maktaba-sync.اسمك.workers.dev</code>) " +
      "وضعه هنا مع نفس كلمة السر من زر <b>«عندي العنوان وكلمة السر»</b>.</li>" +
      "</ol>" +

      '<div style="margin-bottom:12px">' +
      '<button class="btn primary" onclick="Stock.copyWorker()">نسخ كود الـWorker</button> ' +
      '<button class="btn" onclick="Stock.setupLink()">عندي العنوان وكلمة السر</button>' +
      '<div class="muted small" id="wkNote" style="margin-top:8px"></div>' +
      "</div>" +

      '<p class="muted small" style="line-height:1.9;margin:0">' +
      "<b>إن كان workers.dev محجوباً عند مزوّد الإنترنت عندك:</b> اربط نطاقاً " +
      "خاصاً بك على نفس الـWorker من Settings ← Domains، وضع عنوان النطاق بدل " +
      "عنوان workers.dev.</p>" +
      '<p class="muted small" style="line-height:1.9;margin:8px 0 0">' +
      "لا تريد إنترنت أصلاً؟ «تصدير لقطة مخزون» يعطيك ملفاً ترسله بواتساب، " +
      "والفرع الآخر يستورده. يعمل بلا حساب ولا اشتراك، لكن بيدك في كل مرة.</p>";

    App.modal({ title: "خطوات الربط — مرة واحدة", size: "wide", body: steps });
  }

  function copyWorker() {
    var note = function (t, bad) {
      var e = document.getElementById("wkNote");
      if (e) { e.textContent = t; e.style.color = bad ? "var(--stamp)" : "var(--accent)"; }
    };
    fetch("worker.js", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (code) {
        var ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed"; ta.style.top = "-2000px";
        document.body.appendChild(ta);
        ta.select();
        var done = false;
        try { done = document.execCommand("copy"); } catch (e) { done = false; }
        document.body.removeChild(ta);
        if (done) {
          App.toast("نُسخ كود الـWorker — الصقه في Edit code.");
          note("نُسخ. افتح الـWorker ← Edit code ← امسح كل الموجود ← الصق ← Deploy.");
        } else {
          throw new Error("copy");
        }
      })
      .catch(function () {
        note("تعذّر النسخ. الكود موجود في ملف cloud/worker.js داخل مجلد المشروع.", true);
      });
  }

  /* ---------- المشاهدة من التلفون ---------- */

  /* صفحة قراءة فقط تفتحها من متصفح التلفون فترى المخزون كله.
     تقرأ نفس اللقطة المرفوعة للربط، فلا خادم جديد. هذه النافذة
     تسلّمك العنوان وكلمة السر لتنسخهما إلى التلفون بلا بحث. */
  var VIEWER = "https://hasan6961239.github.io/boxsand/stock.html";

  function phoneView() {
    if (!configured()) {
      App.toast("اضبط الربط أولاً — العارض يقرأ من نفس العنوان.", "warn");
      setupLink();
      return;
    }
    var fld = function (label, val, id, hint) {
      return '<div style="margin-bottom:14px">' +
        '<div class="muted small" style="margin-bottom:5px">' + App.esc(label) + "</div>" +
        '<div style="display:flex;gap:8px;align-items:stretch">' +
        '<input class="inp" id="' + id + '" readonly value="' + App.esc(val) +
        '" style="flex:1;font-family:monospace;direction:ltr;text-align:left">' +
        '<button class="btn sm" onclick="Stock.copyBox(\'' + id + '\')">نسخ</button></div>' +
        (hint ? '<div class="muted small" style="margin-top:5px">' + hint + "</div>" : "") +
        "</div>";
    };
    App.modal({
      title: "المشاهدة من التلفون",
      size: "wide",
      body:
        '<p class="muted small" style="line-height:1.9;margin:0 0 16px">' +
        "افتح الرابط الأول من متصفح تلفونك، اضغط ⚙ فيه، والصق العنوان وكلمة السر. " +
        "بعدها ترى كل بضاعتك وأين هي — في هذا الفرع وفي الفروع الأخرى وفي المخازن. " +
        "<b>للعرض فقط:</b> لا بيع ولا تعديل ولا حذف من التلفون، ولا تظهر فيه أسعار " +
        "الشراء ولا أرباحك.</p>" +
        fld("١. رابط العارض (افتحه في التلفون)", VIEWER, "pvUrl") +
        fld("٢. عنوان الربط", S().sync.url, "pvSync") +
        fld("٣. كلمة سر الربط", S().sync.key, "pvKey",
          "لا ترسلها في مجموعة عامة. من يملكها يرى مخزونك.") +
        '<p class="muted small" style="line-height:1.9;margin:4px 0 0">' +
        "يُحفظ الاثنان على ذلك التلفون وحده. ما يظهر هناك هو <b>آخر لقطة مرفوعة</b>، " +
        "فإن كان جهاز فرع مطفأً فخبره قديم — والعارض يكتب عمر البيانات بالأحمر " +
        "بجانب اسم الفرع حتى لا تثق برقم قديم وأنت تظنه اليوم.</p>",
      actions: [{
        label: "حدّث اللقطة الآن", kind: "primary",
        click: function (close) { close(); sync(true); }
      }]
    });
  }

  function copyBox(id) {
    var el = document.getElementById(id);
    if (!el) return;
    try {
      el.focus(); el.select();
      document.execCommand("copy");
      App.toast("نُسخ.");
    } catch (e) { App.toast("حدّده وانسخه بالفأرة.", "warn"); }
  }

  /* ---------- التبادل اليدوي (بلا إنترنت) ---------- */

  function manualExport() {
    if (!S().branch.id) { App.toast("اضبط رمز الفرع أولاً من «إعداد الربط».", "warn"); return; }
    App.download("مخزون-" + (S().branch.city || S().branch.id) + "-" + App.today() + ".json",
      JSON.stringify(snapshot()), "application/json");
    App.toast("نُزّلت لقطة المخزون. أرسلها للفرع الآخر عبر واتساب.");
  }

  function manualImport() {
    App.pickFile(".json,application/json", function (txt) {
      try {
        var snap = JSON.parse(txt);
        if (!snap || !snap.branch || !snap.branch.id) throw new Error("ملف غير صالح");
        if (snap.branch.id === S().branch.id) throw new Error("هذه لقطة فرعك أنت");
        var others = S().remotes.filter(function (r) { return r.id !== snap.branch.id; });
        others.push({
          id: snap.branch.id, name: snap.branch.name || snap.branch.id,
          city: snap.branch.city || "", phone: snap.branch.phone || "",
          at: snap.at || "", items: snap.items || [], msgs: snap.msgs || []
        });
        S().remotes = others;
        App.log("استيراد لقطة", snap.branch.name || snap.branch.id);
        App.saveNow(); App.rerender();
        App.toast("استُوردت لقطة " + (snap.branch.name || snap.branch.id) + ".");
      } catch (e) {
        App.toast("الملف غير صالح.", "bad");
      }
    });
  }

  function exportStock() {
    var arr = App.allItems();
    if (!arr.length) { App.toast("لا توجد أصناف.", "warn"); return; }
    App.xls("المخزون-" + App.today(), "جرد المخزون الكامل", [
      { h: "الصنف", c: function (x) { return App.itemName(x.it); } },
      { h: "النوع", c: function (x) { return x.type === "book" ? "كتاب" : "قرطاسية"; } },
      { h: "المؤلف/الماركة", c: function (x) { return x.it.author || x.it.brand || ""; } },
      { h: "دار النشر", c: function (x) { return x.it.publisher || ""; } },
      { h: "التصنيف", c: function (x) { return x.it.cat || ""; } },
      {
        h: "الموقع", c: function (x) {
          return x.type === "book" ? ((x.it.lib || "") + (x.it.shelf ? " / رف " + x.it.shelf : "")) : (x.it.loc || "");
        }
      },
      { h: "الرمز", c: function (x) { return x.it.barcode || x.it.code || ""; } },
      { h: "الكمية", t: "i", sum: true, c: function (x) { return App.num(x.it.qty); } },
      { h: "سعر الشراء", t: "n", c: function (x) { return App.num(x.it.cost); } },
      { h: "سعر البيع", t: "n", c: function (x) { return App.num(x.it.price); } },
      { h: "قيمة المخزون", t: "n", sum: true, c: function (x) { return App.num(x.it.qty) * App.num(x.it.cost); } },
      { h: "قيمته بيعاً", t: "n", sum: true, c: function (x) { return App.num(x.it.qty) * App.num(x.it.price); } },
      { h: "على المباع", c: function (x) { return x.it.consId ? "نعم" : ""; } }
    ], arr, S().meta.shopName || "");
    App.toast("نُزّل جدول المخزون.");
  }

  return {
    page: page, afterRender: afterRender, hub: hub,
    sync: sync, startAuto: startAuto, setupLink: setupLink, configured: configured,
    open: open, back: back, openRequests: openRequests, setV: setV, setQ: setQ,
    showItem: showItem, editItem: editItem,
    setFind: setFind, askFromFind: askFromFind, askRow: askRow, askTransfer: askTransfer,
    respond: respond, confirmReceipt: confirmReceipt, pendingCount: pendingCount,
    requests: requests, branchName: branchName, resolveLocal: resolveLocal,
    addWarehouse: addWarehouse, addToWarehouse: addToWarehouse, editWhQty: editWhQty,
    delWhLine: delWhLine, delWarehouse: delWarehouse,
    manualExport: manualExport, manualImport: manualImport, exportStock: exportStock,
    phoneView: phoneView, copyBox: copyBox,
    workerSetup: workerSetup, copyWorker: copyWorker,
    snapshot: snapshot
  };
})();
