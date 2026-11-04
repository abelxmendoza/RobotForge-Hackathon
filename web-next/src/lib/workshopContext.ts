/* Workshop → Wrench context bridge.
 *
 * The Workshop (Garage) owns the live picture of the robot being worked
 * on: which robot is selected, which tab is open, the draft spec being
 * edited, and the engineering-check lines for that draft. None of it
 * lives in the stores the chat reads — the draft exists only in Garage
 * state until it is saved as a version — so Garage publishes a compact,
 * text-only snapshot here on every change, and the chat reads it when a
 * question goes to the live model. That is what lets the chat answer
 * about THIS robot (its spec, its failing checks) instead of robots in
 * general. The snapshot is advisory only: it never feeds the command
 * grammar, the recorded engine, or any state change. */
import { FIELD_GROUPS, fmtValue, getPath, type Spec } from './garage';

export interface WorkshopChatContext {
  robotId?: string;
  robotName: string;
  versionLabel: string;
  tab: string;
  tabLabel: string;
  specLines: string[];
  checksVerdict: string;
  checkLines: string[];
  /* What else is recorded about this robot: its scans and the owner's
   * notes (lib/robotNotes). Sent ahead of the spec lines. */
  factLines?: string[];
}

let current: WorkshopChatContext | null = null;

/* Fired on every publish so the chat can refresh its suggestion chips
 * when the robot or tab changes (the publisher is Garage, the listener
 * is the chat dock — neither imports the other). */
export const WORKSHOP_CONTEXT_EVENT = 'rf-workshop-context';

export function publishWorkshopContext(ctx: WorkshopChatContext | null): void {
  current = ctx;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WORKSHOP_CONTEXT_EVENT));
  }
}

export function readWorkshopContext(): WorkshopChatContext | null {
  return current;
}

/* Whether the snapshot's robot is FAILING its checks. The signal is
 * the same one Garage's own verdict uses (its counts()/severityOf
 * helpers): a check line starting with "[ERROR]". Warnings alone are
 * not a failure, and "Checks pass" never is. */
export function workshopSnapshotFailing(ctx: WorkshopChatContext): boolean {
  return ctx.checkLines.some((l) => l.startsWith('[ERROR]'));
}

/* The caption a live answer carries when it was grounded in a
 * snapshot: which robot, which version, which tab — captured from
 * the snapshot that was actually sent with the question. */
export function groundingCaption(ctx: WorkshopChatContext): string {
  return ['Grounded in: ' + ctx.robotName, ctx.versionLabel, ctx.tabLabel, 'just now']
    .filter(Boolean)
    .join(' · ');
}

/* One-tap Fix bridge (chat → Garage), mirroring the publish/event
 * pattern above: the chat asks for the Workshop's Checks tab, Garage
 * listens and switches. Neither imports the other. The request is
 * also kept as a pending value so a Garage that mounts just after
 * the tap can still consume it on mount. */
export const WORKSHOP_FIX_EVENT = 'rf-workshop-fix';

/* Other one-tap Workshop actions Wrench can ask for, same pattern:
 * open the RealSense camera window for the robot on screen, or switch
 * to a tab. Garage listens; the chat says so if nothing was listening. */
export type WorkshopAction = { kind: 'realsense' } | { kind: 'tab'; tab: string };
export const WORKSHOP_ACTION_EVENT = 'rf-workshop-action';

export function requestWorkshopAction(action: WorkshopAction): boolean {
  if (typeof window === 'undefined') return false;
  const detail = { action, handled: false };
  window.dispatchEvent(new CustomEvent(WORKSHOP_ACTION_EVENT, { detail }));
  return detail.handled;
}

const TAB_WORDS: Record<string, string> = {
  overview: 'overview', build: 'build', wiring: 'wiring', bom: 'bom', 'parts list': 'bom', parts: 'bom',
  test: 'checks', tests: 'checks', checks: 'checks', history: 'history', simulate: 'simulate', simulation: 'simulate',
};

/* Typed or chip text → a Workshop action, else null. Conservative:
 * whole-message phrases only, never a question. */
export function parseWorkshopAction(q: string): WorkshopAction | null {
  const t = String(q || '').trim().replace(/[.!]+$/, '').toLowerCase();
  if (!t || t.includes('?')) return null;
  if (/^(?:scan|3d scan) (?:it|this robot|my robot|[\w -]{1,40}) with (?:the |my |a )?(?:intel )?realsense(?: camera)?$/.test(t)
    || /^(?:open|start|use) (?:the |my )?(?:intel )?realsense(?: camera| scan| scanner)?$/.test(t)) return { kind: 'realsense' };
  const m = t.match(/^(?:open|show|go to|switch to) (?:the )?(overview|build|wiring|bom|parts list|parts|tests?|checks|history|simulate|simulation)(?: tab)?$/);
  if (m) return { kind: 'tab', tab: TAB_WORDS[m[1]] };
  return null;
}

