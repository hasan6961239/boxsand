import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

/**
 * Configuration.
 *
 * Reads .env with a small parser instead of pulling in dotenv — one less
 * dependency to install on a phone, and the format we need is four lines of code.
 * Real environment variables always win over the .env file, so a systemd/runit
 * unit or a CI runner can override anything without editing files.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..', '..');

function parseEnvFile(file) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = parseEnvFile(path.join(ROOT_DIR, '.env'));

function env(key, fallback = undefined) {
  const value = process.env[key] ?? fileEnv[key];
  if (value === undefined || value === '') return fallback;
  return value;
}

function envInt(key, fallback) {
  const raw = env(key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Configuration error: ${key} must be a number, got "${raw}"`);
  }
  return n;
}

function envBool(key, fallback) {
  const raw = env(key);
  if (raw === undefined) return fallback;
  const v = String(raw).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  throw new Error(`Configuration error: ${key} must be true or false, got "${raw}"`);
}

/** Resolve a possibly-relative path against the project root. */
function resolvePath(value, fallback) {
  const raw = value ?? fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT_DIR, raw);
}

const NODE_ENV = env('NODE_ENV', 'development');
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

const publicUrlRaw = env('PUBLIC_URL', `http://localhost:${envInt('PORT', 8080)}`);
let publicUrl;
try {
  publicUrl = new URL(publicUrlRaw);
} catch {
  throw new Error(`Configuration error: PUBLIC_URL is not a valid URL: "${publicUrlRaw}"`);
}

const secureCookiesSetting = String(env('SECURE_COOKIES', 'auto')).toLowerCase();
const secureCookies = secureCookiesSetting === 'auto'
  ? publicUrl.protocol === 'https:'
  : ['1', 'true', 'yes', 'on'].includes(secureCookiesSetting);

const dataDir = resolvePath(env('DATA_DIR'), './data');

/**
 * SESSION_SECRET.
 *
 * In production an empty secret is a hard failure: it would silently invalidate
 * every session on restart and weaken token derivation. In development and test
 * we generate an ephemeral one so `npm run dev` works with zero setup.
 */
let sessionSecret = env('SESSION_SECRET');
if (!sessionSecret || sessionSecret.length < 32) {
  if (isProduction) {
    throw new Error(
      'Configuration error: SESSION_SECRET is missing or shorter than 32 characters.\n' +
      'Generate one with:\n' +
      '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n' +
      'then put it in .env as SESSION_SECRET=...',
    );
  }
  sessionSecret = randomBytes(48).toString('base64url');
}

const port = envInt('PORT', 8080);
const sitesPort = envInt('SITES_PORT', 8081);
if (port === sitesPort) {
  throw new Error(
    'Configuration error: PORT and SITES_PORT must differ.\n' +
    'They are separate on purpose: a different port is a different browser origin, ' +
    'which is what stops an uploaded site from reading the dashboard session.',
  );
}

function normaliseHost(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

export const config = {
  appName: env('APP_NAME', 'NOVA HOST'),
  nodeEnv: NODE_ENV,
  isProduction,
  isTest,
  isDevelopment: !isProduction && !isTest,

  host: env('HOST', '0.0.0.0'),
  port,
  sitesPort,
  publicUrl: publicUrl.origin,
  publicUrlPath: publicUrl.href.replace(/\/$/, ''),

  panelHost: normaliseHost(env('PANEL_HOST', '')),
  sitesDomain: normaliseHost(env('SITES_DOMAIN', '')),

  dataDir,
  databasePath: resolvePath(env('DATABASE_PATH'), path.join(dataDir, 'novahost.db')),
  storagePath: resolvePath(env('STORAGE_PATH'), path.join(dataDir, 'storage')),
  logsDir: path.join(dataDir, 'logs'),
  frontendDir: path.resolve(ROOT_DIR, 'frontend'),

  sessionSecret,
  sessionTtlHours: envInt('SESSION_TTL_HOURS', 720),
  secureCookies,
  trustProxy: envBool('TRUST_PROXY', true),
  sessionCookieName: 'nh_session',

  // Boot-time defaults for the runtime-tunable settings. Values stored in the
  // `settings` table take precedence once the database is open.
  defaults: {
    maxUploadMb: envInt('MAX_UPLOAD_MB', 64),
    maxFilesPerDeploy: envInt('MAX_FILES_PER_DEPLOY', 5000),
    maxUncompressedMb: envInt('MAX_UNCOMPRESSED_MB', 256),
    maxSingleFileMb: envInt('MAX_SINGLE_FILE_MB', 64),
    maxCompressionRatio: envInt('MAX_COMPRESSION_RATIO', 120),
    keepDeployments: envInt('KEEP_DEPLOYMENTS', 10),
    logRetentionDays: envInt('LOG_RETENTION_DAYS', 30),
    securityRetentionDays: envInt('SECURITY_RETENTION_DAYS', 90),
  },

  logLevel: env('LOG_LEVEL', isTest ? 'error' : 'info'),
};

/** Origins allowed to make state-changing API calls (CSRF defence). */
export function allowedOrigins() {
  const origins = new Set([config.publicUrl]);
  if (config.panelHost) {
    origins.add(`https://${config.panelHost}`);
    origins.add(`http://${config.panelHost}`);
  }
  // Local development and LAN access are legitimate and have no fixed host.
  origins.add(`http://localhost:${config.port}`);
  origins.add(`http://127.0.0.1:${config.port}`);
  return origins;
}

/** Human-readable summary printed at boot — never includes secrets. */
export function describeConfig() {
  return {
    appName: config.appName,
    nodeEnv: config.nodeEnv,
    panelUrl: config.publicUrl,
    listen: `${config.host}:${config.port}`,
    sitesListen: `${config.host}:${config.sitesPort}`,
    panelHost: config.panelHost || '(not set — LAN / quick-tunnel mode)',
    sitesDomain: config.sitesDomain || '(not set — path mode only)',
    dataDir: config.dataDir,
    database: config.databasePath,
    storage: config.storagePath,
    secureCookies: config.secureCookies,
    trustProxy: config.trustProxy,
    maxUploadMb: config.defaults.maxUploadMb,
  };
}
