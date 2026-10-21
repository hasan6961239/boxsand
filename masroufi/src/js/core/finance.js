// Every number the app shows is derived here from the raw records — nothing is
// stored pre-computed, so edits on one device can never leave a stale total on
// another. Pure module, shared with the Netlify functions (reminders).
//
// `data` is { txn, cat, person, debt, pay, goal, gtx, rule, budget, nlog, settings }
// with tombstoned records already removed. Amounts are integer milli-dinars.

import {
  sum, groupBy, diffDays, addDays, addMonths, monthKey, dayInMonth, fmtMoney, fmtDate, fmtMonth, MILLI,
} from './util.js';
import { FALLBACK_CATEGORY } from './defaults.js';

/* ----------------------------------------------------------- effects */

// How each record moves the cash balance.
export function txnEffect(t) {
  switch (t.type) {
    case 'expense': return -t.amount;
    case 'income':
    case 'advance': // drawer withdrawal: cash in now, deducted from the next office salary
    case 'salary': // stored as the net actually received
    case 'state':
      return t.amount;
    case 'adjust': return t.amount; // signed correction
    default: return 0; // 'carry' only moves a deduction to the next cycle
  }
}

// dir 'in'  = «ليّ»: I lent money, it comes back to me.
// dir 'out' = «عليّ»: I borrowed money, I pay it back.
export function debtEffect(d) {
  if (!d.cash) return 0;
  return d.dir === 'in' ? -d.amount : d.amount;
}

export function payEffect(p, debt) {
  if (!debt) return 0;
  return debt.dir === 'in' ? p.amount : -p.amount;
}

// Money put into a savings goal leaves the spendable balance (and comes back on withdrawal).
export const gtxEffect = (g) => -g.amount;

// Spending guidance is shown in whole dinars ("49 د.ل في اليوم", not 49.283).
const floorDinar = (m) => Math.floor(m / MILLI) * MILLI;

const counts = (date, s) => !s.openingDate || !date || date >= s.openingDate;

/** Spendable cash. Records dated before the opening date are history already inside `opening`. */
export function balance(data, asOf) {
  const s = data.settings;
  const upto = (d) => !asOf || !d || d <= asOf;
  let b = s.opening || 0;
  for (const t of data.txn) if (counts(t.date, s) && upto(t.date)) b += txnEffect(t);
  const debts = new Map(data.debt.map((d) => [d.id, d]));
  for (const d of data.debt) if (counts(d.date, s) && upto(d.date)) b += debtEffect(d);
  for (const p of data.pay) if (counts(p.date, s) && upto(p.date)) b += payEffect(p, debts.get(p.debt));
  for (const g of data.gtx) if (counts(g.date, s) && upto(g.date)) b += gtxEffect(g);
  return b;
}

/* ------------------------------------------------------- categories */

export function catMap(data) {
  return new Map(data.cat.map((c) => [c.id, c]));
}

export function category(data, id) {
  return data.cat.find((c) => c.id === id) || FALLBACK_CATEGORY;
}

export function categories(data, kind = 'expense', { archived = false } = {}) {
  return data.cat
    .filter((c) => c.kind === kind && (archived || !c.archived))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'ar'));
}

/* ------------------------------------------------------------ debts */

export function paysByDebt(data) {
  return groupBy(data.pay, (p) => p.debt);
}

export function debtInfo(debt, pays = [], today) {
  const list = pays.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.u || 0) - (b.u || 0)));
  const paid = sum(list, (p) => p.amount);
  const remaining = Math.max(0, debt.amount - paid);
  const settled = remaining === 0;
  const dueIn = debt.due && !settled ? diffDays(today, debt.due) : null;
  return {
    debt,
    pays: list,
    paid,
    remaining,
    settled,
    progress: debt.amount ? Math.min(1, paid / debt.amount) : 1,
    dueIn,
    overdue: dueIn !== null && dueIn < 0,
    settledOn: settled && list.length ? list[list.length - 1].date : null,
  };
}

