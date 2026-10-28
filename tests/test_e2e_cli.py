"""End-to-end CLI demo path in a temp dir (hardening sweep):
new -> validate -> urdf -> describe --mock -> site, run as real
subprocesses exactly as a user would, no network, no Gazebo."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
ENV = dict(os.environ, PYTHONPATH=str(ROOT / "src"))


def _run(argv, cwd):
    return subprocess.run(
        [sys.executable, "-m", "robotforge.cli", *argv],
        capture_output=True, text=True, env=ENV, cwd=cwd, timeout=120)


def test_cli_demo_path_end_to_end(tmp_path):
    # 1. new: starter spec from a kind
    spec_path = tmp_path / "e2e-bot.json"
    proc = _run(["new", "differential", "--name", "e2e-bot",
                 "--out", str(spec_path)], tmp_path)
    assert proc.returncode == 0, proc.stderr
    assert spec_path.is_file()

    # 2. validate: the starter spec passes engineering checks
    proc = _run(["validate", str(spec_path)], tmp_path)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "[ERROR]" not in proc.stdout

    # 3. urdf: a twin is generated from the valid spec
    urdf_path = tmp_path / "e2e-bot.urdf"
    proc = _run(["urdf", str(spec_path), "--out", str(urdf_path)],
                tmp_path)
    assert proc.returncode == 0, proc.stderr
    assert "<robot" in urdf_path.read_text()

    # 4. describe --mock: offline natural-language parse to a spec
    proc = _run(["describe", "a warehouse rover", "--mock",
                 "--out", str(tmp_path / "described.json")], tmp_path)
    assert proc.returncode == 0, proc.stderr
    described = json.loads((tmp_path / "described.json").read_text())
    assert described["name"]

    # 5. site: the whole web app regenerates into a fresh root
    site_root = tmp_path / "site"
    site_root.mkdir()
    proc = _run(["site", "--root", str(site_root)], tmp_path)
    assert proc.returncode == 0, proc.stderr
    written = [p for p in site_root.rglob("*.html")]
    assert written, "site wrote no pages"
    assert (site_root / "app" / "forge" / "index.html").is_file()
