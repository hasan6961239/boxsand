// Savings goals: put money aside for something (a car, Umrah, a wedding…).
// Deposits leave the spendable balance and come back on withdrawal.

import { h, icon } from '../ui/dom.js';
import { layout, header, iconButton, section, card, ring, moneyEl, button, empty, sheet, field, input, toast, confirm, stagger, list, row, haptic, confetti, tag, chips, actions } from '../ui/kit.js';
import { amountPad } from '../ui/keypad.js';
import { emojiPicker, colorPicker, dateChips } from '../ui/pickers.js';
import * as store from '../core/store.js';
import { go, rerender } from '../core/router.js';
import { today, fmtMoney, fmtDate, fmtPlain, addDays } from '../core/util.js';
import { goalInfo, goalsOverview } from '../core/finance.js';
import { SWATCHES } from '../core/defaults.js';

let showArchived = false;

function infoOf(goal) {
  return goalInfo(goal, store.data().gtx.filter((g) => g.goal === goal.id), today());
}

/* ------------------------------------------------------------ sheets */

export function openGoalSheet({ id } = {}) {
  const g = id ? store.get(id) : null;
  const st = {
    name: g ? g.name : '',
    emoji: g ? g.emoji : '🎯',
    color: g ? g.color : SWATCHES[store.data().goal.length % SWATCHES.length],
    target: g ? g.target : 0,
    due: g ? g.due || null : null,
  };
  const err = h('p.form-err');
  const targetBtn = h('button.goal-target.tap', { type: 'button', onclick: () => editTarget() });
  const paintTarget = () => targetBtn.replaceChildren(h('small', 'المبلغ المستهدف'), st.target ? h('b', moneyEl(st.target)) : h('b.faint', 'حدّد المبلغ'), icon('pencil', { size: 16 }));
  paintTarget();

  function editTarget() {
    let v = st.target;
    const pad = amountPad({ value: v, tone: 'accent', quick: [], onChange: (m) => { v = m; } });
    sheet({
      title: 'كم تبي تجمع؟',
      body: () => h('div.stack', pad.display, pad.pad),
      footer: (a) => button({ label: 'تمام', size: 'lg', block: true, onClick: () => { st.target = v; paintTarget(); err.textContent = ''; a.close(); } }),
      onClose: () => pad.destroy(),
    });
  }

  const api = sheet({
    title: g ? 'تعديل الهدف' : 'هدف جديد',
    full: true,
    body: () => h('div.stack',
      field('اسم الهدف', input({ value: st.name, placeholder: 'مثلاً: سيارة، عمرة، زواج', maxlength: 40, autofocus: !g, onInput: (v) => { st.name = v; err.textContent = ''; } })),
      targetBtn,
      field('موعد تبي توصله (اختياري)', chips({
        scroll: true,
        options: [{ value: null, label: 'بدون' }, { value: addDays(today(), 180), label: `بعد ${fmtPlain(6)} شهور` }, { value: addDays(today(), 365), label: 'بعد سنة' }, { value: addDays(today(), 730), label: 'بعد سنتين' }],
        value: st.due && ![180, 365, 730].some((d) => addDays(today(), d) === st.due) ? undefined : st.due,
        onChange: (v) => { st.due = v; },
      }), { hint: st.due ? `حالياً: ${fmtDate(st.due)}` : 'نحسبلك كم لازم تحط كل شهر.' }),
      field('الأيقونة', emojiPicker({ value: st.emoji, onChange: (e) => { st.emoji = e; } })),
      field('اللون', colorPicker({ value: st.color, onChange: (c) => { st.color = c; } })),
      err),
    footer: (a) => button({
      label: g ? 'حفظ' : 'أضف الهدف', size: 'lg', block: true,
      onClick: () => {
        if (!st.name.trim()) { err.textContent = 'اكتب اسم الهدف'; return; }
        if (!st.target) { err.textContent = 'حدّد المبلغ المستهدف'; return; }
        const rec = store.put('goal', { ...(g || {}), name: st.name.trim(), emoji: st.emoji, color: st.color, target: st.target, due: st.due || undefined });
        haptic(12);
        a.close(rec.id);
        toast(g ? 'تم الحفظ' : 'بالتوفيق! تمت إضافة الهدف 🎯', { tone: 'pos' });
        if (!g) go(`/goal/${rec.id}`);
      },
    }),
  });
  return api;
}