/** All debts with status, grouped per person, plus totals. */
export function debtsOverview(data, today) {
  const pi = paysByDebt(data);
  const infos = data.debt.map((d) => debtInfo(d, pi.get(d.id) || [], today));
  const open = infos.filter((i) => !i.settled);
  const owedToMe = sum(open.filter((i) => i.debt.dir === 'in'), (i) => i.remaining);
  const iOwe = sum(open.filter((i) => i.debt.dir === 'out'), (i) => i.remaining);
  const byPerson = groupBy(infos, (i) => i.debt.person);
  const people = data.person.map((person) => {
    const list = byPerson.get(person.id) || [];
    const o = list.filter((i) => !i.settled);
    const theyOwe = sum(o.filter((i) => i.debt.dir === 'in'), (i) => i.remaining);
    const iOweThem = sum(o.filter((i) => i.debt.dir === 'out'), (i) => i.remaining);
    const dues = o.filter((i) => i.debt.due).map((i) => i.debt.due).sort();
    return {
      person,
      debts: list,
      open: o.length,
      theyOwe,
      iOweThem,
      net: theyOwe - iOweThem, // > 0: they owe me
      nextDue: dues[0] || null,
      overdue: o.some((i) => i.overdue),
      lastDate: list.map((i) => i.debt.date).sort().pop() || null,
    };
  });
  people.sort((a, b) => (b.open > 0) - (a.open > 0) || Number(b.overdue) - Number(a.overdue) || Math.abs(b.net) - Math.abs(a.net) || (b.lastDate || '').localeCompare(a.lastDate || ''));
  return {
    infos,
    open,
    owedToMe,
    iOwe,
    net: owedToMe - iOwe,
    overdue: open.filter((i) => i.overdue),
    people,
  };
}

/** Chronological statement with one person; running > 0 means they owe me. */
export function personLedger(data, personId, today) {
  const debts = data.debt.filter((d) => d.person === personId);
  const ids = new Set(debts.map((d) => d.id));
  const byId = new Map(debts.map((d) => [d.id, d]));
  const rows = [
    ...debts.map((d) => ({ kind: 'debt', date: d.date, u: d.u, rec: d, delta: d.dir === 'in' ? d.amount : -d.amount })),
    ...data.pay.filter((p) => ids.has(p.debt)).map((p) => {
      const d = byId.get(p.debt);
      return { kind: 'pay', date: p.date, u: p.u, rec: p, debt: d, delta: d.dir === 'in' ? -p.amount : p.amount };
    }),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.u || 0) - (b.u || 0)));
  let run = 0;
  for (const r of rows) { run += r.delta; r.running = run; }
  const pi = paysByDebt(data);
  return { rows, net: run, infos: debts.map((d) => debtInfo(d, pi.get(d.id) || [], today)) };
}

/* ---------------------------------------------------- office salary */

export const payday = (key, day) => dayInMonth(key, day);

/** The salary cycle ('YYYY-MM' of its payday) a date falls before. */
export function cycleForDate(date, day) {
  const k = monthKey(date);
  return date <= payday(k, day) ? k : addMonths(k, 1);
}

export function salaryOf(data, key) {
  return data.txn.find((t) => t.type === 'salary' && t.cycle === key) || null;
}

export function deductionsOf(data, key) {
  return data.txn.filter((t) => (t.type === 'advance' || t.type === 'carry') && t.cycle === key);
}

/**
 * The office salary we're waiting for right now: its cycle, payday, countdown,
 * the drawer withdrawals already taken against it and the expected net.
 */
export function officeStatus(data, today) {
  const o = data.settings.office;
  if (!o || !o.on) return null;
  let key = cycleForDate(today, o.day);
  const prev = addMonths(key, -1);
  if (prev >= (o.since || prev) && !salaryOf(data, prev)) key = prev; // previous payday passed unrecorded
  else if (salaryOf(data, key)) key = addMonths(key, 1); // this one already received
  const pd = payday(key, o.day);
  const deductions = deductionsOf(data, key).sort((a, b) => (a.date < b.date ? 1 : -1));
  const advTotal = sum(deductions, (t) => t.amount);
  const lastSalary = data.txn.filter((t) => t.type === 'salary').sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
  return {
    key,
    payday: pd,
    daysLeft: diffDays(today, pd),
    late: pd < today,
    isToday: pd === today,
    deductions,
    advTotal,
    gross: o.amount,
    expectedNet: o.amount - advTotal,
    lastSalary,
  };
}

