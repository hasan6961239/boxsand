// The assistant's view of the app data, and the code that turns its proposals
// into records. Pure (no store, no DOM) so it is shared with the tests.
//
// The model only *describes* records; every number the owner sees on a
// confirmation card (resulting balance, who owes whom) is computed here with
// the same finance.js functions the rest of the app uses.
//
// Amounts cross this boundary in dinars (what the model reads and writes) and
// are stored as integer milli-dinars like everything else.

import {
  balance, debtsOverview, personLedger, officeStatus, periodOf, periodTotals, spendByCategory, budgetStatus,
  categories, catMap, activity, defaultAdvanceCycle, salaryOf, deductionsOf, cycleForDate, payday, stateSalaryStats, debtInfo, paysByDebt,
} from './finance.js';
import { uid, fold, addMonths, diffDays, parseDate, latinDigits, sum, WEEKDAYS, fmtMonth } from './util.js';
import { SWATCHES, FALLBACK_CATEGORY } from './defaults.js';

const D = (m) => Math.round(m || 0) / 1000; // milli → dinars
const M = (d) => Math.round(Number(d) * 1000); // dinars → milli
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

function validDate(s) {
  if (!DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
const nameKey = (s) => fold(s).replace(/\s+/g, '');

const TYPE_AR = {
  expense: 'مصروف', income: 'دخل', advance: 'سحب من الدرج', salary: 'مرتب المكتب', state: 'مرتب الدولة',
  adjust: 'تعديل رصيد', carry: 'مرحّل', debt: 'دين', pay: 'دفعة دين', gtx: 'ادخار',
};

/* ------------------------------------------------------------ snapshot */

function openDebtsOf(p) {
  return p.debts.filter((i) => !i.settled).map((i) => ({
    id: i.debt.id,
    dir: i.debt.dir,
    amount: D(i.debt.amount),
    remaining: D(i.remaining),
    date: i.debt.date,
    ...(i.debt.due ? { due: i.debt.due } : {}),
    ...(i.debt.note ? { note: i.debt.note } : {}),
  }));
}

/** The last few debts/payments with a person, so "I paid X back" can be checked against what's recorded. */
function recentWith(data, personId, t) {
  return personLedger(data, personId, t).rows.slice(-4).map((r) => ({
    date: r.date,
    what: r.kind === 'debt' ? (r.rec.dir === 'in' ? 'lent to them' : 'borrowed from them') : (r.debt.dir === 'in' ? 'they paid back' : 'you paid back'),
    amount: D(r.rec.amount),
    ...(r.rec.note ? { note: r.rec.note } : {}),
  }));
}

function peopleList(data, t) {
  return debtsOverview(data, t).people.map((p) => ({
    id: p.person.id,
    name: p.person.name,
    they_owe_you: D(p.theyOwe),
    you_owe_them: D(p.iOweThem),
    open_debts: openDebtsOf(p),
    recent: recentWith(data, p.person.id, t),
  }));
}

function describe(i, cm) {
  const r = i.rec;
  const out = { date: i.date, type: i.kind === 'txn' ? r.type : i.kind, amount: D(Math.abs(r.amount)) };
  if (i.kind === 'txn' && r.cat) out.category = (cm.get(r.cat) || FALLBACK_CATEGORY).name;
  if (i.person) out.person = i.person.name;
  if (i.kind === 'debt') out.dir = r.dir;
  if (i.kind === 'pay' && i.debt) out.dir = i.debt.dir;
  if (r.note) out.note = r.note;
  return out;
}

function officeInfo(data, t) {
  const o = data.settings.office;
  if (!o || !o.on) return null;
  const off = officeStatus(data, t);
  return {
    salary: D(o.amount),
    payday_day: o.day,
    waiting_for: off && {
      cycle: off.key,
      payday: off.payday,
      days_left: off.daysLeft,
      drawer_withdrawals: D(off.advTotal),
      expected_net: D(off.expectedNet),
    },
  };
}

/** What the assistant knows at the start of a conversation. */
export function snapshot(data, t) {
  const s = data.settings;
  const cm = catMap(data);
  const p = periodOf(t, s);
  const tot = periodTotals(data, p);
  const st = stateSalaryStats(data, t);
  return {
    today: t,
    weekday: WEEKDAYS[parseDate(t).getDay()],
    currency: 'د.ل',
    owner_name: s.name || '',
    balance: D(balance(data)),
    office_salary: officeInfo(data, t),
    state_salary: s.state && s.state.on ? { amount: D(s.state.amount), last_received: st.last ? st.last.date : null } : null,
    people: peopleList(data, t).slice(0, 120),
    categories: {
      expense: categories(data, 'expense').map((c) => ({ id: c.id, name: c.name })),
      income: categories(data, 'income').map((c) => ({ id: c.id, name: c.name })),
    },
    this_budget_month: {
      from: p.start,
      to: p.end,
      spent: D(tot.expense),
      income: D(tot.income),
      top_categories: spendByCategory(data, p).list.slice(0, 6).map((e) => ({ category: e.cat.name, amount: D(e.amount) })),
    },
    recent: activity(data).filter((i) => i.rec.type !== 'carry').slice(0, 12).map((i) => describe(i, cm)),
  };
}

/** Names the speech-to-text should spell like the app does. */
export function hints(data) {
  return [
    ...data.person.map((p) => p.name),
    ...data.cat.filter((c) => !c.archived).map((c) => c.name),
  ].slice(0, 80);
}

/* ------------------------------------------------------------ queries */

const TXN_TYPES = new Set(['expense', 'income', 'advance', 'salary', 'state', 'adjust']);

export function runQuery(data, q, t) {
  const cm = catMap(data);
  switch (q.kind) {
    case 'debts': {
      const dv = debtsOverview(data, t);
      return {
        owed_to_you: D(dv.owedToMe),
        you_owe: D(dv.iOwe),
        people: peopleList(data, t).filter((p) => p.they_owe_you || p.you_owe_them || p.open_debts.length),
      };
    }
    case 'person': {
      const p = data.person.find((x) => x.id === q.person);
      if (!p) return { error: `no person with id "${q.person}"` };
      const led = personLedger(data, p.id, t);
      return {
        person: { id: p.id, name: p.name, ...(p.phone ? { phone: p.phone } : {}) },
        net: D(led.net),
        net_meaning: led.net > 0 ? 'they owe you' : led.net < 0 ? 'you owe them' : 'settled',
        statement: led.rows.map((r) => ({
          date: r.date,
          what: r.kind === 'debt' ? `debt ${r.rec.dir}` : `payment ${r.debt.dir}`,
          amount: D(r.rec.amount),
          running: D(r.running),
          ...(r.rec.note ? { note: r.rec.note } : {}),
        })),
        open_debts: led.infos.filter((i) => !i.settled).map((i) => ({ id: i.debt.id, dir: i.debt.dir, amount: D(i.debt.amount), remaining: D(i.remaining), date: i.debt.date })),
      };
    }
    case 'summary': {
      const p = periodOf(t, data.settings);
      const tot = periodTotals(data, p);
      const b = budgetStatus(data, p, t);
      return {
        balance: D(balance(data)),
        budget_month: { from: p.start, to: p.end },
        spent: D(tot.expense),
        income: D(tot.income),
        spend_by_category: spendByCategory(data, p).list.map((e) => ({ category: e.cat.name, amount: D(e.amount), count: e.count })),
        budget: b.total ? { limit: D(b.total.limit), spent: D(b.total.spent), left: D(b.total.left), daily_allowance: b.daily === null ? null : D(b.daily) } : null,
        office_salary: officeInfo(data, t),
      };
    }
    default: { // transactions
      const needle = q.search ? fold(q.search) : '';
      const types = q.type ? new Set([q.type]) : null;
      const items = activity(data, { from: q.from || undefined, to: q.to || undefined, types: types || undefined, cat: q.category || undefined })
        .filter((i) => i.rec.type !== 'carry' && i.kind !== 'gtx')
        .filter((i) => !needle || fold([i.rec.note, i.kind === 'txn' && i.rec.cat ? (cm.get(i.rec.cat) || {}).name : '', i.person && i.person.name].join(' ')).includes(needle));
      const typeOf = (i) => (i.kind === 'txn' ? i.rec.type : i.kind);
      const byType = {};
      for (const i of items) byType[typeOf(i)] = (byType[typeOf(i)] || 0) + Math.abs(i.rec.amount);
      const out = {
        count: items.length,
        totals_by_type: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, D(v)])),
      };
      if (q.type) out.total = D(sum(items, (i) => Math.abs(i.rec.amount)));
      const g = q.group_by && q.group_by !== 'none' ? q.group_by : null;
      if (g) {
        const groups = new Map();
        for (const i of items) {
          const key = g === 'category' ? (i.kind === 'txn' && i.rec.cat ? (cm.get(i.rec.cat) || FALLBACK_CATEGORY).name : TYPE_AR[typeOf(i)] || typeOf(i))
            : g === 'day' ? i.date : g === 'month' ? i.date.slice(0, 7) : typeOf(i);
          const e = groups.get(key) || { key, total: 0, count: 0 };
          e.total += Math.abs(i.rec.amount);
          e.count++;
          groups.set(key, e);
        }
        out.groups = [...groups.values()].sort((a, b) => b.total - a.total).slice(0, 60).map((e) => ({ ...e, total: D(e.total) }));
      }
      out.items = items.slice(0, 40).map((i) => describe(i, cm));
      if (items.length > 40) out.items_note = `showing the newest 40 of ${items.length}`;
      return out;
    }
  }
}

