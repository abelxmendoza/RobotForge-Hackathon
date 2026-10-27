"""Harness check tests.

The posture under test, in order of importance:

1. No blanket pass, ever. A report is counts — checked clean,
   warnings, errors, partial, not checked — and every NOT_CHECKED
   evaluation names the input it is missing. The recorded fleet
   reports are re-derived from the specs so the records can't drift.
2. The physics is right: the voltage-drop formula against a
   hand-computed value, the AWG area series, the ampacity table's
   edges (at the rating passes, above it errors).
3. Every one of the five checks fires on a synthetic gauntlet built
   to trip it, and a fully-specified clean harness comes back with
   every evaluation CHECKED and zero findings.
"""
import io
import json
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from robotforge.catalog import Robodex
from robotforge.cli import main
from robotforge.harness import (AMPACITY_A, CHECKED, NOT_CHECKED,
                                PARTIAL, WARN, HarnessError, ampacity_a,
                                awg_area_mm2, check_spec_data,
                                format_harness_report, has_errors,
                                voltage_drop_v, wire_loop_resistance_ohm)
from robotforge.site import render_evidence, render_robot_page, slugify

REPO = Path(__file__).resolve().parent.parent
dex = Robodex.load()

BASE = {
    "description": "harness fixture", "drivetrain": "differential",
    "length_m": 0.4, "width_m": 0.3, "height_m": 0.2, "mass_kg": 2.0,
    "motor": {"kind": "dc_gearmotor", "count": 2, "voltage_v": 12.0},
    "battery": {"chemistry": "lipo", "voltage_v": 12.0,
                "capacity_mah": 5000},
    "wheel": {"diameter_m": 0.1, "width_m": 0.03, "count": 2},
    "ground_clearance_m": 0.03,
}


def _spec(name, nodes, connections):
    d = dict(BASE, name=name)
    d["wiring"] = {"note": "fixture", "nodes": nodes,
                   "connections": connections}
    return d


def _eval(rep, check, subject):
    hits = [ev for ev in rep.evaluations
            if ev.check == check and ev.subject == subject]
    assert len(hits) == 1, (check, subject, rep.evaluations)
    return hits[0]


# ----------------------------------------------------------------------
# wire physics
# ----------------------------------------------------------------------

def test_awg_area_series_matches_the_standard_table():
    assert abs(awg_area_mm2(10) - 5.26) < 0.01
    assert abs(awg_area_mm2(14) - 2.08) < 0.01
    assert abs(awg_area_mm2(20) - 0.518) < 0.005
    # area doubles every 3 gauges, by construction of the series
    assert abs(awg_area_mm2(17) / awg_area_mm2(20) - 2.0) < 0.01


def test_voltage_drop_against_a_hand_computed_value():
    # 20 AWG (0.518 mm^2), 2 m one-way run, 8 A:
    # R_loop = 1.68e-8 * (2 * 2000 mm in m) / 0.518e-6 m^2 = 0.1297 ohm
    # V = I * R = 8 * 0.1297 = 1.038 V
    r = wire_loop_resistance_ohm(20, 2000)
    assert abs(r - 0.1297) < 0.002
    v = voltage_drop_v(20, 2000, 8.0)
    assert abs(v - 1.038) < 0.01


def test_ampacity_table_edges():
    assert ampacity_a(14) == 5.9
    assert ampacity_a(20) == 1.5
    assert ampacity_a(10) == 15.0
    assert ampacity_a(33) is None       # outside the printed table
    assert ampacity_a(13.5) is None     # never interpolated


# ----------------------------------------------------------------------
# the gauntlet: every check fires
# ----------------------------------------------------------------------

