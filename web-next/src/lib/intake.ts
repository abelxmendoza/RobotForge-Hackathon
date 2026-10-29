/**
 * Photo intake — Wave 5: input classification, per-part confidence,
 * parts-catalogue matching, and the parts-find store.
 *
 * The intake classifies a capture BEFORE it is filed, into one of
 * three classes (Abel's requirements, 2026-10-28):
 *
 *   direct      — a photo of a real robot. Standard flow.
 *   second-hand — a photo of a PICTURE (screen, print, poster).
 *     Identification may run, but a picture carries no scale, so
 *     dimensions are withheld from the entry entirely, confidence
 *     is downgraded, and the flow says to photograph the real robot
 *     or supply the original image instead.
 *   parts       — individual parts or a parts spread, not a whole
 *     robot. Routed to catalogue matching, never filed as a robot
 *     sighting.
 *
 * Classification is heuristic and is labelled as such everywhere it
 * appears: pre-draft signals come from the file itself (name +
 * a screen-pattern measurement on the pixels), post-draft signals
 * from the vision draft's own inventory. The class is shown to the
 * user, stored with the entry, and correctable at the confirm step
 * — the heuristics propose, the user disposes, exactly like the
 * Robodex grouping itself.
 *
 * Nothing in this module invents a number: match scores and
 * confidence labels are deterministic local computations whose
 * method is printed next to them in the UI, and a model-reported
 * confidence is shown only when the draft actually carries one.
 */
import { normalizeTokens } from "./grouping";
import type { DraftLike } from "./grouping";
import type { Part } from "./types";

export type InputClass = "direct" | "second-hand" | "parts";

export const INPUT_CLASS_LABEL: Record<InputClass, string> = {
  direct: "Direct photo",
  "second-hand": "Photo of a picture",
  parts: "Parts photo",
};

/* ------------------------------------------------------------------ */
/* Pre-draft signals (the file itself, before any model call)          */
/* ------------------------------------------------------------------ */

export interface PreSignals {
  secondHand: boolean;
  basis: string[];
  /** 0..1 screen-pattern measurement (see screenPatternScore). */
  patternScore: number;
}

const SCREENSHOT_NAME = /screenshot|screen[ _-]?shot|screen[ _-]?capture/i;

/**
 * Screen-pattern measurement on a luminance grid: the lag-1
 * decorrelation of the column-mean and row-mean signals, maximised.
 * A photographed LCD/OLED shows strong periodic sub-pixel striping,
 * which survives averaging as high-frequency energy in the means
 * (score near 1); natural scenes average out smooth (score low).
 * It is a conservative signal, not a detector: it can miss angled
 * or distant screens, which is why the class is correctable and
 * why a strong filename signal can fire on its own.
 */
export function screenPatternScore(
  lum: ArrayLike<number>,
  width: number,
  height: number,
): number {
  if (width < 8 || height < 8) return 0;
  const axis = (means: number[]): number => {
    const n = means.length;
    const avg = means.reduce((a, b) => a + b, 0) / n;
    let varSum = 0;
    let diffSum = 0;
    for (let i = 0; i < n; i++) varSum += (means[i] - avg) ** 2;
    for (let i = 0; i + 1 < n; i++) diffSum += (means[i + 1] - means[i]) ** 2;
    if (varSum <= 0) return 0;
    // E[diff^2] / (2 Var) = 1 - rho_1 for a stationary signal.
    return Math.min(1, Math.max(0, diffSum / (2 * varSum)));
  };
  const colMeans: number[] = [];
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = 0; y < height; y++) s += lum[y * width + x];
    colMeans.push(s / height);
  }
  const rowMeans: number[] = [];
  for (let y = 0; y < height; y++) {
    let s = 0;
    for (let x = 0; x < width; x++) s += lum[y * width + x];
    rowMeans.push(s / width);
  }
  return Math.max(axis(colMeans), axis(rowMeans));
}

/** Browser wrapper: downscale the image to a 192px grid and measure
 *  its luminance pattern. Any failure reads as "no signal" — the
 *  classifier then relies on the filename + draft signals alone. */
