'use strict';
/* Robot detail: the take-apart viewer, drawn from the robot's own spec
   file (#ta[data-spec]). Ported from the original app view. */

/* ---------------- Take-apart viewer ----------------
   Geometry mirrors src/robotforge/cad.py (which mirrors urdf.py):
   wheel X = length/2 - wheel radius; wheel Y = width/2 + wheel width/2;
   axles at wheel-radius height; chassis plate underside at the spec's
   ground clearance; casters at x = +/- (length/2 - ground clearance);
   sensor placement from the spec's position words (a layout assumption,
   exactly as the kit's assembly file labels it). Kit assumption sizes
   (plate thickness, lidar disc, bracket sizes) are labeled as such. */
const PLATE_T = 0.004;        // kit assumption (cad.py PLATE_THICKNESS_MM)
const LIDAR_DISC_D = 0.070;   // kit assumption (cad.py LIDAR_DISC_D_MM)
const POST_D = 0.012;         // kit assumption (cad.py POST_D_MM)
const CAM_W = 0.044, CAM_H = 0.034;   // kit assumptions (camera bracket)
const ULTRA_H = 0.020, ULTRA_CAN_D = 0.016;  // kit assumptions (ultrasonic)

/* parts with an illustration in assets/img/parts/<id>.jpg */
const TA_SPOTS = ['plate', 'wheel', 'mount', 'caster', 'lidar', 'camera', 'ultrasonic'];
let taSpec = null, taParts = [], taSelected = null, taExplode = 0;

/* ---------------- Electrical overlay ----------------
   Drawn from the spec's optional `wiring` block: nodes (battery,
   driver, motors, controller, sensors) and the connections between
   them, with each part's recorded electrical requirement. Voltages
   come only from the spec's electrical fields and the parts
   catalog's datasheet specs — anything unsourced is null in the
   data and renders as "not specified", never as an invented number. */
/* == elec-logic:start == */
/* Pure logic over a wiring block. No DOM, no viewer helpers: the
   test suite extracts this block and runs it in Node against
   fixtures and the real spec files. */
function elecNodeMap(w) {
  const m = {};
  (w.nodes || []).forEach(n => { m[n.id] = n; });
  return m;
}
function elecDepths(w) {
  /* Supply depth of each node, BFS from the battery following
     connections in their from -> to direction. Unreached: Infinity. */
  const depth = {};
  (w.nodes || []).forEach(n => { depth[n.id] = Infinity; });
  if (!Object.prototype.hasOwnProperty.call(depth, 'battery')) return depth;
  depth.battery = 0;
  let grew = true;
  while (grew) {
    grew = false;
    (w.connections || []).forEach(c => {
      if (depth[c.from] !== Infinity && depth[c.to] === Infinity) {
        depth[c.to] = depth[c.from] + 1; grew = true;
      }
    });
  }
  return depth;
}
function elecStage(w, depth, i) {
  /* Power-on step at which connection i lights: one past the depth
     of the node feeding it, so the battery's own outputs are step 1. */
  const d = depth[w.connections[i].from];
  return d === Infinity ? Infinity : d + 1;
}
function elecBad(w) {
  /* Indexes of connections that provably over-volt their target: a
     power connection carrying a fixed voltage above the target's
     recorded rated maximum. Null volts (data links, PWM drive,
     unspecified rails) or an unrated target can never be flagged —
     missing data is neither a pass nor a fail. */
  const nodes = elecNodeMap(w), bad = new Set();
  (w.connections || []).forEach((c, i) => {
    const t = nodes[c.to];
    if (c.kind === 'power' && c.volts != null && t &&
        t.rated_max_v != null && c.volts > t.rated_max_v) bad.add(i);
  });
  return bad;
}
function elecVolts(v) {
  return v == null ? 'not specified' : (Math.round(v * 10) / 10) + ' V';
}
function elecConnLabel(w, i) {
  const c = w.connections[i], nodes = elecNodeMap(w);
  const a = nodes[c.from] ? nodes[c.from].label : c.from;
  const b = nodes[c.to] ? nodes[c.to].label : c.to;
  return a + ' \u2192 ' + b + ' \u00b7 ' + c.kind +
    (c.kind === 'power' ? ' \u00b7 ' + elecVolts(c.volts) : '') +
    (c.label ? ' \u2014 ' + c.label : '');
}
function elecNodeStatus(w, id) {
  /* {state, feeds, reason}: how this node is fed and whether any
     fixed-voltage feed provably exceeds its recorded rated maximum.
     state is 'bad', 'ok' (checked, within rating) or 'unchecked'. */
  const nodes = elecNodeMap(w), node = nodes[id];
  const bad = elecBad(w), feeds = [];
  let state = 'unchecked', reason = 'no feed is recorded for it';
  (w.connections || []).forEach((c, i) => {
    if (c.to !== id || c.kind !== 'power') return;
    feeds.push(c);
    if (bad.has(i)) state = 'bad';
    else if (c.volts != null && node && node.rated_max_v != null &&
             state === 'unchecked') state = 'ok';
  });
  if (feeds.length && state === 'unchecked') {
    reason = feeds.every(c => c.volts == null)
      ? 'its feed carries no fixed voltage (PWM or an unspecified rail)'
      : 'the part has no recorded rated maximum to check against';
  }
  return { state, feeds, reason };
}
/* == elec-logic:end == */

let taElec = false, taPower = false, taElecStage = 0;
let taSelNode = null, taSelWire = null, taElecTimers = [];

function taWheelPositions(spec) {
  const wx = spec.length_m / 2 - spec.wheel.diameter_m / 2;
  const wy = spec.width_m / 2 + spec.wheel.width_m / 2;
  if (spec.wheel.count === 2) return [[0, wy], [0, -wy]];
  return [[wx, wy], [wx, -wy], [-wx, wy], [-wx, -wy]].slice(0, spec.wheel.count);
}
function taPosXY(position, spec) {
  const p = String(position || '').toLowerCase();
  let x = 0, y = 0;
  if (p.includes('front')) x = spec.length_m / 2;
  else if (p.includes('rear') || p.includes('back')) x = -spec.length_m / 2;
  if (p.includes('left')) y = spec.width_m / 4;
  else if (p.includes('right')) y = -spec.width_m / 4;
  return [x, y];
}
function taIsEstimated(spec) {
  const d = spec.description || '';
  return d.startsWith('Photo draft') || d.includes('ESTIMATED');
}

/* Which take-apart family a spec belongs to. Derived from the
   spec's own class fields, the same way schema.py branches: rotors
   make an aerial, legs+arms a humanoid, legs alone a quadruped, the
   robotic_arm drivetrain a stationary arm, anything else the ground
   kit the viewer has always drawn. */
function taClass(spec) {
  if (spec.rotors) return 'aerial';
  if (spec.drivetrain === 'robotic_arm') return 'arm';
  // A quadruped stays a quadruped when it carries a manipulator —
  // the arm is part of the robot, not a change of class (Spot with
  // Arm). Only a legs+arms spec that is not declared a quadruped
  // reads as a humanoid.
  if (spec.drivetrain === 'quadruped') return 'quadruped';
  if (spec.legs && spec.arms) return 'humanoid';
  if (spec.legs) return 'quadruped';
  return 'ground';
}

function taBuildParts(spec) {
  const cls = taClass(spec);
  if (cls === 'aerial') return taBuildAerialParts(spec);
  if (cls === 'quadruped') return taBuildQuadParts(spec);
  if (cls === 'humanoid') return taBuildHumanoidParts(spec);
  if (cls === 'arm') return taBuildArmParts(spec);
  return taBuildGroundParts(spec);
}

/* Motor positions of an X-frame multirotor: the four corners of the
   spec's length x width (its declared motor-to-motor spans). */
function taMotorXY(spec) {
  const hx = spec.length_m / 2, hy = spec.width_m / 2;
  return [[hx, hy], [hx, -hy], [-hx, hy], [-hx, -hy]]
    .slice(0, spec.rotors ? spec.rotors.count : 4);
}

function taBatteryText(spec) {
  const b = spec.battery;
  return b.chemistry + ', ' + b.voltage_v + ' V, ' +
    b.capacity_mah + ' mAh — from the spec';
}

/* Schematic parts carry file: null — they are the real robot's
   layout derived from its spec, not files in a printable kit, and
   the detail panel says so instead of naming a file that is not
   there. Their prose interpolates the spec's own numbers only. */
function taBuildAerialParts(spec) {
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const n = spec.rotors.count, pd = spec.rotors.prop_diameter_m;
  const parts = [];
  parts.push({ id: 'frame', name: 'Airframe', file: null, qty: 1,
    does: 'The central frame the arms, motors and electronics bolt to.',
    dims: 'motors span ' + mm(L) + ' x ' + mm(W) + ' mm motor-to-motor (' +
      mm(Math.hypot(L, W)) + ' mm diagonal) — the spec\u2019s length and width are the motor spans',
    tweak: 'Motor-to-motor size is the drone\u2019s real footprint class: it sets how big a propeller fits before the props overlap.',
    print: 'Schematic part — the viewer draws the real robot\u2019s layout from its spec; there is no printable kit for this class yet.' });
  parts.push({ id: 'arm', name: 'Arm', file: null, qty: n,
    does: 'One boom per motor, reaching from the frame to a corner.',
    dims: 'one per rotor (' + n + '); each reaches half the diagonal, ' +
      mm(Math.hypot(L, W) / 2) + ' mm',
    tweak: 'Stiffer arms wobble less: vibration is the flight controller\u2019s worst enemy.',
    print: 'Schematic part — see the frame note.' });
  parts.push({ id: 'rotor', name: 'Motor + propeller', file: null, qty: n,
    does: 'A brushless motor with its propeller — the whole drivetrain of a drone. Neighbouring rotors spin opposite ways so their twist cancels.',
    dims: 'propeller ' + mm(pd) + ' mm diameter (from the spec); ' +
      spec.motor.count + ' motors at ' + spec.motor.voltage_v + ' V',
    tweak: 'Bigger props move more air more slowly (quieter, more efficient); smaller props spin faster and answer quicker.',
    print: 'Schematic part — see the frame note. Props are consumables on real drones; they chip and bend.' });
  parts.push({ id: 'battery', name: 'Battery', file: null, qty: 1,
    does: 'The flight pack, strapped at the centre so its weight sits at the centre of mass.',
    dims: taBatteryText(spec),
    tweak: 'Battery weight is the drone\u2019s biggest trade: more capacity flies longer, until the extra mass eats the gain.',
    print: 'Schematic part — a real pack, bought not printed.' });
  parts.push({ id: 'fc', name: 'Flight-controller stack', file: null, qty: 1,
    does: 'The board (or stack of boards) that reads the IMU and GPS and mixes the four motor speeds many times a second.',
    dims: 'carries the spec\u2019s sensors: ' +
      (spec.sensors.map(s => s.kind).join(', ') || 'none listed'),
    tweak: 'Soft-mounting the flight controller (foam or rubber) is the classic fix for a drone that twitches.',
    print: 'Schematic part — real electronics, mounted at the frame centre.' });
  const cams = spec.sensors.filter(s => s.kind === 'rgb_camera' || s.kind === 'depth_camera');
  if (cams.length) {
    const [cx, cy] = taPosXY(cams[0].position, spec);
    parts.push({ id: 'camera', name: 'Camera', file: null, qty: cams.length,
      does: 'A camera (' + cams[0].kind + ') at the ' + cams[0].position + ' of the craft.',
      dims: 'position word from the spec: ' + cams[0].position,
      tweak: 'A camera at the nose is the pilot\u2019s eye on FPV drones; on camera drones it usually hangs on a gimbal underneath.',
      print: 'Schematic part — real electronics.', x: cx, y: cy });
  }
  return { parts, pos: taMotorXY(spec) };
}

