import { errors } from '../errors.js';

/**
 * Fixed-window rate limiting, in memory.
 *
 * Why not in the database: a limiter must cost less than the request it is
 * protecting. A SQLite write per request would add flash wear on a phone for
 * no benefit. The trade-off is that counters reset when the process restarts —
 * acceptable, because the durable defence against password guessing is the
 * per-account lockout in the users table, which does survive a restart.
 */

const buckets = new Map();

export const LIMITS = {
  login: { windowMs: 15 * 60_000, max: 10 },
  setup: { windowMs: 60 * 60_000, max: 5 },
  upload: { windowMs: 60 * 60_000, max: 30 },
  write: { windowMs: 60_000, max: 120 },
  api: { windowMs: 60_000, max: 300 },
  site: { windowMs: 60_000, max: 600 },
};

function prune(now) {
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

let lastPrune = Date.now();

/**
 * Consume one unit from the bucket for `key` in class `name`.
 * Returns { allowed, remaining, retryAfter } — the caller decides whether to
 * throw, so a site request can be dropped quietly while an API call gets a 429.
 */
export function consume(name, key, { cost = 1 } = {}) {
  const limit = LIMITS[name] ?? LIMITS.api;
  const now = Date.now();

  // Sweep expired buckets at most once a minute so the map cannot grow forever
  // under a scan from many addresses.
  if (now - lastPrune > 60_000) {
    prune(now);
    lastPrune = now;
  }

  const bucketKey = `${name}:${key}`;
  let entry = buckets.get(bucketKey);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + limit.windowMs };
    buckets.set(bucketKey, entry);
  }

  entry.count += cost;
  const remaining = Math.max(limit.max - entry.count, 0);
  const allowed = entry.count <= limit.max;
  return {
    allowed,
    remaining,
    limit: limit.max,
    retryAfter: Math.max(Math.ceil((entry.resetAt - now) / 1000), 1),
  };
}

/** Throws a 429 when the caller is over the limit, and sets the usual headers. */
export function enforce(ctx, name, key = ctx.ip) {
  const result = consume(name, key);
  ctx.res.setHeader('X-RateLimit-Limit', String(result.limit));
  ctx.res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  if (!result.allowed) {
    throw errors.rateLimited('Too many requests — wait a moment and try again', result.retryAfter);
  }
  return result;
}

/** Undo a consumed unit, e.g. after a successful login. */
export function refund(name, key, amount = 1) {
  const entry = buckets.get(`${name}:${key}`);
  if (entry) entry.count = Math.max(entry.count - amount, 0);
}

export function resetAll() {
  buckets.clear();
}

export function snapshot() {
  return { buckets: buckets.size };
}
