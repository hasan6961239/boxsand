import { api, can } from '../api.js';
import { app } from '../app.js';
import {
  el, card, table, money, num, modal, field, input, select, textarea, readForm,
  toastOk, toastErr, confirmDialog, expiryBadge, stockBadge, debounce, dateStr,
  downloadCsv, emptyState, spinner, daysBetween
} from '../ui.js';

export async function productsView() {
  const categories = await api.categories().catch(() => []);
  let filter = { q: '', category_id: '', stock_filter: '' };

  const listBox = el('div.card-body.tight', {}, [spinner()]);

  const load = async () => {
    listBox.innerHTML = '';
    listBox.append(spinner());
    try {
      const rows = await api.products({ ...filter, limit: 500 });
      listBox.innerHTML = '';
      listBox.append(table([
        { title: 'الصنف', render: (r) => el('div', {}, [
            el('b', { text: r.name + (r.strength ? ' — ' + r.strength : '') }),
            el('div.t-sm.t-muted', { text: [r.generic_name, r.form, r.manufacturer].filter(Boolean).join(' · ') })
          ]) },
        { title: 'التصنيف', render: (r) => el('span.t-sm', { text: r.category_name || '—' }) },
        { title: 'المخزون', align: 'center', render: (r) => el('div', {}, [
            stockBadge(r.sellable_stock ?? r.stock, r.min_stock),
            r.expired_qty > 0
              ? el('div', { style: { marginTop: '3px' } }, [
                  el('span.badge.badge-danger', { text: `${num(r.expired_qty)} منتهية` })])
              : null
          ]) },
        { title: 'أقرب صلاحية', align: 'center', render: (r) => expiryBadge(r.nearest_expiry) },
        { title: 'التكلفة', align: 'left', render: (r) => el('span.num.t-muted', { text: money(r.cost_price, false) }) },
        { title: 'سعر البيع', align: 'left', render: (r) => el('b.num', { text: money(r.sale_price, false) }) },
        { title: 'الربح', align: 'left', render: (r) => {
            const m = r.sale_price - r.cost_price;
            const pct = r.sale_price > 0 ? (m / r.sale_price) * 100 : 0;
            return el('span.num', { class: m > 0 ? 't-ok' : 't-danger', text: `${money(m, false)} (${pct.toFixed(0)}%)` });
          } },
        { title: '', align: 'left', render: (r) => el('div.btn-row', {}, [
            el('button.btn.btn-sm.btn-ghost', { text: '👁️', title: 'تفاصيل', onclick: (e) => { e.stopPropagation(); showProduct(r.id); } }),
            can('products.edit') ? el('button.btn.btn-sm.btn-ghost', { text: '✏️', title: 'تعديل', onclick: (e) => { e.stopPropagation(); editProduct(r, categories, load); } }) : null
          ]) }
      ], rows, {
        onRowClick: (r) => showProduct(r.id),
        emptyIcon: '💊',
        emptyText: 'لا توجد أصناف مطابقة',
        emptyHint: 'جرّب تغيير كلمة البحث أو الفلتر'
      }));

      countLabel.textContent = `${rows.length} صنف`;
      exportBtn.onclick = () => downloadCsv('الأصناف', [
        { title: 'الاسم', key: 'name' }, { title: 'المادة الفعالة', key: 'generic_name' },
        { title: 'الشكل', key: 'form' }, { title: 'التركيز', key: 'strength' },
        { title: 'الشركة', key: 'manufacturer' }, { title: 'التصنيف', key: 'category_name' },
        { title: 'المخزون', key: 'stock' }, { title: 'الحد الأدنى', key: 'min_stock' },
        { title: 'التكلفة', key: 'cost_price' }, { title: 'سعر البيع', key: 'sale_price' },
        { title: 'أقرب صلاحية', key: 'nearest_expiry' }, { title: 'الباركود', key: 'barcode' }
      ], rows);
    } catch (e) {
      listBox.innerHTML = '';
      listBox.append(el('div.alert.alert-danger', { text: e.message }));
    }
  };

  const searchBox = input({ placeholder: '🔍 ابحث بالاسم أو المادة الفعالة أو الباركود…' });
  searchBox.addEventListener('input', debounce(() => { filter.q = searchBox.value.trim(); load(); }, 260));

  const catSelect = select(
    [{ value: '', label: 'كل التصنيفات' }, ...categories.map((c) => ({ value: c.id, label: `${c.name} (${c.products_count})` }))],
    { onchange: (e) => { filter.category_id = e.target.value; load(); } });

  const stockSelect = select(
    [{ value: '', label: 'كل الحالات' }, { value: 'low', label: 'ناقصة فقط' }, { value: 'out', label: 'نافدة فقط' }],
    { onchange: (e) => { filter.stock_filter = e.target.value; load(); } });

  const countLabel = el('span.t-sm.t-muted');
  const exportBtn = el('button.btn.btn-sm.btn-outline', { text: '⬇️ تصدير Excel' });

  const toolbar = el('div.toolbar', {}, [
    el('div.grow', {}, [searchBox]),
    catSelect, stockSelect, countLabel,
    el('div', { style: { flex: '1' } }),
    exportBtn,
    can('products.edit') ? el('button.btn.btn-sm.btn-outline', { text: '🏷️ التصنيفات', onclick: () => manageCategories(categories) }) : null,
    can('products.edit') ? el('button.btn.btn-primary.btn-sm', { text: '＋ صنف جديد', onclick: () => editProduct(null, categories, load) }) : null
  ]);

  await load();
  return el('div', {}, [toolbar, el('div.card', {}, [listBox])]);
}

