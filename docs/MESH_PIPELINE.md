# Procedural assets and simulation evidence

The core stays dependency-free: no Blender, ROS, OpenSCAD or Gazebo is needed
for a mesh bundle or its browser viewer. The existing `robotforge cad` command
continues to provide editable OpenSCAD fabrication-reference kits.

```bash
PYTHONPATH=src python3 -m robotforge.cli describe \
  "a four-wheel rover with a camera and lidar" --mock --out build/robot.json
PYTHONPATH=src python3 -m robotforge.cli assets build/robot.json --out-dir build/robot-assets
# Open build/robot-assets/viewer.html directly in a browser.
```

Live description continues to use the project's existing Muse Spark transport.
The mock path is explicitly offline and does not call an AI service.

The initial mesh adapter accepts differential rovers with two wheels and
skid-steer rovers with four wheels. Other layouts are rejected before export;
the existing broader robot catalogue and its viewers are unchanged.

## Bundle contract

- `meshes/*.obj`: triangulated, metre-scale chassis, wheels and visible camera,
  lidar/laser or ultrasonic sensor approximations. Camera and sensor housing
  sizes are explicit assumptions; they are not sensing plugins.
- `*-collision.obj`: coarse collision references, labeled separately in the
  manifest. Generated models deliberately retain their existing primitive
  collisions for the motion gate's reliable contact behavior.
- `assets.json`: geometry dimensions and bounds, expected dimensions, triangle
  counts, oriented-edge watertightness checks, positive signed volumes, source,
  license and file SHA-256. This validates the generator's simple convex shapes;
  it is not a general-purpose mesh-repair or self-intersection detector.
- `robot.urdf`, `model.sdf`: mesh visuals using the original link poses. The
  SDF preserves the original collisions, inertias, joints and drive plugin;
  cosmetic sensor visuals are attached to the chassis without changing mass.
- `world.sdf`: a launchable world referencing this bundle's absolute model path.
  Regenerate the bundle after moving it to update that path. Model mesh paths
  themselves are relative to their URDF/SDF file.
- `viewer.html`: self-contained Canvas 3D projection with orbit, zoom, keyboard
  controls, explode, wireframe and per-part visibility. No CDN or network is
  required. The app's Forge thread also exposes its existing Three.js inspector
  and retains side/top fallback views for machines without WebGL.

Generated assets use Apache-2.0. Geometry hashes and labels travel with the
manifest. Asset validation never asserts that a robot is physically calibrated.
Photo drafts retain their ESTIMATED provenance and remain blocked by the gate.

## Real motion replay

```bash
PYTHONPATH=src python3 -m robotforge.cli run-gate examples/pathfinder.json \
  --workdir build/pathfinder-gate
```

Load the resulting `gate-report.json` with the viewer's report picker, then
scrub the recorded-pose slider. New runs record actual Gazebo model ground-truth
poses in `measurements.trajectory`; no movement is synthesized. Playback is by
sample index, not by wall-clock or simulation time. Both the bindings transport
and CLI transport capture poses. A SHA-256 of the parsed specification must
match the bundle; old reports without that fingerprint cannot be replayed.
A failed motion gate remains visibly failed during replay.

## Harmonic and Jetty

The adapter detects the default/highest installed `gz sim --versions` release,
then imports a matching binding family:

| Release | Sim | Transport | Msgs |
| --- | --- | --- | --- |
| Harmonic | 8 | 13 | 10 |
| Jetty | 10 | 15 | 12 |

Jetty's family follows the [official library matrix](https://gazebosim.org/docs/jetty/install/).
If matching Python bindings are missing, the streamed `gz` CLI path remains
available. In-process fallback requires the matching Sim and transport bindings.
No release or system packages are installed by the exporter. Jetty's adapter
selection is unit tested; running it on real Jetty remains an integration check.

## Remaining optional integrations

Gazebo Fuel search/download with pinned versions and license/attribution capture,
Blender refinement and general-purpose Trimesh import/repair are future adapters.
They are not required for this procedural pipeline. Existing OpenSCAD CAD export
remains available through `robotforge cad`.
