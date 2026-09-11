FROM node:22-slim

# ffmpeg لتحويل الرسائل الصوتية، وأدوات البناء لـ better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
VOLUME ["/app/data"]

CMD ["node", "src/index.js"]
