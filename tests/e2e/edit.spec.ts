import { expect, test, type Page } from '@playwright/test';
import { addAudio, addLayerMedia, addMedia, addText, frames, newProject, openApp, previewPixel, project, seek, select, settle, status, waitForPixel } from './helpers';

const NO_VIDEO = 'the WebKit build used for tests cannot play video files';

/** Centre of a timeline clip, in page coordinates. */
async function clipBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(`.clip[data-id="${id}"]`).boundingBox();
  if (!box) throw new Error('clip not on screen');
  return box;
}

async function dragBy(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  await frames(page);
}

test.describe('main track', () => {
  test('adds videos one after another and shows the frame under the playhead', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', NO_VIDEO);
    const errors = await openApp(page);
    await newProject(page);
    await addMedia(page, 'clip.mp4', 'red.png');
    const p = await project(page);
    expect(p.primary.map((c) => c.kind)).toEqual(['video', 'image']);
    expect(p.primary[0]!.duration).toBeCloseTo(3, 1);
    expect(p.primary[1]!.start).toBeCloseTo(p.primary[0]!.duration, 5);
    expect(p.media[0]!.hasAudio).toBe(true);
    // The test pattern has a red bar on the left and a cyan one on the right.
    await seek(page, 1);
    await waitForPixel(page, 0.08, 0.6, [255, 0, 0]);
    await seek(page, 4);
    await waitForPixel(page, 0.5, 0.5, [255, 48, 48]);
    // Black bars beside a 4:3 picture in a 16:9 frame.
    expect((await previewPixel(page, 0.02, 0.5)).slice(0, 3)).toEqual([0, 0, 0]);
    expect(errors).toEqual([]);
  });

  test('splits and trims at the playhead, with undo', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', NO_VIDEO);
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'clip.mp4');
    const id = (await project(page)).primary[0]!.id;
    await select(page, id);
    await seek(page, 1);
    await page.getByRole('button', { name: 'Trim / Split' }).click();
    await page.getByRole('button', { name: 'Split at Playhead' }).click();
    let p = await project(page);
    expect(p.primary).toHaveLength(2);
    expect(p.primary[0]!.duration).toBeCloseTo(1, 5);
    expect(p.primary[1]!.offset).toBeCloseTo(1, 5);
    expect(p.primary[1]!.start).toBeCloseTo(1, 5);

    // Remove the first half second of the first piece.
    await seek(page, 0.5);
    await page.getByRole('button', { name: 'Trim to Left of Playhead' }).click();
    p = await project(page);
    expect(p.primary[0]!.offset).toBeCloseTo(0.5, 5);
    expect(p.primary[0]!.duration).toBeCloseTo(0.5, 5);
    expect(p.primary[1]!.start).toBeCloseTo(0.5, 5);
    expect((await status(page)).time).toBeCloseTo(0, 5);

    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    p = await project(page);
    expect(p.primary).toHaveLength(1);
    expect(p.primary[0]!.duration).toBeCloseTo(3, 1);
    await page.getByRole('button', { name: 'Redo' }).click();
    expect((await project(page)).primary).toHaveLength(2);
  });

  test('the split buttons are off when the playhead is outside the clip', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png', 'green.png');
    const p = await project(page);
    await select(page, p.primary[0]!.id);
    await seek(page, 6);
    await page.getByRole('button', { name: 'Trim / Split' }).click();
    await expect(page.getByRole('button', { name: 'Split at Playhead' })).toBeDisabled();
    await seek(page, 2);
    await expect(page.getByRole('button', { name: 'Split at Playhead' })).toBeEnabled();
  });

  test('scrolling the timeline keeps the split buttons and the playhead in step', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png', 'green.png');
    const p = await project(page);
    const zoom = (await status(page)).zoom;
    await select(page, p.primary[0]!.id);
    await page.getByRole('button', { name: 'Trim / Split' }).click();
    const split = page.getByRole('button', { name: 'Split at Playhead' });
    await expect(split).toBeDisabled();
    const scrollTo = (seconds: number): Promise<void> =>
      page.locator('#tl-scroll').evaluate((node, left) => void (node.scrollLeft = left), zoom * seconds);
    await scrollTo(2);
    await expect(split).toBeEnabled();
    await scrollTo(6);
    await expect(split).toBeDisabled();
    // Even a stale button must not act outside the clip.
    await split.evaluate((node) => ((node as HTMLButtonElement).disabled = false));
    await page.getByRole('button', { name: 'Trim to Left of Playhead' }).evaluate((node) => {
      (node as HTMLButtonElement).disabled = false;
      (node as HTMLButtonElement).click();
    });
    expect((await project(page)).primary[0]!.duration).toBe(4.5);
  });

  test('dragging an end grip trims the clip', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', NO_VIDEO);
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'clip.mp4', 'red.png');
    const id = (await project(page)).primary[0]!.id;
    await page.locator(`.clip[data-id="${id}"]`).click();
    expect((await status(page)).selected).toBe(id);
    const zoom = (await status(page)).zoom;
    const grip = await page.locator(`.clip[data-id="${id}"] .grip.right`).boundingBox();
    await dragBy(page, grip!.x + grip!.width / 2, grip!.y + grip!.height / 2, -zoom, 0);
    let p = await project(page);
    expect(p.primary[0]!.duration).toBeCloseTo(2, 1);
    expect(p.primary[1]!.start).toBeCloseTo(p.primary[0]!.duration, 5);
    // A video cannot be stretched past the end of its file.
    const again = await page.locator(`.clip[data-id="${id}"] .grip.right`).boundingBox();
    await dragBy(page, again!.x + again!.width / 2, again!.y + again!.height / 2, zoom * 3, 0);
    p = await project(page);
    expect(p.primary[0]!.duration).toBeCloseTo(3, 1);
    expect(p.primary[0]!.duration).toBeLessThanOrEqual(p.media[0]!.duration + 1e-6);
  });

  test('dragging a clip past its neighbour changes the order', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png', 'green.png');
    const before = await project(page);
    const first = before.primary[0]!;
    const box = await clipBox(page, first.id);
    const zoom = (await status(page)).zoom;
    await dragBy(page, box.x + 30, box.y + box.height / 2, zoom * 7, 0);
    const after = await project(page);
    expect(after.primary.map((c) => c.id)).toEqual([before.primary[1]!.id, first.id]);
    expect(after.primary[0]!.start).toBe(0);
  });

  test('delete, duplicate and speed', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', NO_VIDEO);
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'clip.mp4');
    const id = (await project(page)).primary[0]!.id;
    await select(page, id);
    await page.getByRole('button', { name: 'Duplicate', exact: true }).first().click();
    expect((await project(page)).primary).toHaveLength(2);
    await select(page, id);
    await page.getByRole('button', { name: 'Speed' }).click();
    await page.getByRole('button', { name: '2x', exact: true }).click();
    let p = await project(page);
    expect(p.primary[0]!.speed).toBe(2);
    expect(p.primary[0]!.duration).toBeCloseTo(1.5, 1);
    expect(p.primary[1]!.start).toBeCloseTo(p.primary[0]!.duration, 5);
    await page.keyboard.press('Delete');
    p = await project(page);
    expect(p.primary).toHaveLength(1);
    expect(p.primary[0]!.start).toBe(0);
  });
});

