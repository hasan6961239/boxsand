// Debt forms: add/edit a debt (either direction), record a payment, add/edit
// a person — plus the WhatsApp / call helpers used by the debt screens.

import { h } from '../ui/dom.js';
import { sheet, segmented, button, iconButton, toast, confirm, field, input, chips, toggle, haptic, confetti } from '../ui/kit.js';
import { amountPad } from '../ui/keypad.js';
import { dateChips, colorPicker, dateOverlay } from '../ui/pickers.js';
import * as store from '../core/store.js';
import { today, addDays, fmtMoney, fmtDate, intlPhone, latinDigits } from '../core/util.js';
import { debtInfo, paysByDebt } from '../core/finance.js';
import { SWATCHES } from '../core/defaults.js';
import { go, current } from '../core/router.js';

const DIR = {
  in: { label: 'سلّفت حد', short: 'ليّ', hint: 'فلوس ليك عند حد', cash: 'سلّمته الفلوس كاش؟', cashHint: 'تنقص من رصيدك توة، وترجع لما يسدّد.' },
  out: { label: 'استلفت من حد', short: 'عليّ', hint: 'فلوس عليك لحد', cash: 'استلمت الفلوس كاش؟', cashHint: 'تزيد على رصيدك توة، وتنقص لما تسدّد. لو شريت حاجة بالدين قفلها.' },
};

function peopleByRecent() {
  const d = store.data();
  const last = new Map();
  for (const x of d.debt) if (!last.has(x.person) || last.get(x.person) < x.date) last.set(x.person, x.date);
  return d.person.slice().sort((a, b) => (last.get(b.id) || '').localeCompare(last.get(a.id) || '') || a.name.localeCompare(b.name, 'ar'));
}

const nextColor = () => SWATCHES[store.data().person.length % SWATCHES.length];

/* ----------------------------------------------------------- person */

/** Add / edit a person. Resolves with the person id (or null when dismissed). */
export function openPersonSheet({ id, preset = {} } = {}) {
  const p = id ? store.get(id) : null;
  const st = { name: p ? p.name : preset.name || '', phone: p ? p.phone || '' : '', color: p ? p.color || SWATCHES[0] : nextColor() };
  const err = h('p.form-err');
  const api = sheet({
    title: p ? 'تعديل الشخص' : 'شخص جديد',
    body: () => h('div.stack',
      field('الاسم', input({ value: st.name, placeholder: 'مثلاً: أحمد', maxlength: 40, autofocus: !p, onInput: (v) => { st.name = v; err.textContent = ''; } })),
      field('رقم الهاتف', input({ value: st.phone, type: 'tel', inputmode: 'tel', placeholder: '09xxxxxxxx', maxlength: 20, autocomplete: 'tel', onInput: (v) => { st.phone = v; } }), { hint: 'عشان تذكّره بواتساب أو تتصل بيه.' }),
      field('اللون', colorPicker({ value: st.color, onChange: (c) => { st.color = c; } })),
      err),
    footer: (a) => h('div.sheet-foot-row',
      p ? iconButton('trash-2', { label: 'حذف', variant: 'soft', cls: 'btn-text-neg foot-icon', onClick: () => deletePerson(p, a) }) : null,
      button({
        label: 'حفظ', size: 'lg', block: true,
        onClick: () => {
          const name = st.name.trim();
          if (!name) { err.textContent = 'اكتب الاسم'; return; }
          const rec = store.put('person', { ...(p || {}), name, phone: latinDigits(st.phone).trim() || undefined, color: st.color });
          haptic(10);
          a.close(rec.id);
          toast(p ? 'تم الحفظ' : `تمت إضافة ${name}`, { tone: 'pos' });
        },
      })),
  });
  return api.result.then((v) => v || null);
}

async function deletePerson(p, a) {
  const d = store.data();
  const debts = d.debt.filter((x) => x.person === p.id);
  const ok = await confirm({
    title: `تحذف ${p.name}؟`,
    body: debts.length ? `ينحذف معاه ${debts.length} دين وكل الدفعات متاعهم، ويتعدّل رصيدك على هالأساس.` : 'ما عنده أي ديون مسجّلة.',
    ok: 'حذف', danger: true, icon: 'trash-2',
  });
  if (!ok) return;
  const ids = new Set(debts.map((x) => x.id));
  const snap = [p, ...debts, ...d.pay.filter((x) => ids.has(x.debt))].map((r) => ({ ...r }));
  store.batch(() => snap.forEach((r) => store.remove(r.id)));
  a.close();
  if (current() && current().path === `/person/${p.id}`) go('/debts', { replace: true });
  toast(`تم حذف ${p.name}`, { action: { label: 'تراجع', onClick: () => store.batch(() => snap.forEach((r) => store.restore(r))) } });
}

