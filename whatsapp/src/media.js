import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { config } from './config.js';
import { logger } from './logger.js';

// Gemini does not accept opus-in-ogg reliably; transcode voice notes to mp3.
function hasFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

const FFMPEG_AVAILABLE = hasFfmpeg();

function transcode(buffer) {
  return new Promise((resolve) => {
    if (!FFMPEG_AVAILABLE) return resolve(null);
    const input = path.join(config.paths.tmp, `${Date.now()}-in.ogg`);
    const output = path.join(config.paths.tmp, `${Date.now()}-out.mp3`);
    fs.writeFileSync(input, buffer);

    const proc = spawn('ffmpeg', ['-y', '-i', input, '-ar', '16000', '-ac', '1', output]);
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      try {
        if (code === 0 && fs.existsSync(output)) {
          const data = fs.readFileSync(output);
          resolve(data);
        } else {
          resolve(null);
        }
      } finally {
        fs.rmSync(input, { force: true });
        fs.rmSync(output, { force: true });
      }
    });
  });
}

/**
 * Pulls an attachment out of a WhatsApp message and returns it in the shape
 * Gemini expects, plus the raw buffer for Drive uploads.
 */
export async function extractMedia(message, sock) {
  const content = message.message || {};
  const kind = Object.keys(content).find((k) =>
    ['audioMessage', 'imageMessage', 'documentMessage', 'videoMessage'].includes(k));
  if (!kind) return null;

  let buffer;
  try {
    buffer = await downloadMediaMessage(message, 'buffer', {}, {
      logger,
      reuploadRequest: sock.updateMediaMessage,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'فشل تنزيل الملف');
    return null;
  }

  const node = content[kind];
  let mimeType = node.mimetype || 'application/octet-stream';
  const fileName = node.fileName || `${kind}-${Date.now()}`;

  if (kind === 'audioMessage') {
    const mp3 = await transcode(buffer);
    if (mp3) return { kind, mimeType: 'audio/mp3', buffer: mp3, fileName: `${fileName}.mp3`, forModel: true };
    return { kind, mimeType: 'audio/ogg', buffer, fileName, forModel: true };
  }

  if (kind === 'videoMessage') {
    // Too large to send to the model; keep it only for archiving.
    return { kind, mimeType, buffer, fileName, forModel: false };
  }

  // Gemini understands images and PDFs directly; other documents are archived only.
  const modelFriendly = kind === 'imageMessage' || mimeType === 'application/pdf';
  return { kind, mimeType, buffer, fileName, forModel: modelFriendly };
}

export { FFMPEG_AVAILABLE };
