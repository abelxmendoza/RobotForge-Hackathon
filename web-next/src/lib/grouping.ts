/**
 * Robodex grouping — a TypeScript MIRROR of the Python signature
 * rules in src/robotforge/robodex.py (landed in this checkout as
 * commit 3c875b8 while this file was being built; the mirror was
 * aligned to that landed version, not only to the original brief).
 *
 * Aligned with the Python side: manipulator / top_lidar /
 * drivetrain / payloads extraction (including the payload token
 * map, its exclusion list, the top-lidar model steps and the
 * variant_label composition), exact signature equality ("unknown"
 * is a value, never a wildcard), and the name-relation rule
 * (exact token-set / compact match, or brand + model-number match
 * with one side's tokens a subset of the other's).
 *
 * Two deliberate, documented gaps against the Python engine:
 *  1. Python demotes a brand-only name relation, and a name match
 *     the draft contradicts on drivetrain / dimensions, to
 *     PROPOSE_FAMILY for human review. The web brief's outcome set
 *     has only the three outcomes below, so a brand-only relation
 *     counts as NO match here ("new-family") and contradictions
 *     are not checked — the web card is a filing suggestion, not
 *     the authority; the Python engine remains the one that can
 *     say "propose".
 *  2. Python's top-lidar model step 1 reads a Spotter dossier's
 *     parts[] catalog guesses; a live Forge PhotoDraft carries no
 *     such guesses, so that step only fires when a draft happens
 *     to carry a `parts` list in that shape.
 *
 * Persistence limit, stated plainly: this app is a static export,
 * so v1 sighting state is per-browser localStorage only (key
 * "robotforge.dex.sightings.v1"). Nothing here syncs between
 * visitors. The stored JSON is the same shape the Cloudflare
 * Worker would persist server-side once the live endpoint is
 * deployed — the shared dex sync is that endpoint's job.
 */
import type { DexSignature, DexSighting, Family } from "./types";
import { effectiveStorageKey } from "./demoMode";

export const LOCAL_SIGHTINGS_KEY = "robotforge.dex.sightings.v1";

/* ------------------------------------------------------------------ */
/* Draft shape (structural — compatible with the Forge PhotoDraft)     */
/* ------------------------------------------------------------------ */

