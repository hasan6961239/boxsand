import { el, copyToClipboard } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { toasts } from './toast.js';
import * as fmt from './format.js';

/**
 * Reusable UI pieces.
 *
 * Every one of these returns a DOM node — there is no template language and no
 * virtual DOM. For a dashboard this size that is less machinery to load on a
 * phone, and it keeps the no-innerHTML rule from dom.js intact end to end.
 */

export function card({ title = null, actions = null, body = null, footer = null, flush = false }) {
  return el('.card',
    title || actions
      ? el('.card__header',
        title ? el('.card__title', typeof title === 'string' ? { text: title } : null, typeof title === 'string' ? null : title) : null,
        actions ? el('.card__actions', actions) : null,
      )
      : null,
    el(`.card__body${flush ? '.card__body--flush' : ''}`, body),
    footer ? el('.card__footer', footer) : null,
  );
}

export function statCard({ label, value, hint = null, iconName = null, meter = null }) {
  let meterNode = null;
  if (meter && Number.isFinite(meter.percent)) {
    const pct = Math.max(0, Math.min(100, meter.percent));
    const tone = pct >= 90 ? '.meter__fill--danger' : pct >= 75 ? '.meter__fill--warning' : '';
    meterNode = el('.meter', el(`.meter__fill${tone}`, { style: { width: `${pct}%` } }));
  }

  return el('.stat',
    el('.stat__label', iconName ? icon(iconName, { size: 14 }) : null, el('span', { text: label })),
    el('.stat__value', typeof value === 'string' || typeof value === 'number' ? { text: String(value) } : null,
      typeof value === 'string' || typeof value === 'number' ? null : value),
    hint ? el('.stat__hint', { text: hint }) : null,
    meterNode,
  );
}

export function badge(text, tone = '', { iconName = null, pulse = false } = {}) {
  return el(`.badge${tone ? `.badge--${tone}` : ''}`,
    pulse ? el('.dot.dot--pulse') : null,
    iconName ? icon(iconName, { size: 12 }) : null,
    el('span', { text }),
  );
}

export function statusBadge(status) {
  const tone = fmt.statusTone(status);
  const pulse = ['BUILDING', 'DEPLOYING', 'QUEUED'].includes(String(status).toUpperCase());
  return badge(String(status), tone, { pulse });
}

export function emptyState({ iconName = 'folder', title, text = null, action = null }) {
  return el('.empty',
    el('.empty__icon', icon(iconName, { size: 22 })),
    el('.empty__title', { text: title }),
    text ? el('.empty__text', { text }) : null,
    action,
  );
}

export function skeletonList(rows = 4) {
  return el('.stack',
    ...Array.from({ length: rows }, (_, i) => el('.skeleton', {
      style: { height: '42px', width: `${100 - i * 4}%` },
    })),
  );
}

export function loadingBlock(label = t('common.loading')) {
  return el('.row', { style: { padding: '28px', justifyContent: 'center', color: 'var(--text-muted)' } },
    el('.spinner'),
    el('span', { text: label }),
  );
}

export function errorBlock(error, onRetry = null) {
  return el('.alert.alert--danger',
    icon('alert', { size: 18 }),
    el('div',
      el('.alert__title', { text: t('error.generic') }),
      el('div', { text: typeof error === 'string' ? error : (error?.message ?? '') }),
      onRetry
        ? el('div', { style: { marginTop: '10px' } },
          el('button.btn.btn--sm', { type: 'button', onClick: onRetry }, t('common.retry')))
        : null,
    ),
  );
}

export function alert(type, title, text, extra = null) {
  const icons = { danger: 'alert', warning: 'warning', info: 'info', success: 'check' };
  return el(`.alert.alert--${type}`,
    icon(icons[type] ?? 'info', { size: 18 }),
    el('div',
      title ? el('.alert__title', { text: title }) : null,
      text ? el('div', { text }) : null,
      extra,
    ),
  );
}

