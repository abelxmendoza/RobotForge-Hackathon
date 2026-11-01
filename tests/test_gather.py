"""Gather pipeline tests (Forge Engine §8 / §8.1).

Hermetic: a FakeTransport serves fixture pages, a MockExtractor returns
canned model output and counts calls. The properties under test are the
trust properties: fabricated quotes die, unchanged pages are never
re-extracted (zero repeat model calls), proposals never write the catalog,
and apply keeps prior values.
"""
import json
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "tools"))

from gather.apply import apply_proposal, apply_run, load_catalog, save_catalog
from gather.extract import MockExtractor
from gather.fetcher import Fetcher, TransportResponse, _pdf_text_fallback
from gather.gather import load_registry, run_pipeline
from gather.propose import write_proposal
from gather.validate import validate_extraction

FIXTURES = Path(__file__).parent / "fixtures" / "gather"
REPO = Path(__file__).parent.parent

URL_TB = "https://fixture.local/pololu-tb6612"
URL_BNO = "https://fixture.local/adafruit-bno055"
URL_HC = "https://fixture.local/sparkfun-hcsr04"

TTLS = {"price": 86400, "stock": 21600, "specs": 2592000, "datasheet": 7776000}


class FakeTransport:
    def __init__(self, pages: dict, robots: dict | None = None):
        self.pages = pages          # url -> bytes
        self.robots = robots or {}  # host -> robots.txt bytes
        self.calls: list[str] = []

    def get(self, url: str, headers: dict) -> TransportResponse:
        self.calls.append(url)
        if url.endswith("/robots.txt"):
            host = url.split("/")[2]
            if host in self.robots:
                return TransportResponse(200, {}, self.robots[host])
            return TransportResponse(404, {}, b"")
        if url in self.pages:
            return TransportResponse(200, {}, self.pages[url])
        return TransportResponse(404, {}, b"not found")


