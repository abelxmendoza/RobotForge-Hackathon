/* Wrench adds a board from plain words (Abel, 2026-11-23):
 * "add an STM32 for the motors to my Jetson robot",
 * "connect an ESP32 over I2C", "add an Arduino Mega via UART".
 *
 * Pure: the caller passes the robot's spec and the catalogue parts
 * (catalog/parts.json), so node runs it in tests/test_board_add.py.
 *
 * - parseBoardAdd(): the words -> which catalogue board, its job
 *   ("motors"), the bus if one was named, and a hint for the board it
 *   talks to ("my Jetson robot"). Raspberry Pi 4/5 asks are left to
 *   the coordinated upgrade flow (lib/upgradeRequest.ts), and build
 *   list asks ("to my build") to lib/buildRequest.
 * - planBoardAdd(): the spec's wiring with the new board node and its
 *   data link, a level shifter when a 3.3 V / 5 V signal link needs
 *   one, and the same logic and ground checks the Wire tab shows
 *   (lib/boardLinks.ts). Nothing is saved here. */
import { boardChain, isBoard, logicLevelChecks, type LinkWiring, type LogicCheck } from './boardLinks';

type Rec = { [k: string]: unknown };
export interface BoardPart { id: string; name: string; part_class: string; specs?: Rec }
export interface BoardAddAsk { partId: string; role: string | null; bus: string | null; hostHint: string | null }

/* Most specific first: "jetson orin nano" before "jetson", "arduino
 * nano" before "nano", "esp32-s3" before "esp32". */
const ALIASES: [RegExp, string][] = [
  [/\b(?:stm32\s*)?nucleo\b/, 'stm32_nucleo_f446re'],
  [/\b(?:stm32\s*)?black ?pill\b/, 'stm32_black_pill_f411'],
  [/\b(?:stm32\s*)?blue ?pill\b/, 'stm32_blue_pill'],
  [/\bstm32\b/, 'stm32_blue_pill'],
  [/\besp32[- ]?s3\b/, 'esp32_s3_devkit'],
  [/\besp32[- ]?c3\b/, 'esp32_c3_devkit'],
  [/\b(?:esp8266|nodemcu)\b/, 'esp8266_nodemcu'],
  [/\besp32\b/, 'esp32_devkit'],
  [/\b(?:arduino\s+)?mega(?:\s*2560)?\b/, 'arduino_mega_2560'],
  [/\barduino\s+nano\b/, 'arduino_nano'],
  [/\b(?:arduino(?:\s+uno)?|uno)\b/, 'arduino_uno_r3'],
  [/\bxiao\b/, 'xiao_rp2040'],
  [/\bpico\s*w\b/, 'pico_w'],
  [/\b(?:raspberry\s+pi\s+)?pico\b|\brp2040\b/, 'pico_rp2040'],
  [/\bteensy\b/, 'teensy_41'],
  [/\bjetson\s+orin\b|\borin\s+nano\b/, 'jetson_orin_nano'],
  [/\bjetson\s+nano\b/, 'jetson_nano'],
  [/\bjetson\b/, 'jetson_orin_nano'],
];

const BUSES: [RegExp, string][] = [
  [/\b(?:uart|serial|tx\/?rx)\b/, 'uart'], [/\bi2c\b|\bi²c\b/, 'i2c'], [/\bspi\b/, 'spi'],
  [/\busb\b/, 'usb'], [/\bcan(?:\s*bus)?\b/, 'can'], [/\b(?:ethernet|lan)\b/, 'ethernet'],
];
const BUS_LABEL: Record<string, string> = { uart: 'UART', i2c: 'I2C', spi: 'SPI', usb: 'USB', can: 'CAN', ethernet: 'Ethernet' };
const SIGNAL = new Set(['uart', 'i2c', 'spi', 'gpio', 'pwm']);

const VERB = /^(?:wrench[,:]?\s+)?(?:please\s+)?(?:can you\s+|could you\s+|let'?s\s+|i want to\s+|i'd like to\s+)?(?:add|connect|hook up|wire in|wire up|put)\s+(?:a |an |another |one )?/i;

