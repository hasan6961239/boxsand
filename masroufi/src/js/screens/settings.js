// Settings: profile, appearance, notifications, account & sync, salaries and
// income, backup/export, about.

import { h, icon } from '../ui/dom.js';
import { layout, header, section, card, list, row, toggle, segmented, button, sheet, field, input, toast, confirm, busy, stagger, avatar, haptic, moneyEl, empty } from '../ui/kit.js';
import { amountPad } from '../ui/keypad.js';
import { dateOverlay } from '../ui/pickers.js';
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import * as sync from '../core/sync.js';
import { on } from '../core/bus.js';
import { go, rerender, current } from '../core/router.js';
import { today, fmtMoney, fmtDate, fmtTime, fmtPlain, fromMilli } from '../core/util.js';
import { ACCENTS, TXN_TYPES, DEFAULT_CATEGORIES, defaultSettings } from '../core/defaults.js';
import { balance, category } from '../core/finance.js';
import { openAdjustSheet } from './txn-sheet.js';
import { pushCard } from './notifications.js';
import { openLogin, openSignup, openNewPassword } from './account-sheets.js';

const SECTIONS = {
  appearance: { title: 'المظهر', render: appearance },
  notifications: { title: 'الإشعارات', render: notifications },
  account: { title: 'الحساب والمزامنة', render: account },
  income: { title: 'المرتبات والرصيد', render: income },
  data: { title: 'النسخ الاحتياطي', render: dataSection },
  about: { title: 'عن التطبيق', render: about },
};

// account section follows the sync / auth state live
for (const evt of ['sync', 'auth']) {
  on(evt, () => {
    const c = current();
    if (c && (c.path === '/settings/account' || c.path === '/settings')) rerender();
  });
}

const set = (patch) => store.setSettings(patch);

/* ------------------------------------------------------------ helpers */

function amountSheet({ title, sub, value, onSave }) {
  let v = value;
  const pad = amountPad({ value, tone: 'accent', quick: [], autofocus: true, onChange: (m) => { v = m; } });
  sheet({
    title,
    sub,
    body: () => h('div.stack', pad.display, pad.pad),
    footer: (a) => button({ label: 'حفظ', size: 'lg', block: true, onClick: () => { onSave(v); haptic(10); a.close(); toast('تم الحفظ', { tone: 'pos' }); } }),
    onClose: () => pad.destroy(),
  });
}

function daySheet({ value, onSave }) {
  sheet({
    title: 'يوم نزول المرتب',
    sub: 'لو الشهر أقصر يعتبر آخر يوم فيه.',
    body: (a) => h('div.rule-days', Array.from({ length: 31 }, (_, i) => i + 1).map((d) => h('button.rule-day.tap', {
      type: 'button', class: { on: d === value },
      onclick: () => { onSave(d); haptic(8); a.close(); },
    }, fmtPlain(d)))),
  });
}

function textSheet({ title, value, placeholder, onSave, type = 'text', maxlength = 40 }) {
  let v = value || '';
  sheet({
    title,
    body: () => input({ value: v, placeholder, type, maxlength, autofocus: true, onInput: (x) => { v = x; } }),
    footer: (a) => button({ label: 'حفظ', size: 'lg', block: true, onClick: () => { onSave(v.trim()); a.close(); } }),
  });
}

function group(title, rows) {
  return section(title, list(rows.filter(Boolean)));
}

function navRow(ic, tone, title, sub, path) {
  return row({ lead: { icon: ic, tone }, title, sub, chevron: true, onClick: () => go(path) });
}

function toggleRow(ic, tone, title, sub, checked, onChange) {
  return row({ lead: { icon: ic, tone }, title, sub, end: toggle({ checked, label: title, onChange }) });
}

/* ------------------------------------------------------------ main */

