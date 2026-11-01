/* Living Build Stage — the animation capability map.
 *
 * Every motion the stage may show is derived here, from recorded
 * data only: catalog/stage-animation.json (URDF joints parsed from
 * each robot's official URDF at the pinned commit the physics
 * checks record, plus each robot's recorded spec — drivetrain,
 * wheel, rotors, sensor entries) and the catalogue parts' recorded
 * specs. A motion with no recorded support does not exist in this
 * map; instead the map names the abstention and its reason, and
 * the stage renders nothing for it.
 *
 * Safety rule for articulated joints: a sway/travel amplitude is a
 * SAFE SUBSET of the recorded limits around the zero pose —
 * SWAY_FRACTION of the nearer limit — and a joint whose recorded
 * limits do not include the zero pose gets no track at all (the
 * URDF zero is a reference pose, not necessarily a legal one:
 * the Unitree Go2's calf joints record [-2.72, -0.84] rad).
 *
 * This module is pure (data in, map out) so the Python suite can
 * run it in node against the real catalogue, like the palette and
 * BOM modules. It makes no network calls and reads no storage:
 * animation can never touch the Worker or the demo isolation. */

export const SWAY_FRACTION = 0.25;

export interface StageJoint {
  name: string;
  type: string;
  axis: number[] | null;
  limit: { lower?: number; upper?: number } | null;
  child_link: string | null;
}

export interface StageSensor {
  kind: string;
  position?: string;
  range_m?: number | null;
}

export interface StageWiringNode {
  id: string;
  label: string;
  req_label?: string;
  rated_max_v?: number | null;
}

export interface StageWiringConnection {
  from: string;
  to: string;
  kind: string;
  volts?: number | null;
  label?: string;
}

export interface StageWiring {
  note?: string;
  nodes: StageWiringNode[];
  connections: StageWiringConnection[];
}

export interface StageRobotRecord {
  name: string;
  mobility_class?: string;
  physics_status: string;
  physics_reason?: string;
  spec: {
    drivetrain?: string | null;
    wheel?: { count?: number; diameter_m?: number; driven?: boolean } | null;
    rotors?: { count?: number; prop_diameter_m?: number } | null;
    motor?: { count?: number; kind?: string } | null;
    sensors: StageSensor[];
    wiring?: StageWiring | null;
  };
  urdf: {
    source_label?: string;
    urdf_url?: string;
    joints: StageJoint[];
  } | null;
}

export interface StageDoc {
  robots: Record<string, StageRobotRecord>;
}

export interface SwayJoint {
  name: string;
  axis: number[] | null;
  lower: number;
  upper: number;
  /** Peak excursion from the zero pose, radians (or metres for
   *  prismatic travel). Guaranteed: [-amplitude, +amplitude]
   *  lies inside [lower, upper]. */
  amplitude: number;
}

export type TrackKind = "spin" | "sweep" | "sway" | "travel" | "hover" | "blink";

export interface AnimTrack {
  kind: TrackKind;
  /** What moves: "wheels", "lidar", "rotors", a joint set… */
  target: string;
  /** The recorded fact that licenses this motion. */
  source: string;
  joints?: SwayJoint[];
  rangeM?: number | null;
}

export interface SensorOverlay {
  kind: string;
  position: string | null;
  rangeM: number | null;
  /** True only when everything the drawing needs is recorded. */
  drawable: boolean;
  /** Why nothing is drawn, when drawable is false. */
  reason?: string;
}

export interface Abstention {
  subject: string;
  reason: string;
}

export interface Capability {
  tracks: AnimTrack[];
  overlays: SensorOverlay[];
  abstentions: Abstention[];
}

/* The amplitude a joint may sway by around the zero pose, or null
 * when the recorded limits give no safe subset: limits missing,
 * or the zero pose outside the recorded range. */
export function safeAmplitude(joint: StageJoint): number | null {
  const lim = joint.limit;
  if (!lim || lim.lower === undefined || lim.upper === undefined) return null;
  if (!(lim.lower < 0 && lim.upper > 0)) return null;
  return SWAY_FRACTION * Math.min(lim.upper, -lim.lower);
}

