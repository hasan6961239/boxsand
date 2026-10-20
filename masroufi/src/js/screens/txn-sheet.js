// Add / edit a transaction (expense, income, drawer withdrawal, state salary,
// balance adjustment) and the detail sheet shown when tapping one.

import { h, icon } from '../ui/dom.js';
import { sheet, segmented, button, iconButton, toast, confirm, field, input, chips, moneyEl, haptic, confetti, tag } from '../ui/kit.js';
import { amountPad } from '../ui/keypad.js';
import { categoryGrid, dateChips } from '../ui/pickers.js';
import * as store from '../core/store.js';
import { today, fmtMonth, fmtMoney, fmtDate, addMonths, monthKey } from '../core/util.js';
import { TXN_TYPES } from '../core/defaults.js';
import { defaultAdvanceCycle, category, officeStatus } from '../core/finance.js';
import { checkBudgets } from '../core/automation.js';
import { openSalarySheet } from './salary.js';
import { openCategorySheet } from './categories.js';

const STATE_TILE = { id: '__state', name: 'مرتب الدولة', emoji: '🏛️', color: '#3B82F6' };
const OFFICE_TILE = { id: '__office', name: 'مرتب المكتب', emoji: '💼', color: '#10B981' };

const TITLES = {
  expense: 'مصروف جديد',
  income: 'دخل جديد',
  advance: 'سحب من الدرج',
  state: 'مرتب الدولة',
  adjust: 'تعديل الرصيد',
};

/**
 * openTxnSheet({ type, id, preset }) — `id` edits an existing record;
 * `preset` pre-fills fields ({ amount, cat, date, note, cycle, month }).
 */
