#!/usr/bin/env node
/**
 * Apply the collector's outlier rule retroactively to stored history.
 *
 * Early runs recorded city values that later guards would reject — a bank
 * counter rate, a weekly opening column, and one number lifted from page
 * furniture. They are wrong rather than merely old, so they must not sit in
 * the charts or act as a baseline for "since this morning".
 *
 * Only the offending city values are removed; the rest of each reading (gold,
 * silver, the official rate) is untouched. Idempotent — re-running is a no-op.
 *
 * Two modes:
 *   (default)  apply the 2.5% fence to every reading
 *   --drop-cities <fromISO> <toISO>
 *              additionally strip ALL city values from readings in that window,
 *              for when a diagnosed bug makes the whole window untrustworthy
 *              rather than just its worst value. The national/gold/official
 *              figures in those readings are still fine and are kept.
 *
 * Run: node collector/repair-history.mjs [--dry] [--drop-cities FROM TO]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { median } from './lib/util.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY = resolve(ROOT, 'docs/data/history.json');
const TOLERANCE = 0.025; // same fence the collector enforces on every run
const dry = process.argv.includes('--dry');

const points = JSON.parse(await readFile(HISTORY, 'utf8'));
const removed = [];

const dropIdx = process.argv.indexOf('--drop-cities');
const dropFrom = dropIdx !== -1 ? Date.parse(process.argv[dropIdx + 1]) : null;
const dropTo = dropIdx !== -1 ? Date.parse(process.argv[dropIdx + 2]) : null;
if (dropIdx !== -1 && !(Number.isFinite(dropFrom) && Number.isFinite(dropTo))) {
  console.error('--drop-cities needs two ISO timestamps');
  process.exit(1);
}

if (dropIdx !== -1) {
  for (const point of points) {
    if (point.t < dropFrom || point.t > dropTo) continue;
    for (const key of ['u', 'e']) {
      if (!point[key]) continue;
      for (const [city, value] of Object.entries(point[key])) {
        removed.push(`${new Date(point.t).toISOString().slice(0, 16)} ${key}.${city}=${value} (window)`);
      }
      delete point[key];
    }
  }
}

for (const point of points) {
  for (const key of ['u', 'e']) {
    const group = point[key];
    if (!group) continue;
    const values = Object.values(group).filter(Number.isFinite);
    if (values.length < 2) continue;
    const mid = median(values);
    if (!Number.isFinite(mid) || mid === 0) continue;
    for (const [city, value] of Object.entries(group)) {
      if (Number.isFinite(value) && Math.abs(value - mid) / mid > TOLERANCE) {
        delete group[city];
        removed.push(`${new Date(point.t).toISOString().slice(0, 16)} ${key}.${city}=${value}`);
      }
    }
    if (!Object.keys(group).length) delete point[key];
  }
}

if (!removed.length) {
  console.log('[repair] history already clean — nothing removed.');
} else {
  console.log(`[repair] removing ${removed.length} value(s) outside ${TOLERANCE * 100}% of their reading:`);
  for (const r of removed) console.log('   -', r);
  if (!dry) await writeFile(HISTORY, JSON.stringify(points) + '\n');
}
