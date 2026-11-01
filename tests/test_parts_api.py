"""Parts API: the seed tool's record building (tests/fixtures/
parts_api) — worker behaviour itself is covered by the Parts API
scenarios in tests/worker_mock.mjs, run by tests/test_live.py.

The invariants under test are the honesty rules of Forge Engine
§8/§9: a price exists only with its source record attached; a
catalogue AI illustration never becomes a part "photo"; gather
proposals join as web_gathered alternates and never displace an
applied record from the same source.
"""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).parent.parent
FIXTURES = Path(__file__).parent / "fixtures" / "parts_api"
SEED_PATH = REPO / "tools" / "parts-api" / "seed.py"

spec = importlib.util.spec_from_file_location("parts_api_seed", SEED_PATH)
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


def _catalog():
    return json.loads((FIXTURES / "catalog.json").read_text())


def _records():
    proposals = seed.load_proposals(FIXTURES / "proposals")
    return seed.build_records(_catalog(), proposals,
                              seeded_at="2026-11-01T10:00:00Z")


def test_records_carry_catalogue_identity():
    records = {r["id"]: r for r in _records()}
    assert set(records) == {"driver_tb6612fng", "realsense_d435",
                            "servo_sts3215"}
    driver = records["driver_tb6612fng"]
    assert driver["category"] == "drivers"  # part_class, renamed
    assert driver["mpn"] is None  # not recorded anywhere: stays null
    assert driver["specs"]["current_a_per_channel"] == 1.0
    assert driver["seed_version"] == seed.SEED_VERSION
    assert driver["seeded_at"] == "2026-11-01T10:00:00Z"
    assert driver["provenance"]["gathered"]["price_estimate"]["state"] \
        == "web_gathered"


def test_interfaces_derive_from_both_spec_spellings():
    records = {r["id"]: r for r in _records()}
    assert records["realsense_d435"]["interfaces"] == ["usb3"]
    # The recorded free-text value rides along as one entry; the
    # seed never invents a cleaner taxonomy than the source has.
    assert records["servo_sts3215"]["interfaces"] == [
        "uart bus, position feedback"]


def test_applied_estimate_is_normalized_with_its_receipt():
    driver = {r["id"]: r for r in _records()}["driver_tb6612fng"]
    # The proposal for the same supplier must NOT displace or
    # duplicate the applied record.
    assert len(driver["estimates"]) == 1
    est = driver["estimates"][0]
    assert est["unit_price"] == 4.95
    assert est["supplier"] == "Pololu"  # derived from the URL host
    assert est["supplier_url"] == "https://www.pololu.com/product/713"
    assert est["source_kind"] == "web_gathered"
    assert est["state"] == "web_gathered"
    assert est["fetched_at"] == "2026-11-01T09:25:48Z"
    assert est["expires_at"] == "2026-11-02T09:25:48Z"
    assert est["quote"] == "1+ $4.95"
    assert est["price_breaks"] == [{"qty": 1, "unit_price": 4.95},
                                   {"qty": 100, "unit_price": 3.85}]


def test_proposal_estimate_joins_as_web_gathered_alternate():
    servo = {r["id"]: r for r in _records()}["servo_sts3215"]
    assert len(servo["estimates"]) == 1
    est = servo["estimates"][0]
    assert est["unit_price"] == 19.99
    assert est["supplier"] == "Waveshare"
    assert est["state"] == "web_gathered"
    assert est["price_breaks"][1] == {"qty": 10, "unit_price": 17.49}


def test_a_price_without_a_source_record_is_dropped():
    catalog = _catalog()
    catalog["parts"][2]["price_estimate"] = {"unit_price": 0.01}
    records = seed.build_records(catalog, [], seeded_at="2026-11-01T10:00:00Z")
    servo = {r["id"]: r for r in records}["servo_sts3215"]
    assert servo["estimates"] == []
    assert seed.normalize_estimate({"unit_price": 1.0}) is None
    assert seed.normalize_estimate(
        {"unit_price": 1.0, "supplier_url": "https://x.example/p"}) is None


def test_normalize_estimate_carries_basis_only_when_recorded():
    """Basis — what the unit price buys, in the source's own terms
    ("1.75mm / 1kg", "1kg") — rides along when the source record
    carries one and stays absent when it doesn't: the seed passes
    the catalogue's word through, it never invents one."""
    raw = {"unit_price": 19.99,
           "supplier_url":
               "https://shop.polymaker.com/products/polylite-pla",
           "fetched_at": "2026-11-01T18:23:35Z",
           "basis": "1.75mm / 1kg"}
    est = seed.normalize_estimate(raw)
    assert est["basis"] == "1.75mm / 1kg"
    del raw["basis"]
    est = seed.normalize_estimate(raw)
    assert "basis" not in est


