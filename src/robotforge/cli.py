"""RobotForge command line: describe -> validate -> urdf (-> twin -> gate)."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

from .cad import (is_estimated, kit_slug, render_stls, write_kit)
from .catalog import (Catalog, CatalogError, Robodex, format_catalog_summary,
                      format_part, format_robot)
from .site import build_site
from .describe import describe_live, describe_mock
from .gate import (evaluate_drive, evaluate_odometry_distance,
                   evaluate_odometry_heading, evaluate_run, evaluate_turn)
from .listimport import import_list, render_text
from .lookup import (LookupError, format_pull, format_report, lookup_robot,
                     pull_candidate, report_to_dict)
from .photo import (draft_spec_from_document, draft_spec_from_photo,
                    locate_parts)
from .repair import apply_repairs, narrate, propose_repairs, render_proposal_md
from .specimen import build_specimen
from .stability import StabilityError, check_spec, format_stability_report
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


def _describe_document(args) -> int:
    """Document intake: transcribe a spec sheet / datasheet / blueprint.

    The opposite contract from photo mode: nothing here is estimated.
    Values are the document's printed values, carried over with their
    printed units alongside; a value the document does not print stays
    absent, so the draft may be partial on purpose.
    """
    draft = draft_spec_from_document(args.document)
    print("*** DOCUMENT DRAFT — values transcribed from the document; "
          "verify against the source ***")
    print(f"identity guess: {draft.identity_guess}")
    if draft.values:
        print("transcribed values (as printed):")
        for v in draft.values:
            print(f"  - {v.label}: {v.printed}  -> {v.field}")
    else:
        print("transcribed values: none reported by the document draft")
    for path in draft.dropped:
        print(f"  ! dropped {path}: the model put a number in the spec "
              "with no transcribed value behind it")
    text = json.dumps(draft.spec_data, indent=2)
    if args.out:
        Path(args.out).write_text(text + "\n")
        print(f"draft written to {args.out}")
    else:
        print(text)
    if draft.spec is not None:
        return _print_findings(draft.spec)
    print("note: the draft is PARTIAL — the document did not print "
          "everything a complete spec needs, and absent fields were "
          "left absent rather than filled in.")
    return 0


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
    d.add_argument("--document", metavar="IMAGE",
                   help="transcribe the spec from a photo/scan of a spec "
                        "sheet, datasheet or blueprint (printed values "
                        "only; never inferred from drawing scale)")
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

    ct = sub.add_parser("catalog", help="parts catalog + Robodex "
                                        "(numbered robot index)")
    ct.add_argument("section", nargs="?", choices=["robot", "part"],
                    help="robot <number-or-name> | part <name-or-id>; "
                         "no section prints the summary")
    ct.add_argument("query", nargs="?",
                    help="number, name or fragment to look up")
    ct.add_argument("--json", action="store_true",
                    help="machine-readable output instead of text")

    v = sub.add_parser("validate", help="engineering checks on a spec file")
    v.add_argument("spec")

    sb = sub.add_parser("stability", help="static stability check for a "
                                          "legged robot spec (support-"
                                          "polygon computation from the "
                                          "spec — not a gate run)")
    sb.add_argument("spec")
    sb.add_argument("--json", action="store_true",
                    help="print the check report as JSON")
    sb.add_argument("--out", help="also write the JSON report here")
    sb.add_argument("--date", help="date to stamp into the report "
                                   "(YYYY-MM-DD; default: today)")

    u = sub.add_parser("urdf", help="generate URDF from a valid spec")
    u.add_argument("spec")
    u.add_argument("--out", required=True)

    cd = sub.add_parser("cad", help="generate a take-apart OpenSCAD parts "
                                    "kit from a valid spec")
    cd.add_argument("spec")
    cd.add_argument("--out-dir", default=None,
                    help="kit folder (default: build/cad/<robot-name>)")
    cd.add_argument("--stl", action="store_true",
                    help="also render per-part + assembly STLs if an "
                         "openscad binary is on PATH (skipped otherwise)")

    st = sub.add_parser("site", help="regenerate the web app pages (app/), "
                                     "legacy redirects and the landing "
                                     "page's robot row from catalog data")
    st.add_argument("--root", default=".",
                    help="repository root to write into (default: .)")

    g = sub.add_parser("run-gate", help="spawn the twin in headless Gazebo and "
                                       "run the motion acceptance gate")
    g.add_argument("spec")
    g.add_argument("--workdir", default="build/gate-run")
    g.add_argument("--drive-m", type=float, default=1.0)
    g.add_argument("--turn-deg", type=float, default=90.0)
    g.add_argument("--inject-wheel-scale", type=float, default=1.0,
                   help="fault injection: scale ONLY the physical wheel "
                        "geometry (odometry keeps the spec radius), to "
                        "prove the gate catches a lying robot")
    g.add_argument("--repair", action="store_true",
                   help="fix-my-spec loop: on a FAIL, compute measured "
                        "repairs from the gate's suspects, write a repair "
                        "proposal + repaired spec into the workdir, and "
                        "re-run the gate on the repaired spec (one pass)")

    rp = sub.add_parser("repair", help="compute a repaired spec from a "
                                       "failing gate report")
    rp.add_argument("spec")
    rp.add_argument("--report", required=True,
                    help="path to a gate-report.json from a failing run")
    rp.add_argument("--out", help="write the repaired spec JSON here "
                                  "(default: beside the report)")
    rp.add_argument("--no-narrate", action="store_true",
                    help="skip the Muse Spark narration of the proposal")

    li = sub.add_parser("import-list", help="paste a shopping/wish list -> "
                        "assembled robot draft, wiring, missing parts")
    li.add_argument("listfile", help="text file with the pasted list")
    li.add_argument("--out", help="write the JSON report here")

    sp = sub.add_parser("specimen", help="official URDF -> specimen "
                        "assembly tree (real parts, poses, tiers)")
    sp.add_argument("urdf", help="path to the robot's official URDF")
    sp.add_argument("--repo", required=True,
                    help="owner/name of the source repo on GitHub")
    sp.add_argument("--commit", required=True,
                    help="source commit SHA the meshes are pinned to")
    sp.add_argument("--package", required=True,
                    help="ROS package the URDF's package:// URLs use; "
                         "also its directory inside the repo")
    sp.add_argument("--robot", required=True, help="display name")
    sp.add_argument("--dex", required=True, help="Robodex id, e.g. #002")
    sp.add_argument("--license", required=True,
                    help="license of the source repo, e.g. Apache-2.0")
    sp.add_argument("--retrieved", required=True,
                    help="retrieval date, YYYY-MM-DD")
    sp.add_argument("--out", help="write the specimen JSON here")

    args = p.parse_args(argv)
    try:
        if args.cmd == "describe":
            if args.document:
                return _describe_document(args)
            if args.photo:
                spec = _describe_photo(args)
            elif args.text is not None:
                spec = describe_mock(args.text) if args.mock \
                    else describe_live(args.text)
            else:
                p.error("describe needs a TEXT argument, --photo IMAGE "
                        "or --document IMAGE")
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
        if args.cmd == "site":
            try:
                written = build_site(Path(args.root))
            except CatalogError as exc:
                print(f"catalog error: {exc}", file=sys.stderr)
                return 2
            for w in written:
                print(f"wrote {w}")
            return 0
        if args.cmd == "catalog":
            try:
                cat = Catalog.load()
                dex = Robodex.load()
                if args.section == "robot":
                    if not args.query:
                        p.error("catalog robot needs a number or name")
                    r = dex.find(args.query)
                    print(json.dumps(r.to_dict(), indent=2) if args.json
                          else format_robot(r))
                elif args.section == "part":
                    if not args.query:
                        p.error("catalog part needs a name or id")
                    part = cat.find_part(args.query)
                    print(json.dumps(part.to_dict(), indent=2) if args.json
                          else format_part(part))
                elif args.json:
                    print(json.dumps(
                        {"robots": [r.to_dict() for r in dex.robots],
                         "parts_count": len(cat.parts),
                         "templates": sorted(cat.templates)}, indent=2))
                else:
                    print(format_catalog_summary(cat, dex))
                return 0
            except (CatalogError, OSError) as exc:
                print(f"catalog error: {exc}", file=sys.stderr)
                return 2
        if args.cmd == "import-list":
            report = import_list(Path(args.listfile).read_text())
            print(render_text(report), end="")
            if args.out:
                Path(args.out).write_text(
                    json.dumps(report, indent=2) + "\n")
                print(f"report written to {args.out}")
            return 0
        if args.cmd == "specimen":
            doc = build_specimen(
                args.urdf, repo=args.repo, commit=args.commit,
                package=args.package, robot_label=args.robot,
                dex_id=args.dex, license_name=args.license,
                retrieved=args.retrieved)
            text = json.dumps(doc, indent=2)
            if args.out:
                Path(args.out).write_text(text + "\n")
                print(f"specimen written to {args.out}")
            else:
                print(text)
            return 0
        spec = RobotSpec.from_json(Path(args.spec).read_text())
        if args.cmd == "stability":
            try:
                rep = check_spec(spec)
            except StabilityError as exc:
                print(f"stability error: {exc}", file=sys.stderr)
                return 2
            rep.date = args.date or date.today().isoformat()
            doc = rep.to_dict()
            if args.out:
                out = Path(args.out)
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps(doc, indent=2) + "\n")
                print(f"report written to {out}")
            if args.json:
                print(json.dumps(doc, indent=2))
            else:
                print(format_stability_report(rep))
            return 0
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
        if args.cmd == "cad":
            rc = _print_findings(spec)
            if rc:
                print("refusing to generate CAD from an invalid spec",
                      file=sys.stderr)
                return rc
            out_dir = Path(args.out_dir) if args.out_dir else \
                Path("build/cad") / kit_slug(spec.name)
            infos = write_kit(spec, out_dir)
            if is_estimated(spec):
                print("*** ESTIMATED kit — drafted from a photo; every "
                      "dimension is an estimate, not a measurement ***")
            print(f"CAD kit for {spec.name} written to {out_dir}:")
            for info in infos:
                print(f"  {info.filename} — {info.name} x{info.qty} "
                      f"({info.dims})")
            print(f"  assembly.scad — all parts positioned "
                  f"({len(infos)} part files)")
            print("  parts_index.md — parts list, print notes, assembly help")
            if args.stl:
                try:
                    rendered = render_stls(out_dir)
                except (subprocess.CalledProcessError, OSError) as exc:
                    print(f"STL render failed: {exc}", file=sys.stderr)
                    return 2
                if rendered is None:
                    print("STL rendering skipped: no openscad binary on "
                          "PATH (the .scad kit is the deliverable)")
                else:
                    for stl in rendered:
                        print(f"  rendered {stl} ({stl.stat().st_size} bytes)")
            return 0
        if args.cmd == "repair":
            report_doc = json.loads(Path(args.report).read_text())
            proposal = propose_repairs(spec, report_doc)
            if not args.no_narrate:
                narrate(proposal)
            repaired = apply_repairs(spec, proposal)
            out = Path(args.out) if args.out else \
                Path(args.report).parent / "repaired-spec.json"
            out.write_text(json.dumps(repaired.to_dict(), indent=2) + "\n")
            md = render_proposal_md(proposal)
            (Path(args.report).parent / "repair-proposal.md").write_text(md)
            print(md, end="")
            print(f"repaired spec written to {out}")
            return 0 if proposal.actionable else 1
        if args.cmd == "run-gate":
            rc = _print_findings(spec)
            if rc:
                print("refusing to run the gate on an invalid spec",
                      file=sys.stderr)
                return rc
            res = run_motion_check(spec, Path(args.workdir),
                                   drive_m=args.drive_m, turn_deg=args.turn_deg,
                                   wheel_radius_scale=args.inject_wheel_scale)
            if res["drive"]["truth_m"] <= 0 and res["turn"]["truth_deg"] <= 0:
                raise TwinError(
                    "ground-truth stream captured no motion — the run is "
                    "invalid, refusing to judge odometry against nothing")
            # Primary acceptance is against ground truth (what actually
            # happened); odometry checks judge what the robot believed.
            report = evaluate_run([
                evaluate_drive(res["drive"]["commanded_m"],
                               res["drive"]["truth_m"]),
                evaluate_turn(res["turn"]["commanded_deg"],
                              res["turn"]["truth_deg"]),
                evaluate_odometry_distance(res["drive"]["truth_m"],
                                           res["drive"]["measured_m"]),
                evaluate_odometry_heading(
                    res["turn"]["truth_deg"],
                    abs(res["turn"]["measured_deg"])),
            ])
            for c in report.checks:
                print(f"[{c.verdict}] {c.name}: reference {c.commanded}, "
                      f"measured {c.measured:.3f}, error {c.error} {c.unit}")
            for s_ in report.suspects:
                print(f"SUSPECT {s_['field']}: {s_['reason']}")
            print(f"GATE: {report.verdict}")
            report_path = Path(args.workdir) / "gate-report.json"
            report_doc = {"spec": spec.name,
                          "measurements": res,
                          **report.to_dict()}
            report_path.write_text(json.dumps(report_doc, indent=2) + "\n")
            print(f"report written to {report_path}")
            if args.repair and report.verdict == "FAIL":
                proposal = narrate(propose_repairs(spec, report_doc))
                md = render_proposal_md(proposal)
                (Path(args.workdir) / "repair-proposal.md").write_text(md)
                print(md, end="")
                if not proposal.actionable:
                    print("repair: no measured repair available — "
                          "stopping with the FAIL on record")
                    return 1
                repaired = apply_repairs(spec, proposal)
                rep_spec_path = Path(args.workdir) / "repaired-spec.json"
                rep_spec_path.write_text(
                    json.dumps(repaired.to_dict(), indent=2) + "\n")
                print(f"repair: re-running the gate on {rep_spec_path}")
                res2 = run_motion_check(repaired,
                                        Path(args.workdir) / "repaired",
                                        drive_m=args.drive_m,
                                        turn_deg=args.turn_deg)
                report2 = evaluate_run([
                    evaluate_drive(res2["drive"]["commanded_m"],
                                   res2["drive"]["truth_m"]),
                    evaluate_turn(res2["turn"]["commanded_deg"],
                                  res2["turn"]["truth_deg"]),
                    evaluate_odometry_distance(res2["drive"]["truth_m"],
                                               res2["drive"]["measured_m"]),
                    evaluate_odometry_heading(
                        res2["turn"]["truth_deg"],
                        abs(res2["turn"]["measured_deg"])),
                ])
                for c in report2.checks:
                    print(f"[repaired {c.verdict}] {c.name}: reference "
                          f"{c.commanded}, measured {c.measured:.3f}, "
                          f"error {c.error} {c.unit}")
                print(f"GATE AFTER REPAIR: {report2.verdict}")
                doc2 = {"spec": repaired.name, "measurements": res2,
                        "repair_of": str(report_path), **report2.to_dict()}
                (Path(args.workdir) / "repaired"
                 / "gate-report.json").write_text(
                    json.dumps(doc2, indent=2) + "\n")
                return 0 if report2.verdict != "FAIL" else 1
            return 0 if report.verdict != "FAIL" else 1
    except (SpecError, TwinError) as exc:
        print(f"spec error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
