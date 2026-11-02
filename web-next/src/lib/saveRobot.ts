/* Saving a robot from chat (addendum to the workshop/chat tools
 * plan, 2026-11-01): "save this", "save \"Omega1\"", "save the
 * import", "add the HC-SR04 to my Burger and save it".
 *
 * The audit behind this module, in one paragraph: the Garage
 * store (lib/garage.ts, key rf.garage.v1) already persists
 * versioned robots browser-locally (demo twin in demo mode; no
 * account sync exists anywhere in the app), the repo importer
 * already has a "Save to my Garage" button with repo+commit
 * dedupe, and the chat already edits SAVED robots through
 * preview/apply operations. What was missing is a save verb:
 * copying a Robodex robot (or recording a catalogue part on one)
 * into the store on request, resolving WHICH robot from context,
 * and never overwriting a saved namesake silently. Everything
 * here is pure and deterministic — resolution, planning and
 * record construction — so the eval discipline applies: the
 * caller (ChatDock) only fetches the recorded spec and writes
 * the store, and reports exactly what these functions built.
 *
 * Honesty rules, inherited from the rest of the app:
 * - A saved copy carries its provenance in the version note
 *   (Robodex baseline / repo import) — never upgraded.
 * - A catalogue part recorded on a robot lands as a PLANNED
 *   version (the Garage's planned flag: not built yet), with the
 *   part's catalogue identity — id, name, class — and nothing
 *   else. No dimensions, ratings or fit are invented for it.
 * - A name collision is a question, not a decision: update
 *   (append a fresh baseline version, history kept) or save as
 *   new (a separate "X copy"), per the user's reply. */
import type { GarageRobot, Spec } from "./garage";

export interface DexRobotRef {
  name: string;
  slug: string;
  specFile?: string;
}

export interface SavePartRef {
  id: string;
  name: string;
  partClass?: string;
}