export default {
  render() {
    const s = store.settings();
    const data = store.data();
    const u = auth.current();
    const profile = h('button.set-profile.tap', {
      type: 'button',
      onclick: () => textSheet({ title: 'شن نناديك؟', value: s.name, placeholder: 'اسمك', onSave: (name) => set({ name }) }),
    },
    avatar(s.name || 'م', 'var(--accent)'),
    h('span.set-profile-main', h('b', s.name || 'ضيف اسمك'), h('small', u ? u.email : 'بدون حساب — البيانات على هالجهاز')),
    icon('pencil', { size: 18 }));

    const body = h('div.settings',
      profile,
      group(null, [
        row({ lead: { icon: 'wallet', tone: 'accent' }, title: 'رصيدك الحالي', sub: 'لو مختلف عن اللي في جيبك عدّله', end: moneyEl(balance(data)), chevron: true, onClick: () => openAdjustSheet() }),
      ]),
      group('عام', [
        navRow('palette', 'info', 'المظهر', `${ACCENTS[s.look.accent]?.name || ''} · ${{ auto: 'تلقائي', light: 'فاتح', dark: 'داكن' }[s.look.mode]}`, '/settings/appearance'),
        navRow('bell', 'warn', 'الإشعارات', s.notif.daily.on ? `تذكير يومي ${fmtTime(s.notif.daily.time)}` : 'التذكير اليومي مقفول', '/settings/notifications'),
        navRow('briefcase', 'pos', 'المرتبات والرصيد', `${fmtMoney(s.office.amount)} يوم ${fmtPlain(s.office.day)}`, '/settings/income'),
        navRow('tags', 'accent', 'البنود', `${fmtPlain(data.cat.filter((c) => !c.archived).length)} بند`, '/categories'),
      ]),
      group('البيانات', [
        navRow(u ? 'cloud' : 'cloud-off', u ? 'pos' : 'muted', 'الحساب والمزامنة', u ? 'متصل' : 'بدون حساب', '/settings/account'),
        navRow('database', 'info', 'النسخ الاحتياطي والتصدير', 'ملف احتياطي، إكسل', '/settings/data'),
        navRow('info', 'muted', 'عن التطبيق', null, '/settings/about'),
      ]));
    stagger(body);
    return layout(header({ title: 'الإعدادات', back: true }), body);
  },
};

export const settingsSection = {
  render({ section: key }) {
    const sec = SECTIONS[key];
    if (!sec) {
      return layout(header({ title: 'الإعدادات', back: true }), card(empty({ emoji: '🤔', title: 'الصفحة هذي مش موجودة', action: { label: 'الإعدادات', onClick: () => go('/settings', { replace: true }) } })));
    }
    const body = h('div.settings', sec.render(store.settings()));
    stagger(body);
    return layout(header({ title: sec.title, back: true, onBack: () => (history.state && history.state.n > 0 ? history.back() : go('/settings', { replace: true })) }), body);
  },
};

/* ------------------------------------------------------------ appearance */

// let the control finish its animation before the page re-renders
const later = (fn) => setTimeout(fn, 230);

function appearance(s) {
  const look = s.look;
  const acc = ACCENTS[look.accent] || ACCENTS.emerald;
  const preview = h('div.set-preview',
    h('div.set-preview-hero', h('small', 'رصيدك الحالي'), h('b', fmtMoney(1250000)), h('span', `هالشهر · صرفت ${fmtMoney(340000)}`)),
    h('div.set-preview-row', h('span.lead.lead-emoji', { style: { '--c': '#F97316' } }, '🍔'), h('span', 'أكل ومطاعم'), h('b', fmtMoney(-12500))),
    h('div.set-preview-btn', acc.name));
  return [
    preview,
    section('الوضع', segmented({
      options: [{ value: 'auto', label: 'تلقائي', icon: 'sun-moon' }, { value: 'light', label: 'فاتح', icon: 'sun' }, { value: 'dark', label: 'داكن', icon: 'moon' }],
      value: look.mode,
      onChange: (v) => later(() => set({ look: { mode: v } })),
    })),
    section('اللون', h('div.accent-grid', Object.entries(ACCENTS).map(([k, a]) => h('button.accent.tap', {
      type: 'button', class: { on: k === look.accent }, style: { '--a': a.a, '--b': a.b },
      onclick: () => { haptic(6); set({ look: { accent: k } }); },
    }, h('span.accent-dot', k === look.accent ? icon('check', { size: 18, stroke: 3 }) : null), h('small', a.name))))),
    section('الحركة والأنيميشن', segmented({
      options: [{ value: 'full', label: 'كاملة' }, { value: 'reduced', label: 'خفيفة' }, { value: 'off', label: 'بدون' }],
      value: look.motion,
      onChange: (v) => later(() => set({ look: { motion: v } })),
    })),
    section('حجم الخط', segmented({
      options: [{ value: 's', label: 'صغير' }, { value: 'm', label: 'عادي' }, { value: 'l', label: 'كبير' }],
      value: look.size,
      onChange: (v) => later(() => set({ look: { size: v } })),
    })),
    section('الأرقام', segmented({
      options: [{ value: 'latin', label: '123' }, { value: 'arab', label: '١٢٣' }],
      value: look.digits,
      onChange: (v) => later(() => set({ look: { digits: v } })),
    })),
  ];
}

