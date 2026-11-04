"""Each Workshop tab has one job: a purpose line, the robot's status for
that job, and one main button (lib/tabFocus.ts, rendered by Garage)."""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next/src"

RUN = r"""
import assert from 'node:assert/strict';
import { tabFocus } from './tabFocus.ts';
const f = { name: 'Omega1', hasRealsense: false, hasScan: false, versions: 2, verdictLabel: '2 problems', verdictCls: 'fail' };
const tabs = ['overview', 'build', 'wiring', 'bom', 'checks', 'history', 'simulate', 'specs', 'tools'];
for (const t of tabs) {
  const x = tabFocus(t, f);
  assert.ok(x.job.includes('Omega1'), t);
  assert.ok(x.status && x.action.label, t);
}
assert.deepEqual(tabFocus('overview', f).action, { kind: 'realsense', label: 'Scan with RealSense camera' });
assert.equal(tabFocus('overview', { ...f, hasRealsense: true }).action.kind, 'ask');
assert.equal(tabFocus('simulate', f).action.kind, 'simRun');
assert.equal(tabFocus('checks', f).tone, 'fail');
assert.equal(tabFocus('checks', f).action.text, 'How do I fix this robot’s failing checks?');
assert.equal(tabFocus('checks', { ...f, verdictCls: 'pass', verdictLabel: 'Checks pass' }).action.label, 'Which checks matter most?');
assert.equal(tabFocus('history', { ...f, versions: 1 }).status, '1 saved version');
// The asked questions are Workshop chips' wording, so Wrench answers them with the robot's context.
const ctx = readFileSync('workshopContext.ts', 'utf8');
for (const t of tabs) { const a = tabFocus(t, { ...f, hasRealsense: true }).action; if (a.kind === 'ask') assert.ok(ctx.includes("'" + a.text + "'"), a.text); }
"""


def test_tab_focus(tmp_path: Path) -> None:
    (tmp_path / "tabFocus.ts").write_text((WEB / "lib/tabFocus.ts").read_text())
    (tmp_path / "workshopContext.ts").write_text((WEB / "lib/workshopContext.ts").read_text())
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "run.mjs").write_text("import { readFileSync } from 'node:fs';\n" + RUN)
    proc = subprocess.run(["node", "--experimental-strip-types", "run.mjs"], cwd=tmp_path,
                          capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_focus_strip_is_wired() -> None:
    garage = (WEB / "components/garage/Garage.tsx").read_text()
    forge = (WEB / "components/forge/ForgeThread.tsx").read_text()
    assert 'className="ws-focus"' in garage and "tabFocus(tab, {" in garage
    assert "promptWrench({ mode: 'chat', text: a.text, send: true })" in garage
    assert "new CustomEvent(SIM_COMMAND_EVENT, { detail: { command: { action: 'run' }" in garage
    # A sent prompt is asked straight away, with the user's bubble.
    assert "if (p.send && typeof p.text === 'string' && p.text.trim())" in forge
    assert "assistantRef.current.ask(p.text);" in forge
