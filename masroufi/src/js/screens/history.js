// History tab: every movement of money, by day, with period navigation,
// type/category filters and Arabic-aware search.

import { h, icon } from '../ui/dom.js';
import { layout, header, iconButton, chips, card, list, empty, button, sheet, moneyEl, haptic, stagger } from '../ui/kit.js';
import { categoryGrid } from '../ui/pickers.js';
import { activityRow, byDay, dayHeader, describe } from '../ui/rows.js';
import * as store from '../core/store.js';
import { rerender, query } from '../core/router.js';
import { today, fold, fmtNumber, fmtPlain, sum, debounce } from '../core/util.js';
import { activity, periodOf, periodByKey, shiftPeriod, periodLabel, category } from '../core/finance.js';
import { TXN_TYPES } from '../core/defaults.js';
import { openTxnSheet } from './txn-sheet.js';

const TYPES = [
  { value: 'all', label: 'الكل' },
  { value: 'expense', label: 'مصاريف', types: ['expense'] },
  { value: 'income', label: 'دخل', types: ['income'] },
  { value: 'advance', label: 'سحب الدرج', types: ['advance'] },
  { value: 'salary', label: 'المرتبات', types: ['salary', 'state'] },
  { value: 'debts', label: 'الديون', types: ['debt', 'pay'] },
  { value: 'goals', label: 'الادخار', types: ['gtx'] },
  { value: 'other', label: 'تعديلات', types: ['adjust', 'carry'] },
];
const PAGE = 80;

// filters survive re-renders and tab switches
const st = { type: 'all', cat: null, periodKey: null, all: false, q: '', searching: false, limit: PAGE };
let lastQuery = null;
let resultsEl = null;

function applyQuery() {
  const raw = location.hash.split('?')[1] || '';
  if (raw === lastQuery) return;
  lastQuery = raw;
  if (!raw) return;
  const q = query();
  if (q.cat) { st.cat = q.cat; st.type = 'all'; }
  if (q.type) st.type = TYPES.some((x) => x.value === q.type) ? q.type : TYPES.find((x) => x.types && x.types.includes(q.type))?.value || 'all';
  if (q.period) { st.periodKey = q.period; st.all = false; }
  st.limit = PAGE;
}

function period(s) {
  return st.periodKey ? periodByKey(st.periodKey, s) : periodOf(today(), s);
}

function haystack(item) {
  const d = describe(item);
  const parts = [d.title, d.sub, item.rec.note, fmtNumber(Math.abs(item.effect || item.rec.amount || 0))];
  if (item.kind === 'txn') parts.push((TXN_TYPES[item.rec.type] || {}).label);
  if (item.person) parts.push(item.person.name);
  if (item.goal) parts.push(item.goal.name);
  return fold(parts.filter(Boolean).join(' '));
}

function filtered(data) {
  const p = period(data.settings);
  const t = TYPES.find((x) => x.value === st.type);
  const needle = fold(st.q.trim());
  return activity(data, {
    from: st.all ? null : p.start,
    to: st.all ? null : p.end,
    types: t && t.types ? new Set(t.types) : null,
    cat: st.cat,
    q: needle ? (i) => haystack(i).includes(needle) : null,
  });
}

function summary(items) {
  const out = sum(items.filter((i) => i.kind === 'txn' && i.rec.type === 'expense'), (i) => i.rec.amount);
  const inn = sum(items.filter((i) => i.effect > 0), (i) => i.effect);
  return h('div.hist-sum',
    h('div', h('small', 'صرفت'), moneyEl(out)),
    h('div', h('small', 'دخل'), moneyEl(inn, { tone: inn ? 'pos' : 'none' })),
    h('div', h('small', 'حركات'), h('b', fmtPlain(items.length))));
}

function results(data) {
  const items = filtered(data);
  const filtering = st.type !== 'all' || st.cat || st.q.trim();
  if (!items.length) {
    if (!data.txn.length && !data.debt.length && !filtering) {
      return card(empty({ emoji: '🧾', title: 'السجل فاضي', body: 'كل مصروف أو دخل أو دين تسجّله يظهر هنا مرتب حسب اليوم.', action: { label: 'سجّل مصروف', icon: 'plus', onClick: () => openTxnSheet({ type: 'expense' }) } }));
    }
    return card(empty({
      emoji: '🔍',
      title: filtering ? 'ما لقيناش حاجة' : 'ما فيش حركات في هالفترة',
      body: filtering ? 'جرّب كلمة ثانية أو شيل الفلاتر.' : 'جرّب فترة ثانية أو اعرض الكل.',
      action: filtering ? { label: 'شيل الفلاتر', icon: 'x', onClick: clearFilters } : { label: 'اعرض الكل', icon: 'history', onClick: () => { st.all = true; rerender(); } },
    }));
  }
  const shown = items.slice(0, st.limit);
  const groups = byDay(shown);
  return h('div.hist-results',
    summary(items),
    groups.map((g) => h('div.day-group', dayHeader(g), list(g.items.map((i) => activityRow(i))))),
    items.length > shown.length ? button({
      label: `عرض المزيد (${fmtPlain(items.length - shown.length)})`,
      variant: 'soft', block: true, cls: 'hist-more',
      onClick: () => { st.limit += PAGE; rerender(); },
    }) : null);
}

