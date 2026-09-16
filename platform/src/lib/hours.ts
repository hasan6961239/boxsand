import { WEEKDAYS } from './config';
import type { PublicHour } from '@/types/database';

export interface OpenState {
  isOpen: boolean;
  /** «يغلق ١:٠٠» أو «يفتح ١١:٠٠» أو «مغلق اليوم» */
  label: string;
  /** الفترة القادمة إن كان مغلقاً الآن */
  nextOpen: { weekday: number; opens_at: string } | null;
}

/** «11:00» → 660 دقيقة من منتصف الليل */
function toMinutes(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * الوقت المحلي للمطعم بمنطقته الزمنية، لا بمنطقة جهاز الزائر.
 * زبون في ألمانيا يمسح QR لمطعم في طرابلس يجب أن يرى حالة المطعم هناك.
 */
function localNow(now: Date, timeZone: string): { weekday: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  } catch {
    // منطقة زمنية غير معروفة — نعود إلى توقيت الخادم بدل أن ننهار
    parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
  }

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(get('hour')) % 24;   // بعض البيئات تُرجع 24 بدل 00
  return { weekday: map[get('weekday')] ?? 0, minutes: hour * 60 + Number(get('minute')) };
}

/**
 * هل المطعم مفتوح الآن؟
 *
 * الفترة التي ينتهي وقتها قبل بدايتها (٧م → ١ص) تمتد إلى اليوم التالي، فتُفحص
 * مرتين: مرة ليومها، ومرة لليوم السابق امتداداً إلى ما بعد منتصف الليل.
 */
export function getOpenState(
  hours: PublicHour[],
  timeZone: string,
  now: Date = new Date(),
): OpenState {
  if (hours.length === 0) {
    return { isOpen: false, label: '', nextOpen: null };
  }

  const { weekday, minutes } = localNow(now, timeZone);
  const yesterday = (weekday + 6) % 7;

  for (const slot of hours) {
    const opens = toMinutes(slot.opens_at);
    const closes = toMinutes(slot.closes_at);
    const overnight = closes <= opens;

    const openToday = slot.weekday === weekday && minutes >= opens && (overnight || minutes < closes);
    const stillOpenFromYesterday = overnight && slot.weekday === yesterday && minutes < closes;

    if (openToday || stillOpenFromYesterday) {
      return { isOpen: true, label: `يغلق ${slot.closes_at}`, nextOpen: null };
    }
  }

  // مغلق: نبحث عن أقرب فترة قادمة خلال الأسبوع
  for (let offset = 0; offset < 8; offset++) {
    const day = (weekday + offset) % 7;
    const candidates = hours
      .filter((h) => h.weekday === day)
      .filter((h) => offset > 0 || toMinutes(h.opens_at) > minutes)
      .sort((a, b) => toMinutes(a.opens_at) - toMinutes(b.opens_at));

    const next = candidates[0];
    if (!next) continue;

    const when =
      offset === 0 ? `يفتح ${next.opens_at}`
      : offset === 1 ? `يفتح غداً ${next.opens_at}`
      : `يفتح ${WEEKDAYS[day]} ${next.opens_at}`;
    return { isOpen: false, label: when, nextOpen: { weekday: day, opens_at: next.opens_at } };
  }

  return { isOpen: false, label: 'مغلق حالياً', nextOpen: null };
}

/** يجمع الفترات في صفوف لعرض جدول أوقات العمل. */
export function groupByWeekday(hours: PublicHour[]): { weekday: number; slots: PublicHour[] }[] {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    slots: hours
      .filter((h) => h.weekday === weekday)
      .sort((a, b) => toMinutes(a.opens_at) - toMinutes(b.opens_at)),
  }));
}
