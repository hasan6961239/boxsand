// The assistant conversation: talks to /api/assistant one model turn at a time
// and runs the tools here on the device, where the data lives.
//
// The API transcript (`conv.messages`) is append-only and sent back exactly as
// received — Claude's thinking blocks are only valid in the unchanged
// conversation that produced them. What the screen shows is kept separately in
// `conv.view`.
//
// Tools: calculate and query_data answer immediately; ask_user and
// propose_actions wait for the owner. After a proposal is saved or cancelled we
// don't call the model again (that would cost a turn just to say "done"); the
// result travels with the owner's next message instead.

import * as store from './store.js';
import * as db from './db.js';
import * as auth from './auth.js';
import { today } from './util.js';
import { evaluate } from './calc.js';
import { snapshot, hints, runQuery, planActions, appliedResult } from './ai-data.js';
import { checkBudgets } from './automation.js';
import { splitAtPauses, wavBase64 } from './recorder.js';

const KEY = 'assistant';
const MAX_AUTO_ROUNDS = 8;

let conv = null;
let busy = false;
let live = ''; // text of the turn being streamed
let usage = null; // { spent, cap, month }
let loaded = null;
const listeners = new Set();

export const state = () => ({ conv, busy, live, usage });
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const fn of listeners) fn(state());
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => db.setMeta(KEY, conv).catch(() => {}), 200);
}

export function load() {
  loaded ||= db.getMeta(KEY, null).then((c) => {
    if (c && Array.isArray(c.messages)) conv = c;
    // the app was closed while waiting for a reply: offer to ask again
    const last = conv && conv.messages[conv.messages.length - 1];
    const tail = conv && conv.view[conv.view.length - 1];
    if (last && last.role === 'user' && !busy && !(tail && tail.k === 'error')) {
      conv.view.push({ k: 'error', code: 'network', text: 'انقطعت المحادثة قبل ما يوصل الرد.', retry: true });
    }
    notify();
  }).catch(() => {});
  return loaded;
}

export const settings = () => ({ model: 'opus', cap: 0.8, ...(store.settings().ai || {}) });

function newConversation() {
  const s = settings();
  conv = { id: Date.now(), v: null, model: s.model, messages: [], view: [], waiting: null, notes: [], started: today() };
}

export function reset() {
  if (busy) return;
  conv = null;
  live = '';
  db.setMeta(KEY, null).catch(() => {});
  notify();
}

const view = (item) => {
  conv.view.push(item);
  return item;
};
const toolResult = (id, content, isError = false) => ({
  type: 'tool_result',
  tool_use_id: id,
  content: typeof content === 'string' ? content : JSON.stringify(content),
  ...(isError ? { is_error: true } : {}),
});

/* ------------------------------------------------------------ sending */

/** The owner typed (or dictated) something. */
export async function send(text) {
  text = String(text || '').trim();
  if (!text || busy) return;
  if (!conv || conv.stale) newConversation();
  const content = [];
  let consumed = false;

  if (!conv.messages.length) {
    content.push({ type: 'text', text: `<app_data>\n${JSON.stringify(snapshot(store.data(), today()))}\n</app_data>` });
  }
  if (conv.waiting) {
    for (const u of conv.waiting.uses) {
      let r = conv.waiting.results[u.id];
      if (!r) {
        // the owner answered in words instead of tapping
        const item = conv.view.find((v) => v.id === u.id);
        if (u.name === 'ask_user') {
          r = toolResult(u.id, `The owner typed instead of picking an option: ${text}`);
          if (item) Object.assign(item, { done: true, answers: [text] });
        } else {
          r = toolResult(u.id, { status: 'not_applied', owner_says: text });
          if (item) item.status = 'replied';
        }
        consumed = true;
      }
      content.push(r);
    }
    conv.waiting = null;
  }
  for (const n of conv.notes.splice(0)) content.push({ type: 'text', text: n });
  if (!consumed) content.push({ type: 'text', text });

  conv.messages.push({ role: 'user', content });
  view({ k: 'user', text });
  persist();
  await turn();
}