/** The sway angle at a phase — bounded by construction. */
export function swayAt(amplitude: number, phase: number): number {
  return amplitude * Math.sin(phase);
}

function articulated(
  joints: StageJoint[],
  type: "revolute" | "prismatic",
): { ok: SwayJoint[]; excluded: StageJoint[] } {
  const ok: SwayJoint[] = [];
  const excluded: StageJoint[] = [];
  for (const j of joints) {
    if (j.type !== type) continue;
    const amp = safeAmplitude(j);
    if (amp === null) excluded.push(j);
    else
      ok.push({
        name: j.name,
        axis: j.axis,
        lower: j.limit!.lower!,
        upper: j.limit!.upper!,
        amplitude: amp,
      });
  }
  return { ok, excluded };
}

function sensorOverlays(sensors: StageSensor[]): SensorOverlay[] {
  return sensors.map((s) => {
    const base = {
      kind: s.kind,
      position: s.position ?? null,
      rangeM: s.range_m ?? null,
    };
    if (s.kind === "lidar_2d") {
      return s.range_m != null
        ? { ...base, drawable: true }
        : {
            ...base,
            drawable: false,
            reason: "the spec records the lidar but no range — no sweep is drawn at an invented radius",
          };
    }
    if (s.kind === "rgb_camera" || s.kind === "depth_camera" || s.kind === "rgbd_camera") {
      return {
        ...base,
        drawable: false,
        reason: "field of view is not recorded — no frustum is drawn at an invented angle",
      };
    }
    if (s.kind === "ultrasonic") {
      return {
        ...base,
        drawable: false,
        reason: "cone angle is not recorded — no cone is drawn at an invented angle",
      };
    }
    return {
      ...base,
      drawable: false,
      reason: "an internal sensor — it records no external field to draw",
    };
  });
}

