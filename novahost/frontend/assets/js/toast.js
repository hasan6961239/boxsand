import { el } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

/** Toast notifications. Screen-reader friendly via an aria-live region. */

let container = null;

function getContainer() {
  if (container && document.body.contains(container)) return container;
  container = el('.toasts', { role: 'status', 'aria-live': 'polite' });
  document.body.append(container);
  return container;
}

const ICONS = { success: 'check', error: 'alert', warning: 'warning', info: 'info' };

export function toast(message, { type = 'info', title = null, timeout = 4200 } = {}) {
  const node = el(`.toast.toast--${type}`,
    el('.toast__icon', icon(ICONS[type] ?? 'info', { size: 17 })),
    el('.toast__body',
      title ? el('.toast__title', { text: title }) : null,
      el('.toast__text', { text: message }),
    ),
    el('button.toast__close', {
      type: 'button',
      'aria-label': t('common.close'),
      onClick: () => dismiss(node),
    }, icon('close', { size: 15 })),
  );

  getContainer().append(node);

  if (timeout > 0) {
    const timer = setTimeout(() => dismiss(node), timeout);
    // Give the reader time when they are hovering over the message.
    node.addEventListener('mouseenter', () => clearTimeout(timer), { once: true });
  }
  return node;
}

function dismiss(node) {
  if (!node.isConnected) return;
  node.classList.add('is-leaving');
  setTimeout(() => node.remove(), 170);
}

export const toasts = {
  success: (message, title) => toast(message, { type: 'success', title }),
  error: (message, title) => toast(message, { type: 'error', title, timeout: 7000 }),
  warning: (message, title) => toast(message, { type: 'warning', title, timeout: 6000 }),
  info: (message, title) => toast(message, { type: 'info', title }),
};
