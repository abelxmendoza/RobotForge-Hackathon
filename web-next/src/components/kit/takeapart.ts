/* Take-apart viewer core — a TypeScript port of assets/js/robot.js.
 *
 * Geometry mirrors src/robotforge/cad.py (which mirrors urdf.py):
 * wheel X = length/2 - wheel radius; wheel Y = width/2 + wheel width/2;
 * axles at wheel-radius height; chassis plate underside at the spec's
 * ground clearance; casters at x = +/- (length/2 - ground clearance);
 * sensor placement from the spec's position words (a layout assumption,
 * exactly as the kit's assembly file labels it). Kit assumption sizes
 * (plate thickness, lidar disc, bracket sizes) are labeled as such.
 *
 * The vanilla file keeps viewer state in module globals (taExplode,
 * taSelected, the electrical overlay flags); here that state is an
 * explicit TaViewState passed to the renderers, which return the same
 * SVG strings the vanilla builders produce. */
import { mm } from '../forge/model';
import type { RobotSpec, WiringBlock, WiringConnection } from '../forge/model';

export const PLATE_T = 0.004; // kit assumption (cad.py PLATE_THICKNESS_MM)
export const LIDAR_DISC_D = 0.070; // kit assumption (cad.py LIDAR_DISC_D_MM)
export const POST_D = 0.012; // kit assumption (cad.py POST_D_MM)
export const CAM_W = 0.044;
export const CAM_H = 0.034; // kit assumptions (camera bracket)
export const ULTRA_H = 0.020;
export const ULTRA_CAN_D = 0.016; // kit assumptions (ultrasonic)

/* parts with an illustration in assets/img/parts/<id>.jpg */
export const TA_SPOTS = ['plate', 'wheel', 'mount', 'caster', 'lidar', 'camera', 'ultrasonic'];

export function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface TaPart {
  id: string;
  name: string;
  file: string | null;
  qty: number;
  does: string;
  dims: string;
  tweak: string;
  print: string;
  x?: number;
  y?: number;
  face?: number;
}

export interface TaBuilt {
  parts: TaPart[];
  pos: [number, number][];
}

export interface TaMesh {
  kind: 'box' | 'cyl' | 'sphere';
  axis?: string;
  size: number[];
  center: [number, number, number];
  rot?: [number, number, number];
}

export interface TaUnit {
  part: string;
  explode: [number, number, number];
  meshes: TaMesh[];
}

export interface TaViewState {
  explode: number; // mm, as the slider carries it
  selected: string | null;
  elec: boolean;
  power: boolean;
  elecStage: number;
  selNode: string | null;
  selWire: number | null;
}

export const TA_DEFAULT_VIEW: TaViewState = {
  explode: 0,
  selected: null,
  elec: false,
  power: false,
  elecStage: 0,
  selNode: null,
  selWire: null,
};

/* ---------------- part derivation ---------------- */

export function taWheelPositions(spec: RobotSpec): [number, number][] {
  const wx = spec.length_m / 2 - (spec.wheel?.diameter_m ?? 0) / 2;
  const wy = spec.width_m / 2 + (spec.wheel?.width_m ?? 0) / 2;
  if (spec.wheel?.count === 2) return [[0, wy], [0, -wy]];
  return ([[wx, wy], [wx, -wy], [-wx, wy], [-wx, -wy]] as [number, number][]).slice(
    0,
    spec.wheel?.count ?? 0,
  );
}

export function taPosXY(position: string | undefined, spec: RobotSpec): [number, number] {
  const p = String(position || '').toLowerCase();
  let x = 0;
  let y = 0;
  if (p.includes('front')) x = spec.length_m / 2;
  else if (p.includes('rear') || p.includes('back')) x = -spec.length_m / 2;
  if (p.includes('left')) y = spec.width_m / 4;
  else if (p.includes('right')) y = -spec.width_m / 4;
  return [x, y];
}

export function taIsEstimated(spec: RobotSpec): boolean {
  const d = spec.description || '';
  return d.startsWith('Photo draft') || d.includes('ESTIMATED');
}

/* Which take-apart family a spec belongs to. Derived from the
 * spec's own class fields, the same way schema.py branches: rotors
 * make an aerial, legs+arms a humanoid, legs alone a quadruped, the
 * robotic_arm drivetrain a stationary arm, anything else the ground
 * kit the viewer has always drawn. */
export function taClass(spec: RobotSpec): 'aerial' | 'arm' | 'humanoid' | 'quadruped' | 'ground' {
  if (spec.rotors) return 'aerial';
  if (spec.drivetrain === 'robotic_arm') return 'arm';
  if (spec.legs && spec.arms) return 'humanoid';
  if (spec.legs) return 'quadruped';
  return 'ground';
}

export function taBuildParts(spec: RobotSpec): TaBuilt {
  const cls = taClass(spec);
  if (cls === 'aerial') return taBuildAerialParts(spec);
  if (cls === 'quadruped') return taBuildQuadParts(spec);
  if (cls === 'humanoid') return taBuildHumanoidParts(spec);
  if (cls === 'arm') return taBuildArmParts(spec);
  return taBuildGroundParts(spec);
}

/* Motor positions of an X-frame multirotor: the four corners of the
 * spec's length x width (its declared motor-to-motor spans). */
export function taMotorXY(spec: RobotSpec): [number, number][] {
  const hx = spec.length_m / 2;
  const hy = spec.width_m / 2;
  return ([[hx, hy], [hx, -hy], [-hx, hy], [-hx, -hy]] as [number, number][]).slice(
    0,
    spec.rotors ? spec.rotors.count : 4,
  );
}

function taBatteryText(spec: RobotSpec): string {
  const b = spec.battery;
  return b.chemistry + ', ' + b.voltage_v + ' V, ' + b.capacity_mah + ' mAh — from the spec';
}

/* Schematic parts carry file: null — they are the real robot's
 * layout derived from its spec, not files in a printable kit, and
 * the detail panel says so instead of naming a file that is not
 * there. Their prose interpolates the spec's own numbers only. */
function taBuildAerialParts(spec: RobotSpec): TaBuilt {
  const L = spec.length_m;
  const W = spec.width_m;
  const n = spec.rotors?.count ?? 0;
  const pd = spec.rotors?.prop_diameter_m ?? 0;
  const parts: TaPart[] = [];
  parts.push({
    id: 'frame', name: 'Airframe', file: null, qty: 1,
    does: 'The central frame the arms, motors and electronics bolt to.',
    dims: 'motors span ' + mm(L) + ' x ' + mm(W) + ' mm motor-to-motor (' +
      mm(Math.hypot(L, W)) + ' mm diagonal) — the spec’s length and width are the motor spans',
    tweak: 'Motor-to-motor size is the drone’s real footprint class: it sets how big a propeller fits before the props overlap.',
    print: 'Schematic part — the viewer draws the real robot’s layout from its spec; there is no printable kit for this class yet.',
  });
  parts.push({
    id: 'arm', name: 'Arm', file: null, qty: n,
    does: 'One boom per motor, reaching from the frame to a corner.',
    dims: 'one per rotor (' + n + '); each reaches half the diagonal, ' + mm(Math.hypot(L, W) / 2) + ' mm',
    tweak: 'Stiffer arms wobble less: vibration is the flight controller’s worst enemy.',
    print: 'Schematic part — see the frame note.',
  });
  parts.push({
    id: 'rotor', name: 'Motor + propeller', file: null, qty: n,
    does: 'A brushless motor with its propeller — the whole drivetrain of a drone. Neighbouring rotors spin opposite ways so their twist cancels.',
    dims: 'propeller ' + mm(pd) + ' mm diameter (from the spec); ' +
      spec.motor.count + ' motors at ' + spec.motor.voltage_v + ' V',
    tweak: 'Bigger props move more air more slowly (quieter, more efficient); smaller props spin faster and answer quicker.',
    print: 'Schematic part — see the frame note. Props are consumables on real drones; they chip and bend.',
  });
  parts.push({
    id: 'battery', name: 'Battery', file: null, qty: 1,
    does: 'The flight pack, strapped at the centre so its weight sits at the centre of mass.',
    dims: taBatteryText(spec),
    tweak: 'Battery weight is the drone’s biggest trade: more capacity flies longer, until the extra mass eats the gain.',
    print: 'Schematic part — a real pack, bought not printed.',
  });
  parts.push({
    id: 'fc', name: 'Flight-controller stack', file: null, qty: 1,
    does: 'The board (or stack of boards) that reads the IMU and GPS and mixes the four motor speeds many times a second.',
    dims: 'carries the spec’s sensors: ' + ((spec.sensors || []).map((s) => s.kind).join(', ') || 'none listed'),
    tweak: 'Soft-mounting the flight controller (foam or rubber) is the classic fix for a drone that twitches.',
    print: 'Schematic part — real electronics, mounted at the frame centre.',
  });
  const cams = (spec.sensors || []).filter((s) => s.kind === 'rgb_camera' || s.kind === 'depth_camera');
  if (cams.length) {
    const [cx, cy] = taPosXY(cams[0].position, spec);
    parts.push({
      id: 'camera', name: 'Camera', file: null, qty: cams.length,
      does: 'A camera (' + cams[0].kind + ') at the ' + cams[0].position + ' of the craft.',
      dims: 'position word from the spec: ' + cams[0].position,
      tweak: 'A camera at the nose is the pilot’s eye on FPV drones; on camera drones it usually hangs on a gimbal underneath.',
      print: 'Schematic part — real electronics.', x: cx, y: cy,
    });
  }
  return { parts, pos: taMotorXY(spec) };
}

function taBuildQuadParts(spec: RobotSpec): TaBuilt {
  const L = spec.length_m;
  const W = spec.width_m;
  const H = spec.height_m;
  const parts: TaPart[] = [];
  parts.push({
    id: 'body', name: 'Body', file: null, qty: 1,
    does: 'The torso: carries the computer, the battery and the leg motors, and sets how high the robot stands.',
    dims: mm(L) + ' x ' + mm(W) + ' mm, standing height ' + mm(H) + ' mm — from the spec',
    tweak: 'Standing height comes from the legs, not the body: longer legs step over more, but sway more.',
    print: 'Schematic part — the viewer draws the real robot’s layout from its spec; there is no printable kit for this class yet.',
  });
  parts.push({
    id: 'leg', name: 'Leg', file: null, qty: spec.legs?.count ?? 0,
    does: 'A two-segment leg (upper and lower) with a motor at the hip and one at the knee — two powered bends per leg is what lets a dog trot, turn and catch itself.',
    dims: (spec.legs?.count ?? 0) + ' legs, ' + (spec.legs?.segments ?? '') + ' segments each; ' +
      spec.motor.count + ' joint motors across the robot (from the spec)',
    tweak: 'Feet matter more than they look: a soft foot grips, a hard round foot skates on smooth floors.',
    print: 'Schematic part — see the body note.',
  });
  const sense = (spec.sensors || []).filter(
    (s) => s.kind === 'lidar_2d' || s.kind === 'rgb_camera' || s.kind === 'depth_camera',
  );
  if (sense.length) {
    parts.push({
      id: 'head', name: 'Head / sensor unit', file: null, qty: 1,
      does: 'The sensor head at the front: ' + sense.map((s) => s.kind).join(' + ') + ', so the robot sees where it is walking.',
      dims: 'sensors from the spec: ' + sense.map((s) => s.kind + ' (' + s.position + ')').join(', '),
      tweak: 'A sensor is only as good as its view: anything that blocks the head’s line of sight blinds the robot on that side.',
      print: 'Schematic part — real electronics.',
    });
  }
  parts.push({
    id: 'battery', name: 'Battery', file: null, qty: 1,
    does: 'The pack inside the body — on a legged robot it is a large share of the total mass.',
    dims: taBatteryText(spec),
    tweak: 'Legged robots spend energy standing still (the motors hold the body up), so runtime drops fast with a heavier pack.',
    print: 'Schematic part — a real pack, inside the body.',
  });
  return { parts, pos: [] };
}

