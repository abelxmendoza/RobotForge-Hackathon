# Build, wiring and 3D implementation plan

Goal: integrate the researched reusable foundations into the existing local app, without a deployment or repository coding feature.
Spec: docs/BUILD-WIRING-3D-RESEARCH.md, accepted by the owner for implementation.
Architecture: extend current CAD, wiring and Three.js workbench; avoid a renderer migration and Worker changes. Generated geometry and missing electrical inputs stay labeled.

## Constraints
- No Worker, deployment, secret, push or production changes.
- Preserve current storage and assembly behavior.
- Vendor only assets with checked redistribution licenses and attribution; pin upstream revision.
- Keep interactive WebGL and existing urdf-loader. Do not require WebGPU path tracing for the workbench.

## Tasks
- [x] Enclosure generation: extend pure CAD generator with validated box/lid/cable-opening geometry, add numeric-invalid-input tests and chat support; expose downloadable artifacts through Build UI.
- [x] Harness analysis/export: add pure voltage-range/current/drop checks and a user-facing report with missing-data states; export connection table and compatible WireViz YAML only with known pin data; no embedded GPL engine.
- [x] 3D presentation: improve materials/lighting and asset provenance using existing render architecture; acquire one verified open-source real robot asset set if absent. Preserve selectable parts and animation.
- [x] Build integration: add enclosure controls and artifact downloads to the saved robot assembly Build tab, dimensioned from the selected component or explicit inputs.
- [x] Verification: run focused behavior tests, TypeScript and production build; browser exercise Build and Wiring with a saved robot. Review exported CAD and wiring reports. Record limits and follow-on work.

## Review focus
- Nonfinite, negative or impossible geometry must refuse generation.
- Unknown current/voltage/pin information must not produce a passing harness or invented pinout.
- Generator errors must be visible and recoverable.
- Missing/slow 3D assets must preserve current fallback and controls.
- Downloads must match visible inputs and preserve source/license notices.

## Verification and current limits

- Complete local suite: 858 passed, 5 skipped. Production static build succeeded.
- Browser: printable mount preview rendered; STL export reported success; enclosure invalid dimensions disabled downloads; YAPP dependencies are exposed; wiring facts saved a second robot version and updated the report.
- Mount geometry test verifies closed edges, exact bounds and through-hole volume.
- OpenSCAD is absent: enclosure rendering and physical fit remain unverified. No full photorealistic renderer, manufacturer-wide model library or automatic converter selection is claimed.
- No deployment, Worker changes, secret operations, push or merge performed.
