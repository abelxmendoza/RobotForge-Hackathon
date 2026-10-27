'use strict';
/* Forge: one recorded run per input type, walked through the same five
   steps. Every artifact shown is a file in this repository; the text
   around it says what was and was not recorded. */

const STEP_NAMES = ['Input', 'Spec', 'Checks', 'Twin & gate', 'Outputs'];

const RUNS = [
  {
    id: 'words', tab: 'Words',
    meta: 'Recorded Oct 26, 2026 · examples/indoor-delivery-rover.json',
    files: { spec: 'examples/indoor-delivery-rover.json', broken: 'examples/broken-indoor-rover.json',
             reports: 'catalog/gate-reports.json' },
    sub: ['A paragraph', 'Muse Spark', 'All clear', 'Pass', 'URDF, kit'],
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
    sub: ['A photo', 'Estimated', 'All clear', 'Not gated', 'Spec, lookup'],
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
    id: 'list', tab: 'Parts list',
    meta: 'Recorded Oct 27, 2026 · robotforge import-list',
    files: { paste: 'examples/list-import-quad.txt', report: 'examples/list-import-quad.report.json' },
    names: ['Input', 'Parts', 'Assembly', 'Twin & gate', 'Outputs'],
    sub: ['A pasted list', '12 items', '2 missing', 'No gate yet', 'Wiring, shopping'],
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
            '<p class="faint" style="font-size:var(--fs-xs)">The <code>import-list</code> command arrives with <a href="https://github.com/abelxmendoza/RobotForge-Hackathon/pull/1">PR #1 (list import)</a>; this run was recorded from that branch.</p>' +
            codeBlock('robotforge import-list my-list.txt --out report.json') }
      ];
    }
  }
];

const state = { run: null, step: 0, data: {}, steps: null };

function currentRun() { return RUNS.find(r => r.id === state.run); }

async function loadRun(run) {
  if (state.data[run.id]) return state.data[run.id];
  const d = {};
  const f = run.files;
  if (f.spec) d.spec = await fetchJSON(f.spec);
  if (f.reports) d.reports = await fetchJSON(f.reports);
  if (f.paste) d.paste = await fetchText(f.paste);
  if (f.report) d.report = await fetchJSON(f.report);
  if (f.broken) d.broken = [
    '[ERROR] geometry.clearance_vs_wheel: ground clearance 0.060 m exceeds wheel radius 0.050 m — impossible without a lifted chassis design',
    '[WARN] electrical.voltage_match: motor voltage 11.1 V is far below battery 24 V — a regulator is required and was not declared'
  ];
  state.data[run.id] = d;
  return d;
}

function renderTabs() {
  $('#forge-tabs').innerHTML = RUNS.map(r =>
    '<button class="tab" role="tab" type="button" data-run="' + r.id + '" aria-selected="' + (r.id === state.run) + '">' + esc(r.tab) + '</button>').join('');
  $$('#forge-tabs .tab').forEach(b => b.addEventListener('click', () => selectRun(b.dataset.run, 0)));
}

function renderRail() {
  const run = currentRun(), names = run.names || STEP_NAMES;
  $('#forge-rail').innerHTML = names.map((n, i) =>
    '<li><button type="button" data-step="' + i + '" class="' + (i < state.step ? 'done' : '') + '"' +
    (i === state.step ? ' aria-current="step"' : '') + '><span class="dot">' + (i < state.step ? '✓' : i + 1) + '</span>' +
    '<span>' + esc(n) + '<small>' + esc(run.sub[i]) + '</small></span></button></li>').join('');
  $$('#forge-rail [data-step]').forEach(b => b.addEventListener('click', () => go(Number(b.dataset.step))));
  $('#forge-progress').style.width = ((state.step + 1) / names.length * 100) + '%';
}

function renderStep() {
  const run = currentRun(), names = run.names || STEP_NAMES;
  const st = state.steps[state.step], last = state.step === state.steps.length - 1;
  const next = last
    ? (run.id === 'words' ? '<a class="btn btn-primary" href="../evidence/">See all gate reports &rarr;</a>'
                          : '<button class="btn btn-primary" type="button" id="fs-other">Try another input &rarr;</button>')
    : '<button class="btn btn-primary" type="button" id="fs-next">Next: ' + esc(names[state.step + 1]) + ' &rarr;</button>';
  $('#forge-step').innerHTML =
    '<div class="eyebrow">Step ' + (state.step + 1) + ' of ' + names.length + ' · ' + esc(names[state.step]) + '</div>' +
    '<h2>' + esc(st.h) + '</h2><p class="intro">' + esc(st.intro) + '</p>' +
    '<div class="step-body">' + st.body + '</div>' +
    '<div class="step-nav"><button class="btn btn-ghost" type="button" id="fs-prev"' + (state.step === 0 ? ' disabled' : '') + '>&larr; Back</button>' + next + '</div>';
  $('#fs-prev').addEventListener('click', () => go(state.step - 1));
  const n = $('#fs-next'); if (n) n.addEventListener('click', () => go(state.step + 1));
  const o = $('#fs-other'); if (o) o.addEventListener('click', () => {
    const i = RUNS.findIndex(r => r.id === state.run);
    selectRun(RUNS[(i + 1) % RUNS.length].id, 0);
  });
  wireCopy($('#forge-step'));
  if (st.after) st.after();
}

function go(i) {
  if (!state.steps) return;
  state.step = Math.max(0, Math.min(state.steps.length - 1, i));
  history.replaceState(null, '', '#' + state.run + (state.step ? '-' + (state.step + 1) : ''));
  renderRail(); renderStep();
  const card = $('#forge-step');
  if (card.getBoundingClientRect().top < 60) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

let loadSeq = 0;
async function selectRun(id, step) {
  state.run = RUNS.some(r => r.id === id) ? id : RUNS[0].id;
  const run = currentRun(), seq = ++loadSeq;
  renderTabs();
  $('#forge-meta').textContent = run.meta;
  state.steps = null;
  try {
    const data = await loadRun(run);
    if (seq !== loadSeq) return;  // a newer tab was picked while this loaded
    state.steps = run.steps(data);
  } catch (err) {
    if (seq !== loadSeq) return;
    state.steps = null;
    $('#forge-rail').innerHTML = '';
    $('#forge-step').innerHTML = '<div class="state-box">The recorded files for this run couldn’t be loaded from this site, so there is nothing real to show. Nothing is simulated in their place.</div>';
    return;
  }
  go(step || 0);
}

document.addEventListener('keydown', ev => {
  if (ev.target.closest('input, textarea, select')) return;
  if (ev.key === 'ArrowRight') go(state.step + 1);
  if (ev.key === 'ArrowLeft') go(state.step - 1);
});

/* #words, #photo-3 … deep links; replaceState in go() does not fire
   hashchange, so this only reacts to links and back/forward. */
function fromHash() {
  const m = /^#(\w+)(?:-(\d))?$/.exec(location.hash);
  selectRun(m ? m[1] : 'words', m && m[2] ? Number(m[2]) - 1 : 0);
}
addEventListener('hashchange', fromHash);
fromHash();
