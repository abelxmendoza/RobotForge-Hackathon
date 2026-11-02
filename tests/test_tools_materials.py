"""Tools & materials: on hand vs simulated (Forge Engine §11).

Two layers, following the repo's node-test pattern:

1. Static wiring + honesty: the catalogues record the ownership
   field (simulated by default — nothing claimed owned without a
   record), the sync carries both catalogues into the app, the
   ownership store gets a demo twin, the demo seed labels its demo
   state, the Workshop has the tab, and neither the tab nor the
   lib ever touches the network.
2. Node unit tests: the real lib against the real catalogues —
   ownership resolution (flip > record > simulated default), the
   derived profile (an on-hand printer contributes its recorded
   build volume as the bed and "3d_printer" as a tool; a simulated
   one derives NOTHING), price normalization with basis + expiry,
   and print-fit against a printer's recorded volume.
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

def _catalog(name):
    return json.loads((REPO / "catalog" / name).read_text())


def test_catalogues_record_ownership_simulated_by_default():
    for name, key in (("tools.json", "tools"), ("materials.json", "materials")):
        for rec in _catalog(name)[key]:
            assert rec.get("ownership") in ("on_hand", "simulated"), rec["id"]
            # Nothing in the shipped catalogues is claimed owned:
            # Abel's on-hand set is seeded only from records, and
            # no record proves ownership of these.
            assert rec["ownership"] == "simulated", rec["id"]


def test_sync_and_data_layer_carry_the_catalogues():
    sync = (WEB / "scripts/sync-data.mjs").read_text()
    assert '"tools.json"' in sync and '"materials.json"' in sync
    data = (LIB / "data.ts").read_text()
    assert "tmItemsFromCatalog" in data
    assert "toolMaterialItems" in data


def test_ownership_store_gets_a_demo_twin_and_demo_seed():
    demo = (LIB / "demoMode.ts").read_text()
    assert "'rf.ownership.v1'" in demo
    seed = (LIB / "demoSeed.ts").read_text()
    assert "OWNERSHIP_KEY + '.demo'" in seed


def test_workshop_has_the_tab_and_it_is_offline():
    garage = (WEB / "src/components/garage/Garage.tsx").read_text()
    assert "'tools'" in garage and "Tools & Materials" in garage
    assert "ToolsMaterialsTab" in garage
    tab = (WEB / "src/components/garage/ToolsMaterialsTab.tsx").read_text()
    assert "OWNERSHIP_KEY" in tab and "OWNERSHIP_LABEL" in tab
    for banned in ("fetch(", "postJSON", "liveHealth"):
        assert banned not in tab, banned
    lib = (LIB / "toolsMaterials.ts").read_text()
    for banned in ("fetch(", "postJSON", "liveHealth", "localStorage"):
        assert banned not in lib, banned
    assert 'OWNERSHIP_KEY = "rf.ownership.v1"' in lib


def test_state_vocabulary_is_the_plans():
    lib = (LIB / "toolsMaterials.ts").read_text()
    assert '"On hand"' in lib and '"Simulated"' in lib
    assert "deriveProfile" in lib and "ownershipOf" in lib


# ---------------------------------------------------------------- node units

UNIT_SCRIPT = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = process.argv[2];
const load = p => JSON.parse(fs.readFileSync(root + '/' + p, 'utf8'));
const toolsDoc = load('catalog/tools.json');
const materialsDoc = load('catalog/materials.json');
const partsDoc = load('catalog/parts.json');
const kitsDoc = load('catalog/parts-kits.json');
const T = await import('./toolsMaterials.ts');
const B = await import('./buildPlan.ts');

// --- the unified list: gathered tools + materials + parts-catalogue filaments
const items = T.tmItemsFromCatalog(toolsDoc, materialsDoc, partsDoc.parts);
const byId = new Map(items.map(i => [i.id, i]));
for (const id of ['printer_prusa_mk4s', 'tpu_filament', 'pla_filament', 'petg_filament'])
  assert.ok(byId.has(id), id);
assert.equal(byId.get('printer_prusa_mk4s').kind, 'tool');
assert.equal(byId.get('tpu_filament').catalog, 'materials');
assert.equal(byId.get('pla_filament').catalog, 'parts');

// --- ownership: default simulated, record next, flip wins
for (const i of items) assert.equal(T.ownershipOf(i, {}), 'simulated', i.id);
assert.equal(T.ownershipOf(byId.get('printer_prusa_mk4s'), { printer_prusa_mk4s: 'on_hand' }), 'on_hand');
assert.equal(T.ownershipOf(byId.get('tpu_filament'), { printer_prusa_mk4s: 'on_hand' }), 'simulated');
// a bogus stored value never resolves to owned
assert.equal(T.ownershipOf(byId.get('tpu_filament'), { tpu_filament: 'yes' }), 'simulated');

// --- derived profile: simulated derives NOTHING
const D = B.DEFAULT_PROFILE;
const same = T.deriveProfile(D, items, {});
assert.deepEqual(same.toolsOnHand, D.toolsOnHand);
assert.deepEqual(same.materialsOnHand, D.materialsOnHand);
assert.equal(same.bedXmm, D.bedXmm);

// --- derived profile: on-hand printer contributes tool + recorded bed
const withPrinter = T.deriveProfile(D, items, { printer_prusa_mk4s: 'on_hand' });
assert.ok(withPrinter.toolsOnHand.includes('3d_printer'));
assert.deepEqual([withPrinter.bedXmm, withPrinter.bedYmm, withPrinter.bedZmm], [250, 210, 220]);
// prices and the rest of the profile pass through untouched
assert.deepEqual(withPrinter.prices, D.prices);
assert.equal(withPrinter.workspaceMm, D.workspaceMm);

// --- derived profile: on-hand materials add their families
const withMats = T.deriveProfile({ ...D, materialsOnHand: [] }, items,
  { tpu_filament: 'on_hand', pla_filament: 'on_hand' });
assert.ok(withMats.materialsOnHand.includes('TPU'));
assert.ok(withMats.materialsOnHand.includes('PLA'));
assert.ok(!withMats.materialsOnHand.includes('PETG')); // still simulated: derives nothing
assert.equal(T.materialFamily(byId.get('tpu_filament')), 'TPU');
assert.equal(T.materialFamily(byId.get('printer_prusa_mk4s')), null);

// --- prices: recorded figures only, basis + expiry carried
const tpuPrice = T.priceState(byId.get('tpu_filament'), '2026-11-01T18:00:00Z');
assert.equal(tpuPrice.price.amount, 29.99);
assert.equal(tpuPrice.price.basis, 'Black / 1.75mm / 0.75kg');
assert.equal(tpuPrice.expired, false);
assert.equal(T.priceState(byId.get('tpu_filament'), '2026-11-03T00:00:00Z').expired, true);
const printerPrice = T.priceState(byId.get('printer_prusa_mk4s'), '2026-11-01T18:00:00Z');
assert.equal(printerPrice.price.amount, 925);
assert.equal(printerPrice.price.basis, undefined);

// --- print-fit against the printer's recorded build volume (real Burger kit)
const printer = byId.get('printer_prusa_mk4s');
assert.ok(T.isPrinter(printer));
assert.deepEqual(T.printerBed(printer), [250, 210, 220]);
const kitItems = B.kitPlanItems(kitsDoc.kits['turtlebot3-burger']).filter(i => i.role === 'print');
assert.ok(kitItems.length > 0);
const fit = T.printerFit(printer, kitItems.map(i => ({ name: i.name, dims: i.dims })));
assert.equal(fit.fits.length + fit.tooBig.length + fit.notChecked.length, kitItems.length);
assert.ok(fit.fits.length > 0);
// a non-printer abstains entirely
assert.equal(T.printerFit(byId.get('tpu_filament'), kitItems), null);

// --- key specs come from the records
const pk = Object.fromEntries(T.keySpecs(printer).map(s => [s.label, s.value]));
assert.equal(pk['Build volume'], '250 × 210 × 220 mm');
const tk = Object.fromEntries(T.keySpecs(byId.get('tpu_filament')).map(s => [s.label, s.value]));
assert.equal(tk['Density'], '1.22 g/cm³');

console.log('tools-materials unit checks passed');
"""


