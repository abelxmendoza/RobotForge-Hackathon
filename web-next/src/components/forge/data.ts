/* Data adapter over "@/lib/data".
 *
 * The vanilla site fetches catalog/robots.json, catalog/parts.json
 * and catalog/gate-reports.json as documents; the lib exports the
 * same catalogues (per the port contract: robots, parts,
 * gateReports). This adapter normalises either shape — a bare array
 * or the JSON document wrapper — into the arrays the Forge and the
 * Forge Guide consume, so the components never care which the sync
 * script produced. */
import {
  robots as robotsData,
  parts as partsData,
  gateReports as gateReportsData,
} from '@/lib/data';
import partsDoc from '@/data/parts.json';
import kindsDoc from '@/data/kinds.json';
import chatIntentsDoc from '@/data/chat-intents.json';
import type { GateReportRun } from './model';

export interface DexRobot {
  number: number;
  name: string;
  class: string;
  description: string;
  gate_status?: {
    status?: string;
    runs?: {
      drive_error_pct?: number | null;
      heading_error_deg?: number | null;
      odometry_distance_error_pct?: number | null;
      odometry_heading_error_deg?: number | null;
    }[];
    note?: string;
  };
  key_specs?: Record<string, string>;
  provenance?: {
    source_name?: string;
    source_url?: string;
    license?: string;
    note?: string;
  };
  spec_file?: string;
  checks?: {
    type: string;
    grade: string;
    tip_angle_deg: number;
    weakest_margin_mm: number;
    weakest_direction: string;
    date: string;
  }[];
  [k: string]: unknown;
}

export interface CatalogPart {
  id: string;
  name: string;
  part_class: string;
  blurb?: string;
  used_for?: string;
  source?: string;
  license?: string;
  notes?: string;
  robot_types?: string[];
  specs?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface BomTemplate {
  name: string;
  label: string;
  gate_pack?: string;
  required?: Record<string, number>;
  optional?: string[];
  [k: string]: unknown;
}

export interface StarterKind {
  id: string;
  label: string;
  one_liner: string;
  gate_pack: string;
  gate_note?: string;
  reference: string;
  bom_hints?: string[];
  params?: { label: string; default: string | number; unit?: string }[];
  [k: string]: unknown;
}

function asArray<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const inner = (data as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner as T[];
  }
  return [];
}

export const robots: DexRobot[] = asArray<DexRobot>(robotsData, 'robots');
export const parts: CatalogPart[] = asArray<CatalogPart>(partsData, 'parts');
/* "@/lib/data" exports the parts array only; the BOM templates live
 * in the parts document, so they are read from the bundled JSON the
 * sync script maintains (src/data/parts.json). */
export const templates: BomTemplate[] = asArray<BomTemplate>(
  partsDoc,
  'templates',
);
export const gateReportRuns: GateReportRun[] = asArray<GateReportRun>(
  gateReportsData,
  'runs',
);
export const gateReportsDoc: { runs: GateReportRun[] } = {
  runs: gateReportRuns,
};
/* Starter kinds + chat intents: bundled by the same sync script
 * (src/data/kinds.json, src/data/chat-intents.json) — the data the
 * vanilla Guide fetched at runtime from catalog/kinds.json and
 * assets/js/chat-intents.json. */
export const kinds: StarterKind[] = asArray<StarterKind>(kindsDoc, 'kinds');
export const chatIntents: unknown = chatIntentsDoc;
