/* ============================================================
   core.js — نواة تطبيق المكتبة (بلا شاشات)
   ------------------------------------------------------------
   التطبيق لا يكتب في بيانات المحل أبداً. يقرأ لقطة فرعه من خادم الربط
   (نفس الـWorker الذي يربط الأجهزة والفروع)، ويكتب في ملفه هو:
   فواتير البيع والتعديلات، والمنظومة على الكمبيوتر تسجّلها وتعيد رقم
   الفاتورة في لقطتها (acks).

   الكتب: من لقطة الفرع (فرع صغير مثل مصراتة)، أو من «قائمة الفرع» على
   خادم الربط (فرع كبير مثل طرابلس بـ61 ألف كتاب: لقطته تُرفع بلا كتب،
   والقائمة مضغوطة قطعاً — v2/catalogs وv2/catalog-part). كل شيء يُحفظ
   على الهاتف (IndexedDB) فيعمل بلا إنترنت.
   ============================================================ */
var Core = (function () {
  "use strict";

  var CFG = window.MAKTABA_CONFIG || {};
  var KEY = "darhikma_app_v1";
  var S = null;
  var data = { snap: null, cat: null };     // لقطات الفروع، وقائمة فرعنا الكبير
  var ver = 0, cache = null;               // نموذج الأصناف يُبنى مرة لكل تغيّر
  var listeners = [];
  var busy = false, pushing = false, pushAgain = false;

  /* ---------- أدوات ---------- */
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function digits(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 1632); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 1776); });
  }
  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var n = parseFloat(digits(v).replace(/[٫,]/g, ".").replace(/[^\d.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  function r3(v) { return Math.round(num(v) * 1000) / 1000; }
  function money(v) { return (Math.round(num(v) * 100) / 100).toFixed(2); }
  function norm(s) {
    return digits(String(s === null || s === undefined ? "" : s).toLowerCase())
      .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, "")
      .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
      .replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ـ/g, "")
      .replace(/\s+/g, " ").trim();
  }
  function p2(x) { return (x < 10 ? "0" : "") + x; }
  function localToday() { var d = new Date(); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); }
  function nowStamp() { var d = new Date(); return localToday() + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()); }
  function rand(n) {
    var a = "abcdefghijklmnopqrstuvwxyz0123456789", out = "";
    try {
      var r = new Uint8Array(n); crypto.getRandomValues(r);
      for (var i = 0; i < n; i++) out += a[r[i] % a.length];
    } catch (e) { for (var j = 0; j < n; j++) out += a[Math.floor(Math.random() * a.length)]; }
    return out;
  }
  /* عمر الشيء بالكلمات */
  function ago(at) {
    if (!at) return "";
    var t = new Date(String(at).replace(" ", "T"));
    var m = Math.round((Date.now() - t.getTime()) / 60000);
    if (isNaN(m)) return String(at);
    if (m < 1) return "الآن";
    if (m < 60) return "قبل " + m + (m === 1 ? " دقيقة" : m === 2 ? " دقيقتين" : m <= 10 ? " دقائق" : " دقيقة");
    var h = Math.round(m / 60);
    if (m < 1440) return "قبل " + (h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h + (h <= 10 ? " ساعات" : " ساعة"));
    var d = Math.round(m / 1440);
    return "قبل " + (d === 1 ? "يوم" : d === 2 ? "يومين" : d + (d <= 10 ? " أيام" : " يوماً"));
  }
  function fmtN(n) { return Number(n || 0).toLocaleString("en"); }

  /* ---------- الحالة (صغيرة: localStorage) ---------- */
  function blank() {
    return {
      cfg: { url: "", key: "", branch: "" },
      phone: { id: "phone-" + rand(8), name: "هاتف" },
      orders: [], edits: [], cart: [],
      sell: { disc: "", method: "cash", cust: "", paid: "" },
      loc: { lib: "", shelf: "1", count: true, list: [] },
      /* «إضافة كمية»: جلسة إدخال بضاعة تبقى حتى تُحفظ (ولو أُغلق التطبيق) */
      recv: { dst: "shelf", sp: "", nt: "", lines: [] },
      pref: {}, draft: {},
      bio: {}, pin: null, last: "", at: "", catVer: "", seen: {}
    };
  }
  /* الإعدادات وقيمها الأولى. lockMin: القفل بعد الغياب (دقائق) · every: التحديث التلقائي (0 = الأسرع المسموح،
     ثوانٍ، −1 = يدوي) · cont: المسح المتواصل في البيع */
  var PREF0 = {
    font: "m", dark: "light", anim: true, payDef: "cash", camSell: true, cont: false, beep: true, vib: true,
    autoPrint: false, lockMin: 2, every: 0, view: "list", type: "book", mode: "view",
    nStock: true, nRestock: true, nDaily: true, nSync: true
  };
  function pref(k) { var p = (S && S.pref) || {}; return p[k] === undefined ? PREF0[k] : p[k]; }
  function setPref(k, v) {
    if (!S.pref || typeof S.pref !== "object") S.pref = {};
    S.pref[k] = v;
    save();
    emit("pref", k);
  }
  function load() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { d = null; }
    var b = blank();
    if (!d || typeof d !== "object") d = b;
    Object.keys(b).forEach(function (k) { if (d[k] === undefined || d[k] === null && k !== "pin") d[k] = b[k]; });
    ["orders", "edits", "cart"].forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
    if (!d.loc || !Array.isArray(d.loc.list)) d.loc = b.loc;
    d.loc.count = true;                                   // 3.0: الجرد فقط (تسجيل الأماكن وحده أُزيل)
    if (!d.recv || !Array.isArray(d.recv.lines)) d.recv = b.recv;
    if (!d.pref || typeof d.pref !== "object") d.pref = {};
    if (!d.draft || typeof d.draft !== "object") d.draft = {};
    if (!/^phone-[a-z0-9]{6,}$/.test((d.phone && d.phone.id) || "")) d.phone = b.phone;
    if (!d.cfg || typeof d.cfg !== "object") d.cfg = b.cfg;
    /* فرع التطبيق من config.js يغلب: تطبيق طرابلس لا يصير تطبيق مصراتة برابط */
    if (CFG.branch) d.cfg.branch = String(CFG.branch).toLowerCase();
    if (!d.cfg.url && CFG.url) { d.cfg.url = CFG.url; d.cfg.key = CFG.key || ""; }
    return d;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { }
  }

  /* ---------- IndexedDB: اللقطات والقائمة الكبيرة ---------- */
  var dbP = null;
  function idb() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error("no-idb")); return; }
      var r = indexedDB.open("darhikma_app", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error("idb")); };
    });
    dbP.catch(function () { });
    return dbP;
  }
  function idbDo(mode, fn) {
    return idb().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction("kv", mode), st = t.objectStore("kv"), out;
        var q = fn(st);
        if (q) q.onsuccess = function () { out = q.result; };
        t.oncomplete = function () { res(out); };
        t.onerror = t.onabort = function () { rej(t.error || new Error("idb")); };
      });
    });
  }
  function put(k, v) { return idbDo("readwrite", function (st) { return st.put(v, k); }).catch(function () { }); }
  function get(k) { return idbDo("readonly", function (st) { return st.get(k); }).catch(function () { return null; }); }
  function drop(k) { return idbDo("readwrite", function (st) { return st.delete(k); }).catch(function () { }); }

  /* ---------- الربط ---------- */
  function configured() { return !!String(S.cfg.url || "").trim() && !!String(S.cfg.key || "").trim(); }
  function base() { return String(S.cfg.url || "").trim().replace(/\/+$/, ""); }
  function hdr(extra) {
    var h = { "X-Shop-Key": String(S.cfg.key || "") };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }
  /* رابط الربط من المنظومة: …#u=<العنوان>&k=<كلمة السر>&b=<الفرع> */
  function parseLink(str) {
    var t = String(str || "").trim(), at = t.indexOf("#");
    var q = at >= 0 ? t.slice(at + 1) : t;
    var out = {};
    q.split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i < 0) return;
      try { out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " ")); } catch (e) { }
    });
    return out.u ? { url: out.u, key: out.k || "", branch: (out.b || "").toLowerCase() } : null;
  }
  function setLink(l) {
    S.cfg.url = String(l.url || "").trim();
    S.cfg.key = String(l.key || "").trim();
    if (!CFG.branch && l.branch) S.cfg.branch = String(l.branch).toLowerCase();
    S.at = ""; S.catVer = "";
    data.snap = null; data.cat = null; ver++;
    drop("snap"); drop("cat");
    save();
  }
  function unlink() {
    S.cfg.url = ""; S.cfg.key = ""; S.at = ""; S.catVer = "";
    if (!CFG.branch) S.cfg.branch = "";
    data.snap = null; data.cat = null; ver++;
    drop("snap"); drop("cat");
    save();
  }

  function isPhone(br) { return !!br && (br.kind === "phone" || /^phone-/i.test(String((br.branch && br.branch.id) || ""))); }
  function branches() { return ((data.snap && data.snap.branches) || []).filter(function (b) { return !isPhone(b); }); }
  function branchId() { return String(S.cfg.branch || "").toLowerCase(); }
  /* فرع هذا التطبيق. فرع محدّد لم يصل بعد = null (لا يُباع لفرع آخر) */
  function mine() {
    var real = branches(), want = branchId();
    if (want) return real.filter(function (b) { return b.branch && String(b.branch.id).toLowerCase() === want; })[0] || null;
    return real.filter(function (b) { return b.dash; })[0] || real[0] || null;
  }
  function shop() {
    var m = mine();
    var sh = (m && m.shop) || {};
    return {
      name: sh.name || (m && m.branch && m.branch.name) || CFG.name || "المكتبة",
      city: (m && m.branch && m.branch.city) || CFG.city || "",
      logo: sh.logo || CFG.logo || "", libs: sh.libs || []
    };
  }
  function cur() { var m = mine(); return (m && m.dash && m.dash.cur) || "د.ل"; }

  /* لقطات الفروع: …/all (المخزن القديم KV) */
  /* سبب آخر فشل في التحديث: BADKEY (كلمة السر) | NET (لا اتصال/عنوان خطأ) | TIMEOUT | HTTP nnn. تعرضه
     شاشة الانتظار بدل أن تدور إلى الأبد بلا كلمة (الفشل الأول كان يبقيها «يحمّل بيانات الفرع…») */
  var lastErr = "";
  /* كلمة السر تُرسل في ترويسة HTTP: حرف غير إنجليزي فيها (عربي من لوحة المفاتيح، أو علامة «ذكية» يضعها الآيفون
     مثل – بدل -) يجعل المتصفح يرفض الطلب كله برسالة تقنية، وكانت الشاشة تدور بلا سبب ظاهر */
  function badKeyChars(k) { return /[^\x20-\x7E]/.test(String(k || "")); }
  function fetchAll() {
    if (badKeyChars(S.cfg.key)) return Promise.reject(new Error("BADCHARS"));
    /* مهلة 30 ثانية: عنوان لا يردّ أو شبكة معلّقة لا تترك الشاشة تدور بلا نهاية */
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 30000) : 0;
    return fetch(base() + "/all", { headers: hdr(), cache: "no-store", signal: ctl ? ctl.signal : undefined }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error("BADKEY");
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      clearTimeout(timer);
      if (!d || !d.ok) throw new Error((d && d.error) || "رد غير مفهوم من خادم الربط");
      S.kvv = num(d.v);
      return d.branches || [];
    }, function (e) {
      clearTimeout(timer);
      if (e && /^(BADKEY|BADCHARS|HTTP \d+)/.test(e.message || "")) throw e;
      if (e && e.name === "AbortError") throw new Error("TIMEOUT");
      if (e && e.message && !/Failed to fetch|NetworkError|Load failed|network/i.test(e.message)) throw e;
      throw new Error("NET");
    });
  }


  /* قائمة فرع كبير: base64 لملف gzip مقسوماً قطعاً (ShopDb.Pack في المنظومة) */
  function unpack(b64) {
    var bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("OLDPHONE"));
    var ds = new DecompressionStream("gzip");
    var stream = new Blob([u]).stream().pipeThrough(ds);
    return new Response(stream).text();
  }
  function fetchCatalog(br, onProgress) {
    var bq = "?branch=" + encodeURIComponent(br);
    return fetch(base() + "/v2/catalogs" + bq, { headers: hdr(), cache: "no-store" }).then(function (r) {
      if (r.status === 404 || r.status === 501) return null;          // خادم قديم بلا قوائم
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || !d.ok) return null;
      var c = (d.catalogs || []).filter(function (x) { return String(x.branch).toLowerCase() === br; })[0];
      if (!c) return null;
      if (c.ver === S.catVer && data.cat) return data.cat;             // لم تتغيّر
      var parts = Math.max(1, num(c.parts)), got = [], i = 0;
      function next() {
        if (i >= parts) return Promise.resolve();
        if (onProgress) onProgress(i, parts);
        return fetch(base() + "/v2/catalog-part" + bq + "&ver=" + encodeURIComponent(c.ver) + "&part=" + i, { headers: hdr(), cache: "no-store" })
          .then(function (r) {
            if (r.status === 410) throw new Error("RETRY");               // نُشرت أحدث منها في الأثناء
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.text();
          }).then(function (t) { got.push(t); i++; return next(); });
      }
      return next().then(function () { return unpack(got.join("")); }).then(function (txt) {
        var j = JSON.parse(txt);
        var cat = { ver: c.ver, at: j.at || "", n: (j.items || []).length, items: j.items || [], name: c.name || "" };
        data.cat = cat; S.catVer = c.ver; ver++;
        put("cat", cat); save();
        return cat;
      });
    });
  }

  /* التحديث: اللقطات، ثم قائمة فرعنا إن كان كبيراً، ثم التأكيدات والإرسال */
  function refresh(opts) {
    opts = opts || {};
    if (busy || !configured()) return Promise.resolve(false);
    busy = true;
    emit("busy", true);
    return fetchAll().then(function (brs) {
      data.snap = { at: nowStamp(), branches: brs };
      ver++;
      put("snap", data.snap);
      S.at = data.snap.at;
      var m = mine();
      var big = m && !(m.items && m.items.length);
      if (!big) return null;
      return fetchCatalog(branchId() || String(m.branch.id).toLowerCase(), function (i, n) { emit("catalog", { i: i, n: n }); })
        .catch(function (e) {
          if (e && e.message === "RETRY") return null;
          if (e && e.message === "OLDPHONE") emit("oldphone");
          return null;
        });
    }).then(function () {
      busy = false;
      lastErr = "";
      var newly = takeAcks();
      refreshMe();
      save();
      push();
      emit("busy", false);
      emit("data", { acks: newly, eds: newly.eds || [] });
      return true;
    }).catch(function (e) {
      busy = false;
      lastErr = (e && e.message) || "NET";
      emit("busy", false);
      emit("error", e && (e.message === "BADKEY" || e.message === "BADCHARS") ? e.message : "NET");
      return false;
    });
  }

  /* ---------- نموذج الأصناف ----------
     صنف واحد لكل كتاب أو قرطاسية في فرع هذا التطبيق، ومعه ما في الفروع
     الأخرى (من لقطاتها، إن كانت فيها كتب). المفتاح: الباركود، وإلا الرمز */
  function itemKey(b, k, t, n) {
    b = String(b || "").trim(); k = String(k || "").trim();
    return b ? "b:" + b : k ? "k:" + k.toUpperCase() : "n:" + (t || "") + "|" + norm(n);
  }
  function parsePlace(p) {
    var s = String(p || ""), lib = "", shelf = "";
    var a = /خزانة\s*([^\s·]+)/.exec(s), b = /رف\s*([^\s·]+)/.exec(s);
    if (a) lib = a[1];
    if (b) shelf = b[1];
    return { lib: lib, shelf: shelf };
  }
  function fromSnap(i) {
    var st = Math.min(Math.max(num(i.st), 0), Math.max(num(i.q), 0));
    var book = i.t === "book";
    return {
      t: i.t || "book", code: i.k || "", n: i.n || "", a: i.a || "", b: i.b || "", c: i.c || "",
      q: num(i.q), room: st, p: num(i.p), m: num(i.m),
      lib: book ? String(i.l || "") : "", shelf: book ? String(i.s || "") : "", loc: book ? "" : (i.loc || ""),
      d: i.d || "", nt: i.nt || "", u: i.u || "", sl: num(i.sl), ls: i.ls || "",
      pw: num(i.pw), cf: i.cf || "", sp: i.sp || "", un: i.un ? 1 : 0
    };
  }
  function fromCat(a) {
    var book = a[0] !== "stat", pl = book ? parsePlace(a[9]) : { lib: "", shelf: "" };
    return {
      t: book ? "book" : "stat", code: a[1] || "", n: a[2] || "", a: a[3] || "", b: a[4] || "", c: a[5] || "",
      q: num(a[6]), room: Math.min(Math.max(num(a[12]), 0), Math.max(num(a[6]), 0)), wh: num(a[7]), p: num(a[8]) / 1000, m: num(a[11]),
      lib: pl.lib, shelf: pl.shelf, loc: book ? (pl.lib || pl.shelf ? "" : String(a[9] || "")) : String(a[9] || ""),
      /* الأعمدة بعد العاشر (منظومة 4.2 فما فوق): دار النشر، حد التنبيه، غرفة الخزين، سعر الجملة،
         التخصص الدقيق، الملاحظة، الوحدة، المورّد، لم يُجرد. منظومة أقدم: غير موجودة = فارغة */
      d: a[10] || "", nt: a[15] || "", u: a[16] || "", sl: 0, ls: "",
      pw: num(a[13]) / 1000, cf: a[14] || "", sp: a[17] || "", un: num(a[18]) ? 1 : 0
    };
  }
  function hay(g) { return norm([g.n, g.a, g.b, g.code, g.c, g.d, g.cf].join(" ")); }
  function build() {
    var m = mine(), list = [], by = {}, byK = {}, src = "none", srcAt = "";
    if (m && m.items && m.items.length) { list = m.items.map(fromSnap); src = "snap"; srcAt = m.at || ""; }
    else if (data.cat) { list = data.cat.items.map(fromCat); src = "cat"; srcAt = data.cat.at || ""; }
    list.forEach(function (g) {
      g.key = itemKey(g.b, g.code, g.t, g.n);
      g.ob = g.b;                                         // الباركود كما في المنظومة (التعديل يُرسل به)
      g.shelfQ = g.q - g.room;
      g.others = [];
      g.h = hay(g);
      if (!by[g.key]) by[g.key] = g;
      if (g.code) { var ck = String(g.code).toUpperCase(); if (!byK[ck]) byK[ck] = g; }
    });
    /* الفروع الأخرى: من لقطاتها (فرع كبير بلا كتب في لقطته لا يظهر هنا) */
    branches().forEach(function (br) {
      if (br === m || !br.items || !br.items.length) return;
      var nm = (br.branch && (br.branch.city ? "فرع " + br.branch.city : br.branch.name)) || "فرع";
      br.items.forEach(function (i) {
        var g = by[itemKey(i.b, i.k, i.t, i.n)];
        if (g) g.others.push({ name: nm, q: num(i.q) });
      });
    });
    list.sort(function (x, y) { return x.n < y.n ? -1 : x.n > y.n ? 1 : 0; });
    return { list: list, by: by, byK: byK, src: src, srcAt: srcAt };
  }
  /* بيع وتعديلات من هذا الهاتف لم تظهر بعد في البيانات: تُطبَّق على المعروض.
     التعديل يغيّر نسخة من الصنف، و«إضافة كمية» تزيد كميته، و«صنف جديد» يظهر أول القائمة
     حتى تسجّله المنظومة ويصل في بياناتها */
  function applySet(g, f) {
    if (f.n) g.n = f.n;
    if (f.a !== undefined) g.a = f.a;
    if (f.d !== undefined) g.d = f.d;
    if (f.sp !== undefined) g.sp = f.sp;
    if (f.c !== undefined) g.c = f.c;
    if (f.cf !== undefined) g.cf = f.cf;
    if (f.bc !== undefined) g.b = f.bc;
    if (f.p !== undefined) g.p = num(f.p);
    if (f.pw !== undefined) g.pw = num(f.pw);
    if (f.m !== undefined) g.m = num(f.m);
    if (f.l !== undefined) g.lib = f.l;
    if (f.s !== undefined) g.shelf = String(f.s);
    if (f.loc !== undefined) g.loc = f.loc;
    if (f.u !== undefined) g.u = f.u;
    if (f.nt !== undefined) g.nt = f.nt;
    if (f.qd) g.q += num(f.qd);
    if (f.st !== undefined) g.room = Math.min(Math.max(num(f.st), 0), Math.max(g.q, 0));
    if (f.cnt) g.un = 0;
    g.room = Math.min(g.room, Math.max(g.q, 0));
    g.shelfQ = g.q - g.room;
  }
  function newGhost(e) {
    var f = e.set || {}, book = e.t !== "stat", q = Math.max(num(f.q), 0), store = f.dst === "store";
    var g = {
      t: book ? "book" : "stat", code: "", n: f.n || "", a: f.a || "", b: f.bc || "", c: f.c || "",
      q: q, room: store ? q : 0, wh: 0, p: num(f.p), m: num(f.m),
      lib: book && !store ? (f.l || "") : "", shelf: book && !store ? String(f.s || "") : "", loc: book || store ? "" : (f.loc || ""),
      d: f.d || "", nt: f.nt || "", u: f.u || "", sl: 0, ls: "", pw: num(f.pw), cf: f.cf || "", sp: f.sp || "", un: 0,
      key: "new:" + e.id, ob: "", others: [], isNew: true, editing: true, newSt: e.status
    };
    g.shelfQ = g.q - g.room;
    g.h = hay(g);
    return g;
  }
  function adjusted(c) {
    var catAt = c.src === "cat" ? c.srcAt : "";
    var live = function (x) {
      return x.status === "pending" || (catAt && (x.status === "done" || x.status === "part") && String(x.at) > catAt);
    };
    var ords = S.orders.filter(live), eds = S.edits.filter(live);
    if (!ords.length && !eds.length) return c.list;
    var touched = {}, ghosts = [], names = null;
    function hit(b, k) {
      var g = (b && c.by["b:" + String(b).trim()]) || (k && (c.by["k:" + String(k).trim().toUpperCase()] || c.byK[String(k).trim().toUpperCase()]));
      if (!g) return null;
      if (!touched[g.key]) { touched[g.key] = Object.assign({}, g); }
      return touched[g.key];
    }
    /* صنف جديد سجّلته المنظومة ووصل في البيانات: لا يُعرض مرتين */
    function arrived(e) {
      var f = e.set || {};
      if (f.bc && c.by["b:" + String(f.bc).trim()]) return true;
      if (e.status === "pending") return false;
      if (!names) { names = {}; c.list.forEach(function (g) { names[g.t + "|" + norm(g.n)] = 1; }); }
      return !!names[(e.t === "stat" ? "stat" : "book") + "|" + norm(f.n)];
    }
    eds.slice().reverse().forEach(function (e) {
      if (e.kind === "new") { if (!arrived(e)) ghosts.unshift(newGhost(e)); return; }
      if (e.kind === "recv") {
        (e.lines || []).forEach(function (l) {
          var r = hit(l.b, l.k);
          if (!r) return;
          r.q += num(l.q);
          if (e.dst === "store") r.room += num(l.q);
          r.shelfQ = r.q - r.room;
          r.editing = true;
        });
        return;
      }
      var g = hit(e.b, e.k);
      if (!g) return;
      applySet(g, e.set || {});
      g.editing = true;
      g.h = hay(g);
    });
    ords.forEach(function (o) {
      (o.items || []).forEach(function (l) {
        var g = hit(l.b, l.k);
        if (!g) return;
        g.q -= num(l.q); g.pend = (g.pend || 0) + num(l.q);
        g.room = Math.min(g.room, Math.max(g.q, 0));
        g.shelfQ = g.q - g.room;
        if (l.zp && num(l.p) > 0 && !(g.p > 0)) g.p = num(l.p);
      });
    });
    var out = c.list.map(function (g) { return touched[g.key] || g; });
    return ghosts.length ? ghosts.concat(out) : out;
  }
  var built = null, builtVer = -1, adjKey = "";
  function items() {
    if (builtVer !== ver || !built) { built = build(); builtVer = ver; cache = null; }
    var k = S.orders.length + ":" + S.edits.length + ":" + S.orders.map(function (o) { return o.status; }).join("") +
      S.edits.map(function (e) { return e.status + (e.rev || 0); }).join("");
    if (!cache || adjKey !== k) { cache = adjusted(built); adjKey = k; }
    return cache;
  }
  function info() { items(); return { src: built.src, at: built.srcAt, n: built.list.length }; }
  /* فهرس بالمفتاح: السلة وصفحة الصنف تسألان عنه مع كل رسم (61 ألف صنف في طرابلس) */
  var keyOf = null, keyMap = null;
  function byKey(key) {
    var all = items();
    if (keyOf !== all) {
      keyOf = all; keyMap = {};
      for (var i = 0; i < all.length; i++) if (!keyMap[all[i].key]) keyMap[all[i].key] = all[i];
    }
    return keyMap[key] || null;
  }
  function byCode(code) {
    var c = String(code || "").trim();
    if (!c) return null;
    var all = items(), u = c.toUpperCase();
    for (var i = 0; i < all.length; i++) if (all[i].b === c) return all[i];
    for (var j = 0; j < all.length; j++) if (String(all[j].code).toUpperCase() === u) return all[j];
    return null;
  }
  function invalidate() { ver++; }

  /* ---------- قوائم النماذج والرفوف ----------
     ما تختار منه نماذج «إضافة وتعديل»: الخزائن وعدد الرفوف والوحدات والتصنيفات ودور النشر
     والموردون. من المنظومة (ph في لقطتها، 4.2 فما فوق) ومما في الأصناف نفسها */
  function proto() { var m = mine(); return num(m && m.ph && m.ph.v); }
  var listsOf = null, listsCache = null;
  function lists() {
    var all = items();
    if (listsOf === all && listsCache) return listsCache;
    var m = mine() || {}, ph = m.ph || {}, sh = shop();
    var cb = {}, cs = {}, pubs = {}, libs = {}, maxShelf = 0;
    (ph.bcats || []).forEach(function (c) { if (c) cb[c] = cb[c] || 0; });
    (ph.scats || []).forEach(function (c) { if (c) cs[c] = cs[c] || 0; });
    (ph.pubs || []).forEach(function (x) { if (x) pubs[x] = pubs[x] || 0; });
    (ph.libs || sh.libs || []).forEach(function (l) { if (l) libs[l] = 1; });
    for (var i = 0; i < all.length; i++) {
      var g = all[i];
      if (g.t === "book") {
        if (g.c) cb[g.c] = (cb[g.c] || 0) + 1;
        if (g.d) pubs[g.d] = (pubs[g.d] || 0) + 1;
        if (g.lib && /^[A-Za-z\u0600-\u06FF0-9]{1,3}$/.test(g.lib)) libs[g.lib] = 1;
        var sn = parseInt(g.shelf, 10);
        if (sn > maxShelf && sn < 100) maxShelf = sn;
      } else if (g.c) cs[g.c] = (cs[g.c] || 0) + 1;
    }
    var byCount = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a] || (a < b ? -1 : 1); }); };
    var libList = Object.keys(libs).sort();
    if (!libList.length) libList = "ABCDEFGH".split("");
    listsOf = all;
    listsCache = {
      bcats: byCount(cb), scats: byCount(cs), bcount: cb, scount: cs, pubs: byCount(pubs),
      libs: libList, shelves: Math.max(num(ph.shelves) || 6, maxShelf),
      units: (ph.units && ph.units.length ? ph.units : ["قطعة", "علبة", "دزينة", "رزمة", "طقم", "متر", "كيلو"]).slice(),
      sups: (m.sup || []).slice()
    };
    return listsCache;
  }
  function byType(t) {
    var all = items();
    if (byType.of !== all) { byType.of = all; byType.c = {}; }
    if (!byType.c[t]) byType.c[t] = all.filter(function (g) { return g.t === t; });
    return byType.c[t];
  }
  /* خريطة الرفوف: كل خزانة ورفوفها وعدد العناوين والنسخ على كل رف (والقرطاسية: حسب مكانها) */
  function shelfMap(t) {
    var list = byType(t);
    if (shelfMap.of === list && shelfMap.t === t) return shelfMap.c;
    var libs = {}, none = { n: 0, q: 0 }, total = 0;
    list.forEach(function (g) {
      var a = t === "book" ? g.lib : g.loc, b = t === "book" ? String(g.shelf || "") : "";
      var q = Math.max(t === "book" ? g.shelfQ : g.q, 0);
      total++;
      if (!a && !b) { none.n++; none.q += q; return; }
      var L = libs[a || "؟"] || (libs[a || "؟"] = { lib: a || "؟", n: 0, q: 0, sh: {} });
      L.n++; L.q += q;
      var sh = L.sh[b] || (L.sh[b] = { s: b, n: 0, q: 0 });
      sh.n++; sh.q += q;
    });
    var out = Object.keys(libs).sort().map(function (k) {
      var L = libs[k];
      L.shelves = Object.keys(L.sh).map(function (x) { return L.sh[x]; }).sort(function (x, y) {
        var nx = parseInt(x.s, 10), ny = parseInt(y.s, 10);
        if (isNaN(nx) !== isNaN(ny)) return isNaN(nx) ? 1 : -1;
        return isNaN(nx) ? (x.s < y.s ? -1 : 1) : nx - ny;
      });
      L.max = L.shelves.reduce(function (a, x) { return Math.max(a, x.n); }, 1);
      delete L.sh;
      return L;
    });
    shelfMap.of = list; shelfMap.t = t;
    shelfMap.c = { libs: out, none: none, total: total };
    return shelfMap.c;
  }

  /* ---------- البحث المتسامح (نفس طريقة المنظومة) ----------
     المطابق أولاً (كل كلمة موجودة بأي ترتيب)؛ ولا مطابق = القريب: كلمة
     فيها حرف غلط، والحروف المتشابهة نطقاً حرف واحد، و«ال» لا تُحسب */
  function fold(s) {
    return norm(s).replace(/ء/g, "").replace(/ظ/g, "ض").replace(/[ذز]/g, "د").replace(/ث/g, "ت")
      .replace(/ص/g, "س").replace(/ط/g, "ت").replace(/[^ء-يa-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function fzStem(w) {
    if (w.length > 5 && w.indexOf("وال") === 0) return w.slice(3);
    if (w.length > 4 && w.indexOf("ال") === 0) return w.slice(2);
    return w;
  }
  function fzWords(s) { return fold(s).split(" ").filter(Boolean).map(fzStem); }
  function fzDist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var p = [], c, i, j;
    for (j = 0; j <= b.length; j++) p[j] = j;
    for (i = 1; i <= a.length; i++) {
      c = [i];
      var low = i;
      for (j = 1; j <= b.length; j++) {
        var v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        c[j] = v;
        if (v < low) low = v;
      }
      if (low > max) return max + 1;
      p = c;
    }
    return p[b.length];
  }
  function fzWord(q, words) {
    var best = null, exactOnly = q.length < 3 || /\d/.test(q), max = q.length >= 7 ? 2 : 1;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], d;
      if (w.indexOf(q) >= 0) d = 0;
      else if (exactOnly || /\d/.test(w)) continue;
      else if (q.length === 3) { if (w.length > 4) continue; d = fzDist(q, w, 1); }
      else {
        d = fzDist(q, w, max);
        for (var L = q.length - 1; L <= q.length + 1 && d > 0; L++) {
          if (L < 3 || L >= w.length) continue;
          d = Math.min(d, fzDist(q, w.slice(0, L), max) + 0.25);
        }
      }
      if (Math.floor(d) <= max && (!best || d < best.d)) best = { d: d, at: i };
      if (best && best.d === 0) break;
    }
    return best;
  }
  function search(list, q, limit) {
    var words = norm(q).split(" ").filter(Boolean);
    if (!words.length) return list;
    var exact = [], i, j, g, ok;
    for (i = 0; i < list.length; i++) {
      g = list[i]; ok = true;
      for (j = 0; j < words.length; j++) if (g.h.indexOf(words[j]) < 0) { ok = false; break; }
      if (ok) exact.push(g);
    }
    /* الاسم الذي يبدأ بالكلمة الأولى أولاً، ثم الباركود المطابق تماماً */
    var w0 = words[0];
    exact.sort(function (a, b) {
      var sa = (a.b === q.trim() ? 0 : norm(a.n).indexOf(w0) === 0 ? 1 : 2), sb = (b.b === q.trim() ? 0 : norm(b.n).indexOf(w0) === 0 ? 1 : 2);
      return sa - sb;
    });
    if (exact.length) { exact.fz = { first: -1 }; return exact; }
    var qw = fzWords(q), near = [];
    if (!qw.length) return exact;
    for (i = 0; i < list.length; i++) {
      g = list[i];
      var hw = g.fw || (g.fw = fzWords(g.n + " " + g.a));
      var sum = 0, pos = 0, miss = false;
      for (j = 0; j < qw.length; j++) {
        var m = fzWord(qw[j], hw);
        if (!m) { miss = true; break; }
        sum += m.d; pos += Math.min(m.at, 12);
      }
      if (!miss) near.push({ g: g, s: 90 - sum * 15 - pos / qw.length });
      if (limit && near.length > limit * 4) break;
    }
    near.sort(function (a, b) { return b.s - a.s; });
    var out = near.map(function (x) { return x.g; });
    out.fz = { first: out.length ? 0 : -1 };
    return out;
  }

  /* ---------- الموظفون والدخول ----------
     فرع فيه موظفون (طرابلس): كل موظف بكلمة سره نفسها في المنظومة (PBKDF2،
     البصمة فقط في اللقطة). فرع بلا موظفين (مصراتة): رمز دخول لهذا الهاتف.
     والوجه أو البصمة بعد أول دخول. الدخول مع كل فتح، وبعد دقيقتين في الخلفية */
  var me = null, unlocked = false;
  function staffInfo() {
    var m = mine();
    return (m && m.staff && m.staff.staff && m.staff.staff.length) ? m.staff : null;
  }
  function people() { var inf = staffInfo(); return inf ? inf.staff.filter(function (p) { return !p.off; }) : []; }
  function personOf(id) { return people().filter(function (p) { return p.id === id; })[0] || null; }
  function roleOf(p) {
    var inf = staffInfo();
    return inf && p ? (inf.roles || []).filter(function (r) { return r.id === p.r; })[0] || null : null;
  }
  function canP(perm) {
    if (!staffInfo()) return true;
    if (!me) return false;
    var r = roleOf(me);
    if (!r) return false;
    if (r.admin) return true;
    return (Array.isArray(perm) ? perm : [perm]).some(function (x) { return (r.perms || []).indexOf(x) >= 0; });
  }
  function who() {
    if (me) return { id: me.id, n: me.n, role: (roleOf(me) || {}).n || "" };
    return { id: "", n: S.phone.name || "هذا الهاتف", role: "" };
  }
  function needsPin() { return !staffInfo() && !S.pin; }
  function locked() { return !unlocked; }
  function refreshMe() {
    if (!me) return;
    var p = personOf(me.id);
    if (!staffInfo()) { me = null; return; }
    if (!p || p.h !== me.h) { me = null; unlocked = false; emit("relock", "تغيّرت بيانات دخولك في المنظومة — ادخل من جديد."); }
    else me = p;
  }
  function unhex(h) {
    var a = new Uint8Array(h.length / 2);
    for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
    return a;
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function pbkdf2(pw, saltHex, iters) {
    if (!window.crypto || !crypto.subtle) return Promise.reject(new Error("nocrypto"));
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(String(pw)), "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return crypto.subtle.deriveBits({ name: "PBKDF2", salt: unhex(saltHex), iterations: iters, hash: "SHA-256" }, k, 256);
    }).then(hex);
  }
  function pwOk(p, pw) {
    if (!p || !p.s || !p.h) return Promise.resolve(false);
    return pbkdf2(pw, p.s, 60000).then(function (h) { return h === p.h; }, function () { return false; });
  }
  function login(id, pw) {
    var p = personOf(id);
    return pwOk(p, pw).then(function (ok) {
      if (!ok) return false;
      me = p; unlocked = true; S.last = p.id; save();
      return true;
    });
  }
  /* رمز هذا الهاتف (فرع بلا موظفين) */
  function setPin(pin) {
    var salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    return pbkdf2(pin, salt, 20000).then(function (h) { S.pin = { s: salt, h: h }; unlocked = true; save(); return true; });
  }
  function pinOk(pin) {
    if (!S.pin) return Promise.resolve(false);
    return pbkdf2(pin, S.pin.s, 20000).then(function (h) {
      if (h !== S.pin.h) return false;
      unlocked = true; return true;
    }, function () { return false; });
  }
  function lock() { me = null; unlocked = false; }

  /* الوجه أو البصمة: أندرويد من التلفون نفسه (AndroidApp.bioAuth)، والآيفون WebAuthn.
     مربوطة بالموظف وبصمة كلمة سره (أو برمز الهاتف): تغيّرت = كلمة السر من جديد */
  var bioWait = {};
  var IOS = /iPad|iPhone|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function bioWord() { return IOS ? "الوجه" : "البصمة"; }
  function b64(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function unb64(t) { var s = atob(t), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function rnd(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function bioAvail() {
    if (window.AndroidApp) {
      try { return Promise.resolve(!!window.AndroidApp.bioAvailable && window.AndroidApp.bioAvailable() === "yes"); }
      catch (e) { return Promise.resolve(false); }
    }
    try {
      if (window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
        return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(function () { return false; });
      }
    } catch (e) { }
    return Promise.resolve(false);
  }
  function androidBio(title) {
    return new Promise(function (res) {
      var id = "b" + Date.now().toString(36) + rand(3);
      bioWait[id] = res;
      try { window.AndroidApp.bioAuth(id, title); } catch (e) { delete bioWait[id]; res(false); }
    });
  }
  function bioDone(id, ok) { var f = bioWait[id]; delete bioWait[id]; if (f) f(!!ok); }
  function bioTag(id) {
    if (id) { var p = personOf(id); return p ? String(p.h || "").slice(0, 16) : ""; }
    return S.pin ? String(S.pin.h).slice(0, 16) : "";
  }
  function bioRec(id) {
    var r = S.bio && S.bio[id || "_"];
    return r && r.tag && r.tag === bioTag(id) ? r : null;
  }
  function bioEnroll(id) {
    var tag = bioTag(id), p = id ? personOf(id) : null, nm = p ? p.n : (S.phone.name || "هذا الهاتف");
    var keep = function (rec) { S.bio = S.bio || {}; rec.tag = tag; S.bio[id || "_"] = rec; save(); return true; };
    if (window.AndroidApp) return androidBio("تفعيل الدخول بالبصمة — " + nm).then(function (ok) { return ok ? keep({ k: "a" }) : false; });
    try {
      return navigator.credentials.create({ publicKey: {
        challenge: rnd(32), rp: { name: shop().name },
        user: { id: rnd(16), name: (p && p.u) || nm, displayName: nm },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
        timeout: 60000, attestation: "none"
      } }).then(function (c) { return c ? keep({ k: "w", c: b64(c.rawId) }) : false; }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  function bioCheck(id) {
    var r = bioRec(id);
    if (!r) return Promise.resolve(false);
    var go = r.k === "a"
      ? (window.AndroidApp ? androidBio("الدخول — " + shop().name) : Promise.resolve(false))
      : navigator.credentials.get({ publicKey: {
          challenge: rnd(32), allowCredentials: [{ type: "public-key", id: unb64(r.c) }],
          userVerification: "required", timeout: 60000
        } }).then(function (a) { return !!a; }, function () { return false; });
    return go.then(function (ok) {
      if (!ok) return false;
      if (id) { me = personOf(id); S.last = id; save(); }
      unlocked = true;
      return true;
    });
  }
  function bioOff(id) { if (S.bio) { delete S.bio[id || "_"]; save(); } }

  /* ---------- البيع ---------- */
  function stamp(o) { if (me && staffInfo()) { o.by = me.id; o.byName = me.n; } return o; }
  function cartTotal() { return r3(S.cart.reduce(function (a, l) { return a + num(l.p) * num(l.q); }, 0)); }
  function discNow() { return canP("discount") ? Math.min(Math.max(num(S.sell.disc), 0), cartTotal()) : 0; }
  function addToCart(g, price) {
    var ex = S.cart.filter(function (l) { return l.key === g.key; })[0];
    if (ex) ex.q++;
    else S.cart.unshift({ key: g.key, b: g.b || "", k: g.code || "", n: g.n, p: price > 0 ? price : num(g.p), q: 1, zp: price > 0 ? 1 : undefined });
    save();
  }
  function checkout() {
    var m = mine();
    if (!S.cart.length) return { err: "السلة فارغة." };
    if (!m) return { err: "فرع هذا التطبيق لم يصل بعد من خادم الربط — لا يُرسل البيع." };
    var method = S.sell.method, cust = null;
    if (method === "credit") {
      cust = ((m && m.cust) || []).filter(function (c) { return c.id === S.sell.cust; })[0];
      if (!cust) return { err: "اختر الزبون للبيع الآجل." };
    }
    var tot = r3(cartTotal() - discNow());
    var o = stamp({
      id: "o" + Date.now().toString(36) + rand(4), date: localToday(), at: nowStamp(),
      items: S.cart.map(function (l) { return { b: l.b, k: l.k, n: l.n, q: num(l.q), p: num(l.p), zp: l.zp ? 1 : undefined }; }),
      disc: discNow(), method: method, cust: cust ? cust.id : "", custName: cust ? cust.n : "",
      paid: method === "credit" ? Math.min(Math.max(num(S.sell.paid), 0), tot) : tot,
      total: tot, status: "pending", to: m.branch ? m.branch.id : ""
    });
    S.orders.unshift(o);
    if (S.orders.length > 120) S.orders.length = 120;
    S.cart = [];
    S.sell = { disc: "", method: pref("payDef") === "card" ? "card" : "cash", cust: "", paid: "" };
    S.pushedEmpty = false;
    save();
    push();
    return { order: o };
  }

  /* ---------- التعديل، والصنف الجديد، وإضافة الكمية ----------
     كلها تُكتب في ملف هذا الهاتف على خادم الربط، والمنظومة تطبّقها وتعيد تأكيدها.
     الصنف يُعرَّف برمزه وبباركوده كما في المنظومة (ob)، لا بما عدّلناه هنا ولم يصلها بعد */
  function newEdit(o) {
    var m = mine();
    o.id = "e" + Date.now().toString(36) + rand(4);
    o.at = nowStamp(); o.status = "pending"; o.to = m && m.branch ? m.branch.id : "";
    S.edits.unshift(stamp(o));
    if (S.edits.length > 200) S.edits.length = 200;
    S.pushedEmpty = false;
    save();
    return o;
  }
  function refOf(g) { return { b: (g.ob !== undefined ? g.ob : g.b) || "", k: g.code || "" }; }
  function editItem(g, set) {
    var r = refOf(g);
    newEdit({ b: r.b, k: r.k, n: g.n, set: set });
    push();
  }
  /* صنف جديد: t = book أو stat، وset فيه كل حقوله (q الكمية، dst: shelf أو store) */
  function newItem(t, set) {
    var e = newEdit({ kind: "new", t: t === "stat" ? "stat" : "book", n: set.n, set: set });
    push();
    return e;
  }
  /* إضافة كمية: سطور {b, k, n, q}، والوجهة (shelf أو store)، والمورّد والملاحظة اختياريان */
  function receive(lines, opt) {
    opt = opt || {};
    var ls = lines.filter(function (l) { return num(l.q) > 0; }).map(function (l) { return { b: l.b || "", k: l.k || "", n: l.n || "", q: Math.floor(num(l.q)) }; });
    if (!ls.length) return null;
    var e = newEdit({ kind: "recv", n: ls.length === 1 ? ls[0].n : ls.length + " أصناف", lines: ls,
      dst: opt.dst === "store" ? "store" : "shelf", sp: opt.sp || "", nt: String(opt.nt || "").trim().slice(0, 200) });
    push();
    return e;
  }
  /* الجرد: تعديل الصنف نفسه يُدمج ما دام لم يُرسل */
  var locT = null;
  function queueLoc(g, set) {
    var r = refOf(g), e = S.edits.filter(function (x) {
      return x.status === "pending" && !x.sent && x.loc && !x.kind && ((x.b && x.b === r.b) || (!x.b && x.k === r.k));
    })[0];
    if (e) {
      Object.keys(set).forEach(function (k) { if (k === "qd") e.set.qd = num(e.set.qd) + num(set.qd); else e.set[k] = set[k]; });
      e.rev = (e.rev || 0) + 1;
      S.pushedEmpty = false;
      save();
    } else newEdit({ b: r.b, k: r.k, n: g.n, set: set, loc: 1 });
    clearTimeout(locT);
    locT = setTimeout(push, 1500);
  }
  /* ما لم تسجّله المنظومة يُعاد إرساله (زر «أعد الإرسال» في سجل الهاتف) */
  function resend() {
    S.orders.concat(S.edits).forEach(function (x) { if (x.status === "pending") x.sent = false; });
    S.pushedEmpty = false;
    save();
    push();
  }
  function dropEdit(id) {
    S.edits = S.edits.filter(function (e) { return !(e.id === id && e.status === "pending" && !e.sent); });
    S.pushedEmpty = false;
    save();
    push();
  }

  /* ---------- الإرسال والتأكيدات ---------- */
  function pending() { return S.orders.filter(function (o) { return o.status === "pending"; }).length + S.edits.filter(function (e) { return e.status === "pending"; }).length; }
  function push() {
    if (!configured()) return;
    if (pushing) { pushAgain = true; return; }
    var pend = S.orders.filter(function (o) { return o.status === "pending"; });
    var pendE = S.edits.filter(function (e) { return e.status === "pending"; });
    if (!pend.length && !pendE.length && S.pushedEmpty) return;
    pushing = true;
    var body = {
      kind: "phone", at: nowStamp(), branch: { id: S.phone.id, name: S.phone.name || "هاتف" }, items: [],
      /* الأقدم أولاً: المنظومة تطبّقها بترتيب حدوثها (تعديلان لحقل واحد: الأخير هو الباقي،
         وأرقام الفواتير بترتيب البيع) */
      orders: pend.slice().reverse().map(function (o) {
        return { id: o.id, date: o.date, at: o.at, items: o.items, disc: o.disc, method: o.method, cust: o.cust, paid: o.paid, to: o.to || "", by: o.by, byName: o.byName };
      }),
      edits: pendE.slice().reverse().map(function (e) {
        return { id: e.id, kind: e.kind, t: e.t, b: e.b, k: e.k, set: e.set, lines: e.lines, dst: e.dst, sp: e.sp || undefined, nt: e.nt || undefined, to: e.to || "", by: e.by };
      })
    };
    fetch(base() + "/put", {
      method: "POST", cache: "no-store", headers: hdr({ "Content-Type": "application/json" }), body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      pend.forEach(function (o) { o.sent = true; });
      pendE.forEach(function (e) { e.sent = true; });
      S.pushedEmpty = !pend.length && !pendE.length;
      save();
      emit("sent", pend.length + pendE.length);
    }).catch(function () { /* بلا إنترنت: تبقى وتُرسل لاحقاً */ emit("sendfail"); }).then(function () {
      pushing = false;
      if (pushAgain) { pushAgain = false; push(); }
    });
  }
  function takeAcks() {
    var acks = {}, changed = false, newly = [];
    ((data.snap && data.snap.branches) || []).forEach(function (b) {
      if (isPhone(b) || !b.acks) return;
      Object.keys(b.acks).forEach(function (k) { acks[k] = b.acks[k]; });
    });
    S.orders.forEach(function (o) {
      if (o.status !== "pending" || !(o.id in acks)) return;
      o.status = acks[o.id] ? "done" : "fail";
      o.inv = acks[o.id] || 0;
      changed = true;
      if (o.status === "done") newly.push(o);
    });
    var eds = [];
    S.edits.forEach(function (e) {
      if (e.status !== "pending" || !(e.id in acks)) return;
      /* 1 طُبّق · 2 طُبّق بعضه (باركود مستعمل، أو سطر غير موجود) · 0 لم يُطبَّق */
      e.status = num(acks[e.id]) === 2 ? "part" : acks[e.id] ? "done" : "fail";
      changed = true;
      eds.push(e);
    });
    if (changed) S.pushedEmpty = false;
    newly.eds = eds;
    return newly;
  }

  /* ---------- الإيصال ---------- */
  var METHOD = { cash: "نقداً", card: "بطاقة", credit: "آجل" };
  function receiptHtml(o) {
    var sh = shop(), c = esc(cur());
    var lines = o.items.map(function (l) {
      return "<tr><td>" + esc(l.n) + '</td><td class="n">' + l.q + '</td><td class="n">' + money(l.p * l.q) + "</td></tr>";
    }).join("");
    return '<div class="rc">' + (sh.logo ? '<img class="rc-logo" src="' + esc(sh.logo) + '" alt="">' : "") +
      '<div class="rc-shop">' + esc(sh.name) + "</div>" + (sh.city ? '<div class="rc-city">فرع ' + esc(sh.city) + "</div>" : "") +
      '<div class="rc-meta">' + esc(String(o.at).slice(0, 16)) + (o.byName ? " · " + esc(o.byName) : "") + "<br>" +
      (o.inv ? "فاتورة رقم " + o.inv : "بيع من الهاتف · " + esc(o.id.slice(-6).toUpperCase())) + "</div>" +
      "<table><thead><tr><th>الصنف</th><th>ك</th><th>المبلغ</th></tr></thead><tbody>" + lines + "</tbody></table>" +
      (o.disc ? '<div class="rc-row"><span>الخصم</span><b>' + money(o.disc) + "</b></div>" : "") +
      '<div class="rc-row big"><span>الصافي</span><b>' + money(o.total) + " " + c + "</b></div>" +
      '<div class="rc-row"><span>' + esc(METHOD[o.method] || "") + "</span>" + (o.custName ? "<b>" + esc(o.custName) + "</b>" : "") + "</div>" +
      '<div class="rc-foot">شكراً لزيارتكم</div></div>';
  }
  function printReceipt(o) {
    var html = receiptHtml(o);
    if (window.AndroidApp && window.AndroidApp.printHtml) {
      try {
        var css = (document.querySelector('link[rel="stylesheet"]') || {}).href || "";
        window.AndroidApp.printHtml('<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
          (css ? '<link rel="stylesheet" href="' + css + '">' : "") + '</head><body class="rc-print">' + html + "</body></html>", "إيصال " + o.id.slice(-6));
        return true;
      } catch (e) { }
    }
    var host = document.getElementById("printHost");
    host.innerHTML = html;
    document.body.classList.add("printing");
    setTimeout(function () {
      try { window.print(); } catch (e) { }
      setTimeout(function () { document.body.classList.remove("printing"); }, 800);
    }, 60);
    return true;
  }

  /* ---------- حالة التحديث (السطر أعلى كل شاشة) ---------- */
  function syncState() {
    var on = !(typeof navigator !== "undefined" && navigator.onLine === false);
    var mins = S.at ? Math.round((Date.now() - new Date(String(S.at).replace(" ", "T")).getTime()) / 60000) : -1;
    return { busy: busy, at: S.at || "", err: lastErr, online: on, pending: pending(), mins: mins,
      level: busy ? "busy" : (!on || lastErr) ? "bad" : (mins < 0 || mins > 30) ? "old" : "ok" };
  }
  /* تنزيل قائمة الكتب من جديد (الإعدادات): تُنسى نسختها فتُجلب كاملة في التحديث القادم */
  function resetCatalog() {
    S.catVer = ""; data.cat = null; ver++;
    drop("cat");
    save();
  }
  function clearPin() { S.pin = null; if (S.bio) delete S.bio._; save(); }
  function failed() {
    return S.orders.filter(function (o) { return o.status === "fail"; }).length + S.edits.filter(function (e) { return e.status === "fail"; }).length;
  }

  /* ---------- الأحداث للشاشات ---------- */
  function on(fn) { listeners.push(fn); }
  function emit(type, arg) { listeners.forEach(function (f) { try { f(type, arg); } catch (e) { } }); }

  /* ---------- البداية ---------- */
  function start() {
    S = load();
    if (location.hash && location.hash.indexOf("u=") >= 0) {
      var l = parseLink(location.hash);
      if (l) setLink(l);
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { }
    }
    save();
    return Promise.all([get("snap"), get("cat")]).then(function (r) {
      if (r[0] && configured()) data.snap = r[0];
      if (r[1] && configured()) { data.cat = r[1]; if (r[1].ver !== S.catVer) S.catVer = r[1].ver; }
      ver++;
      window.addEventListener("online", function () { push(); });
      return true;
    });
  }

  return {
    get S() { return S; }, CFG: CFG, IOS: IOS, METHOD: METHOD,
    start: start, save: save, on: on, emit: emit,
    esc: esc, num: num, r3: r3, money: money, norm: norm, digits: digits, ago: ago, fmtN: fmtN,
    localToday: localToday, nowStamp: nowStamp, rand: rand,
    configured: configured, parseLink: parseLink, setLink: setLink, unlink: unlink, refresh: refresh, isBusy: function () { return busy; }, lastError: function () { return lastErr; }, badKeyChars: badKeyChars,
    mine: mine, branches: branches, shop: shop, cur: cur, branchId: branchId,
    items: items, info: info, byKey: byKey, byCode: byCode, search: search, invalidate: invalidate,
    proto: proto, lists: lists, byType: byType, shelfMap: shelfMap, pref: pref, setPref: setPref, PREF0: PREF0,
    newItem: newItem, receive: receive, resend: resend, dropEdit: dropEdit, syncState: syncState, resetCatalog: resetCatalog,
    clearPin: clearPin, failed: failed, itemKey: itemKey,
    staffInfo: staffInfo, people: people, personOf: personOf, roleOf: roleOf, canP: canP, who: who,
    needsPin: needsPin, locked: locked, login: login, setPin: setPin, pinOk: pinOk, lock: lock,
    bioAvail: bioAvail, bioRec: bioRec, bioEnroll: bioEnroll, bioCheck: bioCheck, bioOff: bioOff, bioDone: bioDone, bioWord: bioWord,
    cartTotal: cartTotal, discNow: discNow, addToCart: addToCart, checkout: checkout,
    editItem: editItem, queueLoc: queueLoc, push: push, pending: pending,
    receiptHtml: receiptHtml, printReceipt: printReceipt
  };
})();
