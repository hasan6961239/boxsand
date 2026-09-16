import { el, render, debounce, copyToClipboard } from '../dom.js';
import { icon } from '../icons.js';
import { t, translateError } from '../i18n.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { toasts } from '../toast.js';
import { openModal, confirmDialog } from '../modal.js';
import * as fmt from '../format.js';
import {
  card, table, badge, emptyState, loadingBlock, errorBlock, field, alert, iconButton, qrCanvas,
} from '../components.js';

/** The project list, plus the create dialog that every "New project" opens. */

export async function renderProjects(container, { query = {} } = {}) {
  render(container, loadingBlock());

  let data;
  const search = query.search ?? '';
  try {
    data = await api.projects({ search, limit: 200 });
  } catch (error) {
    render(container, errorBlock(error, () => renderProjects(container, { query })));
    return;
  }

  const searchInput = el('input.input', {
    type: 'search',
    placeholder: t('common.search'),
    value: search,
    style: { maxWidth: '260px' },
    onInput: debounce((event) => {
      const value = event.target.value.trim();
      navigate(value ? `/projects?search=${encodeURIComponent(value)}` : '/projects', { replace: true });
    }, 300),
  });

  render(container,
    el('.page-header',
      el('.page-header__text',
        el('h1', { text: t('projects.title') }),
        el('.page-header__sub', { text: `${fmt.number(data.total)} · ${t('projects.sub')}` }),
      ),
      el('.page-header__actions',
        searchInput,
        el('button.btn.btn--primary', { type: 'button', onClick: () => openNewProjectDialog() },
          icon('plus', { size: 16 }), t('projects.new')),
      ),
    ),

    card({
      flush: true,
      body: data.items.length
        ? table({
          columns: [
            {
              label: t('common.name'),
              render: (project) => el('div',
                el('.cell-primary', { text: project.name }),
                el('.cell-muted.ltr', { text: `/${project.slug}` }),
              ),
            },
            {
              label: t('common.status'),
              render: (project) => {
                if (!project.enabled) return badge(t('projects.paused'), 'warning', { iconName: 'pause' });
                if (project.status === 'ready') return badge(t('overview.published'), 'success');
                if (project.status === 'failed') return badge(t('deploy.failed'), 'danger');
                return badge(t('deploy.empty'), '');
              },
            },
            {
              label: t('common.size'),
              render: (project) => el('span.tabular.cell-muted', {
                text: `${fmt.bytes(project.storageBytes)} · ${fmt.number(project.fileCount)}`,
              }),
            },
            {
              label: t('projects.lastDeploy'),
              render: (project) => el('span.cell-muted', { text: fmt.relativeTime(project.lastDeployedAt) }),
            },
            {
              label: t('common.actions'),
              render: (project) => el('.table__actions',
                project.currentDeploymentId
                  ? iconButton('external', {
                    label: t('projects.openSite'),
                    href: primaryUrl(project),
                  })
                  : null,
                iconButton('qr', {
                  label: t('projects.qr'),
                  onClick: () => openQrDialog(project),
                }),
                iconButton('upload', {
                  label: t('deploy.title'),
                  onClick: () => navigate(`/projects/${project.slug}/deployments`),
                }),
              ),
            },
          ],
          rows: data.items,
          onRowClick: (project) => navigate(`/projects/${project.slug}`),
        })
        : emptyState({
          iconName: 'layers',
          title: search ? t('common.none') : t('projects.empty.title'),
          text: search ? null : t('projects.empty.text'),
          action: search ? null : el('button.btn.btn--primary', {
            type: 'button', onClick: () => openNewProjectDialog(),
          }, icon('plus', { size: 16 }), t('projects.empty.action')),
        }),
    }),
  );
}

export function primaryUrl(project) {
  const urls = project.urls ?? [];
  const primary = urls.find((entry) => entry.primary) ?? urls[0];
  if (!primary) return '#';
  // Path-mode URLs are generated server-side against localhost; rewrite them to
  // whatever host the dashboard is actually open on, so the link works when the
  // dashboard is reached at 192.168.x.x or through a tunnel.
  if (primary.kind === 'path') {
    try {
      const url = new URL(primary.url);
      url.hostname = window.location.hostname;
      url.protocol = window.location.protocol;
      return url.href;
    } catch {
      return primary.url;
    }
  }
  return primary.url;
}

