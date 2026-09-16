/**
 * SQLite driver abstraction.
 *
 * Two backends, one interface:
 *
 *   1. node:sqlite  — built into Node 22.5+ (release candidate in Node 24).
 *      This is the default and the reason the project needs no `npm install`
 *      on the phone: no node-gyp, no clang, no twenty-minute build that fails
 *      at the end.
 *
 *   2. better-sqlite3 — used automatically when it happens to be installed,
 *      which is handy on a laptop where a native build is cheap.
 *
 * The two APIs are close enough that a thin shim covers the difference. The one
 * real incompatibility is parameter binding, so every query in this project uses
 * positional `?` parameters, never named ones.
 */

/**
 * Normalise a JS value into something SQLite can bind.
 * Both drivers reject booleans, undefined and Date objects outright, and a
 * TypeError from deep inside a statement is a miserable thing to debug — so
 * convert here, once, for every query in the codebase.
 */
function bindValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return value;
  // Objects and arrays are a caller bug: JSON-encode explicitly at the call site.
  throw new TypeError(`Cannot bind value of type ${typeof value} to a SQL parameter`);
}

function bindAll(params) {
  return params.map(bindValue);
}

/** Row ids come back as number or bigint depending on backend and magnitude. */
function toNumber(value) {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  }
  return value;
}

function wrapStatement(stmt) {
  return {
    run(...params) {
      const result = stmt.run(...bindAll(params));
      return {
        changes: toNumber(result?.changes ?? 0),
        lastInsertRowid: toNumber(result?.lastInsertRowid ?? 0),
      };
    },
    get(...params) {
      return stmt.get(...bindAll(params)) ?? undefined;
    },
    all(...params) {
      return stmt.all(...bindAll(params)) ?? [];
    },
  };
}

async function openNodeSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  return {
    name: 'node:sqlite',
    prepare: (sql) => wrapStatement(db.prepare(sql)),
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
    raw: db,
  };
}

async function openBetterSqlite(file) {
  const mod = await import('better-sqlite3');
  const Database = mod.default ?? mod;
  const db = new Database(file);
  return {
    name: 'better-sqlite3',
    prepare: (sql) => wrapStatement(db.prepare(sql)),
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
    raw: db,
  };
}

/**
 * Open a database file, preferring the built-in driver.
 * `preferred` exists so the test suite can pin a backend explicitly.
 */
export async function createDriver(file, { preferred = process.env.NOVAHOST_SQLITE_DRIVER } = {}) {
  const order = preferred === 'better-sqlite3'
    ? [openBetterSqlite, openNodeSqlite]
    : [openNodeSqlite, openBetterSqlite];

  const failures = [];
  for (const open of order) {
    try {
      return await open(file);
    } catch (err) {
      failures.push(err);
    }
  }

  const detail = failures.map((e) => `  - ${e.message}`).join('\n');
  throw new Error(
    'No SQLite driver is available.\n' +
    `${detail}\n\n` +
    'Fix it with one of:\n' +
    '  * Use Node.js 24 or newer (it ships node:sqlite built in) — on Termux: pkg install nodejs\n' +
    '  * On Node 22.5-23.3, start the server with: node --experimental-sqlite backend/src/server.js\n' +
    '  * Or install the native driver: npm install better-sqlite3',
  );
}
