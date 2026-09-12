import { api, can } from '../api.js';
import { app } from '../app.js';
import {
  el, card, table, money, num, statCard, modal, field, input, select, textarea,
  toastOk, toastErr, dateStr, dateTimeStr, todayStr, daysAgoStr, debounce,
  confirmDialog, spinner, downloadCsv, emptyState, expiryBadge
} from '../ui.js';

export async function purchasesView() {
  let filter = { from: daysAgoStr(89), to: todayStr(), q: '' };
  const listBox = el('div.card-body.tight', {}, [spinner()]);
  const statsBox = el('div.grid.g3', { style: { marginBottom: '16px' } });

  const load = async () => {
    listBox.innerHTML = ''; listBox.append(spinner());
    try {
      const { rows, summary } = await api.purchases({ ...filter, limit: 200 });
      statsBox.innerHTML = '';
      statsBox.append(
        statCard({ label: 'عدد فواتير الشراء', icon: '📦', value: num(summary.count) }),
        statCard({ label: 'إجمالي المشتريات', icon: '💰', value: money(summary.total), kind: 'info' }),
        statCard({ label: 'مستحق للموردين', icon: '🚚', value: money(summary.total - summary.paid),
          kind: summary.total - summary.paid > 0 ? 'warn' : 'ok' })
      );
      listBox.innerHTML = '';
      listBox.append(table([
        { title: 'رقم الفاتورة', render: (r) => el('b.num', { text: r.invoice_no || '—' }) },
        { title: 'التاريخ', render: (r) => el('span.t-sm', { text: dateStr(r.date) }) },
        { title: 'المورد', render: (r) => r.supplier_name || '—' },
        { title: 'عدد البنود', align: 'center', render: (r) => el('span.num', { text: num(r.lines) }) },
        { title: 'الإجمالي', align: 'left', render: (r) => el('b.num', { text: money(r.total, false) }) },
        { title: 'المدفوع', align: 'left', render: (r) => el('span.num', { text: money(r.paid, false) }) },
        { title: 'المتبقي', align: 'left', render: (r) => {
            const rem = r.total - r.paid;
            return rem > 0.009 ? el('b.num.t-danger', { text: money(rem, false) }) : el('span.badge.badge-ok', { text: 'مسدد' });
          } }
      ], rows, { onRowClick: (r) => showPurchase(r.id, load), emptyIcon: '📦', emptyText: 'لا توجد فواتير شراء في هذه الفترة' }));
    } catch (e) {
      listBox.innerHTML = ''; listBox.append(el('div.alert.alert-danger', { text: e.message }));
    }
  };

  const fromI = input({ type: 'date', value: filter.from, onchange: (e) => { filter.from = e.target.value; load(); } });
  const toI = input({ type: 'date', value: filter.to, onchange: (e) => { filter.to = e.target.value; load(); } });
  const q = input({ placeholder: '🔍 رقم الفاتورة أو اسم المورد' });
  q.addEventListener('input', debounce(() => { filter.q = q.value.trim(); load(); }, 280));

  const toolbar = el('div.toolbar', {}, [
    el('div.grow', {}, [q]),
    el('div', { style: { flex: '0 0 auto' } }, [fromI]),
    el('div', { style: { flex: '0 0 auto' } }, [toI]),
    can('purchases.edit') ? el('button.btn.btn-primary.btn-sm', { text: '＋ فاتورة شراء', onclick: () => newPurchase(load) }) : null
  ]);

  await load();
  return el('div', {}, [toolbar, statsBox, el('div.card', {}, [listBox])]);
}

