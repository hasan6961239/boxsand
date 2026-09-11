import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import { config } from './config.js';
import { logger } from './logger.js';

let sock = null;
const listeners = [];

export function onMessage(handler) {
  listeners.push(handler);
}

export function jidOf(phone) {
  return `${phone}@s.whatsapp.net`;
}

export function phoneOf(jid) {
  return String(jid || '').split('@')[0].split(':')[0];
}

export async function sendText(phone, text) {
  if (!sock) throw new Error('الاتصال بالواتساب غير جاهز');
  await sock.sendMessage(jidOf(phone), { text });
}

export async function sendFile(phone, { path: filePath, name, mimeType }) {
  if (!sock) throw new Error('الاتصال بالواتساب غير جاهز');
  const buffer = fs.readFileSync(filePath);
  const isImage = (mimeType || '').startsWith('image/');
  const payload = isImage
    ? { image: buffer, caption: name }
    : { document: buffer, fileName: name, mimetype: mimeType || 'application/octet-stream' };
  await sock.sendMessage(jidOf(phone), payload);
}

export async function setTyping(phone, on) {
  if (!sock || !config.behaviour.showTyping) return;
  try {
    await sock.sendPresenceUpdate(on ? 'composing' : 'paused', jidOf(phone));
  } catch { /* presence is best-effort */ }
}

export async function markRead(key) {
  try { await sock?.readMessages([key]); } catch { /* best-effort */ }
}

export async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(config.paths.auth);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    browser: ['Boxsand', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 امسح الكود هذا من واتساب: الإعدادات ← الأجهزة المرتبطة ← ربط جهاز\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      logger.info('✅ الاتصال بالواتساب تم بنجاح');
    }

    if (connection === 'close') {
      const status = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = status === DisconnectReason.loggedOut;
      logger.warn({ status }, loggedOut ? 'تم تسجيل الخروج' : 'انقطع الاتصال، جاري إعادة المحاولة');

      if (loggedOut) {
        // The saved session is dead; clear it so the next start shows a fresh QR.
        fs.rmSync(config.paths.auth, { recursive: true, force: true });
        fs.mkdirSync(config.paths.auth, { recursive: true });
        logger.error('لازم تمسح كود QR من جديد. أعد تشغيل البوت.');
        process.exit(1);
      }
      setTimeout(() => connect().catch((e) => logger.error(e, 'فشل إعادة الاتصال')), 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages) {
      if (message.key.fromMe) continue;
      for (const handler of listeners) {
        try {
          await handler(message, sock);
        } catch (err) {
          logger.error({ err: err.message }, 'خطأ أثناء معالجة رسالة');
        }
      }
    }
  });

  return sock;
}

export function socket() {
  return sock;
}
