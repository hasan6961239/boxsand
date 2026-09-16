import path from 'node:path';
import fsp from 'node:fs/promises';
import { AppError } from '../http/errors.js';
import { createLogger } from '../logger.js';
import { getDatabase } from '../db/index.js';
import * as projectsRepo from '../db/repo/projects.js';
import * as deploymentsRepo from '../db/repo/deployments.js';
import * as logsRepo from '../db/repo/logs.js';
import * as settingsRepo from '../db/repo/settings.js';
import { deploymentId as makeDeploymentId } from '../util/id.js';
import { nowIso } from '../util/time.js';
import { copyDirectory, removeRecursive, walkDir, pathExists } from '../util/fsx.js';
import { extractArchive } from './zip.js';
import * as storage from './storage.js';

const log = createLogger('deploy');

/** Write a line to both the app log and the deployment's own transcript. */
function step(deployment, message, meta = {}) {
  logsRepo.insertLog({
    ts: nowIso(),
    level: meta.level ?? 'info',
    module: 'deploy',
    message,
    projectId: deployment.project_id,
    deploymentId: deployment.id,
    meta: Object.keys(meta).length ? JSON.stringify(meta) : null,
  });
  log.debug(message, { deploymentId: deployment.id });
}

function limitsFromSettings() {
  const s = settingsRepo.getAll();
  return {
    maxEntries: s.maxFilesPerDeploy,
    maxUncompressedBytes: s.maxUncompressedMb * 1024 * 1024,
    maxSingleFileBytes: s.maxSingleFileMb * 1024 * 1024,
    maxCompressionRatio: s.maxCompressionRatio,
  };
}

/**
 * Decide which file answers a request for "/".
 *
 * index.html is what everyone expects. A single stray HTML file at the root is
 * accepted with a warning because refusing it would be pedantic when the intent
 * is obvious. Anything else fails loudly: publishing a site whose front page
 * 404s is worse than a deploy that tells you why.
 */
function resolveEntryFile(files) {
  const rootFiles = files.filter((f) => !f.path.includes('/'));
  const index = rootFiles.find((f) => /^index\.html?$/i.test(f.path));
  if (index) return { entry: index.path, warning: null };

  const htmlFiles = rootFiles.filter((f) => /\.html?$/i.test(f.path));
  if (htmlFiles.length === 1) {
    return {
      entry: htmlFiles[0].path,
      warning: `No index.html found — serving "${htmlFiles[0].path}" as the home page instead`,
    };
  }
  return { entry: null, warning: null };
}

async function finaliseDeployment({ project, deployment, stagingDir, files, totalBytes, strippedRoot }) {
  const { entry, warning } = resolveEntryFile(files);
  if (!entry) {
    throw new AppError(
      'NO_INDEX_HTML',
      'No index.html was found at the top level of the upload. Add one, or zip the contents of your site folder rather than the folder itself.',
      { status: 422 },
    );
  }
  if (warning) step(deployment, warning, { level: 'warn' });

  step(deployment, `Entry file detected: ${entry}`);

  await storage.writeManifest(project.id, path.basename(stagingDir), {
    deploymentId: deployment.id,
    projectId: project.id,
    createdAt: nowIso(),
    entryFile: entry,
    strippedRoot,
    fileCount: files.length,
    totalBytes,
    files: files.map((f) => ({ path: f.path, size: f.size })),
  });

  // Atomic publish: everything above happened in <id>.partial, and this single
  // rename is the moment the new version becomes live. A failure before this
  // line leaves the running site untouched.
  deploymentsRepo.setStatus(deployment.id, deploymentsRepo.STATUS.DEPLOYING);
  const finalDir = storage.paths.deployment(project.id, deployment.id);
  await removeRecursive(finalDir);
  await fsp.rename(stagingDir, finalDir);
  step(deployment, 'Files published');

  const usage = await storage.projectUsage(project.id);

  const db = getDatabase();
  db.transaction(() => {
    deploymentsRepo.markReady(deployment.id, { fileCount: files.length, totalBytes, entryFile: entry });
    projectsRepo.setCurrentDeployment(project.id, deployment.id, {
      status: 'ready',
      fileCount: files.length,
      storageBytes: usage.total,
    });
  });

  await storage.writeCurrentPointer(project.id, deployment.id);
  step(deployment, 'Deployment successful');

  return deploymentsRepo.findById(deployment.id);
}

async function failDeployment(deployment, err, stagingDir) {
  const appError = err instanceof AppError ? err : null;
  const code = appError?.code ?? err?.code ?? 'DEPLOY_FAILED';
  const message = appError?.message ?? err?.message ?? 'Deployment failed';

  if (stagingDir) await removeRecursive(stagingDir).catch(() => {});

  deploymentsRepo.markFailed(deployment.id, { code, message });
  step(deployment, `Deployment failed: ${message}`, { level: 'error', code });
  log.warn('deployment failed', { deploymentId: deployment.id, code, message });
}

