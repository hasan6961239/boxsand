// Home: balance, quick actions, office salary countdown, what needs attention,
// budget pace, debts at a glance, state salary and latest activity.

import { h, icon } from '../ui/dom.js';
import { layout, header, iconButton, section, card, moneyEl, countUp, row, list, progress, ring, button, linkAction, empty, stagger, haptic } from '../ui/kit.js';
import { activityRow } from '../ui/rows.js';
import * as store from '../core/store.js';
import * as sync from '../core/sync.js';
import * as auth from '../core/auth.js';
import { go, current, rerender } from '../core/router.js';
import { on } from '../core/bus.js';
import { today, greeting, fmtDate, fmtMonth, fmtMoney, fmtDays, fmtIn, WEEKDAYS, weekday } from '../core/util.js';
import {
  balance, officeStatus, periodOf, periodTotals, budgetStatus, debtsOverview, stateSalaryStats, activity, dailyAllowance, periodLabel,
} from '../core/finance.js';
import { attention } from '../core/reminders.js';
import { openTxnSheet } from './txn-sheet.js';
import { openSalarySheet } from './salary.js';
import { openDebtSheet } from './debt-sheets.js';

let lastBalance = null; // count-up starts from the previously shown value

// the sync indicator in the header follows the sync status
on('sync', () => {
  if (current() && current().path === '/') rerender();
});

function privacy() {
  try { return localStorage.getItem('privacy') === '1'; } catch { return false; }
}
export function setPrivacy(on) {
  try { localStorage.setItem('privacy', on ? '1' : '0'); } catch { /* ignore */ }
  document.documentElement.classList.toggle('privacy', on);
}
setPrivacy(privacy());

function heroCard(data, t) {
  const bal = balance(data);
  const p = periodOf(t, data.settings);
  const tot = periodTotals(data, p);
  const num = h('div.hero-amount.money');
  countUp(num, bal, { from: lastBalance ?? 0, duration: lastBalance === null ? 1100 : 600 });
  lastBalance = bal;
  const eye = iconButton(privacy() ? 'eye-off' : 'eye', {
    label: 'إخفاء المبالغ',
    cls: 'hero-eye',
    onClick: () => {
      const on = !privacy();
      setPrivacy(on);
      eye.replaceChildren(icon(on ? 'eye-off' : 'eye', { size: 20 }));
    },
  });
  return h('div.hero',
    h('div.hero-glow'),
    h('div.hero-top', h('span.hero-label', 'رصيدك الحالي'), eye),
    num,
    h('div.hero-sub', `هالشهر · ${periodLabel(p, t)}`),
    h('div.hero-stats',
      h('button.hero-stat.tap', { type: 'button', onclick: () => go('/reports') },
        h('span.hero-stat-ic.is-out', icon('arrow-up-right', { size: 16 })),
        h('span', h('small', 'صرفت'), h('b.money', fmtMoney(tot.expense)))),
      h('button.hero-stat.tap', { type: 'button', onclick: () => go('/reports') },
        h('span.hero-stat-ic.is-in', icon('arrow-down-left', { size: 16 })),
        h('span', h('small', 'دخلك'), h('b.money', fmtMoney(tot.income))))));
}

function quickActions() {
  const qa = (label, ic, tone, fn) => h('button.qa.tap', { type: 'button', onclick: () => { haptic(); fn(); } },
    h('span.qa-ic', { class: `tone-${tone}` }, icon(ic, { size: 22 })), h('span.qa-label', label));
  return h('div.qa-row',
    qa('مصروف', 'arrow-up-right', 'neg', () => openTxnSheet({ type: 'expense' })),
    qa('سحب درج', 'hand-coins', 'warn', () => openTxnSheet({ type: 'advance' })),
    qa('دخل', 'arrow-down-left', 'pos', () => openTxnSheet({ type: 'income' })),
    qa('دين', 'handshake', 'info', () => openDebtSheet({})));
}

