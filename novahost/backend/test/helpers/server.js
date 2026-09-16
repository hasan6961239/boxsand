import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Boots a real server for integration tests.
 *
 * Environment variables are set before anything is imported, because config.js
 * reads them at module-evaluation time and ES module imports are hoisted. The
 * server is therefore loaded with a dynamic import, after this function has
 * prepared a throwaway data directory and a pair of free ports.
 *
 * Node's test runner gives each test file its own process, so this module-level
 * state never leaks between files.
 */

function freePortPair() {
  // A high, randomised base keeps parallel test files from colliding without
  // needing to actually bind a socket first.
  const base = 20000 + Math.floor(Math.random() * 20000);
  return [base, base + 1];
}

export async function startTestServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novahost-test-'));
  const [port, sitesPort] = freePortPair();

  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = dataDir;
  process.env.DATABASE_PATH = path.join(dataDir, 'test.db');
  process.env.STORAGE_PATH = path.join(dataDir, 'storage');
  process.env.PORT = String(port);
  process.env.SITES_PORT = String(sitesPort);
  process.env.HOST = '127.0.0.1';
  process.env.PUBLIC_URL = `http://127.0.0.1:${port}`;
  process.env.SESSION_SECRET = 'test-secret-value-that-is-long-enough-for-config';
  process.env.LOG_LEVEL = 'error';
  process.env.TRUST_PROXY = 'false';

  const { startServer, stopServer } = await import('../../src/server.js');
  const servers = await startServer();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    sitesUrl: `http://127.0.0.1:${sitesPort}`,
    dataDir,
    async stop() {
      await stopServer(servers);
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * A tiny HTTP client that remembers cookies and the CSRF token, so tests read
 * like the sequence of calls the dashboard actually makes.
 */
export function createClient(baseUrl) {
  const cookies = new Map();
  let csrfToken = null;

  function cookieHeader() {
    return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  function absorbCookies(response) {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const entry of raw) {
      const [pair] = entry.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || /Max-Age=0/i.test(entry)) cookies.delete(name);
      else cookies.set(name, value);
    }
  }

  async function request(method, pathname, { body = null, headers = {}, raw = false } = {}) {
    const requestHeaders = { ...headers };
    const cookie = cookieHeader();
    if (cookie) requestHeaders.Cookie = cookie;
    // An explicitly passed token wins, so a test can send a deliberately wrong one.
    const hasExplicitToken = Object.keys(requestHeaders).some((h) => h.toLowerCase() === 'x-csrf-token');
    if (csrfToken && !hasExplicitToken && !['GET', 'HEAD'].includes(method)) {
      requestHeaders['X-CSRF-Token'] = csrfToken;
    }

    let payload = body;
    if (body !== null && !raw) {
      requestHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const response = await fetch(`${baseUrl}${pathname}`, {
      method, headers: requestHeaders, body: payload, redirect: 'manual',
    });
    absorbCookies(response);

    const contentType = response.headers.get('content-type') ?? '';
    let parsed = null;
    if (contentType.includes('application/json')) parsed = await response.json();
    else parsed = await response.text();

    if (parsed?.data?.csrfToken) csrfToken = parsed.data.csrfToken;

    return { status: response.status, headers: response.headers, body: parsed };
  }

  return {
    get: (p, options) => request('GET', p, options),
    post: (p, body, options) => request('POST', p, { ...options, body }),
    put: (p, body, options) => request('PUT', p, { ...options, body }),
    patch: (p, body, options) => request('PATCH', p, { ...options, body }),
    delete: (p, options) => request('DELETE', p, options),
    /** Raw binary upload, the way the dashboard deploys a zip. */
    upload: (p, buffer, contentType = 'application/zip') =>
      request('POST', p, { body: buffer, raw: true, headers: { 'Content-Type': contentType } }),
    uploadPut: (p, buffer, contentType = 'text/plain') =>
      request('PUT', p, { body: buffer, raw: true, headers: { 'Content-Type': contentType } }),
    get csrf() { return csrfToken; },
    clearCsrf() { csrfToken = null; },
    cookies,
  };
}

export const ADMIN = {
  username: 'tester',
  email: 'tester@example.com',
  password: 'quiet-harbour-lantern-42',
};

/** Run the setup wizard and return a signed-in client. */
export async function signedInClient(baseUrl) {
  const client = createClient(baseUrl);
  const response = await client.post('/api/setup', ADMIN);
  if (response.status !== 201) {
    throw new Error(`setup failed: ${JSON.stringify(response.body)}`);
  }
  return client;
}
