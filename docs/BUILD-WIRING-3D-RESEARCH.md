# Build, wiring and realistic 3D: source research

Research date: November 3, 2026 (America/Los_Angeles).
Scope: wheeled rovers, component models, mounts/enclosures, wiring and animated visualization. Repository coding was removed from scope by the owner. This is a source shortlist and proposed direction, not an approved implementation specification.

## Recommended foundations

| Need | Source | Verified evidence | Proposed use / remaining work |
| --- | --- | --- | --- |
| Small articulated reference robot | [ROBOTIS TurtleBot3 description](https://github.com/ROBOTIS-GIT/turtlebot3/tree/main/turtlebot3_description) | Official package contains meshes and URDF directories; parent repository identifies Apache-2.0 | Audit existing imported assets first; reuse missing original meshes and joint definitions, retain notices. A mesh alone is not a manufacturing model. |
| Rover assembly reference | [JPL Open Source Rover](https://github.com/nasa-jpl/open-source-rover) | Mechanical and electrical documentation, parts lists, linked complete Onshape assembly; Apache-2.0 stated | Source build sequence, mechanical relationships and wiring references. Onshape export availability and individual vendor asset rights still need checking before ingestion. |
| Real component CAD | [Pololu S18V20x resources](https://www.pololu.com/product/2575/resources) | Direct downloadable STEP file and dimension drawings | Pilot STEP-to-GLB conversion with a real regulator. Exact SKU compatibility and redistribution rights must be checked; free download does not establish an open asset license. This is step-up/step-down hardware, not a generic buck converter. |
| Motor CAD | [Pololu 37D motor resources](https://www.pololu.com/product/2821/resources) | Search result identifies STEP models; product is discontinued | Candidate family geometry only until exact variants, file and rights are verified. Do not recommend purchasing this discontinued SKU. |
| Enclosure generation | [YAPP_Box](https://github.com/mrWheel/YAPP_Box) | OpenSCAD generator with base/lid, standoffs, face cutouts and mounting features; MIT license read | Strong candidate for fast enclosure generation through constrained parameters. Add cable-entry dimensions, clearances and test fixtures; keep generated assumptions visible. |
| Editable precision CAD | [build123d](https://github.com/gumyr/build123d) | Existing optional RobotForge backend already exports validated STEP/GLB; upstream Apache-2.0 | Extend current backend for mounts and editable enclosures; avoid maintaining contradictory dimensions between OpenSCAD and build123d generators. |
| Wiring documentation | [WireViz](https://github.com/wireviz/WireViz) | YAML harness definitions; SVG/PNG/HTML and BOM outputs; GPL-3.0 | Optional compatible export target after license review. It documents wiring, not electrical safety. Extend RobotForge's current harness validator for power calculations. |
| Articulated browser models | [urdf-loaders](https://github.com/gkjohnson/urdf-loaders) | Three.js URDF loader; Apache-2.0; RobotForge already depends on urdf-loader | Reuse existing dependency and preserve joint transforms rather than importing a single welded robot mesh. |
| Lighting and materials | [Poly Haven asset license](https://polyhaven.com/license) | HDRIs, textures and models released under CC0 | Use selected HDR lighting/material assets through permitted download channels. CC0 asset rights do not grant unlimited website scraping. |
| High-quality rendering | [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) | MIT; current main requires WebGPU, supports MeshStandardMaterial/MeshPhysicalMaterial; animation rendering example | Optional progressive quality preview/export. RobotForge uses Three.js ^0.160.0; compatibility is unverified. Pin a compatible version or deliberately upgrade after a spike. Keep fast rasterized interaction and fallback. |

## Asset pipeline proposal

1. Audit existing RobotForge components, specimen meshes, URDFs and source notices before fetching duplicates.
2. Select exact part variants with rights suitable for redistribution. Record source URL, upstream revision, license, units, dimensions and attribution per asset.
3. Keep original STEP for engineering; convert to optimized GLB for display. Validate units and known dimensions after conversion. Material assignment and UV/texture work are separate from geometry accuracy.
4. Preserve separate movable links, joint origins, connector anchors and mounting-hole coordinates. Rig missing relationships explicitly; a downloaded model is not automatically animated.
5. Use PBR materials, HDR environment lighting, contact shadows and sensible camera exposure for interactive assembly. Evaluate progressive path tracing for stationary previews and rendered clips.
6. Build cable paths between named pin/connector anchors, with editable routing points, bend-radius metadata and estimated cut lengths. Animation explains assembly order; it does not demonstrate current flow or electrical safety.
7. Drive model placement, generated mount/enclosure dimensions, cable routing and checks from the same versioned assembly record. Invalidate dependent outputs after edits.

## Proposed first vertical slice

Use an existing TurtleBot3 specimen as a model-pipeline fixture because RobotForge already has it. Generate a custom electronics mounting plate and a removable-lid harness enclosure for a documented component set. Add connector anchors and a complete wiring graph. Catch an intentionally incompatible supply, then propose a converter only when sourced operating ranges and loads support it. Preview assembly/explosion and wheel motion with improved materials. Export CAD, wiring documentation and check results tied to the assembly revision.

TurtleBot3 is a practical test fixture, not a decision to replace the owner's rover with it. The same pipeline should accommodate Omega1 once component geometry and dimensions are available.

## What web assets will not supply automatically

- Pin-level electrical specifications, regulator sizing or verified polarity for arbitrary parts.
- Accurate internal geometry, mounting coordinates or mass from decorative models.
- Animation rigs, physically meaningful cable motion or photorealistic textures for every CAD model.
- A safety guarantee from attractive rendering or nominal-voltage checks.

## Next design decisions

Prioritize usable generated build artifacts and wiring checks, then visual fidelity. Specify the assembly data model and proof-of-concept asset conversion before committing to a renderer upgrade. Use open licensed sources where possible and explicitly record restricted/unverified assets instead of silently bundling them. No Worker deployments or secret operations are needed for this research.
