# Unified Workshop and Wrench — proposed plan

Status: proposal for review, not an approved implementation specification.
Date: 2026-11-11.

## Expanded reference: RoboLabs

Owner direction: “I want to be able to do what this app can do,” referring to https://robolabs-app.vercel.app/. This expands the target from a room backdrop to interactive assembly, inspection, learning, and a proving ground. Keep all these capabilities inside Workshop with Wrench.

### Observed reference capabilities (2026-11-11)

Inspected live UI on Optimus Gen 2, plus its robot selector and comparison panel:

| Reference capability | RobotForge home and proposed behavior |
| --- | --- |
| Detailed robot in an industrial hangar; selector lists ten robots | Workshop scene with robot picker; preserve the selected robot/version across tools. Expand supported robots progressively. |
| Build mode lays components out on two benches; step counter, description, Do this step, Hint, Auto-build, timer | Build → Guided assembly. Wrench explains the current step and can request next, hint, undo, or reassemble through the same controller as buttons. |
| Parts list in assembly order; selected battery shows description and fastening information | Build → Inspect. Click a mesh or accessible list item to select the same stable part ID and show its record. Unknown fastening details stay unknown. |
| Exploded-view slider; shell/frame/actuator/power/electronics/sensor/wiring visibility switches; camera presets/reset | A compact inspector toolbar on the shared 3D scene, also controllable through Wrench. |
| Systems lessons reference groups of parts and highlight related components | Contextual Explain panel in Build/Wiring; Wrench grounds its explanation in the selected system and recorded part relationships. |
| Robot specs and sortable fleet comparison | Overview → Specs/Compare drawer, including sources and unknown values; keep out of primary navigation. |
| Five-question quiz UI | Optional Learn drawer in Workshop, with part highlighting, explanations, and separate learning progress. |
| Proving ground with movement/run/jump/wave/punch/reset controls, speed, best-jump readout, and seven course gates | Test → Proving ground. Begin with rover driving, steering, obstacles, reset, and measurable course results; add other robot classes only with appropriate articulation and controllers. |

Evidence limits: a build step was triggered and entered its moving-into-position state; a battery selection displayed its part card; systems, quiz, comparison, and proving-ground controls were inspected. Full assembly completion, answer scoring, movement accuracy, contact physics, and real-world specification accuracy were not validated. Observed action labels do not establish physically valid locomotion. No inference about RoboLabs' engine or source asset pipeline is required.

### Necessary data and engineering work

An attractive GLB alone cannot support this experience. Each supported robot needs a manifest mapping stable part IDs to meshes, subsystem membership, assembly order/dependencies, installed transforms, bench transforms, exploded offsets, descriptions, provenance, and permitted interactions. Articulated robots additionally need joint frames, axes, limits, collision bodies, and an appropriate controller. Keep simulated measurements separate from animation.

Define a shared scene controller for select-part, set-visibility, explode, camera-preset, assembly-step, reset, and test controls. Wrench and pointer/keyboard controls invoke that controller; Wrench reports acknowledgments from it. Assembly progress is separate from physical-build completion and engineering-check status. Persist progress per robot/version and invalidate or remap it explicitly when parts change.

### Revised milestones and acceptance

1. **Consolidate Workshop and design:** retain the five-tab plan and shared Wrench design service below. No new Design, Explore, Learn, or Proving Ground navigation tabs.
2. **Complete one rover end to end:** use Omega1 or a catalogue rover after verifying part-addressable asset coverage. Deliver mesh/list selection, exploded view, visibility, camera reset, bench layout, ordered assembly with undo/resume/auto-build, and Wrench step guidance. A monolithic scan gets viewing capabilities only until part segmentation is supplied; do not fabricate internals.
3. **Make the room useful:** add Blender-authored scene assets around the working interactions. Prototype with simple geometry first. Scene details must not obscure controls or impair mobile use.
4. **Add a rover proving ground:** reuse the existing driving/physics work where suitable; provide keyboard and touch input, obstacles, reset, course progress, and clearly identified simulation results. Check collisions and units with deterministic scenarios; an animation is not a dynamics test.
5. **Add learning and comparison:** sourced system explanations, optional quiz progress, and comparable known specs, grounded in the same manifests. Wrench can explain or quiz without changing the robot.
6. **Expand the robot library:** add curated humanoids, quadrupeds, arms, and other platforms with authorized/licensed assets and source-backed records. Offer inspect/build/animate/simulate only when the individual manifest supports each capability. Humanoid walking/running/jumping is a separate controller-and-physics milestone, not a rover feature toggle.

Feature-parity acceptance is capability-based, not a promise of the same ten branded robots or identical art. Verify every supported action from both Wrench and normal controls; confirm reset/resume, version changes, missing assets, unsupported actions, keyboard/touch access, and mobile performance. Include a parity checklist in implementation reviews and distinguish demonstrated, implemented, verified, and deferred capabilities.

