"""Verified part photos — the photo slice of PR #82, ported to main
after Abel's 2026-11-01 decision ("merge only #82's verified-photo
slice into the live tabs"). #82's Workshop BOM/Simulate tab
implementations were superseded by the landed #87 tabs and are NOT
ported; what lands is the photo layer:

1. Photo records are receipts, not decorations: every `photo` in
   catalog/parts.json carries url + source page + credit +
   fetched-at + state web_gathered + an honest kind, no photo URL
   points at the AI-illustration assets, and the records match the
   gathering script's registry exactly (one source of truth).
2. Photos resolve only through catalogue identity: partPhoto.ts
   reads `photo` and nothing else (the AI-illustration `image` field
   never counts), the wizard and the palette look photos up by
   catalogue part / line partId, and the Workshop BOM tab reaches a
   photo only via the matched shelf part's recorded catalogue id.
3. The pure logic behaves: a photo resolves only for a complete
   verified record, and a BOM line's photo follows its catalogue id
   only, never its name.
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

def test_photo_component_falls_back_honestly():
    comp = (WEB / "src/components/parts/PartPhoto.tsx").read_text()
    assert 'referrerPolicy="no-referrer"' in comp
    assert "onError" in comp
    assert "No verified photo" in comp
    assert "render" in comp  # renders are badged, never passed off


def test_wizard_lines_show_thumbnails():
    wizard = (WEB / "src/components/bom/BomWizard.tsx").read_text()
    assert "photoForLine" in wizard and "PartPhoto" in wizard


def test_palette_cards_prefer_verified_photos():
    palette = (WEB / "src/components/kit/PartsPalette.tsx").read_text()
    assert "verifiedPhoto" in palette and "PartPhoto" in palette
    # The honest placeholder stays for parts without a verified photo.
    assert "catalogue holds no photo of this part" in palette


def test_workshop_bom_tab_reaches_photos_by_catalogue_id_only():
    tab = (WEB / "src/components/garage/BomTab.tsx").read_text()
    assert "catalog_part_id" in tab          # the recorded link, not a name
    assert "verifiedPhoto" in tab and "PartPhoto" in tab
    assert "illustrations of a typical part" in tab  # copy stays honest


def test_workshop_bom_photos_coexist_with_price_badges():
    # The re-gate price wiring (build-plan store badges + totals)
    # landed in the same rows: a row can now carry BOTH the verified
    # photo (by catalogue id) and a price badge (by the same id's
    # wizard key) — neither route may fall back to a name match.
    tab = (WEB / "src/components/garage/BomTab.tsx").read_text()
    assert "verifiedPhoto" in tab and "PartPhoto" in tab
    assert "resolvedPrice" in tab and "priceTotals" in tab
    assert "`part:${partId}`" in tab
    assert "web-gathered estimate" in tab


def test_superseded_tab_implementation_did_not_land():
    # Abel's decision: #87's tabs stay; #82's tab components stay out.
    garage = (WEB / "src/components/garage/Garage.tsx").read_text()
    assert "WorkshopBomTab" not in garage
    assert "WorkshopSimulateTab" not in garage
    assert not (WEB / "src/lib/workshopBom.ts").exists()
    assert not (WEB / "src/lib/workshopSim.ts").exists()


def test_part_photo_lib_never_reads_the_image_field():
    src = (LIB / "partPhoto.ts").read_text()
    assert ".image" not in src  # behavioural proof is in the node units


# ---------------------------------------------------------------- node

UNIT_SCRIPT = r"""
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = process.argv[2];
const { verifiedPhoto, photoForLine } = await import('./partPhoto.ts');

const parts = JSON.parse(fs.readFileSync(root + '/catalog/parts.json', 'utf8')).parts;
const byId = new Map(parts.map((p) => [p.id, p]));

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
console.log('part-photo units OK');
"""


def test_part_photo_units(tmp_path):
    assert NODE, "node is required for the TS unit tests"
    (tmp_path / "partPhoto.ts").write_text((LIB / "partPhoto.ts").read_text())
    script = tmp_path / "units.mts"
    script.write_text(UNIT_SCRIPT)
    proc = subprocess.run(
        [NODE, "--experimental-strip-types", str(script), str(ROOT)],
        capture_output=True, text=True, cwd=tmp_path, timeout=120)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "units OK" in proc.stdout
