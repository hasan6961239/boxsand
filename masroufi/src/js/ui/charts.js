// Lightweight SVG charts with entrance animations: donut, grouped bars,
// daily bars. Colors come from CSS variables so light/dark both work.

import { h, s } from './dom.js';
import { motion } from '../core/theme.js';
import { fmtMoney } from '../core/util.js';

const animate = () => motion() === 'full';

/**
 * Donut. segments: [{ value, color, label }]. center: { top, main, sub }.
 * onSelect(index|null) fires when a segment is tapped.
 */
export function donut({ segments, size = 200, stroke = 26, gap = 2, center, onSelect } = {}) {
  const total = segments.reduce((a, x) => a + x.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const svg = s('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, class: 'donut-svg' });
  svg.appendChild(s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, class: 'donut-track' }));
  let acc = 0;
  const arcs = [];
  segments.forEach((seg, i) => {
    const frac = total ? seg.value / total : 0;
    const len = Math.max(0, frac * c - (segments.length > 1 ? gap : 0));
    // Start at 12 o'clock; each arc is drawn by growing its dash from 0 to its length.
    const final = `${len} ${c - len}`;
    const arc = s('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', stroke: seg.color, 'stroke-width': stroke,
      'stroke-dasharray': animate() ? `0 ${c}` : final,
      'stroke-dashoffset': c * 0.25 - acc * c,
      class: 'donut-arc', 'data-i': i,
      style: animate() ? `transition-delay:${i * 70}ms` : '',
    });
    if (animate()) requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dasharray', final)));
    acc += frac;
    arcs.push(arc);
    svg.appendChild(arc);
  });

  const top = h('small'), main = h('b'), sub = h('small');
  const setCenter = (cfg) => {
    top.textContent = (cfg && cfg.top) || '';
    main.textContent = (cfg && cfg.main) || '';
    sub.textContent = (cfg && cfg.sub) || '';
  };
  setCenter(center);
  const el = h('div.donut', { style: { width: size + 'px', height: size + 'px' } }, svg, h('div.donut-center', top, main, sub));

  let selected = null;
  svg.addEventListener('click', (e) => {
    const t = e.target.closest('.donut-arc');
    const i = t ? Number(t.dataset.i) : null;
    selected = selected === i ? null : i;
    arcs.forEach((a, j) => a.classList.toggle('is-dim', selected !== null && j !== selected));
    if (selected === null) setCenter(center);
    else setCenter({ top: segments[selected].label, main: fmtMoney(segments[selected].value), sub: total ? `${Math.round((segments[selected].value / total) * 100)}%` : '' });
    onSelect && onSelect(selected);
  });
  el.select = (i) => svg.querySelector(`.donut-arc[data-i="${i}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return el;
}

/**
 * Grouped vertical bars. items: [{ label, values: [a, b], note }]
 * series: [{ name, cls }] where cls is a tone class (e.g. 'pos', 'neg').
 */
export function bars({ items, series, height = 170, onSelect } = {}) {
  const max = Math.max(1, ...items.flatMap((it) => it.values));
  const caption = h('div.bars-caption');
  const el = h('div.bars', { style: { '--h': height + 'px' } });
  const cols = items.map((it, i) => {
    const col = h('button.bars-col.tap', { type: 'button', 'aria-label': it.label },
      h('div.bars-stack', it.values.map((v, k) => {
        const bar = h('span.bars-bar', { class: `tone-${series[k].cls}` });
        const pct = (v / max) * 100;
        if (animate()) {
          bar.style.height = '0%';
          bar.style.transitionDelay = `${i * 50 + k * 30}ms`;
          requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.height = pct + '%'; }));
        } else bar.style.height = pct + '%';
        return bar;
      })),
      h('span.bars-label', it.label));
    col.addEventListener('click', () => {
      const on = !col.classList.contains('is-active');
      cols.forEach((c) => c.classList.remove('is-active'));
      col.classList.toggle('is-active', on);
      caption.replaceChildren(...(on ? [h('b', it.note || it.label), ...it.values.map((v, k) => h('span', { class: `tone-${series[k].cls}` }, `${series[k].name}: ${fmtMoney(v)}`))] : []));
      onSelect && onSelect(on ? i : null);
    });
    return col;
  });
  el.append(...cols);
  const legend = h('div.chart-legend', series.map((sr) => h('span', h('i', { class: `tone-${sr.cls}` }), sr.name)));
  return h('div.bars-wrap', el, caption, legend);
}

/** Small bars for spending per day; `mark` highlights an index (today). */
export function dayBars({ values, labels = [], height = 90, mark = -1, cls = 'accent' } = {}) {
  const max = Math.max(1, ...values);
  const el = h('div.daybars', { style: { '--h': height + 'px' } });
  values.forEach((v, i) => {
    const b = h('span.daybar', { class: [`tone-${cls}`, i === mark && 'is-mark', v === 0 && 'is-zero'], title: labels[i] ? `${labels[i]}: ${fmtMoney(v)}` : fmtMoney(v) });
    const pct = v ? Math.max(4, (v / max) * 100) : 2;
    if (animate()) {
      b.style.height = '0%';
      b.style.transitionDelay = `${i * 12}ms`;
      requestAnimationFrame(() => requestAnimationFrame(() => { b.style.height = pct + '%'; }));
    } else b.style.height = pct + '%';
    el.appendChild(b);
  });
  return el;
}
