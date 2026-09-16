import { el, render } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import * as fmt from '../format.js';
import {
  card, statCard, table, statusBadge, emptyState, loadingBlock, errorBlock, badge, alert,
} from '../components.js';
import { openNewProjectDialog } from './projects.js';

/** Dashboard home: one request, everything above the fold. */
export async function renderOverview(container, { user }) {
  render(container, loadingBlock());

  let data;
  try {
    data = await api.overview();
  } catch (error) {
    render(container, errorBlock(error, () => renderOverview(container, { user })));
    return;
  }

  const { counts, storage, health, system, recentDeployments, recentActivity } = data;

  const healthTone = health.status === 'ok' ? 'success' : 'warning';
  const healthLabel = health.status === 'ok' ? t('overview.online') : t('overview.degraded');

  const diskPercent = system.storage?.usedPercent ?? null;
  const memoryPercent = system.memory?.usedPercent ?? null;

  // Warnings the operator genuinely needs to see, and nothing else. A phone
  // that runs hot degrades its battery, and a full disk breaks deploys.
  const warnings = [];
  if (system.battery && Number.isFinite(system.battery.percentage)
      && system.battery.percentage < 20 && system.battery.status !== 'CHARGING') {
    warnings.push(alert('warning', null, t('server.batteryWarning', { percent: system.battery.percentage })));
  }
  if (system.temperature?.celsius >= 45) {
    warnings.push(alert('warning', null, t('server.tempWarning', { temp: system.temperature.celsius })));
  }
  if (diskPercent !== null && diskPercent >= 90) {
    warnings.push(alert('danger', null, t('error.DISK_FULL')));
  }

  render(container,
    el('.page-header',
      el('.page-header__text',
        el('h1', { text: `${t('overview.welcome')}, ${user.displayName}` }),
        el('.page-header__sub',
          badge(healthLabel, healthTone, { pulse: health.status === 'ok' }),
          ' ',
          el('span', { text: `${t('server.uptime')}: ${fmt.uptime(system.uptime.processSeconds)}` }),
        ),
      ),
      el('.page-header__actions',
        el('button.btn.btn--primary', { type: 'button', onClick: () => openNewProjectDialog() },
          icon('plus', { size: 16 }), t('overview.newProject')),
      ),
    ),

    warnings.length ? el('.stack', { style: { marginBottom: '16px' } }, ...warnings) : null,

    el('.grid.grid--stats', { style: { marginBottom: '16px' } },
      statCard({
        label: t('overview.projects'),
        value: fmt.number(counts.projects),
        hint: `${fmt.number(counts.published)} ${t('overview.published').toLowerCase()}`,
        iconName: 'layers',
      }),
      statCard({
        label: t('nav.deployments'),
        value: fmt.number(counts.deployments.total),
        hint: `${fmt.number(counts.deployments.ready)} ✓ · ${fmt.number(counts.deployments.failed)} ✗`,
        iconName: 'rocket',
      }),
      statCard({
        label: t('overview.storage'),
        value: fmt.bytes(storage.total),
        hint: system.storage
          ? `${fmt.bytes(system.storage.free)} ${t('overview.free')} · ${fmt.percent(diskPercent)}`
          : t('common.unavailable'),
        iconName: 'database',
        meter: diskPercent !== null ? { percent: diskPercent } : null,
      }),
      statCard({
        label: t('server.memory'),
        value: system.memory ? fmt.percent(memoryPercent) : t('common.unavailable'),
        hint: system.memory ? `${fmt.bytes(system.memory.used)} / ${fmt.bytes(system.memory.total)}` : null,
        iconName: 'cpu',
        meter: memoryPercent !== null ? { percent: memoryPercent } : null,
      }),
    ),

    el('.grid.grid--2',
      card({
        title: t('overview.recentDeployments'),
        actions: el('button.btn.btn--ghost.btn--sm', {
          type: 'button', onClick: () => navigate('/deployments'),
        }, t('common.all')),
        flush: true,
        body: recentDeployments.length
          ? table({
            columns: [
              {
                label: t('overview.projects'),
                render: (row) => el('div',
                  el('.cell-primary', { text: row.projectName ?? row.projectSlug }),
                  el('.cell-muted.ltr', { text: `#${row.number} · ${fmt.shortId(row.id)}` }),
                ),
              },
              { label: t('common.status'), render: (row) => statusBadge(row.status) },
              {
                label: t('common.updated'),
                render: (row) => el('span.cell-muted', { text: fmt.relativeTime(row.startedAt) }),
              },
            ],
            rows: recentDeployments,
            onRowClick: (row) => navigate(`/projects/${row.projectSlug}/deployments`),
          })
          : emptyState({ iconName: 'rocket', title: t('overview.noDeployments') }),
      }),

      card({
        title: t('overview.serverHealth'),
        actions: el('button.btn.btn--ghost.btn--sm', {
          type: 'button', onClick: () => navigate('/server'),
        }, t('common.open')),
        body: el('.stack',
          healthRow(t('server.database'), health.checks.database === 'ok'
            ? badge(t('server.connected'), 'success')
            : badge(health.checks.database, 'danger')),
          healthRow(t('server.storage'), health.checks.disk === 'ok'
            ? badge('OK', 'success')
            : badge(health.checks.disk, health.checks.disk === 'low' ? 'warning' : '')),
          healthRow(t('server.cpu'), el('span.tabular', {
            text: system.cpu?.usagePercent !== null && system.cpu?.usagePercent !== undefined
              ? fmt.percent(system.cpu.usagePercent, 1)
              : t('common.unavailable'),
          })),
          healthRow(t('server.battery'), system.battery
            ? el('span.tabular', { text: `${system.battery.percentage}% · ${system.battery.status ?? ''}` })
            : el('span.subtle', { text: t('common.unavailable') })),
          healthRow(t('server.temperature'), system.temperature
            ? el('span.tabular', { text: `${system.temperature.celsius}°C` })
            : el('span.subtle', { text: t('common.unavailable') })),
          healthRow(t('server.uptime'), el('span', { text: fmt.uptime(system.uptime.systemSeconds) })),
        ),
      }),
    ),

    recentActivity.length
      ? el('div', { style: { marginTop: '14px' } },
        card({
          title: t('overview.activity'),
          flush: true,
          body: table({
            columns: [
              { label: t('common.actions'), render: (row) => el('span.mono.small', { text: row.action }) },
              { label: t('common.name'), render: (row) => el('span', { text: row.targetName ?? '—' }) },
              { label: t('common.updated'), render: (row) => el('span.cell-muted', { text: fmt.relativeTime(row.ts) }) },
            ],
            rows: recentActivity,
          }),
        }))
      : null,
  );
}

function healthRow(label, value) {
  return el('.row',
    el('span', { class: 'muted small', text: label }),
    el('.spacer'),
    value,
  );
}
