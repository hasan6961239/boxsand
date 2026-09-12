import { api } from '../api.js';
import {
  el, card, table, money, num, statCard, input, select, toastOk, toastErr,
  dateStr, todayStr, daysAgoStr, monthStartStr, downloadCsv, spinner, emptyState, expiryBadge
} from '../ui.js';

const TABS = [
  { id: 'pl', label: '📊 الأرباح والخسائر' },
  { id: 'sales', label: '📈 حركة المبيعات' },
  { id: 'products', label: '💊 أداء الأصناف' },
  { id: 'debtors', label: '📝 الذمم والديون' },
  { id: 'dead', label: '🧊 البضاعة الراكدة' },
  { id: 'purchase', label: '🛒 قائمة الشراء المقترحة' },
  { id: 'users', label: '👤 أداء الموظفين' }
];

export async function reportsView() {
  let tab = 'pl';
  let from = monthStartStr();
  let to = todayStr();

  const body = el('div');
  const tabsBar = el('div.tabs');

  const setTab = (id) => {
    tab = id;
    [...tabsBar.children].forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    render();
  };
  TABS.forEach((t) => tabsBar.append(el('button.tab', {
    dataset: { tab: t.id }, class: t.id === tab ? 'active' : '', text: t.label, onclick: () => setTab(t.id)
  })));

  const fromI = input({ type: 'date', value: from, onchange: (e) => { from = e.target.value; render(); } });
  const toI = input({ type: 'date', value: to, onchange: (e) => { to = e.target.value; render(); } });
  const quick = (label, f, t) => el('button.btn.btn-sm.btn-outline', { text: label, onclick: () => {
    from = f; to = t; fromI.value = f; toI.value = t; render();
  }});

  const dateBar = el('div.toolbar', {}, [
    el('span.t-sm.t-muted', { text: 'الفترة:' }),
    el('div', { style: { flex: '0 0 auto' } }, [fromI]),
    el('div', { style: { flex: '0 0 auto' } }, [toI]),
    quick('هذا الشهر', monthStartStr(), todayStr()),
    quick('آخر 30 يوم', daysAgoStr(29), todayStr()),
    quick('آخر 90 يوم', daysAgoStr(89), todayStr()),
    quick('هذه السنة', todayStr().slice(0, 4) + '-01-01', todayStr())
  ]);

  async function render() {
    body.innerHTML = ''; body.append(spinner());
    dateBar.classList.toggle('hidden', ['debtors', 'dead', 'purchase'].includes(tab));
    try {
      const node = await RENDERERS[tab]({ from, to });
      body.innerHTML = ''; body.append(node);
    } catch (e) {
      body.innerHTML = ''; body.append(el('div.alert.alert-danger', { text: e.message }));
    }
  }

  await render();
  return el('div', {}, [tabsBar, dateBar, body]);
}

