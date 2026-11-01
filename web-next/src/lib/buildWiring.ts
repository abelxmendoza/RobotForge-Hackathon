/* The build list's wiring: ports, connections, checks and the
 * chat's wiring grammar — the schematic layer over the shared
 * build list (lib/palette.ts, stored under rf.build.v1).
 *
 * Honesty contract, same as the rest of the app: a part exposes a
 * port ONLY where the catalogue records the data for it — an
 * `interface`/`interfaces` spec for data and signal ports, a
 * voltage / supply / connector record for power ports. A part with
 * no recorded interface data gets NO ports, and every surface that
 * lists it says why. Nothing here invents a voltage, a connector
 * or a bus: where the data is silent, the checks abstain and say
 * so. Wireless interfaces (Wi-Fi, Bluetooth) are recorded for a
 * few boards; they are not cable ports and never become one here.
 *
 * The wiring itself is a schematic: port positions and cable
 * routing in the 3D view are diagrammatic, not measured — the UI
 * badges it with exactly those words.
 *
 * Pure: no DOM, no storage. Functions take the catalogue data as
 * parameters (the palette.ts pattern) so the node tests run the
 * real code against the real data. Storage lives in
 * lib/wiringStore.ts. */
import type { Part, SimReadyPropEntry } from "./types";
import {
  matchPhrase,
  type BuildEntry,
  type PaletteItem,
} from "./palette";

/* ---------------- ports ---------------- */

export type WirePortType = "power" | "data" | "signal";

export interface WirePort {
  /** Stable per part: 'power-in', 'power-out', 'motor-out', 'usb'… */
  id: string;
  /** 'USB 3.0', 'Power out · XT60 · 14.8 V' — recorded facts only. */
  label: string;
  type: WirePortType;
  dir: "in" | "out" | "io";
  /** Connection family: power ports share 'power'; data/signal
   *  ports carry their bus ('usb', 'i2c', …). */
  bus: string;
  /** The point voltage this port carries (out) or expects (in),
   *  when the data records one number. Null when it doesn't. */
  volts: number | null;
  /** A recorded maximum for an input (drivers' voltage_v_max,
   *  the buck's input_v_max). */
  ratedMaxV: number | null;
  /** A recorded operating range (the MG996R's "4.8-7.2"). */
  rangeV: [number, number] | null;
  /** The recorded spec field this port came from. */
  source: string;
}

export interface PartPorts {
  ports: WirePort[];
  /** Recorded wireless interfaces (Wi-Fi / BLE): real data, but
   *  not cable ports — surfaced so the UI can say so. */
  wireless: string[];
}

const BUS_LABELS: Record<string, string> = {
  usb: "USB",
  uart: "UART",
  i2c: "I2C",
  spi: "SPI",
  can: "CAN",
  csi: "CSI",
  ethernet: "Ethernet",
  pcie: "PCIe",
  gpio: "GPIO",
  pio: "PIO",
  pwm: "PWM",
};
const WIRELESS = new Set(["wifi", "ble"]);
const SIGNAL_BUSES = new Set(["pwm", "gpio"]);

const fmtV = (v: number) => `${Math.round(v * 10) / 10} V`;

/* One recorded interface string → its cable ports. Composite
 * strings split ("uart/usb" is two connectors); qualifiers fold
 * ("csi ribbon" is CSI, "uart bus" is UART); descriptive fragments
 * that name no bus ("position feedback") yield nothing. */
function interfacePorts(
  raw: string,
  logicV: number | null,
  source: string,
): { ports: WirePort[]; wireless: string[] } {
  const ports: WirePort[] = [];
  const wireless: string[] = [];
  const seen = new Set<string>();
  for (const frag of raw.toLowerCase().split(/[/,]/)) {
    const token = frag.trim().split(/\s+/)[0];
    if (!token) continue;
    if (WIRELESS.has(token)) {
      wireless.push(token === "wifi" ? "Wi-Fi" : "Bluetooth");
      continue;
    }
    let bus: string | null = null;
    let label: string | null = null;
    if (token === "usb3" || token === "usb") {
      bus = "usb";
      label = token === "usb3" ? "USB 3.0" : "USB";
    } else if (token === "crsf") {
      bus = "uart";
      label = "CRSF/UART";
    } else if (BUS_LABELS[token]) {
      bus = token;
      label = BUS_LABELS[token];
    }
    if (!bus || !label || seen.has(bus)) continue;
    seen.add(bus);
    ports.push({
      id: bus,
      label,
      type: SIGNAL_BUSES.has(bus) ? "signal" : "data",
      /* A servo's PWM lead only ever receives; everything else on
       * a bus talks both ways at this schematic level. */
      dir: "io",
      bus,
      volts: logicV,
      ratedMaxV: null,
      rangeV: null,
      source,
    });
  }
  return { ports, wireless };
}

/* The ports a catalogue part exposes, from its recorded specs
 * alone. Bench props never pass through here — they have no
 * electrical data at all (see noPortReason). */
