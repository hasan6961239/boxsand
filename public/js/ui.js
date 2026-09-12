// ===== أدوات الواجهة المشتركة =====

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** إنشاء عنصر: el('div.card', {onclick}, [children]) */
export function el(spec, attrs = {}, children = []) {
  const [tagPart, ...classes] = String(spec).split('.');
  const node = document.createElement(tagPart || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className += (node.className ? ' ' : '') + v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** إضافة أبناء لعنصر مع تجاهل null/undefined/false (Node.append يحوّل null إلى نص "null") */
export function add(parent, ...kids) {
  for (const k of kids.flat()) {
    if (k === null || k === undefined || k === false) continue;
    parent.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return parent;
}

/** مثل add لكن في بداية العنصر */
export function addFirst(parent, ...kids) {
  const list = kids.flat().filter((k) => k !== null && k !== undefined && k !== false);
  parent.prepend(...list.map((k) => (k instanceof Node ? k : document.createTextNode(String(k)))));
  return parent;
}

export const frag = (...nodes) => {
  const f = document.createDocumentFragment();
  nodes.flat().filter(Boolean).forEach((n) => f.append(n));
  return f;
};

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== التنسيق =====
let CURRENCY = 'د.ل';
export const setCurrency = (c) => { CURRENCY = c || 'د.ل'; };
export const currency = () => CURRENCY;

export function money(n, withSymbol = true) {
  const v = Number(n) || 0;
  const s = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withSymbol ? `${s} ${CURRENCY}` : s;
}
export function num(n, d = 0) {
  return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function dateStr(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d)) return String(s).slice(0, 10);
  return d.toLocaleDateString('en-GB');
}
export function dateTimeStr(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d)) return String(s);
  return d.toLocaleDateString('en-GB') + ' — ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const daysAgoStr = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
export const monthStartStr = () => todayStr().slice(0, 8) + '01';

export function daysBetween(dateStrVal) {
  if (!dateStrVal) return null;
  const d = new Date(dateStrVal + 'T00:00:00');
  const t = new Date(todayStr() + 'T00:00:00');
  return Math.round((d - t) / 864e5);
}

/** شارة حالة الصلاحية */
export function expiryBadge(expiry) {
  if (!expiry) return el('span.badge.badge-muted', { text: 'بدون تاريخ' });
  const days = daysBetween(expiry);
  if (days < 0) return el('span.badge.badge-danger', { text: `منتهية منذ ${Math.abs(days)} يوم` });
  if (days <= 30) return el('span.badge.badge-danger', { text: `تنتهي خلال ${days} يوم` });
  if (days <= 90) return el('span.badge.badge-warn', { text: `${days} يوم متبقي` });
  if (days <= 180) return el('span.badge.badge-info', { text: `${days} يوم` });
  return el('span.badge.badge-ok', { text: dateStr(expiry) });
}

export function stockBadge(stock, minStock) {
  const s = Number(stock) || 0;
  if (s <= 0) return el('span.badge.badge-danger', { text: 'نفد' });
  if (minStock > 0 && s <= minStock) return el('span.badge.badge-warn', { text: `${num(s)} — ناقص` });
  return el('span.badge.badge-ok', { text: num(s) });
}

// ===== التنبيهات المنبثقة =====
function toastHost() {
  let host = $('.toasts');
  if (!host) { host = el('div.toasts'); document.body.append(host); }
  return host;
}
export function toast(message, kind = '', ms = 3200) {
  const icons = { ok: '✔', err: '✕', warn: '⚠' };
  const t = el('div.toast', { class: kind }, [
    icons[kind] ? el('span', { text: icons[kind] }) : null,
    el('span', { text: message })
  ]);
  toastHost().append(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s, transform .25s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(() => t.remove(), 260);
  }, ms);
  return t;
}
export const toastOk = (m) => toast(m, 'ok');
export const toastErr = (m) => toast(m, 'err', 4500);

// ===== النوافذ المنبثقة =====
export function modal({ title, body, actions = [], size = '', onClose, closeOnBackdrop = true }) {
  const backdrop = el('div.modal-backdrop');
  const box = el('div.modal', { class: size });
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  box.append(
    el('div.modal-head', {}, [
      el('h3', { text: title || '' }),
      el('button.btn.btn-ghost', { onclick: close, title: 'إغلاق', html: '&times;', style: { fontSize: '22px', lineHeight: '1' } })
    ]),
    el('div.modal-body', {}, [body])
  );
  if (actions.length) {
    box.append(el('div.modal-foot', {}, actions.map((a) =>
      el('button.btn', {
        class: a.class || 'btn-outline',
        onclick: async (e) => {
          if (a.keepOpen) return a.onClick && a.onClick(close, e);
          const r = a.onClick ? await a.onClick(close, e) : true;
          if (r !== false) close();
        },
        type: 'button'
      }, [a.label])
    )));
  }
  backdrop.append(box);
  if (closeOnBackdrop) backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  const firstInput = box.querySelector('input:not([type=hidden]),select,textarea');
  if (firstInput) setTimeout(() => firstInput.focus(), 60);
  return { close, box, backdrop };
}

