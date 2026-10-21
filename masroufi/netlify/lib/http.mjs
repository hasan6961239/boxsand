// Small helpers shared by the functions: JSON responses and the signed-in user.

import { getUser, refreshSession } from '@netlify/identity';

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

/** The Netlify Identity user behind this request (nf_jwt cookie), or null. */
export async function currentUser() {
  try {
    await refreshSession();
  } catch { /* no refresh token / identity unreachable — getUser decides */ }
  const user = await getUser();
  return user && user.id ? user : null;
}

export async function readJson(req, maxBytes) {
  const text = await req.text();
  if (text.length > maxBytes) {
    const e = new Error('payload too large');
    e.status = 413;
    throw e;
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const e = new Error('invalid JSON');
    e.status = 400;
    throw e;
  }
}
