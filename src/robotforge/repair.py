"""Fix-my-spec: turn a failing gate report into a corrected spec.

The gate names *suspect fields* by error signature; this module turns
the signature plus the run's own measurements into a concrete repair:

- Distance-only odometry error is a scale error. The ratio of ground
  truth to odometry-believed distance measures the true wheel diameter
  directly:  d_true = d_spec * (truth / believed).  That is a
  *correction* — the evidence says what the wheel actually is.
- Heading error is a track error. Odometry integrates heading as
  wheel travel / wheel separation, so the effective separation is
  s_eff = s_spec * (believed heading / true heading). That is a
  *calibration* — scrub and slip can masquerade as a separation error,
  and the proposal says so instead of pretending otherwise.

Nothing here invents a number: every correction carries its measured
basis, and signatures with no measured repair are reported as such.
The optional narration (Muse Spark via the same connector transport
describe uses) only explains the computed proposal in plain language;
when no transport is available it falls back to a templated text.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from .schema import RobotSpec

NARRATION_PROMPT = """You explain a robot spec repair to the robot's owner.

You are given a gate report summary and a list of computed corrections.
Each correction already has its measured basis — the numbers are fixed
and must be quoted exactly if you use them. Explain, in 2-4 plain
sentences, what the gate found, what the repair changes, and what to
expect from the re-run. Never invent a measurement, a cause the data
does not state, or a guarantee: a calibration is not a proven root
cause. No markdown, no preamble."""


@dataclass
class Correction:
    field: str
    old: float
    new: float
    unit: str
    kind: str  # "correction" | "calibration"
    basis: str

    def to_dict(self) -> dict:
        return {"field": self.field, "old": self.old, "new": self.new,
                "unit": self.unit, "kind": self.kind, "basis": self.basis}


@dataclass
class RepairProposal:
    spec_name: str
    verdict_before: str
    corrections: list[Correction] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    narration: str = ""
    narration_transport: str = ""

    @property
    def actionable(self) -> bool:
        return bool(self.corrections)

    def to_dict(self) -> dict:
        return {"spec": self.spec_name, "verdict_before": self.verdict_before,
                "corrections": [c.to_dict() for c in self.corrections],
                "notes": self.notes, "narration": self.narration,
                "narration_transport": self.narration_transport}


def propose_repairs(spec: RobotSpec, report_doc: dict) -> RepairProposal:
    """Compute measured repairs from a gate report (the dict the gate
    writes to gate-report.json). Returns the proposal; the corrected
    spec comes from apply_repairs()."""
    m = report_doc.get("measurements") or {}
    drive, turn = m.get("drive") or {}, m.get("turn") or {}
    suspects = {s.get("field", "") for s in report_doc.get("suspects") or []}
    prop = RepairProposal(spec_name=spec.name,
                          verdict_before=report_doc.get("verdict", "?"))

    if any("wheel.diameter_m" in f for f in suspects):
        truth, believed = drive.get("truth_m"), drive.get("measured_m")
        if truth and believed and truth > 0 and believed > 0:
            ratio = truth / believed
            d_old = spec.wheel.diameter_m
            prop.corrections.append(Correction(
                field="wheel.diameter_m", old=d_old,
                new=round(d_old * ratio, 6), unit="m", kind="correction",
                basis=(f"odometry integrated {believed:.3f} m over a true "
                       f"{truth:.3f} m (scale {ratio:.4f}); the wheels "
                       f"behave as {d_old * ratio * 1000:.1f} mm, not the "
                       f"spec's {d_old * 1000:.1f} mm")))
        else:
            prop.notes.append("wheel.diameter_m suspected but the run "
                              "lacks the measurements to size a repair")

    if any("separation" in f for f in suspects):
        truth_h = abs(turn.get("truth_deg") or 0.0)
        believed_h = abs(turn.get("measured_deg") or 0.0)
        sep_now = spec.width_m + spec.wheel.width_m
        if truth_h > 1.0 and believed_h > 0:
            sep_eff = sep_now * believed_h / truth_h
            new_width = sep_eff - spec.wheel.width_m
            if new_width >= 0.05:
                prop.corrections.append(Correction(
                    field="width_m (wheel separation)", old=spec.width_m,
                    new=round(new_width, 6), unit="m", kind="calibration",
                    basis=(f"odometry heading {believed_h:.1f} deg vs true "
                           f"{truth_h:.1f} deg implies an effective wheel "
                           f"separation of {sep_eff * 1000:.1f} mm vs the "
                           f"spec's {sep_now * 1000:.1f} mm; scrub/slip can "
                           f"masquerade as separation, so this calibrates "
                           f"the model to the measured behaviour")))
            else:
                prop.notes.append("separation repair would shrink the "
                                  "chassis below 50 mm wide — refused")
        else:
            prop.notes.append("wheel separation suspected but the turn "
                              "measurements are too small to calibrate")

    if not prop.corrections and not prop.notes:
        prop.notes.append("no measured repair available for this failure "
                          "signature — the suspects do not map to a "
                          "computable correction")
    return prop


def apply_repairs(spec: RobotSpec, proposal: RepairProposal) -> RobotSpec:
    """Return a new spec with the proposal's corrections applied."""
    d = spec.to_dict()
    for c in proposal.corrections:
        if c.field == "wheel.diameter_m":
            d["wheel"]["diameter_m"] = c.new
        elif c.field.startswith("width_m"):
            d["width_m"] = c.new
    return RobotSpec.from_json(json.dumps(d))


