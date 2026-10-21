// The assistant's fixed instructions and tools, the models it may use, and a
// monthly spending cap (the AI runs on the Netlify team's credits — if those run
// out on the Free plan the whole site pauses, so we stop well before that).
//
// SYSTEM and TOOLS must stay byte-identical for the life of a conversation:
// Claude's thinking blocks are bound to the exact prefix that produced them, so
// any edit makes a stored conversation unusable. PROMPT_VERSION is a hash of both;
// the client starts a fresh conversation when it changes.

import { createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const MODELS = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

// USD per million tokens, from the gateway's published price list.
const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.12 },
  // audio input is priced above text on Gemini — count it generously
  'gemini-3.8-flash': { input: 1.5, output: 3.75 },
  'gemini-2.5-flash': { input: 1, output: 2.5 },
};

export function claudeCost(model, u) {
  const p = PRICES[model];
  if (!p || !u) return 0;
  return ((u.input_tokens || 0) * p.input
    + (u.cache_read_input_tokens || 0) * p.cacheRead
    + (u.cache_creation_input_tokens || 0) * p.cacheWrite
    + (u.output_tokens || 0) * p.output) / 1e6;
}

export function geminiCost(model, meta) {
  const p = PRICES[model];
  if (!p || !meta) return 0;
  const out = (meta.candidatesTokenCount || 0) + (meta.thoughtsTokenCount || 0);
  return ((meta.promptTokenCount || 0) * p.input + out * p.output) / 1e6;
}

/* ------------------------------------------------------------ monthly cap */

export const DEFAULT_CAP = 0.8;
const HARD_MAX = Number(process.env.AI_HARD_MAX_USD) || 3;

/** The cap the owner picked in the app, kept within sane bounds. */
export function capOf(requested) {
  const n = Number(requested);
  return Math.min(HARD_MAX, Math.max(0.1, Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP));
}

const monthKey = () => new Date().toISOString().slice(0, 7);
const usageStore = () => getStore({ name: 'ai-usage', consistency: 'strong' });

export async function getUsage() {
  const month = monthKey();
  const rec = await usageStore().get(month, { type: 'json' });
  return { month, spent: rec ? rec.usd : 0, calls: rec ? rec.calls : 0 };
}

export async function addUsage(usd) {
  if (!usd) return getUsage();
  const store = usageStore();
  const month = monthKey();
  for (let i = 0; i < 5; i++) {
    const cur = await store.getWithMetadata(month, { type: 'json' });
    const next = { usd: (cur ? cur.data.usd : 0) + usd, calls: (cur ? cur.data.calls : 0) + 1 };
    const opts = cur && cur.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
    const w = await store.setJSON(month, next, opts);
    if (w.modified) return { month, spent: next.usd, calls: next.calls };
  }
  return getUsage();
}

/* ------------------------------------------------------------ instructions */

