// Draws one frame of the project. The preview and the export both use this,
// so what is seen while editing is what ends up in the file.

import { FONT_STACKS, type Clip, type Project, type TextStyle } from '../doc/model';
import { transformAt, transitionAt, visibleAt, type ActiveTransition } from '../doc/ops';
import { applyFx, needsFx } from './fx';

export interface Drawable {
  source: CanvasImageSource;
  /** Size of the picture in its own pixels. */
  width: number;
  height: number;
}

export type Resolve = (clip: Clip) => Drawable | null;

/** The size of a clip at scale 1, in frame pixels. */
export interface Box {
  width: number;
  height: number;
}

const LINE = 1.2;
/** The side of a sticker at scale 1, as a fraction of the frame height. */
const STICKER = 0.3;
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function fontOf(style: TextStyle, px: number): string {
  return `${style.bold ? '700' : '400'} ${px}px ${FONT_STACKS[style.font] ?? FONT_STACKS.Sans}`;
}

let measurer: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

export function textBox(style: TextStyle, frameHeight: number): Box {
  if (!measurer) {
    measurer =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1).getContext('2d')
        : document.createElement('canvas').getContext('2d');
  }
  const px = style.size * frameHeight;
  const lines = style.text.split('\n');
  let width = px;
  if (measurer) {
    measurer.font = fontOf(style, px);
    for (const line of lines) width = Math.max(width, measurer.measureText(line).width);
  } else {
    for (const line of lines) width = Math.max(width, line.length * px * 0.6);
  }
  const pad = px * 0.25;
  return { width: width + pad * 2, height: lines.length * px * LINE + pad * 2 };
}

/** The size a clip has at scale 1. Media fits inside the frame (or covers it, with `fill`). */
export function baseBox(p: Project, clip: Clip, natural: Box | null): Box {
  if (clip.kind === 'text' && clip.text) return textBox(clip.text, p.height);
  if (clip.kind === 'sticker') return { width: p.height * STICKER, height: p.height * STICKER };
  if (!natural || !natural.width || !natural.height) return { width: p.width, height: p.height };
  // A clip turned on its side is fitted by its turned shape.
  const sideways = Math.abs((((clip.transform.rotation % 180) + 180) % 180) - 90) < 0.01;
  const nw = sideways ? natural.height : natural.width;
  const nh = sideways ? natural.width : natural.height;
  const fit = Math.min(p.width / nw, p.height / nh);
  const cover = Math.max(p.width / nw, p.height / nh);
  const s = clip.fill ? cover : fit;
  return { width: natural.width * s, height: natural.height * s };
}

function drawText(ctx: Context, style: TextStyle, box: Box, frameHeight: number): void {
  const px = style.size * frameHeight;
  const pad = px * 0.25;
  const lines = style.text.split('\n');
  if (style.background) {
    ctx.fillStyle = style.background;
    const r = px * 0.2;
    ctx.beginPath();
    if ('roundRect' in ctx) ctx.roundRect(-box.width / 2, -box.height / 2, box.width, box.height, r);
    else (ctx as CanvasRenderingContext2D).rect(-box.width / 2, -box.height / 2, box.width, box.height);
    ctx.fill();
  }
  ctx.font = fontOf(style, px);
  ctx.textBaseline = 'middle';
  ctx.textAlign = style.align;
  const x = style.align === 'left' ? -box.width / 2 + pad : style.align === 'right' ? box.width / 2 - pad : 0;
  lines.forEach((line, i) => {
    const y = -box.height / 2 + pad + px * LINE * (i + 0.5);
    if (style.outline) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, px * 0.12);
      ctx.strokeStyle = style.outline;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, x, y);
  });
}