export function portsForPart(part: Part): PartPorts {
  const specs = (part.specs ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const logicV = num(specs.logic_v);
  const ports: WirePort[] = [];
  const wireless: string[] = [];

  /* Data / signal ports from the recorded interfaces. */
  const rawInterfaces: { raw: string; source: string }[] = [];
  if (typeof specs.interface === "string") {
    rawInterfaces.push({ raw: specs.interface, source: "specs.interface" });
  }
  if (Array.isArray(specs.interfaces)) {
    for (const v of specs.interfaces) {
      if (typeof v === "string") {
        rawInterfaces.push({ raw: v, source: "specs.interfaces" });
      }
    }
  }
  for (const { raw, source } of rawInterfaces) {
    const got = interfacePorts(raw, logicV, source);
    for (const p of got.ports) {
      if (!ports.some((x) => x.id === p.id)) ports.push(p);
    }
    for (const w of got.wireless) {
      if (!wireless.includes(w)) wireless.push(w);
    }
  }
  /* A positional servo's PWM port is an input, not a bus peer. */
  if (part.id === "servo_mg996r") {
    const pwm = ports.find((p) => p.id === "pwm");
    if (pwm) pwm.dir = "in";
  }

  /* Power ports from the recorded voltage / supply data. */
  const voltage = specs.voltage_v;
  const connector =
    typeof specs.connector === "string" ? specs.connector : null;
  if (part.part_class === "power" && typeof voltage === "number") {
    ports.push({
      id: "power-out",
      label:
        `Power out${connector ? ` · ${connector}` : ""} · ${fmtV(voltage)}`,
      type: "power",
      dir: "out",
      bus: "power",
      volts: voltage,
      ratedMaxV: null,
      rangeV: null,
      source: "specs.voltage_v",
    });
  }
  /* A converter (recorded output_v + input_v_max): a rated input
   * and a fixed-voltage output. */
  const outputV = num(specs.output_v);
  const inputMax = num(specs.input_v_max);
  if (outputV != null) {
    ports.push({
      id: "power-out",
      label: `Power out · ${fmtV(outputV)}`,
      type: "power",
      dir: "out",
      bus: "power",
      volts: outputV,
      ratedMaxV: null,
      rangeV: null,
      source: "specs.output_v",
    });
  }
  if (inputMax != null) {
    ports.push({
      id: "power-in",
      label: `Power in · up to ${fmtV(inputMax)} in`,
      type: "power",
      dir: "in",
      bus: "power",
      volts: null,
      ratedMaxV: inputMax,
      rangeV: null,
      source: "specs.input_v_max",
    });
  }
  /* Drivers and ESCs: a motor-power input (rated max when the
   * data records one, a cell-count label when it records that
   * instead) and the motor outputs their channels describe. */
  if (part.part_class === "drivers") {
    const maxV = num(specs.voltage_v_max);
    const cells = typeof specs.cells === "string" ? specs.cells : null;
    ports.push({
      id: "power-in",
      label:
        maxV != null
          ? `Motor power in · up to ${fmtV(maxV)}`
          : `Battery in${cells ? ` · ${cells}` : ""}`,
      type: "power",
      dir: "in",
      bus: "power",
      volts: null,
      ratedMaxV: maxV,
      rangeV: null,
      source: maxV != null ? "specs.voltage_v_max" : "specs.cells",
    });
    const channels = num(specs.channels);
    ports.push({
      id: "motor-out",
      label: `Motor out${channels ? ` · ${channels} ch` : ""}`,
      type: "power",
      dir: "out",
      bus: "power",
      volts: null,
      ratedMaxV: null,
      rangeV: null,
      source: "specs.channels",
    });
  }
  /* Actuators with a recorded operating voltage get the power
   * input that voltage describes. A range stays a range. */
  if (part.part_class === "actuators") {
    if (typeof voltage === "number") {
      ports.push({
        id: "power-in",
        label: `Power in · ${fmtV(voltage)}`,
        type: "power",
        dir: "in",
        bus: "power",
        volts: voltage,
        ratedMaxV: null,
        rangeV: null,
        source: "specs.voltage_v",
      });
    } else if (typeof voltage === "string") {
      const m = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(voltage);
      if (m) {
        ports.push({
          id: "power-in",
          label: `Power in · ${voltage} V`,
          type: "power",
          dir: "in",
          bus: "power",
          volts: null,
          ratedMaxV: null,
          rangeV: [parseFloat(m[1]), parseFloat(m[2])],
          source: "specs.voltage_v",
        });
      }
    } else if (typeof specs.cells === "string") {
      ports.push({
        id: "power-in",
        label: `Power in · via ESC · ${specs.cells}`,
        type: "power",
        dir: "in",
        bus: "power",
        volts: null,
        ratedMaxV: null,
        rangeV: null,
        source: "specs.cells",
      });
    }
  }
  /* Boards with a recorded supply line get the input it names. */
  if (typeof specs.supply === "string") {
    const m = /(\d+(?:\.\d+)?)\s*V/.exec(specs.supply);
    if (m) {
      ports.push({
        id: "power-in",
        label: `Power in · ${specs.supply}`,
        type: "power",
        dir: "in",
        bus: "power",
        volts: parseFloat(m[1]),
        ratedMaxV: null,
        rangeV: null,
        source: "specs.supply",
      });
    }
  }
  return { ports, wireless };
}

/* Why an entry has no ports, in the words the UI shows. */
export function noPortReason(
  entry: BuildEntry,
  partsById: Map<string, Part>,
): string {
  if (entry.kind === "bench-prop") {
    return "bench prop — a visual model only; no electrical data is recorded for it";
  }
  const part = partsById.get(entry.refId);
  if (!part) return "the catalogue no longer lists this part";
  const { wireless } = portsForPart(part);
  if (wireless.length) {
    return `its only recorded interfaces are wireless (${wireless.join(", ")}) — not cable ports`;
  }
  return "the catalogue records no interface or power data for this part";
}

/* Ports per build entry (catalogue parts only), keyed by uid. */
export function portsByEntry(
  entries: BuildEntry[],
  partsById: Map<string, Part>,
): Map<string, WirePort[]> {
  const out = new Map<string, WirePort[]>();
  for (const e of entries) {
    if (e.kind !== "catalog-part") {
      out.set(e.uid, []);
      continue;
    }
    const part = partsById.get(e.refId);
    out.set(e.uid, part ? portsForPart(part).ports : []);
  }
  return out;
}

/* ---------------- connections ---------------- */

export interface BuildConnection {
  id: string;
  fromEntry: string;
  fromPort: string;
  toEntry: string;
  toPort: string;
  type: WirePortType;
}

export interface BuildWiring {
  connections: BuildConnection[];
}

export const EMPTY_WIRING: BuildWiring = { connections: [] };

/* Can these two ports be cabled together? Same family; power
 * needs an out and an in (or a bidirectional side); a bus needs
 * the same bus and not two inputs or two outputs. */
export function portsConnectable(a: WirePort, b: WirePort): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "power") {
    return (
      (a.dir === "out" && b.dir === "in") ||
      (a.dir === "in" && b.dir === "out") ||
      a.dir === "io" ||
      b.dir === "io"
    );
  }
  if (a.bus !== b.bus) return false;
  return !(a.dir === "in" && b.dir === "in") && !(a.dir === "out" && b.dir === "out");
}

