-- ════════════════════════════════════════════════════════════════════════════
--  سُفرة — ٠٠١٤ — سدّ ثغرة الكتابة عبر المفاتيح الأجنبية
--
--  الثغرة: جداول الأحجام والإضافات تحمل عمودين — restaurant_id للسياسة،
--  وproduct_id/group_id للربط. سياسة RLS كانت تفحص الأول فقط. فاستطاع صاحب
--  مطعم أن يُدرج صفاً بـ restaurant_id الخاص به وproduct_id يشير إلى صنف في
--  مطعم آخر: السياسة تمرّ، والصف يلتصق بصنف الضحية.
--
--  والأسوأ: مشغّل مزامنة السعر يحدّث حينئذٍ base_price لصنف الضحية. أي أن
--  المهاجم يستطيع تغيير أسعار منيو مطعم لا يملكه.
--
--  الحل: مشغّل يتحقق أن الأب يتبع المطعم نفسه، على غرار ما كان مطبَّقاً على
--  علاقة الصنف بقسمه. التحقق في قاعدة البيانات لا في الواجهة، لأن الهجوم
--  ينفَّذ باستدعاء REST مباشر لا عبر النموذج.
-- ════════════════════════════════════════════════════════════════════════════

/** يمنع ربط حجم بصنف يتبع مطعماً آخر. */
create or replace function public.assert_variant_same_restaurant()
returns trigger language plpgsql as $$
declare
  parent_rid uuid;
begin
  select restaurant_id into parent_rid from public.products where id = new.product_id;
  if parent_rid is null or parent_rid <> new.restaurant_id then
    raise exception 'الصنف لا يتبع هذا المطعم' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists product_variants_assert_parent on public.product_variants;
create trigger product_variants_assert_parent
  before insert or update of product_id, restaurant_id on public.product_variants
  for each row execute function public.assert_variant_same_restaurant();

/** يمنع ربط مجموعة إضافات بصنف يتبع مطعماً آخر. */
drop trigger if exists option_groups_assert_parent on public.option_groups;
create trigger option_groups_assert_parent
  before insert or update of product_id, restaurant_id on public.option_groups
  for each row execute function public.assert_variant_same_restaurant();

/** يمنع ربط خيار بمجموعة تتبع مطعماً آخر. */
create or replace function public.assert_option_same_restaurant()
returns trigger language plpgsql as $$
declare
  parent_rid uuid;
begin
  select restaurant_id into parent_rid from public.option_groups where id = new.group_id;
  if parent_rid is null or parent_rid <> new.restaurant_id then
    raise exception 'مجموعة الإضافات لا تتبع هذا المطعم' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists options_assert_parent on public.options;
create trigger options_assert_parent
  before insert or update of group_id, restaurant_id on public.options
  for each row execute function public.assert_option_same_restaurant();

/** يمنع جعل قسم فرعاً لقسم في مطعم آخر. */
create or replace function public.assert_category_parent_same_restaurant()
returns trigger language plpgsql as $$
declare
  parent_rid uuid;
begin
  if new.parent_id is null then
    return new;
  end if;
  select restaurant_id into parent_rid from public.categories where id = new.parent_id;
  if parent_rid is null or parent_rid <> new.restaurant_id then
    raise exception 'القسم الأب لا يتبع هذا المطعم' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists categories_assert_parent on public.categories;
create trigger categories_assert_parent
  before insert or update of parent_id, restaurant_id on public.categories
  for each row execute function public.assert_category_parent_same_restaurant();

-- ── الصنف نفسه: كان محمياً عند الإنشاء، لا عند النقل ────────────────────────
-- المشغّل القديم كان يفحص category_id وrestaurant_id، لكن نقل صنف إلى مطعم
-- آخر عبر تغيير restaurant_id وحده كان يفلت. نضيف الحالة صراحة.
drop trigger if exists products_assert_category on public.products;
create trigger products_assert_category
  before insert or update of category_id, restaurant_id on public.products
  for each row execute function public.assert_category_same_restaurant();

-- ════════════════════════════════════════════════════════════════════════════
--  تقييد سجل العمليات
--
--  كان log_audit متاحاً لكل مستخدم مسجَّل. لا يستطيع أحد انتحال هوية غيره
--  (الدالة تثبّت الفاعل من الجلسة)، لكن صاحب مطعم يستطيع إغراق الجدول
--  بملايين الصفوف. لا يستدعيها إلا إجراءات الإدارة، فنقصرها عليها.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.log_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   text default null,
  p_restaurant_id uuid default null,
  p_meta        jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if not public.is_super_admin() then
    raise exception 'غير مصرّح' using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, restaurant_id, meta)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_restaurant_id, coalesce(p_meta, '{}'::jsonb));
end $$;

revoke all on function public.log_audit(text, text, text, uuid, jsonb) from public;
grant execute on function public.log_audit(text, text, text, uuid, jsonb) to authenticated, service_role;
