"""Parts catalog, robot-class templates, build inventory, and the Robodex.

Lineage: the parts catalogue core (part classes, robot-class BOM
templates, inventory assessment) was first built on the unmerged branch
``feature/catalogue-classes`` (2026-10-26) and is ported here onto main,
extended with beginner-facing part fields and the Robodex. It is the
single catalog — not a second one.

Layers:

- **Catalog** (``catalog/parts.json``): real parts split into UNIVERSAL
  classes (every robot needs power, cables, compute, comms, sensors,
  materials, safety) and SIGNATURE classes (what makes a robot type a
  type: propellers for a quadcopter, joint servos for a humanoid). Each
  part carries a plain-language blurb, what it is used for, the robot
  types that use it, compatibility notes (general guidance only), its
  licence and source, and an optional ``buy`` field — empty in v1 by
  design; shop links are a deliberate later step.
- **Robot-class templates**: a reference BOM per robot class (rover,
  RC car, quadcopter, humanoid, quadruped, arm). The template makes
  "what's missing?" answerable — an inventory is diffed against the
  class's complete shape. Missing parts may be VIRTUAL-FILLED from the
  catalogue so a sim model can be built today, but virtual parts exist
  only in simulation and never inflate the on-hand count. Every motion
  gate pack is per-class; templates state plainly which pack a class
  has ("live" / "partial" / "roadmap").
- **Robodex** (``catalog/robots.json``): the numbered robot index —
  #001 Andino, #002 TurtleBot3 Burger, #003 TurtleBot3 Waffle Pi,
  #004 Pathfinder. A robot's gate status comes ONLY from recorded gate
  runs stored in its entry; a robot with no runs is NOT_GATED, never
  badged green. Every robot also carries a classification from the
  ONE taxonomy tree (``MOBILITY_TAXONOMY``: mobility class + subtype,
  e.g. Ground — wheeled · Differential rover); the loader rejects any
  pair the tree does not name, and classes with no robots yet render
  as "none yet" — structure, never invented entries. The app's Robots
  pages are generated from this data by ``robotforge site`` (see
  site.py); never hand-edit them.

Zero dependencies. Data lives in the repo-root ``catalog/`` directory
(the examples/ folder holds robot *specs*; the catalog is its own
dataset).
Licences follow the project allowlist (MIT/Apache/BSD/CC-BY or a plain
physical part); every catalogue part carries licence + source.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path


def _catalog_dir() -> Path:
    """Locate the repo-root catalog/ data directory.

    ROBOTFORGE_CATALOG_DIR wins; otherwise the directory is resolved
    relative to this file (repo layout: src/robotforge/catalog.py ->
    ../../catalog), with the current directory as a last resort.
    """
    env = os.environ.get("ROBOTFORGE_CATALOG_DIR")
    if env:
        return Path(env)
    by_layout = Path(__file__).resolve().parents[2] / "catalog"
    if by_layout.is_dir():
        return by_layout
    return Path.cwd() / "catalog"


PARTS_DATA = _catalog_dir() / "parts.json"
ROBOTS_DATA = _catalog_dir() / "robots.json"

UNIVERSAL_CLASSES = (
    "power", "cables_connectors", "drivers", "microcontrollers", "sbc",
    "memory_storage", "comms", "cameras_sensors", "materials",
    "safety_protection", "custom_boards",
)
SIGNATURE_CLASSES = (
    "actuators", "wheels", "propulsion_air", "flight_control",
    "end_effectors", "structure",
)
PART_CLASSES = UNIVERSAL_CLASSES + SIGNATURE_CLASSES
LICENSE_ALLOWLIST = ("MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause",
                     "CC-BY-4.0", "CC-BY-SA-4.0", "proprietary-part")

GATE_STATUSES = ("PASS", "MARGINAL", "FAIL", "NOT_GATED")
ROBOT_SOURCES = ("my", "sighted", "photo", "researched")

# Non-gate evidence. A *check* is a computation recorded beside the gate
# status — never inside it: it cannot back a gate badge, change a gate
# status, or stand in for a run. Today there is one kind: the static
# stability check for legged robots (src/robotforge/stability.py).
CHECK_TYPES = ("static_stability",)
STABILITY_GRADES = ("STABLE", "MARGINAL", "UNSTABLE")

# The Robodex classification tree: mobility class -> its subtypes, in
# display order. This is the ONE home of the taxonomy — the loader
# validates every robot's (mobility_class, subtype) pair against it,
# and the site renders its class filters from it. A class with no
# robots yet is structure, not an entry: it shows as "none yet" and
# never invents a robot. Add a branch here and in a robot's data;
# nowhere else.
MOBILITY_TAXONOMY = (
    ("Aerial", ("Quadcopter", "Hexacopter", "Fixed-wing", "VTOL")),
    ("Ground — wheeled", ("Differential rover", "Skid-steer rover",
                          "Mecanum rover", "Car-like")),
    ("Ground — tracked", ("Tracked rover",)),
    ("Legged", ("Quadruped", "Humanoid", "Biped")),
    ("Marine", ("Surface", "Underwater")),
    ("Stationary", ("Robotic arm", "Gantry")),
)
MOBILITY_CLASSES = tuple(cls for cls, _ in MOBILITY_TAXONOMY)


def mobility_subtypes(mobility_class: str) -> tuple:
    """The subtypes a mobility class allows (empty tuple if unknown)."""
    for cls, subs in MOBILITY_TAXONOMY:
        if cls == mobility_class:
            return subs
    return ()


class CatalogError(ValueError):
    """Raised for unknown parts/classes/robots or malformed data."""


# --------------------------------------------------------------------------
# parts catalogue (ported from feature/catalogue-classes)
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class CatalogPart:
    id: str
    name: str
    part_class: str
    specs: dict
    license: str
    source: str
    blurb: str = ""
    used_for: str = ""
    robot_types: tuple = ()
    notes: str = ""
    buy: str | None = None
    image: str = ""  # repo-relative illustration path (assets/img/parts/…)

    @classmethod
    def from_dict(cls, d: dict) -> "CatalogPart":
        if d["part_class"] not in PART_CLASSES:
            raise CatalogError(f"{d.get('id')}: unknown part class "
                               f"{d['part_class']!r}")
        if d["license"] not in LICENSE_ALLOWLIST:
            raise CatalogError(f"{d.get('id')}: licence {d['license']!r} "
                               "not on the project allowlist")
        return cls(id=d["id"], name=d["name"], part_class=d["part_class"],
                   specs=dict(d.get("specs", {})), license=d["license"],
                   source=d["source"],
                   blurb=str(d.get("blurb", "")),
                   used_for=str(d.get("used_for", "")),
                   robot_types=tuple(d.get("robot_types", ())),
                   notes=str(d.get("notes", "")),
                   buy=d.get("buy"),
                   image=str(d.get("image", "")))

    def to_dict(self) -> dict:
        d = {"id": self.id, "name": self.name,
             "part_class": self.part_class, "specs": self.specs,
             "license": self.license, "source": self.source,
             "blurb": self.blurb, "used_for": self.used_for,
             "robot_types": list(self.robot_types),
             "notes": self.notes, "buy": self.buy}
        if self.image:
            d["image"] = self.image
        return d


@dataclass(frozen=True)
class RobotClassTemplate:
    name: str
    label: str
    gate_pack: str  # "live" | "partial" | "roadmap"
    required: dict  # part_id -> count for a complete build
    optional: tuple = ()

    @classmethod
    def from_dict(cls, d: dict) -> "RobotClassTemplate":
        return cls(name=d["name"], label=d["label"],
                   gate_pack=d["gate_pack"],
                   required={k: int(v) for k, v in d["required"].items()},
                   optional=tuple(d.get("optional", ())))


@dataclass
class AssessmentLine:
    part_id: str
    needed: int
    on_hand: int

    @property
    def missing(self) -> int:
        return max(0, self.needed - self.on_hand)

    @property
    def spares(self) -> int:
        return max(0, self.on_hand - self.needed)

    @property
    def virtual(self) -> int:
        """Missing units the sim model may borrow from the catalogue."""
        return self.missing


@dataclass
class Assessment:
    template: RobotClassTemplate
    lines: list  # of AssessmentLine, template order
    extras: dict = field(default_factory=dict)  # on-hand parts not in BOM

    @property
    def complete(self) -> bool:
        return all(line.missing == 0 for line in self.lines)

    def summary_lines(self) -> list:
        t = self.template
        out = [f"robot class: {t.label} (motion gate pack: {t.gate_pack})"]
        for line in self.lines:
            out.append(
                f"{line.part_id}: needed {line.needed}, "
                f"on hand {line.on_hand}, missing {line.missing}, "
                f"virtual fill {line.virtual}, spares {line.spares}")
        for pid, n in sorted(self.extras.items()):
            out.append(f"{pid}: not in this class BOM — {n} on hand (spares)")
        virt = sum(line.virtual for line in self.lines)
        if virt:
            out.append(f"NOTE: sim model may be built with {virt} virtual "
                       "part(s); virtual parts are never on hand.")
        out.append("verdict: " + ("COMPLETE — every needed part is on hand"
                                  if self.complete else
                                  "INCOMPLETE — see missing counts"))
        return out


class Catalog:
    def __init__(self, parts: dict, templates: dict):
        self.parts = parts          # id -> CatalogPart
        self.templates = templates  # name -> RobotClassTemplate

    @classmethod
    def load(cls, path: Path = PARTS_DATA) -> "Catalog":
        raw = json.loads(Path(path).read_text())
        parts = {}
        for d in raw["parts"]:
            part = CatalogPart.from_dict(d)
            if part.id in parts:
                raise CatalogError(f"duplicate part id {part.id}")
            parts[part.id] = part
        templates = {}
        for d in raw["templates"]:
            t = RobotClassTemplate.from_dict(d)
            for pid in list(t.required) + list(t.optional):
                if pid not in parts:
                    raise CatalogError(
                        f"template {t.name} references unknown part {pid}")
            templates[t.name] = t
        return cls(parts, templates)

    def assess(self, template_name: str, on_hand: dict) -> Assessment:
        """Diff an on-hand inventory against a robot class's BOM."""
        if template_name not in self.templates:
            raise CatalogError(f"unknown robot class {template_name!r}")
        for pid in on_hand:
            if pid not in self.parts:
                raise CatalogError(f"unknown part {pid!r} in inventory")
        t = self.templates[template_name]
        lines = [AssessmentLine(pid, need, int(on_hand.get(pid, 0)))
                 for pid, need in t.required.items()]
        extras = {pid: int(n) for pid, n in on_hand.items()
                  if pid not in t.required and n > 0}
        return Assessment(template=t, lines=lines, extras=extras)

    def find_part(self, query: str) -> CatalogPart:
        """Resolve a part by id, exact name, or unique name fragment."""
        q = query.strip().lower()
        pid = re.sub(r"[\s\-]+", "_", q)
        if pid in self.parts:
            return self.parts[pid]
        exact = [p for p in self.parts.values() if p.name.lower() == q]
        if len(exact) == 1:
            return exact[0]
        hits = [p for p in self.parts.values()
                if q in p.name.lower() or q in p.id]
        if len(hits) == 1:
            return hits[0]
        if hits:
            names = ", ".join(sorted(p.id for p in hits))
            raise CatalogError(f"part {query!r} is ambiguous — matches: "
                               f"{names}")
        raise CatalogError(f"unknown part {query!r} — try `robotforge "
                           "catalog` for the full list")


