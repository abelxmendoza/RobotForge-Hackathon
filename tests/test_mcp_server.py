"""Read-only RobotForge MCP server (`robotforge mcp`).

What is pinned here:

1. The tools read the owner's robots from every Workshop export shape
   (bare spec, one robot with versions, a list, an account dump) and
   the public Robodex, and say clearly when something is missing.
2. Honesty: a spec that can't be parsed gives NOT_CHECKED with the
   reason, never a pass; Omega1's MEASURE_ME fields stay unknown.
3. Privacy: photos never leave the server.
4. Read-only: every registered tool carries readOnlyHint and no tool
   name suggests a write. (Needs the optional `mcp` package; skipped
   without it.)
"""
import asyncio
import json
from pathlib import Path

import pytest

from robotforge import mcp_tools as t

ROOT = Path(__file__).resolve().parent.parent
BURGER = json.loads((ROOT / "examples" / "turtlebot3-burger.json").read_text())
PHOTO = "data:image/jpeg;base64,AAAA"


def _garage_robot(rid="rover-1", name="My Rover"):
    v1 = dict(BURGER, name="my-rover")
    v2 = dict(v1, mass_kg=1.2)
    return {"id": rid, "name": name, "createdAt": "2026-11-10T00:00:00Z",
            "photo": PHOTO, "photoSet": [PHOTO],
            "versions": [
                {"id": "v1", "label": "Baseline", "source": "upload",
                 "createdAt": "2026-11-10T00:00:00Z", "spec": v1},
                {"id": "v2", "label": "Heavier", "source": "edit",
                 "createdAt": "2026-11-10T01:00:00Z", "spec": v2,
                 "estimatedPaths": ["mass_kg"]}]}


@pytest.fixture
def robots_dir(tmp_path):
    (tmp_path / "rover.json").write_text(json.dumps(_garage_robot()))
    (tmp_path / "burger-copy.json").write_text(json.dumps(BURGER))
    (tmp_path / "account.json").write_text(json.dumps({"data": {
        "rf.garage.v1": [
            _garage_robot("arm-9", "Desk Arm"),
            {"id": "half", "name": "Half Built", "versions": [
                {"id": "a", "label": "Baseline",
                 "spec": {"name": "half", "drivetrain": "skid_steer"}}]},
            dict(_garage_robot("gone", "Archived Bot"),
                 archivedAt="2026-11-01T00:00:00Z")],
        "rf.inventory.v1": [{"part": "lipo_4s_5200", "qty": 1,
                             "photo": PHOTO}]}}))
    (tmp_path / "notes.json").write_text(json.dumps({"hello": "world"}))
    (tmp_path / "broken.json").write_text("{not json")
    return tmp_path


def test_loads_every_export_shape(robots_dir):
    ws = t.Workspace(robots_dir)
    out = t.list_robots(ws)
    names = {r["name"] for r in out["mine"]}
    assert names == {"My Rover", "turtlebot3-burger", "Desk Arm",
                     "Half Built"}
    assert "Archived Bot" not in names
    assert any("notes.json" in p for p in out["load_problems"])
    assert any("broken.json" in p for p in out["load_problems"])
    assert len(out["robodex"]) >= 12


def test_no_folder_serves_robodex_only(monkeypatch):
    monkeypatch.delenv("ROBOTFORGE_ROBOTS_DIR", raising=False)
    ws = t.Workspace()
    out = t.list_robots(ws)
    assert out["mine"] == [] and "mine_status" in out
    with pytest.raises(t.ToolError, match="--robots"):
        t.get_robot(ws, "nothing-called-this")


