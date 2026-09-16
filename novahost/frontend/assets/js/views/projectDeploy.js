import { el, render } from '../dom.js';
import { icon } from '../icons.js';
import { t, translateError } from '../i18n.js';
import { api } from '../api.js';
import { toasts } from '../toast.js';
import { openModal, confirmDialog } from '../modal.js';
import * as fmt from '../format.js';
import {
  card, table, statusBadge, badge, emptyState, loadingBlock, errorBlock,
  progressBar, pipelineSteps, alert, iconButton,
} from '../components.js';
import { logLine } from './project.js';

/**
 * Deployments tab: the upload zone and the version history.
 *
 * The upload shows real pipeline stages. Upload progress is genuine (XHR
 * reports it); the extract and publish stages are shown as in-progress while
 * the single request completes, because the server does that work atomically
 * and does not stream progress back. The labels say what is happening rather
 * than inventing a percentage for it.
 */

const STEP_KEYS = ['deploy.uploading', 'deploy.extracting', 'deploy.publishing', 'deploy.published'];

export async function renderDeploymentsTab(container, { project, reload }) {
  render(container, loadingBlock());

  let data;
  try {
    data = await api.deployments(project.id, { limit: 100 });
  } catch (error) {
    render(container, errorBlock(error, () => renderDeploymentsTab(container, { project, reload })));
    return;
  }

  const uploadSlot = el('div');
  render(uploadSlot, uploadZone({ project, reload }));

  render(container,
    el('.stack',
      card({ title: t('deploy.title'), body: uploadSlot }),
      card({
        title: t('projects.deployments'),
        flush: true,
        body: data.items.length
          ? table({
            columns: [
              {
                label: '#',
                render: (row) => el('div',
                  el('.cell-primary', { text: `#${row.number}` }),
                  el('.cell-muted.mono.ltr', { text: fmt.shortId(row.id, 18) }),
                ),
              },
              {
                label: t('common.status'),
                render: (row) => el('.row.row--tight',
                  statusBadge(row.status),
                  row.isCurrent ? badge(t('deploy.current'), 'accent', { iconName: 'check' }) : null,
                ),
              },
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
                  iconButton('list', {
                    label: t('deploy.viewLogs'),
                    onClick: () => openDeploymentDialog(row),
                  }),
                  row.status === 'READY' && !row.isCurrent
                    ? iconButton('rotate', {
                      label: t('deploy.rollback'),
                      onClick: () => doRollback(project, row, reload),
                    })
                    : null,
                ),
              },
            ],
            rows: data.items,
          })
          : emptyState({ iconName: 'rocket', title: t('deploy.empty') }),
      }),
    ),
  );
}

