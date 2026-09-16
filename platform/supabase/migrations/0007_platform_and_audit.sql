-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠٠٧ — إعدادات المنصة وسجل العمليات
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.platform_settings (
  id             boolean primary key default true check (id),   -- صف واحد فقط، دائماً
  platform_name  text not null default 'سُفرة',
  tagline        text not null default 'منيو مطعمك الرقمي، في دقائق',
  logo_url       text,
  primary_color  text not null default '#1F6F5C' check (primary_color ~* '^#[0-9a-f]{6}$'),
  contact_email  text check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone  text check (contact_phone ~ '^\+?[0-9 \-]{7,20}$'),
  whatsapp       text check (whatsapp ~ '^\+?[0-9 \-]{7,20}$'),
  social         jsonb not null default '{}'::jsonb,
  seo_title       text,
  seo_description text check (length(seo_description) <= 200),
  allow_signup    boolean not null default true,     -- أغلق التسجيل الذاتي إن كنت تبيع يدوياً
  updated_at      timestamptz not null default now()
);

insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists platform_settings_touch on public.platform_settings;
create trigger platform_settings_touch before update on public.platform_settings
  for each row execute function public.touch_updated_at();

-- ── سجل العمليات ───────────────────────────────────────────────────────────
-- كل فعل إداري حساس يُسجَّل: من فعل، ماذا، على أي كيان، ومتى.
create table if not exists public.audit_logs (
  id            bigserial primary key,
  actor_id      uuid references public.profiles (id) on delete set null,
  action        text not null check (length(action) between 2 and 60),
  entity_type   text not null check (length(entity_type) between 2 and 40),
  entity_id     text,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_rid_idx   on public.audit_logs (restaurant_id, created_at desc);
create index if not exists audit_logs_time_idx  on public.audit_logs (created_at desc);
