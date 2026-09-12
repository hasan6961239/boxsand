#!/usr/bin/env node
/**
 * Rate collector — runs on a schedule, writes the JSON the dashboard reads.
 *
 * Design notes:
 *  - Every source is isolated. A source that 404s, changes markup or times out
 *    is recorded as `down` and the run still produces a file.
 *  - Values that no source returned this run are carried over from the previous
 *    file and flagged, so the UI can show "last known" instead of a blank.
 *  - History is appended, then thinned, so the repo does not grow without bound.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { round, median } from './lib/util.mjs';
import {
  CITIES, PARALLEL_SOURCES, officialFromCbl, fxFromErApi, fxFromJsdelivr,
  metalsFromGoldApi, metalsFromGoldPriceOrg, metalsFromPaxg, goldTable, KARATS, TROY_OUNCE_G,
} from './sources.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LATEST_PATH = resolve(ROOT, 'docs/data/latest.json');
const HISTORY_PATH = resolve(ROOT, 'docs/data/history.json');
const OFFLINE = process.env.COLLECT_OFFLINE === '1';

const CITY_KEYS = Object.keys(CITIES);
const SHORT = { tripoli: 'tp', benghazi: 'bg', misrata: 'ms' };

/* ------------------------------------------------------------- source runner */

const report = [];

async function run(id, label, url, fn) {
  if (OFFLINE) { report.push({ id, label, url, status: 'skipped', detail: 'offline', ms: 0 }); return null; }
  const t0 = Date.now();
  try {
    const out = await fn();
    report.push({ id, label, url, status: 'ok', detail: String(out?.detail ?? '').slice(0, 120), ms: Date.now() - t0 });
    return out;
  } catch (err) {
    report.push({ id, label, url, status: 'down', detail: String(err?.message ?? err).slice(0, 160), ms: Date.now() - t0 });
    return null;
  }
}

/* -------------------------------------------------------------------- merge */

/**
 * Combine the per-city numbers reported by several sources.
 *
 * A source's `weight` decides how many votes its number gets, then we take the
 * median: two agreeing news sites outvote one stale page, and a single source
 * still produces a value.
 */
function mergeParallel(results) {
  const votes = {};
  for (const { weight, rates } of results) {
    for (const [code, cities] of Object.entries(rates || {})) {
      for (const [city, val] of Object.entries(cities || {})) {
        if (!Number.isFinite(val)) continue;
        ((votes[code] ||= {})[city] ||= []).push(...Array(weight).fill(val));
      }
    }
  }
  const out = {};
  for (const [code, cities] of Object.entries(votes)) {
    out[code] = {};
    for (const [city, vals] of Object.entries(cities)) out[code][city] = round(median(vals), 4);
  }
  return out;
}

/**
 * Drop any city number that sits far from where the rest of the market is.
 * Libyan cash markets move together — the live articles quote Tripoli and
 * Benghazi at the same 9.39 and Zliten a single قرش away — so a city more than
 * 2.5% off the pack is a mis-parse, not a spread.
 */
function dropOutliers(parallel) {
  const dropped = [];
  for (const [code, cities] of Object.entries(parallel)) {
    const values = Object.values(cities).filter(Number.isFinite);
    if (values.length < 2) continue;
    const mid = median(values);
    if (!Number.isFinite(mid) || mid === 0) continue;
    for (const [city, val] of Object.entries(cities)) {
      if (Number.isFinite(val) && Math.abs(val - mid) / mid > 0.025) {
        delete cities[city];
        dropped.push(`${code}.${city}=${val}`);
      }
    }
  }
  return dropped;
}

/** Fill a city we could not read directly from the market-wide number. */
function fillFromNational(parallel) {
  const derived = [];
  for (const [code, cities] of Object.entries(parallel)) {
    const national = cities.national;
    if (!Number.isFinite(national)) continue;
    for (const city of CITY_KEYS) {
      if (!Number.isFinite(cities[city])) { cities[city] = national; derived.push(`${code}.${city}`); }
    }
  }
  return derived;
}