def test_get_robot_versions_and_no_photos(robots_dir):
    ws = t.Workspace(robots_dir)
    r = t.get_robot(ws, "my rover")
    assert r["source"] == "mine"
    assert r["version"]["label"] == "Heavier"
    assert r["spec"]["mass_kg"] == 1.2
    assert [v["label"] for v in r["versions"]] == ["Baseline", "Heavier"]
    assert t.get_robot(ws, "rover-1", "baseline")["spec"]["mass_kg"] == \
        BURGER["mass_kg"]
    with pytest.raises(t.ToolError, match="Versions: Baseline, Heavier"):
        t.get_robot(ws, "rover-1", "v9")
    assert PHOTO not in json.dumps(t.get_inventory(ws))
    assert PHOTO not in json.dumps(t.strip_photos(_garage_robot()))


def test_checks_pass_fail_and_not_checked(robots_dir):
    ws = t.Workspace(robots_dir)
    ok = t.run_checks(ws, "my rover")
    assert ok["verdict"] in ("PASS", "PASS_WITH_WARNINGS", "FAIL")
    assert ok["estimated_fields"] == ["mass_kg"]
    assert "not_run" in ok["stability"]  # wheeled: no legs
    assert ok["rover"]["kind"] == "estimate"
    half = t.run_checks(ws, "half built")
    assert half["verdict"] == "NOT_CHECKED" and half["reason"]
    assert t.get_twin(ws, "half built")["twin"] is None


def test_robodex_lookups():
    ws = t.Workspace()
    with pytest.raises(t.ToolError, match="ambiguous"):
        t.run_checks(ws, "turtlebot3")
    twin = t.get_twin(ws, "#002", include_urdf=True)
    assert "base_link" in twin["links"] and twin["urdf"].startswith("<")
    ev = t.get_sim_evidence(ws, "andino")
    assert ev["status"] == "FAIL" and ev["runs"]
    assert t.get_sim_evidence(ws, "dex:#007")["robot"] == "Unitree Go2"
    parts = t.get_parts_list(ws, "andino")
    assert {p["part"] for p in parts["parts"]} >= {"motor", "wheel",
                                                   "battery"}
    assert "not included" in parts["prices"]
    electronics = [p["what"] for p in parts["parts"]
                   if p["part"] == "electronics"]
    assert any("L298N" in e for e in electronics)
    assert any("buck" in e for e in electronics)
    assert not any("Battery" in e for e in electronics)
    burger = t.run_checks(ws, "#002")
    if any(c["status"] == "FAIL" for c in burger["rover"]["checks"]):
        assert burger["verdict"] == "FAIL"
    assert t.search_parts(ws, "lipo")["total"] >= 1
    assert t.get_part(ws, "lipo_4s_5200")["part"]["id"] == "lipo_4s_5200"


def test_inventory_only_account_dump(tmp_path):
    (tmp_path / "parts.json").write_text(json.dumps(
        {"rf.inventory.v1": [{"part": "lipo_4s_5200", "qty": 2}]}))
    ws = t.Workspace(tmp_path)
    assert ws.load_problems == []
    assert t.get_inventory(ws)["inventory"][0]["qty"] == 2


def test_mine_has_no_recorded_gate_run(robots_dir):
    ws = t.Workspace(robots_dir)
    assert t.get_sim_evidence(ws, "my rover")["status"] == "NOT_RUN"


def test_omega1_records_keep_unknowns():
    out = t.get_omega1_records(t.Workspace(), "")
    levels = {f.get("evidence") for f in out["fields"].values()}
    assert "DOCUMENTED" in levels
    assert "MEASURE_ME" in out["evidence_levels"]
    assert "Do not fill them in" in out["note"]


def test_server_tools_are_all_read_only(robots_dir):
    pytest.importorskip("mcp")
    from robotforge.mcp_server import build_server
    server = build_server(str(robots_dir))
    tools = asyncio.run(server.list_tools())
    names = {tool.name for tool in tools}
    assert {"list_robots", "get_robot", "run_checks", "get_twin",
            "get_sim_evidence", "get_parts_list"} <= names
    for tool in tools:
        ann = tool.annotations.model_dump(by_alias=True)
        assert ann["readOnlyHint"] is True
        assert ann["destructiveHint"] is False
        assert not any(w in tool.name for w in
                       ("set", "save", "write", "delete", "apply", "update"))
