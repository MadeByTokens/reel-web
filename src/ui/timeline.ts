// The timeline. The playhead stays in the middle and the clips scroll under
// it; scrolling is the browser's own, so it has the device's momentum.

import type { Clip, Project, TrackName } from '../doc/model';
import { clipEnd, findClip, mediaOf, moveClip, reorderPrimary, trimEnd, trimStart } from '../doc/ops';
import { el, type Editor } from '../editor';
import { icon } from './icons';

const PRIMARY_TOP = 24;
const PRIMARY_H = 60;
const ROW_H = 30;
const ROW_GAP = 4;
const SECTION_GAP = 10;
const MIN_PPS = 4;
const MAX_PPS = 480;
const LONG_PRESS = 380;
const SLOP = 7;
const SNAP_PX = 9;

export function formatTime(t: number, fps = 30): string {
  const frames = Math.round(Math.max(0, t) * fps);
  const f = frames % fps;
  const s = Math.floor(frames / fps);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ''}${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}.${pad(f)}`;
}

export interface Timeline {
  /** Pixels per second. */
  zoom(): number;
  setZoom(pps: number): void;
}

export function installTimeline(ed: Editor): Timeline {
  const view = el<HTMLDivElement>('tl-view');
  const scroller = el<HTMLDivElement>('tl-scroll');
  const content = el<HTMLDivElement>('tl-content');
  const head = el<HTMLDivElement>('tl-head');
  const rows = el<HTMLDivElement>('tl-rows');
  const canvas = el<HTMLCanvasElement>('tl-canvas');
  const timecode = el<HTMLOutputElement>('timecode');
  const total = el<HTMLOutputElement>('total');
  const ctx = canvas.getContext('2d')!;

  let pps = 80;
  /** The scroll position this code last set; scroll events at it are not the user's. */
  let expected = -1;
  let viewW = 0;
  let drawQueued = false;
  /** A gesture that owns the timeline: scrolling by touch is suppressed while set. */
  let gesture = false;
  const nodes = new Map<string, HTMLDivElement>();

  const pad = (): number => viewW / 2;
  const xOf = (t: number): number => pad() + t * pps;

  // --- layout of the clip elements ---------------------------------------------------

  function label(p: Project, clip: Clip): string {
    if (clip.kind === 'text') return `${icon('text')}<span>${escapeHtml((clip.text?.text ?? '').split('\n')[0] ?? '')}</span>`;
    const name = escapeHtml(mediaOf(p, clip)?.name ?? '');
    const glyph = clip.kind === 'audio' ? 'audio' : clip.kind === 'image' ? 'image' : 'media';
    const speed = clip.speed !== 1 ? ` ${clip.speed}x` : '';
    const muted = clip.kind !== 'image' && (clip.muted || clip.volume === 0) ? icon('mute') : '';
    return `${icon(glyph)}<span>${name}${speed}</span>${muted}`;
  }

  function layout(): void {
    if (!ed.isOpen) return;
    const p = ed.project;
    viewW = view.clientWidth;
    const width = Math.ceil(ed.duration * pps + viewW);
    content.style.width = `${width}px`;
    head.style.width = `${width}px`;

    const layerRows = p.layers.length ? Math.max(...p.layers.map((c) => c.row)) + 1 : 0;
    const audioRows = p.audio.length ? Math.max(...p.audio.map((c) => c.row)) + 1 : 0;
    const audioTop = 6 + layerRows * (ROW_H + ROW_GAP) + (layerRows ? SECTION_GAP : 0);
    rows.style.height = `${audioTop + audioRows * (ROW_H + ROW_GAP) + 24}px`;

    const seen = new Set<string>();
    const place = (clip: Clip, track: TrackName): void => {
      seen.add(clip.id);
      let node = nodes.get(clip.id);
      if (!node) {
        node = document.createElement('div');
        node.dataset.id = clip.id;
        node.innerHTML = '<div class="label"></div><span class="grip left"></span><span class="grip right"></span>';
        nodes.set(clip.id, node);
      }
      const parent = track === 'primary' ? head : rows;
      if (node.parentElement !== parent) parent.appendChild(node);
      node.className = `clip ${track === 'primary' ? 'primary' : track === 'audio' ? 'audio' : `layer ${clip.kind}`}${
        clip.id === ed.selectedId ? ' selected' : ''
      }${node.classList.contains('lifted') ? ' lifted' : ''}`;
      node.style.left = `${xOf(clip.start)}px`;
      node.style.width = `${Math.max(2, clip.duration * pps)}px`;
      if (track !== 'primary') {
        const top = track === 'layers' ? 6 + clip.row * (ROW_H + ROW_GAP) : audioTop + clip.row * (ROW_H + ROW_GAP);
        node.style.top = `${top}px`;
      }
      const html = label(p, clip);
      const labelNode = node.firstElementChild as HTMLDivElement;
      if (labelNode.dataset.html !== html) {
        labelNode.dataset.html = html;
        labelNode.innerHTML = html;
      }
      node.setAttribute('aria-label', `${clip.kind} clip`);
    };
    for (const clip of p.primary) place(clip, 'primary');
    for (const clip of p.layers) place(clip, 'layers');
    for (const clip of p.audio) place(clip, 'audio');
    for (const [id, node] of nodes) {
      if (!seen.has(id)) {
        node.remove();
        nodes.delete(id);
      }
    }
    syncScroll();
    queueDraw();
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  }

  // --- the ruler and the filmstrip ---------------------------------------------------

  function queueDraw(): void {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      draw();
    });
  }

  function draw(): void {
    if (!ed.isOpen) return;
    const p = ed.project;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = viewW;
    const h = 90;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== h * dpr) {
      canvas.width = Math.round(w * dpr);
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const left = scroller.scrollLeft;

    // Ruler: a tick step that keeps labels comfortably apart.
    const steps = [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((s) => s * pps >= 70) ?? 600;
    ctx.fillStyle = '#9aa0ab';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    const t0 = Math.max(0, Math.floor((left - pad()) / pps / step) * step);
    for (let t = t0; xOf(t) - left < w; t += step) {
      const x = xOf(t) - left;
      if (t > ed.duration + step) break;
      ctx.fillRect(Math.round(x), 14, 1, 7);
      const whole = Math.round(t * 10) / 10;
      const text = step < 1 ? `${whole.toFixed(1)}s` : `${Math.floor(whole / 60)}:${String(Math.round(whole % 60)).padStart(2, '0')}`;
      ctx.fillText(text, x + 4, 9);
      for (let k = 1; k < 5; k++) ctx.fillRect(Math.round(x + (k * step * pps) / 5), 18, 1, 3);
    }

    // Filmstrip of every primary clip that is in view.
    for (const clip of p.primary) {
      const x0 = xOf(clip.start) - left;
      const cw = clip.duration * pps;
      if (x0 > w || x0 + cw < 0) continue;
      ctx.save();
      ctx.beginPath();
      if ('roundRect' in ctx) ctx.roundRect(x0, PRIMARY_TOP, cw, PRIMARY_H, 6);
      else (ctx as CanvasRenderingContext2D).rect(x0, PRIMARY_TOP, cw, PRIMARY_H);
      ctx.clip();
      ctx.fillStyle = '#2f3540';
      ctx.fillRect(x0, PRIMARY_TOP, cw, PRIMARY_H);
      const media = mediaOf(p, clip);
      if (media && clip.mediaId) {
        const aspect = media.width && media.height ? media.width / media.height : 16 / 9;
        const tw = Math.max(24, PRIMARY_H * aspect);
        const first = Math.max(0, Math.floor(-x0 / tw));
        for (let i = first; i * tw < cw && x0 + i * tw < w; i++) {
          const source = clip.offset + ((i * tw) / pps) * clip.speed;
          const thumb = ed.media.thumb(clip.mediaId, source);
          if (thumb) {
            try {
              ctx.drawImage(thumb, x0 + i * tw, PRIMARY_TOP, tw, PRIMARY_H);
            } catch {
              // Not drawable yet.
            }
          }
        }
      }
      ctx.restore();
    }
  }

  // --- scrolling and the playhead ----------------------------------------------------

  function syncScroll(): void {
    const want = Math.round(ed.time * pps);
    if (Math.abs(scroller.scrollLeft - want) > 0.75) {
      expected = want;
      scroller.scrollLeft = want;
      // The browser may clamp or round: remember what it actually became.
      expected = scroller.scrollLeft;
    }
  }

  scroller.addEventListener('scroll', () => {
    queueDraw();
    if (!ed.isOpen) return;
    if (Math.abs(scroller.scrollLeft - expected) <= 1.5) return;
    expected = scroller.scrollLeft;
    const t = Math.round((scroller.scrollLeft / pps) * ed.project.fps) / ed.project.fps;
    ed.player.seek(t);
    showTime();
  });

  function showTime(): void {
    if (!ed.isOpen) return;
    timecode.value = formatTime(ed.time, ed.project.fps);
    total.value = formatTime(ed.duration, ed.project.fps);
  }

  ed.onTime(() => {
    showTime();
    syncScroll();
  });
  ed.onChange(layout);
  ed.onSelect(layout);
  new ResizeObserver(layout).observe(view);

  // Touching the timeline while it plays stops playback, like stopping a tape by hand.
  scroller.addEventListener('pointerdown', () => {
    if (ed.isOpen && ed.player.playing) ed.player.pause();
  });

  // --- zoom ----------------------------------------------------------------------------

  function setZoom(next: number): void {
    const clamped = Math.max(MIN_PPS, Math.min(MAX_PPS, next));
    if (clamped === pps) return;
    pps = clamped;
    layout();
  }

  scroller.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(pps * Math.exp(-e.deltaY * 0.01));
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && scroller.scrollHeight <= scroller.clientHeight + 1) {
        e.preventDefault();
        scroller.scrollLeft += e.deltaY;
      }
    },
    { passive: false },
  );

  // Two fingers pinch the timeline in and out.
  let pinch: { distance: number; pps: number } | null = null;
  const spread = (e: TouchEvent): number =>
    Math.abs(e.touches[0]!.clientX - e.touches[1]!.clientX) + Math.abs(e.touches[0]!.clientY - e.touches[1]!.clientY) * 0.3;
  scroller.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) pinch = { distance: Math.max(20, spread(e)), pps };
    },
    { passive: true },
  );
  scroller.addEventListener(
    'touchmove',
    (e) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        setZoom(pinch.pps * (Math.max(20, spread(e)) / pinch.distance));
      } else if (gesture && e.cancelable) {
        e.preventDefault();
      }
    },
    { passive: false },
  );
  const endPinch = (e: TouchEvent): void => {
    if (e.touches.length < 2) pinch = null;
  };
  scroller.addEventListener('touchend', endPinch);
  scroller.addEventListener('touchcancel', endPinch);

  // --- selecting, moving and trimming clips -------------------------------------------

  const contentX = (clientX: number): number => clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft;

  /** Times a dragged edge sticks to: the playhead, the start, and the edges of other clips. */
  function snapTargets(ignore: string): number[] {
    const p = ed.project;
    const out = [0, ed.time];
    for (const clip of [...p.primary, ...p.layers, ...p.audio]) {
      if (clip.id !== ignore) out.push(clip.start, clipEnd(clip));
    }
    return out;
  }

  /** The nearest target within a few pixels of a time, or the time itself. */
  function snapTo(t: number, targets: number[]): { time: number; snapped: boolean } {
    let best = t;
    let distance = SNAP_PX / pps;
    for (const target of targets) {
      const d = Math.abs(target - t);
      if (d < distance) {
        distance = d;
        best = target;
      }
    }
    return { time: best, snapped: best !== t };
  }

  function startTrim(e: PointerEvent, id: string, side: 'left' | 'right', grip: HTMLElement): void {
    const found = findClip(ed.project, id);
    if (!found) return;
    e.preventDefault();
    e.stopPropagation();
    ed.player.pause();
    grip.setPointerCapture(e.pointerId);
    gesture = true;
    const x0 = contentX(e.clientX);
    const base = { start: found.clip.start, end: clipEnd(found.clip) };
    // On the main track a clip's start is pinned, so only its end can meet other edges.
    const targets = found.track === 'primary' && side === 'left' ? [] : snapTargets(id);
    ed.begin();
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      const dt = (contentX(ev.clientX) - x0) / pps;
      ed.revert();
      if (side === 'left') trimStart(ed.project, id, snapTo(base.start + dt, targets).time);
      else trimEnd(ed.project, id, snapTo(base.end + dt, targets).time);
      ed.live();
    };
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      gesture = false;
      ed.commit();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  function startPress(e: PointerEvent, node: HTMLDivElement): void {
    const id = node.dataset.id!;
    const found = findClip(ed.project, id);
    if (!found) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const cx0 = contentX(e.clientX);
    const base = { start: found.clip.start, row: found.clip.row, track: found.track, duration: found.clip.duration };
    const targets = snapTargets(id);
    let lifted = false;
    let moved = false;
    let timer = 0;

    const lift = (): void => {
      lifted = true;
      gesture = true;
      ed.player.pause();
      ed.select(id);
      ed.begin();
      node.classList.add('lifted');
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        // The pointer is already gone.
      }
    };
    if (e.pointerType === 'touch') timer = window.setTimeout(lift, LONG_PRESS);

    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!lifted) {
        if (Math.hypot(dx, dy) < SLOP) return;
        moved = true;
        // A finger that moves before the long press is scrolling; a mouse is dragging.
        if (e.pointerType === 'touch') {
          window.clearTimeout(timer);
          return;
        }
        lift();
      }
      ev.preventDefault();
      ed.revert();
      const p = ed.project;
      if (base.track === 'primary') {
        const at = (contentX(ev.clientX) - pad()) / pps;
        const others = p.primary.filter((c) => c.id !== id);
        const index = others.filter((c) => c.start + c.duration / 2 < at).length;
        reorderPrimary(p, id, index);
      } else {
        const dt = (contentX(ev.clientX) - cx0) / pps;
        // Either end of the clip may stick to an edge; the start wins a tie.
        const head = snapTo(base.start + dt, targets);
        const tail = snapTo(base.start + dt + base.duration, targets);
        const start = head.snapped ? head.time : tail.snapped ? tail.time - base.duration : base.start + dt;
        moveClip(p, id, start, base.row + Math.round(dy / (ROW_H + ROW_GAP)));
      }
      ed.live();
    };
    const finish = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      if (lifted) {
        node.classList.remove('lifted');
        gesture = false;
        ed.commit();
      } else if (!moved && ev.type === 'pointerup') {
        ed.select(ed.selectedId === id ? null : id);
      }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
  }

  content.addEventListener('pointerdown', (e) => {
    if (!ed.isOpen || e.button !== 0) return;
    const target = e.target as HTMLElement;
    const node = target.closest<HTMLDivElement>('.clip');
    if (node) {
      if (target.classList.contains('grip')) {
        startTrim(e, node.dataset.id!, target.classList.contains('left') ? 'left' : 'right', target);
      } else {
        startPress(e, node);
      }
      return;
    }
    // Empty timeline: a tap clears the selection; a mouse drag scrolls.
    const x0 = e.clientX;
    const left0 = scroller.scrollLeft;
    let moved = false;
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      if (Math.abs(ev.clientX - x0) > SLOP) moved = true;
      if (moved && e.pointerType === 'mouse') scroller.scrollLeft = left0 - (ev.clientX - x0);
    };
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (!moved && ev.type === 'pointerup') ed.select(null);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  });

  // Long presses must not open the system's callout or selection.
  content.addEventListener('contextmenu', (e) => e.preventDefault());

  ed.onChange(() => {
    ed.media.onThumb = queueDraw;
  });

  el('jump-start').addEventListener('click', () => ed.seek(0));
  el('jump-end').addEventListener('click', () => ed.seek(ed.duration));

  return { zoom: () => pps, setZoom };
}
