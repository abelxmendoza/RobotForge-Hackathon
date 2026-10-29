"""Electrical harness checks for a robot's documented wiring graph.

This is the wiring sibling of :mod:`robotforge.validate` (spec checks)
and :mod:`robotforge.stability` (static checks): it grades what a
spec's wiring data can honestly support, and — the point of the whole
exercise — it refuses to say more than the data says. Every evaluation
carries one of three states:

- ``CHECKED``: every input the check needs was present, so the check
  really ran. A finding (WARN/ERROR) may still hang off it.
- ``PARTIAL``: the check ran on the branches whose data exists, but
  some branches could not be totalled, so the result is a floor, not
  a verdict. Used by the rail budget, where a partly-known load is
  still worth reporting.
- ``NOT_CHECKED``: an input is missing. The evaluation names exactly
  which input, so the report doubles as a shopping list for the
  datasheets someone still has to hunt down.

A robot's headline is therefore never "harness: PASS". It is a set of
counts — checked clean, warnings, errors, partial, not checked (with
the missing inputs named) — because most real robots are missing most
of their current data, and a blanket pass over unmeasured wiring is
exactly the kind of claim RobotForge exists to not make.

The five checks (v1):

1. **Voltage drop** over a power connection:
   R = rho_copper * 2L / A(gauge) (round trip: out and back), drop =
   I * R. WARN when the drop exceeds 5% of the connection's voltage
   (v1 threshold, printed on every report).
2. **Ampacity**: the connection's current against a conservative
   published ampacity table (below).
3. **Logic levels**: a data connection whose endpoints' known logic
   levels do not intersect (3.3 V vs 5 V) and which carries no
   level-shifting element warns.
4. **Rail budget**: for every node that sources power, the sum of its
   downstream load currents against its rated output current, when it
   declares one. Over rating is an ERROR; unknown loads make the
   evaluation PARTIAL and are named.
5. **Connector match**: where both ends of a connection declare a
   connector, different connector bases (XT30 vs XT60, JST-PH vs
   JST-XH, XT60 vs barrel) warn — they do not mate without an adapter.

Inputs live on the wiring graph, all optional, all sourced or absent:

- nodes: ``current_a`` (the current this node draws as a load),
  ``output_current_a`` (a source/regulator's rated output current;
  ``rated_output_a`` / ``max_output_a`` also accepted),
  ``logic_v`` (a number, or a list for a dual-level device), and
  ``level_shifter: true`` for a node that shifts levels.
- connections: ``current_a`` (current carried, overrides the load
  node's), ``level_shifted: true``, and the cable object the wiring
  viewer build defines — ``cable: {gauge_awg, connector, length_mm}``
  — plus the two-ended form ``cable: {connector_from, connector_to}``
  (or ``connector_from`` / ``connector_to`` on the connection itself).

Ampacity table: PowerStream's *American Wire Gauge Chart and AWG
Electrical Current Load Limits* (powerstream.com/Wire_Size.htm),
which follows the *Handbook of Electronic Tables and Formulas*. The
table prints two ampacity columns; RobotForge uses the *power
transmission* column — the conservative one, computed at 700 circular
mils per amp and meant for bundled runs. The chassis-wiring column is
for a single conductor in free air, which a harness is not.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from .schema import RobotSpec

ERROR, WARN, INFO = "ERROR", "WARN", "INFO"
CHECKED, PARTIAL, NOT_CHECKED = "CHECKED", "PARTIAL", "NOT_CHECKED"

COPPER_RHO_OHM_M = 1.68e-8        # copper resistivity at 20 C, ohm-metres
VOLTAGE_DROP_WARN_PCT = 5.0       # v1 threshold, printed on every report

AMPACITY_SOURCE = (
    "PowerStream, 'American Wire Gauge Chart and AWG Electrical "
    "Current Load Limits' (powerstream.com/Wire_Size.htm), following "
    "the Handbook of Electronic Tables and Formulas — the table's "
    "conservative power-transmission column (700 circular mils per "
    "amp, for bundled runs), not its free-air chassis-wiring column")

# AWG -> maximum amps, PowerStream power-transmission column.
AMPACITY_A = {
    0: 150.0, 1: 119.0, 2: 94.0, 3: 75.0, 4: 60.0, 5: 47.0, 6: 37.0,
    7: 30.0, 8: 24.0, 9: 19.0, 10: 15.0, 11: 12.0, 12: 9.3, 13: 7.4,
    14: 5.9, 15: 4.7, 16: 3.7, 17: 2.9, 18: 2.3, 19: 1.8, 20: 1.5,
    21: 1.2, 22: 0.92, 23: 0.729, 24: 0.577, 25: 0.457, 26: 0.361,
    27: 0.288, 28: 0.226, 29: 0.182, 30: 0.142,
}

CHECK_NAMES = ("voltage_drop", "ampacity", "logic_levels",
               "rail_budget", "connector_match")


class HarnessError(ValueError):
    """The spec cannot support harness checks (e.g. no wiring)."""


# ----------------------------------------------------------------------
# wire physics
# ----------------------------------------------------------------------

def awg_area_mm2(awg: float) -> float:
    """Conductor cross-section of an AWG size, in mm^2 (the standard
    AWG geometric series: area doubles every 3 gauges)."""
    return 0.012668 * (92.0 ** ((36.0 - float(awg)) / 19.5))


def wire_loop_resistance_ohm(awg: float, length_mm: float) -> float:
    """Resistance of the out-and-back loop for a one-way run of
    ``length_mm``: R = rho * 2L / A."""
    area_m2 = awg_area_mm2(awg) * 1e-6
    return COPPER_RHO_OHM_M * (2.0 * float(length_mm) / 1000.0) / area_m2


def voltage_drop_v(awg: float, length_mm: float, current_a: float) -> float:
    """Voltage lost on the run: V = I * R_loop."""
    return float(current_a) * wire_loop_resistance_ohm(awg, length_mm)


def ampacity_a(awg: float) -> float | None:
    """The table's conservative rating for a gauge, or None when the
    gauge is outside the printed table (never interpolated)."""
    return AMPACITY_A.get(int(awg)) if float(awg).is_integer() else None


# ----------------------------------------------------------------------
# findings + evaluations
# ----------------------------------------------------------------------

@dataclass
class Finding:
    severity: str
    check: str
    message: str
    subject: str = ""

    def to_dict(self) -> dict:
        return {"severity": self.severity, "check": self.check,
                "message": self.message, "subject": self.subject}


@dataclass
class Evaluation:
    """One check applied to one subject (a connection, or a rail).

    ``findings`` are validate-style findings; ``missing`` names the
    inputs whose absence kept the check from running (state
    NOT_CHECKED) or from completing (state PARTIAL)."""
    check: str
    subject: str
    state: str
    missing: list = field(default_factory=list)
    inputs: dict = field(default_factory=dict)
    results: dict = field(default_factory=dict)
    findings: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"check": self.check, "subject": self.subject,
                "state": self.state, "missing": list(self.missing),
                "inputs": self.inputs, "results": self.results,
                "findings": [f.to_dict() for f in self.findings]}


@dataclass
class HarnessReport:
    robot: str
    evaluations: list
    date: str | None = None

    @property
    def findings(self) -> list:
        return [f for ev in self.evaluations for f in ev.findings]

    def summary(self) -> dict:
        states = {CHECKED: 0, PARTIAL: 0, NOT_CHECKED: 0}
        by_check = {name: {CHECKED: 0, PARTIAL: 0, NOT_CHECKED: 0}
                    for name in CHECK_NAMES}
        clean = warnings = errors = 0
        sev = {ERROR: 0, WARN: 0, INFO: 0}
        missing: dict[str, dict] = {}
        for ev in self.evaluations:
            states[ev.state] += 1
            by_check[ev.check][ev.state] += 1
            sevs = {f.severity for f in ev.findings}
            for s in sevs:
                sev[s] += sum(1 for f in ev.findings if f.severity == s)
            if ERROR in sevs:
                errors += 1
            elif WARN in sevs:
                warnings += 1
            elif ev.state == CHECKED:
                clean += 1
            for m in ev.missing:
                slot = missing.setdefault(
                    m, {"input": m, "count": 0, "subjects": []})
                slot["count"] += 1
                if ev.subject not in slot["subjects"]:
                    slot["subjects"].append(ev.subject)
        return {
            "evaluations": len(self.evaluations),
            "checked_clean": clean,
            "evaluations_with_warnings": warnings,
            "evaluations_with_errors": errors,
            "states": states,
            "findings": sev,
            "by_check": by_check,
            "missing_inputs": sorted(
                missing.values(), key=lambda d: (-d["count"], d["input"])),
        }

    def headline(self) -> str:
        """The counts line. Deliberately never a blanket verdict."""
        s = self.summary()
        bits = [f"{s['checked_clean']} checked clean",
                f"{s['evaluations_with_warnings']} with warnings",
                f"{s['evaluations_with_errors']} with errors",
                f"{s['states'][PARTIAL]} partial",
                f"{s['states'][NOT_CHECKED]} not checked"]
        if s["missing_inputs"]:
            top = ", ".join(f"{m['input']} ×{m['count']}"
                            for m in s["missing_inputs"][:3])
            bits.append(f"missing data: {top}")
        return " · ".join(bits)

    def to_dict(self) -> dict:
        doc = {
            "check": "harness_checks",
            "robot": self.robot,
            "method": (
                "Electrical checks over the spec's documented wiring "
                "graph: voltage drop (copper loop resistance), "
                "ampacity (published table), logic-level agreement, "
                "rail budgets (downstream load sums vs rated output) "
                "and connector matching. Every evaluation is CHECKED, "
                "PARTIAL or NOT_CHECKED with its missing inputs named; "
                "no blanket harness pass is ever claimed."),
            "thresholds": {
                "voltage_drop_warn_pct": VOLTAGE_DROP_WARN_PCT,
                "voltage_drop_rule": (
                    "WARN when the computed drop exceeds this share "
                    "of the connection's voltage (v1 threshold)"),
                "ampacity_source": AMPACITY_SOURCE,
                "copper_rho_ohm_m": COPPER_RHO_OHM_M,
            },
            "summary": self.summary(),
            "headline": self.headline(),
            "evaluations": [ev.to_dict() for ev in self.evaluations],
            "findings": [f.to_dict() for f in self.findings],
        }
        if self.date:
            doc["date"] = self.date
        return doc


# ----------------------------------------------------------------------
# raw wiring-graph access (the harness reads fields the schema does
# not model yet — cable/current/logic data ride along in the spec's
# wiring block and are preserved here by working from the raw dict)
# ----------------------------------------------------------------------

def _num(value) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    return None


def _first_num(mapping: dict, keys) -> float | None:
    for k in keys:
        v = _num(mapping.get(k))
        if v is not None:
            return v
    return None


def _cable(conn: dict) -> dict:
    cable = conn.get("cable")
    return cable if isinstance(cable, dict) else {}


def _subject(conn: dict) -> str:
    return f"{conn.get('from')} -> {conn.get('to')}"


class _Graph:
    def __init__(self, data: dict):
        wiring = data.get("wiring")
        if not isinstance(wiring, dict):
            raise HarnessError(
                f"{data.get('name', 'spec')}: no wiring block — harness "
                "checks grade a documented wiring graph, and this spec "
                "carries none (an undocumented harness is not invented)")
        # Reject malformed electrical quantities before any calculation. A
        # negative load or a zero-voltage power rail must never appear clean.
        def require_quantity(value, label, *, positive=False):
            if value is None:
                return
            if (isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                    or (value <= 0 if positive else value < 0)):
                rule = "finite and > 0" if positive else "finite and >= 0"
                raise HarnessError(f"{label} must be {rule}")

        for n in wiring.get("nodes", []):
            for key in ("current_a", "output_current_a", "rated_output_a",
                        "max_output_a"):
                require_quantity(n.get(key), f"node {n.get('id')} {key}")
        for c in wiring.get("connections", []):
            if c.get("kind") == "power":
                require_quantity(c.get("volts"),
                                 f"connection {_subject(c)} volts",
                                 positive=True)
                require_quantity(c.get("current_a"),
                                 f"connection {_subject(c)} current_a")
            cable = _cable(c)
            require_quantity(cable.get("length_mm"),
                             f"connection {_subject(c)} cable.length_mm",
                             positive=True)
            gauge = cable.get("gauge_awg", cable.get("awg"))
            require_quantity(gauge,
                             f"connection {_subject(c)} cable.gauge_awg")
            if gauge is not None and gauge > 40:
                raise HarnessError("cable.gauge_awg must be <= 40")

        nodes = {}
        for n in wiring.get("nodes", []):
            nid = str(n.get("id", ""))
            if not nid or nid in nodes:
                raise HarnessError(f"wiring node id {nid!r} is empty "
                                   "or duplicated")
            nodes[nid] = n
        conns = []
        for c in wiring.get("connections", []):
            if c.get("from") not in nodes or c.get("to") not in nodes:
                raise HarnessError(
                    f"wiring connection {_subject(c)} names an "
                    "unknown node")
            if c.get("kind") not in ("power", "data"):
                raise HarnessError(
                    f"wiring connection {_subject(c)} has kind "
                    f"{c.get('kind')!r}, expected power or data")
            conns.append(c)
        if not nodes or not conns:
            raise HarnessError("wiring block has no nodes/connections "
                               "to check")
        self.nodes = nodes
        self.connections = conns
        self._out_power: dict[str, list] = {}
        for c in conns:
            if c["kind"] == "power":
                self._out_power.setdefault(c["from"], []).append(c)
        self._current_cache: dict[str, tuple] = {}

    # -- current resolution -------------------------------------------
    def connection_current(self, conn: dict):
        """(amps | None, unknown node ids) for a power connection.

        The connection's own ``current_a`` wins; otherwise the load
        node's ``current_a``; otherwise the sum of everything the
        destination feeds onward (a distribution node's draw is its
        downstream total). Unknown leaves are named, never zeroed."""
        direct = _num(conn.get("current_a"))
        if direct is not None:
            return direct, []
        return self._node_draw(conn["to"], frozenset())

    def _node_draw(self, node_id: str, visiting: frozenset):
        if node_id in self._current_cache and not visiting:
            return self._current_cache[node_id]
        node = self.nodes[node_id]
        own = _num(node.get("current_a"))
        outs = self._out_power.get(node_id, [])
        if not outs:
            result = (own, [] if own is not None else [node_id])
        elif node_id in visiting:
            result = (None, [node_id])
        else:
            total, unknown = 0.0, []
            for c in outs:
                direct = _num(c.get("current_a"))
                if direct is not None:
                    total += direct
                    continue
                v, unk = self._node_draw(c["to"], visiting | {node_id})
                if v is None:
                    unknown.extend(unk or [c["to"]])
                else:
                    total += v
            result = (None, unknown) if unknown else (total, [])
        if not visiting:
            self._current_cache[node_id] = result
        return result


# ----------------------------------------------------------------------
# the five checks
# ----------------------------------------------------------------------

def _check_voltage_drop(g: _Graph, conn: dict) -> Evaluation:
    subj = _subject(conn)
    cable = _cable(conn)
    gauge = _first_num(cable, ("gauge_awg", "awg"))
    length = _first_num(cable, ("length_mm",))
    volts = _num(conn.get("volts"))
    current, unknown = g.connection_current(conn)
    missing = []
    if gauge is None:
        missing.append("cable.gauge_awg")
    if length is None:
        missing.append("cable.length_mm")
    if volts is None:
        missing.append("connection voltage (volts)")
    if current is None:
        missing += [f"current_a for {u}" for u in unknown] or \
            ["current_a"]
    inputs = {"gauge_awg": gauge, "length_mm": length,
              "volts": volts, "current_a": current}
    if missing:
        return Evaluation("voltage_drop", subj, NOT_CHECKED,
                          missing=missing, inputs=inputs)
    drop = voltage_drop_v(gauge, length, current)
    pct = 100.0 * drop / volts if volts > 0 else 0.0
    findings = []
    if pct > VOLTAGE_DROP_WARN_PCT:
        findings.append(Finding(
            WARN, "harness.voltage_drop",
            f"{subj}: computed drop {drop:.3f} V is {pct:.1f}% of "
            f"{volts:g} V (threshold {VOLTAGE_DROP_WARN_PCT:g}%) over "
            f"{length:g} mm of {gauge:g} AWG at {current:g} A — the "
            "load sees a starved rail; shorten the run or thicken "
            "the wire", subj))
    return Evaluation(
        "voltage_drop", subj, CHECKED, inputs=inputs,
        results={"area_mm2": round(awg_area_mm2(gauge), 4),
                 "loop_resistance_ohm": round(
                     wire_loop_resistance_ohm(gauge, length), 4),
                 "drop_v": round(drop, 4), "drop_pct": round(pct, 2)},
        findings=findings)


def _check_ampacity(g: _Graph, conn: dict) -> Evaluation:
    subj = _subject(conn)
    cable = _cable(conn)
    gauge = _first_num(cable, ("gauge_awg", "awg"))
    current, unknown = g.connection_current(conn)
    missing = []
    rating = None
    if gauge is None:
        missing.append("cable.gauge_awg")
    else:
        rating = ampacity_a(gauge)
        if rating is None:
            missing.append(f"ampacity table entry for {gauge:g} AWG")
    if current is None:
        missing += [f"current_a for {u}" for u in unknown] or \
            ["current_a"]
    inputs = {"gauge_awg": gauge, "current_a": current,
              "ampacity_a": rating}
    if missing:
        return Evaluation("ampacity", subj, NOT_CHECKED,
                          missing=missing, inputs=inputs)
    findings = []
    if current > rating:
        findings.append(Finding(
            ERROR, "harness.ampacity",
            f"{subj}: {current:g} A on {gauge:g} AWG exceeds the "
            f"conservative published rating of {rating:g} A "
            f"(PowerStream power-transmission column) — the wire is "
            "the fuse; thicken it or split the load", subj))
    return Evaluation("ampacity", subj, CHECKED, inputs=inputs,
                      results={"ampacity_a": rating},
                      findings=findings)


def _logic_values(node: dict, conn: dict, side: str) -> set:
    """Known logic levels at one end of a data connection."""
    raw = conn.get(f"logic_v_{side}")
    if raw is None:
        raw = node.get(f"logic_v_{'out' if side == 'from' else 'in'}")
    if raw is None:
        raw = node.get("logic_v")
    if raw is None:
        return set()
    if isinstance(raw, (list, tuple)):
        return {v for v in (_num(x) for x in raw) if v is not None}
    v = _num(raw)
    return {v} if v is not None else set()


def _check_logic(g: _Graph, conn: dict) -> Evaluation:
    subj = _subject(conn)
    src, dst = g.nodes[conn["from"]], g.nodes[conn["to"]]
    a, b = _logic_values(src, conn, "from"), _logic_values(dst, conn, "to")
    missing = []
    if not a:
        missing.append(f"logic_v for {conn['from']}")
    if not b:
        missing.append(f"logic_v for {conn['to']}")
    inputs = {"logic_v_from": sorted(a), "logic_v_to": sorted(b)}
    if missing:
        return Evaluation("logic_levels", subj, NOT_CHECKED,
                          missing=missing, inputs=inputs)
    shifted = bool(conn.get("level_shifted")
                   or _cable(conn).get("level_shifted")
                   or src.get("level_shifter") or dst.get("level_shifter"))
    inputs["level_shifted"] = shifted
    findings = []
    if a.isdisjoint(b) and not shifted:
        findings.append(Finding(
            WARN, "harness.logic_levels",
            f"{subj}: logic levels "
            f"{'/'.join(f'{v:g}' for v in sorted(a))} V and "
            f"{'/'.join(f'{v:g}' for v in sorted(b))} V do not agree "
            "and no level shifter is recorded on the link — a 3.3 V "
            "input is not 5 V tolerant; add a shifter or record one",
            subj))
    return Evaluation("logic_levels", subj, CHECKED, inputs=inputs,
                      findings=findings)


def _check_rail_budget(g: _Graph, source_id: str) -> Evaluation:
    node = g.nodes[source_id]
    subj = f"{source_id} rail"
    rating = _first_num(node, ("output_current_a", "rated_output_a",
                               "max_output_a"))
    branches, unknown = [], []
    known_total = 0.0
    for c in g._out_power.get(source_id, []):
        v, unk = g.connection_current(c)
        branches.append({"to": c["to"], "current_a": v})
        if v is None:
            unknown.append(c["to"])
        else:
            known_total += v
    missing = []
    if rating is None:
        missing.append(f"rated output current for {source_id}")
    missing += [f"current_a for {u}" for u in unknown]
    inputs = {"rated_output_a": rating,
              "known_load_a": round(known_total, 4),
              "branches": branches}
    if rating is None:
        return Evaluation("rail_budget", subj, NOT_CHECKED,
                          missing=missing, inputs=inputs)
    findings = []
    if known_total > rating:
        findings.append(Finding(
            ERROR, "harness.rail_budget",
            f"{source_id}: known downstream load {known_total:g} A "
            f"already exceeds the rated output {rating:g} A"
            + (" (and more loads are unmeasured)" if unknown else "")
            + " — the rail browns out or the regulator shuts down; "
              "split the loads or fit a hungrier regulator", subj))
    state = PARTIAL if unknown else CHECKED
    return Evaluation("rail_budget", subj, state, missing=missing,
                      inputs=inputs,
                      results={"over_budget": known_total > rating},
                      findings=findings)


_GENDER = re.compile(r"\b(male|female|plug|socket|m|f)\b")


def _connector_base(text: str) -> str:
    t = _GENDER.sub("", str(text).lower())
    return re.sub(r"[^a-z0-9]+", "", t)


def _connector_pair(g: _Graph, conn: dict):
    cable = _cable(conn)
    a = cable.get("connector_from") or conn.get("connector_from")
    b = cable.get("connector_to") or conn.get("connector_to")
    if a and b:
        return str(a), str(b)
    return None, None


def _check_connector(g: _Graph, conn: dict) -> Evaluation:
    subj = _subject(conn)
    a, b = _connector_pair(g, conn)
    if not a or not b:
        return Evaluation(
            "connector_match", subj, NOT_CHECKED,
            missing=["connector at both ends "
                     "(connector_from / connector_to)"],
            inputs={"connector_from": a, "connector_to": b})
    findings = []
    if _connector_base(a) != _connector_base(b):
        findings.append(Finding(
            WARN, "harness.connector_match",
            f"{subj}: connector {a} at one end and {b} at the other "
            "do not mate directly — an adapter or a re-terminated "
            "cable is needed", subj))
    return Evaluation("connector_match", subj, CHECKED,
                      inputs={"connector_from": a, "connector_to": b},
                      findings=findings)


# ----------------------------------------------------------------------
# entry points
# ----------------------------------------------------------------------

def check_spec_data(data: dict) -> HarnessReport:
    """Run all five checks over a raw spec dict's wiring block."""
    g = _Graph(data)
    evaluations: list[Evaluation] = []
    for conn in g.connections:
        if conn["kind"] == "power":
            evaluations.append(_check_voltage_drop(g, conn))
            evaluations.append(_check_ampacity(g, conn))
        else:
            evaluations.append(_check_logic(g, conn))
        evaluations.append(_check_connector(g, conn))
    for source_id in g.nodes:
        if g._out_power.get(source_id):
            evaluations.append(_check_rail_budget(g, source_id))
    return HarnessReport(robot=str(data.get("name", "spec")),
                         evaluations=evaluations)


