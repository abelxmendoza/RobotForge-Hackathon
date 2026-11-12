# Rover Design and Build Implementation Plan

> Execute inline with task-level checks and a final independent review.

**Goal:** Deliver describe → parts → assembly → CAD → coherent build ZIP for planned rovers.
**Architecture:** A client-side /design/ workspace uses Forge Engine and versioned Garage records. Pure adapters reconcile selected roles, individual assembly instances and CAD; the existing workbench edits the same snapshots. ZIP files are derived from one saved revision.
**Tech Stack:** Next.js/React/TypeScript, Three.js, OpenSCAD text, fflate ZIP, Python/Node regression tests.
**Spec:** ../specs/2026-11-10-rover-design-build-design.md (approved by user: yes do it).

## Global constraints
No cloud Worker changes, paid services, deployment or main push. Preserve existing uncommitted Wrench fixes. No invented mounting holes or ratings. Generated robots remain PLANNED; dimensions/default envelopes and unsupported simulation effects remain explicit. Export only actual CAD; no descriptive print-plan strings as SCAD. Save only explicitly and append versions; reject stale saves/exports. Archived robots stay archived.

## Review focus
- Component swap must preserve motor/wheel counts and clear missing replacement ratings.
- Add/remove and repeated instances must agree with the effective BOM; unmatched roles block export.
- Stale editor versions and invalid dimensions must never overwrite newer work.
- ZIP filenames and scalar requirements must be validated; exports reference one saved snapshot.
- Oversized chassis requires redesign/larger bed; no fabricated tile joints or hole positions.

### Task 1: Catalogue geometry and coherent design adapter
- [x] Add failing tests in tests/test_rover_design.py for preview, swap counts/ratings, individual instance seeding, reconciliation, stale save, duplicate names and immutable history.
- [x] Add catalogue envelope fallback definitions to components.ts without changing existing curated identities; use no mounting holes for catalogue proxies.
- [x] Implement lib/roverDesign.ts: requirements, concept preview, role choices/swap, assembly seeding/reconciliation, exact-version save helpers.
- [x] Integrate reconciliation for design-managed snapshots in assembly.ts; preserve old robot behavior.
- [x] Verify focused design and existing assembly tests.

### Task 2: CAD and build package
- [x] Add failing tests for valid ZIP contents, safe filenames, correct revision identity, missing roles, invalid sizes and stale CAD.
- [x] Add fflate and implement lib/roverPackage.ts: chassis/mount/enclosure OpenSCAD, equivalent chassis STL, BOM/assembly/wiring/spec/findings/README/manifest ZIP.
- [x] Verify ZIP roundtrip and geometry bounds with synthetic fixtures.

### Task 3: Guided UI and navigation
- [x] Implement components/design/RoverDesigner.tsx and CSS module, /design/page.tsx with existing app gate.
- [x] Offer requirements + draft 3D preview, category-grounded part replacements, explicit save/reload, embedded existing assembly workbench, custom CAD controls, single-package export.
- [x] Link from AppShell, Garage and deterministic Wrench navigation; existing creation controls point to this workflow without losing their capabilities.
- [x] Run production build and focused regressions; exercise generation, cancellation, save, assembly edit, CAD save, reload and ZIP download in browser demo.

### Task 4: Review and delivery
- [x] Run repository suite and independent review; fix significant findings, report unrelated failures separately.
- [x] Record software/synthetic checks distinctly from real robot validation; no push/deploy without request.

## Execution ledger
- Approved scope: rover workflow, starting from scratch, planned existing rovers supported.
- Reusing current checkout on codex/rover-design-build preserves uncommitted Wrench work without staging it.

- Core review: corrected checks to use actual instance poses/power paths; reviewed corrections approved.
- UI/export review: corrected CAD data loss, hidden mount errors, draft/deep-link recovery, managed rendering defaults and demo context isolation; reviewed corrections approved.
- Focused final checks: 24 PASS, 0 FAIL, 0 SKIP; production build PASS.
- Browser demo trial: created planned rover, changed motors, moved IMU, edited chassis/mount holes and enclosure, recovered dirty deep-link draft, preserved CAD across ordinary save, downloaded 18-file ZIP. Parsed actual download: matching version, motor quantity, IMU pose and CAD settings PASS. Synthetic software trial only.
- Final repository suite: 1,027 PASS, 2 FAIL, 6 SKIP. The two failures are the previously observed Worker mock output assertion and legacy static catalogue image links. The new navigation expectation was updated for the approved Design entry.
- All work remains on codex/rover-design-build; prior Wrench changes preserved; no push/deployment.
