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

  /* light: فرع كبير بشاشات 3.x (فوق 5000 صنف، طرابلس): بلا أصنافه ولا أصناف مخازنه ولا
     زبائنه. المحرك كان يحذفها على أي حال قبل الرفع (SyncClient.OldMaxItems)، لكن الشاشة كانت
     تبنيها أولاً على خيط الرسم: 17 ميغا لكل «تحديث الآن». كتب الفرع الكبير تصل الفروع
     والتلفون من قائمته في المحرك (v2/catalog) */
  var BIG = 5000;
  function bigShop() { return App.isX3 && App.isX3() && (S().books.length + S().stationery.length) > BIG; }
  function snapshot(light) {
    var staleMap = {};
    try {
      if (!light && typeof Stale !== "undefined") Stale.rows().forEach(function (r) { staleMap[r.type + ":" + r.it.id] = r.idle; });
    } catch (e) { }
    return {
      branch: {
        id: S().branch.id, name: S().branch.name || S().meta.shopName,
        city: S().branch.city, phone: S().branch.phone
      },
      at: App.nowStamp(),
      items: light ? [] : App.allItems().map(function (x) {
        var it = x.it;
        return {
          /* a: المؤلف للكتاب والماركة للقرطاسية (كانت الماركة لا تُرفع فتظهر فارغة في التلفون) */
          k: it.code || "", t: x.type, n: App.itemName(it), a: it.author || it.brand || "",
          b: it.barcode || "", c: it.cat || "",
          q: App.num(it.qty), p: App.num(it.price), m: App.num(it.min),
          /* منها في غرفة الخزين (يُحذف إن كان صفراً فتبقى اللقطة صغيرة).
             الموقع يطرحه من q فيعرض الرفوف والغرفة كلاً في مكانه. */
          st: App.storeQty(it) || undefined,
          /* أيام الركود للأصناف الراكدة فقط، وآخر بيع — للتنبيهات في التلفون */
          sl: staleMap[x.type + ":" + it.id] || undefined,
          ls: it.lastSold || undefined,
          l: it.lib || "", s: it.shelf || "", loc: it.loc || "",
          /* الناشر والملاحظة يظهران في صفحة الكتاب على الموقع.
             سعر الشراء والربح لا يُرفعان أبداً. */
          d: it.publisher || "", nt: it.note || "", u: it.unit || "",
          /* للتعديل الكامل من التلفون (3.0): سعر الجملة، التخصص الدقيق، المورّد، و«لم يُجرد بعد» (طرابلس).
             تُحذف إن كانت فارغة فتبقى اللقطة صغيرة */
          pw: App.num(it.priceW) || undefined, cf: it.catFull || undefined,
          sp: it.supplierId || undefined, un: it.uncounted ? 1 : undefined
        };
      }),
      /* المخازن اليدوية ترافق اللقطة بأسماء أصنافها محلولة، ليعرضها
         عارض التلفون بلا حاجة للرجوع إلى جهاز المحل. */
      whs: (S().warehouses || []).map(function (w) {
        return {
          id: w.id, name: w.name || "", place: w.place || "", phone: w.phone || "",
          items: light ? [] : (w.stock || []).map(function (st) {
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
      msgs: S().outbox.slice(0, 400),
      /* لتطبيق التلفون: لوحة اليوم (مبيعات بلا أرباح ولا تكلفة)، والزبائن
         وديونهم، وتأكيد فواتير التلفون التي سُجّلت هنا. */
      dash: dashSummary(),
      cust: phoneCust(light),
      /* الموردون وما علينا لكل واحد: صفحة «الديون» في التلفون (بصلاحية الديون) */
      sup: phoneSup(),
      acks: phoneAcks(),
      phoneSell: S().meta.phoneSales !== false,
      /* طرابلس: دخول الموظفين في التلفون (بصمات كلمات السر فقط)، واسم المكتبة وشعارها */
      staff: phoneStaff(),
      shop: phoneShop(),
      /* ما يفهمه هذا الجهاز من التلفون (v 3: كل الحقول، إضافة كمية، صنف جديد)، وقوائم النماذج */
      ph: phoneForms()
    };
  }

  /* الزبائن وديونهم. فرع كبير: لقطته تبقى صغيرة (الـWorker يحلّلها في حدّ 10 ميلي ثانية)، فإن
     كثروا رُفع من عليهم دين أولاً، بحدّ */
  var CUST_LIGHT = 400;
  function phoneCust(light) {
    var cs = S().customers || [];
    if (light && cs.length > CUST_LIGHT) {
      cs = cs.slice().sort(function (a, b) { return App.num(b.balance) - App.num(a.balance); }).slice(0, CUST_LIGHT);
    }
    return cs.map(function (c) {
      return { id: c.id, n: c.name || "", ph: c.phone || "", b: App.r3(App.num(c.balance)) };
    });
  }
  function phoneSup() {
    if (typeof People === "undefined" || !People.supDebt) return undefined;
    return (S().suppliers || []).slice(0, 400).map(function (s) {
      return { id: s.id, n: s.name || "", ph: s.phone || "", b: App.r3(People.supDebt(s)) };
    });
  }
  function phoneForms() {
    var m = S().meta || {};
    return {
      v: 3, libs: (m.libraries || []).slice(0, 80), shelves: App.num(m.shelves) || 6,
      units: (m.units || []).slice(0, 60), bcats: (m.bookCats || []).slice(0, 400), scats: (m.statCats || []).slice(0, 200),
      pubs: (S().publishers || []).slice(0, 600).map(function (p) { return p.name || ""; }).filter(Boolean)
    };
  }

  function phoneStaff() {
    return (typeof Staff !== "undefined" && Staff.phoneList) ? (Staff.phoneList() || undefined) : undefined;
  }
  function phoneShop() {
    if (!(App.isX4 && App.isX4())) return undefined;
    return { name: S().meta.shopName || "", logo: S().meta.logo || undefined, libs: (S().meta.libraries || []).slice() };
  }

  /* الموظفون مفعّلون: كل ما يأتي من التلفون يحمل صاحبه، وصلاحيته تُراجع هنا */
  function staffGate() { return typeof Staff !== "undefined" && Staff.on && Staff.on(); }
  function phoneLog(by, device) {
    var e = S().log[0];
    if (e && typeof Staff !== "undefined" && Staff.stampAs) Staff.stampAs(e, by, device);
  }

  /* مجاميع المبيعات: اليوم، آخر 35 يوماً، وآخر الفواتير — بلا ربح ولا تكلفة */
  function dashSummary() {
    var today = App.today(), by = {}, recent = [];
    var d0 = new Date(today + "T00:00:00");
    var from = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - 34);
    var p2 = function (x) { return (x < 10 ? "0" : "") + x; };
    var fromKey = from.getFullYear() + "-" + p2(from.getMonth() + 1) + "-" + p2(from.getDate());
    S().invoices.forEach(function (v) {
      if (String(v.date) < fromKey) return;
      var g = by[v.date] || (by[v.date] = { v: 0, n: 0, q: 0 });
      g.v = App.r3(g.v + App.num(v.total));
      if (v.kind !== "return") {
        g.n++;
        (v.items || []).forEach(function (l) { g.q += App.num(l.qty); });
      }
    });
    /* آخر 40 فاتورة بسطورها (حتى 12 سطراً لكل واحدة): صفحة «الفواتير» في التلفون تفتح الفاتورة.
       بلا ربح ولا تكلفة */
    var custName = {};
    function cname(id) {
      if (!id) return "";
      if (custName[id] === undefined) {
        var c = typeof People !== "undefined" ? People.customer(id) : null;
        custName[id] = c ? (c.name || "") : "";
      }
      return custName[id];
    }
    S().invoices.slice(0, 40).forEach(function (v) {
      var its = v.items || [];
      recent.push({
        no: v.no, d: v.date, at: String(v.at || "").slice(11, 16), t: App.r3(App.num(v.total)),
        m: v.method || "", k: v.kind || "sale", c: cname(v.customerId), ph: v.source === "phone" ? 1 : undefined,
        n: its.map(function (l) { return l.name; }).slice(0, 4).join("، "),
        q: its.reduce(function (a, l) { return a + App.num(l.qty); }, 0),
        li: its.slice(0, 12).map(function (l) { return [String(l.name || "").slice(0, 80), App.num(l.qty), App.r3(App.num(l.price))]; }),
        ds: App.num(v.discount) ? App.r3(App.num(v.discount)) : undefined,
        due: App.num(v.due) > 0 ? App.r3(App.num(v.due)) : undefined,
        by: v.byName || undefined
      });
    });
    /* آخر 60 فاتورة بيع آجل: صفحة «الآجل» في التلفون (الزبون، المبلغ، المدفوع عند البيع، الباقي) */
    var credit = [], all = S().invoices;
    for (var i = 0; i < all.length && credit.length < 60; i++) {
      var v = all[i];
      if (v.method !== "credit" || v.kind === "return") continue;
      credit.push({
        no: v.no, d: v.date, at: String(v.at || "").slice(11, 16), c: cname(v.customerId), cid: v.customerId || "",
        t: App.r3(App.num(v.total)), pd: App.r3(App.num(v.paid)), due: App.r3(App.num(v.due))
      });
    }
    return { today: today, days: by, recent: recent, credit: credit, cur: S().meta.currency || "" };
  }

  /* ---------- البيع من التلفون ----------
     التلفون لا يكتب في بيانات المحل. يكتب طلبات البيع في ملفه هو على
     خادم الربط، وهذا الجهاز يقرؤها عند كل تحديث فيسجّلها فواتير حقيقية
     (بخصم المخزون ودين الزبون) مرة واحدة فقط، ثم يعيد رقم الفاتورة في
     لقطته ليعرف التلفون أنها سُجّلت. */
  function phoneDone() {
    if (!S().phoneDone || typeof S().phoneDone !== "object") S().phoneDone = {};
    return S().phoneDone;
  }
  function phoneAcks() {
    var done = phoneDone(), keys = Object.keys(done);
    var out = {};
    keys.slice(-300).forEach(function (k) { out[k] = done[k]; });
    return out;
  }
  /* هواتف هذا الفرع وآخر ما أرسله كل هاتف (للمدير: الإعدادات ← الأجهزة والفروع) — في الذاكرة */
  var phonesSeen = [];
  function notePhones(list) {
    phonesSeen = list.filter(function (b) {
      return b && b.kind === "phone" && b.branch && (!Array.isArray(b.orders) || !b.orders.length ||
        b.orders.some(function (o) { return !o.to || o.to === S().branch.id; }));
    }).map(function (b) { return { id: b.branch.id, name: b.branch.name || "تلفون", at: b.at || "" }; });
  }
  function phones() { return phonesSeen.slice(); }

  function takePhoneOrders(list) {
    if (S().meta.phoneSales === false || typeof Sales === "undefined" || !Sales.applyPhoneOrder) return 0;
    var done = phoneDone(), n = 0, made = [];
    list.forEach(function (snap) {
      if (!snap || snap.kind !== "phone" || !Array.isArray(snap.orders)) return;
      snap.orders.forEach(function (o) {
        if (!o || !o.id || done[o.id]) return;
        if (o.to && o.to !== S().branch.id) return;      // لفرع آخر: هو يسجّلها لا نحن
        var dev = (snap.branch && snap.branch.name) || "التلفون";
        if (staffGate() && !Staff.canId(o.by, "sell")) {
          done[o.id] = 0;
          App.log("بيع من التلفون", "طلب " + o.id + " لم يُسجَّل: " + (o.by ? "الموظف لا يملك صلاحية البيع أو موقوف" : "بلا اسم موظف") + " — " + dev);
          phoneLog(o.by, dev);
          return;
        }
        var inv = Sales.applyPhoneOrder(o, dev);
        done[o.id] = inv ? inv.no : 0;          // 0 = لم يُسجَّل (أصناف غير موجودة)
        if (inv) { n++; made.push(inv.no); }
      });
    });
    // لا يكبر السجل بلا حدّ
    var keys = Object.keys(done);
    if (keys.length > 600) keys.slice(0, keys.length - 600).forEach(function (k) { delete done[k]; });
    if (n) {
      App.save();
      App.toast(n === 1 ? "وصلت فاتورة من التلفون: رقم " + made[0] : "وصلت " + n + " فواتير من التلفون", "ok");
      if (App.celebrate) App.celebrate("بيع من التلفون", n === 1 ? "فاتورة رقم " + made[0] : n + " فواتير");
    }
    return n;
  }
  /* ---------- التعديل من التلفون ----------
     كل حقول الصنف كما في نموذج الكمبيوتر (الاسم، المؤلف/الماركة، دار النشر، المورّد، التصنيف،
     التخصص الدقيق، الباركود، السعران، حد التنبيه، المكان، الوحدة، الملاحظة) — إلا سعر الشراء:
     لا يمرّ على خادم الربط أبداً. والكمية فرقاً (+3 أو −2) لا رقماً مطلقاً: ما بيع هنا بين
     التعديل ووصوله يبقى محسوباً. ومعها نوعان: «صنف جديد» (kind: new) و«إضافة كمية»
     (kind: recv، تُسجَّل إدخال بضاعة). مرة واحدة لكل تعديل، ويعود تأكيده للتلفون:
     1 طُبّق · 2 طُبّق بعضه (باركود مستعمل، أو سطر غير موجود) · 0 لم يُطبَّق */
  function takePhoneEdits(list) {
    if (S().meta.phoneSales === false) return 0;
    var done = phoneDone(), n = 0;
    pIdx = null;
    list.forEach(function (snap) {
      if (!snap || snap.kind !== "phone" || !Array.isArray(snap.edits)) return;
      snap.edits.forEach(function (e) {
        if (!e || !e.id || done[e.id] !== undefined) return;
        if (e.to && e.to !== S().branch.id) return;
        var r = applyPhoneEdit(e, (snap.branch && snap.branch.name) || "التلفون");
        done[e.id] = r === 2 ? 2 : r ? 1 : 0;
        if (done[e.id]) n++;
      });
    });
    pIdx = null;
    if (n) { App.save(); App.toast(n === 1 ? "وصل تعديل صنف من التلفون" : "وصلت " + n + " تعديلات من التلفون", "ok"); }
    return n;
  }
  /* فهرس الأصناف بالرمز والباركود: جلسة جرد ترسل مئات التعديلات، وكل تعديل كان يمرّ على
     الأصناف كلها (61 ألفاً في طرابلس). يُبنى مرة لكل دفعة، ويُعاد إن تغيّر باركود أو أُضيف صنف */
  var pIdx = null;
  function phoneIndex() {
    if (pIdx) return pIdx;
    var byK = Object.create(null), byB = Object.create(null);
    ["book", "stat"].forEach(function (type) {
      (App.listOf(type) || []).forEach(function (it) {
        var k = String(it.code || "").trim().toUpperCase(), b = String(it.barcode || "").trim();
        if (k && !byK[k]) byK[k] = { it: it, type: type };
        if (b && !byB[b]) byB[b] = { it: it, type: type };
      });
    });
    pIdx = { k: byK, b: byB };
    return pIdx;
  }
  /* الرمز أولاً (لا يتغيّر ولا يتكرّر)، ثم الباركود */
  function phoneFind(b, k) {
    var ix = phoneIndex(), code = String(k || "").trim().toUpperCase(), bc = String(b || "").trim();
    return (code && ix.k[code]) || (bc && ix.b[bc]) || null;
  }
  function ptxt(v, max) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max || 300); }
  /* صلاحية كل حقل حين يكون الموظفون مفعّلين — كما في نموذج الكمبيوتر */
  var PHONE_GATE = {
    n: "items", a: "items", d: "items", c: "items", cf: "items", bc: "items", u: "items", nt: "items",
    sp: ["items", "goods"], p: "price", pw: "price", m: ["goods", "items"],
    qd: ["count", "goods"], st: ["count", "goods"], l: ["items", "count"], s: ["items", "count"], loc: ["items", "count"]
  };
  function applyPhoneEdit(e, device) {
    if (e.kind === "new") return phoneNewItem(e, device);
    if (e.kind === "recv") return phoneReceive(e, device);
    var hit = phoneFind(e.b, e.k);
    if (!hit) return false;
    var it = hit.it, isB = hit.type === "book", f = e.set || {}, what = [], part = false;
    if (staffGate()) {
      var g = {};
      Object.keys(PHONE_GATE).forEach(function (k) {
        if (f[k] !== undefined && Staff.canId(e.by, PHONE_GATE[k])) g[k] = f[k];
      });
      if (f.cnt && g.qd !== undefined) g.cnt = 1;
      if (!Object.keys(g).length) {
        App.log("تعديل من التلفون", App.itemName(it) + ": لم يُطبَّق — ليس من صلاحيات الموظف — " + device);
        phoneLog(e.by, device);
        return false;
      }
      f = g;
    }
    if (f.n !== undefined && ptxt(f.n)) { if (isB) it.title = ptxt(f.n); else it.name = ptxt(f.n); what.push("الاسم"); }
    if (f.a !== undefined) { if (isB) it.author = ptxt(f.a); else it.brand = ptxt(f.a); what.push(isB ? "المؤلف" : "الماركة"); }
    if (isB && f.d !== undefined) { it.publisher = ptxt(f.d); what.push("دار النشر"); }
    if (f.sp !== undefined) {
      var sid = ptxt(f.sp, 80);
      if (!sid || (typeof People !== "undefined" && People.supplier(sid))) { it.supplierId = sid; what.push("المورّد"); }
    }
    if (f.c !== undefined) {
      it.cat = typeof Inv !== "undefined" && Inv.canonCat ? Inv.canonCat(hit.type, ptxt(f.c)) : ptxt(f.c);
      what.push(isB && App.isX4 && App.isX4() ? "التخصص" : "التصنيف");
    }
    if (isB && f.cf !== undefined) { it.catFull = ptxt(f.cf, 500); what.push("التخصص الدقيق"); }
    if (f.bc !== undefined) {
      var nb = ptxt(f.bc, 60), other = nb ? phoneIndex().b[nb] : null;
      if (other && other.it !== it) {
        part = true;
        App.log("تعديل من التلفون", App.itemName(it) + ": الباركود " + nb + " لم يُحفظ — مستعمل في «" + App.itemName(other.it) + "» — " + device);
        if (staffGate()) phoneLog(e.by, device);
      } else if (nb !== String(it.barcode || "").trim()) { it.barcode = nb; pIdx = null; what.push("الباركود"); }
    }
    if (f.p !== undefined && App.num(f.p) >= 0) { it.price = App.num(f.p); what.push("السعر"); }
    if (f.pw !== undefined && App.num(f.pw) >= 0) { it.priceW = App.num(f.pw); what.push("سعر الجملة"); }
    if (f.m !== undefined && App.num(f.m) >= 0) { it.min = App.num(f.m); what.push("حد التنبيه"); }
    if (isB && f.l !== undefined) { it.lib = ptxt(f.l, 40); what.push("المكتبة"); }
    if (isB && f.s !== undefined) { it.shelf = ptxt(f.s, 40); what.push("الرف"); }
    if (!isB && f.loc !== undefined) { it.loc = ptxt(f.loc); what.push("المكان"); }
    if (!isB && f.u !== undefined && ptxt(f.u, 40)) { it.unit = ptxt(f.u, 40); what.push("الوحدة"); }
    if (f.nt !== undefined) { it.note = String(f.nt == null ? "" : f.nt).trim().slice(0, 1000); what.push("الملاحظة"); }
    if (f.qd !== undefined && App.num(f.qd) !== 0) {
      it.qty = Math.max(App.num(it.qty) + App.num(f.qd), 0);
      what.push("الكمية " + (App.num(f.qd) > 0 ? "+" : "") + App.num(f.qd));
    }
    /* منها في غرفة الخزين: جزء من الكمية، لا يزيد عليها ولا يقلّ عن صفر */
    if (f.st !== undefined) {
      var st = Math.min(Math.max(Math.floor(App.num(f.st)), 0), Math.max(App.num(it.qty), 0));
      if (st !== App.storeQty(it)) {
        if (st > 0) it.store = st; else delete it.store;
        what.push("غرفة الخزين " + st);
      }
    }
    /* جرد من التلفون (عدّ النسخ، أو كمية كُتبت بيد): الكتاب صار مجروداً */
    if (f.cnt && it.uncounted) { delete it.uncounted; what.push("جُرد"); }
    /* كما في نموذج الكمبيوتر: كتاب بلا سعر جملة ولدار نشره نسبة ⇦ يُحسب منها */
    if (isB && (f.p !== undefined || f.d !== undefined) && App.num(it.priceW) <= 0 && it.publisher &&
        typeof Inv !== "undefined" && Inv.pubByName) {
      var auto = Inv.wholesaleFromPub(it.price, Inv.pubByName(it.publisher));
      if (auto > 0) it.priceW = auto;
    }
    if (!what.length) return part ? false : true;      // لا شيء تغيّر فعلاً (القيم كما هي): مقبول
    it.updated = App.nowStamp();
    App.log("تعديل من التلفون", App.itemName(it) + ": " + what.join("، ") + " — " + device);
    if (staffGate()) phoneLog(e.by, device);
    return part ? 2 : true;
  }

  /* صنف جديد من التلفون: كما يُضاف من «بضاعة جديدة» — رمز جديد، وسعر الشراء صفر حتى يُكتب هنا */
  function phoneNewItem(e, device) {
    var f = e.set || {}, type = e.t === "stat" ? "stat" : "book", isB = type === "book";
    var name = ptxt(f.n);
    if (!name) return false;
    if (staffGate() && !Staff.canId(e.by, ["items", "goods"])) {
      App.log("إضافة من التلفون", name + ": لم يُضف — ليس من صلاحيات الموظف — " + device);
      phoneLog(e.by, device);
      return false;
    }
    var bc = ptxt(f.bc, 60), clash = bc ? phoneIndex().b[bc] : null;
    if (clash) {
      App.log("إضافة من التلفون", name + ": لم يُضف — الباركود " + bc + " مستعمل في «" + App.itemName(clash.it) + "» — " + device);
      if (staffGate()) phoneLog(e.by, device);
      return false;
    }
    var qty = Math.max(Math.floor(App.num(f.q)), 0), toStore = f.dst === "store";
    var canon = function (c) { return typeof Inv !== "undefined" && Inv.canonCat ? Inv.canonCat(type, c) : c; };
    var sid = ptxt(f.sp, 80);
    if (sid && !(typeof People !== "undefined" && People.supplier(sid))) sid = "";
    var v = { id: App.uid(), code: App.nextCode(type) };
    if (isB) {
      v.title = name; v.author = ptxt(f.a); v.publisher = ptxt(f.d); v.supplierId = sid;
      v.lib = toStore ? "" : ptxt(f.l, 40); v.shelf = toStore ? "" : ptxt(f.s, 40);
      v.cat = canon(ptxt(f.c)); v.catFull = ptxt(f.cf, 500);
    } else {
      v.name = name; v.cat = canon(ptxt(f.c)); v.brand = ptxt(f.a); v.supplierId = sid;
      v.unit = ptxt(f.u, 40) || "قطعة"; v.loc = toStore ? "" : ptxt(f.loc);
    }
    v.barcode = bc; v.cost = 0;
    v.price = Math.max(App.num(f.p), 0); v.priceW = Math.max(App.num(f.pw), 0);
    v.qty = qty; v.store = toStore ? qty : 0;
    v.min = Math.max(Math.floor(App.num(f.m)), 0);
    v.note = String(f.nt == null ? "" : f.nt).trim().slice(0, 1000);
    if (isB && v.priceW <= 0 && v.publisher && typeof Inv !== "undefined" && Inv.pubByName) {
      var auto = Inv.wholesaleFromPub(v.price, Inv.pubByName(v.publisher));
      if (auto > 0) v.priceW = auto;
    }
    v.created = v.updated = App.nowStamp();
    App.listOf(type).unshift(v);
    pIdx = null;
    App.log(isB ? "إضافة كتاب" : "إضافة صنف", name + " — من التلفون — " + device);
    if (staffGate()) phoneLog(e.by, device);
    return true;
  }

  /* إضافة كمية من التلفون: إدخال بضاعة في «سجل الإدخالات» بسعر الشراء المسجّل هنا (التلفون لا
     يعرفه)، بلا طريقة دفع — آجل المورّد يُسجَّل من الكمبيوتر */
  function phoneReceive(e, device) {
    var src = Array.isArray(e.lines) ? e.lines : [];
    if (staffGate() && !Staff.canId(e.by, ["goods", "items"])) {
      App.log("إدخال بضاعة من التلفون", "لم يُسجَّل — ليس من صلاحيات الموظف — " + device);
      phoneLog(e.by, device);
      return false;
    }
    var toStore = e.dst === "store", lines = [], pieces = 0;
    src.forEach(function (l) {
      var hit = l ? phoneFind(l.b, l.k) : null, q = l ? Math.floor(App.num(l.q)) : 0;
      if (!hit || q <= 0) return;
      var st = toStore ? q : 0;
      App.receiveStock(hit.it, q, st);
      hit.it.updated = App.nowStamp();
      pieces += q;
      lines.push({ type: hit.type, id: hit.it.id, name: App.itemName(hit.it), qty: q, cost: App.num(hit.it.cost), st: st });
    });
    if (!lines.length) {
      App.log("إدخال بضاعة من التلفون", "لم يُسجَّل: أصناف غير موجودة — " + device);
      if (staffGate()) phoneLog(e.by, device);
      return false;
    }
    var sup = e.sp && typeof People !== "undefined" ? People.supplier(String(e.sp)) : null;
    var note = ptxt(e.nt, 200);
    S().purchases.unshift({
      id: App.uid(), date: App.today(), supplierId: sup ? sup.id : "",
      note: (note ? note + " — " : "") + "من التلفون (" + String(device || "").slice(0, 60) + ")",
      lines: lines, total: App.r3(lines.reduce(function (a, l) { return a + l.qty * l.cost; }, 0)),
      at: App.nowStamp(), src: "phone"
    });
    App.log("إدخال بضاعة", lines.length + " صنف (" + pieces + " قطعة) " + (toStore ? "للمخزن" : "للرفوف") + " — من التلفون — " + device);
    if (staffGate()) phoneLog(e.by, device);
    return lines.length < src.length ? 2 : true;
  }

  function setPhoneSales(on) {
    S().meta.phoneSales = !!on;
    App.save();
    App.toast(on ? "البيع من التلفون مسموح." : "البيع من التلفون موقوف — الطلبات تنتظر حتى تسمح به.");
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

  /* على الأساس الجديد (قرار 0026): كتب الفروع المربوطة يعطيها البرنامج من قوائمها،
     خارج ملف البيانات، فلا تثقل كتب طرابلس محل مصراتة. تُحمَّل عند الفتح وتتجدّد مع
     كل تحديث. S().remotes يبقى لما لا يأتي منه (لقطة مستوردة يدوياً) */
  var live = null, liveAsked = false;
  function remotes() {
    if (!live) return S().remotes || [];
    var ids = {};
    live.forEach(function (r) { ids[r.id] = 1; });
    return live.concat((S().remotes || []).filter(function (r) { return !ids[r.id]; }));
  }

  function setLive(keep) {
    live = keep;
    /* ما صار يأتي من البرنامج يخرج من ملف البيانات (من جهاز المحل؛ الثاني يأخذ ملفه منه) */
    var ids = {};
    keep.forEach(function (r) { ids[r.id] = 1; });
    var old = S().remotes || [];
    var rest = old.filter(function (r) { return !ids[r.id]; });
    if (rest.length !== old.length && !App.isSecond()) { S().remotes = rest; App.save(); }
  }

  function loadLive() {
    if (!(App.isX3 && App.isX3())) return Promise.resolve(false);
    return App.api("/api/x3/remotes").then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.ok) return false;
      mergeRemotes(res.branches || []);
      return true;
    }).catch(function () { return false; });
  }

  /* readOnly: سؤال خفيف عن طلبات التلفون وفروعه (بلا بناء اللقطة ولا رفعها). كل دقيقة ما دام
     خادم الربط بالفهرس (v 3، kvFast)؛ الخادم القديم يعدّ كل /all من حدّ list اليومي (ألف) */
  var kvFast = false, pollTimer = null;
  function sync(manual, readOnly) {
    if (syncing) return Promise.resolve();
    if (App.outboundHeld && App.outboundHeld()) {
      if (manual) App.toast("الربط موقوف على هذا الجهاز لأن البيانات آتية من جهاز المحل — اضغط «هذا جهاز المحل الآن» إن كان كذلك.", "warn");
      return Promise.resolve();
    }
    if (!configured()) {
      if (manual) App.toast("اضبط الاتصال أولاً من زر «إعداد الربط».", "warn");
      return Promise.resolve();
    }
    syncing = true;
    if (!readOnly) paintSyncState("جارٍ التحديث…");

    var snap = readOnly ? null : snapshot(bigShop());
    var body = snap ? JSON.stringify(snap) : "";
    var h = snap ? hash(body) : "";
    // لا نرفع إن لم يتغير شيء — يوفّر الحصة والباقة
    var skipUp = readOnly || (h === S().sync.lastHash && !manual);

    return App.api("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: S().sync.url, key: S().sync.key,
        upload: skipUp ? null : snap, now: !!manual
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
      kvFast = (App.num(res.kvv) || App.num(res.v)) >= 3;
      var seenBefore = {};
      requests().forEach(function (r) { seenBefore[r.id] = 1; });
      mergeRemotes(res.branches || []);
      notePhones(res.branches || []);
      var gotPhone = takePhoneOrders(res.branches || []) + takePhoneEdits(res.branches || []);
      if (gotPhone) {
        App.rerender();
        // التأكيد يصل للتلفون الآن، لا في التحديث القادم بعد دقائق
        setTimeout(function () { sync(false); }, 1500);
      }
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
        App.toast("حُدّث المخزون من " + remotes().length + " فرع.");
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
      if (snap.kind === "phone") return;          // تلفون يبيع، لا فرع له مخزون
      keep.push({
        id: snap.branch.id, name: snap.branch.name || snap.branch.id,
        city: snap.branch.city || "", phone: snap.branch.phone || "",
        at: snap.at || "", items: snap.items || [], msgs: snap.msgs || []
      });
    });
    if (App.isX3 && App.isX3()) { setLive(keep); return; }
    S().remotes = keep;
  }

  function startAuto() {
    loadLive();
    if (autoTimer) clearInterval(autoTimer);
    if (!configured() || !S().sync.auto) return;
    if (App.outboundHeld && App.outboundHeld()) return;
    var every = Math.max(2, App.num(S().sync.everyMin) || 10);
    sync(false);
    autoTimer = setInterval(function () { sync(false); }, every * 60000);
    /* بيع التلفون يصل خلال دقيقة: سؤال بلا رفع بين التحديثات (والتأكيد يُرفع بعده وحده) */
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (kvFast && S().meta.phoneSales !== false && !syncing) sync(false, true);
    }, 60000);
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
    remotes().forEach(function (r) { out = out.concat(r.msgs || []); });
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
    remotes().forEach(function (r) { if (r.id === id) n = r.name || r.city || r.id; });
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
    /* أول فتح على الأساس الجديد: الفروع من البرنامج، ثم يُعاد الرسم */
    if (live === null && !liveAsked && App.isX3 && App.isX3()) {
      liveAsked = true;
      loadLive().then(function (ok) { if (ok) App.rerender(); });
    }
    if (view.where === "branch") return branchPage(view.id);
    if (view.where === "warehouse") return warehousePage(view.id);
    if (view.where === "room") return roomPage();
    if (view.where === "requests") return requestsPage();
    return hub();
  }

  function afterRender() { paintSyncState(); }

  function hub() {
    var mineItems = App.allItems();
    var minePieces = mineItems.reduce(function (s, x) { return s + App.num(x.it.qty); }, 0);
    var x4 = App.isX4 && App.isX4();
    var mineValue = x4 ? 0 : mineItems.reduce(function (s, x) { return s + App.num(x.it.qty) * App.num(x.it.cost); }, 0);
    var pend = pendingCount();

    var h = (App.holdBanner ? App.holdBanner() : "") + '<div class="row" style="margin-bottom:16px">' +
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
      /* طرابلس: صفحة المخزون تُرى أمام الزبائن والموظفين — بلا قيمة البضاعة */
      (x4 ? "" : '<div><b class="num">' + App.money0(mineValue) + "</b><span>قيمة الجملة</span></div>") + "</div>" +
      '<div class="bc-foot"><span class="badge ok">مباشر</span>' +
      '<span class="bc-edit" onclick="event.stopPropagation();Stock.setupLink()">تعديل البيانات</span>' +
      "</div></button>";

    // غرفة الخزين داخل المحل
    var room = roomItems();
    var roomPieces = room.reduce(function (a, x) { return a + App.storeQty(x.it); }, 0);
    h += '<button class="card branch-card room" onclick="Stock.open(\'room\',\'\')">' +
      '<div class="bc-top"><span class="bc-tag wh">غرفة الخزين</span>' + App.locPin() + "</div>" +
      "<h3>غرفة الخزين</h3>" +
      '<div class="bc-sub">داخل المحل — الكتب التي ليست على الرفوف</div>' +
      '<div class="bc-nums"><div><b class="num">' + room.length + "</b><span>صنف</span></div>" +
      '<div><b class="num">' + roomPieces + "</b><span>نسخة</span></div></div>" +
      '<div class="bc-foot">' + (room.length ? '<span class="badge">فيها بضاعة</span>' : '<span class="badge ok">فارغة</span>') +
      '<span class="bc-edit">نقل بالقارئ ⇄</span></div></button>';

    // الفروع المرتبطة
    remotes().forEach(function (r) {
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

    /* الربط في «الإعدادات ← الأجهزة والفروع» (مصراتة وطرابلس)، وهنا سطر يدلّ عليه */
    if (!configured()) {
      h += '<div class="row" style="margin-top:16px;gap:10px"><span class="badge">الربط غير مفعّل</span>' +
        '<span class="muted small">ربط الفروع ومشاهدة المخزون من التلفون: من الإعدادات ← الأجهزة والفروع</span>' +
        '<button class="btn sm ghost" onclick="location.hash=\'#/settings?tab=devices\'">فتح</button></div>';
    }

    setTimeout(function () { paintSyncState(); paintFind(); }, 0);
    return h;
  }

  /* «اربط فرعك» أو أزرار الربط: تحت بطاقات المخزون (مصراتة)، أو داخل
     «الإعدادات ← الأجهزة والفروع» (طرابلس، card = false: الإطار من الإعدادات) */
  function linkBlock(card) {
    var h = "";
    if (!configured()) {
      h += (card ? '<div class="card" style="margin-top:18px;border-inline-start:3px solid var(--amber)"><div class="card-body">' : "<div>") +
        '<h3 style="margin:0 0 6px">اربط فرعك — ترى مخزونك من التلفون، وتربط فروعك</h3>' +
        '<p class="muted small" style="line-height:1.8;margin:0 0 12px">البيع والمخزون يعملان بدون هذا. الربط يضيف شيئين: ' +
        '<b>مشاهدة مخزونك من تلفونك</b> ولو كان محلك فرعاً واحداً، ورؤية مخزون الفروع الأخرى وطلب تحويل البضاعة. ' +
        "يعمل على شكل تحديث كل بضع دقائق، وإذا انقطع الإنترنت لا يتوقف شيء.</p>" +
        '<button class="btn primary" onclick="Stock.workerSetup()">ابدأ — خطوات الربط</button> ' +
        '<button class="btn" onclick="Stock.setupLink()">عندي العنوان وكلمة السر</button> ' +
        '<button class="btn" onclick="Stock.manualExport()">تصدير لقطة مخزون</button> ' +
        '<button class="btn" onclick="Stock.manualImport()">استيراد لقطة فرع</button>' +
        (card ? "</div></div>" : "</div>");
    } else {
      h += '<div class="row" style="margin-top:' + (card ? 16 : 0) + 'px">' +
        '<button class="btn sm ghost" onclick="Stock.setupLink()">إعدادات الربط</button>' +
        '<button class="btn sm ghost" onclick="Stock.phoneView()">المشاهدة من التلفون</button>' +
        '<label class="btn sm ghost" style="gap:6px"><input type="checkbox" ' + (S().meta.phoneSales !== false ? "checked" : "") +
        ' onchange="Stock.setPhoneSales(this.checked)"> قبول البيع من التلفون</label>' +
        '<button class="btn sm ghost" onclick="Stock.workerSetup()">خطوات الربط</button>' +
        '<button class="btn sm ghost" onclick="Stock.manualExport()">تصدير لقطة (واتساب)</button>' +
        '<button class="btn sm ghost" onclick="Stock.manualImport()">استيراد لقطة</button></div>';
    }

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
      rows.push({
        hay: [App.itemName(x.it), x.it.barcode, x.it.code, x.it.author],
        where: S().branch.name || "فرعي", mine: true, bid: S().branch.id,
        n: App.itemName(x.it), a: x.it.author || "", q: App.num(x.it.qty), p: App.num(x.it.price),
        /* الموقع يُكتب للسطر الذي يُعرض فقط (كان لكل الأصناف مع كل حرف) */
        loc: null, mk: function () { return x.type === "book" ? App.locChip(x.it) : App.esc(x.it.loc || "—"); }, ri: null
      });
    });
    remotes().forEach(function (r) {
      (r.items || []).forEach(function (i) {
        rows.push({
          hay: [i.n, i.b, i.k, i.a],
          where: r.name, mine: false, bid: r.id, at: r.at,
          n: i.n, a: i.a || "", q: App.num(i.q), p: App.num(i.p),
          loc: null, mk: function () { return i.t === "book" ? locOf(i) : App.esc(i.loc || "—"); }, ri: i
        });
      });
    });
    S().warehouses.forEach(function (w) {
      (w.stock || []).forEach(function (st) {
        var it = App.findItem(st.type, st.itemId);
        if (!it) return;
        rows.push({
          hay: [App.itemName(it)],
          where: w.name, mine: false, bid: "", n: App.itemName(it), a: it.author || "",
          q: App.num(st.qty), p: App.num(it.price), loc: App.esc(w.place || "—"), ri: null
        });
      });
    });

    rows.sort(function (a, b) { return (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || b.q - a.q; });
    rows = App.rank(rows, find, function (r) { return r.hay; });

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
        { h: "الموقع", c: function (r) { return r.loc != null ? r.loc : (r.loc = r.mk()); } },
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
      ], rows, { emptyIcon: "search", emptyTitle: "لا نتيجة", emptyText: "لم يُعثر على الصنف في أي فرع." }) + "</div>";

    lastFind = rows;
  }

  var lastFind = [];
  function askFromFind(i) {
    var r = lastFind[i];
    if (r && r.ri) askTransfer(r.bid, r.ri);
  }

  function locOf(i) {
    /* قائمة فرع على 4.0: مكانه نص كامل («ط2 · قانون · C · رف 4») */
    if (!i.l && !i.s && i.loc && live) return App.esc(i.loc);
    if (!i.l && !i.s) return '<span class="loc none"><span class="lib">?</span><span class="shelf">—</span></span>';
    return '<span class="loc"><span class="lib">' + App.esc(i.l || "?") + '</span><span class="shelf">رف ' + App.esc(i.s || "?") + "</span></span>";
  }

  /* ---------- صفحة فرع ---------- */

  function open(where, id) { view.where = where; view.id = id; view.q = ""; App.rerender(); }
  function back() { view.where = "hub"; App.rerender(); }
  function openRequests() { view.where = "requests"; App.rerender(); }
  function setV(k, v) { view[k] = v; App.rerender(); }

  /* ---------- فرع مربوط: جدول كتب مثل «عرض وتعديل» ----------
     طلب المستخدم (فرع مصراتة داخل طرابلس): الكتب في جدول، بحث كبير، تخصص وحالة،
     100 كتاب كل ما تنزل، وبلا مبالغ («قيمته بيعاً»). البحث يرسم الجدول وحده لا الصفحة،
     وصفوف الفرع تُحسب مرة لكل قائمة تصل (فرع بـ61 ألف كتاب) */
  var rv = { id: "", q: "", cat: "", st: "", sort: "name" }, rvCache = { r: null, at: "", rows: null, cats: null };

  function remoteRows(r) {
    if (rvCache.r === r && rvCache.at === r.at && rvCache.rows) return rvCache;
    var by = {};
    var rows = (r.items || []).map(function (i) {
      var c = String(i.c || "").trim();
      by[c] = (by[c] || 0) + 1;
      return { n: i.n || "", a: i.a || "", t: i.t, c: c, q: App.num(i.q), p: App.num(i.p), code: i.b || i.k || "", ri: i };
    });
    rows.sort(function (a, b) { return a.n < b.n ? -1 : a.n > b.n ? 1 : 0; });
    var cats = Object.keys(by).filter(Boolean).sort(function (a, b) { return by[b] - by[a]; }).map(function (c) { return { c: c, n: by[c] }; });
    rvCache = { r: r, at: r.at, rows: rows, cats: cats, none: by[""] || 0 };
    return rvCache;
  }

  function remotePage(id, r) {
    if (rv.id !== id) rv = { id: id, q: "", cat: "", st: "", sort: "name" };
    var c = remoteRows(r), rows = c.rows;
    var pieces = 0, out = 0;
    rows.forEach(function (x) { if (x.q > 0) pieces += x.q; else out++; });
    var books = rows.filter(function (x) { return x.t === "book"; }).length;
    setTimeout(paintRemote, 0);
    return '<div class="row" style="margin-bottom:12px;align-items:center">' +
      '<button class="btn ghost" onclick="Stock.back()">→ كل المخازن</button>' +
      '<div style="font-family:var(--font-head);font-size:22px;font-weight:700">' + App.esc(branchName(id)) + "</div>" + freshness(r.at) +
      '<div class="spacer"></div><button class="btn primary" onclick="Stock.sync(true)">↻ تحديث</button></div>' +
      '<p class="muted" style="margin:0 0 12px"><b class="num">' + books.toLocaleString("en") + "</b> كتاب" +
      (rows.length > books ? " و<b class=\"num\">" + (rows.length - books).toLocaleString("en") + "</b> صنف قرطاسية" : "") +
      ' · <b class="num">' + pieces.toLocaleString("en") + '</b> نسخة · <b class="num">' + out.toLocaleString("en") + "</b> نفد عندهم" +
      ' <span class="muted small">— قائمة الفرع تصل كل نصف ساعة إن تغيّرت، و«↻ تحديث» يطلب الأحدث الآن</span></p>' +
      '<div class="search-big"><span class="mag">⌕</span><input class="inp" id="rbq" autocomplete="off" ' +
      'placeholder="ابحث في كتب ' + App.esc(branchName(id)) + ': العنوان، المؤلف، الباركود…" value="' + App.esc(rv.q) + '" oninput="Stock.rSet(\'q\',this.value)"></div>' +
      '<div class="row" style="margin-bottom:14px">' +
      '<select class="inp" style="width:auto;max-width:260px" onchange="Stock.rSet(\'cat\',this.value)"><option value="">كل التخصصات</option>' +
      c.cats.map(function (x) { return '<option value="' + App.esc(x.c) + '"' + (rv.cat === x.c ? " selected" : "") + ">" + App.esc(x.c) + " (" + x.n.toLocaleString("en") + ")</option>"; }).join("") +
      (c.none ? '<option value="__none"' + (rv.cat === "__none" ? " selected" : "") + ">بلا تخصص (" + c.none.toLocaleString("en") + ")</option>" : "") + "</select>" +
      '<select class="inp" style="width:auto" onchange="Stock.rSet(\'st\',this.value)">' +
      '<option value="">كل الحالات</option><option value="have"' + (rv.st === "have" ? " selected" : "") + ">المتوفر عندهم</option>" +
      '<option value="out"' + (rv.st === "out" ? " selected" : "") + ">نفد عندهم</option></select>" +
      '<select class="inp" style="width:auto" onchange="Stock.rSet(\'sort\',this.value)">' +
      '<option value="name"' + (rv.sort === "name" ? " selected" : "") + ">حسب الاسم</option>" +
      '<option value="qty"' + (rv.sort === "qty" ? " selected" : "") + ">الأكثر كمية</option>" +
      '<option value="low"' + (rv.sort === "low" ? " selected" : "") + ">الأقل كمية</option></select>" +
      '<div class="spacer"></div><span class="muted small" id="rbCount"></span></div>' +
      '<div class="card"><div id="rbBody"></div></div>';
  }

  function paintRemote() {
    var host = document.getElementById("rbBody");
    if (!host) return;
    var r = null;
    remotes().forEach(function (x) { if (x.id === rv.id) r = x; });
    if (!r) return;
    var all = remoteRows(r).rows;
    var rows = all.filter(function (x) {
      if (rv.cat === "__none") { if (x.c) return false; }
      else if (rv.cat && x.c !== rv.cat) return false;
      if (rv.st === "have" && x.q <= 0) return false;
      if (rv.st === "out" && x.q > 0) return false;
      return true;
    });
    if (rv.sort === "qty") rows = rows.slice().sort(function (a, b) { return b.q - a.q; });
    else if (rv.sort === "low") rows = rows.slice().sort(function (a, b) { return a.q - b.q; });
    rows = App.rank(rows, rv.q, function (x) { return [x.n, x.a, x.code, x.c]; });
    lastRows = rows;
    var bid = rv.id;
    host.innerHTML = App.table([
      { h: "الكتاب", c: function (x) {
        var sub = [x.t === "book" ? App.esc(x.a || "بدون مؤلف") : "قرطاسية" + (x.a ? " · " + App.esc(x.a) : "")];
        if (x.code) sub.push('<span class="num">' + App.esc(x.code) + "</span>");
        return '<div class="name">' + App.esc(x.n) + '</div><div class="sub">' + sub.join(" · ") + "</div>";
      } },
      { h: "التخصص", c: function (x) { return x.c ? '<span class="badge cat" title="' + App.esc(x.c) + '">' + App.esc(x.c) + "</span>" : '<span class="muted">—</span>'; } },
      { h: "الموقع", c: function (x) { return x.t === "book" ? locOf(x.ri) : App.esc(x.ri.loc || "—"); } },
      { h: "الكمية", cls: "num", c: function (x) { return x.q > 0 ? "<b>" + x.q + "</b>" : '<span class="badge bad">نفد</span>'; } },
      { h: "السعر", cls: "num", c: function (x) { return x.p > 0 ? App.money0(x.p) : '<span class="muted">—</span>'; } },
      { h: "", cls: "act", c: function (x, i) {
        return x.q > 0 ? '<button class="btn sm primary" onclick="Stock.askRow(\'' + App.esc(bid) + '\',' + i + ')">طلب تحويل</button>' : "";
      } }
    ], rows, {
      lazy: 100, rowClass: function (x) { return x.q <= 0 ? "out" : ""; },
      emptyIcon: "books", emptyTitle: all.length ? "لا نتيجة" : "لم تصل كتب هذا الفرع بعد",
      emptyText: all.length ? "جرّب كلمة أخرى أو غيّر التخصص." : "اضغط «تحديث»، أو راجع «قوائم الفروع» في الإعدادات ← الأجهزة والفروع."
    });
    var cn = document.getElementById("rbCount");
    if (cn) cn.textContent = rows.length.toLocaleString("en") + " من " + all.length.toLocaleString("en");
  }

  function rSet(k, v) { rv[k] = v; paintRemote(); }

  function branchPage(id) {
    var isMine = (id === S().branch.id) || !id;
    if (!isMine) {
      var rr = null;
      remotes().forEach(function (x) { if (x.id === id) rr = x; });
      if (rr) return remotePage(id, rr);
    }
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
      remotes().forEach(function (x) { if (x.id === id) r = x; });
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

    var shown = rows.filter(function (x) {
      if (view.cat === "__none__") { if (x.c) return false; }
      else if (view.cat && x.c !== view.cat) return false;
      return true;
    });
    if (view.sort === "qty") shown.sort(function (a, b) { return b.q - a.q; });
    else if (view.sort === "low") shown.sort(function (a, b) { return a.q - b.q; });
    else shown.sort(function (a, b) { return a.n > b.n ? 1 : -1; });
    shown = App.rank(shown, view.q, function (x) { return [x.n, x.a]; });

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
      '<input class="inp" id="stockQ" autocomplete="off" placeholder="ابحث داخل هذا المخزن…" value="' + App.esc(view.q) + '" oninput="Stock.setQ(this.value)"></div>' +
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
      emptyIcon: "box", emptyTitle: "لا أصناف",
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
  function setQ(v) { view.q = v; App.rerenderKeep("stockQ"); }

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
      ], incoming, { emptyIcon: "inward", emptyTitle: "لا طلبات واردة", emptyText: "عندما يطلب فرع آخر بضاعة منك ستظهر هنا." }) +
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
      ], outgoing, { emptyIcon: "outward", emptyTitle: "لم ترسل طلبات", emptyText: "ابحث عن صنف في المخزون واطلب تحويله من فرع آخر." }) +
      "</div>";

    return h;
  }

  /* ---------- غرفة الخزين ----------
     جزء من كمية كل صنف موجود في غرفة الخزين (it.store) لا على الرفوف.
     الصفحة تجمع: النقل بالقارئ، وما في الغرفة الآن، وإرجاعه كله. */
  function roomItems() {
    return App.allItems().filter(function (x) { return App.storeQty(x.it) > 0; });
  }

  function roomPage() {
    var rows = roomItems();
    var pieces = rows.reduce(function (a, x) { return a + App.storeQty(x.it); }, 0);
    var h = '<div class="row" style="margin-bottom:16px">' +
      '<button class="btn ghost" onclick="Stock.back()">→ كل المخازن</button>' +
      '<div style="font-family:var(--font-head);font-size:22px;font-weight:700">غرفة الخزين</div>' +
      '<span class="badge">داخل المحل</span><div class="spacer"></div>' +
      (rows.length ? '<button class="btn" onclick="Stock.printRoom()">اطبع ما في الغرفة</button>' +
        '<button class="btn" onclick="Stock.roomAllBack()">⇦ أرجع كل ما في الغرفة إلى الرفوف</button>' : "") +
      "</div>";
    h += Inv.moveScreen();
    h += '<div class="card"><div class="card-head"><h3>ما في غرفة الخزين الآن</h3><div class="spacer"></div>' +
      '<span class="muted small">' + rows.length + " صنف · " + pieces + " نسخة</span></div>" +
      App.table([
        {
          h: "الصنف", c: function (x) {
            return '<div class="name">' + App.esc(App.itemName(x.it)) + "</div>" +
              '<div class="sub">' + (x.type === "book" ? "كتاب" : "قرطاسية") + (x.it.author ? " · " + App.esc(x.it.author) : "") + "</div>";
          }
        },
        { h: "مكانه على الرفوف", c: function (x) { return x.type === "book" ? App.locChip(x.it) : App.esc(x.it.loc || "—"); } },
        { h: "على الرفوف", cls: "num", c: function (x) { return '<b class="q-sh">' + App.shelfQty(x.it) + "</b>"; } },
        { h: "في الغرفة", cls: "num", c: function (x) { return '<b class="q-st">' + App.storeQty(x.it) + "</b>"; } },
        {
          h: "", cls: "act", c: function (x) {
            return '<button class="btn sm" onclick="Inv.move(\'' + x.type + "','" + x.it.id + '\',\'in\')">⇦ نقل للرفوف</button>';
          }
        }
      ], rows, {
        lazy: 60, emptyIcon: "check", emptyTitle: "الغرفة فارغة",
        emptyText: "كل بضاعتك على الرفوف. ما تضعه هنا يظهر في هذه القائمة."
      }) + "</div>";
    return h;
  }

  function roomAllBack() {
    var all = roomItems();
    /* كتاب بلا مكتبة ولا رف يُنقل وحده ليُختار رفه */
    var rows = all.filter(function (x) { return !(x.type === "book" && !x.it.lib && !x.it.shelf); });
    var skip = all.length - rows.length;
    if (!rows.length) {
      if (skip) App.toast(skip + " كتاب بلا رف: انقلها واحداً واحداً لتختار رف كل كتاب.", "warn");
      return;
    }
    var n = rows.reduce(function (a, x) { return a + App.storeQty(x.it); }, 0);
    App.confirm("سيُحسب كل ما في غرفة الخزين (" + n + " نسخة من " + rows.length + " صنف) على الرفوف. المجموع لا يتغيّر." +
      (skip ? " و" + skip + " كتاب بلا رف يبقى: انقله وحده لتختار رفه." : ""),
      function () {
        var moved = 0;
        rows.forEach(function (x) { moved += App.moveStock(x.it, App.storeQty(x.it), "in"); });
        App.save(); App.rerender();
        if (App.celebrate) App.celebrate("أُرجعت إلى الرفوف", moved + " نسخة");
      }, { yes: "أرجع " + n + " نسخة إلى الرفوف" });
  }

  function printRoom() {
    var rows = roomItems();
    if (!rows.length) { App.toast("الغرفة فارغة."); return; }
    var h = '<div class="receipt a4"><h2>' + App.esc(S().meta.shopName || "المحل") + "</h2>" +
      '<div class="c">ما في غرفة الخزين — ' + App.dateAr(App.today()) + "</div><hr>" +
      "<table><thead><tr><th>الصنف</th><th>مكانه على الرفوف</th><th>على الرفوف</th><th>في الغرفة</th></tr></thead><tbody>";
    rows.forEach(function (x) {
      h += "<tr><td>" + App.esc(App.itemName(x.it)) + "</td><td>" +
        (x.type === "book" ? (x.it.lib || x.it.shelf ? App.esc((x.it.lib || "") + " / رف " + (x.it.shelf || "")) : "بلا رف بعد") : App.esc(x.it.loc || "")) +
        '</td><td class="num">' + App.shelfQty(x.it) + '</td><td class="num"><b>' + App.storeQty(x.it) + "</b></td></tr>";
    });
    h += "</tbody></table></div>";
    App.printHtml(h);
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
      ], rows, { emptyIcon: "home", emptyTitle: "لا بضاعة مسجّلة", emptyText: "سجّل ما أرسلته إلى هذا المخزن." }) + "</div>";
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

  /* الموقع يُرفع على Netlify باسم يختاره صاحب المحل، فلا عنوان
     ثابتاً نكتبه هنا: يُحفظ في بيانات المحل ويُعرض للنسخ. */
  function viewerUrl() { return String(S().sync.site || "").trim(); }
  /* موقع تطبيق الهاتف لهذا الفرع (Netlify): المحفوظ، وإلا موقع الفرع المعروف */
  function appSite() {
    var u = viewerUrl();
    if (u) return u.replace(/\/+$/, "");
    var b = String((S().branch && S().branch.id) || "").toLowerCase();
    return b === "tripoli" ? "https://dar-alhekma-tripoli.netlify.app" : b === "misrata" ? "https://dar-alhekma-misrata.netlify.app" : "";
  }
  /* رابط يفتح التطبيق مربوطاً: يُرسل للهاتف (واتساب) ويُفتح مرة */
  function appLink() {
    var site = appSite();
    if (!site) return "";
    return site + "/#u=" + encodeURIComponent(S().sync.url || "") + "&k=" + encodeURIComponent(S().sync.key || "") +
      "&b=" + encodeURIComponent(String((S().branch && S().branch.id) || "").toLowerCase());
  }

  function phoneView() {
    if (!configured()) {
      App.toast("اضبط الربط أولاً — العارض يقرأ من نفس العنوان.", "warn");
      setupLink();
      return;
    }
    var fld = function (label, val, id, hint, editable) {
      return '<div style="margin-bottom:14px">' +
        '<div class="muted small" style="margin-bottom:5px">' + App.esc(label) + "</div>" +
        '<div style="display:flex;gap:8px;align-items:stretch">' +
        '<input class="inp" id="' + id + '"' + (editable ? "" : " readonly") +
        ' value="' + App.esc(val) +
        '" style="flex:1;font-family:monospace;direction:ltr;text-align:left"' +
        (editable ? ' placeholder="https://esmak.netlify.app"' : "") + ">" +
        '<button class="btn sm" onclick="Stock.copyBox(\'' + id + '\')">نسخ</button></div>' +
        (hint ? '<div class="muted small" style="margin-top:5px">' + hint + "</div>" : "") +
        "</div>";
    };
    App.modal({
      title: "المشاهدة من التلفون",
      size: "wide",
      body:
        '<p class="muted small" style="line-height:1.9;margin:0 0 16px">' +
        "تطبيق الهاتف لهذا الفرع: البيع، والبحث في الكتب، والتعديل، وتسجيل الأماكن والجرد. " +
        "كل ما يبيعه أو يعدّله يمرّ على هذه المنظومة أولاً، ولا تظهر فيه أسعار الشراء ولا الأرباح. " +
        "<b>أسهل طريقة:</b> أرسل «رابط التطبيق» للهاتف (واتساب) وافتحه هناك مرة — يفتح مربوطاً. " +
        "في تطبيق أندرويد: الصق الرابط نفسه في أول شاشة.</p>" +
        (appLink() ? fld("رابط التطبيق للهاتف (يفتح مربوطاً)", appLink(), "pvLink",
          "الآيفون: افتحه في سفاري ← مشاركة ← «إضافة إلى الشاشة الرئيسية». فيه كلمة سر الربط: أرسله لهواتف المحل وحدها.") : "") +
        fld("١. موقع التطبيق (Netlify)", appSite(), "pvSite",
          "موقع تطبيق هذا الفرع. غيّره فقط إن رفعت التطبيق على موقع آخر.", true) +
        fld("٢. عنوان الربط", S().sync.url, "pvSync") +
        fld("٣. كلمة سر الربط", S().sync.key, "pvKey",
          "لا ترسلها في مجموعة عامة. من يملكها يرى مخزونك.") +
        '<p class="muted small" style="line-height:1.9;margin:4px 0 0">' +
        "يُحفظان على ذلك الجهاز وحده. ما يظهر هناك هو <b>آخر لقطة مرفوعة</b>، " +
        "فإن كان جهاز فرع مطفأً فخبره قديم — والعارض يكتب عمر البيانات بالأحمر " +
        "بجانب اسم الفرع حتى لا تثق برقم قديم وأنت تظنه اليوم.</p>",
      actions: [{
        label: "حفظ وتحديث اللقطة", kind: "primary",
        click: function (close) {
          var e = document.getElementById("pvSite");
          if (e) {
            var u = e.value.trim();
            if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
            S().sync.site = u;
            App.saveNow();
          }
          close(); sync(true);
        }
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
    roomAllBack: roomAllBack, printRoom: printRoom, setPhoneSales: setPhoneSales, takePhoneOrders: takePhoneOrders, takePhoneEdits: takePhoneEdits,
    delWhLine: delWhLine, delWarehouse: delWarehouse,
    manualExport: manualExport, manualImport: manualImport, exportStock: exportStock,
    phoneView: phoneView, copyBox: copyBox,
    workerSetup: workerSetup, copyWorker: copyWorker,
    snapshot: snapshot, linkBlock: linkBlock, phones: phones, rSet: rSet,
    kvFast: function () { return kvFast; }
  };
})();
