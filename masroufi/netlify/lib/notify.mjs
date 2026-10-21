// Pure part of the scheduled reminders: turn a user's sync document into the
// `data` object the app's finance code expects, and pick the pushes that are
// due now. Uses the very same modules as the app, so the server and the
// in-app notification center always agree.

import { defaultSettings } from '../../src/js/core/defaults.js';
import { zonedParts } from '../../src/js/core/util.js';
import { pushDue, badgeCount } from '../../src/js/core/reminders.js';

const COLS = ['txn', 'cat', 'person', 'debt', 'pay', 'goal', 'gtx', 'rule', 'budget', 'nlog'];

/** Same merge as core/store.js settings(): defaults ← stored, nested one level. */
export function mergeSettings(stored, todayStr) {
  const base = defaultSettings(todayStr);
  const s = stored && !stored.d ? stored : {};
  const out = { ...base, ...s };
  for (const k of ['office', 'state', 'notif', 'look']) out[k] = { ...base[k], ...(s[k] || {}) };
  out.notif.daily = { ...base.notif.daily, ...((s.notif && s.notif.daily) || {}) };
  return out;
}

export function docToData(doc, todayStr) {
  const data = Object.fromEntries(COLS.map((c) => [c, []]));
  const recs = (doc && doc.recs) || {};
  for (const r of Object.values(recs)) {
    if (r.d || r.col === 'settings' || !data[r.col]) continue;
    const { _r, ...rest } = r;
    data[r.col].push(rest);
  }
  data.settings = mergeSettings(recs.settings, todayStr);
  return data;
}

export function validTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * What to send to one user now. `sent` maps key → timestamp of keys already
 * delivered. Returns [{ key, title, body, url, tag, badge }].
 */
export function selectDue(doc, nowMs, { tz, sent = {} } = {}) {
  const storedTz = doc && doc.recs && doc.recs.settings && doc.recs.settings.tz;
  const zone = [tz, storedTz, 'Africa/Tripoli'].find(validTz);
  const now = zonedParts(nowMs, zone);
  const data = docToData(doc, now.date);
  const recs = (doc && doc.recs) || {};
  const exists = (id) => Object.prototype.hasOwnProperty.call(recs, id);
  const due = pushDue(data, now, new Set(Object.keys(sent)), { exists });
  const badge = due.length ? badgeCount(data, now.date) : 0;
  return due.map((d) => ({ ...d, badge }));
}

/** Drop delivery records older than `days`. */
export function pruneSent(sent, nowMs, days = 60) {
  const cutoff = nowMs - days * 86400000;
  return Object.fromEntries(Object.entries(sent || {}).filter(([, ts]) => ts >= cutoff));
}