export async function measureScreenPattern(dataUrl: string): Promise<number> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image load failed"));
      i.src = dataUrl;
    });
    const W = 192;
    const H = Math.max(8, Math.round((img.height / img.width) * W));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const lum = new Float32Array(W * H);
    for (let p = 0; p < W * H; p++) {
      lum[p] =
        0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2];
    }
    return screenPatternScore(lum, W, H);
  } catch {
    return 0;
  }
}

/** The pattern score at which the screen signal fires on its own.
 *  Deliberately conservative — see the note on screenPatternScore. */
export const SCREEN_PATTERN_THRESHOLD = 0.55;

export function preClassify(fileName: string, patternScore: number): PreSignals {
  const basis: string[] = [];
  let secondHand = false;
  if (SCREENSHOT_NAME.test(fileName || "")) {
    secondHand = true;
    basis.push("the file name marks it as a screenshot / screen capture");
  }
  if (patternScore >= SCREEN_PATTERN_THRESHOLD) {
    secondHand = true;
    basis.push(
      `the pixels carry a strong periodic screen pattern (local measurement ${patternScore.toFixed(2)} of 1.00)`,
    );
  }
  return { secondHand, basis, patternScore };
}

/* ------------------------------------------------------------------ */
/* Post-draft classification                                           */
/* ------------------------------------------------------------------ */

export interface Classification {
  cls: InputClass;
  basis: string[];
}

const PARTS_PHRASE =
  /\b(parts|components|assort\w*|pile|collection|kit of|spread|loose|spare)\b/i;

/**
 * Decide the final class once the vision draft exists. `familyMatch`
 * is the caller's grouping verdict (the draft's identity matched a
 * dex family) — a strong whole-robot signal the heuristics defer to.
 */
export function classifyFromDraft(args: {
  draft: DraftLike;
  pre: PreSignals;
  familyMatch: boolean;
}): Classification {
  const { draft, pre, familyMatch } = args;
  if (pre.secondHand) {
    return { cls: "second-hand", basis: [...pre.basis] };
  }
  const parts = draft.visible_parts ?? [];
  const identity = String(draft.identity_guess ?? "");
  const hasBody = parts.some((p) => {
    const k = String(p.kind ?? "").toLowerCase();
    return k.includes("body") || k.includes("chassis");
  });
  if (PARTS_PHRASE.test(identity) && !familyMatch) {
    return {
      cls: "parts",
      basis: [
        `the draft's own identity reads as parts, not a robot (“${identity}”)`,
        "no dex family match for the identity",
      ],
    };
  }
  if (parts.length >= 3 && !hasBody && !familyMatch) {
    return {
      cls: "parts",
      basis: [
        `${parts.length} separate items are visible and none of them is a body or chassis`,
        "no dex family match for the identity",
      ],
    };
  }
  const basis = ["a whole robot is the draft's subject"];
  if (hasBody) basis.push("a body/chassis is among the visible parts");
  if (familyMatch) basis.push("the identity matches a dex family");
  if (pre.patternScore > 0) {
    basis.push(
      `no screen pattern fired (local measurement ${pre.patternScore.toFixed(2)} of 1.00)`,
    );
  }
  return { cls: "direct", basis };
}

/* ------------------------------------------------------------------ */
/* Dimensions withholding (second-hand)                                */
/* ------------------------------------------------------------------ */

const DIMENSION_KEYS = [
  "length_m",
  "width_m",
  "height_m",
  "mass_kg",
  "ground_clearance_m",
  "wheel",
] as const;

/**
 * A copy of a spec with every scale-carrying field removed. A
 * picture has no scale, so for a second-hand entry the model's
 * size guesses are withheld rather than filed — the entry keeps
 * identity, drivetrain and the non-dimensional blocks only.
 */
export function stripDimensions<T extends Record<string, unknown>>(spec: T): T {
  const out: Record<string, unknown> = { ...spec };
  for (const k of DIMENSION_KEYS) delete out[k];
  return out as T;
}

/* ------------------------------------------------------------------ */
/* Per-part confidence (local cross-checks, honestly labelled)         */
/* ------------------------------------------------------------------ */

export interface SamCheckLike {
  kind: string;
  draft_count: number;
  sam_count: number;
  verdict: string;
  [k: string]: unknown;
}

