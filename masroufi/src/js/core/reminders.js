// What deserves the user's attention, computed from the data. Used twice:
//  - attention(): the in-app notification center and the home "قريباً" card;
//  - pushDue(): the scheduled Netlify function, which sends these as push
//    notifications at sensible local times and de-duplicates by `key`.
// Pure module, shared between the app and the server.

import { diffDays, fmtMoney, fmtDate, fmtMonth, fmtIn, fmtDays, sum } from './util.js';
import {
  officeStatus, debtsOverview, dueRuleOccurrences, periodOf, budgetAlerts, nextRuleDate, category,
} from './finance.js';

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
};

function personName(data, id) {
  const p = data.person.find((x) => x.id === id);
  return p ? p.name : 'شخص';
}

/** Items for the in-app notification center, most urgent first. */
export function attention(data, today, { exists = () => false, horizon = 7 } = {}) {
  const items = [];
  const off = officeStatus(data, today);
  if (off) {
    if (off.late) {
      items.push({
        key: `salary-late:${off.key}`, kind: 'salary', tone: 'warn', icon: 'briefcase', date: off.payday, rank: 0,
        title: `مرتب ${fmtMonth(off.key)} ما تسجّلش`,
        body: `كان موعده ${fmtDate(off.payday, 'relative', today)}. لو استلمته سجّله، الصافي ${fmtMoney(off.expectedNet)}.`,
        url: '#/salary',
      });
    } else if (off.daysLeft <= 3) {
      items.push({
        key: `salary:${off.key}`, kind: 'salary', tone: off.isToday ? 'accent' : 'info', icon: 'briefcase', date: off.payday, rank: off.isToday ? 0 : 2,
        title: off.isToday ? 'اليوم يوم المرتب 🎉' : `المرتب ${fmtIn(off.daysLeft)}`,
        body: off.advTotal
          ? `${fmtMoney(off.gross)} ناقص سحوبات الدرج ${fmtMoney(off.advTotal)} = ${fmtMoney(off.expectedNet)}`
          : `الصافي المتوقع ${fmtMoney(off.expectedNet)}`,
        url: '#/salary',
      });
    }
  }

  const dv = debtsOverview(data, today);
  for (const i of dv.open) {
    if (i.dueIn === null || i.dueIn > horizon) continue;
    const name = personName(data, i.debt.person);
    const mine = i.debt.dir === 'in';
    const when = i.overdue ? `متأخر ${fmtDays(-i.dueIn)}` : fmtIn(i.dueIn);
    items.push({
      key: `debt:${i.debt.id}:${i.debt.due}`, kind: 'debt', tone: i.overdue ? 'neg' : i.dueIn <= 1 ? 'warn' : 'info',
      icon: mine ? 'hand-coins' : 'handshake', date: i.debt.due, rank: i.overdue ? 1 : 3,
      title: mine ? `${name} يرجعلك ${fmtMoney(i.remaining)}` : `سداد ${fmtMoney(i.remaining)} لـ${name}`,
      body: i.overdue ? `الموعد كان ${fmtDate(i.debt.due, 'relative', today)} — ${when}` : `الموعد ${fmtDate(i.debt.due, 'relative', today)}`,
      url: `#/person/${i.debt.person}`,
    });
  }

  for (const r of data.rule) {
    if (!r.active || !r.start) continue;
    const d = nextRuleDate(r, today);
    const days = diffDays(today, d);
    if (days < 0 || days > 3) continue;
    const id = `rec:${r.id}:${d.slice(0, 7)}`;
    if (exists(id)) continue;
    items.push({
      key: `rule:${r.id}:${d.slice(0, 7)}`, kind: 'rule', tone: 'info', icon: 'repeat', date: d, rank: 4,
      title: `${r.name} — ${fmtMoney(r.amount)}`,
      body: days === 0 ? 'مصروف ثابت ينزل اليوم' : `مصروف ثابت ينزل ${fmtIn(days)}`,
      url: '#/recurring',
    });
  }

  const p = periodOf(today, data.settings);
  const alerts = budgetAlerts(data, p, today);
  for (const a of topLevelAlerts(alerts)) {
    items.push({
      key: a.key, kind: 'budget', tone: a.level >= 100 ? 'neg' : 'warn', icon: 'target', date: today, rank: a.level >= 100 ? 1 : 3,
      title: a.level >= 100 ? `تجاوزت ${a.name}` : `قربت تخلص ${a.name}`,
      body: `صرفت ${fmtMoney(a.spent)} من ${fmtMoney(a.limit)} (${Math.round(a.pct)}%)`,
      url: '#/budget',
    });
  }

  return items.sort((a, b) => a.rank - b.rank || (a.date < b.date ? -1 : 1));
}

/** Keep only the highest level reached per scope (100 hides 80). */
function topLevelAlerts(alerts) {
  const by = new Map();
  for (const a of alerts) if (!by.has(a.scope) || by.get(a.scope).level < a.level) by.set(a.scope, a);
  return [...by.values()];
}

/**
 * Push notifications that are due now. `now` = { date, minutes } in the user's
 * zone, `sent` = Set of keys already delivered. A reminder is only sent within
 * a few hours of its slot, so a missed run never fires stale reminders at night.
 */
