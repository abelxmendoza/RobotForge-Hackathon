"""Omega1 as an owned Garage robot (2026-11-02): the adopt action,
the records-only seed, the connections wiring map, the twin ↔ Garage
link, scan → measured dimensions, the guided Improve-this-twin flow,
and the chat's recorded guidance for all of it.

Honesty pins that matter here:
  - the seed carries the DOCUMENTED template/extracted fields and
    NONE of the MEASURE_ME fields, and the vendor envelope
    (0.21/0.15/0.125 m) and the repo CODE_DEFAULT numbers (wheel
    radius 0.05, track 0.2, max rpm 300) never appear as spec values;
  - connections are seeded DOCUMENTED only, from the extraction's
    wiring table (PCA9685 channels, GPIO pins, I2C addresses);
  - the flow's done-states are computed from the store (attached
    slots, the scan-apply version note, MEASURE_ME presence,
    per-row confirmations) — executed in node against a fake store;
  - the chat answers the five guidance shapes from the recorded
    layer, and NO recorded answer claims wiring can be detected
    from a photo or scan.
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
GARAGE_DIR = WEB / "src/components/garage"

OMEGA_LIB = (LIB / "omega1Garage.ts").read_text()
GARAGE_LIB = (LIB / "garage.ts").read_text()
SCAN3D = (LIB / "scan3d.ts").read_text()
SCANSTORE = (LIB / "scanStore.ts").read_text()
GARAGE = (GARAGE_DIR / "Garage.tsx").read_text()
TWIN = (GARAGE_DIR / "Omega1Twin.tsx").read_text()
CONNECTIONS = (GARAGE_DIR / "ConnectionsSection.tsx").read_text()
IMPROVE = (GARAGE_DIR / "ImproveTwin.tsx").read_text()
SCAN_MEASURE = (GARAGE_DIR / "ScanMeasure.tsx").read_text()
PHOTOSPIN = (GARAGE_DIR / "PhotoSpin.tsx").read_text()
APP_CSS = (ROOT / "assets/css/app.css").read_text()
INTENTS = json.loads((ROOT / "assets/js/chat-intents.json").read_text())
TOPICS = {t["id"]: t for t in INTENTS["topics"]}

MEASURE_ME_KEYS = ("length_m", "width_m", "height_m", "ground_clearance_m",
                   "mass_kg", "capacity_mah", "diameter_m")


def _seed_fn() -> str:
    """The omega1SeedSpec function body, sliced out of the lib."""
    start = OMEGA_LIB.index("export function omega1SeedSpec")
    return OMEGA_LIB[start:]


# ------------------------------------------------------------------ adopt

def test_adopt_action_and_fixed_id():
    assert "export const OMEGA1_ROBOT_ID = 'omega1';" in OMEGA_LIB
    # Garage adopts with that fixed id, seeded from the records lib
    assert "const adoptOmega1 = () => {" in GARAGE
    assert "id: OMEGA1_ROBOT_ID, name: 'Omega1'" in GARAGE
    assert "omega1SeedSpec()" in GARAGE
    assert "source: OMEGA1_SEED_SOURCE" in GARAGE
    # shown only when no stored Omega1 exists: list entry + twin panel
    assert "Add Omega1 to your Garage" in GARAGE
    assert "Add Omega1 to your Garage" in TWIN
    assert "{!storedOmega1 && (" in GARAGE
    # VersionSource choice: 'repo' — the seed's fields were extracted
    # from Abel's Omega-Code repository; no other union member is true
    assert "OMEGA1_SEED_SOURCE: VersionSource = 'repo'" in OMEGA_LIB


def test_seed_documented_fields_and_measure_me_absences():
    seed = _seed_fn()
    # DOCUMENTED (template + extracted)
    assert "drivetrain: 'skid_steer'" in seed
    assert "wheel: { count: 4, driven: true }" in seed
    assert "motor: { count: 4, kind: 'dc_gearmotor' }" in seed
    assert "battery: { chemistry: 'liion', voltage_v: 7.4 }" in seed
    assert "kind: 'ultrasonic', position: 'front'" in seed
    assert "kind: 'rgb_camera', position: 'front'" in seed
    # MEASURE_ME: every field stays absent — asserted by name inside
    # the seed function (the names legitimately appear elsewhere in
    # the lib: the flow's form list and header comments)
    for key in MEASURE_ME_KEYS:
        assert key not in seed, f"MEASURE_ME field leaked into the seed: {key}"
    # voltage appears exactly once — the DOCUMENTED battery 7.4 V;
    # motor.voltage_v is MEASURE_ME and stays absent
    assert seed.count("voltage_v") == 1
    # the banned numbers: vendor envelope + CODE_DEFAULTs
    for banned in ("0.21", "0.15", "0.125", "radius_m", "track_m", "max_rpm", "300"):
        assert banned not in seed, f"banned value in the seed: {banned}"


# ------------------------------------------------------------- connections

def test_connections_seeded_documented_only():
    assert "export const OMEGA1_CONNECTIONS: SpecConnection[] = [" in OMEGA_LIB
    for bit in ("PCA9685 PWM hat", "7.4 V nominal pack",
                "PWM ch 1 fwd / ch 0 back", "PWM ch 2 fwd / ch 3 back",
                "PWM ch 7 fwd / ch 6 back", "PWM ch 5 fwd / ch 4 back",
                "PWM ch 8", "PWM ch 9", "I2C 0x40", "50 Hz",
                "GPIO 27 TRIG", "GPIO 22 ECHO", "GPIO 14 / 15 / 23",
                "ADS1115", "I2C 0x48", "OV5647", "CSI"):
        assert bit in OMEGA_LIB, f"seeded connection detail missing: {bit}"
    # every seeded row is DOCUMENTED — eleven rows, eleven badges
    # (counted inside the array literal; the type union names the
    # literal too)
    arr = OMEGA_LIB[OMEGA_LIB.index("OMEGA1_CONNECTIONS: SpecConnection[] = ["):]
    arr = arr[:arr.index("];")]
    assert arr.count("evidence: 'DOCUMENTED'") == 11
    assert "connections: OMEGA1_CONNECTIONS.map((c) => ({ ...c }))" in OMEGA_LIB


def test_connections_render_editor_and_badges():
    assert "Connections — where everything plugs in" in CONNECTIONS
    for badge in ("DOCUMENTED", "CODE_DEFAULT", "OWNER"):
        assert badge in CONNECTIONS
    # owner adds are stamped OWNER + ISO date; edits become OWNER too;
    # Confirm stamps verifiedAt without rewriting the evidence
    assert "evidence: 'OWNER', at: new Date().toISOString()" in CONNECTIONS
    assert "verifiedAt: new Date().toISOString()" in CONNECTIONS
    assert "Confirm" in CONNECTIONS
    assert "verify on the bench" in CONNECTIONS
    # mounted at the top of the Wiring tab for any robot with the field
    assert "<ConnectionsSection connections={draft.connections} onSave={saveConnections} />" in GARAGE
    assert "const saveConnections = (next: SpecConnection[]) => {" in GARAGE
    # a robot whose spec has no connections renders nothing
    assert "if (!Array.isArray(connections)) return null;" in CONNECTIONS


# ---------------------------------------------------------- twin ↔ garage

def test_twin_garage_link_panel():
    for bit in ("Your Omega1 in the Garage", "scan(s) attached",
                "Open your Omega1", "Improve this twin",
                "This twin is a built-in specimen"):
        assert bit in TWIN, f"twin Garage panel missing: {bit}"
    assert "garageScans={storedOmega1 ? (storedOmega1.scans?.length ?? (storedOmega1.scan ? 1 : 0)) : null}" in GARAGE
    assert "onOpenGarage={openStoredOmega1}" in GARAGE
    assert "onAdopt={adoptOmega1}" in GARAGE
    # the twin stays the estimated specimen in its own copy
    assert "ProjectSim reconstruction · estimated" in GARAGE


# ------------------------------------------------------- scan → measured

def test_scan_measure_apply_path():
    # the honest unit rule + axis convention come from the Forge scan
    # library, restated where the owner reads them
    assert "x → length, y → width, z → height" in SCAN_MEASURE
    assert "Use scan size as measured dimensions" in SCAN_MEASURE
    assert "not uploaded to RobotForge" in SCAN_MEASURE
    assert "showPreviewNote" in SCAN_MEASURE and "slotKind" in SCAN_MEASURE
    # mounted on the stored-robot scan card (generic path)
    assert "onApplyScanSize" in PHOTOSPIN
    assert "<ScanMeasure" in PHOTOSPIN
    # Garage saves it as ONE new version: measured dims, source
    # 'upload' (dimensions derived from an uploaded file), note
    # naming the scan and the unit rule that was applied
    assert "const applyScanSize = " in GARAGE
    assert "Dimensions measured from scan" in GARAGE
    assert "source: 'upload'" in GARAGE
    assert "onApplyScanSize={applyScanSize}" in GARAGE


# ------------------------------------------------------------ guided flow

def test_guided_flow_shape():
    # card on the stored Omega1's Overview only, overall progress
    assert "robot.id === OMEGA1_ROBOT_ID" in GARAGE
    assert "<ImproveTwin" in GARAGE
    assert "Improve this twin" in IMPROVE
    assert "{st.done} of 4 done" in IMPROVE
    for step in ("Step 1 · Add your scans",
                 "Step 2 · Measure from your RealSense scan",
                 "Step 3 · Add the tape-measure numbers",
                 "Step 4 · Check the wiring map"):
        assert step in IMPROVE, f"flow step missing: {step}"
    # step 2 waits honestly before any RealSense scan exists
    assert "Waiting for a RealSense scan (step 1)" in IMPROVE
    assert "Open the full wiring map" in IMPROVE
    assert "connections confirmed" in IMPROVE
    # step 3 saves the MEASURE_ME mini-form as ONE 'Measured' version
    assert "const saveMeasured = " in GARAGE
    assert "label: 'Measured'" in GARAGE
    assert "Measured on the real robot by the owner" in GARAGE
    assert len(re.findall(r"\{ path: '", OMEGA_LIB)) == 8
    # the three labelled slots, defined once in the scan lib
    for bit in ("Scaniverse scan (.ply)", "RealSense scan (.ply)",
                "Photo model (.glb)", "SCAN_SLOTS", "slotScanKey"):
        assert bit in SCAN3D, f"scan slot machinery missing: {bit}"
    for helper in ("saveSlotScanFile", "readSlotScanFile", "removeSlotScanFile"):
        assert helper in SCANSTORE, f"scanStore missing {helper}"
    assert "scans?: import('./scan3d').SlotScan[];" in GARAGE_LIB
    # drag-and-drop AND click-to-pick on the slots
    assert "onDrop" in IMPROVE and "input.current?.click()" in IMPROVE
    # big tap targets in the flow's CSS
    assert ".improve-btn{min-height:44px" in APP_CSS
    assert ".twin-garage-link" in APP_CSS and ".ws-conn-row" in APP_CSS


def test_step_states_execute_in_node(tmp_path):
    """improveStepStates + the seed run against a fake store."""
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    (tmp_path / "garage.ts").write_text(GARAGE_LIB)
    (tmp_path / "omega1Garage.ts").write_text(
        OMEGA_LIB.replace("from './garage'", "from './garage.ts'"))
    (tmp_path / "package.json").write_text('{"type":"module"}')
    script = """
