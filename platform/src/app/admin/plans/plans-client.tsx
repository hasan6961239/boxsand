'use client';

import { useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea, Switch } from '@/components/ui/field';
import { Card, CardTitle, CardDescription, PageHeader, Badge } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { savePlanAction } from '../actions';
import type { Plan } from '@/types/database';

export function PlansClient({ plans, counts }: { plans: Plan[]; counts: Record<string, number> }) {
  return (
    <>
      <PageHeader
        title="الخطط"
        description="الأسعار والحدود تُدار من هنا وتظهر فوراً في صفحة الأسعار. لا تُخصم أي مبالغ آلياً."
      />

      <div className="space-y-4">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} count={counts[plan.id] ?? 0} />
        ))}
      </div>

      <p className="mt-6 rounded-xl bg-info-soft px-4 py-3 text-xs leading-relaxed text-info">
        حقل فارغ في «الحد الأقصى» يعني بلا حد. الحدود تُفرض فعلياً عند إضافة قسم أو صنف،
        لا في الواجهة فقط.
      </p>
    </>
  );
}

function PlanCard({ plan, count }: { plan: Plan; count: number }) {
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description ?? '');
  const [price, setPrice] = useState(plan.price_monthly === null ? '' : String(plan.price_monthly));
  const [maxCategories, setMaxCategories] = useState(plan.max_categories === null ? '' : String(plan.max_categories));
  const [maxProducts, setMaxProducts] = useState(plan.max_products === null ? '' : String(plan.max_products));
  const [features, setFeatures] = useState<string[]>(plan.features ?? []);
  const [isPublic, setIsPublic] = useState(plan.is_public);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save() {
    setBusy(true);
    const result = await savePlanAction(plan.id, {
      name,
      description,
      price_monthly: price.trim() === '' ? null : Number(price),
      max_categories: maxCategories.trim() === '' ? null : Number(maxCategories),
      max_products: maxProducts.trim() === '' ? null : Number(maxProducts),
      features,
      is_public: isPublic,
    });
    setBusy(false);
    if (result.error) toast.error(result.error);
    else toast.success('تم حفظ الخطة.');
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{plan.name}</CardTitle>
          <CardDescription>
            المعرّف <code className="ltr-nums rounded bg-surface-2 px-1.5 py-0.5 text-xs">{plan.code}</code>
          </CardDescription>
        </div>
        <Badge className="bg-surface-2 text-muted">
          <span className="nums">{count}</span> مطعم
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="اسم الخطة">
          {(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label="السعر الشهري" hint="اتركه فارغاً لعرض «تواصل معنا».">
          {(id) => (
            <Input
              id={id}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              type="number"
              min="0"
              step="0.01"
              dir="ltr"
              className="text-start"
              placeholder="TBD"
            />
          )}
        </Field>
      </div>

      <Field label="وصف مختصر">
        {(id) => <Textarea id={id} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="أقصى عدد أقسام" hint="فارغ = بلا حد.">
          {(id) => (
            <Input id={id} value={maxCategories} onChange={(event) => setMaxCategories(event.target.value)}
              type="number" min="1" dir="ltr" className="text-start" placeholder="بلا حد" />
          )}
        </Field>
        <Field label="أقصى عدد أصناف" hint="فارغ = بلا حد.">
          {(id) => (
            <Input id={id} value={maxProducts} onChange={(event) => setMaxProducts(event.target.value)}
              type="number" min="1" dir="ltr" className="text-start" placeholder="بلا حد" />
          )}
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-[0.8125rem] font-medium text-text">مزايا الخطة</p>
        {features.map((feature, index) => (
          <div key={index} className="flex gap-2">
            <Input
              value={feature}
              onChange={(event) =>
                setFeatures((list) => list.map((item, i) => (i === index ? event.target.value : item)))
              }
              aria-label={`الميزة ${index + 1}`}
            />
            <button
              type="button"
              onClick={() => setFeatures((list) => list.filter((_, i) => i !== index))}
              aria-label={`حذف الميزة ${index + 1}`}
              className="grid size-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setFeatures((list) => [...list, ''])}>
          <Plus className="size-4" aria-hidden />
          إضافة ميزة
        </Button>
      </div>

      <Switch
        checked={isPublic}
        onChange={setIsPublic}
        label="اعرضها في صفحة الأسعار"
        description="أخفِها إن كانت خطة خاصة تُمنح يدوياً."
      />

      <div className="flex justify-end">
        <Button onClick={save} loading={busy} loadingText="جارٍ الحفظ…">
          <Save className="size-4" aria-hidden />
          حفظ الخطة
        </Button>
      </div>
    </Card>
  );
}
