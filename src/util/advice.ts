// The words shown when something is more than this device can take.

import { fits, megabytes } from './device';

/** What to tell the user about a video that may be more than this device handles well, or ''. */
export function videoAdvice(name: string, width: number, height: number, smooth: boolean | null, limit: number): string {
  const large = width * height > limit;
  if (!large && smooth !== false) return '';
  const what = `${name.length > 30 ? `${name.slice(0, 29)}…` : name} is ${width} × ${height}`;
  return large
    ? `${what}, which is large for this device. If editing gets slow or Reel closes, use a smaller copy of it.`
    : `${what}, and this device says it cannot play it smoothly. A smaller copy will work better.`;
}

/**
 * Why a video of this size cannot be made here, or '' when it can. On disk it
 * has to fit in the storage that is free; without storage, in memory.
 */
export function exportProblem(bytes: number, onDisk: boolean, free: number | null, memoryLimit: number): string {
  if (onDisk) {
    // One tenth more than the estimate: the encoder does not hit its target exactly.
    if (fits(bytes * 1.1, free)) return '';
    return `Not enough storage: this video needs about ${megabytes(bytes)} and ${megabytes(free ?? 0)} is free. Lower the resolution or quality, or delete a project you no longer need.`;
  }
  if (bytes <= memoryLimit) return '';
  return `This browser is not letting Reel store files, so the video must fit in memory: about ${megabytes(memoryLimit)} on this device, and this one needs about ${megabytes(bytes)}. Lower the resolution or quality.`;
}
