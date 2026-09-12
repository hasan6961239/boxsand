import { api, can } from '../api.js';
import { app } from '../app.js';
import {
  el, add, addFirst, card, table, money, num, statCard, modal, field, input, select, textarea, readForm,
  toastOk, toastErr, dateStr, dateTimeStr, debounce, spinner, downloadCsv, emptyState, confirmDialog
} from '../ui.js';
import { showSale } from './sales.js';

// ================= الزبائن =================
export async function customersView() {
  let q = '';
  let onlyDebt = false;
  const listBox = el('div.card-body.tight', {}, [spinner()]);
  const statsBox = el('div.grid.g3', { style: { marginBottom: '16px' } });

  const load = async () => {
    listBox.innerHTML = ''; listBox.append(spinner());
    try {
      const rows = await api.customers({ q, with_balance: onlyDebt ? 'debt' : '' });
      const totalDebt = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
      const debtors = rows.filter((r) => r.balance > 0.009);

      statsBox.innerHTML = '';
      statsBox.append(
        statCard({ label: 'عدد الزبائن', icon: '👥', value: num(rows.length) }),
        statCard({ label: 'زبائن عليهم رصيد', icon: '📝', value: num(debtors.length), kind: debtors.length ? 'warn' : '' }),
        statCard({ label: 'إجمالي الديون', icon: '💰', value: money(totalDebt), kind: totalDebt > 0 ? 'danger' : 'ok' })
      );

      listBox.innerHTML = '';
      listBox.append(table([
        { title: 'الزبون', render: (c) => el('div', {}, [
            el('b', { text: c.name }),
            c.address ? el('div.t-sm.t-muted', { text: c.address }) : null ]) },
        { title: 'الهاتف', render: (c) => el('span.num', { text: c.phone || '—' }) },
        { title: 'حد الائتمان', align: 'left', render: (c) => c.credit_limit > 0 ? el('span.num.t-muted', { text: money(c.credit_limit, false) }) : '—' },
        { title: 'الرصيد المستحق', align: 'left', render: (c) =>
            c.balance > 0.009
              ? el('b.num.t-danger', { text: money(c.balance, false) })
              : el('span.badge.badge-ok', { text: 'لا يوجد' }) },
        { title: '', align: 'left', render: (c) => el('div.btn-row', {}, [
            c.balance > 0.009 && can('customers.edit')
              ? el('button.btn.btn-sm.btn-primary', { text: '💵 تسديد', onclick: (e) => { e.stopPropagation(); paymentDialog('customer', c, load); } })
              : null
          ]) }
      ], rows, { onRowClick: (c) => showCustomer(c.id, load), emptyIcon: '👥', emptyText: 'لا يوجد زبائن' }));

      exportBtn.onclick = () => downloadCsv('الزبائن', [
        { title: 'الاسم', key: 'name' }, { title: 'الهاتف', key: 'phone' },
        { title: 'العنوان', key: 'address' }, { title: 'حد الائتمان', key: 'credit_limit' },
        { title: 'الرصيد المستحق', key: 'balance' }
      ], rows);
    } catch (e) {
      listBox.innerHTML = ''; listBox.append(el('div.alert.alert-danger', { text: e.message }));
    }
  };

  const search = input({ placeholder: '🔍 ابحث بالاسم أو رقم الهاتف' });
  search.addEventListener('input', debounce(() => { q = search.value.trim(); load(); }, 280));
  const debtToggle = el('button.btn.btn-sm.btn-outline', { text: '📝 المدينون فقط', onclick: (e) => {
    onlyDebt = !onlyDebt;
    e.target.classList.toggle('btn-primary', onlyDebt);
    e.target.classList.toggle('btn-outline', !onlyDebt);
    load();
  }});
  const exportBtn = el('button.btn.btn-sm.btn-outline', { text: '⬇️ تصدير' });

  const toolbar = el('div.toolbar', {}, [
    el('div.grow', {}, [search]), debtToggle, exportBtn,
    can('customers.edit') ? el('button.btn.btn-primary.btn-sm', { text: '＋ زبون جديد', onclick: () => editParty('customer', null, load) }) : null
  ]);

  await load();
  return el('div', {}, [toolbar, statsBox, el('div.card', {}, [listBox])]);
}

