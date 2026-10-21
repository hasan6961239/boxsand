// Categories ("البنود"): add, rename, recolor, reorder and archive the
// expense and income categories used everywhere in the app.

import { h, icon } from '../ui/dom.js';
import { layout, header, iconButton, segmented, card, empty, sheet, field, input, button, toast, confirm, stagger, haptic, tag, actions } from '../ui/kit.js';
import { emojiPicker, colorPicker } from '../ui/pickers.js';
import * as store from '../core/store.js';
import { rerender } from '../core/router.js';
import { today, fmtPlain } from '../core/util.js';
import { categories, periodOf, inPeriod } from '../core/finance.js';
import { SWATCHES } from '../core/defaults.js';

let kind = 'expense';

/** Add or edit a category. Resolves with its id, or null when dismissed. */
export function openCategorySheet({ kind: k = 'expense', id } = {}) {
  const c = id ? store.get(id) : null;
  const st = { kind: c ? c.kind : k, name: c ? c.name : '', emoji: c ? c.emoji : '📦', color: c ? c.color : SWATCHES[store.data().cat.length % SWATCHES.length] };
  const err = h('p.form-err');
  const preview = h('div.cat-preview');
  const paint = () => preview.replaceChildren(h('span.cat-tile-emoji', { style: { '--c': st.color } }, st.emoji), h('b', st.name.trim() || 'اسم البند'));
  paint();
  const api = sheet({
    title: c ? 'تعديل البند' : 'بند جديد',
    full: true,
    body: () => h('div.stack',
      preview,
      !c ? segmented({ options: [{ value: 'expense', label: 'مصروف' }, { value: 'income', label: 'دخل' }], value: st.kind, onChange: (v) => { st.kind = v; } }) : null,
      field('الاسم', input({ value: st.name, placeholder: 'مثلاً: جيم، أكل القطوس…', maxlength: 30, autofocus: !c, onInput: (v) => { st.name = v; err.textContent = ''; paint(); } })),
      field('الأيقونة', emojiPicker({ value: st.emoji, onChange: (e) => { st.emoji = e; paint(); } })),
      field('اللون', colorPicker({ value: st.color, onChange: (v) => { st.color = v; paint(); } })),
      err),
    footer: (a) => button({
      label: c ? 'حفظ' : 'أضف البند', size: 'lg', block: true,
      onClick: () => {
        const name = st.name.trim();
        if (!name) { err.textContent = 'اكتب اسم البند'; return; }
        const dup = store.data().cat.find((x) => x.kind === st.kind && x.id !== (c && c.id) && x.name.trim() === name);
        if (dup) { err.textContent = 'فيه بند بنفس الاسم'; return; }
        const order = c ? c.order : Math.max(0, ...store.data().cat.map((x) => x.order || 0)) + 1;
        const rec = store.put('cat', { ...(c || {}), kind: st.kind, name, emoji: st.emoji, color: st.color, order });
        haptic(10);
        a.close(rec.id);
        toast(c ? 'تم الحفظ' : `تمت إضافة «${name}»`, { tone: 'pos' });
      },
    }),
  });
  return api.result.then((v) => v || null);
}

function usage(data) {
  const p = periodOf(today(), data.settings);
  const all = new Map();
  const month = new Map();
  for (const t of data.txn) {
    if (!t.cat) continue;
    all.set(t.cat, (all.get(t.cat) || 0) + 1);
    if (inPeriod(t.date, p)) month.set(t.cat, (month.get(t.cat) || 0) + 1);
  }
  for (const r of data.rule) all.set(r.cat, (all.get(r.cat) || 0) + 1);
  for (const b of data.budget) if (b.cat) all.set(b.cat, (all.get(b.cat) || 0) + 1);
  return { all, month };
}

function move(list, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const a = list[i];
  const b = list[j];
  // normalize orders so swapping is always meaningful
  store.batch(() => {
    list.forEach((c, k) => { if (c.order !== k) store.patch(c.id, { order: k }); });
    store.patch(a.id, { order: j });
    store.patch(b.id, { order: i });
  });
  haptic(4);
}

function catActions(c, u) {
  const used = u.all.get(c.id) || 0;
  actions({
    title: `${c.emoji} ${c.name}`,
    items: [
      { label: 'تعديل', icon: 'pencil', onClick: () => openCategorySheet({ id: c.id }) },
      { label: c.archived ? 'رجّعه' : 'أرشفة (يختفي من الاختيارات)', icon: 'archive', onClick: () => { store.patch(c.id, { archived: c.archived ? undefined : true }); toast(c.archived ? 'رجع البند' : 'تمت الأرشفة — حركاته القديمة باقية'); } },
      !used ? {
        label: 'حذف', icon: 'trash-2', tone: 'neg',
        onClick: async () => {
          if (!(await confirm({ title: `تحذف «${c.name}»؟`, ok: 'حذف', danger: true, icon: 'trash-2' }))) return;
          const snap = { ...c };
          store.remove(c.id);
          toast('تم الحذف', { action: { label: 'تراجع', onClick: () => store.restore(snap) } });
        },
      } : null,
    ],
  });
}

export default {
  render() {
    const data = store.data();
    const u = usage(data);
    const active = categories(data, kind);
    const archived = categories(data, kind, { archived: true }).filter((c) => c.archived);
    const head = header({ title: 'البنود', back: true, actions: [iconButton('plus', { label: 'بند جديد', variant: 'accent', onClick: () => openCategorySheet({ kind }) })] });
    const seg = segmented({ options: [{ value: 'expense', label: 'المصاريف' }, { value: 'income', label: 'الدخل' }], value: kind, onChange: (v) => { kind = v; rerender(); } });
    const rowOf = (c, i, list, isArchived) => h('div.cat-row', { class: { 'is-archived': isArchived } },
      h('button.cat-row-main.tap', { type: 'button', onclick: () => catActions(c, u) },
        h('span.lead.lead-emoji', { style: { '--c': c.color } }, c.emoji),
        h('span.row-main', h('span.row-title', c.name, isArchived ? tag('مؤرشف', 'muted') : null),
          h('span.row-sub', u.month.get(c.id) ? `${fmtPlain(u.month.get(c.id))} حركة هالشهر` : u.all.get(c.id) ? 'ما استعملتهش هالشهر' : 'ما تستعملش'))),
      !isArchived ? h('div.cat-row-move',
        iconButton('chevron-up', { label: 'لفوق', size: 18, onClick: () => move(list, i, -1) }),
        iconButton('chevron-down', { label: 'لتحت', size: 18, onClick: () => move(list, i, 1) })) : null);
    const body = h('div.cats',
      seg,
      active.length ? h('div.cat-list', active.map((c, i) => rowOf(c, i, active, false))) : card(empty({ emoji: '🏷️', title: 'ما فيش بنود', action: { label: 'أضف بند', onClick: () => openCategorySheet({ kind }) } })),
      archived.length ? h('div.stack-sm', h('p.faint.small.cats-arch-title', icon('archive', { size: 14 }), ' المؤرشفة'), h('div.cat-list', archived.map((c, i) => rowOf(c, i, archived, true)))) : null,
      h('p.sal-hint', icon('info', { size: 16 }), 'اضغط على البند لتعديله أو أرشفته. البند اللي عليه حركات ما ينحذفش، أرشفه بس.'));
    stagger(body);
    return layout(head, body);
  },
};
