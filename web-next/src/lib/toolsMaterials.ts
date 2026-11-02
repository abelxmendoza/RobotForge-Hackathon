/* Tools & materials: on hand vs simulated (Forge Engine §11).
 *
 * Every tool and material in the catalogues exists in two states:
 * - on_hand:   physically owned. Only a record may say so — the
 *              catalogue record's own `ownership` field, or the
 *              owner's flip stored under OWNERSHIP_KEY.
 * - simulated: present in the app only, with its real recorded
 *              specs. The default for everything, and the state
 *              anything unrecorded reads back as. A simulated item
 *              may be designed against freely; it never makes a
 *              real build step read as doable now.
 *
 * The state is CODE, not prose: this module is the one place that
 * resolves it, and every surface (the Workshop tab, the build
 * plan's derived profile, the chat) reads it from here.
 *
 * Pure: no DOM, no storage, no network. Records arrive as
 * parameters (the build-plan engine's pattern), so the node tests
 * run this real code against the real catalogues. */
import {
  MATERIAL_OPTIONS,
  fitsInBed,
  type ConstraintsProfile,
  type ItemDims,
} from "./buildPlan";

export type Ownership = "on_hand" | "simulated";

/* The owner's flips, per record id. Stored through lib/store.ts,
 * so demo mode reads/writes its ".demo" twin like every other
 * visitor-data store (the key is in demoMode's DEMO_DATA_KEYS). */
export const OWNERSHIP_KEY = "rf.ownership.v1";
export type OwnershipMap = Record<string, Ownership>;

export const OWNERSHIP_LABEL: Record<Ownership, string> = {
  on_hand: "On hand",
  simulated: "Simulated",
};

/* A gathered price estimate, in the catalogues' own recorded
 * shape (the same one the Parts API serves): a figure exists only
 * where a record carries one, with its basis and expiry. */
export interface TmPrice {
  amount: number;
  currency: string;
  basis?: string;
  supplierUrl?: string;
  fetchedAt?: string;
  expiresAt?: string;
  sourceKind?: string;
}

export interface TmItem {
  id: string;
  name: string;
  kind: "tool" | "material";
  /** Which catalogue the record lives in: the gathered tools /
   *  materials catalogues, or the parts catalogue (whose
   *  materials-class records — PLA, PETG — are materials too). */
  catalog: "tools" | "materials" | "parts";
  specs: Record<string, unknown>;
  /** Ownership as recorded in the catalogue itself. Absent means
   *  unrecorded, which resolves to simulated — never to owned. */
  recordOwnership?: Ownership;
  price?: TmPrice;
}

