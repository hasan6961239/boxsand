-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠٠٤ — الشكاوى والاقتراحات
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.complaints (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  ref_number     integer not null,                    -- رقم متسلسل داخل كل مطعم: #1، #2 …
  customer_name  text check (length(btrim(customer_name)) <= 80),
  customer_phone text check (customer_phone ~ '^\+?[0-9 \-]{7,20}$'),
  type           public.complaint_type not null default 'complaint',
  rating         smallint check (rating between 1 and 5),
  message        text not null check (length(btrim(message)) between 3 and 2000),
  status         public.complaint_status not null default 'new',
  is_read        boolean not null default false,
  internal_note  text check (length(internal_note) <= 1000),   -- لا يُعرض للزبون أبداً
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, ref_number)
);

create index if not exists complaints_inbox_idx  on public.complaints (restaurant_id, created_at desc);
create index if not exists complaints_status_idx on public.complaints (restaurant_id, status);
create index if not exists complaints_unread_idx on public.complaints (restaurant_id) where not is_read;

drop trigger if exists complaints_touch on public.complaints;
create trigger complaints_touch before update on public.complaints
  for each row execute function public.touch_updated_at();

-- ترقيم متسلسل لكل مطعم. القفل الاستشاري يمنع تكرار الرقم عند وصول شكويين معاً.
create or replace function public.assign_complaint_ref()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('complaint_ref:' || new.restaurant_id::text));
  select coalesce(max(ref_number), 0) + 1 into new.ref_number
  from public.complaints where restaurant_id = new.restaurant_id;
  return new;
end $$;

drop trigger if exists complaints_assign_ref on public.complaints;
create trigger complaints_assign_ref before insert on public.complaints
  for each row execute function public.assign_complaint_ref();
