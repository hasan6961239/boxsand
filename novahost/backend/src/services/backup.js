import path from 'node:path';
import fsp from 'node:fs/promises';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { getDatabase, openDatabase, closeDatabase } from '../db/index.js';
import { AppError } from '../http/errors.js';
import { nowIso } from '../util/time.js';
import { shortId } from '../util/id.js';
import {
  ensureDir, removeRecursive, pathExists, readJson, writeJson, directorySize, safeJoin,
} from '../util/fsx.js';
import { writeZipFile, entriesFromDirectory } from './archive.js';
import { extractArchive } from './zip.js';
import * as storage from './storage.js';
import { reconcileCurrentPointers } from './deploy.js';

const log = createLogger('backup');

const MANIFEST_NAME = 'novahost-backup.json';
const DATABASE_NAME = 'database/novahost.db';
const SITES_PREFIX = 'sites';

function backupsDir() {
  return storage.paths.backups();
}

/**
 * Create a backup archive.
 *
 * The database is copied with VACUUM INTO rather than a file copy, because a
 * plain copy of a WAL-mode database while the server is running can produce a
 * file that will not open. That is the kind of thing you discover on the day
 * you need it, so it is worth the extra call.
 */
export async function createBackup({ includeSites = true, note = '' } = {}) {
  await ensureDir(backupsDir());

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const id = `backup-${stamp}-${shortId(4)}`;
  const staging = path.join(storage.paths.tmp(), id);
  const target = path.join(backupsDir(), `${id}.zip`);

  await ensureDir(path.join(staging, 'database'));

  const db = getDatabase();
  db.checkpoint();
  const dbCopy = path.join(staging, 'database', 'novahost.db');
  db.backupTo(dbCopy);

  const manifest = {
    format: 'novahost-backup/1',
    id,
    createdAt: nowIso(),
    appName: config.appName,
    includesSites: includeSites,
    note: String(note).slice(0, 500),
    databaseFile: DATABASE_NAME,
    sitesPrefix: includeSites ? SITES_PREFIX : null,
    counts: {
      projects: db.get('SELECT COUNT(*) AS c FROM projects').c,
      deployments: db.get('SELECT COUNT(*) AS c FROM deployments').c,
      users: db.get('SELECT COUNT(*) AS c FROM users').c,
    },
  };
  await writeJson(path.join(staging, MANIFEST_NAME), manifest);

  try {
    const entries = [
      { name: MANIFEST_NAME, file: path.join(staging, MANIFEST_NAME) },
      { name: DATABASE_NAME, file: dbCopy },
    ];

    if (includeSites && (await pathExists(storage.paths.sites()))) {
      entries.push(...await entriesFromDirectory(storage.paths.sites(), SITES_PREFIX));
    }

    const result = await writeZipFile(target, entries);
    log.info('backup created', { id, size: result.size, entries: result.entries });

    return {
      id,
      file: target,
      name: `${id}.zip`,
      size: result.size,
      createdAt: manifest.createdAt,
      includesSites: includeSites,
      counts: manifest.counts,
    };
  } finally {
    await removeRecursive(staging).catch(() => {});
  }
}

