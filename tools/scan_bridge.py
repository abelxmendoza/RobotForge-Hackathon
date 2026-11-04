#!/usr/bin/env python3
"""RobotForge Scan Studio bridge: a small local server between an Intel
RealSense depth camera and the Scan Studio page (/scan/).

A browser tab cannot read a RealSense depth stream (there is no shipped
web API for it), so this bridge runs on the computer the camera is
plugged into. It reads aligned depth + colour + intrinsics through
librealsense, serves a live preview over http://127.0.0.1 only, records
a walk-around session, and fuses it into one scan with measured
dimensions. Nothing leaves your computer.

Open-source pieces:
  * librealsense / pyrealsense2 (Apache-2.0): talks to the camera.
  * Open3D (MIT): RGB-D odometry between frames and TSDF fusion into a
    colour mesh. Optional in --simulate mode (numpy point fusion is used
    when Open3D is missing); required to build from a real camera.
  * numpy: everything else, including the measurements.

Run:
    pip install numpy pyrealsense2 open3d
    python3 tools/scan_bridge.py              # real camera
    python3 tools/scan_bridge.py --simulate   # no camera: a synthetic robot
Then open Scan Studio in RobotForge and press Connect.

--simulate renders a synthetic test rover (not Omega1) on a floor, seen
by a virtual depth camera circling it, with about 1 mm of depth noise.
Its true size is known, so the whole pipeline (streaming, recording,
fusion, floor removal, measuring) can be checked against ground truth
without hardware. tests/test_scan_bridge.py does exactly that.

Honest limits: sizes from a real camera are only as good as the camera
(RealSense D400 depth error is about 2% of range, so roughly +/-10 mm at
0.5 m). The mesh is a colour-textured surface from the camera's own
RGB + depth, not photogrammetry; every captured frame is saved in the
session folder so a heavier pass (e.g. COLMAP) can run on it later.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import re
import sys
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

DEFAULT_PORT = 8765
ALLOWED_ORIGINS = [
    re.compile(r"^https://robot-forge-hackathon(-[a-z0-9-]+)?\.vercel\.app$"),
    re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"),
]
RANGE_ACCURACY = 0.02
# Measurements ignore the outermost 0.2% of points at each end: a few
# stray depth samples (flying pixels at edges) must not set the size.
TRIM = 0.002  # RealSense D400: depth RMS error ~2% of range


# ----- the simulated scene ---------------------------------------------------
# World frame: metres, y up, floor at y = 0. Boxes are (min xyz, max xyz, rgb).
SIM_BOXES: list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[int, int, int]]] = [
    ((-0.120, 0.040, -0.080), (0.120, 0.100, 0.080), (214, 120, 40)),   # chassis
    ((-0.110, 0.000, 0.080), (-0.050, 0.065, 0.100), (40, 40, 44)),     # wheels
    ((0.050, 0.000, 0.080), (0.110, 0.065, 0.100), (40, 40, 44)),
    ((-0.110, 0.000, -0.100), (-0.050, 0.065, -0.080), (40, 40, 44)),
    ((0.050, 0.000, -0.100), (0.110, 0.065, -0.080), (40, 40, 44)),
    ((-0.020, 0.100, -0.020), (0.020, 0.180, 0.020), (150, 150, 160)),  # mast
    ((-0.040, 0.180, -0.030), (0.040, 0.210, 0.030), (60, 110, 200)),   # sensor head
]
SIM_TRUTH_MM = {"length": 240.0, "width": 200.0, "height": 210.0}
SIM_TARGET = np.array([0.0, 0.09, 0.0])


@dataclass
class Intrinsics:
    width: int
    height: int
    fx: float
    fy: float
    cx: float
    cy: float

    def as_dict(self) -> dict:
        return {"width": self.width, "height": self.height, "fx": self.fx, "fy": self.fy, "cx": self.cx, "cy": self.cy}


SIM_INTR = Intrinsics(320, 240, 290.0, 290.0, 159.5, 119.5)


def look_at(eye: np.ndarray, target: np.ndarray, up=(0.0, 1.0, 0.0)) -> np.ndarray:
    """Camera-to-world pose (4x4) for a camera at `eye` looking at
    `target`. Camera axes follow RealSense: x right, y down, z forward."""
    f = target - eye
    f = f / np.linalg.norm(f)
    x = np.cross(f, np.asarray(up, dtype=float))
    x = x / np.linalg.norm(x)
    y = np.cross(f, x)
    pose = np.eye(4)
    pose[:3, 0], pose[:3, 1], pose[:3, 2], pose[:3, 3] = x, y, f, eye
    return pose


def sim_pose(k: int, frames_per_orbit: int = 90) -> np.ndarray:
    """The virtual camera circles the rover at ~0.55 m, rising and
    falling between two heights like a person walking around it."""
    a = 2 * math.pi * k / frames_per_orbit
    eye = np.array([0.55 * math.cos(a), 0.30 + 0.10 * math.sin(2 * a), 0.55 * math.sin(a)])
    return look_at(eye, SIM_TARGET)


def render_sim(pose: np.ndarray, intr: Intrinsics = SIM_INTR, noise_m: float = 0.001,
               rng: np.random.Generator | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Ray-cast the scene: depth in metres (z distance, 0 = no return)
    and an RGB image, like one aligned RealSense frame."""
    h, w = intr.height, intr.width
    us, vs = np.meshgrid(np.arange(w, dtype=np.float64), np.arange(h, dtype=np.float64))
    dc = np.stack([(us - intr.cx) / intr.fx, (vs - intr.cy) / intr.fy, np.ones_like(us)], axis=-1).reshape(-1, 3)
    R, o = pose[:3, :3], pose[:3, 3]
    d = dc @ R.T  # world direction per pixel, scaled so t == camera depth
    n = d.shape[0]
    best = np.full(n, np.inf)
    col = np.zeros((n, 3))
    with np.errstate(divide="ignore", invalid="ignore"):
        inv = 1.0 / d
        for lo, hi, rgb in SIM_BOXES:
            t1 = (np.asarray(lo) - o) * inv
            t2 = (np.asarray(hi) - o) * inv
            tmin = np.nanmax(np.minimum(t1, t2), axis=1)
            tmax = np.nanmin(np.maximum(t1, t2), axis=1)
            axis = np.nanargmax(np.minimum(t1, t2), axis=1)
            hit = (tmax >= tmin) & (tmin > 0) & (tmin < best)
            best[hit] = tmin[hit]
            shade = np.array([0.80, 1.00, 0.65])[axis[hit]][:, None]  # face lighting by axis
            col[hit] = np.asarray(rgb) * shade
        # Floor: y = 0, a light checkerboard so odometry has texture.
        tf = -o[1] / d[:, 1]
        hit = (d[:, 1] < 0) & (tf > 0) & (tf < best)
        best[hit] = tf[hit]
        p = o + d[hit] * tf[hit][:, None]
        check = ((np.floor(p[:, 0] / 0.05) + np.floor(p[:, 2] / 0.05)) % 2)[:, None]
        col[hit] = np.where(check > 0, 200.0, 170.0)
    depth = np.where(np.isfinite(best), best, 0.0)
    if noise_m > 0:
        rng = rng or np.random.default_rng()
        depth = np.where(depth > 0, depth + rng.normal(0.0, noise_m, n), 0.0)
    return depth.reshape(h, w).astype(np.float32), np.clip(col, 0, 255).reshape(h, w, 3).astype(np.uint8)


