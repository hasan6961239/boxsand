import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, slugifyOrFallback, isValidSlug, uniqueSlug, RESERVED_SLUGS } from '../src/util/slug.js';

test('slugify turns a plain name into a DNS label', () => {
  assert.equal(slugify('My Portfolio Website'), 'my-portfolio-website');
  assert.equal(slugify('  Spaced   Out  '), 'spaced-out');
  assert.equal(slugify('Hello_World!!'), 'hello-world');
  assert.equal(slugify('café-münchen'), 'cafe-munchen');
});

test('slugify transliterates Arabic instead of dropping it', () => {
  // The result only has to be a usable starting point the user can edit.
  assert.equal(slugify('موقعي'), 'mwqay');
  assert.match(slugify('موقعي الشخصي'), /^[a-z0-9-]+$/);
  assert.ok(slugify('موقعي الشخصي').length > 3);
});

test('slugify strips Arabic diacritics before transliterating', () => {
  assert.equal(slugify('مَوْقِعِي'), slugify('موقعي'));
});

test('slugify never produces a leading or trailing hyphen', () => {
  for (const input of ['---abc---', '!!!x!!!', '  -y-  ', '...z...']) {
    const result = slugify(input);
    assert.ok(!result.startsWith('-'), `"${result}" starts with a hyphen`);
    assert.ok(!result.endsWith('-'), `"${result}" ends with a hyphen`);
  }
});

test('slugify caps length at the 63-character DNS label limit', () => {
  const slug = slugify('a'.repeat(200));
  assert.ok(slug.length <= 63);
});

test('isValidSlug enforces the DNS label rules', () => {
  assert.ok(isValidSlug('my-site'));
  assert.ok(isValidSlug('a'));
  assert.ok(isValidSlug('site2026'));

  assert.ok(!isValidSlug(''), 'empty');
  assert.ok(!isValidSlug('-lead'), 'leading hyphen');
  assert.ok(!isValidSlug('trail-'), 'trailing hyphen');
  assert.ok(!isValidSlug('Upper'), 'uppercase');
  assert.ok(!isValidSlug('has space'), 'space');
  assert.ok(!isValidSlug('has.dot'), 'dot would add a DNS level');
  assert.ok(!isValidSlug('a'.repeat(64)), 'too long');
  assert.ok(!isValidSlug('12345'), 'all digits is ambiguous with an IP octet');
});

test('reserved platform names cannot be claimed by a project', () => {
  for (const reserved of ['api', 'panel', 'www', 'admin', 's']) {
    assert.ok(RESERVED_SLUGS.has(reserved));
    assert.ok(!isValidSlug(reserved), `${reserved} should be rejected`);
  }
});

test('slugifyOrFallback always returns something usable', () => {
  assert.equal(slugifyOrFallback('Fine Name', 'fb'), 'fine-name');
  assert.equal(slugifyOrFallback('🎉🎉🎉', 'fb-123'), 'fb-123');
  assert.equal(slugifyOrFallback('', 'fb-123'), 'fb-123');
  // A name that transliterates to a reserved word must not slip through.
  assert.notEqual(slugifyOrFallback('API', 'fb-123'), 'api');
});

test('uniqueSlug appends a counter rather than failing', () => {
  const taken = new Set(['blog', 'blog-2', 'blog-3']);
  assert.equal(uniqueSlug('blog', (s) => taken.has(s)), 'blog-4');
  assert.equal(uniqueSlug('fresh', (s) => taken.has(s)), 'fresh');
});

test('uniqueSlug keeps the result within the length limit', () => {
  const base = 'a'.repeat(63);
  const result = uniqueSlug(base, (s) => s === base);
  assert.ok(result.length <= 63);
  assert.ok(isValidSlug(result));
});
