// Development-only demo data (bundled only in `npm run dev`; open the app
// with ?seed=demo to wipe local data and fill ~3 months of realistic records).

import * as store from '../core/store.js';
import { today, addDays, addMonths, monthKey, dayInMonth } from '../core/util.js';

export async function seedDemo() {
  await store.wipe();
  const t = today();
  const r = (a, b) => Math.round((a + Math.random() * (b - a)) * 2) / 2;
  const startKey = addMonths(monthKey(t), -3);
  const opening = addDays(dayInMonth(startKey, 1), 0);
  store.batch(() => {
    store.setSettings({ name: 'حسن', onboarded: true, opening: 3200000, openingDate: opening, office: { since: startKey } });
    // salaries & advances
    for (let k = startKey; k <= monthKey(t); k = addMonths(k, 1)) {
      const pd = dayInMonth(k, 20);
      const adv = [];
      if (addDays(pd, -12) <= t) adv.push(store.put('txn', { type: 'advance', amount: 200000, date: addDays(pd, -12), cycle: k, note: 'من الدرج' }));
      if (addDays(pd, -5) <= t && k !== monthKey(t)) adv.push(store.put('txn', { type: 'advance', amount: 150000, date: addDays(pd, -5), cycle: k }));
      if (pd < t) {
        const ded = adv.reduce((a, x) => a + x.amount, 0);
        store.put('txn', { type: 'salary', amount: 2000000 - ded, gross: 2000000, ded, cycle: k, date: pd });
      }
    }
    // state salary, irregular
    store.put('txn', { type: 'state', amount: 650000, date: addDays(t, -64), month: addMonths(monthKey(t), -3) });
    store.put('txn', { type: 'state', amount: 650000, date: addDays(t, -27), month: addMonths(monthKey(t), -2) });
    // daily expenses
    const cats = [['cat:food', 8, 35, 0.7], ['cat:coffee', 2, 6, 0.9], ['cat:fuel', 15, 40, 0.25], ['cat:grocery', 20, 120, 0.3], ['cat:phone', 10, 30, 0.08], ['cat:fun', 15, 60, 0.1], ['cat:clothes', 60, 200, 0.03], ['cat:health', 10, 70, 0.04], ['cat:family', 50, 150, 0.06]];
    for (let d = opening; d <= t; d = addDays(d, 1)) {
      for (const [cat, a, b, p] of cats) {
        if (Math.random() < p) store.put('txn', { type: 'expense', amount: r(a, b) * 1000, cat, date: d, note: Math.random() < 0.2 ? 'مع الشباب' : undefined });
      }
    }
    // fixed expenses
    const rent = store.put('rule', { name: 'إيجار', amount: 500000, cat: 'cat:home', day: 1, active: true, start: startKey });
    store.put('rule', { name: 'اشتراك نت', amount: 45000, cat: 'cat:phone', day: 5, active: true, start: startKey });
    void rent;
    // people & debts
    const ahmed = store.put('person', { name: 'أحمد', phone: '0912345678', color: '#0EA5E9' });
    const salem = store.put('person', { name: 'سالم', phone: '0923456789', color: '#F97316' });
    const shop = store.put('person', { name: 'دكان الحاج', color: '#8B5CF6' });
    const d1 = store.put('debt', { person: ahmed.id, dir: 'in', amount: 300000, date: addDays(t, -20), due: addDays(t, 2), cash: true, note: 'سلفة' });
    store.put('pay', { debt: d1.id, amount: 100000, date: addDays(t, -6) });
    store.put('debt', { person: salem.id, dir: 'out', amount: 500000, date: addDays(t, -40), due: addDays(t, -3), cash: true, note: 'استلفتها للسيارة' });
    store.put('debt', { person: shop.id, dir: 'out', amount: 85000, date: addDays(t, -10), cash: false, note: 'حوايج بالدين' });
    const d4 = store.put('debt', { person: ahmed.id, dir: 'in', amount: 50000, date: addDays(t, -60), cash: true });
    store.put('pay', { debt: d4.id, amount: 50000, date: addDays(t, -45) });
    // goals
    const g = store.put('goal', { name: 'سيارة', emoji: '🚗', target: 15000000, color: '#0EA5E9', due: addDays(t, 365) });
    store.put('gtx', { goal: g.id, amount: 1200000, date: addDays(t, -50) });
    store.put('gtx', { goal: g.id, amount: 400000, date: addDays(t, -15) });
    store.put('goal', { name: 'عمرة', emoji: '🕌', target: 4000000, color: '#10B981' });
    // budgets
    store.put('budget', { id: 'budget:total', amount: 1600000 });
    store.put('budget', { id: 'budget:cat:cat:food', cat: 'cat:food', amount: 450000 });
    store.put('budget', { id: 'budget:cat:cat:coffee', cat: 'cat:coffee', amount: 100000 });
  });
}
