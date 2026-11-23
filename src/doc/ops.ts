// Edits. Every function changes the project in place; the caller takes a
// snapshot first (see history.ts), so nothing here needs to know about undo.

import { MAX_SPEED, MIN_DURATION, MIN_SPEED, newId, type Clip, type MediaInfo, type Project, type TrackName } from './model';

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

export function layoutPrimary(p: Project): void {
  let at = 0;
  for (const clip of p.primary) {
    clip.start = at;
    clip.row = 0;
    at = snap(p, at + clip.duration);
  }
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

/** Adds a clip to the primary track straight after the clip under the playhead. */
export function insertPrimary(p: Project, clip: Clip, playhead: number): void {
  const here = primaryAt(p, playhead);
  const index = here ? here.index + 1 : p.primary.length;
  clip.row = 0;
  p.primary.splice(index, 0, clip);
  layoutPrimary(p);
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
  p[found.track].splice(found.index, 1);
  if (found.track === 'primary') layoutPrimary(p);
  else compactRows(p[found.track]);
}

/** Copies a clip and places the copy straight after it. Returns the copy. */
export function duplicateClip(p: Project, id: string): Clip | null {
  const found = findClip(p, id);
  if (!found) return null;
  const copy: Clip = { ...structuredClone(found.clip), id: newId() };
  if (found.track === 'primary') {
    p.primary.splice(found.index + 1, 0, copy);
    layoutPrimary(p);
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
  if (timed) clip.offset = Math.max(0, clip.offset + delta * clip.speed);
  clip.duration = end - start;
  if (track === 'primary') layoutPrimary(p);
  else clip.start = start;
}

/** Moves the end of a clip to a new timeline time. */
export function trimEnd(p: Project, id: string, to: number): void {
  const found = findClip(p, id);
  if (!found) return;
  const { clip, track } = found;
  let duration = snap(p, to) - clip.start;
  duration = Math.max(MIN_DURATION, Math.min(duration, maxFrames(p, clip)));
  clip.duration = duration;
  if (track === 'primary') layoutPrimary(p);
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
  const [clip] = p.primary.splice(from, 1);
  p.primary.splice(Math.max(0, Math.min(index, p.primary.length)), 0, clip!);
  layoutPrimary(p);
}

/** Changes the speed, keeping the same piece of the source and so changing the length. */
export function setSpeed(p: Project, id: string, speed: number): void {
  const found = findClip(p, id);
  if (!found) return;
  const { clip, track } = found;
  if (clip.kind !== 'video' && clip.kind !== 'audio') return;
  const next = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
  const sourceLength = clip.duration * clip.speed;
  clip.speed = next;
  // Rounded down, so changing speed back and forth can never reach past the piece first chosen.
  clip.duration = Math.max(MIN_DURATION, Math.floor((sourceLength / next) * p.fps + 1e-6) / p.fps);
  clip.duration = Math.min(clip.duration, maxFrames(p, clip));
  if (track === 'primary') layoutPrimary(p);
  else clip.row = freeRow(p[track], clip.start, clip.duration, clip.id, clip.row);
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
  const base = p.primary.length && t < projectEndOfPrimary(p) ? primaryAt(p, t) : null;
  if (base) out.push(base.clip);
  const layers = p.layers.filter((c) => t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6);
  layers.sort((a, b) => a.row - b.row);
  out.push(...layers);
  return out;
}

function projectEndOfPrimary(p: Project): number {
  const last = p.primary[p.primary.length - 1];
  return last ? clipEnd(last) : 0;
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
export function gainAt(clip: Clip, t: number): number {
  const local = t - clip.start;
  const { fadeIn, fadeOut } = fades(clip);
  let g = clip.volume;
  if (fadeIn > 0 && local < fadeIn) g *= Math.max(0, local / fadeIn);
  const left = clip.duration - local;
  if (fadeOut > 0 && left < fadeOut) g *= Math.max(0, left / fadeOut);
  return g;
}

/** The fades as they are applied: shortened together when the clip is too short to hold both. */
export function fades(clip: Clip): { fadeIn: number; fadeOut: number } {
  const total = clip.fadeIn + clip.fadeOut;
  const k = total > clip.duration && total > 0 ? clip.duration / total : 1;
  return { fadeIn: clip.fadeIn * k, fadeOut: clip.fadeOut * k };
}

/** Media files no clip uses any more. */
export function unusedMedia(p: Project): MediaInfo[] {
  const used = new Set(allClips(p).map((c) => c.mediaId));
  return p.media.filter((m) => !used.has(m.id));
}
