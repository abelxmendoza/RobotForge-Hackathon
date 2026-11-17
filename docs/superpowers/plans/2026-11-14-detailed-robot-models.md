# Detailed Robot Models Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans; review the complete change before completion.

**Goal:** Make the stock TurtleBot3 Burger recognizable and inspectable using manufacturer geometry, and let users bring any stock Robodex robot into Workshop.

**Architecture:** Use pinned, attributed manufacturer geometry at original metric transforms. A shared component manifest drives picking, materials, exploded placement and reversible visual assembly. Reuse existing Workshop context, bench commands, and saved-robot/version stores. Keep physics independent from visual meshes.

**Tech Stack:** Next.js, React, Three.js, original STL assets and documented asset processing.

**Spec:** Approved conversation design: manufacturer models plus authored detail, Burger first, then remaining stock robots.

## Global constraints
- Preserve unrelated local backup and saved data; work on a feature branch.
- Do not deploy the live Worker or publish/merge without a fresh request.
- Do not imply a fused source mesh contains separately verified mechanical parts. Record segmentation and inferred details explicitly.
- Choose stock Burger revision from existing pinned ROBOTIS model; do not substitute generic rover electronics.
- Never run downloaded repository code or silently install unknown CAD/import dependencies.

## Review focus
- Similar names or modified dimensions must not silently select an inaccurate reference model.
- Missing assets must produce a clear fallback without a partial model being presented as complete.
- Repeated add-from-Robodex must preserve existing versions and drafts.
- Assembly/undo/reset must restore exact transforms and work through Wrench.
- Phone picking, inspector and canvas must remain usable without horizontal overflow.

## Task 1: Manufacturer geometry and component manifest
- [x] Inspect pinned official Burger STL/URDF and available separate CAD; retain attribution, hashes and source units.
- [x] Test manifest identities, bounds, safe asset paths, source tags and assembly sequence.
- [x] Build a detailed component scene with source geometry and reversible part state; verify geometry scale against manufacturer dimensions.
- [x] Integrate into Workshop and Robodex rendering, leaving custom generated robots on their own geometry.

## Task 2: Bring a robot in from Robodex
- [x] Test copying recorded specs, model identity, no record mutation, and duplicate selection.
- [x] Add a searchable Robodex chooser inside the existing dialog. Reuse canonical specs and source metadata.
- [x] Verify selecting Burger opens detailed view and other catalogue entries retain supported views.

## Task 3: Wrench and assembly integration
- [x] Route existing bench commands to detailed component identities; support select/explain, remove/restore, assembly/disassembly, undo/reset.
- [x] Label illustrative sequence separately from manufacturer service instructions; keep source references available on demand.
- [x] Browser-check real local assets, picking, reversible assembly and mobile inspector; build and run relevant tests.

## Follow-on: Wrench identify and research
User requested robot identification from names/photos/URLs, online fallback for unknown robots, and collection of open specifications, documentation, source repositories, URDF/MJCF, CAD, meshes and assembly resources. Build after the Burger quality benchmark: search official sources first; keep multiple candidates when identification is uncertain; store evidence URLs, retrieval dates, revisions and per-asset reuse terms. Show missing/private/gated data explicitly. Never promise recognition of every robot or complete recovery of all data. Existing live search/import facilities must be audited before adding endpoints; Worker deployment remains separate authorization.

## Follow-on rollout
Waffle Pi; Andino/Pathfinder/X500/Crazyflie; Mini Pupper/Go2/OpenManipulator; OP3/G1/Asimov. Each gets a source/asset audit and the same review gate.

## Implementation evidence (2026-11-16)

Burger uses the four pinned original STL meshes, 254 base geometry shells in20 annotated inspection groups. Connected-shell geometry provided enough detail for this first slice without inventing Blender geometry. Exact fastener/cable service modelling and Unity parity remain later work.

The shared Robodex picker is embedded in Bring a robot in, including sightings and existing-project opening. Source intake preserves existing versions and marks catalogue copies as planned references.

Wrench supports select/remove/restore of detailed components plus existing guided bench commands. Full browser disassembly and assembly each completed20 steps; remove/restore lidar succeeded through Wrench. Phone layout at390x844 had no horizontal overflow.

Named robot research now issues up to three searches through the existing live web route and saves source receipts locally. Links are classified as documentation, repositories, robot descriptions or CAD/model candidates. Identity, licenses and downloaded assets remain unverified until separately checked. Automated tests used a fake search function; live search and Kaedim generation were not exercised. Universal photo identification and automatic CAD ingestion are not complete.

Validation: full suite1,108 passed,7 skipped; latest focused tests13 passed; TypeScript and production export passed. Reviewer dispatch was unavailable due to the service usage limit; do not claim independent review completed.
