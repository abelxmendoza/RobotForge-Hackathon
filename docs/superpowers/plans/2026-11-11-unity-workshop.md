# Unity Workshop Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task. Preserve the current checkout's uncommitted Workshop/G1 changes. This document authorizes no deployment or shared-branch push.

**Execution update (2026-11-11):** The owner installed Unity 6000.6.8f1 with Web support. That installed release is now pinned instead of the original 6.3 recommendation. The first local inspection milestone is built and verified; see `docs/unity/verification.md`. Remaining gates below are not claimed complete.

**Goal:** Embed an interactive Unity robotics workshop inside the existing Workshop, with the same selected robot, G1 link/joint controls, Wrench commands, and saved-version workflow.

**Architecture:** React owns robot records, unsaved drafts, account/demo isolation, accessible controls, and Wrench. An embedded Unity Web player owns scene rendering, transient interaction and explicitly requested simulation. A versioned asynchronous bridge carries snapshots, commands and acknowledged results; Unity never writes directly to browser stores or calls model services.

**Tech stack:** Next.js static export, React/TypeScript, Unity 6.3 LTS with Universal Render Pipeline and Web Build Support, C#, a JavaScript `.jslib` bridge, Blender-authored environment assets where useful. Pin an exact supported Unity patch during Task 1; do not choose an alpha/beta or claim a patch has been verified before building it.

**Spec:** This document's product contract below, based on the owner’s Unity request and the existing `2026-11-11-unified-workshop-proposal.md` and `2026-11-11-g1-workshop.md` plans. All new engine/layout choices here are recommendations for implementation review.

## Product contract

- No Unity page, extra app navigation destination, or second Wrench. Load Unity within Workshop → Build and, later, Test.
- Start with a workbench camera. Orbit/zoom, selectable parts, exploded inspection, visibility, joint sliders, reset and link exploration remain reachable without walking around a room.
- Render the selected G1 reference and one supported rover. Keep the current Three.js/lightweight experience as an explicit fallback until Unity passes acceptance on the target devices.
- Offer a small view choice in the existing scene controls: Immersive / Lightweight. Lazy-load Unity only when the immersive view is requested. No downloads on Home or other pages.
- React retains the accessible link list, joint controls, status messages, version history and save controls. Scene clicks update those same controls.
- Match G1's existing evidence labels: official model, educational reference, planned, not owned hardware. Link order is educational, not verified assembly instructions.
- Reuse current part IDs, robot IDs, version IDs, sources and asset licenses. Never copy RoboLabs assets without established permission.
- Distinguish visual animation, estimated physics, measured simulator output, and hardware validation in every result. A walking animation is not a validated gait.

## Global constraints

- No Worker, secret, auth or rate-limit changes. Follow `AGENTS.md` before any future deployment; Unity is a static web asset delivery task.
- Preserve browser drafts, demo isolation, selected version and unsaved-change protection across renderer changes and crashes.
- One active 3D engine at a time. Unmount the Three.js renderer before Unity starts; await Unity `Quit()` before mounting another player or restoring Three.js.
- Unity uses no embedded credentials, direct model API calls, arbitrary URL fetching, hardware networking, or authoritative saved-data writes.
- Use portable repository-relative build paths. Commit Unity source, `.meta` files, project/package locks and licensing records. Ignore `Library/`, `Temp/`, `Logs/`, local user settings and build output. Deliver large generated builds through versioned artifacts, not Git.
- Initial Web build is single-threaded; do not introduce site-wide cross-origin isolation headers without an independently justified and tested requirement.
- Installation and Unity activation are implementation prerequisites, not completed work. No Unity editor/project was found in the standard application locations or this repository during planning; verify other configured locations before installing.

## Review focus

1. Switching robots while commands are pending: stale commands must never affect the next robot.
2. Repeated mode switches and failed loads: no duplicate players, stale listeners or accumulating GPU resources.
3. Browser compression, MIME types, caching and base paths: a successful editor preview is insufficient.
4. Draft/version changes, demo/account transitions and duplicate results: exactly one intended proposal/save, with no cross-account data carryover.
5. Coordinate conversion, imported limits and mirrored transforms: the same pose must mean the same geometry in both renderers.

## Task 1 — Establish a reproducible Unity Web baseline

