// Salaries: the office salary cycle (countdown, drawer withdrawals, expected
// net, past cycles), the irregular state salary, and the sheet that records
// an office salary.

import { h, icon } from '../ui/dom.js';
import { layout, header, section, card, list, row, ring, moneyEl, button, iconButton, sheet, toast, confirm, empty, stagger, field, input, haptic, confetti } from '../ui/kit.js';
import { amountPad } from '../ui/keypad.js';
import { dateChips } from '../ui/pickers.js';
import * as store from '../core/store.js';
import { go, rerender } from '../core/router.js';
import { today, fmtMoney, fmtMonth, fmtDate, fmtDays, fmtIn, fmtPlain, addMonths, diffDays, dayInMonth, sum, WEEKDAYS, weekday } from '../core/util.js';
import { officeStatus, salaryOf, deductionsOf, cycleForDate, stateSalaryStats, payday } from '../core/finance.js';
import { openTxnSheet, openTxnDetail } from './txn-sheet.js';

const expanded = new Set(); // past cycles the user opened

const carryId = (key) => `carry:${key}`;

/* ------------------------------------------------------------ office */

function withdrawalRows(list) {
  return list.map((t) => row({
    lead: { icon: t.type === 'carry' ? 'history' : 'hand-coins', tone: t.type === 'carry' ? 'muted' : 'warn' },
    title: t.type === 'carry' ? 'مرحّل من الشهر اللي قبله' : t.note || 'سحب من الدرج',
    sub: fmtDate(t.date, 'relative'),
    end: moneyEl(-t.amount, { tone: 'neg' }),
    onClick: () => openTxnDetail(t.id),
  }));
}

function currentCycle(data, t) {
  const off = officeStatus(data, t);
  const due = off.isToday || off.late;
  const pct = off.late ? 100 : Math.max(4, Math.min(100, ((30 - off.daysLeft) / 30) * 100));
  const title = off.isToday ? 'اليوم يوم المرتب 🎉' : off.late ? `مرتب ${fmtMonth(off.key)} متأخر ${fmtDays(-off.daysLeft)}` : `مرتب ${fmtMonth(off.key)} ${fmtIn(off.daysLeft)}`;
  return h('div.sal-cur',
    card([
      h('div.sal-cur-top',
        ring(pct, {
          size: 92, stroke: 9, tone: off.late ? 'warn' : 'accent',
          label: off.isToday ? '🎉' : off.late ? '!' : fmtPlain(off.daysLeft),
          sub: off.isToday || off.late ? '' : off.daysLeft === 1 ? 'يوم' : off.daysLeft === 2 ? 'يومين' : 'يوم',
        }),
        h('div.sal-cur-info',
          h('span.sal-kicker', icon('briefcase', { size: 15 }), 'مرتب المكتب'),
          h('b.sal-cur-title', title),
          h('span.sal-date', `${WEEKDAYS[weekday(off.payday)]} ${fmtDate(off.payday)}`))),
      h('div.sal-lines',
        h('div', h('span', 'المرتب'), moneyEl(off.gross)),
        h('div', h('span', off.deductions.length ? `سحوبات الدرج (${fmtPlain(off.deductions.length)})` : 'سحوبات الدرج'), moneyEl(-off.advTotal, { tone: off.advTotal ? 'neg' : 'muted' })),
        h('div.sal-net', h('span', 'الصافي المتوقع'), moneyEl(off.expectedNet, { tone: off.expectedNet >= 0 ? 'pos' : 'neg' }))),
      off.expectedNet < 0 ? h('div.note-box.tone-warn', icon('triangle-alert', { size: 18 }), h('span', `سحبت أكثر من المرتب بـ ${fmtMoney(-off.expectedNet)} — الباقي يترحّل للمرتب اللي بعده.`)) : null,
      h('div.sal-actions',
        button({ label: 'استلمت المرتب', icon: 'check', variant: due ? 'primary' : 'soft', onClick: () => openSalarySheet(off.key) }),
        button({ label: 'سحب من الدرج', icon: 'hand-coins', variant: due ? 'ghost' : 'primary', onClick: () => openTxnSheet({ type: 'advance' }) })),
    ], { cls: 'sal-cur-card' }),
    off.deductions.length
      ? section(`سحوبات مرتب ${fmtMonth(off.key)}`, list(withdrawalRows(off.deductions)))
      : section(null, h('p.sal-hint', icon('info', { size: 16 }), 'لما تسحب من الدرج سجّله من زر «سحب من الدرج»، ويتخصم وحده من المرتب.')));
}

