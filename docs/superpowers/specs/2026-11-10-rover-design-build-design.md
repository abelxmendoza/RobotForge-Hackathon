# Rover design, assembly and build generation

## Intent
Make RobotForge useful for designing and building a robot: describe a rover, choose real catalogue parts, inspect and revise its assembly, generate custom chassis geometry, and export a consistent build package. Simulation supports that workflow rather than being the main product.

The user liked the proposed complete rover workflow. Starting with a new rover is an implementation proposal; modifying an existing planned rover uses the same saved-version model. Approved by the user: “yes do it”.

## Approaches
1. Expand Wrench alone: reuses commands but keeps design controls and outputs hard to discover.
2. A guided design workspace connected to Wrench and Workshop: explicit steps, editable previews, and one saved design behind every output. Recommended based on the accepted describe/select/assemble/generate/export idea.
3. A separate CAD application or unrestricted text-to-robot generator: significantly larger and would duplicate the existing workbench and generation logic.

## First complete delivery
A dedicated Design a rover workspace, linked from Workshop and Wrench, with five connected steps:

### 1. Brief and concept
Collect a name, purpose, rover drive type (differential or mecanum), size, desired sensors, and optional budget/payload requirements. Use the existing Forge Engine for catalogue-grounded proposals. Preserve the original brief and every explicit requirement. Budget and payload remain requirements, not satisfied claims, when prices or engineering evidence are missing. Show a real interactive 3D concept, selected parts and assumptions before saving. Save only on explicit user action as a new PLANNED robot or version.

### 2. Select components
Use the shared catalogue and library categories for motors, wheels, battery, driver, controller/computer, power regulation and sensors. Support replacements for recognized roles using an audited engine synchronization path and regenerate derived plans. The current syncPlannedPart updates role IDs and derived plans but does not itself synchronize all core electrical/mechanical spec fields; implement and test those updates before offering a replacement. A motor replacement preserves the number of motors, and recorded wheel/motor/battery values update the simulation spec without inventing missing ratings. Show quantity, source, known specifications, missing values and compatibility findings. Do not record a catalogue selection as owned inventory or consume stock. Unsupported selections explain the missing role support rather than silently disappearing.

### 3. Assemble
Open the existing assembly workbench for the selected saved design. Preserve its placement, rotation, overlap checks, wiring preview and version history. Catalogue component envelopes remain estimates where detailed CAD is unavailable. The integration must reconcile Forge placement roles with assembly instance IDs so the workbench and exported package refer to the same instances. User changes survive returning to the design workspace; version mismatches prompt a refresh instead of silently exporting stale geometry. Assembly additions/removals must reconcile quantities with the effective BOM, not only alter spec.assembly: the existing commitAssemblyVersion does not synchronize Forge BOM/core fields. Recognized role changes update the relevant core spec and checks; supplemental hardware is included in the effective BOM with explicit unsupported-simulation effects and missing mass/power facts. Repeated instances and quantities stay consistent. If correspondence is ambiguous, require reconciliation before offering a consistent build package; never silently discard an instance or export competing parts counts.

### 4. Generate custom geometry
Start with an editable parametric rover chassis plate, component mounts, and electronics enclosure using existing CAD tools. Explicit controls include length, width, thickness and known mounting coordinates. Never infer hole locations from a visual envelope. Chassis mounting patterns without measured or recorded coordinates remain blank or require user input. Preview geometry and printer-bed fit. Editable OpenSCAD is the primary CAD output; provide STL only where the app actually generates equivalent geometry. Oversized designs require a larger bed or explicit redesign; do not promise physically joined tiles without an implemented joint design. Keep defaults visibly distinct from user dimensions.

### 5. Export build package
Produce one downloadable ZIP containing a manifest, the exact saved robot spec and version identity, catalogue BOM with quantities/sources, assembly instance poses, planned wiring, step-by-step assembly guidance, generated OpenSCAD and supported STL files, and engineering findings/missing measurements. Include a simulation specification consumable by the current app. Only include URDF if generated and validated by an available exporter; do not substitute a JSON file under a URDF filename or claim assembled parts enter Gazebo when unsupported.

The ZIP captures one coherent saved revision. It must not combine stale Forge placements, a newer assembly version and outdated CAD dimensions. Assembly guidance must distinguish generic planning steps from verified component-specific instructions. README explains units, provenance and which checks have actually run.

## Existing implementation to reuse
- lib/forgeEngine.ts: parseBrief, generateRobot, syncPlannedPart, engineering findings, BOM, placement, wiring and print plans.
- components/chat/ComposerCreate.tsx and components/forge/ForgeThread.tsx: generation and save patterns.
- components/assembly/AssemblyWorkspace.tsx and lib/assembly.ts: 3D workbench and versioned assembly changes.
- components/assembly/BuildArtifacts.tsx, lib/cadGen.ts, lib/buildArtifacts.ts: parametric mounts, enclosure generation and supported mesh exports.
- GarageRobot versions, lifecycle and browser/demo store conventions.

## Architecture and scope boundaries
Use the current Next.js static app and client-side storage. No new inference provider, cloud Worker change, paid service, or deployment is needed for this delivery. Add focused pure adapters for design requirements, assembly reconciliation and package generation rather than forking the existing authorities. Choose a maintained browser-compatible ZIP dependency during implementation if no existing encoder is available.

Requirements and provenance belong to the saved design; large derived downloads are generated on demand. Existing robots without design metadata remain editable. Existing Wrench fixes in the working tree are separate work and must be preserved. A saved design is a plan: no hardware validation, manufacturing certification, automatic purchase, or autonomous robot control is implied.

## Acceptance and verification
- A short differential-rover brief generates a preview with catalogue IDs and explicit assumptions; cancelling creates no saved robot.
- Saving creates a planned version; changing a compatible motor or wheel updates the correct quantities, placement/wiring plan and checks without rewriting earlier versions.
- Assembly edits and custom dimensions persist through navigation and reload; duplicate names and stale revisions are handled explicitly.
- Invalid dimensions, unknown mounting patterns, missing prices and missing motor ratings remain visible; none become a successful verification result.
- Exported ZIP entries parse, have safe filenames, reference the same robot/version/assembly revision, contain the actual generated CAD, and preserve units and warnings.
- Exercise the complete browser flow with a synthetic design. Report it as software validation, not a real robot build. Run relevant generation/assembly/CAD/export tests, production build, and the repository suite; report unrelated failures separately.

## Later expansion
Add more robot families, richer constrained custom geometry, manufacturer mounting patterns, and model-assisted design iteration after the rover path works end to end. These are not prerequisites for the first complete delivery.
