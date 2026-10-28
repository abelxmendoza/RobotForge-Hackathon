import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge.listimport import identify, import_list, parse_paste

# Abel's real list, trimmed to the drone build + representative noise,
# in Amazon's exact paste shape (titles doubled, prices interleaved).
PASTE = """HAWK'S WORK F450 Drone Frame, 450 mm Quadcopter Frame Kits with Stands DIY Drone Kits to Bulit (Soldered Version)
HAWK'S WORK F450 Drone Frame, 450 mm Quadcopter Frame Kits with Stands DIY Drone Kits to Bulit (Soldered Version)
by HAWK'S WORK (Unknown Binding)
$28.99 & FREE Shipping on orders over $35.00 shipped by Amazon. Details
Item added April 8, 2026
Add to Cart
Readytosky 2212 920KV Brushless Motors CW CCW for F330 F450 F550 S500 S550 X525 DJI Phantom Quadcopter(4PCS)
Readytosky 2212 920KV Brushless Motors CW CCW for F330 F450 F550 S500 S550 X525 DJI Phantom Quadcopter(4PCS)
$39.99 & FREE Shipping. Details
Readytosky 30A ESC 2-6S OPTO Brushless Electronic Speed Controller | For F450 S500 ZD550 RC Helicopter Quadcopter(4PCS)
$39.99 & FREE Shipping. Details
Readytosky 6Pairs 1045 Propellers CW CCW 10x4.5" FPV Props | For F450 450mm S500 ZD550 RC Helicopter Quadcopter(4PCS)
$26.99 & FREE Shipping on orders over $35.00 shipped by Amazon. Details
Nihewo 4S Lipo Battery Pack 3300mAh 14.8V Lipo Battery 80C with XT60 Connector Soft Case Compatible with RC Models(2Packs)
See all buying options
QWinOut Power Distribution Board PDB XT60 BEC 5V & 12V for RC Helicopter Quadcopter Muliticopter Drone
$11.96 & FREE Shipping on orders over $35.00 shipped by Amazon. Details
FPVDrone Power Module 5.3V BEC with XT60 Plug | Compatible with APM2.5 APM2.6 APM2.8 APM Pixhawk Flight Controller
$13.89 & FREE Shipping on orders over $35.00 shipped by Amazon. Details
FLYSKY FS-i6X 10CH 2.4GHz RC Transmitter Controller with iA6B Receiver Upgrade Cable for RC Boat Racing Drone
$54.89 & FREE Shipping. Details
B6 Battery Charger 80W Mini Lipo Balance Charger/Discharger with Power Supply for LiPo/Li-ion/Life(1-6s) NiMH/NiCd (1-15s)
$38.98 & FREE Shipping. Details
HAWK'S WORK F450 DIY Drone Kit, Open Source DIY 450mm Quadcopter Set (A) | Pixhawk-based open source DIY kit, wide component compatibility
$399.99 & FREE Shipping. Details
SeeSii TinySA Ultra+ ZS407 7.3GHz Spectrum Analyzer: 2026 Upgraded 4 Inch HW V0.5.4 100kHz-7.3GHz Handheld Tiny Frequency Analyzer
$260.90 & FREE Shipping. Details
Basesailor USB to USB C Adapter,USBC Female to USB A Male Charger Adapter | Type C Converter for iPhone 18 17e Pro Max Duo
$8.99 & FREE Shipping on orders over $35.00 shipped by Amazon. Details
"""


def test_parse_collapses_doubled_titles_and_skips_noise():
    items = parse_paste(PASTE)
    titles = [i["title"] for i in items]
    assert len(titles) == len(set(titles)) == 12
    frame = next(i for i in items if "F450 Drone Frame" in i["title"])
    assert frame["price"] == 28.99


def test_identify_extracts_specs_and_quantities():
    by_slot = {}
    for raw in parse_paste(PASTE):
        it = identify(raw)
        by_slot.setdefault(it.slot, []).append(it)
    motor = by_slot["motor"][0]
    assert motor.qty == 4 and motor.specs["kv"] == 920
    esc = by_slot["esc"][0]
    assert esc.qty == 4 and esc.specs["amps"] == 30
    batt = by_slot["battery"][0]
    assert batt.qty == 2 and batt.specs["capacity_mah"] == 3300
    assert batt.specs["cells"] == 4 and batt.specs["connector"] == "XT60"
    props = by_slot["propeller"][0]
    assert props.qty == 12  # 6 pairs
    assert by_slot["frame"][0].specs["wheelbase_mm"] == 450


