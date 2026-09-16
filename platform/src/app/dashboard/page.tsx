import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Eye, UtensilsCrossed, FolderTree, MessageSquare, Plus, QrCode,
  Store, ArrowLeft, TriangleAlert,
} from 'lucide-react';
import { requireSession, getCurrentRestaurant } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { StatCard } from '@/components/dashboard/stat-card';
import { Card, CardTitle, CardDescription, PageHeader, Badge } from '@/components/ui/primitives';
import { ButtonLink } from '@/components/ui/button';
import { siteUrl, RESTAURANT_STATUSES } from '@/lib/config';
import { CopyLink } from '@/components/dashboard/copy-link';

export const metadata: Metadata = { title: 'نظرة عامة' };

function startOfDayUtc(daysAgo: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

export default async function DashboardOverview() {
  await requireSession('/dashboard');
  const restaurant = await getCurrentRestaurant();
  if (!restaurant) redirect('/dashboard/setup');

  const supabase = await createServerSupabase();
  const today = startOfDayUtc(0);

  const [categories, products, complaints, unread, views] = await Promise.all([
    supabase.from('categories').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurant.id),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurant.id),
    supabase.from('complaints').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurant.id),
    supabase.from('complaints').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurant.id).eq('is_read', false),
    supabase
      .from('analytics_daily')
      .select('day, views, visitors')
      .eq('restaurant_id', restaurant.id)
      .gte('day', startOfDayUtc(29))
      .returns<{ day: string; views: number; visitors: number }[]>(),
  ]);

  const daily = views.data ?? [];
  const viewsToday = daily.find((row) => row.day === today)?.views ?? 0;
  const viewsWeek = daily.filter((row) => row.day >= startOfDayUtc(6)).reduce((sum, row) => sum + row.views, 0);
  const viewsMonth = daily.reduce((sum, row) => sum + row.views, 0);

  const menuUrl = `${siteUrl()}/menu/${restaurant.slug}`;
  const status = RESTAURANT_STATUSES[restaurant.status];
  const productCount = products.count ?? 0;
  const categoryCount = categories.count ?? 0;
  const isEmpty = productCount === 0;

  return (
    <>
      <PageHeader
        title={`أهلاً، ${restaurant.name}`}
        description="ملخّص سريع لحالة منيوك اليوم."
        action={
          status && (
            <Badge className={status.className}>{status.label}</Badge>
          )
        }
      />

      {restaurant.status === 'suspended' || restaurant.status === 'disabled' ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3.5">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold text-danger">منيوك غير ظاهر للزبائن حالياً</p>
            <p className="mt-0.5 text-danger/85">
              {restaurant.status_note || 'تواصل مع إدارة المنصة لإعادة التفعيل.'}
            </p>
          </div>
        </div>
      ) : null}

      {isEmpty && (
        <Card className="mb-6 border-primary/25 bg-primary-soft/40">
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-fg">
              <Plus className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle>ابدأ بإضافة أول صنف</CardTitle>
              <CardDescription>
                منيوك فارغ الآن. أضف قسماً مثل «البرجر» ثم أول صنف فيه، وسيكون المنيو جاهزاً للمشاركة.
              </CardDescription>
            </div>
            <ButtonLink href={categoryCount === 0 ? '/dashboard/categories' : '/dashboard/products'}>
              {categoryCount === 0 ? 'أضف قسماً' : 'أضف صنفاً'}
              <ArrowLeft className="size-4" aria-hidden />
            </ButtonLink>
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="مشاهدات اليوم"
          value={viewsToday}
          hint={`${viewsWeek} هذا الأسبوع · ${viewsMonth} هذا الشهر`}
          icon={<Eye className="size-5" aria-hidden />}
          tone="primary"
        />
        <StatCard label="الأصناف" value={productCount} icon={<UtensilsCrossed className="size-5" aria-hidden />} />
        <StatCard label="الأقسام" value={categoryCount} icon={<FolderTree className="size-5" aria-hidden />} />
        <StatCard
          label="شكاوى غير مقروءة"
          value={unread.count ?? 0}
          hint={`${complaints.count ?? 0} رسالة إجمالاً`}
          icon={<MessageSquare className="size-5" aria-hidden />}
          tone={(unread.count ?? 0) > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>رابط المنيو</CardTitle>
          <CardDescription>شاركه مع زبائنك، أو اطبع رمز QR الذي يفتحه.</CardDescription>
          <CopyLink url={menuUrl} className="mt-4" />
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href="/dashboard/qr" variant="outline" size="sm">
              <QrCode className="size-4" aria-hidden />
              رمز QR
            </ButtonLink>
            <a
              href={menuUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center rounded-lg border border-border px-3.5 text-[0.8125rem] font-medium text-text transition-colors hover:bg-surface-2"
            >
              افتح المنيو
            </a>
          </div>
        </Card>

        <Card>
          <CardTitle>إجراءات سريعة</CardTitle>
          <CardDescription>أكثر ما تحتاجه يومياً.</CardDescription>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              { href: '/dashboard/products', label: 'إضافة صنف', icon: Plus },
              { href: '/dashboard/categories', label: 'إدارة الأقسام', icon: FolderTree },
              { href: '/dashboard/restaurant', label: 'معلومات المطعم', icon: Store },
              { href: '/dashboard/complaints', label: 'الشكاوى', icon: MessageSquare },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 rounded-xl border border-border px-3.5 py-3 text-sm font-medium text-text transition-colors hover:border-primary/40 hover:bg-surface-2"
              >
                <item.icon className="size-4 shrink-0 text-primary" aria-hidden />
                {item.label}
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
