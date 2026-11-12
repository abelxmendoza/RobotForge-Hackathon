"""Twin critic (2026-11-07): does the 3D twin built from a robot's spec
hold together? (web-next/src/lib/twinCritic.ts, shown in the Workshop
Checks tab by components/garage/TwinCritic.tsx.)

Node runs the pure critic against the real twin geometry: takeapart.ts
and its one dependency are copied next to it with the import made
explicit, so the units checked are exactly the ones the 3D view draws.

Pins:
- no recorded sizes -> every check NOT_CHECKED, nothing guessed (Omega1's
  seed spec);
- Omega1's ProjectSim model is read from its own GLB header and checked
  as a model (its problems are WARNs on the twin, not the robot);
- every Robodex robot gets a verdict, and none of them FAILs on its own
  numbers;
- broken numbers do FAIL: oversized wheels, a part placed inside
  another, a placed part below the floor.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next" / "src"
SRC = (WEB / "lib" / "twinCritic.ts").read_text()
UI = (WEB / "components" / "garage" / "TwinCritic.tsx").read_text()
GARAGE = (WEB / "components" / "garage" / "Garage.tsx").read_text()


def test_module_is_pure_and_wired_into_checks():
    assert not any(line.startswith("import ") for line in SRC.splitlines())
    assert "Math.random" not in SRC and "Date.now" not in SRC
    for marker in ("export function critiqueTwin", "export function glbLinkBoxes",
                   "export function modelUnits", "'NOT_CHECKED'", "OMEGA1_MODEL"):
        assert marker in SRC, marker
    # Shown in the Checks tab, right after the engineering findings.
    checks = GARAGE.split("{tab === 'checks' && draft.referenceModel !== 'unitree-g1-23' && (")[1]
    assert checks.index("<Findings lines={draftLines} />") < checks.index("<TwinCritic ")
    # Omega1's model is read by a range request, never all 10 MB first.
    assert 'Range: "bytes=0-' in UI


def test_behaviour_under_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    (tmp_path / "twinCritic.ts").write_text(SRC)
    (tmp_path / "model.ts").write_text((WEB / "components/forge/model.ts").read_text())
    take = (WEB / "components/kit/takeapart.ts").read_text().replace("'../forge/model'", "'./model.ts'")
    (tmp_path / "takeapart.ts").write_text(take)
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
    glb = ROOT / "assets/omega1-twin/omega1-rover.glb"
    script = """
import assert from 'node:assert/strict';
import { readFileSync, openSync, readSync } from 'node:fs';
import { taBuildParts, taGeom3d, taClass } from './takeapart.ts';
import { critiqueTwin, glbLinkBoxes, modelUnits, OMEGA1_MODEL } from './twinCritic.ts';

const run = (spec, placed) => {
  const b = taBuildParts(spec);
  const units = taGeom3d(spec, b.parts, b.pos);
  const names = Object.fromEntries(b.parts.map((p) => [p.id, p.name]));
  return critiqueTwin({ spec, cls: taClass(spec), units, names, placed, explodeMaxM: 0.06 });
};
const by = (r, id) => r.findings.find((f) => f.id === id);

// 1. Omega1's seed: no sizes recorded, nothing guessed.
const seed = { name: 'Omega1', drivetrain: 'skid_steer', wheel: { count: 4, driven: true }, motor: { count: 4 }, battery: { chemistry: 'liion', voltage_v: 7.4 }, sensors: [] };
const s = run(seed);
assert.equal(s.verdict, 'NOT_CHECKED');
assert.ok(s.findings.every((f) => f.verdict === 'NOT_CHECKED'));
assert.match(by(s, 'size').detail, /Not recorded: length, width, height, wheel diameter/);
assert.match(by(s, 'size').detail, /doesn.t guess/);

// 2. Omega1's ProjectSim model, from the GLB header only.
const fd = openSync('%s', 'r');
const head = Buffer.alloc(262144);
readSync(fd, head, 0, head.length, 0);
const boxes = glbLinkBoxes(head.buffer.slice(head.byteOffset, head.byteOffset + head.length));
assert.deepEqual(Object.keys(boxes).sort(), ['chassis', 'sensor_head', 'wheel_front_left', 'wheel_front_right', 'wheel_rear_left', 'wheel_rear_right']);
const m = modelUnits(boxes, { fixed: ['chassis'], up: ['sensor_head'] });
// Frame: the front-left wheel is ahead (+x) and on the left (+y).
const fl = m.units.find((u) => u.part === 'wheel_front_left').meshes[0].center;
assert.ok(fl[0] > 0 && fl[1] > 0, 'front-left ' + fl);
const om = critiqueTwin({ spec: seed, cls: 'ground', units: m.units, names: OMEGA1_MODEL.names, explodeMaxM: m.explodeMaxM, model: OMEGA1_MODEL });
assert.notEqual(om.verdict, 'FAIL');
assert.equal(by(om, 'floor').verdict, 'PASS');
assert.equal(by(om, 'scrape').verdict, 'PASS');
assert.match(by(om, 'floor').detail, /4 wheels/);
assert.equal(by(om, 'wheels').verdict, 'NOT_CHECKED');   // its sizes are estimates
assert.equal(by(om, 'height').verdict, 'NOT_CHECKED');
assert.match(om.basis, /ESTIMATES/);

