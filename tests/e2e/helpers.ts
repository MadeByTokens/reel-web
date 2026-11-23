import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

export interface Status {
  open: boolean;
  project: string | null;
  time: number;
  duration: number;
  playing: boolean;
  selected: string | null;
  canUndo: boolean;
  canRedo: boolean;
  persistent: boolean;
  zoom: number;
  audioClock: boolean;
}

export interface ClipData {
  id: string;
  kind: string;
  start: number;
  duration: number;
  offset: number;
  speed: number;
  row: number;
  volume: number;
  muted: boolean;
  fill: boolean;
  transform: { x: number; y: number; scale: number; rotation: number; opacity: number; flipH: boolean; flipV: boolean };
  text?: { text: string; color: string; font: string };
}

export interface ProjectData {
  name: string;
  width: number;
  height: number;
  media: { id: string; kind: string; name: string; duration: number; hasAudio: boolean }[];
  primary: ClipData[];
  layers: ClipData[];
  audio: ClipData[];
}

interface Hooks {
  status(): Status;
  project(): ProjectData;
  seek(t: number): void;
  select(id: string | null): void;
  settled(): Promise<void>;
  setZoom(pps: number): void;
}

const hooks = (): Hooks => (window as unknown as { __reel: Hooks }).__reel;

export const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/** Opens the app on the projects screen and returns the list that collects page errors. */
export async function openApp(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/${query}`);
  await page.waitForFunction(() => !!(window as unknown as { __reel?: unknown }).__reel);
  await page.locator('#home-create').waitFor();
  return errors;
}

export async function newProject(page: Page, name = 'Test', aspect = '16:9'): Promise<void> {
  await page.locator('#home-create').click();
  await page.locator('#new-name').fill(name);
  await page.getByRole('radio', { name: aspect, exact: true }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('#editor').waitFor();
  await frames(page);
}

export function status(page: Page): Promise<Status> {
  return page.evaluate(() => (window as unknown as { __reel: Hooks }).__reel.status());
}

export function project(page: Page): Promise<ProjectData> {
  return page.evaluate(() => (window as unknown as { __reel: Hooks }).__reel.project());
}

export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __reel: Hooks }).__reel.settled());
}

export async function frames(page: Page, n = 2): Promise<void> {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise((r) => requestAnimationFrame(r));
  }, n);
}

export async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate((time) => (window as unknown as { __reel: Hooks }).__reel.seek(time), t);
  await frames(page, 3);
}

export async function select(page: Page, id: string | null): Promise<void> {
  await page.evaluate((clip) => (window as unknown as { __reel: Hooks }).__reel.select(clip), id);
  await frames(page);
}

async function waitForClips(page: Page, track: 'primary' | 'layers' | 'audio', count: number): Promise<void> {
  await page.waitForFunction(
    ([t, n]) => {
      const reel = (window as unknown as { __reel: Hooks }).__reel;
      return (reel.project()?.[t as 'primary'] ?? []).length === n && document.getElementById('busy')!.hidden;
    },
    [track, count] as const,
  );
  await frames(page);
}

/** Adds files to the main track through the Media button's file chooser. */
export async function addMedia(page: Page, ...names: string[]): Promise<void> {
  const before = (await project(page)).primary.length;
  await page.locator('#file-media').setInputFiles(names.map(fixture));
  await waitForClips(page, 'primary', before + names.length);
}

export async function addLayerMedia(page: Page, name: string): Promise<void> {
  const before = (await project(page)).layers.length;
  await page.locator('#file-layer').setInputFiles(fixture(name));
  await waitForClips(page, 'layers', before + 1);
}

export async function addAudio(page: Page, name: string): Promise<void> {
  const before = (await project(page)).audio.length;
  await page.locator('#file-audio').setInputFiles(fixture(name));
  await waitForClips(page, 'audio', before + 1);
}

export async function addText(page: Page, text: string): Promise<void> {
  const before = (await project(page)).layers.length;
  await select(page, null);
  await page.locator('#add-layer').click();
  await page.locator('#layer-text').click();
  await page.locator('#text-input').fill(text);
  await page.locator('#text-ok').click();
  await waitForClips(page, 'layers', before + 1);
}

/** A pixel of the preview, at a position given as fractions of the frame. */
export function previewPixel(page: Page, fx: number, fy: number): Promise<number[]> {
  return page.evaluate(
    ([x, y]) => {
      const canvas = document.getElementById('preview') as HTMLCanvasElement;
      const data = canvas.getContext('2d')!.getImageData(Math.floor(x! * canvas.width), Math.floor(y! * canvas.height), 1, 1).data;
      return [...data];
    },
    [fx, fy],
  );
}

/** Waits until a preview pixel is close to a colour: videos take a moment to show a frame. */
export async function waitForPixel(page: Page, fx: number, fy: number, rgb: number[], tolerance = 40): Promise<void> {
  await page.waitForFunction(
    ([x, y, r, g, b, tol]) => {
      const canvas = document.getElementById('preview') as HTMLCanvasElement;
      const d = canvas.getContext('2d')!.getImageData(Math.floor(x! * canvas.width), Math.floor(y! * canvas.height), 1, 1).data;
      return Math.abs(d[0]! - r!) <= tol! && Math.abs(d[1]! - g!) <= tol! && Math.abs(d[2]! - b!) <= tol!;
    },
    [fx, fy, rgb[0]!, rgb[1]!, rgb[2]!, tolerance],
  );
}

export function close(a: number, b: number, tolerance = 0.02): boolean {
  return Math.abs(a - b) <= tolerance;
}

export { hooks as _hooks };
