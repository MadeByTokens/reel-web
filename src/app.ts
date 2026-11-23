// Start-up and the wiring between the screens.

import { splitClip, deleteClip } from './doc/ops';
import { Editor, el } from './editor';
import { installExport } from './features/exportDialog';
import { installHome, saveProjectFile } from './features/home';
import { installRecord } from './features/record';
import { openStore } from './store/store';
import { errorText, isBusy, toast } from './ui/feedback';
import { icon } from './ui/icons';
import { installPanel } from './ui/panel';
import { closePopover, togglePopover } from './ui/popover';
import { installStage } from './ui/stage';
import { formatTime, installTimeline } from './ui/timeline';
import { installTooltips } from './ui/tooltips';

declare global {
  interface Window {
    __reel?: unknown;
  }
}

export async function startApp(): Promise<void> {
  const store = await openStore();
  // Ask the browser not to clear this site's files when space runs low.
  void navigator.storage?.persist?.().catch(() => false);
  // An export that was interrupted leaves its unfinished file behind.
  void store.remove('exports');

  const ed = new Editor(store, el<HTMLCanvasElement>('preview'));
  ed.toast = toast;
  const editorNode = el<HTMLDivElement>('editor');

  for (const [id, glyph] of [
    ['back', 'back'],
    ['undo', 'undo'],
    ['redo', 'redo'],
    ['clip-delete', 'trash'],
    ['clip-duplicate', 'duplicate'],
    ['menu-button', 'more'],
    ['jump-start', 'start'],
    ['jump-end', 'end'],
  ] as const) {
    el(id).innerHTML = icon(glyph);
  }

  // --- help ---------------------------------------------------------------------------
  const help = el<HTMLDivElement>('help');
  const showHelp = (): void => {
    help.hidden = false;
    help.focus();
  };
  el('help-close').addEventListener('click', () => (help.hidden = true));

  // --- text entry ---------------------------------------------------------------------
  const textDialog = el<HTMLDivElement>('text-edit');
  const textInput = el<HTMLTextAreaElement>('text-input');
  let textDone: ((value: string | null) => void) | null = null;
  const askText = (initial: string): Promise<string | null> =>
    new Promise((resolve) => {
      textDone?.(null);
      textDone = resolve;
      textInput.value = initial;
      textDialog.hidden = false;
      textInput.focus();
      textInput.select();
    });
  const closeText = (value: string | null): void => {
    textDialog.hidden = true;
    textDone?.(value);
    textDone = null;
  };
  el('text-ok').addEventListener('click', () => closeText(textInput.value.trim() || null));
  el('text-cancel').addEventListener('click', () => closeText(null));

  // --- screens ------------------------------------------------------------------------
  let switching = false;
  async function openProject(id: string): Promise<void> {
    if (switching) return;
    switching = true;
    try {
      await ed.open(id);
      home.hide();
      editorNode.hidden = false;
      // Layout needs the editor on screen before sizes mean anything.
      window.dispatchEvent(new Event('resize'));
      ed.live();
    } finally {
      switching = false;
    }
  }
  async function closeProject(): Promise<void> {
    if (switching || !ed.isOpen) return;
    switching = true;
    try {
      closePopover();
      await ed.close();
      editorNode.hidden = true;
      await home.show();
    } finally {
      switching = false;
    }
  }
  const home = installHome(store, openProject, showHelp);

  const exporter = installExport(ed);
  const recorder = installRecord(ed);
  const timeline = installTimeline(ed);
  installStage(ed);
  installPanel(ed, { openExport: exporter.open, openRecord: recorder.open, askText });
  installTooltips();

  // --- action rail --------------------------------------------------------------------
  el('back').addEventListener('click', () => void closeProject());
  const undo = el<HTMLButtonElement>('undo');
  const redo = el<HTMLButtonElement>('redo');
  undo.addEventListener('click', () => ed.undo());
  redo.addEventListener('click', () => ed.redo());
  ed.onChange(() => {
    undo.disabled = !ed.canUndo;
    redo.disabled = !ed.canRedo;
  });

  const menu = el<HTMLDivElement>('menu');
  const menuButton = el<HTMLButtonElement>('menu-button');
  menuButton.addEventListener('click', () => togglePopover(menu, menuButton));
  el('menu-help').addEventListener('click', () => {
    closePopover();
    showHelp();
  });
  el('menu-backup').addEventListener('click', () => {
    closePopover();
    void ed.settled().then(() => saveProjectFile(store, ed.projectId));
  });

  // --- project settings -----------------------------------------------------------------
  const settings = el<HTMLDivElement>('settings');
  const settingsName = el<HTMLInputElement>('settings-name');
  const settingsPhoto = el<HTMLInputElement>('settings-photo');
  const settingsPhotoValue = el<HTMLOutputElement>('settings-photo-value');
  el('menu-settings').addEventListener('click', () => {
    closePopover();
    const p = ed.project;
    settingsName.value = p.name;
    settingsPhoto.value = String(p.photoDuration);
    settingsPhotoValue.value = `${p.photoDuration.toFixed(1)} s`;
    const bytes = p.media.reduce((n, m) => n + m.size, 0);
    el('settings-info').textContent = `${p.width} × ${p.height}, ${p.fps} frames per second, ${formatTime(ed.duration, p.fps)} long. Media: ${(bytes / 2 ** 20).toFixed(1)} MB in ${p.media.length} ${p.media.length === 1 ? 'file' : 'files'}.`;
    settings.hidden = false;
  });
  settingsPhoto.addEventListener('input', () => (settingsPhotoValue.value = `${Number(settingsPhoto.value).toFixed(1)} s`));
  el('settings-close').addEventListener('click', () => {
    settings.hidden = true;
    ed.edit((p) => {
      p.name = settingsName.value.trim().slice(0, 60) || p.name;
      p.photoDuration = Number(settingsPhoto.value) || p.photoDuration;
    });
  });

  // --- performance readout -------------------------------------------------------------
  // There is no remote inspector for the target device, so the app measures itself.
  const hud = el<HTMLDivElement>('hud');
  const hudText = el<HTMLPreElement>('hud-text');
  const statsItem = el<HTMLButtonElement>('menu-stats');
  let hudTimer = 0;
  let lastPainted = 0;
  // What this browser can encode and decode, worked out once: the first thing to know when export misbehaves.
  let codecs = 'codecs  checking';
  const checkCodecs = async (): Promise<void> => {
    const { canEncodeVideo, canEncodeAudio, canDecodeVideo, canDecodeAudio } = await import('mediabunny');
    const mark = (ok: boolean, name: string): string => `${name}${ok ? '+' : '-'}`;
    const [h264, aac, opus, dAvc, dHevc, dAac] = await Promise.all([
      canEncodeVideo('avc', { width: 1920, height: 1080 }).catch(() => false),
      canEncodeAudio('aac').catch(() => false),
      canEncodeAudio('opus').catch(() => false),
      canDecodeVideo('avc').catch(() => false),
      canDecodeVideo('hevc').catch(() => false),
      canDecodeAudio('aac').catch(() => false),
    ]);
    codecs = `encode  ${mark(h264, 'h264')} ${mark(aac, 'aac')} ${mark(opus, 'opus')}\ndecode  ${mark(dAvc, 'h264')} ${mark(dHevc, 'hevc')} ${mark(dAac, 'aac')}`;
  };
  const setHud = (on: boolean): void => {
    hud.hidden = !on;
    statsItem.setAttribute('aria-checked', String(on));
    window.clearInterval(hudTimer);
    if (!on) return;
    if (codecs.endsWith('checking')) void checkCodecs().catch(() => (codecs = 'codecs  unknown'));
    hudTimer = window.setInterval(() => {
      if (!ed.isOpen) return;
      const s = ed.player.stats;
      const fps = s.painted - lastPainted;
      lastPainted = s.painted;
      hudText.textContent = [
        `paint   ${fps} fps`,
        `slow    ${s.slow} frames`,
        `resync  ${s.resyncs}`,
        `seek    ${s.lastSeekMs.toFixed(0)} ms`,
        `videos  ${s.videos}`,
        `clock   ${ed.player.audio.running ? 'audio' : 'timer'}`,
        `zoom    ${timeline.zoom().toFixed(0)} px/s`,
        `store   ${store.persistent ? 'device' : 'memory only'}`,
        codecs,
      ].join('\n');
    }, 1000);
  };
  statsItem.addEventListener('click', () => setHud(!!hud.hidden));
  if (new URLSearchParams(location.search).has('stats')) setHud(true);

  // --- keyboard ---------------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (!ed.isOpen || isBusy()) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, .dialog:not([hidden]), .sheet:not([hidden])')) return;
    if (document.querySelector('.dialog:not([hidden]), .sheet:not([hidden])')) return;
    const mod = e.ctrlKey || e.metaKey;
    const frame = 1 / ed.project.fps;
    if (e.key === ' ') ed.player.toggle();
    else if (mod && e.key.toLowerCase() === 'z') e.shiftKey ? ed.redo() : ed.undo();
    else if (mod && e.key.toLowerCase() === 'y') ed.redo();
    else if (e.key === 'ArrowLeft') ed.seek(ed.time - (e.shiftKey ? 1 : frame));
    else if (e.key === 'ArrowRight') ed.seek(ed.time + (e.shiftKey ? 1 : frame));
    else if (e.key === 'Home') ed.seek(0);
    else if (e.key === 'End') ed.seek(ed.duration);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && ed.selectedId) {
      const id = ed.selectedId;
      ed.edit((p) => deleteClip(p, id));
    } else if (e.key.toLowerCase() === 's' && !mod && ed.selectedId) {
      const id = ed.selectedId;
      const t = ed.time;
      ed.edit((p) => void splitClip(p, id, t));
    } else if (e.key === '+' || e.key === '=') timeline.setZoom(timeline.zoom() * 1.25);
    else if (e.key === '-') timeline.setZoom(timeline.zoom() / 1.25);
    else if (e.key === 'Escape') ed.select(null);
    else return;
    e.preventDefault();
  });

  // Save before the page goes away or to the background.
  const flush = (): void => {
    if (ed.isOpen) void ed.settled();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (ed.isOpen) ed.player.pause();
      flush();
    }
  });

  // --- hooks for the browser tests ------------------------------------------------------
  window.__reel = {
    status: () => ({
      open: ed.isOpen,
      project: ed.isOpen ? ed.projectId : null,
      time: ed.isOpen ? ed.time : 0,
      duration: ed.isOpen ? ed.duration : 0,
      playing: ed.isOpen && ed.player.playing,
      selected: ed.isOpen ? ed.selectedId : null,
      canUndo: ed.isOpen && ed.canUndo,
      canRedo: ed.isOpen && ed.canRedo,
      persistent: store.persistent,
      zoom: timeline.zoom(),
      audioClock: ed.isOpen && ed.player.audio.running,
    }),
    project: () => (ed.isOpen ? (JSON.parse(JSON.stringify(ed.project)) as unknown) : null),
    seek: (t: number) => ed.seek(t),
    select: (id: string | null) => ed.select(id),
    settled: () => (ed.isOpen ? ed.settled() : store.idle()),
    setZoom: (pps: number) => timeline.setZoom(pps),
  };

  await home.show().catch((err: unknown) => toast(errorText(err, 'Projects could not be listed')));
}
