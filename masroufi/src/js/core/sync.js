// Two-way sync with the account's copy on the server (/api/sync).
//
// Protocol: POST { since, changes } → { rev, changes }.
//  - `changes` up: every locally dirty record (tombstones included).
//  - The server merges per record (newer `u` wins), bumps its revision, and
//    returns every record changed after `since` — so one round trip both
//    pushes and pulls. `rev` becomes the next `since`.
// The app stays local-first: nothing waits on the network.

import * as store from './store.js';
import * as db from './db.js';
import * as auth from './auth.js';
import { on, emit } from './bus.js';

let status = { state: 'off', at: null, error: null }; // off | idle | syncing | offline | error | auth
let running = null;
let again = false;
let timer = null;
let pollTimer = null;

export const getStatus = () => status;

function setStatus(p) {
  status = { ...status, ...p };
  emit('sync', status);
}

export async function start() {
  status.at = await db.getMeta('lastSyncAt', null);
  on('change', ({ remote }) => {
    if (!remote) schedule(1500);
  });
  on('auth', (u) => {
    if (u) syncNow();
    else setStatus({ state: 'off', error: null });
  });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => auth.current() && setStatus({ state: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, 60000);
  if (auth.current()) await syncNow();
}

export function schedule(ms = 1500) {
  if (!auth.current()) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

/** Run a sync now (coalesces concurrent calls). Resolves when finished. */
export function syncNow() {
  if (!auth.current()) {
    setStatus({ state: 'off' });
    return Promise.resolve(false);
  }
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let ok = false;
    try {
      do {
        again = false;
        ok = await round();
      } while (again && ok);
    } finally {
      running = null;
    }
    return ok;
  })();
  return running;
}

async function round() {
  if (!navigator.onLine) {
    setStatus({ state: 'offline' });
    return false;
  }
  setStatus({ state: 'syncing', error: null });
  const since = await db.getMeta('rev', 0);
  const changes = store.dirty().map(({ dirty, ...r }) => r);
  let res;
  try {
    await auth.ensureFresh();
    res = await post({ since, changes, device: await deviceId() });
    if (res.status === 401) {
      await auth.ensureFresh();
      res = await post({ since, changes, device: await deviceId() });
    }
  } catch (e) {
    setStatus({ state: navigator.onLine ? 'error' : 'offline', error: 'تعذّر الاتصال بالسيرفر' });
    return false;
  }
  if (res.status === 401 || res.status === 403) {
    setStatus({ state: 'auth', error: 'انتهت الجلسة — سجّل دخول من جديد' });
    return false;
  }
  if (!res.ok) {
    setStatus({ state: 'error', error: `خطأ من السيرفر (${res.status})` });
    return false;
  }
  const body = await res.json();
  await store.markClean(changes);
  if (body.changes && body.changes.length) await store.applyRemote(body.changes);
  await db.setMeta('rev', body.rev || 0);
  const at = Date.now();
  await db.setMeta('lastSyncAt', at);
  setStatus({ state: 'idle', at, error: null, pushed: changes.length, pulled: (body.changes || []).length });
  return true;
}

function post(payload) {
  return fetch('/api/sync', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Forget the server cursor so the next sync pulls everything (used after login/import). */
export async function resetCursor() {
  await db.setMeta('rev', 0);
}

let devId = null;
export async function deviceId() {
  if (devId) return devId;
  devId = await db.getMeta('deviceId', null);
  if (!devId) {
    devId = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    await db.setMeta('deviceId', devId);
  }
  return devId;
}
