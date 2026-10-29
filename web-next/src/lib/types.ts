// Shapes of the repo catalog data (catalog/*.json). Nested detail
// blobs keep index signatures — the JSON is the source of truth and
// the vanilla generator treats the same fields loosely.
export interface GateRunSummary {
  drive_error_pct?: number;
  heading_error_deg?: number;
  [key: string]: unknown;
}
export interface Robot {
  number: string | number;
  name: string;
  slug?: string;
  class: string;
  subtype?: string;
  mobility_class?: string;
  description: string;
  image_url?: string;
  image_credit?: string;
  spec_file?: string;
  key_specs?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  gate_status?: { status: string; runs?: GateRunSummary[] } | string;
  [key: string]: unknown;
}
export interface Part {
  id: string;
  name: string;
  part_class: string;
  blurb?: string;
  used_for?: string;
  image?: string;
  specs?: Record<string, unknown>;
  robot_types?: string[];
  notes?: string;
  source?: string;
  license?: string;
  [key: string]: unknown;
}
export interface GateReportRun {
  id: string;
  title: string;
  story?: string;
  doc?: Record<string, unknown>;
  traj?: unknown;
  [key: string]: unknown;
}
/* Robodex families (catalog/families.json, schema
 * robotforge-robodex-families/1): robots grouped by family, with
 * configuration variants told apart by a signature and individual
 * sightings filed under the variant they match. */
export interface DexSignature {
  manipulator: string;
  top_lidar: string;
  drivetrain: string;
  payloads: string[];
  [key: string]: unknown;
}
export interface DexSighting {
  id: string;
  identity: string;
  photo: string | null;
  sha256?: string | null;
  spotted_at?: string | null;
  where?: string | null;
  by?: string | null;
  /* The canonical families.json embeds the full Spotter dossier
   * object here; a plain path string is also accepted. */
  dossier?: string | Record<string, unknown> | null;
  [key: string]: unknown;
}
export interface DexVariant {
  label: string;
  signature: DexSignature;
  sightings: DexSighting[];
  [key: string]: unknown;
}
export interface Family {
  id: string;
  name: string;
  aliases: string[];
  catalog_dex_id: string | null;
  credit?: string;
  variants: DexVariant[];
  [key: string]: unknown;
}
