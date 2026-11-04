/* One upgrade proposal: "Wrench, add a Raspberry Pi 5 to this rover".
 *
 * Wrench answers an "add X" ask with ONE proposal that makes the whole
 * upgrade work, not just a part in a list:
 *   1. the exact component, and the specs its records do not give;
 *   2. power: the robot's battery against the part's documented
 *      supply, and a converter when a documented rating supports one;
 *   3. wiring rows with named connectors and pins;
 *   4. a mount (and open-frame enclosure) with dimensions and the
 *      assumptions behind them, as an OpenSCAD file;
 *   5. what was checked, and what still needs a person to review.
 * The owner approves it once and it is saved as ONE robot version
 * (applyUpgrade), then the saved version is checked again
 * (recheckUpgrade).
 *
 * Power and wiring are built before the mount on purpose: a printable
 * bracket around an electrically incompatible design is wasted plastic.
 *
 * Honesty rules, same as the rest of RobotForge:
 *   - Every rating used here is quoted from a record named in `source`
 *     (the part's maker documentation or catalog/parts.json). Where a
 *     record is silent the check is NOT_CHECKED, never PASS.
 *   - Battery voltage ranges are TYPICAL for the chemistry, not the
 *     pack's datasheet, and say so.
 *   - Mount geometry is PLANNED: built from the part's published hole
 *     pattern plus stated margins, not measured on the robot.
 *
 * Pure: imports only the component table (no DOM, no storage), so a
 * node test runs it against the real data. */
import { COMPONENTS, type ComponentDefinition } from './components';
import type { GarageRobot, Spec } from './garage';

export type Verdict = 'PASS' | 'WARN' | 'ERROR' | 'NOT_CHECKED';

export interface UpgradeCheck { id: string; label: string; verdict: Verdict; detail: string }

/* What the part needs from the robot's power system, from its maker's
 * documentation. Only parts listed here get a power plan. */
export interface LoadRating {
  volts: number;
  amps: number;
  inputConnector: string;
  /** Header pins that can also take the supply, when documented. */
  altSupplyPins?: string;
  notes: string[];
  source: string;
}

export const LOAD_RATINGS: Record<string, LoadRating> = {
  'raspberry-pi-4b-sbc': {
    volts: 5.1,
    amps: 3,
    inputConnector: 'USB-C power port',
    altSupplyPins: '5 V on pins 2 and 4, GND on pin 6 of the 40-pin header',
    notes: [
      'Raspberry Pi recommends a 5 V / 3 A supply for the Pi 4B; the official supply is 5.1 V / 3 A, the extra 0.1 V covering cable drop.',
      'The Pi 4B USB-C input has no USB-PD negotiation: it is a plain 5 V input, so the feed must already be a regulated 5 V at up to 3 A.',
    ],
    source: 'https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#power-supply',
  },
  'raspberry-pi-5-sbc': {
    volts: 5.1,
    amps: 5,
    inputConnector: 'USB-C power port',
    altSupplyPins: '5 V on pins 2 and 4, GND on pin 6 of the 40-pin header',
    notes: [
      'Raspberry Pi recommends a 5.1 V / 5 A supply for the Pi 5. The extra 0.1 V covers cable drop.',
      'A supply that does not tell the Pi it can give 5 A over USB-C PD makes the Pi limit its USB ports to 600 mA, unless usb_max_current_enable=1 is set in config.txt.',
    ],
    source: 'https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#power-supply',
  },
};

/* Converters with recorded ratings. Values are copied from
 * catalog/parts.json (a test pins them to it). Only fields the record
 * holds are filled; inputMinV is absent because the record has none. */
export interface ConverterRating {
  catalogId: string;
  componentId: string;
  name: string;
  topology: 'buck';
  inputMaxV: number;
  inputMinV?: number;
  outputV: number;
  outputA: number;
  source: string;
}

export const CONVERTERS: ConverterRating[] = [
  {
    catalogId: 'buck_converter_5v',
    componentId: 'converter-envelope',
    name: 'Buck converter 5 V / 5 A',
    topology: 'buck',
    inputMaxV: 24,
    outputV: 5.0,
    outputA: 5,
    source: 'catalog/parts.json · buck_converter_5v (generic synchronous buck module)',
  },
];

