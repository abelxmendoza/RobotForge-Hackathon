'use strict';
/* Forge — one conversation surface.
 *
 * Describe a robot in words, or attach a photo, a parts list, a
 * spec file, or a .ply scan. A photo is first asked what it is: a
 * robot photo (drafted from appearance, every dimension ESTIMATED)
 * or a spec sheet / blueprint (TRANSCRIBED — printed values only,
 * never inferred from drawing scale; the draft is badged
 * DOCUMENT-READ). A scan is parsed and measured entirely in the
 * browser (bounding box; badged MEASURED (scan)). A Gaussian-splat
 * .ply (a SAM 3D export) is detected by its property signature and
 * treated as what it is — a reconstruction inferred from a single
 * photo: bounding box in the file's own relative units, dimensions
 * ESTIMATED, badged RECONSTRUCTED (single photo), never seeded
 * into a spec, because it carries no real-world scale.
 * Every stage of every run wears exactly one badge:
 *
 *   LIVE     — a real model call through the live endpoint
 *              (assets/js/live-config.js; empty = no live steps).
 *   LOCAL    — real computation in the visitor's browser: the spec
 *              checks below and the take-apart viewer (the same
 *              geometry builders as the robot pages, robot.js).
 *   RECORDED — a replayed recorded run, labeled with its date.
 *
 * A stage never wears a badge it didn't earn: the motion gate runs
 * in Gazebo on the forge's machine, so in-browser runs show it as a
 * plain note — never a simulated verdict. Uploaded files are read
 * in the browser and sent NOWHERE unless a live step runs.
 */

/* == forge-validate:start == */
/* Browser validation subset — a port of the core of
 * src/robotforge/validate.py plus the required-field/type layer of
 * src/robotforge/schema.py (RobotSpec.from_dict). Pure, DOM-free:
 * tests/test_live.py extracts this block and runs it in Node
 * against the repo's example specs, comparing its output line for
 * line with the Python validator. It is a SUBSET: the full schema
 * strictness (wiring blocks, unknown keys) and everything
 * downstream (URDF, twin, gate) live in the CLI. */
const FV_DRIVETRAINS = ['differential', 'skid_steer', 'ackermann',
  'mecanum', 'tracked', 'multirotor', 'quadruped', 'humanoid',
  'robotic_arm'];
const FV_GROUND = ['differential', 'skid_steer', 'ackermann',
  'mecanum', 'tracked'];
const FV_SENSOR_KINDS = ['ultrasonic', 'lidar_2d', 'depth_camera',
  'rgb_camera', 'imu', 'gps', 'bumper', 'encoder'];

function fvFmt3(v) { return v.toFixed(3); }
function fvFmtG(v) { return String(parseFloat(v.toPrecision(6))); }
const FV_HEURISTIC = 'direct-supply heuristic: ';
function fvIsNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function fvIsInt(v) { return fvIsNum(v) && Number.isInteger(v); }

function forgeValidateSpec(spec) {
  /* Returns { lines: ['[SEVERITY] check: message', ...],
   *           schemaErrors: bool, errors: bool } */
  const lines = [];
  const schema = (check, msg) =>
    lines.push('[ERROR] ' + check + ': ' + msg);
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    schema('schema.type', 'the spec is not a JSON object');
    return { lines, schemaErrors: true, errors: true };
  }
  /* Required fields follow the spec's class, as in schema.py:
   * wheels + ground clearance belong to the ground drivetrains;
   * the other classes declare rotors / legs / arms instead. */
  const reqTop = ['name', 'drivetrain', 'length_m', 'width_m',
    'height_m', 'mass_kg', 'motor', 'battery'];
  if (FV_GROUND.includes(spec.drivetrain)) {
    reqTop.push('ground_clearance_m', 'wheel');
  }
  if (spec.drivetrain === 'multirotor') reqTop.push('rotors');
  if (spec.drivetrain === 'quadruped' || spec.drivetrain === 'humanoid') {
    reqTop.push('legs');
  }
  if (spec.drivetrain === 'humanoid' || spec.drivetrain === 'robotic_arm') {
    reqTop.push('arms');
  }
  for (const k of reqTop) {
    if (!(k in spec)) schema('schema.required', 'missing field: ' + k);
  }
  const reqNested = {
    wheel: ['diameter_m', 'width_m', 'count'],
    motor: ['kind', 'voltage_v', 'count'],
    battery: ['chemistry', 'voltage_v', 'capacity_mah'],
    rotors: ['count', 'prop_diameter_m'],
    legs: ['count'],
    arms: ['count'],
  };
  for (const obj of Object.keys(reqNested)) {
    if (typeof spec[obj] !== 'object' || spec[obj] === null) {
      if (obj in spec) schema('schema.type', obj + ' is not an object');
      continue;
    }
    for (const k of reqNested[obj]) {
      if (!(k in spec[obj])) {
        schema('schema.required', 'missing field: ' + obj + '.' + k);
      }
    }
  }
  if (lines.length) return { lines, schemaErrors: true, errors: true };
  /* types (schema.py coerces with float()/int()/str(); the browser
   * subset requires real JSON numbers/strings instead) */
  if (typeof spec.name !== 'string') {
    schema('schema.type', 'name is not a string');
  }
  for (const k of ['length_m', 'width_m', 'height_m', 'mass_kg']) {
    if (!fvIsNum(spec[k])) schema('schema.type', k + ' is not a number');
  }
  if (spec.ground_clearance_m !== undefined &&
      !fvIsNum(spec.ground_clearance_m)) {
    schema('schema.type', 'ground_clearance_m is not a number');
  }
  if (spec.wheel !== undefined && spec.wheel !== null) {
    if (!fvIsNum(spec.wheel.diameter_m)) {
      schema('schema.type', 'wheel.diameter_m is not a number');
    }
    if (!fvIsNum(spec.wheel.width_m)) {
      schema('schema.type', 'wheel.width_m is not a number');
    }
    if (!fvIsInt(spec.wheel.count)) {
      schema('schema.type', 'wheel.count is not an integer');
    }
  }
  if (spec.rotors !== undefined && spec.rotors !== null) {
    if (!fvIsInt(spec.rotors.count)) {
      schema('schema.type', 'rotors.count is not an integer');
    }
    if (!fvIsNum(spec.rotors.prop_diameter_m)) {
      schema('schema.type', 'rotors.prop_diameter_m is not a number');
    }
  }
  for (const key of ['legs', 'arms']) {
    const limb = spec[key];
    if (limb !== undefined && limb !== null && !fvIsInt(limb.count)) {
      schema('schema.type', key + '.count is not an integer');
    }
  }
  if (typeof spec.motor.kind !== 'string') {
    schema('schema.type', 'motor.kind is not a string');
  }
  if (!fvIsNum(spec.motor.voltage_v)) {
    schema('schema.type', 'motor.voltage_v is not a number');
  }
  if (!fvIsInt(spec.motor.count)) {
    schema('schema.type', 'motor.count is not an integer');
  }
  if (typeof spec.battery.chemistry !== 'string') {
    schema('schema.type', 'battery.chemistry is not a string');
  }
  if (!fvIsNum(spec.battery.voltage_v)) {
    schema('schema.type', 'battery.voltage_v is not a number');
  }
  if (!fvIsInt(spec.battery.capacity_mah)) {
    schema('schema.type', 'battery.capacity_mah is not an integer');
  }
  if (!FV_DRIVETRAINS.includes(spec.drivetrain)) {
    schema('schema.drivetrain', 'unknown drivetrain: ' + String(spec.drivetrain));
  }
  const sensors = spec.sensors === undefined ? [] : spec.sensors;
  if (!Array.isArray(sensors)) {
    schema('schema.type', 'sensors is not a list');
  } else {
    for (const s of sensors) {
      if (!s || typeof s !== 'object' || !FV_SENSOR_KINDS.includes(s.kind)) {
        schema('schema.sensor_kind',
          'unknown sensor kind: ' + String(s && s.kind));
      } else if (typeof s.position !== 'string') {
        schema('schema.type', 'sensor position is not a string');
      }
    }
  }
  if (lines.length) return { lines, schemaErrors: true, errors: true };

  /* coherence checks — validate.py, check for check */
  const f = (sev, check, msg) =>
    lines.push('[' + sev + '] ' + check + ': ' + msg);
  if (spec.wheel) {
    const radius = spec.wheel.diameter_m / 2.0;
    if (spec.ground_clearance_m != null &&
        spec.ground_clearance_m > radius) {
      f('ERROR', 'geometry.clearance_vs_wheel',
        'ground clearance ' + fvFmt3(spec.ground_clearance_m) +
        ' m exceeds wheel radius ' + fvFmt3(radius) +
        ' m — impossible without a lifted chassis design');
    }
    if (spec.wheel.diameter_m > spec.height_m) {
      f('WARN', 'geometry.wheel_vs_height',
        'wheel diameter ' + fvFmt3(spec.wheel.diameter_m) +
        ' m is larger than body height ' + fvFmt3(spec.height_m) + ' m');
    }
    if (spec.wheel.width_m * spec.wheel.count > spec.length_m * 2 &&
        (spec.drivetrain === 'differential' || spec.drivetrain === 'skid_steer')) {
      f('WARN', 'geometry.wheel_footprint',
        'total wheel width looks large relative to body length');
    }
    if (spec.drivetrain === 'differential' && spec.wheel.count !== 2) {
      f('WARN', 'drivetrain.wheel_count',
        'differential drive normally has 2 driven wheels, spec declares ' +
        spec.wheel.count + ' wheels');
    }
    if (spec.drivetrain === 'ackermann' && spec.wheel.count !== 4) {
      f('WARN', 'drivetrain.wheel_count',
        'ackermann steering normally uses 4 wheels');
    }
  }
  if (spec.motor.count < 1) {
    f('ERROR', 'drivetrain.motor_count', 'no motors declared');
  }
  if ((spec.drivetrain === 'differential' || spec.drivetrain === 'skid_steer') &&
      spec.motor.count === 1) {
    f('WARN', 'drivetrain.motor_count',
      'a single motor cannot drive a differential/skid-steer drivetrain ' +
      'without a shared axle gearbox');
  }
  /* class coherence — validate.py's non-ground checks, mirrored */
  if (spec.drivetrain === 'multirotor') {
    if (!spec.rotors) {
      f('ERROR', 'class.rotors_missing',
        'multirotor spec declares no rotors block');
    } else {
      if (spec.rotors.count !== spec.motor.count) {
        f('WARN', 'drivetrain.rotor_motor_match',
          'a multirotor normally has one motor per rotor, spec declares ' +
          spec.rotors.count + ' rotors and ' + spec.motor.count + ' motors');
      }
      const spacing = Math.min(spec.length_m, spec.width_m);
      if (spec.rotors.prop_diameter_m > spacing) {
        f('WARN', 'geometry.prop_overlap',
          'propeller diameter ' + fvFmt3(spec.rotors.prop_diameter_m) +
          ' m exceeds the ' + fvFmt3(spacing) +
          ' m between neighbouring motors — the props would overlap');
      }
    }
  }
  if (spec.drivetrain === 'quadruped' || spec.drivetrain === 'humanoid') {
    if (!spec.legs) {
      f('ERROR', 'class.legs_missing',
        spec.drivetrain + ' spec declares no legs block');
    } else {
      const want = spec.drivetrain === 'quadruped' ? 4 : 2;
      if (spec.legs.count !== want) {
        f('WARN', 'drivetrain.leg_count',
          'a ' + spec.drivetrain + ' normally has ' + want +
          ' legs, spec declares ' + spec.legs.count);
      }
    }
  }
  if (spec.drivetrain === 'humanoid' || spec.drivetrain === 'robotic_arm') {
    if (!spec.arms) {
      f('ERROR', 'class.arms_missing',
        spec.drivetrain + ' spec declares no arms block');
    } else {
      const want = spec.drivetrain === 'humanoid' ? 2 : 1;
      if (spec.arms.count !== want) {
        f('WARN', 'drivetrain.arm_count',
          'a ' + spec.drivetrain + ' normally has ' + want +
          ' arm(s), spec declares ' + spec.arms.count);
      }
    }
  }
  if (spec.motor.voltage_v > spec.battery.voltage_v * 1.05) {
    f('WARN', 'electrical.voltage_match',
      FV_HEURISTIC + 'motor nominal voltage ' + fvFmtG(spec.motor.voltage_v) +
      ' V exceeds battery nominal voltage ' + fvFmtG(spec.battery.voltage_v) +
      ' V; verify motor-driver output, battery operating range, and any boost converter before approval');
  } else if (spec.motor.voltage_v < spec.battery.voltage_v * 0.5) {
    f('WARN', 'electrical.voltage_match',
      FV_HEURISTIC + 'motor nominal voltage ' + fvFmtG(spec.motor.voltage_v) +
      ' V is far below battery nominal voltage ' + fvFmtG(spec.battery.voltage_v) +
      ' V; verify motor-driver output, regulation, and component voltage limits before approval');
  }
  const cm = spec.component_mass_kg;
  if (cm && typeof cm === 'object' && Object.keys(cm).length) {
    const total = Object.values(cm).reduce((a, b) => a + Number(b), 0);
    if (total > spec.mass_kg * 1.005) {
      f('ERROR', 'mass.budget',
        'component masses sum to ' + total.toFixed(2) +
        ' kg, above the declared total ' + spec.mass_kg.toFixed(2) + ' kg');
    } else if (total < spec.mass_kg * 0.4) {
      f('WARN', 'mass.budget',
        'component masses sum to ' + total.toFixed(2) + ' kg, only ' +
        Math.round(100 * total / spec.mass_kg) + '% of the declared total ' +
        spec.mass_kg.toFixed(2) + ' kg — mass is unaccounted for');
    }
  }
  for (const s of sensors) {
    if (s.range_m != null && s.range_m <= 0) {
      f('ERROR', 'sensor.range',
        s.kind + ' sensor at ' + s.position + ' has non-positive range ' +
        String(s.range_m));
    }
  }
  if (!lines.length) {
    lines.push('[INFO] all: spec passed all engineering checks');
  }
  return {
    lines, schemaErrors: false,
    errors: lines.some(l => l.startsWith('[ERROR]')),
  };
}
/* == forge-validate:end == */