# --------------------------------------------------------------------------
# Robodex (numbered robot index)
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class GateRun:
    drive_error_pct: float
    heading_error_deg: float | None
    odometry_distance_error_pct: float | None
    odometry_heading_error_deg: float | None
    transport: str | None
    source: str

    @classmethod
    def from_dict(cls, d: dict) -> "GateRun":
        return cls(drive_error_pct=float(d["drive_error_pct"]),
                   heading_error_deg=d.get("heading_error_deg"),
                   odometry_distance_error_pct=d.get(
                       "odometry_distance_error_pct"),
                   odometry_heading_error_deg=d.get(
                       "odometry_heading_error_deg"),
                   transport=d.get("transport"),
                   source=str(d.get("source", "")))


@dataclass(frozen=True)
class GateStatus:
    status: str  # one of GATE_STATUSES
    runs: tuple = ()  # of GateRun
    note: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "GateStatus":
        status = str(d["status"])
        if status not in GATE_STATUSES:
            raise CatalogError(f"gate status {status!r} not in "
                               f"{GATE_STATUSES}")
        runs = tuple(GateRun.from_dict(r) for r in d.get("runs", ()))
        if status != "NOT_GATED" and not runs:
            raise CatalogError("a gated status requires recorded runs — "
                               "a badge without a run is not allowed")
        if status == "NOT_GATED" and runs:
            raise CatalogError("NOT_GATED with recorded runs is "
                               "contradictory — record the real verdict")
        return cls(status=status, runs=runs, note=str(d.get("note", "")))