/* Typical per-cell voltages by chemistry: empty, nominal, full. */
const CELL: Record<string, [number, number, number]> = {
  lipo: [3.0, 3.7, 4.2],
  liion: [3.0, 3.6, 4.2],
  lifepo4: [2.5, 3.2, 3.65],
  nimh: [1.0, 1.2, 1.45],
  lead_acid: [1.75, 2.0, 2.4],
};

export interface BatteryRange {
  chemistry: string;
  nominalV: number;
  cells: number | null;
  minV: number | null;
  maxV: number | null;
  capacityMah: number | null;
  /** Says where the range came from. */
  basis: string;
}

export function batteryRange(spec: Spec): BatteryRange | null {
  const b = spec?.battery;
  const nominal = Number(b?.voltage_v);
  if (!b || !Number.isFinite(nominal) || nominal <= 0) return null;
  const chem = String(b.chemistry ?? '').toLowerCase();
  const cap = Number(b.capacity_mah);
  const capacityMah = Number.isFinite(cap) && cap > 0 ? cap : null;
  const cell = CELL[chem];
  if (!cell) {
    return { chemistry: chem || 'unknown', nominalV: nominal, cells: null, minV: null, maxV: null, capacityMah,
      basis: `the chemistry (${chem || 'not recorded'}) has no typical range here, so only the ${nominal} V nominal is known` };
  }
  const cells = Math.max(1, Math.round(nominal / cell[1]));
  const r = (v: number) => Math.round(v * 100) / 100;
  return { chemistry: chem, nominalV: nominal, cells, minV: r(cells * cell[0]), maxV: r(cells * cell[2]), capacityMah,
    basis: `typical ${chem} range for ${cells} cell${cells === 1 ? '' : 's'} in series (${cell[0]}–${cell[2]} V per cell), not this pack's datasheet` };
}

/* ---------------- the ask ---------------- */

const ADD_VERB = /^(?:wrench[,:]?\s+)?(?:please\s+)?(?:can you\s+|could you\s+|let'?s\s+|i want to\s+|i'd like to\s+)?(?:add|install|fit|put|mount|upgrade (?:it |this )?with)\s+/i;

/* "add a Raspberry Pi 5 to this rover" → the component id. Only fires
 * on an explicit add verb and a component the table knows by an alias;
 * questions ("can I add…?") and unknown parts return null. */
export function parseUpgradeAsk(text: string): { componentId: string } | null {
  const q = text.trim();
  if (!q || q.endsWith('?') || !ADD_VERB.test(q)) return null;
  const rest = q.replace(ADD_VERB, '').replace(/\b(?:to|on|onto|in|into)\s+(?:this|my|the)?\s*[\w\s-]*$/i, '').toLowerCase();
  let best: { id: string; len: number } | null = null;
  for (const c of COMPONENTS) {
    for (const alias of [c.name.toLowerCase(), ...c.aliases]) {
      const a = alias.toLowerCase();
      const re = new RegExp('(^|[^a-z0-9])' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])');
      if (re.test(rest) && (!best || a.length > best.len)) best = { id: c.id, len: a.length };
    }
  }
  // "raspberry pi" alone is ambiguous between models (the table now
  // holds both the Pi 5 and the Pi 4B): a bare "raspberry pi" is not
  // taken as either board — the ask must name the model.
  if (best && best.id === 'raspberry-pi-5-sbc' && !/\b(?:pi\s*5|rpi\s*5|raspberry pi 5)\b/.test(rest)) return null;
  if (best && best.id === 'raspberry-pi-4b-sbc' && !/\b(?:pi\s*4b?|rpi\s*4b?|raspberry pi 4b?)\b/.test(rest)) return null;
  return best ? { componentId: best.id } : null;
}

/* ---------------- the proposal ---------------- */

export interface WiringRow { from: string; to: string; detail: string; kind: 'power' | 'data'; volts: number | null; ratedMaxV: number | null }

export interface MountPlan {
  plateMm: [number, number, number];
  partHoles: { pattern: string; diameterMm: number; positionsMm: [number, number][] };
  deckHoles: { diameterMm: number; positionsMm: [number, number][] };
  standoffMm: number;
  enclosureInnerMm: [number, number, number];
  openSide: string;
  assumptions: string[];
  filename: string;
  scad: string;
}