/** Which salary a drawer withdrawal on `date` comes out of. */
export function defaultAdvanceCycle(data, date) {
  const o = data.settings.office;
  let k = cycleForDate(date, o.day);
  const prev = addMonths(k, -1);
  if (prev >= (o.since || prev) && !salaryOf(data, prev)) k = prev;
  let guard = 0;
  while (salaryOf(data, k) && guard++ < 24) k = addMonths(k, 1);
  return k;
}

/** Numbers for recording the office salary of cycle `key`. */
export function salaryDraft(data, key, gross = data.settings.office.amount) {
  const ded = sum(deductionsOf(data, key), (t) => t.amount);
  return { key, gross, ded, net: Math.max(0, gross - ded), carry: Math.max(0, ded - gross) };
}

export function stateSalaryStats(data, today) {
  const list = data.txn.filter((t) => t.type === 'state').sort((a, b) => (a.date < b.date ? 1 : -1));
  const year = today.slice(0, 4);
  return {
    list,
    last: list[0] || null,
    daysSinceLast: list[0] ? diffDays(list[0].date, today) : null,
    yearTotal: sum(list.filter((t) => t.date.startsWith(year)), (t) => t.amount),
    count: list.length,
  };
}

/* ---------------------------------------------------------- periods */

function periodMode(s) {
  return s.period === 'payday' && s.office && s.office.on ? 'payday' : 'month';
}

function periodFromStart(start, s) {
  const mode = periodMode(s);
  const key = monthKey(start);
  const next = addMonths(key, 1);
  const end = mode === 'payday' ? addDays(payday(next, s.office.day), -1) : addDays(`${next}-01`, -1);
  return { key, start, end, mode, days: diffDays(start, end) + 1 };
}

/** The budget/report month containing `date`. */
export function periodOf(date, s) {
  const mode = periodMode(s);
  const k = monthKey(date);
  if (mode === 'month') return periodFromStart(`${k}-01`, s);
  const pd = payday(k, s.office.day);
  const start = date >= pd ? pd : payday(addMonths(k, -1), s.office.day);
  return periodFromStart(start, s);
}

export function periodByKey(key, s) {
  const start = periodMode(s) === 'payday' ? payday(key, s.office.day) : `${key}-01`;
  return periodFromStart(start, s);
}

export const shiftPeriod = (p, n, s) => periodByKey(addMonths(p.key, n), s);

export function periodLabel(p, ref) {
  if (p.mode === 'month') return fmtMonth(p.key, { ref });
  return `${fmtDate(p.start, 'short', ref)} – ${fmtDate(p.end, 'short', ref)}`;
}

export const inPeriod = (date, p) => date >= p.start && date <= p.end;

/* ---------------------------------------------------------- reports */

const INFLOW = new Set(['income', 'salary', 'state', 'advance']);

export function periodTotals(data, p) {
  let expense = 0, income = 0, count = 0;
  const byType = {};
  for (const t of data.txn) {
    if (!inPeriod(t.date, p)) continue;
    if (t.type === 'expense') { expense += t.amount; count++; }
    else if (INFLOW.has(t.type)) income += t.amount;
    byType[t.type] = (byType[t.type] || 0) + t.amount;
  }
  return { expense, income, net: income - expense, count, byType };
}

export function spendByCategory(data, p) {
  const cm = catMap(data);
  const m = new Map();
  for (const t of data.txn) {
    if (t.type !== 'expense' || !inPeriod(t.date, p)) continue;
    const e = m.get(t.cat) || { cat: cm.get(t.cat) || FALLBACK_CATEGORY, amount: 0, count: 0 };
    e.amount += t.amount;
    e.count++;
    m.set(t.cat, e);
  }
  const list = [...m.values()].sort((a, b) => b.amount - a.amount);
  const total = sum(list, (e) => e.amount);
  for (const e of list) e.pct = total ? (e.amount / total) * 100 : 0;
  return { list, total };
}

export function dailySpend(data, p) {
  const days = [];
  const map = new Map();
  for (const t of data.txn) if (t.type === 'expense' && inPeriod(t.date, p)) map.set(t.date, (map.get(t.date) || 0) + t.amount);
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) days.push({ date: d, amount: map.get(d) || 0 });
  return days;
}

