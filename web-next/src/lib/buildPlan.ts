/* Build plan + real-life constraints — a deterministic engine.
 *
 * Given the current build (the BOM wizard's lines, resolved back
 * to the catalogue / take-apart-kit records they came from) and
 * the builder's own constraints profile (printer bed, materials
 * and tools on hand, budget ceiling, time), this module generates
 * a phased build plan and checks it against real life.
 *
 * The discipline is the repo's, applied hard:
 * - Checks use ONLY recorded data: catalogue specs, kit
 *   parameters, physics metadata, and numbers the user typed into
 *   their own profile. The app never invents a price, a dimension
 *   or a rating.
 * - Every check ends in pass / warn / blocked / not_checked.
 *   "Not checked" is a written state with a reason — an abstention
 *   is never smoothed into a pass, and the plan header counts
 *   not-checked items out loud, so no plan can read "all clear"
 *   while parts of it were never verified.
 * - Estimates are labeled estimates, with their inputs named
 *   (recorded stall torque, recorded robot mass, catalogue
 *   filament density…). Guidance (material choice, safety notes)
 *   is labeled guidance, not engineering certification.
 *
 * Pure: no DOM, no storage. Data arrives as parameters (the chat
 * engine's pattern) so the node tests run this real code against
 * the real catalogue. */
import type { BomLine } from "./bom";
import type { KitPart, Part, RobotKit } from "./types";
import { badConns, type WireConn, type WireNode, type Wiring } from "./wiring";
import { portsByEntry, type BuildWiring } from "./buildWiring";
import type { BuildEntry } from "./palette";

/* ------------------------------------------------------------------ */
/* Constraints profile                                                 */
/* ------------------------------------------------------------------ */

export const PROFILE_KEY = "rf.buildplan.v1";

export interface ToolOption { id: string; label: string }
export const TOOL_OPTIONS: ToolOption[] = [
  { id: "3d_printer", label: "3D printer" },
  { id: "hex_drivers", label: "Hex driver set" },
  { id: "screwdriver_set", label: "Screwdriver set" },
  { id: "soldering_iron", label: "Soldering iron" },
  { id: "multimeter", label: "Multimeter" },
  { id: "calipers", label: "Calipers" },
  { id: "bench_supply", label: "Current-limited bench supply" },
  { id: "lipo_charger", label: "LiPo balance charger" },
  { id: "wire_tools", label: "Wire cutters / strippers" },
];

export const MATERIAL_OPTIONS = ["PLA", "PETG", "ASA", "TPU", "ABS"] as const;

export interface ConstraintsProfile {
  bedXmm: number;
  bedYmm: number;
  bedZmm: number;
  nozzleMm: number;
  materialsOnHand: string[];
  toolsOnHand: string[];
  environment: "indoor" | "outdoor";
  experience: "first" | "some" | "experienced";
  /** Largest clear bench dimension, mm — the assembled robot and
   *  the biggest part have to fit on the bench, not just the bed. */
  workspaceMm: number;
  budgetCeiling: number | null;
  timeAvailableHours: number | null;
  /** Prices the USER typed in, per plan-item key. Nothing else in
   *  the app may put a number here — no price is ever invented. */
  prices: Record<string, number>;
  /** Sourced price ESTIMATES, per plan-item key: a price the user
   *  recorded from a real supplier page, with its provenance —
   *  supplier, source link, quantity break if known, and when it
   *  was fetched. A currency figure may appear in a plan only when
   *  a record like this (or a user-entered price) backs it.
   *  Shipping, tax and stock are never folded into these numbers;
   *  they stay explicit unknowns in every total. Live fetching
   *  from supplier sources is a later layer — this slice ships
   *  the model and the UI states, with user entry as the input. */
  sourcedPrices: Record<string, SourcedPrice>;
}

export interface SourcedPrice {
  amount: number;
  supplier: string;
  url: string;
  qtyBreak?: string;
  /** ISO timestamp of when the price was fetched/recorded. */
  fetchedAt: string;
  /** Where the value came from (Forge Engine §8): a supplier API,
   *  Muse web-gathering from a public page, or the user typing
   *  what they saw. Absent = user_entered (records predate §8). */
  sourceKind?: "api" | "web_gathered" | "user_entered";
  /** The exact quoted snippet the value was extracted from —
   *  the receipt. Required for a web-gathered value to be stored
   *  at all once gathering is wired; modeled here from the start. */
  snippet?: string;
  /** Verification state (§8): web_gathered (single extraction,
   *  unverified) → cross_checked (a second source agrees) →
   *  confirmed (human-approved or API-sourced). Only the latter
   *  two may ever feed safety-relevant checks; prices may SHOW
   *  at web_gathered, badged as web-gathered estimates. */
  verification?: "web_gathered" | "cross_checked" | "confirmed";
}

/* Defaults are a common Ender-3-class printer and a modest maker
 * tool set. They are labeled as defaults in the UI; a plan is only
 * as honest as the profile it ran against, so the profile rides
 * along in every export. */
export const DEFAULT_PROFILE: ConstraintsProfile = {
  bedXmm: 220, bedYmm: 220, bedZmm: 250,
  nozzleMm: 0.4,
  materialsOnHand: ["PLA", "PETG"],
  toolsOnHand: ["3d_printer", "hex_drivers", "screwdriver_set",
    "soldering_iron", "multimeter", "calipers"],
  environment: "indoor",
  experience: "some",
  workspaceMm: 600,
  budgetCeiling: null,
  timeAvailableHours: null,
  prices: {},
  sourcedPrices: {},
};

/* ------------------------------------------------------------------ */
/* Plan items — BOM lines resolved back to their records               */
/* ------------------------------------------------------------------ */

export interface ItemDims {
  x: number; y: number; z: number;
  /** True when the kit itself is flagged estimated (the Waffle Pi
   *  kit) — the label rides into every check that uses the dims. */
  estimated: boolean;
  source: string;
  /** Solid volume where the recorded shape supports computing it
   *  (plate / cylinder). Absent → print time is not estimated. */
  volumeCm3?: number;
  shape: "box" | "cylinder" | "bounding";
  /** Orientation the recorded print note prescribes ("Print flat
   *  as modeled" / "Print upright as modeled"). The extractors put
   *  the modeled vertical in z, so a prescribed orientation pins
   *  z vertical in the fit check — a plate may not "fit" by
   *  standing on its edge. */
  orientation: "flat" | "upright" | "any";
}

export interface PlanItem {
  key: string;
  name: string;
  qty: number;
  role: "print" | "buy" | "material" | "prop";
  partId?: string;
  partClass?: string;
  specs?: Record<string, unknown>;
  dims?: ItemDims;
  printNote?: string;
  wheelRadiusMm?: number;
  sourceLabel: string;
}

function param(p: KitPart, name: string): number | undefined {
  return p.params.find((q) => q.name === name)?.value_mm;
}
function paramSuffix(p: KitPart, suffix: string): number | undefined {
  return p.params.find((q) => q.name.endsWith(suffix))?.value_mm;
}

/* Bounding extents from a kit part's recorded parameters. The fit
 * check tries every orientation, so the extents are reported
 * unordered-honest: this is the box the part needs, computed from
 * the generator's own numbers — never measured off the model. */
