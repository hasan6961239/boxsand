// Account layer over Netlify Identity (email + password). The app works fully
// offline without an account; signing in only turns on sync between devices.

import {
  getUser, login as idLogin, signup as idSignup, logout as idLogout, handleAuthCallback,
  requestPasswordRecovery, updateUser, refreshSession, onAuthChange, MissingIdentityError,
} from '@netlify/identity';
import { emit } from './bus.js';

let user = null;
let available = null; // null = unknown, true/false once probed
let recovery = false;
let subscribed = false;

export const current = () => user;
export const isAvailable = () => available;
export const inRecovery = () => recovery;

function normalize(u) {
  return u ? { id: u.id, email: u.email, name: (u.userMetadata && u.userMetadata.full_name) || u.name || '' } : null;
}

function set(u) {
  const next = normalize(u);
  const changed = (next && next.id) !== (user && user.id);
  user = next;
  if (changed) emit('auth', user);
}

/**
 * On boot: finish any email link (confirmation / password recovery) present
 * in the URL hash, then restore the saved session.
 * Returns { type } of the link that was handled, if any.
 */
export async function init() {
  let handled = null;
  available = await probe();
  if (available !== false) {
    try {
      const r = await handleAuthCallback();
      if (r) {
        handled = r.type;
        if (r.type === 'recovery') recovery = true;
        history.replaceState(null, '', location.pathname + location.search + '#/');
      }
    } catch (e) {
      handled = 'error';
      console.warn('[auth] callback', e);
      history.replaceState(null, '', location.pathname + location.search + '#/');
    }
    try {
      set(await getUser());
    } catch {
      set(null);
    }
    if (!subscribed) {
      subscribed = true;
      try {
        onAuthChange((evt, u) => set(evt === 'logout' ? null : u));
      } catch { /* identity unavailable */ }
    }
  }
  return { handled };
}

/** true: Identity is enabled; false: the site answers 404 (not enabled); null: offline/unknown. */
async function probe() {
  try {
    const r = await fetch('/.netlify/identity/settings', { cache: 'no-store' });
    if (r.ok) {
      const s = await r.json().catch(() => ({}));
      signupDisabled = Boolean(s.disable_signup);
      return true;
    }
    return r.status === 404 ? false : null;
  } catch {
    return null;
  }
}

let signupDisabled = false;
export const canSignup = () => !signupDisabled;

/** Re-check availability later (e.g. after the user enabled Identity). */
export async function recheck() {
  const was = available;
  available = await probe();
  if (available && !was) await init();
  return available;
}

export async function login(email, password) {
  const u = await idLogin(email.trim(), password);
  set(u);
  return user;
}

/** Returns { user } when logged in right away, or { confirm: true } when an email confirmation is required. */
export async function signup(email, password, name) {
  const u = await idSignup(email.trim(), password, name ? { full_name: name } : undefined);
  const logged = await getUser().catch(() => null);
  if (logged) {
    set(logged);
    return { user };
  }
  return { confirm: true, user: normalize(u) };
}

export async function logout() {
  try {
    await idLogout();
  } finally {
    set(null);
  }
}

export const forgot = (email) => requestPasswordRecovery(email.trim());

export async function setPassword(password) {
  const u = await updateUser({ password });
  recovery = false;
  set(u);
  return user;
}

/** Make sure the nf_jwt cookie is fresh before talking to our functions. */
export async function ensureFresh() {
  try {
    await refreshSession();
  } catch { /* offline: the server will answer 401 and we retry later */ }
}

/** Arabic message for an auth error. */
export function errorText(e) {
  const msg = String((e && (e.message || e.error_description || e.msg)) || '').toLowerCase();
  const status = e && e.status;
  if (e instanceof MissingIdentityError || status === 404) return 'نظام الحسابات مش مفعّل في الموقع لسه. فعّله من لوحة Netlify (الخطوة مشروحة في الإعدادات).';
  if (msg.includes('invalid') && msg.includes('grant')) return 'الإيميل أو كلمة السر غلط.';
  if (msg.includes('email not confirmed') || msg.includes('not confirmed')) return 'لازم تأكد الإيميل أولاً — شوف الرسالة اللي وصلتك.';
  if (msg.includes('already') && msg.includes('registered')) return 'الإيميل هذا عنده حساب. سجّل دخول بدل إنشاء حساب.';
  if (msg.includes('password') && (msg.includes('short') || msg.includes('length') || msg.includes('characters'))) return 'كلمة السر قصيرة. خليها 6 حروف أو أكثر.';
  if (msg.includes('signup') && msg.includes('disabled')) return 'إنشاء الحسابات مقفول في الموقع.';
  if (status === 401 || status === 403 || msg.includes('not allowed') || msg.includes('unauthorized')) return 'الحساب هذا غير مسموح له يدخل التطبيق.';
  if (status === 429 || msg.includes('rate')) return 'محاولات كثيرة. استنى شوية وجرّب.';
  if (!navigator.onLine || msg.includes('fetch') || msg.includes('network')) return 'ما فيش نت. تأكد من الاتصال وجرّب تاني.';
  return 'صار خطأ. جرّب تاني بعد شوية.';
}
