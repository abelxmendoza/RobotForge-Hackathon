/* Workshop → catalogue resolution for the Simulate tab.
 *
 * A Workshop (Garage) robot is the visitor's own record; simulation
 * exists only when it maps to a Robodex catalogue robot with a
 * recorded model. The mapping is deliberately narrow and provable:
 *
 *   1. the spec's own `name` — Robodex-sourced specs carry the
 *      catalogue slug there verbatim (the demo seed's Burger spec
 *      name is "turtlebot3-burger");
 *   2. the robot's display name, slugified, with a trailing "(demo)"
 *      marker removed ("TurtleBot3 Burger (demo)" → the same slug).
 *
 * A candidate counts only if it names a real catalogue robot. There
 * is no fuzzy matching: a custom robot named "Burger-ish" must not
 * inherit the Burger's physics. */
import type { PhysicsEntry } from "./types";

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\(demo\)\s*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function resolveCatalogueSlug(
  robotName: string,
  specName: unknown,
  knownSlugs: ReadonlySet<string>,
): string | null {
  const candidates: string[] = [];
  if (typeof specName === "string" && specName.trim()) {
    candidates.push(specName.trim());
    candidates.push(slugifyName(specName));
  }
  candidates.push(slugifyName(robotName));
  for (const c of candidates) {
    if (c && knownSlugs.has(c)) return c;
  }
  return null;
}

export type SimAvailability =
  | { kind: "urdf"; entry: PhysicsEntry }
  | { kind: "no-urdf"; reason: string }
  | { kind: "not-catalogue" };

/** What the Simulate tab may honestly offer for one Workshop robot.
 *  - urdf: physics checks can run (same engine as the robot pages).
 *  - no-urdf: the catalogue records a model story but no run-able
 *    URDF — the recorded reason is shown verbatim, never paraphrased
 *    into a fake capability.
 *  - not-catalogue: no recorded model at all; simulation would be
 *    invention, so the tab says so. */
export function simAvailability(
  slug: string | null,
  entry: PhysicsEntry | undefined,
): SimAvailability {
  if (!slug) return { kind: "not-catalogue" };
  if (!entry) return { kind: "not-catalogue" };
  if (entry.status === "urdf" && entry.urdf_url) {
    return { kind: "urdf", entry };
  }
  return {
    kind: "no-urdf",
    reason:
      entry.reason ??
      "The catalogue records no run-able URDF for this robot, so the physics checks cannot run on it.",
  };
}

/** Recorded-model format label for the Gazebo panel: derived from
 *  the physics record only (URDF present / the recorded reason /
 *  nothing recorded). The bundle generator itself lives in
 *  lib/gazebo.ts, which is not part of this build — the panel says
 *  so rather than offering a download it cannot produce. */
export function gazeboState(
  slug: string | null,
  entry: PhysicsEntry | undefined,
): { available: boolean; note: string } {
  if (!slug || !entry) {
    return {
      available: false,
      note: "No recorded model for this robot, so there is nothing a Gazebo bundle could be generated from.",
    };
  }
  if (entry.status === "urdf" && entry.urdf_url) {
    return {
      available: false,
      note: "This robot's recorded model is a URDF, so a launch bundle can be generated from it — the bundle generator is not part of this build yet, and no download is offered until it is. The physics checks above run on the same recorded model, in this browser.",
    };
  }
  return {
    available: false,
    note:
      entry.reason ??
      "The recorded model is not a URDF, so no Gazebo bundle can be generated from it.",
  };
}
