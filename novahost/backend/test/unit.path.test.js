import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { safeJoin, trySafeJoin } from '../src/util/fsx.js';

const ROOT = path.resolve('/data/storage/sites/project');

test('safeJoin resolves ordinary relative paths', () => {
  assert.equal(safeJoin(ROOT, 'index.html'), path.join(ROOT, 'index.html'));
  assert.equal(safeJoin(ROOT, 'css/style.css'), path.join(ROOT, 'css', 'style.css'));
  assert.equal(safeJoin(ROOT, ''), ROOT);
  assert.equal(safeJoin(ROOT, '/'), ROOT);
});

test('a leading slash is treated as root-relative, not absolute', () => {
  // Web paths start with "/" and mean "the site root", not "/etc".
  assert.equal(safeJoin(ROOT, '/index.html'), path.join(ROOT, 'index.html'));
  assert.equal(safeJoin(ROOT, '/etc/passwd'), path.join(ROOT, 'etc', 'passwd'));
});

test('safeJoin blocks directory traversal in every encoding', () => {
  const attacks = [
    '../../../etc/passwd',
    'a/../../b',
    'a/b/../../../c',
    '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '..%2fetc%2fpasswd',
    'css/../../../../root/.ssh/id_rsa',
  ];
  for (const attack of attacks) {
    assert.throws(() => safeJoin(ROOT, attack), /escape|not allowed|Invalid/i, `allowed: ${attack}`);
  }
});

test('safeJoin rejects backslashes and drive letters', () => {
  assert.throws(() => safeJoin(ROOT, '..\\..\\windows\\system32'));
  assert.throws(() => safeJoin(ROOT, 'C:\\Windows'));
  assert.throws(() => safeJoin(ROOT, 'C:/Windows'));
});

test('safeJoin rejects null bytes and control characters', () => {
  assert.throws(() => safeJoin(ROOT, 'index.html\u0000.txt'));
  assert.throws(() => safeJoin(ROOT, 'a\u0007b'));
});

test('a sibling directory with the root as a prefix is not inside the root', () => {
  // The classic startsWith() bug: "/data/storage/sites/project-evil" begins
  // with the root string but is a different directory.
  const escaped = trySafeJoin(ROOT, '../project-evil/secret');
  assert.equal(escaped, null);
});

test('trySafeJoin returns null instead of throwing', () => {
  assert.equal(trySafeJoin(ROOT, '../../etc/passwd'), null);
  assert.equal(trySafeJoin(ROOT, 'ok.html'), path.join(ROOT, 'ok.html'));
});

test('unicode and spaces in file names are allowed', () => {
  assert.equal(safeJoin(ROOT, 'صور/شعار.png'), path.join(ROOT, 'صور', 'شعار.png'));
  assert.equal(safeJoin(ROOT, 'my file.txt'), path.join(ROOT, 'my file.txt'));
});
