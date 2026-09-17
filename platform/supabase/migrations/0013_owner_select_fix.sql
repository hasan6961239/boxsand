-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠١٣ — المالك يقرأ مطعمه دائماً
--
--  المشكلة: سياسة قراءة المطاعم كانت تعتمد على العضوية وحدها، والعضوية يُنشئها
--  مشغّل AFTER INSERT. وPostgreSQL يقيّم «INSERT … RETURNING» بسياسة القراءة
--  أيضاً — في لحظة لم يكن صف العضوية قد أُنشئ بعد. النتيجة: إنشاء مطعم بهوية
--  صاحبه يفشل فور إضافة select() إلى الاستعلام.
--
--  الكود الحالي ينجو لأنه لا يطلب الصف بعد الإدراج، لكن الاعتماد على ترتيب
--  المشغّلات هشّ: أي إضافة select() لاحقاً تكسر إنشاء المطاعم كلها.
--
--  الحل: المالك يقرأ ويدير مطعمه بحكم الملكية لا بحكم العضوية فقط. هذا هو
--  المعنى الصحيح أصلاً — مالك بلا صف عضوية يظل مالكاً.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists restaurants_select on public.restaurants;
create policy restaurants_select on public.restaurants for select to authenticated
  using (
    owner_id = auth.uid()
    or public.is_member_of(id)
    or public.is_super_admin()
  );

drop policy if exists restaurants_update on public.restaurants;
create policy restaurants_update on public.restaurants for update to authenticated
  using (owner_id = auth.uid() or public.can_manage(id))
  with check (owner_id = auth.uid() or public.can_manage(id));

-- ملاحظة: هذا لا يوسّع الصلاحية. حارس guard_restaurant_privileges يمنع المالك
-- من تغيير status أو owner_id مهما كانت السياسة، فتبقى الحالة والملكية بيد
-- إدارة المنصة وحدها.
