import { createHash } from 'node:crypto';
import { getDatabase } from '../index.js';
import { nowIso } from '../../util/time.js';
import { uuid, token } from '../../util/id.js';

/**
 * API keys for the future CLI (`novahost deploy`).
 *
 * The table and this module exist now so adding the CLI later is additive
 * rather than a schema migration on a live install. Keys are stored hashed,
 * exactly like sessions, and the plaintext is shown once at creation.
 *
 * Format: nh_<prefix>_<secret>. The prefix is indexed so verification is a
 * single lookup rather than a scan-and-compare over every key.
 */
export function hashKey(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function createApiKey({ userId, name, scopes = 'deploy', expiresAt = null }) {
  const db = getDatabase();
  const id = uuid();
  const prefix = token(6).slice(0, 8);
  const secret = token(24);
  const plain = `nh_${prefix}_${secret}`;
  db.run(
    `INSERT INTO api_keys (id, user_id, name, prefix, key_hash, scopes, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, userId, name, prefix, hashKey(plain), scopes, expiresAt, nowIso(),
  );
  return { id, name, prefix, plaintext: plain };
}

export function findByPlaintext(plain) {
  const match = /^nh_([A-Za-z0-9_-]{1,16})_/.exec(String(plain ?? ''));
  if (!match) return undefined;
  const row = getDatabase().get(
    'SELECT * FROM api_keys WHERE prefix = ? AND revoked_at IS NULL',
    match[1],
  );
  if (!row) return undefined;
  if (row.key_hash !== hashKey(plain)) return undefined;
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return undefined;
  return row;
}

export function touchApiKey(id) {
  getDatabase().run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', nowIso(), id);
}

export function listApiKeys(userId) {
  return getDatabase().all(
    'SELECT id, name, prefix, scopes, last_used_at, expires_at, revoked_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
    userId,
  );
}

export function revokeApiKey(id, userId) {
  const result = getDatabase().run(
    'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    nowIso(), id, userId,
  );
  return result.changes > 0;
}
