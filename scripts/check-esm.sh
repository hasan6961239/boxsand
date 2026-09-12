#!/usr/bin/env bash
# فحص صحة صياغة ملفات الواجهة (ES modules)
set -u
TMP=$(mktemp -d)
fail=0
for f in $(find public/js -name '*.js' | sort); do
  cp "$f" "$TMP/$(basename "$f" .js).mjs"
done
for m in "$TMP"/*.mjs; do
  if ! node --check "$m" 2>/tmp/esmerr; then
    echo "✗ $(basename "$m" .mjs).js"; sed -n '1,6p' /tmp/esmerr; fail=1
  fi
done
rm -rf "$TMP"
[ $fail -eq 0 ] && echo "✓ كل ملفات الواجهة سليمة الصياغة"
exit $fail
