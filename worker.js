/**
 * سند — سكرتير شخصي ذكي على تليجرام
 * يشتغل على Cloudflare Workers مجاناً بالكامل.
 *
 * الإعداد كله يتم من المتصفح عبر صفحة /setup — ما تحتاجش حاسوب.
 * التفاصيل في ملف SETUP.md
 */

// ═══════════════════════════════════════════════════════════
//  1. الإعدادات
// ═══════════════════════════════════════════════════════════

const DEFAULTS = {
  BOT_NAME: 'سند',
  GEMINI_MODEL: 'gemini-3.6-flash',
  CALENDAR_ID: 'primary',
  UTC_OFFSET_MINUTES: 120, // ليبيا UTC+2 بلا توقيت صيفي
  MEMORY_TURNS: 30,
  HOURLY_LIMIT: 40,
  MAX_TOOL_ROUNDS: 6,
  MAX_MODEL_FILE_BYTES: 4 * 1024 * 1024,
  MAX_DELIVERY_ATTEMPTS: 5,
};

// الصلاحيات حسب الصفة
const PERMISSIONS = {
  owner: {
    calendar_read: true,
    calendar_write: true,
    reminders: true,
    drive_read: true,
    drive_write: true,
  },
  member: {
    calendar_read: true,
    calendar_write: false,
    reminders: true,
    drive_read: false,
    drive_write: false,
  },
};

function settings(env) {
  return {
    botName: env.BOT_NAME || DEFAULTS.BOT_NAME,
    model: env.GEMINI_MODEL || DEFAULTS.GEMINI_MODEL,
    calendarId: env.CALENDAR_ID || DEFAULTS.CALENDAR_ID,
    driveFolderId: env.DRIVE_FOLDER_ID || '',
    offsetMin: Number(env.UTC_OFFSET_MINUTES ?? DEFAULTS.UTC_OFFSET_MINUTES),
    extraInstructions: env.EXTRA_INSTRUCTIONS || '',
  };
}

// لصق مفتاح من المتصفح يجرّ معه مسافة أو سطراً جديداً كثيراً، وهو يفسد
// الطلب بصمت — فكل سر يُقرأ مقصوصاً من أطرافه
function secret(env, name) {
  return String(env[name] ?? '').trim();
}

function can(user, permission) {
  const set = PERMISSIONS[user?.role] || PERMISSIONS.member;
  return set[permission] === true;
}

// ═══════════════════════════════════════════════════════════
//  2. الوقت — حساب بإزاحة ثابتة، وعرض بالعربية
// ═══════════════════════════════════════════════════════════

const MINUTE = 60_000;

// "2026-09-12T17:00" بالتوقيت المحلي → epoch ms
function parseLocal(value, offsetMin) {
  if (!value) return NaN;
  const bare = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(value);
  if (!bare) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? NaN : parsed;
  }
  const asUtc = Date.parse(`${value.replace(' ', 'T')}Z`);
  return asUtc - offsetMin * MINUTE;
}

// epoch ms → "2026-09-12T17:00" بالتوقيت المحلي
function toLocalIso(ms, offsetMin) {
  return new Date(ms + offsetMin * MINUTE).toISOString().slice(0, 16);
}

function formatArabic(ms, offsetMin) {
  const shifted = new Date(ms + offsetMin * MINUTE);
  return new Intl.DateTimeFormat('ar-LY', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(shifted);
}

// ═══════════════════════════════════════════════════════════
//  3. قاعدة البيانات (D1)
// ═══════════════════════════════════════════════════════════

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     role TEXT NOT NULL,
     note TEXT DEFAULT '',
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, id)`,
  `CREATE TABLE IF NOT EXISTS reminders (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL,
     text TEXT NOT NULL,
     due_at INTEGER NOT NULL,
     repeat TEXT,
     done INTEGER NOT NULL DEFAULT 0,
     attempts INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(done, due_at)`,
  `CREATE TABLE IF NOT EXISTS notes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL,
     text TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS invites (
     code TEXT PRIMARY KEY,
     expires_at INTEGER NOT NULL,
     used_by INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS rate_limit (
     user_id INTEGER NOT NULL,
     hour INTEGER NOT NULL,
     count INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, hour)
   )`,
];

// ترقيات على قواعد بيانات أُنشئت بنسخة أقدم — تُتجاهل إذا كانت مطبّقة أصلاً
const MIGRATIONS = [
  'ALTER TABLE reminders ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0',
];

async function initSchema(env) {
  for (const statement of SCHEMA) await env.DB.prepare(statement).run();
  for (const statement of MIGRATIONS) {
    try {
      await env.DB.prepare(statement).run();
    } catch (err) {
      if (!/duplicate column/i.test(err.message || '')) throw err;
    }
  }
}

async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row?.value ?? null;
}

async function putSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).bind(key, value).run();
}

async function getUser(env, id) {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

async function listUsers(env) {
  const { results } = await env.DB.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
  return results || [];
}

async function addUser(env, { id, name, role, note = '' }) {
  await env.DB.prepare(
    `INSERT INTO users (id, name, role, note, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role`,
  ).bind(id, name, role, note, Date.now()).run();
}

async function ownerExists(env) {
  const row = await env.DB.prepare("SELECT id FROM users WHERE role = 'owner' LIMIT 1").first();
  return Boolean(row);
}

async function recordMessage(env, userId, role, content) {
  await env.DB.prepare(
    'INSERT INTO messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)',
  ).bind(userId, role, content, Date.now()).run();
}

async function recentMessages(env, userId, limit) {
  const { results } = await env.DB.prepare(
    'SELECT role, content FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?',
  ).bind(userId, limit).all();
  return (results || []).reverse();
}

async function consumeRate(env, userId, limit) {
  const hour = Math.floor(Date.now() / 3_600_000);
  await env.DB.prepare(
    `INSERT INTO rate_limit (user_id, hour, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, hour) DO UPDATE SET count = count + 1`,
  ).bind(userId, hour).run();
  const row = await env.DB.prepare(
    'SELECT count FROM rate_limit WHERE user_id = ? AND hour = ?',
  ).bind(userId, hour).first();
  return (row?.count ?? 0) <= limit;
}

// ═══════════════════════════════════════════════════════════
//  4. تليجرام
// ═══════════════════════════════════════════════════════════

const TG = 'https://api.telegram.org';

async function tgCall(env, method, body) {
  const res = await fetch(`${TG}/bot${secret(env, 'TELEGRAM_BOT_TOKEN')}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  // بوابة معطّلة ترجّع HTML لا JSON — نخليها خطأ واضح بدل ما تنفجر في مكان بعيد
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`تليجرام رجّع رداً غير مفهوم (${res.status}): ${raw.slice(0, 120)}`);
  }

  // ترمي بدل ما ترجّع حتى يعرف المنادي إن الإرسال ما وصلش —
  // التذكيرات تعتمد على هذا حتى تبقى معلّقة وتتعاود بعدين
  if (!data.ok) throw new Error(`تليجرام رفض ${method}: ${data.description || 'سبب غير معروف'}`);
  return data;
}