test.describe('layers', () => {
  test('a picture layer is drawn over the main track and can be moved in the preview', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png');
    await addLayerMedia(page, 'green.png');
    await waitForPixel(page, 0.5, 0.5, [48, 255, 96]);
    const layer = (await project(page)).layers[0]!;
    expect(layer.transform.scale).toBe(0.5);
    expect((await status(page)).selected).toBe(layer.id);
    await expect(page.locator('#box')).toBeVisible();

    const frame = await page.locator('#frame').boundingBox();
    await dragBy(page, frame!.x + frame!.width / 2, frame!.y + frame!.height / 2, frame!.width * 0.2, 0);
    const moved = (await project(page)).layers[0]!;
    expect(moved.transform.x).toBeCloseTo(0.7, 1);
    await waitForPixel(page, 0.5, 0.5, [255, 48, 48]);
    await waitForPixel(page, 0.7, 0.5, [48, 255, 96]);

    // The corner handle resizes.
    const handle = await page.locator('#handle-scale').boundingBox();
    await dragBy(page, handle!.x + 15, handle!.y + 15, 40, 40);
    expect((await project(page)).layers[0]!.transform.scale).toBeGreaterThan(0.55);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await project(page)).layers[0]!.transform.scale).toBe(0.5);
  });

  test('text can be added, restyled and edited', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png');
    await addText(page, 'Hello');
    let text = (await project(page)).layers[0]!;
    expect(text.text!.text).toBe('Hello');
    await page.getByRole('button', { name: 'Text Color' }).click();
    await page.getByRole('radio', { name: '#4c9dff' }).click();
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#text-input').fill('Two\nlines');
    await page.locator('#text-ok').click();
    text = (await project(page)).layers[0]!;
    expect(text.text!.color).toBe('#4c9dff');
    expect(text.text!.text).toBe('Two\nlines');
  });

  test('a layer moves along the timeline and between rows by dragging', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png', 'green.png');
    await addText(page, 'A');
    await addText(page, 'B');
    let p = await project(page);
    expect(p.layers.map((c) => c.row)).toEqual([0, 1]);
    const zoom = (await status(page)).zoom;
    const b = p.layers[1]!;
    const box = await clipBox(page, b.id);
    // Past the end of A there is room on the first row.
    await dragBy(page, box.x + 40, box.y + box.height / 2, zoom * 5, -34);
    p = await project(page);
    const moved = p.layers.find((c) => c.id === b.id)!;
    expect(moved.start).toBeCloseTo(5, 1);
    expect(moved.row).toBe(0);
  });

  test('sound clips sit below and have a mixer', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png');
    await addAudio(page, 'tone.wav');
    const clip = (await project(page)).audio[0]!;
    expect(clip.duration).toBeCloseTo(4, 1);
    await page.getByRole('button', { name: 'Mixer' }).click();
    await page.getByRole('slider', { name: 'Volume' }).fill('50');
    await page.getByRole('button', { name: 'Mute' }).click();
    const after = (await project(page)).audio[0]!;
    expect(after.volume).toBe(0.5);
    expect(after.muted).toBe(true);
  });
});

