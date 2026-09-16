'use client';

import { useActionState, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { registerAction, type FormState } from '../actions';
import { AuthHeader, FormAlert, AuthFooterLink } from '../auth-form';

export function RegisterForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(registerAction, {});
  const [visible, setVisible] = useState(false);

  return (
    <>
      <AuthHeader title="أنشئ حسابك" subtitle="دقيقة واحدة، ويصبح منيو مطعمك جاهزاً." />
      <FormAlert state={state} />

      <form action={action} className="space-y-4" noValidate>
        <Field label="اسمك" error={state.fields?.fullName} required>
          {(id, invalid) => (
            <Input id={id} name="fullName" autoComplete="name" placeholder="محمد علي" aria-invalid={invalid} required />
          )}
        </Field>

        <Field label="اسم المطعم" error={state.fields?.restaurantName} required hint="تستطيع تغييره لاحقاً.">
          {(id, invalid) => (
            <Input
              id={id}
              name="restaurantName"
              placeholder="مطعم الذوق"
              aria-invalid={invalid}
              required
            />
          )}
        </Field>

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

        <Field label="رقم الهاتف" error={state.fields?.phone} required>
          {(id, invalid) => (
            <Input
              id={id}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              className="text-start"
              placeholder="0912345678"
              aria-invalid={invalid}
              required
            />
          )}
        </Field>

        <Field
          label="كلمة المرور"
          error={state.fields?.password}
          hint="٨ محارف على الأقل."
          required
        >
          {(id, invalid) => (
            <div className="relative">
              <Input
                id={id}
                name="password"
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={8}
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

        <Button type="submit" size="lg" className="w-full" loading={pending} loadingText="جارٍ الإنشاء…">
          إنشاء الحساب
        </Button>
      </form>

      <AuthFooterLink text="لديك حساب؟" href="/login" label="سجّل الدخول" />
    </>
  );
}
