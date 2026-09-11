import { db } from '../db.js';
import { config } from '../config.js';

function fmt(ms) {
  return new Intl.DateTimeFormat('ar-LY', {
    timeZone: config.env.timezone,
    weekday: 'short', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms));
}

// The model sends local wall-clock time ("2026-09-12T17:00:00"); resolve it
// against the configured timezone instead of the server's.
export function parseLocal(value) {
  if (!value) return NaN;
  const bare = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value);
  if (!bare) return new Date(value).getTime();

  const guess = new Date(`${value}Z`).getTime();
  const offset = timezoneOffsetMs(guess);
  return guess - offset;
}

function timezoneOffsetMs(atMs) {
  const date = new Date(atMs);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.env.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  const asUtc = Date.UTC(+get('year'), +get('month') - 1, +get('day'), +get('hour'), +get('minute'), +get('second'));
  return asUtc - date.getTime();
}

export function createReminder({ phone, text, at, repeat }) {
  const due = parseLocal(at);
  if (Number.isNaN(due)) return { خطأ: 'الوقت غير مفهوم. ابعثه بصيغة YYYY-MM-DDTHH:mm' };
  if (due < Date.now() - 60_000) return { خطأ: 'الوقت هذا في الماضي.' };

  const info = db
    .prepare('INSERT INTO reminders (phone, text, due_at, repeat, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(phone, text, due, repeat || null, Date.now());

  return { id: info.lastInsertRowid, النص: text, الوقت: fmt(due), التكرار: repeat || 'مرة واحدة', الحالة: 'تم التسجيل' };
}

export function listReminders({ phone }) {
  const rows = db
    .prepare('SELECT id, text, due_at, repeat FROM reminders WHERE phone = ? AND done = 0 ORDER BY due_at ASC LIMIT 30')
    .all(phone);
  if (!rows.length) return { count: 0, نص: 'ما عندكش تذكيرات مسجلة.' };
  return {
    count: rows.length,
    reminders: rows.map((r) => ({ id: r.id, النص: r.text, الوقت: fmt(r.due_at), التكرار: r.repeat || 'مرة واحدة' })),
  };
}

export function cancelReminder({ phone, id }) {
  const info = db.prepare('UPDATE reminders SET done = 1 WHERE id = ? AND phone = ? AND done = 0').run(id, phone);
  return info.changes ? { الحالة: 'تم الإلغاء' } : { خطأ: 'ما لقيتش تذكير بالرقم هذا.' };
}

export function dueReminders(now = Date.now()) {
  return db.prepare('SELECT * FROM reminders WHERE done = 0 AND due_at <= ? ORDER BY due_at ASC').all(now);
}

const REPEAT_STEP = { daily: 1, weekly: 7 };

export function settleReminder(reminder) {
  if (reminder.repeat === 'monthly') {
    const next = new Date(reminder.due_at);
    next.setMonth(next.getMonth() + 1);
    db.prepare('UPDATE reminders SET due_at = ? WHERE id = ?').run(next.getTime(), reminder.id);
    return;
  }
  const days = REPEAT_STEP[reminder.repeat];
  if (days) {
    db.prepare('UPDATE reminders SET due_at = ? WHERE id = ?')
      .run(reminder.due_at + days * 86_400_000, reminder.id);
    return;
  }
  db.prepare('UPDATE reminders SET done = 1 WHERE id = ?').run(reminder.id);
}

export function saveNote({ phone, text }) {
  db.prepare('INSERT INTO notes (phone, text, created_at) VALUES (?, ?, ?)').run(phone, text, Date.now());
  return { الحالة: 'تم الحفظ' };
}

export function listNotes({ phone }) {
  const rows = db
    .prepare('SELECT id, text, created_at FROM notes WHERE phone = ? ORDER BY id DESC LIMIT 30')
    .all(phone);
  return rows.length
    ? { count: rows.length, notes: rows.map((r) => ({ id: r.id, النص: r.text, التاريخ: fmt(r.created_at) })) }
    : { count: 0, نص: 'ما عندكش ملاحظات محفوظة.' };
}
