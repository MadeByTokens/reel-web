// Draws one frame of the project. The preview and the export both use this,
// so what is seen while editing is what ends up in the file.

import { FONT_STACKS, type Clip, type Project, type TextStyle } from '../doc/model';
import { visibleAt } from '../doc/ops';

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

function drawText(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, style: TextStyle, box: Box, frameHeight: number): void {
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

/**
 * Draws the frame at time `t` into a canvas of any size; the project's own
 * width and height only set the proportions.
 */
export function compose(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  p: Project,
  t: number,
  width: number,
  height: number,
  resolve: Resolve,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  const k = width / p.width;
  for (const clip of visibleAt(p, t)) {
    const drawable = clip.kind === 'text' ? null : resolve(clip);
    if (clip.kind !== 'text' && !drawable) continue;
    const box = baseBox(p, clip, drawable);
    const tr = clip.transform;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.translate(tr.x * p.width, tr.y * p.height);
    ctx.rotate((tr.rotation * Math.PI) / 180);
    ctx.scale(tr.scale * (tr.flipH ? -1 : 1), tr.scale * (tr.flipV ? -1 : 1));
    ctx.globalAlpha = tr.opacity;
    if (clip.kind === 'text' && clip.text) drawText(ctx, clip.text, box, p.height);
    else if (drawable) {
      try {
        ctx.drawImage(drawable.source, -box.width / 2, -box.height / 2, box.width, box.height);
      } catch {
        // A video that is not ready yet cannot be drawn; the next frame will have it.
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}