export function parseBoardAdd(text: string): BoardAddAsk | null {
  const raw = text.trim();
  if (!raw || raw.endsWith('?') || raw.includes('"') || !VERB.test(raw)) return null;
  const q = raw.replace(VERB, '').replace(/[.!]+$/, '').toLowerCase();
  /* "… to my build / build list / parts / cart" is the build list. */
  if (/\b(?:build(?:\s+list)?|parts(?:\s+list)?|inventory|cart|bom)\b\s*$/.test(q)) return null;
  /* What is being added: the words before " to/on/for/over/via …". */
  const head = q.split(/\s+(?:to|on|onto|into|for|over|via|using|by|with|that|which|so)\s+/)[0];
  if (/\braspberry\s+pi\b(?!\s+pico)|\brpi\b|\bpi\s*[0-9]/.test(head)) return null;
  const hit = ALIASES.find(([re]) => re.test(head));
  if (!hit) return null;
  const bus = BUSES.find(([re]) => re.test(q.slice(head.length)))?.[1] ?? null;
  const role = q.match(/\bfor\s+(?:the\s+|its\s+|my\s+)?([a-z0-9][a-z0-9 /-]{1,30}?)(?=\s+(?:to|on|over|via|using|in)\s|$)/)?.[1]?.trim() ?? null;
  const hostHint = q.match(/\b(?:to|on|onto|into|with)\s+(?:the\s+|my\s+|this\s+)?([a-z0-9][a-z0-9 .-]{1,40})$/)?.[1]?.trim() ?? null;
  return { partId: hit[1], role, bus, hostHint };
}

/* ---------------- the plan ---------------- */

export interface BoardAddPlan {
  partId: string;
  partName: string;
  hostId: string | null;
  hostLabel: string | null;
  bus: string | null;
  shifted: boolean;
  /** The spec with the new wiring; the caller saves it as a version. */
  spec: Rec;
  /** One line per thing that changes, for the card. */
  changes: string[];
  /** Things still to decide; never blocking on their own. */
  todo: string[];
  checks: LogicCheck[];
  chainBefore: string;
  chainAfter: string;
}