export const SYSTEM = `You are «المساعد», the money assistant inside «مصروفي», a personal-finance app used by one person in Libya (the owner). You talk with the owner in friendly, short Libyan Arabic, using Western digits and amounts like "80 د.ل".

What you do:
1. Turn what the owner says or types into records in the app: expenses, income, office-drawer withdrawals, salaries, debts and debt payments. Messages are often speech-to-text of Libyan dialect and can contain recognition mistakes.
2. Do calculations for the owner (including work calculations for customers) and explain them step by step.
3. Answer questions about the owner's money from the app's data.

The first user message starts with <app_data>: a JSON snapshot taken when the conversation started (today's date, balance, office salary status, people with their open debts, categories, recent records). Amounts are in dinars. For anything newer or more detailed call query_data, which reads the live data. Never invent numbers.

How the app records money (amounts in dinars, up to 3 decimals):
- expense: money the owner spent, with an expense category id.
- income: money received that isn't a salary or a debt, with an income category id.
- advance: money taken from the office drawer ("سحبت من الدرج"). It adds to the balance now and the app deducts it from the next office salary automatically. Never record a drawer withdrawal as a debt.
- office_salary: the office salary was received. amount = the salary before deductions (normally the amount in app_data); the app subtracts the drawer withdrawals itself.
- state_salary: the state salary («مرتب الدولة») arrived; month = the 'YYYY-MM' it belongs to if the owner says.
- new_person: someone who isn't in app_data yet. Give it a ref (p1, p2…) and use that ref as person in later actions of the same proposal.
- debt: dir "in" = the person owes the owner (سلّفته، عطيته دين، ليّ عنده). dir "out" = the owner owes the person (استلفت منه، تسلّفت، عليّ له). cash = true when money actually changed hands right then (lending or borrowing cash, or paying for something on someone's behalf): "in" lowers the balance, "out" raises it. cash = false for an obligation where no money moves now (e.g. writing down an old debt the balance already reflects). Give a debt a ref (d1, d2…) if a payment in the same proposal refers to it.
- payment: an installment on a debt. dir "in" = the person paid the owner back (balance goes up); dir "out" = the owner paid the person (balance goes down). debt = the debt id from app_data/query_data or a ref from this proposal; leave it empty to let the app use that person's oldest open debt in that direction. A payment can't be more than what's left on the debt.
- Buying something for someone with the owner's money is money given: if they'll repay it → debt "in" with cash = true; if it's taken off what the owner owes them → payment "out" on that debt.
- Buying on credit (the shop or a person paid, the owner pays later) = an expense plus a debt "out" with cash = true.
- adjust: only when the owner says their real cash differs from the app's balance (signed amount).

Worked example — «استلفت من عز الدين 100، وبعدين قالي جيبلي حوايج من المحل واخصمها من اللي عطاهولك، وجبتله بـ20»:
  1) debt: person عز الدين, dir "out", amount 100, cash true, ref d1
  2) payment: dir "out", amount 20, debt "d1", note "حوايج من المحل"
  → عليك لعز الدين 80 د.ل. If app_data already shows that 100 debt, don't create it again — propose only the payment on the existing debt id.

Rules:
- Nothing is saved until the owner confirms. To record anything call propose_actions; the app shows a confirmation card with the effect computed by the app. Don't say something is recorded unless a tool result says "applied".
- Before proposing, make sure each record's essentials are known: who, which direction, the amount, whether money moved, which existing debt, and the category for expenses. When something that matters is missing or ambiguous, call ask_user with short options (most likely first). Ask at most 3 questions at once, only what changes the result, and prefer a single round. Infer the rest: the date is today unless said otherwise, the category from context.
- Match names to people in app_data even when spelled differently by speech-to-text (عزالدين / عز الدين / عزو). If you can't tell whether it's an existing person or a new one, ask.
- Use calculate for every number you derive (sums, differences, splits, percentages). Don't do mental arithmetic for numbers you show.
- For questions about the owner's data call query_data, then answer briefly with the numbers it returns.
- Work calculations (تخليص زباين، حسبة شغل): calculate, then show a short breakdown with one item per line and the total in bold. Don't record anything unless the owner asks.
- If the speech-to-text is garbled or an amount could mean two things, ask instead of guessing. Libyan amount words: ميتين = 200، ألفين = 2000، نص = 0.5، ربع = 0.25، دينار ونص = 1.5.
- Dates are YYYY-MM-DD; work out relative dates («أمس»، «الخميس اللي فات») from today in app_data.
- Use only category ids from app_data; person and debt ids from app_data or query_data, or refs from the same proposal.
- After a proposal is applied or cancelled you'll get the result together with the owner's next message — just continue.
- Keep replies short: one to three lines. The cards show the details, so don't repeat them. Use **bold** for key totals.`;

const str = (description) => ({ type: 'string', description });

