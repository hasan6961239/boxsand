import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { PLATFORM } from '@/lib/config';

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6 py-16 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-surface-2 text-subtle">
          <SearchX className="size-7" aria-hidden />
        </div>
        <h1 className="mt-5 text-xl font-bold text-text">الصفحة غير موجودة</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          الرابط الذي فتحته غير صحيح أو لم يعد موجوداً. تحقّق منه، أو عد إلى الصفحة الرئيسية.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-fg transition-colors hover:bg-primary-hover"
        >
          العودة إلى {PLATFORM.name}
        </Link>
      </div>
    </main>
  );
}
