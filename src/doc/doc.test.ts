import { describe, expect, it } from 'vitest';
import { makeClip, newProject, parseProject, type Clip, type MediaInfo, type Project } from './model';
import {
  addAudio,
  addLayer,
  audibleBetween,
  deleteClip,
  duplicateClip,
  fades,
  findClip,
  gainAt,
  insertPrimary,
  moveClip,
  projectDuration,
  reorderPrimary,
  setSpeed,
  shiftLayer,
  splitClip,
  trimEnd,
  trimStart,
  unusedMedia,
  visibleAt,
} from './ops';

function media(id: string, kind: MediaInfo['kind'], duration: number, hasAudio = kind !== 'image'): MediaInfo {
  return { id, kind, name: `${id}.bin`, duration, width: 1920, height: 1080, hasAudio, size: 1000, mime: '' };
}

/** A 10 s video, then a 4.5 s picture, on the main track. */
function sample(): { p: Project; video: Clip; photo: Clip } {
  const p = newProject('Test', 1920, 1080);
  p.media.push(media('v', 'video', 10), media('i', 'image', 0), media('a', 'audio', 20));
  const video = makeClip('video', 10, { mediaId: 'v' });
  const photo = makeClip('image', 4.5, { mediaId: 'i' });
  insertPrimary(p, video, 0);
  insertPrimary(p, photo, 10);
  return { p, video, photo };
}

describe('main track', () => {
  it('lays clips end to end', () => {
    const { p, video, photo } = sample();
    expect(p.primary.map((c) => c.id)).toEqual([video.id, photo.id]);
    expect(photo.start).toBe(10);
    expect(projectDuration(p)).toBe(14.5);
  });

  it('inserts after the clip under the playhead', () => {
    const { p, video, photo } = sample();
    const middle = makeClip('image', 2, { mediaId: 'i' });
    insertPrimary(p, middle, 1);
    expect(p.primary.map((c) => c.id)).toEqual([video.id, middle.id, photo.id]);
    expect(photo.start).toBe(12);
    // At a cut the clip that starts there is the one under the playhead.
    const next = makeClip('image', 2, { mediaId: 'i' });
    insertPrimary(p, next, 10);
    expect(p.primary.map((c) => c.id)).toEqual([video.id, middle.id, next.id, photo.id]);
    const last = makeClip('image', 2, { mediaId: 'i' });
    insertPrimary(p, last, 500);
    expect(p.primary[4]!.id).toBe(last.id);
  });

  it('splits a video and keeps the source in step', () => {
    const { p, video, photo } = sample();
    video.offset = 2;
    video.duration = 8;
    const second = splitClip(p, video.id, 3)!;
    expect(video.duration).toBe(3);
    expect(second.start).toBe(3);
    expect(second.offset).toBe(5);
    expect(second.duration).toBe(5);
    expect(photo.start).toBe(8);
    expect(p.primary).toHaveLength(3);
  });

  it('does not split at the very edges', () => {
    const { p, video } = sample();
    expect(splitClip(p, video.id, 0)).toBeNull();
    expect(splitClip(p, video.id, 10)).toBeNull();
    expect(splitClip(p, video.id, 0.02)).toBeNull();
    expect(p.primary).toHaveLength(2);
  });

  it('trims the start and closes the gap', () => {
    const { p, video, photo } = sample();
    trimStart(p, video.id, 4);
    expect(video.offset).toBe(4);
    expect(video.duration).toBe(6);
    expect(video.start).toBe(0);
    expect(photo.start).toBe(6);
  });

  it('cannot trim the start back past the beginning of the file', () => {
    const { p, video } = sample();
    video.offset = 1;
    video.duration = 9;
    trimStart(p, video.id, -5);
    expect(video.offset).toBe(0);
    expect(video.duration).toBe(10);
  });

  it('cannot stretch a video past the end of its file, but a picture can be any length', () => {
    const { p, video, photo } = sample();
    trimEnd(p, video.id, 50);
    expect(video.duration).toBe(10);
    trimEnd(p, photo.id, 100);
    expect(photo.duration).toBe(90);
  });

  it('keeps a minimum length', () => {
    const { p, video } = sample();
    trimEnd(p, video.id, -3);
    expect(video.duration).toBeCloseTo(0.1, 5);
    trimStart(p, video.id, 99);
    expect(video.duration).toBeGreaterThan(0);
  });

  it('reorders and deletes', () => {
    const { p, video, photo } = sample();
    reorderPrimary(p, photo.id, 0);
    expect(p.primary.map((c) => c.id)).toEqual([photo.id, video.id]);
    expect(video.start).toBe(4.5);
    deleteClip(p, photo.id);
    expect(video.start).toBe(0);
    expect(projectDuration(p)).toBe(10);
  });

  it('speed keeps the same piece of the source', () => {
    const { p, video, photo } = sample();
    setSpeed(p, video.id, 2);
    expect(video.duration).toBe(5);
    expect(photo.start).toBe(5);
    const second = splitClip(p, video.id, 2)!;
    expect(second.offset).toBe(4);
    setSpeed(p, video.id, 0.5);
    expect(video.duration).toBe(8);
  });

  it('duplicates straight after the original', () => {
    const { p, video } = sample();
    const copy = duplicateClip(p, video.id)!;
    expect(copy.id).not.toBe(video.id);
    expect(p.primary[1]!.id).toBe(copy.id);
    expect(copy.start).toBe(10);
  });
});