export function confirmDialog(message, { title = 'تأكيد', okLabel = 'تأكيد', danger = false } = {}) {
  return new Promise((resolve) => {
    modal({
      title, size: 'narrow',
      body: el('p', { text: message, style: { margin: 0, lineHeight: '1.8' } }),
      onClose: () => resolve(false),
      actions: [
        { label: okLabel, class: danger ? 'btn-danger' : 'btn-primary', onClick: () => { resolve(true); return true; } },
        { label: 'إلغاء', class: 'btn-outline', onClick: () => { resolve(false); return true; } }
      ]
    });
  });
}

// ===== حقول النماذج =====
export function field(label, input, hint) {
  return el('div.field', {}, [el('label', { text: label }), input, hint ? el('div.hint', { text: hint }) : null]);
}
export function input(attrs = {}) { return el('input.input', { type: 'text', ...attrs }); }
export function select(options, attrs = {}) {
  const s = el('select.input', attrs);
  for (const o of options) {
    const opt = el('option', { value: o.value ?? '' , text: o.label ?? '' });
    if (o.selected) opt.selected = true;
    s.append(opt);
  }
  return s;
}
export function textarea(attrs = {}) { return el('textarea.input', attrs); }

/** يقرأ كل الحقول التي تحمل خاصية name داخل عنصر */
export function readForm(root) {
  const out = {};
  $$('[name]', root).forEach((f) => {
    if (f.type === 'checkbox') out[f.name] = f.checked ? 1 : 0;
    else if (f.type === 'number') out[f.name] = f.value === '' ? null : Number(f.value);
    else out[f.name] = f.value;
  });
  return out;
}

// ===== الجداول =====
/**
 * جدول: columns = [{title, key, render?, align?, width?, className?}]
 */
export function table(columns, rows, opts = {}) {
  const t = el('table.tbl');
  const thead = el('thead');
  thead.append(el('tr', {}, columns.map((c) =>
    el('th', { class: c.align === 'left' ? 't-left' : c.align === 'center' ? 't-center' : '', style: c.width ? { width: c.width } : {} }, [c.title]))));
  const tbody = el('tbody');
  if (!rows.length) {
    tbody.append(el('tr', {}, [el('td', { colspan: columns.length }, [
      el('div.empty', {}, [
        el('span.ic', { text: opts.emptyIcon || '📋' }),
        el('h4', { text: opts.emptyText || 'لا توجد بيانات' }),
        opts.emptyHint ? el('div.t-sm', { text: opts.emptyHint }) : null
      ])
    ])]));
  } else {
    rows.forEach((r, i) => {
      const tr = el('tr', opts.onRowClick ? { class: 'clickable-row', onclick: () => opts.onRowClick(r, i) } : {});
      columns.forEach((c) => {
        const v = c.render ? c.render(r, i) : r[c.key];
        tr.append(el('td', {
          class: [c.align === 'left' ? 't-left' : c.align === 'center' ? 't-center' : '', c.className || ''].filter(Boolean).join(' ')
        }, [v instanceof Node ? v : (v ?? '—')]));
      });
      tbody.append(tr);
    });
  }
  t.append(thead, tbody);
  if (opts.footer) {
    t.append(el('tfoot', {}, [el('tr', {}, opts.footer.map((f) =>
      el('td', { colspan: f.colspan || 1, class: f.align === 'left' ? 't-left' : '' }, [f.value])))]));
  }
  return el('div.table-wrap', {}, [t]);
}

export function statCard({ label, value, sub, icon, kind = '', onClick }) {
  return el('div.stat', { class: [kind, onClick ? 'clickable' : ''].filter(Boolean).join(' '), onclick: onClick }, [
    el('div.stat-label', {}, [icon ? el('span', { text: icon }) : null, label]),
    el('div.stat-value.num', { text: value }),
    sub ? el('div.stat-sub', { text: sub }) : null
  ]);
}

export function card(title, bodyNodes, headActions = [], bodyTight = false) {
  return el('div.card', {}, [
    title ? el('div.card-head', {}, [
      el('h3', { text: title }), el('div.spacer'), ...headActions
    ]) : null,
    el('div.card-body', { class: bodyTight ? 'tight' : '' }, bodyNodes)
  ]);
}

export function spinner() { return el('div.spinner'); }

export function emptyState(text, icon = '📭', hint) {
  return el('div.empty', {}, [
    el('span.ic', { text: icon }),
    el('h4', { text }),
    hint ? el('div.t-sm', { text: hint }) : null
  ]);
}

/** طباعة عقدة HTML في نافذة منفصلة */
export function printNode(node, title = 'طباعة') {
  const w = window.open('', '_blank', 'width=420,height=650');
  if (!w) { toastErr('المتصفح منع فتح نافذة الطباعة'); return; }
  const styles = [...document.querySelectorAll('link[rel=stylesheet],style')]
    .map((s) => s.outerHTML).join('\n');
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
    <title>${escapeHtml(title)}</title>${styles}
    <style>body{background:#fff;margin:0;display:flex;justify-content:center}@page{margin:4mm}</style>
    </head><body>${node.outerHTML}</body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 350);
}

/** تنزيل ملف نصي (CSV) من المتصفح مباشرة */
export function downloadCsv(filename, headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ['﻿' + headers.map((h) => esc(h.title)).join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(typeof h.value === 'function' ? h.value(r) : r[h.key])).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: filename + '.csv' });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toastOk('تم تصدير الملف');
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
