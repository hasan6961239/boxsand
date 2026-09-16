import os from 'node:os';
import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { diskSpace } from '../util/fsx.js';

const execFileAsync = promisify(execFile);
const log = createLogger('stats');

/**
 * System statistics.
 *
 * The governing rule, and the reason this file is longer than it looks like it
 * should be: **never invent a number**. Android restricts a lot of what a normal
 * Linux server exposes — /proc/net/dev is blocked to apps since Android 10,
 * battery and temperature need the Termux:API companion app, and some OEM builds
 * lock down more. Every reader below returns `null` on failure and the API
 * reports that as "unavailable", because a plausible-looking wrong number is
 * worse than an honest gap.
 */

const startedAt = Date.now();

// ---------------------------------------------------------------------------
// Small caches. getprop values never change; battery is polled at most every
// 30 s so opening the Server page does not wake the radio on every render.
// ---------------------------------------------------------------------------
const cache = new Map();

function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = producer();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

/**
 * Run a short command, with a hard timeout and no shell.
 *
 * execFile (not exec) means no shell is involved, so there is nothing to inject
 * into. Every argument here is a literal in this file; nothing from a request
 * ever reaches this function.
 */
async function tryCommand(command, args = [], { timeout = 3000 } = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function readProc(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

let lastCpuSample = null;

/**
 * CPU usage from /proc/stat, as a percentage over the interval since the last
 * call. The first call has no previous sample to diff against, so it falls back
 * to os.cpus() totals, which give usage since boot rather than right now — less
 * useful but not wrong.
 */
async function readCpu() {
  const text = await readProc('/proc/stat');
  if (text) {
    const line = text.split('\n').find((l) => l.startsWith('cpu '));
    if (line) {
      const parts = line.trim().split(/\s+/).slice(1).map(Number);
      if (parts.length >= 4 && parts.every(Number.isFinite)) {
        const idle = parts[3] + (parts[4] ?? 0);
        const total = parts.reduce((sum, n) => sum + n, 0);
        const previous = lastCpuSample;
        lastCpuSample = { idle, total, at: Date.now() };

        if (previous && total > previous.total) {
          const idleDelta = idle - previous.idle;
          const totalDelta = total - previous.total;
          const usage = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;
          return {
            usagePercent: Math.max(0, Math.min(100, Math.round(usage * 10) / 10)),
            cores: os.cpus().length || null,
            source: '/proc/stat',
          };
        }
      }
    }
  }

  const cpus = os.cpus();
  if (cpus.length > 0) {
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      for (const [type, value] of Object.entries(cpu.times)) {
        total += value;
        if (type === 'idle') idle += value;
      }
    }
    return {
      usagePercent: total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : null,
      cores: cpus.length,
      source: 'os.cpus (since boot)',
    };
  }

  return { usagePercent: null, cores: null, source: null };
}

function readLoadAverage() {
  const load = os.loadavg();
  // Windows always reports [0, 0, 0]; reporting that as real would be a lie.
  if (process.platform === 'win32' || load.every((n) => n === 0)) return null;
  return load.map((n) => Math.round(n * 100) / 100);
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

async function readMemory() {
  const text = await readProc('/proc/meminfo');
  if (text) {
    const values = {};
    for (const line of text.split('\n')) {
      const match = /^(\w+):\s+(\d+)\s*kB/.exec(line);
      if (match) values[match[1]] = Number(match[2]) * 1024;
    }
    // MemAvailable is the kernel's own estimate of what a new process could
    // actually get. It is far more honest than MemFree, which excludes cache.
    if (values.MemTotal) {
      const available = values.MemAvailable ?? values.MemFree ?? 0;
      return {
        total: values.MemTotal,
        available,
        used: values.MemTotal - available,
        usedPercent: Math.round(((values.MemTotal - available) / values.MemTotal) * 1000) / 10,
        source: '/proc/meminfo',
      };
    }
  }

  const total = os.totalmem();
  const free = os.freemem();
  if (!total) return null;
  return {
    total,
    available: free,
    used: total - free,
    usedPercent: Math.round(((total - free) / total) * 1000) / 10,
    source: 'os.freemem',
  };
}

// ---------------------------------------------------------------------------
// Battery, temperature, device identity — all via Termux:API when present
// ---------------------------------------------------------------------------

/**
 * termux-battery-status comes from the Termux:API companion app, which is a
 * separate install. Without it there is no supported way for an unprivileged
 * process to read battery or temperature on modern Android, so both report as
 * unavailable rather than being guessed at.
 */
async function readBattery() {
  const raw = await tryCommand('termux-battery-status', [], { timeout: 4000 });
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return {
      percentage: typeof data.percentage === 'number' ? data.percentage : null,
      status: data.status ?? null,
      plugged: data.plugged ?? null,
      // Celsius, and only on devices whose HAL reports it.
      temperature: typeof data.temperature === 'number' ? data.temperature : null,
      health: data.health ?? null,
      source: 'termux-battery-status',
    };
  } catch {
    return null;
  }
}

/** Thermal zones are readable on some devices and blocked on others. */
async function readThermal() {
  for (let zone = 0; zone < 12; zone++) {
    const type = await readProc(`/sys/class/thermal/thermal_zone${zone}/type`);
    if (!type) continue;
    const name = type.trim().toLowerCase();
    if (!/cpu|soc|tsens|ap|skin|battery/.test(name)) continue;
    const raw = await readProc(`/sys/class/thermal/thermal_zone${zone}/temp`);
    if (!raw) continue;
    const value = Number(raw.trim());
    if (!Number.isFinite(value)) continue;
    // Kernels report milli-degrees or degrees depending on the driver.
    const celsius = value > 1000 ? value / 1000 : value;
    if (celsius > 0 && celsius < 150) {
      return { celsius: Math.round(celsius * 10) / 10, zone: type.trim(), source: '/sys/class/thermal' };
    }
  }
  return null;
}

async function readAndroidProperties() {
  const [release, sdk, model, manufacturer] = await Promise.all([
    tryCommand('getprop', ['ro.build.version.release']),
    tryCommand('getprop', ['ro.build.version.sdk']),
    tryCommand('getprop', ['ro.product.model']),
    tryCommand('getprop', ['ro.product.manufacturer']),
  ]);
  if (!release && !model) return null;
  return {
    androidVersion: release || null,
    sdk: sdk ? Number(sdk) : null,
    model: model || null,
    manufacturer: manufacturer || null,
  };
}

/**
 * Network counters.
 *
 * Android 10 and later block /proc/net/dev for ordinary apps to stop them
 * profiling other apps' traffic. On a phone this will usually return null, and
 * the dashboard will say "unavailable" — which is the truth, not a bug.
 */
async function readNetwork() {
  const text = await readProc('/proc/net/dev');
  if (!text) return null;
  let rx = 0;
  let tx = 0;
  let counted = 0;
  for (const line of text.split('\n').slice(2)) {
    const match = /^\s*([\w.-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const iface = match[1];
    if (iface === 'lo') continue;
    const fields = match[2].trim().split(/\s+/).map(Number);
    if (fields.length < 9) continue;
    rx += fields[0];
    tx += fields[8];
    counted += 1;
  }
  if (counted === 0) return null;
  return { rxBytes: rx, txBytes: tx, interfaces: counted, source: '/proc/net/dev' };
}

/** Local IPv4 addresses, so the dashboard can show the LAN URL to use. */
export function localAddresses() {
  const out = [];
  const interfaces = os.networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      out.push({ interface: name, address: address.address });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runtimeInfo() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    // Termux exports this; anywhere else it is simply absent.
    termuxVersion: process.env.TERMUX_VERSION ?? null,
    isTermux: Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes('com.termux')),
    appName: config.appName,
    nodeEnv: config.nodeEnv,
    processUptimeMs: Date.now() - startedAt,
    memoryUsage: (() => {
      const mem = process.memoryUsage();
      return { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external };
    })(),
  };
}

/**
 * Full snapshot for the Server page.
 * Everything runs concurrently; a hung `getprop` cannot stall the response
 * because each command carries its own timeout.
 */
export async function systemStats() {
  const [cpu, memory, disk, battery, thermal, android, network] = await Promise.all([
    readCpu(),
    readMemory(),
    diskSpace(config.dataDir),
    cached('battery', 30_000, () => readBattery()),
    cached('thermal', 30_000, () => readThermal()),
    cached('android', 3_600_000, () => readAndroidProperties()),
    readNetwork(),
  ]);

  const os_uptime = os.uptime();

  return {
    cpu,
    load: readLoadAverage(),
    memory,
    storage: disk ? { ...disk, used: disk.total - disk.free, usedPercent: disk.total ? Math.round(((disk.total - disk.free) / disk.total) * 1000) / 10 : null } : null,
    battery: await battery,
    temperature: await thermal,
    android: await android,
    network,
    uptime: {
      systemSeconds: Number.isFinite(os_uptime) && os_uptime > 0 ? Math.floor(os_uptime) : null,
      processSeconds: Math.floor(process.uptime()),
    },
    host: {
      hostname: os.hostname(),
      type: os.type(),
      release: os.release(),
      addresses: localAddresses(),
    },
    runtime: runtimeInfo(),
    collectedAt: new Date().toISOString(),
  };
}

/** Cheap health probe used by /health, the supervisor script and the UI badge. */
export async function healthCheck(db) {
  const checks = {};
  let healthy = true;

  try {
    const row = db.get('SELECT 1 AS ok');
    checks.database = row?.ok === 1 ? 'ok' : 'error';
    if (checks.database !== 'ok') healthy = false;
  } catch (err) {
    checks.database = 'error';
    healthy = false;
    log.error('health check: database unreachable', { error: err.message });
  }

  try {
    await fsp.access(config.storagePath);
    checks.storage = 'ok';
  } catch {
    checks.storage = 'error';
    healthy = false;
  }

  const disk = await diskSpace(config.dataDir);
  if (disk) {
    // Under 100 MB free, deploys will start failing — say so before they do.
    checks.disk = disk.free > 100 * 1024 * 1024 ? 'ok' : 'low';
    if (checks.disk === 'low') healthy = false;
  } else {
    checks.disk = 'unavailable';
  }

  return {
    status: healthy ? 'ok' : 'degraded',
    checks,
    uptimeSeconds: Math.floor(process.uptime()),
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  };
}
