import path from 'node:path';
import fsp from 'node:fs/promises';
import { config } from '../config.js';
import {
  ensureDir, ensureDirSync, removeRecursive, directorySize, diskSpace,
  atomicWriteFile, readJson, writeJson, pathExists, copyDirectory,
} from '../util/fsx.js';

/**
 * On-disk layout.
 *
 *   storage/
 *     sites/<project-id>/
 *       deployments/<deployment-id>/   immutable snapshot, one per deploy
 *       workspace/                     mutable working copy the file manager edits
 *       workspace.json                 which deployment the workspace came from
 *       current.txt                    id of the deployment currently served
 *     tmp/                             uploads in flight
 *     backups/
 *
 * Why current.txt instead of a `current` symlink: symlinks work on Termux's
 * internal storage but not on /sdcard or an SD card, which is exactly where
 * someone would move this directory when the phone fills up. A pointer file
 * works on every filesystem, survives a backup-and-restore, and can be read by
 * a human staring at a broken install over SSH.
 *
 * Why a workspace separate from deployments: a deployment must stay byte-for-byte
 * what was published, or rollback is a lie. So the file manager edits a working
 * copy, and publishing snapshots it into a new deployment.
 */

export const paths = {
  root: () => config.storagePath,
  sites: () => path.join(config.storagePath, 'sites'),
  tmp: () => path.join(config.storagePath, 'tmp'),
  backups: () => path.join(config.storagePath, 'backups'),

  project: (projectId) => path.join(config.storagePath, 'sites', projectId),
  deployments: (projectId) => path.join(config.storagePath, 'sites', projectId, 'deployments'),
  deployment: (projectId, deploymentId) =>
    path.join(config.storagePath, 'sites', projectId, 'deployments', deploymentId),
  workspace: (projectId) => path.join(config.storagePath, 'sites', projectId, 'workspace'),
  workspaceMeta: (projectId) => path.join(config.storagePath, 'sites', projectId, 'workspace.json'),
  currentPointer: (projectId) => path.join(config.storagePath, 'sites', projectId, 'current.txt'),
  manifest: (projectId, deploymentId) =>
    path.join(config.storagePath, 'sites', projectId, 'deployments', deploymentId, '.nova-manifest.json'),
};

/** Files the platform writes inside a deployment and must hide from the site. */
export const INTERNAL_FILES = new Set(['.nova-manifest.json']);

export function initStorageSync() {
  ensureDirSync(config.storagePath);
  ensureDirSync(paths.sites());
  ensureDirSync(paths.tmp());
  ensureDirSync(paths.backups());
  ensureDirSync(config.logsDir);
}

export async function initProjectStorage(projectId) {
  await ensureDir(paths.project(projectId));
  await ensureDir(paths.deployments(projectId));
  return paths.project(projectId);
}

export async function writeCurrentPointer(projectId, deploymentId) {
  await atomicWriteFile(paths.currentPointer(projectId), `${deploymentId}\n`);
}

export async function readCurrentPointer(projectId) {
  try {
    const text = await fsp.readFile(paths.currentPointer(projectId), 'utf8');
    const value = text.trim();
    return value.length ? value : null;
  } catch {
    return null;
  }
}

export async function clearCurrentPointer(projectId) {
  await fsp.rm(paths.currentPointer(projectId), { force: true });
}

export async function removeProjectStorage(projectId) {
  await removeRecursive(paths.project(projectId));
}

export async function removeDeploymentStorage(projectId, deploymentId) {
  await removeRecursive(paths.deployment(projectId, deploymentId));
}

export async function writeManifest(projectId, deploymentId, manifest) {
  await writeJson(paths.manifest(projectId, deploymentId), manifest);
}