interface VisiblePart {
  kind: string;
  count?: number;
  confidence?: number;
  [k: string]: unknown;
}

interface SpecLike {
  wheel?: { count?: number } | null;
  motor?: { count?: number } | null;
  battery?: unknown;
  sensors?: Array<{ kind?: string }> | null;
  arms?: { count?: number } | null;
  rotors?: { count?: number } | null;
  legs?: { count?: number } | null;
  [k: string]: unknown;
}

const lc = (v: unknown): string => String(v ?? "").toLowerCase();

/**
 * What this browser can honestly say about one drafted part:
 * a model-reported confidence when the draft carries one, else a
 * LOCAL cross-check of the part against the drafted spec's own
 * blocks (wheel vs wheel block, lidar vs sensor list, ...). The
 * label says which it is — a cross-check is never dressed up as a
 * model confidence.
 */
export function partConfidence(
  part: VisiblePart,
  spec: SpecLike | null | undefined,
  inputClass: InputClass,
): string {
  let base: string;
  if (typeof part.confidence === "number" && Number.isFinite(part.confidence)) {
    base = `model confidence ${Math.round(part.confidence * 100)}%`;
  } else {
    const kind = lc(part.kind);
    const count = typeof part.count === "number" ? part.count : null;
    const vsCount = (
      block: { count?: number } | null | undefined,
      label: string,
    ): string =>
      block
        ? count !== null && typeof block.count === "number"
          ? count === block.count
            ? `corroborated — the drafted spec's ${label} count agrees`
            : `count differs — photo shows ${count}, the drafted spec says ${block.count} (${label})`
          : `corroborated — the drafted spec carries a ${label} block`
        : "seen in the photo only — no spec block to check it against";
    const sensorHit = (needles: string[]): boolean =>
      (spec?.sensors ?? []).some((s) =>
        needles.some((n) => lc(s.kind).includes(n)),
      );
    if (kind.includes("wheel") || kind.includes("caster")) {
      base = vsCount(spec?.wheel, "wheel");
    } else if (kind.includes("motor")) {
      base = vsCount(spec?.motor, "motor");
    } else if (kind.includes("battery")) {
      base = spec?.battery
        ? "corroborated — the drafted spec carries a battery block"
        : "seen in the photo only — no spec block to check it against";
    } else if (kind.includes("lidar")) {
      base = sensorHit(["lidar"])
        ? "corroborated — the drafted spec lists a lidar sensor"
        : "seen in the photo only — the drafted spec lists no lidar";
    } else if (kind.includes("camera") || kind.includes("depth")) {
      base = sensorHit(["camera", "depth"])
        ? "corroborated — the drafted spec lists a camera sensor"
        : "seen in the photo only — the drafted spec lists no camera";
    } else if (kind.includes("ultrasonic") || kind.includes("imu") || kind.includes("sensor")) {
      base = sensorHit(["ultrasonic", "imu", "sensor"])
        ? "corroborated — the drafted spec lists a matching sensor"
        : "seen in the photo only — the drafted spec lists no matching sensor";
    } else if (kind.includes("arm") || kind.includes("gripper") || kind.includes("manipulator")) {
      base = spec?.arms
        ? "corroborated — the drafted spec carries an arm block"
        : "seen in the photo only — no spec block to check it against";
    } else if (kind.includes("propeller") || kind.includes("rotor")) {
      base = spec?.rotors
        ? "corroborated — the drafted spec carries a rotor block"
        : "seen in the photo only — no spec block to check it against";
    } else if (kind.includes("leg")) {
      base = spec?.legs
        ? "corroborated — the drafted spec carries a leg block"
        : "seen in the photo only — no spec block to check it against";
    } else {
      base = "seen in the photo only — no spec block to check it against";
    }
  }
  if (inputClass === "second-hand") {
    return base + " · lowered — second-hand image";
  }
  return base;
}

/* ------------------------------------------------------------------ */
/* Parts -> catalogue matching (the PARTS route)                       */
/* ------------------------------------------------------------------ */

export interface PartMatch {
  /** The visible item, as drafted. */
  label: string;
  count: number;
  /** Matched catalogue part, or null — a non-match says so. */
  part: Part | null;
  /** Deterministic local match score (method in matchBasis). */
  score: number;
  level: "strong" | "partial" | "none";
  matchBasis: string;
}