/** One robot's animation capability, from its recorded stage data. */
export function robotCapability(rec: StageRobotRecord): Capability {
  const tracks: AnimTrack[] = [];
  const abstentions: Abstention[] = [];
  const joints = rec.urdf?.joints ?? [];
  const spec = rec.spec;

  /* Continuous joints: the URDF's own word for "spins freely". */
  const continuous = joints.filter((j) => j.type === "continuous");
  const wheelJoints = continuous.filter((j) => /wheel/i.test(j.name));
  if (wheelJoints.length) {
    tracks.push({
      kind: "spin",
      target: "wheels",
      source: `URDF continuous joints: ${wheelJoints.map((j) => j.name).join(", ")}`,
      joints: wheelJoints.map((j) => ({
        name: j.name,
        axis: j.axis,
        lower: -Infinity,
        upper: Infinity,
        amplitude: Infinity,
      })),
    });
  } else if (spec.wheel?.driven) {
    tracks.push({
      kind: "spin",
      target: "wheels",
      source: `spec wheel record: ${spec.wheel.count ?? "?"} driven wheel(s), ${spec.wheel.diameter_m ?? "?"} m diameter`,
    });
  }
  for (const j of continuous) {
    if (!/wheel/i.test(j.name)) {
      tracks.push({
        kind: "spin",
        target: j.name,
        source: `URDF continuous joint: ${j.name}`,
      });
    }
  }

  /* Rotors + hover for the aerial frames, from the spec's rotor
   * record — never from the airframe's looks. */
  if (spec.rotors?.count) {
    tracks.push({
      kind: "spin",
      target: "rotors",
      source: `spec rotors record: ${spec.rotors.count} rotors, ${spec.rotors.prop_diameter_m ?? "?"} m propellers`,
    });
    tracks.push({
      kind: "hover",
      target: "airframe",
      source: `spec drivetrain: ${spec.drivetrain ?? "multirotor"} — a hovering frame bobs; the bob is illustrative`,
    });
  }

  /* A 2D lidar scans by rotating — that is what the recorded kind
   * means. The URDF mount joint is fixed (the Burger's scan_joint
   * is), so this track is licensed by the spec's sensor entry,
   * never by a joint the model does not have. */
  const lidar = spec.sensors.find((s) => s.kind === "lidar_2d");
  if (lidar) {
    tracks.push({
      kind: "sweep",
      target: "lidar",
      source: `spec sensors: lidar_2d at ${lidar.position ?? "an unrecorded position"}`,
      rangeM: lidar.range_m ?? null,
    });
  }

  /* Articulated joints: sway/travel inside a safe subset of the
   * recorded limits, or an explicit abstention per excluded set. */
  if (rec.urdf) {
    const rev = articulated(joints, "revolute");
    if (rev.ok.length) {
      tracks.push({
        kind: "sway",
        target: "joints",
        source: `URDF revolute joints, amplitude capped at ${SWAY_FRACTION}× the nearer recorded limit around the zero pose`,
        joints: rev.ok,
      });
    }
    if (rev.excluded.length) {
      abstentions.push({
        subject: `revolute joints: ${rev.excluded.map((j) => j.name).join(", ")}`,
        reason:
          "their recorded limits do not include the zero pose (or record no limits) — no sway is invented for them",
      });
    }
    const pri = articulated(joints, "prismatic");
    if (pri.ok.length) {
      tracks.push({
        kind: "travel",
        target: "joints",
        source: `URDF prismatic joints, travel capped at ${SWAY_FRACTION}× the nearer recorded limit around the zero pose`,
        joints: pri.ok,
      });
    }
    if (pri.excluded.length) {
      abstentions.push({
        subject: `prismatic joints: ${pri.excluded.map((j) => j.name).join(", ")}`,
        reason:
          "their recorded limits do not include the zero pose (or record no limits) — no travel is invented for them",
      });
    }
    if (!continuous.length && !rev.ok.length && !pri.ok.length && !spec.rotors?.count) {
      abstentions.push({
        subject: "joint motion",
        reason:
          "the recorded URDF's joints are all fixed — the model is a single rigid body, so nothing articulates",
      });
    }
  } else {
    abstentions.push({
      subject: "joint motion",
      reason: rec.physics_reason ?? "no URDF is recorded for this robot",
    });
  }

  return { tracks, overlays: sensorOverlays(spec.sensors), abstentions };
}

/* ------------------------------------------------ catalogue parts */

export interface PartLike {
  id: string;
  name: string;
  part_class: string;
  specs: Record<string, unknown>;
}

const BOARD_CLASSES = new Set([
  "sbc",
  "microcontrollers",
  "flight_control",
  "custom_boards",
]);

/** One catalogue part's animation capability, from its recorded
 *  specs. Most parts honestly get nothing — a battery does not
 *  move — and the map says so per part. */
export function partCapability(part: PartLike): Capability {
  const tracks: AnimTrack[] = [];
  const abstentions: Abstention[] = [];
  const specs = part.specs || {};
  const kind = typeof specs.kind === "string" ? specs.kind : null;

  if (part.part_class === "wheels" && specs.diameter_m != null) {
    tracks.push({
      kind: "spin",
      target: part.name,
      source: `catalogue specs: wheel, ${specs.diameter_m} m diameter`,
    });
  }
  if (part.part_class === "propulsion_air") {
    tracks.push({
      kind: "spin",
      target: part.name,
      source: `catalogue specs: propeller, ${specs.blades ?? "?"} blades, ${specs.diameter_in ?? "?"} in`,
    });
  }
  if (kind === "lidar_2d") {
    tracks.push({
      kind: "sweep",
      target: part.name,
      source: "catalogue specs: kind lidar_2d — a scanning lidar rotates",
      rangeM: typeof specs.range_m === "number" ? specs.range_m : null,
    });
  }
  if (kind === "dc_gearmotor" || kind === "dc_brushed" || kind === "brushless_outrunner" || kind === "stepper") {
    tracks.push({
      kind: "spin",
      target: `${part.name} (shaft)`,
      source: `catalogue specs: kind ${kind} — its shaft rotates`,
    });
  }
  if (kind === "servo_positional" || kind === "servo_serial_bus") {
    abstentions.push({
      subject: part.name,
      reason: "a positional servo, but the catalogue records no travel range for it — no sway is invented",
    });
  }
  if (BOARD_CLASSES.has(part.part_class)) {
    tracks.push({
      kind: "blink",
      target: `${part.name} (status LED)`,
      source: `catalogue class ${part.part_class}: an electronic board — its status light blinks`,
    });
  }
  const overlays = sensorOverlays(
    kind && part.part_class === "cameras_sensors"
      ? [{ kind, range_m: typeof specs.range_m === "number" ? specs.range_m : null }]
      : [],
  );
  return { tracks, overlays, abstentions };
}