/** One or more model turns, until the model waits for the owner. */
async function turn() {
  busy = true;
  for (let round = 0; round < MAX_AUTO_ROUNDS; round++) {
    let msg;
    try {
      msg = await callModel();
    } catch (e) {
      failed(e);
      break;
    }
    const again = handle(msg);
    persist();
    if (!again) break;
  }
  busy = false;
  live = '';
  persist();
  notify();
}

/** Retry the last request after a network or server error. */
export function retry() {
  if (busy || !conv || !conv.messages.length) return;
  const last = conv.messages[conv.messages.length - 1];
  if (last.role !== 'user') return;
  conv.view = conv.view.filter((v) => v.k !== 'error');
  turn();
}

async function callModel() {
  live = '';
  notify();
  const s = settings();
  await auth.ensureFresh();
  const res = await fetch('/api/assistant', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ v: conv.v, model: conv.model, cap: s.cap, messages: conv.messages }),
  });
  if (!res.ok) {
    let j = {};
    try { j = await res.json(); } catch { /* not json */ }
    const e = new Error(j.error || `http ${res.status}`);
    e.code = j.error || (res.status === 401 ? 'unauthorized' : 'server');
    if (j.cap) usage = { spent: j.spent, cap: j.cap };
    throw e;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let done = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.t === 'text') {
        live += ev.d;
        notify();
      } else if (ev.t === 'done') {
        done = ev;
      } else if (ev.t === 'error') {
        const e = new Error(ev.message || ev.code);
        e.code = ev.code;
        throw e;
      }
    }
  }
  if (!done) {
    const e = new Error('stream ended early');
    e.code = 'network';
    throw e;
  }
  conv.v = done.v;
  usage = done.usage;
  return done.message;
}

function failed(e) {
  const code = e.code || (e instanceof TypeError ? 'network' : 'server');
  if (code === 'stale') {
    conv.stale = true;
    view({ k: 'note', tone: 'info', text: 'المساعد تحدّث، المحادثة الجاية تبدا من جديد. عاود اكتب طلبك.' });
    return;
  }
  const text = {
    unauthorized: 'لازم تسجّل دخول لحسابك عشان تستعمل المساعد (الإعدادات ← الحساب).',
    cap: 'خلص حد المساعد لهالشهر. يرجع يخدم أول الشهر الجاي، أو كبّر الحد من الإعدادات ← المساعد.',
    'ai-off': 'المساعد مش شغال على الموقع توة. جرّب بعد شوية.',
    busy: 'المساعد مزحوم شوية، جرّب بعد دقيقة.',
    network: 'ما وصلناش للمساعد. تأكد من النت وعاود.',
  }[code] || 'صار خطأ في المساعد. عاود جرّب.';
  view({ k: 'error', code, text, retry: !['unauthorized', 'cap'].includes(code) });
}

