import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../src/js/core/finance.js';
import { DEFAULT_CATEGORIES, defaultSettings } from '../src/js/core/defaults.js';
import { attention, pushDue } from '../src/js/core/reminders.js';

let n = 0;
const id = () => `r${++n}`;

function mk({ settings = {}, ...cols } = {}) {
  const base = defaultSettings('2026-10-01');
  const s = { ...base, ...settings };
  for (const k of ['office', 'state', 'notif', 'look']) s[k] = { ...base[k], ...(settings[k] || {}) };
  const data = { txn: [], cat: [...DEFAULT_CATEGORIES], person: [], debt: [], pay: [], goal: [], gtx: [], rule: [], budget: [], nlog: [], settings: s };
  for (const [k, v] of Object.entries(cols)) data[k] = v.map((r) => ({ id: id(), u: 1, ...r }));
  return data;
}
const exp = (amount, date, cat = 'cat:food') => ({ type: 'expense', amount, date, cat });

/* --------------------------------------------------------------- balance */

test('balance: opening + each record type, history before the opening date excluded', () => {
  const d = mk({
    settings: { opening: 1000000, openingDate: '2026-10-01' },
    txn: [
      exp(50000, '2026-10-02'),
      exp(999000, '2026-09-30'), // before opening: already inside the opening amount
      { type: 'income', amount: 100000, date: '2026-10-03', cat: 'cat:in-other' },
      { type: 'advance', amount: 200000, date: '2026-10-05', cycle: '2026-10' },
      { type: 'salary', amount: 1800000, gross: 2000000, ded: 200000, date: '2026-10-20', cycle: '2026-10' },
      { type: 'state', amount: 650000, date: '2026-10-18' },
      { type: 'adjust', amount: -30000, date: '2026-10-21' },
      { type: 'carry', amount: 500000, date: '2026-10-20', cycle: '2026-11' },
    ],
  });
  assert.equal(F.balance(d), 1000000 - 50000 + 100000 + 200000 + 1800000 + 650000 - 30000);
  assert.equal(F.balance(d, '2026-10-04'), 1000000 - 50000 + 100000);
});

test('balance: debts only move cash when cash=true; payments always do', () => {
  const debts = [
    { id: 'lent', person: 'p', dir: 'in', amount: 300000, date: '2026-10-02', cash: true },
    { id: 'borrowed', person: 'p', dir: 'out', amount: 500000, date: '2026-10-02', cash: true },
    { id: 'credit', person: 'p', dir: 'out', amount: 80000, date: '2026-10-02', cash: false },
  ];
  const d = mk({ settings: { opening: 0, openingDate: '2026-10-01' } });
  d.debt = debts;
  d.pay = [{ id: 'p1', debt: 'lent', amount: 100000, date: '2026-10-05' }, { id: 'p2', debt: 'credit', amount: 80000, date: '2026-10-06' }];
  assert.equal(F.balance(d), -300000 + 500000 + 100000 - 80000);
});

test('balance: goal deposits leave the balance, withdrawals return', () => {
  const d = mk({ settings: { opening: 1000000, openingDate: '2026-10-01' }, gtx: [{ goal: 'g', amount: 300000, date: '2026-10-02' }, { goal: 'g', amount: -100000, date: '2026-10-03' }] });
  assert.equal(F.balance(d), 800000);
});

/* --------------------------------------------------------- office salary */

test('cycleForDate: on/before payday → this month, after → next', () => {
  assert.equal(F.cycleForDate('2026-10-19', 20), '2026-10');
  assert.equal(F.cycleForDate('2026-10-20', 20), '2026-10');
  assert.equal(F.cycleForDate('2026-10-21', 20), '2026-11');
  assert.equal(F.cycleForDate('2026-12-25', 20), '2027-01');
  assert.equal(F.cycleForDate('2026-02-28', 31), '2026-02'); // payday clamps to Feb 28
  assert.equal(F.payday('2026-02', 31), '2026-02-28');
});

test('officeStatus: countdown, payday, received, late, and `since` prevents false lateness', () => {
  const s = { office: { on: true, amount: 2000000, day: 20, since: '2026-10' } };
  let d = mk({ settings: s });
  let o = F.officeStatus(d, '2026-10-15');
  assert.equal(o.key, '2026-10');
  assert.equal(o.daysLeft, 5);
  assert.equal(o.late, false);

  o = F.officeStatus(d, '2026-10-20');
  assert.equal(o.isToday, true);

  o = F.officeStatus(d, '2026-10-23'); // October unpaid → late
  assert.equal(o.key, '2026-10');
  assert.equal(o.late, true);
  assert.equal(o.daysLeft, -3);

  d = mk({ settings: s, txn: [{ type: 'salary', amount: 2000000, gross: 2000000, ded: 0, cycle: '2026-10', date: '2026-10-20' }] });
  assert.equal(F.officeStatus(d, '2026-10-23').key, '2026-11');
  assert.equal(F.officeStatus(d, '2026-10-19').key, '2026-11'); // received early

  // user started on the 25th (since = next month): no "late" for October
  d = mk({ settings: { office: { on: true, amount: 2000000, day: 20, since: '2026-11' } } });
  o = F.officeStatus(d, '2026-10-25');
  assert.equal(o.key, '2026-11');
  assert.equal(o.late, false);
});

