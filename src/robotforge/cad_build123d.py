"""Optional build123d back end for the take-apart CAD kit.

``robotforge cad`` defaults to the OpenSCAD kit in cad.py. With
``--engine build123d`` the same kit plan (same parts, same spec
dimensions, same labeled assumptions from cad.py) is rebuilt as real
solid geometry with build123d and exported per part as:

- ``parts/<part>.step`` — STEP, the CAD interchange format.
- ``parts/<part>.glb`` — binary glTF, for 3D viewers.
- ``build123d_manifest.json`` — per part: the spec dimensions the
  solid was checked against, the measured bounding box, and the
  solid's volume.

Every solid is validated before anything is written: it must be a
valid build123d solid and its bounding box must match the expected
spec dimensions (within ``TOLERANCE_MM``) — a mismatch raises
``CadDimensionError`` and no kit is written. The gate is the point:
a back end that quietly emits wrong-sized parts is worse than none.

build123d is an OPTIONAL dependency (``pip install
robotforge[build123d]``). It is imported lazily inside this module's
functions, never at module import time, so the default OpenSCAD path
— and the whole test suite — works without it installed.

Honest scope, same as cad.py: these solids are the same printable
*approximation* of the spec, not a manufacturing model — no
tolerances, fasteners, wiring or internal structure are claimed, and
values cad.py labels "assumption — not in the spec" are assumptions
here too. If the spec is a photo draft, its dimensions are estimates
and the manifest says so.

Reproducibility scope: the byte-identical claim in cad.py covers the
OpenSCAD ``.scad`` text only. STEP and GLB bytes are NOT promised
byte-identical across runs or build123d versions — the manifest's
measured dimensions are the checkable claim here, not the bytes.

Units: mm throughout, mirroring cad.py. (The GLB export converts to
glTF's metre scale internally; the manifest reports mm.)
"""
from __future__ import annotations

import importlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import cad as _cad
from .cad import PartInfo
from .schema import RobotSpec

TOLERANCE_MM = 0.05  # bbox-vs-spec gate: far below any real spec error (mm scale)


class CadBuildError(RuntimeError):
    """The build123d back end could not produce a trustworthy kit."""


class Build123dUnavailableError(CadBuildError):
    """build123d is not installed (it is an optional dependency)."""


class CadDimensionError(CadBuildError):
    """A generated solid's bounding box disagrees with the spec."""


def _load_build123d():
    try:
        return importlib.import_module("build123d")
    except ImportError as exc:
        raise Build123dUnavailableError(
            "build123d is not installed — it is an optional back end. "
            "Install it with: pip install 'robotforge[build123d]' "
            "(or use the default OpenSCAD engine)") from exc


# ---------------------------------------------------------------------------
# The dimension gate
def _validate_solid(name: str, solid: Any,
                    expected_mm: tuple[float, float, float]) -> tuple[float, float, float]:
    """Return the measured bbox (mm) or raise CadDimensionError loudly."""
    if not bool(solid.is_valid):
        raise CadDimensionError(f"{name}: build123d produced an invalid solid")
    size = solid.bounding_box().size
    measured = (float(size.X), float(size.Y), float(size.Z))
    for axis, got, want in zip("XYZ", measured, expected_mm):
        if abs(got - want) > TOLERANCE_MM:
            raise CadDimensionError(
                f"{name}: bounding box {axis} = {got:.3f} mm, spec says "
                f"{want:.3f} mm (tolerance {TOLERANCE_MM} mm) — refusing "
                f"to export a part that does not match its spec")
    if float(solid.volume) <= 0:
        raise CadDimensionError(f"{name}: solid has no volume")
    return measured


# ---------------------------------------------------------------------------
# Part builders. Each mirrors the cad.py part of the same name: same
# spec dimensions, same labeled assumption constants (imported from
# cad.py so the two engines can never drift apart on a number).
# Solids rest on z=0 in a natural print pose, like the .scad parts.
def _chassis_plate(b, spec: RobotSpec):
    L = spec.length_m * 1000.0
    W = spec.width_m * 1000.0
    T = _cad.PLATE_THICKNESS_MM
    inset = _cad.MOUNT_HOLE_INSET_MM
    corners = [(sx * (L / 2 - inset), sy * (W / 2 - inset))
               for sx in (-1, 1) for sy in (-1, 1)]
    with b.BuildPart() as part:
        with b.BuildSketch(b.Plane.XY):
            b.RectangleRounded(L, W, _cad.CORNER_RADIUS_MM)
            with b.Locations(*[b.Location((x, y)) for x, y in corners]):
                b.Circle(_cad.MOUNT_HOLE_D_MM / 2, mode=b.Mode.SUBTRACT)
        b.extrude(amount=T)
    return part.part, (L, W, T)


