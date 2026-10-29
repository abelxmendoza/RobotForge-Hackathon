/* Take-apart derivation, ported line-for-line from assets/js/robot.js
   (which mirrors src/robotforge/cad.py): geometry, part prose and the
   electrical-overlay logic come from the spec's own numbers only.
   Kit assumption sizes are the kit's, labeled as such in the prose. */

export const PLATE_T = 0.004;        // kit assumption (cad.py PLATE_THICKNESS_MM)
export const LIDAR_DISC_D = 0.070;   // kit assumption (cad.py LIDAR_DISC_D_MM)
export const POST_D = 0.012;         // kit assumption (cad.py POST_D_MM)
export const CAM_W = 0.044, CAM_H = 0.034;   // kit assumptions (camera bracket)
export const ULTRA_H = 0.020, ULTRA_CAN_D = 0.016;  // kit assumptions (ultrasonic)

/* parts with an illustration in assets/img/parts/<id>.jpg */
export const TA_SPOTS = ["plate", "wheel", "mount", "caster", "lidar", "camera", "ultrasonic"];

export const mm = (m: number): number => Math.round(m * 1000);

/* ---------------- spec shapes ---------------- */
export interface SpecSensor { kind: string; position: string; range_m?: number }
export interface SpecWheel { diameter_m: number; width_m: number; count: number; driven?: boolean }
export interface SpecMotor { kind?: string; count: number; voltage_v: number; stall_torque_nm?: number | null }
export interface SpecBattery { chemistry: string; voltage_v: number; capacity_mah: number }
export interface WireNode {
  id: string; label: string; req_label: string;
  rated_max_v: number | null; kit: string | null; deck?: boolean;
}
export interface WireConn {
  from: string; to: string; kind: string;
  volts?: number | null; label?: string;
}
export interface Wiring { note?: string; nodes: WireNode[]; connections: WireConn[] }
export interface RobotSpec {
  name: string;
  description?: string;
  drivetrain: string;
  length_m: number; width_m: number; height_m: number;
  mass_kg?: number;
  ground_clearance_m: number;
  wheel: SpecWheel;
  motor: SpecMotor;
  battery: SpecBattery;
  sensors: SpecSensor[];
  rotors?: { count: number; prop_diameter_m: number };
  legs?: { count: number; segments: number };
  arms?: { count: number; segments: number };
  wiring?: Wiring;
}

export interface TaPart {
  id: string; name: string; file: string | null; qty: number;
  does: string; dims: string; tweak: string; print: string;
  x?: number; y?: number; face?: number;
}
export interface BuiltParts { parts: TaPart[]; pos: [number, number][] }

