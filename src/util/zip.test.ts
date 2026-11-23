import { describe, expect, it } from 'vitest';
import { crc32, unzip, zip } from './zip';

const bytes = (text: string): Blob => new Blob([new TextEncoder().encode(text)]);
const text = async (blob: Blob): Promise<string> => new TextDecoder().decode(await blob.arrayBuffer());

describe('zip', () => {
  it('computes the standard checksum', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips entries', async () => {
    const file = await zip([
      { name: 'project.json', blob: bytes('{"a":1}') },
      { name: 'media/é.bin', blob: new Blob([new Uint8Array([0, 1, 2, 255])]) },
      { name: 'empty', blob: new Blob([]) },
    ]);
    const entries = await unzip(file);
    expect(entries.map((e) => e.name)).toEqual(['project.json', 'media/é.bin', 'empty']);
    expect(await text(entries[0]!.blob)).toBe('{"a":1}');
    expect([...new Uint8Array(await entries[1]!.blob.arrayBuffer())]).toEqual([0, 1, 2, 255]);
    expect(entries[2]!.blob.size).toBe(0);
  });

  it('refuses a file that is not a zip', async () => {
    await expect(unzip(bytes('hello, this is certainly not a zip file'))).rejects.toThrow('Not a project file');
  });

  it('refuses a truncated file', async () => {
    const file = await zip([{ name: 'a', blob: bytes('some content here') }]);
    await expect(unzip(file.slice(0, file.size - 10))).rejects.toThrow();
  });

  it('refuses a file whose content was changed', async () => {
    const file = await zip([{ name: 'a', blob: bytes('some content here') }]);
    const raw = new Uint8Array(await file.arrayBuffer());
    raw[35] = raw[35]! ^ 0xff;
    await expect(unzip(new Blob([raw]))).rejects.toThrow('Damaged');
  });
});
