# Conversational robot operations

## First slice implemented

The Next.js Forge Guide recognizes explicit local commands before its question-answering engine:

- `list my robots`
- `operations`
- `set "Omega1" wheel.diameter_m to 0.12`
- `set "Omega1" battery.voltage_v to 12`
- `undo last chat change`

Names match exactly, case-insensitively. Duplicate names require renaming first. Values use exported spec units (metres, kilograms, volts, mAh); units are never silently inferred. Editable paths come from the Garage's FIELD_GROUPS. Invalid types, nonfinite values, negative dimensions and arbitrary object paths are rejected.

Edits produce a preview, with browser validation findings, before Apply creates a new version in the existing Garage store. Findings may remain: this is design editing, not a certification gate. Apply revalidates the operation against the latest version. Stale proposals fail. Storage failures are reported and never announced as success. Undo appends the previous spec as another version and refuses to overwrite intervening edits. Open Garage drafts are deliberately preserved; loading the new saved version into the editor is explicit.

This slice is deterministic local command parsing, not live model tool calling. The model's answer text cannot execute operations. Unsupported requests beginning with operational verbs are intercepted with an honest no-change response. The original static/vanilla Guide is unchanged.

## Shared execution architecture

Conversation -> intent/tool proposal -> typed operation -> resolve target -> validate arguments and revision -> preview changes and checks -> apply -> persist -> report actual result.

The action runner must be shared by chat, toolbar buttons and future model tool adapters. Models return allow-listed tool arguments, never JavaScript, arbitrary JSON patches or shell commands. Catalogue entries and retrieved documents are reference data, never instructions to execute.

Each proposal should carry operation ID, robot ID, expected revision, arguments and source. Each result should carry status (needs-input / preview / applied / failed / queued), resulting revision and relevant artifacts. Future asynchronous jobs additionally need job IDs, cancellation and revision-bound results. Repeated operation IDs must return the original result rather than repeat execution.

## Delivery sequence

1. **Current:** list saved robots; preview/apply allow-listed field edits; version-preserving undo. Tests cover runtime input validation, stale revisions, ambiguity, immutable updates and intervening edits.
2. **Component identity and assembly:** catalogue schema with exact variants, aliases, dimensions, mounting-hole frames, connectors, electrical limits, source and license. Add/remove component instances and transform poses in the same assembly state used by 3D controls. Resolve ambiguous “it” through explicit selection; never guess between components. Persist assembly separately from strict CLI robot specs until the core schema supports it.
3. **Typed model tools:** extend the existing Muse Spark Worker transport with JSON operation proposals, not prose-as-actions. Send only the relevant selected robot context. Validate model output through the same runner. Expose actual supported capabilities in the system prompt; unsupported operations return needs-input or unavailable. Retain deterministic offline commands.
4. **Placement:** select component, add component, move/rotate component, suggest candidate placements. Record coordinate frame and units. Preview three candidates using fit, access, cooling keep-outs, mass and cable-distance estimates. Undo transforms through robot revisions. Do not label illustrative placements collision-checked.
5. **Wiring:** visible Wiring view in My robots; add/remove typed connections with source/destination pins. Reuse Python harness checks via a supported backend or an explicitly limited browser port. Missing voltage/current/pin data must stay NOT_CHECKED. Generate WireViz diagrams/BOM from that same graph. Confirmation is per actionable preview, not every conversational turn.
6. **Mounts and sourcing:** resolve existing CAD assets and mounts with license/source metadata; generate parameterized trays through existing OpenSCAD or optional CadQuery. Preview fit and export source/STL/STEP where supported. Supplier searches return exact-variant matches and retrieval times; buying is a separate explicit user action.
7. **Simulation jobs:** submit an immutable spec/assembly revision, track job state, cancel, display logs and attach hash-bound report/trajectory. Distinguish queued, completed, failed, recorded and hardware-tested. A model never assigns a gate verdict.

## Interaction rules

- Read-only search, inspection and validation run immediately.
- Reversible design changes get one clear preview with Apply and Cancel; approved workflows can later opt into grouped apply with undo.
- Removals show dependencies and affected wires/mounts. Purchases, external publishing and physical robot control are outside this first scope.
- Multiple tool steps preview as one transaction and commit atomically or leave state unchanged.
- Never announce success before persistence or job acknowledgement confirms it.

## First integrated demo target

Open a rover -> type a supported Jetson name -> resolve carrier-board variant -> add its dimensioned asset -> choose placement -> add a battery/converter branch -> see an incompatibility and fix it -> export assembly and harness documentation. Generated mounts follow this connected slice.

## Remaining verification

Browser interaction QA should cover Apply/Cancel, double click, failed localStorage writes, reload persistence, duplicate names, stale previews, undo and preserving unsaved Garage drafts. The production app build and the existing Python suite remain release checks. Headless Gazebo validation remains a separate integration task.


## Component assembly increment (implemented)

