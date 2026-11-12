# Build the Unity Workshop

## Prerequisites

Unity Hub, an activated Unity entitlement appropriate to the owner's usage, Unity **6000.6.8f1** (`237b6593792b`) for Apple Silicon on this Mac, and that editor's Web Build Support module. A Hub installation is not an editor installation or license activation. The owner completes sign-in and agreement acceptance in Hub. Never put credentials or serial numbers in the repository or command history.

Open `unity/RobotForgeWorkshop` in the pinned editor once to resolve packages and verify the generated package lock and importer settings. Project source includes deterministic `.meta` GUIDs; Unity must validate/import them. The project now resolves URP 17.6.0 against the owner-installed 6000.6 editor. C# compilation and model import have passed; final Web runtime validation is recorded separately.

The editor build command uses `RF_UNITY_BUILD_ID` and repo-relative output. Set `RF_UNITY_EDITOR` to the selected editor executable; it is a per-shell local setting, never a committed host path.

```sh
RF_UNITY_BUILD_ID=workshop-local-1 "$RF_UNITY_EDITOR" \
  -batchmode -quit -projectPath unity/RobotForgeWorkshop \
  -executeMethod RobotForge.Editor.BuildWorkshopWeb.Build \
  -logFile /tmp/robotforge-unity-build.log
```

The editor imports the pinned G1 binary STL visuals, joint hierarchy and limits, converts the coordinate basis and winding, creates a URP workshop scene, and outputs a real uncompressed Web artifact to `build/unity/workshop-local-1/`. The initial artifact intentionally uses uncompressed HTTP loading for local Next.js preview; a Brotli release profile and real header checks remain a follow-up gate.

Stage that same build ID from `web-next`:

```sh
npm run stage-unity -- --source ../build/unity/workshop-local-1 --build-id workshop-local-1
npm run dev
```

Staging verifies required license receipts, file hashes, file count/type/size and disallows symlinks. It never manufactures an engine binary. A different build ID must not be used to relabel a compiled player: its ready message must match the manifest or the host rejects it.

Ordinary Next.js builds do not launch Unity. `npm run build` now fetches the pinned public release in `unity-release.json` when needed, checks its archive SHA-256, and stages it before export. Cached staged files are rechecked against their individual receipts; missing, corrupted, or unavailable artifacts fail the build. The compiled artifact is distributed through GitHub Releases rather than Git history. Generated player output is ignored by Git. A real local artifact has been built and staged; see `verification.md` for the tested build and limitations.

## Tests

Web protocol, lifecycle and synthetic packaging checks:

```sh
PYTHONPATH=src python3 -m pytest tests/test_unity_protocol.py tests/test_unity_build_manifest.py -q
```

Unity EditMode checks (requires the actual editor and activation):

```sh
"$RF_UNITY_EDITOR" -batchmode -projectPath unity/RobotForgeWorkshop \
  -runTests -testPlatform EditMode -testResults /tmp/robotforge-unity-editmode.xml \
  -logFile /tmp/robotforge-unity-tests.log
```

Passing synthetic transport/packaging tests is not proof that Unity compiles, loads, or matches source-model geometry. Verify real player startup, Wrench acknowledgement, selected-link UI, stale commands, cleanup, G1 pose transforms, missing assets, touch controls and target-device performance before promoting the immersive view.

## Current implementation limits

The current Unity source provides reference inspection/posing and a static rover body proxy. A rover proxy is not a driving simulation. The timed course, physics receipts, real-device performance gate, Blender environment polish, and gait controllers have not been implemented or validated. Existing Rapier and G1 Three.js views remain available. Unity cannot access saved stores or Worker credentials.

## Published player delivery

The `unity-workshop-local-2` GitHub release contains the verified Web player archive with its license/provenance receipts. `scripts/fetch-unity.mjs` consumes the exact URL and SHA-256 in `unity-release.json`; update that pin only after building and testing a new artifact. This keeps future Vercel Git builds from dropping the Unity player. To roll back, restore the previous tested release pin and rebuild. No Unity Editor, Worker change or secret is required on Vercel.
