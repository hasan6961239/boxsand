-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠٠٨ — العزل بين المطاعم (Row Level Security)
--
--  هذا الملف هو قلب أمان المنصة. العزل مفروض هنا، داخل قاعدة البيانات، لا في
--  الواجهة. حتى لو تسرّب مفتاح anon كاملاً، لا يستطيع أحد قراءة بيانات مطعم
--  لا يملكه ولا الكتابة فيه.
-- ════════════════════════════════════════════════════════════════════════════

-- ── الدوال المساعدة ─────────────────────────────────────────────────────────
-- SECURITY DEFINER مقصود: الدالة تقرأ جداول عليها RLS، ولولا ذلك لوقعنا في
-- تكرار لا نهائي (سياسة تستدعي دالة تقرأ الجدول الذي تحميه السياسة نفسها).

-- هل الاتصال بصلاحية النظام (مفتاح الخدمة أو اتصال مباشر)؟ هذه الاتصالات تنفّذ
-- عمليات إدارية مشروعة، فلا تسري عليها حراسة الصلاحيات أدناه.
create or replace function public.is_privileged_connection()
returns boolean language sql stable as $$
  select current_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin');
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin' and not is_blocked
  );
$$;

create or replace function public.is_member_of(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.restaurant_members m
    join public.profiles p on p.id = m.user_id
    where m.restaurant_id = rid and m.user_id = auth.uid() and not p.is_blocked
  );
$$;

create or replace function public.can_manage(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (
    select 1
    from public.restaurant_members m
    join public.profiles p on p.id = m.user_id
    where m.restaurant_id = rid
      and m.user_id = auth.uid()
      and m.role in ('owner', 'manager')
      and not p.is_blocked
  );
$$;

-- هل المطعم منشور للعامة؟ المعطّل والموقوف لا يظهر منيوه إطلاقاً.
create or replace function public.restaurant_is_public(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.restaurants
    where id = rid and status in ('trial', 'active')
  );
$$;

create or replace function public.category_is_public(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.categories c
    where c.id = cid and c.is_visible and public.restaurant_is_public(c.restaurant_id)
  );
$$;

create or replace function public.product_is_public(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.products p
    where p.id = pid and p.is_visible and public.category_is_public(p.category_id)
  );
$$;

-- ── نقطة البداية: لا شيء مسموح ─────────────────────────────────────────────
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;

-- ── تفعيل RLS على كل جدول ──────────────────────────────────────────────────
alter table public.profiles            enable row level security;
alter table public.restaurants         enable row level security;
alter table public.restaurant_slugs    enable row level security;
alter table public.restaurant_members  enable row level security;
alter table public.restaurant_themes   enable row level security;
alter table public.opening_hours       enable row level security;
alter table public.categories          enable row level security;
alter table public.products            enable row level security;
alter table public.product_variants    enable row level security;
alter table public.option_groups       enable row level security;
alter table public.options             enable row level security;
alter table public.offers              enable row level security;
alter table public.complaints          enable row level security;
alter table public.analytics_daily     enable row level security;
alter table public.analytics_visitors  enable row level security;
alter table public.product_views_daily enable row level security;
alter table public.plans               enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.platform_settings   enable row level security;
alter table public.audit_logs          enable row level security;

-- ════════════════ profiles ════════════════
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_super_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_super_admin())
  with check (id = auth.uid() or public.is_super_admin());

-- ترقية الدور أو الحظر لا يتمان إلا من مفتاح الخدمة (سكربت خادمي أو لوحة الأدمن).
create or replace function public.guard_profile_privileges()
returns trigger language plpgsql as $$
begin
  if public.is_privileged_connection() then
    return new;
  end if;
  if (new.role is distinct from old.role or new.is_blocked is distinct from old.is_blocked)
     and not public.is_super_admin() then
    raise exception 'غير مصرّح بتغيير الصلاحيات' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ════════════════ restaurants ════════════════
grant select, insert, update on public.restaurants to authenticated;

drop policy if exists restaurants_select on public.restaurants;
create policy restaurants_select on public.restaurants for select to authenticated
  using (public.is_member_of(id) or public.is_super_admin());

drop policy if exists restaurants_insert on public.restaurants;
create policy restaurants_insert on public.restaurants for insert to authenticated
  with check (owner_id = auth.uid() or public.is_super_admin());

drop policy if exists restaurants_update on public.restaurants;
create policy restaurants_update on public.restaurants for update to authenticated
  using (public.can_manage(id))
  with check (public.can_manage(id));

