// Debts tab: what people owe me, what I owe, per person, with overdue first.

import { h, icon } from '../ui/dom.js';
import { layout, header, iconButton, section, card, segmented, empty, button, avatar, tag, progress, stagger, haptic, actions } from '../ui/kit.js';
import * as store from '../core/store.js';
import { go, rerender } from '../core/router.js';
import { today, fmtMoney, fmtDate, fmtIn, fmtDays, fmtPlain, diffDays } from '../core/util.js';
import { debtsOverview } from '../core/finance.js';
import { openDebtSheet } from './debt-sheets.js';

let filter = 'all'; // all | in | out | settled

function addMenu() {
  actions({
    title: 'دين جديد',
    items: [
      { label: 'سلّفت حد (فلوس ليّ)', icon: 'hand-coins', tone: 'pos', onClick: () => openDebtSheet({ dir: 'in' }) },
      { label: 'استلفت من حد (فلوس عليّ)', icon: 'handshake', tone: 'neg', onClick: () => openDebtSheet({ dir: 'out' }) },
    ],
  });
}

function summary(dv) {
  const net = dv.net;
  return h('div.debts-summary',
    h('button.debts-sum.tone-pos.tap', { type: 'button', onclick: () => { filter = 'in'; haptic(); rerender(); } },
      h('span.debts-sum-ic', icon('hand-coins', { size: 18 })),
      h('small', 'ليك عند الناس'),
      h('b.money', fmtMoney(dv.owedToMe))),
    h('button.debts-sum.tone-neg.tap', { type: 'button', onclick: () => { filter = 'out'; haptic(); rerender(); } },
      h('span.debts-sum-ic', icon('handshake', { size: 18 })),
      h('small', 'عليك للناس'),
      h('b.money', fmtMoney(dv.iOwe))),
    h('div.debts-net', { class: net > 0 ? 'tone-pos' : net < 0 ? 'tone-neg' : 'tone-muted' },
      h('span', net > 0 ? 'الصافي لصالحك' : net < 0 ? 'الصافي عليك' : 'الصافي'),
      h('b.money', fmtMoney(Math.abs(net)))));
}

function personCard(p, t) {
  const open = p.debts.filter((i) => !i.settled);
  const visible = filter === 'in' ? open.filter((i) => i.debt.dir === 'in') : filter === 'out' ? open.filter((i) => i.debt.dir === 'out') : open;
  const total = visible.reduce((a, i) => a + i.debt.amount, 0);
  const paid = visible.reduce((a, i) => a + i.paid, 0);
  const net = filter === 'in' ? p.theyOwe : filter === 'out' ? -p.iOweThem : p.net;
  const nextDue = visible.filter((i) => i.debt.due).map((i) => i.debt.due).sort()[0];
  const overdue = visible.some((i) => i.overdue);
  const dueTag = overdue
    ? tag(`متأخر ${fmtDays(-Math.min(...visible.filter((i) => i.overdue).map((i) => i.dueIn)))}`, 'neg', 'triangle-alert')
    : nextDue ? tag(fmtIn(diffDays(t, nextDue)), diffDays(t, nextDue) <= 2 ? 'warn' : 'info', 'calendar') : null;
  const what = net > 0 ? 'ليك عنده' : net < 0 ? 'عليك له' : 'خالصين';
  return h('button.debts-person.tap.ripple', { type: 'button', class: { 'is-overdue': overdue }, onclick: () => go(`/person/${p.person.id}`) },
    avatar(p.person.name, p.person.color),
    h('span.debts-person-main',
      h('span.debts-person-top', h('b', p.person.name), dueTag),
      h('span.debts-person-sub', `${fmtPlain(visible.length)} ${visible.length === 1 ? 'دين' : 'ديون'} مفتوحة${paid ? ` · سدّد ${Math.round((paid / total) * 100)}%` : ''}`),
      total ? progress((paid / total) * 100, { thin: true, tone: net >= 0 ? 'pos' : 'neg' }) : null),
    h('span.debts-person-end', { class: net > 0 ? 'tone-pos' : net < 0 ? 'tone-neg' : 'tone-muted' },
      h('small', what),
      h('b.money', fmtMoney(Math.abs(net)))));
}

