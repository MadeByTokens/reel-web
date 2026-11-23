// The project: a non-destructive edit list. Source media is never changed;
// every clip only says which part of which file is shown when, and how.

export type ClipKind = 'video' | 'image' | 'text' | 'sticker' | 'audio';
export type TrackName = 'primary' | 'layers' | 'audio';

export interface MediaInfo {
  id: string;
  kind: 'video' | 'image' | 'audio';
  name: string;
  /** Seconds; 0 for pictures. */
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  /** Bytes, shown in the storage readout. */
  size: number;
  /** Content type the file arrived with, e.g. video/mp4. */
  mime: string;
}

export interface Transform {
  /** Centre of the clip, as a fraction of the frame (0.5, 0.5 is the middle). */
  x: number;
  y: number;
  /** 1 fits the clip to the frame. */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  flipH: boolean;
  flipV: boolean;
}

export interface TextStyle {
  text: string;
  color: string;
  /** One of FONTS. */
  font: string;
  /** Height of a line as a fraction of the frame height. */
  size: number;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  /** Outline colour, or '' for none. */
  outline: string;
  /** Box colour behind the text, or '' for none. */
  background: string;
}

/** One moment of a layer's animation. Between two of them the values glide. */
export interface Keyframe {
  /** Seconds after the start of the clip. */
  t: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

/** Makes one colour of a layer see-through (green screen). */
export interface Chroma {
  /** The colour removed. */
  color: string;
  /** How far from that colour still counts, 0 to 1. */
  threshold: number;
  /** How soft the edge is, 0 to 1. */
  smooth: number;
}

/** Colour changes; every value runs from -1 to 1 and 0 leaves the picture alone. */
export interface Adjust {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
}

export const TRANSITIONS = [
  'crossfade',
  'fade-black',
  'fade-white',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'wipe-left',
  'wipe-right',
  'zoom',
] as const;
export type TransitionType = (typeof TRANSITIONS)[number];

/** How a main-track clip takes over from the one before it. The two overlap for its length. */
export interface Transition {
  type: TransitionType;
  duration: number;
}

/** Ready-made looks. */
export const FILTERS = ['Vivid', 'Bright', 'Warm', 'Cool', 'Faded', 'Vintage', 'Sepia', 'Mono', 'Noir'] as const;

export interface Clip {
  id: string;
  kind: ClipKind;
  /** Missing for text. */
  mediaId?: string;
  /** Seconds on the timeline. On the primary track this is derived from the order. */
  start: number;
  /** Seconds on the timeline. */
  duration: number;
  /** Where in the source the clip begins, in source seconds. */
  offset: number;
  /** Source seconds per timeline second. */
  speed: number;
  /** Lane within the layers or audio area; 0 on the primary track. */
  row: number;
  volume: number;
  muted: boolean;
  /** Seconds of audio fade at each end. */
  fadeIn: number;
  fadeOut: number;
  /** Primary track only: fill the frame (crop) instead of fitting inside it. */
  fill: boolean;
  transform: Transform;
  text?: TextStyle;
  /** The picture of a sticker: one emoji. */
  sticker?: string;
  /** Layers only. When present and not empty, these replace the place, size, turn and opacity in `transform`. Sorted by time. */
  keyframes?: Keyframe[];
  /** Layers only. */
  chroma?: Chroma;
  /** One of FILTERS. */
  filter?: string;
  adjust?: Adjust;
  /** Main track only; ignored on the first clip. */
  transition?: Transition;
}

export interface Project {
  version: 1;
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Seconds a picture lasts when it is added. */
  photoDuration: number;
  created: number;
  modified: number;
  media: MediaInfo[];
  /** Clips played one after another with no gaps. */
  primary: Clip[];
  /** Pictures, videos and text placed over the primary track. A higher row is drawn on top. */
  layers: Clip[];
  /** Music, voice and sound clips. */
  audio: Clip[];
}

export const FONTS = ['Sans', 'Serif', 'Rounded', 'Mono', 'Hand'] as const;

/** CSS font stacks that need no download. */
export const FONT_STACKS: Record<string, string> = {
  Sans: 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  Serif: 'Georgia, "Times New Roman", serif',
  Rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Varela Round", system-ui, sans-serif',
  Mono: 'ui-monospace, Menlo, Consolas, monospace',
  Hand: '"Bradley Hand", "Marker Felt", "Comic Sans MS", cursive',
};

export interface Aspect {
  label: string;
  width: number;
  height: number;
}

export const ASPECTS: Aspect[] = [
  { label: '16:9', width: 1920, height: 1080 },
  { label: '9:16', width: 1080, height: 1920 },
  { label: '1:1', width: 1080, height: 1080 },
  { label: '4:3', width: 1440, height: 1080 },
  { label: '3:4', width: 1080, height: 1440 },
  { label: '4:5', width: 1080, height: 1350 },
  { label: '2.35:1', width: 1920, height: 816 },
];

export const MIN_DURATION = 0.1;
export const MAX_SPEED = 8;
export const MIN_SPEED = 0.125;
export const MAX_TRANSITION = 5;
export const MAX_KEYFRAMES = 200;

/** How long a main-track clip overlaps the one before it: its transition, cut down to what both clips can spare. */
export function overlapOf(p: Project, index: number): number {
  const clip = p.primary[index];
  const prev = p.primary[index - 1];
  if (!clip?.transition || !prev) return 0;
  const most = Math.min(prev.duration, clip.duration) / 2;
  return Math.max(0, Math.floor(Math.min(clip.transition.duration, most) * p.fps + 1e-6) / p.fps);
}

/** Places the main-track clips one after another, each starting where the last ends less its transition. */
export function layoutPrimary(p: Project): void {
  let at = 0;
  p.primary.forEach((clip, index) => {
    clip.start = Math.max(0, Math.round((at - overlapOf(p, index)) * p.fps) / p.fps);
    clip.row = 0;
    at = clip.start + clip.duration;
  });
}

export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function defaultTransform(): Transform {
  return { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false };
}

export function defaultText(text: string): TextStyle {
  return { text, color: '#ffffff', font: 'Sans', size: 0.1, bold: true, align: 'center', outline: '#000000', background: '' };
}

export function defaultChroma(): Chroma {
  return { color: '#00d000', threshold: 0.4, smooth: 0.2 };
}

export function defaultAdjust(): Adjust {
  return { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
}

export function newProject(name: string, width: number, height: number): Project {
  const now = Date.now();
  return {
    version: 1,
    name,
    width,
    height,
    fps: 30,
    photoDuration: 4.5,
    created: now,
    modified: now,
    media: [],
    primary: [],
    layers: [],
    audio: [],
  };
}

export function makeClip(kind: ClipKind, duration: number, extra: Partial<Clip> = {}): Clip {
  return {
    id: newId(),
    kind,
    start: 0,
    duration,
    offset: 0,
    speed: 1,
    row: 0,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    fill: false,
    transform: defaultTransform(),
    ...extra,
  };
}

// --- reading a saved project -------------------------------------------------------

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const str = (v: unknown, max: number, fallback: string): string => (typeof v === 'string' ? v.slice(0, max) : fallback);
const color = (v: unknown, fallback: string): string =>
  typeof v === 'string' && (v === '' || /^#[0-9a-fA-F]{6}$/.test(v)) ? v : fallback;
const idOk = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v);

const MAX_TIME = 6 * 3600;

function readClip(raw: unknown, media: Map<string, MediaInfo>, track: TrackName): Clip | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (kind !== 'video' && kind !== 'image' && kind !== 'text' && kind !== 'sticker' && kind !== 'audio') return null;
  if (!idOk(r.id)) return null;
  if ((track === 'audio') !== (kind === 'audio')) return null;
  if (track === 'primary' && (kind === 'text' || kind === 'sticker')) return null;
  let source: MediaInfo | undefined;
  if (kind !== 'text' && kind !== 'sticker') {
    if (!idOk(r.mediaId)) return null;
    source = media.get(r.mediaId);
    if (!source || source.kind !== kind) return null;
  }
  const t = (typeof r.transform === 'object' && r.transform !== null ? r.transform : {}) as Record<string, unknown>;
  const clip: Clip = {
    id: r.id,
    kind,
    start: num(r.start, 0, MAX_TIME, 0),
    duration: num(r.duration, MIN_DURATION, MAX_TIME, 1),
    offset: num(r.offset, 0, MAX_TIME, 0),
    speed: num(r.speed, MIN_SPEED, MAX_SPEED, 1),
    row: Math.round(num(r.row, 0, 99, 0)),
    volume: num(r.volume, 0, 2, 1),
    muted: r.muted === true,
    fadeIn: num(r.fadeIn, 0, 30, 0),
    fadeOut: num(r.fadeOut, 0, 30, 0),
    fill: r.fill === true,
    transform: {
      x: num(t.x, -2, 3, 0.5),
      y: num(t.y, -2, 3, 0.5),
      scale: num(t.scale, 0.02, 20, 1),
      rotation: num(t.rotation, -3600, 3600, 0),
      opacity: num(t.opacity, 0, 1, 1),
      flipH: t.flipH === true,
      flipV: t.flipV === true,
    },
  };
  if (source) {
    clip.mediaId = source.id;
    if (source.kind !== 'image') {
      // A clip can never show more than its source holds.
      clip.offset = Math.min(clip.offset, Math.max(0, source.duration - MIN_DURATION));
      clip.duration = Math.max(MIN_DURATION, Math.min(clip.duration, (source.duration - clip.offset) / clip.speed));
    }
  }
  if (kind === 'text') {
    const s = (typeof r.text === 'object' && r.text !== null ? r.text : {}) as Record<string, unknown>;
    const d = defaultText('Text');
    clip.text = {
      text: str(s.text, 2000, d.text),
      color: color(s.color, d.color) || d.color,
      font: typeof s.font === 'string' && s.font in FONT_STACKS ? s.font : d.font,
      size: num(s.size, 0.01, 1, d.size),
      bold: s.bold !== false,
      align: s.align === 'left' || s.align === 'right' ? s.align : 'center',
      outline: color(s.outline, d.outline),
      background: color(s.background, d.background),
    };
  }
  if (kind === 'sticker') {
    if (typeof r.sticker !== 'string' || !r.sticker || r.sticker.length > 32) return null;
    clip.sticker = r.sticker;
  }
  const pictured = kind === 'video' || kind === 'image';
  if (track === 'layers' && Array.isArray(r.keyframes)) {
    const frames: Keyframe[] = [];
    for (const item of r.keyframes.slice(0, MAX_KEYFRAMES) as unknown[]) {
      if (typeof item !== 'object' || item === null) continue;
      const k = item as Record<string, unknown>;
      if (typeof k.t !== 'number' || !Number.isFinite(k.t)) continue;
      frames.push({
        t: num(k.t, -MAX_TIME, MAX_TIME, 0),
        x: num(k.x, -2, 3, 0.5),
        y: num(k.y, -2, 3, 0.5),
        scale: num(k.scale, 0.02, 20, 1),
        rotation: num(k.rotation, -3600, 3600, 0),
        opacity: num(k.opacity, 0, 1, 1),
      });
    }
    frames.sort((a, b) => a.t - b.t);
    if (frames.length) clip.keyframes = frames;
  }
  if (track === 'layers' && pictured && typeof r.chroma === 'object' && r.chroma !== null) {
    const c = r.chroma as Record<string, unknown>;
    const d = defaultChroma();
    clip.chroma = { color: color(c.color, d.color) || d.color, threshold: num(c.threshold, 0, 1, d.threshold), smooth: num(c.smooth, 0, 1, d.smooth) };
  }
  if (pictured && typeof r.filter === 'string' && (FILTERS as readonly string[]).includes(r.filter)) clip.filter = r.filter;
  if (pictured && typeof r.adjust === 'object' && r.adjust !== null) {
    const a = r.adjust as Record<string, unknown>;
    clip.adjust = {
      brightness: num(a.brightness, -1, 1, 0),
      contrast: num(a.contrast, -1, 1, 0),
      saturation: num(a.saturation, -1, 1, 0),
      warmth: num(a.warmth, -1, 1, 0),
    };
  }
  if (track === 'primary' && typeof r.transition === 'object' && r.transition !== null) {
    const x = r.transition as Record<string, unknown>;
    if ((TRANSITIONS as readonly string[]).includes(x.type as string)) {
      clip.transition = { type: x.type as TransitionType, duration: num(x.duration, MIN_DURATION, MAX_TRANSITION, 1) };
    }
  }
  return clip;
}

/**
 * Checks a saved project and returns a clean copy, or null when the text is
 * not a project. Values out of range are pulled back in; clips that point at
 * media the project does not list are dropped.
 */
export function parseProject(text: string): Project | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return null;
  if (!Array.isArray(r.media) || !Array.isArray(r.primary) || !Array.isArray(r.layers) || !Array.isArray(r.audio)) return null;
  if (r.media.length > 2000 || r.primary.length + r.layers.length + r.audio.length > 5000) return null;