# ----- pure geometry (tested) -------------------------------------------------

def crop_depth(depth_m: np.ndarray, near: float, far: float) -> np.ndarray:
    d = np.asarray(depth_m, dtype=np.float32).copy()
    d[(d < near) | (d > far) | ~np.isfinite(d)] = 0.0
    return d


def back_project(depth_m: np.ndarray, rgb: np.ndarray, intr: Intrinsics, stride: int = 1) -> tuple[np.ndarray, np.ndarray]:
    """Depth image -> camera-frame points (N x 3) and their colours."""
    d = depth_m[::stride, ::stride]
    c = rgb[::stride, ::stride]
    h, w = d.shape
    us, vs = np.meshgrid(np.arange(w) * stride, np.arange(h) * stride)
    keep = d > 0
    z = d[keep].astype(np.float64)
    x = (us[keep] - intr.cx) * z / intr.fx
    y = (vs[keep] - intr.cy) * z / intr.fy
    return np.stack([x, y, z], axis=1), c[keep]


def transform(points: np.ndarray, pose: np.ndarray) -> np.ndarray:
    return points @ pose[:3, :3].T + pose[:3, 3]


def voxel_down(points: np.ndarray, colors: np.ndarray, voxel: float, min_hits: int = 1) -> tuple[np.ndarray, np.ndarray]:
    """Average points (and colours) per voxel; drop voxels seen fewer
    than `min_hits` times (isolated noise)."""
    if len(points) == 0:
        return points, colors
    keys = np.floor(points / voxel).astype(np.int64)
    _, inv, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inv = inv.reshape(-1)
    m = len(counts)
    sums = np.zeros((m, 3))
    np.add.at(sums, inv, points)
    csum = np.zeros((m, 3))
    np.add.at(csum, inv, colors.astype(np.float64))
    keep = counts >= min_hits
    return (sums / counts[:, None])[keep], (csum / counts[:, None])[keep].astype(np.uint8)


