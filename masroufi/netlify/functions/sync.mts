// POST /api/sync — push this device's changes and pull everything newer.
// See netlify/lib/merge.mjs for the protocol.

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { json, currentUser, readJson } from '../lib/http.mjs';
import { sanitize, merge, HttpError } from '../lib/merge.mjs';

const MAX_BODY = 5 * 1024 * 1024;

export default async (req: Request) => {
  const user = await currentUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body: any;
  let changes: any[];
  try {
    body = await readJson(req, MAX_BODY);
    changes = sanitize(body.changes);
  } catch (e: any) {
    return json({ error: e.message }, e instanceof HttpError || e.status ? e.status : 400);
  }
  const since = Number(body.since) || 0;

  const store = getStore({ name: 'userdata', consistency: 'strong' });
  // optimistic concurrency: retry when another device wrote in between
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await store.getWithMetadata(user.id, { type: 'json' });
    const res = merge(cur ? cur.data : null, changes, since);
    if (res.changed) {
      const opts = cur && cur.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
      const w = await store.setJSON(user.id, res.doc, opts);
      if (!w.modified) continue;
    }
    return json({ rev: res.rev, changes: res.changes });
  }
  return json({ error: 'conflict, try again' }, 409);
};

export const config: Config = { path: '/api/sync', method: ['POST'] };
