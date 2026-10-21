// One person's page: where we stand, open debts with payments and reminders,
// settled debts, and the full statement with a running balance.

import { h, icon } from '../ui/dom.js';
import { layout, header, iconButton, section, card, list, row, avatar, tag, progress, moneyEl, button, empty, stagger, actions, haptic, sheet } from '../ui/kit.js';
import * as store from '../core/store.js';
import { go, rerender } from '../core/router.js';
import { today, fmtMoney, fmtDate, fmtIn, fmtDays, fmtPlain } from '../core/util.js';
import { personLedger } from '../core/finance.js';
import { openDebtSheet, openPaySheet, openPersonSheet, deleteDebt, reminderText, whatsapp, call } from './debt-sheets.js';

let showSettled = false;

function standing(person, net) {
  const name = person.name;
  if (net > 0) return { tone: 'pos', title: `${name} مدينلك`, amount: net };
  if (net < 0) return { tone: 'neg', title: `إنت مدين لـ${name}`, amount: -net };
  return { tone: 'muted', title: 'خالصين ✓', amount: 0 };
}

function debtCard(info, person, t) {
  const d = info.debt;
  const mine = d.dir === 'in';
  const dueTag = info.overdue
    ? tag(`متأخر ${fmtDays(-info.dueIn)}`, 'neg', 'triangle-alert')
    : d.due ? tag(`الموعد ${fmtIn(info.dueIn)}`, info.dueIn <= 2 ? 'warn' : 'info', 'calendar') : null;
  const more = () => actions({
    title: d.note || (mine ? 'دين ليك' : 'دين عليك'),
    items: [
      { label: 'تعديل الدين', icon: 'pencil', onClick: () => openDebtSheet({ id: d.id }) },
      info.pays.length ? { label: 'الدفعات', icon: 'list-checks', onClick: () => paysSheet(info) } : null,
      { label: 'حذف الدين', icon: 'trash-2', tone: 'neg', onClick: () => deleteDebt(d) },
    ],
  });
  return card([
    h('div.pdebt-top',
      h('span.pdebt-kind', { class: mine ? 'tone-pos' : 'tone-neg' }, icon(mine ? 'hand-coins' : 'handshake', { size: 16 }), mine ? 'ليك' : 'عليك'),
      dueTag,
      h('span.spacer'),
      iconButton('ellipsis', { label: 'خيارات', size: 20, onClick: more })),
    h('div.pdebt-amounts',
      h('div', h('small', 'الباقي'), h('b.money', { class: mine ? 'tone-pos' : 'tone-neg' }, fmtMoney(info.remaining))),
      h('div.pdebt-of', h('small', 'من أصل'), h('span.money', fmtMoney(d.amount)))),
    progress(info.progress * 100, { tone: mine ? 'pos' : 'neg' }),
    h('p.pdebt-meta', `${fmtDate(d.date, 'relative')}${d.note ? ' · ' + d.note : ''}${info.paid ? ` · سدّد ${fmtMoney(info.paid)} على ${fmtPlain(info.pays.length)} ${info.pays.length === 1 ? 'دفعة' : 'دفعات'}` : ''}${d.cash ? '' : ' · بدون كاش'}`),
    h('div.pdebt-actions',
      button({ label: mine ? 'رجّعلي' : 'سدّدت', icon: 'check', variant: 'soft', size: 'sm', onClick: () => openPaySheet(d.id) }),
      mine ? button({ label: 'ذكّره بواتساب', icon: 'message-circle', variant: 'ghost', size: 'sm', cls: 'pdebt-wa', onClick: () => whatsapp(person, reminderText(info, person, t)) }) : null),
  ], { cls: `pdebt ${info.overdue ? 'is-overdue' : ''}` });
}

function paysSheet(info) {
  sheet({
    title: 'الدفعات',
    sub: `سدّد ${fmtMoney(info.paid)} من ${fmtMoney(info.debt.amount)}`,
    body: (a) => list(info.pays.slice().reverse().map((p) => row({
      lead: { icon: 'check', tone: 'pos' },
      title: fmtMoney(p.amount),
      sub: `${fmtDate(p.date, 'relative')}${p.note ? ' · ' + p.note : ''}`,
      chevron: true,
      onClick: () => { a.close(); setTimeout(() => openPaySheet(info.debt.id, { id: p.id }), 150); },
    }))),
  });
}

