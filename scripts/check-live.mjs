// Checks the published site: loads it, makes a project, adds a picture and a
// sound, exports a video, then reloads with the network off.
// Usage: node scripts/check-live.mjs [url]
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'https://madebytokens.github.io/reel-web/';
const fixture = (name) => fileURLToPath(new URL(`../tests/fixtures/${name}`, import.meta.url));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
const external = [];
page.on('request', (r) => {
  if (!r.url().startsWith(url) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url());
});

await page.goto(url);
await page.locator('#home-create').click();
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.locator('#editor').waitFor();
await page.locator('#file-media').setInputFiles([fixture('clip.mp4'), fixture('red.png')]);
await page.waitForFunction(() => window.__reel.project().primary.length === 2 && document.getElementById('busy').hidden);
await page.locator('#file-audio').setInputFiles(fixture('tone.wav'));
await page.waitForFunction(() => window.__reel.project().audio.length === 1 && document.getElementById('busy').hidden);
await page.evaluate(() => window.__reel.select(null));
await page.locator('#export-button').click();
await page.getByRole('radio', { name: '360p', exact: true }).click();
await page.getByRole('button', { name: 'Save as video' }).click();
await page.locator('#ready').waitFor({ timeout: 120000 });
const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#ready-save').click()]);
console.log('exported', download.suggestedFilename(), await page.locator('#ready-name').textContent());
await page.evaluate(() => window.__reel.settled());
await page.evaluate(() => navigator.serviceWorker.ready);
await context.setOffline(true);
await page.reload();
await page.locator('.tile').nth(1).waitFor();
console.log('offline reload ok, projects listed:', (await page.locator('.tile').count()) - 1);
console.log('requests to other origins:', external.length ? external : 'none');
console.log('page errors:', problems.length ? problems : 'none');
await browser.close();
process.exit(problems.length || external.length ? 1 : 0);
