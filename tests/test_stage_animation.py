"""Living Build Stage (Layer 0 of the digital-twin path): recorded-
data animation for the Kit stage and the robot take-apart 3D view,
plus the electrical Flow layer.

Three layers, following the repo's node-test pattern:

1. Data tests (pure Python): catalog/stage-animation.json — the
   generated record the capability map reads — carries the pinned
   URDF joints, the spec sensors and the spec wiring verbatim,
   including the awkward cases the honesty rules rest on (the Go2
   calf limits that exclude the zero pose).
2. Static wiring + honesty: the exact labels ship, both surfaces
   mount the shared controls and pass life into their scenes, the
   DPR cap is in the kit scene, and the animation modules make no
   network calls at all (zero Worker budget, demo isolation).
3. Node unit tests: the REAL lib/stageAnimation.ts runs against
   the REAL catalog data — per-robot capability (tracks present /
   absent with reasons), the limit-safety invariant for every sway
   and travel joint of every robot, sensor-overlay drawability,
   placed-part and bench-prop capabilities, flow derivation
   (colors, recorded-voltage pacing, no invented current), the
   read-only rf.wiring.v1 shape parser, and the control gates.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web-next"
LIB = WEB / "src/lib"

HONESTY_LABEL = (
    "Animated preview — motion is illustrative; the functional twin "
    "(physics + controls + telemetry) is the next layer."
)
FLOW_LABEL = (
    "Flow view — shows the recorded design's power/data paths; "
    "not a circuit simulation"
)


# ---------------------------------------------------------------- data

@pytest.fixture(scope="module")
def stage_doc():
    return json.loads((REPO / "catalog/stage-animation.json").read_text())


def test_stage_record_covers_all_eleven_robots(stage_doc):
    robots = stage_doc["robots"]
    assert len(robots) == 11
    for slug in (
        "andino", "turtlebot3-burger", "turtlebot3-waffle-pi", "pathfinder",
        "px4-x500", "crazyflie-2-1", "unitree-go2", "mini-pupper",
        "unitree-g1", "robotis-op3", "openmanipulator-x",
    ):
        assert slug in robots, slug


def test_stage_record_burger_joints_and_wiring(stage_doc):
    burger = stage_doc["robots"]["turtlebot3-burger"]
    joints = {j["name"]: j for j in burger["urdf"]["joints"]}
    assert joints["wheel_left_joint"]["type"] == "continuous"
    assert joints["wheel_right_joint"]["type"] == "continuous"
    # The scan joint is FIXED in the URDF — the lidar sweep is
    # licensed by the spec's lidar_2d sensor entry, never by this.
    assert joints["scan_joint"]["type"] == "fixed"
    wiring = burger["spec"]["wiring"]
    volts = {(c["from"], c["to"], c["kind"]): c.get("volts")
             for c in wiring["connections"]}
    assert volts[("battery", "driver", "power")] == 11.1
    assert volts[("driver", "motors", "power")] == 11.1
    assert volts[("battery", "controller", "power")] is None


def test_stage_record_go2_calf_limits_exclude_zero(stage_doc):
    go2 = stage_doc["robots"]["unitree-go2"]
    calves = [j for j in go2["urdf"]["joints"]
              if j["name"].endswith("_calf_joint")]
    assert len(calves) == 4, "expected the four recorded calf joints"
    for j in calves:
        lim = j["limit"]
        assert lim is not None
        # The recorded range sits entirely below zero: no sway
        # around the zero pose may be derived from these.
        assert not (lim["lower"] < 0 < lim["upper"]), j["name"]
        assert lim["upper"] < -0.8


def test_stage_record_openmanipulator_prismatic_joints(stage_doc):
    om = stage_doc["robots"]["openmanipulator-x"]
    prismatic = [j for j in om["urdf"]["joints"] if j["type"] == "prismatic"]
    assert {j["name"] for j in prismatic} == {
        "gripper_left_joint", "gripper_right_joint"}


def test_extractor_is_the_records_source():
    extractor = (REPO / "tools/extract_stage_animation.py").read_text()
    assert "stage-animation.json" in extractor
    sync = (WEB / "scripts/sync-data.mjs").read_text()
    assert "stage-animation.json" in sync


# ---------------------------------------------------------------- wiring

def test_honesty_labels_ship_verbatim():
    lib = (LIB / "stageAnimation.ts").read_text()
    assert HONESTY_LABEL in lib
    assert FLOW_LABEL in lib
    controls = (WEB / "src/components/kit/StageControls.tsx").read_text()
    assert "STAGE_HONESTY_LABEL" in controls
    assert "FLOW_LABEL" in controls
    assert "prefers reduced motion" in controls


def test_both_surfaces_mount_stage_controls_and_life():
    viewer = (WEB / "src/components/kit/KitViewer.tsx").read_text()
    assert "StageControlsRow" in viewer
    assert "useStageAnimation" in viewer
    assert "life={life}" in viewer
    assert "robotCapability" in viewer
    scene = (WEB / "src/components/kit/KitScene.tsx").read_text()
    assert "KitLife" in scene
    assert "Math.min(window.devicePixelRatio, 2)" in scene
    take = (WEB / "src/components/robots/takeapart/TakeApartViewer.tsx").read_text()
    assert "StageControlsRow" in take
    assert "life={robotLife}" in take
    robot3d = (WEB / "src/components/kit/Robot3D.tsx").read_text()
    assert "RobotLife" in robot3d
    assert "swayAt" in robot3d


def test_animation_modules_make_no_network_calls():
    for name in ("stageAnimation.ts", "useStageAnimation.ts"):
        src = (LIB / name).read_text()
        assert "fetch(" not in src, name
        assert "workers.dev" not in src, name
        assert "XMLHttpRequest" not in src, name
    controls = (WEB / "src/components/kit/StageControls.tsx").read_text()
    assert "fetch(" not in controls
    # The stored-wiring read is read-only: the kit viewer reads the
    # key but never writes any wiring key.
    viewer = (WEB / "src/components/kit/KitViewer.tsx").read_text()
    assert "parseStoredWiringGraph" in viewer
    assert "storedWiringKey" in viewer
    assert "setItem" not in viewer


def test_kit_scene_animates_only_recorded_pieces():
    scene = (WEB / "src/components/kit/KitScene.tsx").read_text()
    # Lidar pivot + sweep, wheel spin registry, board LEDs, flow.
    assert "lidarPivot" in scene
    assert "sweepGroup" in scene
    assert "wheelMeshes" in scene
    assert "driverLedMat" in scene
    assert "buildFlowItems" in scene
    # The sweep layer can never swallow part picking.
    assert "raycast = () => {}" in scene
    # Life never applies to the Real specimen.
    assert "onKit" in scene


# ---------------------------------------------------------------- node units

UNIT_SCRIPT = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = process.argv[2];
const load = p => JSON.parse(fs.readFileSync(root + '/' + p, 'utf8'));
const S = await import('./stageAnimation.ts');
const doc = load('catalog/stage-animation.json');
const parts = load('catalog/parts.json').parts;
const props = load('catalog/props/simready/props.json').props;
const cap = slug => S.robotCapability(doc.robots[slug]);
const kinds = c => c.tracks.map(t => t.kind);

// --- the map across all 11 robots ---
const animated = Object.keys(doc.robots).filter(s => cap(s).tracks.length > 0);
assert.equal(animated.length, 10, 'exactly one catalog robot is fully static');
assert.deepEqual(cap('robotis-op3').tracks, []);
assert.ok(cap('robotis-op3').abstentions.length >= 1);

// wheeled: continuous-joint / driven-wheel spin + lidar sweep
for (const slug of ['turtlebot3-burger', 'turtlebot3-waffle-pi']) {
  assert.ok(kinds(cap(slug)).includes('spin'), slug);
  assert.ok(kinds(cap(slug)).includes('sweep'), slug);
  const ov = cap(slug).overlays.find(o => o.kind === 'lidar_2d');
  assert.equal(ov.drawable, true);
  assert.equal(ov.rangeM, 3.5);
}
assert.ok(kinds(cap('pathfinder')).includes('spin'));
const pfUltra = cap('pathfinder').overlays.find(o => o.kind === 'ultrasonic');
assert.equal(pfUltra.drawable, false); // range recorded, cone angle not
assert.ok(pfUltra.reason.includes('cone angle'));
assert.ok(kinds(cap('andino')).includes('spin'));
assert.equal(cap('andino').overlays.find(o => o.kind === 'lidar_2d').rangeM, 12);
assert.ok(cap('andino').abstentions.length >= 1); // no URDF recorded

// aerial: rotor spin + hover; the rigid-body airframe gains no sway
for (const slug of ['px4-x500', 'crazyflie-2-1']) {
  assert.ok(kinds(cap(slug)).includes('spin'), slug);
  assert.ok(kinds(cap(slug)).includes('hover'), slug);
  assert.ok(!kinds(cap(slug)).includes('sway'), slug);
}

// legged sway: Go2 hips+thighs only — the calves' recorded limits
// exclude the zero pose, so they are named as an abstention.
const go2Sway = cap('unitree-go2').tracks.find(t => t.kind === 'sway');
assert.equal(go2Sway.joints.length, 8);
assert.ok(go2Sway.joints.every(j => !j.name.includes('calf')));
const go2Abst = cap('unitree-go2').abstentions.map(a => a.subject + a.reason).join(' ');
assert.ok(go2Abst.includes('calf'), 'excluded calves are named');
const g1Sway = cap('unitree-g1').tracks.find(t => t.kind === 'sway');
assert.equal(g1Sway.joints.length, 29);
// Mini Pupper's lidar exists on the spec but records no range:
// the sweep track exists (spec sensor), the overlay does not draw.
assert.ok(kinds(cap('mini-pupper')).includes('sweep'));
assert.equal(cap('mini-pupper').overlays.find(o => o.kind === 'lidar_2d').drawable, false);

// the arm: sway within limits + prismatic gripper travel
const om = cap('openmanipulator-x');
assert.equal(om.tracks.find(t => t.kind === 'sway').joints.length, 4);
assert.equal(om.tracks.find(t => t.kind === 'travel').joints.length, 2);

// cameras record no FOV anywhere: no frustum is drawable, ever.
for (const slug of Object.keys(doc.robots)) {
  for (const o of cap(slug).overlays) {
    if (o.kind.includes('camera')) assert.equal(o.drawable, false, slug + ' camera');
  }
}

// --- limit safety: the invariant the whole feature rests on ---
// Applies to the bounded tracks (sway / travel), whose amplitudes
// are derived subsets of recorded limits. Spin tracks are
// continuous by record (their joints carry unbounded limits).
for (const slug of Object.keys(doc.robots)) {
  for (const t of cap(slug).tracks) {
    if (t.kind !== 'sway' && t.kind !== 'travel') continue;
    for (const j of t.joints ?? []) {
      assert.ok(-j.amplitude >= j.lower - 1e-12, slug + ' ' + j.name + ' lower');
      assert.ok(j.amplitude <= j.upper + 1e-12, slug + ' ' + j.name + ' upper');
      assert.ok(j.amplitude <= 0.25 * Math.min(j.upper, -j.lower) + 1e-12,
        slug + ' ' + j.name + ' is a safe subset, not the whole range');
      for (let phase = 0; phase < 6.3; phase += 0.3) {
        const v = S.swayAt(j.amplitude, phase);
        assert.ok(v >= j.lower && v <= j.upper, slug + ' ' + j.name + ' at phase ' + phase);
      }
    }
  }
}
assert.equal(S.safeAmplitude({ type: 'revolute', limit: { lower: -2.72, upper: -0.84 } }), null);
assert.equal(S.safeAmplitude({ type: 'revolute', limit: null }), null);

// --- placed parts ---
const part = id => S.partCapability(parts.find(p => p.id === id));
assert.ok(kinds(part('rplidar_a1')).includes('sweep'));
assert.equal(part('rplidar_a1').overlays.find(o => o.kind === 'lidar_2d').rangeM, 12);
assert.ok(kinds(part('raspberry_pi_5')).includes('blink'));
assert.ok(kinds(part('wheel_100mm')).includes('spin'));
assert.ok(kinds(part('gearmotor_12v')).includes('spin'));
assert.deepEqual(part('servo_mg996r').tracks, []); // no recorded travel range
assert.ok(part('servo_mg996r').abstentions.length >= 1);
assert.equal(part('realsense_d435').overlays[0].drawable, false); // no FOV recorded
assert.equal(part('ultrasonic_hcsr04').overlays[0].drawable, false); // no cone angle

// bench props never animate — the manifest records size/license only
for (const p of props) {
  const c = S.propCapability(p);
  assert.deepEqual(c.tracks, [], p.id);
  assert.ok(c.abstentions[0].reason.includes('no motion data'), p.id);
}

// --- electrical flow: recorded values only ---
const flows = S.flowPaths(doc.robots['turtlebot3-burger']);
assert.equal(flows.length, 6);
const rail = flows.find(f => f.from === 'battery' && f.to === 'driver');
assert.equal(rail.kind, 'power');
assert.equal(rail.volts, 11.1);
assert.equal(rail.color, '#f59e0b');
const unrecorded = flows.find(f => f.from === 'battery' && f.to === 'controller');
assert.equal(unrecorded.volts, null);
assert.ok(rail.pulsePerSec > unrecorded.pulsePerSec,
  'recorded voltage paces the pulse faster than the neutral default');
assert.ok(rail.intensity > unrecorded.intensity);
const pwm = flows.find(f => f.from === 'controller' && f.to === 'driver');
assert.equal(pwm.color, '#38bdf8');
assert.ok(pwm.basis.includes('PWM'));
for (const f of flows) assert.ok(!('amps' in f) && !('current' in f),
  'no current is recorded per connection, so none may appear');
assert.deepEqual(S.flowPaths(doc.robots['unitree-go2']), []); // no wiring recorded

// --- the rf.wiring.v1 shape, read-only and defensive ---
const summary = S.parseStoredWiringGraph({ connections: [
  { fromEntry: 'a', fromPort: 'out', toEntry: 'b', toPort: 'in', type: 'power' },
  { fromEntry: 'b', fromPort: 'pwm', toEntry: 'c', toPort: 'sig', type: 'data' },
  { fromEntry: 'b', fromPort: 'tx', toEntry: 'd', toPort: 'rx', type: 'signal' },
]});
assert.deepEqual(summary, { total: 3, power: 1, data: 1, signal: 1, other: 0 });
assert.equal(S.parseStoredWiringGraph({ connections: [{ fromEntry: 'a' }] }), null);
assert.equal(S.parseStoredWiringGraph(null), null);
assert.equal(S.parseStoredWiringGraph('rf'), null);
assert.equal(S.storedWiringKey(false), 'rf.wiring.v1');
assert.equal(S.storedWiringKey(true), 'rf.wiring.v1.demo');

// --- control gates ---
assert.equal(S.initialControls(true).playing, false); // reduced motion starts paused
assert.equal(S.initialControls(false).playing, true);
const on = S.initialControls(false);
const gate = over => S.effectivePlaying({ controls: on, wiringMode: false, tabHidden: false, onScreen: true, ...over });
assert.equal(gate({}), true);
assert.equal(gate({ wiringMode: true }), false);
assert.equal(gate({ tabHidden: true }), false);
assert.equal(gate({ onScreen: false }), false);
assert.equal(S.effectivePlaying({ controls: { ...on, motion: false }, wiringMode: false, tabHidden: false, onScreen: true }), false);
assert.equal(S.effectivePlaying({ controls: { ...on, playing: false }, wiringMode: false, tabHidden: false, onScreen: true }), false);
// flow obeys play/pause, visibility and wiring mode — but not Motion
assert.equal(S.effectiveFlowPlaying({ controls: { ...on, motion: false }, wiringMode: false, tabHidden: false, onScreen: true }), true);
assert.equal(S.effectiveFlowPlaying({ controls: { ...on, flow: false }, wiringMode: false, tabHidden: false, onScreen: true }), false);
assert.equal(S.effectiveFlowPlaying({ controls: on, wiringMode: true, tabHidden: false, onScreen: true }), false);
assert.deepEqual([...S.STAGE_SPEEDS], [0.5, 1, 2]);

console.log('stage animation unit checks passed');
"""


def test_stage_animation_units_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "stageAnimation.ts").write_text((LIB / "stageAnimation.ts").read_text())
    (tmp_path / "run.mjs").write_text(UNIT_SCRIPT)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs"), str(REPO)],
        capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, result.stdout + result.stderr
