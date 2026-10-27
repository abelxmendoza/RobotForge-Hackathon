/* Shared types + constants for the Forge port.
 *
 * The vanilla Forge (assets/js/forge.js) works over plain JSON: robot
 * specs, recorded gate reports, document transcriptions and list
 * imports are all files in the repository. These types describe
 * those shapes structurally; nothing here invents fields the data
 * does not carry. */

/* Site root relative to the app pages (/forge/, /kit/): the vanilla
 * generated pages stamp data-root on <html> for the same purpose. */
export const ROOT = '../';

export interface SpecSensor {
  kind: string;
  position: string;
  range_m?: number | null;
  [k: string]: unknown;
}

export interface WiringNode {
  id: string;
  label: string;
  deck?: boolean;
  kit?: string;
  req_label: string;
  rated_max_v?: number | null;
  [k: string]: unknown;
}

export interface WiringConnection {
  from: string;
  to: string;
  kind: string;
  volts?: number | null;
  label?: string;
  [k: string]: unknown;
}

export interface WiringBlock {
  nodes: WiringNode[];
  connections: WiringConnection[];
  note?: string;
  [k: string]: unknown;
}

export interface RobotSpec {
  name: string;
  drivetrain: string;
  length_m: number;
  width_m: number;
  height_m: number;
  mass_kg: number;
  ground_clearance_m?: number;
  description?: string;
  wheel?: {
    diameter_m: number;
    width_m: number;
    count: number;
    driven?: boolean;
  };
  motor: {
    kind: string;
    voltage_v: number;
    count: number;
    stall_torque_nm?: number | null;
  };
  battery: {
    chemistry: string;
    voltage_v: number;
    capacity_mah: number;
  };
  sensors?: SpecSensor[];
  rotors?: { count: number; prop_diameter_m: number };
  legs?: { count: number; segments?: number };
  arms?: { count: number; segments?: number };
  component_mass_kg?: Record<string, number>;
  wiring?: WiringBlock;
  [k: string]: unknown;
}

/* A possibly-partial spec (document drafts, scan seeds): every field
 * optional, rendered by the plain-words table that lists only what
 * is present. */
export type PartialSpec = Partial<RobotSpec> & Record<string, unknown>;

export interface GateCheck {
  name: string;
  commanded: number;
  measured: number;
  error: number;
  unit: string;
  verdict: string;
}

export interface GateReportDoc {
  spec: string;
  verdict: string;
  checks: GateCheck[];
  measurements?: unknown;
  [k: string]: unknown;
}

export interface GateReportRun {
  id: string;
  title: string;
  story?: string;
  doc: GateReportDoc;
  traj?: [number, number][];
  [k: string]: unknown;
}

export interface DocSheetValue {
  label: string;
  printed: string;
  field: string;
}

export interface DocSheet {
  identity_guess: string;
  input: {
    png_bytes: number;
    png_sha256: string;
    display_svg: string;
    [k: string]: unknown;
  };
  values: DocSheetValue[];
  spec: RobotSpec;
  score: {
    exact: number;
    total: number;
    rows: {
      field: string;
      printed: string;
      expected: number | null;
      got: number | null;
      match: boolean;
    }[];
  };
  findings?: string[];
  [k: string]: unknown;
}

export interface ListReportItem {
  title: string;
  slot: string;
  qty: number;
  price?: number | null;
  [k: string]: unknown;
}

export interface ListSlot {
  label: string;
  need: number;
  have: number;
  status: string;
  required?: boolean;
  [k: string]: unknown;
}

export interface ListMissing {
  label: string;
  required?: boolean;
  alternatives: { store: string; url: string }[];
  [k: string]: unknown;
}

export interface ListReport {
  items: ListReportItem[];
  assembly: {
    slots: Record<string, ListSlot>;
    warnings: string[];
    unidentified: string[];
    bench: string[];
    missing: ListMissing[];
    [k: string]: unknown;
  };
  wiring: {
    connections: { from: string; to: string; via: string; note: string }[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface PhotoDraft {
  identity_guess: string;
  visible_parts?: { kind: string; count: number; position?: string; notes?: string }[];
  spec: RobotSpec;
  [k: string]: unknown;
}

export interface DocDraft {
  identity_guess?: string;
  values?: DocSheetValue[];
  dropped?: string[];
  spec: PartialSpec;
  [k: string]: unknown;
}

export interface ListImportResult {
  items: {
    title: string;
    qty: number;
    matched_part_id?: string | null;
  }[];
  missing: string[];
  wiring: { from: string; to: string; via: string; note: string }[];
  draft_spec?: RobotSpec | null;
  [k: string]: unknown;
}

export interface LiveHealth {
  ok?: boolean;
  mode?: string;
  routes?: Record<string, boolean>;
  budget?: { exhausted?: boolean };
  [k: string]: unknown;
}

export type Badge = 'live' | 'local' | 'recorded';

export const BADGE_LABEL: Record<Badge, string> = {
  live: 'LIVE',
  local: 'LOCAL',
  recorded: 'RECORDED',
};

export function mm(m: number): number {
  return Math.round(m * 1000);
}

export async function fetchJSON<T>(path: string): Promise<T> {
  const r = await fetch(ROOT + path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return (await r.json()) as T;
}

export async function fetchText(path: string): Promise<string> {
  const r = await fetch(ROOT + path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return r.text();
}

export function downloadJSON(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