// 3. Every Robodex robot gets a verdict; none FAILs on its own numbers.
const specs = JSON.parse(readFileSync('specs.json', 'utf8'));
for (const [name, spec] of Object.entries(specs)) {
  const r = run(spec);
  assert.ok(['PASS', 'WARN'].includes(r.verdict), name + ' ' + r.verdict + ' ' + JSON.stringify(r.findings.filter((f) => f.verdict === 'FAIL')));
  assert.ok(r.parts > 0, name);
  for (const f of r.findings) if (f.verdict === 'WARN') assert.equal(f.group, 'twin', name + ' ' + f.id);
}
const tb = run(specs['turtlebot3-burger']);
assert.match(by(tb, 'floor').detail, /2 wheels and 2 casters/);
// The schematic motor mounts reach the floor: a drawing fix, said as one.
assert.equal(by(tb, 'scrape').verdict, 'WARN');
assert.match(by(tb, 'scrape').detail, /2 motor mounts/);
assert.deepEqual(tb.findings.filter((f) => f.verdict === 'WARN').map((f) => f.id), ['scrape']);
assert.equal(run(specs['unitree-go2']).verdict, 'PASS');
// The schematic camera bracket is drawn floating: the critic says so.
assert.equal(by(run(specs['andino']), 'floating').verdict, 'WARN');
assert.match(by(run(specs['andino']), 'floating').detail, /Camera bracket/);
// A flying robot is checked from its airframe, not the floor.
assert.equal(by(run(specs['px4-x500']), 'floor').verdict, 'NOT_CHECKED');

// 4. Broken numbers FAIL, naming the parts.
const big = { ...specs['pathfinder'], wheel: { ...specs['pathfinder'].wheel, diameter_m: 0.3 } };
const rb = run(big);
assert.equal(rb.verdict, 'FAIL');
assert.equal(by(rb, 'wheels').verdict, 'FAIL');
assert.match(by(rb, 'wheels').detail, /taller than the whole robot/);
assert.equal(by(rb, 'overlap').verdict, 'FAIL');
assert.ok(by(rb, 'overlap').parts.some((p) => /Wheel \\(front left\\)/.test(p)));
const pi = (id, z, x = 0) => ({ id, name: 'Raspberry Pi 5', sizeM: [0.085, 0.056, 0.017], positionM: [x, 0, z], yawDeg: 0 });
const deck = specs['pathfinder'].ground_clearance_m + 0.004;
assert.equal(by(run(specs['pathfinder'], [pi('a', deck + 0.0085 + 0.003)]), 'placed').verdict, 'PASS');
const two = run(specs['pathfinder'], [pi('a', deck + 0.0115), pi('b', deck + 0.0115, 0.02)]);
assert.equal(by(two, 'placed').verdict, 'FAIL');
assert.match(by(two, 'placed').detail, /Raspberry Pi 5 \\(placed: a\\) goes \\d+ mm into Raspberry Pi 5 \\(placed: b\\)/);
// On standoffs above the deck is held; 60 mm up in the air is not.
assert.equal(by(run(specs['pathfinder'], [pi('a', deck + 0.0085 + 0.010)]), 'placed').verdict, 'PASS');
const high = run(specs['pathfinder'], [pi('a', deck + 0.07)]);
assert.equal(by(high, 'placed').verdict, 'FAIL');
assert.match(by(high, 'placed').detail, /floats \\d+ mm from anything/);
assert.equal(by(high, 'floating').verdict, 'PASS');   // the drawing itself is fine
const sunk = run(specs['pathfinder'], [pi('a', -0.02)]);
assert.equal(by(sunk, 'floor').verdict, 'FAIL');

// 5. Degenerate input never throws.
assert.equal(critiqueTwin({ spec: {}, cls: 'ground', units: [] }).verdict, 'NOT_CHECKED');
console.log('twin-critic behaviour ok');
""" % glb.as_posix()
    (tmp_path / "check.mjs").write_text(script)
    out = subprocess.run([node, "check.mjs"], cwd=tmp_path, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stdout + out.stderr
    assert "twin-critic behaviour ok" in out.stdout
