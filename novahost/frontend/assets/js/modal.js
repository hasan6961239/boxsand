import { el, render } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

/**
 * Modals.
 *
 * Focus is trapped while a dialog is open and restored when it closes, and Esc
 * always works. That is not polish — it is the difference between a dashboard
 * you can drive from a keyboard and one you cannot.
 */

let openCount = 0;

export function openModal({ title, body, footer, wide = false, onClose = null, closeOnBackdrop = true }) {
  const previouslyFocused = document.activeElement;

  const dialog = el(`.modal${wide ? '.modal--wide' : ''}`, {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': typeof title === 'string' ? title : 'dialog',
  });

  const backdrop = el('.modal-backdrop', dialog);

  const close = (result) => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) document.body.style.removeProperty('overflow');
    document.removeEventListener('keydown', onKeyDown, true);
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    if (onClose) onClose(result);
  };

  function focusables() {
    return [...dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((node) => node.offsetParent !== null);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close(null);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  render(dialog,
    el('.modal__header',
      el('.modal__title', typeof title === 'string' ? { text: title } : null, typeof title === 'string' ? null : title),
      el('button.btn.btn--ghost.btn--icon.btn--sm.modal__close', {
        type: 'button', 'aria-label': t('common.close'), onClick: () => close(null),
      }, icon('close', { size: 17 })),
    ),
    el('.modal__body', body),
    footer ? el('.modal__footer', footer) : null,
  );

  if (closeOnBackdrop) {
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close(null);
    });
  }

  document.addEventListener('keydown', onKeyDown, true);
  document.body.append(backdrop);
  openCount += 1;
  document.body.style.overflow = 'hidden';

  // Focus the first control rather than the dialog itself, so typing works.
  queueMicrotask(() => {
    const items = focusables();
    (items.find((node) => !node.classList.contains('modal__close')) ?? items[0] ?? dialog).focus?.();
  });

  return { close, dialog };
}

/**
 * Confirmation dialog.
 *
 * `requireText` is used for destructive actions: the user has to type the exact
 * project name before the button enables. It is friction on purpose — deleting
 * a project removes every deployment with no undo.
 */
export function confirmDialog({
  title,
  message,
  confirmLabel = t('common.confirm'),
  cancelLabel = t('common.cancel'),
  danger = false,
  requireText = null,
  extra = null,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const confirmButton = el(`button.btn.${danger ? 'btn--danger' : 'btn--primary'}`, {
      type: 'button',
      disabled: Boolean(requireText),
      onClick: () => { finish(true); modal.close(true); },
    }, confirmLabel);

    const input = requireText
      ? el('input.input', {
        type: 'text',
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: requireText,
        onInput: (event) => {
          confirmButton.disabled = event.target.value.trim() !== requireText;
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter' && !confirmButton.disabled) {
            finish(true);
            modal.close(true);
          }
        },
      })
      : null;

    const modal = openModal({
      title,
      body: el('.stack',
        el('p', { class: 'muted', text: message }),
        extra,
        input,
      ),
      footer: [
        el('button.btn', { type: 'button', onClick: () => { finish(false); modal.close(false); } }, cancelLabel),
        confirmButton,
      ],
      onClose: () => finish(false),
    });
  });
}

/** Prompt for a single line of text. */
export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = t('common.save') }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const input = el('input.input', {
      type: 'text', value, placeholder, autocomplete: 'off', spellcheck: 'false',
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const text = input.value.trim();
          if (text) { finish(text); modal.close(text); }
        }
      },
    });

    const modal = openModal({
      title,
      body: el('.field',
        el('label.field__label', { text: label }),
        input,
      ),
      footer: [
        el('button.btn', { type: 'button', onClick: () => { finish(null); modal.close(null); } }, t('common.cancel')),
        el('button.btn.btn--primary', {
          type: 'button',
          onClick: () => {
            const text = input.value.trim();
            if (!text) { input.focus(); return; }
            finish(text);
            modal.close(text);
          },
        }, confirmLabel),
      ],
      onClose: () => finish(null),
    });
  });
}