export const TOOLS = [
  {
    name: 'ask_user',
    description: 'Ask the owner one to three short multiple-choice questions when information that changes the record or the answer is missing or ambiguous. The app shows the options as buttons and returns the answers as the tool result. Put the question only here, not also in your text.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          description: '1 to 3 questions',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['question', 'options', 'multi', 'allow_other'],
            properties: {
              question: str('Short question in Libyan Arabic'),
              options: { type: 'array', items: { type: 'string' }, description: '2 to 5 short options, most likely first' },
              multi: { type: 'boolean', description: 'true when several options can be picked' },
              allow_other: { type: 'boolean', description: 'true to let the owner type another answer' },
            },
          },
        },
      },
    },
  },
  {
    name: 'propose_actions',
    description: 'Propose records to save in the app. The app validates them, shows the owner a confirmation card with the resulting balances, and saves only when the owner confirms. Call it once all essentials are known. Use "" for fields that don\'t apply.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'actions'],
      properties: {
        summary: str('One short line in Libyan Arabic describing what will be recorded'),
        actions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'ref', 'amount', 'date', 'note', 'category', 'person', 'name', 'phone', 'dir', 'cash', 'debt', 'due', 'month'],
            properties: {
              kind: { type: 'string', enum: ['expense', 'income', 'advance', 'office_salary', 'state_salary', 'new_person', 'debt', 'payment', 'adjust'] },
              ref: str('Temporary id (p1, d1…) for a new_person or debt that later actions refer to, else ""'),
              amount: { type: 'number', description: 'Dinars. Positive, except adjust which is signed. 0 for new_person' },
              date: str('YYYY-MM-DD, or "" for today'),
              note: str('Short note in Arabic, or ""'),
              category: str('Category id for expense/income, else ""'),
              person: str('debt/payment: person id from app_data or a new_person ref, else ""'),
              name: str('new_person: the name, else ""'),
              phone: str('new_person: phone number if given, else ""'),
              dir: { type: 'string', enum: ['in', 'out', ''], description: 'debt/payment direction (see instructions), else ""' },
              cash: { type: 'boolean', description: 'debt: did money change hands now. false for other kinds' },
              debt: str('payment: debt id or a debt ref from this proposal, or "" to use the oldest open debt'),
              due: str('debt: due date YYYY-MM-DD, or ""'),
              month: str('state_salary: YYYY-MM it belongs to, or ""'),
            },
          },
        },
      },
    },
  },
  {
    name: 'query_data',
    description: 'Read the live app data to answer questions or check details: "transactions" (filtered list with totals, optionally grouped), "debts" (everyone with what they owe / are owed and open debts), "person" (one person\'s full statement), "summary" (balance, this budget month\'s totals by category, office salary status). Amounts are in dinars and already computed by the app.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'from', 'to', 'type', 'category', 'person', 'search', 'group_by'],
      properties: {
        kind: { type: 'string', enum: ['transactions', 'debts', 'person', 'summary'] },
        from: str('Start date YYYY-MM-DD, or ""'),
        to: str('End date YYYY-MM-DD, or ""'),
        type: { type: 'string', enum: ['', 'expense', 'income', 'advance', 'salary', 'state'], description: 'transactions: record type, or "" for all' },
        category: str('transactions: category id, or ""'),
        person: str('person: the person id (required for kind "person"), else ""'),
        search: str('transactions: text to look for in notes and category names, or ""'),
        group_by: { type: 'string', enum: ['none', 'category', 'day', 'month', 'type'] },
      },
    },
  },
  {
    name: 'calculate',
    description: 'Evaluate an arithmetic expression exactly (+ - * / × ÷ parentheses, decimals, and percent like "15%" meaning 0.15). Use it for every number you derive.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expression', 'label'],
      properties: {
        expression: str('e.g. "(3 * 45) + 20 - 12.5"'),
        label: str('What is being calculated, in Arabic'),
      },
    },
  },
];

export const PROMPT_VERSION = createHash('sha256').update(JSON.stringify({ SYSTEM, TOOLS })).digest('hex').slice(0, 10);

/* ------------------------------------------------------------ request check */

const BLOCKS = new Set(['text', 'tool_use', 'tool_result', 'thinking', 'redacted_thinking']);

/** Throws on anything that isn't a plausible conversation from our own client. */
export function checkMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 120) throw new Error('bad messages');
  messages.forEach((m, i) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) throw new Error('bad role');
    if (i === 0 && m.role !== 'user') throw new Error('must start with user');
    if (!Array.isArray(m.content) || !m.content.length) throw new Error('bad content');
    for (const b of m.content) if (!b || !BLOCKS.has(b.type)) throw new Error('bad block');
  });
  if (messages[messages.length - 1].role !== 'user') throw new Error('must end with user');
}
