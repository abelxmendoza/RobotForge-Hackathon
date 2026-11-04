/* Wrench chat recategorization (Abel, 2026-11-03): the Robodex
 * files every robot automatically — garage robots under My
 * robots, a sighting with a place under Sighted, a sighting or
 * photo-draft catalog robot under From photos, the rest of the
 * catalog under Researched. When the automatic filing is wrong,
 * the owner corrects it in chat:
 *
 *   move "Spot" to sighted
 *   put "Andino" under from photos
 *   move "Omega1" to my robots
 *   recategorize "TurtleBot3 Waffle Pi" as researched
 *   file "Omega1" under sighted
 *   reset categorization for "Spot"
 *
 * The correction is stored as an override (lib/dexOverrides.ts)
 * and every filing decision consults overrides FIRST. Moving TO
 * "my robots" means bringing the robot into the Workshop (the
 * same save-to-Garage flow the Robodex cards use); moving a
 * Workshop robot OUT of "my robots" changes only its Robodex
 * filing — the Workshop entry itself is never deleted by this.
 *
 * Pure functions only: parse -> resolve -> plan -> apply, the
 * same shape as lib/saveRobot.ts and lib/inventory.ts. ChatDock
 * owns the stores and the preview card. */
import type { GarageRobot, Spec } from "./garage";
import type { Robot } from "./types";
import {
  dexKey,
  garageKey,
  sightingKey,
  type DexOverrides,
  type DexTab,
} from "./dexOverrides";

export interface DexEntity {
  /* Stable override identity (lib/dexOverrides key). */
  key: string;
  kind: "catalog" | "sighting" | "garage";
  /* The name the owner would say, and the name chat shows. */
  name: string;
  /* What it is filed under right now (override included). */
  currentTab: DexTab;
  /* The tab the automatic rules would pick, with no override. */
  autoTab: DexTab;
  /* Catalog robots: the recorded spec file, for bring-in. */
  specFile?: string | null;
  /* Sightings: the draft spec the dossier recorded, if any. */
  draftSpec?: Spec | null;
  /* Garage robots: the entry id, for bring-in duplicate checks. */
  garageId?: string;
}

export interface ParsedDexMove {
  name: string;
  /* null = reset: drop the override, automatic rules decide. */
  dest: DexTab | null;
}

const DEST_WORDS: [RegExp, DexTab][] = [
  [/^(?:my robots|mine|my|workshop)$/i, "mine"],
  [/^(?:sighted|sightings|seen in person)$/i, "sighted"],
  [/^(?:from photos|photos|photo|pictures)$/i, "photos"],
  [/^(?:researched|research|catalog|catalogue)$/i, "researched"],
];

export function parseDexDestination(raw: string): DexTab | null {
  const clean = raw.trim().replace(/[.!]+$/, "");
  for (const [re, tab] of DEST_WORDS) if (re.test(clean)) return tab;
  return null;
}

/* The grammar. Deliberately narrow: a filing verb, a quoted name
 * (or a bare name up to the destination marker), and a REQUIRED
 * destination word — so assembly phrases like "move the arm on
 * Spot to 0 0 70" (numeric destination) never match, and build
 * phrases like "build a robot" never reach the verb list. */
export function parseDexMove(text: string): ParsedDexMove | null {
  const t = text.trim();
  const reset = t.match(
    /^(?:reset|clear|remove|undo)\s+(?:the\s+)?(?:categorization|categorisation|filing|category)\s+(?:for|of|on)\s+["“]([^"”]+)["”]\s*[.!]?$/i,
  ) ?? t.match(
    /^(?:reset|clear)\s+["“]([^"”]+)["”](?:'s)?\s+(?:categorization|categorisation|filing|category)\s*[.!]?$/i,
  );
  if (reset) return { name: reset[1].trim(), dest: null };

  const move = t.match(
    /^(?:move|put|file|recategorize|recategorise|categorize|categorise|reclassify|shift)\s+(?:the\s+)?["“]([^"”]+)["”]\s+(?:to|under|into|as|in)\s+(.+?)\s*[.!]?$/i,
  ) ?? t.match(
    /^(?:move|put|file|recategorize|recategorise|categorize|categorise|reclassify|shift)\s+(?:the\s+)?(.+?)\s+(?:to|under|into|as|in)\s+(my robots|mine|my|sighted|sightings|seen in person|from photos|photos|photo|pictures|researched|research|catalog|catalogue|workshop)\s*[.!]?$/i,
  );
  if (!move) return null;
  const dest = parseDexDestination(move[2]);
  if (!dest) return null;
  return { name: move[1].trim(), dest };
}

