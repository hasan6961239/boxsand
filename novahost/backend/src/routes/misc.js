import path from 'node:path';
import { json, noContent } from '../http/respond.js';
import { errors } from '../http/errors.js';
import { config } from '../config.js';
import { requireAuth } from '../http/middleware/auth.js';
import { enforce } from '../http/middleware/ratelimit.js';
import * as logsRepo from '../db/repo/logs.js';
import * as auditRepo from '../db/repo/audit.js';
import * as settingsRepo from '../db/repo/settings.js';
import * as domainsRepo from '../db/repo/domains.js';
import * as projectsRepo from '../db/repo/projects.js';
import * as backupService from '../services/backup.js';
import * as storage from '../services/storage.js';
import { sendFile } from '../http/static.js';
import { hostname as validateHostname, bool, str } from '../util/validate.js';
import { loadProject } from './projects.js';
import { createLogger } from '../logger.js';

const log = createLogger('misc-api');

/** Logs, settings, domains and backups — the smaller surfaces, in one file. */
export function register(router) {
  // -------------------------------------------------------------------------
  // Logs
  // -------------------------------------------------------------------------

  router.get('/api/logs', async (ctx) => {
    requireAuth(ctx);
    const { items, total } = logsRepo.listLogs({
      level: ctx.q('level') || null,
      projectId: ctx.q('projectId') || null,
      search: ctx.q('search'),
      limit: ctx.qInt('limit', 100, { min: 1, max: 500 }),
      offset: ctx.qInt('offset', 0, { min: 0, max: 100000 }),
    });
    json(ctx.res, { items: items.map(logsRepo.mapLog), total, counts: logsRepo.countByLevel() });
  });

  router.delete('/api/logs', async (ctx) => {
    const user = requireAuth(ctx);
    enforce(ctx, 'write', ctx.ip);
    const removed = logsRepo.clearLogs({ projectId: ctx.q('projectId') || null });
    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'logs.clear', ip: ctx.ip, meta: { removed },
    });
    json(ctx.res, { removed });
  });

  router.get('/api/logs/security', async (ctx) => {
    requireAuth(ctx);
    const { items, total } = auditRepo.listSecurityEvents({
      limit: ctx.qInt('limit', 100, { min: 1, max: 500 }),
      offset: ctx.qInt('offset', 0, { min: 0, max: 100000 }),
      type: ctx.q('type') || null,
    });
    json(ctx.res, { items, total });
  });

  router.get('/api/logs/audit', async (ctx) => {
    requireAuth(ctx);
    const { items, total } = auditRepo.listAudit({
      limit: ctx.qInt('limit', 100, { min: 1, max: 500 }),
      offset: ctx.qInt('offset', 0, { min: 0, max: 100000 }),
      action: ctx.q('action') || null,
    });
    json(ctx.res, { items: items.map(auditRepo.mapAudit), total });
  });

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  router.get('/api/settings', async (ctx) => {
    requireAuth(ctx);
    json(ctx.res, {
      values: settingsRepo.getAll(),
      defaults: settingsRepo.defaults(),
      schema: settingsRepo.SETTINGS_SCHEMA,
      // Read-only facts about how this instance is wired, so the Settings page
      // can explain what is configurable here and what lives in .env.
      environment: {
        appName: config.appName,
        nodeEnv: config.nodeEnv,
        publicUrl: config.publicUrl,
        panelHost: config.panelHost || null,
        sitesDomain: config.sitesDomain || null,
        port: config.port,
        sitesPort: config.sitesPort,
        secureCookies: config.secureCookies,
        trustProxy: config.trustProxy,
        sessionTtlHours: config.sessionTtlHours,
        dataDir: config.dataDir,
      },
    });
  });

  router.patch('/api/settings', async (ctx) => {
    const user = requireAuth(ctx);
    enforce(ctx, 'write', ctx.ip);
    const body = await ctx.json();

    const known = Object.keys(settingsRepo.SETTINGS_SCHEMA);
    const unknown = Object.keys(body).filter((key) => !known.includes(key));
    if (unknown.length > 0) {
      throw errors.badRequest('UNKNOWN_SETTING', `Unknown setting: ${unknown.join(', ')}`);
    }

    let applied;
    try {
      applied = settingsRepo.setMany(body);
    } catch (err) {
      if (err.code === 'INVALID_SETTING' || err.code === 'UNKNOWN_SETTING') {
        throw errors.badRequest(err.code, err.message);
      }
      throw err;
    }

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'settings.update',
      ip: ctx.ip, meta: applied,
    });
    log.info('settings updated', { keys: Object.keys(applied) });

    json(ctx.res, { values: settingsRepo.getAll(), applied });
  });

  // -------------------------------------------------------------------------
  // Custom domains
  // -------------------------------------------------------------------------

  router.get('/api/domains', async (ctx) => {
    requireAuth(ctx);
    json(ctx.res, {
      items: domainsRepo.listAll().map(domainsRepo.mapDomain),
      sitesDomain: config.sitesDomain || null,
    });
  });

  /**
   * Attach a custom domain.
   *
   * The platform cannot issue certificates itself — that is Cloudflare's job in
   * this architecture. What it does is own the hostname mapping and hand you a
   * TXT record to prove the domain is yours before it will serve it, so nobody
   * else can point their domain at your server and have it answer.
   */
  router.post('/api/projects/:id/domains', async (ctx) => {
    const user = requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    const body = await ctx.json();
    const host = validateHostname(body, 'hostname');

    if (config.sitesDomain && host.endsWith(`.${config.sitesDomain}`)) {
      throw errors.badRequest(
        'USE_SLUG_INSTEAD',
        `Subdomains of ${config.sitesDomain} are handled automatically — change the project address instead`,
      );
    }
    if (domainsRepo.findByHostname(host)) {
      throw errors.conflict('DOMAIN_TAKEN', 'That domain is already attached to a project');
    }

    const domain = domainsRepo.createDomain({
      projectId: project.id,
      hostname: host,
      isPrimary: bool(body, 'isPrimary', { fallback: false }),
    });

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'domain.add',
      targetType: 'domain', targetId: domain.id, targetName: host, ip: ctx.ip,
    });

    json(ctx.res, {
      domain: domainsRepo.mapDomain(domain),
      instructions: {
        txtRecord: { name: `_novahost.${host}`, type: 'TXT', value: domain.verification_token },
        cname: { name: host, type: 'CNAME', value: `${project.slug}.${config.sitesDomain || 'your-tunnel-hostname'}` },
        note: 'Add the TXT record, then press Verify. Point the hostname at your Cloudflare tunnel with the CNAME.',
      },
    }, 201);
  });

  /**
   * Verify ownership via DNS TXT.
   *
   * Node's resolver is used directly rather than the OS one, because Android's
   * resolver configuration is not readable from Termux and the system call
   * would fail in a way that looks like "domain not verified".
   */
  router.post('/api/domains/:domainId/verify', async (ctx) => {
    const user = requireAuth(ctx);
    const domain = domainsRepo.findById(ctx.params.domainId);
    if (!domain) throw errors.notFound('DOMAIN_NOT_FOUND', 'Domain not found');

    const { Resolver } = await import('node:dns/promises');
    const resolver = new Resolver({ timeout: 5000, tries: 2 });
    resolver.setServers(['1.1.1.1', '8.8.8.8']);

    let records = [];
    try {
      records = await resolver.resolveTxt(`_novahost.${domain.hostname}`);
    } catch (err) {
      throw errors.badRequest(
        'DNS_LOOKUP_FAILED',
        `Could not read the TXT record for _novahost.${domain.hostname} (${err.code ?? 'lookup failed'}). DNS changes can take a few minutes.`,
      );
    }

    const flattened = records.map((chunks) => chunks.join(''));
    const verified = flattened.includes(domain.verification_token);
    const updated = domainsRepo.setVerified(domain.id, verified);

    if (!verified) {
      throw errors.badRequest(
        'VERIFICATION_FAILED',
        `The TXT record does not match yet. Expected "${domain.verification_token}".`,
      );
    }

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'domain.verify',
      targetType: 'domain', targetId: domain.id, targetName: domain.hostname, ip: ctx.ip,
    });
    json(ctx.res, { domain: domainsRepo.mapDomain(updated) });
  });

  router.delete('/api/domains/:domainId', async (ctx) => {
    const user = requireAuth(ctx);
    const domain = domainsRepo.findById(ctx.params.domainId);
    if (!domain) throw errors.notFound('DOMAIN_NOT_FOUND', 'Domain not found');

    domainsRepo.deleteDomain(domain.id);
    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'domain.remove',
      targetType: 'domain', targetId: domain.id, targetName: domain.hostname, ip: ctx.ip,
    });
    noContent(ctx.res);
  });

  // -------------------------------------------------------------------------
  // Backups
  // -------------------------------------------------------------------------

  router.get('/api/backups', async (ctx) => {
    requireAuth(ctx);
    const items = await backupService.listBackups();
    json(ctx.res, { items, usage: await backupService.backupsUsage() });
  });

  router.post('/api/backups', async (ctx) => {
    const user = requireAuth(ctx);
    enforce(ctx, 'upload', ctx.ip);

    const body = await ctx.json({ required: false });
    const includeSites = bool(body, 'includeSites', { fallback: true });
    const note = str(body, 'note', { required: false, max: 200, allowEmpty: true }) ?? '';

    const backup = await backupService.createBackup({ includeSites, note });
    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'backup.create',
      targetType: 'backup', targetId: backup.id, ip: ctx.ip,
      meta: { size: backup.size, includeSites },
    });
    json(ctx.res, { backup }, 201);
  });

  router.get('/api/backups/:backupId/download', async (ctx) => {
    requireAuth(ctx);
    const file = backupService.backupPath(ctx.params.backupId);
    const sent = await sendFile(ctx, file, {
      cacheControl: 'no-store',
      download: true,
      downloadName: path.basename(file),
    });
    if (!sent) throw errors.notFound('BACKUP_NOT_FOUND', 'That backup no longer exists');
  });

  router.delete('/api/backups/:backupId', async (ctx) => {
    const user = requireAuth(ctx);
    await backupService.deleteBackup(ctx.params.backupId);
    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'backup.delete',
      targetType: 'backup', targetId: ctx.params.backupId, ip: ctx.ip,
    });
    noContent(ctx.res);
  });

  /**
   * Restore from an uploaded backup.
   *
   * Destructive, so it demands an explicit confirmation string and takes its own
   * safety backup first. See services/backup.js for the ordering that makes a
   * failure recoverable.
   */
  router.post('/api/backups/restore', async (ctx) => {
    const user = requireAuth(ctx);
    enforce(ctx, 'upload', ctx.ip);

    if (ctx.q('confirm') !== 'restore') {
      throw errors.badRequest(
        'CONFIRMATION_REQUIRED',
        'Restoring replaces your current data. Add ?confirm=restore to proceed.',
      );
    }

    const settings = settingsRepo.getAll();
    const uploadPath = await storage.tempFile('restore-upload', '.zip');
    const bytes = await ctx.streamToFile(uploadPath, {
      maxBytes: Math.max(settings.maxUploadMb, 512) * 1024 * 1024,
    });

    log.warn('restore started', { by: user.username, bytes });
    const result = await backupService.restoreBackup({ archivePath: uploadPath });

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'backup.restore',
      targetType: 'backup', targetId: result.restored.id, ip: ctx.ip,
      meta: { safetyBackupId: result.safetyBackupId },
    });

    json(ctx.res, {
      restored: result.restored,
      safetyBackupId: result.safetyBackupId,
      note: 'Sign in again — the restored database has its own sessions.',
    });
  });

  // -------------------------------------------------------------------------
  // Convenience
  // -------------------------------------------------------------------------

  /** Slug preview for the new-project form, so the URL updates as you type. */
  router.get('/api/slug-preview', async (ctx) => {
    requireAuth(ctx);
    const { slugifyOrFallback, isValidSlug, uniqueSlug } = await import('../util/slug.js');
    const name = ctx.q('name').slice(0, 100);
    if (!name) {
      json(ctx.res, { slug: '', available: false });
      return;
    }
    const base = slugifyOrFallback(name, '');
    if (!base) {
      json(ctx.res, { slug: '', available: false, reason: 'UNUSABLE_NAME' });
      return;
    }
    const slug = uniqueSlug(base, projectsRepo.slugTaken);
    json(ctx.res, { slug, available: isValidSlug(slug), adjusted: slug !== base });
  });
}
