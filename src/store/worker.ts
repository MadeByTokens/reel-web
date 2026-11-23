/// <reference lib="webworker" />
// Storage worker. Writing to the origin private file system is done here
// because the synchronous file handle, the one every browser supports, only
// exists in workers. Reading happens on the main thread.

declare const self: DedicatedWorkerGlobalScope;

type SyncHandle = {
  truncate(size: number): void;
  write(data: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
};
type FileHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncHandle> };

export type WriteRequest =
  | { type: 'write'; path: string; data: Blob | Uint8Array }
  | { type: 'remove'; path: string }
  | { type: 'probe' };

export type WorkerReply =
  | { seq: number; ok: true }
  | { seq: number; ok: false; error: string }
  | { seq: number; progress: number };

async function resolveDir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

function split(path: string): string[] {
  const parts = path.split('/');
  if (parts.some((p) => !/^[A-Za-z0-9._-]{1,80}$/.test(p) || p === '.' || p === '..')) throw new Error('Bad path');
  return parts;
}

async function write(seq: number, path: string, data: Blob | Uint8Array): Promise<void> {
  const parts = split(path);
  const name = parts.pop()!;
  const dir = await resolveDir(parts, true);
  const file = (await dir.getFileHandle(name, { create: true })) as FileHandle;
  const access = await file.createSyncAccessHandle();
  try {
    access.truncate(0);
    if (data instanceof Uint8Array) {
      access.write(data, { at: 0 });
    } else {
      // Large files are copied piece by piece so they never sit in memory whole.
      const reader = data.stream().getReader();
      let at = 0;
      let lastReport = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        at += access.write(value, { at });
        if (at - lastReport > 4 << 20) {
          lastReport = at;
          self.postMessage({ seq, progress: data.size ? at / data.size : 0 } satisfies WorkerReply);
        }
      }
    }
    access.flush();
  } finally {
    access.close();
  }
}

async function remove(path: string): Promise<void> {
  const parts = split(path);
  const name = parts.pop()!;
  try {
    const dir = await resolveDir(parts, false);
    await dir.removeEntry(name, { recursive: true });
  } catch {
    // Already gone.
  }
}

// Requests are handled strictly in arrival order, so a later write always wins.
let chain: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent<{ seq: number; req: WriteRequest }>) => {
  const { seq, req } = event.data;
  chain = chain.then(async () => {
    let reply: WorkerReply;
    try {
      if (req.type === 'write') await write(seq, req.path, req.data);
      else if (req.type === 'remove') await remove(req.path);
      else {
        // Prove that writing really works before the app promises to keep anything.
        await write(seq, '.probe/probe', new Uint8Array([1]));
        await remove('.probe');
      }
      reply = { seq, ok: true };
    } catch (err) {
      reply = { seq, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    self.postMessage(reply);
  });
};
