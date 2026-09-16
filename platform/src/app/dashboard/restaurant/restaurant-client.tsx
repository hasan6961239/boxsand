'use client';

import { useActionState, useEffect, useState } from 'react';
import { Instagram, Facebook, MapPin, Phone, MessageCircle, Music2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea, Select, Switch } from '@/components/ui/field';
import { Card, CardTitle, CardDescription, PageHeader } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/tabs';
import { ImageUploader } from '@/components/dashboard/image-uploader';
import { useToast } from '@/components/ui/toast';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { CURRENCIES, WEEKDAYS, siteUrl } from '@/lib/config';
import { slugify } from '@/lib/validation';
import { THEME_PRESETS, mergeTheme, themeToCssVars, type ThemeValues } from '@/lib/theme';
import { cn } from '@/lib/cn';
import {
  updateRestaurantAction, updateMediaAction, updateThemeAction, saveHoursAction,
  type ActionState,
} from '../actions';
import type { OpeningHour, Restaurant, RestaurantTheme, ThemePreset } from '@/types/database';

interface Props {
  restaurant: Restaurant;
  theme: RestaurantTheme | null;
  hours: OpeningHour[];
}

export function RestaurantClient({ restaurant, theme, hours }: Props) {
  return (
    <>
      <PageHeader
        title="معلومات المطعم"
        description="ما يراه الزبون في أعلى صفحة المنيو."
      />
      <Tabs
        items={[
          { id: 'profile', label: 'المعلومات', content: <ProfileTab restaurant={restaurant} /> },
          { id: 'hours', label: 'أوقات العمل', content: <HoursTab restaurantId={restaurant.id} hours={hours} /> },
          { id: 'theme', label: 'المظهر', content: <ThemeTab restaurantId={restaurant.id} theme={theme} /> },
        ]}
      />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   المعلومات
   ══════════════════════════════════════════════════════════════════════════ */

function ProfileTab({ restaurant }: { restaurant: Restaurant }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateRestaurantAction, {});
  const [slug, setSlug] = useState(restaurant.slug);
  const [logo, setLogo] = useState(restaurant.logo_url);
  const [cover, setCover] = useState(restaurant.cover_url);
  const [showUnavailable, setShowUnavailable] = useState(restaurant.show_unavailable);
  const [showPrices, setShowPrices] = useState(restaurant.show_prices);
  const [acceptComplaints, setAcceptComplaints] = useState(restaurant.accept_complaints);
  const [dirty, setDirty] = useState(false);
  const toast = useToast();

  useUnsavedChanges(dirty);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.error ?? 'تم حفظ معلومات المطعم.');
      setDirty(false);
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function saveMedia(field: 'logo_url' | 'cover_url', url: string | null) {
    const result = await updateMediaAction(restaurant.id, field, url);
    if (result.error) toast.error(result.error);
    else toast.success('تم تحديث الصورة.');
  }

  return (
    <form action={action} className="space-y-5" onChange={() => setDirty(true)}>
      <input type="hidden" name="id" value={restaurant.id} />

      <Card>
        <CardTitle>الهوية</CardTitle>
        <CardDescription>الشعار والغلاف أول ما يراه الزبون.</CardDescription>

        <div className="mt-4 grid gap-5 sm:grid-cols-[auto_1fr]">
          <ImageUploader
            restaurantId={restaurant.id}
            kind="logo"
            value={logo}
            onChange={(url) => { setLogo(url); void saveMedia('logo_url', url); }}
            label="الشعار"
            aspect="square"
          />
          <ImageUploader
            restaurantId={restaurant.id}
            kind="cover"
            value={cover}
            onChange={(url) => { setCover(url); void saveMedia('cover_url', url); }}
            label="صورة الغلاف"
            hint="يُفضَّل أن تكون عريضة وواضحة، وألا يكون فيها نص."
            aspect="wide"
          />
        </div>
      </Card>

      <Card className="space-y-4">
        <div>
          <CardTitle>الأساسيات</CardTitle>
          <CardDescription>الاسم والوصف ورابط المنيو.</CardDescription>
        </div>

        <Field label="اسم المطعم" error={state.fields?.name} required>
          {(id, invalid) => (
            <Input id={id} name="name" defaultValue={restaurant.name} aria-invalid={invalid} required />
          )}
        </Field>

        <Field
          label="رابط المنيو"
          error={state.fields?.slug}
          hint="تغييره لا يكسر رمز QR المطبوع — الرابط القديم يبقى يعمل ويحوّل إلى الجديد."
          required
        >
          {(id, invalid) => (
            <>
              <Input
                id={id}
                name="slug"
                value={slug}
                onChange={(event) => setSlug(slugify(event.target.value))}
                dir="ltr"
                className="text-start"
                aria-invalid={invalid}
                required
              />
              <p className="nums mt-1.5 truncate text-xs text-subtle" dir="ltr">
                {siteUrl()}/menu/{slug || '…'}
              </p>
            </>
          )}
        </Field>

        <Field label="جملة تعريفية" hint="سطر قصير تحت اسم المطعم.">
          {(id) => <Input id={id} name="tagline" defaultValue={restaurant.tagline ?? ''} placeholder="مذاق البيت، بروح المطاعم" />}
        </Field>

        <Field label="نبذة عن المطعم">
          {(id) => <Textarea id={id} name="description" rows={4} defaultValue={restaurant.description ?? ''} />}
        </Field>
      </Card>

      <Card className="space-y-4">
        <div>
          <CardTitle>التواصل</CardTitle>
          <CardDescription>تظهر كأزرار يضغطها الزبون مباشرة. اترك ما لا يخصّك فارغاً.</CardDescription>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ContactField name="phone" label="رقم الهاتف" icon={Phone} defaultValue={restaurant.phone} error={state.fields?.phone} placeholder="0912345678" ltr />
          <ContactField name="whatsapp" label="واتساب" icon={MessageCircle} defaultValue={restaurant.whatsapp} error={state.fields?.whatsapp} placeholder="0912345678" ltr />
          <ContactField name="instagram" label="إنستغرام" icon={Instagram} defaultValue={restaurant.instagram} placeholder="اسم الحساب بلا @" ltr />
          <ContactField name="facebook" label="فيسبوك" icon={Facebook} defaultValue={restaurant.facebook} placeholder="اسم الصفحة أو الرابط" ltr />
          <ContactField name="tiktok" label="تيك توك" icon={Music2} defaultValue={restaurant.tiktok} placeholder="اسم الحساب بلا @" ltr />
          <ContactField name="maps_url" label="رابط الموقع على الخرائط" icon={MapPin} defaultValue={restaurant.maps_url} error={state.fields?.maps_url} placeholder="https://maps.google.com/…" ltr />
        </div>

        <Field label="العنوان">
          {(id) => <Input id={id} name="address" defaultValue={restaurant.address ?? ''} placeholder="شارع الجمهورية، طرابلس" />}
        </Field>
      </Card>

      <Card className="space-y-4">
        <div>
          <CardTitle>إعدادات المنيو</CardTitle>
          <CardDescription>كيف يتصرّف المنيو مع الزبون.</CardDescription>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="العملة">
            {(id) => (
              <Select id={id} name="currency" defaultValue={restaurant.currency}>
                {Object.values(CURRENCIES).map((currency) => (
                  <option key={currency.code} value={currency.code}>{currency.label} ({currency.symbol})</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="المنطقة الزمنية" hint="تُستخدم في حساب «مفتوح الآن».">
            {(id) => (
              <Select id={id} name="timezone" defaultValue={restaurant.timezone}>
                {['Africa/Tripoli', 'Africa/Cairo', 'Africa/Tunis', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/Istanbul', 'UTC'].map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Switch name="show_unavailable" checked={showUnavailable} onChange={(v) => { setShowUnavailable(v); setDirty(true); }}
          label="إظهار الأصناف غير المتوفرة" description="تظهر باهتة مع كلمة «غير متوفر» بدل أن تختفي." />
        <Switch name="show_prices" checked={showPrices} onChange={(v) => { setShowPrices(v); setDirty(true); }}
          label="إظهار الأسعار" description="أطفئه إن كنت تعرض المنيو بلا أسعار." />
        <Switch name="accept_complaints" checked={acceptComplaints} onChange={(v) => { setAcceptComplaints(v); setDirty(true); }}
          label="استقبال الشكاوى والاقتراحات" description="يظهر زر التواصل في نهاية المنيو." />
      </Card>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <Button type="submit" size="lg" loading={pending} loadingText="جارٍ الحفظ…" className="shadow-lg">
          حفظ التغييرات
        </Button>
      </div>
    </form>
  );
}

function ContactField({
  name, label, icon: Icon, defaultValue, error, placeholder, ltr,
}: {
  name: string;
  label: string;
  icon: typeof Phone;
  defaultValue: string | null;
  error?: string;
  placeholder?: string;
  ltr?: boolean;
}) {
  return (
    <Field label={label} error={error}>
      {(id, invalid) => (
        <div className="relative">
          <Icon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            id={id}
            name={name}
            defaultValue={defaultValue ?? ''}
            placeholder={placeholder}
            dir={ltr ? 'ltr' : undefined}
            className={cn('ps-10', ltr && 'text-start')}
            aria-invalid={invalid}
          />
        </div>
      )}
    </Field>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   أوقات العمل
   ══════════════════════════════════════════════════════════════════════════ */

interface Slot {
  key: string;
  opens_at: string;
  closes_at: string;
}

function HoursTab({ restaurantId, hours }: { restaurantId: string; hours: OpeningHour[] }) {
  const [days, setDays] = useState<Slot[][]>(() =>
    Array.from({ length: 7 }, (_, weekday) =>
      hours
        .filter((hour) => hour.weekday === weekday)
        .map((hour) => ({
          key: hour.id,
          opens_at: hour.opens_at.slice(0, 5),
          closes_at: hour.closes_at.slice(0, 5),
        })),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const toast = useToast();

  useUnsavedChanges(dirty);

  function update(weekday: number, next: Slot[]) {
    setDirty(true);
    setDays((current) => current.map((slots, index) => (index === weekday ? next : slots)));
  }

  async function save() {
    setSaving(true);
    const payload = days.flatMap((slots, weekday) =>
      slots.map((slot) => ({ weekday, opens_at: slot.opens_at, closes_at: slot.closes_at })),
    );
    const result = await saveHoursAction(restaurantId, payload);
    setSaving(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('تم حفظ أوقات العمل.');
      setDirty(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>أوقات العمل</CardTitle>
        <CardDescription>
          أضف فترتين لليوم الواحد إن كنت تغلق بين الظهر والمساء. الفترة التي تنتهي
          بعد منتصف الليل (مثل ١٨:٣٠ ← ٠١:٠٠) تُفهَم تلقائياً.
        </CardDescription>

        <div className="mt-5 space-y-3">
          {WEEKDAYS.map((label, weekday) => {
            const slots = days[weekday] ?? [];
            const closed = slots.length === 0;

            return (
              <div key={label} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text">{label}</span>
                  {closed ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-subtle">مغلق</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => update(weekday, [{ key: Math.random().toString(36), opens_at: '11:00', closes_at: '23:00' }])}
                      >
                        إضافة فترة
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        update(weekday, [
                          ...slots,
                          { key: Math.random().toString(36), opens_at: '18:30', closes_at: '01:00' },
                        ])
                      }
                    >
                      + فترة أخرى
                    </Button>
                  )}
                </div>

                {slots.map((slot, index) => (
                  <div key={slot.key} className="mt-2.5 flex items-center gap-2">
                    <Input
                      type="time"
                      value={slot.opens_at}
                      onChange={(event) =>
                        update(weekday, slots.map((s, i) => (i === index ? { ...s, opens_at: event.target.value } : s)))
                      }
                      aria-label={`${label} — بداية الفترة ${index + 1}`}
                      className="nums w-32"
                    />
                    <span className="text-subtle" aria-hidden>←</span>
                    <Input
                      type="time"
                      value={slot.closes_at}
                      onChange={(event) =>
                        update(weekday, slots.map((s, i) => (i === index ? { ...s, closes_at: event.target.value } : s)))
                      }
                      aria-label={`${label} — نهاية الفترة ${index + 1}`}
                      className="nums w-32"
                    />
                    <button
                      type="button"
                      onClick={() => update(weekday, slots.filter((_, i) => i !== index))}
                      aria-label={`حذف الفترة ${index + 1} من ${label}`}
                      className="ms-auto rounded-lg px-2.5 py-2 text-xs text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      حذف
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <Button size="lg" onClick={save} loading={saving} loadingText="جارٍ الحفظ…" className="shadow-lg">
          حفظ أوقات العمل
        </Button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   المظهر
   ══════════════════════════════════════════════════════════════════════════ */

function ThemeTab({ restaurantId, theme }: { restaurantId: string; theme: RestaurantTheme | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateThemeAction, {});
  const [values, setValues] = useState<ThemeValues>(mergeTheme(theme));
  const [dark, setDark] = useState(values.default_dark);
  const toast = useToast();

  useEffect(() => {
    if (state.ok) toast.success('تم حفظ المظهر.');
    else if (state.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function applyPreset(preset: ThemePreset) {
    const next = THEME_PRESETS[preset].values;
    setValues(next);
    setDark(next.default_dark);
  }

  const cssVars = themeToCssVars(values) as React.CSSProperties;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="restaurant_id" value={restaurantId} />
      <input type="hidden" name="preset" value={values.preset} />
      <input type="hidden" name="font_family" value={values.font_family} />

      <Card>
        <CardTitle>ثيم جاهز</CardTitle>
        <CardDescription>ابدأ من ثيم ثم عدّل ما تشاء.</CardDescription>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(THEME_PRESETS).map(([key, preset]) => {
            const selected = values.preset === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key as ThemePreset)}
                aria-pressed={selected}
                className={cn(
                  'rounded-xl border p-3 text-start transition-colors',
                  selected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:bg-surface-2',
                )}
              >
                <span className="flex gap-1.5">
                  {[preset.values.primary_color, preset.values.secondary_color, preset.values.background_color, preset.values.card_color].map((color, index) => (
                    <span
                      key={index}
                      className="size-6 rounded-md border border-black/10"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </span>
                <span className="mt-2.5 block text-sm font-bold text-text">{preset.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">{preset.description}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardTitle>تخصيص</CardTitle>
        <CardDescription>غيّر أي لون، والمعاينة تتحدّث فوراً.</CardDescription>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ColorField label="اللون الأساسي" name="primary_color" value={values.primary_color}
            onChange={(v) => setValues((s) => ({ ...s, primary_color: v }))} error={state.fields?.primary_color} />
          <ColorField label="اللون الثانوي" name="secondary_color" value={values.secondary_color}
            onChange={(v) => setValues((s) => ({ ...s, secondary_color: v }))} error={state.fields?.secondary_color} />
          <ColorField label="لون الخلفية" name="background_color" value={values.background_color}
            onChange={(v) => setValues((s) => ({ ...s, background_color: v }))} error={state.fields?.background_color} />
          <ColorField label="لون البطاقات" name="card_color" value={values.card_color}
            onChange={(v) => setValues((s) => ({ ...s, card_color: v }))} error={state.fields?.card_color} />
          <ColorField label="لون النص" name="text_color" value={values.text_color}
            onChange={(v) => setValues((s) => ({ ...s, text_color: v }))} error={state.fields?.text_color} />

          <Field label="شكل الأزرار">
            {(id) => (
              <Select
                id={id}
                name="button_style"
                value={values.button_style}
                onChange={(event) => setValues((s) => ({ ...s, button_style: event.target.value as ThemeValues['button_style'] }))}
              >
                <option value="solid">ممتلئ</option>
                <option value="soft">خفيف</option>
                <option value="outline">محدَّد</option>
              </Select>
            )}
          </Field>
        </div>

        <div className="mt-4">
          <label htmlFor="radius" className="text-[0.8125rem] font-medium text-text">
            استدارة الحواف: <span className="nums text-muted">{values.border_radius}px</span>
          </label>
          <input
            id="radius"
            name="border_radius"
            type="range"
            min={0}
            max={32}
            value={values.border_radius}
            onChange={(event) => setValues((s) => ({ ...s, border_radius: Number(event.target.value) }))}
            className="mt-2 w-full accent-[var(--primary)]"
          />
        </div>

        <div className="mt-4">
          <Switch
            name="default_dark"
            checked={dark}
            onChange={(value) => { setDark(value); setValues((s) => ({ ...s, default_dark: value })); }}
            label="افتح المنيو بالوضع الليلي افتراضياً"
            description="يستطيع الزبون التبديل في أي وقت."
          />
        </div>
      </Card>

      <Card>
        <CardTitle>معاينة</CardTitle>
        <CardDescription>هكذا سيبدو صنف في منيوك.</CardDescription>

        <div
          className="mt-4 rounded-2xl p-5"
          style={{ ...cssVars, backgroundColor: 'var(--r-bg)', color: 'var(--r-text)' }}
        >
          <div
            className="flex items-center gap-3 p-3"
            style={{ backgroundColor: 'var(--r-card)', borderRadius: 'var(--r-radius)' }}
          >
            <div
              className="size-16 shrink-0"
              style={{
                borderRadius: 'calc(var(--r-radius) * 0.7)',
                background: 'linear-gradient(135deg, var(--r-primary), var(--r-secondary))',
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="font-bold" style={{ color: 'var(--r-text)' }}>برجر الذوق الخاص</p>
              <p className="mt-0.5 text-xs" style={{ color: 'rgb(var(--r-text-rgb) / 0.62)' }}>
                لحم بقري طازج، جبنة شيدر، وصوص البيت.
              </p>
              <p className="nums mt-1.5 text-sm font-bold" style={{ color: 'var(--r-primary)' }}>28 د.ل</p>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <span
              className="px-4 py-2 text-xs font-medium"
              style={{
                borderRadius: 'calc(var(--r-radius) * 0.6)',
                backgroundColor: values.button_style === 'solid' ? 'var(--r-primary)' : 'transparent',
                color: values.button_style === 'solid' ? 'var(--r-primary-fg)' : 'var(--r-primary)',
                border: values.button_style === 'outline' ? '1px solid var(--r-primary)' : '1px solid transparent',
                ...(values.button_style === 'soft'
                  ? { backgroundColor: 'rgb(var(--r-primary-rgb) / 0.12)' }
                  : {}),
              }}
            >
              اتصال
            </span>
            <span
              className="px-4 py-2 text-xs font-medium"
              style={{
                borderRadius: 'calc(var(--r-radius) * 0.6)',
                backgroundColor: 'rgb(var(--r-secondary-rgb) / 0.15)',
                color: 'var(--r-secondary)',
              }}
            >
              واتساب
            </span>
          </div>
        </div>
      </Card>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <Button type="submit" size="lg" loading={pending} loadingText="جارٍ الحفظ…" className="shadow-lg">
          حفظ المظهر
        </Button>
      </div>
    </form>
  );
}

function ColorField({
  label, name, value, onChange, error,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <Field label={label} error={error}>
      {(id) => (
        <div className="flex gap-2">
          <input
            type="color"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={`${label} — منتقي الألوان`}
            className="h-11 w-14 shrink-0 cursor-pointer rounded-xl border border-border bg-surface p-1"
          />
          <Input
            id={id}
            name={name}
            value={value.toUpperCase()}
            onChange={(event) => onChange(event.target.value)}
            dir="ltr"
            className="nums text-start"
            maxLength={7}
          />
        </div>
      )}
    </Field>
  );
}
