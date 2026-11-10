"""Omega1 simulator page (/simulator/, 2026-11-10): Omega1's 3D twin on the
Workshop's Rapier drive sandbox, with live motor/sensor gauges and a
self-running tour. Logic lives in web-next/src/lib/omega1Sim.ts (pure, zero
imports, run here under node); the page is components/simulator/Omega1Simulator.tsx.

Honesty pins:
- Omega1's unmeasured numbers come from the twin model and are labelled
  TWIN_ESTIMATE; the motor torque is a labelled STAND_IN;
- the repo's flagged CODE_DEFAULT wheel radius (0.05 m), track (0.20 m) and
  max rpm (300) are never used, and no speed is shown;
- motor channels match the DOCUMENTED channel map in omega1.extracted.json;
- the tour's stop rule is said to be the page's, not Omega1's code.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next" / "src"
SRC = (WEB / "lib" / "omega1Sim.ts").read_text()
PAGE = (WEB / "components" / "simulator" / "Omega1Simulator.tsx").read_text()
ROUTE = (WEB / "app" / "simulator" / "page.tsx").read_text()
PHYSICS = (WEB / "lib" / "drivePhysics.ts").read_text()
DRIVE_MATH = (WEB / "lib" / "driveMath.ts").read_text()
EXTRACTED = json.loads((ROOT / "docs" / "omega1" / "omega1.extracted.json").read_text())


def test_module_is_pure_and_page_is_wired():
    assert not any(line.startswith("import ") for line in SRC.splitlines())
    assert "Math.random" not in SRC and "Date.now" not in SRC
    assert "Omega1Simulator" in ROUTE and "AppShell" in ROUTE
    # Same engine as the Workshop's Simulate tab, same drive constants.
    assert "createDriveWorld(spec, 'flat', walls)" in PAGE
    assert "SIM_DRIVE_CMD_MPS*throttle-SIM_TURN_GAIN*turn*w.y" in PHYSICS
    assert "export const SIM_DRIVE_CMD_MPS = 0.3" in DRIVE_MATH
    # The Workshop's Omega1 Simulate tab links here.
    assert 'href="/simulator/"' in (WEB / "components" / "garage" / "Omega1Twin.tsx").read_text()


def test_no_speed_and_no_flagged_code_defaults():
    # No m/s, km/h or rpm reading on the page.
    assert not re.search(r"m/s|km/h|rpm\b(?! defaults)", PAGE.replace("300 rpm defaults", ""))
    numbers = SRC.split("OMEGA1_SIM_NUMBERS: SimNumber[] = [")[1].split("];")[0]
    for flagged in ("value: 0.05,", "value: 0.1,", "value: 0.2,", "value: 300"):
        assert flagged not in numbers
    assert "No speed is shown" in PAGE


def test_channels_match_the_extracted_record():
    fields = EXTRACTED["fields"]
    for wheel in ("front_left", "rear_left", "front_right", "rear_right"):
        rec = fields[f"motors.channel_map.{wheel}"]
        assert rec["evidence"] == "DOCUMENTED"
        assert f"{wheel}: {{ forward: {rec['value']['forward']}, backward: {rec['value']['backward']}" in SRC
    assert fields["sensors.ultrasonic.pins"]["value"] == {"trig_gpio": 27, "echo_gpio": 22}
    assert "trigGpio: 27, echoGpio: 22" in SRC
    assert fields["sensors.ultrasonic.range_m"]["value"] == [0.02, 4.0]


def test_behaviour_under_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    (tmp_path / "omega1Sim.ts").write_text(SRC)
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "t.mjs").write_text(r"""
import assert from 'node:assert/strict';
import * as S from './omega1Sim.ts';

// Every number says where it came from; only torque is a stand-in.
for (const n of S.OMEGA1_SIM_NUMBERS) assert.ok(n.source.length > 10, n.path);
assert.deepEqual(S.OMEGA1_SIM_NUMBERS.filter((n) => n.basis === 'STAND_IN').map((n) => n.path), ['motor.stall_torque_nm']);
assert.ok(S.OMEGA1_SIM_NUMBERS.filter((n) => n.path !== 'motor.stall_torque_nm').every((n) => n.basis === 'TWIN_ESTIMATE'));

