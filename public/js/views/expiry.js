import { api, can } from '../api.js';
import {
  el, card, table, money, num, statCard, expiryBadge, daysBetween, dateStr,
  select, toastOk, toastErr, modal, input, field, downloadCsv, emptyState, confirmDialog
} from '../ui.js';

export async function expiryView() {
  let days = 90;
  const wrap = el('div');
  const body = el('div');

  const daysSelect = select(
    [30, 60, 90, 120, 180, 365].map((d) => ({ value: d, label: `خلال ${d} يوم`, selected: d === days })),
    { onchange: (e) => { days = Number(e.target.value); render(); }, style: { maxWidth: '180px' } }
  );

  async function render() {
    body.innerHTML = '';
    const r = await api.expiryAlerts(days);
    const expiredValue = r.expired.reduce((s, b) => s + b.value, 0);
    const soonValue = r.expiring_soon.reduce((s, b) => s + b.value, 0);

    body.append(el('div.grid.g3', { style: { marginBottom: '18px' } }, [
      statCard({ label: 'دفعات منتهية الصلاحية', icon: '🚨', value: num(r.expired.length),
        sub: `خسارة محققة ${money(expiredValue)}`, kind: 'danger' }),
      statCard({ label: `تنتهي خلال ${days} يوم`, icon: '⏰', value: num(r.expiring_soon.length),
        sub: `${money(soonValue)} يمكن إنقاذها`, kind: 'warn' }),
      statCard({ label: 'إجمالي المبلغ في خطر', icon: '💰', value: money(expiredValue + soonValue),
        sub: 'قيمة البضاعة المعرّضة للتلف', kind: 'info' })
    ]));

    if (r.expiring_soon.length) {
      body.append(el('div.alert.alert-info', {}, [
        el('span', { text: '💡' }),
        el('div', {}, [
          el('b', { text: 'ماذا تفعل بهذه القائمة؟' }),
          el('div.t-sm', { text: 'الأدوية القريبة من الانتهاء تُصرّف أولاً تلقائياً في نقطة البيع. ضع عليها عرضاً أو خصماً، أو أرجعها للمورد قبل انتهاء مدة الإرجاع المسموحة.' })
        ])
      ]));
    }

    // ---- المنتهية ----
    if (r.expired.length) {
      body.append(card('🚨 منتهية الصلاحية — اسحبها من الرف فوراً', [
        table([
          { title: 'الصنف', render: (b) => el('div', {}, [
              el('b', { text: b.product_name }),
              b.location ? el('div.t-sm.t-muted', { text: 'موقع: ' + b.location }) : null
            ]) },
          { title: 'رقم الدفعة', render: (b) => el('span.num', { text: b.batch_no || '—' }) },
          { title: 'انتهت في', render: (b) => el('div', {}, [
              el('span.num', { text: dateStr(b.expiry_date) }),
              el('div', {}, [expiryBadge(b.expiry_date)])
            ]) },
          { title: 'الكمية', align: 'center', render: (b) => el('b.num', { text: num(b.qty) }) },
          { title: 'الخسارة', align: 'left', render: (b) => el('b.num.t-danger', { text: money(b.value, false) }) },
          can('stock.adjust') ? { title: '', align: 'left', render: (b) =>
              el('button.btn.btn-sm.btn-danger', { text: 'إتلاف', title: 'تصفير كمية الدفعة وتسجيلها كإتلاف',
                onclick: () => disposeBatch(b, render) }) } : null
        ].filter(Boolean), r.expired, { emptyText: 'لا شيء' })
      ], [
        el('button.btn.btn-sm.btn-outline', { text: '⬇️ تصدير', onclick: () => exportRows(r.expired, 'أدوية-منتهية') })
      ], true));
      body.append(el('div', { style: { height: '16px' } }));
    }

    // ---- القريبة من الانتهاء ----
    body.append(card(`⏰ تنتهي خلال ${days} يوم — صرّفها الآن`, [
      table([
        { title: 'الصنف', render: (b) => el('div', {}, [
            el('b', { text: b.product_name }),
            b.location ? el('div.t-sm.t-muted', { text: 'موقع: ' + b.location }) : null
          ]) },
        { title: 'رقم الدفعة', render: (b) => el('span.num', { text: b.batch_no || '—' }) },
        { title: 'تنتهي في', render: (b) => el('div', {}, [
            el('span.num', { text: dateStr(b.expiry_date) }),
            el('div', {}, [expiryBadge(b.expiry_date)])
          ]) },
        { title: 'الكمية', align: 'center', render: (b) => el('b.num', { text: num(b.qty) }) },
        { title: 'سعر البيع', align: 'left', render: (b) => el('span.num', { text: money(b.sale_price, false) }) },
        { title: 'القيمة في الخطر', align: 'left', render: (b) => el('b.num.t-warn', { text: money(b.value, false) }) }
      ], r.expiring_soon, {
        emptyIcon: '✅',
        emptyText: 'ممتاز! لا توجد أدوية قاربت على الانتهاء',
        emptyHint: `لا شيء ينتهي خلال ${days} يوماً القادمة`
      })
    ], [
      el('button.btn.btn-sm.btn-outline', { text: '⬇️ تصدير', onclick: () => exportRows(r.expiring_soon, 'قاربت-على-الانتهاء') }),
      el('button.btn.btn-sm.btn-outline', { text: '🖨️ طباعة', onclick: () => window.print() })
    ], true));
  }

  function exportRows(rows, name) {
    downloadCsv(name, [
      { title: 'الصنف', key: 'product_name' },
      { title: 'رقم الدفعة', key: 'batch_no' },
      { title: 'تاريخ الصلاحية', key: 'expiry_date' },
      { title: 'الأيام المتبقية', value: (r) => daysBetween(r.expiry_date) },
      { title: 'الكمية', key: 'qty' },
      { title: 'التكلفة', key: 'cost_price' },
      { title: 'القيمة', key: 'value' },
      { title: 'موقع الرف', key: 'location' }
    ], rows);
  }

  async function disposeBatch(b, reload) {
    if (!await confirmDialog(
      `سيتم تصفير كمية الدفعة «${b.batch_no || ''}» من «${b.product_name}» (${num(b.qty)} وحدة) وتسجيلها كإتلاف بقيمة ${money(b.value)}.`,
      { title: 'تأكيد الإتلاف', okLabel: 'تأكيد الإتلاف', danger: true })) return;
    try {
      await api.adjustStock({ batch_id: b.id, new_qty: 0, reason: 'إتلاف دواء منتهي الصلاحية' });
      toastOk('تم تسجيل الإتلاف وتحديث المخزون');
      reload();
    } catch (e) { toastErr(e.message); }
  }

  wrap.append(el('div.toolbar', {}, [
    el('span', { text: 'عرض الدفعات التي تنتهي:' }),
    daysSelect
  ]), body);

  await render();
  return wrap;
}
