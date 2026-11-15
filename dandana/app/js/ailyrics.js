// Lyrics written by AI from the song's own audio (speech-to-text), for songs
// that have no lyrics in the file or on LRCLIB. The model is asked to
// transcribe what is sung, never to recall lyrics from memory, so it can't
// invent a "famous" version of a song it doesn't hear.
//
// Providers (the user's own free key, kept on the device):
//   Gemini  — aistudio.google.com/apikey   (audio understanding, LRC output)
//   Groq    — console.groq.com/keys        (Whisper large-v3, segment timestamps)
import * as lib from './library.js';
import * as db from './db.js';
import { parseLRC } from './lyrics.js';
import { fetchTimeout } from './util.js';

export const PROVIDERS = { gemini: 'Gemini (جوجل)', groq: 'Groq (Whisper)' };
const keyOf = (p) => (p === 'groq' ? lib.settings.groqKey : lib.settings.geminiKey) || '';
export const provider = () => (keyOf(lib.settings.aiProvider) ? lib.settings.aiProvider : keyOf('gemini') ? 'gemini' : keyOf('groq') ? 'groq' : null);
export const hasAI = () => !!provider();

// ---------------------------------------------------------------- audio prep

const GEMINI_INLINE_MAX = 14 * 1024 * 1024; // base64 adds a third; request limit is 20 MB
const GROQ_MAX = 24 * 1024 * 1024;

/** Decode any audio/video the browser can play and re-encode 16 kHz mono WAV. */
async function toWav(blob, maxSeconds) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('هذا الجهاز لا يقدر يجهّز الصوت');
  const ctx = new Ctx();
  let buf;
  try {
    buf = await new Promise((res, rej) => {
      blob.arrayBuffer().then((ab) => {
        const p = ctx.decodeAudioData(ab, res, rej);
        if (p && p.then) p.then(res, rej);
      }, rej);
    });
  } finally {
    ctx.close && ctx.close();
  }
  const rate = 16000;
  const secs = Math.min(buf.duration, maxSeconds);
  const off = new OfflineAudioContext(1, Math.ceil(secs * rate), rate);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start(0);
  const out = (await off.startRendering()).getChannelData(0);
  const pcm = new DataView(new ArrayBuffer(44 + out.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) pcm.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); pcm.setUint32(4, 36 + out.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  pcm.setUint32(16, 16, true); pcm.setUint16(20, 1, true); pcm.setUint16(22, 1, true);
  pcm.setUint32(24, rate, true); pcm.setUint32(28, rate * 2, true); pcm.setUint16(32, 2, true); pcm.setUint16(34, 16, true);
  w(36, 'data'); pcm.setUint32(40, out.length * 2, true);
  for (let i = 0; i < out.length; i++) pcm.setInt16(44 + i * 2, Math.max(-1, Math.min(1, out[i])) * 0x7fff, true);
  return new Blob([pcm.buffer], { type: 'audio/wav' });
}

function kind(t, blob) {
  const n = (t.fileName || '').toLowerCase();
  const m = (blob.type || t.mime || '').toLowerCase();
  if (/\.mp3$/.test(n) || m === 'audio/mpeg') return { ext: 'mp3', mime: 'audio/mp3' };
  if (/\.wav$/.test(n) || m.includes('wav')) return { ext: 'wav', mime: 'audio/wav' };
  if (/\.flac$/.test(n) || m.includes('flac')) return { ext: 'flac', mime: 'audio/flac' };
  if (/\.(ogg|oga|opus)$/.test(n) || m.includes('ogg')) return { ext: 'ogg', mime: 'audio/ogg' };
  if (/\.m4a$/.test(n) || m === 'audio/mp4' || m === 'audio/x-m4a') return { ext: 'm4a', mime: 'audio/mp4' };
  if (/\.aac$/.test(n) || m === 'audio/aac') return { ext: 'aac', mime: 'audio/aac' };
  return { ext: 'mp4', mime: m || 'video/mp4' };
}

async function audioFor(trackId, prov, onStatus) {
  const t = lib.tracks.get(trackId);
  const rec = await db.get('media', trackId);
  if (!t || !rec) throw new Error('ملف الأغنية مفقود');
  const blob = rec.blob;
  const k = kind(t, blob);
  const okGemini = ['mp3', 'wav', 'flac', 'ogg', 'aac'].includes(k.ext) && blob.size <= GEMINI_INLINE_MAX;
  const okGroq = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'mp4'].includes(k.ext) && blob.size <= GROQ_MAX;
  if (prov === 'gemini' ? okGemini : okGroq) return { blob, mime: k.mime, ext: k.ext, t };
  if (blob.size > 150 * 1024 * 1024) throw new Error('الملف كبير جداً على الذكاء الاصطناعي');
  onStatus && onStatus('يجهّز الصوت…');
  const wav = await toWav(blob, prov === 'gemini' ? 7 * 60 : 12 * 60);
  return { blob: wav, mime: 'audio/wav', ext: 'wav', t };
}

