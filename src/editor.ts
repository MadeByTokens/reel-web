// The open project and everything that acts on it. UI modules call edit(),
// begin()/commit() and select(), and listen for changes.

import { parseProject, type Clip, type Project } from './doc/model';
import { findClip, layoutPrimary, projectDuration, unusedMedia } from './doc/ops';
import { MediaLibrary } from './media/library';
import { Player } from './media/player';
import { loadDocument, saveDocument, type Store } from './store/store';

export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const HISTORY = 100;
const SAVE_DELAY = 400;

/**
 * Claims a name for this tab through the browser's lock manager. Resolves with
 * a function that lets go, or null when another tab holds it. Where there is
 * no lock manager the claim always succeeds.
 */
export function claim(name: string): Promise<(() => void) | null> {
  const locks = navigator.locks;
  if (!locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    void locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return undefined;
        }
        return new Promise<void>((release) => resolve(release));
      })
      .catch(() => resolve(() => {}));
  });
}

export const projectFolder = (id: string): string => `projects/${id}`;

export type Listener = () => void;

export class Editor {
  project!: Project;
  projectId = '';
  media!: MediaLibrary;
  player!: Player;
  selectedId: string | null = null;
  /** True between open() and close(). */
  isOpen = false;

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private pendingBase: string | null = null;
  private seq = 0;
  private saveTimer = 0;
  private saveChain: Promise<void> = Promise.resolve();
  private saveFailed = false;
  /** Lets go of the claim on the open project (see open()). */
  private releaseLock: (() => void) | null = null;
  private readonly changeListeners = new Set<Listener>();
  private readonly timeListeners = new Set<Listener>();
  private readonly selectListeners = new Set<Listener>();

  toast: (message: string) => void = () => {};
  /** A panel view to open with the next selection (see openView). */
  viewRequest: string | null = null;
  /** When set, the next tap on the preview is handed here, as fractions of the frame, instead of acting on a layer. */
  pickPoint: ((x: number, y: number) => void) | null = null;

