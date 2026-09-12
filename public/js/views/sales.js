import { api, state, can } from '../api.js';
import { app } from '../app.js';
import {
  el, add, card, table, money, num, statCard, modal, field, input, select, textarea,
  toastOk, toastErr, dateStr, dateTimeStr, todayStr, daysAgoStr, monthStartStr,
  printNode, downloadCsv, debounce, confirmDialog, emptyState, spinner
} from '../ui.js';

export async function salesView() {
  let filter = { from: daysAgoStr(29), to: todayStr(), q: '', payment_method: '' };
  const listBox = el('div.card-body.tight', {}, [spinner()]);
  const statsBox = el('div.grid.g4', { style: { marginBottom: '16px' } });

  const load = async () => {
    listBox.innerHTML = ''; listBox.append(spinner());
    try {
      const { rows, summary } = await api.sales({ ...filter, limit: 300 });
      const profit = rows.reduce((s, r) => s + (r.profit || 0), 0);
      const credit = rows.filter((r) => r.payment_method === 'credit').reduce((s, r) => s + (r.total - r.paid), 0);

      statsBox.innerHTML = '';
      statsBox.append(
        statCard({ label: 'عدد الفواتير', icon: '🧾', value: num(summary.count) }),
        statCard({ label: 'إجمالي المبيعات', icon: '💰', value: money(summary.total), kind: 'ok' }),
        statCard({ label: 'الربح التقديري', icon: '📈', value: money(profit), kind: 'info' }),
        statCard({ label: 'غير محصّل (آجل)', icon: '📝', value: money(credit), kind: credit > 0 ? 'warn' : '' })
      );

      listBox.innerHTML = '';
      listBox.append(table([
        { title: 'رقم الفاتورة', render: (r) => el('b.num', { text: r.invoice_no }) },
        { title: 'التاريخ', render: (r) => el('span.t-sm', { text: dateTimeStr(r.date) }) },
        { title: 'الزبون', render: (r) => r.customer_name || el('span.t-muted', { text: 'نقدي' }) },
        { title: 'البائع', render: (r) => el('span.t-sm.t-muted', { text: r.user_name || '—' }) },
        { title: 'الدفع', align: 'center', render: (r) =>
            r.payment_method === 'credit'
              ? el('span.badge.badge-warn', { text: 'آجل' })
              : el('span.badge.badge-ok', { text: 'نقدي' }) },
        { title: 'الخصم', align: 'left', render: (r) => r.discount > 0 ? el('span.num.t-muted', { text: money(r.discount, false) }) : '—' },
        { title: 'الإجمالي', align: 'left', render: (r) => el('b.num', { text: money(r.total, false) }) },
        { title: 'المتبقي', align: 'left', render: (r) => {
            const rem = r.total - r.paid;
            return rem > 0.009 ? el('b.num.t-danger', { text: money(rem, false) }) : el('span.badge.badge-ok', { text: 'مسدد' });
          } },
        { title: 'الحالة', align: 'center', render: (r) =>
            r.status === 'returned' ? el('span.badge.badge-danger', { text: 'مرتجعة' }) : el('span.badge.badge-muted', { text: 'تمت' }) }
      ], rows, {
        onRowClick: (r) => showSale(r.id, load),
        emptyIcon: '🧾', emptyText: 'لا توجد فواتير في هذه الفترة'
      }));

      exportBtn.onclick = () => downloadCsv('المبيعات', [
        { title: 'رقم الفاتورة', key: 'invoice_no' }, { title: 'التاريخ', key: 'date' },
        { title: 'الزبون', key: 'customer_name' }, { title: 'البائع', key: 'user_name' },
        { title: 'طريقة الدفع', value: (r) => r.payment_method === 'credit' ? 'آجل' : 'نقدي' },
        { title: 'المجموع', key: 'subtotal' }, { title: 'الخصم', key: 'discount' },
        { title: 'الإجمالي', key: 'total' }, { title: 'المدفوع', key: 'paid' },
        { title: 'الربح', key: 'profit' }
      ], rows);
    } catch (e) {
      listBox.innerHTML = '';
      listBox.append(el('div.alert.alert-danger', { text: e.message }));
    }
  };

  const fromInput = input({ type: 'date', value: filter.from, onchange: (e) => { filter.from = e.target.value; load(); } });
  const toInput = input({ type: 'date', value: filter.to, onchange: (e) => { filter.to = e.target.value; load(); } });
  const q = input({ placeholder: '🔍 رقم الفاتورة أو اسم الزبون' });
  q.addEventListener('input', debounce(() => { filter.q = q.value.trim(); load(); }, 280));
  const methodSel = select([
    { value: '', label: 'كل الطرق' }, { value: 'cash', label: 'نقدي' }, { value: 'credit', label: 'آجل' }
  ], { onchange: (e) => { filter.payment_method = e.target.value; load(); } });
  const exportBtn = el('button.btn.btn-sm.btn-outline', { text: '⬇️ تصدير Excel' });

  const quick = (label, from, to) => el('button.btn.btn-sm.btn-outline', { text: label, onclick: () => {
    filter.from = from; filter.to = to; fromInput.value = from; toInput.value = to; load();
  }});

  const toolbar = el('div', {}, [
    el('div.toolbar', {}, [
      el('div.grow', {}, [q]),
      el('div', { style: { flex: '0 0 auto' } }, [fromInput]),
      el('div', { style: { flex: '0 0 auto' } }, [toInput]),
      methodSel, exportBtn
    ]),
    el('div.pill-row', { style: { marginBottom: '16px' } }, [
      quick('اليوم', todayStr(), todayStr()),
      quick('أمس', daysAgoStr(1), daysAgoStr(1)),
      quick('آخر 7 أيام', daysAgoStr(6), todayStr()),
      quick('آخر 30 يوم', daysAgoStr(29), todayStr()),
      quick('هذا الشهر', monthStartStr(), todayStr())
    ])
  ]);

  await load();
  return el('div', {}, [toolbar, statsBox, el('div.card', {}, [listBox])]);
}

