'use strict';
/* RobotForge web app — static, data-driven, no build step.
   Every number on these views comes from a file in this repository:
   catalog/robots.json (the Robodex), examples/*.json (specs), or the
   recorded gate runs quoted with their sources. Where data has not
   been published yet, the views say so instead of inventing it. */

/* ---------------- helpers ---------------- */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const mm = m => Math.round(m * 1000);
const num = v => (v == null ? '—' : String(v));

async function fetchJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return r.json();
}

/* AI-generated illustrations (app/app-images.js). Real robots always
   lead with their official photos (catalog image_url); generated art is
   used only where no photo exists and is captioned as AI work. */
const RFI = window.RF_IMAGES || {};

/* ---------------- view router ---------------- */
const VIEWS = ['home', 'robodex', 'takeapart', 'replay', 'evidence'];
const inited = {};
function showView(name) {
  if (!VIEWS.includes(name)) name = 'home';
  VIEWS.forEach(v => {
    $('#view-' + v).classList.toggle('active', v === name);
    const b = $('.rfnav a[data-view="' + v + '"]');
    if (b) b.classList.toggle('active', v === name);
  });
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  window.scrollTo(0, 0);
  if (name === 'robodex' || name === 'evidence') loadRobodexData();
  if (name === 'takeapart') initTakeApart();
  if (name === 'replay') initReplay();
}
$$('.rfnav a[data-view]').forEach(a =>
  a.addEventListener('click', ev => { ev.preventDefault(); showView(a.dataset.view); }));
/* Deep links: the boot call at the bottom honours location.hash on
   load; this listener honours it while the app is already open —
   back/forward, or arriving at index.html#<view> from a standalone
   page's nav in the same tab. showView syncs the hash with
   history.replaceState, which does not fire hashchange, so no loop. */
addEventListener('hashchange', () =>
  showView((location.hash || '#home').slice(1)));
$$('[data-goto]').forEach(b =>
  b.addEventListener('click', () => showView(b.dataset.goto)));

/* ---------------- shared catalog ---------------- */
let catalogPromise = null;
function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetchJSON('catalog/robots.json')
      .then(c => (c && Array.isArray(c.robots)) ? c : null)
      .catch(() => null);
  }
  return catalogPromise;
}

/* Recorded gate results, used only if catalog/robots.json has not been
   published yet. Same runs, same sources as the catalog carries. */
