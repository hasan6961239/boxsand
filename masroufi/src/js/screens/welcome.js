// First run: a short intro, then a few questions that set the app up for the
// owner (name, cash on hand, office salary + payday, state salary, colors,
// optional account, notifications). Steps live inside this one page.

import { h, icon } from '../ui/dom.js';
import { button, iconButton, toggle, segmented, input, confetti, haptic, toast, busy, sheet } from '../ui/kit.js';
import { amountPad } from '../ui/keypad.js';
import * as store from '../core/store.js';
import * as auth from '../core/auth.js';
import * as sync from '../core/sync.js';
import * as push from '../core/push.js';
import { go } from '../core/router.js';
import { motion } from '../core/theme.js';
import { today, monthKey, addMonths, fmtMonth, fmtMoney, fmtPlain, fmtDate } from '../core/util.js';
import { payday } from '../core/finance.js';
import { ACCENTS } from '../core/defaults.js';
import { openLogin, openSignup } from './account-sheets.js';

let st = null;
let root = null;
let pad = null;

function fresh() {
  const s = store.settings();
  return {
    step: 0,
    name: s.name || '',
    opening: s.opening || 0,
    office: { on: s.office.on, amount: s.office.amount, day: s.office.day },
    received: null,
    state: { on: s.state.on, amount: s.state.amount },
    accent: s.look.accent,
    mode: s.look.mode,
  };
}

/* ------------------------------------------------------------ steps */

const accountAvailable = () => auth.isAvailable() !== false;

function steps() {
  const list = ['name', 'cash', 'office', 'state', 'look'];
  if (accountAvailable() && !auth.current()) list.push('account');
  list.push('notify');
  return list;
}

function askReceived() {
  const t = today();
  const pd = payday(monthKey(t), st.office.day);
  return st.office.on && t >= pd;
}