export function openQrDialog(project) {
  const url = primaryUrl(project);
  let canvas;
  try {
    canvas = qrCanvas(url, 220);
  } catch (error) {
    canvas = alert('warning', null, error.message);
  }

  openModal({
    title: project.name,
    body: el('.qr',
      canvas,
      el('.qr__url', { text: url }),
      el('button.btn.btn--sm', {
        type: 'button',
        onClick: async () => {
          if (await copyToClipboard(url)) toasts.success(t('common.copied'));
        },
      }, icon('copy', { size: 15 }), t('common.copy')),
      el('p', { class: 'small subtle', text: t('projects.shareHint') }),
    ),
  });
}

/**
 * New project dialog.
 *
 * The slug preview updates as you type, because the slug becomes the hostname
 * and an Arabic name transliterates into something the user should see and be
 * able to correct before the project exists.
 */
export function openNewProjectDialog(onCreated = null) {
  const errorSlot = el('div');
  const name = el('input.input', { type: 'text', required: true, autofocus: true, maxlength: '100' });
  const slug = el('input.input', { type: 'text', dir: 'ltr', maxlength: '63', placeholder: 'my-site' });
  const description = el('textarea.textarea', { maxlength: '500', rows: '2' });
  const visibility = el('select.select',
    el('option', { value: 'public' }, t('projects.visibility.public')),
    el('option', { value: 'private' }, t('projects.visibility.private')),
  );

  let slugEdited = false;
  slug.addEventListener('input', () => { slugEdited = true; });

  const refreshSlug = debounce(async () => {
    if (slugEdited || !name.value.trim()) return;
    try {
      const preview = await api.slugPreview(name.value.trim());
      if (!slugEdited) slug.value = preview.slug ?? '';
    } catch { /* the preview is a convenience; the server validates on create */ }
  }, 320);
  name.addEventListener('input', refreshSlug);

  const submit = el('button.btn.btn--primary', { type: 'submit', form: 'new-project-form' }, t('projects.create'));

  const form = el('form#new-project-form', {
    onSubmit: async (event) => {
      event.preventDefault();
      errorSlot.replaceChildren();
      submit.disabled = true;
      render(submit, el('.spinner'), t('common.loading'));

      try {
        const { project } = await api.createProject({
          name: name.value.trim(),
          slug: slug.value.trim() || undefined,
          description: description.value.trim(),
          visibility: visibility.value,
        });
        toasts.success(t('projects.created'), project.name);
        modal.close(project);
        if (onCreated) onCreated(project);
        else navigate(`/projects/${project.slug}`);
      } catch (error) {
        render(errorSlot, alert('danger', null, translateError(error)));
        if (error.details?.some?.((d) => d.field === 'slug')) slug.focus();
      } finally {
        submit.disabled = false;
        render(submit, t('projects.create'));
      }
    },
  },
  errorSlot,
  field({ label: t('common.name'), input: name }),
  field({ label: t('projects.slug'), input: slug, hint: t('projects.slug.hint') }),
  field({ label: `${t('projects.description')} (${t('common.optional')})`, input: description }),
  field({ label: t('projects.visibility'), input: visibility, hint: t('projects.visibility.hint') }),
  );

  const modal = openModal({
    title: t('projects.new'),
    body: form,
    footer: [
      el('button.btn', { type: 'button', onClick: () => modal.close(null) }, t('common.cancel')),
      submit,
    ],
  });

  return modal;
}

export async function confirmDeleteProject(project) {
  const confirmed = await confirmDialog({
    title: t('projects.delete.title'),
    message: t('projects.delete.warn'),
    confirmLabel: t('common.delete'),
    danger: true,
    requireText: project.slug,
    extra: el('p', { class: 'small muted', text: t('projects.delete.confirm', { slug: project.slug }) }),
  });
  if (!confirmed) return false;

  try {
    await api.deleteProject(project.id, project.slug);
    toasts.success(t('projects.deleted'), project.name);
    return true;
  } catch (error) {
    toasts.error(translateError(error));
    return false;
  }
}