function clearFilters() {
  st.type = 'all';
  st.cat = null;
  st.q = '';
  st.limit = PAGE;
  rerender();
}

function pickCategory() {
  sheet({
    title: 'اختار بند',
    body: (a) => h('div.stack',
      h('p.faint.small', 'مصاريف'),
      categoryGrid({ kind: 'expense', value: st.cat, onChange: (id) => { st.cat = id; st.limit = PAGE; a.close(); rerender(); } }),
      h('p.faint.small', 'دخل'),
      categoryGrid({ kind: 'income', value: st.cat, onChange: (id) => { st.cat = id; st.limit = PAGE; a.close(); rerender(); } }),
      st.cat ? button({ label: 'كل البنود', icon: 'x', variant: 'ghost', block: true, onClick: () => { st.cat = null; a.close(); rerender(); } }) : null),
  });
}

function searchBar() {
  const refresh = debounce(() => {
    st.limit = PAGE;
    if (resultsEl) resultsEl.replaceChildren(results(store.data()));
  }, 180);
  const inp = h('input.input.hist-search-input', {
    type: 'search', value: st.q, placeholder: 'دوّر: قهوة، أحمد، 250…', enterkeyhint: 'search', 'aria-label': 'بحث',
    oninput: (e) => { st.q = e.target.value; refresh(); },
  });
  setTimeout(() => { if (st.searching && !st.q) inp.focus({ preventScroll: true }); }, 60);
  return h('div.hist-search', icon('search', { size: 18 }), inp,
    iconButton('x', { label: 'إغلاق البحث', size: 18, variant: 'soft', onClick: () => { st.searching = false; st.q = ''; rerender(); } }));
}

export default {
  render() {
    applyQuery();
    const data = store.data();
    const p = period(data.settings);
    const head = header({
      title: 'السجل',
      large: true,
      actions: [iconButton(st.searching ? 'x' : 'search', {
        label: st.searching ? 'إغلاق البحث' : 'بحث',
        onClick: () => { st.searching = !st.searching; if (!st.searching) st.q = ''; rerender(); },
      })],
    });

    const nav = h('div.hist-period',
      iconButton('chevron-right', { label: 'الفترة اللي قبل', variant: 'surface', size: 20, onClick: () => { st.periodKey = shiftPeriod(p, -1, data.settings).key; st.all = false; st.limit = PAGE; rerender(); } }),
      h('button.hist-period-label.tap', { type: 'button', onclick: () => { st.all = !st.all; st.limit = PAGE; haptic(); rerender(); } },
        h('b', st.all ? 'كل الحركات' : periodLabel(p)),
        h('small', st.all ? 'اضغط لعرض شهر واحد' : p.key === periodOf(today(), data.settings).key ? 'هالشهر · اضغط لعرض الكل' : 'اضغط لعرض الكل')),
      iconButton('chevron-left', {
        label: 'الفترة اللي بعد', variant: 'surface', size: 20,
        onClick: () => { const n = shiftPeriod(p, 1, data.settings); if (n.start <= today()) { st.periodKey = n.key; st.all = false; st.limit = PAGE; rerender(); } },
      }));

    const cat = st.cat ? category(data, st.cat) : null;
    const typeChips = chips({
      scroll: true,
      options: [
        ...TYPES.map((t) => ({ value: t.value, label: t.label })),
      ],
      value: st.type,
      onChange: (v) => { st.type = v; st.limit = PAGE; rerender(); },
    });
    const catChip = h('button.chip.tap.hist-cat', { type: 'button', class: { on: Boolean(cat) }, style: cat ? { '--c': cat.color } : null, onclick: pickCategory },
      cat ? h('span.chip-emoji', cat.emoji) : icon('funnel', { size: 16 }),
      cat ? cat.name : 'البند',
      cat ? h('span.hist-cat-x', { role: 'button', 'aria-label': 'إلغاء البند', onclick: (e) => { e.stopPropagation(); st.cat = null; rerender(); } }, icon('x', { size: 14 })) : null);

    resultsEl = h('div.hist-list', results(data));
    const blocks = h('div.history',
      st.searching ? searchBar() : null,
      nav,
      h('div.hist-filters', catChip, typeChips),
      resultsEl);
    stagger(blocks, { max: 3 });
    return layout(head, blocks);
  },
};