export function kitPartDims(p: KitPart, kitEstimated: boolean): ItemDims | undefined {
  const source = kitEstimated
    ? "take-apart kit parameters (kit flagged estimated)"
    : "take-apart kit parameters (generator output)";
  const orientation: ItemDims["orientation"] = /print flat/i.test(p.print_note)
    ? "flat" : /print upright/i.test(p.print_note) ? "upright" : "any";
  const done = (x: number, y: number, z: number, shape: ItemDims["shape"], volumeCm3?: number): ItemDims =>
    ({ x, y, z, estimated: kitEstimated, source, shape, volumeCm3, orientation });

  const length = paramSuffix(p, "_length_mm");
  const width = paramSuffix(p, "_width_mm");
  if (length !== undefined && width !== undefined) {
    const t = paramSuffix(p, "_thickness_mm");
    if (t !== undefined) return done(length, width, t, "box", (length * width * t) / 1000);
  }
  const wheelD = param(p, "wheel_diameter_mm");
  if (wheelD !== undefined) {
    const w = param(p, "wheel_width_mm") ?? paramSuffix(p, "_width_mm");
    if (w !== undefined) {
      return done(wheelD, wheelD, w, "cylinder", (Math.PI * (wheelD / 2) ** 2 * w) / 1000);
    }
  }
  const ballD = param(p, "caster_ball_diameter_mm");
  if (ballD !== undefined) {
    const stem = param(p, "caster_stem_height_mm") ?? 0;
    return done(ballD, ballD, ballD + stem, "bounding");
  }
  const postH = param(p, "post_height_mm");
  if (postH !== undefined) {
    const discD = param(p, "lidar_disc_diameter_mm") ?? param(p, "post_diameter_mm") ?? 0;
    const discT = param(p, "disc_thickness_mm") ?? 0;
    if (discD > 0) return done(discD, discD, postH + discT, "bounding");
  }
  const mountW = param(p, "mount_width_mm");
  const mountH = param(p, "mount_height_mm");
  if (mountW !== undefined && mountH !== undefined) {
    const depth = Math.max(param(p, "flange_depth_mm") ?? 0, param(p, "mount_thickness_mm") ?? 0);
    if (depth > 0) return done(mountW, mountH, depth, "bounding");
  }
  /* Last resort: the dims sentence ("178 x 138 mm footprint,
   * 4 mm thick") is also recorded data. */
  const m = p.dims.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*mm/);
  const thick = p.dims.match(/(\d+(?:\.\d+)?)\s*mm thick/);
  if (m && thick) {
    const [x, y, z] = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(thick[1])];
    return done(x, y, z, "box", (x * y * z) / 1000);
  }
  return undefined;
}

export function kitPlanItems(entry: RobotKit): PlanItem[] {
  if (!entry.kit) return [];
  return entry.kit.parts.map((p) => ({
    key: `kit:${p.file}`,
    name: p.name,
    qty: p.qty,
    role: "print" as const,
    dims: kitPartDims(p, entry.kit!.estimated),
    printNote: p.print_note,
    wheelRadiusMm: param(p, "wheel_diameter_mm") !== undefined
      ? param(p, "wheel_diameter_mm")! / 2 : undefined,
    sourceLabel: `${entry.robot} parts kit`,
  }));
}

export interface KitFileIndex { part: KitPart; estimated: boolean; robot: string }

export function kitFileIndex(kits: Record<string, RobotKit>): Map<string, KitFileIndex> {
  const out = new Map<string, KitFileIndex>();
  for (const entry of Object.values(kits)) {
    if (!entry.kit) continue;
    for (const p of entry.kit.parts) {
      out.set(p.file, { part: p, estimated: entry.kit.estimated, robot: entry.robot });
    }
  }
  return out;
}

/* Resolve the wizard's BOM lines back to records. Kit lines get
 * their generator parameters (real dims); catalogue lines get
 * their specs; a catalogue "structure" part the catalogue itself
 * describes as generated per-robot is a print item whose dims the
 * catalogue does NOT record — it stays dimensionless here, and
 * the fit check will say not-checked for it rather than guess. */