async function showCustomer(id, onChanged) {
  const m = modal({ title: 'الزبون', size: 'wide', body: spinner(), actions: [{ label: 'إغلاق', class: 'btn-outline' }] });
  try {
    const c = await api.customer(id);
    const body = el('div', {}, [
      el('div.grid.g3', { style: { marginBottom: '18px' } }, [
        el('div.stat', { class: c.balance > 0.009 ? 'danger' : 'ok' }, [
          el('div.stat-label', { text: 'الرصيد المستحق' }), el('div.stat-value.num', { text: money(c.balance, false) })]),
        el('div.stat', {}, [el('div.stat-label', { text: 'حد الائتمان' }), el('div.stat-value.num', { text: money(c.credit_limit, false) })]),
        el('div.stat', { class: 'info' }, [el('div.stat-label', { text: 'عدد الفواتير' }), el('div.stat-value.num', { text: num(c.sales.length) })])
      ]),
      el('div.grid.g2', { style: { marginBottom: '8px' } }, [
        el('div', {}, [
          el('div.kv', {}, [el('span', { text: 'الهاتف' }), el('b.num', { text: c.phone || '—' })]),
          el('div.kv', {}, [el('span', { text: 'العنوان' }), el('b', { text: c.address || '—' })])
        ]),
        el('div', {}, [
          el('div.kv', {}, [el('span', { text: 'رصيد افتتاحي' }), el('b.num', { text: money(c.opening_balance, false) })]),
          el('div.kv', {}, [el('span', { text: 'ملاحظات' }), el('b', { text: c.notes || '—' })])
        ])
      ]),
      el('div.section-title', { text: 'آخر الفواتير' }),
      table([
        { title: 'الفاتورة', render: (s) => el('b.num', { text: s.invoice_no }) },
        { title: 'التاريخ', render: (s) => el('span.t-sm', { text: dateStr(s.date) }) },
        { title: 'النوع', align: 'center', render: (s) => s.payment_method === 'credit'
            ? el('span.badge.badge-warn', { text: 'آجل' }) : el('span.badge.badge-ok', { text: 'نقدي' }) },
        { title: 'الإجمالي', align: 'left', render: (s) => el('span.num', { text: money(s.total, false) }) },
        { title: 'المتبقي', align: 'left', render: (s) => {
            const r = s.total - s.paid;
            return r > 0.009 ? el('b.num.t-danger', { text: money(r, false) }) : el('span.badge.badge-ok', { text: 'مسدد' }); } }
      ], c.sales.slice(0, 25), { onRowClick: (s) => { m.close(); showSale(s.id, onChanged); }, emptyText: 'لا توجد فواتير' }),
      el('div.section-title', { text: 'سجل الدفعات' }),
      table([
        { title: 'التاريخ', render: (p) => dateTimeStr(p.date) },
        { title: 'البيان', render: (p) => p.note || 'دفعة على الحساب' },
        { title: 'المبلغ', align: 'left', render: (p) => el('b.num.t-ok', { text: money(p.amount, false) }) },
        can('customers.edit') ? { title: '', align: 'left', render: (p) => el('button.btn.btn-sm.btn-ghost', {
            text: '🗑️', title: 'حذف الدفعة', onclick: async () => {
              if (!await confirmDialog('حذف هذه الدفعة؟', { danger: true, okLabel: 'حذف' })) return;
              await api.deletePayment(p.id); toastOk('تم الحذف'); m.close(); onChanged();
            } }) } : null
      ].filter(Boolean), c.payments.slice(0, 25), { emptyText: 'لا توجد دفعات' })
    ]);
    const mb = m.box.querySelector('.modal-body');
    mb.innerHTML = ''; mb.append(body);
    m.box.querySelector('.modal-head h3').textContent = c.name;
    if (can('customers.edit')) {
      const foot = m.box.querySelector('.modal-foot');
      addFirst(foot,
        c.balance > 0.009 ? el('button.btn.btn-primary', { text: '💵 تسجيل دفعة', onclick: () => { m.close(); paymentDialog('customer', c, onChanged); } }) : null,
        el('button.btn.btn-outline', { text: '✏️ تعديل', onclick: () => { m.close(); editParty('customer', c, onChanged); } })
      );
    }
  } catch (e) {
    const mb = m.box.querySelector('.modal-body');
    mb.innerHTML = ''; mb.append(el('div.alert.alert-danger', { text: e.message }));
  }
}

