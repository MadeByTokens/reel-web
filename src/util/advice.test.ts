import { describe, expect, it } from 'vitest';
import { exportProblem, videoAdvice } from './advice';
import { RESERVE } from './device';

const HD = 1920 * 1080;

describe('video advice', () => {
  it('says nothing about a video the device can take', () => {
    expect(videoAdvice('a.mp4', 1920, 1080, true, HD)).toBe('');
    expect(videoAdvice('a.mp4', 1280, 720, null, HD)).toBe('');
  });

  it('warns about a frame larger than the device budget', () => {
    expect(videoAdvice('a.mp4', 3840, 2160, true, HD)).toContain('3840 × 2160, which is large for this device');
  });

  it('warns when the device says it cannot play it smoothly', () => {
    expect(videoAdvice('a.mp4', 1920, 1080, false, HD)).toContain('cannot play it smoothly');
  });

  it('shortens a long name', () => {
    const text = videoAdvice(`${'x'.repeat(80)}.mp4`, 3840, 2160, null, HD);
    expect(text.length).toBeLessThan(170);
    expect(text).toContain('…');
  });
});

describe('export problem', () => {
  it('lets a video through when it fits on disk, or when free space is unknown', () => {
    expect(exportProblem(100e6, true, 100e6 * 1.1 + RESERVE, 1)).toBe('');
    expect(exportProblem(100e6, true, null, 1)).toBe('');
  });

  it('refuses one that does not fit on disk, with both sizes', () => {
    const text = exportProblem(100e6, true, 50e6, 1e12);
    expect(text).toContain('needs about 100 MB');
    expect(text).toContain('50 MB is free');
  });

  it('holds a video made without storage to the memory limit', () => {
    expect(exportProblem(100e6, false, null, 100e6)).toBe('');
    expect(exportProblem(101e6, false, 1e12, 100e6)).toContain('must fit in memory');
  });
});