**Create:** `unity/RobotForgeWorkshop/ProjectSettings/ProjectVersion.txt`, `Packages/manifest.json`, package lock, `.gitignore`, `Assets/Editor/BuildWorkshopWeb.cs`, `docs/unity/build.md`.

- [ ] Inventory installed Unity editors, host architecture, disk availability, activation state and Web Build Support. Use the owner’s existing entitlement; stop at any required account agreement or purchase rather than inventing credentials.
- [ ] Pin Unity 6.3 LTS patch and compatible URP/Test Framework versions in committed project files. Record the tested editor patch and platform.
- [ ] Create one boot scene with a diagnostic object, explicit error surface and a deterministic batch build method `BuildWorkshopWeb.Build()`.
- [ ] Produce a local Web build into a task-specific ignored output folder. Run through HTTP, not `file://`.
- [ ] Pass gate: a real Unity Web player loads in desktop Chrome and Safari, exposes its build/protocol version, and quits cleanly. An editor-only or mocked bridge test does not pass this gate.

## Task 2 — Define the asynchronous Workshop bridge

**Create:** `web-next/src/lib/unityProtocol.ts`, `unityTransport.ts`, `tests/test_unity_protocol.py`, Unity `Assets/Scripts/Bridge/WorkshopBridge.cs`, `Assets/Plugins/WebGL/WorkshopBridge.jslib`.
**Modify:** `web-next/src/lib/humanoid.ts`, `workshopBench.ts`, relevant dispatch sites in `components/chat/ChatDock.tsx`.

**Interfaces:**

- `SceneSnapshot`: `protocolVersion:1`, `sessionId`, `robotId`, `versionId`, `draftRevision`, `assetId`, selection, visibility, explode amount and joint poses. Units are metres, kilograms and radians. Include an evidence/model-capability descriptor.
- `SceneCommand`: same identity fields plus unique `requestId`, allowlisted operation and typed payload. Operations: loadSnapshot, selectLink, setVisibility, setExplode, setJointPose, nextLink, resetView, pauseScene. Later simulation commands negotiate their own advertised capabilities.
- `SceneResult`: identity and requestId plus `status:'applied'|'rejected'|'failed'`, actual resulting state or explicit error. A ready event advertises `protocolVersion`, `buildId` and supported operations.
- `sendUnityCommand(command): Promise<SceneResult>`; ready timeout 30 seconds, command timeout 5 seconds. Timeout never reports success; request a fresh state before retrying an operation with an uncertain result.

- [ ] Write failing tests for malformed messages, unsupported protocol/operation, out-of-range/nonfinite joints, stale robot/version/session, duplicate IDs, duplicate results, timeouts and out-of-order results.
- [ ] Implement validation on both sides. Queue no more than 32 commands while starting; coalesce slider changes by joint and flush at most 15 updates/second. Cancel all pending work on session/robot/version change.
- [ ] Refactor existing synchronous CustomEvent acknowledgments: Wrench awaits the selected renderer's actual result. Retain synchronous adapters for the existing viewer while presenting a shared asynchronous API.
- [ ] React invokes one documented Unity receiver with a serialized JSON string; `.jslib` sends results to a scoped JS callback. Do not evaluate strings as code or grant arbitrary C# method invocation.
- [ ] Pass gate: protocol tests are green, plus one real browser→Unity→React command returns its actual changed state and one rejected stale command changes nothing.

## Task 3 — Add an embedded player with a reliable exit

**Create:** `web-next/src/components/unity/UnityWorkshop.tsx`, `UnityStatus.tsx`, `web-next/src/lib/unityBuild.ts`.
**Modify:** `components/garage/HumanoidWorkshop.tsx`, `components/assembly/AssemblyWorkspace.tsx`, `components/garage/Garage.tsx`, `assets/css/app.css`.

- [ ] Write integration cases for canceled startup, failed loader/data download, rapid renderer changes, unmount during startup, and mismatched build manifests.
- [ ] Load a generated versioned build manifest with loader/data/framework/WASM URLs and expected protocol. Start the player after its canvas exists; show byte/progress status, Retry and Lightweight controls.
- [ ] Give every launch a generation token. If `createUnityInstance` resolves after unmount/cancellation, immediately await `Quit()` on that late instance. Never attach it to a newer session.
- [ ] Capture transient view state before a renderer change; restore the selected robot/draft and supported view state in the next renderer. Pause on hidden page and stop keyboard capture while Wrench or another form has focus.
- [ ] Pass gate: ten launch/quit/fallback cycles leave one live canvas, no duplicate command callbacks and no growing retained-player count; failures leave saved data and accessible controls usable.

