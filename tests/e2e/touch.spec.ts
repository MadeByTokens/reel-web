import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { addMedia, addText, frames, newProject, openApp, project, select, status } from './helpers';

// Real touch sequences, sent through the browser's debugging channel so that
// native scrolling takes part, as it does under a finger.

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ ...p, id })) });
}

async function swipe(page: Page, cdp: CDPSession, from: { x: number; y: number }, dx: number, holdMs: number): Promise<void> {
  await touch(cdp, 'touchStart', [from]);
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 1; i <= 10; i++) {
    await touch(cdp, 'touchMove', [{ x: from.x + (dx * i) / 10, y: from.y }]);
    await page.waitForTimeout(16);
  }
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(400);
  await frames(page);
}

test.describe('fingers on the timeline', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'touch sequences are sent through Chromium only');
  });

  test('a swipe scrolls the playhead and leaves the clip where it was', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png', 'green.png');
    await addText(page, 'Layer');
    await select(page, null);
    const cdp = await page.context().newCDPSession(page);
    const layer = (await project(page)).layers[0]!;
    const box = (await page.locator(`.clip[data-id="${layer.id}"]`).boundingBox())!;
    await swipe(page, cdp, { x: box.x + 200, y: box.y + box.height / 2 }, -160, 0);
    expect((await status(page)).time).toBeGreaterThan(1);
    expect((await project(page)).layers[0]!.start).toBe(layer.start);
    expect((await status(page)).selected).toBeNull();
  });

  test('press and hold, then drag, moves the clip without scrolling', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png', 'green.png');
    await addText(page, 'Layer');
    await select(page, null);
    const cdp = await page.context().newCDPSession(page);
    const layer = (await project(page)).layers[0]!;
    const zoom = (await status(page)).zoom;
    const box = (await page.locator(`.clip[data-id="${layer.id}"]`).boundingBox())!;
    await swipe(page, cdp, { x: box.x + 60, y: box.y + box.height / 2 }, zoom * 2, 600);
    const after = (await project(page)).layers[0]!;
    expect(after.start).toBeCloseTo(layer.start + 2, 1);
    expect((await status(page)).time).toBeCloseTo(0, 5);
    expect((await status(page)).canUndo).toBe(true);
  });

  test('a tap selects and the grip trims under a finger', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png', 'green.png');
    const cdp = await page.context().newCDPSession(page);
    const clip = (await project(page)).primary[0]!;
    const zoom = (await status(page)).zoom;
    const box = (await page.locator(`.clip[data-id="${clip.id}"]`).boundingBox())!;
    await touch(cdp, 'touchStart', [{ x: box.x + 50, y: box.y + 30 }]);
    await touch(cdp, 'touchEnd', []);
    await frames(page, 3);
    expect((await status(page)).selected).toBe(clip.id);
    const grip = (await page.locator(`.clip[data-id="${clip.id}"] .grip.right`).boundingBox())!;
    await swipe(page, cdp, { x: grip.x + grip.width / 2, y: grip.y + 30 }, -zoom * 2, 0);
    expect((await project(page)).primary[0]!.duration).toBeCloseTo(2.5, 1);
    expect((await status(page)).time).toBeCloseTo(0, 5);
  });

  test('two fingers pinch the timeline wider', async ({ page }) => {
    await openApp(page);
    await newProject(page);
    await addMedia(page, 'red.png', 'green.png');
    const cdp = await page.context().newCDPSession(page);
    const view = (await page.locator('#tl-view').boundingBox())!;
    const y = view.y + view.height - 30;
    const cx = view.x + view.width / 2;
    const before = (await status(page)).zoom;
    await touch(cdp, 'touchStart', [{ x: cx - 50, y }, { x: cx + 50, y }]);
    for (let i = 1; i <= 8; i++) {
      await touch(cdp, 'touchMove', [{ x: cx - 50 - i * 10, y }, { x: cx + 50 + i * 10, y }]);
      await page.waitForTimeout(16);
    }
    await touch(cdp, 'touchEnd', []);
    await frames(page, 3);
    expect((await status(page)).zoom).toBeGreaterThan(before * 1.5);
  });
});