function stepView(key) {
  const t = today();
  switch (key) {
    case 'name':
      return {
        emoji: '👋', title: 'شن نناديك؟', sub: 'عشان نسلّم عليك كل ما تفتح التطبيق.',
        body: h('div.wel-field', input({ value: st.name, placeholder: 'اسمك', maxlength: 30, autocomplete: 'given-name', autofocus: true, enterkeyhint: 'next', onInput: (v) => { st.name = v; } })),
        next: 'التالي',
      };
    case 'cash': {
      if (pad) pad.destroy();
      pad = amountPad({ value: st.opening, tone: 'accent', quick: [50, 100, 500, 1000], onChange: (m) => { st.opening = m; } });
      return {
        emoji: '💵', title: 'كم معاك فلوس توة؟', sub: 'اللي في جيبك وفي البيت — نبدا الحساب منه. تقدر تعدّله بعدين.',
        body: h('div.wel-cash', pad.display, pad.pad),
        next: st.opening ? 'التالي' : 'التالي (صفر)',
      };
    }
    case 'office': {
      const thisKey = monthKey(t);
      return {
        emoji: '💼', title: 'مرتب المكتب', sub: 'سحوبات الدرج تنخصم منه وحدها يوم نزوله.',
        body: h('div.wel-office',
          h('div.toggle-row', h('div', h('b', 'عندي مرتب شهري من شغلي'), h('small', 'لو ما عندكش قفلها')), toggle({ checked: st.office.on, label: 'مرتب المكتب', onChange: (v) => { st.office.on = v; paint(0); } })),
          st.office.on ? [
            h('button.wel-amount.tap', { type: 'button', onclick: editOfficeAmount }, h('small', 'المرتب'), h('b', fmtMoney(st.office.amount)), icon('pencil', { size: 16 })),
            h('p.wel-label', 'ينزل يوم كم في الشهر؟'),
            h('div.rule-days', Array.from({ length: 31 }, (_, i) => i + 1).map((d) => h('button.rule-day.tap', {
              type: 'button', class: { on: d === st.office.day },
              onclick: () => { haptic(4); st.office.day = d; st.received = null; paint(0); },
            }, fmtPlain(d)))),
            askReceived() ? h('div.wel-received',
              h('p.wel-label', `مرتب ${fmtMonth(thisKey)} (يوم ${fmtDate(payday(thisKey, st.office.day))}) استلمته؟`),
              segmented({ options: [{ value: true, label: 'إيه استلمته' }, { value: false, label: 'لسه' }], value: st.received, onChange: (v) => { st.received = v; } })) : null,
          ] : null),
        next: 'التالي',
        valid: () => !st.office.on || !askReceived() || st.received !== null || 'قولنا استلمت مرتب هالشهر ولا لا',
      };
    }
    case 'state':
      return {
        emoji: '🏛️', title: 'مرتب الدولة', sub: 'ينزل في أيام مختلفة — تسجّله بضغطة لما يوصل.',
        body: h('div.wel-office',
          h('div.toggle-row', h('div', h('b', 'عندي مرتب من الدولة'), h('small', 'معاش، منحة، أو مرتب حكومي')), toggle({ checked: st.state.on, label: 'مرتب الدولة', onChange: (v) => { st.state.on = v; paint(0); } })),
          st.state.on ? h('button.wel-amount.tap', { type: 'button', onclick: editStateAmount }, h('small', 'المبلغ المعتاد'), h('b', fmtMoney(st.state.amount)), icon('pencil', { size: 16 })) : null),
        next: 'التالي',
      };
    case 'look':
      return {
        emoji: '🎨', title: 'اختار ألوانك', sub: 'تقدر تغيّرها وقت ما تبي من الإعدادات.',
        body: h('div.wel-look',
          segmented({
            options: [{ value: 'auto', label: 'تلقائي', icon: 'sun-moon' }, { value: 'light', label: 'فاتح', icon: 'sun' }, { value: 'dark', label: 'داكن', icon: 'moon' }],
            value: st.mode,
            onChange: (v) => { st.mode = v; applyLook(); },
          }),
          h('div.accent-grid', Object.entries(ACCENTS).map(([k, a]) => h('button.accent.tap', {
            type: 'button', class: { on: k === st.accent }, style: { '--a': a.a, '--b': a.b },
            onclick: (e) => {
              haptic(6);
              st.accent = k;
              applyLook();
              e.currentTarget.parentElement.querySelectorAll('.accent').forEach((b) => {
                const on = b === e.currentTarget;
                b.classList.toggle('on', on);
                b.firstChild.replaceChildren(on ? icon('check', { size: 18, stroke: 3 }) : '');
              });
            },
          }, h('span.accent-dot', k === st.accent ? icon('check', { size: 18, stroke: 3 }) : null), h('small', a.name))))),
        next: 'التالي',
      };
    case 'account':
      return {
        emoji: '☁️', title: 'تبي تزامن بين أجهزتك؟', sub: 'لو عملت حساب، بياناتك تتحفظ فيه وتلقاها في أي جهاز، وتوصلك التذكيرات والتطبيق مقفول.',
        body: h('div.wel-account',
          button({ label: 'أعمل حساب جديد', icon: 'user-plus', size: 'lg', block: true, onClick: () => openSignup().result.then((u) => { if (u) paint(1); }) }),
          button({ label: 'عندي حساب — دخول', icon: 'log-in', variant: 'ghost', size: 'lg', block: true, onClick: () => loginFlow() }),
          h('p.faint.small.center', 'تقدر تسويها بعدين من الإعدادات.')),
        next: 'بعدين',
        nextVariant: 'plain',
      };
    case 'notify': {
      const can = push.isStandalone() && push.supported();
      const ios = push.isIOS() && !push.isStandalone();
      return {
        emoji: '🔔', title: 'التذكيرات', sub: 'نذكّرك تسجّل مصاريفك، وبيوم المرتب، ومواعيد الديون، ولما تقرب تخلص الميزانية.',
        body: h('div.wel-account',
          can && auth.current()
            ? button({
              label: 'فعّل الإشعارات', icon: 'bell-ring', size: 'lg', block: true,
              onClick: (e) => busy(e.currentTarget, async () => {
                try {
                  await push.enable();
                  toast('تمام! الإشعارات شغالة 🔔', { tone: 'pos' });
                } catch (err) {
                  toast(push.errorText(err), { tone: String(err && err.message) === 'retry' ? 'default' : 'warn', duration: 5000 });
                }
              }),
            })
            : h('div.note-box.tone-info', icon('info', { size: 18 }), h('span',
              ios ? 'على الآيفون الإشعارات تخدم بعد ما تضيف التطبيق للشاشة الرئيسية: زر المشاركة ← «إضافة إلى الشاشة الرئيسية». وبعدها فعّلها من الإعدادات.'
                : !auth.current() && accountAvailable() ? 'التذكيرات تحتاج حساب لأنها تتبعث من السيرفر. تقدر تفعّلها بعدين من الإعدادات.'
                  : 'تقدر تفعّلها بعدين من الإعدادات ← الإشعارات.'))),
        next: 'يلا نبدأ 🎉',
        finish: true,
      };
    }
    default:
      return null;
  }
}

function editOfficeAmount() {
  amountSheet('مرتب المكتب', st.office.amount, (v) => { st.office.amount = v; paint(0); });
}
function editStateAmount() {
  amountSheet('مرتب الدولة', st.state.amount, (v) => { st.state.amount = v; paint(0); });
}