export function pushDue(data, now, sent, { exists = () => false } = {}) {
  const n = data.settings.notif || {};
  const out = [];
  const today = now.date;
  const at = (hhmm, window = 180) => now.minutes >= toMin(hhmm) && now.minutes - toMin(hhmm) < window;
  const daytime = now.minutes >= 8 * 60 && now.minutes <= 23 * 60;
  const push = (key, title, body, url, tag) => {
    if (!sent.has(key)) out.push({ key, title, body, url, tag: tag || key.split(':')[0] });
  };

  // Daily "did you log today's spending?"
  if (n.daily && n.daily.on && at(n.daily.time)) {
    const todays = data.txn.filter((t) => t.type === 'expense' && t.date === today);
    if (todays.length) {
      push(`daily:${today}`, 'مصاريف اليوم ✍️', `سجّلت ${todays.length} مصروف بمجموع ${fmtMoney(sum(todays, (t) => t.amount))}. في حاجة نسيتها؟`, '#/add');
    } else {
      push(`daily:${today}`, 'سجّلت مصاريف اليوم؟ ✍️', 'ما سجّلتش أي مصروف اليوم. لو صرفت حاجة سجّلها قبل ما تنساها.', '#/add');
    }
  }

  // Office salary
  const off = n.salary ? officeStatus(data, today) : null;
  if (off) {
    const net = off.advTotal
      ? `الصافي ${fmtMoney(off.expectedNet)} بعد خصم سحوبات الدرج ${fmtMoney(off.advTotal)}.`
      : `الصافي المتوقع ${fmtMoney(off.expectedNet)}.`;
    if (off.daysLeft === 1 && at('10:00', 600)) push(`salary-1:${off.key}`, 'بكرة يوم المرتب 💰', net, '#/salary');
    if (off.isToday && at('09:00', 720)) push(`salary-0:${off.key}`, 'اليوم يوم المرتب 🎉', `${net} لما تستلمه سجّله من التطبيق.`, '#/salary');
    if (off.late && off.daysLeft >= -15 && -off.daysLeft % 3 === 1 && at('12:00', 480)) {
      push(`salary-late:${off.key}:${off.daysLeft}`, `مرتب ${fmtMonth(off.key)} ما تسجّلش`, 'لو استلمته سجّله عشان يتحسب رصيدك صح.', '#/salary');
    }
  }

  // Debts
  if (n.debts) {
    const dv = debtsOverview(data, today);
    for (const i of dv.open) {
      if (i.dueIn === null) continue;
      const name = personName(data, i.debt.person);
      const mine = i.debt.dir === 'in';
      const amt = fmtMoney(i.remaining);
      const url = `#/person/${i.debt.person}`;
      if (i.dueIn === 1 && at('10:00', 600)) {
        push(`debt-1:${i.debt.id}:${i.debt.due}`, mine ? `بكرة موعد ${name} 🤝` : 'بكرة موعد سداد دين',
          mine ? `${name} المفروض يرجعلك ${amt} بكرة.` : `عليك ${amt} لـ${name} موعدها بكرة.`, url);
      } else if (i.dueIn === 0 && at('09:00', 720)) {
        push(`debt-0:${i.debt.id}:${i.debt.due}`, mine ? `اليوم موعد ${name}` : 'اليوم موعد سداد دين',
          mine ? `${name} المفروض يرجعلك ${amt} اليوم. تقدر تذكّره بواتساب من التطبيق.` : `عليك ${amt} لـ${name} موعدها اليوم.`, url);
      } else if (i.dueIn < 0 && i.dueIn >= -30 && -i.dueIn % 3 === 0 && at('11:00', 600)) {
        push(`debt-late:${i.debt.id}:${i.debt.due}:${i.dueIn}`, mine ? `${name} متأخر عليك` : 'دين متأخر عليك',
          mine ? `${amt} عند ${name} من ${fmtDate(i.debt.due, 'short', today)}.` : `${amt} لـ${name} موعدها فات من ${fmtDate(i.debt.due, 'short', today)}.`, url);
      }
    }
  }

  // Fixed monthly expenses posting today
  if (n.recurring && at('09:00', 720)) {
    for (const o of dueRuleOccurrences(data, today, exists)) {
      if (o.date !== today) continue;
      const c = category(data, o.rule.cat);
      push(`rule:${o.rule.id}:${o.key}`, `${c.emoji} ${o.rule.name}`, `مصروف ثابت نزل اليوم: ${fmtMoney(o.rule.amount)}`, '#/recurring', 'rule');
    }
  }

  // Budget thresholds (the app logs the ones it already showed in `nlog`)
  if (n.budget && daytime) {
    const logged = new Set(data.nlog.map((x) => x.id.replace(/^nlog:/, '')));
    const p = periodOf(today, data.settings);
    for (const a of topLevelAlerts(budgetAlerts(data, p, today))) {
      const shown = logged.has(a.key) || (a.level === 80 && logged.has(a.key.replace(/:80$/, ':100')));
      if (shown) continue;
      push(a.key, a.level >= 100 ? `تجاوزت ${a.name} ⚠️` : `قربت تخلص ${a.name}`,
        `صرفت ${fmtMoney(a.spent)} من ${fmtMoney(a.limit)} (${Math.round(a.pct)}%).`, '#/budget', 'budget');
    }
  }

  return out;
}

/** Number shown on the home-screen icon badge. */
export function badgeCount(data, today) {
  return attention(data, today).filter((i) => i.tone === 'neg' || i.tone === 'warn' || i.rank === 0).length;
}

