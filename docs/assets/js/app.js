/* =========================================================================
   App — bootstrap, the five-minute refresh loop, theme, and 3D interactions.
   ========================================================================= */
(function () {
  'use strict';

  const D = window.RatesData;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const REFRESH_MS = 5 * 60 * 1000;
  const RING = 2 * Math.PI * 15.5;

  const state = {
    latest: null,
    history: [],
    range: 30,
    goldBasis: 'official',
    spreadCurrency: 'USD',
    alerts: [],
    live: null,
    lastFetch: 0,
    failures: 0,
  };

  /* ----------------------------------------------------------- persistence */

  const store = {
    get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  };

  /* ----------------------------------------------------------------- toast */

  let toastTimer;
  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-on'), 4200);
  }

  /* ------------------------------------------------------------- notifying */

  /**
   * Show an alert. A granted browser notification reaches the user outside the
   * tab; otherwise the in-page toast still tells them.
   */
  function notify(title, body) {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body, tag: title, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🪙</text></svg>' });
        return;
      }
    } catch { /* fall through to the toast */ }
    toast(`${title} — ${body}`);
  }

  async function ensureNotificationPermission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission !== 'default') return Notification.permission;
    try { return await Notification.requestPermission(); } catch { return 'denied'; }
  }

  /* ----------------------------------------------------------------- theme */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#eeece7' : '#0b0e14');
    store.set('marsad-theme', theme);
  }

  function initTheme() {
    const saved = store.get('marsad-theme', null);
    applyTheme(saved || (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
    $('#theme-btn').addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(next);
      // Series colors are theme tokens, so the charts must be redrawn.
      if (state.latest) renderAll();
    });
  }

  /* --------------------------------------------------------------- reveal */

  /**
   * Fade each section in as it first comes into view. Sections already on
   * screen at load reveal immediately, so nothing above the fold waits.
   */
  let revealObserver;
  function bindReveal() {
    const sections = $$('main > section:not(.reveal), .hero:not(.reveal)');
    if (!sections.length) return;

    if (reduced || !('IntersectionObserver' in window)) {
      sections.forEach((el) => el.classList.add('reveal', 'is-visible'));
      return;
    }
    revealObserver ||= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    }, {
      // Expand the root rather than shrink it: a section reveals just before it
      // scrolls in, so the reader never watches it fade.
      rootMargin: '220px 0px 220px 0px',
      threshold: 0,
    });

    sections.forEach((el) => {
      el.classList.add('reveal');
      revealObserver.observe(el);
      // A hidden section is a far worse failure than a missing animation, so
      // anything still unrevealed shortly after binding is shown regardless.
      setTimeout(() => el.classList.add('is-visible'), 2500);
    });
  }

  /**
   * Flash the figures whose value actually moved since the last render, so a
   * change is noticed without the reader having to remember the old number.
   */
  const lastValues = new Map();
  function flagChanges() {
    if (reduced) return;
    $$('.rc-value b, .gt-value, .spread-value').forEach((el, index) => {
      const key = `${el.className}#${index}`;
      const text = el.textContent.trim();
      const previous = lastValues.get(key);
      lastValues.set(key, text);
      if (previous === undefined || previous === text) return;
      el.classList.remove('value-changed');
      void el.offsetWidth;            // restart the animation
      el.classList.add('value-changed');
    });
  }

  /* ------------------------------------------------------------- 3D tilt */

  const fine = window.matchMedia?.('(pointer: fine)').matches;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function bindTilt(root) {
    if (!fine || reduced) return;
    root.querySelectorAll('[data-tilt]').forEach((card) => {
      const inner = card.querySelector('.tilt-inner') || card;
      card.addEventListener('pointermove', (event) => {
        const box = card.getBoundingClientRect();
        const px = (event.clientX - box.left) / box.width;
        const py = (event.clientY - box.top) / box.height;
        inner.style.setProperty('--ry', `${(px - 0.5) * 9}deg`);
        inner.style.setProperty('--rx', `${(0.5 - py) * 7}deg`);
        card.style.setProperty('--mx', `${px * 100}%`);
        card.style.setProperty('--my', `${py * 100}%`);
      });
      card.addEventListener('pointerleave', () => {
        inner.style.setProperty('--ry', '0deg');
        inner.style.setProperty('--rx', '0deg');
      });
    });
  }

  /* ------------------------------------------------------------- freshness */

  function renderFreshness() {
    const iso = state.latest?.updatedAt;
    const pulse = $('#pulse');
    const ageMin = iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity;

    $('#updated-rel').textContent = iso ? D.relTime(iso) : 'لا توجد بيانات';
    $('#updated-abs').textContent = iso ? D.absTime.format(new Date(iso)) : '—';
    $('#footer-updated').textContent = iso ? `آخر تحديث للبيانات: ${D.absTime.format(new Date(iso))} (توقيت ليبيا)` : '—';

    pulse.className = 'pulse';
    if (state.failures > 0) pulse.classList.add('is-error');
    else if (ageMin > 45) pulse.classList.add('is-stale');
  }

  /* ---------------------------------------------------------------- render */

  function renderAll() {
    window.UI.renderHero(state);
    window.UI.renderCityCards('#usd-cards', 'USD', state);
    window.UI.renderCityCards('#eur-cards', 'EUR', state);
    window.UI.renderSpread(state);
    window.UI.renderOfficial(state);
    window.UI.renderGold(state);
    window.UI.renderCharts(state);
    window.UI.renderSources(state);
    window.UI.renderConverter(state);
    window.UI.renderAlerts(state);
    renderFreshness();
    bindTilt(document);
    bindReveal();
    flagChanges();
  }

  /* ----------------------------------------------------------------- fetch */

  let busy = false;

  async function refresh({ manual = false } = {}) {
    if (busy) return;
    busy = true;
    const btn = $('#refresh-btn');
    btn.classList.add('is-busy');
    try {
      const [{ latest, history }, live] = await Promise.all([
        D.load(),
        // Never let a slow metals feed hold up the page.
        D.liveGold().catch(() => null),
      ]);
      state.latest = latest;
      state.history = history;
      if (live) state.live = live;
      state.lastFetch = Date.now();
      state.failures = 0;
      if (!rangeChosen) autoRange();
      renderAll();
      window.UI.checkAlerts(state, notify);
      if (manual) toast('تم تحديث البيانات.');
    } catch (err) {
      state.failures += 1;
      renderFreshness();
      toast(state.latest ? 'تعذّر جلب تحديث جديد — المعروض آخر ما وصل.' : 'تعذّر تحميل البيانات. تحقّق من الاتصال.');
      console.error('[marsad] refresh failed:', err);
    } finally {
      busy = false;
      btn.classList.remove('is-busy');
    }
  }

  /**
   * Until enough readings have accumulated, the default window would show a
   * near-empty chart — so widen it to everything we have and mark the button.
   */
  let rangeChosen = false;
  function autoRange() {
    const usable = D.CITY_ORDER.map((c) => D.withinDays(D.cityUsd(state.history, c), 30).length);
    if (Math.max(0, ...usable) >= 5) return;
    state.range = 0;
    $$('#range-picker .seg-btn').forEach((b) => {
      const on = b.dataset.range === '0';
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
  }

  /* ------------------------------------------------------- countdown timer */

  function tick() {
    const elapsed = Date.now() - state.lastFetch;
    const ratio = Math.min(1, Math.max(0, elapsed / REFRESH_MS));
    $('#countdown-bar').style.strokeDashoffset = String(RING * (1 - ratio));
    if (state.lastFetch) $('#updated-rel').textContent = D.relTime(state.latest?.updatedAt);
    if (elapsed >= REFRESH_MS && document.visibilityState === 'visible') refresh();
  }

  /* ----------------------------------------------------------------- wiring */

  function bindControls() {
    $('#refresh-btn').addEventListener('click', () => refresh({ manual: true }));

    $('#range-picker').addEventListener('click', (event) => {
      const btn = event.target.closest('.seg-btn');
      if (!btn) return;
      state.range = Number(btn.dataset.range);
      rangeChosen = true;
      $$('#range-picker .seg-btn').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      window.UI.renderCharts(state);
    });

    $('#gold-basis').addEventListener('click', (event) => {
      const btn = event.target.closest('.seg-btn');
      if (!btn) return;
      state.goldBasis = btn.dataset.basis;
      $$('#gold-basis .seg-btn').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      window.UI.renderGold(state);
    });

    $('#spread-currency').addEventListener('click', (event) => {
      const btn = event.target.closest('.seg-btn');
      if (!btn) return;
      state.spreadCurrency = btn.dataset.cur;
      $$('#spread-currency .seg-btn').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      window.UI.renderSpread(state);
    });

    const alerts = $('#alerts');
    alerts.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = parseFloat(String($('#alert-value').value).replace(/[^\d.]/g, ''));
      if (!Number.isFinite(value) || value <= 0) { toast('أدخل حدّاً صالحاً، مثل 9.50'); return; }
      await ensureNotificationPermission();
      state.alerts.push({
        id: `a${Date.now().toString(36)}`,
        metric: $('#alert-metric').value,
        dir: $('#alert-dir').value,
        value,
        armed: true,
      });
      window.UI.saveAlerts(state.alerts);
      $('#alert-value').value = '';
      window.UI.renderAlerts(state);
      window.UI.checkAlerts(state, notify);
      toast('تمت إضافة التنبيه.');
    });
    alerts.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-remove]');
      if (!btn) return;
      state.alerts = state.alerts.filter((a) => a.id !== btn.dataset.remove);
      window.UI.saveAlerts(state.alerts);
      window.UI.renderAlerts(state);
    });

    const converter = $('#converter');
    $('#conv-basis').addEventListener('change', (event) => { event.target.dataset.touched = '1'; });
    converter.addEventListener('input', () => window.UI.renderConverter(state));
    converter.addEventListener('change', () => window.UI.renderConverter(state));
    converter.addEventListener('submit', (event) => event.preventDefault());

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - state.lastFetch > REFRESH_MS) refresh();
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (state.latest) { window.UI.renderCharts(state); window.UI.renderCityCards('#usd-cards', 'USD', state); window.UI.renderCityCards('#eur-cards', 'EUR', state); bindTilt(document); } }, 220);
    });
  }

  /* ------------------------------------------------------------------ boot */

  state.alerts = window.UI.loadAlerts();
  initTheme();
  bindControls();
  refresh();
  setInterval(tick, 1000);
})();
