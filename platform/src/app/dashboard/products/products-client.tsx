'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { UtensilsCrossed, Plus, Pencil, Trash2, Search, ImageOff, FolderTree } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Input, Select, Switch } from '@/components/ui/field';
import { EmptyState, PageHeader, Badge } from '@/components/ui/primitives';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm';
import { SortableList } from '@/components/dashboard/sortable-list';
import { useToast } from '@/components/ui/toast';
import { formatPrice } from '@/lib/money';
import { BADGE_LABELS } from '@/lib/config';
import { deleteProductAction, reorderAction, toggleProductAction } from '../actions';
import { ProductModal } from './product-modal';
import type { Category, OptionGroup, Product, ProductOption, ProductVariant } from '@/types/database';

export type ProductRow = Product;

interface Props {
  restaurantId: string;
  currency: string;
  categories: Category[];
  products: ProductRow[];
  variants: ProductVariant[];
  groups: OptionGroup[];
  options: ProductOption[];
  maxProducts: number | null;
  planName: string;
}

export function ProductsClient({
  restaurantId, currency, categories, products, variants, groups, options, maxProducts, planName,
}: Props) {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const { confirmProps, ask } = useConfirm();

  const atLimit = maxProducts !== null && products.length >= maxProducts;
  const categoryNames = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryFilter !== 'all' && product.category_id !== categoryFilter) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        (product.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [products, query, categoryFilter]);

  // الترتيب بالسحب يعمل داخل قسم واحد فقط — ترتيب قائمة مختلطة بلا معنى
  const sortable = categoryFilter !== 'all' && !query.trim();

  function openNew() {
    setEditing(null);
    setOpen(true);
  }

  async function handleReorder(orderedIds: string[]) {
    const result = await reorderAction(restaurantId, 'products', orderedIds);
    if (result.error) toast.error(result.error);
  }

  if (categories.length === 0) {
    return (
      <>
        <PageHeader title="الأصناف" description="أضف أصنافك وأسعارها وصورها." />
        <div className="surface-card">
          <EmptyState
            icon={<FolderTree className="size-6" aria-hidden />}
            title="أنشئ قسماً أولاً"
            description="كل صنف يتبع قسماً. أضف قسماً مثل «البرجر» ثم عد لإضافة الأصناف."
            action={<ButtonLink href="/dashboard/categories">إدارة الأقسام</ButtonLink>}
          />
        </div>
      </>
    );
  }

  const card = (product: ProductRow) => (
    <div className="flex flex-wrap items-center gap-3 px-3 py-3">
      <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-surface-2">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt=""
            fill
            sizes="56px"
            className="object-cover"
            unoptimized={product.image_url.startsWith('/')}
          />
        ) : (
          <span className="grid h-full place-items-center text-subtle">
            <ImageOff className="size-5" aria-hidden />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium text-text">{product.name}</span>
          {product.badges.map((badge) => (
            <Badge key={badge} size="sm" className={BADGE_LABELS[badge]?.className}>
              {BADGE_LABELS[badge]?.label ?? badge}
            </Badge>
          ))}
          {!product.is_visible && <Badge size="sm" className="bg-surface-3 text-subtle">مخفي</Badge>}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          <span className="nums font-semibold text-primary">{formatPrice(product.base_price, currency)}</span>
          {product.compare_at_price && (
            <span className="nums text-subtle line-through">
              {formatPrice(product.compare_at_price, currency)}
            </span>
          )}
          <span className="truncate">· {categoryNames[product.category_id] ?? '—'}</span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <div className="me-1 hidden sm:block">
          <Switch
            checked={product.is_available}
            onChange={async (value) => {
              const result = await toggleProductAction(restaurantId, product.id, 'is_available', value);
              if (result.error) toast.error(result.error);
              else toast.success(value ? 'الصنف متوفر الآن.' : 'عُلّم الصنف كغير متوفر.');
            }}
            label={product.is_available ? 'متوفر' : 'غير متوفر'}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            setEditing(product);
            setOpen(true);
          }}
          aria-label={`تعديل ${product.name}`}
          className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Pencil className="size-4" aria-hidden />
        </button>

        <button
          type="button"
          onClick={() =>
            ask({
              title: 'حذف الصنف؟',
              message: `سيُحذف «${product.name}» نهائياً بأحجامه وإضافاته. لا يمكن التراجع.`,
              confirmLabel: 'حذف الصنف',
              onConfirm: async () => {
                const result = await deleteProductAction(restaurantId, product.id);
                if (result.error) toast.error(result.error);
                else toast.success('تم حذف الصنف.');
              },
            })
          }
          aria-label={`حذف ${product.name}`}
          className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="الأصناف"
        description="أضف أصنافك وأسعارها، وبدّل التوفر بنقرة واحدة."
        action={
          <Button onClick={openNew} disabled={atLimit}>
            <Plus className="size-4" aria-hidden />
            صنف جديد
          </Button>
        }
      />

      {atLimit && (
        <p className="mb-4 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
          بلغت الحد الأقصى لعدد الأصناف في خطة «{planName}» ({maxProducts}). رقِّ خطتك لإضافة المزيد.
        </p>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث باسم الصنف أو وصفه…"
            className="ps-10"
            aria-label="بحث في الأصناف"
            type="search"
          />
        </div>
        <Select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          aria-label="تصفية حسب القسم"
          className="sm:w-52"
        >
          <option value="all">كل الأقسام</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </Select>
      </div>

      {products.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon={<UtensilsCrossed className="size-6" aria-hidden />}
            title="لم تتم إضافة أصناف بعد"
            description="أضف أول صنف باسمه وسعره وصورته، وسيظهر مباشرة في منيوك."
            action={
              <Button onClick={openNew}>
                <Plus className="size-4" aria-hidden />
                إضافة صنف
              </Button>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon={<Search className="size-6" aria-hidden />}
            title="لا نتائج"
            description="لم نجد أصنافاً تطابق بحثك. جرّب كلمة أخرى أو غيّر القسم."
            action={
              <Button variant="outline" onClick={() => { setQuery(''); setCategoryFilter('all'); }}>
                إعادة التعيين
              </Button>
            }
          />
        </div>
      ) : sortable ? (
        <>
          <p className="mb-2 text-xs text-subtle">اسحب المقبض لتغيير ترتيب ظهور الأصناف في المنيو.</p>
          <SortableList items={filtered} onReorder={handleReorder} renderItem={card} />
        </>
      ) : (
        <>
          <p className="mb-2 text-xs text-subtle">
            لتغيير الترتيب بالسحب، اختر قسماً واحداً من القائمة أعلاه.
          </p>
          <ul className="space-y-2">
            {filtered.map((product) => (
              <li key={product.id} className="surface-card overflow-hidden p-0">{card(product)}</li>
            ))}
          </ul>
        </>
      )}

      {/* التبديل السريع للتوفر مخفي على الهاتف داخل الصف؛ نوضّح مكانه */}
      <p className="mt-4 text-xs text-subtle sm:hidden">
        لتغيير حالة التوفر على الهاتف، افتح الصنف من زر التعديل.
      </p>

      <ProductModal
        key={editing?.id ?? 'new'}
        open={open}
        onClose={() => setOpen(false)}
        restaurantId={restaurantId}
        currency={currency}
        categories={categories}
        product={editing}
        defaultCategoryId={categoryFilter !== 'all' ? categoryFilter : categories[0]?.id}
        variants={editing ? variants.filter((v) => v.product_id === editing.id) : []}
        groups={
          editing
            ? groups
                .filter((g) => g.product_id === editing.id)
                .map((g) => ({
                  ...g,
                  options: options.filter((o) => o.group_id === g.id),
                }))
            : []
        }
      />
      <ConfirmDialog {...confirmProps} />
      <p className="sr-only">
        <Link href="/dashboard/categories">إدارة الأقسام</Link>
      </p>
    </>
  );
}
