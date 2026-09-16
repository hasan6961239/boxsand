import { el, render } from '../dom.js';
import { icon } from '../icons.js';
import { t, translateError } from '../i18n.js';
import { api } from '../api.js';
import { toasts } from '../toast.js';
import { confirmDialog, promptDialog } from '../modal.js';
import { createEditor } from '../editor.js';
import * as fmt from '../format.js';
import {
  card, emptyState, loadingBlock, errorBlock, alert, badge, iconButton,
} from '../components.js';

/**
 * File manager.
 *
 * Everything here edits a working copy, not the published deployment. That is
 * what makes "edit, save, publish, roll back" coherent: a deployment stays
 * exactly the bytes that were published, and Publish turns the current working
 * copy into the next one.
 */

export async function renderFilesTab(container, { project, reload }) {
  const state = {
    path: '',
    selected: null,
    dirty: false,
    editor: null,
    editorPath: null,
    editorDirty: false,
  };

  const listSlot = el('div');
  const editorSlot = el('div');
  const statusSlot = el('div');

  async function refreshStatus() {
    render(statusSlot,
      el('.row',
        state.dirty
          ? badge(t('files.dirty'), 'warning', { iconName: 'edit' })
          : badge(t('files.clean'), '', { iconName: 'check' }),
        el('.spacer'),
        state.dirty
          ? el('button.btn.btn--sm', { type: 'button', onClick: discardChanges }, t('files.discard'))
          : null,
        el('button.btn.btn--sm.btn--primary', {
          type: 'button', disabled: !state.dirty, onClick: publishChanges,
        }, icon('rocket', { size: 14 }), t('files.publish')),
      ),
    );
  }

  async function publishChanges() {
    try {
      const result = await api.publishWorkspace(project.id, 'Published from the file editor');
      toasts.success(t('files.published'), `#${result.deployment.number}`);
      reload();
    } catch (error) {
      toasts.error(translateError(error));
    }
  }

  async function discardChanges() {
    const ok = await confirmDialog({
      title: t('files.discard'),
      message: t('files.workspaceHint'),
      danger: true,
      confirmLabel: t('files.discard'),
    });
    if (!ok) return;
    try {
      await api.discardChanges(project.id);
      toasts.success(t('files.discarded'));
      state.selected = null;
      render(editorSlot, emptyState({ iconName: 'file', title: t('files.selectFile') }));
      await loadDirectory(state.path);
    } catch (error) {
      toasts.error(translateError(error));
    }
  }

  async function loadDirectory(path) {
    render(listSlot, loadingBlock());
    let data;
    try {
      data = await api.files(project.id, path);
    } catch (error) {
      render(listSlot, errorBlock(error, () => loadDirectory(path)));
      return;
    }

    state.path = data.path;
    state.dirty = Boolean(data.workspace?.dirty);
    refreshStatus();

    const crumbs = buildBreadcrumbs(data.path, loadDirectory);

    render(listSlot,
      el('.row', { style: { padding: '10px 12px', borderBottom: '1px solid var(--border)', gap: '6px' } },
        crumbs,
        el('.spacer'),
        iconButton('folderPlus', { label: t('files.newFolder'), onClick: () => createFolder() }),
        iconButton('filePlus', { label: t('files.newFile'), onClick: () => createFile() }),
        iconButton('upload', { label: t('files.uploadFile'), onClick: () => uploadFile() }),
      ),
      data.items.length
        ? el('ul.filelist', ...data.items.map((item) => fileRow(item)))
        : emptyState({ iconName: 'folder', title: t('files.empty') }),
    );
  }

  function fileRow(item) {
    const isSelected = state.selected === item.path;
    return el(`li.filelist__item${isSelected ? '.is-selected' : ''}`, {
      tabindex: '0',
      onClick: () => (item.type === 'dir' ? loadDirectory(item.path) : openFile(item)),
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          if (item.type === 'dir') loadDirectory(item.path);
          else openFile(item);
        }
      },
    },
    el('.filelist__icon', icon(item.type === 'dir' ? 'folder' : 'file', { size: 15 })),
    el('.filelist__name', { text: item.name }),
    item.type === 'file' ? el('.filelist__size', { text: fmt.bytes(item.size) }) : null,
    el('.filelist__menu.row.row--tight',
      iconButton('edit', {
        label: t('common.rename'),
        onClick: (event) => { event.stopPropagation(); renameItem(item); },
      }),
      iconButton('trash', {
        label: t('common.delete'),
        onClick: (event) => { event.stopPropagation(); deleteItem(item); },
      }),
    ),
    );
  }

  async function openFile(item) {
    state.selected = item.path;

    if (item.previewable) {
      render(editorSlot, card({
        title: item.name,
        actions: el('a.btn.btn--sm', {
          href: api.fileRawUrl(project.id, item.path, true), download: item.name,
        }, icon('download', { size: 14 })),
        body: el('div', { style: { textAlign: 'center' } },
          el('img', {
            src: api.fileRawUrl(project.id, item.path),
            alt: item.name,
            style: { maxWidth: '100%', maxHeight: '52vh', borderRadius: '8px' },
          }),
          el('p', { class: 'small subtle', style: { marginTop: '8px' }, text: fmt.bytes(item.size) }),
        ),
      }));
      await loadDirectory(state.path);
      return;
    }

    if (!item.editable) {
      render(editorSlot, card({
        title: item.name,
        body: el('.stack',
          alert('info', null, t('files.notEditable')),
          el('a.btn', {
            href: api.fileRawUrl(project.id, item.path, true), download: item.name,
          }, icon('download', { size: 15 }), t('common.download')),
        ),
      }));
      await loadDirectory(state.path);
      return;
    }

    render(editorSlot, loadingBlock());
    let file;
    try {
      file = await api.fileContent(project.id, item.path);
    } catch (error) {
      render(editorSlot, errorBlock(error));
      return;
    }

    const saveButton = el('button.btn.btn--sm.btn--primary', { type: 'button' },
      icon('save', { size: 14 }), t('common.save'));

    const editor = createEditor({
      value: file.content,
      language: file.language,
      onChange: () => {
        state.editorDirty = true;
        saveButton.disabled = false;
      },
      onSave: () => saveButton.click(),
    });

    saveButton.disabled = true;
    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      try {
        await api.saveFile(project.id, item.path, editor.value);
        state.editorDirty = false;
        state.dirty = true;
        refreshStatus();
        toasts.success(t('files.saved'), item.name);
      } catch (error) {
        toasts.error(translateError(error));
        saveButton.disabled = false;
      }
    });

    state.editor = editor;
    state.editorPath = item.path;

    render(editorSlot,
      el('.card',
        el('.editor-bar',
          icon('file', { size: 15 }),
          el('.editor-bar__path', { text: item.path }),
          el('.spacer'),
          el('span', { class: 'kbd', text: 'Ctrl+S' }),
          saveButton,
        ),
        editor.node,
      ),
    );
    editor.focus();
    await loadDirectory(state.path);
  }

  async function createFolder() {
    const name = await promptDialog({ title: t('files.newFolder'), label: t('files.folderName') });
    if (!name) return;
    try {
      await api.createFolder(project.id, joinPath(state.path, name));
      await loadDirectory(state.path);
    } catch (error) {
      toasts.error(translateError(error));
    }
  }

  async function createFile() {
    const name = await promptDialog({
      title: t('files.newFile'), label: t('files.name'), placeholder: 'page.html',
    });
    if (!name) return;
    try {
      await api.saveFile(project.id, joinPath(state.path, name), '');
      state.dirty = true;
      await loadDirectory(state.path);
    } catch (error) {
      toasts.error(translateError(error));
    }
  }

  function uploadFile() {
    const picker = el('input', { type: 'file', multiple: true, class: 'hidden' });
    document.body.append(picker);
    picker.addEventListener('change', async () => {
      const files = [...(picker.files ?? [])];
      picker.remove();
      for (const file of files) {
        try {
          await api.uploadFile(project.id, joinPath(state.path, file.name), file);
          toasts.success(t('files.saved'), file.name);
        } catch (error) {
          toasts.error(translateError(error), file.name);
        }
      }
      state.dirty = true;
      await loadDirectory(state.path);
    }, { once: true });
    picker.click();
  }

  async function renameItem(item) {
    const name = await promptDialog({
      title: t('common.rename'), label: t('files.name'), value: item.name,
    });
    if (!name || name === item.name) return;
    const parent = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
    try {
      await api.renameFile(project.id, item.path, joinPath(parent, name));
      state.dirty = true;
      await loadDirectory(state.path);
    } catch (error) {
      toasts.error(translateError(error));
    }
  }

  async function deleteItem(item) {
    const ok = await confirmDialog({
      title: t('common.delete'),
      message: t('files.confirmDelete', { name: item.name }),
      danger: true,
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await api.deleteFile(project.id, item.path);
      state.dirty = true;
      if (state.selected === item.path) {
        state.selected = null;
        render(editorSlot, emptyState({ iconName: 'file', title: t('files.selectFile') }));
      }
      toasts.success(t('files.deleted'), item.name);
      await loadDirectory(state.path);
    } catch (error) {
      toasts.error(translateError(error));
    }
  }

  render(container,
    el('.stack',
      alert('info', null, t('files.workspaceHint')),
      el('div', { style: { padding: '2px 0' } }, statusSlot),
      el('.filemanager',
        el('.card', listSlot),
        el('div', editorSlot),
      ),
    ),
  );

  render(editorSlot, emptyState({ iconName: 'file', title: t('files.selectFile') }));
  await loadDirectory('');
}

function joinPath(base, name) {
  const clean = String(name).trim().replace(/^\/+|\/+$/g, '');
  return base ? `${base}/${clean}` : clean;
}

function buildBreadcrumbs(path, onNavigate) {
  const parts = path ? path.split('/').filter(Boolean) : [];
  const nodes = [el('button', { type: 'button', onClick: () => onNavigate('') }, icon('home', { size: 14 }))];
  let accumulated = '';
  for (const part of parts) {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    const target = accumulated;
    nodes.push(el('span.breadcrumbs__sep', '/'));
    nodes.push(el('button', { type: 'button', onClick: () => onNavigate(target) }, part));
  }
  return el('.breadcrumbs', ...nodes);
}
