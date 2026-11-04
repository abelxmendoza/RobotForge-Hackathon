"""Workshop chat context (2026-11-02): the Workshop publishes a snapshot
of the robot on screen (lib/workshopContext), the chat sends it with a
question to the live model (ChatDock liveChat -> ws_context), the Worker
grounds its plain answer in it (live/worker.js), and the Workshop's
starter chips follow the open tab (ChatDock chipsFor — the wrench turn
layer itself stays free of app state for its standalone eval harness).

Pins:
  1. summarizeSpec renders the Specs tab's own units (field scale
     applied), skips empty fields and the name, and never invents.
  2. buildWsContext carries robot / version / tab / spec / checks /
     inventory in the wire shape the Worker's sanitizer reads.
  3. publish/read is a plain roundtrip and clearing really clears.
  4. Every tab has chips; an unknown tab falls back to the checks set;
     no chip starts with an operation verb (the chat routes those to
     the command translator, and these chips are questions).
  5. The wiring exists in the sources: Garage publishes, ChatDock
     sends ws_context on the live-answer path only and owns the
     Workshop chip branch, the Worker sanitizes + renders the
     snapshot, and wrench.ts carries no app import.
  6. The chips have a render surface ON the Workshop: the bottom
     ChatBar renders assistant.chips elsewhere but returns null on
     /garage by design, so the docked ForgeThread (the Workshop's
     actual chat surface) renders the row itself. PR #120 missed
     this and the chips were invisible on their own page — the
     live check caught what the source pins alone did not.
  7. The "Grounded in" caption + one-tap Fix (PR #122 scope): the
     grounding is attached ONLY on the live-success path, from the
     snapshot liveChat captured at ask time; the FAIL signal is an
     "[ERROR]" check line (Garage's own severity rule); and BOTH
     message renderers — ChatMessages (ChatBar) and the docked
     ForgeThread node — render the caption and the Fix button, so
     the PR #121 wrong-surface failure cannot recur silently. The
     Fix bridge is an event + pending value in workshopContext;
     Garage consumes it by switching to the Checks tab.
"""
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next"
LIB = WEB / "src" / "lib"

GARAGE_TSX = (WEB / "src/components/garage/Garage.tsx").read_text()
DOCK = (WEB / "src/components/chat/ChatDock.tsx").read_text()
FORGE_THREAD = (WEB / "src/components/forge/ForgeThread.tsx").read_text()
CHATBAR = (WEB / "src/components/chat/ChatBar.tsx").read_text()
CHAT_MESSAGES = (WEB / "src/components/chat/ChatMessages.tsx").read_text()
CHAT_CSS = (ROOT / "assets/css/chat.css").read_text()
WRENCH = (WEB / "src/components/chat/wrench.ts").read_text()
WORKER = (ROOT / "live" / "worker.js").read_text()

OP_VERBS = ("add", "remove", "delete", "move", "place", "mount",
            "connect", "wire", "disconnect", "generate", "export", "run",
            "save", "set", "undo", "make", "change", "increase",
            "decrease", "bigger", "smaller", "heavier", "lighter")


