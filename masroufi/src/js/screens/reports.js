// Reports: where the money went this month (donut by category), income vs
// spending over the last six months, spending per day, and plain insights.

import { h, icon } from '../ui/dom.js';
import { layout, header, iconButton, section, card, moneyEl, empty, stagger, haptic } from '../ui/kit.js';
import { donut, bars, dayBars } from '../ui/charts.js';
import * as store from '../core/store.js';
import { go, rerender } from '../core/router.js';
import { today, fmtMoney, fmtPlain, fmtPercent, monthName, fmtDate, diffDays } from '../core/util.js';
import { periodOf, periodByKey, shiftPeriod, periodLabel, periodTotals, spendByCategory, dailySpend, trend, insights, inPeriod } from '../core/finance.js';

let periodKey = null; // null = current
let selected = null; // highlighted category id

const TOP = 6;

export default {
  render() {
    const data = store.data();
    const t = today();
    const cur = periodOf(t, data.settings);
    const p = periodKey ? periodByKey(periodKey, data.settings) : cur;
    const isCur = p.key === cur.key;
    const tot = periodTotals(data, p);
    const spend = spendByCategory(data, p);
    const elapsed = isCur ? Math.max(1, diffDays(p.start, t) + 1) : p.days;

    const head = header({ title: 'التقارير', back: true });
    const nav = h('div.hist-period',
      iconButton('chevron-right', { label: 'الشهر اللي قبل', variant: 'surface', size: 20, onClick: () => { periodKey = shiftPeriod(p, -1, data.settings).key; selected = null; rerender(); } }),
      h('div.hist-period-label', h('b', periodLabel(p, t)), h('small', isCur ? 'هالشهر' : `${monthName(p.key)}`)),
      iconButton('chevron-left', {
        label: 'الشهر اللي بعد', variant: 'surface', size: 20,
        onClick: () => { if (!isCur) { periodKey = shiftPeriod(p, 1, data.settings).key; selected = null; rerender(); } },
      }));

    const kpis = h('div.kpis.rep-kpis',
      h('div.kpi', h('small', 'صرفت'), h('b', moneyEl(tot.expense))),
      h('div.kpi', h('small', 'دخلك'), h('b', moneyEl(tot.income, { tone: tot.income ? 'pos' : 'none' }))),
      h('div.kpi', h('small', 'الصافي'), h('b', moneyEl(tot.net, { tone: 'auto', sign: tot.net > 0 ? 'always' : 'auto' }))),
      h('div.kpi', h('small', 'متوسط يومي'), h('b', moneyEl(Math.round(tot.expense / elapsed)))));

    const blocks = [nav, kpis];

    if (!spend.total) {
      blocks.push(card(empty({ emoji: '📊', title: 'ما فيش مصاريف في هالفترة', body: isCur ? 'لما تسجّل مصاريف تطلعلك هنا رسوم وتحليل.' : 'جرّب شهر ثاني.' })));
    } else {
      // donut + legend
      const top = spend.list.slice(0, TOP);
      const rest = spend.list.slice(TOP);
      const restSum = rest.reduce((a, e) => a + e.amount, 0);
      const segs = top.map((e) => ({ value: e.amount, color: e.cat.color, label: `${e.cat.emoji} ${e.cat.name}`, id: e.cat.id }));
      if (restSum) segs.push({ value: restSum, color: '#94A3B8', label: 'الباقي', id: null });
      const center = { top: 'المصاريف', main: fmtMoney(spend.total), sub: `${fmtPlain(tot.count)} مصروف` };
      const chart = donut({
        segments: segs,
        size: 210,
        center,
        onSelect: (i) => {
          selected = i === null ? null : segs[i].id;
          legend.querySelectorAll('.rep-leg').forEach((r, j) => r.classList.toggle('is-on', j === i));
        },
      });
      const legend = h('div.rep-legend', segs.map((s, i) => {
        const e = s.id ? spend.list.find((x) => x.cat.id === s.id) : { amount: restSum, pct: (restSum / spend.total) * 100, count: rest.reduce((a, x) => a + x.count, 0) };
        return h('button.rep-leg.tap', {
          type: 'button',
          class: { 'is-on': selected && selected === s.id },
          onclick: () => {
            haptic(4);
            if (selected === s.id && s.id) { go(`/history?cat=${encodeURIComponent(s.id)}&period=${p.key}`); return; }
            chart.select(i);
          },
        },
        h('i', { style: { background: s.color } }),
        h('span.rep-leg-name', s.label),
        h('span.rep-leg-bar', h('span', { style: { width: `${Math.max(3, e.pct)}%`, background: s.color } })),
        h('span.rep-leg-end', h('b', moneyEl(e.amount)), h('small', fmtPercent(e.pct))),
        s.id ? h('span.rep-leg-go', icon('chevron-left', { size: 16 })) : null);
      }));
      blocks.push(section('وين راحت فلوسك', card([chart, h('p.rep-tip', 'اضغط على بند مرتين تشوف حركاته'), legend], { cls: 'rep-donut-card' })));

      // per day
      const days = dailySpend(data, p);
      const mark = isCur ? days.findIndex((d) => d.date === t) : -1;
      const maxDay = days.reduce((a, d) => (d.amount > a.amount ? d : a), days[0]);
      blocks.push(section('صرفك اليومي', card([
        dayBars({ values: days.map((d) => d.amount), labels: days.map((d) => fmtDate(d.date)), mark }),
        h('div.rep-daylegend', h('span', fmtDate(p.start)), h('span', fmtDate(p.end))),
        maxDay && maxDay.amount ? h('p.rep-note', icon('zap', { size: 15 }), 'أكثر يوم صرفت فيه: ', h('b', fmtDate(maxDay.date, 'long')), ' — ', moneyEl(maxDay.amount)) : null,
      ])));
    }

    // trend (always useful, even when this month is empty)
    const tr = trend(data, p, 6, data.settings);
    if (tr.some((x) => x.expense || x.income)) {
      blocks.push(section(`آخر ${fmtPlain(6)} شهور`, card(bars({
        items: tr.map((x) => ({ label: monthName(x.period.key).slice(0, 5), note: periodLabel(x.period, t), values: [x.income, x.expense] })),
        series: [{ name: 'دخل', cls: 'pos' }, { name: 'مصاريف', cls: 'neg' }],
      }))));
    }

    const ins = insights(data, p, data.settings, t).filter((x) => x.text);
    if (ins.length && (spend.total || !inPeriod(t, p))) {
      blocks.push(section('ملاحظات', h('div.rep-insights', ins.map((x) => h('div.note-box', { class: `tone-${x.tone === 'accent' ? 'accent' : x.tone}` }, icon(x.icon, { size: 18 }), h('span', x.text))))));
    }

    const body = h('div.reports', blocks);
    stagger(body);
    return layout(head, body);
  },
};
