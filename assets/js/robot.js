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

function taBuildParts(spec) {
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
function taRender() {
  const spec = taSpec;
  if (!spec) return;
  const { parts, pos } = taBuildParts(spec);
  taParts = parts;
  $('#ta-side').innerHTML = taRenderSide(spec, parts, pos);
  $('#ta-top').innerHTML = taRenderTop(spec, parts, pos);
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
  $('#ta-detail').innerHTML =
    '<span class="qty">Qty ' + p.qty + ' \u00b7 ' + esc(p.file) + '</span>' +
    '<h3>' + esc(p.name) + '</h3>' + spot +
    '<dl>' +
    '<dt>What it is</dt><dd>' + esc(p.does) + '</dd>' +
    '<dt>Key dimensions</dt><dd class="m">' + esc(p.dims) + '</dd>' +
    '<dt>Beginner tweak</dt><dd>' + esc(p.tweak) + '</dd>' +
    '<dt>Print note</dt><dd>' + esc(p.print) + '</dd>' +
    taElecSection(p.id) +
    '</dl>' +
    '<p class="faint" style="margin-top:14px;font-size:var(--fs-xs)">This part is one file in the take-apart kit. Open <code>' + esc(p.file) +
    '</code> in OpenSCAD (or FreeCAD) to edit just this part \u2014 the assembly picks up your change.</p>';
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
    </div>
    <aside class="card ta-detail" id="ta-detail">
      <h3>Pick a part</h3>
      <p class="muted" style="font-size:var(--fs-sm);margin-top:8px">Click any part in either view to see what it is, its key dimensions from the spec, one beginner tweak, and a print suggestion.</p>
    </aside>
  </div>
  <p class="faint" style="font-size:var(--fs-xs);margin-top:12px">A layout viewer built from the spec's numbers, not a CAD render. <code>robotforge cad</code> writes the printable files, one OpenSCAD file per part.</p>`;

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
  function taSetMode(mode) {
    const is3d = mode === '3d';
    b2d.setAttribute('aria-selected', String(!is3d));
    b3d.setAttribute('aria-selected', String(is3d));
    $('#ta-2d').hidden = is3d;
    $('#ta-3dwrap').hidden = !is3d;
    $('#ta-3d-note').hidden = !is3d;
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
  if (taSpec.wiring) {
    $('#ta-elec-controls').hidden = false;
    const elecBtn = $('#ta-elec'), powerBtn = $('#ta-power');
    elecBtn.addEventListener('click', () => {
      taElec = !taElec;
      elecBtn.setAttribute('aria-pressed', String(taElec));
      powerBtn.disabled = !taElec;
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
