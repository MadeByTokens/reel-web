// The media of the open project: the stored files, what is known about them,
// and ways to get pictures and sound out of them.

import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, type InputVideoTrack } from 'mediabunny';
import { newId, type MediaInfo } from '../doc/model';
import type { Store } from '../store/store';

export interface AudioChunk {
  buffer: AudioBuffer;
  /** Where the buffer starts in the source, in seconds. */
  timestamp: number;
}

export interface AudioProvider {
  /** Decoded sound covering a stretch of the source, in order. */
  chunks(from: number, to: number): AsyncGenerator<AudioChunk, void, unknown>;
}

export interface LoadedMedia {
  info: MediaInfo;
  blob: Blob;
  url: string;
}

export type Picture = ImageBitmap | HTMLCanvasElement;

const MAX_IMAGE_SIDE = 2048;
/** Full-size pictures kept decoded at once; each can be 16 MB. */
const PICTURES_KEPT = 8;
/** A thumbnail player with nothing left to do is let go after this long. */
const THUMB_IDLE_MS = 8000;
const THUMB_HEIGHT = 72;
/** Files larger than this are not decoded whole when the streaming decoder is unavailable. */
const MAX_WHOLE_DECODE = 300 << 20;
/** How finely the loudness of a sound is kept for drawing its waveform. */
export const PEAKS_PER_SECOND = 40;

function waitFor(el: HTMLMediaElement, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error('Timed out')), ms);
    const finish = (err?: Error): void => {
      window.clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener('error', onError);
      if (err) reject(err);
      else resolve();
    };
    const onOk = (): void => finish();
    const onError = (): void => finish(new Error('This file cannot be played here'));
    el.addEventListener(event, onOk);
    el.addEventListener('error', onError);
  });
}

export function makeVideoElement(url: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  // Kept in the page, unseen: some browsers only decode videos that are part of it.
  let pool = document.getElementById('video-pool');
  if (!pool) {
    pool = document.createElement('div');
    pool.id = 'video-pool';
    pool.setAttribute('aria-hidden', 'true');
    pool.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1';
    document.body.append(pool);
  }
  video.style.cssText = 'width:2px;height:2px';
  pool.append(video);
  return video;
}

/** Stops a video made by makeVideoElement and lets go of its file. */
export function releaseVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.remove();
}

/**
 * Some tablets load no picture data for a video until it has been played.
 * A muted, inline video may play without a tap, so play it for an instant.
 */
export async function primeVideo(video: HTMLVideoElement): Promise<void> {
  try {
    await video.play();
  } catch {
    // Not allowed or interrupted: seeking may still work.
  }
  video.pause();
}

async function decodeImage(blob: Blob): Promise<ImageBitmap | HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const side = Math.max(bitmap.width, bitmap.height);
  if (side <= MAX_IMAGE_SIDE) return bitmap;
  const k = MAX_IMAGE_SIDE / side;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

interface Probe {
  kind: MediaInfo['kind'];
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

async function probe(blob: Blob, name: string): Promise<Probe> {
  const looksLikeImage = blob.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i.test(name);
  if (looksLikeImage) {
    try {
      const bitmap = await createImageBitmap(blob);
      const out: Probe = { kind: 'image', duration: 0, width: bitmap.width, height: bitmap.height, hasAudio: false };
      bitmap.close();
      return out;
    } catch {
      throw new Error('This picture cannot be opened here');
    }
  }
  // What the container says, when it is a kind this reader understands.
  let tracks: { video: boolean; audio: boolean; duration: number } | null = null;
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    tracks = { video: !!video, audio: !!audio, duration: await input.computeDuration() };
  } catch {
    tracks = null;
  } finally {
    input.dispose();
  }
  // What the browser's own player says: this is what decides whether it can be used.
  const url = URL.createObjectURL(blob);
  const video = makeVideoElement(url);
  try {
    video.preload = 'metadata';
    const ready = waitFor(video, 'loadedmetadata', 20_000);
    video.load();
    await ready;
    let duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) duration = tracks?.duration ?? 0;
    if (!(duration > 0)) throw new Error('This file has no length');
    const isVideo = video.videoWidth > 0 && video.videoHeight > 0;
    return {
      kind: isVideo ? 'video' : 'audio',
      duration,
      width: video.videoWidth,
      height: video.videoHeight,
      hasAudio: isVideo ? (tracks ? tracks.audio : true) : true,
    };
  } finally {
    releaseVideo(video);
    URL.revokeObjectURL(url);
  }
}

function extension(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return match ? match[1]!.toLowerCase() : 'bin';
}