export async function listBackups() {
  await ensureDir(backupsDir());
  let names;
  try {
    names = await fsp.readdir(backupsDir());
  } catch {
    return [];
  }

  const out = [];
  for (const name of names) {
    if (!name.endsWith('.zip') || !name.startsWith('backup-')) continue;
    try {
      const stat = await fsp.stat(path.join(backupsDir(), name));
      out.push({
        id: name.replace(/\.zip$/, ''),
        name,
        size: stat.size,
        createdAt: new Date(stat.mtimeMs).toISOString(),
      });
    } catch { /* vanished between readdir and stat */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Resolve a backup id to a path, refusing anything that escapes the folder. */
export function backupPath(id) {
  if (!/^backup-[A-Za-z0-9-]+$/.test(String(id))) {
    throw new AppError('INVALID_BACKUP_ID', 'That backup id is not valid', { status: 400 });
  }
  return safeJoin(backupsDir(), `${id}.zip`);
}

export async function deleteBackup(id) {
  const file = backupPath(id);
  if (!(await pathExists(file))) {
    throw new AppError('BACKUP_NOT_FOUND', 'That backup no longer exists', { status: 404 });
  }
  await fsp.rm(file, { force: true });
  log.info('backup deleted', { id });
}

export async function backupsUsage() {
  return {
    bytes: await directorySize(backupsDir()),
    count: (await listBackups()).length,
  };
}

/**
 * Restore from a backup archive.
 *
 * This is the most destructive operation in the platform, so the order of
 * events is chosen so that every failure is recoverable:
 *
 *   1. Take a safety backup of the current state first. Always.
 *   2. Extract and validate the incoming archive before touching anything live.
 *   3. Move the current sites directory aside rather than deleting it.
 *   4. Swap the database, reopen it and run migrations.
 *   5. On any failure, put the old directories back.
 *
 * The caller is responsible for demanding an explicit confirmation from the
 * user before getting here.
 */
export async function restoreBackup({ archivePath, replaceSites = true }) {
  const staging = path.join(storage.paths.tmp(), `restore-${shortId(6)}`);
  const asideSuffix = `.pre-restore-${Date.now()}`;
  let safetyBackup = null;

  try {
    safetyBackup = await createBackup({ includeSites: true, note: 'Automatic safety copy taken before a restore' });
    log.info('safety backup taken before restore', { id: safetyBackup.id });
  } catch (err) {
    throw new AppError(
      'SAFETY_BACKUP_FAILED',
      `Refusing to restore: the safety backup of your current data failed (${err.message})`,
      { status: 500 },
    );
  }

  try {
    await removeRecursive(staging);
    await extractArchive(archivePath, staging, {
      stripRoot: false,
      limits: {
        maxEntries: 200_000,
        maxUncompressedBytes: 8 * 1024 * 1024 * 1024,
        maxSingleFileBytes: 2 * 1024 * 1024 * 1024,
        maxCompressionRatio: 5000,
      },
    });

    const manifest = await readJson(path.join(staging, MANIFEST_NAME), null);
    if (!manifest || manifest.format !== 'novahost-backup/1') {
      throw new AppError('INVALID_BACKUP', 'That file is not a NOVA HOST backup archive', { status: 422 });
    }

    const incomingDb = path.join(staging, DATABASE_NAME);
    if (!(await pathExists(incomingDb))) {
      throw new AppError('INVALID_BACKUP', 'The backup does not contain a database', { status: 422 });
    }

    // Open the incoming database on its own before trusting it, so a corrupt
    // file is rejected while the live one is still in place.
    const { createDriver } = await import('../db/driver.js');
    const probe = await createDriver(incomingDb);
    try {
      const row = probe.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='projects'").get();
      if (!row || row.c !== 1) {
        throw new AppError('INVALID_BACKUP', 'The backup database is missing the expected tables', { status: 422 });
      }
    } finally {
      probe.close();
    }

    const sitesSource = path.join(staging, SITES_PREFIX);
    const hasSites = await pathExists(sitesSource);
    const sitesTarget = storage.paths.sites();
    const sitesAside = `${sitesTarget}${asideSuffix}`;
    const dbAside = `${config.databasePath}${asideSuffix}`;

    closeDatabase();

    let movedSites = false;
    let movedDb = false;
    try {
      if (replaceSites && hasSites) {
        if (await pathExists(sitesTarget)) {
          await fsp.rename(sitesTarget, sitesAside);
          movedSites = true;
        }
        await fsp.rename(sitesSource, sitesTarget);
      }

      if (await pathExists(config.databasePath)) {
        await fsp.rename(config.databasePath, dbAside);
        movedDb = true;
      }
      // Stale WAL/SHM belong to the database we just moved away.
      await fsp.rm(`${config.databasePath}-wal`, { force: true });
      await fsp.rm(`${config.databasePath}-shm`, { force: true });
      await fsp.copyFile(incomingDb, config.databasePath);
    } catch (err) {
      log.error('restore failed mid-swap, rolling back', { error: err.message });
      if (movedDb) await fsp.rename(dbAside, config.databasePath).catch(() => {});
      if (movedSites) {
        await removeRecursive(sitesTarget).catch(() => {});
        await fsp.rename(sitesAside, sitesTarget).catch(() => {});
      }
      await openDatabase();
      throw new AppError('RESTORE_FAILED', `Restore failed and your data was put back: ${err.message}`, { status: 500 });
    }

    await openDatabase();
    await reconcileCurrentPointers();

    // The set-aside copies are kept: the safety backup covers a catastrophe,
    // but leaving these on disk means an immediate manual undo is possible.
    log.warn('restore completed', {
      backup: manifest.id,
      previousDatabase: path.basename(dbAside),
      previousSites: movedSites ? path.basename(sitesAside) : null,
    });

    return {
      restored: manifest,
      safetyBackupId: safetyBackup.id,
      previousDatabaseKeptAt: movedDb ? dbAside : null,
      previousSitesKeptAt: movedSites ? sitesAside : null,
    };
  } finally {
    await removeRecursive(staging).catch(() => {});
    await fsp.rm(archivePath, { force: true }).catch(() => {});
  }
}
