-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠٠٢ — الحسابات والمطاعم
-- ════════════════════════════════════════════════════════════════════════════

-- ── الملفات الشخصية (امتداد لـ auth.users) ─────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text        not null check (length(btrim(full_name)) between 2 and 80),
  phone       text        check (phone ~ '^\+?[0-9 \-]{7,20}$'),
  role        public.account_role not null default 'owner',
  is_blocked  boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role) where role = 'super_admin';

-- ينشئ ملفاً شخصياً تلقائياً لكل مستخدم جديد، بالبيانات التي أرسلها عند التسجيل.
-- الدور دائماً 'owner' هنا: الترقية إلى super_admin لا تتم إلا من سكربت خادمي.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 'مستخدم جديد'),
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── المطاعم ────────────────────────────────────────────────────────────────
create table if not exists public.restaurants (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles (id) on delete restrict,

  -- الهوية العامة
  name          text not null check (length(btrim(name)) between 2 and 80),
  slug          text not null unique check (slug ~ '^[a-z0-9؀-ۿ]([a-z0-9؀-ۿ-]{1,58})[a-z0-9؀-ۿ]$'),
  short_id      text not null unique check (short_id ~ '^[a-z0-9]{5,12}$'),
  tagline       text check (length(tagline) <= 120),
  description   text check (length(description) <= 1000),
  logo_url      text,
  cover_url     text,

  -- التواصل
  phone         text check (phone ~ '^\+?[0-9 \-]{7,20}$'),
  whatsapp      text check (whatsapp ~ '^\+?[0-9 \-]{7,20}$'),
  instagram     text check (length(instagram) <= 100),
  facebook      text check (length(facebook) <= 200),
  tiktok        text check (length(tiktok) <= 100),
  maps_url      text check (maps_url is null or maps_url ~* '^https?://'),
  address       text check (length(address) <= 200),

  -- الإعدادات
  currency      text not null default 'LYD' check (currency ~ '^[A-Z]{3}$'),
  timezone      text not null default 'Africa/Tripoli',
  show_unavailable boolean not null default true,   -- يظهر الصنف غير المتوفر رمادياً بدل أن يختفي
  show_prices      boolean not null default true,
  accept_complaints boolean not null default true,

  -- الحالة
  status        public.restaurant_status not null default 'trial',
  status_note   text check (length(status_note) <= 300),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists restaurants_owner_idx  on public.restaurants (owner_id);
create index if not exists restaurants_status_idx on public.restaurants (status);
create index if not exists restaurants_created_idx on public.restaurants (created_at desc);

drop trigger if exists restaurants_touch on public.restaurants;
create trigger restaurants_touch before update on public.restaurants
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── تاريخ الروابط ──────────────────────────────────────────────────────────
-- كل slug قديم يبقى محفوظاً ويعيد التوجيه إلى الحالي، حتى لا ينكسر رابط مشارَك.
create table if not exists public.restaurant_slugs (
  slug          text primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  created_at    timestamptz not null default now()
);

create index if not exists restaurant_slugs_rid_idx on public.restaurant_slugs (restaurant_id);

-- يسجّل الرابط الجديد في التاريخ عند الإنشاء أو التغيير.
create or replace function public.track_restaurant_slug()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug then
    return new;
  end if;
  insert into public.restaurant_slugs (slug, restaurant_id)
  values (new.slug, new.id)
  on conflict (slug) do update set restaurant_id = excluded.restaurant_id;
  return new;
end $$;

drop trigger if exists restaurants_track_slug on public.restaurants;
create trigger restaurants_track_slug after insert or update of slug on public.restaurants
  for each row execute function public.track_restaurant_slug();

-- ── أعضاء المطعم ───────────────────────────────────────────────────────────
create table if not exists public.restaurant_members (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          public.member_role not null default 'staff',
  created_at    timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

create index if not exists restaurant_members_user_idx on public.restaurant_members (user_id);

-- مالك المطعم عضو فيه دائماً — العضوية هي مصدر الحقيقة الوحيد لسياسات RLS.
create or replace function public.sync_owner_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.restaurant_members (restaurant_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (restaurant_id, user_id) do update set role = 'owner';
  return new;
end $$;

drop trigger if exists restaurants_sync_owner on public.restaurants;
create trigger restaurants_sync_owner after insert or update of owner_id on public.restaurants
  for each row execute function public.sync_owner_membership();

-- ── الثيم ──────────────────────────────────────────────────────────────────
create table if not exists public.restaurant_themes (
  restaurant_id    uuid primary key references public.restaurants (id) on delete cascade,
  preset           public.theme_preset not null default 'elegant',
  primary_color    text not null default '#1F6F5C' check (primary_color ~* '^#[0-9a-f]{6}$'),
  secondary_color  text not null default '#C89A4A' check (secondary_color ~* '^#[0-9a-f]{6}$'),
  background_color text not null default '#FBF9F6' check (background_color ~* '^#[0-9a-f]{6}$'),
  text_color       text not null default '#1A1713' check (text_color ~* '^#[0-9a-f]{6}$'),
  card_color       text not null default '#FFFFFF' check (card_color ~* '^#[0-9a-f]{6}$'),
  font_family      text not null default 'tajawal' check (font_family in ('tajawal', 'cairo', 'system')),
  border_radius    smallint not null default 18 check (border_radius between 0 and 32),
  button_style     public.button_style not null default 'solid',
  default_dark     boolean not null default false,
  updated_at       timestamptz not null default now()
);

drop trigger if exists restaurant_themes_touch on public.restaurant_themes;
create trigger restaurant_themes_touch before update on public.restaurant_themes
  for each row execute function public.touch_updated_at();

-- ثيم افتراضي لكل مطعم جديد، حتى لا تكون صفحة المنيو بلا هوية أبداً.
create or replace function public.create_default_theme()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.restaurant_themes (restaurant_id) values (new.id)
  on conflict (restaurant_id) do nothing;
  return new;
end $$;

drop trigger if exists restaurants_default_theme on public.restaurants;
create trigger restaurants_default_theme after insert on public.restaurants
  for each row execute function public.create_default_theme();

-- ── أوقات العمل ────────────────────────────────────────────────────────────
-- صف لكل فترة: يسمح بفترتين في اليوم (صباحية ومسائية) أو أكثر.
create table if not exists public.opening_hours (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6),   -- 0 = الأحد
  opens_at      time not null,
  closes_at     time not null,
  created_at    timestamptz not null default now(),
  -- closes_at < opens_at تعني أن الفترة تمتد بعد منتصف الليل (٧م → ١ص)
  check (opens_at <> closes_at)
);

create index if not exists opening_hours_rid_idx on public.opening_hours (restaurant_id, weekday);
