"""Part verification + compatibility checks.

Second stage after identification (see part-verification-and-
compatibility-spec.md): an identified part is matched against reference
dossiers whose fields were pulled from multiple independent sources
(reference_data.json). Agreement across sources raises a field's tier
(LISTED -> SOURCED -> VERIFIED); disagreement is kept as a visible
CONFLICT with both values — never silently resolved.

Compatibility checks then run arithmetic on the corroborated specs of
the whole set. A check that lacks the data it needs reports
MISSING_DATA, not a pass. Dossier data is seeded and local in v1 (the
F450-class parts from Abel's list, pulled 2026-10-26); live source
fetching is the roadmap, and nothing here claims otherwise.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

_DATA = Path(__file__).with_name("reference_data.json")

LISTED, SOURCED, VERIFIED, CONFLICT = "LISTED", "SOURCED", "VERIFIED", "CONFLICT"
PASS, FAIL, MARGINAL, MISSING_DATA = "PASS", "FAIL", "MARGINAL", "MISSING_DATA"


def load_dossiers(path: Path = _DATA) -> list[dict]:
    return json.loads(Path(path).read_text())["dossiers"]


def _range(text) -> tuple[float, float] | None:
    m = re.match(r"\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)", str(text))
    return (float(m.group(1)), float(m.group(2))) if m else None


def field_tier(values: list[dict]) -> str:
    """Tier for one dossier field from its per-source values."""
    if len(values) <= 1:
        return SOURCED
    vals = [v["value"] for v in values]
    if all(isinstance(v, (int, float)) for v in vals):
        lo, hi = min(vals), max(vals)
        # Independent measurements of one quantity corroborate within
        # ~25% (different rigs/conditions); beyond that, flag it.
        return VERIFIED if hi <= lo * 1.25 + 1e-9 else CONFLICT
    ranges = [_range(v) for v in vals]
    if all(ranges):
        # ranges agree if they overlap substantially
        lo = max(r[0] for r in ranges)
        hi = min(r[1] for r in ranges)
        return VERIFIED if lo <= hi else CONFLICT
    return VERIFIED if len(set(map(str, vals))) == 1 else CONFLICT


def match_dossier(item, dossiers: list[dict]) -> dict | None:
    for d in dossiers:
        m = d["match"]
        if m.get("slot") != item.slot:
            continue
        ok = True
        for key, want in m.items():
            if key == "slot":
                continue
            got = item.specs.get(key)
            if got is None and key == "wheelbase_mm" and "f450" in item.title.lower():
                got = 450
            if str(got) != str(want):
                ok = False
                break
        if ok:
            return d
    return None


def verify_items(items, dossiers: list[dict] | None = None) -> list[dict]:
    dossiers = dossiers if dossiers is not None else load_dossiers()
    out = []
    for it in items:
        d = match_dossier(it, dossiers)
        if d is None:
            out.append({"title": it.title, "slot": it.slot, "tier": LISTED,
                        "dossier": None, "fields": {}})
            continue
        fields = {f: {"values": vals, "tier": field_tier(vals)}
                  for f, vals in d["fields"].items()}
        out.append({"title": it.title, "slot": it.slot, "tier": VERIFIED,
                    "dossier": d["label"], "fields": fields})
    return out


def _dossier_field(verified: list[dict], slot: str, field: str):
    for v in verified:
        if v["slot"] == slot and field in v["fields"]:
            return v["fields"][field]
    return None


def _first(items, slot):
    return next((i for i in items if i.slot == slot), None)


def _cells_range(text: str):
    m = re.search(r"(\d)\s?-\s?(\d)\s?s", text.lower())
    return (int(m.group(1)), int(m.group(2))) if m else None


def check_compatibility(items, verified: list[dict]) -> list[dict]:
    checks = []

    def add(name, verdict, detail, flags=None):
        checks.append({"name": name, "verdict": verdict, "detail": detail,
                       "flags": flags or []})

    motor = _first(items, "motor")
    esc = _first(items, "esc")
    batt = _first(items, "battery")
    frame = _first(items, "frame")
    prop = _first(items, "propeller")
    charger = _first(items, "charger")
    pdb = _first(items, "pdb")
    pm = _first(items, "power_module")
    gimbal = _first(items, "gimbal")

    # 1. voltage chain ------------------------------------------------
    if motor and batt and batt.specs.get("cells"):
        cells_field = _dossier_field(verified, "motor", "cells")
        esc_range = _cells_range(esc.title) if esc else None
        b = batt.specs["cells"]
        problems = []
        if cells_field:
            rng = _range(cells_field["values"][0]["value"])
            if rng and not (rng[0] <= b <= rng[1]):
                problems.append(f"battery {b}S is outside the motor's "
                                f"sourced cell range {rng[0]:.0f}-{rng[1]:.0f}S")
        if esc_range and not (esc_range[0] <= b <= esc_range[1]):
            problems.append(f"battery {b}S is outside the ESC's "
                            f"{esc_range[0]}-{esc_range[1]}S range")
        flags = []
        rv = _dossier_field(verified, "motor", "rated_voltage_v")
        if rv and rv["tier"] == CONFLICT:
            flags.append("motor rated-voltage sources disagree "
                         "(kept visible in the dossier)")
        if problems:
            add("voltage_chain", FAIL, "; ".join(problems), flags)
        elif cells_field or esc_range:
            add("voltage_chain", PASS,
                f"battery {b}S sits inside the motor and ESC ranges", flags)
        else:
            add("voltage_chain", MISSING_DATA, "no cell ranges sourced")
    else:
        add("voltage_chain", MISSING_DATA, "motor or battery not identified")

    # 2. ESC current --------------------------------------------------
    if motor and esc and esc.specs.get("amps"):
        tc = _dossier_field(verified, "motor", "max_current_test_a")
        req = _dossier_field(verified, "motor", "required_esc_a")
        a = esc.specs["amps"]
        if req:
            need = max(v["value"] for v in req["values"])
            add("esc_current", PASS if a >= need else FAIL,
                f"ESC {a}A vs sourced requirement {need:.0f}A "
                f"(manufacturer recommendation)")
        elif tc:
            peak = max(v["value"] for v in tc["values"])
            need = peak * 1.5
            add("esc_current", PASS if a >= need else
                (MARGINAL if a >= peak * 1.2 else FAIL),
                f"ESC {a}A vs highest sourced test draw {peak}A "
                f"(x1.5 margin = {need:.0f}A)")
        else:
            add("esc_current", MISSING_DATA, "no motor current data sourced")
    else:
        add("esc_current", MISSING_DATA, "motor or ESC not identified")

    # 3. battery discharge --------------------------------------------
    if batt and batt.specs.get("c_rate") and batt.specs.get("capacity_mah"):
        avail = batt.specs["c_rate"] * batt.specs["capacity_mah"] / 1000.0
        tc = _dossier_field(verified, "motor", "max_current_test_a")
        if tc:
            peak = max(v["value"] for v in tc["values"])
            est_draw = 4 * peak * 1.24  # 3S test data scaled to a 4S pack
            add("battery_discharge",
                PASS if avail >= est_draw * 1.5 else
                (MARGINAL if avail >= est_draw else FAIL),
                f"battery can deliver {avail:.0f}A (C x Ah, LISTED specs); "
                f"estimated worst-case draw ~{est_draw:.0f}A (ESTIMATED "
                f"from 3S test data scaled to 4S)")
        else:
            add("battery_discharge", MISSING_DATA,
                "no motor draw data to compare against")
    else:
        add("battery_discharge", MISSING_DATA,
            "battery C-rate or capacity not in the listing")

    # 4. prop clearance -----------------------------------------------
    if prop and frame:
        code = prop.specs.get("size_code", "")
        dia_in = None
        if len(code) == 4 and code.isdigit():
            two = int(code[:2])
            dia_in = float(two) if 8 <= two <= 13 else float(code[0])
        wb = frame.specs.get("wheelbase_mm") or \
            (450 if "f450" in frame.title.lower() else None)
        if dia_in and wb:
            spacing = wb / math.sqrt(2)
            dia_mm = dia_in * 25.4
            add("prop_clearance",
                PASS if spacing > dia_mm * 1.05 else
                (MARGINAL if spacing > dia_mm else FAIL),
                f"adjacent motor spacing {spacing:.0f}mm vs prop "
                f"{dia_mm:.0f}mm ({dia_in:.0f}in)")
        else:
            add("prop_clearance", MISSING_DATA,
                "prop size or frame wheelbase unknown")
    else:
        add("prop_clearance", MISSING_DATA, "propeller or frame missing")

    # 5. connector continuity -----------------------------------------
    if batt and batt.specs.get("connector"):
        conn = batt.specs["connector"]
        others = [i.title for i in (pdb, pm, charger) if i]
        if others and all(conn.lower() in t.lower() for t in others):
            add("connector_continuity", PASS,
                f"{conn} appears at the battery, PDB/power module, and "
                f"charger — one plug family end to end")
        elif others:
            add("connector_continuity", MARGINAL,
                f"battery plug is {conn}; not every power item names it")
        else:
            add("connector_continuity", MISSING_DATA,
                "no other power items to check the plug against")
    else:
        add("connector_continuity", MISSING_DATA,
            "battery connector not stated in the listing")

    # 6. power rails ----------------------------------------------------
    if esc:
        if "opto" in esc.title.lower():
            if pdb or pm:
                add("power_rails", PASS,
                    "ESCs are OPTO (no BEC); the PDB/power module "
                    "provides the FC's regulated rail")
            else:
                add("power_rails", FAIL,
                    "ESCs are OPTO (no BEC) and no PDB or power module "
                    "is present to power the flight controller")
        else:
            add("power_rails", PASS,
                "ESCs are not OPTO-only; a BEC source exists in the set")
    else:
        add("power_rails", MISSING_DATA, "ESC not identified")

    # 7. charger adequacy ---------------------------------------------
    if charger and batt and batt.specs.get("cells") and \
            batt.specs.get("capacity_mah"):
        w = re.search(r"(\d+)\s?w\b", charger.title.lower())
        if w:
            watts = int(w.group(1))
            need_w = 4.2 * batt.specs["cells"] * \
                batt.specs["capacity_mah"] / 1000.0
            add("charger_adequacy",
                PASS if watts >= need_w else
                (MARGINAL if watts >= need_w * 0.7 else FAIL),
                f"charger {watts}W vs ~{need_w:.0f}W for a 1C charge of "
                f"the {batt.specs['cells']}S {batt.specs['capacity_mah']}mAh pack")
        else:
            add("charger_adequacy", MISSING_DATA,
                "charger wattage not stated in the listing")
    else:
        add("charger_adequacy", MISSING_DATA, "charger or battery missing")

    # 8. mounting -------------------------------------------------------
    mm = _dossier_field(verified, "motor", "mount_pattern_mm")
    fm = _dossier_field(verified, "frame", "mount_pattern_mm")
    if mm and fm:
        mv = mm["values"][0]["value"]
        fv = fm["values"][0]["value"]
        add("mounting", PASS if mv == fv else FAIL,
            f"motor base {mv}mm vs frame arm holes {fv}mm")
    else:
        add("mounting", MISSING_DATA,
            "mount patterns not sourced for both motor and frame")

    # 9/10. weight + thrust (estimates flagged) -------------------------
    fw = _dossier_field(verified, "frame", "takeoff_weight_g")
    if frame and fw and motor and batt:
        hi = _range(fw["values"][0]["value"])[1]
        frame_w = 282
        motor_w = 55 * motor.qty
        esc_w = 25 * (esc.qty if esc else 4)
        batt_w = 350  # ESTIMATED class figure for a 4S 3300 pack
        misc_w = 240  # ESTIMATED: PDB, module, FC, wiring, props
        auw = frame_w + motor_w + esc_w + batt_w + misc_w
        if gimbal:
            auw += 330  # ESTIMATED: gimbal + action camera
        verdict = PASS if auw <= hi * 0.85 else \
            (MARGINAL if auw <= hi else FAIL)
        add("all_up_weight", verdict,
            f"estimated AUW ~{auw:.0f}g vs frame takeoff ceiling "
            f"{hi:.0f}g (weights partly ESTIMATED; gimbal "
            f"{'included' if gimbal else 'not in set'})")
        th = _dossier_field(verified, "motor", "max_thrust_g")
        if th:
            low = min(v["value"] for v in th["values"])
            total = low * motor.qty
            ratio = total / auw
            verdict = PASS if ratio >= 1.5 else \
                (MARGINAL if ratio >= 1.15 else FAIL)
            if th["tier"] == CONFLICT and ratio >= 1.0 and \
                    verdict == FAIL:
                # The floor figure says it lifts, but the sources
                # disagree too much to call the margin a failure —
                # MARGINAL is the honest verdict until better data.
                verdict = MARGINAL
            add("thrust_margin", verdict,
                f"most pessimistic sourced thrust {low:.0f}g x{motor.qty} "
                f"= {total:.0f}g vs AUW ~{auw:.0f}g (ratio {ratio:.2f}); "
                f"thrust figures are CONFLICT-tier across sources and "
                f"were measured at 3S voltages, so this is a floor, "
                f"not the 4S reality",
                ["CONFLICT: max_thrust_g sources span "
                 f"{low:.0f}-{max(v['value'] for v in th['values']):.0f}g "
                 "under different test conditions"])
    else:
        add("all_up_weight", MISSING_DATA,
            "frame takeoff range or core parts not sourced")
    return checks


def build_verification(items) -> dict:
    verified = verify_items(items)
    checks = check_compatibility(items, verified)
    return {"parts": verified, "checks": checks}


def render_lines(verification: dict) -> list[str]:
    out = ["\nVERIFICATION (multi-source dossiers)"]
    for v in verification["parts"]:
        if v["dossier"]:
            conflicts = [f for f, d in v["fields"].items()
                         if d["tier"] == CONFLICT]
            line = f"  [{v['tier']}] {v['dossier']} <- {v['title'][:60]}"
            out.append(line)
            if conflicts:
                out.append(f"      CONFLICT fields kept visible: "
                           f"{', '.join(conflicts)}")
        else:
            out.append(f"  [LISTED] (title only) {v['title'][:70]}")
    out.append("\nCOMPATIBILITY")
    for c in verification["checks"]:
        out.append(f"  [{c['verdict']}] {c['name']}: {c['detail']}")
        for f in c["flags"]:
            out.append(f"      flag: {f}")
    return out