def render_proposal_md(proposal: RepairProposal) -> str:
    lines = [f"# Repair proposal — {proposal.spec_name}",
             f"Gate verdict before repair: **{proposal.verdict_before}**", ""]
    if proposal.narration:
        lines += [proposal.narration, ""]
    for c in proposal.corrections:
        lines.append(f"- **{c.field}**: {c.old} → {c.new} {c.unit} "
                     f"({c.kind}) — {c.basis}")
    for n in proposal.notes:
        lines.append(f"- note: {n}")
    lines += ["", "Repairs are computed from the failing run's own "
              "ground-truth measurements. Re-run the gate on the repaired "
              "spec to verify — a proposal is not a verdict."]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- narration
def _narrate_via_helper(proposal: RepairProposal, helper: Path,
                        model: str) -> str:
    facts = {"spec": proposal.spec_name,
             "verdict_before": proposal.verdict_before,
             "corrections": [c.to_dict() for c in proposal.corrections],
             "notes": proposal.notes}
    with tempfile.NamedTemporaryFile("w", suffix=".txt",
                                     delete=False) as tmp:
        tmp.write(NARRATION_PROMPT)
        system_file = tmp.name
    try:
        proc = subprocess.run(
            [sys.executable, str(helper), "chat", "--model", model,
             "--user", json.dumps(facts), "--system-file", system_file,
             "--temperature", "0.2"],
            capture_output=True, text=True, timeout=120)
    finally:
        Path(system_file).unlink(missing_ok=True)
    if proc.returncode != 0:
        raise RuntimeError("narration helper failed")
    result = json.loads(proc.stdout)
    if result.get("status") != 200:
        raise RuntimeError(f"narration API HTTP {result.get('status')}")
    payload = result.get("payload") or {}
    text = payload["choices"][0]["message"]["content"].strip()
    if not text:
        raise RuntimeError("empty narration")
    return text


def narrate(proposal: RepairProposal) -> RepairProposal:
    """Fill proposal.narration via Muse Spark when a connector helper
    is available; otherwise use the templated explanation. Never fails:
    narration is commentary, the corrections are the product."""
    from .describe import DEFAULT_HELPER, DEFAULT_MODEL
    model = os.environ.get("RF_MODEL") or DEFAULT_MODEL
    helper = Path(os.environ.get("RF_META_API_HELPER",
                                 str(DEFAULT_HELPER))).expanduser()
    if helper.is_file() and proposal.corrections:
        try:
            proposal.narration = _narrate_via_helper(proposal, helper,
                                                     model)
            proposal.narration_transport = f"meta-connector ({model})"
            return proposal
        except Exception:
            pass  # fall through to the template
    if proposal.corrections:
        bits = "; ".join(
            f"{c.field} {c.old} → {c.new} {c.unit}" for c in proposal.corrections)
        proposal.narration = (
            f"The gate failed this robot ({proposal.verdict_before}) and "
            f"the measurements support {len(proposal.corrections)} "
            f"repair(s): {bits}. Each figure is computed from the failing "
            f"run's ground truth, not estimated. Re-run the gate on the "
            f"repaired spec to verify.")
        proposal.narration_transport = "template (no model transport)"
    return proposal
