/* ============================================================
   مولّد رموز التفعيل (قرار 0028)
   ------------------------------------------------------------
   يعمل على تلفون صاحب المنظومة وحده:
   - المفتاح الخاص (ECDSA P-256) يتولّد هنا ويُحفظ هنا مشفّراً بالرقم
     السري (PBKDF2 ثم AES-GCM)، ولا يخرج إلا في «النسخة الاحتياطية»
     المشفّرة نفسها.
   - الصفحة ممنوعة من الاتصال بأي خادم (connect-src 'none' في
     netlify.toml): لا شيء مما يُكتب هنا يغادر التلفون.
   - الرمز بنفس شكل src/Activation.cs: 70 بايتاً بـ 112 حرفاً.
   ============================================================ */
(function () {
  "use strict";

  var AB = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var EPOCH = Date.UTC(2020, 0, 1);
  var KEY_LS = "qact.key.v1", HIST_LS = "qact.hist.v1";
  var ITER = 600000;
  var IDLE_MS = 15 * 60 * 1000;
  var DUR = [
    { d: 1, l: "يوم" }, { d: 3, l: "3 أيام" }, { d: 7, l: "أسبوع" },
    { d: 30, l: "شهر" }, { d: 365, l: "سنة" }, { d: 0, l: "مدى الحياة" }
  ];

  var subtle = window.crypto && window.crypto.subtle;
  var $ = function (id) { return document.getElementById(id); };
  var rec = null;          // المفتاح المحفوظ (مشفّراً)
  var priv = null;         // المفتاح الخاص بعد فتحه بالرقم السري — في الذاكرة فقط
  var dur = 7;
  var idleT = 0, wrong = 0, waitUntil = 0;
  var last = null;         // آخر رمز معروض

  /* ---------- أدوات ---------- */

  function b64(u8) { var s = ""; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function rand(n) { var u = new Uint8Array(n); window.crypto.getRandomValues(u); return u; }
  function utf8(s) { return new TextEncoder().encode(s); }

  function b32(b) {
    var s = "", buf = 0, bits = 0;
    for (var i = 0; i < b.length; i++) {
      buf = (buf << 8) | b[i]; bits += 8;
      while (bits >= 5) { s += AB[(buf >> (bits - 5)) & 31]; bits -= 5; }
      buf &= (1 << bits) - 1;
    }
    if (bits > 0) s += AB[(buf << (5 - bits)) & 31];
    return s;
  }

  function crc16(b) {
    var c = 0xFFFF;
    for (var i = 0; i < b.length; i++) {
      c ^= b[i] << 8;
      for (var k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
    }
    return c;
  }

  function clean(s) {
    s = String(s || "").toUpperCase();
    var o = "";
    for (var i = 0; i < s.length; i++) if (AB.indexOf(s[i]) >= 0) o += s[i];
    return o;
  }

  /* رقم الجهاز من أي نص ملصوق (رسالة واتساب كاملة مثلاً) */
  function parseDevice(text) {
    var parts = String(text || "").toUpperCase().split(/[\s:«»()،,]+/);
    for (var i = 0; i < parts.length; i++) {
      var c = clean(parts[i]);
      if (c.length === 13 && (c[0] === "M" || c[0] === "T")) return { fp: c.slice(1), ed: c[0] };
      if (c.length === 12) return { fp: c, ed: "" };
    }
    return null;
  }

  function fmtFp(fp) { return fp.slice(0, 4) + "-" + fp.slice(4, 8) + "-" + fp.slice(8, 12); }
  function nowH() { return Math.floor((Date.now() - EPOCH) / 3600000); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmtH(h) {
    var d = new Date(EPOCH + h * 3600000);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " الساعة " + pad(d.getHours()) + ":00";
  }
  function fmtDay(t) {
    var d = new Date(t), n = new Date();
    if (d.toDateString() === n.toDateString()) return "اليوم";
    return pad(d.getDate()) + "-" + pad(d.getMonth() + 1) + (d.getFullYear() !== n.getFullYear() ? "-" + d.getFullYear() : "");
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function show(id) {
    ["needNew", "setup", "restore", "saved", "lock", "main"].forEach(function (x) { $(x).hidden = x !== id; });
    window.scrollTo(0, 0);
  }
  function msg(id, text, ok) { var e = $(id); e.textContent = text || ""; e.hidden = !text; e.className = "msg" + (ok ? " ok" : ""); }
  var toastT = 0;
  function toast(t) { var e = $("toast"); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { e.hidden = true; }, 2200); }

  function textOf(id) { var e = $(id); return e.value !== undefined && e.tagName !== "DIV" ? e.value : e.textContent; }
  function copy(text) {
    function fallback() {
      var t = document.createElement("textarea");
      t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); toast("تم النسخ"); } catch (e) { toast("ما قدرناش ننسخ — علّم النص وانسخه"); }
      document.body.removeChild(t);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast("تم النسخ"); }, fallback);
    else fallback();
  }
  function share(text, title) {
    if (navigator.share) navigator.share({ title: title || "", text: text }).catch(function () { });
    else copy(text);
  }
  function saveFile(name, text) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  /* ---------- التخزين: localStorage و IndexedDB معاً ---------- */

  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open("qact", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet(k) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var q = db.transaction("kv").objectStore("kv").get(k);
        q.onsuccess = function () { res(q.result || null); };
        q.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function idbPut(k, v) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var t = db.transaction("kv", "readwrite");
        if (v === null) t.objectStore("kv").delete(k); else t.objectStore("kv").put(v, k);
        t.oncomplete = function () { res(true); };
        t.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } }

  function loadRec() {
    var s = lsGet(KEY_LS);
    if (s) { try { return Promise.resolve(JSON.parse(s)); } catch (e) { } }
    return idbGet(KEY_LS).then(function (v) {
      if (v) { try { var r = JSON.parse(v); lsSet(KEY_LS, v); return r; } catch (e) { } }
      return null;
    });
  }
  function storeRec(r) {
    var s = r ? JSON.stringify(r) : null;
    lsSet(KEY_LS, s);
    return idbPut(KEY_LS, s);
  }

  function hist() { try { return JSON.parse(lsGet(HIST_LS) || "[]"); } catch (e) { return []; } }
  function addHist(h) {
    var l = hist(); l.unshift(h);
    if (l.length > 200) l.length = 200;
    lsSet(HIST_LS, JSON.stringify(l));
  }

  /* ---------- التشفير ---------- */

  function aesKey(pin, salt, iter) {
    return subtle.importKey("raw", utf8(pin), "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" }, base,
        { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }

  function keyFp(pubB64) {
    return subtle.digest("SHA-256", unb64(pubB64)).then(function (h) {
      var s = b32(new Uint8Array(h)).slice(0, 8);
      return s.slice(0, 4) + "-" + s.slice(4);
    });
  }

  /* يفتح المفتاح الخاص بالرقم السري، ويتأكد بتوقيع تجربة أنه يطابق المفتاح العام
     المحفوظ — فلا يطلّع رموزاً لا تقبلها المنظومة */
  var ALG = { name: "ECDSA", hash: "SHA-256" }, CURVE = { name: "ECDSA", namedCurve: "P-256" };
  function openKey(r, pin) {
    var key;
    return aesKey(pin, unb64(r.salt), r.it).then(function (k) {
      return subtle.decrypt({ name: "AES-GCM", iv: unb64(r.iv) }, k, unb64(r.ct));
    }).then(function (pkcs8) {
      return subtle.importKey("pkcs8", pkcs8, CURVE, false, ["sign"]);
    }).then(function (k) {
      key = k;
      return subtle.importKey("raw", unb64(r.pub), CURVE, false, ["verify"]);
    }).then(function (pub) {
      var m = utf8("check-" + Date.now());
      return subtle.sign(ALG, key, m).then(function (sig) { return subtle.verify(ALG, pub, sig, m); });
    }).then(function (ok) {
      if (!ok) throw new Error("mismatch");
      return key;
    });
  }

  function backupText(r) { return "QKEY1:" + b64(utf8(JSON.stringify(r))); }
  function parseBackup(t) {
    var s = String(t || "").replace(/\s+/g, "");
    var i = s.indexOf("QKEY1:");
    if (i < 0) return null;
    try {
      var j = JSON.parse(new TextDecoder().decode(unb64(s.slice(i + 6))));
      if (j && j.v === 1 && j.salt && j.iv && j.ct && j.pub && j.it) return j;
    } catch (e) { }
    return null;
  }

  /* ---------- الرمز ---------- */

  function makeCode(fp12, expH) {
    var m = utf8("QIRTASIYA-ACT-1|" + fp12 + "|" + expH);
    return subtle.sign(ALG, priv, m).then(function (sig) {
      sig = new Uint8Array(sig);
      if (sig.length !== 64) throw new Error("sig");
      var b = new Uint8Array(70);
      b[0] = 1; b[1] = (expH >> 16) & 255; b[2] = (expH >> 8) & 255; b[3] = expH & 255;
      b.set(sig, 4);
      var c = crc16(b.subarray(0, 68));
      b[68] = c >> 8; b[69] = c & 255;
      return b32(b).match(/.{4}/g).join("-");
    });
  }

  /* ---------- الشاشات ---------- */

  function pinOk(p) { return /^\d{6,}$/.test(p); }

  function startSetup() {
    $("pin1").value = ""; $("pin2").value = ""; msg("setupMsg", "");
    show("setup");
  }

  function makeKey() {
    var p1 = $("pin1").value.trim(), p2 = $("pin2").value.trim();
    if (!pinOk(p1)) return msg("setupMsg", "الرقم السري لازم يكون 6 أرقام أو أكثر.");
    if (p1 !== p2) return msg("setupMsg", "الرقمين مش زي بعض — عيد كتابتهم.");
    msg("setupMsg", "لحظة، نعملو في المفتاح…", true);
    $("makeKey").disabled = true;
    var kp, r;
    subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]).then(function (k) {
      kp = k;
      return Promise.all([subtle.exportKey("pkcs8", k.privateKey), subtle.exportKey("raw", k.publicKey)]);
    }).then(function (x) {
      var salt = rand(16), iv = rand(12);
      r = { v: 1, it: ITER, salt: b64(salt), iv: b64(iv), pub: b64(new Uint8Array(x[1])), made: Date.now() };
      return aesKey(p1, salt, ITER).then(function (k) { return subtle.encrypt({ name: "AES-GCM", iv: iv }, k, x[0]); });
    }).then(function (ct) {
      r.ct = b64(new Uint8Array(ct));
      return openKey(r, p1);                       // تأكيد: نفتحه كما سيُفتح لاحقاً
    }).then(function (k) {
      rec = r; priv = k;
      return storeRec(r);
    }).then(function () {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { });
      kp = null;
      showSaved();
    }).catch(function (e) {
      msg("setupMsg", "ما قدرناش نعملو المفتاح على هذا المتصفح: " + (e && e.message ? e.message : e));
    }).then(function () { $("makeKey").disabled = false; });
  }

  function showSaved() {
    $("bkOut").value = backupText(rec);
    $("pubOut").textContent = rec.pub;
    $("savedOk").checked = false; $("savedGo").disabled = true;
    keyFp(rec.pub).then(function (f) { $("kfpOut").textContent = f; });
    show("saved");
  }

  function doRestore() {
    var r = parseBackup($("bkIn").value), pin = $("pinR").value.trim();
    if (!r) return msg("restoreMsg", "النسخة الاحتياطية ناقصة أو مش صحيحة — الصقها كاملة (تبدأ بـ QKEY1).");
    if (!pin) return msg("restoreMsg", "اكتب الرقم السري.");
    msg("restoreMsg", "لحظة…", true);
    openKey(r, pin).then(function (k) {
      rec = r; priv = k;
      return storeRec(r);
    }).then(function () {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { });
      toast("رجع المفتاح");
      enterMain();
    }).catch(function () {
      msg("restoreMsg", "الرقم السري غلط، أو النسخة مش كاملة.");
    });
  }

  function doUnlock() {
    if (Date.now() < waitUntil) return msg("lockMsg", "استنى شوية وجرّب مرة تانية.");
    var pin = $("pinU").value.trim();
    if (!pin) return;
    msg("lockMsg", "لحظة…", true);
    $("unlock").disabled = true;
    openKey(rec, pin).then(function (k) {
      priv = k; wrong = 0; $("pinU").value = "";
      enterMain();
    }).catch(function () {
      wrong++;
      if (wrong >= 5) { waitUntil = Date.now() + 30000; wrong = 0; }
      msg("lockMsg", "الرقم السري غلط.");
    }).then(function () { $("unlock").disabled = false; });
  }

  function lockNow() {
    priv = null; last = null;
    $("result").hidden = true;
    $("pinU").value = ""; msg("lockMsg", "");
    show("lock");
    setTimeout(function () { $("pinU").focus(); }, 50);
  }

  function touch() {
    clearTimeout(idleT);
    if (priv) idleT = setTimeout(lockNow, IDLE_MS);
  }

  function enterMain() {
    $("pubOut2").textContent = rec.pub;
    keyFp(rec.pub).then(function (f) { $("kfpOut2").textContent = f; });
    $("bkBox").hidden = true;
    paintDurs(); paintHist(); devInfo();
    show("main");
    touch();
  }

  function paintDurs() {
    $("durs").innerHTML = DUR.map(function (x) {
      return '<button type="button" class="chip' + (x.d === dur ? " on" : "") + '" data-d="' + x.d + '">' + x.l + "</button>";
    }).join("");
  }

  function durLabel(d) { for (var i = 0; i < DUR.length; i++) if (DUR[i].d === d) return DUR[i].l; return d + " يوم"; }

  function devInfo() {
    var v = $("dev").value, e = $("devInfo");
    if (!v.trim()) { e.textContent = ""; e.className = "hint"; return null; }
    var p = parseDevice(v);
    if (!p) { e.textContent = "رقم الجهاز لازم يكون 12 حرف، زي M-7K3F-9QX2-MD84"; e.className = "hint bad"; return null; }
    e.textContent = (p.ed === "T" ? "منظومة طرابلس — " : p.ed === "M" ? "منظومة مصراتة — " : "") + fmtFp(p.fp);
    e.className = "hint";
    return p;
  }

  function gen() {
    touch();
    if (!priv) return lockNow();
    var p = devInfo();
    if (!p) return msg("genMsg", "اكتب رقم الجهاز من شاشة التفعيل (أو الصق رسالة الواتساب كاملة).");
    msg("genMsg", "");
    var expH = dur === 0 ? 0 : nowH() + dur * 24 + 1;   // ساعة زيادة: المدة لا تنقص عن المكتوب
    var who = $("who").value.trim();
    makeCode(p.fp, expH).then(function (code) {
      last = { t: Date.now(), dev: (p.ed ? p.ed + "-" : "") + fmtFp(p.fp), who: who, d: dur, exp: expH, code: code };
      addHist(last);
      paintResult(last);
      paintHist();
    }).catch(function (e) {
      msg("genMsg", "ما طلعش الرمز: " + (e && e.message ? e.message : e));
    });
  }

  function paintResult(h) {
    last = h;
    $("resTitle").textContent = "رمز التفعيل — " + durLabel(h.d) + (h.exp ? " (حتى " + fmtH(h.exp) + ")" : "") +
      (h.who ? " — " + h.who : "") + " — جهاز " + h.dev;
    $("resCode").textContent = h.code;
    $("shareRes").hidden = !navigator.share;
    $("result").hidden = false;
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* رسالة الواتساب: بلا تاريخ ولا أرقام خارج الرمز — البرنامج يلتقط الرمز من الرسالة كاملة */
  function waText(h) {
    return "كود تفعيل المنظومة — " + durLabel(h.d) + ":\n\n" + h.code + "\n\nانسخه والصقه في شاشة التفعيل واضغط «تفعيل».";
  }

  function paintHist() {
    var l = hist();
    if (!l.length) { $("hist").innerHTML = '<p class="muted">ما طلّعتش رموز لحد الآن.</p>'; return; }
    $("hist").innerHTML = l.slice(0, 30).map(function (h, i) {
      return '<div class="h"><button type="button" data-h="' + i + '">' + esc(h.who || "بدون اسم") + " — " + esc(durLabel(h.d)) +
        "<small dir=\"ltr\">" + esc(h.dev) + "</small></button><span class=\"d\">" + esc(fmtDay(h.t)) + "</span></div>";
    }).join("");
  }

  function wipe() {
    if (!confirm("متأكد؟ لو ما عندكش النسخة الاحتياطية، ما تقدرش تطلّع رموز للمنظومة أبداً.")) return;
    if (!confirm("آخر تأكيد: نمسحو المفتاح من هذا التلفون؟")) return;
    storeRec(null).then(function () { rec = null; priv = null; startSetup(); });
  }

  /* ---------- الربط ---------- */

  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("button") : null;
    if (!t) return;
    touch();
    if (t.dataset.copy) copy(textOf(t.dataset.copy));
    else if (t.dataset.share) share(textOf(t.dataset.share));
    else if (t.dataset.d !== undefined) { dur = +t.dataset.d; paintDurs(); }
    else if (t.dataset.h !== undefined) { var h = hist()[+t.dataset.h]; if (h) paintResult(h); }
  });
  $("makeKey").onclick = makeKey;
  $("toRestore").onclick = function () { $("bkIn").value = ""; $("pinR").value = ""; msg("restoreMsg", ""); show("restore"); };
  $("restoreBack").onclick = function () { rec ? lockNow() : startSetup(); };
  $("doRestore").onclick = doRestore;
  $("savedOk").onchange = function () { $("savedGo").disabled = !this.checked; };
  $("savedGo").onclick = enterMain;
  $("bkFile").onclick = function () { saveFile("مفتاح-التفعيل-نسخة-احتياطية.txt", backupText(rec)); };
  $("bkFile2").onclick = function () { saveFile("مفتاح-التفعيل-نسخة-احتياطية.txt", backupText(rec)); };
  $("unlock").onclick = doUnlock;
  $("pinU").onkeydown = function (e) { if (e.key === "Enter") doUnlock(); };
  $("lockNow").onclick = lockNow;
  $("showBk").onclick = function () { $("bkOut2").value = backupText(rec); $("bkBox").hidden = !$("bkBox").hidden; };
  $("wipe").onclick = wipe;
  $("dev").oninput = function () { devInfo(); msg("genMsg", ""); };
  /* بعد اللصق: الخانة تبقى برقم الجهاز وحده لا برسالة الواتساب كاملة */
  $("dev").onchange = function () { var p = parseDevice(this.value); if (p) this.value = (p.ed ? p.ed + "-" : "") + fmtFp(p.fp); };
  $("gen").onclick = gen;
  $("wa").onclick = function () { if (last) window.open("https://wa.me/?text=" + encodeURIComponent(waText(last)), "_blank", "noopener"); };
  $("shareRes").onclick = function () { if (last) share(waText(last), "كود التفعيل"); };
  ["input", "keydown", "touchstart"].forEach(function (ev) { document.addEventListener(ev, touch, { passive: true }); });

  /* ---------- البداية ---------- */

  if (!subtle || !window.isSecureContext || !window.indexedDB || !window.TextEncoder) { show("needNew"); return; }
  loadRec().then(function (r) {
    rec = r;
    if (rec) lockNow(); else startSetup();
  });
})();