def fit_floor(points: np.ndarray, threshold: float = 0.004, iterations: int = 300,
              seed: int = 0) -> tuple[np.ndarray, float, np.ndarray] | None:
    """RANSAC the largest plane. Returns (unit normal, offset, inlier
    mask) with normal . p + offset = 0, or None if no plane holds at
    least 15% of the points (then there is no floor in view)."""
    if len(points) < 50:
        return None
    rng = np.random.default_rng(seed)
    best_mask, best_n, best_d = None, None, 0.0
    for _ in range(iterations):
        a, b, c = points[rng.choice(len(points), 3, replace=False)]
        n = np.cross(b - a, c - a)
        norm = np.linalg.norm(n)
        if norm < 1e-9:
            continue
        n = n / norm
        dist = np.abs(points @ n - n @ a)
        mask = dist < threshold
        if best_mask is None or mask.sum() > best_mask.sum():
            best_mask, best_n, best_d = mask, n, -n @ a
    if best_mask is None or best_mask.sum() < 0.15 * len(points):
        return None
    # Refine with least squares on the inliers.
    inl = points[best_mask]
    centroid = inl.mean(axis=0)
    _, _, vt = np.linalg.svd(inl - centroid, full_matrices=False)
    n = vt[2]
    if n @ best_n < 0:
        n = -n
    d = -n @ centroid
    mask = np.abs(points @ n + d) < threshold
    return n, float(d), mask


def up_align(normal: np.ndarray) -> np.ndarray:
    """Rotation taking `normal` to +y (Rodrigues)."""
    y = np.array([0.0, 1.0, 0.0])
    n = normal / np.linalg.norm(normal)
    v = np.cross(n, y)
    s, c = np.linalg.norm(v), float(n @ y)
    if s < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * ((1 - c) / s ** 2)


def _affine(M: np.ndarray, t=(0.0, 0.0, 0.0)) -> np.ndarray:
    T = np.eye(4)
    T[:3, :3], T[:3, 3] = M, t
    return T


def apply(T: np.ndarray, points: np.ndarray) -> np.ndarray:
    return points @ T[:3, :3].T + T[:3, 3]


# Upright (y up) -> the file's axes: x = length, y = width, z = height,
# the convention the Workshop's scan measuring (ScanMeasure) reads. A
# proper rotation about x, never a mirror, so the scan keeps its
# handedness.
Y_UP_TO_Z_UP = np.array([[1.0, 0, 0], [0, 0, -1.0], [0, 1.0, 0]])