-- الحالة والمالك ملك للمنصة لا للمطعم: لا يرفع صاحب مطعم نفسه من trial إلى active.
create or replace function public.guard_restaurant_privileges()
returns trigger language plpgsql as $$
begin
  if public.is_privileged_connection() then
    return new;
  end if;
  if (new.status is distinct from old.status or new.owner_id is distinct from old.owner_id)
     and not public.is_super_admin() then
    raise exception 'غير مصرّح بتغيير حالة المطعم' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists restaurants_guard on public.restaurants;
create trigger restaurants_guard before update on public.restaurants
  for each row execute function public.guard_restaurant_privileges();

-- ════════════════ restaurant_slugs ════════════════
grant select on public.restaurant_slugs to authenticated;

drop policy if exists restaurant_slugs_select on public.restaurant_slugs;
create policy restaurant_slugs_select on public.restaurant_slugs for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

-- ════════════════ restaurant_members ════════════════
grant select, insert, update, delete on public.restaurant_members to authenticated;

drop policy if exists members_select on public.restaurant_members;
create policy members_select on public.restaurant_members for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

drop policy if exists members_write on public.restaurant_members;
create policy members_write on public.restaurant_members for all to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));

-- ════════════════ الجداول التابعة للمطعم ════════════════
-- نمط موحّد: الأعضاء يقرأون ويكتبون بيانات مطعمهم، والعامة تقرأ المنشور فقط.

-- ملاحظة مهمة على نمط السياسات أدناه:
-- سياسات «_public» موجَّهة إلى anon وحده، لا إلى authenticated. السبب أن
-- السياسات المتعددة تُجمَع بـ OR: لو شملت السياسة العامة المستخدمَ المسجَّل،
-- لرأى صاحب مطعم أصنافَ كل المطاعم المنشورة في أي استعلام ينسى تقييده
-- بمعرّف مطعمه. صفحة المنيو العامة لا تحتاج ذلك أصلاً: تُخدَم عبر الدالة
-- get_public_menu التي تعمل للزائر والمسجَّل على حد سواء.

-- restaurant_themes
grant select, insert, update on public.restaurant_themes to authenticated;
grant select on public.restaurant_themes to anon;

drop policy if exists themes_public on public.restaurant_themes;
create policy themes_public on public.restaurant_themes for select to anon
  using (public.restaurant_is_public(restaurant_id));

drop policy if exists themes_member on public.restaurant_themes;
create policy themes_member on public.restaurant_themes for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

drop policy if exists themes_write on public.restaurant_themes;
create policy themes_write on public.restaurant_themes for all to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));

-- opening_hours
grant select, insert, update, delete on public.opening_hours to authenticated;
grant select on public.opening_hours to anon;

drop policy if exists hours_public on public.opening_hours;
create policy hours_public on public.opening_hours for select to anon
  using (public.restaurant_is_public(restaurant_id));

drop policy if exists hours_member on public.opening_hours;
create policy hours_member on public.opening_hours for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

drop policy if exists hours_write on public.opening_hours;
create policy hours_write on public.opening_hours for all to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));

-- categories
grant select, insert, update, delete on public.categories to authenticated;
grant select on public.categories to anon;

drop policy if exists categories_public on public.categories;
create policy categories_public on public.categories for select to anon
  using (is_visible and public.restaurant_is_public(restaurant_id));

drop policy if exists categories_member on public.categories;
create policy categories_member on public.categories for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories for all to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));

-- products
grant select, insert, update, delete on public.products to authenticated;
grant select on public.products to anon;

drop policy if exists products_public on public.products;
create policy products_public on public.products for select to anon
  using (is_visible and public.category_is_public(category_id));

drop policy if exists products_member on public.products;
create policy products_member on public.products for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

drop policy if exists products_write on public.products;
create policy products_write on public.products for all to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));

-- product_variants
grant select, insert, update, delete on public.product_variants to authenticated;
grant select on public.product_variants to anon;

drop policy if exists variants_public on public.product_variants;
create policy variants_public on public.product_variants for select to anon
  using (public.product_is_public(product_id));

drop policy if exists variants_member on public.product_variants;
create policy variants_member on public.product_variants for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

drop policy if exists variants_write on public.product_variants;
create policy variants_write on public.product_variants for all to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));

-- option_groups
grant select, insert, update, delete on public.option_groups to authenticated;
grant select on public.option_groups to anon;

drop policy if exists option_groups_public on public.option_groups;
create policy option_groups_public on public.option_groups for select to anon
  using (public.product_is_public(product_id));