function amountSheet(title, value, onSave) {
  let v = value;
  const p = amountPad({ value, tone: 'accent', quick: [], onChange: (m) => { v = m; } });
  sheet({
    title,
    body: () => h('div.stack', p.display, p.pad),
    footer: (a) => button({ label: 'تمام', size: 'lg', block: true, onClick: () => { if (v) onSave(v); a.close(); } }),
    onClose: () => p.destroy(),
  });
}

function applyLook() {
  store.setSettings({ look: { accent: st.accent, mode: st.mode } });
}

async function loginFlow() {
  const user = await openLogin().result;
  if (!user) return;
  await sync.syncNow();
  if (store.settings().onboarded) {
    go('/', { replace: true });
    return;
  }
  const keep = st.step;
  st = { ...fresh(), step: Math.max(1, keep) };
  paint(1);
}

function finish() {
  const t = today();
  const thisKey = monthKey(t);
  const since = askReceived() && st.received ? addMonths(thisKey, 1) : thisKey;
  store.setSettings({
    name: st.name.trim(),
    opening: st.opening,
    openingDate: t,
    office: { on: st.office.on, amount: st.office.amount, day: st.office.day, since },
    state: { on: st.state.on, amount: st.state.amount },
    look: { accent: st.accent, mode: st.mode },
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Tripoli',
    onboarded: true,
  });
  if (pad) pad.destroy();
  confetti();
  haptic(20);
  st = null;
  go('/', { replace: true });
  setTimeout(() => toast('كل شي جاهز! سجّل أول مصروف من زر + 👇', { tone: 'pos', duration: 4000 }), 500);
}

/* ------------------------------------------------------------ painting */

function intro() {
  return h('div.wel-intro',
    h('div.wel-intro-art',
      h('div.wel-orb.o1'), h('div.wel-orb.o2'),
      h('div.wel-logo', icon('wallet', { size: 52 }))),
    h('h1', 'مصروفي'),
    h('p.wel-tag', 'مصاريفك، ديونك، ومرتباتك… كلها في مكان واحد'),
    h('ul.wel-features',
      h('li', h('span.tone-accent', icon('receipt-text', { size: 20 })), h('div', h('b', 'سجّل مصاريفك بثواني'), h('small', 'ونعرفك وين تمشي فلوسك كل شهر'))),
      h('li', h('span.tone-warn', icon('hand-coins', { size: 20 })), h('div', h('b', 'المرتب وسحوبات الدرج'), h('small', 'نحسبلك الصافي يوم 20 وحدنا'))),
      h('li', h('span.tone-info', icon('handshake', { size: 20 })), h('div', h('b', 'الديون اللي ليك واللي عليك'), h('small', 'بالدفعات والمواعيد وتذكير بواتساب')))),
    h('div.wel-actions',
      button({ label: 'يلا نبدأ', icon: 'chevron-left', size: 'lg', block: true, onClick: () => { st.step = 1; paint(1); } }),
      accountAvailable() ? button({ label: 'عندي حساب', variant: 'plain', block: true, onClick: () => loginFlow() }) : null));
}

function wizard() {
  const list = steps();
  const idx = Math.min(st.step - 1, list.length - 1);
  const key = list[idx];
  const v = stepView(key);
  const err = h('p.form-err');
  const next = () => {
    if (v.valid) {
      const ok = v.valid();
      if (ok !== true) { err.textContent = ok; return; }
    }
    if (v.finish) { finish(); return; }
    st.step += 1;
    paint(1);
  };
  return h('div.wel-step',
    h('div.wel-top',
      iconButton('chevron-right', { label: 'رجوع', onClick: () => { st.step -= 1; paint(-1); } }),
      h('div.wel-progress', h('span', { style: { width: `${((idx + 1) / list.length) * 100}%` } })),
      h('span.wel-count', `${fmtPlain(idx + 1)}/${fmtPlain(list.length)}`)),
    h('div.wel-scroll',
      h('div.wel-head', h('div.wel-emoji', v.emoji), h('h2', v.title), v.sub ? h('p', v.sub) : null),
      v.body,
      err),
    h('div.wel-actions', button({ label: v.next, variant: v.nextVariant || 'primary', size: 'lg', block: true, onClick: next })));
}

/** Repaint the current step. dir: 1 forward, -1 back, 0 in place. */
function paint(dir) {
  if (!root) return;
  const view = st.step === 0 ? intro() : wizard();
  if (dir && motion() === 'full') view.classList.add(dir > 0 ? 'wel-in-fwd' : 'wel-in-back');
  root.replaceChildren(view);
  const focus = view.querySelector('input[type=text], input:not([type])');
  if (focus && dir) setTimeout(() => focus.focus({ preventScroll: true }), 380);
}

export default {
  noTabbar: true,
  live: false,
  render() {
    if (!st) st = fresh();
    root = h('div.wel');
    paint(0);
    return [root];
  },
  onLeave() {
    if (pad) pad.destroy();
  },
};
