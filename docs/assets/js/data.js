/* =========================================================================
   Data layer — loading, deriving series, and the change-vs-baseline maths.
   ========================================================================= */
(function (global) {
  'use strict';

  const LATEST_URL = 'data/latest.json';
  const HISTORY_URL = 'data/history.json';

  /** Libya runs UTC+2 year round (no DST), so a fixed offset is exact. */
  const LY_OFFSET_MS = 2 * 3600e3;

  const CITY_META = {
    misrata:  { key: 'misrata',  short: 'ms', ar: 'مصراتة', market: 'سوق مصراتة',  varName: '--s-misrata' },
    tripoli:  { key: 'tripoli',  short: 'tp', ar: 'طرابلس', market: 'سوق المشير',  varName: '--s-tripoli' },
    benghazi: { key: 'benghazi', short: 'bg', ar: 'بنغازي', market: 'سوق فينيسيا', varName: '--s-benghazi' },
  };
  const CITY_ORDER = ['misrata', 'tripoli', 'benghazi'];

  const TROY_OUNCE_G = 31.1034768;
  const PURITY = { 24: 0.999, 22: 0.916, 21: 0.875, 18: 0.750, 14: 0.585 };

  /* ------------------------------------------------------------ formatting */

  // Libyan rate pages quote prices as 9.27 / 4,347.78 — a period decimal and a
  // comma thousands group. `ar-LY` would flip both, so numbers use en-US and
  // only the dates carry the Arabic locale.
  const nf = (min, max) => new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
  const f2 = nf(2, 2), f3 = nf(2, 3), f4 = nf(2, 4), f0 = nf(0, 0);

  const fmtRate = (v) => (Number.isFinite(v) ? f3.format(v) : '—');
  const fmtRate4 = (v) => (Number.isFinite(v) ? f4.format(v) : '—');
  const fmtMoney = (v) => (Number.isFinite(v) ? f2.format(v) : '—');
  const fmtWhole = (v) => (Number.isFinite(v) ? f0.format(v) : '—');
  const fmtPct = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${f2.format(Math.abs(v))}%` : '—');
  const fmtSigned = (v, digits = 3) => {
    if (!Number.isFinite(v)) return '—';
    const f = nf(2, digits);
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${f.format(Math.abs(v))}`;
  };

  const relTime = (iso) => {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '—';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'الآن';
    if (mins < 60) return `قبل ${f0.format(mins)} دقيقة`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `قبل ${f0.format(hrs)} ساعة`;
    return `قبل ${f0.format(Math.round(hrs / 24))} يوم`;
  };

  const absTime = new Intl.DateTimeFormat('ar-LY-u-nu-latn', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Tripoli', hour12: false,
  });

  /* ---------------------------------------------------------------- loading */

  async function fetchJson(url) {
    const res = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
  }

  async function load() {
    const [latest, history] = await Promise.all([
      fetchJson(LATEST_URL),
      fetchJson(HISTORY_URL).catch(() => []),
    ]);
    return { latest, history: Array.isArray(history) ? history.filter((p) => Number.isFinite(p?.t)).sort((a, b) => a.t - b.t) : [] };
  }

  /* ------------------------------------------------------- live gold spot */

  /**
   * The collector runs every ~10 minutes; these browser-side endpoints are
   * CORS-open, so the gold figures can refresh on the page's own 5-minute
   * cycle in between. Failure is silent — the collector's value stands.
   */
  const GOLD_FEEDS = [
    { url: 'https://api.gold-api.com/price/XAU', silver: 'https://api.gold-api.com/price/XAG', pick: (j) => Number(j?.price) },
    { url: 'https://data-asg.goldprice.org/dbXRates/USD', pick: (j) => Number(j?.items?.[0]?.xauPrice), pickSilver: (j) => Number(j?.items?.[0]?.xagPrice) },
  ];

  async function getJson(url, ms = 7000) {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms), cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function liveGold() {
    for (const feed of GOLD_FEEDS) {
      try {
        const main = await getJson(feed.url);
        const XAU = feed.pick(main);
        if (!Number.isFinite(XAU) || XAU <= 0) continue;
        let XAG = feed.pickSilver ? feed.pickSilver(main) : null;
        if (feed.silver && !Number.isFinite(XAG)) {
          XAG = await getJson(feed.silver).then(feed.pick).catch(() => null);
        }
        return { XAU, XAG: Number.isFinite(XAG) ? XAG : null, at: Date.now(), via: new URL(feed.url).hostname };
      } catch { /* try the next feed */ }
    }
    return null;
  }

  /** Gold per gram in LYD at every karat, for one USD rate. */
  function goldTableFor(xau, lydPerUsd) {
    if (!Number.isFinite(xau) || !Number.isFinite(lydPerUsd)) return null;
    const perGram = xau / TROY_OUNCE_G;
    const out = {};
    for (const k of Object.keys(PURITY)) out[k] = Math.round(perGram * PURITY[k] * lydPerUsd * 100) / 100;
    return out;
  }

  /**
   * Merge a live spot reading over the collected snapshot, recomputing every
   * derived gold figure so the page never mixes a fresh ounce with stale grams.
   */
  function resolveGold(latest, live) {
    const metals = { ...(latest?.metals || {}) };
    if (!live || !Number.isFinite(live.XAU)) return { metals, gold: latest?.gold || {}, isLive: false };

    metals.XAU = live.XAU;
    if (Number.isFinite(live.XAG)) metals.XAG = live.XAG;

    const cities = {};
    for (const city of CITY_ORDER) cities[city] = goldTableFor(live.XAU, latest?.parallel?.USD?.[city]);
    return {
      metals,
      gold: {
        ...(latest?.gold || {}),
        ouncePriceUsd: live.XAU,
        gramPriceUsd: live.XAU / TROY_OUNCE_G,
        official: goldTableFor(live.XAU, latest?.official?.USD),
        parallel: cities,
      },
      isLive: true,
      liveAt: live.at,
      liveVia: live.via,
    };
  }

  /** Median — used wherever a representative value beats an average. */
  function median(values) {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = v.length >> 1;
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  /**
   * Resolve a watchable metric ("USD:misrata", "GOLD21") to its current value.
   * Alerts and the spread view both address rates this way.
   */
  function metricValue(latest, live, metric) {
    if (!latest) return null;
    if (metric === 'GOLD21' || metric === 'GOLD18') {
      const karat = metric === 'GOLD21' ? 21 : 18;
      const gold = resolveGold(latest, live).gold || {};
      const city = CITY_ORDER.find((c) => Number.isFinite(gold.parallel?.[c]?.[karat]));
      return gold.parallel?.[city]?.[karat] ?? gold.official?.[karat] ?? null;
    }
    const [code, city] = String(metric).split(':');
    const v = latest.parallel?.[code]?.[city];
    return Number.isFinite(v) ? v : null;
  }

  /** Human label for a metric key. */
  function metricLabel(metric) {
    if (metric === 'GOLD21') return 'ذهب عيار 21 — الجرام';
    if (metric === 'GOLD18') return 'ذهب عيار 18 — الجرام';
    const [code, city] = String(metric).split(':');
    const cur = { USD: 'الدولار', EUR: 'اليورو', GBP: 'الإسترليني' }[code] || code;
    return `${cur} — ${CITY_META[city]?.ar ?? city}`;
  }

  /* ---------------------------------------------------------------- series */

  /** Pull one metric out of the history snapshots as {t, v} points. */
  function series(history, pick) {
    const out = [];
    for (const p of history) {
      const v = pick(p);
      if (Number.isFinite(v)) out.push({ t: p.t, v });
    }
    return out;
  }

  const cityUsd = (history, city) => series(history, (p) => p.u?.[CITY_META[city].short]);
  const cityEur = (history, city) => series(history, (p) => p.e?.[CITY_META[city].short]);
  const goldSpot = (history) => series(history, (p) => p.g);
  const silverSpot = (history) => series(history, (p) => p.s);
  const officialUsd = (history) => series(history, (p) => p.o);

  /** Gold per gram in LYD at a given karat, priced off whichever rate applies. */
  const goldGram = (history, karat, rateOf) =>
    series(history, (p) => {
      const rate = rateOf(p);
      return Number.isFinite(p.g) && Number.isFinite(rate) ? (p.g / TROY_OUNCE_G) * PURITY[karat] * rate : null;
    });

  const goldGramOfficial = (history, karat = 21) => goldGram(history, karat, (p) => p.o);
  const goldGramCity = (history, city, karat = 21) => goldGram(history, karat, (p) => p.u?.[CITY_META[city].short]);

  /* --------------------------------------------------------------- baselines */

  /** Local (Libya) calendar parts for a timestamp. */
  function libyaParts(ts) {
    const d = new Date(ts + LY_OFFSET_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours() };
  }

  /** Point at or just before `target`; falls back to the nearest one within tolerance. */
  function pointAt(points, target, toleranceMs) {
    if (!points.length) return null;
    let before = null;
    for (const p of points) { if (p.t <= target) before = p; else break; }
    if (before && target - before.t <= toleranceMs) return before;
    let nearest = null;
    for (const p of points) if (!nearest || Math.abs(p.t - target) < Math.abs(nearest.t - target)) nearest = p;
    return nearest && Math.abs(nearest.t - target) <= toleranceMs ? nearest : null;
  }

  /** First reading of the current Libyan day at or after 06:00 local. */
  function morningPoint(points) {
    if (!points.length) return null;
    const today = libyaParts(Date.now());
    for (const p of points) {
      const lp = libyaParts(p.t);
      if (lp.y === today.y && lp.m === today.m && lp.d === today.d && lp.h >= 6) return p;
    }
    return null;
  }

  const change = (current, base) => {
    if (!Number.isFinite(current) || !base || !Number.isFinite(base.v) || base.v === 0) return null;
    return { abs: current - base.v, pct: ((current - base.v) / base.v) * 100, from: base.v, at: base.t };
  };

  /**
   * The four comparisons shown on every rate: since the previous reading,
   * since this morning, versus the same time yesterday, and over a week.
   */
  function baselines(points, current) {
    const now = Date.now();
    const last = points.length >= 2 ? points[points.length - 2] : null;
    const latestPoint = points[points.length - 1];
    // If `current` already differs from the newest stored point, that point is
    // the previous reading; otherwise step one further back.
    const prev = latestPoint && Number.isFinite(current) && Math.abs(latestPoint.v - current) > 1e-9 ? latestPoint : last;

    return {
      last:      change(current, prev),
      morning:   change(current, morningPoint(points)),
      yesterday: change(current, pointAt(points, now - 86400e3, 8 * 3600e3)),
      week:      change(current, pointAt(points, now - 7 * 86400e3, 36 * 3600e3)),
    };
  }

  /** Human sentence for the headline note. */
  function changeSentence(label, delta, unit) {
    if (!delta) return '';
    const dir = delta.abs > 0 ? 'ارتفع' : delta.abs < 0 ? 'انخفض' : 'استقر';
    if (delta.abs === 0) return `${label} مستقر ${unit}`;
    return `${label} ${dir} ${fmtSigned(Math.abs(delta.abs))} ${unit} (${fmtPct(delta.pct)})`;
  }

  /* ----------------------------------------------------------------- window */

  const withinDays = (points, days) =>
    days > 0 ? points.filter((p) => p.t >= Date.now() - days * 86400e3) : points;

  global.RatesData = {
    load, series, withinDays, liveGold, resolveGold, goldTableFor, median, metricValue, metricLabel,
    cityUsd, cityEur, goldSpot, silverSpot, officialUsd, goldGramOfficial, goldGramCity,
    baselines, change, changeSentence, pointAt, morningPoint, libyaParts,
    fmtRate, fmtRate4, fmtMoney, fmtWhole, fmtPct, fmtSigned, relTime, absTime,
    CITY_META, CITY_ORDER, PURITY, TROY_OUNCE_G,
  };
})(window);
