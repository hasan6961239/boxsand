-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠٠٩ — واجهة المنيو العام
--
--  صفحة المنيو تُبنى من استدعاء واحد لهذه الدالة. فائدتان:
--   ١) الأداء: رحلة واحدة إلى قاعدة البيانات بدل سبع.
--   ٢) الأمان: الحقول المُرجَعة محدّدة بالاسم هنا، فلا يتسرّب owner_id ولا أي
--      حقل داخلي حتى لو أخطأنا لاحقاً في الواجهة.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.get_public_menu(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r        public.restaurants%rowtype;
  current  text;
  result   jsonb;
begin
  select * into r from public.restaurants where slug = p_slug;

  -- الرابط غير معروف: قد يكون رابطاً قديماً غُيّر — أعِد الرابط الحالي للتحويل.
  if not found then
    select rs.slug into current
    from public.restaurant_slugs old
    join public.restaurants rs on rs.id = old.restaurant_id
    where old.slug = p_slug
      and rs.status in ('trial', 'active');
    if current is not null then
      return jsonb_build_object('redirect_to', current);
    end if;
    return null;
  end if;

  if r.status not in ('trial', 'active') then
    return jsonb_build_object('unavailable', true, 'name', r.name);
  end if;

  select jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id, 'slug', r.slug, 'short_id', r.short_id, 'name', r.name,
      'tagline', r.tagline, 'description', r.description,
      'logo_url', r.logo_url, 'cover_url', r.cover_url,
      'phone', r.phone, 'whatsapp', r.whatsapp,
      'instagram', r.instagram, 'facebook', r.facebook, 'tiktok', r.tiktok,
      'maps_url', r.maps_url, 'address', r.address,
      'currency', r.currency, 'timezone', r.timezone,
      'show_unavailable', r.show_unavailable, 'show_prices', r.show_prices,
      'accept_complaints', r.accept_complaints
    ),

    'theme', (
      select jsonb_build_object(
        'preset', t.preset, 'primary_color', t.primary_color,
        'secondary_color', t.secondary_color, 'background_color', t.background_color,
        'text_color', t.text_color, 'card_color', t.card_color,
        'font_family', t.font_family, 'border_radius', t.border_radius,
        'button_style', t.button_style, 'default_dark', t.default_dark
      )
      from public.restaurant_themes t where t.restaurant_id = r.id
    ),

    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', h.weekday,
        'opens_at', to_char(h.opens_at, 'HH24:MI'),
        'closes_at', to_char(h.closes_at, 'HH24:MI')
      ) order by h.weekday, h.opens_at)
      from public.opening_hours h where h.restaurant_id = r.id
    ), '[]'::jsonb),

    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'title', o.title, 'description', o.description,
        'image_url', o.image_url, 'badge_text', o.badge_text
      ) order by o.position, o.created_at)
      from public.offers o
      where o.restaurant_id = r.id
        and o.is_active
        and (o.starts_at is null or o.starts_at <= now())
        and (o.ends_at   is null or o.ends_at   >  now())
    ), '[]'::jsonb),

    'categories', coalesce((
      select jsonb_agg(cat order by cat ->> 'position')
      from (
        select jsonb_build_object(
          'id', c.id, 'name', c.name, 'description', c.description, 'icon', c.icon,
          'position', lpad(c.position::text, 8, '0'),
          'products', coalesce((
            select jsonb_agg(prod order by prod ->> 'position')
            from (
              select jsonb_build_object(
                'id', p.id, 'name', p.name, 'description', p.description,
                'image_url', p.image_url,
                'price', p.base_price, 'compare_at_price', p.compare_at_price,
                'badges', p.badges, 'is_available', p.is_available,
                'position', lpad(p.position::text, 8, '0'),
                'variants', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', v.id, 'name', v.name, 'price', v.price, 'is_available', v.is_available
                  ) order by v.position, v.created_at)
                  from public.product_variants v where v.product_id = p.id
                ), '[]'::jsonb),
                'option_groups', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', g.id, 'name', g.name,
                    'min_select', g.min_select, 'max_select', g.max_select,
                    'options', coalesce((
                      select jsonb_agg(jsonb_build_object(
                        'id', op.id, 'name', op.name, 'price_delta', op.price_delta,
                        'is_available', op.is_available
                      ) order by op.position, op.created_at)
                      from public.options op where op.group_id = g.id
                    ), '[]'::jsonb)
                  ) order by g.position, g.created_at)
                  from public.option_groups g where g.product_id = p.id
                ), '[]'::jsonb)
              ) as prod
              from public.products p
              where p.category_id = c.id
                and p.is_visible
                and (r.show_unavailable or p.is_available)
              order by p.position, p.created_at
            ) prods
          ), '[]'::jsonb)
        ) as cat
        from public.categories c
        where c.restaurant_id = r.id and c.is_visible
        order by c.position, c.created_at
      ) cats
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

-- يحوّل المعرّف القصير الثابت (رابط QR) إلى الرابط الحالي للمطعم.
create or replace function public.resolve_short_id(p_short_id text)
returns text language sql stable security definer set search_path = public as $$
  select slug from public.restaurants
  where short_id = lower(p_short_id) and status in ('trial', 'active');
$$;

-- قائمة الروابط المنشورة — لبناء sitemap.xml.
create or replace function public.get_public_restaurant_slugs()
returns table (slug text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.slug, r.updated_at from public.restaurants r
  where r.status in ('trial', 'active')
  order by r.updated_at desc
  limit 5000;
$$;

revoke all on function public.get_public_menu(text)            from public;
revoke all on function public.resolve_short_id(text)           from public;
revoke all on function public.get_public_restaurant_slugs()    from public;

grant execute on function public.get_public_menu(text)         to anon, authenticated, service_role;
grant execute on function public.resolve_short_id(text)        to anon, authenticated, service_role;
grant execute on function public.get_public_restaurant_slugs() to anon, authenticated, service_role;
