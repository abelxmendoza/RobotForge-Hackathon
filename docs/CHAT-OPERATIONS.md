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
