import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { addAudio, addMedia, addText, newProject, openApp, select, status } from './helpers';

async function exportVideo(page: Page, resolution = '360p'): Promise<{ name: string; path: string }> {
  await select(page, null);
  await page.locator('#export-button').click();
  await page.getByRole('radio', { name: resolution, exact: true }).click();
  await page.getByRole('button', { name: 'Save as video' }).click();
  await page.locator('#ready').waitFor({ timeout: 120_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#ready-save').click()]);
  mkdirSync('test-results/exports', { recursive: true });
  const path = `test-results/exports/${test.info().project.name}-${download.suggestedFilename()}`;
  await download.saveAs(path);
  return { name: download.suggestedFilename(), path };
}

test('exports a video with picture and sound', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'the WebKit build used for tests cannot play video files');
  const errors = await openApp(page);
  await newProject(page, 'Out');
  await addMedia(page, 'clip.mp4', 'blue.webm');
  await addText(page, 'Title');
  await addAudio(page, 'tone.wav');
  expect((await status(page)).duration).toBeCloseTo(5, 1);
  const file = await exportVideo(page);
  expect(file.name).toMatch(/^Out\.(mp4|webm)$/);
  expect(errors).toEqual([]);
});

test('falls back to uncompressed sound when the browser has no sound encoder', async ({ page }) => {
  await openApp(page);
  await newProject(page, 'Plain');
  await addMedia(page, 'red.png');
  await addAudio(page, 'tone.wav');
  const supported = await page.evaluate(() => typeof VideoEncoder !== 'undefined');
  test.skip(!supported, 'this browser has no video encoder');
  await page.evaluate(() => {
    (window as unknown as { AudioEncoder: unknown }).AudioEncoder = undefined;
  });
  const file = await exportVideo(page);
  expect(file.name).toMatch(/^Plain\.(mov|webm)$/);
  await expect(page.locator('#ready-notes')).toContainText(/QuickTime|silent/);
});

test('exports pictures only', async ({ page }) => {
  const errors = await openApp(page);
  await newProject(page, 'Stills', '1:1');
  await addMedia(page, 'red.png', 'green.png');
  const supported = await page.evaluate(() => typeof VideoEncoder !== 'undefined');
  test.skip(!supported, 'this browser has no video encoder');
  const file = await exportVideo(page);
  expect(file.name).toMatch(/^Stills\.(mp4|webm)$/);
  expect(errors).toEqual([]);
});