def measure(points: np.ndarray, colors: np.ndarray, up_hint: np.ndarray | None = None) -> dict:
    """Remove the floor, stand the object upright and measure it.

    Returns the object's points in the scan file's frame (x = length,
    y = width, z = height, floor at z = 0, centred on the footprint),
    the 4x4 `transform` from the input frame to that frame (so a mesh
    fused in the input frame can be placed the same way), and length /
    width / height in millimetres. Length and width come from the
    smallest-area rectangle around the footprint; height runs from the
    floor plane to the top."""
    floor = fit_floor(points)
    if floor is not None:
        n, d, mask = floor
        if up_hint is not None and n @ up_hint < 0:
            n, d = -n, -d
        elif up_hint is None and np.median(points[~mask] @ n + d) < 0:
            n, d = -n, -d  # the object sits on the positive side
        obj, oc = points[~mask], colors[~mask]
        keep = obj @ n + d > 0
        obj, oc = obj[keep], oc[keep]
        # up_align(n) sends n to +y, so (R p).y = n.p and height = (R p).y + d.
        T = _affine(up_align(n), (0.0, d, 0.0))
        floor_found = True
    else:
        obj, oc = points, colors
        T = _affine(up_align(up_hint if up_hint is not None else np.array([0.0, 1.0, 0.0])))
        if len(obj):
            T[1, 3] = -apply(T, obj)[:, 1].min()
        floor_found = False
    if len(obj) < 20:
        raise ValueError("Too little of the object was captured to measure it.")
    local = apply(T, obj)
    xz = local[:, [0, 2]]
    best = None
    for deg in np.arange(0.0, 90.0, 0.5):
        t = math.radians(deg)
        rot = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
        q = xz @ rot
        lo, hi = np.quantile(q, TRIM, axis=0), np.quantile(q, 1 - TRIM, axis=0)
        ext = hi - lo
        if best is None or ext[0] * ext[1] < best[0]:
            best = (ext[0] * ext[1], rot, ext, (lo + hi) / 2)
    _, rot, ext, centre = best
    # Turn the footprint about y by the same rotation, centre it, and
    # make x the long side (a quarter turn about y, not an axis swap).
    A = np.array([[rot[0, 0], 0, rot[1, 0]], [0, 1.0, 0], [rot[0, 1], 0, rot[1, 1]]])
    T = _affine(A, (-centre[0], 0.0, -centre[1])) @ T
    if ext[1] > ext[0]:
        T = _affine(np.array([[0, 0, 1.0], [0, 1.0, 0], [-1.0, 0, 0]])) @ T
        ext = ext[::-1]
    T = _affine(Y_UP_TO_Z_UP) @ T
    out = apply(T, obj)
    height = float(np.quantile(out[:, 2], 1 - TRIM))
    # Drop the trimmed stray points from the scan itself, so the
    # Workshop (which measures the file's plain bounding box) reads
    # the same size as this.
    eps = 1e-6
    keep = (np.abs(out[:, 0]) <= ext[0] / 2 + eps) & (np.abs(out[:, 1]) <= ext[1] / 2 + eps) & (out[:, 2] <= height + eps)
    pts_out, col_out = out[keep], oc[keep]
    if floor is not None:
        # Keep the patch of floor under the footprint, flattened onto the
        # fitted plane (z = 0): the robot stands on it in the viewer, and
        # the file's bounding box runs floor-to-top like the height here.
        fl = apply(T, points[floor[2]])
        under = (np.abs(fl[:, 0]) <= ext[0] / 2) & (np.abs(fl[:, 1]) <= ext[1] / 2)
        fl = fl[under]
        fl[:, 2] = 0.0
        pts_out = np.concatenate([pts_out, fl])
        col_out = np.concatenate([col_out, colors[floor[2]][under]])
    return {
        "points": pts_out, "colors": col_out, "floor_found": floor_found, "transform": T,
        "dims_mm": {"length": round(float(ext[0]) * 1000, 1), "width": round(float(ext[1]) * 1000, 1),
                    "height": round(height * 1000, 1)},
    }


PLY_COMMENT = "comment robotforge scan: metres, x length, y width, z height (z up)"