export interface PortPair {
  a: WirePort;
  b: WirePort;
}

export function compatiblePairs(
  portsA: WirePort[],
  portsB: WirePort[],
): PortPair[] {
  const out: PortPair[] = [];
  for (const a of portsA) {
    for (const b of portsB) {
      if (portsConnectable(a, b)) out.push({ a, b });
    }
  }
  return out;
}

const pairKey = (e1: string, p1: string, e2: string, p2: string) =>
  [`${e1}:${p1}`, `${e2}:${p2}`].sort().join("|");

/* The stored connections that still resolve against the current
 * build list — both entries present, both ports still exposed.
 * Everything (view, checks, chat, export) works on the resolved
 * set, so removing a part retires its cables everywhere at once;
 * the next write stores the pruned set. */
export function resolveConnections(
  entries: BuildEntry[],
  wiring: BuildWiring,
  partsById: Map<string, Part>,
): BuildConnection[] {
  const byUid = portsByEntry(entries, partsById);
  return (wiring.connections ?? []).filter((c) => {
    const a = byUid.get(c.fromEntry);
    const b = byUid.get(c.toEntry);
    return (
      !!a &&
      !!b &&
      a.some((p) => p.id === c.fromPort) &&
      b.some((p) => p.id === c.toPort)
    );
  });
}

export type AddResult =
  | { ok: true; wiring: BuildWiring; connection: BuildConnection }
  | { ok: false; error: string };

/* Add one connection between two entries' ports. Direction is
 * normalised (out → in) when the ports declare it. Refusals are
 * named: unknown entry/port, same entry, incompatible ports, or
 * a duplicate of an existing cable. */
export function addConnection(
  entries: BuildEntry[],
  wiring: BuildWiring,
  partsById: Map<string, Part>,
  fromEntry: string,
  fromPort: string,
  toEntry: string,
  toPort: string,
  makeId: () => string,
): AddResult {
  const byUid = portsByEntry(entries, partsById);
  const aPorts = byUid.get(fromEntry);
  const bPorts = byUid.get(toEntry);
  if (!aPorts || !bPorts) return { ok: false, error: "unknown build entry" };
  if (fromEntry === toEntry) {
    return { ok: false, error: "a part cannot be wired to itself" };
  }
  const a = aPorts.find((p) => p.id === fromPort);
  const b = bPorts.find((p) => p.id === toPort);
  if (!a || !b) return { ok: false, error: "unknown port" };
  if (!portsConnectable(a, b)) {
    return {
      ok: false,
      error: `${a.label} and ${b.label} are not compatible ports`,
    };
  }
  const resolved = resolveConnections(entries, wiring, partsById);
  const key = pairKey(fromEntry, fromPort, toEntry, toPort);
  if (
    resolved.some(
      (c) => pairKey(c.fromEntry, c.fromPort, c.toEntry, c.toPort) === key,
    )
  ) {
    return { ok: false, error: "that cable already exists" };
  }
  /* out feeds in, whichever order the caller named them in. */
  const flip =
    a.dir === "in" && b.dir === "out" ? ([b, a] as const) : ([a, b] as const);
  const connection: BuildConnection = {
    id: makeId(),
    fromEntry: flip[0] === a ? fromEntry : toEntry,
    fromPort: flip[0].id,
    toEntry: flip[0] === a ? toEntry : fromEntry,
    toPort: flip[1].id,
    type: a.type,
  };
  return {
    ok: true,
    connection,
    wiring: { connections: [...resolved, connection] },
  };
}

export function removeConnection(
  wiring: BuildWiring,
  id: string,
): BuildWiring {
  return {
    connections: (wiring.connections ?? []).filter((c) => c.id !== id),
  };
}

/* Remove every connection touching an entry; returns the count. */
export function disconnectEntry(
  wiring: BuildWiring,
  entryUid: string,
): { wiring: BuildWiring; removed: number } {
  const kept = (wiring.connections ?? []).filter(
    (c) => c.fromEntry !== entryUid && c.toEntry !== entryUid,
  );
  return {
    wiring: { connections: kept },
    removed: (wiring.connections ?? []).length - kept.length,
  };
}