// ---------- تفاصيل الفاتورة ----------
export async function showSale(id, onChanged) {
  const m = modal({ title: 'الفاتورة', size: 'wide', body: spinner(), actions: [{ label: 'إغلاق', class: 'btn-outline' }] });
  try {
    const s = await api.sale(id);
    const body = el('div');

    body.append(el('div.grid.g4', { style: { marginBottom: '18px' } }, [
      el('div.stat', {}, [el('div.stat-label', { text: 'الإجمالي' }), el('div.stat-value.num', { text: money(s.total, false) })]),
      el('div.stat', { class: 'ok' }, [el('div.stat-label', { text: 'المدفوع' }), el('div.stat-value.num', { text: money(s.paid, false) })]),
      el('div.stat', { class: s.total - s.paid > 0.009 ? 'danger' : '' }, [
        el('div.stat-label', { text: 'المتبقي' }), el('div.stat-value.num', { text: money(s.total - s.paid, false) })]),
      can('reports.view')
        ? el('div.stat', { class: 'info' }, [el('div.stat-label', { text: 'الربح' }), el('div.stat-value.num', { text: money(s.profit, false) })])
        : el('div.stat', {}, [el('div.stat-label', { text: 'الأصناف' }), el('div.stat-value.num', { text: num(s.items.length) })])
    ]));

    body.append(el('div.grid.g2', { style: { marginBottom: '16px' } }, [
      el('div', {}, [
        el('div.kv', {}, [el('span', { text: 'رقم الفاتورة' }), el('b.num', { text: s.invoice_no })]),
        el('div.kv', {}, [el('span', { text: 'التاريخ' }), el('b', { text: dateTimeStr(s.date) })]),
        el('div.kv', {}, [el('span', { text: 'البائع' }), el('b', { text: s.user_name || '—' })])
      ]),
      el('div', {}, [
        el('div.kv', {}, [el('span', { text: 'الزبون' }), el('b', { text: s.customer_name || 'نقدي' })]),
        el('div.kv', {}, [el('span', { text: 'طريقة الدفع' }), el('b', { text: s.payment_method === 'credit' ? 'آجل' : 'نقدي' })]),
        el('div.kv', {}, [el('span', { text: 'الحالة' }), el('b', { text: s.status === 'returned' ? 'مرتجعة بالكامل' : 'تمت' })])
      ])
    ]));

    body.append(table([
      { title: 'الصنف', render: (i) => el('div', {}, [
          el('b', { text: i.product_name }),
          i.strength ? el('span.t-sm.t-muted', { text: ' ' + i.strength }) : null
        ]) },
      { title: 'الكمية', align: 'center', render: (i) => el('span.num', { text: num(i.qty) }) },
      { title: 'مرتجع', align: 'center', render: (i) => i.returned_qty > 0 ? el('span.badge.badge-warn', { text: num(i.returned_qty) }) : '—' },
      { title: 'السعر', align: 'left', render: (i) => el('span.num', { text: money(i.price, false) }) },
      { title: 'الإجمالي', align: 'left', render: (i) => el('b.num', { text: money(i.qty * i.price, false) }) }
    ], s.items), );

    if (s.returns.length) {
      body.append(el('div.section-title', { text: 'المرتجعات على هذه الفاتورة' }));
      body.append(table([
        { title: 'التاريخ', render: (r) => dateTimeStr(r.date) },
        { title: 'السبب', render: (r) => r.reason || '—' },
        { title: 'القيمة', align: 'left', render: (r) => el('b.num.t-danger', { text: money(r.total, false) }) }
      ], s.returns));
    }

    const printable = receiptFor(s);
    const mb = m.box.querySelector('.modal-body');
    mb.innerHTML = ''; mb.append(body);
    m.box.querySelector('.modal-head h3').textContent = 'فاتورة ' + s.invoice_no;

    const foot = m.box.querySelector('.modal-foot');
    foot.innerHTML = '';
    add(foot,
      el('button.btn.btn-primary', { text: '🖨️ طباعة', onclick: () => printNode(printable, s.invoice_no) }),
      can('sales.return') && s.status !== 'returned'
        ? el('button.btn.btn-outline', { text: '↩️ إرجاع أصناف', onclick: () => { m.close(); returnDialog(s, onChanged); } })
        : null,
      el('button.btn.btn-outline', { text: 'إغلاق', onclick: m.close })
    );
  } catch (e) {
    const mb = m.box.querySelector('.modal-body');
    mb.innerHTML = ''; mb.append(el('div.alert.alert-danger', { text: e.message }));
  }
}

