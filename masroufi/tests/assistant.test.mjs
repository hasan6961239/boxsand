import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/js/core/calc.js';
import { planActions, runQuery, snapshot, appliedResult } from '../src/js/core/ai-data.js';
import { DEFAULT_CATEGORIES, defaultSettings } from '../src/js/core/defaults.js';
import * as F from '../src/js/core/finance.js';

const T = '2026-10-21';

function mk(cols = {}) {
  const s = { ...defaultSettings('2026-10-01'), opening: 500000, openingDate: '2026-10-01' };
  const data = { txn: [], cat: [...DEFAULT_CATEGORIES], person: [], debt: [], pay: [], goal: [], gtx: [], rule: [], budget: [], nlog: [], settings: s };
  for (const [k, v] of Object.entries(cols)) data[k] = v.map((r) => ({ u: 1, ...r }));
  return data;
}

const A = (o) => ({ kind: '', ref: '', amount: 0, date: '', note: '', category: '', person: '', name: '', phone: '', dir: '', cash: false, debt: '', due: '', month: '', ...o });

/** Apply a plan to a plain data object, like store.put would. */
function apply(data, plan) {
  const next = { ...data };
  for (const { col, rec } of plan.ops) next[col] = [...next[col].filter((r) => r.id !== rec.id), rec];
  return next;
}

/* ------------------------------------------------------------ calc */

test('calculate: precedence, parentheses, percent, Arabic digits and separators', () => {
  assert.equal(evaluate('(3 * 45) + 20 - 12.5'), 142.5);
  assert.equal(evaluate('٣ × ٤٥ + ٢٠'), 155);
  assert.equal(evaluate('1,250 + 1٫5'), 1251.5);
  assert.equal(evaluate('200 * 15%'), 30);
  assert.equal(evaluate('-(10 - 4) / 4'), -1.5);
  assert.equal(evaluate('2(3+4)'), 14);
  assert.equal(evaluate('10 ÷ 3'), 3.333);
  assert.throws(() => evaluate('2 +'));
  assert.throws(() => evaluate('alert(1)'));
  assert.throws(() => evaluate('5 / 0'));
});

/* ------------------------------------------------------------ the owner's example */

test('plan: borrowed 100 from a new person, then bought him things for 20 off that debt → owe 80', () => {
  const data = mk();
  const plan = planActions(data, [
    A({ kind: 'new_person', ref: 'p1', name: 'عز الدين' }),
    A({ kind: 'debt', ref: 'd1', person: 'p1', dir: 'out', amount: 100, cash: true }),
    A({ kind: 'payment', debt: 'd1', dir: 'out', amount: 20, note: 'حوايج من المحل' }),
  ], T);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.ops.length, 3);
  assert.equal(plan.effects.balance.before, 500000);
  assert.equal(plan.effects.balance.after, 500000 + 100000 - 20000);
  assert.equal(plan.effects.people.length, 1);
  assert.equal(plan.effects.people[0].name, 'عز الدين');
  assert.equal(plan.effects.people[0].after, -80000); // I owe him 80
  const after = apply(data, plan);
  const led = F.personLedger(after, plan.effects.people[0].id, T);
  assert.equal(led.net, -80000);
  const r = appliedResult(plan);
  assert.deepEqual(r.people_now, [{ name: 'عز الدين', they_owe_you: 0, you_owe_them: 80 }]);
});

test('plan: an existing person is reused instead of duplicated; payment picks the oldest open debt', () => {
  const data = mk({
    person: [{ id: 'az', name: 'عزالدين' }],
    debt: [
      { id: 'old', person: 'az', dir: 'out', amount: 50000, date: '2026-10-02', cash: true },
      { id: 'new', person: 'az', dir: 'out', amount: 100000, date: '2026-10-10', cash: true },
    ],
  });
  const plan = planActions(data, [
    A({ kind: 'new_person', ref: 'p1', name: 'عز الدين' }),
    A({ kind: 'payment', person: 'p1', dir: 'out', amount: 30 }),
  ], T);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.ops.length, 1);
  assert.equal(plan.ops[0].col, 'pay');
  assert.equal(plan.ops[0].rec.debt, 'old');
  assert.equal(plan.effects.people[0].after, -(150000 - 30000));
});

