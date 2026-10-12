// الصفوة - مساعد حجز CBL
// بعد الدخول بحساب العميل: يفتح حساب مصرف الأمان، يضغط "إضافة طلب جديد"،
// ويعبّي تفاصيل الحجز (نوع الطلب، نوع الإيداع، المدينة، القيمة) ثم يتوقف.
// قسم "معلومات أخرى" (إقرارات العميل)، مصدر الأموال، الموافقات، فحص Cloudflare
// وزر الإرسال تبقى للموظف.
(() => {
  'use strict';

  const DEFAULTS = {
    abEnabled: true,
    abBank: 'مصرف الأمان',
    abRequestType: 'بطاقة',
    abDepositType: 'تحويل بنكي',
    abCity: 'مصراتة',
    abAmount: '2000',
  };
  const STATE_KEY = 'safwa_autobook_state';
  const STATE_TTL_MS = 30 * 60 * 1000;

  // ---------- أدوات عامة ----------
  const norm = (s) =>
    (s || '')
      .replace(/[ً-ْـ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeout = 15000, step = 250) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (stopRequested()) return null;
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  const getCfg = () => new Promise((res) => chrome.storage.local.get(DEFAULTS, res));
  const bodyText = () => norm(document.body ? document.body.innerText : '');

  function loadState() {
    try {
      const s = JSON.parse(sessionStorage.getItem(STATE_KEY));
      if (s && Date.now() - s.t > STATE_TTL_MS) return null;
      return s;
    } catch { return null; }
  }
  function saveState(s) {
    s.t = Date.now();
    try { sessionStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {}
  }
  function clearState() {
    try { sessionStorage.removeItem(STATE_KEY); } catch {}
  }
  function stopRequested() {
    const s = loadState();
    return !!(s && s.phase === 'stopped');
  }

  // ---------- شريط الحالة ----------
  let bannerEl = null;
  const COLORS = { info: '#1d4ed8', ok: '#15803d', warn: '#b45309', err: '#b91c1c' };

  function banner(msg, kind = 'info', actions = []) {
    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'safwa-ab-banner';
      bannerEl.setAttribute('dir', 'rtl');
      Object.assign(bannerEl.style, {
        position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '2147483647', color: '#fff', padding: '10px 16px', borderRadius: '10px',
        font: '600 15px Tahoma, Arial, sans-serif', boxShadow: '0 6px 20px rgba(0,0,0,.25)',
        display: 'flex', gap: '10px', alignItems: 'center', maxWidth: '92vw',
      });
      document.documentElement.appendChild(bannerEl);
    }
    bannerEl.style.background = COLORS[kind] || COLORS.info;
    bannerEl.textContent = '';
    const span = document.createElement('span');
    span.textContent = '📡 ' + msg;
    bannerEl.appendChild(span);
    const mkBtn = (label, onClick) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        background: 'rgba(255,255,255,.2)', color: '#fff', border: '1px solid rgba(255,255,255,.5)',
        borderRadius: '6px', padding: '3px 10px', cursor: 'pointer', font: 'inherit', fontSize: '13px',
      });
      b.addEventListener('click', onClick);
      bannerEl.appendChild(b);
    };
    actions.forEach((a) => mkBtn(a.label, a.onClick));
    if (kind === 'info') {
      mkBtn('إيقاف', () => {
        const s = loadState() || {};
        s.phase = 'stopped';
        saveState(s);
        banner('تم الإيقاف لهذا العميل', 'warn');
      });
    } else {
      mkBtn('✕', hideBanner);
    }
  }
  function hideBanner() {
    if (bannerEl) { bannerEl.remove(); bannerEl = null; }
  }

  // ---------- البحث عن العناصر ----------
  // مطابقة تامة بعد حذف الرموز والأسهم، حتى لا يطابق "عرض الحساب"
  // رابطَ "عرض الحسابات المصرفية الشخصية"
  const letters = (s) => norm(s).replace(/[^\u0621-\u064A ]/g, '').replace(/\s+/g, ' ').trim();
  function clickablesWithText(text) {
    const t = letters(text);
    return [...document.querySelectorAll('a, button, [role="button"]')].filter(
      (el) => letters(el.textContent) === t && el.offsetParent !== null
    );
  }

  // العنصر الذي نصّه يبدأ بعنوان الحقل، ثم أقرب select/input بعده.
  function controlByLabel(labelText) {
    const t = norm(labelText);
    const labels = [...document.querySelectorAll('label, span, div, p, h1, h2, h3, h4, h5, h6, strong, legend')]
      .filter((el) => {
        const own = norm(el.textContent);
        if (!own.startsWith(t) || own.length > t.length + 30) return false;
        // نتجاهل الحاويات التي تحتوي على عنصر أصغر بنفس النص
        return ![...el.children].some((c) => norm(c.textContent).startsWith(t));
      })
      .sort((a, b) => (a.tagName === 'LABEL' ? -1 : 0) - (b.tagName === 'LABEL' ? -1 : 0));

    for (const lbl of labels) {
      if (lbl.htmlFor) {
        const c = document.getElementById(lbl.htmlFor);
        if (c) return c;
      }
      const inner = lbl.querySelector('select, input, textarea');
      if (inner) return inner;
      let p = lbl.parentElement;
      for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
        const cs = [...p.querySelectorAll(
          'select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea'
        )];
        const after = cs.find((c) => lbl.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (after) return after;
      }
    }
    return null;
  }

  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function findOption(sel, wanted) {
    const w = norm(wanted);
    const opts = [...sel.options].filter((o) => o.value !== '' && !o.disabled);
    return opts.find((o) => norm(o.textContent) === w) || opts.find((o) => norm(o.textContent).includes(w)) || null;
  }

  function currentMatches(labelText, wanted) {
    const el = controlByLabel(labelText);
    if (!el) return false;
    if (el.tagName === 'SELECT') {
      const o = el.options[el.selectedIndex];
      return !!o && o.value !== '' && norm(o.textContent).includes(norm(wanted));
    }
    return String(el.value).replace(/[,\s]/g, '') === String(wanted).replace(/[,\s]/g, '');
  }

  async function fillField(labelText, wanted) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (stopRequested()) return false;
      const ready = await waitFor(() => {
        const el = controlByLabel(labelText);
        if (!el) return null;
        if (el.tagName === 'SELECT') return findOption(el, wanted) ? el : null;
        return el;
      }, 8000);
      if (!ready) return false;

      const el = controlByLabel(labelText);
      el.focus();
      if (el.tagName === 'SELECT') {
        const opt = findOption(el, wanted);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, opt.value);
        opt.selected = true;
      } else {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(wanted));
      }
      fire(el);
      el.blur();

      // نعطي الصفحة وقت تعيد الرسم (Livewire/Vue) ثم نتأكد أن القيمة ثبتت
      await sleep(700);
      if (currentMatches(labelText, wanted)) return true;
    }
    return false;
  }

  function clientKey() {
    const txt = document.body ? document.body.innerText : '';
    const phone = txt.match(/\b09\d{8}\b/);
    if (phone) return phone[0];
    const nid = txt.match(/\b\d{3,4}\*+\d{3}\b/);
    return nid ? nid[0] : null;
  }

  // ---------- الخطوات ----------
  async function stepAccountList(cfg) {
    const links = await waitFor(() => {
      const l = clickablesWithText('عرض الحساب');
      return l.length ? l : null;
    }, 15000);
    if (!links) return;

    const key = clientKey();
    let st = loadState();
    if (st && key && st.client && st.client !== key) st = null; // عميل جديد
    if (!st) {
      if (!cfg.abEnabled) return;
      st = { client: key, phase: 'finding', idx: 0 };
    }
    if (st.phase !== 'finding') return;

    if (st.listPath && st.listPath !== location.pathname) {
      // نرجع لنفس الصفحة التي بدأنا منها حتى يبقى ترتيب الحسابات ثابتًا
      location.assign(st.listPath);
      return;
    }
    st.listPath = location.pathname;

    if (st.idx >= links.length) {
      st.phase = 'done';
      saveState(st);
      banner(`لا يوجد حساب في ${cfg.abBank} لهذا العميل`, 'err');
      return;
    }

    const target = links[st.idx];
    st.idx += 1;
    saveState(st);
    banner(`فتح الحساب ${st.idx} من ${links.length} للبحث عن ${cfg.abBank}…`);
    await sleep(400);
    target.click();
  }

  async function stepAccountPage(cfg) {
    const st = loadState();
    if (!st || st.phase !== 'finding') return;

    banner('التحقق من المصرف…');
    const loaded = await waitFor(() => /رقم الحساب|IBAN|طلب جديد/.test(bodyText()), 15000);
    if (!loaded) {
      banner('الصفحة لم تكتمل. حدّث الصفحة أو اضغط "إعادة التشغيل" من الإضافة', 'err');
      return;
    }

    if (!bodyText().includes(norm(cfg.abBank))) {
      saveState(st);
      banner(`ليس حساب ${cfg.abBank}، الرجوع للحساب التالي…`);
      await sleep(400);
      location.assign(st.listPath || '/dashboard');
      return;
    }

    if (!st.forceCount) {
      const raw = norm(document.body.innerText);
      const m = raw.match(/(\d+)\s*\(\s*عرض\s*\)/) || raw.match(/عدد الطلبات[^\d]{0,30}(\d+)/);
      const count = m ? parseInt(m[1], 10) : 0;
      if (count > 0) {
        st.phase = 'paused';
        saveState(st);
        banner(`هذا الحساب عليه ${count} طلب سابق. ما تم فتح طلب جديد.`, 'warn', [{
          label: 'متابعة على أي حال',
          onClick: () => {
            const s = loadState() || st;
            s.phase = 'finding';
            s.forceCount = true;
            saveState(s);
            route();
          },
        }]);
        return;
      }
    }

    const add = await waitFor(() => clickablesWithText('إضافة طلب جديد')[0], 10000);
    if (!add) {
      banner('ما لقيت زر "إضافة طلب جديد" في صفحة الحساب', 'err');
      return;
    }
    st.phase = 'form';
    saveState(st);
    banner('فتح طلب جديد…');
    await sleep(300);
    add.click();
  }

  async function stepCreateForm(cfg) {
    const st = loadState();
    if (!st || st.phase !== 'form') return;

    banner('تعبئة تفاصيل الحجز…');
    const ready = await waitFor(() => controlByLabel('نوع الطلب'), 15000);
    if (!ready) {
      banner('ما ظهر نموذج الحجز. حدّث الصفحة.', 'err');
      return;
    }

    const steps = [
      ['نوع الطلب', cfg.abRequestType],
      ['نوع الإيداع', cfg.abDepositType],
      ['المدينة', cfg.abCity],
      ['القيمة', cfg.abAmount],
    ];
    const failed = [];
    for (const [label, value] of steps) {
      if (stopRequested()) return;
      banner(`تعبئة: ${label}…`);
      if (!(await fillField(label, value))) failed.push(label);
    }

    st.phase = 'done';
    saveState(st);

    const other = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p')].find(
      (el) => norm(el.textContent) === norm('معلومات أخرى')
    );
    const fundsEl = controlByLabel('مصدر الأموال');
    (fundsEl || other)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (fundsEl) fundsEl.style.outline = '3px solid #f59e0b';

    if (failed.length) {
      banner(`ما قدرت نعبي: ${failed.join('، ')}. عبّيها يدويًا ثم كمّل باقي الحقول.`, 'err');
    } else {
      banner('✅ تفاصيل الحجز جاهزة. كمّل مصدر الأموال ومعلومات العميل وفحص Cloudflare ثم اضغط إرسال.', 'ok');
    }
  }

  // ---------- التوجيه ----------
  let running = false;
  let routedHref = null;

  async function routeInner() {
    if (document.querySelector('input[type="password"]')) {
      // صفحة دخول: بداية عميل جديد
      clearState();
      hideBanner();
      return;
    }
    const cfg = await getCfg();
    const path = location.pathname;
    const st = loadState();
    if (!cfg.abEnabled && !(st && ['finding', 'form'].includes(st.phase))) return;

    if (/\/purchase-requests\/create\/?$/.test(path)) return stepCreateForm(cfg);
    if (/^\/bank-accounts\/[^/]+\/?$/.test(path)) return stepAccountPage(cfg);
    if (clickablesWithText('عرض الحساب').length || /^\/(dashboard|bank-accounts)\/?$/.test(path)) {
      return stepAccountList(cfg);
    }
  }

  async function route() {
    if (running) return;
    running = true;
    routedHref = location.href;
    try {
      await routeInner();
    } catch (e) {
      console.error('[safwa-autobook]', e);
      banner('خطأ: ' + (e && e.message ? e.message : e), 'err');
    } finally {
      running = false;
      if (routedHref !== location.href) setTimeout(route, 0);
    }
  }

  // المنصة قد تغيّر الصفحة بدون تحميل كامل، فنراقب تغيّر الرابط
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      route();
    }
  }, 500);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.abResetAt) {
      clearState();
      hideBanner();
      route();
    } else if (changes.abEnabled && changes.abEnabled.newValue === false) {
      const s = loadState();
      if (s) { s.phase = 'stopped'; saveState(s); }
      hideBanner();
    }
  });

  route();
})();
