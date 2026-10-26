"""Identity lookup: parsing, ranking, licenses, assets, pull — all offline.

The GitHub fixtures are synthetic but shaped exactly like the real API
responses (search items, repo license object, recursive git tree). No test
here makes a network call: lookup_robot and pull_candidate take injected
fetch callables, and the CLI tests patch the cli module's references.
"""
import io
import json
import sys
import urllib.parse
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge import cli
from robotforge.lookup import (LookupError, format_report, lookup_robot,
                               parse_identity, pull_candidate,
                               report_to_dict)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

def _repo_item(full_name, stars, license_spdx, description="",
               branch="main"):
    lic = None
    if license_spdx:
        lic = {"key": license_spdx.lower(), "name": license_spdx,
               "spdx_id": license_spdx}
    owner = full_name.split("/")[0]
    return {"full_name": full_name,
            "html_url": f"https://github.com/{full_name}",
            "owner": {"login": owner},
            "description": description,
            "stargazers_count": stars,
            "license": lic,
            "default_branch": branch}


def _search_payload():
    return {"total_count": 3, "items": [
        _repo_item("ROBOTIS-GIT/turtlebot3", 900, "Apache-2.0",
                   "ROS packages for TurtleBot3", branch="humble"),
        _repo_item("someuser/turtlebot3-cool-stuff", 5000, "MIT",
                   "My turtlebot3 mods and experiments"),
        _repo_item("norobotics/turtlebot3-docker", 12, None,
                   "docker image for turtlebot3"),
    ]}


def _tree(entries):
    return {"tree": [{"path": p, "type": "blob", "size": 100,
                      "sha": "a" * 40} for p in entries],
            "truncated": False}


TREES = {
    "ROBOTIS-GIT/turtlebot3": _tree([
        "LICENSE",
        "turtlebot3_description/urdf/turtlebot3_waffle_pi.urdf.xacro",
        "turtlebot3_description/urdf/turtlebot3_burger.urdf.xacro",
        "turtlebot3_description/urdf/waffle_pi_base.stl",
        "turtlebot3_description/meshes/bases/waffle_pi_base.stl",
        "turtlebot3_bringup/launch/robot.launch.py",
        "README.md",
    ]),
    "someuser/turtlebot3-cool-stuff": _tree([
        "LICENSE", "model.urdf", "notes.txt",
    ]),
    "norobotics/turtlebot3-docker": _tree([
        "Dockerfile", "cad/body.step",
    ]),
}


def fake_fetch(url: str) -> dict:
    if "/search/repositories" in url:
        q = urllib.parse.parse_qs(
            urllib.parse.urlparse(url).query)["q"][0]
        if q.startswith("turtlebot3 in:"):
            return _search_payload()
        return {"total_count": 0, "items": []}
    if "/git/trees/" in url:
        for name, payload in TREES.items():
            if f"/repos/{name}/" in url:
                return payload
        return _tree([])
    raise AssertionError(f"unexpected fetch URL: {url}")


def empty_fetch(url: str) -> dict:
    if "/search/repositories" in url:
        return {"total_count": 0, "items": []}
    raise AssertionError(f"unexpected fetch URL: {url}")


# ---------------------------------------------------------------------------
# identity parsing
# ---------------------------------------------------------------------------

def test_parse_identity():
    t = parse_identity("TurtleBot 3 Waffle Pi")
    assert t.brand == "turtlebot" and t.number == "3"
    assert t.brand_compact == "turtlebot3"
    assert t.compact == "turtlebot3wafflepi"
    assert t.variant_joined == "waffle_pi"
    assert t.slug == "turtlebot-3-waffle-pi"
    assert len(t.queries) == len(set(t.queries))  # deduped
    assert any("ros2" in q for q in t.queries)


def test_parse_identity_rejects_garbage():
    for bad in ("", "!!!", "---"):
        try:
            parse_identity(bad)
            raise AssertionError(f"expected LookupError for {bad!r}")
        except LookupError:
            pass