@dataclass(frozen=True)
class RobotCheck:
    """A recorded non-gate check (see CHECK_TYPES). Deliberately NOT a
    GateRun: it carries a computation's grade, not a simulation run's
    measurements, and the loader keeps the two in separate fields so a
    check can never be mistaken for — or dressed up as — a gate run."""
    type: str
    date: str
    report: str  # repo-relative path to the check's JSON report
    grade: str
    tip_angle_deg: float
    weakest_margin_mm: float
    weakest_direction: str

    @classmethod
    def from_dict(cls, d: dict, *, robot_name: str,
                  mobility_class: str) -> "RobotCheck":
        ctype = str(d.get("type", ""))
        if ctype not in CHECK_TYPES:
            raise CatalogError(f"{robot_name}: unknown check type "
                               f"{ctype!r} — known types: {CHECK_TYPES}")
        if mobility_class != "Legged":
            raise CatalogError(
                f"{robot_name}: a {ctype} check belongs to a legged "
                f"robot, not {mobility_class!r} — checks are recorded "
                "only where the check actually applies")
        grade = str(d.get("grade", ""))
        if grade not in STABILITY_GRADES:
            raise CatalogError(f"{robot_name}: check grade {grade!r} "
                               f"not in {STABILITY_GRADES}")
        if not str(d.get("report", "")):
            raise CatalogError(f"{robot_name}: a check without its "
                               "report path is a claim without evidence")
        if not str(d.get("date", "")):
            raise CatalogError(f"{robot_name}: a check needs its date")
        return cls(type=ctype, date=str(d["date"]),
                   report=str(d["report"]), grade=grade,
                   tip_angle_deg=float(d["tip_angle_deg"]),
                   weakest_margin_mm=float(d["weakest_margin_mm"]),
                   weakest_direction=str(d.get("weakest_direction", "")))

    def to_dict(self) -> dict:
        return {"type": self.type, "date": self.date,
                "report": self.report, "grade": self.grade,
                "tip_angle_deg": self.tip_angle_deg,
                "weakest_margin_mm": self.weakest_margin_mm,
                "weakest_direction": self.weakest_direction}