/** A SimReady bench prop: the manifest records size, license and
 *  attribution — no motion data — so props never animate. */
export function propCapability(prop: { id: string; name: string }): Capability {
  return {
    tracks: [],
    overlays: [],
    abstentions: [
      {
        subject: prop.name,
        reason: "a bench prop — the SimReady manifest records its size and license, no motion data, so it stays static",
      },
    ],
  };
}

/* ------------------------------------------------ electrical flow */

/** The flow label shown beside the Flow toggle, verbatim. */
export const FLOW_LABEL =
  "Flow view — shows the recorded design's power/data paths; not a circuit simulation";

export interface FlowPath {
  from: string;
  to: string;
  kind: string;
  /** The recorded voltage on this connection, or null when the
   *  data records none. There is deliberately no current field:
   *  no source records amps per connection, so none is shown. */
  volts: number | null;
  label: string | null;
  color: string;
  /** Pulse cycles per second at 1× stage speed — a visualization
   *  mapping keyed ONLY to the recorded volts / interface label,
   *  or the neutral default. It is not a physical rate. */
  pulsePerSec: number;
  /** 0..1 pulse brightness, same mapping discipline as the rate. */
  intensity: number;
  /** The recorded fact the styling came from. */
  basis: string;
}

/** Style for one recorded connection. Power is amber, data is
 *  blue (the app's wiring colors); anything else is neutral grey.
 *  Rate/intensity move only with recorded values: a power pulse
 *  runs faster/brighter the higher its recorded voltage, a data
 *  pulse labelled PWM runs at the fast neutral, and an unrecorded
 *  connection gets the plain neutral default. */
export function flowStyle(
  kind: string,
  volts: number | null,
  label: string | null,
): { color: string; pulsePerSec: number; intensity: number; basis: string } {
  if (kind === "power") {
    if (volts != null) {
      const k = Math.min(volts, 50) / 50;
      return {
        color: "#f59e0b",
        pulsePerSec: 0.45 + k * 0.75,
        intensity: 0.7 + k * 0.3,
        basis: `recorded ${volts} V power connection`,
      };
    }
    return {
      color: "#f59e0b",
      pulsePerSec: 0.45,
      intensity: 0.7,
      basis: "power connection, voltage not recorded — neutral pace",
    };
  }
  if (kind === "data" || kind === "signal") {
    if (label && /pwm/i.test(label)) {
      return {
        color: "#38bdf8",
        pulsePerSec: 1.1,
        intensity: 0.85,
        basis: "recorded interface label: PWM",
      };
    }
    return {
      color: "#38bdf8",
      pulsePerSec: 0.6,
      intensity: 0.75,
      basis: "data connection, interface rate not recorded — neutral pace",
    };
  }
  return {
    color: "#9aa3ad",
    pulsePerSec: 0.5,
    intensity: 0.6,
    basis: "connection kind not recorded as power or data — neutral",
  };
}

/** The flow paths of one robot's recorded spec wiring. No wiring
 *  block recorded → no paths (Go2 and G1 record none). */