function receiptFor(s) {
  const st = state.settings;
  return el('div.receipt', {}, [
    el('h3', { text: st.pharmacy_name || 'صيدليتي' }),
    el('div.r-sub', { text: [st.pharmacy_address, st.pharmacy_phone].filter(Boolean).join(' — ') }),
    el('hr'),
    el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '10.5px' } }, [
      el('span', { text: 'فاتورة: ' + s.invoice_no }), el('span', { text: dateTimeStr(s.date) })
    ]),
    s.customer_name ? el('div', { text: 'الزبون: ' + s.customer_name, style: { fontSize: '10.5px' } }) : null,
    el('hr'),
    el('table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'الصنف' }), el('th', { text: 'كمية' }), el('th', { text: 'سعر' }), el('th', { text: 'إجمالي' })])]),
      el('tbody', {}, s.items.map((i) => el('tr', {}, [
        el('td', { text: i.product_name }), el('td', { text: num(i.qty) }),
        el('td', { text: money(i.price, false) }), el('td', { text: money(i.qty * i.price, false) })
      ])))
    ]),
    el('hr'),
    el('div.r-tot', {}, [el('span', { text: 'المجموع' }), el('span', { text: money(s.subtotal, false) })]),
    s.discount > 0 ? el('div.r-tot', {}, [el('span', { text: 'الخصم' }), el('span', { text: '− ' + money(s.discount, false) })]) : null,
    el('div.r-tot.big', {}, [el('span', { text: 'الإجمالي' }), el('span', { text: money(s.total) })]),
    el('hr'),
    el('div.r-foot', { text: st.receipt_footer || 'شكراً لزيارتكم' })
  ]);
}

// ---------- المرتجعات ----------
function returnDialog(sale, onChanged) {
  const lines = sale.items
    .map((i) => ({ ...i, available: i.qty - (i.returned_qty || 0), retQty: 0 }))
    .filter((i) => i.available > 0);

  if (!lines.length) { toastErr('كل أصناف هذه الفاتورة مُرجعة بالفعل'); return; }

  const reason = input({ placeholder: 'سبب الإرجاع (اختياري)' });
  const totalBox = el('b.num', { text: money(0) });

  const recalc = () => {
    totalBox.textContent = money(lines.reduce((s, l) => s + l.retQty * l.price, 0));
  };

  const body = el('div', {}, [
    el('div.alert.alert-info', { text: 'حدد الكمية المراد إرجاعها لكل صنف. سترجع الكميات إلى المخزون تلقائياً.' }),
    table([
      { title: 'الصنف', render: (l) => el('b', { text: l.product_name }) },
      { title: 'المباع', align: 'center', render: (l) => el('span.num', { text: num(l.qty) }) },
      { title: 'قابل للإرجاع', align: 'center', render: (l) => el('span.num', { text: num(l.available) }) },
      { title: 'السعر', align: 'left', render: (l) => el('span.num', { text: money(l.price, false) }) },
      { title: 'كمية الإرجاع', align: 'center', render: (l) => el('input.input', {
          type: 'number', min: '0', max: l.available, step: '1', value: '0',
          style: { width: '84px', textAlign: 'center' },
          onchange: (e) => {
            const v = Math.min(l.available, Math.max(0, Number(e.target.value) || 0));
            e.target.value = v; l.retQty = v; recalc();
          }
        }) }
    ], lines),
    el('div.field', { style: { marginTop: '16px' } }, [el('label', { text: 'سبب الإرجاع' }), reason]),
    el('div.kv', { style: { fontSize: '16px' } }, [el('span', { text: 'قيمة المرتجع' }), totalBox])
  ]);

  modal({
    title: 'إرجاع من فاتورة ' + sale.invoice_no,
    size: 'wide', body,
    actions: [
      { label: 'تأكيد الإرجاع', class: 'btn-danger', onClick: async () => {
        const items = lines.filter((l) => l.retQty > 0).map((l) => ({ product_id: l.product_id, price: l.price, qty: l.retQty }));
        if (!items.length) { toastErr('حدد كمية للإرجاع أولاً'); return false; }
        try {
          const r = await api.createReturn({ sale_id: sale.id, items, reason: reason.value });
          toastOk(`تم تسجيل مرتجع بقيمة ${money(r.total)}`);
          if (onChanged) onChanged();
          app.refreshBadges();
        } catch (e) { toastErr(e.message); return false; }
      }},
      { label: 'إلغاء', class: 'btn-outline' }
    ]
  });
}
