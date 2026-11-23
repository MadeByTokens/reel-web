// Edits. Every function changes the project in place; the caller takes a
// snapshot first (see history.ts), so nothing here needs to know about undo.

import {
  MAX_KEYFRAMES,
  MAX_SPEED,
  MAX_TRANSITION,
  MIN_DURATION,
  MIN_SPEED,
  layoutPrimary,
  newId,
  overlapOf,
  type Clip,
  type Keyframe,
  type MediaInfo,
  type Project,
  type TrackName,
  type Transform,
  type TransitionType,
} from './model';

export { layoutPrimary, overlapOf };

export interface Found {
  clip: Clip;
  track: TrackName;
  index: number;
}

const TRACKS: TrackName[] = ['primary', 'layers', 'audio'];

export function findClip(p: Project, id: string | null): Found | null {
  if (!id) return null;
  for (const track of TRACKS) {
    const index = p[track].findIndex((c) => c.id === id);
    if (index >= 0) return { clip: p[track][index]!, track, index };
  }
  return null;
}

export function allClips(p: Project): Clip[] {
  return [...p.primary, ...p.layers, ...p.audio];
}

export function mediaOf(p: Project, clip: Clip): MediaInfo | undefined {
  return clip.mediaId ? p.media.find((m) => m.id === clip.mediaId) : undefined;
}

export const clipEnd = (c: Clip): number => c.start + c.duration;

/** Rounds a time to the nearest frame. */
export function snap(p: Project, t: number): number {
  return Math.round(t * p.fps) / p.fps;
}

export function projectDuration(p: Project): number {
  let end = 0;
  for (const clip of allClips(p)) end = Math.max(end, clipEnd(clip));
  return end;
}

/** The longest a clip may last on the timeline with its current in-point and speed. */
export function maxDuration(p: Project, clip: Clip): number {
  const media = mediaOf(p, clip);
  if (!media || media.kind === 'image') return Infinity;
  return Math.max(MIN_DURATION, (media.duration - clip.offset) / clip.speed);
}

/** The same limit in whole frames, so a clip stretched to its end still ends on a frame. */
function maxFrames(p: Project, clip: Clip): number {
  const max = maxDuration(p, clip);
  return Number.isFinite(max) ? Math.max(MIN_DURATION, Math.floor(max * p.fps + 1e-6) / p.fps) : max;
}

const overlaps = (a: Clip, start: number, duration: number): boolean =>
  a.start < start + duration - 1e-6 && start < clipEnd(a) - 1e-6;

/** The lowest lane where a clip fits without covering another one. */
export function freeRow(list: Clip[], start: number, duration: number, ignore?: string, prefer = 0): number {
  const taken = (row: number): boolean => list.some((c) => c.id !== ignore && c.row === row && overlaps(c, start, duration));
  if (!taken(prefer)) return prefer;
  for (let row = 0; row < 100; row++) if (!taken(row)) return row;
  return 99;
}

/** Removes empty lanes so the timeline never shows a gap between rows. */
export function compactRows(list: Clip[]): void {
  const used = [...new Set(list.map((c) => c.row))].sort((a, b) => a - b);
  for (const clip of list) clip.row = used.indexOf(clip.row);
}

/** The primary clip under a time, and its index. The last clip owns the very end. */
export function primaryAt(p: Project, t: number): Found | null {
  for (let i = 0; i < p.primary.length; i++) {
    const clip = p.primary[i]!;
    // A clip owns everything up to where the next one starts, so rounding never leaves a hole.
    const next = p.primary[i + 1];
    if (!next || t < next.start - 1e-6) {
      if (t >= clip.start - 1e-6) return { clip, track: 'primary', index: i };
    }
  }
  return null;
}

function endOfPrimary(p: Project): number {
  const last = p.primary[p.primary.length - 1];
  return last ? clipEnd(last) : 0;
}

/**
 * Runs a change to the main track and then moves every layer and sound so it
 * stays with the main-track clip it sat over: the same moment of that clip's
 * video where there is one, the same distance from its start otherwise.
 */