const FALLBACK_ROBOTS = [
  {
    number: 1, name: 'Andino', 'class': 'Differential-drive ground robot',
    description: 'An open-source ROS 2 robot from Ekumen. Its Robodex entry — spec read from the official project files, plus its gate run — is being recorded today and arrives with the catalog publish. Until then this slot stays unwritten rather than guessed.',
    image_url: 'https://raw.githubusercontent.com/Ekumen-OS/andino/main/docs/real_robot.png',
    image_credit: 'Photo: Ekumen — the real robot, from the official Andino repository (docs/real_robot.png)',
    key_specs: {}, spec_file: 'examples/andino.json',
    provenance: { source_name: 'Ekumen-OS/andino (official project repository)',
                  source_url: 'https://github.com/Ekumen-OS/andino', license: null, note: '' },
    gate_status: null
  },
  {
    number: 2, name: 'TurtleBot3 Burger', 'class': 'Differential-drive ground robot',
    description: 'ROBOTIS\u2019s small research-and-teaching rover: two driven wheels, a caster, and a 360-degree lidar. RobotForge\u2019s reference robot for the differential-drive layout.',
    image_url: 'https://emanual.robotis.com/assets/images/platform/turtlebot3/hardware_setup/turtlebot3_burger.png',
    image_credit: 'Photo: ROBOTIS — official TurtleBot3 e-Manual',
    key_specs: { battery: 'LiPo 11.1 V, 1800 mAh', drivetrain: 'differential \u2014 2 driven wheels + caster',
                 footprint: '0.178 m x 0.138 m, 0.192 m tall', mass: '0.93 kg (reference spec)',
                 sensors: '360-degree 2D lidar (top)', wheels: '66 mm diameter' },
    spec_file: 'examples/turtlebot3-burger.json',
    provenance: { source_name: 'ROBOTIS-GIT/turtlebot3 (official vendor repository)',
                  source_url: 'https://github.com/ROBOTIS-GIT/turtlebot3', license: 'Apache-2.0', note: '' },
    gate_status: { status: 'PASS', note: 'The same spec with --inject-wheel-scale 0.9 FAILS the gate (odometry error 11.168%, suspect wheel.diameter_m) \u2014 that injected run is a fault-injection demo, not this robot\u2019s clean status.',
      runs: [
        { drive_error_pct: 0.368, heading_error_deg: null, odometry_distance_error_pct: 0.042,
          source: 'P1 launch verification on scythe from a fresh clone of main, 2026-10-26' },
        { drive_error_pct: 0.968, heading_error_deg: 2.028, odometry_distance_error_pct: 0.042,
          source: 'Evidence run embedded in reports.html (burger-clean): drive 0.968%, turn 2.028 deg, all four checks PASS' }
      ] }
  },
  {
    number: 3, name: 'TurtleBot3 Waffle Pi', 'class': 'Differential-drive ground robot',
    description: 'The bigger TurtleBot3: a waffle-shaped deck carrying a lidar and a camera. RobotForge knows this one from a photograph \u2014 the photo intake identified it and drafted its spec, so every dimension here is an estimate until somebody measures the real robot.',
    image_url: 'https://emanual.robotis.com/assets/images/platform/turtlebot3/hardware_setup/turtlebot3_models.png',
    image_credit: 'Photo: ROBOTIS — official TurtleBot3 lineup; Waffle Pi at right (e-Manual)',
    key_specs: { drivetrain: 'differential \u2014 2 driven wheels + caster',
                 footprint: '0.306 m x 0.281 m x 0.141 m \u2014 ESTIMATED from the photo draft, based on the published approximate size',
                 mass: '1.8 kg (photo draft)', motors: '2x Dynamixel XL430 (photo draft)',
                 sensors: '2D lidar (top), RGB camera (front), IMU, wheel encoders', wheels: '66 mm diameter (photo draft)' },
    spec_file: 'examples/photo-turtlebot.json',
    provenance: { source_name: 'Identified by RobotForge photo intake; published model at ROBOTIS-GIT/turtlebot3',
                  source_url: 'https://github.com/ROBOTIS-GIT/turtlebot3', license: 'Apache-2.0',
                  note: 'The spec is a photo draft (all dimensions ESTIMATED) produced by robotforge describe --photo.' },
    gate_status: { status: 'NOT_GATED', runs: [], note: 'Not gated yet \u2014 its spec is a photo estimate and has not been run through the motion gate.' }
  },
  {
    number: 4, name: 'Pathfinder', 'class': 'Skid-steer ground rover',
    description: 'RobotForge\u2019s own demo robot \u2014 an original design, not a copy of anything: a four-wheel skid-steer rover for warehouse aisle patrol, described in one plain paragraph and built entirely by the forge. Entry #004 is ours.',
    key_specs: { battery: 'LiPo 14.8 V (4S), 5200 mAh', drivetrain: 'skid-steer \u2014 4 driven wheels',
                 footprint: '0.42 m x 0.31 m, 0.18 m tall', mass: '3.4 kg',
                 motors: '4x 12 V DC gearmotors', sensors: 'ultrasonic ranger (front), IMU (centre)',
                 wheels: '100 mm diameter x4' },
    spec_file: 'examples/pathfinder.json',
    provenance: { source_name: 'Original design in this repository',
                  source_url: 'https://github.com/abelxmendoza/RobotForge-Hackathon', license: 'Apache-2.0',
                  note: 'RobotForge\u2019s in-repo reference design (examples/pathfinder.json), authored for the hackathon demo.' },
    gate_status: { status: 'PASS', note: 'Two recorded PASS runs at the locked thresholds (drive <=5%, heading <=5 deg).',
      runs: [
        { drive_error_pct: 1.5, heading_error_deg: 4.77, odometry_distance_error_pct: null, transport: 'gz-transport bindings',
          source: 'Gate verification on scythe, 2026-10-26 (bindings transport, locked thresholds)' },
        { drive_error_pct: 1.375, heading_error_deg: 2.205, odometry_distance_error_pct: null, transport: 'gz-transport bindings',
          source: 'Gate verification on scythe, 2026-10-26 (repeat run)' }
      ] }
  }
];