/* ---------------- electrical logic (robot.js elec-logic block) ---- */
export function elecNodeMap(w: Wiring): Record<string, WireNode> {
  const m: Record<string, WireNode> = {};
  (w.nodes || []).forEach((n) => { m[n.id] = n; });
  return m;
}
export function elecDepths(w: Wiring): Record<string, number> {
  const depth: Record<string, number> = {};
  (w.nodes || []).forEach((n) => { depth[n.id] = Infinity; });
  if (!Object.prototype.hasOwnProperty.call(depth, "battery")) return depth;
  depth.battery = 0;
  let grew = true;
  while (grew) {
    grew = false;
    (w.connections || []).forEach((c) => {
      if (depth[c.from] !== Infinity && depth[c.to] === Infinity) {
        depth[c.to] = depth[c.from] + 1; grew = true;
      }
    });
  }
  return depth;
}
export function elecStage(w: Wiring, depth: Record<string, number>, i: number): number {
  const d = depth[w.connections[i].from];
  return d === Infinity ? Infinity : d + 1;
}
export function elecBad(w: Wiring): Set<number> {
  const nodes = elecNodeMap(w);
  const bad = new Set<number>();
  (w.connections || []).forEach((c, i) => {
    const t = nodes[c.to];
    if (c.kind === "power" && c.volts != null && t &&
        t.rated_max_v != null && c.volts > t.rated_max_v) bad.add(i);
  });
  return bad;
}
export function elecVolts(v: number | null | undefined): string {
  return v == null ? "not specified" : `${Math.round(v * 10) / 10} V`;
}
export function elecConnLabel(w: Wiring, i: number): string {
  const c = w.connections[i];
  const nodes = elecNodeMap(w);
  const a = nodes[c.from] ? nodes[c.from].label : c.from;
  const b = nodes[c.to] ? nodes[c.to].label : c.to;
  return a + " → " + b + " · " + c.kind +
    (c.kind === "power" ? " · " + elecVolts(c.volts) : "") +
    (c.label ? " — " + c.label : "");
}
export interface NodeStatus { state: "bad" | "ok" | "unchecked"; feeds: WireConn[]; reason: string }
export function elecNodeStatus(w: Wiring, id: string): NodeStatus {
  const nodes = elecNodeMap(w);
  const node = nodes[id];
  const bad = elecBad(w);
  const feeds: WireConn[] = [];
  let state: NodeStatus["state"] = "unchecked";
  let reason = "no feed is recorded for it";
  (w.connections || []).forEach((c, i) => {
    if (c.to !== id || c.kind !== "power") return;
    feeds.push(c);
    if (bad.has(i)) state = "bad";
    else if (c.volts != null && node && node.rated_max_v != null &&
             state === "unchecked") state = "ok";
  });
  if (feeds.length && state === "unchecked") {
    reason = feeds.every((c) => c.volts == null)
      ? "its feed carries no fixed voltage (PWM or an unspecified rail)"
      : "the part has no recorded rated maximum to check against";
  }
  return { state, feeds, reason };
}

/* ---------------- derivation ---------------- */
export function taWheelPositions(spec: RobotSpec): [number, number][] {
  const wx = spec.length_m / 2 - spec.wheel.diameter_m / 2;
  const wy = spec.width_m / 2 + spec.wheel.width_m / 2;
  if (spec.wheel.count === 2) return [[0, wy], [0, -wy]];
  return [[wx, wy], [wx, -wy], [-wx, wy], [-wx, -wy]].slice(0, spec.wheel.count) as [number, number][];
}
export function taPosXY(position: string | undefined, spec: RobotSpec): [number, number] {
  const p = String(position || "").toLowerCase();
  let x = 0, y = 0;
  if (p.includes("front")) x = spec.length_m / 2;
  else if (p.includes("rear") || p.includes("back")) x = -spec.length_m / 2;
  if (p.includes("left")) y = spec.width_m / 4;
  else if (p.includes("right")) y = -spec.width_m / 4;
  return [x, y];
}
export function taIsEstimated(spec: RobotSpec): boolean {
  const d = spec.description || "";
  return d.startsWith("Photo draft") || d.includes("ESTIMATED");
}
export type TaClass = "aerial" | "arm" | "humanoid" | "quadruped" | "ground";
export function taClass(spec: RobotSpec): TaClass {
  if (spec.rotors) return "aerial";
  if (spec.drivetrain === "robotic_arm") return "arm";
  /* A quadruped stays a quadruped when it carries a manipulator —
   * the arm is part of the robot, not a change of class (Spot with
   * Arm). Only a legs+arms spec that is not declared a quadruped
   * reads as a humanoid. */
  if (spec.drivetrain === "quadruped") return "quadruped";
  if (spec.legs && spec.arms) return "humanoid";
  if (spec.legs) return "quadruped";
  return "ground";
}
export function taBuildParts(spec: RobotSpec): BuiltParts {
  const cls = taClass(spec);
  if (cls === "aerial") return taBuildAerialParts(spec);
  if (cls === "quadruped") return taBuildQuadParts(spec);
  if (cls === "humanoid") return taBuildHumanoidParts(spec);
  if (cls === "arm") return taBuildArmParts(spec);
  return taBuildGroundParts(spec);
}
export function taMotorXY(spec: RobotSpec): [number, number][] {
  const hx = spec.length_m / 2, hy = spec.width_m / 2;
  return [[hx, hy], [hx, -hy], [-hx, hy], [-hx, -hy]]
    .slice(0, spec.rotors ? spec.rotors.count : 4) as [number, number][];
}
function taBatteryText(spec: RobotSpec): string {
  const b = spec.battery;
  return b.chemistry + ", " + b.voltage_v + " V, " +
    b.capacity_mah + " mAh — from the spec";
}

