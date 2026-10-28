"""CLI error handling: bad files are clean errors (exit 2), never
tracebacks. Each test here raised an unhandled exception before the
hardening sweep — the spec read, the list read, the repair report
read, and the specimen URDF read now report in the CLI's usual
'<area> error: ...' style instead."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge.cli import main

EXAMPLE = Path(__file__).parent.parent / "examples" / "turtlebot3-burger.json"

SPEC_COMMANDS = [
    ["validate"],
    ["urdf", "--out", "o.xml"],  # placeholder, spec inserted below
    ["cad"],
    ["stability"],
    ["harness"],
    ["run-gate"],
]


def _argv_with_spec(template, spec):
    argv = list(template)
    if argv[0] == "urdf":
        return ["urdf", str(spec), "--out", "o.xml"]
    return [argv[0], str(spec)]


def test_missing_spec_file_is_a_clean_error_for_all_spec_commands(
        tmp_path, capsys):
    missing = tmp_path / "nope.json"
    for template in SPEC_COMMANDS:
        rc = main(_argv_with_spec(template, missing))
        err = capsys.readouterr().err
        assert rc == 2, template
        assert "spec error: cannot read spec file" in err, template


def test_spec_path_that_is_a_directory_is_a_clean_error(tmp_path, capsys):
    rc = main(["validate", str(tmp_path)])
    err = capsys.readouterr().err
    assert rc == 2
    assert "spec error: cannot read spec file" in err


def test_import_list_missing_file_is_a_clean_error(tmp_path, capsys):
    rc = main(["import-list", str(tmp_path / "nope.txt")])
    err = capsys.readouterr().err
    assert rc == 2
    assert "import error: cannot read list file" in err


def test_import_list_directory_is_a_clean_error(tmp_path, capsys):
    rc = main(["import-list", str(tmp_path)])
    err = capsys.readouterr().err
    assert rc == 2
    assert "import error: cannot read list file" in err


def test_repair_missing_report_is_a_clean_error(tmp_path, capsys):
    rc = main(["repair", str(EXAMPLE), "--report",
               str(tmp_path / "nope.json"), "--no-narrate"])
    err = capsys.readouterr().err
    assert rc == 2
    assert "repair error: cannot read report file" in err


def test_repair_malformed_report_is_a_clean_error(tmp_path, capsys):
    bad = tmp_path / "report.json"
    bad.write_text("{not json")
    rc = main(["repair", str(EXAMPLE), "--report", str(bad),
               "--no-narrate"])
    err = capsys.readouterr().err
    assert rc == 2
    assert "repair error: report is not valid JSON" in err


def test_repair_missing_spec_is_a_clean_error(tmp_path, capsys):
    report = tmp_path / "report.json"
    report.write_text(json.dumps({"verdict": "FAIL"}))
    rc = main(["repair", str(tmp_path / "nope.json"), "--report",
               str(report), "--no-narrate"])
    err = capsys.readouterr().err
    assert rc == 2
    assert "spec error: cannot read spec file" in err


def _specimen_argv(urdf):
    return ["specimen", str(urdf), "--repo", "a/b", "--commit", "abc",
            "--package", "pkg", "--robot", "R", "--dex", "#001",
            "--license", "MIT", "--retrieved", "2026-01-01"]


def test_specimen_missing_urdf_is_a_clean_error(tmp_path, capsys):
    rc = main(_specimen_argv(tmp_path / "nope.urdf"))
    err = capsys.readouterr().err
    assert rc == 2
    assert "specimen error: cannot read URDF file" in err


def test_specimen_malformed_urdf_is_a_clean_error(tmp_path, capsys):
    bad = tmp_path / "bad.urdf"
    bad.write_text("{not xml")
    rc = main(_specimen_argv(bad))
    err = capsys.readouterr().err
    assert rc == 2
    assert "specimen error:" in err
    assert "not well-formed XML" in err


def test_urdf_out_path_blocked_by_a_file_is_a_clean_error(
        tmp_path, capsys):
    blocker = tmp_path / "blocker"
    blocker.write_text("x")
    rc = main(["urdf", str(EXAMPLE), "--out",
               str(blocker / "o.xml")])
    err = capsys.readouterr().err
    assert rc == 2
    assert "urdf error: cannot write" in err
