import { json } from '../http/respond.js';
import { errors } from '../http/errors.js';
import { config, describeConfig } from '../config.js';
import { requireAuth } from '../http/middleware/auth.js';
import { enforce, snapshot as rateLimitSnapshot } from '../http/middleware/ratelimit.js';
import { getDatabase } from '../db/index.js';
import * as projectsRepo from '../db/repo/projects.js';
import * as deploymentsRepo from '../db/repo/deployments.js';
import * as logsRepo from '../db/repo/logs.js';
import * as auditRepo from '../db/repo/audit.js';
import { systemStats, healthCheck, runtimeInfo } from '../services/stats.js';
import { storageUsage } from '../services/storage.js';
import { backupsUsage } from '../services/backup.js';
import { runCleanup, rescanStorage } from '../services/cleanup.js';
import { createLogger } from '../logger.js';

const log = createLogger('server-api');

export function register(router) {
  /**
   * Unauthenticated health probe.
   *
   * Used by the supervisor script, by the Termux:Boot startup script and by the
   * status dot in the UI. It reveals only whether the service is working — no
   * counts, no paths, no versions of anything an attacker could use.
   */
  router.get('/health', async (ctx) => {
    const health = await healthCheck(getDatabase());
    json(ctx.res, health, health.status === 'ok' ? 200 : 503);
  });

  router.get('/api/server/stats', async (ctx) => {
    requireAuth(ctx);
    json(ctx.res, await systemStats());
  });

  router.get('/api/server/info', async (ctx) => {
    requireAuth(ctx);
    const db = getDatabase();
    json(ctx.res, {
      runtime: runtimeInfo(),
      config: describeConfig(),
      database: {
        driver: db.driverName,
        migrations: db.all('SELECT version, name, applied_at FROM schema_migrations ORDER BY version'),
      },
      rateLimit: rateLimitSnapshot(),
    });
  });

  router.get('/api/server/storage', async (ctx) => {
    requireAuth(ctx);
    const [usage, backups] = await Promise.all([storageUsage(), backupsUsage()]);
    const projects = projectsRepo.listProjects({ limit: 200, sort: 'size', dir: 'desc' });

    json(ctx.res, {
      usage: { ...usage, backups: backups.bytes },
      logs: logsRepo.storageBytes(),
      largestProjects: projects.items.slice(0, 10).map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        storageBytes: row.storage_bytes,
        fileCount: row.file_count,
      })),
    });
  });

  /** Dashboard home: everything the Overview page needs in one request. */
  router.get('/api/overview', async (ctx) => {
    requireAuth(ctx);
    const db = getDatabase();
    const [stats, usage, health] = await Promise.all([
      systemStats(),
      storageUsage(),
      healthCheck(db),
    ]);

    json(ctx.res, {
      counts: {
        ...projectsRepo.totals(),
        deployments: deploymentsRepo.totals(),
      },
      storage: usage,
      health,
      system: {
        cpu: stats.cpu,
        memory: stats.memory,
        storage: stats.storage,
        battery: stats.battery,
        temperature: stats.temperature,
        uptime: stats.uptime,
        load: stats.load,
        host: stats.host,
        runtime: stats.runtime,
        android: stats.android,
      },
      recentDeployments: deploymentsRepo.listRecent({ limit: 8 })
        .map((row) => deploymentsRepo.mapDeployment(row)),
      recentActivity: auditRepo.listAudit({ limit: 8 }).items.map(auditRepo.mapAudit),
    });
  });

  router.post('/api/server/rescan', async (ctx) => {
    requireAuth(ctx);
    enforce(ctx, 'write', ctx.ip);
    json(ctx.res, await rescanStorage());
  });

  router.post('/api/server/cleanup', async (ctx) => {
    const user = requireAuth(ctx);
    enforce(ctx, 'write', ctx.ip);
    const result = await runCleanup();
    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'server.cleanup', ip: ctx.ip, meta: result,
    });
    json(ctx.res, result);
  });

  /**
   * Restart the backend.
   *
   * There is no in-process "restart": the honest implementation is to exit and
   * let the supervisor start a fresh process. That is why it refuses unless a
   * supervisor is actually configured — exiting without one would take the
   * server down until you SSH in, which is the opposite of what the button
   * looks like it does.
   */
  router.post('/api/server/restart', async (ctx) => {
    const user = requireAuth(ctx);
    enforce(ctx, 'write', ctx.ip);

    const body = await ctx.json({ required: false });
    if (body?.confirm !== 'restart') {
      throw errors.badRequest('CONFIRMATION_REQUIRED', 'Send {"confirm":"restart"} to restart the server');
    }

    const supervised = process.env.NOVAHOST_SUPERVISED === '1';
    if (!supervised) {
      throw errors.badRequest(
        'NOT_SUPERVISED',
        'Restarting is only available when the server runs under the supervisor script. Start it with scripts/start.sh, or restart it manually.',
      );
    }

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'server.restart', ip: ctx.ip,
    });
    log.warn('restart requested from the dashboard', { by: user.username });

    json(ctx.res, { restarting: true });

    // Let the response flush before the process goes away.
    setTimeout(() => {
      log.warn('exiting for supervised restart');
      process.exit(0);
    }, 250).unref?.();
  });

  router.get('/api/search', async (ctx) => {
    requireAuth(ctx);
    const query = ctx.q('q').slice(0, 100);
    if (query.length < 2) {
      json(ctx.res, { projects: [], deployments: [], logs: [] });
      return;
    }

    const projects = projectsRepo.listProjects({ search: query, limit: 8 }).items
      .map(projectsRepo.mapProject);

    const db = getDatabase();
    const like = `%${query}%`;
    const deployments = db.all(
      `SELECT d.*, p.slug AS project_slug, p.name AS project_name
         FROM deployments d JOIN projects p ON p.id = d.project_id
        WHERE d.id LIKE ? OR d.message LIKE ? OR p.slug LIKE ?
        ORDER BY d.started_at DESC LIMIT 8`,
      like, like, like,
    ).map((row) => deploymentsRepo.mapDeployment(row));

    const logs = logsRepo.listLogs({ search: query, limit: 8 }).items.map(logsRepo.mapLog);

    json(ctx.res, { projects, deployments, logs });
  });
}