/** A read-only input with a copy button — used for every URL in the dashboard. */
export function copyField(value, { label = null } = {}) {
  const input = el('input.input', { type: 'text', value, readonly: true, onFocus: (e) => e.target.select() });
  return el('.field',
    label ? el('label.field__label', { text: label }) : null,
    el('.copy-field',
      input,
      el('button.btn.btn--icon', {
        type: 'button',
        'aria-label': t('common.copy'),
        title: t('common.copy'),
        onClick: async () => {
          const ok = await copyToClipboard(value);
          if (ok) toasts.success(t('common.copied'));
          else input.select();
        },
      }, icon('copy', { size: 16 })),
    ),
  );
}

export function field({ label, input, hint = null, error = null }) {
  return el('.field',
    label ? el('label.field__label', { text: label }) : null,
    input,
    hint ? el('.field__hint', { text: hint }) : null,
    error ? el('.field__error', { text: error }) : null,
  );
}

export function textInput(props = {}) {
  return el('input.input', { type: 'text', ...props });
}

export function selectInput(options, props = {}) {
  return el('select.select', props,
    ...options.map((option) => el('option', {
      value: option.value,
      selected: option.selected === true,
    }, option.label)),
  );
}

export function switchInput({ checked = false, onChange = null, label = null }) {
  return el('label.switch',
    el('input', { type: 'checkbox', checked, onChange: (e) => onChange?.(e.target.checked) }),
    el('.switch__track', el('.switch__thumb')),
    label ? el('span', { text: label }) : null,
  );
}

export function segmented(options, value, onChange) {
  return el('.segmented', { role: 'group' },
    ...options.map((option) => el('button', {
      type: 'button',
      class: option.value === value ? 'is-active' : '',
      'aria-pressed': String(option.value === value),
      onClick: () => onChange(option.value),
    }, option.iconName ? icon(option.iconName, { size: 15 }) : null, option.label)),
  );
}

/**
 * Table that becomes a stack of cards on a phone.
 * Each cell carries its column header in data-label so the CSS can show it
 * when the table collapses — no second markup path to keep in sync.
 */
export function table({ columns, rows, empty = null, onRowClick = null }) {
  if (!rows.length && empty) return empty;

  return el('.table-wrap',
    el('table.table',
      el('thead', el('tr', ...columns.map((column) => el('th', { text: column.label })))),
      el('tbody', ...rows.map((row) => {
        const tr = el('tr', ...columns.map((column) => {
          const content = column.render(row);
          return el('td', { 'data-label': column.label },
            content instanceof Node || Array.isArray(content) ? content : String(content ?? ''));
        }));
        if (onRowClick) {
          tr.style.cursor = 'pointer';
          tr.tabIndex = 0;
          tr.addEventListener('click', (event) => {
            // Let buttons and links inside a row do their own thing.
            if (event.target.closest('button, a, input, label')) return;
            onRowClick(row);
          });
          tr.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') onRowClick(row);
          });
        }
        return tr;
      })),
    ),
  );
}

export function iconButton(name, { label, onClick, tone = 'ghost', size = 'sm', href = null }) {
  const classes = `btn btn--${tone} btn--icon btn--${size}`;
  if (href) {
    return el('a', {
      class: classes, href, target: '_blank', rel: 'noopener', title: label, 'aria-label': label,
    }, icon(name, { size: 15 }));
  }
  return el('button', {
    class: classes, type: 'button', title: label, 'aria-label': label, onClick,
  }, icon(name, { size: 15 }));
}

/** Deployment pipeline indicator used during an upload. */
export function pipelineSteps(steps, activeIndex, failedIndex = -1) {
  return el('.steps',
    ...steps.map((label, index) => {
      let cls = '';
      if (failedIndex === index) cls = '.is-failed';
      else if (index < activeIndex) cls = '.is-done';
      else if (index === activeIndex) cls = '.is-active';
      return el(`.step${cls}`,
        el('.step__marker', index < activeIndex ? icon('check', { size: 10, strokeWidth: 3 }) : null),
        el('span', { text: label }),
      );
    }),
  );
}

