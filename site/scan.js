/* ============================================================
   scan.js — مسح الباركود بالكاميرا داخل المتصفح نفسه
   ------------------------------------------------------------
   تطبيق أندرويد يمسح بكاميرته (window.AndroidApp.scan). الآيفون
   لا تطبيق له: الموقع نفسه يُضاف للشاشة الرئيسية، فيمسح هنا:
     • كاميرا حيّة: يقرأ ما داخل الإطار عدة مرات في الثانية، وأول
       رمز صحيح (رقم الفحص سليم) يُغلقها ويسلّم الرمز.
     • صورة: إن مُنعت الكاميرا أو تعذّرت، تصوّر الباركود بكاميرا
       الآيفون نفسها (تركيزها من قريب أفضل) وتُقرأ الصورة.
   القارئ zxing-cpp مبنيّ WebAssembly، محفوظ داخل الموقع (vendor/)
   فيعمل بلا إنترنت ولا يُجلب من أي جهة أخرى، ولا يُحمَّل إلا عند
   أول مسح.
   ============================================================ */
window.WebScan = (function () {
  var LIB = "vendor/zxing-reader-3.1.4.js";
  var WASM = "vendor/zxing_reader-3.1.4.wasm";
  /* ما يُطبع على الكتب والقرطاسية: ISBN وEAN وUPC، ولاصقات المنظومة CODE128 */
  var OPTS = { formats: ["EAN13", "EAN8", "UPCA", "UPCE", "Code128", "Code39"], tryHarder: true, maxNumberOfSymbols: 1 };
  var ready = null;      // وعد القارئ بعد تحميله
  var cur = null;        // جلسة المسح المفتوحة الآن

  var IC = {
    x: "M6 6l12 12M18 6L6 18",
    bolt: "M13 2L4 14h7l-1 8 9-12h-7l1-8z",
    photo: "M4 8h3l2-3h6l2 3h3v11H4V8zm8 9a4 4 0 100-8 4 4 0 000 8z"
  };
  function svg(d, z) {
    return '<svg width="' + z + '" height="' + z + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  /* الكاميرا الحيّة تحتاج https (أو الجهاز نفسه) */
  function live() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;
  }

  function lib() {
    if (ready) return ready;
    ready = new Promise(function (ok, bad) {
      if (window.ZXingWASM) { ok(window.ZXingWASM); return; }
      var s = document.createElement("script");
      s.src = LIB;
      s.onload = function () { if (window.ZXingWASM) ok(window.ZXingWASM); else bad(new Error("lib")); };
      s.onerror = function () { bad(new Error("lib")); };
      document.head.appendChild(s);
    }).then(function (Z) {
      var wasm = new URL(WASM, document.baseURI).href;
      return Promise.resolve(Z.prepareZXingModule({
        overrides: { locateFile: function (p, prefix) { return /\.wasm$/.test(p) ? wasm : prefix + p; } },
        fireImmediately: true
      })).then(function () { return Z; });
    });
    // تعذّر أول مرة (بلا إنترنت مثلاً): يُعاد التحميل في المحاولة القادمة
    ready.catch(function () { ready = null; });
    return ready;
  }

  /* يقرأ صورة (ImageData أو ملف) ويرجع الرمز، أو "" إن لم يجد */
  function read(input) {
    return lib().then(function (Z) { return Z.readBarcodes(input, OPTS); }).then(function (res) {
      for (var i = 0; i < res.length; i++) {
        if (res[i].isValid !== false && res[i].text) return String(res[i].text).trim();
      }
      return "";
    });
  }

  function beep(ac) {
    if (!ac) return;
    try {
      var o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.type = "sine"; o.frequency.value = 1500;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + 0.13);
    } catch (e) { }
  }

  function stopStream(st) {
    if (!st) return;
    try { st.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
  }

  function open(cb) {
    if (cur) return;
    var ov = document.createElement("div");
    ov.className = "scanner";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "مسح الباركود");
    ov.innerHTML =
      '<video class="sc-video" playsinline muted autoplay></video>' +
      '<div class="sc-top">' +
        '<button class="sc-btn" type="button" data-sc="close" aria-label="إغلاق">' + svg(IC.x, 22) + "</button>" +
        '<b class="sc-title">امسح الباركود</b>' +
        '<button class="sc-btn" type="button" data-sc="torch" aria-label="الفلاش" hidden>' + svg(IC.bolt, 20) + "</button>" +
      "</div>" +
      '<div class="sc-frame"><i></i><i></i><i></i><i></i><span class="sc-line"></span></div>' +
      '<p class="sc-msg" aria-live="polite">جارٍ تشغيل الكاميرا…</p>' +
      '<div class="sc-bottom"><label class="sc-photo">' + svg(IC.photo, 18) + "<span>صوّر الباركود بدل ذلك</span>" +
        '<input class="sc-file" type="file" accept="image/*" capture="environment" aria-label="صوّر الباركود"></label></div>';
    document.body.appendChild(ov);
    document.body.classList.add("scanning");

    var video = ov.querySelector(".sc-video"), msg = ov.querySelector(".sc-msg"),
        frame = ov.querySelector(".sc-frame"), torchBtn = ov.querySelector('[data-sc="torch"]'),
        file = ov.querySelector(".sc-file");
    var s = cur = { cb: cb, stream: null, timer: 0, busy: false, n: 0, done: false, ac: null, torch: false,
      cv: null, g: null, picking: false, starting: false };

    /* الصوت يحتاج لمسة من صاحب الجهاز — وهذه اللمسة هي فتح الكاميرا */
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { s.ac = new AC(); if (s.ac.resume) s.ac.resume(); }
    } catch (e) { s.ac = null; }

    function say(t, bad) {
      msg.textContent = t;
      ov.classList.toggle("sc-bad", !!bad);
    }

    function start() {
      if (cur !== s || s.starting) return;
      lib();                                   // القارئ يتحمّل مع تشغيل الكاميرا معاً
      if (!live()) { noCam("الكاميرا المباشرة غير متاحة هنا — صوّر الباركود بالزر تحت."); return; }
      s.starting = true;
      var md = navigator.mediaDevices;
      md.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
        .catch(function (e) {
          var n = e && e.name;
          if (n === "OverconstrainedError" || n === "NotReadableError" || n === "AbortError") {
            return md.getUserMedia({ audio: false, video: { facingMode: "environment" } });
          }
          throw e;
        })
        .then(function (stream) {
          s.starting = false;
          if (cur !== s) { stopStream(stream); return; }      // أُغلقت قبل أن تعمل الكاميرا
          stopStream(s.stream);
          s.stream = stream;
          ov.classList.remove("sc-nocam");
          video.srcObject = stream;
          var p = video.play();
          if (p && p.catch) p.catch(function () { });
          var tr = stream.getVideoTracks()[0], caps = {};
          try { caps = (tr && tr.getCapabilities) ? tr.getCapabilities() : {}; } catch (e) { caps = {}; }
          if (caps && caps.torch) torchBtn.hidden = false;
          try {
            if (caps && caps.focusMode && caps.focusMode.indexOf("continuous") >= 0) {
              tr.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(function () { });
            }
          } catch (e) { }
          say("وجّه الكاميرا على الباركود داخل الإطار");
          clearTimeout(s.timer);
          tick();
        })
        .catch(function (e) {
          s.starting = false;
          if (cur !== s) return;
          var n = e && e.name;
          noCam(n === "NotAllowedError" || n === "SecurityError"
            ? "الكاميرا ممنوعة على هذا التطبيق. اسمح بها من إعدادات الآيفون: Safari ← الكاميرا، أو صوّر الباركود بالزر تحت."
            : n === "NotFoundError" || n === "OverconstrainedError"
              ? "ما لقيناش كاميرا في هذا الجهاز — صوّر الباركود بالزر تحت."
              : "تعذّر تشغيل الكاميرا — صوّر الباركود بالزر تحت.");
        });
    }

    /* بلا كاميرا حيّة: يبقى الإطار، ويتوقف خط المسح، والتصوير بالزر */
    function noCam(t) {
      ov.classList.add("sc-nocam");
      say(t, true);
    }

    /* الجزء الذي يقابل الإطار في صورة الكاميرا (الفيديو مقصوص ليملأ
       الشاشة)، مع هامش. وكل رابع محاولة: الصورة كاملة، لمن لم يضع
       الباركود داخل الإطار تماماً. */
    function grab(whole) {
      var vw = video.videoWidth, vh = video.videoHeight;
      var sx = 0, sy = 0, sw = vw, sh = vh;
      if (!whole) {
        var r = video.getBoundingClientRect(), f = frame.getBoundingClientRect();
        var k = Math.max(r.width / vw, r.height / vh);
        var ox = (vw * k - r.width) / 2, oy = (vh * k - r.height) / 2;
        var padX = f.width * 0.12, padY = f.height * 0.4;
        sx = Math.max(0, (f.left - r.left - padX + ox) / k);
        sy = Math.max(0, (f.top - r.top - padY + oy) / k);
        sw = Math.min(vw - sx, (f.width + 2 * padX) / k);
        sh = Math.min(vh - sy, (f.height + 2 * padY) / k);
      }
      var z = Math.min(1, 1280 / Math.max(sw, sh));
      var w = Math.max(1, Math.round(sw * z)), h = Math.max(1, Math.round(sh * z));
      var c = s.cv || (s.cv = document.createElement("canvas"));
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      var g = s.g || (s.g = c.getContext("2d", { willReadFrequently: true }));
      g.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
      return g.getImageData(0, 0, w, h);
    }

    function tick() {
      if (cur !== s || s.done) return;
      s.timer = setTimeout(tick, 120);
      if (s.busy || s.picking || video.readyState < 2 || !video.videoWidth) return;
      s.busy = true;
      var img;
      try { img = grab(++s.n % 4 === 0); } catch (e) { s.busy = false; return; }
      read(img).then(function (code) {
        s.busy = false;
        if (code && cur === s && !s.done) hit(code);
      }, function () {
        s.busy = false;
        if (cur !== s) return;
        say("تعذّر تجهيز قارئ الباركود. أول مرة يحتاج إنترنت — تأكد منه.", true);
        clearTimeout(s.timer);
        s.timer = setTimeout(tick, 3000);
      });
    }

    function hit(code) {
      s.done = true;
      beep(s.ac);
      try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { }
      ov.classList.add("sc-ok");
      say(code);
      setTimeout(function () {
        if (cur === s) close();
        try { if (s.cb) s.cb(code); } catch (e) { }
      }, 260);
    }

    function fromPhoto(f) {
      s.picking = false;
      say("يقرأ الصورة…");
      toImageData(f).then(read, function () { return read(f); }).then(function (code) {
        if (cur !== s) return;
        if (code) hit(code);
        else say("ما قريناش باركود في الصورة. صوّره من قريب وبإضاءة جيدة، والباركود بالعرض.", true);
      }, function () {
        if (cur === s) say("تعذّر قراءة الصورة.", true);
      });
    }

    function torch() {
      var tr = s.stream && s.stream.getVideoTracks()[0];
      if (!tr) return;
      var want = !s.torch;
      tr.applyConstraints({ advanced: [{ torch: want }] }).then(function () {
        s.torch = want;
        torchBtn.classList.toggle("on", want);
      }, function () { torchBtn.hidden = true; });
    }

    /* العودة من كاميرا الصور بلا صورة: تعود الكاميرا الحيّة */
    function back() {
      if (cur !== s || !s.picking) return;
      setTimeout(function () {
        if (cur !== s || !s.picking) return;
        s.picking = false;
        var tr = s.stream && s.stream.getVideoTracks()[0];
        if (!tr || tr.readyState === "ended") start();
        else if (video.paused) { var p = video.play(); if (p && p.catch) p.catch(function () { }); }
      }, 700);
    }

    function onVis() {
      if (!document.hidden) { back(); return; }
      if (!s.picking) close();                 // خرجت من التطبيق: تُطفأ الكاميرا
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    ov.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-sc]") : null;
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      var a = b.getAttribute("data-sc");
      if (a === "close") close();
      else if (a === "torch") torch();
    });
    file.addEventListener("click", function () { s.picking = true; });
    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      file.value = "";
      if (f) fromPhoto(f); else back();
    });
    file.addEventListener("cancel", back);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("keydown", onKey);

    s.cleanup = function () {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("keydown", onKey);
    };
    s.ov = ov;
    start();
  }

  /* صورة الكاميرا (حتى 12 ميغابكسل) تُصغّر قبل القراءة: أسرع بكثير */
  function toImageData(f) {
    if (!window.createImageBitmap) return Promise.reject(new Error("bitmap"));
    return createImageBitmap(f).then(function (bm) {
      var k = Math.min(1, 2200 / Math.max(bm.width, bm.height));
      var w = Math.max(1, Math.round(bm.width * k)), h = Math.max(1, Math.round(bm.height * k));
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var g = c.getContext("2d");
      g.drawImage(bm, 0, 0, w, h);
      if (bm.close) bm.close();
      return g.getImageData(0, 0, w, h);
    });
  }

  function close() {
    var s = cur;
    if (!s) return;
    cur = null;
    s.done = true;
    clearTimeout(s.timer);
    stopStream(s.stream);
    if (s.cleanup) s.cleanup();
    if (s.ov && s.ov.parentNode) s.ov.parentNode.removeChild(s.ov);
    document.body.classList.remove("scanning");
    var ac = s.ac;
    if (ac && ac.close) setTimeout(function () { try { ac.close(); } catch (e) { } }, 400);
  }

  return {
    open: open, close: close, live: live, read: read,
    isOpen: function () { return !!cur; },
    preload: function () { return lib(); }
  };
})();
