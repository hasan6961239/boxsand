// Fixed monthly expenses (rent, internet, subscriptions…): recorded by
// themselves on their day each month.

import { h, icon } from '../ui/dom.js';
import { layout, header, iconButton, section, card, moneyEl, button, empty, sheet, field, input, toast, confirm, stagger, toggle, chips, haptic } from '../ui/kit.js';
import { amountPad } from '../ui/keypad.js';
import { categoryGrid } from '../ui/pickers.js';
import * as store from '../core/store.js';
import { today, fmtMoney, fmtDate, fmtIn, fmtPlain, monthKey, addMonths, dayInMonth, diffDays, sum } from '../core/util.js';
import { category, nextRuleDate } from '../core/finance.js';
import { postDueRecurring } from '../core/automation.js';
import { openCategorySheet } from './categories.js';

export function openRuleSheet({ id, preset = {} } = {}) {
  const r = id ? store.get(id) : null;
  const t = today();
  const st = {
    name: r ? r.name : preset.name || '',
    amount: r ? r.amount : preset.amount || 0,
    cat: r ? r.cat : preset.cat || 'cat:home',
    day: r ? r.day : preset.day || Number(t.slice(8, 10)),
    active: r ? r.active !== false : true,
    thisMonth: true,
  };
  const err = h('p.form-err');
  const save = button({ label: r ? 'حفظ' : 'أضف المصروف الثابت', size: 'lg', block: true, onClick: () => submit() });
  const pad = amountPad({ value: st.amount, tone: 'neg', quick: [], onChange: (m) => { st.amount = m; err.textContent = ''; } });
  const startBox = h('div');

  const passed = () => dayInMonth(monthKey(t), st.day) < t;
  function paintStart() {
    startBox.replaceChildren(!r && passed() ? field(`يوم ${fmtPlain(st.day)} فات هالشهر — يتسجل لهالشهر كمان؟`, chips({
      options: [{ value: true, label: 'إيه، سجّله توة' }, { value: false, label: 'لا، من الشهر الجاي' }],
      value: st.thisMonth,
      onChange: (v) => { st.thisMonth = v; },
    })) : '');
  }

  const days = h('div.rule-days', Array.from({ length: 31 }, (_, i) => i + 1).map((d) => h('button.rule-day.tap', {
    type: 'button',
    class: { on: d === st.day },
    onclick: (e) => {
      haptic(4);
      st.day = d;
      days.querySelectorAll('.rule-day').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
      paintStart();
    },
  }, fmtPlain(d))));

  const api = sheet({
    title: r ? 'تعديل مصروف ثابت' : 'مصروف ثابت جديد',
    sub: 'يتسجل وحده كل شهر في يومه.',
    full: true,
    cls: 'txn-sheet',
    body: () => h('div.txn-top', pad.display, h('div.txn-form',
      field('الاسم', input({ value: st.name, placeholder: 'مثلاً: إيجار، نت، اشتراك', maxlength: 40, onInput: (v) => { st.name = v; err.textContent = ''; } })),
      field('اليوم من كل شهر', days, { hint: 'لو الشهر أقصر (مثلاً 31 في فبراير) يتسجل آخر يوم فيه.' }),
      startBox,
      field('البند', categoryGrid({ kind: 'expense', value: st.cat, onChange: (c) => { st.cat = c; }, onAdd: () => openCategorySheet({ kind: 'expense' }) })),
      r ? h('div.toggle-row', h('div', h('b', 'شغّال'), h('small', 'لو قفلته يوقف التسجيل التلقائي.')), toggle({ checked: st.active, label: 'شغّال', onChange: (v) => { st.active = v; } })) : null,
      err)),
    footer: () => h('div.txn-foot', pad.pad, h('div.sheet-foot-row',
      r ? iconButton('trash-2', { label: 'حذف', variant: 'soft', cls: 'btn-text-neg foot-icon', onClick: () => del() }) : null,
      save)),
    onClose: () => pad.destroy(),
  });
  paintStart();

  function submit() {
    if (!st.name.trim()) { err.textContent = 'اكتب اسم المصروف'; return; }
    if (!st.amount) { err.textContent = 'اكتب المبلغ'; return; }
    const start = r ? r.start : (passed() && !st.thisMonth ? addMonths(monthKey(t), 1) : monthKey(t));
    store.put('rule', { ...(r || {}), name: st.name.trim(), amount: st.amount, cat: st.cat, day: st.day, active: st.active, start });
    haptic(12);
    api.close(true);
    const posted = postDueRecurring();
    toast(posted ? `تم — وتسجّل ${fmtMoney(st.amount)} لهالشهر` : r ? 'تم الحفظ' : `تمام! يتسجل كل شهر يوم ${fmtPlain(st.day)}`, { tone: 'pos' });
  }

  async function del() {
    const ok = await confirm({ title: `تحذف «${r.name}»؟`, body: 'يوقف التسجيل التلقائي. المصاريف اللي تسجّلت قبل تبقى في السجل.', ok: 'حذف', danger: true, icon: 'trash-2' });
    if (!ok) return;
    const snap = { ...r };
    store.remove(r.id);
    api.close();
    toast('تم الحذف', { action: { label: 'تراجع', onClick: () => store.restore(snap) } });
  }
  return api;
}

