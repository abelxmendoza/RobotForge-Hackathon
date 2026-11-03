"""Forge Tests (2026-11-02): generated acceptance tests for a Garage
spec (web-next/src/lib/forgeTests.ts) — drive/turn accuracy, payload
margin, slope/step, endurance estimate, and two injected-fault
predictions, all deterministic from the spec's recorded fields with
the lib/rover.ts formulas, PASS / FAIL / NOT_CHECKED verdicts, and
failure fixes that name real remedies only.

The module is pure with zero imports (formulas re-derived from
lib/rover.ts so the numbers agree with the Simulate/Checks tabs),
so the node harness copies it verbatim — the same source-pin +
node-eval pattern as tests/test_forge_engine.py — and also runs it
against a real Forge-Engine-generated rover spec end to end.

Honesty pins: predictions are labeled predictions/estimates with
inputs shown; thresholds are the plan's own; a spec missing a field
gets NOT_CHECKED naming it, never an invented number; the wrench
layer (engine.ts/wrench.ts) never imports forgeTests.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next"
LIB = WEB / "src" / "lib"

TESTS_TS = (LIB / "forgeTests.ts").read_text()
FORGE_TS = (LIB / "forgeEngine.ts").read_text()
GARAGE_TSX = (WEB / "src/components/garage/Garage.tsx").read_text()
WS_CONTEXT = (LIB / "workshopContext.ts").read_text()
WRENCH = (WEB / "src/components/chat/wrench.ts").read_text()
ENGINE = (WEB / "src/components/chat/engine.ts").read_text()
CATALOGUE = json.loads((ROOT / "catalog/parts.json").read_text())


# --- Static pins -----------------------------------------------------

def test_module_shape_and_honesty_markers():
    assert "export function generateForgeTests" in TESTS_TS
    assert "export function forgeTestTally" in TESTS_TS
    # zero imports, like forgeEngine.ts — no line starts an import
    assert not any(line.startswith("import ") for line in TESTS_TS.splitlines())
    assert "from 'react'" not in TESTS_TS and 'from "react"' not in TESTS_TS
    # verdict + fault-injection vocabulary
    for marker in ("'PASS'", "'FAIL'", "'NOT_CHECKED'", "fault_injection"):
        assert marker in TESTS_TS, marker
    # predictions are labeled, thresholds are the plan's own
    assert "Prediction, not a measurement" in TESTS_TS
    assert "ESTIMATE" in TESTS_TS
    assert "this plan's" in TESTS_TS
    assert "never invents" in TESTS_TS
    # failure fixes name real remedies: the two forgeEngine grammar
    # strings, plus guidance toward the existing Spark fix flow
    assert "'swap in a bigger battery'" in TESTS_TS
    assert "'add imu'" in TESTS_TS
    assert "Fix with Muse Spark" in TESTS_TS
    # formulas mirror lib/rover.ts — the constants are pinned so the
    # numbers agree with the Simulate/Checks tabs
    for const in ("USABLE_TORQUE_FRACTION = 0.4", "STEP_FRACTION = 0.4",
                  "MARGIN_OK = 1.5", "DRIVE_EFFICIENCY = 0.5"):
        assert const in TESTS_TS, const
    # no prices anywhere
    assert "price" not in TESTS_TS.lower()


def test_ui_section_and_persistence():
    assert "function ForgeTestsSection" in GARAGE_TSX
    assert "Forge Tests" in GARAGE_TSX
    assert "Generate acceptance tests" in GARAGE_TSX
    # stored on the spec, following the spec.forge pattern
    assert "generateForgeTests(draft" in GARAGE_TSX
    assert "forgeTests" in GARAGE_TSX
    # Acceptance tests belong to Checks; simulation has its own pane.
    sim_block = GARAGE_TSX.split("tab === 'simulate' && (")[1].split("tab === 'bom'")[0]
    checks_block = GARAGE_TSX.split("tab === 'checks' && (", 1)[1]
    assert "SimulateTab" in sim_block and "ForgeTestsSection" not in sim_block
    assert "ForgeTestsSection" in checks_block
    # a recognised modification fix is wired to the same handler the
    # Modify box uses — no dead buttons
    assert "onModify={applyMod}" in GARAGE_TSX
    assert "Apply fix:" in GARAGE_TSX


def test_simulate_chips_and_wrench_untouched():
    sim = WS_CONTEXT.split("simulate: [")[1].split("],")[0]
    assert "acceptance tests" in sim
    assert "forgeTests" not in WRENCH and "forgeTests" not in ENGINE
    assert "forgeTests" not in WRENCH and "generateForgeTests" not in ENGINE


# --- Behaviour under node ---------------------------------------------

def test_forge_tests_behaviour(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    (tmp_path / "forgeTests.ts").write_text(TESTS_TS)
    (tmp_path / "forgeEngine.ts").write_text(FORGE_TS)
    (tmp_path / "parts.json").write_text(json.dumps(CATALOGUE))
    (tmp_path / "package.json").write_text('{"type":"module"}')
    script = """
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateForgeTests, forgeTestTally } from './forgeTests.ts';
import { parseBrief, generateRobot } from './forgeEngine.ts';
const here = fileURLToPath(new URL('.', import.meta.url));
const cat = JSON.parse(readFileSync(here + 'parts.json', 'utf8')).parts;
const byId = (plan, id) => plan.tests.find((t) => t.id === id);