## Task 4 — Import the official G1 model faithfully

**Create:** Unity `Assets/Editor/ImportG1.cs`, `Assets/Scripts/Robots/RobotManifest.cs`, `G1Controller.cs`, `LinkSelection.cs`, `Assets/Tests/EditMode/G1ImportTests.cs`.
**Consume:** `assets/models/unitree-g1/g1_23dof.urdf`, its pinned STL files, LICENSE and provenance manifest.

- [ ] Build an editor-only import path for this pinned URDF subset: visual STL geometry/materials, link/joint hierarchy, origin XYZ/RPY, axes, limits and inertial metadata. Reject unsupported constructs explicitly. Do not add an unverified importer dependency solely to bypass this work.
- [ ] Test axis basis conversion: URDF `(x forward,y left,z up)` → Unity `(x right,y up,z forward)` using `C(x,y,z)=(-y,z,x)`; transform rotations with `C R C^-1`, geometry winding/normals consistently, and joint axes/angles consistently. Compare landmark transforms at neutral and bounded test poses against URDF forward kinematics.
- [ ] Preserve all source IDs. Assert 23 actuated joints and every referenced mesh resolves. Bake meshes/prefab at build time; no runtime STL parsing required.
- [ ] Clone/instance materials appropriately for per-link highlighting. Explosion moves visual geometry, never the articulation hierarchy. Pose/reset remains bounded by imported limits.
- [ ] Preserve asset hashes and redistribute the BSD notice in the Unity build’s credits/license surface. Mark derivative/baked output as converted from the pinned source.
- [ ] Pass gate: selection, hiding, explode, reset, pose retention and Wrench actions match the current G1 viewer. A model with missing meshes cannot report fully ready.

## Task 5 — Build the robotics workshop environment

**Create:** `Assets/Scenes/Workshop.unity`, `Assets/Scripts/Workshop/StationController.cs`, `CameraRig.cs`, environment prefab and asset-source/license manifest.

- [ ] Compose a workbench, two trays, tool wall, storage and a visible test area. Keep robot geometry and IDs independent of scenery.
- [ ] Use Blender for original environment assets where useful; export FBX for Unity with explicit metre scale/orientation settings. Retain editable source separately from optimized runtime assets. Start with blockout geometry to prove interaction before art production.
- [ ] Provide orbit, zoom, camera reset and optional station framing. Parts tray opens Build tools, wiring station opens Wiring, test station opens Test through typed UI requests. No scene location is required to access a feature.
- [ ] Use baked/static lighting, restrained shadows and no required post-processing. Include a low-quality profile and reduced-motion camera transitions. Keep Wrench as the existing readable React composer.
- [ ] Pass gate: all station actions have keyboard/DOM equivalents, room controls never steal chat typing, and phone controls remain usable without mandatory pointer lock or fullscreen.

## Task 6 — Add the rover test area, then measured physics

**Create:** `Assets/Scripts/Simulation/RoverController.cs`, `TestScenario.cs`, `RunRecorder.cs`, `Assets/Tests/PlayMode/RoverScenarioTests.cs`.
**Modify:** `web-next/src/components/simulation/SimulationWorkspace.tsx`, `web-next/src/lib/simulation.ts`.

- [ ] Port one supported differential/skid-steer rover's declared geometry/mass to an explicitly simplified Unity model; unsupported robots remain inspect-only. Preserve one spec snapshot and fingerprint per run.
- [ ] Add flat ground, ramp, obstacle and a timed gate course, with keyboard/touch controls, pause and reset. Record timestamped poses, gate sequence, elapsed time and scenario settings.
- [ ] Emit `engine:'Unity'` and model/build version in saved results. React validates results and performs any save through the existing review/store path. Do not label Unity results as Rapier, Gazebo or hardware measurements.
- [ ] Validate units, stable standing/reset behavior, bounded speed, collision behavior, gate order and interrupted runs with deterministic test scenarios. Define tolerances from actual test results; do not demand numerical equality with Rapier.
- [ ] Pass gate: a browser-driven rover completes and saves one course with a reproducible receipt. G1 cannot invoke rover physics or receive a passing gait verdict.

