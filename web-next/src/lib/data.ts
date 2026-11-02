import robotsDoc from "@/data/robots.json";
import partsDoc from "@/data/parts.json";
import familiesDoc from "@/data/families.json";
import gateDoc from "@/data/gate-reports.json";
import kitsDoc from "@/data/parts-kits.json";
import physicsDoc from "@/data/physics.json";
import stageDoc from "@/data/stage-animation.json";
import type { StageDoc } from "./stageAnimation";
import simReadyDoc from "@/data/simready-props.json";
import toolsDoc from "@/data/tools.json";
import materialsDoc from "@/data/materials.json";
import { tmItemsFromCatalog, type TmItem } from "./toolsMaterials";
import harnessDoc from "@/data/harness-reports.json";
import stabilityDoc from "@/data/stability-reports.json";
import type { Family, GateReportRun, Part, PartTemplate, PhysicsEntry, Robot, RobotKit, SimReadyPropEntry } from "./types";

export const robots = (robotsDoc as unknown as { robots: Robot[] }).robots;
export const parts = (partsDoc as unknown as { parts: Part[] }).parts;
export const partTemplates = (partsDoc as unknown as { templates: PartTemplate[] }).templates;
export const families = (familiesDoc as unknown as { families: Family[] }).families;
export const familiesSchema = (familiesDoc as unknown as { schema?: string }).schema ?? "";
export const gateReports = (gateDoc as unknown as { runs: GateReportRun[] }).runs;
export const gateNote = (gateDoc as unknown as { note?: string }).note ?? "";

export const partsKits = (kitsDoc as unknown as { kits: Record<string, RobotKit> }).kits;
export const kitOf = (slug: string): RobotKit | undefined => partsKits[slug];

export const physicsChecks = (physicsDoc as unknown as { robots: Record<string, PhysicsEntry> }).robots;
export const physicsOf = (slug: string): PhysicsEntry | undefined => physicsChecks[slug];

/* Living Build Stage source data (catalog/stage-animation.json):
 * URDF joints parsed from the pinned URDFs + recorded spec fields.
 * The capability derivation itself lives in lib/stageAnimation.ts. */
export const stageAnimation = stageDoc as unknown as StageDoc;
export const stageRecordOf = (slug: string) => stageAnimation.robots[slug];

export const simReadyProps = (simReadyDoc as unknown as { props: SimReadyPropEntry[] }).props;

/* Tools & materials (Forge Engine §11): the gathered tools and
 * materials catalogues, unified with the parts catalogue's
 * materials-class records by lib/toolsMaterials.ts — the one
 * builder every surface reads. Ownership state resolves there,
 * never in a component. */
export const toolMaterialItems: TmItem[] = tmItemsFromCatalog(toolsDoc, materialsDoc, parts);

export const harnessReports = harnessDoc as unknown as Record<string, Record<string, unknown>>;
export const stabilityReports = stabilityDoc as unknown as Record<string, Record<string, unknown>>;
export const harnessOf = (slug: string) => harnessReports[slug];
export const stabilityOf = (slug: string) => stabilityReports[slug];

export function robotSlug(r: Robot): string {
  if (r.slug) return r.slug;
  return r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
export function findRobot(slug: string): Robot | undefined {
  return robots.find((r) => robotSlug(r) === slug);
}