function pastCycles(data) {
  const salaries = data.txn.filter((x) => x.type === 'salary').sort((a, b) => (a.cycle < b.cycle ? 1 : -1));
  if (!salaries.length) return section('المرتبات اللي استلمتها', card(empty({ emoji: '💼', title: 'لسه ما سجّلت مرتب', body: 'لما تستلم مرتبك اضغط «استلمت المرتب» ويتحسب الصافي بعد خصم سحوبات الدرج.' })));
  return section('المرتبات اللي استلمتها', list(salaries.map((s) => {
    const open = expanded.has(s.id);
    const ded = deductionsOf(data, s.cycle).sort((a, b) => (a.date < b.date ? -1 : 1));
    const head = h('button.sal-past-head.tap', {
      type: 'button',
      'aria-expanded': String(open),
      onclick: () => {
        open ? expanded.delete(s.id) : expanded.add(s.id);
        haptic(4);
        rerender();
      },
    },
    h('span.lead.lead-icon.tone-pos', icon('briefcase', { size: 20 })),
    h('span.row-main', h('span.row-title', `مرتب ${fmtMonth(s.cycle)}`), h('span.row-sub', `استلمته ${fmtDate(s.date, 'relative')}${s.ded ? ` · خصم ${fmtMoney(s.ded)}` : ''}`)),
    h('span.row-end', h('span.row-end-main', moneyEl(s.amount, { tone: 'pos' })), s.gross && s.gross !== s.amount ? h('span.row-end-sub', `من ${fmtMoney(s.gross, { currency: false })}`) : null),
    icon(open ? 'chevron-up' : 'chevron-down', { size: 18, cls: 'row-chev' }));
    return h('div.sal-past', { class: { 'is-open': open } },
      head,
      open ? h('div.sal-past-body',
        h('div.sal-lines',
          h('div', h('span', 'المرتب'), moneyEl(s.gross || s.amount)),
          ...ded.map((d) => h('div', h('span', `${d.type === 'carry' ? 'مرحّل' : 'سحب'} · ${fmtDate(d.date)}`), moneyEl(-d.amount, { tone: 'neg' }))),
          h('div.sal-net', h('span', 'استلمت'), moneyEl(s.amount, { tone: 'pos' }))),
        h('div.sal-past-actions', button({ label: 'تعديل', icon: 'pencil', variant: 'soft', size: 'sm', onClick: () => openSalarySheet(s.cycle, { id: s.id }) }))) : null);
  })));
}

function officeStats(data, t) {
  const year = t.slice(0, 4);
  const adv = data.txn.filter((x) => x.type === 'advance' && x.date.startsWith(year));
  const sal = data.txn.filter((x) => x.type === 'salary' && x.date.startsWith(year));
  const months = new Set(adv.map((x) => x.cycle)).size || 1;
  return h('div.kpis.sal-kpis',
    h('div.kpi', h('small', `سحوبات الدرج ${fmtPlain(year)}`), h('b.money', fmtMoney(sum(adv, (x) => x.amount)))),
    h('div.kpi', h('small', 'متوسط السحب في الشهر'), h('b.money', fmtMoney(Math.round(sum(adv, (x) => x.amount) / months)))),
    h('div.kpi', h('small', 'مرتبات استلمتها هالسنة'), h('b', fmtPlain(sal.length))),
    h('div.kpi', h('small', 'مجموعها'), h('b.money', fmtMoney(sum(sal, (x) => x.amount)))));
}

/* ------------------------------------------------------------- state */