def test_photo_is_never_the_catalogue_ai_image():
    catalog = _catalog()
    records = {r["id"]: r for r in _records()}
    photo = records["realsense_d435"]["photo"]
    assert photo["url"] == "https://example.com/photos/realsense_d435.jpg"
    assert photo["credit"] == "Photo: Intel"
    assert photo["state"] == "web_gathered"
    images = {p["id"]: p["image"] for p in catalog["parts"]}
    for part_id, record in records.items():
        if record["photo"] is not None:
            assert record["photo"]["url"] != images[part_id]
    # Parts with no verified photo record stay null — no fallback
    # to the illustration, ever.
    assert records["driver_tb6612fng"]["photo"] is None
    assert records["servo_sts3215"]["photo"] is None


def test_index_lists_every_record():
    records = _records()
    index = seed.build_index(records, "2026-11-01T10:00:00Z")
    assert index["count"] == 3
    assert index["ids"] == [r["id"] for r in records]
    assert index["seed_version"] == seed.SEED_VERSION


def test_cli_build_writes_the_records_file(tmp_path):
    out = tmp_path / "records.json"
    r = subprocess.run(
        [sys.executable, str(SEED_PATH), "build",
         "--catalog", str(FIXTURES / "catalog.json"),
         "--proposals-dir", str(FIXTURES / "proposals"),
         "--out", str(out), "--seeded-at", "2026-11-01T10:00:00Z"],
        capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    payload = json.loads(out.read_text())
    assert payload["index"]["count"] == 3
    assert len(payload["records"]) == 3
    assert "3 records (2 with estimates, 1 with photos)" in r.stdout


def test_real_catalogue_seeds_fifty_records_three_priced():
    """Against the real catalogue: every part seeds. Prices arrive
    only through applied gather proposals — exactly three records
    are priced so far, each from an Abel-approved apply on
    2026-11-01: driver_tb6612fng (proposal
    20261101T192346Z-224e7d, Pololu, applied as-is) and the two
    Polymaker filaments pla_filament / petg_filament (materials run
    20261101T182331Z-7a731d; manufacturer values over the
    catalogue's generic densities). All are web-gathered estimates
    with a 24 h TTL. Every other record still seeds unpriced.
    Photos mirror the catalogue exactly: a seeded record carries a
    photo only where the catalogue holds a verified photo record
    (the 9 web-gathered records of the photo slice), never from the
    AI-illustration `image` field."""
    catalog = json.loads((REPO / "catalog" / "parts.json").read_text())
    records = seed.build_records(catalog, [], seeded_at="2026-11-01T10:00:00Z")
    assert len(records) == 50
    priced = {r["id"]: r["estimates"] for r in records if r["estimates"]}
    assert set(priced) == {"driver_tb6612fng", "pla_filament",
                           "petg_filament"}
    (est,) = priced["driver_tb6612fng"]
    assert est["unit_price"] == 4.95
    assert est["currency"] == "USD"
    assert [(b["qty"], b["unit_price"]) for b in est["price_breaks"]] == [
        (1, 4.95), (5, 4.55), (25, 4.19), (100, 3.85)]
    assert est["supplier"] == "Pololu"
    assert est["supplier_url"] == "https://www.pololu.com/product/713"
    assert est["source_kind"] == "web_gathered"
    assert est["state"] == "web_gathered"
    assert est["fetched_at"] == "2026-11-01T19:24:08Z"
    assert est["expires_at"] == "2026-11-02T19:24:08Z"
    # The Pololu record carries no basis: the served estimate must
    # not grow one.
    assert "basis" not in est
    filament_prices = {
        "pla_filament": (19.99,
                         "https://shop.polymaker.com/products/polylite-pla",
                         "2026-11-01T18:23:35Z", "2026-11-02T18:23:35Z",
                         "1.75mm / 1kg"),
        "petg_filament": (18.99, "https://shop.polymaker.com/products/petg",
                          "2026-11-01T18:23:54Z", "2026-11-02T18:23:54Z",
                          "1kg"),
    }
    for part_id, (price, url, fetched, expires,
                  basis) in filament_prices.items():
        (est,) = priced[part_id]
        assert est["unit_price"] == price, part_id
        # Basis is served with the price, in the catalogue's terms.
        assert est["basis"] == basis, part_id
        assert est["currency"] == "USD", part_id
        assert [(b["qty"], b["unit_price"])
                for b in est["price_breaks"]] == [(1, price)], part_id
        assert est["supplier_url"] == url, part_id
        assert est["source_kind"] == "web_gathered", part_id
        assert est["state"] == "web_gathered", part_id
        assert est["fetched_at"] == fetched, part_id
        assert est["expires_at"] == expires, part_id
    catalog_photo_ids = {p["id"] for p in catalog["parts"] if p.get("photo")}
    assert catalog_photo_ids, "the photo slice should have landed by now"
    for r in records:
        if r["id"] in catalog_photo_ids:
            assert r["photo"] is not None, r["id"]
            assert r["photo"]["url"].startswith("https://"), r["id"]
            assert r["photo"]["credit"], r["id"]
        else:
            assert r["photo"] is None, r["id"]
    by_id = {r["id"]: r for r in records}
    assert "usb" in by_id["raspberry_pi_5"]["interfaces"]
    assert "i2c" in by_id["imu_bno055"]["interfaces"]
