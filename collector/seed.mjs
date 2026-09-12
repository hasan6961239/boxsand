#!/usr/bin/env node
/**
 * One-off seed so the dashboard has something real to show before the first
 * scheduled collection lands.
 *
 * Every number here is an observation with a date and a published source — no
 * invented values. Points carry `seed: 1` so the UI can mark them as
 * pre-launch observations rather than collector readings. Gaps stay empty.
 *
 * Run: node collector/seed.mjs   (safe to re-run; it never overwrites real data
 * unless --force is passed)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { goldTable, KARATS, TROY_OUNCE_G } from './sources.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LATEST = resolve(ROOT, 'docs/data/latest.json');
const HISTORY = resolve(ROOT, 'docs/data/history.json');
const force = process.argv.includes('--force');

const ts = (iso) => new Date(iso).getTime();

/**
 * Published observations. `u`/`e` are parallel-market LYD per unit
 * (tp = Tripoli, bg = Benghazi, ms = Misrata), `o` the CBL official USD rate,
 * `g`/`s` gold and silver spot in USD per troy ounce.
 */
const OBSERVATIONS = [
  { t: ts('2026-05-30T12:00:00Z'), u: { tp: 8.35 }, e: { tp: 9.72 }, seed: 1 },
  { t: ts('2026-07-11T12:00:00Z'), u: { tp: 8.95 }, e: { tp: 10.35 }, seed: 1 },
  { t: ts('2026-08-10T13:15:00Z'), u: { tp: 9.45 }, e: { tp: 10.80 }, seed: 1 },
  { t: ts('2026-09-07T12:00:00Z'), o: 6.3405, seed: 1 },
  { t: ts('2026-09-08T15:00:00Z'), u: { tp: 9.16 }, e: { tp: 10.64 }, o: 6.3405, seed: 1 },
  { t: ts('2026-09-09T14:00:00Z'), u: { tp: 9.27, bg: 9.26 }, o: 6.3405, seed: 1 },
  { t: ts('2026-09-11T16:00:00Z'), g: 4347.78, s: 66.62, o: 6.3405, seed: 1 },
];

const LATEST_SEED = {
  schema: 1,
  seeded: true,
  updatedAt: new Date(ts('2026-09-11T16:00:00Z')).toISOString(),
  official: { USD: 6.3405, EUR: null, GBP: null, basis: 'cbl', asOf: '2026-09-07' },
  parallel: {
    USD: { tripoli: 9.27, benghazi: 9.26, misrata: null, national: 9.27 },
    EUR: { tripoli: 10.64, benghazi: null, misrata: null, national: 10.64 },
    GBP: {},
  },
  metals: { XAU: 4347.78, XAG: 66.62, unit: 'USD/oz' },
  meta: { derived: [], carried: [], seedNote: 'قيم أولية موثّقة بتواريخها — تُستبدل تلقائياً عند أول تشغيل للمجمّع.' },
  sources: [],
};

// Gold is always derived from spot + the applicable USD rate, seed included,
// so the seeded figures are computed exactly the way live ones will be.
{
  const xau = LATEST_SEED.metals.XAU;
  LATEST_SEED.gold = {
    ouncePriceUsd: xau,
    gramPriceUsd: Number((xau / TROY_OUNCE_G).toFixed(4)),
    karats: KARATS.map(({ k, purity, label }) => ({ k, purity, label })),
    official: goldTable(xau, LATEST_SEED.official.USD),
    parallel: Object.fromEntries(
      Object.entries(LATEST_SEED.parallel.USD)
        .filter(([city]) => city !== 'national')
        .map(([city, rate]) => [city, goldTable(xau, rate)])
    ),
  };
}

async function exists(path) {
  try { const j = JSON.parse(await readFile(path, 'utf8')); return j && !j.seeded && !(Array.isArray(j) && j.every((p) => p.seed)); }
  catch { return false; }
}

const alreadyReal = (await exists(LATEST)) || (await exists(HISTORY));
if (alreadyReal && !force) {
  console.log('[seed] real collector data present — leaving it alone (use --force to overwrite)');
  process.exit(0);
}

await mkdir(dirname(LATEST), { recursive: true });
await writeFile(LATEST, JSON.stringify(LATEST_SEED, null, 2) + '\n');
await writeFile(HISTORY, JSON.stringify(OBSERVATIONS.sort((a, b) => a.t - b.t)) + '\n');
console.log(`[seed] wrote ${OBSERVATIONS.length} published observations`);
