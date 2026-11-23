import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { addAudio, addLayerMedia, addMedia, addText, frames, newProject, openApp, previewPixel, project, seek, select, status, waitForPixel } from './helpers';

const RED = [255, 48, 48];
const GREEN = [48, 255, 96];

interface Extra {
  keyframes?: { t: number; x: number }[];
  chroma?: { color: string; threshold: number };
  filter?: string;
  adjust?: { brightness: number };
  transition?: { type: string; duration: number };
  sticker?: string;
}
const extra = (clip: unknown): Extra => clip as Extra;

async function dragBy(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  await frames(page);
}

test.describe('transitions', () => {
  test('the slot between two clips sets a transition that mixes them', async ({ page }) => {
    const errors = await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png', 'green.png');
    expect((await status(page)).duration).toBeCloseTo(9, 5);
    await page.locator('.junction').click();
    await page.getByRole('button', { name: 'Crossfade' }).click();
    let p = await project(page);
    expect(extra(p.primary[1]).transition).toEqual({ type: 'crossfade', duration: 1 });
    expect(p.primary[1]!.start).toBeCloseTo(3.5, 5);
    expect((await status(page)).duration).toBeCloseTo(8, 5);
    await expect(page.locator('.junction')).toHaveClass(/set/);
    // Halfway through, each picture gives half of the colour.
    await seek(page, 4);
    await waitForPixel(page, 0.5, 0.5, [152, 152, 72], 16);
    await seek(page, 3);
    await waitForPixel(page, 0.5, 0.5, RED);
    await seek(page, 5);
    await waitForPixel(page, 0.5, 0.5, GREEN);

    await page.getByRole('slider', { name: 'Length' }).fill('2');
    p = await project(page);
    expect(p.primary[1]!.start).toBeCloseTo(2.5, 5);

    // A slide pushes the old picture out to the left as the new one comes in from the right.
    await page.getByRole('button', { name: 'Slide left' }).click();
    await seek(page, 3.5);
    // (The green picture is a narrow one, so there is black between the two.)
    await waitForPixel(page, 0.25, 0.5, RED);
    await waitForPixel(page, 0.9, 0.5, GREEN);
    expect((await previewPixel(page, 0.5, 0.5)).slice(0, 3)).toEqual([0, 0, 0]);

    await page.getByRole('button', { name: 'None' }).click();
    expect((await status(page)).duration).toBeCloseTo(9, 5);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(extra((await project(page)).primary[1]).transition?.type).toBe('slide-left');
    expect(errors).toEqual([]);
  });

  test('layers stay with their clip when the main track changes', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png', 'green.png');
    await seek(page, 5);
    await addText(page, 'Over green');
    await addAudio(page, 'tone.wav');
    let p = await project(page);
    expect(p.layers[0]!.start).toBeCloseTo(5, 5);
    await select(page, p.primary[0]!.id);
    await page.getByRole('button', { name: 'Delete clip' }).click();
    p = await project(page);
    expect(p.primary).toHaveLength(1);
    expect(p.layers[0]!.start).toBeCloseTo(0.5, 5);
    expect(p.audio[0]!.start).toBeCloseTo(0.5, 5);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await project(page)).layers[0]!.start).toBeCloseTo(5, 5);
  });
});