@dataclass(frozen=True)
class RobotEntry:
    number: int
    name: str
    robot_class: str
    description: str
    key_specs: dict
    spec_file: str | None
    provenance: dict
    gate_status: GateStatus
    source: str
    mobility_class: str = ""
    subtype: str = ""
    image_url: str | None = None
    image_credit: str = ""
    checks: tuple = ()  # of RobotCheck — non-gate evidence, kept apart

    def static_check(self) -> RobotCheck | None:
        """The recorded static stability check, if this entry has one."""
        for c in self.checks:
            if c.type == "static_stability":
                return c
        return None

    @property
    def dex_id(self) -> str:
        return f"#{self.number:03d}"

    @property
    def class_path(self) -> str:
        """Taxonomy path, e.g. 'Ground — wheeled · Differential rover'."""
        return f"{self.mobility_class} · {self.subtype}"

    @classmethod
    def from_dict(cls, d: dict) -> "RobotEntry":
        mobility_class = str(d.get("mobility_class", ""))
        subtype = str(d.get("subtype", ""))
        source = str(d.get("source", ""))
        if source not in ROBOT_SOURCES:
            raise CatalogError(
                f"{d.get('name')}: source {source!r} is not one of "
                f"{ROBOT_SOURCES}")
        if mobility_class not in MOBILITY_CLASSES:
            raise CatalogError(
                f"{d.get('name')}: unknown mobility class "
                f"{mobility_class!r} — the taxonomy lives in "
                "MOBILITY_TAXONOMY (catalog.py)")
        if subtype not in mobility_subtypes(mobility_class):
            raise CatalogError(
                f"{d.get('name')}: subtype {subtype!r} is not a "
                f"{mobility_class} subtype in MOBILITY_TAXONOMY")
        checks = tuple(
            RobotCheck.from_dict(c, robot_name=str(d.get("name")),
                                 mobility_class=mobility_class)
            for c in d.get("checks", ()))
        return cls(number=int(d["number"]), name=str(d["name"]),
                   robot_class=str(d["class"]),
                   description=str(d["description"]),
                   key_specs=dict(d.get("key_specs", {})),
                   spec_file=d.get("spec_file"),
                   provenance=dict(d.get("provenance", {})),
                   gate_status=GateStatus.from_dict(d["gate_status"]),
                   source=source,
                   mobility_class=mobility_class,
                   subtype=subtype,
                   image_url=d.get("image_url"),
                   image_credit=str(d.get("image_credit", "")),
                   checks=checks)

    def to_dict(self) -> dict:
        d = {"number": self.number, "name": self.name,
                "class": self.robot_class,
                "source": self.source,
                "description": self.description,
                "key_specs": self.key_specs,
                "mobility_class": self.mobility_class,
                "spec_file": self.spec_file,
                "subtype": self.subtype,
                "provenance": self.provenance,
                "gate_status": {
                    "status": self.gate_status.status,
                    "runs": [{"drive_error_pct": r.drive_error_pct,
                              "heading_error_deg": r.heading_error_deg,
                              "odometry_distance_error_pct":
                                  r.odometry_distance_error_pct,
                              "odometry_heading_error_deg":
                                  r.odometry_heading_error_deg,
                              "transport": r.transport,
                              "source": r.source}
                             for r in self.gate_status.runs],
                    "note": self.gate_status.note}}
        if self.image_url:
            d["image_url"] = self.image_url
            d["image_credit"] = self.image_credit
        if self.checks:
            d["checks"] = [c.to_dict() for c in self.checks]
        return d


