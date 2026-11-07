#!/bin/bash
# build-phone-app.sh <out.apk> [logo] [app name] [short name] [id suffix]
#
# يبني تطبيق أندرويد (مجلدا android وsite) في نسخة مؤقتة، فلا يتغيّر شيء في المستودع.
# مع الشعار والاسم: التطبيق باسم المكتبة وأيقونتها، مثلاً لفرع طرابلس:
#   tools/build-phone-app.sh out/darhikma-tripoli.apk ~/logo.jpg "دار الحكمة — طرابلس" "دار الحكمة" tripoli
# id suffix يجعله تطبيقاً مستقلاً (ly.maktaba.stock.tripoli) يُثبَّت بجانب تطبيق مصراتة.
#
# يحتاج ANDROID_HOME (Android SDK: platform 34 وbuild-tools 34) وgradle وJDK 17+.
# التوقيع: android/keystore.properties ومفتاحه بجانبه، أو PHONE_KEYSTORE=مسار keystore.properties
# (storeFile فيه مسار كامل). لا يُرفعان أبداً. بدونهما يخرج التطبيق غير موقّع فلا يُثبَّت.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:?"اكتب مسار ملف apk الناتج"}
LOGO=${2:-}; NAME=${3:-}; SHORT=${4:-$NAME}; SUFFIX=${5:-}
[ -n "${ANDROID_HOME:-}" ] || { echo "ANDROID_HOME غير مضبوط (مجلد Android SDK)"; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -r "$ROOT/android" "$TMP/android"; cp -r "$ROOT/site" "$TMP/site"
rm -rf "$TMP/android/app/build" "$TMP/android/.gradle"
echo "sdk.dir=$ANDROID_HOME" > "$TMP/android/local.properties"
if [ -n "${PHONE_KEYSTORE:-}" ]; then cp "$PHONE_KEYSTORE" "$TMP/android/keystore.properties"; fi
if [ -n "$LOGO" ]; then
  python3 "$ROOT/tools/phone-brand.py" "$LOGO" "$TMP/android/app/src/main/res" "$TMP/site" "${NAME:-مخزون المكتبة}" "$SHORT"
fi
if [ -n "$SUFFIX" ]; then
  sed -i "s/applicationId \"ly.maktaba.stock\"/applicationId \"ly.maktaba.stock.$SUFFIX\"/" "$TMP/android/app/build.gradle"
fi
(cd "$TMP/android" && gradle --no-daemon -q assembleRelease)
mkdir -p "$(dirname "$OUT")"
APK=$(ls "$TMP"/android/app/build/outputs/apk/release/*.apk | head -1)
cp "$APK" "$OUT"
echo "$(basename "$APK") ← $OUT"
