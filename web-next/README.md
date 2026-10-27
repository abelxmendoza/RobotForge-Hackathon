# RobotForge — Next.js copy (branch: feature/web-next)

A React + TypeScript port of the RobotForge site, built to be
content- and behaviour-identical to the vanilla site (which stays
live and shippable; this copy takes the Pages slot only via the
Nov 1 decision gate in the project plan).

Stack: Next.js 16 (App Router, static export), React 19, TypeScript,
Redux Toolkit (two slices only: Forge stepper, catalogue filters),
Three.js for the take-apart kit. The vanilla stylesheets and catalog
data are the design system: both are synced verbatim from the repo
at build time, and the JSX mirrors the generated markup class for
class. Tailwind is installed per the plan but the port deliberately
styles through the synced vanilla CSS to stay identical.

## Run it

    npm install
    npm run dev     # predev syncs data/assets/styles from the repo
    npm run build   # prebuild syncs too; static export lands in out/

## Parity

    npm run build && node scripts/parity.mjs

compares the exported pages' text against the vanilla site and
checks key strings (robot names, verdicts, thresholds). Per-page
SSR-vs-vanilla harnesses were also run during the port (chat engine
54/54 questions identical; take-apart derivation byte-identical;
evidence cards 8/8).