/* ------------------------------------------------------------- debt */

/** Add / edit a debt. dir: 'in' (they owe me) | 'out' (I owe). */
export function openDebtSheet({ dir = 'in', person, id } = {}) {
  const existing = id ? store.get(id) : null;
  const t = today();
  const st = {
    dir: existing ? existing.dir : dir,
    person: existing ? existing.person : person || null,
    newName: '',
    newPhone: '',
    amount: existing ? existing.amount : 0,
    date: existing ? existing.date : t,
    due: existing ? existing.due || null : null,
    note: existing ? existing.note || '' : '',
    cash: existing ? Boolean(existing.cash) : true,
  };
  const people = peopleByRecent();
  if (!st.person && !people.length) st.person = '__new';

  const pad = amountPad({ value: st.amount, tone: st.dir === 'in' ? 'neg' : 'pos', quick: [], onChange: (m) => { st.amount = m; save.disabled = !m; } });
  const err = h('p.form-err');
  const body = h('div.txn-form');
  const save = button({ label: existing ? 'حفظ التعديل' : 'حفظ', size: 'lg', block: true, onClick: () => submit() });
  save.disabled = !st.amount;

  const dueOptions = () => [{ value: null, label: 'بدون موعد' }, { value: addDays(st.date, 7), label: 'بعد أسبوع' }, { value: addDays(st.date, 30), label: 'بعد شهر' }];

  function render() {
    const dirSeg = !existing ? segmented({
      options: [{ value: 'in', label: DIR.in.label }, { value: 'out', label: DIR.out.label }],
      value: st.dir,
      onChange: (v) => { st.dir = v; pad.setTone(v === 'in' ? 'neg' : 'pos'); render(); },
    }) : null;

    const personChips = chips({
      scroll: true,
      options: [
        ...people.map((p) => ({ value: p.id, label: p.name, color: p.color })),
        { value: '__new', label: 'شخص جديد', icon: 'user-plus' },
      ],
      value: st.person,
      onChange: (v) => { st.person = v; err.textContent = ''; render(); },
    });
    const newFields = st.person === '__new' ? h('div.debt-newperson',
      input({ value: st.newName, placeholder: 'الاسم', maxlength: 40, onInput: (v) => { st.newName = v; err.textContent = ''; } }),
      input({ value: st.newPhone, type: 'tel', inputmode: 'tel', placeholder: 'رقم الهاتف (اختياري)', maxlength: 20, onInput: (v) => { st.newPhone = v; } })) : null;

    const dueSel = dueOptions();
    const customDue = st.due && !dueSel.some((o) => o.value === st.due);
    const dueChips = chips({
      scroll: true,
      options: [...dueSel, { value: '__pick', label: customDue ? fmtDate(st.due) : 'تاريخ…', icon: 'calendar' }],
      value: customDue ? '__pick' : st.due,
      onChange: (v) => { if (v !== '__pick') st.due = v; },
    });
    dateOverlay(dueChips.lastElementChild, { value: st.due || addDays(st.date, 14), min: st.date, onChange: (v) => { st.due = v; render(); } });
    const dueField = h('div.stack-sm', dueChips);

    body.replaceChildren(
      dirSeg || h('p.debt-dirnote', { class: st.dir === 'in' ? 'tone-pos' : 'tone-neg' }, st.dir === 'in' ? 'دين ليك عند حد' : 'دين عليك لحد'),
      field(st.dir === 'in' ? 'لمين سلّفت؟' : 'من مين استلفت؟', h('div.stack-sm', personChips, newFields)),
      field('تاريخ الدين', dateChips({ value: st.date, onChange: (d) => { st.date = d; } })),
      field('موعد السداد', dueField, { hint: st.dir === 'in' ? 'نذكّرك يوم قبل الموعد ويوم الموعد.' : 'نذكّرك قبل ما يجي موعد السداد.' }),
      h('div.toggle-row', h('div', h('b', DIR[st.dir].cash), h('small', DIR[st.dir].cashHint)), toggle({ checked: st.cash, label: DIR[st.dir].cash, onChange: (v) => { st.cash = v; } })),
      field('ملاحظة', input({ value: st.note, placeholder: 'اختياري — مثلاً: سلفة للسيارة', maxlength: 120, onInput: (v) => { st.note = v; } })),
      err);
  }

  function submit() {
    if (!st.amount) return;
    let personId = st.person;
    if (!personId || personId === '__new') {
      const name = st.newName.trim();
      if (!name) { err.textContent = 'اختار الشخص أو اكتب اسمه'; return; }
      personId = store.put('person', { name, phone: latinDigits(st.newPhone).trim() || undefined, color: nextColor() }).id;
    }
    if (st.due && st.due < st.date) { err.textContent = 'موعد السداد لازم يكون بعد تاريخ الدين'; return; }
    if (existing) {
      const paid = debtInfo(existing, paysByDebt(store.data()).get(existing.id) || [], today()).paid;
      if (st.amount < paid) { err.textContent = `سدّد ${fmtMoney(paid)} قبل — المبلغ ما يقدرش يكون أقل من هكي`; return; }
    }
    const rec = store.put('debt', { ...(existing || {}), person: personId, dir: st.dir, amount: st.amount, date: st.date, due: st.due || undefined, note: st.note.trim() || undefined, cash: st.cash });
    haptic(12);
    api.close(rec);
    const name = (store.get(personId) || {}).name || '';
    toast(existing ? 'تم حفظ التعديل' : st.dir === 'in' ? `سجّلنا ${fmtMoney(st.amount)} ليك عند ${name}` : `سجّلنا ${fmtMoney(st.amount)} عليك لـ${name}`, {
      tone: 'pos',
      action: existing ? undefined : { label: 'تراجع', onClick: () => store.remove(rec.id) },
    });
  }

  const api = sheet({
    title: existing ? 'تعديل الدين' : 'دين جديد',
    full: true,
    cls: 'txn-sheet',
    body: () => h('div.txn-top', pad.display, body),
    footer: () => h('div.txn-foot', pad.pad, h('div.sheet-foot-row',
      existing ? iconButton('trash-2', { label: 'حذف الدين', variant: 'soft', cls: 'btn-text-neg foot-icon', onClick: () => deleteDebt(existing, api) }) : null,
      save)),
    onClose: () => pad.destroy(),
  });
  render();
  return api;
}

