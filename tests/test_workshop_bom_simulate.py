"""Workshop BOM + Simulate tabs and the web-gathered part photos.

Three claims under test:

1. Photo records are receipts, not decorations: every `photo` in
   catalog/parts.json carries url + source page + credit +
   fetched-at + state web_gathered + an honest kind, no photo URL
   points at the AI-illustration assets, and the records match the
   gathering script's registry exactly (one source of truth).
2. The tabs are wired the Workshop's way: BOM and Simulate sit in
   WORK_TABS, the #tab= deep link knows them, the BOM tab reads the
   shared build list and makes no network calls, and the Simulate
   tab reuses the robot pages' physics engine rather than a copy.
3. The pure logic behaves: a photo resolves only for a complete
   verified record (the AI-illustration field never counts), a
   Workshop robot maps to a catalogue slug only by its recorded
   identity (Burger yes, a lookalike name no), no-model robots get
   the recorded-reason state, and price totals keep unverified
   web-gathered money visibly separate.
"""
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next"
LIB = WEB / "src" / "lib"
NODE = shutil.which("node")


# ---------------------------------------------------------------- data

def _parts():
    return json.loads((ROOT / "catalog" / "parts.json").read_text())["parts"]


def test_photo_records_carry_full_receipts():
    photographed = [p for p in _parts() if p.get("photo")]
    assert len(photographed) == 9, [p["id"] for p in photographed]
    kinds = {}
    for p in photographed:
        ph = p["photo"]
        for field in ("url", "source_page", "credit", "fetched_at"):
            assert ph.get(field), (p["id"], field)
        assert ph["state"] == "web_gathered", p["id"]
        assert ph["kind"] in ("photo", "render"), p["id"]
        kinds[ph["kind"]] = kinds.get(ph["kind"], 0) + 1
        assert ph["url"].startswith("https://"), p["id"]
        # Never the AI illustrations, never a repo-copied binary.
        assert "assets/img/parts" not in ph["url"], p["id"]
        assert ph["source_page"].startswith("https://"), p["id"]
    # 8 real photographs + the one honestly-labelled SLAMTEC render.
    assert kinds == {"photo": 8, "render": 1}, kinds
    by_id = {p["id"]: p for p in _parts()}
    assert by_id["rplidar_a1"]["photo"]["kind"] == "render"
    assert "Render" in by_id["rplidar_a1"]["photo"]["credit"]


