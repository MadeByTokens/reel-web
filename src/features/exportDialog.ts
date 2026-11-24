// The export dialog: resolution, frame rate and quality, then the render.

import { el, type Editor } from '../editor';
import { exportProject } from '../media/exporter';
import { busy, errorText, safeName, saveFile, toast } from '../ui/feedback';
import { exportProblem } from '../util/advice';
import { budget, freeSpace, megabytes, type Watch } from '../util/device';

const HEIGHTS = [1080, 720, 540, 360];
const RATES = [30, 25, 24, 15];

interface WakeLockLike {
  release(): Promise<void>;
}

export function installExport(ed: Editor, watch: Watch): { open(): void } {
  const dialog = el<HTMLDivElement>('export');
  const nameInput = el<HTMLInputElement>('export-name');
  const resolution = el<HTMLDivElement>('export-resolution');
  const rates = el<HTMLDivElement>('export-fps');
  const quality = el<HTMLInputElement>('export-quality');
  const qualityValue = el<HTMLOutputElement>('export-quality-value');
  const info = el<HTMLParagraphElement>('export-info');
  const go = el<HTMLButtonElement>('export-go');
  let height = 1080;
  let fps = 30;
  /** Storage free when the dialog opened; null while unknown. */
  let free: number | null = null;

  /** Output size: the chosen number is the short side, as in "1080p". */
  function size(): { width: number; height: number } {
    const p = ed.project;
    const short = Math.min(p.width, p.height);
    const k = Math.min(1, height / short);
    return { width: Math.round((p.width * k) / 2) * 2, height: Math.round((p.height * k) / 2) * 2 };
  }

  function bitrate(): number {
    const s = size();
    // Bits per pixel per frame, from light to generous.
    const bpp = 0.04 + (Number(quality.value) / 100) * 0.16;
    return Math.round(s.width * s.height * fps * bpp);
  }

  function choices(host: HTMLElement, values: number[], label: (v: number) => string, pick: (v: number) => void, current: () => number): () => void {
    const buttons = values.map((v) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'radio');
      b.textContent = label(v);
      b.addEventListener('click', () => {
        pick(v);
        sync();
      });
      host.append(b);
      return b;
    });
    return () => buttons.forEach((b, i) => b.setAttribute('aria-checked', String(values[i] === current())));
  }
  const syncRes = choices(resolution, HEIGHTS, (v) => `${v}p`, (v) => (height = v), () => height);
  const syncFps = choices(rates, RATES, (v) => String(v), (v) => (fps = v), () => fps);

  function sync(): void {
    syncRes();
    syncFps();
    const rate = bitrate();
    const bytes = ((rate + 192_000) * ed.duration) / 8;
    const s = size();
    qualityValue.value = `${(rate / 1e6).toFixed(1)} Mbps`;
    const problem = exportProblem(bytes, ed.store.persistent, free, budget().memoryFile);
    info.classList.toggle('blocked', !!problem);
    go.disabled = !!problem;
    info.textContent = problem || `${s.width} × ${s.height}, about ${megabytes(bytes)}. Keep Reel open and on screen while it works.`;
    const failedAt = watch.limit('export');
    if (!problem && failedAt !== null && s.width * s.height >= failedAt) {
      const caution = document.createElement('span');
      caution.className = 'caution';
      caution.textContent = 'Reel closed during an export this large on this device before. A lower resolution is safer.';
      info.append(caution);
    }
  }
  quality.addEventListener('input', sync);

  el('export-cancel').addEventListener('click', () => (dialog.hidden = true));
  go.addEventListener('click', () => {
    dialog.hidden = true;
    void run();
  });

  async function run(): Promise<void> {
    const name = safeName(nameInput.value, 'video');
    const abort = new AbortController();
    let lock: WakeLockLike | null = null;
    // Keep the screen awake: a sleeping tablet stops the export. The browser drops the
    // lock whenever the page is hidden, so it is asked for again each time it returns.
    const wake = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } }).wakeLock;
    const hold = async (): Promise<void> => {
      if (document.hidden) return;
      lock = (await wake?.request('screen').catch(() => null)) ?? lock;
    };
    document.addEventListener('visibilitychange', hold);
    try {
      await hold();
      await ed.settled();
      const started = performance.now();
      const made = size();
      // If the page is closed for using too much memory, this note is what is left to say so.
      watch.begin({ what: 'export', detail: `${height}p`, pixels: made.width * made.height });
      const result = await busy(
        'Exporting',
        (progress) => exportProject(ed.project, ed.media, ed.store, { ...size(), fps, bitrate: bitrate() }, progress, abort.signal),
        abort,
      );
      watch.succeeded('export', made.width * made.height);
      const took = Math.round((performance.now() - started) / 1000);
      await saveFile(result.blob, `${name}.${result.extension}`, [`Made in ${took} s.`, ...result.notes]);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') toast('Export cancelled');
      else toast(errorText(err, 'The video could not be made'));
    } finally {
      watch.end();
      document.removeEventListener('visibilitychange', hold);
      await (lock as WakeLockLike | null)?.release().catch(() => {});
    }
  }

  // If the page was hidden during an export the browser may have paused it.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !el('busy').hidden && el('busy-text').textContent === 'Exporting') {
      toast('Export pauses while Reel is in the background');
    }
  });

  return {
    open() {
      if (ed.duration <= 0) {
        toast('Add a video or picture first');
        return;
      }
      ed.player.pause();
      nameInput.value = ed.project.name;
      const short = Math.min(ed.project.width, ed.project.height);
      const fitting = HEIGHTS.filter((h) => h <= short);
      // Start below the size that closed the app last time, when there is such a size.
      const failedAt = watch.limit('export');
      const safe = fitting.filter((h) => {
        const k = h / short;
        return failedAt === null || ed.project.width * k * ed.project.height * k < failedAt;
      });
      height = safe[0] ?? fitting[fitting.length - 1] ?? 360;
      fps = 30;
      quality.value = '50';
      free = null;
      sync();
      dialog.hidden = false;
      void freeSpace().then((bytes) => {
        free = bytes;
        if (!dialog.hidden) sync();
      });
    },
  };
}
