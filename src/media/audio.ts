// Sound for the preview. Every clip's audio is decoded a little ahead of the
// playhead and scheduled on one AudioContext, whose clock then drives the
// picture, so sound and picture cannot drift apart.

import type { Clip, Project } from '../doc/model';
import { audibleBetween, clipEnd, gainAt, projectDuration } from '../doc/ops';
import type { MediaLibrary } from './library';

const LEAD = 0.12;
/** How far ahead of the playhead sound is decoded and queued, in seconds. */
const AHEAD = 2.5;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Programs a clip's loudness, with its fades, on a gain parameter. `at` turns
 * a timeline time into the context's time; `from` is where playing starts.
 */
export function scheduleGain(g: AudioParam, clip: Clip, from: number, at: (timeline: number) => number): void {
  const begin = Math.max(from, clip.start);
  g.setValueAtTime(gainAt(clip, begin), at(begin));
  if (clip.fadeIn > 0 && begin < clip.start + clip.fadeIn) {
    const top = Math.min(clip.start + clip.fadeIn, clipEnd(clip));
    g.linearRampToValueAtTime(gainAt(clip, top), at(top));
  }
  if (clip.fadeOut > 0) {
    const fadeStart = Math.max(begin, clipEnd(clip) - clip.fadeOut);
    g.setValueAtTime(gainAt(clip, fadeStart), at(fadeStart));
    g.linearRampToValueAtTime(0, at(clipEnd(clip)));
  }
}

type AudioContextClass = typeof AudioContext;

export class AudioPreview {
  private ctx: AudioContext | null = null;
  private generation = 0;
  private nodes = new Set<AudioBufferSourceNode>();
  private gains = new Map<string, GainNode>();
  private ctxStart = 0;
  private timeStart = 0;

  constructor(private readonly media: MediaLibrary) {}

  /** Must be called from a tap: browsers only let sound start that way. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor: AudioContextClass | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
  }

  /** True when the audio clock is usable as the master clock. */
  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Timeline time according to the audio clock. */
  now(): number {
    if (!this.ctx) return this.timeStart;
    return this.timeStart + Math.max(0, this.ctx.currentTime - this.ctxStart);
  }

  start(p: Project, from: number): void {
    this.stop();
    const ctx = this.ctx;
    if (!ctx) return;
    const generation = this.generation;
    this.timeStart = from;
    this.ctxStart = ctx.currentTime + LEAD;
    for (const clip of audibleBetween(p, from, projectDuration(p) + 1)) {
      void this.feed(ctx, clip, from, generation).catch(() => {
        // A clip whose sound cannot be decoded plays silently.
      });
    }
  }

  private async feed(ctx: AudioContext, clip: Clip, from: number, generation: number): Promise<void> {
    if (!clip.mediaId) return;
    const provider = await this.media.audioProvider(clip.mediaId);
    if (!provider || generation !== this.generation) return;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    this.gains.set(clip.id, gain);
    scheduleGain(gain.gain, clip, from, (t) => Math.max(ctx.currentTime, this.ctxStart + (t - from)));

    const toCtx = (timeline: number): number => this.ctxStart + (timeline - from);
    const srcFrom = clip.offset + Math.max(0, from - clip.start) * clip.speed;
    const srcTo = clip.offset + clip.duration * clip.speed;
    // Wait until the clip is near before decoding anything for it.
    while (generation === this.generation && toCtx(clip.start) - ctx.currentTime > AHEAD) await sleep(100);
    for await (const chunk of provider.chunks(srcFrom, srcTo)) {
      if (generation !== this.generation) return;
      const a = Math.max(chunk.timestamp, srcFrom);
      const b = Math.min(chunk.timestamp + chunk.buffer.duration, srcTo);
      if (b <= a) continue;
      let when = toCtx(clip.start + (a - clip.offset) / clip.speed);
      let offset = a - chunk.timestamp;
      let length = b - a;
      const late = ctx.currentTime - when;
      if (late > 0) {
        // Decoding fell behind: skip the part whose moment has passed.
        offset += late * clip.speed;
        length -= late * clip.speed;
        when = ctx.currentTime;
        if (length <= 0) continue;
      }
      const node = ctx.createBufferSource();
      node.buffer = chunk.buffer;
      node.playbackRate.value = clip.speed;
      node.connect(gain);
      node.start(when, offset, length);
      this.nodes.add(node);
      node.onended = () => this.nodes.delete(node);
      while (generation === this.generation && when - ctx.currentTime > AHEAD) await sleep(100);
    }
  }

  /** Follows a volume change made while playing. */
  setVolume(clip: Clip): void {
    const gain = this.gains.get(clip.id);
    if (gain && this.ctx) gain.gain.setTargetAtTime(clip.muted ? 0 : clip.volume, this.ctx.currentTime, 0.02);
  }

  stop(): void {
    this.generation++;
    for (const node of this.nodes) {
      try {
        node.onended = null;
        node.stop();
        node.disconnect();
      } catch {
        // Already stopped.
      }
    }
    this.nodes.clear();
    for (const gain of this.gains.values()) gain.disconnect();
    this.gains.clear();
  }
}