# ---------------------------------------------------------------------------
# search / ranking / licenses / assets
# ---------------------------------------------------------------------------

def test_ranking_official_beats_popular_community():
    report = lookup_robot("TurtleBot 3 Waffle Pi", fetch_json=fake_fetch)
    names = [r.full_name for r in report.repos]
    assert names[0] == "ROBOTIS-GIT/turtlebot3"      # 900 stars, official
    assert names[1] == "someuser/turtlebot3-cool-stuff"  # 5000 stars
    assert report.repos[0].provenance == "official"
    assert report.repos[1].provenance == "community"
    assert any("known vendor org" in w for w in report.repos[0].why)


def test_license_surfacing_including_missing():
    report = lookup_robot("TurtleBot 3 Waffle Pi", fetch_json=fake_fetch)
    by_name = {r.full_name: r for r in report.repos}
    assert by_name["ROBOTIS-GIT/turtlebot3"].license_label == "Apache-2.0"
    assert by_name["norobotics/turtlebot3-docker"].license_label == \
        "not stated"
    d = report_to_dict(report)
    docker = [r for r in d["repos"]
              if r["full_name"] == "norobotics/turtlebot3-docker"][0]
    assert docker["license"] == "not stated"
    text = format_report(report)
    assert "license: not stated" in text
    assert "license: Apache-2.0" in text


def test_asset_extraction_and_kinds():
    report = lookup_robot("TurtleBot 3 Waffle Pi", fetch_json=fake_fetch)
    official = report.repos[0]
    kinds = {a.path: a.kind for a in official.assets}
    assert kinds["turtlebot3_description/urdf/"
                 "turtlebot3_waffle_pi.urdf.xacro"] == "urdf_xacro"
    assert kinds["turtlebot3_description/meshes/bases/"
                 "waffle_pi_base.stl"] == "mesh"
    assert "turtlebot3_bringup/launch/robot.launch.py" not in kinds
    assert "LICENSE" not in kinds  # a license file is not a model asset
    community = report.repos[1]
    assert {a.path: a.kind for a in community.assets} == \
        {"model.urdf": "urdf"}


def test_best_candidate_is_official_variant_model():
    report = lookup_robot("TurtleBot 3 Waffle Pi", fetch_json=fake_fetch)
    assert report.best is not None
    assert report.best.repo.full_name == "ROBOTIS-GIT/turtlebot3"
    assert report.best.asset.path.endswith("turtlebot3_waffle_pi.urdf.xacro")
    text = format_report(report)
    assert "Best twin candidate: ROBOTIS-GIT/turtlebot3" in text
    assert "heuristics" in text  # the report labels its own rankings


def test_no_results_is_a_valid_report():
    report = lookup_robot("Nonexistent Robot XYZ", fetch_json=empty_fetch)
    assert report.repos == [] and report.best is None
    text = format_report(report)
    assert "No public model found" in text
    assert "photo-estimate path applies" in text
    assert report_to_dict(report)["best_candidate"] is None


def test_no_model_in_results_still_reports():
    def fetch(url):
        if "/search/repositories" in url:
            q = urllib.parse.parse_qs(
                urllib.parse.urlparse(url).query)["q"][0]
            if q.startswith("turtlebot3 in:"):
                return {"total_count": 1, "items": [
                    _repo_item("norobotics/turtlebot3-docker", 12, None,
                               "docker only")]}
            return {"total_count": 0, "items": []}
        return _tree(["Dockerfile"])
    report = lookup_robot("TurtleBot 3 Waffle Pi", fetch_json=fetch)
    assert report.repos and report.best is None
    assert "photo-estimate path applies" in format_report(report)


# ---------------------------------------------------------------------------
# pull
# ---------------------------------------------------------------------------

