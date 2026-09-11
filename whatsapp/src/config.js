import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'config', 'config.json');

if (!fs.existsSync(configPath)) {
  console.error('\n✖ لم يتم العثور على config/config.json');
  console.error('  انسخ القالب أولاً:  cp config/config.example.json config/config.json\n');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Normalise a phone number to bare digits so "+218 91-234" and "21891234" match.
export function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

const owner = {
  phone: normalizePhone(raw.المالك?.الرقم),
  name: raw.المالك?.الاسم || 'المالك',
  role: 'المالك',
  note: '',
};

if (!owner.phone) {
  console.error('\n✖ رقم المالك غير محدد في config/config.json\n');
  process.exit(1);
}

const members = (raw.المستخدمون || [])
  .map((u) => ({
    phone: normalizePhone(u.الرقم),
    name: u.الاسم || 'مستخدم',
    role: u.الصلاحية || 'عضو',
    note: u.ملاحظة || '',
  }))
  .filter((u) => u.phone && u.phone !== owner.phone);

const behaviour = raw.السلوك || {};
const workHours = behaviour.ساعات_العمل || {};

export const config = {
  root,
  owner,
  users: [owner, ...members],
  permissions: raw.الصلاحيات || {},
  extraInstructions: raw.تعليمات_إضافية || '',
  behaviour: {
    botName: behaviour.اسم_السكرتير || 'السكرتير',
    dialect: behaviour.اللهجة || 'ليبية',
    replyDelaySec: behaviour.تأخير_الرد_ثواني || [2, 6],
    debounceSec: behaviour.مهلة_تجميع_الرسائل_ثواني ?? 7,
    showTyping: behaviour.إظهار_يكتب !== false,
    replyToGroups: behaviour.الرد_على_المجموعات === true,
    memoryTurns: behaviour.عدد_رسائل_الذاكرة ?? 30,
    hourlyLimit: behaviour.حد_الرسائل_في_الساعة ?? 40,
    autoSaveFiles: behaviour.حفظ_الملفات_الواردة_تلقائياً !== false,
    workHours: {
      enabled: workHours.مفعّلة === true,
      from: workHours.من || '08:00',
      to: workHours.إلى || '23:00',
      message: workHours.رسالة_خارج_الدوام || 'مش متاح توا، بنرد عليك قريب.',
    },
  },
  env: {
    geminiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
    driveFolderId: process.env.DRIVE_FOLDER_ID || '',
    calendarId: process.env.CALENDAR_ID || 'primary',
    timezone: process.env.TZ || 'Africa/Tripoli',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  paths: {
    data: path.join(root, 'data'),
    auth: path.join(root, 'data', 'auth'),
    db: path.join(root, 'data', 'boxsand.db'),
    tmp: path.join(root, 'data', 'tmp'),
  },
};

for (const dir of [config.paths.data, config.paths.auth, config.paths.tmp]) {
  fs.mkdirSync(dir, { recursive: true });
}

export function findUser(phone) {
  const digits = normalizePhone(phone);
  return config.users.find((u) => u.phone === digits) || null;
}

export function can(user, permission) {
  if (!user) return false;
  const set = config.permissions[user.role] || config.permissions['عضو'] || {};
  return set[permission] === true;
}

export const googleReady = Boolean(
  config.env.googleClientId && config.env.googleClientSecret && config.env.googleRefreshToken,
);
