import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(config.paths.db);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    phone     TEXT NOT NULL,
    role      TEXT NOT NULL,          -- 'user' | 'model'
    content   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone, id);

  CREATE TABLE IF NOT EXISTS reminders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,         -- who receives it
    text       TEXT NOT NULL,
    due_at     INTEGER NOT NULL,      -- epoch ms
    repeat     TEXT,                  -- null | 'daily' | 'weekly' | 'monthly'
    done       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(done, due_at);

  CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,
    text       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rate_limit (
    phone   TEXT NOT NULL,
    hour    INTEGER NOT NULL,         -- epoch hours
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (phone, hour)
  );
`);

export function recordMessage(phone, role, content) {
  db.prepare('INSERT INTO messages (phone, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(phone, role, content, Date.now());
}

export function recentMessages(phone, limit) {
  const rows = db
    .prepare('SELECT role, content FROM messages WHERE phone = ? ORDER BY id DESC LIMIT ?')
    .all(phone, limit);
  return rows.reverse();
}

export function clearHistory(phone) {
  return db.prepare('DELETE FROM messages WHERE phone = ?').run(phone).changes;
}

// Returns false when the caller has burned through their hourly allowance.
export function consumeRate(phone, limit) {
  const hour = Math.floor(Date.now() / 3_600_000);
  db.prepare(
    `INSERT INTO rate_limit (phone, hour, count) VALUES (?, ?, 1)
     ON CONFLICT(phone, hour) DO UPDATE SET count = count + 1`,
  ).run(phone, hour);
  const { count } = db
    .prepare('SELECT count FROM rate_limit WHERE phone = ? AND hour = ?')
    .get(phone, hour);
  return count <= limit;
}