// ---------- تفاصيل الصنف ----------
async function showProduct(id) {
  const m = modal({ title: 'تفاصيل الصنف', size: 'wide', body: spinner(), actions: [{ label: 'إغلاق', class: 'btn-outline' }] });
  try {
    const p = await api.product(id);
    const body = el('div');

    body.append(el('div.grid.g4', { style: { marginBottom: '18px' } }, [
      el('div.stat', {}, [el('div.stat-label', { text: 'المخزون الحالي' }), el('div.stat-value.num', { text: num(p.stock) })]),
      el('div.stat', { class: 'info' }, [el('div.stat-label', { text: 'سعر البيع' }), el('div.stat-value.num', { text: money(p.sale_price, false) })]),
      el('div.stat', {}, [el('div.stat-label', { text: 'التكلفة' }), el('div.stat-value.num', { text: money(p.cost_price, false) })]),
      el('div.stat', { class: 'ok' }, [el('div.stat-label', { text: 'قيمة المخزون' }), el('div.stat-value.num', { text: money(p.stock * p.cost_price, false) })])
    ]));

    body.append(el('div.grid.g2', {}, [
      el('div', {}, [
        el('div.section-title', { text: 'بيانات الصنف' }),
        el('div.kv', {}, [el('span', { text: 'المادة الفعالة' }), el('b', { text: p.generic_name || '—' })]),
        el('div.kv', {}, [el('span', { text: 'الشكل الدوائي' }), el('b', { text: p.form || '—' })]),
        el('div.kv', {}, [el('span', { text: 'التركيز' }), el('b', { text: p.strength || '—' })]),
        el('div.kv', {}, [el('span', { text: 'الشركة' }), el('b', { text: p.manufacturer || '—' })]),
        el('div.kv', {}, [el('span', { text: 'التصنيف' }), el('b', { text: p.category_name || '—' })]),
        el('div.kv', {}, [el('span', { text: 'الباركود' }), el('b.num', { text: p.barcode || '—' })]),
        el('div.kv', {}, [el('span', { text: 'موقع الرف' }), el('b', { text: p.location || '—' })]),
        el('div.kv', {}, [el('span', { text: 'الحد الأدنى' }), el('b.num', { text: num(p.min_stock) })]),
        el('div.kv', {}, [el('span', { text: 'يحتاج وصفة' }), el('b', { text: p.requires_prescription ? 'نعم' : 'لا' })])
      ]),
      el('div', {}, [
        el('div.section-title', { text: `البدائل المتاحة (نفس المادة الفعالة)` }),
        p.alternatives.length
          ? el('div', {}, p.alternatives.map((a) => el('div.kv', {}, [
              el('span', {}, [a.name, a.strength ? el('span.t-sm.t-muted', { text: ' ' + a.strength }) : null]),
              el('b', {}, [
                el('span.num', { text: money(a.sale_price, false) + '  ' }),
                stockBadge(a.stock, a.min_stock)
              ])
            ])))
          : emptyState('لا توجد بدائل مسجلة بنفس المادة الفعالة', '🔄')
      ])
    ]));

    body.append(el('div.section-title', { text: 'الدفعات في المخزون' }));
    body.append(table([
      { title: 'رقم الدفعة', render: (b) => el('span.num', { text: b.batch_no || '—' }) },
      { title: 'تاريخ الصلاحية', render: (b) => expiryBadge(b.expiry_date) },
      { title: 'الكمية', align: 'center', render: (b) => el('b.num', { class: b.qty <= 0 ? 't-muted' : '', text: num(b.qty) }) },
      { title: 'التكلفة', align: 'left', render: (b) => el('span.num', { text: money(b.cost_price, false) }) },
      { title: 'القيمة', align: 'left', render: (b) => el('span.num', { text: money(b.qty * b.cost_price, false) }) }
    ], p.batches.filter((b) => b.qty > 0), { emptyIcon: '📦', emptyText: 'لا توجد دفعات برصيد' }));

    m.box.querySelector('.modal-body').innerHTML = '';
    m.box.querySelector('.modal-body').append(body);
    m.box.querySelector('.modal-head h3').textContent = p.name;
  } catch (e) {
    m.box.querySelector('.modal-body').innerHTML = '';
    m.box.querySelector('.modal-body').append(el('div.alert.alert-danger', { text: e.message }));
  }
}

