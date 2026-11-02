"""A Workshop robot can carry several GitHub repos (firmware, ROS, CAD…).

GarageRobot keeps `repoImport` as the first repo so robots saved before
this change still load; extra repos live in `repos`. robotRepos(),
attachRepo() and detachRepo() in lib/garage.ts are the only way the UI
reads or changes them.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next" / "src"
GARAGE_TS = WEB / "lib" / "garage.ts"

RUN = r"""
import { robotRepos, attachRepo, detachRepo } from "./garage.ts";
const spec = (owner, repo, sha) => ({
  kind: "repo-import", name: repo, parts: [], model: null,
  provenance: { repoUrl: `https://github.com/${owner}/${repo}`, owner, repo, commitSha: sha },
});
const names = (r) => robotRepos(r).map((x) => x.provenance.repo + "@" + x.provenance.commitSha);
const out = {};
let r = { id: "r1", name: "Omega1", createdAt: "", versions: [] };
out.empty = names(r);
r = attachRepo(r, spec("abelxmendoza", "Omega-Code", "aaa"));
out.one = names(r); out.oneHasRepos = "repos" in r;
r = attachRepo(r, spec("abelxmendoza", "omega-ros", "bbb"));
r = attachRepo(r, spec("abelxmendoza", "omega-cad", "ccc"));
out.three = names(r); out.firstIsPrimary = r.repoImport.provenance.repo;
r = attachRepo(r, spec("abelxmendoza", "omega-ros", "ddd"));
out.updated = names(r);
r = attachRepo(r, spec("AbelXMendoza", "OMEGA-ROS", "eee"));
out.caseInsensitive = robotRepos(r).length;
r = attachRepo(r, spec("abelxmendoza", "omega-ros", "ddd"));
r = detachRepo(r, "https://github.com/abelxmendoza/Omega-Code");
out.afterDetachFirst = names(r); out.promoted = r.repoImport.provenance.repo;
r = detachRepo(r, "https://github.com/abelxmendoza/omega-ros");
r = detachRepo(r, "https://github.com/abelxmendoza/omega-cad");
out.none = names(r); out.keys = Object.keys(r).sort();
const legacy = { id: "old", name: "Old", createdAt: "", versions: [], repoImport: spec("a", "b", "c") };
out.legacy = names(legacy);
process.stdout.write(JSON.stringify(out));
"""


def test_helpers_attach_update_detach(tmp_path: Path) -> None:
    (tmp_path / "garage.ts").write_text(GARAGE_TS.read_text())
    (tmp_path / "package.json").write_text('{"type": "module"}')
    (tmp_path / "run.mjs").write_text(RUN)
    proc = subprocess.run(
        ["node", "--experimental-strip-types", "run.mjs"],
        cwd=tmp_path, capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr[-2000:]
    out = json.loads(proc.stdout)
    assert out["empty"] == []
    assert out["one"] == ["Omega-Code@aaa"] and out["oneHasRepos"] is False
    assert out["three"] == ["Omega-Code@aaa", "omega-ros@bbb", "omega-cad@ccc"]
    assert out["firstIsPrimary"] == "Omega-Code"
    # Re-importing the same repo replaces it in place, never a duplicate.
    assert out["updated"] == ["Omega-Code@aaa", "omega-ros@ddd", "omega-cad@ccc"]
    # GitHub names are case-insensitive: a different spelling updates, too.
    assert out["caseInsensitive"] == 3
    # Detaching the first repo promotes the next one.
    assert out["afterDetachFirst"] == ["omega-ros@ddd", "omega-cad@ccc"]
    assert out["promoted"] == "omega-ros"
    assert out["none"] == []
    assert "repoImport" not in out["keys"] and "repos" not in out["keys"]
    assert out["legacy"] == ["b@c"]


def test_import_page_can_add_to_an_existing_robot() -> None:
    src = (WEB / "components" / "import" / "RepoImport.tsx").read_text()
    assert 'q.get("attach")' in src
    assert "A new robot" in src
    assert "Add this repo to ${targetRobot.name}" in src
    assert "attachRepo(r, specimen)" in src
    assert "attachRepo(r, next)" in src  # edits on the import page save to the right repo
    assert 'q.get("src")' in src


def test_workshop_lists_every_repo_with_add_and_detach() -> None:
    src = (WEB / "components" / "garage" / "Garage.tsx").read_text()
    assert 'aria-label="Code repos"' in src
    assert "robotRepos(robot).map" in src
    assert "/import/?attach=" in src
    assert "Yes, detach" in src
    assert "detachRepo(r, repoUrl)" in src
    assert "repos` : 'From repo'" in src
