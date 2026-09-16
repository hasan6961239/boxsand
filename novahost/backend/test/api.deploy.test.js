import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signedInClient } from './helpers/server.js';
import { buildZip, buildSampleSite } from './helpers/zipwriter.js';

/**
 * The full lifecycle, against a real server: create, deploy, serve, edit,
 * publish, roll back, delete. This is the test that would catch a regression
 * in the thing the platform actually exists to do.
 */

let server;
let client;

test.before(async () => {
  server = await startTestServer();
  client = await signedInClient(server.baseUrl);
});
test.after(async () => { await server?.stop(); });

async function fetchSite(pathname, options = {}) {
  const response = await fetch(`${server.sitesUrl}${pathname}`, { redirect: 'manual', ...options });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

test('creating a project derives a slug from an Arabic name', async () => {
  const response = await client.post('/api/projects', {
    name: 'موقعي الشخصي',
    description: 'first project',
  });

  assert.equal(response.status, 201);
  const project = response.body.data.project;
  assert.match(project.slug, /^[a-z0-9][a-z0-9-]*$/);
  assert.equal(project.name, 'موقعي الشخصي');
  assert.equal(project.status, 'empty');
  assert.equal(project.currentDeploymentId, null);
});

test('a duplicate slug is rejected rather than silently renamed', async () => {
  await client.post('/api/projects', { name: 'Portfolio', slug: 'portfolio' });
  const duplicate = await client.post('/api/projects', { name: 'Portfolio Again', slug: 'portfolio' });

  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'SLUG_TAKEN');
});

test('a reserved slug is rejected', async () => {
  const response = await client.post('/api/projects', { name: 'API', slug: 'api' });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.details[0].code, 'SLUG_RESERVED');
});

test('an auto-generated slug avoids a collision by counting up', async () => {
  const first = await client.post('/api/projects', { name: 'Same Name' });
  const second = await client.post('/api/projects', { name: 'Same Name' });

  assert.equal(first.body.data.project.slug, 'same-name');
  assert.equal(second.body.data.project.slug, 'same-name-2');
});

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

test('deploying a ZIP publishes the site and reports real numbers', async () => {
  const response = await client.upload(
    '/api/projects/portfolio/deploy?message=first%20deploy',
    buildSampleSite({ prefix: 'my-website' }),
  );

  assert.equal(response.status, 201);
  const deployment = response.body.data.deployment;
  assert.equal(deployment.status, 'READY');
  assert.equal(deployment.number, 1);
  assert.equal(deployment.fileCount, 5);
  assert.equal(deployment.entryFile, 'index.html');
  assert.equal(deployment.message, 'first deploy');
  assert.ok(deployment.durationMs >= 0);
  assert.equal(response.body.data.project.status, 'ready');
});

test('the published site is served on the sites port', async () => {
  const page = await fetchSite('/s/portfolio/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.text, /Hello/);
});

test('assets are served with the right content type', async () => {
  const css = await fetchSite('/s/portfolio/css/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.match(css.text, /font-family/);

  const js = await fetchSite('/s/portfolio/js/app.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
});

test('hosted sites always carry nosniff', async () => {
  const page = await fetchSite('/s/portfolio/');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
});

test('the sites port exposes no API at all', async () => {
  const response = await fetch(`${server.sitesUrl}/api/projects`, { redirect: 'manual' });
  // Whatever it answers, it must never be a successful API response: this
  // separation is what stops an uploaded site from reaching the platform.
  assert.notEqual(response.status, 200);
});

test('a missing file returns 404 from the site, not the dashboard', async () => {
  const page = await fetchSite('/s/portfolio/nope.html');
  assert.equal(page.status, 404);
});

test('path traversal against a hosted site is refused', async () => {
  for (const attack of ['/s/portfolio/../../../etc/passwd', '/s/portfolio/..%2f..%2fnovahost.db']) {
    const page = await fetchSite(attack);
    assert.ok(page.status >= 400, `${attack} returned ${page.status}`);
    assert.ok(!page.text.includes('root:'), 'leaked /etc/passwd');
  }
});

test('the deployment manifest is not downloadable from the site', async () => {
  const page = await fetchSite('/s/portfolio/.nova-manifest.json');
  assert.equal(page.status, 404);
});

test('an unknown project slug returns 404', async () => {
  const page = await fetchSite('/s/no-such-project/');
  assert.equal(page.status, 404);
});

test('the deployment transcript records each step', async () => {
  const list = await client.get('/api/projects/portfolio/deployments');
  const deploymentId = list.body.data.items[0].id;

  const logs = await client.get(`/api/deployments/${deploymentId}/logs`);
  const messages = logs.body.data.items.map((entry) => entry.message);

  assert.ok(messages.some((m) => /Upload received/i.test(m)));
  assert.ok(messages.some((m) => /Extract/i.test(m)));
  assert.ok(messages.some((m) => /Entry file detected/i.test(m)));
  assert.ok(messages.some((m) => /successful/i.test(m)));
});

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

test('a rejected ZIP fails the deployment and leaves the live site untouched', async () => {
  const before = await fetchSite('/s/portfolio/');

  const bomb = buildZip([
    { name: 'index.html', data: 'x' },
    { name: 'bomb.txt', data: 'A'.repeat(2 * 1024 * 1024), deflate: true },
  ]);
  const response = await client.upload('/api/projects/portfolio/deploy', bomb);

  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'ZIP_BOMB');

  const after = await fetchSite('/s/portfolio/');
  assert.equal(after.status, 200);
  assert.equal(after.text, before.text, 'the live site changed despite a failed deploy');
});

test('a failed deployment is recorded with its reason', async () => {
  const list = await client.get('/api/projects/portfolio/deployments');
  const failed = list.body.data.items.find((d) => d.status === 'FAILED');

  assert.ok(failed, 'no failed deployment was recorded');
  assert.equal(failed.errorCode, 'ZIP_BOMB');
  assert.ok(failed.errorMessage.length > 0);
  assert.equal(failed.isCurrent, false);
});

test('an archive without index.html is refused with a clear reason', async () => {
  const response = await client.upload('/api/projects/portfolio/deploy', buildZip([
    { name: 'readme.txt', data: 'no entry point here' },
    { name: 'assets/logo.svg', data: '<svg/>' },
  ]));

  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'NO_INDEX_HTML');
  assert.match(response.body.error.message, /index\.html/);
});

test('a single stray HTML file is accepted as the entry point', async () => {
  await client.post('/api/projects', { name: 'Single Page', slug: 'single-page' });
  const response = await client.upload('/api/projects/single-page/deploy', buildZip([
    { name: 'home.html', data: '<!doctype html><title>home</title>' },
  ]));

  assert.equal(response.status, 201);
  assert.equal(response.body.data.deployment.entryFile, 'home.html');
});

test('a non-ZIP upload is refused', async () => {
  const response = await client.upload(
    '/api/projects/portfolio/deploy',
    Buffer.from('this is not a zip file at all'),
  );
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'ZIP_INVALID');
});

