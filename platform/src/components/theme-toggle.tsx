'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';

const KEY = 'sufra-theme';

/**
 * يُطبَّق قبل أول رسم عبر السكربت في <head>، فلا يومض الوضع الفاتح لحظة
 * التحميل عند من اختار الوضع الليلي.
 */
export const themeBootstrapScript = `
(function(){
  try {
    var stored = localStorage.getItem('${KEY}');
    var dark = stored ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    setReady(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(KEY, next ? 'dark' : 'light');
    } catch {
      // التخزين مرفوض في التصفح الخاص — التبديل يعمل لهذه الجلسة فقط
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الليلي'}
      className={cn(
        'grid size-10 place-items-center rounded-xl text-muted transition-colors',
        'hover:bg-surface-2 hover:text-text',
        className,
      )}
    >
      {/* قبل الترطيب لا نعرف الوضع؛ نعرض أيقونة محايدة بدل وميض خاطئ */}
      {ready && dark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}
