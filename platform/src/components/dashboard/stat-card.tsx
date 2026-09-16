import { cn } from '@/lib/cn';

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'primary' | 'accent' | 'danger';
}

const TONES = {
  default: 'bg-surface-2 text-muted',
  primary: 'bg-primary-soft text-primary',
  accent: 'bg-accent-soft text-accent',
  danger: 'bg-danger-soft text-danger',
} as const;

export function StatCard({ label, value, hint, icon, tone = 'default' }: StatCardProps) {
  return (
    <div className="surface-card flex items-start gap-3 p-4">
      {icon && <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', TONES[tone])}>{icon}</span>}
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="nums mt-0.5 text-xl font-bold text-text">{value}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-subtle">{hint}</p>}
      </div>
    </div>
  );
}
