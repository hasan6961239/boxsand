// The single source of truth in the app: every record in memory, mirrored to
// IndexedDB, with change notifications and dirty-tracking for sync.
//
// A record is { id, col, u, ...fields } — `u` is the last-modified time (ms),
// `d: 1` marks a deletion (tombstone, kept so deletions sync too), and
// `dirty: 1` means "changed here, not yet confirmed by the server".

import * as db from './db.js';
import { emit } from './bus.js';
import { uid, today } from './util.js';
import { DEFAULT_CATEGORIES, defaultSettings } from './defaults.js';

export const COLLECTIONS = ['txn', 'cat', 'person', 'debt', 'pay', 'goal', 'gtx', 'rule', 'budget', 'nlog', 'settings'];

const recs = new Map();
let version = 0;
let cache = null; // data snapshot for the current version
const memo = new Map();
let pendingCols = new Set();
let batchDepth = 0;
let ready = false;

/* ----------------------------------------------------------- loading */

export async function init() {
  const all = await db.allRecords();
  for (const r of all) recs.set(r.id, r);
  await seed();
  ready = true;
  bump(new Set(COLLECTIONS));
}

// Seeds carry u = 0 so any real edit (from this or another device) wins over them.
async function seed() {
  const add = [];
  if (!recs.has('settings')) add.push({ ...defaultSettings(today()), u: 0, dirty: 1 });
  for (const c of DEFAULT_CATEGORIES) if (!recs.has(c.id)) add.push({ ...c, u: 0, dirty: 1 });
  for (const r of add) recs.set(r.id, r);
  await db.putRecords(add);
}

export const isReady = () => ready;

/* ------------------------------------------------------------ reading */

export const getVersion = () => version;

export function get(id) {
  const r = recs.get(id);
  return r && !r.d ? r : null;
}

/** True for live AND deleted ids — used so deliberately deleted items aren't recreated. */
export const exists = (id) => recs.has(id);

export function all(col) {
  return data()[col];
}

/** Snapshot of all live records grouped by collection (+ merged settings). Cached per version. */
export function data() {
  if (cache) return cache;
  const out = Object.fromEntries(COLLECTIONS.filter((c) => c !== 'settings').map((c) => [c, []]));
  for (const r of recs.values()) {
    if (r.d || r.col === 'settings') continue;
    (out[r.col] ||= []).push(r);
  }
  out.settings = settings();
  cache = out;
  return out;
}

/** Cache a derived value until the next change: memoize('home', () => heavy(data())). */
export function memoize(key, fn) {
  const hit = memo.get(key);
  if (hit && hit.v === version) return hit.value;
  const value = fn();
  memo.set(key, { v: version, value });
  return value;
}

export function settings() {
  const base = defaultSettings(today());
  const s = recs.get('settings') || {};
  const out = { ...base, ...s };
  for (const k of ['office', 'state', 'notif', 'look']) out[k] = { ...base[k], ...(s[k] || {}) };
  out.notif.daily = { ...base.notif.daily, ...((s.notif && s.notif.daily) || {}) };
  return out;
}

/* ------------------------------------------------------------ writing */

function stamp(prev) {
  return Math.max(Date.now(), prev ? (prev.u || 0) + 1 : 0);
}

function clean(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) o[k] = v;
  return o;
}

/** Create or replace a record. Returns the stored record. */
export function put(col, rec) {
  const id = rec.id || uid();
  const prev = recs.get(id);
  const r = clean({ ...rec, id, col, u: stamp(prev), dirty: 1 });
  delete r.d;
  recs.set(id, r);
  db.putRecords([r]);
  changed(col);
  return r;
}

/** Shallow-merge fields into an existing record. */
export function patch(id, fields) {
  const prev = recs.get(id);
  if (!prev || prev.d) return null;
  return put(prev.col, { ...prev, ...fields });
}

export function remove(id) {
  const prev = recs.get(id);
  if (!prev || prev.d) return;
  const r = { id, col: prev.col, u: stamp(prev), d: 1, dirty: 1 };
  recs.set(id, r);
  db.putRecords([r]);
  changed(prev.col);
}

/** Restore a record exactly as it was (undo after delete). */
export function restore(rec) {
  const { dirty, d, ...rest } = rec;
  return put(rec.col, rest);
}

/** Group several writes into one change notification. */
export function batch(fn) {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (!batchDepth && pendingCols.size) flush();
  }
}

export function setSettings(p) {
  const cur = recs.get('settings') || defaultSettings(today());
  const next = { ...cur };
  for (const [k, v] of Object.entries(p)) {
    next[k] = v && typeof v === 'object' && !Array.isArray(v) && cur[k] && typeof cur[k] === 'object'
      ? { ...cur[k], ...v }
      : v;
  }
  return put('settings', { ...next, id: 'settings' });
}

/* --------------------------------------------------------------- sync */

export function dirty() {
  const out = [];
  for (const r of recs.values()) if (r.dirty) out.push(r);
  return out;
}

/** After the server accepted `sent`, clear dirty flags of records not edited since. */
export async function markClean(sent) {
  const save = [];
  for (const s of sent) {
    const cur = recs.get(s.id);
    if (cur && cur.dirty && cur.u === s.u) {
      const c = { ...cur };
      delete c.dirty;
      recs.set(c.id, c);
      save.push(c);
    }
  }
  await db.putRecords(save);
}

/** Merge records from the server. Local unsent edits that are newer win. */
export async function applyRemote(list) {
  const save = [];
  const cols = new Set();
  for (const r of list) {
    if (!r || !r.id || !r.col) continue;
    const local = recs.get(r.id);
    if (local && local.dirty && (local.u || 0) > (r.u || 0)) continue;
    const c = { ...r };
    delete c.dirty;
    recs.set(c.id, c);
    save.push(c);
    cols.add(c.col);
  }
  await db.putRecords(save);
  if (cols.size) {
    for (const c of cols) pendingCols.add(c);
    flush(true);
  }
  return save.length;
}

/* ------------------------------------------------------- bulk/backup */

export function exportAll() {
  return [...recs.values()].map(({ dirty, ...r }) => r);
}

/** Replace everything with a backup. Every record becomes dirty so it syncs up. */
export async function importAll(list) {
  const now = Date.now();
  recs.clear();
  await db.clearRecords();
  const save = list.filter((r) => r && r.id && r.col).map((r) => ({ ...r, u: Math.max(now, (r.u || 0) + 1), dirty: 1 }));
  for (const r of save) recs.set(r.id, r);
  await db.putRecords(save);
  await seed();
  bump(new Set(COLLECTIONS));
}

/** Forget everything on this device (logout / reset). */
export async function wipe({ reseed = true } = {}) {
  recs.clear();
  await db.clearRecords();
  await db.clearMeta();
  if (reseed) await seed();
  bump(new Set(COLLECTIONS));
}

export function counts() {
  const c = {};
  for (const r of recs.values()) if (!r.d) c[r.col] = (c[r.col] || 0) + 1;
  return c;
}

/* ------------------------------------------------------------ events */

function changed(col) {
  pendingCols.add(col);
  if (!batchDepth) flush();
}

function flush(remote = false) {
  const cols = pendingCols;
  pendingCols = new Set();
  bump(cols, remote);
}

function bump(cols, remote = false) {
  version++;
  cache = null;
  emit('change', { cols, remote, version });
}