/** Deposit into (or withdraw from) a goal. With {id} edits an existing movement. */
export function openGoalTxnSheet(goalId, { withdraw = false, id } = {}) {
  const goal = store.get(goalId);
  if (!goal) return null;
  const existing = id ? store.get(id) : null;
  const out = existing ? existing.amount < 0 : withdraw;
  const info = infoOf(goal);
  const max = out ? info.saved + (existing ? -existing.amount : 0) : Infinity;
  const st = { amount: existing ? Math.abs(existing.amount) : 0, date: existing ? existing.date : today(), note: existing ? existing.note || '' : '' };
  const hint = h('p.pay-hint');
  const save = button({ label: existing ? 'حفظ' : out ? 'اسحب' : 'حط في الهدف', size: 'lg', block: true, onClick: () => submit() });
  const pad = amountPad({ value: st.amount, tone: out ? 'neg' : 'pos', quick: [], onChange: (m) => { st.amount = m; check(); } });
  function check() {
    const over = st.amount > max;
    save.disabled = !st.amount || over;
    hint.className = 'pay-hint' + (over ? ' tone-neg' : '');
    hint.textContent = over ? `المدخر ${fmtMoney(max)} بس` : out ? `المدخر توة ${fmtMoney(max)}` : info.remaining ? `باقي ${fmtMoney(Math.max(0, info.remaining - st.amount + (existing ? existing.amount : 0)))} على الهدف` : 'الهدف مكتمل — زيادة خير 💪';
  }
  const api = sheet({
    title: `${goal.emoji} ${out ? 'سحب من' : 'إيداع في'} ${goal.name}`,
    sub: out ? 'الفلوس ترجع لرصيدك.' : 'الفلوس تنحجز من رصيدك للهدف.',
    full: true,
    cls: 'txn-sheet',
    body: () => h('div.txn-top', pad.display, hint, h('div.txn-form',
      field('التاريخ', dateChips({ value: st.date, onChange: (d) => { st.date = d; } })),
      field('ملاحظة', input({ value: st.note, placeholder: 'اختياري', maxlength: 120, onInput: (v) => { st.note = v; } })))),
    footer: () => h('div.txn-foot', pad.pad, h('div.sheet-foot-row',
      existing ? iconButton('trash-2', { label: 'حذف', variant: 'soft', cls: 'btn-text-neg foot-icon', onClick: () => delTxn() }) : null,
      save)),
    onClose: () => pad.destroy(),
  });
  check();

  function submit() {
    if (!st.amount || st.amount > max) return;
    const wasDone = info.done;
    store.put('gtx', { ...(existing || {}), goal: goal.id, amount: out ? -st.amount : st.amount, date: st.date, note: st.note.trim() || undefined });
    haptic(12);
    api.close(true);
    const after = infoOf(goal);
    if (after.done && !wasDone) {
      confetti();
      toast(`مبروك! وصلت هدف ${goal.name} 🎉`, { tone: 'pos' });
    } else toast(out ? `سحبت ${fmtMoney(st.amount)}` : `حطيت ${fmtMoney(st.amount)} · وصلت ${fmtPlain(Math.round(after.pct))}%`, { tone: 'pos' });
  }
  async function delTxn() {
    if (!(await confirm({ title: 'تحذف الحركة؟', ok: 'حذف', danger: true, icon: 'trash-2' }))) return;
    const snap = { ...existing };
    store.remove(existing.id);
    api.close();
    toast('تم الحذف', { action: { label: 'تراجع', onClick: () => store.restore(snap) } });
  }
  return api;
}

/* ------------------------------------------------------------ screens */

function goalCard(i) {
  const g = i.goal;
  return h('button.goal-card.tap.ripple', { type: 'button', style: { '--c': g.color }, onclick: () => go(`/goal/${g.id}`) },
    ring(i.pct, { size: 70, stroke: 7, tone: i.done ? 'pos' : 'goal', label: g.emoji }),
    h('span.goal-card-main',
      h('span.goal-card-top', h('b', g.name), i.done ? tag('وصلته 🎉', 'pos') : null),
      h('span.goal-card-amt', moneyEl(i.saved), h('small', ` من ${fmtMoney(i.goal.target, { currency: false })}`)),
      h('span.goal-card-sub', i.done ? 'كمّلت الهدف' : `باقي ${fmtMoney(i.remaining)}${i.monthly ? ` · ${fmtMoney(i.monthly)} في الشهر` : ''}`)),
    h('span.goal-card-pct', `${fmtPlain(Math.round(i.pct))}%`));
}

export default {
  render() {
    const data = store.data();
    const t = today();
    const ov = goalsOverview(data, t);
    const archived = data.goal.filter((g) => g.archived);
    const head = header({ title: 'أهداف الادخار', back: true, actions: [iconButton('plus', { label: 'هدف جديد', variant: 'accent', onClick: () => openGoalSheet() })] });
    if (!data.goal.length) {
      return layout(head, h('div.goals', card(empty({
        emoji: '🐷',
        title: 'ابدأ أول هدف ادخار',
        body: 'حط هدف (سيارة، عمرة، زواج…) وحط فيه فلوس شوية شوية، ونحسبلك كم باقي وكم لازم كل شهر.',
        action: { label: 'هدف جديد', icon: 'plus', onClick: () => openGoalSheet() },
      }))));
    }
    const blocks = h('div.goals',
      h('div.goals-sum',
        h('span.goals-sum-ic', icon('piggy-bank', { size: 26 })),
        h('div', h('small', 'مجموع اللي مدخره'), h('b', moneyEl(ov.saved))),
        h('div', h('small', 'أهداف شغالة'), h('b', fmtPlain(ov.infos.filter((i) => !i.done).length)))),
      h('div.goals-list', ov.infos.sort((a, b) => Number(a.done) - Number(b.done) || b.pct - a.pct).map(goalCard)),
      archived.length ? h('button.person-settled-toggle.tap', { type: 'button', onclick: () => { showArchived = !showArchived; rerender(); } },
        icon(showArchived ? 'chevron-up' : 'chevron-down', { size: 18 }), `المؤرشفة (${fmtPlain(archived.length)})`) : null,
      showArchived ? h('div.goals-list.is-archived', archived.map((g) => goalCard(infoOf(g)))) : null);
    stagger(blocks);
    return layout(head, blocks);
  },
};