function taBuildQuadParts(spec) {
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const parts = [];
  parts.push({ id: 'body', name: 'Body', file: null, qty: 1,
    does: 'The torso: carries the computer, the battery and the leg motors, and sets how high the robot stands.',
    dims: mm(L) + ' x ' + mm(W) + ' mm, standing height ' + mm(H) + ' mm — from the spec',
    tweak: 'Standing height comes from the legs, not the body: longer legs step over more, but sway more.',
    print: 'Schematic part — the viewer draws the real robot\u2019s layout from its spec; there is no printable kit for this class yet.' });
  parts.push({ id: 'leg', name: 'Leg', file: null, qty: spec.legs.count,
    does: 'A two-segment leg (upper and lower) with a motor at the hip and one at the knee — two powered bends per leg is what lets a dog trot, turn and catch itself.',
    dims: spec.legs.count + ' legs, ' + spec.legs.segments + ' segments each; ' +
      spec.motor.count + ' joint motors across the robot (from the spec)',
    tweak: 'Feet matter more than they look: a soft foot grips, a hard round foot skates on smooth floors.',
    print: 'Schematic part — see the body note.' });
  const sense = spec.sensors.filter(s => s.kind === 'lidar_2d' || s.kind === 'rgb_camera' || s.kind === 'depth_camera');
  if (sense.length) {
    parts.push({ id: 'head', name: 'Head / sensor unit', file: null, qty: 1,
      does: 'The sensor head at the front: ' + sense.map(s => s.kind).join(' + ') + ', so the robot sees where it is walking.',
      dims: 'sensors from the spec: ' + sense.map(s => s.kind + ' (' + s.position + ')').join(', '),
      tweak: 'A sensor is only as good as its view: anything that blocks the head\u2019s line of sight blinds the robot on that side.',
      print: 'Schematic part — real electronics.' });
  }
  parts.push({ id: 'battery', name: 'Battery', file: null, qty: 1,
    does: 'The pack inside the body — on a legged robot it is a large share of the total mass.',
    dims: taBatteryText(spec),
    tweak: 'Legged robots spend energy standing still (the motors hold the body up), so runtime drops fast with a heavier pack.',
    print: 'Schematic part — a real pack, inside the body.' });
  return { parts, pos: [] };
}

function taBuildHumanoidParts(spec) {
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const parts = [];
  parts.push({ id: 'pelvis', name: 'Pelvis', file: null, qty: 1,
    does: 'The hip block the legs hang from and the torso stands on — the robot\u2019s centre of mass lives near here.',
    dims: 'standing height ' + mm(H) + ' mm overall; body ' + mm(W) + ' mm wide, ' + mm(L) + ' mm deep — from the spec',
    tweak: 'Balance is a centre-of-mass game: keep the mass low and centred and the robot forgives bad steps.',
    print: 'Schematic part — the viewer draws the real robot\u2019s layout from its spec; there is no printable kit for this class yet.' });
  parts.push({ id: 'torso', name: 'Torso', file: null, qty: 1,
    does: 'The chest: carries the arms, the head, the main computer and usually the battery.',
    dims: 'upper body above the pelvis, roughly the middle third of the ' + mm(H) + ' mm height',
    tweak: 'A humanoid falls as one rigid story problem — the torso is where the IMU sits, so its motion is what the balance controller feels.',
    print: 'Schematic part — see the pelvis note.' });
  parts.push({ id: 'head', name: 'Head', file: null, qty: 1,
    does: 'The sensor head: ' + (spec.sensors.length ? spec.sensors.map(s => s.kind).join(' + ') : 'no sensors in the spec') + '.',
    dims: 'sensors from the spec: ' + (spec.sensors.map(s => s.kind + ' (' + s.position + ')').join(', ') || 'none listed'),
    tweak: 'Heads are light on purpose: mass at the top is the hardest to balance.',
    print: 'Schematic part — real electronics.' });
  parts.push({ id: 'arm', name: 'Arm', file: null, qty: spec.arms.count,
    does: 'A two-segment arm (upper arm and forearm) with a powered shoulder and elbow.',
    dims: spec.arms.count + ' arms, ' + spec.arms.segments + ' segments each (from the spec)',
    tweak: 'On a humanoid the arms are balance tools first and manipulators second — swinging them shifts the centre of mass.',
    print: 'Schematic part — see the pelvis note.' });
  parts.push({ id: 'leg', name: 'Leg', file: null, qty: spec.legs.count,
    does: 'A two-segment leg (thigh and shin) ending in a flat foot — the foot\u2019s size is the robot\u2019s balance margin.',
    dims: spec.legs.count + ' legs; ' + spec.motor.count + ' actuated joints across the whole robot (from the spec)',
    tweak: 'Ankle motors decide whether the robot can stand on a slope or only on flat floors.',
    print: 'Schematic part — see the pelvis note.' });
  parts.push({ id: 'battery', name: 'Battery', file: null, qty: 1,
    does: 'The pack, carried in the torso.',
    dims: taBatteryText(spec),
    tweak: 'Humanoids are energy-hungry: every joint motor draws power just to stand.',
    print: 'Schematic part — a real pack, inside the torso.' });
  return { parts, pos: [] };
}

function taBuildArmParts(spec) {
  const L = spec.length_m;
  const parts = [];
  parts.push({ id: 'base', name: 'Base', file: null, qty: 1,
    does: 'The fixed base that bolts to the table and carries the first (waist) servo — the only part of this robot that never moves.',
    dims: 'reach ' + mm(L) + ' mm from the base axis (from the spec)',
    tweak: 'Bolt it down: an arm that can lift 500 g at full reach can tip its own base plate.',
    print: 'Schematic part — the viewer draws the real robot\u2019s layout from its spec; there is no printable kit for this class yet.' });
  parts.push({ id: 'link', name: 'Arm segment', file: null, qty: spec.arms.segments,
    does: 'One rigid segment between two servo joints. The chain of segments is what reach means: their lengths add up to how far the gripper gets.',
    dims: spec.arms.segments + ' segments; total reach ' + mm(L) + ' mm (from the spec)',
    tweak: 'Longer segments reach further but flex more and load the shoulder servo harder — reach and payload trade against each other.',
    print: 'Schematic part — see the base note.' });
  parts.push({ id: 'gripper', name: 'Gripper', file: null, qty: 1,
    does: 'The two-finger end effector, driven by the last servo — the part that actually touches the work.',
    dims: 'the spec\u2019s width (' + mm(spec.width_m) + ' mm) is the gripper\u2019s maximum opening',
    tweak: 'Soft fingertips grip more with less force; smooth metal fingers need a squeeze that can crush light parts.',
    print: 'Schematic part — see the base note.' });
  parts.push({ id: 'battery', name: 'Power supply', file: null, qty: 1,
    does: 'This robot has no battery: it runs from a plug-in DC supply, which the spec models in the battery slot.',
    dims: spec.battery.voltage_v + ' V DC supply (spec chemistry: ' + spec.battery.chemistry + ', capacity 0 mAh — there is no pack)',
    tweak: 'A tethered arm never runs flat mid-task, but the cable is part of the workspace — route it so the arm cannot snag it.',
    print: 'Schematic part — a real bench supply, drawn beside the base.' });
  return { parts, pos: [] };
}

function taBuildGroundParts(spec) {
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const C = spec.ground_clearance_m, r = spec.wheel.diameter_m / 2;
  const deckTop = C + PLATE_T;
  const pos = taWheelPositions(spec);
  const parts = [];

  parts.push({ id: 'plate', name: 'Chassis plate', file: 'parts/chassis_plate.scad', qty: 1,
    does: 'The deck everything else bolts to.',
    dims: mm(L) + ' x ' + mm(W) + ' mm footprint, 4 mm thick (thickness is a kit assumption)',
    tweak: 'Change length_m or width_m in the spec and the whole kit follows \u2014 plate, wheel spacing and mounts are all derived from the same numbers.',
    print: 'Print flat as modeled. Suggestion: 3\u20134 walls, ~25% infill.' });

  parts.push({ id: 'wheel', name: 'Wheel', file: 'parts/wheel.scad', qty: spec.wheel.count,
    does: 'Rolls on the ground; one per wheel position on the robot.',
    dims: mm(spec.wheel.diameter_m) + ' mm diameter x ' + mm(spec.wheel.width_m) + ' mm wide, 6 mm shaft hole (hole size is a kit assumption)',
    tweak: 'wheel.diameter_m is the number the motion gate grades. Change it and the twin, the CAD kit and the verdict all move together.',
    print: 'Print flat as modeled. Suggestion: print one first and check the shaft fit before printing the rest.' });

  parts.push({ id: 'mount', name: 'Motor mount', file: 'parts/motor_mount.scad', qty: spec.wheel.count,
    does: 'Side plate that holds one drive motor so its shaft lines up with a wheel\u2019s axle.',
    dims: 'one per wheel; shaft hole at axle height ' + mm(r) + ' mm (the wheel radius, from the spec)',
    tweak: 'The mount is derived, not drawn: its shaft height always equals the wheel radius, so it can never disagree with the wheel.',
    print: 'Suggestion: 40% infill \u2014 this part takes the motor\u2019s twist. The motor itself is not a printed part.' });

  if (spec.wheel.count === 2) {
    parts.push({ id: 'caster', name: 'Caster', file: 'parts/caster.scad', qty: 2,
      does: 'Ball caster that keeps a two-wheel robot level (one front, one rear). Placeholder for a real ball-caster unit.',
      dims: 'ball diameter ' + mm(C) + ' mm \u2014 set by the spec\u2019s ground clearance, so the ball tops out at the deck',
      tweak: 'Ground clearance comes from the spec; a taller clearance grows the caster ball to match.',
      print: 'Suggestion: expect a loose fit \u2014 sand or scale 1\u20132% for a snug cup. A bought ball caster rolls far better.' });
  }

  const lidar = spec.sensors.find(s => s.kind === 'lidar_2d');
  if (lidar) {
    const [lx, ly] = taPosXY(lidar.position, spec);
    parts.push({ id: 'lidar', name: 'Lidar mount', file: 'parts/lidar_mount.scad', qty: 1,
      does: 'Post that raises the 2D lidar to the top of the robot so its scan plane clears the chassis.',
      dims: 'post rises from the deck to the spec\u2019s overall height (' + mm(H) + ' mm); top disc ' + mm(LIDAR_DISC_D) + ' mm diameter (disc size is a kit assumption)',
      tweak: 'The post height is derived from the spec\u2019s height_m \u2014 raise the robot and the lidar rises with it.',
      print: 'Print upright as modeled. Suggestion: ~25% infill; the lidar itself is not a printed part.',
      x: lx, y: ly });
  }

  const cams = spec.sensors.filter(s => s.kind === 'rgb_camera' || s.kind === 'depth_camera');
  if (cams.length) {
    const [cx] = taPosXY(cams[0].position, spec);
    parts.push({ id: 'camera', name: 'Camera bracket', file: 'parts/camera_bracket.scad', qty: cams.length,
      does: 'Bracket that holds a camera (' + cams[0].kind + ') at the ' + cams[0].position + ' of the robot.',
      dims: mm(CAM_W) + ' x ' + mm(CAM_H) + ' mm plate, 12 mm lens hole (bracket sizes are kit assumptions)',
      tweak: 'The kit ships one bracket file for every camera on the robot \u2014 edit it once, print it per camera.',
      print: 'Print flat as modeled. Suggestion: the lens hole is a visual guide \u2014 measure your camera before drilling.',
      face: cx >= 0 ? 1 : -1 });
  }

  const ultras = spec.sensors.filter(s => s.kind === 'ultrasonic');
  if (ultras.length) {
    const [ux] = taPosXY(ultras[0].position, spec);
    parts.push({ id: 'ultrasonic', name: 'Ultrasonic bracket', file: 'parts/ultrasonic_bracket.scad', qty: ultras.length,
      does: 'Front mount carrying the ultrasonic sensor\u2019s two round \u201ceyes\u201d (HC-SR04 style).',
      dims: 'twin ' + mm(ULTRA_CAN_D) + ' mm cans, 26 mm apart (HC-SR04 class sizes \u2014 kit assumptions)',
      tweak: 'Angle it straight ahead: a tilted sonar measures the floor, not the wall.',
      print: 'Print flat as modeled. Suggestion: the cans are visual placeholders for a real ultrasonic module.',
      face: ux >= 0 ? 1 : -1 });
  }
  return { parts, pos };
}

/* == ta3d-geom:start == */
/* 3D take-apart geometry: the SAME derivation as the 2D views,
   expressed as kit units in robot coordinates (metres; x forward,
   y left, z up). Built from taBuildParts' own output — the parts
   list and the wheel positions — so the 3D scene can never grow a
   part the flat kit does not have: one unit per drawn instance
   (wheels and mounts per wheel position, casters front and rear,
   one lidar assembly of post + disc meshes, one bracket per sensor
   face, exactly as the 2D views draw them). Explode directions
   mirror the flat views: wheels/mounts slide out along their side,
   the lidar rises, face sensors push forward, casters drop away.
   Pure data — no DOM, no three.js: the test suite extracts this
   block and runs it in Node against the real specs, and
   assets/js/robot3d.js turns the units into meshes. */
