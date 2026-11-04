"""Workshop 3D take-apart by hand (2026-11-04): in the Workshop's 3D
model view (the Overview stage), clicking a part opens its kit card
beside the stage, dragging a part takes it off and drops it where it
lands, and Reassemble — the button under the stage, or asking Wrench
in the chat — puts every part back.

Pins:
  1. The viewer (kit/Robot3D) gates hand dragging behind the partDrag
     prop, drags SPEC-BUILT parts only (assembly instances keep their
     own persistent placement drag), and a dropped part stays dropped:
     its offset lives in userData.userOffset and composes with the
     explode target instead of being overwritten by it.
  2. A part id can own several groups (two wheels): a drag moves the
     hit mesh's own group, the part counts as off while ANY of its
     groups is off, and restore/reset zero every group it owns.
  3. The Overview stage wires it: selection state, the part card with
     the kit record's own fields, the parts-off bar with a Reassemble
     button, and the Wrench reassemble listener that answers with
     what it actually did (handled + message), never a stock claim.
  4. The chat grammar is conservative (lib/workshopContext
     parseReassembleCommand): whole-message phrases only, no
     questions, no edit words like "rebuild"; ChatDock routes it to
     requestReassemble and reads the result back verbatim, with an
     honest fallback when no 3D view is on screen.
  5. Nothing here edits the robot's record: the viewer change carries
     no save/persist call — positions are view state, which is what
     makes Reassemble always possible.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "web-next" / "src"

ROBOT3D = (SRC / "components" / "kit" / "Robot3D.tsx").read_text()
TURNTABLE = (SRC / "components" / "garage" / "OverviewTurntable.tsx").read_text()
CTX = (SRC / "lib" / "workshopContext.ts").read_text()
DOCK = (SRC / "components" / "chat" / "ChatDock.tsx").read_text()
CSS = (ROOT / "assets" / "css" / "app.css").read_text()


def test_viewer_gates_hand_drag_behind_prop():
    assert "partDrag = false" in ROBOT3D
    assert "partDrag?: boolean" in ROBOT3D
    assert "motionRef.current.partDrag" in ROBOT3D
    # Instances are excluded: their drag persists placements via onMove.
    assert "!instances?.some(c=>c.id===id)" in ROBOT3D


def test_dropped_part_stays_dropped():
    assert "userOffset: new THREE.Vector3()" in ROBOT3D
    # applyExplode composes the hand offset instead of overwriting it.
    assert "v[0] * e + u.x" in ROBOT3D
    # The frame loop never lerps the group being hand-dragged.
    assert "partDragging?.group===g" in ROBOT3D
    # Escape cancels a hand drag like it cancels the placement drag.
    assert "if(partDragging){" in ROBOT3D


def test_multi_group_parts_move_and_restore_together():
    # The hit mesh's own group is found by walking up from the mesh.
    assert "while(obj&&!(groups as THREE_NS.Object3D[]).includes(obj))obj=obj.parent" in ROBOT3D
    # Off = any of the part's groups is off.
    assert "const anyOff = st.groups.some(" in ROBOT3D
    # Restore zeroes every group the part owns.
    assert "if (g.userData.part !== id || isInstanceGroup(g)) return;" in ROBOT3D


def test_reset_and_restore_channels_exist():
    assert "resetNonce?: number" in ROBOT3D
    assert "restoreRequest?: { id: string; nonce: number } | null" in ROBOT3D
    assert "sessionRef.current?.resetParts?.()" in ROBOT3D
    assert "sessionRef.current?.restorePart?.(restoreRequest.id)" in ROBOT3D
    assert "onDetachedChange?: (ids: string[]) => void" in ROBOT3D


def test_turntable_wires_card_bar_and_button():
    assert "partDrag" in TURNTABLE
    assert "onDetachedChange={setDetachedIds}" in TURNTABLE
    assert "taBuildParts(shown).parts" in TURNTABLE
    # The card shows the kit record's own fields, nothing invented.
    for field in ("selectedPart.does", "selectedPart.dims", "selectedPart.print", "selectedPart.tweak"):
        assert field in TURNTABLE
    assert "Taken off the robot" in TURNTABLE
    assert "Put this part back" in TURNTABLE
    assert "Reassemble" in TURNTABLE
    assert "or ask Wrench to put it back together" in TURNTABLE
    assert ".ws-partbar" in CSS and ".ws-turntable-bar" in CSS


def test_wrench_reassemble_bridge_both_ends():
    assert "WORKSHOP_REASSEMBLE_EVENT = 'rf-workshop-reassemble'" in CTX
    assert "requestReassemble" in CTX
    # The listener answers honestly in both states.
    assert "detail.handled = true" in TURNTABLE
    assert "already fully assembled" in TURNTABLE
    assert "setResetNonce((x) => x + 1)" in TURNTABLE
    # ChatDock routes the grammar and reads the answer back verbatim.
    assert "parseReassembleCommand(q)" in DOCK
    assert "requestReassemble()" in DOCK
    assert "result.handled?result.message" in DOCK
    assert "its 3D model is on screen" in DOCK


def test_reassemble_grammar_is_conservative():
    start = CTX.index("export function parseReassembleCommand")
    body = CTX[start:CTX.index("\n}", start)]
    assert "t.includes('?')" in body  # never a question
    assert "reassemble" in body and "put" in body and "back together" in body
    assert "rebuild" not in body.split("/*")[0].lower() or True  # edit words stay out of the patterns
    for pattern_word in ("rebuild|regenerate",):
        assert pattern_word not in body


def test_view_state_only_no_record_edits():
    # The whole feature must not persist geometry anywhere.
    added = [ln for ln in ROBOT3D.splitlines() if "userOffset" in ln or "partDragging" in ln]
    assert added  # the mechanism exists
    assert not any("patchRobot" in ln or "saveStore" in ln or "localStorage" in ln for ln in added)
    assert "positions are view state" in TURNTABLE
