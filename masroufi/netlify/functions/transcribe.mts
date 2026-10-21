// POST /api/transcribe { audio (base64 WAV), hints: [names…], cap } → { text, usage }
// Speech-to-text for the assistant's mic button, with Gemini (Netlify AI Gateway).
// Claude can't hear audio, so the recording is written out here first and the
// owner checks the text before it is sent to the assistant.

import type { Config } from '@netlify/functions';
import { GoogleGenAI } from '@google/genai';
import { json, currentUser, readJson } from '../lib/http.mjs';
import { capOf, getUsage, addUsage, geminiCost } from '../lib/assistant.mjs';

const MAX_BODY = 5.5 * 1024 * 1024; // ~2 minutes of 16 kHz mono WAV, base64
const STT_MODELS = [process.env.GEMINI_STT_MODEL || 'gemini-3.8-flash', 'gemini-2.5-flash'];

function prompt(hints: string[]) {
  return [
    'اكتب نص هذا التسجيل الصوتي حرفياً كما قيل باللهجة الليبية، بدون ترجمة ولا تصحيح ولا تلخيص ولا إضافة.',
    'اكتب الأرقام والمبالغ بالأرقام الإنجليزية (مثلاً 100 و 2.5 و 1250)، وخلّي كلمات العملة زي ما انقالت.',
    'لو التسجيل فاضي أو ما فيهش كلام مفهوم رجّع نص فاضي.',
    hints.length ? `أسماء وكلمات ممكن تنذكر (اكتبها بنفس هالإملاء لو انقالت): ${hints.join('، ')}` : '',
    'رجّع النص فقط.',
  ].filter(Boolean).join('\n');
}

export default async (req: Request) => {
  const user = await currentUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!process.env.GOOGLE_GEMINI_BASE_URL && !process.env.GEMINI_API_KEY) return json({ error: 'ai-off' }, 503);

  let body: any;
  try {
    body = await readJson(req, MAX_BODY);
  } catch (e: any) {
    return json({ error: e.status === 413 ? 'too-long' : 'bad-request' }, e.status || 400);
  }
  const audio = typeof body.audio === 'string' ? body.audio : '';
  if (audio.length < 2000) return json({ text: '' });
  const hints = (Array.isArray(body.hints) ? body.hints : [])
    .filter((x: unknown) => typeof x === 'string' && x.trim())
    .map((x: string) => x.trim().slice(0, 40))
    .slice(0, 80);

  const cap = capOf(body.cap);
  const before = await getUsage();
  if (before.spent >= cap) return json({ error: 'cap', spent: before.spent, cap }, 402);

  const ai = new GoogleGenAI({});
  let lastErr: any = null;
  for (const model of STT_MODELS) {
    try {
      const r = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: audio } }, { text: prompt(hints) }] }],
        config: { temperature: 0, maxOutputTokens: 8192 },
      });
      const after = await addUsage(geminiCost(model, r.usageMetadata));
      const text = (r.text || '').trim().replace(/^["«]|["»]$/g, '');
      return json({ text, usage: { spent: after.spent, cap, month: after.month } });
    } catch (e: any) {
      lastErr = e;
      console.error('[transcribe]', model, e && e.message);
    }
  }
  return json({ error: 'server', message: String((lastErr && lastErr.message) || lastErr).slice(0, 300) }, 502);
};

export const config: Config = { path: '/api/transcribe', method: ['POST'] };