export interface UpgradeProposal {
  robotId: string;
  robotName: string;
  expectedVersionId: string;
  component: { id: string; name: string; source: string; note: string; missing: string[]; massKg: number; sizeMm: [number, number, number] };
  battery: BatteryRange | null;
  load: LoadRating | null;
  converter: ConverterRating | null;
  /** Compute boards already in the robot's wiring that this part may replace. */
  replaces: string | null;
  wiring: WiringRow[];
  mount: MountPlan;
  checks: UpgradeCheck[];
  needsReview: string[];
  summary: string;
}

const mm = (m: number) => Math.round(m * 1000 * 10) / 10;
const fmt = (n: number) => String(Math.round(n * 100) / 100);

function batteryNodeName(spec: Spec): string {
  const rows: { from?: string }[] = Array.isArray(spec?.connections) ? spec.connections : [];
  const named = rows.find((r) => /battery/i.test(String(r.from ?? '')));
  return named?.from ? String(named.from) : 'Battery';
}

function existingCompute(spec: Spec, newName: string): string | null {
  const rows: { from?: string; to?: string }[] = Array.isArray(spec?.connections) ? spec.connections : [];
  const names = new Set<string>();
  for (const r of rows) for (const n of [r.from, r.to]) if (n && /raspberry pi|jetson|arduino|esp32/i.test(n) && n !== newName) names.add(String(n));
  return names.size ? [...names][0] : null;
}

function buildMount(c: ComponentDefinition): MountPlan {
  const [lx, ly, lz] = c.sizeM.map(mm) as [number, number, number];
  // The plate carries the enclosure walls plus a 10 mm flange outside
  // them, where the deck screws go (5 mm out from the wall).
  const wall = 2, thick = 3, flange = 10;
  const inner: [number, number, number] = [lx + 2 * wall, ly + 2 * wall, c.mounting.standoffHeightMm + lz + c.orientation.thermalClearanceTopMm];
  const innerH = inner[2];
  const plate: [number, number, number] = [inner[0] + 2 * wall + 2 * flange, inner[1] + 2 * wall + 2 * flange, thick];
  const holes = c.mounting.holePatternMm;
  const xs = holes.map((h) => h[0]), ys = holes.map((h) => h[1]);
  const pattern = `${fmt(Math.max(...xs) - Math.min(...xs))} × ${fmt(Math.max(...ys) - Math.min(...ys))} mm, ${c.mounting.fastener}`;
  const dx = inner[0] / 2 + wall + flange / 2, dy = inner[1] / 2 + wall + flange / 2;
  const deck: [number, number][] = [[-dx, -dy], [dx, -dy], [-dx, dy], [dx, dy]];
  const assumptions = [
    `The plate is ${fmt(plate[0])} × ${fmt(plate[1])} × ${thick} mm: the enclosure plus a ${flange} mm flange on every side for the deck screws.`,
    `The part's holes follow its published pattern (${pattern}).`,
    `The deck holes (M3, in the flange) are a choice, not the robot's: the robot's own deck hole positions are not recorded, so drill the deck to match the plate.`,
    `The enclosure is open-frame: walls ${wall} mm clear of the board, ${fmt(innerH)} mm tall inside (the ${c.mounting.standoffHeightMm} mm standoffs, the ${fmt(lz)} mm part and ${c.orientation.thermalClearanceTopMm} mm for cooling), with the top open for airflow.`,
    `The +X wall is left open by ${c.orientation.keepoutFrontMm} mm for plugs: ${c.mounting.notes}`,
  ];
  const pts = (p: [number, number][]) => '[' + p.map(([x, y]) => `[${fmt(x)}, ${fmt(y)}]`).join(', ') + ']';
  const scad = [
    `// ${c.name}: mounting plate and open-frame enclosure.`,
    '// PLANNED geometry from RobotForge. Built from the part\'s published hole',
    '// pattern plus the margins below, NOT measured on your robot.',
    `// Source for the hole pattern: ${c.source || 'not recorded'}`,
    '',
    '// Plate size (mm): the enclosure plus a flange on every side for the deck screws',
    `plate = [${plate.map(fmt).join(', ')}];`,
    '// Holes for the part (published pattern, centred on the plate)',
    `part_holes = ${pts(holes)};`,
    `part_hole_d = ${fmt(c.mounting.holeDiameterMm)};`,
    '// Holes to fix the plate to the deck (M3 clearance): a choice, drill the deck to match',
    `deck_holes = ${pts(deck)};`,
    'deck_hole_d = 3.2;',
    '// Standoff height under the part',
    `standoff_h = ${fmt(c.mounting.standoffHeightMm)};`,
    '// Enclosure: wall thickness, inside height, and the open plug gap on +X',
    `wall = ${wall};`,
    `inner = [${inner.map(fmt).join(', ')}];`,
    `plug_gap = ${fmt(c.orientation.keepoutFrontMm)};`,
    '',
    'module holes(list, d) { for (p = list) translate([p[0], p[1], -1]) cylinder(h = 100, d = d, $fn = 32); }',
    'difference() {',
    '  union() {',
    '    translate([-plate[0] / 2, -plate[1] / 2, 0]) cube(plate);',
    '    for (p = part_holes) translate([p[0], p[1], plate[2]]) cylinder(h = standoff_h, d = part_hole_d + 3, $fn = 32);',
    '    // walls',
    '    translate([0, 0, plate[2]]) difference() {',
    '      translate([-(inner[0] / 2 + wall), -(inner[1] / 2 + wall), 0]) cube([inner[0] + 2 * wall, inner[1] + 2 * wall, inner[2]]);',
    '      translate([-inner[0] / 2, -inner[1] / 2, -1]) cube([inner[0], inner[1], inner[2] + 2]);',
    '      translate([inner[0] / 2 - 1, -inner[1] / 2, standoff_h]) cube([wall + 2, inner[1], plug_gap + inner[2]]);',
    '    }',
    '  }',
    '  holes(part_holes, part_hole_d);',
    '  holes(deck_holes, deck_hole_d);',
    '}',
    '',
  ].join('\n');
  const fileId = c.id.replace(/[^a-z0-9]+/gi, '_');
  return { plateMm: plate, partHoles: { pattern, diameterMm: c.mounting.holeDiameterMm, positionsMm: holes.map((h) => [...h] as [number, number]) },
    deckHoles: { diameterMm: 3.2, positionsMm: deck }, standoffMm: c.mounting.standoffHeightMm, enclosureInnerMm: inner,
    openSide: `+X, ${c.orientation.keepoutFrontMm} mm for plugs`, assumptions, filename: `${fileId}_mount.scad`, scad };
}

