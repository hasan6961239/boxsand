"""Dandana downloader for the iPhone (runs inside the free a-Shell app).

Downloads with yt-dlp from the phone's own internet connection, so YouTube
treats it like any phone — no computer, no cloud server. Files land in
Files › a-Shell › Dandana, ready to import into Dandana.

One-time setup inside a-Shell:
    pip install -U yt-dlp yt-dlp-apple-webkit-jsi mutagen
    curl -L <dandana-site>/ashell/dandana.py -o ~/Documents/dandana.py

Use:
    python3 ~/Documents/dandana.py "<link>" [audio|360|720|1080]
or one string "<link> audio" (that is what the Shortcut sends).
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.request

HOME = os.path.expanduser("~/Documents")
OUT = os.path.join(HOME, "Dandana")
STAMP = os.path.join(HOME, ".dandana-updated")
MODES = ("audio", "360", "480", "720", "1080")


def say(msg):
    print(msg, flush=True)


def parse_args(argv):
    text = " ".join(argv).strip()
    m = re.search(r"https?://\S+", text)
    if not m:
        say("❌ ما لقيت رابط. الاستعمال: python3 dandana.py <رابط> [audio|360|720|1080]")
        sys.exit(1)
    url = m.group(0).rstrip("|")
    rest = (text[: m.start()] + " " + text[m.end():]).replace("|", " ").split()
    mode = next((w for w in rest if w in MODES), "audio")
    return url, mode


def update_if_old():
    """yt-dlp needs frequent updates for YouTube; refresh every 3 days."""
    try:
        if os.path.exists(STAMP) and time.time() - os.path.getmtime(STAMP) < 3 * 86400:
            return
        say("⏳ يحدّث yt-dlp (مرة كل 3 أيام)…")
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-U", "--disable-pip-version-check",
                        "yt-dlp", "yt-dlp-apple-webkit-jsi", "mutagen"], check=False)
        open(STAMP, "w").close()
    except Exception as e:  # keep going with the installed version
        say(f"⚠️ ما قدرت نحدّث: {e}")


def has_ffmpeg():
    from shutil import which
    return bool(which("ffmpeg"))


def fmt_for(mode):
    if mode == "audio":
        # M4A plays everywhere on iPhone and needs no conversion
        return {"format": "ba[ext=m4a]/ba[acodec^=mp4a]/ba/b"}
    h = int(mode)
    progressive = f"b[height<={h}][ext=mp4][vcodec^=avc1][acodec!=none]/18/b[ext=mp4][acodec!=none]/b"
    if h > 360 and has_ffmpeg():
        return {"format": f"bv*[height<={h}][vcodec^=avc1]+ba[ext=m4a]/{progressive}", "merge_output_format": "mp4"}
    if h > 360:
        say("ℹ️ بدون ffmpeg يوتيوب يعطي فيديو مدمج بجودة 360p فقط (ثبّته بـ: pkg install ffmpeg)")
    return {"format": progressive}


def tag(path, info):
    """Title, channel and cover inside the file so Dandana shows them."""
    try:
        from mutagen.mp4 import MP4, MP4Cover
    except ImportError:
        return
    if not path.lower().endswith((".m4a", ".mp4")):
        return
    try:
        f = MP4(path)
        f["\xa9nam"] = [info.get("title") or ""]
        f["\xa9ART"] = [info.get("artist") or info.get("uploader") or info.get("channel") or ""]
        if info.get("track"):
            f["\xa9nam"] = [info["track"]]
        vid = info.get("id") or ""
        for u in (f"https://i.ytimg.com/vi/{vid}/maxresdefault.jpg", f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg", info.get("thumbnail")):
            if not u:
                continue
            try:
                data = urllib.request.urlopen(u, timeout=20).read()
                if len(data) > 3000:
                    f["covr"] = [MP4Cover(data, imageformat=MP4Cover.FORMAT_JPEG)]
                    break
            except Exception:
                continue
        f.save()
    except Exception as e:
        say(f"⚠️ الملف جاهز لكن بدون معلومات: {e}")


def main():
    url, mode = parse_args(sys.argv[1:])
    os.makedirs(OUT, exist_ok=True)
    update_if_old()
    try:
        import yt_dlp
    except ImportError:
        say("❌ yt-dlp غير مثبت. نفّذ أولاً: pip install -U yt-dlp yt-dlp-apple-webkit-jsi mutagen")
        sys.exit(1)

    last = {"p": -1}

    def hook(d):
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                p = int(d.get("downloaded_bytes", 0) * 100 / total)
                if p >= last["p"] + 10:
                    last["p"] = p
                    say(f"⬇️ {p}%")

    opts = {
        "outtmpl": os.path.join(OUT, "%(title).120B [%(id)s].%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [hook],
        "restrictfilenames": False,
        "windowsfilenames": True,
        **fmt_for(mode),
    }
    say(f"🎵 دندنة: {'صوت' if mode == 'audio' else 'فيديو ' + mode + 'p'} ← {url}")
    try:
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(url, download=True)
            path = y.prepare_filename(info)
            if opts.get("merge_output_format") and not os.path.exists(path):
                path = os.path.splitext(path)[0] + ".mp4"
    except Exception as e:
        msg = re.sub(r"\x1b\[[0-9;]*m", "", str(e)).replace("ERROR: ", "")
        say("❌ فشل التحميل: " + msg[-300:])
        say("جرّب بعد شوية، أو حدّث: pip install -U yt-dlp yt-dlp-apple-webkit-jsi")
        sys.exit(2)
    tag(path, info)
    size = os.path.getsize(path) / 1048576 if os.path.exists(path) else 0
    say(f"✅ تم: {os.path.basename(path)} ({size:.1f} م.ب)")
    say("افتح دندنة ← مكتبتي ← ＋ ← تصفح ← a-Shell ← Dandana")
    print(json.dumps({"ok": True, "file": os.path.basename(path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