// تليجرام يرفض الرسائل الأطول من 4096 حرف
async function sendMessage(env, chatId, text) {
  const chunks = [];
  let rest = String(text);
  while (rest.length > 4000) {
    let cut = rest.lastIndexOf('\n', 4000);
    if (cut < 2000) cut = 4000;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);
  for (const chunk of chunks) {
    if (chunk.trim()) await tgCall(env, 'sendMessage', { chat_id: chatId, text: chunk });
  }
}

async function sendTyping(env, chatId) {
  try {
    await tgCall(env, 'sendChatAction', { chat_id: chatId, action: 'typing' });
  } catch {
    // مؤشر الكتابة تجميلي — ما يستاهلش يوقف الرد
  }
}

async function sendDocument(env, chatId, { bytes, name, mimeType }) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([bytes], { type: mimeType || 'application/octet-stream' }), name);
  const res = await fetch(`${TG}/bot${secret(env, 'TELEGRAM_BOT_TOKEN')}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || 'فشل إرسال الملف');
  return data;
}

// تنزيل مرفق من تليجرام (الحد الأقصى لواجهة البوتات 20 ميجابايت)
async function downloadTelegramFile(env, fileId) {
  let info;
  try {
    info = await tgCall(env, 'getFile', { file_id: fileId });
  } catch (err) {
    console.log('getFile failed:', err.message);
    return null;
  }
  const res = await fetch(`${TG}/file/bot${secret(env, 'TELEGRAM_BOT_TOKEN')}/${info.result.file_path}`);
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

// تحويل على دفعات — btoa على سلسلة ضخمة يستهلك وقت المعالج بلا داعٍ
function toBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

// ═══════════════════════════════════════════════════════════
//  5. جوجل — التقويم والدرايف
// ═══════════════════════════════════════════════════════════

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
].join(' ');

async function googleAccessToken(env) {
  const refreshToken = await getSetting(env, 'google_refresh_token');
  if (!refreshToken) throw new Error('جوجل غير مربوط. افتح صفحة الإعداد واربطه.');

  const cachedRaw = await getSetting(env, 'google_access_token');
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw);
    if (cached.expires_at > Date.now() + 60_000) return cached.token;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: secret(env, 'GOOGLE_CLIENT_ID'),
      client_secret: secret(env, 'GOOGLE_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`فشل تجديد رمز جوجل: ${data.error_description || data.error}`);

  await putSetting(env, 'google_access_token', JSON.stringify({
    token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  }));
  return data.access_token;
}

async function googleFetch(env, url, options = {}) {
  const token = await googleAccessToken(env);
  const res = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`جوجل رفض الطلب (${res.status}): ${detail.slice(0, 200)}`);
  }
  return res;
}

// ── التقويم ──
async function calListEvents(env, cfg, fromMs, toMs) {
  const params = new URLSearchParams({
    timeMin: new Date(fromMs).toISOString(),
    timeMax: new Date(toMs).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });
  const res = await googleFetch(
    env,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events?${params}`,
  );
  const data = await res.json();
  const items = data.items || [];
  if (!items.length) return { count: 0, نص: 'ما فماش مواعيد في الفترة هذي.' };
  return {
    count: items.length,
    events: items.map((e) => ({
      id: e.id,
      العنوان: e.summary || '(بدون عنوان)',
      الوقت: e.start?.dateTime
        ? formatArabic(Date.parse(e.start.dateTime), cfg.offsetMin)
        : e.start?.date,
      المكان: e.location || '',
    })),
  };
}

async function calCreateEvent(env, cfg, { title, startMs, endMs, location, description }) {
  const body = {
    summary: title,
    location: location || '',
    description: description || '',
    start: { dateTime: new Date(startMs).toISOString() },
    end: { dateTime: new Date(endMs || startMs + 3_600_000).toISOString() },
  };
  const res = await googleFetch(
    env,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await res.json();
  return { id: data.id, العنوان: title, الوقت: formatArabic(startMs, cfg.offsetMin), الحالة: 'تم التسجيل' };
}

async function calUpdateEvent(env, cfg, { eventId, title, startMs, endMs, location }) {
  const body = {};
  if (title) body.summary = title;
  if (location !== undefined) body.location = location;
  if (startMs) body.start = { dateTime: new Date(startMs).toISOString() };
  if (endMs) body.end = { dateTime: new Date(endMs).toISOString() };
  else if (startMs) body.end = { dateTime: new Date(startMs + 3_600_000).toISOString() };

  const res = await googleFetch(
    env,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await res.json();
  return {
    id: data.id,
    العنوان: data.summary,
    الوقت: data.start?.dateTime ? formatArabic(Date.parse(data.start.dateTime), cfg.offsetMin) : '',
    الحالة: 'تم التعديل',
  };
}

async function calDeleteEvent(env, cfg, eventId) {
  await googleFetch(
    env,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' },
  );
  return { الحالة: 'تم الحذف' };
}

// ── درايف ──
function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveSearch(env, cfg, query) {
  const clauses = ['trashed = false'];
  if (query) clauses.push(`name contains '${escapeDriveQuery(query)}'`);
  if (cfg.driveFolderId) clauses.push(`'${escapeDriveQuery(cfg.driveFolderId)}' in parents`);

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id, name, mimeType, size, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '10',
  });
  const res = await googleFetch(env, `https://www.googleapis.com/drive/v3/files?${params}`);
  const data = await res.json();
  const files = data.files || [];
  if (!files.length) return { count: 0, نص: 'ما لقيتش ملفات بالاسم هذا.' };
  return {
    count: files.length,
    files: files.map((f) => ({ id: f.id, الاسم: f.name, النوع: f.mimeType })),
  };
}

// ملفات جوجل الأصلية (مستندات/جداول) تتصدّر بدل ما تتنزّل كما هي
const DRIVE_EXPORTS = {
  'application/vnd.google-apps.document': { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.spreadsheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx',
  },
};

