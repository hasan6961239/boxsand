// GET /api/config — public settings the app needs (push public key).

import type { Config } from '@netlify/functions';
import { json } from '../lib/http.mjs';

export default async () => json({ vapidPublicKey: Netlify.env.get('VAPID_PUBLIC_KEY') || null, identity: true });

export const config: Config = { path: '/api/config', method: ['GET'] };
