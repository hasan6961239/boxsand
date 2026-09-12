'use strict';
const fs = require('fs');
const path = require('path');
const { db, DB_PATH, DATA_DIR, log, getSetting, setSetting } = require('../db');
const { HttpError } = require('../http');
const { requirePerm, requireAuth, hashPassword, PERMISSIONS } = require('../auth');

const DEFAULT_SETTINGS = {
  pharmacy_name: 'صيدلية النور',
  pharmacy_phone: '',
  pharmacy_address: '',
  currency: 'د.ل',
  invoice_prefix: 'ف',
  receipt_footer: 'شكراً لزيارتكم — نتمنى لكم دوام الصحة والعافية',
  expiry_alert_days: '90',
  low_stock_alert: '1',
  print_logo: '',
  allow_negative_stock: '0',
  default_profit_margin: '25'
};

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key !== 'held_sales' && r.key !== 'invoice_seq') out[r.key] = r.value;
  return out;
}

function saveSettings(ctx) {
  const user = requirePerm(ctx, '*');
  const body = ctx.body || {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'invoice_seq' || k === 'held_sales') continue;
    setSetting(k, v);
  }
  log(user, 'settings.update', Object.keys(body));
  return getSettings();
}

// ---- المستخدمون ----------------------------------------------------------
function listUsers(ctx) {
  requirePerm(ctx, '*');
  return db.prepare('SELECT id,username,full_name,role,active,created_at FROM users ORDER BY id').all();
}

function saveUser(ctx) {
  const admin = requirePerm(ctx, '*');
  const b = ctx.body || {};
  if (!b.full_name) throw new HttpError(400, 'الاسم الكامل مطلوب');
  if (!['admin', 'pharmacist', 'cashier'].includes(b.role)) throw new HttpError(400, 'الصلاحية غير صحيحة');

  if (b.id) {
    const existing = db.prepare('SELECT * FROM users WHERE id=?').get(b.id);
    if (!existing) throw new HttpError(404, 'المستخدم غير موجود');
    if (existing.role === 'admin' && b.role !== 'admin') {
      const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get().n;
      if (admins <= 1) throw new HttpError(400, 'لا يمكن إزالة آخر مدير للنظام');
    }
    db.prepare('UPDATE users SET full_name=?, role=?, active=? WHERE id=?')
      .run(b.full_name, b.role, b.active === 0 ? 0 : 1, b.id);
    if (b.password) {
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(b.password), b.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(b.id);
    }
    log(admin, 'user.update', { id: b.id });
    return { ok: true, id: b.id };
  }

  if (!b.username || !b.password) throw new HttpError(400, 'اسم المستخدم وكلمة المرور مطلوبان');
  if (String(b.password).length < 4) throw new HttpError(400, 'كلمة المرور قصيرة جداً');
  const dup = db.prepare('SELECT id FROM users WHERE username=?').get(String(b.username).trim());
  if (dup) throw new HttpError(400, 'اسم المستخدم موجود مسبقاً');
  const info = db.prepare('INSERT INTO users(username,password_hash,full_name,role,active) VALUES(?,?,?,?,1)')
    .run(String(b.username).trim(), hashPassword(b.password), b.full_name, b.role);
  log(admin, 'user.create', { id: info.lastInsertRowid, username: b.username });
  return { ok: true, id: info.lastInsertRowid };
}

function deleteUser(ctx) {
  const admin = requirePerm(ctx, '*');
  const id = Number(ctx.params.id);
  if (id === admin.id) throw new HttpError(400, 'لا يمكنك حذف حسابك الحالي');
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) throw new HttpError(404, 'المستخدم غير موجود');
  if (u.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get().n;
    if (admins <= 1) throw new HttpError(400, 'لا يمكن حذف آخر مدير للنظام');
  }
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  log(admin, 'user.disable', { id });
  return { ok: true };
}

