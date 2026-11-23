import { expect, test } from '@playwright/test';
import { addMedia, newProject, openApp, project } from './helpers';

test('opens and edits with no network once it has been loaded', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'offline mode is only exercised in Chromium here');
  await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await page.locator('#home-create').waitFor();
  await expect(page.locator('#fatal')).toBeHidden();
  await newProject(page, 'Offline');
  await addMedia(page, 'red.png');
  expect((await project(page)).primary).toHaveLength(1);
});
