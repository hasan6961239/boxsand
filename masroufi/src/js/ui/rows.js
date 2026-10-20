// How one activity item (from finance.activity) looks in a list, plus day grouping.
// Shared by Home, History, Person and Salary screens.

import { h } from './dom.js';
import { row, moneyEl, lead } from './kit.js';
import { TXN_TYPES } from '../core/defaults.js';
import { category } from '../core/finance.js';
import { fmtDate, fmtMonth, fmtMoney, sum, groupBy } from '../core/util.js';
import * as store from '../core/store.js';
import { go } from '../core/router.js';
import { openTxnDetail } from '../screens/txn-sheet.js';

/** Visual description of an activity item: { lead, title, sub }. */
export function describe(item) {
  const data = store.data();
  const r = item.rec;
  if (item.kind === 'txn') {
    const meta = TXN_TYPES[r.type] || TXN_TYPES.expense;
    if (r.type === 'expense' || r.type === 'income') {
      const c = category(data, r.cat);
      return { lead: { emoji: c.emoji, color: c.color }, title: r.note && r.rule ? r.note : c.name, sub: r.note && !r.rule ? r.note : r.rule ? 'مصروف ثابت' : null };
    }
    if (r.type === 'advance') return { lead: { icon: meta.icon, tone: 'warn' }, title: meta.label, sub: r.cycle ? `ينخصم من مرتب ${fmtMonth(r.cycle)}${r.note ? ' · ' + r.note : ''}` : r.note };
    if (r.type === 'salary') return { lead: { icon: meta.icon, tone: 'pos' }, title: `مرتب ${fmtMonth(r.cycle || r.date.slice(0, 7))}`, sub: r.ded ? `بعد خصم ${fmtMoney(r.ded)} سحوبات` : 'مرتب المكتب' };
    if (r.type === 'state') return { lead: { icon: meta.icon, tone: 'info' }, title: meta.label, sub: r.month ? `مرتب شهر ${fmtMonth(r.month)}` : r.note };
    if (r.type === 'carry') return { lead: { icon: meta.icon, tone: 'muted' }, title: meta.label, sub: `على مرتب ${fmtMonth(r.cycle)}` };
    return { lead: { icon: meta.icon, tone: 'muted' }, title: meta.label, sub: r.note };
  }
  const name = item.person ? item.person.name : 'شخص';
  if (item.kind === 'debt') {
    return r.dir === 'in'
      ? { lead: { name, color: item.person && item.person.color }, title: `سلّفت ${name}`, sub: r.note || (r.cash ? 'دين ليك' : 'دين ليك (بدون كاش)') }
      : { lead: { name, color: item.person && item.person.color }, title: `استلفت من ${name}`, sub: r.note || (r.cash ? 'دين عليك' : 'دين عليك (بدون كاش)') };
  }
  if (item.kind === 'pay') {
    const mine = item.debt && item.debt.dir === 'in';
    return { lead: { icon: mine ? 'hand-coins' : 'handshake', tone: mine ? 'pos' : 'neg' }, title: mine ? `${name} رجّعلك` : `سدّدت لـ${name}`, sub: r.note || 'سداد دين' };
  }
  if (item.kind === 'gtx') {
    const g = item.goal;
    return { lead: { emoji: (g && g.emoji) || '🎯', color: g && g.color }, title: r.amount >= 0 ? `ادخار: ${g ? g.name : 'هدف'}` : `سحب من: ${g ? g.name : 'هدف'}`, sub: r.note };
  }
  return { lead: { icon: 'circle-help' }, title: '—' };
}

export function activityRow(item, { showDate = false } = {}) {
  const d = describe(item);
  const sub = [d.sub, showDate ? fmtDate(item.date, 'relative') : null].filter(Boolean).join(' · ');
  const tone = item.effect > 0 ? 'pos' : item.effect < 0 ? 'default' : 'muted';
  const amount = item.kind === 'txn' && item.rec.type === 'carry' ? item.rec.amount : item.effect;
  return row({
    lead: d.lead,
    title: d.title,
    sub: sub || null,
    end: moneyEl(amount, { sign: item.effect > 0 ? 'always' : 'auto', tone }),
    onClick: () => open(item),
  });
}

export function open(item) {
  if (item.kind === 'txn') openTxnDetail(item.rec.id);
  else if (item.kind === 'debt' || item.kind === 'pay') {
    const personId = item.kind === 'debt' ? item.rec.person : item.debt && item.debt.person;
    if (personId) go(`/person/${personId}`);
  } else if (item.kind === 'gtx') go(`/goal/${item.rec.goal}`);
}

/** Group items by day: [{ date, items, out, in }] newest first. */
export function byDay(items) {
  const g = groupBy(items, (i) => i.date);
  return [...g.entries()].map(([date, list]) => ({
    date,
    items: list,
    out: sum(list.filter((i) => i.kind === 'txn' && i.rec.type === 'expense'), (i) => i.rec.amount),
    in: sum(list.filter((i) => i.effect > 0), (i) => i.effect),
  }));
}

export function dayHeader(group) {
  return h('div.day-head',
    h('span.day-head-date', fmtDate(group.date, 'relative') === fmtDate(group.date, 'short') ? fmtDate(group.date, 'long') : `${fmtDate(group.date, 'relative')} · ${fmtDate(group.date, 'long')}`),
    group.out ? h('span.day-head-sum', 'صرفت ', moneyEl(group.out)) : null);
}

export { lead };
