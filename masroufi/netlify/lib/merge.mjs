// Pure sync logic for /api/sync. The server keeps one document per user:
//   { rev, recs: { [id]: record + _r } }
// where `rev` increases by one on every request that changes something and
// `_r` is the revision at which a record was last accepted. A client sends
// its unsynced records plus the last `rev` it saw (`since`) and gets back
// every record accepted after that — one round trip pushes and pulls.

export const COLLECTIONS = new Set(['txn', 'cat', 'person', 'debt', 'pay', 'goal', 'gtx', 'rule', 'budget', 'nlog', 'settings']);
export const MAX_CHANGES = 5000;
const MAX_RECORD_BYTES = 16 * 1024;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Validate and clean incoming records (drop client-only fields). */
export function sanitize(changes) {
  if (changes === undefined) return [];
  if (!Array.isArray(changes)) throw new HttpError(400, 'changes must be an array');
  if (changes.length > MAX_CHANGES) throw new HttpError(413, `too many changes (max ${MAX_CHANGES})`);
  return changes.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new HttpError(400, `change ${i}: not an object`);
    if (typeof r.id !== 'string' || !r.id || r.id.length > 200) throw new HttpError(400, `change ${i}: bad id`);
    if (!COLLECTIONS.has(r.col)) throw new HttpError(400, `change ${i}: bad col`);
    if (typeof r.u !== 'number' || !Number.isFinite(r.u) || r.u < 0) throw new HttpError(400, `change ${i}: bad u`);
    const { dirty, _r, ...rest } = r;
    if (JSON.stringify(rest).length > MAX_RECORD_BYTES) throw new HttpError(413, `change ${i}: record too large`);
    return rest;
  });
}

/**
 * Merge `changes` into `doc` (null for a new user) — last writer wins per
 * record by `u`, ties keep what the server has. Returns the next document,
 * whether it changed, and the records the client must apply.
 */
export function merge(doc, changes, since) {
  const cur = doc && typeof doc === 'object' && doc.recs ? doc : { rev: 0, recs: {} };
  const rev = cur.rev + 1;
  const recs = { ...cur.recs };
  let changed = false;
  for (const r of changes) {
    const ex = recs[r.id];
    if (!ex || r.u > (ex.u || 0)) {
      recs[r.id] = { ...r, _r: rev };
      changed = true;
    }
  }
  const next = changed ? { rev, recs } : cur;
  const s = Number.isFinite(since) && since >= 0 && since <= next.rev ? since : 0; // since > rev: server was reset → send all
  const out = [];
  for (const r of Object.values(next.recs)) {
    if (r._r > s) {
      const { _r, ...rest } = r;
      out.push(rest);
    }
  }
  return { doc: next, changed, rev: next.rev, changes: out };
}
