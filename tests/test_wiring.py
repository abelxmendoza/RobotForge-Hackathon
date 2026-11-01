"""Build-list wiring (web-next): ports from recorded catalogue
data, the schematic 3D wiring view, graph checks, the chat's
wiring grammar, and the BOM harness section.

Two layers, following the repo's node-test pattern (the real TS
runs in node against the real catalogue data):

1. Static wiring + honesty: the Wiring toggle and panel are in
   the Kit viewer, the scene renders the wiring layer from the
   shared harness curve, the chat runs the wiring grammar against
   rf.wiring.v1 (with its demo twin), and the BOM wizard's exports
   gain the harness section.
2. Node unit tests: port derivation (counts + spot checks + the
   no-invention cases), graph operations, the three checks
   (positive, propagated and abstain cases), the chat grammar
   (connect / ambiguous / query / disconnect / check, named
   refusals, robot-directed and fall-through nulls), demo key
   resolution, the schematic layout, and the harness export.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web-next"
LIB = WEB / "src/lib"


# ---------------------------------------------------------------- wiring

def test_wiring_is_wired_into_the_kit_viewer():
    viewer = (WEB / "src/components/kit/KitViewer.tsx").read_text()
    assert 'id="wiringBtn"' in viewer
    assert "WiringPanel" in viewer
    assert "useBuildWiring" in viewer
    assert "addConnection" in viewer
    assert "deviceBoxes" in viewer
    panel = (WEB / "src/components/kit/WiringPanel.tsx").read_text()
    assert "Schematic wiring" in panel
    assert "diagrammatic, not measured" in panel
    assert "no ports:" in panel
    assert "Not checked:" in panel


def test_scene_renders_the_wiring_layer():
    scene = (WEB / "src/components/kit/KitScene.tsx").read_text()
    assert "wiringGroup" in scene
    assert "cableControlPoints" in scene
    assert "TubeGeometry" in scene
    assert "onPortClick" in scene
    assert "onWireClick" in scene
    assert "portKey" in scene


def test_chat_and_wizard_share_the_wiring_state():
    dock = (WEB / "src/components/chat/ChatDock.tsx").read_text()
    assert "runWiringCommand" in dock
    assert "readBuildWiring" in dock
    store = (LIB / "wiringStore.ts").read_text()
    assert 'WIRING_KEY = "rf.wiring.v1"' in store
    assert "resolveWiringKey" in store
    assert ".demo" in store


def test_data_reality_counts():
    doc = json.loads((REPO / "catalog/parts.json").read_text())
    parts = doc["parts"]
    assert len(parts) == 50
    with_iface = [
        p for p in parts
        if (p.get("specs") or {}).get("interface")
        or (p.get("specs") or {}).get("interfaces")
    ]
    # 13 parts record an interface; the port count (25) is higher
    # because power data (voltage/supply/cells) also makes ports —
    # the exact split is asserted in node, against the real code.
    assert len(with_iface) == 13


# ---------------------------------------------------------------- node units

UNIT_SCRIPT = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = process.argv[2];
const load = p => JSON.parse(fs.readFileSync(root + '/' + p, 'utf8'));
const partsDoc = load('catalog/parts.json');
const propsDoc = load('catalog/props/simready/props.json');
const parts = partsDoc.parts;
const partsById = new Map(parts.map(p => [p.id, p]));
const P = await import('./palette.ts');
const W = await import('./buildWiring.ts');
const S = await import('./wiringStore.ts');
const items = P.buildPaletteItems(parts, propsDoc.props);
let n = 0;
const mk = () => 'id' + (++n);
const entry = (refId, qty = 1) => ({
  uid: 'e-' + refId, kind: 'catalog-part', refId, qty, via: 'chat', pos: null,
});
const byId = id => partsById.get(id);

// --- port derivation: the data reality ---
const withPorts = parts.filter(p => W.portsForPart(p).ports.length > 0);
assert.equal(withPorts.length, 25);
assert.equal(parts.length - withPorts.length, 25);
const bat = W.portsForPart(byId('lipo_4s_5200')).ports;
assert.deepEqual(bat.map(p => [p.id, p.dir, p.volts]), [['power-out', 'out', 14.8]]);
const tb = W.portsForPart(byId('driver_tb6612fng')).ports;
assert.equal(tb.find(p => p.id === 'power-in').ratedMaxV, 15);
assert.ok(tb.some(p => p.id === 'motor-out'));
const mg = W.portsForPart(byId('servo_mg996r')).ports;
assert.equal(mg.find(p => p.id === 'pwm').dir, 'in');
assert.deepEqual(mg.find(p => p.id === 'power-in').rangeV, [4.8, 7.2]);
const esp = W.portsForPart(byId('esp32_devkit'));
assert.deepEqual(esp.ports.map(p => p.bus).sort(), ['i2c', 'pwm', 'spi', 'uart']);
assert.ok(esp.wireless.includes('Wi-Fi'));
assert.ok(!esp.ports.some(p => p.type === 'power')); // supply not recorded
// No invention: fields that record no connector make no port.
assert.equal(W.portsForPart(byId('ultrasonic_hcsr04')).ports.length, 0); // logic_v only
assert.equal(W.portsForPart(byId('stepper_nema17')).ports.length, 0);
assert.equal(W.portsForPart(byId('fc_f405_stack')).ports.length, 0);
assert.equal(W.portsForPart(byId('wheel_100mm')).ports.length, 0);
const jet = W.portsForPart(byId('jetson_orin_nano')).ports;
assert.equal(jet.find(p => p.id === 'power-in').volts, 5); // recorded supply line
assert.ok(jet.some(p => p.bus === 'usb'));

// --- graph operations ---
const B = entry('lipo_4s_5200'), D = entry('driver_tb6612fng'),
      M = entry('gearmotor_12v'), C = entry('realsense_d435'),
      J = entry('jetson_orin_nano'), SV = entry('servo_mg996r'),
      E = entry('esp32_devkit');
const entries = [B, D, M, C, J, SV, E];
let w = { connections: [] };
let r = W.addConnection(entries, w, partsById, B.uid, 'power-out', D.uid, 'power-in', mk);
assert.ok(r.ok); w = r.wiring;
assert.equal(w.connections[0].fromEntry, B.uid); // out -> in normalised
r = W.addConnection(entries, w, partsById, M.uid, 'power-in', D.uid, 'motor-out', mk);
assert.ok(r.ok); w = r.wiring;
assert.equal(w.connections[1].fromEntry, D.uid); // flipped to out -> in
r = W.addConnection(entries, w, partsById, B.uid, 'power-out', D.uid, 'power-in', mk);
assert.equal(r.ok, false); assert.ok(r.error.includes('already exists'));
r = W.addConnection(entries, w, partsById, B.uid, 'power-out', C.uid, 'usb', mk);
assert.equal(r.ok, false); // power into USB: incompatible
r = W.addConnection(entries, w, partsById, B.uid, 'power-out', B.uid, 'power-out', mk);
assert.equal(r.ok, false); // itself
r = W.addConnection(entries, w, partsById, B.uid, 'nope', D.uid, 'power-in', mk);
assert.equal(r.ok, false); // unknown port
// Resolution prunes cables whose entry left the build.
const resolved = W.resolveConnections(entries.filter(e => e !== M), w, partsById);
assert.equal(resolved.length, 1);

// --- checks: unpowered, propagated mismatch, abstentions ---
r = W.addConnection(entries, w, partsById, C.uid, 'usb', J.uid, 'usb', mk);
assert.ok(r.ok); w = r.wiring;
const nameOf = e => e.refId;
let checks = W.wiringChecks(entries, w, partsById, nameOf);
const kinds = checks.issues.map(i => i.kind + ':' + (i.entryUid ?? i.connectionId));
assert.ok(checks.issues.some(i => i.kind === 'unpowered' && i.entryUid === SV.uid));
assert.ok(checks.issues.some(i => i.kind === 'unpowered' && i.entryUid === J.uid));
// 14.8 V through the driver into the 12 V motor: a real mismatch,
// found by propagation, citing both recorded numbers.
const mm = checks.issues.find(i => i.kind === 'voltage-mismatch');
assert.ok(mm && mm.evidence.includes('14.8') && mm.evidence.includes('12'));
// The driver itself is fine: 14.8 <= its recorded 15 V max.
assert.ok(!checks.issues.some(i =>
  i.kind === 'voltage-mismatch' && i.message.includes('driver_tb6612fng') &&
  i.message.includes('into driver_tb6612fng')));
// The camera has no power input recorded: not flagged, abstained.
assert.ok(!checks.issues.some(i => i.entryUid === C.uid));
assert.ok(checks.abstentions.some(a => a.includes('2 parts')));

// Direct mismatch, both point values recorded.
let w2 = { connections: [] };
r = W.addConnection(entries, w2, partsById, B.uid, 'power-out', M.uid, 'power-in', mk);
assert.ok(r.ok); w2 = r.wiring;
checks = W.wiringChecks(entries, w2, partsById, nameOf);
assert.ok(checks.issues.some(i => i.kind === 'voltage-mismatch'));
// Range: the same battery into the servo's 4.8-7.2 V input.
let w3 = { connections: [] };
r = W.addConnection(entries, w3, partsById, B.uid, 'power-out', SV.uid, 'power-in', mk);
assert.ok(r.ok); w3 = r.wiring;
checks = W.wiringChecks(entries, w3, partsById, nameOf);
assert.ok(checks.issues.some(i =>
  i.kind === 'voltage-mismatch' && i.message.includes('outside its recorded')));
// A clean chain: battery -> buck -> Jetson is powered and matched.
const BK = entry('buck_converter_5v');
const entries2 = [B, BK, J];
let w4 = { connections: [] };
r = W.addConnection(entries2, w4, partsById, B.uid, 'power-out', BK.uid, 'power-in', mk);
assert.ok(r.ok); w4 = r.wiring;
r = W.addConnection(entries2, w4, partsById, BK.uid, 'power-out', J.uid, 'power-in', mk);
assert.ok(r.ok); w4 = r.wiring;
checks = W.wiringChecks(entries2, w4, partsById, nameOf);
assert.deepEqual(checks.issues, []);
// Abstain: an unfed driver's motor-out into a 7.4 V motor — the
// delivered voltage is unknown, so no mismatch is claimed and
// the abstention says the cable went unchecked.
const BM = entry('brushed_motor_540');
const entries3 = [D, BM];
let w5 = { connections: [] };
r = W.addConnection(entries3, w5, partsById, D.uid, 'motor-out', BM.uid, 'power-in', mk);
assert.ok(r.ok); w5 = r.wiring;
checks = W.wiringChecks(entries3, w5, partsById, nameOf);
assert.ok(!checks.issues.some(i => i.kind === 'voltage-mismatch'));
assert.ok(checks.abstentions.some(a => a.includes('not voltage-checked')));
// Duplicate cables in stored data are reported, not hidden.
const dup = { connections: [w.connections[0], { ...w.connections[0], id: 'other' }] };
checks = W.wiringChecks(entries, dup, partsById, nameOf);
assert.ok(checks.issues.some(i => i.kind === 'duplicate'));

// --- the chat grammar ---
const L = entry('rplidar_a1'), IM = entry('imu_bno055');
const centries = [C, J, L, E];
const robots = ['Omega1'];
let out = W.runWiringCommand('wire the camera to the Orin', centries, { connections: [] }, partsById, items, robots, mk);
assert.ok(out && out.wiring && out.wiring.connections.length === 1);
assert.ok(out.text.includes('Wired'));
let cw = out.wiring;
// Two buses fit the lidar and the Jetson: the grammar asks.
out = W.runWiringCommand('wire the lidar to the jetson', centries, cw, partsById, items, robots, mk);
assert.ok(out && !out.wiring && out.text.includes('more than one way'));
out = W.runWiringCommand('wire the lidar to the jetson over usb', centries, cw, partsById, items, robots, mk);
assert.ok(out && out.wiring.connections.length === 2);
cw = out.wiring;
out = W.runWiringCommand('what is the camera plugged into', centries, cw, partsById, items, robots, mk);
assert.ok(out && out.text.includes('Jetson Orin Nano'));
out = W.runWiringCommand('disconnect the camera from the jetson', centries, cw, partsById, items, robots, mk);
assert.ok(out && out.wiring.connections.length === 1);
cw = out.wiring;
out = W.runWiringCommand('disconnect the lidar', centries, cw, partsById, items, robots, mk);
assert.ok(out && out.wiring.connections.length === 0);
out = W.runWiringCommand('check my wiring', centries, cw, partsById, items, robots, mk);
assert.ok(out && out.text.includes('Wiring check'));
out = W.runWiringCommand("what's unpowered", centries, cw, partsById, items, robots, mk);
assert.ok(out && out.text.includes('Wiring check'));
// Named refusals: in the palette but not the build; not anywhere.
out = W.runWiringCommand('wire the imu to the esp32', centries, cw, partsById, items, robots, mk);
assert.ok(out && !out.wiring && out.text.includes('not in your build list'));
out = W.runWiringCommand('wire the flux capacitor to the jetson', centries, cw, partsById, items, robots, mk);
assert.ok(out && !out.wiring && out.text.includes('flux capacitor'));
// A servo wires to an ESP32 by PWM alone — the power side stays
// unwired and the check will flag it, which is the honest story.
const sentries = [SV, E];
out = W.runWiringCommand('wire the servo to the esp32', sentries, { connections: [] }, partsById, items, robots, mk);
assert.ok(out && out.wiring && out.wiring.connections[0].type === 'signal');
// Refusals that keep other grammars' meanings: null, not handled.
assert.equal(W.runWiringCommand('wire the camera to Omega1', centries, cw, partsById, items, robots, mk), null);
assert.equal(W.runWiringCommand('wire "camera" to the orin', centries, cw, partsById, items, robots, mk), null);
assert.equal(W.runWiringCommand('what time is it', centries, cw, partsById, items, robots, mk), null);
assert.equal(W.runWiringCommand('add a crate to my build', centries, cw, partsById, items, robots, mk), null);
assert.equal(W.runWiringCommand('go to wiring', centries, cw, partsById, items, robots, mk), null);

// --- demo isolation of the storage key ---
assert.equal(S.WIRING_KEY, 'rf.wiring.v1');
assert.equal(S.resolveWiringKey(false), 'rf.wiring.v1');
assert.equal(S.resolveWiringKey(true), 'rf.wiring.v1.demo');

// --- schematic layout ---
const WHEEL = entry('wheel_100mm');
const boxes = W.deviceBoxes([B, WHEEL, J], partsById);
assert.equal(boxes.length, 2); // the wheel has no ports: no block
for (const b of boxes) {
  assert.ok(Math.abs(b.center[0]) <= 0.42 && (b.center[1] === -0.4 || b.center[1] === 0.42));
  assert.ok(b.size.every(s => s > 0));
}
const jbox = boxes.find(b => b.entryUid === J.uid);
const anchors = W.portAnchors(jbox, W.portsForPart(byId('jetson_orin_nano')).ports);
assert.equal(anchors.get('power-in')[0], jbox.center[0] - jbox.size[0] / 2);
assert.equal(anchors.get('usb')[0], jbox.center[0] + jbox.size[0] / 2);
assert.equal(anchors.get('gpio')[1], jbox.center[1] - jbox.size[1] / 2);

// --- the BOM harness section ---
const harness = W.harnessText(entries, w, partsById, nameOf);
assert.ok(harness.includes('Wiring harness'));
assert.ok(harness.includes('diagrammatic, not measured'));
assert.equal(W.harnessText(entries, { connections: [] }, partsById, nameOf), '');
const csvRows = W.harnessCsvRows(entries, w, partsById, nameOf);
assert.equal(csvRows.length, w.connections.length);
assert.ok(csvRows.every(r => r[2].startsWith('wiring · ')));
assert.ok(W.harnessCsv(entries, w, partsById, nameOf).includes('→'));

console.log('wiring unit checks passed');
"""