/* ---------------- checks ---------------- */

export interface WiringIssue {
  kind: "unpowered" | "voltage-mismatch" | "duplicate";
  message: string;
  evidence: string;
  entryUid?: string;
  connectionId?: string;
}

export interface WiringCheckResult {
  issues: WiringIssue[];
  /** What the checks could NOT judge, and why — stated, never
   *  silently skipped. */
  abstentions: string[];
}

/* The voltage arriving at each entry's power input, propagated
 * over the resolved power connections: a source port's recorded
 * voltage, passed through one device's out port (a driver's
 * motor-out, a converter's out) when that device is itself fed.
 * Bounded passes. When two different voltages arrive at the same
 * entry the value stays unknown (the entry is dropped from the
 * map) — the checks abstain rather than pick one. */
function supplyVolts(
  connections: BuildConnection[],
  byUid: Map<string, WirePort[]>,
): Map<string, number> {
  const arrived = new Map<string, Set<number>>();
  const outVolts = (c: BuildConnection): number | null => {
    const p = byUid.get(c.fromEntry)?.find((x) => x.id === c.fromPort);
    if (!p) return null;
    if (p.volts != null) return p.volts;
    /* Pass-through: this out port carries whatever feeds its own
     * device (a driver fed 14.8 V drives its motors at 14.8 V). */
    const fed = arrived.get(c.fromEntry);
    return fed && fed.size === 1 ? [...fed][0] : null;
  };
  for (let pass = 0; pass < 4; pass++) {
    for (const c of connections) {
      if (c.type !== "power") continue;
      const v = outVolts(c);
      if (v == null) continue;
      if (!arrived.has(c.toEntry)) arrived.set(c.toEntry, new Set());
      (arrived.get(c.toEntry) as Set<number>).add(v);
    }
  }
  const supply = new Map<string, number>();
  for (const [uid, vs] of arrived) {
    if (vs.size === 1) supply.set(uid, [...vs][0]);
  }
  return supply;
}

/* Graph checks over the resolved connections. Every claim cites
 * the recorded numbers it rests on; where the data does not
 * record what a check needs, the check abstains and the
 * abstention is listed. */
export function wiringChecks(
  entries: BuildEntry[],
  wiring: BuildWiring,
  partsById: Map<string, Part>,
  nameOf: (e: BuildEntry) => string,
): WiringCheckResult {
  const connections = resolveConnections(entries, wiring, partsById);
  const byUid = portsByEntry(entries, partsById);
  const issues: WiringIssue[] = [];
  const abstentions: string[] = [];

  /* Unpowered: an entry whose recorded power input has no cable.
   * Entries with no power input recorded are not judged — many
   * are bus-powered in reality, and the data doesn't say. */
  let unjudgedPower = 0;
  for (const e of entries) {
    const ports = byUid.get(e.uid) ?? [];
    const powerIn = ports.find((p) => p.type === "power" && p.dir === "in");
    if (!powerIn) {
      /* Sources (a battery, a converter output) aren't judged
       * for being unpowered; bus devices with no power port at
       * all are the unjudged set the abstention reports. */
      const isSource = ports.some((p) => p.type === "power" && p.dir === "out");
      if (ports.length && !isSource) unjudgedPower++;
      continue;
    }
    const fed = connections.some(
      (c) =>
        (c.fromEntry === e.uid && c.fromPort === powerIn.id) ||
        (c.toEntry === e.uid && c.toPort === powerIn.id),
    );
    if (!fed) {
      issues.push({
        kind: "unpowered",
        entryUid: e.uid,
        message: `${nameOf(e)} is not powered`,
        evidence: `its recorded power input (${powerIn.label}) has no cable — nothing feeds it`,
      });
    }
  }
  if (unjudgedPower) {
    abstentions.push(
      `${unjudgedPower} part${unjudgedPower === 1 ? "" : "s"} with ports ` +
        "record no power input, so the power check can't judge them " +
        "(bus-powered parts are not flagged)",
    );
  }

  /* Voltage: what a power cable delivers vs what the receiving
   * port records — a point value, a rated maximum, or a range.
   * When the delivered voltage can't be determined from recorded
   * data, the cable is listed as unchecked, not passed. */
  const supply = supplyVolts(connections, byUid);
  let uncheckedVolts = 0;
  for (const c of connections) {
    if (c.type !== "power") continue;
    const to = byUid.get(c.toEntry)?.find((p) => p.id === c.toPort);
    const fromEntry = entries.find((e) => e.uid === c.fromEntry);
    const toEntry = entries.find((e) => e.uid === c.toEntry);
    if (!to || !fromEntry || !toEntry) continue;
    const fromPort = byUid
      .get(c.fromEntry)
      ?.find((p) => p.id === c.fromPort);
    const delivered =
      fromPort?.volts ?? supply.get(c.fromEntry) ?? null;
    const expects =
      to.volts != null || to.ratedMaxV != null || to.rangeV != null;
    if (delivered == null) {
      if (expects) uncheckedVolts++;
      continue;
    }
    const route =
      fromPort?.volts != null
        ? `${nameOf(fromEntry)}'s ${fromPort.label}`
        : `${nameOf(fromEntry)} (fed ${fmtV(delivered)})`;
    if (to.volts != null && delivered !== to.volts) {
      issues.push({
        kind: "voltage-mismatch",
        connectionId: c.id,
        message:
          `${route} delivers ${fmtV(delivered)} into ${nameOf(toEntry)}, ` +
          `which records ${fmtV(to.volts)}`,
        evidence: `recorded voltages differ: ${fmtV(delivered)} ≠ ${fmtV(to.volts)}`,
      });
    } else if (to.ratedMaxV != null && delivered > to.ratedMaxV) {
      issues.push({
        kind: "voltage-mismatch",
        connectionId: c.id,
        message:
          `${route} delivers ${fmtV(delivered)} into ${nameOf(toEntry)}, ` +
          `above its recorded maximum of ${fmtV(to.ratedMaxV)}`,
        evidence: `recorded feed ${fmtV(delivered)} > rated max ${fmtV(to.ratedMaxV)}`,
      });
    } else if (
      to.rangeV &&
      (delivered < to.rangeV[0] || delivered > to.rangeV[1])
    ) {
      issues.push({
        kind: "voltage-mismatch",
        connectionId: c.id,
        message:
          `${route} delivers ${fmtV(delivered)} into ${nameOf(toEntry)}, ` +
          `outside its recorded ${fmtV(to.rangeV[0])}–${fmtV(to.rangeV[1])} range`,
        evidence: `recorded feed ${fmtV(delivered)} is outside the recorded range`,
      });
    }
  }
  if (uncheckedVolts) {
    abstentions.push(
      `${uncheckedVolts} power cable${uncheckedVolts === 1 ? "" : "s"} not ` +
        "voltage-checked: the delivered voltage isn't recorded " +
        "(the source names no fixed voltage, e.g. a driver passing its supply through)",
    );
  }

  /* Duplicates: the same pair of ports cabled twice. */
  const seen = new Map<string, BuildConnection>();
  for (const c of connections) {
    const k = pairKey(c.fromEntry, c.fromPort, c.toEntry, c.toPort);
    const prev = seen.get(k);
    if (prev) {
      issues.push({
        kind: "duplicate",
        connectionId: c.id,
        message: "the same pair of ports is cabled twice",
        evidence: `connection ${prev.id} and ${c.id} join the same ports`,
      });
    } else {
      seen.set(k, c);
    }
  }
  return { issues, abstentions };
}