function taBuildAerialParts(spec: RobotSpec): BuiltParts {
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const n = spec.rotors ? spec.rotors.count : 0;
  const pd = spec.rotors ? spec.rotors.prop_diameter_m : 0;
  const parts: TaPart[] = [];
  parts.push({ id: "frame", name: "Airframe", file: null, qty: 1,
    does: "The central frame the arms, motors and electronics bolt to.",
    dims: "motors span " + mm(L) + " x " + mm(W) + " mm motor-to-motor (" +
      mm(Math.hypot(L, W)) + " mm diagonal) — the spec’s length and width are the motor spans",
    tweak: "Motor-to-motor size is the drone’s real footprint class: it sets how big a propeller fits before the props overlap.",
    print: "Schematic part — the viewer draws the real robot’s layout from its spec; there is no printable kit for this class yet." });
  parts.push({ id: "arm", name: "Arm", file: null, qty: n,
    does: "One boom per motor, reaching from the frame to a corner.",
    dims: "one per rotor (" + n + "); each reaches half the diagonal, " +
      mm(Math.hypot(L, W) / 2) + " mm",
    tweak: "Stiffer arms wobble less: vibration is the flight controller’s worst enemy.",
    print: "Schematic part — see the frame note." });
  parts.push({ id: "rotor", name: "Motor + propeller", file: null, qty: n,
    does: "A brushless motor with its propeller — the whole drivetrain of a drone. Neighbouring rotors spin opposite ways so their twist cancels.",
    dims: "propeller " + mm(pd) + " mm diameter (from the spec); " +
      spec.motor.count + " motors at " + spec.motor.voltage_v + " V",
    tweak: "Bigger props move more air more slowly (quieter, more efficient); smaller props spin faster and answer quicker.",
    print: "Schematic part — see the frame note. Props are consumables on real drones; they chip and bend." });
  parts.push({ id: "battery", name: "Battery", file: null, qty: 1,
    does: "The flight pack, strapped at the centre so its weight sits at the centre of mass.",
    dims: taBatteryText(spec),
    tweak: "Battery weight is the drone’s biggest trade: more capacity flies longer, until the extra mass eats the gain.",
    print: "Schematic part — a real pack, bought not printed." });
  parts.push({ id: "fc", name: "Flight-controller stack", file: null, qty: 1,
    does: "The board (or stack of boards) that reads the IMU and GPS and mixes the four motor speeds many times a second.",
    dims: "carries the spec’s sensors: " +
      (spec.sensors.map((s) => s.kind).join(", ") || "none listed"),
    tweak: "Soft-mounting the flight controller (foam or rubber) is the classic fix for a drone that twitches.",
    print: "Schematic part — real electronics, mounted at the frame centre." });
  const cams = spec.sensors.filter((s) => s.kind === "rgb_camera" || s.kind === "depth_camera");
  if (cams.length) {
    const [cx, cy] = taPosXY(cams[0].position, spec);
    parts.push({ id: "camera", name: "Camera", file: null, qty: cams.length,
      does: "A camera (" + cams[0].kind + ") at the " + cams[0].position + " of the craft.",
      dims: "position word from the spec: " + cams[0].position,
      tweak: "A camera at the nose is the pilot’s eye on FPV drones; on camera drones it usually hangs on a gimbal underneath.",
      print: "Schematic part — real electronics.", x: cx, y: cy });
  }
  return { parts, pos: taMotorXY(spec) };
}

