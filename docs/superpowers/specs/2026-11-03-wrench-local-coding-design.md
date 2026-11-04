# Wrench local repository coding — proposed design

Status: superseded. The owner explicitly removed repository coding from scope in favor of build generation, wiring and realistic animated 3D. Retained for history only; do not implement this design.

## Intent and agreed direction

Wrench should work on a user's real robot repository: understand files, propose and make code changes, run configured checks, and present evidence and diffs. The user chose a local repository for the first release. Wheeled rovers remain the first target for the broader CAD, electrical planning, programming and simulation work. Repository coding is the next implementation slice; it does not replace those remaining milestones.

## Current foundations

- `web-next/src/components/chat/ChatDock.tsx` hosts the chat UI; `components/chat/wrench.ts` handles recorded-data answers.
- `web-next/src/lib/repoImport.ts` imports public GitHub robot metadata. It is not a local file editor.
- `src/robotforge/simulator.py` is a loopback Gazebo companion with strict origin checks and bounded jobs. Its contract explicitly excludes arbitrary shell commands. Preserve that contract.
- The live Worker owns existing hosted model credentials. It is frozen. Do not modify or deploy it for this feature.

## Approaches

1. Browser plus local coding companion (selected direction): browser chat and diff review, locally registered checkout, local coding-engine execution. Reuses local tools without adding a hosted execution platform.
2. Browser-only editing: insufficient for native repository builds and Gazebo.
3. Hosted coding jobs: useful later but adds credential, storage, isolation and operational work.

## Proposed first release

The following implementation choices are proposals by the builder, not yet decisions explicitly made by the owner.

### Local service and connection

Create `src/robotforge/coding.py`, independent of the Gazebo service. Launch with an explicit repository path and allowed browser origin. Bind only to loopback. Generate a session token kept in memory, entered in the browser and never included in logs or URLs. Enforce Host, Origin and authenticated preflighted requests. The browser cannot select arbitrary server filesystem paths.

Health reports protocol version, selected repository display name and engine availability, never credentials or absolute sensitive paths. Browser credentials remain in memory; reconnect after refresh. Expose jobs and review actions, not a general remote shell endpoint.

### Repository ownership and isolation

Resolve the configured checkout and reject non-Git roots. Read applicable AGENTS.md instructions. Preserve the user's index, branch, dirty files and untracked files. Create a job worktree on a `codex/wrench-*` branch from the selected committed base; list excluded uncommitted changes before running. One active mutation job per repository.

A Git worktree is change isolation, not a security sandbox. Run the coding engine and repository checks in a container with only the job checkout mounted writable; no host home, credentials directories, Docker socket or original checkout mounts. Model credentials are passed only to the engine process through its environment. Dependency installation requires an explicitly configured build profile and network policy. If isolation is unavailable, show setup-needed rather than falling back silently to unrestricted execution.

### Coding engine

Evaluate Aider's CLI scripting interface as the first adapter. Official sources: https://aider.chat/docs/scripting.html and https://aider.chat/docs/llms/openai-compat.html . It supports scripted operation and OpenAI-compatible endpoints. This does not prove Muse's edit quality or protocol compatibility. Before adopting a pinned release, verify upstream license, runtime requirements, supported CLI flags, telemetry defaults and provider behavior.

Use a locally configured provider endpoint/model and credential; no dependency on changing the live Worker. Do not place credentials in command arguments, files or chat history. Disable automatic commits, automatic test execution and shell suggestions in the engine; the companion owns those actions. Treat repository files and model output as untrusted inputs. Restrict context collection to text files within the job checkout, exclude secrets and generated/vendor trees, and enforce file and context size limits. Tell users which files will leave their machine for model inference before the first model call.

First test: ask Muse to change a small Python function in a disposable fixture repository, then run its tests and inspect the diff. If that adapter cannot complete the test, report the incompatibility and revise the adapter choice; never present a canned result as a successful coding job.

### Workflow and UI

Connect companion → inspect repository → submit request → review proposed file scope and check profile → execute edit in isolated job → show diff → run configured checks → review result. Users can cancel a job. Terminate the process group and bound runtime/output. Store job identity, base commit, changed file hashes, check exit codes and truncated sanitized output.

Add a repository mode within Wrench, separate from robot-spec edits. Proposed modules: `web-next/src/lib/codingClient.ts`, `components/chat/RepositoryCoding.tsx`, and backend job/adapter modules under `src/robotforge/`. Reuse existing chat components and visual conventions.

First release delivers changes on the review branch plus a downloadable patch. It does not automatically merge into the original checkout. Applying a patch must verify the base and refuse conflicts; a manual Git review path remains available. Never report a test as passed unless it actually ran and exited successfully. A coding job is not a robot simulation result.

### Checks and protected actions

Checks use locally configured argv profiles, with working directories inside the job checkout, resource limits and explicit network settings. No model-selected shell strings. Repository instructions constrain the agent; enforce protected paths and deployment command restrictions outside model prompting too. For RobotForge, prevent coding jobs from modifying `live/`, credential files or deployment workflows, or invoking deployment commands. Preserve the owner's freeze and never expose secret values.

Automatic push, merge, publish, deploy and physical robot actuation are outside the first release. Future simulation integration consumes a supported robot package and records the exact code/spec revisions used; arbitrary repositories do not automatically become simulatable.

## Acceptance criteria

1. A real local fixture repo is inspected and changed from a Wrench request through a live configured model.
2. Tests execute against the changed job checkout and their actual outputs appear with the diff.
3. The original checkout, dirty changes, index and current branch are unchanged.
4. Invalid tokens/origins, path traversal, symlink escapes and secret paths are rejected; logs do not expose credentials.
5. Cancellation, timeouts, engine failures and missing model setup produce explicit states with no fabricated success.
6. Protected deployment actions are blocked independently of model instructions.
7. A clean checkout can receive the reviewed patch; a changed/conflicting base refuses application.
8. No Worker changes, deployment, dependency installation or production mutation occurs during design review.

## Broader claim-completion roadmap

After repository coding: unify versioned parts/wiring/CAD/simulation inputs; extend build123d mounts and harness enclosures; add sourced regulator selection and power-budget checks; add editable rover behavior; execute the same behavior in Rapier and local Gazebo; produce a reference rover with downloadable artifacts and measured evidence. Repository editing alone does not satisfy these product claims.

## Left to implementation planning

Pin the engine/container versions after the compatibility test, choose concrete protocol payload limits and runtime budgets, define the event schema and check-profile format, and specify focused unit/integration/browser tests. Preserve zero required dependencies for the existing core package by making coding dependencies optional. Review dependency licenses and record attribution before reuse.