export function ripple(p: Project, change: () => void): void {
  const end = endOfPrimary(p);
  const notes = [...p.layers, ...p.audio].map((clip) => {
    const over = clip.start < end - 1e-6 ? primaryAt(p, clip.start) : null;
    if (!over) return { clip, id: null, index: -1, local: clip.start - end, source: null };
    const local = clip.start - over.clip.start;
    const source = over.clip.kind === 'video' ? over.clip.offset + local * over.clip.speed : null;
    return { clip, id: over.clip.id, index: over.index, local, source };
  });
  change();
  layoutPrimary(p);
  const after = endOfPrimary(p);
  for (const note of notes) {
    let start: number;
    const anchor = note.id ? p.primary.find((c) => c.id === note.id) : undefined;
    if (anchor) {
      const local = note.source !== null && anchor.kind === 'video' ? (note.source - anchor.offset) / anchor.speed : note.local;
      start = anchor.start + Math.max(0, Math.min(local, anchor.duration));
    } else if (note.id) {
      // Its clip is gone: stay at the cut, where the next clip now begins.
      start = p.primary[note.index]?.start ?? after;
    } else {
      start = after + note.local;
    }
    note.clip.start = snap(p, Math.max(0, start));
  }
  settleRows(p.layers);
  settleRows(p.audio);
}

/** Moves clips that have come to cover another one in their lane to a free lane. */
function settleRows(list: Clip[]): void {
  const placed: Clip[] = [];
  for (const clip of [...list].sort((a, b) => a.row - b.row || a.start - b.start)) {
    clip.row = freeRow(placed, clip.start, clip.duration, undefined, clip.row);
    placed.push(clip);
  }
  compactRows(list);
}

/** Adds a clip to the primary track straight after the clip under the playhead. */
export function insertPrimary(p: Project, clip: Clip, playhead: number): void {
  const here = primaryAt(p, playhead);
  insertPrimaryAt(p, clip, here ? here.index + 1 : p.primary.length);
}

/** Adds a clip to the primary track at a place in the order. */
export function insertPrimaryAt(p: Project, clip: Clip, index: number): void {
  clip.row = 0;
  ripple(p, () => p.primary.splice(Math.max(0, Math.min(index, p.primary.length)), 0, clip));
}

export function addLayer(p: Project, clip: Clip, start: number): void {
  clip.start = snap(p, Math.max(0, start));
  clip.row = freeRow(p.layers, clip.start, clip.duration);
  p.layers.push(clip);
}

export function addAudio(p: Project, clip: Clip, start: number): void {
  clip.start = snap(p, Math.max(0, start));
  clip.row = freeRow(p.audio, clip.start, clip.duration);
  p.audio.push(clip);
}

export function deleteClip(p: Project, id: string): void {
  const found = findClip(p, id);
  if (!found) return;
  if (found.track === 'primary') ripple(p, () => p.primary.splice(found.index, 1));
  else {
    p[found.track].splice(found.index, 1);
    compactRows(p[found.track]);
  }
}

/** Copies a clip and places the copy straight after it. Returns the copy. */
export function duplicateClip(p: Project, id: string): Clip | null {
  const found = findClip(p, id);
  if (!found) return null;
  const copy: Clip = { ...structuredClone(found.clip), id: newId() };
  if (found.track === 'primary') {
    delete copy.transition;
    ripple(p, () => p.primary.splice(found.index + 1, 0, copy));
  } else {
    copy.start = clipEnd(found.clip);
    copy.row = freeRow(p[found.track], copy.start, copy.duration, undefined, found.clip.row);
    p[found.track].push(copy);
  }
  return copy;
}

/** Cuts a clip in two at a timeline time. Returns the second half, or null if the time is not inside it. */
export function splitClip(p: Project, id: string, at: number): Clip | null {
  const found = findClip(p, id);
  if (!found) return null;
  const { clip, track, index } = found;
  const t = snap(p, at);
  if (t <= clip.start + MIN_DURATION - 1e-6 || t >= clipEnd(clip) - MIN_DURATION + 1e-6) return null;
  const first = t - clip.start;
  const second: Clip = { ...structuredClone(clip), id: newId() };
  second.start = t;
  second.duration = clip.duration - first;
  if (clip.kind === 'video' || clip.kind === 'audio') second.offset = clip.offset + first * clip.speed;
  second.fadeIn = 0;
  delete second.transition;
  // Both halves keep the whole animation, so the cut does not change how the layer moves.
  if (second.keyframes) for (const k of second.keyframes) k.t -= first;
  clip.duration = first;
  clip.fadeOut = 0;
  if (track === 'primary') {
    p.primary.splice(index + 1, 0, second);
    layoutPrimary(p);
  } else {
    p[track].push(second);
  }
  return second;
}

