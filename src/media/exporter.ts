// Export: renders the project frame by frame, mixes the sound, and writes a
// video file. Nothing here runs in real time; every frame is decoded exactly.

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type InputVideoTrack,
  type OutputFormat,
  type StreamTargetChunk,
  type WrappedCanvas,
} from 'mediabunny';
import type { Clip, Project } from '../doc/model';
import { audibleBetween, clipEnd, projectDuration, visibleAt } from '../doc/ops';
import { compose, type Drawable } from '../render/compose';
import type { Store } from '../store/store';
import { scheduleGain } from './audio';
import { makeVideoElement, type MediaLibrary } from './library';

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  /** Bits per second for the picture. */
  bitrate: number;
}

export interface ExportResult {
  blob: Blob;
  extension: string;
  /** Things the user should know, e.g. that a clip's sound could not be used. */
  notes: string[];
}

const SAMPLE_RATE = 48000;
const AUDIO_CHUNK = 30;
const EXPORT_PATH = 'exports/export.tmp';

interface FrameProvider {
  at(sourceTime: number): Promise<Drawable | null>;
  close(): void;
}

/** Exact frames straight from the decoder. */
function decoderFrames(track: InputVideoTrack): FrameProvider {
  const sink = new CanvasSink(track, { poolSize: 3 });
  let iter: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  let cur: WrappedCanvas | null = null;
  let next: WrappedCanvas | null = null;
  let last = -Infinity;
  const pull = async (): Promise<WrappedCanvas | null> => (await iter!.next()).value ?? null;
  return {
    async at(s) {
      if (!iter || s < last - 1e-3) {
        await iter?.return();
        iter = sink.canvases(Math.max(0, s));
        cur = await pull();
        next = cur ? await pull() : null;
      }
      last = s;
      while (next && next.timestamp <= s + 1e-4) {
        cur = next;
        next = await pull();
      }
      if (!cur) return null;
      return { source: cur.canvas, width: cur.canvas.width, height: cur.canvas.height };
    },
    close() {
      void iter?.return();
    },
  };
}

/** Slower stand-in for files the frame decoder cannot read: seek the browser's own player. */
function elementFrames(url: string): FrameProvider {
  const video = makeVideoElement(url);
  const until = (event: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => done(new Error('A video stopped responding')), 20_000);
      const done = (err?: Error): void => {
        window.clearTimeout(timer);
        video.removeEventListener(event, ok);
        video.removeEventListener('error', bad);
        if (err) reject(err);
        else resolve();
      };
      const ok = (): void => done();
      const bad = (): void => done(new Error('A video could not be read'));
      video.addEventListener(event, ok);
      video.addEventListener('error', bad);
    });
  return {
    async at(s) {
      if (video.readyState < 1) await until('loadedmetadata');
      const target = Math.min(s, Math.max(0, video.duration - 0.03));
      if (Math.abs(video.currentTime - target) > 1e-3 || video.readyState < 2) {
        const seeked = until('seeked');
        video.currentTime = target;
        await seeked;
      }
      if (video.readyState < 2) await until('loadeddata');
      return { source: video, width: video.videoWidth, height: video.videoHeight };
    },
    close() {
      video.removeAttribute('src');
      video.load();
    },
  };
}

async function renderAudio(p: Project, media: MediaLibrary, from: number, to: number, silent: Set<string>): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round((to - from) * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
  for (const clip of audibleBetween(p, from, to)) {
    const provider = clip.mediaId ? await media.audioProvider(clip.mediaId) : null;
    if (!provider) {
      if (clip.mediaId) silent.add(clip.mediaId);
      continue;
    }
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    scheduleGain(gain.gain, clip, from, (t) => Math.max(0, t - from));
    const a0 = Math.max(from, clip.start);
    const a1 = Math.min(to, clipEnd(clip));
    const srcFrom = clip.offset + (a0 - clip.start) * clip.speed;
    const srcTo = clip.offset + (a1 - clip.start) * clip.speed;
    for await (const chunk of provider.chunks(srcFrom, srcTo)) {
      const a = Math.max(chunk.timestamp, srcFrom);
      const b = Math.min(chunk.timestamp + chunk.buffer.duration, srcTo);
      if (b <= a) continue;
      const node = ctx.createBufferSource();
      node.buffer = chunk.buffer;
      node.playbackRate.value = clip.speed;
      node.connect(gain);
      node.start(Math.max(0, clip.start + (a - clip.offset) / clip.speed - from), a - chunk.timestamp, b - a);
    }
  }
  return ctx.startRendering();
}

function aborted(): DOMException {
  return new DOMException('Export cancelled', 'AbortError');
}

