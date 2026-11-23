import { describe, expect, it } from 'vitest';
import { defaultChroma, makeClip, newProject, parseProject, type Clip, type MediaInfo, type Project } from './model';
import {
  addAudio,
  addKeyframe,
  addLayer,
  clearKeyframes,
  deleteClip,
  editTarget,
  fades,
  gainAt,
  insertPrimary,
  keyframeAt,
  nearAngle,
  overlapOf,
  projectDuration,
  removeKeyframe,
  reorderPrimary,
  setSpeed,
  setTransition,
  splitClip,
  transformAt,
  transitionAt,
  trimEnd,
  trimStart,
  visibleAt,
} from './ops';

function media(id: string, kind: MediaInfo['kind'], duration: number): MediaInfo {
  return { id, kind, name: `${id}.bin`, duration, width: 1920, height: 1080, hasAudio: kind !== 'image', size: 1000, mime: '' };
}

/** Two 10 s videos and a 4 s picture on the main track. */
function sample(): { p: Project; a: Clip; b: Clip; c: Clip } {
  const p = newProject('Test', 1920, 1080);
  p.media.push(media('v', 'video', 30), media('w', 'video', 30), media('i', 'image', 0), media('m', 'audio', 60));
  const a = makeClip('video', 10, { mediaId: 'v' });
  const b = makeClip('video', 10, { mediaId: 'w' });
  const c = makeClip('image', 4, { mediaId: 'i' });
  insertPrimary(p, a, 0);
  insertPrimary(p, b, 0);
  insertPrimary(p, c, 10);
  return { p, a, b, c };
}

function text(p: Project, at: number): Clip {
  const clip = makeClip('text', 2, { text: { text: 'Hi', color: '#ffffff', font: 'Sans', size: 0.1, bold: true, align: 'center', outline: '', background: '' } });
  addLayer(p, clip, at);
  return clip;
}

describe('layers follow the main track', () => {
  it('moves with its clip when an earlier clip is deleted, trimmed or sped up', () => {
    const { p, a } = sample();
    const title = text(p, 12);
    trimEnd(p, a.id, 6);
    expect(title.start).toBe(8);
    setSpeed(p, a.id, 2);
    expect(title.start).toBe(5);
    deleteClip(p, a.id);
    expect(title.start).toBe(2);
  });

  it('moves with its clip when the order changes', () => {
    const { p, b } = sample();
    const title = text(p, 13);
    reorderPrimary(p, b.id, 0);
    expect(b.start).toBe(0);
    expect(title.start).toBe(3);
  });

  it('stays on the same moment of the video when the front of its clip is trimmed', () => {
    const { p, a } = sample();
    const title = text(p, 6);
    trimStart(p, a.id, 4);
    expect(a.offset).toBe(4);
    expect(title.start).toBe(2);
    // Trimming past it leaves it at the start of what remains.
    trimStart(p, a.id, 5);
    expect(title.start).toBe(0);
  });

  it('stays at the cut when its clip is deleted', () => {
    const { p, b, c } = sample();
    const title = text(p, 15);
    deleteClip(p, b.id);
    expect(c.start).toBe(10);
    expect(title.start).toBe(10);
  });

  it('keeps sounds in step too, and what lies past the end keeps its distance', () => {
    const { p, a } = sample();
    const music = makeClip('audio', 5, { mediaId: 'm' });
    addAudio(p, music, 11);
    const late = text(p, 30);
    trimEnd(p, a.id, 5);
    expect(music.start).toBe(6);
    expect(late.start).toBe(25);
  });

  it('gives a layer a lane of its own when following brings two together', () => {
    const { p, a } = sample();
    const one = text(p, 9);
    const two = text(p, 11);
    expect(one.row).toBe(two.row);
    trimEnd(p, a.id, 2);
    expect(one.start).toBe(2);
    expect(two.start).toBe(3);
    expect(one.row).not.toBe(two.row);
  });

  it('leaves everything alone when a clip is split', () => {
    const { p, a } = sample();
    const title = text(p, 7);
    splitClip(p, a.id, 5);
    expect(title.start).toBe(7);
  });
});

describe('transitions', () => {
  it('overlaps the two clips and shortens the video', () => {
    const { p, a, b, c } = sample();
    setTransition(p, b.id, 'crossfade', 2);
    expect(b.start).toBe(8);
    expect(c.start).toBe(18);
    expect(projectDuration(p)).toBe(22);
    expect(visibleAt(p, 7).map((x) => x.id)).toEqual([a.id]);
    expect(visibleAt(p, 9).map((x) => x.id)).toEqual([a.id, b.id]);
    expect(transitionAt(p, 9)).toMatchObject({ type: 'crossfade', progress: 0.5 });
    expect(transitionAt(p, 10)).toBeNull();
    setTransition(p, b.id, null);
    expect(b.start).toBe(10);
    expect(projectDuration(p)).toBe(24);
  });

  it('never takes more than half of either clip', () => {
    const { p, b, c } = sample();
    setTransition(p, c.id, 'slide-left', 5);
    expect(overlapOf(p, 2)).toBe(2);
    setTransition(p, b.id, 'slide-left', 5);
    expect(overlapOf(p, 1)).toBe(5);
    trimEnd(p, b.id, b.start + 3);
    expect(overlapOf(p, 1)).toBe(1.5);
    expect(overlapOf(p, 2)).toBe(1.5);
    for (let i = 1; i < p.primary.length; i++) expect(p.primary[i]!.start).toBeGreaterThanOrEqual(p.primary[i - 1]!.start);
  });

  it('is ignored on the first clip and does not carry over to copies or halves', () => {
    const { p, a, b } = sample();
    setTransition(p, b.id, 'zoom', 1);
    reorderPrimary(p, b.id, 0);
    expect(b.start).toBe(0);
    expect(a.start).toBe(10);
    reorderPrimary(p, b.id, 1);
    const second = splitClip(p, b.id, b.start + 5)!;
    expect(second.transition).toBeUndefined();
    expect(b.transition).toBeDefined();
  });

  it('crosses the sound over with the picture', () => {
    const { p, a, b } = sample();
    setTransition(p, b.id, 'crossfade', 2);
    expect(fades(a, p).fadeOut).toBe(2);
    expect(fades(b, p).fadeIn).toBe(2);
    expect(gainAt(a, 9, p) + gainAt(b, 9, p)).toBeCloseTo(1);
    expect(gainAt(a, 5, p)).toBe(1);
  });

  it('keeps a layer over the clip it belongs to', () => {
    const { p, b } = sample();
    const title = text(p, 14);
    setTransition(p, b.id, 'crossfade', 2);
    expect(title.start).toBe(12);
  });
});

