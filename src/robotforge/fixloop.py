"""The Forge loop: Muse Spark proposes, the checks decide.

A spec with validation errors goes round a bounded loop:

1. the proposer (Muse Spark live, or the offline rules) reads the spec
   and the validator's findings and proposes field changes;
2. only changes to FIX_FIELDS survive, each well typed and positive;
3. the deterministic validator re-runs on the changed spec;
4. stop when no ERROR remains, the proposer has nothing new, or after
   MAX_ROUNDS rounds.

The model never assigns a verdict: every round's result is the
validator's own output, and every change carries its before/after and
the proposer's stated reason, so the owner reviews a diff rather than
trusting a black box. The Worker's /fix route uses the same field list
and prompt (tests/test_fixloop.py asserts the mirror).
"""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from typing import Callable

from .schema import RobotSpec, SpecError
from .validate import ERROR, WARN, Finding, has_errors, validate

MAX_ROUNDS = 3
MAX_CHANGES = 6

# Mirrored as FIX_FIELDS in live/worker.js.
FIX_FIELDS = {
    "length_m": "number", "width_m": "number", "height_m": "number",
    "mass_kg": "number", "ground_clearance_m": "number",
    "wheel.diameter_m": "number", "wheel.width_m": "number",
    "wheel.count": "integer",
    "motor.voltage_v": "number", "motor.count": "integer",
    "motor.stall_torque_nm": "number", "motor.kind": "string",
    "battery.voltage_v": "number", "battery.capacity_mah": "integer",
    "battery.chemistry": "string",
}

FIX_SYSTEM_PROMPT = (
    "You repair a robot specification for RobotForge. You are given the "
    "spec as JSON and the engineering validator's findings "
    "(\"[ERROR] check: message\" or \"[WARN] ...\").\n\n"
    "Propose the SMALLEST set of field changes that would resolve the "
    "findings while keeping the robot recognisably the same robot. Prefer "
    "changing the one field the finding names. Never invent sensors or new "
    "parts. Keep values physically realistic.\n\n"
    "You may only change these fields: " + ", ".join(FIX_FIELDS) + ".\n\n"
    "Output ONLY a JSON object, no prose, no markdown fences:\n"
    "{\"changes\": [{\"path\": \"<field>\", \"value\": <new value>, "
    "\"reason\": \"<one short sentence>\"}], \"summary\": \"<one or two "
    "plain sentences for the robot's owner>\"}\n\n"
    "You only PROPOSE. The validator re-checks every proposal; you never "
    "decide whether the robot passes.")


@dataclass
class Change:
    path: str
    before: object
    value: object
    reason: str


@dataclass
class Round:
    number: int
    proposer: str
    summary: str
    changes: list[Change]
    findings_after: list[str]
    errors_after: int


@dataclass
class LoopResult:
    start_findings: list[str]
    rounds: list[Round] = field(default_factory=list)
    final_spec: dict | None = None
    resolved: bool = False
    stop_reason: str = ""

    def to_dict(self) -> dict:
        return {"start_findings": self.start_findings,
                "rounds": [asdict(r) for r in self.rounds],
                "final_spec": self.final_spec, "resolved": self.resolved,
                "stop_reason": self.stop_reason}


def finding_lines(findings: list[Finding]) -> list[str]:
    return [f"[{f.severity}] {f.check}: {f.message}" for f in findings]


def _get(spec: dict, path: str):
    a, _, b = path.partition(".")
    if not b:
        return spec.get(a)
    sub = spec.get(a)
    return sub.get(b) if isinstance(sub, dict) else None


def _set(spec: dict, path: str, value) -> None:
    a, _, b = path.partition(".")
    if not b:
        spec[a] = value
    elif isinstance(spec.get(a), dict):
        spec[a][b] = value


def sanitize_changes(raw, spec: dict) -> list[Change]:
    """Keep only allowed, well-typed, actually-different changes."""
    out: list[Change] = []
    seen = set()
    if not isinstance(raw, list):
        return out
    for c in raw:
        if len(out) >= MAX_CHANGES:
            break
        if not isinstance(c, dict):
            continue
        path = str(c.get("path", ""))
        kind = FIX_FIELDS.get(path)
        if not kind or path in seen:
            continue
        value = c.get("value")
        if kind == "string":
            if not isinstance(value, str) or not value.strip():
                continue
            value = value.strip()[:60]
        else:
            if isinstance(value, str):
                try:
                    value = float(value)
                except ValueError:
                    continue
            if isinstance(value, bool) or not isinstance(value, (int, float)) \
                    or value != value or value <= 0 or value == float("inf"):
                continue
            if kind == "integer":
                if float(value) != int(value):
                    continue
                value = int(value)
        before = _get(spec, path)
        if before == value:
            continue
        seen.add(path)
        out.append(Change(path, before, value, str(c.get("reason", ""))[:300]))
    return out