// ---------------------------------------------------------------------------
// Versions and rollback
// ---------------------------------------------------------------------------

test('a second deploy becomes live and the first stays available', async () => {
  const second = await client.upload('/api/projects/portfolio/deploy', buildZip([
    { name: 'index.html', data: '<!doctype html><title>v2</title><h1>Version two</h1>' },
  ]));

  assert.equal(second.status, 201);
  const page = await fetchSite('/s/portfolio/');
  assert.match(page.text, /Version two/);

  const list = await client.get('/api/projects/portfolio/deployments');
  const ready = list.body.data.items.filter((d) => d.status === 'READY');
  assert.ok(ready.length >= 2);
  assert.equal(ready[0].isCurrent, true);
});

test('rollback switches the live version without re-uploading', async () => {
  const list = await client.get('/api/projects/portfolio/deployments');
  const first = list.body.data.items.find((d) => d.number === 1);

  const response = await client.post('/api/projects/portfolio/rollback', {
    deploymentId: first.id,
  });
  assert.equal(response.status, 200);

  const page = await fetchSite('/s/portfolio/');
  assert.match(page.text, /Hello/);
  assert.doesNotMatch(page.text, /Version two/);
});

test('rolling back to the already-live deployment is refused', async () => {
  const list = await client.get('/api/projects/portfolio/deployments');
  const current = list.body.data.items.find((d) => d.isCurrent);

  const response = await client.post('/api/projects/portfolio/rollback', {
    deploymentId: current.id,
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'ALREADY_CURRENT');
});

test('rolling back to another project\'s deployment is refused', async () => {
  const other = await client.get('/api/projects/single-page/deployments');
  const response = await client.post('/api/projects/portfolio/rollback', {
    deploymentId: other.body.data.items[0].id,
  });
  assert.equal(response.status, 404);
});

// ---------------------------------------------------------------------------
// Pausing and deleting
// ---------------------------------------------------------------------------

test('a paused project answers 503 instead of serving files', async () => {
  await client.post('/api/projects/portfolio/enabled', { enabled: false });
  const page = await fetchSite('/s/portfolio/');
  assert.equal(page.status, 503);

  await client.post('/api/projects/portfolio/enabled', { enabled: true });
  assert.equal((await fetchSite('/s/portfolio/')).status, 200);
});

test('deleting a project requires the slug as confirmation', async () => {
  const without = await client.delete('/api/projects/single-page');
  assert.equal(without.status, 400);
  assert.equal(without.body.error.code, 'CONFIRMATION_REQUIRED');

  const wrong = await client.delete('/api/projects/single-page?confirm=not-the-slug');
  assert.equal(wrong.status, 400);
});

test('deleting a project removes it and stops serving the site', async () => {
  const response = await client.delete('/api/projects/single-page?confirm=single-page');
  assert.equal(response.status, 204);

  assert.equal((await client.get('/api/projects/single-page')).status, 404);
  assert.equal((await fetchSite('/s/single-page/')).status, 404);
});

test('the overview reflects what actually happened', async () => {
  const response = await client.get('/api/overview');
  assert.equal(response.status, 200);

  const data = response.body.data;
  assert.ok(data.counts.projects >= 1);
  assert.ok(data.counts.deployments.total >= 2);
  assert.ok(data.counts.deployments.failed >= 1);
  assert.equal(data.health.status, 'ok');
  assert.ok(data.storage.total > 0);
  // Real system values, or an explicit null — never an invented number.
  assert.ok(data.system.memory === null || typeof data.system.memory.total === 'number');
  assert.ok(data.system.battery === null || typeof data.system.battery === 'object');
});
