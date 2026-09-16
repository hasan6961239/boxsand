import { el, render } from '../dom.js';
import { icon } from '../icons.js';
import { t, translateError } from '../i18n.js';
import { api } from '../api.js';
import { toasts } from '../toast.js';
import { confirmDialog } from '../modal.js';
import * as fmt from '../format.js';
import {
  card, statCard, badge, loadingBlock, errorBlock, table, alert, copyField,
} from '../components.js';

/**
 * Server page.
 *
 * Every value here is read from the device. Where Android will not let an
 * unprivileged process read something — network counters since Android 10,
 * battery and temperature without the Termux:API app — the page says
 * "Unavailable" and explains why. It never fills the gap with a plausible number.
 */

let refreshTimer = null;

export async function renderServer(container) {
  render(container, loadingBlock());

  let stats;
  let info;
  let storage;
  try {
    [stats, info, storage] = await Promise.all([
      api.serverStats(), api.serverInfo(), api.serverStorage(),
    ]);
  } catch (error) {
    render(container, errorBlock(error, () => renderServer(container)));
    return;
  }

  const statsSlot = el('div');

  render(container,
    el('.page-header',
      el('.page-header__text',
        el('h1', { text: t('server.title') }),
        el('.page-header__sub', { text: t('server.sub') }),
      ),
      el('.page-header__actions',
        el('button.btn', { type: 'button', onClick: () => renderServer(container) },
          icon('refresh', { size: 15 }), t('common.refresh')),
      ),
    ),
    statsSlot,

    el('.grid.grid--2', { style: { marginTop: '14px' } },
      card({
        title: t('server.system'),
        body: el('.stack',
          infoRow('Node.js', info.runtime.node),
          infoRow(t('server.database'), `SQLite (${info.database.driver})`),
          infoRow('Platform', `${info.runtime.platform} / ${info.runtime.arch}`),
          infoRow('Termux', info.runtime.termuxVersion ?? (info.runtime.isTermux ? 'yes' : t('common.no'))),
          stats.android
            ? infoRow('Android', `${stats.android.androidVersion ?? '?'} (SDK ${stats.android.sdk ?? '?'})`)
            : infoRow('Android', t('common.unavailable')),
          stats.android?.model
            ? infoRow('Device', `${stats.android.manufacturer ?? ''} ${stats.android.model}`.trim())
            : null,
          infoRow('Hostname', stats.host.hostname),
          infoRow('Process RSS', fmt.bytes(info.runtime.memoryUsage.rss)),
          infoRow(t('server.uptime'), `${fmt.uptime(stats.uptime.systemSeconds)} · ${t('nav.account')}: ${fmt.uptime(stats.uptime.processSeconds)}`),
        ),
      }),

      card({
        title: t('server.addresses'),
        body: el('.stack',
          ...(stats.host.addresses.length
            ? stats.host.addresses.map((entry) => copyField(
              `http://${entry.address}:${info.config.listen.split(':').pop()}`,
              { label: entry.interface },
            ))
            : [el('p', { class: 'muted small', text: t('common.unavailable') })]),
          el('p', { class: 'small subtle', text: `${t('nav.projects')}: ${info.config.sitesListen}` }),
        ),
      }),
    ),

    card({
      title: t('overview.storage'),
      body: el('.stack',
        storageRow(t('nav.projects'), storage.usage.projects, storage.usage.total),
        storageRow(t('server.database'), storage.usage.database, storage.usage.total),
        storageRow(t('nav.logs'), storage.usage.logs, storage.usage.total),
        storageRow(t('nav.backups'), storage.usage.backups, storage.usage.total),
        el('hr', { style: { border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' } }),
        el('.row',
          el('strong', { text: t('common.all') }),
          el('.spacer'),
          el('strong.tabular', { text: fmt.bytes(storage.usage.total) }),
        ),
        storage.largestProjects.length
          ? el('div', { style: { marginTop: '10px' } },
            table({
              columns: [
                { label: t('common.name'), render: (row) => el('span', { text: row.name }) },
                { label: t('common.size'), render: (row) => el('span.tabular', { text: fmt.bytes(row.storageBytes) }) },
                { label: t('common.files'), render: (row) => el('span.tabular', { text: fmt.number(row.fileCount) }) },
              ],
              rows: storage.largestProjects,
            }))
          : null,
      ),
      footer: el('.row',
        el('button.btn.btn--sm', {
          type: 'button',
          onClick: async () => {
            try {
              await api.rescanStorage();
              toasts.success(t('server.rescan'));
              renderServer(container);
            } catch (error) { toasts.error(translateError(error)); }
          },
        }, icon('refresh', { size: 14 }), t('server.rescan')),
        el('button.btn.btn--sm', {
          type: 'button',
          onClick: async () => {
            try {
              const result = await api.cleanup();
              const removed = Object.entries(result).filter(([, v]) => v > 0)
                .map(([k, v]) => `${k}: ${v}`).join(', ');
              toasts.success(removed || t('server.cleanup.done'));
              renderServer(container);
            } catch (error) { toasts.error(translateError(error)); }
          },
        }, icon('trash', { size: 14 }), t('server.cleanup')),
        el('.spacer'),
        el('button.btn.btn--sm.btn--danger', {
          type: 'button',
          onClick: async () => {
            const ok = await confirmDialog({
              title: t('server.restart'),
              message: t('server.restart.confirm'),
              danger: true,
              confirmLabel: t('server.restart'),
            });
            if (!ok) return;
            try {
              await api.restart();
              toasts.info(t('server.restart'));
            } catch (error) { toasts.error(translateError(error)); }
          },
        }, icon('rotate', { size: 14 }), t('server.restart')),
      ),
    }),
  );

  const paint = (current) => render(statsSlot, liveStats(current));
  paint(stats);

  // Poll while the page is visible. Ten seconds is often enough to be useful
  // and rare enough not to keep the phone's CPU busy.
  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (!container.isConnected) {
      clearInterval(refreshTimer);
      return;
    }
    if (document.hidden) return;
    try {
      paint(await api.serverStats());
    } catch { /* a transient failure should not blank the page */ }
  }, 10_000);
}

export function stopServerPolling() {
  clearInterval(refreshTimer);
  refreshTimer = null;
}

function liveStats(stats) {
  const notes = [];
  if (!stats.battery) notes.push(t('server.termuxApiHint'));
  if (!stats.network) notes.push(t('server.androidNetHint'));

  return el('div',
    el('.grid.grid--stats',
      statCard({
        label: t('server.cpu'),
        value: stats.cpu?.usagePercent !== null && stats.cpu?.usagePercent !== undefined
          ? fmt.percent(stats.cpu.usagePercent, 1) : t('common.unavailable'),
        hint: stats.cpu?.cores ? `${stats.cpu.cores} cores${stats.load ? ` · load ${stats.load[0]}` : ''}` : null,
        iconName: 'cpu',
        meter: Number.isFinite(stats.cpu?.usagePercent) ? { percent: stats.cpu.usagePercent } : null,
      }),
      statCard({
        label: t('server.memory'),
        value: stats.memory ? fmt.percent(stats.memory.usedPercent, 1) : t('common.unavailable'),
        hint: stats.memory ? `${fmt.bytes(stats.memory.used)} / ${fmt.bytes(stats.memory.total)}` : null,
        iconName: 'activity',
        meter: stats.memory ? { percent: stats.memory.usedPercent } : null,
      }),
      statCard({
        label: t('server.storage'),
        value: stats.storage ? fmt.percent(stats.storage.usedPercent, 1) : t('common.unavailable'),
        hint: stats.storage ? `${fmt.bytes(stats.storage.free)} free / ${fmt.bytes(stats.storage.total)}` : null,
        iconName: 'database',
        meter: stats.storage ? { percent: stats.storage.usedPercent } : null,
      }),
      statCard({
        label: t('server.battery'),
        value: stats.battery ? `${stats.battery.percentage}%` : t('common.unavailable'),
        hint: stats.battery ? `${stats.battery.status ?? ''} ${stats.battery.plugged ?? ''}`.trim() : null,
        iconName: 'battery',
        meter: stats.battery && Number.isFinite(stats.battery.percentage)
          ? { percent: stats.battery.percentage } : null,
      }),
      statCard({
        label: t('server.temperature'),
        value: stats.temperature ? `${stats.temperature.celsius}°C` : t('common.unavailable'),
        hint: stats.temperature?.zone ?? null,
        iconName: 'thermometer',
      }),
      statCard({
        label: t('server.network'),
        value: stats.network
          ? el('span', { style: { fontSize: '1rem' }, text: `↓${fmt.bytes(stats.network.rxBytes)} ↑${fmt.bytes(stats.network.txBytes)}` })
          : t('common.unavailable'),
        iconName: 'globe',
      }),
    ),
    notes.length
      ? el('.stack', { style: { marginTop: '12px' } },
        ...notes.map((note) => alert('info', null, note)))
      : null,
  );
}

function infoRow(label, value) {
  return el('.row',
    el('span', { class: 'muted small', text: label }),
    el('.spacer'),
    el('span', { class: 'small mono ltr', text: String(value ?? '—') }),
  );
}

function storageRow(label, value, total) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return el('div',
    el('.row',
      el('span', { class: 'small', text: label }),
      el('.spacer'),
      el('span', { class: 'small tabular muted', text: fmt.bytes(value) }),
    ),
    el('.meter', { style: { marginTop: '5px' } },
      el('.meter__fill', { style: { width: `${Math.min(100, pct)}%` } })),
  );
}

export { badge };
