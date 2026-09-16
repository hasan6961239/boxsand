import path from 'node:path';
import fsp from 'node:fs/promises';
import { json, noContent } from '../http/respond.js';
import { errors } from '../http/errors.js';
import { requireAuth } from '../http/middleware/auth.js';
import { enforce } from '../http/middleware/ratelimit.js';
import * as auditRepo from '../db/repo/audit.js';
import * as settingsRepo from '../db/repo/settings.js';
import * as storage from '../services/storage.js';
import { sendFile } from '../http/static.js';
import { isEditable, isImage, languageFor, contentTypeFor } from '../http/mime.js';
import { safeJoin, ensureDir, removeRecursive, pathExists, isDirectory, atomicWriteFile } from '../util/fsx.js';
import { str } from '../util/validate.js';
import { loadProject } from './projects.js';
import { createLogger } from '../logger.js';

const log = createLogger('files');

/** Text files above this are refused by the editor rather than hanging a phone. */
const MAX_EDIT_BYTES = 2 * 1024 * 1024;

/**
 * The file manager edits a working copy, never a published deployment.
 *
 * A deployment has to stay exactly what was published or rollback means
 * nothing. So every write here lands in sites/<id>/workspace/, and "Publish"
 * snapshots that directory into a new deployment. The cost is one copy the
 * first time you edit a project; the benefit is that version history is real.
 */
async function workspaceFor(project) {
  return storage.ensureWorkspace(project.id, project.current_deployment_id);
}

/** Resolve a user-supplied path inside the workspace, or throw a clean 400. */
function resolveInWorkspace(root, userPath) {
  try {
    return safeJoin(root, userPath ?? '');
  } catch {
    throw errors.badRequest('INVALID_PATH', 'That file path is not allowed');
  }
}

async function describeEntry(root, relative) {
  const abs = path.join(root, relative);
  const stat = await fsp.lstat(abs);
  const name = path.basename(relative);
  if (stat.isDirectory()) {
    return { name, path: relative, type: 'dir', size: 0, modifiedAt: new Date(stat.mtimeMs).toISOString() };
  }
  return {
    name,
    path: relative,
    type: stat.isSymbolicLink() ? 'symlink' : 'file',
    size: stat.size,
    modifiedAt: new Date(stat.mtimeMs).toISOString(),
    editable: isEditable(name) && stat.size <= MAX_EDIT_BYTES,
    previewable: isImage(name),
    contentType: contentTypeFor(name),
  };
}