/** Show the model's turn and run its tools. Returns true to call the model again. */
function handle(msg) {
  conv.messages.push({ role: 'assistant', content: msg.content });
  for (const b of msg.content) if (b.type === 'text' && b.text.trim()) view({ k: 'bot', text: b.text.trim() });

  const uses = msg.content.filter((b) => b.type === 'tool_use');
  if (msg.stop_reason === 'refusal') {
    view({ k: 'note', tone: 'warn', text: 'المساعد ما يقدرش يساعد في هذا.' });
    if (!uses.length) return false;
  }
  if (!uses.length) return false;

  const cut = msg.stop_reason === 'max_tokens' || msg.stop_reason === 'refusal';
  conv.waiting = { uses: uses.map((u) => ({ id: u.id, name: u.name })), results: {} };
  for (const u of uses) {
    const input = u.input || {};
    if (cut) {
      conv.waiting.results[u.id] = toolResult(u.id, 'This tool call was cut off before it finished. Try again, shorter.', true);
      continue;
    }
    if (u.name === 'calculate') {
      try {
        const result = evaluate(input.expression);
        view({ k: 'calc', label: input.label, expression: input.expression, result });
        conv.waiting.results[u.id] = toolResult(u.id, { result });
      } catch (e) {
        conv.waiting.results[u.id] = toolResult(u.id, `Could not evaluate "${input.expression}": ${e.message}`, true);
      }
    } else if (u.name === 'query_data') {
      try {
        conv.waiting.results[u.id] = toolResult(u.id, runQuery(store.data(), input, today()));
      } catch (e) {
        conv.waiting.results[u.id] = toolResult(u.id, `query failed: ${e.message}`, true);
      }
    } else if (u.name === 'ask_user') {
      const questions = (Array.isArray(input.questions) ? input.questions : []).slice(0, 3)
        .map((q) => ({ question: String(q.question || ''), options: (q.options || []).map(String).slice(0, 6), multi: Boolean(q.multi), other: Boolean(q.allow_other) }));
      if (!questions.length) conv.waiting.results[u.id] = toolResult(u.id, 'No questions were given.', true);
      else view({ k: 'ask', id: u.id, questions, done: false });
    } else if (u.name === 'propose_actions') {
      const plan = planActions(store.data(), input.actions, today());
      if (!plan.ok) {
        conv.waiting.results[u.id] = toolResult(u.id, { status: 'invalid', errors: plan.errors }, true);
        view({ k: 'note', tone: 'muted', text: 'المساعد يراجع الحسبة…' });
      } else {
        view({ k: 'propose', id: u.id, summary: String(input.summary || ''), actions: input.actions, lines: plan.lines, effects: plan.effects, status: 'pending' });
      }
    } else {
      conv.waiting.results[u.id] = toolResult(u.id, `Unknown tool ${u.name}`, true);
    }
  }
  return ready();
}

/** All tool calls of the last turn answered? Returns true when the model should be called now. */
function ready() {
  const w = conv.waiting;
  if (!w || w.uses.some((u) => !w.results[u.id])) return false;
  // a saved or cancelled proposal waits for the owner's next message
  if (w.hold && w.uses.every((u) => u.name === 'propose_actions')) return false;
  conv.messages.push({ role: 'user', content: w.uses.map((u) => w.results[u.id]) });
  conv.waiting = null;
  return true;
}

function resume() {
  persist();
  if (ready()) turn();
  else notify();
}

/* ------------------------------------------------------------ owner actions */

export function answer(id, answers) {
  if (busy || !conv || !conv.waiting) return;
  const item = conv.view.find((v) => v.id === id && v.k === 'ask');
  if (!item || item.done) return;
  item.done = true;
  item.answers = answers;
  const text = item.questions.map((q, i) => `${q.question}\n→ ${answers[i] || '(no answer)'}`).join('\n\n');
  conv.waiting.results[id] = toolResult(id, text);
  resume();
}

export function confirm(id) {
  if (busy || !conv || !conv.waiting) return null;
  const item = conv.view.find((v) => v.id === id && v.k === 'propose');
  if (!item || item.status !== 'pending') return null;
  const plan = planActions(store.data(), item.actions, today()); // data may have changed since
  if (!plan.ok) {
    item.status = 'invalid';
    conv.waiting.results[id] = toolResult(id, { status: 'invalid', errors: plan.errors }, true);
    resume();
    return null;
  }
  store.batch(() => plan.ops.forEach((op) => store.put(op.col, op.rec)));
  const alerts = plan.ops.some((op) => op.rec.type === 'expense') ? checkBudgets() : [];
  Object.assign(item, { status: 'applied', ids: plan.ops.map((op) => op.rec.id), lines: plan.lines, effects: plan.effects });
  conv.waiting.results[id] = toolResult(id, appliedResult(plan));
  conv.waiting.hold = true;
  resume();
  return { plan, alerts };
}