/** Reuse the previous run's value for anything still missing. */
function carryForward(current, previous) {
  const carried = [];
  if (!previous) return carried;
  for (const code of ['USD', 'EUR', 'GBP']) {
    for (const city of [...CITY_KEYS, 'national']) {
      const has = Number.isFinite(current.parallel?.[code]?.[city]);
      const old = previous.parallel?.[code]?.[city];
      if (!has && Number.isFinite(old)) {
        ((current.parallel ||= {})[code] ||= {})[city] = old;
        carried.push(`parallel.${code}.${city}`);
      }
    }
    if (!Number.isFinite(current.official?.[code]) && Number.isFinite(previous.official?.[code])) {
      (current.official ||= {})[code] = previous.official[code];
      carried.push(`official.${code}`);
    }
  }
  for (const metal of ['XAU', 'XAG']) {
    if (!Number.isFinite(current.metals?.[metal]) && Number.isFinite(previous.metals?.[metal])) {
      (current.metals ||= {})[metal] = previous.metals[metal];
      carried.push(`metals.${metal}`);
    }
  }
  return carried;
}

/* ------------------------------------------------------------------ history */

/**
 * Thin the series so the file stays small while the useful resolution stays:
 * everything for 7 days, hourly to 60 days, daily beyond that.
 */
function thinHistory(points, now) {
  const DAY = 86400e3, HOUR = 3600e3;
  const kept = [];
  const seen = new Set();
  for (const p of points.sort((a, b) => a.t - b.t)) {
    const age = now - p.t;
    let bucket;
    if (age <= 7 * DAY) bucket = `f${p.t}`;
    else if (age <= 60 * DAY) bucket = `h${Math.floor(p.t / HOUR)}`;
    else bucket = `d${Math.floor(p.t / DAY)}`;
    if (seen.has(bucket)) { kept[kept.length - 1] = p; continue; } // keep the newest in the bucket
    seen.add(bucket);
    kept.push(p);
  }
  return kept.slice(-6000);
}

function snapshot(data, t) {
  const pick = (code) => {
    const src = data.parallel?.[code] || {};
    const o = {};
    for (const [city, short] of Object.entries(SHORT)) if (Number.isFinite(src[city])) o[short] = round(src[city], 4);
    return Object.keys(o).length ? o : undefined;
  };
  return {
    t,
    u: pick('USD'),
    e: pick('EUR'),
    g: round(data.metals?.XAU, 2) ?? undefined,
    s: round(data.metals?.XAG, 3) ?? undefined,
    o: round(data.official?.USD, 4) ?? undefined,
    oe: round(data.official?.EUR, 4) ?? undefined,
    lg: round(data.localGold?.k18PerGram, 2) ?? undefined,
  };
}