let fixPending = false;

export function requestWorkshopFix(): void {
  fixPending = true;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WORKSHOP_FIX_EVENT));
  }
}

export function consumeWorkshopFixRequest(): boolean {
  const was = fixPending;
  fixPending = false;
  return was;
}

/* The draft spec as short "Group · Label: value unit" lines, in the same
 * units the Specs tab shows (the field scale applied). Empty fields are
 * skipped — the snapshot shows what the robot HAS; the check lines
 * already name what is missing or wrong. */
export function summarizeSpec(spec: Spec): string[] {
  const lines: string[] = [];
  for (const g of FIELD_GROUPS) {
    for (const f of g.fields) {
      if (f.path === 'name') continue;
      const raw = getPath(spec, f.path);
      if (raw === undefined || raw === null || raw === '') continue;
      const scaled = typeof raw === 'number' && f.scale ? raw * f.scale : raw;
      lines.push(`${g.title} · ${f.label}: ${fmtValue(scaled)}${f.unit ? ' ' + f.unit : ''}`);
    }
  }
  return lines;
}

/* The JSON body the chat sends with a question: the published snapshot
 * plus the user's inventory names, read from the store by the caller —
 * the same shelf the operations context lists, so the model can tell
 * "already on the shelf" from "still to buy". */
export function buildWsContext(
  ctx: WorkshopChatContext,
  inventory: string[],
): Record<string, unknown> {
  return {
    robot: ctx.robotName,
    version: ctx.versionLabel,
    tab: ctx.tabLabel,
    // The Worker reads at most 40 spec lines: scans and notes go first.
    spec: [...(ctx.factLines ?? []).slice(0, 12), ...ctx.specLines].slice(0, 40),
    checks: { verdict: ctx.checksVerdict, lines: ctx.checkLines },
    inventory,
  };
}

/* Starter chips for the Workshop, keyed by the open tab. Each tab leads
 * with its job: an action chip where the chat has a grammar for it
 * (RealSense window: parseWorkshopAction; Simulate: parseSimCommand),
 * then questions, which ride out with the Workshop context. A question
 * chip must not start with an operation verb (add / set / save / …),
 * or the chat routes it to the command translator instead. */
const TAB_CHIPS: Record<string, string[]> = {
  overview: [
    'Scan it with the RealSense',
    'Summarize this robot',
    'What should I work on next on this robot?',
  ],
  build: [
    'Walk me through building this robot',
    'What should I assemble first?',
    'Which build steps need parts I don’t have?',
  ],
  wiring: [
    'Sanity-check this robot’s wiring',
    'Does the battery match the motors on this robot?',
    'What powers the motor driver on this robot?',
  ],
  specs: [
    'Summarize this robot’s spec',
    'What’s the weakest part of this design?',
    'Is this robot’s battery big enough for its motors?',
  ],
  simulate: [
    'Run the simulation',
    'Try the ramp',
    'Which acceptance tests would this robot fail?',
  ],
  checks: [
    'Why is this robot failing its checks?',
    'How do I fix this robot’s failing checks?',
    'Which checks matter most for this robot?',
  ],
  bom: [
    'What do I still need to buy for this robot?',
    'Which of this robot’s parts do I already have?',
    'What does this robot cost to build?',
  ],
  tools: [
    'Which tools am I missing for this robot?',
    'What materials does this robot need?',
    'What do I need to print for this robot?',
  ],
  history: [
    'What changed in this robot’s latest version?',
    'How has this robot’s spec evolved?',
    'Which version of this robot is the baseline?',
  ],
};

export function workshopTabChips(ctx: WorkshopChatContext): string[] {
  const chips = [...(TAB_CHIPS[ctx.tab] ?? TAB_CHIPS.checks)];
  // A stored robot can be researched; the answer can then be kept as a note.
  if (ctx.tab === 'overview' && ctx.robotId) chips.push(`Search the web for ${ctx.robotName} robot`);
  return chips;
}

/* The "Working on" line Wrench shows while a Workshop robot is open. */
export function workingOnLabel(ctx: WorkshopChatContext | null): string {
  return ctx ? `Working on: ${ctx.robotName} · ${ctx.tabLabel}` : '';
}