async function driveDownload(env, fileId) {
  const metaRes = await googleFetch(
    env,
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size`,
  );
  const meta = await metaRes.json();
  const exportAs = DRIVE_EXPORTS[meta.mimeType];

  const url = exportAs
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportAs.mime)}`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  const res = await googleFetch(env, url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const name = exportAs && !meta.name.endsWith(exportAs.ext) ? `${meta.name}${exportAs.ext}` : meta.name;
  return { bytes, name, mimeType: exportAs ? exportAs.mime : meta.mimeType };
}

// الرفع على مرحلتين: المحتوى أولاً ثم البيانات الوصفية — أبسط من multipart/related
async function driveUpload(env, cfg, { bytes, name, mimeType }) {
  const createRes = await googleFetch(
    env,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=media&fields=id',
    { method: 'POST', headers: { 'content-type': mimeType || 'application/octet-stream' }, body: bytes },
  );
  const created = await createRes.json();

  const params = new URLSearchParams({ fields: 'id,name,webViewLink' });
  if (cfg.driveFolderId) params.set('addParents', cfg.driveFolderId);

  const patchRes = await googleFetch(
    env,
    `https://www.googleapis.com/drive/v3/files/${created.id}?${params}`,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) },
  );
  const data = await patchRes.json();
  return { id: data.id, الاسم: data.name, الحالة: 'تم الحفظ في درايف' };
}

// ═══════════════════════════════════════════════════════════
//  6. الأدوات المتاحة للنموذج
// ═══════════════════════════════════════════════════════════
// أسماء الأدوات ووسائطها بالإنجليزية لأن واجهة Gemini ترفض غير ASCII،
// والأوصاف بالعربية حتى يفهمها النموذج في سياق المحادثة.

const STR = { type: 'string' };

const TOOLS = [
  {
    name: 'get_current_time',
    permission: null,
    declaration: {
      name: 'get_current_time',
      description: 'يرجّع التاريخ والوقت الحالي بتوقيت المستخدم. استعمله قبل أي حساب زمني بدل التخمين.',
      parameters: { type: 'object', properties: {} },
    },
    run: async ({ cfg }) => ({ الآن: toLocalIso(Date.now(), cfg.offsetMin) }),
  },
  {
    name: 'list_events',
    permission: 'calendar_read',
    declaration: {
      name: 'list_events',
      description: 'يعرض المواعيد المسجلة في تقويم جوجل بين تاريخين.',
      parameters: {
        type: 'object',
        properties: {
          from: { ...STR, description: 'بداية الفترة بالتوقيت المحلي، صيغة YYYY-MM-DDTHH:mm' },
          to: { ...STR, description: 'نهاية الفترة بالتوقيت المحلي، صيغة YYYY-MM-DDTHH:mm' },
        },
        required: ['from', 'to'],
      },
    },
    run: async ({ env, cfg, args }) => calListEvents(
      env, cfg, parseLocal(args.from, cfg.offsetMin), parseLocal(args.to, cfg.offsetMin),
    ),
  },
  {
    name: 'create_event',
    permission: 'calendar_write',
    declaration: {
      name: 'create_event',
      description: 'يسجّل موعداً جديداً في تقويم جوجل.',
      parameters: {
        type: 'object',
        properties: {
          title: { ...STR, description: 'عنوان الموعد' },
          start: { ...STR, description: 'وقت البداية بالتوقيت المحلي، صيغة YYYY-MM-DDTHH:mm' },
          end: { ...STR, description: 'وقت النهاية (اختياري، الافتراضي ساعة)' },
          location: { ...STR, description: 'المكان (اختياري)' },
          description: { ...STR, description: 'تفاصيل إضافية (اختياري)' },
        },
        required: ['title', 'start'],
      },
    },
    run: async ({ env, cfg, args }) => calCreateEvent(env, cfg, {
      title: args.title,
      startMs: parseLocal(args.start, cfg.offsetMin),
      endMs: args.end ? parseLocal(args.end, cfg.offsetMin) : null,
      location: args.location,
      description: args.description,
    }),
  },
  {
    name: 'update_event',
    permission: 'calendar_write',
    declaration: {
      name: 'update_event',
      description: 'يعدّل موعداً موجوداً. جيب المعرّف من list_events أولاً.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { ...STR, description: 'معرّف الموعد' },
          title: STR,
          start: { ...STR, description: 'صيغة YYYY-MM-DDTHH:mm' },
          end: STR,
          location: STR,
        },
        required: ['event_id'],
      },
    },
    run: async ({ env, cfg, args }) => calUpdateEvent(env, cfg, {
      eventId: args.event_id,
      title: args.title,
      startMs: args.start ? parseLocal(args.start, cfg.offsetMin) : null,
      endMs: args.end ? parseLocal(args.end, cfg.offsetMin) : null,
      location: args.location,
    }),
  },
  {
    name: 'delete_event',
    permission: 'calendar_write',
    declaration: {
      name: 'delete_event',
      description: 'يحذف موعداً من التقويم باستعمال معرّفه.',
      parameters: {
        type: 'object',
        properties: { event_id: STR },
        required: ['event_id'],
      },
    },
    run: async ({ env, cfg, args }) => calDeleteEvent(env, cfg, args.event_id),
  },
  {
    name: 'create_reminder',
    permission: 'reminders',
    declaration: {
      name: 'create_reminder',
      description: 'يسجّل تذكيراً يتبعث للمستخدم على تليجرام في الوقت المحدد بالضبط.',
      parameters: {
        type: 'object',
        properties: {
          text: { ...STR, description: 'نص التذكير كما يقرأه المستخدم' },
          at: { ...STR, description: 'وقت الإرسال بالتوقيت المحلي، صيغة YYYY-MM-DDTHH:mm' },
          repeat: { ...STR, description: 'اختياري: تكرار التذكير', enum: ['daily', 'weekly', 'monthly'] },
        },
        required: ['text', 'at'],
      },
    },
    run: async ({ env, cfg, user, args }) => {
      const due = parseLocal(args.at, cfg.offsetMin);
      if (Number.isNaN(due)) return { خطأ: 'الوقت غير مفهوم. استعمل صيغة YYYY-MM-DDTHH:mm' };
      if (due < Date.now() - MINUTE) return { خطأ: 'الوقت هذا في الماضي.' };
      const res = await env.DB.prepare(
        'INSERT INTO reminders (user_id, text, due_at, repeat, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(user.id, args.text, due, args.repeat || null, Date.now()).run();
      return {
        id: res.meta?.last_row_id,
        النص: args.text,
        الوقت: formatArabic(due, cfg.offsetMin),
        التكرار: args.repeat || 'مرة واحدة',
        الحالة: 'تم التسجيل',
      };
    },
  },
  {
    name: 'list_reminders',
    permission: 'reminders',
    declaration: {
      name: 'list_reminders',
      description: 'يعرض التذكيرات القادمة المسجلة للمستخدم.',
      parameters: { type: 'object', properties: {} },
    },
    run: async ({ env, cfg, user }) => {
      const { results } = await env.DB.prepare(
        'SELECT id, text, due_at, repeat FROM reminders WHERE user_id = ? AND done = 0 ORDER BY due_at ASC LIMIT 30',
      ).bind(user.id).all();
      if (!results?.length) return { count: 0, نص: 'ما عندكش تذكيرات مسجلة.' };
      return {
        count: results.length,
        reminders: results.map((r) => ({
          id: r.id,
          النص: r.text,
          الوقت: formatArabic(r.due_at, cfg.offsetMin),
          التكرار: r.repeat || 'مرة واحدة',
        })),
      };
    },
  },
  {
    name: 'cancel_reminder',
    permission: 'reminders',
    declaration: {
      name: 'cancel_reminder',
      description: 'يلغي تذكيراً برقمه المعروض في list_reminders.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer', description: 'رقم التذكير' } },
        required: ['id'],
      },
    },
    run: async ({ env, user, args }) => {
      const res = await env.DB.prepare(
        'UPDATE reminders SET done = 1 WHERE id = ? AND user_id = ? AND done = 0',
      ).bind(args.id, user.id).run();
      return res.meta?.changes ? { الحالة: 'تم الإلغاء' } : { خطأ: 'ما لقيتش تذكير بالرقم هذا.' };
    },
  },
  {
    name: 'save_note',
    permission: null,
    declaration: {
      name: 'save_note',
      description: 'يحفظ معلومة يبي المستخدم يتذكّرها لاحقاً (رقم، عنوان، فكرة).',
      parameters: {
        type: 'object',
        properties: { text: STR },
        required: ['text'],
      },
    },
    run: async ({ env, user, args }) => {
      await env.DB.prepare('INSERT INTO notes (user_id, text, created_at) VALUES (?, ?, ?)')
        .bind(user.id, args.text, Date.now()).run();
      return { الحالة: 'تم الحفظ' };
    },
  },
  {
    name: 'list_notes',
    permission: null,
    declaration: {
      name: 'list_notes',
      description: 'يعرض الملاحظات المحفوظة للمستخدم.',
      parameters: { type: 'object', properties: {} },
    },
    run: async ({ env, cfg, user }) => {
      const { results } = await env.DB.prepare(
        'SELECT id, text, created_at FROM notes WHERE user_id = ? ORDER BY id DESC LIMIT 30',
      ).bind(user.id).all();
      if (!results?.length) return { count: 0, نص: 'ما عندكش ملاحظات محفوظة.' };
      return {
        count: results.length,
        notes: results.map((n) => ({
          id: n.id, النص: n.text, التاريخ: formatArabic(n.created_at, cfg.offsetMin),
        })),
      };
    },
  },
  {
    name: 'search_drive',
    permission: 'drive_read',
    declaration: {
      name: 'search_drive',
      description: 'يدوّر على ملفات في جوجل درايف بالاسم ويرجّع معرّفاتها.',
      parameters: {
        type: 'object',
        properties: { name: { ...STR, description: 'جزء من اسم الملف' } },
        required: ['name'],
      },
    },
    run: async ({ env, cfg, args }) => driveSearch(env, cfg, args.name),
  },
  {
    name: 'send_drive_file',
    permission: 'drive_read',
    declaration: {
      name: 'send_drive_file',
      description: 'ينزّل ملفاً من درايف ويبعثه للمستخدم في الشات. جيب المعرّف من search_drive أولاً.',
      parameters: {
        type: 'object',
        properties: { file_id: { ...STR, description: 'معرّف الملف في درايف' } },
        required: ['file_id'],
      },
    },
    run: async ({ env, args, outbox }) => {
      const file = await driveDownload(env, args.file_id);
      // يُرسل بعد نص الرد حتى يبقى ترتيب الرسائل منطقياً
      outbox.push(file);
      return { الحالة: 'الملف جاهز وبيتبعث توا', الاسم: file.name };
    },
  },
];