export function openTxnSheet({ type = 'expense', id, preset = {} } = {}) {
  const data = store.data();
  const existing = id ? store.get(id) : null;
  if (existing && existing.type === 'salary') return openSalarySheet(existing.cycle, { id });
  const st = {
    type: existing ? existing.type : type,
    amount: existing ? Math.abs(existing.amount) : preset.amount || 0,
    sign: existing && existing.type === 'adjust' ? Math.sign(existing.amount) || 1 : 1,
    cat: existing ? existing.cat : preset.cat || null,
    date: existing ? existing.date : preset.date || today(),
    note: existing ? existing.note || '' : preset.note || '',
    cycle: existing ? existing.cycle : preset.cycle || null,
    month: existing ? existing.month || null : preset.month || null,
  };
  if (st.type === 'state' && !st.amount) st.amount = data.settings.state.amount;
  if (st.type === 'expense' && !st.cat) st.cat = lastUsedCat('expense') || 'cat:food';
  if (st.type === 'income' && !st.cat) st.cat = 'cat:in-other';
  if (st.type === 'advance' && !st.cycle) st.cycle = defaultAdvanceCycle(data, st.date);

  const toneOf = (t) => (t === 'expense' || (t === 'adjust' && st.sign < 0) ? 'neg' : 'pos');
  const pad = amountPad({ value: st.amount, tone: toneOf(st.type), quick: [], onChange: (m) => { st.amount = m; saveBtn.disabled = !m; } });
  const body = h('div.txn-form');
  const saveBtn = button({ label: existing ? 'حفظ التعديل' : 'حفظ', variant: 'primary', size: 'lg', block: true, onClick: () => save() });
  saveBtn.disabled = !st.amount;

  let api;
  const typeSeg = !existing && ['expense', 'income', 'advance'].includes(st.type) ? segmented({
    options: [
      { value: 'expense', label: 'مصروف' },
      { value: 'income', label: 'دخل' },
      { value: 'advance', label: 'سحب درج' },
    ],
    value: st.type,
    onChange: (t) => {
      st.type = t;
      if (t === 'expense') st.cat = lastUsedCat('expense') || 'cat:food';
      if (t === 'income') st.cat = 'cat:in-other';
      if (t === 'advance') st.cycle = defaultAdvanceCycle(store.data(), st.date);
      pad.setTone(toneOf(t));
      api.setTitle(TITLES[t]);
      renderBody();
    },
  }) : null;

  function renderBody() {
    const parts = [];
    if (st.type === 'expense') {
      parts.push(field('البند', categoryGrid({
        kind: 'expense', value: st.cat,
        onChange: (c) => { st.cat = c; },
        onAdd: () => openCategorySheet({ kind: 'expense' }),
      })));
    } else if (st.type === 'income') {
      parts.push(field('نوع الدخل', categoryGrid({
        kind: 'income', value: st.cat,
        extra: existing ? [] : [STATE_TILE, OFFICE_TILE],
        onChange: (c) => {
          if (c === STATE_TILE.id) {
            api.close();
            setTimeout(() => openTxnSheet({ type: 'state', preset: { date: st.date } }), 120);
          } else if (c === OFFICE_TILE.id) {
            api.close();
            setTimeout(() => openSalarySheet(officeStatus(store.data(), today())?.key), 120);
          } else st.cat = c;
        },
        onAdd: () => openCategorySheet({ kind: 'income' }),
      })));
    } else if (st.type === 'advance') {
      const d = store.data();
      const base = defaultAdvanceCycle(d, st.date);
      const opts = [addMonths(base, -1), base, addMonths(base, 1)].filter((k) => k >= (d.settings.office.since || k) || k === st.cycle);
      if (st.cycle && !opts.includes(st.cycle)) opts.push(st.cycle);
      parts.push(h('div.note-box.tone-warn', icon('info', { size: 18 }),
        h('span', 'الفلوس تنضاف لرصيدك توة، وتنخصم من المرتب لما تستلمه.')));
      parts.push(field('ينخصم من مرتب', chips({
        options: opts.sort().map((k) => ({ value: k, label: fmtMonth(k) })),
        value: st.cycle,
        onChange: (v) => { st.cycle = v; },
      })));
    } else if (st.type === 'state') {
      const t = today();
      const months = [addMonths(monthKey(t), -3), addMonths(monthKey(t), -2), addMonths(monthKey(t), -1), monthKey(t)];
      parts.push(field('مرتب أي شهر؟ (اختياري)', chips({
        options: [{ value: null, label: 'مش مهم' }, ...months.map((k) => ({ value: k, label: fmtMonth(k) }))],
        value: st.month,
        scroll: true,
        onChange: (v) => { st.month = v; },
      })));
    } else if (st.type === 'adjust') {
      parts.push(field('نوع التعديل', segmented({
        options: [{ value: 1, label: 'زيادة على الرصيد' }, { value: -1, label: 'نقص من الرصيد' }],
        value: st.sign,
        onChange: (v) => { st.sign = v; pad.setTone(toneOf('adjust')); },
      }), { hint: 'استعمله لما تعد فلوسك وتلقاها مختلفة عن رصيد التطبيق.' }));
    }
    parts.push(field('التاريخ', dateChips({
      value: st.date,
      onChange: (d) => {
        st.date = d;
        if (st.type === 'advance' && !existing) {
          st.cycle = defaultAdvanceCycle(store.data(), d);
          renderBody();
        }
      },
    })));
    parts.push(field('ملاحظة', input({ value: st.note, placeholder: st.type === 'expense' ? 'مثلاً: غدا مع الشباب' : 'اختياري', onInput: (v) => { st.note = v; }, maxlength: 120, enterkeyhint: 'done' })));
    body.replaceChildren(...parts);
  }

  function save() {
    if (!st.amount) return;
    const rec = {
      ...(existing || {}),
      type: st.type,
      amount: st.type === 'adjust' ? st.amount * st.sign : st.amount,
      date: st.date,
      note: st.note.trim() || undefined,
      cat: st.type === 'expense' || st.type === 'income' ? st.cat : undefined,
      cycle: st.type === 'advance' ? st.cycle : undefined,
      month: st.type === 'state' ? st.month || undefined : undefined,
    };
    const saved = store.put('txn', rec);
    haptic(12);
    api.close(saved);
    afterSave(saved, Boolean(existing));
  }

  api = sheet({
    title: existing ? `تعديل ${TXN_TYPES[st.type].label}` : TITLES[st.type],
    full: true,
    cls: 'txn-sheet',
    body: () => h('div.txn-top', typeSeg, pad.display, body),
    footer: () => h('div.txn-foot', pad.pad, saveBtn),
    onClose: () => pad.destroy(),
  });
  renderBody();
  return api;
}

function lastUsedCat(kind) {
  const list = store.data().txn.filter((t) => t.type === kind && t.cat && !t.rule);
  if (!list.length) return null;
  list.sort((a, b) => (b.u || 0) - (a.u || 0));
  return list[0].cat;
}

