"""tools/scan_bridge.py: the Scan Studio's local bridge. A real RealSense
needs hardware, so these tests drive the whole pipeline with the
simulated camera, whose rover has a known size: stream, record, fuse,
remove the floor, measure, and serve the PLY. Measurements must land
within 2% of the truth, the same budget as a real D400's depth error."""
from __future__ import annotations

import importlib.util
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
import threading

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("scan_bridge", ROOT / "tools" / "scan_bridge.py")
sb = importlib.util.module_from_spec(spec)
sys.modules["scan_bridge"] = sb
spec.loader.exec_module(sb)

TRUTH = sb.SIM_TRUTH_MM


def _close(dims: dict, tol: float = 0.02) -> None:
    for k, v in TRUTH.items():
        assert abs(dims[k] - v) <= tol * v, (k, dims[k], v)


@pytest.fixture(scope="module")
def sim_frames():
    src = sb.SimSource(frames_per_orbit=36, seed=3)
    return src, [src.read() for _ in range(36)]


def test_camera_pose_looks_at_the_target() -> None:
    pose = sb.look_at(np.array([0.5, 0.3, 0.0]), np.array([0.0, 0.1, 0.0]))
    R = pose[:3, :3]
    assert np.allclose(R.T @ R, np.eye(3), atol=1e-9)
    assert np.linalg.det(R) == pytest.approx(1.0)
    fwd = np.array([-0.5, -0.2, 0.0]) / math.hypot(0.5, 0.2)
    assert np.allclose(R[:, 2], fwd)
    assert R[1, 1] < 0  # camera y points down in the world


def test_render_and_back_projection_agree() -> None:
    """A noiseless frame back-projected through its pose lands on the
    scene: every point is on the floor or on a box surface."""
    pose = sb.sim_pose(5, 36)
    depth, rgb = sb.render_sim(pose, noise_m=0.0)
    pts, cols = sb.back_project(depth, rgb, sb.SIM_INTR)
    world = sb.transform(pts, pose)
    on_floor = np.abs(world[:, 1]) < 1e-6
    in_box = np.zeros(len(world), bool)
    for lo, hi, _ in sb.SIM_BOXES:
        in_box |= np.all((world >= np.array(lo) - 1e-6) & (world <= np.array(hi) + 1e-6), axis=1)
    assert (on_floor | in_box).all()
    assert in_box.sum() > 1000 and on_floor.sum() > 1000
    assert len(cols) == len(pts)


def test_voxel_down_averages_and_drops_singletons() -> None:
    p = np.array([[0.0001, 0, 0], [0.0003, 0, 0], [0.5, 0.5, 0.5]])
    c = np.array([[0, 0, 0], [100, 100, 100], [255, 255, 255]], np.uint8)
    out, oc = sb.voxel_down(p, c, 0.01, min_hits=2)
    assert out.shape == (1, 3) and out[0, 0] == pytest.approx(0.0002)
    assert oc[0].tolist() == [50, 50, 50]


def test_floor_fit_finds_a_tilted_floor() -> None:
    rng = np.random.default_rng(0)
    floor = np.c_[rng.uniform(-1, 1, 4000), np.zeros(4000), rng.uniform(-1, 1, 4000)]
    box = rng.uniform([-0.1, 0.01, -0.1], [0.1, 0.2, 0.1], (800, 3))
    R = sb.up_align(np.array([0.3, 1.0, -0.2]))  # some tilt
    pts = np.r_[floor, box] @ R.T
    n, d, mask = sb.fit_floor(pts)
    assert abs(n @ (R @ np.array([0, 1.0, 0]))) == pytest.approx(1.0, abs=1e-3)
    assert mask[:4000].mean() > 0.99 and mask[4000:].mean() < 0.1


def test_up_align_maps_the_normal_to_y() -> None:
    for n in ([0, 1, 0], [0, -1, 0], [1, 2, 3], [0.2, -0.9, 0.1]):
        n = np.asarray(n, float) / np.linalg.norm(n)
        assert np.allclose(sb.up_align(n) @ n, [0, 1, 0], atol=1e-9)


