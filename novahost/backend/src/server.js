/**
 * NOVA HOST — entry point.
 *
 * Boot order matters and is deliberate:
 *   1. quiet the node:sqlite experimental notice (it is expected, not a warning
 *      the operator should act on)
 *   2. storage directories — the logger and database both need them
 *   3. database + migrations
 *   4. reconcile anything a crash or an Android process kill left half-done
 *   5. listen
 *
 * Nothing here assumes a particular OS. The same file runs on Termux, on
 * Windows during development, and on a Raspberry Pi if this ever outgrows a phone.
 */

import { silenceSqliteWarning } from './util/quiet.js';

silenceSqliteWarning();

import { config, describeConfig } from './config.js';
import { logger, setDatabaseSink, closeLogger } from './logger.js';
import { openDatabase, closeDatabase, getDatabase } from './db/index.js';
import { insertLog } from './db/repo/logs.js';
import { createServers } from './http/server.js';
import { initStorageSync } from './services/storage.js';
import { reconcileInterruptedDeployments, reconcileCurrentPointers } from './services/deploy.js';
import { runCleanup, startCleanupSchedule, stopCleanupSchedule } from './services/cleanup.js';
import { localAddresses } from './services/stats.js';
import { countUsers } from './db/repo/users.js';

const log = logger.child('boot');

function banner() {
  const info = describeConfig();
  const hostLabel = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  const lines = [
    '',
    `  ${config.appName}`,
    `  ${'─'.repeat(Math.max(config.appName.length, 20))}`,
    `  environment   ${info.nodeEnv}`,
    `  dashboard     http://${hostLabel}:${config.port}`,
    `  sites         http://${hostLabel}:${config.sitesPort}/s/<project>/`,
    `  data          ${info.dataDir}`,
    `  database      ${getDatabase().driverName}`,
  ];

  if (config.panelHost) lines.push(`  public panel  https://${config.panelHost}`);
  if (config.sitesDomain) lines.push(`  public sites  https://<project>.${config.sitesDomain}`);

  const addresses = localAddresses();
  if (config.host === '0.0.0.0' && addresses.length) {
    lines.push('  on this network:');
    for (const address of addresses) {
      lines.push(`      http://${address.address}:${config.port}   (${address.interface})`);
    }
  }

  if (countUsers() === 0) {
    lines.push('');
    lines.push('  No account yet — open the dashboard to run the setup wizard.');
  }
  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function listen(server, port, label) {
  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `Port ${port} is already in use (${label}).\n` +
          'Another copy of NOVA HOST is probably running. Check with:  scripts/status.sh\n' +
          `Or change the port in .env and restart.`,
        ));
        return;
      }
      if (err.code === 'EACCES') {
        reject(new Error(
          `Not allowed to bind port ${port} (${label}).\n` +
          'Ports below 1024 need privileges that Termux does not have — use a port above 1024.',
        ));
        return;
      }
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, config.host);
  });
}

export async function startServer() {
  initStorageSync();

  const db = await openDatabase();

  // Route warn/error log lines into the database so the dashboard Logs page
  // shows them. Wired after the database is open, by design.
  setDatabaseSink(insertLog);

  const interrupted = await reconcileInterruptedDeployments();
  if (interrupted > 0) {
    log.warn(`${interrupted} deployment(s) were interrupted by a restart and have been marked failed`);
  }
  await reconcileCurrentPointers();
  await runCleanup({ includeDeployments: false });
  startCleanupSchedule();

  const { panelServer, siteServer } = createServers();

  await listen(panelServer, config.port, 'dashboard');
  await listen(siteServer, config.sitesPort, 'hosted sites');

  banner();
  log.info('server started', {
    port: config.port,
    sitesPort: config.sitesPort,
    pid: process.pid,
    node: process.version,
  });

  return { panelServer, siteServer, db };
}

/**
 * Shut down cleanly.
 *
 * On a phone this runs more often than on a normal server — Android stops
 * processes, Termux sessions end, the supervisor restarts things. Checkpointing
 * the WAL and closing the database on the way out keeps the next start fast and
 * the file consistent.
 */
export async function stopServer({ panelServer, siteServer }, { exitCode = 0 } = {}) {
  stopCleanupSchedule();

  await Promise.all([panelServer, siteServer].map((server) => new Promise((resolve) => {
    if (!server?.listening) return resolve();
    server.close(resolve);
    // Do not wait forever on a keep-alive connection that will not close.
    setTimeout(resolve, 3000).unref?.();
  })));

  try {
    closeDatabase();
  } catch (err) {
    process.stderr.write(`error closing database: ${err.message}\n`);
  }
  await closeLogger();
  return exitCode;
}

// Only take over the process when run directly, so tests can import and drive
// the server without it installing signal handlers or calling process.exit.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  let servers = null;
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`received ${signal}, shutting down`);
    if (servers) await stopServer(servers);
    process.exit(0);
  };

  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });

  // A crash must be loud and must leave the database consistent, so the
  // supervisor can restart into a working state rather than a corrupt one.
  //
  // The guard matters more than it looks: if the crash is itself a write
  // failure (a dead terminal producing EPIPE), logging it can raise the same
  // error again and spin. One crash, one log line, one exit.
  let crashing = false;
  process.on('uncaughtException', (err) => {
    if (crashing) return;
    crashing = true;
    try {
      log.error('uncaught exception', { error: err?.message, stack: err?.stack });
    } catch { /* the logger is already the thing that is broken */ }
    const done = () => process.exit(1);
    if (servers) stopServer(servers).then(done, done);
    else done();
    // Never hang on a shutdown that cannot complete after a crash.
    setTimeout(done, 5000).unref?.();
  });
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  startServer()
    .then((result) => { servers = result; })
    .catch((err) => {
      process.stderr.write(`\nNOVA HOST failed to start:\n\n${err.message}\n\n`);
      if (config.isDevelopment && err.stack) process.stderr.write(`${err.stack}\n`);
      process.exit(1);
    });
}
