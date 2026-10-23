// The money assistant (Claude through the Netlify AI Gateway).
//
//   GET  /api/assistant/usage → { spent, cap, month, version }
//   POST /api/assistant  { v, model, cap, messages } → NDJSON stream:
//        {t:'text', d}            text as it is generated
//        {t:'tool', name}         a tool call is being prepared
//        {t:'done', message, usage}
//        {t:'error', code, message}
//
// The conversation lives on the device; the tools run there too (they read and
// write the app's local data), so each request is one model turn.

import type { Config } from '@netlify/functions';
import Anthropic from '@anthropic-ai/sdk';
import { json, currentUser, readJson, diagAllowed } from '../lib/http.mjs';
import { SYSTEM, TOOLS, MODELS, PROMPT_VERSION, claudeCost, capOf, getUsage, addUsage, checkMessages } from '../lib/assistant.mjs';

const MAX_BODY = 600 * 1024;

export default async (req: Request) => {
  const user = diagAllowed(req) ? { id: 'diag' } : await currentUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  if (req.method === 'GET') {
    const u = await getUsage();
    return json({ ...u, cap: capOf(url.searchParams.get('cap')), version: PROMPT_VERSION });
  }

  if (!process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_API_KEY) return json({ error: 'ai-off' }, 503);

  let body: any;
  try {
    body = await readJson(req, MAX_BODY);
    checkMessages(body.messages);
  } catch (e: any) {
    return json({ error: 'bad-request', message: e.message }, e.status || 400);
  }
  const model = MODELS[body.model as keyof typeof MODELS] || MODELS.opus;
  if (body.v !== PROMPT_VERSION && body.messages.length > 1) return json({ error: 'stale', version: PROMPT_VERSION }, 409);

  const cap = capOf(body.cap);
  const before = await getUsage();
  if (before.spent >= cap) return json({ error: 'cap', spent: before.spent, cap }, 402);

  // Cache the fixed prefix and the conversation so far. Moving cache_control
  // markers doesn't invalidate earlier thinking blocks; the copy leaves the
  // client's transcript untouched.
  const messages = body.messages.map((m: any) => ({ ...m, content: [...m.content] }));
  const lastMsg = messages[messages.length - 1];
  const lastBlock = lastMsg.content.length - 1;
  lastMsg.content[lastBlock] = { ...lastMsg.content[lastBlock], cache_control: { type: 'ephemeral' } };

  const client = new Anthropic({ timeout: 55_000, maxRetries: 1 });
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: object) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      try {
        const s = client.messages.stream({
          model,
          max_tokens: 16000,
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          tools: TOOLS as Anthropic.Tool[],
          messages: messages as Anthropic.MessageParam[],
          output_config: { effort: 'medium' },
        });
        for await (const ev of s) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') send({ t: 'text', d: ev.delta.text });
          else if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') send({ t: 'tool', name: ev.content_block.name });
        }
        const msg = await s.finalMessage();
        const after = await addUsage(claudeCost(model, msg.usage));
        send({
          t: 'done',
          v: PROMPT_VERSION,
          message: { content: msg.content, stop_reason: msg.stop_reason },
          usage: { spent: after.spent, cap, month: after.month },
        });
      } catch (e: any) {
        let code = 'server';
        if (e instanceof Anthropic.RateLimitError) code = 'busy';
        else if (e instanceof Anthropic.BadRequestError) code = 'bad-request';
        else if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) code = 'ai-off';
        else if (e instanceof Anthropic.APIConnectionError) code = 'network';
        console.error('[assistant]', code, e && e.message);
        send({ t: 'error', code, message: String((e && e.message) || e).slice(0, 300) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
};

export const config: Config = { path: ['/api/assistant', '/api/assistant/usage'], method: ['GET', 'POST'] };
