// Scheduled every 15 minutes: send each user the reminders that are due in
// their time zone (daily log reminder, payday, debt due dates, fixed
// expenses, budget thresholds). Delivered keys are remembered so nothing is
// sent twice.

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { selectDue, pruneSent } from '../lib/notify.mjs';
import { sendAll, vapid } from '../lib/webpush.mjs';

export default async () => {
  if (!vapid()) {
    console.log('[notify] VAPID keys missing — skipping');
    return;
  }
  const pushStore = getStore({ name: 'push', consistency: 'strong' });
  const dataStore = getStore({ name: 'userdata', consistency: 'strong' });
  const notifStore = getStore({ name: 'notif', consistency: 'strong' });
  const now = Date.now();
  const { blobs } = await pushStore.list();

  await Promise.all(blobs.map(async ({ key: uid }) => {
    try {
      const rec: any = await pushStore.get(uid, { type: 'json' });
      if (!rec || !rec.subs || !rec.subs.length) return;
      const doc = await dataStore.get(uid, { type: 'json' });
      if (!doc) return;
      const state: any = (await notifStore.get(uid, { type: 'json' })) || { sent: {} };
      const due = selectDue(doc, now, { tz: rec.tz, sent: state.sent });
      if (!due.length) return;

      let dead: string[] = [];
      for (const d of due) {
        const r = await sendAll(rec.subs, { title: d.title, body: d.body, url: d.url, tag: d.tag, badge: d.badge });
        dead = dead.concat(r.dead);
        state.sent[d.key] = now; // remembered even if a device was offline: push services queue it (TTL)
      }
      await notifStore.setJSON(uid, { sent: pruneSent(state.sent, now) });
      if (dead.length) {
        rec.subs = rec.subs.filter((s: any) => !dead.includes(s.endpoint));
        await pushStore.setJSON(uid, rec);
      }
      console.log(`[notify] ${uid}: sent ${due.map((d) => d.key).join(', ')}`);
    } catch (e) {
      console.error(`[notify] ${uid} failed`, e);
    }
  }));
};

export const config: Config = { schedule: '*/15 * * * *' };
