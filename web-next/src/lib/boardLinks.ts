/* Robots with more than one board (Abel, 2026-11-23): a Jetson or a
 * Raspberry Pi talking to an STM32, ESP32 or Arduino, or several
 * microcontrollers talking to each other.
 *
 * Works on a spec's `wiring` block (lib/wiring.ts shape). Pure, zero
 * imports, so node runs it in tests/test_multi_board.py.
 *
 * - boardLinks(): the data cables between boards, directly or through
 *   one bridge part (a level shifter, a CAN transceiver, a USB-UART
 *   adapter), with the bus each one uses.
 * - boardChain(): the same links as one short line for the Workshop,
 *   e.g. "Jetson Orin Nano → USB → STM32 Nucleo".
 * - logicLevelChecks(): 3.3 V vs 5 V on signal wires (UART, I2C, SPI,
 *   GPIO, PWM), and a shared-ground reminder on board-to-board signal
 *   wires. Mirrors src/robotforge/harness.py's logic_levels check:
 *   a node's `logic_v` (number or list), a connection's
 *   `level_shifted: true` or a `level_shifter: true` node clears it.
 *   USB, CAN, Ethernet and CSI carry their own signalling, so they are
 *   not judged. Where `logic_v` is missing the check says so. */

type Rec = { [k: string]: unknown };
export interface LinkNode { id: string; label: string }
export interface LinkConn { from: string; to: string; kind: string; label?: string }
const rec = (o: object | undefined): Rec => (o ?? {}) as Rec;
export interface LinkWiring { nodes: LinkNode[]; connections: LinkConn[] }

export interface BoardLink {
  a: string;
  b: string;
  bus: string;
  /** Bridge node ids the link runs through (shifter, transceiver). */
  via: string[];
}

export interface LogicCheck {
  check: 'logic_levels' | 'shared_ground';
  subject: string;
  coverage: 'CHECKED' | 'NOT_CHECKED';
  severity: 'INFO' | 'WARN';
  detail: string;
  missing: string[];
}

const BOARD_RE = /\b(raspberry pi|rpi|pi [0-9]|pi zero|jetson|arduino|uno\b|nano\b|mega\b|esp32|esp8266|stm32|nucleo|blue pill|black pill|teensy|pico|rp2040|xiao|microcontroller|mcu\b|single-board computer|sbc\b|flight controller|pixhawk)/i;
/* Parts named after a board that are not one ("Raspberry Pi Camera"). */
const NOT_BOARD_RE = /(camera|lidar|sensor|imu|driver|motor|servo|battery|buck|regulator|converter|ultrasonic|sonar|display|screen)/i;
const BRIDGE_RE = /(level shift|logic level|transceiver|usb[- ]to[- ](uart|ttl|serial)|cp2102|ch340|ft232)/i;

/** A board: `board: true` or `role` on the node, else a board name in its label. */
export function isBoard(n: LinkNode | undefined): boolean {
  if (!n) return false;
  const r = rec(n);
  if (r.board === true) return true;
  if (r.board === false) return false;
  if (typeof r.role === 'string' && /brain|controller|computer|board/i.test(r.role)) return true;
  if (isBridge(n)) return false;
  const label = String(n.label || '');
  return BOARD_RE.test(label) && !NOT_BOARD_RE.test(label);
}

export function isBridge(n: LinkNode | undefined): boolean {
  if (!n) return false;
  return rec(n).level_shifter === true || BRIDGE_RE.test(String(n.label || ''));
}

/** The bus a data cable uses, from its `bus` field or its label. */
export function busOf(c: LinkConn): string {
  const bus = rec(c).bus;
  if (typeof bus === 'string' && bus) return bus.toLowerCase();
  const t = String(c.label || '').toLowerCase();
  if (/\busb\b/.test(t)) return 'usb';
  if (/\bcan\b/.test(t)) return 'can';
  if (/\bi2c\b|\bi²c\b/.test(t)) return 'i2c';
  if (/\bspi\b/.test(t)) return 'spi';
  if (/\buart\b|serial|\btx\b|\brx\b|ttl/.test(t)) return 'uart';
  if (/ethernet/.test(t)) return 'ethernet';
  if (/\bcsi\b/.test(t)) return 'csi';
  if (/pwm/.test(t)) return 'pwm';
  if (/gpio|direction|enable|step/.test(t)) return 'gpio';
  return 'data';
}

const BUS_LABEL: Record<string, string> = { usb: 'USB', can: 'CAN', i2c: 'I2C', spi: 'SPI', uart: 'UART', ethernet: 'Ethernet', csi: 'CSI', pwm: 'PWM', gpio: 'GPIO', data: 'data' };
export const busLabel = (bus: string) => BUS_LABEL[bus] ?? bus.toUpperCase();

/** Buses whose wires carry a board's raw logic level. */
const LOGIC_BUSES = new Set(['uart', 'i2c', 'spi', 'pwm', 'gpio']);

const short = (n: LinkNode | undefined, id: string) =>
  n ? String(n.label || id).split(' — ')[0].split(' (')[0] : id;

