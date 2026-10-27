"""Static stability check tests.

Three things are under test, in order of importance:

1. The evidence stays separate. A static stability check is a
   computation, not a gate run: the catalog loader must refuse every
   shape of masquerade (a check typed as a gate run, a stability grade
   wearing a gate status, a check recorded where it does not apply),
   and the recorded entries must keep NOT_GATED beside their checks.
2. The geometry is right: polygon margins on known rectangles, the
   three grades reachable by construction, and the grade boundaries
   where the thresholds say they are.
3. The assumptions are printed, never buried — the CoM-height
   assumption appears in the report text, the JSON, and the page.
"""
import io
import json
import math
import shutil
import subprocess
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from robotforge.catalog import CatalogError, Robodex, RobotEntry
from robotforge.cli import main
from robotforge.schema import RobotSpec
from robotforge.site import render_evidence, render_robot_page
from robotforge.stability import (COM_HEIGHT_FRACTION, MARGINAL_AT_DEG,
                                  STABLE_AT_DEG, StabilityError,
                                  _edge_margins, check_spec, convex_hull,
                                  format_stability_report, grade_for)

REPO = Path(__file__).resolve().parent.parent
dex = Robodex.load()

LEGGED = {"Unitree Go2": "unitree-go2", "Mini Pupper": "mini-pupper",
          "Unitree G1": "unitree-g1", "ROBOTIS OP3": "robotis-op3"}


def assert_raises(exc_type, fn):
    try:
        fn()
    except exc_type:
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def _spec(drivetrain="quadruped", legs=4, length=0.7, width=0.34,
          height=0.4, mass=10.0):
    return RobotSpec.from_dict({
        "name": "fixture", "description": "test fixture",
        "drivetrain": drivetrain,
        "length_m": length, "width_m": width, "height_m": height,
        "mass_kg": mass,
        "motor": {"kind": "bldc", "count": 12, "voltage_v": 24.0},
        "battery": {"chemistry": "liion", "voltage_v": 24.0,
                    "capacity_mah": 5000},
        "legs": {"count": legs, "segments": 2},
    })


# ----------------------------------------------------------------------
# plane geometry
# ----------------------------------------------------------------------

def test_hull_of_a_rectangle_and_its_margins():
    corners = [(0.3, 0.2), (-0.3, 0.2), (0.3, -0.2), (-0.3, -0.2),
               (0.0, 0.0)]  # interior point must not survive the hull
    poly = convex_hull(corners)
    assert len(poly) == 4
    margins = sorted(d for d, _ in _edge_margins((0.0, 0.0), poly))
    assert all(abs(a - b) < 1e-9 for a, b in
               zip(margins, [0.2, 0.2, 0.3, 0.3]))  # centre: half extents
    off = sorted(d for d, _ in _edge_margins((0.1, 0.05), poly))
    assert abs(off[0] - 0.15) < 1e-9        # nearest edge moved closer
    out = [d for d, _ in _edge_margins((0.5, 0.0), poly)]
    assert min(out) < 0                     # outside reads negative


def test_grade_boundaries_are_where_the_thresholds_say():
    assert grade_for(0.10, STABLE_AT_DEG) == "STABLE"
    assert grade_for(0.10, STABLE_AT_DEG - 0.001) == "MARGINAL"
    assert grade_for(0.10, MARGINAL_AT_DEG) == "MARGINAL"
    assert grade_for(0.10, MARGINAL_AT_DEG - 0.001) == "UNSTABLE"
    assert grade_for(-0.001, 45.0) == "UNSTABLE"  # outside at any angle
    assert grade_for(0.0, 0.0) == "UNSTABLE"


# ----------------------------------------------------------------------
# fixture robots: the three grades, reached by construction
# ----------------------------------------------------------------------

def test_fixture_quadruped_is_stable():
    rep = check_spec(_spec())
    expected = math.degrees(math.atan2(0.44 * 0.34,
                                       COM_HEIGHT_FRACTION * 0.4))
    assert rep.grade == "STABLE"
    assert abs(rep.tip_angle_deg - expected) < 1e-9
    assert rep.projection_inside


def test_fixture_narrow_tall_quadruped_is_marginal():
    rep = check_spec(_spec(length=0.6, width=0.20, height=0.55))
    expected = math.degrees(math.atan2(0.44 * 0.20,
                                       COM_HEIGHT_FRACTION * 0.55))
    assert MARGINAL_AT_DEG <= expected < STABLE_AT_DEG
    assert rep.grade == "MARGINAL"
    assert abs(rep.tip_angle_deg - expected) < 1e-9


