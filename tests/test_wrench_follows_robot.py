"""Wrench follows the Workshop robot: a "Working on" line, action chips
per tab, one-tap Workshop actions (RealSense window, tab switch), and
per-robot notes that ride along with every question about that robot.
The pure helpers run in Node; the wiring is guarded by source checks."""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next/src"
GARAGE = (WEB / "components/garage/Garage.tsx").read_text()
DOCK = (WEB / "components/chat/ChatDock.tsx").read_text()
BAR = (WEB / "components/chat/ChatBar.tsx").read_text()
MSGS = (WEB / "components/chat/ChatMessages.tsx").read_text()

RUN = r"""
import assert from 'node:assert/strict';
import { withNote, noteContextLines, notesFor, parseRememberCommand, cleanNoteText, NOTE_MAX_CHARS } from './robotNotes.ts';
import { parseWorkshopAction, buildWsContext, workshopTabChips, workingOnLabel, isWorkshopRobotQuestion, snapshotAnswer } from './workshopContext.ts';

// Remembering.
assert.equal(parseRememberCommand('remember that the left motor stalls'), 'the left motor stalls');
assert.equal(parseRememberCommand('Note: battery is a 2S 2200 mAh'), 'battery is a 2S 2200 mAh');
assert.equal(parseRememberCommand('Wrench, remember the servo horn is cracked'), 'the servo horn is cracked');
assert.equal(parseRememberCommand('what do you remember?'), null);
assert.equal(parseRememberCommand('remember'), null);
const now = new Date('2026-11-04T05:00:00Z');
let all = withNote([], 'omega1', '  the left   motor stalls ', 'you', now, 'n1');
assert.deepEqual(all.map((n) => [n.robotId, n.text, n.source]), [['omega1', 'the left motor stalls', 'you']]);
assert.equal(withNote(all, 'omega1', 'The left motor stalls', 'you', now, 'n2'), all); // no duplicate
assert.equal(withNote(all, '', 'x y z', 'you', now, 'n3'), null);
all = withNote(all, 'r2', 'other robot', 'you', now, 'n4');
all = withNote(all, 'omega1', 'uses a PCA9685', 'example.com', new Date('2026-11-04T06:00:00Z'), 'n5');
assert.deepEqual(notesFor(all, 'omega1').map((n) => n.id), ['n5', 'n1']); // newest first, this robot only
assert.deepEqual(noteContextLines(notesFor(all, 'omega1')), ['Owner note (from example.com): uses a PCA9685', 'Owner note: the left motor stalls']);
assert.equal(cleanNoteText('x'.repeat(900)).length, NOTE_MAX_CHARS);

// One-tap actions.
assert.deepEqual(parseWorkshopAction('Scan it with the RealSense'), { kind: 'realsense' });
assert.deepEqual(parseWorkshopAction('scan Omega1 with my Intel RealSense camera'), { kind: 'realsense' });
assert.deepEqual(parseWorkshopAction('open the realsense camera'), { kind: 'realsense' });
assert.deepEqual(parseWorkshopAction('Open the wiring tab'), { kind: 'tab', tab: 'wiring' });
assert.deepEqual(parseWorkshopAction('go to test'), { kind: 'tab', tab: 'checks' });
assert.deepEqual(parseWorkshopAction('show parts list'), { kind: 'tab', tab: 'bom' });
assert.equal(parseWorkshopAction('can I scan it with the realsense?'), null);
assert.equal(parseWorkshopAction('Summarize this robot'), null);

// Scans and notes go ahead of the spec, inside the Worker's 40-line cap.
const ctx = { robotId: 'omega1', robotName: 'Omega1', versionLabel: 'v1', tab: 'overview', tabLabel: 'Overview',
  specLines: Array.from({ length: 45 }, (_, i) => 'spec ' + i), checksVerdict: 'ok', checkLines: [],
  factLines: ['Scan on file · RealSense', 'Owner note: the left motor stalls'] };
const body = buildWsContext(ctx, []);
assert.equal(body.spec.length, 40);
assert.deepEqual(body.spec.slice(0, 3), ['Scan on file · RealSense', 'Owner note: the left motor stalls', 'spec 0']);
assert.equal(workingOnLabel(ctx), 'Working on: Omega1 · Overview');
assert.equal(workingOnLabel(null), '');
const chips = workshopTabChips(ctx);
assert.equal(chips[0], 'Scan it with the RealSense');
assert.ok(chips.includes('Search the web for Omega1 robot'));
assert.deepEqual(parseWorkshopAction(chips[0]), { kind: 'realsense' });
assert.equal(workshopTabChips({ ...ctx, tab: 'simulate' })[0], 'Run the simulation');

// Questions about the robot on screen skip the recorded catalogue's fuzzy match.
assert.equal(isWorkshopRobotQuestion('What changed in this robot’s latest version?', ctx), true);
assert.equal(isWorkshopRobotQuestion('is omega1 too heavy', ctx), true);
assert.equal(isWorkshopRobotQuestion('What is a LiPo balance charger?', ctx), false);
assert.equal(isWorkshopRobotQuestion('this robot', null), false);
const ans = snapshotAnswer({ ...ctx, checkLines: ['[ERROR] battery too small'] });
assert.match(ans[0], /on record for Omega1 \(v1\)/);
assert.ok(ans.some((p) => p.includes('Owner note: the left motor stalls')));
assert.ok(ans.some((p) => p.includes('[ERROR] battery too small')));
assert.ok(ans.some((p) => p.includes('and 37 more on the Specs tab')));
"""

