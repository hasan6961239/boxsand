// Form pickers shared by sheets: category grid, date chips, emoji & color pickers.

import { h, icon } from './dom.js';
import { haptic, chips } from './kit.js';
import { categories as listCategories } from '../core/finance.js';
import * as store from '../core/store.js';
import { today, addDays, fmtDate } from '../core/util.js';
import { EMOJI_CHOICES, SWATCHES } from '../core/defaults.js';

/**
 * Grid of category tiles. kind: 'expense' | 'income'.
 * extra: tiles prepended [{ id, name, emoji, color }] (e.g. "مرتب الدولة").
 * onAdd: optional () => Promise<newCatId> to show a "+" tile.
 */
export function categoryGrid({ kind = 'expense', value, onChange, extra = [], onAdd } = {}) {
  const el = h('div.cat-grid', { role: 'radiogroup' });
  let cur = value;
  const paint = () => el.querySelectorAll('.cat-tile[data-id]').forEach((t) => {
    const on = t.dataset.id === cur;
    t.classList.toggle('on', on);
    t.setAttribute('aria-checked', String(on));
  });
  const tile = (c) => h('button.cat-tile.tap', {
    type: 'button',
    role: 'radio',
    dataset: { id: c.id },
    style: { '--c': c.color },
    onclick: () => {
      haptic(6);
      cur = c.id;
      paint();
      onChange && onChange(c.id, c);
    },
  }, h('span.cat-tile-emoji', c.emoji), h('span.cat-tile-name', c.name));
  const render = () => {
    el.replaceChildren(
      ...extra.map(tile),
      ...listCategories(store.data(), kind).map(tile),
      onAdd ? h('button.cat-tile.cat-tile-add.tap', {
        type: 'button',
        onclick: async () => {
          const id = await onAdd();
          if (id) {
            cur = id;
            render();
            const c = store.get(id);
            onChange && onChange(id, c);
          }
        },
      }, h('span.cat-tile-emoji', icon('plus', { size: 22 })), h('span.cat-tile-name', 'بند جديد')) : null,
    );
    paint();
  };
  render();
  el.setValue = (v) => { cur = v; paint(); };
  el.refresh = render;
  return el;
}

/** Date chips: اليوم / أمس / قبل أمس / pick… — onChange('YYYY-MM-DD'). */
export function dateChips({ value = today(), onChange, future = false } = {}) {
  const t = today();
  const native = h('input.date-native', { type: 'date', value, max: future ? undefined : t, 'aria-label': 'اختار تاريخ' });
  const presets = [{ value: t, label: 'اليوم' }, { value: addDays(t, -1), label: 'أمس' }, { value: addDays(t, -2), label: 'قبل أمس' }];
  if (future) presets.splice(1, 2, { value: addDays(t, 1), label: 'بكرة' });
  let cur = value;
  const otherLabel = () => (presets.some((p) => p.value === cur) ? 'تاريخ آخر' : fmtDate(cur, 'short'));
  const group = chips({
    options: [...presets, { value: '__pick', label: otherLabel(), icon: 'calendar' }],
    value: presets.some((p) => p.value === cur) ? cur : '__pick',
    scroll: true,
    onChange: (v) => {
      if (v === '__pick') {
        try { native.showPicker(); } catch { native.focus(); native.click(); }
        return;
      }
      cur = v;
      onChange && onChange(v);
      relabel();
    },
  });
  const relabel = () => {
    const last = group.lastElementChild;
    last.lastChild.textContent = otherLabel();
    group.setValue(presets.some((p) => p.value === cur) ? cur : '__pick');
  };
  native.addEventListener('change', () => {
    if (!native.value) return;
    cur = native.value;
    onChange && onChange(cur);
    relabel();
  });
  return h('div.date-chips', group, native);
}

export function emojiPicker({ value, onChange } = {}) {
  let cur = value;
  const el = h('div.emoji-grid');
  const paint = () => el.querySelectorAll('.emoji-btn').forEach((b) => b.classList.toggle('on', b.textContent === cur));
  for (const e of EMOJI_CHOICES) el.appendChild(h('button.emoji-btn.tap', { type: 'button', onclick: () => { haptic(6); cur = e; paint(); onChange && onChange(e); } }, e));
  paint();
  return el;
}

export function colorPicker({ value, onChange } = {}) {
  let cur = value;
  const el = h('div.swatches');
  const paint = () => el.querySelectorAll('.swatch').forEach((b) => {
    const on = b.dataset.c === cur;
    b.classList.toggle('on', on);
    b.replaceChildren(on ? icon('check', { size: 18, stroke: 3 }) : '');
  });
  for (const c of SWATCHES) el.appendChild(h('button.swatch.tap', { type: 'button', dataset: { c }, style: { '--c': c }, 'aria-label': c, onclick: () => { haptic(6); cur = c; paint(); onChange && onChange(c); } }));
  paint();
  return el;
}