/* ---------------- schematic layout ----------------
 * Device blocks for the 3D wiring view. Only entries WITH ports
 * get a block — a part that can't be wired has no business in a
 * wiring diagram. Positions are deterministic (build order, two
 * rows on the stage) and sizes are per-class diagram sizes with
 * two recorded overrides; the view badges all of it as
 * diagrammatic. */

export interface DeviceBox {
  entryUid: string;
  center: [number, number];
  size: [number, number, number];
}

const CLASS_SIZE: Record<string, [number, number, number]> = {
  power: [0.15, 0.055, 0.04],
  drivers: [0.055, 0.05, 0.018],
  microcontrollers: [0.055, 0.04, 0.012],
  sbc: [0.09, 0.06, 0.018],
  cameras_sensors: [0.045, 0.03, 0.03],
  comms: [0.05, 0.035, 0.012],
  actuators: [0.05, 0.05, 0.05],
};

function deviceSize(part: Part): [number, number, number] {
  const specs = (part.specs ?? {}) as Record<string, unknown>;
  if (typeof specs.diameter_m === "number") {
    const d = specs.diameter_m;
    const w = typeof specs.width_m === "number" ? specs.width_m : 0.03;
    return [d, w, d];
  }
  if (typeof specs.size === "string") {
    const m = /(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)\s*mm/.exec(specs.size);
    if (m) return [parseFloat(m[1]) / 1000, parseFloat(m[2]) / 1000, 0.012];
  }
  return CLASS_SIZE[part.part_class] ?? [0.06, 0.045, 0.025];
}

export function deviceBoxes(
  entries: BuildEntry[],
  partsById: Map<string, Part>,
): DeviceBox[] {
  const byUid = portsByEntry(entries, partsById);
  const wired = entries.filter((e) => (byUid.get(e.uid) ?? []).length > 0);
  const front = wired.slice(0, Math.ceil(wired.length / 2));
  const back = wired.slice(Math.ceil(wired.length / 2));
  const place = (row: BuildEntry[], y: number): DeviceBox[] =>
    row.map((e, i) => {
      const part = partsById.get(e.refId) as Part;
      const x =
        row.length === 1 ? 0 : -0.42 + (0.84 * i) / (row.length - 1);
      return { entryUid: e.uid, center: [x, y], size: deviceSize(part) };
    });
  return [...place(front, -0.4), ...place(back, 0.42)];
}

/* Port anchor points on a device box: power on the left face,
 * data on the right face, signal on the front face — spread along
 * the face when a device has several of a kind. Diagrammatic by
 * design (the badge says so). Returns [x, y, z] per port id. */
export function portAnchors(
  box: DeviceBox,
  ports: WirePort[],
): Map<string, [number, number, number]> {
  const [cx, cy] = box.center;
  const [w, d, h] = box.size;
  const z = h * 0.55;
  const groups: Record<WirePortType, WirePort[]> = {
    power: [],
    data: [],
    signal: [],
  };
  for (const p of ports) groups[p.type].push(p);
  const out = new Map<string, [number, number, number]>();
  const spread = (n: number, i: number, extent: number) =>
    n === 1 ? 0 : (i - (n - 1) / 2) * Math.min(0.018, (extent * 0.6) / n);
  groups.power.forEach((p, i) => {
    out.set(p.id, [cx - w / 2, cy + spread(groups.power.length, i, d), z]);
  });
  groups.data.forEach((p, i) => {
    out.set(p.id, [cx + w / 2, cy + spread(groups.data.length, i, d), z]);
  });
  groups.signal.forEach((p, i) => {
    out.set(p.id, [cx + spread(groups.signal.length, i, w), cy - d / 2, z]);
  });
  return out;
}

