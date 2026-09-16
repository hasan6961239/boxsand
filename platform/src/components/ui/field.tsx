'use client';

import { forwardRef, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

const CONTROL =
  'w-full bg-surface border border-border rounded-xl px-3.5 text-sm text-text ' +
  'placeholder:text-subtle transition-[border-color,box-shadow] duration-200 ' +
  'hover:border-border-strong focus:border-primary focus:ring-4 focus:ring-primary/10 ' +
  'focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/10';

interface FieldShellProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (id: string, invalid: boolean) => React.ReactNode;
  className?: string;
}

/** غلاف موحّد: تسمية مرتبطة، تلميح، ورسالة خطأ يقرؤها قارئ الشاشة. */
export function Field({ label, hint, error, required, children, className }: FieldShellProps) {
  const id = useId();
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={id} className="block text-[0.8125rem] font-medium text-text">
          {label}
          {required && <span className="text-danger ms-1" aria-hidden>*</span>}
        </label>
      )}
      {children(id, Boolean(error))}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL, 'h-11', className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(CONTROL, 'py-2.5 resize-y min-h-24', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select ref={ref} className={cn(CONTROL, 'h-11 appearance-none pe-10', className)} {...props}>
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
          aria-hidden
        />
      </div>
    );
  },
);

interface SwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  name?: string;
}

export function Switch({ checked, onChange, label, description, disabled, name }: SwitchProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 cursor-pointer select-none',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          checked ? 'bg-primary' : 'bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[inset-inline-start] duration-200',
            checked ? 'start-[1.375rem]' : 'start-0.5',
          )}
        />
      </button>
      {name && <input type="hidden" name={name} value={checked ? 'true' : 'false'} />}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text">{label}</span>
        {description && <span className="block text-xs text-muted mt-0.5">{description}</span>}
      </span>
    </label>
  );
}
