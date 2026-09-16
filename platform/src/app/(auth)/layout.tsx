import Link from 'next/link';
import { Check } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { getPlatformSettings } from '@/lib/platform';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const settings = await getPlatformSettings();

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      {/* اللوحة التعريفية — تختفي على الهاتف حيث المساحة للنموذج وحده */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#14503F] via-[#1F6F5C] to-[#2A8C74] p-12 lg:flex lg:flex-col">
        <div aria-hidden className="absolute -end-24 -top-24 size-72 rounded-full bg-white/10" />
        <div aria-hidden className="absolute -bottom-32 -start-16 size-96 rounded-full bg-black/10" />

        <Link href="/" className="relative flex items-center gap-2.5 text-white">
          <span className="grid size-10 place-items-center rounded-xl bg-white/15 text-xl font-bold">س</span>
          <span className="text-xl font-bold">{settings.platform_name}</span>
        </Link>

        <div className="relative mt-auto">
          <p className="text-2xl font-bold leading-snug text-white">
            منيو مطعمك الرقمي،
            <br />
            جاهز خلال دقائق.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              'رمز QR ثابت لا ينكسر مع تغيّر الأسعار',
              'تصميم بهوية مطعمك وألوانه',
              'شكاوى واقتراحات تصل إليك مباشرة',
              'إحصائيات تُظهر أكثر أصنافك طلباً',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-white/90">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/15">
                  <Check className="size-3" aria-hidden />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main id="main" className="relative flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between lg:justify-end">
          <Link href="/" className="flex items-center gap-2 font-bold text-text lg:hidden">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-fg">س</span>
            {settings.platform_name}
          </Link>
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
