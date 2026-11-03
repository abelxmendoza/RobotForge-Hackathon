"""Wiring tab 3D views: Full robot / Connections / Photos.

The switcher (components/garage/WiringViews.tsx) reuses the Build
tab's turntable (same model resolution: twin -> attached scan ->
spec-built stage -> none), reads spec.connections without ever
writing it, and derives connection kinds from the recorded detail
text only (lib/connectionKind.ts — pure, driven verbatim in node
against the 11 seeded Omega1 details). The Photos mode is honest
by construction: images already in the app, each labelled as what
it is, no generated imagery; the callouts are the recorded map.
"""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next"
LIB = WEB / "src" / "lib"
GARAGE = WEB / "src" / "components" / "garage"

KIND = (LIB / "connectionKind.ts").read_text()
WV = (GARAGE / "WiringViews.tsx").read_text()
PANEL = (GARAGE / "TakeApartPanel.tsx").read_text()
GARAGE_TSX = (GARAGE / "Garage.tsx").read_text()
APP_CSS = (ROOT / "assets/css/app.css").read_text()


def test_kind_module_is_pure():
    assert not any(line.startswith("import") for line in KIND.splitlines())
    assert "export function connectionKind" in KIND
    assert "'Other'" in KIND  # unmatched details are never force-classified


def test_switcher_mounted_in_wiring_tab_after_the_editor():
    assert "import WiringViews from './WiringViews';" in GARAGE_TSX
    editor_at = GARAGE_TSX.index("<ConnectionsSection")
    views_at = GARAGE_TSX.index("<WiringViews")
    wiring_at = GARAGE_TSX.index("tab === 'wiring'")
    assert wiring_at < editor_at < views_at


def test_three_modes_and_turntable_reuse():
    for s in ("Full robot", "Connections", "Photos", "Wiring views"):
        assert s in WV, s
    # The turntable is the Build tab's exported component, not a copy.
    assert "export function BuildTurntable" in PANEL
    assert "import { BuildTurntable } from './TakeApartPanel';" in WV
    assert "The plain 360° turntable — the same view as the Build tab." in WV
    assert "WebGLRenderer" not in WV


def test_connections_mode_honesty_and_interaction():
    for s in ("recorded LOGICAL connection, not a measured wire path",
              "no cable routes and no 3D positions for the",
              "its geometry is ESTIMATED",
              "No connections are recorded for this robot",
              "Filter connections by kind",
              "aria-label=\"Connection map diagram."):
        assert s in WV, s
    # Views read the record; nothing in the file writes a spec back.
    for write in ("onSave", "saveConnections", "setDraft", "pushVersion"):
        assert write not in WV, write


def test_photos_mode_honesty():
    for s in ("Real images only: this board uses photos and renders already in the app",
              "nothing here is generated for this view",
              "No photos of this robot in the app yet.",
              "Generator preview render of the estimated twin subject — not a photo of the real robot.",
              "the DOCUMENTED records",
              "evidence badge where the record carries one"):
        assert s in WV, s
    low = WV.lower()
    assert "photoreal" not in low
    assert "ai-generated" not in low and "ai generated" not in low


def test_css_present():
    for s in (".wv-switch{", ".wv-line.k-power{", ".wv-line.k-comms{",
              ".wv-line.k-gpio{", ".wv-line.k-csi{", ".wv-hit{", ".wv-row{"):
        assert s in APP_CSS, s


def test_kind_derivation_on_the_seeded_omega1_details(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is unavailable")
    (tmp_path / "connectionKind.ts").write_text(KIND)
    (tmp_path / "package.json").write_text('{"type":"module"}')
    script = """
import assert from 'node:assert/strict';
import { connectionKind } from './connectionKind.ts';

// The 11 DOCUMENTED Omega1 connection details, exactly as seeded
// (lib/omega1Garage.ts OMEGA1_CONNECTIONS).
const seeded = [
  'Power — 7.4 V nominal pack',
  'I2C 0x40 · PWM ch 1 fwd / ch 0 back · 50 Hz',
  'I2C 0x40 · PWM ch 2 fwd / ch 3 back · 50 Hz',
  'I2C 0x40 · PWM ch 7 fwd / ch 6 back · 50 Hz',
  'I2C 0x40 · PWM ch 5 fwd / ch 4 back · 50 Hz',
  'PWM ch 8',
  'PWM ch 9',
  'GPIO 27 TRIG · GPIO 22 ECHO · front',
  'GPIO 14 / 15 / 23',
  'I2C 0x48',
  'CSI',
];
assert.deepEqual(seeded.map(connectionKind), [
  'Power',
  'I2C / comms', 'I2C / comms', 'I2C / comms', 'I2C / comms',
  'Other', 'Other',
  'GPIO', 'GPIO',
  'I2C / comms',
  'CSI',
]);

// Clear singles and the honest fallback.
assert.equal(connectionKind('CSI ribbon'), 'CSI');
assert.equal(connectionKind('UART telemetry'), 'I2C / comms');
assert.equal(connectionKind('battery lead'), 'Power');
assert.equal(connectionKind(''), 'Other');
assert.equal(connectionKind('rubber band'), 'Other');
// Precedence: the most specific interface named wins.
assert.equal(connectionKind('GPIO expander on I2C'), 'GPIO');
assert.equal(connectionKind('CSI camera on GPIO header'), 'CSI');

console.log('connection-kind behaviour OK');
"""
    (tmp_path / "check.mjs").write_text(script)
    out = subprocess.run([node, "check.mjs"], cwd=tmp_path,
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr + out.stdout
    assert "connection-kind behaviour OK" in out.stdout