function taBuildHumanoidParts(spec: RobotSpec): TaBuilt {
  const L = spec.length_m;
  const W = spec.width_m;
  const H = spec.height_m;
  const parts: TaPart[] = [];
  parts.push({
    id: 'pelvis', name: 'Pelvis', file: null, qty: 1,
    does: 'The hip block the legs hang from and the torso stands on — the robot’s centre of mass lives near here.',
    dims: 'standing height ' + mm(H) + ' mm overall; body ' + mm(W) + ' mm wide, ' + mm(L) + ' mm deep — from the spec',
    tweak: 'Balance is a centre-of-mass game: keep the mass low and centred and the robot forgives bad steps.',
    print: 'Schematic part — the viewer draws the real robot’s layout from its spec; there is no printable kit for this class yet.',
  });
  parts.push({
    id: 'torso', name: 'Torso', file: null, qty: 1,
    does: 'The chest: carries the arms, the head, the main computer and usually the battery.',
    dims: 'upper body above the pelvis, roughly the middle third of the ' + mm(H) + ' mm height',
    tweak: 'A humanoid falls as one rigid story problem — the torso is where the IMU sits, so its motion is what the balance controller feels.',
    print: 'Schematic part — see the pelvis note.',
  });
  parts.push({
    id: 'head', name: 'Head', file: null, qty: 1,
    does: 'The sensor head: ' + ((spec.sensors || []).length ? (spec.sensors || []).map((s) => s.kind).join(' + ') : 'no sensors in the spec') + '.',
    dims: 'sensors from the spec: ' + ((spec.sensors || []).map((s) => s.kind + ' (' + s.position + ')').join(', ') || 'none listed'),
    tweak: 'Heads are light on purpose: mass at the top is the hardest to balance.',
    print: 'Schematic part — real electronics.',
  });
  parts.push({
    id: 'arm', name: 'Arm', file: null, qty: spec.arms?.count ?? 0,
    does: 'A two-segment arm (upper arm and forearm) with a powered shoulder and elbow.',
    dims: (spec.arms?.count ?? 0) + ' arms, ' + (spec.arms?.segments ?? '') + ' segments each (from the spec)',
    tweak: 'On a humanoid the arms are balance tools first and manipulators second — swinging them shifts the centre of mass.',
    print: 'Schematic part — see the pelvis note.',
  });
  parts.push({
    id: 'leg', name: 'Leg', file: null, qty: spec.legs?.count ?? 0,
    does: 'A two-segment leg (thigh and shin) ending in a flat foot — the foot’s size is the robot’s balance margin.',
    dims: (spec.legs?.count ?? 0) + ' legs; ' + spec.motor.count + ' actuated joints across the whole robot (from the spec)',
    tweak: 'Ankle motors decide whether the robot can stand on a slope or only on flat floors.',
    print: 'Schematic part — see the pelvis note.',
  });
  parts.push({
    id: 'battery', name: 'Battery', file: null, qty: 1,
    does: 'The pack, carried in the torso.',
    dims: taBatteryText(spec),
    tweak: 'Humanoids are energy-hungry: every joint motor draws power just to stand.',
    print: 'Schematic part — a real pack, inside the torso.',
  });
  return { parts, pos: [] };
}

function taBuildArmParts(spec: RobotSpec): TaBuilt {
  const L = spec.length_m;
  const parts: TaPart[] = [];
  parts.push({
    id: 'base', name: 'Base', file: null, qty: 1,
    does: 'The fixed base that bolts to the table and carries the first (waist) servo — the only part of this robot that never moves.',
    dims: 'reach ' + mm(L) + ' mm from the base axis (from the spec)',
    tweak: 'Bolt it down: an arm that can lift 500 g at full reach can tip its own base plate.',
    print: 'Schematic part — the viewer draws the real robot’s layout from its spec; there is no printable kit for this class yet.',
  });
  parts.push({
    id: 'link', name: 'Arm segment', file: null, qty: spec.arms?.segments ?? 0,
    does: 'One rigid segment between two servo joints. The chain of segments is what reach means: their lengths add up to how far the gripper gets.',
    dims: (spec.arms?.segments ?? 0) + ' segments; total reach ' + mm(L) + ' mm (from the spec)',
    tweak: 'Longer segments reach further but flex more and load the shoulder servo harder — reach and payload trade against each other.',
    print: 'Schematic part — see the base note.',
  });
  parts.push({
    id: 'gripper', name: 'Gripper', file: null, qty: 1,
    does: 'The two-finger end effector, driven by the last servo — the part that actually touches the work.',
    dims: 'the spec’s width (' + mm(spec.width_m) + ' mm) is the gripper’s maximum opening',
    tweak: 'Soft fingertips grip more with less force; smooth metal fingers need a squeeze that can crush light parts.',
    print: 'Schematic part — see the base note.',
  });
  parts.push({
    id: 'battery', name: 'Power supply', file: null, qty: 1,
    does: 'This robot has no battery: it runs from a plug-in DC supply, which the spec models in the battery slot.',
    dims: spec.battery.voltage_v + ' V DC supply (spec chemistry: ' + spec.battery.chemistry + ', capacity 0 mAh — there is no pack)',
    tweak: 'A tethered arm never runs flat mid-task, but the cable is part of the workspace — route it so the arm cannot snag it.',
    print: 'Schematic part — a real bench supply, drawn beside the base.',
  });
  return { parts, pos: [] };
}

function taBuildGroundParts(spec: RobotSpec): TaBuilt {
  const L = spec.length_m;
  const W = spec.width_m;
  const H = spec.height_m;
  const C = spec.ground_clearance_m ?? 0;
  const r = (spec.wheel?.diameter_m ?? 0) / 2;
  const pos = taWheelPositions(spec);
  const parts: TaPart[] = [];

  parts.push({
    id: 'plate', name: 'Chassis plate', file: 'parts/chassis_plate.scad', qty: 1,
    does: 'The deck everything else bolts to.',
    dims: mm(L) + ' x ' + mm(W) + ' mm footprint, 4 mm thick (thickness is a kit assumption)',
    tweak: 'Change length_m or width_m in the spec and the whole kit follows — plate, wheel spacing and mounts are all derived from the same numbers.',
    print: 'Print flat as modeled. Suggestion: 3–4 walls, ~25% infill.',
  });

  parts.push({
    id: 'wheel', name: 'Wheel', file: 'parts/wheel.scad', qty: spec.wheel?.count ?? 0,
    does: 'Rolls on the ground; one per wheel position on the robot.',
    dims: mm(spec.wheel?.diameter_m ?? 0) + ' mm diameter x ' + mm(spec.wheel?.width_m ?? 0) + ' mm wide, 6 mm shaft hole (hole size is a kit assumption)',
    tweak: 'wheel.diameter_m is the number the motion gate grades. Change it and the twin, the CAD kit and the verdict all move together.',
    print: 'Print flat as modeled. Suggestion: print one first and check the shaft fit before printing the rest.',
  });

  parts.push({
    id: 'mount', name: 'Motor mount', file: 'parts/motor_mount.scad', qty: spec.wheel?.count ?? 0,
    does: 'Side plate that holds one drive motor so its shaft lines up with a wheel’s axle.',
    dims: 'one per wheel; shaft hole at axle height ' + mm(r) + ' mm (the wheel radius, from the spec)',
    tweak: 'The mount is derived, not drawn: its shaft height always equals the wheel radius, so it can never disagree with the wheel.',
    print: 'Suggestion: 40% infill — this part takes the motor’s twist. The motor itself is not a printed part.',
  });

  if (spec.wheel?.count === 2) {
    parts.push({
      id: 'caster', name: 'Caster', file: 'parts/caster.scad', qty: 2,
      does: 'Ball caster that keeps a two-wheel robot level (one front, one rear). Placeholder for a real ball-caster unit.',
      dims: 'ball diameter ' + mm(C) + ' mm — set by the spec’s ground clearance, so the ball tops out at the deck',
      tweak: 'Ground clearance comes from the spec; a taller clearance grows the caster ball to match.',
      print: 'Suggestion: expect a loose fit — sand or scale 1–2% for a snug cup. A bought ball caster rolls far better.',
    });
  }

  const lidar = (spec.sensors || []).find((s) => s.kind === 'lidar_2d');
  if (lidar) {
    const [lx, ly] = taPosXY(lidar.position, spec);
    parts.push({
      id: 'lidar', name: 'Lidar mount', file: 'parts/lidar_mount.scad', qty: 1,
      does: 'Post that raises the 2D lidar to the top of the robot so its scan plane clears the chassis.',
      dims: 'post rises from the deck to the spec’s overall height (' + mm(H) + ' mm); top disc ' + mm(LIDAR_DISC_D) + ' mm diameter (disc size is a kit assumption)',
      tweak: 'The post height is derived from the spec’s height_m — raise the robot and the lidar rises with it.',
      print: 'Print upright as modeled. Suggestion: ~25% infill; the lidar itself is not a printed part.',
      x: lx, y: ly,
    });
  }

  const cams = (spec.sensors || []).filter((s) => s.kind === 'rgb_camera' || s.kind === 'depth_camera');
  if (cams.length) {
    const [cx] = taPosXY(cams[0].position, spec);
    parts.push({
      id: 'camera', name: 'Camera bracket', file: 'parts/camera_bracket.scad', qty: cams.length,
      does: 'Bracket that holds a camera (' + cams[0].kind + ') at the ' + cams[0].position + ' of the robot.',
      dims: mm(CAM_W) + ' x ' + mm(CAM_H) + ' mm plate, 12 mm lens hole (bracket sizes are kit assumptions)',
      tweak: 'The kit ships one bracket file for every camera on the robot — edit it once, print it per camera.',
      print: 'Print flat as modeled. Suggestion: the lens hole is a visual guide — measure your camera before drilling.',
      face: cx >= 0 ? 1 : -1,
    });
  }

  const ultras = (spec.sensors || []).filter((s) => s.kind === 'ultrasonic');
  if (ultras.length) {
    const [ux] = taPosXY(ultras[0].position, spec);
    parts.push({
      id: 'ultrasonic', name: 'Ultrasonic bracket', file: 'parts/ultrasonic_bracket.scad', qty: ultras.length,
      does: 'Front mount carrying the ultrasonic sensor’s two round “eyes” (HC-SR04 style).',
      dims: 'twin ' + mm(ULTRA_CAN_D) + ' mm cans, 26 mm apart (HC-SR04 class sizes — kit assumptions)',
      tweak: 'Angle it straight ahead: a tilted sonar measures the floor, not the wall.',
      print: 'Print flat as modeled. Suggestion: the cans are visual placeholders for a real ultrasonic module.',
      face: ux >= 0 ? 1 : -1,
    });
  }
  return { parts, pos };
}