def test_fixture_humanoid_is_unstable_by_geometry_alone():
    rep = check_spec(_spec(drivetrain="humanoid", legs=2, length=0.24,
                           width=0.40, height=1.8))
    assert rep.grade == "UNSTABLE"
    assert rep.tip_angle_deg < MARGINAL_AT_DEG
    assert rep.weakest_direction == "backward"  # the heel margin binds
    assert "publishes no foot dimensions" in rep.support_model


def test_grade_boundary_through_the_whole_check():
    # Solve the stance width whose tip angle is exactly the STABLE line.
    height = 0.5
    margin = math.tan(math.radians(STABLE_AT_DEG)) \
        * COM_HEIGHT_FRACTION * height
    width = margin / 0.44
    rep = check_spec(_spec(width=width, height=height))
    assert abs(rep.tip_angle_deg - STABLE_AT_DEG) < 1e-6
    assert rep.grade == "STABLE"
    narrower = check_spec(_spec(width=width * 0.99, height=height))
    assert narrower.grade == "MARGINAL"
    margin10 = math.tan(math.radians(MARGINAL_AT_DEG)) \
        * COM_HEIGHT_FRACTION * height
    rep10 = check_spec(_spec(width=margin10 / 0.44, height=height))
    assert abs(rep10.tip_angle_deg - MARGINAL_AT_DEG) < 1e-6
    assert rep10.grade == "MARGINAL"
    assert check_spec(_spec(width=margin10 / 0.44 * 0.99,
                             height=height)).grade == "UNSTABLE"


def test_assumptions_are_printed_never_buried():
    rep = check_spec(_spec())
    text = format_stability_report(rep)
    assert f"ASSUMED at {COM_HEIGHT_FRACTION:.0%}" in text
    assert "not a gate verdict" in text
    doc = rep.to_dict()
    assert any("ASSUMED" in a and "55%" in a for a in doc["assumptions"])
    assert "mass" in doc["inputs"]["mass_note"].lower()
    assert doc["thresholds"]["stable_at_deg"] == STABLE_AT_DEG
    assert doc["results"]["grade"] == rep.grade


def test_non_legged_specs_are_refused_plainly():
    andino = RobotSpec.from_json(
        (REPO / "examples/andino.json").read_text())
    assert_raises(StabilityError, lambda: check_spec(andino))
    x500 = RobotSpec.from_json(
        (REPO / "examples/px4-x500.json").read_text())
    assert_raises(StabilityError, lambda: check_spec(x500))
    assert_raises(StabilityError,
                  lambda: check_spec(_spec(legs=3, drivetrain="humanoid")))


# ----------------------------------------------------------------------
# the recorded entries: reports, catalog records and grades agree
# ----------------------------------------------------------------------

def test_recorded_reports_match_the_catalog_records():
    for name, slug in LEGGED.items():
        entry = dex.find(name)
        check = entry.static_check()
        assert check is not None, name
        assert entry.gate_status.status == "NOT_GATED", name
        report = json.loads((REPO / check.report).read_text())
        assert report["check"] == "static_stability"
        assert report["date"] == check.date
        res = report["results"]
        assert res["grade"] == check.grade
        assert res["tip_angle_deg"] == check.tip_angle_deg
        assert res["weakest_margin_mm"] == check.weakest_margin_mm
        # and the recorded numbers are what the engine computes today
        spec = RobotSpec.from_json(
            (REPO / entry.spec_file).read_text())
        fresh = check_spec(spec)
        assert fresh.grade == check.grade
        assert abs(fresh.tip_angle_deg - check.tip_angle_deg) < 0.001


def test_recorded_grades_are_the_honest_ones():
    grades = {name: dex.find(name).static_check().grade for name in LEGGED}
    assert grades == {"Unitree Go2": "STABLE", "Mini Pupper": "STABLE",
                      "Unitree G1": "UNSTABLE", "ROBOTIS OP3": "UNSTABLE"}


# ----------------------------------------------------------------------
# the masquerade guards
# ----------------------------------------------------------------------

def _entry_dict(name):
    return json.loads(json.dumps(dex.find(name).to_dict()))


def test_check_cannot_masquerade_as_a_gate_run():
    d = _entry_dict("Unitree Go2")
    d["checks"] = [{"type": "gate_run", "date": "2026-10-26",
                    "report": "catalog/stability-reports/unitree-go2.json",
                    "grade": "STABLE", "tip_angle_deg": 31.8,
                    "weakest_margin_mm": 136.4,
                    "weakest_direction": "to the right"}]
    assert_raises(CatalogError, lambda: RobotEntry.from_dict(d))