  constructor(
    readonly store: Store,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  onChange(fn: Listener): void {
    this.changeListeners.add(fn);
  }
  /** Fires when the playhead moves or play starts and stops. */
  onTime(fn: Listener): void {
    this.timeListeners.add(fn);
  }
  onSelect(fn: Listener): void {
    this.selectListeners.add(fn);
  }

  get time(): number {
    return this.player.time;
  }

  get duration(): number {
    return projectDuration(this.project);
  }

  get selected(): Clip | null {
    return findClip(this.project, this.selectedId)?.clip ?? null;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // --- opening and closing ---------------------------------------------------------

  /** Opens a saved project. Throws if it cannot be read; nothing is written in that case. */
  async open(id: string): Promise<void> {
    // Two tabs editing one project would overwrite each other's saves and delete each
    // other's media, so a project is claimed while it is open.
    const release = await claim(`reel-project-${id}`);
    if (!release) throw new Error('This project is open in another tab or window');
    try {
      await this.load(id);
    } catch (err) {
      release();
      throw err;
    }
    this.releaseLock = release;
  }

  private async load(id: string): Promise<void> {
    const loaded = await loadDocument(this.store, `${projectFolder(id)}/project`);
    const project = loaded.text ? parseProject(loaded.text) : null;
    if (!project) throw new Error('This project cannot be read');
    this.project = project;
    this.projectId = id;
    this.seq = loaded.seq;
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.saveFailed = false;
    this.media = new MediaLibrary(this.store, projectFolder(id));
    const missing = await this.media.load(project.media);
    // Files nothing refers to any more (their clips were deleted in an earlier session).
    for (const info of unusedMedia(project)) {
      project.media = project.media.filter((m) => m.id !== info.id);
      await this.media.remove(info);
    }
    await this.media.sweep(project.media);
    this.player = new Player(this.canvas, () => this.project, this.media);
    this.player.onTime = () => this.emit(this.timeListeners);
    this.player.onPlayState = () => this.emit(this.timeListeners);
    this.isOpen = true;
    this.emit(this.changeListeners);
    this.emit(this.selectListeners);
    this.emit(this.timeListeners);
    if (missing.length) this.toast(`${missing.length} media ${missing.length === 1 ? 'file is' : 'files are'} missing from this device`);
  }

  async close(): Promise<void> {
    if (!this.isOpen) return;
    this.player.pause();
    try {
      const thumb = await this.player.snapshot(480);
      if (thumb && this.project.primary.length + this.project.layers.length > 0) {
        await this.store.write(`${projectFolder(this.projectId)}/thumb.jpg`, thumb);
      }
    } catch {
      // The picture on the projects screen is a nicety.
    }
    await this.settled();
    // From here on nothing may be written: the project may be deleted from the projects screen.
    this.isOpen = false;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    await this.saveChain;
    this.pendingBase = null;
    this.player.dispose();
    this.media.dispose();
    this.releaseLock?.();
    this.releaseLock = null;
  }

  // --- editing -----------------------------------------------------------------------

  /** Starts an edit that may take several steps (a drag). */
  begin(): void {
    if (this.pendingBase === null) this.pendingBase = JSON.stringify(this.project);
  }

  /** Puts the project back to how it was at begin(), without ending the edit. */
  revert(): void {
    if (this.pendingBase === null) return;
    const media = this.project.media;
    this.project = JSON.parse(this.pendingBase) as Project;
    // Media added during the gesture stays listed.
    for (const m of media) if (!this.project.media.some((x) => x.id === m.id)) this.project.media.push(m);
  }

  /** Shows the project as it is now, mid-edit. */
  live(): void {
    this.afterChange(false);
  }

  /** Ends the edit; it becomes one undo step if anything changed. */
  commit(): void {
    const base = this.pendingBase;
    this.pendingBase = null;
    if (base === null) return;
    if (base !== JSON.stringify(this.project)) {
      this.undoStack.push(base);
      if (this.undoStack.length > HISTORY) this.undoStack.shift();
      this.redoStack = [];
      this.project.modified = Date.now();
    }
    this.afterChange(true);
  }

  /** One complete edit. */
  edit(fn: (p: Project) => void): void {
    this.begin();
    fn(this.project);
    this.commit();
  }

  private afterChange(save: boolean): void {
    layoutPrimary(this.project);
    if (this.selectedId && !findClip(this.project, this.selectedId)) {
      this.selectedId = null;
      this.emit(this.selectListeners);
    }
    const end = projectDuration(this.project);
    if (this.player.time > end) this.player.seek(end);
    this.player.invalidate();
    this.emit(this.changeListeners);
    this.emit(this.timeListeners);
    // A volume change should be heard at once when it is made while playing.
    const selected = this.selected;
    if (selected && this.player.playing) this.player.audio.setVolume(selected);
    if (save) this.scheduleSave();
  }

  undo(): void {
    this.swap(this.undoStack, this.redoStack);
  }

  redo(): void {
    this.swap(this.redoStack, this.undoStack);
  }

  private swap(from: string[], to: string[]): void {
    // An edit left open (a slider that never reported its release) is finished first.
    if (this.pendingBase !== null) this.commit();
    const snapshot = from.pop();
    if (snapshot === undefined) return;
    this.player.pause();
    to.push(JSON.stringify(this.project));
    const media = this.project.media;
    this.project = JSON.parse(snapshot) as Project;
    // Files imported since that snapshot are still on disk; keep them listed so redo works.
    for (const m of media) if (!this.project.media.some((x) => x.id === m.id)) this.project.media.push(m);
    this.afterChange(true);
  }

  select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.emit(this.selectListeners);
  }

  /** Selects a clip and opens one of its options straight away. */
  openView(id: string, view: string): void {
    this.viewRequest = view;
    this.selectedId = id;
    this.emit(this.selectListeners);
  }

  seek(t: number): void {
    this.player.seek(t);
    this.emit(this.timeListeners);
  }

  // --- saving --------------------------------------------------------------------------

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), SAVE_DELAY);
  }

  private saveNow(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (!this.isOpen) return;
    const text = JSON.stringify(this.project);
    const base = `${projectFolder(this.projectId)}/project`;
    this.saveChain = this.saveChain.then(async () => {
      try {
        this.seq = await saveDocument(this.store, base, this.seq, text);
        this.saveFailed = false;
      } catch {
        if (!this.saveFailed) this.toast('Saving failed. Storage may be full.');
        this.saveFailed = true;
      }
    });
  }

  /** Resolves once every change so far is on disk. */
  async settled(): Promise<void> {
    if (this.saveTimer) this.saveNow();
    await this.saveChain;
    if (this.saveFailed) {
      // One more try: the failure may have been a moment of full storage.
      this.saveNow();
      await this.saveChain;
    }
    await this.store.idle();
  }

  /** True when the last attempt to save did not succeed: what is on screen is newer than what is stored. */
  get unsaved(): boolean {
    return this.saveFailed;
  }

  private emit(listeners: Set<Listener>): void {
    for (const fn of listeners) fn();
  }
}
