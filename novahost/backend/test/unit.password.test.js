import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, checkPasswordStrength } from '../src/util/password.js';

test('a password verifies against its own hash', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.ok(await verifyPassword('correct horse battery staple', hash));
});

test('a wrong password does not verify', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.ok(!await verifyPassword('correct horse battery stapler', hash));
  assert.ok(!await verifyPassword('', hash));
});

test('the same password hashes differently every time (unique salt)', async () => {
  const a = await hashPassword('same-password-here');
  const b = await hashPassword('same-password-here');
  assert.notEqual(a, b);
  assert.ok(await verifyPassword('same-password-here', a));
  assert.ok(await verifyPassword('same-password-here', b));
});

test('the stored format records its own parameters', async () => {
  const hash = await hashPassword('another-password');
  const parts = hash.split('$');
  assert.equal(parts.length, 6);
  assert.equal(parts[0], 'scrypt');
  assert.equal(Number(parts[1]), 16384);
});

test('verifyPassword returns false for malformed input instead of throwing', async () => {
  for (const bad of ['', 'not-a-hash', 'scrypt$only$three', 'bcrypt$1$2$3$4$5', null, undefined, 42]) {
    assert.equal(await verifyPassword('x', bad), false, `input: ${String(bad)}`);
  }
});

test('a tampered cost parameter cannot make us allocate gigabytes', async () => {
  // A hostile database row asking for N = 2^30 must be rejected, not honoured.
  const hostile = 'scrypt$1073741824$8$1$AAAA$AAAA';
  assert.equal(await verifyPassword('x', hostile), false);
});

test('unicode passwords normalise so the same typed password always works', async () => {
  // U+00E9 and "e" + U+0301 look identical and can both come from a keyboard.
  const composed = 'passwordé-long-enough';
  const decomposed = 'passworde\u0301-long-enough';
  const hash = await hashPassword(composed);
  assert.ok(await verifyPassword(decomposed, hash));
});

test('password policy rejects short and common passwords', () => {
  assert.ok(!checkPasswordStrength('short').ok);
  assert.deepEqual(checkPasswordStrength('short').errors, ['PASSWORD_TOO_SHORT']);
  assert.ok(checkPasswordStrength('mypassword123').errors.includes('PASSWORD_TOO_COMMON'));
  assert.ok(checkPasswordStrength('a-perfectly-fine-passphrase').ok);
});
