"""One-click RealSense intake (2026-11-04): nobody should need a
terminal to scan. The bridge app (tools/scan-bridge-app) starts the
bridge with a double-click, registers the robotforge-scan:// link,
and Scan Studio's "Start the bridge app" button wakes it through
that link and connects on its own when the bridge answers.

Pins:
  1. The launchers exist for macOS / Windows / Linux, each starts the
     bridge on 127.0.0.1:8765 in the background, sets itself up on
     first run (private venv + the three open-source pieces), and
     never asks the user to type anything.
  2. The robotforge-scan:// scheme is registered by all three:
     the macOS bundle's Info.plist URL types, the Windows launcher's
     current-user registry keys, and the Linux desktop entry's
     scheme-handler mimetype with a self-installing Exec.
  3. Every launcher ships the SAME bridge: each bundled
     scan_bridge.py is byte-identical to tools/scan_bridge.py, so
     the app can never drift from the tested bridge.
  4. The web side: lib/scanBridge exports the link + download page +
     a bridgeAnswers probe; ScanStudio renders the Start button as
     an anchor to the link with the wait loop behind it, offers the
     download, and keeps the terminal commands only inside the
     developers' details block — after it in the source, never in
     the numbered steps a normal user reads.
  5. The failure copy matches: a quiet bridge points at the Start
     button and the one double-click setup, not at a command line.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "tools" / "scan-bridge-app"
MAC_APP = APP / "macos" / "RobotForge Scan Bridge.app"
STUDIO = (ROOT / "web-next" / "src" / "components" / "scan" / "ScanStudio.tsx").read_text()
LIB = (ROOT / "web-next" / "src" / "lib" / "scanBridge.ts").read_text()
BRIDGE = (ROOT / "tools" / "scan_bridge.py").read_bytes()


def test_launchers_exist_and_set_themselves_up():
    mac = (MAC_APP / "Contents" / "MacOS" / "RobotForgeScanBridge").read_text()
    bat = (APP / "windows" / "RobotForge Scan Bridge.bat").read_text()
    sh = (APP / "linux" / "start-scan-bridge.sh").read_text()
    for text in (mac, bat, sh):
        assert "8765" in text
        assert "numpy pyrealsense2 open3d" in text or "numpy, pyrealsense2, Open3D" in text
        assert "venv" in text
    assert "nohup" in mac and "nohup" in sh          # background, no window to babysit
    assert 'start "RobotForge Scan Bridge" /min' in bat
    assert "robot-forge-hackathon.vercel.app/scan" in mac + bat + sh  # opens the studio when double-clicked


def test_scheme_registered_on_all_three_systems():
    plist = (MAC_APP / "Contents" / "Info.plist").read_text()
    assert "CFBundleURLSchemes" in plist and "<string>robotforge-scan</string>" in plist
    bat = (APP / "windows" / "RobotForge Scan Bridge.bat").read_text()
    assert "HKCU\\Software\\Classes\\robotforge-scan" in bat and "URL Protocol" in bat
    desktop = (APP / "linux" / "robotforge-scan-bridge.desktop").read_text()
    assert "x-scheme-handler/robotforge-scan" in desktop
    sh = (APP / "linux" / "start-scan-bridge.sh").read_text()
    assert "xdg-mime default robotforge-scan-bridge.desktop" in sh  # first run installs the handler


def test_bundled_bridge_is_the_tested_bridge():
    for copy in (
        MAC_APP / "Contents" / "Resources" / "scan_bridge.py",
        APP / "windows" / "scan_bridge.py",
        APP / "linux" / "scan_bridge.py",
    ):
        assert copy.read_bytes() == BRIDGE, copy


def test_web_one_click_wiring():
    assert "BRIDGE_APP_LINK = 'robotforge-scan://start'" in LIB
    assert "tools/scan-bridge-app" in LIB  # the download page
    assert "export async function bridgeAnswers" in LIB
    assert "href={BRIDGE_APP_LINK}" in STUDIO and "Start the bridge app" in STUDIO
    assert "startBridgeApp" in STUDIO and "bridgeAnswers(base)" in STUDIO
    assert "Get the bridge app" in STUDIO and "href={BRIDGE_APP_PAGE}" in STUDIO
    assert "Waiting for the bridge" in STUDIO


def test_terminal_commands_live_only_in_the_developers_block():
    steps = STUDIO.index('<ol className="studio-steps">')
    details = STUDIO.index("Run it yourself (developers)")
    cmd = STUDIO.index("python3 tools/scan_bridge.py")
    assert steps < details < cmd  # commands exist, but only after the developers' summary
    visible_steps = STUDIO[steps:details]
    assert "pip install" not in visible_steps and "python3" not in visible_steps


def test_failure_copy_points_at_the_button_not_a_command():
    assert "The bridge app isn't running yet" in STUDIO
    assert "Is the bridge app still open?" in STUDIO
    assert "Start it with python3" not in STUDIO
    readme = (APP / "README.md").read_text()
    assert "never need a terminal" in readme and "double-click" in readme.lower()
    assert "right-click" in readme  # macOS unsigned-app first open, stated honestly