export class MediaLibrary {
  private readonly items = new Map<string, LoadedMedia>();
  private readonly inputs = new Map<string, Input>();
  private readonly audio = new Map<string, Promise<AudioProvider | null>>();
  private readonly thumbs = new Map<string, Map<number, HTMLCanvasElement>>();
  private readonly thumbQueue: { id: string; slot: number }[] = [];
  private readonly thumbVideos = new Map<string, HTMLVideoElement>();
  private thumbBusy = false;
  private thumbIdle = 0;
  /** Videos whose frames could not be read once are not tried again. */
  private readonly thumbFailed = new Set<string>();
  /** Decoded pictures, most recently used last. */
  private readonly pictures = new Map<string, Picture>();
  private readonly pictureLoads = new Map<string, Promise<Picture | null>>();
  private readonly pictureThumbs = new Map<string, HTMLCanvasElement>();
  private disposed = false;
  /** Called when a new thumbnail is ready, so the timeline can redraw. */
  onThumb: () => void = () => {};
  /** Called as waveforms are worked out. */
  onPeaks: () => void = () => {};
  private readonly peaks = new Map<string, Uint8Array>();
  private peakChain: Promise<void> = Promise.resolve();
  /** Called when a full-size picture has been decoded, so the preview can repaint. */
  onPicture: () => void = () => {};

  constructor(
    private readonly store: Store,
    private readonly folder: string,
  ) {}

  private path(info: MediaInfo): string {
    return `${this.folder}/media/${info.id}.${extension(info.name)}`;
  }

  get(id: string | undefined): LoadedMedia | undefined {
    return id ? this.items.get(id) : undefined;
  }

  /** Opens the files of a saved project. Returns the media whose file is gone. */
  async load(infos: MediaInfo[]): Promise<MediaInfo[]> {
    const missing: MediaInfo[] = [];
    for (const info of infos) {
      const file = await this.store.file(this.path(info));
      if (!file) {
        missing.push(info);
        continue;
      }
      await this.adopt(info, file);
    }
    return missing;
  }

  private async adopt(info: MediaInfo, file: Blob): Promise<void> {
    // Stored files lose their content type; give it back so players accept the URL.
    const blob = info.mime && file.type !== info.mime ? file.slice(0, file.size, info.mime) : file;
    this.items.set(info.id, { info, blob, url: URL.createObjectURL(blob) });
  }

  /** The decoded picture if it is ready; otherwise starts decoding it and returns null. */
  picture(id: string | undefined): Picture | null {
    if (!id) return null;
    const hit = this.pictures.get(id);
    if (hit) {
      // Move to the end: most recently used.
      this.pictures.delete(id);
      this.pictures.set(id, hit);
      return hit;
    }
    void this.loadPicture(id);
    return null;
  }

  /** Decodes a picture, keeping only the most recently used few in memory. */
  loadPicture(id: string): Promise<Picture | null> {
    const hit = this.pictures.get(id);
    if (hit) return Promise.resolve(this.picture(id));
    let load = this.pictureLoads.get(id);
    if (!load) {
      load = (async () => {
        const item = this.items.get(id);
        if (!item || item.info.kind !== 'image') return null;
        try {
          const picture = await decodeImage(item.blob);
          if (this.disposed || !this.items.has(id)) {
            if ('close' in picture) picture.close();
            return null;
          }
          this.pictures.set(id, picture);
          if (!this.pictureThumbs.has(id)) {
            const small = document.createElement('canvas');
            small.height = THUMB_HEIGHT;
            small.width = Math.max(2, Math.round((THUMB_HEIGHT * picture.width) / Math.max(1, picture.height)));
            small.getContext('2d')!.drawImage(picture, 0, 0, small.width, small.height);
            this.pictureThumbs.set(id, small);
            this.onThumb();
          }
          while (this.pictures.size > PICTURES_KEPT) {
            const [oldest, old] = this.pictures.entries().next().value!;
            this.pictures.delete(oldest);
            if ('close' in old) old.close();
          }
          this.onPicture();
          return picture;
        } catch {
          return null;
        } finally {
          this.pictureLoads.delete(id);
        }
      })();
      this.pictureLoads.set(id, load);
    }
    return load;
  }