function toolsFor(user) {
  return TOOLS.filter((t) => !t.permission || can(user, t.permission))
    .map((t) => {
      const declaration = t.declaration;
      // Gemini يرفض مخطط OBJECT بخصائص فارغة ويرد بخطأ 400 على الطلب كله،
      // فالأداة اللي ما تاخذش وسائط تتبعث بدون parameters أصلاً
      const properties = declaration.parameters?.properties;
      if (declaration.parameters && Object.keys(properties || {}).length === 0) {
        const { parameters, ...rest } = declaration;
        return rest;
      }
      return declaration;
    });
}

async function runTool(name, args, ctx) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { خطأ: `أداة غير معروفة: ${name}` };
  if (tool.permission && !can(ctx.user, tool.permission)) {
    return { خطأ: 'الشخص هذا ما عندوش صلاحية للعملية هذي.' };
  }
  try {
    return await tool.run({ ...ctx, args: args || {} });
  } catch (err) {
    return { خطأ: err?.message || String(err) };
  }
}

// ═══════════════════════════════════════════════════════════
//  7. شخصية السكرتير
// ═══════════════════════════════════════════════════════════

function buildSystemPrompt(cfg, user, others) {
  const isOwner = user.role === 'owner';

  const abilities = [];
  if (can(user, 'calendar_read')) abilities.push('- تشوف المواعيد المسجلة في التقويم.');
  if (can(user, 'calendar_write')) abilities.push('- تسجّل موعد جديد، تعدّله، أو تلغيه.');
  if (can(user, 'reminders')) abilities.push('- تسجّل تذكيرات وتبعثها في وقتها بالضبط.');
  if (can(user, 'drive_read')) abilities.push('- تدوّر على ملف في جوجل درايف وتبعثه في الشات.');
  if (can(user, 'drive_write')) abilities.push('- تحفظ أي ملف يتبعثلك في جوجل درايف.');

  const peers = others.length
    ? `\n# ناس آخرين يستعملوك\n${others.map((o) => `  • ${o.name}${o.note ? ` (${o.note})` : ''}`).join('\n')}\n`
    : '';

  return `أنت "${cfg.botName}"، سكرتير شخصي ذكي تشتغل عبر تليجرام.

# مع من تتكلم توا
الاسم: ${user.name}
الصفة: ${isOwner ? 'صاحبك ومالك الحساب — هذا رئيسك المباشر.' : 'شخص موثوق مصرّح له يستعملك.'}
${user.note ? `ملاحظة عنه: ${user.note}` : ''}
${peers}
# الوقت
التاريخ والساعة توا: ${formatArabic(Date.now(), cfg.offsetMin)}
بصيغة رقمية: ${toLocalIso(Date.now(), cfg.offsetMin)}
أي كلام عن "بكرة" أو "بعد ساعتين" أو "يوم الخميس" احسبه من التاريخ هذا.

# اللهجة والأسلوب — مهم جداً
- تتكلم **ليبية** طبيعية، مش فصحى رسمية ولا لهجة خليجية أو مصرية.
- كلامك قصير ومباشر، زي رسالة شات حقيقية مش زي مقال. سطر أو سطرين يكفوا في الغالب.
- ما تستعملش تنسيق معقّد ولا عناوين ولا نقاط مرقّمة إلا إذا كانت قائمة فعلاً (مواعيد، ملفات).
- ما تعيدش السؤال قبل ما تجاوب، وما تقولش "أكيد!" و"بكل سرور" في كل رسالة.
- إيموجي بحساب: وحدة كل فترة، ومش في كل رسالة.
- إذا ما فهمتش المطلوب، اسأل سؤال واحد قصير يوضّح، مش قائمة أسئلة.

أمثلة على النبرة المطلوبة:
  المستخدم: "شن عندي بكرة؟"
  أنت: "بكرة عندك اجتماع مع سالم 10:30، وموعد الدكتور 5 العصر. يبي نذكّرك قبلهم بساعة؟"

  المستخدم: "سجلي موعد مع المحامي الخميس 4"
  أنت: "تمام، سجلته الخميس 4 العصر مع المحامي ✅"

  المستخدم: "شن رايك نبيع السيارة؟"
  أنت: "على حسب، لو محتاج الفلوس توا بيعها. أما لو لا، السوق توا نازل وأحسن تستنى شوية. تبي نحسبها معاك؟"

# شنو تقدر تعمل
${abilities.length ? abilities.join('\n') : '- تجاوب وتساعد بالكلام فقط (ما عندكش صلاحيات على التقويم والدرايف).'}
- تجاوب على أي سؤال عام: معلومات، ترجمة، صياغة رسالة، حساب، رأي، تلخيص.
- تفهم الرسائل الصوتية والصور والملفات اللي تتبعثلك.

# قواعد الشغل
1. إذا طلب منك حاجة تقدر تعملها بأداة — اعملها فوراً بدون ما تستأذن. ما تقولش "تبي نسجله؟" بعدين تستنى؛ سجّل وقول سجلته.
2. بعد أي عملية على التقويم أو الدرايف، أكّد النتيجة بكلمة قصيرة وواضحة.
3. ما تخترعش معلومات: إذا ما لقيتش ملف أو موعد، قول ما لقيتوش. ما تدّعيش إنك عملت حاجة ما عملتهاش.
4. المواعيد اللي ما فيهاش وقت واضح — اسأل عن الوقت قبل ما تسجل.
5. إذا الطلب خارج صلاحية الشخص اللي يكلمك، قوله بلطف إن هذا يحتاج إذن المالك.
${cfg.extraInstructions ? `\n# تعليمات خاصة من المالك\n${cfg.extraInstructions}\n` : ''}
اشتغل توا كسكرتير محترف يعرف صاحبه ويوفّر عليه وقته.`;
}

// ═══════════════════════════════════════════════════════════
//  8. العقل — Gemini مع حلقة استدعاء الأدوات
// ═══════════════════════════════════════════════════════════

async function askGemini(env, cfg, { systemPrompt, contents, tools }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`;
  const res = await fetch(`${url}?key=${encodeURIComponent(secret(env, 'GEMINI_API_KEY'))}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      tools: tools.length ? [{ functionDeclarations: tools }] : undefined,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini رفض الطلب (${res.status})`);
  }
  return data;
}

