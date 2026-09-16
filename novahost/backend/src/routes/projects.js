import { json, noContent } from '../http/respond.js';
import { errors } from '../http/errors.js';
import { requireAuth } from '../http/middleware/auth.js';
import { enforce } from '../http/middleware/ratelimit.js';
import * as projectsRepo from '../db/repo/projects.js';
import * as deploymentsRepo from '../db/repo/deployments.js';
import * as domainsRepo from '../db/repo/domains.js';
import * as auditRepo from '../db/repo/audit.js';
import * as storage from '../services/storage.js';
import { projectUrls } from '../services/sites.js';
import { str, enumValue, bool } from '../util/validate.js';
import { slugifyOrFallback, isValidSlug, uniqueSlug, RESERVED_SLUGS } from '../util/slug.js';
import { shortId } from '../util/id.js';
import { createLogger } from '../logger.js';

const log = createLogger('projects');

const VISIBILITIES = ['public', 'private'];
const FRAMEWORKS = ['static', 'html', 'react', 'vue', 'svelte', 'other'];
const BUILD_TYPES = ['none', 'prebuilt'];

/** Load a project by id or slug, or throw 404. */
export function loadProject(idOrSlug) {
  const project = projectsRepo.findById(idOrSlug) ?? projectsRepo.findBySlug(idOrSlug);
  if (!project) throw errors.notFound('PROJECT_NOT_FOUND', 'Project not found');
  return project;
}

/** Full project view, including URLs and workspace state. */
export async function projectView(project) {
  const base = projectsRepo.mapProject(project);
  const current = project.current_deployment_id
    ? deploymentsRepo.findById(project.current_deployment_id)
    : null;
  const workspaceMeta = await storage.readWorkspaceMeta(project.id);

  return {
    ...base,
    urls: projectUrls(project),
    currentDeployment: current ? deploymentsRepo.mapDeployment(current, { currentDeploymentId: project.current_deployment_id }) : null,
    domains: domainsRepo.listByProject(project.id).map(domainsRepo.mapDomain),
    workspace: workspaceMeta
      ? { seededFrom: workspaceMeta.seededFrom, dirty: Boolean(workspaceMeta.dirty), updatedAt: workspaceMeta.updatedAt }
      : { seededFrom: null, dirty: false, updatedAt: null },
  };
}

