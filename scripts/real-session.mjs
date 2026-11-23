// A manual session with real footage: import, scrub, play and export, printing the stats readout.
// Usage: npx vite preview --port 4180 &   then   node scripts/real-session.mjs <folder with a.mp4 and b.mp4> [chrome]
import { chromium } from '@playwright/test';
const [dir, channel] = process.argv.slice(2);
const browser = await chromium.launch({ channel: channel || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto('http://localhost:4180/?stats');
await page.locator('#home-create').click();
await page.locator('#new-name').fill('Real');
await page.getByRole('button', { name: 'Create', exact: true }).click();
await page.locator('#editor').waitFor();
let t = Date.now();
await page.locator('#file-media').setInputFiles([`${dir}/a.mp4`, `${dir}/b.mp4`]);
await page.waitForFunction(() => window.__reel.project().primary.length === 2 && document.getElementById('busy').hidden, undefined, { timeout: 120000 });
console.log('import ms', Date.now() - t, JSON.stringify(await page.evaluate(() => window.__reel.project().media)));
await page.locator('#file-layer').setInputFiles(`${dir}/b.mp4`);
await page.waitForFunction(() => window.__reel.project().layers.length === 1 && document.getElementById('busy').hidden);
await page.evaluate(() => window.__reel.select(null));
// Scrub: time several seeks.
for (const time of [5, 20.5, 38, 41, 55, 12]) {
  const t0 = Date.now();
  await page.evaluate((x) => window.__reel.seek(x), time);
  await page.waitForFunction(() => /seek\s+[1-9]/.test(document.getElementById('hud-text').textContent) || true);
  await page.waitForTimeout(700);
  console.log('seek', time, (await page.locator('#hud-text').textContent()).replace(/\n/g, ' | '));
}
await page.screenshot({ path: `${dir}/editor.png` });
// Play across the cut at 40 s.
await page.evaluate(() => window.__reel.seek(36));
await page.waitForTimeout(500);
await page.locator('#play').click();
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => window.__reel.status());
  console.log('play', st.time.toFixed(2), st.playing, st.audioClock, (await page.locator('#hud-text').textContent()).replace(/\n/g, ' | '));
}
await page.screenshot({ path: `${dir}/playing.png` });
await page.locator('#play').click();
// Trim the project to keep export short: split first clip at 6 s and delete the rest of it.
// Export at 720p.
await page.locator('#export-button').click();
await page.getByRole('radio', { name: '720p', exact: true }).click();
t = Date.now();
await page.getByRole('button', { name: 'Save as video' }).click();
await page.locator('#ready').waitFor({ timeout: 900000 });
console.log('export ms', Date.now() - t, await page.locator('#ready-name').textContent(), await page.locator('#ready-notes').textContent());
const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#ready-save').click()]);
await download.saveAs(`${dir}/out-${channel || 'chromium'}.${download.suggestedFilename().split('.').pop()}`);
await browser.close();