async function respond(env, cfg, user, others, text, media) {
  const history = (await recentMessages(env, user.id, DEFAULTS.MEMORY_TURNS)).map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  const parts = [];
  for (const item of media) parts.push({ inlineData: { mimeType: item.mimeType, data: item.data } });
  if (text) parts.push({ text });
  if (!parts.length) return { text: '', outbox: [] };

  const contents = [...history, { role: 'user', parts }];
  const systemPrompt = buildSystemPrompt(cfg, user, others);
  const tools = toolsFor(user);
  const ctx = { env, cfg, user, outbox: [] };

  let reply = '';

  for (let round = 0; round < DEFAULTS.MAX_TOOL_ROUNDS; round += 1) {
    const data = await askGemini(env, cfg, { systemPrompt, contents, tools });
    const responseParts = data.candidates?.[0]?.content?.parts || [];
    const calls = responseParts.filter((p) => p.functionCall).map((p) => p.functionCall);
    const said = responseParts.filter((p) => p.text).map((p) => p.text).join('').trim();

    if (!calls.length) {
      reply = said;
      break;
    }

    contents.push({ role: 'model', parts: responseParts });
    const toolResponses = [];
    for (const call of calls) {
      const output = await runTool(call.name, call.args, ctx);
      toolResponses.push({ functionResponse: { name: call.name, response: { result: output } } });
    }
    contents.push({ role: 'user', parts: toolResponses });

    // نحتفظ بآخر كلام قاله مع الأداة تحسباً لنفاد الجولات
    if (said) reply = said;
  }

  await recordMessage(env, user.id, 'user', text || '[رسالة صوتية أو ملف]');
  if (reply) await recordMessage(env, user.id, 'model', reply);

  return { text: reply, outbox: ctx.outbox };
}

// ═══════════════════════════════════════════════════════════
//  9. الأوامر وإدارة المستخدمين
// ═══════════════════════════════════════════════════════════

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

const HELP = `الأوامر المتاحة:

/دعوة — توليد كود دعوة لشخص جديد (للمالك)
/القائمة — عرض المستخدمين المصرّح لهم (للمالك)
/حذف <الرقم> — إزالة شخص (للمالك)
/حالة — حالة البوت والربط
/مسح — مسح ذاكرة المحادثة
/مساعدة — هذه القائمة

غير هذا، كلّمني عادي بالنص أو بالصوت.`;

