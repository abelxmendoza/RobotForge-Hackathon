#!/usr/bin/env node
/* Critic pass for the "How does my robot work?" explainer (/explain/).
 *
 * The anatomy and teardown skills' review loop, rebuilt for RobotForge:
 *  1. a still in the middle of every step, saved as one contact sheet;
 *  2. a jump scan: every step scrubbed at 0.1 s, counting how many
 *     pixels change between neighbouring frames. A frame that changes
 *     3x more than the median of its step (and more than 1.5 % of the
 *     figure) is a jump, and the script exits non-zero.
 *
 * It drives the page's own seek hook (?render stops the page's clock
 * and window.__rfExplainer.seek(step, t) draws one exact frame), so
 * frames can be taken in any order and nothing depends on timing.
 *
 * Usage (serve the static build first, e.g.
 *   python3 -m http.server 8765 -d web-next/out):
 *   node tools/check_explainer.cjs --robot omega1 --out explain-omega1
 * Options: --base http://localhost:8765  --step 0.1  --width 1280 --height 900
 * Writes <out>-sheet.png and <out>-step<N>.png. Needs Playwright + Chromium. */
const { chromium } = require('playwright');
const fs = require('node:fs');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const BASE = String(args.base || 'http://localhost:8765').replace(/\/$/, '');
const ROBOT = String(args.robot || 'omega1');
const OUT = String(args.out || `explain-${ROBOT}`);
const DT = Number(args.step || 0.1);
const W = Number(args.width || 1280);
const H = Number(args.height || 900);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  /* The app is behind the sign-in-or-demo gate: enter demo mode, which
   * never calls the live Worker. */
  await ctx.addInitScript(() => { try { localStorage.setItem('rf.demo.v1', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/explain/?robot=${encodeURIComponent(ROBOT)}&render`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rfExplainer && window.__rfExplainer.steps > 0, null, { timeout: 20000 });
  const { steps, durations } = await page.evaluate(() => ({ steps: window.__rfExplainer.steps, durations: window.__rfExplainer.durations }));
  const stage = page.locator('.rx-stage');
  const main = page.locator('.rx');

  const seek = async (s, t) => {
    await page.evaluate(([s, t]) => window.__rfExplainer.seek(s, t), [s, t]);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };

  /* 1 · stills */
  const stills = [];
  for (let s = 0; s < steps; s++) {
    await seek(s, durations[s] / 2);
    const file = `${OUT}-step${s + 1}.png`;
    await main.screenshot({ path: file });
    stills.push(file);
  }

  /* 2 · jump scan (pixel diffs computed in a blank page's canvas) */
  const diffPage = await ctx.newPage();
  await diffPage.setContent('<canvas id=a></canvas><canvas id=b></canvas>');
  const diff = async (pa, pb) => diffPage.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const get = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
    const da = get(ia); const db = get(ib);
    let n = 0;
    for (let k = 0; k < da.length; k += 4) if (Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]) > 24) n++;
    return { changed: n, total: da.length / 4 };
  }, [pa.toString('base64'), pb.toString('base64')]);

  const report = [];
  let jumps = 0;
  for (let s = 0; s < steps; s++) {
    const counts = [];
    let prev = null;
    for (let t = 0; t <= durations[s] + 1e-9; t += DT) {
      await seek(s, Math.min(t, durations[s]));
      const shot = await stage.screenshot();
      if (prev) counts.push({ t: Number(t.toFixed(2)), ...(await diff(prev, shot)) });
      prev = shot;
    }
    const sorted = counts.map((c) => c.changed).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const total = counts[0]?.total || 1;
    const bad = counts.filter((c) => c.changed > Math.max(3 * median, 0.015 * total));
    jumps += bad.length;
    report.push({ step: s + 1, frames: counts.length + 1, medianChanged: median, maxChanged: sorted.at(-1) || 0, jumps: bad.map((b) => b.t) });
  }

  /* contact sheet */
  const sheet = await ctx.newPage();
  await sheet.setViewportSize({ width: 1600, height: 400 });
  await sheet.setContent(`<style>body{margin:0;background:#0b1420;display:grid;grid-template-columns:repeat(${Math.min(3, steps)},1fr);gap:8px;padding:8px}img{width:100%}</style>` +
    stills.map((f) => `<img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}">`).join(''));
  await sheet.screenshot({ path: `${OUT}-sheet.png`, fullPage: true });

  console.log(JSON.stringify({ robot: ROBOT, steps, report, jumps }, null, 1));
  await browser.close();
  process.exit(jumps ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