export async function exportProject(
  p: Project,
  media: MediaLibrary,
  store: Store,
  options: ExportOptions,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  const duration = projectDuration(p);
  if (duration <= 0) throw new Error('There is nothing to export yet');
  const { width, height, fps, bitrate } = options;
  const notes: string[] = [];

  await store.remove('exports');
  const writable = await store.writable(EXPORT_PATH);

  let format: OutputFormat = new Mp4OutputFormat({ fastStart: writable ? false : 'in-memory' });
  let extension = 'mp4';
  let videoCodec = await getFirstEncodableVideoCodec(['avc'], { width, height, bitrate });
  if (!videoCodec) {
    format = new WebMOutputFormat();
    extension = 'webm';
    videoCodec = await getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], { width, height, bitrate });
    if (videoCodec) notes.push('This browser cannot make MP4, so the video was saved as WebM.');
  }
  if (!videoCodec) throw new Error('This browser cannot encode video');

  const wantsAudio = audibleBetween(p, 0, duration).length > 0;
  const preferred = extension === 'mp4' ? (['aac', 'opus'] as const) : (['opus', 'vorbis'] as const);
  let audioCodec: AudioCodec | null = wantsAudio
    ? await getFirstEncodableAudioCodec([...preferred], { numberOfChannels: 2, sampleRate: SAMPLE_RATE, bitrate: 192_000 })
    : null;
  if (wantsAudio && !audioCodec && extension === 'mp4') {
    // No sound encoder at all: plain uncompressed sound in a QuickTime file plays almost everywhere.
    format = new MovOutputFormat({ fastStart: writable ? false : 'in-memory' });
    extension = 'mov';
    audioCodec = 'pcm-s16';
    notes.push('This browser cannot compress sound, so the video was saved as a QuickTime file with uncompressed sound.');
  }
  if (wantsAudio && !audioCodec) notes.push('This browser cannot encode sound, so the video is silent.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  const target = writable
    ? new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>, { chunked: true })
    : new BufferTarget();
  const output = new Output({ format, target });
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  const providers = new Map<string, FrameProvider>();
  const current = new Map<string, Drawable | null>();
  const silent = new Set<string>();
  const closeAll = (): void => {
    for (const provider of providers.values()) provider.close();
    providers.clear();
  };

  const providerFor = async (clip: Clip): Promise<FrameProvider | null> => {
    let provider = providers.get(clip.id);
    if (provider) return provider;
    const item = media.get(clip.mediaId);
    if (!item) return null;
    const track = await media.videoTrack(item.info.id);
    provider = track ? decoderFrames(track) : elementFrames(item.url);
    providers.set(clip.id, provider);
    return provider;
  };

  const resolve = (clip: Clip): Drawable | null => {
    if (clip.kind === 'image') {
      const image = media.get(clip.mediaId)?.image;
      return image ? { source: image, width: image.width, height: image.height } : null;
    }
    return current.get(clip.id) ?? null;
  };

  try {
    await output.start();
    const frames = Math.max(1, Math.round(duration * fps));
    let audioDone = 0;
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw aborted();
      const t = i / fps;
      if (audioSource && t >= audioDone) {
        const to = Math.min(duration, audioDone + AUDIO_CHUNK);
        await audioSource.add(await renderAudio(p, media, audioDone, to, silent));
        audioDone = to;
      }
      current.clear();
      const visible = visibleAt(p, t);
      for (const clip of visible) {
        if (clip.kind !== 'video') continue;
        const provider = await providerFor(clip);
        if (!provider) continue;
        const item = media.get(clip.mediaId);
        const max = item ? Math.max(0, item.info.duration - 0.03) : Infinity;
        const s = Math.min(clip.offset + (t - clip.start) * clip.speed, max);
        current.set(clip.id, await provider.at(s));
      }
      // Decoders are few on some devices: let go of clips that are over.
      for (const [id, provider] of providers) {
        if (!visible.some((c) => c.id === id)) {
          provider.close();
          providers.delete(id);
        }
      }
      compose(ctx, p, t, width, height, resolve);
      await videoSource.add(t, 1 / fps);
      onProgress((i + 1) / frames);
      if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    closeAll();
    await output.finalize();
  } catch (err) {
    closeAll();
    try {
      await output.cancel();
    } catch {
      // Already finished or never started.
    }
    await store.remove('exports');
    throw err;
  }

  if (silent.size) notes.push('The sound of some clips could not be read and was left out.');
  const mime = await output.getMimeType().catch(() => (extension === 'webm' ? 'video/webm' : extension === 'mov' ? 'video/quicktime' : 'video/mp4'));
  const simple = mime.split(';')[0]!;
  if (target instanceof BufferTarget) return { blob: new Blob([target.buffer!], { type: simple }), extension, notes };
  const file = await store.file(EXPORT_PATH);
  if (!file) throw new Error('The finished video could not be read back');
  return { blob: file.slice(0, file.size, simple), extension, notes };
}