// ---------- فاتورة شراء جديدة ----------
async function newPurchase(onSaved) {
  const [suppliers, products] = await Promise.all([api.suppliers({}), api.products({ limit: 1000 })]);
  const lines = [];

  const supplierSel = select([{ value: '', label: '— اختر المورد —' },
    ...suppliers.map((s) => ({ value: s.id, label: s.name }))]);
  const invoiceNo = input({ placeholder: 'رقم فاتورة المورد' });
  const dateI = input({ type: 'date', value: todayStr() });
  const paidI = input({ type: 'number', step: '0.5', value: '0' });
  const notesI = input({ placeholder: 'ملاحظات' });

  const linesBox = el('div.card-body.tight');
  const totalBox = el('b.num', { text: money(0) });

  const productSearch = input({ placeholder: '🔍 ابحث عن الصنف لإضافته…', list: 'prodlist' });
  const dl = el('datalist', { id: 'prodlist' },
    products.map((p) => el('option', { value: p.name, 'data-id': p.id })));

  const recalc = () => {
    const t = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost_price) || 0), 0);
    totalBox.textContent = money(t);
  };

  const renderLines = () => {
    linesBox.innerHTML = '';
    if (!lines.length) {
      linesBox.append(emptyState('أضف الأصناف الواردة من المورد', '📦', 'ابحث عن الصنف في الحقل أعلاه'));
      recalc(); return;
    }
    linesBox.append(table([
      { title: 'الصنف', render: (l) => el('b', { text: l.name }) },
      { title: 'الكمية', align: 'center', render: (l) => el('input.input', {
          type: 'number', min: '1', step: '1', value: l.qty, style: { width: '80px', textAlign: 'center' },
          onchange: (e) => { l.qty = Math.max(1, Number(e.target.value) || 1); e.target.value = l.qty; recalc(); } }) },
      { title: 'تكلفة الوحدة', align: 'center', render: (l) => el('input.input', {
          type: 'number', min: '0', step: '0.25', value: l.cost_price, style: { width: '96px' },
          onchange: (e) => { l.cost_price = Math.max(0, Number(e.target.value) || 0); recalc(); } }) },
      { title: 'سعر البيع الجديد', align: 'center', render: (l) => el('input.input', {
          type: 'number', min: '0', step: '0.25', value: l.sale_price, style: { width: '96px' },
          onchange: (e) => { l.sale_price = Math.max(0, Number(e.target.value) || 0); } }) },
      { title: 'تاريخ الصلاحية', align: 'center', render: (l) => el('input.input', {
          type: 'date', value: l.expiry_date || '', style: { width: '150px' },
          onchange: (e) => { l.expiry_date = e.target.value; } }) },
      { title: 'رقم الدفعة', align: 'center', render: (l) => el('input.input', {
          value: l.batch_no || '', placeholder: 'اختياري', style: { width: '110px' },
          onchange: (e) => { l.batch_no = e.target.value; } }) },
      { title: 'الإجمالي', align: 'left', render: (l) => el('b.num', { text: money(l.qty * l.cost_price, false) }) },
      { title: '', align: 'left', render: (l, i) => el('button.btn.btn-ghost', {
          html: '&times;', style: { color: 'var(--danger)', fontSize: '18px' },
          onclick: () => { lines.splice(i, 1); renderLines(); } }) }
    ], lines));
    recalc();
  };

  const addProduct = (p) => {
    if (lines.find((l) => l.product_id === p.id)) { toastErr('الصنف مضاف بالفعل'); return; }
    lines.push({
      product_id: p.id, name: p.name, qty: 1,
      cost_price: p.cost_price || 0, sale_price: p.sale_price || 0,
      expiry_date: '', batch_no: ''
    });
    productSearch.value = '';
    renderLines();
  };

  productSearch.addEventListener('change', () => {
    const p = products.find((x) => x.name === productSearch.value.trim());
    if (p) addProduct(p);
  });
  productSearch.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = productSearch.value.trim();
    const p = products.find((x) => x.name === term) ||
              products.find((x) => x.barcode === term) ||
              products.find((x) => x.name.includes(term));
    if (p) addProduct(p); else toastErr('لم يتم العثور على الصنف');
  });

  const body = el('div', {}, [
    dl,
    el('div.row', {}, [
      field('المورد', supplierSel),
      field('رقم فاتورة المورد', invoiceNo),
      field('التاريخ', dateI)
    ]),
    el('div.section-title', { text: 'الأصناف الواردة' }),
    el('div.field', {}, [productSearch]),
    el('div.card', {}, [linesBox]),
    el('div.row', { style: { marginTop: '16px' } }, [
      field('المبلغ المدفوع للمورد', paidI, 'الباقي يُسجَّل ديناً على الصيدلية'),
      field('ملاحظات', notesI)
    ]),
    el('div.kv', { style: { fontSize: '17px', marginTop: '10px' } }, [
      el('span', { text: 'إجمالي الفاتورة' }), totalBox
    ])
  ]);

  renderLines();

  modal({
    title: 'فاتورة شراء جديدة', size: 'wide', body,
    actions: [
      { label: 'حفظ الفاتورة', class: 'btn-primary', onClick: async () => {
        if (!lines.length) { toastErr('أضف صنفاً واحداً على الأقل'); return false; }
        try {
          await api.createPurchase({
            supplier_id: supplierSel.value || null,
            invoice_no: invoiceNo.value || null,
            date: dateI.value,
            paid: Number(paidI.value) || 0,
            notes: notesI.value || null,
            items: lines.map((l) => ({
              product_id: l.product_id, qty: l.qty, cost_price: l.cost_price,
              sale_price: l.sale_price, expiry_date: l.expiry_date || null, batch_no: l.batch_no || null
            }))
          });
          toastOk('تم حفظ فاتورة الشراء وتحديث المخزون');
          onSaved();
          app.refreshBadges();
        } catch (e) { toastErr(e.message); return false; }
      }},
      { label: 'إلغاء', class: 'btn-outline' }
    ]
  });
}