drop policy if exists option_groups_member on public.option_groups;
create policy option_groups_member on public.option_groups for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

drop policy if exists option_groups_write on public.option_groups;
create policy option_groups_write on public.option_groups for all to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));

-- options
grant select, insert, update, delete on public.options to authenticated;
grant select on public.options to anon;

drop policy if exists options_public on public.options;
create policy options_public on public.options for select to anon
  using (exists (
    select 1 from public.option_groups g
    where g.id = options.group_id and public.product_is_public(g.product_id)
  ));

drop policy if exists options_member on public.options;
create policy options_member on public.options for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

drop policy if exists options_write on public.options;
create policy options_write on public.options for all to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));

-- offers
grant select, insert, update, delete on public.offers to authenticated;
grant select on public.offers to anon;

drop policy if exists offers_public on public.offers;
create policy offers_public on public.offers for select to anon
  using (
    is_active
    and public.restaurant_is_public(restaurant_id)
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >  now())
  );

drop policy if exists offers_member on public.offers;
create policy offers_member on public.offers for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

drop policy if exists offers_write on public.offers;
create policy offers_write on public.offers for all to authenticated
  using (public.can_manage(restaurant_id))
  with check (public.can_manage(restaurant_id));

-- ════════════════ complaints ════════════════
-- الإرسال العام لا يمر من هنا إطلاقاً: لا يملك anon أي صلاحية على هذا الجدول.
-- النموذج العام يرسل إلى مسار خادمي يتحقق من المدخلات ويحدّ من معدل الإرسال ثم
-- يكتب بمفتاح الخدمة. سياسة RLS لا تستطيع تنفيذ تحديد المعدل، ولو فتحنا الإدراج
-- لـ anon لأمكن إغراق أي مطعم بآلاف الرسائل عبر REST API مباشرة.
grant select, update on public.complaints to authenticated;

drop policy if exists complaints_select on public.complaints;
create policy complaints_select on public.complaints for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

drop policy if exists complaints_update on public.complaints;
create policy complaints_update on public.complaints for update to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin())
  with check (public.is_member_of(restaurant_id) or public.is_super_admin());

-- ════════════════ الإحصائيات ════════════════
-- القراءة للأعضاء فقط؛ الكتابة عبر دوال SECURITY DEFINER من الخادم حصراً.
grant select on public.analytics_daily, public.product_views_daily to authenticated;

drop policy if exists analytics_daily_select on public.analytics_daily;
create policy analytics_daily_select on public.analytics_daily for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

drop policy if exists product_views_select on public.product_views_daily;
create policy product_views_select on public.product_views_daily for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

-- analytics_visitors لا يُقرأ من أحد إطلاقاً: لا صلاحيات ولا سياسات.

-- ════════════════ plans ════════════════
grant select on public.plans to anon, authenticated;

drop policy if exists plans_public on public.plans;
create policy plans_public on public.plans for select to anon, authenticated
  using (is_public or public.is_super_admin());

-- ════════════════ subscriptions ════════════════
grant select on public.subscriptions to authenticated;

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.is_member_of(restaurant_id) or public.is_super_admin());

-- ════════════════ platform_settings ════════════════
grant select on public.platform_settings to anon, authenticated;
grant update on public.platform_settings to authenticated;

drop policy if exists platform_settings_select on public.platform_settings;
create policy platform_settings_select on public.platform_settings for select to anon, authenticated
  using (true);

drop policy if exists platform_settings_update on public.platform_settings;
create policy platform_settings_update on public.platform_settings for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ════════════════ audit_logs ════════════════
grant select on public.audit_logs to authenticated;

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_super_admin());

-- ════════════════ الدوال الحساسة ════════════════
-- الدوال في PostgreSQL مسموحة لـ PUBLIC افتراضياً. لولا هذا السحب لاستطاع أي
-- زائر استدعاء record_menu_view آلاف المرات وتزوير إحصائيات أي مطعم.
revoke all on function public.record_menu_view(uuid, text, date)     from public;
revoke all on function public.record_product_view(uuid, uuid, date)  from public;
revoke all on function public.prune_analytics()                      from public;
revoke all on function public.handle_new_user()                      from public;
revoke all on function public.guard_profile_privileges()             from public;
revoke all on function public.guard_restaurant_privileges()          from public;

grant execute on function public.record_menu_view(uuid, text, date)    to service_role;
grant execute on function public.record_product_view(uuid, uuid, date) to service_role;
grant execute on function public.prune_analytics()                     to service_role;
