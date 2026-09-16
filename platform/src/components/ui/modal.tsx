'use client';

import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** dialog في الوسط، sheet ينزلق من الأسفل — الأنسب للهاتف. */
  variant?: 'dialog' | 'sheet';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

export function Modal({
  open, onClose, title, description, children, footer,
  variant = 'dialog', size = 'md', className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // Escape للإغلاق + حبس التنقل بـ Tab داخل النافذة، وإلا خرج المستخدم
  // بلوحة المفاتيح إلى صفحة لا يراها.
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', onKeyDown);

    // قفل تمرير الصفحة الخلفية مع تعويض عرض شريط التمرير حتى لا يقفز التخطيط
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingInlineEnd;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingInlineEnd = `${gap}px`;

    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }, 60);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      body.style.overflow = previousOverflow;
      body.style.paddingInlineEnd = previousPadding;
      window.clearTimeout(timer);
    };
  }, [open, onKeyDown]);

  if (typeof document === 'undefined') return null;

  const isSheet = variant === 'sheet';

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            'fixed inset-0 z-50 flex',
            isSheet ? 'items-end sm:items-center sm:justify-center' : 'items-center justify-center p-4',
          )}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            className="absolute inset-0 bg-[#100d0a]/55 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          <motion.div
            ref={panelRef}
            className={cn(
              'relative w-full bg-surface shadow-xl flex flex-col',
              isSheet
                ? 'rounded-t-3xl sm:rounded-3xl max-h-[92vh] sm:max-h-[86vh] sm:max-w-lg'
                : cn('rounded-2xl max-h-[88vh]', SIZES[size]),
              className,
            )}
            initial={reduce ? { opacity: 0 } : isSheet ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 8 }}
            animate={reduce ? { opacity: 1 } : isSheet ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : isSheet ? { y: '100%' } : { opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          >
            {isSheet && (
              <div className="shrink-0 pt-2.5 pb-1 flex justify-center sm:hidden">
                <span className="h-1.5 w-11 rounded-full bg-border-strong" aria-hidden />
              </div>
            )}

            {(title || description) && (
              <div className="shrink-0 flex items-start gap-3 px-5 pt-4 pb-3 border-b border-border">
                <div className="min-w-0 flex-1">
                  {title && <h2 className="text-base font-bold text-text truncate">{title}</h2>}
                  {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="إغلاق"
                  className="shrink-0 -m-1 p-1.5 rounded-lg text-subtle hover:text-text hover:bg-surface-2 transition-colors"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

            {footer && (
              <div className="shrink-0 flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border bg-surface-2/60 rounded-b-2xl">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
