#!/bin/bash
# ============================================================
#  بناء المنظومة على لينكس — نفس ما يفعله build.bat على ويندوز
#  ------------------------------------------------------------
#  المترجم mono (mcs) بدل مترجم ويندوز، ثم ملف التثبيت بـ makensis.
#  يحتاج: mono-mcs mono-devel libmono-system-windows-forms4.0-cil
#         libmono-system-drawing4.0-cil nsis
#
#    tools/build-linux.sh                    مصراتة، والإصدار من AppVersion في Program.cs
#    EDITION=tripoli tools/build-linux.sh    طرابلس (تطبيق منفصل، قرار 0022)
#    tools/build-linux.sh 3.4                إصدار محدد
#
#  ختم التاريخ يُكتب في build/BuildInfo.cs لا في src/، فلا يتغيّر ملف
#  في المستودع بسبب البناء.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(grep -oP 'AppVersion = "\K[^"]+' src/Program.cs)}"
# ويندوز يقبل رقماً فقط في خصائص الملف (4.0)، و«-test» يبقى في الاسم
NUM="${VERSION%%-*}"
TAG="${VERSION#"$NUM"}"
STAMP="${STAMP:-$(date -u +%Y-%m-%d)}"
EDITION="${EDITION:-misrata}"
case "$EDITION" in
  misrata) NUMBER=1; ICO=app/app.ico;         PNG=app/icon.png ;;
  tripoli) NUMBER=2; ICO=app/app-tripoli.ico; PNG=app/icon-tripoli.png ;;
  *) echo "EDITION: misrata أو tripoli" >&2; exit 1 ;;
esac
mkdir -p build
echo "namespace Qirtasiya { static class BuildInfo { public const string Stamp = \"$STAMP\"; public const string Edition = \"$EDITION\"; } }" > build/BuildInfo.cs

RES=(-resource:app/index.html,index.html -resource:app/styles.css,styles.css
     -resource:$PNG,icon.png -resource:cloud/worker.js,worker.js)
for f in jsbarcode core inventory branches notify consign count sales people stale labels reports; do
  RES+=("-resource:app/js/$f.js,js/$f.js")
done
for f in app/v4/*; do RES+=("-resource:$f,v4/$(basename "$f")"); done

# -sdk:4.8-api: الترجمة على مكتبات .NET Framework 4.8 نفسها التي في ويندوز، لا على مكتبات
# mono الأوسع. بدونها s.Split(' ') صار يُربط بـ Split(char, StringSplitOptions) الموجود في mono
# وحده، فتوقّف النقل لـ 4.0 على ويندوز («لم يتم العثور على الأسلوب»)
mcs -nologo -sdk:4.8-api -target:winexe -optimize+ -out:build/Qirtasiya-$NUMBER.exe -win32icon:$ICO \
  -r:System.dll -r:System.Drawing.dll -r:System.Windows.Forms.dll -r:System.Core.dll \
  -r:vendor/webview2/Microsoft.Web.WebView2.Core.dll -r:vendor/webview2/Microsoft.Web.WebView2.WinForms.dll \
  "${RES[@]}" src/Program.cs src/AppWindow.cs build/BuildInfo.cs src/Data/*.cs src/Engine/*.cs
mkdir -p build/x64 build/x86
cp vendor/sqlite/x64/sqlite3.dll build/x64/
cp vendor/sqlite/x86/sqlite3.dll build/x86/
cp vendor/webview2/Microsoft.Web.WebView2.Core.dll vendor/webview2/Microsoft.Web.WebView2.WinForms.dll build/
cp vendor/webview2/x64/WebView2Loader.dll build/x64/
cp vendor/webview2/x86/WebView2Loader.dll build/x86/
makensis -V2 -DVERSION="$NUM" -DTAG="$TAG" -DEDITION="$EDITION" installer/qirtasiya.nsi
ls -la build/Qirtasiya-$NUMBER.exe build/Qirtasiya-*-Setup-$VERSION.exe
