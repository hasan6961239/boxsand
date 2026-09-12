// ===== الهيكل العام والتنقل =====
import { api, state, setToken, can } from './api.js';
import { el, $, toast, toastErr, toastOk, setCurrency, spinner, modal, field, input, readForm } from './ui.js';

const VIEWS = {};
export function registerView(name, loader) { VIEWS[name] = loader; }

const NAV = [
  { group: 'التشغيل اليومي', items: [
    { id: 'dashboard', label: 'لوحة التحكم', icon: '📊', perm: null },
    { id: 'pos', label: 'نقطة البيع', icon: '🛒', perm: 'pos' },
    { id: 'sales', label: 'فواتير المبيعات', icon: '🧾', perm: 'sales.view' }
  ]},
  { group: 'المخزون', items: [
    { id: 'products', label: 'الأدوية والأصناف', icon: '💊', perm: 'products.view' },
    { id: 'expiry', label: 'تنبيهات الصلاحية', icon: '⏰', perm: 'products.view', badge: 'expiry' },
    { id: 'purchases', label: 'المشتريات', icon: '📦', perm: 'purchases.view' },
    { id: 'suppliers', label: 'الموردون', icon: '🚚', perm: 'suppliers.view' }
  ]},
  { group: 'الحسابات', items: [
    { id: 'customers', label: 'الزبائن والآجل', icon: '👥', perm: 'customers.view', badge: 'debt' },
    { id: 'expenses', label: 'المصروفات', icon: '💸', perm: 'expenses.view' },
    { id: 'reports', label: 'التقارير', icon: '📈', perm: 'reports.view' }
  ]},
  { group: 'الإدارة', items: [
    { id: 'users', label: 'المستخدمون', icon: '🔑', perm: '*' },
    { id: 'settings', label: 'الإعدادات', icon: '⚙️', perm: '*' }
  ]}
];

const TITLES = Object.fromEntries(NAV.flatMap((g) => g.items).map((i) => [i.id, i.label]));