/**
 * Moves the start of a clip to a new timeline time, keeping its end where it
 * is. For video and sound the in-point moves with it. On the primary track the
 * clip simply gets shorter or longer and the rest closes up.
 */
export function trimStart(p: Project, id: string, to: number): void {
  const found = findClip(p, id);
  if (!found) return;
  const { clip, track } = found;
  const end = clipEnd(clip);
  let start = snap(p, to);
  const timed = clip.kind === 'video' || clip.kind === 'audio';
  // Cannot reach back before the beginning of the source.
  const earliest = timed ? clip.start - clip.offset / clip.speed : -Infinity;
  start = Math.max(start, earliest, track === 'primary' ? -Infinity : 0);
  start = Math.min(start, end - MIN_DURATION);
  const delta = start - clip.start;
  const apply = (): void => {
    if (timed) clip.offset = Math.max(0, clip.offset + delta * clip.speed);
    clip.duration = end - start;
  };
  if (track === 'primary') ripple(p, apply);
  else {
    apply();
    clip.start = start;
    // The animation stays where it was on the timeline.
    if (clip.keyframes) for (const k of clip.keyframes) k.t -= delta;
  }
}

/** Moves the end of a clip to a new timeline time. */
export function trimEnd(p: Project, id: string, to: number): void {
  const found = findClip(p, id);
  if (!found) return;
  const { clip, track } = found;
  let duration = snap(p, to) - clip.start;
  duration = Math.max(MIN_DURATION, Math.min(duration, maxFrames(p, clip)));
  if (track === 'primary') ripple(p, () => (clip.duration = duration));
  else clip.duration = duration;
}

/** Moves a layer or sound clip in time and, optionally, to another lane. */
export function moveClip(p: Project, id: string, start: number, row?: number): void {
  const found = findClip(p, id);
  if (!found || found.track === 'primary') return;
  const { clip, track } = found;
  clip.start = snap(p, Math.max(0, start));
  const wanted = Math.max(0, Math.round(row ?? clip.row));
  clip.row = freeRow(p[track], clip.start, clip.duration, clip.id, wanted);
  compactRows(p[track]);
}

/** Moves a primary clip to another place in the order. */
export function reorderPrimary(p: Project, id: string, index: number): void {
  const from = p.primary.findIndex((c) => c.id === id);
  if (from < 0) return;
  ripple(p, () => {
    const [clip] = p.primary.splice(from, 1);
    p.primary.splice(Math.max(0, Math.min(index, p.primary.length)), 0, clip!);
  });
}

/** Changes the speed, keeping the same piece of the source and so changing the length. */
export function setSpeed(p: Project, id: string, speed: number): void {
  const found = findClip(p, id);
  if (!found) return;
  const { clip, track } = found;
  if (clip.kind !== 'video' && clip.kind !== 'audio') return;
  const next = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
  const sourceLength = clip.duration * clip.speed;
  const apply = (): void => {
    if (clip.keyframes) for (const k of clip.keyframes) k.t *= clip.speed / next;
    clip.speed = next;
    // Rounded down, so changing speed back and forth can never reach past the piece first chosen.
    clip.duration = Math.max(MIN_DURATION, Math.floor((sourceLength / next) * p.fps + 1e-6) / p.fps);
    clip.duration = Math.min(clip.duration, maxFrames(p, clip));
  };
  if (track === 'primary') ripple(p, apply);
  else {
    apply();
    clip.row = freeRow(p[track], clip.start, clip.duration, clip.id, clip.row);
  }
}

/** Sets or, with null, removes the transition into a main-track clip. */
export function setTransition(p: Project, id: string, type: TransitionType | null, duration?: number): void {
  const found = findClip(p, id);
  if (!found || found.track !== 'primary') return;
  const { clip } = found;
  ripple(p, () => {
    if (!type) delete clip.transition;
    else {
      const wanted = duration ?? clip.transition?.duration ?? 1;
      clip.transition = { type, duration: Math.max(MIN_DURATION, Math.min(MAX_TRANSITION, wanted)) };
    }
  });
}