const b64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

// ---------------------------------------------------------------- Gemini

const GBASE = 'https://generativelanguage.googleapis.com/v1beta/';

async function gemini(path, body, key, ms = 120000) {
  let r;
  try {
    r = await fetchTimeout(GBASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }, ms);
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'انتهت المهلة — جرّب مرة ثانية' : 'تعذّر الاتصال بـ Gemini');
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = d.error || {};
    const reasons = (e.details || []).map((x) => x.reason).filter(Boolean);
    if (reasons.includes('API_KEY_INVALID') || /API key not valid/i.test(e.message)) throw new Error('مفتاح Gemini غير صحيح');
    if (r.status === 429) throw new Error('وصلت حد Gemini المجاني الآن — جرّب بعد دقيقة');
    if (r.status === 404) throw Object.assign(new Error('النموذج غير متاح'), { model404: true });
    throw new Error((e.message || `خطأ من Gemini (${r.status})`).slice(0, 200));
  }
  return d;
}

/** Newest "flash" model the key can use (names change often on the free tier). */
async function geminiModel(key, refresh = false) {
  const cached = await db.kvGet('geminiModel', null);
  if (!refresh && cached && Date.now() - cached.at < 3 * 86400e3) return cached.name;
  let name = 'gemini-2.5-flash';
  try {
    const d = await gemini('models?pageSize=200', null, key, 15000);
    const ok = (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /^gemini-\d+(\.\d+)?-flash(-lite)?(-preview[\w-]*|-\d{3})?$/.test(n) && !/image|tts|live|audio|thinking/.test(n));
    const score = (n) => {
      const v = parseFloat(n.match(/gemini-(\d+(?:\.\d+)?)/)[1]);
      return v * 100 - (/-lite/.test(n) ? 30 : 0) - (/preview/.test(n) ? 5 : 0);
    };
    ok.sort((a, b) => score(b) - score(a));
    if (ok[0]) name = ok[0];
  } catch (e) {
    if (/غير صحيح/.test(e.message)) throw e;
  }
  db.kvSet('geminiModel', { name, at: Date.now() });
  return name;
}

const PROMPT = `Transcribe the sung vocals in this audio exactly as they are heard.
Rules:
- Write in the original language and script of the singing (Arabic songs in Arabic script, keeping the dialect as sung). Do not translate.
- Output only LRC lines like: [01:23.45] the words — one line per sung phrase, timestamp = when that phrase starts in the audio.
- Repeat lines as many times as they are actually sung. Skip instrumental parts (no line for music).
- Do not write a title, artist, notes, explanations or lyrics you cannot hear.
- If there are no vocals at all, output exactly: NO_LYRICS`;

async function viaGemini(trackId, onStatus) {
  const key = lib.settings.geminiKey;
  const a = await audioFor(trackId, 'gemini', onStatus);
  onStatus && onStatus('يرفع الأغنية…');
  const data = await b64(a.blob);
  let model = await geminiModel(key);
  const req = {
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: a.mime, data } }, { text: PROMPT }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
  };
  onStatus && onStatus('يسمع الأغنية ويكتب الكلمات… (حتى دقيقة)');
  let d;
  try {
    d = await gemini(`models/${model}:generateContent`, req, key);
  } catch (e) {
    if (!e.model404) throw e;
    model = await geminiModel(key, true);
    d = await gemini(`models/${model}:generateContent`, req, key);
  }
  const c = d.candidates && d.candidates[0];
  if (!c) {
    const why = d.promptFeedback && d.promptFeedback.blockReason;
    throw new Error(why ? `Gemini رفض الطلب (${why})` : 'Gemini ما رجّع شيء');
  }
  if (c.finishReason === 'RECITATION') throw new Error('Gemini رفض كتابة كلمات هذي الأغنية (حقوق النشر). جرّب Groq من الإعدادات.');
  const text = (c.content && c.content.parts || []).map((p) => p.text || '').join('').trim();
  return { text, source: `ذكاء اصطناعي · ${model}` };
}

// ---------------------------------------------------------------- Groq (Whisper)

const JUNK = /(ترجمة|اشترك|الاشتراك|شكرا للمشاهدة|شكراً للمشاهدة|نانسي|قنقر|subtitles?|amara|موسيقى|music|♪|\[.*?\]|\(.*?\))/i;

