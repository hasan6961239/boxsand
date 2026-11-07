#!/usr/bin/env python3
"""phone-brand.py <logo> <android-res-dir> <site-dir> <name> [short-name]

يعطي تطبيق الهاتف اسم المكتبة وشعارها في نسخة مؤقتة يُبنى منها (لا في المستودع:
الشعار لا يُرفع إلى GitHub). أيقونات أندرويد بكل المقاسات (العادية والمتكيّفة على خلفية
بيضاء)، وأيقونات الموقع للآيفون (icon-180/192/512 وmaskable)، والاسم في strings.xml
وmanifest.json وindex.html.
"""
import json, re, sys
from pathlib import Path
from PIL import Image, ImageDraw

logo_path, res, site, name = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4]
short = sys.argv[5] if len(sys.argv) > 5 else name
logo = Image.open(logo_path).convert("RGBA")

def square(img):
    w, h = img.size
    s = max(w, h)
    out = Image.new("RGBA", (s, s), (255, 255, 255, 0))
    out.paste(img, ((s - w) // 2, (s - h) // 2), img)
    return out

def on_white(size, scale, round_=False):
    """الشعار في وسط مربع أبيض (أو دائرة) بنسبة scale من العرض"""
    base = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    bg = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    if round_:
        m = Image.new("L", (size, size), 0)
        ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
        base.paste(bg, (0, 0), m)
    else:
        base = bg
    inner = int(size * scale)
    lg = square(logo).resize((inner, inner), Image.LANCZOS)
    base.paste(lg, ((size - inner) // 2, (size - inner) // 2), lg)
    return base

DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for d, k in DENS.items():
    folder = res / ("mipmap-" + d)
    folder.mkdir(parents=True, exist_ok=True)
    on_white(int(48 * k), 0.92, round_=True).save(folder / "ic_launcher.png")
    fg = Image.new("RGBA", (int(108 * k), int(108 * k)), (0, 0, 0, 0))
    inner = int(108 * k * 0.62)
    lg = square(logo).resize((inner, inner), Image.LANCZOS)
    fg.paste(lg, ((fg.width - inner) // 2, (fg.height - inner) // 2), lg)
    fg.save(folder / "ic_launcher_fg.png")

# خلفية الأيقونة المتكيّفة بيضاء بدل الأخضر
colors = res / "values" / "colors.xml"
c = colors.read_text(encoding="utf-8")
if 'name="icon_bg"' not in c:
    c = c.replace("</resources>", '    <color name="icon_bg">#FFFFFF</color>\n</resources>')
    colors.write_text(c, encoding="utf-8")
ad = res / "mipmap-anydpi-v26" / "ic_launcher.xml"
ad.write_text(ad.read_text(encoding="utf-8").replace("@color/green", "@color/icon_bg"), encoding="utf-8")

strings = res / "values" / "strings.xml"
strings.write_text(re.sub(r'(<string name="app_name">)[^<]*(</string>)', lambda m: m.group(1) + name + m.group(2),
                          strings.read_text(encoding="utf-8")), encoding="utf-8")

site = Path(site)
on_white(180, 0.86).convert("RGB").save(site / "icon-180.png")
on_white(192, 0.86).save(site / "icon-192.png")
on_white(512, 0.86).save(site / "icon-512.png")
on_white(512, 0.62).save(site / "icon-maskable.png")
mf = site / "manifest.json"
m = json.loads(mf.read_text(encoding="utf-8"))
m["name"], m["short_name"] = name, short
mf.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")
ix = site / "index.html"
t = ix.read_text(encoding="utf-8")
t = re.sub(r'(<meta name="apple-mobile-web-app-title" content=")[^"]*(">)', lambda mm: mm.group(1) + short + mm.group(2), t)
t = re.sub(r"<title>[^<]*</title>", "<title>" + name + "</title>", t)
ix.write_text(t, encoding="utf-8")
print("brand:", name, "/", short)
