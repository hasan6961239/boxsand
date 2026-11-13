// IndexedDB wrapper. Media blobs live in their own store so listing the
// library never pulls megabytes of audio into memory.
const NAME = 'dandana';
const VERSION = 1;
let dbp;

export function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(NAME, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('art')) d.createObjectStore('art', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('playlists')) d.createObjectStore('playlists', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('history')) {
          const s = d.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
          s.createIndex('at', 'at');
        }
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
      };
      r.onsuccess = () => {
        const d = r.result;
        d.onversionchange = () => d.close();
        resolve(d);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('قاعدة البيانات مقفولة من نافذة أخرى'));
    });
  }
  return dbp;
}

const p = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('abort')); });

export async function get(store, key) {
  const d = await db();
  return p(d.transaction(store).objectStore(store).get(key));
}
export async function all(store) {
  const d = await db();
  return p(d.transaction(store).objectStore(store).getAll());
}
export async function put(store, value) {
  const d = await db();
  const tx = d.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}
export async function putMany(store, values) {
  const d = await db();
  const tx = d.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  for (const v of values) s.put(v);
  return done(tx);
}
export async function del(store, key) {
  const d = await db();
  const tx = d.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}
export async function clear(store) {
  const d = await db();
  const tx = d.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return done(tx);
}
/** Write several stores atomically: ops = [[store, value], ...] */
export async function putAtomic(ops) {
  const d = await db();
  const stores = [...new Set(ops.map((o) => o[0]))];
  const tx = d.transaction(stores, 'readwrite');
  for (const [s, v] of ops) tx.objectStore(s).put(v);
  return done(tx);
}
export async function historySince(ts) {
  const d = await db();
  const idx = d.transaction('history').objectStore('history').index('at');
  return p(idx.getAll(IDBKeyRange.lowerBound(ts)));
}

const kvCache = new Map();
export async function kvGet(k, def = null) {
  if (kvCache.has(k)) return kvCache.get(k);
  const r = await get('kv', k);
  const v = r ? r.v : def;
  kvCache.set(k, v);
  return v;
}
export async function kvSet(k, v) {
  kvCache.set(k, v);
  return put('kv', { k, v });
}
