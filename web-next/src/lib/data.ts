import robotsDoc from "@/data/robots.json";
import partsDoc from "@/data/parts.json";
import familiesDoc from "@/data/families.json";
import gateDoc from "@/data/gate-reports.json";
import harnessDoc from "@/data/harness-reports.json";
import stabilityDoc from "@/data/stability-reports.json";
import sourcesDoc from "@/data/sources.json";
import type { Family, GateReportRun, Part, Robot, SourceRecord } from "./types";

export const robots = (robotsDoc as unknown as { robots: Robot[] }).robots;
export const parts = (partsDoc as unknown as { parts: Part[] }).parts;
export const families = (familiesDoc as unknown as { families: Family[] }).families;
export const familiesSchema = (familiesDoc as unknown as { schema?: string }).schema ?? "";
export const gateReports = (gateDoc as unknown as { runs: GateReportRun[] }).runs;
export const gateNote = (gateDoc as unknown as { note?: string }).note ?? "";

export const harnessReports = harnessDoc as unknown as Record<string, Record<string, unknown>>;
export const stabilityReports = stabilityDoc as unknown as Record<string, Record<string, unknown>>;
export const harnessOf = (slug: string) => harnessReports[slug];
export const stabilityOf = (slug: string) => stabilityReports[slug];

/* Per-robot web-source records (catalog/sources/<slug>.json, schema
 * robotforge-sources/1): what the retrieval pass verified about where
 * a robot's models and interface data live. Filed as data by an
 * operator-side retrieval; the app displays the record, it does not
 * fetch pages live, and a source is never auto-merged into a spec. */
export const sourcesRecords = sourcesDoc as unknown as Record<string, SourceRecord>;
export const sourcesOf = (slug: string): SourceRecord | undefined => sourcesRecords[slug];

export function robotSlug(r: Robot): string {
  if (r.slug) return r.slug;
  return r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
export function findRobot(slug: string): Robot | undefined {
  return robots.find((r) => robotSlug(r) === slug);
}
