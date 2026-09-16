'use client';

import { useMemo, useState } from 'react';
import { MessageSquare, Search, Star, Phone, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { EmptyState, PageHeader, Badge } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { COMPLAINT_STATUSES, COMPLAINT_TYPES } from '@/lib/config';
import { formatDateTime } from '@/lib/dates';
import { updateComplaintStatusAction, markComplaintsReadAction } from '../actions';
import type { Complaint, ComplaintStatus } from '@/types/database';
import { cn } from '@/lib/cn';

export function ComplaintsClient({
  restaurantId, complaints,
}: {
  restaurantId: string;
  complaints: Complaint[];
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const toast = useToast();

  const unread = complaints.filter((complaint) => !complaint.is_read).length;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return complaints.filter((complaint) => {
      if (status !== 'all' && complaint.status !== status) return false;
      if (type !== 'all' && complaint.type !== type) return false;
      if (!needle) return true;
      return (
        complaint.message.toLowerCase().includes(needle) ||
        (complaint.customer_name ?? '').toLowerCase().includes(needle) ||
        (complaint.customer_phone ?? '').includes(needle) ||
        String(complaint.ref_number) === needle
      );
    });
  }, [complaints, query, status, type]);

  async function changeStatus(complaint: Complaint, next: ComplaintStatus) {
    const result = await updateComplaintStatusAction(restaurantId, complaint.id, next);
    if (result.error) toast.error(result.error);
    else toast.success('تم تحديث حالة الرسالة.');
  }

  return (
    <>
      <PageHeader
        title="الشكاوى والاقتراحات"
        description="ما يرسله زبائنك من نهاية صفحة المنيو."
        action={
          unread > 0 ? (
            <Button
              variant="outline"
              onClick={async () => {
                const result = await markComplaintsReadAction(restaurantId);
                if (result.error) toast.error(result.error);
                else toast.success('عُلّمت كلها كمقروءة.');
              }}
            >
              <CheckCheck className="size-4" aria-hidden />
              تعليم الكل كمقروء
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث في الرسائل أو بالاسم أو رقم الشكوى…"
            className="ps-10"
            aria-label="بحث في الشكاوى"
            type="search"
          />
        </div>
        <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="تصفية حسب الحالة" className="sm:w-40">
          <option value="all">كل الحالات</option>
          {Object.entries(COMPLAINT_STATUSES).map(([key, value]) => (
            <option key={key} value={key}>{value.label}</option>
          ))}
        </Select>
        <Select value={type} onChange={(event) => setType(event.target.value)} aria-label="تصفية حسب النوع" className="sm:w-36">
          <option value="all">كل الأنواع</option>
          {Object.entries(COMPLAINT_TYPES).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </Select>
      </div>

      {complaints.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon={<MessageSquare className="size-6" aria-hidden />}
            title="لا توجد شكاوى حالياً"
            description="حين يرسل زبون شكوى أو اقتراحاً من صفحة المنيو، ستظهر هنا برقم وتاريخ وحالة تتابعها."
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon={<Search className="size-6" aria-hidden />}
            title="لا نتائج"
            description="غيّر كلمات البحث أو أعد ضبط التصفية."
            action={
              <Button variant="outline" onClick={() => { setQuery(''); setStatus('all'); setType('all'); }}>
                إعادة التعيين
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((complaint) => {
            const statusStyle = COMPLAINT_STATUSES[complaint.status];
            return (
              <li
                key={complaint.id}
                className={cn(
                  'surface-card p-4',
                  !complaint.is_read && 'border-primary/35 bg-primary-soft/25',
                )}
              >
                <div className="flex flex-wrap items-start gap-2">
                  <span className="nums rounded-lg bg-surface-2 px-2 py-0.5 text-xs font-bold text-muted">
                    #{complaint.ref_number}
                  </span>
                  <Badge size="sm">{COMPLAINT_TYPES[complaint.type]}</Badge>
                  {statusStyle && <Badge size="sm" className={statusStyle.className}>{statusStyle.label}</Badge>}
                  {!complaint.is_read && <Badge size="sm" className="bg-primary text-primary-fg">جديدة</Badge>}

                  {complaint.rating !== null && (
                    <span className="flex items-center gap-0.5" aria-label={`التقييم ${complaint.rating} من ٥`}>
                      {Array.from({ length: 5 }, (_, index) => (
                        <Star
                          key={index}
                          className={cn(
                            'size-3.5',
                            index < complaint.rating! ? 'fill-accent text-accent' : 'text-border-strong',
                          )}
                          aria-hidden
                        />
                      ))}
                    </span>
                  )}

                  <time
                    className="nums ms-auto text-xs text-subtle"
                    dateTime={complaint.created_at}
                  >
                    {formatDateTime(complaint.created_at)}
                  </time>
                </div>

                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-text">{complaint.message}</p>

                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
                  <span className="text-xs text-muted">
                    {complaint.customer_name || 'زائر لم يذكر اسمه'}
                  </span>
                  {complaint.customer_phone && (
                    <a
                      href={`tel:${complaint.customer_phone}`}
                      className="nums inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <Phone className="size-3.5" aria-hidden />
                      {complaint.customer_phone}
                    </a>
                  )}

                  <Select
                    value={complaint.status}
                    onChange={(event) => void changeStatus(complaint, event.target.value as ComplaintStatus)}
                    aria-label={`حالة الشكوى رقم ${complaint.ref_number}`}
                    className="ms-auto h-9 w-36 text-xs"
                  >
                    {Object.entries(COMPLAINT_STATUSES).map(([key, value]) => (
                      <option key={key} value={key}>{value.label}</option>
                    ))}
                  </Select>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