interface RawRecord {
  id?: unknown;
  name?: unknown;
  kind?: unknown;
  ownership?: unknown;
  specs?: Record<string, unknown>;
  price_estimate?: Record<string, unknown>;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function priceFrom(raw: RawRecord): TmPrice | undefined {
  const est = raw.price_estimate;
  if (!est || typeof est !== "object") return undefined;
  const amount = num(est.unit_price) ?? num(est.amount);
  if (amount === undefined) return undefined;
  return {
    amount,
    currency: str(est.currency) ?? "USD",
    basis: str(est.basis),
    supplierUrl: str(est.supplier_url),
    fetchedAt: str(est.fetched_at),
    expiresAt: str(est.expires_at),
    sourceKind: str(est.source_kind),
  };
}

function recordOwnershipOf(raw: RawRecord): Ownership | undefined {
  return raw.ownership === "on_hand" ? "on_hand"
    : raw.ownership === "simulated" ? "simulated" : undefined;
}

/* Build the unified item list from the three catalogues' parsed
 * documents. Records without a usable id/name are skipped, never
 * repaired. PLA/PETG ride in from the parts catalogue: they are
 * materials (part_class "materials") and the build plan's own
 * material names refer to them. */
export function tmItemsFromCatalog(
  toolsDoc: unknown,
  materialsDoc: unknown,
  parts: { id: string; name: string; part_class: string; specs?: Record<string, unknown> }[],
): TmItem[] {
  const out: TmItem[] = [];
  const push = (raw: RawRecord, kind: TmItem["kind"], catalog: TmItem["catalog"]) => {
    const id = str(raw.id);
    const name = str(raw.name);
    if (!id || !name) return;
    out.push({
      id, name, kind, catalog,
      specs: raw.specs ?? {},
      recordOwnership: recordOwnershipOf(raw),
      price: priceFrom(raw),
    });
  };
  const tools = (toolsDoc as { tools?: RawRecord[] } | null | undefined)?.tools ?? [];
  const materials = (materialsDoc as { materials?: RawRecord[] } | null | undefined)?.materials ?? [];
  for (const r of tools) push(r, "tool", "tools");
  for (const r of materials) push(r, "material", "materials");
  for (const p of parts) {
    if (p.part_class === "materials") {
      push({ ...p, price_estimate: (p as RawRecord).price_estimate }, "material", "parts");
    }
  }
  return out;
}

/* The one resolver: the owner's stored flip wins, then the
 * catalogue record's own field, then the default — simulated. */
export function ownershipOf(item: TmItem, overrides: OwnershipMap): Ownership {
  const flip = overrides[item.id];
  if (flip === "on_hand" || flip === "simulated") return flip;
  return item.recordOwnership ?? "simulated";
}

export interface OwnedItem extends TmItem { ownership: Ownership }
export function withOwnership(items: TmItem[], overrides: OwnershipMap): OwnedItem[] {
  return items.map((i) => ({ ...i, ownership: ownershipOf(i, overrides) }));
}

/* A price with its freshness judged against `now` (an ISO string
 * or Date the caller supplies — this module never reads a clock).
 * An estimate past its recorded expiry is reported expired, never
 * quietly refreshed. */
export function priceState(item: TmItem, now: string | Date): { price: TmPrice; expired: boolean } | null {
  if (!item.price) return null;
  const t = now instanceof Date ? now.getTime() : Date.parse(now);
  const exp = item.price.expiresAt ? Date.parse(item.price.expiresAt) : NaN;
  return { price: item.price, expired: Number.isFinite(exp) && Number.isFinite(t) && t > exp };
}

/* The build-plan material family a material record belongs to
 * ("TPU 95A filament…" → "TPU", "PLA filament…" → "PLA"), matched
 * against the plan's own MATERIAL_OPTIONS. Null when the record
 * names no family the plan knows — the record then feeds no
 * profile derivation. */
export function materialFamily(item: TmItem): string | null {
  if (item.kind !== "material") return null;
  const name = item.name.toUpperCase();
  for (const f of MATERIAL_OPTIONS) {
    if (name.startsWith(f)) return f;
  }
  return null;
}

/* A printer, for plan purposes: a tool whose recorded specs carry
 * a build volume. The volume is a constraint input — it only
 * counts when the record records it. */
export function isPrinter(item: TmItem): boolean {
  return item.kind === "tool"
    && num(item.specs.build_volume_x_mm) !== undefined
    && num(item.specs.build_volume_y_mm) !== undefined
    && num(item.specs.build_volume_z_mm) !== undefined;
}
export function printerBed(item: TmItem): [number, number, number] | null {
  if (!isPrinter(item)) return null;
  return [
    num(item.specs.build_volume_x_mm)!,
    num(item.specs.build_volume_y_mm)!,
    num(item.specs.build_volume_z_mm)!,
  ];
}

/* The derived constraints profile — the ONE source of truth the
 * build plan checks against (Forge Engine §11, plan Phase 1):
 *
 * The stored profile stays the record for the generic bench tools
 * (its checkboxes are the owner's own record) and for anything no
 * catalogue item covers. The catalogue ownership state then
 * derives, deterministically:
 * - an ON-HAND catalogue printer puts "3d_printer" in toolsOnHand
 *   and its recorded build volume becomes the bed the print-fit
 *   check runs against — it is the printer actually on hand.
 * - an ON-HAND catalogue material adds its family (TPU, PLA…) to
 *   materialsOnHand.
 * A SIMULATED item derives NOTHING: designing against it is free,
 * but it never enters the profile the real checks read. Prices and
 * every other profile field pass through untouched. */
export function deriveProfile(
  profile: ConstraintsProfile,
  items: TmItem[],
  overrides: OwnershipMap,
): ConstraintsProfile {
  const owned = withOwnership(items, overrides).filter((i) => i.ownership === "on_hand");
  const toolsOnHand = [...profile.toolsOnHand];
  const materialsOnHand = [...profile.materialsOnHand];
  let bed: [number, number, number] | null = null;
  for (const item of owned) {
    if (isPrinter(item)) {
      if (!toolsOnHand.includes("3d_printer")) toolsOnHand.push("3d_printer");
      bed = bed ?? printerBed(item);
    }
    const fam = materialFamily(item);
    if (fam && !materialsOnHand.includes(fam)) materialsOnHand.push(fam);
  }
  return {
    ...profile,
    toolsOnHand,
    materialsOnHand,
    ...(bed ? { bedXmm: bed[0], bedYmm: bed[1], bedZmm: bed[2] } : {}),
  };
}

/* Print-fit of recorded kit-part dimensions against one printer's
 * recorded build volume — the design check §11 names. It runs the
 * same fitsInBed the build plan uses (recorded print-note
 * orientations honored), and it abstains per part: a part with no
 * recorded dimensions is counted as not checked, never as fitting.
 * Whether the printer is on hand or simulated is the CALLER's
 * label to state — the check itself is identical, which is the
 * point: simulated gear is for designing against. */
export interface PrinterFit {
  fits: string[];
  tooBig: string[];
  notChecked: string[];
}
export function printerFit(
  printer: TmItem,
  dims: { name: string; dims?: ItemDims }[],
): PrinterFit | null {
  const bed = printerBed(printer);
  if (!bed) return null;
  const out: PrinterFit = { fits: [], tooBig: [], notChecked: [] };
  for (const d of dims) {
    if (!d.dims) { out.notChecked.push(d.name); continue; }
    (fitsInBed(d.dims, bed) ? out.fits : out.tooBig).push(d.name);
  }
  return out;
}

/* The headline specs a card shows, from recorded values only —
 * a spec the record doesn't carry is omitted, never filled in. */
export function keySpecs(item: TmItem): { label: string; value: string }[] {
  const s = item.specs;
  const out: { label: string; value: string }[] = [];
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  const bed = printerBed(item);
  if (bed) out.push({ label: "Build volume", value: `${fmt(bed[0])} × ${fmt(bed[1])} × ${fmt(bed[2])} mm` });
  const supported = s.supported_materials;
  if (Array.isArray(supported) && supported.length) {
    out.push({ label: "Prints", value: supported.filter((x) => typeof x === "string").join(", ") });
  }
  const density = num(s.density_g_cm3);
  if (density !== undefined) out.push({ label: "Density", value: `${fmt(density)} g/cm³` });
  const dia = num(s.filament_diameter_mm);
  if (dia !== undefined) out.push({ label: "Filament", value: `${fmt(dia)} mm` });
  const spool = num(s.spool_weight_g);
  if (spool !== undefined) out.push({ label: "Spool", value: `${fmt(spool)} g` });
  const nozzleMin = num(s.nozzle_temp_c_min), nozzleMax = num(s.nozzle_temp_c_max);
  if (nozzleMin !== undefined && nozzleMax !== undefined) {
    out.push({ label: "Nozzle", value: `${fmt(nozzleMin)}–${fmt(nozzleMax)} °C` });
  } else if (typeof s.print_temp_c === "string" && s.print_temp_c) {
    out.push({ label: "Nozzle", value: `${s.print_temp_c} °C (recorded range)` });
  }
  const bedMin = num(s.bed_temp_c_min), bedMax = num(s.bed_temp_c_max);
  if (bedMin !== undefined && bedMax !== undefined) {
    out.push({ label: "Bed", value: `${fmt(bedMin)}–${fmt(bedMax)} °C` });
  }
  return out;
}