def write_ply(path: Path, points: np.ndarray, colors: np.ndarray) -> None:
    """Binary PLY point cloud in metres, z up (x length, y width,
    z height), readable by three.js PLYLoader, MeshLab and Blender."""
    n = len(points)
    header = "\n".join(["ply", "format binary_little_endian 1.0", PLY_COMMENT, f"element vertex {n}",
                        "property float x", "property float y", "property float z",
                        "property uchar red", "property uchar green", "property uchar blue", "end_header"]) + "\n"
    arr = np.empty(n, dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
    arr["x"], arr["y"], arr["z"] = points[:, 0], points[:, 1], points[:, 2]
    arr["r"], arr["g"], arr["b"] = colors[:, 0], colors[:, 1], colors[:, 2]
    with open(path, "wb") as f:
        f.write(header.encode("ascii"))
        f.write(arr.tobytes())


def depth_colormap(depth_m: np.ndarray, near: float, far: float) -> np.ndarray:
    """Depth as colour for the preview: near = warm, far = cool, none = black."""
    t = np.clip((depth_m - near) / max(far - near, 1e-6), 0, 1)
    r = np.clip(1.5 - np.abs(4 * t - 1), 0, 1)
    g = np.clip(1.5 - np.abs(4 * t - 2), 0, 1)
    b = np.clip(1.5 - np.abs(4 * t - 3), 0, 1)
    rgb = (np.stack([r, g, b], axis=-1) * 255).astype(np.uint8)
    rgb[depth_m <= 0] = 0
    return rgb


def b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode("ascii")


# ----- frame sources ----------------------------------------------------------

@dataclass
class Frame:
    depth: np.ndarray      # metres, float32
    color: np.ndarray      # uint8 RGB, aligned to depth
    pose: np.ndarray | None  # camera -> world when known (simulate)
    t: float = field(default_factory=time.time)


class SimSource:
    name = "Simulated depth camera (synthetic test rover)"
    simulated = True

    def __init__(self, fps: float = 10.0, noise_m: float = 0.001, seed: int = 1, frames_per_orbit: int = 90):
        self.intr = SIM_INTR
        self.orbit = frames_per_orbit
        self.fps = fps
        self.noise = noise_m
        self.k = 0
        self.rng = np.random.default_rng(seed)

    def read(self) -> Frame:
        pose = sim_pose(self.k, self.orbit)
        self.k += 1
        depth, color = render_sim(pose, self.intr, self.noise, self.rng)
        return Frame(depth, color, pose)

    def close(self) -> None:
        pass


class RealSenseSource:
    simulated = False

    def __init__(self, width: int = 848, height: int = 480, fps: int = 30):
        try:
            import pyrealsense2 as rs  # type: ignore
        except ImportError:
            sys.exit("A real camera needs pyrealsense2: pip install pyrealsense2  (or run with --simulate)")
        self.rs = rs
        self.pipe, cfg = rs.pipeline(), rs.config()
        cfg.enable_stream(rs.stream.depth, width, height, rs.format.z16, fps)
        cfg.enable_stream(rs.stream.color, width, height, rs.format.rgb8, fps)
        try:
            profile = self.pipe.start(cfg)
        except RuntimeError as e:
            sys.exit(f"Could not start the RealSense camera: {e}. Is it plugged into a USB 3 port?")
        dev = profile.get_device()
        self.name = dev.get_info(rs.camera_info.name)
        self.scale = dev.first_depth_sensor().get_depth_scale()
        self.align = rs.align(rs.stream.color)
        i = profile.get_stream(rs.stream.color).as_video_stream_profile().get_intrinsics()
        self.intr = Intrinsics(i.width, i.height, i.fx, i.fy, i.ppx, i.ppy)
        self.fps = fps
        for _ in range(30):  # let auto-exposure settle
            self.pipe.wait_for_frames(5000)

    def read(self) -> Frame:
        while True:
            fs = self.align.process(self.pipe.wait_for_frames(5000))
            d, c = fs.get_depth_frame(), fs.get_color_frame()
            if d and c:
                return Frame(np.asanyarray(d.get_data()).astype(np.float32) * self.scale,
                             np.asanyarray(c.get_data()).copy(), None)

    def close(self) -> None:
        self.pipe.stop()


# ----- fusion -----------------------------------------------------------------

def track_poses(frames: list[Frame], intr: Intrinsics, far: float) -> tuple[list[np.ndarray | None], int]:
    """Camera poses for a real recording, from Open3D RGB-D odometry
    frame to frame. Frames where tracking is lost get None."""
    import open3d as o3d  # type: ignore
    K = o3d.camera.PinholeCameraIntrinsic(intr.width, intr.height, intr.fx, intr.fy, intr.cx, intr.cy)
    option = o3d.pipelines.odometry.OdometryOption(depth_diff_max=0.03, depth_max=far)
    jac = o3d.pipelines.odometry.RGBDOdometryJacobianFromHybridTerm()
    poses: list[np.ndarray | None] = []
    pose, prev, lost = np.eye(4), None, 0
    for f in frames:
        rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
            o3d.geometry.Image(np.ascontiguousarray(f.color)), o3d.geometry.Image(f.depth),
            depth_scale=1.0, depth_trunc=far, convert_rgb_to_intensity=False)
        if prev is not None:
            ok, step, _ = o3d.pipelines.odometry.compute_rgbd_odometry(rgbd, prev, K, np.eye(4), jac, option)
            if not ok:
                lost += 1
                poses.append(None)
                continue
            pose = pose @ step
        poses.append(pose.copy())
        prev = rgbd
    return poses, lost


