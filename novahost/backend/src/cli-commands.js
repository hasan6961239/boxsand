/**
 * Maintenance commands.
 *
 * Split from cli.js so the thin entry point can adjust the environment
 * (log level, warning filter) before these modules — and config.js with them —
 * are evaluated.
 */

let args = [];

import process from 'node:process';
import readline from 'node:readline/promises';
import fs from 'node:fs';
import path from 'node:path';
import { describeConfig } from './config.js';
import { openDatabase, closeDatabase, getDatabase } from './db/index.js';
import { migrationStatus } from './db/migrations.js';
import { initStorageSync, storageUsage } from './services/storage.js';
import { createBackup, listBackups, restoreBackup } from './services/backup.js';
import { runCleanup } from './services/cleanup.js';
import { systemStats, healthCheck } from './services/stats.js';
import * as usersRepo from './db/repo/users.js';
import * as projectsRepo from './db/repo/projects.js';
import * as deploymentsRepo from './db/repo/deployments.js';
import { hashPassword, checkPasswordStrength } from './util/password.js';
import { formatBytes } from './util/bytes.js';


function out(text = '') {
  process.stdout.write(`${text}\n`);
}

function fail(message, code = 1) {
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = code;
}

/** Read a value without echoing it, so a password never lands in the scrollback. */
async function askHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const originalWrite = rl._writeToOutput?.bind(rl);
  let muted = false;
  rl._writeToOutput = (chunk) => {
    if (muted) rl.output.write('*');
    else originalWrite?.(chunk);
  };
  process.stdout.write(question);
  muted = true;
  const answer = await rl.question('');
  muted = false;
  rl.close();
  process.stdout.write('\n');
  return answer;
}

async function ask(question, fallback = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer || fallback;
}

