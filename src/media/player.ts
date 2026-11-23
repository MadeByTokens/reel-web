// The preview: keeps one muted <video> per nearby video clip in step with the
// playhead, and paints the composed frame on the preview canvas.

import type { Clip, Project } from '../doc/model';
import { clipEnd, projectDuration } from '../doc/ops';
import { compose, type Drawable } from '../render/compose';
import { AudioPreview } from './audio';
import { makeVideoElement, type MediaLibrary } from './library';

/** Clips this close to the playhead get a player ready before they are needed. */
const WARM_BEFORE = 1.5;
const WARM_AFTER = 0.5;
/** While playing, a video this far from where it should be is pulled back. */
const DRIFT = 0.2;

export interface PlayerStats {
  /** Frames painted and frames skipped since the last reset. */
  painted: number;
  slow: number;
  /** Times a video had to be re-seeked while playing. */
  resyncs: number;
  lastSeekMs: number;
  videos: number;
}

export class Player {
  time = 0;
  playing = false;
  readonly audio: AudioPreview;
  readonly stats: PlayerStats = { painted: 0, slow: 0, resyncs: 0, lastSeekMs: 0, videos: 0 };
  /** Called whenever the playhead moves because of playback. */
  onTime: (t: number) => void = () => {};
  onPlayState: (playing: boolean) => void = () => {};
  /** Called after each paint, for overlays that follow the picture. */
  onPaint: () => void = () => {};

  private readonly ctx: CanvasRenderingContext2D;
  private readonly videos = new Map<string, { el: HTMLVideoElement; seekStarted: number; primed: boolean }>();
  private dirty = true;
  private raf = 0;
  private wallStart = 0;
  private timeStart = 0;
  private lastFrame = 0;
  private stopped = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly project: () => Project,
    private readonly media: MediaLibrary,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.audio = new AudioPreview(media);
    this.raf = requestAnimationFrame(this.frame);
  }

  invalidate(): void {
    this.dirty = true;
  }

  seek(t: number): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.time = Math.max(0, Math.min(t, projectDuration(this.project())));
    this.dirty = true;
  }

  play(): void {
    if (this.playing) return;
    const p = this.project();
    const end = projectDuration(p);
    if (end <= 0) return;
    if (this.time >= end - 1 / p.fps) this.time = 0;
    this.playing = true;
    this.audio.unlock();
    this.audio.start(p, this.time);
    this.wallStart = performance.now();
    this.timeStart = this.time;
    this.onPlayState(true);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.audio.stop();
    for (const { el } of this.videos.values()) el.pause();
    const p = this.project();
    this.time = Math.round(this.time * p.fps) / p.fps;
    this.dirty = true;
    this.onPlayState(false);
    this.onTime(this.time);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** The picture for a clip right now, for the compositor. */
  private readonly resolve = (clip: Clip): Drawable | null => {
    const item = this.media.get(clip.mediaId);
    if (!item) return null;
    if (clip.kind === 'image') {
      return item.image ? { source: item.image, width: item.image.width, height: item.image.height } : null;
    }
    const video = this.videos.get(clip.id)?.el;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    return { source: video, width: video.videoWidth, height: video.videoHeight };
  };

  private sourceTime(clip: Clip, t: number): number {
    const item = this.media.get(clip.mediaId);
    const local = Math.max(0, Math.min(t - clip.start, clip.duration));
    const max = item ? Math.max(0, item.info.duration - 0.03) : Infinity;
    return Math.min(clip.offset + local * clip.speed, max);
  }

  /** Creates, positions and releases the video players for the clips around the playhead. */
  private syncVideos(p: Project): boolean {
    const t = this.time;
    const wanted = new Set<string>();
    let busy = false;
    for (const clip of [...p.primary, ...p.layers]) {
      if (clip.kind !== 'video') continue;
      if (t < clip.start - WARM_BEFORE || t > clipEnd(clip) + WARM_AFTER) continue;
      const item = this.media.get(clip.mediaId);
      if (!item) continue;
      wanted.add(clip.id);
      let entry = this.videos.get(clip.id);
      if (!entry) {
        const el = makeVideoElement(item.url);
        const mark = (): void => {
          const e = this.videos.get(clip.id);
          if (e && e.seekStarted) {
            this.stats.lastSeekMs = performance.now() - e.seekStarted;
            e.seekStarted = 0;
          }
          this.dirty = true;
        };
        el.addEventListener('seeked', mark);
        el.addEventListener('loadeddata', mark);
        el.addEventListener('canplay', mark);
        entry = { el, seekStarted: 0, primed: false };
        this.videos.set(clip.id, entry);
      }
      const { el } = entry;
      const active = t >= clip.start && t < clipEnd(clip);
      const target = this.sourceTime(clip, t);
      if (el.readyState < 1) {
        busy = true;
        continue;
      }
      if (!entry.primed) {
        // Some tablets load no picture data until a video has played: start it, and the
        // lines below stop it again on the next frame unless it should be playing.
        entry.primed = true;
        void el.play().catch(() => {});
        busy = true;
        continue;
      }
      if (this.playing && active) {
        if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed;
        if (el.paused) {
          if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
          void el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - target) > DRIFT * Math.max(1, clip.speed) && !el.seeking) {
          el.currentTime = target;
          this.stats.resyncs++;
        }
      } else {
        if (!el.paused) el.pause();
        if (el.seeking) busy = true;
        else if (Math.abs(el.currentTime - target) > 0.4 / p.fps) {
          entry.seekStarted = performance.now();
          el.currentTime = target;
          busy = true;
        }
      }
    }
    for (const [id, entry] of this.videos) {
      if (wanted.has(id)) continue;
      entry.el.pause();
      entry.el.removeAttribute('src');
      entry.el.load();
      this.videos.delete(id);
    }
    this.stats.videos = this.videos.size;
    return busy;
  }

  private readonly frame = (now: number): void => {
    if (this.stopped) return;
    this.raf = requestAnimationFrame(this.frame);
    const p = this.project();
    if (this.playing) {
      const end = projectDuration(p);
      if (this.audio.running) {
        this.time = this.audio.now();
        // Keep the wall clock in step, so it can take over if the audio clock stops.
        this.wallStart = now - (this.time - this.timeStart) * 1000;
      } else {
        this.time = this.timeStart + (now - this.wallStart) / 1000;
      }
      if (this.time >= end) {
        this.time = end;
        this.pause();
      } else {
        this.onTime(this.time);
      }
      if (this.lastFrame && now - this.lastFrame > 50) this.stats.slow++;
    }
    this.lastFrame = now;
    const busy = this.syncVideos(p);
    if (!this.dirty && !this.playing && !busy) return;
    this.dirty = false;
    compose(this.ctx, p, this.time, this.canvas.width, this.canvas.height, this.resolve);
    this.stats.painted++;
    this.onPaint();
  };

  /** A small picture of the current frame, for the projects screen. */
  async snapshot(width: number): Promise<Blob | null> {
    const p = this.project();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round((width * p.height) / p.width);
    compose(canvas.getContext('2d')!, p, this.time, canvas.width, canvas.height, this.resolve);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
  }

  dispose(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.audio.stop();
    for (const { el } of this.videos.values()) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.videos.clear();
  }
}