(function () {
  const thread = document.getElementById('forge-thread');
  if (!thread) return;

  /* ---------------- recorded sample runs ----------------
   * The same recorded runs the Forge used to walk step by step,
   * replayed into the thread as RECORDED stages. Every artifact is
   * a file in this repository. */
  const STEP_NAMES = ['Input', 'Spec', 'Checks', 'Twin & gate', 'Outputs'];
  const RUNS = [
    {
      id: 'words', tab: 'Words',
      meta: 'Recorded Oct 26, 2026 · examples/indoor-delivery-rover.json',
      files: { spec: 'examples/indoor-delivery-rover.json', broken: 'examples/broken-indoor-rover.json',
               reports: 'catalog/gate-reports.json' },
      steps: d => {
        const rep = d.reports.runs.find(r => r.id === 'r5-rover').doc;
        return [
          { h: 'Describe it in plain words',
            intro: 'One paragraph of plain English. No forms, no CAD, no config files.',
            body: '<blockquote class="quote">“A small indoor delivery rover with differential drive. It is about 40 cm long, 30 cm wide and 25 cm tall, weighs 6 kg, rides on wheels 10 cm in diameter and 2.5 cm wide, ground clearance 3 cm, top speed about 1 m/s. It carries a 2D lidar on top for navigation and runs from an 11.1 V 5 Ah battery.”' +
                  '<cite>Sent to Muse Spark through the Meta Model API (Standard mode)</cite></blockquote>' },
          { h: 'Muse Spark drafts the spec',
            intro: 'The model fills a strict engineering schema. It never writes simulation code, so everything downstream is deterministic.',
            body: '<div class="card" style="padding:4px 20px">' + specTable(d.spec) + '</div>' + rawJSON(d.spec, 'Spec JSON as returned') },
          { h: 'The checks look for numbers that don’t add up',
            intro: 'Geometry, mass budget, motor and battery voltage, sensor ranges. An ERROR stops the pipeline: no twin is built from that spec.',
            body: findings(['[INFO] all: spec passed all engineering checks']) +
                  '<div class="card"><div class="eyebrow">What a bad spec looks like</div>' +
                  '<p class="muted" style="font-size:var(--fs-sm);margin:8px 0 12px">The same rover with two numbers changed: a 24 V battery and 6 cm of ground clearance. Real validator output on <code>examples/broken-indoor-rover.json</code>:</p>' +
                  findings(d.broken) + '</div>' },
          { h: 'The twin drives, turns, and is measured',
            intro: 'The spec becomes a Gazebo twin, headless. It is told to drive 1 m and turn 90°, and graded against where it actually went.',
            body: '<div class="verdict-row">' + verdict(rep.verdict, 'lg') + '<span class="muted" style="font-size:var(--fs-sm)">All four checks inside the pass line.</span></div>' +
                  '<div class="two">' + rep.checks.map(meter).join('') + '</div>' +
                  '<div><canvas class="traj" id="forge-traj"></canvas><p class="legend">White dot: start. Amber dot: where the twin really ended up.</p></div>' +
                  '<div class="callout warn"><span>The gate tests the spec’s simulated twin, not a physical robot. A PASS means the numbers describe a robot that can do this in simulation.</span></div>',
            after: () => drawTraj($('#forge-traj'), d.reports.runs.find(r => r.id === 'r5-rover').traj) },
          { h: 'Take the outputs with you',
            intro: 'Everything the forge made from this paragraph, and the commands that make it again.',
            body: '<ul class="outputs">' +
                  '<li><strong>Robot model (URDF)</strong><span>For ROS and any simulator that reads URDF.</span>' + codeBlock('robotforge urdf examples/indoor-delivery-rover.json --out build/rover.urdf') + '</li>' +
                  '<li><strong>Take-apart parts kit</strong><span>One OpenSCAD file per printable part, plus an assembly.</span>' + codeBlock('robotforge cad examples/indoor-delivery-rover.json') + '</li>' +
                  '<li><strong>Gate report</strong><span>Re-run the gate on your own machine (needs Gazebo Sim).</span>' + codeBlock('robotforge run-gate examples/indoor-delivery-rover.json') + '</li>' +
                  '</ul><p style="font-size:var(--fs-sm)"><a href="../evidence/#run-r5-rover">Read this run’s full gate report &rarr;</a></p>' }
        ];
      }
    },
    {
      id: 'photo', tab: 'Photo',
      meta: 'Recorded Oct 26, 2026 · examples/photo-turtlebot.json',
      files: { spec: 'examples/photo-turtlebot.json' },
      steps: d => [
        { h: 'Start from a photo',
          intro: 'The input was the official TurtleBot family photo. Muse Spark’s vision pass works only from what is visible, and named the robot: “TurtleBot 3 Waffle Pi”.',
          body: '<figure class="photo-in"><img src="https://emanual.robotis.com/assets/images/platform/turtlebot3/hardware_setup/turtlebot3_models.png" alt="The TurtleBot3 lineup, Waffle Pi at right" loading="lazy"></figure>' +
                '<p class="faint" style="font-size:12px">Shown: the official ROBOTIS TurtleBot3 lineup (Waffle Pi at right), for reference.</p>' },
        { h: 'A drafted spec, marked as estimated',
          intro: 'A photo has no scale reference, so every dimension is an estimate drawn from the robot’s published approximate size.',
          body: '<span class="est">Estimated, not measured</span><div class="card" style="padding:4px 20px">' + specTable(d.spec) + '</div>' + rawJSON(d.spec, 'Spec JSON as drafted') },
        { h: 'Checks, plus a second model’s opinion',
          intro: 'The estimated spec passes the engineering checks. SAM 3.1 then locates parts in the photo on its own, and the two answers are printed side by side.',
          body: findings(['[INFO] all: spec passed all engineering checks']) +
                '<div class="callout"><span><strong>Real photo:</strong> SAM located 3 wheel regions (confidence 0.945 / 0.816 / 0.785). The spec carries 2 drive wheels plus casters. That’s a different question (visible regions vs driven wheels), so both numbers stay on the record.</span></div>' +
                '<div class="callout bad"><span><strong>Flat cartoon test image:</strong> Spark counted 4 wheels and SAM found 0 regions. The CLI prints <code>Spark saw 4 / SAM found 0 regions — DISAGREE</code>, flagged rather than hidden.</span></div>' },
        { h: 'No verdict without a measurement',
          intro: 'This spec has not been run through the motion gate, so it has no badge. RobotForge doesn’t borrow a verdict it hasn’t measured.',
          body: '<div class="verdict-row">' + verdict('NOT_GATED', 'lg') + '</div>' +
                '<div class="callout warn"><span>Measure the real robot, update the estimated numbers, and then gate it. Until then the spec is a draft.</span></div>' },
        { h: 'Take the outputs with you',
          intro: 'The drafted spec and the commands that produced it.',
          body: '<ul class="outputs">' +
                '<li><strong>Draft a spec from your own photo</strong><span>Every dimension comes back marked ESTIMATED.</span>' + codeBlock('robotforge describe --photo robot.jpg --out robot.json') + '</li>' +
                '<li><strong>Find the official model files</strong><span>Public repos and twin assets for a named robot, with licenses shown.</span>' + codeBlock('robotforge lookup "TurtleBot 3 Waffle Pi"') + '</li>' +
                '</ul><p style="font-size:var(--fs-sm)"><a href="../robots/turtlebot3-waffle-pi/">Open the Waffle Pi in the Robodex &rarr;</a></p>' }
      ]
    },
    {
      id: 'document', tab: 'Document',
      meta: 'Recorded Oct 26, 2026 · examples/document-turtlebot3-burger.json',
      files: { sheet: 'examples/document-turtlebot3-burger.json' },
      names: ['Input', 'Transcription', 'Accuracy', 'Checks & gate', 'Outputs'],
      steps: d => {
        const r = d.sheet;
        const sc = r.score;
        const fmtN = v => v == null ? '—' : String(v);
        return [
          { h: 'Start from a spec sheet',
            intro: 'The input was an IMAGE of printed values: a datasheet-style sheet rendered from the TurtleBot3 Burger’s published specs as recorded in this repo. The vision model read a PNG rendering of it (' + r.input.png_bytes + ' bytes, sha256 ' + r.input.png_sha256.slice(0, 12) + '…); the sheet below is its SVG twin — same layout, same printed values.',
            body: '<figure class="photo-in docsheet"><img src="' + ROOT + 'examples/document-turtlebot3-burger-spec-sheet.svg" alt="The TurtleBot3 Burger spec sheet used as this run’s input" loading="lazy"></figure>' +
                  '<p class="faint" style="font-size:12px">Generated by <code>tools/make_spec_sheet.py</code> from <code>examples/turtlebot3-burger.json</code> — a fixture rendering of published values, not a ROBOTIS document.</p>' },
          { h: 'Printed values, transcribed',
            intro: 'Document mode transcribes what the sheet PRINTS. Nothing is estimated, and nothing is inferred from drawing scale or proportions — a value that isn’t printed stays absent.',
            body: '<span class="docd">Document draft — values transcribed from the document; verify against the source</span>' +
                  '<p class="intro" style="margin-top:10px">Identity, as printed: <strong>' + esc(r.identity_guess) + '</strong></p>' +
                  '<div class="eyebrow">Transcribed values (as printed → spec field)</div>' +
                  '<ul class="items">' + r.values.map(v =>
                    '<li><span class="title">' + esc(v.label) + ': <strong>' + esc(v.printed) + '</strong></span><span class="faint">→ ' + esc(v.field) + '</span></li>').join('') + '</ul>' +
                  '<div class="card" style="padding:4px 20px">' + specTable(r.spec) + '</div>' + rawJSON(r.spec, 'Draft spec JSON as transcribed') },
          { h: 'Scored against the published values',
            intro: 'Every printed number on the sheet is a value this repo already holds with a source, so the transcription can be graded exactly, after the printed units are converted (mm → m). A miss would be printed in this table, not rounded away.',
            body: '<p class="score-line"><strong>' + sc.exact + ' of ' + sc.total + '</strong> printed values transcribed exactly.</p>' +
                  '<ul class="items">' + sc.rows.map(row =>
                    '<li><span class="slotname' + (row.match ? '' : ' none') + '">' + (row.match ? '✓' : '✗') + '</span>' +
                    '<span class="title">' + esc(row.field) + ' — printed ' + esc(row.printed) + ', expected ' + fmtN(row.expected) +
                    (row.match ? '' : ', got ' + fmtN(row.got)) + '</span></li>').join('') + '</ul>' },
          { h: 'Checks pass; the gate has not run',
            intro: 'The transcribed draft is complete and passes the engineering checks — this is the validator’s real output, recorded with the run. The draft has not been through the motion gate, so it wears no verdict.',
            body: findings(r.findings || []) +
                  '<div class="verdict-row">' + verdict('NOT_GATED', 'lg') + '</div>' +
                  '<div class="callout warn"><span>A transcription is only as good as the sheet it came from: a misprint upstream would be transcribed faithfully. That is why the draft says “verify against the source”.</span></div>' },
          { h: 'Take the outputs with you',
            intro: 'The recorded draft, and the commands that make it again from your own sheet.',
            body: '<ul class="outputs">' +
                  '<li><strong>Transcribe your own spec sheet</strong><span>Printed values only — anything the document doesn’t print stays absent.</span>' + codeBlock('robotforge describe --document sheet.png --out burger.json') + '</li>' +
                  '<li><strong>Check the draft</strong><span>The full validator; add the twin and gate when you want a verdict.</span>' + codeBlock('robotforge validate burger.json') + '</li>' +
                  '</ul><p style="font-size:var(--fs-sm)"><a href="../robots/turtlebot3-burger/">Open the Burger in the Robodex &rarr;</a></p>' }
        ];
      }
    },
    {
      id: 'list', tab: 'Parts list',
      meta: 'Recorded Oct 27, 2026 · robotforge import-list',
      files: { paste: 'examples/list-import-quad.txt', report: 'examples/list-import-quad.report.json' },
      names: ['Input', 'Parts', 'Assembly', 'Twin & gate', 'Outputs'],
      steps: d => {
        const a = d.report.assembly;
        const slots = Object.values(a.slots);
        const cls = s => s.status === 'filled' ? 'ok' : (s.status === 'missing' ? 'miss' : 'kit');
        const word = s => s.status === 'filled' ? '✓' : (s.status === 'missing' ? 'missing' : 'in kit?');
        return [
          { h: 'Paste a shopping list',
            intro: 'A real order history pasted from Amazon, noise and all: doubled titles, prices, “Add to Cart” lines, and things that aren’t robot parts.',
            body: '<pre class="paste">' + esc(d.paste.trim()) + '</pre>' },
          { h: 'Each line becomes a part',
            intro: 'Titles are matched to functional slots by deterministic rules. Quantities and specs are read from the title. Anything unmatched is shown, never dropped.',
            body: '<ul class="items">' + d.report.items.map(it =>
              '<li><span class="slotname' + (it.slot === 'unidentified' ? ' none' : '') + '">' + esc(it.slot) + '</span>' +
              '<span class="qty">×' + it.qty + '</span><span class="title" title="' + esc(it.title) + '">' + esc(it.title) + '</span>' +
              '<span class="price">' + (it.price != null ? '$' + it.price.toFixed(2) : '—') + '</span></li>').join('') + '</ul>' },
          { h: 'Assembled into a quadcopter, with gaps found',
            intro: 'The parts are placed against a quadcopter slot map. This is where you find out what’s missing before you order.',
            body: '<div class="slots">' + slots.map(s =>
              '<div class="slot ' + cls(s) + '"><span>' + esc(s.label) + '</span><span class="have">' + s.have + '/' + s.need + ' ' + word(s) + '</span></div>').join('') + '</div>' +
              a.warnings.map(w => '<div class="callout warn"><span><strong>Warning:</strong> ' + esc(w) + '</span></div>').join('') +
              (a.unidentified.length ? '<div class="callout"><span><strong>Unidentified, shown not dropped:</strong> ' + a.unidentified.map(esc).join('; ') + '</span></div>' : '') +
              (a.bench.length ? '<div class="callout"><span><strong>Bench equipment, not robot parts:</strong> ' + a.bench.map(esc).join('; ') + '</span></div>' : '') },
          { h: 'No motion gate for this class yet',
            intro: 'The motion gate covers wheeled ground robots today. A quadcopter gets the assembly check, wiring and missing parts, but no verdict.',
            body: '<div class="verdict-row">' + verdict('NOT_GATED', 'lg') + '</div>' +
                  '<div class="callout warn"><span>A list import tells you whether the parts add up to a robot. It doesn’t claim the robot will fly.</span></div>' },
          { h: 'What to buy, and how to wire it',
            intro: 'The missing parts with store search links (never scraped prices), and the suggested wiring with a reason for each connection.',
            body: '<div class="card"><div class="eyebrow">Missing</div><ul class="outputs" style="margin-top:12px">' + a.missing.map(m =>
              '<li><strong>' + esc(m.label) + (m.required ? '' : ' <span class="faint">(recommended)</span>') + '</strong><span>' +
              m.alternatives.map(x => '<a href="' + esc(x.url) + '" rel="noopener">Search ' + esc(x.store) + '</a>').join(' · ') + '</span></li>').join('') + '</ul></div>' +
              '<div class="card"><div class="eyebrow">Wiring</div><ul class="wires" style="margin-top:12px">' + d.report.wiring.connections.map(c =>
              '<li><b>' + esc(c.from) + '</b><span class="via">→ ' + esc(c.via) + ' →</span><b>' + esc(c.to) + '</b><p>' + esc(c.note) + '</p></li>').join('') + '</ul></div>' +
              codeBlock('robotforge import-list my-list.txt --out report.json') }
        ];
      }
    }
  ];

  const runData = {};
  async function loadRun(run) {
    if (runData[run.id]) return runData[run.id];
    const d = {};
    const f = run.files;
    if (f.spec) d.spec = await fetchJSON(f.spec);
    if (f.sheet) d.sheet = await fetchJSON(f.sheet);
    if (f.reports) d.reports = await fetchJSON(f.reports);
    if (f.paste) d.paste = await fetchText(f.paste);
    if (f.report) d.report = await fetchJSON(f.report);
    if (f.broken) d.broken = [
      '[ERROR] geometry.clearance_vs_wheel: ground clearance 0.060 m exceeds wheel radius 0.050 m — impossible without a lifted chassis design',
      '[WARN] electrical.voltage_match: ' + FV_HEURISTIC + 'motor nominal voltage 11.1 V is far below battery nominal voltage 24 V; verify motor-driver output, regulation, and component voltage limits before approval'
    ];
    runData[run.id] = d;
    return d;
  }

  /* ---------------- thread primitives ---------------- */
  const form = document.getElementById('forge-composer');
  const input = document.getElementById('forge-input');
  const statusEl = document.getElementById('forge-status');

  function scrollTo(el) {
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function userText(text) {
    const d = document.createElement('div');
    d.className = 'fmsg user';
    d.textContent = text;
    thread.appendChild(d); scrollTo(d);
    return d;
  }
  function userHTML(html) {
    const d = document.createElement('div');
    d.className = 'fmsg user';
    d.innerHTML = html;
    thread.appendChild(d); scrollTo(d);
    return d;
  }
  function note(html) {
    const d = document.createElement('div');
    d.className = 'fmsg note';
    d.innerHTML = html;
    thread.appendChild(d); scrollTo(d);
    return d;
  }
  const BADGE_LABEL = { live: 'LIVE', local: 'LOCAL', recorded: 'RECORDED' };
  function stage(badge, badgeNote, title, bodyHTML) {
    const el = document.createElement('article');
    el.className = 'fstage';
    el.innerHTML =
      '<header class="fstage-head"><span class="fbadge ' + badge + '">' +
      BADGE_LABEL[badge] + '</span>' +
      (badgeNote ? '<span class="fbadge-note">' + esc(badgeNote) + '</span>' : '') +
      '<h3>' + esc(title) + '</h3></header>' +
      '<div class="fstage-body">' + bodyHTML + '</div>';
    thread.appendChild(el); scrollTo(el);
    wireCopy(el);
    return el;
  }
  function setStageBody(el, bodyHTML) {
    el.querySelector('.fstage-body').innerHTML = bodyHTML;
    wireCopy(el);
  }
  function startTimer(el) {
    const t0 = performance.now();
    const iv = setInterval(() => {
      el.textContent = Math.round((performance.now() - t0) / 1000) + ' s';
    }, 250);
    return {
      stop() {
        clearInterval(iv);
        return Math.round((performance.now() - t0) / 1000);
      },
    };
  }
  function workingBody(what) {
    return '<p class="intro">' + esc(what) + '</p>' +
      '<p class="faint">Working — <span class="elapsed">0 s</span> elapsed. ' +
      'Live model calls typically take ~20 s and can take ~95 s. ' +
      'This timer is the real elapsed time; there is no progress bar to fake.</p>';
  }

  /* ---------------- live endpoint plumbing ---------------- */
  const liveBase = String(
    (window.RF_LIVE && window.RF_LIVE.endpoint) || '').replace(/\/+$/, '');
  let healthCache; // undefined = not probed yet
  async function liveHealth() {
    if (!liveBase) return null;
    if (healthCache !== undefined) return healthCache;
    try {
      const r = await fetch(liveBase + '/health', { cache: 'no-cache' });
      healthCache = r.ok ? await r.json() : null;
    } catch (e) {
      healthCache = null;
    }
    return healthCache;
  }
  function routeOn(h, route) {
    return Boolean(h && h.ok && h.mode === 'live' && h.routes &&
      h.routes[route] && !(h.budget && h.budget.exhausted));
  }
  function liveOffReason(h, route) {
    if (!liveBase) {
      return 'live mode is off in this deployment — no live endpoint ' +
        'is configured (see <code>live/README.md</code> in the repo)';
    }
    if (!h) return 'the live endpoint isn\u2019t answering';
    if (h.mode === 'off') return 'live mode is switched off at the endpoint';
    if (h.budget && h.budget.exhausted) {
      return 'today\u2019s live budget is used up';
    }
    if (route === 'photo') {
      return 'photo live mode isn\u2019t configured on the endpoint ' +
        '(it needs the optional Meta key)';
    }
    return 'that live route isn\u2019t configured on the endpoint';
  }
  async function postJSON(path, payload) {
    const r = await fetch(liveBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await r.json(); } catch (e) { /* non-JSON error page */ }
    if (!r.ok) {
      const e = new Error((body && body.error) ||
        ('the endpoint answered HTTP ' + r.status));
      e.code = body && body.code;
      e.status = r.status;
      throw e;
    }
    return body;
  }

  /* ---------------- shared stages ---------------- */
  function specStage(spec, badge, badgeNote, title) {
    return stage(badge, badgeNote, title,
      '<div class="card" style="padding:4px 20px">' + specTable(spec) +
      '</div>' + rawJSON(spec, 'Spec JSON'));
  }
  function checksStage(spec) {
    const res = forgeValidateSpec(spec);
    stage('local', 'computed in your browser just now', 'Checks',
      '<p class="intro">These are <strong>browser checks (subset of the full validator)</strong>: required fields and types, battery vs ' +
      'motor voltage, ground clearance vs wheel radius, wheel/body ' +
      'coherence. The full validator — and everything downstream — is ' +
      'the CLI: <code>robotforge validate</code>.</p>' + findings(res.lines));
    return res;
  }
  function gateNote() {
    note('<strong>Twin &amp; gate:</strong> the motion gate runs in ' +
      'Gazebo on the forge\u2019s machine — it cannot run in your ' +
      'browser, and no verdict is simulated here. For a comparable ' +
      'recorded run, see <a href="../evidence/#run-r5-rover">the ' +
      'indoor rover\u2019s gate report on the Evidence page</a> ' +
      '(recorded Oct 26, 2026), or run it yourself:' +
      codeBlock('robotforge run-gate your-spec.json'));
  }
  function outputsStage(spec, filename) {
    const el = stage('local', 'assembled in your browser',
      'Take the outputs with you',
      '<ul class="outputs">' +
      '<li><strong>The spec itself</strong><span>Download the JSON, then ' +
      'run the full pipeline on your own machine.</span>' +
      '<p><button class="btn btn-sm" type="button" data-dl>Download ' +
      esc(filename) + '</button></p></li>' +
      '<li><strong>Robot model (URDF)</strong><span>For ROS and any ' +
      'simulator that reads URDF.</span>' +
      codeBlock('robotforge urdf ' + filename) + '</li>' +
      '<li><strong>Take-apart parts kit</strong><span>One OpenSCAD file ' +
      'per printable part, plus an assembly.</span>' +
      codeBlock('robotforge cad ' + filename) + '</li>' +
      '<li><strong>Gate report</strong><span>Needs Gazebo Sim on your ' +
      'machine.</span>' + codeBlock('robotforge run-gate ' + filename) +
      '</li></ul>');
    const btn = el.querySelector('[data-dl]');
    if (btn) {
      btn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(spec, null, 2) + '\n'],
          { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      });
    }
    return el;
  }

  /* Take-apart stage: reuses robot.js's spec-driven geometry
   * (taBuildParts / taRenderSide / taRenderTop — the same builders
   * the robot pages use), scoped to this thread card. */
  function viewerStage(spec) {
    const el = stage('local', 'drawn in your browser from the spec',
      'Take-apart viewer',
      '<div class="fv">' +
      '<div class="ta-controls"><label for="">Explode</label>' +
      '<input type="range" class="fv-explode" min="0" max="60" ' +
      'value="20" step="1"><output>20 mm</output></div>' +
      '<div class="fv-side"></div><div class="fv-top"></div>' +
      '<aside class="card fv-detail"><h3>Pick a part</h3>' +
      '<p class="muted" style="font-size:var(--fs-sm);margin-top:8px">' +
      'Click any part in either view to see what it is and its key ' +
      'dimensions from the spec.</p></aside></div>');
    const wrap = el.querySelector('.fv');
    const slider = el.querySelector('.fv-explode');
    const out = el.querySelector('output');
    function render() {
      /* robot.js's builders read these globals; set them per render
       * (electrical overlay stays off in the thread). */
      taExplode = Number(slider.value);
      taSelected = null; taElec = false; taPower = false;
      const built = taBuildParts(spec);
      wrap.querySelector('.fv-side').innerHTML =
        taRenderSide(spec, built.parts, built.pos);
      wrap.querySelector('.fv-top').innerHTML =
        taRenderTop(spec, built.parts, built.pos);
      wrap.querySelectorAll('.part-shape').forEach(g => {
        g.addEventListener('click', () => {
          const p = built.parts.find(x => x.id === g.dataset.part);
          if (p) showPart(wrap, spec, p);
        });
      });
    }
    slider.addEventListener('input', () => {
      out.textContent = slider.value + ' mm';
      render();
    });
    render();
    return el;
  }
  function showPart(wrap, spec, p) {
    wrap.querySelectorAll('.part-shape').forEach(g =>
      g.classList.toggle('sel', g.dataset.part === p.id));
    const spot = TA_SPOTS.includes(p.id)
      ? '<img class="spot" src="' + ROOT + 'assets/img/parts/' + p.id +
        '.jpg" alt="AI illustration of the ' + esc(p.name) +
        '" loading="lazy"><p class="faint" style="font-size:12px;' +
        'margin-top:6px">AI illustration (muse-image-1.0). The ' +
        'printable part itself comes from <code>robotforge cad</code>.</p>'
      : '';
    wrap.querySelector('.fv-detail').innerHTML =
      '<span class="qty">Qty ' + p.qty + ' · ' + esc(p.file) + '</span>' +
      '<h3>' + esc(p.name) + '</h3>' + spot +
      '<dl><dt>What it is</dt><dd>' + esc(p.does) + '</dd>' +
      '<dt>Key dimensions</dt><dd class="m">' + esc(p.dims) + '</dd>' +
      '<dt>Beginner tweak</dt><dd>' + esc(p.tweak) + '</dd>' +
      '<dt>Print note</dt><dd>' + esc(p.print) + '</dd></dl>';
  }
  /* Wiring stage: the same wiring & cabling view as the robot
   * pages (wiring.js), mounted in the thread when the spec carries
   * a documented wiring block. Without one, a plain note — no
   * harness is invented for a spec that does not document one. */
  function wiringStage(spec) {
    if (!spec.wiring) {
      note('<strong>Wiring:</strong> no wiring documented in this ' +
        'spec, so there is no harness to draw \u2014 the wiring view ' +
        'needs a documented <code>wiring</code> block, and none is ' +
        'invented here.');
      return;
    }
    if (!window.RFWiring) return;
    const el = stage('local', 'drawn in your browser from the spec',
      'Wiring & cabling', '<div class="fv-wiring"></div>');
    window.RFWiring.mountInto(el.querySelector('.fv-wiring'), spec);
  }
  function specPipeline(spec, filename) {
    const res = checksStage(spec);
    if (!res.schemaErrors) {
      viewerStage(spec);
      wiringStage(spec);
    }
    gateNote();
    outputsStage(spec, filename);
    return res;
  }

  /* ---------------- recorded sample replay ---------------- */
  async function playSample(id) {
    const run = RUNS.find(r => r.id === id);
    if (!run) return;
    userHTML('<span class="faint">Sample run:</span> ' + esc(run.tab) +
      ' — ' + esc(run.meta));
    let data;
    try {
      data = await loadRun(run);
    } catch (e) {
      note('The recorded files for this run couldn\u2019t be loaded ' +
        'from this site, so there is nothing real to show. Nothing ' +
        'is simulated in their place.');
      return;
    }
    const names = run.names || STEP_NAMES;
    const dateLabel = run.meta.split('·')[0].trim();
    run.steps(data).forEach((st, i) => {
      const el = stage('recorded', dateLabel,
        names[i] + ' — ' + st.h,
        '<p class="intro">' + esc(st.intro) + '</p>' + st.body);
      if (st.after) st.after();
    });
  }
  function sampleOffer(id, label) {
    const d = note('<button class="btn btn-sm" type="button" ' +
      'data-sample="' + id + '">' + esc(label) + '</button>');
    return d;
  }

  /* ---------------- input flows ---------------- */
  function fileChip(kindLabel, file) {
    const kb = Math.max(1, Math.round(file.size / 1024));
    return '<span class="faint">' + esc(kindLabel) + ':</span> ' +
      esc(file.name) + ' <span class="faint">(' + kb + ' KB)</span>';
  }

  async function runText(text) {
    userText(text);
    const h = await liveHealth();
    if (routeOn(h, 'describe')) {
      const card = stage('live', 'real call through the live endpoint',
        'Describe — drafting your spec',
        workingBody('Your description is with the model.'));
      const timer = startTimer(card.querySelector('.elapsed'));
      try {
        const body = await postJSON('/describe', { description: text });
        const secs = timer.stop();
        setStageBody(card,
          '<p class="intro">The model drafted this spec in ' + secs +
          ' s. It fills a strict engineering schema; everything ' +
          'downstream is deterministic.</p>' +
          '<div class="card" style="padding:4px 20px">' +
          specTable(body.spec) + '</div>' +
          rawJSON(body.spec, 'Spec JSON as returned'));
        specPipeline(body.spec, 'described-robot.json');
      } catch (e) {
        timer.stop();
        setStageBody(card,
          '<div class="callout bad"><span><strong>The live call ' +
          'failed:</strong> ' + esc(e.message) + '</span></div>' +
          '<p class="intro">Nothing was recorded. The recorded Words ' +
          'run still shows the shape of a run:</p>');
        sampleOffer('words', 'Play the recorded Words run');
      }
      return;
    }
    note('<strong>Live describe didn\u2019t run:</strong> ' +
      liveOffReason(h, 'describe') + '. Your text wasn\u2019t sent ' +
      'anywhere. Here is the recorded Words run instead — it replays ' +
      'its own recorded description, not yours:');
    await playSample('words');
  }

  async function runSpec(file) {
    userHTML(fileChip('Spec file', file));
    let text;
    try {
      text = await file.text();
    } catch (e) {
      note('That file couldn\u2019t be read in the browser. Nothing ' +
        'was uploaded.');
      return;
    }
    let spec;
    try {
      spec = JSON.parse(text);
    } catch (e) {
      stage('local', 'parsed in your browser', 'Spec file',
        '<div class="callout bad"><span><strong>Not valid JSON:</strong> ' +
        esc(e.message) + '</span></div>' +
        '<p class="intro">The file was read only in your browser and ' +
        'sent nowhere.</p>');
      return;
    }
    const res = forgeValidateSpec(spec);
    if (res.schemaErrors) {
      stage('local', 'parsed in your browser',
        'Spec file — ' + (spec && spec.name ? esc(spec.name) : 'unnamed'),
        '<p class="intro">Parsed in your browser. It doesn\u2019t ' +
        'carry the fields a RobotForge spec needs, so there is ' +
        'nothing honest to draw yet:</p>' + findings(res.lines) +
        rawJSON(spec, 'What was in the file'));
      return;
    }
    specStage(spec, 'local', 'parsed in your browser',
      'Spec — ' + spec.name);
    specPipeline(spec, 'uploaded-spec.json');
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error || new Error('read failed'));
      r.readAsDataURL(file);
    });
  }
  function downscale(dataUrl, maxDim) {
    /* A photo data URL can be megabytes; the live endpoint caps
     * request bodies, and a vision model doesn't need 24 MP. */
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale >= 1) { resolve(dataUrl); return; }
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  /* A photo attach asks what the photo IS before anything is sent:
   * a robot photo is drafted from appearance (ESTIMATED); a spec
   * sheet or blueprint is transcribed (DOCUMENT-READ). */
  function choosePhotoMode() {
    return new Promise(resolve => {
      const d = note('<p><strong>What is this a photo of?</strong></p>' +
        '<p class="intro">A <strong>robot photo</strong> is drafted ' +
        'from appearance — every dimension an estimate. A <strong>' +
        'spec sheet or blueprint</strong> is transcribed — only the ' +
        'printed values, never inferred from drawing scale.</p>' +
        '<p><button class="btn btn-sm" type="button" ' +
        'data-pmode="robot">Robot photo</button> ' +
        '<button class="btn btn-sm" type="button" ' +
        'data-pmode="document">Spec sheet or blueprint</button></p>');
      d.querySelectorAll('[data-pmode]').forEach(b => {
        b.addEventListener('click', () => {
          d.querySelectorAll('[data-pmode]').forEach(x => {
            x.disabled = true;
          });
          resolve(b.dataset.pmode);
        });
      });
    });
  }

  /* Plain-words table for a possibly PARTIAL spec (document drafts
   * may carry only what the document printed): lists what is
   * present and nothing else. specTable() assumes completeness. */
  function docSpecTable(spec) {
    const rows = [];
    const has = k => spec[k] !== undefined && spec[k] !== null;
    if (has('name')) rows.push(['Name', spec.name]);
    if (has('drivetrain')) rows.push(['Drivetrain', spec.drivetrain]);
    const dims = [];
    if (has('length_m')) dims.push('L ' + mm(spec.length_m) + ' mm');
    if (has('width_m')) dims.push('W ' + mm(spec.width_m) + ' mm');
    if (has('height_m')) dims.push('H ' + mm(spec.height_m) + ' mm');
    if (dims.length) rows.push(['Size', dims.join(' × ')]);
    if (has('mass_kg')) rows.push(['Mass', spec.mass_kg + ' kg']);
    if (has('ground_clearance_m')) {
      rows.push(['Ground clearance', mm(spec.ground_clearance_m) + ' mm']);
    }
    if (spec.wheel && typeof spec.wheel === 'object') {
      const w = spec.wheel;
      const bits = [];
      if (w.count != null) bits.push(w.count + ' ×');
      if (w.diameter_m != null) bits.push(mm(w.diameter_m) + ' mm');
      if (w.width_m != null) bits.push(mm(w.width_m) + ' mm wide');
      if (bits.length) rows.push(['Wheels', bits.join(' ')]);
    }
    if (spec.motor && typeof spec.motor === 'object') {
      const m = spec.motor;
      const bits = [];
      if (m.count != null) bits.push(m.count + ' ×');
      if (m.kind) bits.push(String(m.kind).replace(/_/g, ' '));
      if (m.voltage_v != null) bits.push(m.voltage_v + ' V');
      if (bits.length) rows.push(['Motors', bits.join(' ')]);
    }
    if (spec.battery && typeof spec.battery === 'object') {
      const b = spec.battery;
      const bits = [];
      if (b.chemistry) bits.push(b.chemistry);
      if (b.voltage_v != null) bits.push(b.voltage_v + ' V');
      if (b.capacity_mah != null) bits.push(b.capacity_mah + ' mAh');
      if (bits.length) rows.push(['Battery', bits.join(' ')]);
    }
    if (Array.isArray(spec.sensors) && spec.sensors.length) {
      rows.push(['Sensors', spec.sensors.map(s =>
        String(s.kind).replace(/_/g, ' ') + ' (' + s.position + ')'
      ).join(', ')]);
    }
    if (!rows.length) {
      return '<p class="intro">The draft carries no spec fields.</p>';
    }
    return '<table class="kv">' + rows.map(([k, v]) =>
      '<tr><th>' + esc(k) + '</th><td>' + esc(v) + '</td></tr>'
    ).join('') + '</table>';
  }

  function renderDocDraft(card, draft, secs) {
    const spec = draft.spec || {};
    const vals = (draft.values || []).map(v =>
      '<li><span class="title">' + esc(v.label) + ': <strong>' +
      esc(v.printed) + '</strong></span><span class="faint">→ ' +
      esc(v.field) + '</span></li>').join('');
    const complete = !forgeValidateSpec(spec).schemaErrors;
    setStageBody(card,
      '<span class="docd">Document draft — values transcribed from ' +
      'the document; verify against the source</span>' +
      '<p class="intro" style="margin-top:10px">Transcribed in ' +
      secs + ' s. Identity, as printed: <strong>' +
      esc(draft.identity_guess || 'unknown document') + '</strong>.</p>' +
      (vals
        ? '<div class="eyebrow">Transcribed values (as printed → ' +
          'spec field)</div><ul class="items">' + vals + '</ul>'
        : '<p class="intro">The model reported no transcribed ' +
          'values.</p>') +
      ((draft.dropped && draft.dropped.length)
        ? '<div class="callout warn"><span><strong>Dropped as unbacked:</strong> ' +
          draft.dropped.map(esc).join(', ') +
          ' — numbers the model put in the spec with no printed ' +
          'value behind them were removed.</span></div>'
        : '') +
      '<div class="card" style="padding:4px 20px">' +
      (complete ? specTable(spec) : docSpecTable(spec)) + '</div>' +
      rawJSON(spec, 'Draft spec JSON as transcribed'));
    if (complete) {
      specPipeline(spec, 'document-draft.json');
      return;
    }
    const missing = ['name', 'drivetrain', 'length_m', 'width_m',
      'height_m', 'mass_kg', 'ground_clearance_m', 'wheel', 'motor',
      'battery'].filter(k => !(k in spec));
    const d = note('<strong>Partial draft:</strong> the document ' +
      'didn\u2019t print everything a complete spec needs (missing: ' +
      missing.map(esc).join(', ') + '). The absent fields were left ' +
      'absent — document mode never fills a value in — so the checks ' +
      'and viewer wait until the draft is complete.');
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.type = 'button';
    btn.textContent = 'Download the partial draft JSON';
    btn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(spec, null, 2) + '\n'],
        { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'document-draft-partial.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    d.appendChild(btn);
  }

  async function runPhotoDocument(file, noteText, dataUrl) {
    const h = await liveHealth();
    if (!routeOn(h, 'photo')) {
      note('<strong>Your document was not read:</strong> document ' +
        'transcription needs the live endpoint, and ' +
        liveOffReason(h, 'photo') + '. The image above exists only ' +
        'in this thread, in your browser — it was sent nowhere. ' +
        'The recorded document run shows what a transcription ' +
        'produces:');
      sampleOffer('document', 'Play the recorded document run');
      return;
    }
    const card = stage('live', 'real call through the live endpoint',
      'Document draft — transcribing the printed values',
      workingBody('Your document photo (downscaled in your browser ' +
        'first) is with the vision model, which transcribes printed ' +
        'values only.'));
    const timer = startTimer(card.querySelector('.elapsed'));
    try {
      const small = await downscale(dataUrl, 1024);
      const body = await postJSON('/photo', {
        image_data_url: small,
        mode: 'document',
        note: noteText || undefined,
      });
      const secs = timer.stop();
      renderDocDraft(card, body.draft, secs);
    } catch (e) {
      timer.stop();
      setStageBody(card,
        '<div class="callout bad"><span><strong>The live document ' +
        'call failed:</strong> ' + esc(e.message) + '</span></div>' +
        '<p class="intro">Your image was not stored anywhere. The ' +
        'recorded document run still shows the shape of a ' +
        'transcription:</p>');
      sampleOffer('document', 'Play the recorded document run');
    }
  }

  async function runPhoto(file, noteText) {
    let dataUrl;
    try {
      dataUrl = await readAsDataURL(file);
    } catch (e) {
      note('That photo couldn\u2019t be read in the browser. Nothing ' +
        'was uploaded.');
      return;
    }
    const url = URL.createObjectURL(file);
    userHTML('<figure class="photo-in"><img src="' + url +
      '" alt="Your attached photo"></figure>' +
      (noteText ? '<p>' + esc(noteText) + '</p>' : ''));
    const mode = await choosePhotoMode();
    if (mode === 'document') {
      await runPhotoDocument(file, noteText, dataUrl);
      return;
    }
    const h = await liveHealth();
    if (!routeOn(h, 'photo')) {
      note('<strong>Your photo was not processed:</strong> photo ' +
        'drafting needs the live endpoint, and ' +
        liveOffReason(h, 'photo') + '. The photo above exists only ' +
        'in this thread, in your browser — it was sent nowhere. ' +
        'The recorded photo run shows what a photo draft looks like ' +
        '(the TurtleBot example, a SAMPLE):');
      sampleOffer('photo', 'Play the recorded photo run (SAMPLE)');
      return;
    }
    const card = stage('live', 'real call through the live endpoint',
      'Photo draft — the vision model reads your photo',
      workingBody('Your photo (downscaled in your browser first) is ' +
        'with the vision model.'));
    const timer = startTimer(card.querySelector('.elapsed'));
    try {
      const small = await downscale(dataUrl, 1024);
      const body = await postJSON('/photo', {
        image_data_url: small,
        note: noteText || undefined,
      });
      const secs = timer.stop();
      const draft = body.draft;
      const parts = (draft.visible_parts || []).map(p =>
        '<li><strong>' + esc(p.kind) + '</strong> ×' + p.count +
        (p.position ? ' — ' + esc(p.position) : '') +
        (p.notes ? ' <span class="faint">' + esc(p.notes) + '</span>' : '') +
        '</li>').join('');
      setStageBody(card,
        '<span class="est">Estimated, not measured — every dimension ' +
        'in a photo draft is an estimate</span>' +
        '<p class="intro" style="margin-top:10px">Drafted in ' + secs +
        ' s. Identity guess: <strong>' + esc(draft.identity_guess) +
        '</strong>.</p>' +
        (parts ? '<div class="eyebrow">Parts the model could see</div>' +
          '<ul class="items">' + parts + '</ul>' : '') +
        '<div class="card" style="padding:4px 20px">' +
        specTable(draft.spec) + '</div>' +
        rawJSON(draft.spec, 'Draft spec JSON'));
      specPipeline(draft.spec, 'photo-draft.json');
    } catch (e) {
      timer.stop();
      setStageBody(card,
        '<div class="callout bad"><span><strong>The live photo call ' +
        'failed:</strong> ' + esc(e.message) + '</span></div>' +
        '<p class="intro">Your photo was not stored anywhere. The ' +
        'recorded photo run still shows the shape of a draft:</p>');
      sampleOffer('photo', 'Play the recorded photo run (SAMPLE)');
    }
  }

  async function runDoc(file, noteText) {
    let text;
    try {
      text = await file.text();
    } catch (e) {
      note('That file couldn\u2019t be read in the browser. Nothing ' +
        'was uploaded.');
      return;
    }
    userHTML(fileChip('Parts list', file) +
      '<pre class="paste">' + esc(text.slice(0, 1500)) + '</pre>' +
      (noteText ? '<p>' + esc(noteText) + '</p>' : ''));
    const h = await liveHealth();
    if (!routeOn(h, 'list')) {
      note('<strong>Your list was not imported:</strong> list import ' +
        'runs on the live model, and ' + liveOffReason(h, 'list') +
        '. Your list stayed in your browser. The recorded list run ' +
        'shows what an import produces:');
      sampleOffer('list', 'Play the recorded parts-list run');
      return;
    }
    const card = stage('live', 'real call through the live endpoint',
      'Parts list — importing with the live model',
      workingBody('Your list is with the model, which matches its ' +
        'lines against the site\u2019s parts catalogue.'));
    const timer = startTimer(card.querySelector('.elapsed'));
    try {
      const body = await postJSON('/list', { text });
      const secs = timer.stop();
      const imp = body.import;
      const names = {};
      const items = imp.items.map(it =>
        '<li><span class="slotname' + (it.matched_part_id ? '' : ' none') +
        '">' + esc(it.matched_part_id || 'no catalogue match') + '</span>' +
        '<span class="qty">×' + it.qty + '</span>' +
        '<span class="title">' + esc(it.title) + '</span></li>').join('');
      setStageBody(card,
        '<p class="intro">Imported in ' + secs + ' s. ' +
        '<strong>Model-generated import</strong> — the deterministic ' +
        'importer remains the CLI\u2019s (<code>robotforge ' +
        'import-list</code>); a line with no catalogue match says so ' +
        'rather than being dropped.</p>' +
        '<ul class="items">' + items + '</ul>' +
        (imp.missing.length
          ? '<div class="card"><div class="eyebrow">Still missing</div>' +
            '<ul class="outputs" style="margin-top:12px">' +
            imp.missing.map(m => '<li><strong>' + esc(m) +
              '</strong></li>').join('') + '</ul></div>'
          : '') +
        (imp.wiring.length
          ? '<div class="card"><div class="eyebrow">Suggested wiring</div>' +
            '<ul class="wires" style="margin-top:12px">' +
            imp.wiring.map(c => '<li><b>' + esc(c.from) +
              '</b><span class="via">→ ' + esc(c.via) + ' →</span><b>' +
              esc(c.to) + '</b><p>' + esc(c.note) + '</p></li>').join('') +
            '</ul></div>'
          : '') +
        (body.draft_note
          ? '<div class="callout warn"><span>' + esc(body.draft_note) +
            '</span></div>'
          : ''));
      if (imp.draft_spec) {
        note('The import also drafted a spec from those parts — it ' +
          'goes through the same browser checks and viewer as an ' +
          'uploaded spec:');
        specStage(imp.draft_spec, 'live', 'drafted by the live model',
          'Draft spec — ' + imp.draft_spec.name);
        specPipeline(imp.draft_spec, 'list-draft.json');
      }
    } catch (e) {
      timer.stop();
      setStageBody(card,
        '<div class="callout bad"><span><strong>The live import ' +
        'failed:</strong> ' + esc(e.message) + '</span></div>' +
        '<p class="intro">The recorded list run still shows what an ' +
        'import produces:</p>');
      sampleOffer('list', 'Play the recorded parts-list run');
    }
  }

  /* ---------------- scan (.ply) flow ----------------
   * Entirely LOCAL: assets/js/scan.js parses and measures the cloud
   * in this browser; nothing is uploaded, live endpoint or not. */
  const SCAN_GUIDANCE =
    '<p><strong>Making a .ply:</strong> with an Intel RealSense, ' +
    'open RealSense Viewer, record, and export a PLY point cloud. ' +
    'On a phone, Scaniverse and Polycam export .ply; on a computer, ' +
    'Meshroom builds one from a photo set by photogrammetry. ' +
    'However you made it: <strong>depth scans arrive measured; ' +
    'photos arrive estimated</strong> — which is why the forge ' +
    'treats them differently. A SAM 3D export is a reconstruction ' +
    'from a single photo, not a scan; the forge detects it and ' +
    'reports it as reconstructed and estimated.</p>';

  function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2) + '\n'],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function seedFromScan(measure, fileName) {
    const e = measure.extentsM;
    const r4 = v => Math.round(v * 10000) / 10000;
    const spec = {
      name: 'scan-draft',
      description: 'Seeded from a point-cloud scan (' + fileName +
        '): geometry MEASURED from the scan bounding box, file axes ' +
        'as stored (x \u2192 length, y \u2192 width, z \u2192 height). ' +
        'Everything else is still to fill in \u2014 a scan cannot ' +
        'measure mass, motors or voltage.',
      length_m: r4(e[0]), width_m: r4(e[1]), height_m: r4(e[2]),
    };
    const el = stage('local', 'seeded in your browser from the scan',
      'Draft spec — seeded from the scan',
      '<p class="intro">Geometry only, prefilled from the ' +
      'measurement above (provenance: scan). Still needed before ' +
      'the browser checks can run: <strong>drivetrain, mass_kg, ' +
      'ground_clearance_m, wheel, motor, battery</strong>. This ' +
      'partial spec has <strong>not</strong> been run through the checks ' +
      'as if it were complete.</p>' +
      '<div class="card" style="padding:4px 20px">' +
      docSpecTable(spec) + '</div>' + rawJSON(spec, 'Seeded draft JSON') +
      '<p><button class="btn btn-sm" type="button" data-dl-seed>' +
      'Download the seeded draft</button></p>');
    el.querySelector('[data-dl-seed]').addEventListener('click', () =>
      downloadJSON(spec, 'scan-draft.json'));
  }

  /* A Gaussian-splat .ply (SAM 3D and similar single-photo tools)
   * is a RECONSTRUCTION, not a scan: a model inferred the shape from
   * one photo and invented every surface the camera never saw. It is
   * parsed and boxed locally exactly like a scan, but the card wears
   * RECONSTRUCTED (single photo), the extents are reported in the
   * file's own relative units as ESTIMATED, and — unlike a scan —
   * it never seeds a draft spec: there is no real-world scale in
   * the file to seed from. */
  function runReconstruction(rs, parsed) {
    const measure = rs.measureReconstruction(parsed.positions);
    if (!measure.ok) {
      stage('local', 'parsed in your browser',
        'Reconstruction — no size to report',
        '<p class="intro"><strong>' +
        measure.count.toLocaleString('en-US') +
        ' reconstructed points</strong> were read, but no size is ' +
        'reported: ' + esc(measure.reason) + '. The raw extents are ' +
        measure.rawExtents.map(v => String(Math.round(v * 1000) / 1000)).join(' × ') +
        ' in the file\u2019s own units — shown as-is.</p>');
      return;
    }
    const e = measure.extents;
    const fmt = v => v.toFixed(3) + ' file units';
    const el = stage('local', 'parsed in your browser just now',
      'Reconstruction — RECONSTRUCTED (single photo)',
      '<p class="intro"><strong>' + parsed.count.toLocaleString('en-US') +
      ' points</strong> (' + esc(parsed.format) + ' PLY). This file ' +
      'is a <strong>Gaussian-splat reconstruction</strong> — the ' +
      'export shape of SAM 3D and similar single-photo tools: a ' +
      'model inferred this shape from one photo. Method: ' +
      '<strong>bounding box of the reconstructed points</strong> — ' +
      'the extents below are the reconstruction\u2019s axis-aligned ' +
      'size, axes as stored in the file (x \u2192 length, ' +
      'y \u2192 width, z \u2192 height).</p>' +
      '<div class="callout"><span>Unit note: ' + esc(measure.unitNote) +
        '.</span></div>' +
      '<table class="kv">' +
      '<tr><th>Length (x)</th><td>' + fmt(e[0]) + '</td></tr>' +
      '<tr><th>Width (y)</th><td>' + fmt(e[1]) + '</td></tr>' +
      '<tr><th>Height (z)</th><td>' + fmt(e[2]) + '</td></tr></table>' +
      '<div class="scan-view"></div>' +
      '<p class="faint scan-view-note">Drawing the points\u2026</p>' +
      '<div class="callout warn"><span>A reconstruction is ' +
      '<strong>not a measurement</strong>: these dimensions are ' +
      '<strong>ESTIMATED</strong> — relative shape only. Unlike a ' +
      'depth scan, this file does <strong>not</strong> seed a draft ' +
      'spec, because it carries no real-world scale. Real ' +
      'dimensions come from a depth scan (MEASURED (scan)), a ' +
      'document (DOCUMENT-READ), or a description.</span></div>');
    const host = el.querySelector('.scan-view');
    const vnote = el.querySelector('.scan-view-note');
    rs.renderPoints(host, parsed, measure).then(info => {
      vnote.textContent = 'Reconstruction preview — drag to orbit, ' +
        'scroll to zoom' + (info.shown < info.total
          ? ' (drawing ' + info.shown.toLocaleString('en-US') +
            ' of ' + info.total.toLocaleString('en-US') + ' points)'
          : '') + '. Drawn from your file, in this browser.';
    }).catch(() => {
      vnote.textContent = 'The 3D preview isn\u2019t available in ' +
        'this browser — the extents above don\u2019t depend on it.';
      host.remove();
    });
  }

  async function runScan(file) {
    userHTML(fileChip('Scan (.ply)', file));
    note(SCAN_GUIDANCE);
    let buf;
    try {
      buf = await file.arrayBuffer();
    } catch (e) {
      note('That file couldn\u2019t be read in the browser. Nothing ' +
        'was uploaded.');
      return;
    }
    let rs = window.RFScan;
    for (let i = 0; !rs && i < 30; i++) {
      await new Promise(r => setTimeout(r, 100));
      rs = window.RFScan;
    }
    if (!rs) {
      note('<strong>The scan module didn\u2019t load</strong>, so ' +
        'the file can\u2019t be measured here. It was read only in ' +
        'your browser and sent nowhere.');
      return;
    }
    let parsed;
    try {
      parsed = rs.parsePly(buf);
    } catch (e) {
      stage('local', 'parsed in your browser', 'Scan — not readable',
        '<div class="callout bad"><span><strong>' + esc(e.message) +
        '</strong></span></div><p class="intro">The file was read ' +
        'only in your browser and sent nowhere.</p>');
      return;
    }
    if (parsed.kind === 'splat') {
      runReconstruction(rs, parsed);
      return;
    }
    let measure;
    try {
      measure = rs.measureCloud(parsed.positions);
    } catch (e) {
      stage('local', 'parsed in your browser', 'Scan — not readable',
        '<div class="callout bad"><span><strong>' + esc(e.message) +
        '</strong></span></div><p class="intro">The file was read ' +
        'only in your browser and sent nowhere.</p>');
      return;
    }
    if (!measure.ok) {
      stage('local', 'measured in your browser', 'Scan — implausible size',
        '<p class="intro"><strong>' + measure.count.toLocaleString('en-US') +
        ' points</strong> were read, but no size is reported: ' +
        esc(measure.reason) + '. The raw extents are ' +
        measure.rawExtents.map(v => String(Math.round(v * 1000) / 1000)).join(' × ') +
        ' in the file\u2019s own units — shown as-is, not rescaled ' +
        'into a plausible-looking answer.</p>');
      return;
    }
    const e = measure.extentsM;
    const fmt = v => v.toFixed(3) + ' m (' + Math.round(v * 1000) + ' mm)';
    const el = stage('local', 'measured in your browser just now',
      'Scan — MEASURED (scan)',
      '<p class="intro"><strong>' + parsed.count.toLocaleString('en-US') +
      ' points</strong> (' + esc(parsed.format) + ' PLY). Method: ' +
      '<strong>bounding box of the uploaded point cloud</strong> — ' +
      'the extents below are the cloud\u2019s axis-aligned size, ' +
      'axes as stored in the file (x \u2192 length, y \u2192 width, ' +
      'z \u2192 height).</p>' +
      (measure.unitNote
        ? '<div class="callout"><span>Unit note: ' + esc(measure.unitNote) +
          '.</span></div>'
        : '') +
      '<table class="kv">' +
      '<tr><th>Length (x)</th><td>' + fmt(e[0]) + '</td></tr>' +
      '<tr><th>Width (y)</th><td>' + fmt(e[1]) + '</td></tr>' +
      '<tr><th>Height (z)</th><td>' + fmt(e[2]) + '</td></tr></table>' +
      '<div class="scan-view"></div>' +
      '<p class="faint scan-view-note">Drawing the points\u2026</p>' +
      '<div class="callout warn"><span>A scan gives <strong>' +
      'shape and size only</strong> — mass, motors and voltage ' +
      'can\u2019t come from a scan, so those fields stay empty ' +
      'until a document or a description provides them.</span></div>' +
      '<p><button class="btn btn-sm" type="button" data-seed>' +
      'Seed a draft spec with these dimensions</button></p>');
    const host = el.querySelector('.scan-view');
    const vnote = el.querySelector('.scan-view-note');
    rs.renderPoints(host, parsed, measure).then(info => {
      vnote.textContent = 'Point cloud preview — drag to orbit, ' +
        'scroll to zoom' + (info.shown < info.total
          ? ' (drawing ' + info.shown.toLocaleString('en-US') +
            ' of ' + info.total.toLocaleString('en-US') + ' points)'
          : '') + '. Drawn from your file, in this browser.';
    }).catch(() => {
      vnote.textContent = 'The 3D preview isn\u2019t available in ' +
        'this browser — the measurements above don\u2019t depend on it.';
      host.remove();
    });
    el.querySelector('[data-seed]').addEventListener('click', () =>
      seedFromScan(measure, file.name));
  }

  /* ---------------- composer ---------------- */
  const attachRow = document.getElementById('attach-row');
  const attachChip = document.getElementById('attach-chip');
  let attach = null; // { kind: 'photo'|'doc'|'spec'|'scan', file }
  let busy = false;

  function setAttach(kind, file) {
    attach = file ? { kind, file } : null;
    if (!file) {
      attachRow.hidden = true;
      return;
    }
    const label = kind === 'photo' ? 'Photo' :
      kind === 'doc' ? 'Parts list' :
      kind === 'scan' ? 'Scan (.ply)' : 'Spec file';
    attachChip.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = label + ': ' + file.name;
    attachChip.appendChild(span);
    attachRow.hidden = false;
  }
  const fileInputs = {
    photo: document.getElementById('file-photo'),
    doc: document.getElementById('file-doc'),
    spec: document.getElementById('file-spec'),
    scan: document.getElementById('file-scan'),
  };
  document.getElementById('att-photo')
    .addEventListener('click', () => fileInputs.photo.click());
  document.getElementById('att-doc')
    .addEventListener('click', () => fileInputs.doc.click());
  document.getElementById('att-spec')
    .addEventListener('click', () => fileInputs.spec.click());
  document.getElementById('att-scan')
    .addEventListener('click', () => fileInputs.scan.click());
  for (const kind of Object.keys(fileInputs)) {
    fileInputs[kind].addEventListener('change', ev => {
      const f = ev.target.files && ev.target.files[0];
      if (f) setAttach(kind, f);
      ev.target.value = '';
    });
  }
  document.getElementById('attach-clear')
    .addEventListener('click', () => setAttach(null, null));

  document.querySelectorAll('[data-sample]').forEach(b => {
    if (b.closest('.forge-samples')) {
      b.addEventListener('click', () => { if (!busy) playSample(b.dataset.sample); });
    }
  });
  thread.addEventListener('click', ev => {
    const b = ev.target.closest('[data-sample]');
    if (b && !busy) playSample(b.dataset.sample);
  });

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (busy) return;
    const text = input.value.trim();
    const a = attach;
    if (!a && !text) return;
    busy = true;
    try {
      if (a && a.kind === 'spec') await runSpec(a.file);
      else if (a && a.kind === 'photo') await runPhoto(a.file, text);
      else if (a && a.kind === 'doc') await runDoc(a.file, text);
      else if (a && a.kind === 'scan') await runScan(a.file);
      else await runText(text);
    } finally {
      busy = false;
      setAttach(null, null);
      input.value = '';
      input.focus();
    }
  });
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });

  /* ---------------- init ---------------- */
  note('<p><strong>Welcome to the Forge.</strong> Type a robot ' +
    'description, or attach a photo, a parts list, a spec file, ' +
    'or a .ply scan. Spec files are checked and drawn entirely in ' +
    'your browser, and scans are measured right here; photo and ' +
    'list imports need the live endpoint; the recorded sample ' +
    'runs below always work.</p>');
  (async () => {
    if (!liveBase) {
      statusEl.textContent = 'Recorded + local mode — no live ' +
        'endpoint is configured in this deployment, so nothing you ' +
        'attach leaves your browser. Spec uploads are checked and ' +
        'drawn right here, and scans are measured right here.';
      return;
    }
    statusEl.textContent = 'Checking the live endpoint…';
    const h = await liveHealth();
    if (!h || !h.ok) {
      statusEl.textContent = 'The live endpoint isn\u2019t answering ' +
        '— local spec checks and the recorded samples still work, ' +
        'and live steps will say so plainly if you try one.';
      return;
    }
    if (h.mode === 'off') {
      statusEl.textContent = 'Live mode is switched off at the ' +
        'endpoint — local spec checks and the recorded samples ' +
        'still work.';
      return;
    }
    const bits = [];
    bits.push('describe ' + (routeOn(h, 'describe') ? 'live' : 'off'));
    bits.push('parts list ' + (routeOn(h, 'list') ? 'live' : 'off'));
    bits.push('photo + document ' + (routeOn(h, 'photo') ? 'live' : 'not configured'));
    statusEl.textContent = 'Live endpoint connected — ' +
      bits.join(' · ') + ', plus local spec checks and the ' +
      'recorded samples.' +
      (h.budget && h.budget.exhausted
        ? ' Today\u2019s live budget is used up, so live steps will ' +
          'fall back until tomorrow.'
        : '');
  })();

  /* Old step-walk deep links (#words, #photo, #list, #document) now
   * play the matching recorded sample. */
  const hm = /^#(words|photo|list|document)/.exec(location.hash);
  if (hm) playSample(hm[1]);
})();
