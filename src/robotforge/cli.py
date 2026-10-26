"""RobotForge command line: describe -> validate -> urdf (-> twin -> gate)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .describe import describe_live, describe_mock
from .gate import evaluate_drive, evaluate_run, evaluate_turn
from .lookup import (LookupError, format_pull, format_report, lookup_robot,
                     pull_candidate, report_to_dict)
from .photo import draft_spec_from_photo, locate_parts
from .schema import RobotSpec, SpecError
from .twin import TwinError, run_motion_check
from .urdf import generate_urdf
from .validate import has_errors, validate


def _sam_concept_for_kind(kind: str) -> str | None:
    """Map a free-text visible-part kind to a SAM concept phrase.

    The vision model names parts in its own words ("drive wheel", "caster
    wheel", "depth_camera"), so matching is by substring, not exact key —
    an exact-key map silently skipped the cross-check on real output.
    """
    k = kind.lower()
    if "wheel" in k:
        return "wheel"
    if "camera" in k or "kinect" in k or "depth" in k:
        return "camera"
    if "lidar" in k or "laser" in k:
        return "lidar"
    if "ultrasonic" in k:
        return "ultrasonic sensor"
    return None


def _describe_photo(args) -> RobotSpec:
    """Photo intake: print the draft's provenance, then return its spec.

    The banner is not decoration: a photo has no scale reference, so every
    dimension in the returned spec is an estimate and must be confirmed
    before anyone trusts it downstream (validate/urdf/gate accept the spec
    unchanged, which is exactly why the warning travels with it here).
    """
    draft = draft_spec_from_photo(args.photo)
    print("*** PHOTO DRAFT — all dimensions ESTIMATED from photo — "
          "confirm before trusting ***")
    print(f"identity guess: {draft.identity_guess}")
    if draft.visible_parts:
        print("visible parts (per Muse Spark):")
        for part in draft.visible_parts:
            line = f"  - {part.kind} x{part.count}"
            if part.position:
                line += f" ({part.position})"
            if part.notes:
                line += f" — {part.notes}"
            print(line)
    else:
        print("visible parts: none reported by the vision draft")
    _sam_cross_check(args.photo, draft)
    return draft.spec


def _sam_cross_check(photo: str, draft) -> None:
    """Compare Spark's visible counts against SAM 3.1 region counts.

    Disagreements are printed verbatim, never reconciled silently: the two
    models looking at the same photo and differing IS the information.
    """
    by_concept: dict[str, int] = {}
    for part in draft.visible_parts:
        concept = _sam_concept_for_kind(part.kind)
        if concept:
            by_concept[concept] = by_concept.get(concept, 0) + part.count
    if not by_concept:
        return
    try:
        located = locate_parts(photo, list(by_concept))
    except SpecError as exc:
        print(f"SAM cross-check unavailable: {exc}")
        return
    for concept, spark_count in by_concept.items():
        sam_count = len(located.get(concept, []))
        verdict = "agree" if sam_count == spark_count else \
            "DISAGREE — flagging, not hiding"
        print(f"cross-check {concept}: Spark saw {spark_count} / "
              f"SAM found {sam_count} regions — {verdict}")


def _print_findings(spec: RobotSpec) -> int:
    findings = validate(spec)
    for f in findings:
        print(f"[{f.severity}] {f.check}: {f.message}")
    return 1 if has_errors(findings) else 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="robotforge")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("describe", help="natural language or photo -> spec JSON")
    d.add_argument("text", nargs="?", default=None)
    d.add_argument("--photo", metavar="IMAGE",
                   help="draft the spec from a robot photo instead of text "
                        "(all dimensions ESTIMATED; SAM cross-check included)")
    d.add_argument("--mock", action="store_true",
                   help="offline canned parse (no API key needed)")
    d.add_argument("--out", help="write spec JSON here (default: stdout)")

    lk = sub.add_parser("lookup", help="robot name -> public GitHub repos "
                                       "and model assets (licenses shown)")
    lk.add_argument("identity",
                    help='free-text robot name, e.g. "TurtleBot 3 Waffle Pi"')
    lk.add_argument("--pull", action="store_true",
                    help="download the best twin candidate + its repo "
                         "LICENSE into --out-dir, with a manifest")
    lk.add_argument("--json", action="store_true",
                    help="machine-readable report instead of text")
    lk.add_argument("--out-dir", default="build/lookup",
                    help="pull destination root (default: build/lookup)")

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
            if args.photo:
                spec = _describe_photo(args)
            elif args.text is not None:
                spec = describe_mock(args.text) if args.mock \
                    else describe_live(args.text)
            else:
                p.error("describe needs a TEXT argument or --photo IMAGE")
            text = json.dumps(spec.to_dict(), indent=2)
            if args.out:
                Path(args.out).write_text(text + "\n")
                print(f"spec written to {args.out}")
            else:
                print(text)
            return _print_findings(spec)
        if args.cmd == "lookup":
            try:
                report = lookup_robot(args.identity)
                if args.json:
                    print(json.dumps(report_to_dict(report), indent=2))
                else:
                    print(format_report(report))
                if args.pull:
                    if report.best is None:
                        print("nothing to pull: no twin candidate found")
                        return 0
                    result = pull_candidate(report, Path(args.out_dir))
                    print(format_pull(result))
                return 0
            except LookupError as exc:
                print(f"lookup error: {exc}", file=sys.stderr)
                return 2
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