// ================= الموردون =================
export async function suppliersView() {
  let q = '';
  const listBox = el('div.card-body.tight', {}, [spinner()]);
  const statsBox = el('div.grid.g3', { style: { marginBottom: '16px' } });

  const load = async () => {
    listBox.innerHTML = ''; listBox.append(spinner());
    try {
      const rows = await api.suppliers({ q });
      const due = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
      statsBox.innerHTML = '';
      statsBox.append(
        statCard({ label: 'عدد الموردين', icon: '🚚', value: num(rows.length) }),
        statCard({ label: 'موردون لهم مستحقات', icon: '📋', value: num(rows.filter((r) => r.balance > 0.009).length), kind: 'warn' }),
        statCard({ label: 'إجمالي المستحق عليك', icon: '💰', value: money(due), kind: due > 0 ? 'danger' : 'ok' })
      );
      listBox.innerHTML = '';
      listBox.append(table([
        { title: 'المورد', render: (s) => el('div', {}, [
            el('b', { text: s.name }), s.address ? el('div.t-sm.t-muted', { text: s.address }) : null ]) },
        { title: 'الهاتف', render: (s) => el('span.num', { text: s.phone || '—' }) },
        { title: 'المستحق عليك', align: 'left', render: (s) =>
            s.balance > 0.009 ? el('b.num.t-danger', { text: money(s.balance, false) })
            : s.balance < -0.009 ? el('span.num.t-ok', { text: 'رصيد لك ' + money(-s.balance, false) })
            : el('span.badge.badge-ok', { text: 'مسدد' }) },
        { title: '', align: 'left', render: (s) => can('suppliers.edit') && s.balance > 0.009
            ? el('button.btn.btn-sm.btn-primary', { text: '💵 دفع', onclick: (e) => { e.stopPropagation(); paymentDialog('supplier', s, load); } })
            : null }
      ], rows, { onRowClick: (s) => showSupplier(s.id, load), emptyIcon: '🚚', emptyText: 'لا يوجد موردون' }));
    } catch (e) {
      listBox.innerHTML = ''; listBox.append(el('div.alert.alert-danger', { text: e.message }));
    }
  };

  const search = input({ placeholder: '🔍 ابحث بالاسم أو رقم الهاتف' });
  search.addEventListener('input', debounce(() => { q = search.value.trim(); load(); }, 280));

  const toolbar = el('div.toolbar', {}, [
    el('div.grow', {}, [search]),
    can('suppliers.edit') ? el('button.btn.btn-primary.btn-sm', { text: '＋ مورد جديد', onclick: () => editParty('supplier', null, load) }) : null
  ]);

  await load();
  return el('div', {}, [toolbar, statsBox, el('div.card', {}, [listBox])]);
}

async function showSupplier(id, onChanged) {
  const m = modal({ title: 'المورد', size: 'wide', body: spinner(), actions: [{ label: 'إغلاق', class: 'btn-outline' }] });
  try {
    const s = await api.supplier(id);
    const body = el('div', {}, [
      el('div.grid.g3', { style: { marginBottom: '18px' } }, [
        el('div.stat', { class: s.balance > 0.009 ? 'danger' : 'ok' }, [
          el('div.stat-label', { text: 'المستحق عليك' }), el('div.stat-value.num', { text: money(s.balance, false) })]),
        el('div.stat', { class: 'info' }, [el('div.stat-label', { text: 'عدد الفواتير' }), el('div.stat-value.num', { text: num(s.purchases.length) })]),
        el('div.stat', {}, [el('div.stat-label', { text: 'إجمالي المشتريات' }),
          el('div.stat-value.num', { text: money(s.purchases.reduce((a, p) => a + p.total, 0), false) })])
      ]),
      el('div.kv', {}, [el('span', { text: 'الهاتف' }), el('b.num', { text: s.phone || '—' })]),
      el('div.kv', {}, [el('span', { text: 'العنوان' }), el('b', { text: s.address || '—' })]),
      el('div.section-title', { text: 'فواتير الشراء' }),
      table([
        { title: 'الفاتورة', render: (p) => el('b.num', { text: p.invoice_no || '—' }) },
        { title: 'التاريخ', render: (p) => el('span.t-sm', { text: dateStr(p.date) }) },
        { title: 'الإجمالي', align: 'left', render: (p) => el('span.num', { text: money(p.total, false) }) },
        { title: 'المتبقي', align: 'left', render: (p) => {
            const r = p.total - p.paid;
            return r > 0.009 ? el('b.num.t-danger', { text: money(r, false) }) : el('span.badge.badge-ok', { text: 'مسدد' }); } }
      ], s.purchases.slice(0, 25), { emptyText: 'لا توجد فواتير' }),
      el('div.section-title', { text: 'الدفعات المسددة' }),
      table([
        { title: 'التاريخ', render: (p) => dateTimeStr(p.date) },
        { title: 'البيان', render: (p) => p.note || 'دفعة للمورد' },
        { title: 'المبلغ', align: 'left', render: (p) => el('b.num.t-ok', { text: money(p.amount, false) }) }
      ], s.payments.slice(0, 25), { emptyText: 'لا توجد دفعات' })
    ]);
    const mb = m.box.querySelector('.modal-body');
    mb.innerHTML = ''; mb.append(body);
    m.box.querySelector('.modal-head h3').textContent = s.name;
    if (can('suppliers.edit')) {
      addFirst(m.box.querySelector('.modal-foot'),
        s.balance > 0.009 ? el('button.btn.btn-primary', { text: '💵 تسجيل دفعة', onclick: () => { m.close(); paymentDialog('supplier', s, onChanged); } }) : null,
        el('button.btn.btn-outline', { text: '✏️ تعديل', onclick: () => { m.close(); editParty('supplier', s, onChanged); } })
      );
    }
  } catch (e) {
    const mb = m.box.querySelector('.modal-body');
    mb.innerHTML = ''; mb.append(el('div.alert.alert-danger', { text: e.message }));
  }
}

