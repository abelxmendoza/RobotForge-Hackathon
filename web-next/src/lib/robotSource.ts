import type { Robot } from "./types";

export type RobotSource = Robot["source"];

export const ROBOT_SOURCE_ORDER: RobotSource[] = [
  "my",
  "sighted",
  "photo",
  "researched",
];

export const ROBOT_SOURCE_META: Record<
  RobotSource,
  { label: string; badge: string; description: string }
> = {
  my: {
    label: "My Robots",
    badge: "My robot",
    description: "Robots you own and keep in the Workshop.",
  },
  sighted: {
    label: "Sighted Robots",
    badge: "Sighted",
    description: "Other people’s robots you saw in person and credited.",
  },
  photo: {
    label: "From Photos",
    badge: "From photo",
    description: "Robots known from a 2D photo or video frame; dimensions stay estimated.",
  },
  researched: {
    label: "Researched",
    badge: "Researched",
    description: "Robots assembled from published specs, URDFs, datasheets, and project records.",
  },
};

/* A catalog robot whose own record says its spec is a photo draft
 * (e.g. TurtleBot3 Waffle Pi) is known from a photo, whatever the
 * catalog's source field says. This is the ONE photo-draft rule:
 * the Robodex source tabs (DexSources) and the card badge both use
 * it, so a robot can never file under From photos while its card
 * still claims Researched. */
export function isPhotoDraft(robot: Robot): boolean {
  const note = String(robot.provenance?.note ?? "");
  return /photo draft/i.test(note) || /photo draft/i.test(String(robot.description ?? ""));
}

/* The source a robot is actually presented under: the recorded
 * source, corrected by the photo-draft rule above. */
export function effectiveSource(robot: Robot): RobotSource {
  return isPhotoDraft(robot) ? "photo" : robot.source;
}

export function sourceBadge(robot: Robot): string {
  return ROBOT_SOURCE_META[effectiveSource(robot)].badge;
}