function statement(ledger) {
  if (!ledger.rows.length) return null;
  const rows = ledger.rows.slice().reverse().map((r) => {
    const isDebt = r.kind === 'debt';
    const mine = (isDebt ? r.rec.dir : r.debt.dir) === 'in';
    const title = isDebt ? (mine ? 'سلّفته' : 'استلفت منه') : mine ? 'رجّعلك' : 'سدّدتله';
    return row({
      lead: { icon: isDebt ? (mine ? 'arrow-up-right' : 'arrow-down-left') : 'check', tone: isDebt ? 'muted' : mine ? 'pos' : 'neg' },
      title,
      sub: `${fmtDate(r.date, 'relative')}${r.rec.note ? ' · ' + r.rec.note : ''}`,
      // shown as cash movement (money out when lending, in when repaid); the running claim sits below
      end: moneyEl(-r.delta, { sign: 'always', tone: -r.delta > 0 ? 'pos' : 'default' }),
      endSub: r.running === 0 ? 'خالصين' : r.running > 0 ? `ليك ${fmtMoney(r.running, { currency: false })}` : `عليك ${fmtMoney(-r.running, { currency: false })}`,
      onClick: () => (isDebt ? openDebtSheet({ id: r.rec.id }) : openPaySheet(r.debt.id, { id: r.rec.id })),
    });
  });
  return section('كشف الحساب', list(rows));
}

export default {
  render({ id }) {
    const person = store.get(id);
    if (!person) {
      return layout(header({ title: 'الشخص', back: true, onBack: () => go('/debts', { replace: true }) }),
        card(empty({ emoji: '🤷', title: 'الشخص هذا مش موجود', body: 'يمكن انحذف من جهاز ثاني.', action: { label: 'للديون', onClick: () => go('/debts', { replace: true }) } })));
    }
    const t = today();
    const ledger = personLedger(store.data(), id, t);
    const st = standing(person, ledger.net);
    const open = ledger.infos.filter((i) => !i.settled).sort((a, b) => (a.overdue === b.overdue ? (a.debt.due || '9').localeCompare(b.debt.due || '9') : a.overdue ? -1 : 1));
    const settled = ledger.infos.filter((i) => i.settled);
    const oweMe = open.filter((i) => i.debt.dir === 'in');

    const head = header({
      title: person.name,
      back: true,
      onBack: () => history.state && history.state.n > 0 ? history.back() : go('/debts', { replace: true }),
      actions: [iconButton('pencil', { label: 'تعديل', onClick: () => openPersonSheet({ id }) })],
    });

    const hero = h('div.person-hero', { class: `tone-${st.tone}` },
      h('div.person-hero-avatar', avatar(person.name, person.color)),
      h('small', st.title),
      h('b.money', st.amount ? fmtMoney(st.amount) : '—'),
      h('div.person-hero-actions',
        h('button.person-act.tap', { type: 'button', onclick: () => { haptic(); call(person); } }, h('span', icon('phone', { size: 20 })), 'اتصال'),
        h('button.person-act.tap', {
          type: 'button',
          onclick: () => { haptic(); whatsapp(person, oweMe.length ? reminderText(oweMe[0], person, t) : `السلام عليكم ${person.name} 🌷`); },
        }, h('span', icon('message-circle', { size: 20 })), 'واتساب'),
        h('button.person-act.tap', { type: 'button', onclick: () => { haptic(); openDebtSheet({ person: id, dir: 'in' }); } }, h('span', icon('hand-coins', { size: 20 })), 'سلّفته'),
        h('button.person-act.tap', { type: 'button', onclick: () => { haptic(); openDebtSheet({ person: id, dir: 'out' }); } }, h('span', icon('handshake', { size: 20 })), 'استلفت')));

    const blocks = h('div.person',
      hero,
      open.length
        ? section('الديون المفتوحة', h('div.stack', open.map((i) => debtCard(i, person, t))))
        : section(null, card(empty({ emoji: '✨', title: 'ما فيش ديون مفتوحة', body: `كل شي خالص مع ${person.name}.` }))),
      settled.length ? section(null, h('button.person-settled-toggle.tap', {
        type: 'button',
        onclick: () => { showSettled = !showSettled; rerender(); },
      }, icon(showSettled ? 'chevron-up' : 'chevron-down', { size: 18 }), `الديون المسدّدة (${fmtPlain(settled.length)})`)) : null,
      showSettled && settled.length ? list(settled.map((i) => row({
        lead: { icon: 'circle-check', tone: 'muted' },
        title: `${i.debt.dir === 'in' ? 'سلّفته' : 'استلفت منه'} ${fmtMoney(i.debt.amount)}`,
        sub: `${fmtDate(i.debt.date)} ← خلص ${i.settledOn ? fmtDate(i.settledOn, 'relative') : ''}`,
        chevron: true,
        onClick: () => openDebtSheet({ id: i.debt.id }),
      }))) : null,
      statement(ledger));
    stagger(blocks);
    return layout(head, blocks);
  },
};