export async function deleteDebt(debt, a) {
  const d = store.data();
  const pays = d.pay.filter((p) => p.debt === debt.id);
  const person = store.get(debt.person);
  const ok = await confirm({
    title: 'تحذف الدين هذا؟',
    body: `${fmtMoney(debt.amount)} ${debt.dir === 'in' ? 'عند' : 'لـ'}${person ? person.name : ''}${pays.length ? ` — وينحذفوا معاه ${pays.length} دفعة` : ''}.`,
    ok: 'حذف', danger: true, icon: 'trash-2',
  });
  if (!ok) return false;
  const snap = [debt, ...pays].map((r) => ({ ...store.get(r.id) }));
  store.batch(() => snap.forEach((r) => store.remove(r.id)));
  if (a) a.close();
  toast('تم حذف الدين', { action: { label: 'تراجع', onClick: () => store.batch(() => snap.forEach((r) => store.restore(r))) } });
  return true;
}

/* -------------------------------------------------------------- pay */

/** Record (or edit, with {id}) a payment against a debt. */
export function openPaySheet(debtId, { id } = {}) {
  const debt = store.get(debtId);
  if (!debt) return null;
  const existing = id ? store.get(id) : null;
  const t = today();
  const info = debtInfo(debt, paysByDebt(store.data()).get(debt.id) || [], t);
  const max = info.remaining + (existing ? existing.amount : 0);
  const person = store.get(debt.person);
  const name = person ? person.name : 'شخص';
  const st = { amount: existing ? existing.amount : info.remaining, date: existing ? existing.date : t, note: existing ? existing.note || '' : '' };

  const hint = h('p.pay-hint');
  const pad = amountPad({ value: st.amount, tone: debt.dir === 'in' ? 'pos' : 'neg', quick: [], onChange: (m) => { st.amount = m; check(); } });
  const save = button({ label: existing ? 'حفظ التعديل' : 'سجّل الدفعة', size: 'lg', block: true, onClick: () => submit() });
  function check() {
    const over = st.amount > max;
    save.disabled = !st.amount || over;
    hint.className = 'pay-hint' + (over ? ' tone-neg' : '');
    hint.textContent = over ? `أكثر من الباقي (${fmtMoney(max)})` : st.amount === max ? 'يخلص الدين كامل ✨' : `يبقى ${fmtMoney(max - st.amount)}`;
  }

  const api = sheet({
    title: debt.dir === 'in' ? `${name} رجّعلك` : `سداد لـ${name}`,
    sub: `الدين ${fmtMoney(debt.amount)} · الباقي ${fmtMoney(max)}`,
    full: true,
    cls: 'txn-sheet',
    body: () => h('div.txn-top',
      pad.display,
      hint,
      h('div.txn-form',
        chips({ options: [{ value: 'all', label: 'الباقي كامل' }, { value: 'half', label: 'النص' }], value: null, onChange: (v) => { pad.set(v === 'all' ? max : Math.round(max / 2)); } }),
        field('التاريخ', dateChips({ value: st.date, onChange: (d) => { st.date = d; } })),
        field('ملاحظة', input({ value: st.note, placeholder: 'اختياري', maxlength: 120, onInput: (v) => { st.note = v; } })))),
    footer: () => h('div.txn-foot', pad.pad, h('div.sheet-foot-row',
      existing ? iconButton('trash-2', { label: 'حذف الدفعة', variant: 'soft', cls: 'btn-text-neg foot-icon', onClick: () => deletePay(existing, api) }) : null,
      save)),
    onClose: () => pad.destroy(),
  });
  check();

  function submit() {
    if (!st.amount || st.amount > max) return;
    const rec = store.put('pay', { ...(existing || {}), debt: debt.id, amount: st.amount, date: st.date, note: st.note.trim() || undefined });
    haptic(12);
    api.close(rec);
    const after = debtInfo(debt, paysByDebt(store.data()).get(debt.id) || [], today());
    if (after.settled && !existing) {
      confetti();
      toast(debt.dir === 'in' ? `خلص الدين 🎉 ${name} رجّع كل شي` : 'خلص الدين 🎉 ما عادش عليك شي', { tone: 'pos', action: { label: 'تراجع', onClick: () => store.remove(rec.id) } });
    } else {
      toast(existing ? 'تم حفظ التعديل' : `تم تسجيل ${fmtMoney(st.amount)} · يبقى ${fmtMoney(after.remaining)}`, { tone: 'pos', action: existing ? undefined : { label: 'تراجع', onClick: () => store.remove(rec.id) } });
    }
  }
  return api;
}

