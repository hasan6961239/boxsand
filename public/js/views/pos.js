import { api, state } from '../api.js';
import { app } from '../app.js';
import {
  el, add, card, money, num, toast, toastOk, toastErr, modal, field, input, select,
  debounce, expiryBadge, daysBetween, printNode, dateTimeStr, emptyState, confirmDialog
} from '../ui.js';

export async function posView() {
  const [customers, held] = await Promise.all([
    api.customers({}).catch(() => []),
    api.heldSales().catch(() => [])
  ]);

  const cart = [];          // {product_id,name,unit,price,qty,stock,nearest_expiry,max}
  let discount = 0;
  let paymentMethod = 'cash';
  let customerId = '';

  // ---------- البحث ----------
  const searchInput = el('input.input.input-lg', {
    placeholder: 'امسح الباركود أو اكتب اسم الدواء / المادة الفعالة…',
    autocomplete: 'off'
  });
  const results = el('div.pos-results.hidden');
  let hits = [];
  let sel = -1;

  const renderResults = () => {
    results.innerHTML = '';
    if (!hits.length) { results.classList.add('hidden'); return; }
    hits.forEach((p, i) => {
      const days = p.nearest_expiry ? daysBetween(p.nearest_expiry) : null;
      const avail = p.sellable_stock ?? p.stock;
      const out = avail <= 0;
      results.append(el('div.pos-result', {
        class: i === sel ? 'sel' : '',
        onclick: () => addToCart(p)
      }, [
        el('div.pr-main', {}, [
          el('div.pr-name', {}, [
            p.name,
            p.strength ? el('span.t-muted.t-sm', { text: ' — ' + p.strength }) : null
          ]),
          el('div.pr-meta', { text: [p.generic_name, p.form, p.manufacturer].filter(Boolean).join(' · ') })
        ]),
        days !== null && days <= 90 ? expiryBadge(p.nearest_expiry) : null,
        el('span.badge', {
          class: out ? 'badge-danger' : avail <= p.min_stock ? 'badge-warn' : 'badge-muted',
          text: out ? 'نفد' : `متوفر ${num(avail)}`
        }),
        el('div.pr-price.num', { text: money(p.sale_price, false) })
      ]));
    });
    results.classList.remove('hidden');
  };

  const doSearch = debounce(async (q) => {
    if (!q || q.length < 1) { hits = []; renderResults(); return; }
    try {
      hits = await api.searchProducts(q);
      sel = hits.length ? 0 : -1;
      // الباركود الكامل: أضف مباشرة
      if (hits.length === 1 && hits[0].barcode === q) { addToCart(hits[0]); return; }
      renderResults();
    } catch (e) { toastErr(e.message); }
  }, 180);

  searchInput.addEventListener('input', () => doSearch(searchInput.value.trim()));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, hits.length - 1); renderResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); renderResults(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (hits[sel]) addToCart(hits[sel]);
    } else if (e.key === 'Escape') { hits = []; renderResults(); searchInput.value = ''; }
  });
  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== searchInput) results.classList.add('hidden');
  });

  // ---------- السلة ----------
  const cartBody = el('div.card-body.tight');
  const totalsBox = el('div.pos-total');

  function addToCart(p) {
    searchInput.value = '';
    hits = []; sel = -1; renderResults();
    searchInput.focus();

    const avail = p.sellable_stock ?? p.stock;
    if (avail <= 0) {
      toastErr(p.expired_qty > 0
        ? `«${p.name}» متوفر لكن كل دفعاته منتهية الصلاحية — لا يمكن بيعه`
        : `الصنف «${p.name}» غير متوفر في المخزون`);
      return;
    }
    if (p.expired_qty > 0) {
      toast(`انتبه: ${num(p.expired_qty)} وحدة من «${p.name}» منتهية الصلاحية على الرف — اسحبها`, 'warn', 5000);
    }

    const days = p.nearest_expiry ? daysBetween(p.nearest_expiry) : null;
    if (days !== null && days <= 30) {
      toast(`تنبيه: أقرب دفعة من «${p.name}» تنتهي خلال ${days} يوم`, 'warn', 4000);
    }

    const existing = cart.find((c) => c.product_id === p.id);
    if (existing) {
      if (existing.qty + 1 > existing.stock) { toastErr('لا توجد كمية إضافية في المخزون'); return; }
      existing.qty += 1;
    } else {
      cart.push({
        product_id: p.id, name: p.name, unit: p.unit, price: p.sale_price,
        qty: 1, stock: avail, nearest_expiry: p.nearest_expiry,
        generic_name: p.generic_name, strength: p.strength
      });
    }
    renderCart();
  }

  function renderCart() {
    cartBody.innerHTML = '';
    if (!cart.length) {
      cartBody.append(el('div.empty-cart', {}, [
        el('span.ic', { text: '🛒' }),
        el('div', { text: 'السلة فارغة' }),
        el('div.t-sm', { text: 'امسح الباركود أو ابحث عن الدواء لإضافته', style: { marginTop: '4px' } })
      ]));
    } else {
      cart.forEach((it, i) => {
        const qtyInput = el('input', {
          type: 'number', value: it.qty, min: '1', step: '1',
          onchange: (e) => {
            const v = Math.max(1, Number(e.target.value) || 1);
            if (v > it.stock) { toastErr(`المتاح فقط ${num(it.stock)}`); e.target.value = it.qty; return; }
            it.qty = v; renderCart();
          }
        });
        cartBody.append(el('div.cart-item', {}, [
          el('div.cart-name', {}, [
            el('b', { text: it.name + (it.strength ? ' — ' + it.strength : '') }),
            el('span', { text: `${money(it.price)} / ${it.unit || 'وحدة'}` })
          ]),
          el('div.qty-box', {}, [
            el('button', { text: '+', onclick: () => {
              if (it.qty + 1 > it.stock) return toastErr(`المتاح فقط ${num(it.stock)}`);
              it.qty++; renderCart();
            }}),
            qtyInput,
            el('button', { text: '−', onclick: () => { it.qty > 1 ? it.qty-- : cart.splice(i, 1); renderCart(); } })
          ]),
          el('div.t-bold.num', { text: money(it.qty * it.price, false), style: { minWidth: '72px', textAlign: 'left' } }),
          el('button.btn.btn-ghost', { html: '&times;', title: 'حذف', onclick: () => { cart.splice(i, 1); renderCart(); },
            style: { color: 'var(--danger)', fontSize: '18px' } })
        ]));
      });
    }
    renderTotals();
  }

  const discountInput = el('input.input', {
    type: 'number', value: '0', min: '0', step: '0.5',
    onchange: (e) => { discount = Math.max(0, Number(e.target.value) || 0); renderTotals(); }
  });

  const customerSelect = select(
    [{ value: '', label: '— بدون زبون (نقدي) —' },
     ...customers.map((c) => ({ value: c.id, label: c.name + (c.balance > 0 ? ` (عليه ${money(c.balance, false)})` : '') }))],
    { onchange: (e) => { customerId = e.target.value; } }
  );

  const methodSelect = select(
    [{ value: 'cash', label: '💵 نقدي' }, { value: 'credit', label: '📝 آجل (على الحساب)' }],
    { onchange: (e) => { paymentMethod = e.target.value; renderTotals(); } }
  );

  const paidInput = el('input.input', { type: 'number', value: '0', min: '0', step: '0.5', onchange: () => renderTotals() });
  const cashGivenInput = el('input.input.input-lg', { type: 'number', placeholder: 'المبلغ المستلم', step: '0.5',
    oninput: () => renderChange() });
  const changeBox = el('div.t-sm.t-muted', { text: 'الباقي: —' });

  function subtotal() { return cart.reduce((s, i) => s + i.qty * i.price, 0); }
  function total() { return Math.max(0, subtotal() - discount); }

  function renderChange() {
    const given = Number(cashGivenInput.value) || 0;
    const t = total();
    if (!given) { changeBox.textContent = 'الباقي: —'; changeBox.className = 't-sm t-muted'; return; }
    const change = given - t;
    changeBox.textContent = change >= 0 ? `الباقي للزبون: ${money(change)}` : `ناقص: ${money(Math.abs(change))}`;
    changeBox.className = change >= 0 ? 't-sm t-ok t-bold' : 't-sm t-danger t-bold';
  }

  function renderTotals() {
    const sub = subtotal();
    const t = total();
    totalsBox.innerHTML = '';
    add(totalsBox,
      el('div.line', {}, [el('span', { text: `الأصناف (${cart.length})` }), el('span.num', { text: money(sub, false) })]),
      discount > 0 ? el('div.line', {}, [el('span', { text: 'الخصم' }), el('span.num', { text: '− ' + money(discount, false) })]) : null,
      el('div.line.grand', {}, [el('span', { text: 'الإجمالي' }), el('span.num', { text: money(t) })])
    );
    paidRow.classList.toggle('hidden', paymentMethod !== 'credit');
    cashRow.classList.toggle('hidden', paymentMethod !== 'cash');
    renderChange();
    checkoutBtn.disabled = !cart.length;
    checkoutBtn.textContent = cart.length ? `إتمام البيع — ${money(t)}` : 'إتمام البيع';
  }

  const paidRow = el('div.field.hidden', {}, [el('label', { text: 'المدفوع الآن (الباقي يُسجَّل ديناً)' }), paidInput]);
  const cashRow = el('div.field', {}, [el('label', { text: 'المبلغ المستلم من الزبون' }), cashGivenInput, changeBox]);

  // ---------- الإتمام ----------
  const checkoutBtn = el('button.btn.btn-primary.btn-lg.btn-block', { text: 'إتمام البيع', disabled: true });

  checkoutBtn.addEventListener('click', async () => {
    if (!cart.length) return;
    if (paymentMethod === 'credit' && !customerId) {
      toastErr('البيع بالآجل يتطلب اختيار زبون'); customerSelect.focus(); return;
    }
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = 'جارٍ الحفظ…';
    try {
      const sale = await api.createSale({
        items: cart.map((c) => ({ product_id: c.product_id, qty: c.qty, price: c.price })),
        discount,
        payment_method: paymentMethod,
        customer_id: customerId || null,
        paid: paymentMethod === 'credit' ? (Number(paidInput.value) || 0) : undefined
      });
      const change = paymentMethod === 'cash' ? (Number(cashGivenInput.value) || 0) - sale.total : 0;
      toastOk(`تم حفظ الفاتورة ${sale.invoice_no}`);
      showReceipt(sale, change > 0 ? change : 0);
      cart.length = 0;
      discount = 0; discountInput.value = '0';
      cashGivenInput.value = ''; paidInput.value = '0';
      customerId = ''; customerSelect.value = '';
      paymentMethod = 'cash'; methodSelect.value = 'cash';
      renderCart();
      searchInput.focus();
      app.refreshBadges();
    } catch (e) {
      toastErr(e.message);
    } finally {
      checkoutBtn.disabled = !cart.length;
      renderTotals();
    }
  });

  // ---------- الفاتورة المطبوعة ----------
  function receiptNode(sale, change = 0) {
    const s = state.settings;
    return el('div.receipt', {}, [
      el('h3', { text: s.pharmacy_name || 'صيدليتي' }),
      el('div.r-sub', { text: [s.pharmacy_address, s.pharmacy_phone].filter(Boolean).join(' — ') || '' }),
      el('hr'),
      el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '10.5px' } }, [
        el('span', { text: 'فاتورة: ' + sale.invoice_no }),
        el('span', { text: dateTimeStr(sale.date) })
      ]),
      sale.customer_name ? el('div', { text: 'الزبون: ' + sale.customer_name, style: { fontSize: '10.5px' } }) : null,
      el('div', { text: 'البائع: ' + (sale.user_name || ''), style: { fontSize: '10.5px' } }),
      el('hr'),
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'الصنف' }), el('th', { text: 'كمية' }),
          el('th', { text: 'سعر' }), el('th', { text: 'إجمالي' })
        ])]),
        el('tbody', {}, sale.items.map((i) => el('tr', {}, [
          el('td', { text: i.product_name }),
          el('td', { text: num(i.qty) }),
          el('td', { text: money(i.price, false) }),
          el('td', { text: money(i.qty * i.price, false) })
        ])))
      ]),
      el('hr'),
      el('div.r-tot', {}, [el('span', { text: 'المجموع' }), el('span', { text: money(sale.subtotal, false) })]),
      sale.discount > 0 ? el('div.r-tot', {}, [el('span', { text: 'الخصم' }), el('span', { text: '− ' + money(sale.discount, false) })]) : null,
      el('div.r-tot.big', {}, [el('span', { text: 'الإجمالي' }), el('span', { text: money(sale.total) })]),
      sale.payment_method === 'credit'
        ? el('div.r-tot', {}, [el('span', { text: 'المدفوع / المتبقي' }), el('span', { text: `${money(sale.paid, false)} / ${money(sale.total - sale.paid, false)}` })])
        : (change > 0 ? el('div.r-tot', {}, [el('span', { text: 'الباقي' }), el('span', { text: money(change, false) })]) : null),
      el('hr'),
      el('div.r-foot', { text: s.receipt_footer || 'شكراً لزيارتكم' }),
      el('div.r-foot', { text: 'منظومة صيدليتي' })
    ]);
  }

  function showReceipt(sale, change) {
    const node = receiptNode(sale, change);
    modal({
      title: 'تمت العملية بنجاح ✔',
      size: 'narrow',
      body: el('div', { style: { display: 'flex', justifyContent: 'center' } }, [node]),
      actions: [
        { label: '🖨️ طباعة الفاتورة', class: 'btn-primary', keepOpen: true, onClick: () => printNode(node, sale.invoice_no) },
        { label: 'إغلاق', class: 'btn-outline' }
      ]
    });
  }

  // ---------- تعليق الفاتورة ----------
  async function holdCurrent() {
    if (!cart.length) return toastErr('السلة فارغة');
    try {
      await api.holdSale({ items: cart.map((c) => ({ ...c })), discount, customer_id: customerId, payment_method: paymentMethod });
      toastOk('تم تعليق الفاتورة — يمكنك استرجاعها لاحقاً');
      cart.length = 0; renderCart();
      app.reload();
    } catch (e) { toastErr(e.message); }
  }

  function showHeld() {
    if (!held.length) return toast('لا توجد فواتير معلّقة');
    const body = el('div', {}, held.slice().reverse().map((h) =>
      el('div', { style: { padding: '11px 0', borderBottom: '1px solid var(--ink-100)', display: 'flex', gap: '10px', alignItems: 'center' } }, [
        el('div', { style: { flex: '1' } }, [
          el('b', { text: `${h.items.length} صنف — ${money(h.items.reduce((s, i) => s + i.qty * i.price, 0))}` }),
          el('div.t-sm.t-muted', { text: `${h.user} · ${dateTimeStr(h.at)}` })
        ]),
        el('button.btn.btn-sm.btn-primary', { text: 'استرجاع', onclick: async () => {
          cart.length = 0;
          h.items.forEach((i) => cart.push({ ...i }));
          discount = h.discount || 0; discountInput.value = discount;
          renderCart();
          await api.dropHeld(h.id).catch(() => {});
          document.querySelector('.modal-backdrop')?.remove();
          toastOk('تم استرجاع الفاتورة');
        }})
      ])
    ));
    modal({ title: 'الفواتير المعلّقة', body, actions: [{ label: 'إغلاق', class: 'btn-outline' }] });
  }

  // ---------- اختصارات لوحة المفاتيح ----------
  const onKey = (e) => {
    if (app.current !== 'pos') return;
    if (e.key === 'F2') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
    if (e.key === 'F4') { e.preventDefault(); if (!checkoutBtn.disabled) checkoutBtn.click(); }
    if (e.key === 'F8') { e.preventDefault(); holdCurrent(); }
  };
  document.addEventListener('keydown', onKey);

  // ---------- التجميع ----------
  const left = el('div', {}, [
    el('div.card', {}, [
      el('div.card-body', {}, [
        el('div.pos-search', {}, [searchInput, results]),
        el('div.t-sm.t-muted', { style: { marginTop: '8px' },
          html: '⌨️ <b>F2</b> بحث · <b>F4</b> إتمام البيع · <b>F8</b> تعليق الفاتورة · قارئ الباركود يعمل مباشرة' })
      ])
    ]),
    el('div.card', { style: { marginTop: '16px' } }, [
      el('div.card-head', {}, [
        el('h3', { text: 'سلة المشتريات' }),
        el('div.spacer'),
        el('button.btn.btn-sm.btn-ghost', { text: '📋 المعلّقة (' + held.length + ')', onclick: showHeld }),
        el('button.btn.btn-sm.btn-ghost', { text: '⏸️ تعليق', onclick: holdCurrent }),
        el('button.btn.btn-sm.btn-ghost', { text: '🗑️ تفريغ', onclick: async () => {
          if (!cart.length) return;
          if (await confirmDialog('سيتم تفريغ السلة بالكامل. متابعة؟', { danger: true, okLabel: 'تفريغ' })) {
            cart.length = 0; renderCart();
          }
        }})
      ]),
      cartBody
    ])
  ]);

  const right = el('div.card', {}, [
    el('div.card-head', {}, [el('h3', { text: 'الدفع' })]),
    el('div.card-body', {}, [
      field('الزبون', customerSelect),
      field('طريقة الدفع', methodSelect),
      field('الخصم', discountInput),
      paidRow,
      cashRow
    ]),
    totalsBox,
    el('div', { style: { padding: '14px' } }, [checkoutBtn])
  ]);

  renderCart();
  setTimeout(() => searchInput.focus(), 120);

  const view = el('div.pos', {}, [left, right]);
  view.cleanup = () => document.removeEventListener('keydown', onKey);
  return view;
}