import assert from 'node:assert/strict';
import { omega1SeedSpec, OMEGA1_CONNECTIONS, OMEGA1_MEASURE_FIELDS,
         improveStepStates } from './omega1Garage.ts';

const spec = omega1SeedSpec();
assert.equal(spec.drivetrain, 'skid_steer');
assert.equal(spec.wheel.count, 4);
assert.equal(spec.battery.voltage_v, 7.4);
const keys = [];
(function walk(o) { for (const [k, v] of Object.entries(o)) { keys.push(k);
  if (v && typeof v === 'object') walk(v); } })(spec);
for (const banned of ['length_m','width_m','height_m','ground_clearance_m',
                      'mass_kg','capacity_mah','diameter_m','radius_m','track_m'])
  assert.ok(!keys.includes(banned), 'seed carries ' + banned);
assert.equal(OMEGA1_CONNECTIONS.length, 11);
assert.ok(OMEGA1_CONNECTIONS.every((c) => c.evidence === 'DOCUMENTED'));
assert.equal(OMEGA1_MEASURE_FIELDS.length, 8);

const mk = (spec, extra = {}) => ({ id: 'omega1', name: 'Omega1',
  createdAt: '2026-11-02', versions: [{ id: 'v1', label: 'Baseline',
  note: 'seed', source: 'repo', createdAt: '2026-11-02', spec }], ...extra });

