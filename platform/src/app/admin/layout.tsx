import { requireAdmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { DashboardShell, type NavItem } from '@/components/dashboard/shell';
import { getPlatformSettings } from '@/lib/platform';

// بيانات المنصة كلها هنا — لا تُخزَّن مؤقتاً أبداً.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  const settings = await getPlatformSettings();

  const supabase = await createServerSupabase();
  const { count: newComplaints } = await supabase
    .from('complaints')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new');

  const items: NavItem[] = [
    { href: '/admin', label: 'نظرة عامة', icon: 'overview' },
    { href: '/admin/restaurants', label: 'المطاعم', icon: 'store' },
    { href: '/admin/users', label: 'المستخدمون', icon: 'settings' },
    { href: '/admin/complaints', label: 'الشكاوى', icon: 'complaints', badge: newComplaints ?? 0 },
    { href: '/admin/plans', label: 'الخطط', icon: 'offers' },
    { href: '/admin/settings', label: 'إعدادات المنصة', icon: 'settings' },
    { href: '/dashboard', label: 'لوحة مطعمي', icon: 'store' },
  ];

  return (
    <DashboardShell
      items={items}
      title={`إدارة ${settings.platform_name}`}
      subtitle={session.profile.full_name}
      isAdmin
    >
      {children}
    </DashboardShell>
  );
}
