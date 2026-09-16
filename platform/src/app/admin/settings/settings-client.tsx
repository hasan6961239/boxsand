'use client';

import { useActionState, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea, Switch } from '@/components/ui/field';
import { Card, CardTitle, CardDescription, PageHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { savePlatformSettingsAction } from '../actions';
import type { ActionState } from '@/app/dashboard/actions';
import type { PlatformSettings } from '@/types/database';

export function SettingsClient({ settings }: { settings: PlatformSettings }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePlatformSettingsAction, {});
  const [allowSignup, setAllowSignup] = useState(settings.allow_signup);
  const [color, setColor] = useState(settings.primary_color);
  const toast = useToast();

  useEffect(() => {
    if (state.ok) toast.success('تم حفظ إعدادات المنصة.');
    else if (state.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <>
      <PageHeader title="إعدادات المنصة" description="اسم المنصة وبيانات التواصل وسياسة التسجيل." />

      <form action={action} className="space-y-5">
        <Card className="space-y-4">
          <div>
            <CardTitle>الهوية</CardTitle>
            <CardDescription>تظهر في الصفحة الرئيسية وفي تذييل كل منيو.</CardDescription>
          </div>

          <Field label="اسم المنصة" error={state.fields?.platform_name} required>
            {(id, invalid) => (
              <Input id={id} name="platform_name" defaultValue={settings.platform_name} aria-invalid={invalid} required />
            )}
          </Field>

          <Field label="الجملة التعريفية">
            {(id) => <Input id={id} name="tagline" defaultValue={settings.tagline} />}
          </Field>

          <Field label="اللون الأساسي">
            {(id) => (
              <div className="flex gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  aria-label="اللون الأساسي — منتقي الألوان"
                  className="h-11 w-14 shrink-0 cursor-pointer rounded-xl border border-border bg-surface p-1"
                />
                <Input
                  id={id}
                  name="primary_color"
                  value={color.toUpperCase()}
                  onChange={(event) => setColor(event.target.value)}
                  dir="ltr"
                  className="ltr-nums"
                  maxLength={7}
                />
              </div>
            )}
          </Field>
        </Card>

        <Card className="space-y-4">
          <div>
            <CardTitle>التواصل</CardTitle>
            <CardDescription>تظهر في تذييل الصفحة الرئيسية ليتواصل معك أصحاب المطاعم.</CardDescription>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="البريد الإلكتروني">
              {(id) => (
                <Input id={id} name="contact_email" type="email" dir="ltr" className="text-start"
                  defaultValue={settings.contact_email ?? ''} placeholder="hello@example.com" />
              )}
            </Field>
            <Field label="رقم الهاتف">
              {(id) => (
                <Input id={id} name="contact_phone" type="tel" dir="ltr" className="text-start"
                  defaultValue={settings.contact_phone ?? ''} placeholder="0912345678" />
              )}
            </Field>
            <Field label="واتساب">
              {(id) => (
                <Input id={id} name="whatsapp" type="tel" dir="ltr" className="text-start"
                  defaultValue={settings.whatsapp ?? ''} placeholder="0912345678" />
              )}
            </Field>
          </div>
        </Card>

        <Card className="space-y-4">
          <div>
            <CardTitle>محركات البحث</CardTitle>
            <CardDescription>يخص الصفحة الرئيسية للمنصة. صفحات المطاعم لها وسومها الخاصة.</CardDescription>
          </div>

          <Field label="عنوان الصفحة">
            {(id) => <Input id={id} name="seo_title" defaultValue={settings.seo_title ?? ''} />}
          </Field>
          <Field label="وصف الصفحة" hint="١٦٠ حرفاً تقريباً.">
            {(id) => <Textarea id={id} name="seo_description" rows={2} maxLength={200} defaultValue={settings.seo_description ?? ''} />}
          </Field>
        </Card>

        <Card className="space-y-4">
          <div>
            <CardTitle>التسجيل</CardTitle>
            <CardDescription>تحكّم في من يستطيع فتح حساب على المنصة.</CardDescription>
          </div>

          <Switch
            name="allow_signup"
            checked={allowSignup}
            onChange={setAllowSignup}
            label="السماح بالتسجيل الذاتي"
            description="أطفئه إن كنت تبيع الخدمة يدوياً وتنشئ الحسابات بنفسك."
          />
        </Card>

        <div className="sticky bottom-4 z-10 flex justify-end">
          <Button type="submit" size="lg" loading={pending} loadingText="جارٍ الحفظ…" className="shadow-lg">
            حفظ الإعدادات
          </Button>
        </div>
      </form>
    </>
  );
}
