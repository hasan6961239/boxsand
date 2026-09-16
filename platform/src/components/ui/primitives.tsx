import { cn } from '@/lib/cn';

/* ── بطاقة ───────────────────────────────────────────────────────────────── */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('surface-card p-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-base font-bold text-text', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted mt-1 leading-relaxed', className)} {...props} />;
}

/* ── شارة ────────────────────────────────────────────────────────────────── */

export function Badge({
  className,
  size = 'md',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[0.6875rem]' : 'px-2.5 py-1 text-xs',
        'bg-surface-3 text-muted',
        className,
      )}
      {...props}
    />
  );
}

/* ── هيكل التحميل ────────────────────────────────────────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-lg', className)} />;
}

/* ── حالة فارغة ──────────────────────────────────────────────────────────── */

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-surface-2 text-subtle">
          {icon}
        </div>
      )}
      <h3 className="text-base font-bold text-text">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ── فاصل ────────────────────────────────────────────────────────────────── */

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t border-border', className)} />;
}

/* ── عنوان قسم في اللوحة ─────────────────────────────────────────────────── */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-text sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
