'use client';

import { useActionState, useEffect, useState } from 'react';
import { Plus, Trash2, Ruler, ListPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea, Select, Switch } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Divider } from '@/components/ui/primitives';
import { ImageUploader } from '@/components/dashboard/image-uploader';
import { useToast } from '@/components/ui/toast';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { BADGE_LABELS, CURRENCIES } from '@/lib/config';
import { cn } from '@/lib/cn';
import {
  saveProductAction, saveVariantsAction, saveOptionGroupsAction, type ActionState,
} from '../actions';
import type { Category, OptionGroup, Product, ProductBadge, ProductOption, ProductVariant } from '@/types/database';

interface GroupWithOptions extends OptionGroup {
  options: ProductOption[];
}

interface VariantDraft {
  key: string;
  name: string;
  price: string;
  is_available: boolean;
}

interface OptionDraft {
  key: string;
  name: string;
  price_delta: string;
  is_available: boolean;
}

interface GroupDraft {
  key: string;
  name: string;
  min_select: string;
  max_select: string;
  options: OptionDraft[];
}

const BADGES: ProductBadge[] = ['new', 'popular', 'offer', 'spicy', 'vegetarian'];
const newKey = () => Math.random().toString(36).slice(2);

interface Props {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  currency: string;
  categories: Category[];
  product: Product | null;
  defaultCategoryId?: string;
  variants: ProductVariant[];
  groups: GroupWithOptions[];
}