The earlier four-phase delivery sequence below describes the consolidation and environment work; this expanded six-milestone sequence governs the broader requested scope.

## Outcome

Workshop is the one place to design, assemble, wire, check, simulate, and revise a robot. Wrench operates on that same workspace. “Design a Rover” becomes an action within Workshop, never another app navigation item or top-level workspace tab.

## What exists today

- `web-next/src/components/garage/Workshop.tsx` already mounts Garage with one docked ForgeThread (Wrench).
- `Garage.tsx` currently exposes eight tabs: Overview, Build, Wiring, Drive train, BOM, Test, History, Simulate. The earlier `2026-11-03-workshop-simplification.md` proposes five; reconcile with current behavior rather than assuming it shipped.
- `ForgeThread.tsx` already generates catalogue-based planned concepts through `runConceptText`, using `forgeEngine.ts`, and saves them into the Garage store. It has Ask & manage, Design a robot, and Create controls.
- `workshopContext.ts` publishes the current draft and checks to Wrench. `wrenchPrompt.ts` bridges Workshop actions into the composer.
- Existing Three.js surfaces include `kit/Robot3D.tsx`, `wiring/WiringBench3D.tsx`, and `simulation/DriveScene.tsx`. Rapier is already a dependency.
- No literal “Design a Rover” entry or separate rover route was found in the inspected tracked source. Before removing anything, identify its actual deployed surface, route, or branch. The local app navigation currently contains Home, Workshop, My Parts and Tools, and Robots.
- Initial working tree was clean. No application code or deployment was changed for this proposal.

## Proposed experience

1. Open Workshop and select an existing robot or choose **New robot**.
2. New robot offers **Describe a design**, **Import**, and **Start from a known robot** within the existing creation surface. Rover is a starter choice, not a separate destination.
3. Describe a design opens Wrench in place. Example: “Design an outdoor rover with a camera.” The result appears on the bench as a planned concept, with recorded assumptions and missing inputs.
4. Keep five primary tabs: **Overview, Build, Wiring, Test, History**. Put drivetrain, parts list, and tools inside Build as on-demand panels; put simulation inside Test. Avoid replacing eight tabs with eight always-visible sub-tabs.
5. Build combines the model, relevant part controls, and the design brief. Wrench can explain the selected part, propose a replacement, or revise a concept without leaving Workshop.
6. Preview an edit to an existing robot before saving a new version. A new concept gets a separate robot identity. Never silently replace a real-build record with a generated concept.
7. Keep one Wrench composer, with one clear Create entry. Remove overlapping controls only after their capabilities have an equivalent home.

## Architecture and Wrench behavior

- Extract the existing concept-generation operation from ForgeThread into a shared, UI-independent service (proposed `web-next/src/lib/workshopDesign.ts`). Both buttons and Wrench invoke this service; do not create a second generator or storage format.
- Use explicit operations for create-concept, revise-planned-concept, and propose-existing-robot-change. Carry robot ID and baseline version ID with edits. Reject stale proposals and allow retry against the current version.
- Keep Garage as owner of the active unsaved draft. A shared proposal/apply contract must reconcile Wrench edits with that draft before persisting; the current text snapshot is advisory and must not become a mutation channel.
- Refresh the context bridge when the selected robot, version, draft, part, or check changes. Add selected-part/design context only as needed; do not send the entire scene or asset blobs to a model.
- Wrench actions include “design a rover,” “make a new concept,” “change these wheels,” “show wiring,” and “test this design.” Distinguish a question from a mutation, and disambiguate a new robot versus revising the selected one.
- Show actual action results and errors. Never claim a save, model call, simulation, or test occurred based on generated chat text alone.
- Preserve demo/account storage isolation, estimated-field provenance, planned status, history, and storage-error reporting.

## 3D direction and alternatives

**Recommended: Blender-authored assets rendered through existing Three.js.** Author the room, workbench, parts trays, pegboard, lights, tools, and test-floor props in Blender; export optimized GLB assets. Keep robot geometry and engineering state separate from decorative scenery. Reuse existing renderer behavior through a shared scene host where practical rather than mounting every viewer at once.

**Lighter alternative: a stylized Three.js workbench.** Build the first environment from simple geometry and existing props. Faster to validate interactions and performance, with less visual detail. This is a useful prototype before commissioning finished Blender assets.

**Larger alternative: Unity environment.** Consider this if a navigable room, immersive training, or game-style interaction becomes a core product requirement. It would introduce another runtime and a browser-to-Unity state bridge. That complexity is not needed to consolidate the current web workflow. Verify the chosen Unity version and browser targets before committing to it.

These are recommendations, not choices already approved by the owner.

### Scene layout