function taGeom3d(spec, parts, pos) {
  const cls = taClass(spec);
  if (cls === 'aerial') return taGeomAerial(spec, parts);
  if (cls === 'quadruped') return taGeomQuad(spec, parts);
  if (cls === 'humanoid') return taGeomHumanoid(spec, parts);
  if (cls === 'arm') return taGeomArm(spec, parts);
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const C = spec.ground_clearance_m, r = spec.wheel.diameter_m / 2;
  const deckTop = C + PLATE_T;
  const units = [];
  const byId = id => parts.find(p => p.id === id);
  if (byId('plate')) {
    units.push({ part: 'plate', explode: [0, 0, 0], meshes: [
      { kind: 'box', size: [L, W, PLATE_T],
        center: [0, 0, C + PLATE_T / 2] }] });
  }
  pos.forEach(([x0, y0]) => {
    const ex = Math.sign(x0) * 0.7, ey = Math.sign(y0);
    if (byId('wheel')) {
      units.push({ part: 'wheel', explode: [ex, ey, 0], meshes: [
        { kind: 'cyl', axis: 'y', size: [r, spec.wheel.width_m],
          center: [x0, y0, r] }] });
    }
    if (byId('mount')) {
      units.push({ part: 'mount', explode: [ex * 0.7, ey * 0.7, 0], meshes: [
        { kind: 'box',
          size: [spec.wheel.diameter_m * 0.36, 0.010, deckTop],
          center: [x0, Math.sign(y0) * (W / 2 + 0.005), deckTop / 2] }] });
    }
  });
  if (byId('caster')) {
    const cx = L / 2 - C;
    [-cx, cx].forEach(x0 => {
      units.push({ part: 'caster',
        explode: [Math.sign(x0) * 0.5, 0, -0.25], meshes: [
          { kind: 'sphere', size: [C / 2], center: [x0, 0, C / 2] }] });
    });
  }
  const lp = byId('lidar');
  if (lp) {
    const postH = H - 0.010 - deckTop;
    units.push({ part: 'lidar', explode: [0, 0, 1], meshes: [
      { kind: 'cyl', axis: 'z', size: [POST_D / 2, postH],
        center: [lp.x, lp.y, deckTop + postH / 2] },
      { kind: 'cyl', axis: 'z', size: [LIDAR_DISC_D / 2, 0.010],
        center: [lp.x, lp.y, H - 0.005] }] });
  }
  const cp = byId('camera');
  if (cp) {
    units.push({ part: 'camera', explode: [cp.face, 0, 0.2], meshes: [
      { kind: 'box', size: [PLATE_T, CAM_W, CAM_H],
        center: [cp.face * (L / 2 + PLATE_T / 2), 0, C + H / 2] }] });
  }
  const up = byId('ultrasonic');
  if (up) {
    units.push({ part: 'ultrasonic', explode: [up.face, 0, 0.2], meshes: [
      { kind: 'box', size: [PLATE_T, 0.052, ULTRA_H],
        center: [up.face * (L / 2 + PLATE_T / 2), 0,
                 deckTop + ULTRA_H / 2] }] });
  }
  return units;
}

/* Class geometries: the same one-derivation rule as the ground kit —
   one unit per drawn instance of each part taBuildParts produced,
   positions and sizes from the spec's numbers only (fractions of the
   declared dimensions where the spec carries no finer breakdown,
   which is what "schematic" means here). z = 0 is the ground (or,
   for the arm, the table); an aerial hovers at its frame height. */
function taGeomAerial(spec, parts) {
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const pd = spec.rotors.prop_diameter_m;
  const fz = H * 0.55;               // frame plane height
  const units = [];
  const byId = id => parts.find(p => p.id === id);
  if (byId('frame')) {
    units.push({ part: 'frame', explode: [0, 0, 0.25], meshes: [
      { kind: 'box', size: [L * 0.42, W * 0.42, 0.018],
        center: [0, 0, fz] }] });
  }
  taMotorXY(spec).forEach(([mx, my]) => {
    const ang = Math.atan2(my, mx);
    const reach = Math.hypot(mx, my) * 0.94;
    if (byId('arm')) {
      units.push({ part: 'arm',
        explode: [Math.sign(mx) * 0.35, Math.sign(my) * 0.35, 0.25],
        meshes: [
          { kind: 'box', size: [reach, 0.016, 0.012],
            center: [mx / 2, my / 2, fz], rot: [0, 0, ang] }] });
    }
    if (byId('rotor')) {
      units.push({ part: 'rotor',
        explode: [Math.sign(mx) * 0.6, Math.sign(my) * 0.6, 0.7],
        meshes: [
          { kind: 'cyl', axis: 'z', size: [0.011, 0.016],
            center: [mx, my, fz + 0.004] },
          { kind: 'cyl', axis: 'z', size: [pd / 2, 0.002],
            center: [mx, my, fz + 0.016] }] });
    }
  });
  if (byId('battery')) {
    units.push({ part: 'battery', explode: [0, 0, -0.55], meshes: [
      { kind: 'box', size: [L * 0.38, W * 0.3, 0.026],
        center: [0, 0, fz - 0.026] }] });
  }
  if (byId('fc')) {
    units.push({ part: 'fc', explode: [0, 0, 1], meshes: [
      { kind: 'box', size: [0.042, 0.042, 0.02], center: [0, 0, fz + 0.02] }] });
  }
  const cp = byId('camera');
  if (cp) {
    units.push({ part: 'camera', explode: [0.8, 0, 0], meshes: [
      { kind: 'box', size: [0.012, 0.03, 0.02],
        center: [L * 0.21, 0, fz - 0.01] }] });
  }
  return units;
}

function taGeomQuad(spec, parts) {
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const units = [];
  const byId = id => parts.find(p => p.id === id);
  if (byId('body')) {
    units.push({ part: 'body', explode: [0, 0, 0.45], meshes: [
      { kind: 'box', size: [L * 0.92, W * 0.9, H * 0.36],
        center: [0, 0, H * 0.8] }] });
  }
  if (byId('leg')) {
    const hx = L * 0.36, hy = W * 0.44;
    [[hx, hy], [hx, -hy], [-hx, hy], [-hx, -hy]]
        .slice(0, spec.legs.count).forEach(([x0, y0]) => {
      const bend = Math.sign(x0) * L * 0.045;   // knees bow outward
      units.push({ part: 'leg',
        explode: [Math.sign(x0) * 0.35, Math.sign(y0) * 0.65, -0.1],
        meshes: [
          { kind: 'box', size: [0.032, 0.026, H * 0.34],
            center: [x0 + bend / 2, y0, H * 0.45] },
          { kind: 'box', size: [0.024, 0.02, H * 0.34],
            center: [x0 + bend, y0, H * 0.17] }] });
    });
  }
  if (byId('head')) {
    units.push({ part: 'head', explode: [0.85, 0, 0.25], meshes: [
      { kind: 'box', size: [L * 0.17, W * 0.52, H * 0.2],
        center: [L * 0.52, 0, H * 0.84] }] });
  }
  if (byId('battery')) {
    units.push({ part: 'battery', explode: [0, 0, 1], meshes: [
      { kind: 'box', size: [L * 0.42, W * 0.5, H * 0.15],
        center: [-L * 0.08, 0, H * 0.8] }] });
  }
  return units;
}

function taGeomHumanoid(spec, parts) {
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const units = [];
  const byId = id => parts.find(p => p.id === id);
  if (byId('leg')) {
    [W * 0.22, -W * 0.22].slice(0, spec.legs.count).forEach(y0 => {
      units.push({ part: 'leg',
        explode: [0, Math.sign(y0) * 0.55, -0.05],
        meshes: [
          { kind: 'box', size: [H * 0.05, H * 0.042, H * 0.25],
            center: [0, y0, H * 0.375] },
          { kind: 'box', size: [H * 0.042, H * 0.036, H * 0.25],
            center: [H * 0.008, y0, H * 0.125] },
          { kind: 'box', size: [H * 0.115, H * 0.05, H * 0.028],
            center: [H * 0.032, y0, H * 0.014] }] });
    });
  }
  if (byId('pelvis')) {
    units.push({ part: 'pelvis', explode: [0, 0, 0.1], meshes: [
      { kind: 'box', size: [H * 0.095, W * 0.82, H * 0.09],
        center: [0, 0, H * 0.545] }] });
  }
  if (byId('torso')) {
    units.push({ part: 'torso', explode: [0, 0, 0.55], meshes: [
      { kind: 'box', size: [L * 0.62, W * 0.94, H * 0.3],
        center: [0, 0, H * 0.74] }] });
  }
  if (byId('arm')) {
    [W / 2 + H * 0.03, -(W / 2 + H * 0.03)].slice(0, spec.arms.count)
        .forEach(y0 => {
      units.push({ part: 'arm',
        explode: [0, Math.sign(y0) * 0.8, 0.25],
        meshes: [
          { kind: 'box', size: [H * 0.038, H * 0.032, H * 0.19],
            center: [0, y0, H * 0.775] },
          { kind: 'box', size: [H * 0.032, H * 0.027, H * 0.17],
            center: [H * 0.012, y0, H * 0.595] }] });
    });
  }
  if (byId('head')) {
    units.push({ part: 'head', explode: [0, 0, 1], meshes: [
      { kind: 'box', size: [H * 0.095, H * 0.1, H * 0.115],
        center: [0, 0, H * 0.945] }] });
  }
  if (byId('battery')) {
    units.push({ part: 'battery', explode: [-0.8, 0, 0.4], meshes: [
      { kind: 'box', size: [H * 0.045, W * 0.52, H * 0.17],
        center: [-L * 0.3, 0, H * 0.74] }] });
  }
  return units;
}

function taGeomArm(spec, parts) {
  const R = spec.length_m, H = spec.height_m;
  const units = [];
  const byId = id => parts.find(p => p.id === id);
  if (byId('base')) {
    units.push({ part: 'base', explode: [0, 0, 0], meshes: [
      { kind: 'cyl', axis: 'z', size: [Math.min(0.06, R * 0.16), 0.03],
        center: [0, 0, 0.015] }] });
  }
  if (byId('link')) {
    const segs = [
      { size: [0.046, 0.04, H * 0.42], center: [0, 0, H * 0.24] },
      { size: [R * 0.52, 0.034, 0.03], center: [R * 0.26, 0, H * 0.47] },
      { size: [R * 0.34, 0.028, 0.025], center: [R * 0.62, 0, H * 0.4] },
    ].slice(0, spec.arms.segments);
    segs.forEach((m, i) => {
      units.push({ part: 'link',
        explode: [0.25 * (i + 1), 0, 0.3 * (i + 1)],
        meshes: [{ kind: 'box', size: m.size, center: m.center }] });
    });
  }
  if (byId('gripper')) {
    units.push({ part: 'gripper', explode: [0.9, 0, 0.1], meshes: [
      { kind: 'box', size: [0.045, 0.012, 0.035],
        center: [R * 0.83, spec.width_m / 4, H * 0.36] },
      { kind: 'box', size: [0.045, 0.012, 0.035],
        center: [R * 0.83, -spec.width_m / 4, H * 0.36] }] });
  }
  if (byId('battery')) {
    units.push({ part: 'battery', explode: [-0.5, -0.6, 0], meshes: [
      { kind: 'box', size: [0.095, 0.055, 0.032],
        center: [-R * 0.34, -R * 0.34, 0.016] }] });
  }
  return units;
}
/* == ta3d-geom:end == */

/* --- Electrical overlay + dimensions (SVG) ---
   Deck components (battery, driver, motors, controller — none of
   them drawn kit parts) sit on two rails at the top of each view;
   sensor nodes anchor to their drawn parts. Positions are a wiring
   schematic laid over the spec's geometry, not extra geometry. */