async function viaGroq(trackId, onStatus) {
  const key = lib.settings.groqKey;
  const a = await audioFor(trackId, 'groq', onStatus);
  onStatus && onStatus('يرفع الأغنية ويكتب الكلمات… (حتى دقيقة)');
  const fd = new FormData();
  fd.append('file', a.blob, `song.${a.ext}`);
  fd.append('model', 'whisper-large-v3');
  fd.append('response_format', 'verbose_json');
  fd.append('temperature', '0');
  fd.append('timestamp_granularities[]', 'segment');
  if (/[؀-ۿ]/.test(`${a.t.title} ${a.t.artist}`)) fd.append('language', 'ar');
  let r;
  try {
    r = await fetchTimeout('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd }, 180000);
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'انتهت المهلة — جرّب مرة ثانية' : 'تعذّر الاتصال بـ Groq');
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (d.error && d.error.message) || '';
    if (r.status === 401) throw new Error('مفتاح Groq غير صحيح');
    if (r.status === 429) throw new Error('وصلت حد Groq المجاني الآن — جرّب بعد شوية');
    if (r.status === 413) throw new Error('الملف كبير على Groq');
    throw new Error((m || `خطأ من Groq (${r.status})`).slice(0, 200));
  }
  const lines = [];
  for (const s of d.segments || []) {
    const text = (s.text || '').trim();
    if (!text || JUNK.test(text) || (s.no_speech_prob || 0) > 0.6) continue;
    const prev = lines.slice(-3).map((x) => x.text);
    if (prev.length === 3 && prev.every((x) => x === text)) continue; // Whisper loops
    lines.push({ t: s.start || 0, text });
  }
  const mm = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  return { text: lines.map((l) => `[${mm(l.t)}] ${l.text}`).join('\n') || 'NO_LYRICS', source: 'ذكاء اصطناعي · Whisper' };
}

// ---------------------------------------------------------------- entry

const busy = new Map();

/** Transcribe a library track; saves and returns {synced, plain, source}. */
export function transcribe(trackId, onStatus) {
  if (busy.has(trackId)) return busy.get(trackId);
  const p = (async () => {
    const prov = provider();
    if (!prov) throw new Error('أضف مفتاح الذكاء الاصطناعي من الإعدادات');
    const { text, source } = prov === 'groq' ? await viaGroq(trackId, onStatus) : await viaGemini(trackId, onStatus);
    if (!text || /^NO_LYRICS/.test(text)) {
      await lib.updateTrack(trackId, { lyricsData: null, lyricsChecked: true, aiNoLyrics: true }, { silent: true });
      throw new Error('ما فيش غناء واضح في هذا المقطع');
    }
    const synced = parseLRC(text).filter((l) => l.text && !/^NO_LYRICS/.test(l.text));
    const plain = synced.length ? synced.map((l) => l.text).join('\n') : text.replace(/^\s*\[[^\]]*\]\s*/gm, '');
    const data = { synced: synced.length > 2 ? synced : null, plain, source, ai: true };
    await lib.updateTrack(trackId, { lyricsData: data, lyricsChecked: true, aiNoLyrics: false }, { silent: true });
    return data;
  })().finally(() => busy.delete(trackId));
  busy.set(trackId, p);
  return p;
}

export async function testKey(prov) {
  if (prov === 'groq') {
    const r = await fetchTimeout('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + lib.settings.groqKey } }, 15000);
    if (r.status === 401) throw new Error('مفتاح Groq غير صحيح');
    if (!r.ok) throw new Error(`Groq رد بخطأ (${r.status})`);
    return 'Groq · whisper-large-v3';
  }
  return 'Gemini · ' + (await geminiModel(lib.settings.geminiKey, true));
}

/**
 * Lyrics for the whole library: LRCLIB first (free, exact), AI for the rest.
 * Runs while the app stays open; onProgress({done,total,ok,failed,current}).
 */
export async function batch(onProgress, signal) {
  const { getLyrics } = await import('./lyrics.js');
  const todo = lib.list().filter((t) => !t.lyricsData && !t.lyrics && !t.aiNoLyrics && t.kind !== 'video');
  const st = { done: 0, total: todo.length, ok: 0, failed: 0, current: '' };
  for (const t of todo) {
    if (signal && signal.aborted) break;
    st.current = t.title;
    onProgress && onProgress({ ...st });
    try {
      let data = t.lyricsChecked ? null : await getLyrics({ trackId: t.id, title: t.title, artist: t.artist, duration: t.duration });
      if (!data) {
        data = await transcribe(t.id);
        await new Promise((r) => setTimeout(r, 4000)); // stay under the free per-minute limit
      }
      if (data) st.ok++;
    } catch (e) {
      st.failed++;
      if (/حد|غير صحيح/.test(e.message)) { st.error = e.message; break; }
    }
    st.done++;
  }
  st.current = '';
  onProgress && onProgress({ ...st });
  return st;
}