export const app = {
  current: null,
  badges: { expiry: 0, debt: 0 },

  async boot() {
    if (!state.token) return this.renderLogin();
    try {
      const me = await api.me();
      state.user = me.user;
      state.permissions = me.permissions;
      state.settings = me.settings || {};
      setCurrency(state.settings.currency);
      this.renderShell();
      this.go(location.hash.slice(1) || 'dashboard');
      this.refreshBadges();
    } catch (e) {
      setToken(null);
      this.renderLogin();
    }
  },

  // ---------- شاشة الدخول ----------
  renderLogin() {
    document.body.innerHTML = '';
    const err = el('div.alert.alert-danger.hidden');
    const u = el('input.input.input-lg', { name: 'username', placeholder: 'اسم المستخدم', autocomplete: 'username' });
    const p = el('input.input.input-lg', { name: 'password', type: 'password', placeholder: 'كلمة المرور', autocomplete: 'current-password' });
    const btn = el('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit', text: 'دخول المنظومة' });

    const submit = async (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      btn.disabled = true; btn.textContent = 'جارٍ التحقق…';
      try {
        const r = await api.login(u.value.trim(), p.value);
        setToken(r.token);
        state.user = r.user; state.permissions = r.permissions;
        await this.boot();
      } catch (ex) {
        err.textContent = ex.message; err.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'دخول المنظومة';
        p.select();
      }
    };

    const form = el('form', { onsubmit: submit }, [
      el('div.login-logo', { text: '💊' }),
      el('h1', { text: 'منظومة صيدليتي' }),
      el('p.sub', { text: 'إدارة متكاملة لصيدليتك — مبيعات، مخزون، صلاحيات، وتقارير' }),
      err,
      el('div.field', {}, [el('label', { text: 'اسم المستخدم' }), u]),
      el('div.field', {}, [el('label', { text: 'كلمة المرور' }), p]),
      btn,
      el('div.login-hint', { html:
        '<b>حسابات التجربة:</b><br>' +
        'مدير: <code>admin</code> / <code>1234</code><br>' +
        'صيدلي: <code>pharmacist</code> / <code>1234</code><br>' +
        'كاشير: <code>cashier</code> / <code>1234</code>' })
    ]);

    document.body.append(el('div.login-wrap', {}, [el('div.login-card', {}, [form])]));
    setTimeout(() => u.focus(), 80);
  },

  // ---------- الهيكل ----------
  renderShell() {
    document.body.innerHTML = '';
    const nav = el('nav.nav');
    for (const group of NAV) {
      const items = group.items.filter((i) => !i.perm || can(i.perm));
      if (!items.length) continue;
      const g = el('div.nav-group', {}, [el('div.nav-group-title', { text: group.group })]);
      for (const item of items) {
        const badge = el('span.nav-badge.hidden');
        badge.dataset.badge = item.badge || '';
        const b = el('button.nav-item', {
          dataset: { view: item.id },
          onclick: () => { this.go(item.id); this.closeMobileNav(); }
        }, [el('span.ic', { text: item.icon }), item.label, item.badge ? badge : null]);
        g.append(b);
      }
      nav.append(g);
    }

    const sidebar = el('aside.sidebar', {}, [
      el('div.brand', {}, [
        el('div.brand-mark', { text: '💊' }),
        el('div.brand-text', {}, [
          el('b', { text: state.settings.pharmacy_name || 'صيدليتي' }),
          el('span', { text: 'منظومة إدارة الصيدليات' })
        ])
      ]),
      nav,
      el('div.sidebar-foot', { text: 'صيدليتي — الإصدار 1.0' })
    ]);

    const title = el('h2', { text: 'لوحة التحكم' });
    const topbar = el('header.topbar', {}, [
      el('button.btn.btn-ghost.menu-toggle', { html: '☰', onclick: () => sidebar.classList.add('open') }),
      title,
      el('div.spacer'),
      el('div.topbar-meta', {}, [
        el('span', { text: new Date().toLocaleDateString('en-GB') }),
        el('span', { text: '·' }),
        el('span', { text: state.user.full_name }),
        el('div.avatar', { text: (state.user.full_name || '؟').trim()[0] }),
        el('button.btn.btn-ghost', { title: 'الخروج', html: '⏻', onclick: () => this.logout() })
      ])
    ]);

    const content = el('main.content', {}, [spinner()]);
    document.body.append(el('div.layout', {}, [sidebar, el('div.main', {}, [topbar, content])]));
    this._els = { content, title, sidebar, nav };
  },

  closeMobileNav() {
    if (this._els) this._els.sidebar.classList.remove('open');
  },

  async go(view) {
    if (!VIEWS[view]) view = 'dashboard';
    const item = NAV.flatMap((g) => g.items).find((i) => i.id === view);
    if (item && item.perm && !can(item.perm)) { toastErr('ليس لديك صلاحية لهذه الشاشة'); view = 'dashboard'; }

    // تنظيف الشاشة السابقة (مستمعو لوحة المفاتيح مثلاً)
    if (this._activeNode && typeof this._activeNode.cleanup === 'function') {
      try { this._activeNode.cleanup(); } catch (e) { /* تجاهل */ }
    }
    this._activeNode = null;

    this.current = view;
    location.hash = view;
    if (this._els) {
      this._els.title.textContent = TITLES[view] || '';
      document.querySelectorAll('.nav-item').forEach((b) =>
        b.classList.toggle('active', b.dataset.view === view));
      this._els.content.innerHTML = '';
      this._els.content.append(spinner());
    }
    try {
      const node = await VIEWS[view]();
      if (this.current !== view) return;
      this._els.content.innerHTML = '';
      this._els.content.append(node);
      this._activeNode = node;
      this._els.content.scrollTop = 0;
      window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      this._els.content.innerHTML = '';
      this._els.content.append(el('div.alert.alert-danger', { text: 'تعذّر تحميل الشاشة: ' + e.message }));
    }
  },

  async refreshBadges() {
    try {
      const d = await api.dashboard();
      this.badges.expiry = (d.expired.count || 0) + (d.expiring_soon.count || 0);
      this.badges.debt = d.debtors_count || 0;
      document.querySelectorAll('.nav-badge').forEach((b) => {
        const v = this.badges[b.dataset.badge];
        if (v > 0) { b.textContent = v; b.classList.remove('hidden'); }
        else b.classList.add('hidden');
      });
    } catch (e) { /* تجاهل */ }
  },

  async logout() {
    try { await api.logout(); } catch (e) {}
    setToken(null);
    state.user = null;
    this.renderLogin();
  },

  reload() { this.go(this.current); }
};

// تغيير كلمة المرور (متاح من الإعدادات)
export function changePasswordDialog() {
  const oldP = input({ type: 'password', name: 'old_password' });
  const newP = input({ type: 'password', name: 'new_password' });
  const body = el('div', {}, [
    field('كلمة المرور الحالية', oldP),
    field('كلمة المرور الجديدة', newP, 'أربعة أحرف على الأقل')
  ]);
  modal({
    title: 'تغيير كلمة المرور', size: 'narrow', body,
    actions: [
      { label: 'حفظ', class: 'btn-primary', onClick: async () => {
        try {
          await api.changePassword(oldP.value, newP.value);
          toastOk('تم تغيير كلمة المرور');
        } catch (e) { toastErr(e.message); return false; }
      }},
      { label: 'إلغاء', class: 'btn-outline' }
    ]
  });
}

window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (v && v !== app.current && state.user) app.go(v);
});
