# RobotForge CRUD Lifecycle Design

## Intent

RobotForge should make ordinary removal reversible and permanent deletion
complete, explicit, and internally consistent. Robots and inventory records are
valuable user data stored only in the browser; an accidental click or a partial
multi-store write must not silently lose or orphan that data.

The selected approach is a two-stage lifecycle for both robots and inventory:
archive first, then restore or permanently delete from an Archived view. No
record expires automatically.

## Current state

- Garage robots are arrays in `rf.garage.v1`; each robot contains immutable spec
  versions. PR #101 added a two-click permanent removal confirmation.
- Assembly versions live separately in `rf.assemblies.v1`, keyed by robot ID.
- Inventory records live in `rf.inventory.v1`; an optional `robot_id` records an
  assignment. Full-size inventory photos live separately in IndexedDB while a
  thumbnail and `photo_asset_id` live in the inventory record.
- Generic `readStore`, `writeStore`, and `useStore` calls are spread across the
  Workshop, Wrench, import, demo, inventory, and assembly paths. Some mutations
  use a fresh store read and some write from captured React state.
- Removing a robot currently leaves assembly data and inventory assignments
  behind. Removing an inventory record currently has no confirmation and does
  not remove its IndexedDB photo.

## Goals

- Make Archive the normal removal action for robots and inventory.
- Let users restore archived records without losing relationships or history.
- Make permanent deletion available only from an Archived view.
- Show the complete effect of permanent deletion before confirmation.
- Clean up owned data and preserve data that belongs to another entity.
- Prevent stale or partial mutations from being announced as successful.
- Give every UI and Wrench entry point one deterministic domain-operation layer.
- Preserve existing browser data through backward-compatible normalization.
- Add behavioral tests for lifecycle transitions, stale writes, relationship
  cleanup, storage failure, and photo cleanup.

## Non-goals

- Cloud sync or moving browser data into the account store.
- Automatic retention periods or automatic trash emptying.
- Deleting immutable versions individually or rewriting version history.
- Treating an inventory assignment as installation or stock consumption.
- Adding RAG, embeddings, or a vector database.
- Allowing a model to mutate storage directly.

## Anti-goals

- Do not label a partial cascade as a successful deletion.
- Do not delete inventory merely because its assigned robot is deleted.
- Do not delete global build-list or wiring data as if it belonged to one robot.
- Do not hide duplicate imports, storage conflicts, or cleanup failures.
- Do not make permanent deletion equally prominent with reversible Archive.

## Approaches considered

### Selected: two-stage lifecycle

Active screens expose Archive. Separate Archived sections expose Restore and
Permanently delete. This matches RobotForge's append-only history model and
keeps the destructive action out of the ordinary workflow.

### Rejected: one dialog with Archive and Delete

This is smaller, but it repeatedly places permanent deletion beside the common
action and does not provide a natural place to review or restore old records.

### Deferred: unified Trash

A cross-domain Trash page with expiry and Empty Trash is useful at larger scale,
but it adds retention policy, bulk deletion, and more migration work than the
current per-browser product needs.

## Data model

Add optional lifecycle metadata to both existing record types:

```ts
interface LifecycleFields {
  archivedAt?: string;
}
```

`GarageRobot` and `InventoryPart` gain `archivedAt?: string`. Absence means
active. Existing `rf.garage.v1` and `rf.inventory.v1` arrays remain valid and
require no destructive migration. Import normalization accepts a valid ISO
timestamp only for full RobotForge backups; ordinary third-party imports become
active records.

Archive and restore modify only `archivedAt`. They do not change IDs, spec
versions, assignments, assembly history, photos, timestamps, or provenance.

## Domain operation boundary

Create a pure lifecycle module for planning and validating mutations, plus a
browser repository for committing them:

- `archiveRobot`, `restoreRobot`
- `planPermanentRobotDeletion`
- `archiveInventoryPart`, `restoreInventoryPart`
- `planPermanentInventoryDeletion`
- `activeRobots`, `archivedRobots`, `activeInventory`, `archivedInventory`

Every operation takes an expected current record snapshot or revision token.
Apply re-reads storage and rejects the operation if its target changed. UI
buttons, Wrench tools, imports, and future model adapters call the same
functions; models may propose allow-listed operations but never receive a raw
storage API.