/* ---------------- 3D geometry (ta3d-geom block) ----------------
 * The SAME derivation as the 2D views, expressed as kit units in
 * robot coordinates (metres; x forward, y left, z up). Built from
 * taBuildParts' own output — the parts list and the wheel positions
 * — so the 3D scene can never grow a part the flat kit does not
 * have. Pure data — no DOM, no three.js: assets/js/robot3d.js (and
 * its port) turns the units into meshes. */
export function taGeom3d(spec: RobotSpec, parts: TaPart[], pos: [number, number][]): TaUnit[] {
  const cls = taClass(spec);
  if (cls === 'aerial') return taGeomAerial(spec, parts);
  if (cls === 'quadruped') return taGeomQuad(spec, parts);
  if (cls === 'humanoid') return taGeomHumanoid(spec, parts);
  if (cls === 'arm') return taGeomArm(spec, parts);
  const L = spec.length_m;
  const W = spec.width_m;
  const H = spec.height_m;
  const C = spec.ground_clearance_m ?? 0;
  const r = (spec.wheel?.diameter_m ?? 0) / 2;
  const deckTop = C + PLATE_T;
  const units: TaUnit[] = [];
  const byId = (id: string) => parts.find((p) => p.id === id);
  if (byId('plate')) {
    units.push({ part: 'plate', explode: [0, 0, 0], meshes: [
      { kind: 'box', size: [L, W, PLATE_T], center: [0, 0, C + PLATE_T / 2] }] });
  }
  pos.forEach(([x0, y0]) => {
    const ex = Math.sign(x0) * 0.7;
    const ey = Math.sign(y0);
    if (byId('wheel')) {
      units.push({ part: 'wheel', explode: [ex, ey, 0], meshes: [
        { kind: 'cyl', axis: 'y', size: [r, spec.wheel?.width_m ?? 0], center: [x0, y0, r] }] });
    }
    if (byId('mount')) {
      units.push({ part: 'mount', explode: [ex * 0.7, ey * 0.7, 0], meshes: [
        { kind: 'box', size: [(spec.wheel?.diameter_m ?? 0) * 0.36, 0.010, deckTop],
          center: [x0, Math.sign(y0) * (W / 2 + 0.005), deckTop / 2] }] });
    }
  });
  if (byId('caster')) {
    const cx = L / 2 - C;
    [-cx, cx].forEach((x0) => {
      units.push({ part: 'caster', explode: [Math.sign(x0) * 0.5, 0, -0.25], meshes: [
        { kind: 'sphere', size: [C / 2], center: [x0, 0, C / 2] }] });
    });
  }
  const lp = byId('lidar');
  if (lp) {
    const postH = H - 0.010 - deckTop;
    units.push({ part: 'lidar', explode: [0, 0, 1], meshes: [
      { kind: 'cyl', axis: 'z', size: [POST_D / 2, postH], center: [lp.x ?? 0, lp.y ?? 0, deckTop + postH / 2] },
      { kind: 'cyl', axis: 'z', size: [LIDAR_DISC_D / 2, 0.010], center: [lp.x ?? 0, lp.y ?? 0, H - 0.005] }] });
  }
  const cp = byId('camera');
  if (cp) {
    units.push({ part: 'camera', explode: [cp.face ?? 1, 0, 0.2], meshes: [
      { kind: 'box', size: [PLATE_T, CAM_W, CAM_H], center: [(cp.face ?? 1) * (L / 2 + PLATE_T / 2), 0, C + H / 2] }] });
  }
  const up = byId('ultrasonic');
  if (up) {
    units.push({ part: 'ultrasonic', explode: [up.face ?? 1, 0, 0.2], meshes: [
      { kind: 'box', size: [PLATE_T, 0.052, ULTRA_H],
        center: [(up.face ?? 1) * (L / 2 + PLATE_T / 2), 0, deckTop + ULTRA_H / 2] }] });
  }
  return units;
}

function taGeomAerial(spec: RobotSpec, parts: TaPart[]): TaUnit[] {
  const L = spec.length_m;
  const W = spec.width_m;
  const H = spec.height_m;
  const pd = spec.rotors?.prop_diameter_m ?? 0;
  const fz = H * 0.55; // frame plane height
  const units: TaUnit[] = [];
  const byId = (id: string) => parts.find((p) => p.id === id);
  if (byId('frame')) {
    units.push({ part: 'frame', explode: [0, 0, 0.25], meshes: [
      { kind: 'box', size: [L * 0.42, W * 0.42, 0.018], center: [0, 0, fz] }] });
  }
  taMotorXY(spec).forEach(([mx, my]) => {
    const ang = Math.atan2(my, mx);
    const reach = Math.hypot(mx, my) * 0.94;
    if (byId('arm')) {
      units.push({ part: 'arm',
        explode: [Math.sign(mx) * 0.35, Math.sign(my) * 0.35, 0.25],
        meshes: [{ kind: 'box', size: [reach, 0.016, 0.012], center: [mx / 2, my / 2, fz], rot: [0, 0, ang] }] });
    }
    if (byId('rotor')) {
      units.push({ part: 'rotor',
        explode: [Math.sign(mx) * 0.6, Math.sign(my) * 0.6, 0.7],
        meshes: [
          { kind: 'cyl', axis: 'z', size: [0.011, 0.016], center: [mx, my, fz + 0.004] },
          { kind: 'cyl', axis: 'z', size: [pd / 2, 0.002], center: [mx, my, fz + 0.016] }] });
    }
  });
  if (byId('battery')) {
    units.push({ part: 'battery', explode: [0, 0, -0.55], meshes: [
      { kind: 'box', size: [L * 0.38, W * 0.3, 0.026], center: [0, 0, fz - 0.026] }] });
  }
  if (byId('fc')) {
    units.push({ part: 'fc', explode: [0, 0, 1], meshes: [
      { kind: 'box', size: [0.042, 0.042, 0.02], center: [0, 0, fz + 0.02] }] });
  }
  const cp = byId('camera');
  if (cp) {
    units.push({ part: 'camera', explode: [0.8, 0, 0], meshes: [
      { kind: 'box', size: [0.012, 0.03, 0.02], center: [L * 0.21, 0, fz - 0.01] }] });
  }
  return units;
}

function taGeomQuad(spec: RobotSpec, parts: TaPart[]): TaUnit[] {
  const L = spec.length_m;
  const W = spec.width_m;
  const H = spec.height_m;
  const units: TaUnit[] = [];
  const byId = (id: string) => parts.find((p) => p.id === id);
  if (byId('body')) {
    units.push({ part: 'body', explode: [0, 0, 0.45], meshes: [
      { kind: 'box', size: [L * 0.92, W * 0.9, H * 0.36], center: [0, 0, H * 0.8] }] });
  }
  if (byId('leg')) {
    const hx = L * 0.36;
    const hy = W * 0.44;
    ([[hx, hy], [hx, -hy], [-hx, hy], [-hx, -hy]] as [number, number][])
      .slice(0, spec.legs?.count ?? 0)
      .forEach(([x0, y0]) => {
        const bend = Math.sign(x0) * L * 0.045; // knees bow outward
        units.push({ part: 'leg',
          explode: [Math.sign(x0) * 0.35, Math.sign(y0) * 0.65, -0.1],
          meshes: [
            { kind: 'box', size: [0.032, 0.026, H * 0.34], center: [x0 + bend / 2, y0, H * 0.45] },
            { kind: 'box', size: [0.024, 0.02, H * 0.34], center: [x0 + bend, y0, H * 0.17] }] });
      });
  }
  if (byId('head')) {
    units.push({ part: 'head', explode: [0.85, 0, 0.25], meshes: [
      { kind: 'box', size: [L * 0.17, W * 0.52, H * 0.2], center: [L * 0.52, 0, H * 0.84] }] });
  }
  if (byId('battery')) {
    units.push({ part: 'battery', explode: [0, 0, 1], meshes: [
      { kind: 'box', size: [L * 0.42, W * 0.5, H * 0.15], center: [-L * 0.08, 0, H * 0.8] }] });
  }
  return units;
}

function taGeomHumanoid(spec: RobotSpec, parts: TaPart[]): TaUnit[] {
  const L = spec.length_m;
  const W = spec.width_m;
  const H = spec.height_m;
  const units: TaUnit[] = [];
  const byId = (id: string) => parts.find((p) => p.id === id);
  if (byId('leg')) {
    [W * 0.22, -W * 0.22].slice(0, spec.legs?.count ?? 0).forEach((y0) => {
      units.push({ part: 'leg',
        explode: [0, Math.sign(y0) * 0.55, -0.05],
        meshes: [
          { kind: 'box', size: [H * 0.05, H * 0.042, H * 0.25], center: [0, y0, H * 0.375] },
          { kind: 'box', size: [H * 0.042, H * 0.036, H * 0.25], center: [H * 0.008, y0, H * 0.125] },
          { kind: 'box', size: [H * 0.115, H * 0.05, H * 0.028], center: [H * 0.032, y0, H * 0.014] }] });
    });
  }
  if (byId('pelvis')) {
    units.push({ part: 'pelvis', explode: [0, 0, 0.1], meshes: [
      { kind: 'box', size: [H * 0.095, W * 0.82, H * 0.09], center: [0, 0, H * 0.545] }] });
  }
  if (byId('torso')) {
    units.push({ part: 'torso', explode: [0, 0, 0.55], meshes: [
      { kind: 'box', size: [L * 0.62, W * 0.94, H * 0.3], center: [0, 0, H * 0.74] }] });
  }
  if (byId('arm')) {
    [W / 2 + H * 0.03, -(W / 2 + H * 0.03)].slice(0, spec.arms?.count ?? 0).forEach((y0) => {
      units.push({ part: 'arm',
        explode: [0, Math.sign(y0) * 0.8, 0.25],
        meshes: [
          { kind: 'box', size: [H * 0.038, H * 0.032, H * 0.19], center: [0, y0, H * 0.775] },
          { kind: 'box', size: [H * 0.032, H * 0.027, H * 0.17], center: [H * 0.012, y0, H * 0.595] }] });
    });
  }
  if (byId('head')) {
    units.push({ part: 'head', explode: [0, 0, 1], meshes: [
      { kind: 'box', size: [H * 0.095, H * 0.1, H * 0.115], center: [0, 0, H * 0.945] }] });
  }
  if (byId('battery')) {
    units.push({ part: 'battery', explode: [-0.8, 0, 0.4], meshes: [
      { kind: 'box', size: [H * 0.045, W * 0.52, H * 0.17], center: [-L * 0.3, 0, H * 0.74] }] });
  }
  return units;
}

