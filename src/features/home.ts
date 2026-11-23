// The projects screen: what the app opens on.

import { ASPECTS } from '../doc/model';
import { el } from '../editor';
import type { Store } from '../store/store';
import { ask } from '../ui/dialog';
import { busy, errorText, safeName, saveFile, toast } from '../ui/feedback';
import { icon } from '../ui/icons';
import { closePopover, openPopover } from '../ui/popover';
import { formatTime } from '../ui/timeline';
import {
  createProject,
  deleteProject,
  duplicateProject,
  exportProjectFile,
  importProjectFile,
  listProjects,
  renameProject,
  type Summary,
} from './projects';

export interface Home {
  show(): Promise<void>;
  hide(): void;
}

export function installHome(store: Store, openProject: (id: string) => Promise<void>, showHelp: () => void): Home {
  const home = el<HTMLElement>('home');
  const grid = el<HTMLDivElement>('home-grid');
  const warning = el<HTMLDivElement>('home-warning');
  const storage = el<HTMLElement>('home-storage');
  const tileMenu = el<HTMLDivElement>('tile-menu');
  const fileProject = el<HTMLInputElement>('file-project');
  let menuFor: Summary | null = null;
  let urls: string[] = [];

  async function refresh(): Promise<void> {
    const projects = await listProjects(store);
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
    grid.replaceChildren();

    const create = document.createElement('button');
    create.className = 'tile create';
    create.id = 'home-create';
    create.innerHTML = `<div class="thumb">${icon('plus')}</div><div class="meta"><div class="name">Create New</div><div class="detail">Start a new video</div></div>`;
    create.addEventListener('click', openNewDialog);
    grid.append(create);

    for (const project of projects) {
      const tile = document.createElement('div');
      tile.className = `tile${project.damaged ? ' damaged' : ''}`;
      tile.setAttribute('role', 'button');
      tile.tabIndex = 0;
      tile.dataset.id = project.id;
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (project.thumb) {
        const url = URL.createObjectURL(project.thumb);
        urls.push(url);
        thumb.style.backgroundImage = `url("${url}")`;
      }
      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = project.name;
      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.textContent = project.damaged
        ? 'Cannot be read'
        : `${formatTime(project.duration)} · ${new Date(project.modified).toLocaleDateString()}`;
      meta.append(name, detail);
      const more = document.createElement('button');
      more.className = 'icon tile-more';
      more.innerHTML = icon('more');
      more.setAttribute('aria-label', `Options for ${project.name}`);
      more.setAttribute('aria-haspopup', 'true');
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        menuFor = project;
        el('tile-rename').hidden = el('tile-duplicate').hidden = el('tile-backup').hidden = project.damaged;
        openPopover(tileMenu, more);
        const r = more.getBoundingClientRect();
        const m = tileMenu.getBoundingClientRect();
        tileMenu.style.left = `${Math.max(8, Math.min(r.right - m.width, window.innerWidth - m.width - 8))}px`;
        tileMenu.style.top = `${Math.max(8, Math.min(r.top - m.height - 6, window.innerHeight - m.height - 8))}px`;
      });
      tile.append(thumb, meta, more);
      tile.addEventListener('click', () => {
        if (project.damaged) {
          toast('This project cannot be read. It has been left untouched.');
          return;
        }
        void openProject(project.id).catch((err: unknown) => toast(errorText(err, 'The project could not be opened')));
      });
      grid.append(tile);
    }

    warning.hidden = store.persistent;
    if (!store.persistent) {
      warning.textContent =
        'This browser is not letting Reel save files here (private browsing, or a page not served over HTTPS). Projects will be lost when the page closes.';
    }
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.quota) {
        const gb = (n: number): string => (n / 2 ** 30).toFixed(n > 2 ** 30 ? 1 : 2);
        storage.textContent = `Using ${gb(estimate.usage ?? 0)} GB of about ${gb(estimate.quota)} GB available to this app. Everything stays on this device.`;
      }
    } catch {
      storage.textContent = '';
    }
  }

  // --- new project ----------------------------------------------------------------------

  const newDialog = el<HTMLDivElement>('new-project');
  const newName = el<HTMLInputElement>('new-name');
  const newPhoto = el<HTMLInputElement>('new-photo');
  const newPhotoValue = el<HTMLOutputElement>('new-photo-value');
  const aspects = el<HTMLDivElement>('new-aspects');
  let aspect = ASPECTS[0]!;

  for (const a of ASPECTS) {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', a.label);
    const k = 26 / Math.max(a.width, a.height);
    b.innerHTML = `<i style="width:${Math.round(a.width * k)}px;height:${Math.round(a.height * k)}px"></i>${a.label}`;
    b.addEventListener('click', () => {
      aspect = a;
      syncAspects();
    });
    aspects.append(b);
  }
  function syncAspects(): void {
    [...aspects.children].forEach((b, i) => b.setAttribute('aria-checked', String(ASPECTS[i] === aspect)));
  }
  newPhoto.addEventListener('input', () => (newPhotoValue.value = `${Number(newPhoto.value).toFixed(1)} s`));

  function openNewDialog(): void {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    newName.value = `Project ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    newPhoto.value = '4.5';
    newPhotoValue.value = '4.5 s';
    aspect = ASPECTS[0]!;
    syncAspects();
    newDialog.hidden = false;
    newName.select();
  }
  el('new-cancel').addEventListener('click', () => (newDialog.hidden = true));
  el('new-create').addEventListener('click', () => {
    newDialog.hidden = true;
    void createProject(store, newName.value.trim().slice(0, 60) || 'Project', aspect.width, aspect.height, Number(newPhoto.value))
      .then(openProject)
      .catch((err: unknown) => toast(errorText(err, 'The project could not be created')));
  });

  // --- per-project menu -------------------------------------------------------------------

  el('tile-rename').addEventListener('click', () => {
    const project = menuFor;
    closePopover();
    if (!project) return;
    void ask({ title: 'Rename project', value: project.name, ok: 'Rename' }).then(async (name) => {
      if (!name) return;
      await renameProject(store, project.id, name.slice(0, 60));
      await refresh();
    });
  });
  el('tile-duplicate').addEventListener('click', () => {
    const project = menuFor;
    closePopover();
    if (!project) return;
    void busy('Duplicating', (progress) => duplicateProject(store, project.id, progress))
      .then(refresh)
      .catch((err: unknown) => toast(errorText(err, 'The project could not be duplicated')));
  });
  el('tile-backup').addEventListener('click', () => {
    const project = menuFor;
    closePopover();
    if (!project) return;
    void saveProjectFile(store, project.id);
  });
  el('tile-delete').addEventListener('click', () => {
    const project = menuFor;
    closePopover();
    if (!project) return;
    void ask({ title: `Delete "${project.name}"? This cannot be undone.`, ok: 'Delete', danger: true }).then(async (answer) => {
      if (answer === null) return;
      await deleteProject(store, project.id);
      await refresh();
    });
  });

  el('home-open-file').addEventListener('click', () => fileProject.click());
  fileProject.addEventListener('change', () => {
    const file = fileProject.files?.[0];
    fileProject.value = '';
    if (!file) return;
    void busy('Opening project file', (progress) => importProjectFile(store, file, progress))
      .then(refresh)
      .then(() => toast('Project added'))
      .catch((err: unknown) => toast(errorText(err, 'The project file could not be opened')));
  });
  el('home-help').addEventListener('click', showHelp);

  return {
    async show() {
      home.hidden = false;
      await refresh();
    },
    hide() {
      home.hidden = true;
      closePopover();
    },
  };
}

export async function saveProjectFile(store: Store, id: string): Promise<void> {
  try {
    const { blob, name } = await busy('Saving project file', (progress) => exportProjectFile(store, id, progress));
    await saveFile(blob, `${safeName(name, 'project')}.reel`);
  } catch (err) {
    toast(errorText(err, 'The project file could not be saved'));
  }
}
