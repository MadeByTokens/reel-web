// What this device can take. The browser gives no reading of how much memory
// is left and no warning before it closes a page that used too much, so the
// limits here come from three things that every browser does offer: what it
// says about the device, how much storage it reports free, and a note of what
// was going on if the app was closed in the middle of heavy work.

const MB = 1 << 20;

export type DeviceClass = 'small' | 'medium' | 'large';

export interface DeviceFacts {
  /** Gigabytes, as the browser rounds it. Not every browser tells. */
  memoryGb?: number;
  cores?: number;
}

export interface Budget {
  /** The largest result that may be built in memory instead of on disk, in bytes. */
  memoryFile: number;
  /** A video frame with more pixels than this earns a warning. */
  videoPixels: number;
}

const BUDGETS: Record<DeviceClass, Budget> = {
  small: { memoryFile: 96 * MB, videoPixels: 1280 * 720 },
  medium: { memoryFile: 256 * MB, videoPixels: 1920 * 1080 },
  large: { memoryFile: 512 * MB, videoPixels: 3840 * 2160 },
};

export function classify(facts: DeviceFacts): DeviceClass {
  if (facts.memoryGb !== undefined) return facts.memoryGb <= 2 ? 'small' : facts.memoryGb <= 4 ? 'medium' : 'large';
  // No word on memory: only a device with very few processors is taken to be small.
  if (facts.cores !== undefined && facts.cores <= 2) return 'small';
  return 'medium';
}

export function deviceFacts(): DeviceFacts {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const facts: DeviceFacts = {};
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0) facts.memoryGb = nav.deviceMemory;
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0) facts.cores = nav.hardwareConcurrency;
  return facts;
}

export function budget(facts: DeviceFacts = deviceFacts()): Budget {
  return BUDGETS[classify(facts)];
}

/** Bytes of storage this site may still use, or null when the browser will not say. */
export async function freeSpace(): Promise<number | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate || typeof estimate.quota !== 'number' || typeof estimate.usage !== 'number') return null;
    return Math.max(0, estimate.quota - estimate.usage);
  } catch {
    return null;
  }
}

/** Room kept free so that saving the project itself never fails after a large file went in. */
export const RESERVE = 16 * MB;

/** True when `bytes` more can be stored. Unknown free space counts as enough. */
export function fits(bytes: number, free: number | null): boolean {
  return free === null || bytes + RESERVE <= free;
}

export function megabytes(bytes: number): string {
  const mb = bytes / 1e6;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return mb < 10 ? `${Math.max(0.1, mb).toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

export interface Unfinished {
  /** What was being done, e.g. "export". */
  what: string;
  /** Words for the user, e.g. "1080p". */
  detail: string;
  /** Size of the pictures being worked on, when that is what may have been too much. */
  pixels: number;
}

interface Stash {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Remembers heavy work across a crash. `begin` leaves a note that `end` takes
 * away; a note still there at the next start means the page went away in the
 * middle. What failed is then remembered as this device's own limit, until the
 * same thing succeeds.
 */
export class Watch {
  constructor(
    private readonly key: string,
    private readonly stash: Stash | null = safeStash(),
  ) {}

  begin(work: Unfinished): void {
    this.write(`${this.key}.unfinished`, JSON.stringify(work));
  }

  end(): void {
    this.remove(`${this.key}.unfinished`);
  }

  /** The work that never finished, if any. Reading it also clears it and learns from it. */
  takeUnfinished(): Unfinished | null {
    const text = this.read(`${this.key}.unfinished`);
    if (text === null) return null;
    this.end();
    try {
      const raw = JSON.parse(text) as Partial<Unfinished>;
      if (typeof raw.what !== 'string' || typeof raw.detail !== 'string' || typeof raw.pixels !== 'number') return null;
      const work: Unfinished = { what: raw.what.slice(0, 40), detail: raw.detail.slice(0, 40), pixels: raw.pixels };
      if (work.pixels > 0) {
        const known = this.limit(work.what);
        this.write(`${this.key}.limit.${work.what}`, String(known === null ? work.pixels : Math.min(known, work.pixels)));
      }
      return work;
    } catch {
      return null;
    }
  }

  /** The smallest size at which this kind of work has failed here, or null. */
  limit(what: string): number | null {
    const n = Number(this.read(`${this.key}.limit.${what}`));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /** Work of this size went through: a limit at or below it no longer holds. */
  succeeded(what: string, pixels: number): void {
    const known = this.limit(what);
    if (known !== null && pixels >= known) this.remove(`${this.key}.limit.${what}`);
  }

  private read(key: string): string | null {
    try {
      return this.stash?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.stash?.setItem(key, value);
    } catch {
      // Without storage there is simply no memory of it.
    }
  }

  private remove(key: string): void {
    try {
      this.stash?.removeItem(key);
    } catch {
      // As above.
    }
  }
}

function safeStash(): Stash | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