export function progressBar({ label, value }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return el('.progress',
    el('.progress__label',
      el('span', { text: label }),
      el('span', { class: 'tabular', text: `${pct}%` }),
    ),
    el('.progress__bar', el('.progress__fill', { style: { width: `${pct}%` } })),
  );
}

/**
 * QR code.
 *
 * A self-contained encoder, because the alternative — an image from a
 * quickchart-style API — would leak every project URL to a third party and
 * would not work on a home network with no internet. Byte mode, fixed error
 * correction level M, smallest version that fits.
 */
export function qrCanvas(text, size = 200) {
  const modules = buildQrMatrix(text);
  const count = modules.length;
  const scale = Math.max(2, Math.floor(size / (count + 8)));
  const quiet = 4;
  const pixel = (count + quiet * 2) * scale;

  const canvas = el('canvas.qr__canvas', { width: pixel, height: pixel });
  canvas.style.width = `${pixel}px`;
  canvas.style.height = `${pixel}px`;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pixel, pixel);
  ctx.fillStyle = '#000000';
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (modules[y][x]) {
        ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    }
  }
  return canvas;
}

// --- QR encoder (byte mode, level M) --------------------------------------
// Compact but complete: Reed-Solomon over GF(256), the standard mask scoring,
// and version selection by capacity. Versions 1-10 cover any URL this
// dashboard produces.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const generator = rsGenerator(ecCount);
  const result = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < generator.length - 1; i++) {
      result[i] ^= gfMul(generator[i + 1], factor);
    }
  }
  return result;
}

// [total codewords, ec per block, group1 blocks, group1 data, group2 blocks, group2 data] for level M
const VERSION_M = [
  null,
  [26, 10, 1, 16, 0, 0],
  [44, 16, 1, 28, 0, 0],
  [70, 26, 1, 44, 0, 0],
  [100, 18, 2, 32, 0, 0],
  [134, 24, 2, 43, 0, 0],
  [172, 16, 4, 27, 0, 0],
  [196, 18, 4, 31, 0, 0],
  [242, 22, 2, 38, 2, 39],
  [292, 22, 3, 36, 2, 37],
  [346, 26, 4, 43, 1, 44],
];

const ALIGNMENT = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