function taGeomArm(spec: RobotSpec, parts: TaPart[]): TaUnit[] {
  const R = spec.length_m;
  const H = spec.height_m;
  const units: TaUnit[] = [];
  const byId = (id: string) => parts.find((p) => p.id === id);
  if (byId('base')) {
    units.push({ part: 'base', explode: [0, 0, 0], meshes: [
      { kind: 'cyl', axis: 'z', size: [Math.min(0.06, R * 0.16), 0.03], center: [0, 0, 0.015] }] });
  }
  if (byId('link')) {
    const segs = [
      { size: [0.046, 0.04, H * 0.42] as number[], center: [0, 0, H * 0.24] as [number, number, number] },
      { size: [R * 0.52, 0.034, 0.03] as number[], center: [R * 0.26, 0, H * 0.47] as [number, number, number] },
      { size: [R * 0.34, 0.028, 0.025] as number[], center: [R * 0.62, 0, H * 0.4] as [number, number, number] },
    ].slice(0, spec.arms?.segments ?? 0);
    segs.forEach((m, i) => {
      units.push({ part: 'link',
        explode: [0.25 * (i + 1), 0, 0.3 * (i + 1)],
        meshes: [{ kind: 'box', size: m.size, center: m.center }] });
    });
  }
  if (byId('gripper')) {
    units.push({ part: 'gripper', explode: [0.9, 0, 0.1], meshes: [
      { kind: 'box', size: [0.045, 0.012, 0.035], center: [R * 0.83, spec.width_m / 4, H * 0.36] },
      { kind: 'box', size: [0.045, 0.012, 0.035], center: [R * 0.83, -spec.width_m / 4, H * 0.36] }] });
  }
  if (byId('battery')) {
    units.push({ part: 'battery', explode: [-0.5, -0.6, 0], meshes: [
      { kind: 'box', size: [0.095, 0.055, 0.032], center: [-R * 0.34, -R * 0.34, 0.016] }] });
  }
  return units;
}

/* ---------------- electrical overlay logic (elec-logic block) ----------------
 * Pure logic over a wiring block: supply depths, power-on stages,
 * provable over-voltage detection, labels and per-node status. */
export function elecNodeMap(w: WiringBlock): Record<string, WiringBlock['nodes'][number]> {
  const m: Record<string, WiringBlock['nodes'][number]> = {};
  (w.nodes || []).forEach((n) => { m[n.id] = n; });
  return m;
}
export function elecDepths(w: WiringBlock): Record<string, number> {
  const depth: Record<string, number> = {};
  (w.nodes || []).forEach((n) => { depth[n.id] = Infinity; });
  if (!Object.prototype.hasOwnProperty.call(depth, 'battery')) return depth;
  depth.battery = 0;
  let grew = true;
  while (grew) {
    grew = false;
    (w.connections || []).forEach((c) => {
      if (depth[c.from] !== Infinity && depth[c.to] === Infinity) {
        depth[c.to] = depth[c.from] + 1;
        grew = true;
      }
    });
  }
  return depth;
}
export function elecStage(w: WiringBlock, depth: Record<string, number>, i: number): number {
  const d = depth[w.connections[i].from];
  return d === Infinity ? Infinity : d + 1;
}
export function elecBad(w: WiringBlock): Set<number> {
  const nodes = elecNodeMap(w);
  const bad = new Set<number>();
  (w.connections || []).forEach((c, i) => {
    const t = nodes[c.to];
    if (c.kind === 'power' && c.volts != null && t && t.rated_max_v != null && c.volts > t.rated_max_v) bad.add(i);
  });
  return bad;
}
export function elecVolts(v: number | null | undefined): string {
  return v == null ? 'not specified' : Math.round(v * 10) / 10 + ' V';
}
export function elecConnLabel(w: WiringBlock, i: number): string {
  const c = w.connections[i];
  const nodes = elecNodeMap(w);
  const a = nodes[c.from] ? nodes[c.from].label : c.from;
  const b = nodes[c.to] ? nodes[c.to].label : c.to;
  return a + ' → ' + b + ' · ' + c.kind +
    (c.kind === 'power' ? ' · ' + elecVolts(c.volts) : '') +
    (c.label ? ' — ' + c.label : '');
}
export function elecNodeStatus(
  w: WiringBlock,
  id: string,
): { state: 'bad' | 'ok' | 'unchecked'; feeds: WiringConnection[]; reason: string } {
  const nodes = elecNodeMap(w);
  const node = nodes[id];
  const bad = elecBad(w);
  const feeds: WiringConnection[] = [];
  let state: 'bad' | 'ok' | 'unchecked' = 'unchecked';
  let reason = 'no feed is recorded for it';
  (w.connections || []).forEach((c, i) => {
    if (c.to !== id || c.kind !== 'power') return;
    feeds.push(c);
    if (bad.has(i)) state = 'bad';
    else if (c.volts != null && node && node.rated_max_v != null && state === 'unchecked') state = 'ok';
  });
  if (feeds.length && state === 'unchecked') {
    reason = feeds.every((c) => c.volts == null)
      ? 'its feed carries no fixed voltage (PWM or an unspecified rail)'
      : 'the part has no recorded rated maximum to check against';
  }
  return { state, feeds, reason };
}

/* ---------------- electrical overlay + dimensions (SVG) ---------------- */
function elecShortLabel(node: WiringBlock['nodes'][number]): string {
  return node.label.split(' — ')[0].split(' (')[0];
}
export function elecRails(w: WiringBlock): Record<string, [number, number]> {
  /* deck node id -> [xPx, yPx] on a 700-wide view: first half of the
     deck nodes on the upper rail (y=15), the rest on y=43. */
  const deck = w.nodes.filter((n) => n.deck);
  const half = Math.ceil(deck.length / 2);
  const pos: Record<string, [number, number]> = {};
  deck.forEach((n, i) => {
    const rail = i < half ? 0 : 1;
    const k = rail ? i - half : i;
    const count = rail ? deck.length - half : half;
    pos[n.id] = [((k + 1) * 700) / (count + 1), rail ? 43 : 15];
  });
  return pos;
}
function elecAnchorsTop(
  spec: RobotSpec, parts: TaPart[], w: WiringBlock,
  X: (v: number) => number, Y: (v: number) => number,
): Record<string, [number, number]> {
  const pos = elecRails(w);
  const lp = parts.find((p) => p.id === 'lidar');
  const cp = parts.find((p) => p.id === 'camera');
  const up = parts.find((p) => p.id === 'ultrasonic');
  w.nodes.forEach((n) => {
    if (pos[n.id]) return;
    if (n.kit === 'lidar' && lp) pos[n.id] = [X(lp.x ?? 0), Y(lp.y ?? 0)];
    else if (n.kit === 'camera' && cp) pos[n.id] = [X((cp.face ?? 1) * spec.length_m / 2), Y(0)];
    else if (n.kit === 'ultrasonic' && up) pos[n.id] = [X((up.face ?? 1) * spec.length_m / 2), Y(0)];
  });
  return pos;
}
function elecAnchorsSide(
  spec: RobotSpec, parts: TaPart[], w: WiringBlock,
  X: (v: number) => number, Z: (v: number) => number,
): Record<string, [number, number]> {
  const pos = elecRails(w);
  const C = spec.ground_clearance_m ?? 0;
  const H = spec.height_m;
  const deckTop = C + PLATE_T;
  const lp = parts.find((p) => p.id === 'lidar');
  const cp = parts.find((p) => p.id === 'camera');
  const up = parts.find((p) => p.id === 'ultrasonic');
  w.nodes.forEach((n) => {
    if (pos[n.id]) return;
    if (n.kit === 'lidar' && lp) pos[n.id] = [X(lp.x ?? 0), Z(H)];
    else if (n.kit === 'camera' && cp) pos[n.id] = [X((cp.face ?? 1) * spec.length_m / 2), Z(C + H / 2)];
    else if (n.kit === 'ultrasonic' && up) pos[n.id] = [X((up.face ?? 1) * spec.length_m / 2), Z(deckTop + ULTRA_H / 2)];
  });
  return pos;
}
function elecChip(n: WiringBlock['nodes'][number], cx: number, cy: number, cls: string, depth: number): string {
  const label = elecShortLabel(n);
  const wpx = Math.min(168, Math.max(label.length * 5.9, n.req_label.length * 5.4) + 16);
  return '<g class="node-chip ' + cls + '" data-node="' + n.id + '" data-depth="' +
    (depth === Infinity ? 'inf' : depth) + '" tabindex="0" role="button" aria-label="' +
    esc(n.label) + '"><rect x="' + (cx - wpx / 2) + '" y="' + (cy - 13) +
    '" width="' + wpx + '" height="27" rx="6"/>' +
    '<text class="nl" x="' + cx + '" y="' + (cy - 1) + '" text-anchor="middle">' +
    esc(label) + '</text>' +
    '<text class="req" x="' + cx + '" y="' + (cy + 10) + '" text-anchor="middle">' +
    esc(n.req_label) + '</text></g>';
}
export function elecOverlaySVG(
  w: WiringBlock,
  anchors: Record<string, [number, number]>,
  view: TaViewState,
): string {
  const nodes = elecNodeMap(w);
  const depth = elecDepths(w);
  const bad = elecBad(w);
  const pairCount: Record<string, number> = {};
  const pairSeen: Record<string, number> = {};
  w.connections.forEach((c) => {
    const k = [c.from, c.to].sort().join('|');
    pairCount[k] = (pairCount[k] || 0) + 1;
  });
  let wires = '';
  let chips = '';
  let labels = '';
  w.connections.forEach((c, i) => {
    const a = anchors[c.from];
    const b = anchors[c.to];
    if (!a || !b) return;
    const k = [c.from, c.to].sort().join('|');
    const seen = pairSeen[k] || 0;
    pairSeen[k] = seen + 1;
    const off = (seen - (pairCount[k] - 1) / 2) * 16;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const cx = (a[0] + b[0]) / 2 + (-dy / len) * off;
    const cy = (a[1] + b[1]) / 2 + (dx / len) * off;
    const d = 'M' + a[0] + ' ' + a[1] + ' Q' + cx + ' ' + cy + ' ' + b[0] + ' ' + b[1];
    const mx = 0.25 * a[0] + 0.5 * cx + 0.25 * b[0];
    const my = 0.25 * a[1] + 0.5 * cy + 0.25 * b[1];
    const stage = elecStage(w, depth, i);
    const on = view.power && stage <= view.elecStage;
    const isBad = bad.has(i);
    wires += '<g class="wire-g' + (isBad ? ' bad' : '') + (on ? ' on' : '') +
      (view.selWire === i ? ' sel' : '') + '" data-conn="' + i + '" data-stage="' +
      (stage === Infinity ? 'inf' : stage) + '">' +
      '<path class="wire-hit" d="' + d + '"/>' +
      '<path class="wire ' + c.kind + (isBad ? ' bad' : '') + (on ? ' on' : '') +
      '" d="' + d + '"/>' +
      (isBad ? '<text class="wire-badtag" x="' + mx + '" y="' + (my - 8) +
        '" text-anchor="middle">⚠ over-voltage</text>' : '') +
      '<text class="wire-label" x="' + mx + '" y="' + (my + 15) +
      '" text-anchor="middle">' + esc(c.kind +
        (c.kind === 'power' ? ' · ' + elecVolts(c.volts) : '')) +
      '</text></g>';
  });
  w.nodes.forEach((n) => {
    const a = anchors[n.id];
    if (!a) return;
    if (n.deck) {
      const on = view.power && depth[n.id] <= view.elecStage;
      const isBad = [...bad].some((i) => w.connections[i].to === n.id);
      chips += elecChip(n, a[0], a[1],
        (on ? 'on' : '') + (isBad ? ' bad' : '') + (view.selNode === n.id ? ' sel' : ''),
        depth[n.id]);
    } else {
      labels += '<text class="req-label" x="' + a[0] + '" y="' + (a[1] - 12) +
        '" text-anchor="middle">' + esc(n.req_label) + '</text>';
    }
  });
  return wires + chips + labels;
}