// fresh adopt: nothing done
let st = improveStepStates(mk(structuredClone(spec)), structuredClone(spec));
assert.deepEqual([st.scans, st.measured, st.numbers, st.wiring, st.done],
                 [false, false, false, false, 0]);
assert.equal(st.connTotal, 11);

// a scan attached: step 1 done
st = improveStepStates(mk(structuredClone(spec),
  { scans: [{ kind: 'realsense', name: 'rs.ply', format: 'ply', bytes: 3, addedAt: 'x' }] }),
  structuredClone(spec));
assert.equal(st.scans, true);

// the scan-apply version note: step 2 done (and only that note)
const r2 = mk(structuredClone(spec));
r2.versions.push({ id: 'v2', label: 'Measured', note: "Dimensions measured from scan 'rs.ply' (2026-11-02).",
                   source: 'upload', createdAt: '2026-11-02', spec: structuredClone(spec) });
assert.equal(improveStepStates(r2, structuredClone(spec)).measured, true);

// tape numbers: all 8 present -> step 3 done; partial counts
const full = structuredClone(spec);
full.length_m = 0.2; full.width_m = 0.15; full.height_m = 0.13;
full.ground_clearance_m = 0.02; full.wheel.diameter_m = 0.1;
full.wheel.width_m = 0.03; full.mass_kg = 1.4; full.battery.capacity_mah = 2200;
assert.equal(improveStepStates(mk(full), full).numbers, true);
const part = structuredClone(spec); part.mass_kg = 1.4;
assert.equal(improveStepStates(mk(part), part).numbersIn, 1);

