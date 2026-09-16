'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

/** تبويبات بسيطة تتبع نمط WAI-ARIA: أسهم للتنقل، وتفعيل يدوي بالنقر. */
export function Tabs({ items, className }: { items: TabItem[]; className?: string }) {
  const base = useId();
  const [active, setActive] = useState(items[0]?.id ?? '');

  function onKeyDown(event: React.KeyboardEvent) {
    const index = items.findIndex((item) => item.id === active);
    if (index === -1) return;

    // في RTL السهم الأيسر يتقدّم بصرياً، لذا نعكس الاتجاه
    let next = index;
    if (event.key === 'ArrowLeft') next = (index + 1) % items.length;
    else if (event.key === 'ArrowRight') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;

    event.preventDefault();
    const target = items[next];
    if (!target) return;
    setActive(target.id);
    document.getElementById(`${base}-tab-${target.id}`)?.focus();
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        onKeyDown={onKeyDown}
        className="scroll-x mb-5 flex gap-1 border-b border-border"
      >
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              id={`${base}-tab-${item.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${base}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(item.id)}
              className={cn(
                'shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px',
                selected
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-text',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          id={`${base}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${item.id}`}
          hidden={item.id !== active}
        >
          {item.id === active && item.content}
        </div>
      ))}
    </div>
  );
}