## Task 7 — Package and verify static hosting

**Create:** `web-next/scripts/stage-unity.mjs`, `tests/test_unity_build_manifest.py`, build artifact manifest.
**Modify:** `web-next/package.json`, `web-next/vercel.json`; preserve current redirects.

- [ ] Stage one locally built versioned artifact under `public/unity/<buildId>/`, including licenses. Verify hashes, relative URLs, and maximum artifact sizes before web export. Do not require Unity Editor on every ordinary Next.js build.
- [ ] Use immutable caching for content-addressed build files, short caching for the current-build manifest. Test a rollback by selecting the previous manifest without editing saved robots.
- [ ] Use Brotli with correct `Content-Encoding: br`; serve `.wasm.br` as `application/wasm` and `.js.br` as `application/javascript`. Test actual HTTP headers and byte decoding; avoid double compression. Use an uncompressed local development profile when the local server cannot provide these headers.
- [ ] Pass gate: the production-style HTTP preview loads Unity in Chrome/Safari, refresh/deep links work, cache updates select the intended build, and the existing web app/auth flows still work.
- [ ] A deployed preview is a later authorized action. Do not modify Cloudflare Worker deployment or secrets for this work.

## Task 8 — Acceptance, performance and rollout readiness

**Create:** `docs/unity/verification.md`; extend relevant Workshop/G1/bridge tests and PlayMode tests.

- [ ] Test the full flow: choose robot → open immersive view → select link → ask Wrench → pose → switch robot/version → reset → lightweight → immersive → save/version check. Repeat in demo and regular local storage without crossing namespaces.
- [ ] Validate malformed/replayed command results, storage failure, WebGL loss, failed asset downloads, hidden tab, focus transfer, and interrupted startup. Browser/model service calls are not needed for deterministic command tests.
- [ ] Verify current desktop Chrome, Safari, Firefox and Edge; iOS Safari and Android Chrome on named real devices. Browser emulation proves layout only.
- [ ] Proposed budgets: shell usable before Unity loads; first interactive immersive view <=12 seconds at a measured 25 Mbps with cold cache; initial compressed Unity payload <=30 MB; additional robots load on demand; >=45 fps on the recorded desktop and >=30 fps on the recorded phone. Record device, browser, transfer bytes and profiler evidence. These are targets, not achieved claims.
- [ ] If targets fail, simplify art/meshes/lighting and keep Lightweight available; do not make Unity mandatory to claim completion.
- [ ] Run focused Python/TypeScript tests, Unity EditMode/PlayMode tests, Next.js production export and real-browser checks. Report PASS, FAIL, SKIP separately; disclose the known pre-existing legacy-image export test failure if still present.
- [ ] Produce screenshots, a versioned Web artifact, source/license inventory, rollback instructions and remaining limitations for review. No push to shared branches or publication without the required owner authorization.

## Later milestone: humanoid movement

After inspection and rover physics are stable, add G1 movements in two explicitly separate stages: authored animations (wave/crouch/walk visual preview), then a source-backed gait controller with a physics model and documented success/failure tests. Animation playback remains labeled animation. Balance, contact and gait validation require their own acceptance evidence; Unity installation alone does not supply them. Native desktop and XR builds are future targets, not prerequisites for the browser integration.

## Why this approach

An embedded Unity player preserves the web app’s existing saved data and avoids another destination. A full Unity rewrite would duplicate the account/editor/chat work. A separate native Unity app would add installation and cross-app synchronization before proving the workshop experience. Either can be revisited if browser budgets prove unattainable.

## Official references checked during planning

- Unity 6.3 browser compatibility (desktop and selected mobile browsers): https://docs.unity.com/en-us/engine/6000.3/manual/platform-specific/webgl/intro/browsercompatibility
- Unity Web deployment, native decompression and WASM MIME requirements (6.0 reference; recheck against pinned 6.3 patch during implementation): https://docs.unity.com/en-us/engine/6000.0/manual/platform-specific/webgl/building-distribution/deploying

This planning task changed documentation only. No Unity installation, project scaffolding, build, deployment or hardware test was performed.