function pickConverter(load: LoadRating, bat: BatteryRange): ConverterRating | null {
  const top = bat.maxV ?? bat.nominalV;
  if (top <= load.volts) return null; // only step-down converters are recorded
  // Closest output first, then the one that covers the battery's top.
  return [...CONVERTERS].filter((c) => Math.abs(c.outputV - load.volts) <= load.volts * 0.05)
    .sort((a, b) => Number(b.inputMaxV >= top) - Number(a.inputMaxV >= top) || b.outputA - a.outputA)[0] ?? null;
}

export function buildUpgradeProposal(robot: GarageRobot, componentId: string): UpgradeProposal {
  const version = robot.versions.at(-1);
  if (!version) throw new Error('Save a robot first.');
  const c = COMPONENTS.find((x) => x.id === componentId);
  if (!c) throw new Error('Unknown component.');
  const spec = version.spec ?? {};
  const bat = batteryRange(spec);
  const load = LOAD_RATINGS[c.id] ?? null;
  const checks: UpgradeCheck[] = [];
  const review: string[] = [...c.missing];
  const wiring: WiringRow[] = [];
  const batName = batteryNodeName(spec);
  const partName = c.name.split(' — ')[0];
  let converter: ConverterRating | null = null;

  if (!load) {
    checks.push({ id: 'power.load', label: 'Power needs', verdict: 'NOT_CHECKED', detail: `${partName}'s supply voltage and current are not recorded here, so power can't be planned.` });
  } else if (!bat) {
    checks.push({ id: 'power.battery', label: 'Battery', verdict: 'NOT_CHECKED', detail: `${robot.name} has no battery voltage recorded. Add it on the Build tab, then ask again.` });
  } else {
    const range = bat.minV != null ? `${fmt(bat.minV)}–${fmt(bat.maxV!)} V` : `${fmt(bat.nominalV)} V nominal`;
    checks.push({ id: 'power.battery', label: 'Battery range', verdict: bat.minV != null ? 'PASS' : 'NOT_CHECKED',
      detail: `${fmt(bat.nominalV)} V ${bat.chemistry} pack: ${range} (${bat.basis}).` });
    const lo = bat.minV ?? bat.nominalV, hi = bat.maxV ?? bat.nominalV;
    const direct = lo >= load.volts * 0.95 && hi <= load.volts * 1.05;
    if (direct) {
      checks.push({ id: 'power.conversion', label: 'Power conversion', verdict: 'PASS', detail: `The battery stays within 5% of the ${fmt(load.volts)} V ${partName} needs, so no converter is needed.` });
      wiring.push({ from: batName, to: partName, kind: 'power', volts: bat.nominalV, ratedMaxV: load.volts * 1.05,
        detail: `Power: battery + / − to the ${load.inputConnector}` });
    } else {
      converter = pickConverter(load, bat);
      const need = hi > load.volts ? `a step-down (buck) converter to ${fmt(load.volts)} V` : `a step-up converter to ${fmt(load.volts)} V`;
      checks.push({ id: 'power.conversion', label: 'Power conversion', verdict: converter ? 'PASS' : 'ERROR',
        detail: `The battery (${range}) can't feed ${partName}'s ${fmt(load.volts)} V input directly: it needs ${need}.` +
          (converter ? ` Proposed: ${converter.name} (${converter.source}).` : ' No converter with documented ratings fits, so choose one and record its ratings.') });
      if (converter) {
        const cv = converter;
        checks.push({ id: 'converter.input_max', label: 'Converter input limit', verdict: cv.inputMaxV >= hi ? 'PASS' : 'ERROR',
          detail: `Input rated to ${fmt(cv.inputMaxV)} V; the battery reaches ${fmt(hi)} V when full.` });
        checks.push({ id: 'converter.input_min', label: 'Converter at low battery', verdict: cv.inputMinV != null ? (cv.inputMinV <= lo ? 'PASS' : 'WARN') : 'NOT_CHECKED',
          detail: cv.inputMinV != null ? `Needs at least ${fmt(cv.inputMinV)} V; the battery falls to ${fmt(lo)} V when empty.`
            : `The battery falls to ${fmt(lo)} V when empty, and a buck converter needs its input above ${fmt(load.volts)} V plus its dropout. This module's minimum input isn't recorded, so check its datasheet.` });
        const ratio = cv.outputA / load.amps;
        checks.push({ id: 'converter.current', label: 'Converter current', verdict: ratio >= 1.2 ? 'PASS' : ratio >= 1 ? 'WARN' : 'ERROR',
          detail: `Rated ${fmt(cv.outputA)} A out; ${partName} can draw up to ${fmt(load.amps)} A.` + (ratio < 1.2 && ratio >= 1 ? ' That leaves no headroom, and converters derate when hot.' : '') });
        const dv = cv.outputV - load.volts;
        checks.push({ id: 'converter.voltage', label: 'Converter output voltage', verdict: Math.abs(dv) < 0.005 ? 'PASS' : Math.abs(dv) <= load.volts * 0.05 ? 'WARN' : 'ERROR',
          detail: `Outputs ${fmt(cv.outputV)} V; ${partName} wants ${fmt(load.volts)} V.` + (dv < 0 ? ' Under load and cable drop it can trip undervoltage warnings. An adjustable module set to the target voltage avoids that.' : '') });
        const eff = 0.9;
        const amps = (load.volts * load.amps) / (lo * eff);
        checks.push({ id: 'battery.current', label: 'Battery current', verdict: 'NOT_CHECKED',
          detail: `At full load and an empty battery this branch pulls about ${fmt(amps)} A from the pack (assuming 90% converter efficiency). The pack's maximum discharge current isn't recorded.` +
            (bat.capacityMah ? ` A ${bat.capacityMah} mAh pack covers this branch alone for about ${fmt((bat.capacityMah / 1000) / ((load.volts * load.amps) / (bat.nominalV * eff)))} h at full load.` : ' Battery capacity isn\'t recorded either, so runtime can\'t be estimated.') });
        wiring.push({ from: batName, to: cv.name, kind: 'power', volts: hi, ratedMaxV: cv.inputMaxV,
          detail: `Power: battery + / − to the converter's VIN+ / GND screw terminal · up to ${fmt(hi)} V · add an inline fuse and switch on the + lead` });
        wiring.push({ from: cv.name, to: partName, kind: 'power', volts: cv.outputV, ratedMaxV: load.volts * 1.05,
          detail: `Power: VOUT+ / GND to a USB-C power pigtail (VBUS / GND) into the ${load.inputConnector} · ${fmt(cv.outputV)} V, up to ${fmt(load.amps)} A · keep it short` });
        review.push(`Pick the converter model and confirm its minimum input voltage, current derating and connector, then record them.`);
        review.push(`Size the inline fuse on the battery + lead for the converter's input current (about ${fmt(amps)} A at worst).`);
      }
    }
    for (const n of load.notes) review.push(n);
    if (load.altSupplyPins) review.push(`Alternative supply: ${load.altSupplyPins}. That route skips the USB-C input, so only use it with a well-regulated converter.`);
  }

  // Wiring voltage check over the planned power rows.
  const over = wiring.filter((w) => w.kind === 'power' && w.volts != null && w.ratedMaxV != null && w.volts > w.ratedMaxV);
  if (wiring.length) checks.push({ id: 'wiring.voltage', label: 'Wiring voltages', verdict: over.length ? 'ERROR' : 'PASS',
    detail: over.length ? over.map((w) => `${w.from} → ${w.to} carries ${fmt(w.volts!)} V, above the ${fmt(w.ratedMaxV!)} V limit`).join('; ')
      : `Every planned power wire is within the documented limit of the part it feeds (${wiring.length} row${wiring.length === 1 ? '' : 's'}).` });

  // Replacing an existing board: say what moves over.
  const replaces = c.category === 'compute' ? existingCompute(spec, partName) : null;
  if (replaces) {
    const rows: { from?: string; to?: string; detail?: string }[] = (spec.connections ?? []).filter((r: { from?: string; to?: string }) => r.from === replaces || r.to === replaces);
    checks.push({ id: 'compute.existing', label: 'Existing computer', verdict: 'WARN',
      detail: `${robot.name} already has a ${replaces} with ${rows.length} documented connection${rows.length === 1 ? '' : 's'}. Decide whether ${partName} replaces it; if so, those connections move to ${partName}.` });
    if (c.id === 'raspberry-pi-4b-sbc') {
      if (rows.some((r) => /csi/i.test(String(r.detail ?? '')))) review.push(`The camera's CSI ribbon: the Pi 4B uses the standard 15-pin camera connector the OV5647 module was made for, so no adapter cable is needed.`);
    }
    if (c.id === 'raspberry-pi-5-sbc') {
      if (rows.some((r) => /csi/i.test(String(r.detail ?? '')))) review.push(`The camera's CSI ribbon: the Pi 5 uses the smaller 22-pin camera connector, so a camera made for earlier Pis needs a 22-to-15-pin adapter cable.`);
      if (rows.some((r) => /gpio|i2c/i.test(String(r.detail ?? '')))) review.push(`The 40-pin header keeps the same GPIO and I2C pin numbers as on earlier Pis, but check any HAT still fits with ${partName}'s cooler fitted.`);
    }
  }

  // Mount.
  const mount = buildMount(c);
  const L = Number(spec.length_m), W = Number(spec.width_m);
  if (Number.isFinite(L) && Number.isFinite(W) && L > 0 && W > 0) {
    const fits = mount.plateMm[0] <= mm(L) && mount.plateMm[1] <= mm(W);
    checks.push({ id: 'mount.fit', label: 'Mount fits the deck', verdict: fits ? 'PASS' : 'ERROR',
      detail: `Plate ${fmt(mount.plateMm[0])} × ${fmt(mount.plateMm[1])} mm on a ${fmt(mm(L))} × ${fmt(mm(W))} mm body${fits ? '' : ': too big'}.` });
  } else {
    checks.push({ id: 'mount.fit', label: 'Mount fits the deck', verdict: 'NOT_CHECKED',
      detail: `${robot.name}'s length and width aren't recorded, so the ${fmt(mount.plateMm[0])} × ${fmt(mount.plateMm[1])} mm plate can't be checked against the deck. Measure the deck or scan the robot.` });
  }
  const addedKg = c.massKg + (converter ? (COMPONENTS.find((x) => x.id === converter!.componentId)?.massKg ?? 0) : 0);
  const massKg = Number(spec.mass_kg);
  checks.push({ id: 'mass.added', label: 'Added mass', verdict: Number.isFinite(massKg) && massKg > 0 ? 'PASS' : 'NOT_CHECKED',
    detail: `Adds about ${fmt(addedKg * 1000)} g (published or envelope masses, not weighed)` +
      (Number.isFinite(massKg) && massKg > 0 ? `, ${fmt((100 * addedKg) / massKg)}% of ${robot.name}'s ${fmt(massKg)} kg.` : `. ${robot.name}'s total mass isn't recorded.`) });

  const counts = (v: Verdict) => checks.filter((x) => x.verdict === v).length;
  const summary = `${counts('PASS')} passed, ${counts('WARN')} to watch, ${counts('ERROR')} blocking, ${counts('NOT_CHECKED')} not checked.`;
  return {
    robotId: robot.id, robotName: robot.name, expectedVersionId: version.id,
    component: { id: c.id, name: c.name, source: c.source, note: c.note, missing: c.missing, massKg: c.massKg, sizeMm: c.sizeM.map(mm) as [number, number, number] },
    battery: bat, load, converter, replaces, wiring, mount, checks, needsReview: [...new Set(review)], summary,
  };
}

