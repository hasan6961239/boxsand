'use client';

import { useActionState, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { resetPasswordAction, type FormState } from '../actions';
import { AuthHeader, FormAlert } from '../auth-form';

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(resetPasswordAction, {});
  const [visible, setVisible] = useState(false);

  return (
    <>
      <AuthHeader title="كلمة مرور جديدة" subtitle="اختر كلمة مرور قوية لا تستخدمها في مكان آخر." />
      <FormAlert state={state} />

      <form action={action} className="space-y-4" noValidate>
        <Field label="كلمة المرور الجديدة" error={state.fields?.password} hint="٨ محارف على الأقل." required>
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

        <Field label="تأكيد كلمة المرور" error={state.fields?.confirm} required>
          {(id, invalid) => (
            <Input
              id={id}
              name="confirm"
              type={visible ? 'text' : 'password'}
              autoComplete="new-password"
              aria-invalid={invalid}
              required
            />
          )}
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={pending} loadingText="جارٍ الحفظ…">
          حفظ كلمة المرور
        </Button>
      </form>
    </>
  );
}