// ================= مشترك =================
function editParty(type, p, onSaved) {
  const isCustomer = type === 'customer';
  const isNew = !p;
  const form = el('div', {}, [
    el('div.row', {}, [
      field('الاسم *', input({ name: 'name', value: p?.name || '' })),
      field('رقم الهاتف', input({ name: 'phone', value: p?.phone || '' }))
    ]),
    field('العنوان', input({ name: 'address', value: p?.address || '' })),
    el('div.row', {}, [
      isCustomer ? field('حد الائتمان', input({ name: 'credit_limit', type: 'number', step: '50', value: p?.credit_limit ?? 0 }),
        'صفر = بدون حد. يمنع البيع بالآجل عند التجاوز') : null,
      field('رصيد افتتاحي', input({ name: 'opening_balance', type: 'number', step: '0.5', value: p?.opening_balance ?? 0 }),
        isCustomer ? 'مبلغ قديم على الزبون' : 'مبلغ قديم لك عند المورد')
    ].filter(Boolean)),
    field('ملاحظات', textarea({ name: 'notes', value: p?.notes || '' }))
  ]);

  modal({
    title: isNew ? (isCustomer ? 'زبون جديد' : 'مورد جديد') : 'تعديل: ' + p.name,
    body: form,
    actions: [
      { label: 'حفظ', class: 'btn-primary', onClick: async () => {
        const data = readForm(form);
        if (!data.name?.trim()) { toastErr('الاسم مطلوب'); return false; }
        try {
          if (isCustomer) await api.saveCustomer({ ...data, id: p?.id });
          else await api.saveSupplier({ ...data, id: p?.id });
          toastOk('تم الحفظ'); onSaved();
        } catch (e) { toastErr(e.message); return false; }
      }},
      { label: 'إلغاء', class: 'btn-outline' }
    ]
  });
}

function paymentDialog(type, party, onSaved) {
  const isCustomer = type === 'customer';
  const amount = input({ type: 'number', step: '0.5', value: Math.max(0, party.balance || 0).toFixed(2) });
  const note = input({ placeholder: isCustomer ? 'دفعة على الحساب' : 'دفعة للمورد' });
  const body = el('div', {}, [
    el('div.alert.alert-info', { text: `الرصيد الحالي: ${money(party.balance || 0)}` }),
    field('المبلغ', amount),
    field('البيان', note)
  ]);
  modal({
    title: isCustomer ? `تسديد من ${party.name}` : `دفع إلى ${party.name}`,
    size: 'narrow', body,
    actions: [
      { label: 'تسجيل الدفعة', class: 'btn-primary', onClick: async () => {
        const v = Number(amount.value);
        if (!(v > 0)) { toastErr('أدخل مبلغاً صحيحاً'); return false; }
        try {
          const r = await api.addPayment({ party_type: type, party_id: party.id, amount: v, note: note.value });
          toastOk(`تم تسجيل ${money(v)} — الرصيد الجديد ${money(r.balance)}`);
          onSaved(); app.refreshBadges();
        } catch (e) { toastErr(e.message); return false; }
      }},
      { label: 'إلغاء', class: 'btn-outline' }
    ]
  });
}

