import { api, state, can } from '../api.js';
import { app } from '../app.js';
import { el, card, statCard, money, num, table, dateStr, expiryBadge, emptyState } from '../ui.js';

export async function dashboardView() {
  const d = await api.dashboard();
  const wrap = el('div');

  // ---- تنبيهات عاجلة ----
  if (d.expired.count > 0) {
    wrap.append(el('div.alert.alert-danger', {}, [
      el('span', { text: '🚨' }),
      el('div', {}, [
        el('b', { text: `يوجد ${d.expired.count} دفعة دواء منتهية الصلاحية داخل المخزون` }),
        el('div.t-sm', { text: `قيمتها ${money(d.expired.value)} — يجب سحبها من الرفوف فوراً ومحاسبة المورد عليها.` })
      ]),
      el('div', { style: { marginInlineStart: 'auto' } }, [
        el('button.btn.btn-sm.btn-danger', { text: 'عرض التفاصيل', onclick: () => app.go('expiry') })
      ])
    ]));
  }
  if (d.expiring_soon.count > 0) {
    wrap.append(el('div.alert.alert-warn', {}, [
      el('span', { text: '⏰' }),
      el('div', {}, [
        el('b', { text: `${d.expiring_soon.count} دفعة تنتهي صلاحيتها خلال ${d.expiring_soon.days} يوم` }),
        el('div.t-sm', { text: `قيمتها ${money(d.expiring_soon.value)} — صرّفها الآن بعرض أو خصم قبل أن تتحول إلى خسارة.` })
      ]),
      el('div', { style: { marginInlineStart: 'auto' } }, [
        el('button.btn.btn-sm.btn-outline', { text: 'عرض القائمة', onclick: () => app.go('expiry') })
      ])
    ]));
  }

  // ---- مؤشرات اليوم ----
  wrap.append(el('div.grid.g4', { style: { marginBottom: '16px' } }, [
    statCard({ label: 'مبيعات اليوم', icon: '💰', value: money(d.sales_today.total),
      sub: `${d.sales_today.count} فاتورة`, kind: 'ok' }),
    statCard({ label: 'ربح اليوم', icon: '📈', value: money(d.profit_today),
      sub: 'بعد خصم تكلفة البضاعة' }),
    statCard({ label: 'مبيعات الشهر', icon: '🗓️', value: money(d.sales_month.total),
      sub: `${d.sales_month.count} فاتورة`, kind: 'info' }),
    statCard({ label: 'صافي ربح الشهر', icon: '✅', value: money(d.net_month),
      sub: `بعد مصروفات ${money(d.expenses_month)}`, kind: d.net_month >= 0 ? 'ok' : 'danger' })
  ]));

  // ---- مؤشرات المخزون ----
  wrap.append(el('div.grid.g4', { style: { marginBottom: '16px' } }, [
    statCard({ label: 'قيمة المخزون (تكلفة)', icon: '📦', value: money(d.stock_value),
      sub: `قيمته بسعر البيع ${money(d.stock_retail)}` }),
    statCard({ label: 'أصناف ناقصة', icon: '📉', value: num(d.low_stock_count),
      sub: 'وصلت الحد الأدنى', kind: d.low_stock_count ? 'warn' : '',
      onClick: can('products.view') ? () => app.go('products') : null }),
    statCard({ label: 'قاربت على الانتهاء', icon: '⏰', value: num(d.expiring_soon.count),
      sub: money(d.expiring_soon.value) + ' معرّضة للخسارة', kind: d.expiring_soon.count ? 'warn' : '',
      onClick: can('products.view') ? () => app.go('expiry') : null }),
    statCard({ label: 'ديون على الزبائن', icon: '👥', value: money(d.debt_total),
      sub: `${d.debtors_count} زبون عليه رصيد`, kind: d.debt_total > 0 ? 'danger' : '',
      onClick: can('customers.view') ? () => app.go('customers') : null })
  ]));

  // ---- الرسم البياني + الأكثر مبيعاً ----
  const maxTrend = Math.max(1, ...d.trend.map((t) => t.total));
  const chart = el('div.bar-chart', {}, d.trend.map((t) =>
    el('div.bar-col', {}, [
      el('div.bar', {
        style: { height: Math.max(3, (t.total / maxTrend) * 125) + 'px' },
        title: `${dateStr(t.date)} — ${money(t.total)} (${t.count} فاتورة)`
      }),
      el('div.bar-label', { text: t.date.slice(5).replace('-', '/') })
    ])
  ));

  const top = d.top_products.length
    ? el('div', {}, d.top_products.map((p, i) => {
        const max = d.top_products[0].revenue || 1;
        return el('div', { style: { marginBottom: '11px' } }, [
          el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' } }, [
            el('span', { text: `${i + 1}. ${p.name}` }),
            el('b.num', { text: money(p.revenue, false) })
          ]),
          el('div.progress', {}, [el('div', { style: { width: (p.revenue / max) * 100 + '%' } })]),
          el('div.t-sm.t-muted', { text: `${num(p.qty)} ${p.unit || 'وحدة'} مباعة`, style: { marginTop: '2px' } })
        ]);
      }))
    : emptyState('لا توجد مبيعات هذا الشهر بعد', '📊');

  wrap.append(el('div.grid.g-2-1', { style: { marginBottom: '16px' } }, [
    card('مبيعات آخر 14 يوم', [chart]),
    card('الأكثر مبيعاً هذا الشهر', [top])
  ]));

  // ---- النواقص ----
  if (d.low_stock.length) {
    wrap.append(card('أصناف تحتاج إعادة طلب', [
      table([
        { title: 'الصنف', key: 'name' },
        { title: 'المتبقي', align: 'center', render: (r) => el('b.t-danger.num', { text: num(r.stock) }) },
        { title: 'الحد الأدنى', align: 'center', render: (r) => el('span.num', { text: num(r.min_stock) }) },
        { title: 'المورد المقترح', render: (r) => r.manufacturer || '—' },
        { title: 'سعر البيع', align: 'left', render: (r) => el('span.num', { text: money(r.sale_price, false) }) }
      ], d.low_stock, { emptyText: 'لا توجد نواقص' })
    ], [
      can('reports.view') ? el('button.btn.btn-sm.btn-outline', {
        text: 'قائمة الشراء المقترحة', onclick: () => app.go('reports')
      }) : null
    ], true));
  }

  return wrap;
}
