'use client';
/* The current build list — the one list the Parts palette, the
 * chat's build commands and the BOM wizard all share. Stored in
 * this browser under rf.build.v1 (the rf.<area>.v1 pattern of
 * rf.inventory.v1 / rf.garage.v1), read and written through
 * lib/store.ts so every mounted reader stays in sync via the
 * rf-store event. The entries and all operations on them are
 * lib/palette.ts's — pure and node-tested. */
import { useStore } from "./store";
import type { BuildEntry } from "./palette";

export const BUILD_KEY = "rf.build.v1";

export function useBuildList(): [
  BuildEntry[],
  (next: BuildEntry[]) => string | null,
  boolean,
] {
  return useStore<BuildEntry[]>(BUILD_KEY, []);
}