function elecShortLabel(node) {
  return node.label.split(' \u2014 ')[0].split(' (')[0];
}
function elecRails(w) {
  /* deck node id -> [xPx, yPx] on a 700-wide view: first half of the
     deck nodes on the upper rail (y=15), the rest on y=43. */
  const deck = w.nodes.filter(n => n.deck);
  const half = Math.ceil(deck.length / 2), pos = {};
  deck.forEach((n, i) => {
    const rail = i < half ? 0 : 1, k = rail ? i - half : i;
    const count = rail ? deck.length - half : half;
    pos[n.id] = [(k + 1) * 700 / (count + 1), rail ? 43 : 15];
  });
  return pos;
}
function elecAnchorsTop(spec, parts, w, X, Y) {
  const pos = elecRails(w);
  const lp = parts.find(p => p.id === 'lidar');
  const cp = parts.find(p => p.id === 'camera');
  const up = parts.find(p => p.id === 'ultrasonic');
  w.nodes.forEach(n => {
    if (pos[n.id]) return;
    if (n.kit === 'lidar' && lp) pos[n.id] = [X(lp.x), Y(lp.y)];
    else if (n.kit === 'camera' && cp) pos[n.id] = [X(cp.face * spec.length_m / 2), Y(0)];
    else if (n.kit === 'ultrasonic' && up) pos[n.id] = [X(up.face * spec.length_m / 2), Y(0)];
  });
  return pos;
}
function elecAnchorsSide(spec, parts, w, X, Z) {
  const pos = elecRails(w);
  const C = spec.ground_clearance_m, H = spec.height_m;
  const deckTop = C + PLATE_T;
  const lp = parts.find(p => p.id === 'lidar');
  const cp = parts.find(p => p.id === 'camera');
  const up = parts.find(p => p.id === 'ultrasonic');
  w.nodes.forEach(n => {
    if (pos[n.id]) return;
    if (n.kit === 'lidar' && lp) pos[n.id] = [X(lp.x), Z(H)];
    else if (n.kit === 'camera' && cp) pos[n.id] = [X(cp.face * spec.length_m / 2), Z(C + H / 2)];
    else if (n.kit === 'ultrasonic' && up) pos[n.id] = [X(up.face * spec.length_m / 2), Z(deckTop + ULTRA_H / 2)];
  });
  return pos;
}
function elecChip(n, cx, cy, cls, depth) {
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
function elecOverlaySVG(w, anchors) {
  const nodes = elecNodeMap(w), depth = elecDepths(w), bad = elecBad(w);
  const pairCount = {}, pairSeen = {};
  w.connections.forEach(c => {
    const k = [c.from, c.to].sort().join('|');
    pairCount[k] = (pairCount[k] || 0) + 1;
  });
  let wires = '', chips = '', labels = '';
  w.connections.forEach((c, i) => {
    const a = anchors[c.from], b = anchors[c.to];
    if (!a || !b) return;
    const k = [c.from, c.to].sort().join('|');
    const seen = pairSeen[k] || 0; pairSeen[k] = seen + 1;
    const off = (seen - (pairCount[k] - 1) / 2) * 16;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const cx = (a[0] + b[0]) / 2 + (-dy / len) * off;
    const cy = (a[1] + b[1]) / 2 + (dx / len) * off;
    const d = 'M' + a[0] + ' ' + a[1] + ' Q' + cx + ' ' + cy + ' ' + b[0] + ' ' + b[1];
    const mx = 0.25 * a[0] + 0.5 * cx + 0.25 * b[0];
    const my = 0.25 * a[1] + 0.5 * cy + 0.25 * b[1];
    const stage = elecStage(w, depth, i);
    const on = taPower && stage <= taElecStage;
    const isBad = bad.has(i);
    wires += '<g class="wire-g' + (isBad ? ' bad' : '') + (on ? ' on' : '') +
      (taSelWire === i ? ' sel' : '') + '" data-conn="' + i + '" data-stage="' +
      (stage === Infinity ? 'inf' : stage) + '">' +
      '<path class="wire-hit" d="' + d + '"/>' +
      '<path class="wire ' + c.kind + (isBad ? ' bad' : '') + (on ? ' on' : '') +
      '" d="' + d + '"/>' +
      (isBad ? '<text class="wire-badtag" x="' + mx + '" y="' + (my - 8) +
        '" text-anchor="middle">\u26a0 over-voltage</text>' : '') +
      '<text class="wire-label" x="' + mx + '" y="' + (my + 15) +
      '" text-anchor="middle">' + esc(c.kind +
        (c.kind === 'power' ? ' \u00b7 ' + elecVolts(c.volts) : '')) +
      '</text></g>';
  });
  w.nodes.forEach(n => {
    const a = anchors[n.id];
    if (!a) return;
    if (n.deck) {
      const on = taPower && depth[n.id] <= taElecStage;
      const isBad = [...bad].some(i => w.connections[i].to === n.id);
      chips += elecChip(n, a[0], a[1],
        (on ? 'on' : '') + (isBad ? ' bad' : '') + (taSelNode === n.id ? ' sel' : ''),
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
function dimH(x1, x2, y, text) {
  return '<g class="dim"><line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '"/>' +
    '<line x1="' + x1 + '" y1="' + (y - 4) + '" x2="' + x1 + '" y2="' + (y + 4) + '"/>' +
    '<line x1="' + x2 + '" y1="' + (y - 4) + '" x2="' + x2 + '" y2="' + (y + 4) + '"/>' +
    '<text x="' + ((x1 + x2) / 2) + '" y="' + (y - 5) + '" text-anchor="middle">' +
    text + '</text></g>';
}
function dimV(x, yTop, yBot, text, anchor) {
  const tx = anchor === 'end' ? x - 5 : x + 5;
  return '<g class="dim"><line x1="' + x + '" y1="' + yTop + '" x2="' + x + '" y2="' + yBot + '"/>' +
    '<line x1="' + (x - 4) + '" y1="' + yTop + '" x2="' + (x + 4) + '" y2="' + yTop + '"/>' +
    '<line x1="' + (x - 4) + '" y1="' + yBot + '" x2="' + (x + 4) + '" y2="' + yBot + '"/>' +
    '<text x="' + tx + '" y="' + ((yTop + yBot) / 2 + 3.5) + '" text-anchor="' +
    anchor + '">' + text + '</text></g>';
}
function dimVR(x, yTop, yBot, text) {
  const my = (yTop + yBot) / 2;
  return '<g class="dim"><line x1="' + x + '" y1="' + yTop + '" x2="' + x + '" y2="' + yBot + '"/>' +
    '<line x1="' + (x - 4) + '" y1="' + yTop + '" x2="' + (x + 4) + '" y2="' + yTop + '"/>' +
    '<line x1="' + (x - 4) + '" y1="' + yBot + '" x2="' + (x + 4) + '" y2="' + yBot + '"/>' +
    '<text transform="rotate(-90 ' + (x - 6) + ' ' + my + ')" x="' + (x - 6) +
    '" y="' + my + '" text-anchor="middle">' + text + '</text></g>';
}
function taDimsSide(spec, pos, X, Z, S) {
  const L = spec.length_m, H = spec.height_m, C = spec.ground_clearance_m;
  const D = spec.wheel.diameter_m, r = D / 2;
  const wxF = Math.max(...pos.map(p => p[0]));
  const cx = X(wxF), cy = Z(r), dd = r * S * 0.7071;
  let s = '';
  s += '<g class="dim"><line x1="' + (cx - dd) + '" y1="' + (cy + dd) +
    '" x2="' + (cx + dd) + '" y2="' + (cy - dd) + '"/>' +
    '<text x="' + cx + '" y="' + (Z(2 * r) - 6) + '" text-anchor="middle">' +
    '\u00d8 ' + mm(D) + ' mm</text></g>';
  s += dimV(X(-L / 2) - 12, Z(C), Z(0), mm(C) + ' mm', 'end');
  s += dimV(X(L / 2) + 14, Z(H), Z(0), mm(H) + ' mm', 'start');
  s += dimH(X(-L / 2), X(L / 2), Z(0) + 30, mm(L) + ' mm');
  return s;
}
function taDimsTop(spec, pos, X, Y, yMin) {
  const L = spec.length_m, W = spec.width_m, D = spec.wheel.diameter_m;
  const wy = spec.width_m / 2 + spec.wheel.width_m / 2;
  const wxF = Math.max(...pos.map(p => p[0]));
  let s = '';
  s += '<text class="dim-note" x="' + X(wxF) + '" y="' +
    (Y(wy - spec.wheel.width_m / 2) + 16) + '" text-anchor="middle">' +
    '\u00d8 ' + mm(D) + ' mm</text>';
  s += dimVR(X(-L / 2) - 14, Y(W / 2), Y(-W / 2), mm(W) + ' mm');
  s += dimH(X(-L / 2), X(L / 2), Y(yMin) + 18, mm(L) + ' mm');
  return s;
}

/* --- SVG rendering --- */
function svgEl(inner, vb, w) {
  return '<svg viewBox="' + vb + '" width="100%" role="img" style="max-width:' + w + 'px;display:block">' + inner + '</svg>';
}
function shapeAttrs(id) {
  return ' class="part-shape' + (taSelected === id ? ' sel' : '') + '" data-part="' + id + '" tabindex="0" role="button" aria-label="' + id + '"';
}
function taRenderSide(spec, parts, pos) {
  const L = spec.length_m, H = spec.height_m, C = spec.ground_clearance_m;
  const r = spec.wheel.diameter_m / 2, e = taExplode / 1000;
  const deckTop = C + PLATE_T;
  const xs = [...new Set(pos.map(p => p[0]))];
  const xMin = -L / 2 - r - e - 0.03, xMax = L / 2 + r + e + 0.03;
  const zMax = H + e + 0.03;
  const Wpx = 700, Hpx = 330, pad = 14;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / zMax);
  const ox = pad - xMin * S, gy = Hpx - pad; // ground line y (z = 0)
  const X = x => ox + x * S, Z = z => gy - z * S;
  let s = '';
  s += '<line x1="4" y1="' + Z(0) + '" x2="' + (Wpx - 4) + '" y2="' + Z(0) + '" stroke="#454c59" stroke-width="2"/>';
  s += '<text x="8" y="' + (Z(0) + 16) + '" fill="#9aa3ae" font-size="11">ground (z = 0)</text>';
  /* chassis plate */
  s += '<g' + shapeAttrs('plate') + '><rect x="' + X(-L / 2) + '" y="' + Z(deckTop) +
    '" width="' + (L * S) + '" height="' + (PLATE_T * S) + '" rx="3" fill="#8a5a17" stroke="#f59e0b" stroke-width="1.4"/></g>';
  /* casters */
  if (spec.wheel.count === 2) {
    const cx = L / 2 - C;
    [-cx, cx].forEach(x0 => {
      const dx = Math.sign(x0) * e;
      s += '<g' + shapeAttrs('caster') + '><circle cx="' + X(x0 + dx) + '" cy="' + Z(C / 2 - e * 0.25) +
        '" r="' + (C / 2 * S) + '" fill="#5b6472" stroke="#9aa3ae" stroke-width="1.2"/></g>';
    });
  }
  /* motor mounts (one rect per distinct wheel x) */
  const mw = Math.max(spec.wheel.width_m, 0.024);
  xs.forEach(x0 => {
    const dx = Math.sign(x0) * e * 0.7;
    s += '<g' + shapeAttrs('mount') + '><rect x="' + X(x0 + dx - mw / 2) + '" y="' + Z(deckTop) +
      '" width="' + (mw * S) + '" height="' + (deckTop * S) + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  });
  /* wheels (side view: +/- y pairs overlap) */
  xs.forEach(x0 => {
    const dx = Math.sign(x0) * e * 0.7, dz = x0 === 0 ? -e * 0.8 : 0;
    s += '<g' + shapeAttrs('wheel') + '><circle cx="' + X(x0 + dx) + '" cy="' + Z(r + dz) +
      '" r="' + (r * S) + '" fill="#22262e" stroke="#e8eaee" stroke-width="2"/>' +
      '<circle cx="' + X(x0 + dx) + '" cy="' + Z(r + dz) + '" r="' + (r * S * 0.32) +
      '" fill="none" stroke="#9aa3ae" stroke-width="1.4"/></g>';
  });
  /* lidar */
  const lp = parts.find(p => p.id === 'lidar');
  if (lp) {
    s += '<g' + shapeAttrs('lidar') + '>' +
      '<rect x="' + X(lp.x - POST_D / 2) + '" y="' + Z(H - 0.010 + e) + '" width="' + (POST_D * S) +
      '" height="' + ((H - 0.010 - deckTop + e) * S) + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/>' +
      '<rect x="' + X(lp.x - LIDAR_DISC_D / 2) + '" y="' + Z(H + e) + '" width="' + (LIDAR_DISC_D * S) +
      '" height="' + (0.010 * S) + '" rx="3" fill="#22262e" stroke="#e8eaee" stroke-width="1.6"/></g>';
  }
  /* camera */
  const cp = parts.find(p => p.id === 'camera');
  if (cp) {
    const fx = cp.face * (L / 2 + e) + (cp.face > 0 ? 0 : -PLATE_T);
    const zb = C + H / 2 + e * 0.2;
    s += '<g' + shapeAttrs('camera') + '><rect x="' + X(fx) + '" y="' + Z(zb + CAM_H / 2) +
      '" width="' + (PLATE_T * S) + '" height="' + (CAM_H * S) + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  /* ultrasonic */
  const up = parts.find(p => p.id === 'ultrasonic');
  if (up) {
    const fx = up.face * (L / 2 + e) + (up.face > 0 ? 0 : -PLATE_T);
    const zb = deckTop + e * 0.2;
    s += '<g' + shapeAttrs('ultrasonic') + '><rect x="' + X(fx) + '" y="' + Z(zb + ULTRA_H) +
      '" width="' + (PLATE_T * S) + '" height="' + (ULTRA_H * S) + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/>' +
      '<circle cx="' + X(up.face * (L / 2 + e) + up.face * PLATE_T) + '" cy="' + Z(zb + ULTRA_H / 2) +
      '" r="' + (ULTRA_CAN_D / 2 * S) + '" fill="#22262e" stroke="#e8eaee" stroke-width="1.2"/></g>';
  }
  if (taElec && spec.wiring) {
    s += elecOverlaySVG(spec.wiring,
                        elecAnchorsSide(spec, parts, spec.wiring, X, Z));
  }
  s += taDimsSide(spec, pos, X, Z, S);
  return svgEl(s, '0 0 ' + Wpx + ' ' + (Hpx + 38), 700);
}
function taRenderTop(spec, parts, pos) {
  const L = spec.length_m, W = spec.width_m, e = taExplode / 1000;
  const wy = spec.width_m / 2 + spec.wheel.width_m / 2;
  const xMin = -L / 2 - e - 0.03, xMax = L / 2 + e + 0.03;
  const yMin = -wy - spec.wheel.width_m / 2 - e - 0.03, yMax = -yMin;
  const Wpx = 700, Hpx = 300, pad = 14;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / (yMax - yMin));
  const ox = pad - xMin * S, oy = pad - yMin * S;
  const X = x => ox + x * S, Y = y => oy - y * S; // +y to the left of screen-up = robot left
  let s = '';
  s += '<g' + shapeAttrs('plate') + '><rect x="' + X(-L / 2) + '" y="' + Y(W / 2) +
    '" width="' + (L * S) + '" height="' + (W * S) + '" rx="6" fill="#8a5a17" stroke="#f59e0b" stroke-width="1.4"/></g>';
  if (spec.wheel.count === 2) {
    const cx = L / 2 - spec.ground_clearance_m;
    [-cx, cx].forEach(x0 => {
      s += '<g' + shapeAttrs('caster') + '><circle cx="' + X(x0 + Math.sign(x0) * e * 0.5) + '" cy="' + Y(0) +
        '" r="' + (spec.ground_clearance_m / 2 * S) + '" fill="#5b6472" stroke="#9aa3ae" stroke-width="1.2"/></g>';
    });
  }
  pos.forEach(([x0, y0]) => {
    const dy = Math.sign(y0) * e;
    s += '<g' + shapeAttrs('mount') + '><rect x="' + X(x0 - spec.wheel.diameter_m * 0.18) +
      '" y="' + Y(Math.sign(y0) * (W / 2 - 0.002)) + '" width="' + (spec.wheel.diameter_m * 0.36 * S) +
      '" height="' + (0.010 * S) + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1"/></g>';
    s += '<g' + shapeAttrs('wheel') + '><rect x="' + X(x0 - spec.wheel.diameter_m / 2) +
      '" y="' + Y(y0 + dy + spec.wheel.width_m / 2) + '" width="' + (spec.wheel.diameter_m * S) +
      '" height="' + (spec.wheel.width_m * S) + '" rx="4" fill="#22262e" stroke="#e8eaee" stroke-width="1.8"/></g>';
  });
  const lp = parts.find(p => p.id === 'lidar');
  if (lp) s += '<g' + shapeAttrs('lidar') + '><circle cx="' + X(lp.x) + '" cy="' + Y(lp.y) +
    '" r="' + (LIDAR_DISC_D / 2 * S) + '" fill="#22262e" stroke="#e8eaee" stroke-width="1.6"/></g>';
  const cp = parts.find(p => p.id === 'camera');
  if (cp) s += '<g' + shapeAttrs('camera') + '><rect x="' + X(cp.face * (L / 2 + e) + (cp.face > 0 ? 0 : -PLATE_T)) +
    '" y="' + Y(CAM_W / 2) + '" width="' + (PLATE_T * S) + '" height="' + (CAM_W * S) +
    '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  const up = parts.find(p => p.id === 'ultrasonic');
  if (up) s += '<g' + shapeAttrs('ultrasonic') + '><rect x="' + X(up.face * (L / 2 + e) + (up.face > 0 ? 0 : -PLATE_T)) +
    '" y="' + Y(0.026) + '" width="' + (PLATE_T * S) + '" height="' + (0.052 * S) +
    '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  if (taElec && spec.wiring) {
    s += elecOverlaySVG(spec.wiring,
                        elecAnchorsTop(spec, parts, spec.wiring, X, Y));
  }
  s += taDimsTop(spec, pos, X, Y, yMin);
  const vbH = Math.max(Hpx, Y(yMin) + 44);
  s += '<text x="' + (Wpx - 8) + '" y="' + (vbH - 6) + '" fill="#9aa3ae" font-size="11" text-anchor="end">front is to the right</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + vbH, 700);
}
/* --- Class views (aerial / quadruped / humanoid / arm) ---
   The same schematic language as the ground views — same palette,
   same explode slider, same click-a-part groups, dimension lines
   from the spec's numbers only — drawn for robots that do not roll.
   Positions are fractions of the declared dimensions, exactly the
   derivation taGeom3d uses, so the flat views and the 3D scene show
   the same layout. */
function taClassFrame(xMin, xMax, zMax, Hpx) {
  const Wpx = 700, pad = 14;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / zMax);
  const ox = pad - xMin * S, gy = Hpx - pad;
  return { Wpx, Hpx, S, X: x => ox + x * S, Z: z => gy - z * S };
}
function taGroundLine(Z, Wpx, label) {
  return '<line x1="4" y1="' + Z(0) + '" x2="' + (Wpx - 4) + '" y2="' + Z(0) +
    '" stroke="#454c59" stroke-width="2"/>' +
    '<text x="8" y="' + (Z(0) + 16) + '" fill="#9aa3ae" font-size="11">' +
    label + '</text>';
}
function taElecOverlay(spec) {
  return (taElec && spec.wiring)
    ? elecOverlaySVG(spec.wiring, elecRails(spec.wiring)) : '';
}

function taRenderAerialSide(spec, parts) {
  const L = spec.length_m, H = spec.height_m, pd = spec.rotors.prop_diameter_m;
  const e = taExplode / 1000, fz = H * 0.55;
  const { Wpx, S, X, Z } = taClassFrame(-L / 2 - pd / 2 - e - 0.03,
    L / 2 + pd / 2 + e + 0.03, H + e + 0.05, 300);
  const byId = id => parts.find(p => p.id === id);
  let s = taGroundLine(Z, Wpx, 'ground (z = 0)');
  [-L / 2, L / 2].forEach(mx => {
    s += '<line x1="' + X(mx) + '" y1="' + Z(fz) + '" x2="' + X(mx) +
      '" y2="' + Z(0) + '" stroke="#454c59" stroke-width="1" stroke-dasharray="3 4"/>';
  });
  if (byId('battery')) {
    const bw = L * 0.38 * S, bh = 0.026 * S;
    s += '<g' + shapeAttrs('battery') + '><rect x="' + (X(0) - bw / 2) +
      '" y="' + Z(fz - 0.013 - e * 0.55) + '" width="' + bw + '" height="' + bh +
      '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('frame')) {
    const fw = L * 0.42 * S;
    s += '<g' + shapeAttrs('frame') + '><rect x="' + (X(0) - fw / 2) +
      '" y="' + Z(fz + 0.009 + e * 0.25) + '" width="' + fw + '" height="' +
      (0.018 * S) + '" rx="3" fill="#8a5a17" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  [-1, 1].forEach(sd => {
    const mx = sd * L / 2, ex = sd * e;
    if (byId('arm')) {
      s += '<g' + shapeAttrs('arm') + '><line x1="' + X(sd * L * 0.2) +
        '" y1="' + Z(fz + e * 0.25) + '" x2="' + X(mx + ex * 0.35) +
        '" y2="' + Z(fz + e * 0.25) + '" stroke="#9aa3ae" stroke-width="5"/></g>';
    }
    if (byId('rotor')) {
      const rx = mx + ex * 0.6, rz = fz + e * 0.7;
      s += '<g' + shapeAttrs('rotor') + '><rect x="' + (X(rx) - 0.011 * S / 2) +
        '" y="' + Z(rz + 0.012) + '" width="' + (0.011 * S) + '" height="' +
        (0.016 * S) + '" fill="#22262e" stroke="#e8eaee" stroke-width="1.2"/>' +
        '<line x1="' + X(rx - pd / 2) + '" y1="' + Z(rz + 0.016) + '" x2="' +
        X(rx + pd / 2) + '" y2="' + Z(rz + 0.016) + '" stroke="#e8eaee" stroke-width="2.4"/></g>';
    }
  });
  if (byId('fc')) {
    const fw = 0.042 * S;
    s += '<g' + shapeAttrs('fc') + '><rect x="' + (X(0) - fw / 2) +
      '" y="' + Z(fz + 0.03 + e) + '" width="' + fw + '" height="' + (0.02 * S) +
      '" rx="2" fill="#22262e" stroke="#34d399" stroke-width="1.4"/></g>';
  }
  if (byId('camera')) {
    s += '<g' + shapeAttrs('camera') + '><rect x="' + X(L * 0.21 + e * 0.8) +
      '" y="' + Z(fz - 0.02) + '" width="' + (0.012 * S) + '" height="' +
      (0.02 * S) + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  s += taElecOverlay(spec);
  s += dimH(X(-L / 2), X(L / 2), Z(0) + 30,
    mm(L) + ' mm motor-to-motor');
  s += dimV(X(L / 2 + pd / 2) + 14, Z(H), Z(0), mm(H) + ' mm', 'start');
  s += '<text class="dim-note" x="' + X(-L / 2) + '" y="' + (Z(fz + 0.016) - 8) +
    '" text-anchor="middle">\u00d8 ' + mm(pd) + ' mm prop</text>';
  return svgEl(s, '0 0 ' + Wpx + ' 338', 700);
}
function taRenderAerialTop(spec, parts) {
  const L = spec.length_m, W = spec.width_m, pd = spec.rotors.prop_diameter_m;
  const e = taExplode / 1000;
  const ext = Math.max(L, W) / 2 + pd / 2 + e + 0.03;
  const Wpx = 700, Hpx = 320, pad = 14;
  const S = Math.min((Wpx - 2 * pad) / (2 * ext), (Hpx - 2 * pad) / (2 * ext));
  const ox = Wpx / 2, oy = Hpx / 2;
  const X = x => ox + x * S, Y = y => oy - y * S;
  const byId = id => parts.find(p => p.id === id);
  let s = '';
  taMotorXY(spec).forEach(([mx, my]) => {
    const ex = Math.sign(mx) * e * 0.6, ey = Math.sign(my) * e * 0.6;
    if (byId('arm')) {
      s += '<g' + shapeAttrs('arm') + '><line x1="' + X(0) + '" y1="' + Y(0) +
        '" x2="' + X(mx + ex) + '" y2="' + Y(my + ey) +
        '" stroke="#9aa3ae" stroke-width="6"/></g>';
    }
    if (byId('rotor')) {
      s += '<g' + shapeAttrs('rotor') + '><circle cx="' + X(mx + ex) +
        '" cy="' + Y(my + ey) + '" r="' + (pd / 2 * S) +
        '" fill="rgba(232,234,238,0.05)" stroke="#e8eaee" stroke-width="1.6"/>' +
        '<circle cx="' + X(mx + ex) + '" cy="' + Y(my + ey) + '" r="' +
        (0.011 * S) + '" fill="#22262e" stroke="#e8eaee" stroke-width="1.2"/></g>';
    }
  });
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery') + '><rect x="' + X(-L * 0.19) +
      '" y="' + Y(W * 0.15 - e * 0.55) + '" width="' + (L * 0.38 * S) +
      '" height="' + (W * 0.3 * S) + '" rx="4" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('frame')) {
    s += '<g' + shapeAttrs('frame') + '><rect x="' + X(-L * 0.21) +
      '" y="' + Y(W * 0.21 + e * 0.25) + '" width="' + (L * 0.42 * S) +
      '" height="' + (W * 0.42 * S) + '" rx="6" fill="rgba(138,90,23,0.55)" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('fc')) {
    const fw = 0.042 * S;
    s += '<g' + shapeAttrs('fc') + '><rect x="' + (X(0) - fw / 2) +
      '" y="' + (Y(0 + e) - fw / 2) + '" width="' + fw + '" height="' + fw +
      '" rx="2" fill="#22262e" stroke="#34d399" stroke-width="1.4"/></g>';
  }
  if (byId('camera')) {
    s += '<g' + shapeAttrs('camera') + '><rect x="' + X(L * 0.21 + e * 0.8) +
      '" y="' + (Y(0) - 0.015 * S) + '" width="' + (0.012 * S) + '" height="' +
      (0.03 * S) + '" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  s += taElecOverlay(spec);
  s += '<line x1="' + X(-L / 2) + '" y1="' + Y(-W / 2) + '" x2="' + X(L / 2) +
    '" y2="' + Y(W / 2) + '" stroke="#f59e0b" stroke-width="1" stroke-dasharray="4 4"/>';
  s += '<text class="dim-note" x="' + X(0) + '" y="' + (Y(0) - 8) +
    '" text-anchor="middle">diagonal ' + mm(Math.hypot(L, W)) + ' mm</text>';
  s += dimH(X(-L / 2), X(L / 2), Y(-ext) + 20, mm(L) + ' mm motor-to-motor');
  s += dimVR(X(-ext) - 6, Y(W / 2), Y(-W / 2), mm(W) + ' mm');
  s += '<text x="' + (Wpx - 8) + '" y="' + (Hpx - 6) + '" fill="#9aa3ae" font-size="11" text-anchor="end">front is to the right</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + Hpx, 700);
}

function taRenderQuadSide(spec, parts) {
  const L = spec.length_m, H = spec.height_m;
  const e = taExplode / 1000;
  const { Wpx, S, X, Z } = taClassFrame(-L / 2 - e - 0.05, L * 0.68 + e + 0.03,
    H + e + 0.04, 320);
  const byId = id => parts.find(p => p.id === id);
  const legSide = (hx, far) => {
    const bend = Math.sign(hx) * L * 0.045;
    const ex = Math.sign(hx) * e * 0.35, ez = -e * 0.1;
    const col = far ? '#454c59' : '#9aa3ae';
    const off = far ? -0.012 : 0;
    return '<g' + (far ? '' : shapeAttrs('leg')) + '><line x1="' +
      X(hx + off + ex) + '" y1="' + Z(H * 0.62 + ez) + '" x2="' +
      X(hx + bend / 2 + off + ex) + '" y2="' + Z(H * 0.28 + ez) +
      '" stroke="' + col + '" stroke-width="7" stroke-linecap="round"/>' +
      '<line x1="' + X(hx + bend / 2 + off + ex) + '" y1="' + Z(H * 0.28 + ez) +
      '" x2="' + X(hx + bend + off + ex) + '" y2="' + Z(0.005 + ez) +
      '" stroke="' + col + '" stroke-width="5.5" stroke-linecap="round"/></g>';
  };
  let s = taGroundLine(Z, Wpx, 'ground (z = 0)');
  if (byId('leg')) { s += legSide(-L * 0.36, true); s += legSide(L * 0.36, true); }
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery') + '><rect x="' + X(-L * 0.29) +
      '" y="' + Z(H * 0.875 + e) + '" width="' + (L * 0.42 * S) + '" height="' +
      (H * 0.15 * S) + '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2" stroke-dasharray="4 3"/></g>';
  }
  if (byId('body')) {
    s += '<g' + shapeAttrs('body') + '><rect x="' + X(-L * 0.46) +
      '" y="' + Z(H * 0.98 + e * 0.45) + '" width="' + (L * 0.92 * S) +
      '" height="' + (H * 0.36 * S) + '" rx="8" fill="#51606f" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('leg')) { s += legSide(-L * 0.36, false); s += legSide(L * 0.36, false); }
  if (byId('head')) {
    s += '<g' + shapeAttrs('head') + '><rect x="' + X(L * 0.435 + e * 0.85) +
      '" y="' + Z(H * 0.94 + e * 0.25) + '" width="' + (L * 0.17 * S) +
      '" height="' + (H * 0.2 * S) + '" rx="5" fill="#22262e" stroke="#e8eaee" stroke-width="1.4"/></g>';
  }
  s += taElecOverlay(spec);
  s += dimH(X(-L / 2), X(L / 2), Z(0) + 30, mm(L) + ' mm');
  s += dimV(X(L * 0.68) + 12, Z(H), Z(0), mm(H) + ' mm standing', 'start');
  return svgEl(s, '0 0 ' + Wpx + ' 358', 700);
}
function taRenderQuadTop(spec, parts) {
  const L = spec.length_m, W = spec.width_m;
  const e = taExplode / 1000;
  const Wpx = 700, Hpx = 300, pad = 14;
  const xMin = -L / 2 - e - 0.04, xMax = L * 0.68 + e + 0.03;
  const yExt = W / 2 + 0.035 + e + 0.03;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / (2 * yExt));
  const ox = pad - xMin * S, oy = Hpx / 2;
  const X = x => ox + x * S, Y = y => oy - y * S;
  const byId = id => parts.find(p => p.id === id);
  let s = '';
  if (byId('leg')) {
    [[L * 0.36, W * 0.44], [L * 0.36, -W * 0.44], [-L * 0.36, W * 0.44],
     [-L * 0.36, -W * 0.44]].slice(0, spec.legs.count).forEach(([hx, hy]) => {
      s += '<g' + shapeAttrs('leg') + '><rect x="' +
        X(hx + Math.sign(hx) * e * 0.35 - 0.016) + '" y="' +
        Y(hy + Math.sign(hy) * (0.013 + e * 0.65)) + '" width="' + (0.032 * S) +
        '" height="' + (0.026 * S) + '" rx="3" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.1"/></g>';
    });
  }
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery') + '><rect x="' + X(-L * 0.29) +
      '" y="' + Y(W * 0.25 + e) + '" width="' + (L * 0.42 * S) + '" height="' +
      (W * 0.5 * S) + '" rx="4" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2" stroke-dasharray="4 3"/></g>';
  }
  if (byId('body')) {
    s += '<g' + shapeAttrs('body') + '><rect x="' + X(-L * 0.46) +
      '" y="' + Y(W * 0.45 + e * 0.45) + '" width="' + (L * 0.92 * S) +
      '" height="' + (W * 0.9 * S) + '" rx="8" fill="rgba(81,96,111,0.75)" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('head')) {
    s += '<g' + shapeAttrs('head') + '><rect x="' + X(L * 0.435 + e * 0.85) +
      '" y="' + Y(W * 0.26 + e * 0.25) + '" width="' + (L * 0.17 * S) +
      '" height="' + (W * 0.52 * S) + '" rx="5" fill="#22262e" stroke="#e8eaee" stroke-width="1.4"/></g>';
  }
  s += taElecOverlay(spec);
  s += dimH(X(-L / 2), X(L / 2), Y(-yExt) + 20, mm(L) + ' mm');
  s += dimVR(X(-L / 2) - 16, Y(W / 2), Y(-W / 2), mm(W) + ' mm');
  s += '<text x="' + (Wpx - 8) + '" y="' + (Hpx - 6) + '" fill="#9aa3ae" font-size="11" text-anchor="end">front is to the right</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + Hpx, 700);
}

function taRenderHumanoidSide(spec, parts) {
  const L = spec.length_m, H = spec.height_m;
  const e = taExplode / 1000;
  const xw = L * 0.31 + H * 0.06;
  const { Wpx, S, X, Z } = taClassFrame(-xw - e - 0.03, xw + e + 0.05,
    H + e + 0.04, 360);
  const byId = id => parts.find(p => p.id === id);
  let s = taGroundLine(Z, Wpx, 'ground (z = 0)');
  if (byId('leg')) {
    const lw = H * 0.042 * S;
    s += '<g' + shapeAttrs('leg') + '><rect x="' + (X(0) - lw / 2) +
      '" y="' + Z(H * 0.5 - e * 0.05) + '" width="' + lw + '" height="' +
      (H * 0.25 * S) + '" rx="4" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/>' +
      '<rect x="' + (X(H * 0.008) - lw / 2) + '" y="' + Z(H * 0.25 - e * 0.05) +
      '" width="' + lw + '" height="' + (H * 0.25 * S) + '" rx="4" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/>' +
      '<rect x="' + X(H * 0.032 - H * 0.0575) + '" y="' + Z(H * 0.028 - e * 0.05) +
      '" width="' + (H * 0.115 * S) + '" height="' + (H * 0.028 * S) +
      '" rx="3" fill="#22262e" stroke="#e8eaee" stroke-width="1.2"/></g>';
  }
  if (byId('pelvis')) {
    s += '<g' + shapeAttrs('pelvis') + '><rect x="' + X(-H * 0.0475) +
      '" y="' + Z(H * 0.59 + e * 0.1) + '" width="' + (H * 0.095 * S) +
      '" height="' + (H * 0.09 * S) + '" rx="4" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery') + '><rect x="' + X(-L * 0.3 - H * 0.045 - e * 0.8) +
      '" y="' + Z(H * 0.825 + e * 0.4) + '" width="' + (H * 0.045 * S) +
      '" height="' + (H * 0.17 * S) + '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('torso')) {
    s += '<g' + shapeAttrs('torso') + '><rect x="' + X(-L * 0.31) +
      '" y="' + Z(H * 0.89 + e * 0.55) + '" width="' + (L * 0.62 * S) +
      '" height="' + (H * 0.3 * S) + '" rx="6" fill="#51606f" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('arm')) {
    const aw = H * 0.032 * S, ax = L * 0.31 + H * 0.01;
    s += '<g' + shapeAttrs('arm') + '><rect x="' + X(ax + e * 0.1) +
      '" y="' + Z(H * 0.87 + e * 0.25) + '" width="' + aw + '" height="' +
      (H * 0.19 * S) + '" rx="4" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/>' +
      '<rect x="' + X(ax + H * 0.012 + e * 0.1) + '" y="' + Z(H * 0.68 + e * 0.25) +
      '" width="' + aw + '" height="' + (H * 0.17 * S) + '" rx="4" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('head')) {
    s += '<g' + shapeAttrs('head') + '><rect x="' + X(-H * 0.0475) +
      '" y="' + Z(H * 1.0 + e) + '" width="' + (H * 0.095 * S) + '" height="' +
      (H * 0.115 * S) + '" rx="5" fill="#22262e" stroke="#e8eaee" stroke-width="1.4"/></g>';
  }
  s += taElecOverlay(spec);
  s += dimV(X(xw) + 16, Z(H), Z(0), mm(H) + ' mm tall', 'start');
  s += dimH(X(-L / 2), X(L / 2), Z(0) + 30, mm(L) + ' mm deep');
  return svgEl(s, '0 0 ' + Wpx + ' 398', 700);
}
function taRenderHumanoidTop(spec, parts) {
  const L = spec.length_m, W = spec.width_m, H = spec.height_m;
  const e = taExplode / 1000;
  const Wpx = 700, Hpx = 300, pad = 14;
  const xExt = L / 2 + e + 0.04, yExt = W / 2 + H * 0.05 + e + 0.03;
  const S = Math.min((Wpx - 2 * pad) / (2 * xExt), (Hpx - 2 * pad) / (2 * yExt));
  const ox = Wpx / 2, oy = Hpx / 2;
  const X = x => ox + x * S, Y = y => oy - y * S;
  const byId = id => parts.find(p => p.id === id);
  let s = '';
  if (byId('arm')) {
    [W / 2 + H * 0.03, -(W / 2 + H * 0.03)].slice(0, spec.arms.count).forEach(y0 => {
      s += '<g' + shapeAttrs('arm') + '><rect x="' + X(-H * 0.019) +
        '" y="' + Y(y0 + Math.sign(y0) * e * 0.8 + H * 0.016) + '" width="' +
        (H * 0.038 * S) + '" height="' + (H * 0.032 * S) + '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.1"/></g>';
    });
  }
  if (byId('leg')) {
    [W * 0.22, -W * 0.22].slice(0, spec.legs.count).forEach(y0 => {
      s += '<g' + shapeAttrs('leg') + '><rect x="' + X(-H * 0.025) +
        '" y="' + Y(y0 + Math.sign(y0) * e * 0.55 + H * 0.021) + '" width="' +
        (H * 0.05 * S) + '" height="' + (H * 0.042 * S) + '" rx="3" fill="#3d4656" stroke="#9aa3ae" stroke-width="1.1"/></g>';
    });
  }
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery') + '><rect x="' + X(-L * 0.3 - H * 0.045 - e * 0.8) +
      '" y="' + Y(W * 0.26 + e * 0.4) + '" width="' + (H * 0.045 * S) +
      '" height="' + (W * 0.52 * S) + '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('torso')) {
    s += '<g' + shapeAttrs('torso') + '><rect x="' + X(-L * 0.31) +
      '" y="' + Y(W * 0.47 + e * 0.55) + '" width="' + (L * 0.62 * S) +
      '" height="' + (W * 0.94 * S) + '" rx="6" fill="rgba(81,96,111,0.8)" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('pelvis')) {
    s += '<g' + shapeAttrs('pelvis') + '><rect x="' + X(-H * 0.0475) +
      '" y="' + Y(W * 0.41 + e * 0.1) + '" width="' + (H * 0.095 * S) +
      '" height="' + (W * 0.82 * S) + '" rx="4" fill="none" stroke="#9aa3ae" stroke-width="1" stroke-dasharray="4 3"/></g>';
  }
  if (byId('head')) {
    s += '<g' + shapeAttrs('head') + '><circle cx="' + X(0) + '" cy="' +
      Y(e) + '" r="' + (H * 0.05 * S) + '" fill="#22262e" stroke="#e8eaee" stroke-width="1.4"/></g>';
  }
  s += taElecOverlay(spec);
  s += dimH(X(-L / 2), X(L / 2), Y(-yExt) + 20, mm(L) + ' mm deep');
  s += dimVR(X(-xExt) - 6, Y(W / 2), Y(-W / 2), mm(W) + ' mm wide');
  s += '<text x="' + (Wpx - 8) + '" y="' + (Hpx - 6) + '" fill="#9aa3ae" font-size="11" text-anchor="end">front is to the right</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + Hpx, 700);
}

