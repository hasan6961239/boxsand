'use client';

import { useEffect } from 'react';
import { TriangleAlert, RotateCw } from 'lucide-react';
import { GENERIC_ERROR } from '@/lib/errors';

/**
 * حدّ الأخطاء الأعلى.
 *
 * المستخدم يرى رسالة عربية واضحة؛ التفاصيل التقنية تذهب إلى سجلّات الخادم
 * وحدها. رقم digest يظهر ليستطيع المستخدم ذكره عند طلب الدعم.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[سُفرة] خطأ غير متوقع:', error);
  }, [error]);

  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6 py-16 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-danger-soft text-danger">
          <TriangleAlert className="size-7" aria-hidden />
        </div>
        <h1 className="mt-5 text-xl font-bold text-text">حدث خطأ غير متوقع</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{GENERIC_ERROR}</p>

        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-fg transition-colors hover:bg-primary-hover"
        >
          <RotateCw className="size-4" aria-hidden />
          حاول مرة أخرى
        </button>

        {error.digest && (
          <p className="ltr-nums mt-6 text-xs text-subtle">رقم الخطأ: {error.digest}</p>
        )}
      </div>
    </main>
  );
}
