'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { resendVerificationAction, type FormState } from '../actions';
import { FormAlert } from '../auth-form';

export function ResendVerification({ email }: { email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resendVerificationAction, {});

  return (
    <div className="mt-6">
      <FormAlert state={state} />
      {!state.success && (
        <form action={action}>
          <input type="hidden" name="email" value={email} />
          <Button type="submit" variant="outline" className="w-full" loading={pending} loadingText="جارٍ الإرسال…">
            أعد إرسال رسالة التفعيل
          </Button>
        </form>
      )}
    </div>
  );
}
