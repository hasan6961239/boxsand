import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDue, docToData, pruneSent, mergeSettings } from '../netlify/lib/notify.mjs';

// Africa/Tripoli is UTC+2 all year
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+02:00`);

function docOf(records) {
  const recs = {};
  for (const r of records) recs[r.id] = { u: 1, _r: 1, ...r };
  return { rev: 1, recs };
}

const settings = (extra = {}) => ({
  id: 'settings', col: 'settings', onboarded: true, opening: 0, openingDate: '2026-01-01',
  office: { on: true, amount: 2000000, day: 20, since: '2026-01' },
  notif: { daily: { on: true, time: '21:00' }, salary: true, debts: true, budget: true, recurring: true },
  tz: 'Africa/Tripoli',
  ...extra,
});

// salaries recorded for every month so the office cycle is "normal"
const salaries = ['2026-08', '2026-09', '2026-10'].map((k) => ({ id: `s${k}`, col: 'txn', type: 'salary', amount: 2000000, gross: 2000000, ded: 0, cycle: k, date: `${k}-20` }));

test('docToData groups live records, skips tombstones, merges settings', () => {
  const data = docToData(docOf([settings(), { id: 'a', col: 'txn', type: 'expense', amount: 5, date: '2026-10-01' }, { id: 'b', col: 'txn', d: 1 }]), '2026-10-21');
  assert.equal(data.txn.length, 1);
  assert.ok(!('_r' in data.txn[0]));
  assert.equal(data.settings.notif.daily.time, '21:00');
  assert.equal(data.settings.look.accent, 'emerald'); // from defaults
});

test('mergeSettings falls back to defaults for a deleted settings record', () => {
  const s = mergeSettings({ id: 'settings', d: 1 }, '2026-10-21');
  assert.equal(s.onboarded, false);
});

test('daily reminder fires at its time, not three hours later, and only once', () => {
  const doc = docOf([settings(), ...salaries]);
  const before = selectDue(doc, at('2026-10-21', '20:50'));
  assert.ok(!before.some((d) => d.key.startsWith('daily:')));
  const due = selectDue(doc, at('2026-10-21', '21:05'));
  const daily = due.find((d) => d.key === 'daily:2026-10-21');
  assert.ok(daily);
  assert.match(daily.body, /ما سجّلتش/);
  assert.ok(!selectDue(doc, at('2026-10-22', '00:10')).some((d) => d.key.startsWith('daily:')));
  const again = selectDue(doc, at('2026-10-21', '21:20'), { sent: { 'daily:2026-10-21': 1 } });
  assert.ok(!again.some((d) => d.key.startsWith('daily:')));
});

test('daily reminder mentions what was logged today', () => {
  const doc = docOf([settings(), ...salaries, { id: 'e', col: 'txn', type: 'expense', amount: 12500, cat: 'cat:food', date: '2026-10-21' }]);
  const daily = selectDue(doc, at('2026-10-21', '21:00')).find((d) => d.key.startsWith('daily:'));
  assert.match(daily.body, /سجّلت/);
});

test('payday eve at 10:00 and payday at 09:00', () => {
  const doc = docOf([settings(), ...salaries.slice(0, 3)]);
  // next payday is 2026-11-20
  assert.ok(!selectDue(doc, at('2026-11-19', '09:30')).some((d) => d.key.startsWith('salary-1')));
  assert.ok(selectDue(doc, at('2026-11-19', '10:05')).some((d) => d.key === 'salary-1:2026-11'));
  assert.ok(selectDue(doc, at('2026-11-20', '09:00')).some((d) => d.key === 'salary-0:2026-11'));
});

test('debt due tomorrow reminds at 10:00 with the person name', () => {
  const doc = docOf([
    settings(), ...salaries,
    { id: 'p', col: 'person', name: 'أحمد' },
    { id: 'd', col: 'debt', person: 'p', dir: 'in', amount: 300000, date: '2026-10-01', due: '2026-10-22', cash: true },
  ]);
  const due = selectDue(doc, at('2026-10-21', '10:30'));
  const r = due.find((x) => x.key === 'debt-1:d:2026-10-22');
  assert.ok(r);
  assert.match(r.body, /أحمد/);
  assert.equal(r.url, '#/person/p');
  assert.ok(typeof r.badge === 'number');
});

test('notification toggles off → nothing is sent', () => {
  const doc = docOf([settings({ notif: { daily: { on: false, time: '21:00' }, salary: false, debts: false, budget: false, recurring: false } }), ...salaries]);
  assert.deepEqual(selectDue(doc, at('2026-10-21', '21:00')), []);
});

test('user time zone is honoured', () => {
  const doc = docOf([settings({ tz: 'Africa/Tripoli' }), ...salaries]);
  // 19:05 UTC is 21:05 in Tripoli
  assert.ok(selectDue(doc, Date.parse('2026-10-21T19:05:00Z')).some((d) => d.key === 'daily:2026-10-21'));
  // with a subscription tz of UTC it's only 19:05 → nothing yet
  assert.ok(!selectDue(doc, Date.parse('2026-10-21T19:05:00Z'), { tz: 'UTC' }).some((d) => d.key.startsWith('daily:')));
});

test('pruneSent drops old keys', () => {
  const now = Date.parse('2026-10-21T00:00:00Z');
  const out = pruneSent({ old: now - 61 * 86400000, fresh: now - 86400000 }, now);
  assert.deepEqual(Object.keys(out), ['fresh']);
});