function afterSave(rec, edited) {
  if (edited) {
    toast('تم حفظ التعديل', { tone: 'pos' });
    return;
  }
  const undo = { label: 'تراجع', onClick: () => store.remove(rec.id) };
  if (rec.type === 'expense') {
    const alerts = checkBudgets();
    if (alerts.length) {
      const a = alerts[0];
      toast(a.level >= 100 ? `تجاوزت ${a.name}! (${Math.round(a.pct)}%)` : `انتبه: وصلت ${Math.round(a.pct)}% من ${a.name}`, { tone: a.level >= 100 ? 'neg' : 'warn', action: undo, duration: 5000 });
      return;
    }
    toast(`تم تسجيل ${fmtMoney(rec.amount)}`, { tone: 'pos', action: undo });
  } else if (rec.type === 'advance') {
    toast(`سحبت ${fmtMoney(rec.amount)} — تنخصم من مرتب ${fmtMonth(rec.cycle)}`, { tone: 'pos', action: undo });
  } else if (rec.type === 'state') {
    confetti();
    toast('مبروك! نزل مرتب الدولة 🎉', { tone: 'pos', action: undo });
  } else {
    toast('تم الحفظ', { tone: 'pos', action: undo });
  }
}

/* ------------------------------------------------------------ detail */

export function openTxnDetail(id) {
  const r = store.get(id);
  if (!r) return;
  if (r.type === 'salary') return openSalarySheet(r.cycle, { id });
  const data = store.data();
  const meta = TXN_TYPES[r.type] || TXN_TYPES.expense;
  const c = r.cat ? category(data, r.cat) : null;
  const sign = r.type === 'expense' ? -1 : 1;
  const rows = [
    ['النوع', meta.label],
    c ? ['البند', `${c.emoji} ${c.name}`] : null,
    ['التاريخ', fmtDate(r.date, 'long')],
    r.cycle ? ['ينخصم من', `مرتب ${fmtMonth(r.cycle)}`] : null,
    r.month ? ['مرتب شهر', fmtMonth(r.month)] : null,
    r.rule ? ['المصدر', 'مصروف ثابت (يتسجل وحده)'] : null,
    r.note ? ['ملاحظة', r.note] : null,
  ].filter(Boolean);

  const api = sheet({
    cls: 'detail-sheet',
    title: '',
    body: (a) => h('div.detail',
      h('div.detail-hero',
        c ? h('span.detail-emoji', { style: { '--c': c.color } }, c.emoji) : h('span.detail-emoji.tone-' + meta.tone, icon(meta.icon, { size: 28 })),
        h('div.detail-amount', moneyEl(r.amount * sign, { sign: sign > 0 ? 'always' : 'auto', tone: sign > 0 ? 'pos' : 'none' })),
        r.type === 'adjust' ? tag('تعديل يدوي', 'muted') : null),
      h('dl.detail-list', rows.map(([k, v]) => h('div.detail-row', h('dt', k), h('dd', v)))),
      h('div.detail-actions',
        button({ label: 'تعديل', icon: 'pencil', variant: 'soft', block: true, onClick: () => { a.close(); setTimeout(() => openTxnSheet({ id }), 150); } }),
        r.type === 'expense' || r.type === 'income' ? button({
          label: 'كرّره اليوم', icon: 'repeat', variant: 'ghost', block: true,
          onClick: () => { a.close(); setTimeout(() => openTxnSheet({ type: r.type, preset: { amount: r.amount, cat: r.cat, note: r.note } }), 150); },
        }) : null,
        button({
          label: 'حذف', icon: 'trash-2', variant: 'plain', block: true, cls: 'btn-text-neg',
          onClick: async () => {
            const ok = await confirm({ title: 'تحذف الحركة هذي؟', body: `${meta.label} — ${fmtMoney(r.amount)}`, ok: 'حذف', danger: true, icon: 'trash-2' });
            if (!ok) return;
            const snapshot = { ...store.get(id) };
            store.remove(id);
            a.close();
            toast('تم الحذف', { action: { label: 'تراجع', onClick: () => store.restore(snapshot) } });
          },
        }))),
  });
  return api;
}

/** Quick helper for "adjust balance" entry points (settings / home). */
export function openAdjustSheet() {
  return openTxnSheet({ type: 'adjust' });
}