function salaryCard(data, t) {
  const off = officeStatus(data, t);
  if (!off) return null;
  const cycleDays = 30;
  const pct = off.late ? 100 : Math.max(0, Math.min(100, ((cycleDays - off.daysLeft) / cycleDays) * 100));
  const when = off.isToday ? 'اليوم!' : off.late ? `متأخر ${fmtDays(-off.daysLeft)}` : fmtIn(off.daysLeft);
  const ringEl = ring(pct, {
    size: 74, stroke: 8, tone: off.late ? 'warn' : 'accent',
    label: off.isToday ? '🎉' : off.late ? '!' : String(off.daysLeft),
    sub: off.isToday || off.late ? '' : off.daysLeft === 1 ? 'يوم' : off.daysLeft === 2 ? 'يومين' : 'يوم',
  });
  const due = off.isToday || off.late;
  return card([
    h('div.sal-top',
      ringEl,
      h('div.sal-info',
        h('span.sal-kicker', icon('briefcase', { size: 15 }), 'مرتب المكتب'),
        h('b.sal-when', due ? (off.isToday ? 'اليوم يوم المرتب 🎉' : `مرتب ${fmtMonth(off.key)} ${when}`) : `المرتب ${when}`),
        h('span.sal-date', `${WEEKDAYS[weekday(off.payday)]} ${fmtDate(off.payday)}`))),
    h('div.sal-lines',
      h('div', h('span', 'المرتب'), moneyEl(off.gross)),
      off.advTotal ? h('div', h('span', `سحوبات الدرج (${off.deductions.length})`), moneyEl(-off.advTotal, { tone: 'neg' })) : null,
      h('div.sal-net', h('span', 'الصافي المتوقع'), moneyEl(off.expectedNet, { tone: off.expectedNet >= 0 ? 'pos' : 'neg' }))),
    h('div.sal-actions',
      due ? button({ label: 'استلمت المرتب', icon: 'check', variant: 'primary', size: 'md', onClick: (e) => { e.stopPropagation(); openSalarySheet(off.key); } }) : null,
      button({ label: 'سحب من الدرج', icon: 'hand-coins', variant: due ? 'ghost' : 'soft', size: 'md', onClick: (e) => { e.stopPropagation(); openTxnSheet({ type: 'advance' }); } })),
  ], { cls: 'sal-card', onClick: () => go('/salary') });
}

function attentionBlock(data, t) {
  const items = attention(data, t, { exists: store.exists }).slice(0, 3);
  if (!items.length) return null;
  return section('يحتاج انتباهك', list(items.map((it) => row({
    lead: { icon: it.icon, tone: it.tone },
    title: it.title,
    sub: it.body,
    chevron: true,
    onClick: () => { location.hash = it.url; },
  }))), { action: linkAction('الكل', () => go('/notifications')) });
}

function budgetBlock(data, t) {
  const p = periodOf(t, data.settings);
  const b = budgetStatus(data, p, t);
  if (b.total) {
    const pct = b.total.pct;
    return section('الميزانية', card([
      h('div.bud-head',
        h('div', h('small.faint', 'صرفت'), h('b.money', fmtMoney(b.total.spent)), h('small.faint', ` من ${fmtMoney(b.total.limit, { currency: false })}`)),
        h('span.bud-pct', { class: pct >= 100 ? 'tone-neg' : pct >= 80 ? 'tone-warn' : 'tone-accent' }, `${Math.round(pct)}%`)),
      progress(pct),
      h('p.bud-foot', b.total.left >= 0
        ? [icon('wallet', { size: 16 }), ' تقدر تصرف ', h('b.money', fmtMoney(b.daily || 0)), ` في اليوم لـ${fmtDays(b.daysLeft)}`]
        : [icon('triangle-alert', { size: 16 }), ' تجاوزت الميزانية بـ ', h('b.money', fmtMoney(-b.total.left))]),
    ], { onClick: () => go('/budget') }));
  }
  const da = dailyAllowance(data, t);
  if (!da.perDay) return null;
  return section(null, card(h('div.allow',
    h('span.allow-ic', icon('wallet', { size: 22 })),
    h('div.allow-text', h('small.faint', 'لين المرتب الجاي'), h('b', 'تقدر تصرف ', h('span.money', fmtMoney(da.perDay)), ' في اليوم')),
    h('span.allow-link', 'حدد ميزانية', icon('chevron-left', { size: 16 }))), { onClick: () => go('/budget') }));
}