export interface ActiveTransition {
  from: Clip;
  to: Clip;
  type: TransitionType;
  /** 0 when it begins, 1 when the new clip has taken over. */
  progress: number;
}

/** The transition in progress at a time, if any. */
export function transitionAt(p: Project, t: number): ActiveTransition | null {
  const here = primaryAt(p, t);
  if (!here || here.index === 0 || !here.clip.transition) return null;
  const length = overlapOf(p, here.index);
  if (length <= 0 || t >= here.clip.start + length - 1e-6) return null;
  const progress = Math.max(0, Math.min(1, (t - here.clip.start) / length));
  return { from: p.primary[here.index - 1]!, to: here.clip, type: here.clip.transition.type, progress };
}

// --- keyframes -------------------------------------------------------------------------

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** A clip's place, size, turn and opacity at a timeline time, with its animation applied. */
export function transformAt(clip: Clip, t: number): Transform {
  const frames = clip.keyframes;
  if (!frames?.length) return clip.transform;
  const local = t - clip.start;
  let before = frames[0]!;
  let next = frames[frames.length - 1]!;
  if (local <= before.t) next = before;
  else if (local >= next.t) before = next;
  else {
    for (let i = 1; i < frames.length; i++) {
      if (frames[i]!.t >= local) {
        before = frames[i - 1]!;
        next = frames[i]!;
        break;
      }
    }
  }
  const span = next.t - before.t;
  const k = span > 1e-9 ? (local - before.t) / span : 0;
  return {
    ...clip.transform,
    x: lerp(before.x, next.x, k),
    y: lerp(before.y, next.y, k),
    scale: lerp(before.scale, next.scale, k),
    rotation: lerp(before.rotation, next.rotation, k),
    opacity: lerp(before.opacity, next.opacity, k),
  };
}

/** Where on a clip a timeline time falls, in whole frames from its start. */
function localTime(p: Project, clip: Clip, t: number): number {
  return snap(p, Math.max(0, Math.min(t - clip.start, clip.duration)));
}

/** The keyframe a clip has at a timeline time, to within half a frame. */
export function keyframeAt(p: Project, clip: Clip, t: number): Keyframe | null {
  const local = t - clip.start;
  return clip.keyframes?.find((k) => Math.abs(k.t - local) < 0.5 / p.fps) ?? null;
}

/** Adds a keyframe holding what the layer looks like at that time. Returns it, or the one already there. */
export function addKeyframe(p: Project, id: string, t: number): Keyframe | null {
  const found = findClip(p, id);
  if (!found || found.track !== 'layers') return null;
  const { clip } = found;
  const existing = keyframeAt(p, clip, t);
  if (existing) return existing;
  if ((clip.keyframes?.length ?? 0) >= MAX_KEYFRAMES) return null;
  const now = transformAt(clip, t);
  const frame: Keyframe = { t: localTime(p, clip, t), x: now.x, y: now.y, scale: now.scale, rotation: now.rotation, opacity: now.opacity };
  clip.keyframes = [...(clip.keyframes ?? []), frame].sort((a, b) => a.t - b.t);
  return frame;
}

/** Removes the keyframe at a time. When the last one goes, the layer keeps how it looked there. */
export function removeKeyframe(p: Project, id: string, t: number): void {
  const clip = findClip(p, id)?.clip;
  const frame = clip && keyframeAt(p, clip, t);
  if (!clip || !frame) return;
  clip.keyframes = clip.keyframes!.filter((k) => k !== frame);
  if (!clip.keyframes.length) {
    Object.assign(clip.transform, { x: frame.x, y: frame.y, scale: frame.scale, rotation: frame.rotation, opacity: frame.opacity });
    delete clip.keyframes;
  }
}

/** Removes the whole animation; the layer goes back to how it was before it had one. */
export function clearKeyframes(p: Project, id: string): void {
  const clip = findClip(p, id)?.clip;
  if (clip) delete clip.keyframes;
}

/**
 * What to change when a layer is moved, resized, turned or faded at a time:
 * the clip's own transform, or, once it is animated, the keyframe at that
 * time (made on the spot if there is none).
 */
