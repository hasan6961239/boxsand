'use client';

import Link from 'next/link';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { FormState } from './actions';

export function AuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-text">{title}</h1>
      <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
    </div>
  );
}

export function FormAlert({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="mb-4 flex items-start gap-2.5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
        <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p role="status" className="mb-4 flex items-start gap-2.5 rounded-xl bg-success-soft px-4 py-3 text-sm text-success">
        <CheckCircle2 className="mt-px size-4 shrink-0" aria-hidden />
        {state.success}
      </p>
    );
  }
  return null;
}

export function AuthFooterLink({ text, href, label }: { text: string; href: string; label: string }) {
  return (
    <p className="mt-6 text-center text-sm text-muted">
      {text}{' '}
      <Link href={href} className="font-medium text-primary hover:underline">
        {label}
      </Link>
    </p>
  );
}
