import { api, state } from '../api.js';
import { app, changePasswordDialog } from '../app.js';
import {
  el, card, table, money, num, modal, field, input, select, textarea, readForm,
  toastOk, toastErr, dateTimeStr, confirmDialog, spinner, setCurrency, emptyState
} from '../ui.js';

const ROLES = [
  { value: 'admin', label: 'مدير — كل الصلاحيات' },
  { value: 'pharmacist', label: 'صيدلي — بيع ومخزون ومشتريات وتقارير' },
  { value: 'cashier', label: 'كاشير — البيع والزبائن فقط' }
];
const ROLE_LABEL = { admin: 'مدير', pharmacist: 'صيدلي', cashier: 'كاشير' };

// ================= المستخدمون =================
export async function usersView() {
  const listBox = el('div.card-body.tight', {}, [spinner()]);

  const load = async () => {
    listBox.innerHTML = ''; listBox.append(spinner());
    try {
      const rows = await api.users();
      listBox.innerHTML = '';
      listBox.append(table([
        { title: 'الاسم', render: (u) => el('div', {}, [
            el('b', { text: u.full_name }),
            el('div.t-sm.t-muted.num', { text: u.username }) ]) },
        { title: 'الصلاحية', align: 'center', render: (u) => el('span.badge', {
            class: u.role === 'admin' ? 'badge-info' : u.role === 'pharmacist' ? 'badge-ok' : 'badge-muted',
            text: ROLE_LABEL[u.role] || u.role }) },
        { title: 'الحالة', align: 'center', render: (u) => u.active
            ? el('span.badge.badge-ok', { text: 'نشط' }) : el('span.badge.badge-danger', { text: 'موقوف' }) },
        { title: 'تاريخ الإنشاء', render: (u) => el('span.t-sm.t-muted', { text: dateTimeStr(u.created_at) }) },
        { title: '', align: 'left', render: (u) => el('div.btn-row', {}, [
            el('button.btn.btn-sm.btn-ghost', { text: '✏️', title: 'تعديل', onclick: () => editUser(u, load) }),
            u.id !== state.user.id
              ? el('button.btn.btn-sm.btn-ghost', { text: '🚫', title: 'إيقاف', onclick: async () => {
                  if (!await confirmDialog(`إيقاف حساب «${u.full_name}»؟ لن يتمكن من الدخول بعدها.`, { danger: true, okLabel: 'إيقاف' })) return;
                  try { await api.deleteUser(u.id); toastOk('تم إيقاف الحساب'); load(); }
                  catch (e) { toastErr(e.message); }
                }})
              : null
          ]) }
      ], rows, { emptyText: 'لا يوجد مستخدمون' }));
    } catch (e) {
      listBox.innerHTML = ''; listBox.append(el('div.alert.alert-danger', { text: e.message }));
    }
  };

  const permsCard = card('ماذا يستطيع كل دور؟', [
    el('div.grid.g3', {}, [
      el('div', {}, [
        el('div.section-title.mt0', { text: '🔑 المدير' }),
        el('div.t-sm', { html: '✔ كل شيء<br>✔ الإعدادات والمستخدمون<br>✔ النسخ الاحتياطي<br>✔ حذف الفواتير' })
      ]),
      el('div', {}, [
        el('div.section-title.mt0', { text: '💊 الصيدلي' }),
        el('div.t-sm', { html: '✔ البيع والمرتجعات<br>✔ الأصناف والمخزون<br>✔ المشتريات والموردون<br>✔ التقارير<br>✘ الإعدادات والمستخدمون' })
      ]),
      el('div', {}, [
        el('div.section-title.mt0', { text: '🛒 الكاشير' }),
        el('div.t-sm', { html: '✔ نقطة البيع<br>✔ عرض الفواتير<br>✔ الزبائن<br>✘ التكاليف والأرباح<br>✘ المخزون والمشتريات' })
      ])
    ])
  ]);

  const toolbar = el('div.toolbar', {}, [
    el('div', { style: { flex: '1' } }),
    el('button.btn.btn-sm.btn-outline', { text: '🔒 تغيير كلمة مروري', onclick: changePasswordDialog }),
    el('button.btn.btn-primary.btn-sm', { text: '＋ مستخدم جديد', onclick: () => editUser(null, load) })
  ]);

  await load();
  return el('div', {}, [toolbar, el('div.card', { style: { marginBottom: '16px' } }, [listBox]), permsCard]);
}

