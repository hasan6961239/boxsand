#!/usr/bin/env bash
# اختبار شامل لكل نقاط الـ API
set -u
BASE="http://localhost:${PORT:-3111}/api"
pass=0; fail=0
TOK=""

j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+'$1'))" 2>/dev/null; }

check() { # name  expected-substring  curl-output
  local name="$1" want="$2" out="$3"
  if echo "$out" | grep -q "$want"; then
    pass=$((pass+1)); printf '  ✓ %s\n' "$name"
  else
    fail=$((fail+1)); printf '  ✗ %s\n     أرجع: %s\n' "$name" "$(echo "$out" | head -c 220)"
  fi
}

auth() { curl -s -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' "$@"; }

echo "=== المصادقة ==="
OUT=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"1234"}')
check "دخول صحيح" '"token"' "$OUT"
TOK=$(echo "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
check "دخول خاطئ مرفوض" 'غير صحيحة' "$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"username":"admin","password":"wrong"}')"
check "بدون توكن مرفوض" 'تسجيل الدخول' "$(curl -s "$BASE/auth/me")"
check "بيانات المستخدم" '"permissions"' "$(auth "$BASE/auth/me")"

echo "=== المخزون ==="
check "قائمة الأصناف" '"stock"' "$(auth "$BASE/products?limit=3")"
check "بحث نقطة البيع" 'بنادول' "$(auth "$BASE/products/search?q=%D8%A8%D9%86%D8%A7%D8%AF%D9%88%D9%84")"
check "تفاصيل صنف + بدائل" '"alternatives"' "$(auth "$BASE/products/1")"
check "التصنيفات" 'مسكنات' "$(auth "$BASE/categories")"
check "تنبيه الصلاحية" '"expiring_soon"' "$(auth "$BASE/alerts/expiry?days=90")"
check "النواقص" '\[' "$(auth "$BASE/alerts/low-stock")"

echo "=== نقطة البيع ==="
PROD=$(auth "$BASE/products?limit=60" | python3 -c "
import sys,json
rows=json.load(sys.stdin)
ok=[r for r in rows if r['stock']>5]
print(ok[0]['id'] if ok else 0)")
SALE=$(auth -X POST "$BASE/sales" -d "{\"items\":[{\"product_id\":$PROD,\"qty\":2,\"price\":10}],\"discount\":1,\"payment_method\":\"cash\"}")
check "إنشاء فاتورة بيع" '"invoice_no"' "$SALE"
SID=$(echo "$SALE" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',0))")
check "قراءة الفاتورة" '"items"' "$(auth "$BASE/sales/$SID")"
check "قائمة الفواتير" '"summary"' "$(auth "$BASE/sales?limit=5")"
check "رفض كمية غير متوفرة" 'غير متوفرة' "$(auth -X POST "$BASE/sales" -d "{\"items\":[{\"product_id\":$PROD,\"qty\":999999,\"price\":10}]}")"
check "رفض فاتورة فارغة" 'فارغة' "$(auth -X POST "$BASE/sales" -d '{"items":[]}')"
check "رفض آجل بدون زبون" 'يتطلب اختيار زبون' "$(auth -X POST "$BASE/sales" -d "{\"items\":[{\"product_id\":$PROD,\"qty\":1,\"price\":10}],\"payment_method\":\"credit\"}")"
check "مرتجع" '"total"' "$(auth -X POST "$BASE/returns" -d "{\"sale_id\":$SID,\"items\":[{\"product_id\":$PROD,\"price\":10,\"qty\":1}],\"reason\":\"اختبار\"}")"
check "رفض مرتجع أكبر من المباع" 'أكبر من المباع' "$(auth -X POST "$BASE/returns" -d "{\"sale_id\":$SID,\"items\":[{\"product_id\":$PROD,\"price\":10,\"qty\":50}]}")"

echo "=== المشتريات والأطراف ==="
check "قائمة المشتريات" '"summary"' "$(auth "$BASE/purchases?limit=3")"
check "قائمة الموردين" '"balance"' "$(auth "$BASE/suppliers")"
check "قائمة الزبائن" '"balance"' "$(auth "$BASE/customers")"
check "تفاصيل زبون" '"payments"' "$(auth "$BASE/customers/2")"
check "المصروفات" '"total"' "$(auth "$BASE/expenses")"

echo "=== التقارير ==="
for r in dashboard reports/sales reports/products reports/dead-stock reports/profit-loss reports/debtors reports/suppliers-due reports/users reports/purchase-suggestion; do
  check "تقرير $r" '[{[]' "$(auth "$BASE/$r")"
done

echo "=== الإدارة ==="
check "الإعدادات" 'pharmacy_name' "$(auth "$BASE/settings")"
check "المستخدمون" 'admin' "$(auth "$BASE/users")"
check "سجل النشاط" '\[' "$(auth "$BASE/activity?limit=5")"
check "إنشاء نسخة احتياطية" '"file"' "$(auth -X POST "$BASE/backups")"
check "قائمة النسخ" 'backup-' "$(auth "$BASE/backups")"

echo "=== الصلاحيات (كاشير) ==="
CTOK=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"username":"cashier","password":"1234"}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
cauth() { curl -s -H "Authorization: Bearer $CTOK" -H 'Content-Type: application/json' "$@"; }
check "كاشير يمنع من المستخدمين" 'صلاحية' "$(cauth "$BASE/users")"
check "كاشير يمنع من التقارير" 'صلاحية' "$(cauth "$BASE/reports/profit-loss")"
check "كاشير يمنع من المشتريات" 'صلاحية' "$(cauth "$BASE/purchases")"
check "كاشير يمنع من الإعدادات-الحفظ" 'صلاحية' "$(cauth -X POST "$BASE/settings" -d '{"pharmacy_name":"x"}')"
check "كاشير يستطيع البيع" '"invoice_no"' "$(cauth -X POST "$BASE/sales" -d "{\"items\":[{\"product_id\":$PROD,\"qty\":1,\"price\":10}]}")"

echo
echo "======================================"
printf "  ناجح: %d    فاشل: %d\n" "$pass" "$fail"
echo "======================================"
[ "$fail" -eq 0 ]
