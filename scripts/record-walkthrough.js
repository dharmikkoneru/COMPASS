/**
 * Records docs/walkthrough.html to docs/walkthrough.mp4.
 *
 * Usage: node scripts/record-walkthrough.js
 */
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FFMPEG = path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
const HTML = path.join(__dirname, '..', 'docs', 'walkthrough.html');
const WEBM = path.join(__dirname, '..', 'docs', 'walkthrough-raw.webm');
const MP4 = path.join(__dirname, '..', 'docs', 'walkthrough.mp4');

(async () => {
  console.log('🎬 Launching browser...');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: path.join(__dirname, '..', 'docs'),
      size: { width: 1920, height: 1080 },
    },
  });
  const page = await context.newPage();

  console.log('📂 Opening walkthrough...');
  await page.goto(`file:///${HTML.replace(/\\/g, '/')}?once`);

  // Wait for scene 1 to appear
  await page.waitForSelector('.scene.active', { timeout: 5000 });
  console.log('▶  Recording started — 12 scenes, ~2m17s');

  // Wait for the walkthrough to reach the end (once mode)
  // The walkthrough auto-plays; we wait until it freezes on the last scene
  const totalDuration = 137000; // 137 seconds in ms
  const startTime = Date.now();

  // Poll for completion: last scene is active and playing has stopped
  await page.waitForFunction(
    () => {
      const scenes = document.querySelectorAll('.scene');
      const lastScene = scenes[scenes.length - 1];
      return lastScene && lastScene.classList.contains('active');
    },
    null,
    { timeout: totalDuration + 30000 }
  );

  // Extra 2s buffer for the last scene to render
  await page.waitForTimeout(2000);

  console.log('⏹  Recording complete. Saving video...');
  const video = page.video();
  await page.close();
  await context.close();
  await browser.close();

  // The video file is saved by Playwright
  const videoPath = await video.path();
  console.log(`📁 Raw video: ${videoPath}`);

  // Move the raw file if needed
  if (videoPath !== WEBM) {
    fs.copyFileSync(videoPath, WEBM);
  }

  // Convert WebM to MP4 using ffmpeg
  console.log('🔄 Converting to MP4...');
  try {
    execFileSync(FFMPEG, [
      '-i', WEBM,
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'fast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      MP4,
      '-y',
    ], { stdio: 'inherit' });
    console.log(`✅ Done! MP4 saved to: ${MP4}`);
    // Clean up raw file
    if (fs.existsSync(WEBM)) fs.unlinkSync(WEBM);
  } catch (err) {
    console.error('❌ ffmpeg conversion failed:', err.message);
    console.log(`📁 Raw WebM kept at: ${WEBM}`);
  }
})();