/** Income vs expense for the last `n` periods ending with `p`. */
export function trend(data, p, n, s) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const q = shiftPeriod(p, -i, s);
    out.push({ period: q, ...periodTotals(data, q) });
  }
  return out;
}

/** Short, plain-language observations for the reports screen. */
export function insights(data, p, s, today) {
  const out = [];
  const cur = spendByCategory(data, p);
  const prevP = shiftPeriod(p, -1, s);
  const prev = spendByCategory(data, prevP);
  const prevMap = new Map(prev.list.map((e) => [e.cat.id, e.amount]));
  const elapsed = Math.max(1, Math.min(p.days, diffDays(p.start, today) + 1));
  if (cur.total && inPeriod(today, p) && elapsed >= 5) {
    const projected = Math.round((cur.total / elapsed) * p.days / MILLI) * MILLI;
    out.push({ icon: 'trending-up', tone: 'info', text: `بهالمعدل حتصرف تقريباً ${fmtMoney(projected)} في هالشهر.` });
  }
  if (cur.list[0]) out.push({ icon: 'chart-pie', tone: 'accent', text: `أكثر بند صرفت عليه: ${cur.list[0].cat.emoji} ${cur.list[0].cat.name} (${Math.round(cur.list[0].pct)}%).` });
  for (const e of cur.list.slice(0, 5)) {
    const before = prevMap.get(e.cat.id) || 0;
    if (before > 0 && e.amount > before * 1.25 && e.amount - before > 20000) {
      out.push({ icon: 'triangle-alert', tone: 'warn', text: `صرفك على ${e.cat.name} زاد ${Math.round(((e.amount - before) / before) * 100)}% عن الشهر اللي قبله.` });
      break;
    }
  }
  if (prev.total && cur.total && !inPeriod(today, p)) {
    const diff = cur.total - prev.total;
    out.push({ icon: diff > 0 ? 'trending-up' : 'trending-down', tone: diff > 0 ? 'warn' : 'pos', text: diff > 0 ? `صرفت ${fmtMoney(diff)} أكثر من الشهر اللي قبله.` : `وفّرت ${fmtMoney(-diff)} مقارنة بالشهر اللي قبله 👏` });
  }
  return out;
}

/* ----------------------------------------------------------- budget */

export function budgetLimits(data) {
  const total = data.budget.find((b) => b.id === 'budget:total');
  return {
    total: total ? total.amount : 0,
    cats: data.budget.filter((b) => b.cat && b.amount > 0),
  };
}

export function budgetStatus(data, p, today) {
  const lim = budgetLimits(data);
  const spend = spendByCategory(data, p);
  const spentBy = new Map(spend.list.map((e) => [e.cat.id, e.amount]));
  const daysLeft = inPeriod(today, p) ? diffDays(today, p.end) + 1 : today < p.start ? p.days : 0;
  const total = lim.total
    ? { limit: lim.total, spent: spend.total, left: lim.total - spend.total, pct: (spend.total / lim.total) * 100 }
    : null;
  const cm = catMap(data);
  const cats = lim.cats
    .map((b) => {
      const spent = spentBy.get(b.cat) || 0;
      return { cat: cm.get(b.cat) || FALLBACK_CATEGORY, limit: b.amount, spent, left: b.amount - spent, pct: (spent / b.amount) * 100 };
    })
    .sort((a, b) => b.pct - a.pct);
  return {
    total,
    cats,
    daysLeft,
    daily: total && daysLeft > 0 ? Math.max(0, floorDinar(total.left / daysLeft)) : null,
    spent: spend.total,
  };
}

/** Threshold crossings (80% / 100%) for budget alerts. */
export function budgetAlerts(data, p, today) {
  const st = budgetStatus(data, p, today);
  const out = [];
  const add = (scope, name, x) => {
    const level = x.pct >= 100 ? 100 : x.pct >= 80 ? 80 : 0;
    if (level) out.push({ key: `budget:${p.key}:${scope}:${level}`, scope, name, level, ...x });
  };
  if (st.total) add('total', 'الميزانية الشهرية', st.total);
  for (const c of st.cats) add(c.cat.id, c.cat.name, c);
  return out;
}

