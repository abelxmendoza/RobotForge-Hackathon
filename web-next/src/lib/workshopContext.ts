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
    spec: ctx.specLines,
    checks: { verdict: ctx.checksVerdict, lines: ctx.checkLines },
    inventory,
  };
}

/* Starter chips for the Workshop, keyed by the open tab. Wording is
 * deliberate: every chip is a question, and none starts with an
 * operation verb (add / set / save / …) — the chat routes those to the
 * command translator, and these are meant for the answer path that now
 * carries the Workshop context. */
const TAB_CHIPS: Record<string, string[]> = {
  overview: [
    'Summarize this robot',
    'What should I work on next on this robot?',
    'Which checks matter most for this robot?',
  ],
  build: [
    'Walk me through building this robot',
    'What should I assemble first?',
    'Which build steps need parts I don’t have?',
  ],
  wiring: [
    'Does the battery match the motors on this robot?',
    'Sanity-check this robot’s wiring',
    'What powers the motor driver on this robot?',
  ],
  specs: [
    'Summarize this robot’s spec',
    'What’s the weakest part of this design?',
    'Is this robot’s battery big enough for its motors?',
  ],
  simulate: [
    'What will the simulation check on this robot?',
    'Which acceptance tests would this robot fail?',
    'Which acceptance tests can’t be checked for this robot yet?',
  ],
  checks: [
    'Why is this robot failing its checks?',
    'Explain the failing checks on this robot',
    'How do I fix this robot’s failing checks?',
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
  return TAB_CHIPS[ctx.tab] ?? TAB_CHIPS.checks;
}