async function handleCommand(env, cfg, user, chatId, text) {
  const [command, ...rest] = text.trim().split(/\s+/);
  const isOwner = user.role === 'owner';

  switch (command) {
    case '/مساعدة':
    case '/help':
    case '/start':
      await sendMessage(env, chatId, `أهلاً ${user.name} 👋\n\n${HELP}`);
      return true;

    case '/مسح':
    case '/clear':
      await env.DB.prepare('DELETE FROM messages WHERE user_id = ?').bind(user.id).run();
      await sendMessage(env, chatId, 'مسحت المحادثة، بنبداو من جديد 🧹');
      return true;

    case '/حالة':
    case '/status': {
      const googleLinked = Boolean(await getSetting(env, 'google_refresh_token'));
      const { results } = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM reminders WHERE user_id = ? AND done = 0',
      ).bind(user.id).all();
      await sendMessage(env, chatId, [
        `الاسم: ${cfg.botName}`,
        `صفتك: ${isOwner ? 'المالك' : 'عضو'}`,
        `جوجل (تقويم ودرايف): ${googleLinked ? 'مربوط ✅' : 'غير مربوط ❌'}`,
        `تذكيراتك المعلّقة: ${results?.[0]?.n ?? 0}`,
        `النموذج: ${cfg.model}`,
        `الوقت عندي: ${formatArabic(Date.now(), cfg.offsetMin)}`,
      ].join('\n'));
      return true;
    }

    case '/دعوة':
    case '/invite': {
      if (!isOwner) {
        await sendMessage(env, chatId, 'الأمر هذا للمالك بس.');
        return true;
      }
      const code = randomCode();
      const expires = Date.now() + 24 * 3_600_000;
      await env.DB.prepare('INSERT INTO invites (code, expires_at) VALUES (?, ?)')
        .bind(code, expires).run();
      await sendMessage(env, chatId,
        `كود الدعوة: ${code}\n\nخلّي الشخص يفتح البوت ويبعت الكود هذا كرسالة.\nصالح 24 ساعة ومرة وحدة بس.`);
      return true;
    }

    case '/القائمة':
    case '/users': {
      if (!isOwner) {
        await sendMessage(env, chatId, 'الأمر هذا للمالك بس.');
        return true;
      }
      const all = await listUsers(env);
      const lines = all.map((u) => `• ${u.name} — ${u.role === 'owner' ? 'المالك' : 'عضو'} (${u.id})`);
      await sendMessage(env, chatId, `المصرّح لهم (${all.length}):\n${lines.join('\n')}`);
      return true;
    }

    case '/حذف':
    case '/remove': {
      if (!isOwner) {
        await sendMessage(env, chatId, 'الأمر هذا للمالك بس.');
        return true;
      }
      const target = Number(rest[0]);
      if (!target) {
        await sendMessage(env, chatId, 'اكتب: /حذف <رقم الشخص>\nتشوف الأرقام بأمر /القائمة');
        return true;
      }
      if (target === user.id) {
        await sendMessage(env, chatId, 'ما تقدرش تحذف نفسك.');
        return true;
      }
      const res = await env.DB.prepare("DELETE FROM users WHERE id = ? AND role != 'owner'")
        .bind(target).run();
      await sendMessage(env, chatId, res.meta?.changes ? 'تم الحذف ✅' : 'ما لقيتش الشخص هذا.');
      return true;
    }

    default:
      return false;
  }
}