/* Kind word -> catalogue part_class, the +1 class hint. Mirrors the
 * spirit of the Python spotter's per-kind scorers at catalogue
 * granularity: it can support a token match, never create one. */
const CLASS_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/battery|charger/, "power"],
  [/motor|servo|stepper/, "actuators"],
  [/wheel|caster/, "wheels"],
  [/lidar|camera|depth|imu|ultrasonic|sensor/, "cameras_sensors"],
  [/driver|esc\b/, "drivers"],
  [/propeller|prop\b/, "propulsion_air"],
  [/frame|chassis|plate|mount|bracket|extrusion/, "structure"],
  [/gripper/, "end_effectors"],
  [/wire|cable|connector/, "cables_connectors"],
];

/**
 * Match one visible item against the catalogue by token overlap —
 * the web mirror of the Spotter dossier's kind-token guesses.
 * Score: a shared token with the part's id weighs 3, with its name
 * 2, plus 1 when the kind's catalogue class agrees. >= 6 is a
 * strong match, >= 3 partial, below that the item is honestly
 * unmatched. The basis string prints what was shared.
 */
export function matchPartToCatalog(
  item: { kind: string; count?: number; notes?: string },
  catalog: Part[],
): PartMatch {
  const kindTokens = new Set([
    ...normalizeTokens(item.kind),
    ...normalizeTokens(item.notes ?? ""),
  ]);
  let best: Part | null = null;
  let bestScore = 0;
  let bestShared: string[] = [];
  let bestClassHit = false;
  for (const part of catalog) {
    const idTokens = new Set(normalizeTokens(part.id.replace(/_/g, " ")));
    const nameTokens = new Set(normalizeTokens(part.name));
    let score = 0;
    const shared: string[] = [];
    for (const t of kindTokens) {
      if (idTokens.has(t)) {
        score += 3;
        shared.push(t);
      } else if (nameTokens.has(t)) {
        score += 2;
        shared.push(t);
      }
    }
    const classHit = CLASS_HINTS.some(
      ([re, cls]) => re.test(lc(item.kind)) && part.part_class === cls,
    );
    if (classHit) score += 1;
    if (score > bestScore) {
      best = part;
      bestScore = score;
      bestShared = shared;
      bestClassHit = classHit;
    }
  }
  const matched = bestScore >= 3 ? best : null;
  return {
    label: item.kind,
    count: typeof item.count === "number" ? item.count : 1,
    part: matched,
    score: bestScore,
    level: bestScore >= 6 ? "strong" : bestScore >= 3 ? "partial" : "none",
    matchBasis: matched
      ? `shared tokens: ${bestShared.join(", ") || "none"}${
          bestClassHit ? "; catalogue class agrees" : ""
        } (local token match, score ${bestScore})`
      : "no catalogue part shares enough tokens with this item",
  };
}

export function matchPartsToCatalog(
  items: Array<{ kind: string; count?: number; notes?: string }>,
  catalog: Part[],
): PartMatch[] {
  return items.map((it) => matchPartToCatalog(it, catalog));
}

/* ------------------------------------------------------------------ */
/* Assembly inference (labelled inference, catalogue classes only)     */
/* ------------------------------------------------------------------ */

const ASSEMBLY_SLOTS: ReadonlyArray<readonly [string, string]> = [
  ["power", "power"],
  ["actuators", "motors / actuators"],
  ["drivers", "motor drivers"],
  ["wheels", "wheels"],
  ["sbc", "an SBC"],
  ["microcontrollers", "a microcontroller"],
  ["cameras_sensors", "sensors"],
  ["structure", "structure"],
];

/**
 * What a matched parts set adds up to, stated as inference from
 * catalogue classes only — never as an identification. Null when
 * fewer than three items matched: too little to infer from.
 */