// ---------- إضافة / تعديل صنف ----------
function editProduct(p, categories, onSaved) {
  const isNew = !p;
  const form = el('div');
  const f = {
    name: input({ name: 'name', value: p?.name || '', required: true }),
    generic_name: input({ name: 'generic_name', value: p?.generic_name || '' }),
    form: input({ name: 'form', value: p?.form || '', list: 'forms' }),
    strength: input({ name: 'strength', value: p?.strength || '' }),
    manufacturer: input({ name: 'manufacturer', value: p?.manufacturer || '' }),
    barcode: input({ name: 'barcode', value: p?.barcode || '' }),
    category_id: select([{ value: '', label: '— بدون تصنيف —' },
      ...categories.map((c) => ({ value: c.id, label: c.name, selected: p?.category_id === c.id }))], { name: 'category_id' }),
    unit: input({ name: 'unit', value: p?.unit || 'علبة' }),
    sale_price: input({ name: 'sale_price', type: 'number', step: '0.25', value: p?.sale_price ?? 0 }),
    min_stock: input({ name: 'min_stock', type: 'number', step: '1', value: p?.min_stock ?? 0 }),
    location: input({ name: 'location', value: p?.location || '' }),
    requires_prescription: el('input', { name: 'requires_prescription', type: 'checkbox', ...(p?.requires_prescription ? { checked: true } : {}) }),
    notes: textarea({ name: 'notes', value: p?.notes || '' })
  };

  const dl = el('datalist', { id: 'forms' }, ['أقراص', 'كبسول', 'شراب', 'حقن', 'كريم', 'مرهم', 'جل موضعي',
    'قطرة عين', 'قطرة أذن', 'بخاخ', 'تحاميل', 'أكياس', 'أقراص فوارة'].map((v) => el('option', { value: v })));

  form.append(dl,
    el('div.row', {}, [field('اسم الصنف التجاري *', f.name), field('المادة الفعالة', f.generic_name, 'تُستخدم لاقتراح البدائل')]),
    el('div.row', {}, [field('الشكل الدوائي', f.form), field('التركيز', f.strength), field('الوحدة', f.unit)]),
    el('div.row', {}, [field('الشركة المصنعة', f.manufacturer), field('التصنيف', f.category_id)]),
    el('div.row', {}, [field('الباركود', f.barcode), field('موقع الرف', f.location)]),
    el('div.row', {}, [field('سعر البيع', f.sale_price), field('الحد الأدنى للتنبيه', f.min_stock, 'ينبهك عند وصول المخزون لهذا الرقم')]),
    el('div.field', {}, [el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' } },
      [f.requires_prescription, 'يُصرف بوصفة طبية فقط'])]),
    field('ملاحظات', f.notes)
  );

  if (isNew) {
    form.append(
      el('div.section-title', { text: 'رصيد افتتاحي (اختياري)' }),
      el('div.row', {}, [
        field('الكمية', input({ name: 'opening_qty', type: 'number', step: '1', value: '' })),
        field('التكلفة للوحدة', input({ name: 'opening_cost', type: 'number', step: '0.25', value: '' })),
        field('تاريخ الصلاحية', input({ name: 'opening_expiry', type: 'date' })),
        field('رقم الدفعة', input({ name: 'opening_batch_no' }))
      ])
    );
  }

  const m = modal({
    title: isNew ? 'إضافة صنف جديد' : 'تعديل: ' + p.name,
    size: 'wide',
    body: form,
    actions: [
      { label: 'حفظ', class: 'btn-primary', onClick: async () => {
        const data = readForm(form);
        if (!data.name?.trim()) { toastErr('اسم الصنف مطلوب'); return false; }
        try {
          await api.saveProduct({ ...data, id: p?.id });
          toastOk(isNew ? 'تمت إضافة الصنف' : 'تم حفظ التعديلات');
          onSaved();
        } catch (e) { toastErr(e.message); return false; }
      }},
      !isNew && can('products.edit') ? { label: 'حذف', class: 'btn-danger', keepOpen: true, onClick: async (close) => {
        if (!await confirmDialog(`سيتم حذف «${p.name}». هل أنت متأكد؟`, { danger: true, okLabel: 'حذف' })) return;
        try {
          const r = await api.deleteProduct(p.id);
          toastOk(r.message || 'تم الحذف');
          close(); onSaved();
        } catch (e) { toastErr(e.message); }
      }} : null,
      { label: 'إلغاء', class: 'btn-outline' }
    ].filter(Boolean)
  });
  return m;
}

