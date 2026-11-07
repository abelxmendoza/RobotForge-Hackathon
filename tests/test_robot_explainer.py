"""'How does my robot work?' (2026-11-07): a step-through explainer
generated from a robot's own record (web-next/src/lib/robotExplainer.ts,
drawn by components/explain/RobotExplainer.tsx at /explain/).

The module is pure with zero imports, so node runs it directly (the
same source-pin + node-eval pattern as tests/test_forge_tests.py),
against Omega1's documented seed and every Robodex spec file.

Honesty pins:
- parts and wires come only from the recorded wiring (`connections` or
  `wiring`); with neither, no wire is drawn and the gap is said;
- the only added link is compute -> driver, marked INFERRED;
- Omega1's unmeasured numbers stay "not recorded" (no wheel size, no
  speed, no capacity), and PLANNED rows are left out;
- every frame is a pure function of (step, t), and every motion ends
  where it started, so stepping through never jumps.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next"
LIB = WEB / "src" / "lib"
SRC = (LIB / "robotExplainer.ts").read_text()
OMEGA = (LIB / "omega1Garage.ts").read_text()
COMPONENT = (WEB / "src/components/explain/RobotExplainer.tsx").read_text()
PAGE = (WEB / "src/components/explain/ExplainPage.tsx").read_text()


def test_module_is_pure_and_states_its_contract():
    assert not any(line.startswith("import ") for line in SRC.splitlines())
    for marker in ("export function buildExplainer", "export function explainerFrame",
                   "export function layoutExplainer", "export function explainerTimeline",
                   "'INFERRED'", "'NOT_RECORDED'", "PLANNED"):
        assert marker in SRC, marker
    # The figure never computes its own numbers: it draws frames.
    assert "explainerFrame(x, step, t)" in COMPONENT
    assert "Math.random" not in SRC and "Date.now" not in SRC
    # Seek hook for stills and the jump scan; Manual/Auto remembered.
    assert "__rfExplainer" in COMPONENT and "rf.explainMode.v1" in COMPONENT
    assert "[?&]render" in COMPONENT


def _omega_connections():
    body = OMEGA.split("OMEGA1_CONNECTIONS: SpecConnection[] = [")[1].split("];")[0]
    return body


def test_behaviour_under_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    (tmp_path / "robotExplainer.ts").write_text(SRC)
    (tmp_path / "package.json").write_text('{"type":"module"}')
    specs = {}
    for f in sorted((ROOT / "examples").glob("*.json")):
        try:
            d = json.loads(f.read_text())
        except Exception:
            continue
        if isinstance(d, dict) and "drivetrain" in d:
            specs[f.stem] = d
    (tmp_path / "specs.json").write_text(json.dumps(specs))
    conns = _omega_connections()
    script = """
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExplainer, explainerFrame, layoutExplainer, explainerTimeline } from './robotExplainer.ts';

const connections = [%s];
const omega = {
  name: 'Omega1', description: 'skid-steer, manual remote control.',
  drivetrain: 'skid_steer', wheel: { count: 4, driven: true }, motor: { count: 4, kind: 'dc_gearmotor' },
  battery: { chemistry: 'liion', voltage_v: 7.4 },
  sensors: [{ kind: 'ultrasonic', position: 'front' }, { kind: 'rgb_camera', position: 'front' }],
  connections: [...connections, { from: 'Raspberry Pi 4B', to: 'Jetson Orin', detail: 'planned', evidence: 'PLANNED' }],
};
const x = buildExplainer(omega);
assert.deepEqual(x.steps.map((s) => s.id), ['power', 'think', 'driver', 'forward', 'turn', 'sense']);
assert.equal(x.kind, 'wheeled');
assert.equal(x.source, 'connections');
assert.match(x.bigIdea, /one side.s wheels backward/);
// PLANNED rows are left out and said.
assert.ok(!x.nodes.some((n) => /jetson/i.test(n.label)));
assert.ok(x.gaps.some((g) => /planned connection/.test(g)));
// The one inferred link, and only one.
const inferred = x.edges.filter((e) => e.evidence === 'INFERRED');
assert.equal(inferred.length, 1);
assert.equal(inferred[0].from, 'raspberry-pi-4b');
assert.equal(inferred[0].to, 'pca9685-pwm-hat');
assert.match(inferred[0].detail, /not a recorded row/);
// Every recorded row keeps its DOCUMENTED badge.
assert.equal(x.edges.filter((e) => e.evidence === 'DOCUMENTED').length, connections.length);
// Unmeasured numbers are never filled in.
const facts = x.steps.flatMap((s) => s.facts);
const byLabel = (l) => facts.find((f) => f.label === l);
assert.equal(byLabel('Wheel diameter').evidence, 'NOT_RECORDED');
assert.equal(byLabel('Capacity').evidence, 'NOT_RECORDED');
assert.equal(byLabel('Top speed').evidence, 'NOT_RECORDED');
assert.ok(!facts.some((f) => /m\\/s/.test(f.value)));
assert.ok(!JSON.stringify(x).includes('0.05'));   // the repo's wrong-sized wheel radius
assert.ok(!JSON.stringify(x).includes('300'));    // its code-default rpm
// Wheels map to the right motors; turning runs the left side backward.
assert.deepEqual(x.wheels.map((w) => w.motor), ['front-left-motor', 'front-right-motor', 'rear-left-motor', 'rear-right-motor']);
const turn = x.steps.findIndex((s) => s.id === 'turn');
const mid = explainerFrame(x, turn, 2);
assert.ok(mid.wheel.w0.dir < 0 && mid.wheel.w2.dir < 0 && mid.wheel.w1.dir > 0 && mid.wheel.w3.dir > 0);
assert.deepEqual(x.steps[turn].window.lines, ['left backward: ch 0, 3', 'right forward: ch 7, 5']);
// Remote control: the sense step says who drives.
assert.match(x.steps.at(-1).hint, /You still do the driving/);

