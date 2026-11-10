# Video and scan intake for a better robot simulation

## Intent and first delivery
Make the existing Garage workflow usable for attaching walk-around video and a scan to one saved robot, starting with appearance. Build on the existing Next.js app and local browser storage.

## Approaches
Video-only reconstruction requires a new reconstruction service and uncertain scale. Scan-assisted intake reuses the current scan viewer, measurement path and simulation model loading. The user accepted the recommended scan-assisted route, with appearance before driving calibration.

## First delivery
- Expose the existing video importer directly in the saved robot Overview; it currently exists as a component but is not rendered there.
- Explain how to capture a slow walk-around clip and show extracted frames in the existing draggable photo view.
- Make extraction bounded and recoverable: handle decode and seek errors, avoid waiting for a seek event when already at the requested time, show progress and release decoder resources.
- Show the existing scan measurement control beside the uploaded scan. PLY bounds use the existing axis and unit rules; the owner reviews those rules before applying dimensions through the existing new-version callback.
- Keep GLB/OBJ as visual inputs and use the existing simulation renderer. State that the collision body remains simplified; reference video does not generate geometry or physics.
- Keep existing photos, robot versions and media removal controls intact.

## Data and limitations
Reuse GarageRobot.spin and GarageRobot.scan; no schema migration or cloud service. Extracted frames are stored with the robot locally and included in optional account saves; the original video is not retained or synced. Scans remain in IndexedDB. A PLY point cloud is a point preview, not a textured reconstruction. Mass, friction and motor values are not inferred from footage.

## Verification
Exercise frame extraction with a generated video (synthetic media, not robot validation), unsupported media and a short clip; check repeat upload and persistence. Verify scan controls and new-version integration, run the production build and relevant existing tests. Report browser or hardware checks that could not be performed separately.

## Follow-up: motion accuracy
A separate slice will retain motion clips and collect known distance, timing and turn measurements, then preview calibration changes before saving a version. This first delivery makes no automatic motion-calibration claim.