const levels = (raw: unknown): number[] => (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map(Number).filter((v) => Number.isFinite(v) && v > 0);
const isSbc = (n: Rec | undefined) => /jetson|raspberry pi(?!\s+pico)|\bpi\s*[0-9]|single-board|\bsbc\b/i.test(String(n?.label ?? '')) || /brain|computer/i.test(String(n?.role ?? ''));
const short = (label: string) => label.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+(?:developer kit|development board|dev ?kit|board)\b.*$/i, '').trim();

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}${i}`;
  return id;
}

export function planBoardAdd(spec: Rec, ask: BoardAddAsk, parts: BoardPart[]): BoardAddPlan {
  const part = parts.find((p) => p.id === ask.partId);
  if (!part) throw new Error('That board is not in the parts catalogue yet.');
  const ps = (part.specs ?? {}) as Rec;
  const next = JSON.parse(JSON.stringify(spec ?? {})) as Rec;
  const w0 = next.wiring as Rec | undefined;
  const wiring = {
    ...(w0 ?? {}),
    nodes: Array.isArray(w0?.nodes) ? (w0!.nodes as Rec[]) : [],
    connections: Array.isArray(w0?.connections) ? (w0!.connections as Rec[]) : [],
  };
  const before = boardChain(wiring as unknown as LinkWiring);
  const taken = new Set(wiring.nodes.map((n) => String(n.id)));
  const newId = uniqueId(ask.partId.split('_')[0].replace(/[^a-z0-9]/g, '') || 'board', taken);
  const partLogic = levels(ps.logic_v);
  const partIfaces = Array.isArray(ps.interfaces) ? (ps.interfaces as string[]) : [];

  /* The board it talks to: the one the words name, else the main
   * computer (a Jetson or Pi), else the only board there is. */
  const boards = wiring.nodes.filter((n) => isBoard(n as never));
  const hint = ask.hostHint?.replace(/\b(?:robot|rover|rig|bot|build|one)\b/g, '').trim();
  /* Most hint words matched wins ("arduino mega" beats an Uno that
   * only shares "arduino"); a tie between boards is asked, not guessed. */
  const words = hint ? hint.split(/\s+/).filter((t) => t.length > 2) : [];
  const score = (n: Rec) => words.filter((t) => String(n.label).toLowerCase().includes(t)).length;
  const top = words.length ? Math.max(0, ...boards.map(score)) : 0;
  const named = top > 0 ? boards.filter((n) => score(n) === top) : [];
  const ambiguous = named.length > 1;
  const host = ambiguous ? undefined : named[0] ?? boards.find((n) => isSbc(n)) ?? (boards.length === 1 ? boards[0] : undefined);

  const node: Rec = {
    deck: true, id: newId, kit: null, label: part.name, rated_max_v: null,
    req_label: partLogic.length ? `${partLogic.join('/')} V logic` : 'logic level not recorded',
    board: true, role: ask.role ?? (isSbc(host) || !host ? 'controller' : 'helper'),
    ...(partLogic.length ? { logic_v: partLogic.length === 1 ? partLogic[0] : partLogic } : {}),
    ...(ps.five_v_tolerant ? { five_v_tolerant: ps.five_v_tolerant } : {}),
  };
  wiring.nodes = [...wiring.nodes, node];
  const changes = [`Add ${part.name}${ask.role ? ` for ${ask.role}` : ''}.`];
  const todo: string[] = [];
  let bus: string | null = null;
  let shifted = false;

  if (!host) {
    todo.push(ambiguous ? `More than one board matches “${hint}”: say which, e.g. “connect it to the ${short(String(named[0].label))}”.` : boards.length ? `Which board does it talk to? Say “connect it to the ${short(String(boards[0].label))}”.` : 'No other board is recorded on this robot, so there is no link to plan yet.');
  } else {
    const hostLogic = levels(host.logic_v);
    /* The bigger computer drives the link: Jetson/Pi -> MCU. */
    const newIsSbc = part.part_class === 'sbc';
    const [from, to] = newIsSbc && !isSbc(host) ? [newId, String(host.id)] : [String(host.id), newId];
    bus = ask.bus ?? (isSbc(host) && newIsSbc ? 'ethernet' : isSbc(host) !== newIsSbc ? 'usb' : 'uart');
    /* The host's own interfaces, when its label names a catalogue board. */
    /* Starters shorten names ("Arduino Mega 2560" for "... Rev3
     * (ATmega2560)"), so match either way round, longest name first. */
    const hostLabel = short(String(host.label)).toLowerCase();
    const hostPart = parts.filter((p) => { const n = short(p.name).toLowerCase(); return n.length > 2 && (hostLabel.includes(n) || n.includes(hostLabel)); })
      .sort((a, b) => short(b.name).length - short(a.name).length)[0];
    const hostIfaces = Array.isArray(hostPart?.specs?.interfaces) ? (hostPart!.specs!.interfaces as string[]) : [];
    if (!hostIfaces.length) todo.push(`Check the ${short(String(host.label))} has ${BUS_LABEL[bus] ?? bus}: its ports aren't recorded here.`);
    for (const [ifaces, name] of [[partIfaces, part.name], [hostIfaces, String(host.label)]] as [string[], string][]) {
      if (ifaces.length && !ifaces.includes(bus)) todo.push(`The ${short(name)} has no ${BUS_LABEL[bus] ?? bus} of its own: it needs an adapter (a ${bus === 'can' ? 'CAN transceiver or HAT' : (BUS_LABEL[bus] ?? bus) + ' adapter'}).`);
    }
    const mismatch = SIGNAL.has(bus) && hostLogic.length > 0 && partLogic.length > 0 && !hostLogic.some((v) => partLogic.includes(v));
    const lowIsNew = mismatch && Math.max(...partLogic) < Math.max(...hostLogic);
    const tolerant = mismatch && Boolean(lowIsNew ? ps.five_v_tolerant : host.five_v_tolerant);
    const label = BUS_LABEL[bus] ?? bus.toUpperCase();
    if (mismatch && !tolerant) {
      shifted = true;
      const sid = uniqueId('shifter', new Set(wiring.nodes.map((n) => String(n.id))));
      const lo = Math.min(...hostLogic, ...partLogic), hi = Math.max(...hostLogic, ...partLogic);
      wiring.nodes = [...wiring.nodes, { deck: true, id: sid, kit: null, label: 'Logic level shifter, 4-channel (BSS138)', rated_max_v: null, req_label: `LV ${lo} V · HV ${hi} V`, logic_v: [lo, hi], level_shifter: true }];
      wiring.connections = [...wiring.connections,
        { from, kind: 'data', label: `${label} (${from === String(host.id) ? hostLogic[0] : partLogic[0]} V side)`, to: sid, volts: null, bus, ground_shared: true },
        { from: sid, kind: 'data', label: `${label} (${to === newId ? partLogic[0] : hostLogic[0]} V side)`, to, volts: null, bus, ground_shared: true }];
      changes.push(`Link it to the ${short(String(host.label))} over ${label}, through a level shifter (${lo} V ↔ ${hi} V).`);
    } else {
      wiring.connections = [...wiring.connections, { from, kind: 'data', label, to, volts: null, bus, ...(SIGNAL.has(bus) ? { ground_shared: true } : {}) }];
      changes.push(`Link it to the ${short(String(host.label))} over ${label}.`);
      if (tolerant) todo.push(`${short(lowIsNew ? part.name : String(host.label))} is 3.3 V but 5 V tolerant on some pins: wire the ${label} lines to those pins only.`);
    }
    if (SIGNAL.has(bus)) changes.push(`Tie GND between the ${short(String(host.label))} and the ${short(part.name)}.`);
    todo.push(bus === 'usb' ? `It can run on the USB cable's 5 V; give it its own supply if it drives anything heavy.` : `Power for the ${short(part.name)}: a 5 V rail or USB.`);
  }

  next.wiring = wiring;
  const checks = logicLevelChecks(wiring as unknown as LinkWiring).filter((c) => c.subject.includes(newId));
  return {
    partId: part.id, partName: part.name, hostId: host ? String(host.id) : null, hostLabel: host ? String(host.label) : null,
    bus, shifted, spec: next, changes, todo, checks, chainBefore: before, chainAfter: boardChain(wiring as unknown as LinkWiring),
  };
}
