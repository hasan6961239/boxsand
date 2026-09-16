import { getDatabase } from '../index.js';
import { nowIso } from '../../util/time.js';

export const STATUS = {
  QUEUED: 'QUEUED',
  BUILDING: 'BUILDING',
  DEPLOYING: 'DEPLOYING',
  READY: 'READY',
  FAILED: 'FAILED',
  SUPERSEDED: 'SUPERSEDED',
};

export function mapDeployment(row, { currentDeploymentId = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    projectSlug: row.project_slug ?? undefined,
    projectName: row.project_name ?? undefined,
    number: row.number,
    status: row.status,
    source: row.source,
    message: row.message,
    fileCount: row.file_count,
    totalBytes: row.total_bytes,
    zipBytes: row.zip_bytes,
    entryFile: row.entry_file,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    rolledFrom: row.rolled_from,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    isCurrent: currentDeploymentId ? row.id === currentDeploymentId : undefined,
  };
}

export function createDeployment({ id, projectId, number, source = 'zip', message = '', createdBy = null, zipBytes = 0, rolledFrom = null }) {
  const db = getDatabase();
  db.run(
    `INSERT INTO deployments (id, project_id, number, status, source, message, zip_bytes, rolled_from, created_by, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, projectId, number, STATUS.QUEUED, source, message, zipBytes, rolledFrom, createdBy, nowIso(),
  );
  return findById(id);
}

export function findById(id) {
  return getDatabase().get('SELECT * FROM deployments WHERE id = ?', id);
}

export function findByNumber(projectId, number) {
  return getDatabase().get('SELECT * FROM deployments WHERE project_id = ? AND number = ?', projectId, number);
}

export function setStatus(id, status) {
  getDatabase().run('UPDATE deployments SET status = ? WHERE id = ?', status, id);
}

export function markReady(id, { fileCount, totalBytes, entryFile }) {
  const db = getDatabase();
  const row = findById(id);
  const finishedAt = nowIso();
  const duration = row ? Date.parse(finishedAt) - Date.parse(row.started_at) : null;
  db.run(
    `UPDATE deployments
        SET status = ?, file_count = ?, total_bytes = ?, entry_file = ?, finished_at = ?, duration_ms = ?,
            error_code = NULL, error_message = NULL
      WHERE id = ?`,
    STATUS.READY, fileCount, totalBytes, entryFile, finishedAt, duration, id,
  );
  return findById(id);
}

export function markFailed(id, { code, message }) {
  const db = getDatabase();
  const row = findById(id);
  const finishedAt = nowIso();
  const duration = row ? Date.parse(finishedAt) - Date.parse(row.started_at) : null;
  db.run(
    `UPDATE deployments SET status = ?, error_code = ?, error_message = ?, finished_at = ?, duration_ms = ? WHERE id = ?`,
    STATUS.FAILED, code, String(message ?? '').slice(0, 1000), finishedAt, duration, id,
  );
  return findById(id);
}

export function listByProject(projectId, { limit = 50, offset = 0 } = {}) {
  const db = getDatabase();
  const items = db.all(
    'SELECT * FROM deployments WHERE project_id = ? ORDER BY number DESC LIMIT ? OFFSET ?',
    projectId, limit, offset,
  );
  const total = db.get('SELECT COUNT(*) AS c FROM deployments WHERE project_id = ?', projectId).c;
  return { items, total };
}

/** Recent deployments across every project, for the dashboard home. */
export function listRecent({ limit = 20, status = null } = {}) {
  const db = getDatabase();
  const where = status ? 'WHERE d.status = ?' : '';
  const params = status ? [status] : [];
  return db.all(
    `SELECT d.*, p.slug AS project_slug, p.name AS project_name
       FROM deployments d
       JOIN projects p ON p.id = d.project_id
       ${where}
       ORDER BY d.started_at DESC
       LIMIT ?`,
    ...params, limit,
  );
}

/**
 * Deployment ids eligible for pruning: keep the newest `keep`, and never touch
 * the one currently serving traffic even if it has aged out of that window.
 */
export function prunableDeployments(projectId, keep, currentDeploymentId) {
  return getDatabase().all(
    `SELECT id FROM deployments
      WHERE project_id = ?
        AND id != COALESCE(?, '')
        AND id NOT IN (
          SELECT id FROM deployments WHERE project_id = ? ORDER BY number DESC LIMIT ?
        )
      ORDER BY number ASC`,
    projectId, currentDeploymentId, projectId, keep,
  ).map((r) => r.id);
}

export function deleteDeployment(id) {
  getDatabase().run('DELETE FROM deployments WHERE id = ?', id);
}

export function totals() {
  const db = getDatabase();
  return {
    total: db.get('SELECT COUNT(*) AS c FROM deployments').c,
    ready: db.get("SELECT COUNT(*) AS c FROM deployments WHERE status = 'READY'").c,
    failed: db.get("SELECT COUNT(*) AS c FROM deployments WHERE status = 'FAILED'").c,
    last: db.get("SELECT d.*, p.slug AS project_slug, p.name AS project_name FROM deployments d JOIN projects p ON p.id = d.project_id ORDER BY d.started_at DESC LIMIT 1"),
  };
}

/** Deployments stuck mid-flight because the process died — reconciled at boot. */
export function findInterrupted() {
  return getDatabase().all(
    "SELECT * FROM deployments WHERE status IN ('QUEUED', 'BUILDING', 'DEPLOYING')",
  );
}