describe('clips whose source does not end on a frame', () => {
  function odd(): { p: Project; video: Clip; photo: Clip } {
    const p = newProject('Odd', 1920, 1080);
    p.media.push(media('v', 'video', 3.35), media('i', 'image', 0));
    const video = makeClip('video', 3.3, { mediaId: 'v' });
    const photo = makeClip('image', 2, { mediaId: 'i' });
    insertPrimary(p, video, 0);
    insertPrimary(p, photo, 5);
    return { p, video, photo };
  }

  it('stretching to the end leaves no hole before the next clip', () => {
    const { p, video, photo } = odd();
    trimEnd(p, video.id, 99);
    expect(video.duration * p.fps).toBeCloseTo(Math.round(video.duration * p.fps), 6);
    expect(video.duration).toBeLessThanOrEqual(3.35);
    expect(photo.start).toBeCloseTo(video.duration, 9);
    for (let t = 0; t < photo.start + 1; t += 1 / 250) expect(visibleAt(p, t)).toHaveLength(1);
  });

  it('even a clip that does end off the frame grid is shown up to the next one', () => {
    const { p, video, photo } = odd();
    video.duration = 3.35;
    photo.start = 3.3667;
    expect(visibleAt(p, 3.36).map((c) => c.id)).toEqual([video.id]);
  });

  it('changing speed there and back never reaches past the piece first chosen', () => {
    const p = newProject('Speed', 1920, 1080);
    p.media.push(media('v', 'video', 60));
    const video = makeClip('video', 10, { mediaId: 'v' });
    insertPrimary(p, video, 0);
    for (const s of [8, 1, 3, 1, 0.25, 1, 1.5, 1]) {
      setSpeed(p, video.id, s);
      expect(video.duration * video.speed).toBeLessThanOrEqual(10 + 1e-9);
    }
    expect(video.duration).toBeGreaterThan(9.5);
    setSpeed(p, video.id, 8);
    setSpeed(p, video.id, 1);
    expect(video.duration).toBeLessThanOrEqual(10);
  });
});