/* ---------------- badges & run lists ---------------- */
function gateBadge(gs) {
  if (!gs) return '<span class="badge">not gated yet</span>';
  if (gs.status === 'PASS')     return '<span class="badge badge-pass">Gate: PASS</span>';
  if (gs.status === 'FAIL')     return '<span class="badge badge-fail">Gate: FAIL</span>';
  if (gs.status === 'MARGINAL') return '<span class="badge badge-marginal">Gate: MARGINAL</span>';
  return '<span class="badge">not gated yet</span>';
}
function runLine(run) {
  const bits = [];
  if (run.drive_error_pct != null) bits.push('drive error ' + run.drive_error_pct + '%');
  if (run.heading_error_deg != null) bits.push('turn error ' + run.heading_error_deg + ' deg');
  if (run.odometry_distance_error_pct != null) bits.push('odometry distance error ' + run.odometry_distance_error_pct + '%');
  if (run.odometry_heading_error_deg != null) bits.push('odometry heading error ' + run.odometry_heading_error_deg + ' deg');
  if (run.transport) bits.push('transport: ' + run.transport);
  let s = esc(bits.join(' · '));
  if (run.source) s += '<br><span style="color:var(--muted)">source: ' + esc(run.source) + '</span>';
  return s;
}
function gateBlock(gs) {
  if (!gs || !gs.runs || !gs.runs.length) {
    return '<div class="gate-note">No recorded gate runs yet.' +
      (gs && gs.note ? '<br>' + esc(gs.note) : '') + '</div>';
  }
  return '<div class="gate-note"><strong>Recorded runs:</strong><ul>' +
    gs.runs.map(r => '<li>' + runLine(r) + '</li>').join('') + '</ul>' +
    (gs.note ? '<br>' + esc(gs.note) : '') + '</div>';
}
function robotFigure(r) {
  if (r.image_url) {
    return '<figure class="robot-photo"><img src="' + esc(r.image_url) +
      '" alt="' + esc(r.name) + ' — official image" loading="lazy">' +
      (r.image_credit ? '<figcaption>' + esc(r.image_credit) + '</figcaption>' : '') +
      '</figure>';
  }
  if (r.name === 'Pathfinder' && RFI.pathfinder) {
    return '<figure class="robot-photo ai"><img src="' + RFI.pathfinder +
      '" alt="Pathfinder — AI concept illustration" loading="lazy">' +
      '<figcaption>AI concept illustration — Pathfinder is a RobotForge design, ' +
      'not built hardware. No photo of it exists.</figcaption></figure>';
  }
  return '';
}
function robotCard(r) {
  const specs = Object.keys(r.key_specs || {}).sort()
    .map(k => '<tr><th>' + esc(k) + '</th><td>' + esc(r.key_specs[k]) + '</td></tr>').join('');
  const p = r.provenance || {};
  return '<article class="card">' +
    '<div class="card-top"><span class="dex">#' + String(r.number).padStart(3, '0') + '</span>' +
    gateBadge(r.gate_status) + '</div>' +
    '<h2>' + esc(r.name) + '</h2><div class="class">' + esc(r['class']) + '</div>' +
    '<p class="desc">' + esc(r.description) + '</p>' +
    robotFigure(r) +
    (specs ? '<table>' + specs + '</table>' : '') +
    '<p class="prov"><strong>Provenance:</strong> ' + esc(p.source_name || '') +
    (p.license ? ' · license: ' + esc(p.license) : '') +
    (p.source_url ? ' · <a href="' + esc(p.source_url) + '">source</a>' : '') +
    (p.note ? '<br>' + esc(p.note) : '') +
    (r.spec_file ? '<br>Spec: <code>' + esc(r.spec_file) + '</code>' : '') + '</p>' +
    gateBlock(r.gate_status) +
    '</article>';
}

/* ---------------- Robodex view ---------------- */
let robodexRendered = false;
async function loadRobodexData() {
  if (robodexRendered) return;
  robodexRendered = true;
  const cat = await loadCatalog();
  const robots = cat ? cat.robots : FALLBACK_ROBOTS;
  const rroot = $('#robodex-root');
  if (rroot) {
    rroot.innerHTML = cat ? robots.map(robotCard).join('')
      : '<div class="state-box">The catalog file (<code>catalog/robots.json</code>) has not been published to this site yet \u2014 it is being built right now. Until it lands, these entries come from the spec files in <code>examples/</code>, with gate results quoted from the recorded runs and their sources.</div>' +
        robots.map(robotCard).join('');
  }
  renderEvidence(robots);
}