export function ProductModal({
  open, onClose, restaurantId, currency, categories, product, defaultCategoryId, variants, groups,
}: Props) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveProductAction, {});
  const toast = useToast();

  const [imageUrl, setImageUrl] = useState(product?.image_url ?? null);
  const [badges, setBadges] = useState<ProductBadge[]>(product?.badges ?? []);
  const [available, setAvailable] = useState(product?.is_available ?? true);
  const [visible, setVisible] = useState(product?.is_visible ?? true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>(
    variants.map((variant) => ({
      key: variant.id,
      name: variant.name,
      price: String(variant.price),
      is_available: variant.is_available,
    })),
  );

  const [groupDrafts, setGroupDrafts] = useState<GroupDraft[]>(
    groups.map((group) => ({
      key: group.id,
      name: group.name,
      min_select: String(group.min_select),
      max_select: String(group.max_select),
      options: group.options.map((option) => ({
        key: option.id,
        name: option.name,
        price_delta: String(option.price_delta),
        is_available: option.is_available,
      })),
    })),
  );

  useUnsavedChanges(open && dirty);

  const symbol = CURRENCIES[currency]?.symbol ?? currency;

  // بعد حفظ الصنف نحفظ الأحجام والإضافات: كلاهما يحتاج معرّف الصنف، وهو غير
  // موجود قبل الإنشاء.
  useEffect(() => {
    if (!state.ok || !state.id) {
      if (state.error) toast.error(state.error);
      return;
    }

    let cancelled = false;
    (async () => {
      setSaving(true);
      try {
        const variantResult = await saveVariantsAction(
          restaurantId,
          state.id!,
          variantDrafts
            .filter((draft) => draft.name.trim())
            .map((draft) => ({
              name: draft.name,
              price: Number(draft.price || 0),
              is_available: draft.is_available,
            })),
        );
        if (variantResult.error) throw new Error(variantResult.error);

        const groupResult = await saveOptionGroupsAction(
          restaurantId,
          state.id!,
          groupDrafts
            .filter((draft) => draft.name.trim())
            .map((draft) => ({
              name: draft.name,
              min_select: Number(draft.min_select || 0),
              max_select: Number(draft.max_select || 1),
              options: draft.options
                .filter((option) => option.name.trim())
                .map((option) => ({
                  name: option.name,
                  price_delta: Number(option.price_delta || 0),
                  is_available: option.is_available,
                })),
            })),
        );
        if (groupResult.error) throw new Error(groupResult.error);

        if (!cancelled) {
          toast.success(product ? 'تم تحديث الصنف.' : 'تمت إضافة الصنف.');
          setDirty(false);
          onClose();
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : 'تعذّر حفظ الأحجام أو الإضافات.');
        }
      } finally {
        if (!cancelled) setSaving(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // نتفاعل مع نتيجة حفظ الصنف فقط
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const busy = pending || saving;

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      variant="sheet"
      title={product ? 'تعديل الصنف' : 'صنف جديد'}
      description="الاسم والسعر والقسم إلزامية، وما عداها اختياري."
    >
      <form action={action} className="space-y-5" onChange={() => setDirty(true)}>
        <input type="hidden" name="restaurant_id" value={restaurantId} />
        {product && <input type="hidden" name="id" value={product.id} />}
        <input type="hidden" name="image_url" value={imageUrl ?? ''} />
        {badges.map((badge) => (
          <input key={badge} type="hidden" name="badges" value={badge} />
        ))}

        <Field label="اسم الصنف" error={state.fields?.name} required>
          {(id, invalid) => (
            <Input
              id={id}
              name="name"
              defaultValue={product?.name}
              placeholder="برجر الذوق الخاص"
              aria-invalid={invalid}
              data-autofocus
              required
            />
          )}
        </Field>

        <Field label="الوصف" hint="سطر أو سطران يشرحان المكوّنات.">
          {(id) => (
            <Textarea id={id} name="description" rows={3} defaultValue={product?.description ?? ''} />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="القسم" error={state.fields?.category_id} required>
            {(id, invalid) => (
              <Select
                id={id}
                name="category_id"
                defaultValue={product?.category_id ?? defaultCategoryId}
                aria-invalid={invalid}
                required
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label={`السعر (${symbol})`}
            error={state.fields?.base_price}
            hint={variantDrafts.length > 0 ? 'يُضبط تلقائياً على أرخص حجم.' : undefined}
            required
          >
            {(id, invalid) => (
              <Input
                id={id}
                name="base_price"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                dir="ltr"
                className="text-start"
                defaultValue={product?.base_price ?? ''}
                aria-invalid={invalid}
                required
              />
            )}
          </Field>
        </div>

        <Field
          label={`السعر قبل الخصم (${symbol})`}
          error={state.fields?.compare_at_price}
          hint="اتركه فارغاً إن لم يكن هناك عرض. يظهر مشطوباً بجانب السعر."
        >
          {(id, invalid) => (
            <Input
              id={id}
              name="compare_at_price"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              dir="ltr"
              className="text-start"
              defaultValue={product?.compare_at_price ?? ''}
              aria-invalid={invalid}
            />
          )}
        </Field>

        <ImageUploader
          restaurantId={restaurantId}
          kind="product"
          value={imageUrl}
          onChange={(url) => {
            setImageUrl(url);
            setDirty(true);
          }}
          label="صورة الصنف"
          hint="تُضغط تلقائياً قبل الرفع حتى يبقى المنيو سريعاً."
          aspect="card"
        />

        <div className="space-y-1.5">
          <p className="text-[0.8125rem] font-medium text-text">الشارات</p>
          <p className="text-xs text-subtle">شارتان كحد أقصى، حتى تبقى البطاقة نظيفة.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {BADGES.map((badge) => {
              const selected = badges.includes(badge);
              return (
                <button
                  key={badge}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setDirty(true);
                    setBadges((current) =>
                      current.includes(badge)
                        ? current.filter((item) => item !== badge)
                        : current.length >= 2
                          ? current
                          : [...current, badge],
                    );
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    selected
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border text-muted hover:bg-surface-2',
                    !selected && badges.length >= 2 && 'opacity-45',
                  )}
                >
                  {BADGE_LABELS[badge]?.label ?? badge}
                </button>
              );
            })}
          </div>
        </div>

        <Divider />

        {/* ── الأحجام ──────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Ruler className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-bold text-text">الأحجام</h3>
          </div>
          <p className="text-xs text-muted">
            أضف أحجاماً إن كان للصنف أكثر من سعر (صغير / وسط / كبير). اتركها فارغة لسعر واحد.
          </p>

          {variantDrafts.map((draft, index) => (
            <div key={draft.key} className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  value={draft.name}
                  onChange={(event) => {
                    setDirty(true);
                    setVariantDrafts((list) =>
                      list.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)),
                    );
                  }}
                  placeholder="وسط"
                  aria-label={`اسم الحجم ${index + 1}`}
                />
              </div>
              <div className="w-28">
                <Input
                  value={draft.price}
                  onChange={(event) => {
                    setDirty(true);
                    setVariantDrafts((list) =>
                      list.map((item, i) => (i === index ? { ...item, price: event.target.value } : item)),
                    );
                  }}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  dir="ltr"
                  className="text-start"
                  placeholder="0"
                  aria-label={`سعر الحجم ${index + 1}`}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setDirty(true);
                  setVariantDrafts((list) => list.filter((_, i) => i !== index));
                }}
                aria-label={`حذف الحجم ${index + 1}`}
                className="mb-0.5 grid size-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDirty(true);
              setVariantDrafts((list) => [...list, { key: newKey(), name: '', price: '', is_available: true }]);
            }}
          >
            <Plus className="size-4" aria-hidden />
            إضافة حجم
          </Button>
        </section>

        <Divider />

        {/* ── الإضافات ─────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <ListPlus className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-bold text-text">الإضافات</h3>
          </div>
          <p className="text-xs text-muted">
            مجموعات خيارات يضيفها الزبون للصنف، مثل «جبنة إضافية +٥».
          </p>

          {groupDrafts.map((group, groupIndex) => (
            <div key={group.key} className="space-y-3 rounded-xl border border-border bg-surface-2/50 p-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    value={group.name}
                    onChange={(event) => {
                      setDirty(true);
                      setGroupDrafts((list) =>
                        list.map((item, i) => (i === groupIndex ? { ...item, name: event.target.value } : item)),
                      );
                    }}
                    placeholder="الإضافات"
                    aria-label={`اسم المجموعة ${groupIndex + 1}`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDirty(true);
                    setGroupDrafts((list) => list.filter((_, i) => i !== groupIndex));
                  }}
                  aria-label={`حذف المجموعة ${groupIndex + 1}`}
                  className="mb-0.5 grid size-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-muted">
                  أقل عدد اختيارات
                  <Input
                    value={group.min_select}
                    onChange={(event) => {
                      setDirty(true);
                      setGroupDrafts((list) =>
                        list.map((item, i) => (i === groupIndex ? { ...item, min_select: event.target.value } : item)),
                      );
                    }}
                    type="number"
                    min="0"
                    max="20"
                    dir="ltr"
                    className="mt-1 text-start"
                  />
                </label>
                <label className="text-xs text-muted">
                  أكثر عدد اختيارات
                  <Input
                    value={group.max_select}
                    onChange={(event) => {
                      setDirty(true);
                      setGroupDrafts((list) =>
                        list.map((item, i) => (i === groupIndex ? { ...item, max_select: event.target.value } : item)),
                      );
                    }}
                    type="number"
                    min="1"
                    max="20"
                    dir="ltr"
                    className="mt-1 text-start"
                  />
                </label>
              </div>

              {group.options.map((option, optionIndex) => (
                <div key={option.key} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input
                      value={option.name}
                      onChange={(event) => {
                        setDirty(true);
                        setGroupDrafts((list) =>
                          list.map((item, i) =>
                            i === groupIndex
                              ? {
                                  ...item,
                                  options: item.options.map((o, oi) =>
                                    oi === optionIndex ? { ...o, name: event.target.value } : o,
                                  ),
                                }
                              : item,
                          ),
                        );
                      }}
                      placeholder="جبنة إضافية"
                      aria-label={`اسم الإضافة ${optionIndex + 1}`}
                    />
                  </div>
                  <div className="w-24">
                    <Input
                      value={option.price_delta}
                      onChange={(event) => {
                        setDirty(true);
                        setGroupDrafts((list) =>
                          list.map((item, i) =>
                            i === groupIndex
                              ? {
                                  ...item,
                                  options: item.options.map((o, oi) =>
                                    oi === optionIndex ? { ...o, price_delta: event.target.value } : o,
                                  ),
                                }
                              : item,
                          ),
                        );
                      }}
                      type="number"
                      step="0.01"
                      dir="ltr"
                      className="text-start"
                      placeholder="+0"
                      aria-label={`سعر الإضافة ${optionIndex + 1}`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDirty(true);
                      setGroupDrafts((list) =>
                        list.map((item, i) =>
                          i === groupIndex
                            ? { ...item, options: item.options.filter((_, oi) => oi !== optionIndex) }
                            : item,
                        ),
                      );
                    }}
                    aria-label={`حذف الإضافة ${optionIndex + 1}`}
                    className="mb-0.5 grid size-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ))}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDirty(true);
                  setGroupDrafts((list) =>
                    list.map((item, i) =>
                      i === groupIndex
                        ? {
                            ...item,
                            options: [
                              ...item.options,
                              { key: newKey(), name: '', price_delta: '', is_available: true },
                            ],
                          }
                        : item,
                    ),
                  );
                }}
              >
                <Plus className="size-4" aria-hidden />
                إضافة خيار
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDirty(true);
              setGroupDrafts((list) => [
                ...list,
                { key: newKey(), name: '', min_select: '0', max_select: '1', options: [] },
              ]);
            }}
          >
            <Plus className="size-4" aria-hidden />
            إضافة مجموعة
          </Button>
        </section>

        <Divider />

        <div className="space-y-3">
          <Switch
            name="is_available"
            checked={available}
            onChange={(value) => { setAvailable(value); setDirty(true); }}
            label="متوفر الآن"
            description="عطّله عند نفاد الصنف دون حذفه."
          />
          <Switch
            name="is_visible"
            checked={visible}
            onChange={(value) => { setVisible(value); setDirty(true); }}
            label="ظاهر في المنيو"
            description="أخفِه تماماً عن الزبائن."
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button type="submit" loading={busy} loadingText="جارٍ الحفظ…">
            {product ? 'حفظ التعديلات' : 'إضافة الصنف'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
