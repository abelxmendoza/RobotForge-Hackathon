/* Robodex filing overrides (Abel, 2026-11-03): where each robot
 * GOES in the Robodex — My robots / Sighted / From photos /
 * Researched — is decided automatically (garage membership, a
 * sighting's recorded place, the photo-draft rule, the catalog's
 * recorded source). Automatic rules miscategorize sometimes, so
 * the owner can correct the filing through Wrench chat
 * (lib/dexCategorize.ts). Corrections live here, keyed by a
 * stable identity, and every filing decision consults this store
 * FIRST, the automatic rules second.
 *
 * Identities:
 *   dex:<catalog number>   a catalog robot (catalog/robots.json)
 *   sighting:<sighting id> a dex sighting (catalog families or
 *                          browser-saved; browser ids carry the
 *                          "local-" prefix DexSources gives them)
 *   garage:<garage id>     a Workshop robot (rf.garage.v1)
 *
 * The store is a visitor-data key: it is registered in
 * lib/demoMode.ts DEMO_DATA_KEYS, so filing edits made in demo
 * mode stay inside the demo sandbox like every other demo edit. */
import { readStore, writeStore } from "./store";
import type { RobotSource } from "./robotSource";

export const DEX_OVERRIDES_KEY = "rf.dex.overrides.v1";

/* The Robodex tabs' own vocabulary (DexSources' DexSource). */
export type DexTab = "mine" | "sighted" | "photos" | "researched";

export const DEX_TABS: DexTab[] = ["mine", "sighted", "photos", "researched"];

/* key -> the tab the owner filed it under */
export type DexOverrides = Record<string, DexTab>;

export function dexKey(identity: { number: string | number }): string {
  return "dex:" + String(identity.number);
}

export function sightingKey(id: string): string {
  return "sighting:" + id;
}

export function garageKey(id: string): string {
  return "garage:" + id;
}

export function loadDexOverrides(): DexOverrides {
  const raw = readStore<Record<string, unknown>>(DEX_OVERRIDES_KEY, {});
  const out: DexOverrides = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (v === "mine" || v === "sighted" || v === "photos" || v === "researched") {
      out[k] = v;
    }
  }
  return out;
}

export function saveDexOverrides(next: DexOverrides): string | null {
  return writeStore(DEX_OVERRIDES_KEY, next);
}

/* The two vocabularies for "where a robot is known from": the
 * Robodex tabs (mine/photos) and Robot["source"] (my/photo).
 * One conversion, used by the card badge and the tabs alike, so
 * they can never disagree about an override. */
export function dexTabToRobotSource(tab: DexTab): RobotSource {
  if (tab === "mine") return "my";
  if (tab === "photos") return "photo";
  return tab;
}

export function robotSourceToDexTab(source: RobotSource): DexTab {
  if (source === "my") return "mine";
  if (source === "photo") return "photos";
  return source;
}