def check_spec(spec: RobotSpec, raw_data: dict | None = None) -> HarnessReport:
    """Run the checks for a parsed spec. ``raw_data`` (the spec's own
    JSON dict) is preferred when given: the schema does not model the
    cable/current/logic fields yet, and parsing would strip them."""
    return check_spec_data(raw_data if raw_data is not None
                           else spec.to_dict())


def has_errors(report: HarnessReport) -> bool:
    return any(f.severity == ERROR for f in report.findings)


def format_harness_report(rep: HarnessReport) -> str:
    lines = [
        f"Harness checks — {rep.robot}",
        "Electrical checks over the spec's documented wiring graph. "
        "No blanket pass is claimed: each check is CHECKED, PARTIAL "
        "or NOT_CHECKED, and a not-checked check names the data it "
        "is missing.",
        "",
        f"Counts: {rep.headline()}",
        "",
        "Findings:",
    ]
    if rep.findings:
        for f in rep.findings:
            lines.append(f"  [{f.severity}] {f.check}: {f.message}")
    else:
        lines.append("  none — silence here means the checked inputs "
                     "raised nothing, not that everything was checked")
    lines += ["", "Evaluations:"]
    for ev in rep.evaluations:
        tail = f" — missing: {', '.join(ev.missing)}" if ev.missing \
            else ""
        lines.append(f"  {ev.check:<14} {ev.subject:<28} "
                     f"{ev.state}{tail}")
    lines += [
        "",
        f"Voltage-drop threshold (v1): WARN above "
        f"{VOLTAGE_DROP_WARN_PCT:g}% of the connection's voltage. "
        f"Ampacity: {AMPACITY_SOURCE}.",
    ]
    return "\n".join(lines)