test('plan: rejects a payment larger than what is left, unknown people and bad dates', () => {
  const data = mk({
    person: [{ id: 'ali', name: 'علي' }],
    debt: [{ id: 'd', person: 'ali', dir: 'in', amount: 40000, date: '2026-10-02', cash: true }],
    pay: [{ id: 'p', debt: 'd', amount: 30000, date: '2026-10-05' }],
  });
  const plan = planActions(data, [
    A({ kind: 'payment', debt: 'd', dir: 'in', amount: 20 }),
    A({ kind: 'debt', person: 'nobody', dir: 'in', amount: 5 }),
    A({ kind: 'expense', amount: 5, date: '2026-02-30', category: 'cat:food' }),
  ], T);
  assert.equal(plan.ok, false);
  assert.equal(plan.errors.length, 3);
  assert.match(plan.errors[0], /more than the 10 left/);
  assert.match(plan.errors[1], /unknown person/);
  assert.match(plan.errors[2], /bad date/);
});

test('plan: expenses fall back to «أخرى» for an unknown category; drawer withdrawals get their salary cycle', () => {
  const data = mk({ txn: [{ id: 's10', type: 'salary', amount: 2000000, gross: 2000000, ded: 0, cycle: '2026-10', date: '2026-10-20' }] });
  const plan = planActions(data, [
    A({ kind: 'expense', amount: 35, category: 'cat:nope', note: 'غدا' }),
    A({ kind: 'advance', amount: 200, date: '2026-10-22' }),
  ], T);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.ops[0].rec.cat, 'cat:other');
  assert.equal(plan.ops[0].rec.amount, 35000);
  assert.equal(plan.ops[1].rec.cycle, '2026-11'); // after the 20th → next payday
  assert.equal(plan.effects.balance.after, 500000 + 2000000 - 35000 + 200000);
});

test('plan: office salary nets out the drawer withdrawals of its cycle', () => {
  const data = mk({ txn: [{ id: 'a1', type: 'advance', amount: 300000, date: '2026-10-05', cycle: '2026-10' }] });
  data.settings.office = { ...data.settings.office, since: '2026-10' };
  const plan = planActions(data, [A({ kind: 'office_salary', amount: 2000, date: '2026-10-20' })], T);
  assert.deepEqual(plan.errors, []);
  const rec = plan.ops[0].rec;
  assert.equal(rec.type, 'salary');
  assert.equal(rec.cycle, '2026-10');
  assert.equal(rec.amount, 1700000);
  assert.equal(rec.ded, 300000);
  // recording the same salary twice is refused
  const again = planActions(apply(data, plan), [A({ kind: 'office_salary', amount: 2000, date: '2026-10-20' })], '2026-10-20');
  assert.match(again.errors[0] || '', /already recorded/);
});

/* ------------------------------------------------------------ queries & snapshot */

test('query: transactions grouped by category with totals; person statement', () => {
  const data = mk({
    person: [{ id: 'ali', name: 'علي' }],
    debt: [{ id: 'd', person: 'ali', dir: 'in', amount: 40000, date: '2026-10-02', cash: true }],
    txn: [
      { id: 't1', type: 'expense', amount: 10000, date: '2026-10-03', cat: 'cat:food', note: 'غدا' },
      { id: 't2', type: 'expense', amount: 5500, date: '2026-10-04', cat: 'cat:food' },
      { id: 't3', type: 'expense', amount: 20000, date: '2026-10-04', cat: 'cat:fuel' },
    ],
  });
  const r = runQuery(data, { kind: 'transactions', from: '2026-10-01', to: '', type: 'expense', category: '', person: '', search: '', group_by: 'category' }, T);
  assert.equal(r.count, 3);
  assert.equal(r.total, 35.5);
  assert.deepEqual(r.groups.map((g) => [g.key, g.total]), [['بنزين ومواصلات', 20], ['أكل ومطاعم', 15.5]]);
  const s = runQuery(data, { kind: 'transactions', from: '', to: '', type: '', category: '', person: '', search: 'غدا', group_by: 'none' }, T);
  assert.equal(s.count, 1);
  const p = runQuery(data, { kind: 'person', from: '', to: '', type: '', category: '', person: 'ali', search: '', group_by: 'none' }, T);
  assert.equal(p.net, 40);
  assert.equal(p.net_meaning, 'they owe you');
  const snap = snapshot(data, T);
  assert.equal(snap.balance, 500 - 40 - 35.5);
  assert.equal(snap.people[0].they_owe_you, 40);
  assert.ok(snap.categories.expense.some((c) => c.id === 'cat:food'));
  assert.ok(JSON.stringify(snap).length < 8000);
});
