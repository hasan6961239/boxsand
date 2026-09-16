/** All timestamps in the database are ISO-8601 UTC strings. */
export function nowIso() {
  return new Date().toISOString();
}

export function isoPlusHours(hours, from = new Date()) {
  return new Date(from.getTime() + hours * 3600_000).toISOString();
}

export function isoMinusDays(days, from = new Date()) {
  return new Date(from.getTime() - days * 86400_000).toISOString();
}

export function isExpired(iso) {
  if (!iso) return true;
  const t = Date.parse(iso);
  return !Number.isFinite(t) || t <= Date.now();
}

/** "1d 4h 12m" — used for uptime and deployment durations. */
export function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${Math.round(n)}ms`;
  const s = Math.floor(n / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins && !days) parts.push(`${mins}m`);
  if (secs && !days && !hours) parts.push(`${secs}s`);
  return parts.join(' ') || '0s';
}