export function inferAssembly(matches: PartMatch[]): string | null {
  const matched = matches.filter((m) => m.part);
  if (matched.length < 3) return null;
  const classes = new Set(matched.map((m) => m.part!.part_class));
  const covered: string[] = [];
  const missing: string[] = [];
  for (const [cls, label] of ASSEMBLY_SLOTS) {
    (classes.has(cls) ? covered : missing).push(label);
  }
  const compute = classes.has("sbc") || classes.has("microcontrollers");
  const core =
    classes.has("power") &&
    (classes.has("actuators") || classes.has("drivers")) &&
    classes.has("wheels");
  const head = core
    ? "Power, drive and wheels are all here — the core of a small wheeled robot"
    : "The set does not yet cover a wheeled robot's core (power + drive + wheels)";
  return (
    `${head}. Covered: ${covered.join(", ") || "none of the standard slots"}` +
    (compute ? "" : "; no compute board matched") +
    `. Not in this set: ${missing.join(", ") || "nothing standard"}.`
  );
}

/* ------------------------------------------------------------------ */
/* Parts finds — the parts side of the per-browser dex                 */
/* ------------------------------------------------------------------ */

export const LOCAL_PARTS_KEY = "robotforge.dex.parts.v1";

export interface StoredPartsFind {
  id: string;
  found_at: string;
  /** Small thumbnail data URL, as with sightings — never the full photo. */
  photo: string | null;
  items: Array<{
    label: string;
    count: number;
    matched_part_id: string | null;
    catalog_name: string | null;
    level: PartMatch["level"];
    match_basis: string;
  }>;
  inference: string | null;
}

export function loadPartsFinds(): StoredPartsFind[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_PARTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is StoredPartsFind =>
        Boolean(
          x &&
            typeof x === "object" &&
            Array.isArray((x as StoredPartsFind).items),
        ),
    );
  } catch {
    return [];
  }
}

/** Same honesty pattern as saveSighting: on a failed write, return
 *  what is actually stored so the caller can only confirm a save
 *  that really happened. */
export function savePartsFind(entry: StoredPartsFind): StoredPartsFind[] {
  const next = [...loadPartsFinds(), entry];
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCAL_PARTS_KEY, JSON.stringify(next));
    } catch {
      return loadPartsFinds();
    }
  }
  return next;
}

export function buildPartsFind(
  matches: PartMatch[],
  inference: string | null,
  photoThumb: string | null,
): StoredPartsFind {
  const now = new Date();
  return {
    id: `local-parts-${now.getTime()}`,
    found_at: now.toISOString().slice(0, 10),
    photo: photoThumb,
    items: matches.map((m) => ({
      label: m.label,
      count: m.count,
      matched_part_id: m.part ? m.part.id : null,
      catalog_name: m.part ? m.part.name : null,
      level: m.level,
      match_basis: m.matchBasis,
    })),
    inference,
  };
}

/* ------------------------------------------------------------------ */
/* Multi-angle contact sheet (browser)                                 */
/* ------------------------------------------------------------------ */

export interface AnglePhoto {
  /** 'front' | 'side' | 'top' — or 'photo' for an unlabelled shot. */
  angle: string;
  dataUrl: string;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });
}

/**
 * Stitch the session's angle photos into ONE labelled sheet so a
 * single vision call sees every view together (the endpoint takes
 * one image; the sheet is how the angles feed one draft). A single
 * photo passes through unchanged.
 */
export async function buildContactSheet(photos: AnglePhoto[]): Promise<string> {
  if (photos.length <= 1) return photos[0]?.dataUrl ?? "";
  const W = 768;
  const BAR = 30;
  const loaded: Array<{ img: HTMLImageElement; angle: string; h: number }> = [];
  for (const p of photos) {
    const img = await loadImage(p.dataUrl);
    loaded.push({
      img,
      angle: p.angle,
      h: Math.round((img.height / img.width) * W),
    });
  }
  const totalH = loaded.reduce((a, l) => a + l.h + BAR, 0);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = totalH;
  const ctx = c.getContext("2d");
  if (!ctx) return photos[0].dataUrl;
  let y = 0;
  for (const l of loaded) {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, y, W, BAR);
    ctx.fillStyle = "#fff";
    ctx.font = "600 17px system-ui, sans-serif";
    ctx.fillText(l.angle.toUpperCase() + " VIEW", 12, y + 21);
    y += BAR;
    ctx.drawImage(l.img, 0, y, W, l.h);
    y += l.h;
  }
  return c.toDataURL("image/jpeg", 0.85);
}