def test_stability_grade_cannot_wear_a_gate_status():
    d = _entry_dict("Unitree Go2")
    d["gate_status"] = {"status": "STABLE", "runs": [], "note": ""}
    assert_raises(CatalogError, lambda: RobotEntry.from_dict(d))
    # and a PASS backed by nothing but the check is still a PASS
    # without runs — refused by the gate loader as always
    d["gate_status"] = {"status": "PASS", "runs": [], "note": ""}
    assert_raises(CatalogError, lambda: RobotEntry.from_dict(d))


def test_check_on_a_non_legged_robot_is_refused():
    d = _entry_dict("Andino")
    d["checks"] = [{"type": "static_stability", "date": "2026-10-26",
                    "report": "catalog/stability-reports/unitree-go2.json",
                    "grade": "STABLE", "tip_angle_deg": 31.8,
                    "weakest_margin_mm": 136.4,
                    "weakest_direction": "to the right"}]
    assert_raises(CatalogError, lambda: RobotEntry.from_dict(d))


def test_check_needs_its_report_and_a_real_grade():
    d = _entry_dict("Unitree Go2")
    d["checks"] = [dict(d["checks"][0], report="")]
    assert_raises(CatalogError, lambda: RobotEntry.from_dict(d))
    d = _entry_dict("Unitree Go2")
    d["checks"] = [dict(d["checks"][0], grade="PASS")]
    assert_raises(CatalogError, lambda: RobotEntry.from_dict(d))


def test_checks_round_trip_through_the_loader():
    for name in LEGGED:
        entry = dex.find(name)
        again = RobotEntry.from_dict(entry.to_dict())
        assert again.checks == entry.checks
        assert again.gate_status.status == "NOT_GATED"


# ----------------------------------------------------------------------
# CLI + pages + Guide
# ----------------------------------------------------------------------

def test_cli_stability_command():
    out = io.StringIO()
    with redirect_stdout(out):
        rc = main(["stability", str(REPO / "examples/unitree-go2.json"),
                   "--date", "2026-10-26"])
    assert rc == 0
    text = out.getvalue()
    assert "STABLE" in text and "55%" in text
    err = io.StringIO()
    with redirect_stderr(err):
        rc = main(["stability", str(REPO / "examples/andino.json")])
    assert rc == 2 and "legged" in err.getvalue()


def test_pages_keep_the_evidence_kinds_apart():
    go2 = render_robot_page(dex.find("Unitree Go2"))
    assert 'id="stability"' in go2
    assert "Static check: STABLE" in go2
    assert "not a simulation run and not a gate verdict" in go2
    assert "Not gated" in go2  # the gate badge stays what it was
    andino = render_robot_page(dex.find("Andino"))
    assert "static-badge" not in andino
    evidence = render_evidence(dex)
    assert "Static stability checks" in evidence
    for name in LEGGED:
        assert name in evidence
    assert "never changes a gate verdict" in evidence


NODE_SCRIPT = r"""
const fs = require('fs');
const FG = require(process.argv[2]);
const root = process.argv[3];
const load = p => JSON.parse(fs.readFileSync(root + '/' + p, 'utf8'));
const robots = load('catalog/robots.json');
const parts = load('catalog/parts.json');
const engine = FG.createEngine({
  robots: robots.robots, parts: parts.parts,
  templates: parts.templates.length,
  reports: load('catalog/gate-reports.json'),
  intents: load('assets/js/chat-intents.json'),
  root: ''
});
const out = {};
for (const q of JSON.parse(fs.readFileSync(process.argv[4], 'utf8'))) {
  out[q] = engine.answer(q).html;
}
console.log(JSON.stringify(out));
"""


def test_guide_answers_stability_from_the_recorded_data():
    node = shutil.which("node")
    if not node:
        return  # no node on this machine; data tests above still hold
    questions = ["Is the Go2 stable?", "Is the Unitree G1 stable?",
                 "Tell me about the Mini Pupper"]
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "ask.js"
        script.write_text(NODE_SCRIPT)
        qfile = Path(tmp) / "questions.json"
        qfile.write_text(json.dumps(questions))
        r = subprocess.run(
            [node, str(script), str(REPO / "assets/js/chat-engine.js"),
             str(REPO), str(qfile)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        answers = json.loads(r.stdout)
    go2 = answers["Is the Go2 stable?"]
    assert "Static stability check: STABLE" in go2
    assert "31.8" in go2 and "not a gate run" in go2
    assert "Not gated" in go2
    g1 = answers["Is the Unitree G1 stable?"]
    assert "Static stability check: UNSTABLE" in g1 and "2.7" in g1
    pupper = answers["Tell me about the Mini Pupper"]
    assert "Static stability check: STABLE" in pupper
