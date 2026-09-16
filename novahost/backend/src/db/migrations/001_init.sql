-- NOVA HOST — initial schema.
-- Design notes:
--   * All ids are text (UUID v4 or prefixed slugs) so rows stay portable between
--     machines and survive backup/restore without renumbering.
--   * Timestamps are stored as ISO-8601 UTC strings. SQLite has no date type and
--     ISO strings sort correctly, compare correctly, and survive a raw file copy.
--   * Booleans are stored as 0/1 integers (SQLite has no boolean type).
--   * File contents are NOT stored here. Disk is the source of truth for site
--     files; the database only holds metadata and counters. See docs/DATABASE.md.

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'admin',
  display_name   TEXT,
  locale         TEXT NOT NULL DEFAULT 'ar',
  theme          TEXT NOT NULL DEFAULT 'dark',
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  last_login_at  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- The session id stored here is a SHA-256 hash of the cookie value, never the
-- value itself: a stolen database file does not hand over live sessions.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE projects (
  id                    TEXT PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  visibility            TEXT NOT NULL DEFAULT 'public',   -- public | private
  framework             TEXT NOT NULL DEFAULT 'static',
  build_type            TEXT NOT NULL DEFAULT 'none',
  status                TEXT NOT NULL DEFAULT 'empty',    -- empty|ready|failed|stopped
  enabled               INTEGER NOT NULL DEFAULT 1,       -- 0 = site returns 503
  current_deployment_id TEXT,
  deployment_counter    INTEGER NOT NULL DEFAULT 0,
  storage_bytes         INTEGER NOT NULL DEFAULT 0,
  file_count            INTEGER NOT NULL DEFAULT 0,
  owner_id              TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  last_deployed_at      TEXT
);
CREATE INDEX idx_projects_updated ON projects(updated_at DESC);

CREATE TABLE deployments (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number        INTEGER NOT NULL,
  status        TEXT NOT NULL,       -- QUEUED|BUILDING|DEPLOYING|READY|FAILED|SUPERSEDED
  source        TEXT NOT NULL DEFAULT 'zip',  -- zip|files|editor|rollback
  message       TEXT NOT NULL DEFAULT '',
  file_count    INTEGER NOT NULL DEFAULT 0,
  total_bytes   INTEGER NOT NULL DEFAULT 0,
  zip_bytes     INTEGER NOT NULL DEFAULT 0,
  entry_file    TEXT,                -- detected entry, normally index.html
  error_code    TEXT,
  error_message TEXT,
  rolled_from   TEXT,                -- deployment id this one was copied from
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  duration_ms   INTEGER,
  UNIQUE (project_id, number)
);
CREATE INDEX idx_deployments_project ON deployments(project_id, number DESC);
CREATE INDEX idx_deployments_started ON deployments(started_at DESC);

CREATE TABLE domains (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hostname           TEXT NOT NULL UNIQUE,
  is_primary         INTEGER NOT NULL DEFAULT 0,
  verified           INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT NOT NULL,
  verified_at        TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX idx_domains_project ON domains(project_id);

-- Application + deployment logs shown in the dashboard. Pruned by retention.
CREATE TABLE logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  level         TEXT NOT NULL,      -- debug|info|warn|error
  module        TEXT NOT NULL,
  message       TEXT NOT NULL,
  project_id    TEXT,
  deployment_id TEXT,
  meta          TEXT                -- JSON string or NULL
);
CREATE INDEX idx_logs_ts ON logs(ts DESC);
CREATE INDEX idx_logs_deployment ON logs(deployment_id, id);
CREATE INDEX idx_logs_project ON logs(project_id, id DESC);

-- Who did what, when. Never contains passwords, tokens or file contents.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  actor_id    TEXT,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  target_name TEXT,
  ip          TEXT,
  meta        TEXT
);
CREATE INDEX idx_audit_ts ON audit_log(ts DESC);

-- Authentication outcomes, kept separate from audit so they can be rate-limited
-- and retained on a different schedule.
CREATE TABLE security_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  type       TEXT NOT NULL,   -- login_success|login_failed|logout|lockout|setup
  username   TEXT,
  ip         TEXT,
  user_agent TEXT,
  detail     TEXT
);
CREATE INDEX idx_security_ts ON security_events(ts DESC);

-- Runtime-tunable settings. Values are JSON-encoded so types survive round-trip.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Reserved for the future CLI / CI integration (phase 2). Created now so the
-- schema does not need a breaking migration later.
CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL,
  scopes       TEXT NOT NULL DEFAULT 'deploy',
  last_used_at TEXT,
  expires_at   TEXT,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
