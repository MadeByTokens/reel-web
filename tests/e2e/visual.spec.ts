import { test } from '@playwright/test';
import { addAudio, addLayerMedia, addMedia, addText, frames, newProject, openApp, project, seek, select } from './helpers';

// Screenshots for inspection by eye; nothing is asserted here.
const shot = (name: string, project: string): string => `test-results/shots/${project}-${name}.png`;

test('screens', async ({ page }, info) => {
  const tag = info.project.name;
  const errors = await openApp(page);
  await page.screenshot({ path: shot('01-home-empty', tag) });
  await page.locator('#home-create').click();
  await page.screenshot({ path: shot('02-new-project', tag) });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await newProject(page, 'Holiday');
  await page.screenshot({ path: shot('03-editor-empty', tag) });

  const video = info.project.name.includes('chromium');
  if (video) await addMedia(page, 'clip.webm', 'blue.webm');
  await addMedia(page, 'red.png', 'green.png');
  await addLayerMedia(page, 'green.png');
  await seek(page, 0.5);
  await addText(page, 'Hello Reel');
  await addAudio(page, 'tone.wav');
  await select(page, null);
  await seek(page, 1);
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('04-editor', tag) });

  const p = await project(page);
  await select(page, p.primary[0]!.id);
  await page.screenshot({ path: shot('05-clip-options', tag) });
  await page.getByRole('button', { name: 'Trim / Split' }).click();
  await page.screenshot({ path: shot('06-trim', tag) });
  await select(page, p.layers.find((c) => c.kind === 'text')!.id);
  await frames(page, 3);
  await page.screenshot({ path: shot('07-text-selected', tag) });
  await page.getByRole('button', { name: 'Font' }).click();
  await page.screenshot({ path: shot('08-font', tag) });
  await select(page, p.audio[0]!.id);
  await page.getByRole('button', { name: 'Mixer' }).click();
  await page.screenshot({ path: shot('09-mixer', tag) });
  await select(page, null);
  await page.locator('#export-button').click();
  await page.screenshot({ path: shot('10-export', tag) });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('#menu-button').click();
  await page.screenshot({ path: shot('11-menu', tag) });
  await page.locator('#menu-help').click();
  await page.screenshot({ path: shot('12-help', tag) });
  await page.locator('#help-close').click();
  await page.locator('#back').click();
  await page.locator('#home-create').waitFor();
  await page.screenshot({ path: shot('13-home', tag) });
  if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);
});