/* ------------------------------------------------------------ notifications */

function notifications(s) {
  const n = s.notif;
  const setN = (patch) => set({ notif: patch });
  return [
    pushCard(),
    group('شن نذكّرك بيه؟', [
      toggleRow('receipt-text', 'accent', 'تذكير يومي بالمصاريف', n.daily.on ? `كل يوم ${fmtTime(n.daily.time)}` : 'مقفول', n.daily.on, (v) => setN({ daily: { ...n.daily, on: v } })),
      n.daily.on ? row({
        lead: { icon: 'clock', tone: 'muted' }, title: 'وقت التذكير', end: h('b', fmtTime(n.daily.time)), chevron: true,
        onClick: () => timeSheet(n.daily.time, (time) => setN({ daily: { ...n.daily, time } })),
      }) : null,
      toggleRow('briefcase', 'pos', 'يوم المرتب', 'قبله بيوم ويوم نزوله، مع الصافي بعد السحوبات', n.salary, (v) => setN({ salary: v })),
      toggleRow('handshake', 'info', 'مواعيد الديون', 'قبل الموعد بيوم، يوم الموعد، ولو تأخر', n.debts, (v) => setN({ debts: v })),
      toggleRow('target', 'warn', 'الميزانية', 'لما توصل 80% و100%', n.budget, (v) => setN({ budget: v })),
      toggleRow('repeat', 'muted', 'المصاريف الثابتة', 'يوم ما تتسجل', n.recurring, (v) => setN({ recurring: v })),
    ]),
    h('p.sal-hint', icon('info', { size: 16 }), 'التذكيرات تتبعث من السيرفر، فتوصلك حتى والتطبيق مقفول — بشرط تكون مسجّل دخول ومفعّل الإشعارات على الجهاز.'),
  ];
}

function timeSheet(value, onSave) {
  let v = value;
  const inp = h('input.input.set-time', { type: 'time', value, step: 900, onchange: (e) => { v = e.target.value; } });
  const quick = ['20:00', '21:00', '22:00', '23:00'];
  sheet({
    title: 'وقت التذكير اليومي',
    body: () => h('div.stack', inp, h('div.chips', quick.map((q) => h('button.chip.tap', { type: 'button', onclick: () => { inp.value = q; v = q; } }, fmtTime(q))))),
    footer: (a) => button({ label: 'حفظ', size: 'lg', block: true, onClick: () => { if (v) onSave(v); a.close(); } }),
  });
}

/* ------------------------------------------------------------ account */

function syncText(st) {
  if (st.state === 'syncing') return 'جاري المزامنة…';
  if (st.state === 'offline') return 'بدون نت — التغييرات محفوظة على الجهاز وتتزامن لما يرجع النت';
  if (st.state === 'error' || st.state === 'auth') return st.error || 'تعذّرت المزامنة';
  if (!st.at) return 'ما تزامنش لسه';
  const mins = Math.round((Date.now() - st.at) / 60000);
  return `آخر مزامنة ${mins < 1 ? 'توة' : mins < 60 ? `قبل ${fmtPlain(mins)} دقيقة` : `${fmtDate(new Date(st.at).toISOString().slice(0, 10), 'relative')}`}`;
}

// The Netlify project's Identity settings page (project name = first label of *.netlify.app).
function identityUrl() {
  const host = location.hostname;
  return host.endsWith('.netlify.app') ? `https://app.netlify.com/projects/${host.split('.')[0].split('--').pop()}/identity` : 'https://app.netlify.com/';
}