test('drawer withdrawals reduce the expected net', () => {
  const d = mk({
    settings: { office: { on: true, amount: 2000000, day: 20, since: '2026-10' } },
    txn: [{ type: 'advance', amount: 200000, date: '2026-10-08', cycle: '2026-10' }, { type: 'advance', amount: 150000, date: '2026-10-15', cycle: '2026-10' }, { type: 'advance', amount: 50000, date: '2026-10-21', cycle: '2026-11' }],
  });
  const o = F.officeStatus(d, '2026-10-18');
  assert.equal(o.advTotal, 350000);
  assert.equal(o.expectedNet, 1650000);
  assert.equal(o.deductions.length, 2);
});

test('defaultAdvanceCycle: before/after payday, after salary recorded, while late', () => {
  const s = { office: { on: true, amount: 2000000, day: 20, since: '2026-09' } };
  const paidSep = { type: 'salary', amount: 1, cycle: '2026-09', date: '2026-09-20' };
  let d = mk({ settings: s, txn: [paidSep] });
  assert.equal(F.defaultAdvanceCycle(d, '2026-10-10'), '2026-10');
  // October salary still unrecorded on the 25th → withdrawal comes out of that late salary
  assert.equal(F.defaultAdvanceCycle(d, '2026-10-25'), '2026-10');
  d = mk({ settings: s, txn: [paidSep, { type: 'salary', amount: 1, cycle: '2026-10', date: '2026-10-18' }] });
  assert.equal(F.defaultAdvanceCycle(d, '2026-10-19'), '2026-11'); // October already paid early
  assert.equal(F.defaultAdvanceCycle(d, '2026-10-25'), '2026-11');
});

test('salaryDraft: net and carry when withdrawals exceed the salary', () => {
  const d = mk({ txn: [{ type: 'advance', amount: 2300000, date: '2026-10-10', cycle: '2026-10' }] });
  assert.deepEqual(F.salaryDraft(d, '2026-10', 2000000), { key: '2026-10', gross: 2000000, ded: 2300000, net: 0, carry: 300000 });
  const d2 = mk({ txn: [{ type: 'advance', amount: 300000, date: '2026-10-10', cycle: '2026-10' }] });
  assert.equal(F.salaryDraft(d2, '2026-10', 2000000).net, 1700000);
});

/* --------------------------------------------------------------- periods */

test('periods: payday mode runs 20 → 19, month mode 1 → end, fallback when office is off', () => {
  const s = mk().settings;
  let p = F.periodOf('2026-10-21', s);
  assert.equal(p.start, '2026-10-20');
  assert.equal(p.end, '2026-11-19');
  p = F.periodOf('2026-10-19', s);
  assert.equal(p.start, '2026-09-20');
  assert.equal(p.end, '2026-10-19');
  p = F.periodOf('2026-12-28', s);
  assert.equal(p.end, '2027-01-19');
  assert.equal(F.shiftPeriod(p, 1, s).start, '2027-01-20');

  const m = { ...s, period: 'month' };
  p = F.periodOf('2026-02-10', m);
  assert.equal(p.start, '2026-02-01');
  assert.equal(p.end, '2026-02-28');
  const off = { ...s, office: { ...s.office, on: false } };
  assert.equal(F.periodOf('2026-10-21', off).start, '2026-10-01');
});

/* ---------------------------------------------------------------- budget */

test('budget: status, daily allowance in whole dinars, alerts at 80 and 100', () => {
  const d = mk({
    txn: [exp(850000, '2026-10-21'), exp(100000, '2026-10-22', 'cat:coffee')],
    budget: [{ id: 'budget:total', amount: 1000000 }, { id: 'budget:cat:cat:coffee', cat: 'cat:coffee', amount: 100000 }],
  });
  const p = F.periodOf('2026-10-22', d.settings);
  const b = F.budgetStatus(d, p, '2026-10-22');
  assert.equal(b.total.spent, 950000);
  assert.equal(b.daysLeft, 29); // 22 Oct → 19 Nov inclusive
  assert.equal(b.daily, 1000); // 50 dinars / 29 days → floored to 1 dinar
  const keys = F.budgetAlerts(d, p, '2026-10-22').map((a) => a.key).sort();
  assert.deepEqual(keys, ['budget:2026-10:cat:coffee:100', 'budget:2026-10:total:80']);
});

