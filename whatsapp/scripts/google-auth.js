#!/usr/bin/env node
// يولّد GOOGLE_REFRESH_TOKEN — يشتغل على سيرفر بدون متصفح.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
];

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('\n✖ ضع GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET في ملف .env أولاً.');
  console.error('  الخطوات مشروحة في docs/SETUP-GOOGLE.md\n');
  process.exit(1);
}

const client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:5555');

const url = client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
});

console.log('\n════════════════════════════════════════════════════');
console.log('1) افتح الرابط هذا في أي متصفح (جوالك يكفي):\n');
console.log(url);
console.log('\n2) وافق على الأذونات.');
console.log('3) المتصفح بيحاول يفتح صفحة localhost وبيعطيك خطأ — هذا طبيعي.');
console.log('4) انسخ رابط الصفحة كامل من شريط العنوان والصقه هنا.');
console.log('════════════════════════════════════════════════════\n');

const rl = readline.createInterface({ input: stdin, output: stdout });
const answer = (await rl.question('الصق الرابط (أو الكود فقط): ')).trim();
rl.close();

let code = answer;
if (answer.includes('code=')) {
  try {
    code = new URL(answer).searchParams.get('code');
  } catch {
    code = decodeURIComponent(answer.split('code=')[1].split('&')[0]);
  }
}

if (!code) {
  console.error('\n✖ ما لقيتش الكود في اللي لصقته.\n');
  process.exit(1);
}

try {
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    console.error('\n✖ ما وصلش refresh token. احذف صلاحية التطبيق من حسابك وأعد المحاولة.\n');
    process.exit(1);
  }
  console.log('\n✅ تم بنجاح. ضيف السطر هذا في ملف .env:\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
} catch (err) {
  console.error(`\n✖ فشل تبديل الكود: ${err.message}\n`);
  process.exit(1);
}
