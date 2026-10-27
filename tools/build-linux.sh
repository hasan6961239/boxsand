#!/bin/bash
# ============================================================
#  بناء المنظومة على لينكس — نفس ما يفعله build.bat على ويندوز
#  ------------------------------------------------------------
#  المترجم mono (mcs) بدل مترجم ويندوز، ثم ملف التثبيت بـ makensis.
#  يحتاج: mono-mcs mono-devel libmono-system-windows-forms4.0-cil
#         libmono-system-drawing4.0-cil nsis
#
#    tools/build-linux.sh            الإصدار من AppVersion في Program.cs
#    tools/build-linux.sh 3.4        إصدار محدد
#
#  ختم التاريخ يُكتب في build/BuildInfo.cs لا في src/، فلا يتغيّر ملف
#  في المستودع بسبب البناء.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(grep -oP 'AppVersion = "\K[^"]+' src/Program.cs)}"
STAMP="${STAMP:-$(date -u +%Y-%m-%d)}"
mkdir -p build
echo "namespace Qirtasiya { static class BuildInfo { public const string Stamp = \"$STAMP\"; } }" > build/BuildInfo.cs

RES=(-resource:app/index.html,index.html -resource:app/styles.css,styles.css
     -resource:app/icon.png,icon.png -resource:cloud/worker.js,worker.js)
for f in jsbarcode core inventory branches notify consign count sales people stale labels reports; do
  RES+=("-resource:app/js/$f.js,js/$f.js")
done

mcs -nologo -target:winexe -optimize+ -out:build/Qirtasiya-1.exe -win32icon:app/app.ico \
  -r:System.dll -r:System.Drawing.dll -r:System.Windows.Forms.dll -r:System.Core.dll \
  -r:vendor/webview2/Microsoft.Web.WebView2.Core.dll -r:vendor/webview2/Microsoft.Web.WebView2.WinForms.dll \
  "${RES[@]}" src/Program.cs src/AppWindow.cs build/BuildInfo.cs src/Data/*.cs src/Engine/*.cs
mkdir -p build/x64 build/x86
cp vendor/sqlite/x64/sqlite3.dll build/x64/
cp vendor/sqlite/x86/sqlite3.dll build/x86/
cp vendor/webview2/Microsoft.Web.WebView2.Core.dll vendor/webview2/Microsoft.Web.WebView2.WinForms.dll build/
cp vendor/webview2/x64/WebView2Loader.dll build/x64/
cp vendor/webview2/x86/WebView2Loader.dll build/x86/
makensis -V2 -DVERSION="$VERSION" installer/qirtasiya.nsi
ls -la build/Qirtasiya-1.exe "build/Qirtasiya-Setup-$VERSION.exe"
