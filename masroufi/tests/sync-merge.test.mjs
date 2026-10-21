import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, sanitize, HttpError } from '../netlify/lib/merge.mjs';

const rec = (id, u, extra = {}) => ({ id, col: 'txn', u, type: 'expense', amount: 1000, date: '2026-10-20', ...extra });
const ids = (list) => list.map((r) => r.id).sort();

test('new user: accepts everything and returns it', () => {
  const r = merge(null, [rec('a', 1), rec('b', 2)], 0);
  assert.equal(r.changed, true);
  assert.equal(r.rev, 1);
  assert.deepEqual(ids(r.changes), ['a', 'b']);
  assert.equal(r.doc.recs.a._r, 1);
  assert.ok(!('_r' in r.changes[0]));
});

test('newer u wins, older and equal u are ignored', () => {
  const d1 = merge(null, [rec('a', 10, { amount: 1 })], 0).doc;
  const older = merge(d1, [rec('a', 5, { amount: 2 })], 1);
  assert.equal(older.changed, false);
  assert.equal(older.doc.recs.a.amount, 1);
  const equal = merge(d1, [rec('a', 10, { amount: 3 })], 1);
  assert.equal(equal.changed, false);
  const newer = merge(d1, [rec('a', 11, { amount: 4 })], 1);
  assert.equal(newer.changed, true);
  assert.equal(newer.doc.recs.a.amount, 4);
  assert.equal(newer.rev, 2);
});

test('since filters to records accepted after it', () => {
  let d = merge(null, [rec('a', 1)], 0).doc; // rev 1
  d = merge(d, [rec('b', 1)], 1).doc; // rev 2
  const r = merge(d, [], 1);
  assert.equal(r.changed, false);
  assert.deepEqual(ids(r.changes), ['b']);
  assert.deepEqual(merge(d, [], 2).changes, []);
});

test('since beyond the server revision (server reset) returns everything', () => {
  const d = merge(null, [rec('a', 1), rec('b', 1)], 0).doc;
  assert.deepEqual(ids(merge(d, [], 99).changes), ['a', 'b']);
});

test('tombstones replace live records and sync out', () => {
  const d = merge(null, [rec('a', 1)], 0).doc;
  const r = merge(d, [{ id: 'a', col: 'txn', u: 2, d: 1 }], 1);
  assert.equal(r.doc.recs.a.d, 1);
  assert.deepEqual(r.changes, [{ id: 'a', col: 'txn', u: 2, d: 1 }]);
});

test('replaying the same changes is idempotent', () => {
  const first = merge(null, [rec('a', 1)], 0);
  const again = merge(first.doc, [rec('a', 1)], first.rev);
  assert.equal(again.changed, false);
  assert.equal(again.rev, first.rev);
  assert.deepEqual(again.changes, []);
});

test('two devices interleaving converge', () => {
  // device A creates x; device B (offline) creates y and edits x later
  let doc = merge(null, [rec('x', 100, { amount: 1 })], 0).doc; // A at rev 1
  const b = merge(doc, [rec('y', 150), rec('x', 200, { amount: 2 })], 0); // B pulled nothing before
  doc = b.doc;
  assert.deepEqual(ids(b.changes), ['x', 'y']);
  // A edits x with an older clock: loses
  const a2 = merge(doc, [rec('x', 120, { amount: 3 })], 1);
  assert.equal(a2.changed, false);
  assert.deepEqual(ids(a2.changes), ['x', 'y']); // A learns B's version
  assert.equal(a2.changes.find((r) => r.id === 'x').amount, 2);
});

test('sanitize validates and strips client-only fields', () => {
  assert.deepEqual(sanitize(undefined), []);
  const [c] = sanitize([{ ...rec('a', 1), dirty: 1, _r: 7 }]);
  assert.ok(!('dirty' in c) && !('_r' in c));
  for (const bad of [[null], [{ id: '', col: 'txn', u: 1 }], [{ id: 'a', col: 'evil', u: 1 }], [{ id: 'a', col: 'txn', u: -1 }], [{ id: 'a', col: 'txn', u: 'x' }], [{ id: 'x'.repeat(201), col: 'txn', u: 1 }]]) {
    assert.throws(() => sanitize(bad), HttpError);
  }
  assert.throws(() => sanitize('nope'), HttpError);
  assert.throws(() => sanitize(Array.from({ length: 5001 }, (_, i) => rec(`r${i}`, 1))), (e) => e.status === 413);
  assert.throws(() => sanitize([rec('a', 1, { note: 'x'.repeat(20000) })]), (e) => e.status === 413);
});