/* dimension lines: values only from the spec, drawn at the spec's
   (unexploded) geometry — measurements of the robot, not the layout */
function dimH(x1: number, x2: number, y: number, text: string): string {
  return '<g class="dim"><line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '"/>' +
    '<line x1="' + x1 + '" y1="' + (y - 4) + '" x2="' + x1 + '" y2="' + (y + 4) + '"/>' +
    '<line x1="' + x2 + '" y1="' + (y - 4) + '" x2="' + x2 + '" y2="' + (y + 4) + '"/>' +
    '<text x="' + ((x1 + x2) / 2) + '" y="' + (y - 5) + '" text-anchor="middle">' +
    text + '</text></g>';
}
function dimV(x: number, yTop: number, yBot: number, text: string, anchor: string): string {
  const tx = anchor === 'end' ? x - 5 : x + 5;
  return '<g class="dim"><line x1="' + x + '" y1="' + yTop + '" x2="' + x + '" y2="' + yBot + '"/>' +
    '<line x1="' + (x - 4) + '" y1="' + yTop + '" x2="' + (x + 4) + '" y2="' + yTop + '"/>' +
    '<line x1="' + (x - 4) + '" y1="' + yBot + '" x2="' + (x + 4) + '" y2="' + yBot + '"/>' +
    '<text x="' + tx + '" y="' + ((yTop + yBot) / 2 + 3.5) + '" text-anchor="' +
    anchor + '">' + text + '</text></g>';
}
function dimVR(x: number, yTop: number, yBot: number, text: string): string {
  const my = (yTop + yBot) / 2;
  return '<g class="dim"><line x1="' + x + '" y1="' + yTop + '" x2="' + x + '" y2="' + yBot + '"/>' +
    '<line x1="' + (x - 4) + '" y1="' + yTop + '" x2="' + (x + 4) + '" y2="' + yTop + '"/>' +
    '<line x1="' + (x - 4) + '" y1="' + yBot + '" x2="' + (x + 4) + '" y2="' + yBot + '"/>' +
    '<text transform="rotate(-90 ' + (x - 6) + ' ' + my + ')" x="' + (x - 6) +
    '" y="' + my + '" text-anchor="middle">' + text + '</text></g>';
}
function taDimsSide(
  spec: RobotSpec, pos: [number, number][],
  X: (v: number) => number, Z: (v: number) => number, S: number,
): string {
  const L = spec.length_m;
  const H = spec.height_m;
  const C = spec.ground_clearance_m ?? 0;
  const D = spec.wheel?.diameter_m ?? 0;
  const r = D / 2;
  const wxF = Math.max(...pos.map((p) => p[0]));
  const cx = X(wxF);
  const cy = Z(r);
  const dd = r * S * 0.7071;
  let s = '';
  s += '<g class="dim"><line x1="' + (cx - dd) + '" y1="' + (cy + dd) +
    '" x2="' + (cx + dd) + '" y2="' + (cy - dd) + '"/>' +
    '<text x="' + cx + '" y="' + (Z(2 * r) - 6) + '" text-anchor="middle">' +
    'Ø ' + mm(D) + ' mm</text></g>';
  s += dimV(X(-L / 2) - 12, Z(C), Z(0), mm(C) + ' mm', 'end');
  s += dimV(X(L / 2) + 14, Z(H), Z(0), mm(H) + ' mm', 'start');
  s += dimH(X(-L / 2), X(L / 2), Z(0) + 30, mm(L) + ' mm');
  return s;
}
function taDimsTop(
  spec: RobotSpec, pos: [number, number][],
  X: (v: number) => number, Y: (v: number) => number, yMin: number,
): string {
  const L = spec.length_m;
  const W = spec.width_m;
  const D = spec.wheel?.diameter_m ?? 0;
  const wy = spec.width_m / 2 + (spec.wheel?.width_m ?? 0) / 2;
  const wxF = Math.max(...pos.map((p) => p[0]));
  let s = '';
  s += '<text class="dim-note" x="' + X(wxF) + '" y="' +
    (Y(wy - (spec.wheel?.width_m ?? 0) / 2) + 16) + '" text-anchor="middle">' +
    'Ø ' + mm(D) + ' mm</text>';
  s += dimVR(X(-L / 2) - 14, Y(W / 2), Y(-W / 2), mm(W) + ' mm');
  s += dimH(X(-L / 2), X(L / 2), Y(yMin) + 18, mm(L) + ' mm');
  return s;
}

/* --- SVG rendering --- */
function svgEl(inner: string, vb: string, w: number): string {
  return '<svg viewBox="' + vb + '" width="100%" role="img" style="max-width:' + w + 'px;display:block">' + inner + '</svg>';
}
function shapeAttrs(id: string, view: TaViewState): string {
  return ' class="part-shape' + (view.selected === id ? ' sel' : '') + '" data-part="' + id + '" tabindex="0" role="button" aria-label="' + id + '"';
}

export function taRenderSide(spec: RobotSpec, parts: TaPart[], pos: [number, number][], view: TaViewState): string {
  const L = spec.length_m;
  const H = spec.height_m;
  const C = spec.ground_clearance_m ?? 0;
  const r = (spec.wheel?.diameter_m ?? 0) / 2;
  const e = view.explode / 1000;
  const deckTop = C + PLATE_T;
  const xs = [...new Set(pos.map((p) => p[0]))];
  const xMin = -L / 2 - r - e - 0.03;
  const xMax = L / 2 + r + e + 0.03;
  const zMax = H + e + 0.03;
  const Wpx = 700;
  const Hpx = 330;
  const pad = 14;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / zMax);
  const ox = pad - xMin * S;
  const gy = Hpx - pad; // ground line y (z = 0)
  const X = (x: number) => ox + x * S;
  const Z = (z: number) => gy - z * S;
  let s = '';
  s += '<line x1="4" y1="' + Z(0) + '" x2="' + (Wpx - 4) + '" y2="' + Z(0) + '" stroke="#454c59" stroke-width="2"/>';
  s += '<text x="8" y="' + (Z(0) + 16) + '" fill="#9aa3ae" font-size="11">ground (z = 0)</text>';
  /* chassis plate */
  s += '<g' + shapeAttrs('plate', view) + '><rect x="' + X(-L / 2) + '" y="' + Z(deckTop) +
    '" width="' + L * S + '" height="' + PLATE_T * S + '" rx="3" fill="#8a5a17" stroke="#f59e0b" stroke-width="1.4"/></g>';
  /* casters */
  if (spec.wheel?.count === 2) {
    const cx = L / 2 - C;
    [-cx, cx].forEach((x0) => {
      const dx = Math.sign(x0) * e;
      s += '<g' + shapeAttrs('caster', view) + '><circle cx="' + X(x0 + dx) + '" cy="' + Z(C / 2 - e * 0.25) +
        '" r="' + (C / 2) * S + '" fill="#5b6472" stroke="#9aa3ae" stroke-width="1.2"/></g>';
    });
  }
  /* motor mounts (one rect per distinct wheel x) */
  const mw = Math.max(spec.wheel?.width_m ?? 0, 0.024);
  xs.forEach((x0) => {
    const dx = Math.sign(x0) * e * 0.7;
    s += '<g' + shapeAttrs('mount', view) + '><rect x="' + X(x0 + dx - mw / 2) + '" y="' + Z(deckTop) +
      '" width="' + mw * S + '" height="' + deckTop * S + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  });
  /* wheels (side view: +/- y pairs overlap) */
  xs.forEach((x0) => {
    const dx = Math.sign(x0) * e * 0.7;
    const dz = x0 === 0 ? -e * 0.8 : 0;
    s += '<g' + shapeAttrs('wheel', view) + '><circle cx="' + X(x0 + dx) + '" cy="' + Z(r + dz) +
      '" r="' + r * S + '" fill="#22262e" stroke="#e8eaee" stroke-width="2"/>' +
      '<circle cx="' + X(x0 + dx) + '" cy="' + Z(r + dz) + '" r="' + r * S * 0.32 +
      '" fill="none" stroke="#9aa3ae" stroke-width="1.4"/></g>';
  });
  /* lidar */
  const lp = parts.find((p) => p.id === 'lidar');
  if (lp) {
    s += '<g' + shapeAttrs('lidar', view) + '>' +
      '<rect x="' + X((lp.x ?? 0) - POST_D / 2) + '" y="' + Z(H - 0.010 + e) + '" width="' + POST_D * S +
      '" height="' + (H - 0.010 - deckTop + e) * S + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/>' +
      '<rect x="' + X((lp.x ?? 0) - LIDAR_DISC_D / 2) + '" y="' + Z(H + e) + '" width="' + LIDAR_DISC_D * S +
      '" height="' + 0.010 * S + '" rx="3" fill="#22262e" stroke="#e8eaee" stroke-width="1.6"/></g>';
  }
  /* camera */
  const cp = parts.find((p) => p.id === 'camera');
  if (cp) {
    const fx = (cp.face ?? 1) * (L / 2 + e) + ((cp.face ?? 1) > 0 ? 0 : -PLATE_T);
    const zb = C + H / 2 + e * 0.2;
    s += '<g' + shapeAttrs('camera', view) + '><rect x="' + X(fx) + '" y="' + Z(zb + CAM_H / 2) +
      '" width="' + PLATE_T * S + '" height="' + CAM_H * S + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  /* ultrasonic */
  const up = parts.find((p) => p.id === 'ultrasonic');
  if (up) {
    const fx = (up.face ?? 1) * (L / 2 + e) + ((up.face ?? 1) > 0 ? 0 : -PLATE_T);
    const zb = deckTop + e * 0.2;
    s += '<g' + shapeAttrs('ultrasonic', view) + '><rect x="' + X(fx) + '" y="' + Z(zb + ULTRA_H) +
      '" width="' + PLATE_T * S + '" height="' + ULTRA_H * S + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/>' +
      '<circle cx="' + X((up.face ?? 1) * (L / 2 + e) + (up.face ?? 1) * PLATE_T) + '" cy="' + Z(zb + ULTRA_H / 2) +
      '" r="' + (ULTRA_CAN_D / 2) * S + '" fill="#22262e" stroke="#e8eaee" stroke-width="1.2"/></g>';
  }
  if (view.elec && spec.wiring) {
    s += elecOverlaySVG(spec.wiring, elecAnchorsSide(spec, parts, spec.wiring, X, Z), view);
  }
  s += taDimsSide(spec, pos, X, Z, S);
  return svgEl(s, '0 0 ' + Wpx + ' ' + (Hpx + 38), 700);
}

