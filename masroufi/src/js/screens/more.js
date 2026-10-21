// More tab: net worth at a glance and a grid into every other section.

import { h, icon } from '../ui/dom.js';
import { layout, header, moneyEl, stagger, haptic, row, list } from '../ui/kit.js';
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import * as sync from '../core/sync.js';
import { go } from '../core/router.js';
import { today, fmtMoney, fmtPlain, fmtIn, sum } from '../core/util.js';
import { netWorth, periodOf, periodTotals, budgetStatus, officeStatus, goalsOverview } from '../core/finance.js';

function tiles(data, t) {
  const p = periodOf(t, data.settings);
  const tot = periodTotals(data, p);
  const b = budgetStatus(data, p, t);
  const off = officeStatus(data, t);
  const goals = goalsOverview(data, t);
  const fixed = sum(data.rule.filter((r) => r.active !== false), (r) => r.amount);
  const tile = (path, ic, color, title, stat) => h('button.more-tile.tap.ripple', { type: 'button', style: { '--c': color }, onclick: () => { haptic(); go(path); } },
    h('span.more-tile-ic', icon(ic, { size: 22 })),
    h('b', title),
    h('small', stat));
  const aiTile = tile('/assistant', 'sparkles', '#10B981', 'المساعد', 'اكتب أو تكلّم، ويسجّلها عليك');
  aiTile.classList.add('is-wide');
  return h('div.more-grid',
    aiTile,
    tile('/reports', 'chart-pie', '#8B5CF6', 'التقارير', `صرفت ${fmtMoney(tot.expense)}`),
    tile('/budget', 'target', '#F97316', 'الميزانية', b.total ? `استعملت ${fmtPlain(Math.round(b.total.pct))}%` : 'حدّد ميزانية'),
    tile('/salary', 'briefcase', '#10B981', 'المرتبات', off ? (off.isToday ? 'اليوم! 🎉' : off.late ? 'المرتب متأخر' : `المرتب ${fmtIn(off.daysLeft)}`) : 'مرتب الدولة'),
    tile('/goals', 'piggy-bank', '#0EA5E9', 'الادخار', goals.saved ? `مدخر ${fmtMoney(goals.saved)}` : 'ابدأ هدف'),
    tile('/recurring', 'repeat', '#EC4899', 'المصاريف الثابتة', fixed ? `${fmtMoney(fixed)} شهرياً` : 'إيجار، نت…'),
    tile('/categories', 'tags', '#F59E0B', 'البنود', `${fmtPlain(data.cat.filter((c) => !c.archived).length)} بند`));
}

function worthCard(data, t) {
  const w = netWorth(data, t);
  const part = (label, m, tone) => h('div', h('small', label), moneyEl(m, { tone }));
  return h('div.worth',
    h('div.worth-top', h('small', 'صافي اللي تملكه'), h('b.money', fmtMoney(w.total))),
    h('div.worth-parts',
      part('الرصيد', w.balance, 'none'),
      part('المدخر', w.saved, 'none'),
      part('ليك عند الناس', w.owedToMe, 'pos'),
      part('عليك', -w.iOwe, w.iOwe ? 'neg' : 'none')),
    h('p.worth-note', 'الرصيد + المدخر + الديون اللي ليك − الديون اللي عليك'));
}

function accountRow() {
  const u = auth.current();
  const s = sync.getStatus();
  const sub = !u
    ? auth.isAvailable() === false ? 'الحسابات مش مفعّلة في الموقع لسه' : 'سجّل دخول عشان تزامن بين أجهزتك'
    : s.state === 'syncing' ? 'جاري المزامنة…' : s.state === 'offline' ? 'بدون نت — التغييرات محفوظة على الجهاز' : s.state === 'error' || s.state === 'auth' ? s.error || 'تعذّرت المزامنة' : 'متزامن ✓';
  return list([
    row({ lead: { icon: u ? 'cloud' : 'user', tone: u ? 'pos' : 'muted' }, title: u ? u.email : 'الحساب والمزامنة', sub, chevron: true, onClick: () => go('/settings/account') }),
    row({ lead: { icon: 'bell', tone: 'info' }, title: 'التنبيهات', chevron: true, onClick: () => go('/notifications') }),
    row({ lead: { icon: 'settings', tone: 'muted' }, title: 'الإعدادات', sub: 'المظهر، المرتبات، النسخ الاحتياطي…', chevron: true, onClick: () => go('/settings') }),
  ]);
}

export default {
  render() {
    const data = store.data();
    const t = today();
    const body = h('div.more', worthCard(data, t), tiles(data, t), accountRow());
    stagger(body);
    return layout(header({ title: 'المزيد', large: true }), body);
  },
};
