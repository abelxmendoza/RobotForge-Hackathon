# RobotForge Scan Bridge app

The bridge is the small program that lets RobotForge read an Intel
RealSense depth camera. A web page cannot read the camera itself, so
the bridge runs on the computer the camera is plugged into and Scan
Studio talks to it on that computer only (127.0.0.1). Nothing is
uploaded anywhere.

**You never need a terminal or a command line.** Two steps, once:

1. **Download this folder** (`tools/scan-bridge-app`) — or just the
   subfolder for your system — and keep it somewhere sensible, like
   your Documents folder.
2. **Double-click the launcher for your system** (see below). The
   first run sets itself up: it downloads its open-source pieces
   (numpy, pyrealsense2, Open3D — this can take a few minutes and a
   few hundred megabytes, once) and starts the bridge. Scan Studio
   opens in your browser when it is ready.

From then on you do nothing at all: in Scan Studio, the
**Start the bridge app** button wakes the bridge by itself through
the `robotforge-scan://` link the launcher registered, the page
connects on its own, and you just scan.

## Per system

- **macOS** — open `macos/`, double-click **RobotForge Scan Bridge**.
  Because the app is not code-signed, macOS asks the first time:
  right-click the app, choose **Open**, then **Open** again. That is
  Apple's rule for unsigned apps, and it only happens once.
  Needs Python 3 — if your Mac does not have it, the app says so;
  installing it from python.org is the one extra step.
- **Windows** — open `windows/`, double-click
  **RobotForge Scan Bridge.bat**. It registers the link for your
  account (no administrator prompt) and starts the bridge minimised.
  Needs Python 3 from python.org (tick "Add python.exe to PATH" when
  installing it).
- **Linux** — open `linux/`, double-click **start-scan-bridge.sh**
  (if your file manager asks, choose "Run" / "Run in Terminal" —
  nothing to type either way). The first run also adds
  "RobotForge Scan Bridge" to your applications and registers the
  link. Needs python3 and curl, which most desktops already have.

## Honest notes

- The bridge only ever listens on this computer (127.0.0.1:8765) and
  only answers RobotForge pages.
- First-run setup needs the internet; after that it works offline.
- The `scan_bridge.py` beside each launcher is an exact copy of
  `tools/scan_bridge.py`, kept identical by a test, so the app always
  runs the same bridge the test suite checks.
- Developers can still run the bridge directly:
  `python3 tools/scan_bridge.py` (add `--simulate` for the synthetic
  test rover). The app is a launcher around that same program, not a
  different one.
