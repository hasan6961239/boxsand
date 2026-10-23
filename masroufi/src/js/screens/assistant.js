// The money assistant: talk or type, it asks with tappable options when
// something is unclear, and shows a confirmation card (numbers computed by the
// app) before anything is saved. Conversation logic lives in core/assistant.js.

import { h, icon } from '../ui/dom.js';
import { header, iconButton, button, moneyEl, tag, toast, haptic, confirm as confirmDialog } from '../ui/kit.js';
import * as ai from '../core/assistant.js';
import * as auth from '../core/auth.js';
import { canRecord, startRecording } from '../core/recorder.js';
import { fmtMoney, fmtDate, fmtNumber, today } from '../core/util.js';
import { go } from '../core/router.js';
import { on } from '../core/bus.js';
import { openLogin } from './account-sheets.js';

const MODEL_NAMES = { opus: 'Claude Opus', sonnet: 'Claude Sonnet', haiku: 'Claude Haiku' };
const EXAMPLES = [
  'استلفت من عز الدين 100 دينار',
  'تغديت بـ35 وعبّيت بنزين بـ20',
  'قداش صرفت على الأكل هالشهر؟',
  'احسبلي: 3 كراتين في 45 و20 توصيل',
];

let ctx = null; // live DOM of the open screen

// dev builds have no Netlify Identity; the server still checks the real session
const signedIn = () => Boolean(auth.current()) || __DEV__;

/* ------------------------------------------------------------ tiny markdown */

function inline(text) {
  const out = [];
  text.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) out.push(h('b', part.slice(2, -2)));
    else if (part) out.push(part);
  });
  return out;
}

