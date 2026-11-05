/* The first sample robot: Omega1, Abel's own Freenove 4WD rover.
 *
 * Abel's direction, 2026-11-04: demo-mode users AND new account
 * users both get the Omega1 repo link, presented as the first robot
 * sample they can run through Wrench chat to test the app. The
 * import itself is the test — Omega1 is NOT pre-seeded anywhere;
 * every surface points at this one link, and the existing repo
 * importer (lib/repoLink.ts detection + /import/) does the rest.
 *
 * This module is the SINGLE source for the link and the copy —
 * same pattern as ASSISTANT_NAME in lib/handoff.ts. No surface
 * hard-codes the URL; a pin test (tests/test_omega1_sample.py)
 * asserts the constant and that the surfaces import it.
 *
 * Honesty, baked into the copy below:
 *  - Omega1 is a manual-control rover today — no autonomy claims.
 *  - Sizes from the repo are documented/estimated until measured;
 *    the import never presents them as measurements. */

export const SAMPLE_REPO_URL = 'https://github.com/abelxmendoza/Omega-Code';
export const SAMPLE_REPO_REF = 'abelxmendoza/Omega-Code';

export const SAMPLE_ROBOT_NAME = 'Omega1';

/* The chip Wrench offers first while the visitor's store is empty. */
export const SAMPLE_CHIP = 'Try the sample robot: Omega1';

export const SAMPLE_HEADING = 'Start with a sample robot — Omega1';

export const SAMPLE_BLURB =
  "This is Omega1, a real Freenove 4WD rover (Raspberry Pi 4B) — the " +
  'first robot sample for RobotForge. Paste its repo link into Wrench and ' +
  'RobotForge will read the repo, build its digital twin, and save it to ' +
  'your Workshop so you can program, change and simulate it. It\'s a sample ' +
  "to test the app with — change it, break it, delete it; it's yours.";

/* The exact message the chip and the "Send it to Wrench" buttons
 * send: it carries the full repo link, so Wrench's existing
 * repo-link detection (lib/repoLink.ts) fires and the importer
 * opens — no new plumbing. */
export const SAMPLE_PROMPT =
  'Try the sample robot: Omega1 — import its repo into my Workshop: ' +
  SAMPLE_REPO_URL;

/* Demo mode only: the recorded import path, stated plainly. */
export const SAMPLE_DEMO_NOTE =
  'In the demo, the import reads the repo directly — ' +
  'the live AI hardware pass is signed-in only.';

/* Sample / example / first-robot asks. The recorded engine
 * (components/chat/engine.ts, wrench.ts) is import-locked — its
 * eval harnesses type-strip it in node and pin "may import only
 * ./engine" — so the chat shell (ChatDock) consults this detector
 * and serves the recorded card below BEFORE any live path. Still
 * recorded and deterministic, so it answers identically in demo
 * mode, where the live model is never called. */
export function isSampleAsk(text: string): boolean {
  const n = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    /\bsample\b/.test(n) ||
    /\bexample\b/.test(n) ||
    n.indexOf('first robot') >= 0 ||
    n.indexOf('what should i try') >= 0
  );
}

/* The recorded answer for those asks, built from the constants
 * above. The link renders as a link; the chat's per-message Copy
 * affordance covers the copy step. */
export function sampleAnswerHtml(): string {
  return (
    '<p><strong>' + SAMPLE_HEADING + '</strong></p>' +
    '<p>' + SAMPLE_BLURB + '</p>' +
    '<p><a href="' + SAMPLE_REPO_URL + '">' + SAMPLE_REPO_URL + '</a></p>' +
    '<p>Omega1 is a manual-control rover today. Sizes from the repo are ' +
    'documented/estimated until measured — the import never presents ' +
    'them as measurements.</p>'
  );
}

/* ---- One-click path (2026-11-05) -------------------------------
 * Abel asked for the Omega1 sample to be more prominent, so judges,
 * recruiters and testers always have a robot to try. Besides the
 * repo import above, every sample surface now offers ONE click that
 * puts Omega1 in the Workshop straight from its records — the same
 * adopt path the Workshop's #omega1 link already runs (Garage.tsx,
 * lib/omega1Garage.ts). No AI call and no GitHub call, so it works
 * the same in demo mode and when signed in. */
export const SAMPLE_OPEN_HREF = '/garage/#omega1';
export const SAMPLE_OPEN_LABEL = 'Open Omega1 now';
export const SAMPLE_OPEN_NOTE =
  'One click adds Omega1 to your Workshop from its records. Its real ' +
  'size and weight are still blank until someone measures the robot.';

/* The landing spotlight's words. */
export const SAMPLE_SPOTLIGHT_EYEBROW = 'Sample robot · ready to try';
export const SAMPLE_SPOTLIGHT_TITLE = 'Try Omega1, a real robot with a digital twin';
/* Abel, 2026-11-05: RobotForge wasn't built only to fix Omega1 — it
 * builds a whole digital twin you can test and program in a digital
 * world, aiming for an exact sim of the real robot. */
export const SAMPLE_SPOTLIGHT_BODY =
  "Omega1 is Abel's own Freenove 4WD rover on a Raspberry Pi 4B. " +
  'RobotForge builds its digital twin so you can test, program and ' +
  'simulate it in a digital world before touching the hardware. Open ' +
  'it in the Workshop to spin it in 3D, check its wiring, plan an ' +
  'upgrade and run the physics checks. No account needed.';

/* Go to the Workshop and adopt Omega1. On /garage/ itself a plain
 * link to the same hash would not fire `hashchange` when the hash is
 * already #omega1, so clear it first; the Workshop's hash effect
 * does the adopting (or opens the copy that is already yours). */
export function openSampleInWorkshop(push: (href: string) => void): void {
  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/garage') {
    if (window.location.hash === '#omega1') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    window.location.hash = 'omega1';
    return;
  }
  requestSampleOpen();
  push('/garage/');
}

/* A one-shot "open Omega1" request for the Workshop to pick up when
 * it mounts. The hash alone is not enough when the Workshop mounts
 * from behind the sign-in gate on the same URL: a client-side push
 * of '#omega1' fires no hashchange, and can land after the Workshop's
 * first check. Session storage only, consumed on first read. */
const OPEN_REQUEST_KEY = 'rf.sample.open';
export function requestSampleOpen(): void {
  try { window.sessionStorage.setItem(OPEN_REQUEST_KEY, '1'); } catch { /* private mode: the hash path still works */ }
}
export function takeSampleOpenRequest(): boolean {
  try {
    if (!window.sessionStorage.getItem(OPEN_REQUEST_KEY)) return false;
    window.sessionStorage.removeItem(OPEN_REQUEST_KEY);
    return true;
  } catch {
    return false;
  }
}
