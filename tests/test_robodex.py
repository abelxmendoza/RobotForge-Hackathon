"""Robodex data integrity, CLI paths, and generated-page tests.

The Robodex rule under test: a gate badge exists only where recorded
runs exist. PASS without measured numbers must be impossible to load,
and the generated page must never show a PASS badge for an ungated
robot (the generated pages are tested in test_site.py).
"""
import io
import json
from contextlib import redirect_stderr, redirect_stdout

from robotforge.catalog import (GATE_STATUSES, CatalogError, GateStatus,
                                Robodex)
from robotforge.cli import main

dex = Robodex.load()


def assert_raises(exc_type, fn):
    try:
        fn()
    except exc_type:
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def test_numbers_are_unique_and_sequential():
    numbers = sorted(r.number for r in dex.robots)
    assert numbers == list(range(1, len(numbers) + 1)), numbers


def test_entries_have_required_fields():
    for r in dex.robots:
        assert r.name and r.robot_class and r.description
        assert r.key_specs, f"{r.name}: no key specs"
        assert r.provenance.get("source_name"), f"{r.name}: no provenance"
        assert r.provenance.get("license"), f"{r.name}: no licence recorded"
        assert r.gate_status.status in GATE_STATUSES


def test_the_four_founders_in_order():
    names = [r.name for r in dex.robots]
    assert names[:4] == ["Andino", "TurtleBot3 Burger", "TurtleBot3 Waffle Pi",
                         "Pathfinder"]
    # Pathfinder is flagged as our own original design, not a found robot.
    assert "Original design" in dex.robots[3].provenance["source_name"]


def test_pass_requires_recorded_measured_numbers():
    for r in dex.robots:
        gs = r.gate_status
        if gs.status == "PASS":
            assert gs.runs, f"{r.name}: PASS without runs"
            assert all(isinstance(run.drive_error_pct, (int, float))
                       for run in gs.runs), f"{r.name}: run without drive %"
            assert any(run.heading_error_deg is not None
                       for run in gs.runs), f"{r.name}: no heading recorded"
        if gs.status == "NOT_GATED":
            assert not gs.runs, f"{r.name}: ungated but carries runs"


def test_gate_status_loader_rejects_badges_without_runs():
    assert_raises(CatalogError, lambda: GateStatus.from_dict(
        {"status": "PASS", "runs": []}))
    assert_raises(CatalogError, lambda: GateStatus.from_dict(
        {"status": "GREEN", "runs": []}))
    assert_raises(CatalogError, lambda: GateStatus.from_dict(
        {"status": "NOT_GATED",
         "runs": [{"drive_error_pct": 1.0, "source": "x"}]}))


def test_find_robot_by_number_and_name():
    assert dex.find("1").name == "Andino"
    assert dex.find("#002").name == "TurtleBot3 Burger"
    assert dex.find("waffle").number == 3
    assert dex.find("Pathfinder").number == 4
    assert_raises(CatalogError, lambda: dex.find("optimus prime"))
    assert_raises(CatalogError, lambda: dex.find("99"))


def _run_cli(argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        rc = main(argv)
    return rc, out.getvalue(), err.getvalue()


def test_cli_summary_lists_robodex_and_parts():
    rc, out, _ = _run_cli(["catalog"])
    assert rc == 0
    for r in dex.robots:
        assert r.dex_id in out and r.name in out
    assert "Parts catalog:" in out


def test_cli_robot_and_part_detail():
    rc, out, _ = _run_cli(["catalog", "robot", "2"])
    assert rc == 0 and "TurtleBot3 Burger" in out and "Apache-2.0" in out
    rc, out, _ = _run_cli(["catalog", "part", "rplidar_a1"])
    assert rc == 0 and "RPLIDAR" in out


def test_cli_json_summary_is_machine_readable():
    rc, out, _ = _run_cli(["catalog", "--json"])
    assert rc == 0
    doc = json.loads(out)
    assert len(doc["robots"]) == len(dex.robots)
    assert doc["parts_count"] > 0


def test_cli_unknown_lookups_are_clean_errors():
    rc, _, err = _run_cli(["catalog", "robot", "nonexistent-robot"])
    assert rc == 2 and "catalog error" in err
    rc, _, err = _run_cli(["catalog", "part", "nonexistent-part"])
    assert rc == 2 and "catalog error" in err