export function taRenderTop(spec: RobotSpec, parts: TaPart[], pos: [number, number][], view: TaViewState): string {
  const L = spec.length_m;
  const W = spec.width_m;
  const e = view.explode / 1000;
  const wy = spec.width_m / 2 + (spec.wheel?.width_m ?? 0) / 2;
  const xMin = -L / 2 - e - 0.03;
  const xMax = L / 2 + e + 0.03;
  const yMin = -wy - (spec.wheel?.width_m ?? 0) / 2 - e - 0.03;
  const yMax = -yMin;
  const Wpx = 700;
  const Hpx = 300;
  const pad = 14;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / (yMax - yMin));
  const ox = pad - xMin * S;
  const oy = pad - yMin * S;
  const X = (x: number) => ox + x * S;
  const Y = (y: number) => oy - y * S; // +y to the left of screen-up = robot left
  let s = '';
  s += '<g' + shapeAttrs('plate', view) + '><rect x="' + X(-L / 2) + '" y="' + Y(W / 2) +
    '" width="' + L * S + '" height="' + W * S + '" rx="6" fill="#8a5a17" stroke="#f59e0b" stroke-width="1.4"/></g>';
  if (spec.wheel?.count === 2) {
    const cx = L / 2 - (spec.ground_clearance_m ?? 0);
    [-cx, cx].forEach((x0) => {
      s += '<g' + shapeAttrs('caster', view) + '><circle cx="' + X(x0 + Math.sign(x0) * e * 0.5) + '" cy="' + Y(0) +
        '" r="' + ((spec.ground_clearance_m ?? 0) / 2) * S + '" fill="#5b6472" stroke="#9aa3ae" stroke-width="1.2"/></g>';
    });
  }
  pos.forEach(([x0, y0]) => {
    const dy = Math.sign(y0) * e;
    s += '<g' + shapeAttrs('mount', view) + '><rect x="' + X(x0 - (spec.wheel?.diameter_m ?? 0) * 0.18) +
      '" y="' + Y(Math.sign(y0) * (W / 2 - 0.002)) + '" width="' + (spec.wheel?.diameter_m ?? 0) * 0.36 * S +
      '" height="' + 0.010 * S + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1"/></g>';
    s += '<g' + shapeAttrs('wheel', view) + '><rect x="' + X(x0 - (spec.wheel?.diameter_m ?? 0) / 2) +
      '" y="' + Y(y0 + dy + (spec.wheel?.width_m ?? 0) / 2) + '" width="' + (spec.wheel?.diameter_m ?? 0) * S +
      '" height="' + (spec.wheel?.width_m ?? 0) * S + '" rx="4" fill="#22262e" stroke="#e8eaee" stroke-width="1.8"/></g>';
  });
  const lp = parts.find((p) => p.id === 'lidar');
  if (lp) {
    s += '<g' + shapeAttrs('lidar', view) + '><circle cx="' + X(lp.x ?? 0) + '" cy="' + Y(lp.y ?? 0) +
      '" r="' + (LIDAR_DISC_D / 2) * S + '" fill="#22262e" stroke="#e8eaee" stroke-width="1.6"/></g>';
  }
  const cp = parts.find((p) => p.id === 'camera');
  if (cp) {
    s += '<g' + shapeAttrs('camera', view) + '><rect x="' + X((cp.face ?? 1) * (L / 2 + e) + ((cp.face ?? 1) > 0 ? 0 : -PLATE_T)) +
      '" y="' + Y(CAM_W / 2) + '" width="' + PLATE_T * S + '" height="' + CAM_W * S +
      '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  const up = parts.find((p) => p.id === 'ultrasonic');
  if (up) {
    s += '<g' + shapeAttrs('ultrasonic', view) + '><rect x="' + X((up.face ?? 1) * (L / 2 + e) + ((up.face ?? 1) > 0 ? 0 : -PLATE_T)) +
      '" y="' + Y(0.026) + '" width="' + PLATE_T * S + '" height="' + 0.052 * S +
      '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (view.elec && spec.wiring) {
    s += elecOverlaySVG(spec.wiring, elecAnchorsTop(spec, parts, spec.wiring, X, Y), view);
  }
  s += taDimsTop(spec, pos, X, Y, yMin);
  const vbH = Math.max(Hpx, Y(yMin) + 44);
  s += '<text x="' + (Wpx - 8) + '" y="' + (vbH - 6) + '" fill="#9aa3ae" font-size="11" text-anchor="end">front is to the right</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + vbH, 700);
}

/* --- Class views (aerial / quadruped / humanoid / arm) ---
 * The same schematic language as the ground views — same palette,
 * same explode slider, same click-a-part groups, dimension lines
 * from the spec's numbers only. */
function taClassFrame(xMin: number, xMax: number, zMax: number, Hpx: number) {
  const Wpx = 700;
  const pad = 14;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / zMax);
  const ox = pad - xMin * S;
  const gy = Hpx - pad;
  return {
    Wpx, Hpx, S,
    X: (x: number) => ox + x * S,
    Z: (z: number) => gy - z * S,
  };
}
function taGroundLine(Z: (v: number) => number, Wpx: number, label: string): string {
  return '<line x1="4" y1="' + Z(0) + '" x2="' + (Wpx - 4) + '" y2="' + Z(0) +
    '" stroke="#454c59" stroke-width="2"/>' +
    '<text x="8" y="' + (Z(0) + 16) + '" fill="#9aa3ae" font-size="11">' +
    label + '</text>';
}
function taElecOverlay(spec: RobotSpec, view: TaViewState): string {
  return view.elec && spec.wiring
    ? elecOverlaySVG(spec.wiring, elecRails(spec.wiring), view)
    : '';
}

function taRenderAerialSide(spec: RobotSpec, parts: TaPart[], view: TaViewState): string {
  const L = spec.length_m;
  const H = spec.height_m;
  const pd = spec.rotors?.prop_diameter_m ?? 0;
  const e = view.explode / 1000;
  const fz = H * 0.55;
  const { Wpx, S, X, Z } = taClassFrame(-L / 2 - pd / 2 - e - 0.03, L / 2 + pd / 2 + e + 0.03, H + e + 0.05, 300);
  const byId = (id: string) => parts.find((p) => p.id === id);
  let s = taGroundLine(Z, Wpx, 'ground (z = 0)');
  [-L / 2, L / 2].forEach((mx) => {
    s += '<line x1="' + X(mx) + '" y1="' + Z(fz) + '" x2="' + X(mx) +
      '" y2="' + Z(0) + '" stroke="#454c59" stroke-width="1" stroke-dasharray="3 4"/>';
  });
  if (byId('battery')) {
    const bw = L * 0.38 * S;
    const bh = 0.026 * S;
    s += '<g' + shapeAttrs('battery', view) + '><rect x="' + (X(0) - bw / 2) +
      '" y="' + Z(fz - 0.013 - e * 0.55) + '" width="' + bw + '" height="' + bh +
      '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('frame')) {
    const fw = L * 0.42 * S;
    s += '<g' + shapeAttrs('frame', view) + '><rect x="' + (X(0) - fw / 2) +
      '" y="' + Z(fz + 0.009 + e * 0.25) + '" width="' + fw + '" height="' +
      0.018 * S + '" rx="3" fill="#8a5a17" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  [-1, 1].forEach((sd) => {
    const mx = (sd * L) / 2;
    const ex = sd * e;
    if (byId('arm')) {
      s += '<g' + shapeAttrs('arm', view) + '><line x1="' + X(sd * L * 0.2) +
        '" y1="' + Z(fz + e * 0.25) + '" x2="' + X(mx + ex * 0.35) +
        '" y2="' + Z(fz + e * 0.25) + '" stroke="#9aa3ae" stroke-width="5"/></g>';
    }
    if (byId('rotor')) {
      const rx = mx + ex * 0.6;
      const rz = fz + e * 0.7;
      s += '<g' + shapeAttrs('rotor', view) + '><rect x="' + (X(rx) - (0.011 * S) / 2) +
        '" y="' + Z(rz + 0.012) + '" width="' + 0.011 * S + '" height="' +
        0.016 * S + '" fill="#22262e" stroke="#e8eaee" stroke-width="1.2"/>' +
        '<line x1="' + X(rx - pd / 2) + '" y1="' + Z(rz + 0.016) + '" x2="' +
        X(rx + pd / 2) + '" y2="' + Z(rz + 0.016) + '" stroke="#e8eaee" stroke-width="2.4"/></g>';
    }
  });
  if (byId('fc')) {
    const fw = 0.042 * S;
    s += '<g' + shapeAttrs('fc', view) + '><rect x="' + (X(0) - fw / 2) +
      '" y="' + Z(fz + 0.03 + e) + '" width="' + fw + '" height="' + 0.02 * S +
      '" rx="2" fill="#22262e" stroke="#34d399" stroke-width="1.4"/></g>';
  }
  if (byId('camera')) {
    s += '<g' + shapeAttrs('camera', view) + '><rect x="' + X(L * 0.21 + e * 0.8) +
      '" y="' + Z(fz - 0.02) + '" width="' + 0.012 * S + '" height="' +
      0.02 * S + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  s += taElecOverlay(spec, view);
  s += dimH(X(-L / 2), X(L / 2), Z(0) + 30, mm(L) + ' mm motor-to-motor');
  s += dimV(X(L / 2 + pd / 2) + 14, Z(H), Z(0), mm(H) + ' mm', 'start');
  s += '<text class="dim-note" x="' + X(-L / 2) + '" y="' + (Z(fz + 0.016) - 8) +
    '" text-anchor="middle">Ø ' + mm(pd) + ' mm prop</text>';
  return svgEl(s, '0 0 ' + Wpx + ' 338', 700);
}
function taRenderAerialTop(spec: RobotSpec, parts: TaPart[], view: TaViewState): string {
  const L = spec.length_m;
  const W = spec.width_m;
  const pd = spec.rotors?.prop_diameter_m ?? 0;
  const e = view.explode / 1000;
  const ext = Math.max(L, W) / 2 + pd / 2 + e + 0.03;
  const Wpx = 700;
  const Hpx = 320;
  const pad = 14;
  const S = Math.min((Wpx - 2 * pad) / (2 * ext), (Hpx - 2 * pad) / (2 * ext));
  const ox = Wpx / 2;
  const oy = Hpx / 2;
  const X = (x: number) => ox + x * S;
  const Y = (y: number) => oy - y * S;
  const byId = (id: string) => parts.find((p) => p.id === id);
  let s = '';
  taMotorXY(spec).forEach(([mx, my]) => {
    const ex = Math.sign(mx) * e * 0.6;
    const ey = Math.sign(my) * e * 0.6;
    if (byId('arm')) {
      s += '<g' + shapeAttrs('arm', view) + '><line x1="' + X(0) + '" y1="' + Y(0) +
        '" x2="' + X(mx + ex) + '" y2="' + Y(my + ey) +
        '" stroke="#9aa3ae" stroke-width="6"/></g>';
    }
    if (byId('rotor')) {
      s += '<g' + shapeAttrs('rotor', view) + '><circle cx="' + X(mx + ex) +
        '" cy="' + Y(my + ey) + '" r="' + (pd / 2) * S +
        '" fill="rgba(232,234,238,0.05)" stroke="#e8eaee" stroke-width="1.6"/>' +
        '<circle cx="' + X(mx + ex) + '" cy="' + Y(my + ey) + '" r="' +
        0.011 * S + '" fill="#22262e" stroke="#e8eaee" stroke-width="1.2"/></g>';
    }
  });
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery', view) + '><rect x="' + X(-L * 0.19) +
      '" y="' + Y(W * 0.15 - e * 0.55) + '" width="' + L * 0.38 * S +
      '" height="' + W * 0.3 * S + '" rx="4" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('frame')) {
    s += '<g' + shapeAttrs('frame', view) + '><rect x="' + X(-L * 0.21) +
      '" y="' + Y(W * 0.21 + e * 0.25) + '" width="' + L * 0.42 * S +
      '" height="' + W * 0.42 * S + '" rx="6" fill="rgba(138,90,23,0.55)" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('fc')) {
    const fw = 0.042 * S;
    s += '<g' + shapeAttrs('fc', view) + '><rect x="' + (X(0) - fw / 2) +
      '" y="' + (Y(e) - fw / 2) + '" width="' + fw + '" height="' + fw +
      '" rx="2" fill="#22262e" stroke="#34d399" stroke-width="1.4"/></g>';
  }
  if (byId('camera')) {
    s += '<g' + shapeAttrs('camera', view) + '><rect x="' + X(L * 0.21 + e * 0.8) +
      '" y="' + (Y(0) - 0.015 * S) + '" width="' + 0.012 * S + '" height="' +
      0.03 * S + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  s += taElecOverlay(spec, view);
  s += '<line x1="' + X(-L / 2) + '" y1="' + Y(-W / 2) + '" x2="' + X(L / 2) +
    '" y2="' + Y(W / 2) + '" stroke="#f59e0b" stroke-width="1" stroke-dasharray="4 4"/>';
  s += '<text class="dim-note" x="' + X(0) + '" y="' + (Y(0) - 8) +
    '" text-anchor="middle">diagonal ' + mm(Math.hypot(L, W)) + ' mm</text>';
  s += dimH(X(-L / 2), X(L / 2), Y(-ext) + 20, mm(L) + ' mm motor-to-motor');
  s += dimVR(X(-ext) - 6, Y(W / 2), Y(-W / 2), mm(W) + ' mm');
  s += '<text x="' + (Wpx - 8) + '" y="' + (Hpx - 6) + '" fill="#9aa3ae" font-size="11" text-anchor="end">front is to the right</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + Hpx, 700);
}

