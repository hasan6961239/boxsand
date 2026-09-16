'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Store, FolderTree, UtensilsCrossed, Tag, MessageSquare,
  QrCode, BarChart3, Settings, Menu, X, LogOut, ExternalLink, Shield,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/cn';
import { logoutAction } from '@/app/(auth)/actions';

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  badge?: number;
}

const ICONS = {
  overview: LayoutDashboard,
  store: Store,
  categories: FolderTree,
  products: UtensilsCrossed,
  offers: Tag,
  complaints: MessageSquare,
  qr: QrCode,
  analytics: BarChart3,
  settings: Settings,
  admin: Shield,
};

interface ShellProps {
  items: NavItem[];
  title: string;
  subtitle?: string;
  /** رابط المنيو العام — يفتح في تبويب جديد */
  menuUrl?: string;
  isAdmin?: boolean;
  children: React.ReactNode;
}

export function DashboardShell({ items, title, subtitle, menuUrl, isAdmin, children }: ShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // إغلاق القائمة الجانبية عند الانتقال — وإلا بقيت مفتوحة فوق الصفحة الجديدة
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const nav = (
    <nav className="flex-1 space-y-1 overflow-y-auto p-3">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        // «/dashboard» تطابق تاماً، وما عداها يطابق المسار وفروعه
        const active =
          item.href === '/dashboard' || item.href === '/admin'
            ? pathname === item.href
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'bg-primary-soft text-primary'
                : 'text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            <Icon className="size-[1.125rem] shrink-0" aria-hidden />
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge ? (
              <span className="nums grid min-w-5 place-items-center rounded-full bg-danger px-1.5 py-0.5 text-[0.6875rem] font-bold text-white">
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
      <Link href="/" className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-xl font-bold',
            isAdmin ? 'bg-accent text-[#1A1713]' : 'bg-primary text-primary-fg',
          )}
        >
          {isAdmin ? <Shield className="size-4" aria-hidden /> : 'س'}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-text">{title}</span>
          {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
        </span>
      </Link>
    </div>
  );

  const footer = (
    <div className="space-y-1 border-t border-border p-3">
      {menuUrl && (
        <a
          href={menuUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <ExternalLink className="size-[1.125rem] shrink-0" aria-hidden />
          عرض المنيو
        </a>
      )}
      <form action={logoutAction}>
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-danger-soft hover:text-danger"
        >
          <LogOut className="size-[1.125rem] shrink-0" aria-hidden />
          تسجيل الخروج
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      {/* الشريط الجانبي — ثابت على الشاشات الكبيرة */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-e border-border bg-surface lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      {/* الشريط العلوي على الهاتف */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-surface px-3 py-2.5 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="فتح القائمة"
          className="grid size-10 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">{title}</span>
        <ThemeToggle />
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-[#100d0a]/50"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="animate-in-up absolute inset-y-0 start-0 flex w-[17rem] flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border ps-4 pe-2 py-3">
              <span className="truncate text-sm font-bold text-text">{title}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="إغلاق القائمة"
                className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-2"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      )}

      <main id="main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>

      {/* مبدّل الوضع الليلي على الشاشات الكبيرة، بعيداً عن الشريط العلوي */}
      <div className="fixed bottom-4 end-4 z-20 hidden lg:block">
        <ThemeToggle className="border border-border bg-surface shadow-md" />
      </div>
    </div>
  );
}