class Robodex:
    def __init__(self, title: str, robots: list):
        self.title = title
        self.robots = robots  # of RobotEntry, sorted by number

    @classmethod
    def load(cls, path: Path = ROBOTS_DATA) -> "Robodex":
        raw = json.loads(Path(path).read_text())
        robots = [RobotEntry.from_dict(d) for d in raw["robots"]]
        numbers = [r.number for r in robots]
        if len(set(numbers)) != len(numbers):
            raise CatalogError("duplicate Robodex numbers")
        robots.sort(key=lambda r: r.number)
        return cls(title=str(raw.get("title", "Robodex")), robots=robots)

    def find(self, query: str) -> RobotEntry:
        """Resolve a robot by number ('3', '#003') or name fragment."""
        q = query.strip().lower()
        m = re.fullmatch(r"#?0*(\d+)", q)
        if m:
            num = int(m.group(1))
            for r in self.robots:
                if r.number == num:
                    return r
            raise CatalogError(f"no Robodex entry #{num:03d}")
        exact = [r for r in self.robots if r.name.lower() == q]
        if len(exact) == 1:
            return exact[0]
        hits = [r for r in self.robots if q in r.name.lower()]
        if len(hits) == 1:
            return hits[0]
        if hits:
            names = ", ".join(f"{r.dex_id} {r.name}" for r in hits)
            raise CatalogError(f"robot {query!r} is ambiguous — matches: "
                               f"{names}")
        raise CatalogError(f"unknown robot {query!r} — try `robotforge "
                           "catalog` for the Robodex")


# --------------------------------------------------------------------------
# plain-text formatting for the CLI
# --------------------------------------------------------------------------

def gate_badge(status: str) -> str:
    """Short text badge. A badge exists only as good as its runs."""
    return {"PASS": "GATE: PASS", "MARGINAL": "GATE: MARGINAL",
            "FAIL": "GATE: FAIL", "NOT_GATED": "not gated yet"}[status]