function taRenderArmSide(spec, parts) {
  const R = spec.length_m, H = spec.height_m;
  const e = taExplode / 1000;
  const { Wpx, S, X, Z } = taClassFrame(-R * 0.5 - e - 0.03, R + e + 0.04,
    H + e + 0.04, 320);
  const byId = id => parts.find(p => p.id === id);
  let s = taGroundLine(Z, Wpx, 'table (z = 0)');
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery') + '><rect x="' + X(-R * 0.34 - 0.0475 - e * 0.5) +
      '" y="' + Z(0.032 - e * 0.6) + '" width="' + (0.095 * S) + '" height="' +
      (0.032 * S) + '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('base')) {
    s += '<g' + shapeAttrs('base') + '><rect x="' + X(-0.05) +
      '" y="' + Z(0.03) + '" width="' + (0.1 * S) + '" height="' + (0.03 * S) +
      '" rx="3" fill="#8a5a17" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('link')) {
    const pts = [[0, 0.03, 0], [0, H * 0.45, 1], [R * 0.52, H * 0.47, 2],
                 [R * 0.79, H * 0.4, 3]];
    for (let i = 0; i < Math.min(spec.arms.segments, 3); i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const ex = e * 0.25 * (i + 1), ez = e * 0.3 * (i + 1);
      s += '<g' + shapeAttrs('link') + '><line x1="' + X(x1 + ex) +
        '" y1="' + Z(z1 + ez) + '" x2="' + X(x2 + ex) + '" y2="' + Z(z2 + ez) +
        '" stroke="#9aa3ae" stroke-width="8" stroke-linecap="round"/></g>';
    }
  }
  if (byId('gripper')) {
    const gx = R * 0.83 + e * 0.9, gz = H * 0.4;
    s += '<g' + shapeAttrs('gripper') + '><line x1="' + X(gx) + '" y1="' +
      Z(gz + spec.width_m / 2 + e * 0.1) + '" x2="' + X(gx + 0.045) +
      '" y2="' + Z(gz + spec.width_m / 2 + e * 0.1) + '" stroke="#e8eaee" stroke-width="4"/>' +
      '<line x1="' + X(gx) + '" y1="' + Z(gz - spec.width_m / 2 + e * 0.1) +
      '" x2="' + X(gx + 0.045) + '" y2="' + Z(gz - spec.width_m / 2 + e * 0.1) +
      '" stroke="#e8eaee" stroke-width="4"/></g>';
  }
  s += taElecOverlay(spec);
  s += dimH(X(0), X(R), Z(0) + 30, 'reach ' + mm(R) + ' mm');
  s += dimV(X(R) + 14, Z(H), Z(0), mm(H) + ' mm', 'start');
  return svgEl(s, '0 0 ' + Wpx + ' 358', 700);
}
function taRenderArmTop(spec, parts) {
  const R = spec.length_m;
  const e = taExplode / 1000;
  const Wpx = 700, Hpx = 280, pad = 14;
  const xMin = -R * 0.5 - e - 0.03, xMax = R + e + 0.04;
  const yExt = R * 0.42 + e + 0.03;
  const S = Math.min((Wpx - 2 * pad) / (xMax - xMin), (Hpx - 2 * pad) / (2 * yExt));
  const ox = pad - xMin * S, oy = Hpx / 2;
  const X = x => ox + x * S, Y = y => oy - y * S;
  const byId = id => parts.find(p => p.id === id);
  let s = '';
  if (byId('battery')) {
    s += '<g' + shapeAttrs('battery') + '><rect x="' + X(-R * 0.34 - 0.0475 - e * 0.5) +
      '" y="' + Y(-R * 0.34 + 0.0275 - e * 0.6) + '" width="' + (0.095 * S) +
      '" height="' + (0.055 * S) + '" rx="3" fill="#51606f" stroke="#9aa3ae" stroke-width="1.2"/></g>';
  }
  if (byId('link')) {
    s += '<g' + shapeAttrs('link') + '><line x1="' + X(0) + '" y1="' + Y(0) +
      '" x2="' + X(R * 0.79 + e * 0.75) + '" y2="' + Y(0) +
      '" stroke="#9aa3ae" stroke-width="8" stroke-linecap="round"/></g>';
  }
  if (byId('base')) {
    s += '<g' + shapeAttrs('base') + '><circle cx="' + X(0) + '" cy="' + Y(0) +
      '" r="' + (Math.min(0.06, R * 0.16) * S) + '" fill="#8a5a17" stroke="#f59e0b" stroke-width="1.4"/></g>';
  }
  if (byId('gripper')) {
    const gx = R * 0.83 + e * 0.9;
    s += '<g' + shapeAttrs('gripper') + '><line x1="' + X(gx) + '" y1="' +
      Y(spec.width_m / 2) + '" x2="' + X(gx + 0.045) + '" y2="' +
      Y(spec.width_m / 2) + '" stroke="#e8eaee" stroke-width="4"/>' +
      '<line x1="' + X(gx) + '" y1="' + Y(-spec.width_m / 2) + '" x2="' +
      X(gx + 0.045) + '" y2="' + Y(-spec.width_m / 2) + '" stroke="#e8eaee" stroke-width="4"/></g>';
  }
  s += taElecOverlay(spec);
  s += dimH(X(0), X(R), Y(-yExt) + 20, 'reach ' + mm(R) + ' mm');
  s += '<text x="' + (Wpx - 8) + '" y="' + (Hpx - 6) + '" fill="#9aa3ae" font-size="11" text-anchor="end">the arm reaches to the right</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + Hpx, 700);
}