function account() {
  const avail = auth.isAvailable();
  const u = auth.current();
  if (avail === false) {
    return [
      card([
        h('div.push-head', h('span.push-ic.tone-warn', icon('cloud-off', { size: 22 })), h('div', h('b', 'الحسابات مش مفعّلة في الموقع لسه'), h('p', 'التطبيق شغال عادي وبياناتك محفوظة على هالجهاز. عشان تزامن بين أجهزتك لازم تفعّل الحسابات مرة وحدة من لوحة Netlify:'))),
        h('ol.push-steps',
          h('li', h('span.push-step-n', '1'), h('span', 'افتح صفحة Identity متاع المشروع: ', h('a', { href: identityUrl(), target: '_blank', rel: 'noopener', dir: 'ltr' }, 'Netlify ← Identity'))),
          h('li', h('span.push-step-n', '2'), h('span', 'اضغط الزر ', h('bdi', 'Enable Identity'))),
          h('li', h('span.push-step-n', '3'), h('span', 'ارجع هنا واضغط «تحقق تاني»'))),
        button({ label: 'تحقق تاني', icon: 'refresh-cw', variant: 'soft', block: true, onClick: (e) => busy(e.currentTarget, async () => { const ok = await auth.recheck(); toast(ok ? 'الحسابات شغالة ✓' : 'لسه مش مفعّلة', { tone: ok ? 'pos' : 'warn' }); rerender(); }) }),
      ], { cls: 'push-state' }),
    ];
  }
  if (!u) {
    return [
      card([
        h('div.set-acc-hero', h('span.set-acc-ic', icon('cloud', { size: 30 })), h('b', 'زامن بياناتك بين أجهزتك'), h('p', 'سجّل بإيميلك وكلمة سر، وبياناتك تتحفظ في حسابك وتلقاها في أي جهاز. وكمان تشتغل التذكيرات والتطبيق مقفول.')),
        button({ label: 'سجّل دخول', icon: 'log-in', block: true, onClick: () => openLogin() }),
        button({ label: 'عندي حساب؟ لا — أعمل حساب جديد', variant: 'plain', block: true, onClick: () => openSignup() }),
        avail === null ? h('p.faint.small.center', 'ما قدرناش نتأكد من السيرفر (يمكن ما فيش نت).') : null,
      ], { cls: 'set-acc' }),
    ];
  }
  const st = sync.getStatus();
  return [
    card([
      h('div.set-acc-user', avatar(u.name || u.email, 'var(--accent)'), h('div', h('b', u.name || 'حسابي'), h('small', u.email))),
      h('div.set-sync', { class: `is-${st.state}` }, icon(st.state === 'syncing' ? 'refresh-cw' : st.state === 'idle' ? 'circle-check' : 'cloud-off', { size: 18 }), h('span', syncText(st))),
      button({ label: 'زامن توة', icon: 'refresh-cw', variant: 'soft', block: true, onClick: (e) => busy(e.currentTarget, async () => { const ok = await sync.syncNow(); toast(ok ? 'تمت المزامنة ✓' : sync.getStatus().error || 'تعذّرت المزامنة', { tone: ok ? 'pos' : 'warn' }); }) }),
    ], { cls: 'set-acc' }),
    group(null, [
      row({ lead: { icon: 'key-round', tone: 'muted' }, title: 'تغيير كلمة السر', chevron: true, onClick: () => openNewPassword() }),
      row({ lead: { icon: 'log-out', tone: 'neg' }, title: 'تسجيل خروج', chevron: true, onClick: () => logout() }),
    ]),
  ];
}

function logout() {
  sheet({
    title: 'تسجيل خروج',
    sub: 'بياناتك محفوظة في حسابك وترجع لما تدخل تاني.',
    body: (a) => h('div.stack',
      button({ label: 'خروج وخلي البيانات على هالجهاز', variant: 'soft', block: true, onClick: (e) => busy(e.currentTarget, () => doLogout(a, false)) }),
      button({ label: 'خروج وامسح البيانات من هالجهاز', variant: 'danger', block: true, onClick: (e) => busy(e.currentTarget, () => doLogout(a, true)) }),
      button({ label: 'إلغاء', variant: 'plain', block: true, onClick: () => a.close() })),
  });
}

async function doLogout(a, wipe) {
  if (navigator.onLine) await sync.syncNow().catch(() => {});
  if (wipe && store.dirty().some((r) => r.u > 0)) {
    const ok = await confirm({ title: 'فيه تغييرات ما تزامنتش', body: 'لو مسحت توة تضيع. متأكد؟', ok: 'امسح', danger: true });
    if (!ok) return;
  }
  await auth.logout();
  a.close();
  if (wipe) {
    await store.wipe();
    go('/welcome', { replace: true });
    toast('تم الخروج ومسح البيانات من الجهاز');
  } else toast('تم تسجيل الخروج');
}

/* ------------------------------------------------------------ income */

