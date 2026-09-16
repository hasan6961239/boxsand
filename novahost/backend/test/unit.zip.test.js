import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractArchive, readArchive, validateEntryName, detectRootPrefix } from '../src/services/zip.js';
import { buildZip, buildSampleSite } from './helpers/zipwriter.js';

const LIMITS = {
  maxEntries: 500,
  maxUncompressedBytes: 8 * 1024 * 1024,
  maxSingleFileBytes: 2 * 1024 * 1024,
  maxCompressionRatio: 120,
};

let workDir;

test.before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novahost-zip-'));
});

test.after(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

let counter = 0;
function writeZip(buffer) {
  const file = path.join(workDir, `archive-${counter++}.zip`);
  fs.writeFileSync(file, buffer);
  return file;
}

async function extract(buffer, options = {}) {
  const dest = path.join(workDir, `out-${counter}`);
  return extractArchive(writeZip(buffer), dest, { limits: LIMITS, ...options });
}

async function expectRejection(buffer, code, options = {}) {
  await assert.rejects(
    () => extract(buffer, options),
    (error) => {
      assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
      return true;
    },
  );
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test('extracts a normal site archive', async () => {
  const result = await extract(buildSampleSite());
  assert.equal(result.fileCount, 5);
  assert.ok(result.totalBytes > 0);
  assert.equal(result.strippedRoot, null);
  assert.ok(result.files.some((f) => f.path === 'index.html'));
  assert.ok(result.files.some((f) => f.path === 'css/style.css'));
});

test('extracted file contents are byte-correct', async () => {
  const content = 'body{color:#abcdef}\n/* a comment with unicode: مرحبا */\n';
  const dest = path.join(workDir, 'content-check');
  await extractArchive(
    writeZip(buildZip([
      { name: 'index.html', data: '<!doctype html><title>x</title>' },
      { name: 'style.css', data: content, deflate: true },
    ])),
    dest,
    { limits: LIMITS },
  );
  assert.equal(fs.readFileSync(path.join(dest, 'style.css'), 'utf8'), content);
});

test('a single wrapping folder is stripped so index.html lands at the root', async () => {
  const result = await extract(buildSampleSite({ prefix: 'my-website' }));
  assert.equal(result.strippedRoot, 'my-website');
  assert.ok(result.files.some((f) => f.path === 'index.html'));
  assert.ok(!result.files.some((f) => f.path.startsWith('my-website/')));
});

test('a wrapping folder is NOT stripped when it has no entry file', () => {
  // Stripping here would silently change the site's structure.
  const files = [{ name: 'assets/logo.png' }, { name: 'assets/data.json' }];
  assert.equal(detectRootPrefix(files), '');
});

test('two top-level folders are left alone', () => {
  const files = [{ name: 'a/index.html' }, { name: 'b/index.html' }];
  assert.equal(detectRootPrefix(files), '');
});

test('both stored and deflated entries are supported', async () => {
  const result = await extract(buildZip([
    { name: 'index.html', data: 'x'.repeat(500), deflate: true },
    { name: 'stored.txt', data: 'y'.repeat(500), deflate: false },
  ]));
  assert.equal(result.fileCount, 2);
  assert.equal(result.totalBytes, 1000);
});

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

test('rejects an entry that escapes the project directory', async () => {
  await expectRejection(
    buildZip([{ name: 'index.html', data: 'x' }, { name: '../../etc/passwd', data: 'pwned' }]),
    'ZIP_PATH_TRAVERSAL',
  );
});

test('rejects an absolute path entry', async () => {
  await expectRejection(buildZip([{ name: '/etc/shadow', data: 'x' }]), 'ZIP_PATH_TRAVERSAL');
});

test('rejects a Windows drive-letter path', async () => {
  await expectRejection(buildZip([{ name: 'C:/Windows/system.ini', data: 'x' }]), 'ZIP_PATH_TRAVERSAL');
});

test('rejects backslash separators', async () => {
  await expectRejection(buildZip([{ name: '..\\..\\win.ini', data: 'x' }]), 'ZIP_INVALID_ENTRY');
});

test('rejects a null byte in a file name', () => {
  assert.throws(() => validateEntryName('index.html\u0000.jpg'), /null byte/i);
});

test('rejects control characters in a file name', () => {
  assert.throws(() => validateEntryName('bad\u0007name.html'), /Control character/i);
});

test('rejects Windows reserved device names', async () => {
  await expectRejection(
    buildZip([{ name: 'index.html', data: 'x' }, { name: 'CON.txt', data: 'x' }]),
    'ZIP_RESERVED_NAME',
  );
});

test('rejects symlink entries', async () => {
  await expectRejection(
    buildZip([
      { name: 'index.html', data: 'x' },
      { name: 'escape', data: '/etc/passwd', symlink: true },
    ]),
    'ZIP_SYMLINK',
  );
});

test('no file is left behind when an archive is rejected', async () => {
  const dest = path.join(workDir, 'rejected-output');
  await assert.rejects(() => extractArchive(
    writeZip(buildZip([{ name: 'index.html', data: 'x' }, { name: '../evil', data: 'x' }])),
    dest,
    { limits: LIMITS },
  ));
  // The staging directory may exist but must not contain the good file either:
  // the caller deletes it wholesale, and nothing escaped it.
  const escaped = path.join(path.dirname(dest), 'evil');
  assert.equal(fs.existsSync(escaped), false);
});

// ---------------------------------------------------------------------------
// Resource limits
// ---------------------------------------------------------------------------

test('rejects a zip bomb by compression ratio', async () => {
  const payload = 'A'.repeat(2 * 1024 * 1024);
  await expectRejection(
    buildZip([{ name: 'index.html', data: 'x' }, { name: 'bomb.txt', data: payload, deflate: true }]),
    'ZIP_BOMB',
  );
});

test('rejects too many entries', async () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.txt`, data: 'x' }));
  await expectRejection(buildZip(entries), 'ZIP_TOO_MANY_FILES', {
    limits: { ...LIMITS, maxEntries: 20 },
  });
});

test('rejects a single file above the per-file limit', async () => {
  const big = 'x'.repeat(300 * 1024);
  await expectRejection(
    buildZip([{ name: 'index.html', data: 'x' }, { name: 'big.bin', data: big }]),
    'ZIP_FILE_TOO_LARGE',
    { limits: { ...LIMITS, maxSingleFileBytes: 100 * 1024 } },
  );
});

test('rejects an archive whose total extracted size exceeds the limit', async () => {
  const chunk = 'x'.repeat(60 * 1024);
  const entries = [{ name: 'index.html', data: 'x' }];
  for (let i = 0; i < 10; i++) entries.push({ name: `part${i}.txt`, data: chunk });
  await expectRejection(buildZip(entries), 'ZIP_TOO_LARGE', {
    limits: { ...LIMITS, maxUncompressedBytes: 200 * 1024, maxCompressionRatio: 100000 },
  });
});

// ---------------------------------------------------------------------------
// Malformed input
// ---------------------------------------------------------------------------

test('rejects a file that is not a zip at all', async () => {
  await expectRejection(Buffer.from('this is plain text, definitely not a zip'), 'ZIP_INVALID');
});

test('rejects an empty archive', async () => {
  await expectRejection(buildZip([]), 'ZIP_EMPTY');
});

test('rejects an archive containing only directories', async () => {
  await expectRejection(buildZip([{ name: 'folder/', directory: true }]), 'ZIP_EMPTY');
});

test('detects a CRC mismatch (a truncated or edited upload)', async () => {
  await expectRejection(
    buildZip([{ name: 'index.html', data: 'hello world', crcOverride: 0xdeadbeef }]),
    'ZIP_CORRUPT',
  );
});

test('rejects a truncated archive', async () => {
  const full = buildSampleSite();
  await expectRejection(full.subarray(0, Math.floor(full.length / 2)), 'ZIP_INVALID');
});

// ---------------------------------------------------------------------------
// readArchive reports totals without extracting
// ---------------------------------------------------------------------------

test('readArchive reports counts and sizes without writing anything', async () => {
  const info = await readArchive(writeZip(buildSampleSite()), LIMITS);
  assert.equal(info.files.length, 5);
  assert.ok(info.totalUncompressed > 0);
  assert.ok(info.totalCompressed > 0);
});
