"""RobotForge command line: describe -> validate -> urdf (-> twin -> gate)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .describe import describe_live, describe_mock
from .gate import evaluate_drive, evaluate_run, evaluate_turn
from .schema import RobotSpec, SpecError
from .twin import TwinError, run_motion_check
from .urdf import generate_urdf
from .validate import has_errors, validate


def _print_findings(spec: RobotSpec) -> int:
    findings = validate(spec)
    for f in findings:
        print(f"[{f.severity}] {f.check}: {f.message}")
    return 1 if has_errors(findings) else 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="robotforge")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("describe", help="natural language -> spec JSON")
    d.add_argument("text")
    d.add_argument("--mock", action="store_true",
                   help="offline canned parse (no API key needed)")
    d.add_argument("--out", help="write spec JSON here (default: stdout)")

    v = sub.add_parser("validate", help="engineering checks on a spec file")
    v.add_argument("spec")

    u = sub.add_parser("urdf", help="generate URDF from a valid spec")
    u.add_argument("spec")
    u.add_argument("--out", required=True)

    g = sub.add_parser("run-gate", help="spawn the twin in headless Gazebo and "
                                       "run the motion acceptance gate")
    g.add_argument("spec")
    g.add_argument("--workdir", default="build/gate-run")
    g.add_argument("--drive-m", type=float, default=1.0)
    g.add_argument("--turn-deg", type=float, default=90.0)

    args = p.parse_args(argv)
    try:
        if args.cmd == "describe":
            spec = describe_mock(args.text) if args.mock else describe_live(args.text)
            text = json.dumps(spec.to_dict(), indent=2)
            if args.out:
                Path(args.out).write_text(text + "\n")
                print(f"spec written to {args.out}")
            else:
                print(text)
            return _print_findings(spec)
        spec = RobotSpec.from_json(Path(args.spec).read_text())
        if args.cmd == "validate":
            return _print_findings(spec)
        if args.cmd == "urdf":
            rc = _print_findings(spec)
            if rc:
                print("refusing to generate a twin from an invalid spec",
                      file=sys.stderr)
                return rc
            Path(args.out).parent.mkdir(parents=True, exist_ok=True)
            Path(args.out).write_text(generate_urdf(spec))
            print(f"URDF written to {args.out}")
            return 0
        if args.cmd == "run-gate":
            rc = _print_findings(spec)
            if rc:
                print("refusing to run the gate on an invalid spec",
                      file=sys.stderr)
                return rc
            res = run_motion_check(spec, Path(args.workdir),
                                   drive_m=args.drive_m, turn_deg=args.turn_deg)
            report = evaluate_run([
                evaluate_drive(res["drive"]["commanded_m"],
                               res["drive"]["measured_m"]),
                evaluate_turn(res["turn"]["commanded_deg"],
                              res["turn"]["measured_deg"]),
            ])
            for c in report.checks:
                print(f"[{c.verdict}] {c.name}: commanded {c.commanded}, "
                      f"measured {c.measured:.3f}, error {c.error} {c.unit}")
            print(f"GATE: {report.verdict}")
            return 0 if report.verdict != "FAIL" else 1
    except (SpecError, TwinError) as exc:
        print(f"spec error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
