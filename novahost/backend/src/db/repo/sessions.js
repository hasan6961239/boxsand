import { createHash } from 'node:crypto';
import { getDatabase } from '../index.js';
import { nowIso, isoPlusHours } from '../../util/time.js';
import { token as randomToken } from '../../util/id.js';

/**
 * The cookie value is never stored. We keep sha256(token) as the primary key,
 * so someone who walks away with novahost.db still cannot forge a live session.
 * SHA-256 is right here rather than a slow KDF: the token already has 256 bits
 * of entropy, so there is nothing to brute-force.
 */
export function hashToken(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function createSession({ userId, ip, userAgent, ttlHours }) {
  const db = getDatabase();
  const plain = randomToken(32);
  const id = hashToken(plain);
  const csrfToken = randomToken(24);
  const ts = nowIso();

  db.run(
    `INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, userId, csrfToken, ip ?? null, (userAgent ?? '').slice(0, 300), ts, ts, isoPlusHours(ttlHours),
  );

  return { token: plain, id, csrfToken, expiresAt: isoPlusHours(ttlHours) };
}

/** Look up a session by its cookie value, joined with the owning user. */
export function findByToken(plainToken) {
  if (!plainToken) return undefined;
  return getDatabase().get(
    `SELECT s.*, u.username, u.email, u.role, u.display_name, u.locale, u.theme
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    hashToken(plainToken),
  );
}

/**
 * Refresh last_seen_at, but only when it is more than five minutes stale.
 * Writing on every request would mean a database write per page load, which is
 * exactly the kind of needless flash wear worth avoiding on a phone.
 */
export function touch(sessionId, lastSeenAt) {
  const stale = !lastSeenAt || Date.now() - Date.parse(lastSeenAt) > 5 * 60_000;
  if (!stale) return;
  getDatabase().run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', nowIso(), sessionId);
}

export function destroy(sessionId) {
  getDatabase().run('DELETE FROM sessions WHERE id = ?', sessionId);
}

export function destroyByToken(plainToken) {
  if (!plainToken) return;
  destroy(hashToken(plainToken));
}

export function destroyAllForUser(userId, { exceptId = null } = {}) {
  const db = getDatabase();
  if (exceptId) db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, exceptId);
  else db.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function listForUser(userId) {
  return getDatabase().all(
    'SELECT id, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC',
    userId,
  );
}

export function pruneExpired() {
  const result = getDatabase().run('DELETE FROM sessions WHERE expires_at <= ?', nowIso());
  return result.changes;
}