def _wheel(b, spec: RobotSpec):
    d = spec.wheel.diameter_m * 1000.0
    w = spec.wheel.width_m * 1000.0
    hub_d = round(d * 0.4, 1)                       # cad.py: derived, 0.4 x diameter
    light_r = d * 0.32                              # cad.py lightening-hole ring
    light_d = max(4.0, round(d * 0.12, 1))          # cad.py: derived
    # The POC's parametric wheel (hub, centre bore, lightening holes),
    # minus its proud tread blocks: tread would push the bounding box
    # past the spec diameter, and this back end's gate is bbox == spec.
    wheel = b.Pos(0, 0, w / 2) * b.Cylinder(radius=d / 2, height=w)
    wheel += b.Pos(0, 0, w / 2) * b.Cylinder(radius=hub_d / 2, height=w * 0.9)
    wheel -= b.Pos(0, 0, w / 2) * b.Cylinder(
        radius=_cad.SHAFT_D_MM / 2, height=w * 1.4)
    for loc in b.PolarLocations(radius=light_r, count=4):
        wheel -= b.Pos(0, 0, w / 2) * loc * b.Cylinder(
            radius=light_d / 2, height=w * 1.4)
    return wheel, (d, d, w)


def _motor_mount(b, spec: RobotSpec):
    r_mm = spec.wheel.diameter_m * 1000.0 / 2.0
    w_mm = spec.wheel.width_m * 1000.0
    mount_w = w_mm + 16.0                           # cad.py: derived
    mount_h = max(r_mm + _cad.SHAFT_D_MM / 2.0 + 8.0,
                  spec.ground_clearance_m * 1000.0
                  + _cad.PLATE_THICKNESS_MM + 8.0)  # cad.py: derived
    t = _cad.PLATE_THICKNESS_MM
    flange_depth = 16.0                             # cad.py: assumption
    solid = b.Pos(0, t / 2, mount_h / 2) * b.Box(mount_w, t, mount_h)
    solid += b.Pos(0, -flange_depth / 2, t / 2) * b.Box(mount_w, flange_depth, t)
    # Motor shaft hole, through the plate at axle height.
    solid -= b.Pos(0, 0, r_mm) * b.Rot(90, 0, 0) * b.Cylinder(
        radius=(_cad.SHAFT_D_MM + 0.4) / 2, height=t + 4)
    # Two flange bolt holes.
    for sx in (-1, 1):
        solid -= b.Pos(sx * mount_w / 4, -flange_depth / 2, t / 2) * \
            b.Cylinder(radius=_cad.MOUNT_HOLE_D_MM / 2, height=t + 2)
    return solid, (mount_w, t + flange_depth, mount_h)


def _caster(b, spec: RobotSpec):
    ball_d = spec.ground_clearance_m * 1000.0
    stem_h = _cad.PLATE_THICKNESS_MM + 6.0          # cad.py: derived
    stem_d = max(8.0, ball_d * 0.5)                 # cad.py: derived
    solid = b.Pos(0, 0, ball_d / 2) * b.Sphere(radius=ball_d / 2)
    solid += b.Pos(0, 0, ball_d * 0.7 + stem_h / 2) * b.Cylinder(
        radius=stem_d / 2, height=stem_h)
    expected = (max(ball_d, stem_d), max(ball_d, stem_d),
                max(ball_d, ball_d * 0.7 + stem_h))
    return solid, expected


def _lidar_mount(b, spec: RobotSpec):
    post_h = spec.height_m * 1000.0 - _cad.PLATE_THICKNESS_MM - 6.0
    disc_t = 3.0                                    # cad.py: assumption
    d = _cad.LIDAR_DISC_D_MM
    solid = b.Pos(0, 0, disc_t / 2) * b.Cylinder(radius=d * 0.7 / 2, height=disc_t)
    solid += b.Pos(0, 0, disc_t + post_h / 2) * b.Cylinder(
        radius=_cad.POST_D_MM / 2, height=post_h)
    solid += b.Pos(0, 0, disc_t + post_h + disc_t / 2) * b.Cylinder(
        radius=d / 2, height=disc_t)
    return solid, (d, d, post_h + 2 * disc_t)


def _camera_bracket(b, spec: RobotSpec):
    W, H, t = _cad.CAM_BRACKET_W_MM, _cad.CAM_BRACKET_H_MM, 3.0
    foot_depth = 20.0                               # cad.py: assumption
    solid = b.Pos(0, t / 2, H / 2) * b.Box(W, t, H)
    solid += b.Pos(0, foot_depth / 2, t / 2) * b.Box(W, foot_depth, t)
    solid -= b.Pos(0, t / 2, H * 0.65) * b.Rot(90, 0, 0) * b.Cylinder(
        radius=_cad.LENS_HOLE_D_MM / 2, height=t + 2)
    return solid, (W, foot_depth, H)


