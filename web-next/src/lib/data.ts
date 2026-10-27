import robotsDoc from "@/data/robots.json";
import partsDoc from "@/data/parts.json";
import gateDoc from "@/data/gate-reports.json";
import harnessDoc from "@/data/harness-reports.json";
import stabilityDoc from "@/data/stability-reports.json";
import type { GateReportRun, Part, Robot } from "./types";

export const robots = (robotsDoc as unknown as { robots: Robot[] }).robots;
export const parts = (partsDoc as unknown as { parts: Part[] }).parts;
export const gateReports = (gateDoc as unknown as { runs: GateReportRun[] }).runs;
export const gateNote = (gateDoc as unknown as { note?: string }).note ?? "";

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