export function editTarget(p: Project, clip: Clip, t: number): Pick<Transform, 'x' | 'y' | 'scale' | 'rotation' | 'opacity'> {
  if (!clip.keyframes?.length) return clip.transform;
  return addKeyframe(p, clip.id, t) ?? clip.transform;
}

/** The same angle as `value`, written as the number nearest to `reference`, so a glide between them takes the short way round. */
export function nearAngle(value: number, reference: number): number {
  return value - Math.round((value - reference) / 360) * 360;
}

/** The turn of the keyframe before a time (or, failing that, after it), for nearAngle. */
export function neighbourRotation(clip: Clip, t: number): number | null {
  const frames = clip.keyframes;
  if (!frames?.length) return null;
  const local = t - clip.start;
  const earlier = frames.filter((k) => k.t < local - 1e-6);
  const other = earlier.length ? earlier[earlier.length - 1] : frames.find((k) => k.t > local + 1e-6);
  return other ? other.rotation : null;
}

/** The keyframe times of a clip, as timeline times. */
export function keyframeTimes(clip: Clip): number[] {
  return (clip.keyframes ?? []).map((k) => clip.start + k.t);
}

/** Changes which lane is drawn on top by swapping a layer's lane with its neighbour. */
export function shiftLayer(p: Project, id: string, direction: 1 | -1): void {
  const found = findClip(p, id);
  if (!found || found.track !== 'layers') return;
  const { clip } = found;
  const rows = Math.max(...p.layers.map((c) => c.row));
  const target = clip.row + direction;
  if (target < 0 || target > rows) return;
  const from = clip.row;
  for (const other of p.layers) {
    if (other.row === target) other.row = from;
    else if (other.row === from) other.row = target;
  }
}

/** Everything drawn at a time, bottom first. */
export function visibleAt(p: Project, t: number): Clip[] {
  const out: Clip[] = [];
  const base = p.primary.length && t < endOfPrimary(p) ? primaryAt(p, t) : null;
  // During a transition the clip being left is still on screen, under the one taking over.
  const leaving = base ? transitionAt(p, t) : null;
  if (leaving) out.push(leaving.from);
  if (base) out.push(base.clip);
  const layers = p.layers.filter((c) => t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6);
  layers.sort((a, b) => a.row - b.row);
  out.push(...layers);
  return out;
}

/** Clips that make sound and overlap a stretch of time. */
export function audibleBetween(p: Project, from: number, to: number): Clip[] {
  return allClips(p).filter((c) => {
    if (c.muted || c.volume <= 0) return false;
    if (c.kind !== 'video' && c.kind !== 'audio') return false;
    if (c.kind === 'video' && !mediaOf(p, c)?.hasAudio) return false;
    return c.start < to && from < clipEnd(c);
  });
}

/** The loudness of a clip at a timeline time, with its fades applied. */
export function gainAt(clip: Clip, t: number, p?: Project): number {
  const local = t - clip.start;
  const { fadeIn, fadeOut } = fades(clip, p);
  let g = clip.volume;
  if (fadeIn > 0 && local < fadeIn) g *= Math.max(0, local / fadeIn);
  const left = clip.duration - local;
  if (fadeOut > 0 && left < fadeOut) g *= Math.max(0, left / fadeOut);
  return g;
}

/**
 * The fades as they are applied: shortened together when the clip is too short
 * to hold both. Given the project, a main-track clip also fades across its
 * transitions, so the sound of two clips crosses over with their pictures.
 */
export function fades(clip: Clip, p?: Project): { fadeIn: number; fadeOut: number } {
  let { fadeIn, fadeOut } = clip;
  const index = p ? p.primary.findIndex((c) => c.id === clip.id) : -1;
  if (p && index >= 0) {
    fadeIn = Math.max(fadeIn, overlapOf(p, index));
    fadeOut = Math.max(fadeOut, overlapOf(p, index + 1));
  }
  const total = fadeIn + fadeOut;
  const k = total > clip.duration && total > 0 ? clip.duration / total : 1;
  return { fadeIn: fadeIn * k, fadeOut: fadeOut * k };
}

/** Media files no clip uses any more. */
export function unusedMedia(p: Project): MediaInfo[] {
  const used = new Set(allClips(p).map((c) => c.mediaId));
  return p.media.filter((m) => !used.has(m.id));
}