/* ------------------------------------------------------------ proposals */

/**
 * Validate the model's proposed actions and turn them into records, without
 * saving anything. Returns { ok, errors, ops:[{col, rec}], lines, effects }.
 * `ops` carry their final ids so applying them is just store.put for each.
 */
export function planActions(data, actions, t) {
  const errors = [];
  const ops = [];
  const lines = [];
  const refs = new Map(); // ref → { col, id }
  const sim = { ...data, txn: [...data.txn], person: [...data.person], debt: [...data.debt], pay: [...data.pay] };
  const touched = new Set();
  const cm = catMap(data);
  const personName = (id) => (sim.person.find((p) => p.id === id) || {}).name || '';

  const add = (col, rec) => {
    sim[col].push(rec);
    ops.push({ col, rec });
    return rec;
  };
  const resolve = (val, col) => {
    if (!val) return '';
    if (refs.has(val) && refs.get(val).col === col) return refs.get(val).id;
    return sim[col].some((r) => r.id === val) ? val : null;
  };

  (Array.isArray(actions) ? actions : []).forEach((a, n) => {
    const where = `action ${n + 1} (${a && a.kind})`;
    const fail = (msg) => errors.push(`${where}: ${msg}`);
    if (!a || typeof a !== 'object') return fail('not an object');
    const date = a.date ? latinDigits(a.date) : t;
    if (!validDate(date)) return fail(`bad date "${a.date}"`);
    const note = String(a.note || '').trim().slice(0, 120) || undefined;
    const amt = M(a.amount);
    if (a.kind !== 'new_person' && (!Number.isFinite(amt) || (a.kind === 'adjust' ? amt === 0 : amt <= 0))) return fail(`bad amount ${a.amount}`);
    if (Math.abs(amt) > 1e12) return fail('amount too large');

    switch (a.kind) {
      case 'expense':
      case 'income': {
        let cat = cm.get(a.category);
        if (!cat || cat.kind !== a.kind) cat = a.kind === 'expense' ? cm.get(FALLBACK_CATEGORY.id) || FALLBACK_CATEGORY : categories(data, 'income')[0];
        add('txn', { id: uid(), type: a.kind, amount: amt, date, note, cat: cat ? cat.id : undefined });
        lines.push({ kind: a.kind, emoji: cat ? cat.emoji : '💵', title: cat ? cat.name : TYPE_AR[a.kind], sub: note, date, effect: a.kind === 'expense' ? -amt : amt });
        return null;
      }
      case 'advance': {
        if (!data.settings.office || !data.settings.office.on) return fail('the office salary is turned off in settings, so there is no drawer');
        const cycle = defaultAdvanceCycle(sim, date);
        add('txn', { id: uid(), type: 'advance', amount: amt, date, note, cycle });
        lines.push({ kind: 'advance', icon: 'hand-coins', title: 'سحب من الدرج', sub: `ينخصم من مرتب ${fmtMonth(cycle)}${note ? ' · ' + note : ''}`, date, effect: amt });
        return null;
      }
      case 'office_salary': {
        const o = data.settings.office;
        if (!o || !o.on) return fail('the office salary is turned off in settings');
        const off = officeStatus(sim, date);
        const key = off ? off.key : cycleForDate(date, o.day);
        if (salaryOf(sim, key)) return fail(`the salary of ${key} is already recorded`);
        if (diffDays(date, payday(key, o.day)) > 10) {
          return fail(`the salary of ${addMonths(key, -1)} is already recorded and the next one (${key}) isn't due until ${payday(key, o.day)}`);
        }
        const ded = sum(deductionsOf(sim, key), (x) => x.amount);
        const net = Math.max(0, amt - ded);
        const carry = Math.max(0, ded - amt);
        add('txn', { id: uid(), type: 'salary', amount: net, gross: amt, ded, cycle: key, date, note });
        if (carry) add('txn', { id: `carry:${key}`, type: 'carry', amount: carry, cycle: addMonths(key, 1), date });
        lines.push({ kind: 'salary', icon: 'briefcase', title: `مرتب ${fmtMonth(key)}`, sub: ded ? `${D(amt)} − سحوبات ${D(ded)}` : note, date, effect: net });
        return null;
      }
      case 'state_salary': {
        const month = MONTH.test(a.month || '') ? a.month : undefined;
        add('txn', { id: uid(), type: 'state', amount: amt, date, note, month });
        lines.push({ kind: 'state', icon: 'landmark', title: 'مرتب الدولة', sub: month ? `مرتب ${fmtMonth(month)}` : note, date, effect: amt });
        return null;
      }
      case 'adjust': {
        add('txn', { id: uid(), type: 'adjust', amount: amt, date, note });
        lines.push({ kind: 'adjust', icon: 'sliders-horizontal', title: 'تعديل الرصيد', sub: note, date, effect: amt });
        return null;
      }
      case 'new_person': {
        const name = String(a.name || '').trim().slice(0, 40);
        if (!name) return fail('new_person needs a name');
        const same = sim.person.find((p) => nameKey(p.name) === nameKey(name));
        if (same) {
          if (a.ref) refs.set(a.ref, { col: 'person', id: same.id });
          return null; // already there — reuse instead of duplicating
        }
        const phone = latinDigits(a.phone || '').replace(/[^\d+]/g, '') || undefined;
        const rec = add('person', { id: uid(), name, phone, color: SWATCHES[sim.person.length % SWATCHES.length] });
        if (a.ref) refs.set(a.ref, { col: 'person', id: rec.id });
        lines.push({ kind: 'person', icon: 'user-plus', title: `شخص جديد: ${name}`, effect: 0 });
        return null;
      }
      case 'debt': {
        const person = resolve(a.person, 'person');
        if (!person) return fail(`unknown person "${a.person}" — use an id from app_data or add a new_person first`);
        if (a.dir !== 'in' && a.dir !== 'out') return fail('dir must be "in" or "out"');
        const due = a.due && validDate(latinDigits(a.due)) ? latinDigits(a.due) : undefined;
        const rec = add('debt', { id: uid(), person, dir: a.dir, amount: amt, date, due, note, cash: Boolean(a.cash) });
        if (a.ref) refs.set(a.ref, { col: 'debt', id: rec.id });
        touched.add(person);
        const name = personName(person);
        lines.push({
          kind: 'debt', icon: a.dir === 'in' ? 'arrow-up-right' : 'arrow-down-left',
          title: a.dir === 'in' ? `دين ليك عند ${name}` : `دين عليك لـ${name}`,
          sub: [a.cash ? (a.dir === 'in' ? 'طلعت فلوس من عندك' : 'دخلت فلوس لرصيدك') : 'تسجيل بس، ما تحرّكتش فلوس', note].filter(Boolean).join(' · '),
          date,
          effect: a.cash ? (a.dir === 'in' ? -amt : amt) : 0,
        });
        return null;
      }
      case 'payment': {
        let debtId = resolve(a.debt, 'debt');
        if (debtId === null) return fail(`unknown debt "${a.debt}"`);
        let person = a.person ? resolve(a.person, 'person') : '';
        if (person === null) return fail(`unknown person "${a.person}"`);
        const pi = paysByDebt(sim);
        const left = (d) => debtInfo(d, pi.get(d.id) || [], t).remaining;
        let debt;
        if (debtId) {
          debt = sim.debt.find((d) => d.id === debtId);
        } else {
          if (!person) return fail('give the debt id, or the person so the app can pick their oldest open debt');
          if (a.dir !== 'in' && a.dir !== 'out') return fail('dir must be "in" or "out"');
          debt = sim.debt.filter((d) => d.person === person && d.dir === a.dir && left(d) > 0).sort((x, y) => (x.date < y.date ? -1 : 1))[0];
          if (!debt) return fail(`${personName(person)} has no open "${a.dir}" debt — propose a debt instead`);
        }
        if (a.dir && debt.dir !== a.dir) return fail(`debt ${debt.id} is "${debt.dir}", not "${a.dir}"`);
        const remaining = left(debt);
        if (amt > remaining) return fail(`amount ${D(amt)} is more than the ${D(remaining)} left on debt ${debt.id}`);
        add('pay', { id: uid(), debt: debt.id, amount: amt, date, note });
        touched.add(debt.person);
        const name = personName(debt.person);
        lines.push({
          kind: 'pay', icon: debt.dir === 'in' ? 'arrow-down-left' : 'arrow-up-right',
          title: debt.dir === 'in' ? `${name} رجّعلك` : `دفعت لـ${name}`,
          sub: [amt === remaining ? 'يخلّص الدين' : `يبقى ${D(remaining - amt)}`, note].filter(Boolean).join(' · '),
          date,
          effect: debt.dir === 'in' ? amt : -amt,
        });
        return null;
      }
      default:
        return fail('unknown kind');
    }
  });

  if (!ops.length && !errors.length) errors.push('nothing to record');

  const before = debtsOverview(data, t).people;
  const after = debtsOverview(sim, t).people;
  const netOf = (list, id) => (list.find((p) => p.person.id === id) || { net: 0 }).net;
  return {
    ok: errors.length === 0,
    errors,
    ops,
    lines,
    effects: {
      balance: { before: balance(data), after: balance(sim) },
      people: [...touched].map((id) => ({ id, name: personName(id), before: netOf(before, id), after: netOf(after, id) })),
    },
  };
}

/** What the model hears back after the owner saved a proposal. */
export function appliedResult(plan) {
  return {
    status: 'applied',
    records: plan.ops.length,
    balance_now: D(plan.effects.balance.after),
    people_now: plan.effects.people.map((p) => ({
      name: p.name,
      they_owe_you: p.after > 0 ? D(p.after) : 0,
      you_owe_them: p.after < 0 ? D(-p.after) : 0,
    })),
  };
}

export { D as toDinars };