  const media = new Map<string, MediaInfo>();
  for (const m of r.media as unknown[]) {
    if (typeof m !== 'object' || m === null) return null;
    const x = m as Record<string, unknown>;
    if (!idOk(x.id) || (x.kind !== 'video' && x.kind !== 'image' && x.kind !== 'audio')) return null;
    media.set(x.id, {
      id: x.id,
      kind: x.kind,
      name: str(x.name, 200, 'media'),
      duration: num(x.duration, 0, MAX_TIME, 0),
      width: Math.round(num(x.width, 0, 16384, 0)),
      height: Math.round(num(x.height, 0, 16384, 0)),
      hasAudio: x.hasAudio === true,
      size: num(x.size, 0, Number.MAX_SAFE_INTEGER, 0),
      mime: typeof x.mime === 'string' && /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,60}$/i.test(x.mime) ? x.mime : '',
    });
  }
  const ids = new Set<string>();
  const clips = (list: unknown[], track: TrackName): Clip[] => {
    const out: Clip[] = [];
    for (const item of list) {
      const clip = readClip(item, media, track);
      if (!clip || ids.has(clip.id)) continue;
      ids.add(clip.id);
      out.push(clip);
    }
    return out;
  };
  const project: Project = {
    version: 1,
    name: str(r.name, 60, 'Project') || 'Project',
    width: Math.round(num(r.width, 16, 4096, 1920)) & ~1,
    height: Math.round(num(r.height, 16, 4096, 1080)) & ~1,
    fps: Math.round(num(r.fps, 1, 60, 30)),
    photoDuration: num(r.photoDuration, 0.5, 60, 4.5),
    created: num(r.created, 0, Number.MAX_SAFE_INTEGER, 0),
    modified: num(r.modified, 0, Number.MAX_SAFE_INTEGER, 0),
    media: [...media.values()],
    primary: clips(r.primary, 'primary'),
    layers: clips(r.layers, 'layers'),
    audio: clips(r.audio, 'audio'),
  };
  layoutPrimary(project);
  return project;
}