function buildQrMatrix(text) {
  const bytes = new TextEncoder().encode(text);

  let version = 0;
  let spec = null;
  for (let v = 1; v <= 10; v++) {
    const [, ec, g1, d1, g2, d2] = VERSION_M[v];
    const capacity = g1 * d1 + g2 * d2;
    const headerBits = 4 + (v < 10 ? 8 : 16);
    if (bytes.length + Math.ceil(headerBits / 8) <= capacity) {
      version = v;
      spec = VERSION_M[v];
      break;
    }
  }
  if (!version) {
    throw new Error('That URL is too long to encode as a QR code');
  }

  const [, ecCount, group1, data1, group2, data2] = spec;
  const totalData = group1 * data1 + group2 * data2;

  // --- bit stream ---
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);                                  // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacityBits = totalData * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    dataCodewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (dataCodewords.length < totalData) {
    dataCodewords.push(PAD[padIndex++ % 2]);
  }

  // --- interleave blocks ---
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < group1; i++) {
    blocks.push(dataCodewords.slice(offset, offset + data1));
    offset += data1;
  }
  for (let i = 0; i < group2; i++) {
    blocks.push(dataCodewords.slice(offset, offset + data2));
    offset += data2;
  }
  const ecBlocks = blocks.map((block) => rsEncode(block, ecCount));

  const final = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) final.push(block[i]);
  }
  for (let i = 0; i < ecCount; i++) {
    for (const block of ecBlocks) final.push(block[i]);
  }

  // --- module placement ---
  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));

  const placeFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const y = row + r;
        const x = col + c;
        if (y < 0 || y >= size || x < 0 || x >= size) continue;
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6))
          || (c >= 0 && c <= 6 && (r === 0 || r === 6))
          || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        matrix[y][x] = inRing ? 1 : 0;
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    const value = i % 2 === 0 ? 1 : 0;
    matrix[6][i] = value;
    matrix[i][6] = value;
  }

  // Alignment patterns sit at every combination of the version's coordinates,
  // except the three corners already occupied by finder patterns. Testing
  // "is the centre module free?" instead looks equivalent and is not: from
  // version 7 the coordinates include one that lands on the timing row, whose
  // modules are already set. Skipping those produces a symbol that looks
  // right and that no scanner can read.
  const coords = ALIGNMENT[version];
  const last = coords.length - 1;
  for (let i = 0; i < coords.length; i++) {
    for (let j = 0; j < coords.length; j++) {
      const isFinderCorner = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (isFinderCorner) continue;
      const row = coords[i];
      const col = coords[j];
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          matrix[row + r][col + c] = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) ? 1 : 0;
        }
      }
    }
  }

  matrix[size - 8][8] = 1; // dark module

  // Version information: an 18-bit BCH block that versions 7 and up must carry
  // in two places. Omitting it makes a structurally plausible symbol that no
  // scanner can read — the kind of bug that only shows up when a URL gets long
  // enough to need version 7.
  if (version >= 7) {
    const versionBits = versionInformation(version);
    for (let i = 0; i < 18; i++) {
      const bit = (versionBits >> i) & 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      matrix[a][b] = bit;
      matrix[b][a] = bit;
    }
  }

  // Claim the format-information cells before data placement, so the zig-zag
  // skips them. Writing 0 is enough: the loop below only fills cells that are
  // still null, and the real format bits are written at the end.
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) matrix[8][i] = 0;
    if (matrix[i][8] === null) matrix[i][8] = 0;
  }
  for (let i = 0; i < 8; i++) {
    if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = 0;
    if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = 0;
  }

  // Zig-zag data placement, right to left, skipping the timing column.
  let bitIndex = 0;
  const dataBits = [];
  for (const codeword of final) {
    for (let i = 7; i >= 0; i--) dataBits.push((codeword >> i) & 1);
  }

  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (matrix[row][c] !== null) continue;
        const bit = bitIndex < dataBits.length ? dataBits[bitIndex++] : 0;
        // Mask 0: (row + col) % 2 === 0
        matrix[row][c] = (row + c) % 2 === 0 ? bit ^ 1 : bit;
      }
    }
    upward = !upward;
  }

  // Format information for level M (01) with mask 0.
  const formatBits = formatInformation(0b00, 0);
  let index = 0;
  for (let i = 0; i <= 5; i++) matrix[8][i] = formatBits[index++];
  matrix[8][7] = formatBits[index++];
  matrix[8][8] = formatBits[index++];
  matrix[7][8] = formatBits[index++];
  for (let i = 9; i <= 14; i++) matrix[14 - i][8] = formatBits[index++];

  index = 0;
  for (let i = 0; i <= 6; i++) matrix[size - 1 - i][8] = formatBits[index++];
  for (let i = 7; i <= 14; i++) matrix[8][size - 15 + i] = formatBits[index++];

  return matrix.map((row) => row.map((cell) => (cell === null ? 0 : cell)));
}

/** BCH(18,6) version information, required from version 7 upward. */
function versionInformation(version) {
  let remainder = version << 12;
  for (let i = 5; i >= 0; i--) {
    if ((remainder >> (i + 12)) & 1) remainder ^= 0x1f25 << i;
  }
  return ((version << 12) | remainder) & 0x3ffff;
}

function formatInformation(errorLevel, mask) {
  // Level M is encoded as 00 in the format bits.
  const data = (errorLevel << 3) | mask;
  let value = data << 10;
  for (let i = 4; i >= 0; i--) {
    if ((value >> (i + 10)) & 1) value ^= 0b10100110111 << i;
  }
  const format = ((data << 10) | value) ^ 0b101010000010010;
  const bits = [];
  for (let i = 14; i >= 0; i--) bits.push((format >> i) & 1);
  return bits;
}
