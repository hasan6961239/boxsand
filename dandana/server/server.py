"""Dandana server — the YouTube side of the Dandana music app.

The iPhone app is a static web page; everything it can't do inside a browser
lives here: searching YouTube, downloading audio/video with yt-dlp, streaming
shorts for the reels feed, YouTube "Mix" recommendations, and proxying radio
streams that are only available over plain HTTP.

Run it on a computer at home (YouTube blocks most cloud/datacenter IPs from
downloading), then expose it over HTTPS with ngrok or cloudflared so the app
on the phone can reach it. See ../README.md.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import httpx
import yt_dlp
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

VERSION = "1.0.0"
HERE = Path(__file__).resolve().parent
APP_DIR = HERE.parent / "app"

KEY = os.environ.get("DANDANA_KEY", "").strip()
COOKIES = os.environ.get("DANDANA_COOKIES", "").strip()
if not COOKIES and (HERE / "cookies.txt").exists():
    COOKIES = str(HERE / "cookies.txt")
WORK = Path(os.environ.get("DANDANA_WORK") or tempfile.mkdtemp(prefix="dandana-"))
WORK.mkdir(parents=True, exist_ok=True)
KEEP_SECONDS = int(os.environ.get("DANDANA_KEEP_SECONDS", "2700"))  # finished files live 45 min
MAX_PARALLEL = int(os.environ.get("DANDANA_PARALLEL", "2"))

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)

app = FastAPI(title="Dandana", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "Content-Length",
        "Content-Range",
        "Accept-Ranges",
        "Content-Disposition",
        "X-Dandana-Meta",
    ],
)

pool = ThreadPoolExecutor(max_workers=MAX_PARALLEL)
http: httpx.AsyncClient | None = None


@app.on_event("startup")
async def _startup() -> None:
    global http
    http = httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(20.0, read=60.0),
        headers={"User-Agent": UA},
    )
    threading.Thread(target=_janitor, daemon=True).start()


@app.on_event("shutdown")
async def _shutdown() -> None:
    if http:
        await http.aclose()


# --------------------------------------------------------------------------
# Auth: optional shared key. Headers can't be set on <video src>, so the key
# may also arrive as ?key=.
# --------------------------------------------------------------------------


@app.middleware("http")
async def _auth(request: Request, call_next):
    if KEY and request.url.path.startswith("/api/") and request.method != "OPTIONS":
        given = request.headers.get("x-dandana-key") or request.query_params.get("key")
        if given != KEY:
            return JSONResponse({"error": "مفتاح الخادم غير صحيح"}, status_code=401)
    return await call_next(request)


# --------------------------------------------------------------------------
# yt-dlp helpers
# --------------------------------------------------------------------------


def _opts(**extra: Any) -> dict[str, Any]:
    o: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
        "socket_timeout": 20,
        "retries": 3,
        "http_headers": {"User-Agent": UA},
    }
    if COOKIES:
        o["cookiefile"] = COOKIES
    o.update(extra)
    return o


def _best_thumb(e: dict) -> str | None:
    vid = e.get("id")
    if vid and re.fullmatch(r"[\w-]{11}", vid):
        return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    thumbs = e.get("thumbnails") or []
    if thumbs:
        return thumbs[-1].get("url")
    return e.get("thumbnail")


def _entry(e: dict) -> dict | None:
    if not e or not e.get("id"):
        return None
    vid = e["id"]
    if not re.fullmatch(r"[\w-]{11}", vid):  # skip channels / playlists in results
        return None
    return {
        "id": vid,
        "title": e.get("title") or "",
        "channel": e.get("channel") or e.get("uploader") or "",
        "duration": e.get("duration"),
        "views": e.get("view_count"),
        "thumbnail": _best_thumb(e),
        "url": f"https://www.youtube.com/watch?v={vid}",
    }


def _flat(url: str, limit: int) -> list[dict]:
    with yt_dlp.YoutubeDL(_opts(extract_flat="in_playlist", playlistend=limit, noplaylist=False)) as y:
        info = y.extract_info(url, download=False)
    out = []
    for e in (info or {}).get("entries") or []:
        item = _entry(e)
        if item:
            out.append(item)
    return out


async def _run(fn, *a):
    return await asyncio.get_running_loop().run_in_executor(None, fn, *a)


def _err(e: Exception) -> str:
    msg = str(e)
    msg = re.sub(r"\x1b\[[0-9;]*m", "", msg).replace("ERROR: ", "")
    if "Sign in to confirm" in msg or "not a bot" in msg:
        return (
            "يوتيوب رفض الطلب من هذا الخادم (يطلب تسجيل دخول). شغّل الخادم على كمبيوتر في البيت، "
            "أو أضف ملف cookies.txt بجانب server.py."
        )
    if "Video unavailable" in msg or "Private video" in msg:
        return "الفيديو غير متاح أو خاص."
    return msg[-400:]


def _video_id(url: str) -> str | None:
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|live/)([\w-]{11})", url)
    if m:
        return m.group(1)
    if re.fullmatch(r"[\w-]{11}", url):
        return url
    return None


# --------------------------------------------------------------------------
# Info endpoints
# --------------------------------------------------------------------------


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "name": "dandana",
        "version": VERSION,
        "ytdlp": yt_dlp.version.__version__,
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "deno": bool(shutil.which("deno")),
        "cookies": bool(COOKIES),
        "auth": bool(KEY),
    }


@app.get("/api/search")
async def search(q: str, limit: int = 20, kind: str = "video"):
    q = q.strip()
    if not q:
        return {"items": []}
    limit = max(1, min(limit, 40))
    try:
        if kind == "short":
            # sp=EgIYAQ== → "under 4 minutes"; then keep the really short ones first.
            url = "https://www.youtube.com/results?search_query=" + quote(q) + "&sp=EgIYAQ%253D%253D"
            items = await _run(_flat, url, limit * 2)
            items.sort(key=lambda i: (i["duration"] or 999) > 90)
            items = items[:limit]
        else:
            items = await _run(_flat, f"ytsearch{limit}:{q}", limit)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, _err(e))
    return {"items": items}


@app.get("/api/related")
async def related(id: str, limit: int = 25):
    vid = _video_id(id)
    if not vid:
        raise HTTPException(400, "معرّف فيديو غير صالح")
    url = f"https://www.youtube.com/watch?v={vid}&list=RD{vid}"
    try:
        items = await _run(_flat, url, max(5, min(limit + 1, 50)))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, _err(e))
    return {"items": [i for i in items if i["id"] != vid][:limit]}


@app.get("/api/playlist")
async def playlist(url: str, limit: int = 200):
    try:
        items = await _run(_flat, url, max(1, min(limit, 500)))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, _err(e))
    return {"items": items}


@app.get("/api/meta")
async def meta(url: str):
    """Fast title/channel/thumbnail via oEmbed — no player request needed."""
    vid = _video_id(url)
    target = f"https://www.youtube.com/watch?v={vid}" if vid else url
    assert http
    try:
        r = await http.get("https://www.youtube.com/oembed", params={"url": target, "format": "json"})
        r.raise_for_status()
        d = r.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(404, "تعذّر قراءة بيانات الرابط")
    return {
        "id": vid,
        "title": d.get("title", ""),
        "channel": d.get("author_name", ""),
        "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else d.get("thumbnail_url"),
        "url": target,
        "isPlaylist": bool(re.search(r"[?&]list=(PL|OL|UU|FL)", url)),
    }


THUMB_HOSTS = ("ytimg.com", "ggpht.com", "googleusercontent.com", "dzcdn.net", "mzstatic.com")


@app.get("/api/thumb")
async def thumb(url: str):
    host = urlparse(url).hostname or ""
    if not any(host == h or host.endswith("." + h) for h in THUMB_HOSTS):
        raise HTTPException(400, "مضيف غير مسموح")
    assert http
    candidates = [url]
    m = re.search(r"/vi/([\w-]{11})/", url)
    if m:  # maxres when it exists, falling back to the guaranteed hq
        candidates = [f"https://i.ytimg.com/vi/{m.group(1)}/maxresdefault.jpg", url]
    for c in candidates:
        try:
            r = await http.get(c)
            if r.status_code == 200 and len(r.content) > 2000:
                return Response(
                    r.content,
                    media_type=r.headers.get("content-type", "image/jpeg"),
                    headers={"Cache-Control": "public, max-age=86400"},
                )
        except Exception:  # noqa: BLE001
            continue
    raise HTTPException(404, "لا توجد صورة")


# --------------------------------------------------------------------------
# Download jobs
# --------------------------------------------------------------------------

JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()


class JobIn(BaseModel):
    url: str
    kind: str = "audio"  # audio | video
    quality: str = "720"  # 360 | 480 | 720 | 1080 | best (video only)
    format: str = "m4a"  # m4a | mp3 (audio only)


def _format_for(kind: str, quality: str, fmt: str) -> dict[str, Any]:
    pp: list[dict[str, Any]] = []
    if kind == "audio":
        o: dict[str, Any] = {"format": "bestaudio[ext=m4a]/bestaudio/best"}
        pp.append({"key": "FFmpegExtractAudio", "preferredcodec": "mp3" if fmt == "mp3" else "m4a",
                   "preferredquality": "192" if fmt == "mp3" else "0"})
    else:
        h = 4320 if quality == "best" else int(re.sub(r"\D", "", quality) or 720)
        # iPhones play H.264 + AAC in MP4 everywhere; prefer that, fall back to anything.
        o = {
            "format": (
                f"bv*[height<={h}][vcodec^=avc1]+ba[ext=m4a]/"
                f"b[height<={h}][ext=mp4][vcodec^=avc1]/"
                f"bv*[height<={h}]+ba/b[height<={h}]/bv*+ba/b"
            ),
            "merge_output_format": "mp4",
        }
    pp.append({"key": "FFmpegMetadata", "add_metadata": True})
    pp.append({"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"})
    pp.append({"key": "EmbedThumbnail", "already_have_thumbnail": False})
    o["postprocessors"] = pp
    o["writethumbnail"] = True
    return o


def _job_worker(jid: str) -> None:
    job = JOBS[jid]
    folder = WORK / jid
    folder.mkdir(parents=True, exist_ok=True)

    def hook(d: dict) -> None:
        if job.get("cancel"):
            raise yt_dlp.utils.DownloadCancelled("cancelled")
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            # Video jobs download two streams; weight them so the bar doesn't jump back.
            part = job.setdefault("_parts", {})
            part[d.get("filename", "")] = (done, total)
            tot = sum(t for _, t in part.values()) or 0
            dn = sum(x for x, _ in part.values())
            job.update(status="downloading", progress=(dn / tot) if tot else 0,
                       speed=d.get("speed"), eta=d.get("eta"))
        elif d["status"] == "finished":
            job.update(status="processing")

    def pphook(d: dict) -> None:
        if d.get("status") == "started":
            job.update(status="processing")

    try:
        job["status"] = "starting"
        opts = _opts(
            outtmpl=str(folder / "%(title).150B [%(id)s].%(ext)s"),
            progress_hooks=[hook],
            postprocessor_hooks=[pphook],
            **_format_for(job["kind"], job["quality"], job["format"]),
        )
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(job["url"], download=True)
        files = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in
                 (".m4a", ".mp3", ".mp4", ".webm", ".opus", ".mkv", ".mov")]
        if not files:
            raise RuntimeError("لم يُنتج التحميل أي ملف")
        f = max(files, key=lambda p: p.stat().st_size)
        job.update(
            status="done", progress=1.0, file=str(f), filename=f.name, size=f.stat().st_size,
            meta={
                "id": info.get("id"),
                "title": info.get("title"),
                "track": info.get("track"),
                "artist": info.get("artist") or info.get("creator"),
                "album": info.get("album"),
                "channel": info.get("channel") or info.get("uploader"),
                "duration": info.get("duration"),
                "width": info.get("width"),
                "height": info.get("height"),
                "thumbnail": _best_thumb(info),
            },
            finished=time.time(),
        )
    except yt_dlp.utils.DownloadCancelled:
        job.update(status="cancelled", finished=time.time())
        shutil.rmtree(folder, ignore_errors=True)
    except Exception as e:  # noqa: BLE001
        job.update(status="error", error=_err(e), finished=time.time())
        shutil.rmtree(folder, ignore_errors=True)


def _public(job: dict) -> dict:
    return {k: v for k, v in job.items() if not k.startswith("_") and k not in ("file", "cancel")}


@app.post("/api/jobs")
async def create_job(body: JobIn):
    if body.kind not in ("audio", "video"):
        raise HTTPException(400, "kind must be audio or video")
    if not re.match(r"^https?://", body.url) and not _video_id(body.url):
        raise HTTPException(400, "رابط غير صالح")
    url = body.url if body.url.startswith("http") else f"https://www.youtube.com/watch?v={body.url}"
    jid = uuid.uuid4().hex[:12]
    with JOBS_LOCK:
        JOBS[jid] = {
            "id": jid, "url": url, "kind": body.kind, "quality": body.quality, "format": body.format,
            "status": "queued", "progress": 0.0, "created": time.time(),
        }
    pool.submit(_job_worker, jid)
    return _public(JOBS[jid])


@app.get("/api/jobs/{jid}")
async def get_job(jid: str):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404, "المهمة غير موجودة (ربما انتهت صلاحيتها)")
    return _public(job)


@app.delete("/api/jobs/{jid}")
async def cancel_job(jid: str):
    job = JOBS.get(jid)
    if job:
        job["cancel"] = True
        if job.get("status") in ("done", "error", "cancelled"):
            _drop(jid)
    return {"ok": True}


@app.get("/api/jobs/{jid}/file")
async def job_file(jid: str):
    job = JOBS.get(jid)
    if not job or job.get("status") != "done" or not job.get("file") or not os.path.exists(job["file"]):
        raise HTTPException(404, "الملف غير جاهز")
    f = Path(job["file"])
    media = {
        ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".webm": "video/webm",
        ".opus": "audio/ogg", ".mkv": "video/x-matroska", ".mov": "video/quicktime",
    }.get(f.suffix.lower(), "application/octet-stream")
    import json

    return FileResponse(
        f, media_type=media,
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + quote(f.name),
            "X-Dandana-Meta": quote(json.dumps(job.get("meta") or {}, ensure_ascii=False)),
        },
    )


def _drop(jid: str) -> None:
    with JOBS_LOCK:
        JOBS.pop(jid, None)
    shutil.rmtree(WORK / jid, ignore_errors=True)


def _janitor() -> None:
    while True:
        time.sleep(120)
        now = time.time()
        for jid, job in list(JOBS.items()):
            fin = job.get("finished")
            if (fin and now - fin > KEEP_SECONDS) or now - job.get("created", now) > KEEP_SECONDS * 3:
                _drop(jid)
        for k, (_, exp) in list(STREAMS.items()):
            if exp < now:
                STREAMS.pop(k, None)


# --------------------------------------------------------------------------
# Streaming (reels, play-without-download). googlevideo URLs are bound to the
# IP that resolved them, so the bytes have to flow through this server.
# --------------------------------------------------------------------------

STREAMS: dict[str, tuple[dict, float]] = {}


def _resolve(vid: str, kind: str) -> dict:
    key = f"{vid}:{kind}"
    hit = STREAMS.get(key)
    if hit and hit[1] > time.time() + 60:
        return hit[0]
    fmt = (
        "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/18/bestaudio"
        if kind == "audio"
        else "b[ext=mp4][vcodec^=avc1][acodec!=none][height<=720]/18/b[ext=mp4][acodec!=none]/b"
    )
    with yt_dlp.YoutubeDL(_opts(format=fmt)) as y:
        info = y.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
    url = info.get("url")
    headers = info.get("http_headers") or {}
    if not url and info.get("requested_formats"):
        f0 = info["requested_formats"][0]
        url, headers = f0.get("url"), f0.get("http_headers") or headers
    if not url:
        raise RuntimeError("لا يوجد رابط تشغيل مباشر لهذا الفيديو")
    m = re.search(r"[?&]expire=(\d+)", url)
    exp = float(m.group(1)) if m else time.time() + 3 * 3600
    data = {
        "url": url,
        "headers": {k: v for k, v in headers.items() if k.lower() in ("user-agent", "referer", "origin", "cookie")},
        "ext": info.get("ext"),
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "duration": info.get("duration"),
    }
    STREAMS[key] = (data, exp)
    return data


@app.get("/api/stream")
async def stream(id: str, request: Request, kind: str = "video"):
    vid = _video_id(id)
    if not vid:
        raise HTTPException(400, "معرّف فيديو غير صالح")
    try:
        s = await _run(_resolve, vid, "audio" if kind == "audio" else "video")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, _err(e))
    return await _proxy(s["url"], request, s["headers"],
                        "audio/mp4" if kind == "audio" else "video/mp4")


async def _proxy(url: str, request: Request, headers: dict | None = None, ctype: str | None = None):
    assert http
    h = dict(headers or {})
    rng = request.headers.get("range")
    if rng:
        h["Range"] = rng
    req = http.build_request("GET", url, headers=h)
    try:
        upstream = await http.send(req, stream=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"تعذّر الوصول للمصدر: {e}")
    out_h = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}
    for k in ("content-length", "content-range", "content-type"):
        if k in upstream.headers:
            out_h[k.title()] = upstream.headers[k]
    if ctype and "Content-Type" not in out_h:
        out_h["Content-Type"] = ctype

    async def body():
        try:
            async for chunk in upstream.aiter_raw(64 * 1024):
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(body(), status_code=upstream.status_code, headers=out_h)


@app.get("/api/radio")
async def radio(url: str, request: Request):
    """Relay plain-HTTP radio streams so an HTTPS page can play them."""
    if urlparse(url).scheme not in ("http", "https"):
        raise HTTPException(400, "رابط غير صالح")
    return await _proxy(url, request, {"Icy-MetaData": "0"})


# --------------------------------------------------------------------------
# Optionally serve the app itself, so a laptop can host everything at once.
# --------------------------------------------------------------------------

if APP_DIR.exists():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=str(APP_DIR), html=True), name="app")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8765"))
    print(f"\n  دندنة — الخادم يعمل على http://localhost:{port}")
    print(f"  ffmpeg: {'✓' if shutil.which('ffmpeg') else '✗ غير مثبت — التحويل لن يعمل'}")
    print(f"  deno:   {'✓' if shutil.which('deno') else '✗ غير مثبت — يوتيوب قد يفشل'}")
    print(f"  cookies: {'✓ ' + COOKIES if COOKIES else '—'}")
    print(f"  key:    {'مفعّل' if KEY else 'بدون مفتاح (أي شخص يعرف الرابط يقدر يستخدمه)'}\n")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
