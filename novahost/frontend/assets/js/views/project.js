import { el, render } from '../dom.js';
import { icon } from '../icons.js';
import { t, translateError } from '../i18n.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { toasts } from '../toast.js';
import { confirmDialog } from '../modal.js';
import * as fmt from '../format.js';
import {
  card, statCard, badge, loadingBlock, errorBlock, field, alert, copyField, table, emptyState,
} from '../components.js';
import { primaryUrl, openQrDialog, confirmDeleteProject } from './projects.js';
import { renderDeploymentsTab } from './projectDeploy.js';
import { renderFilesTab } from './projectFiles.js';

const TABS = [
  { key: 'overview', labelKey: 'project.tab.overview', path: '' },
  { key: 'deployments', labelKey: 'project.tab.deployments', path: '/deployments' },
  { key: 'files', labelKey: 'project.tab.files', path: '/files' },
  { key: 'domains', labelKey: 'project.tab.domains', path: '/domains' },
  { key: 'logs', labelKey: 'project.tab.logs', path: '/logs' },
  { key: 'settings', labelKey: 'project.tab.settings', path: '/settings' },
];

export async function renderProject(container, { slug, tab = 'overview' }) {
  render(container, loadingBlock());

  let project;
  try {
    ({ project } = await api.project(slug));
  } catch (error) {
    render(container, errorBlock(error, () => renderProject(container, { slug, tab })));
    return;
  }

  const reload = () => renderProject(container, { slug, tab });
  const bodySlot = el('div');

  render(container,
    el('.page-header',
      el('.page-header__text',
        el('.row.row--tight', { style: { marginBottom: '2px' } },
          el('a.btn.btn--ghost.btn--icon.btn--sm', {
            href: '/projects', 'aria-label': t('common.back'),
          }, icon('arrowLeft', { size: 15 })),
          el('h1', { text: project.name }),
          !project.enabled ? badge(t('projects.paused'), 'warning', { iconName: 'pause' }) : null,
          project.visibility === 'private' ? badge(t('projects.visibility.private'), '') : null,
        ),
        el('.page-header__sub.ltr', { text: `/${project.slug}` }),
      ),
      el('.page-header__actions',
        project.currentDeploymentId
          ? el('a.btn', { href: primaryUrl(project), target: '_blank', rel: 'noopener' },
            icon('external', { size: 15 }), t('projects.openSite'))
          : null,
        el('button.btn', { type: 'button', onClick: () => openQrDialog(project) },
          icon('qr', { size: 15 })),
      ),
    ),

    el('.segmented', { style: { marginBottom: '16px', flexWrap: 'wrap' } },
      ...TABS.map((entry) => el('button', {
        type: 'button',
        class: entry.key === tab ? 'is-active' : '',
        onClick: () => navigate(`/projects/${project.slug}${entry.path}`),
      }, t(entry.labelKey))),
    ),

    bodySlot,
  );

  switch (tab) {
    case 'deployments':
      await renderDeploymentsTab(bodySlot, { project, reload });
      break;
    case 'files':
      await renderFilesTab(bodySlot, { project, reload });
      break;
    case 'domains':
      await renderDomainsTab(bodySlot, { project, reload });
      break;
    case 'logs':
      await renderProjectLogsTab(bodySlot, { project });
      break;
    case 'settings':
      renderSettingsTab(bodySlot, { project, reload });
      break;
    default:
      await renderOverviewTab(bodySlot, { project });
  }
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

async function renderOverviewTab(container, { project }) {
  render(container, loadingBlock());

  let stats;
  try {
    stats = await api.projectStats(project.id);
  } catch (error) {
    render(container, errorBlock(error));
    return;
  }

  const current = project.currentDeployment;

  render(container,
    el('.grid.grid--stats', { style: { marginBottom: '14px' } },
      statCard({ label: t('common.size'), value: fmt.bytes(project.storageBytes), iconName: 'database' }),
      statCard({ label: t('common.files'), value: fmt.number(project.fileCount), iconName: 'file' }),
      statCard({ label: t('projects.deployments'), value: fmt.number(stats.deployments), iconName: 'rocket' }),
      statCard({
        label: t('projects.lastDeploy'),
        value: el('span', { style: { fontSize: '1rem' }, text: fmt.relativeTime(project.lastDeployedAt) }),
        iconName: 'clock',
      }),
    ),

    el('.grid.grid--2',
      card({
        title: t('common.url'),
        body: el('.stack',
          ...(project.urls ?? []).map((entry) => copyField(
            entry.kind === 'path' ? resolvePathUrl(entry.url) : entry.url,
            { label: urlKindLabel(entry) },
          )),
          project.urls?.length === 1 && project.urls[0].kind === 'path'
            ? alert('info', null, t('domains.wildcard'))
            : null,
        ),
      }),

      card({
        title: t('deploy.current'),
        body: current
          ? el('.stack',
            detailRow(t('deploy.deployment'), el('span.mono.small', { text: `#${current.number} · ${current.id}` })),
            detailRow(t('common.status'), badge(current.status, fmt.statusTone(current.status))),
            detailRow(t('common.files'), el('span.tabular', { text: fmt.number(current.fileCount) })),
            detailRow(t('common.size'), el('span.tabular', { text: fmt.bytes(current.totalBytes) })),
            detailRow(t('deploy.duration'), el('span.tabular', { text: fmt.duration(current.durationMs) })),
            detailRow(t('deploy.finished'), el('span.small', { text: fmt.dateTime(current.finishedAt) })),
            current.entryFile
              ? detailRow('index', el('span.mono.small', { text: current.entryFile }))
              : null,
          )
          : emptyState({
            iconName: 'rocket',
            title: t('deploy.empty'),
            text: t('projects.empty.text'),
            action: el('button.btn.btn--primary', {
              type: 'button', onClick: () => navigate(`/projects/${project.slug}/deployments`),
            }, icon('upload', { size: 15 }), t('deploy.title')),
          }),
      }),
    ),
  );

}

function detailRow(label, value) {
  return el('.row',
    el('span', { class: 'muted small', text: label }),
    el('.spacer'),
    value,
  );
}

function urlKindLabel(entry) {
  if (entry.kind === 'subdomain') return 'Subdomain';
  if (entry.kind === 'custom') return `Custom${entry.verified ? '' : ' (unverified)'}`;
  return 'Local network';
}

function resolvePathUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hostname = window.location.hostname;
    parsed.protocol = window.location.protocol;
    return parsed.href;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Domains tab
// ---------------------------------------------------------------------------

async function renderDomainsTab(container, { project, reload }) {
  const hostname = el('input.input', { type: 'text', dir: 'ltr', placeholder: 'www.example.com' });

  const addDomain = async () => {
    const value = hostname.value.trim();
    if (!value) {
      // A button that silently does nothing reads as broken. Say what is missing.
      hostname.setAttribute('aria-invalid', 'true');
      hostname.focus();
      toasts.warning(t('domains.hostname'), t('common.required'));
      return;
    }
    hostname.removeAttribute('aria-invalid');
    try {
      const result = await api.addDomain(project.id, value);
      toasts.success(t('domains.verified'), value);
      showInstructions(result);
      reload();
    } catch (error) {
      toasts.error(translateError(error));
    }
  };

  const instructionSlot = el('div');
  function showInstructions(result) {
    render(instructionSlot,
      card({
        title: t('domains.instructions'),
        body: el('.stack',
          copyField(result.instructions.txtRecord.name, { label: 'TXT name' }),
          copyField(result.instructions.txtRecord.value, { label: 'TXT value' }),
          copyField(result.instructions.cname.value, { label: 'CNAME target' }),
          el('p', { class: 'small subtle', text: result.instructions.note }),
        ),
      }),
    );
  }

  render(container,
    el('.stack',
      card({
        title: t('domains.add'),
        body: el('.row', { style: { alignItems: 'flex-end' } },
          el('div', { style: { flex: '1', minWidth: '200px' } },
            field({ label: t('domains.hostname'), input: hostname })),
          el('button.btn.btn--primary', { type: 'button', onClick: addDomain },
            icon('plus', { size: 15 }), t('domains.add')),
        ),
      }),
      instructionSlot,
      card({
        title: t('domains.title'),
        flush: true,
        body: project.domains?.length
          ? table({
            columns: [
              { label: t('domains.hostname'), render: (d) => el('span.mono.small', { text: d.hostname }) },
              {
                label: t('common.status'),
                render: (d) => (d.verified
                  ? badge(t('domains.verified'), 'success', { iconName: 'check' })
                  : badge(t('domains.unverified'), 'warning')),
              },
              {
                label: t('common.actions'),
                render: (d) => el('.table__actions',
                  !d.verified
                    ? el('button.btn.btn--sm', {
                      type: 'button',
                      onClick: async () => {
                        try {
                          await api.verifyDomain(d.id);
                          toasts.success(t('domains.verified'));
                          reload();
                        } catch (error) {
                          toasts.error(translateError(error));
                        }
                      },
                    }, t('domains.verify'))
                    : null,
                  el('button.btn.btn--sm.btn--ghost', {
                    type: 'button',
                    onClick: async () => {
                      const ok = await confirmDialog({
                        title: t('common.delete'),
                        message: d.hostname,
                        danger: true,
                        confirmLabel: t('common.delete'),
                      });
                      if (!ok) return;
                      await api.deleteDomain(d.id);
                      reload();
                    },
                  }, icon('trash', { size: 14 })),
                ),
              },
            ],
            rows: project.domains,
          })
          : emptyState({ iconName: 'globe', title: t('domains.empty'), text: t('domains.sub') }),
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Logs tab
// ---------------------------------------------------------------------------

async function renderProjectLogsTab(container, { project }) {
  render(container, loadingBlock());
  let data;
  try {
    data = await api.logs({ projectId: project.id, limit: 200 });
  } catch (error) {
    render(container, errorBlock(error));
    return;
  }

  render(container, card({
    title: t('logs.title'),
    actions: el('button.btn.btn--ghost.btn--sm', {
      type: 'button', onClick: () => renderProjectLogsTab(container, { project }),
    }, icon('refresh', { size: 14 })),
    body: data.items.length
      ? el('.logview', ...data.items.map(logLine))
      : emptyState({ iconName: 'terminal', title: t('logs.empty') }),
  }));
}

export function logLine(entry) {
  return el(`.logline.logline--${entry.level}`,
    el('span.logline__ts', { text: fmt.timeOnly(entry.ts) }),
    el('span.logline__level', { text: entry.level.toUpperCase() }),
    el('span.logline__module', { text: `[${entry.module}]` }),
    el('span.logline__msg', { text: entry.message }),
  );
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

function renderSettingsTab(container, { project, reload }) {
  const name = el('input.input', { type: 'text', value: project.name, maxlength: '100' });
  const slug = el('input.input', { type: 'text', value: project.slug, dir: 'ltr', maxlength: '63' });
  const description = el('textarea.textarea', { rows: '3', maxlength: '500' });
  description.value = project.description ?? '';
  const visibility = el('select.select',
    el('option', { value: 'public', selected: project.visibility === 'public' }, t('projects.visibility.public')),
    el('option', { value: 'private', selected: project.visibility === 'private' }, t('projects.visibility.private')),
  );

  const save = async () => {
    try {
      await api.updateProject(project.id, {
        name: name.value.trim(),
        slug: slug.value.trim(),
        description: description.value.trim(),
        visibility: visibility.value,
      });
      toasts.success(t('settings.saved'));
      const newSlug = slug.value.trim();
      if (newSlug !== project.slug) navigate(`/projects/${newSlug}/settings`);
      else reload();
    } catch (error) {
      toasts.error(translateError(error));
    }
  };

  render(container,
    el('.stack',
      card({
        title: t('settings.general'),
        body: el('div',
          field({ label: t('common.name'), input: name }),
          field({ label: t('projects.slug'), input: slug, hint: t('projects.slug.hint') }),
          field({ label: t('projects.description'), input: description }),
          field({ label: t('projects.visibility'), input: visibility, hint: t('projects.visibility.hint') }),
        ),
        footer: el('.row',
          el('.spacer'),
          el('button.btn.btn--primary', { type: 'button', onClick: save }, t('common.save')),
        ),
      }),

      card({
        title: project.enabled ? t('projects.pause') : t('projects.resume'),
        body: el('.row',
          el('p', { class: 'muted small', style: { flex: '1', minWidth: '200px' },
            text: project.enabled
              ? 'A paused site answers 503 instead of serving files. Deployments and files are untouched.'
              : 'Resume serving this site.' }),
          el('button.btn', {
            type: 'button',
            onClick: async () => {
              try {
                await api.setProjectEnabled(project.id, !project.enabled);
                toasts.success(project.enabled ? t('projects.pause') : t('projects.resume'));
                reload();
              } catch (error) {
                toasts.error(translateError(error));
              }
            },
          }, icon(project.enabled ? 'pause' : 'play', { size: 15 }),
          project.enabled ? t('projects.pause') : t('projects.resume')),
        ),
      }),

      card({
        title: t('common.download'),
        body: el('.row',
          el('p', { class: 'muted small', style: { flex: '1', minWidth: '200px' },
            text: 'Download the live deployment as a ZIP.' }),
          el('a.btn', {
            href: api.downloadProjectUrl(project.id),
            download: `${project.slug}.zip`,
          }, icon('download', { size: 15 }), t('common.download')),
        ),
      }),

      card({
        title: t('projects.delete.title'),
        body: el('.stack',
          alert('danger', t('projects.delete.title'), t('projects.delete.warn')),
          el('.row',
            el('.spacer'),
            el('button.btn.btn--danger', {
              type: 'button',
              onClick: async () => {
                if (await confirmDeleteProject(project)) navigate('/projects');
              },
            }, icon('trash', { size: 15 }), t('common.delete')),
          ),
        ),
      }),
    ),
  );
}