/**
 * Deploy an uploaded archive.
 * `zipPath` is a file already streamed to disk by the route; this function owns
 * it from here and deletes it on the way out.
 */
export async function deployFromZip({ project, zipPath, zipBytes, user = null, message = '' }) {
  const number = projectsRepo.nextDeploymentNumber(project.id);
  const id = makeDeploymentId();

  const deployment = deploymentsRepo.createDeployment({
    id, projectId: project.id, number, source: 'zip', message,
    createdBy: user?.id ?? null, zipBytes,
  });

  step(deployment, `Upload received (${zipBytes} bytes)`);

  const stagingDir = `${storage.paths.deployment(project.id, id)}.partial`;

  try {
    await storage.initProjectStorage(project.id);
    deploymentsRepo.setStatus(id, deploymentsRepo.STATUS.BUILDING);
    step(deployment, 'Validating archive');

    const limits = limitsFromSettings();
    // Assume worst-case expansion up to the configured ceiling before touching
    // the disk, so we fail on a full device before writing a partial site.
    await storage.assertSpaceAvailable(Math.min(zipBytes * 5, limits.maxUncompressedBytes));

    await removeRecursive(stagingDir);
    step(deployment, 'Extracting files');

    const result = await extractArchive(zipPath, stagingDir, { limits, stripRoot: true });

    if (result.strippedRoot) {
      step(deployment, `Using "${result.strippedRoot}/" as the site root`);
    }
    step(deployment, `Extracted ${result.fileCount} files (${result.totalBytes} bytes)`);

    const finished = await finaliseDeployment({
      project,
      deployment,
      stagingDir,
      files: result.files,
      totalBytes: result.totalBytes,
      strippedRoot: result.strippedRoot,
    });

    // The working copy now belongs to an older version of the site; drop it so
    // the file manager re-seeds from what is actually live.
    await storage.resetWorkspace(project.id);
    await pruneOldDeployments(project.id);

    return finished;
  } catch (err) {
    await failDeployment(deployment, err, stagingDir);
    throw err;
  } finally {
    await fsp.rm(zipPath, { force: true }).catch(() => {});
  }
}

/**
 * Publish the working copy the file manager has been editing as a new deployment.
 * This is what makes "edit index.html, save, deploy" produce a real version you
 * can roll back to, rather than mutating history in place.
 */
export async function publishWorkspace({ project, user = null, message = '' }) {
  const workspace = storage.paths.workspace(project.id);
  if (!(await pathExists(workspace))) {
    throw new AppError('NOTHING_TO_PUBLISH', 'There are no edited files to publish', { status: 409 });
  }

  const entries = await walkDir(workspace);
  const files = entries
    .filter((e) => e.type === 'file' && !storage.INTERNAL_FILES.has(path.basename(e.path)))
    .map((e) => ({ path: e.path, size: e.size }));

  if (files.length === 0) {
    throw new AppError('NOTHING_TO_PUBLISH', 'The working copy is empty', { status: 409 });
  }

  const number = projectsRepo.nextDeploymentNumber(project.id);
  const id = makeDeploymentId();
  const deployment = deploymentsRepo.createDeployment({
    id, projectId: project.id, number, source: 'editor', message,
    createdBy: user?.id ?? null, zipBytes: 0,
  });

  const stagingDir = `${storage.paths.deployment(project.id, id)}.partial`;
  step(deployment, `Publishing ${files.length} edited files`);

  try {
    deploymentsRepo.setStatus(id, deploymentsRepo.STATUS.BUILDING);
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    await storage.assertSpaceAvailable(totalBytes);

    await removeRecursive(stagingDir);
    await copyDirectory(workspace, stagingDir);

    const finished = await finaliseDeployment({
      project, deployment, stagingDir, files, totalBytes, strippedRoot: null,
    });

    await storage.writeWorkspaceMeta(project.id, {
      seededFrom: id,
      dirty: false,
      updatedAt: nowIso(),
    });
    await pruneOldDeployments(project.id);
    return finished;
  } catch (err) {
    await failDeployment(deployment, err, stagingDir);
    throw err;
  }
}

/**
 * Roll back by re-pointing at an existing deployment.
 *
 * No files are copied and no new deployment is created: the old snapshot is
 * still on disk, so switching is a pointer update that takes milliseconds. That
 * is also why KEEP_DEPLOYMENTS matters — you can only roll back to a version
 * that has not been pruned.
 */
