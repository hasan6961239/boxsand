import { el, render } from '../dom.js';
import { icon } from '../icons.js';
import { t, translateError } from '../i18n.js';
import { api, setCsrfToken } from '../api.js';
import { setState } from '../store.js';
import { toasts } from '../toast.js';
import { field, alert } from '../components.js';
import { navigate } from '../router.js';

/** Login and first-run setup. Both render into the full-page auth shell. */

function authShell({ title, subtitle, form, footer = null }) {
  return el('.auth',
    el('.auth__card',
      el('.auth__brand',
        el('.auth__logo', 'NH'),
        el('.auth__title', { text: title }),
        el('.auth__sub', { text: subtitle }),
      ),
      el('.card', el('.card__body', form)),
      footer ? el('.auth__footer', footer) : null,
    ),
  );
}

export function renderLogin(container) {
  const errorSlot = el('div');
  const submit = el('button.btn.btn--primary.btn--block', { type: 'submit' }, t('auth.signin'));

  const username = el('input.input', {
    type: 'text', name: 'username', autocomplete: 'username',
    required: true, autofocus: true, dir: 'ltr',
  });
  const password = el('input.input', {
    type: 'password', name: 'password', autocomplete: 'current-password', required: true, dir: 'ltr',
  });
  const remember = el('input', { type: 'checkbox', checked: true });

  const form = el('form', {
    onSubmit: async (event) => {
      event.preventDefault();
      errorSlot.replaceChildren();
      submit.disabled = true;
      render(submit, el('.spinner'), t('auth.signing'));

      try {
        const data = await api.login({
          username: username.value,
          password: password.value,
          remember: remember.checked,
        });
        setCsrfToken(data.csrfToken);
        setState({ user: data.user });
        navigate('/');
      } catch (error) {
        render(errorSlot, alert('danger', null, translateError(error)));
        password.value = '';
        password.focus();
      } finally {
        submit.disabled = false;
        render(submit, t('auth.signin'));
      }
    },
  },
  errorSlot,
  field({ label: t('auth.username'), input: username }),
  field({ label: t('auth.password'), input: password }),
  el('label.switch', { style: { marginBottom: '16px' } },
    remember, el('.switch__track', el('.switch__thumb')), el('span', { text: t('auth.remember') })),
  submit,
  );

  render(container, authShell({
    title: t('auth.signin'),
    subtitle: t('auth.signin.sub'),
    form,
  }));
  username.focus();
}

export function renderSetup(container) {
  const errorSlot = el('div');
  const submit = el('button.btn.btn--primary.btn--block', { type: 'submit' }, t('setup.submit'));

  const username = el('input.input', {
    type: 'text', autocomplete: 'username', required: true, dir: 'ltr',
    // The hyphen is escaped: with the `v` flag that modern browsers now apply
    // to pattern attributes, a trailing unescaped '-' in a character class is
    // a syntax error and the whole constraint is silently dropped.
    pattern: '[a-zA-Z0-9._\\-]+', minlength: '3', maxlength: '32',
  });
  const email = el('input.input', { type: 'email', autocomplete: 'email', required: true, dir: 'ltr' });
  const displayName = el('input.input', { type: 'text', autocomplete: 'name' });
  const password = el('input.input', {
    type: 'password', autocomplete: 'new-password', required: true, minlength: '10', dir: 'ltr',
  });
  const confirm = el('input.input', {
    type: 'password', autocomplete: 'new-password', required: true, dir: 'ltr',
  });

  const form = el('form', {
    onSubmit: async (event) => {
      event.preventDefault();
      errorSlot.replaceChildren();

      if (password.value !== confirm.value) {
        render(errorSlot, alert('danger', null, t('setup.mismatch')));
        confirm.focus();
        return;
      }

      submit.disabled = true;
      render(submit, el('.spinner'), t('common.loading'));
      try {
        const data = await api.setup({
          username: username.value,
          email: email.value,
          displayName: displayName.value || undefined,
          password: password.value,
        });
        setCsrfToken(data.csrfToken);
        setState({ user: data.user, setupRequired: false });
        toasts.success(t('setup.done'));
        navigate('/');
      } catch (error) {
        render(errorSlot, alert('danger', null, translateError(error)));
      } finally {
        submit.disabled = false;
        render(submit, t('setup.submit'));
      }
    },
  },
  errorSlot,
  alert('info', null, t('setup.sub')),
  el('div', { style: { height: '16px' } }),
  field({ label: t('auth.username'), input: username }),
  field({ label: t('setup.email'), input: email }),
  field({ label: `${t('setup.displayName')} (${t('common.optional')})`, input: displayName }),
  field({ label: t('auth.password'), input: password, hint: t('setup.password.hint') }),
  field({ label: t('setup.confirm'), input: confirm }),
  submit,
  );

  render(container, authShell({
    title: t('setup.title'),
    subtitle: t('app.name'),
    form,
    footer: el('span', icon('shield', { size: 13 }), ' ', t('setup.sub')),
  }));
  username.focus();
}
