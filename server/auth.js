'use strict';
const crypto = require('crypto');
const { db, log } = require('./db');
const { HttpError } = require('./http');

const SESSION_DAYS = 30;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, salt, expected] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const actual = crypto.scryptSync(String(password), salt, 32).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch (e) {
    return false;
  }
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, expires);
  // تنظيف الجلسات المنتهية
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  return token;
}

function userFromToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`
    )
    .get(token, new Date().toISOString());
  return row || null;
}

function tokenFromRequest(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

// صلاحيات الأدوار
const PERMISSIONS = {
  admin: ['*'],
  pharmacist: [
    'pos', 'sales.view', 'sales.return', 'products.view', 'products.edit',
    'purchases.view', 'purchases.edit', 'suppliers.view', 'suppliers.edit',
    'customers.view', 'customers.edit', 'reports.view', 'expenses.view', 'stock.adjust'
  ],
  cashier: ['pos', 'sales.view', 'products.view', 'customers.view', 'customers.edit']
};

function can(user, perm) {
  if (!user) return false;
  const list = PERMISSIONS[user.role] || [];
  return list.includes('*') || list.includes(perm);
}

function requireAuth(ctx) {
  if (!ctx.user) throw new HttpError(401, 'يجب تسجيل الدخول');
  return ctx.user;
}

function requirePerm(ctx, perm) {
  requireAuth(ctx);
  if (!can(ctx.user, perm)) throw new HttpError(403, 'ليس لديك صلاحية للقيام بهذا الإجراء');
  return ctx.user;
}

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username || '').trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  const token = createSession(user.id);
  log(user, 'login', { username: user.username });
  return {
    token,
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
    permissions: PERMISSIONS[user.role] || []
  };
}

function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return { ok: true };
}

module.exports = {
  hashPassword, verifyPassword, login, logout, userFromToken,
  tokenFromRequest, can, requireAuth, requirePerm, PERMISSIONS
};