function md(text) {
  const box = h('div.ai-md');
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) box.appendChild(list = h('ul'));
      list.appendChild(h('li', inline(bullet[1])));
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    box.appendChild(h('p', inline(line.replace(/^#+\s*/, ''))));
  }
  return box;
}

/* ------------------------------------------------------------ thread items */

function personLine(p) {
  if (p.after > 0) return [`${p.name} عليه ليك `, moneyEl(p.after, { tone: 'pos' })];
  if (p.after < 0) return [`عليك لـ${p.name} `, moneyEl(-p.after, { tone: 'neg' })];
  return [`خالصين مع ${p.name} ✓`];
}

function proposeCard(item) {
  const t = today();
  const pending = item.status === 'pending';
  const statusTag = {
    applied: tag('تسجّل ✓', 'pos'),
    cancelled: tag('تلغى', 'muted'),
    replied: tag('بدّلناه', 'info'),
    invalid: tag('يحتاج تعديل', 'warn'),
    undone: tag('رجّعناه', 'muted'),
  }[item.status];
  const bal = item.effects.balance;
  return h('div.ai-card.ai-propose', { class: `is-${item.status}` },
    h('div.ai-card-head', h('span.ai-card-ic', icon('list-checks', { size: 18 })), h('b', pending ? 'نسجّل هذا؟' : 'العمليات'), statusTag || null),
    item.summary ? h('p.ai-card-sub', item.summary) : null,
    h('div.ai-lines', item.lines.map((l) => h('div.ai-line',
      h('span.ai-line-lead', l.emoji ? l.emoji : icon(l.icon || 'circle-dollar-sign', { size: 18 })),
      h('div.ai-line-main',
        h('div.ai-line-title', l.title),
        l.sub || (l.date && l.date !== t) ? h('div.ai-line-sub', [l.date && l.date !== t ? fmtDate(l.date) : null, l.sub].filter(Boolean).join(' · ')) : null),
      l.effect ? moneyEl(l.effect, { sign: 'always', tone: 'auto', cls: 'ai-line-amt' }) : h('span.ai-line-amt.faint', '—')))),
    h('div.ai-effects',
      ...item.effects.people.map((p) => h('div.ai-effect.is-person', icon('handshake', { size: 16 }), h('span', personLine(p)))),
      bal.after !== bal.before ? h('div.ai-effect', icon('wallet', { size: 16 }), h('span', 'رصيدك ', moneyEl(bal.before), ' ← ', h('b', moneyEl(bal.after)))) : null),
    pending ? h('div.ai-card-actions',
      button({ label: 'سجّل', icon: 'check', size: 'md', onClick: () => onConfirm(item) }),
      button({ label: 'عدّل', variant: 'soft', size: 'md', onClick: () => onEdit() }),
      button({ label: 'إلغاء', variant: 'plain', size: 'md', onClick: () => ai.cancel(item.id) }))
      : item.status === 'applied' ? h('div.ai-card-actions.is-end', button({ label: 'تراجع', icon: 'undo-2', variant: 'plain', size: 'sm', onClick: () => onUndo(item) })) : null);
}

function askCard(item, { live }) {
  const picked = item.questions.map((q, i) => (item.done ? new Set(item.answers && item.answers[i] ? [item.answers[i]] : []) : new Set()));
  const other = item.questions.map(() => '');
  const single = item.questions.length === 1 && !item.questions[0].multi;
  const okBtn = button({ label: 'تمام', icon: 'check', size: 'md', block: true, onClick: () => submit() });
  const ready = () => picked.every((s, i) => s.size || other[i].trim());
  const paintOk = () => { okBtn.disabled = !ready(); };
  const answers = () => item.questions.map((q, i) => [...picked[i], other[i].trim()].filter(Boolean).join('، '));
  function submit() {
    if (!ready() || !live()) return;
    haptic(10);
    ai.answer(item.id, answers());
  }

  const body = item.questions.map((q, qi) => {
    const box = h('div.ai-q');
    const otherInput = h('input.input.ai-q-other', {
      placeholder: 'اكتب جوابك…',
      enterkeyhint: 'done',
      oninput: (e) => { other[qi] = e.target.value; paintOk(); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (single) submit(); else e.target.blur(); } },
    });
    otherInput.hidden = true;
    const chipsEl = h('div.chips.ai-q-opts', q.options.map((opt) => {
      const done = item.done && item.answers && String(item.answers[qi] || '').split('، ').includes(opt);
      return h('button.chip.tap', {
        type: 'button',
        class: { on: done },
        disabled: item.done,
        onclick: (e) => {
          haptic();
          if (q.multi) {
            picked[qi].has(opt) ? picked[qi].delete(opt) : picked[qi].add(opt);
            e.currentTarget.classList.toggle('on', picked[qi].has(opt));
          } else {
            picked[qi] = new Set([opt]);
            chipsEl.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget));
            other[qi] = '';
            otherInput.hidden = true;
          }
          paintOk();
          if (single) submit();
        },
      }, opt);
    }));
    if (q.other && !item.done) {
      chipsEl.appendChild(h('button.chip.tap.ai-q-more', {
        type: 'button',
        onclick: (e) => {
          haptic();
          if (!q.multi) {
            picked[qi] = new Set();
            chipsEl.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget));
          }
          otherInput.hidden = false;
          otherInput.focus();
          paintOk();
        },
      }, icon('pencil', { size: 14 }), 'غير هذا…'));
    }
    box.append(h('div.ai-q-text', q.question), chipsEl, otherInput);
    if (item.done && item.answers && item.answers[qi] && !q.options.includes(item.answers[qi])) {
      box.appendChild(h('div.ai-q-typed', icon('pencil', { size: 14 }), item.answers[qi]));
    }
    return box;
  });
  paintOk();
  return h('div.ai-card.ai-ask', { class: { 'is-done': item.done } },
    h('div.ai-card-head', h('span.ai-card-ic', icon('circle-help', { size: 18 })), h('b', item.done ? 'جاوبت' : 'محتاج نتأكد من حاجة')),
    body,
    !item.done && !single ? h('div.ai-card-actions', okBtn) : null);
}