// ---------- التصنيفات ----------
function manageCategories(categories) {
  const listBox = el('div');
  const render = async () => {
    const cats = await api.categories();
    categories.length = 0; cats.forEach((c) => categories.push(c));
    listBox.innerHTML = '';
    listBox.append(table([
      { title: 'التصنيف', key: 'name' },
      { title: 'عدد الأصناف', align: 'center', render: (c) => el('span.num', { text: num(c.products_count) }) },
      { title: '', align: 'left', render: (c) => el('button.btn.btn-sm.btn-ghost', {
          text: '🗑️', title: 'حذف', onclick: async () => {
            if (!await confirmDialog(`حذف التصنيف «${c.name}»؟ الأصناف بداخله ستبقى بدون تصنيف.`, { danger: true, okLabel: 'حذف' })) return;
            await api.deleteCategory(c.id); toastOk('تم الحذف'); render();
          } }) }
    ], cats, { emptyText: 'لا توجد تصنيفات' }));
  };
  const nameInput = input({ placeholder: 'اسم التصنيف الجديد' });
  const body = el('div', {}, [
    el('div.row', { style: { marginBottom: '14px' } }, [
      nameInput,
      el('button.btn.btn-primary', { text: 'إضافة', style: { flex: '0 0 auto' }, onclick: async () => {
        if (!nameInput.value.trim()) return;
        await api.saveCategory({ name: nameInput.value.trim() });
        nameInput.value = ''; toastOk('تمت الإضافة'); render();
      }})
    ]),
    listBox
  ]);
  render();
  modal({ title: 'إدارة التصنيفات', body, actions: [{ label: 'إغلاق', class: 'btn-outline', onClick: () => app.reload() }] });
}
