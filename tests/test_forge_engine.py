"""Forge Engine v1 (2026-11-02): the deterministic generation core
(web-next/src/lib/forgeEngine.ts) — brief parsing, catalogue-only
component selection, placement rules, wiring voltage verdicts
(direct ERROR / mediated WARN / missing-rating NOT_CHECKED, the
Andino rule), print bed-fit, modifications as new-spec diffs, and
checks firing on a deliberately broken spec.

The engine is a pure module with no imports, so the node harness
copies it verbatim and runs it against the real catalogue
(catalog/parts.json) — the same source-pin + node-eval pattern as
tests/test_workshop_chat_context.py.

Honesty pins: generated specs carry spec.forge with exactly the
map's sections; every BOM id resolves in the catalogue; filament /
time stay labeled ESTIMATE; unknown modifications return null; the
wrench layer (engine.ts/wrench.ts) never imports the engine.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next"
LIB = WEB / "src" / "lib"

FORGE = (LIB / "forgeEngine.ts").read_text()
GARAGE_LIB = (LIB / "garage.ts").read_text()
GARAGE_TSX = (WEB / "src/components/garage/Garage.tsx").read_text()
CREATE_TSX = (WEB / "src/components/chat/ComposerCreate.tsx").read_text()
APP_CSS = (ROOT / "assets/css/app.css").read_text()
WRENCH = (WEB / "src/components/chat/wrench.ts").read_text()
ENGINE = (WEB / "src/components/chat/engine.ts").read_text()
CATALOGUE = json.loads((ROOT / "catalog/parts.json").read_text())
CAT_IDS = {p["id"] for p in CATALOGUE["parts"]}


def test_engine_behaviour(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    (tmp_path / "forgeEngine.ts").write_text(FORGE)
    (tmp_path / "garage.ts").write_text(GARAGE_LIB)
    (tmp_path / "parts.json").write_text(json.dumps(CATALOGUE))
    (tmp_path / "package.json").write_text('{"type":"module"}')
    script = """
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBrief, generateRobot, applyModification, suggestPlacement,
         suggestWiring, planPrints, runEngineChecks } from './forgeEngine.ts';
import { diffSpecs } from './garage.ts';
const here = fileURLToPath(new URL('.', import.meta.url));
const cat = JSON.parse(readFileSync(here + 'parts.json', 'utf8')).parts;
const catIds = new Set(cat.map((p) => p.id));

// --- Brief parse ---------------------------------------------------
assert.equal(parseBrief('build a rover with lidar').archetype, 'differential_rover');
assert.equal(parseBrief('a mecanum robot').archetype, 'mecanum_rover');
assert.equal(parseBrief('a robot arm with a gripper').archetype, 'robotic_arm');
assert.equal(parseBrief('a quadcopter drone').archetype, 'multirotor');
assert.equal(parseBrief('small rover').size, 'compact');
assert.equal(parseBrief('large rover').size, 'large');
assert.ok(parseBrief('rover with lidar and a camera').sensors.includes('lidar'));
assert.ok(parseBrief('rover with lidar and a camera').sensors.includes('camera'));
assert.ok(parseBrief('rover').sensors.includes('imu'), 'rovers default to an IMU');
// Explicit options beat keywords.
assert.equal(parseBrief('rover', { archetype: 'multirotor' }).archetype, 'multirotor');

// --- Generation: catalogue ids only, map's forge shape -------------
for (const txt of ['rover with lidar and a camera', 'mecanum robot',
                   'robot arm with a gripper', 'quadcopter drone']) {
  const spec = generateRobot(parseBrief(txt), cat);
  for (const k of ['name', 'drivetrain', 'length_m', 'width_m', 'height_m',
                   'mass_kg', 'ground_clearance_m', 'motor', 'battery'])
    assert.ok(k in spec, txt + ' missing spec.' + k);
  for (const k of ['placement', 'wiring', 'prints', 'checks', 'bom'])
    assert.ok(Array.isArray(spec.forge[k]), txt + ' missing forge.' + k);
  for (const line of spec.forge.bom)
    assert.ok(catIds.has(line.partId), txt + ' invented part: ' + line.partId);
  // A generated robot must not fail its own checks.
  const errs = spec.forge.checks.filter((c) => c.verdict === 'ERROR');
  assert.deepEqual(errs, [], txt + ' self-ERRORs: ' + JSON.stringify(errs));
  // Prints always label filament/time as estimates.
  for (const p of spec.forge.prints)
    assert.ok(p.estimate_label.includes('ESTIMATE'), p.name);
}

