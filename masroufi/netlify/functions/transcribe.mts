// POST /api/transcribe { audio (base64), mime, hints: [names…], cap } → { text, usage }
// Speech-to-text for the assistant's mic button, with Gemini (Netlify AI Gateway).
// Claude can't hear audio, so the recording is written out here first and the
// owner checks the text before it is sent to the assistant.
//
// Errors the app reacts to: 413 { error: 'too-big' } (the gateway refuses large
// requests on the Free plan — the app sends shorter pieces), 415 { error: 'format' }
// (the compressed recording isn't accepted — the app falls back to WAV).

import type { Config } from '@netlify/functions';
import { GoogleGenAI, ApiError, ThinkingLevel } from '@google/genai';
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

// The transcript goes straight into the owner's message box, so inventing
// words is worse than returning nothing (Gemini otherwise "hears" sentences in
// noise or tones).
const SYSTEM = [
  'You are a speech-to-text engine for Libyan Arabic. Output only the words actually spoken in the audio, verbatim, in Arabic script, in the dialect as spoken — no translation, correction, summary or additions.',
  'Write numbers and amounts with Western digits (100, 2.5, 1250) and keep currency words as spoken.',
  `If the audio has no clearly audible human speech (silence, noise, music, tones), or you cannot make out the words, output exactly ${'[]'} and nothing else. Never guess or invent words.`,
].join('\n');
const NOTHING = '[]';

function prompt(hints: string[]) {
  return [
    'Transcribe this recording.',
    hints.length ? `Names and words that may be said (spell them like this if you hear them): ${hints.join('، ')}` : '',
  ].filter(Boolean).join('\n');
}

// keep thinking to a minimum: transcription doesn't need it, and it made a
// 10-second clip take longer than the function's time limit
const thinkingFor = (model: string) => (model.startsWith('gemini-2.') ? { thinkingBudget: 0 } : { thinkingLevel: ThinkingLevel.MINIMAL });

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

  const ai = new GoogleGenAI({ httpOptions: { timeout: 24_000 } });
  let lastErr: any = null;
  let refused = false;
  for (const model of STT_MODELS) {
    for (const mimeType of labels) {
      try {
        const run = (thinking: object | null) => ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: audio } }, { text: prompt(hints) }] }],
          config: { systemInstruction: SYSTEM, temperature: 0, maxOutputTokens: 2048, ...(thinking ? { thinkingConfig: thinking } : {}) },
        });
        let r;
        try {
          r = await run(thinkingFor(model));
        } catch (e: any) {
          // a model that doesn't take this thinking setting: ask again with its default
          if (e instanceof ApiError && e.status === 400 && /think/i.test(String(e.message))) r = await run(null);
          else throw e;
        }
        const after = await addUsage(geminiCost(model, r.usageMetadata));
        let text = (r.text || '').trim().replace(/^["«]|["»]$/g, '');
        if (text === NOTHING || /^\[\s*\]$/.test(text)) text = '';
        return json({ text, model, mimeType, usage: { spent: after.spent, cap, month: after.month } });
      } catch (e: any) {
        lastErr = e;
        console.error('[transcribe]', model, mimeType, e && e.message);
        if (tooBig(e)) return json({ error: 'too-big' }, 413);
        // a 400 is about the audio itself: try the next label. An unknown model:
        // try the next one. Anything else (timeout, outage): stop — the function
        // has a time limit and the app shows a retry.
        if (e instanceof ApiError && e.status === 400) refused = true;
        else if (e instanceof ApiError && e.status === 404) break;
        else return json({ error: 'server', message: String((e && e.message) || e).slice(0, 300) }, 502);
      }
    }
    if (refused) return json({ error: 'format' }, 415);
  }
  return json({ error: 'server', message: String((lastErr && lastErr.message) || lastErr).slice(0, 300) }, 502);
};

export const config: Config = { path: '/api/transcribe', method: ['POST'] };
