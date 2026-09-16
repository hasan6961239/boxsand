'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { loginAction, type FormState } from '../actions';
import { AuthHeader, FormAlert, AuthFooterLink } from '../auth-form';

export function LoginForm({ next, linkError }: { next?: string; linkError?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  const [visible, setVisible] = useState(false);

  const merged: FormState = linkError && !state.error
    ? { ...state, error: 'انتهت صلاحية الرابط أو استُخدم مسبقاً. أعد المحاولة.' }
    : state;

  return (
    <>
      <AuthHeader title="تسجيل الدخول" subtitle="أهلاً بعودتك. أدخل بياناتك للمتابعة." />
      <FormAlert state={merged} />

      <form action={action} className="space-y-4" noValidate>
        {next && <input type="hidden" name="next" value={next} />}

        <Field label="البريد الإلكتروني" error={state.fields?.email} required>
          {(id, invalid) => (
            <Input
              id={id}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              className="text-start"
              placeholder="you@example.com"
              aria-invalid={invalid}
              required
            />
          )}
        </Field>

        <Field label="كلمة المرور" error={state.fields?.password} required>
          {(id, invalid) => (
            <div className="relative">
              <Input
                id={id}
                name="password"
                type={visible ? 'text' : 'password'}
                autoComplete="current-password"
                className="pe-11"
                aria-invalid={invalid}
                required
              />
              <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-subtle transition-colors hover:text-text"
              >
                {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            </div>
          )}
        </Field>

        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm text-primary hover:underline">
            نسيت كلمة المرور؟
          </Link>
        </div>

        <Button type="submit" size="lg" className="w-full" loading={pending} loadingText="جارٍ الدخول…">
          دخول
        </Button>
      </form>

      <AuthFooterLink text="ليس لديك حساب؟" href="/register" label="أنشئ حساباً" />
    </>
  );
}
