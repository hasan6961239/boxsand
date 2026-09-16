import { el, render, debounce } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { navigate, currentRoute } from './router.js';
import { getState, setState, setTheme } from './store.js';
import { openModal } from './modal.js';
import * as fmt from './format.js';

/**
 * The application shell: sidebar, top bar, command palette.
 *
 * Built once and kept; only the content area is re-rendered per route. That
 * keeps navigation instant on a phone, where re-creating the whole page on
 * every click is noticeably slow.
 */

const NAV = [
  { section: 'nav.section.main' },
  { path: '/', labelKey: 'nav.overview', iconName: 'home' },
  { path: '/projects', labelKey: 'nav.projects', iconName: 'layers' },
  { path: '/deployments', labelKey: 'nav.deployments', iconName: 'rocket' },
  { path: '/domains', labelKey: 'nav.domains', iconName: 'globe' },
  { section: 'nav.section.system' },
  { path: '/server', labelKey: 'nav.server', iconName: 'server' },
  { path: '/logs', labelKey: 'nav.logs', iconName: 'terminal' },
  { path: '/backups', labelKey: 'nav.backups', iconName: 'archive' },
  { path: '/settings', labelKey: 'nav.settings', iconName: 'settings' },
];

let shellNodes = null;

export function buildShell(root, { onLogout }) {
  const content = el('.content', { id: 'content', role: 'main' });
  const titleNode = el('.topbar__title');
  const healthDot = el('span.badge');

  const sidebar = el('aside.sidebar', { id: 'sidebar' },
    el('.sidebar__brand',
      el('.sidebar__logo', 'NH'),
      el('.sidebar__name', { text: t('app.name') }),
    ),
    el('nav.sidebar__nav', { 'aria-label': t('nav.menu') }),
    el('.sidebar__footer'),
  );

  const scrim = el('.scrim.hidden', {
    onClick: () => toggleSidebar(false),
  });

  const menuButton = el('button.btn.btn--ghost.btn--icon.menu-toggle', {
    type: 'button',
    'aria-label': t('nav.menu'),
    onClick: () => toggleSidebar(),
  }, icon('menu', { size: 19 }));

  const searchButton = el('button.btn.btn--ghost.btn--sm', {
    type: 'button',
    onClick: () => openCommandPalette(),
    'aria-label': t('common.search'),
  }, icon('search', { size: 16 }), el('span.kbd', { text: 'Ctrl K' }));

  const themeButton = el('button.btn.btn--ghost.btn--icon', {
    type: 'button',
    'aria-label': t('settings.theme'),
    onClick: () => {
      const order = ['dark', 'light', 'system'];
      const next = order[(order.indexOf(getState().theme) + 1) % order.length];
      setTheme(next);
      refreshThemeIcon();
    },
  });

  function refreshThemeIcon() {
    const theme = getState().theme;
    render(themeButton, icon(theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor', { size: 17 }));
  }
  refreshThemeIcon();

  const topbar = el('header.topbar',
    menuButton,
    titleNode,
    el('.topbar__spacer'),
    healthDot,
    searchButton,
    themeButton,
  );

  const main = el('.main', topbar, content);
  render(root, el('.shell', sidebar, scrim, main));

  shellNodes = { content, titleNode, sidebar, scrim, healthDot, onLogout };

  renderNav();
  renderUserChip();
  pollHealth();

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openCommandPalette();
    }
  });

  return { content };
}

export function setPageTitle(text) {
  if (!shellNodes) return;
  shellNodes.titleNode.textContent = text;
  document.title = `${text} · ${t('app.name')}`;
}

export function refreshNav() {
  if (shellNodes) renderNav();
}

function toggleSidebar(force = null) {
  if (!shellNodes) return;
  const open = force === null ? !shellNodes.sidebar.classList.contains('is-open') : force;
  shellNodes.sidebar.classList.toggle('is-open', open);
  shellNodes.scrim.classList.toggle('hidden', !open);
  setState({ sidebarOpen: open });
}

