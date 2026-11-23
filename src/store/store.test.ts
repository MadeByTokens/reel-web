import { describe, expect, it } from 'vitest';
import { MemoryStore, loadDocument, saveDocument } from './store';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('documents saved in two slots', () => {
  it('returns nothing for a document never saved', async () => {
    const store = new MemoryStore();
    expect(await loadDocument(store, 'p/project')).toEqual({ text: null, seq: 0, damaged: false });
  });

  it('loads the newest copy', async () => {
    const store = new MemoryStore();
    let seq = 0;
    for (const text of ['one', 'two', 'three']) seq = await saveDocument(store, 'p/project', seq, text);
    const loaded = await loadDocument(store, 'p/project');
    expect(loaded.text).toBe('three');
    expect(loaded.seq).toBe(3);
    expect((await store.list('p')).sort()).toEqual(['project.0', 'project.1']);
  });

  it('falls back to the older copy when the newest write was cut short', async () => {
    const store = new MemoryStore();
    let seq = await saveDocument(store, 'p/project', 0, 'good');
    seq = await saveDocument(store, 'p/project', seq, 'newer, about to be damaged');
    const slot = `p/project.${seq % 2}`;
    const whole = new Uint8Array(await (await store.file(slot))!.arrayBuffer());
    await store.write(slot, whole.slice(0, whole.length - 5));
    const loaded = await loadDocument(store, 'p/project');
    expect(loaded.text).toBe('good');
    expect(loaded.damaged).toBe(false);
    // The next save goes over the damaged slot, not the good one.
    await saveDocument(store, 'p/project', loaded.seq, 'after');
    expect((await loadDocument(store, 'p/project')).text).toBe('after');
    expect(new TextDecoder().decode(await (await store.file('p/project.1'))!.arrayBuffer())).toContain('good');
  });

  it('reports damage when no copy can be read', async () => {
    const store = new MemoryStore();
    await store.write('p/project.0', bytes('rubbish'));
    await store.write('p/project.1', bytes('7\n123\n{"not":"matching its checksum"}'));
    expect(await loadDocument(store, 'p/project')).toEqual({ text: null, seq: 0, damaged: true });
  });

  it('removes a whole folder', async () => {
    const store = new MemoryStore();
    await store.write('projects/a/media/x.mp4', bytes('1'));
    await store.write('projects/a/project.0', bytes('1'));
    await store.write('projects/ab/project.0', bytes('1'));
    await store.remove('projects/a');
    expect(await store.list('projects')).toEqual(['ab']);
  });
});
