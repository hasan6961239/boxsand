import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, createClient, ADMIN } from './helpers/server.js';
import { buildZip } from './helpers/zipwriter.js';

/**
 * Backup and restore.
 *
 * Restore is the only operation that closes the live database, swaps files on
 * disk and reopens — nothing else in the project does that, so it gets its own
 * end-to-end test rather than being trusted because the code looks right.
 */

let server;
let client;
let backupId;
let externalCopy;

const site = async (p) => {
  const response = await fetch(`${server.sitesUrl}${p}`, { redirect: 'manual' });
  return { status: response.status, text: await response.text() };
};

test.before(async () => {
  server = await startTestServer();
  client = createClient(server.baseUrl);
  await client.post('/api/setup', ADMIN);

  await client.post('/api/projects', { name: 'Keeper', slug: 'keeper' });
  await client.upload('/api/projects/keeper/deploy?message=v1', buildZip([
    { name: 'index.html', data: '<!doctype html><title>v1</title><h1>ORIGINAL CONTENT</h1>' },
    { name: 'css/style.css', data: 'body{color:#123456}' },
  ]));
  await client.upload('/api/projects/keeper/deploy?message=v2', buildZip([
    { name: 'index.html', data: '<!doctype html><title>v2</title><h1>SECOND VERSION</h1>' },
  ]));
  await client.post('/api/projects', { name: 'Second', slug: 'second' });
  await client.upload('/api/projects/second/deploy', buildZip([
    { name: 'index.html', data: '<!doctype html><title>second</title><h1>SECOND PROJECT</h1>' },
  ]));
  await client.patch('/api/settings', { keepDeployments: 7 });
});

test.after(async () => {
  if (externalCopy) fs.rmSync(externalCopy, { force: true });
  await server?.stop();
});

test('a backup captures projects, deployments and settings', async () => {
  const response = await client.post('/api/backups', { includeSites: true, note: 'before disaster' });
  assert.equal(response.status, 201);

  const backup = response.body.data.backup;
  assert.equal(backup.counts.projects, 2);
  assert.equal(backup.counts.deployments, 3);
  assert.ok(backup.size > 0);

  backupId = backup.id;
  const onDisk = path.join(server.dataDir, 'storage', 'backups', `${backupId}.zip`);
  assert.ok(fs.existsSync(onDisk), 'backup file missing from disk');

  // Keep a copy outside the data directory: restore replaces what is inside it.
  externalCopy = path.join('/tmp', `novahost-test-${backupId}.zip`);
  fs.copyFileSync(onDisk, externalCopy);
});

test('the backup archive is a valid ZIP our own reader can open', async () => {
  const { readArchive } = await import('../src/services/zip.js');
  const info = await readArchive(externalCopy, {
    maxEntries: 100000,
    maxUncompressedBytes: 1e10,
    maxSingleFileBytes: 1e9,
    maxCompressionRatio: 10000,
  });
  const names = info.files.map((f) => f.name);
  assert.ok(names.includes('novahost-backup.json'), 'manifest missing');
  assert.ok(names.includes('database/novahost.db'), 'database missing');
  assert.ok(names.some((n) => n.startsWith('sites/')), 'site files missing');
});

test('restore brings back everything that was lost', async () => {
  // Destroy the installation.
  await client.delete('/api/projects/keeper?confirm=keeper');
  await client.delete('/api/projects/second?confirm=second');
  await client.patch('/api/settings', { keepDeployments: 3 });
  await client.post('/api/projects', { name: 'Noise', slug: 'noise' });
  assert.equal((await site('/s/keeper/')).status, 404);

  const response = await client.upload(
    '/api/backups/restore?confirm=restore',
    fs.readFileSync(externalCopy),
  );
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  assert.equal(response.body.data.restored.id, backupId);
  assert.ok(response.body.data.safetyBackupId, 'no safety backup was taken');

  // The restored database carries its own sessions, so sign in again.
  const after = createClient(server.baseUrl);
  const login = await after.post('/api/auth/login', {
    username: ADMIN.username, password: ADMIN.password,
  });
  assert.equal(login.status, 200, 'the restored account cannot sign in');

  const slugs = (await after.get('/api/projects')).body.data.items.map((p) => p.slug).sort();
  assert.ok(slugs.includes('keeper') && slugs.includes('second'), slugs.join(','));
  assert.ok(!slugs.includes('noise'), 'a project created after the backup survived the restore');

  const deployments = await after.get('/api/projects/keeper/deployments');
  assert.equal(deployments.body.data.items.length, 2, 'deployment history was lost');

  const live = await site('/s/keeper/');
  assert.equal(live.status, 200);
  assert.match(live.text, /SECOND VERSION/, 'the wrong version is live after restore');

  const second = await site('/s/second/');
  assert.match(second.text, /SECOND PROJECT/);

  const settings = await after.get('/api/settings');
  assert.equal(settings.body.data.values.keepDeployments, 7, 'settings were not restored');
});

test('rollback and deploy still work on restored data', async () => {
  const after = createClient(server.baseUrl);
  await after.post('/api/auth/login', { username: ADMIN.username, password: ADMIN.password });

  const deployments = await after.get('/api/projects/keeper/deployments');
  const first = deployments.body.data.items.find((d) => d.number === 1);

  const rollback = await after.post('/api/projects/keeper/rollback', { deploymentId: first.id });
  assert.equal(rollback.status, 200);
  assert.match((await site('/s/keeper/')).text, /ORIGINAL CONTENT/);

  const fresh = await after.upload('/api/projects/keeper/deploy?message=post-restore', buildZip([
    { name: 'index.html', data: '<!doctype html><title>v3</title><h1>AFTER RESTORE</h1>' },
  ]));
  assert.equal(fresh.status, 201);
  // The counter must continue from the restored state, not start over.
  assert.equal(fresh.body.data.deployment.number, 3);
  assert.match((await site('/s/keeper/')).text, /AFTER RESTORE/);
});

test('a corrupt archive is refused and changes nothing', async () => {
  const after = createClient(server.baseUrl);
  await after.post('/api/auth/login', { username: ADMIN.username, password: ADMIN.password });

  const response = await after.upload(
    '/api/backups/restore?confirm=restore',
    Buffer.from('this is definitely not a backup archive'),
  );
  assert.ok(response.status >= 400);
  assert.equal((await site('/s/keeper/')).status, 200, 'a rejected restore broke the live site');
});

test('restore refuses to run without an explicit confirmation', async () => {
  const after = createClient(server.baseUrl);
  await after.post('/api/auth/login', { username: ADMIN.username, password: ADMIN.password });

  const response = await after.upload('/api/backups/restore', fs.readFileSync(externalCopy));
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'CONFIRMATION_REQUIRED');
});

test('a backup can be deleted and the id cannot escape the folder', async () => {
  const after = createClient(server.baseUrl);
  await after.post('/api/auth/login', { username: ADMIN.username, password: ADMIN.password });

  const escape = await after.get('/api/backups/..%2f..%2fnovahost.db/download');
  assert.ok(escape.status >= 400);

  const list = await after.get('/api/backups');
  const target = list.body.data.items[0];
  assert.equal((await after.delete(`/api/backups/${target.id}`)).status, 204);

  const remaining = await after.get('/api/backups');
  assert.ok(!remaining.body.data.items.some((b) => b.id === target.id));
});
