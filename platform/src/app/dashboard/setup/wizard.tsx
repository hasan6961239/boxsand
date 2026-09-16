'use client';

import { useActionState } from 'react';
import { Store, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { CURRENCIES } from '@/lib/config';
import { createRestaurantAction, type ActionState } from '../actions';

export function SetupWizard({ defaultName, defaultPhone }: { defaultName: string; defaultPhone: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createRestaurantAction, {});

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
          <Store className="size-7" aria-hidden />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-text">أنشئ مطعمك</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          هذه الخطوة الوحيدة المطلوبة الآن. كل شيء آخر — الشعار والصور والأقسام والأصناف —
          تضيفه من لوحة التحكم متى شئت.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="mb-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <form action={action} className="space-y-4" noValidate>
        <Field label="اسم المطعم" error={state.fields?.name} required>
          {(id, invalid) => (
            <Input
              id={id}
              name="name"
              defaultValue={defaultName}
              placeholder="مطعم الذوق"
              aria-invalid={invalid}
              data-autofocus
              required
            />
          )}
        </Field>

        <Field label="رقم الهاتف" hint="يظهر للزبون كزر اتصال في المنيو.">
          {(id) => (
            <Input
              id={id}
              name="phone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              className="text-start"
              defaultValue={defaultPhone}
              placeholder="0912345678"
            />
          )}
        </Field>

        <Field label="العملة">
          {(id) => (
            <Select id={id} name="currency" defaultValue="LYD">
              {Object.values(CURRENCIES).map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.label} ({currency.symbol})
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={pending} loadingText="جارٍ الإنشاء…">
          <Sparkles className="size-4" aria-hidden />
          أنشئ المطعم
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-subtle">
        سيُولَّد رابط المنيو ورمز QR تلقائياً، وتستطيع تعديل الرابط لاحقاً دون أن ينكسر الرمز المطبوع.
      </p>
    </div>
  );
}