def test_simulated_scan_measures_the_rover(sim_frames, tmp_path: Path) -> None:
    src, frames = sim_frames
    r = sb.build_scan(frames, src.intr, 0.15, 1.2, tmp_path, simulated=True)
    _close(r["dims_mm"])
    assert r["floor_found"] and r["truth_mm"] == TRUTH
    assert r["measured_by"] == "simulated" and r["frames_used"] == 36
    head = (tmp_path / "scan.ply").read_bytes()[:400].split(b"end_header")[0].decode()
    assert "binary_little_endian" in head and f"element vertex {r['points']}" in head
    assert "property uchar red" in head and "z height" in head


def test_ply_axes_match_the_workshop_measuring_convention(sim_frames, tmp_path: Path) -> None:
    """ScanMeasure reads x -> length, y -> width, z -> height from the
    file as stored, so the bridge's PLY must be laid out that way."""
    src, frames = sim_frames
    r = sb.build_scan(frames, src.intr, 0.15, 1.2, tmp_path, simulated=True)
    raw = (tmp_path / "scan.ply").read_bytes()
    body = raw[raw.index(b"end_header\n") + 11:]
    rec = np.frombuffer(body, dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
    ext = [float(np.ptp(rec[k])) * 1000 for k in ("x", "y", "z")]
    for got, key in zip(ext, ("length", "width", "height")):
        assert abs(got - TRUTH[key]) <= 0.03 * TRUTH[key], (key, got)
    assert float(rec["z"].min()) >= 0


def test_transform_is_a_rotation_not_a_mirror(sim_frames) -> None:
    src, frames = sim_frames
    p, c = sb.back_project(sb.crop_depth(frames[0].depth, 0.15, 1.2), frames[0].color, src.intr, stride=2)
    m = sb.measure(sb.transform(p, frames[0].pose), c)
    R = m["transform"][:3, :3]
    assert np.allclose(R.T @ R, np.eye(3), atol=1e-9) and np.linalg.det(R) == pytest.approx(1.0)


def test_measurement_does_not_depend_on_the_camera_frame(sim_frames) -> None:
    """Real recordings start in the first camera's frame, not a level
    world: tilt and shift the fused cloud and the size must not change."""
    src, frames = sim_frames
    pts, cols = [], []
    for f in frames:
        p, c = sb.back_project(sb.crop_depth(f.depth, 0.15, 1.2), f.color, src.intr, stride=2)
        pts.append(sb.transform(p, f.pose))
        cols.append(c)
    P, C = sb.voxel_down(np.concatenate(pts), np.concatenate(cols), 0.002, min_hits=2)
    a = math.radians(25)
    Rz = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    m = sb.measure(P @ (Rz @ sb.up_align(np.array([0.2, 1, 0.4]))).T + [0.3, -0.7, 1.1], C)
    _close(m["dims_mm"])
    assert m["points"][:, 2].min() >= 0  # stands on the floor (z up)
    # The transform places the input cloud exactly where the points went.
    assert m["transform"].shape == (4, 4)


def test_too_short_a_recording_is_refused(sim_frames, tmp_path: Path) -> None:
    src, frames = sim_frames
    with pytest.raises(ValueError, match="longer walk-around"):
        sb.build_scan(frames[:3], src.intr, 0.15, 1.2, tmp_path, simulated=True)


def test_only_known_sites_may_connect() -> None:
    ok = sb.origin_allowed
    assert ok("https://robot-forge-hackathon.vercel.app", [])
    assert ok("https://robot-forge-hackathon-git-main-abel.vercel.app", [])
    assert ok("http://localhost:3000", []) and ok("http://127.0.0.1:4419", [])
    assert not ok("https://evil.example", []) and not ok(None, [])
    assert not ok("https://robot-forge-hackathon.vercel.app.evil.example", [])
    assert ok("https://my.site", ["https://my.site"])
    assert ok("https://robot-forge.vercel.app", [])
    assert ok("https://robot-forge-git-claude-project-th-ff3be6-abel-mendozas-projects.vercel.app", [])
    assert not ok("https://robot-forge-evil.vercel.app", [])


# ----- the HTTP bridge, end to end -----------------------------------------

def _req(base: str, path: str, method: str = "GET", origin: str | None = "http://localhost:3000"):
    r = urllib.request.Request(base + path, method=method, data=b"" if method == "POST" else None)
    if origin:
        r.add_header("Origin", origin)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def test_bridge_streams_records_builds_and_serves(tmp_path: Path) -> None:
    bridge = sb.Bridge(sb.SimSource(fps=30, frames_per_orbit=24, seed=5), tmp_path, 0.15, 1.2)
    bridge.start()
    httpd = sb.serve(bridge, 0, [])
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        code, headers, body = _req(base, "/status")
        st = json.loads(body)
        assert code == 200 and st["simulated"] and st["intrinsics"]["width"] == 320
        assert headers["Access-Control-Allow-Origin"] == "http://localhost:3000"

        code, headers, _ = _req(base, "/status", "OPTIONS", "https://robot-forge-hackathon.vercel.app")
        assert code == 204 and headers["Access-Control-Allow-Private-Network"] == "true"
        assert _req(base, "/status", "OPTIONS", "https://evil.example")[0] == 403
        assert _req(base, "/frame", origin="https://evil.example")[0] == 403

        deadline = time.time() + 10
        while not json.loads(_req(base, "/frame")[2]).get("ok") and time.time() < deadline:
            time.sleep(0.05)
        fr = json.loads(_req(base, "/frame")[2])
        import base64
        assert len(base64.b64decode(fr["color"])) == fr["w"] * fr["h"] * 3
        assert len(base64.b64decode(fr["depth"])) == fr["w"] * fr["h"] * 3
        assert len(base64.b64decode(fr["points"])) == fr["n"] * 12 > 0

        assert _req(base, "/scan.ply")[0] == 404  # nothing built yet
        assert json.loads(_req(base, "/record/start", "POST")[2])["recording"]
        deadline = time.time() + 20
        while bridge.status()["frames_recorded"] < 24 and time.time() < deadline:
            time.sleep(0.05)
        code, _, body = _req(base, "/build", "POST")
        out = json.loads(body)
        assert code == 200 and out["ok"], out
        _close(out["dims_mm"])
        session = Path(out["session"])
        assert (session / "session.json").exists() and len(list(session.glob("frame_*.npz"))) >= 24
        saved = np.load(next(session.glob("frame_*.npz")))
        assert saved["depth_mm"].dtype == np.uint16 and saved["color"].shape == (240, 320, 3)

        code, _, ply = _req(base, "/scan.ply")
        assert code == 200 and ply.startswith(b"ply\n") and len(ply) == out["ply_bytes"]
    finally:
        httpd.shutdown()
        bridge.stop()


def test_build_errors_come_back_as_messages(tmp_path: Path) -> None:
    bridge = sb.Bridge(sb.SimSource(fps=30, frames_per_orbit=24), tmp_path, 0.15, 1.2)
    httpd = sb.serve(bridge, 0, [])
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        code, _, body = _req(base, "/build", "POST")
        assert code == 400 and "walk-around" in json.loads(body)["error"]
    finally:
        httpd.shutdown()
        bridge.source.close()


def test_mesh_crop_keeps_only_the_measured_box() -> None:
    dims = {"length": 240.0, "width": 200.0, "height": 210.0}
    v = np.array([[0, 0, 0.1], [0.119, -0.099, 0.0], [0.3, 0, 0.05], [0, 0, 0.25], [0, 0, -0.02], [0, 0.5, 0]])
    assert sb.inside_object_bounds(v, dims).tolist() == [True, True, False, False, False, False]


def test_ply_comment_is_added_to_a_foreign_header(tmp_path: Path) -> None:
    p = tmp_path / "mesh.ply"
    body = bytes(range(16))
    p.write_bytes(b"ply\nformat binary_little_endian 1.0\nelement vertex 1\nend_header\n" + body)
    sb.add_ply_comment(p, sb.PLY_COMMENT)
    sb.add_ply_comment(p, sb.PLY_COMMENT)  # once only
    data = p.read_bytes()
    assert data.count(sb.PLY_COMMENT.encode()) == 1
    assert data.startswith(b"ply\nformat binary_little_endian 1.0\n" + sb.PLY_COMMENT.encode() + b"\nelement")
    assert data.endswith(b"end_header\n" + body)


def test_busy_port_gets_a_plain_message(monkeypatch, capsys) -> None:
    import socket
    s = socket.socket(); s.bind(("127.0.0.1", 0)); s.listen(1)
    port = s.getsockname()[1]
    try:
        with pytest.raises(SystemExit) as exc:
            sb.main(["--simulate", "--port", str(port)])
        assert "already in use" in str(exc.value) and f"--port {port + 2}" in str(exc.value)
    finally:
        s.close()