// wiring: all rows confirmed -> step 4 done
const conf = structuredClone(spec);
conf.connections = conf.connections.map((c) => ({ ...c, verifiedAt: '2026-11-02' }));
st = improveStepStates(mk(conf), conf);
assert.equal(st.wiring, true);
assert.equal(st.confirmed, 11);
console.log('OK');
"""
    (tmp_path / "run.mjs").write_text(script)
    r = subprocess.run([node, str(tmp_path / "run.mjs")],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0 and "OK" in r.stdout, r.stderr[-2000:]


# ------------------------------------------------------------------- chat

GUIDANCE = {
    "app_overview": ("What can this app do?", ("Robodex", "Forge Tests", "Improve this twin")),
    "omega1_improve": ("How do I improve my Omega1 twin?", ("Improve this twin", "RealSense", "Scaniverse")),
    "measure_how": ("How do measurements work?", ("true metric", "relative scale")),
    "wiring_detection": ("Can it detect my wiring from a photo?", ("cannot see which pin", "No")),
    "scan_storage": ("Where do my scans live?", ("IndexedDB", "not uploaded")),
}


def test_guidance_topics_exist_with_samples():
    for tid, (_, bits) in GUIDANCE.items():
        assert tid in TOPICS, f"guidance topic missing: {tid}"
        topic = TOPICS[tid]
        assert topic.get("samples"), f"{tid} needs samples (fallback chips)"
        for bit in bits:
            assert bit in topic["answer"], f"{tid} answer missing: {bit}"
    # the overview is also a suggestion chip now
    assert "How do I improve my Omega1 twin?" in INTENTS["suggestions"]


def test_no_recorded_answer_claims_wiring_detection():
    """The honesty rule, over the WHOLE table: no answer may claim
    wiring/connections can be detected (automatically or otherwise)
    from a photo or scan. Negations ('can never', 'cannot') pass."""
    claim = re.compile(
        r"(can|will|does|automatically)\s+(automatically\s+)?detect", re.I)
    for tid, topic in TOPICS.items():
        assert not claim.search(topic.get("answer", "")), \
            f"topic {tid} appears to claim detection"


def test_guidance_answers_execute_in_the_recorded_engine(tmp_path):
    """Drive the real wrench layer (compiled with the repo's tsc,
    same harness shape as tests/test_chat_tier1_eval.py) with the
    five guidance shapes: each must be a RECORDED answer — not the
    honest fallback — carrying its key facts."""
    node = shutil.which("node")
    tsc = WEB / "node_modules/.bin/tsc"
    if not node or not tsc.exists():
        pytest.skip("node/tsc unavailable — source pins above still ran")
    engine_ts = WEB / "src/components/chat/engine.ts"
    wrench_ts = WEB / "src/components/chat/wrench.ts"
    build = tmp_path / "build"
    r = subprocess.run(
        [str(tsc), str(engine_ts), str(wrench_ts), "--module", "commonjs",
         "--target", "es2020", "--moduleResolution", "node",
         "--skipLibCheck", "--outDir", str(build)],
        capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stderr[-2000:]
    driver = r"""