def _prep_unit_dir(tmp: Path) -> None:
    (tmp / "package.json").write_text('{"type":"module"}')
    (tmp / "sourcing.ts").write_text((LIB / "sourcing.ts").read_text())
    bom = (LIB / "bom.ts").read_text().replace('"./sourcing"', '"./sourcing.ts"')
    (tmp / "bom.ts").write_text(bom)
    palette = (LIB / "palette.ts").read_text()
    palette = palette.replace('"./bom"', '"./bom.ts"').replace(
        '"./sourcing"', '"./sourcing.ts"')
    (tmp / "palette.ts").write_text(palette)
    (tmp / "types.ts").write_text((LIB / "types.ts").read_text())
    bw = (LIB / "buildWiring.ts").read_text()
    bw = bw.replace('"./palette"', '"./palette.ts"').replace(
        '"./types"', '"./types.ts"')
    (tmp / "buildWiring.ts").write_text(bw)
    store = (LIB / "store.ts").read_text().replace(
        "'./demoMode'", "'./demoMode.ts'")
    (tmp / "store.ts").write_text(store)
    (tmp / "demoMode.ts").write_text((LIB / "demoMode.ts").read_text())
    ws = (LIB / "wiringStore.ts").read_text()
    ws = ws.replace('"./store"', '"./store.ts"').replace(
        '"./buildWiring"', '"./buildWiring.ts"')
    (tmp / "wiringStore.ts").write_text(ws)
    (tmp / "node_modules").symlink_to(WEB / "node_modules")


def test_wiring_units_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    _prep_unit_dir(tmp_path)
    (tmp_path / "run.mjs").write_text(UNIT_SCRIPT)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs"), str(REPO)],
        capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, result.stdout + result.stderr
