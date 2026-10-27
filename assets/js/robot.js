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

let taSpec = null, taParts = [], taSelected = null, taExplode = 0;

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
  /* dimension captions */
  s += '<text x="' + X(0) + '" y="' + (Z(0) + 30) + '" fill="#9aa3ae" font-size="11" text-anchor="middle">length ' + mm(L) + ' mm</text>';
  s += '<text x="' + (Wpx - 8) + '" y="' + (Z(H) - 6) + '" fill="#9aa3ae" font-size="11" text-anchor="end">height ' + mm(H) + ' mm</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + Hpx, 700);
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
  s += '<text x="' + X(0) + '" y="' + (Hpx - 4) + '" fill="#9aa3ae" font-size="11" text-anchor="middle">front is to the right</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + Hpx, 700);
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
  const est = $('#ta-est');
  est.innerHTML = taIsEstimated(spec)
    ? '<span class="est">Estimated \u2014 drafted from a photo, not measured</span>'
    : '';
  if (taSelected && !parts.find(p => p.id === taSelected)) taSelected = null;
  if (taSelected) taSelect(taSelected, true);
}
function taSelect(id, keep) {
  taSelected = id;
  const p = taParts.find(x => x.id === id);
  if (!p) return;
  $$('#ta .part-shape').forEach(g =>
    g.classList.toggle('sel', g.dataset.part === id));
  $('#ta-detail').innerHTML =
    '<span class="qty">Qty ' + p.qty + ' \u00b7 ' + esc(p.file) + '</span>' +
    '<h3>' + esc(p.name) + '</h3>' +
    '<dl>' +
    '<dt>What it is</dt><dd>' + esc(p.does) + '</dd>' +
    '<dt>Key dimensions</dt><dd class="m">' + esc(p.dims) + '</dd>' +
    '<dt>Beginner tweak</dt><dd>' + esc(p.tweak) + '</dd>' +
    '<dt>Print note</dt><dd>' + esc(p.print) + '</dd>' +
    '</dl>' +
    '<p class="faint" style="margin-top:14px;font-size:var(--fs-xs)">This part is one file in the take-apart kit. Open <code>' + esc(p.file) +
    '</code> in OpenSCAD (or FreeCAD) to edit just this part \u2014 the assembly picks up your change.</p>';
}
const TA_PANEL = `
  <div id="ta-est"></div>
  <div class="ta-controls">
    <label for="ta-explode">Explode</label>
    <input type="range" id="ta-explode" min="0" max="60" value="0" step="1">
    <output id="ta-explode-val" for="ta-explode">0 mm</output>
  </div>
  <div class="ta-stage">
    <div>
      <div class="ta-view"><div id="ta-side"></div>
        <p class="cap">Side view. Rear is left, front is right; ground is z = 0 and axles sit at wheel-radius height.</p></div>
      <div class="ta-view"><div id="ta-top"></div>
        <p class="cap">Top view. Explode moves the wheels outward, like the kit's <code>explode_mm</code>.</p></div>
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
  });
  taRender();
})();