/* ---------------- Gate evidence view ---------------- */
function renderEvidence(robots) {
  const root = $('#evidence-root');
  if (!root || root.dataset.done) return;
  root.dataset.done = '1';
  const byName = n => robots.find(r => r.name === n);
  const pf = byName('Pathfinder'), bg = byName('TurtleBot3 Burger'), an = byName('Andino');
  let html = '';

  if (pf) {
    html += '<article class="card"><div class="card-top"><span class="dex">Pathfinder</span>' +
      gateBadge(pf.gate_status) + '</div><h3>The reference rover passes</h3>' +
      '<p class="desc">Four-wheel skid-steer, RobotForge\u2019s own design. Recorded runs at the locked thresholds; across all of its recorded runs the drive error spans 0.325\u20131.525% and the turn error 2.205\u20134.77&deg;.</p>' +
      gateBlock(pf.gate_status) + '</article>';
  }
  if (bg) {
    html += '<article class="card"><div class="card-top"><span class="dex">TurtleBot3 Burger</span>' +
      gateBadge(bg.gate_status) + '</div><h3>The reference differential robot passes \u2014 and its odometry is honest</h3>' +
      '<p class="desc">Clean run: drive error 0.368%, and the odometry cross-check against ground truth is 0.042% \u2014 the robot\u2019s own sensors told the truth about where it went.</p>' +
      gateBlock(bg.gate_status) + '</article>';
  }

  /* The injected-wheel FAIL: recorded numbers (P1 launch verification run,
     scythe, 2026-10-26). A second injected run with the full report \u2014
     truth 0.924 m, odometry 1.027 m \u2014 is embedded in reports.html. */
  html += '<article class="card"><div class="card-top"><span class="dex">TurtleBot3 Burger \u00b7 fault injection</span>' +
    '<span class="badge badge-fail">Gate: FAIL</span></div>' +
    '<h3>Wheels 10% smaller than the paperwork</h3>' +
    '<p class="desc">The same Burger, re-run with <code>--inject-wheel-scale 0.9</code>: the physical wheels shrink, the spec \u2014 and the odometry \u2014 keep believing the old size. The robot\u2019s own sensors cannot see it. The gate can, because it grades ground truth.</p>' +
    '<div class="ev-bars">' +
      evRow('Commanded drive', 1.0,   '1.000 m', '') +
      evRow('Ground truth (actual)', 0.912, '0.912 m', 'truth') +
      evRow('Odometry (believed)', 1.014, '1.014 m', 'odom') +
    '</div><div class="ev-scale"><span>0 m</span><span>bars scaled to 1.1 m</span></div>' +
    '<p class="prov">Odometry distance error: <strong>11.168%</strong> \u2014 past the 10% fail line. Source: P1 launch verification run on scythe, 2026-10-26. A second injected run, with the full report and trajectory (truth 0.924 m vs odometry 1.027 m), is on the <a href="reports.html">gate reports page</a>.</p>' +
    '<div class="suspect"><b>Suspect: wheel.diameter_m</b> \u2014 odometry distance disagrees with ground truth while heading agrees: a scale error. The wheel radius odometry uses does not match the physical wheels. (A suspect, not a proven root cause \u2014 the gate names where to look first.)</div>' +
    '</article>';

  if (an && an.gate_status && (an.gate_status.runs || []).length) {
    html += '<article class="card"><div class="card-top"><span class="dex">Andino</span>' +
      gateBadge(an.gate_status) + '</div><h3>The first robot the forge didn\u2019t design</h3>' +
      '<p class="desc">Spec read from Ekumen\u2019s official project files (BSD-3-Clause), gated as-is. Recorded exactly as measured \u2014 the locked thresholds were not touched for it.</p>' +
      gateBlock(an.gate_status) + '</article>';
  } else {
    html += '<article class="card"><div class="card-top"><span class="dex">Andino</span>' +
      '<span class="badge">gate run pending</span></div><h3>Second-robot proof, in progress</h3>' +
      '<p class="desc">Andino\u2019s gate run is being recorded today. This slot fills in from the catalog data when it publishes \u2014 it will show whatever the gate measured, pass or fail.</p></article>';
  }

  html += '<article class="card"><h3>Full reports</h3>' +
    '<p class="desc">The <a href="reports.html">gate reports page</a> carries the complete recorded reports \u2014 raw measurements, per-check verdicts, suspects, and ground-truth trajectories \u2014 including an earlier Pathfinder run the gate <strong>failed</strong> when its wheels scrubbed in the turn: odometry believed 94.6&deg;, ground truth was 30.6&deg;. Caught only because the gate measures truth, not belief.</p></article>';

  root.innerHTML = html;
}
function evRow(label, value, valText, cls) {
  const pct = Math.max(0, Math.min(100, value / 1.1 * 100));
  return '<div class="ev-row"><span class="lab">' + esc(label) + '</span>' +
    '<span class="ev-track"><span class="ev-fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></span></span>' +
    '<span class="val">' + esc(valText) + '</span></div>';
}

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

