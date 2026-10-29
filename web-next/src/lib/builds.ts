/* Guided modification builds (Wave 3): named what-if builds saved
 * as data — a base robot, an augmented spec file, and validation
 * reports precomputed with the repo's Python engine and committed
 * as recorded data (badged RECORDED with the run date). The web app
 * never re-computes or re-badges them; it renders the reports'
 * own states. A build's mass story stays honest: the parts catalog
 * records no mass for any part, so added mass is UNKNOWN here until
 * a sourced figure exists. */

export interface BuildDef {
  robotSlug: string;
  id: string;
  name: string;
  specFile: string;
  reportSlug: string;
  recordedDate: string;
  partIds: string[];
  placement: string;
  mountNote: string;
}

export const BUILDS: BuildDef[] = [
  {
    robotSlug: "boston-dynamics-spot",
    id: "jetson-lidar",
    name: "Spot + Jetson Orin + LiDAR",
    specFile: "examples/boston-dynamics-spot-jetson-lidar.json",
    reportSlug: "boston-dynamics-spot-jetson-lidar",
    recordedDate: "2026-10-28",
    partIds: ["jetson_orin_nano", "rplidar_a1", "lidar_mount"],
    placement:
      "Placement is proposed from the spec's own geometry: the lidar " +
      "rides its mount post on the body top, where its 360° scan plane " +
      "clears the body and the folded arm, and the Jetson sits beside " +
      "it on the deck. That is what “the app figures it out” means in " +
      "v1 — placement from spec geometry plus the arithmetic below. " +
      "Load paths and vibration are not modelled anywhere in this " +
      "stack, so they are not claimed.",
    mountNote:
      "The mount is the catalog's lidar_mount — “generated per-robot " +
      "by robotforge cad”, and the CAD kit does carry a parametric " +
      "lidar mount post. Printable kits cover ground robots today, " +
      "so for this class the mount is specified against Spot's body " +
      "dimensions (1100 × 500 mm top), not yet generated as a " +
      "printable file — no printable file is promised for it here.",
  },
];

export function buildOf(robotSlug: string): BuildDef | undefined {
  return BUILDS.find((b) => b.robotSlug === robotSlug);
}