function debtsBlock(data, t) {
  const dv = debtsOverview(data, t);
  if (!dv.open.length) return null;
  const tile = (label, amount, tone, ic, sub) => h('button.debt-tile.tap', { type: 'button', class: `tone-${tone}`, onclick: () => go('/debts') },
    h('span.debt-tile-ic', icon(ic, { size: 18 })),
    h('small', label),
    h('b.money', fmtMoney(amount)),
    sub ? h('span.debt-tile-sub', sub) : null);
  const inCount = dv.open.filter((i) => i.debt.dir === 'in').length;
  const outCount = dv.open.filter((i) => i.debt.dir === 'out').length;
  return section('الديون', h('div.debt-tiles',
    tile('ليك عند الناس', dv.owedToMe, 'pos', 'hand-coins', inCount ? `${inCount} دين` : 'ما فيش'),
    tile('عليك للناس', dv.iOwe, 'neg', 'handshake', outCount ? `${outCount} دين` : 'ما فيش')),
  { action: linkAction('التفاصيل', () => go('/debts')) });
}

function stateBlock(data, t) {
  if (!data.settings.state.on) return null;
  const s = stateSalaryStats(data, t);
  const sub = s.last ? `آخر مرة نزل ${fmtDate(s.last.date, 'relative')}${s.daysSinceLast > 1 ? ` (قبل ${fmtDays(s.daysSinceLast)})` : ''}` : 'ما سجّلتش أي مرتب دولة لسه';
  return section(null, card(h('div.state-row',
    h('span.lead.lead-icon.tone-info', icon('landmark', { size: 20 })),
    h('div.state-text', h('b', 'مرتب الدولة'), h('small.faint', sub)),
    button({ label: 'نزل', icon: 'plus', variant: 'soft', size: 'sm', onClick: () => openTxnSheet({ type: 'state' }) }))));
}

function recentBlock(data) {
  const items = activity(data).slice(0, 6);
  if (!items.length) {
    return section('آخر الحركات', card(empty({
      emoji: '🧾',
      title: 'لسه ما سجّلت شي',
      body: 'سجّل أول مصروف من زر + اللي تحت، وخلي التطبيق يحسبلك كل شي.',
      action: { label: 'سجّل مصروف', icon: 'plus', onClick: () => openTxnSheet({ type: 'expense' }) },
    })));
  }
  return section('آخر الحركات', list(items.map((i) => activityRow(i, { showDate: true }))), { action: linkAction('السجل', () => go('/history')) });
}

function syncDot() {
  const s = sync.getStatus();
  if (!auth.current()) return null;
  const map = { syncing: ['refresh-cw', 'is-spin', 'جاري المزامنة'], offline: ['cloud-off', 'is-off', 'بدون نت — التغييرات محفوظة'], error: ['cloud-off', 'is-err', 'تعذّرت المزامنة'], auth: ['cloud-off', 'is-err', 'سجّل دخول من جديد'] };
  const m = map[s.state] || ['cloud', 'is-ok', 'متزامن'];
  return iconButton(m[0], { label: m[2], cls: `sync-dot ${m[1]}`, size: 20, onClick: () => go('/settings/account') });
}

export default {
  render() {
    const data = store.data();
    const t = today();
    const name = data.settings.name;
    const count = attention(data, t, { exists: store.exists }).length;
    const head = header({
      large: true,
      title: `${greeting()}${name ? '، ' + name : ''} 👋`,
      sub: fmtDate(t, 'long'),
      actions: [
        syncDot(),
        iconButton('bell', { label: 'التنبيهات', badge: count || null, onClick: () => go('/notifications') }),
        iconButton('settings', { label: 'الإعدادات', onClick: () => go('/settings') }),
      ],
    });
    const sal = salaryCard(data, t);
    const blocks = h('div.home',
      heroCard(data, t),
      quickActions(),
      sal ? section(null, sal) : null,
      attentionBlock(data, t),
      budgetBlock(data, t),
      debtsBlock(data, t),
      stateBlock(data, t),
      recentBlock(data));
    stagger(blocks);
    return layout(head, blocks);
  },
};