const TA_SOURCES = [
  { id: 'pathfinder', label: 'Pathfinder \u2014 skid-steer rover (reference)', file: 'examples/pathfinder.json' },
  { id: 'waffle',     label: 'TurtleBot3 Waffle Pi \u2014 photo draft (ESTIMATED)', file: 'examples/photo-turtlebot.json' },
  { id: 'burger',     label: 'TurtleBot3 Burger \u2014 differential reference', file: 'examples/turtlebot3-burger.json' },
  { id: 'andino',     label: 'Andino \u2014 differential (Ekumen)', file: 'examples/andino.json' }
];
const taSpecs = {};
let taCurrent = null, taParts = [], taSelected = null, taExplode = 0;

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
  return ' class="part-shape' + (taSelected === id ? ' sel' : '') + '" data-part="' + id + '"';
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
  s += '<text x="8" y="' + (Z(0) + 16) + '" fill="#9aa1ad" font-size="11">ground (z = 0)</text>';
  /* chassis plate */
  s += '<g' + shapeAttrs('plate') + '><rect x="' + X(-L / 2) + '" y="' + Z(deckTop) +
    '" width="' + (L * S) + '" height="' + (PLATE_T * S) + '" rx="3" fill="#8a5a17" stroke="#f59e0b" stroke-width="1.4"/></g>';
  /* casters */
  if (spec.wheel.count === 2) {
    const cx = L / 2 - C;
    [-cx, cx].forEach(x0 => {
      const dx = Math.sign(x0) * e;
      s += '<g' + shapeAttrs('caster') + '><circle cx="' + X(x0 + dx) + '" cy="' + Z(C / 2 - e * 0.25) +
        '" r="' + (C / 2 * S) + '" fill="#5b6472" stroke="#9aa1ad" stroke-width="1.2"/></g>';
    });
  }
  /* motor mounts (one rect per distinct wheel x) */
  const mw = Math.max(spec.wheel.width_m, 0.024);
  xs.forEach(x0 => {
    const dx = Math.sign(x0) * e * 0.7;
    s += '<g' + shapeAttrs('mount') + '><rect x="' + X(x0 + dx - mw / 2) + '" y="' + Z(deckTop) +
      '" width="' + (mw * S) + '" height="' + (deckTop * S) + '" fill="#3d4656" stroke="#9aa1ad" stroke-width="1.2"/></g>';
  });
  /* wheels (side view: +/- y pairs overlap) */
  xs.forEach(x0 => {
    const dx = Math.sign(x0) * e * 0.7, dz = x0 === 0 ? -e * 0.8 : 0;
    s += '<g' + shapeAttrs('wheel') + '><circle cx="' + X(x0 + dx) + '" cy="' + Z(r + dz) +
      '" r="' + (r * S) + '" fill="#22262e" stroke="#e8eaee" stroke-width="2"/>' +
      '<circle cx="' + X(x0 + dx) + '" cy="' + Z(r + dz) + '" r="' + (r * S * 0.32) +
      '" fill="none" stroke="#9aa1ad" stroke-width="1.4"/></g>';
  });
  /* lidar */
  const lp = parts.find(p => p.id === 'lidar');
  if (lp) {
    s += '<g' + shapeAttrs('lidar') + '>' +
      '<rect x="' + X(lp.x - POST_D / 2) + '" y="' + Z(H - 0.010 + e) + '" width="' + (POST_D * S) +
      '" height="' + ((H - 0.010 - deckTop + e) * S) + '" fill="#3d4656" stroke="#9aa1ad" stroke-width="1.2"/>' +
      '<rect x="' + X(lp.x - LIDAR_DISC_D / 2) + '" y="' + Z(H + e) + '" width="' + (LIDAR_DISC_D * S) +
      '" height="' + (0.010 * S) + '" rx="3" fill="#22262e" stroke="#e8eaee" stroke-width="1.6"/></g>';
  }
  /* camera */
  const cp = parts.find(p => p.id === 'camera');
  if (cp) {
    const fx = cp.face * (L / 2 + e) + (cp.face > 0 ? 0 : -PLATE_T);
    const zb = C + H / 2 + e * 0.2;
    s += '<g' + shapeAttrs('camera') + '><rect x="' + X(fx) + '" y="' + Z(zb + CAM_H / 2) +
      '" width="' + (PLATE_T * S) + '" height="' + (CAM_H * S) + '" fill="#3d4656" stroke="#9aa1ad" stroke-width="1.2"/></g>';
  }
  /* ultrasonic */
  const up = parts.find(p => p.id === 'ultrasonic');
  if (up) {
    const fx = up.face * (L / 2 + e) + (up.face > 0 ? 0 : -PLATE_T);
    const zb = deckTop + e * 0.2;
    s += '<g' + shapeAttrs('ultrasonic') + '><rect x="' + X(fx) + '" y="' + Z(zb + ULTRA_H) +
      '" width="' + (PLATE_T * S) + '" height="' + (ULTRA_H * S) + '" fill="#3d4656" stroke="#9aa1ad" stroke-width="1.2"/>' +
      '<circle cx="' + X(up.face * (L / 2 + e) + up.face * PLATE_T) + '" cy="' + Z(zb + ULTRA_H / 2) +
      '" r="' + (ULTRA_CAN_D / 2 * S) + '" fill="#22262e" stroke="#e8eaee" stroke-width="1.2"/></g>';
  }
  /* dimension captions */
  s += '<text x="' + X(0) + '" y="' + (Z(0) + 30) + '" fill="#9aa1ad" font-size="11" text-anchor="middle">length ' + mm(L) + ' mm</text>';
  s += '<text x="' + (Wpx - 8) + '" y="' + (Z(H) - 6) + '" fill="#9aa1ad" font-size="11" text-anchor="end">height ' + mm(H) + ' mm</text>';
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
        '" r="' + (spec.ground_clearance_m / 2 * S) + '" fill="#5b6472" stroke="#9aa1ad" stroke-width="1.2"/></g>';
    });
  }
  pos.forEach(([x0, y0]) => {
    const dy = Math.sign(y0) * e;
    s += '<g' + shapeAttrs('mount') + '><rect x="' + X(x0 - spec.wheel.diameter_m * 0.18) +
      '" y="' + Y(Math.sign(y0) * (W / 2 - 0.002)) + '" width="' + (spec.wheel.diameter_m * 0.36 * S) +
      '" height="' + (0.010 * S) + '" fill="#3d4656" stroke="#9aa1ad" stroke-width="1"/></g>';
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
    '" fill="#3d4656" stroke="#9aa1ad" stroke-width="1.2"/></g>';
  const up = parts.find(p => p.id === 'ultrasonic');
  if (up) s += '<g' + shapeAttrs('ultrasonic') + '><rect x="' + X(up.face * (L / 2 + e) + (up.face > 0 ? 0 : -PLATE_T)) +
    '" y="' + Y(0.026) + '" width="' + (PLATE_T * S) + '" height="' + (0.052 * S) +
    '" fill="#3d4656" stroke="#9aa1ad" stroke-width="1.2"/></g>';
  s += '<text x="' + X(0) + '" y="' + (Hpx - 4) + '" fill="#9aa1ad" font-size="11" text-anchor="middle">front is to the right</text>';
  return svgEl(s, '0 0 ' + Wpx + ' ' + Hpx, 700);
}
function taRender() {
  const spec = taSpecs[taCurrent];
  if (!spec) return;
  const { parts, pos } = taBuildParts(spec);
  taParts = parts;
  $('#ta-side').innerHTML = taRenderSide(spec, parts, pos);
  $('#ta-top').innerHTML = taRenderTop(spec, parts, pos);
  $$('#view-takeapart .part-shape').forEach(g =>
    g.addEventListener('click', () => taSelect(g.dataset.part)));
  const est = $('#takeapart-est');
  est.innerHTML = taIsEstimated(spec)
    ? '<span class="chip-est">ESTIMATED \u2014 this spec was drafted from a photo. Every dimension is an estimate, not a measurement.</span>'
    : '';
  if (taSelected && !parts.find(p => p.id === taSelected)) taSelected = null;
  if (taSelected) taSelect(taSelected, true);
}
function taSelect(id, keep) {
  taSelected = id;
  const p = taParts.find(x => x.id === id);
  if (!p) return;
  $$('#view-takeapart .part-shape').forEach(g =>
    g.classList.toggle('sel', g.dataset.part === id));
  const spot = RFI[p.id]
    ? '<img class="spot" src="' + RFI[p.id] + '" alt="AI illustration of the ' + esc(p.name) + '">' +
      '<p class="credit">AI illustration (muse-image-1.0). The printable part itself is generated from the spec by <code>robotforge cad</code>.</p>'
    : '';
  $('#ta-detail').innerHTML =
    '<span class="qty">Qty ' + p.qty + ' \u00b7 ' + esc(p.file) + '</span>' +
    '<h3>' + esc(p.name) + '</h3>' +
    spot +
    '<dl>' +
    '<dt>What it is</dt><dd>' + esc(p.does) + '</dd>' +
    '<dt>Key dimensions</dt><dd class="dim">' + esc(p.dims) + '</dd>' +
    '<dt>Beginner tweak</dt><dd>' + esc(p.tweak) + '</dd>' +
    '<dt>Print note</dt><dd class="dim">' + esc(p.print) + '</dd>' +
    '</dl>' +
    '<p style="margin-top:14px;color:var(--muted);font-size:0.92rem">This part is one file in the take-apart kit. Open <code>' + esc(p.file) +
    '</code> in OpenSCAD (or FreeCAD) to edit just this part \u2014 the assembly picks up your change.</p>';
  if (!keep) { /* re-render already applied classes; nothing else needed */ }
}
let taInitDone = false;
async function initTakeApart() {
  if (taInitDone) return;
  taInitDone = true;
  const sel = $('#ta-robot');
  const available = [];
  for (const src of TA_SOURCES) {
    try { taSpecs[src.id] = await fetchJSON(src.file); available.push(src); }
    catch (e) { /* spec not published yet \u2014 the option simply doesn't appear */ }
  }
  if (!available.length) {
    $('#ta-side').innerHTML = '<div class="state-box">No spec files could be loaded from <code>examples/</code> right now, so there is nothing honest to draw. The viewer builds only from published spec files.</div>';
    return;
  }
  sel.innerHTML = available.map(a => '<option value="' + a.id + '">' + esc(a.label) + '</option>').join('');
  taCurrent = available[0].id;
  sel.addEventListener('change', () => { taCurrent = sel.value; taSelected = null; taRender(); });
  const slider = $('#ta-explode');
  slider.addEventListener('input', () => {
    taExplode = Number(slider.value);
    $('#ta-explode-val').textContent = taExplode + ' mm';
    taRender();
  });
  taRender();
}

/* ---------------- Describe replay ----------------
   Recordings of real runs from Oct 26, 2026. The spec JSON shown is
   fetched from examples/ \u2014 the actual recorded artifacts. Framing
   text states plainly what was and was not archived. */
function specTable(spec) {
  const rows = [
    ['Name', spec.name], ['Description', spec.description], ['Drivetrain', spec.drivetrain],
    ['Size (L x W x H)', mm(spec.length_m) + ' x ' + mm(spec.width_m) + ' x ' + mm(spec.height_m) + ' mm'],
    ['Mass', spec.mass_kg + ' kg'], ['Ground clearance', mm(spec.ground_clearance_m) + ' mm'],
    ['Wheels', mm(spec.wheel.diameter_m) + ' mm diameter x ' + mm(spec.wheel.width_m) + ' mm wide, x' + spec.wheel.count + (spec.wheel.driven ? ', driven' : '')],
    ['Motor', (spec.motor.kind || '') + ' x' + spec.motor.count + ', ' + spec.motor.voltage_v + ' V' + (spec.motor.stall_torque_nm != null ? ', stall ' + spec.motor.stall_torque_nm + ' N\u00b7m' : '')],
    ['Battery', (spec.battery.chemistry || '') + ' ' + spec.battery.voltage_v + ' V, ' + spec.battery.capacity_mah + ' mAh'],
    ['Sensors', (spec.sensors || []).map(s => s.kind + ' (' + s.position + ')').join(', ') || 'none']
  ];
  return '<table>' + rows.map(([k, v]) => '<tr><th>' + esc(k) + '</th><td>' + esc(v) + '</td></tr>').join('') + '</table>';
}
const REPLAYS = [
  {
    id: 'describe', title: 'Describe \u2014 words to spec',
    build(live) { return [
      { h: 'Step 1 \u00b7 The request',
        body: '<p>A plain-language description of a four-wheel skid-steer warehouse rover was sent to <strong>Muse Spark (muse-spark-1.3)</strong> through the Meta Model API \u2014 RobotForge\u2019s live describe path, first run on Oct 26, 2026.</p>' +
              '<p>The exact prompt text wasn\u2019t archived with the run, so this replay doesn\u2019t invent it. What survives \u2014 and what you\u2019re looking at \u2014 is the recorded output, <code>examples/pathfinder-live.json</code>.</p>' },
      { h: 'Step 2 \u00b7 The spec that came back',
        body: '<p>The model answered with a complete, structured spec \u2014 every requested value honored, including the unit conversion (a 0.06 m wheel radius came back as a 0.12 m diameter):</p>' +
              specTable(live) +
              '<details><summary style="cursor:pointer;color:var(--accent);margin-top:12px">Raw recorded JSON</summary><pre>' + esc(JSON.stringify(live, null, 2)) + '</pre></details>' },
      { h: 'Step 3 \u00b7 Validation \u2014 and what happened next',
        body: '<p class="verdict-line">Engineering validation: <span class="ok">passed all checks \u2014 zero errors, zero warnings.</span></p>' +
              '<p>The spec went on to URDF generation without a single fix. Its hand-authored reference twin (<code>examples/pathfinder.json</code>) is the robot carrying the recorded gate PASS runs \u2014 drive error 0.325\u20131.525%, turn error 2.205\u20134.77&deg; at the locked thresholds. See the <a href="#evidence" data-goto-link="evidence">Gate Evidence</a> view.</p>' }
    ]; }
  },
  {
    id: 'photo', title: 'Photo intake \u2014 picture to estimated spec',
    build(photo) { return [
      { h: 'Step 1 \u00b7 The photo',
        body: '<p>The input was a real photograph \u2014 the official TurtleBot family photo (turtlebot.com). Muse Spark\u2019s vision pass worked from what is actually visible in the picture, and its identity guess was:</p>' +
              '<p class="verdict-line">\u201cTurtleBot 3 Waffle Pi\u201d</p>' +
              '<p>It listed only the parts it could see \u2014 lidar, camera, wheels \u2014 and drafted the spec below from the robot\u2019s published approximate size.</p>' },
      { h: 'Step 2 \u00b7 The drafted spec \u2014 ESTIMATED',
        body: '<span class="chip-est">ESTIMATED \u2014 a photo has no scale reference. Every dimension is an estimate, never a measurement.</span>' +
              specTable(photo) +
              '<details><summary style="cursor:pointer;color:var(--accent);margin-top:12px">Raw recorded JSON</summary><pre>' + esc(JSON.stringify(photo, null, 2)) + '</pre></details>' },
      { h: 'Step 3 \u00b7 The cross-check \u2014 printed, not smoothed over',
        body: '<p>A second model, <strong>SAM 3.1</strong>, independently locates parts in the photo, and the two are printed side by side. They do not always agree \u2014 and the disagreement is part of the output:</p>' +
              '<div class="xcheck"><strong>Real TurtleBot photo:</strong> SAM located <strong>3 wheel regions</strong> (confidences 0.945 / 0.816 / 0.785). The draft spec carries 2 drive wheels plus casters \u2014 a different question (visible regions vs driven wheels), so both numbers stay on the record.</div>' +
              '<div class="xcheck"><strong>Flat cartoon-style test image:</strong> Spark counted 4 wheels; SAM found <strong>0 regions</strong> \u2014 flat drawings defeat segmentation. In the CLI\u2019s own format that prints as <span class="dis">\u201cSpark saw 4 / SAM found 0 regions \u2014 DISAGREE\u201d</span>, flagged, not hidden.</div>' +
              '<p>The drafted spec was saved as <code>examples/photo-turtlebot.json</code> and \u2014 estimates and all \u2014 validated clean. In the Robodex it carries no gate badge: it has not been gated, and the record says so.</p>' }
    ]; }
  }
];
const replayState = { which: 'describe', step: 0, timer: null, specs: {} };
async function initReplay() {
  if (inited.replay) return;
  inited.replay = true;
  const tabs = $('#replay-tabs');
  tabs.innerHTML = REPLAYS.map(r =>
    '<button class="btn' + (r.id === replayState.which ? ' solid' : '') + '" data-replay="' + r.id + '">' + esc(r.title) + '</button>').join('');
  $$('#replay-tabs [data-replay]').forEach(b => b.addEventListener('click', () => {
    replayState.which = b.dataset.replay; replayState.step = 0; stopPlay(); renderReplay();
    $$('#replay-tabs [data-replay]').forEach(x => x.classList.toggle('solid', x.dataset.replay === replayState.which));
  }));
  try {
    replayState.specs.live = await fetchJSON('examples/pathfinder-live.json');
    replayState.specs.photo = await fetchJSON('examples/photo-turtlebot.json');
  } catch (e) { /* renderReplay shows the honest empty state */ }
  renderReplay();
}
function replaySteps() {
  const r = REPLAYS.find(x => x.id === replayState.which);
  const spec = replayState.which === 'describe' ? replayState.specs.live : replayState.specs.photo;
  if (!spec) return null;
  return r.build(spec);
}
function renderReplay() {
  const panel = $('#replay-panel');
  const steps = replaySteps();
  const r = REPLAYS.find(x => x.id === replayState.which);
  if (!steps) {
    panel.innerHTML = '<div class="state-box">The recorded spec file for this run could not be loaded from <code>examples/</code> on this site, so the replay has nothing real to show. Nothing is simulated in its place.</div>';
    return;
  }
  const st = steps[replayState.step];
  panel.innerHTML =
    '<div class="replay-head"><h3>' + esc(r.title) + '</h3>' +
    '<span class="chip-rec">Recorded \u00b7 Oct 26, 2026 \u00b7 not a live call</span></div>' +
    '<div class="stepdots">' + steps.map((_, i) => '<span class="' + (i === replayState.step ? 'on' : '') + '"></span>').join('') + '</div>' +
    '<div class="stepbody"><h4>' + esc(st.h) + '</h4>' + st.body + '</div>' +
    '<div class="replay-nav">' +
      '<button class="btn" id="rp-prev"' + (replayState.step === 0 ? ' disabled style="opacity:.4"' : '') + '>&larr; Back</button>' +
      '<button class="btn" id="rp-next"' + (replayState.step === steps.length - 1 ? ' disabled style="opacity:.4"' : '') + '>Next step &rarr;</button>' +
      '<button class="btn" id="rp-play">' + (replayState.timer ? 'Pause' : 'Play') + '</button>' +
    '</div>';
  const prev = $('#rp-prev'), next = $('#rp-next'), play = $('#rp-play');
  if (prev) prev.addEventListener('click', () => { stopPlay(); replayState.step = Math.max(0, replayState.step - 1); renderReplay(); });
  if (next) next.addEventListener('click', () => { stopPlay(); replayState.step = Math.min(steps.length - 1, replayState.step + 1); renderReplay(); });
  if (play) play.addEventListener('click', () => replayState.timer ? stopPlay(true) : startPlay());
  $$('#replay-panel [data-goto-link]').forEach(a => a.addEventListener('click', ev => {
    ev.preventDefault(); showView(a.dataset.gotoLink);
  }));
}
function startPlay() {
  stopPlay();
  replayState.timer = setInterval(() => {
    const steps = replaySteps();
    if (!steps) return stopPlay(true);
    if (replayState.step >= steps.length - 1) return stopPlay(true);
    replayState.step++; renderReplay();
  }, 3200);
  renderReplay();
}
function stopPlay(rerender) {
  if (replayState.timer) { clearInterval(replayState.timer); replayState.timer = null; }
  if (rerender) renderReplay();
}

/* ---------------- hero art (AI illustration, labeled) ---------------- */
(function heroArt() {
  const f = $('#hero-art');
  if (f && RFI.hero) {
    f.hidden = false;
    f.innerHTML = '<img src="' + RFI.hero + '" alt="AI illustration of a rover on a workbench">' +
      '<figcaption>AI illustration (muse-image-1.0) \u2014 the forge\u2019s rover, imagined. ' +
      'The real robots in the Robodex carry real photos, credited.</figcaption>';
  }
})();

/* ---------------- boot ---------------- */
showView((location.hash || '#home').slice(1));