GAUNTLET = _spec("gauntlet", [
    {"id": "battery", "label": "Battery", "req_label": "12 V",
     "output_current_a": 20},
    {"id": "regulator", "label": "Regulator", "req_label": "5 V",
     "output_current_a": 1.0},
    {"id": "computer", "label": "Computer", "req_label": "5 V",
     "current_a": 1.5, "logic_v": 3.3},
    {"id": "sensor", "label": "Sensor", "req_label": "5 V",
     "current_a": 0.2, "logic_v": 5.0},
    {"id": "driver", "label": "Driver", "req_label": "12 V"},
    {"id": "motors", "label": "Motors", "req_label": "12 V",
     "current_a": 8.0},
    {"id": "aux", "label": "Aux rail", "req_label": "5 V",
     "output_current_a": 5.0},
    {"id": "knownload", "label": "Known load", "req_label": "5 V",
     "current_a": 1.0},
    {"id": "mystery", "label": "Mystery load", "req_label": "5 V"},
], [
    # long thin run at 8 A: drop + ampacity + connector all trip
    {"from": "battery", "to": "motors", "kind": "power", "volts": 12.0,
     "current_a": 8.0, "label": "main run",
     "connector_from": "XT30", "connector_to": "XT60",
     "cable": {"gauge_awg": 20, "length_mm": 2000}},
    {"from": "battery", "to": "regulator", "kind": "power",
     "volts": 12.0, "label": "regulator feed",
     "cable": {"gauge_awg": 18, "length_mm": 100}},
    {"from": "regulator", "to": "computer", "kind": "power",
     "volts": 5.0, "label": "5 V rail",
     "connector_from": "JST-PH", "connector_to": "JST-PH",
     "cable": {"gauge_awg": 22, "length_mm": 100}},
    {"from": "regulator", "to": "sensor", "kind": "power",
     "volts": 5.0, "label": "sensor feed"},
    # 3.3 V computer talking to a 5 V sensor, no shifter recorded
    {"from": "computer", "to": "sensor", "kind": "data",
     "volts": None, "label": "serial"},
    {"from": "battery", "to": "driver", "kind": "power",
     "volts": 12.0, "label": "driver feed",
     "cable": {"gauge_awg": 14, "length_mm": 50}},
    {"from": "driver", "to": "motors", "kind": "power",
     "volts": None, "label": "PWM output",
     "cable": {"gauge_awg": 14, "length_mm": 300,
               "connector": "XT60"}},
    {"from": "aux", "to": "knownload", "kind": "power", "volts": 5.0,
     "label": "known branch"},
    {"from": "aux", "to": "mystery", "kind": "power", "volts": 5.0,
     "label": "unmeasured branch"},
])


def test_gauntlet_voltage_drop_fires_with_the_hand_computed_value():
    rep = check_spec_data(GAUNTLET)
    ev = _eval(rep, "voltage_drop", "battery -> motors")
    assert ev.state == "CHECKED"
    assert abs(ev.results["drop_v"] - 1.038) < 0.01
    assert ev.results["drop_pct"] > 5.0
    assert any(f.check == "harness.voltage_drop" and f.severity == "WARN"
               for f in ev.findings)


def test_gauntlet_ampacity_fires_as_an_error():
    rep = check_spec_data(GAUNTLET)
    ev = _eval(rep, "ampacity", "battery -> motors")
    assert ev.state == "CHECKED"
    assert ev.inputs["ampacity_a"] == AMPACITY_A[20] == 1.5
    assert any(f.check == "harness.ampacity" and f.severity == "ERROR"
               for f in ev.findings)
    assert has_errors(rep)


def test_gauntlet_logic_levels_fire():
    rep = check_spec_data(GAUNTLET)
    ev = _eval(rep, "logic_levels", "computer -> sensor")
    assert ev.state == "CHECKED"
    assert any(f.check == "harness.logic_levels" and f.severity == "WARN"
               for f in ev.findings)


def test_gauntlet_rail_budget_over_rating_is_an_error():
    rep = check_spec_data(GAUNTLET)
    ev = _eval(rep, "rail_budget", "regulator rail")
    # computer 1.5 A + sensor 0.2 A = 1.7 A known, rating 1.0 A
    assert ev.inputs["known_load_a"] == 1.7
    assert ev.state == "CHECKED"
    assert any(f.check == "harness.rail_budget" and f.severity == "ERROR"
               for f in ev.findings)


def test_gauntlet_rail_budget_with_unknown_loads_is_partial_and_named():
    rep = check_spec_data(GAUNTLET)
    ev = _eval(rep, "rail_budget", "aux rail")
    assert ev.state == "PARTIAL"
    assert "current_a for mystery" in ev.missing
    assert not ev.findings  # 1.0 A known of a 5 A rail: a floor, no claim


def test_gauntlet_connector_mismatch_fires():
    rep = check_spec_data(GAUNTLET)
    ev = _eval(rep, "connector_match", "battery -> motors")
    assert ev.state == "CHECKED"
    assert any(f.check == "harness.connector_match"
               and f.severity == "WARN" for f in ev.findings)
    # matched pair on the same harness stays silent
    ok = _eval(rep, "connector_match", "regulator -> computer")
    assert ok.state == "CHECKED" and not ok.findings