function drawSticker(ctx: Context, glyph: string, box: Box): void {
  ctx.font = `${box.height * 0.8}px ${EMOJI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(glyph);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(glyph, 0, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
}

/** How a transition changes the way one of its two clips is drawn. */
interface Mod {
  /** Shift, in frames. */
  dx: number;
  dy: number;
  alpha: number;
  zoom: number;
  /** Add to what is there instead of covering it: two pictures at alpha a and 1 - a then make an exact mix. */
  add: boolean;
  hidden: boolean;
  /** Only this part of the frame is drawn: left and right edge, as fractions. */
  window: [number, number] | null;
}

const plain = (): Mod => ({ dx: 0, dy: 0, alpha: 1, zoom: 1, add: false, hidden: false, window: null });

function transitionMods(tr: ActiveTransition): { from: Mod; to: Mod; wash: string; washAlpha: number } {
  const from = plain();
  const to = plain();
  const q = tr.progress;
  // Movement eases in and out.
  const e = q * q * (3 - 2 * q);
  let wash = '';
  let washAlpha = 0;
  switch (tr.type) {
    case 'crossfade':
      from.alpha = 1 - q;
      to.alpha = q;
      to.add = true;
      break;
    case 'fade-black':
    case 'fade-white':
      from.hidden = q >= 0.5;
      to.hidden = q < 0.5;
      wash = tr.type === 'fade-black' ? '#000' : '#fff';
      washAlpha = 1 - Math.abs(2 * q - 1);
      break;
    case 'slide-left':
      from.dx = -e;
      to.dx = 1 - e;
      break;
    case 'slide-right':
      from.dx = e;
      to.dx = e - 1;
      break;
    case 'slide-up':
      from.dy = -e;
      to.dy = 1 - e;
      break;
    case 'slide-down':
      from.dy = e;
      to.dy = e - 1;
      break;
    case 'wipe-left':
      to.window = [1 - e, 1];
      break;
    case 'wipe-right':
      to.window = [0, e];
      break;
    case 'zoom':
      from.alpha = 1 - q;
      from.zoom = 1 + 0.8 * e;
      to.alpha = q;
      to.add = true;
      break;
  }
  return { from, to, wash, washAlpha };
}

/**
 * Draws the frame at time `t` into a canvas of any size; the project's own
 * width and height only set the proportions.
 */
export function compose(ctx: Context, p: Project, t: number, width: number, height: number, resolve: Resolve): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  const k = width / p.width;
  const transition = transitionAt(p, t);
  const mods = transition ? transitionMods(transition) : null;
  for (const clip of visibleAt(p, t)) {
    const mod = transition && mods ? (clip === transition.from ? mods.from : clip === transition.to ? mods.to : null) : null;
    if (mod?.hidden) continue;
    const pictured = clip.kind === 'video' || clip.kind === 'image';
    const drawable = pictured ? resolve(clip) : null;
    if (pictured && !drawable) continue;
    const box = baseBox(p, clip, drawable);
    const tr = transformAt(clip, t);
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (mod) {
      if (mod.window) {
        ctx.beginPath();
        ctx.rect(mod.window[0] * p.width, 0, (mod.window[1] - mod.window[0]) * p.width, p.height);
        ctx.clip();
        // The new picture covers the old one even where it does not fill the frame.
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, p.width, p.height);
      }
      ctx.translate(mod.dx * p.width, mod.dy * p.height);
      if (mod.zoom !== 1) {
        ctx.translate(p.width / 2, p.height / 2);
        ctx.scale(mod.zoom, mod.zoom);
        ctx.translate(-p.width / 2, -p.height / 2);
      }
      if (mod.add) ctx.globalCompositeOperation = 'lighter';
    }
    ctx.translate(tr.x * p.width, tr.y * p.height);
    ctx.rotate((tr.rotation * Math.PI) / 180);
    ctx.scale(tr.scale * (tr.flipH ? -1 : 1), tr.scale * (tr.flipV ? -1 : 1));
    ctx.globalAlpha = tr.opacity * (mod?.alpha ?? 1);
    if (clip.kind === 'text' && clip.text) drawText(ctx, clip.text, box, p.height);
    else if (clip.kind === 'sticker' && clip.sticker) drawSticker(ctx, clip.sticker, box);
    else if (drawable) {
      try {
        let source = drawable.source;
        if (needsFx(clip)) {
          // No more pixels than will be seen: the effect then costs the same at any source size.
          const shown = Math.min(1, (box.width * tr.scale * k) / drawable.width);
          source = applyFx(source, clip, Math.max(2, drawable.width * shown), Math.max(2, drawable.height * shown)) ?? source;
        }
        ctx.drawImage(source, -box.width / 2, -box.height / 2, box.width, box.height);
      } catch {
        // A video that is not ready yet cannot be drawn; the next frame will have it.
      }
    }
    ctx.restore();
    if (mods && mods.washAlpha > 0 && transition && clip === (mods.from.hidden ? transition.to : transition.from)) {
      // The colour a fade passes through, over the main track only: layers stay as they are.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = mods.washAlpha;
      ctx.fillStyle = mods.wash;
      ctx.fillRect(0, 0, width, height);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}