/* ---------------- shared row shape ---------------- */

export interface WiringRow {
  id: string;
  fromName: string;
  fromPortLabel: string;
  toName: string;
  toPortLabel: string;
  type: WirePortType;
}

/* The wiring table's rows — one shape for the Kit panel, the
 * chat's answers and the BOM harness section. */
export function wiringRows(
  entries: BuildEntry[],
  wiring: BuildWiring,
  partsById: Map<string, Part>,
  nameOf: (e: BuildEntry) => string,
): WiringRow[] {
  const byUid = portsByEntry(entries, partsById);
  const byEntry = new Map(entries.map((e) => [e.uid, e]));
  return resolveConnections(entries, wiring, partsById).map((c) => {
    const a = byEntry.get(c.fromEntry) as BuildEntry;
    const b = byEntry.get(c.toEntry) as BuildEntry;
    return {
      id: c.id,
      fromName: nameOf(a),
      fromPortLabel:
        byUid.get(c.fromEntry)?.find((p) => p.id === c.fromPort)?.label ??
        c.fromPort,
      toName: nameOf(b),
      toPortLabel:
        byUid.get(c.toEntry)?.find((p) => p.id === c.toPort)?.label ??
        c.toPort,
      type: c.type,
    };
  });
}

/* The BOM export's harness section (plain text), or "" when the
 * build has no wiring — an export never invents a harness. */
export function harnessText(
  entries: BuildEntry[],
  wiring: BuildWiring,
  partsById: Map<string, Part>,
  nameOf: (e: BuildEntry) => string,
): string {
  const rows = wiringRows(entries, wiring, partsById, nameOf);
  if (!rows.length) return "";
  const out = [
    "Wiring harness — schematic (port positions and routing are diagrammatic, not measured):",
  ];
  for (const r of rows) {
    out.push(
      `- ${r.fromName} [${r.fromPortLabel}] → ${r.toName} [${r.toPortLabel}] (${r.type})`,
    );
  }
  const checks = wiringChecks(entries, wiring, partsById, nameOf);
  if (checks.issues.length) {
    out.push("Wiring checks:");
    for (const i of checks.issues) out.push(`- ${i.message} — ${i.evidence}.`);
  } else {
    out.push("Wiring checks: no problems found by the recorded-data checks.");
  }
  for (const a of checks.abstentions) out.push(`Not checked: ${a}.`);
  return out.join("\n");
}

/* The harness as CSV rows in the BOM's own columns. */
export function harnessCsvRows(
  entries: BuildEntry[],
  wiring: BuildWiring,
  partsById: Map<string, Part>,
  nameOf: (e: BuildEntry) => string,
): string[][] {
  return wiringRows(entries, wiring, partsById, nameOf).map((r) => [
    `${r.fromName} → ${r.toName}`,
    "1",
    `wiring · ${r.type}`,
    "Your build list — wiring",
    `${r.fromPortLabel} → ${r.toPortLabel}`,
    "",
    "",
    "",
    "",
    "",
  ]);
}

/* The harness rows as a CSV block (same escaping as bom.ts). */
export function harnessCsv(
  entries: BuildEntry[],
  wiring: BuildWiring,
  partsById: Map<string, Part>,
  nameOf: (e: BuildEntry) => string,
): string {
  const cell = (s: string) =>
    /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return harnessCsvRows(entries, wiring, partsById, nameOf)
    .map((r) => r.map(cell).join(","))
    .join("\n");
}

/* ---------------- the chat's wiring grammar ----------------
 * Deterministic, in the palette grammar's place in the command
 * path: after the build-list adds, before the spec grammars.
 * "wire the camera to the Orin" acts on the BUILD LIST's entries
 * (wiring joins devices you have, not catalogue entries you
 * don't). Refusals are named — unknown part, part not in the
 * build, no compatible port, an ambiguous bus. Robot-directed
 * shapes (quoted names, a saved robot's name) return null so the
 * assembly/spec grammars keep their meanings, and anything else
 * unmatched falls through to the live translator untouched. */

export interface WiringCommandOutcome {
  text: string;
  /** The wiring to store, when the command changed it. */
  wiring?: BuildWiring;
}

function entryItems(
  entries: BuildEntry[],
  items: PaletteItem[],
): PaletteItem[] {
  return items.filter((i) =>
    entries.some((e) => e.kind === i.kind && e.refId === i.refId),
  );
}

function nameOfEntry(
  entries: BuildEntry[],
  items: PaletteItem[],
): (e: BuildEntry) => string {
  const byKey = new Map(items.map((i) => [`${i.kind}:${i.refId}`, i.name]));
  return (e) => {
    const base = byKey.get(`${e.kind}:${e.refId}`) ?? e.refId;
    return e.kind === "catalog-part" && e.qty > 1 ? `${base} ×${e.qty}` : base;
  };
}

