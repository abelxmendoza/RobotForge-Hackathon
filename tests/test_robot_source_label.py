"""Card source-label consistency (web-next lib/robotSource): the
badge on a robot card must agree with the Robodex source tabs.

PR #61's tabs file a catalog robot whose own record marks it a
photo draft (TurtleBot3 Waffle Pi — provenance note says "photo
draft") under From photos, but the card pill read the catalog
`source` field alone and still said "Researched" — two labels for
one robot on one page. The fix is one shared rule: isPhotoDraft
lives in lib/robotSource, effectiveSource() corrects the recorded
source with it, sourceBadge() and both card components read the
effective source, and DexSources imports the same helper for the
tabs, so the two can never drift again.

Follows test_chat_conversation.py's pattern: the real TS module
runs in node (type-stripped import) against the real catalog data;
without node, the static wiring checks still hold.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LIB_TS = REPO / "web-next/src/lib/robotSource.ts"
DEX_TS = REPO / "web-next/src/components/robots/DexSources.tsx"
CARDS = [
    REPO / "web-next/src/components/robots/RobotCard.tsx",
    REPO / "web-next/src/components/home/RobotCard.tsx",
]

LIB_SRC = LIB_TS.read_text()
DEX_SRC = DEX_TS.read_text()


def test_shared_photo_draft_rule_wiring():
    # the rule lives in the lib, next to the badge it corrects
    assert "export function isPhotoDraft" in LIB_SRC
    assert "export function effectiveSource" in LIB_SRC
    assert 'isPhotoDraft(robot) ? "photo" : robot.source' in LIB_SRC
    assert "ROBOT_SOURCE_META[effectiveSource(robot)].badge" in LIB_SRC
    # the tabs import the SAME helper — no second copy of the regex
    assert 'import { isPhotoDraft } from "@/lib/robotSource"' in DEX_SRC
    assert "export { isPhotoDraft }" in DEX_SRC
    assert DEX_SRC.count("/photo draft/i") == 0
    # both card components style the pill by the effective source
    for card in CARDS:
        src = card.read_text()
        assert "effectiveSource(robot)" in src, card
        assert "source-${robot.source}" not in src, card


NODE_SCRIPT = r"""
import fs from 'node:fs';
const root = process.argv[2];
const robots = JSON.parse(fs.readFileSync(root + '/catalog/robots.json', 'utf8')).robots;
const RS = await import(root + '/web-next/src/lib/robotSource.ts');
const out = {};
for (const r of robots) {
  out[r.name] = {
    recorded: r.source,
    effective: RS.effectiveSource(r),
    badge: RS.sourceBadge(r),
    photoDraft: RS.isPhotoDraft(r),
  };
}
console.log(JSON.stringify(out));
"""


def _run_node():
    node = shutil.which("node")
    if not node:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "source.mjs"
        script.write_text(NODE_SCRIPT)
        proc = subprocess.run(
            [node, str(script), str(REPO)],
            capture_output=True, text=True, timeout=120,
        )
        assert proc.returncode == 0, proc.stderr
        return json.loads(proc.stdout)


def test_card_labels_agree_with_tabs():
    out = _run_node()
    if out is None:
        return  # no node on this machine; wiring checks above still hold
    assert len(out) == 11
    # exactly one catalog robot is a photo draft, and it is Waffle Pi
    drafts = [n for n, v in out.items() if v["photoDraft"]]
    assert drafts == ["TurtleBot3 Waffle Pi"]
    # its card now reads From photo (the tabs' From photos category),
    # not Researched; every other robot's label is unchanged
    for name, v in out.items():
        if name == "TurtleBot3 Waffle Pi":
            assert v["effective"] == "photo"
            assert v["badge"] == "From photo"
        else:
            assert v["effective"] == v["recorded"] == "researched", name
            assert v["badge"] == "Researched", name
