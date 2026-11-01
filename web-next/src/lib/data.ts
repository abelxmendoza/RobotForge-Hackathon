import robotsDoc from "@/data/robots.json";
import partsDoc from "@/data/parts.json";
import familiesDoc from "@/data/families.json";
import gateDoc from "@/data/gate-reports.json";
import kitsDoc from "@/data/parts-kits.json";
import physicsDoc from "@/data/physics.json";
import harnessDoc from "@/data/harness-reports.json";
import stabilityDoc from "@/data/stability-reports.json";
import type { Family, GateReportRun, Part, PartTemplate, PhysicsEntry, Robot, RobotKit } from "./types";

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