export function register(router) {
  /** List one directory. Directories first, then files, both alphabetical. */
  router.get('/api/projects/:id/files', async (ctx) => {
    requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    const root = await workspaceFor(project);
    const relative = ctx.q('path', '');
    const target = resolveInWorkspace(root, relative);

    if (!(await pathExists(target))) {
      throw errors.notFound('PATH_NOT_FOUND', 'That folder does not exist');
    }
    if (!(await isDirectory(target))) {
      throw errors.badRequest('NOT_A_DIRECTORY', 'That path is a file, not a folder');
    }

    const names = await fsp.readdir(target);
    const items = [];
    for (const name of names) {
      if (storage.INTERNAL_FILES.has(name)) continue;
      const childRelative = relative ? `${relative.replace(/\/+$/, '')}/${name}` : name;
      try {
        items.push(await describeEntry(root, childRelative));
      } catch { /* vanished mid-listing */ }
    }

    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    const meta = await storage.readWorkspaceMeta(project.id);
    json(ctx.res, {
      path: relative,
      items,
      workspace: { dirty: Boolean(meta?.dirty), seededFrom: meta?.seededFrom ?? null },
    });
  });

  /** Read a text file into the editor. */
  router.get('/api/projects/:id/files/content', async (ctx) => {
    requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    const root = await workspaceFor(project);
    const relative = ctx.q('path');
    if (!relative) throw errors.badRequest('PATH_REQUIRED', 'Which file?');

    const target = resolveInWorkspace(root, relative);
    let stat;
    try {
      stat = await fsp.lstat(target);
    } catch {
      throw errors.notFound('FILE_NOT_FOUND', 'That file does not exist');
    }
    if (!stat.isFile()) throw errors.badRequest('NOT_A_FILE', 'That path is not a file');
    if (stat.size > MAX_EDIT_BYTES) {
      throw errors.tooLarge('FILE_TOO_LARGE_TO_EDIT', 'That file is too large to open in the editor');
    }
    if (!isEditable(path.basename(relative))) {
      throw errors.badRequest('NOT_EDITABLE', 'That file type cannot be opened as text');
    }

    const content = await fsp.readFile(target, 'utf8');
    json(ctx.res, {
      path: relative,
      content,
      size: stat.size,
      language: languageFor(relative),
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
    });
  });

  /**
   * Serve a workspace file to the browser (image previews, font checks).
   * Always sent as an attachment-safe download rather than rendered inline:
   * this endpoint is on the panel origin, so rendering an uploaded HTML file
   * here would hand it the dashboard's origin. Previewing the real site is
   * what the sites port is for.
   */
  router.get('/api/projects/:id/files/raw', async (ctx) => {
    requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    const root = await workspaceFor(project);
    const relative = ctx.q('path');
    if (!relative) throw errors.badRequest('PATH_REQUIRED', 'Which file?');

    const target = resolveInWorkspace(root, relative);
    const download = ctx.q('download') === '1';
    const isPreviewableImage = isImage(path.basename(relative));

    const sent = await sendFile(ctx, target, {
      cacheControl: 'no-store',
      download: download || !isPreviewableImage,
      downloadName: path.basename(relative),
      headers: { 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; sandbox" },
    });
    if (!sent) throw errors.notFound('FILE_NOT_FOUND', 'That file does not exist');
  });

  /**
   * Write a file. The body is the raw bytes, so this handles both "save from
   * the editor" and "upload a single file" with one code path.
   */
  router.put('/api/projects/:id/files', async (ctx) => {
    const user = requireAuth(ctx);
    enforce(ctx, 'write', ctx.ip);

    const project = loadProject(ctx.params.id);
    const root = await workspaceFor(project);
    const relative = ctx.q('path');
    if (!relative) throw errors.badRequest('PATH_REQUIRED', 'Where should this be saved?');

    const target = resolveInWorkspace(root, relative);
    if (await isDirectory(target)) {
      throw errors.conflict('IS_A_DIRECTORY', 'A folder already exists at that path');
    }

    const settings = settingsRepo.getAll();
    const limit = settings.maxSingleFileMb * 1024 * 1024;
    const data = await ctx.buffer({ limit });

    await storage.assertSpaceAvailable(data.length);
    await ensureDir(path.dirname(target));
    // Atomic write: a save interrupted by an Android process kill leaves the
    // previous version intact rather than a truncated file.
    await atomicWriteFile(target, data);
    await storage.markWorkspaceDirty(project.id);

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'file.write',
      targetType: 'file', targetId: project.id, targetName: relative, ip: ctx.ip,
      meta: { bytes: data.length },
    });
    log.info('file written', { project: project.slug, path: relative, bytes: data.length });

    json(ctx.res, { path: relative, size: data.length, dirty: true });
  });

  router.post('/api/projects/:id/files/folder', async (ctx) => {
    const user = requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    const root = await workspaceFor(project);
    const body = await ctx.json();
    const relative = str(body, 'path', { min: 1, max: 1024 });

    const target = resolveInWorkspace(root, relative);
    if (await pathExists(target)) {
      throw errors.conflict('ALREADY_EXISTS', 'Something already exists at that path');
    }
    await ensureDir(target);
    await storage.markWorkspaceDirty(project.id);

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'file.mkdir',
      targetType: 'file', targetId: project.id, targetName: relative, ip: ctx.ip,
    });
    json(ctx.res, { path: relative, type: 'dir' }, 201);
  });

  router.post('/api/projects/:id/files/rename', async (ctx) => {
    const user = requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    const root = await workspaceFor(project);
    const body = await ctx.json();

    const from = str(body, 'from', { min: 1, max: 1024 });
    const to = str(body, 'to', { min: 1, max: 1024 });

    const source = resolveInWorkspace(root, from);
    const destination = resolveInWorkspace(root, to);

    if (!(await pathExists(source))) throw errors.notFound('FILE_NOT_FOUND', 'That file does not exist');
    if (await pathExists(destination)) {
      throw errors.conflict('ALREADY_EXISTS', 'Something already exists at the new path');
    }
    // Moving a folder into itself would silently destroy it.
    if (destination.startsWith(`${source}${path.sep}`)) {
      throw errors.badRequest('INVALID_MOVE', 'A folder cannot be moved inside itself');
    }

    await ensureDir(path.dirname(destination));
    await fsp.rename(source, destination);
    await storage.markWorkspaceDirty(project.id);

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'file.rename',
      targetType: 'file', targetId: project.id, targetName: to, ip: ctx.ip,
      meta: { from, to },
    });
    json(ctx.res, { from, to });
  });

  router.delete('/api/projects/:id/files', async (ctx) => {
    const user = requireAuth(ctx);
    const project = loadProject(ctx.params.id);
    const root = await workspaceFor(project);
    const relative = ctx.q('path');
    if (!relative) throw errors.badRequest('PATH_REQUIRED', 'Which file?');

    const target = resolveInWorkspace(root, relative);
    if (target === path.resolve(root)) {
      throw errors.badRequest('CANNOT_DELETE_ROOT', 'You cannot delete the project root');
    }
    if (!(await pathExists(target))) throw errors.notFound('FILE_NOT_FOUND', 'That file does not exist');

    const wasDirectory = await isDirectory(target);
    await removeRecursive(target);
    await storage.markWorkspaceDirty(project.id);

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'file.delete',
      targetType: 'file', targetId: project.id, targetName: relative, ip: ctx.ip,
      meta: { directory: wasDirectory },
    });
    log.info('file deleted', { project: project.slug, path: relative });

    noContent(ctx.res);
  });

  /**
   * Throw away working changes and re-seed from the live deployment.
   * Safe by construction: it only ever deletes the working copy, never a
   * published deployment.
   */
  router.post('/api/projects/:id/files/discard', async (ctx) => {
    const user = requireAuth(ctx);
    const project = loadProject(ctx.params.id);

    await storage.resetWorkspace(project.id);
    await storage.ensureWorkspace(project.id, project.current_deployment_id);

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'file.discard',
      targetType: 'project', targetId: project.id, targetName: project.slug, ip: ctx.ip,
    });
    json(ctx.res, { discarded: true, seededFrom: project.current_deployment_id });
  });
}