export function bomLinePlanItems(
  lines: BomLine[],
  partsById: Map<string, Part>,
  kitsByFile: Map<string, KitFileIndex>,
): PlanItem[] {
  return lines.map((l) => {
    if (l.kind === "kit-part") {
      const file = l.key.replace(/^kit:/, "");
      const hit = kitsByFile.get(file);
      if (hit) {
        return {
          key: l.key, name: l.name, qty: l.qty, role: "print" as const,
          dims: kitPartDims(hit.part, hit.estimated),
          printNote: hit.part.print_note,
          wheelRadiusMm: param(hit.part, "wheel_diameter_mm") !== undefined
            ? param(hit.part, "wheel_diameter_mm")! / 2 : undefined,
          sourceLabel: l.sourceLabel,
        };
      }
    }
    const part = l.partId ? partsById.get(l.partId) : undefined;
    if (part) {
      const specs = (part.specs ?? {}) as Record<string, unknown>;
      const generated = typeof specs.origin === "string" && specs.origin.includes("generated");
      return {
        key: l.key, name: l.name, qty: l.qty,
        role: part.part_class === "materials" ? "material" as const
          : generated ? "print" as const : "buy" as const,
        partId: part.id, partClass: part.part_class, specs,
        sourceLabel: l.sourceLabel,
      };
    }
    return {
      key: l.key, name: l.name, qty: l.qty, role: "prop" as const,
      sourceLabel: l.sourceLabel,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Spec helpers — recorded values only, parsed defensively             */
/* ------------------------------------------------------------------ */

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function rangeOf(v: unknown): { min: number; max: number } | undefined {
  if (typeof v === "number") return { min: v, max: v };
  if (typeof v === "string") {
    const m = v.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
    if (m) return { min: parseFloat(m[1]), max: parseFloat(m[2]) };
    const single = parseFloat(v);
    if (Number.isFinite(single)) return { min: single, max: single };
  }
  return undefined;
}
const KG_CM_TO_NM = 0.0980665;
const fmt = (n: number, digits = 1) => String(Math.round(n * 10 ** digits) / 10 ** digits);

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

export type CheckState = "pass" | "warn" | "blocked" | "not_checked";
export interface CheckResult {
  id: string;
  state: CheckState;
  title: string;
  detail: string;
  fix?: string;
  stepIds: string[];
}

const PRINT_STEP = (key: string) => `print:${key}`;

function fitsInBed(d: ItemDims, bed: [number, number, number]): boolean {
  const dims = [d.x, d.y, d.z];
  /* A prescribed orientation (recorded print note) pins the
   * modeled z vertical; otherwise every orientation is tried. */
  const perms = d.orientation === "any"
    ? [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
    : [[0, 1, 2], [1, 0, 2]];
  return perms.some((p) => dims[p[0]] <= bed[0] + 0.01 && dims[p[1]] <= bed[1] + 0.01 && dims[p[2]] <= bed[2] + 0.01);
}

export function checkPrintFit(items: PlanItem[], profile: ConstraintsProfile): CheckResult {
  const prints = items.filter((i) => i.role === "print");
  const bed: [number, number, number] = [profile.bedXmm, profile.bedYmm, profile.bedZmm];
  const bedLabel = `${bed[0]} × ${bed[1]} × ${bed[2]} mm`;
  if (!prints.length) {
    return { id: "print-fit", state: "not_checked", title: "Print fit",
      detail: "This build has no 3D-printed parts — nothing to fit against the printer bed.",
      stepIds: [] };
  }
  const failures: string[] = [];
  const passes: string[] = [];
  const unknown: string[] = [];
  const failSteps: string[] = [];
  for (const it of prints) {
    if (!it.dims) { unknown.push(it.name); continue; }
    const d = it.dims;
    const label = `${it.name} (${fmt(d.x)} × ${fmt(d.y)} × ${fmt(d.z)} mm${d.estimated ? ", estimated dims" : ""})`;
    if (fitsInBed(d, bed)) passes.push(label);
    else { failures.push(label); failSteps.push(PRINT_STEP(it.key)); }
  }
  if (failures.length) {
    return { id: "print-fit", state: "blocked", title: "Print fit",
      detail: `Too big for a ${bedLabel} bed in any orientation its recorded print note allows: ${failures.join("; ")}. ` +
        (passes.length ? `Fits: ${passes.join("; ")}. ` : "") +
        (unknown.length ? `No recorded dimensions (not checked): ${unknown.join(", ")}.` : ""),
      fix: "Split the part along its longest axis and join the pieces, print it on a larger " +
        "printer, or redesign it smaller — its dimensions come from the recorded kit " +
        "parameters, so measure the real design before assuming.",
      stepIds: failSteps };
  }
  if (unknown.length) {
    return { id: "print-fit", state: "not_checked", title: "Print fit",
      detail: `Fits the ${bedLabel} bed: ${passes.join("; ") || "none with recorded dims"}. ` +
        `Not checked — the catalogue records no dimensions for: ${unknown.join(", ")}.`,
      stepIds: [] };
  }
  return { id: "print-fit", state: "pass", title: "Print fit",
    detail: `Every printed part fits the ${bedLabel} bed (orientations per the recorded print notes): ${passes.join("; ")}.`,
    stepIds: [] };
}

export function checkWorkspace(items: PlanItem[], profile: ConstraintsProfile): CheckResult {
  const biggest = items.reduce((m, i) => (i.dims ? Math.max(m, i.dims.x, i.dims.y) : m), 0);
  if (!biggest) {
    return { id: "workspace", state: "not_checked", title: "Bench space",
      detail: "No recorded part dimensions — bench-space fit not checked.", stepIds: [] };
  }
  if (biggest > profile.workspaceMm) {
    return { id: "workspace", state: "warn", title: "Bench space",
      detail: `The largest recorded part spans ${fmt(biggest)} mm but your clear bench ` +
        `space is ${profile.workspaceMm} mm — assembly will be cramped or impossible there.`,
      fix: "Clear a bigger surface, or assemble in sub-assemblies and join them elsewhere.",
      stepIds: ["prep"] };
  }
  return { id: "workspace", state: "pass", title: "Bench space",
    detail: `Largest recorded part spans ${fmt(biggest)} mm, inside your ${profile.workspaceMm} mm of clear bench.`,
    stepIds: [] };
}

/* The filament the plan will actually use, by the same rules the
 * material check applies — time estimates inherit the choice so
 * the two never disagree. Density comes from the catalogue's
 * recorded filament specs (PLA 1.24, PETG 1.27 g/cm³). */
export function chosenFilament(items: PlanItem[], profile: ConstraintsProfile, partsById: Map<string, Part>): { name: string; densityGCm3: number } | null {
  const onHand = profile.materialsOnHand.map((m) => m.toUpperCase());
  const pick = onHand.includes("PETG") ? "PETG" : onHand.includes("PLA") ? "PLA" : null;
  if (!pick) return null;
  const rec = [...partsById.values()].find(
    (p) => p.part_class === "materials" && p.name.toUpperCase().startsWith(pick));
  const density = num(rec?.specs?.density_g_cm3);
  return density ? { name: pick, densityGCm3: density } : null;
}

export function checkMaterialFit(items: PlanItem[], profile: ConstraintsProfile): CheckResult {
  const prints = items.filter((i) => i.role === "print");
  if (!prints.length) {
    return { id: "material-fit", state: "not_checked", title: "Material fit",
      detail: "No printed parts — no filament requirement to check.", stepIds: [] };
  }
  const onHand = profile.materialsOnHand.map((m) => m.toUpperCase());
  const flex = prints.filter((i) => /flex|rubber|tyre|tire|tpu/i.test(`${i.name} ${i.printNote ?? ""}`));
  const notes: string[] = [];
  let state: CheckState = "pass";
  const stepIds = prints.map((i) => PRINT_STEP(i.key));
  if (!onHand.length) {
    return { id: "material-fit", state: "blocked", title: "Material fit",
      detail: `${prints.length} part(s) need printing but your profile lists no filament on hand.`,
      fix: "Add a spool to the buy list — PETG is the catalogue's recorded pick for " +
        "functional brackets and parts that take knocks; PLA suits indoor prototypes.",
      stepIds };
  }
  if (!onHand.includes("PETG") && !onHand.includes("PLA") && !onHand.includes("ASA") && !onHand.includes("ABS")) {
    return { id: "material-fit", state: "blocked", title: "Material fit",
      detail: `Only flexible filament (${onHand.join(", ")}) is on hand — the structural ` +
        `printed parts need a rigid filament.`,
      fix: "Add PETG (or PLA for indoor-only use) to the buy list.", stepIds };
  }
  if (!onHand.includes("PETG")) {
    state = "warn";
    notes.push(profile.environment === "outdoor"
      ? "No PETG on hand and this build lives outdoors/in heat: PLA softens in heat — " +
        "ASA is the guidance for sun and heat, PETG the everyday structural pick."
      : "No PETG on hand: PLA will print these parts, but the catalogue records PETG as " +
        "the filament for functional brackets and parts that take knocks — treat PLA " +
        "versions as prototypes.");
  } else if (profile.environment === "outdoor") {
    state = "warn";
    notes.push("PETG works here; ASA holds up better in direct sun and heat. Guidance only.");
  }
  if (flex.length && !onHand.includes("TPU")) {
    state = "warn";
    notes.push(`Flexible part(s) — ${flex.map((f) => f.name).join(", ")} — want TPU, ` +
      `which is not on hand; printed rigid they will not flex.`);
  }
  if (state === "pass") {
    notes.push(`PETG on hand covers the structural prints` +
      (profile.environment === "indoor" ? " for indoor use." : "."));
  }
  return { id: "material-fit", state, title: "Material fit",
    detail: notes.join(" ") +
      " (Guidance from the catalogue's recorded filament notes — not an engineering certification.)",
    fix: state === "warn" ? "Add the named filament to the buy list, or accept the noted trade-off." : undefined,
    stepIds };
}

/* Tools the plan's own steps require, derived from what's in the
 * build — the check names the step a missing tool belongs to. */
export function requiredTools(items: PlanItem[]): { tool: string; stepIds: string[]; why: string }[] {
  const req = new Map<string, { stepIds: Set<string>; why: string }>();
  const add = (tool: string, stepId: string, why: string) => {
    const r = req.get(tool) ?? { stepIds: new Set<string>(), why };
    r.stepIds.add(stepId);
    req.set(tool, r);
  };
  const prints = items.filter((i) => i.role === "print");
  for (const p of prints) add("3d_printer", PRINT_STEP(p.key), "printing");
  if (items.some((i) => i.role !== "material" && i.role !== "prop")) {
    add("hex_drivers", "assemble", "bolted assembly");
    add("screwdriver_set", "assemble", "bolted assembly");
  }
  if (prints.length) add("calipers", PRINT_STEP(prints[0].key), "the printed-part fit checkpoint");
  const powerish = items.some((i) => ["power", "drivers", "actuators", "sbc"].includes(i.partClass ?? ""));
  if (powerish) {
    add("wire_tools", "wire", "wiring");
    add("multimeter", "wire", "the polarity checkpoint");
    add("multimeter", "test", "first-power checks");
  }
  const solder = items.some((i) => i.partId === "xt60_pigtail" || i.partId === "silicone_wire_14awg"
    || i.partId === "custom_pcb_kicad");
  if (solder) add("soldering_iron", "wire", "bare-lead / pigtail connections");
  return [...req.entries()].map(([tool, r]) => ({ tool, stepIds: [...r.stepIds], why: r.why }));
}

export function checkTools(items: PlanItem[], profile: ConstraintsProfile): CheckResult {
  const req = requiredTools(items);
  if (!req.length) {
    return { id: "tools", state: "not_checked", title: "Tools",
      detail: "This plan's steps need no specific tools — nothing to check.", stepIds: [] };
  }
  const missing = req.filter((r) => !profile.toolsOnHand.includes(r.tool));
  if (!missing.length) {
    return { id: "tools", state: "pass", title: "Tools",
      detail: `Every tool the steps call for is in your profile: ` +
        req.map((r) => TOOL_OPTIONS.find((t) => t.id === r.tool)?.label ?? r.tool).join(", ") + ".",
      stepIds: [] };
  }
  const names = missing.map((r) =>
    `${TOOL_OPTIONS.find((t) => t.id === r.tool)?.label ?? r.tool} (for ${r.why})`);
  return { id: "tools", state: "warn", title: "Tools",
    detail: `Missing from your tool profile: ${names.join("; ")}. The affected steps are badged.`,
    fix: "Borrow or buy the named tool, tick it in Your constraints if you already own it, " +
      "or re-plan the step another way.",
    stepIds: [...new Set(missing.flatMap((r) => r.stepIds))] };
}

/* The Kit wiring view saves the build list's wiring under the same
 * rf.wiring.v1 key in lib/buildWiring.ts's shape ({connections:
 * [{fromEntry, fromPort, toEntry, toPort, type}]}) — NOT the spec
 * shape above. isBuildWiring tells the two apart. */
export function isBuildWiring(w: unknown): w is BuildWiring {
  return !!w && typeof w === "object"
    && Array.isArray((w as BuildWiring).connections)
    && (w as BuildWiring).connections.every((c) => !!c
      && typeof c.fromEntry === "string" && typeof c.toEntry === "string");
}

/* Adapt saved build-list wiring into the spec-wiring shape the
 * badConns scan reads, so the power check judges the wiring the
 * visitor actually drew. Only power connections whose source port
 * records a voltage can be judged; a target's rating is its landing
 * port's recorded ratedMaxV (or the top of its recorded range).
 * Connections the data can't judge are left out — the scan then
 * abstains on them exactly as it does for spec wiring, and a
 * driver's motor-out (no recorded volts) never gets judged. */
export function wiringFromBuildWiring(
  bw: BuildWiring,
  entries: BuildEntry[],
  partsById: Map<string, Part>,
): Wiring | null {
  const ports = portsByEntry(entries, partsById);
  const nameOf = new Map<string, string>();
  for (const e of entries) {
    const p = e.kind === "catalog-part" ? partsById.get(e.refId) : undefined;
    nameOf.set(e.uid, p?.name ?? e.uid);
  }
  const nodes = new Map<string, WireNode>();
  const connections: WireConn[] = [];
  const nodeFor = (uid: string, portId: string, rated: number | null): string => {
    const id = `${uid}:${portId}`;
    if (!nodes.has(id)) {
      nodes.set(id, { id, label: nameOf.get(uid) ?? uid, rated_max_v: rated });
    }
    return id;
  };
  for (const c of bw.connections) {
    if (c.type !== "power") continue;
    const fromPort = (ports.get(c.fromEntry) ?? []).find((p) => p.id === c.fromPort);
    const toPort = (ports.get(c.toEntry) ?? []).find((p) => p.id === c.toPort);
    if (!fromPort || !toPort || fromPort.volts == null) continue;
    const rated = toPort.ratedMaxV ?? (toPort.rangeV ? toPort.rangeV[1] : null);
    connections.push({
      from: nodeFor(c.fromEntry, c.fromPort, null),
      to: nodeFor(c.toEntry, c.toPort, rated),
      kind: "power",
      volts: fromPort.volts,
    });
  }
  if (!connections.length) return null;
  return { nodes: [...nodes.values()], connections };
}

export function checkPower(items: PlanItem[], wiring: Wiring | null): CheckResult {
  const stepIds = ["wire", "test"];
  /* Saved wiring first: connections record their own volts, and
   * lib/wiring's badConns flags a recorded feed above a node's
   * recorded rated maximum. That is a fact, not an inference. */
  if (wiring && wiring.connections.length) {
    const bad = [...badConns(wiring)];
    if (bad.length) {
      const labels = bad.map((i) => {
        const c = wiring.connections[i];
        return `${c.from} → ${c.to} at ${c.volts} V`;
      });
      return { id: "power", state: "blocked", title: "Power",
        detail: `Recorded wiring over-voltage: ${labels.join("; ")} — the feed exceeds ` +
          `the target's recorded rated maximum.`,
        fix: "Re-route that feed through a regulator/driver rated for it, or use a " +
          "lower-voltage battery.", stepIds };
    }
  }
  const batteries = items.filter((i) => i.role === "buy"
    && (typeof i.specs?.chemistry === "string" || i.partClass === "power")
    && rangeOf(i.specs?.voltage_v) !== undefined);
  if (!batteries.length) {
    return { id: "power", state: "not_checked", title: "Power",
      detail: "No battery with a recorded voltage is in this build — power paths not checked.",
      stepIds: [] };
  }
  const battery = batteries[0];
  const bv = rangeOf(battery.specs?.voltage_v)!;
  const compared: string[] = [];
  const abstained: string[] = [];
  let state: CheckState = "pass";
  let blockedDetail = "";
  let fix: string | undefined;

  const drivers = items.filter((i) => num(i.specs?.voltage_v_max) !== undefined);
  for (const d of drivers) {
    const max = num(d.specs?.voltage_v_max)!;
    if (bv.max > max) {
      state = "blocked";
      blockedDetail = `${battery.name} (${fmt(bv.max)} V) exceeds ${d.name}'s recorded ` +
        `maximum input of ${fmt(max)} V.`;
      fix = "Use a lower-cell-count battery or a driver rated for the battery's voltage.";
    } else {
      compared.push(`${d.name} input: ${fmt(bv.max)} V battery vs ${fmt(max)} V recorded max — OK`);
    }
  }
  const bucks = items.filter((i) => num(i.specs?.input_v_max) !== undefined);
  for (const b of bucks) {
    const max = num(b.specs?.input_v_max)!;
    if (bv.max > max) {
      state = "blocked";
      blockedDetail = `${battery.name} (${fmt(bv.max)} V) exceeds ${b.name}'s recorded ` +
        `maximum input of ${fmt(max)} V.`;
      fix = "Use a lower-voltage battery or a converter rated for it.";
    } else {
      compared.push(`${b.name} input: ${fmt(bv.max)} V vs ${fmt(max)} V recorded max — OK` +
        (num(b.specs?.output_v) !== undefined ? `; it records a ${fmt(num(b.specs?.output_v)!)} V output rail` : ""));
    }
  }
  /* Motors behind a driver see PWM, not the raw battery: their
   * voltage is NOT checked, and that is written down — the wiring
   * checks' pass-through discipline. Motors with no driver in the
   * build may see the full battery and are compared directly. */
  const motors = items.filter((i) => i.partClass === "actuators" && rangeOf(i.specs?.voltage_v) !== undefined);
  for (const m of motors) {
    const r = rangeOf(m.specs?.voltage_v)!;
    if (drivers.length) {
      abstained.push(`${m.name} sits behind a motor driver — its delivered voltage is set ` +
        `by PWM duty, not the battery, so it is not checked here`);
    } else if (bv.min > r.max) {
      if (state !== "blocked") state = "warn";
      compared.push(`${m.name} is recorded for up to ${fmt(r.max)} V but the battery is ` +
        `${fmt(bv.min)} V with no driver or regulator in this build — it may see full battery voltage`);
    } else {
      compared.push(`${m.name}: battery ${fmt(bv.max)} V inside its recorded range (${fmt(r.min)}–${fmt(r.max)} V) — OK`);
    }
  }
  const computers = items.filter((i) => i.partClass === "sbc");
  for (const c of computers) {
    const supply = typeof c.specs?.supply === "string" ? c.specs.supply : "";
    if (/5\s*v/i.test(supply)) {
      const rail = bucks.find((b) => num(b.specs?.output_v) === 5);
      if (rail) compared.push(`${c.name} needs 5 V (recorded supply) — ${rail.name} records a 5 V output`);
      else {
        if (state !== "blocked") state = "warn";
        compared.push(`${c.name} needs a regulated 5 V feed (recorded supply: "${supply}") ` +
          `but no buck converter is in this build`);
        fix = fix ?? "Add a 5 V buck converter between the battery and the computer.";
      }
    } else {
      abstained.push(`${c.name}'s supply requirement is not recorded as a plain voltage — not checked`);
    }
  }
  const servos = items.filter((i) => i.partClass === "actuators" && rangeOf(i.specs?.voltage_v) !== undefined
    && num(i.specs?.stall_torque_nm) === undefined && num(i.specs?.torque_kg_cm) !== undefined);
  for (const s of servos) {
    if (!motors.includes(s)) abstained.push(`${s.name}'s rail depends on the BEC/regulator feeding it — not recorded, not checked`);
  }
  if (state === "blocked") {
    return { id: "power", state, title: "Power", detail: blockedDetail +
      (compared.length ? ` Also compared: ${compared.join("; ")}.` : ""), fix, stepIds };
  }
  if (abstained.length && state === "pass") state = "not_checked";
  return { id: "power", state, title: "Power",
    detail: (compared.length ? `Compared from recorded specs: ${compared.join("; ")}.` : "No direct comparisons were possible.") +
      (abstained.length ? ` Not checked: ${abstained.join("; ")}.` : ""),
    fix, stepIds: state === "pass" ? [] : stepIds };
}

export function checkTorque(
  items: PlanItem[],
  robotMassKg: number | null | undefined,
  robotMassLabel: string | undefined,
): CheckResult {
  const motors = items.filter((i) => i.role === "buy" && i.partClass === "actuators");
  const withTorque = motors.map((m) => {
    const stall = num(m.specs?.stall_torque_nm);
    const kgcm = num(m.specs?.torque_kg_cm);
    return { item: m, nm: stall ?? (kgcm !== undefined ? kgcm * KG_CM_TO_NM : undefined) };
  }).filter((m) => m.nm !== undefined);
  if (!withTorque.length) {
    return { id: "torque", state: "not_checked", title: "Torque vs weight",
      detail: "No drive motor with a recorded torque figure is in this build — " +
        "the printed-parts kit carries no motors, so there is nothing to estimate from.",
      stepIds: [] };
  }
  if (robotMassKg === null || robotMassKg === undefined) {
    return { id: "torque", state: "not_checked", title: "Torque vs weight",
      detail: "Motor torque is recorded, but no robot mass is recorded for this build — not estimated.",
      stepIds: [] };
  }
  const wheel = items.find((i) => i.wheelRadiusMm !== undefined)
    ?? items.find((i) => num(i.specs?.diameter_m) !== undefined);
  const radiusMm = wheel?.wheelRadiusMm ?? (wheel ? num(wheel.specs?.diameter_m)! * 500 : undefined);
  if (radiusMm === undefined) {
    return { id: "torque", state: "not_checked", title: "Torque vs weight",
      detail: "No recorded wheel size in this build — the torque estimate needs one.",
      stepIds: [] };
  }
  const weakest = withTorque.reduce((a, b) => (a.nm! <= b.nm! ? a : b));
  const count = withTorque.reduce((s, m) => s + m.item.qty, 0);
  /* ESTIMATE: torque to hold the robot on a 20° slope, split
   * across the drive motors, from recorded mass + wheel radius. */
  const required = (robotMassKg * 9.81 * (radiusMm / 1000) * Math.sin((20 * Math.PI) / 180)) / count;
  const margin = weakest.nm! / required;
  const detail = `ESTIMATE — holding a 20° slope: needs ~${fmt(required, 3)} N·m per motor; ` +
    `the weakest recorded drive torque is ${weakest.item.name} at ${fmt(weakest.nm!, 2)} N·m ` +
    `(×${count}) — margin ${fmt(margin)}×. Inputs: recorded robot mass ${fmt(robotMassKg, 2)} kg` +
    (robotMassLabel ? ` (${robotMassLabel})` : "") +
    `, recorded wheel radius ${fmt(radiusMm)} mm. Stall torque is a peak, not a ` +
    `continuous rating — treat this as a rough guide, not a guarantee.`;
  if (margin < 1) {
    return { id: "torque", state: "blocked", title: "Torque vs weight", detail,
      fix: "Stronger motors, smaller wheels, or a lighter robot — the estimate says this " +
        "combination cannot hold a moderate slope.", stepIds: ["assemble"] };
  }
  if (margin < 2) {
    return { id: "torque", state: "warn", title: "Torque vs weight", detail,
      fix: "Margin is thin for a peak (stall) rating — expect weakness on slopes and " +
        "carpet; stronger motors or smaller wheels would help.", stepIds: ["assemble"] };
  }
  return { id: "torque", state: "pass", title: "Torque vs weight", detail, stepIds: [] };
}

/* The one place a plan item gets a price. A user-entered price
 * wins for the total; a sourced estimate backs the total when no
 * user price exists. Either way the figure carries its record —
 * no record, no price, no currency anywhere in the plan. */
export interface ResolvedPrice {
  amount: number;
  kind: "user_entered" | "sourced" | "api" | "web_gathered";
  label: string;
  snippet?: string;
  verification?: SourcedPrice["verification"];
}
export function resolvedPrice(item: PlanItem, profile: ConstraintsProfile): ResolvedPrice | null {
  const user = profile.prices[item.key];
  if (Number.isFinite(user)) {
    return { amount: user, kind: "user_entered", label: "your entered price" };
  }
  const s = profile.sourcedPrices[item.key];
  if (s && Number.isFinite(s.amount)) {
    const kind = s.sourceKind ?? "user_entered";
    const tail = (s.qtyBreak ? `, ${s.qtyBreak}` : "") + `: ${s.url}`;
    if (kind === "web_gathered") {
      return {
        amount: s.amount, kind: "web_gathered",
        label: `web-gathered estimate — ${s.supplier}, fetched ${s.fetchedAt}` +
          `, verification: ${s.verification ?? "web_gathered"}` + tail,
        snippet: s.snippet, verification: s.verification ?? "web_gathered",
      };
    }
    if (kind === "api") {
      return {
        amount: s.amount, kind: "api",
        label: `API price — ${s.supplier}, fetched ${s.fetchedAt}` + tail,
        verification: "confirmed",
      };
    }
    return {
      amount: s.amount, kind: "sourced",
      label: `ESTIMATE — ${s.supplier}, fetched ${s.fetchedAt}` + tail,
    };
  }
  return null;
}

export function checkBudget(items: PlanItem[], profile: ConstraintsProfile): CheckResult {
  const money = (n: number) => `$${n.toFixed(2)}`;
  const UNKNOWN_LINE = "Shipping, tax and stock are unknown — not included in any total.";
  let userSum = 0, sourcedSum = 0, apiSum = 0, gatheredSum = 0, gatheredUnverified = 0;
  const unpriced: PlanItem[] = [];
  for (const i of items.filter((x) => x.role === "buy")) {
    const p = resolvedPrice(i, profile);
    if (!p) { unpriced.push(i); continue; }
    if (p.kind === "user_entered") userSum += p.amount * i.qty;
    else if (p.kind === "sourced") sourcedSum += p.amount * i.qty;
    else if (p.kind === "api") apiSum += p.amount * i.qty;
    else {
      gatheredSum += p.amount * i.qty;
      if ((p.verification ?? "web_gathered") === "web_gathered") {
        gatheredUnverified += p.amount * i.qty;
      }
    }
  }
  const known = userSum + sourcedSum + apiSum + gatheredSum;
  const buckets = [
    userSum ? `${money(userSum)} your prices` : null,
    sourcedSum ? `${money(sourcedSum)} sourced estimates` : null,
    apiSum ? `${money(apiSum)} API prices` : null,
    gatheredSum ? `${money(gatheredSum)} web-gathered estimates` : null,
  ].filter(Boolean);
  const breakdown = `(${buckets.join(" + ") || "no priced lines"})`;
  const unverifiedNote = gatheredUnverified > 0
    ? ` Of the total, ${money(gatheredUnverified)} rests on unverified web-gathered ` +
      `data — the softest figure here; cross-checked or API data would outrank it.`
    : "";
  if (known === 0 && profile.budgetCeiling === null) {
    return { id: "budget", state: "not_checked", title: "Budget",
      detail: "No prices recorded and no budget ceiling set. The app never invents " +
        "prices — enter the prices you find, or record a sourced estimate with its " +
        "supplier and link, plus a ceiling to check against. " + UNKNOWN_LINE,
      stepIds: [] };
  }
  if (profile.budgetCeiling === null) {
    return { id: "budget", state: "not_checked", title: "Budget",
      detail: `Recorded lines total ${money(known)} ${breakdown} but no ceiling is set ` +
        `to check against. ${unpriced.length} buy line(s) are still unpriced. ` + UNKNOWN_LINE + unverifiedNote,
      stepIds: ["buy"] };
  }
  if (known > profile.budgetCeiling) {
    return { id: "budget", state: "blocked", title: "Budget",
      detail: `Recorded prices already total ${money(known)} ${breakdown} against a ` +
        `${money(profile.budgetCeiling)} ceiling — before ${unpriced.length} unpriced ` +
        `buy line(s). ` + UNKNOWN_LINE + unverifiedNote,
      fix: "Drop or swap lines, or raise the ceiling — the plan only adds up recorded figures.",
      stepIds: ["buy"] };
  }
  if (unpriced.length) {
    return { id: "budget", state: "warn", title: "Budget",
      detail: `Recorded lines total ${money(known)} ${breakdown} of your ` +
        `${money(profile.budgetCeiling)} ceiling, but ${unpriced.length} buy line(s) ` +
        `have no price yet — the true total is unknown and could exceed the ceiling. ` +
        UNKNOWN_LINE + unverifiedNote,
      stepIds: ["buy"] };
  }
  return { id: "budget", state: "pass", title: "Budget",
    detail: `All buy lines are priced and total ${money(known)} ${breakdown}, inside ` +
      `your ${money(profile.budgetCeiling)} ceiling. ` + UNKNOWN_LINE + unverifiedNote, stepIds: [] };
}

/* Print-time ESTIMATE: recorded solid volume × a stated material
 * fraction (walls + the 25–40% infill the kit notes suggest) ×
 * recorded filament density, extruded at a stated 6–14 g/h range.
 * Your slicer's number is the authority; this is a planning range. */
export function printTimeEstimate(
  items: PlanItem[],
  profile: ConstraintsProfile,
  partsById: Map<string, Part>,
): { perItem: Map<string, { minH: number; maxH: number }>; totalMinH: number; totalMaxH: number; unknownVolume: string[]; filament: string } | null {
  const fil = chosenFilament(items, profile, partsById);
  if (!fil) return null;
  const perItem = new Map<string, { minH: number; maxH: number }>();
  const unknownVolume: string[] = [];
  let totalMinH = 0, totalMaxH = 0;
  for (const it of items.filter((i) => i.role === "print")) {
    if (!it.dims?.volumeCm3) { unknownVolume.push(it.name); continue; }
    const grams = it.dims.volumeCm3 * 0.4 * fil.densityGCm3 * it.qty;
    const range = { minH: grams / 14, maxH: grams / 6 };
    perItem.set(it.key, range);
    totalMinH += range.minH;
    totalMaxH += range.maxH;
  }
  return { perItem, totalMinH, totalMaxH, unknownVolume, filament: fil.name };
}

export function checkTime(
  items: PlanItem[],
  profile: ConstraintsProfile,
  partsById: Map<string, Part>,
  assemblyHours: number,
): CheckResult {
  const est = printTimeEstimate(items, profile, partsById);
  const prints = items.filter((i) => i.role === "print");
  if (!prints.length) {
    return { id: "time", state: "not_checked", title: "Time",
      detail: "No printed parts — print time does not apply; assembly estimates ride on the steps.",
      stepIds: [] };
  }
  if (!est) {
    return { id: "time", state: "not_checked", title: "Time",
      detail: "No rigid filament on hand to estimate print time from (see Material fit).",
      stepIds: [] };
  }
  const totalMin = est.totalMinH + assemblyHours;
  const totalMax = est.totalMaxH + assemblyHours;
  const label = `ESTIMATE — printing ${fmt(est.totalMinH)}–${fmt(est.totalMaxH)} h ` +
    `(${est.filament}, from recorded part volumes × 40% material fraction × recorded ` +
    `filament density, at 6–14 g/h) plus ~${fmt(assemblyHours)} h of assembly steps`;
  if (profile.timeAvailableHours !== null && totalMax > profile.timeAvailableHours) {
    return { id: "time", state: "warn", title: "Time",
      detail: `${label}. The top of that range exceeds your ${profile.timeAvailableHours} h available.`,
      fix: "Start the long prints first, print overnight where your setup allows, or " +
        "split the build across sessions — the plan's phases are ordered so partial progress keeps.",
      stepIds: prints.map((i) => PRINT_STEP(i.key)) };
  }
  if (est.unknownVolume.length) {
    return { id: "time", state: "not_checked", title: "Time",
      detail: `${label}. Not estimated (no recorded volume): ${est.unknownVolume.join(", ")}.`,
      stepIds: [] };
  }
  return { id: "time", state: "pass", title: "Time", detail: `${label}.`, stepIds: [] };
}

export function checkSafety(items: PlanItem[], profile: ConstraintsProfile): CheckResult {
  const findings: string[] = [];
  const stepIds = ["wire", "test"];
  let state: CheckState = "pass";
  const batteries = items.filter((i) => typeof i.specs?.chemistry === "string");
  for (const b of batteries) {
    const chem = String(b.specs?.chemistry).toLowerCase();
    if (chem.includes("lipo") || chem.includes("liion")) {
      findings.push(`${b.name}: ${chem === "lipo" ? "LiPo" : "Li-ion"} care — balance-charge, ` +
        `never charge swollen or punctured packs, charge on a non-flammable surface, ` +
        `and storage-charge packs you won't use for a while.`);
      const hasCharger = profile.toolsOnHand.includes("lipo_charger")
        || items.some((i) => i.partId === "lipo_balance_charger");
      if (chem.includes("lipo") && !hasCharger) {
        state = "blocked";
        findings.push(`BLOCKER: a LiPo battery is in this build but no balance charger ` +
          `is — not in the parts list and not in your tool profile.`);
      }
    }
  }
  if (state === "blocked") {
    return { id: "safety", state, title: "Safety gates", detail: findings.join(" "),
      fix: "Add the catalogue's LiPo balance charger to the build, or tick " +
        "\"LiPo balance charger\" in Your constraints if you already own one.",
      stepIds };
  }
  const powerish = items.some((i) => ["power", "drivers", "actuators"].includes(i.partClass ?? ""));
  if (powerish && !profile.toolsOnHand.includes("bench_supply")) {
    state = "warn";
    findings.push("First power-up: no current-limited bench supply in your profile. " +
      "Safer alternative: fit an inline fuse, keep the wheels off the ground and the " +
      "motors unloaded, and check polarity with a multimeter before the battery connects.");
  }
  const solder = requiredTools(items).some((r) => r.tool === "soldering_iron");
  if (solder && profile.experience === "first") {
    state = "warn";
    findings.push("Soldering is tagged advanced for a first build — the safer " +
      "alternative is pre-crimped pigtails, or have an experienced builder check the joints.");
  }
  if (!findings.length) {
    findings.push("Standard gates apply and are written into the Test phase: polarity " +
      "check before connecting, wheels off the ground for the first drive, one change " +
      "at a time when something misbehaves.");
  }
  return { id: "safety", state, title: "Safety gates", detail: findings.join(" "), stepIds };
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export type PlanPhase = "Buy" | "Print" | "Prep" | "Assemble" | "Wire" | "Program" | "Test";
export const PHASE_ORDER: PlanPhase[] = ["Buy", "Print", "Prep", "Assemble", "Wire", "Program", "Test"];

export interface PlanStep {
  id: string;
  phase: PlanPhase;
  title: string;
  items: string[];
  tools: string[];
  materials: string[];
  /** Labeled estimate range in minutes; absent = not estimated. */
  estMinutes?: { min: number; max: number };
  timeLabel?: string;
  note?: string;
  checkpoint: string;
  advanced?: boolean;
  checkIds: string[];
}

export interface BuildPlan {
  schema: "robotforge-build-plan/1";
  title: string;
  profile: ConstraintsProfile;
  items: PlanItem[];
  steps: PlanStep[];
  checks: CheckResult[];
  summary: { steps: number; blockers: number; warnings: number; notChecked: number; passes: number };
}

const toolLabel = (id: string) => TOOL_OPTIONS.find((t) => t.id === id)?.label ?? id;

export function generateBuildPlan(input: {
  title: string;
  items: PlanItem[];
  profile: ConstraintsProfile;
  partsById: Map<string, Part>;
  robotMassKg?: number | null;
  robotMassLabel?: string;
  wiring?: Wiring | null;
}): BuildPlan {
  const { title, items, profile, partsById } = input;
  const steps: PlanStep[] = [];
  const prints = items.filter((i) => i.role === "print");
  const buys = items.filter((i) => i.role === "buy");
  const fil = chosenFilament(items, profile, partsById);
  const timeEst = printTimeEstimate(items, profile, partsById);

  if (buys.length) {
    steps.push({
      id: "buy", phase: "Buy", title: "Buy the recorded parts",
      items: buys.map((b) => `${b.qty} × ${b.name}`),
      tools: [], materials: [],
      note: "Vendor links in the BOM are searches, not listings. Record the prices " +
        "you find in Your constraints — your own figure, or a sourced estimate with " +
        "its supplier and link — and the budget check works from those records only.",
      checkpoint: "Everything is in hand. If you substitute a part, re-run this plan — " +
        "fit, power and torque checks all read the recorded specs of the parts chosen.",
      checkIds: [],
    });
  }
  for (const p of prints) {
    const range = timeEst?.perItem.get(p.key);
    steps.push({
      id: PRINT_STEP(p.key), phase: "Print",
      title: `Print: ${p.name}${p.qty > 1 ? ` × ${p.qty}` : ""}`,
      items: [`${p.qty} × ${p.name}`],
      tools: [toolLabel("3d_printer"), toolLabel("calipers")],
      materials: fil ? [fil.name] : [],
      estMinutes: range ? { min: Math.round(range.minH * 60), max: Math.round(range.maxH * 60) } : undefined,
      timeLabel: range ? "estimate — slicer is the authority" : undefined,
      note: p.printNote,
      checkpoint: p.dims
        ? `Measure the part against its recorded size (${fmt(p.dims.x)} × ${fmt(p.dims.y)} × ` +
          `${fmt(p.dims.z)} mm${p.dims.estimated ? ", estimated dims" : ""}) before printing the rest.`
        : "The catalogue records no dimensions for this generated part — check the " +
          "generated file's size in your slicer before printing.",
      checkIds: [],
    });
  }
  steps.push({
    id: "prep", phase: "Prep",
    title: "Stage tools, parts and bench",
    items: items.filter((i) => i.role !== "prop").map((i) => i.name),
    tools: requiredTools(items).map((r) => toolLabel(r.tool)),
    materials: profile.materialsOnHand,
    checkpoint: `Bench clear across your ${profile.workspaceMm} mm; every tool the plan ` +
      `names is out before the first bolt.`,
    checkIds: [],
  });
  const structure = items.filter((i) => i.role === "print" || i.partClass === "structure");
  const drive = buys.filter((i) => i.partClass === "actuators"
    || (i.partId ?? "").includes("wheel"));
  const brains = buys.filter((i) => ["sbc", "sensors", "drivers", "power"].includes(i.partClass ?? ""));
  const others = buys.filter((i) => !drive.includes(i) && !brains.includes(i));
  const assembleGroups: { id: string; title: string; group: PlanItem[]; checkpoint: string }[] = [
    { id: "assemble", title: "Assemble the structure", group: structure,
      checkpoint: "Parts seat without forcing; recorded mounting holes line up; the deck sits flat." },
    { id: "assemble:drive", title: "Fit drive: motors and wheels", group: drive,
      checkpoint: "Wheels spin freely by hand with no rubbing; shafts are seated fully." },
    { id: "assemble:brains", title: "Mount computer, drivers, sensors and battery", group: brains,
      checkpoint: "Battery sits low and central where the design allows; nothing flexes when the deck is lifted." },
    { id: "assemble:other", title: "Fit the remaining parts", group: others,
      checkpoint: "Everything on the list is mounted or deliberately set aside with a reason." },
  ];
  let assemblyHours = 0.5;
  for (const g of assembleGroups) {
    if (!g.group.length) continue;
    const minutes = Math.min(90, 15 + 10 * g.group.length);
    assemblyHours += minutes / 60;
    steps.push({
      id: g.id, phase: "Assemble", title: g.title,
      items: g.group.map((i) => `${i.qty} × ${i.name}`),
      tools: [toolLabel("hex_drivers"), toolLabel("screwdriver_set")],
      materials: [],
      estMinutes: { min: minutes, max: Math.round(minutes * 1.6) },
      timeLabel: "rough estimate",
      checkpoint: g.checkpoint,
      checkIds: [],
    });
  }
  const powerish = items.some((i) => ["power", "drivers", "actuators", "sbc"].includes(i.partClass ?? ""));
  if (powerish) {
    const solder = requiredTools(items).some((r) => r.tool === "soldering_iron");
    steps.push({
      id: "wire", phase: "Wire", title: "Wire power and signals",
      items: items.filter((i) => ["power", "drivers", "actuators", "sbc", "sensors"].includes(i.partClass ?? ""))
        .map((i) => i.name),
      tools: [toolLabel("wire_tools"), toolLabel("multimeter"), ...(solder ? [toolLabel("soldering_iron")] : [])],
      materials: [],
      estMinutes: { min: 30, max: 60 }, timeLabel: "rough estimate",
      advanced: solder,
      note: "Battery low and central; power runs short and direct; signal leads away " +
        "from motor wires where the layout allows.",
      checkpoint: "Polarity verified with a multimeter on every power lead BEFORE the " +
        "battery connects; no bare conductor can touch a neighbour.",
      checkIds: [],
    });
    assemblyHours += 0.75;
  }
  if (items.some((i) => i.partClass === "sbc" || i.partClass === "actuators")) {
    steps.push({
      id: "program", phase: "Program", title: "Load firmware / software and configure",
      items: items.filter((i) => i.partClass === "sbc").map((i) => i.name),
      tools: [], materials: [],
      estMinutes: { min: 45, max: 90 }, timeLabel: "rough estimate",
      checkpoint: "The computer boots on battery power and each motor answers a " +
        "low-speed command — wheels still off the ground.",
      checkIds: [],
    });
    assemblyHours += 1;
  }
  steps.push({
    id: "test", phase: "Test", title: "First power and first drive",
    items: [],
    tools: [toolLabel("multimeter"), ...(profile.toolsOnHand.includes("bench_supply") ? [toolLabel("bench_supply")] : [])],
    materials: [],
    estMinutes: { min: 30, max: 60 }, timeLabel: "rough estimate",
    note: "First-power checklist: polarity checked · current limited or fused · wheels " +
      "off the ground · motors unloaded · one change at a time when something misbehaves.",
    checkpoint: "Robot drives straight at low speed, stops on command, and every sensor " +
      "in the build reports plausible values.",
    checkIds: [],
  });

  const checks: CheckResult[] = [
    checkPrintFit(items, profile),
    checkWorkspace(items, profile),
    checkMaterialFit(items, profile),
    checkTools(items, profile),
    checkPower(items, input.wiring ?? null),
    checkTorque(items, input.robotMassKg, input.robotMassLabel),
    checkBudget(items, profile),
    checkTime(items, profile, partsById, assemblyHours),
    checkSafety(items, profile),
  ];
  const stepById = new Map(steps.map((s) => [s.id, s]));
  for (const c of checks) {
    for (const sid of c.stepIds) {
      const s = stepById.get(sid);
      if (s && !s.checkIds.includes(c.id)) s.checkIds.push(c.id);
    }
    /* Prefix step ids ("assemble") also badge their sub-steps. */
    for (const s of steps) {
      if (c.stepIds.some((sid) => s.id === sid || s.id.startsWith(sid + ":")) && !s.checkIds.includes(c.id)) {
        s.checkIds.push(c.id);
      }
    }
  }
  const count = (st: CheckState) => checks.filter((c) => c.state === st).length;
  return {
    schema: "robotforge-build-plan/1",
    title, profile, items, steps, checks,
    summary: {
      steps: steps.length,
      blockers: count("blocked"),
      warnings: count("warn"),
      notChecked: count("not_checked"),
      passes: count("pass"),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

const STATE_LABEL: Record<CheckState, string> = {
  pass: "PASS", warn: "WARNING", blocked: "BLOCKED", not_checked: "NOT CHECKED",
};

export function planToMarkdown(plan: BuildPlan): string {
  const s = plan.summary;
  const out: string[] = [
    `# Build plan — ${plan.title}`,
    "",
    `${s.steps} steps · ${s.blockers} blocker(s) · ${s.warnings} warning(s) · ` +
    `${s.notChecked} not checked · ${s.passes} passed`,
    "",
    "Checks use only recorded catalogue/kit data and the constraints profile below. " +
    "Anything the data does not cover is marked NOT CHECKED — never passed silently. " +
    "Estimates are labeled; prices appear only where the builder entered them.",
    "",
    "## Your constraints (as checked against)",
    "",
    `- Printer bed: ${plan.profile.bedXmm} × ${plan.profile.bedYmm} × ${plan.profile.bedZmm} mm, ` +
    `nozzle ${plan.profile.nozzleMm} mm`,
    `- Materials on hand: ${plan.profile.materialsOnHand.join(", ") || "none"}`,
    `- Tools on hand: ${plan.profile.toolsOnHand.map(toolLabel).join(", ") || "none"}`,
    `- Environment: ${plan.profile.environment} · Experience: ${plan.profile.experience} · ` +
    `Bench space: ${plan.profile.workspaceMm} mm`,
    "",
    "## Checks",
    "",
  ];
  for (const c of plan.checks) {
    out.push(`- **${c.title}: ${STATE_LABEL[c.state]}** — ${c.detail}`);
    if (c.fix) out.push(`  - Fix: ${c.fix}`);
  }
  /* Every currency figure in this export traces to a record
   * listed here — a user-entered price or a sourced estimate
   * with supplier, link and fetch time. No record, no figure. */
  const pricedLines = plan.items
    .filter((i) => i.role === "buy")
    .map((i) => ({ item: i, price: resolvedPrice(i, plan.profile) }))
    .filter((x) => x.price !== null);
  if (pricedLines.length) {
    out.push("", "## Prices (recorded)", "");
    for (const { item, price } of pricedLines) {
      out.push(`- ${item.qty} × ${item.name} — $${(price!.amount * item.qty).toFixed(2)} (${price!.label})`);
      if (price!.snippet) out.push(`  - Receipt: "${price!.snippet}"`);
    }
    out.push("- Shipping, tax and stock are unknown — not included in any total.");
  }
  const checkById = new Map(plan.checks.map((c) => [c.id, c]));
  for (const phase of PHASE_ORDER) {
    const phaseSteps = plan.steps.filter((st) => st.phase === phase);
    if (!phaseSteps.length) continue;
    out.push("", `## ${phase}`, "");
    for (const st of phaseSteps) {
      const badges = st.checkIds
        .map((id) => checkById.get(id))
        .filter((c) => c && c.state !== "pass")
        .map((c) => `[${c!.title}: ${STATE_LABEL[c!.state]}]`);
      out.push(`### ${st.title}${badges.length ? " " + badges.join(" ") : ""}`);
      if (st.items.length) out.push(`- Parts: ${st.items.join("; ")}`);
      if (st.tools.length) out.push(`- Tools: ${st.tools.join(", ")}`);
      if (st.materials.length) out.push(`- Materials: ${st.materials.join(", ")}`);
      if (st.estMinutes) {
        out.push(`- Time: ~${st.estMinutes.min}–${st.estMinutes.max} min (${st.timeLabel ?? "estimate"})`);
      }
      if (st.note) out.push(`- Note: ${st.note}`);
      out.push(`- Checkpoint: ${st.checkpoint}`);
      out.push("");
    }
  }
  return out.join("\n");
}

export function planToJson(plan: BuildPlan): BuildPlan {
  return plan;
}