export const goalScreen = {
  render({ id }) {
    const g = store.get(id);
    if (!g) {
      return layout(header({ title: 'الهدف', back: true, onBack: () => go('/goals', { replace: true }) }),
        card(empty({ emoji: '🤷', title: 'الهدف هذا مش موجود', body: 'يمكن انحذف.', action: { label: 'للأهداف', onClick: () => go('/goals', { replace: true }) } })));
    }
    const i = infoOf(g);
    const more = () => actions({
      title: g.name,
      items: [
        { label: 'تعديل', icon: 'pencil', onClick: () => openGoalSheet({ id }) },
        { label: g.archived ? 'رجّعه من الأرشيف' : 'أرشفة', icon: 'archive', onClick: () => { store.patch(id, { archived: g.archived ? undefined : true }); toast(g.archived ? 'رجع للأهداف' : 'تمت الأرشفة'); } },
        { label: 'حذف الهدف', icon: 'trash-2', tone: 'neg', onClick: () => deleteGoal(g) },
      ],
    });
    const head = header({ title: g.name, back: true, onBack: () => history.state && history.state.n > 0 ? history.back() : go('/goals', { replace: true }), actions: [iconButton('ellipsis', { label: 'خيارات', onClick: more })] });
    const hero = h('div.goal-hero', { style: { '--c': g.color } },
      ring(i.pct, { size: 168, stroke: 14, tone: i.done ? 'pos' : 'goal', label: `${fmtPlain(Math.round(i.pct))}%`, sub: g.emoji }),
      h('b.goal-hero-amt', moneyEl(i.saved)),
      h('span.faint', `من ${fmtMoney(g.target)}`),
      i.done ? tag('وصلت الهدف 🎉', 'pos') : null,
      h('div.goal-hero-stats',
        h('div', h('small', 'باقي'), h('b', moneyEl(i.remaining))),
        g.due ? h('div', h('small', 'الموعد'), h('b', fmtDate(g.due))) : null,
        i.monthly ? h('div', h('small', 'في الشهر'), h('b', moneyEl(i.monthly))) : null),
      h('div.goal-hero-actions',
        button({ label: 'إيداع', icon: 'plus', onClick: () => openGoalTxnSheet(id) }),
        button({ label: 'سحب', icon: 'minus', variant: 'ghost', disabled: !i.saved, onClick: () => openGoalTxnSheet(id, { withdraw: true }) })));
    const hist = i.list.length ? section('الحركات', list(i.list.map((x) => row({
      lead: { icon: x.amount >= 0 ? 'arrow-down-left' : 'arrow-up-right', tone: x.amount >= 0 ? 'pos' : 'warn' },
      title: x.amount >= 0 ? 'إيداع' : 'سحب',
      sub: `${fmtDate(x.date, 'relative')}${x.note ? ' · ' + x.note : ''}`,
      end: moneyEl(x.amount, { sign: 'always', tone: x.amount >= 0 ? 'pos' : 'neg' }),
      onClick: () => openGoalTxnSheet(id, { id: x.id }),
    })))) : section(null, card(h('p.faint.small.center', 'لسه ما حطيتش فلوس في الهدف هذا.')));
    const blocks = h('div.goals', hero, hist);
    stagger(blocks);
    return layout(head, blocks);
  },
};

async function deleteGoal(g) {
  const txs = store.data().gtx.filter((x) => x.goal === g.id);
  const saved = txs.reduce((a, x) => a + x.amount, 0);
  const ok = await confirm({
    title: `تحذف هدف ${g.name}؟`,
    body: saved ? `المدخر فيه (${fmtMoney(saved)}) يرجع لرصيدك لأن حركاته تنحذف معاه.` : 'ما فيه أي فلوس.',
    ok: 'حذف', danger: true, icon: 'trash-2',
  });
  if (!ok) return;
  const snap = [g, ...txs].map((r) => ({ ...r }));
  store.batch(() => snap.forEach((r) => store.remove(r.id)));
  go('/goals', { replace: true });
  toast('تم حذف الهدف', { action: { label: 'تراجع', onClick: () => store.batch(() => snap.forEach((r) => store.restore(r))) } });
}
