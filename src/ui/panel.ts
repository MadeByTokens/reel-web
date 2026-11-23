// The tool panel on the right. With nothing selected it offers what can be
// added; with a clip selected it lists that clip's options, and each option
// opens in the same place.

import { FONTS, defaultText, makeClip, type Clip, type MediaInfo, type Project } from '../doc/model';
import {
  addAudio,
  addLayer,
  clipEnd,
  deleteClip,
  duplicateClip,
  findClip,
  insertPrimary,
  layoutPrimary,
  mediaOf,
  setSpeed,
  shiftLayer,
  splitClip,
  trimEnd,
  trimStart,
} from '../doc/ops';
import { el, type Editor } from '../editor';
import { busy, errorText, toast } from './feedback';
import { icon } from './icons';
import { togglePopover, closePopover } from './popover';

type View = 'main' | 'options' | 'trim' | 'mixer' | 'speed' | 'rotate' | 'alpha' | 'fit' | 'font' | 'color' | 'outline' | 'background';

const COLORS = ['#ffffff', '#000000', '#ff4d4d', '#ff9f1c', '#ffd23f', '#3ddc84', '#2ec4b6', '#4c9dff', '#7b5cff', '#ff5ca8', '#8d6e63', '#9aa0ab'];
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8];

const TITLES: Record<View, string> = {
  main: '',
  options: '',
  trim: 'Trim / Split',
  mixer: 'Mixer',
  speed: 'Speed',
  rotate: 'Rotate / Mirror',
  alpha: 'Alpha (Opacity)',
  fit: 'Fit / Fill',
  font: 'Font',
  color: 'Text Color',
  outline: 'Outline',
  background: 'Background',
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { html?: string } = {}, ...children: Node[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { html, ...rest } = props;
  Object.assign(node, rest);
  if (html !== undefined) node.innerHTML = html;
  node.append(...children);
  return node;
}

export interface PanelHooks {
  openExport(): void;
  openRecord(): void;
  /** Asks for text; resolves with null when cancelled. */
  askText(initial: string): Promise<string | null>;
}

export function installPanel(ed: Editor, hooks: PanelHooks): void {
  const panel = el<HTMLElement>('panel');
  const content = h('div', { className: 'panel-content' });
  content.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column';
  const play = h('button', { id: 'play', className: 'icon', html: icon('play') });
  play.setAttribute('aria-label', 'Play');
  const footer = h('div', { className: 'panel-foot' }, h('span', { className: 'spacer' }), play);
  footer.style.cssText = 'display:flex;padding:8px 14px 10px;';
  panel.append(content, footer);

  let view: View = 'main';
  let shownFor: string | null = null;
  /** Refreshes the values shown by the current view. */
  let sync: () => void = () => {};

  play.addEventListener('click', () => ed.player.toggle());
  ed.onTime(() => {
    const playing = ed.isOpen && ed.player.playing;
    if (play.dataset.playing !== String(playing)) {
      play.dataset.playing = String(playing);
      play.innerHTML = icon(playing ? 'pause' : 'play');
      play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }
    if (view === 'trim') sync();
  });

  // --- adding media ------------------------------------------------------------------

  const fileMedia = el<HTMLInputElement>('file-media');
  const fileLayer = el<HTMLInputElement>('file-layer');
  const fileAudio = el<HTMLInputElement>('file-audio');

  function clipFor(p: Project, info: MediaInfo): Clip {
    if (info.kind === 'image') return makeClip('image', p.photoDuration, { mediaId: info.id });
    const duration = Math.max(1 / p.fps, Math.floor(info.duration * p.fps) / p.fps);
    return makeClip(info.kind, duration, { mediaId: info.id });
  }

  async function importFiles(input: HTMLInputElement, where: 'primary' | 'layer' | 'audio'): Promise<void> {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length || !ed.isOpen) return;
    ed.player.pause();
    const added: MediaInfo[] = [];
    let failed = '';
    await busy(files.length > 1 ? `Adding ${files.length} files` : 'Adding', async (progress) => {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        try {
          added.push(await ed.media.import(file, file.name, (f) => progress((i + f) / files.length), where === 'audio'));
        } catch (err) {
          failed = errorText(err, 'A file could not be added');
        }
        progress((i + 1) / files.length);
      }
    });
    if (failed) toast(failed);
    if (!added.length) return;
    const at = ed.time;
    let last: Clip | null = null;
    let first: Clip | null = null;
    ed.edit((p) => {
      for (const info of added) {
        p.media.push(info);
        const clip = clipFor(p, info);
        if (where === 'primary') {
          if (last) {
            p.primary.splice(p.primary.indexOf(last) + 1, 0, clip);
            layoutPrimary(p);
          } else {
            insertPrimary(p, clip, at);
          }
        } else if (where === 'layer') {
          clip.transform.scale = 0.5;
          addLayer(p, clip, at);
        } else {
          addAudio(p, clip, last ? clipEnd(last) : at);
        }
        last = clip;
        first ??= clip;
      }
    });
    // Show what was just added; the next clip added then lands after it.
    if (where === 'primary' && first) ed.seek((first as Clip).start);
    if (where !== 'primary' && last) ed.select((last as Clip).id);
  }

  fileMedia.addEventListener('change', () => void importFiles(fileMedia, 'primary'));
  fileLayer.addEventListener('change', () => void importFiles(fileLayer, 'layer'));
  fileAudio.addEventListener('change', () => void importFiles(fileAudio, 'audio'));

  el('layer-media').addEventListener('click', () => {
    closePopover();
    fileLayer.click();
  });
  el('layer-text').addEventListener('click', () => {
    closePopover();
    void hooks.askText('').then((text) => {
      if (!text) return;
      const clip = makeClip('text', ed.project.photoDuration, { text: defaultText(text) });
      ed.edit((p) => addLayer(p, clip, ed.time));
      ed.select(clip.id);
    });
  });

  // --- shared actions ----------------------------------------------------------------

  function removeSelected(): void {
    const id = ed.selectedId;
    if (!id) return;
    ed.edit((p) => deleteClip(p, id));
  }

  function duplicateSelected(): void {
    const id = ed.selectedId;
    if (!id) return;
    let copy: Clip | null = null;
    ed.edit((p) => (copy = duplicateClip(p, id)));
    if (copy) ed.select((copy as Clip).id);
  }

  el('clip-delete').addEventListener('click', removeSelected);
  el('clip-duplicate').addEventListener('click', duplicateSelected);

  // --- building views ----------------------------------------------------------------

  function header(title: string, back: () => void, withTrash: boolean): HTMLElement {
    const backButton = h('button', { className: 'icon', html: icon('back') });
    backButton.setAttribute('aria-label', 'Back');
    backButton.addEventListener('click', back);
    const head = h('div', { className: 'panel-head' }, backButton, h('h2', { textContent: title }));
    if (withTrash) {
      const trash = h('button', { className: 'icon', html: icon('trash') });
      trash.setAttribute('aria-label', 'Delete clip');
      trash.addEventListener('click', removeSelected);
      head.append(trash);
    }
    return head;
  }

  function slider(labelText: string, min: number, max: number, step: number, read: (c: Clip) => number, write: (c: Clip, v: number) => void, show: (v: number) => string): { node: HTMLElement; sync(): void } {
    const output = h('output');
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    input.setAttribute('aria-label', labelText);
    const node = h('label', { className: 'field' }, h('span', {}, document.createTextNode(labelText), output), input);
    input.addEventListener('input', () => {
      const id = ed.selectedId;
      if (!id) return;
      ed.begin();
      const clip = findClip(ed.project, id)?.clip;
      if (clip) write(clip, Number(input.value));
      output.value = show(Number(input.value));
      ed.live();
    });
    input.addEventListener('change', () => ed.commit());
    return {
      node,
      sync() {
        const clip = ed.selected;
        if (!clip) return;
        const value = read(clip);
        if (document.activeElement !== input || Number(input.value) !== value) input.value = String(value);
        output.value = show(value);
      },
    };
  }

  function swatches(read: (c: Clip) => string, write: (c: Clip, v: string) => void, allowNone: boolean): { node: HTMLElement; sync(): void } {
    const grid = h('div', { className: 'swatches' });
    grid.setAttribute('role', 'radiogroup');
    const buttons: HTMLButtonElement[] = [];
    const add = (value: string, name: string): void => {
      const b = h('button', { className: value ? '' : 'none' });
      b.style.backgroundColor = value || 'transparent';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', name);
      b.dataset.value = value;
      b.addEventListener('click', () => {
        const id = ed.selectedId;
        if (id) ed.edit((p) => write(findClip(p, id)!.clip, value));
      });
      buttons.push(b);
      grid.append(b);
    };
    if (allowNone) add('', 'None');
    for (const c of COLORS) add(c, c);
    const custom = h('input', { type: 'color' });
    custom.setAttribute('aria-label', 'Other color');
    custom.addEventListener('input', () => {
      const id = ed.selectedId;
      if (!id) return;
      ed.begin();
      const clip = findClip(ed.project, id)?.clip;
      if (clip) write(clip, custom.value);
      ed.live();
    });
    custom.addEventListener('change', () => ed.commit());
    const node = h('div', {}, grid, h('label', { className: 'field' }, h('span', { textContent: 'Other color' }), custom));
    return {
      node,
      sync() {
        const clip = ed.selected;
        if (!clip) return;
        const value = read(clip);
        for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.value === value));
        if (value) custom.value = value;
      },
    };
  }

  function show(next: View): void {
    view = next;
    shownFor = ed.selectedId;
    render();
  }

  function render(): void {
    content.replaceChildren();
    sync = () => {};
    const clip = ed.isOpen ? ed.selected : null;
    if (!clip) view = 'main';
    if (view === 'main' || !clip) {
      renderMain();
      return;
    }
    const found = findClip(ed.project, clip.id)!;
    if (view === 'options') {
      renderOptions(clip, found.track);
      return;
    }
    const body = h('div', { className: 'panel-body' });
    content.append(header(TITLES[view], () => show('options'), false), body);
    const syncs: (() => void)[] = [];
    const use = (part: { node: HTMLElement; sync(): void }): void => {
      body.append(part.node);
      syncs.push(part.sync);
    };

    if (view === 'trim') {
      const actions: [string, (p: Project, id: string, t: number) => void][] = [
        ['Trim to Left of Playhead', (p, id, t) => trimStart(p, id, t)],
        ['Trim to Right of Playhead', (p, id, t) => trimEnd(p, id, t)],
        ['Split at Playhead', (p, id, t) => void splitClip(p, id, t)],
      ];
      const list = h('div', { className: 'list' });
      const buttons = actions.map(([name, action], index) => {
        const b = h('button', { textContent: name });
        b.addEventListener('click', () => {
          const id = ed.selectedId;
          if (!id) return;
          const t = ed.time;
          const before = findClip(ed.project, id)?.clip.start ?? 0;
          ed.edit((p) => action(p, id, t));
          // After cutting off the left part of a main-track clip, everything moved left with it.
          if (index === 0 && found.track === 'primary') ed.seek(before);
        });
        list.append(b);
        return b;
      });
      body.append(list);
      syncs.push(() => {
        const c = ed.selected;
        const frame = 1 / ed.project.fps;
        const inside = !!c && ed.time > c.start + frame / 2 && ed.time < clipEnd(c) - frame / 2;
        for (const b of buttons) b.disabled = !inside;
      });
    } else if (view === 'mixer') {
      use(slider('Volume', 0, 200, 1, (c) => Math.round(c.volume * 100), (c, v) => (c.volume = v / 100), (v) => `${v}%`));
      const mute = h('button', { textContent: 'Mute' });
      mute.addEventListener('click', () => {
        const id = ed.selectedId;
        if (id) ed.edit((p) => {
          const c = findClip(p, id)!.clip;
          c.muted = !c.muted;
        });
      });
      body.append(h('div', { className: 'chips' }, mute));
      syncs.push(() => mute.setAttribute('aria-pressed', String(!!ed.selected?.muted)));
      const seconds = (v: number): string => `${v.toFixed(1)} s`;
      use(slider('Fade in', 0, 5, 0.1, (c) => c.fadeIn, (c, v) => (c.fadeIn = v), seconds));
      use(slider('Fade out', 0, 5, 0.1, (c) => c.fadeOut, (c, v) => (c.fadeOut = v), seconds));
    } else if (view === 'speed') {
      const chips = h('div', { className: 'chips' });
      const buttons = SPEEDS.map((s) => {
        const b = h('button', { textContent: `${s}x` });
        b.addEventListener('click', () => {
          const id = ed.selectedId;
          if (id) ed.edit((p) => setSpeed(p, id, s));
        });
        chips.append(b);
        return b;
      });
      body.append(chips, h('p', { textContent: 'Faster clips sound higher, slower clips lower.' }));
      syncs.push(() => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(ed.selected?.speed === SPEEDS[i]))));
    } else if (view === 'rotate') {
      const list = h('div', { className: 'list' });
      const actions: [string, (c: Clip) => void][] = [
        ['Rotate left', (c) => (c.transform.rotation = norm(c.transform.rotation - 90))],
        ['Rotate right', (c) => (c.transform.rotation = norm(c.transform.rotation + 90))],
        ['Mirror left to right', (c) => (c.transform.flipH = !c.transform.flipH)],
        ['Mirror top to bottom', (c) => (c.transform.flipV = !c.transform.flipV)],
      ];
      for (const [name, action] of actions) {
        const b = h('button', { textContent: name });
        b.addEventListener('click', () => {
          const id = ed.selectedId;
          if (id) ed.edit((p) => action(findClip(p, id)!.clip));
        });
        list.append(b);
      }
      body.append(list);
    } else if (view === 'alpha') {
      use(slider('Opacity', 0, 100, 1, (c) => Math.round(c.transform.opacity * 100), (c, v) => (c.transform.opacity = v / 100), (v) => `${v}%`));
    } else if (view === 'fit') {
      const chips = h('div', { className: 'chips' });
      const options: [string, boolean][] = [
        ['Fit', false],
        ['Fill', true],
      ];
      const buttons = options.map(([name, fill]) => {
        const b = h('button', { textContent: name });
        b.addEventListener('click', () => {
          const id = ed.selectedId;
          if (id) ed.edit((p) => {
            const c = findClip(p, id)!.clip;
            c.fill = fill;
            c.transform.x = c.transform.y = 0.5;
            c.transform.scale = 1;
          });
        });
        chips.append(b);
        return b;
      });
      body.append(chips, h('p', { textContent: 'Fit shows the whole picture. Fill covers the frame and crops the edges.' }));
      syncs.push(() => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(!!ed.selected?.fill === options[i]![1]))));
    } else if (view === 'font') {
      const chips = h('div', { className: 'chips' });
      const buttons = FONTS.map((name) => {
        const b = h('button', { textContent: name });
        b.addEventListener('click', () => {
          const id = ed.selectedId;
          if (id) ed.edit((p) => (findClip(p, id)!.clip.text!.font = name));
        });
        chips.append(b);
        return b;
      });
      const bold = h('button', { textContent: 'Bold' });
      bold.addEventListener('click', () => {
        const id = ed.selectedId;
        if (id) ed.edit((p) => {
          const t = findClip(p, id)!.clip.text!;
          t.bold = !t.bold;
        });
      });
      const aligns = (['left', 'center', 'right'] as const).map((a) => {
        const b = h('button', { textContent: a[0]!.toUpperCase() + a.slice(1) });
        b.addEventListener('click', () => {
          const id = ed.selectedId;
          if (id) ed.edit((p) => (findClip(p, id)!.clip.text!.align = a));
        });
        return b;
      });
      body.append(chips, h('div', { className: 'chips' }, bold, ...aligns));
      use(slider('Size', 2, 40, 0.5, (c) => Math.round((c.text?.size ?? 0.1) * 200) / 2, (c, v) => (c.text!.size = v / 100), (v) => `${v}`));
      syncs.push(() => {
        const t = ed.selected?.text;
        buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(t?.font === FONTS[i])));
        bold.setAttribute('aria-pressed', String(!!t?.bold));
        aligns.forEach((b, i) => b.setAttribute('aria-pressed', String(t?.align === ['left', 'center', 'right'][i])));
      });
    } else if (view === 'color') {
      use(swatches((c) => c.text?.color ?? '', (c, v) => (c.text!.color = v || '#ffffff'), false));
    } else if (view === 'outline') {
      use(swatches((c) => c.text?.outline ?? '', (c, v) => (c.text!.outline = v), true));
    } else if (view === 'background') {
      use(swatches((c) => c.text?.background ?? '', (c, v) => (c.text!.background = v), true));
    }
    sync = () => syncs.forEach((fn) => fn());
    sync();
  }

  const norm = (deg: number): number => {
    let a = ((deg % 360) + 360) % 360;
    if (a > 180) a -= 360;
    return a;
  };

  function renderMain(): void {
    const button = (id: string, name: string, glyph: string, tip: string): HTMLButtonElement => {
      const b = h('button', { id, html: `${icon(glyph)}<span>${name}</span>` });
      b.dataset.tip = tip;
      return b;
    };
    const media = button('add-media', 'Media', 'media', 'Add videos and pictures to the main track');
    const layer = button('add-layer', 'Layer', 'layer', 'Put a picture, video or text on top');
    const audio = button('add-audio', 'Audio', 'audio', 'Add music or sounds');
    const rec = button('add-rec', 'REC', 'mic', 'Record your voice');
    const exportButton = button('export-button', 'Export', 'export', 'Save the finished video');
    layer.setAttribute('aria-haspopup', 'true');
    media.addEventListener('click', () => fileMedia.click());
    layer.addEventListener('click', () => togglePopover(el('layer-menu'), layer));
    audio.addEventListener('click', () => fileAudio.click());
    rec.addEventListener('click', hooks.openRecord);
    exportButton.addEventListener('click', hooks.openExport);
    content.append(h('div', { className: 'wheel' }, media, layer, audio, rec, exportButton));
  }

  function renderOptions(clip: Clip, track: string): void {
    const media = mediaOf(ed.project, clip);
    const title = clip.kind === 'text' ? 'Text' : (media?.name ?? 'Clip');
    const grid = h('div', { className: 'options' });
    const option = (name: string, glyph: string, action: () => void): void => {
      const b = h('button', { html: `${icon(glyph)}<span>${name}</span>` });
      b.addEventListener('click', action);
      grid.append(b);
    };
    if (clip.kind === 'text') {
      option('Edit', 'text', () => {
        void hooks.askText(clip.text?.text ?? '').then((text) => {
          if (text) ed.edit((p) => (findClip(p, clip.id)!.clip.text!.text = text));
        });
      });
      option('Font', 'font', () => show('font'));
      option('Text Color', 'color', () => show('color'));
      option('Outline', 'opacity', () => show('outline'));
      option('Background', 'image', () => show('background'));
    }
    option('Trim / Split', 'cut', () => show('trim'));
    const sounds = clip.kind === 'audio' || (clip.kind === 'video' && media?.hasAudio);
    if (sounds) option('Mixer', 'volume', () => show('mixer'));
    if (clip.kind === 'video' || clip.kind === 'audio') option('Speed', 'speed', () => show('speed'));
    if (clip.kind !== 'audio') option('Rotate / Mirror', 'rotate', () => show('rotate'));
    if (track === 'primary') option('Fit / Fill', 'fit', () => show('fit'));
    if (track === 'layers') {
      option('Alpha (Opacity)', 'opacity', () => show('alpha'));
      option('Bring Forward', 'front', () => ed.edit((p) => shiftLayer(p, clip.id, 1)));
      option('Send Backward', 'behind', () => ed.edit((p) => shiftLayer(p, clip.id, -1)));
    }
    option('Duplicate', 'duplicate', duplicateSelected);
    content.append(header(title, () => ed.select(null), true), h('div', { className: 'panel-body' }, grid));
  }

  ed.onSelect(() => {
    const selected = ed.isOpen ? ed.selectedId : null;
    el('clip-delete').hidden = !selected;
    el('clip-duplicate').hidden = !selected;
    if (selected !== shownFor || !selected) {
      view = selected ? 'options' : 'main';
      shownFor = selected;
      render();
    }
  });
  ed.onChange(() => {
    // A clip may have gone (undo, delete); otherwise only the values need refreshing.
    if (view !== 'main' && !ed.selected) render();
    else sync();
  });
  render();
}
