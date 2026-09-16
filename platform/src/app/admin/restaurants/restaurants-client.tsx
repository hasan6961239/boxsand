'use client';

import { useMemo, useState } from 'react';
import { Search, Store, ExternalLink, Ban, CheckCircle2, Trash2, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { EmptyState, PageHeader, Badge } from '@/components/ui/primitives';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { RESTAURANT_STATUSES, siteUrl } from '@/lib/config';
import { formatDate } from '@/lib/dates';
import { setRestaurantStatusAction, deleteRestaurantAction } from '../actions';
import type { RestaurantStatus } from '@/types/database';

export interface AdminRestaurantRow {
  id: string;
  name: string;
  slug: string;
  short_id: string;
  status: RestaurantStatus;
  phone: string | null;
  created_at: string;
  owner_name: string;
  owner_id: string;
  product_count: number;
  category_count: number;
  complaint_count: number;
  views_30d: number;
}

export function AdminRestaurantsClient({ rows }: { rows: AdminRestaurantRow[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [statusTarget, setStatusTarget] = useState<AdminRestaurantRow | null>(null);
  const toast = useToast();
  const { confirmProps, ask } = useConfirm();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      if (!needle) return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        row.slug.toLowerCase().includes(needle) ||
        row.owner_name.toLowerCase().includes(needle) ||
        (row.phone ?? '').includes(needle)
      );
    });
  }, [rows, query, status]);

  async function quickStatus(row: AdminRestaurantRow, next: RestaurantStatus) {
    const result = await setRestaurantStatusAction(row.id, next);
    if (result.error) toast.error(result.error);
    else toast.success('تم تحديث حالة المطعم.');
  }

  return (
    <>
      <PageHeader
        title="المطاعم"
        description={`${rows.length} مطعم على المنصة.`}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث باسم المطعم أو المالك أو الرابط أو الهاتف…"
            className="ps-10"
            aria-label="بحث في المطاعم"
            type="search"
          />
        </div>
        <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="تصفية حسب الحالة" className="sm:w-40">
          <option value="all">كل الحالات</option>
          {Object.entries(RESTAURANT_STATUSES).map(([key, value]) => (
            <option key={key} value={key}>{value.label}</option>
          ))}
        </Select>
      </div>

      {rows.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon={<Store className="size-6" aria-hidden />}
            title="لا توجد مطاعم بعد"
            description="حين يسجّل أول صاحب مطعم سيظهر هنا."
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon={<Search className="size-6" aria-hidden />}
            title="لا نتائج"
            description="غيّر كلمات البحث أو الحالة."
            action={<Button variant="outline" onClick={() => { setQuery(''); setStatus('all'); }}>إعادة التعيين</Button>}
          />
        </div>
      ) : (
        <>
          {/* جدول على الشاشات الكبيرة، بطاقات على الهاتف: جدول بثمانية أعمدة
              لا يُقرأ على ٣٩٠ بكسل مهما فعلنا به */}
          <div className="hidden overflow-x-auto rounded-xl border border-border lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">قائمة المطاعم على المنصة</caption>
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  {['المطعم', 'المالك', 'الحالة', 'الأصناف', 'المشاهدات', 'الشكاوى', 'التاريخ', ''].map((label, index) => (
                    <th key={index} scope="col" className="px-3 py-2.5 text-start font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-2/50">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-text">{row.name}</p>
                      <p className="ltr-nums text-xs text-subtle">/menu/{row.slug}</p>
                    </td>
                    <td className="px-3 py-2.5 text-muted">
                      <p>{row.owner_name}</p>
                      {row.phone && <p className="ltr-nums text-xs text-subtle">{row.phone}</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge size="sm" className={RESTAURANT_STATUSES[row.status]?.className}>
                        {RESTAURANT_STATUSES[row.status]?.label ?? row.status}
                      </Badge>
                    </td>
                    <td className="nums px-3 py-2.5 text-muted">{row.product_count}</td>
                    <td className="nums px-3 py-2.5 text-muted">{row.views_30d}</td>
                    <td className="nums px-3 py-2.5 text-muted">{row.complaint_count}</td>
                    <td className="px-3 py-2.5 text-xs text-subtle">{formatDate(row.created_at)}</td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        row={row}
                        onStatus={() => setStatusTarget(row)}
                        onQuick={quickStatus}
                        onDelete={() =>
                          ask({
                            title: 'حذف المطعم نهائياً؟',
                            message: `سيُحذف «${row.name}» مع كل أقسامه وأصنافه وشكاواه. لا يمكن التراجع. الأفضل تعطيله بدل حذفه.`,
                            confirmLabel: 'حذف نهائي',
                            onConfirm: async () => {
                              const result = await deleteRestaurantAction(row.id);
                              if (result.error) toast.error(result.error);
                              else toast.success('تم حذف المطعم.');
                            },
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 lg:hidden">
            {filtered.map((row) => (
              <li key={row.id} className="surface-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-text">{row.name}</p>
                    <p className="ltr-nums truncate text-xs text-subtle">/menu/{row.slug}</p>
                  </div>
                  <Badge size="sm" className={RESTAURANT_STATUSES[row.status]?.className}>
                    {RESTAURANT_STATUSES[row.status]?.label ?? row.status}
                  </Badge>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    ['الأصناف', row.product_count],
                    ['المشاهدات', row.views_30d],
                    ['الشكاوى', row.complaint_count],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg bg-surface-2 py-2">
                      <dt className="text-[0.6875rem] text-muted">{label}</dt>
                      <dd className="nums text-sm font-bold text-text">{value}</dd>
                    </div>
                  ))}
                </dl>

                <p className="mt-2 text-xs text-muted">
                  {row.owner_name} · {formatDate(row.created_at)}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <RowActions
                    row={row}
                    onStatus={() => setStatusTarget(row)}
                    onQuick={quickStatus}
                    onDelete={() =>
                      ask({
                        title: 'حذف المطعم نهائياً؟',
                        message: `سيُحذف «${row.name}» مع كل بياناته. لا يمكن التراجع.`,
                        confirmLabel: 'حذف نهائي',
                        onConfirm: async () => {
                          const result = await deleteRestaurantAction(row.id);
                          if (result.error) toast.error(result.error);
                          else toast.success('تم حذف المطعم.');
                        },
                      })
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <StatusModal
        key={statusTarget?.id ?? 'none'}
        row={statusTarget}
        onClose={() => setStatusTarget(null)}
      />
      <ConfirmDialog {...confirmProps} />
    </>
  );
}

function RowActions({
  row, onStatus, onQuick, onDelete,
}: {
  row: AdminRestaurantRow;
  onStatus: () => void;
  onQuick: (row: AdminRestaurantRow, status: RestaurantStatus) => void;
  onDelete: () => void;
}) {
  const live = row.status === 'trial' || row.status === 'active';

  return (
    <div className="flex flex-wrap items-center gap-1">
      <a
        href={`${siteUrl()}/menu/${row.slug}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`فتح منيو ${row.name}`}
        title="فتح المنيو"
        className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
      >
        <ExternalLink className="size-4" aria-hidden />
      </a>

      {live ? (
        <button
          type="button"
          onClick={() => onQuick(row, 'suspended')}
          aria-label={`إيقاف ${row.name}`}
          title="إيقاف مؤقت"
          className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-warning-soft hover:text-warning"
        >
          <Pause className="size-4" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onQuick(row, 'active')}
          aria-label={`تفعيل ${row.name}`}
          title="تفعيل"
          className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-success-soft hover:text-success"
        >
          <CheckCircle2 className="size-4" aria-hidden />
        </button>
      )}

      <button
        type="button"
        onClick={onStatus}
        aria-label={`تغيير حالة ${row.name}`}
        title="تغيير الحالة مع ملاحظة"
        className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
      >
        <Ban className="size-4" aria-hidden />
      </button>

      <button
        type="button"
        onClick={onDelete}
        aria-label={`حذف ${row.name}`}
        title="حذف نهائي"
        className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function StatusModal({ row, onClose }: { row: AdminRestaurantRow | null; onClose: () => void }) {
  const [status, setStatus] = useState<RestaurantStatus>(row?.status ?? 'active');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save() {
    if (!row) return;
    setBusy(true);
    const result = await setRestaurantStatusAction(row.id, status, note);
    setBusy(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('تم تحديث حالة المطعم.');
      onClose();
    }
  }

  return (
    <Modal
      open={Boolean(row)}
      onClose={onClose}
      title={row ? `حالة ${row.name}` : ''}
      description="الملاحظة تظهر لصاحب المطعم في لوحته."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>إلغاء</Button>
          <Button onClick={save} loading={busy} loadingText="جارٍ الحفظ…">حفظ</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="status-select" className="mb-1.5 block text-[0.8125rem] font-medium text-text">
            الحالة
          </label>
          <Select
            id="status-select"
            value={status}
            onChange={(event) => setStatus(event.target.value as RestaurantStatus)}
            data-autofocus
          >
            {Object.entries(RESTAURANT_STATUSES).map(([key, value]) => (
              <option key={key} value={key}>{value.label}</option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="status-note" className="mb-1.5 block text-[0.8125rem] font-medium text-text">
            ملاحظة لصاحب المطعم
          </label>
          <Textarea
            id="status-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={300}
            placeholder="مثلاً: انتهى الاشتراك، يرجى التجديد للمتابعة."
          />
        </div>

        <p className="rounded-xl bg-info-soft px-4 py-3 text-xs leading-relaxed text-info">
          «موقوف» و«معطّل» يُخفيان المنيو عن الزبائن فوراً. «تجريبي» و«نشط» يُبقيانه ظاهراً.
        </p>
      </div>
    </Modal>
  );
}
