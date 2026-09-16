'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/cn';

const LINKS = [
  { href: '#how', label: 'كيف يعمل' },
  { href: '#features', label: 'المزايا' },
  { href: '#preview', label: 'المعاينة' },
  { href: '#pricing', label: 'الأسعار' },
  { href: '#faq', label: 'الأسئلة' },
];

export function SiteNav({ platformName, signedIn }: { platformName: string; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow,border-color] duration-300',
        scrolled ? 'glass border-b border-border shadow-sm' : 'border-b border-transparent',
      )}
      style={{ height: 'var(--header-h)' }}
    >
      <nav className="mx-auto flex h-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-bold text-text">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-fg">
            <LogoGlyph />
          </span>
          <span className="text-lg">{platformName}</span>
        </Link>

        <ul className="mx-auto hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ms-auto flex items-center gap-1.5 md:ms-0">
          <ThemeToggle />
          {signedIn ? (
            <ButtonLink href="/dashboard" size="sm" className="hidden sm:inline-flex">
              لوحة التحكم
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
                تسجيل الدخول
              </ButtonLink>
              <ButtonLink href="/register" size="sm" className="hidden sm:inline-flex">
                ابدأ الآن
              </ButtonLink>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </nav>

      {open && (
        <div className="animate-in-up border-t border-border bg-surface px-4 py-4 shadow-lg md:hidden">
          <ul className="space-y-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-xl px-3 py-2.5 text-sm font-medium text-text hover:bg-surface-2"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
            {signedIn ? (
              <ButtonLink href="/dashboard" className="col-span-2">لوحة التحكم</ButtonLink>
            ) : (
              <>
                <ButtonLink href="/login" variant="outline">تسجيل الدخول</ButtonLink>
                <ButtonLink href="/register">ابدأ الآن</ButtonLink>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function LogoGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
      <path d="M8 5v7a3 3 0 0 0 3 3v4M11 5v5M8 5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16.5 5c-1.4 0-2.3 2-2.3 4.3s.9 2.8 1.6 2.8V19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