// ---------- تفاصيل فاتورة شراء ----------
async function showPurchase(id, onChanged) {
  const m = modal({ title: 'فاتورة شراء', size: 'wide', body: spinner(), actions: [{ label: 'إغلاق', class: 'btn-outline' }] });
  try {
    const p = await api.purchase(id);
    const body = el('div', {}, [
      el('div.grid.g4', { style: { marginBottom: '18px' } }, [
        el('div.stat', {}, [el('div.stat-label', { text: 'الإجمالي' }), el('div.stat-value.num', { text: money(p.total, false) })]),
        el('div.stat', { class: 'ok' }, [el('div.stat-label', { text: 'المدفوع' }), el('div.stat-value.num', { text: money(p.paid, false) })]),
        el('div.stat', { class: p.total - p.paid > 0.009 ? 'danger' : '' }, [
          el('div.stat-label', { text: 'المتبقي للمورد' }), el('div.stat-value.num', { text: money(p.total - p.paid, false) })]),
        el('div.stat', { class: 'info' }, [el('div.stat-label', { text: 'عدد البنود' }), el('div.stat-value.num', { text: num(p.items.length) })])
      ]),
      el('div.grid.g2', { style: { marginBottom: '16px' } }, [
        el('div', {}, [
          el('div.kv', {}, [el('span', { text: 'المورد' }), el('b', { text: p.supplier_name || '—' })]),
          el('div.kv', {}, [el('span', { text: 'الهاتف' }), el('b.num', { text: p.supplier_phone || '—' })])
        ]),
        el('div', {}, [
          el('div.kv', {}, [el('span', { text: 'رقم الفاتورة' }), el('b.num', { text: p.invoice_no || '—' })]),
          el('div.kv', {}, [el('span', { text: 'التاريخ' }), el('b', { text: dateStr(p.date) })])
        ])
      ]),
      table([
        { title: 'الصنف', render: (i) => el('b', { text: i.product_name }) },
        { title: 'رقم الدفعة', render: (i) => el('span.num', { text: i.batch_no || '—' }) },
        { title: 'الصلاحية', render: (i) => expiryBadge(i.expiry_date) },
        { title: 'الكمية', align: 'center', render: (i) => el('span.num', { text: num(i.qty) }) },
        { title: 'المتبقي', align: 'center', render: (i) => el('span.num.t-muted', { text: num(i.remaining_qty ?? 0) }) },
        { title: 'التكلفة', align: 'left', render: (i) => el('span.num', { text: money(i.cost_price, false) }) },
        { title: 'الإجمالي', align: 'left', render: (i) => el('b.num', { text: money(i.qty * i.cost_price, false) }) }
      ], p.items)
    ]);
    const mb = m.box.querySelector('.modal-body');
    mb.innerHTML = ''; mb.append(body);
    m.box.querySelector('.modal-head h3').textContent = 'فاتورة شراء ' + (p.invoice_no || '');

    if (can('purchases.edit')) {
      const foot = m.box.querySelector('.modal-foot');
      foot.prepend(el('button.btn.btn-danger', { text: '🗑️ حذف الفاتورة', onclick: async () => {
        if (!await confirmDialog('سيتم حذف الفاتورة وسحب الكميات من المخزون. متابعة؟', { danger: true, okLabel: 'حذف' })) return;
        try {
          await api.deletePurchase(p.id);
          toastOk('تم حذف الفاتورة'); m.close(); onChanged();
        } catch (e) { toastErr(e.message); }
      }}));
    }
  } catch (e) {
    const mb = m.box.querySelector('.modal-body');
    mb.innerHTML = ''; mb.append(el('div.alert.alert-danger', { text: e.message }));
  }
}
