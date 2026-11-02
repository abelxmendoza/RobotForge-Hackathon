# Omega1 digital twin — provenance and conversion record

The twin appears in the app as a **built-in Garage specimen**: the
Omega1 entry in the Garage's specimen list opens it. It is not a
stored user robot and carries no spec versions.

## What it is

On 2026-11-01, ProjectSim (Kaedim) generated seven Standard assets
from Abel's gift credits:

- **The whole rover**, from one real photo of Omega1 on the bench
  (the Omega-Code README photo `1719168223539.png`, cropped to the
  robot). Two other README images were rejected as sources — they
  are AI concept art, not photos of the robot. The rover asset is
  articulated (root link `chassis`, 5 revolute joints: sensor head
  and four wheels).
- **Six parts**, each generated separately: the HC-SR04 module (from
  the catalogue's verified SparkFun product photo), and the
  Raspberry Pi, Pi Camera, DC gearmotor with wheel, 18650 cell pair
  and chassis plate (each from a text description).

**Every geometric and physics value in these assets is a ProjectSim
model ESTIMATE (VLM-inferred), not a measurement.** MEASURE.md remains
the robot's measured record; nothing in the twin overrides it. The
part models are independent reconstructions — they share no frame
with the rover model, so the app shows them as a gallery and never
as a fitted assembly. The rover viewer's explode slider separates
only the rover model's own links.

**Not generated:** the motor-driver / expansion board visible under
the chassis in the photo. No RobotForge record (MEASURE.md,
omega1.template.json, omega1.extracted.json) names it, so it was
skipped rather than guessed. (The extracted record does name the
motors' driver chip, PCA9685, but no board identity was recorded
for generation, and none was invented after the fact.)

## Conversion (USD → GLB), 2026-11-01

Tool: `tools/convert_usd_to_glb.py` — `usd-core` (pxr) reads each
USDC stage; meshes are extracted with world transforms, triangulated,
grouped by USD link and material, and rebuilt as a trimesh scene
exported as GLB. Collision-purpose meshes are excluded. Z-up (USD)
is rotated to Y-up (glTF).

Deliberate simplifications for the web build:

- Only each material's **base-colour** texture is carried over
  (downscaled to ≤1024 px, re-encoded as JPEG inside the GLB).
  Metallic, roughness and normal maps were dropped.
- Untextured buckets over 20k faces were decimated ~50% (quadric).
  Textured buckets were never decimated — the simplifier drops
  texture visuals, and a textured mesh keeps its texture or its
  triangles.

Sizes (originals → committed media in `assets/omega1-twin/`):

| Subject | USD download (folder) | GLB |
|---|---|---|
| Omega1 rover | ~39 MB | 10.6 MB |
| HC-SR04 module | ~35 MB | 0.39 MB |
| Raspberry Pi | ~49 MB | 3.7 MB |
| Pi Camera | ~42 MB | 3.5 MB |
| Gearmotor + wheel | ~33 MB | 1.1 MB |
| 18650 pair | ~37 MB | 0.40 MB |
| Chassis plate | ~12 MB | 3.3 MB |

Plus one preview still per subject (the generator's own preview
render, downscaled to ≤1024 px JPEG, ~0.45 MB total). Committed
media total ≈ 23.5 MB. The 240 MB of original USD downloads are
NOT in the repo.

## Asset IDs (ProjectSim)

- Rover: `ast_01M6CG8T5RQKT024Z8ENHKMRCZ`
- HC-SR04: `ast_01M6CHS5ZEY37YSJ0TW1QNGCEA`
- Raspberry Pi: `ast_01M6CHS72PCKNZJCZR4JVCV7DJ`
- Pi Camera: `ast_01M6CHS89SFXF9164864DJJY6V`
- Gearmotor + wheel: `ast_01M6CHS9QHPVYABX8K438D6CQ5`
- 18650 pair: `ast_01M6CHSAV5MPJK0XN12XB99SK8`
- Chassis plate: `ast_01M6CHSC1B4QN7W11M0K4X4ESA`
