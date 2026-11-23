// The preview area: sizes the picture to the space, and lets a selected layer
// be moved, resized and turned directly on the picture.

import type { Clip } from '../doc/model';
import { clipEnd, findClip, mediaOf, visibleAt } from '../doc/ops';
import { el, type Editor } from '../editor';
import { baseBox } from '../render/compose';
import { icon } from './icons';

const SNAP = 0.012;

export function installStage(ed: Editor): void {
  const stage = el<HTMLElement>('stage');
  const frame = el<HTMLDivElement>('frame');
  const canvas = el<HTMLCanvasElement>('preview');
  const overlay = el<HTMLDivElement>('overlay');
  const box = el<HTMLDivElement>('box');
  const guideV = el<HTMLDivElement>('guide-v');
  const guideH = el<HTMLDivElement>('guide-h');
  const hint = el<HTMLDivElement>('empty-hint');
  const rotateHandle = el<HTMLSpanElement>('handle-rotate');
  const scaleHandle = el<HTMLSpanElement>('handle-scale');
  rotateHandle.innerHTML = icon('rotate');
  scaleHandle.innerHTML = icon('fit');

  /** CSS pixels per project pixel. */
  let k = 1;

  function fit(): void {
    if (!ed.isOpen) return;
    const p = ed.project;
    const availW = Math.max(40, stage.clientWidth - 20);
    const availH = Math.max(40, stage.clientHeight - 20);
    const s = Math.min(availW / p.width, availH / p.height);
    const w = Math.floor(p.width * s);
    const h = Math.floor(p.height * s);
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    k = w / p.width;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.min(p.width, Math.round(w * dpr));
    const ch = Math.round((cw * p.height) / p.width);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    ed.player.invalidate();
    update();
  }

  /** The layer shown with handles: the selected clip, when it is a layer and on screen now. */
  function target(): Clip | null {
    const found = findClip(ed.project, ed.selectedId);
    if (!found || found.track !== 'layers') return null;
    const t = ed.time;
    if (t < found.clip.start - 1e-6 || t > clipEnd(found.clip) + 1e-6) return null;
    return found.clip;
  }

  function size(clip: Clip): { width: number; height: number } {
    const media = mediaOf(ed.project, clip);
    const b = baseBox(ed.project, clip, media ? { width: media.width, height: media.height } : null);
    return { width: b.width * clip.transform.scale, height: b.height * clip.transform.scale };
  }

  function update(): void {
    if (!ed.isOpen) return;
    const p = ed.project;
    hint.hidden = p.primary.length + p.layers.length + p.audio.length > 0;
    const clip = ed.player.playing ? null : target();
    box.hidden = !clip;
    if (!clip) return;
    const s = size(clip);
    box.style.width = `${s.width * k}px`;
    box.style.height = `${s.height * k}px`;
    box.style.left = `${clip.transform.x * p.width * k - (s.width * k) / 2}px`;
    box.style.top = `${clip.transform.y * p.height * k - (s.height * k) / 2}px`;
    box.style.transform = `rotate(${clip.transform.rotation}deg)`;
  }

  ed.onChange(fit);
  ed.onSelect(update);
  ed.onTime(update);
  new ResizeObserver(fit).observe(stage);

  // --- gestures ------------------------------------------------------------------------

  const point = (e: PointerEvent): { x: number; y: number } => {
    const r = overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  function hit(x: number, y: number): Clip | null {
    const p = ed.project;
    const layers = visibleAt(p, ed.time).filter((c) => p.layers.includes(c));
    for (const clip of layers.reverse()) {
      const s = size(clip);
      const a = (-clip.transform.rotation * Math.PI) / 180;
      const dx = x - clip.transform.x * p.width;
      const dy = y - clip.transform.y * p.height;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= s.width / 2 + 8 && Math.abs(ly) <= s.height / 2 + 8) return clip;
    }
    return null;
  }

  type Mode = 'move' | 'scale' | 'rotate';
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: {
    id: string;
    mode: Mode | 'pinch';
    start: { x: number; y: number };
    base: { x: number; y: number; scale: number; rotation: number };
    pinch?: { distance: number; angle: number };
    moved: boolean;
  } | null = null;

  const pinchState = (): { distance: number; angle: number } => {
    const [a, b] = [...pointers.values()];
    return { distance: Math.max(10, Math.hypot(b!.x - a!.x, b!.y - a!.y)), angle: Math.atan2(b!.y - a!.y, b!.x - a!.x) };
  };

  function begin(clip: Clip, mode: Mode | 'pinch', at: { x: number; y: number }): void {
    const t = clip.transform;
    drag = { id: clip.id, mode, start: at, base: { x: t.x, y: t.y, scale: t.scale, rotation: t.rotation }, moved: false };
    if (mode === 'pinch') drag.pinch = pinchState();
    ed.begin();
  }

  function end(): void {
    guideV.hidden = guideH.hidden = true;
    if (!drag) return;
    drag = null;
    ed.commit();
  }

  overlay.addEventListener('pointerdown', (e) => {
    if (!ed.isOpen || e.button !== 0) return;
    if (ed.player.playing) {
      ed.player.pause();
      return;
    }
    const at = point(e);
    pointers.set(e.pointerId, at);
    overlay.setPointerCapture(e.pointerId);
    const selected = target();
    if (pointers.size === 2 && selected) {
      // A second finger turns the gesture into pinch-and-turn.
      if (drag) end();
      begin(selected, 'pinch', at);
      return;
    }
    if (pointers.size > 1) return;
    const handle = (e.target as HTMLElement).closest('.handle');
    if (handle && selected) {
      begin(selected, handle === rotateHandle ? 'rotate' : 'scale', at);
      return;
    }
    const clip = hit(at.x, at.y);
    if (clip) {
      ed.select(clip.id);
      begin(clip, 'move', at);
    } else {
      ed.select(null);
    }
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const at = point(e);
    pointers.set(e.pointerId, at);
    if (!drag) return;
    const p = ed.project;
    const found = findClip(p, drag.id);
    if (!found) return;
    const t = found.clip.transform;
    const cx = drag.base.x * p.width;
    const cy = drag.base.y * p.height;
    if (drag.mode === 'move') {
      const dx = at.x - drag.start.x;
      const dy = at.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * k < 4) return;
      drag.moved = true;
      let x = drag.base.x + dx / p.width;
      let y = drag.base.y + dy / p.height;
      // The middle of the frame is a little sticky.
      const sx = Math.abs(x - 0.5) < SNAP;
      const sy = Math.abs(y - 0.5) < SNAP;
      if (sx) x = 0.5;
      if (sy) y = 0.5;
      guideV.hidden = !sx;
      guideH.hidden = !sy;
      t.x = Math.max(-0.5, Math.min(1.5, x));
      t.y = Math.max(-0.5, Math.min(1.5, y));
    } else if (drag.mode === 'scale') {
      const d0 = Math.max(4, Math.hypot(drag.start.x - cx, drag.start.y - cy));
      const d1 = Math.hypot(at.x - cx, at.y - cy);
      t.scale = Math.max(0.03, Math.min(12, drag.base.scale * (d1 / d0)));
    } else if (drag.mode === 'rotate') {
      const a0 = Math.atan2(drag.start.y - cy, drag.start.x - cx);
      const a1 = Math.atan2(at.y - cy, at.x - cx);
      t.rotation = snapAngle(drag.base.rotation + ((a1 - a0) * 180) / Math.PI);
    } else if (drag.pinch && pointers.size >= 2) {
      const now = pinchState();
      t.scale = Math.max(0.03, Math.min(12, drag.base.scale * (now.distance / drag.pinch.distance)));
      t.rotation = snapAngle(drag.base.rotation + ((now.angle - drag.pinch.angle) * 180) / Math.PI);
    }
    ed.live();
  });

  function snapAngle(deg: number): number {
    let a = ((deg % 360) + 360) % 360;
    if (a > 180) a -= 360;
    const near = Math.round(a / 90) * 90;
    return Math.abs(a - near) < 3 ? near : Math.round(a * 10) / 10;
  }

  const release = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (drag && (drag.mode !== 'pinch' || pointers.size < 2)) end();
  };
  overlay.addEventListener('pointerup', release);
  overlay.addEventListener('pointercancel', release);
}
