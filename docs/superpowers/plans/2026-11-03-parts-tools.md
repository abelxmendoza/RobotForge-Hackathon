# My Parts and Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A category-first illustrated library with saved parts/tools, catalogue discovery and Wrench-driven saves, relationships and custom CAD.
**Architecture:** Project existing inventory and web records into one library; optional inventory fields preserve old data. Pure command/merge helpers handle saves; main Wrench owns commands and CAD. New read-only library UI replaces the legacy form surface.
**Tech Stack:** Existing Next.js/React, local stores, bundled artwork, OpenSCAD templates.
**Spec:** docs/superpowers/specs/2026-11-03-parts-tools-design.md

## Global Constraints
- All fourteen category cards have illustrations.
- No Worker deployment or secret mutation.
- Wishlist/planned designs never count as owned stock.
- No inferred association becomes installed without explicit input.
- No silent duplicates or stale proposal overwrites.

## Review Focus
- Legacy records retain counts and photo/parent metadata.
- Duplicate names refuse ambiguous commands.
- Archived robots do not get new assignments.
- Web saves remain wishlist and preserve provenance.
- CAD regeneration preserves versions without marking owned.

### Task 1: Library model and command semantics
Files: lib/partsLibrary.ts, lib/inventory.ts, tests/test_parts_library.py.
- [x] Write/run failing Node-driven tests for category mapping, merged records, ownership and exact robot suggestions, save/update command guards.
- [x] Implement pure projection, source conversion, command parser and immutable updates; test legacy and duplicate behavior.

### Task 2: Illustrated category and item UI
Files: components/inventory/PartsLibrary.tsx, app/inventory/page.tsx, assets/css/app.css, lib/partArt.ts, shell/nav labels.
- [x] Build all category cards, category drilldown, saved/catalogue search, ownership filters and read-only details.
- [x] Add Wrench prompts for save, photo intake, robot links, modifications, discovery and CAD.
- [x] Preserve export, nested components and source/CAD access; ensure responsive layout and keyboard dismissal.

### Task 3: Wrench integration
Files: chat/ChatDock.tsx, ChatBar.tsx, AttachButton.tsx, lib/demoMode.ts.
- [x] Route library save/status/association commands with stale-safe confirmation, supported in demo without network.
- [x] Save generated CAD into the library with design history and retain existing download.
- [x] Keep web records visible; pass part-photo intent through Wrench attachment handoff.

### Task 4: Verification and preservation
- [x] Run focused tests, TypeScript, full suite and production build.
- [x] Browser-check category imagery, drilldown, catalogue wishlist save, explicit owned state and robot association.
- [x] Independent review, fix findings; commit/push branch and resolve related PR if ready under existing authorization.

## Verification ledger
- Implemented inline under the user’s “lets do it” authorization.
- Browser demo: category drilldown, catalogue wishlist save, owned quantity, planned robot link, CAD saved as Custom wishlist, export attachment preview and confirmed import.
- Review fixes: snapshot Garage on confirmation; propagate parent associations; preserve import/nesting/archive via Wrench; exclude archived/wishlist records from BOM stock; preserve legacy section defaults.
- Ruling: inferred robot matching suggests exact BOM IDs only; broader fit is unknown. CAD remains four parametric OpenSCAD templates, without an arbitrary rendered preview.
- Ruling: archive is reversible and retains backup data; exported photos are thumbnails. Import adds missing IDs and does not overwrite existing records.
