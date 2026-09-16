import { el, render } from './dom.js';
import { t, onLocaleChange } from './i18n.js';
import { api, setCsrfToken, onUnauthorized } from './api.js';
import { route, notFound, startRouter, navigate, resolve } from './router.js';
import { getState, setState, initPreferences, setLanguage, setTheme } from './store.js';
import { buildShell, setPageTitle, refreshNav } from './shell.js';
import { toasts } from './toast.js';
import { renderLogin, renderSetup } from './views/auth.js';
import { renderOverview } from './views/overview.js';
import { renderProjects } from './views/projects.js';
import { renderProject } from './views/project.js';
import { renderServer, stopServerPolling } from './views/server.js';
import { renderDeployments, renderDomains, renderLogs, renderBackups, renderSettings } from './views/misc.js';
import { emptyState } from './components.js';

/**
 * Entry point.
 *
 * Boot order:
 *   1. apply the stored theme and language before anything renders, so there is
 *      no flash of the wrong theme;
 *   2. ask the server who we are;
 *   3. show setup, login or the dashboard accordingly.
 */

const root = document.getElementById('app');
let shell = null;

async function bootstrap() {
  initPreferences();

  onUnauthorized(() => {
    setState({ user: null });
    setCsrfToken(null);
    if (shell) {
      shell = null;
      toasts.warning(t('error.UNAUTHORIZED'));
      renderLogin(root);
    }
  });

  let session = null;
  try {
    session = await api.me();
  } catch (error) {
    if (error.code !== 'UNAUTHORIZED') {
      // The server is unreachable or broken — say so instead of showing a
      // login form that cannot possibly work.
      render(root, el('.auth', el('.auth__card',
        el('.auth__brand',
          el('.auth__logo', 'NH'),
          el('.auth__title', { text: t('error.network') }),
          el('.auth__sub', { text: error.message ?? '' })),
        el('.card', el('.card__body',
          el('button.btn.btn--primary.btn--block', {
            type: 'button', onClick: () => window.location.reload(),
          }, t('common.retry')))),
      )));
      return;
    }
  }

  if (session) {
    setCsrfToken(session.csrfToken);
    setState({ user: session.user });
    // The account's stored preferences win on a fresh device.
    if (session.user.locale) setLanguage(session.user.locale);
    if (session.user.theme) setTheme(session.user.theme);
    mountDashboard();
    return;
  }

  const status = await api.setupStatus().catch(() => ({ setupRequired: false }));
  setState({ setupRequired: status.setupRequired });

  if (status.setupRequired) renderSetup(root);
  else renderLogin(root);
}

function mountDashboard() {
  shell = buildShell(root, {
    onLogout: () => {
      setState({ user: null });
      setCsrfToken(null);
      shell = null;
      stopServerPolling();
      navigate('/');
      renderLogin(root);
    },
  });
  resolve();
}

/** Guard: routes below require a session and a mounted shell. */
function view(title, handler) {
  return async (context) => {
    if (!getState().user) {
      renderLogin(root);
      return;
    }
    if (!shell) {
      mountDashboard();
      return;
    }
    stopServerPolling();
    setPageTitle(title());
    refreshNav();
    shell.content.scrollTop = 0;
    window.scrollTo(0, 0);
    await handler(shell.content, context);
  };
}

route('/', view(() => t('nav.overview'), (container) =>
  renderOverview(container, { user: getState().user })));

route('/projects', view(() => t('nav.projects'), (container, ctx) =>
  renderProjects(container, { query: ctx.query })));

route('/projects/:slug', view(() => t('nav.projects'), (container, ctx) =>
  renderProject(container, { slug: ctx.params.slug, tab: 'overview' })));

for (const tab of ['deployments', 'files', 'domains', 'logs', 'settings']) {
  route(`/projects/:slug/${tab}`, view(() => t('nav.projects'), (container, ctx) =>
    renderProject(container, { slug: ctx.params.slug, tab })));
}

route('/deployments', view(() => t('nav.deployments'), (container) =>
  renderDeployments(container)));

route('/domains', view(() => t('nav.domains'), (container) =>
  renderDomains(container)));

route('/server', view(() => t('nav.server'), (container) =>
  renderServer(container)));

route('/logs', view(() => t('nav.logs'), (container, ctx) =>
  renderLogs(container, { query: ctx.query })));

route('/backups', view(() => t('nav.backups'), (container) =>
  renderBackups(container)));

route('/settings', view(() => t('nav.settings'), (container) =>
  renderSettings(container)));

notFound(view(() => '404', (container) => {
  render(container, emptyState({
    iconName: 'alert',
    title: '404',
    text: window.location.pathname,
    action: el('a.btn.btn--primary', { href: '/' }, t('nav.overview')),
  }));
}));

onLocaleChange(() => {
  if (shell) {
    refreshNav();
    resolve();
  }
});

startRouter();
bootstrap();