def rules_proposer(spec: dict, lines: list[str]) -> dict:
    """Offline proposer: textbook fixes for the validator's ERRORs.

    It exists so the loop runs without a key (demo rehearsal, CI). It
    only knows the checks it names; anything else it leaves alone.
    """
    changes = []
    text = "\n".join(lines)
    wheel = spec.get("wheel") or {}
    if "geometry.clearance_vs_wheel" in text and wheel.get("diameter_m"):
        r = wheel["diameter_m"] / 2.0
        changes.append({"path": "ground_clearance_m",
                        "value": round(r * 0.8, 3),
                        "reason": "clearance must sit below the wheel radius; "
                                  "80% of the radius leaves room for tyre squash"})
    if "mass.budget" in text and "above the declared total" in text:
        total = sum((spec.get("component_mass_kg") or {}).values())
        changes.append({"path": "mass_kg", "value": round(total * 1.05, 2),
                        "reason": "the declared total must cover the parts; "
                                  "5% added for fasteners and wiring"})
    motor_v = (spec.get("motor") or {}).get("voltage_v")
    if "electrical.voltage_match" in text and motor_v:
        cells = max(1, math.ceil(motor_v / 3.7 - 0.05))
        changes.append({"path": "battery.voltage_v",
                        "value": round(cells * 3.7, 1),
                        "reason": f"a {cells}S pack matches the "
                                  f"{motor_v:g} V motors without a converter"})
    return {"changes": changes,
            "summary": "Offline rules: textbook fixes for the errors found."
            if changes else "Offline rules have no fix for these findings."}


def live_proposer(chat: Callable[[str, str], tuple[str, str]]):
    """Wrap a (system, user) -> (text, label) chat call as a proposer."""
    def propose(spec: dict, lines: list[str]) -> dict:
        text, label = chat(FIX_SYSTEM_PROMPT,
                           "Spec:\n" + json.dumps(spec) +
                           "\n\nFindings:\n" + "\n".join(lines))
        text = text.strip()
        if text.startswith("```"):
            text = text.strip("`").removeprefix("json").strip()
        try:
            doc = json.loads(text)
        except json.JSONDecodeError as exc:
            raise SpecError(f"the model's fix proposal is not JSON ({exc})")
        if not isinstance(doc, dict):
            raise SpecError("the model's fix proposal is not a JSON object")
        doc["_label"] = label
        return doc
    return propose


def run_loop(spec: RobotSpec, proposer, *, label: str = "rules",
             include_warnings: bool = False,
             max_rounds: int = MAX_ROUNDS) -> LoopResult:
    current = spec.to_dict()
    findings = validate(spec)
    res = LoopResult(start_findings=finding_lines(findings))

    def targets(fs):
        keep = (ERROR, WARN) if include_warnings else (ERROR,)
        return [f for f in fs if f.severity in keep]

    if not targets(findings):
        res.final_spec, res.resolved = current, True
        res.stop_reason = "nothing to fix"
        return res
    for n in range(1, max_rounds + 1):
        doc = proposer(current, finding_lines(targets(findings)))
        changes = sanitize_changes(doc.get("changes"), current)
        if not changes:
            res.stop_reason = "the proposer had no further valid changes"
            break
        candidate = json.loads(json.dumps(current))
        for c in changes:
            _set(candidate, c.path, c.value)
        try:
            parsed = RobotSpec.from_dict(candidate)
        except SpecError as exc:
            res.stop_reason = f"round {n} produced an invalid spec ({exc})"
            break
        findings = validate(parsed)
        current = candidate
        res.rounds.append(Round(n, doc.get("_label", label),
                                str(doc.get("summary", ""))[:600], changes,
                                finding_lines(findings),
                                sum(1 for f in findings if f.severity == ERROR)))
        if not targets(findings):
            res.resolved = True
            res.stop_reason = f"resolved in {n} round(s)"
            break
    else:
        res.stop_reason = f"stopped after {max_rounds} rounds"
    res.final_spec = current
    if not res.resolved and not has_errors(findings) and not include_warnings:
        res.resolved = True
    return res


def format_loop(res: LoopResult) -> str:
    lines = ["Forge loop — the model proposes, the validator decides", "",
             "Start:"]
    lines += [f"  {x}" for x in res.start_findings]
    for r in res.rounds:
        lines.append("")
        lines.append(f"Round {r.number} ({r.proposer}): {r.summary}")
        for c in r.changes:
            lines.append(f"  {c.path}: {c.before} -> {c.value}  ({c.reason})")
        lines.append(f"  validator: {r.errors_after} error(s)")
        lines += [f"    {x}" for x in r.findings_after]
    lines.append("")
    lines.append(("RESOLVED: " if res.resolved else "NOT RESOLVED: ")
                 + res.stop_reason)
    return "\n".join(lines)