// تسجيل شخص جديد: المالك عبر كلمة الإعداد، والأعضاء عبر كود دعوة
async function tryRegister(env, from, chatId, text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;

  const displayName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'مستخدم';

  if (secret(env, 'SETUP_SECRET') && trimmed === secret(env, 'SETUP_SECRET')) {
    if (await ownerExists(env)) {
      await sendMessage(env, chatId, 'فما مالك مسجّل قبل. استعمل كود دعوة من المالك.');
      return true;
    }
    await addUser(env, { id: from.id, name: displayName, role: 'owner' });
    await sendMessage(env, chatId,
      `أهلاً ${displayName} 👋\nتم تسجيلك كمالك للبوت.\n\n${HELP}`);
    return true;
  }

  const invite = await env.DB.prepare(
    'SELECT * FROM invites WHERE code = ? AND used_by IS NULL AND expires_at > ?',
  ).bind(trimmed.toUpperCase(), Date.now()).first();

  if (invite) {
    await addUser(env, { id: from.id, name: displayName, role: 'member' });
    await env.DB.prepare('UPDATE invites SET used_by = ? WHERE code = ?')
      .bind(from.id, invite.code).run();
    await sendMessage(env, chatId,
      `أهلاً ${displayName} 👋\nتم تسجيلك. كلّمني عادي بالنص أو بالصوت.`);
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════
//  10. معالجة الرسائل
// ═══════════════════════════════════════════════════════════

// يستخرج المرفق ويرجّعه بالشكل اللي يفهمه Gemini
async function extractMedia(env, message) {
  if (message.voice) {
    return { fileId: message.voice.file_id, mimeType: 'audio/ogg', name: 'voice.ogg', toModel: true };
  }
  if (message.audio) {
    return {
      fileId: message.audio.file_id,
      mimeType: message.audio.mime_type || 'audio/mpeg',
      name: message.audio.file_name || 'audio.mp3',
      toModel: true,
    };
  }
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    return { fileId: largest.file_id, mimeType: 'image/jpeg', name: 'photo.jpg', toModel: true };
  }
  if (message.document) {
    const mime = message.document.mime_type || 'application/octet-stream';
    return {
      fileId: message.document.file_id,
      mimeType: mime,
      name: message.document.file_name || 'file',
      // Gemini يفهم الصور وملفات PDF مباشرة؛ الباقي يتحفظ بس
      toModel: mime === 'application/pdf' || mime.startsWith('image/'),
      isDocument: true,
    };
  }
  return null;
}

async function handleUpdate(env, update) {
  const cfg = settings(env);
  const message = update.message || update.edited_message;
  if (!message?.from || message.from.is_bot) return;

  const chatId = message.chat.id;
  // مجموعات تليجرام خارج نطاق السكرتير الشخصي
  if (message.chat.type !== 'private') return;

  const text = (message.text || message.caption || '').trim();
  let user = await getUser(env, message.from.id);

  if (!user) {
    const registered = await tryRegister(env, message.from, chatId, text);
    if (!registered) {
      console.log(`unauthorized: id=${message.from.id} name=${message.from.first_name}`);
    }
    return;
  }

  if (text.startsWith('/') && (await handleCommand(env, cfg, user, chatId, text))) return;

  if (!(await consumeRate(env, user.id, DEFAULTS.HOURLY_LIMIT))) {
    console.log(`rate limited: ${user.id}`);
    return;
  }

  await sendTyping(env, chatId);

  const attachment = await extractMedia(env, message);
  const modelMedia = [];
  const notes = [];

  if (attachment) {
    const bytes = await downloadTelegramFile(env, attachment.fileId);
    if (!bytes) {
      await sendMessage(env, chatId, 'ما قدرتش ننزّل الملف. جرّب تبعتّه من جديد.');
      return;
    }

    if (attachment.toModel && bytes.length <= DEFAULTS.MAX_MODEL_FILE_BYTES) {
      modelMedia.push({ mimeType: attachment.mimeType, data: toBase64(bytes) });
    }

    // أرشفة الملفات في درايف لمن عنده صلاحية
    if (attachment.isDocument && can(user, 'drive_write') && await getSetting(env, 'google_refresh_token')) {
      try {
        const saved = await driveUpload(env, cfg, {
          bytes, name: attachment.name, mimeType: attachment.mimeType,
        });
        notes.push(`تم حفظ الملف "${saved.الاسم}" في جوجل درايف تلقائياً.`);
      } catch (err) {
        notes.push(`فشل حفظ الملف في درايف: ${err.message}`);
      }
    }
  }

  let prompt = text;
  if (notes.length) {
    prompt = `${prompt}\n\n[النظام: ${notes.join(' ')} أخبر المستخدم بذلك باختصار.]`.trim();
  }
  if (!prompt && !modelMedia.length) return;

  const others = (await listUsers(env)).filter((u) => u.id !== user.id);

  let result;
  try {
    result = await respond(env, cfg, user, others, prompt, modelMedia);
  } catch (err) {
    console.log('respond failed:', err.stack || err.message);
    // المالك يشوف السبب التقني مباشرة بدل ما يدوّر في السجلات
    const detail = user.role === 'owner' ? `\n\n🔧 ${String(err.message).slice(0, 300)}` : '';
    await sendMessage(env, chatId, `صار عندي خلل تقني، جرّب تبعتلي من جديد بعد شوية 🙏${detail}`);
    return;
  }

  if (result.text) await sendMessage(env, chatId, result.text);

  for (const file of result.outbox) {
    try {
      await sendDocument(env, chatId, file);
    } catch (err) {
      await sendMessage(env, chatId, `ما قدرتش نبعتلك ${file.name} — ${err.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  11. التذكيرات المجدولة
// ═══════════════════════════════════════════════════════════

async function runDueReminders(env) {
  const cfg = settings(env);
  const { results } = await env.DB.prepare(
    'SELECT * FROM reminders WHERE done = 0 AND due_at <= ? ORDER BY due_at ASC LIMIT 50',
  ).bind(Date.now()).all();

  for (const reminder of results || []) {
    try {
      await sendMessage(env, reminder.user_id, `⏰ تذكير: ${reminder.text}`);
      await settleReminder(env, reminder, cfg);
    } catch (err) {
      console.log(`reminder ${reminder.id} failed:`, err.message);
      // يبقى معلّق ليتعاود بعد دقيقة، لكن ما يتعاودش للأبد:
      // فشل دائم (البوت محظور مثلاً) ينتهي بعد MAX_DELIVERY_ATTEMPTS
      const attempts = (reminder.attempts || 0) + 1;
      if (attempts >= DEFAULTS.MAX_DELIVERY_ATTEMPTS) {
        await env.DB.prepare('UPDATE reminders SET done = 1, attempts = ? WHERE id = ?')
          .bind(attempts, reminder.id).run();
        console.log(`reminder ${reminder.id} أُسقط بعد ${attempts} محاولات`);
      } else {
        await env.DB.prepare('UPDATE reminders SET attempts = ? WHERE id = ?')
          .bind(attempts, reminder.id).run();
      }
    }
  }
}

async function settleReminder(env, reminder, cfg) {
  if (reminder.repeat === 'monthly') {
    const local = new Date(reminder.due_at + cfg.offsetMin * MINUTE);
    const day = local.getUTCDate();
    // بدون التثبيت على أول الشهر، تذكير يوم 31 يناير يقفز لـ3 مارس ويتخطى فبراير
    local.setUTCDate(1);
    local.setUTCMonth(local.getUTCMonth() + 1);
    const lastDayOfMonth = new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0),
    ).getUTCDate();
    local.setUTCDate(Math.min(day, lastDayOfMonth));
    const next = local.getTime() - cfg.offsetMin * MINUTE;
    await env.DB.prepare('UPDATE reminders SET due_at = ?, attempts = 0 WHERE id = ?')
      .bind(next, reminder.id).run();
    return;
  }
  const days = { daily: 1, weekly: 7 }[reminder.repeat];
  if (days) {
    await env.DB.prepare('UPDATE reminders SET due_at = ?, attempts = 0 WHERE id = ?')
      .bind(reminder.due_at + days * 86_400_000, reminder.id).run();
    return;
  }
  await env.DB.prepare('UPDATE reminders SET done = 1 WHERE id = ?').bind(reminder.id).run();
}

// ═══════════════════════════════════════════════════════════
//  12. صفحة الإعداد (من المتصفح، بدون حاسوب)
// ═══════════════════════════════════════════════════════════

function page(body) {
  return new Response(
    `<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>إعداد سند</title><style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:640px;margin:0 auto;
padding:24px 16px;line-height:1.7;background:#fbfbfa;color:#1a1a19}
@media(prefers-color-scheme:dark){body{background:#191918;color:#e8e8e6}}
h1{font-size:1.5rem;margin:0 0 4px}
.sub{opacity:.65;margin:0 0 24px;font-size:.9rem}
.row{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:10px;
background:#fff;border:1px solid #e5e5e3;margin-bottom:8px}
@media(prefers-color-scheme:dark){.row{background:#222221;border-color:#35352f}}
.ok{color:#217a4b}.bad{color:#b3322a}
a.btn{display:block;text-align:center;padding:13px;border-radius:10px;background:#c8613f;
color:#fff;text-decoration:none;font-weight:600;margin:8px 0}
code{background:#efefec;padding:2px 6px;border-radius:5px;font-size:.85em;word-break:break-all}
@media(prefers-color-scheme:dark){code{background:#2c2c2a}}
</style></head><body>${body}</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

async function setupPage(env, url) {
  const key = url.searchParams.get('key');
  const base = `${url.origin}`;

  let tablesReady = true;
  let users = [];
  try {
    users = await listUsers(env);
  } catch {
    tablesReady = false;
  }

  const googleLinked = tablesReady && Boolean(await getSetting(env, 'google_refresh_token'));
  const hooked = tablesReady && Boolean(await getSetting(env, 'webhook_set'));
  const mark = (v) => (v ? '<span class="ok">✅</span>' : '<span class="bad">❌</span>');

  return page(`
<h1>إعداد سند</h1>
<p class="sub">اتبع الخطوات بالترتيب. كلها من الجوال.</p>

<div class="row">${mark(tablesReady)} <span>قاعدة البيانات</span></div>
<div class="row">${mark(hooked)} <span>ربط تليجرام</span></div>
<div class="row">${mark(googleLinked)} <span>ربط جوجل (تقويم ودرايف)</span></div>
<div class="row">${mark(users.length > 0)} <span>المستخدمون المسجّلون: ${users.length}</span></div>

${!tablesReady ? `<a class="btn" href="/setup/init?key=${key}">1. إنشاء قاعدة البيانات</a>` : ''}
${tablesReady && !hooked ? `<a class="btn" href="/setup/webhook?key=${key}">2. تفعيل بوت تليجرام</a>` : ''}
${tablesReady ? `<a class="btn" href="/auth/google?key=${key}">${googleLinked ? 'إعادة ربط جوجل' : '3. ربط جوجل'}</a>` : ''}

<p class="sub">رابط التحويل المطلوب في إعدادات جوجل:<br><code>${base}/auth/callback</code></p>
${users.length === 0 && hooked
    ? '<p class="sub">الخطوة الأخيرة: افتح البوت في تليجرام وابعتله <b>كلمة الإعداد</b> (قيمة SETUP_SECRET) حتى تتسجّل كمالك.</p>'
    : ''}
`);
}

// ═══════════════════════════════════════════════════════════
//  13. المسارات
// ═══════════════════════════════════════════════════════════

function authorized(env, url) {
  return Boolean(secret(env, 'SETUP_SECRET')) && url.searchParams.get('key') === secret(env, 'SETUP_SECRET');
}

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // ── مسار تليجرام ──
  if (path === '/webhook' && request.method === 'POST') {
    const token = request.headers.get('x-telegram-bot-api-secret-token');
    if (token !== secret(env, 'SETUP_SECRET')) return new Response('forbidden', { status: 403 });

    const update = await request.json();
    // نرد فوراً حتى ما يعيدش تليجرام إرسال التحديث، والشغل يكمل في الخلفية
    ctx.waitUntil(
      handleUpdate(env, update).catch((err) => console.log('handleUpdate failed:', err.stack || err.message)),
    );
    return new Response('ok');
  }

  // ── صفحات الإعداد ──
  if (path === '/setup') {
    if (!authorized(env, url)) return new Response('غير مصرّح', { status: 403 });
    return setupPage(env, url);
  }

  if (path === '/setup/init') {
    if (!authorized(env, url)) return new Response('غير مصرّح', { status: 403 });
    try {
      await initSchema(env);
      return page('<h1>✅ تم إنشاء قاعدة البيانات</h1><a class="btn" href="javascript:history.back()">رجوع</a>');
    } catch (err) {
      return page(`<h1>❌ فشل الإنشاء</h1><p><code>${err.message}</code></p>
<p class="sub">تأكد إنك ربطت قاعدة بيانات D1 باسم <code>DB</code> في إعدادات الـ Worker.</p>`);
    }
  }

  if (path === '/setup/webhook') {
    if (!authorized(env, url)) return new Response('غير مصرّح', { status: 403 });
    const result = await tgCall(env, 'setWebhook', {
      url: `${url.origin}/webhook`,
      secret_token: secret(env, 'SETUP_SECRET'),
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    if (result.ok) await putSetting(env, 'webhook_set', String(Date.now()));
    return page(result.ok
      ? '<h1>✅ تم تفعيل بوت تليجرام</h1><p>افتح البوت وابعتله كلمة الإعداد.</p><a class="btn" href="javascript:history.back()">رجوع</a>'
      : `<h1>❌ فشل التفعيل</h1><p><code>${result.description}</code></p>
<p class="sub">تأكد من صحة TELEGRAM_BOT_TOKEN.</p>`);
  }

  // ── ربط جوجل ──
  if (path === '/auth/google') {
    if (!authorized(env, url)) return new Response('غير مصرّح', { status: 403 });
    if (!secret(env, 'GOOGLE_CLIENT_ID')) return page('<h1>❌ GOOGLE_CLIENT_ID غير موجود</h1>');

    const params = new URLSearchParams({
      client_id: secret(env, 'GOOGLE_CLIENT_ID'),
      redirect_uri: `${url.origin}/auth/callback`,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state: secret(env, 'SETUP_SECRET'),
    });
    return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
  }

  if (path === '/auth/callback') {
    const code = url.searchParams.get('code');
    if (url.searchParams.get('state') !== secret(env, 'SETUP_SECRET')) {
      return new Response('غير مصرّح', { status: 403 });
    }
    if (!code) return page(`<h1>❌ فشل الربط</h1><p><code>${url.searchParams.get('error') || 'لا يوجد كود'}</code></p>`);

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: secret(env, 'GOOGLE_CLIENT_ID'),
        client_secret: secret(env, 'GOOGLE_CLIENT_SECRET'),
        redirect_uri: `${url.origin}/auth/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const data = await res.json();

    if (!data.refresh_token) {
      return page(`<h1>❌ ما وصلش رمز التجديد</h1>
<p class="sub">احذف صلاحية التطبيق من حسابك في جوجل ثم أعد المحاولة.</p>
<p><code>${data.error_description || data.error || ''}</code></p>`);
    }

    await putSetting(env, 'google_refresh_token', data.refresh_token);
    return page('<h1>✅ تم ربط جوجل بنجاح</h1><p>التقويم والدرايف جاهزين توا.</p>');
  }

  return new Response('سند شغّال ✅', { status: 200 });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      console.log('request failed:', err.stack || err.message);
      return new Response('خطأ داخلي', { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runDueReminders(env).catch((err) => console.log('reminders failed:', err.stack || err.message)),
    );
  },
};