function taBuildQuadParts(spec: RobotSpec): BuiltParts {
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const parts: TaPart[] = [];
  parts.push({ id: "body", name: "Body", file: null, qty: 1,
    does: "The torso: carries the computer, the battery and the leg motors, and sets how high the robot stands.",
    dims: mm(L) + " x " + mm(W) + " mm, standing height " + mm(H) + " mm — from the spec",
    tweak: "Standing height comes from the legs, not the body: longer legs step over more, but sway more.",
    print: "Schematic part — the viewer draws the real robot’s layout from its spec; there is no printable kit for this class yet." });
  parts.push({ id: "leg", name: "Leg", file: null, qty: spec.legs ? spec.legs.count : 0,
    does: "A two-segment leg (upper and lower) with a motor at the hip and one at the knee — two powered bends per leg is what lets a dog trot, turn and catch itself.",
    dims: (spec.legs ? spec.legs.count : 0) + " legs, " + (spec.legs ? spec.legs.segments : 0) + " segments each; " +
      spec.motor.count + " joint motors across the robot (from the spec)",
    tweak: "Feet matter more than they look: a soft foot grips, a hard round foot skates on smooth floors.",
    print: "Schematic part — see the body note." });
  const sense = spec.sensors.filter((s) => s.kind === "lidar_2d" || s.kind === "rgb_camera" || s.kind === "depth_camera");
  if (sense.length) {
    parts.push({ id: "head", name: "Head / sensor unit", file: null, qty: 1,
      does: "The sensor head at the front: " + sense.map((s) => s.kind).join(" + ") + ", so the robot sees where it is walking.",
      dims: "sensors from the spec: " + sense.map((s) => s.kind + " (" + s.position + ")").join(", "),
      tweak: "A sensor is only as good as its view: anything that blocks the head’s line of sight blinds the robot on that side.",
      print: "Schematic part — real electronics." });
  }
  parts.push({ id: "battery", name: "Battery", file: null, qty: 1,
    does: "The pack inside the body — on a legged robot it is a large share of the total mass.",
    dims: taBatteryText(spec),
    tweak: "Legged robots spend energy standing still (the motors hold the body up), so runtime drops fast with a heavier pack.",
    print: "Schematic part — a real pack, inside the body." });
  return { parts, pos: [] };
}

function taBuildHumanoidParts(spec: RobotSpec): BuiltParts {
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const parts: TaPart[] = [];
  parts.push({ id: "pelvis", name: "Pelvis", file: null, qty: 1,
    does: "The hip block the legs hang from and the torso stands on — the robot’s centre of mass lives near here.",
    dims: "standing height " + mm(H) + " mm overall; body " + mm(W) + " mm wide, " + mm(L) + " mm deep — from the spec",
    tweak: "Balance is a centre-of-mass game: keep the mass low and centred and the robot forgives bad steps.",
    print: "Schematic part — the viewer draws the real robot’s layout from its spec; there is no printable kit for this class yet." });
  parts.push({ id: "torso", name: "Torso", file: null, qty: 1,
    does: "The chest: carries the arms, the head, the main computer and usually the battery.",
    dims: "upper body above the pelvis, roughly the middle third of the " + mm(H) + " mm height",
    tweak: "A humanoid falls as one rigid story problem — the torso is where the IMU sits, so its motion is what the balance controller feels.",
    print: "Schematic part — see the pelvis note." });
  parts.push({ id: "head", name: "Head", file: null, qty: 1,
    does: "The sensor head: " + (spec.sensors.length ? spec.sensors.map((s) => s.kind).join(" + ") : "no sensors in the spec") + ".",
    dims: "sensors from the spec: " + (spec.sensors.map((s) => s.kind + " (" + s.position + ")").join(", ") || "none listed"),
    tweak: "Heads are light on purpose: mass at the top is the hardest to balance.",
    print: "Schematic part — real electronics." });
  parts.push({ id: "arm", name: "Arm", file: null, qty: spec.arms ? spec.arms.count : 0,
    does: "A two-segment arm (upper arm and forearm) with a powered shoulder and elbow.",
    dims: (spec.arms ? spec.arms.count : 0) + " arms, " + (spec.arms ? spec.arms.segments : 0) + " segments each (from the spec)",
    tweak: "On a humanoid the arms are balance tools first and manipulators second — swinging them shifts the centre of mass.",
    print: "Schematic part — see the pelvis note." });
  parts.push({ id: "leg", name: "Leg", file: null, qty: spec.legs ? spec.legs.count : 0,
    does: "A two-segment leg (thigh and shin) ending in a flat foot — the foot’s size is the robot’s balance margin.",
    dims: (spec.legs ? spec.legs.count : 0) + " legs; " + spec.motor.count + " actuated joints across the whole robot (from the spec)",
    tweak: "Ankle motors decide whether the robot can stand on a slope or only on flat floors.",
    print: "Schematic part — see the pelvis note." });
  parts.push({ id: "battery", name: "Battery", file: null, qty: 1,
    does: "The pack, carried in the torso.",
    dims: taBatteryText(spec),
    tweak: "Humanoids are energy-hungry: every joint motor draws power just to stand.",
    print: "Schematic part — a real pack, inside the torso." });
  return { parts, pos: [] };
}