export async function readManifest(projectId, deploymentId) {
  return readJson(paths.manifest(projectId, deploymentId), null);
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export async function readWorkspaceMeta(projectId) {
  return readJson(paths.workspaceMeta(projectId), null);
}

export async function writeWorkspaceMeta(projectId, meta) {
  await writeJson(paths.workspaceMeta(projectId), meta);
}

/**
 * Return the workspace directory, seeding it from the live deployment the first
 * time it is needed. Seeding lazily means a project that is only ever deployed
 * from a zip never pays for a second copy of its files.
 */
export async function ensureWorkspace(projectId, currentDeploymentId) {
  const workspace = paths.workspace(projectId);
  if (await pathExists(workspace)) return workspace;

  await ensureDir(workspace);
  if (currentDeploymentId) {
    const source = paths.deployment(projectId, currentDeploymentId);
    if (await pathExists(source)) {
      await copyDirectory(source, workspace);
      await fsp.rm(path.join(workspace, '.nova-manifest.json'), { force: true });
    }
  }
  await writeWorkspaceMeta(projectId, {
    seededFrom: currentDeploymentId ?? null,
    dirty: false,
    updatedAt: new Date().toISOString(),
  });
  return workspace;
}

export async function markWorkspaceDirty(projectId) {
  const meta = (await readWorkspaceMeta(projectId)) ?? { seededFrom: null };
  await writeWorkspaceMeta(projectId, {
    ...meta,
    dirty: true,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Drop the workspace. Called after a zip deploy, because the working copy is
 * now stale: it would otherwise silently shadow the site you just published.
 */
export async function resetWorkspace(projectId) {
  await removeRecursive(paths.workspace(projectId));
  await fsp.rm(paths.workspaceMeta(projectId), { force: true });
}

// ---------------------------------------------------------------------------
// Usage reporting
// ---------------------------------------------------------------------------

/** Byte totals for the Storage page. Walks the tree, so call it sparingly. */
export async function storageUsage() {
  const [sites, backups, tmp, logs] = await Promise.all([
    directorySize(paths.sites()),
    directorySize(paths.backups()),
    directorySize(paths.tmp()),
    directorySize(config.logsDir),
  ]);

  let database = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      database += (await fsp.stat(`${config.databasePath}${suffix}`)).size;
    } catch { /* missing wal/shm is normal */ }
  }

  const disk = await diskSpace(config.dataDir);

  return {
    projects: sites,
    backups,
    temp: tmp,
    logs,
    database,
    total: sites + backups + tmp + logs + database,
    disk, // { total, free } or null when the platform cannot report it
  };
}

export async function projectUsage(projectId) {
  const [deployments, workspace] = await Promise.all([
    directorySize(paths.deployments(projectId)),
    directorySize(paths.workspace(projectId)),
  ]);
  return { deployments, workspace, total: deployments + workspace };
}

/**
 * Refuse to start an extraction that obviously cannot fit.
 * A deploy that dies halfway through with ENOSPC leaves a mess; failing up
 * front with a clear message does not. The 64 MB headroom keeps the database
 * and logs writable even when a deploy is refused.
 */
export async function assertSpaceAvailable(requiredBytes) {
  const disk = await diskSpace(config.dataDir);
  if (!disk) return { checked: false };
  const headroom = 64 * 1024 * 1024;
  if (disk.free < requiredBytes + headroom) {
    const err = new Error('Not enough free storage on the device');
    err.code = 'DISK_FULL';
    err.free = disk.free;
    err.required = requiredBytes;
    throw err;
  }
  return { checked: true, free: disk.free };
}

export async function tempFile(prefix, extension = '') {
  await ensureDir(paths.tmp());
  const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
  return path.join(paths.tmp(), name);
}

/** Remove stray upload temp files (a crash mid-upload leaves them behind). */
export async function cleanTempFiles(olderThanMs = 3600_000) {
  let entries;
  try {
    entries = await fsp.readdir(paths.tmp(), { withFileTypes: true });
  } catch {
    return 0;
  }
  const cutoff = Date.now() - olderThanMs;
  let removed = 0;
  for (const entry of entries) {
    const target = path.join(paths.tmp(), entry.name);
    try {
      const stat = await fsp.stat(target);
      if (stat.mtimeMs < cutoff) {
        await removeRecursive(target);
        removed += 1;
      }
    } catch { /* already gone */ }
  }
  return removed;
}