- Center: selected robot on a workbench, with orbit, zoom, select-part, and reset-view controls.
- Parts tray: opens Build's parts controls; do not imply all catalogue parts are owned.
- Wiring station: focuses Wiring for the selected robot.
- Test area: opens Test/simulation for that robot, with explicit start/stop.
- Wrench: remains readable in the normal interface; a scene character is optional polish.
- No mandatory walking, first-person controls, or camera travel to complete tasks. Normal accessible controls provide every action.

### Rendering constraints

- Lazy-load the environment; keep the robot/workflow usable while it loads or fails.
- Retain a lightweight 2D workspace option, reduced motion, touch controls, keyboard access, and meaningful selection labels outside the canvas.
- Prefer one active WebGL canvas. Pause hidden scenes; dispose geometry, textures, listeners, and render loops on transitions.
- Provisional environment budget: <=5 MB initial compressed environment assets and <=100k visible environment triangles, excluding the robot. Validate on an agreed midrange phone and desktop; aim for >=30 fps on the phone. These are proposed acceptance targets, not measured results.
- Asset manifests record source/license, units, up axis, scale, version, and named interactive anchors. Verify exports in the web renderer, not only Blender.
- Room appearance never changes the evidence level of a model: concepts remain estimated; simulated outcomes remain simulated; scans do not supply unrecorded physical properties.

## Delivery sequence

### 1. Confirm the actual entry points and consolidate navigation

- Compare local source with the currently deployed app and identify the separate Design a Rover surface.
- Inventory all creation, design, saved-draft, and legacy-link behavior before removing an entry.
- Modify `Garage.tsx`, `Workshop.tsx`, and relevant shell/creation links to implement the five-tab organization and in-place New robot flow.
- Preserve old URLs/hash tabs by mapping BOM/tools/drivetrain into Build and simulation into Test. Maintain requested subpanel and selected robot. A static export needs client-compatible legacy route handling.
- Acceptance: every existing design capability is reachable from Workshop; no separate Design a Rover nav entry remains; old bookmarks land in the correct robot and panel.

### 2. Make Wrench and visual controls share the design workflow

- Extract generation from `ForgeThread.tsx`; reuse `forgeEngine.ts`, Garage data types, and `store.ts`.
- Extend `wrenchPrompt.ts` and `workshopContext.ts` with the minimal typed requests/context needed for the approved design.
- Implement proposal preview/apply/cancel for existing robot changes, preserving unsaved work and checking baseline identity.
- Acceptance: button and chat creation produce the same kind of planned robot; edits preserve identity and history; questions do not mutate; stale proposals and storage failures are reported accurately.

### 3. Validate an interactive 3D workbench

- Prototype a simple room using existing renderer/model components. Keep this separate from final art production.
- Connect workbench, parts tray, wiring station, and test area to the same actions as the normal interface.
- Test loading failure, context loss, reduced motion, mobile touch, keyboard access, and switching repeatedly between tools.
- Acceptance: all core work remains possible without 3D; selected robot and draft remain consistent; no accumulating render loops or hidden simulations.

### 4. Add Blender art and polish

- Create source art and documented export settings; add optimized runtime assets under a dedicated workshop asset folder following existing asset-copy conventions.
- Replace prototype scenery while preserving named interaction anchors and existing robot viewers.
- Measure asset transfer, first usable workspace, frame rate, and scene cleanup on the agreed devices. Reduce asset detail if the budget is missed.
- Acceptance: the environment feels like a robotics workshop and meets the approved performance targets without obscuring the robot, controls, or Wrench.

## Verification for implementation

- Extend the existing focused suites: `tests/test_workshop_tabs.py`, `tests/test_workshop_chat_context.py`, `tests/test_wrench_intake.py`, `tests/test_forge_engine.py`, `tests/test_workshop_simulation.py`, and `tests/test_workshop_3d_take_apart.py`.
- Add behavioral coverage for old route/hash mappings, same-service chat/button creation, draft reconciliation, stale proposals, duplicate submission, storage failure, and demo isolation.
- Run focused Python tests, web TypeScript checks, and the production static-export build using current repository instructions. Report PASS, FAIL, and SKIP separately.
- Browser-check desktop and phone flows: create, revise, cancel, save, reload, switch robot, open legacy links, test, and use the workspace with 3D unavailable.
- Distinguish local deterministic generation tests, fake-provider tests, real model calls, numerical predictions, physics runs, and hardware evidence. No hardware validation is implied.

## Boundaries and decision needed

This plan includes no Worker deployment, secret changes, rate-limit changes, shared-branch push, or application implementation. Follow the repository's explicit authorization rules for each of those actions.

Recommended next decision: approve the unified workflow and Blender/Three.js workbench direction, or choose the larger Unity direction. After that, turn this proposal into an approved design and task-level implementation plan.

## Reference

- Blender glTF export overview: https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html (reference URL; retrieval was unavailable during planning).
- Unity browser compatibility: https://docs.unity.com/en-us/engine/6000.0/manual/platform-specific/webgl/intro/browsercompatibility (consult documentation matching the version selected for any Unity prototype).