// ================= المصروفات =================
export async function expensesView() {
  let filter = { from: new Date().toISOString().slice(0, 8) + '01', to: new Date().toISOString().slice(0, 10) };
  const listBox = el('div.card-body.tight', {}, [spinner()]);
  const statsBox = el('div.grid.g3', { style: { marginBottom: '16px' } });

  const load = async () => {
    listBox.innerHTML = ''; listBox.append(spinner());
    try {
      const { rows, total } = await api.expenses(filter);
      const byCat = {};
      rows.forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + r.amount; });
      const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];

      statsBox.innerHTML = '';
      statsBox.append(
        statCard({ label: 'إجمالي المصروفات', icon: '💸', value: money(total), kind: 'danger' }),
        statCard({ label: 'عدد القيود', icon: '📋', value: num(rows.length) }),
        statCard({ label: 'أعلى بند', icon: '📊', value: top ? top[0] : '—', sub: top ? money(top[1]) : '' })
      );

      listBox.innerHTML = '';
      listBox.append(table([
        { title: 'التاريخ', render: (e2) => el('span.num', { text: dateStr(e2.date) }) },
        { title: 'البند', render: (e2) => el('span.badge.badge-muted', { text: e2.category }) },
        { title: 'البيان', render: (e2) => e2.note || '—' },
        { title: 'المسجِّل', render: (e2) => el('span.t-sm.t-muted', { text: e2.user_name || '—' }) },
        { title: 'المبلغ', align: 'left', render: (e2) => el('b.num.t-danger', { text: money(e2.amount, false) }) },
        { title: '', align: 'left', render: (e2) => el('button.btn.btn-sm.btn-ghost', {
            text: '🗑️', onclick: async () => {
              if (!await confirmDialog('حذف هذا القيد؟', { danger: true, okLabel: 'حذف' })) return;
              await api.deleteExpense(e2.id); toastOk('تم الحذف'); load();
            } }) }
      ], rows, { emptyIcon: '💸', emptyText: 'لا توجد مصروفات في هذه الفترة' }));
    } catch (e) {
      listBox.innerHTML = ''; listBox.append(el('div.alert.alert-danger', { text: e.message }));
    }
  };

  const fromI = input({ type: 'date', value: filter.from, onchange: (e) => { filter.from = e.target.value; load(); } });
  const toI = input({ type: 'date', value: filter.to, onchange: (e) => { filter.to = e.target.value; load(); } });

  const addExpense = () => {
    const cats = ['إيجار', 'كهرباء', 'رواتب', 'نظافة', 'صيانة', 'مواصلات', 'اتصالات', 'أخرى'];
    const form = el('div', {}, [
      el('div.row', {}, [
        field('التاريخ', input({ name: 'date', type: 'date', value: new Date().toISOString().slice(0, 10) })),
        field('البند', select(cats.map((c) => ({ value: c, label: c })), { name: 'category' }))
      ]),
      field('المبلغ', input({ name: 'amount', type: 'number', step: '0.5' })),
      field('البيان', input({ name: 'note' }))
    ]);
    modal({
      title: 'إضافة مصروف', body: form, size: 'narrow',
      actions: [
        { label: 'حفظ', class: 'btn-primary', onClick: async () => {
          const d = readForm(form);
          if (!(Number(d.amount) > 0)) { toastErr('أدخل مبلغاً صحيحاً'); return false; }
          try { await api.saveExpense(d); toastOk('تم الحفظ'); load(); }
          catch (e) { toastErr(e.message); return false; }
        }},
        { label: 'إلغاء', class: 'btn-outline' }
      ]
    });
  };

  const toolbar = el('div.toolbar', {}, [
    el('div', { style: { flex: '0 0 auto' } }, [fromI]),
    el('div', { style: { flex: '0 0 auto' } }, [toI]),
    el('div', { style: { flex: '1' } }),
    el('button.btn.btn-primary.btn-sm', { text: '＋ مصروف جديد', onclick: addExpense })
  ]);

  await load();
  return el('div', {}, [toolbar, statsBox, el('div.card', {}, [listBox])]);
}
