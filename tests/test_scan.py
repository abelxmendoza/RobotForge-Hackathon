"""Scan (.ply) tests: the parse + measure core of assets/js/scan.js,
extracted and run in Node against synthesized fixtures with known
ground-truth dimensions (Pathfinder's 0.42 x 0.35 x 0.28 m box).

Fixtures: an ASCII PLY in metres (committed, tests/fixtures/), a
binary little-endian PLY in millimetres (synthesized at test time —
binary fixtures are not committed), a sub-millimetre cloud (the
implausible branch), and a non-PLY file (a loud parse error).
No network; skipped when node is unavailable.
"""
import json
import re
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCAN_JS = (REPO / "assets" / "js" / "scan.js").read_text()
NODE = shutil.which("node")
FIXTURES = Path(__file__).parent / "fixtures"

TRUTH = (0.42, 0.35, 0.28)  # Pathfinder's box, metres


def _between(text, begin, end):
    m = re.search(re.escape(begin) + r"(.*?)" + re.escape(end), text, re.S)
    assert m, f"markers {begin}..{end} not found"
    return m.group(1)


def _lattice(step=0.07):
    pts = []
    for i in range(7):
        for j in range(6):
            for k in range(5):
                pts.append((i * step, j * step, k * step))
    return pts


def _write_binary_mm(path: Path) -> None:
    pts = [(x * 1000, y * 1000, z * 1000) for x, y, z in _lattice()]
    header = ("ply\nformat binary_little_endian 1.0\n"
              "comment synthesized fixture: same box, millimetres\n"
              f"element vertex {len(pts)}\n"
              "property float x\nproperty float y\nproperty float z\n"
              "end_header\n").encode("ascii")
    body = b"".join(struct.pack("<fff", *p) for p in pts)
    path.write_bytes(header + body)


def _write_tiny(path: Path) -> None:
    # three points inside half a millimetre: implausible either way
    lines = ["ply", "format ascii 1.0", "element vertex 3",
             "property float x", "property float y", "property float z",
             "end_header",
             "0 0 0", "0.0004 0 0", "0 0.0003 0.0002"]
    path.write_text("\n".join(lines) + "\n")


def _run_scan(paths):
    block = _between(SCAN_JS, "/* == ply:start == */",
                     "/* == ply:end == */")
    driver = (
        "import fs from 'node:fs';\n" + block + "\n"
        "const out = [];\n"
        "for (const p of process.argv.slice(2)) {\n"
        "  try {\n"
        "    const buf = fs.readFileSync(p);\n"
        "    const ab = buf.buffer.slice(buf.byteOffset, "
        "buf.byteOffset + buf.byteLength);\n"
        "    const parsed = parsePly(ab);\n"
        "    out.push({ count: parsed.count, format: parsed.format,\n"
        "               measure: measureCloud(parsed.positions) });\n"
        "  } catch (e) { out.push({ error: e.message }); }\n"
        "}\n"
        "console.log(JSON.stringify(out));\n")
    with tempfile.TemporaryDirectory() as tmp:
        dp = Path(tmp) / "driver.mjs"
        dp.write_text(driver)
        r = subprocess.run([NODE, str(dp)] + [str(p) for p in paths],
                           capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout)


def test_scan_fixtures_measure_the_known_box():
    if not NODE:
        return
    with tempfile.TemporaryDirectory() as tmp:
        binary = Path(tmp) / "box_mm.ply"
        tiny = Path(tmp) / "tiny.ply"
        junk = Path(tmp) / "junk.ply"
        _write_binary_mm(binary)
        _write_tiny(tiny)
        junk.write_text("this is not a ply file at all\n")
        ascii_res, binary_res, tiny_res, junk_res = _run_scan([
            FIXTURES / "box_pathfinder_ascii.ply", binary, tiny, junk])

    # ASCII in metres: extents ARE the ground truth (lattice hits the
    # corners exactly), and no unit conversion fires.
    assert ascii_res["format"] == "ascii"
    assert ascii_res["count"] == 210
    m = ascii_res["measure"]
    assert m["ok"] is True and m["unitNote"] == ""
    for got, want in zip(m["extentsM"], TRUTH):
        assert abs(got - want) < 1e-6, (got, want)

    # Binary in millimetres: same box, the mm rule fires and says so.
    assert binary_res["format"] == "binary_little_endian"
    assert binary_res["count"] == 210
    m = binary_res["measure"]
    assert m["ok"] is True
    assert "millimetres" in m["unitNote"]
    for got, want in zip(m["extentsM"], TRUTH):
        assert abs(got - want) < 1e-3, (got, want)

    # Sub-millimetre cloud: implausible branch, raw numbers, no size.
    m = tiny_res["measure"]
    assert m["ok"] is False
    assert "under a millimetre" in m["reason"]
    assert "extentsM" not in m

    # Not a PLY: a loud parse error, never a measurement.
    assert "error" in junk_res and "PLY" in junk_res["error"]


