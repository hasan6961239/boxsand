import { google } from 'googleapis';
import { config, googleReady } from './config.js';

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
];

export function oauthClient() {
  const client = new google.auth.OAuth2(
    config.env.googleClientId,
    config.env.googleClientSecret,
    'http://localhost:5555',
  );
  if (config.env.googleRefreshToken) {
    client.setCredentials({ refresh_token: config.env.googleRefreshToken });
  }
  return client;
}

let calendarClient = null;
let driveClient = null;

export function calendar() {
  if (!googleReady) throw new Error('جوجل غير مربوط. شغّل: npm run auth:google');
  calendarClient ??= google.calendar({ version: 'v3', auth: oauthClient() });
  return calendarClient;
}

export function drive() {
  if (!googleReady) throw new Error('جوجل غير مربوط. شغّل: npm run auth:google');
  driveClient ??= google.drive({ version: 'v3', auth: oauthClient() });
  return driveClient;
}
