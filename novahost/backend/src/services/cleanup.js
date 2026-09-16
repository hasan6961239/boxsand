import { createLogger, pruneLogFiles } from '../logger.js';
import * as sessionsRepo from '../db/repo/sessions.js';
import * as logsRepo from '../db/repo/logs.js';
import * as auditRepo from '../db/repo/audit.js';
import * as settingsRepo from '../db/repo/settings.js';
import * as projectsRepo from '../db/repo/projects.js';
import { cleanTempFiles } from './storage.js';
import { pruneOldDeployments } from './deploy.js';

const log = createLogger('cleanup');

const SIX_HOURS = 6 * 3600_000;
let timer = null;

/**
 * Housekeeping.
 *
 * Runs once at startup and every six hours after that — not on a request path,
 * and not on a tight timer. On a phone, background work is a battery and flash
 * cost, so it happens rarely and does a batch of work when it does.
 */
export async function runCleanup({ includeDeployments = true } = {}) {
  const settings = settingsRepo.getAll();
  const result = {};

  try {
    result.sessions = sessionsRepo.pruneExpired();
  } catch (err) {
    log.warn('session prune failed', { error: err.message });
  }

  try {
    result.logs = logsRepo.pruneLogs(settings.logRetentionDays);
    result.logFiles = await pruneLogFiles(settings.logRetentionDays);
  } catch (err) {
    log.warn('log prune failed', { error: err.message });
  }

  try {
    result.securityEvents = auditRepo.pruneSecurityEvents(settings.securityRetentionDays);
    result.auditEntries = auditRepo.pruneAudit(settings.securityRetentionDays);
  } catch (err) {
    log.warn('security log prune failed', { error: err.message });
  }

  try {
    result.tempFiles = await cleanTempFiles();
  } catch (err) {
    log.warn('temp cleanup failed', { error: err.message });
  }

  if (includeDeployments) {
    try {
      let pruned = 0;
      const { items } = projectsRepo.listProjects({ limit: 1000 });
      for (const project of items) {
        pruned += await pruneOldDeployments(project.id);
      }
      result.deployments = pruned;
    } catch (err) {
      log.warn('deployment prune failed', { error: err.message });
    }
  }

  const changed = Object.entries(result).filter(([, value]) => value > 0);
  if (changed.length > 0) log.info('cleanup finished', Object.fromEntries(changed));
  return result;
}

export function startCleanupSchedule() {
  stopCleanupSchedule();
  timer = setInterval(() => {
    runCleanup().catch((err) => log.error('scheduled cleanup failed', { error: err.message }));
  }, SIX_HOURS);
  // Do not hold the event loop open just for housekeeping.
  timer.unref?.();
  return timer;
}

export function stopCleanupSchedule() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Recompute storage figures from disk. Used by the Storage Scan button. */
export async function rescanStorage() {
  const { projectUsage } = await import('./storage.js');
  const { items } = projectsRepo.listProjects({ limit: 1000 });
  let scanned = 0;
  for (const project of items) {
    const usage = await projectUsage(project.id);
    projectsRepo.updateStorage(project.id, {
      storageBytes: usage.total,
      fileCount: project.file_count,
    });
    scanned += 1;
  }
  log.info('storage rescan finished', { projects: scanned });
  return { projects: scanned };
}
