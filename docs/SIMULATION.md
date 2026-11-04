# Workshop simulation

Open a robot in Workshop → Simulate. The selected robot version supplies its
model and physics inputs. Ask Wrench to supply or change missing dimensions,
mass, wheel geometry and motor data; no simulation-specific form is needed.

## Browser mode

Browser mode runs Rapier physics on the current computer, including Apple
Silicon Macs. Run, then hold arrow keys/WASD or the directional buttons. Pause,
reset and camera controls stay beside the scene. Flat ground, a 10° ramp and a
30 mm obstacle are available. Focus loss pauses driving.

The first supported drive classes are two- and four-wheel differential/skid
robots. Other robot classes can be inspected but are not given invented motion.
Uploaded meshes, the built-in Omega model and recorded URDFs are used for visual
appearance when available. Collision bodies remain simplified boxes and wheels;
display fitting does not calibrate a scan. Browser tyre friction is assumed 0.85
and usable torque is 60% of recorded stall torque. Results are estimates.

## Gazebo on the same computer

A second computer is not required. Install a compatible native Gazebo runtime
on the computer where the browser is running, and run the loopback companion.
Linux with Gazebo Harmonic is the tested path. Apple Silicon macOS is best-effort:
the companion can detect a compatible installation, but native Mac execution
has not been verified by the Linux development checks.

Official setup: [Linux Harmonic](https://gazebosim.org/docs/harmonic/install_ubuntu/)
and [macOS Jetty](https://gazebosim.org/docs/jetty/install_osx/).
The companion recognizes Gazebo Sim major versions 8, 9 and 10; detection alone
is not proof that a particular robot test will succeed.

From the repository, with Python dependencies installed:

```bash
python -m pip install -e .
python -m robotforge.simulator --origin http://localhost:3100
```

Use the exact origin shown in Workshop's “Set up on this computer” instructions
when the app is hosted elsewhere. The companion listens only on 127.0.0.1:8766,
accepts the configured browser origin and requires a client header. It accepts
bounded robot data, not shell commands, uploaded XML or filesystem paths. A
browser may require local-network access before a hosted page can connect.
Do not expose the companion through a public tunnel.

Select Gazebo on this computer → Connect local Gazebo → Run Gazebo test. This
first integration performs a bounded flat-ground 0.5 m drive and 90° turn,
then replays actual measured ground-truth poses. Replay follows sample order,
not real-time timestamps. Manual live driving and ramp/obstacle tests are
currently browser-mode features. Gazebo uses generated primitive geometry and
existing DiffDrive controller defaults, not calibrated scan dynamics or measured
motor torque limits. No automatic pass/fail is assigned.

Cancel stops the owned test processes. Only one job runs at a time; jobs time
out after 100 seconds. Stop the companion with Ctrl+C when finished.

## Results

Save run to Test stores the engine, scenario, robot/version identity, complete
spec snapshot and measured poses locally. Changing robot, spec or version resets
the active simulation and cancels its local job. Saved results stay attached to
the robot and original snapshot, so later edits do not relabel old evidence.