def build_scan(frames: list[Frame], intr: Intrinsics, near: float, far: float, out_dir: Path,
               voxel: float = 0.002, simulated: bool = False) -> dict:
    """Fuse a recorded session into one scan and measure it."""
    if len(frames) < 8:
        raise ValueError("Record a longer walk-around first: at least a few seconds, all the way round.")
    try:
        import open3d  # type: ignore  # noqa: F401
        have_o3d = True
    except ImportError:
        have_o3d = False
    lost = 0
    if all(f.pose is not None for f in frames):
        poses: list[np.ndarray | None] = [f.pose for f in frames]
        up_hint = np.array([0.0, 1.0, 0.0])
    elif have_o3d:
        poses, lost = track_poses(frames, intr, far)
        up_hint = -poses[0][:3, 1] if poses[0] is not None else None  # first view's "up"
    else:
        raise ValueError("Building a scan from a real camera needs Open3D for tracking: pip install open3d")
    pts, cols = [], []
    for f, pose in zip(frames, poses):
        if pose is None:
            continue
        d = crop_depth(f.depth, near, far)
        p, c = back_project(d, f.color, intr, stride=2)
        pts.append(transform(p, pose))
        cols.append(c)
    used = sum(p is not None for p in poses)
    if used < 8:
        raise ValueError("Tracking was lost on most frames. Move more slowly, add light, keep the robot in view.")
    P, C = voxel_down(np.concatenate(pts), np.concatenate(cols), voxel, min_hits=2)
    m = measure(P, C, up_hint)
    out_dir.mkdir(parents=True, exist_ok=True)
    ply = out_dir / "scan.ply"
    method = "points"
    if have_o3d and not simulated:
        method = _tsdf_mesh(frames, poses, intr, near, far, voxel * 2, m, ply)
    if method == "points":
        write_ply(ply, m["points"], m["colors"])
    acc_mm = round(RANGE_ACCURACY * float(np.mean([0.5 * (near + far)])) * 1000)
    return {
        "dims_mm": m["dims_mm"], "floor_found": m["floor_found"], "points": int(len(m["points"])),
        "method": method, "frames_used": used, "frames_lost": lost, "ply_bytes": ply.stat().st_size,
        "measured_by": "simulated" if simulated else "realsense",
        "accuracy_note": ("Simulated camera: compare with the rover's known size."
                          if simulated else
                          f"Measured from RealSense depth. Depth error is about 2% of range (about ±{acc_mm} mm here)."),
        **({"truth_mm": SIM_TRUTH_MM} if simulated else {}),
    }


def _tsdf_mesh(frames, poses, intr, near, far, voxel, m, ply: Path) -> str:
    """Open3D TSDF fusion into a colour mesh, placed in the same
    upright frame as the measurement. Falls back to points on failure."""
    try:
        import open3d as o3d  # type: ignore
        K = o3d.camera.PinholeCameraIntrinsic(intr.width, intr.height, intr.fx, intr.fy, intr.cx, intr.cy)
        vol = o3d.pipelines.integration.ScalableTSDFVolume(
            voxel_length=voxel, sdf_trunc=voxel * 5, color_type=o3d.pipelines.integration.TSDFVolumeColorType.RGB8)
        for f, pose in zip(frames, poses):
            if pose is None:
                continue
            d = crop_depth(f.depth, near, far)
            rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
                o3d.geometry.Image(np.ascontiguousarray(f.color)), o3d.geometry.Image(d),
                depth_scale=1.0, depth_trunc=far, convert_rgb_to_intensity=False)
            vol.integrate(rgbd, K, np.linalg.inv(pose))
        mesh = vol.extract_triangle_mesh()
        labels, counts, _ = mesh.cluster_connected_triangles()
        labels, counts = np.asarray(labels), np.asarray(counts)
        if len(counts):
            mesh.remove_triangles_by_mask(labels != counts.argmax())
            mesh.remove_unreferenced_vertices()
        if len(mesh.triangles) > 300_000:
            mesh = mesh.simplify_quadric_decimation(300_000)
        mesh.transform(m["transform"])  # same upright, z-up frame as the measurement
        mesh.compute_vertex_normals()
        if len(mesh.triangles) == 0 or not o3d.io.write_triangle_mesh(str(ply), mesh, write_ascii=False):
            return "points"
        return "tsdf-mesh"
    except Exception:  # noqa: BLE001 - the point cloud is still a valid scan
        return "points"


# ----- the bridge -------------------------------------------------------------