function itemNode(item) {
  switch (item.k) {
    case 'user': return h('div.ai-msg.is-user', h('div.ai-bubble', item.text));
    case 'bot': return h('div.ai-msg.is-bot', h('div.ai-bubble', md(item.text)));
    case 'calc': return h('div.ai-calc', icon('calculator', { size: 15 }), h('span', item.label || 'حسبة'), h('span.ai-calc-expr', item.expression), h('b', '= ' + fmtNumber(Math.round(item.result * 1000))));
    case 'note': return h('div.ai-note', { class: `tone-${item.tone || 'muted'}` }, item.text);
    case 'error': return h('div.ai-error',
      icon('triangle-alert', { size: 18 }), h('span', item.text),
      item.retry ? button({ label: 'عاود', icon: 'refresh-cw', variant: 'soft', size: 'sm', onClick: () => ai.retry() })
        : item.code === 'unauthorized' ? button({ label: 'سجّل دخول', variant: 'soft', size: 'sm', onClick: () => go('/settings/account') })
          : item.code === 'cap' ? button({ label: 'الإعدادات', variant: 'soft', size: 'sm', onClick: () => go('/settings/assistant') }) : null);
    case 'ask': return askCard(item, { live: () => !ai.isBusy() });
    case 'propose': return proposeCard(item);
    default: return null;
  }
}

/* ------------------------------------------------------------ thread rendering */

// logging in or out changes the intro and unlocks the composer
on('auth', () => {
  if (!ctx) return;
  const intro0 = ctx.thread.querySelector('.ai-intro');
  if (intro0) intro0.remove();
  paint(ai.state());
});

const sigOf = (item) => `${item.k}|${item.status || ''}|${item.done ? 1 : 0}|${item.answers ? item.answers.join('|') : ''}`;

function intro() {
  return h('div.ai-intro',
    h('div.ai-intro-art', icon('sparkles', { size: 30 })),
    h('h2', 'أهلين! 👋'),
    h('p', 'قولي شو صار معاك وأنا نرتبهولك: مصاريف، ديون، مرتبات، أو أي حسبة. لو في حاجة مش واضحة نسألك، وما نسجّل شي إلا بموافقتك.'),
    signedIn()
      ? h('div.ai-examples', EXAMPLES.map((ex) => h('button.ai-example.tap', { type: 'button', onclick: () => { haptic(); ai.send(ex); } }, ex)))
      : h('div.ai-login', h('p', 'المساعد يحتاج تكون مسجّل دخول لحسابك.'), button({ label: 'سجّل دخول', icon: 'log-in', onClick: () => openLogin() })));
}

function paint(st) {
  if (!ctx) return;
  const { thread, scroll } = ctx;
  const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 160;
  const items = st.conv ? st.conv.view : [];

  if (!items.length && !st.busy) {
    if (!thread.querySelector('.ai-intro')) thread.replaceChildren(intro());
    ctx.nodes = [];
  } else {
    const intro0 = thread.querySelector('.ai-intro');
    if (intro0) intro0.remove();
    // reuse nodes whose item hasn't changed so open cards keep their state
    const next = items.map((item, i) => {
      const prev = ctx.nodes[i];
      if (prev && prev.item === item && prev.sig === sigOf(item)) return prev;
      return { item, sig: sigOf(item), node: itemNode(item) };
    });
    const want = next.map((n) => n.node).filter(Boolean);
    want.forEach((node, i) => {
      if (thread.children[i] !== node) thread.insertBefore(node, thread.children[i] || null);
    });
    while (thread.children.length > want.length) thread.lastChild.remove();
    ctx.nodes = next;
  }

  // the turn being generated
  ctx.liveEl.remove();
  if (st.busy) {
    ctx.liveEl.replaceChildren(st.live
      ? h('div.ai-bubble', md(st.live))
      : h('div.ai-bubble.ai-typing', h('span'), h('span'), h('span')));
    thread.appendChild(ctx.liveEl);
  }

  // header: model and this month's use
  const s = ai.settings();
  const u = st.usage;
  ctx.sub.textContent = `${MODEL_NAMES[s.model] || MODEL_NAMES.opus}${u ? ` · هالشهر ${u.spent.toFixed(2)}$ من ${Number(u.cap).toFixed(2)}$` : ''}`;
  ctx.newBtn.disabled = st.busy || !items.length;
  paintComposer();

  if (nearBottom || ctx.forceScroll) {
    ctx.forceScroll = false;
    requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  }
}

/* ------------------------------------------------------------ owner actions */

function onConfirm(item) {
  const r = ai.confirm(item.id);
  if (!r) return;
  haptic(14);
  const a = r.alerts && r.alerts[0];
  if (a) toast(a.level >= 100 ? `تجاوزت ${a.name}! (${Math.round(a.pct)}%)` : `انتبه: وصلت ${Math.round(a.pct)}% من ${a.name}`, { tone: a.level >= 100 ? 'neg' : 'warn' });
  else toast('تسجّل ✓', { tone: 'pos' });
}