def test_photo_records_match_the_gather_registry():
    spec = importlib.util.spec_from_file_location(
        "gather_part_photos", ROOT / "tools" / "gather_part_photos.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    records = mod.records()
    by_id = {p["id"]: p for p in _parts()}
    assert set(records) == {p["id"] for p in _parts() if p.get("photo")}
    for pid, rec in records.items():
        assert by_id[pid]["photo"] == rec, pid
    # The no-photo reasons are recorded too — absence is a decision.
    assert "camera_rpi_v2" in mod.NO_PHOTO
    assert "imu_bno055" in mod.NO_PHOTO


# ---------------------------------------------------------------- static

def test_tabs_are_wired_into_the_workshop():
    garage = (WEB / "src/components/garage/Garage.tsx").read_text()
    assert "{ id: 'bom', label: 'BOM'" in garage
    assert "{ id: 'simulate', label: 'Simulate'" in garage
    assert "bom|simulate" in garage  # the #tab= deep link knows both
    assert "WorkshopBomTab" in garage and "WorkshopSimulateTab" in garage


def test_bom_tab_is_local_and_live_from_the_build_list():
    tab = (WEB / "src/components/garage/WorkshopBomTab.tsx").read_text()
    assert "useBuildList" in tab
    assert "buildListToBomLines" in tab
    assert "bomToCsv" in tab                      # CSV export
    assert 'href="/bom/"' in tab                  # the full wizard link
    assert "photoForLine" in tab                  # verified thumbnails
    assert "no estimate recorded" in tab          # honest price absence
    assert "fetch(" not in tab and "postJSON" not in tab  # demo-safe


def test_simulate_tab_shares_the_engine_and_states_absence():
    tab = (WEB / "src/components/garage/WorkshopSimulateTab.tsx").read_text()
    assert 'from "@/lib/physicsEngine"' in tab    # the robot pages' engine
    assert "runPhysicsChecks" in tab
    assert "No recorded model for this robot" in tab
    assert "Gazebo runs on your machine" in tab


def test_photo_component_falls_back_honestly():
    comp = (WEB / "src/components/parts/PartPhoto.tsx").read_text()
    assert 'referrerPolicy="no-referrer"' in comp
    assert "onError" in comp
    assert "No verified photo" in comp
    assert "render" in comp  # renders are badged, never passed off


def test_wizard_lines_show_thumbnails():
    wizard = (WEB / "src/components/bom/BomWizard.tsx").read_text()
    assert "photoForLine" in wizard and "PartPhoto" in wizard


# ---------------------------------------------------------------- node

UNIT_SCRIPT = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = process.argv[2];
const { verifiedPhoto, photoForLine } = await import('./partPhoto.ts');
const { resolveCatalogueSlug, simAvailability, gazeboState, slugifyName } =
  await import('./workshopSim.ts');
const { parseLinePrice, pricesByLineKey, bomTotals } =
  await import('./workshopBom.ts');

const parts = JSON.parse(fs.readFileSync(root + '/catalog/parts.json', 'utf8')).parts;
const physics = JSON.parse(fs.readFileSync(root + '/catalog/physics.json', 'utf8')).robots;
const robots = JSON.parse(fs.readFileSync(root + '/catalog/robots.json', 'utf8')).robots;
const byId = new Map(parts.map((p) => [p.id, p]));
const slugs = new Set(robots.map((r) => slugifyName(r.name)));

// --- photos: only complete verified records resolve
const tb = byId.get('driver_tb6612fng');
assert.equal(verifiedPhoto(tb).credit, 'Photo: Pololu');
assert.equal(verifiedPhoto(byId.get('pla_filament')), null);
assert.equal(verifiedPhoto({ id: 'x', photo: { url: 'u' } }), null);
assert.equal(verifiedPhoto({ id: 'x', image: 'assets/img/parts/x.jpg' }), null);
assert.equal(verifiedPhoto(undefined), null);

// BOM line -> photo follows the catalogue id only, never the name
assert.equal(photoForLine({ partId: 'driver_tb6612fng' }, byId).kind, 'photo');
assert.equal(photoForLine({ partId: 'pla_filament' }, byId), null);
assert.equal(photoForLine({ name: 'TB6612FNG' }, byId), null);
assert.equal(photoForLine({ partId: 'rplidar_a1' }, byId).kind, 'render');

// --- workshop -> catalogue resolution
assert.equal(
  resolveCatalogueSlug('TurtleBot3 Burger (demo)', 'turtlebot3-burger', slugs),
  'turtlebot3-burger');
assert.equal(resolveCatalogueSlug('TurtleBot3 Burger', undefined, slugs),
  'turtlebot3-burger');
assert.equal(resolveCatalogueSlug('Mini Pupper', undefined, slugs), 'mini-pupper');
assert.equal(resolveCatalogueSlug('Burger-ish', 'burger-ish', slugs), null);
assert.equal(resolveCatalogueSlug('My Own Robot', undefined, slugs), null);

// --- simulate availability states
const burger = simAvailability('turtlebot3-burger', physics['turtlebot3-burger']);
assert.equal(burger.kind, 'urdf');
const pupper = simAvailability('mini-pupper', physics['mini-pupper']);
assert.equal(pupper.kind, 'no-urdf');
assert.ok(pupper.reason.length > 10); // the recorded reason, verbatim slot
assert.equal(simAvailability(null, undefined).kind, 'not-catalogue');
const gz = gazeboState('turtlebot3-burger', physics['turtlebot3-burger']);
assert.equal(gz.available, false); // generator not in this build: no fake offer
assert.ok(gz.note.includes('not part of this build'));

// --- price model: parsing is strict, totals keep unverified separate
assert.equal(parseLinePrice({ kind: 'web_gathered', amount: 4.95,
  source_url: 'https://x', fetched_at: '2026-11-01',
  verification: 'web_gathered' }).kind, 'web_gathered');
assert.equal(parseLinePrice({ kind: 'web_gathered', amount: 4.95 }), null);
assert.equal(parseLinePrice({ kind: 'sourced', amount: '4.95',
  supplier: 'Pololu', source_url: 'https://x', fetched_at: 'd' }), null);
assert.equal(parseLinePrice(null), null);
const prices = pricesByLineKey({ lines: {
  a: { price_estimate: { kind: 'web_gathered', amount: 10, currency: 'USD',
       source_url: 'https://x', fetched_at: '2026-11-01',
       verification: 'web_gathered' } },
  b: { price_estimate: { kind: 'user_entered', amount: 5, currency: 'USD' } },
  c: { price_estimate: { kind: 'nonsense' } },
} });
assert.equal(prices.size, 2);
const totals = bomTotals(
  [{ key: 'a', qty: 2 }, { key: 'b', qty: 1 }, { key: 'c', qty: 3 }, { key: 'd', qty: 1 }],
  prices);
assert.equal(totals.byCurrency.get('USD'), 25);
assert.equal(totals.unverifiedByCurrency.get('USD'), 20);
assert.equal(totals.pricedLines, 2);
assert.equal(totals.unpricedLines, 2);
console.log('workshop-bom-simulate units OK');
"""


def test_workshop_bom_simulate_units(tmp_path):
    assert NODE, "node is required for the TS unit tests"
    for name in ("partPhoto.ts", "workshopSim.ts", "workshopBom.ts"):
        (tmp_path / name).write_text((LIB / name).read_text())
    script = tmp_path / "units.mts"
    script.write_text(UNIT_SCRIPT)
    proc = subprocess.run(
        [NODE, "--experimental-strip-types", str(script), str(ROOT)],
        capture_output=True, text=True, cwd=tmp_path, timeout=120)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "units OK" in proc.stdout