export function cancel(id) {
  if (busy || !conv || !conv.waiting) return;
  const item = conv.view.find((v) => v.id === id && v.k === 'propose');
  if (!item || item.status !== 'pending') return;
  item.status = 'cancelled';
  conv.waiting.results[id] = toolResult(id, { status: 'cancelled', note: 'The owner tapped cancel. Nothing was saved.' });
  conv.waiting.hold = true;
  resume();
}

/** Remove the records a confirmed proposal created. */
export function undo(id) {
  if (!conv) return;
  const item = conv.view.find((v) => v.id === id && v.k === 'propose');
  if (!item || item.status !== 'applied') return;
  store.batch(() => item.ids.forEach((rid) => store.remove(rid)));
  item.status = 'undone';
  const note = { status: 'undone', note: 'The owner saved these records and then undid them. Nothing from this proposal is saved now.' };
  if (conv.waiting && conv.waiting.results[id]) conv.waiting.results[id] = toolResult(id, note);
  else conv.notes.push('(The owner undid the records of the last saved proposal — they are deleted.)');
  persist();
  notify();
}

/* ------------------------------------------------------------ voice & usage */

async function transcribeOne(base64, mime) {
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio: base64, mime, hints: hints(store.data()), cap: settings().cap }),
  });
  let j = {};
  try { j = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    const e = new Error(j.error || `http ${res.status}`);
    e.code = j.error || (res.status === 401 ? 'unauthorized' : res.status === 413 ? 'too-big' : 'server');
    throw e;
  }
  if (j.usage) {
    usage = j.usage;
    notify();
  }
  return j.text || '';
}

// Requests through the AI gateway must stay small, so recordings go as short
// WAV pieces (cut at pauses), halved again if the gateway still refuses one.
const PIECE_SEC = 10;
const PARALLEL = 4;

/** Like Promise.all(list.map(fn)), at most `n` at a time, results in order. */
async function mapLimit(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
  return out;
}

async function wavPiece(pcm, rate, depth = 0) {
  try {
    return await transcribeOne(await wavBase64(pcm, rate), 'audio/wav');
  } catch (e) {
    if (e.code !== 'too-big' || depth >= 3 || pcm.length < rate * 3) throw e;
    const halves = splitAtPauses(pcm, rate, pcm.length / rate / 2 + 0.5);
    return (await Promise.all(halves.map((p) => wavPiece(p, rate, depth + 1)))).filter(Boolean).join(' ');
  }
}

/** Loudest 50 ms of the recording (RMS) — near zero means nobody spoke. */
function peakLevel(pcm, rate) {
  const win = Math.floor(rate * 0.05);
  let peak = 0;
  for (let p = 0; p + win <= pcm.length; p += win) {
    let s = 0;
    for (let i = p; i < p + win; i++) s += pcm[i] * pcm[i];
    peak = Math.max(peak, Math.sqrt(s / win));
  }
  return peak;
}

/** Speech → text for a recording from core/recorder.js. */
export async function transcribe(rec) {
  // don't send silence: speech-to-text tends to invent words for it
  if (peakLevel(rec.pcm, rec.rate) < 0.01) return '';
  await auth.ensureFresh();
  const pieces = splitAtPauses(rec.pcm, rec.rate, PIECE_SEC);
  return (await mapLimit(pieces, PARALLEL, (p) => wavPiece(p, rec.rate))).filter(Boolean).join(' ');
}

export async function refreshUsage() {
  try {
    await auth.ensureFresh();
    const res = await fetch(`/api/assistant/usage?cap=${encodeURIComponent(settings().cap)}`, { credentials: 'same-origin' });
    if (res.ok) {
      const j = await res.json();
      usage = { spent: j.spent, cap: j.cap, month: j.month };
      notify();
    }
  } catch { /* offline */ }
  return usage;
}

export const isBusy = () => busy;
