"""tools/realsense_scan.py: the camera parts need hardware, so these test
the pure pieces (depth crop, back-projection, the PLY it writes) and the
argument checks. The PLY is the same file the Workshop's scan view reads."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("realsense_scan", ROOT / "tools" / "realsense_scan.py")
rs = importlib.util.module_from_spec(spec)
sys.modules["realsense_scan"] = rs
spec.loader.exec_module(rs)


def test_crop_drops_floor_and_room() -> None:
    d = np.array([[0.1, 0.5, 2.0], [np.nan, 0.9, 1.0]], dtype=np.float32)
    out = rs.crop_depth(d, 0.15, 1.0)
    assert out.tolist() == [[0.0, 0.5, 0.0], [0.0, pytest.approx(0.9), 1.0]]
    assert np.isnan(d[1, 0])  # input left alone


def test_back_projection_matches_pinhole() -> None:
    d = np.zeros((4, 6), dtype=np.float32)
    d[2, 3] = 0.5  # the principal point -> straight ahead
    d[0, 5] = 1.0
    pts = rs.depth_to_points(d, fx=100, fy=100, cx=3, cy=2)
    assert pts.shape == (2, 3)
    assert pts[1].tolist() == pytest.approx([0.0, 0.0, 0.5])
    assert pts[0].tolist() == pytest.approx([0.02, -0.02, 1.0])


def test_ply_is_readable(tmp_path: Path) -> None:
    xyz = np.array([[0.0, 0.1, 0.5], [0.2, -0.1, 0.6]], dtype=np.float32)
    rgb = np.array([[255, 0, 0], [0, 128, 255]], dtype=np.uint8)
    path = tmp_path / "p.ply"
    rs.write_ply_points(path, xyz, rgb)
    raw = path.read_bytes()
    head, body = raw.split(b"end_header\n", 1)
    assert b"element vertex 2" in head and b"property uchar red" in head
    rec = np.frombuffer(body, dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
    # Flipped to y-up / facing the viewer.
    assert rec["y"].tolist() == pytest.approx([-0.1, 0.1])
    assert rec["z"].tolist() == pytest.approx([-0.5, -0.6])
    assert rec["g"].tolist() == [0, 128]


def test_arguments_are_checked() -> None:
    assert rs.main(["--out", "a.glb"]).far == 1.0
    for bad in (["--out", "a.stl"], ["--out", "a.glb", "--single"], ["--out", "a.ply", "--near", "2"]):
        with pytest.raises(SystemExit):
            rs.main(bad)


def test_documents_the_honest_limits() -> None:
    src = (ROOT / "tools" / "realsense_scan.py").read_text()
    assert "not its CAD" in src and "Apache-2.0" in src and "Open3D (MIT)" in src
