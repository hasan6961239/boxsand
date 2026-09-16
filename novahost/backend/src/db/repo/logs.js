import { getDatabase } from '../index.js';
import { isoMinusDays } from '../../util/time.js';

export function mapLog(row) {
  if (!row) return null;
  let meta = null;
  if (row.meta) {
    try { meta = JSON.parse(row.meta); } catch { meta = { raw: row.meta }; }
  }
  return {
    id: row.id,
    ts: row.ts,
    level: row.level,
    module: row.module,
    message: row.message,
    projectId: row.project_id,
    deploymentId: row.deployment_id,
    projectSlug: row.project_slug ?? undefined,
    meta,
  };
}

export function insertLog({ ts, level, module, message, projectId = null, deploymentId = null, meta = null }) {
  getDatabase().run(
    'INSERT INTO logs (ts, level, module, message, project_id, deployment_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ts, level, module, String(message).slice(0, 2000), projectId, deploymentId, meta,
  );
}

/** Deployment logs read oldest-first: they are a transcript, not a feed. */
export function listByDeployment(deploymentId, { limit = 500 } = {}) {
  return getDatabase().all(
    'SELECT * FROM logs WHERE deployment_id = ? ORDER BY id ASC LIMIT ?',
    deploymentId, limit,
  );
}

export function listLogs({ level = null, projectId = null, search = '', limit = 200, offset = 0 } = {}) {
  const db = getDatabase();
  const where = [];
  const params = [];
  if (level) {
    where.push('l.level = ?');
    params.push(level);
  }
  if (projectId) {
    where.push('l.project_id = ?');
    params.push(projectId);
  }
  if (search) {
    where.push('(l.message LIKE ? OR l.module LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const items = db.all(
    `SELECT l.*, p.slug AS project_slug
       FROM logs l
       LEFT JOIN projects p ON p.id = l.project_id
       ${whereSql}
       ORDER BY l.id DESC
       LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  const total = db.get(`SELECT COUNT(*) AS c FROM logs l ${whereSql}`, ...params).c;
  return { items, total };
}

export function countByLevel() {
  const rows = getDatabase().all('SELECT level, COUNT(*) AS c FROM logs GROUP BY level');
  const out = { debug: 0, info: 0, warn: 0, error: 0 };
  for (const row of rows) out[row.level] = row.c;
  return out;
}

export function pruneLogs(days) {
  const result = getDatabase().run('DELETE FROM logs WHERE ts < ?', isoMinusDays(days));
  return result.changes;
}

export function clearLogs({ projectId = null } = {}) {
  const db = getDatabase();
  const result = projectId
    ? db.run('DELETE FROM logs WHERE project_id = ?', projectId)
    : db.run('DELETE FROM logs');
  return result.changes;
}

export function storageBytes() {
  // An estimate, not a measurement: SQLite does not expose per-table size
  // without the dbstat virtual table, which is not compiled in everywhere.
  const row = getDatabase().get(
    'SELECT COUNT(*) AS c, COALESCE(SUM(LENGTH(message) + LENGTH(COALESCE(meta, \'\')) + 120), 0) AS bytes FROM logs',
  );
  return { count: row.c, bytes: row.bytes };
}