const COMMANDS = {
  async help() {
    out(`
NOVA HOST — maintenance commands

  migrate            apply pending database migrations
  status             show configuration, migrations and totals
  doctor             run health checks and report what is wrong
  create-admin       create an administrator account
  reset-password     set a new password for an account
  list-users         list accounts
  list-projects      list projects with size and deployment count
  backup             create a backup archive
  list-backups       list existing backups
  restore <file>     restore from a backup archive (destructive)
  cleanup            prune old logs, sessions and deployments
  stats              print current system statistics as JSON

Examples
  node backend/src/cli.js create-admin
  node backend/src/cli.js backup
  npm run doctor
`.trim());
  },

  async migrate() {
    initStorageSync();
    const db = await openDatabase();
    const status = migrationStatus(db);
    out(`applied: ${status.applied.length}/${status.total}`);
    if (status.pending.length) out(`pending: ${status.pending.join(', ')}`);
    else out('database is up to date');
  },

  async status() {
    initStorageSync();
    const db = await openDatabase();
    const info = describeConfig();

    out('configuration');
    for (const [key, value] of Object.entries(info)) out(`  ${key.padEnd(16)} ${value}`);

    const status = migrationStatus(db);
    out('');
    out(`migrations       ${status.applied.length}/${status.total} applied`);
    out(`driver           ${db.driverName}`);

    const totals = projectsRepo.totals();
    const deployTotals = deploymentsRepo.totals();
    out('');
    out(`users            ${usersRepo.countUsers()}`);
    out(`projects         ${totals.projects} (${totals.published} published)`);
    out(`deployments      ${deployTotals.total} (${deployTotals.ready} ready, ${deployTotals.failed} failed)`);
    out(`storage          ${formatBytes(totals.storageBytes)}`);
  },

  async doctor() {
    initStorageSync();
    const db = await openDatabase();
    const health = await healthCheck(db);
    const usage = await storageUsage();

    out(`status           ${health.status}`);
    for (const [key, value] of Object.entries(health.checks)) {
      out(`  ${key.padEnd(14)} ${value}`);
    }
    out('');
    out(`storage used     ${formatBytes(usage.total)}`);
    if (usage.disk) {
      const pct = ((usage.disk.total - usage.disk.free) / usage.disk.total) * 100;
      out(`device           ${formatBytes(usage.disk.free)} free of ${formatBytes(usage.disk.total)} (${pct.toFixed(1)}% used)`);
    } else {
      out('device           unavailable');
    }

    if (usersRepo.countUsers() === 0) {
      out('');
      out('no account exists yet — open the dashboard, or run: create-admin');
    }
    if (health.status !== 'ok') process.exitCode = 1;
  },

  async 'create-admin'() {
    initStorageSync();
    await openDatabase();

    const username = (await ask('username: ')).toLowerCase();
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
      return fail('username must be 3-32 characters of letters, digits, dot, underscore or hyphen');
    }
    if (usersRepo.findByUsername(username)) return fail('that username already exists');

    const email = (await ask('email: ')).toLowerCase();
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return fail('that email address is not valid');
    if (usersRepo.findByEmail(email)) return fail('that email is already registered');

    const password = await askHidden('password: ');
    const confirm = await askHidden('confirm:  ');
    if (password !== confirm) return fail('passwords do not match');

    const strength = checkPasswordStrength(password);
    if (!strength.ok) return fail(`password rejected: ${strength.errors.join(', ')}`);

    const user = usersRepo.createUser({
      username, email, passwordHash: await hashPassword(password), role: 'admin',
    });
    out(`created admin "${user.username}"`);
    return undefined;
  },

  async 'reset-password'() {
    initStorageSync();
    await openDatabase();

    const identifier = await ask('username or email: ');
    const user = usersRepo.findByLogin(identifier);
    if (!user) return fail('no such account');

    const password = await askHidden('new password: ');
    const confirm = await askHidden('confirm:      ');
    if (password !== confirm) return fail('passwords do not match');

    const strength = checkPasswordStrength(password);
    if (!strength.ok) return fail(`password rejected: ${strength.errors.join(', ')}`);

    usersRepo.updatePassword(user.id, await hashPassword(password));
    // Every existing session is invalidated, because this command exists for
    // the case where someone else may have had access.
    getDatabase().run('DELETE FROM sessions WHERE user_id = ?', user.id);
    out(`password updated for "${user.username}"; all sessions signed out`);
    return undefined;
  },

  async 'list-users'() {
    initStorageSync();
    await openDatabase();
    for (const user of usersRepo.listUsers()) {
      out(`${user.username.padEnd(20)} ${user.email.padEnd(30)} ${user.role.padEnd(8)} last login: ${user.last_login_at ?? 'never'}`);
    }
  },

  async 'list-projects'() {
    initStorageSync();
    await openDatabase();
    const { items } = projectsRepo.listProjects({ limit: 500 });
    if (items.length === 0) return out('no projects');
    for (const project of items) {
      const state = project.current_deployment_id ? 'published' : 'empty';
      out(`${project.slug.padEnd(28)} ${state.padEnd(10)} ${formatBytes(project.storage_bytes).padStart(10)}  ${project.deployment_count ?? 0} deploys`);
    }
    return undefined;
  },

  async backup() {
    initStorageSync();
    await openDatabase();
    const includeSites = !args.includes('--no-sites');
    out('creating backup…');
    const backup = await createBackup({ includeSites, note: 'created from the CLI' });
    out(`${backup.file}`);
    out(`${formatBytes(backup.size)} · ${backup.counts.projects} projects · ${backup.counts.deployments} deployments`);
  },

  async 'list-backups'() {
    initStorageSync();
    await openDatabase();
    const items = await listBackups();
    if (items.length === 0) return out('no backups');
    for (const item of items) {
      out(`${item.id.padEnd(40)} ${formatBytes(item.size).padStart(10)}  ${item.createdAt}`);
    }
    return undefined;
  },

  async restore() {
    const file = args[1];
    if (!file) return fail('usage: restore <backup.zip>');
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) return fail(`no such file: ${resolved}`);

    out('');
    out('This replaces the current database and site files.');
    out('A safety backup of the current state is taken first.');
    const answer = await ask('Type "restore" to continue: ');
    if (answer !== 'restore') return fail('cancelled');

    initStorageSync();
    await openDatabase();
    const result = await restoreBackup({ archivePath: resolved });
    out(`restored backup ${result.restored.id}`);
    out(`safety copy: ${result.safetyBackupId}`);
    if (result.previousDatabaseKeptAt) out(`previous database kept at: ${result.previousDatabaseKeptAt}`);
    out('restart the server for the change to take full effect');
    return undefined;
  },

  async cleanup() {
    initStorageSync();
    await openDatabase();
    const result = await runCleanup();
    for (const [key, value] of Object.entries(result)) out(`${key.padEnd(16)} ${value}`);
  },

  async stats() {
    const stats = await systemStats();
    out(JSON.stringify(stats, null, 2));
  },
};

export async function runCli(argv) {
  args = argv;
  const command = argv[0];
  const handler = COMMANDS[command] ?? (command ? null : COMMANDS.help);

  if (!handler) {
    fail(`unknown command: ${command}\nRun without arguments to see the list.`);
    return;
  }

  try {
    await handler();
  } catch (err) {
    fail(err.message);
    if (process.env.DEBUG) process.stderr.write(`${err.stack}\n`);
  } finally {
    try {
      closeDatabase();
    } catch { /* never opened */ }
  }
}