def test_gauntlet_not_checked_evaluations_name_their_missing_inputs():
    rep = check_spec_data(GAUNTLET)
    ev = _eval(rep, "voltage_drop", "regulator -> sensor")
    assert ev.state == "NOT_CHECKED"
    assert "cable.gauge_awg" in ev.missing
    assert "cable.length_mm" in ev.missing
    pwm = _eval(rep, "voltage_drop", "driver -> motors")
    assert pwm.state == "NOT_CHECKED"
    assert any("voltage" in m for m in pwm.missing)
    one_sided = _eval(rep, "connector_match", "driver -> motors")
    assert one_sided.state == "NOT_CHECKED"  # a lone connector is not a pair


# ----------------------------------------------------------------------
# the clean harness: everything specified, everything checked
# ----------------------------------------------------------------------

def _clean_spec():
    # connector pairs ride at connection level: the viewer's cable
    # record is strict ({gauge_awg, connector, length_mm}) and a
    # single `connector` names the assembly, not both ends.
    full = {"gauge_awg": 16, "length_mm": 100}
    small = {"gauge_awg": 24, "length_mm": 50}
    xt60 = {"connector_from": "XT60", "connector_to": "XT60"}
    jst = {"connector_from": "JST-PH", "connector_to": "JST-PH"}
    return _spec("clean", [
        {"id": "battery", "label": "Battery", "req_label": "12 V",
         "output_current_a": 10},
        {"id": "regulator", "label": "Regulator", "req_label": "5 V",
         "output_current_a": 3},
        {"id": "computer", "label": "Computer", "req_label": "5 V",
         "current_a": 1.0, "logic_v": 3.3},
        {"id": "sensor", "label": "Sensor", "req_label": "5 V",
         "current_a": 0.1, "logic_v": 3.3},
        {"id": "driver", "label": "Driver", "req_label": "12 V",
         "output_current_a": 5},
        {"id": "motors", "label": "Motors", "req_label": "12 V",
         "current_a": 2.0},
    ], [
        {"from": "battery", "to": "regulator", "kind": "power",
         "volts": 12.0, "label": "feed", "cable": dict(full), **xt60},
        {"from": "regulator", "to": "computer", "kind": "power",
         "volts": 5.0, "label": "5 V rail",
         "cable": {"gauge_awg": 20, "length_mm": 100}, **jst},
        {"from": "regulator", "to": "sensor", "kind": "power",
         "volts": 5.0, "label": "sensor feed", "cable": dict(small),
         **jst},
        {"from": "computer", "to": "sensor", "kind": "data",
         "volts": None, "label": "I2C", **jst},
        {"from": "battery", "to": "driver", "kind": "power",
         "volts": 12.0, "label": "driver feed", "cable": dict(full),
         **xt60},
        {"from": "driver", "to": "motors", "kind": "power",
         "volts": 12.0, "label": "motor run",
         "cable": dict(full, length_mm=150), **xt60},
    ])


def test_clean_harness_is_fully_checked_with_zero_findings():
    rep = check_spec_data(_clean_spec())
    assert rep.findings == []
    assert all(ev.state == "CHECKED" for ev in rep.evaluations), \
        [(ev.check, ev.subject, ev.state, ev.missing)
         for ev in rep.evaluations if ev.state != "CHECKED"]
    s = rep.summary()
    assert s["checked_clean"] == s["evaluations"]
    assert "PASS" not in rep.headline()  # counts, never a blanket pass


def test_ampacity_boundary_at_the_rating_is_clean_above_is_error():
    spec = _clean_spec()
    # 16 AWG is rated 3.7 A in the conservative column; push the motor
    # run to exactly the rating, then past it.
    at = json.loads(json.dumps(spec))
    at["wiring"]["connections"][-1]["current_a"] = AMPACITY_A[16]
    rep = check_spec_data(at)
    ev = _eval(rep, "ampacity", "driver -> motors")
    assert ev.state == "CHECKED" and not ev.findings
    over = json.loads(json.dumps(spec))
    over["wiring"]["connections"][-1]["current_a"] = AMPACITY_A[16] + 0.1
    rep = check_spec_data(over)
    ev = _eval(rep, "ampacity", "driver -> motors")
    assert any(f.severity == "ERROR" for f in ev.findings)


def test_level_shifted_link_does_not_warn():
    spec = _clean_spec()
    spec["wiring"]["nodes"][3]["logic_v"] = 5.0     # sensor now 5 V
    spec["wiring"]["connections"][3]["level_shifted"] = True
    rep = check_spec_data(spec)
    ev = _eval(rep, "logic_levels", "computer -> sensor")
    assert ev.state == "CHECKED" and not ev.findings


def test_no_wiring_is_refused_plainly():
    try:
        check_spec_data(dict(BASE, name="unwired"))
    except HarnessError as exc:
        assert "no wiring block" in str(exc)
    else:
        raise AssertionError("unwired spec accepted")


