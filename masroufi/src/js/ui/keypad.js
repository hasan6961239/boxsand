// Big amount entry typed with the phone's own number keyboard (inputmode
// decimal), so there's never a second keyboard competing for the screen.
//
//   const pad = amountPad({ value: 0, onChange: (milli) => … });
//   sheetBody.append(pad.display, …, pad.pad);   // pad.pad: optional quick-add chips (or null)
//   pad.get() → milli, pad.set(milli)
//
// A new (empty) amount is marked data-autofocus; kit.sheet() focuses it in
// the same tap that opened the sheet, which is what lets iOS show the keyboard.

import { h } from './dom.js';
import { haptic } from './kit.js';
import { milliToInput, toMilli, latinDigits, CURRENCY } from '../core/util.js';

/** Keep only a valid amount while typing: digits, one decimal point, ≤3 decimals, ≤8 integer digits. */
function cleanAmount(raw) {
  let s = latinDigits(raw).replace(/[٫,،]/g, '.').replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  let [i = '', f] = s.split('.');
  i = i.replace(/^0+(?=\d)/, '').slice(0, 8);
  return f === undefined ? i : `${i || '0'}.${f.slice(0, 3)}`;
}

export function amountPad({ value = 0, onChange, tone = 'neg', quick = [], autofocus } = {}) {
  const focusIt = autofocus ?? !value;
  const inp = h('input.amount-input', {
    type: 'text',
    inputmode: 'decimal',
    enterkeyhint: 'done',
    autocomplete: 'off',
    dir: 'ltr',
    placeholder: '0',
    'aria-label': 'المبلغ',
    value: value ? milliToInput(Math.abs(value)) : '',
    'data-autofocus': focusIt ? '' : undefined,
  });
  const display = h('label.amount-display', { class: `tone-${tone}` },
    h('div.amount-line', inp, h('span.amount-cur', CURRENCY)));

  const size = () => {
    // grow the field with its content so the currency stays next to the number
    inp.style.width = `${Math.max(1, (inp.value || '0').length) + 0.6}ch`;
    display.classList.toggle('is-empty', !inp.value);
  };

  const current = () => {
    const m = toMilli(inp.value || '0');
    return Number.isNaN(m) ? 0 : m;
  };

  inp.addEventListener('input', () => {
    const c = cleanAmount(inp.value);
    if (c !== inp.value) inp.value = c;
    size();
    onChange && onChange(current());
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') inp.blur();
  });
  size();

  const pad = quick && quick.length ? h('div.keypad-quick', quick.map((q) => h('button.chip.chip-sm.tap', {
    type: 'button',
    onclick: () => {
      haptic(6);
      inp.value = milliToInput(current() + q * 1000);
      size();
      onChange && onChange(current());
    },
  }, '+' + q))) : null;

  return {
    display,
    pad,
    input: inp,
    get: current,
    set: (m) => { inp.value = m ? milliToInput(Math.abs(m)) : ''; size(); onChange && onChange(current()); },
    setTone: (t) => { display.className = `amount-display tone-${t}` + (inp.value ? '' : ' is-empty'); },
    focus: () => inp.focus({ preventScroll: true }),
    destroy: () => {},
  };
}
