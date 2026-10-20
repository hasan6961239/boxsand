// Notifications: Web Push subscription (reminders sent by the server even when
// the app is closed) and immediate local notifications while it's open.
// On iPhone, Web Push works only for the app added to the Home Screen (iOS 16.4+).

import * as auth from './auth.js';
import { deviceId } from './sync.js';
import * as db from './db.js';

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const permission = () => ('Notification' in window ? Notification.permission : 'unsupported');

let config = null;
async function serverConfig() {
  if (config) return config;
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    config = r.ok ? await r.json() : {};
  } catch {
    config = {};
  }
  return config;
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/**
 * What's possible here. reason ∈ 'ok' | 'install' (iPhone, not added to home
 * screen) | 'unsupported' | 'denied' | 'account' (needs login) | 'server'.
 */
export async function state() {
  if (isIOS() && !isStandalone()) return { reason: 'install', subscribed: false };
  if (!supported()) return { reason: 'unsupported', subscribed: false };
  if (permission() === 'denied') return { reason: 'denied', subscribed: false };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!auth.current()) return { reason: 'account', subscribed: Boolean(sub) };
  const cfg = await serverConfig();
  if (!cfg.vapidPublicKey) return { reason: 'server', subscribed: Boolean(sub) };
  return { reason: 'ok', subscribed: Boolean(sub) && (await db.getMeta('pushOk', false)) };
}

/** Must be called from a tap (iOS requires a user gesture for the permission prompt). */
export async function enable() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'denied' : 'dismissed');
  const cfg = await serverConfig();
  if (!cfg.vapidPublicKey) throw new Error('server');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older server key can't receive our pushes.
  if (sub && (await db.getMeta('pushKey', null)) !== cfg.vapidPublicKey) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.vapidPublicKey) });
  await db.setMeta('pushKey', cfg.vapidPublicKey);
  await auth.ensureFresh();
  const r = await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), device: await deviceId(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ua: navigator.userAgent.slice(0, 160) }),
  });
  if (!r.ok) throw new Error('server');
  await db.setMeta('pushOk', true);
  return true;
}

export async function disable() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    try {
      await auth.ensureFresh();
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    } catch { /* offline — the server drops dead endpoints by itself */ }
    await sub.unsubscribe();
  }
  await db.setMeta('pushOk', false);
}

/** Ask the server to send a test push to every device of this account. */
export async function test() {
  await auth.ensureFresh();
  const r = await fetch('/api/push/test', { method: 'POST', credentials: 'same-origin' });
  if (!r.ok) throw new Error('server');
  return r.json();
}

/** Show a notification right now from this device (used for budget alerts). */
export async function local(title, body, { url = '#/', tag } = {}) {
  if (permission() !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/badge-72.png', dir: 'rtl', lang: 'ar', data: { url } });
    return true;
  } catch {
    return false;
  }
}

/** Number on the home-screen icon (iOS 16.4+ for installed web apps). */
export function setBadge(n) {
  try {
    if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n);
    else if (navigator.clearAppBadge) navigator.clearAppBadge();
  } catch { /* unsupported */ }
}