STORE_STUB = "export const readStore = (k, f) => f; export const writeStore = () => null;\n"
GARAGE_STUB = "export const FIELD_GROUPS = []; export const fmtValue = String; export const getPath = () => undefined;\n"


def test_notes_actions_and_context(tmp_path: Path) -> None:
    (tmp_path / "robotNotes.ts").write_text((WEB / "lib/robotNotes.ts").read_text().replace("from './store'", "from './store.ts'"))
    (tmp_path / "workshopContext.ts").write_text((WEB / "lib/workshopContext.ts").read_text().replace("from './garage'", "from './garage.ts'"))
    (tmp_path / "store.ts").write_text(STORE_STUB)
    (tmp_path / "garage.ts").write_text(GARAGE_STUB)
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "run.mjs").write_text(RUN)
    proc = subprocess.run(["node", "--experimental-strip-types", "run.mjs"], cwd=tmp_path,
                          capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_wrench_is_wired_to_the_robot_on_screen() -> None:
    # Working-on line in the dock.
    assert "assistant.workingOn" in BAR and "fc-working-on" in BAR
    # Commands: remember, then Workshop actions, before the other grammars.
    i = DOCK.index("const runCommands = (q: string): boolean => {")
    assert DOCK.index("parseRememberCommand(q)", i) < DOCK.index("parseWorkshopAction(q)", i) < DOCK.index("parseSimCommand(q)", i)
    assert "addRobotNote(ws.robotId,remember)" in DOCK
    assert "if (wsNow?.robotId && isWorkshopRobotQuestion(q, wsNow) && !detectWebIntent(q)) {" in DOCK
    assert "html: snapshotAnswer(wsNow)" in DOCK
    # An explicit web ask is never swallowed by a recorded fuzzy match.
    assert "if (detectWebIntent(q) && !ans.fallback) ans = { ...ans, fallback: true };" in DOCK and "fallback: true," in DOCK
    # Web-sourced answers about a stored robot can be kept as a note, with their source.
    assert "note: { robotId: ws.robotId, robotName: ws.robotName, text: answer, source: webCaption }" in DOCK
    assert "onSaveNote" in MSGS and "Save to {m.grounding.note.robotName}&apos;s notes" in MSGS
    # Garage: facts in the snapshot, actions handled, notes shown and deletable, cleared on delete.
    assert "factLines: [" in GARAGE and "noteContextLines(notesFor(allNotes, robot.id))" in GARAGE
    assert "window.addEventListener(WORKSHOP_ACTION_EVENT, onAction)" in GARAGE
    assert "setRealsenseFor({ id: robot.id, name: robot.name }); }" in GARAGE
    assert "What Wrench knows about {robot.name}" in GARAGE and "removeRobotNote(n.id)" in GARAGE
    assert "forgetRobotNotes(archived.id);" in GARAGE
