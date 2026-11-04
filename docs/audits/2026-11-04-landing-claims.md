# Landing claim verification — 2026-11-04

Verdict: partially demonstrated; not ready to claim the whole describe → build → program → verify workflow works end to end.

Scope: checkout 3bb0e6e27390e6ab2539eef9c05f2b7a611384d8 plus the five existing uncommitted demo changes. No product code changed in this audit. No deploy, secret changes, sign-in, real account writes, or purchases.

## Evidence collected

- Full Python/Node-backed suite: **852 passed, 5 skipped in 37.12 seconds**. Several suites exercise static contracts or mocked providers, so this does not establish live model quality or browser physics correctness.
- TypeScript: `tsc --noEmit --incremental false` passed. Fresh production `npm run build` passed (29 static pages).
- Browser: built static export served on a separate test origin, `http://127.0.0.1:8766`. The user's original 8765 service was left alone; its root returned `Unknown path`. Do not use 8766 for the web server when testing the native simulator companion: the companion itself defaults to 8766.
- Anonymous Run the Demo opened Workshop with Burger and Waffle Pi, labelled as sample data. RoboDex My robots showed both. A temporary navigation failure occurred when opening RoboDex; a reload succeeded. Cause not isolated; do not call it a confirmed deployed bug.
- Wrench request `Add a Raspberry Pi 5 to this rover`: generated a single power/wiring/mount proposal. Approval created Burger version 2, PLANNED. Wiring tab showed the two proposed power connections. Persistence across navigation was observed.
- Wrench request `Make a mounting plate 100 by 80 mm, 3 mm thick`: produced OpenSCAD source and saved a custom wishlist design. File was not rendered, sliced, printed, or physically fitted.
- Browser Simulate: Run enabled Pause and drive controls, but no valid samples could be saved. Browser console recorded `RuntimeError: memory access out of bounds`, at Rapier `jointConfigureMotorVelocity` / `configureMotorVelocity`, called by `drivePhysics.step`. Save run remained disabled. This is a confirmed failure for this browser run; root cause not yet isolated.
- Fresh native Gazebo baseline: `PYTHONPATH=src python -m robotforge.cli run-gate examples/turtlebot3-burger.json --workdir /tmp/robotforge-claim-audit-gate --in-process`. Gazebo 8.15.0, gz-transport13. PASS: drive error 1.543%, turn error 1.529°, odometry distance 0.042%, odometry heading 4.004°. This is a simulated baseline test, not a hardware test or a test of the approved Pi upgrade.
- Live `/health`: configured=true, kv=true, auth=true, provider flags present. Anonymous `/describe` returned auth_required, as intended. No signed-in live text/photo/list/transcription/fix flow was exercised.
- Public landing GET returned 200. Its Run the Demo links still target `/demo/`, while the local updated version targets `/garage/`. Local demo fixes are not deployed.

## Claim matrix

| Landing claim | Verdict | Evidence / limit |
|---|---|---|
| Demo needs no account and contains sample data | Demonstrated locally | Entered without auth; both TurtleBots appeared in Workshop and My robots. Public entry still differs. Isolation also covered by seed tests. |
| Words/photo/parts become engineering specs | Partial | Code and tests exist; recorded samples and local CAD work. Actual signed-in AI input/output not exercised in this audit. |
| AI proposes; user approves | Demonstrated for Pi upgrade | One proposal, explicit approval, one new planned version; wiring persisted. Not a proof of every action path. |
| Generate printable mounts and enclosures | Partial | Parametric SCAD plate and Pi-specific mount/open-frame enclosure exist. No general enclosed harness-box template in cadGen (only plate, bracket, wheel disc, spacer). No OpenSCAD render/mesh or print/fit proof in this audit. |
| Power math checked; buck added when required | Partial / overstated | Pi proposal selects a generic 5 V/5 A converter and does arithmetic. It uses typical battery chemistry ranges and an assumed ±5% load window, lacks exact converter minimum input/derating and USB-C PD qualification, yet some related checks are PASS. It cannot establish safe energization. |
| Checks every change and tests the changed twin | Not established | applyUpgrade appends planned connection rows and upgrade metadata, but does not change mass_kg or add physical assembly instances. UI still shows 0.93 kg after reporting about 83 g added. Simulation therefore does not represent the full upgrade. |
| Browser robot simulation | Failed in tested flow | Rapier WASM memory error on motor update; no saved valid run. |
| Gazebo driving test | Demonstrated for baseline via CLI | Fresh Burger PASS. Requires native installation/local companion; not automatic hosted execution for every edit. Browser → companion → result flow not tested here. |
| Program it before hardware exists | Unsupported as an integrated workflow | No in-app controller-code editing/execution route found. Build plan has a load-firmware checklist and imported repo links. Those do not demonstrate programming arbitrary robot software in simulation. External-editor integration could satisfy this goal later without adding an editor. |
| PASS/FAIL badges come from recorded runs | Supported by records, copy needs correction | Andino overall FAIL is from odometry heading 11.624°, while landing attributes it to turn error 9.104°; 9.104° is MARGINAL under the stated thresholds. |
| 3D model is a realistic measured twin | Not promised by current viewer labels | Viewer correctly says approximate/concept geometry; simulation fallback was a labelled box proxy. Do not present it as a calibrated or photorealistic twin. |

## Submission priorities

1. Repair the browser motor-update crash and verify Run → drive/turn → pause → save → replay in the actual recording browser, including reset and robot/version changes.
2. Make approved upgrade versions update a single physical source of truth: assembly instances, mass/center of mass, wiring, BOM, CAD artifact metadata. Invalidate stale gate/check evidence. Verify the simulator uses the new version.
3. Require explicit electrical facts or mark them unknown: exact battery operating limits, exact converter SKU/datasheet and continuous current/thermal limits, actual Pi input/interface requirements. A generic candidate and assumption must not produce a safety-sounding pass.
4. Qualify the founder paragraph around generated plans, provisional checks and native Gazebo setup; remove integrated-programming wording until a controller-code run is demonstrated. Correct the Andino failure explanation.
5. Test signed-in live text, photo, parts-list and fix flows on the public site; health flags alone do not prove these flows. Confirm real sign-in and saved account data without exposing credentials.
6. Render generated SCAD, validate mesh dimensions, and label physical fit unverified until measured/printed. Then commit/push the existing frontend demo fixes and check the public entry before recording. Keep the live Worker frozen.

## Reproduction

Open landing → Run the Demo → Build → Wrench: Add a Raspberry Pi 5 to this rover → Approve and save → Wiring → Simulate → Run. Inspect console for the Rapier exception and observe Save run disabled. Compare Overview mass before and after approval (both 0.93 kg).

Screenshots captured at `/tmp/robotforge-audit-simulation.png` and `/tmp/robotforge-audit-demo-robots.png`. Fresh Gazebo report is `/tmp/robotforge-claim-audit-gate/gate-report.json`. Temporary demo data was created only on the separate test origin; real accounts were not changed.
