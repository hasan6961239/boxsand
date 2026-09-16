'use client';

import { useEffect } from 'react';

/**
 * ينبّه قبل مغادرة الصفحة وفيها تعديلات غير محفوظة.
 *
 * المتصفحات لا تسمح بنص مخصّص في هذا التنبيه (حمايةً من التصيّد)، فالرسالة
 * تأتي من المتصفح نفسه وبلغته. هذا يغطّي إغلاق التبويب وإعادة التحميل؛
 * التنقّل داخل التطبيق يُعالَج بحوار تأكيد عادي حيث يلزم.
 */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