My robots now includes an Assembly workbench before spec editing. The Guide and buttons share the same revision-checked assembly transactions. Supported chat commands:

- `add a Jetson Orin Nano to "Omega1"`
- `add a battery to "Omega1"` (explicit illustrative placeholder)
- `add a buck converter to "Omega1"` (explicit illustrative placeholder)
- `move "Jetson Orin Nano" on "Omega1" to 0 0 70 mm yaw 90`
- `connect "battery" to "Jetson Orin Nano" on "Omega1"`
- `remove "part-id" from "Omega1"`
- `undo` (last chat action only, rejects intervening revisions)

The robot name is unique and explicit. Component names resolve when unique; duplicate parts require their displayed instance IDs. The published NVIDIA reference developer-kit envelope is sourced in `components.ts`; the bare module and third-party carriers are not assumed equivalent. Other initial assets are planning placeholders with clearly estimated dimensions, not selected products.

Assembly instances have stable IDs, positions in metres (robot X forward/Y left/Z up, component centre), and yaw in degrees. Add, move, remove, connect and disconnect produce a preview; Apply persists another assembly version. Removing a component previews removal of dependent connections. Undo appends a restoration, never deletes history. Export contains saved spec plus all assembly versions.

Three.js reuses the existing robot schematic renderer and adds component envelope boxes and dashed planning edges. The workbench is 3D-only; WebGL failure shows an actionable error and Retry 3D button, without substituting a flat view. Three geometric placement candidates are offered as starting points; no collision, cooling, cable-routing or mounting-hole fit claim is made. Assembly additions do not yet update CLI specs, mass budgets, electrical checks or simulation inputs.

Wiring is a visible tab. Its edges are **NOT_CHECKED planning connections**, not pin-level wiring instructions or core harness-validator results. Exact part ratings, pin assignments and protection still need a schema and a connection to the existing electrical checks. Printable mounts, detailed manufacturer CAD retrieval, supplier search and live model tool proposals remain next stages.

Verification includes transaction tests for identity resolution, invalid transforms, unknown components, duplicate instance/connection detection, stale robot/assembly revisions, cascade removal, ambiguity and undo. Browser QA confirmed chat addition, placement preview/apply, reload persistence, and wiring connection preview/apply. The test browser disables WebGL, so actual GPU rendering remains unverified. Earlier SVG fallback QA does not establish 3D rendering correctness.


## 3D workbench and effects

Both assembly placement and wiring use one Three.js scene. Connections are selectable tube meshes with curved illustrative paths, envelope-top anchor proxies and optional moving pulses. The paths do not solve collision, bend radius or physical cable routing; anchors are not documented connector positions. Pulses illustrate graph direction, not measured current.

Added components ease into position, exploded-view offsets animate, and the camera is retained when previews change. X-ray mode fades the robot schematic while leaving added components and cables visible. Motion effects can be disabled and respect the operating system's reduced-motion preference. Explode and X-ray are view controls and do not change saved assembly coordinates.

Suggested next 3D features, in priority order:

1. Transform gizmos and snapping to defined deck/mount planes, with ghost previews and the existing Apply/Cancel transaction.
2. Verified mounting holes and fastener previews, followed by parameterized printable brackets.
3. Geometry-based interference highlighting and cable bend-radius checks once actual models and cable types are available.
4. Sensor field-of-view cones and editable obstruction overlays, driven by documented sensor parameters.
5. Version comparison in 3D: animate old/new placements, highlight changed parts, and replay assembly steps.
6. Mass-informed center-of-mass markers and clearance/thermal keep-out volumes, explicitly naming missing inputs.


## Interactive spatial increment

- Drag placement uses ray/plane intersection in robot XY, with a 5 mm grid and optional snap to the schematic deck top. Release creates a move proposal through the existing transaction runner; Apply is still required. Escape/pointer cancellation restores the displayed pose. Dragging is disabled during explode/playback. Numeric XYZ/yaw inputs remain available for precise and keyboard edits.
- Red overlap warnings use a separating-axis test on yaw-oriented component envelope boxes, including vertical separation. They do not check the chassis, cables, holes, detailed geometry or transient replay poses. Face contact is not counted as penetration.
- Ghost trays show an illustrative plate and corner support proxies. No mounting holes, fastener fit or printable geometry is claimed without measured mounting data.
- An adjustable FOV sketch projects a cone along the selected component local +X. Its angle/range are assumed user inputs, not verified sensor parameters. It does not test occlusion.
- Upgrade playback compares the previous assembly component poses to the latest preview, interpolates position and shortest-path yaw, and shows added/removed components at their endpoints. Wiring remains the latest planned graph. Playback is visual only and never commits a version; reduced-motion skips autoplay animation.

GPU interaction verification is still outstanding in this environment because its browser disables WebGL. Unit tests exercise overlap orientation/contact/vertical separation, snapping, numeric validity and yaw interpolation. The production build checks the renderer and control types.