function taBuildArmParts(spec: RobotSpec): BuiltParts {
  const L = spec.length_m;
  const parts: TaPart[] = [];
  parts.push({ id: "base", name: "Base", file: null, qty: 1,
    does: "The fixed base that bolts to the table and carries the first (waist) servo — the only part of this robot that never moves.",
    dims: "reach " + mm(L) + " mm from the base axis (from the spec)",
    tweak: "Bolt it down: an arm that can lift 500 g at full reach can tip its own base plate.",
    print: "Schematic part — the viewer draws the real robot’s layout from its spec; there is no printable kit for this class yet." });
  parts.push({ id: "link", name: "Arm segment", file: null, qty: spec.arms ? spec.arms.segments : 0,
    does: "One rigid segment between two servo joints. The chain of segments is what reach means: their lengths add up to how far the gripper gets.",
    dims: (spec.arms ? spec.arms.segments : 0) + " segments; total reach " + mm(L) + " mm (from the spec)",
    tweak: "Longer segments reach further but flex more and load the shoulder servo harder — reach and payload trade against each other.",
    print: "Schematic part — see the base note." });
  parts.push({ id: "gripper", name: "Gripper", file: null, qty: 1,
    does: "The two-finger end effector, driven by the last servo — the part that actually touches the work.",
    dims: "the spec’s width (" + mm(spec.width_m) + " mm) is the gripper’s maximum opening",
    tweak: "Soft fingertips grip more with less force; smooth metal fingers need a squeeze that can crush light parts.",
    print: "Schematic part — see the base note." });
  parts.push({ id: "battery", name: "Power supply", file: null, qty: 1,
    does: "This robot has no battery: it runs from a plug-in DC supply, which the spec models in the battery slot.",
    dims: spec.battery.voltage_v + " V DC supply (spec chemistry: " + spec.battery.chemistry + ", capacity 0 mAh — there is no pack)",
    tweak: "A tethered arm never runs flat mid-task, but the cable is part of the workspace — route it so the arm cannot snag it.",
    print: "Schematic part — a real bench supply, drawn beside the base." });
  return { parts, pos: [] };
}

