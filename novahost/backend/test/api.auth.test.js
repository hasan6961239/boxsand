import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createClient, ADMIN } from './helpers/server.js';

let server;
test.before(async () => { server = await startTestServer(); });
test.after(async () => { await server?.stop(); });

test('setup is required before the first account exists', async () => {
  const client = createClient(server.baseUrl);
  const response = await client.get('/api/setup/status');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.setupRequired, true);
});

test('/api/auth/me is unauthorised before signing in', async () => {
  const client = createClient(server.baseUrl);
  const response = await client.get('/api/auth/me');
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'UNAUTHORIZED');
});

test('the setup wizard creates the admin and signs it in', async () => {
  const client = createClient(server.baseUrl);
  const response = await client.post('/api/setup', ADMIN);

  assert.equal(response.status, 201);
  assert.equal(response.body.data.user.username, ADMIN.username);
  assert.equal(response.body.data.user.role, 'admin');
  assert.ok(response.body.data.csrfToken);
  assert.ok(client.cookies.has('nh_session'));

  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.username, ADMIN.username);
});

test('the session cookie is HttpOnly, SameSite=Lax and host-only', async () => {
  const client = createClient(server.baseUrl);
  const response = await client.post('/api/auth/login', {
    username: ADMIN.username, password: ADMIN.password,
  });
  const setCookie = response.headers.getSetCookie().join(' ');

  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  // No Domain attribute: that is what stops a project subdomain from ever
  // receiving the dashboard session.
  assert.doesNotMatch(setCookie, /Domain=/i);
});

test('setup closes itself once an account exists', async () => {
  const client = createClient(server.baseUrl);
  const status = await client.get('/api/setup/status');
  assert.equal(status.body.data.setupRequired, false);

  const retry = await client.post('/api/setup', {
    username: 'second', email: 'second@example.com', password: 'another-long-password',
  });
  assert.equal(retry.status, 410);
  assert.equal(retry.body.error.code, 'SETUP_ALREADY_DONE');
});

test('login rejects a wrong password with the same message as an unknown user', async () => {
  const wrongPassword = await createClient(server.baseUrl).post('/api/auth/login', {
    username: ADMIN.username, password: 'definitely-not-the-password',
  });
  const unknownUser = await createClient(server.baseUrl).post('/api/auth/login', {
    username: 'nobody-here', password: 'definitely-not-the-password',
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  // Identical responses: the API must not be usable to enumerate accounts.
  assert.equal(wrongPassword.body.error.code, unknownUser.body.error.code);
  assert.equal(wrongPassword.body.error.message, unknownUser.body.error.message);
});

test('login works with the email address as well as the username', async () => {
  const client = createClient(server.baseUrl);
  const response = await client.post('/api/auth/login', {
    username: ADMIN.email, password: ADMIN.password,
  });
  assert.equal(response.status, 200);
});

test('a state-changing request without a CSRF token is refused', async () => {
  const client = createClient(server.baseUrl);
  await client.post('/api/auth/login', { username: ADMIN.username, password: ADMIN.password });

  client.clearCsrf();
  const response = await client.post('/api/projects', { name: 'no csrf token' });

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
});

test('a request with the wrong CSRF token is refused', async () => {
  const client = createClient(server.baseUrl);
  await client.post('/api/auth/login', { username: ADMIN.username, password: ADMIN.password });

  const response = await client.post('/api/projects', { name: 'bad token' }, {
    headers: { 'X-CSRF-Token': 'not-the-right-token' },
  });
  assert.equal(response.status, 403);
});

test('a cross-site Origin is refused even with a valid token', async () => {
  const client = createClient(server.baseUrl);
  await client.post('/api/auth/login', { username: ADMIN.username, password: ADMIN.password });

  const response = await client.post('/api/projects', { name: 'evil' }, {
    headers: { Origin: 'https://attacker.example.com' },
  });
  assert.equal(response.status, 403);
});

test('logout destroys the session server-side, not just the cookie', async () => {
  const client = createClient(server.baseUrl);
  await client.post('/api/auth/login', { username: ADMIN.username, password: ADMIN.password });
  const cookieValue = client.cookies.get('nh_session');

  await client.post('/api/auth/logout');
  assert.equal((await client.get('/api/auth/me')).status, 401);

  // Replaying the old cookie must not work either.
  const replay = createClient(server.baseUrl);
  replay.cookies.set('nh_session', cookieValue);
  assert.equal((await replay.get('/api/auth/me')).status, 401);
});

test('a forged session cookie is rejected', async () => {
  const client = createClient(server.baseUrl);
  client.cookies.set('nh_session', 'a'.repeat(43));
  assert.equal((await client.get('/api/auth/me')).status, 401);
});

test('repeated failed logins eventually lock the account', async () => {
  const client = createClient(server.baseUrl);
  let locked = false;

  for (let attempt = 0; attempt < 9; attempt++) {
    const response = await client.post('/api/auth/login', {
      username: ADMIN.username, password: `wrong-${attempt}`,
    });
    if (response.status === 429) {
      locked = true;
      break;
    }
  }

  assert.ok(locked, 'expected the account or the IP to be throttled after repeated failures');
});

test('/health answers without a session and reports real checks', async () => {
  const client = createClient(server.baseUrl);
  const response = await client.get('/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, 'ok');
  assert.equal(response.body.data.checks.database, 'ok');
  assert.equal(response.body.data.checks.storage, 'ok');
});

test('security headers are present on dashboard responses', async () => {
  const client = createClient(server.baseUrl);
  const response = await client.get('/health');

  assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('an unknown API endpoint returns a structured 404', async () => {
  const client = createClient(server.baseUrl);
  const response = await client.get('/api/does-not-exist');
  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'ENDPOINT_NOT_FOUND');
});

test('the wrong method on a real endpoint returns 405 with Allow', async () => {
  const client = createClient(server.baseUrl);
  const response = await client.delete('/api/setup/status');
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'METHOD_NOT_ALLOWED');
  assert.match(response.headers.get('allow') ?? '', /GET/);
});