function changeOwnPassword(ctx) {
  const user = requireAuth(ctx);
  const { old_password, new_password } = ctx.body || {};
  const { verifyPassword } = require('../auth');
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  if (!verifyPassword(old_password, row.password_hash)) throw new HttpError(400, 'كلمة المرور الحالية غير صحيحة');
  if (!new_password || String(new_password).length < 4) throw new HttpError(400, 'كلمة المرور الجديدة قصيرة جداً');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(new_password), user.id);
  log(user, 'user.password_change', { id: user.id });
  return { ok: true };
}

// ---- النسخ الاحتياطي -----------------------------------------------------
function backupsDir() {
  const d = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

async function createBackup(ctx) {
  const user = requirePerm(ctx, '*');
  const dir = backupsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `backup-${stamp}.db`);
  await db.backup(file);            // db.backup غير متزامنة في better-sqlite3
  log(user, 'backup.create', { file: path.basename(file) });
  const st = fs.statSync(file);
  return { ok: true, file: path.basename(file), size: st.size, at: new Date().toISOString() };
}

function listBackups(ctx) {
  requirePerm(ctx, '*');
  const dir = backupsDir();
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

function downloadBackup(ctx) {
  requirePerm(ctx, '*');
  const file = path.basename(ctx.params.file);
  const full = path.join(backupsDir(), file);
  if (!fs.existsSync(full)) throw new HttpError(404, 'الملف غير موجود');
  const buf = fs.readFileSync(full);
  ctx.res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${file}"`,
    'Content-Length': buf.length
  });
  ctx.res.end(buf);
}

async function restoreBackup(ctx) {
  const user = requirePerm(ctx, '*');
  const file = path.basename((ctx.body || {}).file || '');
  const full = path.join(backupsDir(), file);
  if (!fs.existsSync(full)) throw new HttpError(404, 'ملف النسخة غير موجود');
  // نسخة أمان قبل الاستعادة
  const safety = path.join(backupsDir(), `pre-restore-${Date.now()}.db`);
  await db.backup(safety);
  log(user, 'backup.restore', { file });
  db.close();
  fs.copyFileSync(full, DB_PATH);
  try { fs.unlinkSync(DB_PATH + '-wal'); } catch (e) {}
  try { fs.unlinkSync(DB_PATH + '-shm'); } catch (e) {}
  console.log('[استعادة] تمت الاستعادة من', file, '— سيتم إعادة تشغيل الخادم');
  void user;
  setTimeout(() => process.exit(0), 300);
  return { ok: true, message: 'تمت الاستعادة — أعد تشغيل المنظومة' };
}

function activityLog(ctx) {
  requirePerm(ctx, '*');
  const limit = Number(ctx.query.limit || 200);
  return db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').all(limit);
}

// ---- تصدير CSV -----------------------------------------------------------
function toCsv(rows, headers) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const keys = headers ? headers.map((h) => h.key) : Object.keys(rows[0] || {});
  const titles = headers ? headers.map((h) => h.title) : keys;
  const lines = ['﻿' + titles.join(',')];
  for (const r of rows) lines.push(keys.map((k) => esc(r[k])).join(','));
  return lines.join('\r\n');
}

function exportCsv(ctx) {
  requirePerm(ctx, 'reports.view');
  const { rows, headers, filename } = ctx.body || {};
  if (!Array.isArray(rows)) throw new HttpError(400, 'لا توجد بيانات للتصدير');
  const csv = toCsv(rows, headers);
  const buf = Buffer.from(csv, 'utf8');
  ctx.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(filename || 'export')}.csv"`,
    'Content-Length': buf.length
  });
  ctx.res.end(buf);
}

module.exports = {
  getSettings, saveSettings, DEFAULT_SETTINGS,
  listUsers, saveUser, deleteUser, changeOwnPassword,
  createBackup, listBackups, downloadBackup, restoreBackup,
  activityLog, exportCsv, toCsv
};
