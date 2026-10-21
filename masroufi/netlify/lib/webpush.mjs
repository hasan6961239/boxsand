// Sending Web Push with the site's VAPID keys.

import webpush from 'web-push';

let configured = null;

export function vapid() {
  const publicKey = Netlify.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Netlify.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return null;
  if (configured !== publicKey) {
    webpush.setVapidDetails(Netlify.env.get('VAPID_SUBJECT') || 'mailto:owner@masroufi.app', publicKey, privateKey);
    configured = publicKey;
  }
  return { publicKey };
}

/**
 * Send one payload to every subscription. Returns { sent, dead } where dead
 * lists endpoints the push service says are gone (404/410) — drop them.
 */
export async function sendAll(subs, payload, { ttl = 6 * 3600 } = {}) {
  const body = JSON.stringify(payload);
  let sent = 0;
  const dead = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: ttl, urgency: 'normal' });
      sent++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.push(s.endpoint);
      else console.warn('[push] send failed', e && e.statusCode, e && e.body);
    }
  }));
  return { sent, dead };
}
