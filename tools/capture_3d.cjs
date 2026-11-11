#!/usr/bin/env node
/* Frame-perfect capture of the 3D shots for the demo video.
 *
 * A screen recorder drops frames when the GPU is busy. This script
 * doesn't: it installs Playwright's fake clock, so requestAnimationFrame,
 * performance.now and timers only move when we advance them. Each video
 * frame is exactly 1/fps of page time, screenshotted and piped to ffmpeg
 * as H.264 / yuv420p / faststart. No app code is involved; it drives the
 * same buttons a visitor presses.
 *
 * Shots:
 *   demo      /demo/: Run the demo, then the broken -> fixed 3D replay
 *   teardown  /robots/<slug>/: 3D view, "Take it apart, step by step"
 *   film      /film/: the Omega1 teardown film, with its score muxed in
 *
 * Usage (serve the static build first, e.g. `npx serve web-next/out`
 * or `python3 -m http.server 8765 -d web-next/out`):
 *   node tools/capture_3d.cjs --shot demo --out demo-replay.mp4
 *   node tools/capture_3d.cjs --shot teardown --robot turtlebot3-burger --out teardown.mp4
 *   node tools/capture_3d.cjs --shot film --cut full --out omega1-teardown-20s.mp4
 *   node tools/capture_3d.cjs --shot film --cut short --out omega1-teardown-10s.mp4
 * Options: --base http://localhost:8765  --fps 60  --width 1920 --height 1080
 *          --dpr 1|2 (page pixel ratio; teardown defaults to 2 for a sharp 3D view)
 *          --sheet (also write <out>.sheet.png)
 * Needs: Node 20+, Playwright with Chromium, ffmpeg on PATH. The film shot
 * imports its TypeScript script directly, so it needs Node 22.18+ (built-in
 * type stripping). */
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const BASE = String(args.base || 'http://localhost:8765').replace(/\/$/, '');
const SHOT = String(args.shot || 'demo');
const FPS = Number(args.fps || 60);
const W = Number(args.width || 1920);
const H = Number(args.height || 1080);
const SCALE = Number(args.scale || 1);
// Device pixel ratio for the page; 2 renders the 3D canvas at twice the pixels.
const DPR = Number(args.dpr || (SHOT === 'teardown' || SHOT === 'film' ? 2 : 1));
const OUT = String(args.out || `${SHOT}.mp4`);
const ROBOT = String(args.robot || 'turtlebot3-burger');
const STEP = 1000 / FPS;

/* Hide page chrome that would sit on top of the shot. */
const CLEAN_CSS = `.chat-bar,.topbar{display:none!important}
*{caret-color:transparent!important}`;

async function settle(page, selector, { timeoutMs = 30000 } = {}) {
  // Advance page time in small steps, with a little real time between
  // them for network and React, until the selector is ready.
  const start = Date.now();
  for (;;) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return;
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for ' + selector);
    await page.clock.runFor(50);
    await new Promise((r) => setTimeout(r, 30));
  }
}

