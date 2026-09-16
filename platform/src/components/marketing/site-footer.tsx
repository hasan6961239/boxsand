import Link from 'next/link';
import { Mail, Phone } from 'lucide-react';
import type { PlatformSettings } from '@/types/database';

export function SiteFooter({ settings }: { settings: PlatformSettings }) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-surface-2/50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <p className="text-lg font-bold text-text">{settings.platform_name}</p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{settings.tagline}</p>
            <div className="mt-4 flex flex-col gap-2 text-sm text-muted">
              {settings.contact_email && (
                <a href={`mailto:${settings.contact_email}`} className="inline-flex items-center gap-2 hover:text-text">
                  <Mail className="size-4" aria-hidden />
                  <span className="ltr-nums">{settings.contact_email}</span>
                </a>
              )}
              {settings.contact_phone && (
                <a href={`tel:${settings.contact_phone}`} className="inline-flex items-center gap-2 hover:text-text">
                  <Phone className="size-4" aria-hidden />
                  <span className="ltr-nums">{settings.contact_phone}</span>
                </a>
              )}
            </div>
          </div>

          <nav aria-label="روابط المنصة">
            <p className="text-sm font-bold text-text">المنصة</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li><Link href="/#how" className="hover:text-text">كيف يعمل</Link></li>
              <li><Link href="/#features" className="hover:text-text">المزايا</Link></li>
              <li><Link href="/#pricing" className="hover:text-text">الأسعار</Link></li>
              <li><Link href="/menu/demo" className="hover:text-text">منيو تجريبي</Link></li>
            </ul>
          </nav>

          <nav aria-label="حسابك">
            <p className="text-sm font-bold text-text">حسابك</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li><Link href="/login" className="hover:text-text">تسجيل الدخول</Link></li>
              <li><Link href="/register" className="hover:text-text">إنشاء حساب</Link></li>
              <li><Link href="/dashboard" className="hover:text-text">لوحة التحكم</Link></li>
            </ul>
          </nav>
        </div>

        <p className="mt-10 border-t border-border pt-6 text-center text-xs text-subtle">
          © <span className="nums">{year}</span> {settings.platform_name}. جميع الحقوق محفوظة.
        </p>
      </div>
    </footer>
  );
}
