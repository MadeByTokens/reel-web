import { describe, expect, it } from 'vitest';
import { budget, classify, fits, megabytes, RESERVE, Watch } from './device';

function stash(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('device class', () => {
  it('follows reported memory when there is any', () => {
    expect(classify({ memoryGb: 1 })).toBe('small');
    expect(classify({ memoryGb: 2, cores: 8 })).toBe('small');
    expect(classify({ memoryGb: 4 })).toBe('medium');
    expect(classify({ memoryGb: 8, cores: 2 })).toBe('large');
  });

  it('assumes the middle when the browser says nothing', () => {
    expect(classify({})).toBe('medium');
    expect(classify({ cores: 8 })).toBe('medium');
    expect(classify({ cores: 2 })).toBe('small');
  });

  it('gives smaller devices smaller budgets', () => {
    const small = budget({ memoryGb: 1 });
    const large = budget({ memoryGb: 8 });
    expect(small.memoryFile).toBeLessThan(large.memoryFile);
    expect(small.videoPixels).toBeLessThan(large.videoPixels);
  });
});

describe('storage room', () => {
  it('keeps a reserve and trusts an unknown amount', () => {
    expect(fits(100, null)).toBe(true);
    expect(fits(100, 100 + RESERVE)).toBe(true);
    expect(fits(101, 100 + RESERVE)).toBe(false);
    expect(fits(1, 0)).toBe(false);
  });

  it('words sizes', () => {
    expect(megabytes(2_500_000)).toBe('2.5 MB');
    expect(megabytes(250_000_000)).toBe('250 MB');
    expect(megabytes(3_200_000_000)).toBe('3.2 GB');
  });
});

describe('watch', () => {
  it('reports nothing after work that ended', () => {
    const s = stash();
    const watch = new Watch('t', s);
    watch.begin({ what: 'export', detail: '1080p', pixels: 100 });
    watch.end();
    expect(new Watch('t', s).takeUnfinished()).toBeNull();
    expect(watch.limit('export')).toBeNull();
  });

  it('reports work that never ended, once, and learns its size', () => {
    const s = stash();
    new Watch('t', s).begin({ what: 'export', detail: '1080p', pixels: 2_000_000 });
    const next = new Watch('t', s);
    expect(next.takeUnfinished()).toEqual({ what: 'export', detail: '1080p', pixels: 2_000_000 });
    expect(next.takeUnfinished()).toBeNull();
    expect(next.limit('export')).toBe(2_000_000);
  });

  it('keeps the smallest size that failed and forgets it after a success', () => {
    const s = stash();
    const watch = new Watch('t', s);
    watch.begin({ what: 'export', detail: '1080p', pixels: 2_000_000 });
    watch.takeUnfinished();
    watch.begin({ what: 'export', detail: '720p', pixels: 900_000 });
    watch.takeUnfinished();
    watch.begin({ what: 'export', detail: '1080p', pixels: 2_000_000 });
    watch.takeUnfinished();
    expect(watch.limit('export')).toBe(900_000);
    watch.succeeded('export', 500_000);
    expect(watch.limit('export')).toBe(900_000);
    watch.succeeded('export', 900_000);
    expect(watch.limit('export')).toBeNull();
  });

  it('ignores a damaged note and a broken store', () => {
    const s = stash();
    s.setItem('t.unfinished', '{nonsense');
    expect(new Watch('t', s).takeUnfinished()).toBeNull();
    expect(s.data.has('t.unfinished')).toBe(false);
    const broken = {
      getItem: (): string | null => {
        throw new Error('no');
      },
      setItem: (): void => {
        throw new Error('no');
      },
      removeItem: (): void => {
        throw new Error('no');
      },
    };
    const watch = new Watch('t', broken);
    watch.begin({ what: 'export', detail: '', pixels: 1 });
    expect(watch.takeUnfinished()).toBeNull();
    expect(watch.limit('export')).toBeNull();
  });
});
