// POST /api/transcribe { audio (base64), mime, hints: [names…], cap } → { text, usage }
// Speech-to-text for the assistant's mic button, with Gemini (Netlify AI Gateway).
// Claude can't hear audio, so the recording is written out here first and the
// owner checks the text before it is sent to the assistant.
//
// Errors the app reacts to: 413 { error: 'too-big' } (the gateway refuses large
// requests on the Free plan — the app sends shorter pieces), 415 { error: 'format' }
// (the compressed recording isn't accepted — the app falls back to WAV).

import type { Config } from '@netlify/functions';
import { GoogleGenAI, ApiError } from '@google/genai';
import { json, currentUser, readJson, diagAllowed } from '../lib/http.mjs';
import { capOf, getUsage, addUsage, geminiCost } from '../lib/assistant.mjs';

const MAX_BODY = 1.5 * 1024 * 1024;
const STT_MODELS = [process.env.GEMINI_STT_MODEL || 'gemini-3.8-flash', 'gemini-2.5-flash'];
// labels to try for each kind of recording (the same bytes; Gemini reads the container)
const LABELS: Record<string, string[]> = {
  'audio/wav': ['audio/wav'],
  'audio/mp4': ['audio/mp4', 'video/mp4'],
  'audio/webm': ['audio/webm', 'video/webm'],
  'audio/ogg': ['audio/ogg'],
};

function prompt(hints: string[]) {
  return [
    'اكتب نص هذا التسجيل الصوتي حرفياً كما قيل باللهجة الليبية، بدون ترجمة ولا تصحيح ولا تلخيص ولا إضافة.',
    'اكتب الأرقام والمبالغ بالأرقام الإنجليزية (مثلاً 100 و 2.5 و 1250)، وخلّي كلمات العملة زي ما انقالت.',
    'لو التسجيل فاضي أو ما فيهش كلام مفهوم رجّع نص فاضي.',
    hints.length ? `أسماء وكلمات ممكن تنذكر (اكتبها بنفس هالإملاء لو انقالت): ${hints.join('، ')}` : '',
    'رجّع النص فقط.',
  ].filter(Boolean).join('\n');
}

const tooBig = (e: any) => /input_tokens_exceeded|request size exceeds/i.test(String(e && e.message));

export default async (req: Request) => {
  const user = diagAllowed(req) ? { id: 'diag' } : await currentUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!process.env.GOOGLE_GEMINI_BASE_URL && !process.env.GEMINI_API_KEY) return json({ error: 'ai-off' }, 503);

  let body: any;
  try {
    body = await readJson(req, MAX_BODY);
  } catch (e: any) {
    return json({ error: e.status === 413 ? 'too-big' : 'bad-request' }, e.status || 400);
  }
  const audio = typeof body.audio === 'string' ? body.audio : '';
  if (audio.length < 2000) return json({ text: '' });
  const labels = LABELS[String(body.mime || 'audio/wav').split(';')[0]];
  if (!labels) return json({ error: 'format' }, 415);
  const hints = (Array.isArray(body.hints) ? body.hints : [])
    .filter((x: unknown) => typeof x === 'string' && x.trim())
    .map((x: string) => x.trim().slice(0, 40))
    .slice(0, 80);

  const cap = capOf(body.cap);
  const before = await getUsage();
  if (before.spent >= cap) return json({ error: 'cap', spent: before.spent, cap }, 402);

  const ai = new GoogleGenAI({});
  let lastErr: any = null;
  let refused = false;
  for (const model of STT_MODELS) {
    for (const mimeType of labels) {
      try {
        const r = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: audio } }, { text: prompt(hints) }] }],
          config: { temperature: 0, maxOutputTokens: 4096 },
        });
        const after = await addUsage(geminiCost(model, r.usageMetadata));
        const text = (r.text || '').trim().replace(/^["«]|["»]$/g, '');
        return json({ text, model, mimeType, usage: { spent: after.spent, cap, month: after.month } });
      } catch (e: any) {
        lastErr = e;
        console.error('[transcribe]', model, mimeType, e && e.message);
        if (tooBig(e)) return json({ error: 'too-big' }, 413);
        // a 400 here is about the audio itself: try the next label; anything else: next model
        if (e instanceof ApiError && e.status === 400) refused = true;
        else break;
      }
    }
    if (refused) return json({ error: 'format' }, 415);
  }
  return json({ error: 'server', message: String((lastErr && lastErr.message) || lastErr).slice(0, 300) }, 502);
};

export const config: Config = { path: '/api/transcribe', method: ['POST'] };