def _write_binary_splat(path: Path, factor: float) -> None:
    # A Gaussian-splat export (the SAM 3D shape): the same lattice
    # box, but every vertex carries the full 3DGS property set —
    # normals, spherical-harmonic colour, opacity, scales, rotations.
    props = ["x", "y", "z", "nx", "ny", "nz",
             "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
             "scale_0", "scale_1", "scale_2",
             "rot_0", "rot_1", "rot_2", "rot_3"]
    pts = [(x * factor, y * factor, z * factor) for x, y, z in _lattice()]
    header = ("ply\nformat binary_little_endian 1.0\n"
              "comment synthesized fixture: gaussian splat box\n"
              f"element vertex {len(pts)}\n"
              + "".join(f"property float {p}\n" for p in props)
              + "end_header\n").encode("ascii")
    rows = []
    for x, y, z in pts:
        rows.append(struct.pack(
            "<17f", x, y, z, 0, 0, 1, 0.5, 0.5, 0.5, 0.9,
            0.01, 0.01, 0.01, 1, 0, 0, 0))
    path.write_bytes(header + b"".join(rows))


def _run_recon(paths):
    block = _between(SCAN_JS, "/* == ply:start == */",
                     "/* == ply:end == */")
    driver = (
        "import fs from 'node:fs';\n" + block + "\n"
        "const out = [];\n"
        "for (const p of process.argv.slice(2)) {\n"
        "  try {\n"
        "    const buf = fs.readFileSync(p);\n"
        "    const ab = buf.buffer.slice(buf.byteOffset, "
        "buf.byteOffset + buf.byteLength);\n"
        "    const parsed = parsePly(ab);\n"
        "    out.push({ count: parsed.count, format: parsed.format,\n"
        "               kind: parsed.kind,\n"
        "               scan: measureCloud(parsed.positions),\n"
        "               recon: measureReconstruction(parsed.positions) });\n"
        "  } catch (e) { out.push({ error: e.message }); }\n"
        "}\n"
        "console.log(JSON.stringify(out));\n")
    with tempfile.TemporaryDirectory() as tmp:
        dp = Path(tmp) / "driver.mjs"
        dp.write_text(driver)
        r = subprocess.run([NODE, str(dp)] + [str(p) for p in paths],
                           capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout)


def test_splat_parses_and_measures_in_relative_units():
    if not NODE:
        return
    with tempfile.TemporaryDirectory() as tmp:
        unit = Path(tmp) / "splat_unit.ply"
        big = Path(tmp) / "splat_big.ply"
        plain = Path(tmp) / "box_mm.ply"
        _write_binary_splat(unit, 1.0)
        _write_binary_splat(big, 100.0)
        _write_binary_mm(plain)
        unit_res, big_res, plain_res = _run_recon([unit, big, plain])

    # The splat property signature is detected; a plain scan is not
    # mistaken for one.
    assert unit_res["kind"] == "splat"
    assert big_res["kind"] == "splat"
    assert plain_res["kind"] == "scan"

    # Positions extract correctly through the extra properties.
    assert unit_res["count"] == 210
    assert unit_res["format"] == "binary_little_endian"
    m = unit_res["recon"]
    assert m["ok"] is True
    assert "relative" in m["unitNote"]
    for got, want in zip(m["extents"], TRUTH):
        assert abs(got - want) < 1e-6, (got, want)

    # The honesty contract: at x100 the SCAN path's millimetre rule
    # fires on these very points (42 raw -> 0.042 m) — proof the two
    # paths differ — while the reconstruction path reports the raw
    # relative extents, unrescaled.
    assert "millimetres" in big_res["scan"]["unitNote"]
    m = big_res["recon"]
    assert m["ok"] is True
    for got, want in zip(m["extents"], [t * 100 for t in TRUTH]):
        assert abs(got - want) < 1e-3, (got, want)


def test_reconstruction_wiring_is_distinct_from_scan():
    forge_js = (REPO / "assets" / "js" / "forge.js").read_text()
    assert "measureReconstruction" in SCAN_JS
    assert "measureReconstruction" in forge_js
    assert "RECONSTRUCTED (single photo)" in forge_js
    # a reconstruction never seeds and never wears the scan badge:
    # its card explains the missing scale instead of seeding
    assert "carries no real-world scale" in forge_js
    assert "runReconstruction" in forge_js


def test_scan_module_is_wired_for_the_forge_only():
    assert "window.RFScan" in SCAN_JS
    assert "parsePly" in SCAN_JS and "measureCloud" in SCAN_JS
    assert "renderPoints" in SCAN_JS
    # the unit rule is visible in the shipped code, not just the tests
    assert "file appears to be in millimetres" in SCAN_JS
    assert "bounding box" in SCAN_JS