// Frames are pure and every motion ends where it started.
for (let i = 0; i < x.steps.length; i++) {
  const d = x.steps[i].duration;
  assert.deepEqual(explainerFrame(x, i, 1.3), explainerFrame(x, i, 1.3));
  const end = explainerFrame(x, i, d);
  assert.ok(Math.abs(((end.rot %% 360) + 360) %% 360) < 1e-6 || Math.abs(((end.rot %% 360) + 360) %% 360 - 360) < 1e-6, 'rot ' + end.rot);
  assert.ok(end.floor < 1e-6 || end.floor > 1 - 1e-6, 'floor ' + end.floor);
  for (const w of Object.values(end.wheel)) assert.ok(w.phase < 1e-6 || w.phase > 1 - 1e-6, 'phase ' + w.phase);
  // No big step between neighbouring 1/60 s frames.
  let prev = explainerFrame(x, i, 0);
  for (let t = 1 / 60; t <= d; t += 1 / 60) {
    const f = explainerFrame(x, i, t);
    assert.ok(Math.abs(f.rot - prev.rot) < 6, 'rot jump at ' + t);
    prev = f;
  }
}
const tl = explainerTimeline(x);
assert.ok(tl.total > 20);
assert.equal(tl.at(0).step, 0);
assert.equal(tl.at(tl.total + 0.1).step, 0);

// Layout: every part placed, every wire has two ends, all inside the figure.
const L = layoutExplainer(x);
for (const n of x.nodes) assert.ok(L.parts.some((p) => p.node === n.id), 'placed ' + n.id);
for (const p of L.parts) assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= 600 && p.y + p.h <= 440, 'inside ' + p.node);

// Every Robodex spec builds, without throwing, and never invents wires.
const specs = JSON.parse(readFileSync('specs.json', 'utf8'));
for (const [name, spec] of Object.entries(specs)) {
  const y = buildExplainer(spec, { name });
  assert.ok(y.steps.length >= 1, name);
  if (!spec.wiring && !spec.connections) {
    assert.equal(y.edges.length, 0, name);
    assert.ok(y.gaps.some((g) => /Wiring not recorded/.test(g)), name);
  }
  for (let i = 0; i < y.steps.length; i++) explainerFrame(y, i, y.steps[i].duration / 2);
}
assert.equal(buildExplainer(specs['unitree-go2'], { name: 'Go2' }).bodyClass, 'legged');
assert.equal(buildExplainer(specs['px4-x500'], { name: 'X500' }).bodyClass, 'aerial');
const tb = buildExplainer(specs['turtlebot3-burger'], { name: 'TurtleBot3 Burger' });
assert.equal(tb.source, 'wiring');
assert.ok(tb.steps.some((s) => s.id === 'turn'));
// Recorded wheel size + no rpm: still no speed.
assert.ok(!tb.steps.flatMap((s) => s.facts).some((f) => /m\\/s/.test(f.value)));

// Degenerate input never throws.
assert.equal(buildExplainer(null).steps.length, 0);
assert.equal(explainerFrame(buildExplainer({}), 0, 1).lit.length, 0);
// Estimate marks follow the version's estimatedPaths.
const est = buildExplainer({ drivetrain: 'differential', wheel: { count: 2, diameter_m: 0.1 }, motor: { count: 2, rpm: 120 }, battery: { voltage_v: 12 } }, { estimatedPaths: ['wheel.diameter_m'] });
const speed = est.steps.flatMap((s) => s.facts).find((f) => /Top speed/.test(f.label));
assert.equal(speed.evidence, 'ESTIMATE');
assert.equal(speed.value, '0.63 m/s');
console.log('robot-explainer behaviour ok');
""" % conns
    (tmp_path / "check.mjs").write_text(script)
    out = subprocess.run([node, "check.mjs"], cwd=tmp_path, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stdout + out.stderr
    assert "robot-explainer behaviour ok" in out.stdout


def test_page_resolves_workshop_then_seed_then_robodex():
    i_work = PAGE.index('from: "workshop"')
    i_seed = PAGE.index('from: "seed"')
    i_dex = PAGE.index('from: "robodex"')
    assert i_work < i_seed < i_dex
    assert "omega1SeedSpec()" in PAGE
    assert re.search(r"estimatedPaths: latest\.estimatedPaths", PAGE)