export async function rollback({ project, deploymentId, user = null }) {
  const target = deploymentsRepo.findById(deploymentId);
  if (!target || target.project_id !== project.id) {
    throw new AppError('DEPLOYMENT_NOT_FOUND', 'That deployment does not belong to this project', { status: 404 });
  }
  if (target.status !== deploymentsRepo.STATUS.READY) {
    throw new AppError('DEPLOYMENT_NOT_READY', 'You can only roll back to a deployment that succeeded', { status: 409 });
  }
  if (project.current_deployment_id === target.id) {
    throw new AppError('ALREADY_CURRENT', 'That deployment is already the live one', { status: 409 });
  }

  const dir = storage.paths.deployment(project.id, target.id);
  if (!(await pathExists(dir))) {
    throw new AppError(
      'DEPLOYMENT_FILES_MISSING',
      'The files for that deployment are no longer on disk — it was pruned by the retention policy',
      { status: 410 },
    );
  }

  const usage = await storage.projectUsage(project.id);
  const db = getDatabase();
  db.transaction(() => {
    projectsRepo.setCurrentDeployment(project.id, target.id, {
      status: 'ready',
      fileCount: target.file_count,
      storageBytes: usage.total,
    });
  });
  await storage.writeCurrentPointer(project.id, target.id);

  // The working copy came from a different version; drop it so the file manager
  // shows what is actually live now.
  await storage.resetWorkspace(project.id);

  logsRepo.insertLog({
    ts: nowIso(),
    level: 'info',
    module: 'deploy',
    message: `Rolled back to deployment #${target.number}`,
    projectId: project.id,
    deploymentId: target.id,
    meta: JSON.stringify({ by: user?.username ?? 'system' }),
  });
  log.info('rollback', { project: project.slug, to: target.id });

  return deploymentsRepo.findById(target.id);
}

/** Delete deployments beyond the retention window, never the live one. */
export async function pruneOldDeployments(projectId) {
  const keep = settingsRepo.get('keepDeployments');
  const project = projectsRepo.findById(projectId);
  if (!project) return 0;

  const ids = deploymentsRepo.prunableDeployments(projectId, keep, project.current_deployment_id);
  let removed = 0;
  for (const id of ids) {
    await storage.removeDeploymentStorage(projectId, id);
    deploymentsRepo.deleteDeployment(id);
    removed += 1;
  }
  if (removed > 0) {
    const usage = await storage.projectUsage(projectId);
    projectsRepo.updateStorage(projectId, {
      storageBytes: usage.total,
      fileCount: project.file_count,
    });
    log.info('pruned old deployments', { project: project.slug, removed });
  }
  return removed;
}

/**
 * Reconcile deployments left mid-flight by a crash or a kill from Android.
 *
 * On a phone this is not a theoretical case: the OS can stop the process at any
 * moment. Anything still QUEUED/BUILDING/DEPLOYING at startup cannot be resumed
 * (the upload is gone), so it is marked failed and its staging directory is
 * removed, which keeps the UI honest rather than showing a deploy that will
 * never finish.
 */
export async function reconcileInterruptedDeployments() {
  const stuck = deploymentsRepo.findInterrupted();
  if (stuck.length === 0) return 0;

  for (const deployment of stuck) {
    deploymentsRepo.markFailed(deployment.id, {
      code: 'INTERRUPTED',
      message: 'The server restarted while this deployment was running',
    });
    await removeRecursive(`${storage.paths.deployment(deployment.project_id, deployment.id)}.partial`)
      .catch(() => {});
    logsRepo.insertLog({
      ts: nowIso(),
      level: 'warn',
      module: 'deploy',
      message: 'Deployment was interrupted by a server restart',
      projectId: deployment.project_id,
      deploymentId: deployment.id,
      meta: null,
    });
  }
  log.warn('marked interrupted deployments as failed', { count: stuck.length });
  return stuck.length;
}

/**
 * Re-derive the live deployment from disk when the database disagrees.
 * current.txt is the on-disk truth; if a restore or a manual copy left the two
 * out of step, trust the file and repair the row.
 */
export async function reconcileCurrentPointers() {
  const { items } = projectsRepo.listProjects({ limit: 1000 });
  let repaired = 0;

  for (const project of items) {
    const pointer = await storage.readCurrentPointer(project.id);
    if (pointer === project.current_deployment_id) continue;

    if (pointer && deploymentsRepo.findById(pointer)) {
      const dir = storage.paths.deployment(project.id, pointer);
      if (await pathExists(dir)) {
        projectsRepo.setCurrentDeployment(project.id, pointer, { status: 'ready' });
        repaired += 1;
        continue;
      }
    }
    if (project.current_deployment_id) {
      const dir = storage.paths.deployment(project.id, project.current_deployment_id);
      if (await pathExists(dir)) {
        await storage.writeCurrentPointer(project.id, project.current_deployment_id);
        repaired += 1;
      }
    }
  }

  if (repaired > 0) log.info('repaired current-deployment pointers', { repaired });
  return repaired;
}
