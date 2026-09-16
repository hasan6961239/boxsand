import path from 'node:path';
import fs from 'node:fs';
import { createDriver } from './driver.js';
import { runMigrations } from './migrations.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { ensureDirSync } from '../util/fsx.js';

const log = createLogger('db');

let instance = null;

/**
 * Wraps a driver with the things every query path needs: a prepared-statement
 * cache, nested-safe transactions, and an online backup.
 */
function createDatabase(driver) {
  const cache = new Map();
  let txDepth = 0;

  function prepare(sql) {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = driver.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  }

  const api = {
    driverName: driver.name,

    run: (sql, ...params) => prepare(sql).run(...params),
    get: (sql, ...params) => prepare(sql).get(...params),
    all: (sql, ...params) => prepare(sql).all(...params),
    exec: (sql) => driver.exec(sql),
    prepare,

    /**
     * Run `fn` inside a transaction. Nested calls use SAVEPOINTs so a service
     * that already holds a transaction can call another one without either
     * needing to know about the other.
     *
     * SQLite is synchronous here, so `fn` must be synchronous too: an `await`
     * inside a transaction would let another request interleave and commit
     * someone else's half-finished work. Any long-running I/O (unzipping,
     * hashing) happens outside the transaction by design.
     */
    transaction(fn) {
      const depth = txDepth;
      const name = `sp_${depth}`;
      if (depth === 0) driver.exec('BEGIN IMMEDIATE');
      else driver.exec(`SAVEPOINT ${name}`);
      txDepth = depth + 1;
      try {
        const result = fn();
        if (result && typeof result.then === 'function') {
          throw new TypeError('transaction() callbacks must be synchronous');
        }
        if (depth === 0) driver.exec('COMMIT');
        else driver.exec(`RELEASE ${name}`);
        txDepth = depth;
        return result;
      } catch (err) {
        try {
          if (depth === 0) driver.exec('ROLLBACK');
          else driver.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        } catch (rollbackErr) {
          log.error('rollback failed', { error: rollbackErr.message });
        }
        txDepth = depth;
        throw err;
      }
    },

    /**
     * Consistent copy of a live database.
     *
     * VACUUM INTO is the supported way to do this while the server is running:
     * it produces a defragmented, fully-consistent file without stopping writes.
     * Copying novahost.db with `cp` while WAL mode is active can yield a corrupt
     * backup, which is exactly the kind of surprise you find out about on the
     * day you need the backup.
     */
    backupTo(targetFile) {
      ensureDirSync(path.dirname(targetFile));
      fs.rmSync(targetFile, { force: true });
      // The path is built by the server, never by a request, but quote it
      // properly anyway so a directory name with an apostrophe cannot break it.
      const quoted = targetFile.replace(/'/g, "''");
      driver.exec(`VACUUM INTO '${quoted}'`);
      return targetFile;
    },

    /** Flush the WAL into the main file — called before shutdown and backups. */
    checkpoint() {
      try {
        driver.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (err) {
        log.warn('wal checkpoint failed', { error: err.message });
      }
    },

    close() {
      try {
        api.checkpoint();
      } catch { /* closing anyway */ }
      cache.clear();
      driver.close();
    },
  };

  return api;
}

/**
 * Open (or create) the database, apply pragmas and run migrations.
 * Idempotent: repeated calls return the same instance.
 */
export async function openDatabase({ file = config.databasePath, migrate = true } = {}) {
  if (instance) return instance;

  if (file !== ':memory:') ensureDirSync(path.dirname(file));

  const driver = await createDriver(file);
  const db = createDatabase(driver);

  // WAL lets reads proceed during a write, which matters because serving a site
  // must never block behind a deployment.
  // synchronous=NORMAL trades "lose the last transaction on sudden power loss"
  // for far fewer flash writes. With WAL it does not risk corruption, and a
  // phone with a 5000 mAh battery does not lose power suddenly.
  if (file !== ':memory:') driver.exec('PRAGMA journal_mode = WAL');
  driver.exec('PRAGMA synchronous = NORMAL');
  driver.exec('PRAGMA foreign_keys = ON');
  driver.exec('PRAGMA busy_timeout = 5000');
  driver.exec('PRAGMA temp_store = MEMORY');
  // Cap the page cache at ~8 MB. The default is generous for a server and
  // wasteful on a phone that is also running a launcher and a messaging app.
  driver.exec('PRAGMA cache_size = -8000');

  if (migrate) {
    const applied = runMigrations(db);
    if (applied.length) log.info('migrations applied', { migrations: applied });
  }

  log.info('database ready', { driver: driver.name, file: file === ':memory:' ? ':memory:' : path.basename(file) });

  instance = db;
  return db;
}

/** The open database. Throws if called before openDatabase(). */
export function getDatabase() {
  if (!instance) throw new Error('Database is not open yet — call openDatabase() first');
  return instance;
}

export function closeDatabase() {
  if (!instance) return;
  instance.close();
  instance = null;
}