  /** Copies a file into the project and returns what it is. */
  async import(file: Blob, name: string, onProgress?: (fraction: number) => void, soundOnly = false): Promise<MediaInfo> {
    const found = await probe(file, name);
    if (soundOnly) {
      if (found.kind === 'image' || !found.hasAudio) throw new Error('This file has no sound');
      // A video chosen as audio is used for its sound alone.
      found.kind = 'audio';
      found.width = found.height = 0;
    }
    const info: MediaInfo = {
      id: newId(),
      name: name.slice(0, 200) || 'media',
      size: file.size,
      mime: /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,60}$/i.test(file.type) ? file.type : '',
      ...found,
    };
    try {
      await this.store.write(this.path(info), file, onProgress);
    } catch (err) {
      // A copy cut short (storage full) must not stay behind eating what space is left.
      await this.store.remove(this.path(info)).catch(() => {});
      throw err instanceof Error && /full|quota/i.test(err.message) ? new Error('There is not enough storage left for this file') : err;
    }
    const stored = (await this.store.file(this.path(info))) ?? file;
    if (stored.size !== file.size) {
      await this.store.remove(this.path(info)).catch(() => {});
      throw new Error('The file could not be copied completely');
    }
    await this.adopt(info, stored);
    return info;
  }

  async remove(info: MediaInfo): Promise<void> {
    const item = this.items.get(info.id);
    if (item) URL.revokeObjectURL(item.url);
    this.items.delete(info.id);
    this.inputs.get(info.id)?.dispose();
    this.inputs.delete(info.id);
    this.audio.delete(info.id);
    const picture = this.pictures.get(info.id);
    if (picture && 'close' in picture) picture.close();
    this.pictures.delete(info.id);
    this.pictureThumbs.delete(info.id);
    this.thumbs.delete(info.id);
    const thumbVideo = this.thumbVideos.get(info.id);
    if (thumbVideo) releaseVideo(thumbVideo);
    this.thumbVideos.delete(info.id);
    await this.store.remove(this.path(info));
  }

  private input(id: string): Input | null {
    const item = this.items.get(id);
    if (!item) return null;
    let input = this.inputs.get(id);
    if (!input) {
      input = new Input({ source: new BlobSource(item.blob), formats: ALL_FORMATS });
      this.inputs.set(id, input);
    }
    return input;
  }

  /** The video track, when the browser can decode it frame by frame. */
  async videoTrack(id: string): Promise<InputVideoTrack | null> {
    try {
      const track = await this.input(id)?.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) return null;
      return track;
    } catch {
      return null;
    }
  }

  /** Decoded sound for a file, or null when it has none that can be decoded. */
  audioProvider(id: string): Promise<AudioProvider | null> {
    let provider = this.audio.get(id);
    if (!provider) {
      provider = this.openAudio(id);
      this.audio.set(id, provider);
    }
    return provider;
  }

  private async openAudio(id: string): Promise<AudioProvider | null> {
    const item = this.items.get(id);
    if (!item) return null;
    try {
      const track = await this.input(id)?.getPrimaryAudioTrack();
      if (track && (await track.canDecode())) {
        const sink = new AudioBufferSink(track);
        return {
          async *chunks(from, to) {
            for await (const wrapped of sink.buffers(Math.max(0, from), to)) {
              yield { buffer: wrapped.buffer, timestamp: wrapped.timestamp };
            }
          },
        };
      }
    } catch {
      // Fall through to decoding the whole file.
    }
    if (item.blob.size > MAX_WHOLE_DECODE) return null;
    try {
      const context = new OfflineAudioContext(2, 1, 48000);
      const buffer = await context.decodeAudioData(await item.blob.arrayBuffer());
      return {
        async *chunks() {
          yield { buffer, timestamp: 0 };
        },
      };
    } catch {
      return null;
    }
  }

  // --- waveforms ----------------------------------------------------------------

  /**
   * The loudness of a file's sound, PEAKS_PER_SECOND values a second from 0 to
   * 255. The first call starts the work and the values fill in as it goes;
   * null when the file is not known.
   */
  waveform(id: string): Uint8Array | null {
    const known = this.peaks.get(id);
    if (known) return known;
    const item = this.items.get(id);
    if (!item || item.info.duration <= 0) return null;
    const peaks = new Uint8Array(Math.ceil(item.info.duration * PEAKS_PER_SECOND) + 1);
    this.peaks.set(id, peaks);
    // One file at a time, so drawing waveforms never competes with itself for the decoder.
    this.peakChain = this.peakChain.then(() => this.measure(id, peaks, item.info.duration)).catch(() => {});
    return peaks;
  }

  private async measure(id: string, peaks: Uint8Array, duration: number): Promise<void> {
    const provider = await this.audioProvider(id);
    if (!provider || this.disposed) return;
    let shown = performance.now();
    for await (const chunk of provider.chunks(0, duration)) {
      if (this.disposed) return;
      const rate = chunk.buffer.sampleRate;
      const perPeak = rate / PEAKS_PER_SECOND;
      const base = chunk.timestamp * PEAKS_PER_SECOND;
      for (let channel = 0; channel < Math.min(2, chunk.buffer.numberOfChannels); channel++) {
        const data = chunk.buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i++) {
          const slot = Math.floor(base + i / perPeak);
          const value = Math.min(255, Math.abs(data[i]!) * 255);
          if (slot >= 0 && slot < peaks.length && value > peaks[slot]!) peaks[slot] = value;
        }
      }
      // Let the page breathe, and show what there is so far a few times a second.
      await new Promise((r) => setTimeout(r, 0));
      if (performance.now() - shown > 300) {
        shown = performance.now();
        this.onPeaks();
      }
    }
    if (!this.disposed) this.onPeaks();
  }

  // --- thumbnails ---------------------------------------------------------------

  /** Seconds between thumbnails of a video: more for long files, to bound memory. */
  thumbStep(info: MediaInfo): number {
    return Math.max(1, Math.ceil(info.duration / 150));
  }

  /**
   * A small picture of the media near a source time, or null while it is being
   * made (onThumb fires when it is ready).
   */
  thumb(id: string, time: number): CanvasImageSource | null {
    const item = this.items.get(id);
    if (!item) return null;
    if (item.info.kind === 'image') {
      const small = this.pictureThumbs.get(id);
      if (!small) void this.loadPicture(id);
      return small ?? null;
    }
    if (item.info.kind !== 'video' || this.thumbFailed.has(id)) return null;
    const step = this.thumbStep(item.info);
    const slot = Math.max(0, Math.floor(time / step));
    let cache = this.thumbs.get(id);
    if (!cache) this.thumbs.set(id, (cache = new Map()));
    const hit = cache.get(slot);
    if (hit) return hit;
    if (!this.thumbQueue.some((q) => q.id === id && q.slot === slot)) {
      this.thumbQueue.push({ id, slot });
      void this.pumpThumbs();
    }
    // Meanwhile the nearest earlier one is better than nothing.
    for (let s = slot - 1; s >= Math.max(0, slot - 8); s--) {
      const near = cache.get(s);
      if (near) return near;
    }
    return null;
  }

  private async pumpThumbs(): Promise<void> {
    if (this.thumbBusy) return;
    this.thumbBusy = true;
    window.clearTimeout(this.thumbIdle);
    try {
      while (this.thumbQueue.length && !this.disposed) {
        const { id, slot } = this.thumbQueue.shift()!;
        const item = this.items.get(id);
        if (!item || this.thumbFailed.has(id)) continue;
        try {
          await this.makeThumb(item, slot);
          this.onThumb();
        } catch {
          // Frames of this file cannot be read here: leave plain blocks, and do not make
          // every other thumbnail wait for the same failure.
          this.thumbFailed.add(id);
        }
      }
    } finally {
      this.thumbBusy = false;
      // The hidden players hold decoders; let them go once the strip has been quiet a while.
      this.thumbIdle = window.setTimeout(() => {
        if (this.thumbBusy) return;
        for (const video of this.thumbVideos.values()) releaseVideo(video);
        this.thumbVideos.clear();
      }, THUMB_IDLE_MS);
    }
  }

  private async makeThumb(item: LoadedMedia, slot: number): Promise<void> {
    let video = this.thumbVideos.get(item.info.id);
    if (!video) {
      video = makeVideoElement(item.url);
      this.thumbVideos.set(item.info.id, video);
      if (video.readyState < 1) await waitFor(video, 'loadedmetadata', 15_000);
      await primeVideo(video);
    }
    const step = this.thumbStep(item.info);
    const time = Math.min(slot * step + Math.min(0.1, step / 2), Math.max(0, item.info.duration - 0.05));
    if (Math.abs(video.currentTime - time) > 0.001 || video.readyState < 2) {
      const seeked = waitFor(video, 'seeked', 15_000);
      video.currentTime = time;
      await seeked;
    }
    if (video.readyState < 2) await waitFor(video, 'loadeddata', 15_000);
    const canvas = document.createElement('canvas');
    canvas.height = THUMB_HEIGHT;
    canvas.width = Math.max(2, Math.round((THUMB_HEIGHT * video.videoWidth) / Math.max(1, video.videoHeight)));
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    this.thumbs.get(item.info.id)?.set(slot, canvas);
  }

  /** Removes stored files that the project does not list: copies left by an import that never finished. */
  async sweep(infos: MediaInfo[]): Promise<void> {
    const known = new Set(infos.map((m) => m.id));
    for (const name of await this.store.list(`${this.folder}/media`)) {
      const id = name.split('.')[0]!;
      if (!known.has(id)) await this.store.remove(`${this.folder}/media/${name}`).catch(() => {});
    }
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.thumbIdle);
    for (const item of this.items.values()) URL.revokeObjectURL(item.url);
    for (const picture of this.pictures.values()) if ('close' in picture) picture.close();
    this.pictures.clear();
    this.pictureThumbs.clear();
    for (const input of this.inputs.values()) input.dispose();
    for (const video of this.thumbVideos.values()) releaseVideo(video);
    this.items.clear();
    this.inputs.clear();
    this.audio.clear();
    this.thumbs.clear();
    this.thumbVideos.clear();
    this.peaks.clear();
  }
}