export function hasBlocking(p: UpgradeProposal): boolean { return p.checks.some((c) => c.verdict === 'ERROR'); }

/* ---------------- approve once, save as one version ---------------- */

export const UPGRADE_EVIDENCE = 'PLANNED' as const;

export function applyUpgrade(robots: GarageRobot[], p: UpgradeProposal, versionId: string, createdAt: string): GarageRobot[] {
  const robot = robots.find((r) => r.id === p.robotId);
  const latest = robot?.versions.at(-1);
  if (!robot || !latest) throw new Error('That robot is gone. Ask again.');
  if (latest.id !== p.expectedVersionId) throw new Error('The robot changed since this proposal. Ask again for a fresh one.');
  if (hasBlocking(p)) throw new Error('This proposal has a blocking problem. Fix it before saving.');
  const spec = JSON.parse(JSON.stringify(latest.spec ?? {}));
  const rows = Array.isArray(spec.connections) ? spec.connections : [];
  spec.connections = [...rows, ...p.wiring.map((w) => ({ from: w.from, to: w.to, detail: w.detail, evidence: UPGRADE_EVIDENCE, at: createdAt }))];
  const upgrades = Array.isArray(spec.upgrades) ? spec.upgrades : [];
  spec.upgrades = [...upgrades, {
    id: versionId, component: p.component.id, name: p.component.name, converter: p.converter?.catalogId ?? null,
    mount: { plate_mm: p.mount.plateMm, standoff_mm: p.mount.standoffMm, enclosure_inner_mm: p.mount.enclosureInnerMm, file: p.mount.filename },
    checks: p.checks.map((c) => ({ id: c.id, verdict: c.verdict })), needs_review: p.needsReview, approved_at: createdAt,
  }];
  const label = `Upgrade: add ${p.component.name.split(' — ')[0]}`;
  return robots.map((r) => r.id !== robot.id ? r : { ...r, versions: [...r.versions, {
    id: versionId, createdAt, planned: true, source: 'upgrade' as const, label,
    ...(latest.estimatedPaths ? { estimatedPaths: latest.estimatedPaths } : {}),
    note: `Approved in Wrench as one upgrade: ${p.wiring.length} planned wiring row${p.wiring.length === 1 ? '' : 's'}, mount ${p.mount.filename}. Checks: ${p.summary} PLANNED: parts not bought or fitted yet.`,
    spec,
  }] });
}

/* The saved version, checked again: the proposal is rebuilt against
 * the version before it (same battery, same part) and the saved rows
 * are confirmed present. Returns one line for the chat. */
export function recheckUpgrade(robot: GarageRobot, versionId: string): { ok: boolean; line: string } {
  const i = robot.versions.findIndex((v) => v.id === versionId);
  const saved = robot.versions[i];
  const upgrade = (saved?.spec?.upgrades ?? []).find((u: { id: string }) => u.id === versionId);
  if (!saved || i < 1 || !upgrade) return { ok: false, line: 'Recheck: the saved upgrade version was not found.' };
  const before = { ...robot, versions: robot.versions.slice(0, i) };
  const again = buildUpgradeProposal(before, upgrade.component);
  const rows: { from: string; to: string; evidence: string }[] = saved.spec.connections ?? [];
  const missing = again.wiring.filter((w) => !rows.some((r) => r.from === w.from && r.to === w.to && r.evidence === UPGRADE_EVIDENCE));
  const ok = !hasBlocking(again) && missing.length === 0;
  return { ok, line: `Rechecked the saved version: ${again.summary}` + (missing.length ? ` ${missing.length} planned wiring row(s) are missing.` : ' All planned wiring rows are saved.') };
}
