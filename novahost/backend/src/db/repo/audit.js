import { getDatabase } from '../index.js';
import { nowIso, isoMinusDays } from '../../util/time.js';

export function mapAudit(row) {
  if (!row) return null;
  let meta = null;
  if (row.meta) {
    try { meta = JSON.parse(row.meta); } catch { meta = null; }
  }
  return {
    id: row.id,
    ts: row.ts,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_name,
    ip: row.ip,
    meta,
  };
}

/**
 * Record an action. Never pass secrets in `meta` — this table is displayed in
 * the dashboard and included in backups.
 */
export function record({ actorId = null, actorName = null, action, targetType = null, targetId = null, targetName = null, ip = null, meta = null }) {
  getDatabase().run(
    `INSERT INTO audit_log (ts, actor_id, actor_name, action, target_type, target_id, target_name, ip, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    nowIso(), actorId, actorName, action, targetType, targetId, targetName, ip,
    meta ? JSON.stringify(meta) : null,
  );
}

export function listAudit({ limit = 100, offset = 0, action = null } = {}) {
  const db = getDatabase();
  const where = action ? 'WHERE action = ?' : '';
  const params = action ? [action] : [];
  const items = db.all(
    `SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  const total = db.get(`SELECT COUNT(*) AS c FROM audit_log ${where}`, ...params).c;
  return { items, total };
}

export function recordSecurityEvent({ type, username = null, ip = null, userAgent = null, detail = null }) {
  getDatabase().run(
    'INSERT INTO security_events (ts, type, username, ip, user_agent, detail) VALUES (?, ?, ?, ?, ?, ?)',
    nowIso(), type, username, ip, String(userAgent ?? '').slice(0, 300), detail,
  );
}

export function listSecurityEvents({ limit = 100, offset = 0, type = null } = {}) {
  const db = getDatabase();
  const where = type ? 'WHERE type = ?' : '';
  const params = type ? [type] : [];
  const items = db.all(
    `SELECT * FROM security_events ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  const total = db.get(`SELECT COUNT(*) AS c FROM security_events ${where}`, ...params).c;
  return { items, total };
}

export function pruneSecurityEvents(days) {
  return getDatabase().run('DELETE FROM security_events WHERE ts < ?', isoMinusDays(days)).changes;
}

export function pruneAudit(days) {
  return getDatabase().run('DELETE FROM audit_log WHERE ts < ?', isoMinusDays(days)).changes;
}