function income(s) {
  const o = s.office;
  return [
    group('مرتب المكتب', [
      toggleRow('briefcase', 'pos', 'عندي مرتب مكتب', 'نتابع موعده وسحوبات الدرج', o.on, (v) => set({ office: { on: v } })),
      o.on ? row({ lead: { icon: 'banknote', tone: 'muted' }, title: 'المبلغ', end: moneyEl(o.amount), chevron: true, onClick: () => amountSheet({ title: 'مرتب المكتب', sub: 'قبل خصم سحوبات الدرج.', value: o.amount, onSave: (v) => v && set({ office: { amount: v } }) }) }) : null,
      o.on ? row({ lead: { icon: 'calendar', tone: 'muted' }, title: 'يوم نزوله', end: h('b', `يوم ${fmtPlain(o.day)}`), chevron: true, onClick: () => daySheet({ value: o.day, onSave: (d) => set({ office: { day: d } }) }) }) : null,
    ]),
    o.on ? section('الشهر عندك يبدا من', h('div.stack-sm',
      segmented({ options: [{ value: 'payday', label: `يوم المرتب (${fmtPlain(o.day)})` }, { value: 'month', label: 'أول الشهر' }], value: s.period, onChange: (v) => later(() => set({ period: v })) }),
      h('p.faint.small', s.period === 'payday' ? `التقارير والميزانية تحسب من يوم ${fmtPlain(o.day)} لليوم اللي قبله في الشهر الجاي — على قد المرتب.` : 'التقارير والميزانية تحسب من أول الشهر لآخره.'))) : null,
    group('مرتب الدولة', [
      toggleRow('landmark', 'info', 'عندي مرتب دولة', 'تسجّله لما ينزل', s.state.on, (v) => set({ state: { on: v } })),
      s.state.on ? row({ lead: { icon: 'banknote', tone: 'muted' }, title: 'المبلغ المعتاد', end: moneyEl(s.state.amount), chevron: true, onClick: () => amountSheet({ title: 'مرتب الدولة', sub: 'يتعبّى وحده لما تسجّله، وتقدر تغيّره.', value: s.state.amount, onSave: (v) => v && set({ state: { amount: v } }) }) }) : null,
    ]),
    group('الرصيد الافتتاحي', [
      row({ lead: { icon: 'wallet', tone: 'accent' }, title: 'المبلغ اللي كان معاك', end: moneyEl(s.opening), chevron: true, onClick: () => amountSheet({ title: 'الرصيد الافتتاحي', sub: 'كم كان معاك لما بديت تستعمل التطبيق.', value: s.opening, onSave: (v) => set({ opening: v }) }) }),
      (() => {
        const r = row({ lead: { icon: 'calendar-days', tone: 'muted' }, title: 'من تاريخ', end: h('b', fmtDate(s.openingDate)), chevron: true });
        dateOverlay(r, { value: s.openingDate, max: today(), onChange: (v) => set({ openingDate: v }) });
        return r;
      })(),
    ]),
    h('p.sal-hint', icon('info', { size: 16 }), 'الحركات اللي قبل تاريخ الرصيد الافتتاحي تنحفظ في السجل بس ما تأثرش على رصيدك.'),
  ];
}

