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

export function sourceBadge(robot: Robot): string {
  return ROBOT_SOURCE_META[robot.source].badge;
}