function renderNav() {
  const nav = shellNodes.sidebar.querySelector('.sidebar__nav');
  const active = currentRoute() ?? '/';

  render(nav, ...NAV.map((entry) => {
    if (entry.section) return el('.sidebar__section', { text: t(entry.section) });
    const isActive = entry.path === '/' ? active === '/' : active.startsWith(entry.path);
    return el('a', {
      class: `nav-item${isActive ? ' is-active' : ''}`,
      href: entry.path,
      'aria-current': isActive ? 'page' : null,
      onClick: () => toggleSidebar(false),
    }, icon(entry.iconName, { size: 17 }), el('span', { text: t(entry.labelKey) }));
  }));
}

function renderUserChip() {
  const footer = shellNodes.sidebar.querySelector('.sidebar__footer');
  const user = getState().user;
  if (!user) return;

  render(footer,
    el('button.user-chip', {
      type: 'button',
      onClick: () => navigate('/settings'),
    },
    el('.avatar', { text: (user.displayName ?? user.username).slice(0, 2) }),
    el('.user-chip__meta',
      el('.user-chip__name', { text: user.displayName ?? user.username }),
      el('.user-chip__role', { text: user.role }),
    )),
    el('button.nav-item', {
      type: 'button',
      onClick: async () => {
        await api.logout().catch(() => {});
        shellNodes.onLogout();
      },
    }, icon('logout', { size: 17 }), el('span', { text: t('nav.logout') })),
  );
}

/**
 * Health indicator.
 *
 * Driven by a real /health call rather than "the page loaded so we must be
 * online". Polled slowly — this runs on a phone, and a dot that updates every
 * second costs battery for no information.
 */
async function pollHealth() {
  const paint = (status) => {
    if (!shellNodes) return;
    const ok = status === 'ok';
    render(shellNodes.healthDot,
      el(`span.badge${ok ? '.badge--success' : '.badge--danger'}`,
        el('.dot', { class: ok ? 'dot dot--pulse' : 'dot' }),
        el('span', { text: ok ? t('overview.online') : t('overview.degraded') })),
    );
  };

  const check = async () => {
    try {
      const health = await api.health();
      setState({ health });
      paint(health.status);
    } catch {
      paint('offline');
    }
  };

  await check();
  setInterval(() => {
    if (!document.hidden) check();
  }, 30_000);
}

/** Command palette: Ctrl/Cmd+K, searching projects, deployments and logs. */
export function openCommandPalette() {
  const input = el('input.search-input', {
    type: 'search',
    placeholder: `${t('common.search')}…`,
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const results = el('.search-results');

  const panel = el('.search-panel', input, results);
  const backdrop = el('.search-backdrop', panel);

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
  };

  function onKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey, true);

  const go = (path) => { close(); navigate(path); };

  const search = debounce(async () => {
    const query = input.value.trim();
    if (query.length < 2) {
      render(results, el('.search-group__label', { text: t('common.search') }));
      return;
    }
    try {
      const data = await api.search(query);
      const groups = [];

      if (data.projects.length) {
        groups.push(el('.search-group__label', { text: t('nav.projects') }));
        for (const project of data.projects) {
          groups.push(el('.search-item', { onClick: () => go(`/projects/${project.slug}`) },
            icon('layers', { size: 15 }),
            el('span', { text: project.name }),
            el('.search-item__meta', { text: `/${project.slug}` })));
        }
      }
      if (data.deployments.length) {
        groups.push(el('.search-group__label', { text: t('nav.deployments') }));
        for (const deployment of data.deployments) {
          groups.push(el('.search-item', {
            onClick: () => go(`/projects/${deployment.projectSlug}/deployments`),
          },
          icon('rocket', { size: 15 }),
          el('span', { text: `#${deployment.number} ${deployment.projectSlug}` }),
          el('.search-item__meta', { text: fmt.relativeTime(deployment.startedAt) })));
        }
      }
      if (data.logs.length) {
        groups.push(el('.search-group__label', { text: t('nav.logs') }));
        for (const entry of data.logs.slice(0, 5)) {
          groups.push(el('.search-item', { onClick: () => go('/logs') },
            icon('terminal', { size: 15 }),
            el('span.truncate', { text: entry.message }),
            el('.search-item__meta', { text: entry.level })));
        }
      }

      render(results, ...(groups.length
        ? groups
        : [el('.search-item', el('span', { class: 'muted', text: t('common.none') }))]));
    } catch {
      render(results, el('.search-item', el('span', { class: 'muted', text: t('error.network') })));
    }
  }, 220);

  input.addEventListener('input', search);
  document.body.append(backdrop);
  input.focus();
}