export function flowPaths(rec: StageRobotRecord): FlowPath[] {
  const w = rec.spec.wiring;
  if (!w) return [];
  return w.connections.map((c) => {
    const style = flowStyle(c.kind, c.volts ?? null, c.label ?? null);
    return {
      from: c.from,
      to: c.to,
      kind: c.kind,
      volts: c.volts ?? null,
      label: c.label ?? null,
      ...style,
    };
  });
}

/* The PR #70 build-list wiring graph (rf.wiring.v1) is read here
 * READ-ONLY and defensively: this module does not import that
 * branch's code, it only recognizes the stored shape
 * ({connections: [{fromEntry, fromPort, toEntry, toPort, type}]})
 * so the stage can report what a visitor's own build wiring holds.
 * Anything else parses to null — degrade, never guess. */
export interface StoredWiringSummary {
  total: number;
  power: number;
  data: number;
  signal: number;
  other: number;
}

export function parseStoredWiringGraph(raw: unknown): StoredWiringSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const conns = (raw as { connections?: unknown }).connections;
  if (!Array.isArray(conns)) return null;
  const out: StoredWiringSummary = { total: 0, power: 0, data: 0, signal: 0, other: 0 };
  for (const c of conns) {
    if (!c || typeof c !== "object") return null;
    const o = c as Record<string, unknown>;
    if (
      typeof o.fromEntry !== "string" ||
      typeof o.toEntry !== "string" ||
      typeof o.fromPort !== "string" ||
      typeof o.toPort !== "string" ||
      typeof o.type !== "string"
    ) {
      return null;
    }
    out.total += 1;
    if (o.type === "power") out.power += 1;
    else if (o.type === "data") out.data += 1;
    else if (o.type === "signal") out.signal += 1;
    else out.other += 1;
  }
  return out;
}

/** The storage key PR #70's store resolves (its demo twin while
 *  the demo flag is set) — mirrored here as a string so this
 *  branch needs none of that branch's code. */
export function storedWiringKey(demoOn: boolean): string {
  return demoOn ? "rf.wiring.v1.demo" : "rf.wiring.v1";
}

/* ------------------------------------------------ stage controls */

/** Speeds the stage offers, slowest to fastest. */
export const STAGE_SPEEDS = [0.5, 1, 2] as const;
export type StageSpeed = (typeof STAGE_SPEEDS)[number];

export interface StageControls {
  motion: boolean;
  sensors: boolean;
  flow: boolean;
  playing: boolean;
  speed: StageSpeed;
}

/** Initial control state. prefers-reduced-motion starts paused —
 *  the stage says why, next to the controls. */
export function initialControls(prefersReducedMotion: boolean): StageControls {
  return { motion: true, sensors: true, flow: true, playing: !prefersReducedMotion, speed: 1 };
}

/** Whether the stage clock actually advances this frame. Motion
 *  pauses in Wiring mode (the wiring layer owns the stage there),
 *  when the tab is hidden, and when the stage is scrolled away. */
export function effectivePlaying(args: {
  controls: StageControls;
  wiringMode: boolean;
  tabHidden: boolean;
  onScreen: boolean;
}): boolean {
  return (
    args.controls.motion &&
    args.controls.playing &&
    !args.wiringMode &&
    !args.tabHidden &&
    args.onScreen
  );
}

/** Whether flow pulses advance. Flow is its own layer: it obeys
 *  play/pause, visibility and Wiring mode, but not the Motion
 *  toggle — a still robot can still show its recorded power and
 *  data paths moving. */
export function effectiveFlowPlaying(args: {
  controls: StageControls;
  wiringMode: boolean;
  tabHidden: boolean;
  onScreen: boolean;
}): boolean {
  return (
    args.controls.flow &&
    args.controls.playing &&
    !args.wiringMode &&
    !args.tabHidden &&
    args.onScreen
  );
}

/** The honesty label shown beside the stage controls, verbatim. */
export const STAGE_HONESTY_LABEL =
  "Animated preview — motion is illustrative; the functional twin (physics + controls + telemetry) is the next layer.";