/* ------------------------------------------------------------ data */

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function shareOrDownload(name, blob, type) {
  const file = new File([blob], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  download(name, blob);
}

function exportJson() {
  const payload = { app: 'masroufi', version: 1, exportedAt: new Date().toISOString(), records: store.exportAll() };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  return shareOrDownload(`masroufi-${today()}.json`, blob, 'application/json');
}

function exportCsv() {
  const data = store.data();
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['التاريخ', 'النوع', 'البند', 'المبلغ (د.ل)', 'ملاحظة']];
  const sorted = data.txn.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const t of sorted) {
    const sign = t.type === 'expense' ? -1 : 1;
    rows.push([t.date, (TXN_TYPES[t.type] || {}).label || t.type, t.cat ? category(data, t.cat).name : '', (fromMilli(t.amount) * sign).toFixed(3), t.note || '']);
  }
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return shareOrDownload(`masroufi-${today()}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'text/csv');
}

function importJson() {
  const inp = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  document.body.appendChild(inp);
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0];
    inp.remove();
    if (!f) return;
    let payload;
    try {
      payload = JSON.parse(await f.text());
    } catch {
      toast('الملف هذا مش نسخة احتياطية صالحة', { tone: 'neg' });
      return;
    }
    const recs = Array.isArray(payload) ? payload : payload && payload.records;
    if (!Array.isArray(recs) || !recs.every((r) => r && typeof r.id === 'string' && typeof r.col === 'string')) {
      toast('الملف هذا مش نسخة احتياطية من مصروفي', { tone: 'neg' });
      return;
    }
    const ok = await confirm({ title: 'تسترجع النسخة؟', body: `فيها ${fmtPlain(recs.filter((r) => !r.d).length)} سجل. تستبدل كل البيانات اللي على هالجهاز${auth.current() ? ' وفي حسابك' : ''}.`, ok: 'استرجع', danger: true, icon: 'upload' });
    if (!ok) return;
    await store.importAll(recs);
    await sync.resetCursor();
    sync.syncNow();
    toast('تم استرجاع النسخة ✓', { tone: 'pos' });
  });
  inp.click();
}

async function wipeAll() {
  const ok1 = await confirm({ title: 'تمسح كل البيانات؟', body: 'كل المصاريف والديون والمرتبات تنمسح. ما تقدرش ترجعها إلا من نسخة احتياطية.', ok: 'كمّل', danger: true, icon: 'trash-2' });
  if (!ok1) return;
  const ok2 = await confirm({ title: 'متأكد 100%؟', body: auth.current() ? 'إنت مسجّل دخول — تنمسح من حسابك ومن كل أجهزتك كمان.' : 'آخر فرصة.', ok: 'امسح كل شي', danger: true });
  if (!ok2) return;
  // Deletions are recorded (not just dropped locally) so they also sync to the
  // account; seeded records (settings, default categories) go back to defaults.
  const seeds = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
  store.batch(() => {
    for (const r of store.exportAll()) {
      if (r.d) continue;
      if (r.id === 'settings') store.put('settings', defaultSettings(today()));
      else if (seeds.has(r.id)) store.put('cat', { ...seeds.get(r.id) });
      else store.remove(r.id);
    }
  });
  if (auth.current()) await sync.syncNow().catch(() => {});
  go('/welcome', { replace: true });
  toast('تم مسح كل البيانات');
}

function dataSection() {
  const c = store.counts();
  return [
    card(h('div.set-counts',
      h('div', h('b', fmtPlain((c.txn || 0))), h('small', 'حركة')),
      h('div', h('b', fmtPlain((c.debt || 0))), h('small', 'دين')),
      h('div', h('b', fmtPlain((c.person || 0))), h('small', 'شخص')),
      h('div', h('b', fmtPlain((c.goal || 0))), h('small', 'هدف')))),
    group('نسخة احتياطية', [
      row({ lead: { icon: 'download', tone: 'accent' }, title: 'حفظ نسخة احتياطية', sub: 'ملف فيه كل بياناتك', chevron: true, onClick: () => exportJson() }),
      row({ lead: { icon: 'upload', tone: 'info' }, title: 'استرجاع من نسخة', sub: 'يستبدل البيانات الحالية', chevron: true, onClick: () => importJson() }),
    ]),
    group('تصدير', [
      row({ lead: { icon: 'file-spreadsheet', tone: 'pos' }, title: 'تصدير لإكسل (CSV)', sub: 'كل المصاريف والدخل', chevron: true, onClick: () => exportCsv() }),
    ]),
    group('منطقة خطر', [
      row({ lead: { icon: 'trash-2', tone: 'neg' }, title: 'مسح كل البيانات', chevron: true, onClick: () => wipeAll() }),
    ]),
  ];
}

/* ------------------------------------------------------------ about */

function about() {
  const ver = h('small');
  if (window.caches) caches.keys().then((ks) => { const k = ks.find((x) => x.startsWith('masroufi-')); ver.textContent = k ? `نسخة ${k.slice(9, 16)}` : 'نسخة 1'; }).catch(() => { ver.textContent = 'نسخة 1'; });
  else ver.textContent = 'نسخة 1';
  return [
    h('div.set-about',
      h('div.boot-logo.set-about-logo', icon('wallet', { size: 40 })),
      h('b', 'مصروفي'),
      ver,
      h('p', 'مصاريفك، ديونك، ومرتباتك… كلها في مكان واحد.')),
    group('الخصوصية', [
      row({ lead: { icon: 'shield-check', tone: 'pos' }, title: 'بياناتك ليك بس', sub: 'تتحفظ على جهازك، ولو سجّلت دخول تتحفظ في حسابك على سيرفر الموقع. ما فيش إعلانات ولا تتبّع.' }),
    ]),
    group('شكر', [
      row({ lead: { icon: 'sparkles', tone: 'info' }, title: 'الأيقونات', sub: 'Lucide — رخصة ISC' }),
      row({ lead: { icon: 'type', tone: 'info' }, title: 'الخط', sub: 'IBM Plex Sans Arabic — رخصة OFL' }),
    ]),
  ];
}
