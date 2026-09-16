'use client';

import { useActionState, useEffect, useState } from 'react';
import Image from 'next/image';
import { Tag, Plus, Pencil, Trash2, ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea, Switch } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { EmptyState, PageHeader, Badge } from '@/components/ui/primitives';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm';
import { ImageUploader } from '@/components/dashboard/image-uploader';
import { useToast } from '@/components/ui/toast';
import { saveOfferAction, deleteOfferAction, type ActionState } from '../actions';
import type { Offer } from '@/types/database';

export function OffersClient({ restaurantId, offers }: { restaurantId: string; offers: Offer[] }) {
  const [editing, setEditing] = useState<Offer | null>(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const { confirmProps, ask } = useConfirm();

  return (
    <>
      <PageHeader
        title="العروض"
        description="تظهر كشريط في أعلى المنيو قبل الأقسام."
        action={
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="size-4" aria-hidden />
            عرض جديد
          </Button>
        }
      />

      {offers.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon={<Tag className="size-6" aria-hidden />}
            title="لا توجد عروض حالياً"
            description="أضف عرضاً مثل «وجبة العائلة» أو «خصم الغداء» ليراه الزبون أول ما يفتح المنيو."
            action={
              <Button onClick={() => { setEditing(null); setOpen(true); }}>
                <Plus className="size-4" aria-hidden />
                إضافة عرض
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {offers.map((offer) => (
            <li key={offer.id} className="surface-card overflow-hidden p-0">
              <div className="relative aspect-[16/7] bg-surface-2">
                {offer.image_url ? (
                  <Image
                    src={offer.image_url}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 100vw, 400px"
                    className="object-cover"
                    unoptimized={offer.image_url.startsWith('/')}
                  />
                ) : (
                  <span className="grid h-full place-items-center text-subtle">
                    <ImageOff className="size-6" aria-hidden />
                  </span>
                )}
                {offer.badge_text && (
                  <span className="absolute end-3 top-3 rounded-full bg-danger px-2.5 py-1 text-xs font-bold text-white shadow-sm">
                    {offer.badge_text}
                  </span>
                )}
              </div>

              <div className="p-4">
                <p className="flex items-center gap-2 font-bold text-text">
                  <span className="truncate">{offer.title}</span>
                  {!offer.is_active && <Badge size="sm" className="bg-surface-3 text-subtle">متوقف</Badge>}
                </p>
                {offer.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{offer.description}</p>
                )}

                <div className="mt-3 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setEditing(offer); setOpen(true); }}>
                    <Pencil className="size-3.5" aria-hidden />
                    تعديل
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger-soft"
                    onClick={() =>
                      ask({
                        title: 'حذف العرض؟',
                        message: `سيُحذف «${offer.title}» نهائياً.`,
                        confirmLabel: 'حذف',
                        onConfirm: async () => {
                          const result = await deleteOfferAction(restaurantId, offer.id);
                          if (result.error) toast.error(result.error);
                          else toast.success('تم حذف العرض.');
                        },
                      })
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    حذف
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <OfferModal
        key={editing?.id ?? 'new'}
        open={open}
        onClose={() => setOpen(false)}
        restaurantId={restaurantId}
        offer={editing}
      />
      <ConfirmDialog {...confirmProps} />
    </>
  );
}

function OfferModal({
  open, onClose, restaurantId, offer,
}: {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  offer: Offer | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveOfferAction, {});
  const [imageUrl, setImageUrl] = useState(offer?.image_url ?? null);
  const [active, setActive] = useState(offer?.is_active ?? true);
  const toast = useToast();

  useEffect(() => {
    if (state.ok) {
      toast.success(offer ? 'تم تحديث العرض.' : 'تمت إضافة العرض.');
      onClose();
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Modal open={open} onClose={onClose} variant="sheet" title={offer ? 'تعديل العرض' : 'عرض جديد'}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="restaurant_id" value={restaurantId} />
        {offer && <input type="hidden" name="id" value={offer.id} />}
        <input type="hidden" name="image_url" value={imageUrl ?? ''} />

        <Field label="عنوان العرض" error={state.fields?.title} required>
          {(id, invalid) => (
            <Input id={id} name="title" defaultValue={offer?.title} placeholder="عرض العائلة" aria-invalid={invalid} data-autofocus required />
          )}
        </Field>

        <Field label="تفاصيل العرض">
          {(id) => (
            <Textarea id={id} name="description" rows={3} defaultValue={offer?.description ?? ''}
              placeholder="مشاوي مشكّلة + ٤ مشروبات + حلوى بسعر ١٢٠ د.ل بدل ١٦٠." />
          )}
        </Field>

        <Field label="نص الشارة" hint="كلمة قصيرة تظهر على الصورة، مثل «وفّر ٢٥٪».">
          {(id) => <Input id={id} name="badge_text" defaultValue={offer?.badge_text ?? ''} maxLength={20} />}
        </Field>

        <ImageUploader
          restaurantId={restaurantId}
          kind="offer"
          value={imageUrl}
          onChange={setImageUrl}
          label="صورة العرض"
          aspect="wide"
        />

        <Switch name="is_active" checked={active} onChange={setActive}
          label="العرض فعّال" description="أوقفه بدل حذفه إن كان موسمياً." />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={pending} loadingText="جارٍ الحفظ…">
            {offer ? 'حفظ التعديلات' : 'إضافة العرض'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