class Bridge:
    def __init__(self, source, sessions: Path, near: float, far: float, preview_points: int = 5000):
        self.source = source
        self.sessions = sessions
        self.near, self.far = near, far
        self.preview_points = preview_points
        self.lock = threading.Lock()
        self.latest: Frame | None = None
        self.recording = False
        self.recorded: list[Frame] = []
        self.session_dir: Path | None = None
        self.result: dict | None = None
        self.error = ""
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.running = False
        self.thread.join(timeout=5)
        self.source.close()

    def _loop(self) -> None:
        period = 1.0 / max(self.source.fps, 1)
        while self.running:
            t0 = time.time()
            try:
                f = self.source.read()
            except Exception as e:  # noqa: BLE001
                self.error = f"Camera read failed: {e}"
                time.sleep(0.5)
                continue
            with self.lock:
                self.latest = f
                if self.recording:
                    self.recorded.append(f)
                    self._save_frame(f, len(self.recorded))
            if self.source.simulated:
                time.sleep(max(0.0, period - (time.time() - t0)))

    def _save_frame(self, f: Frame, i: int) -> None:
        if self.session_dir is None:
            return
        extra = {"pose": f.pose} if f.pose is not None else {}
        np.savez_compressed(self.session_dir / f"frame_{i:04d}.npz",
                            color=f.color, depth_mm=np.round(f.depth * 1000).astype(np.uint16), **extra)

    # --- API ---
    def status(self) -> dict:
        with self.lock:
            return {"ok": True, "bridge": "robotforge-scan-bridge", "version": 1,
                    "camera": self.source.name, "simulated": self.source.simulated,
                    "intrinsics": self.source.intr.as_dict(), "near": self.near, "far": self.far,
                    "recording": self.recording, "frames_recorded": len(self.recorded),
                    "session": str(self.session_dir) if self.session_dir else None,
                    "has_result": self.result is not None, "error": self.error}

    def frame(self) -> dict:
        with self.lock:
            f = self.latest
            rec, n = self.recording, len(self.recorded)
        if f is None:
            return {"ok": False, "error": "No frame yet."}
        intr = self.source.intr
        s = max(1, round(intr.width / 160))
        color = f.color[::s, ::s]
        d = crop_depth(f.depth, self.near, self.far)
        depth_rgb = depth_colormap(d[::s, ::s], self.near, self.far)
        p, c = back_project(d, f.color, intr, stride=max(1, s))
        if len(p) > self.preview_points:
            idx = np.linspace(0, len(p) - 1, self.preview_points).astype(int)
            p, c = p[idx], c[idx]
        p = p * np.array([1.0, -1.0, -1.0])  # camera view, y up, for the preview
        h, w = color.shape[:2]
        return {"ok": True, "w": w, "h": h, "color": b64(color), "depth": b64(depth_rgb),
                "points": b64(p.astype("<f4")), "point_colors": b64(c.astype(np.uint8)), "n": int(len(p)),
                "recording": rec, "frames_recorded": n, "t": f.t}

    def record_start(self) -> dict:
        with self.lock:
            stamp = time.strftime("%Y%m%d-%H%M%S")
            self.session_dir = self.sessions / stamp
            self.session_dir.mkdir(parents=True, exist_ok=True)
            (self.session_dir / "session.json").write_text(json.dumps({
                "camera": self.source.name, "simulated": self.source.simulated,
                "intrinsics": self.source.intr.as_dict(), "near": self.near, "far": self.far,
                "depth_units": "mm (uint16)", "started": stamp}, indent=2))
            self.recorded, self.result, self.recording = [], None, True
        return self.status()

    def record_stop(self) -> dict:
        with self.lock:
            self.recording = False
        return self.status()

    def build(self) -> dict:
        with self.lock:
            frames = list(self.recorded)
            self.recording = False
            out = self.session_dir or (self.sessions / "unsaved")
        result = build_scan(frames, self.source.intr, self.near, self.far, out, simulated=self.source.simulated)
        result["session"] = str(out)
        with self.lock:
            self.result = {**result, "ply": out / "scan.ply"}
        return {"ok": True, **result}

    def ply(self) -> bytes | None:
        with self.lock:
            r = self.result
        return r["ply"].read_bytes() if r else None


def origin_allowed(origin: str | None, extra: list[str]) -> bool:
    if not origin:
        return False
    return origin in extra or any(rx.match(origin) for rx in ALLOWED_ORIGINS)