// --- Placement rules ----------------------------------------------
const rover = generateRobot(parseBrief('rover with lidar and a camera'), cat);
const bat = rover.forge.placement.find((p) => p.role === 'battery');
assert.ok(bat, 'battery placed');
const others = rover.forge.placement.filter((p) => p.role !== 'battery');
assert.ok(others.every((p) => p.pos_mm[2] >= bat.pos_mm[2]),
          'battery is the lowest placement');
assert.ok(Math.abs(bat.pos_mm[0]) <= 40 && bat.pos_mm[1] === 0,
          'battery is central');
assert.ok(bat.why.length > 10, 'placement carries its why');
const cam = rover.forge.placement.find((p) => p.role === 'camera');
assert.ok(cam.pos_mm[0] > 0, 'camera sits at the front (+X)');
assert.ok(cam.orient.includes('+X') && /facing forward/.test(cam.orient),
          'camera faces forward');
const lid = rover.forge.placement.find((p) => p.role === 'lidar');
assert.ok(lid.pos_mm[2] >= Math.max(...others.map((p) => p.pos_mm[2])) - 20,
          'lidar rides at the top');

// --- Wiring voltage verdicts ---------------------------------------
const byId = (spec, id) => spec.forge.checks.find((c) => c.id === id);
// Direct link within rating: battery (11.1 V) -> driver (max 13.5 V).
assert.equal(byId(rover, 'voltage-lipo_3s_2200-driver_tb6612fng').verdict, 'PASS');
// Missing rating: the fuse records no voltage rating -> NOT_CHECKED, named.
const fuseCheck = byId(rover, 'voltage-lipo_3s_2200-fuse_inline');
assert.equal(fuseCheck.verdict, 'NOT_CHECKED');
assert.ok(fuseCheck.detail.includes('fuse_inline'));
// A hand-built direct over-voltage link is an ERROR...
const direct = JSON.parse(JSON.stringify(rover));
direct.forge.wiring = [{ from: 'lipo_3s_2200', to: 'gearmotor_12v', kind: 'power',
                         volts: 14.8, connector: 'test', why: 'direct test link' }];
const directChecks = runEngineChecks(direct, cat);
assert.equal(directChecks.find((c) => c.id === 'voltage-lipo_3s_2200-gearmotor_12v').verdict,
             'ERROR');
// ...and the same volts mediated through the driver is NOT an error
// (the Andino rule: the mediator's rating governs).
const mediated = JSON.parse(JSON.stringify(rover));
mediated.forge.wiring = [{ from: 'driver_tb6612fng', to: 'gearmotor_12v', kind: 'power',
                           volts: 14.8, connector: 'test', why: 'driver output to motor' }];
const medChecks = runEngineChecks(mediated, cat);
assert.equal(medChecks.find((c) => c.id === 'voltage-driver_tb6612fng-gearmotor_12v').verdict,
             'WARN');

// --- Print bed fit --------------------------------------------------
for (const p of rover.forge.prints) assert.equal(p.bed_fit, 'yes', p.name);
const huge = planPrints({ length_m: 0.3, width_m: 0.95, forge: { ids: { chassis: 'chassis_plate' } } }, cat);
assert.equal(huge.find((p) => p.name === 'Chassis plate').bed_fit, 'no',
             'a 950 mm wide plate cannot fit a 220 mm bed even tiled 2x2');

// --- Modifications --------------------------------------------------
const base2 = generateRobot(parseBrief('rover with lidar'), cat);
assert.ok(!base2.forge.bom.some((b) => b.partId === 'camera_rpi_v2'),
          'the modification base starts without a camera');
const mod = applyModification(base2, 'add a camera', cat);
assert.ok(mod, 'add a camera is in the grammar');
assert.ok(mod.spec.forge.bom.some((b) => b.partId === 'camera_rpi_v2'));
assert.ok(mod.spec.forge.placement.some((p) => p.role === 'camera'));
const diff = diffSpecs(base2, mod.spec);
assert.ok(diff.length > 0, 'the modification produces a spec diff');
assert.ok(diff.some((d) => d.path.startsWith('forge.bom')),
          'the diff names the BOM change');
const wider = applyModification(base2, 'make it wider', cat);
assert.ok(wider && wider.spec.width_m > base2.width_m, 'wider widens');
assert.equal(applyModification(base2, 'make it fly to the moon', cat), null,
             'unknown modification returns null — never a guess');
assert.equal(applyModification(mod.spec, 'add a camera', cat), null,
             'adding a second camera is refused, not duplicated');
// The bigger-battery swap surfaces its voltage consequence in checks.
const big = applyModification(base2, 'swap in a bigger battery', cat);
assert.ok(big && big.spec.battery.voltage_v === 14.8);
assert.equal(byId(big.spec, 'voltage-lipo_4s_5200-driver_tb6612fng').verdict, 'ERROR',
             '14.8 V direct into a 13.5 V-max driver must ERROR, not hide');

