"""On-demand gathering for UNKNOWN parts (Forge Engine §8 follow-up).

Hermetic, same pattern as test_gather.py: FakeTransport + MockExtractor.
The properties under test: dedupe stops before any fetch (and a near-miss
like BNO085 does NOT match BNO055), a genuine miss creates exactly one
registry draft plus a proposal that never touches the catalog, conflicts
across sources land in the confirm queue with both values recorded, a
repeat run makes zero model calls, the requests queue drains into honest
states, and apply can create the new part + promote its registry draft.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "tools"))

from gather.apply import apply_run, save_catalog
from gather.extract import MockExtractor
from gather.fetcher import Fetcher, TransportResponse
from gather.gather_part import (drain_requests, gather_unknown, load_drafts,
                                load_requests, lookup_part, queue_request,
                                slugify_part_id)

FIXTURES = Path(__file__).parent / "fixtures" / "gather"
REPO = Path(__file__).parent.parent

URL_P = "https://fixture.local/qc7-product"
URL_D = "https://fixture.local/qc7-datasheet"
NAME = "QuantCore QC-7 encoder"
PART_ID = "quantcore_qc_7_encoder"


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


def real_catalog():
    return json.loads((REPO / "catalog" / "parts.json").read_text())


def qc7_pages():
    return {URL_P: (FIXTURES / "fixture_qc7_product.html").read_bytes(),
            URL_D: (FIXTURES / "fixture_qc7_datasheet.html").read_bytes()}


def qc7_canned():
    return {
        URL_P: {
            "fields": [
                {"field": "voltage_v", "value": [3.0, 5.5], "unit": "V",
                 "quote": "Supply voltage: 3.0 V to 5.5 V."},
                {"field": "mass_g", "value": 3.1, "unit": "g",
                 "quote": "Mass: 3.1 g including cable."},
            ],
            "price_breaks": [
                {"qty": 1, "unit_price": 4.25, "currency": "USD",
                 "quote": "Price: $4.25 for one"},
                {"qty": 10, "unit_price": 3.80, "currency": "USD",
                 "quote": "10 or more: $3.80 each"},
            ],
            "stock_wording": {"value": "In stock",
                              "quote": "In stock: 58 ready to ship."},
        },
        URL_D: {
            "fields": [
                {"field": "voltage_v", "value": [3.3, 5.0], "unit": "V",
                 "quote": "Operating supply voltage range: 3.3 V to 5.0 V."},
                {"field": "current_a", "value": 6.5, "unit": "mA",
                 "quote": "Supply current: 6.5 mA typical."},
            ],
            "price_breaks": [],
            "stock_wording": None,
        },
    }


def run_qc7(tmp_path, catalog=None, extractor=None, fetcher=None,
            transport=None):
    transport = transport or FakeTransport(qc7_pages())
    fetcher = fetcher or make_fetcher(tmp_path, transport, Clock())
    extractor = extractor or MockExtractor(qc7_canned())
    rep = gather_unknown(NAME, [URL_P, URL_D], catalog=catalog or real_catalog(),
                         drafts_path=tmp_path / "sources.drafts.json",
                         fetcher=fetcher, extractor=extractor,
                         proposals_dir=tmp_path / "proposals",
                         kinds=["product", "datasheet"],
                         requested_by="test", now=Clock().t)
    return rep, extractor, transport, fetcher


# ---------------------------------------------------------------- dedupe

def test_dedupe_hit_stops_before_any_fetch(tmp_path):
    transport = FakeTransport({})
    fetcher = make_fetcher(tmp_path, transport, Clock())
    extractor = MockExtractor({})
    rep = gather_unknown("MG996R servo", [URL_P], catalog=real_catalog(),
                         drafts_path=tmp_path / "sources.drafts.json",
                         fetcher=fetcher, extractor=extractor,
                         proposals_dir=tmp_path / "proposals", now=Clock().t)
    assert rep["status"] == "known"
    assert rep["part_id"] == "servo_mg996r"
    assert transport.calls == []          # no fetch, not even robots.txt
    assert extractor.calls == 0           # no model call
    assert not (tmp_path / "sources.drafts.json").exists()   # no draft
    assert not (tmp_path / "proposals").exists()             # no proposal


def test_dedupe_variants_and_near_miss():
    catalog = real_catalog()
    hit, _ = lookup_part("TB6612", catalog)
    assert hit["id"] == "driver_tb6612fng"
    hit, _ = lookup_part("MG996R servo", catalog)
    assert hit["id"] == "servo_mg996r"
    # the near-miss guard: BNO085 is a different chip from the catalog's
    # BNO055 and must NOT resolve to it; AS5600 is simply absent.
    hit, _ = lookup_part("BNO085", catalog)
    assert hit is None
    hit, _ = lookup_part("AS5600 magnetic encoder", catalog)
    assert hit is None
    assert slugify_part_id("AS5600 magnetic encoder") == "as5600_magnetic_encoder"


# ---------------------------------------------------------------- miss flow

def test_miss_creates_one_draft_and_a_proposal(tmp_path):
    catalog = real_catalog()
    before = json.dumps(catalog, sort_keys=True)
    rep, extractor, _, _ = run_qc7(tmp_path, catalog=catalog)
    assert rep["status"] == "proposed"
    assert rep["part_id"] == PART_ID
    assert rep["registry_draft"] == "created"
    assert extractor.calls == 2  # one per changed page

    drafts = load_drafts(tmp_path / "sources.drafts.json")
    assert len(drafts["sources"]) == 1
    entry = drafts["sources"][0]
    assert entry["part_id"] == PART_ID
    assert [p["url"] for p in entry["pages"]] == [URL_P, URL_D]
    assert entry["draft"] is True

    proposal = json.loads(Path(rep["proposal_json"]).read_text())
    ent = proposal["entries"][0]
    assert ent["new_part"] is True
    assert ent["part_stub"] == {"id": PART_ID, "name": NAME, "specs": {}}
    by_field = {c["field"]: c for c in ent["changes"]}
    assert by_field["mass_g"]["proposed"] == 3.1
    assert by_field["current_a"]["proposed"] == 0.0065  # 6.5 mA normalized
    price = by_field["price_estimate"]["proposed"]
    assert price["unit_price"] == 4.25
    assert price["source_kind"] == "web_gathered"
    # photo candidate from the product page's og:image, with credit
    photo = ent["photo_candidate"]
    assert photo["url"] == "https://fixture.local/img/qc7-encoder.jpg"
    assert photo["credit"] == "fixture"
    assert photo["state"] == "web_gathered"
    # the catalog object passed in was never mutated
    assert json.dumps(catalog, sort_keys=True) == before


def test_conflicting_sources_surface_in_confirm_queue(tmp_path):
    rep, _, _, _ = run_qc7(tmp_path)
    proposal = json.loads(Path(rep["proposal_json"]).read_text())
    ent = proposal["entries"][0]
    by_field = {c["field"]: c for c in ent["changes"]}
    # datasheet wins per pipeline precedence, both ends of the range
    assert by_field["voltage_v_min"]["proposed"] == 3.3
    assert by_field["voltage_v_max"]["proposed"] == 5.0
    assert set(rep["conflicts"]) == {"voltage_v_min", "voltage_v_max"}
    for field_name, losing in (("voltage_v_min", 3.0), ("voltage_v_max", 5.5)):
        change = by_field[field_name]
        assert change["safety_relevant"] is True  # confirm queue
        assert change["conflicts"][0]["other"]["value"] == losing
        assert change["conflicts"][0]["other"]["source_url"] == URL_P
    notes = " ".join(ent["notes"])
    assert "conflict on voltage_v_min" in notes
    assert "conflict on voltage_v_max" in notes
    md = Path(rep["proposal_md"]).read_text()
    assert "Confirm individually" in md  # rendered into the confirm section


def test_second_run_zero_model_calls_and_no_duplicate_draft(tmp_path):
    rep1, extractor, transport, fetcher = run_qc7(tmp_path)
    assert rep1["changes"] > 0 and extractor.calls == 2
    rep2, _, _, _ = run_qc7(tmp_path, extractor=extractor, fetcher=fetcher,
                            transport=transport)
    assert rep2["registry_draft"] == "reused"
    assert extractor.calls == 2, "repeat run over unchanged pages made a model call"
    assert rep2["model_calls"] == 0
    assert rep2["changes"] == 0
    drafts = load_drafts(tmp_path / "sources.drafts.json")
    assert len(drafts["sources"]) == 1  # still exactly one registry entry


# ---------------------------------------------------------------- queue

def test_queue_request_dedupes_open_lines(tmp_path):
    path = tmp_path / "requests.jsonl"
    r1 = queue_request(path, "Mystery widget 3000", requested_by="test",
                       now=Clock().t)
    assert r1["queued"] is True and r1["status"] == "needs_sources"
    r2 = queue_request(path, "mystery widget 3000", requested_by="test",
                       now=Clock().t)
    assert r2["queued"] is False and r2["already_queued"] is True
    assert len(load_requests(path)) == 1


def test_requests_drain_states(tmp_path):
    path = tmp_path / "requests.jsonl"
    lines = [
        {"name": "MG996R servo", "requested_by": "test",
         "at": "2026-11-01T00:00:00Z", "status": "pending"},
        {"name": NAME, "requested_by": "test", "at": "2026-11-01T00:00:00Z",
         "status": "pending", "urls": [URL_P, URL_D]},
        {"name": NAME, "requested_by": "test", "at": "2026-11-01T00:00:00Z",
         "status": "pending", "urls": [URL_P, URL_D]},
        {"name": "Mystery widget 3000", "requested_by": "test",
         "at": "2026-11-01T00:00:00Z", "status": "pending"},
        {"name": "Finished earlier", "requested_by": "test",
         "at": "2026-11-01T00:00:00Z", "status": "proposed", "run_id": "old"},
    ]
    path.write_text("".join(json.dumps(l) + "\n" for l in lines))
    transport = FakeTransport(qc7_pages())
    fetcher = make_fetcher(tmp_path, transport, Clock())
    outcomes = drain_requests(path, catalog=real_catalog(),
                              drafts_path=tmp_path / "sources.drafts.json",
                              fetcher=fetcher,
                              extractor=MockExtractor(qc7_canned()),
                              proposals_dir=tmp_path / "proposals",
                              now=Clock().t)
    by_name = [(o["name"], o["result"]) for o in outcomes]
    assert by_name == [("MG996R servo", "known"), (NAME, "proposed"),
                       (NAME, "proposed"), ("Mystery widget 3000", "needs_sources")]
    after = load_requests(path)
    assert [l["status"] for l in after] == ["known", "proposed", "proposed",
                                            "needs_sources", "proposed"]
    assert after[1]["run_id"] == after[2]["run_id"]  # duplicate shares the run
    assert "duplicate" in after[2]["note"]
    assert after[4]["run_id"] == "old"  # terminal line untouched
    drafts = load_drafts(tmp_path / "sources.drafts.json")
    assert len(drafts["sources"]) == 1


# ---------------------------------------------------------------- apply

def test_apply_creates_part_and_promotes_draft(tmp_path):
    gather_dir = tmp_path / "gather"
    proposals_dir = gather_dir / "proposals"
    transport = FakeTransport(qc7_pages())
    fetcher = make_fetcher(tmp_path, transport, Clock())
    rep = gather_unknown(NAME, [URL_P, URL_D], catalog=real_catalog(),
                         drafts_path=gather_dir / "sources.drafts.json",
                         fetcher=fetcher, extractor=MockExtractor(qc7_canned()),
                         proposals_dir=proposals_dir,
                         kinds=["product", "datasheet"],
                         requested_by="test", now=Clock().t)
    assert rep["status"] == "proposed"
    (gather_dir / "sources.json").write_text(
        json.dumps({"version": 1, "sources": []}))
    catalog = {"parts": [], "templates": []}
    catalog_path = tmp_path / "parts.json"
    save_catalog(catalog, catalog_path)

    report = apply_run(rep["run_id"], proposals_dir, catalog_path)
    assert report["created_parts"] == [PART_ID]
    assert report["registry_promoted"] == [PART_ID]
    saved = json.loads(catalog_path.read_text())
    part = saved["parts"][0]
    assert part["name"] == NAME
    assert part["specs"]["voltage_v_min"] == 3.3  # datasheet value applied
    assert part["specs"]["mass_g"] == 3.1
    assert part["price_estimate"]["unit_price"] == 4.25
    assert part["photo"]["url"].endswith("qc7-encoder.jpg")
    assert part["provenance_gathered"]["voltage_v_min"]["state"] == "web_gathered"
    drafts = load_drafts(gather_dir / "sources.drafts.json")
    assert drafts["sources"] == []  # promoted out of drafts
    registry = json.loads((gather_dir / "sources.json").read_text())
    assert [e["part_id"] for e in registry["sources"]] == [PART_ID]
    assert "draft" not in registry["sources"][0]