function uploadZone({ project, reload }) {
  const input = el('input', { type: 'file', accept: '.zip,application/zip', class: 'hidden' });
  const message = el('input.input', {
    type: 'text', placeholder: t('deploy.message'), maxlength: '200',
    style: { marginTop: '12px' },
  });
  const statusSlot = el('div');

  const zone = el('.dropzone', {
    tabindex: '0',
    role: 'button',
    'aria-label': t('deploy.drop'),
    onClick: () => input.click(),
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        input.click();
      }
    },
  },
  el('.dropzone__icon', icon('upload', { size: 28 })),
  el('.dropzone__title', { text: t('deploy.drop') }),
  el('.dropzone__hint', { text: t('deploy.or') }),
  el('.dropzone__hint', { style: { marginTop: '6px' }, text: t('deploy.hint') }),
  );

  for (const type of ['dragenter', 'dragover']) {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.remove('is-over');
    });
  }
  zone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) startUpload(file);
  });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) startUpload(file);
  });

  async function startUpload(file) {
    if (!/\.zip$/i.test(file.name) && file.type !== 'application/zip') {
      toasts.error(t('deploy.notZip'), file.name);
      return;
    }

    zone.classList.add('hidden');
    let step = 0;
    const draw = (extra = null, failed = -1) => render(statusSlot,
      el('.stack',
        pipelineSteps(STEP_KEYS.map((key) => t(key)), step, failed),
        extra,
      ),
    );
    draw(progressBar({ label: `${file.name} · ${fmt.bytes(file.size)}`, value: 0 }));

    try {
      const result = await api.deploy(project.id, file, {
        message: message.value.trim(),
        onProgress: (ratio) => {
          if (ratio < 1) {
            draw(progressBar({ label: `${t('deploy.uploading')} · ${fmt.bytes(file.size)}`, value: ratio }));
          } else {
            // The bytes are on the device; the server is now validating.
            step = 1;
            draw(el('.row', el('.spinner'), el('span', { class: 'small muted', text: t('deploy.extracting') })));
          }
        },
      });

      step = 3;
      draw(alert('success', t('deploy.published'),
        `#${result.deployment.number} · ${fmt.number(result.deployment.fileCount)} ${t('common.files')} · ${fmt.bytes(result.deployment.totalBytes)}`));
      toasts.success(t('deploy.published'), `#${result.deployment.number}`);
      setTimeout(reload, 900);
    } catch (error) {
      draw(alert('danger', t('deploy.failed'), translateError(error)), step);
      toasts.error(translateError(error), t('deploy.failed'));
      const retry = el('button.btn.btn--sm', {
        type: 'button',
        onClick: () => {
          statusSlot.replaceChildren();
          zone.classList.remove('hidden');
        },
      }, t('common.retry'));
      statusSlot.append(el('div', { style: { marginTop: '10px' } }, retry));
    }
  }

  return el('div', zone, input, message, statusSlot);
}

async function doRollback(project, deployment, reload) {
  const ok = await confirmDialog({
    title: `${t('deploy.rollback')} #${deployment.number}`,
    message: t('deploy.rollback.confirm'),
    confirmLabel: t('deploy.rollback'),
  });
  if (!ok) return;

  try {
    await api.rollback(project.id, deployment.id);
    toasts.success(t('deploy.rollback.done'), `#${deployment.number}`);
    reload();
  } catch (error) {
    toasts.error(translateError(error));
  }
}

export function openDeploymentDialog(deployment) {
  const logSlot = el('div', loadingBlock());

  const modal = openModal({
    wide: true,
    title: `${t('deploy.deployment')} #${deployment.number}`,
    body: el('.stack',
      el('.grid.grid--stats',
        el('.stat',
          el('.stat__label', { text: t('common.status') }),
          el('div', { style: { marginTop: '6px' } }, statusBadge(deployment.status))),
        el('.stat',
          el('.stat__label', { text: t('common.files') }),
          el('.stat__value', { style: { fontSize: '1.1rem' }, text: fmt.number(deployment.fileCount) })),
        el('.stat',
          el('.stat__label', { text: t('common.size') }),
          el('.stat__value', { style: { fontSize: '1.1rem' }, text: fmt.bytes(deployment.totalBytes) })),
        el('.stat',
          el('.stat__label', { text: t('deploy.duration') }),
          el('.stat__value', { style: { fontSize: '1.1rem' }, text: fmt.duration(deployment.durationMs) })),
      ),
      deployment.errorMessage
        ? alert('danger', deployment.errorCode ?? t('deploy.failed'), deployment.errorMessage)
        : null,
      el('div',
        el('h3', { style: { marginBottom: '8px', fontSize: '0.9rem' }, text: t('deploy.viewLogs') }),
        logSlot,
      ),
    ),
    footer: [el('button.btn', { type: 'button', onClick: () => modal.close() }, t('common.close'))],
  });

  api.deploymentLogs(deployment.id)
    .then((data) => {
      render(logSlot, data.items.length
        ? el('.logview', ...data.items.map(logLine))
        : emptyState({ iconName: 'terminal', title: t('logs.empty') }));
    })
    .catch((error) => render(logSlot, errorBlock(error)));

  return modal;
}