export function register(router) {
  router.get('/api/projects', async (ctx) => {
    requireAuth(ctx);
    const { items, total } = projectsRepo.listProjects({
      search: ctx.q('search'),
      limit: ctx.qInt('limit', 50, { min: 1, max: 200 }),
      offset: ctx.qInt('offset', 0, { min: 0, max: 100000 }),
      sort: ctx.q('sort', 'updated'),
      dir: ctx.q('dir', 'desc'),
      visibility: ctx.q('visibility') || null,
    });

    json(ctx.res, {
      items: items.map((row) => ({
        ...projectsRepo.mapProject(row),
        urls: projectUrls(row),
      })),
      total,
    });
  });

  /**
   * Create a project.
   *
   * The slug is what ends up in the hostname, so it has to be a valid DNS
   * label. An Arabic name is transliterated into a starting point the user can
   * override, and a collision appends -2, -3 … rather than failing — except
   * when the user typed the slug themselves, where a silent change would be
   * worse than an error.
   */
  router.post('/api/projects', async (ctx) => {
    const user = requireAuth(ctx);
    enforce(ctx, 'write', ctx.ip);

    const body = await ctx.json();
    const name = str(body, 'name', { min: 1, max: 100 });
    const description = str(body, 'description', { required: false, max: 500, allowEmpty: true }) ?? '';
    const visibility = enumValue(body, 'visibility', VISIBILITIES, { required: false, fallback: 'public' });
    const framework = enumValue(body, 'framework', FRAMEWORKS, { required: false, fallback: 'static' });
    const buildType = enumValue(body, 'buildType', BUILD_TYPES, { required: false, fallback: 'none' });
    const requestedSlug = str(body, 'slug', { required: false, max: 63 });

    let slug;
    if (requestedSlug) {
      slug = requestedSlug.toLowerCase();
      if (!isValidSlug(slug)) {
        const reason = RESERVED_SLUGS.has(slug) ? 'SLUG_RESERVED' : 'SLUG_INVALID';
        throw errors.validation(
          [{
            field: 'slug',
            code: reason,
            message: reason === 'SLUG_RESERVED'
              ? `"${slug}" is reserved by the platform`
              : 'Use lowercase letters, numbers and hyphens only',
          }],
          'That address is not usable',
        );
      }
      if (projectsRepo.slugTaken(slug)) {
        throw errors.conflict('SLUG_TAKEN', `A project already uses the address "${slug}"`);
      }
    } else {
      const base = slugifyOrFallback(name, `site-${shortId(6)}`);
      slug = uniqueSlug(base, projectsRepo.slugTaken);
    }

    const project = projectsRepo.createProject({
      slug, name, description, visibility, framework, buildType, ownerId: user.id,
    });
    await storage.initProjectStorage(project.id);

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'project.create',
      targetType: 'project', targetId: project.id, targetName: project.slug, ip: ctx.ip,
    });
    log.info('project created', { slug, by: user.username });

    json(ctx.res, { project: await projectView(project) }, 201);
  });

  router.get('/api/projects/:id', async (ctx) => {
    requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    json(ctx.res, { project: await projectView(project) });
  });

  router.patch('/api/projects/:id', async (ctx) => {
    const user = requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    const body = await ctx.json();

    const fields = {
      name: str(body, 'name', { required: false, min: 1, max: 100 }),
      description: str(body, 'description', { required: false, max: 500, allowEmpty: true }),
      visibility: enumValue(body, 'visibility', VISIBILITIES, { required: false, fallback: null }),
      framework: enumValue(body, 'framework', FRAMEWORKS, { required: false, fallback: null }),
      buildType: enumValue(body, 'buildType', BUILD_TYPES, { required: false, fallback: null }),
      enabled: bool(body, 'enabled', { fallback: undefined }),
    };

    let updated = projectsRepo.updateProject(project.id, fields);

    // Renaming the slug changes every published URL, so it is handled
    // separately and validated exactly like creation.
    const newSlug = str(body, 'slug', { required: false, max: 63 });
    if (newSlug && newSlug.toLowerCase() !== project.slug) {
      const slug = newSlug.toLowerCase();
      if (!isValidSlug(slug)) {
        throw errors.validation(
          [{ field: 'slug', code: 'SLUG_INVALID', message: 'Use lowercase letters, numbers and hyphens only' }],
          'That address is not usable',
        );
      }
      if (projectsRepo.slugTaken(slug)) {
        throw errors.conflict('SLUG_TAKEN', `A project already uses the address "${slug}"`);
      }
      updated = projectsRepo.renameSlug(project.id, slug);
      auditRepo.record({
        actorId: user.id, actorName: user.username, action: 'project.rename',
        targetType: 'project', targetId: project.id, targetName: slug, ip: ctx.ip,
        meta: { from: project.slug, to: slug },
      });
    }

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'project.update',
      targetType: 'project', targetId: project.id, targetName: updated.slug, ip: ctx.ip,
    });

    json(ctx.res, { project: await projectView(updated) });
  });

  /** Pause or resume serving. A paused site answers 503 instead of 404. */
  router.post('/api/projects/:id/enabled', async (ctx) => {
    const user = requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    const body = await ctx.json();
    const enabled = bool(body, 'enabled', { fallback: !project.enabled });

    const updated = projectsRepo.setEnabled(project.id, enabled);
    auditRepo.record({
      actorId: user.id, actorName: user.username,
      action: enabled ? 'project.resume' : 'project.pause',
      targetType: 'project', targetId: project.id, targetName: project.slug, ip: ctx.ip,
    });
    json(ctx.res, { project: await projectView(updated) });
  });

  /**
   * Delete a project and everything it owns.
   *
   * The client must echo back the exact slug. That is not ceremony: this
   * removes every deployment and there is no undo short of a backup, so the
   * confirmation has to be impossible to click through by accident.
   */
  router.delete('/api/projects/:id', async (ctx) => {
    const user = requireAuth(ctx);
    const project = loadProject(ctx.params.id);

    const confirmation = ctx.q('confirm');
    if (confirmation !== project.slug) {
      throw errors.badRequest(
        'CONFIRMATION_REQUIRED',
        `To delete this project, confirm by sending its address ("${project.slug}")`,
      );
    }

    projectsRepo.deleteProject(project.id);
    await storage.removeProjectStorage(project.id);

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'project.delete',
      targetType: 'project', targetId: project.id, targetName: project.slug, ip: ctx.ip,
      meta: { name: project.name },
    });
    log.warn('project deleted', { slug: project.slug, by: user.username });

    noContent(ctx.res);
  });

  /** Per-project statistics for the project overview page. */
  router.get('/api/projects/:id/stats', async (ctx) => {
    requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    const usage = await storage.projectUsage(project.id);
    const { total: deploymentCount } = deploymentsRepo.listByProject(project.id, { limit: 1 });

    json(ctx.res, {
      storage: usage,
      deployments: deploymentCount,
      files: project.file_count,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      lastDeployedAt: project.last_deployed_at,
    });
  });
}