function taRenderQuadSide(spec: RobotSpec, parts: TaPart[], view: TaViewState): string {
  const L = spec.length_m;
  const H = spec.height_m;
  const e = view.explode / 1000;
  const { Wpx, S, X, Z } = taClassFrame(-L / 2 - e - 0.05, L * 0.68 + e + 0.03, H + e + 0.04, 320);
  const byId = (id: string) => parts.find((p) => p.id === id);
  const legSide = (hx: number, far: boolean): string => {
    const bend = Math.sign(hx) * L * 0.045;
    const ex = Math.sign(hx) * e * 0.35;
    const ez = -e * 0.1;
    const col = far ? '#454c59' : '#9aa3ae';
    const off = far ? -0.012 : 0;
    return '<g' + (far ? '' : shapeAttrs('leg', view)) + '><line x1="' +
      X(hx + off + ex) + '" y1="' + Z(H * 0.62 + ez) + '" x2="' +
      X(hx + bend / 2 + off + ex) + '" y2="' + Z(H * 0.28 + ez) +
      '" stroke="' + col + '" stroke-width="7" stroke-linecap="round"/>' +
      '<line x1="' + X(hx + bend / 2 + off + ex) + '" y1="' + Z(H * 0.28 + ez) +
      '" x2="' + X(hx + bend + off + ex) + '" y2="' + Z(0.005 + ez) +
      '" stroke="' + col + '" stroke-width="5.5" stroke-linecap="round"/></g>';
  };
  let s = taGroundLine(Z, Wpx, 'ground (z = 0)');
  if (byId('leg')) {
    s += legSide(-L * 0.36, true);
    s += legSide(L * 0.36, true);
  }
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery', view) + '><rect x="' + X(-L * 0.29) +
      '" y="' + Z(H * 0.875 + e) + '" width="' + L * 0.42 * S + '" height="' +
      H * 0.15 * S + '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2" stroke-dasharray="4 3"/></g>';
  }
  if (byId('body')) {
    s += '<g' + shapeAttrs('body', view) + '><rect x="' + X(-L * 0.46) +
      '" y="' + Z(H * 0.98 + e * 0.45) + '" width="' + L * 0.92 * S +
      '" height="' + H * 0.36 * S + '" rx="8" fill="#51606f" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('leg')) {
    s += legSide(-L * 0.36, false);
    s += legSide(L * 0.36, false);
  }
  if (byId('head')) {
    s += '<g' + shapeAttrs('head', view) + '><rect x="' + X(L * 0.435 + e * 0.85) +
      '" y="' + Z(H * 0.94 + e * 0.25) + '" width="' + L * 0.17 * S +
      '" height="' + H * 0.2 * S + '" rx="5" fill="#22262e" stroke="#e8eaee" stroke-width="1.4"/></g>';
  }
  s += taElecOverlay(spec, view);
  s += dimH(X(-L / 2), X(L / 2), Z(0) + 30, mm(L) + ' mm');
  s += dimV(X(L * 0.68) + 12, Z(H), Z(0), mm(H) + ' mm standing', 'start');
  return svgEl(s, '0 0 ' + Wpx + ' 358', 700);
}
function taRenderQuadTop(spec: RobotSpec, parts: TaPart[], view: TaViewState): string {
  const L = spec.length_m;
  const W = spec.width_m;
  const e = view.explode / 1000;
  const Wpx = 700;
  const Hpx = 300;
  const pad = 14;
  const xMin = -L / 2 - e - 0.04;
  const xMax = L * 0.68 + e + 0.03;
  const yExt = W / 2 + 0.035 + e + 0.03;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / (2 * yExt));
  const ox = pad - xMin * S;
  const oy = Hpx / 2;
  const X = (x: number) => ox + x * S;
  const Y = (y: number) => oy - y * S;
  const byId = (id: string) => parts.find((p) => p.id === id);
  let s = '';
  if (byId('leg')) {
    ([[L * 0.36, W * 0.44], [L * 0.36, -W * 0.44], [-L * 0.36, W * 0.44],
      [-L * 0.36, -W * 0.44]] as [number, number][])
      .slice(0, spec.legs?.count ?? 0)
      .forEach(([hx, hy]) => {
        s += '<g' + shapeAttrs('leg', view) + '><rect x="' +
          X(hx + Math.sign(hx) * e * 0.35 - 0.016) + '" y="' +
          Y(hy + Math.sign(hy) * (0.013 + e * 0.65)) + '" width="' + 0.032 * S +
          '" height="' + 0.026 * S + '" rx="3" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.1"/></g>';
      });
  }
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery', view) + '><rect x="' + X(-L * 0.29) +
      '" y="' + Y(W * 0.25 + e) + '" width="' + L * 0.42 * S + '" height="' +
      W * 0.5 * S + '" rx="4" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2" stroke-dasharray="4 3"/></g>';
  }
  if (byId('body')) {
    s += '<g' + shapeAttrs('body', view) + '><rect x="' + X(-L * 0.46) +
      '" y="' + Y(W * 0.45 + e * 0.45) + '" width="' + L * 0.92 * S +
      '" height="' + W * 0.9 * S + '" rx="8" fill="rgba(81,96,111,0.75)" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('head')) {
    s += '<g' + shapeAttrs('head', view) + '><rect x="' + X(L * 0.435 + e * 0.85) +
      '" y="' + Y(W * 0.26 + e * 0.25) + '" width="' + L * 0.17 * S +
      '" height="' + W * 0.52 * S + '" rx="5" fill="#22262e" stroke="#e8eaee" stroke-width="1.4"/></g>';
  }
  s += taElecOverlay(spec, view);
  s += dimH(X(-L / 2), X(L / 2), Y(-yExt) + 20, mm(L) + ' mm');
  s += dimVR(X(-L / 2) - 16, Y(W / 2), Y(-W / 2), mm(W) + ' mm');
  s += '<text x="' + (Wpx - 8) + '" y="' + (Hpx - 6) + '" fill="#9aa3ae" font-size="11" text-anchor="end">front is to the right</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + Hpx, 700);
}

