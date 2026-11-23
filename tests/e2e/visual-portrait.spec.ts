import { test } from '@playwright/test';
import { addAudio, addLayerMedia, addMedia, addText, newProject, openApp, project, seek, select } from './helpers';

test.use({ viewport: { width: 820, height: 1180 } });

test('portrait screens', async ({ page }, info) => {
  const tag = info.project.name;
  await openApp(page);
  await newProject(page, 'Tall', '9:16');
  await addMedia(page, 'red.png', 'green.png');
  await addLayerMedia(page, 'green.png');
  await addText(page, 'Hello');
  await addAudio(page, 'tone.wav');
  await select(page, null);
  await seek(page, 1);
  await page.screenshot({ path: `test-results/shots/${tag}-20-portrait.png` });
  await select(page, (await project(page)).layers[1]!.id);
  await page.screenshot({ path: `test-results/shots/${tag}-21-portrait-options.png` });
});
