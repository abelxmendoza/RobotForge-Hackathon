"""My Parts: grid + Finder-style columns over a parts tree.

The tree is robot (or shared shelf / tools) > subsystem > part > child.
Only the child link is stored (InventoryPart.parent_id); lib/partsTree.ts
holds the rules, exercised here in Node.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next" / "src"

RUN = r"""
import * as T from "./partsTree.ts";
const part = (id, category, extra = {}) => ({ id, name: id, category, reality: "real", section: category === "tool" ? "tools" : "parts", quantity: 1, status: "confirmed", robot_id: null, parent_id: null, ...extra });
let parts = [
  part("lidar", "sensor", { reality: "sim_only", robot_id: "r1" }),
  part("usb", "cable"),
  part("motor", "motor", { quantity: 2 }),
  part("encoder", "sensor"),
  part("iron", "tool"),
  part("orphan", "other", { parent_id: "gone" }),
  part("loopA", "other", { parent_id: "loopB" }),
  part("loopB", "other", { parent_id: "loopA" }),
];
const out = {};
out.sub = parts.map((p) => T.subsystemOf(p));
parts = T.setParent(parts, "usb", "lidar");
out.usbRobot = parts.find((p) => p.id === "usb").robot_id;
out.usbReality = parts.find((p) => p.id === "usb").reality;
parts = T.setParent(parts, "encoder", "motor");
try { T.setParent(parts, "motor", "encoder"); out.loop = "allowed"; } catch (e) { out.loop = "refused"; }
out.allowedForMotor = T.allowedParents(parts, "motor").map((p) => p.id).sort();
out.toolUnderPart = T.allowedParents(parts, "iron").map((p) => p.id);
parts = T.setRobot(parts, "motor", "r2");
out.encoderRobot = parts.find((p) => p.id === "encoder").robot_id;
out.orphanParent = T.effectiveParent(parts, parts.find((p) => p.id === "orphan"));
out.loopParent = T.effectiveParent(parts, parts.find((p) => p.id === "loopA"));
const shelves = T.shelvesFor([{ id: "r1", name: "Omega1" }, { id: "r2", name: "Rover" }]);
out.shelves = shelves.map((s) => s.label);
const r1 = T.partsOnShelf(parts, shelves[0], [{ id: "r1" }, { id: "r2" }]);
out.r1 = r1.map((p) => p.id).sort();
out.r1Sensing = T.rootParts(r1, parts, "sensing").map((p) => p.id);
out.r1Frame = T.rootParts(r1, parts, "frame").map((p) => p.id);
out.underLidar = T.childrenOf(parts, "lidar").map((p) => p.id);
out.motorQty = parts.find((p) => p.id === "motor").quantity;
const w = T.withAncestors(parts, [parts.find((p) => p.id === "encoder")]);
out.filtered = w.parts.map((p) => p.id).sort(); out.context = [...w.context];
const rm = T.removePart(parts, "lidar");
out.promoted = rm.promoted; out.usbAfter = rm.parts.find((p) => p.id === "usb").parent_id;
process.stdout.write(JSON.stringify(out));
"""


def run(tmp_path: Path) -> dict:
    lib = WEB / "lib"
    inv = (lib / "inventory.ts").read_text()
    tree = (lib / "partsTree.ts").read_text().replace("from './inventory'", "from './inventory.ts'")
    (tmp_path / "inventory.ts").write_text(inv)
    (tmp_path / "partsTree.ts").write_text(tree)
    (tmp_path / "package.json").write_text('{"type": "module"}')
    (tmp_path / "run.mjs").write_text(RUN)
    proc = subprocess.run(["node", "--experimental-strip-types", "run.mjs"],
                          cwd=tmp_path, capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr[-2000:]
    return json.loads(proc.stdout)


def test_tree_rules(tmp_path: Path) -> None:
    out = run(tmp_path)
    assert out["sub"][:5] == ["sensing", "frame", "drive", "sensing", "tools"]
    # A child moves to its parent's robot and keeps its own label.
    assert out["usbRobot"] == "r1" and out["usbReality"] == "real"
    assert out["loop"] == "refused"
    assert "encoder" not in out["allowedForMotor"] and "motor" not in out["allowedForMotor"]
    assert out["toolUnderPart"] == []
    # Moving a parent to another robot carries its children.
    assert out["encoderRobot"] == "r2"
    # Dangling and looping parents read as no parent.
    assert out["orphanParent"] is None and out["loopParent"] is None
    assert out["shelves"] == ["Omega1", "Rover", "Shared shelf", "Tools"]
    assert out["r1"] == ["lidar", "usb"]
    assert out["r1Sensing"] == ["lidar"] and out["r1Frame"] == []
    assert out["underLidar"] == ["usb"]
    assert out["motorQty"] == 2  # quantities are never summed
    # A filter match keeps its parent visible, marked as context.
    assert out["filtered"] == ["encoder", "motor"] and out["context"] == ["motor"]
    # Deleting a parent promotes its children.
    assert out["promoted"] == 1 and out["usbAfter"] is None


def test_inventory_page_wiring() -> None:
    inv = (WEB / "components/inventory/Inventory.tsx").read_text()
    cols = (WEB / "components/inventory/PartsColumns.tsx").read_text()
    assert "rf.parts.view" in inv and ">Grid</button>" in inv and ">Columns</button>" in inv
    assert 'className="inv-drawer" role="dialog" aria-modal="true"' in inv
    assert "e.key === 'Escape'" in inv
    assert "<span>Part of</span>" in inv and "allowedParents(all,p.id)" in inv
    assert "removePart(" in inv and "moved up one level" in inv
    assert "setRobot(" in inv
    assert "withAncestors(all, shown)" in cols
    assert "ArrowRight" in cols and "ArrowLeft" in cols
    assert "pc-focus" in cols and "← Back" in cols
    assert "parent_id:typeof p.parent_id==='string'" in (WEB / "lib/inventory.ts").read_text()


def test_demo_shelf_has_one_honest_nested_example() -> None:
    seed = (WEB / "lib/demoSeed.ts").read_text()
    assert "parent_id: 'demo-rplidar_a1'" in seed
    assert "USB serial adapter board (demo sample)" in seed
