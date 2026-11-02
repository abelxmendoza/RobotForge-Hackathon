# Recoverable Robot CRUD — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace destructive robot removal with a small, reversible Archive/Restore flow while preserving existing browser data and excluding archived robots from active Workshop behavior.

**Architecture:** Add pure lifecycle functions with snapshot conflict checks, then make `Garage` derive active and archived lists from the unchanged `rf.garage.v1` array. Archive and restore always re-read the store before applying, so a stale confirmation cannot overwrite a newer record. Permanent deletion, inventory lifecycle, and cross-key transaction journaling remain separate follow-up phases.

**Tech Stack:** TypeScript, React 19, Next.js static export, Python-driven Node unit tests, pytest.

**Spec:** `docs/superpowers/specs/2026-11-01-crud-lifecycle-design.md`

## Global Constraints

- Keep `rf.garage.v1` backward compatible; absence of `archivedAt` means active.
- Archive and restore may change only `archivedAt`.
- Mutations re-read storage and reject a changed or missing target.
- Permanent deletion must not appear in the active Workshop and is not part of this phase.
- Archived robots must be excluded from active selection and ordinary editing.
- Do not add dependencies or direct `localStorage` access to components.

## Review Focus

- Legacy records without `archivedAt` remain active — covered by Task 1 selectors.
- Invalid archive timestamps are treated as active instead of hiding data — covered by Task 1 selectors.
- A stale confirmation cannot overwrite a newer robot — covered by Task 1 conflict tests and Task 2 fresh reads.
- Archiving the selected robot selects the next active robot or the add state — covered by Task 2 interaction assertions.
- Restoring preserves versions, repos, photos, scans, and identity — covered by Task 1 deep-equality tests.

---

### Task 1: Pure lifecycle operations

**Files:**
- Create: `web-next/src/lib/lifecycle.ts`
- Modify: `web-next/src/lib/garage.ts`
- Test: `tests/test_crud_lifecycle.py`

**Interfaces:**
- Consumes: records with `id: string` and optional `archivedAt?: string`.
- Produces: `activeRecords<T>()`, `archivedRecords<T>()`, `recordSnapshot()`, `archiveRecord<T>()`, `restoreRecord<T>()`, and `LifecycleConflictError`.

- [ ] **Step 1: Write the failing Node-backed lifecycle test**

Assert that legacy and invalid-timestamp records are active; valid timestamps are archived; archive and restore preserve every other nested field; missing IDs and stale snapshots throw `LifecycleConflictError` without changing the input.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `.venv/bin/pytest tests/test_crud_lifecycle.py -q`
Expected: FAIL because `web-next/src/lib/lifecycle.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure lifecycle module**

Use immutable array/object copies. Validate archived timestamps with a strict ISO round-trip check. Compare the current record with the caller's `recordSnapshot(record)` immediately before mutation.

- [ ] **Step 4: Add `archivedAt?: string` to `GarageRobot` and verify GREEN**

Run: `.venv/bin/pytest tests/test_crud_lifecycle.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add pure robot lifecycle operations`

### Task 2: Workshop Archive and Restore UI

**Files:**
- Modify: `web-next/src/components/garage/Garage.tsx`
- Replace: `tests/test_garage_remove_confirm.py`

**Interfaces:**
- Consumes: Task 1 lifecycle selectors and operations plus `readStore`/`saveRobots`.
- Produces: active robot navigation, an `Archived robots (N)` disclosure, archive confirmation, and restore actions.

- [ ] **Step 1: Replace the permanent-remove source assertions with failing archive/restore assertions**

Assert the first Archive click only arms confirmation, the confirmed action re-reads `GARAGE_KEY` and calls `archiveRecord`, switching robots clears confirmation, active navigation uses `activeRecords`, and the archived section calls `restoreRecord` from a fresh read.

- [ ] **Step 2: Run the focused interaction assertions and verify RED**

Run: `.venv/bin/pytest tests/test_garage_remove_confirm.py -q`
Expected: FAIL because the Workshop still exposes permanent Remove.

- [ ] **Step 3: Implement the minimal Workshop UI**

Derive `active` and `archived` once per render. Replace Remove with Archive and concise confirmation copy. Render a collapsed archived list with robot name, version count, archived date, and Restore. Keep archived records out of the editable main panel.

- [ ] **Step 4: Verify focused behavior and related Workshop tests**

Run: `.venv/bin/pytest tests/test_garage_remove_confirm.py tests/test_bring_robot_in.py tests/test_robot_multi_repo.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: make robot removal recoverable`

### Task 3: Exclude archived robots from mutation entry points

**Files:**
- Modify: `web-next/src/components/chat/ChatDock.tsx`
- Modify: `web-next/src/components/chat/InventoryProposal.tsx`
- Modify: `web-next/src/components/assembly/AssemblyWorkspace.tsx`
- Modify: `web-next/src/components/inventory/PartPhotoIntake.tsx`
- Test: `tests/test_crud_active_filters.py`

**Interfaces:**
- Consumes: `activeRecords()` from Task 1.
- Produces: active-only robot name resolution and selectors; archived robot assignments remain stored and visible as historical references.

- [ ] **Step 1: Add failing assertions for each active mutation/selector boundary**

Assert each boundary filters the freshly read or subscribed Garage array through `activeRecords` before resolving a robot.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `.venv/bin/pytest tests/test_crud_active_filters.py -q`
Expected: FAIL on unfiltered entry points.

- [ ] **Step 3: Add the smallest active filters**

Do not change storage or erase archived assignments; filter only the lists supplied to active mutation and selection behavior.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `.venv/bin/pytest tests/test_crud_active_filters.py tests/test_chat_tier1_eval.py tests/test_parts_tree.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `fix: exclude archived robots from active operations`

### Task 4: Release verification

**Files:**
- Modify only if verification exposes a regression.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a reviewable branch with test and build evidence.

- [ ] **Step 1: Run the full suite except the environment's optional RealSense dependency test**

Run: `.venv/bin/pytest -q --ignore=tests/test_realsense_scan.py`
Expected: all collected tests pass.

- [ ] **Step 2: Run the production build outside the restricted sandbox**

Run: `cd web-next && NEXT_TELEMETRY_DISABLED=1 npm run build`
Expected: 27 static pages generated.

- [ ] **Step 3: Review the branch diff against `origin/main`**

Confirm the diff contains the approved design/plan and Phase 1 lifecycle changes only.

