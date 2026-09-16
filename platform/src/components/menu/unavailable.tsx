import Link from 'next/link';
import { Clock } from 'lucide-react';
import { PLATFORM } from '@/lib/config';

/** يظهر حين يكون المطعم موقوفاً أو معطّلاً — بلا أي تفاصيل داخلية. */
export function UnavailableNotice({ name }: { name: string }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6 py-16 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-surface-2 text-subtle">
          <Clock className="size-7" aria-hidden />
        </div>
        <h1 className="mt-5 text-xl font-bold text-text">المنيو غير متاح حالياً</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          منيو «{name}» متوقف مؤقتاً. تواصل مع المطعم مباشرة، أو عد لاحقاً.
        </p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          العودة إلى {PLATFORM.name}
        </Link>
      </div>
    </main>
  );
}