function taRenderHumanoidSide(spec: RobotSpec, parts: TaPart[], view: TaViewState): string {
  const L = spec.length_m;
  const H = spec.height_m;
  const e = view.explode / 1000;
  const xw = L * 0.31 + H * 0.06;
  const { Wpx, S, X, Z } = taClassFrame(-xw - e - 0.03, xw + e + 0.05, H + e + 0.04, 360);
  const byId = (id: string) => parts.find((p) => p.id === id);
  let s = taGroundLine(Z, Wpx, 'ground (z = 0)');
  if (byId('leg')) {
    const lw = H * 0.042 * S;
    s += '<g' + shapeAttrs('leg', view) + '><rect x="' + (X(0) - lw / 2) +
      '" y="' + Z(H * 0.5 - e * 0.05) + '" width="' + lw + '" height="' +
      H * 0.25 * S + '" rx="4" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/>' +
      '<rect x="' + (X(H * 0.008) - lw / 2) + '" y="' + Z(H * 0.25 - e * 0.05) +
      '" width="' + lw + '" height="' + H * 0.25 * S + '" rx="4" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/>' +
      '<rect x="' + X(H * 0.032 - H * 0.0575) + '" y="' + Z(H * 0.028 - e * 0.05) +
      '" width="' + H * 0.115 * S + '" height="' + H * 0.028 * S +
      '" rx="3" fill="#22262e" stroke="#e8eaee" stroke-width="1.2"/></g>';
  }
  if (byId('pelvis')) {
    s += '<g' + shapeAttrs('pelvis', view) + '><rect x="' + X(-H * 0.0475) +
      '" y="' + Z(H * 0.59 + e * 0.1) + '" width="' + H * 0.095 * S +
      '" height="' + H * 0.09 * S + '" rx="4" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery', view) + '><rect x="' + X(-L * 0.3 - H * 0.045 - e * 0.8) +
      '" y="' + Z(H * 0.825 + e * 0.4) + '" width="' + H * 0.045 * S +
      '" height="' + H * 0.17 * S + '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('torso')) {
    s += '<g' + shapeAttrs('torso', view) + '><rect x="' + X(-L * 0.31) +
      '" y="' + Z(H * 0.89 + e * 0.55) + '" width="' + L * 0.62 * S +
      '" height="' + H * 0.3 * S + '" rx="6" fill="#51606f" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('arm')) {
    const aw = H * 0.032 * S;
    const ax = L * 0.31 + H * 0.01;
    s += '<g' + shapeAttrs('arm', view) + '><rect x="' + X(ax + e * 0.1) +
      '" y="' + Z(H * 0.87 + e * 0.25) + '" width="' + aw + '" height="' +
      H * 0.19 * S + '" rx="4" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/>' +
      '<rect x="' + X(ax + H * 0.012 + e * 0.1) + '" y="' + Z(H * 0.68 + e * 0.25) +
      '" width="' + aw + '" height="' + H * 0.17 * S + '" rx="4" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('head')) {
    s += '<g' + shapeAttrs('head', view) + '><rect x="' + X(-H * 0.0475) +
      '" y="' + Z(H * 1.0 + e) + '" width="' + H * 0.095 * S + '" height="' +
      H * 0.115 * S + '" rx="5" fill="#22262e" stroke="#e8eaee" stroke-width="1.4"/></g>';
  }
  s += taElecOverlay(spec, view);
  s += dimV(X(xw) + 16, Z(H), Z(0), mm(H) + ' mm tall', 'start');
  s += dimH(X(-L / 2), X(L / 2), Z(0) + 30, mm(L) + ' mm deep');
  return svgEl(s, '0 0 ' + Wpx + ' 398', 700);
}
function taRenderHumanoidTop(spec: RobotSpec, parts: TaPart[], view: TaViewState): string {
  const L = spec.length_m;
  const W = spec.width_m;
  const H = spec.height_m;
  const e = view.explode / 1000;
  const Wpx = 700;
  const Hpx = 300;
  const pad = 14;
  const xExt = L / 2 + e + 0.04;
  const yExt = W / 2 + H * 0.05 + e + 0.03;
  const S = Math.min((Wpx - 2 * pad) / (2 * xExt), (Hpx - 2 * pad) / (2 * yExt));
  const ox = Wpx / 2;
  const oy = Hpx / 2;
  const X = (x: number) => ox + x * S;
  const Y = (y: number) => oy - y * S;
  const byId = (id: string) => parts.find((p) => p.id === id);
  let s = '';
  if (byId('arm')) {
    [W / 2 + H * 0.03, -(W / 2 + H * 0.03)].slice(0, spec.arms?.count ?? 0).forEach((y0) => {
      s += '<g' + shapeAttrs('arm', view) + '><rect x="' + X(-H * 0.019) +
        '" y="' + Y(y0 + Math.sign(y0) * e * 0.8 + H * 0.016) + '" width="' +
        H * 0.038 * S + '" height="' + H * 0.032 * S + '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.1"/></g>';
    });
  }
  if (byId('leg')) {
    [W * 0.22, -W * 0.22].slice(0, spec.legs?.count ?? 0).forEach((y0) => {
      s += '<g' + shapeAttrs('leg', view) + '><rect x="' + X(-H * 0.025) +
        '" y="' + Y(y0 + Math.sign(y0) * e * 0.55 + H * 0.021) + '" width="' +
        H * 0.05 * S + '" height="' + H * 0.042 * S + '" rx="3" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.1"/></g>';
    });
  }
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery', view) + '><rect x="' + X(-L * 0.3 - H * 0.045 - e * 0.8) +
      '" y="' + Y(W * 0.26 + e * 0.4) + '" width="' + H * 0.045 * S +
      '" height="' + W * 0.52 * S + '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('torso')) {
    s += '<g' + shapeAttrs('torso', view) + '><rect x="' + X(-L * 0.31) +
      '" y="' + Y(W * 0.47 + e * 0.55) + '" width="' + L * 0.62 * S +
      '" height="' + W * 0.94 * S + '" rx="6" fill="rgba(81,96,111,0.8)" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('pelvis')) {
    s += '<g' + shapeAttrs('pelvis', view) + '><rect x="' + X(-H * 0.0475) +
      '" y="' + Y(W * 0.41 + e * 0.1) + '" width="' + H * 0.095 * S +
      '" height="' + W * 0.82 * S + '" rx="4" fill="none" stroke="#9aa3ae" stroke-width="1" stroke-dasharray="4 3"/></g>';
  }
  if (byId('head')) {
    s += '<g' + shapeAttrs('head', view) + '><circle cx="' + X(0) + '" cy="' +
      Y(e) + '" r="' + H * 0.05 * S + '" fill="#22262e" stroke="#e8eaee" stroke-width="1.4"/></g>';
  }
  s += taElecOverlay(spec, view);
  s += dimH(X(-L / 2), X(L / 2), Y(-yExt) + 20, mm(L) + ' mm deep');
  s += dimVR(X(-xExt) - 6, Y(W / 2), Y(-W / 2), mm(W) + ' mm wide');
  s += '<text x="' + (Wpx - 8) + '" y="' + (Hpx - 6) + '" fill="#9aa3ae" font-size="11" text-anchor="end">front is to the right</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + Hpx, 700);
}

function taRenderArmSide(spec: RobotSpec, parts: TaPart[], view: TaViewState): string {
  const R = spec.length_m;
  const H = spec.height_m;
  const e = view.explode / 1000;
  const { Wpx, S, X, Z } = taClassFrame(-R * 0.5 - e - 0.03, R + e + 0.04, H + e + 0.04, 320);
  const byId = (id: string) => parts.find((p) => p.id === id);
  let s = taGroundLine(Z, Wpx, 'table (z = 0)');
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery', view) + '><rect x="' + X(-R * 0.34 - 0.0475 - e * 0.5) +
      '" y="' + Z(0.032 - e * 0.6) + '" width="' + 0.095 * S + '" height="' +
      0.032 * S + '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('base')) {
    s += '<g' + shapeAttrs('base', view) + '><rect x="' + X(-0.05) +
      '" y="' + Z(0.03) + '" width="' + 0.1 * S + '" height="' + 0.03 * S +
      '" rx="3" fill="#8a5a17" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('link')) {
    const pts: [number, number][] = [[0, 0.03], [0, H * 0.45], [R * 0.52, H * 0.47], [R * 0.79, H * 0.4]];
    for (let i = 0; i < Math.min(spec.arms?.segments ?? 0, 3); i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[i + 1];
      const ex = e * 0.25 * (i + 1);
      const ez = e * 0.3 * (i + 1);
      s += '<g' + shapeAttrs('link', view) + '><line x1="' + X(x1 + ex) +
        '" y1="' + Z(z1 + ez) + '" x2="' + X(x2 + ex) + '" y2="' + Z(z2 + ez) +
        '" stroke="#9aa3ae" stroke-width="8" stroke-linecap="round"/></g>';
    }
  }
  if (byId('gripper')) {
    const gx = R * 0.83 + e * 0.9;
    const gz = H * 0.4;
    s += '<g' + shapeAttrs('gripper', view) + '><line x1="' + X(gx) + '" y1="' +
      Z(gz + spec.width_m / 2 + e * 0.1) + '" x2="' + X(gx + 0.045) +
      '" y2="' + Z(gz + spec.width_m / 2 + e * 0.1) + '" stroke="#e8eaee" stroke-width="4"/>' +
      '<line x1="' + X(gx) + '" y1="' + Z(gz - spec.width_m / 2 + e * 0.1) +
      '" x2="' + X(gx + 0.045) + '" y2="' + Z(gz - spec.width_m / 2 + e * 0.1) +
      '" stroke="#e8eaee" stroke-width="4"/></g>';
  }
  s += taElecOverlay(spec, view);
  s += dimH(X(0), X(R), Z(0) + 30, 'reach ' + mm(R) + ' mm');
  s += dimV(X(R) + 14, Z(H), Z(0), mm(H) + ' mm', 'start');
  return svgEl(s, '0 0 ' + Wpx + ' 358', 700);
}
function taRenderArmTop(spec: RobotSpec, parts: TaPart[], view: TaViewState): string {
  const R = spec.length_m;
  const e = view.explode / 1000;
  const Wpx = 700;
  const Hpx = 280;
  const pad = 14;
  const xMin = -R * 0.5 - e - 0.03;
  const xMax = R + e + 0.04;
  const yExt = R * 0.42 + e + 0.03;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / (2 * yExt));
  const ox = pad - xMin * S;
  const oy = Hpx / 2;
  const X = (x: number) => ox + x * S;
  const Y = (y: number) => oy - y * S;
  const byId = (id: string) => parts.find((p) => p.id === id);
  let s = '';
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery', view) + '><rect x="' + X(-R * 0.34 - 0.0475 - e * 0.5) +
      '" y="' + Y(-R * 0.34 + 0.0275 - e * 0.6) + '" width="' + 0.095 * S +
      '" height="' + 0.055 * S + '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('link')) {
    s += '<g' + shapeAttrs('link', view) + '><line x1="' + X(0) + '" y1="' + Y(0) +
      '" x2="' + X(R * 0.79 + e * 0.75) + '" y2="' + Y(0) +
      '" stroke="#9aa3ae" stroke-width="8" stroke-linecap="round"/></g>';
  }
  if (byId('base')) {
    s += '<g' + shapeAttrs('base', view) + '><circle cx="' + X(0) + '" cy="' + Y(0) +
      '" r="' + Math.min(0.06, R * 0.16) * S + '" fill="#8a5a17" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('gripper')) {
    const gx = R * 0.83 + e * 0.9;
    s += '<g' + shapeAttrs('gripper', view) + '><line x1="' + X(gx) + '" y1="' +
      Y(spec.width_m / 2) + '" x2="' + X(gx + 0.045) + '" y2="' +
      Y(spec.width_m / 2) + '" stroke="#e8eaee" stroke-width="4"/>' +
      '<line x1="' + X(gx) + '" y1="' + Y(-spec.width_m / 2) + '" x2="' +
      X(gx + 0.045) + '" y2="' + Y(-spec.width_m / 2) + '" stroke="#e8eaee" stroke-width="4"/></g>';
  }
  s += taElecOverlay(spec, view);
  s += dimH(X(0), X(R), Y(-yExt) + 20, 'reach ' + mm(R) + ' mm');
  s += '<text x="' + (Wpx - 8) + '" y="' + (Hpx - 6) + '" fill="#9aa3ae" font-size="11" text-anchor="end">the arm reaches to the right</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + Hpx, 700);
}

/* The class dispatch from robot.js's taRender: returns both views
 * for the spec's class. */
export function taRenderViews(
  spec: RobotSpec, parts: TaPart[], pos: [number, number][], view: TaViewState,
): { side: string; top: string } {
  const cls = taClass(spec);
  if (cls === 'aerial') {
    return { side: taRenderAerialSide(spec, parts, view), top: taRenderAerialTop(spec, parts, view) };
  }
  if (cls === 'quadruped') {
    return { side: taRenderQuadSide(spec, parts, view), top: taRenderQuadTop(spec, parts, view) };
  }
  if (cls === 'humanoid') {
    return { side: taRenderHumanoidSide(spec, parts, view), top: taRenderHumanoidTop(spec, parts, view) };
  }
  if (cls === 'arm') {
    return { side: taRenderArmSide(spec, parts, view), top: taRenderArmTop(spec, parts, view) };
  }
  return { side: taRenderSide(spec, parts, pos, view), top: taRenderTop(spec, parts, pos, view) };
}