def _ultrasonic_bracket(b, spec: RobotSpec):
    W, H, t = _cad.ULTRA_PLATE_W_MM, _cad.ULTRA_PLATE_H_MM, 3.0
    can_len = 12.0                                  # cad.py: assumption
    solid = b.Pos(0, t / 2, H / 2) * b.Box(W, t, H)
    for sx in (-1, 1):
        solid += b.Pos(sx * _cad.ULTRA_CAN_SPACING_MM / 2,
                       t + can_len / 2, H / 2) * b.Rot(90, 0, 0) * \
            b.Cylinder(radius=_cad.ULTRA_CAN_D_MM / 2, height=can_len)
    return solid, (W, t + can_len, H)


_BUILDERS = {
    "chassis_plate": _chassis_plate,
    "wheel": _wheel,
    "motor_mount": _motor_mount,
    "caster": _caster,
    "lidar_mount": _lidar_mount,
    "camera_bracket": _camera_bracket,
    "ultrasonic_bracket": _ultrasonic_bracket,
}


# ---------------------------------------------------------------------------
@dataclass
class CadPartExport:
    info: PartInfo
    step_file: str          # kit-relative, e.g. "parts/wheel.step"
    glb_file: str           # kit-relative, e.g. "parts/wheel.glb"
    expected_bbox_mm: tuple[float, float, float]
    measured_bbox_mm: tuple[float, float, float]
    volume_mm3: float
    solid: Any = field(repr=False, compare=False)


def build_parts(spec: RobotSpec) -> list[CadPartExport]:
    """Build + dimension-check every part in the cad.py kit plan.

    Raises Build123dUnavailableError if build123d is not installed and
    CadDimensionError on the first part whose solid disagrees with
    its spec dimensions. Nothing is written to disk here.
    """
    b = _load_build123d()
    exports: list[CadPartExport] = []
    for info, _scad in _cad._plan(spec):
        stem = Path(info.filename).stem
        builder = _BUILDERS.get(stem)
        if builder is None:
            raise CadBuildError(
                f"no build123d builder for kit part '{stem}' "
                f"({info.filename}) — the plan and the back end disagree")
        solid, expected = builder(b, spec)
        measured = _validate_solid(info.name, solid, expected)
        exports.append(CadPartExport(
            info=info,
            step_file=f"parts/{stem}.step",
            glb_file=f"parts/{stem}.glb",
            expected_bbox_mm=tuple(float(v) for v in expected),
            measured_bbox_mm=measured,
            volume_mm3=float(solid.volume),
            solid=solid,
        ))
    return exports


def write_kit_build123d(spec: RobotSpec, out_dir: Path) -> list[CadPartExport]:
    """Build, validate, then export STEP + GLB per part, plus a
    manifest recording the measured dimensions. Exports happen only
    after every part has passed the dimension gate."""
    b = _load_build123d()
    exports = build_parts(spec)
    parts_dir = out_dir / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    for exp in exports:
        step_path = out_dir / exp.step_file
        glb_path = out_dir / exp.glb_file
        if not b.export_step(exp.solid, str(step_path)):
            raise CadBuildError(f"{exp.info.name}: STEP export failed")
        if not b.export_gltf(exp.solid, str(glb_path), binary=True):
            raise CadBuildError(f"{exp.info.name}: GLB export failed")
        for path in (step_path, glb_path):
            if not path.is_file() or path.stat().st_size == 0:
                raise CadBuildError(
                    f"{exp.info.name}: export {path.name} is missing or empty")
    estimated = _cad.is_estimated(spec)
    manifest = {
        "robot": spec.name,
        "engine": "build123d",
        "units": "mm",
        "estimated": estimated,
        "scope": (
            "Printable approximation of the spec, same scope as the "
            "OpenSCAD kit: no tolerances, fasteners, wiring or internal "
            "structure claimed. Assumption values are cad.py's labeled "
            "assumptions. STEP/GLB bytes are not promised byte-identical "
            "across runs or build123d versions; the measured dimensions "
            "below are the checkable claim."),
        "parts": [
            {
                "name": exp.info.name,
                "quantity": exp.info.qty,
                "step": exp.step_file,
                "glb": exp.glb_file,
                "expected_bbox_mm": [round(v, 3) for v in exp.expected_bbox_mm],
                "measured_bbox_mm": [round(v, 3) for v in exp.measured_bbox_mm],
                "volume_mm3": round(exp.volume_mm3, 1),
            }
            for exp in exports
        ],
    }
    if estimated:
        manifest["warning"] = (
            "ESTIMATED — this kit was drafted from a photo; every "
            "dimension is an estimate, not a measurement.")
    (out_dir / "build123d_manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n")
    return exports