function stateSection(data, t) {
  const st = stateSalaryStats(data, t);
  const gaps = [];
  const asc = st.list.slice().reverse();
  for (let i = 1; i < asc.length; i++) gaps.push(diffDays(asc[i - 1].date, asc[i].date));
  const avgGap = gaps.length ? Math.round(sum(gaps) / gaps.length) : null;
  const add = button({ label: 'نزل مرتب الدولة', icon: 'plus', variant: 'soft', block: true, onClick: () => openTxnSheet({ type: 'state' }) });
  const summary = card([
    h('div.state-head',
      h('span.lead.lead-icon.tone-info', icon('landmark', { size: 22 })),
      h('div.state-head-text',
        h('b', 'مرتب الدولة'),
        h('small.faint', st.last ? `آخر مرة نزل ${fmtDate(st.last.date, 'relative')}${st.daysSinceLast > 1 ? ` · قبل ${fmtDays(st.daysSinceLast)}` : ''}` : 'ينزل في أيام مختلفة — سجّله لما يوصل'))),
    h('div.state-stats',
      h('div', h('small', `هالسنة (${fmtPlain(st.list.filter((x) => x.date.startsWith(t.slice(0, 4))).length)})`), h('b.money', fmtMoney(st.yearTotal))),
      h('div', h('small', 'المبلغ المعتاد'), h('b.money', fmtMoney(data.settings.state.amount))),
      h('div', h('small', 'بين كل مرة والثانية'), h('b', avgGap ? `~${fmtDays(avgGap)}` : '—'))),
    add,
  ], { cls: 'state-card' });
  const items = st.list.slice(0, 12).map((x) => {
    // how long after the end of its month it arrived (e.g. June's salary on 18 July)
    const late = x.month ? diffDays(dayInMonth(x.month, 31), x.date) : 0;
    return row({
    lead: { icon: 'landmark', tone: 'info' },
    title: x.month ? `مرتب ${fmtMonth(x.month)}` : 'مرتب الدولة',
    sub: `نزل ${fmtDate(x.date, 'relative')}${late > 0 ? ` · بعد نهاية الشهر بـ${fmtDays(late)}` : ''}`,
    end: moneyEl(x.amount, { tone: 'pos', sign: 'always' }),
    onClick: () => openTxnDetail(x.id),
    });
  });
  return section('مرتب الدولة', h('div.stack', summary, items.length ? list(items) : null));
}

/* ------------------------------------------------------------ screen */

export default {
  render() {
    const data = store.data();
    const t = today();
    const head = header({
      title: 'المرتبات',
      back: true,
      actions: [iconButton('settings', { label: 'إعدادات المرتبات', onClick: () => go('/settings/income') })],
    });
    const blocks = [];
    if (data.settings.office.on) {
      blocks.push(currentCycle(data, t), section('هالسنة', officeStats(data, t)), pastCycles(data));
    } else {
      blocks.push(section(null, card(empty({ icon: 'briefcase', title: 'مرتب المكتب مقفول', body: 'فعّله من الإعدادات عشان تتابع موعده وسحوبات الدرج.', action: { label: 'الإعدادات', icon: 'settings', onClick: () => go('/settings/income') } }))));
    }
    if (data.settings.state.on) blocks.push(stateSection(data, t));
    const body = h('div.salary', blocks);
    stagger(body);
    return layout(head, body);
  },
};

/* ------------------------------------------------------- record sheet */

/**
 * Record (or edit) the office salary of `cycleKey`. Net = gross − drawer
 * withdrawals of that cycle; anything withdrawn beyond the gross is carried
 * to the next cycle as a 'carry' record.
 */
