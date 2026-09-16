import type { Metadata } from 'next';
import { Store, Users, UtensilsCrossed, MessageSquare, Eye, TrendingUp, ShieldAlert } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import { StatCard } from '@/components/dashboard/stat-card';
import { Card, CardTitle, CardDescription, PageHeader } from '@/components/ui/primitives';
import { ButtonLink } from '@/components/ui/button';
import { formatRelative } from '@/lib/dates';

export const metadata: Metadata = { title: 'إدارة المنصة' };

interface Overview {
  restaurants_total: number;
  restaurants_active: number;
  restaurants_blocked: number;
  users_total: number;
  products_total: number;
  complaints_total: number;
  complaints_new: number;
  views_today: number;
  views_month: number;
  signups_month: number;
}

export default async function AdminOverview() {
  const supabase = await createServerSupabase();

  const [{ data: overview }, { data: recent }] = await Promise.all([
    supabase.rpc('admin_overview'),
    supabase
      .from('restaurants')
      .select('id, name, slug, status, created_at')
      .order('created_at', { ascending: false })
      .limit(6)
      .returns<{ id: string; name: string; slug: string; status: string; created_at: string }[]>(),
  ]);

  const stats = (overview ?? {}) as Partial<Overview>;

  return (
    <>
      <PageHeader title="نظرة عامة" description="حالة المنصة كاملة في لمحة." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="المطاعم"
          value={stats.restaurants_total ?? 0}
          hint={`${stats.restaurants_active ?? 0} نشط · ${stats.restaurants_blocked ?? 0} متوقف`}
          icon={<Store className="size-5" aria-hidden />}
          tone="primary"
        />
        <StatCard
          label="مطاعم جديدة"
          value={stats.signups_month ?? 0}
          hint="خلال ٣٠ يوماً"
          icon={<TrendingUp className="size-5" aria-hidden />}
          tone="accent"
        />
        <StatCard label="المستخدمون" value={stats.users_total ?? 0} icon={<Users className="size-5" aria-hidden />} />
        <StatCard label="الأصناف" value={stats.products_total ?? 0} icon={<UtensilsCrossed className="size-5" aria-hidden />} />
        <StatCard
          label="مشاهدات اليوم"
          value={stats.views_today ?? 0}
          hint={`${stats.views_month ?? 0} هذا الشهر`}
          icon={<Eye className="size-5" aria-hidden />}
          tone="primary"
        />
        <StatCard
          label="شكاوى جديدة"
          value={stats.complaints_new ?? 0}
          hint={`${stats.complaints_total ?? 0} إجمالاً`}
          icon={<MessageSquare className="size-5" aria-hidden />}
          tone={(stats.complaints_new ?? 0) > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="مطاعم متوقفة"
          value={stats.restaurants_blocked ?? 0}
          icon={<ShieldAlert className="size-5" aria-hidden />}
          tone={(stats.restaurants_blocked ?? 0) > 0 ? 'danger' : 'default'}
        />
      </div>

      <Card className="mt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>أحدث المطاعم</CardTitle>
            <CardDescription>آخر من انضم إلى المنصة.</CardDescription>
          </div>
          <ButtonLink href="/admin/restaurants" variant="outline" size="sm">كل المطاعم</ButtonLink>
        </div>

        <ul className="mt-4 divide-y divide-border">
          {(recent ?? []).map((restaurant) => (
            <li key={restaurant.id} className="flex items-center gap-3 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-sm font-bold text-muted">
                {restaurant.name.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">{restaurant.name}</p>
                <p className="ltr-nums truncate text-xs text-subtle">/menu/{restaurant.slug}</p>
              </div>
              <span className="shrink-0 text-xs text-subtle">{formatRelative(restaurant.created_at)}</span>
            </li>
          ))}
          {(recent ?? []).length === 0 && (
            <li className="py-6 text-center text-sm text-muted">لا توجد مطاعم بعد.</li>
          )}
        </ul>
      </Card>
    </>
  );
}
