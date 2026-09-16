-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠٠٥ — الإحصائيات (محترمة للخصوصية)
--
--  لا نخزّن عنوان IP ولا نضع كوكيز تتبع. الزائر يُمثَّل بتجزئة يومية غير قابلة
--  للعكس (IP + user-agent + ملح سري + تاريخ اليوم)، وتفقد معناها عند منتصف الليل.
--  ولا نحفظ صفاً لكل زيارة، بل نُجمّع يومياً حتى لا تنتفخ القاعدة بعد سنة.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.analytics_daily (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day           date not null,
  views         integer not null default 0,
  visitors      integer not null default 0,
  primary key (restaurant_id, day)
);

create index if not exists analytics_daily_day_idx on public.analytics_daily (day desc);

-- تجزئات اليوم الجاري فقط — تُحذف تلقائياً بعد يومين (انظر prune_analytics).
create table if not exists public.analytics_visitors (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day           date not null,
  visitor_hash  text not null,
  primary key (restaurant_id, day, visitor_hash)
);

create table if not exists public.product_views_daily (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  day           date not null,
  views         integer not null default 0,
  primary key (product_id, day)
);

create index if not exists product_views_rid_idx on public.product_views_daily (restaurant_id, day desc);

-- تسجيل زيارة منيو. تُستدعى من الخادم فقط (بمفتاح الخدمة) بعد حساب التجزئة.
create or replace function public.record_menu_view(
  p_restaurant_id uuid,
  p_visitor_hash  text,
  p_day           date default current_date
) returns void language plpgsql security definer set search_path = public as $$
declare
  is_new_visitor boolean := false;
begin
  insert into public.analytics_visitors (restaurant_id, day, visitor_hash)
  values (p_restaurant_id, p_day, p_visitor_hash)
  on conflict do nothing;
  is_new_visitor := found;

  insert into public.analytics_daily (restaurant_id, day, views, visitors)
  values (p_restaurant_id, p_day, 1, case when is_new_visitor then 1 else 0 end)
  on conflict (restaurant_id, day) do update
    set views    = public.analytics_daily.views + 1,
        visitors = public.analytics_daily.visitors + case when is_new_visitor then 1 else 0 end;
end $$;

create or replace function public.record_product_view(
  p_restaurant_id uuid,
  p_product_id    uuid,
  p_day           date default current_date
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.product_views_daily (restaurant_id, product_id, day, views)
  values (p_restaurant_id, p_product_id, p_day, 1)
  on conflict (product_id, day) do update
    set views = public.product_views_daily.views + 1;
end $$;

-- تنظيف التجزئات المنتهية. تُستدعى عند كل تسجيل زيارة بشكل عرضي، أو بمهمة مجدولة.
create or replace function public.prune_analytics()
returns void language sql security definer set search_path = public as $$
  delete from public.analytics_visitors where day < current_date - 2;
$$;
