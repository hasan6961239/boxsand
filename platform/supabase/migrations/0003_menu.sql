-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠٠٣ — المنيو: الأقسام، الأصناف، الأحجام، الإضافات، العروض
-- ════════════════════════════════════════════════════════════════════════════

-- ── الأقسام ────────────────────────────────────────────────────────────────
create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  parent_id     uuid references public.categories (id) on delete cascade,  -- مهيّأ للأقسام الفرعية
  name          text not null check (length(btrim(name)) between 1 and 60),
  description   text check (length(description) <= 300),
  icon          text check (length(icon) <= 40),
  position      integer not null default 0,
  is_visible    boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

create index if not exists categories_menu_idx on public.categories (restaurant_id, position, created_at);

drop trigger if exists categories_touch on public.categories;
create trigger categories_touch before update on public.categories
  for each row execute function public.touch_updated_at();

-- ── الأصناف ────────────────────────────────────────────────────────────────
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id   uuid not null references public.categories (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 80),
  description   text check (length(description) <= 500),
  image_url     text,

  -- السعر المعروض. عند وجود أحجام يُزامَن تلقائياً مع أرخص حجم (انظر المشغّل أدناه).
  base_price      numeric(10,2) not null check (base_price >= 0 and base_price < 1000000),
  -- السعر قبل الخصم — يظهر مشطوباً. يجب أن يكون أعلى من السعر الحالي.
  compare_at_price numeric(10,2) check (compare_at_price > base_price and compare_at_price < 1000000),

  badges        public.product_badge[] not null default '{}'
                  check (array_length(badges, 1) is null or array_length(badges, 1) <= 2),

  is_available  boolean not null default true,   -- نفد اليوم
  is_visible    boolean not null default true,   -- مخفي عن المنيو تماماً
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists products_menu_idx    on public.products (restaurant_id, category_id, position, created_at);
create index if not exists products_visible_idx on public.products (restaurant_id) where is_visible;
-- البحث النصي: يغطي الاسم والوصف بالعربية والإنجليزية
create index if not exists products_search_idx  on public.products using gin (
  to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, ''))
);

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- منع ربط الصنف بقسم يخص مطعماً آخر — ثغرة عزل محتملة لو اعتمدنا على الواجهة فقط.
create or replace function public.assert_category_same_restaurant()
returns trigger language plpgsql as $$
declare
  cat_rid uuid;
begin
  select restaurant_id into cat_rid from public.categories where id = new.category_id;
  if cat_rid is null or cat_rid <> new.restaurant_id then
    raise exception 'القسم لا يتبع هذا المطعم' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists products_assert_category on public.products;
create trigger products_assert_category before insert or update of category_id, restaurant_id on public.products
  for each row execute function public.assert_category_same_restaurant();

-- ── الأحجام / الخيارات السعرية ─────────────────────────────────────────────
create table if not exists public.product_variants (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,  -- مُكرَّر عمداً من أجل RLS
  name          text not null check (length(btrim(name)) between 1 and 40),
  price         numeric(10,2) not null check (price >= 0 and price < 1000000),
  is_available  boolean not null default true,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (product_id, name)
);

create index if not exists product_variants_pid_idx on public.product_variants (product_id, position);

-- يبقي base_price مساوياً لأرخص حجم، فيبقى الفرز والتصفية بالسعر صحيحاً دائماً.
create or replace function public.sync_product_base_price()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid := coalesce(new.product_id, old.product_id);
  min_price numeric(10,2);
begin
  select min(price) into min_price from public.product_variants where product_id = pid;
  if min_price is not null then
    update public.products set base_price = min_price where id = pid and base_price <> min_price;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists product_variants_sync_price on public.product_variants;
create trigger product_variants_sync_price after insert or update or delete on public.product_variants
  for each row execute function public.sync_product_base_price();

-- ── الإضافات ───────────────────────────────────────────────────────────────
create table if not exists public.option_groups (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 60),
  min_select    smallint not null default 0 check (min_select >= 0 and min_select <= 20),
  max_select    smallint not null default 1 check (max_select >= 1 and max_select <= 20),
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  check (min_select <= max_select)
);

create index if not exists option_groups_pid_idx on public.option_groups (product_id, position);

create table if not exists public.options (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.option_groups (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 60),
  price_delta   numeric(10,2) not null default 0 check (price_delta > -1000000 and price_delta < 1000000),
  is_available  boolean not null default true,
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists options_group_idx on public.options (group_id, position);

-- ── العروض ─────────────────────────────────────────────────────────────────
create table if not exists public.offers (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  title         text not null check (length(btrim(title)) between 2 and 80),
  description   text check (length(description) <= 300),
  image_url     text,
  badge_text    text check (length(badge_text) <= 20),
  starts_at     timestamptz,
  ends_at       timestamptz,
  is_active     boolean not null default true,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index if not exists offers_rid_idx on public.offers (restaurant_id, position);

drop trigger if exists offers_touch on public.offers;
create trigger offers_touch before update on public.offers
  for each row execute function public.touch_updated_at();