async function onUndo(item) {
  const ok = await confirmDialog({ title: 'ترجّع التسجيل؟', body: 'العمليات اللي سجلها المساعد هنا تنحذف.', ok: 'رجّعها', danger: true, icon: 'undo-2' });
  if (!ok) return;
  ai.undo(item.id);
  toast('رجّعناها');
}

function onEdit() {
  if (!ctx) return;
  ctx.input.placeholder = 'قول شو نبدّل… مثلاً: المبلغ 25 مش 20';
  ctx.input.focus();
}

/* ------------------------------------------------------------ composer */

function grow() {
  const el = ctx.input;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function submitText() {
  const text = ctx.input.value.trim();
  if (!text || ai.isBusy()) return;
  haptic(10);
  ctx.input.value = '';
  ctx.input.placeholder = 'اكتب أو اضغط المايك…';
  ctx.hint.hidden = true;
  grow();
  ctx.forceScroll = true;
  ai.send(text);
}

function paintComposer() {
  if (!ctx) return;
  const ok = signedIn();
  const hasText = Boolean(ctx.input.value.trim());
  const rec = ctx.rec;
  ctx.composer.classList.toggle('is-locked', !ok);
  ctx.composer.classList.toggle('is-recording', Boolean(rec && !rec.transcribing));
  ctx.composer.classList.toggle('is-transcribing', Boolean(rec && rec.transcribing));
  ctx.input.disabled = !ok || Boolean(rec);
  ctx.sendBtn.hidden = !hasText;
  ctx.micBtn.hidden = hasText;
  ctx.sendBtn.disabled = ai.isBusy();
  ctx.micBtn.disabled = !ok || Boolean(rec) || !canRecord();
}

async function startMic() {
  if (!ctx || ctx.rec) return;
  haptic(12);
  const bars = ctx.levelBars;
  ctx.rec = { started: Date.now() };
  paintComposer();
  try {
    const handle = await startRecording({
      onLevel: (v) => {
        const k = bars.children.length;
        const i = ctx && ctx.rec ? Math.floor(((Date.now() - ctx.rec.started) / 90) % k) : 0;
        if (bars.children[i]) bars.children[i].style.transform = `scaleY(${0.15 + v * 0.85})`;
      },
      onLimit: () => stopMic(true),
    });
    if (!ctx || !ctx.rec) { handle.cancel(); return; }
    ctx.rec.handle = handle;
    ctx.timer = setInterval(() => {
      if (!ctx || !ctx.rec) return;
      const s = Math.floor((Date.now() - ctx.rec.started) / 1000);
      ctx.recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
  } catch (e) {
    if (ctx) ctx.rec = null;
    paintComposer();
    toast(e.message === 'denied' ? 'لازم تسمح للتطبيق يستعمل المايك (من إعدادات الآيفون ← Safari ← المايكروفون)' : 'المايك مش متاح على هالجهاز', { tone: 'neg', duration: 5000 });
  }
}

async function stopMic(keep) {
  if (!ctx || !ctx.rec) return;
  const { handle } = ctx.rec;
  clearInterval(ctx.timer);
  if (!handle) { ctx.rec = null; paintComposer(); return; }
  if (!keep) {
    handle.cancel();
    ctx.rec = null;
    paintComposer();
    return;
  }
  haptic(10);
  ctx.rec.transcribing = true;
  paintComposer();
  try {
    const out = await handle.stop();
    if (out.ms < 600) throw Object.assign(new Error('short'), { code: 'short' });
    const text = await ai.transcribe(out);
    if (!ctx) return;
    if (!text) throw Object.assign(new Error('empty'), { code: 'empty' });
    const cur = ctx.input.value.trim();
    ctx.input.value = cur ? `${cur} ${text}` : text;
    ctx.hint.hidden = false;
    grow();
  } catch (e) {
    toast({
      short: 'التسجيل قصير، اضغط وتكلم شوية أطول',
      empty: 'ما سمعتش كلام واضح، عاود جرّب',
      cap: 'خلص حد المساعد لهالشهر',
      unauthorized: 'لازم تسجّل دخول',
    }[e.code] || 'ما قدرناش نحوّل الصوت لنص، عاود جرّب', { tone: 'neg' });
  } finally {
    if (ctx) {
      ctx.rec = null;
      paintComposer();
    }
  }
}

function composer() {
  const input = h('textarea.ai-input', {
    rows: 1,
    placeholder: 'اكتب أو اضغط المايك…',
    enterkeyhint: 'send',
    dir: 'auto',
    oninput: () => { grow(); paintComposer(); },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submitText();
      }
    },
  });
  const sendBtn = h('button.ai-round.is-send.tap', { type: 'button', 'aria-label': 'ابعث', onclick: submitText }, icon('arrow-up', { size: 22, stroke: 2.4 }));
  const micBtn = h('button.ai-round.is-mic.tap', { type: 'button', 'aria-label': 'سجّل صوت', onclick: startMic }, icon('mic', { size: 22 }));
  const levelBars = h('div.ai-level', Array.from({ length: 24 }, () => h('i')));
  const recTime = h('span.ai-rec-time', '0:00');
  const recBar = h('div.ai-rec',
    h('button.ai-round.is-cancel.tap', { type: 'button', 'aria-label': 'إلغاء التسجيل', onclick: () => stopMic(false) }, icon('x', { size: 20 })),
    h('div.ai-rec-mid', h('span.ai-rec-dot'), recTime, levelBars, h('span.ai-rec-wait', 'نحوّل الصوت لنص…')),
    h('button.ai-round.is-done.tap', { type: 'button', 'aria-label': 'خلّصت', onclick: () => stopMic(true) }, icon('check', { size: 22, stroke: 2.6 })));
  const hint = h('div.ai-hint', icon('pencil', { size: 14 }), 'راجع النص وصلّحه لو لزم، وبعدين ابعثه');
  hint.hidden = true;
  const locked = h('div.ai-locked',
    h('span.ai-locked-ic', icon('lock', { size: 18 })),
    h('span.ai-locked-text', 'المساعد يحتاج تسجيل دخول لحسابك'),
    button({ label: 'سجّل دخول', size: 'sm', onClick: () => openLogin() }));
  const el = h('div.ai-composer', locked, hint, recBar, h('div.ai-row', micBtn, sendBtn, input));
  return { el, input, sendBtn, micBtn, levelBars, recTime, hint };
}

/* ------------------------------------------------------------ screen */

export default {
  live: false,
  noTabbar: true,
  render() {
    if (ctx && ctx.unsub) ctx.unsub();
    const newBtn = iconButton('message-square-plus', {
      label: 'محادثة جديدة',
      onClick: async () => {
        if (ai.isBusy()) return;
        const ok = await confirmDialog({ title: 'نبدا محادثة جديدة؟', body: 'المحادثة هذي تنمسح (اللي تسجّل يبقى مسجّل).', ok: 'جديدة', icon: 'message-square-plus' });
        if (ok) ai.reset();
      },
    });
    const head = header({ title: 'المساعد ✨', sub: ' ', back: true, actions: [newBtn, iconButton('settings', { label: 'إعدادات المساعد', onClick: () => go('/settings/assistant') })] });
    const thread = h('div.ai-thread');
    const scroll = h('div.page-scroll.ai-scroll', thread);
    const c = composer();
    ctx = {
      thread, scroll, nodes: [], liveEl: h('div.ai-msg.is-bot.is-live'), sub: head.querySelector('.page-head-sub'), newBtn,
      composer: c.el, input: c.input, sendBtn: c.sendBtn, micBtn: c.micBtn, levelBars: c.levelBars, recTime: c.recTime, hint: c.hint,
      rec: null, timer: null, forceScroll: true,
    };
    ctx.unsub = ai.subscribe(paint);
    ai.load().then(() => paint(ai.state()));
    ai.refreshUsage();
    paint(ai.state());
    return [head, scroll, c.el];
  },
  onLeave() {
    if (!ctx) return;
    if (ctx.rec && ctx.rec.handle) ctx.rec.handle.cancel();
    clearInterval(ctx.timer);
    if (ctx.unsub) ctx.unsub();
    ctx = null;
  },
};
