// Signup lock: this is a personal app, so only its owner may create an
// account — the emails in ALLOWED_EMAILS, or (when that's empty) the first
// account ever created on the site.

import type { UserValidateEvent } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

export default {
  async userValidate(event: UserValidateEvent) {
    const email = String(event.user.email || '').trim().toLowerCase();
    if (!email) {
      // never lock the owner out over a malformed event; data stays per-account anyway
      console.warn('[identity] validate event without email');
      return undefined;
    }
    const allowed = String(Netlify.env.get('ALLOWED_EMAILS') || '')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length) return allowed.includes(email) ? undefined : event.deny();

    const meta = getStore({ name: 'meta', consistency: 'strong' });
    const owner = await meta.get('owner', { type: 'json' }) as { email?: string } | null;
    if (owner && owner.email) return owner.email === email ? undefined : event.deny();
    // first signup claims the app; onlyIfNew keeps a race from letting two owners in
    const w = await meta.setJSON('owner', { email, at: Date.now() }, { onlyIfNew: true });
    if (!w.modified) {
      const again = await meta.get('owner', { type: 'json' }) as { email?: string } | null;
      return again && again.email === email ? undefined : event.deny();
    }
    return undefined;
  },
};
