import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { ensureDirSync } from './util/fsx.js';

/**
 * Logger.
 *
 * Three sinks, each with a different job:
 *   console — what you watch over SSH while something is going wrong.
 *   file    — data/logs/app-YYYY-MM-DD.log, rotated daily, pruned by retention.
 *   database— only for records the dashboard shows (deploy steps, warnings and
 *             errors). Writing every debug line to SQLite would hammer the
 *             phone's flash for no benefit, so it is filtered deliberately.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

const threshold = LEVELS[config.logLevel] ?? LEVELS.info;
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

/**
 * Never let writing a log line throw.
 *
 * If the terminal that started the server goes away — an SSH session dropping,
 * Termux being swiped out of recents, a piped command exiting — the next write
 * to stdout raises EPIPE. Unhandled, that reaches the uncaughtException handler,
 * which logs it, which writes to stdout, which raises EPIPE again. This project
 * learned that the hard way: the loop wrote 1.6 million rows and filled 1.5 GB
 * before anyone noticed. Console output is the least important sink there is,
 * so it fails silently.
 */
let consoleBroken = false;
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => {
    if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') consoleBroken = true;
  });
}

function writeConsole(stream, text) {
  if (consoleBroken) return;
  try {
    stream.write(text);
  } catch (err) {
    if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') consoleBroken = true;
  }
}

/**
 * Suppress a storm of identical lines.
 *
 * A tight failure loop is the one case where logging actively makes things
 * worse, because each line costs a database row and a flash write. After
 * STORM_LIMIT identical messages inside STORM_WINDOW_MS we stop recording them
 * and emit a single summary when the window closes.
 */
const STORM_LIMIT = 20;
const STORM_WINDOW_MS = 10_000;
const stormCounters = new Map();

function stormCheck(key) {
  const now = Date.now();
  let entry = stormCounters.get(key);
  if (!entry || now - entry.start > STORM_WINDOW_MS) {
    if (entry && entry.count > STORM_LIMIT) {
      const suppressed = entry.count - STORM_LIMIT;
      stormCounters.set(key, { start: now, count: 1, reported: false });
      return { allowed: true, suppressed };
    }
    entry = { start: now, count: 1, reported: false };
    stormCounters.set(key, entry);
    return { allowed: true, suppressed: 0 };
  }
  entry.count += 1;
  if (entry.count > STORM_LIMIT) {
    if (!entry.reported) {
      entry.reported = true;
      return { allowed: true, suppressed: 0, lastBeforeSuppression: true };
    }
    return { allowed: false, suppressed: 0 };
  }
  // Keep the map from growing without bound under many distinct messages.
  if (stormCounters.size > 500) {
    for (const [k, v] of stormCounters) {
      if (now - v.start > STORM_WINDOW_MS) stormCounters.delete(k);
    }
  }
  return { allowed: true, suppressed: 0 };
}

let stream = null;
let streamDate = null;
let dbSink = null;
let fileFailureReported = false;

/**
 * Called once the database is open. Kept as an injected function rather than an
 * import so logger.js stays free of a dependency on db/, which itself logs.
 */
export function setDatabaseSink(fn) {
  dbSink = fn;
}

function currentDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function getStream() {
  const today = currentDateStamp();
  if (stream && streamDate === today) return stream;
  try {
    ensureDirSync(config.logsDir);
    if (stream) stream.end();
    stream = fs.createWriteStream(path.join(config.logsDir, `app-${today}.log`), { flags: 'a' });
    // A broken log file must never take the server down with it.
    stream.on('error', (err) => {
      if (!fileFailureReported) {
        fileFailureReported = true;
        writeConsole(process.stderr, `[logger] file sink disabled: ${err.message}\n`);
      }
      stream = null;
    });
    streamDate = today;
    return stream;
  } catch (err) {
    if (!fileFailureReported) {
      fileFailureReported = true;
      writeConsole(process.stderr, `[logger] cannot open log file: ${err.message}\n`);
    }
    return null;
  }
}

function serialiseMeta(meta) {
  if (!meta || typeof meta !== 'object' || Object.keys(meta).length === 0) return '';
  try {
    return JSON.stringify(meta, (key, value) => {
      // Defence in depth: even if a caller passes a whole request object by
      // mistake, secrets never reach a log file.
      if (/^(password|token|secret|cookie|authorization|csrf|key_hash|password_hash)$/i.test(key)) {
        return '[redacted]';
      }
      if (typeof value === 'bigint') return String(value);
      if (value instanceof Error) return { name: value.name, message: value.message, code: value.code };
      return value;
    });
  } catch {
    return '"[unserialisable meta]"';
  }
}

function write(level, module, message, meta) {
  if (LEVELS[level] < threshold) return;

  const storm = stormCheck(`${level}:${module}:${message}`);
  if (!storm.allowed) return;

  const ts = new Date().toISOString();
  const metaText = serialiseMeta(meta);

  let text = message;
  if (storm.lastBeforeSuppression) {
    text = `${message} (repeating — further identical messages suppressed for ${STORM_WINDOW_MS / 1000}s)`;
  } else if (storm.suppressed > 0) {
    text = `${message} (${storm.suppressed} identical messages were suppressed)`;
  }

  const line = `${ts} ${level.toUpperCase().padEnd(5)} [${module}] ${text}${metaText ? ` ${metaText}` : ''}`;

  if (useColor) {
    writeConsole(process.stdout, `${COLORS[level]}${ts.slice(11, 19)} ${level.toUpperCase().padEnd(5)}${RESET} [${module}] ${text}${metaText ? ` ${metaText}` : ''}\n`);
  } else if (!config.isTest) {
    writeConsole(process.stdout, `${line}\n`);
  }

  const s = getStream();
  if (s) s.write(`${line}\n`);

  // Persist what the dashboard is going to display, and nothing more.
  const persist = LEVELS[level] >= LEVELS.warn || meta?.persist === true;
  if (dbSink && persist) {
    try {
      dbSink({
        ts,
        level,
        module,
        message: text,
        projectId: meta?.projectId ?? null,
        deploymentId: meta?.deploymentId ?? null,
        meta: metaText || null,
      });
    } catch {
      // A failing database sink must not break request handling.
    }
  }
}

/** A logger bound to one module name. */
export function createLogger(module) {
  return {
    debug: (message, meta) => write('debug', module, message, meta),
    info: (message, meta) => write('info', module, message, meta),
    warn: (message, meta) => write('warn', module, message, meta),
    error: (message, meta) => write('error', module, message, meta),
    /** Force a line into the database even at info level (deployment steps). */
    step: (message, meta) => write('info', module, message, { ...meta, persist: true }),
    child: (sub) => createLogger(`${module}:${sub}`),
  };
}

export const logger = createLogger('app');

export async function closeLogger() {
  await new Promise((resolve) => {
    if (!stream) return resolve();
    stream.end(resolve);
  });
  stream = null;
}

/** Delete rotated log files older than `days`. Called by the cleanup job. */
export async function pruneLogFiles(days) {
  const cutoff = Date.now() - days * 86400_000;
  let removed = 0;
  let entries;
  try {
    entries = await fs.promises.readdir(config.logsDir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
    const stamp = Date.parse(`${name.slice(4, 14)}T00:00:00Z`);
    if (Number.isFinite(stamp) && stamp < cutoff) {
      try {
        await fs.promises.unlink(path.join(config.logsDir, name));
        removed += 1;
      } catch { /* already gone */ }
    }
  }
  return removed;
}