// The differential rover archetype inputs (as forgeEngine emits them
// from the catalogue: gearmotor_12v 0.8 N·m, wheel_100mm, 3S 2200).
const rover = {
  name: 'Test Rover', drivetrain: 'differential',
  length_m: 0.32, width_m: 0.26, height_m: 0.18, mass_kg: 2.1,
  ground_clearance_m: 0.03,
  wheel: { diameter_m: 0.1, width_m: 0.032, count: 2 },
  motor: { kind: 'dc_gearmotor', voltage_v: 12, count: 2, stall_torque_nm: 0.8 },
  battery: { chemistry: 'lipo', voltage_v: 11.1, capacity_mah: 2200 },
};
const plan = generateForgeTests(rover, '2026-11-02T00:00:00.000Z');
assert.equal(plan.generatedAt, '2026-11-02T00:00:00.000Z');
assert.equal(plan.tests.length, 8);
assert.equal(byId(plan, 'drive_1m').verdict, 'PASS');
assert.equal(byId(plan, 'turn_90').verdict, 'PASS');
assert.equal(byId(plan, 'payload_carry').verdict, 'PASS');
assert.equal(byId(plan, 'slope_10').verdict, 'PASS');
assert.equal(byId(plan, 'step_clear').verdict, 'PASS');
assert.equal(byId(plan, 'endurance').verdict, 'PASS');
// 20% one-wheel slip over a 228 mm derived track drifts ~41° — the
// plan must FAIL it and name a fix.
const slip = byId(plan, 'fault_wheel_slip');
assert.equal(slip.kind, 'fault_injection');
assert.equal(slip.verdict, 'FAIL');
assert.ok(slip.suggestedFix, 'slip FAIL carries a suggested fix');
assert.equal(byId(plan, 'fault_battery_80').verdict, 'PASS');
assert.ok(forgeTestTally(plan).includes('PASS'));
// every checked test shows its inputs and a plain-language procedure
for (const t of plan.tests) {
  if (t.verdict === 'NOT_CHECKED') continue;
  assert.ok(t.inputs.length > 0, t.id + ' shows inputs');
  assert.ok(t.procedure.length >= 3, t.id + ' has a procedure');
  assert.ok(t.predicted.length > 0, t.id + ' has a prediction');
}

// End to end: a real Forge-Engine-generated rover passes drive/turn.
const gen = generateRobot(parseBrief('rover with lidar'), cat);
const genPlan = generateForgeTests(gen, '2026-11-02T00:00:00.000Z');
assert.equal(byId(genPlan, 'drive_1m').verdict, 'PASS');
assert.equal(byId(genPlan, 'turn_90').verdict, 'PASS');

// Failure -> fix wiring: the generated rover has an IMU already, so
// the slip fix falls back to guidance; with the ids but no IMU it is
// the recognised modification string itself.
const noImu = JSON.parse(JSON.stringify(gen));
delete noImu.forge.ids.imu;
const noImuPlan = generateForgeTests(noImu, '');
assert.equal(byId(noImuPlan, 'fault_wheel_slip').suggestedFix.kind, 'modification');
assert.equal(byId(noImuPlan, 'fault_wheel_slip').suggestedFix.text, 'add imu');

// Honestly broken: tiny wheels + low belly fail the step test, and a
// missing torque record abstains by name instead of inventing one.
const broken = { ...rover, ground_clearance_m: 0.01,
  wheel: { diameter_m: 0.04, width_m: 0.02, count: 2 },
  motor: { kind: 'dc_gearmotor', voltage_v: 12, count: 2, stall_torque_nm: null } };
const bp = generateForgeTests(broken, '');
assert.equal(byId(bp, 'step_clear').verdict, 'FAIL');
assert.ok(byId(bp, 'step_clear').suggestedFix, 'step FAIL carries a fix');
for (const id of ['drive_1m', 'turn_90', 'payload_carry', 'slope_10']) {
  assert.equal(byId(bp, id).verdict, 'NOT_CHECKED', id);
  assert.ok(byId(bp, id).basis.includes('motor.stall_torque_nm'), id + ' names the missing field');
}

// Weak battery: endurance FAILs and the fix is the recognised
// bigger-battery modification string.
const weak = { ...rover, battery: { chemistry: 'lipo', voltage_v: 7.4, capacity_mah: 500 } };
const wp = generateForgeTests(weak, '');
assert.equal(byId(wp, 'endurance').verdict, 'FAIL');
assert.equal(byId(wp, 'endurance').suggestedFix.kind, 'modification');
assert.equal(byId(wp, 'endurance').suggestedFix.text, 'swap in a bigger battery');
assert.equal(byId(wp, 'fault_battery_80').verdict, 'FAIL');

// Arm and multirotor: honest abstentions, no wheeled numbers.
const arm = generateRobot(parseBrief('a robot arm with a gripper'), cat);
const ap = generateForgeTests(arm, '');
assert.equal(byId(ap, 'drive_1m').verdict, 'NOT_CHECKED');
assert.ok(byId(ap, 'drive_1m').basis.includes('robotic_arm'));
assert.equal(byId(ap, 'arm_joint_torque').verdict, 'NOT_CHECKED');
assert.ok(byId(ap, 'arm_joint_torque').basis.includes('motor.stall_torque_nm'));
assert.equal(byId(ap, 'endurance').verdict, 'NOT_CHECKED');

const quad = generateRobot(parseBrief('a quadcopter drone'), cat);
const qp = generateForgeTests(quad, '');
assert.ok(qp.tests.every((t) => t.verdict === 'NOT_CHECKED'));
assert.ok(byId(qp, 'endurance').basis.includes('hover'));

// Degenerate input still returns a plan, never throws.
assert.equal(generateForgeTests(null, '').tests[0].verdict, 'NOT_CHECKED');
console.log('forge-tests behaviour ok');
"""
    (tmp_path / "check.mjs").write_text(script)
    out = subprocess.run([node, "check.mjs"], cwd=tmp_path,
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stdout + out.stderr
    assert "forge-tests behaviour ok" in out.stdout