describe('layers and sound', () => {
  it('shortens fades that do not both fit in the clip', () => {
    const clip = makeClip('audio', 4, { mediaId: 'a', fadeIn: 3, fadeOut: 3 });
    expect(fades(clip)).toEqual({ fadeIn: 2, fadeOut: 2 });
    expect(gainAt(clip, 1)).toBeCloseTo(0.5, 5);
    expect(gainAt(clip, 2)).toBeCloseTo(1, 5);
    expect(gainAt(clip, 3)).toBeCloseTo(0.5, 5);
    // Never louder in the middle than at full volume, never a jump.
    let last = 0;
    for (let t = 0; t <= 4; t += 0.05) {
      const g = gainAt(clip, t);
      expect(Math.abs(g - last)).toBeLessThan(0.05);
      last = g;
    }
  });

  it('puts overlapping layers on separate rows', () => {
    const { p } = sample();
    const a = makeClip('text', 4, { text: { text: 'a', color: '#ffffff', font: 'Sans', size: 0.1, bold: true, align: 'center', outline: '', background: '' } });
    const b = makeClip('image', 4, { mediaId: 'i' });
    const c = makeClip('image', 4, { mediaId: 'i' });
    addLayer(p, a, 1);
    addLayer(p, b, 2);
    addLayer(p, c, 6);
    expect([a.row, b.row, c.row]).toEqual([0, 1, 0]);
  });

  it('draws the main clip first, then layers from the bottom row up', () => {
    const { p, video } = sample();
    const a = makeClip('image', 4, { mediaId: 'i' });
    const b = makeClip('image', 4, { mediaId: 'i' });
    addLayer(p, a, 1);
    addLayer(p, b, 2);
    expect(visibleAt(p, 3).map((c) => c.id)).toEqual([video.id, a.id, b.id]);
    shiftLayer(p, a.id, 1);
    expect(visibleAt(p, 3).map((c) => c.id)).toEqual([video.id, b.id, a.id]);
    expect(visibleAt(p, 0.5).map((c) => c.id)).toEqual([video.id]);
  });

  it('shows nothing from the main track after it ends, but layers still show', () => {
    const { p } = sample();
    const late = makeClip('image', 4, { mediaId: 'i' });
    addLayer(p, late, 20);
    expect(visibleAt(p, 21).map((c) => c.id)).toEqual([late.id]);
    expect(projectDuration(p)).toBe(24);
  });

  it('moving a layer onto an occupied row finds a free one', () => {
    const { p } = sample();
    const a = makeClip('image', 4, { mediaId: 'i' });
    const b = makeClip('image', 4, { mediaId: 'i' });
    addLayer(p, a, 0);
    addLayer(p, b, 10);
    expect(b.row).toBe(0);
    moveClip(p, b.id, 2, 0);
    expect(b.start).toBe(2);
    expect(b.row).not.toBe(a.row);
    moveClip(p, b.id, -5);
    expect(b.start).toBe(0);
  });

  it('removes empty rows', () => {
    const { p } = sample();
    const a = makeClip('image', 4, { mediaId: 'i' });
    const b = makeClip('image', 4, { mediaId: 'i' });
    addLayer(p, a, 0);
    addLayer(p, b, 1);
    deleteClip(p, a.id);
    expect(b.row).toBe(0);
  });

  it('splitting a sound clip keeps both halves in place', () => {
    const { p } = sample();
    const a = makeClip('audio', 8, { mediaId: 'a' });
    addAudio(p, a, 2);
    const second = splitClip(p, a.id, 5)!;
    expect(a.duration).toBe(3);
    expect(second.start).toBe(5);
    expect(second.offset).toBe(3);
    expect(findClip(p, second.id)!.track).toBe('audio');
  });

  it('lists what can be heard', () => {
    const { p, video } = sample();
    const a = makeClip('audio', 8, { mediaId: 'a' });
    addAudio(p, a, 12);
    expect(audibleBetween(p, 0, 5).map((c) => c.id)).toEqual([video.id]);
    expect(audibleBetween(p, 11, 13).map((c) => c.id)).toEqual([a.id]);
    video.muted = true;
    expect(audibleBetween(p, 0, 5)).toEqual([]);
    p.media[0]!.hasAudio = false;
    video.muted = false;
    expect(audibleBetween(p, 0, 5)).toEqual([]);
  });

  it('fades in and out', () => {
    const clip = makeClip('audio', 10, { mediaId: 'a', fadeIn: 2, fadeOut: 4, volume: 0.8 });
    clip.start = 5;
    expect(gainAt(clip, 5)).toBe(0);
    expect(gainAt(clip, 6)).toBeCloseTo(0.4, 5);
    expect(gainAt(clip, 8)).toBeCloseTo(0.8, 5);
    expect(gainAt(clip, 13)).toBeCloseTo(0.4, 5);
    expect(gainAt(clip, 15)).toBe(0);
  });

  it('knows which media is no longer used', () => {
    const { p, photo } = sample();
    expect(unusedMedia(p).map((m) => m.id)).toEqual(['a']);
    deleteClip(p, photo.id);
    expect(unusedMedia(p).map((m) => m.id).sort()).toEqual(['a', 'i']);
  });
});

describe('reading a saved project', () => {
  it('round-trips', () => {
    const { p } = sample();
    addLayer(p, makeClip('image', 3, { mediaId: 'i' }), 1);
    addAudio(p, makeClip('audio', 3, { mediaId: 'a' }), 1);
    expect(parseProject(JSON.stringify(p))).toEqual(p);
  });

  it('refuses things that are not projects', () => {
    expect(parseProject('')).toBeNull();
    expect(parseProject('[]')).toBeNull();
    expect(parseProject('{"version":2}')).toBeNull();
    expect(parseProject('{"version":1,"media":[],"primary":{}}')).toBeNull();
  });

  it('drops clips whose media is not listed and pulls values into range', () => {
    const { p, video } = sample();
    const raw = JSON.parse(JSON.stringify(p)) as Project;
    raw.primary.push({ ...makeClip('video', 5), mediaId: 'ghost' });
    raw.primary[0]!.duration = 500;
    raw.primary[0]!.volume = 99;
    raw.primary[0]!.transform.opacity = -3;
    (raw.primary[0]! as unknown as Record<string, unknown>).speed = 'fast';
    const read = parseProject(JSON.stringify(raw))!;
    expect(read.primary).toHaveLength(2);
    expect(read.primary[0]!.id).toBe(video.id);
    expect(read.primary[0]!.duration).toBe(10);
    expect(read.primary[0]!.volume).toBe(2);
    expect(read.primary[0]!.transform.opacity).toBe(0);
    expect(read.primary[0]!.speed).toBe(1);
    expect(read.primary[1]!.start).toBe(10);
  });

  it('refuses clips on the wrong track and repeated ids', () => {
    const { p, video } = sample();
    const raw = JSON.parse(JSON.stringify(p)) as Project;
    raw.audio.push(JSON.parse(JSON.stringify(video)) as Clip);
    raw.layers.push(JSON.parse(JSON.stringify(video)) as Clip);
    const read = parseProject(JSON.stringify(raw))!;
    expect(read.audio).toHaveLength(0);
    expect(read.layers).toHaveLength(0);
  });

  it('keeps ids that could be used as paths out', () => {
    const { p } = sample();
    const raw = JSON.parse(JSON.stringify(p)) as Project;
    raw.media[0]!.id = '../../x';
    expect(parseProject(JSON.stringify(raw))).toBeNull();
  });
});
