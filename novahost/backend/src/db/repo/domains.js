import { getDatabase } from '../index.js';
import { nowIso } from '../../util/time.js';
import { uuid, token } from '../../util/id.js';

export function mapDomain(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    projectSlug: row.project_slug ?? undefined,
    hostname: row.hostname,
    isPrimary: Boolean(row.is_primary),
    verified: Boolean(row.verified),
    verificationToken: row.verification_token,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}

export function createDomain({ projectId, hostname, isPrimary = false }) {
  const db = getDatabase();
  const id = uuid();
  db.run(
    `INSERT INTO domains (id, project_id, hostname, is_primary, verification_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id, projectId, hostname, isPrimary ? 1 : 0, `novahost-verify=${token(12)}`, nowIso(),
  );
  return findById(id);
}

export function findById(id) {
  return getDatabase().get('SELECT * FROM domains WHERE id = ?', id);
}

export function findByHostname(hostname) {
  return getDatabase().get(
    `SELECT d.*, p.slug AS project_slug FROM domains d
       JOIN projects p ON p.id = d.project_id
      WHERE d.hostname = ?`,
    String(hostname).toLowerCase(),
  );
}

export function listByProject(projectId) {
  return getDatabase().all('SELECT * FROM domains WHERE project_id = ? ORDER BY created_at', projectId);
}

export function listAll() {
  return getDatabase().all(
    `SELECT d.*, p.slug AS project_slug FROM domains d
       JOIN projects p ON p.id = d.project_id
      ORDER BY d.created_at DESC`,
  );
}

export function setVerified(id, verified) {
  getDatabase().run(
    'UPDATE domains SET verified = ?, verified_at = ? WHERE id = ?',
    verified ? 1 : 0, verified ? nowIso() : null, id,
  );
  return findById(id);
}

export function deleteDomain(id) {
  getDatabase().run('DELETE FROM domains WHERE id = ?', id);
}
