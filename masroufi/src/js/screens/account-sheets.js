// Account sheets: log in, sign up, forgot password, set a new password.
// Each open* returns the sheet api; api.result resolves with the user on success.

import { h, icon } from '../ui/dom.js';
import { sheet, button, field, input, toast, busy, haptic } from '../ui/kit.js';
import * as auth from '../core/auth.js';
import * as sync from '../core/sync.js';

function passwordInput({ placeholder = 'كلمة السر', autocomplete = 'current-password', onInput, onEnter }) {
  const inp = h('input.input', { type: 'password', placeholder, autocomplete, enterkeyhint: 'go', dir: 'ltr', oninput: (e) => onInput(e.target.value), onkeydown: (e) => { if (e.key === 'Enter') onEnter && onEnter(); } });
  const eye = h('button.pw-eye.tap', {
    type: 'button',
    'aria-label': 'إظهار كلمة السر',
    onclick: () => {
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      eye.replaceChildren(icon(show ? 'eye-off' : 'eye', { size: 20 }));
    },
  }, icon('eye', { size: 20 }));
  return h('div.pw', inp, eye);
}

function emailInput(st) {
  return input({ type: 'email', value: st.email, placeholder: 'name@example.com', autocomplete: 'email', inputmode: 'email', enterkeyhint: 'next', onInput: (v) => { st.email = v; } });
}

const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

function errorBox() {
  const el = h('p.form-err', { role: 'alert' });
  el.show = (msg) => { el.textContent = msg; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };
  el.clear = () => { el.textContent = ''; };
  return el;
}

/* ------------------------------------------------------------ login */

export function openLogin() {
  const st = { email: '', password: '' };
  const err = errorBox();
  let submitBtn;
  const submit = () => submitBtn.click();
  const api = sheet({
    title: 'تسجيل الدخول',
    sub: 'بياناتك تتزامن بين كل أجهزتك.',
    body: (a) => h('form.auth-form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('div.auth-hero', h('span', icon('log-in', { size: 26 }))),
      field('الإيميل', emailInput(st)),
      field('كلمة السر', passwordInput({ onInput: (v) => { st.password = v; err.clear(); }, onEnter: submit })),
      h('button.link-btn.auth-forgot.tap', { type: 'button', onclick: () => { a.close(); setTimeout(() => openForgot(st.email), 150); } }, 'نسيت كلمة السر؟'),
      err),
    footer: (a) => h('div.auth-foot',
      (submitBtn = button({
        label: 'دخول', size: 'lg', block: true,
        onClick: (e) => busy(e.currentTarget, async () => {
          if (!validEmail(st.email)) return err.show('اكتب إيميل صحيح');
          if (!st.password) return err.show('اكتب كلمة السر');
          try {
            const user = await auth.login(st.email, st.password);
            haptic(14);
            a.close(user);
            toast(`أهلاً ${user.name || ''} 👋 جاري جلب بياناتك…`, { tone: 'pos' });
            await sync.resetCursor();
            sync.syncNow();
          } catch (ex) {
            err.show(auth.errorText(ex));
          }
        }),
      })),
      auth.canSignup() ? button({ label: 'ما عنديش حساب — أعمل حساب', variant: 'plain', block: true, onClick: () => { a.close(); setTimeout(() => openSignup(), 150); } }) : null),
  });
  return api;
}

/* ------------------------------------------------------------ signup */

function strength(p) {
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  if (p.length < 6) return { level: 0, text: 'قصيرة — 6 حروف على الأقل' };
  return [{ level: 1, text: 'ضعيفة' }, { level: 1, text: 'ضعيفة' }, { level: 2, text: 'مقبولة' }, { level: 3, text: 'قوية' }, { level: 3, text: 'قوية جداً' }][s];
}