// --- Checks fire on a deliberately broken spec ----------------------
const broken = generateRobot(parseBrief('rover'), cat);
broken.motor.count = 99;
broken.forge.bom.push({ partId: 'flux_capacitor_9000', qty: 1, source: 'catalogue' });
const bc = runEngineChecks(broken, cat);
assert.equal(bc.find((c) => c.id === 'motor-count').verdict, 'ERROR');
assert.equal(bc.find((c) => c.id === 'unknown-parts').verdict, 'ERROR');
assert.ok(bc.find((c) => c.id === 'unknown-parts').detail.includes('flux_capacitor_9000'));
console.log('forge engine checks passed');
"""
    (tmp_path / "run.mjs").write_text(script)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs")],
        capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_all_archetype_selections_exist_in_the_catalogue():
    # The grounded archetype table, mirrored from the engine's NEEDS:
    # if a future catalogue edit drops one of these ids, the engine's
    # gather fallback (not invention) is the behaviour — flag it here.
    for pid in ["lipo_3s_2200", "lipo_4s_1500", "lipo_4s_5200", "liion_18650_3s",
                "driver_tb6612fng", "buck_converter_5v", "fuse_inline",
                "gearmotor_12v", "wheel_100mm", "mecanum_wheel_100mm",
                "caster_ball", "raspberry_pi_5", "teensy_41", "servo_mg996r",
                "gripper_2finger", "brushless_2207_1960kv", "esc_4in1_45a",
                "fc_f405_stack", "propeller_5040", "quad_frame_5inch",
                "elrs_receiver", "rplidar_a1", "camera_rpi_v2",
                "realsense_d435", "imu_bno055", "ultrasonic_hcsr04",
                "chassis_plate", "motor_mount", "lidar_mount",
                "camera_bracket", "ultrasonic_bracket"]:
        assert pid in CAT_IDS, pid


def test_ui_wiring_and_generated_source():
    # Generation's UI moved into the chat composer (2026-11-02,
    # Abel's direction): the Create panel owns the brief form and the
    # engine calls, and writes the same PLANNED 'generated' record
    # the Garage panel used to. The pins moved with it — disclosed
    # here rather than silently dropped.
    assert "Generate a robot" in CREATE_TSX
    # (2026-11-03: the Create panel now passes engineCatalogue() —
    # the built-in catalogue merged with confirmed web parts —
    # instead of the raw import; pin updated with the change.)
    assert "generateRobot(brief, engineCatalogue())" in CREATE_TSX
    assert "parseBrief(prompt" in CREATE_TSX
    assert "source: 'generated'" in CREATE_TSX
    assert "planned: true" in CREATE_TSX
    assert "label: 'Generated plan'" in CREATE_TSX
    # The Garage no longer carries a standalone Generate panel.
    assert "Generate a robot" not in GARAGE_TSX
    assert "source: 'generated'" in GARAGE_TSX
    assert "planned: true" in GARAGE_TSX
    assert "'generated'" in GARAGE_LIB
    assert "Generated by the Forge Engine" in GARAGE_LIB
    # spec.forge renders inside the EXISTING tabs, not new ones.
    assert "<ForgePlacement spec={draft} />" in GARAGE_TSX        # Overview
    assert "<ForgeBuild spec={draft} />" in GARAGE_TSX            # Build
    assert "<ForgeWiring spec={draft} />" in GARAGE_TSX           # Wiring
    assert "<ForgeChecks spec={draft} />" in GARAGE_TSX           # Checks
    # Modification saves a NEW version via the engine grammar.
    # (Since the web knowledge loop, 2026-11-03, the Modify box
    # passes the merged catalogue view — built-in + confirmed web
    # parts — held in the local `catalogue` variable.)
    assert "applyModification(draft, text, catalogue)" in GARAGE_TSX
    assert "diffSpecs(draft, mod.spec)" in GARAGE_TSX


def test_styles_live_in_the_css_source_of_truth():
    # ".forge-gen" (the removed Garage panel's own rules) left with
    # the panel in the composer move; the row/sensor rules stay —
    # the Modify box and the Create panel both use them.
    for cls in [".forge-block", ".forge-map", ".forge-dot", ".forge-list", ".forge-gen-row", ".forge-gen-sensors"]:
        assert cls in APP_CSS, cls
    assert ".forge-gen{" not in APP_CSS


def test_wrench_layer_never_imports_the_engine():
    assert "forgeEngine" not in WRENCH
    assert "forgeEngine" not in ENGINE
    assert "from './garage'" not in FORGE  # the engine stays standalone
    assert "import" not in FORGE.split("*/")[1].split("export interface")[0]