def test_snapshot_lib_behaviour(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    (tmp_path / "garage.ts").write_text((LIB / "garage.ts").read_text())
    (tmp_path / "workshopContext.ts").write_text(
        (LIB / "workshopContext.ts").read_text()
        .replace("from './garage'", "from './garage.ts'"))
    (tmp_path / "package.json").write_text('{"type":"module"}')
    script = """
import assert from 'node:assert/strict';
import { summarizeSpec, buildWsContext, publishWorkshopContext,
         readWorkshopContext, workshopTabChips, workshopSnapshotFailing,
         groundingCaption, requestWorkshopFix,
         consumeWorkshopFixRequest } from './workshopContext.ts';

const spec = {
  name: 'Testbot', drivetrain: 'differential',
  wheel: { diameter_m: 0.066, count: 2 },
  motor: { voltage_v: 11.1, count: 2 },
  battery: { chemistry: 'lipo', voltage_v: 11.1, capacity_mah: 1800 },
  mass_kg: 1.4,
};
const lines = summarizeSpec(spec);
assert.ok(lines.includes('Wheels · Diameter: 66 mm'), lines.join(' | '));
assert.ok(lines.includes('Battery · Capacity: 1800 mAh'), lines.join(' | '));
assert.ok(lines.includes('Body · Drivetrain: differential'), lines.join(' | '));
assert.ok(!lines.some((l) => l.includes('Name:')), 'the name is not a spec line');
assert.ok(!lines.some((l) => l.includes('Height')), 'empty fields are skipped');
assert.deepEqual(summarizeSpec({}), []);
assert.deepEqual(summarizeSpec(null), []);

const ctx = { robotName: 'Testbot', versionLabel: 'v2 — Baseline',
              tab: 'checks', tabLabel: 'Checks', specLines: lines,
              checksVerdict: 'Checks fail', checkLines: ['FAIL x'] };
publishWorkshopContext(ctx);
assert.equal(readWorkshopContext().robotName, 'Testbot');
const body = buildWsContext(ctx, ['TB6612FNG driver']);
assert.equal(body.robot, 'Testbot');
assert.equal(body.tab, 'Checks');
assert.deepEqual(body.checks, { verdict: 'Checks fail', lines: ['FAIL x'] });
assert.deepEqual(body.inventory, ['TB6612FNG driver']);
publishWorkshopContext(null);
assert.equal(readWorkshopContext(), null);

const OP_VERBS = ['add', 'remove', 'delete', 'move', 'place', 'mount',
  'connect', 'wire', 'disconnect', 'generate', 'export', 'run', 'save',
  'set', 'undo', 'make', 'change', 'increase', 'decrease', 'bigger',
  'smaller', 'heavier', 'lighter'];
for (const tab of ['overview', 'build', 'wiring', 'specs', 'simulate',
                   'checks', 'bom', 'tools', 'history']) {
  const chips = workshopTabChips({ ...ctx, tab });
  assert.ok(chips.length >= 3, tab);
  for (const chip of chips) {
    // Action chips run through their own grammar before op-verb routing
    // (parseSimCommand runs first in runCommands), so they may lead with a verb.
    if (chip === 'Run the simulation') continue;
    const first = chip.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
    assert.ok(!OP_VERBS.includes(first), tab + ' chip starts with an op verb: ' + chip);
  }
}
assert.deepEqual(workshopTabChips({ ...ctx, tab: 'nope' }),
                 workshopTabChips({ ...ctx, tab: 'checks' }));

// Failing signal: Garage's own severity rule — an [ERROR] line.
// Warnings alone and a clean pass are NOT failures.
assert.equal(workshopSnapshotFailing({ ...ctx, checkLines: ['[ERROR] motor voltage'] }), true);
assert.equal(workshopSnapshotFailing({ ...ctx, checkLines: ['[WARN] tight margin', '[OK] mass'] }), false);
assert.equal(workshopSnapshotFailing({ ...ctx, checkLines: [] }), false);

// The caption names the snapshot that was sent: robot, version, tab.
assert.equal(groundingCaption(ctx),
             'Grounded in: Testbot · v2 — Baseline · Checks · just now');
assert.equal(groundingCaption({ ...ctx, versionLabel: '' }),
             'Grounded in: Testbot · Checks · just now');

// The Fix bridge is a one-shot pending request.
assert.equal(consumeWorkshopFixRequest(), false);
requestWorkshopFix();
assert.equal(consumeWorkshopFixRequest(), true);
assert.equal(consumeWorkshopFixRequest(), false);
console.log('workshop context checks passed');
"""
    (tmp_path / "run.mjs").write_text(script)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs")],
        capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_garage_publishes_and_clears_the_snapshot():
    assert "publishWorkshopContext({" in GARAGE_TSX
    assert "summarizeSpec(draft)" in GARAGE_TSX
    assert "checkLines: draftLines" in GARAGE_TSX
    assert "return () => publishWorkshopContext(null);" in GARAGE_TSX


def test_chatdock_sends_ws_context_on_the_live_answer_path():
    assert "readWorkshopContext()" in DOCK
    assert "ws_context: buildWsContext(" in DOCK
    # The operations translator keeps its own context; the snapshot is
    # attached in liveChat (the answer path), not in proposeViaLive.
    propose = DOCK[DOCK.index("const proposeViaLive"):DOCK.index("const settle", DOCK.index("const proposeViaLive"))]
    assert "ws_context" not in propose


def test_chatdock_chips_follow_the_workshop_tab():
    assert "const chipsFor = (mem: TurnMemory): string[]" in DOCK
    assert "workshopTabChips(ws)" in DOCK
    assert "WORKSHOP_CONTEXT_EVENT" in DOCK
    # Every former contextChips call site goes through chipsFor now.
    assert "wrench.contextChips(pathname" not in DOCK.replace(
        "return wrench.contextChips(pathname", "")


def test_the_docked_thread_renders_the_chips_on_garage():
    # ChatBar is the only other renderer of assistant.chips, and it
    # opts out of the Workshop by design — so without this row in the
    # docked thread, the per-tab chips render nowhere on /garage.
    assert '"/garage", "/garage/"' in CHATBAR
    assert "assistant.chips.map" in FORGE_THREAD
    assert ("docked && open && inputMode === 'chat' && assistant.chips.length > 0"
            in FORGE_THREAD)
    assert 'aria-label="Suggestions for the open Workshop tab"' in FORGE_THREAD
    # A chip click asks the question through the same engine path the
    # static suggestions use, and opens the conversation panel.
    assert "assistant.ask(c)" in FORGE_THREAD


def test_wrench_layer_stays_free_of_app_state():
    # engine.ts + wrench.ts are compiled standalone by the tier eval
    # harness (tsc CLI, no path aliases); an app import there breaks
    # every eval test at compile time. The Workshop chip branch lives
    # in ChatDock for exactly this reason — pin it.
    assert "workshopContext" not in WRENCH


def test_worker_sanitizes_and_renders_the_snapshot():
    assert "function sanitizeWsContext(raw)" in WORKER
    assert "function renderWsContext(ctx)" in WORKER
    assert "WS_CONTEXT_INSTRUCTIONS" in WORKER
    assert "Answer about THAT robot" in WORKER
    assert "sanitizeWsContext(data && data.ws_context)" in WORKER
    # Operator mode wins when both arrive: the snapshot is answer-only.
    assert "opContext ? null : sanitizeWsContext" in WORKER
    # The snapshot is rendered from capped fields, never echoed raw.
    render = WORKER[WORKER.index("function renderWsContext"):]
    render = render[:render.index("\n}\n")]
    assert "JSON.stringify(raw" not in render


def test_grounding_comes_from_the_snapshot_livechat_captured():
    # liveChat captures the snapshot at ask time and returns it with
    # the answer; the caption/failing are derived from THAT object.
    # liveChat's return gained webCaption in the Firecrawl PR: the
    # web caption rides back with the answer the same way ws does,
    # and is null unless a /web fetch actually succeeded.
    assert "webCaption: string | null" in DOCK
    assert "return { answer: body.answer, ws, webCaption: web ? web.caption : null };" in DOCK
    assert "groundingCaption(ws)" in DOCK
    assert "workshopSnapshotFailing(ws)" in DOCK
    # The live-failure fallback renders the recorded answer: it must
    # not claim grounding that never happened.
    catch = DOCK[DOCK.index(".catch((e: Error & { code?: string })"):]
    catch = catch[:catch.index("});")]
    assert "grounding" not in catch


def test_caption_and_fix_render_on_both_message_surfaces():
    # Surface (a): the docked ForgeThread builds its own message node
    # (it does NOT use ChatMessages) — the PR #121 lesson.
    assert "message.grounding" in FORGE_THREAD
    assert "fc-grounding" in FORGE_THREAD
    assert "Fix this" in FORGE_THREAD
    assert "assistantRef.current.fixGroundedAnswer()" in FORGE_THREAD
    # Surface (b): ChatMessages, rendered by the global ChatBar.
    assert "m.grounding" in CHAT_MESSAGES
    assert "fc-grounding" in CHAT_MESSAGES
    assert "fc-fix-btn" in CHAT_MESSAGES
    assert "Fix this" in CHAT_MESSAGES
    assert "onFixClick={assistant.fixGroundedAnswer}" in CHATBAR
    # The styles live in the CSS source of truth (assets/css), which
    # the web-next prebuild syncs — not in the generated copies.
    assert ".fc-grounding" in CHAT_CSS
    assert ".fc-fix-btn" in CHAT_CSS


def test_fix_bridge_switches_garage_to_the_checks_tab():
    lib = (LIB / "workshopContext.ts").read_text()
    assert "WORKSHOP_FIX_EVENT = 'rf-workshop-fix'" in lib
    assert "export function requestWorkshopFix()" in lib
    assert "export function consumeWorkshopFixRequest()" in lib
    assert "l.startsWith('[ERROR]')" in lib
    # Garage consumes the request; the chat never imports Garage.
    assert "WORKSHOP_FIX_EVENT" in GARAGE_TSX
    assert "consumeWorkshopFixRequest()" in GARAGE_TSX
    assert "setTab('checks')" in GARAGE_TSX
    assert "requestWorkshopFix()" in DOCK
    # Off the Workshop, the Fix tap routes honestly instead of
    # claiming a tab switch it cannot perform.
    assert 'router.push("/garage/")' in DOCK
    assert "open that robot's Checks tab" in DOCK


def test_no_chip_copy_starts_with_an_operation_verb():
    src = (LIB / "workshopContext.ts").read_text()
    chips = re.findall(r"'([A-Z][^']{10,})'", src)
    asked = [c for c in chips if c.endswith("?") or " " in c]
    assert len(asked) >= 20, "expected the full tab chip table"
    for chip in asked:
        if chip == "Run the simulation":  # handled by parseSimCommand before op-verb routing
            continue
        first = re.sub(r"[^A-Za-z]", "", chip.split(" ")[0]).lower()
        assert first not in OP_VERBS, chip