test.describe('layer effects', () => {
  test('keyframes make a layer glide from one place to another', async ({ page }) => {
    const errors = await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png');
    await addLayerMedia(page, 'green.png');
    await page.getByRole('button', { name: 'Keyframes' }).click();
    await page.getByRole('button', { name: 'Add keyframe' }).click();
    await expect(page.getByRole('button', { name: 'Remove keyframe' })).toBeVisible();
    await seek(page, 2);
    await expect(page.getByRole('button', { name: 'Add keyframe' })).toBeVisible();
    const frame = (await page.locator('#frame').boundingBox())!;
    await dragBy(page, frame.x + frame.width / 2, frame.y + frame.height / 2, frame.width * 0.2, 0);
    const layer = (await project(page)).layers[0]!;
    const keys = extra(layer).keyframes!;
    expect(keys.map((k) => k.t)).toEqual([0, 2]);
    expect(keys[1]!.x).toBeCloseTo(0.7, 1);
    await expect(page.locator(`.clip[data-id="${layer.id}"] .keys i`)).toHaveCount(2);

    // At the first keyframe the layer is in the middle, at the second to the right, and halfway in between.
    await seek(page, 0);
    await waitForPixel(page, 0.5, 0.5, GREEN);
    await waitForPixel(page, 0.7, 0.5, RED);
    await seek(page, 2);
    await waitForPixel(page, 0.7, 0.5, GREEN);
    await waitForPixel(page, 0.5, 0.5, RED);
    await seek(page, 1);
    await waitForPixel(page, 0.6, 0.5, GREEN);
    await waitForPixel(page, 0.5, 0.5, RED);
    await waitForPixel(page, 0.7, 0.5, RED);
    // The handles follow the layer.
    const box = (await page.locator('#box').boundingBox())!;
    expect((box.x + box.width / 2 - frame.x) / frame.width).toBeCloseTo(0.6, 1);

    await page.getByRole('button', { name: 'Previous' }).click();
    expect((await status(page)).time).toBe(0);
    await page.getByRole('button', { name: 'Remove all' }).click();
    expect(extra((await project(page)).layers[0]).keyframes).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('chroma key removes the colour picked from the picture', async ({ page }) => {
    const errors = await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png');
    await addLayerMedia(page, 'green.png');
    await waitForPixel(page, 0.5, 0.5, GREEN);
    await page.getByRole('button', { name: 'Chroma Key' }).click();
    await page.getByRole('button', { name: 'Pick from picture' }).click();
    const frame = (await page.locator('#frame').boundingBox())!;
    await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2);
    const chroma = extra((await project(page)).layers[0]).chroma!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(chroma.color.slice(i, i + 2), 16));
    expect(Math.abs(r! - 48) + Math.abs(g! - 255) + Math.abs(b! - 96)).toBeLessThan(30);
    // The layer's own colour is gone, so the main track shows through it.
    await waitForPixel(page, 0.5, 0.5, RED);
    // A key colour far from the picture's leaves it alone.
    await page.getByRole('button', { name: 'Blue' }).click();
    await waitForPixel(page, 0.5, 0.5, GREEN);
    await page.getByRole('button', { name: 'On', exact: true }).click();
    expect(extra((await project(page)).layers[0]).chroma).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('filters and adjustments change the colours', async ({ page }) => {
    const errors = await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png');
    await select(page, (await project(page)).primary[0]!.id);
    await page.getByRole('button', { name: 'Color Filter' }).click();
    await page.getByRole('button', { name: 'Mono' }).click();
    expect(extra((await project(page)).primary[0]).filter).toBe('Mono');
    await page.waitForFunction(() => {
      const canvas = document.getElementById('preview') as HTMLCanvasElement;
      const d = canvas.getContext('2d')!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return d[0]! > 40 && Math.abs(d[0]! - d[1]!) < 6 && Math.abs(d[1]! - d[2]!) < 6;
    });
    await page.getByRole('button', { name: 'None' }).click();
    await waitForPixel(page, 0.5, 0.5, RED);
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Adjustment' }).click();
    await page.getByRole('slider', { name: 'Brightness' }).fill('-100');
    expect(extra((await project(page)).primary[0]).adjust!.brightness).toBe(-1);
    await page.waitForFunction(() => {
      const canvas = document.getElementById('preview') as HTMLCanvasElement;
      const d = canvas.getContext('2d')!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return d[0]! < 150 && d[1]! < 10;
    });
    await page.getByRole('button', { name: 'Reset' }).click();
    await waitForPixel(page, 0.5, 0.5, RED);
    expect(errors).toEqual([]);
  });

  test('a sticker is added from the picker and can be changed', async ({ page }) => {
    const errors = await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png');
    await page.locator('#add-layer').click();
    await page.locator('#layer-sticker').click();
    await page.getByRole('tab', { name: 'Animals' }).click();
    await page.getByRole('button', { name: 'Sticker 🐶' }).click();
    let layer = (await project(page)).layers[0]!;
    expect(layer.kind).toBe('sticker');
    expect(extra(layer).sticker).toBe('🐶');
    await expect(page.locator('#box')).toBeVisible();
    await page.getByRole('button', { name: 'Change' }).click();
    await page.getByRole('tab', { name: 'Faces' }).click();
    await page.getByRole('button', { name: 'Sticker 😀' }).click();
    layer = (await project(page)).layers[0]!;
    expect(extra(layer).sticker).toBe('😀');
    expect(errors).toEqual([]);
  });
});

test('a sound clip shows its waveform', async ({ page }) => {
  const errors = await openApp(page);
  await newProject(page);
  await addMedia(page, 'red.png');
  await addAudio(page, 'tone.wav');
  await page.waitForFunction(() => {
    const wave = document.querySelector<HTMLCanvasElement>('.clip.audio canvas.wave');
    if (!wave || wave.hidden || !wave.width) return false;
    const data = wave.getContext('2d')!.getImageData(0, 0, wave.width, wave.height).data;
    let drawn = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) drawn++;
    // More than the thin line that silence would leave.
    return drawn > wave.width * 3;
  });
  expect(errors).toEqual([]);
});

test('exports transitions, effects and stickers', async ({ page }) => {
  const errors = await openApp(page);
  await newProject(page, 'Effects', '1:1');
  await addMedia(page, 'red.png', 'green.png');
  const supported = await page.evaluate(() => typeof VideoEncoder !== 'undefined');
  test.skip(!supported, 'this browser has no video encoder');
  await page.locator('.junction').click();
  await page.getByRole('button', { name: 'Wipe left' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Color Filter' }).click();
  await page.getByRole('button', { name: 'Sepia' }).click();
  await select(page, null);
  await page.locator('#add-layer').click();
  await page.locator('#layer-sticker').click();
  await page.getByRole('button', { name: 'Sticker 😀' }).click();
  await page.getByRole('button', { name: 'Keyframes' }).click();
  await page.getByRole('button', { name: 'Add keyframe' }).click();
  await select(page, null);
  await page.locator('#export-button').click();
  await page.getByRole('radio', { name: '360p', exact: true }).click();
  await page.getByRole('button', { name: 'Save as video' }).click();
  await page.locator('#ready').waitFor({ timeout: 120_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#ready-save').click()]);
  mkdirSync('test-results/exports', { recursive: true });
  await download.saveAs(`test-results/exports/${test.info().project.name}-${download.suggestedFilename()}`);
  expect(download.suggestedFilename()).toMatch(/^Effects\.(mp4|webm)$/);
  expect(errors).toEqual([]);
});
