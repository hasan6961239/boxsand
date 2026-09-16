import { el, render } from '../dom.js';
import { icon } from '../icons.js';
import { t, translateError, LOCALES } from '../i18n.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { toasts } from '../toast.js';
import { confirmDialog } from '../modal.js';
import { getState, setTheme, setLanguage } from '../store.js';
import * as fmt from '../format.js';
import {
  card, table, badge, statusBadge, emptyState, loadingBlock, errorBlock,
  field, alert, segmented, iconButton,
} from '../components.js';
import { logLine } from './project.js';
import { openDeploymentDialog } from './projectDeploy.js';

/** Deployments, domains, logs, backups and settings pages. */

// ---------------------------------------------------------------------------
// All deployments
// ---------------------------------------------------------------------------

export async function renderDeployments(container) {
  render(container, loadingBlock());
  let data;
  try {
    data = await api.recentDeployments({ limit: 100 });
  } catch (error) {
    render(container, errorBlock(error, () => renderDeployments(container)));
    return;
  }

  render(container,
    el('.page-header',
      el('.page-header__text',
        el('h1', { text: t('nav.deployments') }),
        el('.page-header__sub', { text: t('overview.recentDeployments') }),
      ),
    ),
    card({
      flush: true,
      body: data.items.length
        ? table({
          columns: [
            {
              label: t('overview.projects'),
              render: (row) => el('div',
                el('.cell-primary', { text: row.projectName ?? row.projectSlug }),
                el('.cell-muted.ltr', { text: `#${row.number}` }),
              ),
            },
            { label: t('common.status'), render: (row) => statusBadge(row.status) },
            {
              label: t('common.files'),
              render: (row) => el('span.tabular.cell-muted', {
                text: row.status === 'READY' ? `${fmt.number(row.fileCount)} · ${fmt.bytes(row.totalBytes)}` : '—',
              }),
            },
            {
              label: t('deploy.duration'),
              render: (row) => el('span.tabular.cell-muted', { text: fmt.duration(row.durationMs) }),
            },
            {
              label: t('deploy.started'),
              render: (row) => el('span.cell-muted', { text: fmt.relativeTime(row.startedAt) }),
            },
            {
              label: t('common.actions'),
              render: (row) => el('.table__actions',
                iconButton('list', { label: t('deploy.viewLogs'), onClick: () => openDeploymentDialog(row) }),
                iconButton('external', {
                  label: t('common.open'),
                  onClick: () => navigate(`/projects/${row.projectSlug}/deployments`),
                }),
              ),
            },
          ],
          rows: data.items,
        })
        : emptyState({ iconName: 'rocket', title: t('overview.noDeployments') }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

export async function renderDomains(container) {
  render(container, loadingBlock());
  let data;
  try {
    data = await api.domains();
  } catch (error) {
    render(container, errorBlock(error, () => renderDomains(container)));
    return;
  }

  render(container,
    el('.page-header',
      el('.page-header__text',
        el('h1', { text: t('domains.title') }),
        el('.page-header__sub', { text: t('domains.sub') }),
      ),
    ),
    data.sitesDomain
      ? el('div', { style: { marginBottom: '14px' } },
        alert('info', `*.${data.sitesDomain}`, t('domains.wildcard')))
      : null,
    card({
      flush: true,
      body: data.items.length
        ? table({
          columns: [
            { label: t('domains.hostname'), render: (d) => el('span.mono.small', { text: d.hostname }) },
            {
              label: t('overview.projects'),
              render: (d) => el('a', { href: `/projects/${d.projectSlug}` }, d.projectSlug),
            },
            {
              label: t('common.status'),
              render: (d) => (d.verified
                ? badge(t('domains.verified'), 'success', { iconName: 'check' })
                : badge(t('domains.unverified'), 'warning')),
            },
            { label: t('common.created'), render: (d) => el('span.cell-muted', { text: fmt.relativeTime(d.createdAt) }) },
          ],
          rows: data.items,
        })
        : emptyState({
          iconName: 'globe',
          title: t('domains.empty'),
          text: t('domains.sub'),
        }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export async function renderLogs(container, { query = {} } = {}) {
  const tab = query.tab ?? 'app';
  const bodySlot = el('div');

  render(container,
    el('.page-header',
      el('.page-header__text',
        el('h1', { text: t('logs.title') }),
      ),
      el('.page-header__actions',
        segmented([
          { value: 'app', label: t('logs.app') },
          { value: 'security', label: t('logs.security') },
          { value: 'audit', label: t('logs.audit') },
        ], tab, (value) => navigate(`/logs?tab=${value}`)),
      ),
    ),
    bodySlot,
  );

  render(bodySlot, loadingBlock());

  try {
    if (tab === 'security') {
      const data = await api.securityLogs({ limit: 200 });
      render(bodySlot, card({
        flush: true,
        body: data.items.length
          ? table({
            columns: [
              { label: t('common.status'), render: (row) => securityBadge(row.type) },
              { label: t('auth.username'), render: (row) => el('span.mono.small', { text: row.username ?? '—' }) },
              { label: 'IP', render: (row) => el('span.mono.small', { text: row.ip ?? '—' }) },
              { label: t('common.updated'), render: (row) => el('span.cell-muted', { text: fmt.dateTime(row.ts) }) },
            ],
            rows: data.items,
          })
          : emptyState({ iconName: 'shield', title: t('logs.empty') }),
      }));
      return;
    }

    if (tab === 'audit') {
      const data = await api.auditLogs({ limit: 200 });
      render(bodySlot, card({
        flush: true,
        body: data.items.length
          ? table({
            columns: [
              { label: t('common.actions'), render: (row) => el('span.mono.small', { text: row.action }) },
              { label: t('common.name'), render: (row) => el('span', { text: row.targetName ?? '—' }) },
              { label: t('nav.account'), render: (row) => el('span.cell-muted', { text: row.actorName ?? '—' }) },
              { label: 'IP', render: (row) => el('span.mono.small', { text: row.ip ?? '—' }) },
              { label: t('common.updated'), render: (row) => el('span.cell-muted', { text: fmt.dateTime(row.ts) }) },
            ],
            rows: data.items,
          })
          : emptyState({ iconName: 'history', title: t('logs.empty') }),
      }));
      return;
    }

    const level = query.level ?? '';
    const data = await api.logs({ limit: 300, level: level || undefined });
    render(bodySlot, card({
      actions: el('.row.row--tight',
        segmented([
          { value: '', label: t('common.all') },
          { value: 'info', label: 'info' },
          { value: 'warn', label: 'warn' },
          { value: 'error', label: 'error' },
        ], level, (value) => navigate(`/logs?tab=app${value ? `&level=${value}` : ''}`)),
        el('button.btn.btn--sm.btn--ghost', {
          type: 'button',
          onClick: async () => {
            const ok = await confirmDialog({
              title: t('logs.clear'), message: t('logs.clear'), danger: true, confirmLabel: t('common.delete'),
            });
            if (!ok) return;
            await api.clearLogs();
            toasts.success(t('logs.cleared'));
            renderLogs(container, { query });
          },
        }, icon('trash', { size: 14 })),
      ),
      body: data.items.length
        ? el('.logview', ...data.items.map(logLine))
        : emptyState({ iconName: 'terminal', title: t('logs.empty') }),
    }));
  } catch (error) {
    render(bodySlot, errorBlock(error, () => renderLogs(container, { query })));
  }
}

function securityBadge(type) {
  if (type === 'login_success') return badge(type, 'success');
  if (type === 'login_failed' || type === 'login_blocked') return badge(type, 'danger');
  if (type === 'setup' || type === 'password_changed') return badge(type, 'info');
  return badge(type, '');
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export async function renderBackups(container) {
  render(container, loadingBlock());
  let data;
  try {
    data = await api.backups();
  } catch (error) {
    render(container, errorBlock(error, () => renderBackups(container)));
    return;
  }

  const createButton = el('button.btn.btn--primary', { type: 'button' },
    icon('archive', { size: 15 }), t('backups.create'));

  createButton.addEventListener('click', async () => {
    createButton.disabled = true;
    render(createButton, el('.spinner'), t('backups.creating'));
    try {
      const result = await api.createBackup({ includeSites: true });
      toasts.success(t('backups.created'), fmt.bytes(result.backup.size));
      renderBackups(container);
    } catch (error) {
      toasts.error(translateError(error));
      createButton.disabled = false;
      render(createButton, icon('archive', { size: 15 }), t('backups.create'));
    }
  });

  render(container,
    el('.page-header',
      el('.page-header__text',
        el('h1', { text: t('backups.title') }),
        el('.page-header__sub', { text: t('backups.sub') }),
      ),
      el('.page-header__actions', createButton, restoreButton()),
    ),

    el('div', { style: { marginBottom: '14px' } },
      alert('warning', t('backups.restore'), t('backups.restore.warn'))),

    card({
      flush: true,
      body: data.items.length
        ? table({
          columns: [
            { label: t('common.name'), render: (row) => el('span.mono.small', { text: row.id }) },
            { label: t('common.size'), render: (row) => el('span.tabular', { text: fmt.bytes(row.size) }) },
            { label: t('common.created'), render: (row) => el('span.cell-muted', { text: fmt.dateTime(row.createdAt) }) },
            {
              label: t('common.actions'),
              render: (row) => el('.table__actions',
                el('a.btn.btn--sm', {
                  href: api.backupDownloadUrl(row.id), download: row.name,
                }, icon('download', { size: 14 })),
                el('button.btn.btn--sm.btn--ghost', {
                  type: 'button',
                  onClick: async () => {
                    const ok = await confirmDialog({
                      title: t('common.delete'),
                      message: t('backups.deleteConfirm'),
                      danger: true,
                      confirmLabel: t('common.delete'),
                    });
                    if (!ok) return;
                    await api.deleteBackup(row.id);
                    toasts.success(t('common.delete'));
                    renderBackups(container);
                  },
                }, icon('trash', { size: 14 })),
              ),
            },
          ],
          rows: data.items,
        })
        : emptyState({ iconName: 'archive', title: t('backups.empty'), text: t('backups.sub') }),
    }),
  );
}

function restoreButton() {
  const picker = el('input', { type: 'file', accept: '.zip', class: 'hidden' });
  const button = el('button.btn', { type: 'button', onClick: () => picker.click() },
    icon('upload', { size: 15 }), t('backups.restore'));

  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;

    const ok = await confirmDialog({
      title: t('backups.restore'),
      message: t('backups.restore.warn'),
      danger: true,
      confirmLabel: t('backups.restore'),
      requireText: 'restore',
    });
    if (!ok) return;

    button.disabled = true;
    render(button, el('.spinner'), t('common.loading'));
    try {
      await api.restoreBackup(file);
      toasts.success(t('backups.restore.done'));
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      toasts.error(translateError(error));
      button.disabled = false;
      render(button, icon('upload', { size: 15 }), t('backups.restore'));
    }
  });

  return el('span', button, picker);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function renderSettings(container) {
  render(container, loadingBlock());
  let data;
  let sessions;
  try {
    [data, sessions] = await Promise.all([api.settings(), api.sessions()]);
  } catch (error) {
    render(container, errorBlock(error, () => renderSettings(container)));
    return;
  }

  const state = getState();
  const inputs = {};

  const numberField = (key) => {
    const spec = data.schema[key];
    const input = el('input.input', {
      type: 'number', value: String(data.values[key]),
      min: String(spec.min), max: String(spec.max),
    });
    inputs[key] = input;
    return field({
      label: t(`settings.${key}`),
      input,
      hint: `${spec.min} – ${spec.max} · ${t('settings.default')}: ${data.defaults[key]}`,
    });
  };

  const saveLimits = async () => {
    const payload = {};
    for (const [key, input] of Object.entries(inputs)) payload[key] = Number(input.value);
    try {
      await api.updateSettings(payload);
      toasts.success(t('settings.saved'));
    } catch (error) {
      toasts.error(translateError(error));
    }
  };

  const currentPassword = el('input.input', { type: 'password', autocomplete: 'current-password', dir: 'ltr' });
  const newPassword = el('input.input', { type: 'password', autocomplete: 'new-password', minlength: '10', dir: 'ltr' });

  render(container,
    el('.page-header',
      el('.page-header__text', el('h1', { text: t('settings.title') })),
    ),

    el('.stack',
      card({
        title: t('settings.appearance'),
        body: el('.stack',
          el('.row',
            el('span', { class: 'small', text: t('settings.theme') }),
            el('.spacer'),
            segmented([
              { value: 'dark', label: t('settings.theme.dark'), iconName: 'moon' },
              { value: 'light', label: t('settings.theme.light'), iconName: 'sun' },
              { value: 'system', label: t('settings.theme.system'), iconName: 'monitor' },
            ], state.theme, (value) => {
              setTheme(value);
              api.updateProfile({ theme: value }).catch(() => {});
              renderSettings(container);
            }),
          ),
          el('.row',
            el('span', { class: 'small', text: t('settings.language') }),
            el('.spacer'),
            segmented(
              LOCALES.map((locale) => ({ value: locale.code, label: locale.label })),
              state.locale,
              (value) => {
                setLanguage(value);
                api.updateProfile({ locale: value }).catch(() => {});
                window.location.reload();
              },
            ),
          ),
        ),
      }),

      card({
        title: t('settings.limits'),
        body: el('div',
          alert('info', null, t('settings.cloudflareHint')),
          el('div', { style: { height: '14px' } }),
          numberField('maxUploadMb'),
          numberField('maxFilesPerDeploy'),
          numberField('maxUncompressedMb'),
          numberField('maxSingleFileMb'),
          numberField('maxCompressionRatio'),
          numberField('keepDeployments'),
        ),
        footer: el('.row', el('.spacer'),
          el('button.btn.btn--primary', { type: 'button', onClick: saveLimits }, t('common.save'))),
      }),

      card({
        title: t('settings.retention'),
        body: el('div',
          numberField('logRetentionDays'),
          numberField('securityRetentionDays'),
        ),
        footer: el('.row', el('.spacer'),
          el('button.btn.btn--primary', { type: 'button', onClick: saveLimits }, t('common.save'))),
      }),

      card({
        title: t('settings.password'),
        body: el('div',
          field({ label: t('settings.currentPassword'), input: currentPassword }),
          field({ label: t('settings.newPassword'), input: newPassword, hint: t('setup.password.hint') }),
        ),
        footer: el('.row', el('.spacer'),
          el('button.btn.btn--primary', {
            type: 'button',
            onClick: async () => {
              try {
                await api.changePassword({
                  currentPassword: currentPassword.value,
                  newPassword: newPassword.value,
                });
                toasts.success(t('settings.passwordChanged'));
                currentPassword.value = '';
                newPassword.value = '';
              } catch (error) {
                toasts.error(translateError(error));
              }
            },
          }, t('common.save'))),
      }),

      card({
        title: t('settings.sessions'),
        flush: true,
        body: table({
          columns: [
            {
              label: 'IP',
              render: (row) => el('div',
                el('span.mono.small', { text: row.ip ?? '—' }),
                row.current ? el('.cell-muted', { text: t('settings.sessionCurrent') }) : null,
              ),
            },
            {
              label: t('common.updated'),
              render: (row) => el('span.cell-muted', { text: fmt.relativeTime(row.lastSeenAt) }),
            },
            {
              label: t('common.actions'),
              render: (row) => el('.table__actions',
                el('button.btn.btn--sm.btn--ghost', {
                  type: 'button',
                  onClick: async () => {
                    await api.revokeSession(row.id);
                    if (row.current) window.location.href = '/';
                    else renderSettings(container);
                  },
                }, t('settings.revoke')),
              ),
            },
          ],
          rows: sessions.items,
        }),
      }),

      card({
        title: t('settings.environment'),
        body: el('.stack',
          ...Object.entries(data.environment).map(([key, value]) => el('.row',
            el('span', { class: 'small muted', text: key }),
            el('.spacer'),
            el('span', { class: 'small mono ltr', text: String(value ?? '—') }),
          )),
        ),
      }),
    ),
  );

}