export function openSignup() {
  const st = { name: '', email: '', password: '' };
  const err = errorBox();
  const meter = h('div.pw-meter', h('span'), h('span'), h('span'), h('small'));
  const paintMeter = () => {
    const s = strength(st.password);
    meter.dataset.level = st.password ? s.level : '';
    meter.lastChild.textContent = st.password ? s.text : 'خليها سهلة عليك وصعبة على غيرك';
  };
  paintMeter();
  const body = h('div');
  let submitBtn;
  const api = sheet({
    title: 'حساب جديد',
    sub: 'مجاني، وبياناتك تتحفظ في حسابك.',
    body: () => body,
    footer: (a) => h('div.auth-foot',
      (submitBtn = button({
        label: 'أعمل الحساب', size: 'lg', block: true,
        onClick: (e) => busy(e.currentTarget, async () => {
          if (!validEmail(st.email)) return err.show('اكتب إيميل صحيح');
          if (st.password.length < 6) return err.show('كلمة السر لازم تكون 6 حروف أو أكثر');
          try {
            const r = await auth.signup(st.email, st.password, st.name.trim());
            haptic(14);
            if (r.confirm) {
              showConfirm();
              return;
            }
            a.close(r.user);
            toast('تم! حسابك جاهز ✨', { tone: 'pos' });
            sync.syncNow();
          } catch (ex) {
            err.show(auth.errorText(ex));
          }
        }),
      })),
      button({ label: 'عندي حساب — دخول', variant: 'plain', block: true, onClick: () => { a.close(); setTimeout(() => openLogin(), 150); } })),
  });

  body.replaceChildren(h('form.auth-form', { onsubmit: (e) => { e.preventDefault(); submitBtn.click(); } },
    h('div.auth-hero', h('span', icon('user-plus', { size: 26 }))),
    field('اسمك (اختياري)', input({ placeholder: 'مثلاً: حسن', autocomplete: 'name', onInput: (v) => { st.name = v; } })),
    field('الإيميل', emailInput(st)),
    field('كلمة السر', h('div.stack-sm', passwordInput({ placeholder: '6 حروف أو أكثر', autocomplete: 'new-password', onInput: (v) => { st.password = v; err.clear(); paintMeter(); }, onEnter: () => submitBtn.click() }), meter)),
    err));

  function showConfirm() {
    body.replaceChildren(h('div.auth-done',
      h('div.auth-done-ic', icon('mail', { size: 34 })),
      h('b', 'شوف إيميلك 📬'),
      h('p', 'بعثنالك رسالة تأكيد على ', h('bdi', st.email), '. افتحها من هالجهاز واضغط الرابط، ويدخلك التطبيق على طول.'),
      h('small.faint', 'ما لقيتهاش؟ شوف مجلد الـ Spam.')));
    api.el.querySelector('.sheet-foot').replaceChildren(button({ label: 'تمام', size: 'lg', block: true, onClick: () => api.close() }));
  }
  return api;
}

/* ------------------------------------------------------------ forgot */

export function openForgot(prefill = '') {
  const st = { email: prefill };
  const err = errorBox();
  const body = h('div');
  const api = sheet({
    title: 'نسيت كلمة السر',
    sub: 'نبعتلك رابط على إيميلك تختار منه كلمة سر جديدة.',
    body: () => body,
    footer: (a) => button({
      label: 'ابعت الرابط', size: 'lg', block: true,
      onClick: (e) => busy(e.currentTarget, async () => {
        if (!validEmail(st.email)) return err.show('اكتب إيميل صحيح');
        try {
          await auth.forgot(st.email);
          body.replaceChildren(h('div.auth-done', h('div.auth-done-ic', icon('mail', { size: 34 })), h('b', 'بعثنالك الرابط 📬'), h('p', 'افتح الإيميل من هالجهاز واضغط الرابط، ويفتحلك التطبيق تختار كلمة سر جديدة.')));
          a.el.querySelector('.sheet-foot').replaceChildren(button({ label: 'تمام', size: 'lg', block: true, onClick: () => a.close() }));
        } catch (ex) {
          err.show(auth.errorText(ex));
        }
      }),
    }),
  });
  body.replaceChildren(h('div.auth-form', h('div.auth-hero', h('span', icon('key-round', { size: 26 }))), field('الإيميل', emailInput(st)), err));
  return api;
}

/* ------------------------------------------------------------ new password */

export function openNewPassword() {
  const recovery = auth.inRecovery();
  const st = { p1: '', p2: '' };
  const err = errorBox();
  return sheet({
    title: recovery ? 'اختار كلمة سر جديدة' : 'تغيير كلمة السر',
    sub: recovery ? 'دخلت من رابط الاسترجاع — حط كلمة سر جديدة.' : null,
    dismissible: !recovery,
    body: () => h('div.auth-form',
      h('div.auth-hero', h('span', icon('lock', { size: 26 }))),
      field('كلمة السر الجديدة', passwordInput({ placeholder: '6 حروف أو أكثر', autocomplete: 'new-password', onInput: (v) => { st.p1 = v; err.clear(); } })),
      field('عاودها', passwordInput({ placeholder: 'نفس الكلمة', autocomplete: 'new-password', onInput: (v) => { st.p2 = v; err.clear(); } })),
      err),
    footer: (a) => button({
      label: 'حفظ كلمة السر', size: 'lg', block: true,
      onClick: (e) => busy(e.currentTarget, async () => {
        if (st.p1.length < 6) return err.show('كلمة السر لازم تكون 6 حروف أو أكثر');
        if (st.p1 !== st.p2) return err.show('الكلمتين مش زي بعض');
        try {
          const user = await auth.setPassword(st.p1);
          haptic(14);
          a.close(user);
          toast('تم تغيير كلمة السر ✓', { tone: 'pos' });
          sync.syncNow();
        } catch (ex) {
          err.show(auth.errorText(ex));
        }
      }),
    }),
  });
}
