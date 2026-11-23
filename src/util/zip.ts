// A minimal zip writer and reader for project files. Entries are stored
// without compression (video is already compressed) and are handled as
// blobs, so a project with large videos never has to fit in memory.

export interface ZipEntry {
  name: string;
  blob: Blob;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
/** Sizes and offsets are 32-bit in this format. */
const LIMIT = 0xffffffff;
const CHUNK = 4 << 20;

let table: Uint32Array | null = null;

/** Continues a checksum; start with 0xffffffff and finish with crcFinish. */
function crcUpdate(crc: number, data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return crc;
}

export function crc32(data: Uint8Array): number {
  return (crcUpdate(0xffffffff, data) ^ 0xffffffff) >>> 0;
}

export async function crc32Blob(blob: Blob): Promise<number> {
  let crc = 0xffffffff;
  for (let at = 0; at < blob.size; at += CHUNK) {
    crc = crcUpdate(crc, new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function zip(entries: readonly ZipEntry[], onProgress?: (fraction: number) => void): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  const total = entries.reduce((n, e) => n + e.blob.size, 0) || 1;
  let done = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const size = entry.blob.size;
    if (size > LIMIT || at + size > LIMIT) throw new Error('The project is too large for one file');
    const crc = await crc32Blob(entry.blob);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, entry.blob);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, CENTRAL, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, size, true);
    dv.setUint32(24, size, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, at, true);
    dir.set(name, 46);
    central.push(dir);
    at += local.length + size;
    done += size;
    onProgress?.(done / total);
  }
  const directorySize = central.reduce((n, d) => n + d.length, 0);
  if (entries.length > 0xffff || at + directorySize > LIMIT) throw new Error('The project is too large for one file');
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, at, true);
  return new Blob([...parts, ...(central as BlobPart[]), end], { type: 'application/zip' });
}

/**
 * Reads a zip made by `zip`. Throws on anything damaged, compressed or
 * unexpected. Every entry's checksum is verified.
 */
export async function unzip(file: Blob, onProgress?: (fraction: number) => void): Promise<ZipEntry[]> {
  if (file.size < 22) throw new Error('Not a project file');
  const tailStart = Math.max(0, file.size - 22 - 65535);
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
  const tv = new DataView(tail.buffer);
  let end = tail.length - 22;
  while (end >= 0 && tv.getUint32(end, true) !== END) end--;
  if (end < 0) throw new Error('Not a project file');
  const count = tv.getUint16(end + 10, true);
  const directorySize = tv.getUint32(end + 12, true);
  const directoryAt = tv.getUint32(end + 16, true);
  if (directoryAt + directorySize > file.size || directorySize > 16 << 20) throw new Error('Damaged project file');
  const dir = new Uint8Array(await file.slice(directoryAt, directoryAt + directorySize).arrayBuffer());
  const view = new DataView(dir.buffer);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > dir.length || view.getUint32(at, true) !== CENTRAL) throw new Error('Damaged project file');
    if (view.getUint16(at + 10, true) !== 0) throw new Error('Unsupported project file');
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const skip = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    if (at + 46 + nameLength > dir.length) throw new Error('Damaged project file');
    const name = decoder.decode(dir.subarray(at + 46, at + 46 + nameLength));
    if (local + 30 > file.size) throw new Error('Damaged project file');
    const head = new DataView(await file.slice(local, local + 30).arrayBuffer());
    if (head.getUint32(0, true) !== LOCAL) throw new Error('Damaged project file');
    const start = local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    if (start + size > file.size) throw new Error('Damaged project file');
    const blob = file.slice(start, start + size);
    if ((await crc32Blob(blob)) !== crc) throw new Error('Damaged project file');
    entries.push({ name, blob });
    at += 46 + nameLength + skip;
    onProgress?.((i + 1) / count);
  }
  return entries;
}