function ffmpegFor(out) {
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0d1118,format=yuv420p`;
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c)))));
  return { ff, done };
}

async function record(page, selector, seconds, label, cues = {}, out = OUT) {
  const frames = Math.round(seconds * FPS);
  const { ff, done } = ffmpegFor(out);
  const target = page.locator(selector).first();
  for (let i = 0; i < frames; i++) {
    if (cues[i]) await cues[i]();
    await page.clock.runFor(STEP);
    const png = await target.screenshot({ type: 'png', animations: 'allow' });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % FPS === 0) process.stdout.write(`\r${label}: ${i}/${frames} frames`);
  }
  ff.stdin.end();
  await done;
  process.stdout.write(`\r${label}: ${frames}/${frames} frames -> ${OUT}\n`);
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({
    viewport: { width: Math.round(W / SCALE), height: Math.round(H / SCALE) },
    deviceScaleFactor: SCALE * DPR,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  // Installed clocks keep flowing with real time; pause it so page time
  // moves only when we advance it (screenshots take real time).
  const t0 = Date.now();
  await page.clock.install({ time: t0 });
  await page.clock.pauseAt(t0 + 1000);

  if (SHOT === 'demo') {
    await page.goto(`${BASE}/demo/`, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: CLEAN_CSS });
    await settle(page, 'button:has-text("Run the demo")');
    await page.getByRole('button', { name: 'Run the demo' }).click();
    await settle(page, '.fixreplay canvas');
    // Let the page's own autoplay finish, then park the scrubber on the
    // broken pose so the clip starts there.
    await settle(page, 'button:has-text("Playing")');
    await settle(page, 'button:has-text("Play the fix")');
    await page.locator('.fixreplay').scrollIntoViewIfNeeded();
    await page.locator('.fixreplay-scrub input').fill('0');
    for (let i = 0; i < 10; i++) await page.clock.runFor(STEP);
    // 1.5 s on the broken pose, press Play (4.2 s replay), hold on the fixed pose.
    const playAt = Math.round(1.5 * FPS);
    await record(page, '.fixreplay', Number(args.seconds || 8.5), 'demo replay', {
      [playAt]: () => page.getByRole('button', { name: 'Play the fix' }).click(),
    });
  } else if (SHOT === 'teardown') {
    await page.goto(`${BASE}/robots/${ROBOT}/`, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: CLEAN_CSS });
    await settle(page, '#ta-view-3d');
    await page.locator('#ta-view-3d').scrollIntoViewIfNeeded();
    await page.locator('#ta-view-3d').click();
    await settle(page, '#ta-3d canvas');
    // Let the scene fit its camera before the first frame.
    for (let i = 0; i < 30; i++) await page.clock.runFor(STEP);
    await page.getByRole('button', { name: 'Take it apart, step by step' }).click();
    await page.locator('#ta-teardown').scrollIntoViewIfNeeded();
    const steps = await page.evaluate(() => {
      const m = /of (\d+)|(\d+) parts come off/.exec(document.querySelector('.ta-teardown-label')?.textContent || '');
      return m ? Number(m[1] || m[2]) : 5;
    });
    // 0.4 s before the first part, 1.8 s per part, then a 2.5 s hold.
    const secs = Number(args.seconds || 0.4 + steps * 1.8 + 2.5);
    await record(page, '#ta-3d', secs, `teardown ${ROBOT} (${steps} parts)`);
  } else if (SHOT === 'film') {
    // The film page plays from its own clock (performance.now), so the
    // paused fake clock makes every frame exact. Its score is rendered
    // from the same script file and muxed in after.
    const path = require('node:path');
    const fs = require('node:fs');
    const cut = String(args.cut || 'full');
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 18)) throw new Error(`--shot film needs Node 22.18+ to load omega1Film.ts (this is ${process.versions.node})`);
    const film = await import(path.join(__dirname, '..', 'web-next', 'src', 'lib', 'omega1Film.ts'));
    const css = CLEAN_CSS + '.demo-bar{display:none!important}.o1film-scene{border:0!important;border-radius:0!important}';
    // /film/ sits behind the sign-in gate; the no-account demo opens it.
    await page.addInitScript(() => localStorage.setItem('rf.demo.v1', JSON.stringify({ v: 1, since: new Date().toISOString() })));
    await page.goto(`${BASE}/film/`, { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: css });
    await settle(page, '.o1film-canvas canvas');
    await settle(page, 'button:has-text("Pause")');
    await page.getByRole('button', { name: cut === 'short' ? /^Short/ : /^Full/ }).click();
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.locator('.o1film-scrub').fill('0');
    await page.locator('.o1film-scene').scrollIntoViewIfNeeded();
    for (let i = 0; i < 10; i++) await page.clock.runFor(STEP);
    await page.getByRole('button', { name: /Play/ }).click();
    const secs = Number(args.seconds || film.filmLength(cut) + 0.5);
    const silent = OUT.replace(/\.mp4$/, '') + '.silent.mp4';
    await record(page, '.o1film-scene', secs, `omega1 film (${cut})`, {}, silent);
    const wav = OUT.replace(/\.mp4$/, '') + '.wav';
    fs.writeFileSync(wav, film.scoreWav(cut));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', OUT]);
    fs.unlinkSync(silent); fs.unlinkSync(wav);
    console.log('with score ->', OUT);
  } else {
    throw new Error('unknown --shot ' + SHOT + ' (use demo, teardown or film)');
  }

  await browser.close();
  if (args.sheet) {
    const sheet = OUT.replace(/\.mp4$/, '') + '.sheet.png';
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', OUT, '-vf', 'fps=1,scale=480:-1,tile=4x3', '-frames:v', '1', sheet]);
    console.log('contact sheet ->', sheet);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
