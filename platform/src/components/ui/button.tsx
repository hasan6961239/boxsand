'use client';

import { forwardRef } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'accent';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-fg hover:bg-primary-hover active:brightness-95 shadow-sm hover:shadow-md',
  secondary:
    'bg-surface-2 text-text hover:bg-surface-3 border border-border',
  outline:
    'border border-border-strong text-text hover:bg-surface-2 hover:border-primary/40',
  ghost:
    'text-muted hover:text-text hover:bg-surface-2',
  danger:
    'bg-danger text-white hover:brightness-110 active:brightness-95 shadow-sm',
  accent:
    'bg-accent text-[#1A1713] hover:brightness-105 active:brightness-95 shadow-sm',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[0.8125rem] gap-1.5 rounded-lg',
  md: 'h-11 px-5 text-sm gap-2 rounded-xl',
  lg: 'h-[3.25rem] px-7 text-base gap-2.5 rounded-xl',
  icon: 'h-10 w-10 rounded-xl',
};

const BASE =
  'inline-flex items-center justify-center font-medium whitespace-nowrap no-tap-flash ' +
  'transition-[background-color,box-shadow,border-color,transform,color] duration-200 ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** يبقى النص مقروءاً أثناء التحميل بدل أن يقفز عرض الزر */
  loadingText?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, loadingText, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
});

export interface ButtonLinkProps extends React.ComponentProps<typeof Link> {
  variant?: Variant;
  size?: Size;
}

export function ButtonLink({ className, variant = 'primary', size = 'md', ...props }: ButtonLinkProps) {
  return <Link className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />;
}