function taRender() {
  const spec = taSpec;
  if (!spec) return;
  const { parts, pos } = taBuildParts(spec);
  taParts = parts;
  const cls = taClass(spec);
  if (cls === 'aerial') {
    $('#ta-side').innerHTML = taRenderAerialSide(spec, parts);
    $('#ta-top').innerHTML = taRenderAerialTop(spec, parts);
  } else if (cls === 'quadruped') {
    $('#ta-side').innerHTML = taRenderQuadSide(spec, parts);
    $('#ta-top').innerHTML = taRenderQuadTop(spec, parts);
  } else if (cls === 'humanoid') {
    $('#ta-side').innerHTML = taRenderHumanoidSide(spec, parts);
    $('#ta-top').innerHTML = taRenderHumanoidTop(spec, parts);
  } else if (cls === 'arm') {
    $('#ta-side').innerHTML = taRenderArmSide(spec, parts);
    $('#ta-top').innerHTML = taRenderArmTop(spec, parts);
  } else {
    $('#ta-side').innerHTML = taRenderSide(spec, parts, pos);
    $('#ta-top').innerHTML = taRenderTop(spec, parts, pos);
  }
  $$('#ta .part-shape').forEach(g =>
    ['click', 'keydown'].forEach(t => g.addEventListener(t, ev => {
      if (t === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault(); taSelect(g.dataset.part);
    })));
  $$('#ta .wire-g').forEach(g => {
    g.setAttribute('tabindex', '0');
    g.addEventListener('click', () => taSelectWire(Number(g.dataset.conn)));
    g.addEventListener('mouseenter', () => taWireInfo(Number(g.dataset.conn)));
    g.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault(); taSelectWire(Number(g.dataset.conn));
    });
  });
  $$('#ta .node-chip').forEach(g =>
    ['click', 'keydown'].forEach(t => g.addEventListener(t, ev => {
      if (t === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault(); taSelectNode(g.dataset.node);
    })));
  if (spec.wiring) {
    if (taSelNode && !elecNodeMap(spec.wiring)[taSelNode]) taSelNode = null;
    if (taSelWire != null &&
        taSelWire >= spec.wiring.connections.length) taSelWire = null;
  }
  const est = $('#ta-est');
  est.innerHTML = taIsEstimated(spec)
    ? '<span class="est">Estimated \u2014 drafted from a photo, not measured</span>'
    : '';
  if (taSelected && !parts.find(p => p.id === taSelected)) taSelected = null;
  if (taSelected) taSelect(taSelected, true);
}
function taSelect(id, keep) {
  taSelected = id;
  taSelNode = null; taSelWire = null;
  $$('#ta .wire-g').forEach(g => g.classList.remove('sel'));
  $$('#ta .node-chip').forEach(g => g.classList.remove('sel'));
  if (window.RF3D) window.RF3D.setSelected(id);
  const p = taParts.find(x => x.id === id);
  if (!p) return;
  $$('#ta .part-shape').forEach(g =>
    g.classList.toggle('sel', g.dataset.part === id));
  const spot = TA_SPOTS.includes(p.id)
    ? '<img class="spot" src="' + ROOT + 'assets/img/parts/' + p.id + '.jpg" alt="AI illustration of the ' + esc(p.name) + '" loading="lazy">' +
      '<p class="faint" style="font-size:12px;margin-top:6px">AI illustration (muse-image-1.0). The printable part itself comes from <code>robotforge cad</code>.</p>'
    : '';
  const qtyLine = p.file
    ? 'Qty ' + p.qty + ' \u00b7 ' + esc(p.file)
    : 'Qty ' + p.qty + ' \u00b7 schematic part \u2014 the real robot\u2019s layout, not a kit file';
  const foot = p.file
    ? '<p class="faint" style="margin-top:14px;font-size:var(--fs-xs)">This part is one file in the take-apart kit. Open <code>' + esc(p.file) +
      '</code> in OpenSCAD (or FreeCAD) to edit just this part \u2014 the assembly picks up your change.</p>'
    : '<p class="faint" style="margin-top:14px;font-size:var(--fs-xs)">A schematic part derived from the spec \u2014 this class has no printable kit yet, so there is no file to open. The dimensions above are the spec\u2019s own numbers.</p>';
  $('#ta-detail').innerHTML =
    '<span class="qty">' + qtyLine + '</span>' +
    '<h3>' + esc(p.name) + '</h3>' + spot +
    '<dl>' +
    '<dt>What it is</dt><dd>' + esc(p.does) + '</dd>' +
    '<dt>Key dimensions</dt><dd class="m">' + esc(p.dims) + '</dd>' +
    '<dt>Beginner tweak</dt><dd>' + esc(p.tweak) + '</dd>' +
    '<dt>' + (p.file ? 'Print note' : 'Note') + '</dt><dd>' + esc(p.print) + '</dd>' +
    taElecSection(p.id) +
    '</dl>' + foot;
}
/* --- Electrical interaction: panel facts, selection, power --- */
function taElecFacts(w, node) {
  const nodes = elecNodeMap(w);
  const st = elecNodeStatus(w, node.id);
  const feed = st.feeds.map(c =>
    esc(nodes[c.from] ? nodes[c.from].label : c.from) + ' \u00b7 ' +
    (c.volts != null ? elecVolts(c.volts)
                     : esc(c.label || 'no fixed voltage'))).join('<br>');
  let status;
  if (st.state === 'bad') {
    status = '<span class="elec-bad">Over-voltage \u2014 a recorded feed ' +
      'exceeds this part\u2019s rated maximum.</span>';
  } else if (st.state === 'ok') {
    status = '<span class="elec-ok">Within rating on the recorded ' +
      'values.</span>';
  } else {
    status = '<span class="elec-unchecked">Not checked \u2014 ' +
      esc(st.reason) + '.</span>';
  }
  return { feed, status };
}
function taElecSection(partId) {
  const w = taSpec && taSpec.wiring;
  if (!w) return '';
  const node = w.nodes.find(n => n.kit === partId);
  if (!node) {
    return '<dt>Electrical</dt><dd>No electrical requirement \u2014 ' +
      'a mechanical part.</dd>';
  }
  const f = taElecFacts(w, node);
  return '<dt>Electrical</dt><dd>Needs: ' + esc(node.req_label) +
    '<br>Supplied by: ' + (f.feed || 'nothing recorded') +
    '<br>Status: ' + f.status + '</dd>';
}
function taSelectNode(id) {
  const w = taSpec && taSpec.wiring;
  if (!w) return;
  const node = elecNodeMap(w)[id];
  if (!node) return;
  taSelNode = id; taSelWire = null; taSelected = null;
  $$('#ta .part-shape').forEach(g => g.classList.remove('sel'));
  $$('#ta .wire-g').forEach(g => g.classList.remove('sel'));
  $$('#ta .node-chip').forEach(g =>
    g.classList.toggle('sel', g.dataset.node === id));
  const f = taElecFacts(w, node);
  const conns = w.connections
    .map((c, i) => (c.from === id || c.to === id) ? esc(elecConnLabel(w, i)) : null)
    .filter(Boolean).join('<br>');
  $('#ta-detail').innerHTML =
    '<span class="qty">Electrical component</span>' +
    '<h3>' + esc(node.label) + '</h3>' +
    '<dl>' +
    '<dt>Electrical requirement</dt><dd class="m">' + esc(node.req_label) + '</dd>' +
    '<dt>Supplied by</dt><dd>' + (f.feed || '\u2014 (it is a source)') + '</dd>' +
    '<dt>Status</dt><dd>' + f.status + '</dd>' +
    '<dt>Connections</dt><dd>' + conns + '</dd>' +
    '</dl>' +
    '<p class="faint" style="margin-top:14px;font-size:var(--fs-xs)">' +
    'Requirements and voltages are the recorded ones \u2014 the spec\u2019s ' +
    'own fields and the parts catalog\u2019s datasheet specs. ' +
    '\u201cNot specified\u201d means the data names none.</p>';
}
function taWireInfo(i) {
  const w = taSpec && taSpec.wiring;
  const info = $('#ta-wire-info');
  if (!w || !info || !w.connections[i]) return;
  info.innerHTML = esc(elecConnLabel(w, i)) +
    (elecBad(w).has(i)
      ? ' <strong class="elec-bad">\u2014 over-voltage: above the ' +
        'target\u2019s recorded rated maximum.</strong>' : '');
}
function taWireInfoReset() {
  const info = $('#ta-wire-info');
  if (info) info.textContent = 'Hover or click a connection to read it; ' +
    'click a component chip for its requirement and status.';
}
function taSelectWire(i) {
  const w = taSpec && taSpec.wiring;
  if (!w || !w.connections[i]) return;
  taSelWire = i; taSelNode = null;
  $$('#ta .wire-g').forEach(g =>
    g.classList.toggle('sel', Number(g.dataset.conn) === i));
  $$('#ta .node-chip').forEach(g => g.classList.remove('sel'));
  taWireInfo(i);
}
function taApplyElec() {
  $$('#ta .wire-g').forEach(g => {
    const st = g.dataset.stage === 'inf' ? Infinity : Number(g.dataset.stage);
    const on = taPower && st <= taElecStage;
    g.classList.toggle('on', on);
    const p = g.querySelector('.wire');
    if (p) p.classList.toggle('on', on);
  });
  $$('#ta .node-chip').forEach(g => {
    const d = g.dataset.depth === 'inf' ? Infinity : Number(g.dataset.depth);
    g.classList.toggle('on', taPower && d <= taElecStage);
  });
  if (window.RFWiring) window.RFWiring.applyPower(taPower, taElecStage);
}
function taSetPower(on) {
  taElecTimers.forEach(clearTimeout); taElecTimers = [];
  taPower = on;
  const btn = $('#ta-power');
  if (btn) {
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Power off' : 'Power on';
  }
  const w = taSpec && taSpec.wiring;
  if (!on || !w) { taElecStage = 0; taApplyElec(); return; }
  /* light the wiring in supply order: battery first, then whatever
     it feeds, then whatever that feeds */
  const depth = elecDepths(w);
  const stages = [...new Set(
    w.connections.map((c, i) => elecStage(w, depth, i))
      .filter(Number.isFinite))].sort((a, b) => a - b);
  taElecStage = 0; taApplyElec();
  stages.forEach((s, k) => {
    taElecTimers.push(setTimeout(() => {
      taElecStage = s; taApplyElec();
    }, 80 + k * 190));
  });
}