function editUser(u, onSaved) {
  const isNew = !u;
  const form = el('div', {}, [
    field('الاسم الكامل *', input({ name: 'full_name', value: u?.full_name || '' })),
    isNew ? field('اسم المستخدم *', input({ name: 'username' }), 'يُستخدم لتسجيل الدخول — بالإنجليزية بدون مسافات') : null,
    field(isNew ? 'كلمة المرور *' : 'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)',
      input({ name: 'password', type: 'password' })),
    field('الصلاحية *', select(ROLES.map((r) => ({ ...r, selected: u?.role === r.value })), { name: 'role' })),
    !isNew ? el('div.field', {}, [el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' } }, [
      el('input', { name: 'active', type: 'checkbox', ...(u?.active ? { checked: true } : {}) }), 'الحساب نشط'])]) : null
  ].filter(Boolean));

  modal({
    title: isNew ? 'مستخدم جديد' : 'تعديل: ' + u.full_name,
    body: form, size: 'narrow',
    actions: [
      { label: 'حفظ', class: 'btn-primary', onClick: async () => {
        const d = readForm(form);
        if (!d.full_name?.trim()) { toastErr('الاسم الكامل مطلوب'); return false; }
        if (isNew && !d.username?.trim()) { toastErr('اسم المستخدم مطلوب'); return false; }
        if (isNew && !d.password) { toastErr('كلمة المرور مطلوبة'); return false; }
        try { await api.saveUser({ ...d, id: u?.id }); toastOk('تم الحفظ'); onSaved(); }
        catch (e) { toastErr(e.message); return false; }
      }},
      { label: 'إلغاء', class: 'btn-outline' }
    ]
  });
}

