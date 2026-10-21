// Big amount entry: a live display plus an on-screen number pad (no system
// keyboard popping up and covering the form). Works with a hardware keyboard too.
//
//   const pad = amountPad({ value: 0, onChange: (milli) => … });
//   sheetBody.append(pad.display, …, pad.pad);
//   pad.get() → milli, pad.set(milli)

import { h, icon } from './dom.js';
import { haptic } from './kit.js';
import { milliToInput, toMilli, fmtNumber, CURRENCY } from '../core/util.js';

export function amountPad({ value = 0, onChange, tone = 'neg', quick = [5, 10, 20, 50, 100], autoKeys = true } = {}) {
  let text = value ? milliToInput(Math.abs(value)) : '';
  const num = h('span.amount-num');
  const display = h('div.amount-display', { class: `tone-${tone}` },
    h('div.amount-line', num, h('span.amount-cur', CURRENCY)));

  // fire = false for the initial paint: callers wire onChange to elements they create after the pad
  function render(bump, fire = true) {
    const m = toMilli(text || '0');
    if (!text) num.textContent = '0';
    else {
      const [i, f] = text.split('.');
      num.textContent = fmtNumber(Number(i || 0) * 1000, { decimals: 0 }) + (text.includes('.') ? '.' + (f || '') : '');
    }
    display.classList.toggle('is-empty', !text);
    if (bump) {
      num.classList.remove('bump');
      void num.offsetWidth;
      num.classList.add('bump');
    }
    if (fire && onChange) onChange(Number.isNaN(m) ? 0 : m);
  }

  function press(k) {
    haptic(6);
    if (k === 'del') text = text.slice(0, -1);
    else if (k === 'clear') text = '';
    else if (k === '.') {
      if (!text.includes('.')) text = (text || '0') + '.';
    } else {
      const [i, f] = text.split('.');
      if (text.includes('.')) {
        if ((f || '').length >= 3) return;
      } else if ((i || '').length >= 8) return;
      text = text === '0' ? k : text + k;
    }
    render(true);
  }

  const key = (k, label) => h('button.key.tap', { type: 'button', 'aria-label': label, onclick: () => press(k) }, label);

  const pad = h('div.keypad.no-drag',
    quick && quick.length ? h('div.keypad-quick', quick.map((q) => h('button.chip.chip-sm.tap', {
      type: 'button',
      onclick: () => {
        haptic(6);
        const cur = toMilli(text || '0') || 0;
        text = milliToInput(cur + q * 1000);
        render(true);
      },
    }, '+' + q))) : null,
    h('div.keypad-grid', { dir: 'ltr' },
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, d)),
      key('.', '.'), key('0', '0'), h('button.key.key-del.tap', { type: 'button', 'aria-label': 'مسح', onclick: () => press('del') }, icon('delete', { size: 24 }))));

  // long-press on the delete key clears everything
  const del = pad.querySelector('.key-del');
  let lt;
  del.addEventListener('pointerdown', () => { lt = setTimeout(() => press('clear'), 550); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => del.addEventListener(e, () => clearTimeout(lt)));

  let onKey = null;
  if (autoKeys) {
    onKey = (e) => {
      if (!pad.isConnected) {
        document.removeEventListener('keydown', onKey);
        return;
      }
      if (e.target.closest && e.target.closest('input, textarea')) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === '.' || e.key === ',') press('.');
      else if (e.key === 'Backspace') press('del');
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
  }

  render(false, false);
  return {
    display,
    pad,
    get: () => {
      const m = toMilli(text || '0');
      return Number.isNaN(m) ? 0 : m;
    },
    set: (m) => { text = m ? milliToInput(Math.abs(m)) : ''; render(false); },
    setTone: (t) => { display.className = `amount-display tone-${t}` + (text ? '' : ' is-empty'); },
    destroy: () => onKey && document.removeEventListener('keydown', onKey),
  };
}