MODEL_TEXT = """<?xml version="1.0"?>
<robot name="turtlebot3_waffle_pi">
  <link name="base_link">
    <visual><geometry>
      <mesh filename="waffle_pi_base.stl"/>
    </geometry></visual>
  </link>
  <xacro:include filename="$(find turtlebot3_description)/urdf/common.xacro"/>
  <xacro:include filename="package://turtlebot3_description/urdf/extra.xacro"/>
  <xacro:include filename="missing_part.xacro"/>
</robot>
"""


def fake_bytes(url: str) -> bytes:
    if url.endswith("turtlebot3_waffle_pi.urdf.xacro"):
        return MODEL_TEXT.encode()
    if url.endswith("/LICENSE"):
        return b"Apache License\nVersion 2.0\n"
    if url.endswith("waffle_pi_base.stl"):
        return b"solid waffle_pi_base\nendsolid\n"
    raise AssertionError(f"unexpected download URL: {url}")


def test_pull_writes_model_license_sibling_and_manifest():
    import tempfile
    report = lookup_robot("TurtleBot 3 Waffle Pi", fetch_json=fake_fetch)
    with tempfile.TemporaryDirectory() as td:
        result = pull_candidate(report, Path(td), fetch_bytes=fake_bytes)
        dest = result.dest
        assert dest.name == "turtlebot-3-waffle-pi"
        model = dest / "turtlebot3_description/urdf/" \
                       "turtlebot3_waffle_pi.urdf.xacro"
        assert model.read_text() == MODEL_TEXT
        assert (dest / "LICENSE").read_text().startswith("Apache License")
        sibling = dest / "turtlebot3_description/urdf/waffle_pi_base.stl"
        assert sibling.exists()  # same-directory mesh the model references
        # sub-directory mesh with the same name was NOT chased
        assert not (dest / "turtlebot3_description/meshes").exists()
        manifest = json.loads((dest / "manifest.json").read_text())
        assert manifest["repo"] == "ROBOTIS-GIT/turtlebot3"
        assert manifest["license_label"] == "Apache-2.0"
        assert manifest["candidate"]["path"].endswith(
            "turtlebot3_waffle_pi.urdf.xacro")
        assert manifest["retrieved_at"]
        pulled = {f["path"] for f in manifest["files"]}
        assert "LICENSE" in pulled and len(pulled) == 3
        unresolved = " ".join(manifest["unresolved_references"])
        assert "$(find turtlebot3_description)" in unresolved
        assert "package://turtlebot3_description" in unresolved
        assert "missing_part.xacro" in unresolved


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def test_cli_lookup_with_fixture_fetch():
    orig = cli.lookup_robot
    cli.lookup_robot = lambda identity: lookup_robot(
        identity, fetch_json=fake_fetch)
    try:
        out = io.StringIO()
        with redirect_stdout(out):
            rc = cli.main(["lookup", "TurtleBot 3 Waffle Pi"])
        assert rc == 0
        text = out.getvalue()
        assert "ROBOTIS-GIT/turtlebot3" in text
        assert "Best twin candidate" in text

        out = io.StringIO()
        with redirect_stdout(out):
            rc = cli.main(["lookup", "TurtleBot 3 Waffle Pi", "--json"])
        assert rc == 0
        parsed = json.loads(out.getvalue())
        assert parsed["identity"] == "TurtleBot 3 Waffle Pi"
        assert parsed["best_candidate"]["path"].endswith(
            "turtlebot3_waffle_pi.urdf.xacro")
    finally:
        cli.lookup_robot = orig


def test_cli_lookup_error_is_clean():
    orig = cli.lookup_robot

    def boom(identity):
        raise LookupError("GitHub API rate limit exceeded")

    cli.lookup_robot = boom
    try:
        err = io.StringIO()
        with redirect_stderr(err):
            rc = cli.main(["lookup", "TurtleBot 3"])
        assert rc == 2
        assert "lookup error:" in err.getvalue()
        assert "Traceback" not in err.getvalue()
    finally:
        cli.lookup_robot = orig
