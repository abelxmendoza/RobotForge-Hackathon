# Unified Workshop implementation record

Branch: `codex/unified-workshop`. Owner approved proceeding with the proposal on 2026-11-11.

## Delivered locally

- Five primary tabs: Overview, Build, Wiring, Test, History. Existing BOM/tools/drivetrain/simulation hash destinations still open their original panels under the correct parent tab.
- Design entry inside Build opens the existing Wrench composer. Shared `workshopDesign.ts` owns catalogue-backed concept generation. Removed the redundant design-mode button beside Create.
- Wrench concept modifications now offer Apply new version / Cancel. Apply requires the target to remain selected, its baseline to match, and its draft to remain clean. Regeneration also refuses an unsaved draft.
- The Build renderer receives the current Workshop spec draft instead of silently rendering an older saved spec. Added component poses continue to use the saved assembly and remain explicitly separate.
- Original procedural workshop scenery: work surface, frame, pegboard, tools, drawers, and trays. Removed part groups move onto the trays during guided practice. This is implemented in Three.js; no Blender-generated assets or Unity runtime were added.
- Shared view-only assembly controller for buttons and Wrench: start, next, back, reset, hint, explain selected part. Practice state is restored only for the matching robot/version/spec identity and uses an isolated demo store. Suggested part-group order is illustrative, not verified physical assembly instructions.
- Auto-build pauses when the document is hidden. Visibility-filtered picking prevents hidden parts from intercepting selection. A camera reset, environment toggle, and lightweight mode are available.
- Contextual part cards, group visibility, concept-part explanations and a local quiz. Quiz progress lasts for the current component session; it does not represent hardware completion.
- Overview comparison drawer uses active robots and latest saved numerical fields; unknown values remain “Not recorded.”
- Existing Rapier driving, ramp/obstacle scenarios and saved simulation runs are now inside Test → Proving ground. This is reuse and integration of the existing simulation, not a new locomotion engine.
- Phone demo-bar wrapping fixed after responsive inspection revealed it obscured the app.

## Verification evidence

- New pure behavior tests were observed failing before the controller, design service, proposal guard, and visibility helper were introduced; then passed.
- Focused integration/regression suite: 87 PASS before the final visibility regression was added; the new unified suite subsequently passed all 3 tests.
- Production static-export build and TypeScript check passed during implementation; final verification results are recorded below after the last changes.
- Browser checks in an isolated local demo: five-tab navigation; Build environment rendering; start guided practice; Wrench “next assembly step” advances progress; reload resumes the same step; Test → Proving ground loads; a held forward control moves the estimated rover, pause works, and saving reports “Saved to Test.”
- Inspected desktop and 390 × 844 phone layouts. This was layout verification, not a device performance benchmark. Screenshot: `/private/tmp/robotforge-workshop-preview.jpg` (local session artifact, not a repository asset).
- Independent review found and led to fixes for draft loss after selection changes, invisible-part picking, hidden-page autoplay, and comparison self-selection/archive filtering.

## Remaining scope from the broader RoboLabs reference

- Finished Blender-authored room art and optimized GLB export pipeline.
- Curated, licensed, individually segmented models for a larger robot fleet. Existing scans remain view-only; no internals are invented from a monolithic mesh.
- Verified manufacturer assembly dependencies, fasteners, and per-instance instructions. Current practice operates on schematic part groups.
- Humanoid/quadruped locomotion controllers, physical gait validation, and robot-specific actions. Rover controls do not implement walking/jumping.
- Timed multi-gate course scoring and richer scenario authoring; current existing scenarios provide flat ground, ramp and obstacle driving.
- Target-device performance measurements and a scene asset/triangle budget audit.

No deployment, Worker changes, secret/rate-limit changes, shared-branch push, or hardware tests were performed.

## Final verification

- Focused regression suite: **88 PASS, 0 FAIL, 0 SKIP**.
- TypeScript: **PASS**.
- Final production static-export build: **PASS**.
- Full repository suite: **1018 PASS, 1 FAIL, 6 SKIP** on the last full run (before adding the final visibility-only regression). The one failure is `tests/test_web_next_links.py::test_exported_links_resolve_when_export_present`: pre-existing legacy HTML references unavailable optional part JPGs. Confirmed the missing-image reference exists at the branch baseline and its asset is not tracked. No image was fabricated and the failure was not suppressed.
- `git diff --check`: **PASS**.
- Generated TypeScript incremental-build cache restored to its original tracked contents; no unrelated generated-file changes retained.