async function deletePay(p, a) {
  const ok = await confirm({ title: 'تحذف الدفعة؟', body: `${fmtMoney(p.amount)} — ${fmtDate(p.date)}`, ok: 'حذف', danger: true, icon: 'trash-2' });
  if (!ok) return;
  const snap = { ...p };
  store.remove(p.id);
  a.close();
  toast('تم حذف الدفعة', { action: { label: 'تراجع', onClick: () => store.restore(snap) } });
}

/* ---------------------------------------------------------- contact */

/** Friendly reminder text for a debt someone owes me. */
export function reminderText(info, person, today_ = today()) {
  const name = person ? person.name : '';
  const amt = fmtMoney(info.remaining).replace(/[⁦⁩]/g, '');
  const due = info.debt.due ? (info.overdue ? `، الموعد كان ${fmtDate(info.debt.due, 'short', today_)}` : `، الموعد ${fmtDate(info.debt.due, 'relative', today_)}`) : '';
  return `السلام عليكم ${name}، كيفك؟ 🌷\nبس تذكير بسيط بخصوص ${amt} اللي عندك${due}.\nربي يسهّل عليك 🙏`;
}

/** Open WhatsApp with a prefilled message, or fall back to sharing / adding a phone. */
export async function whatsapp(person, text) {
  const phone = person && intlPhone(person.phone);
  if (phone) {
    const a = h('a', { href: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch { /* cancelled */ }
  }
  const add = await confirm({ title: 'ما فيش رقم', body: `ضيف رقم ${person ? person.name : 'الشخص'} عشان تبعتله على واتساب.`, ok: 'ضيف الرقم', icon: 'phone' });
  if (add && person) openPersonSheet({ id: person.id });
}

export function call(person) {
  const phone = person && person.phone ? latinDigits(person.phone).replace(/[^\d+]/g, '') : '';
  if (!phone) {
    openPersonSheet({ id: person.id });
    return;
  }
  location.href = `tel:${phone}`;
}