const EXAMPLES = [
  { name: 'إيجار', cat: 'cat:home', day: 1 },
  { name: 'اشتراك نت', cat: 'cat:phone', day: 5 },
  { name: 'رصيد', cat: 'cat:phone', day: 1 },
];

export default {
  render() {
    const data = store.data();
    const t = today();
    const rules = data.rule.slice().sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || nextRuleDate(a, t).localeCompare(nextRuleDate(b, t)));
    const head = header({ title: 'المصاريف الثابتة', back: true, actions: [iconButton('plus', { label: 'مصروف ثابت جديد', variant: 'accent', onClick: () => openRuleSheet() })] });
    if (!rules.length) {
      return layout(head, h('div.recurring',
        card(empty({ emoji: '🔁', title: 'ما فيش مصاريف ثابتة', body: 'الحاجات اللي تدفعها كل شهر نفس المبلغ — نسجّلها وحدها في يومها وننبّهك.', action: { label: 'أضف واحد', icon: 'plus', onClick: () => openRuleSheet() } })),
        section('أمثلة', h('div.chips', EXAMPLES.map((e) => h('button.chip.tap', { type: 'button', onclick: () => openRuleSheet({ preset: e }) }, category(data, e.cat).emoji, ' ', e.name))))));
    }
    const monthly = sum(rules.filter((r) => r.active !== false), (r) => r.amount);
    const list = h('div.rules', rules.map((r) => {
      const c = category(data, r.cat);
      const next = nextRuleDate(r, t);
      const off = r.active === false;
      const posted = store.exists(`rec:${r.id}:${monthKey(t)}`);
      return h('div.rule', { class: { 'is-off': off } },
        h('button.rule-main.tap', { type: 'button', onclick: () => openRuleSheet({ id: r.id }) },
          h('span.lead.lead-emoji', { style: { '--c': c.color } }, c.emoji),
          h('span.row-main',
            h('span.row-title', r.name),
            h('span.row-sub', off ? 'موقّف' : `يوم ${fmtPlain(r.day)} من كل شهر${posted && next.slice(0, 7) !== monthKey(t) ? ' · هالشهر ✓' : ''}`)),
          h('span.row-end', h('span.row-end-main', moneyEl(r.amount)), h('span.row-end-sub', off ? fmtDate(next) : fmtIn(diffDays(t, next))))),
        toggle({ checked: !off, label: `تشغيل ${r.name}`, onChange: (v) => { store.patch(r.id, { active: v }); if (v) postDueRecurring(); } }));
    }));
    const body = h('div.recurring',
      h('div.rule-sum', icon('repeat', { size: 22 }), h('div', h('small', 'مجموعها كل شهر'), h('b', moneyEl(monthly))), h('span.faint.small', `${fmtPlain(rules.filter((r) => r.active !== false).length)} شغّالة`)),
      list,
      h('p.sal-hint', icon('info', { size: 16 }), 'تتسجل في السجل كمصروف عادي يوم موعدها. لو حذفت واحد تسجّل بالغلط ما يرجعش.'));
    stagger(body);
    return layout(head, body);
  },
};
