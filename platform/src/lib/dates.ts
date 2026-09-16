/**
 * تنسيق التواريخ بالعربية مع أرقام لاتينية.
 *
 * نستعمل `ar` مع نظام الأرقام اللاتيني لأن الأرقام العربية-الهندية تُربك
 * القراءة السريعة في الجداول، بينما تبقى أسماء الأشهر عربية.
 */
const DATE_TIME = new Intl.DateTimeFormat('ar-LY-u-nu-latn-ca-gregory', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const DATE_ONLY = new Intl.DateTimeFormat('ar-LY-u-nu-latn-ca-gregory', {
  dateStyle: 'medium',
});

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_TIME.format(date);
}

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_ONLY.format(date);
}

/** «قبل ٣ أيام» — للقوائم التي يهم فيها الحداثة لا الدقة. */
export function formatRelative(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000], ['month', 2592000], ['day', 86400],
    ['hour', 3600], ['minute', 60],
  ];

  const formatter = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return 'الآن';
}