const RENDERERS = {
  // ---------- الأرباح والخسائر ----------
  async pl({ from, to }) {
    const r = await api.reportProfitLoss({ from, to });
    return el('div', {}, [
      el('div.grid.g4', { style: { marginBottom: '18px' } }, [
        statCard({ label: 'صافي المبيعات', icon: '💰', value: money(r.revenue), sub: 'بعد الخصومات والمرتجعات', kind: 'ok' }),
        statCard({ label: 'تكلفة البضاعة المباعة', icon: '📦', value: money(r.cogs), kind: 'info' }),
        statCard({ label: 'مجمل الربح', icon: '📈', value: money(r.gross_profit), sub: `هامش ${r.margin}%` }),
        statCard({ label: 'صافي الربح', icon: '✅', value: money(r.net_profit),
          sub: `بعد مصروفات ${money(r.expenses)}`, kind: r.net_profit >= 0 ? 'ok' : 'danger' })
      ]),
      el('div.grid.g2', {}, [
        card('قائمة الدخل', [
          el('div.kv', {}, [el('span', { text: 'إجمالي المبيعات' }), el('b.num', { text: money(r.revenue + r.discounts + r.returns, false) })]),
          el('div.kv', {}, [el('span', { text: 'ناقصاً: الخصومات' }), el('b.num.t-danger', { text: '− ' + money(r.discounts, false) })]),
          el('div.kv', {}, [el('span', { text: 'ناقصاً: المرتجعات' }), el('b.num.t-danger', { text: '− ' + money(r.returns, false) })]),
          el('div.kv', { style: { borderTop: '2px solid var(--ink-200)' } }, [el('span', { text: 'صافي المبيعات' }), el('b.num', { text: money(r.revenue, false) })]),
          el('div.kv', {}, [el('span', { text: 'ناقصاً: تكلفة البضاعة' }), el('b.num.t-danger', { text: '− ' + money(r.cogs, false) })]),
          el('div.kv', { style: { borderTop: '2px solid var(--ink-200)' } }, [el('span', { text: 'مجمل الربح' }), el('b.num.t-ok', { text: money(r.gross_profit, false) })]),
          el('div.kv', {}, [el('span', { text: 'ناقصاً: المصروفات' }), el('b.num.t-danger', { text: '− ' + money(r.expenses, false) })]),
          el('div.kv', { style: { borderTop: '2px solid var(--ink-900)', fontSize: '16px' } }, [
            el('span', { text: 'صافي الربح' }),
            el('b.num', { class: r.net_profit >= 0 ? 't-ok' : 't-danger', text: money(r.net_profit) })])
        ]),
        card('توزيع المصروفات', [
          r.expenses_by_category.length
            ? el('div', {}, r.expenses_by_category.map((c) => {
                const max = r.expenses_by_category[0].amount || 1;
                return el('div', { style: { marginBottom: '11px' } }, [
                  el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' } }, [
                    el('span', { text: c.category }), el('b.num', { text: money(c.amount, false) })]),
                  el('div.progress', {}, [el('div', { style: { width: (c.amount / max) * 100 + '%' } })])
                ]);
              }))
            : emptyState('لا توجد مصروفات مسجلة في هذه الفترة', '💸')
        ])
      ])
    ]);
  },

  // ---------- حركة المبيعات ----------
  async sales({ from, to }) {
    const days = Math.round((new Date(to) - new Date(from)) / 864e5);
    const groupBy = days > 90 ? 'month' : 'day';
    const r = await api.reportSales({ from, to, group_by: groupBy });
    const max = Math.max(1, ...r.rows.map((x) => x.revenue));
    return el('div', {}, [
      el('div.grid.g4', { style: { marginBottom: '18px' } }, [
        statCard({ label: 'عدد الفواتير', icon: '🧾', value: num(r.totals.invoices) }),
        statCard({ label: 'إجمالي المبيعات', icon: '💰', value: money(r.totals.revenue), kind: 'ok' }),
        statCard({ label: 'إجمالي الربح', icon: '📈', value: money(r.totals.profit), kind: 'info' }),
        statCard({ label: 'متوسط الفاتورة', icon: '🎯',
          value: money(r.totals.invoices ? r.totals.revenue / r.totals.invoices : 0) })
      ]),
      card(groupBy === 'month' ? 'المبيعات شهرياً' : 'المبيعات يومياً', [
        el('div.bar-chart', { style: { height: '190px' } }, r.rows.map((x) =>
          el('div.bar-col', {}, [
            el('div.bar', { style: { height: Math.max(3, (x.revenue / max) * 160) + 'px' },
              title: `${x.period} — ${money(x.revenue)} (ربح ${money(x.profit)})` }),
            el('div.bar-label', { text: x.period.slice(5) || x.period })
          ])))
      ]),
      el('div', { style: { height: '16px' } }),
      card('التفاصيل', [
        table([
          { title: 'الفترة', render: (x) => el('b.num', { text: x.period }) },
          { title: 'عدد الفواتير', align: 'center', render: (x) => el('span.num', { text: num(x.invoices) }) },
          { title: 'المبيعات', align: 'left', render: (x) => el('span.num', { text: money(x.revenue, false) }) },
          { title: 'التكلفة', align: 'left', render: (x) => el('span.num.t-muted', { text: money(x.cost, false) }) },
          { title: 'الخصومات', align: 'left', render: (x) => el('span.num.t-muted', { text: money(x.discount, false) }) },
          { title: 'الربح', align: 'left', render: (x) => el('b.num.t-ok', { text: money(x.profit, false) }) }
        ], r.rows, { emptyText: 'لا توجد مبيعات في هذه الفترة' })
      ], [
        el('button.btn.btn-sm.btn-outline', { text: '⬇️ تصدير', onclick: () => downloadCsv('حركة-المبيعات', [
          { title: 'الفترة', key: 'period' }, { title: 'الفواتير', key: 'invoices' },
          { title: 'المبيعات', key: 'revenue' }, { title: 'التكلفة', key: 'cost' },
          { title: 'الخصم', key: 'discount' }, { title: 'الربح', key: 'profit' }
        ], r.rows) })
      ], true)
    ]);
  },

  // ---------- أداء الأصناف ----------
  async products({ from, to }) {
    const rows = await api.reportProducts({ from, to, sort: 'revenue', limit: 200 });
    const sold = rows.filter((r) => r.qty > 0);
    return card(`أداء الأصناف (${sold.length} صنف تحرّك)`, [
      table([
        { title: '#', align: 'center', render: (r, i) => el('span.t-muted', { text: i + 1 }) },
        { title: 'الصنف', render: (r) => el('div', {}, [
            el('b', { text: r.name }),
            r.generic_name ? el('div.t-sm.t-muted', { text: r.generic_name }) : null ]) },
        { title: 'الكمية المباعة', align: 'center', render: (r) => el('b.num', { text: num(r.qty) }) },
        { title: 'الإيراد', align: 'left', render: (r) => el('span.num', { text: money(r.revenue, false) }) },
        { title: 'الربح', align: 'left', render: (r) => el('b.num.t-ok', { text: money(r.profit, false) }) },
        { title: 'المخزون الحالي', align: 'center', render: (r) =>
            el('span.num', { class: r.stock <= 0 ? 't-danger' : '', text: num(r.stock) }) }
      ], sold, { emptyIcon: '💊', emptyText: 'لا توجد مبيعات في هذه الفترة' })
    ], [
      el('button.btn.btn-sm.btn-outline', { text: '⬇️ تصدير', onclick: () => downloadCsv('أداء-الأصناف', [
        { title: 'الصنف', key: 'name' }, { title: 'المادة الفعالة', key: 'generic_name' },
        { title: 'الكمية المباعة', key: 'qty' }, { title: 'الإيراد', key: 'revenue' },
        { title: 'الربح', key: 'profit' }, { title: 'المخزون', key: 'stock' }
      ], sold) })
    ], true);
  },

  // ---------- الذمم ----------
  async debtors() {
    const [cust, sup] = await Promise.all([api.reportDebtors(), api.reportSuppliersDue()]);
    return el('div', {}, [
      el('div.grid.g2', { style: { marginBottom: '18px' } }, [
        statCard({ label: 'ديون لك على الزبائن', icon: '📥', value: money(cust.total),
          sub: `${cust.rows.length} زبون`, kind: 'warn' }),
        statCard({ label: 'ديون عليك للموردين', icon: '📤', value: money(sup.total),
          sub: `${sup.rows.length} مورد`, kind: 'danger' })
      ]),
      el('div.grid.g2', {}, [
        card('الزبائن المدينون', [
          table([
            { title: 'الزبون', render: (c) => el('div', {}, [el('b', { text: c.name }), el('div.t-sm.t-muted', { text: c.phone || '' })]) },
            { title: 'آخر فاتورة', render: (c) => el('span.t-sm', { text: dateStr(c.last_sale) }) },
            { title: 'الرصيد', align: 'left', render: (c) => el('b.num.t-danger', { text: money(c.balance, false) }) }
          ], cust.rows, { emptyIcon: '✅', emptyText: 'لا توجد ديون على الزبائن' })
        ], [
          el('button.btn.btn-sm.btn-outline', { text: '⬇️', onclick: () => downloadCsv('الذمم-المدينة', [
            { title: 'الزبون', key: 'name' }, { title: 'الهاتف', key: 'phone' },
            { title: 'الرصيد', key: 'balance' }, { title: 'آخر فاتورة', key: 'last_sale' }
          ], cust.rows) })
        ], true),
        card('المستحق للموردين', [
          table([
            { title: 'المورد', render: (s) => el('div', {}, [el('b', { text: s.name }), el('div.t-sm.t-muted', { text: s.phone || '' })]) },
            { title: 'الرصيد', align: 'left', render: (s) => el('b.num', { class: s.balance > 0 ? 't-danger' : 't-ok', text: money(s.balance, false) }) }
          ], sup.rows, { emptyIcon: '✅', emptyText: 'لا توجد مستحقات للموردين' })
        ], [], true)
      ])
    ]);
  },

  // ---------- البضاعة الراكدة ----------
  async dead() {
    const rows = await api.reportDeadStock({ days: 90 });
    const value = rows.reduce((s, r) => s + r.stock * r.cost_price, 0);
    return el('div', {}, [
      el('div.alert.alert-warn', {}, [
        el('span', { text: '🧊' }),
        el('div', {}, [
          el('b', { text: `${rows.length} صنف لم يُبع منه ولا وحدة خلال آخر 90 يوماً` }),
          el('div.t-sm', { text: `رأس مال مجمّد بقيمة ${money(value)} — فكّر في عرض تخفيض أو إرجاعها للمورد.` })
        ])
      ]),
      card('الأصناف الراكدة', [
        table([
          { title: 'الصنف', render: (r) => el('div', {}, [
              el('b', { text: r.name }), el('div.t-sm.t-muted', { text: [r.generic_name, r.manufacturer].filter(Boolean).join(' · ') }) ]) },
          { title: 'المخزون', align: 'center', render: (r) => el('b.num', { text: num(r.stock) }) },
          { title: 'التكلفة', align: 'left', render: (r) => el('span.num', { text: money(r.cost_price, false) }) },
          { title: 'رأس المال المجمّد', align: 'left', render: (r) => el('b.num.t-warn', { text: money(r.stock * r.cost_price, false) }) },
          { title: 'أقرب صلاحية', align: 'center', render: (r) => expiryBadge(r.nearest_expiry) }
        ], rows, { emptyIcon: '✅', emptyText: 'ممتاز! كل الأصناف تتحرك' })
      ], [
        el('button.btn.btn-sm.btn-outline', { text: '⬇️ تصدير', onclick: () => downloadCsv('البضاعة-الراكدة', [
          { title: 'الصنف', key: 'name' }, { title: 'المخزون', key: 'stock' },
          { title: 'التكلفة', key: 'cost_price' }, { title: 'القيمة', value: (r) => r.stock * r.cost_price },
          { title: 'أقرب صلاحية', key: 'nearest_expiry' }
        ], rows) })
      ], true)
    ]);
  },

  // ---------- قائمة الشراء ----------
  async purchase() {
    const rows = await api.purchaseSuggestion();
    const cost = rows.reduce((s, r) => s + r.estimated_cost, 0);
    return el('div', {}, [
      el('div.alert.alert-info', {}, [
        el('span', { text: '🛒' }),
        el('div', {}, [
          el('b', { text: `قائمة شراء مقترحة تضم ${rows.length} صنف` }),
          el('div.t-sm', { text: `محسوبة من مبيعات آخر 30 يوماً والحد الأدنى لكل صنف. التكلفة التقديرية ${money(cost)}.` })
        ])
      ]),
      card('اطبعها وأعطها للمورد', [
        table([
          { title: 'الصنف', render: (r) => el('div', {}, [
              el('b', { text: r.name + (r.strength ? ' — ' + r.strength : '') }),
              el('div.t-sm.t-muted', { text: r.manufacturer || '' }) ]) },
          { title: 'المتبقي', align: 'center', render: (r) => el('span.num.t-danger', { text: num(r.stock) }) },
          { title: 'بيع 30 يوم', align: 'center', render: (r) => el('span.num', { text: num(r.sold_last_30d) }) },
          { title: 'الكمية المقترحة', align: 'center', render: (r) => el('b.num.t-ok', { text: num(r.suggested_qty) }) },
          { title: 'التكلفة التقديرية', align: 'left', render: (r) => el('span.num', { text: money(r.estimated_cost, false) }) }
        ], rows, { emptyIcon: '✅', emptyText: 'لا توجد نواقص — المخزون بحالة جيدة' },)
      ], [
        el('button.btn.btn-sm.btn-outline', { text: '🖨️ طباعة', onclick: () => window.print() }),
        el('button.btn.btn-sm.btn-outline', { text: '⬇️ تصدير', onclick: () => downloadCsv('قائمة-الشراء', [
          { title: 'الصنف', key: 'name' }, { title: 'التركيز', key: 'strength' },
          { title: 'الشركة', key: 'manufacturer' }, { title: 'المتبقي', key: 'stock' },
          { title: 'بيع 30 يوم', key: 'sold_last_30d' }, { title: 'الكمية المقترحة', key: 'suggested_qty' },
          { title: 'التكلفة التقديرية', key: 'estimated_cost' }
        ], rows) })
      ], true)
    ]);
  },

  // ---------- أداء الموظفين ----------
  async users({ from, to }) {
    const rows = await api.reportUsers({ from, to });
    const ROLES = { admin: 'مدير', pharmacist: 'صيدلي', cashier: 'كاشير' };
    return card('أداء الموظفين في الفترة المحددة', [
      table([
        { title: 'الموظف', render: (u) => el('b', { text: u.full_name }) },
        { title: 'الصلاحية', render: (u) => el('span.badge.badge-muted', { text: ROLES[u.role] || u.role }) },
        { title: 'عدد الفواتير', align: 'center', render: (u) => el('span.num', { text: num(u.invoices) }) },
        { title: 'إجمالي المبيعات', align: 'left', render: (u) => el('b.num', { text: money(u.total, false) }) },
        { title: 'الخصومات الممنوحة', align: 'left', render: (u) => el('span.num', { class: u.discount > 0 ? 't-warn' : 't-muted', text: money(u.discount, false) }) },
        { title: 'متوسط الفاتورة', align: 'left', render: (u) => el('span.num', { text: money(u.invoices ? u.total / u.invoices : 0, false) }) }
      ], rows, { emptyText: 'لا توجد بيانات' })
    ], [], true);
  }
};