export function formatChecksText(
  entries: BuildEntry[],
  wiring: BuildWiring,
  partsById: Map<string, Part>,
  items: PaletteItem[],
): string {
  const nameOf = nameOfEntry(entries, items);
  const resolved = resolveConnections(entries, wiring, partsById);
  if (!entries.length) {
    return "Your build list is empty — add parts from the Parts palette or with “add … to my build” first, then wire them.";
  }
  const checks = wiringChecks(entries, wiring, partsById, nameOf);
  const out: string[] = [];
  out.push(
    resolved.length
      ? `Wiring check — ${resolved.length} cable${resolved.length === 1 ? "" : "s"} in your build:`
      : "Wiring check — no cables in your build yet:",
  );
  if (checks.issues.length) {
    for (const i of checks.issues) out.push(`- ${i.message} — ${i.evidence}.`);
  } else if (resolved.length) {
    out.push("- No problems found by the recorded-data checks.");
  }
  for (const a of checks.abstentions) out.push(`Not checked: ${a}.`);
  return out.join("\n");
}

export function runWiringCommand(
  raw: string,
  entries: BuildEntry[],
  wiring: BuildWiring,
  partsById: Map<string, Part>,
  items: PaletteItem[],
  robotNames: string[],
  makeId: () => string,
): WiringCommandOutcome | null {
  const q = raw.trim().replace(/[.\s]+$/, "");
  if (!q || /"[^"]+"/.test(q)) return null;
  const lower = q.toLowerCase();
  for (const name of robotNames) {
    if (name && lower.includes(name.toLowerCase())) return null;
  }
  const nameOf = nameOfEntry(entries, items);
  const eItems = entryItems(entries, items);
  const entryFor = (item: PaletteItem) =>
    entries.find((e) => e.kind === item.kind && e.refId === item.refId);

  const resolvePhrase = (
    phrase: string,
  ):
    | { entry: BuildEntry; item: PaletteItem }
    | { error: string } => {
    const m = matchPhrase(phrase, eItems);
    if (m.status === "match") {
      const entry = entryFor(m.item);
      if (entry) return { entry, item: m.item };
    }
    if (m.status === "ambiguous") {
      return {
        error:
          `“${phrase}” matches more than one part in your build ` +
          `(${m.options.map((o) => o.name).slice(0, 4).join(" · ")}) — name the one you mean.`,
      };
    }
    if (m.status === "none") {
      /* Loose fallback: match the phrase's content words against
       * each entry's name + palette detail + id text ("camera"
       * lives in the RealSense's "Depth camera" detail, "lidar"
       * in "360° lidar scanner"). A unique top scorer resolves;
       * a tie is ambiguous. */
      const toks = phrase
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !["the", "and", "for"].includes(t));
      const scored = eItems
        .map((i) => {
          const hay = `${i.name} ${i.specLine} ${i.refId.replace(/_/g, " ")}`
            .toLowerCase();
          return {
            item: i,
            score: toks.filter((t) => hay.includes(t)).length,
          };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);
      if (scored.length === 1 ||
          (scored.length > 1 && scored[0].score > scored[1].score)) {
        const entry = entryFor(scored[0].item);
        if (entry) return { entry, item: scored[0].item };
      }
      if (scored.length > 1) {
        return {
          error:
            `“${phrase}” matches more than one part in your build ` +
            `(${scored.map((s) => s.item.name).slice(0, 4).join(" · ")}) — name the one you mean.`,
        };
      }
    }
    /* Not among the build's entries: say whether the palette has
     * it at all — the fix differs (add it first vs a typo). */
    const inPalette = matchPhrase(phrase, items);
    if (inPalette.status === "match") {
      return {
        error:
          `“${inPalette.item.name}” is in the palette but not in your build list — ` +
          `add it first (“add ${inPalette.item.name} to my build”), then wire it.`,
      };
    }
    if (inPalette.status === "ambiguous" && inPalette.options.length) {
      return {
        error:
          `“${phrase}” matches ${inPalette.options.slice(0, 3).map((o) => o.name).join(" · ")} ` +
          `in the parts palette, but not in your build list — add the part first, then wire it.`,
      };
    }
    return {
      error: `“${phrase}” doesn't match any part in your build list — wiring joins parts in your build.`,
    };
  };

  /* --- check --- */
  if (
    /^(check|test|inspect)\s+(my\s+|the\s+)?wiring\b/i.test(q) ||
    /^what(?:'s| is| are)\s+(still\s+)?unpowered\b/i.test(q) ||
    /^anything\s+unpowered\b/i.test(q)
  ) {
    return { text: formatChecksText(entries, wiring, partsById, items) };
  }

  /* --- what is X plugged into --- */
  const query = /^what(?:'s| is| does)\s+(.+?)\s+(?:plugged into|connected to|wired to|hooked up to)\s*\??$/i.exec(q);
  if (query) {
    const r = resolvePhrase(query[1].trim());
    if ("error" in r) return { text: r.error };
    const byUid = portsByEntry(entries, partsById);
    const mine = resolveConnections(entries, wiring, partsById).filter(
      (c) => c.fromEntry === r.entry.uid || c.toEntry === r.entry.uid,
    );
    const ports = byUid.get(r.entry.uid) ?? [];
    if (!mine.length) {
      return {
        text:
          `${r.item.name} has no cables yet.` +
          (ports.length
            ? ` Its recorded ports: ${ports.map((p) => p.label).join(" · ")}.`
            : ` It has no ports — ${noPortReason(r.entry, partsById)}.`) +
          " The wiring view is on the Kit page (Wiring toggle).",
      };
    }
    const lines = mine.map((c) => {
      const outbound = c.fromEntry === r.entry.uid;
      const otherUid = outbound ? c.toEntry : c.fromEntry;
      const other = entries.find((e) => e.uid === otherUid);
      const otherPorts = byUid.get(otherUid) ?? [];
      const myPort = (outbound
        ? byUid.get(c.fromEntry)?.find((p) => p.id === c.fromPort)
        : byUid.get(c.toEntry)?.find((p) => p.id === c.toPort))?.label;
      const otherPort = (outbound
        ? otherPorts.find((p) => p.id === c.toPort)
        : otherPorts.find((p) => p.id === c.fromPort))?.label;
      return `- ${myPort} → ${other ? nameOf(other) : otherUid} [${otherPort}] (${c.type})`;
    });
    return {
      text: `${r.item.name} is wired:\n${lines.join("\n")}`,
    };
  }

  /* --- disconnect --- */
  const disc = /^(disconnect|unwire|unplug|detach)\s+(.+)$/i.exec(q);
  if (disc) {
    const rest = disc[2].trim();
    const pair = /^(.+?)\s+from\s+(.+)$/i.exec(rest);
    if (pair) {
      const a = resolvePhrase(pair[1].trim());
      if ("error" in a) return { text: a.error };
      const b = resolvePhrase(pair[2].trim());
      if ("error" in b) return { text: b.error };
      const resolved = resolveConnections(entries, wiring, partsById);
      const kept = resolved.filter(
        (c) =>
          !(
            (c.fromEntry === a.entry.uid && c.toEntry === b.entry.uid) ||
            (c.fromEntry === b.entry.uid && c.toEntry === a.entry.uid)
          ),
      );
      const removed = resolved.length - kept.length;
      if (!removed) {
        return {
          text: `${a.item.name} and ${b.item.name} aren't wired together — nothing to disconnect.`,
        };
      }
      return {
        text: `Disconnected ${a.item.name} from ${b.item.name} — removed ${removed} cable${removed === 1 ? "" : "s"}.`,
        wiring: { connections: kept },
      };
    }
    const r = resolvePhrase(rest);
    if ("error" in r) return { text: r.error };
    const { wiring: next, removed } = disconnectEntry(
      { connections: resolveConnections(entries, wiring, partsById) },
      r.entry.uid,
    );
    if (!removed) {
      return { text: `${r.item.name} has no cables to disconnect.` };
    }
    return {
      text: `Disconnected ${r.item.name} — removed ${removed} cable${removed === 1 ? "" : "s"}.`,
      wiring: next,
    };
  }

  /* --- wire / connect --- */
  const wire =
    /^(wire|connect|hook up)\s+(.+?)\s+(?:to|into)\s+(.+)$/i.exec(q) ||
    /^plug\s+(.+?)\s+into\s+(.+)$/i.exec(q);
  if (wire) {
    const aPhrase = wire[2].trim();
    let bPhrase = wire[3].trim();
    let busHint: string | null = null;
    const hint = /\s+(?:over|via|with|using)\s+([a-z0-9]+)$/i.exec(bPhrase);
    if (hint) {
      busHint = hint[1].toLowerCase();
      bPhrase = bPhrase.slice(0, hint.index).trim();
    }
    const a = resolvePhrase(aPhrase);
    if ("error" in a) return { text: a.error };
    const b = resolvePhrase(bPhrase);
    if ("error" in b) return { text: b.error };
    if (a.entry.uid === b.entry.uid) {
      return { text: "That's the same part twice — wiring joins two different parts in your build." };
    }
    const byUid = portsByEntry(entries, partsById);
    const aPorts = byUid.get(a.entry.uid) ?? [];
    const bPorts = byUid.get(b.entry.uid) ?? [];
    if (!aPorts.length || !bPorts.length) {
      const which = !aPorts.length ? a : b;
      const entry = !aPorts.length ? a.entry : b.entry;
      return {
        text: `${which.item.name} can't be wired — ${noPortReason(entry, partsById)}.`,
      };
    }
    let pairs = compatiblePairs(aPorts, bPorts);
    if (busHint) {
      pairs = pairs.filter(
        (p) => p.a.bus === busHint || p.b.bus === busHint || p.a.type === busHint,
      );
    }
    if (!pairs.length) {
      return {
        text:
          `No compatible ports between ${a.item.name} and ${b.item.name}. ` +
          `${a.item.name} has: ${aPorts.map((p) => p.label).join(" · ")}. ` +
          `${b.item.name} has: ${bPorts.map((p) => p.label).join(" · ")}.`,
      };
    }
    if (pairs.length > 1) {
      return {
        text:
          `${a.item.name} and ${b.item.name} can connect more than one way — ` +
          pairs
            .map((p) => `${p.a.label} ↔ ${p.b.label}`)
            .join(" · ") +
          `. Name the bus (e.g. “wire ${aPhrase} to ${bPhrase} over ${pairs[0].a.bus}”) or use the Wiring view on the Kit page.`,
      };
    }
    const pair = pairs[0];
    const added = addConnection(
      entries,
      wiring,
      partsById,
      a.entry.uid,
      pair.a.id,
      b.entry.uid,
      pair.b.id,
      makeId,
    );
    if (!added.ok) return { text: `Not wired: ${added.error}.` };
    return {
      text:
        `Wired ${a.item.name} → ${b.item.name}: ${pair.a.label} ↔ ${pair.b.label} (${pair.a.type}). ` +
        "See it in the Wiring view on the Kit page.",
      wiring: added.wiring,
    };
  }

  return null;
}
