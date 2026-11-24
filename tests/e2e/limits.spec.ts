import { expect, test } from '@playwright/test';
import { addMedia, newProject, openApp, project, status } from './helpers';

test.describe('limits of the device', () => {
  test('an export that never finished is reported, and that size is avoided next time', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('reel.unfinished', JSON.stringify({ what: 'export', detail: '1080p', pixels: 1920 * 1080 }));
    });
    await openApp(page);
    await expect(page.locator('#toast')).toContainText('Reel closed during the last export (1080p)');
    await newProject(page, 'Careful');
    await addMedia(page, 'red.png');
    await page.locator('#export-button').click();
    // The size that failed is no longer the one offered first, and choosing it says why.
    await expect(page.getByRole('radio', { name: '720p', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#export-info')).not.toContainText('closed during an export');
    await page.getByRole('radio', { name: '1080p', exact: true }).click();
    await expect(page.locator('#export-info')).toContainText('closed during an export this large');
    await expect(page.locator('#export-go')).toBeEnabled();
    // It was reported once: a second start is quiet.
    await page.reload();
    await page.locator('#home-create').waitFor();
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).toBeHidden();
  });

  test('a file or a video with no room left in storage is refused before work starts', async ({ page }) => {
    await page.addInitScript(() => {
      const real = navigator.storage.estimate.bind(navigator.storage);
      navigator.storage.estimate = async () => {
        const e = await real();
        const full = (window as unknown as { __full?: boolean }).__full;
        return full ? { ...e, quota: (e.usage ?? 0) + 1000 } : e;
      };
    });
    await openApp(page);
    test.skip(!(await status(page)).persistent, 'this browser gives the tests no storage to fill');
    await newProject(page, 'Full');
    await addMedia(page, 'red.png');
    await page.evaluate(() => ((window as unknown as { __full?: boolean }).__full = true));
    await page.locator('#file-media').setInputFiles('tests/fixtures/green.png');
    await expect(page.locator('#toast')).toContainText('not enough storage left for this file');
    expect((await project(page)).primary).toHaveLength(1);
    await page.locator('#export-button').click();
    await expect(page.locator('#export-info')).toContainText('Not enough storage: this video needs about');
    await expect(page.locator('#export-go')).toBeDisabled();
    // With room again, the same dialog lets the export go ahead.
    await page.locator('#export-cancel').click();
    await page.evaluate(() => ((window as unknown as { __full?: boolean }).__full = false));
    await page.locator('#export-button').click();
    await expect(page.locator('#export-go')).toBeEnabled();
    await expect(page.locator('#export-info')).toContainText('Keep Reel open');
  });

  test('a video this device says it cannot play smoothly is added with a warning', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the WebKit build used for tests cannot play video files');
    await page.addInitScript(() => {
      const real = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
      // The real answer is asked for first, so a question the browser rejects still fails here.
      navigator.mediaCapabilities.decodingInfo = async (config) => {
        const answer = await real(config);
        (window as unknown as { __asked?: unknown }).__asked = { config, supported: answer.supported };
        return { ...answer, smooth: false };
      };
    });
    await openApp(page);
    await newProject(page, 'Heavy');
    await addMedia(page, 'clip.mp4');
    await expect(page.locator('#toast')).toContainText('this device says it cannot play it smoothly');
    const asked = await page.evaluate(() => (window as unknown as { __asked: { config: { video: { contentType: string; width: number } }; supported: boolean } }).__asked);
    expect(asked.supported).toBe(true);
    expect(asked.config.video.contentType).toMatch(/^video\/mp4; codecs="avc1\./);
    expect(asked.config.video.width).toBeGreaterThan(0);
    // It is advice, not a refusal: the clip is there.
    expect((await project(page)).primary).toHaveLength(1);
  });
});