export function boardLinks(w: LinkWiring): BoardLink[] {
  const nodes = new Map(w.nodes.map((n) => [n.id, n]));
  const data = w.connections.filter((c) => c.kind !== 'power');
  const out: BoardLink[] = [];
  const seen = new Set<string>();
  const add = (a: string, b: string, bus: string, via: string[]) => {
    const key = [a, b].sort().join('|') + '|' + bus;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ a, b, bus, via });
  };
  for (const c of data) {
    const f = nodes.get(c.from), t = nodes.get(c.to);
    if (isBoard(f) && isBoard(t)) add(c.from, c.to, busOf(c), []);
  }
  /* Through one bridge: board — bridge — board. */
  for (const br of w.nodes.filter(isBridge)) {
    const ends = data
      .filter((c) => c.from === br.id || c.to === br.id)
      .map((c) => ({ other: c.from === br.id ? c.to : c.from, bus: busOf(c) }))
      .filter((e) => isBoard(nodes.get(e.other)));
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        if (ends[i].other !== ends[j].other) add(ends[i].other, ends[j].other, ends[i].bus !== 'data' ? ends[i].bus : ends[j].bus, [br.id]);
      }
    }
  }
  return out;
}

/** One short line: "Jetson Orin Nano → USB → STM32 Nucleo · Jetson → I2C → ESP32". Empty when fewer than two boards talk. */
export function boardChain(w: LinkWiring): string {
  const nodes = new Map(w.nodes.map((n) => [n.id, n]));
  return boardLinks(w)
    .map((l) => `${short(nodes.get(l.a), l.a)} → ${busLabel(l.bus)}${l.via.length ? ' (shifted)' : ''} → ${short(nodes.get(l.b), l.b)}`)
    .join(' · ');
}

function levels(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return list.map(Number).filter((v) => Number.isFinite(v) && v > 0);
}

function logicAt(node: LinkNode | undefined, conn: LinkConn, side: 'from' | 'to'): number[] {
  const c = rec(conn);
  if (c[`logic_v_${side}`] != null) return levels(c[`logic_v_${side}`]);
  const n = rec(node);
  const dirKey = side === 'from' ? 'logic_v_out' : 'logic_v_in';
  if (n[dirKey] != null) return levels(n[dirKey]);
  return levels(n.logic_v);
}

const fmt = (vs: number[]) => vs.map((v) => `${v} V`).join('/');

export function logicLevelChecks(w: LinkWiring): LogicCheck[] {
  const nodes = new Map(w.nodes.map((n) => [n.id, n]));
  const out: LogicCheck[] = [];
  for (const c of w.connections) {
    if (c.kind === 'power') continue;
    const bus = busOf(c);
    if (!LOGIC_BUSES.has(bus) && bus !== 'data') continue;
    const f = nodes.get(c.from), t = nodes.get(c.to);
    if (!f || !t) continue;
    const subject = `${c.from} → ${c.to}`;
    const a = logicAt(f, c, 'from'), b = logicAt(t, c, 'to');
    const missing = [...(a.length ? [] : [`${c.from}.logic_v`]), ...(b.length ? [] : [`${c.to}.logic_v`])];
    if (missing.length) {
      out.push({ check: 'logic_levels', subject, coverage: 'NOT_CHECKED', severity: 'INFO', missing, detail: 'Logic level not recorded on both ends.' });
    } else {
      const shifted = rec(c).level_shifted === true || rec(rec(c).cable as object | undefined).level_shifted === true || rec(f).level_shifter === true || rec(t).level_shifter === true;
      const clash = !a.some((v) => b.includes(v));
      const lowSide = Math.max(...a) < Math.max(...b) ? f : t;
      const tolerant = typeof rec(lowSide).five_v_tolerant === 'string' || rec(lowSide).five_v_tolerant === true;
      out.push({
        check: 'logic_levels', subject, coverage: 'CHECKED', missing: [],
        severity: clash && !shifted ? 'WARN' : 'INFO',
        detail: !clash ? `Both ends run ${fmt(a.filter((v) => b.includes(v)))} logic.`
          : shifted ? `${fmt(a)} to ${fmt(b)} through a recorded level shifter.`
          : tolerant ? `${fmt(a)} vs ${fmt(b)} with no level shifter. ${short(lowSide, lowSide.id)} is 5 V tolerant on some pins only: use one of those, or add a shifter.`
          : `${fmt(a)} vs ${fmt(b)} with no level shifter: a 3.3 V pin is not 5 V tolerant. Add a level shifter.`,
      });
    }
  }
  /* Shared ground: two boards on a signal wire need their grounds tied.
   * USB and CAN links carry or don't need it, so they are skipped. */
  for (const l of boardLinks(w)) {
    if (!LOGIC_BUSES.has(l.bus) && l.bus !== 'data') continue;
    const conns = w.connections.filter((c) => c.kind !== 'power' && [l.a, l.b, ...l.via].includes(c.from) && [l.a, l.b, ...l.via].includes(c.to));
    /* Every segment must record it: through a shifter, one tied side
     * says nothing about the other board. */
    const tied = conns.length > 0 && conns.every((c) => rec(c).ground_shared === true);
    out.push({
      check: 'shared_ground', subject: `${l.a} ↔ ${l.b}`,
      coverage: tied ? 'CHECKED' : 'NOT_CHECKED', severity: 'INFO',
      missing: tied ? [] : ['connection.ground_shared'],
      detail: tied ? 'Grounds recorded as tied.' : `Tie GND between ${short(nodes.get(l.a), l.a)} and ${short(nodes.get(l.b), l.b)}; a ${busLabel(l.bus)} link without a shared ground reads garbage.`,
    });
  }
  return out;
}
