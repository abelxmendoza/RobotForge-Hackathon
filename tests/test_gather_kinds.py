"""Gather pipeline for MATERIALS and TOOLS (Forge Engine §10).

Same hermetic pattern as test_gather.py: FakeTransport + MockExtractor.
The properties under test: each kind validates against its own schema
(a part field is not a material field; a value without a verbatim quote
dies in every kind), price carries its basis, dedupe checks all three
catalogs (and a near-miss still misses), kind-filtered runs touch only
their kind, a repeat run makes zero model calls, and apply creates
material/tool records in their own catalog files — never in parts.json.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "tools"))

from gather.apply import apply_run, save_catalog
from gather.extract import MockExtractor
from gather.fetcher import Fetcher, TransportResponse, html_to_text
from gather.gather import run_pipeline
from gather.gather_part import gather_unknown, load_drafts, lookup_item
from gather.propose import write_proposal
from gather.validate import validate_extraction

FIXTURES = Path(__file__).parent / "fixtures" / "gather"
REPO = Path(__file__).parent.parent

URL_M = "https://fixture.local/fixturelite-pla"
URL_T = "https://fixture.local/fixtureprint-f3"
TTLS = {"price": 86400, "stock": 21600, "specs": 2592000, "datasheet": 7776000}


class FakeTransport:
    def __init__(self, pages: dict):
        self.pages = pages
        self.calls: list[str] = []

    def get(self, url: str, headers: dict) -> TransportResponse:
        self.calls.append(url)
        if url.endswith("/robots.txt"):
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


def fixture_pages():
    return {URL_M: (FIXTURES / "fixture_pla.html").read_bytes(),
            URL_T: (FIXTURES / "fixture_printer.html").read_bytes()}


def pla_canned():
    return {URL_M: {
        "fields": [
            {"field": "density_g_cm3", "value": 1.24, "unit": "g/cm3",
             "quote": "Density: 1.24 g/cm3"},
            {"field": "filament_diameter_mm", "value": 1.75, "unit": "mm",
             "quote": "Filament diameter: 1.75 mm"},
            {"field": "nozzle_temp_c", "value": [190, 220], "unit": "°C",
             "quote": "Recommended nozzle temperature: 190 °C to 220 °C"},
            {"field": "bed_temp_c", "value": [50, 60], "unit": "°C",
             "quote": "Recommended bed temperature: 50 °C to 60 °C"},
            {"field": "spool_weight_g", "value": 1, "unit": "kg",
             "quote": "Spool weight: 1 kg of filament on the spool"},
        ],
        "price_breaks": [
            {"qty": 1, "unit_price": 19.99, "currency": "USD",
             "quote": "Price: $19.99 for one 1 kg spool"},
            {"qty": 10, "unit_price": 17.49, "currency": "USD",
             "quote": "10 or more: $17.49 each"},
        ],
        "stock_wording": {"value": "In stock",
                          "quote": "In stock: 214 ready to ship."},
        "price_basis": {"value": "per 1 kg spool",
                        "quote": "Price: $19.99 for one 1 kg spool"},
    }}


def printer_canned():
    return {URL_T: {
        "fields": [
            {"field": "build_volume_x_mm", "value": 220, "unit": "mm",
             "quote": "Build volume: 220 x 220 x 250 mm"},
            {"field": "build_volume_y_mm", "value": 220, "unit": "mm",
             "quote": "Build volume: 220 x 220 x 250 mm"},
            {"field": "build_volume_z_mm", "value": 250, "unit": "mm",
             "quote": "Build volume: 220 x 220 x 250 mm"},
            {"field": "supported_materials", "value": ["PLA", "PETG", "TPU"],
             "quote": "Supported materials: PLA, PETG, TPU"},
            {"field": "mass_g", "value": 8.5, "unit": "kg",
             "quote": "Machine weight: 8.5 kg"},
        ],
        "price_breaks": [
            {"qty": 1, "unit_price": 299.0, "currency": "USD",
             "quote": "Price: $299.00"},
        ],
        "stock_wording": {"value": "In stock",
                          "quote": "In stock and ready to ship."},
    }}


def pla_entry():
    return {"part_id": "pla_filament", "kind": "material", "mpn": None,
            "name": "PLA filament 1.75 mm, 1 kg", "ttl_seconds": TTLS,
            "pages": [{"kind": "product", "url": URL_M, "supplier": "fixture",
                       "provides": ["price", "stock", "specs"]}]}


def printer_entry():
    return {"part_id": "printer_fixture_f3", "kind": "tool", "mpn": None,
            "name": "FixturePrint F3 3D printer", "ttl_seconds": TTLS,
            "pages": [{"kind": "product", "url": URL_T, "supplier": "fixture",
                       "provides": ["price", "stock", "specs"]}]}


def empty_catalogs():
    return {"parts": {"parts": [], "templates": []},
            "materials": {"materials": []},
            "tools": {"tools": []}}


# ---------------------------------------------------------------- validate

def test_material_schema_quote_gate_and_units():
    text = html_to_text((FIXTURES / "fixture_pla.html").read_bytes())
    raw = {"fields": [
        {"field": "density_g_cm3", "value": 1.24, "unit": "g/cm3",
         "quote": "Density: 1.24 g/cm3"},
        {"field": "density_g_cm3", "value": 9.99, "unit": "g/cm3",
         "quote": "Density: 9.99 g/cm3"},  # fabricated: not on the page
        {"field": "voltage_v_max", "value": 13.5, "unit": "V",
         "quote": "Density: 1.24 g/cm3"},  # a part field, not a material field
        {"field": "spool_weight_g", "value": 1000, "unit": "g",
         "quote": "Spool weight: 1 kg of filament on the spool"},
    ], "price_breaks": [], "stock_wording": None}
    validated = validate_extraction(raw, text, URL_M, kind="material")
    by_field = {f.field: f.value for f in validated.fields}
    assert by_field == {"density_g_cm3": 1.24, "spool_weight_g": 1000.0}
    reasons = {(r.item, r.reason) for r in validated.rejected}
    assert ("density_g_cm3", "quote_not_found") in reasons
    assert ("voltage_v_max", "field_not_in_schema") in reasons
    # density is confirm-queue (safety) for materials
    dens = next(f for f in validated.fields if f.field == "density_g_cm3")
    assert dens.safety_relevant is True


def test_degree_sign_variants_normalize():
    # Polymaker's store prints temps with U+02DA (ring above) instead of
    # the degree sign; the first live materials run lost every temp field
    # to unit_unparseable until the unit key normalized it.
    text = "Nozzle: 190 ˚C to 230 ˚C. Density: 1.24 g/cm³."
    raw = {"fields": [
        {"field": "nozzle_temp_c", "value": [190, 230], "unit": "˚C",
         "quote": "Nozzle: 190 ˚C to 230 ˚C"},
        {"field": "density_g_cm3", "value": 1.24, "unit": "g/cm³",
         "quote": "Density: 1.24 g/cm³"},
    ], "price_breaks": [], "stock_wording": None}
    validated = validate_extraction(raw, text, "https://x.local/m", kind="material")
    by_field = {f.field: f.value for f in validated.fields}
    assert by_field["nozzle_temp_c"] == [190.0, 230.0]
    assert by_field["density_g_cm3"] == 1.24
    assert validated.rejected == []


def test_material_density_unit_conversion_kg_m3():
    text = "Density: 1240 kg/m3 for this filament."
    raw = {"fields": [{"field": "density_g_cm3", "value": 1240,
                       "unit": "kg/m3", "quote": "Density: 1240 kg/m3"}],
           "price_breaks": [], "stock_wording": None}
    validated = validate_extraction(raw, text, "https://x.local/m", kind="material")
    assert validated.fields[0].value == 1.24


def test_price_basis_needs_a_real_quote():
    text = html_to_text((FIXTURES / "fixture_pla.html").read_bytes())
    good = validate_extraction(
        {"fields": [], "price_breaks": [],
         "price_basis": {"value": "per 1 kg spool",
                         "quote": "Price: $19.99 for one 1 kg spool"}},
        text, URL_M, kind="material")
    assert good.price_basis == "per 1 kg spool"
    bad = validate_extraction(
        {"fields": [], "price_breaks": [],
         "price_basis": {"value": "per 1 kg spool",
                         "quote": "sold by the 1 kg spool, trust us"}},
        text, URL_M, kind="material")
    assert bad.price_basis is None
    assert ("price_basis", "quote_not_found") in {
        (r.item, r.reason) for r in bad.rejected}


def test_tool_schema_printer_scope_soldering():
    text = html_to_text((FIXTURES / "fixture_printer.html").read_bytes())
    validated = validate_extraction(printer_canned()[URL_T], text, URL_T,
                                    kind="tool")
    by_field = {f.field: f.value for f in validated.fields}
    assert by_field["build_volume_x_mm"] == 220
    assert by_field["build_volume_z_mm"] == 250
    assert by_field["supported_materials"] == ["PLA", "PETG", "TPU"]
    assert by_field["mass_g"] == 8500
    assert validated.rejected == []
    bv = next(f for f in validated.fields if f.field == "build_volume_x_mm")
    assert bv.safety_relevant is True  # build volume feeds print-fit

    scope_text = ("Bandwidth: 2 GHz. Sample rate: 2.5 GS/s. Channels: 4. "
                  "Tip temperature range: 392 °F to 842 °F.")
    raw = {"fields": [
        {"field": "bandwidth_mhz", "value": 2, "unit": "GHz",
         "quote": "Bandwidth: 2 GHz"},
        {"field": "sample_rate_gsps", "value": 2.5, "unit": "GS/s",
         "quote": "Sample rate: 2.5 GS/s"},
        {"field": "channels", "value": 4, "unit": "",
         "quote": "Channels: 4"},
        {"field": "temp_range_c", "value": [392, 842], "unit": "°F",
         "quote": "Tip temperature range: 392 °F to 842 °F"},
        {"field": "supported_materials", "value": "PLA",
         "quote": "Channels: 4"},  # a string where a list belongs
    ], "price_breaks": [], "stock_wording": None}
    v2 = validate_extraction(raw, scope_text, "https://x.local/t", kind="tool")
    by2 = {f.field: f.value for f in v2.fields}
    assert by2["bandwidth_mhz"] == 2000
    assert by2["sample_rate_gsps"] == 2.5
    assert by2["channels"] == 4
    assert by2["temp_range_c"] == [200.0, 450.0]  # °F converted
    assert ("supported_materials", "type_mismatch") in {
        (r.item, r.reason) for r in v2.rejected}


# ---------------------------------------------------------------- pipeline

def test_material_run_proposes_price_with_basis(tmp_path):
    catalogs = empty_catalogs()
    catalogs["parts"]["parts"].append(
        {"id": "pla_filament", "name": "PLA filament 1.75 mm, 1 kg",
         "part_class": "materials", "specs": {}})
    transport = FakeTransport(fixture_pages())
    fetcher = make_fetcher(tmp_path, transport, Clock())
    extractor = MockExtractor(pla_canned())
    proposal = run_pipeline([pla_entry()], catalogs, fetcher, extractor,
                            now=Clock().t)
    ent = proposal["entries"][0]
    assert ent["kind"] == "material" and ent["catalog_home"] == "parts"
    by_field = {c["field"]: c for c in ent["changes"]}
    assert by_field["density_g_cm3"]["proposed"] == 1.24
    assert by_field["nozzle_temp_c_min"]["proposed"] == 190
    assert by_field["nozzle_temp_c_max"]["proposed"] == 220
    assert by_field["bed_temp_c_min"]["proposed"] == 50
    assert by_field["spool_weight_g"]["proposed"] == 1000
    price = by_field["price_estimate"]["proposed"]
    assert price["unit_price"] == 19.99
    assert price["basis"] == "per 1 kg spool"
    assert price["source_kind"] == "web_gathered"
    # second run over unchanged pages: zero model calls, zero changes (§8.1)
    proposal2 = run_pipeline([pla_entry()], catalogs, fetcher, extractor,
                             force=True, now=Clock().t)
    assert extractor.calls == 1
    assert proposal2["summary"]["model_calls"] == 0
    assert proposal2["summary"]["changes"] == 0


def test_kind_filtered_run_touches_only_its_kind(tmp_path):
    transport = FakeTransport(fixture_pages())
    fetcher = make_fetcher(tmp_path, transport, Clock())
    extractor = MockExtractor({**pla_canned(), **printer_canned()})
    proposal = run_pipeline([pla_entry(), printer_entry()], empty_catalogs(),
                            fetcher, extractor, kinds={"tool"}, now=Clock().t)
    assert [e["part_id"] for e in proposal["entries"]] == ["printer_fixture_f3"]
    assert extractor.calls == 1
    assert extractor.called_urls == [URL_T]


def test_tool_apply_creates_record_in_tools_json(tmp_path):
    transport = FakeTransport(fixture_pages())
    fetcher = make_fetcher(tmp_path, transport, Clock())
    proposal = run_pipeline([printer_entry()], empty_catalogs(), fetcher,
                            MockExtractor(printer_canned()), now=Clock().t)
    ent = proposal["entries"][0]
    assert ent["new_item"] is True and ent["catalog_home"] == "tools"

    out_dir = tmp_path / "proposals"
    write_proposal(proposal, out_dir)
    catalog_path = tmp_path / "parts.json"
    save_catalog({"parts": [], "templates": []}, catalog_path)
    report = apply_run(proposal["run_id"], out_dir, catalog_path)
    assert report["created_parts"] == ["printer_fixture_f3"]

    tools = json.loads((tmp_path / "tools.json").read_text())
    assert len(tools["tools"]) == 1
    rec = tools["tools"][0]
    assert rec["kind"] == "tool"
    assert rec["specs"]["build_volume_x_mm"] == 220
    assert rec["specs"]["build_volume_z_mm"] == 250
    assert rec["specs"]["supported_materials"] == ["PLA", "PETG", "TPU"]
    assert rec["price_estimate"]["unit_price"] == 299.0
    prov = rec["provenance_gathered"]["build_volume_x_mm"]
    assert prov["state"] == "web_gathered"
    assert "Build volume: 220 x 220 x 250 mm" in prov["quote"]
    # the parts catalog is untouched and no materials file was invented
    assert json.loads(catalog_path.read_text())["parts"] == []
    assert not (tmp_path / "materials.json").exists()


# ---------------------------------------------------------------- dedupe

def test_lookup_item_searches_all_three_catalogs():
    catalogs = empty_catalogs()
    real_parts = json.loads((REPO / "catalog" / "parts.json").read_text())
    catalogs["parts"] = real_parts
    catalogs["tools"]["tools"].append(
        {"id": "scope_rigol_ds1054z", "name": "Rigol DS1054Z oscilloscope",
         "specs": {}})
    catalogs["materials"]["materials"].append(
        {"id": "asa_filament", "name": "ASA filament 1.75 mm, 1 kg",
         "specs": {}})

    hit, kind, home, _ = lookup_item("PLA filament", catalogs)
    assert hit["id"] == "pla_filament" and kind == "material" and home == "parts"
    hit, kind, home, _ = lookup_item("DS1054Z", catalogs)
    assert hit["id"] == "scope_rigol_ds1054z" and kind == "tool" and home == "tools"
    hit, kind, home, _ = lookup_item("ASA filament", catalogs)
    assert hit["id"] == "asa_filament" and kind == "material" and home == "materials"
    hit, kind, home, _ = lookup_item("TB6612", catalogs)
    assert hit["id"] == "driver_tb6612fng" and kind == "part"
    # near-misses still miss, in every catalog
    for name in ("BNO085", "DS1104Z oscilloscope"):
        hit, _, _, _ = lookup_item(name, catalogs)
        assert hit is None, name


def test_on_demand_material_flow_creates_draft_and_record(tmp_path):
    gather_dir = tmp_path / "gather"
    proposals_dir = gather_dir / "proposals"
    (gather_dir).mkdir(parents=True)
    (gather_dir / "sources.json").write_text(json.dumps({"version": 1, "sources": []}))
    catalog_path = tmp_path / "parts.json"
    save_catalog({"parts": [], "templates": []}, catalog_path)
    catalogs = empty_catalogs()

    transport = FakeTransport(fixture_pages())
    fetcher = make_fetcher(tmp_path, transport, Clock())
    rep = gather_unknown("FixtureLite PLA-CF filament", [URL_M],
                         catalog={"parts": [], "templates": []},
                         catalogs=catalogs,
                         drafts_path=gather_dir / "sources.drafts.json",
                         fetcher=fetcher, extractor=MockExtractor(pla_canned()),
                         proposals_dir=proposals_dir,
                         item_kind="material", requested_by="test",
                         now=Clock().t)
    assert rep["status"] == "proposed" and rep["kind"] == "material"
    drafts = load_drafts(gather_dir / "sources.drafts.json")
    assert drafts["sources"][0]["kind"] == "material"

    report = apply_run(rep["run_id"], proposals_dir, catalog_path)
    assert report["created_parts"] == ["fixturelite_pla_cf_filament"]
    materials = json.loads((tmp_path / "materials.json").read_text())
    rec = materials["materials"][0]
    assert rec["kind"] == "material"
    assert rec["specs"]["density_g_cm3"] == 1.24
    assert rec["price_estimate"]["basis"] == "per 1 kg spool"
    assert rec["photo"]["url"].endswith("fixturelite-pla.jpg")
    # registry promotion kept the kind: one entry, in exactly one registry
    registry = json.loads((gather_dir / "sources.json").read_text())
    assert [e["part_id"] for e in registry["sources"]] == ["fixturelite_pla_cf_filament"]
    assert registry["sources"][0]["kind"] == "material"
    assert load_drafts(gather_dir / "sources.drafts.json")["sources"] == []

    # and now the same name dedupes as known — a material, in materials.json
    catalogs2 = {"parts": json.loads(catalog_path.read_text()),
                 "materials": materials, "tools": {"tools": []}}
    hit, kind, home, _ = lookup_item("FixtureLite PLA-CF filament", catalogs2)
    assert hit["id"] == "fixturelite_pla_cf_filament"
    assert kind == "material" and home == "materials"