/* Name matching, in Wrench's usual order: exact, then unique
 * prefix, then unique substring — across every addressable robot:
 * the catalog, the dex sightings, and the Workshop. Case- and
 * punctuation-insensitive. Returns every candidate when the name
 * is ambiguous so the preview can ask instead of guessing. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeDexName(s: string): string {
  return norm(s);
}

export function resolveDexEntity(name: string, entities: DexEntity[]): DexEntity[] {
  const n = norm(name);
  if (!n) return [];
  const exact = entities.filter((e) => norm(e.name) === n);
  if (exact.length) return exact;
  const prefix = entities.filter((e) => norm(e.name).startsWith(n));
  if (prefix.length) return prefix;
  return entities.filter((e) => norm(e.name).includes(n));
}

export const DEX_TAB_LABEL: Record<DexTab, string> = {
  mine: "My robots",
  sighted: "Sighted",
  photos: "From photos",
  researched: "Researched",
};

export interface DexMovePlan {
  entity: DexEntity;
  dest: DexTab | null;
  /* What Apply will actually do, in plain words for the preview. */
  summary: string;
  /* Moving to My robots needs a Workshop entry: true when one
   * must be created from the recorded spec. */
  bringIn: boolean;
  /* Set when the move cannot be done honestly (no recorded spec
   * to bring into the Workshop). The preview shows this instead
   * of an Apply button that would invent data. */
  blocked: string | null;
}

export function planDexMove(entity: DexEntity, dest: DexTab | null): DexMovePlan {
  const from = DEX_TAB_LABEL[entity.currentTab];
  if (dest === null) {
    return {
      entity, dest, bringIn: false, blocked: null,
      summary: entity.currentTab === entity.autoTab
        ? `${entity.name} is already filed by the automatic rules under ${from} — no override to clear.`
        : `Clear the filing override for ${entity.name}: it returns to ${DEX_TAB_LABEL[entity.autoTab]}, where the automatic rules put it.`,
    };
  }
  if (dest === entity.currentTab) {
    return {
      entity, dest, bringIn: false, blocked: null,
      summary: `${entity.name} is already under ${DEX_TAB_LABEL[dest]} — nothing to change.`,
    };
  }
  if (dest === "mine") {
    if (entity.kind === "garage") {
      return {
        entity, dest, bringIn: false, blocked: null,
        summary: `File ${entity.name} under My robots in the Robodex. It is already in your Workshop — nothing new is saved.`,
      };
    }
    const hasSpec = entity.kind === "catalog" ? !!entity.specFile : !!entity.draftSpec;
    if (!hasSpec) {
      return {
        entity, dest, bringIn: false,
        blocked: `${entity.name} has no recorded spec, so there is nothing honest to bring into the Workshop. Import a photo or a spec for it in the Workshop first, then file it under My robots.`,
        summary: `Move ${entity.name} to My robots — blocked: no recorded spec.`,
      };
    }
    return {
      entity, dest, bringIn: true, blocked: null,
      summary: `Bring ${entity.name} into your Workshop from its recorded spec, and file it under My robots in the Robodex. It will show in the Workshop and under My robots, like your other robots.`,
    };
  }
  if (entity.kind === "garage") {
    return {
      entity, dest, bringIn: false, blocked: null,
      summary: `File ${entity.name} under ${DEX_TAB_LABEL[dest]} in the Robodex. It stays in your Workshop — only its Robodex filing changes, nothing is deleted.`,
    };
  }
  return {
    entity, dest, bringIn: false, blocked: null,
    summary: `File ${entity.name} under ${DEX_TAB_LABEL[dest]} in the Robodex (it is under ${from} now). Its record does not change — only where the Robodex shows it.`,
  };
}

/* Apply, pure: the next overrides record. Reset deletes the key;
 * a move to the tab the automatic rules already pick also deletes
 * it (no redundant override to go stale). */
export function applyDexMove(overrides: DexOverrides, plan: DexMovePlan): DexOverrides {
  const next = { ...overrides };
  if (plan.dest === null || plan.dest === plan.entity.autoTab) {
    delete next[plan.entity.key];
  } else {
    next[plan.entity.key] = plan.dest;
  }
  return next;
}

/* Build the addressable entity list from the live stores + the
 * resolved filings (DexSources' rules, mirrored here so chat and
 * the page can never disagree): overrides first, then garage
 * membership / a sighting's place / the photo-draft rule. */
export interface DexSightingLike {
  id: string;
  identity: string;
  where: string | null;
  draftSpec: Spec | null;
}

export function buildDexEntities(input: {
  catalog: Robot[];
  isPhotoDraft: (r: Robot) => boolean;
  sightings: DexSightingLike[];
  garage: GarageRobot[];
  overrides: DexOverrides;
}): DexEntity[] {
  const out: DexEntity[] = [];
  for (const r of input.garage) {
    const key = garageKey(r.id);
    out.push({
      key, kind: "garage", name: r.name, garageId: r.id,
      autoTab: "mine", currentTab: input.overrides[key] ?? "mine",
    });
  }
  for (const s of input.sightings) {
    const key = sightingKey(s.id);
    const auto: DexTab = s.where ? "sighted" : "photos";
    out.push({
      key, kind: "sighting", name: s.identity, draftSpec: s.draftSpec,
      autoTab: auto, currentTab: input.overrides[key] ?? auto,
    });
  }
  for (const r of input.catalog) {
    const key = dexKey(r);
    const auto: DexTab = input.isPhotoDraft(r) ? "photos" : "researched";
    out.push({
      key, kind: "catalog", name: r.name, specFile: r.spec_file ?? null,
      autoTab: auto, currentTab: input.overrides[key] ?? auto,
    });
  }
  return out;
}
