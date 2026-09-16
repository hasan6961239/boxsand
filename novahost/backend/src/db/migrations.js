import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso } from '../util/time.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Migrations are plain .sql files named `NNN_description.sql`.
 *
 * Rules that keep this boring, which is what you want from a migration system:
 *   * Never edit a migration that has shipped. Add a new one.
 *   * Each file runs inside a transaction; a failure leaves the schema untouched.
 *   * The version number is the filename prefix, so ordering is visible in `ls`.
 */
export function listMigrationFiles() {
  let names;
  try {
    names = fs.readdirSync(MIGRATIONS_DIR);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^\d{3}_.+\.sql$/.test(n))
    .sort()
    .map((name) => ({
      version: Number(name.slice(0, 3)),
      name,
      file: path.join(MIGRATIONS_DIR, name),
    }));
}

export function appliedMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  return db.all('SELECT version, name, applied_at FROM schema_migrations ORDER BY version');
}

export function runMigrations(db) {
  const already = new Set(appliedMigrations(db).map((row) => row.version));
  const applied = [];

  for (const migration of listMigrationFiles()) {
    if (already.has(migration.version)) continue;
    const sql = fs.readFileSync(migration.file, 'utf8');

    db.transaction(() => {
      db.exec(sql);
      db.run(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        migration.version,
        migration.name,
        nowIso(),
      );
    });

    applied.push(migration.name);
  }

  return applied;
}

/** Used by `npm run db:status` to show what is applied and what is pending. */
export function migrationStatus(db) {
  const applied = appliedMigrations(db);
  const appliedSet = new Set(applied.map((r) => r.version));
  const all = listMigrationFiles();
  return {
    applied,
    pending: all.filter((m) => !appliedSet.has(m.version)).map((m) => m.name),
    total: all.length,
  };
}
