"""Parts catalogue, robot-class templates, and build inventory.

The registry (schema.py) describes ONE robot. This module is the layer
around it that Abel specified on 2026-10-26:

- A **catalogue** of real parts, split into UNIVERSAL part classes (every
  robot needs power, cables, compute, comms, sensors, materials, safety)
  and SIGNATURE classes (what makes a robot type a type: propellers for a
  quadcopter, joint servos for a humanoid, a gripper for an arm).
- **Robot-class templates**: a reference BOM per robot class (rover,
  RC car, quadcopter, humanoid, quadruped, arm). The template is what
  makes "what's missing?" and "figure out the rest" answerable — a pile
  of photographed parts is diffed against the class's complete shape.
- **Inventory assessment**: for each part — needed / on hand / missing /
  virtual / spares. Missing parts may be VIRTUAL-FILLED from the
  catalogue so a sim model can be built and gated today, but virtual
  parts exist only in simulation and never inflate the on-hand count.
  Every motion-gate pack is per-class; the assessment states plainly
  which pack a class has ("live" / "partial" / "roadmap").

Zero dependencies; data lives in catalog_data.json beside this file.
Licences follow the project allowlist (MIT/Apache/BSD/CC-BY); every
catalogue part carries licence + source, as the registry requires.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

_DATA = Path(__file__).with_name("catalog_data.json")

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


class CatalogError(ValueError):
    """Raised for unknown parts/classes or malformed catalogue data."""


@dataclass(frozen=True)
class CatalogPart:
    id: str
    name: str
    part_class: str
    specs: dict
    license: str
    source: str

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
                   source=d["source"])


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
    def load(cls, path: Path = _DATA) -> "Catalog":
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