The browser repository owns fresh reads, normalization, write ordering, custom
store events, and user-facing errors. New lifecycle code must not add more
direct `localStorage` calls in components.

Mutations run under one origin-wide `robotforge-crud` Web Lock so two tabs cannot
interleave their read/check/write sequences. On browsers without Web Locks, the
repository uses a short, owner-tagged lease acquired atomically in a dedicated
IndexedDB read/write transaction. If neither lock mechanism is available, it
refuses the mutation; it does not silently fall back to an unsafe uncoordinated
write.

## Archive and restore behavior

### Robots

- Archive is available from the active robot header.
- One click opens a lightweight confirmation naming the robot and version count.
- On success the robot leaves the active list and appears under Archived Robots.
- Archived robots are excluded from Wrench mutation/name resolution, active
  robot selectors, default inventory filters, and normal Workshop navigation.
- Inventory assigned to an archived robot keeps its `robot_id` and displays
  `Archived robot: <name>` rather than becoming unassigned.
- Restore returns the exact same record and relationships to active views.

### Inventory

- Archive replaces the current immediate Remove action.
- Archived parts and tools leave active counts, filters, BOM availability, and
  Wrench inventory operations.
- Full-size photos remain in IndexedDB while archived.
- Restore returns the exact record, photo, assignment, confirmation state, and
  count.

Each screen has a collapsed `Archived (N)` section. Archived records support
Restore and Permanently delete; permanent deletion is not exposed elsewhere.

## Permanent robot deletion

Before confirmation, compute and display a deletion summary containing:

- robot name and number of spec versions;
- number of assembly versions that will be deleted;
- repo-import provenance stored inside the robot, when present;
- number of inventory records that will be unassigned;
- an explicit note that global build-list and wiring data are unchanged.

Permanent deletion is allowed only when the robot is still archived and still
matches the snapshot used to produce the summary. Apply performs one logical
transaction:

1. Remove the robot from `rf.garage.v1`.
2. Remove its key and assembly history from `rf.assemblies.v1`.
3. Set matching inventory `robot_id` values to `null`; never delete those parts.
4. Preserve global `rf.build.v1` and `rf.wiring.v1` data.

If any write fails, the operation reports failure and completes or repairs from
a small transaction journal on the next repository initialization. Components
must not announce success before the journal reaches its committed state.

## Permanent inventory deletion

Before confirmation, show the part name, assignment (including archived robot),
and whether a full-size retained photo exists. Permanent deletion:

1. Removes the archived inventory record from `rf.inventory.v1`.
2. Queues deletion of its `photo_asset_id` from IndexedDB.
3. Leaves robot spec/version history and assemblies unchanged because inventory
   assignment is not installation.

Logical record deletion succeeds only after localStorage commits. Photo cleanup
then runs idempotently. If IndexedDB cleanup fails, retain a small garbage-
collection queue and show `Record deleted; photo cleanup will retry` rather than
pretending every byte was removed. Retry on inventory repository startup.

## Transaction and concurrency policy

LocalStorage cannot atomically update several keys, so cross-domain deletion
uses a journal such as `rf.crud.transaction.v1` containing the operation ID,
expected snapshots, and complete target values for each logical key. Applying a
journal is idempotent. On startup, the repository finishes a prepared operation
forward; it never guesses which partial state the user wanted.

Within a single key, mutation always starts from a fresh read. The expected
target snapshot prevents a stale preview, background model reply, another tab,
or older React closure from overwriting a newer record. A conflict leaves data
unchanged and asks the user to retry against the latest state.

Storage events fire after the logical commit so mounted views refresh together.
Write and recovery failures remain visible until resolved.

The transaction journal, lock database/record, and photo-cleanup queue use the
same demo-mode namespace resolution as the data they protect. A demo transaction
can never recover into or delete visitor data. If the journal cannot be written
before the first target-key mutation, the operation stops without changing any
target data.

## Import, export, and duplicate handling

- Full RobotForge exports include archived records and lifecycle metadata.
- Active-only single-robot/spec exports remain active-only and unchanged.
- Imports preview Add, Merge, Replace, and Skip when IDs, repo identity, or
  normalized names collide. No duplicate is silently skipped.
