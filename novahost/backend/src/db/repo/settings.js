import { getDatabase } from '../index.js';
import { config } from '../../config.js';
import { nowIso } from '../../util/time.js';

/**
 * Runtime-tunable settings.
 *
 * Values live in the database as JSON so a number stays a number across a
 * restart. Anything absent falls back to the value from .env, which means a
 * fresh install works before anyone opens the Settings page.
 *
 * Each entry declares its own bounds; the API validates against this table
 * rather than trusting the client, so a hand-crafted request cannot set
 * maxUploadMb to 900000 and fill the phone.
 */
export const SETTINGS_SCHEMA = {
  maxUploadMb: { type: 'int', min: 1, max: 2048, group: 'storage' },
  maxFilesPerDeploy: { type: 'int', min: 1, max: 100000, group: 'storage' },
  maxUncompressedMb: { type: 'int', min: 1, max: 8192, group: 'storage' },
  maxSingleFileMb: { type: 'int', min: 1, max: 2048, group: 'storage' },
  maxCompressionRatio: { type: 'int', min: 2, max: 10000, group: 'security' },
  keepDeployments: { type: 'int', min: 1, max: 100, group: 'storage' },
  logRetentionDays: { type: 'int', min: 1, max: 365, group: 'logs' },
  securityRetentionDays: { type: 'int', min: 1, max: 730, group: 'logs' },
};

export function defaults() {
  return { ...config.defaults };
}

export function getAll() {
  const rows = getDatabase().all('SELECT key, value FROM settings');
  const stored = {};
  for (const row of rows) {
    try { stored[row.key] = JSON.parse(row.value); } catch { /* skip corrupt row */ }
  }
  return { ...defaults(), ...stored };
}

export function get(key) {
  return getAll()[key];
}

export function set(key, value) {
  if (!Object.hasOwn(SETTINGS_SCHEMA, key)) {
    throw Object.assign(new Error(`Unknown setting: ${key}`), { code: 'UNKNOWN_SETTING' });
  }
  const spec = SETTINGS_SCHEMA[key];
  let parsed = value;
  if (spec.type === 'int') {
    parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw Object.assign(new Error(`${key} must be a whole number`), { code: 'INVALID_SETTING' });
    }
    if (parsed < spec.min || parsed > spec.max) {
      throw Object.assign(
        new Error(`${key} must be between ${spec.min} and ${spec.max}`),
        { code: 'INVALID_SETTING' },
      );
    }
  }
  getDatabase().run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key, JSON.stringify(parsed), nowIso(),
  );
  return parsed;
}

export function setMany(values) {
  const db = getDatabase();
  return db.transaction(() => {
    const applied = {};
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      applied[key] = set(key, value);
    }
    return applied;
  });
}

export function reset(key) {
  getDatabase().run('DELETE FROM settings WHERE key = ?', key);
}