class Clock:
    def __init__(self, t: float = 1_700_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


def make_fetcher(tmp_path, transport, clock):
    return Fetcher(cache_dir=tmp_path / "cache", transport=transport,
                   min_interval_s=0.0, clock=clock, sleeper=lambda s: None)


def tb_entry():
    return {"part_id": "driver_tb6612fng", "mpn": "TB6612FNG", "ttl_seconds": TTLS,
            "pages": [{"kind": "product", "url": URL_TB, "supplier": "fixture",
                       "provides": ["price", "stock", "specs"]}]}


def tb_catalog():
    return {"parts": [{"id": "driver_tb6612fng", "name": "TB6612FNG dual motor driver",
                       "specs": {"channels": 2, "current_a_per_channel": 1.0,
                                 "voltage_v_max": 12}}],
            "templates": []}


def tb_canned():
    return {URL_TB: {
        "fields": [
            {"field": "current_a_per_channel", "value": 1.2, "unit": "A",
             "quote": "1.2 A of continuous current per channel"},
            {"field": "voltage_v_max", "value": 13.5, "unit": "V",
             "quote": "Operating voltage: 4.5 V to 13.5 V."},
            {"field": "mass_g", "value": 1.6, "unit": "g",
             "quote": "weighs 1.6 g"},
        ],
        "price_breaks": [
            {"qty": 1, "unit_price": 8.95, "currency": "USD",
             "quote": "Price: $8.95 for one"},
            {"qty": 10, "unit_price": 7.95, "currency": "USD",
             "quote": "$7.95 each when you buy 10 or more"},
        ],
        "stock_wording": {"value": "In stock", "quote": "In stock: 342 units ready to ship."},
    }}


def run_tb(tmp_path, catalog=None, canned=None, force=False):
    transport = FakeTransport({URL_TB: (FIXTURES / "pololu_tb6612.html").read_bytes()})
    clock = Clock()
    fetcher = make_fetcher(tmp_path, transport, clock)
    extractor = MockExtractor(canned if canned is not None else tb_canned())
    proposal = run_pipeline([tb_entry()], catalog or tb_catalog(), fetcher,
                            extractor, force=force, now=clock.t)
    return proposal, extractor, transport, fetcher


# ---------------------------------------------------------------- pipeline

def test_pipeline_produces_validated_changes(tmp_path):
    proposal, extractor, _, _ = run_tb(tmp_path)
    assert extractor.calls == 1
    entry = proposal["entries"][0]
    by_field = {c["field"]: c for c in entry["changes"]}
    assert by_field["current_a_per_channel"]["proposed"] == 1.2
    assert by_field["current_a_per_channel"]["current"] == 1.0
    assert by_field["voltage_v_max"]["proposed"] == 13.5
    assert by_field["voltage_v_max"]["safety_relevant"] is True
    assert by_field["mass_g"]["kind"] == "spec_new"
    price = by_field["price_estimate"]["proposed"]
    assert price["unit_price"] == 8.95
    assert price["price_breaks"] == [{"qty": 1, "unit_price": 8.95},
                                     {"qty": 10, "unit_price": 7.95}]
    assert price["source_kind"] == "web_gathered"
    assert price["stock_wording"] == "In stock"
    assert entry["rejected"] == []


def test_second_run_zero_model_calls_zero_changes(tmp_path):
    """§8.1's core property: unchanged sources are never re-extracted."""
    proposal1, extractor, transport, fetcher = run_tb(tmp_path)
    assert extractor.calls == 1
    assert proposal1["summary"]["changes"] > 0
    # second run over the SAME fetcher/cache, forced past TTL: the refetch
    # happens, the hash matches, extraction is skipped entirely.
    proposal2 = run_pipeline([tb_entry()], tb_catalog(), fetcher, extractor,
                             force=True, now=Clock().t)
    assert extractor.calls == 1, "repeat run made a model call"
    assert proposal2["summary"]["model_calls"] == 0
    assert proposal2["summary"]["changes"] == 0
    assert proposal2["summary"]["unchanged"] == 1


def test_ttl_hit_makes_no_network_call(tmp_path):
    _, _, transport, fetcher = run_tb(tmp_path)
    calls_after_first = len([c for c in transport.calls if c == URL_TB])
    assert calls_after_first == 1
    extractor = MockExtractor(tb_canned())
    run_pipeline([tb_entry()], tb_catalog(), fetcher, extractor, now=Clock().t)
    assert len([c for c in transport.calls if c == URL_TB]) == 1
    assert extractor.calls == 0


def test_changed_page_is_reextracted(tmp_path):
    _, extractor, transport, fetcher = run_tb(tmp_path)
    assert extractor.calls == 1
    transport.pages[URL_TB] = (FIXTURES / "pololu_tb6612.html").read_bytes() \
        .replace(b"342 units", b"17 units")
    proposal = run_pipeline([tb_entry()], tb_catalog(), fetcher, extractor,
                            force=True, now=Clock().t)
    assert extractor.calls == 2
    assert proposal["summary"]["fetched_changed"] == 1


def test_robots_disallow_skips_and_reports(tmp_path):
    transport = FakeTransport(
        {URL_TB: (FIXTURES / "pololu_tb6612.html").read_bytes()},
        robots={"fixture.local": b"User-agent: *\nDisallow: /pololu-tb6612\n"})
    fetcher = make_fetcher(tmp_path, transport, Clock())
    extractor = MockExtractor(tb_canned())
    proposal = run_pipeline([tb_entry()], tb_catalog(), fetcher, extractor,
                            now=Clock().t)
    page = proposal["entries"][0]["pages"][0]
    assert "robots" in page["skipped_reason"]
    assert extractor.calls == 0
    assert proposal["summary"]["skipped"] == 1


# ---------------------------------------------------------------- validate

def test_fabricated_quote_is_rejected(tmp_path):
    canned = {URL_BNO: {
        "fields": [
            {"field": "voltage_v", "value": [3.3, 5.0], "unit": "V",
             "quote": "accepts an input voltage from 3.3 V to 5.0 V"},
            {"field": "voltage_v_max", "value": 3.6, "unit": "V",
             "quote": "supply voltage 2.4 V to 3.6 V absolute maximum"},  # fabricated
        ],
        "price_breaks": [
            {"qty": 1, "unit_price": 34.95, "currency": "USD", "quote": "Price: $34.95"},
        ],
        "stock_wording": {"value": "Out of stock",
                          "quote": "Out of stock — more on the way"},
    }}
    text = (FIXTURES / "adafruit_bno055.html").read_bytes().decode()
    from gather.fetcher import html_to_text
    validated = validate_extraction(canned[URL_BNO], html_to_text(
        (FIXTURES / "adafruit_bno055.html").read_bytes()), URL_BNO)
    rejected = {(r.item, r.reason) for r in validated.rejected}
    assert ("voltage_v_max", "quote_not_found") in rejected
    surviving = {f.field for f in validated.fields}
    assert surviving == {"voltage_v"}
    assert validated.price_breaks[0]["unit_price"] == 34.95
    assert validated.stock_wording == "Out of stock"


def test_unit_normalization():
    text = "Stall torque: 10 kg·cm at 6 V. Draw: 900 mA. Nozzle: 392 °F."
    raw = {"fields": [
        {"field": "stall_torque_nm", "value": 10, "unit": "kg·cm",
         "quote": "Stall torque: 10 kg·cm"},
        {"field": "current_a", "value": 900, "unit": "mA", "quote": "Draw: 900 mA"},
        {"field": "print_temp_c", "value": 392, "unit": "°F", "quote": "Nozzle: 392 °F"},
        {"field": "voltage_v", "value": 6, "unit": "furlongs", "quote": "at 6 V"},
    ]}
    validated = validate_extraction(raw, text, "https://x.local/p")
    by_field = {f.field: f.value for f in validated.fields}
    assert abs(by_field["stall_torque_nm"] - 0.980665) < 1e-6
    assert by_field["current_a"] == 0.9
    assert by_field["print_temp_c"] == 200.0
    reasons = {(r.item, r.reason) for r in validated.rejected}
    assert ("voltage_v", "unit_unparseable") in reasons


def test_range_splits_into_min_max(tmp_path):
    canned = {URL_BNO: {"fields": [
        {"field": "voltage_v", "value": [3.3, 5.0], "unit": "V",
         "quote": "accepts an input voltage from 3.3 V to 5.0 V"}],
        "price_breaks": [], "stock_wording": None}}
    entry = {"part_id": "imu_bno055", "mpn": "BNO055", "ttl_seconds": TTLS,
             "pages": [{"kind": "product", "url": URL_BNO, "supplier": "fixture",
                        "provides": ["specs"]}]}
    catalog = {"parts": [{"id": "imu_bno055", "name": "BNO055 IMU",
                          "specs": {"interface": "I2C"}}], "templates": []}
    transport = FakeTransport({URL_BNO: (FIXTURES / "adafruit_bno055.html").read_bytes()})
    fetcher = make_fetcher(tmp_path, transport, Clock())
    proposal = run_pipeline([entry], catalog, fetcher, MockExtractor(canned),
                            now=Clock().t)
    by_field = {c["field"]: c["proposed"] for c in proposal["entries"][0]["changes"]}
    assert by_field["voltage_v_min"] == 3.3
    assert by_field["voltage_v_max"] == 5.0


def test_range_conversion_cm_to_m(tmp_path):
    text = (FIXTURES / "sparkfun_hcsr04.html").read_bytes()
    from gather.fetcher import html_to_text
    raw = {"fields": [{"field": "range_m", "value": [2, 400], "unit": "cm",
                       "quote": "Measuring range: 2 cm to 400 cm"}],
           "price_breaks": [], "stock_wording": None}
    validated = validate_extraction(raw, html_to_text(text), URL_HC)
    assert validated.fields[0].value == [0.02, 4.0]


# ---------------------------------------------------------------- apply

def test_apply_writes_versioned_updates(tmp_path):
    proposal, _, _, _ = run_tb(tmp_path)
    catalog = tb_catalog()
    report = apply_proposal(proposal, catalog, applied_at="2026-11-01T09:00:00Z")
    part = catalog["parts"][0]
    assert part["specs"]["current_a_per_channel"] == 1.2
    assert part["specs"]["voltage_v_max"] == 13.5
    assert part["price_estimate"]["source_kind"] == "web_gathered"
    hist = {(h["field"], h["prior"]) for h in part["gather_history"]}
    assert ("current_a_per_channel", 1.0) in hist
    assert ("voltage_v_max", 12) in hist
    prov = part["provenance_gathered"]["current_a_per_channel"]
    assert prov["state"] == "web_gathered"
    assert "1.2 A of continuous current" in prov["quote"]
    assert len(report["applied"]) == len(proposal["entries"][0]["changes"])


def test_apply_run_roundtrip_via_files(tmp_path):
    proposal, _, _, _ = run_tb(tmp_path)
    out_dir = tmp_path / "proposals"
    json_path, md_path = write_proposal(proposal, out_dir)
    assert json_path.exists() and md_path.exists()
    md = md_path.read_text()
    assert "Confirm individually" in md  # voltage/current are safety-relevant
    assert "current_a_per_channel" in md
    catalog_path = tmp_path / "parts.json"
    save_catalog(tb_catalog(), catalog_path)
    report = apply_run(proposal["run_id"], out_dir, catalog_path)
    reloaded = load_catalog(catalog_path)
    assert reloaded["parts"][0]["specs"]["current_a_per_channel"] == 1.2
    assert report["applied"]


def test_run_never_writes_catalog(tmp_path):
    catalog = tb_catalog()
    before = json.dumps(catalog, sort_keys=True)
    run_tb(tmp_path, catalog=catalog)
    assert json.dumps(catalog, sort_keys=True) == before


# ---------------------------------------------------------------- pdf + registry

def test_pdf_text_fallback_extracts_strings():
    payload = b"BT (Operating voltage: 4.5 V to 13.5 V) Tj ET"
    stream = zlib.compress(payload)
    pdf = (b"%PDF-1.4\n4 0 obj\n<< /Length " + str(len(stream)).encode() +
           b" /Filter /FlateDecode >>\nstream\n" + stream + b"\nendstream\nendobj\n")
    text = _pdf_text_fallback(pdf)
    assert "Operating voltage: 4.5 V to 13.5 V" in text


def test_registry_seeds_match_catalog():
    # Extended for item kinds (§10): the PART entries keep the original
    # discipline exactly (12 seeded entries, every id a real parts.json
    # record). Material entries resolve to a material record in parts.json
    # or materials.json — or carry a name, marking them as declared seeds
    # whose record apply will create; tool entries likewise for tools.json.
    registry = load_registry(REPO / "tools" / "gather" / "sources.json")
    catalog = json.loads((REPO / "catalog" / "parts.json").read_text())
    ids = {p["id"] for p in catalog["parts"]}
    materials_path = REPO / "catalog" / "materials.json"
    tools_path = REPO / "catalog" / "tools.json"
    material_ids = {m["id"] for m in
                    json.loads(materials_path.read_text())["materials"]} \
        if materials_path.exists() else set()
    tool_ids = {t["id"] for t in
                json.loads(tools_path.read_text())["tools"]} \
        if tools_path.exists() else set()
    parts_entries = [e for e in registry if e.get("kind", "part") == "part"]
    assert len(parts_entries) == 12
    for entry in registry:
        kind = entry.get("kind", "part")
        if kind == "part":
            assert entry["part_id"] in ids, entry["part_id"]
        elif kind == "material":
            assert entry["part_id"] in ids | material_ids \
                or entry.get("name"), entry["part_id"]
        else:
            assert entry["part_id"] in tool_ids \
                or entry.get("name"), entry["part_id"]
        for page in entry["pages"]:
            assert page["url"].startswith("https://")
    schema = json.loads((REPO / "tools" / "gather" / "sources.schema.json").read_text())
    assert schema["title"]
