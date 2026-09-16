'use client';

import { useActionState, useEffect, useState } from 'react';
import { FolderTree, Pencil, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea, Switch } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { EmptyState, PageHeader, Badge } from '@/components/ui/primitives';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm';
import { SortableList } from '@/components/dashboard/sortable-list';
import { useToast } from '@/components/ui/toast';
import {
  saveCategoryAction, deleteCategoryAction, reorderAction, toggleCategoryAction,
  type ActionState,
} from '../actions';
import type { Category } from '@/types/database';

interface Props {
  restaurantId: string;
  categories: Category[];
  productCounts: Record<string, number>;
  maxCategories: number | null;
  planName: string;
}

export function CategoriesClient({ restaurantId, categories, productCounts, maxCategories, planName }: Props) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const { confirmProps, ask } = useConfirm();

  const atLimit = maxCategories !== null && categories.length >= maxCategories;

  function openNew() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(category: Category) {
    setEditing(category);
    setOpen(true);
  }

  async function handleReorder(orderedIds: string[]) {
    const result = await reorderAction(restaurantId, 'categories', orderedIds);
    if (result.error) toast.error(result.error);
  }

  async function handleToggle(category: Category) {
    const result = await toggleCategoryAction(restaurantId, category.id, !category.is_visible);
    if (result.error) toast.error(result.error);
    else toast.success(category.is_visible ? 'أُخفي القسم من المنيو.' : 'ظهر القسم في المنيو.');
  }

  return (
    <>
      <PageHeader
        title="الأقسام"
        description="رتّب أقسام منيوك بالسحب، وأخفِ ما لا تريد عرضه الآن."
        action={
          <Button onClick={openNew} disabled={atLimit}>
            <Plus className="size-4" aria-hidden />
            قسم جديد
          </Button>
        }
      />

      {atLimit && (
        <p className="mb-4 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
          بلغت الحد الأقصى لعدد الأقسام في خطة «{planName}» ({maxCategories}). رقِّ خطتك لإضافة المزيد.
        </p>
      )}

      {categories.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon={<FolderTree className="size-6" aria-hidden />}
            title="لم تتم إضافة أقسام بعد"
            description="القسم هو مجموعة أصناف متشابهة مثل «البرجر» أو «المشروبات». أنشئ أول قسم لتبدأ."
            action={
              <Button onClick={openNew}>
                <Plus className="size-4" aria-hidden />
                إضافة قسم
              </Button>
            }
          />
        </div>
      ) : (
        <SortableList
          items={categories}
          onReorder={handleReorder}
          renderItem={(category) => (
            <div className="flex flex-wrap items-center gap-3 px-3 py-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-lg">
                {category.icon || '🍽️'}
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-text">
                  <span className="truncate">{category.name}</span>
                  {!category.is_visible && <Badge size="sm" className="bg-surface-3 text-subtle">مخفي</Badge>}
                </p>
                <p className="nums text-xs text-muted">{productCounts[category.id] ?? 0} صنف</p>
              </div>

              <div className="flex shrink-0 gap-1">
                <IconButton
                  label={category.is_visible ? 'إخفاء القسم' : 'إظهار القسم'}
                  onClick={() => void handleToggle(category)}
                >
                  {category.is_visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </IconButton>
                <IconButton label="تعديل" onClick={() => openEdit(category)}>
                  <Pencil className="size-4" />
                </IconButton>
                <IconButton
                  label="حذف"
                  danger
                  onClick={() =>
                    ask({
                      title: 'حذف القسم؟',
                      message: `سيُحذف «${category.name}» و${productCounts[category.id] ?? 0} صنفاً بداخله نهائياً. لا يمكن التراجع.`,
                      confirmLabel: 'حذف القسم',
                      onConfirm: async () => {
                        const result = await deleteCategoryAction(restaurantId, category.id);
                        if (result.error) toast.error(result.error);
                        else toast.success('تم حذف القسم.');
                      },
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </div>
          )}
        />
      )}

      <CategoryModal
        key={editing?.id ?? 'new'}
        open={open}
        onClose={() => setOpen(false)}
        restaurantId={restaurantId}
        category={editing}
      />
      <ConfirmDialog {...confirmProps} />
    </>
  );
}

function IconButton({
  label, onClick, children, danger,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        'grid size-9 place-items-center rounded-lg text-muted transition-colors ' +
        (danger ? 'hover:bg-danger-soft hover:text-danger' : 'hover:bg-surface-2 hover:text-text')
      }
    >
      {children}
    </button>
  );
}

const EMOJIS = ['🍽️', '🥗', '🍔', '🍕', '🍟', '🌮', '🍢', '🍗', '🥘', '🍝', '🍚', '🥙', '🍰', '🍮', '☕', '🥤', '🧃', '🍹'];

function CategoryModal({
  open, onClose, restaurantId, category,
}: {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  category: Category | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveCategoryAction, {});
  const [icon, setIcon] = useState(category?.icon ?? '🍽️');
  const [visible, setVisible] = useState(category?.is_visible ?? true);
  const toast = useToast();

  useEffect(() => {
    if (state.ok) {
      toast.success(category ? 'تم تحديث القسم.' : 'تمت إضافة القسم.');
      onClose();
    } else if (state.error) {
      toast.error(state.error);
    }
    // نتفاعل مع نتيجة الإجراء فقط
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="sheet"
      title={category ? 'تعديل القسم' : 'قسم جديد'}
      description="الأقسام تظهر للزبون كتبويبات في أعلى المنيو."
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="restaurant_id" value={restaurantId} />
        {category && <input type="hidden" name="id" value={category.id} />}
        <input type="hidden" name="icon" value={icon} />

        <Field label="اسم القسم" error={state.fields?.name} required>
          {(id, invalid) => (
            <Input
              id={id}
              name="name"
              defaultValue={category?.name}
              placeholder="البرجر"
              aria-invalid={invalid}
              data-autofocus
              required
            />
          )}
        </Field>

        <div className="space-y-1.5">
          <p className="text-[0.8125rem] font-medium text-text">أيقونة القسم</p>
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setIcon(emoji)}
                aria-label={`اختيار الأيقونة ${emoji}`}
                aria-pressed={icon === emoji}
                className={
                  'grid size-10 place-items-center rounded-xl border text-lg transition-colors ' +
                  (icon === emoji
                    ? 'border-primary bg-primary-soft'
                    : 'border-border hover:bg-surface-2')
                }
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <Field label="وصف مختصر" hint="اختياري — يظهر تحت اسم القسم.">
          {(id) => (
            <Textarea id={id} name="description" rows={2} defaultValue={category?.description ?? ''} />
          )}
        </Field>

        <Switch
          name="is_visible"
          checked={visible}
          onChange={setVisible}
          label="ظاهر في المنيو"
          description="أخفِه مؤقتاً دون حذف أصنافه."
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={pending} loadingText="جارٍ الحفظ…">
            {category ? 'حفظ التعديلات' : 'إضافة القسم'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
