#!/bin/sh
# RobotForge Scan Bridge — the double-click launcher (Linux).
#
# First double-click also installs the desktop entry (with the
# robotforge-scan:// link handler) into your applications, so from
# then on Scan Studio's "Start the bridge app" button wakes the
# bridge by itself, and the bridge appears in your app list.
#
# Otherwise it does what the other launchers do: sets itself up once
# in ~/.local/share/robotforge-scan-bridge (a private Python
# environment with numpy, pyrealsense2, Open3D), then runs the bridge
# on 127.0.0.1:8765 in the background. Nothing to type.
set -u

PORT=8765
PAGE="https://robot-forge-hackathon.vercel.app/scan"
APP_HOME="$HOME/.local/share/robotforge-scan-bridge"
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" || exit 1)

notify() {
  command -v notify-send >/dev/null 2>&1 && notify-send "RobotForge Scan Bridge" "$1" || true
}
answering() {
  curl -s -m 2 "http://127.0.0.1:$PORT/status" >/dev/null 2>&1
}

# Self-install the desktop entry on first run (real paths filled in).
DESKTOP_DST="$HOME/.local/share/applications/robotforge-scan-bridge.desktop"
if [ ! -f "$DESKTOP_DST" ]; then
  mkdir -p "$HOME/.local/share/applications"
  sed -e "s|__START_SCRIPT__|$SELF_DIR/start-scan-bridge.sh|g" \
      -e "s|__WORKDIR__|$SELF_DIR|g" \
      "$SELF_DIR/robotforge-scan-bridge.desktop" > "$DESKTOP_DST" 2>/dev/null || true
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
  command -v xdg-mime >/dev/null 2>&1 && xdg-mime default robotforge-scan-bridge.desktop x-scheme-handler/robotforge-scan || true
fi

if answering; then
  [ "${1:-}" = "" ] && xdg-open "$PAGE" >/dev/null 2>&1
  exit 0
fi

mkdir -p "$APP_HOME" || exit 1
cp "$SELF_DIR/scan_bridge.py" "$APP_HOME/scan_bridge.py" || exit 1

if [ ! -x "$APP_HOME/venv/bin/python" ]; then
  notify "First run: downloading the open-source camera pieces. This happens once and can take a few minutes."
  PY=$(command -v python3 || true)
  [ -n "$PY" ] || { notify "Python 3 was not found. Install python3, then start the bridge again."; exit 1; }
  "$PY" -m venv "$APP_HOME/venv" >>"$APP_HOME/setup.log" 2>&1 || { notify "Setup failed; see setup.log in $APP_HOME."; exit 1; }
  "$APP_HOME/venv/bin/python" -m pip install --upgrade pip >>"$APP_HOME/setup.log" 2>&1
  "$APP_HOME/venv/bin/python" -m pip install numpy pyrealsense2 open3d >>"$APP_HOME/setup.log" 2>&1 \
    || { notify "Setup could not download the camera pieces. Check the internet connection and try again; see setup.log in $APP_HOME."; exit 1; }
  notify "Setup is done. The bridge is starting."
fi

nohup "$APP_HOME/venv/bin/python" "$APP_HOME/scan_bridge.py" --port "$PORT" >>"$APP_HOME/bridge.log" 2>&1 &

n=0
while [ $n -lt 40 ]; do
  answering && break
  sleep 0.5
  n=$((n + 1))
done

[ "${1:-}" = "" ] && xdg-open "$PAGE" >/dev/null 2>&1
exit 0
