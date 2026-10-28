#!/bin/bash
# ============================================================
#  اختبارات قاعدة البيانات على لينكس (المرحلة 1)
#  ------------------------------------------------------------
#  الكود نفسه بقيود لغة C# 5 (-langversion:5) كما يقبله مترجم
#  ويندوز المدمج (قرار 0002)، ومكتبة sqlite3 من النظام. على ويندوز:
#  tools\build-dbtests.bat (بالمترجم المدمج وملفي sqlite3.dll).
#
#    tools/build-dbtests.sh                    يبني build/DbTests.exe
#    mono build/DbTests.exe                    كل الاختبارات
#    mono build/DbTests.exe crash 2000         القتل وسط العمل
#    mono build/DbTests.exe crash 300 --migrate القتل وسط الترقية
#    mono build/DbTests.exe bench 100000       القياس
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
# على مكتبات .NET Framework 4.8 نفسها كالبرنامج (tools/build-linux.sh)
mcs -nologo -sdk:4.8-api -langversion:5 -optimize+ -out:build/DbTests.exe -r:System.dll -r:System.Core.dll \
  src/Data/*.cs src/Engine/*.cs tests/db/*.cs
# mono يبحث عن libsqlite3.so، وهي موجودة فقط مع حزمة التطوير
cat > build/DbTests.exe.config <<'XML'
<configuration>
  <dllmap dll="sqlite3" target="libsqlite3.so.0" os="linux"/>
</configuration>
XML
echo "build/DbTests.exe"
