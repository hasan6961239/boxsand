FROM python:3.12-slim

# ffmpeg merges video+audio and converts to m4a/mp3; deno lets yt-dlp solve
# YouTube's player JavaScript (required by current yt-dlp releases).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .

ENV PORT=8765
EXPOSE 8765
CMD ["python", "server.py"]