export type SaveRequest =
  | { kind: "save"; nameText?: string; importRef?: boolean }
  | { kind: "add-and-save"; partText: string; nameText?: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* The save grammar. Deliberately narrow, like the other command
 * grammars: a shape this function doesn't own returns null and
 * the message falls through to the existing paths (including the
 * live-model translator, which can only propose validated
 * commands). In particular, assembly commands ("add a battery
 * to \"Omega1\"") have no save tail and are untouched, and
 * "add X to my build…" belongs to the build-list grammar. */
export function parseSaveCommand(text: string): SaveRequest | null {
  const q = text.trim().replace(/\s+/g, " ");
  let m = q.match(/^add (?:a |an |the )?(.+?) to (?:my )?(.+?)(?:,)? and save(?: it)?[.!]?$/i)
       || q.match(/^add (?:a |an |the )?(.+?) to (?:my )?(.+?)(?:,)? then save(?: it)?[.!]?$/i);
  if (m) {
    const robotText = m[2].trim();
    if (norm(robotText) === "build") return null;
    return { kind: "add-and-save", partText: m[1].trim(), nameText: robotText.replace(/^"|"$/g, "") };
  }
  m = q.match(/^add (?:a |an |the )?(.+?) and save(?: it)?[.!]?$/i);
  if (m) return { kind: "add-and-save", partText: m[1].trim() };
  if (/^save (?:this|it|this robot|that|that robot)[.!]?$/i.test(q)) return { kind: "save" };
  if (/^save (?:the |my )?import[.!]?$/i.test(q)) return { kind: "save", importRef: true };
  m = q.match(/^save "([^"\n]+)"[.!]?$/i);
  if (m) return { kind: "save", nameText: m[1].trim() };
  if (/^save as\b/i.test(q)) return null;
  m = q.match(/^save (?:my )?([A-Za-z0-9][A-Za-z0-9 .'\-]*)[.!]?$/i);
  if (m) return { kind: "save", nameText: m[1].trim() };
  return null;
}

export type SaveChoice = "update" | "new" | "cancel";

/* The short replies that answer a save-collision question. Only
 * consulted while a choice is pending; anywhere else these words
 * keep their ordinary routes. */
export function parseSaveChoice(text: string): SaveChoice | null {
  const q = text.trim().replace(/\s+/g, " ");
  if (/^(?:update|update it|update in place|update the existing one)[.!]?$/i.test(q)) return "update";
  if (/^(?:new|save as new|save a new one|a new one|new copy|save as a copy)[.!]?$/i.test(q)) return "new";
  if (/^cancel[.!]?$/i.test(q)) return "cancel";
  return null;
}

export interface SaveContext {
  dex: DexRobotRef[];
  saved: GarageRobot[];
  /* Session context, in the caller's priority order: the robot
   * on the page the user is looking at, then the robot the
   * conversation last answered about (TurnMemory). */
  pageName?: string;
  memoryName?: string;
}

export type SaveTarget =
  | { status: "dex"; robot: DexRobotRef }
  | { status: "saved"; robot: GarageRobot }
  | { status: "import"; robot: GarageRobot }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "none"; reason: "no-import" | "unknown-name" | "no-context"; nameText?: string };

function dexByName(dex: DexRobotRef[], name: string): DexRobotRef[] {
  return dex.filter((r) => r.name.toLowerCase() === name.toLowerCase());
}
function savedByName(saved: GarageRobot[], name: string): GarageRobot[] {
  return saved.filter((r) => r.name.toLowerCase() === name.toLowerCase());
}

/* Which robot a save request means. An explicit name wins; a
 * saved robot of that name is the target (a Robodex namesake is
 * handled by planSave's collision choice); context names are
 * used only when they agree — a page robot and a remembered
 * robot that differ make the request ambiguous, and the caller
 * asks rather than guessing. */
export function resolveSaveTarget(req: SaveRequest, ctx: SaveContext): SaveTarget {
  if (req.kind === "save" && req.importRef) {
    const imports = ctx.saved
      .filter((r) => r.repoImport)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return imports.length
      ? { status: "import", robot: imports[0] }
      : { status: "none", reason: "no-import" };
  }
  if (req.nameText) {
    const saved = savedByName(ctx.saved, req.nameText);
    if (saved.length === 1) return { status: "saved", robot: saved[0] };
    if (saved.length > 1) return { status: "ambiguous", candidates: saved.map((r) => r.name) };
    const dex = dexByName(ctx.dex, req.nameText);
    if (dex.length === 1) return { status: "dex", robot: dex[0] };
    if (dex.length > 1) return { status: "ambiguous", candidates: dex.map((r) => r.name) };
    return { status: "none", reason: "unknown-name", nameText: req.nameText };
  }
  const names = [ctx.pageName, ctx.memoryName].filter((n): n is string => Boolean(n));
  const distinct = [...new Set(names.map((n) => n.toLowerCase()))];
  if (distinct.length > 1) {
    return { status: "ambiguous", candidates: names };
  }
  if (distinct.length === 1) {
    const name = names[0];
    const saved = savedByName(ctx.saved, name);
    if (saved.length === 1) return { status: "saved", robot: saved[0] };
    if (saved.length > 1) return { status: "ambiguous", candidates: saved.map((r) => r.name) };
    const dex = dexByName(ctx.dex, name);
    if (dex.length === 1) return { status: "dex", robot: dex[0] };
    return { status: "none", reason: "unknown-name", nameText: name };
  }
  return { status: "none", reason: "no-context" };
}

export type SavePlan =
  | { action: "create"; robot: DexRobotRef }
  | { action: "already-saved"; robot: GarageRobot; viaImport: boolean }
  | { action: "choice"; robot: DexRobotRef; existing: GarageRobot };

/* What saving a resolved target means. A Robodex robot with a
 * saved namesake is the collision case: the caller must ask
 * (update vs save-as-new) before writing anything. */
export function planSave(target: SaveTarget, saved: GarageRobot[]): SavePlan | null {
  if (target.status === "saved") return { action: "already-saved", robot: target.robot, viaImport: false };
  if (target.status === "import") return { action: "already-saved", robot: target.robot, viaImport: true };
  if (target.status !== "dex") return null;
  const namesakes = savedByName(saved, target.robot.name);
  if (namesakes.length === 1) return { action: "choice", robot: target.robot, existing: namesakes[0] };
  if (namesakes.length > 1) return null;
  return { action: "create", robot: target.robot };
}

/* A catalogue part by the words a user would use: exact name, or
 * every query token present in the recorded name, or the name
 * containing the query. Anything less exact abstains; more than
 * one candidate is ambiguity, answered with the names. */
export function resolveCataloguePart(
  text: string,
  parts: SavePartRef[],
): { status: "unique"; part: SavePartRef } | { status: "ambiguous"; candidates: string[] } | { status: "none" } {
  const q = norm(text);
  if (!q) return { status: "none" };
  const qTokens = q.split(" ");
  const hits = parts.filter((p) => {
    const n = norm(p.name);
    return n === q || n.includes(q) || qTokens.every((t) => n.split(" ").includes(t));
  });
  if (hits.length === 1) return { status: "unique", part: hits[0] };
  if (hits.length > 1) return { status: "ambiguous", candidates: hits.map((p) => p.name) };
  return { status: "none" };
}

/* The Garage entry for a Robodex robot saved from chat: the
 * recorded spec as the Baseline version, provenance in the note
 * — the same construction the chat's Workshop handoff uses. */
export function buildDexEntry(
  robot: DexRobotRef,
  spec: Spec,
  nowIso: string,
  ids: { robot: string; version: string },
): GarageRobot {
  return {
    id: ids.robot,
    name: robot.name,
    createdAt: nowIso,
    versions: [{
      id: ids.version,
      label: "Baseline",
      note: `Started from ${robot.name} — saved from chat; the recorded Robodex spec, unchanged.`,
      source: "robodex",
      createdAt: nowIso,
      spec,
    }],
  };
}

/* The "update" half of the collision choice: a fresh Baseline
 * version from the recorded spec as it stands now, appended —
 * history is never rewritten. */
export function appendFreshBaseline(
  robot: GarageRobot,
  spec: Spec,
  nowIso: string,
  versionId: string,
): GarageRobot {
  return {
    ...robot,
    versions: [...robot.versions, {
      id: versionId,
      label: "Baseline (refreshed)",
      note: "Re-saved from the Robodex record from chat; earlier versions unchanged.",
      source: "robodex" as const,
      createdAt: nowIso,
      spec,
    }],
  };
}

export function uniqueCopyName(name: string, saved: GarageRobot[]): string {
  const taken = new Set(saved.map((r) => r.name.toLowerCase()));
  if (!taken.has(`${name} copy`.toLowerCase())) return `${name} copy`;
  for (let i = 2; ; i++) {
    if (!taken.has(`${name} copy ${i}`.toLowerCase())) return `${name} copy ${i}`;
  }
}

/* The "save as new" half: a separate entry carrying the source
 * robot's versions (and its repo specimen, whose provenance is
 * still true of the copy). */
export function copyAsNew(robot: GarageRobot, newName: string, nowIso: string, robotId: string): GarageRobot {
  const copy: GarageRobot = JSON.parse(JSON.stringify(robot)) as GarageRobot;
  copy.id = robotId;
  copy.name = newName;
  copy.createdAt = nowIso;
  return copy;
}

/* Record a catalogue part on a saved robot: a new PLANNED
 * version whose spec gains the part in `added_parts` — catalogue
 * identity only (id, name, class, where it was recorded from).
 * Planned, because the part is an addition to fit, not installed
 * hardware; nothing about the part is invented. Recording the
 * same part twice is reported, not duplicated. */
export function recordAddedPart(
  robot: GarageRobot,
  part: SavePartRef,
  nowIso: string,
  versionId: string,
): { robot: GarageRobot; already: boolean } {
  const latest = robot.versions.at(-1);
  const spec: Spec = JSON.parse(JSON.stringify(latest?.spec ?? {}));
  const existing: unknown[] = Array.isArray(spec.added_parts) ? spec.added_parts : [];
  if (existing.some((e) => e && typeof e === "object" && (e as { id?: string }).id === part.id)) {
    return { robot, already: true };
  }
  spec.added_parts = [...existing, {
    id: part.id,
    name: part.name,
    ...(part.partClass ? { part_class: part.partClass } : {}),
    recorded_from: "parts catalogue",
    recorded_via: "chat save",
  }];
  return {
    already: false,
    robot: {
      ...robot,
      versions: [...robot.versions, {
        id: versionId,
        label: `Added ${part.name}`,
        note: `Catalogue part ${part.id} recorded from chat. Planned — an addition to fit, not installed hardware; recorded from the parts catalogue, not measured.`,
        source: "edit" as const,
        planned: true,
        createdAt: nowIso,
        spec,
      }],
    },
  };
}
