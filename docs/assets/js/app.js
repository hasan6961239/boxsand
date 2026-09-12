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
    window.UI.renderOfficial(state);
    window.UI.renderGold(state);
    window.UI.renderCharts(state);
    window.UI.renderSources(state);
    window.UI.renderConverter(state);
    renderFreshness();
    bindTilt(document);
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

  initTheme();
  bindControls();
  refresh();
  setInterval(tick, 1000);
})();
