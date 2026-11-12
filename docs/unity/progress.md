# Execution ledger — 2026-11-11-unity-workshop

Task 1 inventory: Apple Silicon Mac, sufficient local disk, no editor or activation found in standard locations or Spotlight. Official Unity Hub installation started. Pin Unity 6000.3.25f1 (release e1dba0a9aba4). Owner activation may be required.

Ruling: prepare and verify source/protocol/staging work while activation is pending; real player gates remain unmet until Unity builds and runs. Never substitute a mocked Unity runtime or generated placeholder binary.

Pre-flight: snapshot identity is shared by protocol, player and C# controller. Existing humanoid and bench events acknowledge synchronously; the Unity path needs a separate asynchronous dispatch before those fallback handlers. Selection/version/demo transitions must dispose the transport. Current Three.js model stays available.

Source prepared: pinned editor project, G1 binary STL/URDF importer, URP scene/build generator, coordinate/joint EditMode tests, C#/JS typed command bridge, serialized player lease, optional renderer entry points, React link/joint controls, artifact staging and static-host headers. Runtime C# compilation and package resolution remain pending a real activated editor; generated package lock/scenes will come from that editor rather than be fabricated.

Web verification so far: 40 focused tests PASS (protocol/lifecycle/packaging plus Workshop/G1 regressions), TypeScript PASS. Packaging fixtures are explicitly synthetic; no Unity binary or runtime validation is implied.

Setup result: Unity Hub 3.22.6 ARM64 installed at `/Applications/Unity Hub.app`. Installer SHA-256 exactly matched the published Homebrew cask receipt; verification through unrestricted macOS signing services accepted the notarized Unity Technologies application. Initial restricted signing results were misleading and were resolved before installation. Homebrew installation was canceled after its index stalled; direct official CDN download completed and was verified.

Handoff blocker: Hub is open on **Unity Hub Software License Terms**. Agree has not been clicked. The owner must review/accept these binding terms, sign in and activate an appropriate license. The pinned editor and Web Build Support are not installed yet. No acceptance/account/license bypass was attempted.

Browser check: existing demo G1 viewer opens; selecting Immersive with no staged build shows an honest unavailable message; Retry returns the same message; Return restores the real G1 viewer. This verifies failure recovery only, not Unity rendering. Source review fixes include loader-Promise cancellation, identity-change UI reset, and Wrench explanation routing. Full saved transient-view parity and coalesced 15 Hz joint streaming remain pending the real player gate.

Owner completed editor installation. Detected Unity 6000.6.8f1 ARM64 with Web support. Ruling: use the installed current stable editor instead of requiring a second large 6.3 download; update project pin and validate real compiler/package compatibility. CLI beta.13 reports beta.17 available but requires approval for that update; leave CLI unchanged.

Real editor pass: entitlement recognized, package resolution corrected (remove nonexistent inputlegacy package; existing legacy input assembly is provided by the editor), URP 17.6.0 resolved, package lock generated, project C# compilation and G1/scene generation passed. WebAssembly player compilation is in progress. Generated model meshes and scene output are excluded from Git and reproducible through the build recipe.

Local inspection milestone verified: real Web builds `workshop-local-1` and `workshop-local-2` succeeded. Build 2 fixes canvas identity/keyboard initialization and initial camera framing; staged 20 files / 45,676,821 bytes. Actual Editor EditMode: 4 PASS / 0 FAIL / 0 SKIP. CLI test startup stalled and was canceled; the installed native Editor runner completed normally.

Real in-app browser checks passed in both development and exported static app: ready handshake, link selection, Wrench select acknowledgement, hide/show and 0.7-radian elbow pose. Ten launch/quit/current-view cycles completed with one canvas at end. Final focused Python run: 27 PASS; TypeScript and Next.js production export PASS. See verification.md for full-suite failures, browser/device SKIPs and remaining work. This is a local inspection milestone; the broader physics/art/performance plan remains open.
