// Thin IndexedDB layer: one 'records' store for every synced record and a
// 'meta' store for device-local values (sync cursor, device id, …).
// Falls back to memory if IndexedDB is unavailable, so the app still opens.

const DB_NAME = 'masroufi';
const VERSION = 1;

let dbp = null;
let memory = null; // fallback { records: Map, meta: Map }

function req(r) {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let r;
    try {
      r = indexedDB.open(DB_NAME, VERSION);
    } catch {
      resolve(null);
      return;
    }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) {
    memory ||= { records: new Map(), meta: new Map() };
    return fn(null, memory[store]);
  }
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s, null)).then((v) => { out = v; }, reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const available = async () => Boolean(await open());

export function allRecords() {
  return tx('records', 'readonly', (s, mem) => (mem ? [...mem.values()] : req(s.getAll())));
}

export function putRecords(list) {
  if (!list.length) return Promise.resolve();
  return tx('records', 'readwrite', (s, mem) => {
    for (const r of list) mem ? mem.set(r.id, r) : s.put(r);
  });
}

export function clearRecords() {
  return tx('records', 'readwrite', (s, mem) => (mem ? mem.clear() : req(s.clear())));
}

export async function getMeta(k, fallback = null) {
  const row = await tx('meta', 'readonly', (s, mem) => (mem ? mem.get(k) : req(s.get(k))));
  return row ? row.v : fallback;
}

export function setMeta(k, v) {
  return tx('meta', 'readwrite', (s, mem) => (mem ? mem.set(k, { k, v }) : s.put({ k, v })));
}

export function clearMeta() {
  return tx('meta', 'readwrite', (s, mem) => (mem ? mem.clear() : req(s.clear())));
}

/** Ask the browser not to evict our data under storage pressure. */
export async function persist() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* not supported */ }
}
