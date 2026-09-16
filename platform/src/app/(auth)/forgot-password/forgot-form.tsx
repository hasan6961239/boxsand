'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { forgotPasswordAction, type FormState } from '../actions';
import { AuthHeader, FormAlert, AuthFooterLink } from '../auth-form';

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(forgotPasswordAction, {});

  return (
    <>
      <AuthHeader
        title="استعادة كلمة المرور"
        subtitle="أدخل بريدك الإلكتروني وسنرسل إليك رابط إعادة التعيين."
      />
      <FormAlert state={state} />

      {!state.success && (
        <form action={action} className="space-y-4" noValidate>
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

          <Button type="submit" size="lg" className="w-full" loading={pending} loadingText="جارٍ الإرسال…">
            إرسال الرابط
          </Button>
        </form>
      )}

      <AuthFooterLink text="تذكّرتها؟" href="/login" label="عد لتسجيل الدخول" />
    </>
  );
}
