// Push subscriptions of the signed-in user:
//   POST /api/push/subscribe   { subscription, device, tz, ua, replaces? }
//   POST /api/push/unsubscribe { endpoint }
//   POST /api/push/test        → sends a test notification to all devices

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { json, currentUser, readJson } from '../lib/http.mjs';
import { sendAll, vapid } from '../lib/webpush.mjs';
import { validTz } from '../lib/notify.mjs';

const MAX_SUBS = 10;

export default async (req: Request) => {
  const user = await currentUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  const action = new URL(req.url).pathname.split('/').pop();
  const store = getStore({ name: 'push', consistency: 'strong' });
  const rec: any = (await store.get(user.id, { type: 'json' })) || { subs: [] };

  if (action === 'test') {
    if (!vapid()) return json({ error: 'push not configured' }, 503);
    const r = await sendAll(rec.subs, { title: 'تجربة إشعار ✅', body: 'الإشعارات شغالة تمام على جهازك.', url: '#/notifications', tag: 'test' }, { ttl: 600 });
    if (r.dead.length) {
      rec.subs = rec.subs.filter((s: any) => !r.dead.includes(s.endpoint));
      await store.setJSON(user.id, rec);
    }
    return json({ sent: r.sent, removed: r.dead.length });
  }

  let body: any;
  try {
    body = await readJson(req, 16 * 1024);
  } catch (e: any) {
    return json({ error: e.message }, e.status || 400);
  }

  if (action === 'subscribe') {
    const sub = body.subscription || {};
    let endpoint: URL;
    try {
      endpoint = new URL(sub.endpoint);
    } catch {
      return json({ error: 'bad endpoint' }, 400);
    }
    if (endpoint.protocol !== 'https:' || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') {
      return json({ error: 'bad subscription' }, 400);
    }
    const entry = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      device: String(body.device || '').slice(0, 64),
      ua: String(body.ua || '').slice(0, 160),
      at: Date.now(),
    };
    rec.subs = [entry, ...rec.subs.filter((s: any) => s.endpoint !== entry.endpoint && s.endpoint !== body.replaces)].slice(0, MAX_SUBS);
    if (validTz(body.tz)) rec.tz = body.tz;
    await store.setJSON(user.id, rec);
    return json({ ok: true, devices: rec.subs.length });
  }

  if (action === 'unsubscribe') {
    rec.subs = rec.subs.filter((s: any) => s.endpoint !== body.endpoint);
    await store.setJSON(user.id, rec);
    return json({ ok: true, devices: rec.subs.length });
  }

  return json({ error: 'not found' }, 404);
};

export const config: Config = { path: ['/api/push/subscribe', '/api/push/unsubscribe', '/api/push/test'], method: ['POST'] };