/* --------------------------------------------------------------------- main */

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function main() {
  const now = new Date();
  const previous = await readJson(LATEST_PATH, null);

  const [parallelResults, cbl, fx, metals] = await Promise.all([
    Promise.all(PARALLEL_SOURCES.map(async (s) => {
      const out = await run(s.id, s.label, s.url, s.run);
      return out ? { weight: s.weight, rates: out.rates, localGold18: out.localGold18 } : null;
    })),
    run('cbl', 'مصرف ليبيا المركزي', 'https://cbl.gov.ly/currency-exchange-rates/', officialFromCbl),
    (async () =>
      (await run('er-api', 'أسعار الصرف الدولية', 'https://open.er-api.com', fxFromErApi)) ??
      (await run('currency-api', 'مرآة أسعار الصرف', 'https://cdn.jsdelivr.net', fxFromJsdelivr)))(),
    (async () =>
      (await run('gold-api', 'سعر الذهب العالمي', 'https://api.gold-api.com', metalsFromGoldApi)) ??
      (await run('goldprice-org', 'goldprice.org', 'https://data-asg.goldprice.org', metalsFromGoldPriceOrg)) ??
      (await run('paxg', 'PAX Gold (احتياطي)', 'https://api.coingecko.com', metalsFromPaxg)))(),
  ]);

  const liveParallel = parallelResults.filter(Boolean);
  const parallel = mergeParallel(liveParallel);
  const dropped = dropOutliers(parallel);
  const derived = fillFromNational(parallel);

  // A price quoted by Libyan dealers themselves, rather than derived from the
  // world spot price — it carries the local premium and the workmanship market.
  const localGold18 = liveParallel.map((r) => r.localGold18).find(Number.isFinite) ?? null;

  // CBL is authoritative for the official rate; the international feed only
  // fills in when the bank's page could not be read.
  const official = {
    USD: round(cbl?.rates?.USD ?? fx?.rates?.LYD, 4),
    EUR: round(cbl?.rates?.EUR ?? (fx?.rates?.LYD && fx?.rates?.EUR ? fx.rates.LYD / fx.rates.EUR : null), 4),
    GBP: round(cbl?.rates?.GBP ?? (fx?.rates?.LYD && fx?.rates?.GBP ? fx.rates.LYD / fx.rates.GBP : null), 4),
    basis: cbl ? 'cbl' : fx ? 'international' : 'carried',
  };

  const data = {
    schema: 1,
    updatedAt: now.toISOString(),
    official,
    parallel,
    metals: { XAU: round(metals?.rates?.XAU, 2), XAG: round(metals?.rates?.XAG, 3), unit: 'USD/oz' },
    localGold: { k18PerGram: round(localGold18, 2), unit: 'LYD/g', source: 'قناة سوق المشير' },
  };

  const carried = carryForward(data, previous);

  // Gold, priced twice: at the bank's rate and at each city's street rate.
  const xau = data.metals.XAU;
  data.gold = {
    ouncePriceUsd: xau,
    gramPriceUsd: round(xau ? xau / TROY_OUNCE_G : null, 4),
    karats: KARATS.map(({ k, purity, label }) => ({ k, purity, label })),
    official: goldTable(xau, data.official.USD),
    parallel: Object.fromEntries(CITY_KEYS.map((c) => [c, goldTable(xau, data.parallel?.USD?.[c])])),
  };

  // Keep the last known local quote when the channel post lacks one.
  if (!Number.isFinite(data.localGold.k18PerGram) && Number.isFinite(previous?.localGold?.k18PerGram)) {
    data.localGold.k18PerGram = previous.localGold.k18PerGram;
    carried.push('localGold.k18PerGram');
  }

  data.meta = { derived, carried, dropped, cities: CITIES };
  data.sources = report;

  const history = thinHistory([
    ...(await readJson(HISTORY_PATH, [])).filter((p) => Number.isFinite(p?.t)),
    snapshot(data, now.getTime()),
  ], now.getTime());

  await mkdir(dirname(LATEST_PATH), { recursive: true });
  await writeFile(LATEST_PATH, JSON.stringify(data, null, 2) + '\n');
  await writeFile(HISTORY_PATH, JSON.stringify(history) + '\n');

  const ok = report.filter((r) => r.status === 'ok').length;
  const cityCount = ['USD', 'EUR'].map((c) => `${c}:${CITY_KEYS.filter((k) => Number.isFinite(data.parallel?.[c]?.[k]) && !derived.includes(`${c}.${k}`)).length}/3`).join(' ');
  console.log(`[collect] ${ok}/${report.length} sources ok · ${history.length} history points · real city rates ${cityCount}`);
  if (dropped.length) console.log(`  dropped outliers: ${dropped.join(', ')}`);
  for (const r of report) console.log(`  ${r.status === 'ok' ? '✓' : r.status === 'skipped' ? '–' : '✗'} ${r.id.padEnd(20)} ${r.detail}`);
}

main().catch((err) => { console.error('[collect] fatal:', err); process.exit(1); });