function settledList(dv) {
  const done = dv.infos.filter((i) => i.settled).sort((a, b) => (b.settledOn || b.debt.date).localeCompare(a.settledOn || a.debt.date));
  if (!done.length) return card(empty({ emoji: '🤝', title: 'ما فيش ديون مسدّدة لسه', body: 'لما يخلص أي دين يظهر هنا.' }));
  const people = new Map(store.data().person.map((p) => [p.id, p]));
  return h('div.list.list-inset', done.map((i) => {
    const p = people.get(i.debt.person);
    return h('button.row.tap.ripple', { type: 'button', onclick: () => p && go(`/person/${p.id}`) },
      avatar(p ? p.name : '؟', p && p.color),
      h('span.row-main',
        h('span.row-title', i.debt.dir === 'in' ? `${p ? p.name : '—'} رجّعلك` : `سدّدت لـ${p ? p.name : '—'}`),
        h('span.row-sub', `خلص ${i.settledOn ? fmtDate(i.settledOn, 'relative') : ''}${i.debt.note ? ' · ' + i.debt.note : ''}`)),
      h('span.row-end', h('span.row-end-main', h('span.money.tone-muted', fmtMoney(i.debt.amount))), h('span.row-end-sub', '✓ مسدّد')));
  }));
}

export default {
  render() {
    const data = store.data();
    const t = today();
    const dv = debtsOverview(data, t);
    const head = header({ title: 'الديون', large: true, actions: [iconButton('plus', { label: 'دين جديد', variant: 'accent', onClick: addMenu })] });

    if (!data.debt.length) {
      return layout(head, h('div.debts', card(empty({
        emoji: '🤝',
        title: 'ما فيش ديون',
        body: 'سجّل الفلوس اللي سلّفتها للناس أو اللي استلفتها، ونذكّرك بمواعيدها ونحسبلك الباقي.',
      })), h('div.debts-empty-actions',
        button({ label: 'سلّفت حد', icon: 'hand-coins', variant: 'soft', block: true, onClick: () => openDebtSheet({ dir: 'in' }) }),
        button({ label: 'استلفت من حد', icon: 'handshake', variant: 'ghost', block: true, onClick: () => openDebtSheet({ dir: 'out' }) }))));
    }

    const seg = segmented({
      options: [{ value: 'all', label: 'الكل' }, { value: 'in', label: 'ليك' }, { value: 'out', label: 'عليك' }, { value: 'settled', label: 'المسدّدة' }],
      value: filter,
      onChange: (v) => { filter = v; rerender(); },
    });

    let content;
    if (filter === 'settled') content = settledList(dv);
    else {
      const people = dv.people.filter((p) => p.open > 0 && (filter === 'all' || (filter === 'in' ? p.theyOwe > 0 : p.iOweThem > 0)));
      content = people.length
        ? h('div.debts-people', people.map((p) => personCard(p, t)))
        : card(empty({ emoji: filter === 'in' ? '🙌' : '😌', title: filter === 'in' ? 'ما حد مدينلك' : filter === 'out' ? 'ما عليك شي لحد' : 'كل الديون مسدّدة', body: 'كل شي خالص.' }));
    }

    const overdue = dv.overdue;
    const blocks = h('div.debts',
      summary(dv),
      overdue.length ? h('div.note-box.tone-neg.debts-overdue', icon('triangle-alert', { size: 18 }),
        h('span', overdue.length === 1 ? 'فيه دين فات موعده' : `فيه ${fmtPlain(overdue.length)} ديون فات موعدها`)) : null,
      seg,
      content);
    stagger(blocks);
    return layout(head, blocks);
  },
};
