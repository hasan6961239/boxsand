-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠١٢ — تسجيل العمليات الإدارية
--
--  سجل العمليات لا يقبل الكتابة المباشرة (لا صلاحية insert لأحد)، وإلا أمكن
--  تزوير سطر أو حذف أثر. الكتابة تمر بهذه الدالة وحدها، وهي تثبّت هوية
--  الفاعل من الجلسة ولا تقبلها من المستدعي.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.log_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   text default null,
  p_restaurant_id uuid default null,
  p_meta        jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, restaurant_id, meta)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_restaurant_id, coalesce(p_meta, '{}'::jsonb));
end $$;

revoke all on function public.log_audit(text, text, text, uuid, jsonb) from public;
grant execute on function public.log_audit(text, text, text, uuid, jsonb) to authenticated, service_role;

/**
 * إحصاءات المنصة للوحة الأدمن في استدعاء واحد.
 * SECURITY DEFINER مع فحص صريح للصلاحية داخلها.
 */
create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'غير مصرّح' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'restaurants_total',   (select count(*) from public.restaurants),
    'restaurants_active',  (select count(*) from public.restaurants where status in ('trial', 'active')),
    'restaurants_blocked', (select count(*) from public.restaurants where status in ('suspended', 'disabled')),
    'users_total',         (select count(*) from public.profiles),
    'products_total',      (select count(*) from public.products),
    'complaints_total',    (select count(*) from public.complaints),
    'complaints_new',      (select count(*) from public.complaints where status = 'new'),
    'views_today',         (select coalesce(sum(views), 0) from public.analytics_daily where day = current_date),
    'views_month',         (select coalesce(sum(views), 0) from public.analytics_daily where day >= current_date - 29),
    'signups_month',       (select count(*) from public.restaurants where created_at >= now() - interval '30 days')
  );
end $$;

revoke all on function public.admin_overview() from public;
grant execute on function public.admin_overview() to authenticated;

/** قائمة المطاعم للوحة الأدمن مع عدّادات — يتعذّر جمعها بكفاءة من الواجهة. */
create or replace function public.admin_restaurants()
returns table (
  id uuid, name text, slug text, short_id text, status public.restaurant_status,
  phone text, created_at timestamptz,
  owner_name text, owner_id uuid,
  product_count bigint, category_count bigint, complaint_count bigint, views_30d bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'غير مصرّح' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    r.id, r.name, r.slug, r.short_id, r.status, r.phone, r.created_at,
    p.full_name, r.owner_id,
    (select count(*) from public.products   x where x.restaurant_id = r.id),
    (select count(*) from public.categories x where x.restaurant_id = r.id),
    (select count(*) from public.complaints x where x.restaurant_id = r.id),
    (select coalesce(sum(a.views), 0) from public.analytics_daily a
       where a.restaurant_id = r.id and a.day >= current_date - 29)
  from public.restaurants r
  join public.profiles p on p.id = r.owner_id
  order by r.created_at desc;
end $$;

revoke all on function public.admin_restaurants() from public;
grant execute on function public.admin_restaurants() to authenticated;