describe('keyframes', () => {
  it('glides between two and holds outside them', () => {
    const { p } = sample();
    const title = text(p, 2);
    addKeyframe(p, title.id, 2);
    const end = editTarget(p, title, 4);
    end.x = 0.9;
    end.opacity = 0;
    expect(title.keyframes).toHaveLength(2);
    expect(transformAt(title, 3).x).toBeCloseTo(0.7);
    expect(transformAt(title, 3).opacity).toBeCloseTo(0.5);
    expect(transformAt(title, 0).x).toBe(0.5);
    expect(transformAt(title, 9).x).toBe(0.9);
  });

  it('changes the plain transform until the first keyframe exists', () => {
    const { p } = sample();
    const title = text(p, 2);
    editTarget(p, title, 3).x = 0.2;
    expect(title.keyframes).toBeUndefined();
    expect(title.transform.x).toBe(0.2);
  });

  it('adds one per moment and removes them again', () => {
    const { p } = sample();
    const title = text(p, 2);
    addKeyframe(p, title.id, 2.5);
    addKeyframe(p, title.id, 2.5);
    expect(title.keyframes).toHaveLength(1);
    expect(keyframeAt(p, title, 2.5)).not.toBeNull();
    editTarget(p, title, 2.5).x = 0.8;
    removeKeyframe(p, title.id, 2.5);
    expect(title.keyframes).toBeUndefined();
    // The layer stays where its last keyframe had it.
    expect(title.transform.x).toBe(0.8);
    addKeyframe(p, title.id, 3);
    clearKeyframes(p, title.id);
    expect(title.keyframes).toBeUndefined();
  });

  it('keeps the animation in place on the timeline through trims and splits', () => {
    const { p } = sample();
    const title = text(p, 2);
    addKeyframe(p, title.id, 2);
    editTarget(p, title, 4).x = 0.9;
    trimStart(p, title.id, 3);
    expect(transformAt(title, 3).x).toBeCloseTo(0.7);
    const second = splitClip(p, title.id, 3.5)!;
    expect(transformAt(second, 3.75).x).toBeCloseTo(0.85);
    expect(transformAt(title, 3.25).x).toBeCloseTo(0.75);
  });

  it('turns the short way round', () => {
    expect(nearAngle(-170, 170)).toBe(190);
    expect(nearAngle(10, 350)).toBe(370);
    expect(nearAngle(90, 0)).toBe(90);
  });
});

describe('reading saved effects', () => {
  it('round-trips keyframes, chroma key, filters, transitions and stickers', () => {
    const { p, b } = sample();
    setTransition(p, b.id, 'wipe-left', 1);
    b.filter = 'Mono';
    b.adjust = { brightness: 0.2, contrast: 0, saturation: -0.5, warmth: 0 };
    const sticker = makeClip('sticker', 3, { sticker: '⭐' });
    addLayer(p, sticker, 1);
    addKeyframe(p, sticker.id, 1);
    editTarget(p, sticker, 2).scale = 2;
    const over = makeClip('image', 3, { mediaId: 'i', chroma: defaultChroma() });
    addLayer(p, over, 5);
    expect(parseProject(JSON.stringify(p))).toEqual(p);
  });

  it('drops what does not belong and pulls values into range', () => {
    const { p, a, b } = sample();
    const raw = JSON.parse(JSON.stringify(p)) as Project;
    Object.assign(raw.primary[1]!, {
      transition: { type: 'explode', duration: 2 },
      filter: 'Nope',
      chroma: defaultChroma(),
      keyframes: [{ t: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }],
      adjust: { brightness: 9, contrast: 'x' },
    });
    Object.assign(raw.primary[0]!, { transition: { type: 'zoom', duration: 99 } });
    raw.layers.push({ ...makeClip('sticker', 2), sticker: '' } as Clip);
    const read = parseProject(JSON.stringify(raw))!;
    const [first, second] = read.primary;
    expect(second!.id).toBe(b.id);
    expect(second!.transition).toBeUndefined();
    expect(second!.filter).toBeUndefined();
    expect(second!.chroma).toBeUndefined();
    expect(second!.keyframes).toBeUndefined();
    expect(second!.adjust).toEqual({ brightness: 1, contrast: 0, saturation: 0, warmth: 0 });
    expect(first!.id).toBe(a.id);
    expect(first!.transition).toEqual({ type: 'zoom', duration: 5 });
    expect(first!.start).toBe(0);
    expect(read.layers).toHaveLength(0);
  });
});
