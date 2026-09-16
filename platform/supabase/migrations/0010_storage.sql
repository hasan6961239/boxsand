-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠١٠ — التخزين (صور الشعارات والأغلفة والأصناف)
--
--  مسار كل ملف يبدأ بمعرّف المطعم:  {restaurant_id}/products/xxxxx.webp
--  والسياسة تقرأ هذا الجزء الأول وتتحقق من صلاحية الرافع عليه — فلا يستطيع
--  مطعم الكتابة في مجلد مطعم آخر ولا حذف صوره.
--
--  يتخطّى هذا الملف نفسه بهدوء إذا لم يكن مخطط storage موجوداً (Postgres محلي).
-- ════════════════════════════════════════════════════════════════════════════

-- تحويل آمن للنص إلى uuid: يُرجع null بدل أن يرمي خطأ عند مسار غير صالح.
create or replace function public.safe_uuid(value text)
returns uuid language plpgsql immutable as $$
begin
  return value::uuid;
exception when others then
  return null;
end $$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'مخطط storage غير موجود — تم تخطي سياسات التخزين.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'restaurant-media', 'restaurant-media', true,
    2097152,                                             -- ٢ ميجابايت كحد أقصى بعد الضغط
    array['image/webp', 'image/jpeg', 'image/png', 'image/avif']
  )
  on conflict (id) do update
    set public = true,
        file_size_limit = 2097152,
        allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png', 'image/avif'];

  execute $p$ drop policy if exists restaurant_media_read on storage.objects $p$;
  execute $p$
    create policy restaurant_media_read on storage.objects for select to anon, authenticated
      using (bucket_id = 'restaurant-media')
  $p$;

  execute $p$ drop policy if exists restaurant_media_write on storage.objects $p$;
  execute $p$
    create policy restaurant_media_write on storage.objects for insert to authenticated
      with check (
        bucket_id = 'restaurant-media'
        and public.can_manage(public.safe_uuid((storage.foldername(name))[1]))
      )
  $p$;

  execute $p$ drop policy if exists restaurant_media_update on storage.objects $p$;
  execute $p$
    create policy restaurant_media_update on storage.objects for update to authenticated
      using (
        bucket_id = 'restaurant-media'
        and public.can_manage(public.safe_uuid((storage.foldername(name))[1]))
      )
  $p$;

  execute $p$ drop policy if exists restaurant_media_delete on storage.objects $p$;
  execute $p$
    create policy restaurant_media_delete on storage.objects for delete to authenticated
      using (
        bucket_id = 'restaurant-media'
        and public.can_manage(public.safe_uuid((storage.foldername(name))[1]))
      )
  $p$;
end $$;