const TA_PANEL = `
  <div id="ta-est"></div>
  <div class="ta-controls">
    <label for="ta-explode">Explode</label>
    <input type="range" id="ta-explode" min="0" max="60" value="0" step="1">
    <output id="ta-explode-val" for="ta-explode">0 mm</output>
  </div>
  <div class="ta-controls" id="ta-elec-controls" hidden>
    <button class="btn btn-sm ta-toggle" id="ta-elec" type="button" aria-pressed="false">Electrical</button>
    <button class="btn btn-sm ta-toggle" id="ta-power" type="button" aria-pressed="false" disabled>Power on</button>
    <span class="faint" style="font-size:12px">Amber is power, blue is data, grey is unpowered \u2014 red is a recorded over-voltage. Power lights the wiring in supply order, battery first.</span>
  </div>
  <p id="ta-wire-info" class="ta-wire-info" hidden></p>
  <p id="ta-elec-note" class="faint" style="font-size:var(--fs-xs);margin-top:8px" hidden></p>
  <div class="ta-controls" id="ta-view-controls">
    <div class="tabs" role="tablist" aria-label="Take-apart view">
      <button class="tab" type="button" id="ta-view-2d" role="tab" aria-selected="true">2D views</button>
      <button class="tab" type="button" id="ta-view-3d" role="tab" aria-selected="false">3D</button>
      <button class="tab" type="button" id="ta-view-wiring" role="tab" aria-selected="false" hidden>Wiring</button>
    </div>
    <span class="faint" style="font-size:12px">Same kit, same explode slider, same click-a-part panel.</span>
  </div>
  <p id="ta-3d-note" class="callout" style="margin-bottom:12px" hidden><span>The 3D view is a schematic of the same kit. The electrical overlay and the dimension lines are <strong>2D-only</strong> for now &mdash; switch back to 2D views for those.</span></p>
  <div class="ta-stage">
    <div>
      <div id="ta-2d">
        <div class="ta-view"><div id="ta-side"></div>
          <p class="cap">Side view. Rear is left, front is right; ground is z = 0 and axles sit at wheel-radius height.</p></div>
        <div class="ta-view"><div id="ta-top"></div>
          <p class="cap">Top view. Explode moves the wheels outward, like the kit's <code>explode_mm</code>.</p></div>
      </div>
      <div class="ta-view" id="ta-3dwrap" hidden>
        <div id="ta-3d"></div>
        <p class="cap">3D take-apart. Drag to orbit, scroll to zoom, click a part &mdash; the panel beside it is the same one the flat views use.</p>
        <p class="state-box" id="ta-3d-fallback" hidden>3D unavailable here &mdash; the 2D take-apart still works.</p>
      </div>
      <div class="ta-view" id="ta-wiring" hidden></div>
    </div>
    <aside class="card ta-detail" id="ta-detail">
      <h3>Pick a part</h3>
      <p class="muted" style="font-size:var(--fs-sm);margin-top:8px">Click any part in either view to see what it is, its key dimensions from the spec, one beginner tweak, and a print suggestion.</p>
    </aside>
  </div>
  <p class="faint" id="ta-foot" style="font-size:var(--fs-xs);margin-top:12px">A layout viewer built from the spec's numbers, not a CAD render. <code>robotforge cad</code> writes the printable files, one OpenSCAD file per part.</p>`;