function taBuildGroundParts(spec: RobotSpec): BuiltParts {
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const C = spec.ground_clearance_m, r = spec.wheel.diameter_m / 2;
  const pos = taWheelPositions(spec);
  const parts: TaPart[] = [];

  parts.push({ id: "plate", name: "Chassis plate", file: "parts/chassis_plate.scad", qty: 1,
    does: "The deck everything else bolts to.",
    dims: mm(L) + " x " + mm(W) + " mm footprint, 4 mm thick (thickness is a kit assumption)",
    tweak: "Change length_m or width_m in the spec and the whole kit follows — plate, wheel spacing and mounts are all derived from the same numbers.",
    print: "Print flat as modeled. Suggestion: 3–4 walls, ~25% infill." });

  parts.push({ id: "wheel", name: "Wheel", file: "parts/wheel.scad", qty: spec.wheel.count,
    does: "Rolls on the ground; one per wheel position on the robot.",
    dims: mm(spec.wheel.diameter_m) + " mm diameter x " + mm(spec.wheel.width_m) + " mm wide, 6 mm shaft hole (hole size is a kit assumption)",
    tweak: "wheel.diameter_m is the number the motion gate grades. Change it and the twin, the CAD kit and the verdict all move together.",
    print: "Print flat as modeled. Suggestion: print one first and check the shaft fit before printing the rest." });

  parts.push({ id: "mount", name: "Motor mount", file: "parts/motor_mount.scad", qty: spec.wheel.count,
    does: "Side plate that holds one drive motor so its shaft lines up with a wheel’s axle.",
    dims: "one per wheel; shaft hole at axle height " + mm(r) + " mm (the wheel radius, from the spec)",
    tweak: "The mount is derived, not drawn: its shaft height always equals the wheel radius, so it can never disagree with the wheel.",
    print: "Suggestion: 40% infill — this part takes the motor’s twist. The motor itself is not a printed part." });

  if (spec.wheel.count === 2) {
    parts.push({ id: "caster", name: "Caster", file: "parts/caster.scad", qty: 2,
      does: "Ball caster that keeps a two-wheel robot level (one front, one rear). Placeholder for a real ball-caster unit.",
      dims: "ball diameter " + mm(C) + " mm — set by the spec’s ground clearance, so the ball tops out at the deck",
      tweak: "Ground clearance comes from the spec; a taller clearance grows the caster ball to match.",
      print: "Suggestion: expect a loose fit — sand or scale 1–2% for a snug cup. A bought ball caster rolls far better." });
  }

  const lidar = spec.sensors.find((s) => s.kind === "lidar_2d");
  if (lidar) {
    const [lx, ly] = taPosXY(lidar.position, spec);
    parts.push({ id: "lidar", name: "Lidar mount", file: "parts/lidar_mount.scad", qty: 1,
      does: "Post that raises the 2D lidar to the top of the robot so its scan plane clears the chassis.",
      dims: "post rises from the deck to the spec’s overall height (" + mm(H) + " mm); top disc " + mm(LIDAR_DISC_D) + " mm diameter (disc size is a kit assumption)",
      tweak: "The post height is derived from the spec’s height_m — raise the robot and the lidar rises with it.",
      print: "Print upright as modeled. Suggestion: ~25% infill; the lidar itself is not a printed part.",
      x: lx, y: ly });
  }

  const cams = spec.sensors.filter((s) => s.kind === "rgb_camera" || s.kind === "depth_camera");
  if (cams.length) {
    const [cx] = taPosXY(cams[0].position, spec);
    parts.push({ id: "camera", name: "Camera bracket", file: "parts/camera_bracket.scad", qty: cams.length,
      does: "Bracket that holds a camera (" + cams[0].kind + ") at the " + cams[0].position + " of the robot.",
      dims: mm(CAM_W) + " x " + mm(CAM_H) + " mm plate, 12 mm lens hole (bracket sizes are kit assumptions)",
      tweak: "The kit ships one bracket file for every camera on the robot — edit it once, print it per camera.",
      print: "Print flat as modeled. Suggestion: the lens hole is a visual guide — measure your camera before drilling.",
      face: cx >= 0 ? 1 : -1 });
  }

  const ultras = spec.sensors.filter((s) => s.kind === "ultrasonic");
  if (ultras.length) {
    const [ux] = taPosXY(ultras[0].position, spec);
    parts.push({ id: "ultrasonic", name: "Ultrasonic bracket", file: "parts/ultrasonic_bracket.scad", qty: ultras.length,
      does: "Front mount carrying the ultrasonic sensor’s two round “eyes” (HC-SR04 style).",
      dims: "twin " + mm(ULTRA_CAN_D) + " mm cans, 26 mm apart (HC-SR04 class sizes — kit assumptions)",
      tweak: "Angle it straight ahead: a tilted sonar measures the floor, not the wall.",
      print: "Print flat as modeled. Suggestion: the cans are visual placeholders for a real ultrasonic module.",
      face: ux >= 0 ? 1 : -1 });
  }
  return { parts, pos };
}
