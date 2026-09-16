import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, signedInClient } from './helpers/server.js';
import { buildZip } from './helpers/zipwriter.js';

/**
 * Regression tests for issues found by adversarial probing.
 *
 * These are attacks, written as tests, so a future change that reopens one of
 * them fails here rather than in production.
 */

let server;
let client;

test.before(async () => {
  server = await startTestServer();
  client = await signedInClient(server.baseUrl);
  await client.post('/api/projects', { name: 'Target', slug: 'target' });
  await client.upload('/api/projects/target/deploy', buildZip([
    { name: 'index.html', data: '<!doctype html><title>t</title>PUBLIC-CONTENT' },
  ]));
});
test.after(async () => { await server?.stop(); });

const cookie = () => `nh_session=${client.cookies.get('nh_session')}`;

/**
 * Send a request line verbatim. fetch() normalises "../" out of a URL before
 * it goes on the wire, which silently turns a traversal test into a request
 * for a perfectly ordinary path — so the interesting cases need a raw socket.
 */
function rawGet(port, requestLine) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${requestLine} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (c) => { data += c.toString('latin1'); });
    socket.on('end', () => resolve(data));
    socket.on('error', () => resolve(''));
    setTimeout(() => { socket.destroy(); resolve(data); }, 3000);
  });
}

test('an SVG in the workspace is never rendered inline on the panel origin', async () => {
  // SVG is an image by content type and a script container in practice.
  // Rendering one here would put attacker-controlled script next to the session.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>fetch("/api/projects")</script></svg>';
  await client.uploadPut('/api/projects/target/files?path=evil.svg', Buffer.from(svg), 'image/svg+xml');

  const response = await fetch(
    `${server.baseUrl}/api/projects/target/files/raw?path=evil.svg`,
    { headers: { Cookie: cookie() } },
  );
  assert.match(response.headers.get('content-disposition') ?? '', /attachment/i,
    'SVG must download, not render');
});

test('the file listing does not mark an SVG as inline-previewable', async () => {
  const listing = await client.get('/api/projects/target/files');
  const svg = listing.body.data.items.find((i) => i.name === 'evil.svg');
  assert.ok(svg, 'the SVG should be listed');
  assert.equal(svg.previewable, false);
});

test('workspace HTML is forced to download', async () => {
  await client.uploadPut('/api/projects/target/files?path=evil.html',
    Buffer.from('<script>document.title="xss"</script>'), 'text/html');
  const response = await fetch(
    `${server.baseUrl}/api/projects/target/files/raw?path=evil.html`,
    { headers: { Cookie: cookie() } },
  );
  assert.match(response.headers.get('content-disposition') ?? '', /attachment/i);
});

test('raw unnormalised paths cannot escape a deployment directory', async () => {
  const sitesPort = Number(new URL(server.sitesUrl).port);
  const attacks = [
    '/s/target/../../../test.db',
    '/s/target/../../sites/../test.db',
    '/s/target/..%2f..%2ftest.db',
    '/s/target/..%5c..%5ctest.db',
    '/s/target/....//....//test.db',
    '/s/target/%2e%2e/%2e%2e/test.db',
  ];
  for (const attack of attacks) {
    const response = await rawGet(sitesPort, attack);
    const body = response.split('\r\n\r\n').slice(1).join('\r\n\r\n');
    assert.ok(!body.includes('SQLite format 3'), `leaked the database via ${attack}`);
  }
});

test('the database file is not downloadable from either listener', async () => {
  for (const base of [server.baseUrl, server.sitesUrl]) {
    for (const p of ['/test.db', '/novahost.db', '/data/novahost.db', '/s/target/.nova-manifest.json']) {
      const response = await fetch(base + p, { redirect: 'manual' });
      if (response.status !== 200) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.notEqual(bytes.subarray(0, 15).toString(), 'SQLite format 3', `${base}${p} served the database`);
    }
  }
});

test('an uploaded site is served as inert bytes, never executed', async () => {
  await client.post('/api/projects', { name: 'Exec', slug: 'exec' });
  await client.upload('/api/projects/exec/deploy', buildZip([
    { name: 'index.html', data: '<!doctype html><title>e</title>ok' },
    { name: 'shell.php', data: '<?php system($_GET["c"]); ?>' },
    { name: 'run.cgi', data: '#!/bin/sh\necho EXECUTED' },
  ]));

  const php = await fetch(`${server.sitesUrl}/s/exec/shell.php?c=id`);
  const phpBody = await php.text();
  assert.ok(!phpBody.includes('uid='), 'PHP was executed');
  assert.ok(phpBody.includes('<?php'), 'PHP source should be returned verbatim');
  // An unknown extension must not be served as HTML either.
  assert.doesNotMatch(php.headers.get('content-type') ?? '', /text\/html/);

  const cgi = await fetch(`${server.sitesUrl}/s/exec/run.cgi`);
  assert.ok(!(await cgi.text()).trim().startsWith('EXECUTED'), 'CGI was executed');
});

test('a backup cannot be downloaded without a session', async () => {
  const created = await client.post('/api/backups', { includeSites: false });
  const id = created.body.data.backup.id;

  const anonymous = await fetch(`${server.baseUrl}/api/backups/${id}/download`, { redirect: 'manual' });
  assert.equal(anonymous.status, 401);
});

test('the backup archive contains no secrets', async () => {
  const created = await client.post('/api/backups', { includeSites: true });
  const file = path.join(server.dataDir, 'storage', 'backups', `${created.body.data.backup.id}.zip`);
  const bytes = fs.readFileSync(file);
  assert.ok(!bytes.includes(Buffer.from(process.env.SESSION_SECRET)),
    'SESSION_SECRET ended up inside a backup');
});

test('the raw session token is never written to disk', async () => {
  const token = client.cookies.get('nh_session');

  const database = fs.readFileSync(process.env.DATABASE_PATH);
  assert.ok(!database.includes(Buffer.from(token)), 'the database stores the live token');

  const logDir = path.join(server.dataDir, 'logs');
  if (fs.existsSync(logDir)) {
    for (const name of fs.readdirSync(logDir)) {
      const text = fs.readFileSync(path.join(logDir, name), 'utf8');
      assert.ok(!text.includes(token), `session token written to ${name}`);
      assert.ok(!text.includes('quiet-harbour-lantern-42'), `password written to ${name}`);
    }
  }
});

test('the password is not recoverable from the database file', () => {
  const database = fs.readFileSync(process.env.DATABASE_PATH);
  assert.ok(!database.includes(Buffer.from('quiet-harbour-lantern-42')));
});

test('login timing does not reveal whether an account exists', async () => {
  const measure = async (username) => {
    const samples = [];
    for (let i = 0; i < 6; i++) {
      // Clear the lockout between samples: we are measuring the hash, not the
      // throttle. Without this the test measures its own rate limiter.
      const { getDatabase } = await import('../src/db/index.js');
      getDatabase().run('UPDATE users SET failed_logins = 0, locked_until = NULL');

      const start = process.hrtime.bigint();
      await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: `wrong-${i}-${Math.random()}` }),
      });
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  };

  const existing = await measure('tester');
  const unknown = await measure('no-such-account-anywhere');
  const ratio = existing / unknown;

  // A real account must not be separable from an unknown one by timing. The
  // login handler hashes against a dummy value when the user does not exist,
  // which is what keeps these equal.
  assert.ok(ratio > 0.5 && ratio < 2.0,
    `timing ratio ${ratio.toFixed(2)} (${existing.toFixed(0)}ms vs ${unknown.toFixed(0)}ms) leaks account existence`);
});