# ----------------------------------------------------------------------
# the recorded fleet: reports re-derive, and the truth is a gap list
# ----------------------------------------------------------------------

def _wired_entries():
    out = []
    for r in dex.robots:
        if not r.spec_file:
            continue
        raw = json.loads((REPO / r.spec_file).read_text())
        if raw.get("wiring"):
            out.append((r, raw))
    return out


def test_recorded_reports_rederive_from_the_specs():
    wired = _wired_entries()
    assert len(wired) == 9, [r.name for r, _ in wired]
    for r, raw in wired:
        path = REPO / "catalog" / "harness-reports" / \
            f"{slugify(r.name)}.json"
        recorded = json.loads(path.read_text())
        fresh = check_spec_data(raw)
        fresh.date = recorded["date"]
        assert fresh.to_dict() == recorded, r.name


def test_fleet_truth_is_mostly_not_checked_and_names_the_gaps():
    # The fleet's recorded harness data is still mostly gaps — that is
    # the truth the reports exist to state. The 2026-10-27 backfill
    # recorded what primary sources actually publish (logic levels,
    # rated rail outputs, both-ends connectors, one leaf load current),
    # so a minority of evaluations now genuinely run. The invariants
    # below are the posture that must survive any future backfill.
    all_findings = []
    for r, raw in _wired_entries():
        rep = check_spec_data(raw)
        s = rep.summary()
        # not-checked still dominates every wired robot's report
        assert s["states"]["NOT_CHECKED"] > s["evaluations"] // 2, r.name
        # every robot still has named gaps
        assert s["missing_inputs"], r.name
        # no robot is fully checked — nothing here is a blanket pass
        assert s["checked_clean"] < s["evaluations"], r.name
        for ev in rep.evaluations:
            # an evaluation that could not fully run names its gaps
            if ev.state in (NOT_CHECKED, PARTIAL):
                assert ev.missing, (r.name, ev.check, ev.subject)
            # findings ride only on evaluations that actually ran
            if ev.findings:
                assert ev.state in (CHECKED, PARTIAL), \
                    (r.name, ev.check, ev.subject)
        all_findings += [(r.name, f) for f in rep.findings]
    # The fleet's one genuine finding: Andino's Pi (3.3 V GPIO logic,
    # Raspberry Pi documentation) talks serial to its Nano (5 V TTL,
    # Arduino datasheet) with no level shifter recorded — datasheet
    # data on both ends, flagged exactly as the check intends.
    assert len(all_findings) == 1, all_findings
    name, f = all_findings[0]
    assert name == "Andino" and f.check == "harness.logic_levels"
    assert f.severity == WARN and f.subject == "controller -> nano"


# ----------------------------------------------------------------------
# CLI + pages
# ----------------------------------------------------------------------

def test_cli_harness_command(tmp_path):
    target = tmp_path / "gauntlet.json"
    target.write_text(json.dumps(GAUNTLET))
    out = io.StringIO()
    with redirect_stdout(out):
        rc = main(["harness", str(target), "--date", "2026-10-26"])
    assert rc == 1                      # the gauntlet has ERRORs
    text = out.getvalue()
    assert "not checked" in text and "harness.ampacity" in text
    clean = tmp_path / "clean.json"
    clean.write_text(json.dumps(_clean_spec()))
    out = io.StringIO()
    with redirect_stdout(out):
        rc = main(["harness", str(clean)])
    assert rc == 0
    err = io.StringIO()
    with redirect_stderr(err):
        rc = main(["harness",
                   str(REPO / "examples/indoor-delivery-rover.json")])
    assert rc == 2 and "no wiring block" in err.getvalue()


def test_pages_carry_harness_as_its_own_evidence_kind():
    andino = render_robot_page(dex.find("Andino"))
    assert 'id="harness"' in andino
    assert "Harness checks" in andino
    assert "harness-badge" in andino
    assert "NOT_CHECKED" not in andino  # page wording, not enum shouting
    assert "Not checked" in andino or "not checked" in andino
    assert "Missing data" in andino
    go2 = render_robot_page(dex.find("Unitree Go2"))
    assert 'id="harness"' not in go2   # no wiring documented, no section
    evidence = render_evidence(dex)
    assert 'id="harness-checks"' in evidence
    for r, _raw in _wired_entries():
        assert r.name in evidence
    assert "never a blanket pass" in evidence


def test_report_text_never_claims_a_blanket_pass():
    text = format_harness_report(check_spec_data(GAUNTLET))
    assert "Counts:" in text
    assert "harness: PASS" not in text and "Harness: PASS" not in text
