// Budget: a monthly limit plus optional limits per category, with how much
// is left per day until the month (salary period) ends.

import { h, icon } from '../ui/dom.js';
import { layout, header, section, card, ring, progress, moneyEl, button, iconButton, empty, sheet, chips, toast, stagger, haptic } from '../ui/kit.js';
import { amountPad } from '../ui/keypad.js';
import { categoryGrid } from '../ui/pickers.js';
import * as store from '../core/store.js';
import { go } from '../core/router.js';
import { today, fmtMoney, fmtDays, fmtPlain, MILLI } from '../core/util.js';
import { periodOf, shiftPeriod, periodLabel, budgetStatus, spendByCategory, category } from '../core/finance.js';

const budgetId = (cat) => (cat ? `budget:cat:${cat}` : 'budget:total');

/** Average spend of the last 3 complete periods for a scope (total or one category). */
function averageSpend(cat) {
  const data = store.data();
  const p = periodOf(today(), data.settings);
  let total = 0;
  for (let i = 1; i <= 3; i++) {
    const s = spendByCategory(data, shiftPeriod(p, -i, data.settings));
    total += cat ? (s.list.find((e) => e.cat.id === cat) || { amount: 0 }).amount : s.total;
  }
  return Math.round(total / 3);
}

/** Round up to a "nice" budget number: 5, 10, 50, 100 … dinars. */
function nice(m) {
  const d = m / MILLI;
  const step = d < 50 ? 5 : d < 200 ? 10 : d < 1000 ? 50 : 100;
  return Math.ceil(d / step) * step * MILLI;
}

export function openBudgetSheet({ cat } = {}) {
  const id = budgetId(cat);
  const existing = store.get(id);
  const c = cat ? category(store.data(), cat) : null;
  let value = existing ? existing.amount : 0;
  const avg = averageSpend(cat);
  const save = button({ label: existing ? 'حفظ' : 'حدّد الميزانية', size: 'lg', block: true, onClick: () => submit() });
  save.disabled = !value;
  const pad = amountPad({ value, tone: 'accent', quick: [], onChange: (m) => { value = m; save.disabled = !m; } });
  const suggestions = [...new Set([nice(avg), nice(avg * 0.9), nice(avg * 1.1)].filter((x) => x > 0))].sort((a, b) => a - b);

  const api = sheet({
    title: c ? `ميزانية ${c.emoji} ${c.name}` : 'الميزانية الشهرية',
    sub: c ? 'أقصى مبلغ تصرفه على هالبند في الشهر.' : 'أقصى مبلغ تصرفه على كل المصاريف في الشهر.',
    full: true,
    cls: 'txn-sheet',
    body: () => h('div.txn-top',
      pad.display,
      avg ? h('div.bud-suggest',
        h('p.faint.small', `متوسط صرفك آخر ${fmtPlain(3)} شهور: ${fmtMoney(avg)}`),
        chips({ options: suggestions.map((v) => ({ value: v, label: fmtMoney(v) })), value: null, onChange: (v) => pad.set(v) })) : h('p.faint.small.center', 'ما عندناش صرف سابق نقترح منه — حط رقم يريحك.')),
    footer: () => h('div.txn-foot', pad.pad, h('div.sheet-foot-row',
      existing ? iconButton('trash-2', { label: 'شيل الحد', variant: 'soft', cls: 'btn-text-neg foot-icon', onClick: () => { store.remove(id); api.close(); toast('تم شيل الحد'); } }) : null,
      save)),
    onClose: () => pad.destroy(),
  });

  function submit() {
    if (!value) return;
    store.put('budget', { id, cat: cat || undefined, amount: value });
    haptic(12);
    api.close(true);
    toast(existing ? 'تم تعديل الميزانية' : 'تم تحديد الميزانية 🎯', { tone: 'pos' });
  }
  return api;
}

function pickCategoryThenBudget() {
  sheet({
    title: 'حد لبند',
    sub: 'اختار البند اللي تبي تحدّد صرفه.',
    body: (a) => categoryGrid({
      kind: 'expense',
      value: null,
      onChange: (catId) => {
        a.close();
        setTimeout(() => openBudgetSheet({ cat: catId }), 150);
      },
    }),
  });
}

