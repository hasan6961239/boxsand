-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠١١ — تحديد معدل الطلبات
--
--  لا يمكن تنفيذ تحديد المعدل في سياسة RLS، ولا في ذاكرة الخادم: كل استدعاء
--  على Netlify قد يقع في نسخة مختلفة من الدالة، فالعدّاد في الذاكرة يُصفَّر
--  عملياً عند كل طلب. لذلك يعيش العدّاد في قاعدة البيانات.
--
--  المفتاح مُجزَّأ ولا يُخزَّن عنوان IP نفسه، والصفوف تُحذف بعد انتهاء نافذتها.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.rate_limits (
  key_hash     text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key_hash, window_start)
);

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
-- لا صلاحيات ولا سياسات: لا يقرأ هذا الجدول إلا مفتاح الخدمة.

/**
 * يسجّل محاولة ويُرجع true إن كانت مسموحة.
 *
 * النافذة منزلقة بالخطوات: نقسّم الزمن إلى نوافذ ثابتة الطول، وهو تبسيط
 * مقصود — يكفي تماماً لصدّ السبام، ويتجنّب تخزين طابع زمني لكل محاولة.
 */
create or replace function public.hit_rate_limit(
  p_key            text,
  p_max            integer,
  p_window_seconds integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  bucket timestamptz;
  current_hits integer;
begin
  bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits (key_hash, window_start, hits)
  values (p_key, bucket, 1)
  on conflict (key_hash, window_start) do update
    set hits = public.rate_limits.hits + 1
  returning hits into current_hits;

  -- تنظيف عرضي: صف واحد من كل ألف يدفع كلفة الحذف بدل مهمة مجدولة
  if random() < 0.001 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return current_hits <= p_max;
end $$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

/**
 * إدراج شكوى من زائر غير مسجَّل.
 *
 * تُستدعى من الخادم بمفتاح الخدمة بعد التحقق من المدخلات وتحديد المعدل.
 * ترفض المطاعم غير المنشورة أو التي أوقفت استقبال الشكاوى، فلا يعتمد ذلك
 * على تذكّر الواجهة.
 */
create or replace function public.submit_complaint(
  p_restaurant_id uuid,
  p_name          text,
  p_phone         text,
  p_type          text,
  p_rating        integer,
  p_message       text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  ref integer;
begin
  if not exists (
    select 1 from public.restaurants
    where id = p_restaurant_id
      and status in ('trial', 'active')
      and accept_complaints
  ) then
    raise exception 'هذا المطعم لا يستقبل الرسائل حالياً' using errcode = 'check_violation';
  end if;

  insert into public.complaints (restaurant_id, customer_name, customer_phone, type, rating, message)
  values (
    p_restaurant_id,
    nullif(btrim(coalesce(p_name, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    coalesce(p_type, 'complaint')::public.complaint_type,
    p_rating,
    btrim(p_message)
  )
  returning ref_number into ref;

  return ref;
end $$;

revoke all on function public.submit_complaint(uuid, text, text, text, integer, text) from public;
grant execute on function public.submit_complaint(uuid, text, text, text, integer, text) to service_role;
