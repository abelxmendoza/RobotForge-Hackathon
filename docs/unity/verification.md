# Unity workshop verification — 2026-11-11

This is the first local inspection milestone, not completion of all eight tasks in the broader Unity plan. Nothing was pushed or deployed.

## Actual local build

- Apple Silicon macOS; installed Unity 6000.6.8f1, Web Build Support, URP 17.6.0.
- Editor entitlement was recognized. Official G1 URDF/STL import, C# compilation, scene generation, IL2CPP/WebAssembly build and local staging succeeded.
- Current artifact: `workshop-local-2`, 20 files / 45,676,821 bytes, uncompressed. Source build: `build/unity/workshop-local-2`; staged copy: `web-next/public/unity/workshop-local-2`. Both are ignored generated output.
- A unique canvas ID fixed an actual browser keyboard-initialization error. Camera yaw was corrected to frame the front of the tool wall; scrolling outside the canvas no longer changes zoom.

## Results

| Check | Result | Evidence / boundary |
| --- | --- | --- |
| Unity EditMode | PASS | 4 passed, 0 failed, 0 skipped; actual Editor runner, coordinate basis/orientation and joint clamping |
| Focused web/Workshop/G1 regressions | PASS | 27 passed, 0 failed, 0 skipped in final focused run |
| TypeScript | PASS | `tsc --noEmit` |
| Next.js production static export | PASS | Actual artifact included in export |
| Actual browser player | PASS | In-app browser at localhost, both development and exported static app |
| Wrench acknowledgement | PASS | `select humanoid head_link` returned Unity `selectLink` acknowledgement and changed React selection |
| Selection/visibility/posing | PASS | Head selected, hidden and shown; left elbow set to 0.7 radians and actual acknowledged value returned |
| Renderer switching | PASS | Ten complete Unity/current-view cycles; one DOM canvas at end. No heap/profiler claim |
| Complete Python suite | FAIL | Earlier run: 1023 passed, 2 failed, 6 skipped. Worker mock stdout truncation and missing legacy exported JPG links remain unresolved; focused checks do not supersede this |
| Safari/Chrome/Firefox/Edge named browser matrix | SKIP | Only in-app browser checked |
| Real phones / performance budgets | SKIP | No real-device/FPS/cold-network measurements |
| Rover driving / gait / physical hardware | SKIP | Not implemented or tested |

The CLI test launcher stalled without launching an Editor. It was canceled, then the installed Editor's documented batch test runner completed all four tests. A passing synthetic bridge or packaging fixture is not counted as an engine/hardware test.

## Remaining work

- This scene is original primitive blockout scenery. Blender artwork, test stations and measured rover physics/course receipts are not implemented. Rover rendering is a static simplified body proxy. G1 is a manufacturer reference, not owned hardware or a walking controller.
- Full transient selection/pose parity across current and Unity renderers is not implemented. Switching views can reset inspection state; saved robot records remain owned by React.
- The singleton lease waits for engine startup before teardown. If `createUnityInstance` never resolves, Return can remain at Closing Unity. Normal startup/teardown and script-loader cancellation passed; hung engine-download recovery remains a P2 follow-up. A second Unity player is not intentionally started around that pending lease.
- Joint input coalescing, exhaustive failure/stale-command browser checks, mobile acceptance and profiling remain open gates. Protocol tests cover synthetic stale replies and timeouts; these are distinct from real runtime injection tests.
- The uncompressed local payload exceeds the proposed 30 MB compressed target; no compressed-size or load-time target is claimed. Brotli headers are configured but not verified on a deployed host.

## Preview and rollback

Run the static export over HTTP, then open `/garage/`, choose G1, Build, and **Immersive · Unity**. Wrench supports explicit commands such as `select humanoid head_link`, `next humanoid part`, `pose left_elbow_joint to 40 degrees`, and `reset humanoid`.

Return to current 3D view exits Unity after teardown. To roll back an artifact, restore a previously staged `public/unity/current.json` that points to its unchanged versioned files, then rebuild the static export. Never relabel an existing player's compiled build ID. Do not commit generated player binaries; a deployment must stage the chosen artifact explicitly.
