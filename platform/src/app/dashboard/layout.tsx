import { requireSession, getCurrentRestaurant } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { DashboardShell, type NavItem } from '@/components/dashboard/shell';
import { siteUrl } from '@/lib/config';

/*
 * لوحة التحكم تُصيَّر عند كل طلب.
 *
 * بدون هذا السطر قد يُصيّرها Next مسبقاً حين تكون متغيّرات Supabase غائبة وقت
 * البناء (فلا يُستدعى cookies فلا يُعتبر المسار ديناميكياً)، فتُخدَّم صفحة
 * مخزَّنة لكل المستخدمين. هذا خطأ عزل، لا مجرد خطأ عرض.
 */
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession('/dashboard');
  const restaurant = await getCurrentRestaurant();

  // قبل إنشاء المطعم لا معنى للقائمة الجانبية — معالج الإعداد يملأ الشاشة.
  if (!restaurant) {
    return (
      <div className="min-h-dvh">
        <main id="main">{children}</main>
      </div>
    );
  }

  const supabase = await createServerSupabase();
  const { count: unread } = await supabase
    .from('complaints')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurant.id)
    .eq('is_read', false);

  const items: NavItem[] = [
    { href: '/dashboard', label: 'نظرة عامة', icon: 'overview' },
    { href: '/dashboard/restaurant', label: 'معلومات المطعم', icon: 'store' },
    { href: '/dashboard/categories', label: 'الأقسام', icon: 'categories' },
    { href: '/dashboard/products', label: 'الأصناف', icon: 'products' },
    { href: '/dashboard/offers', label: 'العروض', icon: 'offers' },
    { href: '/dashboard/complaints', label: 'الشكاوى', icon: 'complaints', badge: unread ?? 0 },
    { href: '/dashboard/qr', label: 'رمز QR', icon: 'qr' },
    { href: '/dashboard/analytics', label: 'الإحصائيات', icon: 'analytics' },
  ];

  if (session.profile.role === 'super_admin') {
    items.push({ href: '/admin', label: 'إدارة المنصة', icon: 'admin' });
  }

  return (
    <DashboardShell
      items={items}
      title={restaurant.name}
      subtitle={session.profile.full_name}
      menuUrl={`${siteUrl()}/menu/${restaurant.slug}`}
    >
      {children}
    </DashboardShell>
  );
}