/* ----------------------------------------------------------------- debts */

test('debts: remaining, settled, overdue and per-person net', () => {
  const d = mk({ person: [{ id: 'p', name: 'أحمد' }] });
  d.person[0].id = 'p';
  d.debt = [
    { id: 'a', person: 'p', dir: 'in', amount: 300000, date: '2026-10-01', due: '2026-10-10', cash: true },
    { id: 'b', person: 'p', dir: 'out', amount: 100000, date: '2026-10-02', cash: true },
  ];
  d.pay = [{ id: 'x', debt: 'a', amount: 100000, date: '2026-10-05' }, { id: 'y', debt: 'b', amount: 100000, date: '2026-10-06' }];
  const ov = F.debtsOverview(d, '2026-10-21');
  assert.equal(ov.owedToMe, 200000);
  assert.equal(ov.iOwe, 0);
  assert.equal(ov.overdue.length, 1);
  assert.equal(ov.people[0].net, 200000);
  const info = ov.infos.find((i) => i.debt.id === 'b');
  assert.equal(info.settled, true);
  assert.equal(info.settledOn, '2026-10-06');
  const led = F.personLedger(d, 'p', '2026-10-21');
  assert.deepEqual(led.rows.map((r) => r.running), [300000, 200000, 100000, 200000]);
});

/* ------------------------------------------------------------- recurring */

test('recurring: due occurrences, short months, deleted occurrences stay deleted', () => {
  const d = mk({ rule: [{ name: 'إيجار', amount: 500000, cat: 'cat:home', day: 31, active: true, start: '2026-01' }] });
  const ruleId = d.rule[0].id;
  const occ = F.dueRuleOccurrences(d, '2026-03-05', () => false);
  assert.deepEqual(occ.map((o) => o.date), ['2026-01-31', '2026-02-28']);
  assert.equal(occ[0].id, `rec:${ruleId}:2026-01`);
  const deleted = new Set([`rec:${ruleId}:2026-01`]);
  assert.deepEqual(F.dueRuleOccurrences(d, '2026-03-05', (x) => deleted.has(x)).map((o) => o.key), ['2026-02']);
  d.rule[0].active = false;
  assert.deepEqual(F.dueRuleOccurrences(d, '2026-03-05', () => false), []);
  assert.equal(F.nextRuleDate({ day: 5, start: '2026-01' }, '2026-10-21'), '2026-11-05');
  assert.equal(F.nextRuleDate({ day: 25, start: '2026-01' }, '2026-10-21'), '2026-10-25');
});

/* ----------------------------------------------------------------- goals */

test('goalInfo: progress and monthly amount in whole dinars', () => {
  const g = { id: 'g', target: 15000000, due: '2027-10-21' };
  const i = F.goalInfo(g, [{ amount: 1600000 }], '2026-10-21');
  assert.equal(i.remaining, 13400000);
  assert.equal(i.monthly % 1000, 0);
  assert.ok(i.pct > 10 && i.pct < 11);
});

/* ------------------------------------------------------------- reminders */

test('attention: payday today, overdue debt, budget top level only', () => {
  const d = mk({
    settings: { office: { on: true, amount: 2000000, day: 20, since: '2026-10' } },
    txn: [exp(1100000, '2026-10-20')],
    budget: [{ id: 'budget:total', amount: 1000000 }],
  });
  d.person = [{ id: 'p', name: 'سالم' }];
  d.debt = [{ id: 'z', person: 'p', dir: 'out', amount: 500000, date: '2026-09-01', due: '2026-10-15', cash: true }];
  const items = attention(d, '2026-10-20');
  const kinds = items.map((i) => i.kind);
  assert.ok(kinds.includes('salary'));
  assert.ok(kinds.includes('debt'));
  assert.equal(items.filter((i) => i.kind === 'budget').length, 1);
  assert.match(items.find((i) => i.kind === 'budget').key, /:100$/);
});

test('pushDue: budget alert suppressed when the app already showed it', () => {
  const d = mk({ txn: [exp(900000, '2026-10-21')], budget: [{ id: 'budget:total', amount: 1000000 }] });
  const now = { date: '2026-10-21', minutes: 14 * 60 };
  assert.ok(pushDue(d, now, new Set()).some((x) => x.key === 'budget:2026-10:total:80'));
  d.nlog = [{ id: 'nlog:budget:2026-10:total:80' }];
  assert.ok(!pushDue(d, now, new Set()).some((x) => x.tag === 'budget'));
  // quiet at night
  d.nlog = [];
  assert.ok(!pushDue(d, { date: '2026-10-21', minutes: 23 * 60 + 30 }, new Set()).some((x) => x.tag === 'budget'));
});
