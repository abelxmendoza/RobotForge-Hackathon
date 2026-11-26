"""SimReady scene props for the motion gate.

NVIDIA's SimReady dataset (``nvidia/simready-assets`` on Hugging Face,
CC BY 4.0) already dresses the web kit scene — see
``catalog/props/simready/props.json``, whose honesty notes state
plainly that there the props are visual only and "nothing about them
is checked by the gate".

This module is the other half: it places the same recorded props into
the Gazebo gate world as STATIC collision geometry, so a gate run can
happen on a furnished floor instead of an empty plane. A drive path
that crosses a prop now physically meets it, and the gate judges the
measured motion that results — which is the point of an acceptance
gate.

Honesty, carried over from the kit scene's notes:

- The colliders are BOX proxies built from each asset's recorded
  bounding size (``size_m`` in props.json). The source packages'
  physics and material data do not transfer, and the gate-world visual
  is the same box — the detailed mesh lives in the web kit scene.
- ``size_m`` is recorded in the source's glTF order ``[x, y-up, z]``
  (the kit scene stands each prop on y=0). The SDF box maps it to
  ``[x, z, y-up]`` so each prop stands on the gate floor.
- Props are static scenery/obstacles. The gate's verdict still judges
  only the robot's motion against ground truth; a prop is never
  "checked" itself.

Zero dependencies; data is the existing props.json manifest.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from .catalog import _catalog_dir

PROPS_DATA = _catalog_dir() / "props" / "simready" / "props.json"
DATASET_URL = "https://huggingface.co/datasets/nvidia/simready-assets"


class SimReadyError(ValueError):
    """Raised for unknown props or malformed scene descriptions."""


@dataclass(frozen=True)
class SimReadyProp:
    id: str
    name: str
    size_m: tuple[float, float, float]  # glTF order: [x, y-up, z]
    source_url: str
    attribution: str

    @property
    def sdf_size(self) -> tuple[float, float, float]:
        """Box size in SDF order [x, y, z-up]: the recorded height
        (glTF y) becomes the SDF z extent."""
        x, up, z = self.size_m
        return (x, z, up)

    @property
    def height_m(self) -> float:
        return self.size_m[1]


@dataclass(frozen=True)
class ScenePlacement:
    prop_id: str
    x: float
    y: float
    yaw_deg: float = 0.0


def load_props(path: Path = PROPS_DATA) -> list[SimReadyProp]:
    try:
        doc = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise SimReadyError(f"SimReady manifest not found: {path}") from exc
    props = []
    for raw in doc.get("props", []):
        size = raw.get("size_m") or []
        if len(size) != 3:
            raise SimReadyError(
                f"prop {raw.get('id')!r} has no 3-axis size_m recorded")
        props.append(SimReadyProp(
            id=raw["id"], name=raw["name"],
            size_m=(float(size[0]), float(size[1]), float(size[2])),
            source_url=raw.get("source_url", DATASET_URL),
            attribution=raw.get("attribution", "")))
    if not props:
        raise SimReadyError(f"no props recorded in {path}")
    return props


def get_prop(prop_id: str,
             props: list[SimReadyProp] | None = None) -> SimReadyProp:
    for prop in (props if props is not None else load_props()):
        if prop.id == prop_id:
            return prop
    known = ", ".join(p.id for p in (props if props is not None
                                     else load_props()))
    raise SimReadyError(f"unknown SimReady prop {prop_id!r} (known: {known})")


def parse_scene(text: str,
                props: list[SimReadyProp] | None = None
                ) -> list[ScenePlacement]:
    """Parse ``id@x,y[,yaw_deg]; ...`` scene text into placements.

    Example: ``crate@1.5,0.5; scope@-1,2,90`` puts the crate at
    (1.5, 0.5) unrotated and the oscilloscope at (-1, 2) turned 90°.
    """
    props = props if props is not None else load_props()
    placements: list[ScenePlacement] = []
    for chunk in text.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "@" not in chunk:
            raise SimReadyError(
                f"scene entry {chunk!r} is missing '@' — "
                "expected id@x,y[,yaw_deg]")
        prop_id, _, coords = chunk.partition("@")
        prop_id = prop_id.strip()
        get_prop(prop_id, props)  # raises on an unknown id
        fields = [f.strip() for f in coords.split(",")]
        if len(fields) not in (2, 3):
            raise SimReadyError(
                f"scene entry {chunk!r} needs x,y[,yaw_deg] after '@'")
        try:
            values = [float(f) for f in fields]
        except ValueError as exc:
            raise SimReadyError(
                f"scene entry {chunk!r} has a non-numeric coordinate") from exc
        placements.append(ScenePlacement(
            prop_id=prop_id, x=values[0], y=values[1],
            yaw_deg=values[2] if len(values) == 3 else 0.0))
    if not placements:
        raise SimReadyError("scene text named no props")
    return placements


def placement_sdf(placement: ScenePlacement, index: int,
                  props: list[SimReadyProp] | None = None) -> str:
    """One static SDF model block for a placed prop (box proxy)."""
    prop = get_prop(placement.prop_id, props)
    sx, sy, sz = prop.sdf_size
    yaw = math.radians(placement.yaw_deg)
    return f'''    <model name="simready_{prop.id}_{index}">
      <static>true</static>
      <pose>{placement.x:g} {placement.y:g} {sz / 2.0:g} 0 0 {yaw:g}</pose>
      <link name="link">
        <collision name="c"><geometry><box><size>{sx:g} {sy:g} {sz:g}</size></box></geometry></collision>
        <visual name="v"><geometry><box><size>{sx:g} {sy:g} {sz:g}</size></box></geometry></visual>
      </link>
    </model>'''


def scene_sdf(placements: list[ScenePlacement],
              props: list[SimReadyProp] | None = None) -> str:
    """All placed props as SDF model blocks (empty string for none)."""
    if not placements:
        return ""
    props = props if props is not None else load_props()
    return "\n" + "\n".join(
        placement_sdf(p, i, props) for i, p in enumerate(placements)) + "\n"
