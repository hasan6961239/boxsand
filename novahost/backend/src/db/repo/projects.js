import { getDatabase } from '../index.js';
import { nowIso } from '../../util/time.js';
import { uuid } from '../../util/id.js';
import { sortColumn, sortDirection } from '../../util/validate.js';

/** Columns a client may sort by. User input selects a key, never raw SQL. */
const SORTABLE = {
  updated: 'p.updated_at',
  created: 'p.created_at',
  name: 'p.name',
  size: 'p.storage_bytes',
  deployed: 'p.last_deployed_at',
};

export function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    framework: row.framework,
    buildType: row.build_type,
    status: row.status,
    enabled: Boolean(row.enabled),
    currentDeploymentId: row.current_deployment_id,
    deploymentCounter: row.deployment_counter,
    storageBytes: row.storage_bytes,
    fileCount: row.file_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastDeployedAt: row.last_deployed_at,
    deploymentCount: row.deployment_count ?? undefined,
  };
}

export function slugTaken(slug) {
  return Boolean(getDatabase().get('SELECT 1 AS x FROM projects WHERE slug = ?', slug));
}

export function createProject({ slug, name, description = '', visibility = 'public', framework = 'static', buildType = 'none', ownerId = null }) {
  const db = getDatabase();
  const id = uuid();
  const ts = nowIso();
  db.run(
    `INSERT INTO projects (id, slug, name, description, visibility, framework, build_type, status, owner_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'empty', ?, ?, ?)`,
    id, slug, name, description, visibility, framework, buildType, ownerId, ts, ts,
  );
  return findById(id);
}

export function findById(id) {
  return getDatabase().get('SELECT * FROM projects WHERE id = ?', id);
}

export function findBySlug(slug) {
  return getDatabase().get('SELECT * FROM projects WHERE slug = ?', String(slug).toLowerCase());
}

export function listProjects({ search = '', limit = 100, offset = 0, sort = 'updated', dir = 'desc', visibility = null } = {}) {
  const db = getDatabase();
  const column = sortColumn(sort, SORTABLE, 'updated');
  const direction = sortDirection(dir);

  const where = [];
  const params = [];
  if (search) {
    where.push('(p.name LIKE ? OR p.slug LIKE ? OR p.description LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (visibility) {
    where.push('p.visibility = ?');
    params.push(visibility);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // The ORDER BY fragment is built from SORTABLE, never from the request.
  const rows = db.all(
    `SELECT p.*, (SELECT COUNT(*) FROM deployments d WHERE d.project_id = p.id) AS deployment_count
       FROM projects p
       ${whereSql}
       ORDER BY ${column} ${direction}
       LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );

  const total = db.get(`SELECT COUNT(*) AS c FROM projects p ${whereSql}`, ...params).c;
  return { items: rows, total };
}

export function updateProject(id, fields) {
  const db = getDatabase();
  const current = findById(id);
  if (!current) return null;
  db.run(
    `UPDATE projects
        SET name = ?, description = ?, visibility = ?, framework = ?, build_type = ?, enabled = ?, updated_at = ?
      WHERE id = ?`,
    fields.name ?? current.name,
    fields.description ?? current.description,
    fields.visibility ?? current.visibility,
    fields.framework ?? current.framework,
    fields.buildType ?? current.build_type,
    fields.enabled === undefined ? current.enabled : (fields.enabled ? 1 : 0),
    nowIso(),
    id,
  );
  return findById(id);
}

export function renameSlug(id, slug) {
  getDatabase().run('UPDATE projects SET slug = ?, updated_at = ? WHERE id = ?', slug, nowIso(), id);
  return findById(id);
}

/**
 * Allocate the next deployment number for a project.
 * Doing it with a single UPDATE ... RETURNING keeps it atomic: two concurrent
 * deploys cannot be handed the same number.
 */
export function nextDeploymentNumber(id) {
  const db = getDatabase();
  const row = db.get(
    'UPDATE projects SET deployment_counter = deployment_counter + 1 WHERE id = ? RETURNING deployment_counter',
    id,
  );
  return row?.deployment_counter ?? 1;
}

export function setCurrentDeployment(id, deploymentId, { status = 'ready', fileCount = null, storageBytes = null } = {}) {
  const db = getDatabase();
  const ts = nowIso();
  db.run(
    `UPDATE projects
        SET current_deployment_id = ?, status = ?, last_deployed_at = ?, updated_at = ?,
            file_count = COALESCE(?, file_count), storage_bytes = COALESCE(?, storage_bytes)
      WHERE id = ?`,
    deploymentId, status, ts, ts, fileCount, storageBytes, id,
  );
  return findById(id);
}

export function setStatus(id, status) {
  getDatabase().run('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
}

export function setEnabled(id, enabled) {
  getDatabase().run('UPDATE projects SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, nowIso(), id);
  return findById(id);
}

export function updateStorage(id, { storageBytes, fileCount }) {
  getDatabase().run(
    'UPDATE projects SET storage_bytes = ?, file_count = ?, updated_at = ? WHERE id = ?',
    storageBytes, fileCount, nowIso(), id,
  );
}

export function deleteProject(id) {
  // Deployments, domains and logs disappear via ON DELETE CASCADE.
  getDatabase().run('DELETE FROM projects WHERE id = ?', id);
}

export function totals() {
  const db = getDatabase();
  return {
    projects: db.get('SELECT COUNT(*) AS c FROM projects').c,
    published: db.get("SELECT COUNT(*) AS c FROM projects WHERE current_deployment_id IS NOT NULL AND enabled = 1").c,
    storageBytes: db.get('SELECT COALESCE(SUM(storage_bytes), 0) AS s FROM projects').s,
    files: db.get('SELECT COALESCE(SUM(file_count), 0) AS s FROM projects').s,
  };
}
