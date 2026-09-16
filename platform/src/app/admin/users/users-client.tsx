'use client';

import { useMemo, useState } from 'react';
import { Search, Users, Shield, Ban, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { EmptyState, PageHeader, Badge } from '@/components/ui/primitives';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/dates';
import { setUserBlockedAction } from '../actions';
import type { Profile } from '@/types/database';

export interface AdminUserRow extends Profile {
  restaurants: string[];
}

export function AdminUsersClient({ rows }: { rows: AdminUserRow[] }) {
  const [query, setQuery] = useState('');
  const toast = useToast();
  const { confirmProps, ask } = useConfirm();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.full_name.toLowerCase().includes(needle) ||
        (row.phone ?? '').includes(needle) ||
        row.restaurants.some((name) => name.toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  return (
    <>
      <PageHeader title="المستخدمون" description={`${rows.length} مستخدماً على المنصة.`} />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث بالاسم أو الهاتف أو اسم المطعم…"
          className="ps-10"
          aria-label="بحث في المستخدمين"
          type="search"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="surface-card">
          <EmptyState
            icon={rows.length === 0 ? <Users className="size-6" aria-hidden /> : <Search className="size-6" aria-hidden />}
            title={rows.length === 0 ? 'لا يوجد مستخدمون بعد' : 'لا نتائج'}
            description={rows.length === 0 ? 'سيظهر هنا كل من ينشئ حساباً.' : 'جرّب كلمة بحث أخرى.'}
          />
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((row) => (
            <li key={row.id} className="surface-card flex flex-wrap items-center gap-3 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-sm font-bold text-muted">
                {row.full_name.charAt(0)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-text">{row.full_name}</span>
                  {row.role === 'super_admin' && (
                    <Badge size="sm" className="bg-accent-soft text-accent">
                      <Shield className="size-3" aria-hidden />
                      مدير منصة
                    </Badge>
                  )}
                  {row.is_blocked && <Badge size="sm" className="bg-danger-soft text-danger">محظور</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {row.phone && <span className="ltr-nums">{row.phone}</span>}
                  {row.phone && row.restaurants.length > 0 && ' · '}
                  {row.restaurants.join('، ') || 'بلا مطعم'}
                  {' · '}
                  {formatDate(row.created_at)}
                </p>
              </div>

              {row.role !== 'super_admin' && (
                <Button
                  variant={row.is_blocked ? 'outline' : 'ghost'}
                  size="sm"
                  className={row.is_blocked ? '' : 'text-danger hover:bg-danger-soft'}
                  onClick={() =>
                    ask({
                      title: row.is_blocked ? 'رفع الحظر؟' : 'حظر المستخدم؟',
                      message: row.is_blocked
                        ? `سيستطيع «${row.full_name}» الدخول إلى لوحته من جديد.`
                        : `لن يستطيع «${row.full_name}» الدخول، ويبقى منيو مطعمه ظاهراً للزبائن ما لم تعطّله أنت.`,
                      confirmLabel: row.is_blocked ? 'رفع الحظر' : 'حظر',
                      onConfirm: async () => {
                        const result = await setUserBlockedAction(row.id, !row.is_blocked);
                        if (result.error) toast.error(result.error);
                        else toast.success(row.is_blocked ? 'رُفع الحظر.' : 'حُظر المستخدم.');
                      },
                    })
                  }
                >
                  {row.is_blocked ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Ban className="size-3.5" aria-hidden />}
                  {row.is_blocked ? 'رفع الحظر' : 'حظر'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog {...confirmProps} />
    </>
  );
}