// The sim spec keeps the seed's documented fields and doesn't change the seed.
const seed = { name: 'Omega1', drivetrain: 'skid_steer', wheel: { count: 4, driven: true }, motor: { count: 4, kind: 'dc_gearmotor' } };
const spec = S.omega1SimSpec(seed);
assert.equal(seed.mass_kg, undefined);
assert.equal(spec.drivetrain, 'skid_steer');
assert.equal(spec.wheel.count, 4);
assert.equal(spec.wheel.diameter_m, 0.067);
assert.ok(spec.wheel.diameter_m < spec.length_m && spec.ground_clearance_m < spec.height_m && spec.wheel.width_m < spec.width_m);

const half = spec.width_m / 2 + spec.wheel.width_m / 2;
const cmd = (t, r) => Object.fromEntries(S.wheelCommands(t, r, half, 0.3, 1.2).map((w) => [w.id, [w.turning, w.channel]]));
// Forward: all four forward channels.
assert.deepEqual(cmd(1, 0), { front_left: ['forward', 1], rear_left: ['forward', 2], front_right: ['forward', 7], rear_right: ['forward', 5] });
// Back: all four backward channels.
assert.deepEqual(cmd(-1, 0), { front_left: ['backward', 0], rear_left: ['backward', 3], front_right: ['backward', 6], rear_right: ['backward', 4] });
// Turn left on the spot: left side backward, right side forward (skid steer).
assert.deepEqual(cmd(0, 1), { front_left: ['backward', 0], rear_left: ['backward', 3], front_right: ['forward', 7], rear_right: ['forward', 5] });
assert.deepEqual(cmd(0, -1), { front_left: ['forward', 1], rear_left: ['forward', 2], front_right: ['backward', 6], rear_right: ['backward', 4] });
// Idle: everything off.
assert.ok(S.wheelCommands(0, 0, half, 0.3, 1.2).every((w) => w.turning === 'stopped' && w.channel === null && w.effort === 0));

// Heading and the ultrasonic ray.
assert.equal(Math.round(S.yawDeg({ qx: 0, qy: 0, qz: Math.sin(Math.PI / 4), qw: Math.cos(Math.PI / 4) })), 90);
assert.equal(S.headingDelta(170, -170), 20);
assert.equal(S.headingDelta(-170, 170), -20);
const ahead = S.ultrasonicRange(0, 0, 0, 0.095);          // facing the +x wall
assert.ok(Math.abs(ahead - (S.PEN_HALF - 0.095)) < 1e-9, ahead);
assert.ok(Math.abs(S.ultrasonicRange(0, 0, 90, 0.095) - (S.PEN_HALF - 0.095)) < 1e-9);
assert.equal(S.ultrasonicRange(0, 0, 0, 0.095, []), null); // nothing there: no echo
assert.equal(S.ultrasonicRange(S.PEN_HALF - 0.1, 0, 0, 0.095), S.HC_SR04.minM); // clamped to the sensor's minimum

// The tour: ends on "your turn", every step has words, the stop rule is owned.
assert.equal(S.OMEGA1_TOUR.at(-1).id, 'your-turn');
assert.ok(S.OMEGA1_TOUR.every((s) => s.say.length > 40));
assert.match(S.OMEGA1_TOUR.find((s) => s.id === 'stop').say, /not code from Omega1/);
const toWall = S.OMEGA1_TOUR.find((s) => s.id === 'to-wall');
assert.equal(S.tourStepDone(toWall, { elapsedS: 1, turnedDeg: 0, rangeM: 0.29 }), true);
assert.equal(S.tourStepDone(toWall, { elapsedS: 1, turnedDeg: 0, rangeM: 1 }), false);
assert.equal(S.tourStepDone(toWall, { elapsedS: 13, turnedDeg: 0, rangeM: null }), true);
const spin = S.OMEGA1_TOUR.find((s) => s.id === 'spin-left');
assert.equal(S.tourStepDone(spin, { elapsedS: 2, turnedDeg: 91, rangeM: 1 }), true);
assert.equal(S.tourStepDone(spin, { elapsedS: 2, turnedDeg: 45, rangeM: 1 }), false);
console.log('ok');
""")
    out = subprocess.run([node, "t.mjs"], cwd=tmp_path, capture_output=True, text=True, timeout=60)
    if "ERR_UNKNOWN_FILE_EXTENSION" in out.stderr:
        pytest.skip("This node can't run .ts files")
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "ok"
