-- ════════════════════════════════════════════════════════════════════════════
--  محاكاة بيئة Supabase على PostgreSQL محلي — لأغراض الاختبار فقط.
--
--  هذا الملف لا يُرفع إلى Supabase ولا يُشغَّل في الإنتاج. وظيفته أن تُطبَّق
--  الهجرات نفسها حرفياً على قاعدة محلية، فتُختبر سياسات RLS اختباراً حقيقياً
--  بدل الاكتفاء بقراءتها.
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- نفس تعريف Supabase: هوية المستخدم تُقرأ من مطالبات الـ JWT.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
