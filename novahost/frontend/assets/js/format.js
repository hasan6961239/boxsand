import { getLocale, t } from './i18n.js';

/** Formatting helpers. Locale-aware, and honest about missing values. */

export function bytes(value, decimals = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const size = n / 1024 ** i;
  return `${size.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

export function number(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  // Arabic-Indic digits are correct for Arabic but hurt scannability in a
  // technical dashboard, so Latin digits are used in both languages.
  return n.toLocaleString(getLocale() === 'ar' ? 'ar-LY-u-nu-latn' : 'en-US');
}

export function percent(value, decimals = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return t('common.unavailable');
  return `${n.toFixed(decimals)}%`;
}

export function dateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(getLocale() === 'ar' ? 'ar-LY-u-nu-latn' : 'en-GB', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function timeOnly(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

/** "3 minutes ago" — falls back to an absolute date beyond a month. */
export function relativeTime(iso) {
  if (!iso) return t('common.never');
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '—';

  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs > 30 * 86400) return dateTime(iso);

  const formatter = new Intl.RelativeTimeFormat(
    getLocale() === 'ar' ? 'ar' : 'en',
    { numeric: 'auto' },
  );
  const units = [
    ['second', 60], ['minute', 60], ['hour', 24], ['day', 30],
  ];
  let value = diffSeconds;
  for (const [unit, step] of units) {
    if (Math.abs(value) < step) return formatter.format(Math.round(value), unit);
    value /= step;
  }
  return formatter.format(Math.round(value), 'month');
}

export function duration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${Math.round(n)}ms`;
  const seconds = n / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Uptime reads better in whole units than as a precise duration. */
export function uptime(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return t('common.unavailable');
  const days = Math.floor(n / 86400);
  const hours = Math.floor((n % 86400) / 3600);
  const minutes = Math.floor((n % 3600) / 60);
  if (days > 0) return getLocale() === 'ar' ? `${days} يوم ${hours} ساعة` : `${days}d ${hours}h`;
  if (hours > 0) return getLocale() === 'ar' ? `${hours} ساعة ${minutes} دقيقة` : `${hours}h ${minutes}m`;
  return getLocale() === 'ar' ? `${minutes} دقيقة` : `${minutes}m`;
}

/** Map a deployment status to the badge modifier that represents it. */
export function statusTone(status) {
  switch (String(status).toUpperCase()) {
    case 'READY': return 'success';
    case 'FAILED': return 'danger';
    case 'BUILDING':
    case 'DEPLOYING':
    case 'QUEUED': return 'warning';
    case 'SUPERSEDED': return '';
    default: return '';
  }
}

export function projectStatusTone(project) {
  if (!project.enabled) return 'warning';
  if (project.status === 'ready') return 'success';
  if (project.status === 'failed') return 'danger';
  return '';
}

export function shortId(id, length = 14) {
  const value = String(id ?? '');
  return value.length > length ? `${value.slice(0, length)}…` : value;
}