const fs = require('fs');
const path = require('path');
const load = p => JSON.parse(fs.readFileSync(path.join(process.argv[3], p), 'utf8'));
const wrenchMod = require(path.join(process.argv[2], 'wrench.js'));
const partsDoc = load('catalog/parts.json');
const wrench = wrenchMod.createWrench({
  robots: load('catalog/robots.json').robots,
  parts: partsDoc.parts,
  templates: partsDoc.templates.length,
  templateList: partsDoc.templates,
  kinds: load('catalog/kinds.json').kinds,
  reports: load('catalog/gate-reports.json'),
  intents: load('assets/js/chat-intents.json'),
  root: ''
});
const spec = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const out = {};
for (const c of spec.cases) {
  const r = wrench.answerTurn(c.q, {});
  out[c.id] = { html: r.html, fallback: !!r.fallback };
}
console.log(JSON.stringify(out));
"""
    (tmp_path / "drive.js").write_text(driver)
    cases = [{"id": tid, "q": q} for tid, (q, _) in GUIDANCE.items()]
    cases += [{"id": "add_scan", "q": "How do I add a scan?"},
              {"id": "scan_uploaded", "q": "Are my scans uploaded?"}]
    spec_file = tmp_path / "cases.json"
    spec_file.write_text(json.dumps({"cases": cases}))
    r = subprocess.run([node, str(tmp_path / "drive.js"), str(build),
                        str(ROOT), str(spec_file)],
                       capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stderr[-2000:]
    out = json.loads(r.stdout)
    expect = dict(GUIDANCE)
    expect["add_scan"] = ("How do I add a scan?", ("Improve this twin", "RealSense"))
    expect["scan_uploaded"] = ("Are my scans uploaded?", ("not uploaded",))
    for cid, (_, bits) in expect.items():
        got = out[cid]
        assert not got["fallback"], f"{cid} fell back instead of answering"
        text = re.sub(r"<[^>]+>", " ", got["html"])
        for bit in bits:
            assert bit in text, f"{cid} answer missing: {bit}"
