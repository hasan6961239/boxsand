import { describe, expect, it } from 'vitest';
import { getOpenState, groupByWeekday } from '@/lib/hours';

const TZ = 'Africa/Tripoli';   // UTC+2 بلا توقيت صيفي

/** الأحد ٢٠٢٦-٠٩-١٣ بتوقيت طرابلس. */
const sunday = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 13, hour - 2, minute));

describe('getOpenState', () => {
  const dayHours = [{ weekday: 0, opens_at: '11:00', closes_at: '16:00' }];

  it('مفتوح داخل الفترة', () => {
    const state = getOpenState(dayHours, TZ, sunday(13));
    expect(state.isOpen).toBe(true);
    expect(state.label).toBe('يغلق 16:00');
  });

  it('مغلق قبل الفتح، ويخبر بموعد الفتح اليوم', () => {
    const state = getOpenState(dayHours, TZ, sunday(9));
    expect(state.isOpen).toBe(false);
    expect(state.label).toBe('يفتح 11:00');
  });

  it('مغلق بعد الإغلاق، فينتقل إلى اليوم التالي', () => {
    // لا بد من ساعات يوم الاثنين أيضاً، وإلا كان «التالي» هو الأحد المقبل
    const withMonday = [...dayHours, { weekday: 1, opens_at: '11:00', closes_at: '16:00' }];
    const state = getOpenState(withMonday, TZ, sunday(18));
    expect(state.isOpen).toBe(false);
    expect(state.label).toBe('يفتح غداً 11:00');
  });

  it('حين لا يفتح إلا يوماً واحداً في الأسبوع يذكر اسم اليوم لا «غداً»', () => {
    const state = getOpenState(dayHours, TZ, sunday(18));
    expect(state.label).toBe('يفتح الأحد 11:00');
  });

  it('حدّ الفتح مفتوح وحدّ الإغلاق مغلق', () => {
    expect(getOpenState(dayHours, TZ, sunday(11, 0)).isOpen).toBe(true);
    expect(getOpenState(dayHours, TZ, sunday(16, 0)).isOpen).toBe(false);
  });

  describe('فترة تمتد بعد منتصف الليل', () => {
    const overnight = [{ weekday: 0, opens_at: '18:30', closes_at: '01:00' }];

    it('مفتوح مساء اليوم نفسه', () => {
      expect(getOpenState(overnight, TZ, sunday(22)).isOpen).toBe(true);
    });

    it('ما زال مفتوحاً بعد منتصف الليل — أي في اليوم التالي', () => {
      // الاثنين ١٢:٣٠ صباحاً = امتداد فترة الأحد
      const afterMidnight = new Date(Date.UTC(2026, 8, 13, 22, 30)); // 00:30 الاثنين بتوقيت طرابلس
      expect(getOpenState(overnight, TZ, afterMidnight).isOpen).toBe(true);
    });

    it('مغلق بعد ساعة الإغلاق التالية لمنتصف الليل', () => {
      const afterClose = new Date(Date.UTC(2026, 8, 13, 23, 30)); // 01:30 الاثنين
      expect(getOpenState(overnight, TZ, afterClose).isOpen).toBe(false);
    });
  });

  it('فترتان في اليوم: مغلق في الفجوة بينهما', () => {
    const twoSlots = [
      { weekday: 0, opens_at: '11:00', closes_at: '16:00' },
      { weekday: 0, opens_at: '18:30', closes_at: '23:00' },
    ];
    expect(getOpenState(twoSlots, TZ, sunday(17)).isOpen).toBe(false);
    expect(getOpenState(twoSlots, TZ, sunday(17)).label).toBe('يفتح 18:30');
    expect(getOpenState(twoSlots, TZ, sunday(19)).isOpen).toBe(true);
  });

  it('يحسب بتوقيت المطعم لا بتوقيت جهاز الزائر', () => {
    // اللحظة نفسها: ١٥:٠٠ في طرابلس (داخل الدوام) و١٧:٠٠ في دبي (بعد الإغلاق)
    const instant = sunday(15);
    expect(getOpenState(dayHours, 'Africa/Tripoli', instant).isOpen).toBe(true);
    expect(getOpenState(dayHours, 'Asia/Dubai', instant).isOpen).toBe(false);
  });

  it('منطقة زمنية غير معروفة لا تُسقط الصفحة', () => {
    expect(() => getOpenState(dayHours, 'Mars/Olympus', sunday(13))).not.toThrow();
  });

  it('بلا أوقات عمل لا تُعرض أي شارة', () => {
    expect(getOpenState([], TZ, sunday(13))).toEqual({ isOpen: false, label: '', nextOpen: null });
  });
});

describe('groupByWeekday', () => {
  it('يُرجع سبعة أيام دائماً، والفارغ منها مغلق', () => {
    const grouped = groupByWeekday([{ weekday: 2, opens_at: '10:00', closes_at: '22:00' }]);
    expect(grouped).toHaveLength(7);
    expect(grouped[2]?.slots).toHaveLength(1);
    expect(grouped[0]?.slots).toHaveLength(0);
  });

  it('يرتّب فترات اليوم زمنياً', () => {
    const grouped = groupByWeekday([
      { weekday: 1, opens_at: '18:30', closes_at: '23:00' },
      { weekday: 1, opens_at: '11:00', closes_at: '16:00' },
    ]);
    expect(grouped[1]?.slots.map((slot) => slot.opens_at)).toEqual(['11:00', '18:30']);
  });
});
