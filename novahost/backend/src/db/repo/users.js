import { getDatabase } from '../index.js';
import { nowIso } from '../../util/time.js';
import { uuid } from '../../util/id.js';

/** Shape a row for API output. The password hash never leaves this module. */
export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    displayName: row.display_name || row.username,
    locale: row.locale,
    theme: row.theme,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

export function countUsers() {
  return getDatabase().get('SELECT COUNT(*) AS c FROM users').c;
}

export function findById(id) {
  return getDatabase().get('SELECT * FROM users WHERE id = ?', id);
}

export function findByUsername(username) {
  return getDatabase().get('SELECT * FROM users WHERE username = ?', String(username).toLowerCase());
}

export function findByEmail(email) {
  return getDatabase().get('SELECT * FROM users WHERE email = ?', String(email).toLowerCase());
}

/** Login accepts either the username or the email in the same field. */
export function findByLogin(identifier) {
  const value = String(identifier ?? '').toLowerCase();
  return getDatabase().get(
    'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1',
    value,
    value,
  );
}

export function createUser({ username, email, passwordHash, role = 'admin', displayName = null, locale = 'ar', theme = 'dark' }) {
  const db = getDatabase();
  const id = uuid();
  const ts = nowIso();
  db.run(
    `INSERT INTO users (id, username, email, password_hash, role, display_name, locale, theme, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, String(username).toLowerCase(), String(email).toLowerCase(), passwordHash, role,
    displayName, locale, theme, ts, ts,
  );
  return findById(id);
}

export function updatePassword(id, passwordHash) {
  getDatabase().run(
    'UPDATE users SET password_hash = ?, updated_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?',
    passwordHash, nowIso(), id,
  );
}

export function updateProfile(id, { displayName, email, locale, theme }) {
  const db = getDatabase();
  const current = findById(id);
  if (!current) return null;
  db.run(
    `UPDATE users SET display_name = ?, email = ?, locale = ?, theme = ?, updated_at = ? WHERE id = ?`,
    displayName ?? current.display_name,
    (email ?? current.email).toLowerCase(),
    locale ?? current.locale,
    theme ?? current.theme,
    nowIso(),
    id,
  );
  return findById(id);
}

export function recordLoginSuccess(id) {
  getDatabase().run(
    'UPDATE users SET last_login_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?',
    nowIso(), id,
  );
}

/**
 * Register a failed attempt and return the new lock state.
 *
 * Backoff doubles from one minute and stops at fifteen, which makes online
 * guessing hopeless while never locking you out of your own server for long.
 * The counter lives in the database so a restart does not reset an attack.
 */
export function recordLoginFailure(id, { threshold = 5, baseMinutes = 1, maxMinutes = 15 } = {}) {
  const db = getDatabase();
  const user = findById(id);
  if (!user) return { locked: false, failedLogins: 0, lockedUntil: null };

  const failed = user.failed_logins + 1;
  let lockedUntil = null;
  if (failed >= threshold) {
    const over = failed - threshold;
    const minutes = Math.min(baseMinutes * 2 ** over, maxMinutes);
    lockedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
  }
  db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', failed, lockedUntil, id);
  return { locked: Boolean(lockedUntil), failedLogins: failed, lockedUntil };
}

export function listUsers() {
  return getDatabase().all('SELECT * FROM users ORDER BY created_at');
}
