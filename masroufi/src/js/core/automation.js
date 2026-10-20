// Background chores run on boot, on resume and after edits:
//  - post fixed monthly expenses that came due,
//  - budget threshold alerts right after spending,
//  - the number badge on the home-screen icon.

import * as store from './store.js';
import { today } from './util.js';
import { dueRuleOccurrences, periodOf, budgetAlerts } from './finance.js';
import { badgeCount } from './reminders.js';
import { local, setBadge } from './push.js';
import { on } from './bus.js';

/** Create the expense records of recurring rules whose day has arrived. Returns how many. */
export function postDueRecurring() {
  const occ = dueRuleOccurrences(store.data(), today(), store.exists);
  if (!occ.length) return 0;
  store.batch(() => {
    for (const o of occ) {
      store.put('txn', { id: o.id, type: 'expense', amount: o.rule.amount, cat: o.rule.cat, note: o.rule.name, date: o.date, rule: o.rule.id });
    }
  });
  return occ.length;
}

/**
 * After an expense: alert once per threshold (80% / 100%) per budget per
 * period. Returns the alerts that are new, for the caller to show a toast.
 */
export function checkBudgets() {
  const data = store.data();
  if (!data.settings.notif.budget) return [];
  const t = today();
  const p = periodOf(t, data.settings);
  const fresh = budgetAlerts(data, p, t).filter((a) => !store.exists('nlog:' + a.key));
  // only the highest level per scope, and remember lower levels as shown too
  const top = new Map();
  for (const a of fresh) if (!top.has(a.scope) || top.get(a.scope).level < a.level) top.set(a.scope, a);
  store.batch(() => {
    for (const a of fresh) store.put('nlog', { id: 'nlog:' + a.key, at: Date.now() });
  });
  const out = [...top.values()];
  for (const a of out) {
    local(a.level >= 100 ? `تجاوزت ${a.name} ⚠️` : `قربت تخلص ${a.name}`, `صرفت ${Math.round(a.pct)}% من الحد.`, { url: '#/budget', tag: 'budget' });
  }
  return out;
}

let lastDay = null;
export function start() {
  lastDay = today();
  postDueRecurring();
  let t;
  const badge = () => {
    clearTimeout(t);
    t = setTimeout(() => setBadge(badgeCount(store.data(), today())), 600);
  };
  on('change', badge);
  badge();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (today() !== lastDay) {
      lastDay = today();
      store.batch(() => postDueRecurring());
    }
    badge();
  });
}
