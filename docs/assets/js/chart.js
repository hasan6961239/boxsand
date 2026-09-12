/* =========================================================================
   Chart — a small SVG time-series renderer.
   Hand-rolled so the page ships zero third-party JS and the marks follow the
   house rules: 2px strokes, recessive grid, a legend for >=2 series, direct
   end-labels, a crosshair tooltip, and an equivalent table view.
   ========================================================================= */
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs) => {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) node.setAttribute(k, v);
    return node;
  };

  /* --------------------------------------------------------------- scales */

  /** Round a range outward to human tick values. */
  function niceTicks(min, max, count) {
    if (!(max > min)) { const pad = Math.abs(max || 1) * 0.02 || 1; min -= pad; max += pad; }
    const raw = (max - min) / Math.max(1, count);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
    return { ticks, lo, hi };
  }

  const fmtDay = new Intl.DateTimeFormat('ar-LY-u-nu-latn', { day: 'numeric', month: 'short' });
  const fmtHour = new Intl.DateTimeFormat('ar-LY-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtFull = new Intl.DateTimeFormat('ar-LY-u-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

  /* ---------------------------------------------------------------- draw */

  /**
   * @param {HTMLElement} host    element to render into
   * @param {object} cfg
   *   series : [{ key, label, color, points: [{t, v}] }]
   *   format : (v) => string      value formatter for tooltip/labels
   *   axisFormat : (v) => string  shorter formatter for the y axis
   *   spark  : boolean            minimal mode used inside cards
   */
  function render(host, cfg) {
    const series = (cfg.series || [])
      .map((s) => ({ ...s, points: (s.points || []).filter((p) => p && Number.isFinite(p.v) && Number.isFinite(p.t)).sort((a, b) => a.t - b.t) }))
      .filter((s) => s.points.length);

    host.textContent = '';
    if (!series.length) {
      const empty = document.createElement('p');
      empty.className = 'chart-empty';
      empty.textContent = cfg.emptyText || 'لا توجد بيانات كافية لهذه الفترة بعد — تتراكم تلقائياً مع كل تحديث.';
      host.appendChild(empty);
      return;
    }

    const spark = !!cfg.spark;
    const width = Math.max(240, host.clientWidth || host.parentElement?.clientWidth || 560);
    const height = spark ? 46 : 248;
    const pad = spark
      ? { t: 4, r: 2, b: 4, l: 2 }
      : { t: 14, r: Math.min(86, Math.max(46, width * 0.13)), b: 26, l: 48 };

    const allT = series.flatMap((s) => s.points.map((p) => p.t));
    const allV = series.flatMap((s) => s.points.map((p) => p.v));
    const t0 = Math.min(...allT), t1 = Math.max(...allT);
    const { ticks, lo, hi } = niceTicks(Math.min(...allV), Math.max(...allV), spark ? 2 : 4);
    const yLo = spark ? Math.min(...allV) : lo;
    const yHi = spark ? Math.max(...allV) : hi;

    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const sx = (t) => pad.l + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);
    const sy = (v) => pad.t + (yHi === yLo ? plotH / 2 : (1 - (v - yLo) / (yHi - yLo)) * plotH);

    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img' });
    svg.setAttribute('aria-label', cfg.ariaLabel || 'مخطط بياني');
    const defs = el('defs');
    svg.appendChild(defs);

    /* grid + axes (recessive) */
    if (!spark) {
      for (const tv of ticks) {
        if (tv < yLo - 1e-9 || tv > yHi + 1e-9) continue;
        const y = sy(tv);
        svg.appendChild(el('line', { class: 'grid-line', x1: pad.l, x2: pad.l + plotW, y1: y, y2: y }));
        const label = el('text', { class: 'axis-text', x: pad.l - 8, y: y + 3.5, 'text-anchor': 'end' });
        label.textContent = (cfg.axisFormat || cfg.format || String)(tv);
        svg.appendChild(label);
      }
      svg.appendChild(el('line', { class: 'axis-line', x1: pad.l, x2: pad.l + plotW, y1: pad.t + plotH, y2: pad.t + plotH }));

      const span = t1 - t0;
      const useHours = span <= 3 * 86400e3;
      const xCount = Math.max(2, Math.min(6, Math.floor(plotW / 92)));
      for (let i = 0; i <= xCount; i++) {
        const t = t0 + (span * i) / xCount;
        const label = el('text', { class: 'axis-text', x: sx(t), y: height - 8, 'text-anchor': 'middle' });
        label.textContent = (useHours ? fmtHour : fmtDay).format(new Date(t));
        svg.appendChild(label);
      }
    }

    /* series marks */
    const singleSeries = series.length === 1;
    const endLabels = [];
    series.forEach((s, i) => {
      // Break the line only where a gap is large *for this series' own
      // cadence* — six times its median spacing. Judging gaps against the
      // total span instead would erase any sparsely-sampled series entirely.
      const spacings = s.points.slice(1).map((p, j) => p.t - s.points[j].t).sort((a, b) => a - b);
      const typical = spacings.length ? spacings[spacings.length >> 1] : Infinity;
      const gapLimit = Math.max(typical * 6, 20 * 60e3);
      let d = '', prevT = null;
      for (const p of s.points) {
        const cmd = prevT == null || p.t - prevT > gapLimit ? 'M' : 'L';
        d += `${cmd}${sx(p.t).toFixed(2)},${sy(p.v).toFixed(2)}`;
        prevT = p.t;
      }

      if (singleSeries || spark) {
        const gid = `grad-${Math.random().toString(36).slice(2, 9)}`;
        const grad = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.appendChild(el('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': spark ? .34 : .28 }));
        grad.appendChild(el('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': 0 }));
        defs.appendChild(grad);
        const base = pad.t + plotH;
        const first = s.points[0], last = s.points[s.points.length - 1];
        const area = `M${sx(first.t).toFixed(2)},${base} ` + d.replace(/^M/, 'L').replace(/M/g, 'L') + ` L${sx(last.t).toFixed(2)},${base} Z`;
        svg.appendChild(el('path', { class: 'series-area', d: area, fill: `url(#${gid})` }));
      }

      svg.appendChild(el('path', { class: 'series-path', d, stroke: s.color, 'stroke-width': spark ? 2 : 2 }));

      if (!spark) {
        const last = s.points[s.points.length - 1];
        // A lone reading has no line to carry it, so give it a full marker.
        svg.appendChild(el('circle', { class: 'series-end-dot', cx: sx(last.t), cy: sy(last.v), r: s.points.length === 1 ? 5.5 : 4.5, fill: s.color }));
        endLabels.push({ x: sx(last.t), y: sy(last.v), color: s.color, text: series.length > 1 ? s.label : (cfg.format || String)(last.v) });
      }
    });

    // Direct labels carry identity, so they must never sit on top of each
    // other: nudge them apart, then pull the stack back inside the plot.
    if (endLabels.length) {
      const MIN_GAP = 15;
      endLabels.sort((a, b) => a.y - b.y);
      for (let i = 1; i < endLabels.length; i++) {
        endLabels[i].ly = Math.max(endLabels[i].y, (endLabels[i - 1].ly ?? endLabels[i - 1].y) + MIN_GAP);
      }
      endLabels[0].ly ??= endLabels[0].y;
      const overshoot = endLabels[endLabels.length - 1].ly - (pad.t + plotH);
      if (overshoot > 0) for (const l of endLabels) l.ly -= overshoot;
      for (const l of endLabels) {
        const y = Math.max(pad.t + 8, l.ly);
        // When a label was pushed off its point, tie the two together.
        if (Math.abs(y - l.y) > 2) {
          svg.appendChild(el('line', { x1: l.x + 4, y1: l.y, x2: l.x + 8, y2: y - 4, stroke: l.color, 'stroke-width': 1, opacity: .5 }));
        }
        const label = el('text', { class: 'series-label', x: l.x + 10, y: y + 4, fill: l.color, 'text-anchor': 'start' });
        label.textContent = l.text;
        svg.appendChild(label);
      }
    }

    /* hover layer */
    let tip = null;
    if (!spark) {
      const cross = el('line', { class: 'crosshair', y1: pad.t, y2: pad.t + plotH });
      svg.appendChild(cross);
      const dots = series.map((s) => {
        const dot = el('circle', { class: 'hover-dot', r: 5, fill: s.color });
        svg.appendChild(dot);
        return dot;
      });

      tip = document.createElement('div');
      tip.className = 'chart-tip';
      host.appendChild(tip);

      const move = (event) => {
        const box = svg.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * width;
        if (px < pad.l - 12 || px > pad.l + plotW + 12) return leave();
        const t = t0 + ((px - pad.l) / plotW) * (t1 - t0);

        // Snap to the reading nearest the pointer, then report only the series
        // that actually have a reading at that moment — otherwise a series with
        // one old point would appear to hold a value across the whole chart.
        const nearest = series.map((s) => {
          let best = null;
          for (const p of s.points) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
          return best;
        });
        let anchorT = null;
        for (const best of nearest) {
          if (best && (anchorT == null || Math.abs(best.t - t) < Math.abs(anchorT - t))) anchorT = best.t;
        }
        if (anchorT == null) return leave();
        const tolerance = Math.max((t1 - t0) / 120, 60e3);

        const rows = [];
        series.forEach((s, i) => {
          const best = nearest[i];
          if (!best || Math.abs(best.t - anchorT) > tolerance) { dots[i].style.opacity = 0; return; }
          dots[i].setAttribute('cx', sx(best.t));
          dots[i].setAttribute('cy', sy(best.v));
          dots[i].style.opacity = 1;
          rows.push({ label: s.label, color: s.color, value: best.v });
        });
        if (!rows.length) return leave();

        cross.setAttribute('x1', sx(anchorT));
        cross.setAttribute('x2', sx(anchorT));
        cross.style.opacity = 1;

        tip.innerHTML =
          `<div class="tip-time">${fmtFull.format(new Date(anchorT))}</div>` +
          rows.map((r) => `<div class="tip-row"><span class="tip-key"><i class="tip-dot" style="--c:${r.color}"></i>${r.label}</span><span class="tip-val">${(cfg.format || String)(r.value)}</span></div>`).join('');
        const left = (sx(anchorT) / width) * host.clientWidth;
        tip.style.left = `${Math.min(Math.max(left, 78), host.clientWidth - 78)}px`;
        tip.style.top = `${(pad.t / height) * host.clientHeight + 6}px`;
        tip.classList.add('is-on');
      };
      const leave = () => {
        cross.style.opacity = 0;
        dots.forEach((d) => { d.style.opacity = 0; });
        tip.classList.remove('is-on');
      };

      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerleave', leave);
      svg.addEventListener('pointerdown', move);
    }

    host.appendChild(svg);
  }

  /** The table that stands in for the chart — also the accessibility relief. */
  function table(series, cfg) {
    const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => b - a).slice(0, 60);
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    const rows = times.map((t) => {
      const cells = series.map((s) => {
        const hit = s.points.find((p) => p.t === t);
        return `<td class="num">${hit ? (cfg.format || String)(hit.v) : '—'}</td>`;
      }).join('');
      return `<tr><td>${fmtFull.format(new Date(t))}</td>${cells}</tr>`;
    }).join('');
    wrap.innerHTML =
      `<table class="data-table"><thead><tr><th scope="col">الوقت</th>${series.map((s) => `<th scope="col">${s.label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
    return wrap;
  }

  global.Chart = { render, table, niceTicks };
})(window);
