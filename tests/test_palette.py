"""Parts palette (web-next): the Kit page's parts grid, drag-and-drop
placements, the shared build list, and the chat's build commands.

Two layers, following the repo's node-test pattern (the real TS
runs in node against the real catalogue data):

1. Static wiring + honesty: the palette button and panel are in
   the Kit viewer, the scene takes placed props and palette drops
   (raycast to the ground plane), the palette never references the
   catalogue's AI-illustration part images, the chat runs the build
   grammar against the shared list, and the BOM wizard starts from
   that same list.
2. Node unit tests: palette construction (provenance + reality
   split), the deterministic phrase matcher (match / ambiguous /
   none), the chat request parser (quantities, not-found naming,
   robot-directed requests refused), build-list operations, and
   the build list → BOM lines conversion.
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

def test_palette_is_wired_into_the_kit_viewer():
    viewer = (WEB / "src/components/kit/KitViewer.tsx").read_text()
    assert "PartsPalette" in viewer
    assert "Parts palette" in viewer
    assert "useBuildList" in viewer
    assert "onCanvasDrop" in viewer
    palette = (WEB / "src/components/kit/PartsPalette.tsx").read_text()
    assert "buildPaletteItems" in palette
    assert "Your build list" in palette
    assert "/bom/" not in palette  # BOM wizard retired 2026-11-01


def test_scene_places_dropped_props_at_the_drop_point():
    scene = (WEB / "src/components/kit/KitScene.tsx").read_text()
    assert "placedProps" in scene
    assert "dropsGroup" in scene
    assert "application/x-rf-palette" in scene
    # The drop point is the raycast onto the ground plane, not a
    # fixed offset — the PR's claim depends on this line existing.
    assert "intersectPlane" in scene


def test_palette_picture_provenance_is_honest():
    palette = (WEB / "src/components/kit/PartsPalette.tsx").read_text()
    # The catalogue's part images are AI illustrations: the palette
    # must not present them as part pictures.
    assert "assets/img/parts" not in palette
    assert ".image" not in palette
    assert "No image" in palette
    assert "AI illustrations" in palette
    # Prop pictures are renders of the actual GLB (PropThumb), and
    # the caption says so.
    assert "PropThumb" in palette
    assert "Live render of the actual model" in palette
    thumb = (WEB / "src/components/kit/PropThumb.tsx").read_text()
    assert "GLTFLoader" in thumb
    assert "toDataURL" in thumb


def test_chat_and_wizard_share_the_build_list():
    dock = (WEB / "src/components/chat/ChatDock.tsx").read_text()
    assert "parseBuildRequest" in dock
    assert "BUILD_KEY" in dock
    build_list = (LIB / "buildList.ts").read_text()
    assert 'BUILD_KEY = "rf.build.v1"' in build_list
    sync = (WEB / "scripts/sync-data.mjs").read_text()
    assert "simready-props.json" in sync


# ---------------------------------------------------------------- node units

UNIT_SCRIPT = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = process.argv[2];
const load = p => JSON.parse(fs.readFileSync(root + '/' + p, 'utf8'));
const partsDoc = load('catalog/parts.json');
const propsDoc = load('catalog/props/simready/props.json');
const P = await import('./palette.ts');

const items = P.buildPaletteItems(partsDoc.parts, propsDoc.props);
const byKey = new Map(items.map(i => [i.key, i]));

// --- construction: provenance + reality split ---
assert.equal(items.length, 53);
assert.equal(items.filter(i => i.hasModel).length, 3);
assert.equal(byKey.get('prop:crate').reality, 'sim_only');
assert.equal(byKey.get('prop:crate').hasModel, true);
assert.equal(byKey.get('part:realsense_d435').reality, 'real');
assert.equal(byKey.get('part:realsense_d435').hasModel, false);
assert.ok(byKey.get('prop:drill').sourceLabel.includes('SimReady'));

// --- matcher ---
assert.equal(P.matchPhrase('realsense camera', items).item.refId, 'realsense_d435');
assert.equal(P.matchPhrase('rplidar', items).item.refId, 'rplidar_a1');
assert.equal(P.matchPhrase('crate', items).item.refId, 'crate');
assert.equal(P.matchPhrase('flux capacitor', items).status, 'none');
const wheels = P.matchPhrase('66 mm wheels', items);
assert.equal(wheels.status, 'ambiguous');
assert.deepEqual(wheels.options.map(o => o.refId).sort(), ['mecanum_wheel_100mm', 'wheel_100mm']);
const battery = P.matchPhrase('battery', items);
assert.equal(battery.status, 'ambiguous');
assert.ok(battery.options.length >= 3);

// --- chat request parsing ---
const robots = ['Omega1', 'Andino'];
const r1 = P.parseBuildRequest('add a RealSense camera and two 66 mm wheels to my build', items, robots);
assert.deepEqual(r1.adds.map(a => [a.item.refId, a.qty]), [['realsense_d435', 1]]);
assert.equal(r1.ambiguous.length, 1);
assert.equal(r1.ambiguous[0].phrase, '66 mm wheels');
assert.equal(r1.ambiguous[0].qty, 2);
assert.deepEqual(r1.notFound, []);

const r2 = P.parseBuildRequest('Add a RealSense camera and an RPLIDAR A1 to my build', items, robots);
assert.deepEqual(r2.adds.map(a => [a.item.refId, a.qty]), [['realsense_d435', 1], ['rplidar_a1', 1]]);

const r3 = P.parseBuildRequest('add 2 cordless drills and a storage crate', items, robots);
assert.deepEqual(r3.adds.map(a => [a.item.refId, a.qty]), [['drill', 2], ['crate', 1]]);

const r4 = P.parseBuildRequest('add a flux capacitor to my build', items, robots);
assert.deepEqual(r4.adds, []);
assert.deepEqual(r4.notFound, ['flux capacitor']);
assert.equal(P.parseBuildRequest('add a flux capacitor', items, robots), null);
assert.equal(P.parseBuildRequest('add a Jetson Orin Nano to "Omega1"', items, robots), null);
assert.equal(P.parseBuildRequest('add a Jetson Orin Nano to Omega1', items, robots), null);
assert.equal(P.parseBuildRequest('what is a lidar?', items, robots), null);
assert.equal(P.parseBuildRequest('add two wheels to the garage', items, robots), null);

// --- build list operations ---
let n = 0;
const uid = () => 'u' + (++n);
let entries = [];
entries = P.addToBuildList(entries, byKey.get('part:gearmotor_12v'), 2, 'palette', uid);
entries = P.addToBuildList(entries, byKey.get('part:gearmotor_12v'), 3, 'chat', uid);
assert.equal(entries.length, 1);
assert.equal(entries[0].qty, 5);
entries = P.addToBuildList(entries, byKey.get('prop:drill'), 2, 'chat', uid);
const drills = entries.filter(e => e.refId === 'drill');
assert.equal(drills.length, 2);
assert.ok(drills.every(d => d.qty === 1 && d.pos && Math.hypot(d.pos[0], d.pos[1]) <= 0.46));
assert.notEqual(drills[0].uid, drills[1].uid);
entries = P.addToBuildList(entries, byKey.get('prop:crate'), 1, 'palette', uid, [0.12, -0.2]);
const crate = entries.find(e => e.refId === 'crate');
assert.deepEqual(crate.pos, [0.12, -0.2]);
entries = P.setBuildQty(entries, entries[0].uid, 4);
assert.equal(entries[0].qty, 4);
entries = P.removeFromBuildList(entries, crate.uid);
assert.equal(entries.some(e => e.refId === 'crate'), false);

// --- build list -> BOM lines ---
const partsById = new Map(partsDoc.parts.map(p => [p.id, p]));
const propsById = new Map(propsDoc.props.map(p => [p.id, p]));
const lines = P.buildListToBomLines(entries, partsById, propsById);
const gear = lines.find(l => l.key === 'part:gearmotor_12v');
assert.equal(gear.qty, 4);
assert.ok(gear.sourceLabel.includes('build list'));
const drillLine = lines.find(l => l.key === 'prop:drill');
assert.equal(drillLine.qty, 2);
assert.ok(drillLine.note.includes('sim only'));

// --- default scene slots are deterministic and on the stage ---
assert.deepEqual(P.defaultScenePos(0), P.defaultScenePos(0));
for (let i = 0; i < 8; i++) {
  const [x, y] = P.defaultScenePos(i);
  assert.ok(Math.hypot(x, y) <= 0.46, 'slot ' + i + ' off the ground disc');
}

// --- confirmation text names everything ---
const text = P.buildConfirmationText(r1);
assert.ok(text.includes('1 × Intel RealSense D435 depth camera'));
assert.ok(text.includes('66 mm wheels'));
assert.ok(text.includes('Wheel 100 mm diameter'));
const emptyText = P.buildConfirmationText(r4);
assert.ok(emptyText.includes('Nothing was added'));
assert.ok(emptyText.includes('flux capacitor'));
console.log('palette unit checks passed');
"""


def _prep_unit_dir(tmp: Path) -> None:
    (tmp / "package.json").write_text('{"type":"module"}')
    sourcing = (LIB / "sourcing.ts").read_text()
    (tmp / "sourcing.ts").write_text(sourcing)
    bom = (LIB / "bom.ts").read_text().replace('"./sourcing"', '"./sourcing.ts"')
    (tmp / "bom.ts").write_text(bom)
    palette = (LIB / "palette.ts").read_text()
    palette = palette.replace('"./bom"', '"./bom.ts"').replace(
        '"./sourcing"', '"./sourcing.ts"')
    (tmp / "palette.ts").write_text(palette)
    (tmp / "node_modules").symlink_to(WEB / "node_modules")


def test_palette_units_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    _prep_unit_dir(tmp_path)
    (tmp_path / "run.mjs").write_text(UNIT_SCRIPT)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs"), str(REPO)],
        capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, result.stdout + result.stderr