def test_assembly_fills_slots_and_kit_covers_fc():
    report = import_list(PASTE)
    slots = report["assembly"]["slots"]
    assert slots["motor"]["status"] == "filled"
    assert slots["propeller"]["have"] == 12
    # no standalone FC in the list; the kit covers it, flagged unverified
    assert slots["flight_controller"]["status"] == "in_kit_unverified"
    assert slots["gps"]["status"] == "in_kit_unverified"
    assert slots["fpv"]["status"] == "missing"
    assert any("kit bundle" in w for w in report["assembly"]["warnings"])
    assert len(report["assembly"]["bench"]) == 1  # spectrum analyzer
    assert len(report["assembly"]["unidentified"]) == 1  # USB adapter


def test_without_kit_fc_is_missing_with_store_links():
    no_kit = PASTE.replace(
        "HAWK'S WORK F450 DIY Drone Kit, Open Source DIY 450mm Quadcopter "
        "Set (A) | Pixhawk-based open source DIY kit, wide component "
        "compatibility\n", "")
    report = import_list(no_kit)
    fc = report["assembly"]["slots"]["flight_controller"]
    assert fc["status"] == "missing"
    missing = {m["slot"]: m for m in report["assembly"]["missing"]}
    assert "flight_controller" in missing
    stores = {l["store"] for l in missing["flight_controller"]["alternatives"]}
    assert "Holybro" in stores


def test_wiring_connects_the_power_chain():
    report = import_list(PASTE)
    conns = {(c["from"], c["to"]) for c in report["wiring"]["connections"]}
    assert ("flight battery", "PDB") in conns
    assert ("each ESC", "its motor") in conns
    assert ("receiver", "flight controller") in conns
    assert report["wiring"]["orientation"]  # non-empty, reasons attached
    batt_conn = next(c for c in report["wiring"]["connections"]
                     if c["to"] == "PDB")
    assert "centre of gravity" in batt_conn["note"]


def test_connector_pack_is_not_a_battery():
    it = identify({"title": "TMH 5 Pairs XT60 Connector XT-60 Male Female "
                            "Bullet Connectors Plugs with 20 pcs Heat "
                            "Shrink Tube for RC Lipo Battery Car Boat "
                            "(5 Male+5 Female)", "price": 6.99})
    assert it.slot == "connectors" and it.qty == 10


def test_short_plain_titles_are_kept():
    rep = import_list("Pixhawk\nGPS module\n30A ESC\nDelete\n")
    assert [i["slot"] for i in rep["items"]] == [
        "flight_controller", "gps", "esc"]


def test_four_in_one_esc_fills_the_esc_slot():
    it = identify({"title": "4-in-1 ESC 45 A (BLHeli_S class)",
                   "price": None})
    assert it.slot == "esc" and it.qty == 4
    rep = import_list("4-in-1 ESC 45 A (BLHeli_S class)\n")
    assert rep["assembly"]["slots"]["esc"]["status"] == "filled"


def test_pdb_rail_only_suggested_when_bec_is_named():
    plain = import_list("Power distribution board without BEC\n"
                        "Pixhawk flight controller\n")
    conns = plain["wiring"]["connections"]
    assert not any(c["from"].startswith("PDB 5V") for c in conns)
    assert any(c["from"] == "UNVERIFIED 5V supply" for c in conns)
    bec = import_list("Power Distribution Board PDB XT60 BEC 5V & 12V\n"
                      "Pixhawk flight controller\nCamera gimbal 2-axis\n")
    froms = {c["from"] for c in bec["wiring"]["connections"]}
    assert {"PDB 5V BEC", "PDB 12V BEC"} <= froms


def test_propeller_piece_counts():
    assert identify({"title": "4PCS 1045 Propellers CW CCW",
                     "price": None}).qty == 4
    assert identify({"title": "6Pairs 1045 Propellers CW CCW (4PCS)",
                     "price": None}).qty == 12