def make_handler(bridge: Bridge, extra_origins: list[str]):
    class Handler(BaseHTTPRequestHandler):
        server_version = "RobotForgeScanBridge/1"

        def log_message(self, fmt, *args):  # quiet: one line per build only
            pass

        def _cors(self) -> bool:
            origin = self.headers.get("Origin")
            if origin is None:
                return True  # same-machine tools (curl, tests) send no Origin
            if not origin_allowed(origin, extra_origins):
                return False
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            # Chrome's Private/Local Network Access preflight for an https page calling 127.0.0.1.
            self.send_header("Access-Control-Allow-Private-Network", "true")
            return True

        def _send(self, code: int, body: bytes, ctype: str = "application/json") -> None:
            self.send_response(code)
            if not self._cors():
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":false,"error":"This page is not allowed to use the scan bridge."}')
                return
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj: dict) -> None:
            self._send(code, json.dumps(obj).encode())

        def do_OPTIONS(self):  # noqa: N802
            self.send_response(204 if origin_allowed(self.headers.get("Origin"), extra_origins) else 403)
            self._cors()
            self.end_headers()

        def do_GET(self):  # noqa: N802
            if not origin_allowed(self.headers.get("Origin"), extra_origins) and self.headers.get("Origin"):
                return self._json(403, {"ok": False, "error": "Origin not allowed."})
            path = self.path.split("?")[0]
            if path == "/status":
                return self._json(200, bridge.status())
            if path == "/frame":
                return self._json(200, bridge.frame())
            if path == "/scan.ply":
                data = bridge.ply()
                if data is None:
                    return self._json(404, {"ok": False, "error": "Build a scan first."})
                return self._send(200, data, "application/octet-stream")
            return self._json(404, {"ok": False, "error": "Unknown path."})

        def do_POST(self):  # noqa: N802
            if not origin_allowed(self.headers.get("Origin"), extra_origins) and self.headers.get("Origin"):
                return self._json(403, {"ok": False, "error": "Origin not allowed."})
            n = int(self.headers.get("Content-Length") or 0)
            if n:
                self.rfile.read(n)
            path = self.path.split("?")[0]
            try:
                if path == "/record/start":
                    return self._json(200, bridge.record_start())
                if path == "/record/stop":
                    return self._json(200, bridge.record_stop())
                if path == "/build":
                    t0 = time.time()
                    out = bridge.build()
                    print(f"Built scan: {out['dims_mm']} mm from {out['frames_used']} frames in {time.time() - t0:.1f}s -> {out['session']}")
                    return self._json(200, out)
            except ValueError as e:
                return self._json(400, {"ok": False, "error": str(e)})
            return self._json(404, {"ok": False, "error": "Unknown path."})

    return Handler


def serve(bridge: Bridge, port: int, extra_origins: list[str]) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(bridge, extra_origins))
    httpd.daemon_threads = True
    return httpd


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Local bridge between a RealSense camera and RobotForge Scan Studio.")
    p.add_argument("--simulate", action="store_true", help="no camera: a synthetic rover with a known size")
    p.add_argument("--port", type=int, default=DEFAULT_PORT)
    p.add_argument("--near", type=float, default=0.15, help="ignore depth nearer than this, metres")
    p.add_argument("--far", type=float, default=1.0, help="ignore depth farther than this, metres (cuts the room out)")
    p.add_argument("--sessions", default=str(Path.home() / "robotforge-scans"), help="where recorded frames are saved")
    p.add_argument("--allow-origin", action="append", default=[], help="another site origin allowed to connect")
    p.add_argument("--width", type=int, default=848)
    p.add_argument("--height", type=int, default=480)
    p.add_argument("--fps", type=int, default=30)
    a = p.parse_args(argv)
    if not 0 < a.near < a.far:
        p.error("--near must be smaller than --far")
    source = SimSource() if a.simulate else RealSenseSource(a.width, a.height, a.fps)
    near, far = (0.15, 1.2) if a.simulate else (a.near, a.far)
    bridge = Bridge(source, Path(a.sessions).expanduser(), near, far)
    bridge.start()
    httpd = serve(bridge, a.port, a.allow_origin)
    print(f"Scan bridge ready: {source.name}")
    print(f"  http://127.0.0.1:{a.port}  (only this computer can reach it)")
    print(f"  Sessions are saved in {Path(a.sessions).expanduser()}")
    print("  Open Scan Studio in RobotForge and press Connect. Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        bridge.stop()


if __name__ == "__main__":
    main()