(async function initTakeApart() {
  const host = $('#ta');
  if (!host) return;
  const path = host.dataset.spec;
  try {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    taSpec = await r.json();
  } catch (err) {
    host.innerHTML = '<div class="state-box">The spec file could not be loaded, so there is nothing honest to draw. The viewer builds only from published spec files.</div>';
    return;
  }
  host.innerHTML = TA_PANEL;
  if (taClass(taSpec) !== 'ground') {
    /* The panel's stock captions describe the wheeled kit; for the
       schematic classes, say what these views actually are. */
    const caps = $$('#ta .ta-view .cap');
    if (caps[0]) caps[0].textContent = 'Side view. Front is to the right; z = 0 is the ground (the table, for a fixed arm).';
    if (caps[1]) caps[1].textContent = 'Top view. The explode slider separates the same parts, the same way, as the 3D view.';
    const foot = $('#ta-foot');
    if (foot) foot.textContent = 'A schematic layout viewer built from the spec\u2019s numbers, not a CAD render. Printable kits (robotforge cad) cover ground robots today; this class is drawn from its published spec instead.';
    const detail = $('#ta-detail');
    if (detail) detail.innerHTML = '<h3>Pick a part</h3>' +
      '<p class="muted" style="font-size:var(--fs-sm);margin-top:8px">Click any part in either view to see what it is and its key dimensions from the spec.</p>';
  }
  const slider = $('#ta-explode');
  slider.addEventListener('input', () => {
    taExplode = Number(slider.value);
    $('#ta-explode-val').textContent = taExplode + ' mm';
    taRender();
    if (window.RF3D) window.RF3D.setExplode(taExplode);
  });
  /* 2D / 3D toggle. The 3D scene lives in assets/js/robot3d.js (an
     ES module loaded by the page); it registers window.RF3D when it
     loads. If it never registers — module or CDN failure — the 3D
     pane shows its fallback line and the 2D views are untouched. */
  const b2d = $('#ta-view-2d'), b3d = $('#ta-view-3d');
  const bw = $('#ta-view-wiring');
  function taSetMode(mode) {
    const is3d = mode === '3d';
    const isWiring = mode === 'wiring';
    b2d.setAttribute('aria-selected', String(mode === '2d'));
    b3d.setAttribute('aria-selected', String(is3d));
    if (bw) bw.setAttribute('aria-selected', String(isWiring));
    $('#ta-2d').hidden = is3d || isWiring;
    $('#ta-3dwrap').hidden = !is3d;
    $('#ta-3d-note').hidden = !is3d;
    $('#ta-wiring').hidden = !isWiring;
    /* the Power button drives the wiring view directly; in the
       flat views it stays gated on the Electrical toggle */
    const powerBtn = $('#ta-power');
    if (powerBtn && taSpec.wiring) {
      powerBtn.disabled = isWiring ? false : !taElec;
    }
    if (isWiring && window.RFWiring) window.RFWiring.onSpecReady(taSpec);
    if (is3d) {
      const start = () => {
        if (window.RF3D) {
          window.RF3D.activate({
            spec: taSpec, explode: taExplode,
            select: id => taSelect(id),
            onFail: () => { $('#ta-3d-fallback').hidden = false; }
          });
        } else {
          $('#ta-3d-fallback').hidden = false;
        }
      };
      if (window.RF3D) start(); else setTimeout(start, 2500);
    } else if (window.RF3D) {
      window.RF3D.deactivate();
    }
  }
  b2d.addEventListener('click', () => taSetMode('2d'));
  b3d.addEventListener('click', () => taSetMode('3d'));
  if (bw) bw.addEventListener('click', () => taSetMode('wiring'));
  if (taSpec.wiring) {
    if (bw) bw.hidden = false;
    if (window.RFWiring) window.RFWiring.onSpecReady(taSpec);
    $('#ta-elec-controls').hidden = false;
    const elecBtn = $('#ta-elec'), powerBtn = $('#ta-power');
    elecBtn.addEventListener('click', () => {
      taElec = !taElec;
      elecBtn.setAttribute('aria-pressed', String(taElec));
      powerBtn.disabled = !taElec && $('#ta-wiring').hidden;
      $('#ta-elec-note').hidden = !taElec;
      $('#ta-wire-info').hidden = !taElec;
      if (taElec) {
        $('#ta-elec-note').textContent = taSpec.wiring.note;
        taWireInfoReset();
      } else {
        taSetPower(false); taSelWire = null;
      }
      taRender();
    });
    powerBtn.addEventListener('click', () => taSetPower(!taPower));
  }
  taRender();
})();