function totalCard(b, p, t) {
  const tot = b.total;
  const over = tot.left < 0;
  const pct = tot.pct;
  return card([
    h('div.bud-total',
      ring(pct, {
        size: 112, stroke: 11,
        tone: pct >= 100 ? 'neg' : pct >= 80 ? 'warn' : 'accent',
        label: `${fmtPlain(Math.round(pct))}%`,
        sub: 'مصروف',
      }),
      h('div.bud-total-info',
        h('small', over ? 'تجاوزت بـ' : 'باقيلك'),
        h('b.money', { class: over ? 'tone-neg' : '' }, fmtMoney(Math.abs(tot.left))),
        h('span.faint.small', `صرفت ${fmtMoney(tot.spent)} من ${fmtMoney(tot.limit)}`))),
    h('div.bud-daily', { class: over ? 'tone-neg' : 'tone-accent' },
      icon(over ? 'triangle-alert' : 'wallet', { size: 18 }),
      over
        ? h('span', 'تجاوزت الميزانية — حاول تخفف لين آخر الشهر')
        : b.daysLeft
          ? h('span', 'تقدر تصرف ', h('b.money', fmtMoney(b.daily || 0)), ` في اليوم لـ${fmtDays(b.daysLeft)}`)
          : h('span', 'خلص الشهر')),
    h('div.bud-actions', button({ label: 'تعديل', icon: 'pencil', variant: 'soft', size: 'sm', onClick: () => openBudgetSheet() })),
  ], { cls: 'bud-total-card' });
}

function catRows(b) {
  return h('div.bud-cats', b.cats.map((c) => h('button.bud-cat.tap.ripple', { type: 'button', onclick: () => openBudgetSheet({ cat: c.cat.id }) },
    h('span.lead.lead-emoji', { style: { '--c': c.cat.color } }, c.cat.emoji),
    h('span.bud-cat-main',
      h('span.bud-cat-top', h('b', c.cat.name), h('span.bud-cat-pct', { class: c.pct >= 100 ? 'tone-neg' : c.pct >= 80 ? 'tone-warn' : '' }, `${fmtPlain(Math.round(c.pct))}%`)),
      progress(c.pct),
      h('span.bud-cat-sub', c.left >= 0 ? `باقي ${fmtMoney(c.left)} من ${fmtMoney(c.limit)}` : `تجاوزت بـ ${fmtMoney(-c.left)} (الحد ${fmtMoney(c.limit)})`)))));
}

export default {
  render() {
    const data = store.data();
    const t = today();
    const p = periodOf(t, data.settings);
    const b = budgetStatus(data, p, t);
    const head = header({ title: 'الميزانية', back: true, sub: null });

    const periodNote = h('button.bud-period.tap', { type: 'button', onclick: () => go('/settings/income') },
      icon('calendar-days', { size: 16 }),
      h('span', `${periodLabel(p, t)} · باقي ${fmtDays(b.daysLeft)}`),
      icon('chevron-left', { size: 14 }));

    const blocks = [periodNote];
    if (!b.total && !b.cats.length) {
      blocks.push(card(empty({
        emoji: '🎯',
        title: 'حدّد ميزانيتك',
        body: 'حط حد لصرفك في الشهر، ونقولك كم تقدر تصرف كل يوم لين المرتب، وننبّهك لما توصل 80% و100%.',
        action: { label: 'حدّد الميزانية', icon: 'target', onClick: () => openBudgetSheet() },
      })), button({ label: 'أو حد لبند معيّن', icon: 'tags', variant: 'plain', block: true, onClick: pickCategoryThenBudget }));
    } else {
      blocks.push(b.total ? totalCard(b, p, t) : card(h('div.bud-nototal',
        h('span', 'ما حدّدتش ميزانية لكل الشهر'),
        button({ label: 'حدّد', variant: 'soft', size: 'sm', onClick: () => openBudgetSheet() }))));
      blocks.push(section('حدود البنود', b.cats.length ? catRows(b) : card(h('p.faint.small.center', 'ما فيش حدود لبنود معيّنة.')), {
        action: h('button.link-btn.tap', { type: 'button', onclick: pickCategoryThenBudget }, icon('plus', { size: 16 }), 'حد لبند'),
      }));
    }
    const body = h('div.budget', blocks);
    stagger(body);
    return layout(head, body);
  },
};
