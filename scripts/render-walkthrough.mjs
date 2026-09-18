/**
 * Renders docs/walkthrough.html to docs/walkthrough.mp4.
 *
 * How it works: Playwright drives the installed Chrome headless, opens the
 * walkthrough in "?once" mode (plays straight through, UI chrome hidden), and
 * captures a WebM of the 1920x1080 viewport while the page animates. The
 * bundled static ffmpeg then muxes it to H.264 MP4. The page's own clock
 * drives timing, so the recording lasts exactly as long as the presentation.
 *
 * Usage: node scripts/render-walkthrough.mjs
 */
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = path.join(root, 'docs', 'walkthrough.html');
const out = path.join(root, 'docs', 'walkthrough.mp4');

async function launch() {
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (e) {
      console.error(`channel "${channel}" unavailable: ${String(e.message).split('\n')[0]}`);
    }
  }
  return chromium.launch({ headless: true });
}

console.log('launching headless chrome…');
const browser = await launch();
const tmp = await mkdtemp(path.join(tmpdir(), 'compass-vid-'));

try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();

  await page.goto(pathToFileURL(html).href + '?once=1');
  console.log('recording walkthrough…');

  // Done when the page clock reads "<elapsed> / <total>" with both sides equal,
  // which the ?once mode guarantees by freezing on the final scene.
  await page.waitForFunction(
    () => {
      const t = document.getElementById('clock')?.textContent ?? '';
      const [a, b] = t.split('/').map((s) => s.trim());
      return a.length > 0 && a === b;
    },
    null,
    { timeout: 300_000, polling: 500 },
  );

  await page.waitForTimeout(1200); // let the last scene settle
  await context.close(); // flushes the WebM to disk
  console.log('capture complete, converting to mp4…');
} finally {
  await browser.close();
}

const [webm] = await readdir(tmp);
if (!webm) throw new Error('Playwright captured no video');
const src = path.join(tmp, webm);
console.log('captured:', webm, `(${Math.round((await stat(src)).size / 1024)} KB)`);

await new Promise((resolve, reject) => {
  const p = spawn(
    ffmpegPath,
    [
      '-y', '-i', src,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
      out,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let err = '';
  p.stderr.on('data', (d) => (err += d.toString()));
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}\n${err.slice(-800)}`))));
  p.on('error', reject);
});

await rm(tmp, { recursive: true, force: true });
const kb = Math.round((await stat(out)).size / 1024);
console.log(`wrote ${out} (${kb} KB)`);