// ================= الإعدادات =================
export async function settingsView() {
  const s = await api.settings();
  const form = el('div');

  const f = {
    pharmacy_name: input({ name: 'pharmacy_name', value: s.pharmacy_name || '' }),
    pharmacy_phone: input({ name: 'pharmacy_phone', value: s.pharmacy_phone || '' }),
    pharmacy_address: input({ name: 'pharmacy_address', value: s.pharmacy_address || '' }),
    currency: input({ name: 'currency', value: s.currency || 'د.ل' }),
    invoice_prefix: input({ name: 'invoice_prefix', value: s.invoice_prefix || 'ف' }),
    expiry_alert_days: input({ name: 'expiry_alert_days', type: 'number', min: '7', max: '365', value: s.expiry_alert_days || 90 }),
    default_profit_margin: input({ name: 'default_profit_margin', type: 'number', min: '0', max: '200', value: s.default_profit_margin || 25 }),
    receipt_footer: textarea({ name: 'receipt_footer', value: s.receipt_footer || '' })
  };

  form.append(
    card('بيانات الصيدلية', [
      el('div.row', {}, [field('اسم الصيدلية', f.pharmacy_name), field('رقم الهاتف', f.pharmacy_phone)]),
      field('العنوان', f.pharmacy_address),
      el('div.row', {}, [
        field('رمز العملة', f.currency, 'يظهر في كل الشاشات والفواتير'),
        field('بادئة رقم الفاتورة', f.invoice_prefix)
      ]),
      field('نص أسفل الفاتورة المطبوعة', f.receipt_footer)
    ]),
    el('div', { style: { height: '16px' } }),
    card('إعدادات التنبيهات', [
      el('div.row', {}, [
        field('تنبيه الصلاحية قبل (يوم)', f.expiry_alert_days,
          'المنظومة تنبهك بالأدوية التي تنتهي خلال هذه المدة'),
        field('هامش الربح الافتراضي %', f.default_profit_margin,
          'يُستخدم لاقتراح سعر البيع عند إدخال فاتورة شراء')
      ])
    ]),
    el('div', { style: { height: '16px' } })
  );

  const saveBtn = el('button.btn.btn-primary', { text: '💾 حفظ الإعدادات', onclick: async () => {
    const d = readForm(form);
    try {
      const updated = await api.saveSettings(d);
      state.settings = updated;
      setCurrency(updated.currency);
      toastOk('تم حفظ الإعدادات');
      app.renderShell();
      app.go('settings');
    } catch (e) { toastErr(e.message); }
  }});

  // ---- النسخ الاحتياطي ----
  const backupBox = el('div.card-body.tight', {}, [spinner()]);
  const loadBackups = async () => {
    backupBox.innerHTML = ''; backupBox.append(spinner());
    try {
      const rows = await api.backups();
      backupBox.innerHTML = '';
      backupBox.append(table([
        { title: 'الملف', render: (b) => el('span.num.t-sm', { text: b.file }) },
        { title: 'التاريخ', render: (b) => dateTimeStr(b.at) },
        { title: 'الحجم', align: 'center', render: (b) => el('span.num', { text: (b.size / 1048576).toFixed(2) + ' م.ب' }) },
        { title: '', align: 'left', render: (b) => el('div.btn-row', {}, [
            el('a.btn.btn-sm.btn-outline', { href: '/api/backups/' + encodeURIComponent(b.file), text: '⬇️ تنزيل',
              download: b.file }),
            el('button.btn.btn-sm.btn-danger', { text: '↩️ استعادة', onclick: async () => {
              if (!await confirmDialog(
                'سيتم استبدال كل البيانات الحالية ببيانات هذه النسخة، وستحتاج لإعادة تشغيل المنظومة. متابعة؟',
                { title: 'استعادة نسخة احتياطية', danger: true, okLabel: 'نعم، استعد' })) return;
              try { await api.restoreBackup(b.file); toastOk('تمت الاستعادة — أعد تشغيل المنظومة'); }
              catch (e) { toastErr(e.message); }
            }})
          ]) }
      ], rows, { emptyIcon: '💾', emptyText: 'لا توجد نسخ احتياطية بعد',
                 emptyHint: 'أنشئ نسخة الآن — ينصح بعمل نسخة يومياً' }));
    } catch (e) {
      backupBox.innerHTML = ''; backupBox.append(el('div.alert.alert-danger', { text: e.message }));
    }
  };
  await loadBackups();

  const backupCard = card('النسخ الاحتياطي', [
    el('div.alert.alert-warn', {}, [
      el('span', { text: '⚠️' }),
      el('div', {}, [
        el('b', { text: 'بياناتك أهم من الجهاز' }),
        el('div.t-sm', { text: 'أنشئ نسخة احتياطية يومياً وانسخها على فلاش أو جوجل درايف. إذا تعطّل الجهاز تستعيد كل شيء في دقيقة.' })
      ])
    ]),
    backupBox
  ], [
    el('button.btn.btn-sm.btn-primary', { text: '💾 إنشاء نسخة الآن', onclick: async () => {
      try { const r = await api.createBackup(); toastOk('تم إنشاء النسخة: ' + r.file); loadBackups(); }
      catch (e) { toastErr(e.message); }
    }})
  ]);

  // ---- سجل النشاط ----
  const activityBox = el('div.card-body.tight', {}, [spinner()]);
  api.activity(120).then((rows) => {
    activityBox.innerHTML = '';
    activityBox.append(table([
      { title: 'الوقت', render: (a) => el('span.t-sm', { text: dateTimeStr(a.at) }) },
      { title: 'المستخدم', render: (a) => el('b', { text: a.username }) },
      { title: 'الإجراء', render: (a) => el('span.badge.badge-muted', { text: a.action }) },
      { title: 'التفاصيل', render: (a) => el('span.t-sm.t-muted', { text: (a.details || '').slice(0, 90) }) }
    ], rows, { emptyText: 'لا يوجد نشاط مسجل' }));
  }).catch((e) => {
    activityBox.innerHTML = '';
    activityBox.append(el('div.alert.alert-danger', { text: e.message }));
  });

  return el('div', {}, [
    form,
    el('div.btn-row', { style: { marginBottom: '16px' } }, [saveBtn]),
    backupCard,
    el('div', { style: { height: '16px' } }),
    card('سجل النشاط', [activityBox], [], true)
  ]);
}