def static_check_badge(check: RobotCheck) -> str:
    """Text badge for a static stability check — worded so it can never
    be read as a gate verdict."""
    return (f"STATIC CHECK: {check.grade} "
            f"(tip margin {check.tip_angle_deg:.0f}°)")


def _run_line(r: GateRun) -> str:
    parts = [f"drive error {r.drive_error_pct:.3f}%"]
    if r.heading_error_deg is not None:
        parts.append(f"turn error {r.heading_error_deg:.3f} deg")
    if r.odometry_distance_error_pct is not None:
        parts.append(f"odometry distance error "
                     f"{r.odometry_distance_error_pct:.3f}%")
    if r.odometry_heading_error_deg is not None:
        parts.append(f"odometry heading error "
                     f"{r.odometry_heading_error_deg:.3f} deg")
    if r.transport:
        parts.append(f"transport: {r.transport}")
    line = " · ".join(parts)
    if r.source:
        line += f"\n      source: {r.source}"
    return line


def format_catalog_summary(cat: Catalog, dex: Robodex) -> str:
    out = ["Robodex — the RobotForge robot index"]
    for r in dex.robots:
        out.append(f"  {r.dex_id} {r.name} — {r.robot_class} "
                   f"[{gate_badge(r.gate_status.status)}]")
    classes = sorted({p.part_class for p in cat.parts.values()})
    out.append("")
    out.append(f"Parts catalog: {len(cat.parts)} parts in "
               f"{len(classes)} classes; {len(cat.templates)} robot-class "
               "templates (BOMs).")
    out.append("Look one up:  robotforge catalog robot <number-or-name>")
    out.append("              robotforge catalog part <name-or-id>")
    return "\n".join(out)


def format_robot(r: RobotEntry) -> str:
    out = [f"{r.dex_id} {r.name}", f"class: {r.robot_class}",
           f"type: {r.class_path}", "",
           r.description, "", "key specs:"]
    for k, v in r.key_specs.items():
        out.append(f"  {k}: {v}")
    prov = r.provenance
    out += ["", "provenance:",
            f"  source: {prov.get('source_name', '')}"]
    if prov.get("source_url"):
        out.append(f"  url: {prov['source_url']}")
    if prov.get("license"):
        out.append(f"  license: {prov['license']}")
    if prov.get("note"):
        out.append(f"  note: {prov['note']}")
    if r.spec_file:
        out.append(f"  spec file: {r.spec_file}")
    gs = r.gate_status
    out += ["", f"gate status: {gate_badge(gs.status)}"]
    for run in gs.runs:
        out.append(f"  - {_run_line(run)}")
    if gs.note:
        out.append(f"  note: {gs.note}")
    for c in r.checks:
        out += ["", f"check: static stability — {c.grade} "
                f"(tip angle {c.tip_angle_deg:.1f}°, weakest margin "
                f"{c.weakest_margin_mm:.0f} mm {c.weakest_direction})",
                "  a computation from the spec, not a gate run; the "
                "gate status above is unchanged by it",
                f"  report: {c.report} ({c.date})"]
    return "\n".join(out)


def format_part(p: CatalogPart) -> str:
    out = [p.name, f"id: {p.id} · class: {p.part_class}", ""]
    if p.blurb:
        out += [p.blurb, ""]
    if p.used_for:
        out.append(f"used for: {p.used_for}")
    if p.robot_types:
        out.append(f"found on: {', '.join(p.robot_types)}")
    if p.specs:
        out.append("specs:")
        for k, v in p.specs.items():
            out.append(f"  {k}: {v}")
    if p.notes:
        out += ["", f"notes: {p.notes}"]
    out += ["", f"source: {p.source}", f"license: {p.license}",
            "buy: " + (p.buy if p.buy else
                       "not set — shop links are a deliberate later step")]
    return "\n".join(out)


def _demo() -> None:
    """Abel's scenario: a skid-steer rover with only 2 of 4 motors logged."""
    cat = Catalog.load()
    a = cat.assess("rover_skid_steer", {
        "gearmotor_12v": 2, "wheel_100mm": 6, "driver_tb6612fng": 1,
        "lipo_4s_5200": 1, "esp32_devkit": 1, "fuse_inline": 1,
    })
    print("\n".join(a.summary_lines()))


if __name__ == "__main__":
    _demo()
