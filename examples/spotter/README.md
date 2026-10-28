# Spotter worked example — a pipeline test with a known robot

`andino/` is the output of running RobotForge Spotter v1 end-to-end on
a robot we already know, treated *as if* it had just been spotted in
the wild:

    robotforge spot --photo examples/spotter/andino/spotted-photo.png \
        --identity Andino --out examples/spotter/andino

- `spotted-photo.png` — the "spotted" photo. It is Ekumen's own photo
  of the real robot, taken from the official repository
  (https://raw.githubusercontent.com/Ekumen-OS/andino/main/docs/real_robot.png);
  credit: Ekumen, per the Robodex entry's `image_credit`. Included
  here so the example is reproducible offline.
- `dossier.json` — the machine-readable dossier
  (`robotforge-spotter/1`). Every field carries its provenance:
  PHOTO-ESTIMATED / WEB-SOURCED / CATALOG / UNKNOWN.
- `card.md` — the human-readable rendering of the same dossier.

What the run honestly shows (2026-10-28, live photo + live lookup):

- The vision model **did not identify the robot** — its identity guess
  was "unknown custom robot" and it named the draft "Blue Mini Lidar
  Bot". The working identity "Andino" is operator-provided, and the
  dossier's identity field says exactly that; the SAME verdict comes
  from the catalog match, not from the photo.
- The catalog cross-check agrees with the photo draft on size, wheel
  and drivetrain — and **disagrees on mass (photo 1.1 kg vs catalog
  3.364 kg)**. The draft was not corrected; the disagreement is printed.
- The GitHub lookup ranks a brand-namesake repo (`andino-systems`)
  "official" by its owner-name heuristic while the actual upstream
  (Ekumen-OS/andino, 339 stars, the twin candidate's source) ranks
  "community" — rankings are heuristics and the dossier labels them so.
  The repo list also contains unrelated namesakes (an Argentine data
  portal, a bank website); they are carried, labelled, not hidden.
- License honesty runs both ways: the GitHub API reports no license
  for Ekumen-OS/andino (no root LICENSE file), so sources say
  "not stated"; the catalog's own provenance record (per-package
  BSD-3-Clause) is what the credit line cites, tagged CATALOG.
