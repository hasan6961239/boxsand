import type { Metadata } from 'next';
import { createServerSupabase } from '@/lib/supabase/server';
import { PageHeader, Badge, EmptyState } from '@/components/ui/primitives';
import { COMPLAINT_STATUSES, COMPLAINT_TYPES } from '@/lib/config';
import { formatDateTime } from '@/lib/dates';
import { MessageSquare, Star } from 'lucide-react';
import type { Complaint } from '@/types/database';

export const metadata: Metadata = { title: 'الشكاوى' };

interface Row extends Complaint {
  restaurants: { name: string; slug: string } | null;
}

export default async function AdminComplaintsPage() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('complaints')
    .select('*, restaurants(name, slug)')
    .order('created_at', { ascending: false })
    .limit(300)
    .returns<Row[]>();

  const rows = data ?? [];

  return (
    <>
      <PageHeader
        title="الشكاوى على مستوى المنصة"
        description="آخر ٣٠٠ رسالة من كل المطاعم. إدارة الحالة تتم من لوحة كل مطعم."
      />

      {rows.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon={<MessageSquare className="size-6" aria-hidden />}
            title="لا توجد شكاوى"
            description="لم يرسل أي زبون رسالة بعد."
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const statusStyle = COMPLAINT_STATUSES[row.status];
            return (
              <li key={row.id} className="surface-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text">{row.restaurants?.name ?? 'مطعم محذوف'}</span>
                  <span className="nums rounded-lg bg-surface-2 px-2 py-0.5 text-xs text-muted">#{row.ref_number}</span>
                  <Badge size="sm">{COMPLAINT_TYPES[row.type]}</Badge>
                  {statusStyle && <Badge size="sm" className={statusStyle.className}>{statusStyle.label}</Badge>}
                  {row.rating !== null && (
                    <span className="flex items-center gap-0.5" aria-label={`التقييم ${row.rating} من ٥`}>
                      {Array.from({ length: 5 }, (_, index) => (
                        <Star
                          key={index}
                          className={index < row.rating! ? 'size-3.5 fill-accent text-accent' : 'size-3.5 text-border-strong'}
                          aria-hidden
                        />
                      ))}
                    </span>
                  )}
                  <time className="ms-auto text-xs text-subtle" dateTime={row.created_at}>
                    {formatDateTime(row.created_at)}
                  </time>
                </div>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text">{row.message}</p>
                {(row.customer_name || row.customer_phone) && (
                  <p className="mt-2 text-xs text-muted">
                    {row.customer_name}
                    {row.customer_name && row.customer_phone && ' · '}
                    {row.customer_phone && <span className="ltr-nums">{row.customer_phone}</span>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
