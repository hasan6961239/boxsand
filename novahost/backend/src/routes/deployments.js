import path from 'node:path';
import { json } from '../http/respond.js';
import { errors } from '../http/errors.js';
import { requireAuth } from '../http/middleware/auth.js';
import { enforce } from '../http/middleware/ratelimit.js';
import * as deploymentsRepo from '../db/repo/deployments.js';
import * as logsRepo from '../db/repo/logs.js';
import * as auditRepo from '../db/repo/audit.js';
import * as settingsRepo from '../db/repo/settings.js';
import * as storage from '../services/storage.js';
import { deployFromZip, publishWorkspace, rollback } from '../services/deploy.js';
import { writeZipFile, entriesFromDirectory } from '../services/archive.js';
import { sendFile } from '../http/static.js';
import { loadProject, projectView } from './projects.js';
import { str } from '../util/validate.js';
import { createLogger } from '../logger.js';

const log = createLogger('deployments');

export function register(router) {
  /**
   * Upload and deploy a ZIP.
   *
   * The body is the raw archive, not multipart/form-data. That is a deliberate
   * simplification: the browser can send a File object directly as an XHR body,
   * which gives an upload progress bar for free, and it removes the need for a
   * multipart parser — historically a rich source of parsing bugs — from a
   * server that has to be trustworthy.
   *
   * Metadata travels in the query string, where it is short and easy to validate.
   */
  router.post('/api/projects/:id/deploy', async (ctx) => {
    const user = requireAuth(ctx);
    enforce(ctx, 'upload', ctx.ip);

    const project = loadProject(ctx.params.id);
    const settings = settingsRepo.getAll();
    const maxBytes = settings.maxUploadMb * 1024 * 1024;

    const contentType = String(ctx.header('content-type') ?? '').toLowerCase();
    const looksLikeZip = contentType.includes('zip')
      || contentType.includes('application/octet-stream')
      || contentType === '';
    if (!looksLikeZip) {
      throw errors.unsupportedMedia(
        'Send the .zip file as the raw request body with Content-Type: application/zip',
      );
    }

    const message = ctx.q('message').slice(0, 200);
    const zipPath = await storage.tempFile(`upload-${project.slug}`, '.zip');
    const zipBytes = await ctx.streamToFile(zipPath, { maxBytes });

    log.info('upload received', { project: project.slug, bytes: zipBytes });

    // deployFromZip owns the temp file from here and removes it either way.
    const deployment = await deployFromZip({ project, zipPath, zipBytes, user, message });

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'deployment.create',
      targetType: 'deployment', targetId: deployment.id, targetName: project.slug, ip: ctx.ip,
      meta: { number: deployment.number, source: 'zip', bytes: zipBytes },
    });

    const refreshed = loadProject(project.id);
    json(ctx.res, {
      deployment: deploymentsRepo.mapDeployment(deployment, { currentDeploymentId: refreshed.current_deployment_id }),
      project: await projectView(refreshed),
    }, 201);
  });

  /** Publish the edits made in the file manager as a new deployment. */
  router.post('/api/projects/:id/publish', async (ctx) => {
    const user = requireAuth(ctx);
    enforce(ctx, 'upload', ctx.ip);

    const project = loadProject(ctx.params.id);
    const body = await ctx.json({ required: false });
    const message = str(body, 'message', { required: false, max: 200 }) ?? 'Published from the file editor';

    const deployment = await publishWorkspace({ project, user, message });

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'deployment.publish',
      targetType: 'deployment', targetId: deployment.id, targetName: project.slug, ip: ctx.ip,
      meta: { number: deployment.number, source: 'editor' },
    });

    const refreshed = loadProject(project.id);
    json(ctx.res, {
      deployment: deploymentsRepo.mapDeployment(deployment, { currentDeploymentId: refreshed.current_deployment_id }),
      project: await projectView(refreshed),
    }, 201);
  });

  router.get('/api/projects/:id/deployments', async (ctx) => {
    requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    const { items, total } = deploymentsRepo.listByProject(project.id, {
      limit: ctx.qInt('limit', 50, { min: 1, max: 200 }),
      offset: ctx.qInt('offset', 0, { min: 0, max: 100000 }),
    });
    json(ctx.res, {
      items: items.map((row) => deploymentsRepo.mapDeployment(row, {
        currentDeploymentId: project.current_deployment_id,
      })),
      total,
      currentDeploymentId: project.current_deployment_id,
    });
  });

  router.get('/api/deployments/:deploymentId', async (ctx) => {
    requireAuth(ctx);
    const deployment = deploymentsRepo.findById(ctx.params.deploymentId);
    if (!deployment) throw errors.notFound('DEPLOYMENT_NOT_FOUND', 'Deployment not found');

    const project = loadProject(deployment.project_id);
    const manifest = await storage.readManifest(project.id, deployment.id);

    json(ctx.res, {
      deployment: deploymentsRepo.mapDeployment(deployment, {
        currentDeploymentId: project.current_deployment_id,
      }),
      project: { id: project.id, slug: project.slug, name: project.name },
      // The manifest can hold thousands of entries; send a preview and let the
      // file browser fetch the rest on demand.
      files: manifest?.files?.slice(0, 500) ?? [],
      fileListTruncated: (manifest?.files?.length ?? 0) > 500,
    });
  });

  router.get('/api/deployments/:deploymentId/logs', async (ctx) => {
    requireAuth(ctx);
    const deployment = deploymentsRepo.findById(ctx.params.deploymentId);
    if (!deployment) throw errors.notFound('DEPLOYMENT_NOT_FOUND', 'Deployment not found');

    const items = logsRepo.listByDeployment(deployment.id, {
      limit: ctx.qInt('limit', 500, { min: 1, max: 2000 }),
    });
    json(ctx.res, { items: items.map(logsRepo.mapLog) });
  });

  /** Roll back to a previous deployment — a pointer switch, not a re-upload. */
  router.post('/api/projects/:id/rollback', async (ctx) => {
    const user = requireAuth(ctx);
    enforce(ctx, 'write', ctx.ip);

    const project = loadProject(ctx.params.id);
    const body = await ctx.json();
    const deploymentId = str(body, 'deploymentId', { min: 1, max: 64 });

    const deployment = await rollback({ project, deploymentId, user });

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'deployment.rollback',
      targetType: 'deployment', targetId: deployment.id, targetName: project.slug, ip: ctx.ip,
      meta: { number: deployment.number },
    });

    const refreshed = loadProject(project.id);
    json(ctx.res, {
      deployment: deploymentsRepo.mapDeployment(deployment, { currentDeploymentId: refreshed.current_deployment_id }),
      project: await projectView(refreshed),
    });
  });

  /** Recent deployments across all projects, for the dashboard home. */
  router.get('/api/deployments', async (ctx) => {
    requireAuth(ctx);
    const items = deploymentsRepo.listRecent({
      limit: ctx.qInt('limit', 20, { min: 1, max: 100 }),
      status: ctx.q('status') || null,
    });
    json(ctx.res, { items: items.map((row) => deploymentsRepo.mapDeployment(row)) });
  });

  /** Download the live site as a ZIP — an escape hatch that is not a backup. */
  router.get('/api/projects/:id/download', async (ctx) => {
    requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    if (!project.current_deployment_id) {
      throw errors.notFound('NOTHING_DEPLOYED', 'This project has no deployment to download');
    }

    const source = storage.paths.deployment(project.id, project.current_deployment_id);
    const target = await storage.tempFile(`export-${project.slug}`, '.zip');

    try {
      const entries = (await entriesFromDirectory(source))
        .filter((entry) => !storage.INTERNAL_FILES.has(path.basename(entry.name)));
      await writeZipFile(target, entries);
      await sendFile(ctx, target, {
        cacheControl: 'no-store',
        download: true,
        downloadName: `${project.slug}.zip`,
      });
    } finally {
      // Give the response time to flush before removing the temp file.
      setTimeout(() => {
        import('node:fs/promises').then((fsp) => fsp.rm(target, { force: true }).catch(() => {}));
      }, 60_000).unref?.();
    }
  });
}
