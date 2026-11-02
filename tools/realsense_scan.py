#!/usr/bin/env python3
"""Scan a robot with an Intel RealSense depth camera (D415/D435/D455...)
and write a mesh RobotForge's Workshop can show as a "3D scan".

Open-source pieces used:
  * librealsense / pyrealsense2 (Apache-2.0) talks to the camera.
  * Open3D (MIT) tracks the camera between frames (RGB-D odometry) and
    fuses the depth into one surface (TSDF), then extracts a mesh.

Install on the computer the camera is plugged into:
    pip install pyrealsense2 open3d numpy

Usage:
    # Walk slowly around the robot (or turn it on a lazy Susan) for ~30 s:
    python3 tools/realsense_scan.py --out omega1_scan.glb
    # Re-run on a recording made with realsense-viewer (.bag):
    python3 tools/realsense_scan.py --bag walkaround.bag --out omega1_scan.glb
    # No Open3D? One frame, as a coloured point cloud (numpy only):
    python3 tools/realsense_scan.py --single --out omega1_points.ply

Then in RobotForge: Workshop -> the robot -> Overview -> "Add a 3D scan".

Honest limits: the mesh is a picture of the robot, not its CAD. Sizes
in it are only as good as the camera (a few mm at 0.5 m), and joints
are not found. Measured numbers still go in the Specs tab.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np


# ----- pure helpers (tested in tests/test_realsense_scan.py) -----------------

def crop_depth(depth_m: np.ndarray, near: float, far: float) -> np.ndarray:
    """Zero out depth outside [near, far] metres so the floor and the
    room behind the robot do not end up in the scan."""
    d = np.asarray(depth_m, dtype=np.float32).copy()
    d[(d < near) | (d > far) | ~np.isfinite(d)] = 0.0
    return d


def depth_to_points(depth_m: np.ndarray, fx: float, fy: float, cx: float, cy: float) -> np.ndarray:
    """Back-project a depth image (metres) into camera-frame XYZ points
    (N x 3), skipping pixels with no depth."""
    h, w = depth_m.shape
    us, vs = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    z = depth_m.astype(np.float32)
    keep = z > 0
    x = (us[keep] - cx) * z[keep] / fx
    y = (vs[keep] - cy) * z[keep] / fy
    return np.stack([x, y, z[keep]], axis=1)


def write_ply_points(path: Path, xyz: np.ndarray, rgb: np.ndarray | None = None) -> None:
    """Binary little-endian PLY point cloud, readable by three.js
    PLYLoader, MeshLab and Blender."""
    n = len(xyz)
    header = ["ply", "format binary_little_endian 1.0", f"element vertex {n}",
              "property float x", "property float y", "property float z"]
    if rgb is not None:
        header += ["property uchar red", "property uchar green", "property uchar blue"]
    header.append("end_header")
    rec = [("x", "<f4"), ("y", "<f4"), ("z", "<f4")]
    if rgb is not None:
        rec += [("r", "u1"), ("g", "u1"), ("b", "u1")]
    arr = np.empty(n, dtype=rec)
    # Camera frame is y-down, z-forward; flip to y-up so it stands upright.
    arr["x"], arr["y"], arr["z"] = xyz[:, 0], -xyz[:, 1], -xyz[:, 2]
    if rgb is not None:
        arr["r"], arr["g"], arr["b"] = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    with open(path, "wb") as f:
        f.write(("\n".join(header) + "\n").encode("ascii"))
        f.write(arr.tobytes())


# ----- camera ----------------------------------------------------------------

def _need(module: str, pip_name: str):
    try:
        return __import__(module)
    except ImportError:
        sys.exit(f"This needs {pip_name}: pip install {pip_name}")


def open_camera(bag: str | None, width: int, height: int, fps: int):
    rs = _need("pyrealsense2", "pyrealsense2")
    pipe, cfg = rs.pipeline(), rs.config()
    if bag:
        cfg.enable_device_from_file(bag, repeat_playback=False)
    else:
        cfg.enable_stream(rs.stream.depth, width, height, rs.format.z16, fps)
        cfg.enable_stream(rs.stream.color, width, height, rs.format.rgb8, fps)
    profile = pipe.start(cfg)
    if bag:
        profile.get_device().as_playback().set_real_time(False)
    scale = profile.get_device().first_depth_sensor().get_depth_scale()
    align = rs.align(rs.stream.color)
    intr = profile.get_stream(rs.stream.color).as_video_stream_profile().get_intrinsics()
    return rs, pipe, align, scale, intr


def frames(rs, pipe, align, scale, seconds: float, skip: int):
    """Yield (depth_m, rgb) pairs; the first `skip` let auto-exposure settle."""
    start, n = time.time(), 0
    while time.time() - start < seconds:
        try:
            fs = pipe.wait_for_frames(5000)
        except RuntimeError:
            return  # end of a .bag
        fs = align.process(fs)
        d, c = fs.get_depth_frame(), fs.get_color_frame()
        if not d or not c:
            continue
        n += 1
        if n <= skip:
            continue
        yield np.asanyarray(d.get_data()).astype(np.float32) * scale, np.asanyarray(c.get_data())


def single(args) -> None:
    rs, pipe, align, scale, intr = open_camera(args.bag, args.width, args.height, args.fps)
    try:
        for depth, rgb in frames(rs, pipe, align, scale, 10, args.skip):
            d = crop_depth(depth, args.near, args.far)
            pts = depth_to_points(d, intr.fx, intr.fy, intr.ppx, intr.ppy)
            write_ply_points(Path(args.out), pts, rgb[d > 0])
            print(f"Wrote {len(pts)} points to {args.out}")
            return
    finally:
        pipe.stop()
    sys.exit("No frames came from the camera.")


def fuse(args) -> None:
    o3d = _need("open3d", "open3d")
    rs, pipe, align, scale, intr = open_camera(args.bag, args.width, args.height, args.fps)
    K = o3d.camera.PinholeCameraIntrinsic(intr.width, intr.height, intr.fx, intr.fy, intr.ppx, intr.ppy)
    vol = o3d.pipelines.integration.ScalableTSDFVolume(
        voxel_length=args.voxel, sdf_trunc=args.voxel * 5,
        color_type=o3d.pipelines.integration.TSDFVolumeColorType.RGB8)
    pose = np.eye(4)        # camera -> world
    prev = None
    used = lost = 0
    option = o3d.pipelines.odometry.OdometryOption(depth_diff_max=0.03, depth_max=args.far)
    jac = o3d.pipelines.odometry.RGBDOdometryJacobianFromHybridTerm()
    print("Scanning: move slowly around the robot. Ctrl+C to finish early.")
    try:
        for depth, rgb in frames(rs, pipe, align, scale, args.seconds, args.skip):
            d = crop_depth(depth, args.near, args.far)
            rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
                o3d.geometry.Image(np.ascontiguousarray(rgb)), o3d.geometry.Image(d),
                depth_scale=1.0, depth_trunc=args.far, convert_rgb_to_intensity=False)
            if prev is not None:
                ok, step, _ = o3d.pipelines.odometry.compute_rgbd_odometry(
                    rgbd, prev, K, np.eye(4), jac, option)
                if not ok:
                    lost += 1
                    continue  # tracking lost on this frame: skip it, keep the last good pose
                pose = pose @ step
            vol.integrate(rgbd, K, np.linalg.inv(pose))
            prev = rgbd
            used += 1
            if used % 30 == 0:
                print(f"  {used} frames fused ({lost} skipped)")
    except KeyboardInterrupt:
        pass
    finally:
        pipe.stop()
    if used < 10:
        sys.exit("Too few frames were tracked. Move more slowly, add light, and keep the robot in view.")
    mesh = vol.extract_triangle_mesh()
    mesh.compute_vertex_normals()
    # Keep only the largest connected piece: drops floating specks.
    labels, counts, _ = mesh.cluster_connected_triangles()
    labels, counts = np.asarray(labels), np.asarray(counts)
    if len(counts):
        mesh.remove_triangles_by_mask(labels != counts.argmax())
        mesh.remove_unreferenced_vertices()
    if args.target_triangles and len(mesh.triangles) > args.target_triangles:
        mesh = mesh.simplify_quadric_decimation(args.target_triangles)
        mesh.compute_vertex_normals()
    # Camera frame (y-down) to y-up, so it stands upright in the viewer.
    mesh.transform(np.diag([1.0, -1.0, -1.0, 1.0]))
    if not o3d.io.write_triangle_mesh(args.out, mesh):
        sys.exit(f"Could not write {args.out}. Try a .ply or .obj name.")
    print(f"Wrote {args.out}: {len(mesh.triangles)} triangles from {used} frames ({lost} skipped).")


def main(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Scan a robot with a RealSense camera into a GLB/PLY/OBJ mesh for RobotForge.")
    p.add_argument("--out", required=True, help="output file: .glb, .ply or .obj")
    p.add_argument("--bag", help="use a .bag recording instead of a live camera")
    p.add_argument("--single", action="store_true", help="one frame as a point cloud PLY (no Open3D needed)")
    p.add_argument("--seconds", type=float, default=40.0, help="how long to scan (default 40)")
    p.add_argument("--near", type=float, default=0.15, help="ignore depth nearer than this, metres")
    p.add_argument("--far", type=float, default=1.0, help="ignore depth farther than this, metres (cuts the room out)")
    p.add_argument("--voxel", type=float, default=0.004, help="detail, metres (default 4 mm)")
    p.add_argument("--target-triangles", type=int, default=300_000, help="simplify to about this many triangles (0 = keep all)")
    p.add_argument("--width", type=int, default=848)
    p.add_argument("--height", type=int, default=480)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--skip", type=int, default=30, help="frames to drop while auto-exposure settles")
    args = p.parse_args(argv)
    if Path(args.out).suffix.lower() not in {".glb", ".ply", ".obj"}:
        p.error("--out must end in .glb, .ply or .obj (the formats RobotForge reads)")
    if args.single and not args.out.lower().endswith(".ply"):
        p.error("--single writes a point cloud: use a .ply name")
    if not 0 < args.near < args.far:
        p.error("--near must be smaller than --far")
    return args


if __name__ == "__main__":
    a = main()
    single(a) if a.single else fuse(a)