/** How much can be spent per day until the next payday, from the cash balance. */
export function dailyAllowance(data, today) {
  const off = officeStatus(data, today);
  const bal = balance(data);
  const days = off && off.daysLeft > 0 ? off.daysLeft : null;
  return { balance: bal, days, perDay: days ? Math.max(0, floorDinar(bal / days)) : null };
}

/* ------------------------------------------------------------ goals */

export function goalInfo(goal, gtxs = [], today) {
  const saved = sum(gtxs, (g) => g.amount);
  const remaining = Math.max(0, goal.target - saved);
  let monthly = null;
  if (goal.due && remaining > 0) {
    const months = Math.max(1, Math.ceil(diffDays(today, goal.due) / 30.44));
    monthly = Math.ceil(remaining / months / MILLI) * MILLI; // whole dinars
  }
  return { goal, saved, remaining, pct: goal.target ? Math.min(100, (saved / goal.target) * 100) : 0, done: saved >= goal.target && goal.target > 0, monthly, list: gtxs.slice().sort((a, b) => (a.date < b.date ? 1 : -1)) };
}

export function goalsOverview(data, today) {
  const by = groupBy(data.gtx, (g) => g.goal);
  const infos = data.goal.filter((g) => !g.archived).map((g) => goalInfo(g, by.get(g.id) || [], today));
  return { infos, saved: sum(data.gtx, (g) => g.amount) };
}

/* -------------------------------------------------------- recurring */

export const ruleTxnId = (ruleId, key) => `rec:${ruleId}:${key}`;

/**
 * Occurrences of fixed monthly expenses that are due (date ≤ today) and were
 * never posted. `exists(id)` must also see deleted ids, so an occurrence the
 * user deleted on purpose is not posted again.
 */
export function dueRuleOccurrences(data, today, exists) {
  const out = [];
  for (const r of data.rule) {
    if (!r.active || !r.start) continue;
    let k = r.start;
    let guard = 0;
    while (k <= monthKey(today) && guard++ < 36) {
      const date = dayInMonth(k, r.day);
      const id = ruleTxnId(r.id, k);
      if (date <= today && !exists(id)) out.push({ rule: r, key: k, date, id });
      k = addMonths(k, 1);
    }
  }
  return out;
}

/** Next date a rule fires on or after `from`. */
export function nextRuleDate(rule, from) {
  let k = rule.start > monthKey(from) ? rule.start : monthKey(from);
  let d = dayInMonth(k, rule.day);
  if (d < from) d = dayInMonth(addMonths(k, 1), rule.day);
  return d;
}

/* ---------------------------------------------------------- summary */

export function netWorth(data, today) {
  const dv = debtsOverview(data, today);
  const saved = sum(data.gtx, (g) => g.amount);
  const bal = balance(data);
  return { balance: bal, saved, owedToMe: dv.owedToMe, iOwe: dv.iOwe, total: bal + saved + dv.owedToMe - dv.iOwe };
}

/** Records for a list view, newest first; each item tagged with its signed effect. */
export function activity(data, { from, to, types, cat, q } = {}) {
  const items = [];
  const debts = new Map(data.debt.map((d) => [d.id, d]));
  const people = new Map(data.person.map((p) => [p.id, p]));
  const goals = new Map(data.goal.map((g) => [g.id, g]));
  for (const t of data.txn) items.push({ kind: 'txn', rec: t, date: t.date, effect: txnEffect(t) });
  for (const d of data.debt) items.push({ kind: 'debt', rec: d, date: d.date, effect: debtEffect(d), person: people.get(d.person) });
  for (const p of data.pay) {
    const d = debts.get(p.debt);
    items.push({ kind: 'pay', rec: p, date: p.date, effect: payEffect(p, d), debt: d, person: d && people.get(d.person) });
  }
  for (const g of data.gtx) items.push({ kind: 'gtx', rec: g, date: g.date, effect: gtxEffect(g), goal: goals.get(g.goal) });
  return items
    .filter((i) => (!from || i.date >= from) && (!to || i.date <= to))
    .filter((i) => !types || types.has(i.kind === 'txn' ? i.rec.type : i.kind))
    .filter((i) => !cat || (i.kind === 'txn' && i.rec.cat === cat))
    .filter((i) => !q || q(i))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.rec.u || 0) - (a.rec.u || 0)));
}
