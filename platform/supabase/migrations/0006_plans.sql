-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠٠٦ — الخطط والاشتراكات
--
--  لا توجد بوابة دفع بعد. الخطط تُدار من لوحة الأدمن وتُفرض حدودها برمجياً،
--  والبنية جاهزة لإضافة مزوّد دفع لاحقاً دون تعديل أي جدول.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.plans (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[a-z_]{2,20}$'),
  name           text not null check (length(btrim(name)) between 2 and 40),
  description    text check (length(description) <= 300),
  price_monthly  numeric(10,2) check (price_monthly >= 0),
  currency       text not null default 'LYD' check (currency ~ '^[A-Z]{3}$'),
  max_categories integer check (max_categories > 0),   -- null = بلا حد
  max_products   integer check (max_products > 0),
  features       jsonb not null default '[]'::jsonb,
  is_public      boolean not null default true,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists plans_touch on public.plans;
create trigger plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();

create table if not exists public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  plan_id       uuid not null references public.plans (id) on delete restrict,
  status        public.subscription_status not null default 'trialing',
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  note          text check (length(note) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- اشتراك فعّال واحد لكل مطعم؛ التاريخ القديم يبقى محفوظاً.
create unique index if not exists subscriptions_active_idx
  on public.subscriptions (restaurant_id)
  where status in ('trialing', 'active', 'past_due');

create index if not exists subscriptions_rid_idx on public.subscriptions (restaurant_id, created_at desc);

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- الخطط الأساسية. الأسعار تُضبط من لوحة الأدمن — لا تُكتب أرقام في الكود.
insert into public.plans (code, name, description, price_monthly, max_categories, max_products, features, position)
values
  ('free',    'مجاني',  'ابدأ وجرّب المنصة بلا أي تكلفة.',        0,    3,   25,
   '["منيو إلكتروني برابط خاص","QR Code جاهز للطباعة","٣ أقسام و٢٥ صنفاً","ثيم واحد"]'::jsonb, 1),
  ('basic',   'أساسي',  'المناسب لمطعم واحد يعمل يومياً.',        null, 15,  300,
   '["أقسام وأصناف بلا حدود عملياً","كل الثيمات وتخصيص الألوان","الشكاوى والاقتراحات","إحصائيات المنيو","إزالة شعار سُفرة"]'::jsonb, 2),
  ('premium', 'متقدم',  'لمن يريد كل شيء بلا قيود.',              null, null, null,
   '["كل مزايا الأساسي","أقسام وأصناف بلا حد","الأحجام والإضافات","تقارير مفصّلة","دعم بأولوية"]'::jsonb, 3)
on conflict (code) do nothing;

-- كل مطعم جديد يبدأ على الخطة المجانية.
create or replace function public.create_default_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  free_plan uuid;
begin
  select id into free_plan from public.plans where code = 'free';
  if free_plan is not null then
    insert into public.subscriptions (restaurant_id, plan_id, status)
    values (new.id, free_plan, 'trialing')
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists restaurants_default_subscription on public.restaurants;
create trigger restaurants_default_subscription after insert on public.restaurants
  for each row execute function public.create_default_subscription();