export function openSalarySheet(cycleKey, { id } = {}) {
  const data = store.data();
  const t = today();
  const o = data.settings.office;
  let existing = id ? store.get(id) : null;
  let key = (existing && existing.cycle) || cycleKey || (officeStatus(data, t) || {}).key || cycleForDate(t, o.day);
  if (!existing) existing = salaryOf(data, key);

  const st = {
    gross: existing ? existing.gross || existing.amount + (existing.ded || 0) : o.amount,
    date: existing ? existing.date : t,
    note: existing ? existing.note || '' : '',
  };
  const ded = deductionsOf(data, key).sort((a, b) => (a.date < b.date ? -1 : 1));
  const dedTotal = sum(ded, (x) => x.amount);

  const netEl = h('div.salsheet-net-num');
  const grossEl = h('span');
  const carryBox = h('div');
  const paint = () => {
    const net = Math.max(0, st.gross - dedTotal);
    const carry = Math.max(0, dedTotal - st.gross);
    netEl.replaceChildren(moneyEl(net));
    grossEl.replaceChildren(moneyEl(st.gross));
    carryBox.replaceChildren(carry ? h('div.note-box.tone-warn', icon('triangle-alert', { size: 18 }), h('span', `السحوبات أكثر من المرتب بـ ${fmtMoney(carry)}، تترحّل وتنخصم من مرتب ${fmtMonth(addMonths(key, 1))}.`)) : '');
  };

  const editGross = () => {
    let val = st.gross;
    const pad = amountPad({ value: val, tone: 'pos', quick: [], autofocus: true, onChange: (m) => { val = m; } });
    sheet({
      title: 'مبلغ المرتب',
      sub: 'لو فيه زيادة أو خصم أو مكافأة هالشهر عدّل المبلغ قبل الخصم.',
      body: () => h('div.stack', pad.display, pad.pad),
      footer: (a) => button({ label: 'تمام', size: 'lg', block: true, onClick: () => { if (val) { st.gross = val; paint(); } a.close(); } }),
      onClose: () => pad.destroy(),
    });
  };

  const api = sheet({
    title: existing ? `مرتب ${fmtMonth(key)}` : `استلام مرتب ${fmtMonth(key)}`,
    sub: `موعده ${fmtDate(payday(key, o.day), 'long')}`,
    cls: 'salsheet',
    body: () => h('div.salsheet-body',
      h('div.salsheet-hero', h('small', 'الصافي اللي تستلمه'), netEl),
      h('div.sal-lines',
        h('div', h('span', 'المرتب قبل الخصم'), h('span.salsheet-gross', grossEl, h('button.link-btn.tap', { type: 'button', onclick: editGross }, 'تعديل'))),
        ...ded.map((d) => h('div', h('span', `${d.type === 'carry' ? 'مرحّل من قبل' : d.note || 'سحب من الدرج'} · ${fmtDate(d.date)}`), moneyEl(-d.amount, { tone: 'neg' }))),
        ded.length ? h('div.sal-sub', h('span', 'مجموع السحوبات'), moneyEl(-dedTotal, { tone: 'neg' })) : h('div', h('span.faint', 'ما فيش سحوبات من الدرج على هالمرتب'))),
      carryBox,
      field('تاريخ الاستلام', dateChips({ value: st.date, onChange: (d) => { st.date = d; } })),
      field('ملاحظة', input({ value: st.note, placeholder: 'اختياري — مثلاً: فيه مكافأة', maxlength: 120, onInput: (v) => { st.note = v; } }))),
    footer: (a) => h('div.salsheet-foot',
      existing ? iconButton('trash-2', { label: 'حذف', variant: 'soft', cls: 'btn-text-neg', onClick: () => del(a) }) : null,
      button({ label: existing ? 'حفظ التعديل' : 'استلمته ✓', size: 'lg', block: true, onClick: () => save(a) })),
  });
  paint();

  function save(a) {
    const net = Math.max(0, st.gross - dedTotal);
    const carry = Math.max(0, dedTotal - st.gross);
    store.batch(() => {
      store.put('txn', { ...(existing || {}), type: 'salary', amount: net, gross: st.gross, ded: dedTotal, cycle: key, date: st.date, note: st.note.trim() || undefined });
      if (carry) store.put('txn', { id: carryId(key), type: 'carry', amount: carry, cycle: addMonths(key, 1), date: st.date });
      else if (store.get(carryId(key))) store.remove(carryId(key));
    });
    haptic(14);
    a.close(true);
    if (!existing) {
      confetti();
      toast(`مبروك! استلمت ${fmtMoney(net)} 🎉`, { tone: 'pos' });
    } else toast('تم حفظ التعديل', { tone: 'pos' });
  }

  async function del(a) {
    const ok = await confirm({ title: `تحذف مرتب ${fmtMonth(key)}؟`, body: 'يرجع المرتب لحالة «ما استلمته» وتبقى سحوبات الدرج مسجّلة عليه.', ok: 'حذف', danger: true, icon: 'trash-2' });
    if (!ok) return;
    const snap = [store.get(existing.id), store.get(carryId(key))].filter(Boolean).map((r) => ({ ...r }));
    store.batch(() => snap.forEach((r) => store.remove(r.id)));
    a.close();
    toast('تم حذف المرتب', { action: { label: 'تراجع', onClick: () => store.batch(() => snap.forEach((r) => store.restore(r))) } });
  }

  return api;
}

