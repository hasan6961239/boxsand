import fs from 'node:fs';
import path from 'node:path';
import { config, findUser, can, googleReady } from './config.js';
import { logger } from './logger.js';
import { consumeRate, clearHistory } from './db.js';
import { respond } from './agent.js';
import { extractMedia, FFMPEG_AVAILABLE } from './media.js';
import { startScheduler } from './scheduler.js';
import { driveTools } from './tools/index.js';
import {
  connect, onMessage, sendText, sendFile, setTyping, markRead, phoneOf,
} from './whatsapp.js';

// --- pending message buffers (debounce) -------------------------------------
// People send four short messages in a row; answer the thought, not each line.
const pending = new Map(); // phone -> { texts, media, timer, keys }

function textOf(message) {
  const m = message.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  ).trim();
}

function withinWorkHours() {
  const wh = config.behaviour.workHours;
  if (!wh.enabled) return true;
  const now = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.env.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  // A window that wraps past midnight (22:00 → 02:00) is still one window.
  return wh.from <= wh.to
    ? now >= wh.from && now <= wh.to
    : now >= wh.from || now <= wh.to;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function humanDelay() {
  const [min, max] = config.behaviour.replyDelaySec;
  return (min + Math.random() * Math.max(0, max - min)) * 1000;
}

// --- commands ---------------------------------------------------------------
async function handleCommand(user, text) {
  const cmd = text.trim().toLowerCase();
  if (cmd === '/مسح' || cmd === '/clear') {
    clearHistory(user.phone);
    await sendText(user.phone, 'مسحت المحادثة، بنبداو من جديد 🧹');
    return true;
  }
  if (cmd === '/حالة' || cmd === '/status') {
    const lines = [
      `الاسم: ${config.behaviour.botName}`,
      `صلاحيتك: ${user.role}`,
      `جوجل (تقويم/درايف): ${googleReady ? 'مربوط ✅' : 'غير مربوط ❌'}`,
      `فهم الصوتيات: ${FFMPEG_AVAILABLE ? 'شغّال ✅' : 'بدون ffmpeg ⚠️'}`,
      `النموذج: ${config.env.geminiModel}`,
    ];
    await sendText(user.phone, lines.join('\n'));
    return true;
  }
  return false;
}

// --- main pipeline ----------------------------------------------------------
async function handleBatch(phone, user, batch) {
  const text = batch.texts.join('\n').trim();

  if (text.startsWith('/') && (await handleCommand(user, text))) return;

  if (!withinWorkHours()) {
    await sendText(phone, config.behaviour.workHours.message);
    return;
  }

  if (!consumeRate(phone, config.behaviour.hourlyLimit)) {
    logger.warn({ phone }, 'تجاوز حد الرسائل في الساعة');
    return;
  }

  await setTyping(phone, true);

  // Archive incoming documents before answering, so the reply can mention it.
  const saved = [];
  if (config.behaviour.autoSaveFiles && can(user, 'رفع_درايف') && googleReady) {
    for (const item of batch.media) {
      if (item.kind === 'audioMessage') continue;
      const localPath = path.join(config.paths.tmp, `${Date.now()}-${item.fileName.replace(/[/\\]/g, '_')}`);
      try {
        fs.writeFileSync(localPath, item.buffer);
        const res = await driveTools.uploadFile({
          localPath, name: item.fileName, mimeType: item.mimeType,
        });
        saved.push(res.الاسم);
      } catch (err) {
        logger.error({ err: err.message }, 'فشل الحفظ في درايف');
      } finally {
        fs.rmSync(localPath, { force: true });
      }
    }
  }

  const modelMedia = batch.media
    .filter((m) => m.forModel)
    .map((m) => ({ mimeType: m.mimeType, data: m.buffer.toString('base64') }));

  let prompt = text;
  if (saved.length) {
    prompt = `${prompt}\n\n[النظام: تم حفظ الملفات التالية في جوجل درايف تلقائياً: ${saved.join('، ')}. أخبر المستخدم بذلك باختصار.]`.trim();
  }
  if (!prompt && !modelMedia.length) {
    await setTyping(phone, false);
    return;
  }

  let result;
  try {
    result = await respond(user, prompt, modelMedia);
  } catch (err) {
    logger.error({ err: err.message }, 'فشل توليد الرد');
    await setTyping(phone, false);
    await sendText(phone, 'صار عندي خلل تقني، جرّب تبعتلي من جديد بعد شوية 🙏');
    return;
  }

  await sleep(humanDelay());
  await setTyping(phone, false);

  if (result.text) await sendText(phone, result.text);

  for (const file of result.attachments) {
    try {
      await sendFile(phone, file);
    } catch (err) {
      logger.error({ err: err.message }, 'فشل إرسال ملف');
      await sendText(phone, `ما قدرتش نبعتلك ${file.name} — الملف كبير وإلا صار خلل.`);
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  }
}

function schedule(phone, user) {
  const batch = pending.get(phone);
  clearTimeout(batch.timer);
  batch.timer = setTimeout(async () => {
    pending.delete(phone);
    try {
      await handleBatch(phone, user, batch);
    } catch (err) {
      logger.error({ err: err.message, phone }, 'فشل في معالجة الدفعة');
    }
  }, config.behaviour.debounceSec * 1000);
}

async function handle(message, sock) {
  const jid = message.key.remoteJid || '';
  const isGroup = jid.endsWith('@g.us');
  if (isGroup && !config.behaviour.replyToGroups) return;
  if (jid === 'status@broadcast') return;

  const phone = phoneOf(isGroup ? message.key.participant : jid);
  const user = findUser(phone);
  if (!user) {
    logger.debug({ phone }, 'رقم غير مصرّح له — تم التجاهل');
    return;
  }

  await markRead(message.key);

  const text = textOf(message);
  const media = await extractMedia(message, sock);
  if (!text && !media) return;

  if (!pending.has(phone)) pending.set(phone, { texts: [], media: [], timer: null });
  const batch = pending.get(phone);
  if (text) batch.texts.push(text);
  if (media) batch.media.push(media);

  schedule(phone, user);
}

// --- boot -------------------------------------------------------------------
async function main() {
  if (!config.env.geminiKey) {
    console.error('\n✖ GEMINI_API_KEY غير موجود في ملف .env');
    console.error('  احصل على مفتاح مجاني من: https://aistudio.google.com/apikey\n');
    process.exit(1);
  }

  logger.info(`🤖 ${config.behaviour.botName} — جاري التشغيل`);
  logger.info(`👥 المصرّح لهم: ${config.users.map((u) => u.name).join('، ')}`);
  if (!googleReady) logger.warn('⚠ جوجل غير مربوط — التقويم والدرايف معطّلين. شغّل: npm run auth:google');
  if (!FFMPEG_AVAILABLE) logger.warn('⚠ ffmpeg غير مثبّت — جودة فهم الرسائل الصوتية قد تتأثر');

  onMessage(handle);
  await connect();
  startScheduler();
}

main().catch((err) => {
  logger.error(err, 'فشل التشغيل');
  process.exit(1);
});
