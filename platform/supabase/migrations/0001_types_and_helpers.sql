-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠٠١ — الأنواع والدوال المساعدة
-- ════════════════════════════════════════════════════════════════════════════

-- ── الأنواع ─────────────────────────────────────────────────────────────────
do $$ begin
  create type public.account_role    as enum ('super_admin', 'owner');
  create type public.member_role     as enum ('owner', 'manager', 'staff');
  create type public.restaurant_status as enum ('trial', 'active', 'suspended', 'disabled');
  create type public.product_badge    as enum ('new', 'popular', 'offer', 'spicy', 'vegetarian');
  create type public.complaint_type   as enum ('complaint', 'suggestion', 'note');
  create type public.complaint_status as enum ('new', 'in_review', 'resolved', 'closed');
  create type public.theme_preset     as enum ('elegant', 'modern', 'luxury', 'minimal', 'dark', 'classic');
  create type public.button_style     as enum ('solid', 'soft', 'outline');
  create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled');
exception when duplicate_object then null; end $$;

-- ── updated_at تلقائي ───────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── توليد المعرّف القصير الثابت لروابط QR ───────────────────────────────────
-- أبجدية بلا أحرف متشابهة (0/O، 1/I/l) حتى يمكن قراءتها ونطقها بالهاتف.
create or replace function public.generate_short_id(len int default 7)
returns text language plpgsql as $$
declare
  alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  out text := '';
  i int;
begin
  for i in 1..len loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end $$;

-- ── تحويل الاسم إلى slug (يدعم العربية) ─────────────────────────────────────
create or replace function public.slugify(value text)
returns text language plpgsql immutable as $$
declare
  s text;
begin
  s := lower(trim(coalesce(value, '')));
  -- الأحرف العربية والإنجليزية والأرقام فقط، وما عداها يصير شرطة
  s := regexp_replace(s, '[^a-z0-9؀-ۿ]+', '-', 'g');
  s := regexp_replace(s, '(^-+|-+$)', '', 'g');
  s := regexp_replace(s, '-{2,}', '-', 'g');
  return nullif(s, '');
end $$;