- Replace is explicit. The displaced record receives a new collision-safe ID and
  is preserved in Archived state; the imported record takes the requested active
  identity only after the transaction commits. A failed import therefore cannot
  destroy the only copy.
- New IDs use `crypto.randomUUID()` when available, with the existing generator
  only as a compatibility fallback.

## User interface

### Workshop

- Replace Remove with Archive in the active header.
- Add `Archived robots (N)` below the active robot list.
- Selecting an archived robot opens a read-only summary with Restore and
  Permanently delete.
- Permanent delete uses a second confirmation panel containing the computed
  relationship summary and the robot name. Canceling or selecting another
  record clears the pending action.

### Inventory

- Replace Remove from inventory with Archive.
- Add an Archived filter/section separate from real/sim and confirmation filters.
- Archived detail is read-only except for Restore and Permanently delete.
- Permanent delete names the photo cleanup and robot assignment effects.

### Feedback

- Archive and Restore show a short success notice with the affected name.
- Conflict, quota, blocked storage, journal recovery, and photo cleanup states
  have distinct messages.
- Buttons disable while their transaction is committing.

## Wrench and model behavior

Wrench lists and mutates active records by default. It may list archived records
only after an explicit request. Archive, restore, and permanent delete are not
part of the first command grammar increment; the visible controls establish the
lifecycle safely first.

If those commands are added later, archive/restore use the same preview-and-
apply operation boundary. Permanent deletion always requires the Archived UI
confirmation and cannot be completed by a model response or chat command.

## RAG decision

RAG is not part of CRUD. Mutations operate on selected IDs and validated schemas,
not semantic retrieval. The existing structured catalogue and keyword engine
remain the correct default.

Future RAG may support read-only questions over imported repository documents,
manuals, datasheets, and a substantially larger corpus. It must be justified by
measured queries that lexical/structured search cannot answer, use hybrid
retrieval with citations, and feed only proposals or answers—not storage writes.

## Testing

### Pure lifecycle tests

- Archive and restore preserve every field except `archivedAt`.
- Active/archived selectors exclude the correct records.
- Permanent robot deletion removes Garage and assembly data, unassigns
  inventory, and preserves build/wiring data.
- Permanent inventory deletion plans photo cleanup and preserves robot history.
- Stale expected snapshots reject without mutation.
- Duplicate import choices produce distinct, deterministic outcomes.

### Repository tests

- A failed intermediate write leaves a recoverable journal.
- Startup recovery finishes each prepared operation exactly once.
- Quota/blocked-storage errors do not announce success.
- Cross-tab/stale operations cannot overwrite newer data.
- IndexedDB cleanup succeeds, retries after failure, and is idempotent.
- Legacy arrays without lifecycle fields load as active records.

### Interaction tests

- Archive confirmation performs no write until confirmed.
- Switching records cancels pending confirmation.
- Archived views restore records and expose permanent deletion.
- Permanent confirmation displays the computed relationship counts.
- Buttons remain disabled during commit and errors remain visible.
- Active counts, BOM candidates, selectors, and Wrench results exclude archived
  records.

Static source-string assertions are insufficient for these behaviors. Keep pure
Node tests for domain transitions and add a browser/component harness for the
click-to-storage boundary. Manual QA covers reload, two tabs, private/blocked
storage, quota exhaustion, demo isolation, mobile layout, and keyboard focus.

## Rollout

1. Add lifecycle fields, pure selectors, and repository normalization without
   changing current UI behavior.
2. Add robot archive/restore and relationship-aware permanent deletion.
3. Add inventory archive/restore, photo cleanup, and permanent deletion.
4. Route remaining Garage/inventory/import mutation entry points through the
   repositories and add explicit import conflict previews.
5. Add Wrench archive/restore proposals only after the visible flows are stable.

Each step ships with backward-compatible reads and can be reviewed independently.
No production data migration or server deployment is required.

## Success criteria

- Ordinary removal is recoverable for both robots and inventory.
- Permanent deletion leaves no owned orphan data and preserves unrelated data.
- Stale, partial, and failed mutations are never reported as successful.
- Existing browser data, demo isolation, exports, and immutable version history
  continue to work.
- The full Python/Node suite, production Next build, and behavioral CRUD checks
  pass before release.