test.describe('playing and scrolling', () => {
  test('play moves the playhead and stops at the end', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', NO_VIDEO);
    const errors = await openApp(page);
    await newProject(page);
    await addMedia(page, 'clip.mp4');
    await addAudio(page, 'tone.wav');
    await select(page, null);
    await seek(page, 2);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.waitForFunction(() => (window as unknown as { __reel: { status(): { time: number } } }).__reel.status().time > 2.5);
    await page.waitForFunction(() => !(window as unknown as { __reel: { status(): { playing: boolean } } }).__reel.status().playing, undefined, {
      timeout: 15_000,
    });
    expect((await status(page)).time).toBeCloseTo(4, 1);
    expect(errors).toEqual([]);
  });

  test('scrolling the timeline moves the playhead', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png', 'green.png');
    const zoom = (await status(page)).zoom;
    await page.locator('#tl-scroll').evaluate((node, left) => (node.scrollLeft = left), zoom * 3);
    await frames(page, 3);
    expect((await status(page)).time).toBeCloseTo(3, 1);
    await expect(page.locator('#timecode')).toHaveText('00:03.00');
    await page.locator('#jump-end').click();
    expect((await status(page)).time).toBeCloseTo(9, 5);
  });
});

test.describe('keeping work', () => {
  test('a project survives a reload and can be renamed, duplicated and deleted', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', NO_VIDEO);
    await openApp(page);
    test.skip(!(await status(page)).persistent, 'needs storage that survives a reload');
    await newProject(page, 'Keeper');
    await addMedia(page, 'clip.mp4', 'red.png');
    await addText(page, 'Saved');
    await settle(page);
    const before = await project(page);
    await page.reload();
    await page.locator('#home-create').waitFor();
    const tile = page.locator('.tile', { hasText: 'Keeper' });
    await expect(tile).toHaveCount(1);
    await tile.click();
    await page.locator('#editor').waitFor();
    const after = await project(page);
    expect(after.primary.map((c) => c.id)).toEqual(before.primary.map((c) => c.id));
    expect(after.layers[0]!.text!.text).toBe('Saved');
    await seek(page, 1);
    await waitForPixel(page, 0.08, 0.8, [255, 0, 0]);

    await page.locator('#back').click();
    await page.locator('#home-create').waitFor();
    await page.getByRole('button', { name: 'Options for Keeper', exact: true }).click();
    await page.locator('#tile-duplicate').click();
    await expect(page.locator('.tile', { hasText: 'Keeper copy' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Options for Keeper copy', exact: true }).click();
    await page.locator('#tile-rename').click();
    await page.locator('#ask-input').fill('Second');
    await page.locator('#ask-ok').click();
    await expect(page.locator('.tile', { hasText: 'Second' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Options for Second', exact: true }).click();
    await page.locator('#tile-delete').click();
    await page.locator('#ask-ok').click();
    await expect(page.locator('.tile', { hasText: 'Second' })).toHaveCount(0);
    await expect(page.locator('.tile', { hasText: 'Keeper' })).toHaveCount(1);
  });

  test('a project file opens as a new project with its media', async ({ page }) => {
    await openApp(page);
    await newProject(page, 'Carry');
    await addMedia(page, 'red.png');
    await addAudio(page, 'tone.wav');
    await select(page, null);
    await page.locator('#menu-button').click();
    await page.locator('#menu-backup').click();
    await page.locator('#ready').waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#ready-save').click()]);
    expect(download.suggestedFilename()).toBe('Carry.reel');
    const path = await download.path();
    await page.locator('#back').click();
    await page.locator('#home-create').waitFor();
    await page.locator('#file-project').setInputFiles({ name: 'Carry.reel', mimeType: 'application/octet-stream', buffer: (await import('node:fs')).readFileSync(path) });
    await expect(page.locator('.tile', { hasText: 'Carry' })).toHaveCount(2);
    await page.locator('.tile', { hasText: 'Carry' }).first().click();
    await page.locator('#editor').waitFor();
    const p = await project(page);
    expect(p.primary).toHaveLength(1);
    expect(p.audio).toHaveLength(1);
    await waitForPixel(page, 0.5, 0.5, [255, 48, 48]);
  });

  test('a project open in one tab cannot be opened or deleted from another', async ({ page, context }) => {
    await openApp(page);
    test.skip(!(await status(page)).persistent, 'needs storage shared between tabs');
    await newProject(page, 'Shared');
    await addMedia(page, 'red.png');
    await settle(page);
    const other = await context.newPage();
    await openApp(other);
    await other.locator('.tile', { hasText: 'Shared' }).click();
    await expect(other.locator('#toast')).toContainText('open in another tab');
    await expect(other.locator('#editor')).toBeHidden();
    await other.getByRole('button', { name: 'Options for Shared', exact: true }).click();
    await other.locator('#tile-delete').click();
    await other.locator('#ask-ok').click();
    await expect(other.locator('#toast')).toContainText('open in another tab');
    await expect(other.locator('.tile', { hasText: 'Shared' })).toHaveCount(1);
    // Once the first tab lets go, the second may open it.
    await page.locator('#back').click();
    await page.locator('#home-create').waitFor();
    await other.locator('.tile', { hasText: 'Shared' }).click();
    await other.locator('#editor').waitFor();
    expect((await project(other)).primary).toHaveLength(1);
  });

  test('a file that is not a project is refused', async ({ page }) => {
    await openApp(page);
    await page.locator('#file-project').setInputFiles({ name: 'x.reel', mimeType: 'application/octet-stream', buffer: Buffer.from('not a project at all, just some text') });
    await expect(page.locator('#toast')).toContainText('Not a project file');
    await expect(page.locator('.tile')).toHaveCount(1);
  });
});
