import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { logger } from './logger.js';
import { buildSystemPrompt } from './prompt.js';
import { recentMessages, recordMessage } from './db.js';
import { declarationsFor, runTool } from './tools/index.js';

const MAX_TOOL_ROUNDS = 6;

// Built on first use so a missing key surfaces as our own message at boot,
// not as an SDK warning at import time.
let client = null;
function ai() {
  client ??= new GoogleGenAI({ apiKey: config.env.geminiKey });
  return client;
}

/**
 * Runs one turn of the conversation.
 *
 * @param {object} user      the sender, as resolved from config
 * @param {string} text      the (possibly merged) text of their messages
 * @param {Array}  media     [{ mimeType, data }] — voice notes, images, documents
 * @returns {{ text: string, attachments: Array }}
 */
export async function respond(user, text, media = []) {
  const history = recentMessages(user.phone, config.behaviour.memoryTurns).map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  const parts = [];
  for (const item of media) {
    parts.push({ inlineData: { mimeType: item.mimeType, data: item.data } });
  }
  if (text) parts.push({ text });
  if (!parts.length) return { text: '', attachments: [] };

  const contents = [...history, { role: 'user', parts }];
  const ctx = { user, attachments: [] };
  const tools = [{ functionDeclarations: declarationsFor(user) }];

  let reply = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const result = await ai().models.generateContent({
      model: config.env.geminiModel,
      contents,
      config: {
        systemInstruction: buildSystemPrompt(user),
        tools,
        temperature: 0.7,
      },
    });

    const candidate = result.candidates?.[0];
    const responseParts = candidate?.content?.parts || [];
    const calls = responseParts.filter((p) => p.functionCall).map((p) => p.functionCall);
    const said = responseParts.filter((p) => p.text).map((p) => p.text).join('').trim();

    if (!calls.length) {
      reply = said || result.text?.trim() || '';
      break;
    }

    contents.push({ role: 'model', parts: responseParts });

    const responses = [];
    for (const call of calls) {
      logger.info({ tool: call.name, args: call.args }, 'تشغيل أداة');
      const output = await runTool(call.name, call.args, ctx);
      responses.push({ functionResponse: { name: call.name, response: { result: output } } });
    }
    contents.push({ role: 'user', parts: responses });

    // Whatever it said alongside the tool call is still worth keeping if the
    // loop ends up exhausting its rounds.
    if (said) reply = said;
  }

  if (text) recordMessage(user.phone, 'user', text);
  else if (media.length) recordMessage(user.phone, 'user', '[رسالة صوتية/ملف]');
  if (reply) recordMessage(user.phone, 'model', reply);

  return { text: reply, attachments: ctx.attachments };
}
