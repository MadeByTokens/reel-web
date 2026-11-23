// Where files are kept. The real store is the browser's origin private file
// system; the in-memory one is used where that is unavailable (and then
// nothing survives a reload, which the app says out loud).

import { crc32 } from '../util/zip';
import type { WorkerReply, WriteRequest } from './worker';

export interface Store {
  /** False when everything is lost on reload. */
  readonly persistent: boolean;
  file(path: string): Promise<Blob | null>;
  write(path: string, data: Blob | Uint8Array, onProgress?: (fraction: number) => void): Promise<void>;
  /** Removes a file or a whole folder. */
  remove(path: string): Promise<void>;
  /** Names directly inside a folder. */
  list(dir: string): Promise<string[]>;
  /** A stream that writes straight into a file, where the browser has one. */
  writable(path: string): Promise<FileSystemWritableFileStream | null>;
  /** Resolves when every write sent so far has finished. */
  idle(): Promise<void>;
}

export class MemoryStore implements Store {
  readonly persistent = false;
  readonly files = new Map<string, Blob>();

  async file(path: string): Promise<Blob | null> {
    return this.files.get(path) ?? null;
  }

  async write(path: string, data: Blob | Uint8Array): Promise<void> {
    this.files.set(path, data instanceof Blob ? data : new Blob([data.slice()]));
  }

  async remove(path: string): Promise<void> {
    for (const key of [...this.files.keys()]) if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
  }

  async list(dir: string): Promise<string[]> {
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(`${dir}/`)) names.add(key.slice(dir.length + 1).split('/')[0]!);
    }
    return [...names];
  }

  async writable(): Promise<null> {
    return null;
  }

  async idle(): Promise<void> {}
}

type Directory = FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> };

class OpfsStore implements Store {
  readonly persistent = true;
  private readonly pending = new Map<
    number,
    { resolve(): void; reject(e: Error): void; progress?: (f: number) => void }
  >();
  private seq = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly worker: Worker) {
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      const waiter = this.pending.get(reply.seq);
      if ('progress' in reply) {
        waiter?.progress?.(reply.progress);
        return;
      }
      this.pending.delete(reply.seq);
      if (reply.ok) waiter?.resolve();
      else waiter?.reject(new Error(reply.error));
      if (this.pending.size === 0) {
        for (const done of this.idleWaiters) done();
        this.idleWaiters = [];
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Storage worker failed');
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    };
  }

  request(req: WriteRequest, progress?: (f: number) => void): Promise<void> {
    const seq = ++this.seq;
    const promise = new Promise<void>((resolve, reject) => this.pending.set(seq, { resolve, reject, progress }));
    this.worker.postMessage({ seq, req });
    return promise;
  }

  private async dir(parts: string[]): Promise<Directory> {
    let dir = await navigator.storage.getDirectory();
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    return dir as Directory;
  }

  async file(path: string): Promise<Blob | null> {
    try {
      const parts = path.split('/');
      const name = parts.pop()!;
      return await (await (await this.dir(parts)).getFileHandle(name)).getFile();
    } catch {
      return null;
    }
  }

  write(path: string, data: Blob | Uint8Array, onProgress?: (fraction: number) => void): Promise<void> {
    return this.request({ type: 'write', path, data }, onProgress);
  }

  remove(path: string): Promise<void> {
    return this.request({ type: 'remove', path });
  }

  async list(dir: string): Promise<string[]> {
    try {
      const names: string[] = [];
      for await (const name of (await this.dir(dir.split('/'))).keys()) names.push(name);
      return names;
    } catch {
      return [];
    }
  }

  async writable(path: string): Promise<FileSystemWritableFileStream | null> {
    try {
      const parts = path.split('/');
      const name = parts.pop()!;
      let dir = await navigator.storage.getDirectory();
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const handle = await dir.getFileHandle(name, { create: true });
      if (typeof handle.createWritable !== 'function') return null;
      return await handle.createWritable();
    } catch {
      return null;
    }
  }

  idle(): Promise<void> {
    if (this.pending.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
}

/** Opens the best store this browser has. */
export async function openStore(): Promise<Store> {
  try {
    if (!navigator.storage?.getDirectory) return new MemoryStore();
    await navigator.storage.getDirectory();
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const store = new OpfsStore(worker);
    await store.request({ type: 'probe' });
    return store;
  } catch {
    return new MemoryStore();
  }
}

// --- small documents saved in two slots ---------------------------------------------
//
// A document is written alternately to "<base>.0" and "<base>.1", each with a
// sequence number and a checksum. If a write is cut short (the tab is closed,
// the battery dies) the other slot still holds the previous good copy.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface Slot {
  seq: number;
  text: string;
}

function parseSlot(bytes: Uint8Array): Slot | null {
  const text = decoder.decode(bytes);
  const first = text.indexOf('\n');
  const second = text.indexOf('\n', first + 1);
  if (first < 0 || second < 0) return null;
  const seq = Number(text.slice(0, first));
  const sum = Number(text.slice(first + 1, second));
  const body = text.slice(second + 1);
  if (!Number.isSafeInteger(seq) || seq < 0) return null;
  if (crc32(encoder.encode(body)) !== sum) return null;
  return { seq, text: body };
}

export interface Loaded {
  /** The newest copy that passed its checksum, or null. */
  text: string | null;
  seq: number;
  /** True when a slot exists but nothing readable was found: do not write over it. */
  damaged: boolean;
}

export async function loadDocument(store: Store, base: string): Promise<Loaded> {
  let best: Slot | null = null;
  let found = false;
  for (const n of [0, 1]) {
    const blob = await store.file(`${base}.${n}`);
    if (!blob) continue;
    found = true;
    const slot = parseSlot(new Uint8Array(await blob.arrayBuffer()));
    if (slot && (!best || slot.seq > best.seq)) best = slot;
  }
  return { text: best?.text ?? null, seq: best?.seq ?? 0, damaged: found && !best };
}

/** Writes the next copy; `seq` is the one returned by the last load or save. Returns the new seq. */
export async function saveDocument(store: Store, base: string, seq: number, text: string): Promise<number> {
  const next = seq + 1;
  const body = encoder.encode(text);
  const head = encoder.encode(`${next}\n${crc32(body)}\n`);
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  await store.write(`${base}.${next % 2}`, out);
  return next;
}