def _prep_unit_dir(tmp: Path) -> None:
    (tmp / "package.json").write_text('{"type":"module"}')
    for name in ("sourcing.ts", "wiring.ts", "types.ts"):
        (tmp / name).write_text((LIB / name).read_text())
    bom = (LIB / "bom.ts").read_text().replace('"./sourcing"', '"./sourcing.ts"')
    (tmp / "bom.ts").write_text(bom)
    palette = (LIB / "palette.ts").read_text()
    palette = (palette.replace('"./bom"', '"./bom.ts"')
               .replace('"./sourcing"', '"./sourcing.ts"')
               .replace('"./types"', '"./types.ts"'))
    (tmp / "palette.ts").write_text(palette)
    build_wiring = (LIB / "buildWiring.ts").read_text()
    build_wiring = (build_wiring.replace('"./types"', '"./types.ts"')
                    .replace('"./palette"', '"./palette.ts"'))
    (tmp / "buildWiring.ts").write_text(build_wiring)
    engine = (LIB / "buildPlan.ts").read_text()
    engine = (engine.replace('"./bom"', '"./bom.ts"')
              .replace('"./types"', '"./types.ts"')
              .replace('"./wiring"', '"./wiring.ts"')
              .replace('"./buildWiring"', '"./buildWiring.ts"')
              .replace('"./palette"', '"./palette.ts"'))
    (tmp / "buildPlan.ts").write_text(engine)
    tm = (LIB / "toolsMaterials.ts").read_text()
    tm = tm.replace('"./buildPlan"', '"./buildPlan.ts"')
    (tmp / "toolsMaterials.ts").write_text(tm)
    (tmp / "node_modules").symlink_to(WEB / "node_modules")


def test_tools_materials_units_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    _prep_unit_dir(tmp_path)
    (tmp_path / "run.mjs").write_text(UNIT_SCRIPT)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs"), str(REPO)],
        capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, result.stdout + result.stderr