export interface VisiblePartLike {
  kind: string;
  count?: number;
  position?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface SensorLike {
  kind: string;
  position?: string;
  [key: string]: unknown;
}

export interface DraftLike {
  identity_guess?: string;
  visible_parts?: VisiblePartLike[];
  /** Spotter-style parts guesses, when a draft carries them
   *  (live Forge photo drafts do not). */
  parts?: Array<{ label?: string; catalog_id?: string | null; [k: string]: unknown }>;
  spec?: {
    drivetrain?: string;
    sensors?: SensorLike[];
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export type DexSignatureT = DexSignature;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const lc = (v: unknown): string => String(v ?? "").toLowerCase();

/** Lowercase alphanumeric tokens, e.g. "Boston Dynamics Spot!" ->
 *  ["boston", "dynamics", "spot"]. */
export function normalizeTokens(text: string): string[] {
  return lc(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const STOP_TOKENS = new Set(["with", "the", "a", "an", "and", "of", "robot"]);

/** Python _norm_token: non-alphanumerics collapse to "_". */
function normToken(text: unknown): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/* ------------------------------------------------------------------ */
/* signatureFromDraft                                                  */
/* ------------------------------------------------------------------ */

/**
 * Derive a variant signature from a photo draft — the mirror of
 * Python signature_from_dossier, adapted from a Spotter dossier
 * (photo.visible_parts + draft spec) to the Forge PhotoDraft shape
 * (visible_parts + spec), which carries the same two inventories.
 *
 * manipulator:
 *   "present" — any visible part whose kind contains "arm" or
 *     "manipulator", or a spec sensor whose position mentions arm /
 *     gripper.
 *   "absent" — visible_parts is a non-empty inventory carrying a
 *     body / chassis entry and none of the arm evidence above.
 *   "unknown" — otherwise (no inventory to judge from).
 *
 * top_lidar (Python _top_lidar_model, most specific first):
 *   a model string when a spec sensor of kind "lidar_2d" sits on
 *     top, or a lidar visible part sits on top: (1) a parts guess
 *     mentioning lidar with a catalog_id names the model (Andino's
 *     lidar -> "rplidar_a1"); (2) a brand token in the top lidar
 *     part's kind/notes (hokuyo / urg -> "hokuyo_urg", rplidar ->
 *     "rplidar_a1", velodyne -> "velodyne_lidar"); (3) "lidar_2d".
 *   "none" — an inventory exists (visible parts or a spec sensor
 *     list) and no top lidar is in it.
 *   "unknown" — no inventory exists.
 *
 * drivetrain: spec.drivetrain, or "" (Python's unknown spelling).
 *
 * payloads: Python _PAYLOAD_MAP over visible-part kinds only,
 * consulted only after _PAYLOAD_EXCLUDED kinds are skipped, first
 * map hit per part, sorted.
 */
const PAYLOAD_MAP: ReadonlyArray<readonly [needle: string, token: string]> = [
  ["ultrasonic", "ultrasonic_sensor"],
  ["depth camera", "depth_camera"],
  ["camera", "camera"],
  ["antenna", "antenna"],
  ["gps", "gps"],
  ["speaker", "speaker"],
  ["microphone", "microphone"],
  ["screen", "display"],
  ["display", "display"],
  ["basket", "cargo_basket"],
  ["cargo", "cargo_box"],
  ["beacon", "beacon"],
];
const PAYLOAD_EXCLUDED = [
  "body", "chassis", "leg", "wheel", "caster",
  "switch", "arm", "manipulator", "gripper", "lidar",
];
const LIDAR_BRAND_MODELS: ReadonlyArray<
  readonly [needles: readonly string[], model: string]
> = [
  [["hokuyo"], "hokuyo_urg"],
  [["urg"], "hokuyo_urg"],
  [["rplidar"], "rplidar_a1"],
  [["velodyne"], "velodyne_lidar"],
];

export function signatureFromDraft(draft: DraftLike): DexSignature {
  const parts = draft.visible_parts ?? [];
  const spec = draft.spec ?? {};
  const sensors = Array.isArray(spec.sensors) ? spec.sensors : [];

  /* --- manipulator --- */
  const armInParts = parts.some((p) => {
    const k = lc(p.kind);
    return k.includes("arm") || k.includes("manipulator");
  });
  const armInSensors = sensors.some((s) =>
    /arm|gripper/.test(lc(s.position)),
  );
  const hasBody = parts.some((p) => {
    const k = lc(p.kind);
    return k.includes("body") || k.includes("chassis");
  });
  let manipulator: string;
  if (armInParts || armInSensors) manipulator = "present";
  else if (parts.length > 0 && hasBody) manipulator = "absent";
  else manipulator = "unknown";

  /* --- top_lidar --- */
  const hasTopSensor = sensors.some(
    (s) => normToken(s.kind) === "lidar_2d" && lc(s.position).includes("top"),
  );
  const lidarVisibleTop = parts.filter(
    (p) => lc(p.kind).includes("lidar") && lc(p.position).includes("top"),
  );
  let top_lidar: string;
  if (hasTopSensor || lidarVisibleTop.length) {
    top_lidar = "lidar_2d";
    // (1) a parts guess mentioning lidar, with a catalog id
    for (const guess of draft.parts ?? []) {
      if (lc(guess.label).includes("lidar") && guess.catalog_id) {
        top_lidar = normToken(guess.catalog_id);
        break;
      }
    }
    // (2) a brand token in the top lidar part's kind/notes
    if (top_lidar === "lidar_2d") {
      for (const p of lidarVisibleTop) {
        const text = `${lc(p.kind)} ${lc(p.notes)}`;
        const hit = LIDAR_BRAND_MODELS.find(([needles]) =>
          needles.every((n) => text.includes(n)),
        );
        if (hit) {
          top_lidar = hit[1];
          break;
        }
      }
    }
  } else if (sensors.length > 0 || parts.length > 0) {
    top_lidar = "none";
  } else {
    top_lidar = "unknown";
  }

  /* --- drivetrain --- */
  const drivetrain = spec.drivetrain ? String(spec.drivetrain) : "";

  /* --- payloads --- */
  const payloads = new Set<string>();
  for (const p of parts) {
    const kind = lc(p.kind);
    if (PAYLOAD_EXCLUDED.some((x) => kind.includes(x))) continue;
    for (const [needle, token] of PAYLOAD_MAP) {
      if (kind.includes(needle)) {
        payloads.add(token);
        break;
      }
    }
  }

  return {
    manipulator,
    top_lidar,
    drivetrain,
    payloads: [...payloads].sort(),
  };
}

/* ------------------------------------------------------------------ */
/* Plain-words signature                                               */
/* ------------------------------------------------------------------ */

/** e.g. "Arm fitted · no top lidar · quadruped drive" */
export function describeSignature(sig: DexSignature): string {
  const arm =
    sig.manipulator === "present"
      ? "Arm fitted"
      : sig.manipulator === "absent"
        ? "No arm"
        : "Arm unknown";
  const lidar =
    sig.top_lidar === "none"
      ? "no top lidar"
      : sig.top_lidar === "unknown"
        ? "top lidar unknown"
        : `${sig.top_lidar} on top`;
  const drive =
    sig.drivetrain === "differential"
      ? "differential drive"
      : sig.drivetrain === "unknown" || !sig.drivetrain
        ? "drivetrain unknown"
        : sig.drivetrain === "quadruped"
          ? "quadruped"
          : `${String(sig.drivetrain).replace(/_/g, " ")} drive`;
  const bits = [arm, lidar, drive];
  if (sig.payloads && sig.payloads.length) {
    bits.push(`payloads: ${sig.payloads.join(", ")}`);
  }
  return bits.join(" · ");
}

export function signaturesEqual(a: DexSignature, b: DexSignature): boolean {
  const norm = (s: DexSignature) => ({
    manipulator: lc(s.manipulator),
    top_lidar: lc(s.top_lidar),
    drivetrain: lc(s.drivetrain),
    payloads: [...(s.payloads ?? [])].map(lc).sort(),
  });
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/* ------------------------------------------------------------------ */
/* Family matching + grouping                                          */
/* ------------------------------------------------------------------ */

/**
 * Family match — the mirror of Python _name_relation (spotter.py)
 * as robodex.classify_spotting uses it, restricted to the
 * relations the web groups on:
 *   exact  — compact names equal, or token sets equal;
 *   strong — brand tokens equal AND model numbers equal AND
 *     (a number is present, or one side's tokens are a subset of
 *     the other's). The brand token is the first purely alphabetic
 *     token; the number is the first purely numeric token.
 * A brand-only relation (Python "family") is NOT a match here —
 * see the header note on PROPOSE_FAMILY.
 */
function brandAndNumber(tokens: string[]): { brand: string; number: string } {
  return {
    brand: tokens.find((x) => /^[a-z]+$/.test(x)) ?? tokens[0] ?? "",
    number: tokens.find((x) => /^[0-9]+$/.test(x)) ?? "",
  };
}

export function familyMatches(identityGuess: string, family: Family): boolean {
  const guessTokens = normalizeTokens(identityGuess).filter(
    (x) => !STOP_TOKENS.has(x),
  );
  if (!guessTokens.length) return false;
  const guessSet = new Set(guessTokens);
  const guessCompact = guessTokens.join("");
  const { brand, number } = brandAndNumber(guessTokens);
  for (const name of [family.name, ...(family.aliases ?? [])]) {
    const candTokens = normalizeTokens(name).filter(
      (x) => !STOP_TOKENS.has(x),
    );
    if (!candTokens.length) continue;
    const candSet = new Set(candTokens);
    if (guessCompact && guessCompact === candTokens.join("")) return true;
    if (
      guessSet.size === candSet.size &&
      [...guessSet].every((x) => candSet.has(x))
    )
      return true;
    const cand = brandAndNumber(candTokens);
    if (brand !== cand.brand || number !== cand.number) continue;
    if (number !== "") return true;
    const subset =
      [...guessSet].every((x) => candSet.has(x)) ||
      [...candSet].every((x) => guessSet.has(x));
    if (subset) return true;
  }
  return false;
}

/**
 * Proposed variant label — the mirror of Python variant_label:
 * "<Family>" + " with Arm" when an arm is fitted + " + top lidar
 * (<model>)" for a named top lidar + " + <token>" per payload; an
 * all-baseline signature takes " (base configuration)" only when
 * sibling variants make the disambiguation necessary.
 */
export function proposeVariantLabel(
  familyOrIdentity: string,
  sig: DexSignature,
  variantCount = 1,
): string {
  let label = familyOrIdentity || "Unnamed robot";
  if (sig.manipulator === "present") label += " with Arm";
  if (sig.top_lidar !== "none" && sig.top_lidar !== "unknown" && sig.top_lidar) {
    label += ` + top lidar (${sig.top_lidar})`;
  }
  for (const token of [...(sig.payloads ?? [])].sort()) label += ` + ${token}`;
  const baseline =
    sig.manipulator === "absent" && sig.top_lidar === "none" && !sig.payloads?.length;
  if (label === (familyOrIdentity || "Unnamed robot") && baseline && variantCount > 1) {
    label += " (base configuration)";
  }
  return label;
}

export type GroupingOutcome = "existing-variant" | "new-variant" | "new-family";

export interface GroupingResult {
  outcome: GroupingOutcome;
  family: Family | null;
  /** The matched variant (existing-variant only), else null. */
  variant: Family["variants"][number] | null;
  /** Label for this signature: the matched variant's label, or a
   *  proposed label for a new variant / new family. */
  variantLabel: string;
  /** Family name for display/storage: the matched family's name,
   *  or the identity guess for a new family. */
  familyName: string;
  siblingVariantLabels: string[];
}

export function groupSpotting(
  identityGuess: string,
  signature: DexSignature,
  families: Family[],
): GroupingResult {
  const family = families.find((f) => familyMatches(identityGuess, f)) ?? null;
  if (!family) {
    return {
      outcome: "new-family",
      family: null,
      variant: null,
      variantLabel: proposeVariantLabel(identityGuess, signature, 1),
      familyName: identityGuess || "Unnamed robot",
      siblingVariantLabels: [],
    };
  }
  const variant =
    family.variants.find((v) => signaturesEqual(v.signature, signature)) ??
    null;
  if (variant) {
    return {
      outcome: "existing-variant",
      family,
      variant,
      variantLabel: variant.label,
      familyName: family.name,
      siblingVariantLabels: family.variants
        .filter((v) => v.label !== variant.label)
        .map((v) => v.label),
    };
  }
  return {
    outcome: "new-variant",
    family,
    variant: null,
    variantLabel: proposeVariantLabel(
      family.name,
      signature,
      family.variants.length + 1,
    ),
    familyName: family.name,
    siblingVariantLabels: family.variants.map((v) => v.label),
  };
}

/* ------------------------------------------------------------------ */
/* Local (per-browser) sightings                                       */
/* ------------------------------------------------------------------ */

export interface StoredDexSighting {
  sighting: {
    id: string;
    identity: string;
    // The photo data URL is deliberately NOT stored: a downscaled
    // photo is still far too big for localStorage quotas, and v1
    // keeps only the draft the photo produced.
    photo: null;
    spotted_at: string;
    where: string;
    dossier: unknown;
  };
  grouping: {
    outcome: GroupingOutcome;
    familyName: string;
    variantLabel: string;
  };
}

export function loadSightings(): StoredDexSighting[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(effectiveStorageKey(LOCAL_SIGHTINGS_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is StoredDexSighting =>
        Boolean(
          x &&
            typeof x === "object" &&
            (x as StoredDexSighting).sighting &&
            (x as StoredDexSighting).grouping,
        ),
    );
  } catch {
    return [];
  }
}

export function saveSighting(entry: StoredDexSighting): StoredDexSighting[] {
  const next = [...loadSightings(), entry];
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(effectiveStorageKey(LOCAL_SIGHTINGS_KEY), JSON.stringify(next));
    } catch {
      // Quota / private mode: saving is best-effort in v1; the
      // in-memory return still lets the caller confirm honestly
      // only when the write actually happened, so re-read below.
      return loadSightings();
    }
  }
  return next;
}

/** Build the stored entry for a draft + its grouping result. */
export function buildStoredSighting(
  draft: DraftLike,
  grouping: GroupingResult,
): StoredDexSighting {
  const now = new Date();
  return {
    sighting: {
      id: `local-${now.getTime()}`,
      identity: draft.identity_guess || grouping.familyName,
      photo: null,
      spotted_at: now.toISOString().slice(0, 10),
      where: "",
      dossier: draft,
    },
    grouping: {
      outcome: grouping.outcome,
      familyName: grouping.familyName,
      variantLabel: grouping.variantLabel,
    },
  };
}

/**
 * Families implied by locally saved sightings, in the same Family
 * shape as the synced dex, so groupSpotting can run over the union.
 * Sightings whose dossier is a photo draft contribute that draft's
 * signature; others contribute an all-unknown signature.
 */
export function familiesFromLocalSightings(
  saved: StoredDexSighting[],
): Family[] {
  const byFamily = new Map<string, Family>();
  for (const entry of saved) {
    const name = entry.grouping.familyName;
    let fam = byFamily.get(name);
    if (!fam) {
      fam = {
        id: `local-${normalizeTokens(name).join("-") || "unnamed"}`,
        name,
        aliases: [],
        catalog_dex_id: null,
        variants: [],
      };
      byFamily.set(name, fam);
    }
    if (!fam.variants.some((v) => v.label === entry.grouping.variantLabel)) {
      const dossier = entry.sighting.dossier as DraftLike | null;
      const signature: DexSignature =
        dossier && typeof dossier === "object"
          ? signatureFromDraft(dossier)
          : { manipulator: "unknown", top_lidar: "unknown", drivetrain: "unknown", payloads: [] };
      const sighting: DexSighting = {
        id: entry.sighting.id,
        identity: entry.sighting.identity,
        photo: null,
        spotted_at: entry.sighting.spotted_at,
        where: entry.sighting.where,
        dossier: null,
      };
      fam.variants.push({
        label: entry.grouping.variantLabel,
        signature,
        sightings: [sighting],
      });
    }
  }
  return [...byFamily.values()];
}

/** Synced families plus any local-only families/variants merged in
 *  by name — a local variant under a synced family must group as a
 *  sibling there, not as a second family with the same name. */
export function withLocalFamilies(
  synced: Family[],
  saved: StoredDexSighting[],
): Family[] {
  const merged: Family[] = synced.map((f) => ({
    ...f,
    variants: [...f.variants],
  }));
  for (const local of familiesFromLocalSightings(saved)) {
    const existing = merged.find(
      (f) => lc(f.name) === lc(local.name),
    );
    if (!existing) {
      merged.push(local);
      continue;
    }
    for (const v of local.variants) {
      if (!existing.variants.some((x) => x.label === v.label)) {
        existing.variants.push(v);
      }
    }
  }
  return merged;
}
